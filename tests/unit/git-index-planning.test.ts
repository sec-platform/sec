import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveGitIndexPlanningBudget } from '../../src/adapters/providers/git-read/runtime/budget.ts';
import {
  applyGitIndexObjectDelta, assertGitIndexObjectInfoBatch, assertGitIndexTreeGeneration, decodeGitIndexGeneration,
  encodeGitIndexGeneration, GitIndexPlanningBudgetError, type GitIndexObjectFormat
} from '../../src/adapters/providers/git-read/runtime/scratch-index-generation.ts';
import { captureGitScratchIndexDelta } from '../../src/adapters/providers/git-read/runtime/scratch-input.ts';

// These fixture bytes follow Git's published index layout directly. They do
// not use the generation encoder/planner under test to establish the oracle.
function indexBytes(input: Readonly<{
  version?: 2 | 3 | 4;
  format?: GitIndexObjectFormat;
  entries: readonly Readonly<{
    path: string;
    suffix?: string;
    remove?: readonly number[];
    flags?: number;
    extended?: number;
    mode?: number;
    oid?: string;
  }>[];
  extension?: string;
  extensionPayload?: Buffer;
}>): Buffer {
  const version = input.version ?? 2;
  const format = input.format ?? 'sha1';
  const oidLength = format === 'sha1' ? 20 : 32;
  const header = Buffer.alloc(12);
  header.write('DIRC', 0, 'ascii'); header.writeUInt32BE(version, 4); header.writeUInt32BE(input.entries.length, 8);
  const chunks: Buffer[] = [header];
  for (const entry of input.entries) {
    const fixed = Buffer.alloc(40 + oidLength + 2 + (entry.extended === undefined ? 0 : 2));
    fixed.writeUInt32BE(entry.mode ?? 0o100644, 24);
    Buffer.from(entry.oid ?? '11'.repeat(oidLength), 'hex').copy(fixed, 40);
    fixed.writeUInt16BE(entry.flags ?? (Buffer.byteLength(entry.path) | (entry.extended === undefined ? 0 : 0x4000)), 40 + oidLength);
    if (entry.extended !== undefined) fixed.writeUInt16BE(entry.extended, 42 + oidLength);
    const body = version === 4
      ? Buffer.concat([fixed, Buffer.from(entry.remove ?? [0]), Buffer.from(entry.suffix ?? entry.path), Buffer.from([0])])
      : Buffer.concat([fixed, Buffer.from(entry.path), Buffer.from([0])]);
    chunks.push(body);
    if (version !== 4) chunks.push(Buffer.alloc((8 - body.byteLength % 8) % 8));
  }
  if (input.extension !== undefined) {
    const extension = Buffer.alloc(8); extension.write(input.extension, 0, 'ascii');
    const payload = input.extensionPayload ?? Buffer.alloc(0); extension.writeUInt32BE(payload.length, 4);
    chunks.push(extension, payload);
  }
  const body = Buffer.concat(chunks);
  return Buffer.concat([body, createHash(format).update(body).digest()]);
}

const over = (resource: string) => (error: unknown): boolean =>
  error instanceof GitIndexPlanningBudgetError && error.resource === resource;

test('index raw/header admission is exact and precedes traversal/checksum work', () => {
  const bytes = indexBytes({ entries: [{ path: 'a' }] });
  assert.equal(bytes.byteLength, 96);
  assert.equal(decodeGitIndexGeneration(bytes, 'sha1', { maxRawBytes: 96 }).entries.length, 1);
  assert.throws(() => decodeGitIndexGeneration(bytes, 'sha1', { maxRawBytes: 95 }), over('maxRawBytes'));
  const hugeHeader = Buffer.alloc(32); hugeHeader.write('DIRC'); hugeHeader.writeUInt32BE(2, 4); hugeHeader.writeUInt32BE(0xffffffff, 8);
  assert.throws(() => decodeGitIndexGeneration(hugeHeader, 'sha1', { maxEntries: 1 }), over('maxEntries'));
  assert.throws(() => resolveGitIndexPlanningBudget({ maxExpandedPathBytes: Number.MAX_SAFE_INTEGER }));
  assert.throws(() => resolveGitIndexPlanningBudget({ maxEntries: Number.NaN }));
  const empty = decodeGitIndexGeneration(indexBytes({ entries: [] }), 'sha1', { maxEntries: 0, maxExpandedPathBytes: 0 });
  assert.equal(empty.entries.length, 0);
  assert.equal(encodeGitIndexGeneration(empty).byteLength, 32);
});

test('v4 admission charges retained prefixes and cumulative expansion', () => {
  const bytes = indexBytes({ version: 4, entries: [
    { path: 'abcd/a', suffix: 'abcd/a', remove: [0] },
    { path: 'abcd/b', suffix: 'b', remove: [1] },
    { path: 'abcd/c', suffix: 'c', remove: [1] }
  ] });
  assert.equal(bytes.byteLength, 232);
  const decoded = decodeGitIndexGeneration(bytes, 'sha1', { maxExpandedPathBytes: 18 });
  assert.deepEqual(decoded.entries.map(entry => Buffer.from(entry.pathHex, 'hex').toString()), ['abcd/a', 'abcd/b', 'abcd/c']);
  assert.throws(() => decodeGitIndexGeneration(bytes, 'sha1', { maxExpandedPathBytes: 17 }), over('maxExpandedPathBytes'));
  const v2 = indexBytes({ entries: [{ path: 'ab' }] });
  assert.equal(decodeGitIndexGeneration(v2, 'sha1', { maxExpandedPathBytes: 2 }).entries.length, 1);
  assert.throws(() => decodeGitIndexGeneration(v2, 'sha1', { maxExpandedPathBytes: 1 }), over('maxExpandedPathBytes'));
  const unsafe = indexBytes({ version: 4, entries: [{ path: 'a', remove: [...Array(8).fill(0xff), 0x7f] }] });
  assert.throws(() => decodeGitIndexGeneration(unsafe, 'sha1'), /safe range/);
});

test('projected NEXT admits resulting membership without double-crediting removals', () => {
  const before = decodeGitIndexGeneration(indexBytes({ entries: [{ path: 'a' }, { path: 'keep' }] }), 'sha1');
  const add = (path: string) => ({ path, objectId: '22'.repeat(20) });
  const delta = { removals: ['a'], additions: [add('nested/new')] };
  const after = applyGitIndexObjectDelta(before, delta, { maxExpandedPathBytes: 14, maxEntries: 2 });
  assert.deepEqual(after.entries.map(entry => Buffer.from(entry.pathHex, 'hex').toString()), ['keep', 'nested/new']);
  assert.throws(() => applyGitIndexObjectDelta(before, delta, { maxExpandedPathBytes: 13 }), over('maxExpandedPathBytes'));
  assert.throws(() => applyGitIndexObjectDelta(before, { removals: [], additions: [add('b')] }, { maxEntries: 2 }), over('maxEntries'));
  assert.equal(applyGitIndexObjectDelta(before, { removals: [], additions: [add('keep')] }, { maxEntries: 2, maxExpandedPathBytes: 5 }).entries.length, 2);
  assert.throws(() => applyGitIndexObjectDelta(before, { removals: ['a', 'a'], additions: [add('zzzzzz')] }, { maxExpandedPathBytes: 9 }), over('maxExpandedPathBytes'));
});

test('unsupported index and native object domains fail closed', () => {
  for (const extension of ['link', 'sdir', 'TEST', 'R\u00c5UC']) {
    assert.throws(() => decodeGitIndexGeneration(indexBytes({ entries: [], extension }), 'sha1'), /unsupported|semantics/);
  }
  assert.throws(() => decodeGitIndexGeneration(indexBytes({ entries: [{ path: 'a', flags: 0x1001 }] }), 'sha1'), /unmerged/);
  for (const entry of [{ path: 'a', oid: '00'.repeat(20) }, { path: 'a', extended: 0x2000 }]) {
    const generation = decodeGitIndexGeneration(indexBytes({ version: 3, entries: [entry] }), 'sha1');
    assert.throws(() => assertGitIndexTreeGeneration(generation), /intent-to-add/);
  }
  const skip = decodeGitIndexGeneration(indexBytes({ version: 3, entries: [{ path: 'a', extended: 0x4000 }] }), 'sha1');
  assert.doesNotThrow(() => assertGitIndexTreeGeneration(skip));
  const oid = 'ab'.repeat(20);
  for (const mode of [0o100644, 0o100755, 0o120000]) {
    assert.doesNotThrow(() => assertGitIndexObjectInfoBatch([{ mode, objectId: oid }], Buffer.from(`${oid} blob 1\n`)));
    for (const reply of [`${oid} missing\n`, `${oid} commit 1\n`, `${oid} tree 1\n`, `${oid} blob 1\nextra\n`]) {
      assert.throws(() => assertGitIndexObjectInfoBatch([{ mode, objectId: oid }], Buffer.from(reply)));
    }
  }
  const gitlink = [{ mode: 0o160000, objectId: oid }];
  for (const reply of [`${oid} missing\n`, `${oid} commit 1\n`]) {
    assert.doesNotThrow(() => assertGitIndexObjectInfoBatch(gitlink, Buffer.from(reply)));
  }
  assert.throws(() => assertGitIndexObjectInfoBatch(gitlink, Buffer.from(`${oid} blob 1\n`)));
  assert.throws(() => assertGitIndexObjectInfoBatch(gitlink, Buffer.from(`${'cd'.repeat(20)} commit 1\n`)));
});

test('caller array iterators cannot expand the admitted generation or object delta', () => {
  const generation = decodeGitIndexGeneration(indexBytes({ entries: [{ path: 'a' }] }), 'sha1');
  const entries = [...generation.entries];
  entries[Symbol.iterator] = () => { throw new Error('unadmitted generation iterator'); };
  assert.equal(decodeGitIndexGeneration(encodeGitIndexGeneration({ ...generation, entries }), 'sha1').entries.length, 1);
  const additions = [{ path: 'b', objectId: '22'.repeat(20) }];
  additions[Symbol.iterator] = () => { throw new Error('unadmitted delta iterator'); };
  assert.equal(applyGitIndexObjectDelta(generation, { additions, removals: [] }).entries.length, 2);
});

test('separator-first conflict admission defeats lexical interleaving before reading blobs', () => {
  for (const paths of [['a', 'a-', 'a/b'], ['a/b', 'a-', 'a'], ['x/y', 'x/y-', 'x/y/z']]) {
    let reads = 0;
    const additions = paths.map(path => ({ path, get bytes() { reads++; return Uint8Array.of(1); } }));
    assert.throws(() => captureGitScratchIndexDelta({ additions, removals: [] }, 'sha1', 4096), /file\/directory conflict/);
    assert.equal(reads, 0);
  }
});

test('projected admission and blob capture consume each caller field once', () => {
  let pathReads = 0, blobReads = 0;
  const addition = {
    get path() { pathReads++; return pathReads === 1 ? 'a' : '../changed'; },
    get bytes() { blobReads++; return Uint8Array.of(1, 2); }
  };
  const captured = captureGitScratchIndexDelta({ additions: [addition], removals: [] }, 'sha1', 4096);
  assert.equal(pathReads, 1); assert.equal(blobReads, 1);
  assert.equal(captured.additions[0]!.path, 'a');
  assert.deepEqual([...captured.additions[0]!.bytes], [1, 2]);
});


test('resolve-undo metadata round-trips exactly with bounded canonical framing', () => {
  for (const format of ['sha1', 'sha256'] as const) {
    const oid = Buffer.alloc(format === 'sha1' ? 20 : 32, 0x11);
    const payload = Buffer.concat([Buffer.from('conflict\x00100644\x000\x00120777\x00'), oid, oid]);
    const valid = Buffer.concat([Buffer.from('conflict\x00100644\x000\x00120000\x00'), oid, oid]);
    const fixture = (body: Buffer) => indexBytes({ version: 3, format, entries: [{ path: 'a' }], extension: 'REUC', extensionPayload: body });
    const bytes = fixture(valid);
    const decoded = decodeGitIndexGeneration(bytes, format);
    assert.equal(decoded.resolveUndoHex, valid.toString('hex'));
    assert.deepEqual(encodeGitIndexGeneration(decoded), bytes);
    const changed = applyGitIndexObjectDelta(decoded, { removals: [], additions: [{ path: 'conflict', objectId: oid.toString('hex') }] });
    assert.equal(decodeGitIndexGeneration(encodeGitIndexGeneration(changed), format).resolveUndoHex, decoded.resolveUndoHex);
    assert.throws(() => decodeGitIndexGeneration(bytes, format, { maxEntries: 1 }), over('maxEntries'));
    assert.throws(() => decodeGitIndexGeneration(bytes, format, { maxExpandedPathBytes: 8 }), over('maxExpandedPathBytes'));
    assert.throws(() => encodeGitIndexGeneration(decoded, { maxRawBytes: bytes.length - 1 }), over('maxRawBytes'));
    assert.throws(() => applyGitIndexObjectDelta(decoded, { additions: [{ path: 'b', objectId: oid.toString('hex') }], removals: [] }, { maxEntries: 2 }), over('maxEntries'));
    for (const invalid of [payload, valid.subarray(0, -1), Buffer.concat([valid, valid]),
      Buffer.from('conflict\x000\x000\x000\x00'), Buffer.from('unterminated'),
      Buffer.concat([Buffer.from('../escape\x00100644\x000\x000\x00'), oid]),
      Buffer.concat([Buffer.from('conflict\x00100644\x000\x000\x00'), Buffer.alloc(oid.length)])]) {
      assert.throws(() => decodeGitIndexGeneration(fixture(invalid), format));
    }
    const duplicateHeader = Buffer.alloc(8); duplicateHeader.write('REUC');
    const duplicateBody = Buffer.concat([bytes.subarray(0, -oid.length), duplicateHeader]);
    assert.throws(() => decodeGitIndexGeneration(Buffer.concat([duplicateBody, createHash(format).update(duplicateBody).digest()]), format), /duplicate resolve-undo/);
  }
});
