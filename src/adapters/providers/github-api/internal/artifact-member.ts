import { Readable } from 'node:stream';
import { fromBufferPromise, type Entry } from 'yauzl';
import { throwIfNativeAborted } from '../../../../contracts/native-abort.ts';

import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { withOwnedByteStreamReader } from '../../../../execution/stream-reader.ts';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_MEMBER_BYTES = 10 * 1024 * 1024;
const MAX_MEMBERS = 1024;

/** Read one exact member with the mature ZIP reader; never extract archive paths. */
export async function readArtifactMember(input: Readonly<{
  archive: Uint8Array;
  fileName: string;
  chargeDecodedBytes?(bytes: number): void;
  signal: AbortSignal;
  assertCurrent(): void;
}>): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/u.test(input.fileName) || input.fileName === '.' || input.fileName === '..' ||
      input.archive.byteLength === 0 || input.archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Artifact member admission is invalid');
  }
  const assertCurrent = (): void => { throwIfNativeAborted(input.signal); input.assertCurrent(); };
  assertCurrent();
  return await withAcquiredResource({
    operationLabel:'artifact-member', resourceLabel:'artifact-zip',
    acquire: async () => await fromBufferPromise(Buffer.from(input.archive), {
      lazyEntries:true, autoClose:false, validateEntrySizes:true, strictFileNames:true
    }),
    async use(zip) {
      if (zip.entryCount < 1 || zip.entryCount > MAX_MEMBERS) throw new Error('Artifact member count exceeds its bound');
      const names = new Set<string>();
      let zipEntries = 0;
      let selected: Entry | undefined;
      for await (const entry of zip.eachEntry()) {
        assertCurrent();
        const name = entry.fileName;
        const directory = name.endsWith('/');
        const parts = (directory ? name.slice(0,-1) : name).split('/');
        const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (++zipEntries > MAX_MEMBERS) throw new Error('Artifact member census exceeded its bound');
        if (Buffer.byteLength(name,'utf8') > 4096 || names.has(name) || name.startsWith('/') ||
            name.includes('\\') || name.includes('\0') || parts.some(part => part === '' || part === '.' || part === '..') ||
            (entry.generalPurposeBitFlag & 0x41) !== 0 || !entry.canDecodeFileData() ||
            ((entry.externalFileAttributes & 0x10) !== 0 && !directory) ||
            (kind !== 0 && kind !== (directory ? 0o040000 : 0o100000))) {
          throw new Error('Artifact contains ambiguous or unsupported members');
        }
        names.add(name);
        if (name === input.fileName) {
          if (directory || entry.uncompressedSize < 1 || entry.uncompressedSize > MAX_MEMBER_BYTES) {
            throw new Error('Artifact selected member size is invalid');
          }
          selected = entry;
        }
      }
      if (names.size !== zip.entryCount || selected === undefined) throw new Error('Artifact selected member is absent or census is incomplete');
      assertCurrent();
      const stream = await zip.openReadStreamPromise(selected);
      return await withOwnedByteStreamReader(Readable.toWeb(stream), async read => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          assertCurrent();
          const chunk = await read();
          if (chunk.done) break;
          input.chargeDecodedBytes?.(chunk.value.byteLength);
          size += chunk.value.byteLength;
          if (size > MAX_MEMBER_BYTES || size > selected!.uncompressedSize) throw new Error('Artifact member output budget exceeded');
          chunks.push(new Uint8Array(chunk.value));
        }
        if (size !== selected!.uncompressedSize) throw new Error('Artifact member size did not settle');
        assertCurrent();
        return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
      }, input.signal);
    },
    release: zip => { zip.close(); }
  });
}
