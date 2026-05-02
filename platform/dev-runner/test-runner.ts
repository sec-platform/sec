import path from 'node:path';
import { uniqueSortedLines } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations } from '../shared/contract-freeze-contract.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommand } from '../shared/process.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import { getSlowTestFiles, isFastTestFile, isSlowTestFile } from '../shared/test-budget-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

interface AffectedTestRule {
  sourcePattern: RegExp;
  tests: string[];
}

const affectedTestRules: AffectedTestRule[] = [
  {
    sourcePattern: /^platform\/shared\/test-budget-contract\.ts$/,
    tests: ['tests/cli/benchmark-budget.test.ts']
  },
  {
    sourcePattern: /^platform\/shared\/benchmark-contract\.ts$/,
    tests: ['tests/cli/benchmark-budget.test.ts']
  },
  {
    sourcePattern: /^platform\/shared\/runtime-dependency-spec\.ts$/,
    tests: ['tests/cli/demo-doctor.test.ts', 'tests/pipeline/runtime-host.test.ts']
  },
  {
    sourcePattern: /^platform\/compiler\/verify\//,
    tests: ['tests/cli/verification.test.ts', 'tests/pipeline/lanes.test.ts', 'tests/pipeline/runtime-host.test.ts']
  },
  {
    sourcePattern: /^platform\/compiler\/upgrade\//,
    tests: ['tests/cli/upgrade.test.ts', 'tests/upgrade/conflicts.test.ts', 'tests/upgrade/dry-run-plan.test.ts']
  },
  {
    sourcePattern: /^platform\/compiler\/repair\//,
    tests: ['tests/cli/repair.test.ts', 'tests/repair/repair-plan.test.ts', 'tests/review/repair-summary.test.ts']
  },
  {
    sourcePattern: /^platform\/compiler\/(parse|resolve|compose|adapt)\//,
    tests: ['tests/pipeline/end-to-end.test.ts', 'tests/registry/expanded-blocks.test.ts']
  },
  {
    sourcePattern: /^platform\/compiler\/explain\//,
    tests: ['tests/cli/explain.test.ts', 'tests/explain/graph.test.ts', 'tests/review/summary.test.ts']
  },
  {
    sourcePattern: /^platform\/cli\//,
    tests: [
      'tests/cli/benchmark-budget.test.ts',
      'tests/cli/contracts.test.ts',
      'tests/cli/overview.test.ts',
      'tests/cli/reference.test.ts',
      'tests/cli/usage.test.ts'
    ]
  },
  {
    sourcePattern: /^platform\/registry\//,
    tests: ['tests/registry/expanded-blocks.test.ts', 'tests/registry/registry.test.ts']
  },
  {
    sourcePattern: /^scripts\//,
    tests: ['tests/cli/usage.test.ts']
  }
];

function fastTestArgs(args: string[]): string[] {
  return ['test', ...getSlowTestFiles().flatMap((file) => ['--exclude', file]), ...args];
}

function fastTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PJC_SKIP_RUNTIME_DEPS_SETUP: '1'
  };
}

function fullTestInvocations(): string[][] {
  const slowTests = getSlowTestFiles();
  return [
    fastTestArgs([]),
    slowTests.length > 0 ? ['test', ...slowTests] : []
  ].filter(args => args.length > 0);
}

async function gitChangedFiles(): Promise<string[] | null> {
  const [tracked, untracked] = await Promise.all([
    runCommand('git', ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'], { cwd: compilerRoot }),
    runCommand('git', ['ls-files', '--others', '--exclude-standard'], { cwd: compilerRoot })
  ]);
  if (tracked.code !== 0 || untracked.code !== 0) {
    return null;
  }
  return uniqueSortedLines(`${tracked.stdout}\n${untracked.stdout}`)
    .map(posixPath);
}

function sourceFileChanged(file: string): boolean {
  return /^(platform|scripts)\/.+\.[cm]?[tj]sx?$/.test(file);
}

function affectedFastTestsForSources(files: string[]): string[] {
  const affected = new Set<string>();
  for (const file of files) {
    for (const rule of affectedTestRules) {
      if (rule.sourcePattern.test(file)) {
        for (const testFile of rule.tests) {
          if (isFastTestFile(testFile)) {
            affected.add(testFile);
          }
        }
      }
    }
  }
  return [...affected].sort((left, right) => left.localeCompare(right));
}

interface ChangedTestSelection {
  tests: string[];
  slowTests: string[];
  affectedTests: string[];
  sourceChanged: boolean;
}

async function changedTestSelection(): Promise<ChangedTestSelection | null> {
  const files = await gitChangedFiles();
  if (!files) return null;
  const sourceFiles = files.filter(sourceFileChanged);
  return {
    tests: files.filter(isFastTestFile),
    slowTests: files.filter(isSlowTestFile),
    affectedTests: affectedFastTestsForSources(sourceFiles),
    sourceChanged: sourceFiles.length > 0
  };
}

export async function runChangedTests(args: string[] = []): Promise<number> {
  if (args.length > 0) {
    return runTests(args);
  }
  const selection = await changedTestSelection();
  if (!selection) {
    console.error('Failed to detect changed test files.');
    return 1;
  }
  if (selection.tests.length > 0) {
    return runFastTests(selection.tests);
  }
  if (selection.slowTests.length > 0) {
    console.error(`Changed slow test files require explicit verification: ${selection.slowTests.join(', ')}`);
    return 1;
  }
  if (selection.affectedTests.length > 0) {
    console.log(`Running affected fast tests: ${selection.affectedTests.join(', ')}`);
    return runFastTests(selection.affectedTests);
  }
  if (selection.sourceChanged) {
    console.log('No affected fast tests matched source changes; running the fast test suite.');
    return runFastTests();
  }
  console.log('No changed fast test files detected.');
  return 0;
}

export async function runTests(args: string[] = []): Promise<number> {
  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  let exitCode = 1;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    const invocations = args.length > 0 ? [['test', ...args]] : fullTestInvocations();
    for (const invocation of invocations) {
      exitCode = await runDevCommand('bun', invocation, env);
      if (exitCode !== 0) return;
    }
  });
  return exitCode;
}

export async function runFastTests(args: string[] = []): Promise<number> {
  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  let exitCode = 1;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    exitCode = await runDevCommand('bun', fastTestArgs(args), fastTestEnv(env));
  });
  return exitCode;
}

export async function runContractFreeze(): Promise<number> {
  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  let exitCode = 0;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    for (const invocation of buildContractFreezeRunnerInvocations()) {
      const env = {
        [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
      };
      exitCode = await runDevCommand('bun', invocation.args, env);
      if (exitCode !== 0) {
        return;
      }
    }
  });
  return exitCode;
}
