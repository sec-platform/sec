import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import type { RepairPlan } from '../../platform/shared/types.ts';

type RepairFailurePoint = RepairPlan['tasks'][number]['failurePoints'][number];
type RepairTask = RepairPlan['tasks'][number];
type RepairBlocker = NonNullable<RepairPlan['blockers']>[number];

export function buildRepairFailurePoint(options: Partial<RepairFailurePoint> = {}): RepairFailurePoint {
  return {
    lane: 'fast',
    kind: 'unit',
    issueType: 'slot',
    repairable: true,
    artifactPath: 'tests/unit',
    message: 'Unit verification failed',
    targetIds: ['zeta.test.ts'],
    ...options
  };
}

export function buildRepairTask(options: Partial<RepairTask> = {}): RepairTask {
  const sourceSlotId = options.sourceSlotId ?? 'customer_normalizer';
  const targetFile = options.targetFile ?? `custom/${sourceSlotId}.ts`;
  return {
    taskId: options.taskId ?? `repair_slot_${sourceSlotId}`,
    taskKind: 'repair-slot',
    phase: 'repair',
    sourceSlotId,
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
    reason: 'policy failure is outside automatic slot repair: tenant scope missing',
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
