import fs from 'node:fs';
import path from 'node:path';

import { rawSha256 } from './canonical-primitives.ts';
import type { CodexDevelopmentTestImpactTransitionObservationV1 } from './ci-git-changed-files.ts';
import { uniqueSorted } from './collections.ts';
import { getTestFilesSync, isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';
import { governanceTestOwnershipDeclarations } from './test-impact-rules/governance.ts';
import { pipelineTestOwnershipDeclarations } from './test-impact-rules/pipeline.ts';
import { semanticTestOwnershipDeclarations } from './test-impact-rules/semantic.ts';
import {
  verificationPhysicalUniverseTestSentinelsV1,
  verificationTestOwnershipDeclarations
} from './test-impact-rules/verification.ts';
import {
  classifyTestImpactSource,
  matchesTestOwnershipDeclaration,
  resolveDeclaredTestOwnership,
  type ResolvedTestOwnership,
  type TestImpactRiskPolicy,
  type TestOwnershipDeclaration
} from './test-ownership-contract.ts';

export { classifyTestImpactSource } from './test-ownership-contract.ts';

const compilerRoot = path.resolve(import.meta.dir, '../..');
const moduleImportTranspilers = Object.freeze({
  ts: new Bun.Transpiler({ loader: 'ts' }),
  tsx: new Bun.Transpiler({ loader: 'tsx' })
});
const TRANSITIVE_MODULE_ROOTS = [
  'docs/scripts',
  'platform',
  'scripts',
  'tests',
  'tooling'
] as const;
const NON_RUNTIME_TYPESCRIPT_ROOTS = [
  /^platform\/registry\/official\/[^/]+\/(?:versions\/[^/]+\/)?files(?:\/|$)/u,
  /^tests\/fixtures(?:\/|$)/u
] as const;

function isRepositoryRuntimeModulePath(relativePath: string): boolean {
  return !NON_RUNTIME_TYPESCRIPT_ROOTS.some((pattern) => pattern.test(relativePath));
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
  return classifyTestImpactSource(file) !== null
    || testOwnershipDeclarations.some((declaration) => (
      matchesTestOwnershipDeclaration(declaration, file, transition)
    ))
    || verificationPhysicalUniverseTestSentinelsV1.some(({ sourcePattern }) => (
      sourcePattern.test(file)
    ));
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
  return path.normalize(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function importCandidates(testFile: string, specifier: string): string[] {
  if (!specifier.startsWith('.')) {
    return [];
  }

  const base = normalizeRepoPath(path.join(path.dirname(testFile), specifier));
  const ext = path.posix.extname(base);
  if (/^\.(?:[cm]?tsx?)$/u.test(ext)) {
    return [base];
  }
  if (/^\.(?:[cm]?jsx?)$/u.test(ext)) {
    const stem = base.slice(0, -ext.length);
    return uniqueSorted([
      base,
      `${stem}.ts`,
      `${stem}.tsx`,
      `${stem}.mts`,
      `${stem}.cts`
    ]);
  }
  if (ext) {
    return [base];
  }

  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    normalizeRepoPath(path.join(base, 'index.ts')),
    normalizeRepoPath(path.join(base, 'index.tsx')),
    normalizeRepoPath(path.join(base, 'index.mts')),
    normalizeRepoPath(path.join(base, 'index.cts'))
  ];
}

function requiresLocalModuleResolution(specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const extension = path.posix.extname(specifier);
  return extension === '' || /^\.(?:[cm]?[jt]sx?)$/u.test(extension);
}

export type RepositoryModuleImportKindV1 = 'static' | 'dynamic';

export type RepositoryModuleImportV1 = Readonly<{
  kind: RepositoryModuleImportKindV1;
  specifier: string;
}>;

function moduleImports(source: string, testFile: string): RepositoryModuleImportV1[] {
  try {
    const moduleSource = source.replace(/^#![^\r\n]*(?:\r?\n|$)/u, '');
    const transpiler = /\.tsx$/u.test(testFile)
      ? moduleImportTranspilers.tsx
      : moduleImportTranspilers.ts;
    const imports = transpiler.scanImports(moduleSource)
      .filter((entry) => entry.kind === 'import-statement' || entry.kind === 'dynamic-import')
      .map((entry) => Object.freeze({
        kind: entry.kind === 'import-statement' ? 'static' as const : 'dynamic' as const,
        specifier: entry.path
      }));
    const unique = new Map(imports.map((entry) => [
      `${entry.kind}\0${entry.specifier}`,
      entry
    ]));
    return [...unique.values()].sort((left, right) => (
      left.specifier.localeCompare(right.specifier) || left.kind.localeCompare(right.kind)
    ));
  } catch (error) {
    throw new Error(`Test impact source is not parseable TS/TSX: ${testFile}.`, { cause: error });
  }
}

export type CodexDevelopmentTestImpactSourceProviderV2 = {
  moduleFiles: readonly string[];
  testFiles: readonly string[];
  readModuleSource: (moduleFile: string) => string | null;
};

/**
 * Compile the canonical TestImpact source view from an already observed tree.
 * The caller owns physical observation; this owner alone decides which tracked
 * paths participate in the TypeScript module graph and which are tests.
 */
export function createTestImpactSourceProviderV2(input: Readonly<{
  repositoryFiles: readonly string[];
  readModuleSource: (moduleFile: string) => string | null;
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
    && TRANSITIVE_MODULE_ROOTS.some((root) => (
      repositoryFile === root || repositoryFile.startsWith(`${root}/`)
    ))
    && isRepositoryRuntimeModulePath(repositoryFile)
  )));
  const moduleFileSet = new Set(moduleFiles);
  const testFiles = Object.freeze(moduleFiles.filter((moduleFile) => (
    /^tests\/.+\.(?:test|spec)\.tsx?$/u.test(moduleFile)
  )));
  return Object.freeze({
    moduleFiles,
    testFiles,
    readModuleSource: (moduleFile: string): string | null => (
      moduleFileSet.has(moduleFile) ? input.readModuleSource(moduleFile) : null
    )
  });
}

function readRepositoryModuleSource(moduleFile: string): string | null {
  try {
    return fs.readFileSync(path.join(compilerRoot, moduleFile), 'utf8');
  } catch {
    return null;
  }
}

let repositoryModuleFilesCache: readonly string[] | null = null;

function repositoryModuleFilesSync(): readonly string[] {
  if (repositoryModuleFilesCache !== null) return repositoryModuleFilesCache;
  const files = new Set(getTestFilesSync());
  const visit = (relativeDirectory: string): void => {
    const absoluteDirectory = path.join(compilerRoot, relativeDirectory);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = normalizeRepoPath(path.join(relativeDirectory, entry.name));
      if (!isRepositoryRuntimeModulePath(relativePath)) continue;
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) files.add(relativePath);
    }
  };
  for (const root of TRANSITIVE_MODULE_ROOTS) visit(root);
  repositoryModuleFilesCache = Object.freeze(uniqueSorted([...files]));
  return repositoryModuleFilesCache;
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
  parserRuntimeIdentity: 'bun-transpiler-ts-tsx-v3-import-kind',
  parserOptionsDigest: rawSha256(JSON.stringify({
    loaders: ['ts', 'tsx'],
    importKinds: ['import-statement', 'dynamic-import']
  })),
  contractRevision: 'test-impact-contract-v4-typed-module-graph'
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

const TEST_IMPACT_CACHE_FILE = path.join(compilerRoot, '.tmp', 'test-impact-cache.json');

const testModuleImportsCache = new Map<string, TestModuleImportsCacheEntry>();
let persistentCacheLoaded = false;
let persistentCacheDirty = false;

function isModuleImport(value: unknown): value is RepositoryModuleImportV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (entry.kind === 'static' || entry.kind === 'dynamic')
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
    raw = fs.readFileSync(TEST_IMPACT_CACHE_FILE, 'utf8');
  } catch {
    return; // absent cache — normal, no warning
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[test-impact] Cache file at ${TEST_IMPACT_CACHE_FILE} is corrupt (invalid JSON); rebuilding.`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn(`[test-impact] Cache file at ${TEST_IMPACT_CACHE_FILE} has unknown shape; rebuilding.`);
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
    const dir = path.dirname(TEST_IMPACT_CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${TEST_IMPACT_CACHE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(envelope), 'utf8');
    fs.renameSync(tmpPath, TEST_IMPACT_CACHE_FILE);
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
    const source = provider.readModuleSource(moduleFile);
    if (source === null) return { kind: 'unresolved', reason: 'read-failed' };
    try {
      return { kind: 'resolved', imports: moduleImports(source, moduleFile) };
    } catch {
      return { kind: 'unresolved', reason: 'read-failed' };
    }
  }

  const filePath = path.join(compilerRoot, moduleFile);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
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
    imports = moduleImports(source, moduleFile);
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

export type RepositoryModuleReferenceV1 = Readonly<{
  from: string;
  kind: RepositoryModuleImportKindV1;
  specifier: string;
  candidateTargets: readonly string[];
  resolvedTarget: string | null;
}>;

export type RepositoryModuleGraphV1 = Readonly<{
  files: readonly string[];
  references: readonly RepositoryModuleReferenceV1[];
  directConsumers: (modulePath: string) => readonly string[];
  directDependencies: (modulePath: string) => readonly string[];
}>;

type ReverseImportMap = {
  map: Map<string, string[]>;
  unresolvedModuleFiles: string[];
  graph: RepositoryModuleGraphV1;
};

let reverseImportMapCache: ReverseImportMap | null = null;

function buildReverseImportMap(
  provider?: CodexDevelopmentTestImpactSourceProviderV2
): ReverseImportMap {
  if (!provider && reverseImportMapCache) return reverseImportMapCache;

  const map = new Map<string, string[]>();
  const unresolvedModuleFiles: string[] = [];
  const moduleFiles = provider?.moduleFiles ?? repositoryModuleFilesSync();
  const moduleFileSet = new Set(moduleFiles.map(normalizeRepoPath));
  const references: RepositoryModuleReferenceV1[] = [];
  for (const moduleFile of moduleFiles) {
    const result = readModuleImports(moduleFile, provider);
    if (result.kind === 'unresolved') {
      // Do NOT reduce the closure: any unreadable module can hide a path to a
      // test consumer, so selection must fail closed rather than treating an
      // incomplete graph as "no impact".
      unresolvedModuleFiles.push(moduleFile);
      continue;
    }
    for (const moduleImport of result.imports) {
      const { kind, specifier } = moduleImport;
      const candidates = importCandidates(moduleFile, specifier);
      const resolvedTarget = candidates.find((candidate) => moduleFileSet.has(candidate)) ?? null;
      references.push(Object.freeze({
        from: moduleFile,
        kind,
        specifier,
        candidateTargets: Object.freeze([...candidates]),
        resolvedTarget
      }));
      if (resolvedTarget === null && requiresLocalModuleResolution(specifier)) {
        unresolvedModuleFiles.push(normalizeRepoPath(moduleFile));
      }
      if (candidates.length === 0) continue;
      // Index every deterministic candidate, not only the currently existing
      // target. That preserves impact for a removed module while the surviving
      // importer still names it; ambiguity is conservatively over-selected.
      for (const candidate of candidates) {
        const existing = map.get(candidate);
        if (existing) {
          if (!existing.includes(moduleFile)) existing.push(moduleFile);
        } else {
          map.set(candidate, [moduleFile]);
        }
      }
    }
  }

  for (const consumers of map.values()) consumers.sort((left, right) => left.localeCompare(right));
  references.sort((left, right) => (
    left.from.localeCompare(right.from)
    || left.specifier.localeCompare(right.specifier)
    || left.kind.localeCompare(right.kind)
  ));
  const frozenFiles = Object.freeze(uniqueSorted(moduleFiles.map(normalizeRepoPath)));
  const frozenReferences = Object.freeze([...references]);
  const graph: RepositoryModuleGraphV1 = Object.freeze({
    files: frozenFiles,
    references: frozenReferences,
    directConsumers: (modulePath) => Object.freeze([
      ...(map.get(normalizeRepoPath(modulePath)) ?? [])
    ]),
    directDependencies: (modulePath) => Object.freeze(uniqueSorted(
      frozenReferences
        .filter((reference) => reference.from === normalizeRepoPath(modulePath))
        .flatMap((reference) => reference.resolvedTarget === null ? [] : [reference.resolvedTarget])
    ))
  });
  const built: ReverseImportMap = { map, unresolvedModuleFiles, graph };
  if (!provider) {
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

/** @internal Reset all caches — for tests verifying persistence across processes. */
export function __resetTestImpactCachesForTesting(): void {
  testModuleImportsCache.clear();
  reverseImportMapCache = null;
  repositoryModuleFilesCache = null;
  persistentCacheLoaded = false;
  persistentCacheDirty = false;
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
    const referencedTests = ownerOnly ? [] : deriveTestsForSourcesV1([file], provider);
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
      owners.add(sentinel.owner);
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
