import path from 'node:path';
import { uniqueSorted } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations } from '../shared/contract-freeze-contract.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommand } from '../shared/process.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import { getSlowTestFiles, isFastTestFile } from '../shared/test-budget-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

function fastTestArgs(args: string[]): string[] {
  return ['run', ...getSlowTestFiles().flatMap((file) => ['--exclude', file]), ...args];
}

function fastTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PJC_SKIP_RUNTIME_DEPS_SETUP: '1'
  };
}

function fullTestInvocations(): string[][] {
  return [
    fastTestArgs([]),
    ...getSlowTestFiles().map((file) => ['run', file])
  ];
}

async function gitChangedFiles(): Promise<string[] | null> {
  const [tracked, untracked] = await Promise.all([
    runCommand('git', ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'], { cwd: compilerRoot }),
    runCommand('git', ['ls-files', '--others', '--exclude-standard'], { cwd: compilerRoot })
  ]);
  if (tracked.code !== 0 || untracked.code !== 0) {
    return null;
  }
  return uniqueSorted(
    [...tracked.stdout.split(/\r?\n/), ...untracked.stdout.split(/\r?\n/)]
      .map((file) => posixPath(file.trim()))
  );
}

interface ChangedTestSelection {
  tests: string[];
  sourceChanged: boolean;
}

async function changedTestSelection(): Promise<ChangedTestSelection | null> {
  const files = await gitChangedFiles();
  if (!files) return null;
  return {
    tests: files.filter(isFastTestFile),
    sourceChanged: files.some((file) => /^(platform|scripts)\/.+\.[cm]?[tj]sx?$/.test(file))
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
  if (selection.sourceChanged) {
    console.log('No changed fast test files detected; running the fast test suite for source changes.');
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
    const invocations = args.length > 0 ? [['run', ...args]] : fullTestInvocations();
    for (const invocation of invocations) {
      exitCode = await runDevCommand(commandPath(binPath, 'vitest'), invocation, env);
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
    exitCode = await runDevCommand(commandPath(binPath, 'vitest'), fastTestArgs(args), fastTestEnv(env));
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
      exitCode = await runDevCommand(commandPath(binPath, 'vitest'), invocation.args, env);
      if (exitCode !== 0) {
        return;
      }
    }
  });
  return exitCode;
}
