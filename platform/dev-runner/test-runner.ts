import { randomUUID } from 'node:crypto';
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
import { rawSha256 } from '../shared/canonical-primitives.ts';
import {
  CodexDevelopmentCreateTestImpactTransitionObservationV1,
  gitChangedFileDiffArgs,
  gitPathBlobArgs,
  gitUntrackedFileArgs,
  gitWorkingTreeStatusArgs,
  parseGitChangedRecordsOutput,
  parseGitPathBlobOutput,
  parseGitUntrackedFileOutput,
  type CodexDevelopmentTestImpactTransitionObservationV1
} from '../shared/ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from '../shared/ci-pr-risk-selection.ts';
import { uniqueSorted, uniqueSortedLines } from '../shared/collections.ts';
import { buildContractFreezeRunnerInvocations, type ContractFreezeTarget } from '../shared/contract-freeze-contract.ts';
import { compilerRoot, posixPath } from '../shared/paths.ts';
import { runCommandBytes } from '../shared/process.ts';
import {
  FAST_TEST_PROCESS_POLICY_TEST_FILE,
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
import {
  boundedUtf8TextTail,
  devCommandObservationExitCode,
  runDevCommand,
  type DevCommandObservation
} from './command-runner.ts';
import {
  ensureFastTestDependencies,
  ensureTestDependencies
} from './dependency-bootstrap.ts';
import {
  consumeTestWorkspaceSupervisorChallengeV1,
  deriveTestWorkspaceRunNamespaceV1,
  parseTestWorkspaceRunChildAssignmentV1,
  pathEnvKey,
  prepareTestWorkspaceRunV1,
  resolveTestWorkspaceNamespace,
  resolveTestWorkspaceRunChild,
  settlePreparedTestWorkspaceRunV1,
  TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV,
  TEST_WORKSPACE_NAMESPACE_ENV,
  TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV,
  TEST_WORKSPACE_RUN_CHILD_ENV
} from './env-manager.ts';
import {
  assertFastTestProcessPolicyInventoryV1,
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
  FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
  isDefaultFastTestFile,
  planFastTestProcesses,
  resolveManagedFastTestConcurrency,
  type FastTestProcessResourceClass,
  type FastTestResourceClassLimits
} from './fast-test-policy.ts';
import { explicitFastTestMaxConcurrency } from './test-concurrency-policy.ts';
import { withDefaultTestTimeout } from './test-execution-policy.ts';

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
  return ['test', ...(concurrent ? ['--concurrent'] : []), ...files, ...withDefaultTestTimeout(options)];
}

export type FastTestInvocationQueue = 'concurrent-shard' | FastTestProcessResourceClass;

export type FastTestInvocation = {
  readonly id: string;
  readonly queue: FastTestInvocationQueue;
  readonly args: string[];
};

type FastTestInvocationPlan = {
  readonly concurrentShards: FastTestInvocation[];
  readonly concurrentProcessLimit: number;
  readonly resourceClassOrder: typeof FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER;
  readonly resourceQueues: Record<FastTestProcessResourceClass, FastTestInvocation[]>;
  readonly resourceLimits: FastTestResourceClassLimits;
};

function fastTestInvocationId(queue: FastTestInvocationQueue, index: number): string {
  return `${queue}:${String(index + 1).padStart(3, '0')}`;
}

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
  assertFastTestProcessPolicyInventoryV1(completeFastFiles);
  const availableFiles = selectors.length === 0 && inventory === 'default'
    ? completeFastFiles.filter(isDefaultFastTestFile)
    : completeFastFiles;
  const selectedFiles = selectMatchingTestFiles(availableFiles, selectors, 'fast');
  const plan = planFastTestProcesses(selectedFiles);
  const managedConcurrency = resolveManagedFastTestConcurrency(
    DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
    explicitFastTestMaxConcurrency(options)
  );
  const resourceQueues = Object.fromEntries(
    plan.resourceClassOrder.map((resourceClass) => [
      resourceClass,
      plan.resourceQueues[resourceClass].map((file, index) => ({
        id: fastTestInvocationId(resourceClass, index),
        queue: resourceClass,
        args: fastTestArgs([file], options, false)
      }))
    ])
  ) as Record<FastTestProcessResourceClass, FastTestInvocation[]>;

  return {
    concurrentShards: plan.concurrentShards.map((shard, index) => ({
      id: fastTestInvocationId('concurrent-shard', index),
      queue: 'concurrent-shard',
      args: fastTestArgs(shard, options, true)
    })),
    concurrentProcessLimit: managedConcurrency.outerProcessConcurrency,
    resourceClassOrder: plan.resourceClassOrder,
    resourceQueues,
    resourceLimits: managedConcurrency.resourceClassLimits
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
  return {
    kind: 'run',
    args: [
      'test',
      ...selectMatchingTestFiles(availableFiles, selectors, label),
      ...withDefaultTestTimeout(options)
    ]
  };
}

function fullTestInvocations(): string[][] {
  const slowSelection = slowTestArgSelection([]);
  const fast = fastTestInvocations([], 'complete');
  return [
    ...fast.concurrentShards.map(({ args }) => args),
    ...fast.resourceClassOrder.flatMap((resourceClass) => (
      fast.resourceQueues[resourceClass].map(({ args }) => args)
    )),
    slowSelection.kind === 'run' ? slowSelection.args : []
  ].filter((invocation) => invocation.length > 0);
}

function affectedTestsBaseRef(): string | undefined {
  return process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
}

type GitChangedFilesResult = Readonly<{
  files: string[];
  transitionObservation?: CodexDevelopmentTestImpactTransitionObservationV1;
}>;

function exactRevision(stdout: Uint8Array): string | null {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(stdout).trim();
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function gitChangedFiles(): Promise<GitChangedFilesResult | null> {
  const baseRef = affectedTestsBaseRef();
  const [baseRevision, headRevision] = baseRef === undefined
    ? [null, null]
    : await Promise.all([
        runCommandBytes('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: compilerRoot }),
        runCommandBytes('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: compilerRoot })
      ]);
  const baseSha = baseRevision?.code === 0 ? exactRevision(baseRevision.stdout) : null;
  const headSha = headRevision?.code === 0 ? exactRevision(headRevision.stdout) : null;
  if (baseRef !== undefined && (baseSha === null || headSha === null)) return null;
  const [tracked, untracked, worktreeStatus] = await Promise.all([
    runCommandBytes('git', gitChangedFileDiffArgs(baseSha ?? 'HEAD', null), { cwd: compilerRoot }),
    runCommandBytes('git', gitUntrackedFileArgs(), { cwd: compilerRoot }),
    runCommandBytes('git', gitWorkingTreeStatusArgs(), { cwd: compilerRoot })
  ]);
  if (tracked.code !== 0 || untracked.code !== 0 || worktreeStatus.code !== 0) {
    return null;
  }
  try {
    const records = parseGitChangedRecordsOutput(tracked.stdout);
    const files = uniqueSorted([
      ...records.flatMap((record) => (
        record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
      )),
      ...parseGitUntrackedFileOutput(untracked.stdout)
    ]);
    if (baseSha === null || headSha === null || worktreeStatus.stdout.byteLength > 0) {
      return { files };
    }
    const removedPaths = uniqueSorted(records
      .filter((record) => record.status === 'removed')
      .map((record) => record.path));
    const blobEntryPromises: Array<Promise<readonly [
      string,
      ReturnType<typeof parseGitPathBlobOutput>
    ]>> = [];
    for (const repositoryPath of removedPaths) {
      for (const revision of [baseSha, headSha]) {
        const observation = runCommandBytes(
          'git',
          gitPathBlobArgs(revision, repositoryPath),
          { cwd: compilerRoot }
        ).then((result) => {
          if (result.code !== 0) throw new Error('Git path blob observation failed.');
          return [
            `${revision}\0${repositoryPath}`,
            parseGitPathBlobOutput(result.stdout, repositoryPath)
          ] as const;
        });
        blobEntryPromises.push(observation);
      }
    }
    const blobEntries = await Promise.all(blobEntryPromises);
    const blobs = new Map(blobEntries);
    return {
      files,
      transitionObservation: CodexDevelopmentCreateTestImpactTransitionObservationV1({
        baseSha,
        headSha,
        records,
        readPathBlob: (revision, repositoryPath) => blobs.get(`${revision}\0${repositoryPath}`) ?? null
      })
    };
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

type FastDependencyContext = {
  binPath: string;
};

async function withFastTestDependencies<T>(
  callback: (context: FastDependencyContext) => Promise<T>
): Promise<T> {
  const dependencies = await ensureFastTestDependencies();
  return callback({ binPath: path.join(dependencies.nodeModulesPath, '.bin') });
}

async function withTestDependencies<T>(callback: (context: DependencyContext) => Promise<T>): Promise<T> {
  const dependencies = await ensureTestDependencies();
  return callback({
    binPath: path.join(dependencies.nodeModulesPath, '.bin'),
    browserCachePath: dependencies.browserCachePath
  });
}

function pathEnv(
  binPath: string,
  browserCachePath: string | null,
  additionalEnv: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env.PATH ?? ''}`,
    // Explicit undefined values scrub inherited browser state in runDevCommand.
    PLAYWRIGHT_BROWSERS_PATH: browserCachePath ?? undefined,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: browserCachePath === null ? '1' : undefined,
    SEC_SKIP_RUNTIME_DEPS_SETUP: '1',
    ...additionalEnv
  };
}

let fastTestRunSequence = 0;
const fastTestProcessNonce = randomUUID();
let callerAssignmentClaimed = false;

async function prepareFastTestWorkspaceRun(): Promise<Readonly<{
  env: NodeJS.ProcessEnv;
  cleanup: ReturnType<typeof prepareTestWorkspaceRunV1>;
}>> {
  const parentNamespace = resolveTestWorkspaceNamespace();
  const inheritedRunChild = resolveTestWorkspaceRunChild();
  const serializedAssignment = process.env[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV];
  const inheritedBoundChildLocator = process.env[TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV];
  if ((inheritedRunChild === undefined) !== (serializedAssignment === undefined) ||
    (inheritedRunChild !== undefined && parentNamespace === undefined) ||
    inheritedBoundChildLocator !== undefined) {
    throw new Error('runFastTests cannot start beneath an existing run-owned workspace child');
  }
  fastTestRunSequence += 1;
  const callerAssignment = inheritedRunChild === undefined ? null :
    parseTestWorkspaceRunChildAssignmentV1(serializedAssignment, parentNamespace!, inheritedRunChild);
  const runChild = callerAssignment?.name ?? deriveTestWorkspaceRunNamespaceV1({
      parentNamespace,
      processId: process.pid,
      processNonce: fastTestProcessNonce,
      runSequence: fastTestRunSequence
    });
  let callerAuthority = null;
  if (callerAssignment !== null) {
    if (callerAssignmentClaimed) throw new Error('runFastTests caller assignment authority was already consumed');
    callerAuthority = await consumeTestWorkspaceSupervisorChallengeV1(callerAssignment);
    callerAssignmentClaimed = true;
  }
  const env = {
    [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace ?? runChild,
    // Explicit undefined scrubs a poisoned inherited child for ordinary runs.
    [TEST_WORKSPACE_RUN_CHILD_ENV]: parentNamespace === undefined ? undefined : runChild,
    [TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV]: undefined,
    // This projection is a read-only locator. Cleanup requires the opaque,
    // process-local authority returned only after the live challenge succeeds.
    [TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV]: callerAssignment === null
      ? undefined
      : JSON.stringify(callerAssignment)
  };
  return Object.freeze({
    env,
    cleanup: prepareTestWorkspaceRunV1(env, callerAuthority)
  });
}

export const FAST_TEST_FAILURE_RECEIPT_PREFIX = 'SEC_FAST_TEST_FAILURE_RECEIPT ';
const FAST_TEST_FAILURE_RECEIPT_TAIL_MAX_BYTES = 2 * 1024;
const FAST_TEST_FAILURE_RECEIPT_TEXT_MAX_BYTES = 1024;
const FAST_TEST_FAILURE_RECEIPT_ARG_MAX_BYTES = 512;
const FAST_TEST_FAILURE_RECEIPT_MAX_ARGS = 64;

function boundedReceiptText(value: string, maximumBytes: number): string {
  return boundedUtf8TextTail(value, maximumBytes);
}

type FastTestInvocationFailure =
  | {
      readonly kind: 'observed-command-failure';
      readonly invocation: FastTestInvocation;
      readonly observation: DevCommandObservation;
    }
  | {
      readonly kind: 'observer-rejected';
      readonly invocation: FastTestInvocation;
      readonly error: string;
    };

function receiptArgv(argv: readonly string[]): { argv: string[]; truncated: boolean } {
  return {
    argv: argv
      .slice(0, FAST_TEST_FAILURE_RECEIPT_MAX_ARGS)
      .map((arg) => boundedReceiptText(arg, FAST_TEST_FAILURE_RECEIPT_ARG_MAX_BYTES)),
    truncated: argv.length > FAST_TEST_FAILURE_RECEIPT_MAX_ARGS || argv.some(
      (arg) => Buffer.byteLength(arg) > FAST_TEST_FAILURE_RECEIPT_ARG_MAX_BYTES
    )
  };
}

function invocationTestFiles(invocation: FastTestInvocation): string[] {
  return invocation.args.filter(isTestFileSelector);
}

function emitFastTestFailureReceipt(
  queue: FastTestInvocationQueue,
  batchIndex: number,
  failures: readonly FastTestInvocationFailure[]
): void {
  const receipt = {
    schema: 'sec-fast-test-failure-receipt-v2',
    replayAuthority: 'none-diagnostic-only',
    queue,
    batchIndex,
    failures: failures.map((failure) => {
      if (failure.kind === 'observer-rejected') {
        const plannedArgv = receiptArgv(['bun', ...failure.invocation.args]);
        return {
          kind: failure.kind,
          invocationId: failure.invocation.id,
          selectedTestFiles: invocationTestFiles(failure.invocation),
          plannedArgv: plannedArgv.argv,
          plannedArgvTruncated: plannedArgv.truncated,
          error: boundedReceiptText(failure.error, FAST_TEST_FAILURE_RECEIPT_TEXT_MAX_BYTES)
        };
      }

      const { invocation, observation } = failure;
      const effectiveArgv = receiptArgv(observation.effectiveArgv);
      const terminal = observation.terminal.kind === 'spawn-failed'
        ? {
            ...observation.terminal,
            error: boundedReceiptText(
              observation.terminal.error,
              FAST_TEST_FAILURE_RECEIPT_TEXT_MAX_BYTES
            )
          }
        : observation.terminal;
      const observationIntegrity = observation.observationIntegrity.kind === 'failed'
        ? {
            ...observation.observationIntegrity,
            error: boundedReceiptText(
              observation.observationIntegrity.error,
              FAST_TEST_FAILURE_RECEIPT_TEXT_MAX_BYTES
            )
          }
        : observation.observationIntegrity;
      return {
        kind: failure.kind,
        invocationId: invocation.id,
        selectedTestFiles: invocationTestFiles(invocation),
        effectiveArgv: effectiveArgv.argv,
        effectiveArgvTruncated: effectiveArgv.truncated,
        terminal,
        observationIntegrity,
        durationMs: observation.durationMs,
        stdoutTail: boundedReceiptText(
          observation.stdoutTail,
          FAST_TEST_FAILURE_RECEIPT_TAIL_MAX_BYTES
        ),
        stderrTail: boundedReceiptText(
          observation.stderrTail,
          FAST_TEST_FAILURE_RECEIPT_TAIL_MAX_BYTES
        )
      };
    })
  };
  console.error(`${FAST_TEST_FAILURE_RECEIPT_PREFIX}${JSON.stringify(receipt)}`);
}

export type FastTestInvocationBatchResult<TResult> = {
  readonly batchIndex: number;
  readonly invocations: readonly FastTestInvocation[];
  readonly outcomes: readonly PromiseSettledResult<TResult>[];
};

export async function scheduleBoundedFastTestInvocations<TResult>(
  invocations: readonly FastTestInvocation[],
  concurrency: number,
  dispatch: (invocation: FastTestInvocation) => Promise<TResult>,
  isFailure: (result: TResult, invocation: FastTestInvocation) => boolean
): Promise<FastTestInvocationBatchResult<TResult> | null> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('Fast-test invocation concurrency must be a positive safe integer.');
  }
  for (let index = 0; index < invocations.length; index += concurrency) {
    const batch = invocations.slice(index, index + concurrency);
    const pending: Promise<TResult>[] = [];
    for (const invocation of batch) {
      try {
        pending.push(dispatch(invocation));
      } catch (error) {
        pending.push(Promise.reject(error));
      }
    }
    const outcomes = await Promise.allSettled(pending);
    if (outcomes.some((outcome, outcomeIndex) => (
      outcome.status === 'rejected' || isFailure(outcome.value, batch[outcomeIndex]!)
    ))) {
      return {
        batchIndex: Math.floor(index / concurrency),
        invocations: batch,
        outcomes
      };
    }
  }
  return null;
}

async function runBoundedFastTestInvocations(
  invocations: readonly FastTestInvocation[],
  env: NodeJS.ProcessEnv,
  concurrency: number
): Promise<number> {
  const failedBatch = await scheduleBoundedFastTestInvocations(
    invocations,
    concurrency,
    (invocation) => runDevCommand('bun', invocation.args, env, { observe: true }),
    (observation) => devCommandObservationExitCode(observation) !== 0
  );
  if (!failedBatch) return 0;

  const failures = failedBatch.outcomes.flatMap(
    (outcome, outcomeIndex): FastTestInvocationFailure[] => {
      const invocation = failedBatch.invocations[outcomeIndex]!;
      if (outcome.status === 'rejected') {
        return [{
          kind: 'observer-rejected',
          invocation,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
        }];
      }
      return devCommandObservationExitCode(outcome.value) === 0
        ? []
        : [{ kind: 'observed-command-failure', invocation, observation: outcome.value }];
    }
  );
  emitFastTestFailureReceipt(
    failedBatch.invocations[0]!.queue,
    failedBatch.batchIndex,
    failures
  );
  const firstFailure = failures[0]!;
  return firstFailure.kind === 'observer-rejected'
    ? 1
    : devCommandObservationExitCode(firstFailure.observation);
}

interface AffectedTestSelection {
  readonly tests: readonly string[];
  readonly slowTests: readonly string[];
  readonly affectedTests: readonly string[];
  readonly affectedSlowTests: readonly string[];
  readonly affectedOwners: readonly string[];
  readonly sourceChanged: boolean;
  readonly selectionResolved: boolean;
  readonly unresolvedModuleFiles: readonly string[];
}

function affectedTestSelection(
  files: string[],
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): AffectedTestSelection {
  const currentFastFiles = getFastTestFilesSync();
  assertFastTestProcessPolicyInventoryV1(currentFastFiles);
  const currentTestFiles = new Set([
    ...currentFastFiles,
    ...getSlowTestFilesSync()
  ]);
  const inventory = CodexDevelopmentBuildAffectedTestInventoryV1(
    CodexDevelopmentAffectedInventoryInputsV1(files, (file) => currentTestFiles.has(file)),
    undefined,
    transition
  );
  // A changed fast-test source can introduce or remove a process-global
  // hazard without changing the scheduler itself. Always select the one
  // executable policy census from the raw Git delta (including a deleted test
  // that is no longer runnable), while still invoking only current test files.
  const processPolicySentinels = files.some(isFastTestFile)
    ? [FAST_TEST_PROCESS_POLICY_TEST_FILE]
    : [];
  return {
    tests: inventory.changedFastTests,
    slowTests: inventory.changedSlowTests,
    affectedTests: unionTestFiles(inventory.affectedFastTests, processPolicySentinels),
    affectedSlowTests: inventory.affectedSlowTests,
    affectedOwners: processPolicySentinels.length === 0
      ? inventory.affectedOwners
      : uniqueSorted([...inventory.affectedOwners, 'dev-runner']),
    sourceChanged: inventory.sourceChanged,
    selectionResolved: inventory.selectionResolved,
    unresolvedModuleFiles: inventory.unresolvedModuleFiles
  };
}

function unionTestFiles(...groups: string[][]): string[] {
  return uniqueSortedLines(groups.flat().join('\n'));
}

function unresolvedRiskPaths(
  files: string[],
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): string[] {
  return files.filter((file) => !selectCiPrRiskSlowSuites([file], undefined, transition).resolved);
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
  return rawSha256(`${sorted.join('')}\0`);
}

function affectedTestPlan(
  files: string[],
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): AffectedTestPlanV1 {
  const risk = selectCiPrRiskSlowSuites(files, undefined, transition);
  const selection = affectedTestSelection(files, transition);
  const unresolvedPaths = unresolvedRiskPaths(files, transition);
  const selectedFastTests = unionTestFiles([...selection.tests], [...selection.affectedTests]);
  const ownershipResolved = risk.resolved && unresolvedPaths.length === 0;
  const trustBoundary = classifyAffectedSelectionTrustBoundary({
    gitDiscoveryFailed: false,
    ownershipResolved,
    sourceChanged: selection.sourceChanged,
    selectionResolved: selection.selectionResolved,
    unresolvedModuleFiles: selection.unresolvedModuleFiles,
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
      unresolvedModuleFiles: Object.freeze([...plan.selectionResolved.unresolvedModuleFiles])
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
  const changed = await gitChangedFiles();
  if (!changed) return null;
  const plan = freezeAffectedTestPlan(affectedTestPlan(changed.files, changed.transitionObservation));
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
  if (args.length > 0) {
    const { selectors } = partitionBunTestArgs(args);
    if (selectors.length > 0 && selectors.every(isFastTestFile)) {
      await withFastTestDependencies(async ({ binPath }) => {
        exitCode = await runDevCommand('bun', ['test', ...args], pathEnv(binPath, null));
      });
      return exitCode;
    }
  }
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
  const workspace = await prepareFastTestWorkspaceRun();
  const workspaceEnv = workspace.env;
  let hasPrimaryFailure = false;
  let primaryFailure: unknown;
  try {
    await withFastTestDependencies(async ({ binPath }) => {
      try {
        const plan = fastTestInvocations(args);
        const env = pathEnv(binPath, null, workspaceEnv);
        exitCode = await runBoundedFastTestInvocations(
          plan.concurrentShards,
          env,
          plan.concurrentProcessLimit
        );
        if (exitCode !== 0) return;
        for (const resourceClass of plan.resourceClassOrder) {
          exitCode = await runBoundedFastTestInvocations(
            plan.resourceQueues[resourceClass],
            env,
            plan.resourceLimits[resourceClass]
          );
          if (exitCode !== 0) return;
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        exitCode = 1;
      }
    });
  } catch (error) {
    hasPrimaryFailure = true;
    primaryFailure = error;
  }
  try {
    settlePreparedTestWorkspaceRunV1(workspace.cleanup);
  } catch (error) {
    console.error(`Fast test workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!hasPrimaryFailure && exitCode === 0) exitCode = 1;
  }
  if (hasPrimaryFailure) throw primaryFailure;
  return exitCode;
}

export async function runSlowTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  let selection: SlowTestArgSelection;
  try {
    selection = slowTestArgSelection(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (selection.kind === 'skip') {
    console.log(selection.message);
    return 0;
  }
  await withTestDependencies(async ({ binPath, browserCachePath }) => {
    try {
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
