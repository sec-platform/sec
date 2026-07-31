import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  classifyAffectedSelectionTrustBoundary,
  CodexDevelopmentAffectedInventoryInputsV1,
  CodexDevelopmentBuildAffectedTestInventoryV1,
  defaultAffectedSelectionProjectionContext,
  isAffectedSelectionFailClosed,
  projectAffectedSelectionToVerificationGateResult,
  type AffectedSelectionTrustBoundary
} from '../shared/affected-test-inventory.ts';
import {
  gitChangedFileDiffArgs,
  gitUntrackedFileArgs,
  parseGitChangedFileOutput,
  parseGitUntrackedFileOutput
} from '../shared/ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from '../shared/ci-pr-risk-selection.ts';
import { uniqueSorted, uniqueSortedLines } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations, type ContractFreezeTarget } from '../shared/contract-freeze-contract.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommandBytes } from '../shared/process.ts';
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
import type { VerificationGateResultV1 } from '../shared/verification-result-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { ensureTestDependencies } from './dependency-bootstrap.ts';
import {
  cleanStaleTestWorkspaces,
  cleanTestWorkspaces,
  pathEnvKey,
  resolveTestWorkspaceNamespace,
  TEST_WORKSPACE_NAMESPACE_ENV
} from './env-manager.ts';
import {
  DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY,
  DEFAULT_FAST_TEST_TIMEOUT_MS,
  DEFAULT_ISOLATED_FAST_TEST_CONCURRENCY,
  isDefaultFastTestFile,
  planFastTestProcesses
} from './fast-test-policy.ts';

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

function fastTestArgs(files: string[], options: string[], concurrent: boolean): string[] {
  const effectiveOptions = options.some((option) => (
    option === '--timeout' || option.startsWith('--timeout=')
  ))
    ? options
    : [...options, '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)];

  return ['test', ...(concurrent ? ['--concurrent'] : []), ...files, ...effectiveOptions];
}

type FastTestInvocationPlan = {
  concurrentShards: string[][];
  isolatedParallel: string[][];
  exclusive: string[][];
};

function fastTestInvocations(
  args: string[],
  inventory: 'default' | 'complete' = 'default'
): FastTestInvocationPlan {
  const { options, selectors } = partitionBunTestArgs(args);
  const slowSelectors = selectors.filter(isSlowTestFile);
  if (slowSelectors.length > 0) {
    throw new Error(`Fast test runner cannot run slow test files: ${slowSelectors.join(', ')}`);
  }

  const completeFastFiles = getFastTestFilesSync();
  const availableFiles = selectors.length === 0 && inventory === 'default'
    ? completeFastFiles.filter(isDefaultFastTestFile)
    : completeFastFiles;
  const selectedFiles = selectMatchingTestFiles(availableFiles, selectors, 'fast');
  const plan = planFastTestProcesses(selectedFiles);
  return {
    concurrentShards: plan.concurrentShards.map((shard) => fastTestArgs(shard, options, true)),
    isolatedParallel: plan.isolatedParallel.map((file) => fastTestArgs([file], options, false)),
    exclusive: plan.exclusive.map((file) => fastTestArgs([file], options, false))
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
  const fast = fastTestInvocations([], 'complete');
  return [
    ...fast.concurrentShards,
    ...fast.isolatedParallel,
    ...fast.exclusive,
    slowSelection.kind === 'run' ? slowSelection.args : []
  ].filter((invocation) => invocation.length > 0);
}

function affectedTestsBaseRef(): string | undefined {
  return process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
}

async function gitChangedFiles(): Promise<string[] | null> {
  const baseRef = affectedTestsBaseRef();
  const [tracked, untracked] = await Promise.all([
    runCommandBytes('git', gitChangedFileDiffArgs(baseRef), { cwd: compilerRoot }),
    runCommandBytes('git', gitUntrackedFileArgs(), { cwd: compilerRoot })
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
  browserCachePath: string;
};

async function withTestDependencies<T>(callback: (context: DependencyContext) => Promise<T>): Promise<T> {
  const dependencies = await ensureTestDependencies();
  return callback({
    binPath: path.join(dependencies.nodeModulesPath, '.bin'),
    browserCachePath: dependencies.browserCachePath
  });
}

function pathEnv(
  binPath: string,
  browserCachePath: string,
  additionalEnv: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`,
    PLAYWRIGHT_BROWSERS_PATH: browserCachePath,
    SEC_SKIP_RUNTIME_DEPS_SETUP: '1',
    ...additionalEnv
  };
}

let fastTestRunSequence = 0;

function fastTestWorkspaceEnv(): NodeJS.ProcessEnv {
  const configured = resolveTestWorkspaceNamespace(process.env);
  fastTestRunSequence += 1;
  return {
    [TEST_WORKSPACE_NAMESPACE_ENV]: configured ?? (
      `fast-${process.pid}-${Date.now().toString(36)}-${fastTestRunSequence.toString(36)}`
    )
  };
}

async function runSequentialInvocations(
  invocations: string[][],
  env: NodeJS.ProcessEnv
): Promise<number> {
  for (const invocation of invocations) {
    const code = await runDevCommand('bun', invocation, env);
    if (code !== 0) return code;
  }
  return 0;
}

async function runBoundedInvocations(
  invocations: string[][],
  env: NodeJS.ProcessEnv,
  concurrency: number
): Promise<number> {
  for (let index = 0; index < invocations.length; index += concurrency) {
    const batch = invocations.slice(index, index + concurrency);
    const outcomes = await Promise.allSettled(
      batch.map((invocation) => runDevCommand('bun', invocation, env))
    );
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
    );
    if (rejected) throw rejected.reason;
    const failure = outcomes.find(
      (outcome): outcome is PromiseFulfilledResult<number> => (
        outcome.status === 'fulfilled' && outcome.value !== 0
      )
    );
    if (failure) return failure.value;
  }
  return 0;
}

interface AffectedTestSelection {
  readonly tests: readonly string[];
  readonly slowTests: readonly string[];
  readonly affectedTests: readonly string[];
  readonly affectedSlowTests: readonly string[];
  readonly affectedOwners: readonly string[];
  readonly sourceChanged: boolean;
  readonly selectionResolved: boolean;
  readonly unresolvedTestFiles: readonly string[];
}

function affectedTestSelection(files: string[]): AffectedTestSelection {
  const currentTestFiles = new Set([
    ...getFastTestFilesSync(),
    ...getSlowTestFilesSync()
  ]);
  const inventory = CodexDevelopmentBuildAffectedTestInventoryV1(
    CodexDevelopmentAffectedInventoryInputsV1(files, (file) => currentTestFiles.has(file))
  );
  return {
    tests: inventory.changedFastTests,
    slowTests: inventory.changedSlowTests,
    affectedTests: inventory.affectedFastTests,
    affectedSlowTests: inventory.affectedSlowTests,
    affectedOwners: inventory.affectedOwners,
    sourceChanged: inventory.sourceChanged,
    selectionResolved: inventory.selectionResolved,
    unresolvedTestFiles: inventory.unresolvedTestFiles
  };
}

function unionTestFiles(...groups: string[][]): string[] {
  return uniqueSortedLines(groups.flat().join('\n'));
}

function unresolvedRiskPaths(files: string[]): string[] {
  return files.filter((file) => !selectCiPrRiskSlowSuites([file]).resolved);
}

export interface AffectedTestPlanV1 {
  readonly schema: 'sec-affected-test-plan-v1';
  readonly changedPaths: readonly string[];
  readonly owners: readonly string[];
  readonly selectedFastTests: readonly string[];
  readonly selectedSlowTests: readonly string[];
  readonly riskSuites: readonly string[];
  readonly riskTests: readonly string[];
  readonly riskReasons: readonly string[];
  readonly unresolvedPaths: readonly string[];
  readonly resolved: boolean;
  readonly selectionResolved: AffectedTestSelection;
  /**
   * Issue #206 trust boundary classification for this plan. Computed from the
   * same inputs as `resolved` and `selectionResolved` but projected to a
   * stable enum so CI and callers can branch on the boundary without
   * re-deriving it.
   */
  readonly selectionTrustBoundary: AffectedSelectionTrustBoundary;
  /**
   * Issue #206 projection of the plan-phase trust boundary to the unified
   * VerificationGateResultV1 model. For fail-closed boundaries this carries
   * `status: invalidated, reasonCode: selection-unresolved`. For applicable
   * boundaries this carries `status: not-run` (plan phase; execution outcome
   * is NOT represented here).
   */
  readonly verificationResult: VerificationGateResultV1;
}

export interface ResolvedAffectedTestExecutionV1 {
  readonly plan: AffectedTestPlanV1;
  readonly run: () => Promise<number>;
}

function computeAffectedInputDigest(files: readonly string[]): `sha256:${string}` {
  const sorted = uniqueSorted([...files]);
  const hash = createHash('sha256');
  for (const file of sorted) hash.update(file);
  hash.update('\0');
  return `sha256:${hash.digest('hex')}` as `sha256:${string}`;
}

function affectedTestPlan(files: string[]): AffectedTestPlanV1 {
  const risk = selectCiPrRiskSlowSuites(files);
  const selection = affectedTestSelection(files);
  const unresolvedPaths = unresolvedRiskPaths(files);
  const selectedFastTests = unionTestFiles([...selection.tests], [...selection.affectedTests]);
  const ownershipResolved = risk.resolved && unresolvedPaths.length === 0;
  const trustBoundary = classifyAffectedSelectionTrustBoundary({
    gitDiscoveryFailed: false,
    ownershipResolved,
    sourceChanged: selection.sourceChanged,
    selectionResolved: selection.selectionResolved,
    unresolvedTestFiles: selection.unresolvedTestFiles,
    selectedFastTestCount: selectedFastTests.length,
    broadFallbackEnabled: allowFullFastFallback()
  });
  const subjectRevision = affectedTestsBaseRef() ?? 'HEAD';
  const inputDigest = computeAffectedInputDigest(files);
  const diagnostic = isAffectedSelectionFailClosed(trustBoundary)
    ? `Affected selection trust boundary: ${trustBoundary}`
    : null;
  const verificationResult = projectAffectedSelectionToVerificationGateResult(
    trustBoundary,
    defaultAffectedSelectionProjectionContext(subjectRevision, inputDigest, diagnostic)
  );
  return {
    schema: 'sec-affected-test-plan-v1',
    changedPaths: files,
    owners: uniqueSorted([...selection.affectedOwners, ...risk.owners]),
    selectedFastTests,
    selectedSlowTests: unionTestFiles([...selection.slowTests], [...selection.affectedSlowTests]),
    riskSuites: risk.suites,
    riskTests: unionTestFiles(
      risk.suites.flatMap((suite) => slowTestSuiteFiles(suite)),
      risk.slowTests
    ),
    riskReasons: risk.reasons,
    unresolvedPaths,
    resolved: ownershipResolved,
    selectionResolved: selection,
    selectionTrustBoundary: trustBoundary,
    verificationResult
  };
}

function freezeAffectedTestPlan(plan: AffectedTestPlanV1): AffectedTestPlanV1 {
  return Object.freeze({
    ...plan,
    changedPaths: Object.freeze([...plan.changedPaths]),
    owners: Object.freeze([...plan.owners]),
    selectedFastTests: Object.freeze([...plan.selectedFastTests]),
    selectedSlowTests: Object.freeze([...plan.selectedSlowTests]),
    riskSuites: Object.freeze([...plan.riskSuites]),
    riskTests: Object.freeze([...plan.riskTests]),
    riskReasons: Object.freeze([...plan.riskReasons]),
    unresolvedPaths: Object.freeze([...plan.unresolvedPaths]),
    selectionResolved: Object.freeze({
      tests: Object.freeze([...plan.selectionResolved.tests]),
      slowTests: Object.freeze([...plan.selectionResolved.slowTests]),
      affectedTests: Object.freeze([...plan.selectionResolved.affectedTests]),
      affectedSlowTests: Object.freeze([...plan.selectionResolved.affectedSlowTests]),
      affectedOwners: Object.freeze([...plan.selectionResolved.affectedOwners]),
      sourceChanged: plan.selectionResolved.sourceChanged,
      selectionResolved: plan.selectionResolved.selectionResolved,
      unresolvedTestFiles: Object.freeze([...plan.selectionResolved.unresolvedTestFiles])
    }),
    verificationResult: Object.freeze({ ...plan.verificationResult })
  });
}

async function runAffectedTestPlan(plan: AffectedTestPlanV1): Promise<number> {
  if (!plan.resolved) {
    console.error(`Affected test ownership is unresolved for changed paths: ${plan.unresolvedPaths.join(', ')}`);
    return 1;
  }
  // Reuse the selection computed during plan construction instead of recomputing.
  const selection = plan.selectionResolved;
  if (selection.slowTests.length > 0) {
    console.log(`Changed slow test files require PR risk or release/full verification: ${selection.slowTests.join(', ')}`);
  }

  const selectedFastTests = [...plan.selectedFastTests];
  if (selectedFastTests.length > 0) {
    if (selection.affectedTests.length > 0) {
      console.log(`Running changed and affected fast tests for ${selection.affectedOwners.join(', ') || 'changed sources'}: ${selectedFastTests.join(', ')}`);
    }
    const code = await runFastTests(selectedFastTests);
    if (selection.affectedSlowTests.length > 0) {
      console.log(formatSlowImpactNotice({
        fast: selectedFastTests,
        slow: [...selection.affectedSlowTests],
        owners: [...selection.affectedOwners]
      }));
    }
    return code;
  }

  if (selection.sourceChanged) {
    if (!allowFullFastFallback()) {
      // Issue #206: source changed but no fast tests selected and no fallback.
      // This is a fail-closed trust boundary — the empty closure is NOT proof
      // of "no impact". Returning 0 here would be a false-green: it would let
      // CI treat "selector found nothing" as "change has no impact", masking
      // both missing test coverage and selector/read failures. Fail closed
      // with the invalidated/selection-unresolved verification result so
      // callers must explicitly opt into broad fallback or add targeted tests.
      console.error(
        `Affected selection trust boundary is ${plan.selectionTrustBoundary}; `
        + 'source changed but no fast tests selected and SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK is not set. '
        + 'Failing closed to avoid false-green.'
      );
      return 1;
    }

    console.log('No affected fast tests matched source changes; running the fast test suite because SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1.');
    const code = await runFastTests();
    if (selection.affectedSlowTests.length > 0) {
      console.log(formatSlowImpactNotice({
        fast: [],
        slow: [...selection.affectedSlowTests],
        owners: [...selection.affectedOwners]
      }));
    }
    return code;
  }
  console.log('No affected fast test files detected.');
  return 0;
}

export async function resolveAffectedTestExecution(): Promise<ResolvedAffectedTestExecutionV1 | null> {
  const files = await gitChangedFiles();
  if (!files) return null;
  const plan = freezeAffectedTestPlan(affectedTestPlan(files));
  return Object.freeze({
    plan,
    run: () => runAffectedTestPlan(plan)
  });
}

export async function runAffectedTests(args: string[] = []): Promise<number> {
  if (args.length > 0 && !(args.length === 1 && args[0] === '--plan')) {
    return runTests(args);
  }
  const execution = await resolveAffectedTestExecution();
  if (!execution) {
    console.error('Failed to detect affected test files.');
    return 1;
  }
  if (args.length === 1) {
    console.log(JSON.stringify(execution.plan, null, 2));
    // Issue #206: --plan fails closed for any unresolved trust boundary, not
    // just ownership-unresolved. This keeps `--plan` exit codes consistent
    // with the execution path so CI can branch on `--plan` alone.
    return isAffectedSelectionFailClosed(execution.plan.selectionTrustBoundary) ? 1 : 0;
  }
  return execution.run();
}

export async function runTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  await withTestDependencies(async ({ binPath, browserCachePath }) => {
    const invocations = args.length > 0 ? [['test', ...args]] : fullTestInvocations();
    for (const invocation of invocations) {
      exitCode = await runDevCommand('bun', invocation, pathEnv(binPath, browserCachePath));
      if (exitCode !== 0) return;
    }
  });
  return exitCode;
}

export async function runFastTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  const workspaceEnv = fastTestWorkspaceEnv();
  let primaryFailure: unknown;
  // One-time stale workspace cleanup before spawning shards, replacing the
  // previous per-subprocess preload call that caused redundant I/O.
  try { await cleanStaleTestWorkspaces(); } catch { /* non-critical */ }
  try {
    await withTestDependencies(async ({ binPath, browserCachePath }) => {
      try {
        const plan = fastTestInvocations(args);
        const env = pathEnv(binPath, browserCachePath, workspaceEnv);
        exitCode = await runBoundedInvocations(
          plan.concurrentShards,
          env,
          DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY
        );
        if (exitCode !== 0) return;
        exitCode = await runBoundedInvocations(
          plan.isolatedParallel,
          env,
          DEFAULT_ISOLATED_FAST_TEST_CONCURRENCY
        );
        if (exitCode !== 0) return;
        exitCode = await runSequentialInvocations(plan.exclusive, env);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        exitCode = 1;
      }
    });
  } catch (error) {
    primaryFailure = error;
  }
  try {
    await cleanTestWorkspaces(workspaceEnv);
  } catch (error) {
    console.error(`Fast test workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!primaryFailure) exitCode = 1;
  }
  if (primaryFailure) throw primaryFailure;
  return exitCode;
}

export async function runSlowTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  await withTestDependencies(async ({ binPath, browserCachePath }) => {
    try {
      const selection = slowTestArgSelection(args);
      if (selection.kind === 'skip') {
        console.log(selection.message);
        exitCode = 0;
        return;
      }

      exitCode = await runDevCommand('bun', selection.args, pathEnv(binPath, browserCachePath));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      exitCode = 1;
    }
  });
  return exitCode;
}

export async function runContractFreeze(targets?: ContractFreezeTarget[]): Promise<number> {
  let exitCode = 0;
  await withTestDependencies(async ({ binPath, browserCachePath }) => {
    for (const invocation of buildContractFreezeRunnerInvocations(targets)) {
      exitCode = await runDevCommand('bun', invocation.args, pathEnv(binPath, browserCachePath));
      if (exitCode !== 0) {
        return;
      }
    }
  });
  return exitCode;
}
