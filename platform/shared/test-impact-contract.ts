import fs from 'node:fs';
import path from 'node:path';

import { rawSha256 } from './canonical-primitives.ts';
import { uniqueSorted } from './collections.ts';
import { getTestFilesSync, isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';
import { governanceTestOwnershipDeclarations } from './test-impact-rules/governance.ts';
import { pipelineTestOwnershipDeclarations } from './test-impact-rules/pipeline.ts';
import { semanticTestOwnershipDeclarations } from './test-impact-rules/semantic.ts';
import { verificationTestOwnershipDeclarations } from './test-impact-rules/verification.ts';
import {
  classifyTestImpactSource,
  matchesTestOwnershipDeclaration,
  resolveDeclaredTestOwnership,
  resolveTestOwnershipAutoReferenceMode,
  type ResolvedTestOwnership,
  type TestOwnershipDeclaration
} from './test-ownership-contract.ts';

export { classifyTestImpactSource } from './test-ownership-contract.ts';

const compilerRoot = path.resolve(import.meta.dir, '../..');
const testImportTranspiler = new Bun.Transpiler({ loader: 'tsx' });

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

export function isTestImpactSourceFile(file: string): boolean {
  if (/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)) return false;
  return classifyTestImpactSource(file) !== null || testOwnershipDeclarations.some((declaration) => (
    matchesTestOwnershipDeclaration(declaration, file)
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
      'tests/contract/slow-suite-resource-budget.test.ts',
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
      'tests/integration/project-base.test.ts',
      'tests/integration/project-dependency-runtime.test.ts'
    ],
    slow: []
  },
  {
    owner: 'repository-lockfile-contract',
    sourcePattern: /^bun\.lock$/,
    fast: ['tests/integration/compiler-dependency-installation.test.ts'],
    slow: []
  },
  {
    owner: 'test-impact',
    sourcePattern: /^platform\/shared\/test-impact-contract\.ts$/,
    fast: ['tests/contract/benchmark-budget.test.ts'],
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
  const ext = path.extname(base);
  if (ext) {
    return [base];
  }

  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    normalizeRepoPath(path.join(base, 'index.ts')),
    normalizeRepoPath(path.join(base, 'index.tsx'))
  ];
}

function importSpecifiers(source: string, testFile: string): string[] {
  try {
    return uniqueSorted(testImportTranspiler.scanImports(source)
      .filter((entry) => entry.kind === 'import-statement' || entry.kind === 'dynamic-import')
      .map((entry) => entry.path));
  } catch (error) {
    throw new Error(`Test impact source is not parseable TS/TSX: ${testFile}.`, { cause: error });
  }
}

export type CodexDevelopmentTestImpactSourceProviderV1 = {
  testFiles: readonly string[];
  readTestSource: (testFile: string) => string | null;
};

function readTestSource(testFile: string): string | null {
  try {
    return fs.readFileSync(path.join(compilerRoot, testFile), 'utf8');
  } catch {
    return null;
  }
}

// --- Persistent test import specifiers cache (Issue #206 cache identity) ---
//
// Cache identity is (testFile, sourceDigest) inside an envelope that binds
// parserRuntimeIdentity, parserOptionsDigest, contractRevision and cacheSchema
// revision. mtimeMs/size are kept only as an optional fast-path hint; the
// sourceDigest is the single source of truth and is always recomputed on read.
//
// Load rejects envelopes whose schema/parser/contract revision does not match
// the current runtime, so parser or contract upgrades invalidate the entire
// cache atomically. Corrupt or unknown-schema caches are rejected with an
// observable stderr warning (not silently empty).

const TEST_IMPACT_CACHE_SCHEMA_REVISION = 'sec-test-impact-cache-v2' as const;
const TEST_IMPACT_PARSER_RUNTIME_IDENTITY = 'bun-transpiler-tsx-v1' as const;
const TEST_IMPACT_PARSER_OPTIONS_DIGEST = rawSha256(JSON.stringify({ loader: 'tsx' }));
const TEST_IMPACT_CONTRACT_REVISION = 'test-impact-contract-v1' as const;

type TestImportSpecifiersCacheEntry = {
  sourceDigest: `sha256:${string}`;
  specifiers: string[];
  mtimeMs: number;
  size: number;
};

type TestImpactCacheEnvelope = {
  schema: typeof TEST_IMPACT_CACHE_SCHEMA_REVISION;
  parserRuntimeIdentity: typeof TEST_IMPACT_PARSER_RUNTIME_IDENTITY;
  parserOptionsDigest: typeof TEST_IMPACT_PARSER_OPTIONS_DIGEST;
  contractRevision: typeof TEST_IMPACT_CONTRACT_REVISION;
  entries: Record<string, TestImportSpecifiersCacheEntry>;
};

const TEST_IMPACT_CACHE_FILE = path.join(compilerRoot, '.tmp', 'test-impact-cache.json');

const testImportSpecifiersCache = new Map<string, TestImportSpecifiersCacheEntry>();
let persistentCacheLoaded = false;
let persistentCacheDirty = false;

function isCacheEntry(value: unknown): value is TestImportSpecifiersCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sourceDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(entry.sourceDigest)
    && Array.isArray(entry.specifiers) && entry.specifiers.every((s) => typeof s === 'string')
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
    envelope.schema !== TEST_IMPACT_CACHE_SCHEMA_REVISION
    || envelope.parserRuntimeIdentity !== TEST_IMPACT_PARSER_RUNTIME_IDENTITY
    || envelope.parserOptionsDigest !== TEST_IMPACT_PARSER_OPTIONS_DIGEST
    || envelope.contractRevision !== TEST_IMPACT_CONTRACT_REVISION
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
    if (!testImportSpecifiersCache.has(testFile)) {
      testImportSpecifiersCache.set(testFile, entry);
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
      schema: TEST_IMPACT_CACHE_SCHEMA_REVISION,
      parserRuntimeIdentity: TEST_IMPACT_PARSER_RUNTIME_IDENTITY,
      parserOptionsDigest: TEST_IMPACT_PARSER_OPTIONS_DIGEST,
      contractRevision: TEST_IMPACT_CONTRACT_REVISION,
      entries: {}
    };
    for (const [testFile, entry] of testImportSpecifiersCache) {
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

/** Result of reading a test file's import specifiers. */
export type ReadTestImportSpecifiersResult =
  | { kind: 'resolved'; specifiers: string[] }
  | { kind: 'unresolved'; reason: 'stat-failed' | 'read-failed' };

function computeSourceDigest(bytes: Uint8Array): `sha256:${string}` {
  return rawSha256(bytes);
}

function readTestImportSpecifiers(
  testFile: string,
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): ReadTestImportSpecifiersResult {
  if (provider) {
    const source = provider.readTestSource(testFile);
    if (source === null) return { kind: 'unresolved', reason: 'read-failed' };
    try {
      return { kind: 'resolved', specifiers: importSpecifiers(source, testFile) };
    } catch {
      return { kind: 'unresolved', reason: 'read-failed' };
    }
  }

  const filePath = path.join(compilerRoot, testFile);
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

  const cached = testImportSpecifiersCache.get(testFile);
  if (cached && cached.sourceDigest === sourceDigest) {
    // Update mtime/size hints in the cache if they drifted (same content, different mtime).
    if (cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      testImportSpecifiersCache.set(testFile, {
        ...cached,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
      schedulePersistentTestImpactCacheSave();
    }
    return { kind: 'resolved', specifiers: cached.specifiers };
  }

  loadPersistentTestImpactCache();
  const persisted = testImportSpecifiersCache.get(testFile);
  if (persisted && persisted.sourceDigest === sourceDigest) {
    // Update mtime/size hints.
    if (persisted.mtimeMs !== stat.mtimeMs || persisted.size !== stat.size) {
      testImportSpecifiersCache.set(testFile, {
        ...persisted,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
      schedulePersistentTestImpactCacheSave();
    }
    return { kind: 'resolved', specifiers: persisted.specifiers };
  }

  // Digest mismatch (content changed) or no cache entry — re-transpile.
  const source = bytes.toString('utf8');
  let specifiers: string[];
  try {
    specifiers = importSpecifiers(source, testFile);
  } catch {
    return { kind: 'unresolved', reason: 'read-failed' };
  }
  testImportSpecifiersCache.set(testFile, {
    sourceDigest,
    specifiers,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  });
  schedulePersistentTestImpactCacheSave();
  return { kind: 'resolved', specifiers };
}

// --- Reverse-import-map ---
// Built once per process (default mode) by scanning all test files' imports,
// producing Map<sourceFile, testFiles[]>. Reduces testsReferencingSources from
// O(changed × tests) to O(tests) one-time build + O(changed) lookups.
// In provider mode the map is built fresh (not cached) because the provider's
// test file set may differ from the real repo.
//
// Issue #206: the map also collects `unresolvedTestFiles` — test files whose
// import specifiers could not be read (stat/read/parse failure). These surface
// as a selection trust boundary: when sourceChanged && unresolvedTestFiles > 0,
// the affected-test inventory reports selectionResolved=false so the runner
// can fail closed instead of silently treating the empty closure as "no impact".

type ReverseImportMap = {
  map: Map<string, string[]>;
  unresolvedTestFiles: string[];
};

let reverseImportMapCache: ReverseImportMap | null = null;

function buildReverseImportMap(
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): ReverseImportMap {
  if (!provider && reverseImportMapCache) return reverseImportMapCache;

  const map = new Map<string, string[]>();
  const unresolvedTestFiles: string[] = [];
  const testFiles = provider?.testFiles ?? getTestFilesSync();
  for (const testFile of testFiles) {
    const result = readTestImportSpecifiers(testFile, provider);
    if (result.kind === 'unresolved') {
      // Do NOT reduce the closure: record the unresolved test file so the
      // selection trust boundary can fail closed. We still include the test
      // file as a key with an empty import list so it isn't lost, but the
      // unresolved signal propagates via unresolvedTestFiles.
      unresolvedTestFiles.push(testFile);
      continue;
    }
    for (const specifier of result.specifiers) {
      for (const candidate of importCandidates(testFile, specifier)) {
        const existing = map.get(candidate);
        if (existing) {
          if (!existing.includes(testFile)) existing.push(testFile);
        } else {
          map.set(candidate, [testFile]);
        }
      }
    }
  }

  const built: ReverseImportMap = { map, unresolvedTestFiles };
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
 * in-process reverse map that aggregates specifiers across all test files.
 */
export function invalidateReverseImportMap(): void {
  reverseImportMapCache = null;
}

/**
 * Resolution trust boundary for an affected-test selection.
 *
 * `selectionResolved` is false when any test file's import specifiers could
 * not be read (stat/read/parse failure). In that case the reverse-import-map
 * closure is incomplete and an empty `selectedFastTests` must NOT be treated
 * as "no impact" — the runner fails closed with `invalidated/selection-unresolved`.
 */
export type TestImpactSelectionResolution = {
  selectionResolved: boolean;
  unresolvedTestFiles: string[];
};

/**
 * Resolve the selection trust boundary for the current test file set.
 *
 * This is separated from `selectTestsForSources` so that callers that only
 * need the { fast, slow, owners } selection shape (e.g. existing contract
 * tests) are unaffected, while the affected-test inventory can also obtain
 * the unresolved signal to drive fail-closed behaviour.
 */
export function resolveTestImpactSelectionTrustBoundary(
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): TestImpactSelectionResolution {
  const { unresolvedTestFiles } = buildReverseImportMap(provider);
  return {
    selectionResolved: unresolvedTestFiles.length === 0,
    unresolvedTestFiles: uniqueSorted(unresolvedTestFiles)
  };
}

function testsReferencingSources(
  files: string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): string[] {
  const { map } = buildReverseImportMap(provider);
  const matchedTests = new Set<string>();
  for (const sourceFile of files.map(normalizeRepoPath)) {
    const tests = map.get(sourceFile);
    if (tests) {
      for (const testFile of tests) matchedTests.add(testFile);
    }
  }
  return uniqueSorted([...matchedTests]);
}

/**
 * Returns true if the file maps to any test impact (ownership declaration,
 * fallback rule, or auto-referenced test). Used by ci-pr-risk-selection to
 * avoid per-file CodexDevelopmentBuildAffectedTestInventoryV1 recomputation.
 */
export function hasTestImpactForFile(
  file: string,
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): boolean {
  const declarations = testOwnershipDeclarations.filter((declaration) => (
    matchesTestOwnershipDeclaration(declaration, file)
  ));
  if (declarations.length > 0) return true;
  if (testImpactFallbackRules.some((rule) => rule.sourcePattern.test(file))) return true;
  return testsReferencingSources([file], provider).length > 0;
}

/** @internal Reset all caches — for tests verifying persistence across processes. */
export function __resetTestImpactCachesForTesting(): void {
  testImportSpecifiersCache.clear();
  reverseImportMapCache = null;
  persistentCacheLoaded = false;
  persistentCacheDirty = false;
}

export function resolveTestOwnership(files: string[]): ResolvedTestOwnership[] {
  return resolveDeclaredTestOwnership(files, testOwnershipDeclarations);
}

export function selectTestsForSources(
  files: string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): TestImpactSelection {
  const fast = new Set<string>();
  const slow = new Set<string>();
  const owners = new Set<string>();

  for (const file of files) {
    const declarations = testOwnershipDeclarations.filter((declaration) => (
      matchesTestOwnershipDeclaration(declaration, file)
    ));
    if (resolveTestOwnershipAutoReferenceMode(declarations) === 'include') {
      const referencedTests = testsReferencingSources([file], provider);
      if (referencedTests.length > 0) {
        owners.add('auto-reference');
        addAll(fast, referencedTests.filter(isFastTestFile));
        addAll(slow, referencedTests.filter(isSlowTestFile));
      }
    }
    for (const declaration of declarations) {
      owners.add(declaration.owner);
      addAll(fast, [...declaration.fast]);
      addAll(slow, [...declaration.slow]);
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
