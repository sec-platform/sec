import { isNativeAborted, throwIfNativeAborted } from '../../system-architecture/foundation/runtime/native-abort.ts';
import { observeOptionalDiagnostic } from '../../system-architecture/foundation/runtime/optional-diagnostic.ts';
import { captureVerifyProjectOptions } from './verify-invocation.ts';
import { shouldExecuteRuntimeVerification, verificationLaneProfile, type VerificationRuntimeMode } from '../../verification/contract/lanes.ts';
import path from 'node:path';
import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import type { Logger } from '../../system-architecture/foundation/logger.ts';
import { defaultLogger } from '../../system-architecture/foundation/logger.ts';
import { canonicalEquals, compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { ensureProjectDependencies } from '../../toolchain/dependencies/runtime.ts';
import type { CanonicalVerificationArtifactSet } from '../../verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport, VerificationLane, VerificationReport } from '../../verification/contract/types.ts';
import { buildExpectedProductVerificationClaimSummary, buildProductVerificationObservationBindings, type ProductVerificationGateObservation, type ProductVerificationObservations } from '../../verification/profile/contract/product.ts';
import { checkProjectBeforeVerify } from '../../workspace/application/project-integrity.ts';
import { listFilesRecursive } from '../../workspace/runtime/discovery.ts';
import { getWorkspacePaths, relativePosixPath } from '../../workspace/runtime/paths.ts';
import type { LockFile } from '../contract.ts';
import { CompilerError, formatCompilerFailure } from '../errors.ts';
import { addGeneratedPaths, assertPassStatus } from '../lock.ts';
import { emitPipelineExecutionBoundary } from '../pipeline/journal.ts';
import type { PipelineEventHandler, PipelineExecutionBoundary } from '../pipeline/types.ts';
import type { PolicyReport } from '../policies/contract/types.ts';
import {
  assertIsolatedStagingTree,
  type IsolatedStagingTreeOptions
} from './assert-isolated-staging-tree.ts';
import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { runPolicyGate } from './run-policy-gate.ts';
import { createSkippedRuntimeLane, runRuntimeVerification } from './run-runtime-verification.ts';
import { runSuiteFiles } from './run-suite-files.ts';
import {
  consumeStagedVerificationProof,
  revalidateStagedVerificationProof,
  type StagedVerificationProof
} from './staged-verification-proof.ts';
import { typecheckProject } from './typecheck-project.ts';
import { publishVerificationArtifactSet } from './verification-artifact-publication.ts';

export function productVerificationSubjectRevision(lock: LockFile): string {
  return sha256({
    domain: 'product-verification-subject',
    formatVersion: lock.formatVersion,
    app: lock.app,
    resolvedBlocks: lock.resolvedBlocks,
    resolvedCapabilities: lock.resolvedCapabilities,
    installPlan: lock.installPlan,
    semanticLoweringTasks: lock.semanticLoweringTasks,
    semanticViews: lock.semanticViews,
    acceptancePlan: lock.acceptancePlan
  });
}

export function productVerificationObservationBindings(
  lock: LockFile,
  lane: VerificationLane,
  runtimeMode: VerificationRuntimeMode
): ProductVerificationObservations {
  return buildProductVerificationObservationBindings(
    productVerificationSubjectRevision(lock),
    lane,
    runtimeMode
  );
}

function productVerificationEnvironment(): NonNullable<ProductVerificationGateObservation['environment']> {
  return {
    runtime: `bun@${Bun.version}`,
    os: process.platform,
    arch: process.arch,
    filesystem: null,
    capabilities: ['in-process-product-verification'],
    toolchainRevision: `bun@${Bun.version}`,
    providerRevisions: []
  };
}

function observedExecution(
  binding: ProductVerificationGateObservation,
  status: 'passed' | 'failed' | 'skipped',
  output: unknown,
  startedAtMs: number,
  finishedAtMs: number
): ProductVerificationGateObservation {
  if (status === 'skipped') return binding;
  const outputDigest = sha256(output);
  return {
    ...binding,
    environment: productVerificationEnvironment(),
    execution: {
      argv: [process.execPath, ...process.argv.slice(1)],
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, Math.round(finishedAtMs - startedAtMs)),
      exitCode: status === 'passed' ? 0 : 1,
      outputDigest,
      failureFingerprint: status === 'failed' ? outputDigest : null
    }
  };
}

export interface VerifyProjectOptions {
  readonly beforeCommit?: () => Promise<void>;
  readonly emitTiming?: boolean;
  readonly isolated?: boolean;
  readonly logger?: Logger;
  readonly pipelineObserver?: Readonly<{
    readonly onEvent: PipelineEventHandler;
    readonly transactionId: string;
  }>;
  readonly signal?: AbortSignal;
  readonly stagedVerificationProof?: StagedVerificationProof;
  readonly stagingTreeOptions?: IsolatedStagingTreeOptions;
}

async function emitVerifyBoundary(
  options: VerifyProjectOptions,
  boundary: Extract<PipelineExecutionBoundary, `verify-${string}`>
): Promise<void> {
  if (!options.pipelineObserver) return;
  await emitPipelineExecutionBoundary(
    options.pipelineObserver.onEvent,
    options.pipelineObserver.transactionId,
    boundary
  );
}

function createSkippedPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  };
}

function createSkippedFastLane(): FastVerificationLaneReport {
  return {
    status: 'skipped',
    build: { status: 'skipped' },
    unit: { status: 'skipped', passed: [] },
    acceptance: { status: 'skipped', passed: [], failed: [] },
    policy: { status: 'skipped', violations: [] },
    policyReport: createSkippedPolicyReport(),
    logs: { stdout: '', stderr: '' }
  };
}

async function listSuiteFiles(rootDir: string, suffix: string): Promise<readonly string[]> {
  // The same captured inventory must drive execution and its report. A later
  // filesystem scan would silently select a different verification subject.
  return Object.freeze((await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => compareCodeUnits(left, right)));
}

function throwFastCancellation(signal: AbortSignal | undefined, executionFailure: unknown): void {
  if (!isNativeAborted(signal)) return;
  try { throwIfNativeAborted(signal); }
  catch (cancellation) {
    if (cancellation === executionFailure) throw executionFailure;
    throw new AggregateError([executionFailure, cancellation], 'Verification execution failed during cancellation', { cause: executionFailure });
  }
}

async function runFastVerification(
  workspaceRoot: string,
  isolated: boolean,
  signal?: AbortSignal
): Promise<{ lane: FastVerificationLaneReport; failure?: Readonly<{ reason: unknown }> }> {
  throwIfNativeAborted(signal);
  const testsRoot = getWorkspacePaths(workspaceRoot).testsRoot;
  const unitRoot = path.join(testsRoot, 'unit');
  const acceptanceRoot = path.join(testsRoot, 'acceptance');
  const acceptanceFiles = await listSuiteFiles(acceptanceRoot, '.test.ts');
  const unitFiles = await listSuiteFiles(unitRoot, '.test.ts');
  throwIfNativeAborted(signal);
  const lane = createSkippedFastLane();
  let failure: Readonly<{ reason: unknown }> | undefined;

  try {
    await typecheckProject(workspaceRoot, { isolated });
    throwIfNativeAborted(signal);
    lane.build.status = 'passed';
  } catch (error) {
    throwFastCancellation(signal, error);
    lane.build.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: { reason: error } };
  }

  try {
    await runSuiteFiles(unitFiles, (file) => {
      lane.unit.passed.push(relativePosixPath(unitRoot, file));
    }, signal);
    lane.unit.status = 'passed';
  } catch (error) {
    throwFastCancellation(signal, error);
    lane.unit.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: { reason: error } };
  }

  try {
    await runSuiteFiles(acceptanceFiles, (file) => {
      lane.acceptance.passed.push(relativePosixPath(acceptanceRoot, file));
    }, signal);
    lane.acceptance.status = 'passed';
  } catch (error) {
    throwFastCancellation(signal, error);
    lane.acceptance.status = 'failed';
    // The loader stops at the first failure. A passed prefix and an unrun
    // suffix must not be relabeled as failed executions.
    const failedFile = acceptanceFiles[lane.acceptance.passed.length];
    lane.acceptance.failed = failedFile === undefined
      ? []
      : [relativePosixPath(acceptanceRoot, failedFile)];
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: { reason: error } };
  }

  throwIfNativeAborted(signal);
  const policyReport = await runPolicyGate(workspaceRoot);
  throwIfNativeAborted(signal);
  lane.policyReport = policyReport;
  lane.policy = { status: policyReport.status, violations: policyReport.violations };
  lane.logs.stdout = [
    'typecheck:passed',
    `unit:${lane.unit.passed.join(',')}`,
    `acceptance:${lane.acceptance.passed.join(',')}`,
    `policy:${policyReport.status}`
  ].join(' ');

  if (policyReport.status === 'failed') {
    failure = { reason: new CompilerError('VERIFY-POLICY-001', 'Policy gate failed', policyReport.violations) };
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(failure.reason);
    return { lane, failure };
  }

  lane.status = 'passed';
  lane.acceptance.failed = [];
  return { lane };
}

function summarizeLogs(
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): VerificationReport['logs'] {
  return {
    stdout: [fast.logs.stdout, runtime.logs.stdout].filter(Boolean).join('\n'),
    stderr: [fast.logs.stderr, runtime.logs.stderr].filter(Boolean).join('\n')
  };
}

function summarizeReport(
  lane: VerificationLane,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  runtimeMode: VerificationRuntimeMode,
  policyReport: PolicyReport,
  acceptanceCoverage: AcceptanceCoverageReport,
  observations: ProductVerificationObservations
): VerificationReport['summary'] {
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    lane,
    fast,
    runtime,
    runtimeMode,
    policyReport,
    acceptanceCoverage,
    observations
  );
  const status: 'passed' | 'failed' = claimSummary.overall.overallStatus === 'passed'
    ? 'passed'
    : 'failed';
  const failedLanes: Array<'fast' | 'runtime'> = [];
  if (verificationLaneProfile(lane).runFast && fast.status === 'failed') failedLanes.push('fast');
  if (runtime.status === 'failed') failedLanes.push('runtime');
  return { status, requestedLane: lane, failedLanes, claimSummary };
}

function updateVerifyPassState(lock: LockFile, report: VerificationReport): void {
  if (verificationLaneProfile(report.summary.requestedLane).scope === 'complete') {
    lock.passStatus.verify = report.summary.status === 'passed' ? 'succeeded' : 'failed';
    return;
  }
  lock.passStatus.verify = report.summary.status === 'failed' ? 'failed' : 'pending';
}

function ensureGeneratedPaths(lock: LockFile): void {
  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
}

export async function assertStagedVerificationLiveContext(
  workspaceRoot: string,
  lock: LockFile,
  artifacts: Pick<
    CanonicalVerificationArtifactSet,
    'verificationReport' | 'runtimeReport' | 'policyReport' | 'acceptanceCoverage'
  >
): Promise<void> {
  // Observe both rejections immediately and join both reads before leaving
  // the live-context check. Preserve policy failure priority when both fail.
  const [coverageResult, policyResult] = await Promise.allSettled([
    buildAcceptanceCoverage(
      workspaceRoot,
      lock,
      artifacts.runtimeReport,
      artifacts.verificationReport.fast
    ),
    runPolicyGate(workspaceRoot)
  ]);
  if (policyResult.status === 'rejected') throw policyResult.reason;
  if (coverageResult.status === 'rejected') throw coverageResult.reason;
  const policyReport = policyResult.value;
  const acceptanceCoverage = coverageResult.value;
  if (!canonicalEquals(policyReport, artifacts.policyReport) ||
      !canonicalEquals(acceptanceCoverage, artifacts.acceptanceCoverage)) {
    throw new Error('Live Verification policy or acceptance context changed after staged proof');
  }
}

export async function verifyProject(
  workspaceRoot: string,
  lock: LockFile,
  lane: VerificationLane = 'all',
  options: VerifyProjectOptions = {}
): Promise<VerificationReport> {
  workspaceRoot = path.resolve(workspaceRoot);
  const selection = verificationLaneProfile(lane);
  options = captureVerifyProjectOptions(options);
  const logger = options.logger ?? defaultLogger;
  let errorReporter: Logger['error'] | undefined;
  observeOptionalDiagnostic(() => { errorReporter = logger.error; });
  const subjectRevision = productVerificationSubjectRevision(lock);
  const assertSubjectCurrent = (): void => {
    throwIfNativeAborted(options.signal);
    if (productVerificationSubjectRevision(lock) !== subjectRevision) {
      throw new CompilerError('VERIFY-SUBJECT-001', 'Verification subject changed after invocation admission');
    }
  };
  const ownerFence = options.beforeCommit;
  options = Object.freeze({ ...options, beforeCommit: async () => {
    assertSubjectCurrent();
    await ownerFence?.();
    assertSubjectCurrent();
  } });
  const boundary = async (name: Extract<PipelineExecutionBoundary, `verify-${string}`>): Promise<void> => {
    assertSubjectCurrent();
    await emitVerifyBoundary(options, name);
    assertSubjectCurrent();
  };
  if (options.stagedVerificationProof !== undefined && (options.isolated || selection.scope !== 'complete')) {
    throw new Error('Staged Verification proof is restricted to one live all-lane rebuild');
  }
  assertPassStatus(
    lock,
    'compose',
    'succeeded',
    new CompilerError('VERIFY-BLOCKED-001', 'compose must succeed before verify')
  );

  await boundary('verify-preflight');
  await checkProjectBeforeVerify(workspaceRoot);
  assertSubjectCurrent();
  if (options.isolated) {
    await ensureProjectDependencies(workspaceRoot, {
      beforeCommit: options.beforeCommit,
      installMode: 'prebound-only',
      signal: options.signal,
      skipSharedDepsWarmup: true
    });
    await assertIsolatedStagingTree(workspaceRoot, options.stagingTreeOptions);
  }

  if (options.stagedVerificationProof !== undefined) {
    await options.beforeCommit?.();
    const artifacts = await consumeStagedVerificationProof(
      workspaceRoot,
      lock,
      options.stagedVerificationProof
    );
    await options.beforeCommit?.();
    await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
    await options.beforeCommit?.();
    ensureGeneratedPaths(lock);
    updateVerifyPassState(lock, artifacts.verificationReport);
    await boundary('verify-artifact-publish');
    const published = await publishVerificationArtifactSet({
      workspaceRoot,
      lock,
      artifacts,
      commitFence: options.beforeCommit
    });
    await revalidateStagedVerificationProof(workspaceRoot, lock, options.stagedVerificationProof);
    await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
    await options.beforeCommit?.();
    return published.verificationReport;
  }

  const fastStartedAtMs = Date.now();
  const fastResult = !selection.runFast
    ? { lane: createSkippedFastLane(), failure: undefined }
    : await (async () => {
        await boundary('verify-fast');
        return runFastVerification(workspaceRoot, options.isolated === true, options.signal);
      })();
  const fastFinishedAtMs = Date.now();
  const shouldRunRuntime = shouldExecuteRuntimeVerification(selection, fastResult.lane.status === 'passed');
  const runtimeMode = selection.runtimeMode;
  let runtimeLane: RuntimeVerificationLaneReport;
  const runtimeStartedAtMs = Date.now();
  if (shouldRunRuntime) {
    await boundary('verify-runtime');
    runtimeLane = await runRuntimeVerification(workspaceRoot, runtimeMode, {
      beforeCommit: options.beforeCommit,
      emitTiming: options.emitTiming,
      isolated: options.isolated,
      signal: options.signal,
      stagingTreeOptions: options.stagingTreeOptions,
      ...(options.isolated ? { stagingWorkspaceRoot: workspaceRoot } : {})
    });
  } else {
    runtimeLane = createSkippedRuntimeLane();
  }
  const runtimeFinishedAtMs = Date.now();

  const policyReport = fastResult.lane.policyReport ?? createSkippedPolicyReport();
  const coverage = await buildAcceptanceCoverage(
    workspaceRoot,
    lock,
    runtimeLane,
    fastResult.lane
  );
  assertSubjectCurrent();
  const observationBindings = buildProductVerificationObservationBindings(subjectRevision, lane, runtimeMode);
  const observations: ProductVerificationObservations = {
    fast: observedExecution(
      observationBindings.fast,
      fastResult.lane.status,
      fastResult.lane,
      fastStartedAtMs,
      fastFinishedAtMs
    ),
    runtime: observedExecution(
      observationBindings.runtime,
      runtimeLane.status,
      runtimeLane,
      runtimeStartedAtMs,
      runtimeFinishedAtMs
    ),
    policy: observedExecution(
      observationBindings.policy,
      policyReport.status,
      policyReport,
      fastStartedAtMs,
      fastFinishedAtMs
    )
  };
  const summary = summarizeReport(
    lane,
    fastResult.lane,
    runtimeLane,
    runtimeMode,
    policyReport,
    coverage,
    observations
  );
  const report: VerificationReport = {
    build: fastResult.lane.build,
    unit: fastResult.lane.unit,
    acceptance: fastResult.lane.acceptance,
    policy: fastResult.lane.policy,
    fast: fastResult.lane,
    runtime: runtimeLane,
    summary,
    logs: summarizeLogs(fastResult.lane, runtimeLane)
  };

  ensureGeneratedPaths(lock);
  updateVerifyPassState(lock, report);

  const verificationFailure = (verificationReport: VerificationReport) => new CompilerError(
    'VERIFY-ACCEPTANCE-003', 'Project verification failed', { verificationReport },
    fastResult.failure === undefined ? undefined : { cause: fastResult.failure.reason }
  );
  let published: Awaited<ReturnType<typeof publishVerificationArtifactSet>>;
  try {
    if (summary.status === 'passed') await boundary('verify-artifact-publish');
    await options.beforeCommit?.();
    published = await publishVerificationArtifactSet({ workspaceRoot, lock,
      artifacts: { verificationReport: report, runtimeReport: runtimeLane, policyReport, acceptanceCoverage: coverage },
      commitFence: options.beforeCommit });
  } catch (publicationFailure) {
    if (summary.status !== 'failed') throw publicationFailure;
    const primary = verificationFailure(report);
    throw new AggregateError([primary, publicationFailure], 'Verification failed and report publication did not complete', { cause: primary });
  }

  if (summary.status === 'failed') {
    if (runtimeLane.acceptance?.status === 'failed') {
      observeOptionalDiagnostic(() => errorReporter === undefined ? undefined : Reflect.apply(errorReporter, logger, ['VERIFY-ACCEPTANCE-003: runtime acceptance failed', {
        passed: runtimeLane.acceptance.passed,
        failed: runtimeLane.acceptance.failed,
        command: runtimeLane.acceptance.command,
        stdout: runtimeLane.logs?.stdout?.slice(0, 3000),
        stderr: runtimeLane.logs?.stderr?.slice(0, 3000)
      }]));
    }
    observeOptionalDiagnostic(() => console.error('VERIFY-ACCEPTANCE-003 full report:', JSON.stringify(published.verificationReport, null, 2)));
    throw verificationFailure(published.verificationReport);
  }

  assertSubjectCurrent();
  return published.verificationReport;
}
