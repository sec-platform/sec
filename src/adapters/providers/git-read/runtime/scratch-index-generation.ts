import { createHash } from 'node:crypto';

import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';

export type GitIndexObjectFormat = 'sha1' | 'sha256';

export type GitIndexGenerationEntry = Readonly<{
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
}>;

export type GitIndexObjectDelta = Readonly<{
  readonly additions: readonly Readonly<{ path: string; objectId: string }>[];
  readonly removals: readonly string[];
}>;

type MutableTreeNode = {
  key: string;
  depth: number;
  nameHex: string | null;
  leaves: Map<string, GitIndexGenerationEntry>;
  children: Map<string, MutableTreeNode>;
};

export type GitMktreeDirectoryPlan = Readonly<{
  readonly key: string;
  readonly leaves: readonly Readonly<{
    readonly mode: number;
    readonly objectId: string;
    readonly nameHex: string;
  }>[];
  readonly children: readonly Readonly<{
    readonly key: string;
    readonly nameHex: string;
  }>[];
}>;

export type GitMktreePlan = Readonly<{
  readonly levels: readonly (readonly GitMktreeDirectoryPlan[])[];
  readonly rootKey: string;
}>;

const DISCARDABLE_INDEX_EXTENSIONS = new Set(['TREE', 'UNTR', 'FSMN', 'EOIE', 'IEOT']);
const SUPPORTED_MODES = new Set([0o100644, 0o100755, 0o120000, 0o160000]);

function objectIdBytes(format: GitIndexObjectFormat): number {
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

function splitPathBytes(pathBytes: Buffer): readonly Buffer[] {
  if (pathBytes.byteLength === 0 || pathBytes[0] === 0x2f || pathBytes.at(-1) === 0x2f) {
    throw new Error('Git index path is empty or has a leading/trailing separator.');
  }
  const parts: Buffer[] = [];
  let start = 0;
  for (let offset = 0; offset <= pathBytes.byteLength; offset += 1) {
    if (offset !== pathBytes.byteLength && pathBytes[offset] !== 0x2f) continue;
    if (offset === start) throw new Error('Git index path contains an empty component.');
    const part = Buffer.from(pathBytes.subarray(start, offset));
    if ((part.byteLength === 1 && part[0] === 0x2e)
        || (part.byteLength === 2 && part[0] === 0x2e && part[1] === 0x2e)
        || part.equals(Buffer.from('.git', 'ascii'))) {
      throw new Error('Git index path contains a forbidden component.');
    }
    parts.push(part);
    start = offset + 1;
  }
  return Object.freeze(parts);
}

function validateDenseEntry(entry: GitIndexGenerationEntry, format: GitIndexObjectFormat): void {
  if (entry.statHex.length !== 80 || !/^[0-9a-f]{80}$/u.test(entry.statHex)
      || !SUPPORTED_MODES.has(entry.mode)
      || !objectIdPattern(format).test(entry.objectId)
      || !/^(?:[0-9a-f]{2})+$/u.test(entry.pathHex)
      || entry.pathHex.length === 0
      || !Number.isSafeInteger(entry.extendedFlags)
      || entry.extendedFlags < 0
      || (entry.extendedFlags & ~0x6000) !== 0) {
    throw new Error('Git index entry is outside the supported dense generation domain.');
  }
  splitPathBytes(Buffer.from(entry.pathHex, 'hex'));
}

function sortEntries(entries: readonly GitIndexGenerationEntry[]): readonly GitIndexGenerationEntry[] {
  const sorted = [...entries].sort((left, right) => {
    const paths = Buffer.compare(Buffer.from(left.pathHex, 'hex'), Buffer.from(right.pathHex, 'hex'));
    return paths;
  });
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = Buffer.from(sorted[index - 1]!.pathHex, 'hex');
    const current = Buffer.from(sorted[index]!.pathHex, 'hex');
    if (previous.equals(current)) throw new Error('Git index contains duplicate stage-zero paths.');
    if (current.byteLength > previous.byteLength
        && current.subarray(0, previous.byteLength).equals(previous)
        && current[previous.byteLength] === 0x2f) {
      throw new Error('Git index contains a file/directory path conflict.');
    }
  }
  return Object.freeze(sorted.map((entry) => Object.freeze({ ...entry })));
}

export function decodeGitIndexGeneration(
  input: Uint8Array,
  objectFormat: GitIndexObjectFormat
): GitIndexGeneration {
  const bytes = Buffer.from(input);
  const hashBytes = objectIdBytes(objectFormat);
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
  let previousPath = Buffer.alloc(0);
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
      pathBytes = Buffer.concat([
        previousPath.subarray(0, previousPath.byteLength - prefix.value),
        suffix
      ]);
      offset = terminator + 1;
    } else {
      const terminator = bytes.indexOf(0, offset);
      if (terminator < 0 || terminator >= contentEnd) throw new Error('Git index pathname is unterminated.');
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

  while (offset < contentEnd) {
    if (offset + 8 > contentEnd) throw new Error('Git index extension header is truncated.');
    const signatureBytes = bytes.subarray(offset, offset + 4);
    const signature = signatureBytes.toString('ascii');
    const size = bytes.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > contentEnd) throw new Error('Git index extension payload is truncated.');
    if (signatureBytes[0]! < 0x41 || signatureBytes[0]! > 0x5a) {
      throw new Error(`Git index mandatory extension ${signature} is unsupported.`);
    }
    if (!DISCARDABLE_INDEX_EXTENSIONS.has(signature)) {
      throw new Error(`Git index optional extension ${signature} has semantics this owner does not discard.`);
    }
    offset += size;
  }
  if (offset !== contentEnd) throw new Error('Git index extension framing did not settle at the checksum.');

  for (const entry of entries) validateDenseEntry(entry, objectFormat);
  return Object.freeze({
    objectFormat,
    entries: sortEntries(entries)
  });
}

function canonicalEntryFlags(entry: GitIndexGenerationEntry): number {
  const pathLength = Buffer.from(entry.pathHex, 'hex').byteLength;
  return (entry.assumeValid ? 0x8000 : 0)
    | (entry.extendedFlags !== 0 ? 0x4000 : 0)
    | Math.min(pathLength, 0x0fff);
}

export function encodeGitIndexGeneration(generation: GitIndexGeneration): Buffer {
  const { objectFormat } = generation;
  const entries = sortEntries(generation.entries);
  for (const entry of entries) validateDenseEntry(entry, objectFormat);
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
  delta: GitIndexObjectDelta
): GitIndexGeneration {
  if (generation.objectFormat !== 'sha1' && generation.objectFormat !== 'sha256') {
    throw new Error('Git index generation object format is invalid.');
  }
  const entries = new Map(generation.entries.map((entry) => [entry.pathHex, entry] as const));
  for (const path of delta.removals) {
    if (!CodexDevelopmentIsCanonicalRepositoryPath(path)) throw new Error('Git index delta removal path is invalid.');
    entries.delete(Buffer.from(path, 'utf8').toString('hex'));
  }
  for (const addition of delta.additions) {
    const entry = newRegularEntry(addition.path, addition.objectId, generation.objectFormat);
    entries.set(entry.pathHex, entry);
  }
  return Object.freeze({
    objectFormat: generation.objectFormat,
    entries: sortEntries([...entries.values()])
  });
}

function modeText(mode: number): string {
  if (mode === 0o100644) return '100644';
  if (mode === 0o100755) return '100755';
  if (mode === 0o120000) return '120000';
  if (mode === 0o160000) return '160000';
  throw new Error('Git tree entry mode is unsupported.');
}

function objectType(mode: number): 'blob' | 'commit' {
  return mode === 0o160000 ? 'commit' : 'blob';
}

export function compileGitMktreePlan(generation: GitIndexGeneration): GitMktreePlan {
  const root: MutableTreeNode = {
    key: '',
    depth: 0,
    nameHex: null,
    leaves: new Map(),
    children: new Map()
  };
  const nodes = new Map<string, MutableTreeNode>([['', root]]);
  for (const entry of generation.entries) {
    validateDenseEntry(entry, generation.objectFormat);
    if (/^0+$/u.test(entry.objectId)) {
      throw new Error('Git tree generation rejects intent-to-add or null object identities.');
    }
    const parts = splitPathBytes(Buffer.from(entry.pathHex, 'hex'));
    let node = root;
    const directoryParts: Buffer[] = [];
    for (const part of parts.slice(0, -1)) {
      const partHex = part.toString('hex');
      if (node.leaves.has(partHex)) throw new Error('Git tree generation found a file/directory conflict.');
      directoryParts.push(part);
      const key = Buffer.concat(directoryParts.flatMap((value, index) => (
        index === 0 ? [value] : [Buffer.from('/'), value]
      ))).toString('hex');
      let child = node.children.get(partHex);
      if (child === undefined) {
        child = {
          key,
          depth: node.depth + 1,
          nameHex: partHex,
          leaves: new Map(),
          children: new Map()
        };
        node.children.set(partHex, child);
        nodes.set(key, child);
      }
      node = child;
    }
    const leaf = parts.at(-1)!;
    const leafHex = leaf.toString('hex');
    if (node.children.has(leafHex) || node.leaves.has(leafHex)) {
      throw new Error('Git tree generation found a duplicate or file/directory conflict.');
    }
    node.leaves.set(leafHex, entry);
  }
  const maximumDepth = Math.max(...[...nodes.values()].map((node) => node.depth));
  const levels: GitMktreeDirectoryPlan[][] = [];
  for (let depth = maximumDepth; depth >= 0; depth -= 1) {
    const level = [...nodes.values()]
      .filter((node) => node.depth === depth)
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((node) => Object.freeze({
        key: node.key,
        leaves: Object.freeze([...node.leaves.entries()].map(([nameHex, entry]) => Object.freeze({
          mode: entry.mode,
          objectId: entry.objectId,
          nameHex
        }))),
        children: Object.freeze([...node.children.values()].map((child) => Object.freeze({
          key: child.key,
          nameHex: child.nameHex!
        })))
      }));
    levels.push(Object.freeze(level));
  }
  return Object.freeze({ levels: Object.freeze(levels), rootKey: '' });
}

function mktreeRecord(prefix: string, nameHex: string): Buffer {
  return Buffer.concat([
    Buffer.from(prefix, 'ascii'),
    Buffer.from(nameHex, 'hex'),
    Buffer.from([0])
  ]);
}

export function encodeGitMktreeBatch(
  directories: readonly GitMktreeDirectoryPlan[],
  resolvedTrees: ReadonlyMap<string, string>,
  objectFormat: GitIndexObjectFormat
): Buffer {
  const chunks: Buffer[] = [];
  for (const directory of directories) {
    for (const leaf of directory.leaves) {
      if (!objectIdPattern(objectFormat).test(leaf.objectId)) throw new Error('Git mktree leaf object id is invalid.');
      chunks.push(mktreeRecord(
        `${modeText(leaf.mode)} ${objectType(leaf.mode)} ${leaf.objectId}\t`,
        leaf.nameHex
      ));
    }
    for (const child of directory.children) {
      const objectId = resolvedTrees.get(child.key);
      if (objectId === undefined || !objectIdPattern(objectFormat).test(objectId)) {
        throw new Error('Git mktree child tree identity is unresolved.');
      }
      chunks.push(mktreeRecord(`040000 tree ${objectId}\t`, child.nameHex));
    }
    chunks.push(Buffer.from([0]));
  }
  return Buffer.concat(chunks);
}

export function parseGitMktreeBatchOutput(
  bytes: Uint8Array,
  expectedCount: number,
  objectFormat: GitIndexObjectFormat
): readonly string[] {
  const source = Buffer.from(bytes).toString('ascii');
  const lines = source.endsWith('\n') ? source.slice(0, -1).split('\n') : source.split('\n');
  if (expectedCount === 0) {
    if (source.length !== 0) throw new Error('Git mktree returned unexpected output for an empty batch.');
    return Object.freeze([]);
  }
  if (lines.length !== expectedCount || lines.some((value) => !objectIdPattern(objectFormat).test(value))) {
    throw new Error('Git mktree batch output does not match the requested directory count.');
  }
  return Object.freeze(lines);
}
