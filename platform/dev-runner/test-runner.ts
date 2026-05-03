import path from 'node:path';
import { uniqueSortedLines } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations } from '../shared/contract-freeze-contract.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommand } from '../shared/process.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import { formatSlowImpactNotice, selectTestsForSources } from '../shared/test-impact-contract.ts';
import { getSlowTestFilesSync, isFastTestFile, isSlowTestFile, slowTestExcludePattern } from '../shared/test-budget-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

function fastTestArgs(args: string[]): string[] {
  return ['test', '--exclude', slowTestExcludePattern(), ...args];
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
    console.error(`Changed slow test files require explicit verification: ${selection.slowTests.join(', ')}`);
    return 1;
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

export async function runSlowTests(args: string[] = []): Promise<number> {
  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  let exitCode = 1;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    exitCode = await runDevCommand('bun', slowTestArgs(args), env);
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
