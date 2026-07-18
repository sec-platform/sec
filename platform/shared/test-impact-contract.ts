import fs from 'node:fs';
import path from 'node:path';

import { Node, Project, SyntaxKind } from 'ts-morph';

import { uniqueSorted } from './collections.ts';
import { compilerRoot, posixPath } from './paths.ts';
import { getTestFilesSync, isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';
import { governanceTestOwnershipDeclarations } from './test-impact-rules/governance.ts';
import { pipelineTestOwnershipDeclarations } from './test-impact-rules/pipeline.ts';
import { semanticTestOwnershipDeclarations } from './test-impact-rules/semantic.ts';
import {
  classifyTestImpactSource,
  matchesTestOwnershipDeclaration,
  resolveDeclaredTestOwnership,
  resolveTestOwnershipAutoReferenceMode,
  type ResolvedTestOwnership,
  type TestOwnershipDeclaration
} from './test-ownership-contract.ts';

export { classifyTestImpactSource } from './test-ownership-contract.ts';

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
  ...semanticTestOwnershipDeclarations
];

export function isTestImpactSourceFile(file: string): boolean {
  if (/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(file)) return false;
  return classifyTestImpactSource(file) !== null || testOwnershipDeclarations.some((declaration) => (
    matchesTestOwnershipDeclaration(declaration, file)
  ));
}

export const testImpactFallbackRules: TestImpactRule[] = [
  {
    owner: 'verification-infrastructure',
    sourcePattern: /^(?:\.github\/workflows\/|scripts\/ci-[^/]+\.ts$|platform\/dev-runner\/|platform\/shared\/ci-[^/]+\.ts$|platform\/shared\/test-(?:budget|impact|ownership)-contract\.ts$|platform\/shared\/test-impact-rules\/)/,
    fast: [
      'tests/contract/benchmark-budget.test.ts',
      'tests/contract/ci-contract.test.ts',
      'tests/contract/ci-lanes.test.ts',
      'tests/contract/slow-suite-resource-budget.test.ts',
      'tests/integration/project-runtime.test.ts',
      'tests/unit/test-runner.test.ts'
    ],
    slow: []
  },
  {
    owner: 'roadmap-authority',
    sourcePattern: /^docs\/03-MVP实施计划与路线图\.md$/,
    fast: ['tests/integration/project-runtime.test.ts'],
    slow: []
  },
  {
    owner: 'repository-runtime-contract',
    sourcePattern: /^(?:package\.json|bun\.lock)$/,
    fast: ['tests/contract/benchmark-budget.test.ts', 'tests/integration/project-runtime.test.ts'],
    slow: []
  },
  {
    owner: 'test-impact',
    sourcePattern: /^platform\/shared\/test-impact-contract\.ts$/,
    fast: ['tests/integration/project-runtime.test.ts', 'tests/contract/benchmark-budget.test.ts'],
    slow: []
  },
  {
    owner: 'dev-runner',
    sourcePattern: /^platform\/dev-runner\/(test-runner|typecheck-runner)\.ts$/,
    fast: ['tests/integration/project-runtime.test.ts', 'tests/contract/benchmark-budget.test.ts'],
    slow: []
  },
  {
    owner: 'runtime-dependencies',
    sourcePattern: /^platform\/shared\/runtime-dependency-spec\.ts$/,
    fast: ['tests/integration/project-runtime.test.ts'],
    slow: ['tests/e2e/runtime-host.test.ts']
  },
  {
    owner: 'verify',
    sourcePattern: /^platform\/compiler\/verify\//,
    fast: ['tests/unit/coverage.test.ts', 'tests/unit/policy-summary.test.ts', 'tests/integration/project-runtime.test.ts'],
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
    fast: ['tests/integration/overview.test.ts', 'tests/integration/project-runtime.test.ts'],
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
    fast: ['tests/unit/path-containment.test.ts', 'tests/integration/project-runtime.test.ts'],
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
  return posixPath(path.normalize(value)).replace(/^\.\//, '');
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

const importParserProject = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });

function literalValue(node: Node | undefined): string | null {
  if (!node) {
    return null;
  }
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return null;
}

function importSpecifiers(source: string, testFile: string): string[] {
  const specifiers = new Set<string>();
  const sourceFile = importParserProject.createSourceFile(testFile, source, { overwrite: true });

  try {
    for (const declaration of sourceFile.getImportDeclarations()) {
      specifiers.add(declaration.getModuleSpecifierValue());
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier) {
        specifiers.add(specifier);
      }
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
        continue;
      }
      const specifier = literalValue(call.getArguments()[0]);
      if (specifier) {
        specifiers.add(specifier);
      }
    }

    return [...specifiers];
  } finally {
    sourceFile.forget();
  }
}

function readTestSource(testFile: string): string | null {
  try {
    return fs.readFileSync(path.join(compilerRoot, testFile), 'utf8');
  } catch {
    return null;
  }
}

const testImportSpecifiersCache = new Map<string, string[]>();

function readTestImportSpecifiers(testFile: string): string[] {
  const cached = testImportSpecifiersCache.get(testFile);
  if (cached) return cached;

  const source = readTestSource(testFile);
  if (!source) {
    return [];
  }
  const specifiers = importSpecifiers(source, testFile);
  testImportSpecifiersCache.set(testFile, specifiers);
  return specifiers;
}

function testsReferencingSources(files: string[]): string[] {
  const sourceFiles = new Set(files.map(normalizeRepoPath));
  const matchedTests = new Set<string>();

  for (const testFile of getTestFilesSync()) {
    for (const specifier of readTestImportSpecifiers(testFile)) {
      for (const candidate of importCandidates(testFile, specifier)) {
        if (sourceFiles.has(candidate)) {
          matchedTests.add(testFile);
        }
      }
    }
  }

  return uniqueSorted([...matchedTests]);
}

export function resolveTestOwnership(files: string[]): ResolvedTestOwnership[] {
  return resolveDeclaredTestOwnership(files, testOwnershipDeclarations);
}

export function selectTestsForSources(files: string[]): TestImpactSelection {
  const fast = new Set<string>();
  const slow = new Set<string>();
  const owners = new Set<string>();

  for (const file of files) {
    const declarations = testOwnershipDeclarations.filter((declaration) => (
      matchesTestOwnershipDeclaration(declaration, file)
    ));
    if (resolveTestOwnershipAutoReferenceMode(declarations) === 'include') {
      const referencedTests = testsReferencingSources([file]);
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
