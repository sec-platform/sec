import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import type { Logger } from '../../system-architecture/foundation/logger.ts';
import { defaultLogger } from '../../system-architecture/foundation/logger.ts';
import { canonicalEquals, compareCodeUnits, sha256, uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
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
import {
  consumeStagedVerificationProof,
  revalidateStagedVerificationProof,
  type StagedVerificationProof
} from './staged-verification-proof.ts';
import { typecheckProject } from './typecheck-project.ts';
import { publishVerificationArtifactSet } from './verification-artifact-publication.ts';

interface SuiteModule {
  runSuite?: () => Promise<void> | void;
}

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
  runtimeMode: 'service' | 'full'
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

async function listSuiteFiles(rootDir: string, suffix: string): Promise<string[]> {
  return (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => compareCodeUnits(left, right))
    .map((file) => relativePosixPath(rootDir, file));
}

async function runSuiteFiles(rootDir: string, suffix: string): Promise<string[]> {
  const files = (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => compareCodeUnits(left, right));
  const results: string[] = [];

  for (const file of files) {
    const moduleUrl = `${pathToFileURL(file).href}?t=${Date.now()}`;
    const testModule = (await import(moduleUrl)) as SuiteModule;
    if (typeof testModule.runSuite !== 'function') {
      throw new CompilerError('VERIFY-BUILD-002', `Test file "${file}" must export runSuite()`);
    }
    await testModule.runSuite();
    results.push(relativePosixPath(rootDir, file));
  }

  return results;
}

async function runFastVerification(
  workspaceRoot: string,
  isolated: boolean
): Promise<{ lane: FastVerificationLaneReport; failure: unknown | null }> {
  const testsRoot = getWorkspacePaths(workspaceRoot).testsRoot;
  const unitRoot = path.join(testsRoot, 'unit');
  const acceptanceRoot = path.join(testsRoot, 'acceptance');
  const acceptanceFiles = await listSuiteFiles(acceptanceRoot, '.test.ts');
  const lane = createSkippedFastLane();
  let failure: unknown | null = null;

  try {
    await typecheckProject(workspaceRoot, { isolated });
    lane.build.status = 'passed';
  } catch (error) {
    lane.build.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: error };
  }

  try {
    lane.unit.passed = await runSuiteFiles(unitRoot, '.test.ts');
    lane.unit.status = 'passed';
  } catch (error) {
    lane.unit.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: error };
  }

  try {
    lane.acceptance.passed = await runSuiteFiles(acceptanceRoot, '.test.ts');
    lane.acceptance.status = 'passed';
  } catch (error) {
    lane.acceptance.status = 'failed';
    lane.acceptance.failed = acceptanceFiles;
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: error };
  }

  const policyReport = await runPolicyGate(workspaceRoot);
  lane.policyReport = policyReport;
  lane.policy = { status: policyReport.status, violations: policyReport.violations };
  lane.logs.stdout = [
    'typecheck:passed',
    `unit:${lane.unit.passed.join(',')}`,
    `acceptance:${lane.acceptance.passed.join(',')}`,
    `policy:${policyReport.status}`
  ].join(' ');

  if (policyReport.status === 'failed') {
    failure = new CompilerError('VERIFY-POLICY-001', 'Policy gate failed', policyReport.violations);
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(failure);
    return { lane, failure };
  }

  lane.status = 'passed';
  lane.acceptance.failed = [];
  return { lane, failure: null };
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
  runtimeMode: 'service' | 'full',
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
  if ((lane === 'fast' || lane === 'all') && fast.status === 'failed') failedLanes.push('fast');
  if (runtime.status === 'failed') failedLanes.push('runtime');
  return { status, requestedLane: lane, failedLanes, claimSummary };
}

function updateVerifyPassState(lock: LockFile, report: VerificationReport): void {
  if (report.summary.requestedLane === 'all') {
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
  const acceptanceCoveragePromise = buildAcceptanceCoverage(
    workspaceRoot,
    lock,
    artifacts.runtimeReport,
    artifacts.verificationReport.fast
  );
  const policyReport = await runPolicyGate(workspaceRoot);
  const acceptanceCoverage = await acceptanceCoveragePromise;
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
  const logger = options.logger ?? defaultLogger;
  assertPassStatus(
    lock,
    'compose',
    'succeeded',
    new CompilerError('VERIFY-BLOCKED-001', 'compose must succeed before verify')
  );

  await emitVerifyBoundary(options, 'verify-preflight');
  await checkProjectBeforeVerify(workspaceRoot);
  if (options.isolated) {
    await ensureProjectDependencies(workspaceRoot, {
      beforeCommit: options.beforeCommit,
      installMode: 'prebound-only',
      signal: options.signal,
      skipSharedDepsWarmup: true
    });
    await assertIsolatedStagingTree(workspaceRoot, options.stagingTreeOptions);
  }

  if (options.stagedVerificationProof) {
    if (options.isolated || lane !== 'all') {
      throw new Error('Staged Verification proof is restricted to one live all-lane rebuild');
    }
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
    await emitVerifyBoundary(options, 'verify-artifact-publish');
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
  const fastResult = lane === 'runtime'
    ? { lane: createSkippedFastLane(), failure: null }
    : await (async () => {
        await emitVerifyBoundary(options, 'verify-fast');
        return runFastVerification(workspaceRoot, options.isolated === true);
      })();
  const fastFinishedAtMs = Date.now();
  const shouldRunRuntime = fastResult.lane.status === 'passed' || lane === 'runtime';
  const runtimeMode = lane === 'all' ? 'full' : 'service';
  let runtimeLane: RuntimeVerificationLaneReport;
  const runtimeStartedAtMs = Date.now();
  if (shouldRunRuntime) {
    await emitVerifyBoundary(options, 'verify-runtime');
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
  const observationBindings = productVerificationObservationBindings(lock, lane, runtimeMode);
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

  if (summary.status === 'passed') await emitVerifyBoundary(options, 'verify-artifact-publish');
  await options.beforeCommit?.();
  const published = await publishVerificationArtifactSet({
    workspaceRoot,
    lock,
    artifacts: {
      verificationReport: report,
      runtimeReport: runtimeLane,
      policyReport,
      acceptanceCoverage: coverage
    },
    commitFence: options.beforeCommit
  });

  if (summary.status === 'failed') {
    if (runtimeLane.acceptance?.status === 'failed') {
      logger.error('VERIFY-ACCEPTANCE-003: runtime acceptance failed', {
        passed: runtimeLane.acceptance.passed,
        failed: runtimeLane.acceptance.failed,
        command: runtimeLane.acceptance.command,
        stdout: runtimeLane.logs?.stdout?.slice(0, 3000),
        stderr: runtimeLane.logs?.stderr?.slice(0, 3000)
      });
    }
    console.error('VERIFY-ACCEPTANCE-003 full report:', JSON.stringify(published.verificationReport, null, 2));
    throw new CompilerError('VERIFY-ACCEPTANCE-003', 'Project verification failed', {
      verificationReport: published.verificationReport
    });
  }

  return published.verificationReport;
}
