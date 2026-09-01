import type { RepairPlan } from '../../src/semantic/repair/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';

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
