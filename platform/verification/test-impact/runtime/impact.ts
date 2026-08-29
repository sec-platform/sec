import fs from 'node:fs';
import path from 'node:path';

import { rawSha256 } from '../../../foundation/canonical.ts';
import type { CodexDevelopmentTestImpactTransitionObservationV1 } from '../../ci/index.ts';
import { uniqueSorted } from '../../../foundation/collections.ts';
import {
  assertSecRepositoryModuleImportBoundariesV1,
  compileSecRepositoryModuleGraphV1,
  compileSecRepositoryModuleMembershipV1,
  normalizeSecRepositoryPathV1,
  scanSecRepositoryModuleImportsV1,
  type SecModuleImportKindV1,
  type SecRepositoryModuleGraphImportV1,
  type SecRepositoryModuleGraphReferenceV1,
  type SecRepositoryModuleGraphV1,
  type SecRepositoryModuleMembershipV1
} from '../../../architecture/repository-modules/contract.ts';
import {
  getTestFilesSync,
  isFastTestFile,
  isSlowTestFile,
} from '../contract/budget.ts';
import {
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  scanNoFollowDirectoryTreeMetadataV1,
  scanNoFollowDirectoryTreeV1,
  scanNoFollowDirectoryTreeInventoryV1,
  PhysicalNoFollowError,
  PHYSICAL_NO_FOLLOW_SCHEMA_V1,
  type PhysicalDirectoryChainV1,
  type PhysicalDirectoryIdentityV1,
  type NoFollowDirectoryTreeInventoryEntryV1,
  type NoFollowDirectoryTreeEntryV1
} from '../../../runtime-physical/index.ts';
import { governanceTestOwnershipDeclarations } from '../rules/governance.ts';
import { pipelineTestOwnershipDeclarations } from '../rules/pipeline.ts';
import { semanticTestOwnershipDeclarations } from '../rules/semantic.ts';
import {
  verificationPhysicalUniverseTestSentinelsV1,
  verificationTestOwnershipDeclarations
} from '../rules/verification.ts';
import {
  classifyTestImpactSource,
  matchesTestOwnershipDeclaration,
  resolveDeclaredTestOwnership,
  type ResolvedTestOwnership,
  type TestImpactRiskPolicy,
  type TestOwnershipDeclaration
} from '../contract/ownership.ts';

const compilerRoot = path.resolve(import.meta.dir, '../..');
let repositoryModuleMembershipCache: SecRepositoryModuleMembershipV1 | null = null;

function repositoryModuleMembershipSync(): SecRepositoryModuleMembershipV1 {
  if (repositoryModuleMembershipCache === null) {
    repositoryModuleMembershipCache = compileSecRepositoryModuleMembershipV1(compilerRoot);
  }
  return repositoryModuleMembershipCache;
}

function repositoryModuleGraphRoots(): readonly string[] {
  return repositoryModuleMembershipSync().graphRoots;
}

function isRepositoryModuleGraphPath(relativePath: string): boolean {
  return repositoryModuleGraphRoots().some((root) => (
    relativePath === root || relativePath.startsWith(`${root}/`)
  ));
}

function isRepositoryRuntimeModulePath(relativePath: string): boolean {
  return repositoryModuleMembershipSync().moduleForPath(relativePath)?.importGraph === 'runtime';
}

export type TestImpactRule = {
  sourcePattern: RegExp;
  fast: string[];
  slow: string[];
  owner: string;
};

export type TestImpactSelection = {
  fast: string[];
  slow: string[];
  owners: string[];
};

const VERIFICATION_INFRASTRUCTURE_PATTERNS = [
  /^\.github\/workflows\//,
  /^scripts\/ci-[^/]+\.ts$/,
  /^platform\/dev-runner\//,
  /^platform\/shared\/ci-[^/]+\.ts$/,
  /^platform\/shared\/test-(?:budget|impact|ownership)-contract\.ts$/,
  /^platform\/shared\/test-impact-rules\//
];

export function isVerificationInfrastructureFile(file: string): boolean {
  return VERIFICATION_INFRASTRUCTURE_PATTERNS.some((pattern) => pattern.test(file));
}

export const testOwnershipDeclarations: TestOwnershipDeclaration[] = [
  ...governanceTestOwnershipDeclarations,
  ...pipelineTestOwnershipDeclarations,
  ...semanticTestOwnershipDeclarations,
  ...verificationTestOwnershipDeclarations
];

export function isTestImpactSourceFile(
  file: string,
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): boolean {
  if (/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)) return false;
  // Explicitly imported machine data is part of the same reverse-import
  // frontier as TypeScript leaves.  It must not be mistaken for an
  // uninteresting declarative file: a changed JSON registry can invalidate a
  // consumer test even though the data itself is not parsed by Bun's TS
  // transpiler.  The graph provider still observes only compiler modules;
  // this path merely admits the changed target into that existing graph.
  if (isTestImpactModuleGraphInputFile(file)) return true;
  return classifyTestImpactSource(file) !== null
    || testOwnershipDeclarations.some((declaration) => (
      matchesTestOwnershipDeclaration(declaration, file, transition)
    ))
    || verificationPhysicalUniverseTestSentinelsV1.some(({ sourcePattern }) => (
      sourcePattern.test(file)
    ));
}

/**
 * True only for a current repository leaf that can participate in the
 * TypeScript reverse-import graph. Declarative owners (docs/YAML/package
 * metadata) remain affected-test sources for fallback selection, but they do
 * not require a full source-graph observation or its filesystem budget.
 */
export function isTestImpactModuleGraphSourceFile(file: string): boolean {
  return !/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)
    && /\.[cm]?tsx?$/u.test(file)
    && isRepositoryModuleGraphPath(file)
    && isRepositoryRuntimeModulePath(file);
}

/**
 * A changed path can be a graph target without being a compiler source leaf.
 * Keep this set deliberately narrow and deterministic: these are the
 * explicit machine-data formats accepted by the existing import-candidate
 * resolver.  Other declarative paths continue through their canonical
 * ownership/fallback declarations and do not force a graph census.
 */
export function isTestImpactModuleGraphInputFile(file: string): boolean {
  return isTestImpactModuleGraphSourceFile(file)
    || (
      !/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)
      && /\.(?:json|ya?ml|toml)$/u.test(file)
      && isRepositoryModuleGraphPath(file)
      && isRepositoryRuntimeModulePath(file)
    );
}

export const testImpactFallbackRules: TestImpactRule[] = [
  {
    owner: 'repository-tooling-workflows',
    sourcePattern: /^\.github\/workflows\/(?:architecture-tools|compiler-pr-validation|compiler-release-validation|sec-merge-gate)\.yml$/,
    fast: ['tests/contract/repository-runtime.test.ts'],
    slow: []
  },
  {
    owner: 'verification-infrastructure',
    sourcePattern: /^(?:\.github\/workflows\/|scripts\/ci-[^/]+\.ts$|platform\/shared\/ci-[^/]+\.ts$|platform\/shared\/test-(?:budget|impact|ownership)-contract\.ts$|platform\/shared\/test-impact-rules\/)/,
    fast: [
      'tests/contract/benchmark-budget.test.ts',
      'tests/contract/ci-contract.test.ts',
      'tests/contract/ci-lanes.test.ts',
      'tests/unit/test-runner.test.ts'
    ],
    slow: []
  },
  {
    owner: 'documentation-authority',
    sourcePattern: /^(?:README\.md|docs\/(?:03-MVP实施计划与路线图|05-编译器核心实现规格)\.md)$/,
    fast: ['tests/contract/documentation-authority.test.ts'],
    slow: []
  },
  {
    owner: 'repository-package-contract',
    sourcePattern: /^package\.json$/,
    fast: [
      'tests/contract/benchmark-budget.test.ts',
      'tests/contract/repository-runtime.test.ts',
      'tests/integration/compiler-dependency-installation.test.ts',
      'tests/integration/project-base.test.ts'
    ],
    slow: ['tests/integration/project-dependency-runtime.test.ts']
  },
  {
    owner: 'repository-lockfile-contract',
    sourcePattern: /^bun\.lock$/,
    fast: ['tests/integration/compiler-dependency-installation.test.ts'],
    slow: []
  },
  {
    owner: 'contract-freeze',
    sourcePattern: /^platform\/shared\/contract-freeze-contract\.ts$/,
    fast: ['tests/contract/contract-freeze.test.ts'],
    slow: []
  },
  {
    owner: 'verify',
    sourcePattern: /^platform\/compiler\/verify\//,
    fast: ['tests/unit/coverage.test.ts', 'tests/unit/policy-summary.test.ts'],
    slow: ['tests/e2e/verification.test.ts']
  },
  {
    owner: 'upgrade',
    sourcePattern: /^platform\/compiler\/upgrade\//,
    fast: [
      'tests/unit/upgrade-summary.test.ts',
      'tests/integration/dry-run-directories.test.ts',
      'tests/integration/dry-run-files.test.ts',
      'tests/integration/dry-run-text.test.ts',
      'tests/integration/file-migrations.test.ts',
      'tests/integration/migration-files.test.ts',
      'tests/integration/migration-json.test.ts',
      'tests/integration/migration-text.test.ts',
      'tests/integration/migration-validation.test.ts',
      'tests/integration/text-migrations.test.ts',
      'tests/integration/validation.test.ts'
    ],
    slow: ['tests/e2e/upgrade.test.ts', 'tests/e2e/dry-run-plan.test.ts']
  },
  {
    owner: 'repair',
    sourcePattern: /^platform\/compiler\/repair\//,
    fast: ['tests/unit/repair-plan.test.ts', 'tests/unit/repair-summary.test.ts', 'tests/integration/repair.test.ts'],
    slow: ['tests/e2e/repair.test.ts']
  },
  {
    owner: 'pipeline',
    sourcePattern: /^platform\/compiler\/(parse|resolve|compose|adapt)\//,
    fast: ['tests/integration/overview.test.ts'],
    slow: ['tests/e2e/pipeline.test.ts', 'tests/e2e/end-to-end.test.ts']
  },
  {
    owner: 'explain',
    sourcePattern: /^platform\/compiler\/explain\//,
    fast: ['tests/unit/graph-mutation-dry-run.test.ts', 'tests/unit/project-overview.test.ts', 'tests/integration/review.test.ts'],
    slow: ['tests/e2e/explain.test.ts', 'tests/e2e/provenance.test.ts']
  },
  {
    owner: 'cli',
    sourcePattern: /^platform\/cli\//,
    fast: [
      'tests/contract/benchmark-budget.test.ts',
      'tests/contract/ci-contract.test.ts',
      'tests/contract/contract-freeze.test.ts',
      'tests/contract/environment.test.ts',
      'tests/contract/error-protocol.test.ts',
      'tests/contract/reference.test.ts',
      'tests/contract/usage.test.ts',
      'tests/integration/review.test.ts'
    ],
    slow: []
  },
  {
    owner: 'registry',
    sourcePattern: /^platform\/registry\//,
    fast: ['tests/unit/path-containment.test.ts'],
    slow: ['tests/e2e/registry.test.ts', 'tests/e2e/private-registry.test.ts']
  },
  {
    owner: 'scripts',
    sourcePattern: /^scripts\//,
    fast: ['tests/contract/usage.test.ts'],
    slow: []
  }
];

function addAll(target: Set<string>, values: string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function normalizeRepoPath(value: string): string {
  return normalizeSecRepositoryPathV1(value);
}

export type RepositoryModuleImportKindV1 = SecModuleImportKindV1;
export type RepositoryModuleImportV1 = SecRepositoryModuleGraphImportV1;

/**
 * Parser-cache adapter only.  Import syntax and specifier semantics belong to
 * repository-modules; this function preserves the existing cache's mutable
 * array shape without creating another parser or resolver.
 */
function scanRepositoryModuleImports(source: string): RepositoryModuleImportV1[] {
  // The registry scanner recognizes CommonJS `require` for the full
  // repository graph. Test-impact preserves its existing TS compiler-module
  // projection (static/dynamic ESM records only); this is a projection policy,
  // not another parser or local specifier resolver.
  return [...scanSecRepositoryModuleImportsV1(source)]
    .filter(({ kind }) => kind !== 'require')
    .map((entry) => Object.freeze({
    kind: entry.kind,
    specifier: entry.specifier
  }));
}

export type CodexDevelopmentTestImpactSourceProviderV2 = {
  moduleFiles: readonly string[];
  testFiles: readonly string[];
  /**
   * Persistent parser-cache use is an explicit execution context.  The
   * non-persistent plan context never loads or flushes the shared cache.
   */
  cacheMode?: 'persistent' | 'non-persistent';
  readModuleSource: (moduleFile: string) => string | null;
  /**
   * Optional typed read seam. `null` in the legacy callback is retained for
   * compatibility, but a provider that owns a physical snapshot can
   * distinguish a literal absent entry from an unavailable/unsafe read.
   */
  readModuleSourceResult?: (moduleFile: string) => TestImpactModuleSourceReadResultV1;
  /** Discovery failures are part of the graph frontier, never an empty set. */
  unresolvedModuleFiles?: readonly string[];
  /** Immutable identity of the observed compiler-root/source epoch. */
  observation?: TestImpactSourceObservationV1;
  /** Re-observe the same physical source epoch at the plan fence. */
  verifyObservation?: () => boolean;
};

export type TestImpactModuleSourceReadResultV1 =
  | Readonly<{ kind: 'present'; source: string }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'unavailable'; reason: 'permission' | 'io' | 'unsafe' | 'drift' | 'capability' }>;

export type TestImpactSourceObservationV1 = Readonly<{
  schema: 'sec-test-impact-source-observation-v1';
  compilerRoot: string;
  compilerRootIdentity: string;
  moduleInventoryDigest: `sha256:${string}`;
  sourceDigest: `sha256:${string}`;
  sourceEpoch: `sha256:${string}`;
  physicalIdentities: readonly TestImpactPhysicalIdentityV1[];
}>;

/**
 * Bounded input for one invocation-local source observation.  The deadline is
 * relative to provider construction or a later verification operation; each
 * operation gets its own monotonic deadline while the number of operations is
 * bounded by `maxVerifications`.  No source observation may borrow an
 * ambient process/global cache or an unbounded filesystem read.
 */
export type TestImpactSourceObservationBudgetV1 = Readonly<{
  deadlineMs: number;
  maxSourceBytes: number;
  maxEntries: number;
  maxVerifications: number;
}>;

const DEFAULT_TEST_IMPACT_SOURCE_OBSERVATION_BUDGET_V1: TestImpactSourceObservationBudgetV1 = Object.freeze({
  deadlineMs: 5_000,
  maxSourceBytes: 128 * 1024 * 1024,
  maxEntries: 100_000,
  maxVerifications: 16
});

type MutableTestImpactSourceObservationBudgetStateV1 = {
  readonly budget: TestImpactSourceObservationBudgetV1;
  readonly startedAtMs: number;
  readonly deadlineAtMs: number;
  sourceBytes: number;
  recordCount: number;
  failed: boolean;
};

function sourceObservationBudgetState(
  input: Partial<TestImpactSourceObservationBudgetV1> = {}
): MutableTestImpactSourceObservationBudgetStateV1 {
  const budget = Object.freeze({
    ...DEFAULT_TEST_IMPACT_SOURCE_OBSERVATION_BUDGET_V1,
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
  state: MutableTestImpactSourceObservationBudgetStateV1,
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
  state: MutableTestImpactSourceObservationBudgetStateV1,
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

export type TestImpactPhysicalIdentityV1 = Readonly<{
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
  ancestorChain: readonly TestImpactAncestorPhysicalIdentityV1[];
}>;

export type TestImpactAncestorPhysicalIdentityV1 = Readonly<{
  path: string;
  finalPath: string;
  device: string;
  inode: string;
  objectId: string;
}>;

const reusableNonPersistentRepositoryProviders = new WeakSet<object>();

/**
 * Compile the canonical TestImpact source view from an already observed tree.
 * The caller owns physical observation; this owner alone decides which tracked
 * paths participate in the TypeScript module graph and which are tests.
 */
export function createTestImpactSourceProviderV2(input: Readonly<{
  repositoryFiles: readonly string[];
  readModuleSource: (moduleFile: string) => string | null;
  cacheMode?: 'persistent' | 'non-persistent';
  readModuleSourceResult?: (moduleFile: string) => TestImpactModuleSourceReadResultV1;
  unresolvedModuleFiles?: readonly string[];
  observation?: TestImpactSourceObservationV1;
  verifyObservation?: () => boolean;
}>): CodexDevelopmentTestImpactSourceProviderV2 {
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
    && isRepositoryModuleGraphPath(repositoryFile)
    && isRepositoryRuntimeModulePath(repositoryFile)
  )));
  const moduleFileSet = new Set(moduleFiles);
  const testFiles = Object.freeze(moduleFiles.filter((moduleFile) => (
    /^tests\/.+\.(?:test|spec)\.tsx?$/u.test(moduleFile)
  )));
  const unresolvedModuleFiles = Object.freeze(uniqueSorted(
    (input.unresolvedModuleFiles ?? []).map(normalizeRepoPath)
  ));
  return Object.freeze({
    moduleFiles,
    testFiles,
    ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
    unresolvedModuleFiles,
    ...(input.observation === undefined ? {} : { observation: input.observation }),
    ...(input.verifyObservation === undefined ? {} : { verifyObservation: input.verifyObservation }),
    readModuleSource: (moduleFile: string): string | null => (
      moduleFileSet.has(moduleFile) ? input.readModuleSource(moduleFile) : null
    ),
    ...(input.readModuleSourceResult === undefined ? {} : {
      readModuleSourceResult: (moduleFile: string): TestImpactModuleSourceReadResultV1 => (
        moduleFileSet.has(moduleFile)
          ? input.readModuleSourceResult!(moduleFile)
          : { kind: 'absent' }
      )
    })
  });
}

type RepositoryModuleDiscoveryV1 = Readonly<{
  files: readonly string[];
  unresolvedModuleFiles: readonly string[];
}>;

type RepositoryModuleSourceObservationV1 = Readonly<{
  result: TestImpactModuleSourceReadResultV1;
  /** The retained no-follow file observation used to decode `result.source`. */
  entry: NoFollowDirectoryTreeEntryV1 | null;
  /** Full no-follow chain for the file's lexical parent. */
  parentChain: PhysicalDirectoryChainV1 | null;
}>;

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '').toUpperCase()
    : '';
}

function classifyNoFollowFailure(error: unknown): TestImpactModuleSourceReadResultV1 {
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
  entryOverride?: NoFollowDirectoryTreeEntryV1 | null,
  parentChainOverride?: PhysicalDirectoryChainV1 | null
): RepositoryModuleSourceObservationV1 {
  const absolutePath = path.join(compilerRoot, moduleFile);
  const parentPath = path.dirname(absolutePath);
  let parentChain: PhysicalDirectoryChainV1 | null = parentChainOverride ?? null;
  if (parentChainOverride === undefined) {
    try {
      parentChain = inspectNoFollowDirectoryChainV1(parentPath, `Test-impact source parent ${moduleFile}`);
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
  let entry: NoFollowDirectoryTreeEntryV1 | null = entryOverride ?? null;
  if (entryOverride === undefined) {
    try {
      entry = inspectNoFollowOrdinaryFileEntryV1(
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

type RepositoryModuleSourceObservationBatchV1 = Readonly<{
  observations: ReadonlyMap<string, RepositoryModuleSourceObservationV1>;
  /** Canonical content digests, including entries whose bytes are not retained. */
  contentDigests: ReadonlyMap<string, `sha256:${string}`>;
  /** One no-follow traversal's retained directory topology for parent binding. */
  directoryEntries: ReadonlyMap<string, NoFollowDirectoryTreeEntryV1>;
  /** Root chains are observed once per canonical module root and reused below. */
  rootChains: ReadonlyMap<string, PhysicalDirectoryChainV1>;
  /** Module files discovered by the same retained tree census. */
  discoveredFiles: readonly string[];
  /** Unsafe/unavailable frontiers discovered by that same census. */
  unresolvedModuleFiles: readonly string[];
}>;

type TestImpactUnavailableSourceReasonV1 = Extract<
  TestImpactModuleSourceReadResultV1,
  { readonly kind: 'unavailable' }
>['reason'];

function sourceContentDigest(bytes: Uint8Array): `sha256:${string}` {
  // This is the same framed domain used by scanNoFollowDirectoryTreeInventoryV1
  // (`{"bytes":"<lowercase hex>"}`), allowing a streaming final fence to
  // compare against the retained initial read without retaining the whole tree.
  return rawSha256(`{"bytes":"${Buffer.from(bytes).toString('hex')}"}`);
}

function inventoryEntryAsTreeEntry(
  entry: NoFollowDirectoryTreeInventoryEntryV1,
  relativePath: string
): NoFollowDirectoryTreeEntryV1 {
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
  entry: NoFollowDirectoryTreeEntryV1
): PhysicalDirectoryIdentityV1 | null {
  if (entry.kind !== 'directory') return null;
  const absolutePath = path.join(compilerRoot, relativePath);
  return Object.freeze({
    schema: PHYSICAL_NO_FOLLOW_SCHEMA_V1,
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
  rootChains: ReadonlyMap<string, PhysicalDirectoryChainV1>,
  directoryEntries: ReadonlyMap<string, NoFollowDirectoryTreeEntryV1>
): PhysicalDirectoryChainV1 | null {
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
  reason: TestImpactUnavailableSourceReasonV1,
  parentChain: PhysicalDirectoryChainV1 | null = null
): RepositoryModuleSourceObservationV1 {
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
  root: RepositoryRootIdentityV1,
  state: MutableTestImpactSourceObservationBudgetStateV1,
  mode: 'initial' | 'verify'
): RepositoryModuleSourceObservationBatchV1 {
  const observations = new Map<string, RepositoryModuleSourceObservationV1>();
  const contentDigests = new Map<string, `sha256:${string}`>();
  const directoryEntries = new Map<string, NoFollowDirectoryTreeEntryV1>();
  const rootChains = new Map<string, PhysicalDirectoryChainV1>();
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

  const initialEntriesByRoot = new Map<string, ReadonlyMap<string, NoFollowDirectoryTreeEntryV1>>();
  const inventoryByRoot = new Map<string, ReadonlyMap<string, NoFollowDirectoryTreeInventoryEntryV1>>();
  const failedRoots = new Map<string, TestImpactUnavailableSourceReasonV1>();

  for (const relativeRoot of repositoryModuleGraphRoots()) {
    if (!sourceObservationBudgetAvailable(state, 0, 1)) break;
    const absoluteRoot = path.join(compilerRoot, relativeRoot);
    let chain: PhysicalDirectoryChainV1;
    try {
      chain = inspectNoFollowDirectoryChainV1(
        absoluteRoot,
        `Test-impact module root ${relativeRoot}`
      );
    } catch (error) {
      const result = classifyNoFollowFailure(error);
      if (result.kind !== 'absent') failedRoots.set(
        relativeRoot,
        (result as Extract<TestImpactModuleSourceReadResultV1, { readonly kind: 'unavailable' }>).reason
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
      let scanned: readonly NoFollowDirectoryTreeEntryV1[];
      try {
        scanned = scanNoFollowDirectoryTreeV1(chain.target, {
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
      const initialEntries = new Map<string, NoFollowDirectoryTreeEntryV1>();
      for (const entry of scanned) {
        initialEntries.set(entry.relativePath, entry);
        directoryEntries.set(fullModuleTreePath(relativeRoot, entry.relativePath), entry);
      }
      initialEntriesByRoot.set(relativeRoot, initialEntries);
    } else {
      // The streaming retained scanner applies the same pre-read byte
      // reservation as the initial bounded scanner; no second metadata walk
      // is needed for a fresh verification epoch.
      let inventory: readonly NoFollowDirectoryTreeInventoryEntryV1[];
      try {
        inventory = scanNoFollowDirectoryTreeInventoryV1(chain.target, {
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
      const inventoryEntries = new Map<string, NoFollowDirectoryTreeInventoryEntryV1>();
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

  const parentChains = new Map<string, PhysicalDirectoryChainV1 | null>();
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
      const inventoryEntry = sourceEntry as NoFollowDirectoryTreeInventoryEntryV1;
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
    const initialEntry = sourceEntry as NoFollowDirectoryTreeEntryV1;
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
): TestImpactModuleSourceReadResultV1 {
  return classifyRepositoryModuleSourceObservation(moduleFile).result;
}

function collectRepositoryModuleFilesSync(
  state?: MutableTestImpactSourceObservationBudgetStateV1
): RepositoryModuleDiscoveryV1 {
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
    let chain: PhysicalDirectoryChainV1;
    try {
      chain = inspectNoFollowDirectoryChainV1(
        path.join(compilerRoot, relativeRoot),
        `Test-impact module discovery root ${relativeRoot}`
      );
    } catch (error) {
      const result = classifyNoFollowFailure(error);
      if (result.kind !== 'absent') unresolvedModuleFiles.add(relativeRoot);
      if (state !== undefined && result.kind !== 'absent') state.failed = true;
      continue;
    }
    let entries: readonly NoFollowDirectoryTreeInventoryEntryV1[];
    try {
      entries = scanNoFollowDirectoryTreeMetadataV1(chain.target, {
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

let repositoryModuleFilesCache: RepositoryModuleDiscoveryV1 | null = null;

function repositoryModuleDiscoverySync(): RepositoryModuleDiscoveryV1 {
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

type RepositoryRootIdentityV1 = Readonly<{
  safe: boolean;
  state: 'present' | 'absent' | 'unsafe' | 'unavailable';
  token: string;
  chain: PhysicalDirectoryChainV1 | null;
  identity: TestImpactPhysicalIdentityV1 | null;
}>;

function ancestorIdentity(
  identity: PhysicalDirectoryIdentityV1
): TestImpactAncestorPhysicalIdentityV1 {
  return Object.freeze({
    path: identity.path,
    finalPath: identity.finalPath,
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

function noFollowChainToken(chain: PhysicalDirectoryChainV1): string {
  return JSON.stringify({
    target: chain.target,
    ancestors: chain.ancestors
  });
}

function statMatchesNoFollowIdentity(
  stat: fs.Stats,
  identity: PhysicalDirectoryIdentityV1,
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
  chain: PhysicalDirectoryChainV1,
  relativePath: string
): TestImpactPhysicalIdentityV1 | null {
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
  parentChain: PhysicalDirectoryChainV1,
  entry: NoFollowDirectoryTreeEntryV1
): TestImpactPhysicalIdentityV1 | null {
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

function repositoryRootPhysicalIdentity(): RepositoryRootIdentityV1 {
  try {
    const chain = inspectNoFollowDirectoryChainV1(compilerRoot, 'Test-impact compiler root');
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
  root: RepositoryRootIdentityV1,
  observations: ReadonlyMap<string, RepositoryModuleSourceObservationV1> = new Map()
): Readonly<{
  identities: readonly TestImpactPhysicalIdentityV1[];
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
  const identities = new Map<string, TestImpactPhysicalIdentityV1>();
  let identityConflict = false;
  const directoryChains = new Map<string, PhysicalDirectoryChainV1 | null>([['', root.chain]]);
  identities.set('', root.identity);
  const addIdentity = (identity: TestImpactPhysicalIdentityV1): void => {
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
  const getDirectoryChain = (relativeDirectory: string): PhysicalDirectoryChainV1 | null => (
    directoryChains.get(relativeDirectory) ?? null
  );
  const addDirectoryChain = (chain: PhysicalDirectoryChainV1): void => {
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
  chain: PhysicalDirectoryChainV1,
  target: PhysicalDirectoryIdentityV1
): PhysicalDirectoryChainV1 {
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
  identities: readonly TestImpactPhysicalIdentityV1[]
): `sha256:${string}` {
  return rawSha256(JSON.stringify(identities));
}

/**
 * One invocation-local repository source view for zero-Effect planning.
 * The provider never loads, dirties, flushes, repairs, or removes the
 * persistent test-impact cache. Its reverse graph may be reused only while
 * this exact frozen provider object remains alive.
 */
export function createNonPersistentRepositoryTestImpactSourceProviderV1(
  input: Readonly<{
    budget?: Partial<TestImpactSourceObservationBudgetV1>;
    cacheMode?: 'persistent' | 'non-persistent';
  }> = {}
): CodexDevelopmentTestImpactSourceProviderV2 {
  const budget = Object.freeze({
    ...DEFAULT_TEST_IMPACT_SOURCE_OBSERVATION_BUDGET_V1,
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
  const discovery: RepositoryModuleDiscoveryV1 = Object.freeze({
    files: initialBatch.discoveredFiles,
    unresolvedModuleFiles: initialBatch.unresolvedModuleFiles
  });
  const sourceByFile = new Map<string, string>();
  const unavailable = new Set(discovery.unresolvedModuleFiles);
  const readResults = new Map<string, TestImpactModuleSourceReadResultV1>();
  const sourceObservations = new Map<string, RepositoryModuleSourceObservationV1>();
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
  const observation: TestImpactSourceObservationV1 = Object.freeze({
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
  // Verification is intentionally fresh after a long gate, but it is still
  // one logical execution observation.  Keep an aggregate ledger so repeated
  // gate admission cannot multiply the full-tree byte/record work without a
  // hard ceiling.  The eight-operation cap mirrors the Git revalidation
  // ledger and leaves room for dependency, compiler, docs, and test gates.
  const maxAggregateSourceBytes = Math.min(Number.MAX_SAFE_INTEGER, budget.maxSourceBytes * 8);
  const maxAggregateRecords = Math.min(Number.MAX_SAFE_INTEGER, budget.maxEntries * 8);
  let aggregateSourceBytes = initialBudget.sourceBytes;
  let aggregateRecordCount = initialBudget.recordCount;
  let verificationCount = 0;
  const verifyObservation = (): boolean => {
    if (verificationCount >= budget.maxVerifications) return false;
    verificationCount += 1;
    const verificationBudget = sourceObservationBudgetState(budget);
    try {
      const currentRootIdentity = repositoryRootPhysicalIdentity();
      const currentBatch = observeRepositoryModuleSources(
        null,
        currentRootIdentity,
        verificationBudget,
        'verify'
      );
      aggregateSourceBytes += verificationBudget.sourceBytes;
      aggregateRecordCount += verificationBudget.recordCount;
      if (verificationBudget.failed
          || aggregateSourceBytes > maxAggregateSourceBytes
          || aggregateRecordCount > maxAggregateRecords
          || JSON.stringify(currentBatch.discoveredFiles) !== JSON.stringify(discovery.files)
          || currentBatch.unresolvedModuleFiles.length > 0
          || JSON.stringify(currentBatch.unresolvedModuleFiles)
            !== JSON.stringify(discovery.unresolvedModuleFiles)) {
        return false;
      }
      if (verificationBudget.failed) return false;
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
        failed: verificationBudget.failed
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
  const provider = createTestImpactSourceProviderV2({
    repositoryFiles: discovery.files,
    cacheMode: input.cacheMode ?? 'non-persistent',
    unresolvedModuleFiles: [...unavailable],
    observation,
    verifyObservation,
    readModuleSource: (moduleFile) => sourceByFile.get(moduleFile) ?? null,
    readModuleSourceResult: (moduleFile) => readResults.get(moduleFile) ?? { kind: 'absent' }
  });
  reusableNonPersistentRepositoryProviders.add(provider);
  return provider;
}

// --- Persistent repository module-import cache (Issue #206 cache identity) ---
//
// Cache identity is (moduleFile, sourceDigest) inside an envelope that binds
// parserRuntimeIdentity, parserOptionsDigest, contractRevision and cacheSchema
// revision. mtimeMs/size are kept only as an optional fast-path hint; the
// sourceDigest is the single source of truth and is always recomputed on read.
//
// Load rejects envelopes whose schema/parser/contract revision does not match
// the current runtime, so parser or contract upgrades invalidate the entire
// cache atomically. Corrupt or unknown-schema caches are rejected with an
// observable stderr warning (not silently empty).

export const TEST_IMPACT_CACHE_IDENTITY_V1 = Object.freeze({
  schema: 'sec-test-impact-cache-v4',
  parserRuntimeIdentity: 'repository-module-registry-v1-import-kind',
  parserOptionsDigest: rawSha256(JSON.stringify({
    scanner: 'sec-repository-module-graph-v1',
    importKinds: ['static', 'dynamic'],
    projection: 'test-impact-esm-only'
  })),
  contractRevision: 'test-impact-contract-v6-registry-owned-module-graph'
} as const);

type TestModuleImportsCacheEntry = {
  sourceDigest: `sha256:${string}`;
  imports: RepositoryModuleImportV1[];
  mtimeMs: number;
  size: number;
};

type TestImpactCacheEnvelope = {
  schema: typeof TEST_IMPACT_CACHE_IDENTITY_V1.schema;
  parserRuntimeIdentity: typeof TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity;
  parserOptionsDigest: typeof TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest;
  contractRevision: typeof TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision;
  entries: Record<string, TestModuleImportsCacheEntry>;
};

const DEFAULT_TEST_IMPACT_CACHE_FILE = path.join(compilerRoot, '.tmp', 'test-impact-cache.json');
let testImpactCacheFile = DEFAULT_TEST_IMPACT_CACHE_FILE;

const testModuleImportsCache = new Map<string, TestModuleImportsCacheEntry>();
let persistentCacheLoaded = false;
let persistentCacheDirty = false;

function isModuleImport(value: unknown): value is RepositoryModuleImportV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (entry.kind === 'static' || entry.kind === 'dynamic' || entry.kind === 'require')
    && typeof entry.specifier === 'string';
}

function isCacheEntry(value: unknown): value is TestModuleImportsCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sourceDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(entry.sourceDigest)
    && Array.isArray(entry.imports) && entry.imports.every(isModuleImport)
    && typeof entry.mtimeMs === 'number' && typeof entry.size === 'number';
}

function loadPersistentTestImpactCache(): void {
  if (persistentCacheLoaded) return;
  persistentCacheLoaded = true;
  let raw: string;
  try {
    raw = fs.readFileSync(testImpactCacheFile, 'utf8');
  } catch {
    return; // absent cache — normal, no warning
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[test-impact] Cache file at ${testImpactCacheFile} is corrupt (invalid JSON); rebuilding.`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn(`[test-impact] Cache file at ${testImpactCacheFile} has unknown shape; rebuilding.`);
    return;
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    envelope.schema !== TEST_IMPACT_CACHE_IDENTITY_V1.schema
    || envelope.parserRuntimeIdentity !== TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity
    || envelope.parserOptionsDigest !== TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest
    || envelope.contractRevision !== TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision
  ) {
    // Schema/parser/contract revision mismatch — discard entire cache atomically.
    console.warn(`[test-impact] Cache envelope revision mismatch; rebuilding.`);
    return;
  }
  const entries = envelope.entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    console.warn(`[test-impact] Cache envelope entries field is invalid; rebuilding.`);
    return;
  }
  for (const [testFile, entry] of Object.entries(entries as Record<string, unknown>)) {
    if (!isCacheEntry(entry)) {
      console.warn(`[test-impact] Cache entry for ${testFile} is invalid; skipping.`);
      continue;
    }
    // Don't overwrite a fresh in-process entry with a persisted one.
    if (!testModuleImportsCache.has(testFile)) {
      testModuleImportsCache.set(testFile, entry);
    }
  }
}

function schedulePersistentTestImpactCacheSave(): void {
  persistentCacheDirty = true;
}

export function flushPersistentTestImpactCache(): void {
  if (!persistentCacheDirty) return;
  persistentCacheDirty = false;
  try {
    const envelope: TestImpactCacheEnvelope = {
      schema: TEST_IMPACT_CACHE_IDENTITY_V1.schema,
      parserRuntimeIdentity: TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity,
      parserOptionsDigest: TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest,
      contractRevision: TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision,
      entries: {}
    };
    for (const [testFile, entry] of testModuleImportsCache) {
      envelope.entries[testFile] = entry;
    }
    const dir = path.dirname(testImpactCacheFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${testImpactCacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(envelope), 'utf8');
    fs.renameSync(tmpPath, testImpactCacheFile);
  } catch {
    // Best-effort persistence — cache will be rebuilt on next run.
  }
}

/** Result of reading one repository module's compiler-observed imports. */
export type ReadModuleImportsResult =
  | { kind: 'resolved'; imports: RepositoryModuleImportV1[] }
  | { kind: 'unresolved'; reason: 'stat-failed' | 'read-failed' };

function computeSourceDigest(bytes: Uint8Array): `sha256:${string}` {
  return rawSha256(bytes);
}

function readModuleImports(
  moduleFile: string,
  provider?: CodexDevelopmentTestImpactSourceProviderV2
): ReadModuleImportsResult {
  if (provider) {
    let observed: TestImpactModuleSourceReadResultV1 | undefined;
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
    if (provider.cacheMode === 'persistent') {
      // The source provider is still the sole observation authority.  The
      // persistent cache is only a parser acceleration keyed by the exact
      // bytes consumed from that provider; it can never supply a second
      // source/graph epoch or turn an unavailable read into an empty module.
      const sourceBytes = Buffer.from(source, 'utf8');
      const sourceDigest = computeSourceDigest(new Uint8Array(sourceBytes));
      const cached = testModuleImportsCache.get(moduleFile);
      if (cached && cached.sourceDigest === sourceDigest) {
        return { kind: 'resolved', imports: cached.imports };
      }
      loadPersistentTestImpactCache();
      const persisted = testModuleImportsCache.get(moduleFile);
      if (persisted && persisted.sourceDigest === sourceDigest) {
        return { kind: 'resolved', imports: persisted.imports };
      }
      try {
        const imports = scanRepositoryModuleImports(source);
        testModuleImportsCache.set(moduleFile, {
          sourceDigest,
          imports,
          // Provider metadata is retained in its physical observation. The
          // cache's hints are deliberately neutral rather than a second
          // path-based stat epoch.
          mtimeMs: 0,
          size: sourceBytes.byteLength
        });
        schedulePersistentTestImpactCacheSave();
        return { kind: 'resolved', imports };
      } catch {
        return { kind: 'unresolved', reason: 'read-failed' };
      }
    }
    try {
      return { kind: 'resolved', imports: scanRepositoryModuleImports(source) };
    } catch {
      return { kind: 'unresolved', reason: 'read-failed' };
    }
  }

  const filePath = path.join(compilerRoot, moduleFile);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
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
  if (cached && cached.sourceDigest === sourceDigest) {
    // Update mtime/size hints in the cache if they drifted (same content, different mtime).
    if (cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      testModuleImportsCache.set(moduleFile, {
        ...cached,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
      schedulePersistentTestImpactCacheSave();
    }
    return { kind: 'resolved', imports: cached.imports };
  }

  loadPersistentTestImpactCache();
  const persisted = testModuleImportsCache.get(moduleFile);
  if (persisted && persisted.sourceDigest === sourceDigest) {
    // Update mtime/size hints.
    if (persisted.mtimeMs !== stat.mtimeMs || persisted.size !== stat.size) {
      testModuleImportsCache.set(moduleFile, {
        ...persisted,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
      schedulePersistentTestImpactCacheSave();
    }
    return { kind: 'resolved', imports: persisted.imports };
  }

  // Digest mismatch (content changed) or no cache entry — re-transpile.
  const source = bytes.toString('utf8');
  let imports: RepositoryModuleImportV1[];
  try {
    imports = scanRepositoryModuleImports(source);
  } catch {
    return { kind: 'unresolved', reason: 'read-failed' };
  }
  testModuleImportsCache.set(moduleFile, {
    sourceDigest,
    imports,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  });
  schedulePersistentTestImpactCacheSave();
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

export type RepositoryModuleReferenceV1 = SecRepositoryModuleGraphReferenceV1;
export type RepositoryModuleGraphV1 = SecRepositoryModuleGraphV1;

type ReverseImportMap = {
  map: Map<string, string[]>;
  unresolvedModuleFiles: string[];
  graph: RepositoryModuleGraphV1;
};

let reverseImportMapCache: ReverseImportMap | null = null;
let nonPersistentProviderReverseImportMapCache = new WeakMap<object, ReverseImportMap>();

function buildReverseImportMap(
  provider?: CodexDevelopmentTestImpactSourceProviderV2
): ReverseImportMap {
  if (!provider && reverseImportMapCache) return reverseImportMapCache;
  if (provider && reusableNonPersistentRepositoryProviders.has(provider)) {
    const cached = nonPersistentProviderReverseImportMapCache.get(provider);
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
  const graph: RepositoryModuleGraphV1 = compileSecRepositoryModuleGraphV1({
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
  if (provider === undefined) {
    assertSecRepositoryModuleImportBoundariesV1(graph, repositoryModuleMembershipSync());
  }
  const map = new Map<string, string[]>();
  for (const reference of graph.references) {
    // Index every deterministic candidate, not only the currently existing
    // target. That preserves impact for a removed module while the surviving
    // importer still names it; ambiguity is conservatively over-selected.
    for (const candidate of reference.candidateTargets) {
      const consumers = map.get(candidate) ?? [];
      if (!consumers.includes(reference.from)) consumers.push(reference.from);
      map.set(candidate, consumers);
    }
  }
  for (const consumers of map.values()) consumers.sort((left, right) => left.localeCompare(right));
  const unresolvedModuleFiles = [...graph.unresolvedFiles];
  const built: ReverseImportMap = { map, unresolvedModuleFiles, graph };
  if (provider && reusableNonPersistentRepositoryProviders.has(provider)) {
    nonPersistentProviderReverseImportMapCache.set(provider, built);
    // A source-bound provider may opt into the persistent parser cache only
    // for an execution context. Its graph still came from this exact frozen
    // source observation; the plan context uses the default non-persistent
    // mode and therefore never reaches this flush.
    if (provider.cacheMode === 'persistent') flushPersistentTestImpactCache();
  } else if (!provider) {
    reverseImportMapCache = built;
    // Flush the persistent cache after a full scan so it survives across
    // processes. We can't use process.on('beforeExit') because this file is
    // in the TCB runtime closure which rejects unclassified process members.
    flushPersistentTestImpactCache();
  }
  return built;
}

/**
 * Invalidate the cached reverse-import-map. Long-lived processes (e.g., a
 * future daemon) should call this when test files may have been added, removed
 * or modified on disk, so the next selection rebuilds the map fresh.
 *
 * This does NOT invalidate the persistent on-disk import-specifier cache
 * (which is keyed on sourceDigest and self-validating); it only clears the
 * in-process reverse map that aggregates compiler-observed imports across all modules.
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
  provider?: CodexDevelopmentTestImpactSourceProviderV2
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
export function readRepositoryModuleGraphV1(): RepositoryModuleGraphV1 {
  return buildReverseImportMap().graph;
}

export function deriveTestsForSourcesV1(
  files: string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV2
): string[] {
  const { map } = buildReverseImportMap(provider);
  const testFiles = new Set((provider?.testFiles ?? getTestFilesSync()).map(normalizeRepoPath));
  const matchedTests = new Set<string>();
  const visited = new Set<string>();
  const queue = files.map(normalizeRepoPath);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const consumer of map.get(current) ?? []) {
      if (testFiles.has(consumer)) {
        matchedTests.add(consumer);
      } else if (!visited.has(consumer)) {
        queue.push(consumer);
      }
    }
  }
  return uniqueSorted([...matchedTests]);
}

/**
 * Returns true if the file maps to any test impact (ownership declaration,
 * fallback rule, or module-graph-derived test). Used by ci-pr-risk-selection to
 * avoid per-file CodexDevelopmentBuildAffectedTestInventoryV1 recomputation.
 */
export function hasTestImpactForFile(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProviderV2,
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): boolean {
  const declarations = testOwnershipDeclarations.filter((declaration) => (
    matchesTestOwnershipDeclaration(declaration, file, transition)
  ));
  if (declarations.length > 0) return true;
  if (testImpactFallbackRules.some((rule) => rule.sourcePattern.test(file))) return true;
  if (verificationPhysicalUniverseTestSentinelsV1.some(({ sourcePattern }) => sourcePattern.test(file))) {
    return true;
  }
  return deriveTestsForSourcesV1([file], provider).length > 0;
}

/**
 * Resolve ownership for one changed-path batch against one already-built
 * reverse graph. This is the batch form of `hasTestImpactForFile`; callers
 * such as PR-risk selection must use it instead of rebuilding an inventory for
 * every path. The returned set is immutable and is scoped to the supplied
 * provider/observation epoch.
 */
export function resolveTestImpactForFilesV1(
  files: readonly string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV2,
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): ReadonlySet<string> {
  // Do not build the repository graph for a batch that contains no possible
  // source frontier. This keeps direct test/data/declarative changes on the
  // zero-effect path and prevents an empty graph lookup from flushing the
  // persistent cache. Source-like paths still require the provider graph.
  const graphRequired = files.some((file) => isTestImpactModuleGraphInputFile(file));
  const map = graphRequired ? buildReverseImportMap(provider).map : null;
  const testFiles = graphRequired
    ? new Set((provider?.testFiles ?? getTestFilesSync()).map(normalizeRepoPath))
    : new Set<string>();
  const resolved = new Set<string>();
  for (const file of files) {
    const declarations = testOwnershipDeclarations.some((declaration) => (
      matchesTestOwnershipDeclaration(declaration, file, transition)
    ));
    const fallback = testImpactFallbackRules.some((rule) => rule.sourcePattern.test(file));
    const sentinel = verificationPhysicalUniverseTestSentinelsV1.some(({ sourcePattern }) => (
      sourcePattern.test(file)
    ));
    if (declarations || fallback || sentinel) {
      resolved.add(file);
      continue;
    }

    if (map === null) continue;
    const visited = new Set<string>();
    const queue = [normalizeRepoPath(file)];
    let matched = false;
    while (queue.length > 0 && !matched) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const consumer of map.get(current) ?? []) {
        if (testFiles.has(consumer)) {
          matched = true;
          break;
        }
        if (!visited.has(consumer)) queue.push(consumer);
      }
    }
    if (matched) resolved.add(file);
  }
  return new Set(resolved);
}

/**
 * @internal Reset all caches for deterministic persistence tests. A supplied
 * cache path redirects only this process; null restores the production owner.
 */
export function __resetTestImpactCachesForTesting(options: Readonly<{
  persistentCacheFile?: string | null;
}> = {}): void {
  if (options.persistentCacheFile !== undefined) {
    testImpactCacheFile = options.persistentCacheFile === null
      ? DEFAULT_TEST_IMPACT_CACHE_FILE
      : path.resolve(options.persistentCacheFile);
  }
  testModuleImportsCache.clear();
  reverseImportMapCache = null;
  repositoryModuleFilesCache = null;
  persistentCacheLoaded = false;
  persistentCacheDirty = false;
  nonPersistentProviderReverseImportMapCache = new WeakMap<object, ReverseImportMap>();
}

export function resolveTestOwnership(
  files: string[],
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): ResolvedTestOwnership[] {
  return resolveDeclaredTestOwnership(files, testOwnershipDeclarations, transition);
}

export function resolveTestImpactRiskPolicies(
  files: readonly string[],
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): TestImpactRiskPolicy[] {
  return uniqueSorted(files.flatMap((file) => testOwnershipDeclarations
    .filter((declaration) => matchesTestOwnershipDeclaration(declaration, file, transition))
    .flatMap((declaration) => declaration.riskPolicies ?? [])));
}

export function selectTestsForSources(
  files: string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV2,
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): TestImpactSelection {
  const fast = new Set<string>();
  const slow = new Set<string>();
  const owners = new Set<string>();

  for (const file of files) {
    const matchedDeclarations = testOwnershipDeclarations.filter((declaration) => (
      matchesTestOwnershipDeclaration(declaration, file, transition)
    ));
    const declarations = matchedDeclarations.filter(
      ({ impactProjection }) => impactProjection !== 'risk-only'
    );
    const ownerOnly = declarations.length > 0 && declarations.every(
      ({ moduleGraphImpact }) => moduleGraphImpact === 'owner-only'
    );
    const referencedTests = ownerOnly || !isTestImpactModuleGraphInputFile(file)
      ? []
      : deriveTestsForSourcesV1([file], provider);
    if (referencedTests.length > 0) {
      owners.add('module-graph');
      addAll(fast, referencedTests.filter(isFastTestFile));
      addAll(slow, referencedTests.filter(isSlowTestFile));
    }
    for (const declaration of declarations) {
      owners.add(declaration.owner);
      addAll(fast, [...declaration.supplementalFast]);
      addAll(slow, [...declaration.supplementalSlow]);
    }

    for (const sentinel of verificationPhysicalUniverseTestSentinelsV1) {
      if (!sentinel.sourcePattern.test(file)) continue;
      addAll(fast, [...sentinel.fast]);
    }

    if (declarations.length === 0) {
      for (const rule of testImpactFallbackRules) {
        if (!rule.sourcePattern.test(file)) continue;
        owners.add(rule.owner);
        addAll(fast, rule.fast);
        addAll(slow, rule.slow);
      }
    }
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
