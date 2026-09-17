import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

import {
  assertRetainedNoFollowProvenDirectoryGeneration,
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowRandomDirectory,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowLinkEntry,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  publishExclusiveDurableCanonicalFile,
  publishExclusiveNoFollowProvenDirectoryLink,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowSealedDirectoryGeneration,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry,
  type NoFollowDirectoryTreeRetirementReceipt,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowProvenDirectoryGeneration,
  type RetainedNoFollowSealedDirectoryGeneration
} from './physical-no-follow.ts';
import {
  sealExistingWindowsReadOnlyTreeAuthority,
  type WindowsReadOnlyTreeAuthority
} from './windows-host-filesystem-authority.ts';
const SEALED_EXECUTION_TREE_RECOVERY_POLICY = Object.freeze({ maximumDurationMs: 30_000 });
const retainedSealedPhysicalExecutionTreeGenerationBrand: unique symbol = Symbol(
  'retained-sealed-physical-execution-tree-generation'
);
const sealedPhysicalExecutionTreeGenerationIdentityBrand: unique symbol = Symbol(
  'sealed-physical-execution-tree-generation-identity'
);
const sealedPhysicalExecutionTreeRetirementReceiptBrand: unique symbol = Symbol(
  'sealed-physical-execution-tree-retirement-receipt'
);
const retainedSealedPhysicalExecutionProtectedRootBrand: unique symbol = Symbol(
  'retained-sealed-physical-execution-protected-root'
);
const issuedRetainedSealedPhysicalExecutionTreeGenerations = new WeakSet<object>();
const issuedSealedPhysicalExecutionTreeGenerationIdentities = new WeakSet<object>();
const issuedSealedPhysicalExecutionTreeRetirementReceipts = new WeakSet<object>();
const borrowedGenerationIdentityDigests = new WeakMap<object, `sha256:${string}`>();
const generationIdentityRecords = new WeakMap<object, Readonly<{
  generation: RetainedSealedPhysicalExecutionTreeGeneration;
  linkedGenerations: readonly RetainedNoFollowProvenDirectoryGeneration[];
  protectedRoots: readonly BorrowedProtectedRoot[];
  workingDirectory:
    | RetainedNoFollowSealedDirectoryGeneration
    | RetainedNoFollowProvenDirectoryGeneration;
}>>();
const retirementReceiptRecords = new WeakMap<object, Readonly<{
  generation: RetainedSealedPhysicalExecutionTreeGeneration;
  identity: SealedPhysicalExecutionTreeGenerationIdentity;
}>>();
const protectedRootRecords = new WeakMap<object, {
  readonly boundary: RetainedNoFollowChildProcessDirectory;
  readonly root: PhysicalDirectoryIdentity;
  released: boolean;
}>();

export type SealedPhysicalExecutionTreeFile = Readonly<{
  bytes: Uint8Array;
  path: string;
}>;

/** The source lifetime remains wholly caller-owned and is only borrowed. */
export type SealedPhysicalExecutionTreeLink = Readonly<{
  path: string;
  source: RetainedNoFollowProvenDirectoryGeneration;
}>;

export interface RetainedSealedPhysicalExecutionProtectedRoot {
  readonly [retainedSealedPhysicalExecutionProtectedRootBrand]: true;
  readonly root: PhysicalDirectoryIdentity;
  assertCurrent(): Promise<void>;
  release(): void;
}

export type SealedPhysicalExecutionTreeLinkedSettlement = Readonly<{
  path: string;
  sourceRoot: PhysicalDirectoryIdentity;
  status: 'borrowed-current' | 'borrowed-unavailable';
}>;

export type SealedPhysicalExecutionTreeGenerationIdentity = Readonly<{
  readonly [sealedPhysicalExecutionTreeGenerationIdentityBrand]: true;
  borrowedGenerationDigest: `sha256:${string}`;
  exactFileSetDigest: `sha256:${string}`;
  generationDigest: `sha256:${string}`;
  materializationOperationDigest: `sha256:${string}`;
  protectedSubjectRootsDigest: `sha256:${string}`;
  sealedRoot: PhysicalDirectoryIdentity;
  treeDigest: `sha256:${string}`;
  workingDirectoryGenerationDigest: `sha256:${string}`;
}>;

export type SealedPhysicalExecutionTreeRetirementReceipt = Readonly<{
  readonly [sealedPhysicalExecutionTreeRetirementReceiptBrand]: true;
  generationIdentity: SealedPhysicalExecutionTreeGenerationIdentity;
  linkedSettlements: readonly Readonly<{
    path: string;
    sourceRoot: PhysicalDirectoryIdentity;
    status: 'borrowed-current';
  }>[];
  protectedRootSettlements: readonly Readonly<{
    root: PhysicalDirectoryIdentity;
    status: 'current';
  }>[];
  treeAuthority: 'released';
  tree: NoFollowDirectoryTreeRetirementReceipt;
}>;

export type SealedPhysicalExecutionTreeResidue = Readonly<{
  generationLocator: Readonly<{
    parent: PhysicalDirectoryIdentity;
    root: PhysicalDirectoryIdentity;
  }>;
  inventory: Readonly<{
    entries: readonly NoFollowDirectoryTreeInventoryEntry[] | null;
    maximumBytes: number;
    maximumEntries: number;
    state: 'known' | 'unknown';
  }>;
  linkedSettlements: readonly SealedPhysicalExecutionTreeLinkedSettlement[];
  protectedRootSettlements: readonly Readonly<{
    root: PhysicalDirectoryIdentity;
    status: 'current' | 'unavailable';
  }>[];
  retryability: 'owner-reconciliation-required' | 'retryable';
  treeSettlements: Readonly<{
    authority: 'not-issued' | 'release-failed' | 'released' | 'retained';
    tree: 'not-started' | 'physically-absent' | 'retirement-failed';
  }>;
}>;

export class SealedPhysicalExecutionTreeAdmissionError extends Error {
  readonly code = 'RUNTIME_PHYSICAL_EXECUTION_TREE_INVALID' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SealedPhysicalExecutionTreeAdmissionError';
  }
}

export class SealedPhysicalExecutionTreeResidueError extends Error {
  readonly code = 'RUNTIME_PHYSICAL_EXECUTION_TREE_RESIDUE' as const;
  readonly residue: SealedPhysicalExecutionTreeResidue;

  constructor(message: string, residue: SealedPhysicalExecutionTreeResidue, cause: unknown) {
    super(message, { cause });
    this.name = 'SealedPhysicalExecutionTreeResidueError';
    this.residue = residue;
  }
}

export interface RetainedSealedPhysicalExecutionTreeGeneration {
  readonly [retainedSealedPhysicalExecutionTreeGenerationBrand]: true;
  readonly identity: SealedPhysicalExecutionTreeGenerationIdentity;
  readonly workingDirectory:
    | RetainedNoFollowSealedDirectoryGeneration
    | RetainedNoFollowProvenDirectoryGeneration;
  assertCurrent(): Promise<void>;
  retire(): Promise<SealedPhysicalExecutionTreeRetirementReceipt>;
}

export type MaterializeRetainedSealedPhysicalExecutionTreeGenerationInput = Readonly<{
  deadlineAtUnixMs: number;
  directoryNamePrefix: string;
  files: readonly SealedPhysicalExecutionTreeFile[];
  generationParent: PhysicalDirectoryIdentity;
  links: readonly SealedPhysicalExecutionTreeLink[];
  maximumBytes?: number;
  maximumEntries?: number;
  protectedRoots?: readonly RetainedSealedPhysicalExecutionProtectedRoot[];
  signal?: AbortSignal;
}>;

type CanonicalSealedPhysicalExecutionTreeFile = Readonly<{ bytes: Buffer; path: string }>;
type BorrowedProtectedRoot = Readonly<{
  assertCurrent(): Promise<void>;
  root: PhysicalDirectoryIdentity;
}>;
type TrieNode = {
  children: Map<string, TrieNode>;
  spelling: string | null;
  terminal: boolean;
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

function frozenIdentity(identity: PhysicalDirectoryIdentity): PhysicalDirectoryIdentity {
  return Object.freeze({ ...identity });
}

function canonicalPhysicalPathKey(value: string): string {
  return path.resolve(value)
    .replaceAll('\\', '/')
    .replace(/\/+$/u, '')
    .normalize('NFC')
    .toLocaleLowerCase('en-US');
}

function physicalPathsOverlap(left: string, right: string): boolean {
  const a = canonicalPhysicalPathKey(left);
  const b = canonicalPhysicalPathKey(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function canonicalSegmentKey(segment: string, label: string): string {
  const normalized = segment.normalize('NFC');
  if (/[\u0000-\u001f<>:"|?*]/u.test(normalized)
      || /[ .]$/u.test(normalized)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(normalized)) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      `${label} contains a reserved path equivalent: ${segment}`
    );
  }
  return normalized.toLocaleLowerCase('en-US');
}

function canonicalRelativePath(value: string, label: string): readonly string[] {
  const parts = value.split('/');
  if (value.length === 0 || path.isAbsolute(value) || value.includes('\\')
      || value.includes('\0') || parts.some((part) => (
        part.length === 0 || part === '.' || part === '..'
      )) || parts.join('/') !== value) {
    throw new SealedPhysicalExecutionTreeAdmissionError(`${label} path is not canonical: ${value}`);
  }
  for (const part of parts) canonicalSegmentKey(part, label);
  return parts;
}

function insertCanonicalPath(trie: TrieNode, value: string, label: string): void {
  const parts = canonicalRelativePath(value, label);
  let node = trie;
  for (const [index, part] of parts.entries()) {
    if (node.terminal) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        `${label} overlaps an ancestor publication: ${value}`
      );
    }
    const key = canonicalSegmentKey(part, label);
    let child = node.children.get(key);
    if (child === undefined) {
      child = { children: new Map(), spelling: part, terminal: false };
      node.children.set(key, child);
    } else if (child.spelling !== part) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        `${label} collides with a case or normalization equivalent: ${value}`
      );
    }
    node = child;
    if (index === parts.length - 1) {
      if (node.terminal || node.children.size > 0) {
        throw new SealedPhysicalExecutionTreeAdmissionError(
          `${label} collides with an existing publication: ${value}`
        );
      }
      node.terminal = true;
    }
  }
}

function canonicalContentDigest(bytes: Uint8Array): `sha256:${string}` {
  const hash = createHash('sha256');
  hash.update('{"bytes":"');
  hash.update(Buffer.from(bytes).toString('hex'));
  hash.update('"}');
  return `sha256:${hash.digest('hex')}`;
}

function physicalDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function compileSealedPhysicalExecutionTreeExactFileSetDigest(
  files: readonly SealedPhysicalExecutionTreeFile[]
): `sha256:${string}` {
  return physicalDigest(files
    .map((file) => Object.freeze({
      contentDigest: canonicalContentDigest(file.bytes),
      path: file.path,
      size: file.bytes.byteLength
    }))
    .sort((left, right) => compareCodeUnits(left.path, right.path)));
}

function issueOperationDigest(domain: string): `sha256:${string}` {
  return physicalDigest(Object.freeze({
    domain,
    nonce: randomBytes(32).toString('hex')
  }));
}

function borrowedGenerationIdentityDigest(
  generation: RetainedNoFollowProvenDirectoryGeneration
): `sha256:${string}` {
  const existing = borrowedGenerationIdentityDigests.get(generation);
  if (existing !== undefined) return existing;
  const issued = issueOperationDigest('runtime-physical-borrowed-generation');
  borrowedGenerationIdentityDigests.set(generation, issued);
  return issued;
}

function inventoryEntryMatches(
  entry: NoFollowDirectoryTreeInventoryEntry,
  directories: ReadonlySet<string>,
  files: ReadonlyMap<string, CanonicalSealedPhysicalExecutionTreeFile>,
  links: ReadonlyMap<string, string>
): boolean {
  if (directories.has(entry.relativePath)) {
    return entry.kind === 'directory' && entry.contentDigest === null && entry.linkTarget === null;
  }
  const file = files.get(entry.relativePath);
  if (file !== undefined) {
    return entry.kind === 'file'
      && entry.size === file.bytes.byteLength
      && entry.contentDigest === canonicalContentDigest(file.bytes)
      && entry.linkTarget === null;
  }
  const linkTarget = links.get(entry.relativePath);
  return linkTarget !== undefined && entry.kind === 'link'
    && entry.contentDigest === null
    && (process.platform === 'win32' || entry.linkTarget === linkTarget);
}

function inventoryIsPublicationSubset(
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[],
  directories: readonly string[],
  files: readonly CanonicalSealedPhysicalExecutionTreeFile[],
  links: readonly Readonly<{ path: string; linkTarget: string }>[]
): boolean {
  const directorySet = new Set(directories);
  const fileMap = new Map(files.map((file) => [file.path, file] as const));
  const linkMap = new Map(links.map((link) => [link.path, link.linkTarget] as const));
  return inventory.every((entry) => inventoryEntryMatches(entry, directorySet, fileMap, linkMap));
}

function inventoryIsExactPublication(
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[],
  directories: readonly string[],
  files: readonly CanonicalSealedPhysicalExecutionTreeFile[],
  links: readonly Readonly<{ path: string; linkTarget: string }>[]
): boolean {
  return inventory.length === directories.length + files.length + links.length
    && inventoryIsPublicationSubset(inventory, directories, files, links);
}

function inventoryIsIdentitySubset(
  current: readonly NoFollowDirectoryTreeInventoryEntry[],
  original: readonly NoFollowDirectoryTreeInventoryEntry[]
): boolean {
  const expected = new Map(original.map((entry) => [entry.relativePath, entry] as const));
  return current.every((entry) => {
    const prior = expected.get(entry.relativePath);
    return prior !== undefined && JSON.stringify(prior) === JSON.stringify(entry);
  });
}

function freshRecoveryDeadlineAtMonotonicMs(): number {
  return performance.now() + SEALED_EXECUTION_TREE_RECOVERY_POLICY.maximumDurationMs;
}

function assertLimits(input: MaterializeRetainedSealedPhysicalExecutionTreeGenerationInput): void {
  if (input.maximumEntries !== undefined
      && (!Number.isSafeInteger(input.maximumEntries) || input.maximumEntries < 1)) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution tree entry ceiling is invalid'
    );
  }
  if (input.maximumBytes !== undefined
      && (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 0)) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution tree byte ceiling is invalid'
    );
  }
}

async function assertProtectedRootCurrent(
  protectedRoot: RetainedSealedPhysicalExecutionProtectedRoot
): Promise<void> {
  const record = protectedRootRecords.get(protectedRoot);
  if (record === undefined) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution protected root was not issued by Runtime Physical'
    );
  }
  if (record.released) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution protected root is released'
    );
  }
  record.boundary.assertCurrent();
  const current = assertSameNoFollowDirectoryIdentity(
    record.root,
    'Runtime Physical execution protected root'
  ).target;
  if (!sameIdentity(record.root, current)
      || canonicalPhysicalPathKey(record.root.finalPath)
        !== canonicalPhysicalPathKey(current.finalPath)) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution protected root identity differs from its issuer'
    );
  }
}

/**
 * Pins one exact mutable directory chain without claiming a proven immutable
 * generation. The caller owns the lifetime and must explicitly release it.
 */
export function retainMutableSealedPhysicalExecutionProtectedRoot(
  root: PhysicalDirectoryIdentity
): RetainedSealedPhysicalExecutionProtectedRoot {
  const chain = assertSameNoFollowDirectoryIdentity(root, 'mutable execution protected root');
  const retainedRoot = frozenIdentity(chain.target);
  const boundary = retainNoFollowDirectoryForChildProcess(
    chain,
    16,
    'mutable execution protected root'
  );
  const protectedRoot: RetainedSealedPhysicalExecutionProtectedRoot = Object.freeze({
    [retainedSealedPhysicalExecutionProtectedRootBrand]: true as const,
    root: retainedRoot,
    assertCurrent: async () => assertProtectedRootCurrent(protectedRoot),
    release: () => {
      const record = protectedRootRecords.get(protectedRoot)!;
      if (record.released) return;
      let failure: unknown;
      try { record.boundary.assertCurrent(); } catch (error) { failure = error; }
      try { record.boundary.dispose(); } catch (error) { failure ??= error; }
      record.released = true;
      if (failure !== undefined) throw failure;
    }
  });
  protectedRootRecords.set(protectedRoot, {
    boundary,
    released: false,
    root: retainedRoot
  });
  return protectedRoot;
}

export function assertRetainedSealedPhysicalExecutionTreeGeneration(
  generation: RetainedSealedPhysicalExecutionTreeGeneration
): void {
  if (!issuedRetainedSealedPhysicalExecutionTreeGenerations.has(generation)) {
    throw new Error('Sealed physical execution tree generation was not issued by Runtime Physical');
  }
  const identityRecord = generationIdentityRecords.get(generation.identity);
  if (!issuedSealedPhysicalExecutionTreeGenerationIdentities.has(generation.identity)
      || identityRecord?.generation !== generation
      || identityRecord.workingDirectory !== generation.workingDirectory) {
    throw new Error('Sealed physical execution tree generation identity is not issuer-bound');
  }
}

export function assertSealedPhysicalExecutionTreeRetirementReceipt(
  receipt: SealedPhysicalExecutionTreeRetirementReceipt,
  generation: RetainedSealedPhysicalExecutionTreeGeneration
): void {
  assertRetainedSealedPhysicalExecutionTreeGeneration(generation);
  const record = retirementReceiptRecords.get(receipt);
  if (!issuedSealedPhysicalExecutionTreeRetirementReceipts.has(receipt)) {
    throw new Error('Sealed physical execution tree retirement receipt was not issued by Runtime Physical');
  }
  if (record?.generation !== generation
      || record.identity !== generation.identity
      || receipt.generationIdentity !== generation.identity) {
    throw new Error('Sealed physical execution tree retirement receipt does not settle this generation');
  }
}

async function linkedSettlements(
  links: readonly SealedPhysicalExecutionTreeLink[]
): Promise<readonly SealedPhysicalExecutionTreeLinkedSettlement[]> {
  return Object.freeze(await Promise.all(links.map(async (link) => {
    let status: SealedPhysicalExecutionTreeLinkedSettlement['status'] = 'borrowed-current';
    try {
      assertRetainedNoFollowProvenDirectoryGeneration(link.source, 'borrowed execution link source');
      link.source.assertCurrent();
      await link.source.assertAuthorityCurrent();
    } catch {
      status = 'borrowed-unavailable';
    }
    return Object.freeze({
      path: link.path,
      sourceRoot: frozenIdentity(link.source.root),
      status
    });
  })));
}

async function protectedRootSettlements(
  roots: readonly BorrowedProtectedRoot[]
): Promise<SealedPhysicalExecutionTreeResidue['protectedRootSettlements']> {
  return Object.freeze(await Promise.all(roots.map(async (root) => {
    let status: 'current' | 'unavailable' = 'current';
    try {
      await root.assertCurrent();
    } catch {
      status = 'unavailable';
    }
    return Object.freeze({ root: frozenIdentity(root.root), status });
  })));
}

async function createResidue(input: Readonly<{
  generationParent: PhysicalDirectoryIdentity;
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[] | null;
  links: readonly SealedPhysicalExecutionTreeLink[];
  maximumBytes: number;
  maximumEntries: number;
  protectedRoots: readonly BorrowedProtectedRoot[];
  retryable: boolean;
  root: PhysicalDirectoryIdentity;
  treeAuthority: SealedPhysicalExecutionTreeResidue['treeSettlements']['authority'];
  treeRetirement: SealedPhysicalExecutionTreeResidue['treeSettlements']['tree'];
}>): Promise<SealedPhysicalExecutionTreeResidue> {
  let rootCurrent = false;
  try {
    const current = assertSameNoFollowDirectoryIdentity(
      input.root,
      'Runtime Physical execution residue root'
    ).target;
    rootCurrent = sameIdentity(input.root, current);
  } catch {
    rootCurrent = false;
  }
  return Object.freeze({
    generationLocator: Object.freeze({
      parent: frozenIdentity(input.generationParent),
      root: frozenIdentity(input.root)
    }),
    inventory: Object.freeze({
      entries: input.inventory === null
        ? null
        : Object.freeze(input.inventory.map((entry) => Object.freeze({ ...entry }))),
      maximumBytes: input.maximumBytes,
      maximumEntries: input.maximumEntries,
      state: input.inventory === null ? 'unknown' as const : 'known' as const
    }),
    linkedSettlements: await linkedSettlements(input.links),
    protectedRootSettlements: await protectedRootSettlements(input.protectedRoots),
    retryability: input.retryable && rootCurrent
      ? 'retryable' as const
      : 'owner-reconciliation-required' as const,
    treeSettlements: Object.freeze({
      authority: input.treeAuthority,
      tree: input.treeRetirement
    })
  });
}

/**
 * Publishes one exact pre-run filesystem generation. It does not calculate a
 * dependency graph, claim loaded code, sign semantic authority or join process
 * and dynamic-code settlements. Link and protected-root lifetimes are borrowed.
 */
export async function materializeRetainedSealedPhysicalExecutionTreeGeneration(
  input: MaterializeRetainedSealedPhysicalExecutionTreeGenerationInput
): Promise<RetainedSealedPhysicalExecutionTreeGeneration> {
  const materializationOperationDigest = issueOperationDigest(
    'runtime-physical-sealed-execution-tree-materialization'
  );
  const deadlineAtMonotonicMs = performance.now() + Math.max(
    0,
    input.deadlineAtUnixMs - Date.now()
  );
  const assertExecutionCurrent = (): void => {
    if (input.signal?.aborted === true) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        'Runtime Physical execution tree was aborted'
      );
    }
    if (!Number.isSafeInteger(input.deadlineAtUnixMs)
        || Date.now() >= input.deadlineAtUnixMs
        || performance.now() >= deadlineAtMonotonicMs) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        'Runtime Physical execution tree deadline is exhausted'
      );
    }
  };
  assertExecutionCurrent();
  assertLimits(input);
  if (input.links.length > 1) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution tree supports at most one borrowed link'
    );
  }
  if (input.directoryNamePrefix.length === 0
      || input.directoryNamePrefix.includes('\0')
      || input.directoryNamePrefix.includes('/')
      || input.directoryNamePrefix.includes('\\')) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution tree directory prefix is invalid'
    );
  }

  const trie: TrieNode = { children: new Map(), spelling: null, terminal: false };
  const files: CanonicalSealedPhysicalExecutionTreeFile[] = [];
  let totalBytes = 0;
  for (const file of input.files) {
    assertExecutionCurrent();
    insertCanonicalPath(trie, file.path, 'Runtime Physical execution tree file');
    totalBytes += file.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes)
        || (input.maximumBytes !== undefined && totalBytes > input.maximumBytes)) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        'Runtime Physical execution tree byte ceiling is exceeded'
      );
    }
    files.push(Object.freeze({ bytes: Buffer.from(file.bytes), path: file.path }));
  }
  const exactFileSetDigest = compileSealedPhysicalExecutionTreeExactFileSetDigest(files);
  const links = input.links.map((link) => {
    assertExecutionCurrent();
    insertCanonicalPath(trie, link.path, 'Runtime Physical execution tree link');
    assertRetainedNoFollowProvenDirectoryGeneration(link.source, 'borrowed execution link source');
    return Object.freeze({ path: link.path, source: link.source });
  });
  const borrowedGenerationDigest = physicalDigest(links
    .map((link) => Object.freeze({
      generationIdentityDigest: borrowedGenerationIdentityDigest(link.source),
      path: link.path,
      sourceRoot: frozenIdentity(link.source.root)
    }))
    .sort((left, right) => compareCodeUnits(left.path, right.path)));
  const parentPaths = [...new Set([...files, ...links].flatMap((entry) => {
    const parts = entry.path.split('/');
    parts.pop();
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  }))].sort((left, right) => (
    left.split('/').length - right.split('/').length || compareCodeUnits(left, right)
  ));
  const maximumMaterializedEntries = parentPaths.length + files.length + links.length;
  if (!Number.isSafeInteger(maximumMaterializedEntries)
      || (input.maximumEntries !== undefined
        && maximumMaterializedEntries > input.maximumEntries)) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Runtime Physical execution tree entry ceiling is exceeded'
    );
  }

  const generationParent = assertSameNoFollowDirectoryIdentity(
    input.generationParent,
    'Runtime Physical execution generation parent'
  ).target;
  const explicitProtectedRoots = input.protectedRoots ?? [];
  const protectedRoots: BorrowedProtectedRoot[] = [];
  const seenProtectedRoots = new Map<string, PhysicalDirectoryIdentity>();
  const addProtectedRoot = async (root: BorrowedProtectedRoot): Promise<void> => {
    await root.assertCurrent();
    const current = assertSameNoFollowDirectoryIdentity(
      root.root,
      'Runtime Physical execution protected root readback'
    ).target;
    if (!sameIdentity(root.root, current)) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        'Runtime Physical execution protected root identity changed'
      );
    }
    if (physicalPathsOverlap(generationParent.path, current.path)) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        'Runtime Physical execution owner overlaps a protected root'
      );
    }
    const key = canonicalPhysicalPathKey(current.path);
    const prior = seenProtectedRoots.get(key);
    if (prior !== undefined) {
      if (!sameIdentity(prior, current)) {
        throw new SealedPhysicalExecutionTreeAdmissionError(
          'Runtime Physical execution protected roots have a case-equivalent identity conflict'
        );
      }
      return;
    }
    for (const existing of protectedRoots) {
      if (physicalPathsOverlap(existing.root.path, current.path)) {
        throw new SealedPhysicalExecutionTreeAdmissionError(
          'Runtime Physical execution protected roots overlap'
        );
      }
    }
    seenProtectedRoots.set(key, current);
    protectedRoots.push(Object.freeze({ assertCurrent: root.assertCurrent, root: frozenIdentity(current) }));
  };
  for (const protectedRoot of explicitProtectedRoots) {
    await assertProtectedRootCurrent(protectedRoot);
    await addProtectedRoot(protectedRoot);
  }
  for (const link of links) {
    const borrowedLinkRoot: BorrowedProtectedRoot = Object.freeze({
      assertCurrent: async () => {
        assertRetainedNoFollowProvenDirectoryGeneration(link.source, 'borrowed execution link source');
        link.source.assertCurrent();
        await link.source.assertAuthorityCurrent();
        assertSameNoFollowDirectoryIdentity(link.source.root, 'borrowed execution link source');
      },
      root: frozenIdentity(link.source.root)
    });
    await addProtectedRoot(borrowedLinkRoot);
  }
  const protectedSubjectRootsDigest = physicalDigest(protectedRoots
    .map((root) => frozenIdentity(root.root))
    .sort((left, right) => compareCodeUnits(
      canonicalPhysicalPathKey(left.path),
      canonicalPhysicalPathKey(right.path)
    )));
  if (process.platform === 'win32' && protectedRoots.length === 0) {
    throw new SealedPhysicalExecutionTreeAdmissionError(
      'Windows sealed execution tree requires one issued disjoint protected root'
    );
  }
  assertExecutionCurrent();

  const generationRoot = createExclusiveNoFollowRandomDirectory(
    generationParent,
    input.directoryNamePrefix
  );
  let inventory: readonly NoFollowDirectoryTreeInventoryEntry[] | null = null;
  let workingDirectory:
    | RetainedNoFollowSealedDirectoryGeneration
    | RetainedNoFollowProvenDirectoryGeneration
    | null = null;
  let pendingWindowsAuthority: WindowsReadOnlyTreeAuthority | null = null;
  let treeAuthorityState: SealedPhysicalExecutionTreeResidue['treeSettlements']['authority'] = 'not-issued';
  const publishedLinks: Array<Readonly<{ path: string; linkTarget: string }>> = [];
  try {
    const directories = new Map<string, PhysicalDirectoryIdentity>([['', generationRoot]]);
    for (const relativePath of parentPaths) {
      assertExecutionCurrent();
      directories.set(
        relativePath,
        createNoFollowOrdinaryDirectoryChain(generationRoot, relativePath.split('/'))
      );
    }
    for (const file of files) {
      assertExecutionCurrent();
      const parts = file.path.split('/');
      const name = parts.pop()!;
      const parent = directories.get(parts.join('/'))!;
      publishExclusiveDurableCanonicalFile({
        parent,
        name,
        bytes: file.bytes,
        validate: (readback) => {
          if (!Buffer.from(readback).equals(file.bytes)) {
            throw new SealedPhysicalExecutionTreeAdmissionError(
              'Runtime Physical execution tree file readback differs'
            );
          }
        }
      });
    }
    for (const link of links) {
      assertExecutionCurrent();
      link.source.assertCurrent();
      await link.source.assertAuthorityCurrent();
      const parts = link.path.split('/');
      const name = parts.pop()!;
      const parent = directories.get(parts.join('/'))!;
      const published = publishExclusiveNoFollowProvenDirectoryLink({
        parent,
        name,
        source: link.source
      });
      publishedLinks.push(Object.freeze({ path: link.path, linkTarget: published.linkTarget }));
    }
    assertExecutionCurrent();
    inventory = scanNoFollowDirectoryTreeInventory(generationRoot, {
      deadlineAtMs: deadlineAtMonotonicMs,
      maximumEntries: Math.max(1, maximumMaterializedEntries),
      maximumBytes: totalBytes,
      signal: input.signal
    });
    if (!inventoryIsExactPublication(inventory, parentPaths, files, publishedLinks)) {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        'Runtime Physical execution tree inventory differs from exact publication'
      );
    }
    const treeDigest = physicalDigest(inventory);
    if (process.platform === 'win32') {
      for (const link of links) {
        const parts = link.path.split('/');
        const name = parts.pop()!;
        const parent = directories.get(parts.join('/'))!;
        const observed = inspectExactNoFollowLinkEntry(parent, name, link.source.root.path);
        if (observed === null || observed.kind !== 'link') {
          throw new SealedPhysicalExecutionTreeAdmissionError(
            `Runtime Physical execution tree link differs from publication: ${link.path}`
          );
        }
      }
      assertExecutionCurrent();
      pendingWindowsAuthority = await sealExistingWindowsReadOnlyTreeAuthority(
        generationRoot.path,
        inventory.filter(({ kind }) => kind === 'directory').map(({ relativePath }) => (
          path.join(generationRoot.path, ...relativePath.split('/'))
        )),
        {
          deadlineAtMs: input.deadlineAtUnixMs,
          ownerRootPath: generationParent.path,
          repositoryRootPath: protectedRoots[0]!.root.path,
          signal: input.signal
        }
      );
      treeAuthorityState = 'retained';
      assertExecutionCurrent();
      workingDirectory = await retainNoFollowSealedDirectoryGeneration(
        generationRoot,
        inventory,
        pendingWindowsAuthority,
        'physical execution tree generation'
      );
      pendingWindowsAuthority = null;
    } else if (process.platform === 'linux') {
      const projectGeneration = await materializeRetainedNoFollowProvenDirectoryGeneration({
        binding: {
          generationDigest: physicalDigest({ root: frozenIdentity(generationRoot), treeDigest }),
          treeDigest,
          treeEntryCount: inventory.length
        },
        deadlineAtUnixMs: input.deadlineAtUnixMs,
        inventory,
        proofText: null,
        releaseMode: 'restore-owner-write',
        root: generationRoot,
        signal: input.signal
      });
      workingDirectory = projectGeneration.generation;
      treeAuthorityState = 'retained';
    } else {
      throw new SealedPhysicalExecutionTreeAdmissionError(
        `Runtime Physical execution tree is unavailable on ${process.platform}`
      );
    }

    const sealedRoot = frozenIdentity(generationRoot);
    const workingDirectoryGenerationDigest = physicalDigest(Object.freeze({
      materializationOperationDigest,
      sealedRoot,
      treeDigest
    }));
    const generationIdentityUnsigned = Object.freeze({
      borrowedGenerationDigest,
      exactFileSetDigest,
      materializationOperationDigest,
      protectedSubjectRootsDigest,
      sealedRoot,
      treeDigest,
      workingDirectoryGenerationDigest
    });
    const identity: SealedPhysicalExecutionTreeGenerationIdentity = Object.freeze({
      [sealedPhysicalExecutionTreeGenerationIdentityBrand]: true as const,
      ...generationIdentityUnsigned,
      generationDigest: physicalDigest(generationIdentityUnsigned)
    });

    let retired = false;
    let inFlightRetirement: Promise<SealedPhysicalExecutionTreeRetirementReceipt> | null = null;
    let terminalReceipt: SealedPhysicalExecutionTreeRetirementReceipt | null = null;
    let treeReceipt: NoFollowDirectoryTreeRetirementReceipt | null = null;
    let retirementInventory = inventory;
    let reconcileInventoryBeforeRetry = false;
    let treeAuthorityReleased = false;
    const generation: RetainedSealedPhysicalExecutionTreeGeneration = Object.freeze({
      [retainedSealedPhysicalExecutionTreeGenerationBrand]: true as const,
      identity,
      workingDirectory,
      assertCurrent: async () => {
        if (retired) throw new Error('Physical execution tree is retired');
        workingDirectory!.assertCurrent();
        await workingDirectory!.assertAuthorityCurrent();
        for (const protectedRoot of protectedRoots) await protectedRoot.assertCurrent();
      },
      retire: () => {
        if (terminalReceipt !== null) return Promise.resolve(terminalReceipt);
        if (inFlightRetirement !== null) return inFlightRetirement;
        retired = true;
        inFlightRetirement = (async () => {
          let failure: unknown;
          if (reconcileInventoryBeforeRetry && treeReceipt === null) {
            try {
              const current = scanNoFollowDirectoryTreeInventory(generationRoot, {
                deadlineAtMs: freshRecoveryDeadlineAtMonotonicMs(),
                maximumEntries: Math.max(1, inventory!.length + 1),
                maximumBytes: totalBytes
              });
              if (!inventoryIsIdentitySubset(current, inventory!)) {
                throw new Error('Physical execution tree retry inventory contains foreign residue');
              }
              retirementInventory = current;
              reconcileInventoryBeforeRetry = false;
            } catch (error) {
              failure = error;
            }
          }
          if (!treeAuthorityReleased) {
            try {
              await workingDirectory!.retire();
              treeAuthorityReleased = true;
              treeAuthorityState = 'released';
            } catch (error) {
              treeAuthorityState = 'release-failed';
              failure ??= error;
            }
          }
          if (treeReceipt === null && failure === undefined) {
            try {
              treeReceipt = retireNoFollowDirectoryTree({
                deadlineAtMonotonicMs: freshRecoveryDeadlineAtMonotonicMs(),
                inventory: retirementInventory,
                parent: generationParent,
                root: generationRoot
              });
            } catch (error) {
              reconcileInventoryBeforeRetry = true;
              failure = error;
            }
          }
          if (failure !== undefined || !treeAuthorityReleased || treeReceipt === null) {
            const residue = await createResidue({
              generationParent,
              inventory: reconcileInventoryBeforeRetry ? null : retirementInventory,
              links,
              maximumBytes: totalBytes,
              maximumEntries: maximumMaterializedEntries,
              protectedRoots,
              retryable: true,
              root: generationRoot,
              treeAuthority: treeAuthorityState,
              treeRetirement: treeReceipt === null ? 'retirement-failed' : 'physically-absent'
            });
            throw new SealedPhysicalExecutionTreeResidueError(
              'Runtime Physical execution tree retirement left physical residue',
              residue,
              failure
            );
          }
          const currentLinkedSettlements = await linkedSettlements(links);
          const currentProtectedRootSettlements = await protectedRootSettlements(protectedRoots);
          if (currentLinkedSettlements.some(({ status }) => status !== 'borrowed-current')
              || currentProtectedRootSettlements.some(({ status }) => status !== 'current')) {
            const residue = await createResidue({
              generationParent,
              inventory: retirementInventory,
              links,
              maximumBytes: totalBytes,
              maximumEntries: maximumMaterializedEntries,
              protectedRoots,
              retryable: false,
              root: generationRoot,
              treeAuthority: treeAuthorityState,
              treeRetirement: 'physically-absent'
            });
            throw new SealedPhysicalExecutionTreeResidueError(
              'Runtime Physical execution tree retirement lost a borrowed generation identity',
              residue,
              new Error('Borrowed generation settlement is unavailable')
            );
          }
          const receipt: SealedPhysicalExecutionTreeRetirementReceipt = Object.freeze({
            [sealedPhysicalExecutionTreeRetirementReceiptBrand]: true as const,
            generationIdentity: identity,
            linkedSettlements: Object.freeze(currentLinkedSettlements.map((settlement) => (
              Object.freeze({
                path: settlement.path,
                sourceRoot: settlement.sourceRoot,
                status: 'borrowed-current' as const
              })
            ))),
            protectedRootSettlements: Object.freeze(currentProtectedRootSettlements.map(
              (settlement) => Object.freeze({
                root: settlement.root,
                status: 'current' as const
              })
            )),
            treeAuthority: 'released' as const,
            tree: treeReceipt
          });
          issuedSealedPhysicalExecutionTreeRetirementReceipts.add(receipt);
          retirementReceiptRecords.set(receipt, Object.freeze({ generation, identity }));
          terminalReceipt = receipt;
          return receipt;
        })().finally(() => {
          inFlightRetirement = null;
        });
        return inFlightRetirement;
      }
    });
    issuedRetainedSealedPhysicalExecutionTreeGenerations.add(generation);
    issuedSealedPhysicalExecutionTreeGenerationIdentities.add(identity);
    generationIdentityRecords.set(identity, Object.freeze({
      generation,
      linkedGenerations: Object.freeze(links.map(({ source }) => source)),
      protectedRoots: Object.freeze([...protectedRoots]),
      workingDirectory
    }));
    await generation.assertCurrent();
    return generation;
  } catch (error) {
    let cleanupFailure: unknown;
    if (pendingWindowsAuthority !== null) {
      try {
        await pendingWindowsAuthority.release();
        treeAuthorityState = 'released';
      } catch (failure) {
        treeAuthorityState = 'release-failed';
        cleanupFailure ??= failure;
      }
    }
    if (workingDirectory !== null) {
      try {
        await workingDirectory.retire();
        treeAuthorityState = 'released';
      } catch (failure) {
        treeAuthorityState = 'release-failed';
        cleanupFailure ??= failure;
      }
    }
    if (inventory === null) {
      try {
        const observed = scanNoFollowDirectoryTreeInventory(generationRoot, {
          deadlineAtMs: freshRecoveryDeadlineAtMonotonicMs(),
          maximumEntries: Math.max(1, maximumMaterializedEntries + 1),
          maximumBytes: totalBytes
        });
        if (!inventoryIsPublicationSubset(observed, parentPaths, files, publishedLinks)) {
          throw new Error('Runtime Physical execution cleanup inventory contains foreign residue');
        }
        inventory = observed;
      } catch (failure) {
        cleanupFailure ??= failure;
      }
    }
    let treeRetirement: SealedPhysicalExecutionTreeResidue['treeSettlements']['tree'] = 'not-started';
    if (inventory !== null) {
      try {
        retireNoFollowDirectoryTree({
          deadlineAtMonotonicMs: freshRecoveryDeadlineAtMonotonicMs(),
          inventory,
          parent: generationParent,
          root: generationRoot
        });
        treeRetirement = 'physically-absent';
      } catch (failure) {
        treeRetirement = 'retirement-failed';
        inventory = null;
        cleanupFailure ??= failure;
      }
    }
    if (cleanupFailure !== undefined) {
      const residue = await createResidue({
        generationParent,
        inventory,
        links,
        maximumBytes: totalBytes,
        maximumEntries: maximumMaterializedEntries,
        protectedRoots,
        retryable: false,
        root: generationRoot,
        treeAuthority: treeAuthorityState,
        treeRetirement
      });
      throw new SealedPhysicalExecutionTreeResidueError(
        'Runtime Physical execution tree failed and preserved typed physical residue',
        residue,
        new AggregateError([error, cleanupFailure])
      );
    }
    throw error;
  }
}
