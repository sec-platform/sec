import fs from 'node:fs';
import path from 'node:path';

import { Node, Project, SyntaxKind } from 'ts-morph';

import { uniqueSorted } from './collections.ts';
import { compilerRoot, posixPath } from './paths.ts';
import { getTestFilesSync, isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';

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

export const testImpactRules: TestImpactRule[] = [
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
    slow: ['tests/e2e/runtime-host.slow.test.ts']
  },
  {
    owner: 'verify',
    sourcePattern: /^platform\/compiler\/verify\//,
    fast: ['tests/unit/coverage.test.ts', 'tests/unit/policy-summary.test.ts', 'tests/integration/project-runtime.test.ts'],
    slow: ['tests/e2e/verification.slow.test.ts']
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
    slow: ['tests/e2e/upgrade.slow.test.ts', 'tests/e2e/dry-run-plan.slow.test.ts']
  },
  {
    owner: 'repair',
    sourcePattern: /^platform\/compiler\/repair\//,
    fast: ['tests/unit/repair-plan.test.ts', 'tests/unit/repair-summary.test.ts', 'tests/integration/repair.test.ts'],
    slow: ['tests/e2e/repair.slow.test.ts']
  },
  {
    owner: 'pipeline',
    sourcePattern: /^platform\/compiler\/(parse|resolve|compose|adapt)\//,
    fast: ['tests/integration/overview.test.ts', 'tests/integration/project-runtime.test.ts'],
    slow: ['tests/e2e/pipeline.slow.test.ts', 'tests/e2e/end-to-end.slow.test.ts']
  },
  {
    owner: 'explain',
    sourcePattern: /^platform\/compiler\/explain\//,
    fast: ['tests/unit/graph-mutation-dry-run.test.ts', 'tests/unit/project-overview.test.ts', 'tests/integration/review.test.ts'],
    slow: ['tests/e2e/explain.slow.test.ts', 'tests/e2e/provenance.slow.test.ts']
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
    slow: ['tests/e2e/registry.slow.test.ts', 'tests/e2e/private-registry.slow.test.ts']
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

function testsReferencingSources(files: string[]): string[] {
  const sourceFiles = new Set(files.map(normalizeRepoPath));
  const matchedTests = new Set<string>();

  for (const testFile of getTestFilesSync()) {
    const source = readTestSource(testFile);
    if (!source) {
      continue;
    }

    for (const specifier of importSpecifiers(source, testFile)) {
      for (const candidate of importCandidates(testFile, specifier)) {
        if (sourceFiles.has(candidate)) {
          matchedTests.add(testFile);
        }
      }
    }
  }

  return uniqueSorted([...matchedTests]);
}

export function selectTestsForSources(files: string[]): TestImpactSelection {
  const fast = new Set<string>();
  const slow = new Set<string>();
  const owners = new Set<string>();

  const referencedTests = testsReferencingSources(files);
  if (referencedTests.length > 0) {
    owners.add('auto-reference');
    addAll(fast, referencedTests.filter(isFastTestFile));
    addAll(slow, referencedTests.filter(isSlowTestFile));
  }

  for (const file of files) {
    for (const rule of testImpactRules) {
      if (rule.sourcePattern.test(file)) {
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
