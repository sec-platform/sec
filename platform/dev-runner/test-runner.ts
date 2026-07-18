import path from 'node:path';
import { CodexDevelopmentBuildAffectedTestInventoryV1 } from '../shared/affected-test-inventory.ts';
import {
  gitChangedFileDiffArgs,
  gitUntrackedFileArgs,
  parseGitChangedFileOutput,
  parseGitUntrackedFileOutput
} from '../shared/ci-git-changed-files.ts';
import { uniqueSorted, uniqueSortedLines } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations, type ContractFreezeTarget } from '../shared/contract-freeze-contract.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommand } from '../shared/process.ts';
import { ensureCompilerDepsReady } from '../shared/project-runtime.ts';
import {
  getFastTestFilesSync,
  getSlowTestFilesSync,
  isFastTestFile,
  isKnownSlowTestSuiteId,
  isSlowTestFile,
  slowTestSuiteFiles,
  slowTestSuiteIds
} from '../shared/test-budget-contract.ts';
import { formatSlowImpactNotice } from '../shared/test-impact-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { pathEnvKey } from './env-manager.ts';
import { planFastTestProcesses } from './fast-test-policy.ts';

const BUN_TEST_OPTIONS_WITH_VALUE = new Set([
  '--timeout',
  '--rerun-each',
  '--seed',
  '--coverage-reporter',
  '--coverage-dir',
  '--test-name-pattern',
  '-t',
  '--reporter',
  '--reporter-outfile',
  '--max-concurrency'
]);

type BunTestArgPartition = {
  options: string[];
  selectors: string[];
};

function normalizeTestSelector(value: string): string {
  return posixPath(value).replace(/^\.\//, '');
}

function bunOptionConsumesValue(arg: string): boolean {
  const option = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
  return BUN_TEST_OPTIONS_WITH_VALUE.has(option) && !arg.includes('=');
}

function partitionBunTestArgs(args: string[]): BunTestArgPartition {
  const options: string[] = [];
  const selectors: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }
    if (arg.startsWith('-')) {
      options.push(arg);
      if (bunOptionConsumesValue(arg) && index + 1 < args.length) {
        index += 1;
        options.push(args[index]);
      }
      continue;
    }

    selectors.push(normalizeTestSelector(arg));
  }

  return { options, selectors };
}

function testFileMatchesSelector(file: string, selector: string): boolean {
  return isTestFileSelector(selector) ? file === selector : file.includes(selector);
}

function isTestFileSelector(selector: string): boolean {
  return /^tests\/.+\.(test|spec)\.tsx?$/.test(selector);
}

function selectMatchingTestFiles(availableFiles: string[], selectors: string[], label: string): string[] {
  if (selectors.length === 0) {
    return availableFiles;
  }

  const selected = availableFiles.filter((file) => (
    selectors.some((selector) => testFileMatchesSelector(file, selector))
  ));
  const unmatched = selectors.filter((selector) => (
    !availableFiles.some((file) => testFileMatchesSelector(file, selector))
  ));

  if (unmatched.length > 0) {
    throw new Error(`No ${label} test files matched: ${unmatched.join(', ')}`);
  }

  return selected;
}

function fastTestArgs(files: string[], options: string[]): string[] {
  return ['test', '--concurrent', ...files, ...options];
}

function fastTestInvocations(args: string[]): string[][] {
  const { options, selectors } = partitionBunTestArgs(args);
  const slowSelectors = selectors.filter(isSlowTestFile);
  if (slowSelectors.length > 0) {
    throw new Error(`Fast test runner cannot run slow test files: ${slowSelectors.join(', ')}`);
  }

  const selectedFiles = selectMatchingTestFiles(getFastTestFilesSync(), selectors, 'fast');
  const plan = planFastTestProcesses(selectedFiles);
  const invocations: string[][] = [];
  for (const shard of plan.concurrentShards) {
    invocations.push(fastTestArgs(shard, options));
  }
  for (const file of plan.serial) {
    invocations.push(['test', file, ...options]);
  }
  return invocations;
}

function fastTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    SEC_SKIP_RUNTIME_DEPS_SETUP: '1'
  };
}

type SlowTestRunnerArgs = {
  suiteId?: string;
  bunArgs: string[];
};

function extractSlowTestRunnerArgs(args: string[]): SlowTestRunnerArgs {
  const bunArgs: string[] = [];
  let suiteId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--suite') {
      if (suiteId) {
        throw new Error('Slow test suite can only be specified once.');
      }
      const value = args[index + 1];
      if (!value) {
        throw new Error('Slow test suite id is required after --suite.');
      }
      suiteId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--suite=')) {
      if (suiteId) {
        throw new Error('Slow test suite can only be specified once.');
      }
      suiteId = arg.slice('--suite='.length);
      if (!suiteId) {
        throw new Error('Slow test suite id is required after --suite=.');
      }
      continue;
    }

    bunArgs.push(arg);
  }

  return { suiteId, bunArgs };
}

type SlowTestArgSelection =
  | { kind: 'run'; args: string[] }
  | { kind: 'skip'; message: string };

function slowTestArgSelection(args: string[]): SlowTestArgSelection {
  const { suiteId, bunArgs } = extractSlowTestRunnerArgs(args);
  if (suiteId && !isKnownSlowTestSuiteId(suiteId)) {
    throw new Error(`Unknown slow test suite "${suiteId}". Available suites: ${slowTestSuiteIds().join(', ') || 'none'}`);
  }

  const availableFiles = suiteId ? slowTestSuiteFiles(suiteId) : getSlowTestFilesSync();
  if (availableFiles.length === 0) {
    return { kind: 'skip', message: suiteId ? `No slow files for suite ${suiteId}` : 'No slow test files detected.' };
  }

  const { options, selectors } = partitionBunTestArgs(bunArgs);
  const fastSelectors = selectors.filter(isFastTestFile);
  if (fastSelectors.length > 0) {
    throw new Error(`Slow test runner cannot run fast test files: ${fastSelectors.join(', ')}`);
  }

  const label = suiteId ? `slow suite ${suiteId}` : 'slow';
  return { kind: 'run', args: ['test', ...selectMatchingTestFiles(availableFiles, selectors, label), ...options] };
}

function fullTestInvocations(): string[][] {
  const slowSelection = slowTestArgSelection([]);
  return [
    ...fastTestInvocations([]),
    slowSelection.kind === 'run' ? slowSelection.args : []
  ].filter((invocation) => invocation.length > 0);
}

function affectedTestsBaseRef(): string | undefined {
  return process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
}

async function gitChangedFiles(): Promise<string[] | null> {
  const baseRef = affectedTestsBaseRef();
  const [tracked, untracked] = await Promise.all([
    runCommand('git', gitChangedFileDiffArgs(baseRef), { cwd: compilerRoot }),
    runCommand('git', gitUntrackedFileArgs(), { cwd: compilerRoot })
  ]);
  if (tracked.code !== 0 || untracked.code !== 0) {
    return null;
  }
  try {
    return uniqueSorted([
      ...parseGitChangedFileOutput(tracked.stdout),
      ...parseGitUntrackedFileOutput(untracked.stdout)
    ]);
  } catch {
    return null;
  }
}

function allowFullFastFallback(): boolean {
  return process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK === '1';
}

type DependencyContext = {
  binPath: string;
};

async function withTestDependencies<T>(callback: (context: DependencyContext) => Promise<T>): Promise<T> {
  const compilerDeps = await ensureCompilerDepsReady();
  return callback({ binPath: path.join(compilerDeps.nodeModulesPath, '.bin') });
}

function pathEnv(binPath: string): NodeJS.ProcessEnv {
  return {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };
}

interface AffectedTestSelection {
  tests: string[];
  slowTests: string[];
  affectedTests: string[];
  affectedSlowTests: string[];
  affectedOwners: string[];
  sourceChanged: boolean;
}

async function affectedTestSelection(): Promise<AffectedTestSelection | null> {
  const files = await gitChangedFiles();
  if (!files) return null;
  const inventory = CodexDevelopmentBuildAffectedTestInventoryV1(files);
  return {
    tests: inventory.changedFastTests,
    slowTests: inventory.changedSlowTests,
    affectedTests: inventory.affectedFastTests,
    affectedSlowTests: inventory.affectedSlowTests,
    affectedOwners: inventory.affectedOwners,
    sourceChanged: inventory.sourceChanged
  };
}

function unionTestFiles(...groups: string[][]): string[] {
  return uniqueSortedLines(groups.flat().join('\n'));
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
  if (selection.slowTests.length > 0) {
    console.log(`Changed slow test files require PR risk or release/full verification: ${selection.slowTests.join(', ')}`);
  }

  const selectedFastTests = unionTestFiles(selection.tests, selection.affectedTests);
  if (selectedFastTests.length > 0) {
    if (selection.affectedTests.length > 0) {
      console.log(`Running changed and affected fast tests for ${selection.affectedOwners.join(', ') || 'changed sources'}: ${selectedFastTests.join(', ')}`);
    }
    const code = await runFastTests(selectedFastTests);
    if (selection.affectedSlowTests.length > 0) {
      console.log(formatSlowImpactNotice({
        fast: selectedFastTests,
        slow: selection.affectedSlowTests,
        owners: selection.affectedOwners
      }));
    }
    return code;
  }

  if (selection.sourceChanged) {
    if (!allowFullFastFallback()) {
      console.log('No affected fast tests matched source changes; skipping broad fast-suite fallback in PR quick lane. Full/manual/scheduled validation covers unmapped changes.');
      return 0;
    }

    console.log('No affected fast tests matched source changes; running the fast test suite because SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1.');
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
    try {
      for (const invocation of fastTestInvocations(args)) {
        exitCode = await runDevCommand('bun', invocation, fastTestEnv(pathEnv(binPath)));
        if (exitCode !== 0) return;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      exitCode = 1;
    }
  });
  return exitCode;
}

export async function runSlowTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  await withTestDependencies(async ({ binPath }) => {
    try {
      const selection = slowTestArgSelection(args);
      if (selection.kind === 'skip') {
        console.log(selection.message);
        exitCode = 0;
        return;
      }

      exitCode = await runDevCommand('bun', selection.args, pathEnv(binPath));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      exitCode = 1;
    }
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
