import fs from 'node:fs';
import path from 'node:path';

import { rawSha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import type { CodexDevelopmentTestImpactTransitionObservation } from './transition.ts';
import { uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { assertSecRepositoryModuleImportBoundaries, compileSecRepositoryModuleGraph, compileSecRepositoryModuleMembership, normalizeSecRepositoryPath, scanSecRepositoryModuleImports, type SecModuleImportKind, type SecRepositoryModuleGraphImport, type SecRepositoryModuleGraphReference, type SecRepositoryModuleGraph, type SecRepositoryModuleMembership } from '../../../system-architecture/repository-modules/contract.ts';
import { type SourceProgramModel } from '../../../brownfield/source-program-model/contract.ts';
import { compileTypeScriptSourceProgramModelIncremental, isCompiledTypeScriptSourceProgramModel, type TypeScriptSourceProgramIncrementalState } from '../../../brownfield/source-program-model/typescript.ts';
import { currentActiveDocumentationPaths } from '../../../control/documentation/active.ts';
import {
  getTestFilesSync,
  isFastTestFile,
  isSlowTestFile,
} from '../contract/budget.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, scanNoFollowDirectoryTreeMetadata, scanNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, PhysicalNoFollowError, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity, type NoFollowDirectoryTreeInventoryEntry, type NoFollowDirectoryTreeEntry } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  classifyTestImpactSource,
  testImpactModuleIdsForSourceKind,
  type ResolvedTestOwnership,
  type TestImpactRiskPolicy
} from '../contract/ownership.ts';

const compilerRoot = path.resolve(import.meta.dir, '../../../..');
let repositoryModuleMembershipCache: SecRepositoryModuleMembership | null = null;

function repositoryModuleMembershipSync(): SecRepositoryModuleMembership {
  if (repositoryModuleMembershipCache === null) {
    repositoryModuleMembershipCache = compileSecRepositoryModuleMembership(compilerRoot);
  }
  return repositoryModuleMembershipCache;
}

function repositoryModuleGraphRoots(): readonly string[] {
  return repositoryModuleMembershipSync().graphRoots;
}

function sourceProviderMembership(
  provider?: CodexDevelopmentTestImpactSourceProvider
): SecRepositoryModuleMembership {
  return provider?.moduleMembership ?? repositoryModuleMembershipSync();
}

function classifyProviderSource(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
) {
  if (provider === undefined) return classifyTestImpactSource(file);
  const activeDocumentationPaths = new Set(provider.activeDocumentationPaths);
  return classifyTestImpactSource(file, (candidate) => activeDocumentationPaths.has(candidate));
}

function isRepositoryModuleGraphPath(
  relativePath: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): boolean {
  return sourceProviderMembership(provider).graphRoots.some((root) => (
    relativePath === root || relativePath.startsWith(`${root}/`)
  ));
}

function isRepositoryRuntimeModulePath(
  relativePath: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): boolean {
  return sourceProviderMembership(provider).moduleForPath(relativePath)?.importGraph === 'runtime';
}

export type TestImpactSelection = {
  fast: string[];
  slow: string[];
  owners: string[];
};

export function isVerificationInfrastructureFile(file: string): boolean {
  const moduleId = repositoryModuleMembershipSync().moduleForPath(file)?.moduleId;
  return moduleId === 'verification'
    || moduleId === 'development.runner'
    || classifyTestImpactSource(file) === 'workflow';
}

export function isTestImpactSourceFile(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): boolean {
  if (/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)) return false;
  // Explicitly imported machine data is part of the same reverse-import
  // frontier as TypeScript leaves.  It must not be mistaken for an
  // uninteresting declarative file: a changed JSON registry can invalidate a
  // consumer test even though the data itself is not parsed by Bun's TS
  // transpiler.  The graph provider still observes only compiler modules;
  // this path merely admits the changed target into that existing graph.
  if (isTestImpactModuleGraphInputFile(file, provider)) return true;
  return classifyProviderSource(file, provider) !== null;
}

/**
 * True only for a current repository leaf that can participate in the
 * TypeScript reverse-import graph. Declarative owners (docs/YAML/package
 * metadata) remain affected-test sources for fallback selection, but they do
 * not require a full source-graph observation or its filesystem budget.
 */
export function isTestImpactModuleGraphSourceFile(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): boolean {
  return !/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)
    && /\.[cm]?tsx?$/u.test(file)
    && isRepositoryModuleGraphPath(file, provider)
    && isRepositoryRuntimeModulePath(file, provider);
}

/**
 * A changed path can be a graph target without being a compiler source leaf.
 * Keep this set deliberately narrow and deterministic: these are the
 * explicit machine-data formats accepted by the existing import-candidate
 * resolver.  Other declarative paths continue through their canonical
 * ownership/fallback declarations and do not force a graph census.
 */
export function isTestImpactModuleGraphInputFile(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): boolean {
  return isTestImpactModuleGraphSourceFile(file, provider)
    || (
      !/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)
      && /\.(?:json|ya?ml|toml)$/u.test(file)
      && isRepositoryModuleGraphPath(file, provider)
      && isRepositoryRuntimeModulePath(file, provider)
    );
}

function addAll(target: Set<string>, values: readonly string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function normalizeRepoPath(value: string): string {
  return normalizeSecRepositoryPath(value);
}

export type RepositoryModuleImportKindV1 = SecModuleImportKind;
export type RepositoryModuleImport = SecRepositoryModuleGraphImport;

/**
 * Parser-cache adapter only.  Import syntax and specifier semantics belong to
 * repository-modules; this function preserves the existing cache's mutable
 * array shape without creating another parser or resolver.
 */
function scanRepositoryModuleImports(source: string): RepositoryModuleImport[] {
  // The registry scanner recognizes CommonJS `require` for the full
  // repository graph. Test-impact preserves its existing TS compiler-module
  // projection (static/dynamic ESM records only); this is a projection policy,
  // not another parser or local specifier resolver.
  return [...scanSecRepositoryModuleImports(source)]
    .filter(({ kind }) => kind !== 'require')
    .map((entry) => Object.freeze({
    kind: entry.kind,
    specifier: entry.specifier
  }));
}

export type CodexDevelopmentTestImpactSourceProvider = {
  moduleMembership: SecRepositoryModuleMembership;
  activeDocumentationPaths: readonly string[];
  moduleFiles: readonly string[];
  testFiles: readonly string[];
  /** Compiler-resolved semantic references for the exact same source epoch. */
  sourceProgramModel?: SourceProgramModel;
  readModuleSource: (moduleFile: string) => string | null;
  /**
   * Optional typed read seam. `null` in the legacy callback is retained for
   * compatibility, but a provider that owns a physical snapshot can
   * distinguish a literal absent entry from an unavailable/unsafe read.
   */
  readModuleSourceResult?: (moduleFile: string) => TestImpactModuleSourceReadResult;
  /** Discovery failures are part of the graph frontier, never an empty set. */
  unresolvedModuleFiles?: readonly string[];
  /** Immutable identity of the observed compiler-root/source epoch. */
  observation?: TestImpactSourceObservation;
  /** Re-observe the same physical source epoch at the plan fence. */
  verifyObservation?: () => boolean;
};

export type TestImpactModuleSourceReadResult =
  | Readonly<{ kind: 'present'; source: string }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'unavailable'; reason: 'permission' | 'io' | 'unsafe' | 'drift' | 'capability' }>;

export type TestImpactSourceObservation = Readonly<{
  schema: 'sec-test-impact-source-observation-v1';
  compilerRoot: string;
  compilerRootIdentity: string;
  moduleInventoryDigest: `sha256:${string}`;
  sourceDigest: `sha256:${string}`;
  sourceEpoch: `sha256:${string}`;
  physicalIdentities: readonly TestImpactPhysicalIdentity[];
}>;

/**
 * Total budget for one invocation-local source observation and every later
 * verification of that same epoch. No revalidation receives a fresh deadline,
 * entry allowance, or byte allowance.
 */
export type TestImpactSourceObservationBudget = Readonly<{
  deadlineMs: number;
  maxSourceBytes: number;
  maxEntries: number;
  maxVerifications: number;
}>;

const DEFAULT_TEST_IMPACT_SOURCE_OBSERVATION_BUDGET: TestImpactSourceObservationBudget = Object.freeze({
  deadlineMs: 5_000,
  maxSourceBytes: 128 * 1024 * 1024,
  maxEntries: 100_000,
  maxVerifications: 16
});

type MutableTestImpactSourceObservationBudgetState = {
  readonly budget: TestImpactSourceObservationBudget;
  readonly startedAtMs: number;
  readonly deadlineAtMs: number;
  sourceBytes: number;
  recordCount: number;
  failed: boolean;
};

function sourceObservationBudgetState(
  input: Partial<TestImpactSourceObservationBudget> = {}
): MutableTestImpactSourceObservationBudgetState {
  const budget = Object.freeze({
    ...DEFAULT_TEST_IMPACT_SOURCE_OBSERVATION_BUDGET,
    ...input
  });
  for (const [label, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Test-impact source observation ${label} must be a positive safe integer.`);
    }
  }
  const startedAtMs = performance.now();
  return {
    budget,
    startedAtMs,
    deadlineAtMs: startedAtMs + budget.deadlineMs,
    sourceBytes: 0,
    recordCount: 0,
    failed: false
  };
}

function sourceObservationBudgetAvailable(
  state: MutableTestImpactSourceObservationBudgetState,
  bytes = 0,
  records = 0
): boolean {
  if (state.failed) return false;
  if (performance.now() > state.deadlineAtMs
      || !Number.isSafeInteger(bytes) || bytes < 0
      || !Number.isSafeInteger(records) || records < 0
      || state.recordCount + records > state.budget.maxEntries
      || state.sourceBytes + bytes > state.budget.maxSourceBytes) {
    state.failed = true;
    return false;
  }
  return true;
}

function accountSourceObservation(
  state: MutableTestImpactSourceObservationBudgetState,
  bytes = 0,
  records = 0
): boolean {
  if (!sourceObservationBudgetAvailable(state, bytes, records)) return false;
  state.sourceBytes += bytes;
  state.recordCount += records;
  if (performance.now() > state.deadlineAtMs) {
    state.failed = true;
    return false;
  }
  return true;
}

export type TestImpactPhysicalIdentity = Readonly<{
  relativePath: string;
  kind: 'directory' | 'file';
  /** Handle-derived path and object identity, not a path-only provider key. */
  finalPath: string;
  device: string;
  inode: string;
  objectId: string;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  /** Every lexical ancestor proved through the no-follow backend. */
  ancestorChain: readonly TestImpactAncestorPhysicalIdentity[];
}>;

export type TestImpactAncestorPhysicalIdentity = Readonly<{
  path: string;
  finalPath: string;
  device: string;
  inode: string;
  objectId: string;
}>;

const reusableRepositorySourceProviders = new WeakSet<object>();

/**
 * Compile the canonical TestImpact source view from an already observed tree.
 * The caller owns physical observation; this owner alone decides which tracked
 * paths participate in the TypeScript module graph and which are tests.
 */
export function createTestImpactSourceProvider(input: Readonly<{
  repositoryFiles: readonly string[];
  moduleMembership: SecRepositoryModuleMembership;
  activeDocumentationPaths: readonly string[];
  readModuleSource: (moduleFile: string) => string | null;
  readModuleSourceResult?: (moduleFile: string) => TestImpactModuleSourceReadResult;
  unresolvedModuleFiles?: readonly string[];
  observation?: TestImpactSourceObservation;
  verifyObservation?: () => boolean;
  sourceProgramModel?: SourceProgramModel;
}>): CodexDevelopmentTestImpactSourceProvider {
  const repositoryFiles = uniqueSorted(input.repositoryFiles.map((repositoryFile) => {
    const normalized = normalizeRepoPath(repositoryFile);
    if (normalized !== repositoryFile
        || normalized.length === 0
        || normalized === '.'
        || normalized.startsWith('../')
        || normalized.includes('/../')
        || normalized.includes('/./')
        || normalized.includes('\0')) {
      throw new Error(`Test impact repository file is not canonical: ${repositoryFile}.`);
    }
    return normalized;
  }));
  const moduleFiles = Object.freeze(repositoryFiles.filter((repositoryFile) => (
    /\.[cm]?tsx?$/u.test(repositoryFile)
    && input.moduleMembership.graphRoots.some((root) => (
      repositoryFile === root || repositoryFile.startsWith(`${root}/`)
    ))
    && input.moduleMembership.moduleForPath(repositoryFile)?.importGraph === 'runtime'
  )));
  const moduleFileSet = new Set(moduleFiles);
  const testFiles = Object.freeze(moduleFiles.filter((moduleFile) => (
    /^tests\/.+\.(?:test|spec)\.tsx?$/u.test(moduleFile)
  )));
  const unresolvedModuleFiles = Object.freeze(uniqueSorted(
    (input.unresolvedModuleFiles ?? []).map(normalizeRepoPath)
  ));
  if (input.sourceProgramModel !== undefined) {
    if (!isCompiledTypeScriptSourceProgramModel(input.sourceProgramModel)) {
      throw new Error('Test impact source program model must be compiler-issued.');
    }
    const modelPaths = input.sourceProgramModel.files.map(({ path: modelPath }) => modelPath);
    if (JSON.stringify(modelPaths) !== JSON.stringify(moduleFiles)) {
      throw new Error('Test impact source program model must bind the exact module file census.');
    }
  }
  return Object.freeze({
    moduleMembership: input.moduleMembership,
    activeDocumentationPaths: Object.freeze(uniqueSorted(input.activeDocumentationPaths)),
    moduleFiles,
    testFiles,
    unresolvedModuleFiles,
    ...(input.sourceProgramModel === undefined ? {} : { sourceProgramModel: input.sourceProgramModel }),
    ...(input.observation === undefined ? {} : { observation: input.observation }),
    ...(input.verifyObservation === undefined ? {} : { verifyObservation: input.verifyObservation }),
    readModuleSource: (moduleFile: string): string | null => (
      moduleFileSet.has(moduleFile) ? input.readModuleSource(moduleFile) : null
    ),
    ...(input.readModuleSourceResult === undefined ? {} : {
      readModuleSourceResult: (moduleFile: string): TestImpactModuleSourceReadResult => (
        moduleFileSet.has(moduleFile)
          ? input.readModuleSourceResult!(moduleFile)
          : { kind: 'absent' }
      )
    })
  });
}

type RepositoryModuleDiscovery = Readonly<{
  files: readonly string[];
  unresolvedModuleFiles: readonly string[];
}>;

type RepositoryModuleSourceObservation = Readonly<{
  result: TestImpactModuleSourceReadResult;
  /** The retained no-follow file observation used to decode `result.source`. */
  entry: NoFollowDirectoryTreeEntry | null;
  /** Full no-follow chain for the file's lexical parent. */
  parentChain: PhysicalDirectoryChain | null;
}>;

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '').toUpperCase()
    : '';
}

function classifyNoFollowFailure(error: unknown): TestImpactModuleSourceReadResult {
  if (error instanceof PhysicalNoFollowError) {
    if (error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return { kind: 'absent' };
    if (error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') {
      return { kind: 'unavailable', reason: 'capability' };
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') {
      return { kind: 'unavailable', reason: 'drift' };
    }
    return { kind: 'unavailable', reason: 'unsafe' };
  }
  const code = errorCode(error);
  if (code === 'ENOENT') return { kind: 'absent' };
  if (code === 'EACCES' || code === 'EPERM') return { kind: 'unavailable', reason: 'permission' };
  return { kind: 'unavailable', reason: 'io' };
}

function classifyRepositoryModuleSourceObservation(
  moduleFile: string,
  entryOverride?: NoFollowDirectoryTreeEntry | null,
  parentChainOverride?: PhysicalDirectoryChain | null
): RepositoryModuleSourceObservation {
  const absolutePath = path.join(compilerRoot, moduleFile);
  const parentPath = path.dirname(absolutePath);
  let parentChain: PhysicalDirectoryChain | null = parentChainOverride ?? null;
  if (parentChainOverride === undefined) {
    try {
      parentChain = inspectNoFollowDirectoryChain(parentPath, `Test-impact source parent ${moduleFile}`);
    } catch (error) {
      return Object.freeze({ result: classifyNoFollowFailure(error), entry: null, parentChain: null });
    }
  }
  if (parentChain === null) {
    return Object.freeze({
      result: { kind: 'unavailable', reason: 'unsafe' },
      entry: null,
      parentChain: null
    });
  }
  let entry: NoFollowDirectoryTreeEntry | null = entryOverride ?? null;
  if (entryOverride === undefined) {
    try {
      entry = inspectNoFollowOrdinaryFileEntry(
        parentChain.target,
        path.basename(moduleFile)
      );
    } catch (error) {
      return Object.freeze({ result: classifyNoFollowFailure(error), entry: null, parentChain });
    }
  }
  if (entry === null) {
    return Object.freeze({ result: { kind: 'absent' }, entry: null, parentChain });
  }
  if (entry.kind !== 'file' || entry.bytes === null) {
    return Object.freeze({
      result: { kind: 'unavailable', reason: 'unsafe' },
      entry,
      parentChain
    });
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
    return Object.freeze({ result: { kind: 'present', source }, entry, parentChain });
  } catch {
    return Object.freeze({ result: { kind: 'unavailable', reason: 'io' }, entry, parentChain });
  }
}

type RepositoryModuleSourceObservationBatch = Readonly<{
  observations: ReadonlyMap<string, RepositoryModuleSourceObservation>;
  /** Canonical content digests, including entries whose bytes are not retained. */
  contentDigests: ReadonlyMap<string, `sha256:${string}`>;
  /** One no-follow traversal's retained directory topology for parent binding. */
  directoryEntries: ReadonlyMap<string, NoFollowDirectoryTreeEntry>;
  /** Root chains are observed once per canonical module root and reused below. */
  rootChains: ReadonlyMap<string, PhysicalDirectoryChain>;
  /** Module files discovered by the same retained tree census. */
  discoveredFiles: readonly string[];
  /** Unsafe/unavailable frontiers discovered by that same census. */
  unresolvedModuleFiles: readonly string[];
}>;

type TestImpactUnavailableSourceReason = Extract<
  TestImpactModuleSourceReadResult,
  { readonly kind: 'unavailable' }
>['reason'];

function sourceContentDigest(bytes: Uint8Array): `sha256:${string}` {
  // This is the same framed domain used by scanNoFollowDirectoryTreeInventory
  // (`{"bytes":"<lowercase hex>"}`), allowing a streaming final fence to
  // compare against the retained initial read without retaining the whole tree.
  return rawSha256(`{"bytes":"${Buffer.from(bytes).toString('hex')}"}`);
}

function inventoryEntryAsTreeEntry(
  entry: NoFollowDirectoryTreeInventoryEntry,
  relativePath: string
): NoFollowDirectoryTreeEntry {
  return Object.freeze({
    relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    bytes: null,
    linkTarget: entry.linkTarget
  });
}

function fullModuleTreePath(relativeRoot: string, relativePath: string): string {
  return normalizeRepoPath(
    relativePath.length === 0 ? relativeRoot : `${relativeRoot}/${relativePath}`
  );
}

/**
 * Project one retained tree entry into this owner's physical identity shape.
 * The no-follow tree scanner has already opened and checked the entry; doing
 * another path-based lstat here would reintroduce a mixed-observation window.
 */
function physicalDirectoryIdentityFromTreeEntry(
  relativePath: string,
  entry: NoFollowDirectoryTreeEntry
): PhysicalDirectoryIdentity | null {
  if (entry.kind !== 'directory') return null;
  const absolutePath = path.join(compilerRoot, relativePath);
  return Object.freeze({
    path: absolutePath,
    finalPath: absolutePath,
    device: entry.device,
    inode: entry.inode,
    objectId: `tree:${entry.device}:${entry.inode}`
  });
}

/**
 * Reconstruct a lexical parent chain from one retained tree census. Every
 * component must be present as an ordinary directory entry; an omitted child
 * or ancestor remains an unresolved frontier rather than triggering a second
 * path walk.
 */
function parentChainFromTreeEntries(
  relativeDirectory: string,
  rootChains: ReadonlyMap<string, PhysicalDirectoryChain>,
  directoryEntries: ReadonlyMap<string, NoFollowDirectoryTreeEntry>
): PhysicalDirectoryChain | null {
  const relativeRoot = repositoryModuleGraphRoots().find((rootName) => (
    relativeDirectory === rootName || relativeDirectory.startsWith(`${rootName}/`)
  ));
  if (relativeRoot === undefined) return null;
  const rootChain = rootChains.get(relativeRoot);
  if (rootChain === undefined) return null;
  if (relativeDirectory === relativeRoot) return rootChain;

  const suffix = relativeDirectory.slice(relativeRoot.length + 1).split('/').filter(Boolean);
  const ancestors = [...rootChain.ancestors];
  let current: string = relativeRoot;
  for (const segment of suffix) {
    current = `${current}/${segment}`;
    const identity = physicalDirectoryIdentityFromTreeEntry(
      current,
      directoryEntries.get(current) ?? {
        relativePath: current,
        kind: 'link',
        device: '',
        inode: '',
        size: 0,
        bytes: null,
        linkTarget: null
      }
    );
    if (identity === null) return null;
    ancestors.push(identity);
  }
  const target = ancestors.at(-1);
  if (target === undefined) return null;
  return Object.freeze({ target, ancestors: Object.freeze(ancestors) });
}

function unavailableSourceObservation(
  reason: TestImpactUnavailableSourceReason,
  parentChain: PhysicalDirectoryChain | null = null
): RepositoryModuleSourceObservation {
  return Object.freeze({
    result: { kind: 'unavailable', reason },
    entry: null,
    parentChain
  });
}

/**
 * Snapshot all module leaves with bounded metadata inventories followed by
 * retained ordinary-file reads. Verification uses a streaming no-follow
 * inventory, so an execution boundary does not perform O(files) path walks or
 * retain a second full source tree in memory. Both phases share one operation
 * budget; a later verification gets a fresh bounded operation budget.
 */
function observeRepositoryModuleSources(
  files: readonly string[] | null,
  root: RepositoryRootIdentity,
  state: MutableTestImpactSourceObservationBudgetState,
  mode: 'initial' | 'verify'
): RepositoryModuleSourceObservationBatch {
  const observations = new Map<string, RepositoryModuleSourceObservation>();
  const contentDigests = new Map<string, `sha256:${string}`>();
  const directoryEntries = new Map<string, NoFollowDirectoryTreeEntry>();
  const rootChains = new Map<string, PhysicalDirectoryChain>();
  if (!root.safe || root.chain === null || state.failed) {
    for (const file of files ?? []) observations.set(file, unavailableSourceObservation(
      root.state === 'unavailable' ? 'capability' : 'unsafe'
    ));
    return Object.freeze({
      observations,
      contentDigests,
      directoryEntries,
      rootChains,
      discoveredFiles: Object.freeze([...(files ?? [])]),
      unresolvedModuleFiles: Object.freeze(root.state === 'present' ? [] : ['compiler-root'])
    });
  }

  const initialEntriesByRoot = new Map<string, ReadonlyMap<string, NoFollowDirectoryTreeEntry>>();
  const inventoryByRoot = new Map<string, ReadonlyMap<string, NoFollowDirectoryTreeInventoryEntry>>();
  const failedRoots = new Map<string, TestImpactUnavailableSourceReason>();

  for (const relativeRoot of repositoryModuleGraphRoots()) {
    if (!sourceObservationBudgetAvailable(state, 0, 1)) break;
    const absoluteRoot = path.join(compilerRoot, relativeRoot);
    let chain: PhysicalDirectoryChain;
    try {
      chain = inspectNoFollowDirectoryChain(
        absoluteRoot,
        `Test-impact module root ${relativeRoot}`
      );
    } catch (error) {
      const result = classifyNoFollowFailure(error);
      if (result.kind !== 'absent') failedRoots.set(
        relativeRoot,
        (result as Extract<TestImpactModuleSourceReadResult, { readonly kind: 'unavailable' }>).reason
      );
      continue;
    }
    rootChains.set(relativeRoot, chain);
    if (!accountSourceObservation(state, 0, 1)) break;
    const remainingEntries = state.budget.maxEntries - state.recordCount;
    const remainingBytes = state.budget.maxSourceBytes - state.sourceBytes;
    if (!sourceObservationBudgetAvailable(state, 0, 1)
        || remainingEntries < 1
        || remainingBytes < 0) {
      state.failed = true;
      break;
    }
    if (mode === 'initial') {
      // The retained scanner checks each ordinary leaf's size before reading
      // it, so this one traversal both discovers the closure and enforces the
      // aggregate source-byte ceiling without a preceding path/metadata epoch.
      let scanned: readonly NoFollowDirectoryTreeEntry[];
      try {
        scanned = scanNoFollowDirectoryTree(chain.target, {
          deadlineAtMs: state.deadlineAtMs,
          maximumEntries: remainingEntries,
          maximumBytes: remainingBytes
        });
      } catch (error) {
        const result = classifyNoFollowFailure(error);
        failedRoots.set(relativeRoot, result.kind === 'unavailable' ? result.reason : 'io');
        state.failed = true;
        break;
      }
      const actualBytes = scanned
        .filter((entry) => entry.kind === 'file')
        // On bounded-byte scans use the retained read length, not only the
        // pre-read metadata size. A same-inode file can grow during the read;
        // accounting the actual retained bytes makes the post-read budget
        // fence fail closed instead of silently undercounting the allocation.
        .reduce((total, entry) => total + (entry.bytes?.byteLength ?? entry.size), 0);
      if (!accountSourceObservation(state, actualBytes, scanned.length)) {
        state.failed = true;
        break;
      }
      const initialEntries = new Map<string, NoFollowDirectoryTreeEntry>();
      for (const entry of scanned) {
        initialEntries.set(entry.relativePath, entry);
        directoryEntries.set(fullModuleTreePath(relativeRoot, entry.relativePath), entry);
      }
      initialEntriesByRoot.set(relativeRoot, initialEntries);
    } else {
      // The streaming retained scanner applies the same pre-read byte
      // reservation as the initial bounded scanner; no second metadata walk
      // is needed for a fresh verification epoch.
      let inventory: readonly NoFollowDirectoryTreeInventoryEntry[];
      try {
        inventory = scanNoFollowDirectoryTreeInventory(chain.target, {
          deadlineAtMs: state.deadlineAtMs,
          maximumEntries: state.budget.maxEntries - state.recordCount,
          maximumBytes: remainingBytes
        });
      } catch (error) {
        const result = classifyNoFollowFailure(error);
        failedRoots.set(relativeRoot, result.kind === 'unavailable' ? result.reason : 'io');
        state.failed = true;
        break;
      }
      const actualBytes = inventory
        .filter((entry) => entry.kind === 'file')
        .reduce((total, entry) => total + entry.size, 0);
      if (!accountSourceObservation(state, actualBytes, inventory.length)) {
        state.failed = true;
        break;
      }
      const inventoryEntries = new Map<string, NoFollowDirectoryTreeInventoryEntry>();
      for (const entry of inventory) {
        inventoryEntries.set(entry.relativePath, entry);
        directoryEntries.set(
          fullModuleTreePath(relativeRoot, entry.relativePath),
          inventoryEntryAsTreeEntry(entry, entry.relativePath)
        );
      }
      inventoryByRoot.set(relativeRoot, inventoryEntries);
    }
  }

  const discoveredFiles = files === null
    ? uniqueSorted([...directoryEntries.entries()]
      .filter(([relativePath, entry]) => (
        entry.kind === 'file'
          // Keep the physical snapshot aligned with the same graph-input
          // predicate used by selection.  Explicitly imported machine data
          // (JSON/YAML/TOML) participates in the reverse-import graph even
          // though it is not a Bun transpiler module; omitting it here would
          // let a selected data source drift outside the source epoch fence.
          && isTestImpactModuleGraphInputFile(relativePath)
          && isRepositoryModuleGraphPath(relativePath)
          && isRepositoryRuntimeModulePath(relativePath)
      ))
      .map(([relativePath]) => relativePath))
    : uniqueSorted([...files]);
  const unresolvedModuleFiles = new Set<string>();
  for (const [relativePath, entry] of directoryEntries) {
    if (entry.kind === 'link' && isRepositoryRuntimeModulePath(relativePath)) {
      unresolvedModuleFiles.add(relativePath);
    }
  }
  for (const [relativeRoot, reason] of failedRoots) {
    if (reason !== 'unsafe' && reason !== 'io' && reason !== 'permission'
        && reason !== 'drift' && reason !== 'capability') continue;
    unresolvedModuleFiles.add(relativeRoot);
  }
  if (state.failed) unresolvedModuleFiles.add('compiler-root');

  const parentChains = new Map<string, PhysicalDirectoryChain | null>();
  for (const file of discoveredFiles) {
    const relativeRoot = repositoryModuleGraphRoots().find((rootName) => (
      file === rootName || file.startsWith(`${rootName}/`)
    ));
    const failedReason = relativeRoot === undefined ? 'unsafe' : failedRoots.get(relativeRoot);
    if (failedReason !== undefined) {
      observations.set(file, unavailableSourceObservation(failedReason));
      continue;
    }
    if (state.failed) {
      observations.set(file, unavailableSourceObservation('io'));
      continue;
    }
    const relativeDirectory = normalizeRepoPath(path.dirname(file));
    let parentChain = parentChains.get(relativeDirectory);
    if (!parentChains.has(relativeDirectory)) {
      if (!sourceObservationBudgetAvailable(state, 0, 1)) {
        parentChain = null;
      } else {
        parentChain = parentChainFromTreeEntries(
          relativeDirectory,
          rootChains,
          directoryEntries
        );
        if (!accountSourceObservation(state, 0, 1)) parentChain = null;
      }
      parentChains.set(relativeDirectory, parentChain ?? null);
    }
    const stableParentChain = parentChain ?? null;
    if (stableParentChain === null) {
      observations.set(file, unavailableSourceObservation('unsafe'));
      continue;
    }
    const relativeRootEntryPath = relativeRoot === undefined
      ? file
      : file.slice(relativeRoot.length).replace(/^\//u, '');
    const sourceEntry = (mode === 'verify'
      ? inventoryByRoot.get(relativeRoot!)?.get(relativeRootEntryPath)
      : initialEntriesByRoot.get(relativeRoot!)?.get(relativeRootEntryPath));
    if (sourceEntry === undefined) {
      // The discovery snapshot named this file, but the no-follow inventory
      // omitted it. Treat it as drift, never as an optional empty module.
      observations.set(file, unavailableSourceObservation('drift', stableParentChain));
      continue;
    }
    if (sourceEntry.kind !== 'file') {
      observations.set(file, unavailableSourceObservation('unsafe', parentChain));
      continue;
    }
    if (mode === 'verify') {
      const inventoryEntry = sourceEntry as NoFollowDirectoryTreeInventoryEntry;
      if (inventoryEntry.contentDigest === null) {
        observations.set(file, unavailableSourceObservation('io', stableParentChain));
        continue;
      }
      observations.set(file, Object.freeze({
        result: { kind: 'present', source: '' },
        entry: inventoryEntryAsTreeEntry(inventoryEntry, relativeRootEntryPath),
        parentChain: stableParentChain
      }));
      contentDigests.set(file, inventoryEntry.contentDigest);
      continue;
    }
    const initialEntry = sourceEntry as NoFollowDirectoryTreeEntry;
    const observed = classifyRepositoryModuleSourceObservation(file, initialEntry, stableParentChain);
    const actualBytes = observed.entry?.bytes?.byteLength ?? 0;
    const sameSize = observed.result.kind !== 'present' || actualBytes === initialEntry.size;
    const result = sameSize
      ? observed
      : unavailableSourceObservation('drift', stableParentChain);
    observations.set(file, result);
    const retainedBytes = result.entry?.bytes;
    if (result.result.kind === 'present' && retainedBytes !== null && retainedBytes !== undefined) {
      contentDigests.set(file, sourceContentDigest(retainedBytes));
    }
  }
  return Object.freeze({
    observations,
    contentDigests,
    directoryEntries,
    rootChains,
    discoveredFiles: Object.freeze(discoveredFiles),
    unresolvedModuleFiles: Object.freeze(uniqueSorted([...unresolvedModuleFiles]))
  });
}

function classifyRepositoryModuleSourceRead(
  moduleFile: string
): TestImpactModuleSourceReadResult {
  return classifyRepositoryModuleSourceObservation(moduleFile).result;
}

function collectRepositoryModuleFilesSync(
  state?: MutableTestImpactSourceObservationBudgetState
): RepositoryModuleDiscovery {
  // The provider-backed affected path performs its full source census below.
  // Keep the legacy/default graph discovery on the same no-follow topology
  // owner so a child directory that disappears after enumeration cannot be
  // silently converted into an empty subtree. The physical inventory itself
  // is authoritative for the current test/module leaf set.
  const unresolvedModuleFiles = new Set<string>();
  const files = new Set<string>();
  const deadlineAtMs = state?.deadlineAtMs ?? performance.now() + 5_000;
  const maximumEntries = state?.budget.maxEntries ?? 100_000;
  for (const relativeRoot of repositoryModuleGraphRoots()) {
    if (state !== undefined && !sourceObservationBudgetAvailable(state, 0, 1)) {
      unresolvedModuleFiles.add(relativeRoot);
      continue;
    }
    let chain: PhysicalDirectoryChain;
    try {
      chain = inspectNoFollowDirectoryChain(
        path.join(compilerRoot, relativeRoot),
        `Test-impact module discovery root ${relativeRoot}`
      );
    } catch (error) {
      const result = classifyNoFollowFailure(error);
      if (result.kind !== 'absent') unresolvedModuleFiles.add(relativeRoot);
      if (state !== undefined && result.kind !== 'absent') state.failed = true;
      continue;
    }
    let entries: readonly NoFollowDirectoryTreeInventoryEntry[];
    try {
      entries = scanNoFollowDirectoryTreeMetadata(chain.target, {
        deadlineAtMs,
        maximumEntries: state === undefined
          ? maximumEntries
          : Math.max(1, maximumEntries - state.recordCount)
      });
    } catch (error) {
      const result = classifyNoFollowFailure(error);
      unresolvedModuleFiles.add(relativeRoot);
      if (state !== undefined) state.failed = true;
      continue;
    }
    if (state !== undefined && !accountSourceObservation(state, 0, entries.length)) {
      unresolvedModuleFiles.add(relativeRoot);
      continue;
    }
    for (const entry of entries) {
      const relativePath = fullModuleTreePath(relativeRoot, entry.relativePath);
      if (!isRepositoryRuntimeModulePath(relativePath)) continue;
      if (entry.kind === 'link') {
        // A linked directory can hide arbitrary module leaves. Preserve the
        // lexical link as an unsafe frontier instead of treating it as empty.
        unresolvedModuleFiles.add(relativePath);
        continue;
      }
      if (entry.kind === 'file' && /\.[cm]?tsx?$/u.test(relativePath)) {
        files.add(relativePath);
      }
    }
  }
  if (state !== undefined && !sourceObservationBudgetAvailable(state)) {
    unresolvedModuleFiles.add('compiler-root');
  }
  return Object.freeze({
    files: Object.freeze(uniqueSorted([...files])),
    unresolvedModuleFiles: Object.freeze(uniqueSorted([...unresolvedModuleFiles]))
  });
}

let repositoryModuleFilesCache: RepositoryModuleDiscovery | null = null;
let repositorySourceProgramState: TypeScriptSourceProgramIncrementalState | null = null;

function repositoryModuleDiscoverySync(): RepositoryModuleDiscovery {
  if (repositoryModuleFilesCache !== null) return repositoryModuleFilesCache;
  repositoryModuleFilesCache = collectRepositoryModuleFilesSync();
  return repositoryModuleFilesCache;
}

function framedSourceDigest(
  files: readonly string[],
  sources: ReadonlyMap<string, string>
): `sha256:${string}` {
  const frames: Buffer[] = [];
  for (const file of files) {
    const pathBytes = Buffer.from(file, 'utf8');
    const sourceBytes = Buffer.from(sources.get(file) ?? '', 'utf8');
    frames.push(
      Buffer.from(`${pathBytes.byteLength}:`, 'utf8'),
      pathBytes,
      Buffer.from('\0', 'utf8'),
      Buffer.from(`${sourceBytes.byteLength}:`, 'utf8'),
      sourceBytes,
      Buffer.from('\0', 'utf8')
    );
  }
  return rawSha256(Buffer.concat(frames));
}

type RepositoryRootIdentity = Readonly<{
  safe: boolean;
  state: 'present' | 'absent' | 'unsafe' | 'unavailable';
  token: string;
  chain: PhysicalDirectoryChain | null;
  identity: TestImpactPhysicalIdentity | null;
}>;

function ancestorIdentity(
  identity: PhysicalDirectoryIdentity
): TestImpactAncestorPhysicalIdentity {
  return Object.freeze({
    path: identity.path,
    finalPath: identity.finalPath,
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

function noFollowChainToken(chain: PhysicalDirectoryChain): string {
  return JSON.stringify({
    target: chain.target,
    ancestors: chain.ancestors
  });
}

function statMatchesNoFollowIdentity(
  stat: fs.Stats,
  identity: PhysicalDirectoryIdentity,
  kind: 'directory' | 'file'
): boolean {
  // On POSIX, the public fs stat pair is the same identity domain as the
  // no-follow backend. Windows' Node stat inode is a decimal compatibility
  // projection, while the retained backend binds the native FileIdInfo bytes;
  // in that domain the no-follow identity itself is authoritative.
  return !stat.isSymbolicLink()
    && (kind === 'directory' ? stat.isDirectory() : stat.isFile())
    && (process.platform === 'win32'
      || (String(stat.dev) === identity.device && String(stat.ino) === identity.inode));
}

function physicalIdentityFromDirectoryChain(
  chain: PhysicalDirectoryChain,
  relativePath: string
): TestImpactPhysicalIdentity | null {
  // The chain itself is the retained no-follow observation. A second lstat
  // would be a path-based, potentially different object and could combine
  // metadata from a replacement with the retained chain. The source epoch
  // binds physical identity/content, not mutable directory timestamps.
  return Object.freeze({
    relativePath,
    kind: 'directory' as const,
    finalPath: chain.target.finalPath,
    device: chain.target.device,
    inode: chain.target.inode,
    objectId: chain.target.objectId,
    mode: 0,
    size: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    ancestorChain: Object.freeze(chain.ancestors.map(ancestorIdentity))
  });
}

function physicalIdentityFromFileEntry(
  absolutePath: string,
  relativePath: string,
  parentChain: PhysicalDirectoryChain,
  entry: NoFollowDirectoryTreeEntry
): TestImpactPhysicalIdentity | null {
  if (entry.kind !== 'file') return null;
  // Do not combine a retained no-follow read with a later path-based stat.
  // On Windows that would create a mixed observation when the leaf is
  // replaced between the two calls. The retained entry and its parent chain
  // are the sole identity authority; metadata not exposed by that primitive
  // is deliberately neutral rather than treated as a second identity source.
  return Object.freeze({
    relativePath,
    kind: 'file' as const,
    finalPath: absolutePath,
    device: entry.device,
    inode: entry.inode,
    // The public physical-no-follow leaf projection exposes the stable
    // device/inode pair; keep it as the leaf object identity while the
    // ancestor chain retains the backend's richer object IDs.
    objectId: `${entry.device}:${entry.inode}`,
    mode: 0,
    size: entry.size,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    ancestorChain: Object.freeze(parentChain.ancestors.map(ancestorIdentity))
  });
}

function repositoryRootPhysicalIdentity(): RepositoryRootIdentity {
  try {
    const chain = inspectNoFollowDirectoryChain(compilerRoot, 'Test-impact compiler root');
    const identity = physicalIdentityFromDirectoryChain(chain, '');
    if (identity === null) {
      return Object.freeze({
        safe: false,
        state: 'unsafe',
        token: 'unsafe-root',
        chain: null,
        identity: null
      });
    }
    return Object.freeze({
      safe: true,
      state: 'present',
      token: noFollowChainToken(chain),
      chain,
      identity
    });
  } catch (error) {
    const result = classifyNoFollowFailure(error);
    const state = result.kind === 'absent'
      ? 'absent' as const
      : result.kind === 'unavailable' && result.reason === 'capability'
        ? 'unavailable' as const
        : 'unsafe' as const;
    return Object.freeze({
      safe: false,
      state,
      token: `${state}-root`,
      chain: null,
      identity: null
    });
  }
}

function sourcePhysicalIdentities(
  files: readonly string[],
  root: RepositoryRootIdentity,
  observations: ReadonlyMap<string, RepositoryModuleSourceObservation> = new Map()
): Readonly<{
  identities: readonly TestImpactPhysicalIdentity[];
  complete: boolean;
  missingPaths: readonly string[];
}> {
  const expectedPaths = new Set<string>(['']);
  for (const file of files) {
    expectedPaths.add(file);
    let directory = normalizeRepoPath(path.dirname(file));
    while (directory !== '.') {
      expectedPaths.add(directory);
      const parent = normalizeRepoPath(path.dirname(directory));
      if (parent === directory) break;
      directory = parent;
    }
  }
  if (!root.safe || root.identity === null || root.chain === null) {
    return Object.freeze({
      identities: Object.freeze([]),
      complete: false,
      missingPaths: Object.freeze([...expectedPaths].sort())
    });
  }
  const identities = new Map<string, TestImpactPhysicalIdentity>();
  let identityConflict = false;
  const directoryChains = new Map<string, PhysicalDirectoryChain | null>([['', root.chain]]);
  identities.set('', root.identity);
  const addIdentity = (identity: TestImpactPhysicalIdentity): void => {
    const existing = identities.get(identity.relativePath);
    if (existing === undefined) {
      identities.set(identity.relativePath, identity);
      return;
    }
    // A path may be reached from several module leaves, but all observations
    // must describe one exact physical object and one exact ancestor closure.
    // A conflicting duplicate is an incomplete identity frontier, never a
    // value that may be resolved by last-write-wins map behaviour.
    if (JSON.stringify(existing) !== JSON.stringify(identity)) identityConflict = true;
  };
  const getDirectoryChain = (relativeDirectory: string): PhysicalDirectoryChain | null => (
    directoryChains.get(relativeDirectory) ?? null
  );
  const addDirectoryChain = (chain: PhysicalDirectoryChain): void => {
    for (const directory of chain.ancestors) {
      const relativeDirectory = normalizeRepoPath(path.relative(compilerRoot, directory.path));
      // A no-follow chain necessarily contains filesystem ancestors above the
      // compiler root. They are useful to the backend but are outside this
      // provider's expected closure and must not become path identities.
      if (relativeDirectory !== ''
          && (relativeDirectory.startsWith('../') || path.isAbsolute(relativeDirectory))) continue;
      const identity = physicalIdentityFromDirectoryChain(chainForTarget(chain, directory), relativeDirectory);
      if (identity !== null) addIdentity(identity);
    }
  };
  for (const file of files) {
    const relativeDirectory = normalizeRepoPath(path.dirname(file));
    const observed = observations.get(file);
    const parentChain = observed?.parentChain ?? getDirectoryChain(relativeDirectory);
    if (parentChain === null) continue;
    addDirectoryChain(parentChain);
    const entry = observed?.entry;
    if (entry === null || entry === undefined) continue;
    const identity = physicalIdentityFromFileEntry(
      path.join(compilerRoot, file),
      file,
      parentChain,
      entry
    );
    if (identity !== null) addIdentity(identity);
  }
  const missingPaths = [...expectedPaths].filter((relativePath) => !identities.has(relativePath)).sort();
  const orderedIdentities = [...identities.values()]
    .filter(({ relativePath }) => expectedPaths.has(relativePath))
    .sort((left, right) => (
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
    ));
  return Object.freeze({
    identities: Object.freeze(orderedIdentities),
    complete: !identityConflict
      && missingPaths.length === 0
      && orderedIdentities.length === expectedPaths.size,
    missingPaths: Object.freeze(missingPaths)
  });
}

function chainForTarget(
  chain: PhysicalDirectoryChain,
  target: PhysicalDirectoryIdentity
): PhysicalDirectoryChain {
  const index = chain.ancestors.findIndex((entry) => (
    entry.path === target.path && entry.objectId === target.objectId
  ));
  if (index < 0) return Object.freeze({ target, ancestors: Object.freeze([target]) });
  return Object.freeze({
    target,
    ancestors: Object.freeze(chain.ancestors.slice(0, index + 1))
  });
}

function physicalIdentityDigest(
  identities: readonly TestImpactPhysicalIdentity[]
): `sha256:${string}` {
  return rawSha256(JSON.stringify(identities));
}

/**
 * One invocation-local repository source view. Source authority and reverse
 * graph lifetime are bound to this exact frozen provider object; parser work
 * may be memoized only by the exact source bytes supplied here.
 */
export function createRepositoryTestImpactSourceProvider(
  input: Readonly<{
    budget?: Partial<TestImpactSourceObservationBudget>;
  }> = {}
): CodexDevelopmentTestImpactSourceProvider {
  const budget = Object.freeze({
    ...DEFAULT_TEST_IMPACT_SOURCE_OBSERVATION_BUDGET,
    ...(input.budget ?? {})
  });
  const initialBudget = sourceObservationBudgetState(budget);
  const rootIdentity = repositoryRootPhysicalIdentity();
  // Discovery is derived from the same retained no-follow tree census that
  // supplies source bytes and physical identities. There is no preceding
  // path-based walk (and therefore no second cwd/epoch to reconcile).
  const initialBatch = observeRepositoryModuleSources(
    null,
    rootIdentity,
    initialBudget,
    'initial'
  );
  const discovery: RepositoryModuleDiscovery = Object.freeze({
    files: initialBatch.discoveredFiles,
    unresolvedModuleFiles: initialBatch.unresolvedModuleFiles
  });
  const sourceByFile = new Map<string, string>();
  const unavailable = new Set(discovery.unresolvedModuleFiles);
  const readResults = new Map<string, TestImpactModuleSourceReadResult>();
  const sourceObservations = new Map<string, RepositoryModuleSourceObservation>();
  const initialContentDigests = new Map<string, `sha256:${string}`>(initialBatch.contentDigests);
  for (const moduleFile of discovery.files) {
    const rawObserved = initialBatch.observations.get(moduleFile)
      ?? unavailableSourceObservation('io');
    // A path returned by enumeration is part of the frozen source snapshot.
    // If it is absent while being read, that is source drift, not an optional
    // empty module that can be safely omitted from the graph.
    const observed = rawObserved.result.kind === 'absent'
      ? Object.freeze({
          ...rawObserved,
          result: { kind: 'unavailable' as const, reason: 'drift' as const }
        })
      : rawObserved;
    sourceObservations.set(moduleFile, observed);
    const result = observed.result;
    readResults.set(moduleFile, result);
    if (result.kind === 'present') sourceByFile.set(moduleFile, result.source);
    else unavailable.add(moduleFile);
  }
  if (!rootIdentity.safe || initialBudget.failed) unavailable.add('compiler-root');
  const initialPhysicalObservation = sourcePhysicalIdentities(
    discovery.files,
    rootIdentity,
    sourceObservations
  );
  const initialPhysicalIdentities = initialPhysicalObservation.identities;
  if (!initialPhysicalObservation.complete) {
    // Every observed source file and each lexical ancestor must have an
    // ordinary no-follow identity. A missing identity is unavailable/unsafe,
    // not a reason to continue with a path-only provider.
    for (const missingPath of initialPhysicalObservation.missingPaths) {
      unavailable.add(missingPath.length === 0 ? 'compiler-root' : missingPath);
    }
    if (initialPhysicalObservation.missingPaths.length === 0) {
      unavailable.add('source-physical-identity-conflict');
    }
  }
  const moduleInventoryDigest = rawSha256(discovery.files.map((file) => (
    `${Buffer.byteLength(file, 'utf8')}:${file}\0`
  )).join(''));
  const sourceDigest = framedSourceDigest(discovery.files, sourceByFile);
  const observation: TestImpactSourceObservation = Object.freeze({
    schema: 'sec-test-impact-source-observation-v1',
    compilerRoot,
    compilerRootIdentity: rootIdentity.token,
    moduleInventoryDigest,
    sourceDigest,
    sourceEpoch: rawSha256(
      `${rootIdentity.token}\0${moduleInventoryDigest}\0${sourceDigest}\0${physicalIdentityDigest(initialPhysicalIdentities)}`
    ),
    physicalIdentities: initialPhysicalIdentities
  });
  const sourceProgramCompilation = unavailable.size === 0
    ? compileTypeScriptSourceProgramModelIncremental({
        sourceRevision: observation.sourceEpoch,
        files: discovery.files.map((moduleFile) => Object.freeze({
          path: moduleFile,
          source: sourceByFile.get(moduleFile)!,
          contentDigest: rawSha256(sourceByFile.get(moduleFile)!)
        })),
        moduleMembership: repositoryModuleMembershipSync()
      }, repositorySourceProgramState)
    : null;
  if (sourceProgramCompilation !== null) repositorySourceProgramState = sourceProgramCompilation.state;
  // Every verification consumes the same ledger and absolute deadline as the
  // initial observation. Revalidation is not permission to multiply work.
  let verificationCount = 0;
  const verifyObservation = (): boolean => {
    if (verificationCount >= budget.maxVerifications) return false;
    verificationCount += 1;
    try {
      if (!sourceObservationBudgetAvailable(initialBudget)) return false;
      const currentRootIdentity = repositoryRootPhysicalIdentity();
      const currentBatch = observeRepositoryModuleSources(
        null,
        currentRootIdentity,
        initialBudget,
        'verify'
      );
      if (initialBudget.failed
          || JSON.stringify(currentBatch.discoveredFiles) !== JSON.stringify(discovery.files)
          || currentBatch.unresolvedModuleFiles.length > 0
          || JSON.stringify(currentBatch.unresolvedModuleFiles)
            !== JSON.stringify(discovery.unresolvedModuleFiles)) {
        return false;
      }
      const currentObservations = currentBatch.observations;
      for (const moduleFile of currentBatch.discoveredFiles) {
        const observed = currentObservations.get(moduleFile);
        const result = observed?.result;
        if (result?.kind !== 'present') return false;
        if (currentBatch.contentDigests.get(moduleFile)
            !== initialContentDigests.get(moduleFile)) return false;
      }
      const currentInventoryDigest = rawSha256(currentBatch.discoveredFiles.map((file) => (
        `${Buffer.byteLength(file, 'utf8')}:${file}\0`
      )).join(''));
      const currentPhysicalObservation = sourcePhysicalIdentities(
        currentBatch.discoveredFiles,
        currentRootIdentity,
        currentObservations
      );
      const checks = {
        safe: currentRootIdentity.safe,
        complete: currentPhysicalObservation.complete,
        root: currentRootIdentity.token === observation.compilerRootIdentity,
        inventory: currentInventoryDigest === observation.moduleInventoryDigest,
        physical: JSON.stringify(currentPhysicalObservation.identities)
          === JSON.stringify(observation.physicalIdentities),
        digestCount: currentBatch.contentDigests.size,
        initialDigestCount: initialContentDigests.size,
        failed: initialBudget.failed
      };
      const valid = checks.safe
        && checks.complete
        && checks.root
        && checks.inventory
        && checks.physical
        && checks.digestCount === checks.initialDigestCount
        && !checks.failed;
      return valid;
    } catch (error) {
      return false;
    }
  };
  const provider = createTestImpactSourceProvider({
    repositoryFiles: discovery.files,
    moduleMembership: repositoryModuleMembershipSync(),
    activeDocumentationPaths: currentActiveDocumentationPaths(),
    unresolvedModuleFiles: [...unavailable],
    observation,
    ...(sourceProgramCompilation === null ? {} : { sourceProgramModel: sourceProgramCompilation.model }),
    verifyObservation,
    readModuleSource: (moduleFile) => sourceByFile.get(moduleFile) ?? null,
    readModuleSourceResult: (moduleFile) => readResults.get(moduleFile) ?? { kind: 'absent' }
  });
  reusableRepositorySourceProviders.add(provider);
  return provider;
}

type TestModuleImportsCacheEntry = {
  sourceDigest: `sha256:${string}`;
  imports: RepositoryModuleImport[];
};

const testModuleImportsCache = new Map<string, TestModuleImportsCacheEntry>();

/** Result of reading one repository module's compiler-observed imports. */
export type ReadModuleImportsResult =
  | { kind: 'resolved'; imports: RepositoryModuleImport[] }
  | { kind: 'unresolved'; reason: 'stat-failed' | 'read-failed' };

function computeSourceDigest(bytes: Uint8Array): `sha256:${string}` {
  return rawSha256(bytes);
}

function readModuleImports(
  moduleFile: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): ReadModuleImportsResult {
  if (provider) {
    let observed: TestImpactModuleSourceReadResult | undefined;
    let source: string | null;
    try {
      observed = provider.readModuleSourceResult?.(moduleFile);
      source = observed === undefined
        ? provider.readModuleSource(moduleFile)
        : observed.kind === 'present' ? observed.source : null;
    } catch {
      // A provider read is part of the graph frontier. A thrown I/O seam is
      // not permission to omit the module and continue with a partial map.
      return { kind: 'unresolved', reason: 'read-failed' };
    }
    if (source === null) {
      return {
        kind: 'unresolved',
        reason: observed?.kind === 'absent' ? 'stat-failed' : 'read-failed'
      };
    }
    if (observed?.kind === 'unavailable') return { kind: 'unresolved', reason: 'read-failed' };
    // The source provider remains the sole observation authority. The
    // process-local parser memo is keyed only by the exact bytes it supplied;
    // it does not persist a second repository or graph state.
    const sourceBytes = Buffer.from(source, 'utf8');
    const sourceDigest = computeSourceDigest(new Uint8Array(sourceBytes));
    const cached = testModuleImportsCache.get(moduleFile);
    if (cached && cached.sourceDigest === sourceDigest) {
      return { kind: 'resolved', imports: cached.imports };
    }
    try {
      const imports = scanRepositoryModuleImports(source);
      testModuleImportsCache.set(moduleFile, { sourceDigest, imports });
      return { kind: 'resolved', imports };
    } catch {
      return { kind: 'unresolved', reason: 'read-failed' };
    }
  }

  const filePath = path.join(compilerRoot, moduleFile);
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { kind: 'unresolved', reason: 'stat-failed' };
    }
  } catch {
    return { kind: 'unresolved', reason: 'stat-failed' };
  }

  // Read the file bytes unconditionally so we can compute the digest. The
  // digest is the single identity; mtimeMs/size are only hints for optional
  // fast-path skipping of the digest computation, but to keep the contract
  // simple and correct we always compute the digest. The cost is negligible
  // (~0.01ms per file for sha256 of typical test files).
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    return { kind: 'unresolved', reason: 'read-failed' };
  }
  const sourceDigest = computeSourceDigest(new Uint8Array(bytes));

  const cached = testModuleImportsCache.get(moduleFile);
  if (cached && cached.sourceDigest === sourceDigest) return { kind: 'resolved', imports: cached.imports };

  // Digest mismatch (content changed) or no cache entry — re-transpile.
  const source = bytes.toString('utf8');
  let imports: RepositoryModuleImport[];
  try {
    imports = scanRepositoryModuleImports(source);
  } catch {
    return { kind: 'unresolved', reason: 'read-failed' };
  }
  testModuleImportsCache.set(moduleFile, { sourceDigest, imports });
  return { kind: 'resolved', imports };
}

// --- Transitive reverse-import graph ---
// Built once per process (default mode) by scanning production modules, test
// helpers, and test entrypoints. A changed leaf walks the reverse graph until
// it reaches test consumers, so public-facade coverage needs no handwritten
// leaf-to-test mirror. Source-digest import caches keep rebuilds bounded.
// In provider mode the map is built fresh (not cached) because a test fixture's
// synthetic module set may differ from the real repository.
//
// The map also collects `unresolvedModuleFiles` — modules whose imports could
// not be read or whose local TypeScript/JavaScript target does not exist. These
// surface as a selection trust boundary: when sourceChanged && unresolvedModuleFiles > 0,
// the affected-test inventory reports selectionResolved=false so the runner
// can fail closed instead of silently treating the empty closure as "no impact".

export type RepositoryModuleReferenceV1 = SecRepositoryModuleGraphReference;
export type RepositoryModuleGraph = SecRepositoryModuleGraph;

type ReverseImportMap = {
  map: Map<string, string[]>;
  structuralMap: Map<string, string[]>;
  declarationPaths: ReadonlySet<string>;
  unresolvedModuleFiles: string[];
  graph: RepositoryModuleGraph;
  selectionCache: Map<string, TestImpactSelection>;
};

let reverseImportMapCache: ReverseImportMap | null = null;
let repositoryProviderReverseImportMapCache = new WeakMap<object, ReverseImportMap>();

function buildReverseImportMap(
  provider?: CodexDevelopmentTestImpactSourceProvider
): ReverseImportMap {
  if (!provider && reverseImportMapCache) return reverseImportMapCache;
  if (provider && reusableRepositorySourceProviders.has(provider)) {
    const cached = repositoryProviderReverseImportMapCache.get(provider);
    if (cached) return cached;
  }

  const discovery = provider === undefined ? repositoryModuleDiscoverySync() : null;
  const moduleFiles = Object.freeze(uniqueSorted(
    (provider?.moduleFiles ?? discovery?.files ?? []).map(normalizeRepoPath)
  ));
  const seedUnresolvedModuleFiles = provider?.unresolvedModuleFiles
    ?? discovery?.unresolvedModuleFiles
    ?? [];
  const readResults = new Map<string, ReadModuleImportsResult>();
  const graph: RepositoryModuleGraph = compileSecRepositoryModuleGraph({
    files: moduleFiles,
    unresolvedFiles: seedUnresolvedModuleFiles,
    // The source provider and its physical observation remain the sole source
    // authority. Returning an empty source is only a resolved-read marker;
    // parser records are supplied through the registry-owned cache seam below.
    readSource: (moduleFile) => {
      const result = readModuleImports(moduleFile, provider);
      readResults.set(moduleFile, result);
      return result.kind === 'resolved' ? '' : null;
    },
    readImports: (moduleFile) => {
      const result = readResults.get(moduleFile);
      return result?.kind === 'resolved' ? result.imports : [];
    }
  });
  assertSecRepositoryModuleImportBoundaries(graph, sourceProviderMembership(provider));
  const map = new Map<string, string[]>();
  const structuralMap = new Map<string, string[]>();
  const sourceProgramModel = provider?.sourceProgramModel;
  const preciseModuleReferences = new Set<string>();
  const declarationPaths = new Set<string>();
  if (sourceProgramModel !== undefined) {
    for (const declaration of sourceProgramModel.declarations) declarationPaths.add(declaration.path);
    const moduleReferences = new Map<string, typeof sourceProgramModel.references[number][]>();
    for (const reference of sourceProgramModel.references) {
      if (reference.moduleSpecifier !== null && reference.moduleSpecifier.startsWith('.')) {
        const key = `${reference.path}\0${reference.moduleSpecifier}`;
        const references = moduleReferences.get(key) ?? [];
        references.push(reference);
        moduleReferences.set(key, references);
      }
      if (reference.targetObservationId === null
          || reference.targetPath === null
          || reference.targetPath === reference.path) continue;
      const consumers = map.get(reference.targetPath) ?? [];
      if (!consumers.includes(reference.path)) consumers.push(reference.path);
      map.set(reference.targetPath, consumers);
    }
    for (const [key, references] of moduleReferences) {
      if (references.length > 0 && references.every((reference) => (
        reference.name !== '*'
        && reference.targetObservationId !== null
        && reference.targetPath !== null
      ))) preciseModuleReferences.add(key);
    }
  }
  for (const reference of graph.references) {
    // Index every deterministic candidate, not only the currently existing
    // target. That preserves impact for a removed module while the surviving
    // importer still names it; ambiguity is conservatively over-selected.
    for (const candidate of reference.candidateTargets) {
      const structuralConsumers = structuralMap.get(candidate) ?? [];
      if (!structuralConsumers.includes(reference.from)) structuralConsumers.push(reference.from);
      structuralMap.set(candidate, structuralConsumers);
      if (preciseModuleReferences.has(`${reference.from}\0${reference.specifier}`)) continue;
      const fallbackConsumers = map.get(candidate) ?? [];
      if (!fallbackConsumers.includes(reference.from)) fallbackConsumers.push(reference.from);
      map.set(candidate, fallbackConsumers);
    }
  }
  for (const consumers of map.values()) consumers.sort((left, right) => left.localeCompare(right));
  for (const consumers of structuralMap.values()) consumers.sort((left, right) => left.localeCompare(right));
  const unresolvedModuleFiles = [...graph.unresolvedFiles];
  const built: ReverseImportMap = {
    map,
    structuralMap,
    declarationPaths,
    unresolvedModuleFiles,
    graph,
    selectionCache: new Map<string, TestImpactSelection>()
  };
  if (provider && reusableRepositorySourceProviders.has(provider)) {
    repositoryProviderReverseImportMapCache.set(provider, built);
  } else if (!provider) {
    reverseImportMapCache = built;
  }
  return built;
}

/**
 * Invalidate the cached reverse-import-map. Long-lived processes (e.g., a
 * future daemon) should call this when test files may have been added, removed
 * or modified on disk, so the next selection rebuilds the map fresh.
 *
 * The source-digest parser memo is safe to retain: every lookup recomputes the
 * exact source digest. This clears only graph and repository-membership
 * projections, which are scoped to the prior repository epoch.
 */
export function invalidateReverseImportMap(): void {
  reverseImportMapCache = null;
  repositoryModuleFilesCache = null;
  repositoryModuleMembershipCache = null;
}

/**
 * Resolution trust boundary for an affected-test selection.
 *
 * `selectionResolved` is false when any repository module's imports could not
 * be read or a local code target could not be resolved. In that case the reverse-import-map
 * closure is incomplete and an empty `selectedFastTests` must NOT be treated
 * as "no impact" — the runner fails closed with `invalidated/selection-unresolved`.
 */
export type TestImpactSelectionResolution = {
  selectionResolved: boolean;
  unresolvedModuleFiles: string[];
};

/**
 * Resolve the selection trust boundary for the current repository module set.
 *
 * This is separated from `selectTestsForSources` so that callers that only
 * need the { fast, slow, owners } selection shape (e.g. existing contract
 * tests) are unaffected, while the affected-test inventory can also obtain
 * the unresolved signal to drive fail-closed behaviour.
 */
export function resolveTestImpactSelectionTrustBoundary(
  provider?: CodexDevelopmentTestImpactSourceProvider
): TestImpactSelectionResolution {
  const { unresolvedModuleFiles } = buildReverseImportMap(provider);
  return {
    selectionResolved: unresolvedModuleFiles.length === 0,
    unresolvedModuleFiles: uniqueSorted(unresolvedModuleFiles)
  };
}

/**
 * Canonical compiler-observed repository module graph used by impact
 * selection and architecture constraints. Consumers must not build a second
 * parser or path-resolution inventory for the same facts.
 */
export function readRepositoryModuleGraphV1(): RepositoryModuleGraph {
  return buildReverseImportMap().graph;
}

export function deriveTestsForSources(
  files: string[],
  provider?: CodexDevelopmentTestImpactSourceProvider
): string[] {
  const { declarationPaths, map, structuralMap } = buildReverseImportMap(provider);
  const testFiles = new Set((provider?.testFiles ?? getTestFilesSync()).map(normalizeRepoPath));
  const matchedTests = new Set<string>();
  const visited = new Set<string>();
  const queue = files.map((file) => Object.freeze({
    path: normalizeRepoPath(file),
    structural: !declarationPaths.has(normalizeRepoPath(file))
  }));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!.path;
    if (visited.has(current)) continue;
    visited.add(current);
    const consumers = queue[cursor]!.structural
      ? structuralMap.get(current) ?? []
      : map.get(current) ?? [];
    for (const consumer of consumers) {
      if (testFiles.has(consumer)) {
        matchedTests.add(consumer);
      } else if (!visited.has(consumer)) {
        queue.push(Object.freeze({ path: consumer, structural: false }));
      }
    }
  }
  return uniqueSorted([...matchedTests]);
}

function moduleIdsForTestImpactSource(file: string): readonly string[] {
  const physicalOwner = repositoryModuleMembershipSync().moduleForPath(file)?.moduleId;
  return uniqueSorted([
    ...(physicalOwner === undefined ? [] : [physicalOwner]),
    ...testImpactModuleIdsForSourceKind(classifyTestImpactSource(file))
  ]);
}

function deriveTestsForModuleIds(
  moduleIds: readonly string[],
  provider?: CodexDevelopmentTestImpactSourceProvider
): readonly string[] {
  if (moduleIds.length === 0) return [];
  const wanted = new Set(moduleIds);
  const moduleSources = buildReverseImportMap(provider).graph.files.filter((file) => (
    !/^tests\//u.test(file)
    && wanted.has(sourceProviderMembership(provider).moduleForPath(file)?.moduleId ?? '')
  ));
  return deriveTestsForSources(moduleSources, provider);
}

function selectionForSource(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): TestImpactSelection {
  const normalizedFile = normalizeRepoPath(file);
  const reverseGraph = buildReverseImportMap(provider);
  const cached = reverseGraph.selectionCache.get(normalizedFile);
  if (cached) return cached;
  const graphTests = isTestImpactModuleGraphInputFile(normalizedFile, provider)
    ? deriveTestsForSources([normalizedFile], provider)
    : [];
  const sourceKind = classifyProviderSource(normalizedFile, provider);
  const semanticModuleIds = testImpactModuleIdsForSourceKind(sourceKind);
  // Active documentation always runs the dedicated docs gate. Expanding its
  // owner module into every transitive test consumer duplicates that gate and
  // turns one prose leaf into an unrelated slow-suite avalanche.
  const semanticTests = sourceKind === 'active-documentation'
    ? []
    : deriveTestsForModuleIds(semanticModuleIds, provider);
  const selected = uniqueSorted([...graphTests, ...semanticTests]);
  const physicalOwner = sourceProviderMembership(provider).moduleForPath(normalizedFile)?.moduleId;
  const selection = {
    fast: selected.filter(isFastTestFile),
    slow: selected.filter(isSlowTestFile),
    owners: uniqueSorted([
      ...(physicalOwner === undefined ? [] : [physicalOwner]),
      ...semanticModuleIds
    ])
  };
  reverseGraph.selectionCache.set(normalizedFile, selection);
  return selection;
}

/** Returns true only when the compiled graph reaches a real test consumer. */
export function hasTestImpactForFile(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProvider
): boolean {
  const selection = selectionForSource(file, provider);
  return selection.fast.length > 0 || selection.slow.length > 0;
}

/**
 * Resolve ownership for one changed-path batch against one already-built
 * reverse graph. This is the batch form of `hasTestImpactForFile`; callers
 * such as PR-risk selection must use it instead of rebuilding an inventory for
 * every path. The returned set is immutable and is scoped to the supplied
 * provider/observation epoch.
 */
export function resolveTestImpactForFiles(
  files: readonly string[],
  provider?: CodexDevelopmentTestImpactSourceProvider
): ReadonlySet<string> {
  return new Set(files.filter((file) => (
    hasTestImpactForFile(file, provider)
    || resolveTestImpactRiskPolicies([file]).length > 0
  )));
}

/**
 * @internal Reset process-local projections for deterministic tests.
 */
export function __resetTestImpactCachesForTesting(): void {
  testModuleImportsCache.clear();
  reverseImportMapCache = null;
  repositoryModuleFilesCache = null;
  repositorySourceProgramState = null;
  repositoryProviderReverseImportMapCache = new WeakMap<object, ReverseImportMap>();
}

export function resolveTestOwnership(
  files: string[]
): ResolvedTestOwnership[] {
  return files.flatMap((source) => moduleIdsForTestImpactSource(source).map((moduleId) => ({
    source,
    owner: moduleId,
    identity: { kind: 'module' as const, id: moduleId }
  })));
}

export function resolveTestImpactRiskPolicies(
  files: readonly string[]
): TestImpactRiskPolicy[] {
  return files.some((file) => file.startsWith('tests/setup/'))
    ? ['slow-risk-baseline']
    : [];
}

export function selectTestsForSources(
  files: string[],
  provider?: CodexDevelopmentTestImpactSourceProvider
): TestImpactSelection {
  const fast = new Set<string>();
  const slow = new Set<string>();
  const owners = new Set<string>();

  for (const file of files) {
    const selection = selectionForSource(file, provider);
    addAll(fast, selection.fast);
    addAll(slow, selection.slow);
    addAll(owners, selection.owners);
  }

  return {
    fast: uniqueSorted([...fast]),
    slow: uniqueSorted([...slow]),
    owners: uniqueSorted([...owners])
  };
}

export function formatSlowImpactNotice(selection: TestImpactSelection): string {
  if (selection.slow.length === 0) {
    return '';
  }
  return [
    'Changed sources also affect slow e2e coverage:',
    ...selection.slow.map((file) => `- ${file}`),
    'Run bun run test:slow or bun run test:full before release.'
  ].join('\n');
}
