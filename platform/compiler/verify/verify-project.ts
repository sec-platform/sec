import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { canonicalEquals } from '../../shared/canonical-primitives.ts';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { CompilerError, formatCompilerFailure } from '../../shared/errors.ts';
import { listFilesRecursive } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { addGeneratedPaths, assertPassStatus } from '../../shared/lock-utils.ts';
import type { Logger } from '../../shared/logger.ts';
import { defaultLogger } from '../../shared/logger.ts';
import { getWorkspacePaths, relativePosixPath } from '../../shared/paths.ts';
import { emitPipelineExecutionBoundary } from '../../shared/pipeline-journal.ts';
import type { PipelineEventHandler, PipelineExecutionBoundary } from '../../shared/pipeline-types.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import {
  buildBlockedProductVerificationClaimSummary,
  buildExpectedProductVerificationClaimSummary
} from '../../shared/product-verification-profile.ts';
import { checkProjectBeforeVerify } from '../../shared/project-integrity.ts';
import { ensureProjectDependencies } from '../../shared/project-runtime.ts';
import type { CanonicalVerificationArtifactSet } from '../../shared/verification-artifact-contract.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationClaimSummary,
  VerificationLane,
  VerificationReport
} from '../../shared/verification-types.ts';
import { compareCodeUnits } from '../ir/ir-canonical-primitives.ts';
import {
  assertIsolatedStagingTree,
  type IsolatedStagingTreeOptions
} from './assert-isolated-staging-tree.ts';
import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { runPolicyGate } from './run-policy-gate.ts';
import { createSkippedRuntimeLane, runRuntimeVerification } from './run-runtime-verification.ts';
import { lintSlotCapabilities } from './slot-capability-lint.ts';
import {
  consumeStagedVerificationProof,
  revalidateStagedVerificationProof,
  type StagedVerificationProof
} from './staged-verification-proof.ts';
import { typecheckProject } from './typecheck-project.ts';
import { publishVerificationArtifactSetV1 } from './verification-artifact-publication.ts';

interface SuiteModule {
  runSuite?: () => Promise<void> | void;
}

export function buildClaimSummary(
  lane: VerificationLane,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  runtimeMode: 'service' | 'full',
  policyReport: PolicyReport,
  acceptanceCoverage: AcceptanceCoverageReport | null = null
): VerificationClaimSummary {
  return buildExpectedProductVerificationClaimSummary(
    lane,
    fast,
    runtime,
    runtimeMode,
    policyReport,
    acceptanceCoverage
  );
}

export function buildBlockedClaimSummary(lane: VerificationLane): VerificationClaimSummary {
  return buildBlockedProductVerificationClaimSummary(lane);
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
  projectRoot: string,
  isolated: boolean
): Promise<{ lane: FastVerificationLaneReport; failure: unknown | null }> {
  const unitRoot = path.join(projectRoot, 'tests', 'unit');
  const acceptanceRoot = path.join(projectRoot, 'tests', 'acceptance');
  const acceptanceFiles = await listSuiteFiles(acceptanceRoot, '.test.ts');
  const lane = createSkippedFastLane();
  let failure: unknown | null = null;

  try {
    await typecheckProject(projectRoot, { isolated });
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

  const policyReport = runPolicyGate(workspaceRoot);
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
  acceptanceCoverage: AcceptanceCoverageReport
): VerificationReport['summary'] {
  const claimSummary = buildClaimSummary(
    lane,
    fast,
    runtime,
    runtimeMode,
    policyReport,
    acceptanceCoverage
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

function updateVerifiedSlotTasks(lock: LockFile, report: VerificationReport): void {
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') return;
  const verifiedBy = uniqueSorted([
    ...report.unit.passed.map((file) => `tests/unit/${file}`),
    ...report.acceptance.passed.map((file) => `tests/acceptance/${file}`),
    ...report.runtime.unit.passed,
    ...report.runtime.acceptance.passed
  ]);
  for (const task of lock.slotTasks) {
    if (task.status === 'filled' || task.status === 'verified') {
      task.status = 'verified';
      task.provenanceHints.verifiedBy = [...verifiedBy];
    }
  }
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
  const policyReport = runPolicyGate(workspaceRoot);
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
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  assertPassStatus(
    lock,
    'adapt',
    'succeeded',
    new CompilerError('VERIFY-BLOCKED-001', 'adapt must succeed before verify')
  );

  await emitVerifyBoundary(options, 'verify-preflight');
  await checkProjectBeforeVerify(workspaceRoot);
  await lintSlotCapabilities(workspaceRoot, lock);
  if (options.isolated) {
    await ensureProjectDependencies(projectRoot, {
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
      projectRoot,
      lock,
      options.stagedVerificationProof
    );
    await options.beforeCommit?.();
    await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
    await options.beforeCommit?.();
    ensureGeneratedPaths(lock);
    updateVerifyPassState(lock, artifacts.verificationReport);
    updateVerifiedSlotTasks(lock, artifacts.verificationReport);
    await emitVerifyBoundary(options, 'verify-artifact-publish');
    const published = await publishVerificationArtifactSetV1({
      workspaceRoot,
      lock,
      artifacts,
      commitFence: options.beforeCommit
    });
    await revalidateStagedVerificationProof(projectRoot, lock, options.stagedVerificationProof);
    await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
    await options.beforeCommit?.();
    return published.verificationReport;
  }

  const fastResult = lane === 'runtime'
    ? { lane: createSkippedFastLane(), failure: null }
    : await (async () => {
        await emitVerifyBoundary(options, 'verify-fast');
        return runFastVerification(workspaceRoot, projectRoot, options.isolated === true);
      })();
  const shouldRunRuntime = fastResult.lane.status === 'passed' || lane === 'runtime';
  const runtimeMode = lane === 'all' ? 'full' : 'service';
  let runtimeLane: RuntimeVerificationLaneReport;
  if (shouldRunRuntime) {
    await emitVerifyBoundary(options, 'verify-runtime');
    runtimeLane = await runRuntimeVerification(projectRoot, runtimeMode, {
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

  const policyReport = fastResult.lane.policyReport ?? createSkippedPolicyReport();
  const coverage = await buildAcceptanceCoverage(
    workspaceRoot,
    lock,
    runtimeLane,
    fastResult.lane
  );
  const summary = summarizeReport(
    lane,
    fastResult.lane,
    runtimeLane,
    runtimeMode,
    policyReport,
    coverage
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
  updateVerifiedSlotTasks(lock, report);

  if (summary.status === 'passed') await emitVerifyBoundary(options, 'verify-artifact-publish');
  await options.beforeCommit?.();
  const published = await publishVerificationArtifactSetV1({
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
