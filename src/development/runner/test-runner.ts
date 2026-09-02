import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createSourceProgramCompilationOperation,
  type SourceProgramCompilationOperation
} from '../../brownfield/source-program-model/compilation-operation.ts';
import type { IssuedTestImpactProjection } from '../../brownfield/source-program-model/test-impact-projection.ts';
import {
  assertWorkspaceTypeScriptProjectGenerationEvidence,
  type WorkspaceTypeScriptProjectGenerationEvidence
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { currentActiveDocumentationPaths } from '../../control/documentation/active.ts';
import {
  compileSecOperationDemandGraph,
  type SecOperationKind
} from '../../control/operation/demand.ts';
import { createAuthorityGitReadSession, type GitExecutableIdentity, type GitReadProviderIdentity, type GitReadProviderRoute, type GitReadSession, type GitReadSessionCommand } from '../../external-capabilities/git-read/runtime/session.ts';
import { secRuntimeStateEnvironment } from '../../runtime-state/workspace-state/layout.ts';
import { deepFreeze, rawSha256, sha256, uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { uniqueSortedLines } from '../../system-architecture/foundation/runtime/collections.ts';
import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';
import { isSecRepositoryTestModulePath } from '../../system-architecture/repository-modules/test-module-path.ts';
import type { RetainedCompilerDependencyReadGeneration } from '../../toolchain/dependencies/runtime.ts';
import { buildContractFreezeRunnerInvocations, type ContractFreezeTarget } from '../../verification/freeze.ts';
import {
  classifyAffectedSelectionTrustBoundary,
  CodexDevelopmentAffectedInventoryInputs,
  CodexDevelopmentBuildAffectedTestInventory,
  defaultAffectedSelectionProjectionContext,
  isAffectedSelectionFailClosed,
  projectAffectedSelectionToVerificationGateResult
} from '../../verification/test-impact/affected.ts';
import { compileTestBudgetProjection, FAST_TEST_PROCESS_POLICY_TEST_FILE, getFastTestFilesSync, getSlowTestFilesSync, isFastTestFile, isKnownSlowTestSuiteId, isSlowTestFile, slowTestSuiteFiles, slowTestSuiteIds, TEST_ARCHITECTURE_POLICY_TEST_FILE, type TestBudgetProjection } from '../../verification/test-impact/contract/budget.ts';
import { createRepositoryTestImpactSourceProvider, formatSlowImpactNotice, type CodexDevelopmentTestImpactSourceProvider } from '../../verification/test-impact/runtime/impact.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation, gitChangedFileDiffArgs, gitIndexChangedFileDiffArgs, gitPathBlobBatchArgs, gitUntrackedFileArgs, gitWorkingTreeStatusArgs, gitWorktreeChangedFileDiffArgs, parseGitChangedRecordsOutput, parseGitPathBlobBatchOutput, parseGitUntrackedFileOutput, type CodexDevelopmentTestImpactTransitionObservation } from '../../verification/test-impact/runtime/transition.ts';
import { selectSlowTestRiskClosure } from '../../verification/test-impact/slow-risk-selection.ts';
import { compilerRoot, posixPath } from '../../workspace/runtime/paths.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import {
  AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING,
  affectedSelectionSourceCompilationDeadlineAtUnixMs,
  affectedTestPlanExitCode,
  compileAffectedTestSelectionSemanticOperation,
  type AffectedPlanIdentity,
  type AffectedTestPlan,
  type AffectedTestSelection
} from './affected-plan-contract.ts';
import {
  issueCheckAffectedTestImpactProjection,
  type AffectedTestImpactProjectionIssuer
} from './check-affected-source.ts';
import {
  boundedUtf8TextTail,
  DEV_COMMAND_MAX_DURATION_MS,
  devCommandObservationExitCode,
  runDevCommand,
  type DevCommandObservation
} from './command-runner.ts';
import {
  ensureOperationDependencies,
  reuseOperationDependencies,
  type OperationDependencyBootstrapResult
} from './dependency-bootstrap.ts';
import {
  observeOperationDependencyReadGeneration,
  retainOperationDependencyReadGeneration
} from './dependency-read-generation.ts';
import {
  consumeTestWorkspaceSupervisorChallenge,
  deriveTestWorkspaceRunNamespace,
  parseTestWorkspaceRunChildAssignment,
  pathEnvKey,
  prepareTestWorkspaceRun,
  resolveTestWorkspaceNamespace,
  resolveTestWorkspaceRunChild,
  settlePreparedTestWorkspaceRun,
  TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV,
  TEST_WORKSPACE_NAMESPACE_ENV,
  TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV,
  TEST_WORKSPACE_RUN_CHILD_ENV
} from './env-manager.ts';
import {
  assertFastTestProcessPolicyInventory,
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
  FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
  isDefaultFastTestFile,
  planFastTestProcesses,
  resolveManagedFastTestConcurrency,
  type FastTestProcessResourceClass,
  type FastTestResourceClassLimits
} from './fast-test-policy.ts';
import { explicitFastTestMaxConcurrency } from './test-concurrency-policy.ts';
import {
  compileTestInvocationExecutionPolicy,
  withDefaultTestTimeout
} from './test-execution-policy.ts';
import {
  createTestInvocationRuntimeRoots,
  testInvocationRuntimeIsolationModeForPlatform,
  type TestInvocationRuntimeRoots
} from './test-process-temp.ts';

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
  return isSecRepositoryTestModulePath(selector);
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

function fastTestArgs(files: string[], options: string[], innerConcurrency: number): string[] {
  // Process shards are the concurrency boundary. Ordinary Bun tests keep their
  // declared sequential semantics; only explicit test.concurrent cases consume
  // the bounded inner concurrency budget.
  const boundedOptions = explicitFastTestMaxConcurrency(options) === null
    ? ['--max-concurrency', String(innerConcurrency), ...options]
    : options;
  return ['test', ...files, ...withDefaultTestTimeout(boundedOptions)];
}

function managedBunTestArgs(args: readonly string[]): string[] {
  if (args[0] !== 'test') throw new Error('Managed Bun test invocation must begin with "test".');
  return ['test', ...withDefaultTestTimeout(args.slice(1))];
}

function testSupervisorTimeoutMs(args: readonly string[]): number {
  return compileTestInvocationExecutionPolicy(args, DEV_COMMAND_MAX_DURATION_MS).supervisorTimeoutMs;
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
  budgetProjection: TestBudgetProjection,
  inventory: 'default' | 'complete' = 'default'
): FastTestInvocationPlan {
  const { options, selectors } = partitionBunTestArgs(args);
  const slowSelectors = selectors.filter(isSlowTestFile);
  if (slowSelectors.length > 0) {
    throw new Error(`Fast test runner cannot run slow test files: ${slowSelectors.join(', ')}`);
  }

  const completeFastFiles = [...getFastTestFilesSync(budgetProjection)];
  assertFastTestProcessPolicyInventory(completeFastFiles);
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
        args: fastTestArgs([file], options, managedConcurrency.innerConcurrency)
      }))
    ])
  ) as Record<FastTestProcessResourceClass, FastTestInvocation[]>;

  return {
    concurrentShards: plan.concurrentShards.map((shard, index) => ({
      id: fastTestInvocationId('concurrent-shard', index),
      queue: 'concurrent-shard',
      args: fastTestArgs(shard, options, managedConcurrency.innerConcurrency)
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

function slowTestArgSelection(
  args: string[],
  budgetProjection: TestBudgetProjection
): SlowTestArgSelection {
  const { suiteId, bunArgs } = extractSlowTestRunnerArgs(args);
  if (suiteId && !isKnownSlowTestSuiteId(suiteId)) {
    throw new Error(`Unknown slow test suite "${suiteId}". Available suites: ${slowTestSuiteIds().join(', ') || 'none'}`);
  }

  const availableFiles = suiteId
    ? slowTestSuiteFiles(budgetProjection, suiteId)
    : getSlowTestFilesSync(budgetProjection);
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
      ...selectMatchingTestFiles([...availableFiles], selectors, label),
      ...withDefaultTestTimeout(options)
    ]
  };
}

type FullTestInvocation = Readonly<{
  kind: 'fast' | 'slow';
  id: string;
  args: string[];
}>;

function fullTestInvocations(budgetProjection: TestBudgetProjection): FullTestInvocation[] {
  const slowSelection = slowTestArgSelection([], budgetProjection);
  const fast = fastTestInvocations([], budgetProjection, 'complete');
  return [
    ...fast.concurrentShards.map(({ id, args }) => ({ kind: 'fast' as const, id, args })),
    ...fast.resourceClassOrder.flatMap((resourceClass) => (
      fast.resourceQueues[resourceClass].map(({ id, args }) => ({ kind: 'fast' as const, id, args }))
    )),
    ...(slowSelection.kind === 'run'
      ? [{ kind: 'slow' as const, id: 'slow:001', args: slowSelection.args }]
      : [])
  ];
}

function affectedTestsBaseRef(): string | undefined {
  return process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
}

type GitChangedFilesResult = Readonly<{
  files: string[];
  transitionObservation?: CodexDevelopmentTestImpactTransitionObservation;
  gitObservation: GitSelectionGitObservation;
}>;

function exactRevision(stdout: Uint8Array): string | null {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(stdout).trim();
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function boundedAffectedBaseRef(value: string | undefined): string | null {
  if (value === undefined) return null;
  // This surface accepts a ref spelling, not arbitrary rev-parse language.
  // `--end-of-options` is still supplied below as a second parser boundary.
  if (value.length < 1 || value.length > 256 || value.includes('\0')
      || !/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/u.test(value)
      || value.includes('..') || value.includes('@{') || value.includes('//')
      || value.endsWith('.') || value.endsWith('.lock')) {
    return null;
  }
  return value;
}

type GitSelectionGitObservation = Readonly<{
  baseSha: string | null;
  headSha: string;
  indexDigest: `sha256:${string}`;
  worktreeDigest: `sha256:${string}`;
  gitExecutable: string;
  gitExecutableIdentity: GitExecutableIdentity | null;
  gitProviderRoute: GitReadProviderRoute;
  gitProviderIdentity: GitReadProviderIdentity;
}>;

function completedGitCommand(
  command: GitReadSessionCommand
): Extract<GitReadSessionCommand, { kind: 'completed' }>['result'] | null {
  return command.kind === 'completed' ? command.result : null;
}

async function observeGitSelectionState(
  session: GitReadSession,
  baseSha: string | null,
  worktreeBytes?: Uint8Array,
  indexBytes?: Uint8Array,
  knownHeadSha?: string
): Promise<GitSelectionGitObservation | null> {
  if (session.providerIdentity === null) return null;
  let headSha = knownHeadSha;
  if (headSha === undefined) {
    const headResult = completedGitCommand(await session.run([
      '--no-pager',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false',
      'rev-parse', '--verify', 'HEAD^{commit}'
    ]));
    if (headResult === null || headResult.code !== 0) return null;
    headSha = exactRevision(headResult.stdout) ?? undefined;
    if (headSha === undefined) return null;
  }

  let observedWorktree = worktreeBytes;
  if (observedWorktree === undefined) {
    const status = completedGitCommand(await session.run(gitWorkingTreeStatusArgs()));
    if (status === null || status.code !== 0) return null;
    observedWorktree = status.stdout;
  }
  let observedIndex = indexBytes;
  if (observedIndex === undefined) {
    const index = completedGitCommand(await session.run([
      '--no-pager',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false',
      'ls-files', '--stage', '-z'
    ]));
    if (index === null || index.code !== 0) return null;
    observedIndex = index.stdout;
  }
  // The executable is part of the same read observation. Re-check it after
  // the Git children complete so a replacement during status/index reads can
  // never become the provider identity of this snapshot.
  if (!(session.verifyWorkingDirectory?.() ?? true)) return null;
  if (!session.verifyExecutable()) return null;
  return Object.freeze({
    baseSha,
    headSha,
    indexDigest: rawSha256(observedIndex),
    worktreeDigest: rawSha256(observedWorktree),
    gitExecutable: session.gitExecutable,
    gitExecutableIdentity: session.gitExecutableIdentity,
    gitProviderRoute: session.providerRoute,
    gitProviderIdentity: session.providerIdentity
  });
}

type AffectedGitRevalidationLedger = {
  readonly operation: SecBoundSemanticOperation;
  /** Absolute parent wall deadline shared by every revalidation session. */
  readonly deadlineAt: number;
  readonly maxProcesses: number;
  readonly maxTotalArgumentBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxRecords: number;
  readonly maxRootObservedBytes: number;
  readonly maxReopenRefreshes: number;
  readonly maxSettlementAttempts: number;
  readonly maxExecutableBytes: number;
  revalidationCount: number;
  processCount: number;
  argumentBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  recordCount: number;
  rootObservedBytes: number;
  reopenRefreshes: number;
  settlementAttempts: number;
  executableBytes: number;
};

function createAffectedGitRevalidationLedger(
  operation: SecBoundSemanticOperation,
  initialSession: GitReadSession,
  initialIdentity: GitExecutableIdentity | null
): AffectedGitRevalidationLedger {
  return {
    operation,
    deadlineAt: operation.plan.attempt.deadlineAtUnixMs,
    ...AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING,
    revalidationCount: 0,
    processCount: initialSession.processCount,
    argumentBytes: initialSession.argumentBytes ?? 0,
    stdoutBytes: initialSession.stdoutBytes,
    stderrBytes: initialSession.stderrBytes,
    recordCount: initialSession.recordCount,
    rootObservedBytes: initialSession.rootObservedBytes ?? 0,
    reopenRefreshes: initialSession.reopenRefreshes ?? 0,
    settlementAttempts: initialSession.settlementAttempts ?? 0,
    executableBytes: initialSession.executableBytes ?? initialIdentity?.size ?? 0
  };
}

function accountAffectedGitRevalidationSession(
  ledger: AffectedGitRevalidationLedger,
  session: GitReadSession
): boolean {
  ledger.processCount += session.processCount;
  ledger.argumentBytes += session.argumentBytes ?? 0;
  ledger.stdoutBytes += session.stdoutBytes;
  ledger.stderrBytes += session.stderrBytes;
  ledger.recordCount += session.recordCount;
  ledger.rootObservedBytes += session.rootObservedBytes ?? 0;
  ledger.reopenRefreshes += session.reopenRefreshes ?? 0;
  ledger.settlementAttempts += session.settlementAttempts ?? 0;
  ledger.executableBytes += session.executableBytes
    ?? (session.gitExecutableIdentity?.size ?? 0) * 2;
  return ledger.processCount <= ledger.maxProcesses
    && ledger.argumentBytes <= ledger.maxTotalArgumentBytes
    && ledger.stdoutBytes <= ledger.maxStdoutBytes
    && ledger.stderrBytes <= ledger.maxStderrBytes
    && ledger.recordCount <= ledger.maxRecords
    && ledger.rootObservedBytes <= ledger.maxRootObservedBytes
    && ledger.reopenRefreshes <= ledger.maxReopenRefreshes
    && ledger.settlementAttempts <= ledger.maxSettlementAttempts
    && ledger.executableBytes <= ledger.maxExecutableBytes;
}

async function reobserveAffectedGitSelectionState(
  expected: GitSelectionGitObservation,
  ledger: AffectedGitRevalidationLedger
): Promise<GitSelectionGitObservation | null> {
  if (ledger.revalidationCount >= 8) return null;
  const remainingDeadlineMs = ledger.deadlineAt - Date.now();
  if (remainingDeadlineMs < 1) return null;
  const processRemaining = ledger.maxProcesses - ledger.processCount;
  const argumentRemaining = ledger.maxTotalArgumentBytes - ledger.argumentBytes;
  const stdoutRemaining = ledger.maxStdoutBytes - ledger.stdoutBytes;
  const stderrRemaining = ledger.maxStderrBytes - ledger.stderrBytes;
  const recordRemaining = ledger.maxRecords - ledger.recordCount;
  const rootRemaining = ledger.maxRootObservedBytes - ledger.rootObservedBytes;
  const reopenRemaining = ledger.maxReopenRefreshes - ledger.reopenRefreshes;
  const settlementRemaining = ledger.maxSettlementAttempts - ledger.settlementAttempts;
  const executableRemaining = ledger.maxExecutableBytes - ledger.executableBytes;
  if (processRemaining < 1 || argumentRemaining < 1 || stdoutRemaining < 1
      || stderrRemaining < 1 || recordRemaining < 1 || rootRemaining < 1
      || reopenRemaining < 1 || settlementRemaining < 1 || executableRemaining < 1) return null;
  ledger.revalidationCount += 1;
  const resolution = createAuthorityGitReadSession({
    cwd: compilerRoot,
    operation: ledger.operation,
    budget: {
      // Each fresh provider session consumes the same parent absolute
      // deadline. The relative value only narrows the transport request; it
      // is never permission to reset the owner-issued operation window.
      deadlineMs: Math.min(5_000, remainingDeadlineMs),
      maxProcesses: Math.min(128, processRemaining),
      maxTotalArgumentBytes: Math.min(16 * 1024 * 1024, argumentRemaining),
      maxStdoutBytes: Math.min(64 * 1024 * 1024, stdoutRemaining),
      maxStderrBytes: Math.min(2 * 1024 * 1024, stderrRemaining),
      maxRecords: Math.min(250_000, recordRemaining),
      maxRootObservedBytes: Math.min(256 * 1024 * 1024, rootRemaining),
      maxReopenRefreshes: Math.min(10_000, reopenRemaining),
      maxSettlementAttempts: Math.min(10_000, settlementRemaining),
      maxCommandStdoutBytes: Math.min(32 * 1024 * 1024, stdoutRemaining),
      maxCommandStderrBytes: Math.min(512 * 1024, stderrRemaining),
      maxExecutableBytes: Math.min(64 * 1024 * 1024, executableRemaining)
    },
    deadlineAtUnixMs: ledger.deadlineAt
  });
  if (resolution.status !== 'ready') return null;
  const session = resolution.session;
  let observedResult: GitSelectionGitObservation | null = null;
  let closed = false;
  try {
    const observed = await observeGitSelectionState(session, expected.baseSha);
    if (observed !== null && session.failure === null
        && observed.gitExecutable === expected.gitExecutable
        && observed.gitProviderRoute === expected.gitProviderRoute
        && JSON.stringify(observed.gitProviderIdentity)
          === JSON.stringify(expected.gitProviderIdentity)
        && JSON.stringify(observed.gitExecutableIdentity)
          === JSON.stringify(expected.gitExecutableIdentity)) {
      observedResult = observed;
    }
  } finally {
    // A revalidation session is an invocation-local capability, not part of
    // the returned plan. Close it on success, typed failure, and exceptions so
    // retained provider resources cannot outlive this observation boundary.
    try {
      await session.close?.();
      closed = true;
    } catch {
      closed = false;
    }
  }
  if (!closed || session.failure !== null) return null;
  return accountAffectedGitRevalidationSession(ledger, session)
    ? observedResult
    : null;
}

async function gitChangedFiles(
  session: GitReadSession
): Promise<GitChangedFilesResult | null> {
  const rawBaseRef = affectedTestsBaseRef();
  const baseRef = boundedAffectedBaseRef(rawBaseRef);
  if (rawBaseRef !== undefined && baseRef === null) return null;
  let baseSha: string | null = null;
  let headSha: string | undefined;
  if (baseRef !== null) {
    const baseRevision = completedGitCommand(await session.run([
      '--no-pager',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false',
      'rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`
    ]));
    if (baseRevision === null || baseRevision.code !== 0) return null;
    baseSha = exactRevision(baseRevision.stdout);
    if (baseSha === null) return null;
  }

  const headRevision = completedGitCommand(await session.run([
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    'rev-parse', '--verify', 'HEAD^{commit}'
  ]));
  if (headRevision === null || headRevision.code !== 0) return null;
  headSha = exactRevision(headRevision.stdout) ?? undefined;
  if (headSha === undefined) return null;

  const staged = completedGitCommand(await session.run(
    gitIndexChangedFileDiffArgs(baseSha === null ? 'HEAD' : headSha)
  ));
  const unstaged = completedGitCommand(await session.run(
    gitWorktreeChangedFileDiffArgs()
  ));
  const committedTracked = baseSha === null
    ? null
    : completedGitCommand(await session.run(gitChangedFileDiffArgs(baseSha, headSha)));
  const untracked = completedGitCommand(await session.run(gitUntrackedFileArgs()));
  const worktreeStatus = completedGitCommand(await session.run(gitWorkingTreeStatusArgs()));
  const index = completedGitCommand(await session.run([
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    'ls-files', '--stage', '-z'
  ]));
  if (staged === null || unstaged === null || (baseSha !== null && committedTracked === null)
      || untracked === null || worktreeStatus === null || index === null
      || staged.code !== 0 || unstaged.code !== 0 || untracked.code !== 0
      || worktreeStatus.code !== 0 || index.code !== 0) {
    return null;
  }
  if (committedTracked !== null && committedTracked.code !== 0) return null;
  const initialObservation = await observeGitSelectionState(
    session,
    baseSha,
    worktreeStatus.stdout,
    index.stdout,
    headSha
  );
  if (initialObservation === null) return null;
  try {
    const stagedRecords = parseGitChangedRecordsOutput(staged.stdout);
    const unstagedRecords = parseGitChangedRecordsOutput(unstaged.stdout);
    const committedRecords = committedTracked === null
      ? []
      : parseGitChangedRecordsOutput(committedTracked.stdout);
    if (session.consumeRecords(
      stagedRecords.length + unstagedRecords.length + committedRecords.length
    ) !== null) return null;
    const untrackedPaths = parseGitUntrackedFileOutput(untracked.stdout);
    if (session.consumeRecords(untrackedPaths.length) !== null) return null;
    const files = uniqueSorted([
      ...stagedRecords.flatMap((record) => (
        record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
      )),
      ...unstagedRecords.flatMap((record) => (
        record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
      )),
      ...committedRecords.flatMap((record) => (
        record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
      )),
      ...untrackedPaths
    ]);
    // Transition/blob reads happen after the initial observation fence. Prove
    // the executable once more before publishing the changed-file snapshot so
    // a helper replacement during the final plumbing commands cannot be
    // mistaken for the already-bound Git provider.
    if (!session.verifyExecutable()) return null;
    if (baseSha === null) {
      return { files, gitObservation: initialObservation };
    }
    const removedPaths = uniqueSorted(committedRecords
      .filter((record) => record.status === 'removed')
      .map((record) => record.path));
    if (removedPaths.length > 0 && baseSha !== null) {
      const blobs = new Map<string, ReturnType<typeof parseGitPathBlobBatchOutput>>();
      for (const revision of [baseSha, initialObservation.headSha]) {
        const blobResult = completedGitCommand(await session.run(
          gitPathBlobBatchArgs(revision, removedPaths)
        ));
        if (blobResult === null || blobResult.code !== 0) return null;
        const parsed = parseGitPathBlobBatchOutput(blobResult.stdout, removedPaths);
        if (session.consumeRecords(parsed.size) !== null) return null;
        blobs.set(revision, parsed);
      }
      if (!session.verifyExecutable()) return null;
      return {
        files,
        gitObservation: initialObservation,
        transitionObservation: CodexDevelopmentCreateTestImpactTransitionObservation({
          baseSha,
          headSha: initialObservation.headSha,
          records: committedRecords,
          readPathBlob: (revision, repositoryPath) => blobs.get(revision)?.get(repositoryPath) ?? null
        })
      };
    }
    if (baseSha !== null) {
      if (!session.verifyExecutable()) return null;
      return {
        files,
        gitObservation: initialObservation,
        transitionObservation: CodexDevelopmentCreateTestImpactTransitionObservation({
          baseSha,
          headSha: initialObservation.headSha,
          records: committedRecords,
          readPathBlob: () => null
        })
      };
    }
    return {
      files,
      gitObservation: initialObservation
    };
  } catch {
    return null;
  }
}

export async function issueCurrentTestImpactSourceProvider(): Promise<CodexDevelopmentTestImpactSourceProvider> {
  const operation = compileAffectedTestSelectionSemanticOperation({
    purpose: 'budget-projection'
  });
  const deadlineAtUnixMs = operation.plan.attempt.deadlineAtUnixMs;
  const resolution = createAuthorityGitReadSession({
    cwd: compilerRoot,
    operation,
    budget: GIT_READ_OPERATION_BUDGET,
    deadlineAtUnixMs
  });
  if (resolution.status !== 'ready') {
    throw new Error(`Test budget source snapshot is unavailable: ${resolution.kind}`);
  }
  const session = resolution.session;
  const dependencyResolution = await observeOperationDependencyReadGeneration({
    deadlineAtUnixMs
  });
  if (dependencyResolution.status !== 'ready') {
    await session.close?.();
    throw new Error(`Test budget dependency generation is unavailable: ${dependencyResolution.reason}`);
  }
  try {
    const observation = await issueCheckAffectedTestImpactProjection({
      compilationOperation: createSourceProgramCompilationOperation({
        deadlineAtUnixMs: affectedSelectionSourceCompilationDeadlineAtUnixMs(operation)
      }),
      dependencyGeneration: dependencyResolution.generation,
      repositoryRoot: compilerRoot,
      session
    });
    return createRepositoryTestImpactSourceProvider({
      projection: observation.projection,
      activeDocumentationPaths: currentActiveDocumentationPaths()
    });
  } finally {
    await dependencyResolution.generation.retire();
    await session.close?.();
  }
}

export async function issueCurrentTestBudgetProjection(): Promise<TestBudgetProjection> {
  const provider = await issueCurrentTestImpactSourceProvider();
  return compileTestBudgetProjection(provider.projection);
}

function sameGitSelectionObservation(
  left: GitSelectionGitObservation,
  right: GitSelectionGitObservation
): boolean {
  return left.headSha === right.headSha
    && left.indexDigest === right.indexDigest
    && left.worktreeDigest === right.worktreeDigest
    && left.gitExecutable === right.gitExecutable
    && left.gitProviderRoute === right.gitProviderRoute
    && JSON.stringify(left.gitProviderIdentity) === JSON.stringify(right.gitProviderIdentity)
    && JSON.stringify(left.gitExecutableIdentity) === JSON.stringify(right.gitExecutableIdentity);
}

async function issueAffectedWorkingTreeTestImpactProjection(
  session: GitReadSession,
  issueProjection: AffectedTestImpactProjectionIssuer,
  dependencyGeneration: RetainedCompilerDependencyReadGeneration,
  compilationOperation: SourceProgramCompilationOperation
): Promise<Readonly<
  | {
      status: 'ready';
      projection: IssuedTestImpactProjection;
      projectGenerationEvidence: WorkspaceTypeScriptProjectGenerationEvidence;
    }
  | {
      status: 'unavailable';
      reason: 'project-generation-mismatch' | 'non-physical-snapshot';
    }
>> {
  const observation = await issueProjection({
    dependencyGeneration,
    compilationOperation,
    repositoryRoot: compilerRoot,
    session
  });
  const { projection, projectGenerationEvidence } = observation;
  assertWorkspaceTypeScriptProjectGenerationEvidence(projectGenerationEvidence);
  if (projectGenerationEvidence.projectInput.workspaceSnapshotIdentityDigest
      !== projection.workspaceSnapshotIdentityDigest
      || projectGenerationEvidence.projectInput.snapshotDigest !== projection.snapshotDigest
      || projectGenerationEvidence.projectInput.moduleMembershipDigest
        !== projection.moduleMembershipDigest
      || projectGenerationEvidence.projectInput.moduleGraphDigest !== projection.moduleGraphDigest) {
    return Object.freeze({ status: 'unavailable' as const, reason: 'project-generation-mismatch' as const });
  }
  if (projection.subject.kind !== 'physical-repository'
      || projection.subject.provenance.kind !== 'working-tree-observation') {
    return Object.freeze({ status: 'unavailable' as const, reason: 'non-physical-snapshot' as const });
  }
  return Object.freeze({ status: 'ready' as const, ...observation });
}

function allowFullFastFallback(): boolean {
  return process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK === '1';
}

type OperationDependencyContext = {
  binPath: string;
};

async function withOperationDependencies<T>(
  operation: Exclude<SecOperationKind, 'dependency-setup' | 'work-selection-observe'>,
  callback: (context: OperationDependencyContext) => Promise<T>,
  prepared?: OperationDependencyBootstrapResult
): Promise<T> {
  const demandGraph = compileSecOperationDemandGraph({
    operation,
    terminalWorkIds: []
  });
  const dependencies = prepared === undefined
    ? await ensureOperationDependencies(demandGraph)
    : reuseOperationDependencies(prepared, demandGraph);
  return callback({
    binPath: path.join(dependencies.nodeModulesPath, '.bin')
  });
}

function pathEnv(
  binPath: string,
  additionalEnv: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env.PATH ?? ''}`,
    SEC_SKIP_RUNTIME_DEPS_SETUP: '1',
    ...additionalEnv
  };
}

let fastTestRunSequence = 0;
const fastTestProcessNonce = randomUUID();
let callerAssignmentClaimed = false;

async function prepareFastTestWorkspaceRun(): Promise<Readonly<{
  env: NodeJS.ProcessEnv;
  cleanup: ReturnType<typeof prepareTestWorkspaceRun>;
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
    parseTestWorkspaceRunChildAssignment(serializedAssignment, parentNamespace!, inheritedRunChild);
  const runChild = callerAssignment?.name ?? deriveTestWorkspaceRunNamespace({
      parentNamespace,
      processId: process.pid,
      processNonce: fastTestProcessNonce,
      runSequence: fastTestRunSequence
    });
  let callerAuthority = null;
  if (callerAssignment !== null) {
    if (callerAssignmentClaimed) throw new Error('runFastTests caller assignment authority was already consumed');
    callerAuthority = await consumeTestWorkspaceSupervisorChallenge(callerAssignment);
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
    cleanup: prepareTestWorkspaceRun(env, callerAuthority)
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
  concurrency: number,
  invocationRuntime: TestInvocationRuntimeRoots | null
): Promise<number> {
  const failedBatch = await scheduleBoundedFastTestInvocations(
    invocations,
    concurrency,
    (invocation) => {
      const args = managedBunTestArgs(invocation.args);
      return runWithParentOwnedProcessTemp(invocationRuntime, env, invocation.id, (prepared) =>
        runDevCommand('bun', args, prepared, {
            observe: true,
            timeoutMs: testSupervisorTimeoutMs(args)
          })
      );
    },
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

function fastInvocationEnvironment(
  environment: NodeJS.ProcessEnv,
  invocationRuntime: TestInvocationRuntimeRoots | null,
  invocationId: string
): NodeJS.ProcessEnv {
  if (invocationRuntime === null) return environment;
  const invocationRuntimeRoot = path.join('invocation-runtime', invocationId.replace(':', '-'));
  return {
    ...environment,
    SEC_STATE_HOME: path.join(invocationRuntime.stateRoot, invocationRuntimeRoot),
    SEC_CACHE_HOME: path.join(invocationRuntime.cacheRoot, invocationRuntimeRoot)
  };
}

async function runWithParentOwnedProcessTemp<TResult>(
  runtime: TestInvocationRuntimeRoots | null,
  environment: NodeJS.ProcessEnv,
  invocationId: string,
  run: (environment: NodeJS.ProcessEnv) => Promise<TResult>
): Promise<TResult> {
  const childEnvironment = fastInvocationEnvironment(environment, runtime, invocationId);
  if (runtime === null) return run(childEnvironment);
  const generation = runtime.prepareProcessTemp(childEnvironment);
  let outcome: Readonly<{ value: TResult }> | null = null;
  let primary: unknown;
  try {
    outcome = { value: await run(childEnvironment) };
  } catch (error) {
    primary = error;
  }
  try {
    await generation.cleanup();
  } catch (cleanupError) {
    if (primary !== undefined) {
      throw new AggregateError([primary, cleanupError], 'Test command and process temp settlement failed.');
    }
    throw cleanupError;
  }
  if (primary !== undefined) throw primary;
  if (outcome === null) throw new Error('Test command settlement lost its primary outcome.');
  return outcome.value;
}

async function runWithTestInvocationRuntime(
  environment: NodeJS.ProcessEnv,
  run: (runtime: TestInvocationRuntimeRoots | null) => Promise<number>
): Promise<number> {
  let runtime: TestInvocationRuntimeRoots | null = null;
  let exitCode = 1;
  let hasPrimaryFailure = false;
  let primaryFailure: unknown;
  try {
    if (testInvocationRuntimeIsolationModeForPlatform(process.platform) === 'retained') {
      runtime = await createTestInvocationRuntimeRoots({
        repositoryRoot: compilerRoot,
        hostTempRoot: tmpdir(),
        environment: { ...secRuntimeStateEnvironment(), ...environment }
      });
    }
    exitCode = await run(runtime);
  } catch (error) {
    hasPrimaryFailure = true;
    primaryFailure = error;
  }
  try {
    await runtime?.cleanup();
  } catch (error) {
    console.error(`Test invocation runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!hasPrimaryFailure && exitCode === 0) exitCode = 1;
  }
  if (hasPrimaryFailure) throw primaryFailure;
  return exitCode;
}

function affectedTestSelection(
  files: string[],
  budgetProjection: TestBudgetProjection,
  provider: CodexDevelopmentTestImpactSourceProvider,
  transition?: CodexDevelopmentTestImpactTransitionObservation
): AffectedTestSelection {
  const currentFastFiles = [...getFastTestFilesSync(budgetProjection)];
  assertFastTestProcessPolicyInventory(currentFastFiles);
  const currentTestFiles = new Set([
    ...currentFastFiles,
    ...getSlowTestFilesSync(budgetProjection)
  ]);
  const inventory = CodexDevelopmentBuildAffectedTestInventory(
    CodexDevelopmentAffectedInventoryInputs(files, (file) => currentTestFiles.has(file)),
    provider,
    transition
  );
  // A changed fast-test source can introduce or remove a process-global
  // hazard without changing the scheduler itself. Always select the one
  // executable policy census from the raw Git delta (including a deleted test
  // that is no longer runnable), while still invoking only current test files.
  const processPolicySentinels = files.some(isFastTestFile)
    ? [FAST_TEST_PROCESS_POLICY_TEST_FILE]
    : [];
  const architecturePolicySentinels = files.some(isSecRepositoryTestModulePath)
    ? [TEST_ARCHITECTURE_POLICY_TEST_FILE]
    : [];
  const policySentinels = unionTestFiles(processPolicySentinels, architecturePolicySentinels);
  return {
    tests: inventory.changedFastTests,
    slowTests: inventory.changedSlowTests,
    affectedTests: unionTestFiles(inventory.affectedFastTests, policySentinels),
    affectedSlowTests: inventory.affectedSlowTests,
    affectedOwners: policySentinels.length === 0
      ? inventory.affectedOwners
      : uniqueSorted([
        ...inventory.affectedOwners,
        ...(processPolicySentinels.length === 0 ? [] : ['dev-runner']),
        ...(architecturePolicySentinels.length === 0 ? [] : ['verification.test-governance'])
      ]),
    sourceChanged: inventory.sourceChanged,
    selectionResolved: inventory.selectionResolved,
    unresolvedModuleFiles: inventory.unresolvedModuleFiles
  };
}

function unionTestFiles(...groups: string[][]): string[] {
  return uniqueSortedLines(groups.flat().join('\n'));
}

function unresolvedRiskPaths(
  files: readonly string[],
  closure: ReturnType<typeof selectSlowTestRiskClosure>
): string[] {
  // `selectSlowTestRiskClosure` already performs one batch inventory. Re-running
  // it once per changed path rebuilt the same graph and source observation for
  // large deltas. When the aggregate resolution is false, retain the complete
  // changed-path frontier; callers get a conservative typed diagnostic and no
  // path can be authorized from a partial per-file approximation.
  return closure.resolved ? [] : uniqueSorted([...files]);
}

export interface ResolvedAffectedTestExecution {
  readonly plan: AffectedTestPlan;
  /**
   * Process-local, Source Program-issued exact bytes for the same observation
   * that produced `plan`. It is deliberately absent from every JSON plan and
   * terminal: another process must acquire a new physical observation.
   */
  readonly projectGenerationEvidence: WorkspaceTypeScriptProjectGenerationEvidence;
  /** Re-observes the same Git/source/provider identity before any effect. */
  readonly assertCurrent: () => Promise<boolean>;
  readonly run: (preparedDependencies?: OperationDependencyBootstrapResult) => Promise<number>;
}

function framedChangedPathDigest(files: readonly string[]): `sha256:${string}` {
  const sorted = uniqueSorted([...files]);
  return rawSha256(sorted.map((file) => `${Buffer.byteLength(file, 'utf8')}:${file}\0`).join(''));
}

function affectedTestPlan(
  files: string[],
  broadFallbackEnabled: boolean,
  provider: CodexDevelopmentTestImpactSourceProvider,
  transition?: CodexDevelopmentTestImpactTransitionObservation,
  gitObservation?: GitSelectionGitObservation,
  observationFailure: 'git' | 'source' | null = null
): AffectedTestPlan {
  const budgetProjection = compileTestBudgetProjection(provider.projection);
  const risk = selectSlowTestRiskClosure(files, provider, transition);
  const selection = affectedTestSelection(files, budgetProjection, provider, transition);
  const unresolvedPaths = unresolvedRiskPaths(files, risk);
  const sourceObservationUnresolved = provider.projection.moduleGraph.unresolvedFiles;
  const observedSelection: AffectedTestSelection = observationFailure === 'source'
    ? {
        ...selection,
        selectionResolved: false,
        unresolvedModuleFiles: uniqueSorted([
          ...selection.unresolvedModuleFiles,
          ...sourceObservationUnresolved,
          'source-observation-drift'
        ])
      }
    : sourceObservationUnresolved.length > 0
      ? {
          ...selection,
          selectionResolved: false,
          unresolvedModuleFiles: uniqueSorted([
            ...selection.unresolvedModuleFiles,
            ...sourceObservationUnresolved
          ])
        }
      : selection;
  const selectedFastTests = unionTestFiles([...observedSelection.tests], [...observedSelection.affectedTests]);
  const ownershipResolved = risk.resolved
    && unresolvedPaths.length === 0;
  const trustBoundary = classifyAffectedSelectionTrustBoundary({
    gitDiscoveryFailed: observationFailure === 'git',
    ownershipResolved,
    sourceChanged: observedSelection.sourceChanged,
    selectionResolved: observedSelection.selectionResolved,
    unresolvedModuleFiles: observedSelection.unresolvedModuleFiles,
    selectedFastTestCount: selectedFastTests.length,
    broadFallbackEnabled
  });
  const subjectRevision = gitObservation?.headSha ?? (affectedTestsBaseRef() ?? 'HEAD');
  const inputDigest = framedChangedPathDigest(files);
  const diagnostic = isAffectedSelectionFailClosed(trustBoundary)
    ? `Affected selection trust boundary: ${trustBoundary}`
    : null;
  const verificationResult = projectAffectedSelectionToVerificationGateResult(
    trustBoundary,
    defaultAffectedSelectionProjectionContext(subjectRevision, inputDigest, diagnostic)
  );
  const identity = gitObservation === undefined ? undefined : Object.freeze({
    schema: 'sec-affected-plan-identity-v1' as const,
    baseSha: gitObservation.baseSha,
    headSha: gitObservation.headSha,
    indexDigest: gitObservation.indexDigest,
    worktreeDigest: gitObservation.worktreeDigest,
    changedPathsDigest: inputDigest,
    sourceObservationDigest: provider.projection.testObservationDigest as `sha256:${string}`,
    sourceEpoch: provider.projection.workspaceSnapshotIdentityDigest as `sha256:${string}`,
    ruleRevision: 'affected-selection-trust-boundary-v4-observation-session',
    broadFallbackEnabled,
    gitProviderRoute: gitObservation.gitProviderRoute,
    gitProviderIdentityDigest: rawSha256(JSON.stringify(gitObservation.gitProviderIdentity)),
    gitExecutable: gitObservation.gitExecutable,
    gitExecutableDigest: gitObservation.gitExecutableIdentity?.digest
      ?? rawSha256(JSON.stringify(gitObservation.gitProviderIdentity))
  });
  return {
    schema: 'sec-affected-test-plan-v1',
    changedPaths: files,
    owners: uniqueSorted([...observedSelection.affectedOwners, ...risk.owners]),
    selectedFastTests,
    selectedSlowTests: unionTestFiles([...observedSelection.slowTests], [...observedSelection.affectedSlowTests]),
    riskSuites: risk.suites,
    riskTests: unionTestFiles(
      risk.suites.flatMap((suite) => slowTestSuiteFiles(budgetProjection, suite)),
      risk.slowTests
    ),
    riskReasons: risk.reasons,
    unresolvedPaths,
    resolved: ownershipResolved,
    selectionResolved: observedSelection,
    selectionTrustBoundary: trustBoundary,
    verificationResult,
    broadFallbackEnabled,
    identity
  };
}

function freezeAffectedTestPlan(plan: AffectedTestPlan): AffectedTestPlan {
  return deepFreeze({
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
    verificationResult: Object.freeze({ ...plan.verificationResult }),
    broadFallbackEnabled: plan.broadFallbackEnabled,
    ...(plan.identity === undefined ? {} : { identity: Object.freeze({ ...plan.identity }) })
  });
}

async function runAffectedTestPlan(
  plan: AffectedTestPlan,
  preparedDependencies?: OperationDependencyBootstrapResult
): Promise<number> {
  if (!plan.resolved) {
    console.error(`Affected test ownership is unresolved for changed paths: ${plan.unresolvedPaths.join(', ')}`);
    return 1;
  }
  // The execution entrypoint is a second admission guard. A malformed or
  // hand-constructed plan must not spawn an already-selected test while its
  // source graph is incomplete; selectedFastTests never override this fence.
  if (isAffectedSelectionFailClosed(plan.selectionTrustBoundary)
      || (plan.selectionResolved.sourceChanged && !plan.selectionResolved.selectionResolved)) {
    console.error(
      `Affected selection trust boundary is ${plan.selectionTrustBoundary}; `
      + 'source graph observation is unresolved, so execution is blocked before child spawn.'
    );
    return 1;
  }
  // Reuse the selection computed during plan construction instead of recomputing.
  const selection = plan.selectionResolved;
  if (selection.slowTests.length > 0) {
    console.log(`Changed slow test files require canonical slow-test closure or release/full verification: ${selection.slowTests.join(', ')}`);
  }

  const selectedFastTests = [...plan.selectedFastTests];
  if (selectedFastTests.length > 0) {
    if (selection.affectedTests.length > 0) {
      console.log(`Running changed and affected fast tests for ${selection.affectedOwners.join(', ') || 'changed sources'}: ${selectedFastTests.join(', ')}`);
    }
    const code = await runFastTests(selectedFastTests, preparedDependencies);
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
    if (!plan.broadFallbackEnabled) {
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
    const code = await runFastTests([], preparedDependencies);
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

export async function resolveAffectedTestExecution(options: Readonly<{
  dependencyGeneration?: RetainedCompilerDependencyReadGeneration;
  operation: SecBoundSemanticOperation;
  issueTestImpactProjection: AffectedTestImpactProjectionIssuer;
  /** Callers with an explicit pre-effect fence may defer this first recheck. */
  verifyAtResolution?: boolean;
}>): Promise<ResolvedAffectedTestExecution | null> {
  const ownedDependencyResolution = options.dependencyGeneration === undefined
    ? await observeOperationDependencyReadGeneration({
        deadlineAtUnixMs: options.operation.plan.attempt.deadlineAtUnixMs
      })
    : null;
  if (ownedDependencyResolution?.status === 'unavailable') {
    console.error(`Affected ProjectInput dependency generation is unavailable: ${ownedDependencyResolution.reason}`);
    return null;
  }
  const dependencyGeneration = options.dependencyGeneration
    ?? ownedDependencyResolution!.generation;
  const compilationOperation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: affectedSelectionSourceCompilationDeadlineAtUnixMs(options.operation)
  });
  const gitResolution = createAuthorityGitReadSession({
    cwd: compilerRoot,
    operation: options.operation,
    budget: GIT_READ_OPERATION_BUDGET
  });
  if (gitResolution.status !== 'ready') {
    if (ownedDependencyResolution?.status === 'ready') {
      await ownedDependencyResolution.generation.retire();
    }
    return null;
  }
  const gitSession = gitResolution.session;
  let changed: GitChangedFilesResult | null = null;
  let testImpactObservation: Awaited<ReturnType<AffectedTestImpactProjectionIssuer>> | null = null;
  let gitRevalidationLedger: AffectedGitRevalidationLedger | null = null;
  let initialSessionFailure = gitSession.failure;
  let initialSessionClosed = false;
  try {
    changed = await gitChangedFiles(gitSession);
    if (changed !== null) {
      const projected = await issueAffectedWorkingTreeTestImpactProjection(
        gitSession,
        options.issueTestImpactProjection,
        dependencyGeneration,
        compilationOperation
      );
      if (projected.status === 'ready') {
        testImpactObservation = projected;
      } else {
        console.error(`Affected Test Impact projection is unavailable: ${projected.reason}`);
      }
    }
    initialSessionFailure = gitSession.failure;
  } finally {
    // The initial Git session is only an observation transport. The frozen
    // plan keeps values, not a live provider capability.
    try {
      await gitSession.close?.();
      initialSessionClosed = true;
    } catch {
      initialSessionClosed = false;
    }
    initialSessionFailure = gitSession.failure;
    if (ownedDependencyResolution?.status === 'ready') {
      await ownedDependencyResolution.generation.retire();
    }
  }
  if (!initialSessionClosed || initialSessionFailure !== null || changed === null) return null;
  gitRevalidationLedger = createAffectedGitRevalidationLedger(
    options.operation,
    gitSession,
    changed.gitObservation.gitExecutableIdentity
  );
  const revalidationLedger = gitRevalidationLedger;
  if (testImpactObservation === null) return null;
  const { projection: testImpactProjection, projectGenerationEvidence } = testImpactObservation;
  const sourceObservationProvider = createRepositoryTestImpactSourceProvider({
    projection: testImpactProjection,
    activeDocumentationPaths: currentActiveDocumentationPaths()
  });
  const provider = sourceObservationProvider;
  const broadFallbackEnabled = allowFullFastFallback();
  const initialPlan = affectedTestPlan(
    changed.files,
    broadFallbackEnabled,
    provider,
    changed.transitionObservation,
    changed.gitObservation,
    null
  );
  const assertCurrent = async (): Promise<boolean> => {
    try {
      const finalGitObservation = await reobserveAffectedGitSelectionState(
        changed.gitObservation,
        revalidationLedger
      );
      return finalGitObservation !== null
        && sameGitSelectionObservation(changed.gitObservation, finalGitObservation);
    } catch {
      // Revalidation is an admission predicate. Any provider/source exception
      // is an unresolved boundary, never permission to continue to a child.
      return false;
    }
  };
  const canAuthorizeEffects = !isAffectedSelectionFailClosed(initialPlan.selectionTrustBoundary)
    && initialPlan.resolved;
  const verifyAtResolution = options.verifyAtResolution ?? true;
  const observationStable = canAuthorizeEffects && verifyAtResolution ? await assertCurrent() : true;
  const observationFailure: 'git' | 'source' | null = canAuthorizeEffects && !observationStable
    ? initialSessionFailure !== null ? 'git' : 'source'
    : null;
  const plan = freezeAffectedTestPlan(observationFailure === null
    ? initialPlan
    : affectedTestPlan(
      changed.files,
      broadFallbackEnabled,
      provider,
      changed.transitionObservation,
      changed.gitObservation,
      observationFailure
    ));
  return Object.freeze({
    plan,
    projectGenerationEvidence,
    assertCurrent,
    run: async (preparedDependencies?: OperationDependencyBootstrapResult) => {
      // A plan already rejected by ownership/selection admission has no
      // runnable child or dependency effect. Preserve the typed fail-closed
      // result without spending another full source census on a boundary that
      // cannot authorize anything.
      if (!plan.resolved || isAffectedSelectionFailClosed(plan.selectionTrustBoundary)) {
        return runAffectedTestPlan(plan, preparedDependencies);
      }
      // Last-mile fence: callers may hold a resolved plan while another
      // process edits source/index/worktree. Never spawn a selected child
      // from a stale plan, even if the caller skipped the outer gate owner.
      if (!(await assertCurrent())) {
        console.error('Affected plan observation drifted before test child spawn; execution is blocked.');
        return 1;
      }
      return runAffectedTestPlan(plan, preparedDependencies);
    }
  });
}

export async function runAffectedTests(
  issueTestImpactProjection: AffectedTestImpactProjectionIssuer,
  args: string[] = []
): Promise<number> {
  if (args.includes('--plan') && !(args.length === 1 && args[0] === '--plan')) {
    console.error('test:affected --plan cannot be combined with execution arguments.');
    return 1;
  }
  if (args.length > 0 && !(args.length === 1 && args[0] === '--plan')) {
    return runTests(args);
  }
  const operation = compileAffectedTestSelectionSemanticOperation({
    purpose: 'check-affected'
  });
  const execution = await resolveAffectedTestExecution({
    operation,
    issueTestImpactProjection,
    // The execution object retains the same frozen plan identity and performs
    // its own last-mile fence immediately before dependency/test effects. A
    // plan query still verifies at resolution; this removes a redundant full
    // source census from the direct execution path without weakening admission.
    verifyAtResolution: args.length === 1
  });
  if (!execution) {
    console.error('Failed to detect affected test files.');
    return 1;
  }
  if (args.length === 1) {
    console.log(JSON.stringify(execution.plan, null, 2));
    // Issue #206: --plan fails closed for any unresolved trust boundary, not
    // just ownership-unresolved. This keeps `--plan` exit codes consistent
    // with the execution path so CI can branch on `--plan` alone.
    return affectedTestPlanExitCode(execution.plan);
  }
  return execution.run();
}

export async function runTests(args: string[] = []): Promise<number> {
  let exitCode = 1;
  let selectors: string[] = [];
  if (args.length > 0) {
    ({ selectors } = partitionBunTestArgs(args));
    if (selectors.length > 0 && selectors.every(isFastTestFile)) {
      await withOperationDependencies('test-direct-fast', async ({ binPath }) => {
        const environment = pathEnv(binPath);
        const invocationArgs = managedBunTestArgs(['test', ...args]);
        exitCode = await runWithTestInvocationRuntime(environment, (runtime) =>
          runWithParentOwnedProcessTemp(runtime, environment, 'direct:001', (prepared) =>
            runDevCommand('bun', invocationArgs, prepared, {
              timeoutMs: testSupervisorTimeoutMs(invocationArgs)
            })));
      });
      return exitCode;
    }
  }
  const directOperation = args.length === 0
    ? 'test-full'
    : selectors.length > 0 && selectors.every(isSlowTestFile)
      ? 'test-direct-slow'
      : 'test-direct-ambiguous';
  const budgetProjection = args.length === 0
    ? await issueCurrentTestBudgetProjection()
    : null;
  await withOperationDependencies(directOperation, async ({ binPath }) => {
    const environment = pathEnv(binPath);
    if (args.length > 0) {
      // Only an exact slow-file selection proves that Bun cannot discover a
      // fast test. Option-only, mixed and pattern/directory selections share
      // the same invocation runtime boundary as every other fast-capable
      // entrypoint.
      const isProvenSlowOnly = selectors.length > 0 && selectors.every(isSlowTestFile);
      const invocationArgs = managedBunTestArgs(['test', ...args]);
      exitCode = isProvenSlowOnly
        ? await runDevCommand('bun', invocationArgs, environment, {
            timeoutMs: testSupervisorTimeoutMs(invocationArgs)
          })
        : await runWithTestInvocationRuntime(environment, (runtime) =>
            runWithParentOwnedProcessTemp(runtime, environment, 'direct:001', (prepared) =>
              runDevCommand('bun', invocationArgs, prepared, {
                timeoutMs: testSupervisorTimeoutMs(invocationArgs)
              })));
      return;
    }
    exitCode = await runWithTestInvocationRuntime(environment, async (runtime) => {
      for (const invocation of fullTestInvocations(budgetProjection!)) {
        const invocationArgs = managedBunTestArgs(invocation.args);
        const code = invocation.kind === 'fast'
          ? await runWithParentOwnedProcessTemp(runtime, environment, invocation.id, (prepared) =>
              runDevCommand('bun', invocationArgs, prepared, {
                timeoutMs: testSupervisorTimeoutMs(invocationArgs)
              }))
          : await runDevCommand('bun', invocationArgs, environment, {
              timeoutMs: testSupervisorTimeoutMs(invocationArgs)
            });
        if (code !== 0) return code;
      }
      return 0;
    });
  });
  return exitCode;
}

export async function runFastTests(
  args: string[] = [],
  preparedDependencies?: OperationDependencyBootstrapResult
): Promise<number> {
  let exitCode = 1;
  const budgetProjection = await issueCurrentTestBudgetProjection();
  const workspace = await prepareFastTestWorkspaceRun();
  const workspaceEnv = workspace.env;
  let invocationRuntime: TestInvocationRuntimeRoots | null = null;
  let hasPrimaryFailure = false;
  let primaryFailure: unknown;
  try {
    if (testInvocationRuntimeIsolationModeForPlatform(process.platform) === 'retained') {
      invocationRuntime = await createTestInvocationRuntimeRoots({
        repositoryRoot: compilerRoot,
        hostTempRoot: tmpdir(),
        environment: { ...secRuntimeStateEnvironment(), ...workspaceEnv }
      });
    }
    await withOperationDependencies('test-fast', async ({ binPath }) => {
      try {
        const plan = fastTestInvocations(args, budgetProjection);
        const env = pathEnv(binPath, workspaceEnv);
        exitCode = await runBoundedFastTestInvocations(
          plan.concurrentShards,
          env,
          plan.concurrentProcessLimit,
          invocationRuntime
        );
        if (exitCode !== 0) return;
        for (const resourceClass of plan.resourceClassOrder) {
          exitCode = await runBoundedFastTestInvocations(
            plan.resourceQueues[resourceClass],
            env,
            plan.resourceLimits[resourceClass],
            invocationRuntime
          );
          if (exitCode !== 0) return;
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        exitCode = 1;
      }
    }, preparedDependencies);
  } catch (error) {
    hasPrimaryFailure = true;
    primaryFailure = error;
  }
  try {
    await invocationRuntime?.cleanup();
  } catch (error) {
    console.error(`Fast test invocation runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!hasPrimaryFailure && exitCode === 0) exitCode = 1;
  }
  try {
    settlePreparedTestWorkspaceRun(workspace.cleanup);
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
    const budgetProjection = await issueCurrentTestBudgetProjection();
    selection = slowTestArgSelection(args, budgetProjection);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (selection.kind === 'skip') {
    console.log(selection.message);
    return 0;
  }
  await withOperationDependencies('test-slow', async ({ binPath }) => {
    try {
      const invocationArgs = managedBunTestArgs(selection.args);
      exitCode = await runDevCommand('bun', invocationArgs, pathEnv(binPath), {
        timeoutMs: testSupervisorTimeoutMs(invocationArgs)
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      exitCode = 1;
    }
  });
  return exitCode;
}

export async function runContractFreeze(targets?: ContractFreezeTarget[]): Promise<number> {
  let exitCode = 0;
  await withOperationDependencies('test-contract-freeze', async ({ binPath }) => {
    const environment = pathEnv(binPath);
    exitCode = await runWithTestInvocationRuntime(environment, async (runtime) => {
      for (const [index, invocation] of buildContractFreezeRunnerInvocations(targets).entries()) {
        const invocationArgs = managedBunTestArgs(invocation.args);
        const code = await runWithParentOwnedProcessTemp(
          runtime, environment, `contract-freeze:${String(index + 1).padStart(3, '0')}`, (prepared) =>
          runDevCommand('bun', invocationArgs, prepared, {
            timeoutMs: testSupervisorTimeoutMs(invocationArgs)
          }));
        if (code !== 0) return code;
      }
      return 0;
    });
  });
  return exitCode;
}
