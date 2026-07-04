import path from 'node:path';
import { uniqueSortedLines } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations, type ContractFreezeTarget } from '../shared/contract-freeze-contract.ts';
import { pathExists } from '../shared/fs.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommand } from '../shared/process.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import {
  getFastTestFilesSync,
  isFastTestFile
} from '../shared/test-budget-contract.ts';
import { selectTestsForSources } from '../shared/test-impact-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

function hasExplicitFastTestFiles(args: string[]): boolean {
  return args.some(isFastTestFile);
}

function hasBunTestOption(args: string[]): boolean {
  return args.some((arg) => arg.startsWith('-'));
}

function fastTestArgs(args: string[]): string[] {
  if (hasExplicitFastTestFiles(args) || hasBunTestOption(args)) {
    return ['test', '--concurrent', ...args];
  }

  return ['test', '--concurrent', ...getFastTestFilesSync(), ...args];
}

function fastTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    SEC_SKIP_RUNTIME_DEPS_SETUP: '1'
  };
}

function slowTestArgs(args: string[]): string[] {
  if (args.some((arg) => arg.startsWith('-'))) {
    return ['test', ...args];
  }
  return ['test', ...getSlowTestFilesSync(), ...args];
}

function fullTestInvocations(): string[][] {
  return [fastTestArgs([]), slowTestArgs([])];
}

function affectedTestsBaseRef(): string | undefined {
  return process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
}

async function gitChangedFiles(): Promise<string[] | null> {
  const baseRef = affectedTestsBaseRef();
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

function allowFullFastFallback(): boolean {
  return process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK === '1';
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

interface AffectedTestSelection {
  tests: string[];
  affectedTests: string[];
  affectedOwners: string[];
  sourceChanged: boolean;
}

async function affectedTestSelection(): Promise<AffectedTestSelection | null> {
  const files = await gitChangedFiles();
  if (!files) return null;
  const sourceFiles = files.filter(sourceFileChanged);
  const impact = selectTestsForSources(sourceFiles);
  return {
    tests: files.filter(isFastTestFile),
    affectedTests: impact.fast.filter(isFastTestFile),
    affectedOwners: impact.owners,
    sourceChanged: sourceFiles.length > 0
  };
}

export async function runAffectedTests(args: string[] = []): Promise<number> {
  if (args.length > 0) {
    return runTests(args);
  }
  const selection = await affectedTestSelection();
  if (!selection) {
    console.error('Failed to detect affected test files.');
    return 1;
  }
  if (selection.tests.length > 0) {
    return runFastTests(selection.tests);
  }
  if (selection.affectedTests.length > 0) {
    console.log(`Running affected fast tests for ${selection.affectedOwners.join(', ') || 'changed sources'}: ${selection.affectedTests.join(', ')}`);
    return runFastTests(selection.affectedTests);
  }
  if (selection.sourceChanged) {
    if (!allowFullFastFallback()) {
      console.log('No affected fast tests matched source changes; skipping broad fast-suite fallback in PR quick lane. Full/manual/scheduled validation covers unmapped changes.');
      return 0;
    }

    console.log('No affected fast tests matched source changes; running the fast test suite because SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1.');
    return runFastTests();
  }
  console.log('No affected fast test files detected.');
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
