import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { deepFreeze, rawSha256, uniqueSorted } from '../../../../contracts/canonical.ts';
import { uniqueSortedLines } from '../../../../contracts/collections.ts';
import { posixPath } from '../../../../contracts/relative-path.ts';
import { isRepositoryTestModulePath, normalizeRepositoryTestModulePath } from '../../../../contracts/repository-test-path.ts';
import { observeExecutionProgressPhase } from '../../../../execution/execution-progress.ts';
import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../../execution/resource-settlement.ts';
import { createAuthorityGitReadSession, type GitReadSession, type GitReadSessionCommand } from '../../../providers/git-read/runtime/session.ts';
import {
  createSourceProgramCompilationOperation,
  type SourceProgramCompilationOperation
} from '../../../repository/source-program-model/compilation-operation.ts';
import type { IssuedTestImpactProjection } from '../../../repository/source-program-model/test-impact-projection.ts';
import {
  acquireWorkingTreeSnapshot,
  assertTypeScriptProjectGenerationEvidence,
  type TypeScriptProjectGenerationEvidence
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import type { ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { runtimeStateEnvironment } from '../../../runtime-state/workspace-state/layout.ts';
import type { RetainedCompilerDependencyReadGeneration } from '../../../toolchain/dependencies/runtime.ts';
import {
  classifyAffectedSelectionTrustBoundary,
  AffectedInventoryInputs,
  BuildAffectedTestInventory,
  defaultAffectedSelectionProjectionContext,
  isAffectedSelectionFailClosed,
  projectAffectedSelectionToVerificationGateResult
} from '../../../verification/platform/test-impact/affected.ts';
import { compileTestBudgetProjection, FAST_TEST_PROCESS_POLICY_TEST_FILE, getFastTestFilesSync, getSlowTestFilesSync, isFastTestFile, isKnownSlowTestSuiteId, isSlowTestFile, issueTestInventoryProjection, slowTestSuiteFiles, slowTestSuiteIds, slowTestSuiteIdsForFile, TEST_ARCHITECTURE_POLICY_TEST_FILE, type IssuedTestInventoryProjection, type TestBudgetProjection } from '../../../verification/platform/test-impact/contract/budget.ts';
import {
  issueAffectedGitSelectionSource,
  issueAffectedTestImpactSource,
  readIssuedAffectedTestImpactBinding,
  type AffectedGitSelectionObservation
} from '../../../verification/platform/test-impact/runtime/affected-source.ts';
import { createRepositoryTestImpactSourceProvider, formatSlowImpactNotice, type TestImpactSourceProvider } from '../../../verification/platform/test-impact/runtime/impact.ts';
import { CreateTestImpactTransitionObservation, gitChangedFileDiffArgs, gitIndexChangedFileDiffArgs, gitPathBlobBatchArgs, gitUntrackedFileArgs, gitWorkingTreeStatusArgs, gitWorktreeChangedFileDiffArgs, parseGitChangedRecordsOutput, parseGitPathBlobBatchOutput, parseGitUntrackedFileOutput, type TestImpactTransitionObservation } from '../../../verification/platform/test-impact/runtime/transition.ts';
import { selectSlowTestRiskClosure } from '../../../verification/platform/test-impact/slow-risk-selection.ts';
import { compilerRoot } from "../../../workspace-context.ts";
import { currentActiveDocumentationPaths } from '../../control/documentation/active.ts';
import {
  compileOperationDemandGraph,
  type OperationKind
} from '../../control/operation/demand.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import {
  AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING,
  affectedSelectionSourceCompilationDeadlineAtUnixMs,
  affectedTestPlanExitCode,
  compileAffectedTestSelectionSemanticOperation,
  isDocumentationOnlyAffectedSelection,
  type AffectedTestPlan,
  type AffectedTestSelection
} from './affected-plan-contract.ts';
import {
  issueCheckAffectedTestImpactProjection,
  type AffectedTestImpactProjectionIssuer
} from './check-affected-source.ts';
import {
  boundedUtf8TextTail,
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
import { reportDevExecutionProgress, sourceProgramProgressObserver } from './execution-progress.ts';
import {
  assertFastTestProcessPolicyInventory,
  isDefaultFastTestFile,
  type FastTestProcessResourceClass
} from './fast-test-policy.ts';
import type { RepositoryMutationFenceExecutionContext } from './repository-mutation-fence.ts';
import {
  admitFastTestBatchExecutionPolicy,
  admitTestSuiteExecutionPolicy,
  issueFastTestBatchExecutionPolicy,
  issueTestSuiteExecutionPolicy,
  withDefaultTestTimeout,
  type TestSuiteExecutionPolicy
} from './test-execution-policy.ts';
import {
  createTestInvocationRuntimeRoots,
  testInvocationRuntimeIsolationModeForPlatform,
  TestProcessTempLifecycleError,
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
  return isRepositoryTestModulePath(selector);
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

function managedBunTestArgs(args: readonly string[]): string[] {
  if (args[0] !== 'test') throw new Error('Managed Bun test invocation must begin with "test".');
  return ['test', ...withDefaultTestTimeout(args.slice(1))];
}

type FastTestInvocationQueue = 'parallel' | FastTestProcessResourceClass;

type FastTestInvocation = {
  readonly id: string;
  readonly queue: FastTestInvocationQueue;
  readonly args: string[];
};

function selectFastTestFiles(
  args: string[],
  budgetProjection: TestBudgetProjection,
  inventory: 'default' | 'complete' = 'default'
): Readonly<{ files: readonly string[]; options: readonly string[] }> {
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
  return Object.freeze({ files: Object.freeze(selectedFiles), options: Object.freeze(options) });
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

function affectedTestsBaseRef(): string | undefined {
  return process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
}

type GitChangedFilesResult = Readonly<{
  files: string[];
  transitionObservation?: TestImpactTransitionObservation;
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

type GitSelectionGitObservation = AffectedGitSelectionObservation;

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
  readonly operation: BoundSemanticOperation;
  readonly processSession?: ProcessResourceSession;
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

function createAffectedGitRevalidationLedger(): AffectedGitRevalidationLedger {
  const operation = compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' });
  return {
    operation,
    deadlineAt: operation.plan.attempt.deadlineAtUnixMs,
    ...AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING,
    revalidationCount: 0,
    processCount: 0,
    argumentBytes: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    recordCount: 0,
    rootObservedBytes: 0,
    reopenRefreshes: 0,
    settlementAttempts: 0,
    executableBytes: 0
  };
}

function accountAffectedGitRevalidationSession(
  ledger: AffectedGitRevalidationLedger,
  session: GitReadSession
): boolean {
  if (ledger.processSession === undefined) ledger.processCount += session.processCount;
  else ledger.processCount = ledger.processSession.processCount;
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
    ...(ledger.processSession === undefined ? {} : { processSession: ledger.processSession }),
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
        transitionObservation: CreateTestImpactTransitionObservation({
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
        transitionObservation: CreateTestImpactTransitionObservation({
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

export async function issueCurrentTestBudgetProjection(): Promise<TestBudgetProjection> {
  return (await issueCurrentTestBudgetExecutionSource()).budgetProjection;
}

type TestBudgetExecutionSource = Readonly<{
  testInventory: IssuedTestInventoryProjection;
  budgetProjection: TestBudgetProjection;
  dependencyGenerationDigest?: `sha256:${string}`;
  reobserve: (deadlineAtUnixMs: number) => Promise<boolean>;
}>;

async function reobserveTestBudgetExecutionSource(input: Readonly<{
  expectedTestInventory: IssuedTestInventoryProjection;
  expectedBudgetProjection: TestBudgetProjection;
  expectedGitObservation?: GitSelectionGitObservation;
  deadlineAtUnixMs: number;
}>): Promise<boolean> {
  let session: GitReadSession | null = null;
  let result = false;
  let primaryPresent = false;
  let primary: unknown;
  try {
    const operation = compileAffectedTestSelectionSemanticOperation({
      purpose: 'budget-projection',
      deadlineAtUnixMs: input.deadlineAtUnixMs
    });
    const resolution = createAuthorityGitReadSession({
      cwd: compilerRoot,
      operation,
      budget: GIT_READ_OPERATION_BUDGET,
      deadlineAtUnixMs: input.deadlineAtUnixMs
    });
    if (resolution.status !== 'ready') return false;
    session = resolution.session;
    const gitObservation = input.expectedGitObservation === undefined
      ? null
      : await observeGitSelectionState(session, input.expectedGitObservation.baseSha);
    if (input.expectedGitObservation !== undefined
        && (gitObservation === null
          || !sameGitSelectionObservation(input.expectedGitObservation, gitObservation))) {
      console.error('Test budget reobservation rejected a changed Git selection identity.');
      return false;
    }
    const snapshot = await acquireWorkingTreeSnapshot({ session });
    const inventory = issueTestInventoryProjection({ snapshot });
    const currentBudget = compileTestBudgetProjection(inventory);
    result = inventory.inventoryDigest === input.expectedTestInventory.inventoryDigest
      && currentBudget.projectionDigest === input.expectedBudgetProjection.projectionDigest
      && currentBudget.generationKey === input.expectedBudgetProjection.generationKey;
    if (!result) {
      console.error(`Test budget reobservation changed: inventory=${inventory.inventoryDigest}/${input.expectedTestInventory.inventoryDigest}; projection=${currentBudget.projectionDigest}/${input.expectedBudgetProjection.projectionDigest}; generation=${currentBudget.generationKey}/${input.expectedBudgetProjection.generationKey}.`);
    }
  } catch (error) {
    primaryPresent = true;
    primary = error;
    console.error(`Test budget reobservation failed: ${error instanceof Error ? error.message : String(error)}.`);
  } finally {
    await settlePhysicalResourcesAsync({
      ...(primaryPresent ? { primary: { label: 'source-reobservation', error: primary } } : {}),
      cleanup: [{
        label: 'git-read-session',
        settle: async () => { await session?.close?.(); }
      }]
    });
  }
  return result;
}

async function issueCurrentTestBudgetExecutionSource(): Promise<TestBudgetExecutionSource> {
  const operation = compileAffectedTestSelectionSemanticOperation({ purpose: 'budget-projection' });
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
  let outcome: TestBudgetExecutionSource | undefined;
  let primaryPresent = false;
  let primary: unknown;
  try {
    const snapshot = await acquireWorkingTreeSnapshot({ session });
    const testInventory = issueTestInventoryProjection({ snapshot });
    const budgetProjection = compileTestBudgetProjection(testInventory);
    outcome = Object.freeze({
      testInventory,
      budgetProjection,
      reobserve: (revalidationDeadlineAtUnixMs) => reobserveTestBudgetExecutionSource({
        expectedTestInventory: testInventory,
        expectedBudgetProjection: budgetProjection,
        deadlineAtUnixMs: revalidationDeadlineAtUnixMs
      })
    });
  } catch (error) {
    primaryPresent = true;
    primary = error;
  } finally {
    await settlePhysicalResourcesAsync({
      ...(primaryPresent ? { primary: { label: 'test-budget-source', error: primary } } : {}),
      cleanup: [{
        label: 'git-read-session',
        settle: async () => { await session.close?.(); }
      }]
    });
  }
  return outcome!;
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
      testInventory: IssuedTestInventoryProjection;
      projectGenerationEvidence: TypeScriptProjectGenerationEvidence;
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
  assertTypeScriptProjectGenerationEvidence(projectGenerationEvidence);
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
  dependencies: OperationDependencyBootstrapResult;
};

async function withOperationDependencies<T>(
  operation: Exclude<OperationKind, 'dependency-setup' | 'work-selection-observe'>,
  callback: (context: OperationDependencyContext) => Promise<T>,
  prepared?: OperationDependencyBootstrapResult
): Promise<T> {
  const demandGraph = compileOperationDemandGraph({
    operation,
    terminalWorkIds: []
  });
  const dependencies = prepared === undefined
    ? await ensureOperationDependencies(demandGraph)
    : reuseOperationDependencies(prepared, demandGraph);
  return callback({
    binPath: path.join(dependencies.nodeModulesPath, '.bin'),
    dependencies
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
  return invocation.args.filter(isTestFileSelector).map(normalizeRepositoryTestModulePath);
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

async function runFastTestExecutionWaves(
  executionWaves: readonly (readonly string[])[],
  invocationById: ReadonlyMap<string, FastTestInvocation>,
  env: NodeJS.ProcessEnv,
  invocationRuntime: TestInvocationRuntimeRoots | null,
  childDeadlineAtUnixMs: number,
  supervisorTimeoutByInvocationId: ReadonlyMap<string, number>
): Promise<number> {
  const dispatch = (invocation: FastTestInvocation) => {
      const args = managedBunTestArgs(invocation.args);
      const supervisorTimeoutMs = supervisorTimeoutByInvocationId.get(invocation.id);
      if (supervisorTimeoutMs === undefined) {
        throw new Error(`Fast test invocation has no admitted supervisor budget: ${invocation.id}`);
      }
      return runWithParentOwnedProcessTemp(invocationRuntime, env, invocation.id, (prepared) =>
        runDevCommand('bun', args, prepared, {
            observe: true,
            timeoutMs: supervisorTimeoutMs,
            deadlineAtUnixMs: childDeadlineAtUnixMs
          })
      );
  };
  for (let waveIndex = 0; waveIndex < executionWaves.length; waveIndex += 1) {
    const wave = executionWaves[waveIndex]!;
    const invocations = wave.map((id) => {
      const invocation = invocationById.get(id);
      if (invocation === undefined) throw new Error(`Fast test execution wave references an unknown invocation: ${id}`);
      return invocation;
    });
    reportDevExecutionProgress({
      command: 'test:fast', phase: `execution-wave.${waveIndex}`, state: 'start',
      detail: { invocations: invocations.map(({ id, queue }) => ({ id, queue })) }
    });
    const outcomes = await Promise.allSettled(invocations.map(dispatch));
    if (!outcomes.some((outcome) => outcome.status === 'rejected'
        || devCommandObservationExitCode(outcome.value) !== 0)) {
      reportDevExecutionProgress({
        command: 'test:fast', phase: `execution-wave.${waveIndex}`, state: 'complete',
        detail: { invocationCount: invocations.length }
      });
      continue;
    }
    reportDevExecutionProgress({
      command: 'test:fast', phase: `execution-wave.${waveIndex}`, state: 'failed',
      detail: { invocationCount: invocations.length }
    });

  const failures = outcomes.flatMap(
    (outcome, outcomeIndex): FastTestInvocationFailure[] => {
      const invocation = invocations[outcomeIndex]!;
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
    invocations[0]!.queue,
    waveIndex,
    failures
  );
  const firstFailure = failures[0]!;
  return firstFailure.kind === 'observer-rejected'
    ? 1
    : devCommandObservationExitCode(firstFailure.observation);
  }
  return 0;
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

function affectedTestSelection(
  files: string[],
  budgetProjection: TestBudgetProjection,
  provider: TestImpactSourceProvider
): AffectedTestSelection {
  const currentFastFiles = [...getFastTestFilesSync(budgetProjection)];
  assertFastTestProcessPolicyInventory(currentFastFiles);
  const currentTestFiles = new Set([
    ...currentFastFiles,
    ...getSlowTestFilesSync(budgetProjection)
  ]);
  const inventory = BuildAffectedTestInventory(
    AffectedInventoryInputs(files, (file) => currentTestFiles.has(file)),
    provider
  );
  // A changed fast-test source can introduce or remove a process-global
  // hazard without changing the scheduler itself. Always select the one
  // executable policy census from the raw Git delta (including a deleted test
  // that is no longer runnable), while still invoking only current test files.
  const processPolicySentinels = files.some(isFastTestFile)
    ? [FAST_TEST_PROCESS_POLICY_TEST_FILE]
    : [];
  const architecturePolicySentinels = files.some(isRepositoryTestModulePath)
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

export interface ResolvedAffectedTestExecution {
  readonly plan: AffectedTestPlan;
  /**
   * Process-local, Source Program-issued exact bytes for the same observation
   * that produced `plan`. It is deliberately absent from every JSON plan and
   * terminal: another process must acquire a new physical observation.
   */
  readonly projectGenerationEvidence: TypeScriptProjectGenerationEvidence | null;
  /** Re-observes the same Git/source/provider identity before any effect. */
  readonly assertCurrent: () => Promise<boolean>;
  readonly run: (preparedDependencies?: OperationDependencyBootstrapResult) => Promise<number>;
}

function gitOnlyAffectedTestPlan(
  files: readonly string[],
  gitObservation: GitSelectionGitObservation,
  broadFallbackEnabled: boolean,
  gitDiscoveryFailed = false
): AffectedTestPlan {
  const selectionResolved: AffectedTestSelection = Object.freeze({
    tests: Object.freeze([]),
    slowTests: Object.freeze([]),
    affectedTests: Object.freeze([]),
    affectedSlowTests: Object.freeze([]),
    affectedOwners: Object.freeze([]),
    sourceChanged: false,
    selectionResolved: true,
    unresolvedModuleFiles: Object.freeze([])
  });
  const selectionTrustBoundary = classifyAffectedSelectionTrustBoundary({
    gitDiscoveryFailed,
    ownershipResolved: true,
    sourceChanged: false,
    selectionResolved: true,
    unresolvedModuleFiles: [],
    selectedFastTestCount: 0,
    broadFallbackEnabled
  });
  const inputDigest = framedChangedPathDigest(files);
  return freezeAffectedTestPlan({
    schema: 'sec-affected-test-plan-v1',
    changedPaths: [...files],
    owners: [],
    selectedFastTests: [],
    selectedSlowTests: [],
    riskSuites: [],
    riskTests: [],
    riskReasons: [],
    unresolvedPaths: [],
    resolved: true,
    selectionResolved,
    selectionTrustBoundary,
    verificationResult: projectAffectedSelectionToVerificationGateResult(
      selectionTrustBoundary,
      defaultAffectedSelectionProjectionContext(
        gitObservation.headSha,
        inputDigest,
        gitDiscoveryFailed ? 'Affected Git observation drifted after Git-only selection.' : null
      )
    ),
    broadFallbackEnabled,
    identity: Object.freeze({
      schema: 'sec-affected-plan-identity-v1',
      baseSha: gitObservation.baseSha,
      headSha: gitObservation.headSha,
      indexDigest: gitObservation.indexDigest,
      worktreeDigest: gitObservation.worktreeDigest,
      changedPathsDigest: inputDigest,
      sourceObservationDigest: null,
      sourceEpoch: null,
      ruleRevision: files.length === 0
        ? 'affected-selection-trust-boundary-v5-git-empty'
        : 'affected-selection-trust-boundary-v6-docs-only',
      broadFallbackEnabled,
      gitProviderRoute: gitObservation.gitProviderRoute,
      gitProviderIdentityDigest: rawSha256(JSON.stringify(gitObservation.gitProviderIdentity)),
      gitExecutable: gitObservation.gitExecutable,
      gitExecutableDigest: gitObservation.gitExecutableIdentity?.digest
        ?? rawSha256(JSON.stringify(gitObservation.gitProviderIdentity))
    })
  });
}

function framedChangedPathDigest(files: readonly string[]): `sha256:${string}` {
  const sorted = uniqueSorted([...files]);
  return rawSha256(sorted.map((file) => `${Buffer.byteLength(file, 'utf8')}:${file}\0`).join(''));
}

function affectedTestPlan(
  files: string[],
  broadFallbackEnabled: boolean,
  provider: TestImpactSourceProvider,
  transition?: TestImpactTransitionObservation,
  gitObservation?: GitSelectionGitObservation,
  observationFailure: 'git' | 'source' | null = null
): AffectedTestPlan {
  const budgetProjection = compileTestBudgetProjection(provider.testInventory);
  const risk = selectSlowTestRiskClosure(files, provider, transition);
  const selection = affectedTestSelection(files, budgetProjection, provider);
  const unresolvedPaths = risk.unresolvedPaths;
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
  preparedDependencies?: OperationDependencyBootstrapResult,
  executionSource?: TestBudgetExecutionSource
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
    const code = await runFastTestsForInventory(selectedFastTests, preparedDependencies, 'default', {
      commandId: 'test:affected:fast',
      ...(executionSource === undefined ? {} : { source: executionSource })
    });
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
    const code = await runFastTestsForInventory([], preparedDependencies, 'default', {
      commandId: 'test:affected:fast',
      ...(executionSource === undefined ? {} : { source: executionSource })
    });
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
  operation: BoundSemanticOperation;
  /** Borrowed process ledger owned by the surrounding repository fence. */
  processSession?: ProcessResourceSession;
  issueTestImpactProjection: AffectedTestImpactProjectionIssuer;
  /** Callers with an explicit pre-effect fence may defer this first recheck. */
  verifyAtResolution?: boolean;
}>): Promise<ResolvedAffectedTestExecution | null> {
  const gitResolution = createAuthorityGitReadSession({
    cwd: compilerRoot,
    operation: options.operation,
    ...(options.processSession === undefined ? {} : { processSession: options.processSession }),
    budget: GIT_READ_OPERATION_BUDGET
  });
  if (gitResolution.status !== 'ready') {
    console.error('Affected Git provider admission failed:', gitResolution);
    return null;
  }
  const gitSession = gitResolution.session;
  let changed: GitChangedFilesResult | null = null;
  let testImpactObservation: Awaited<ReturnType<AffectedTestImpactProjectionIssuer>> | null = null;
  const ownedDependency = {
    resolution: null as Awaited<ReturnType<typeof observeOperationDependencyReadGeneration>> | null
  };
  const acquireSourceCompilation = async () => {
    let dependencyGeneration = options.dependencyGeneration;
    if (dependencyGeneration === undefined) {
      ownedDependency.resolution = await observeExecutionProgressPhase(
        'affected-selection', 'dependency-generation',
        () => observeOperationDependencyReadGeneration({
          deadlineAtUnixMs: options.operation.plan.attempt.deadlineAtUnixMs
        })
      );
      if (ownedDependency.resolution.status === 'unavailable') {
        console.error(`Affected ProjectInput dependency generation is unavailable: ${ownedDependency.resolution.reason}`);
        return null;
      }
      dependencyGeneration = ownedDependency.resolution.generation;
    }
    return {
      dependencyGeneration,
      compilationOperation: createSourceProgramCompilationOperation({
        deadlineAtUnixMs: affectedSelectionSourceCompilationDeadlineAtUnixMs(options.operation),
        observePhase: sourceProgramProgressObserver('affected-selection')
      })
    };
  };
  let initialSessionFailure = gitSession.failure;
  let initialSessionClosed = false;
  try {
    if (options.issueTestImpactProjection === issueCheckAffectedTestImpactProjection) {
      const rawBaseRef = affectedTestsBaseRef();
      const baseRef = boundedAffectedBaseRef(rawBaseRef);
      if (rawBaseRef !== undefined && baseRef === null) return null;
      const selection = await observeExecutionProgressPhase('affected-selection', 'git-selection',
        () => issueAffectedGitSelectionSource({
          session: gitSession,
          baseRef
        }));
      if (selection !== null && (selection.files.length === 0
          || isDocumentationOnlyAffectedSelection(selection.files))) {
        changed = {
          files: [...selection.files],
          gitObservation: selection.gitObservation
        };
      } else if (selection !== null) {
        const sourceCompilation = await acquireSourceCompilation();
        if (sourceCompilation === null) return null;
        const source = await issueAffectedTestImpactSource({
          ...sourceCompilation,
          repositoryRoot: compilerRoot,
          session: gitSession,
          baseRef,
          selection
        });
        if (source === null) return null;
        const binding = readIssuedAffectedTestImpactBinding(source);
        changed = {
          files: [...source.files],
          gitObservation: source.gitObservation,
          ...(binding === null ? {} : { transitionObservation: binding.transition })
        };
        testImpactObservation = source;
      }
    } else {
      changed = await gitChangedFiles(gitSession);
      if (changed !== null) {
        const sourceCompilation = await acquireSourceCompilation();
        if (sourceCompilation === null) return null;
        const projected = await issueAffectedWorkingTreeTestImpactProjection(
          gitSession,
          options.issueTestImpactProjection,
          sourceCompilation.dependencyGeneration,
          sourceCompilation.compilationOperation
        );
        if (projected.status === 'ready') {
          testImpactObservation = projected;
        } else {
          console.error(`Affected Test Impact projection is unavailable: ${projected.reason}`);
        }
      }
    }
    initialSessionFailure = gitSession.failure;
  } finally {
    // The initial Git session is only an observation transport. The frozen
    // plan keeps values, not a live provider capability.
    try {
      await gitSession.close?.();
      initialSessionClosed = true;
    } catch (error) {
      console.error('Affected Git observation settlement failed:', error);
      initialSessionClosed = false;
    }
    initialSessionFailure = gitSession.failure;
    if (ownedDependency.resolution?.status === 'ready') {
      await ownedDependency.resolution.generation.retire();
    }
  }
  if (!initialSessionClosed || initialSessionFailure !== null || changed === null) {
    console.error('Affected Git observation is unavailable:', {
      settled: initialSessionClosed,
      failure: initialSessionFailure,
      changedFilesObserved: changed !== null
    });
    return null;
  }
  if (testImpactObservation === null) {
    if (changed.files.length !== 0 && !isDocumentationOnlyAffectedSelection(changed.files)) return null;
    const broadFallbackEnabled = allowFullFastFallback();
    const initialGitObservation = changed.gitObservation;
    const initialPlan = gitOnlyAffectedTestPlan(changed.files, initialGitObservation, broadFallbackEnabled);
    const assertCurrent = async (): Promise<boolean> => {
      try {
        const finalGitObservation = await reobserveAffectedGitSelectionState(
          initialGitObservation,
          createAffectedGitRevalidationLedger()
        );
        return finalGitObservation !== null
          && sameGitSelectionObservation(initialGitObservation, finalGitObservation);
      } catch {
        return false;
      }
    };
    const verifyAtResolution = options.verifyAtResolution ?? true;
    const plan = verifyAtResolution && !(await assertCurrent())
      ? gitOnlyAffectedTestPlan(changed.files, initialGitObservation, broadFallbackEnabled, true)
      : initialPlan;
    return Object.freeze({
      plan,
      projectGenerationEvidence: null,
      assertCurrent,
      run: async () => runAffectedTestPlan(plan)
    });
  }
  const compilationDiagnostics = testImpactObservation.compilationDiagnostics ?? null;
  if (compilationDiagnostics !== null) {
    reportDevExecutionProgress({
      command: 'affected-selection',
      phase: 'source-program.summary',
      state: 'complete',
      detail: {
        cache: compilationDiagnostics.cache.physicalBytes === 0 ? 'miss' : 'hit',
        cacheBytes: compilationDiagnostics.cache.physicalBytes,
        cacheParseMs: compilationDiagnostics.cache.semanticParseMs,
        incrementalExactMs: compilationDiagnostics.incrementalExactMs,
        modelAssemblyMs: compilationDiagnostics.modelAssemblyMs,
        repositoryProjectionMs: compilationDiagnostics.repositoryProjectionMs,
        testObservationsMs: compilationDiagnostics.testObservationsMs
      }
    });
  }
  const { projection: testImpactProjection, projectGenerationEvidence } = testImpactObservation;
  const testInventory = testImpactObservation.testInventory;
  const initialBudgetProjection = compileTestBudgetProjection(testInventory);
  const executionSource: TestBudgetExecutionSource = Object.freeze({
    testInventory,
    budgetProjection: initialBudgetProjection,
    ...(projectGenerationEvidence.projectInput.dependencyGenerationDigest === null
      ? {}
      : { dependencyGenerationDigest: projectGenerationEvidence.projectInput.dependencyGenerationDigest }),
    reobserve: (deadlineAtUnixMs: number) => reobserveTestBudgetExecutionSource({
      expectedTestInventory: testInventory,
      expectedBudgetProjection: initialBudgetProjection,
      expectedGitObservation: changed.gitObservation,
      deadlineAtUnixMs
    })
  });
  const sourceObservationProvider = createRepositoryTestImpactSourceProvider({
    projection: testImpactProjection,
    testInventory: testImpactObservation.testInventory,
    activeDocumentationPaths: currentActiveDocumentationPaths(),
    ...(options.issueTestImpactProjection === issueCheckAffectedTestImpactProjection
      ? { affectedSource: testImpactObservation as import('../../../verification/platform/test-impact/runtime/affected-source.ts').IssuedAffectedTestImpactSource }
      : {})
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
        createAffectedGitRevalidationLedger()
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
      // The fast-batch owner arms continuous repository observation before it
      // performs this last revalidation and before any child Effect.
      return runAffectedTestPlan(plan, preparedDependencies, executionSource);
    }
  });
}

export async function runAffectedTests(
  issueTestImpactProjection: AffectedTestImpactProjectionIssuer,
  args: string[] = [],
  options: Readonly<{
    operation?: BoundSemanticOperation;
    processSession?: ProcessResourceSession;
  }> = {}
): Promise<number> {
  if (args.includes('--plan') && !(args.length === 1 && args[0] === '--plan')) {
    console.error('test --affected --plan cannot be combined with execution arguments.');
    return 1;
  }
  if (args.length > 0 && !(args.length === 1 && args[0] === '--plan')) {
    return runTests(args);
  }
  const operation = options.operation ?? compileAffectedTestSelectionSemanticOperation({
    purpose: 'check-affected'
  });
  let execution: ResolvedAffectedTestExecution | null = null;
  const resolve = (processSession?: ProcessResourceSession) => resolveAffectedTestExecution({
    operation,
    processSession,
    issueTestImpactProjection,
    // Execution revalidates only after the fast-batch observer is active.
    // A plan query has no later Effect boundary, so it verifies here.
    verifyAtResolution: args.length === 1
  });
  if (options.processSession !== undefined) {
    execution = await resolve(options.processSession);
  } else {
    const { runRepositoryZeroWriteOperation } = await import('./repository-mutation-fence.ts');
    const selectionCode = await runRepositoryZeroWriteOperation(
      'test:affected:selection',
      async (processSession) => {
        execution = await resolve(processSession);
        return execution === null ? 1 : 0;
      },
      { operation }
    );
    if (selectionCode !== 0) return selectionCode;
  }
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

export async function runTests(
  args: string[] = [],
  options: Readonly<{ omitSlowSuites?: boolean }> = {}
): Promise<number> {
  const { selectors } = partitionBunTestArgs(args);
  if (selectors.length > 0) {
    if (selectors.every(isFastTestFile)) return runFastTests(args);
    if (selectors.every(isSlowTestFile)) return runSlowTests(args);
    console.error('Direct test selection must resolve entirely to exact fast or exact slow test files.');
    return 1;
  }
  const fastExitCode = await runFastTestsForInventory(args, undefined, 'complete');
  if (fastExitCode !== 0 || options.omitSlowSuites) return fastExitCode;
  return runSlowTests(args);
}

export function isExactSlowTestRunnerSelection(args: string[]): boolean {
  const { selectors } = partitionBunTestArgs(args);
  return selectors.length > 0 && selectors.every(isSlowTestFile);
}

export function isSelectorlessTestRunnerSelection(args: string[]): boolean {
  return partitionBunTestArgs(args).selectors.length === 0;
}

async function runFastTestsForInventory(
  args: string[] = [],
  preparedDependencies?: OperationDependencyBootstrapResult,
  inventory: 'default' | 'complete' = 'default',
  executionBoundary: Readonly<{
    commandId: string;
    source?: TestBudgetExecutionSource;
  }> = { commandId: 'test:fast' }
): Promise<number> {
  let exitCode = 1;
  const workspace = await prepareFastTestWorkspaceRun();
  const workspaceEnv = workspace.env;
  let invocationRuntime: TestInvocationRuntimeRoots | null = null;
  let invocationRuntimeSettled = false;
  let invocationRuntimeSettlementAttempted = false;
  let workspaceSettled = false;
  let workspaceSettlementAttempted = false;
  const executionDependency = {
    generation: null as RetainedCompilerDependencyReadGeneration | null
  };
  let executionDependencyGenerationSettled = false;
  let batchSettlementDeadlineAtUnixMs: number | undefined;
  let hasPrimaryFailure = false;
  let primaryFailure: unknown;
  try {
    const source = executionBoundary.source ?? await issueCurrentTestBudgetExecutionSource();
    const { testInventory, budgetProjection } = source;
    await withOperationDependencies('test-fast', async ({ binPath, dependencies }) => {
      try {
        const selection = selectFastTestFiles(args, budgetProjection, inventory);
        const env = pathEnv(binPath, workspaceEnv);
        const policy = issueFastTestBatchExecutionPolicy({
          testInventory,
          budgetProjection,
          selectedFiles: selection.files,
          bunOptions: selection.options
        });
        const admission = admitFastTestBatchExecutionPolicy(policy);
        batchSettlementDeadlineAtUnixMs = admission.logicalDeadlineAtUnixMs;
        if (source.dependencyGenerationDigest !== undefined) {
          if (dependencies.executionGenerationAuthority.generationDigest
              !== source.dependencyGenerationDigest) {
            throw new Error('Affected test dependency generation differs from its Source Program observation.');
          }
          const retained = await retainOperationDependencyReadGeneration({
            dependencies,
            deadlineAtUnixMs: admission.revalidationDeadlineAtUnixMs
          });
          if (retained.status !== 'ready') {
            throw new Error('Affected test dependency generation is unavailable for execution.');
          }
          executionDependency.generation = retained.generation;
          if (executionDependency.generation.generationDigest !== source.dependencyGenerationDigest) {
            throw new Error('Affected test dependency generation changed before execution.');
          }
        }
        if (testInvocationRuntimeIsolationModeForPlatform(process.platform) === 'retained') {
          invocationRuntime = await createTestInvocationRuntimeRoots({
            repositoryRoot: compilerRoot,
            hostTempRoot: tmpdir(),
            environment: { ...runtimeStateEnvironment(), ...workspaceEnv },
            fastTestBatchAdmission: admission
          });
        }
        const invocations = policy.invocations.map((invocation): FastTestInvocation => ({
          id: invocation.id,
          queue: invocation.queue,
          args: [...invocation.canonicalArgv.slice(1)]
        }));
        const supervisorTimeoutByInvocationId = new Map(
          policy.invocations.map(({ id, supervisorTimeoutMs }) => [id, supervisorTimeoutMs])
        );
        const invocationById = new Map(invocations.map((invocation) => [invocation.id, invocation]));
        const { compileRepositoryObservationOperation } = await import('./repository-observation.ts');
        const { runRepositoryZeroWriteOperation } = await import('./repository-mutation-fence.ts');
        exitCode = await runRepositoryZeroWriteOperation(
          executionBoundary.commandId,
          async () => {
            let code = 1;
            try {
              if (!(await source.reobserve(admission.revalidationDeadlineAtUnixMs))) {
                console.error('Fast test budget workspace snapshot drifted before child spawn.');
                return code;
              }
              code = await runFastTestExecutionWaves(
                policy.executionWaves,
                invocationById,
                env,
                invocationRuntime,
                admission.childDeadlineAtUnixMs,
                supervisorTimeoutByInvocationId
              );
            } finally {
              try {
                invocationRuntimeSettlementAttempted = true;
                await invocationRuntime?.cleanup();
                invocationRuntimeSettled = true;
              } catch (error) {
                console.error(`Fast test invocation runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
                if (error instanceof TestProcessTempLifecycleError) console.error(error);
                if (code === 0) code = 1;
              }
              try {
                workspaceSettlementAttempted = true;
                if (Date.now() >= admission.logicalDeadlineAtUnixMs) {
                  throw new Error('Fast test workspace settlement deadline expired.');
                }
                settlePreparedTestWorkspaceRun(workspace.cleanup);
                if (Date.now() >= admission.logicalDeadlineAtUnixMs) {
                  throw new Error('Fast test workspace settled after its deadline.');
                }
                workspaceSettled = true;
              } catch (error) {
                console.error(`Fast test workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
                if (code === 0) code = 1;
              }
            }
            return code;
          },
          {
            operation: compileRepositoryObservationOperation(),
            observerDeadlineAtUnixMs: admission.logicalDeadlineAtUnixMs,
            retainProcessSession: false,
            fastTestBatchAdmission: admission
          }
        );
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
    if (!invocationRuntimeSettled && !invocationRuntimeSettlementAttempted) {
      invocationRuntimeSettlementAttempted = true;
      await (invocationRuntime as TestInvocationRuntimeRoots | null)?.cleanup();
    }
  } catch (error) {
    console.error(`Fast test invocation runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof TestProcessTempLifecycleError) console.error(error);
    if (!hasPrimaryFailure && exitCode === 0) exitCode = 1;
  }
  try {
    if (!workspaceSettled && !workspaceSettlementAttempted) {
      workspaceSettlementAttempted = true;
      if (batchSettlementDeadlineAtUnixMs !== undefined
          && Date.now() >= batchSettlementDeadlineAtUnixMs) {
        throw new Error('Fast test workspace settlement deadline expired.');
      }
      settlePreparedTestWorkspaceRun(workspace.cleanup);
      if (batchSettlementDeadlineAtUnixMs !== undefined
          && Date.now() >= batchSettlementDeadlineAtUnixMs) {
        throw new Error('Fast test workspace settled after its deadline.');
      }
    }
  } catch (error) {
    console.error(`Fast test workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!hasPrimaryFailure && exitCode === 0) exitCode = 1;
  }
  try {
    await executionDependency.generation?.retire();
    executionDependencyGenerationSettled = true;
  } catch (error) {
    console.error(`Affected test dependency generation settlement failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!hasPrimaryFailure && exitCode === 0) exitCode = 1;
  }
  if (executionDependency.generation !== null && !executionDependencyGenerationSettled
      && !hasPrimaryFailure) {
    exitCode = 1;
  }
  if (hasPrimaryFailure) throw primaryFailure;
  return exitCode;
}

export async function runFastTests(
  args: string[] = [],
  preparedDependencies?: OperationDependencyBootstrapResult
): Promise<number> {
  return runFastTestsForInventory(args, preparedDependencies);
}

export async function runSlowTests(args: string[] = []): Promise<number> {
  try {
    return executePreparedSlowTestSuiteExecutions(
      await prepareSlowTestSuiteExecutions(args),
      'test:slow'
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export type PreparedSlowTestSuiteExecution = Readonly<{
  policy: TestSuiteExecutionPolicy;
}>;

const preparedSlowTestExecutions = new WeakMap<
  TestSuiteExecutionPolicy,
  Readonly<{
    reobserve: (deadlineAtUnixMs: number) => Promise<boolean>;
    run: (context: RepositoryMutationFenceExecutionContext) => Promise<number>;
  }>
>();

/** Prepares dependencies once and derives one execution per unique canonical suite. */
export async function prepareSlowTestSuiteExecutions(
  args: string[] = []
): Promise<readonly PreparedSlowTestSuiteExecution[]> {
  const source = await issueCurrentTestBudgetExecutionSource();
  const { testInventory, budgetProjection } = source;
  const { suiteId, bunArgs } = extractSlowTestRunnerArgs(args);
  if (suiteId !== undefined && !isKnownSlowTestSuiteId(suiteId)) {
    throw new Error(`Unknown slow test suite "${suiteId}". Available suites: ${slowTestSuiteIds().join(', ') || 'none'}`);
  }
  const { options, selectors } = partitionBunTestArgs(bunArgs);
  const fastSelectors = selectors.filter(isFastTestFile);
  if (fastSelectors.length > 0) {
    throw new Error(`Slow test runner cannot run fast test files: ${fastSelectors.join(', ')}`);
  }
  const availableFiles = suiteId === undefined
    ? getSlowTestFilesSync(budgetProjection)
    : slowTestSuiteFiles(budgetProjection, suiteId);
  if (availableFiles.length === 0) return Object.freeze([]);
  const selectedFiles = selectMatchingTestFiles(
    [...availableFiles], selectors, suiteId === undefined ? 'slow' : `slow suite ${suiteId}`
  );
  const filesBySuite = new Map<string, string[]>();
  for (const file of selectedFiles) {
    const owners = slowTestSuiteIdsForFile(file);
    const selectedOwner = suiteId === undefined ? owners : owners.filter((id) => id === suiteId);
    if (selectedOwner.length !== 1) {
      throw new Error(`Slow test file has no unique canonical suite: ${file}`);
    }
    const files = filesBySuite.get(selectedOwner[0]!) ?? [];
    files.push(file);
    filesBySuite.set(selectedOwner[0]!, files);
  }
  const dependencies = await ensureOperationDependencies(compileOperationDemandGraph({
    operation: 'test-slow',
    terminalWorkIds: []
  }));
  const environment = pathEnv(path.join(dependencies.nodeModulesPath, '.bin'));
  return Object.freeze(budgetProjection.slowSuites.flatMap((suite) => {
    const files = filesBySuite.get(suite.id);
    if (files === undefined) return [];
    const policy = issueTestSuiteExecutionPolicy({
      testInventory,
      budgetProjection,
      suiteId: suite.id,
      selectedFiles: files,
      bunOptions: withDefaultTestTimeout(options),
      workingDirectory: compilerRoot
    });
    const invocationArgs = [...policy.canonicalArgv.slice(1)];
    preparedSlowTestExecutions.set(policy, Object.freeze({
      reobserve: source.reobserve,
      run: (context: RepositoryMutationFenceExecutionContext) => runDevCommand(
        'bun', invocationArgs, environment, {
          testSuiteAdmission: context.testSuiteAdmission,
          testSuiteObserver: context.testSuiteObserver
        }
      )
    }));
    return [Object.freeze({ policy })];
  }));
}

export async function executePreparedSlowTestSuiteExecutions(
  preparedSuites: readonly PreparedSlowTestSuiteExecution[],
  commandId: string
): Promise<number> {
  if (preparedSuites.length === 0) {
    console.log('No slow test files detected.');
    return 0;
  }
  const { compileRepositoryObservationOperation } = await import('./repository-observation.ts');
  const { runRepositoryZeroWriteOperation } = await import('./repository-mutation-fence.ts');
  for (const preparedSuite of preparedSuites) {
    const execution = preparedSlowTestExecutions.get(preparedSuite.policy);
    if (execution === undefined) {
      throw new Error('Slow suite execution requires its owner-issued source reobservation.');
    }
    const admission = admitTestSuiteExecutionPolicy(preparedSuite.policy);
    const code = await runRepositoryZeroWriteOperation(
      `${commandId}:${preparedSuite.policy.suiteId}`,
      async (_processSession, context) => {
        if (context === undefined) {
          throw new Error('Slow suite execution requires its repository observer context.');
        }
        if (!(await execution.reobserve(admission.revalidationDeadlineAtUnixMs))) {
          throw new Error('Slow test budget workspace snapshot drifted before child spawn.');
        }
        return execution.run(context);
      },
      {
        operation: compileRepositoryObservationOperation(),
        observerDeadlineAtUnixMs: admission.logicalDeadlineAtUnixMs,
        retainProcessSession: false,
        testSuiteAdmission: admission
      }
    );
    if (code !== 0) return code;
  }
  return 0;
}
