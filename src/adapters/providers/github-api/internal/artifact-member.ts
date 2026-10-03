import { Readable } from 'node:stream';
import { fromBufferPromise, type Entry } from 'yauzl';
import { throwIfNativeAborted } from '../../../../contracts/native-abort.ts';
import { HostedArtifactProjectionDataError } from '../contract/hosted-bootstrap-artifacts.ts';

import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { withOwnedByteStreamReader } from '../../../../execution/stream-reader.ts';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_MEMBER_BYTES = 10 * 1024 * 1024;
const MAX_MEMBERS = 1024;

/** Read one exact member with the mature ZIP reader; never extract archive paths. */
export async function readArtifactMember(input: Readonly<{
  archive: Uint8Array;
  fileName: string;
  signal: AbortSignal;
  assertCurrent(): void;
}>): Promise<string> {
  const fileName = input.fileName;
  const members = await readSelectedArtifactMembers({ ...input, fileNames: [fileName], exact: false });
  return members[fileName]!;
}

/** All members come from the same retained response and one bounded ZIP census. */
export async function readArtifactMembers(input: Readonly<{
  archive: Uint8Array;
  fileNames: readonly string[];
  chargeDecodedBytes?(bytes: number): void;
  signal: AbortSignal;
  assertCurrent(): void;
}>): Promise<Readonly<Record<string, string>>> {
  return await readSelectedArtifactMembers({ ...input, exact: true });
}

async function readSelectedArtifactMembers(input: Readonly<{
  archive: Uint8Array;
  fileNames: readonly string[];
  chargeDecodedBytes?(bytes: number): void;
  exact: boolean;
  signal: AbortSignal;
  assertCurrent(): void;
}>): Promise<Readonly<Record<string, string>>> {
  const names = input.fileNames;
  if (!Array.isArray(names) || names.length < 1 || names.length > 16
      || !(input.archive instanceof Uint8Array) || input.archive.byteLength === 0
      || input.archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Artifact member admission is invalid');
  const selectedNames: string[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(names, index);
    if (entry === undefined || !('value' in entry) || typeof entry.value !== 'string') throw new Error('Artifact member admission is invalid');
    selectedNames.push(entry.value);
  }
  const fileNames = Object.freeze(selectedNames);
  const archive = Buffer.from(input.archive);
  const exact = input.exact;
  const signal = input.signal;
  const ownerAssertCurrent = input.assertCurrent;
  const chargeDecodedBytes = input.chargeDecodedBytes;
  if (fileNames.length < 1 || fileNames.length > 16 || new Set(fileNames).size !== fileNames.length
      || fileNames.some(name => typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(name) || name === '.' || name === '..')
      || archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Artifact member admission is invalid');
  }
  const assertCurrent = (): void => { throwIfNativeAborted(signal); Reflect.apply(ownerAssertCurrent, input, []); };
  assertCurrent();
  return await withAcquiredResource({
    operationLabel:'artifact-member', resourceLabel:'artifact-zip',
    acquire: async () => await fromBufferPromise(archive, {
      lazyEntries:true, autoClose:false, validateEntrySizes:true, strictFileNames:true
    }),
    async use(zip) {
      if (zip.entryCount < 1 || zip.entryCount > MAX_MEMBERS) throw new Error('Artifact member count exceeds its bound');
      const names = new Set<string>();
      let zipEntries = 0, selectedBytes = 0;
      const selected = new Map<string, Entry>();
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
          throw new HostedArtifactProjectionDataError('invalid', 'Artifact contains ambiguous or unsupported members');
        }
        names.add(name);
        if (fileNames.includes(name)) {
          if (directory || entry.uncompressedSize < (exact ? 0 : 1) || entry.uncompressedSize > MAX_MEMBER_BYTES) {
            throw new Error('Artifact selected member size is invalid');
          }
          selectedBytes += entry.uncompressedSize;
          if (selectedBytes > MAX_ARCHIVE_BYTES) throw new Error('Artifact selected members exceed the cumulative bound');
          selected.set(name, entry);
        } else if (exact) throw new HostedArtifactProjectionDataError('invalid', 'Artifact contains a member outside its closed projection');
      }
      if (names.size !== zip.entryCount) throw new Error('Artifact member census is incomplete');
      if (selected.size !== fileNames.length) throw new HostedArtifactProjectionDataError('unavailable', 'Artifact selected member is absent');
      const members: Record<string, string> = Object.create(null);
      let totalBytes = 0;
      for (const name of fileNames) {
        assertCurrent();
        const entry = selected.get(name)!;
        const stream = await zip.openReadStreamPromise(entry);
        members[name] = await withOwnedByteStreamReader(Readable.toWeb(stream), async read => {
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            assertCurrent();
            const chunk = await read();
            if (chunk.done) break;
            if (chargeDecodedBytes !== undefined) chargeDecodedBytes(chunk.value.byteLength);
            size += chunk.value.byteLength;
            totalBytes += chunk.value.byteLength;
            if (size > MAX_MEMBER_BYTES || size > entry.uncompressedSize || totalBytes > MAX_ARCHIVE_BYTES) {
              throw new Error('Artifact member output budget exceeded');
            }
            chunks.push(new Uint8Array(chunk.value));
          }
          if (size !== entry.uncompressedSize) throw new Error('Artifact member size did not settle');
          assertCurrent();
          return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
        }, signal);
      }
      return Object.freeze(members);
    },
    release: zip => { zip.close(); }
  });
}
