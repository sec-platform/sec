import { createHash } from 'node:crypto';

import { borrowByteView } from '../../../../contracts/byte-snapshot.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';
import { admitGitIndexPlanningTotal as admittedTotal, resolveGitIndexPlanningBudget, type GitIndexPlanningBudget } from './budget.ts';

export { GitIndexPlanningBudgetError } from './budget.ts';

export type GitIndexObjectFormat = 'sha1' | 'sha256';

type GitIndexGenerationEntry = Readonly<{
  readonly statHex: string;
  readonly mode: number;
  readonly objectId: string;
  readonly assumeValid: boolean;
  readonly extendedFlags: number;
  readonly pathHex: string;
}>;

export type GitIndexGeneration = Readonly<{
  readonly objectFormat: GitIndexObjectFormat;
  readonly entries: readonly GitIndexGenerationEntry[];
  /** Protected conflict recovery metadata; never treated as a disposable cache. */
  readonly resolveUndoHex?: string;
}>;

export type GitIndexObjectDelta = Readonly<{
  readonly additions: readonly Readonly<{ path: string; objectId: string }>[];
  readonly removals: readonly string[];
}>;

function ownIndexArrayEntry<T>(entries: readonly T[], index: number): T {
  const entry = Object.getOwnPropertyDescriptor(entries, String(index));
  if (entry === undefined || !('value' in entry)) throw new Error('Git index planning requires own data entries.');
  return entry.value;
}

const DISCARDABLE_INDEX_EXTENSIONS = new Set(['TREE', 'UNTR', 'FSMN', 'EOIE', 'IEOT']);
const SUPPORTED_MODES = new Set([0o100644, 0o100755, 0o120000, 0o160000]);

function objectIdBytes(format: GitIndexObjectFormat): number {
  if (format !== 'sha1' && format !== 'sha256') throw new Error('Git index object format is unsupported.');
  return format === 'sha1' ? 20 : 32;
}

function objectIdPattern(format: GitIndexObjectFormat): RegExp {
  return format === 'sha1' ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u;
}

function readV4RemoveCount(bytes: Buffer, offset: number, limit: number): Readonly<{
  readonly value: number;
  readonly offset: number;
}> {
  if (offset >= limit) throw new Error('Git index v4 pathname prefix is truncated.');
  let octet = bytes[offset]!;
  let value = octet & 0x7f;
  offset += 1;
  while ((octet & 0x80) !== 0) {
    if (offset >= limit) throw new Error('Git index v4 pathname prefix is truncated.');
    octet = bytes[offset]!;
    value = (value + 1) * 128 + (octet & 0x7f);
    if (!Number.isSafeInteger(value)) throw new Error('Git index v4 pathname prefix exceeds the safe range.');
    offset += 1;
  }
  return Object.freeze({ value, offset });
}

function* splitPathBytes(pathBytes: Buffer): Generator<Readonly<{ part: Buffer; last: boolean }>> {
  if (pathBytes.byteLength === 0 || pathBytes[0] === 0x2f || pathBytes.at(-1) === 0x2f) {
    throw new Error('Git index path is empty or has a leading/trailing separator.');
  }
  let start = 0;
  for (let offset = 0; offset <= pathBytes.byteLength; offset += 1) {
    if (offset !== pathBytes.byteLength && pathBytes[offset] !== 0x2f) continue;
    if (offset === start) throw new Error('Git index path contains an empty component.');
    const part = pathBytes.subarray(start, offset);
    if ((part.byteLength === 1 && part[0] === 0x2e)
        || (part.byteLength === 2 && part[0] === 0x2e && part[1] === 0x2e)
        || part.equals(Buffer.from('.git', 'ascii'))) {
      throw new Error('Git index path contains a forbidden component.');
    }
    yield { part, last: offset === pathBytes.byteLength };
    start = offset + 1;
  }
}

function validateDenseEntry(entry: GitIndexGenerationEntry, format: GitIndexObjectFormat): void {
  if (typeof entry.statHex !== 'string' || entry.statHex.length !== 80 || !/^[0-9a-f]{80}$/u.test(entry.statHex)
      || !SUPPORTED_MODES.has(entry.mode)
      || !objectIdPattern(format).test(entry.objectId)
      || typeof entry.pathHex !== 'string' || entry.pathHex.length === 0
      || entry.pathHex.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(entry.pathHex)
      || !Number.isSafeInteger(entry.extendedFlags)
      || entry.extendedFlags < 0
      || (entry.extendedFlags & ~0x6000) !== 0) {
    throw new Error('Git index entry is outside the supported dense generation domain.');
  }
  for (const _part of splitPathBytes(Buffer.from(entry.pathHex, 'hex'))) { /* Validate without retaining a parts array. */ }
}

function validateResolveUndo(
  bytes: Buffer, format: GitIndexObjectFormat, budget: GitIndexPlanningBudget,
  entryCount: number, pathBytes: number
): Readonly<{ entryCount: number; pathBytes: number }> {
  const oidWidth = objectIdBytes(format);
  let offset = 0;
  let previousPath: Buffer | undefined;
  while (offset < bytes.length) {
    entryCount = admittedTotal(entryCount, 1, budget.maxEntries, 'maxEntries');
    const end = bytes.indexOf(0, offset);
    if (end < 0) throw new Error('Git resolve-undo path is unterminated.');
    pathBytes = admittedTotal(pathBytes, end - offset, budget.maxExpandedPathBytes, 'maxExpandedPathBytes');
    const name = bytes.subarray(offset, end);
    for (const _part of splitPathBytes(name)) { /* Same raw pathname domain as index entries. */ }
    if (previousPath !== undefined && Buffer.compare(previousPath, name) >= 0) {
      throw new Error('Git resolve-undo paths must be unique and byte-sorted.');
    }
    previousPath = name;
    offset = end + 1;
    let objectCount = 0;
    for (let stage = 0; stage < 3; stage++) {
      const modeEnd = bytes.indexOf(0, offset);
      if (modeEnd < 0 || modeEnd - offset > 6) throw new Error('Git resolve-undo mode is truncated.');
      const mode = bytes.subarray(offset, modeEnd).toString('latin1');
      if (!/^(?:0|100644|100755|120000|160000)$/u.test(mode)) throw new Error('Git resolve-undo mode is unsupported.');
      if (mode !== '0') objectCount++;
      offset = modeEnd + 1;
    }
    if (objectCount === 0 || offset + objectCount * oidWidth > bytes.length) {
      throw new Error('Git resolve-undo stage identities are absent or truncated.');
    }
    for (let stage = 0; stage < objectCount; stage++) {
      if (bytes.subarray(offset, offset + oidWidth).every(value => value === 0)) {
        throw new Error('Git resolve-undo stage identity is null.');
      }
      offset += oidWidth;
    }
  }
  return { entryCount, pathBytes };
}

function sortEntries(entries: readonly GitIndexGenerationEntry[]): readonly GitIndexGenerationEntry[] {
  // Hex preserves byte ordering; compare immutable strings instead of copying
  // both pathname buffers on every comparison.
  const sorted = [...entries].sort((left, right) => left.pathHex < right.pathHex ? -1
    : left.pathHex > right.pathHex ? 1 : 0);
  // Slash-first comparison places a file beside any descendant even when
  // an ordinary byte such as '-' sorts before '/' in native pathname order.
  const conflictOrder = sorted.map(entry => ({ path: entry.pathHex,
    key: entry.pathHex.replace(/../gu, octet => octet === '2f' ? '!' : octet) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  for (let index = 1; index < conflictOrder.length; index++) {
    const previous = conflictOrder[index - 1]!.path, current = conflictOrder[index]!.path;
    if (previous === current || current.startsWith(`${previous}2f`)) {
      throw new Error('Git index contains a duplicate or file/directory path conflict.');
    }
  }
  return Object.freeze(sorted.map((entry) => Object.freeze({ ...entry })));
}

function captureGeneration(
  input: GitIndexGeneration,
  budget: GitIndexPlanningBudget
): Readonly<{ generation: GitIndexGeneration; expandedPathBytes: number; resolveUndoEntries: number }> {
  const objectFormat = input.objectFormat;
  objectIdBytes(objectFormat);
  const resolveUndoHex = input.resolveUndoHex;
  const sourceEntries = input.entries;
  if (!Array.isArray(sourceEntries)) throw new Error('Git index generation entries must be an array.');
  const entryCount = admittedTotal(0, sourceEntries.length, budget.maxEntries, 'maxEntries');
  let expandedPathBytes = 0;
  const entries: GitIndexGenerationEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const source = ownIndexArrayEntry(sourceEntries, index);
    const { pathHex, statHex, mode, objectId, assumeValid, extendedFlags } = source;
    if (typeof pathHex !== 'string' || pathHex.length % 2 !== 0) {
      throw new Error('Git index path must be complete hexadecimal bytes.');
    }
    expandedPathBytes = admittedTotal(
      expandedPathBytes, pathHex.length / 2, budget.maxExpandedPathBytes, 'maxExpandedPathBytes'
    );
    const entry = Object.freeze({ pathHex, statHex, mode, objectId, assumeValid, extendedFlags });
    if (typeof objectId !== 'string' || typeof assumeValid !== 'boolean') {
      throw new Error('Git index entry has invalid object identity or flags.');
    }
    validateDenseEntry(entry, objectFormat);
    entries.push(entry);
  }
  let resolveUndoEntries = 0;
  if (resolveUndoHex !== undefined) {
    if (typeof resolveUndoHex !== 'string' || resolveUndoHex.length % 2 !== 0) throw new Error('Git resolve-undo payload must be hexadecimal bytes.');
    admittedTotal(8, resolveUndoHex.length / 2, budget.maxRawBytes, 'maxRawBytes');
    if (!/^[0-9a-f]*$/u.test(resolveUndoHex)) throw new Error('Git resolve-undo payload must be hexadecimal bytes.');
    const totals = validateResolveUndo(Buffer.from(resolveUndoHex, 'hex'), objectFormat, budget, entryCount, expandedPathBytes);
    resolveUndoEntries = totals.entryCount - entryCount;
    expandedPathBytes = totals.pathBytes;
  }
  return Object.freeze({
    generation: Object.freeze({ objectFormat, entries: Object.freeze(entries),
      ...(resolveUndoHex === undefined ? {} : { resolveUndoHex }) }), expandedPathBytes, resolveUndoEntries
  });
}

export function decodeGitIndexGeneration(
  input: Uint8Array,
  objectFormat: GitIndexObjectFormat,
  limits?: Partial<GitIndexPlanningBudget>
): GitIndexGeneration {
  const budget = resolveGitIndexPlanningBudget(limits);
  const source = borrowByteView(input, 'Git index generation');
  admittedTotal(0, source.byteLength, budget.maxRawBytes, 'maxRawBytes');
  const hashBytes = objectIdBytes(objectFormat);
  // Inspect the fixed header through an ordinary borrowed view before the
  // full-input copy or any entry-sized allocation.
  if (source.byteLength < 12 + hashBytes) throw new Error('Git index header is absent or truncated.');
  const header = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  admittedTotal(0, header.readUInt32BE(8), budget.maxEntries, 'maxEntries');
  const bytes = Buffer.from(source);
  if (bytes.byteLength < 12 + hashBytes
      || bytes.subarray(0, 4).toString('ascii') !== 'DIRC') {
    throw new Error('Git index header is absent or truncated.');
  }
  const version = bytes.readUInt32BE(4);
  if (version !== 2 && version !== 3 && version !== 4) {
    throw new Error(`Git index version ${version} is unsupported.`);
  }
  const entryCount = bytes.readUInt32BE(8);
  const contentEnd = bytes.byteLength - hashBytes;
  const expectedChecksum = bytes.subarray(contentEnd);
  const observedChecksum = createHash(objectFormat).update(bytes.subarray(0, contentEnd)).digest();
  if (!observedChecksum.equals(expectedChecksum)) {
    throw new Error('Git index checksum does not match its retained bytes.');
  }

  const entries: GitIndexGenerationEntry[] = [];
  let offset = 12;
  let previousPath: Buffer = Buffer.alloc(0);
  let expandedPathBytes = 0;
  const oidBytes = objectIdBytes(objectFormat);
  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = offset;
    const fixedBytes = 40 + oidBytes + 2;
    if (offset + fixedBytes > contentEnd) throw new Error('Git index entry is truncated.');
    const stat = Buffer.from(bytes.subarray(offset, offset + 40));
    const mode = stat.readUInt32BE(24);
    offset += 40;
    const objectId = bytes.subarray(offset, offset + oidBytes).toString('hex');
    offset += oidBytes;
    const flags = bytes.readUInt16BE(offset);
    offset += 2;
    const assumeValid = (flags & 0x8000) !== 0;
    const extended = (flags & 0x4000) !== 0;
    const stage = (flags >>> 12) & 0x3;
    const encodedNameLength = flags & 0x0fff;
    if (version === 2 && extended) throw new Error('Git index v2 entry carries extended flags.');
    let extendedFlags = 0;
    if (extended) {
      if (offset + 2 > contentEnd) throw new Error('Git index extended flags are truncated.');
      extendedFlags = bytes.readUInt16BE(offset);
      offset += 2;
      if ((extendedFlags & ~0x6000) !== 0) throw new Error('Git index extended flags use reserved bits.');
    }
    if (stage !== 0) throw new Error('Git scratch tree generation rejects an unmerged index.');

    let pathBytes: Buffer;
    if (version === 4) {
      const prefix = readV4RemoveCount(bytes, offset, contentEnd);
      offset = prefix.offset;
      const terminator = bytes.indexOf(0, offset);
      if (terminator < 0 || terminator >= contentEnd || prefix.value > previousPath.byteLength) {
        throw new Error('Git index v4 pathname encoding is invalid.');
      }
      const suffix = bytes.subarray(offset, terminator);
      const expandedLength = admittedTotal(
        previousPath.byteLength - prefix.value, suffix.byteLength,
        budget.maxExpandedPathBytes, 'maxExpandedPathBytes'
      );
      expandedPathBytes = admittedTotal(
        expandedPathBytes, expandedLength, budget.maxExpandedPathBytes, 'maxExpandedPathBytes'
      );
      pathBytes = Buffer.concat([
        previousPath.subarray(0, previousPath.byteLength - prefix.value),
        suffix
      ]);
      offset = terminator + 1;
    } else {
      const terminator = bytes.indexOf(0, offset);
      if (terminator < 0 || terminator >= contentEnd) throw new Error('Git index pathname is unterminated.');
      expandedPathBytes = admittedTotal(
        expandedPathBytes, terminator - offset, budget.maxExpandedPathBytes, 'maxExpandedPathBytes'
      );
      pathBytes = Buffer.from(bytes.subarray(offset, terminator));
      offset = terminator + 1;
      const consumed = offset - entryStart;
      const padding = (8 - (consumed % 8)) % 8;
      if (offset + padding > contentEnd
          || bytes.subarray(offset, offset + padding).some((value) => value !== 0)) {
        throw new Error('Git index entry padding is invalid.');
      }
      offset += padding;
    }
    if (encodedNameLength !== 0x0fff && encodedNameLength !== pathBytes.byteLength) {
      throw new Error('Git index pathname length flag does not match the retained path.');
    }
    previousPath = pathBytes;
    entries.push(Object.freeze({
      statHex: stat.toString('hex'),
      mode,
      objectId,
      assumeValid,
      extendedFlags,
      pathHex: pathBytes.toString('hex')
    }));
  }

  let resolveUndoHex: string | undefined;
  while (offset < contentEnd) {
    if (offset + 8 > contentEnd) throw new Error('Git index extension header is truncated.');
    const signatureBytes = bytes.subarray(offset, offset + 4);
    const signature = signatureBytes.toString('latin1');
    const size = bytes.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > contentEnd) throw new Error('Git index extension payload is truncated.');
    if (signatureBytes[0]! < 0x41 || signatureBytes[0]! > 0x5a) {
      throw new Error(`Git index mandatory extension ${signature} is unsupported.`);
    }
    if (signature === 'REUC') {
      if (resolveUndoHex !== undefined) throw new Error('Git index contains duplicate resolve-undo extensions.');
      const payload = bytes.subarray(offset, offset + size);
      validateResolveUndo(payload, objectFormat, budget, entryCount, expandedPathBytes);
      resolveUndoHex = payload.toString('hex');
    } else if (!DISCARDABLE_INDEX_EXTENSIONS.has(signature)) {
      throw new Error(`Git index optional extension ${signature} has semantics this owner does not discard.`);
    }
    offset += size;
  }
  if (offset !== contentEnd) throw new Error('Git index extension framing did not settle at the checksum.');

  for (const entry of entries) validateDenseEntry(entry, objectFormat);
  return Object.freeze({
    objectFormat,
    entries: sortEntries(entries),
    ...(resolveUndoHex === undefined ? {} : { resolveUndoHex })
  });
}

function canonicalEntryFlags(entry: GitIndexGenerationEntry): number {
  const pathLength = Buffer.from(entry.pathHex, 'hex').byteLength;
  return (entry.assumeValid ? 0x8000 : 0)
    | (entry.extendedFlags !== 0 ? 0x4000 : 0)
    | Math.min(pathLength, 0x0fff);
}

function measureEncodedIndexGeneration(generation: GitIndexGeneration, budget: GitIndexPlanningBudget): number {
  const oidBytes = objectIdBytes(generation.objectFormat);
  let encodedBytes = admittedTotal(12, oidBytes, budget.maxRawBytes, 'maxRawBytes');
  for (const entry of generation.entries) {
    const bodyBytes = 40 + oidBytes + (entry.extendedFlags === 0 ? 2 : 4) + entry.pathHex.length / 2 + 1;
    encodedBytes = admittedTotal(
      encodedBytes, bodyBytes + (8 - bodyBytes % 8) % 8, budget.maxRawBytes, 'maxRawBytes'
    );
  }
  if (generation.resolveUndoHex !== undefined) {
    encodedBytes = admittedTotal(encodedBytes, 8 + generation.resolveUndoHex.length / 2, budget.maxRawBytes, 'maxRawBytes');
  }
  return encodedBytes;
}

export function encodeGitIndexGeneration(
  generation: GitIndexGeneration,
  limits?: Partial<GitIndexPlanningBudget>
): Buffer {
  const budget = resolveGitIndexPlanningBudget(limits);
  generation = captureGeneration(generation, budget).generation;
  measureEncodedIndexGeneration(generation, budget);
  const { objectFormat } = generation;
  const entries = sortEntries(generation.entries);
  const oidBytes = objectIdBytes(objectFormat);
  const header = Buffer.alloc(12);
  header.write('DIRC', 0, 4, 'ascii');
  header.writeUInt32BE(3, 4);
  header.writeUInt32BE(entries.length, 8);
  const chunks: Buffer[] = [header];
  for (const entry of entries) {
    const stat = Buffer.from(entry.statHex, 'hex');
    const oid = Buffer.from(entry.objectId, 'hex');
    if (oid.byteLength !== oidBytes) throw new Error('Git index object id width is invalid.');
    const pathBytes = Buffer.from(entry.pathHex, 'hex');
    const flags = Buffer.alloc(entry.extendedFlags === 0 ? 2 : 4);
    flags.writeUInt16BE(canonicalEntryFlags(entry), 0);
    if (entry.extendedFlags !== 0) flags.writeUInt16BE(entry.extendedFlags, 2);
    const body = Buffer.concat([stat, oid, flags, pathBytes, Buffer.from([0])]);
    const padding = (8 - (body.byteLength % 8)) % 8;
    chunks.push(padding === 0 ? body : Buffer.concat([body, Buffer.alloc(padding)]));
  }
  if (generation.resolveUndoHex !== undefined) {
    const payload = Buffer.from(generation.resolveUndoHex, 'hex');
    const extension = Buffer.alloc(8); extension.write('REUC'); extension.writeUInt32BE(payload.length, 4);
    chunks.push(extension, payload);
  }
  const content = Buffer.concat(chunks);
  const checksum = createHash(objectFormat).update(content).digest();
  return Buffer.concat([content, checksum]);
}

function newRegularEntry(path: string, objectId: string, objectFormat: GitIndexObjectFormat): GitIndexGenerationEntry {
  if (!CodexDevelopmentIsCanonicalRepositoryPath(path) || !objectIdPattern(objectFormat).test(objectId)) {
    throw new Error('Git index delta addition is not canonical.');
  }
  const stat = Buffer.alloc(40);
  stat.writeUInt32BE(0o100644, 24);
  return Object.freeze({
    statHex: stat.toString('hex'),
    mode: 0o100644,
    objectId,
    assumeValid: false,
    extendedFlags: 0,
    pathHex: Buffer.from(path, 'utf8').toString('hex')
  });
}

export function applyGitIndexObjectDelta(
  generation: GitIndexGeneration,
  delta: GitIndexObjectDelta,
  limits?: Partial<GitIndexPlanningBudget>
): GitIndexGeneration {
  const budget = resolveGitIndexPlanningBudget(limits);
  const captured = captureGeneration(generation, budget);
  generation = captured.generation;
  const { additions, removals } = delta;
  if (!Array.isArray(additions) || !Array.isArray(removals)) {
    throw new Error('Git index delta additions and removals must be arrays.');
  }
  const additionCount = admittedTotal(0, additions.length, budget.maxEntries, 'maxEntries');
  const removalCount = admittedTotal(0, removals.length, budget.maxEntries, 'maxEntries');
  let expandedPathBytes = captured.expandedPathBytes;
  let deltaPathBytes = 0;
  const entries = new Map(generation.entries.map((entry) => [entry.pathHex, entry] as const));
  for (let index = 0; index < removalCount; index += 1) {
    const path = ownIndexArrayEntry(removals, index);
    if (typeof path !== 'string') throw new Error('Git index delta removal path must be a string.');
    deltaPathBytes = admittedTotal(
      deltaPathBytes, Buffer.byteLength(path, 'utf8'), budget.maxExpandedPathBytes, 'maxExpandedPathBytes'
    );
    if (!CodexDevelopmentIsCanonicalRepositoryPath(path)) throw new Error('Git index delta removal path is invalid.');
    const key = Buffer.from(path, 'utf8').toString('hex');
    const previous = entries.get(key);
    if (previous !== undefined) expandedPathBytes -= previous.pathHex.length / 2;
    entries.delete(key);
  }
  for (let index = 0; index < additionCount; index += 1) {
    const addition = ownIndexArrayEntry(additions, index);
    const { path, objectId } = addition;
    if (typeof path !== 'string') throw new Error('Git index delta addition path must be a string.');
    const pathBytes = Buffer.byteLength(path, 'utf8');
    deltaPathBytes = admittedTotal(
      deltaPathBytes, pathBytes, budget.maxExpandedPathBytes, 'maxExpandedPathBytes'
    );
    const key = Buffer.from(path, 'utf8').toString('hex');
    const previous = entries.get(key);
    admittedTotal(entries.size + captured.resolveUndoEntries, previous === undefined ? 1 : 0, budget.maxEntries, 'maxEntries');
    expandedPathBytes = admittedTotal(
      expandedPathBytes - (previous?.pathHex.length ?? 0) / 2,
      pathBytes, budget.maxExpandedPathBytes, 'maxExpandedPathBytes'
    );
    const entry = newRegularEntry(path, objectId, generation.objectFormat);
    entries.set(entry.pathHex, entry);
  }
  return Object.freeze({
    objectFormat: generation.objectFormat,
    entries: sortEntries([...entries.values()]),
    ...(generation.resolveUndoHex === undefined ? {} : { resolveUndoHex: generation.resolveUndoHex })
  });
}

/** Native write-tree omits intent-to-add and can trust cached trees. Only the
 * dense, non-null stage-zero domain is admitted before preparing its private
 * cache-free index with protected resolve-undo metadata. */
export function assertGitIndexTreeGeneration(generation: GitIndexGeneration): void {
  for (const entry of generation.entries) {
    validateDenseEntry(entry, generation.objectFormat);
    if (/^0+$/u.test(entry.objectId) || (entry.extendedFlags & 0x2000) !== 0) {
      throw new Error('Git tree generation rejects intent-to-add or null object identities.');
    }
  }
}

/** Exact native cat-file metadata, including Git's missing-gitlink exception.
 * This validates types; write-tree alone only checks ordinary object existence. */
export function assertGitIndexObjectInfoBatch(
  entries: readonly Readonly<{ objectId: string; mode: number }>[], output: Uint8Array
): void {
  const bytes = Buffer.from(output);
  let offset = 0;
  for (const entry of entries) {
    const end = bytes.indexOf(0x0a, offset);
    if (end < 0) throw new Error('Git index object metadata is incomplete.');
    const line = bytes.subarray(offset, end).toString('utf8');
    offset = end + 1;
    if (entry.mode === 0o160000 && line === `${entry.objectId} missing`) continue;
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|commit) (0|[1-9][0-9]{0,19})$/u.exec(line);
    if (match === null || match[1] !== entry.objectId
        || match[2] !== (entry.mode === 0o160000 ? 'commit' : 'blob')) {
      throw new Error('Git index object metadata has a missing or wrong-type entry.');
    }
  }
  if (offset !== bytes.length) throw new Error('Git index object metadata has trailing output.');
}
