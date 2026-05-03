import path from 'node:path';
import { uniqueSortedLines } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations, type ContractFreezeTarget } from '../shared/contract-freeze-contract.ts';
import { pathExists } from '../shared/fs.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommand } from '../shared/process.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import { getSlowTestFilesSync, isFastTestFile, isSlowTestFile } from '../shared/test-budget-contract.ts';
import { formatSlowImpactNotice, selectTestsForSources } from '../shared/test-impact-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

function fastTestArgs(args: string[]): string[] {
  const slowExcludeArgs = getSlowTestFilesSync()
    .flatMap((file) => ['--exclude', `./${file}`]);
  return ['test', ...slowExcludeArgs, ...args];
}

function fastTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PJC_SKIP_RUNTIME_DEPS_SETUP: '1'
  };
}

function fullTestInvocations(): string[][] {
  const slowTests = getSlowTestFilesSync();
  return [
    fastTestArgs([]),
    slowTests.length > 0 ? ['test', ...slowTests] : []
  ].filter(args => args.length > 0);
}

function slowTestArgs(args: string[]): string[] {
  const slowTests = getSlowTestFilesSync();
  if (args.length === 0) {
    return ['test', ...slowTests];
  }

  const [first, second, ...rest] = args;
  if (first === '--suite' && second) {
    const suiteTests = slowTests.filter((file) => file.includes(`/${second}.slow.test.ts`) || file.endsWith(`${second}.slow.test.ts`));
    return ['test', ...(suiteTests.length > 0 ? suiteTests : slowTests), ...rest];
  }

  return ['test', ...args];
}

function changedTestsBaseRef(): string | undefined {
  return process.env.PJC_CHANGED_TESTS_BASE ?? process.env.PJC_CHANGED_BASE;
}

async function gitChangedFiles(): Promise<string[] | null> {
  const baseRef = changedTestsBaseRef();
  const trackedArgs = baseRef
    ? ['diff', '--name-only', '--diff-filter=ACMR', baseRef, 'HEAD']
    : ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'];
  const [tracked, untracked] = await Promise.all([
    runCommand('git', trackedArgs, { cwd: compilerRoot }),
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

function allowSlowChangedNotice(): boolean {
  return process.env.PJC_CHANGED_TESTS_ALLOW_SLOW_NOTICE === '1'
    || process.env.PJC_CHANGED_TESTS_BASE !== undefined
    || process.env.PJC_CHANGED_BASE !== undefined;
}

type DependencyContext = {
  binPath: string;
};

async function rootDependencyContext(): Promise<DependencyContext | null> {
  const rootNodeModules = path.join(compilerRoot, 'node_modules');
  if (!(await pathExists(rootNodeModules))) {
    return null;
  }

  return { binPath: path.join(rootNodeModules, '.bin') };
}

async function withTestDependencies<T>(callback: (context: DependencyContext) => Promise<T>): Promise<T> {
  const rootContext = await rootDependencyContext();
  if (rootContext) {
    return callback(rootContext);
  }

  const sharedDeps = await ensureSharedDepsReady();
  const context = { binPath: path.join(sharedDeps.nodeModulesPath, '.bin') };
  return withRootDependencyBridge(sharedDeps.nodeModulesPath, () => callback(context));
}

function pathEnv(binPath: string): NodeJS.ProcessEnv {
  return {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };
}

interface ChangedTestSelection {
  tests: string[];
  slowTests: string[];
  affectedTests: string[];
  affectedSlowTests: string[];
  affectedOwners: string[];
  sourceChanged: boolean;
}

async function changedTestSelection(): Promise<ChangedTestSelection | null> {
  const files = await gitChangedFiles();
  if (!files) return null;
  const sourceFiles = files.filter(sourceFileChanged);
  const impact = selectTestsForSources(sourceFiles);
  return {
    tests: files.filter(isFastTestFile),
    slowTests: files.filter(isSlowTestFile),
    affectedTests: impact.fast.filter(isFastTestFile),
    affectedSlowTests: impact.slow.filter(isSlowTestFile),
    affectedOwners: impact.owners,
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
  if (selection.slowTests.length > 0) {
    const message = `Changed slow test files require explicit verification: ${selection.slowTests.join(', ')}`;
    if (!allowSlowChangedNotice()) {
      console.error(message);
      return 1;
    }
    console.log(message);
  }
  if (selection.tests.length > 0) {
    return runFastTests(selection.tests);
  }
  if (selection.affectedTests.length > 0) {
    console.log(`Running affected fast tests for ${selection.affectedOwners.join(', ') || 'changed sources'}: ${selection.affectedTests.join(', ')}`);
    const code = await runFastTests(selection.affectedTests);
    if (selection.affectedSlowTests.length > 0) {
      console.log(formatSlowImpactNotice({
        fast: selection.affectedTests,
        slow: selection.affectedSlowTests,
        owners: selection.affectedOwners
      }));
    }
    return code;
  }
  if (selection.sourceChanged) {
    console.log('No affected fast tests matched source changes; running the fast test suite.');
    const code = await runFastTests();
    if (selection.affectedSlowTests.length > 0) {
      console.log(formatSlowImpactNotice({
        fast: [],
        slow: selection.affectedSlowTests,
        owners: selection.affectedOwners
      }));
    }
    return code;
  }
  console.log('No changed fast test files detected.');
  return 0;
}

export async function runTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  await withTestDependencies(async ({ binPath }) => {
    const invocations = args.length > 0 ? [['test', ...args]] : fullTestInvocations();
    for (const invocation of invocations) {
      exitCode = await runDevCommand('bun', invocation, pathEnv(binPath));
      if (exitCode !== 0) return;
    }
  });
  return exitCode;
}

export async function runFastTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  await withTestDependencies(async ({ binPath }) => {
    exitCode = await runDevCommand('bun', fastTestArgs(args), fastTestEnv(pathEnv(binPath)));
  });
  return exitCode;
}

export async function runSlowTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  await withTestDependencies(async ({ binPath }) => {
    exitCode = await runDevCommand('bun', slowTestArgs(args), pathEnv(binPath));
  });
  return exitCode;
}

export async function runContractFreeze(targets?: ContractFreezeTarget[]): Promise<number> {
  let exitCode = 0;
  await withTestDependencies(async ({ binPath }) => {
    for (const invocation of buildContractFreezeRunnerInvocations(targets)) {
      exitCode = await runDevCommand('bun', invocation.args, pathEnv(binPath));
      if (exitCode !== 0) {
        return;
      }
    }
  });
  return exitCode;
}
