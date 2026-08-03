import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { CompilerError, formatCompilerFailure } from '../../shared/errors.ts';
import { listFilesRecursive, writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { addGeneratedPaths, assertPassStatus } from '../../shared/lock-utils.ts';
import type { Logger } from '../../shared/logger.ts';
import { defaultLogger } from '../../shared/logger.ts';
import { getWorkspacePaths, relativePosixPath } from '../../shared/paths.ts';
import { emitPipelineExecutionBoundary } from '../../shared/pipeline-journal.ts';
import type { PipelineEventHandler, PipelineExecutionBoundary } from '../../shared/pipeline-types.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import {
  buildProductVerificationClaimPlan,
  projectProductVerificationGateClaim,
  projectProductVerificationGateOrder,
  type ProductVerificationGateKind
} from '../../shared/product-verification-claim-plan.ts';
import { checkProjectBeforeVerify } from '../../shared/project-integrity.ts';
import { ensureProjectDependencies } from '../../shared/project-runtime.ts';
import type { CanonicalVerificationArtifactSet } from '../../shared/verification-artifact-contract.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  mapProductVerificationStatus,
  type ProductVerificationMappingContext,
  type VerificationApplicability,
  type VerificationGateEnvironmentV1,
  type VerificationGateExecutionV1,
  type VerificationGateResultV1,
  type VerificationReasonCode,
  type VerificationResultStatus
} from '../../shared/verification-result-contract.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationClaimSummary,
  VerificationLane,
  VerificationReport,
  VerificationStatus
} from '../../shared/verification-types.ts';
import {
  assertIsolatedStagingTree,
  type IsolatedStagingTreeOptions
} from './assert-isolated-staging-tree.ts';
import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { buildPolicyClaimGate, runPolicyGate } from './run-policy-gate.ts';
import { buildRuntimeClaimGate, createSkippedRuntimeLane, runRuntimeVerification } from './run-runtime-verification.ts';
import {
  consumeStagedVerificationProof,
  revalidateStagedVerificationProof,
  type StagedVerificationProof
} from './staged-verification-proof.ts';
import { typecheckProject } from './typecheck-project.ts';
import { validateSlotSecurity } from './validate-slot-security.ts';

interface SuiteModule {
  runSuite?: () => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Claim-based verification summary helpers (Issue #176 Slice 2 migration)
// ---------------------------------------------------------------------------

const PRODUCT_GATE_REVISION = 'product-verification-v1';
const PRODUCT_GATE_OWNER = 'product-verify-project';
const PRODUCT_GATE_REQUIREMENT_KEY = 'product-verification';
const PRODUCT_SUBJECT_REVISION = '0000000000000000000000000000000000000000';
const PRODUCT_INPUT_DIGEST = `sha256:${'0'.repeat(64)}`;
const PRODUCT_OUTPUT_DIGEST = `sha256:${'0'.repeat(64)}`;

function productEnvironment(): VerificationGateEnvironmentV1 {
  return {
    runtime: 'bun',
    os: process.platform,
    arch: process.arch,
    filesystem: null,
    capabilities: [],
    toolchainRevision: 'ci-verification-v19',
    providerRevisions: []
  };
}

function productExecution(exitCode: number): VerificationGateExecutionV1 {
  return {
    argv: [],
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:00:00.000Z',
    durationMs: 0,
    exitCode,
    outputDigest: PRODUCT_OUTPUT_DIGEST,
    failureFingerprint: exitCode === 0 ? null : 'product-failure'
  };
}

function applicabilityForMapping(
  status: VerificationResultStatus,
  reasonCode: VerificationReasonCode
): VerificationApplicability {
  if (reasonCode === 'not-applicable') return 'not-applicable';
  if (status === 'invalidated') return 'unresolved';
  return 'required';
}

function buildProductGateResult(
  gate: ProductVerificationGateKind,
  legacyStatus: VerificationStatus,
  context: ProductVerificationMappingContext
): VerificationGateResultV1 {
  const mapping = mapProductVerificationStatus(legacyStatus, context);
  const binding = projectProductVerificationGateClaim(gate, mapping.status === 'passed');
  const isExecuted = mapping.disposition === 'executed';
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId: binding.gateId,
    gateRevision: PRODUCT_GATE_REVISION,
    owner: PRODUCT_GATE_OWNER,
    requirementKey: PRODUCT_GATE_REQUIREMENT_KEY,
    subjectRevision: PRODUCT_SUBJECT_REVISION,
    inputDigest: PRODUCT_INPUT_DIGEST,
    applicability: applicabilityForMapping(mapping.status, mapping.reasonCode),
    status: mapping.status,
    disposition: mapping.disposition,
    reasonCode: mapping.reasonCode,
    requiredForClaims: binding.requiredForClaims,
    supportedClaims: binding.supportedClaims,
    environment: isExecuted ? productEnvironment() : null,
    execution: isExecuted ? productExecution(mapping.status === 'failed' ? 1 : 0) : null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

function buildFastGateResult(
  fast: FastVerificationLaneReport,
  requestedLane: VerificationLane
): VerificationGateResultV1 {
  const context: ProductVerificationMappingContext = {
    requestedLane,
    lane: 'fast'
  };
  return buildProductGateResult('fast', fast.status, context);
}

/**
 * Build the claim-based verification summary by aggregating lane-level gate
 * results through `CodexDevelopmentAggregateVerificationClaimsV1`. Overall
 * `passed` requires every required claim to be `passed`; skipped lanes no
 * longer silently produce overall `passed`.
 */
export function buildClaimSummary(
  lane: VerificationLane,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  runtimeMode: 'service' | 'full',
  policyReport: PolicyReport
): VerificationClaimSummary {
  const fastGate = buildFastGateResult(fast, lane);
  const runtimeGate = buildRuntimeClaimGate(runtime, lane, runtimeMode, fast.status === 'failed');
  const policyGate = buildPolicyClaimGate(policyReport, lane);
  const gatesByKind: Record<ProductVerificationGateKind, VerificationGateResultV1> = {
    policy: policyGate,
    fast: fastGate,
    runtime: runtimeGate
  };
  const gates = projectProductVerificationGateOrder().map((gate) => gatesByKind[gate]);

  const claims = buildProductVerificationClaimPlan(lane);

  const overall = CodexDevelopmentAggregateVerificationClaimsV1({ claims, gateResults: gates });
  return { overall, gates };
}

/**
 * Build a claim summary for a blocked verification snapshot (drift failure).
 * All gates are not-run with fail-fast-prerequisite-failed; the overall is
 * not-run (mapped to legacy `failed`), never silently passed.
 */
export function buildBlockedClaimSummary(lane: VerificationLane): VerificationClaimSummary {
  const failedReasonCode: VerificationReasonCode = 'fail-fast-prerequisite-failed';

  function buildBlockedGate(gate: ProductVerificationGateKind): VerificationGateResultV1 {
    const binding = projectProductVerificationGateClaim(gate, false);
    return CodexDevelopmentBuildVerificationGateResultV1({
      gateId: binding.gateId,
      gateRevision: PRODUCT_GATE_REVISION,
      owner: PRODUCT_GATE_OWNER,
      requirementKey: PRODUCT_GATE_REQUIREMENT_KEY,
      subjectRevision: PRODUCT_SUBJECT_REVISION,
      inputDigest: PRODUCT_INPUT_DIGEST,
      applicability: 'required',
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: failedReasonCode,
      requiredForClaims: binding.requiredForClaims,
      supportedClaims: binding.supportedClaims,
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: 'Verification blocked by prerequisite drift failure.'
    });
  }

  const fastGate = buildBlockedGate('fast');
  const runtimeGate = buildBlockedGate('runtime');
  const policyGate = buildBlockedGate('policy');
  const gatesByKind: Record<ProductVerificationGateKind, VerificationGateResultV1> = {
    policy: policyGate,
    fast: fastGate,
    runtime: runtimeGate
  };
  const gates = projectProductVerificationGateOrder().map((gate) => gatesByKind[gate]);

  const claims = buildProductVerificationClaimPlan(lane);

  const overall = CodexDevelopmentAggregateVerificationClaimsV1({ claims, gateResults: gates });
  return { overall, gates };
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
    official: {
      policies: [],
      sources: [],
      violations: []
    },
    project: {
      policies: [],
      sources: [],
      violations: []
    },
    merged: {
      policies: []
    },
    violations: []
  };
}

function createSkippedFastLane(): FastVerificationLaneReport {
  return {
    status: 'skipped',
    build: {
      status: 'skipped'
    },
    unit: {
      status: 'skipped',
      passed: []
    },
    acceptance: {
      status: 'skipped',
      passed: [],
      failed: []
    },
    policy: {
      status: 'skipped',
      violations: []
    },
    policyReport: createSkippedPolicyReport(),
    logs: {
      stdout: '',
      stderr: ''
    }
  };
}

async function listSuiteFiles(rootDir: string, suffix: string): Promise<string[]> {
  return (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => relativePosixPath(rootDir, file));
}

async function runSuiteFiles(rootDir: string, suffix: string): Promise<string[]> {
  const files = (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => left.localeCompare(right));
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
): Promise<{
  lane: FastVerificationLaneReport;
  failure: unknown | null;
}> {
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

  const policyReport = await runPolicyGate(workspaceRoot);
  lane.policyReport = policyReport;
  lane.policy = {
    status: policyReport.status,
    violations: policyReport.violations
  };
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
  const stdout = [fast.logs.stdout, runtime.logs.stdout].filter(Boolean).join('\n');
  const stderr = [fast.logs.stderr, runtime.logs.stderr].filter(Boolean).join('\n');
  return { stdout, stderr };
}

function summarizeReport(
  lane: VerificationLane,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  runtimeMode: 'service' | 'full',
  policyReport: PolicyReport
): VerificationReport['summary'] {
  const claimSummary = buildClaimSummary(lane, fast, runtime, runtimeMode, policyReport);
  // Legacy `status` derives from the unified overall status: only `passed`
  // maps to `passed`; every other unified status (failed/not-run/unsupported/
  // invalidated) maps to `failed` so the legacy contract never reports green
  // when the claim aggregator did not pass.
  const status: 'passed' | 'failed' = claimSummary.overall.overallStatus === 'passed'
    ? 'passed'
    : 'failed';

  const failedLanes: Array<'fast' | 'runtime'> = [];
  if ((lane === 'fast' || lane === 'all') && fast.status === 'failed') {
    failedLanes.push('fast');
  }
  if (runtime.status === 'failed') {
    failedLanes.push('runtime');
  }

  return {
    status,
    requestedLane: lane,
    failedLanes,
    claimSummary
  };
}

function updateVerifyPassState(lock: LockFile, report: VerificationReport): void {
  if (report.summary.requestedLane === 'all') {
    lock.passStatus.verify = report.summary.status === 'passed' ? 'succeeded' : 'failed';
    return;
  }

  lock.passStatus.verify = report.summary.status === 'failed' ? 'failed' : 'pending';
}

function updateVerifiedSlotTasks(lock: LockFile, report: VerificationReport): void {
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    return;
  }

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
    'runtimeReport' | 'policyReport' | 'acceptanceCoverage'
  >
): Promise<void> {
  const [policyReport, acceptanceCoverage] = await Promise.all([
    runPolicyGate(workspaceRoot),
    buildAcceptanceCoverage(workspaceRoot, lock, artifacts.runtimeReport)
  ]);
  if (JSON.stringify(policyReport) !== JSON.stringify(artifacts.policyReport) ||
    JSON.stringify(acceptanceCoverage) !== JSON.stringify(artifacts.acceptanceCoverage)) {
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
  const {
    acceptanceCoveragePath,
    lockPath,
    policyReportPath,
    runtimeReportPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);

  assertPassStatus(lock, 'adapt', 'succeeded', new CompilerError('VERIFY-BLOCKED-001', 'adapt must succeed before verify'));

  await emitVerifyBoundary(options, 'verify-preflight');
  await checkProjectBeforeVerify(workspaceRoot);
  await validateSlotSecurity(workspaceRoot, lock);
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
    await Promise.all([
      writeJson(verificationReportPath, artifacts.verificationReport, options.beforeCommit),
      writeJson(runtimeReportPath, artifacts.runtimeReport, options.beforeCommit),
      writeJson(policyReportPath, artifacts.policyReport, options.beforeCommit),
      writeJson(acceptanceCoveragePath, artifacts.acceptanceCoverage, options.beforeCommit),
      writeJson(lockPath, lock, options.beforeCommit)
    ]);
    await revalidateStagedVerificationProof(
      projectRoot,
      lock,
      options.stagedVerificationProof
    );
    await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
    await options.beforeCommit?.();
    return artifacts.verificationReport;
  }

  let fastResult: Awaited<ReturnType<typeof runFastVerification>>;
  if (lane === 'runtime') {
    fastResult = { lane: createSkippedFastLane(), failure: null };
  } else {
    await emitVerifyBoundary(options, 'verify-fast');
    fastResult = await runFastVerification(workspaceRoot, projectRoot, options.isolated === true);
  }
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
  const summary = summarizeReport(lane, fastResult.lane, runtimeLane, runtimeMode, policyReport);
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
  const coverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtimeLane);

  ensureGeneratedPaths(lock);
  updateVerifyPassState(lock, report);
  updateVerifiedSlotTasks(lock, report);

  if (summary.status === 'passed') {
    await emitVerifyBoundary(options, 'verify-artifact-publish');
  }
  await options.beforeCommit?.();
  await Promise.all([
    writeJson(verificationReportPath, report, options.beforeCommit),
    writeJson(runtimeReportPath, runtimeLane, options.beforeCommit),
    writeJson(policyReportPath, policyReport, options.beforeCommit),
    writeJson(acceptanceCoveragePath, coverage, options.beforeCommit),
    writeJson(lockPath, lock, options.beforeCommit)
  ]);

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
    console.error('VERIFY-ACCEPTANCE-003 full report:', JSON.stringify(report, null, 2));
    throw new CompilerError('VERIFY-ACCEPTANCE-003', 'Project verification failed', report);
  }

  return report;
}
