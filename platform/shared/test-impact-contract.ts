import fs from 'node:fs';
import path from 'node:path';

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

// --- Persistent test import specifiers cache ---
// Keyed on testFile + stat.mtimeMs, survives across processes via
// .tmp/test-impact-cache.json. Eliminates redundant Bun.Transpiler.scanImports
// calls across dev-runner invocations.

type TestImportSpecifiersCacheEntry = { mtimeMs: number; specifiers: string[] };

const TEST_IMPACT_CACHE_FILE = path.join(compilerRoot, '.tmp', 'test-impact-cache.json');

const testImportSpecifiersCache = new Map<string, TestImportSpecifiersCacheEntry>();
let persistentCacheLoaded = false;
let persistentCacheDirty = false;

function loadPersistentTestImpactCache(): void {
  if (persistentCacheLoaded) return;
  persistentCacheLoaded = true;
  try {
    const raw = fs.readFileSync(TEST_IMPACT_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, TestImportSpecifiersCacheEntry>;
    for (const [testFile, entry] of Object.entries(parsed)) {
      // Don't overwrite a fresh in-process entry with a stale persisted one.
      if (!testImportSpecifiersCache.has(testFile)) {
        testImportSpecifiersCache.set(testFile, entry);
      }
    }
  } catch {
    // Cache absent or corrupt — start empty.
  }
}

function schedulePersistentTestImpactCacheSave(): void {
  persistentCacheDirty = true;
}

export function flushPersistentTestImpactCache(): void {
  if (!persistentCacheDirty) return;
  persistentCacheDirty = false;
  try {
    const obj: Record<string, TestImportSpecifiersCacheEntry> = {};
    for (const [testFile, entry] of testImportSpecifiersCache) {
      obj[testFile] = entry;
    }
    const dir = path.dirname(TEST_IMPACT_CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${TEST_IMPACT_CACHE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmpPath, TEST_IMPACT_CACHE_FILE);
  } catch {
    // Best-effort persistence — cache will be rebuilt on next run.
  }
}

function readTestImportSpecifiers(
  testFile: string,
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): string[] {
  if (provider) {
    const source = provider.readTestSource(testFile);
    return source === null ? [] : importSpecifiers(source, testFile);
  }

  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(path.join(compilerRoot, testFile)).mtimeMs;
  } catch {
    return [];
  }

  const cached = testImportSpecifiersCache.get(testFile);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.specifiers;
  }

  loadPersistentTestImpactCache();
  const persisted = testImportSpecifiersCache.get(testFile);
  if (persisted && persisted.mtimeMs === mtimeMs) {
    return persisted.specifiers;
  }

  const source = readTestSource(testFile);
  if (!source) {
    return [];
  }
  const specifiers = importSpecifiers(source, testFile);
  testImportSpecifiersCache.set(testFile, { mtimeMs, specifiers });
  schedulePersistentTestImpactCacheSave();
  return specifiers;
}

// --- Reverse-import-map ---
// Built once per process (default mode) by scanning all test files' imports,
// producing Map<sourceFile, testFiles[]>. Reduces testsReferencingSources from
// O(changed × tests) to O(tests) one-time build + O(changed) lookups.
// In provider mode the map is built fresh (not cached) because the provider's
// test file set may differ from the real repo.

let reverseImportMapCache: Map<string, string[]> | null = null;

function buildReverseImportMap(
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): Map<string, string[]> {
  if (!provider && reverseImportMapCache) return reverseImportMapCache;

  const map = new Map<string, string[]>();
  const testFiles = provider?.testFiles ?? getTestFilesSync();
  for (const testFile of testFiles) {
    for (const specifier of readTestImportSpecifiers(testFile, provider)) {
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

  if (!provider) {
    reverseImportMapCache = map;
    // Flush the persistent cache after a full scan so it survives across
    // processes. We can't use process.on('beforeExit') because this file is
    // in the TCB runtime closure which rejects unclassified process members.
    flushPersistentTestImpactCache();
  }
  return map;
}

function testsReferencingSources(
  files: string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): string[] {
  const map = buildReverseImportMap(provider);
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
