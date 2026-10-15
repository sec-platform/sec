import { buildAcceptanceCoverageReport } from '../../src/assurance/acceptance/build-coverage.ts';
import type { VerificationArtifactPublicationArtifacts } from '../../src/assurance/verification/artifact/publication.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  buildProductVerificationReport,
  createSkippedPolicyReport,
  createSkippedRuntimeLane,
  productVerificationSubjectRevision
} from '../../src/assurance/verification/project/report.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import type { RepairPlan } from '../../src/semantics/repair/types.ts';
import { buildReviewLock } from './review-fixtures.ts';
import { buildSemanticViewFixture } from './semantic-view-fixtures.ts';
import { productVerificationObservationsFixture } from './verification-fixtures.ts';

type RepairFailurePoint = RepairPlan['tasks'][number]['failurePoints'][number];
type RepairTask = RepairPlan['tasks'][number];
type RepairBlocker = NonNullable<RepairPlan['blockers']>[number];

export function buildRepairFailurePoint(options: Partial<RepairFailurePoint> = {}): RepairFailurePoint {
  return {
    lane: 'fast',
    kind: 'unit',
    issueType: 'file',
    repairable: true,
    artifactPath: 'tests/unit',
    message: 'Unit verification failed',
    targetIds: ['zeta.test.ts'],
    ...options
  };
}

export function buildRepairTask(options: Partial<RepairTask> = {}): RepairTask {
  const targetFile = options.targetFile ?? 'src/installed/entity/customer-service.ts';
  return {
    taskId: options.taskId ?? 'repair_file_customer_service',
    taskKind: 'repair-file',
    phase: 'repair',
    targetBlock: 'entity/customer-basic',
    targetFile,
    allowedPaths: [targetFile],
    requiredSymbols: ['normalizeCustomerInput'],
    forbiddenOperations: [],
    testsToPass: [],
    failureSummary: 'build=passed; unit=failed; acceptance=passed; policy=passed; runtime=skipped',
    failurePoints: [buildRepairFailurePoint()],
    ...options
  };
}

export function buildRepairBlocker(options: Partial<RepairBlocker> = {}): RepairBlocker {
  return {
    blockerId: 'repair_blocker_policy',
    boundary: 'spec',
    reason: 'policy failure is outside automatic file repair: tenant scope missing',
    decisionRequired: 'Decide whether to change policy/spec, installed source, or project plan before repair can proceed.',
    failurePoints: [
      buildRepairFailurePoint({
        kind: 'policy',
        issueType: 'spec',
        repairable: false,
        artifactPath: CI_ARTIFACT_FILES.policyReport,
        message: 'tenant scope missing',
        targetIds: ['tenant-scope-required']
      })
    ],
    ...options
  };
}

export function buildRepairPlanArtifact(options: Partial<RepairPlan> = {}): RepairPlan {
  return {
    formatVersion: '1',
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [],
    ...options
  };
}

/** Synthetic observations for admission/publication tests, never execution evidence. */
export function buildRepairVerificationFixture(
  lane: 'fast' | 'all' = 'all',
  failed = true,
  verify: LockFile['passStatus']['verify'] = failed ? 'failed' : lane === 'all' ? 'succeeded' : 'pending'
): { lock: LockFile; artifacts: VerificationArtifactPublicationArtifacts } {
  const lock = buildReviewLock({
    semanticLoweringTasks: [],
    semanticViews: buildSemanticViewFixture(),
    resolvedBlocks: [{ id: 'entity/customer-basic', version: '0.1.0', kind: 'capability', installOrder: 1,
      manifestPath: 'customer.yaml', registrySourceId: 'fixture', registryKind: 'private', registryLocation: 'workspace', registryPath: 'customer' }],
    acceptancePlan: ['user_can_create_customer'],
    acceptanceSources: [{ declaringBlockId: 'entity/customer-basic', acceptance: { id: 'user_can_create_customer', source: { tests: ['tests/acceptance/customer-flow.test.ts'] } } }],
    installPlan: [{ stepId: 'customer:test', blockId: 'entity/customer-basic', registrySourceId: 'fixture', registryKind: 'private',
      registryLocation: 'workspace', registryPath: 'customer', sourceRoot: 'files', action: 'copy', from: 'customer.test.ts', to: 'tests/acceptance/customer-flow.test.ts' }],
    passStatus: { verify }
  });
  const policyReport = createSkippedPolicyReport();
  const fast: VerificationArtifactPublicationArtifacts['verificationReport']['fast'] = {
    status: failed ? 'failed' : 'passed',
    build: { status: 'passed' },
    unit: { status: failed ? 'failed' : 'passed', passed: failed ? [] : ['independent-unit.test.ts'] },
    acceptance: { status: 'passed', passed: failed ? [] : ['tests/acceptance/customer-flow.test.ts'], failed: [] },
    policy: { status: 'skipped', violations: [] },
    policyReport,
    logs: { stdout: '', stderr: failed ? 'independent unit failure' : '' }
  };
  const runtime = createSkippedRuntimeLane();
  const acceptanceCoverage: VerificationArtifactPublicationArtifacts['acceptanceCoverage'] = {
    formatVersion: '2',
    status: 'skipped',
    source: { resolvedBlockIds: [], acceptancePlan: [], declarations: [], tests: [] },
    acceptancePassed: [],
    blocks: [],
    uncoveredBlocks: []
  };
  if (lane === 'all' && !failed) {
    runtime.status = 'passed';
    runtime.unit = {
      status: 'passed',
      passed: ['tests/unit/independent-unit.test.ts'],
      failed: [],
      command: 'synthetic unit observation'
    };
    runtime.acceptance = {
      status: 'passed',
      passed: ['tests/acceptance/customer-flow.test.ts'],
      failed: [],
      command: 'synthetic acceptance observation'
    };
    acceptanceCoverage.status = 'passed';
  }
  const runtimeMode = lane === 'all' ? 'full' : 'service';
  Object.assign(acceptanceCoverage, buildAcceptanceCoverageReport({ lock, fast, runtime }));
  const observations = productVerificationObservationsFixture(lane, runtimeMode, productVerificationSubjectRevision(lock));
  if (failed) {
    observations.fast.execution!.exitCode = 1;
    observations.fast.execution!.failureFingerprint = 'independent-unit-failure';
  }
  const verificationReport = buildProductVerificationReport({
    lane,
    fast,
    runtime,
    runtimeMode,
    policyReport,
    acceptanceCoverage,
    observations
  });
  return {
    lock,
    artifacts: { verificationReport, runtimeReport: runtime, policyReport, acceptanceCoverage }
  };
}
