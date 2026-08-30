import type {
  LockFile,
  PlanFile
} from '../../src/compiler/contract.ts';
import { PASS_STATUS_PENDING } from '../../src/compiler/pipeline/defaults.ts';
import type { RepairPlan } from '../../src/semantic/repair/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { buildOfficialResolvedBlock, buildSingleTenantLockApp } from './lock-fixtures.ts';
import { buildSingleTenantPlanApp } from './plan-fixtures.ts';

type CustomerNormalizerPlanOptions = {
  slotDescription?: string;
};

type CustomerNormalizerLockOptions = {
  slotStatus?: LockFile['slotTasks'][number]['status'];
  passStatus?: Partial<LockFile['passStatus']>;
};

type RepairFailurePoint = RepairPlan['tasks'][number]['failurePoints'][number];
type RepairTask = RepairPlan['tasks'][number];
type RepairBlocker = NonNullable<RepairPlan['blockers']>[number];

export function buildCustomerNormalizerPlan(options: CustomerNormalizerPlanOptions = {}): PlanFile {
  return {
    app: buildSingleTenantPlanApp(),
    registry: { sources: [] },
    blocks: [{ id: 'entity/customer-basic', version: '0.1.0' }],
    slots: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        description: options.slotDescription ?? 'Normalize customer input.'
      }
    ],
    acceptance: [{ id: 'user_can_create_customer' }]
  };
}

export function buildCustomerNormalizerLock(options: CustomerNormalizerLockOptions = {}): LockFile {
  return {
    formatVersion: '1',
    app: buildSingleTenantLockApp(),
    resolvedBlocks: [
      buildOfficialResolvedBlock({
        id: 'entity/customer-basic',
        installOrder: 1,
        manifestPath: 'block.manifest.yaml'
      })
    ],
    resolvedCapabilities: ['customer/write'],
    installPlan: [],
    slotTasks: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        kind: 'adapter',
        status: options.slotStatus ?? 'failed',
        writableZones: ['custom/customer_normalizer.ts'],
        provenanceHints: {
          generator: 'mock-local-synthesizer',
          verifiedBy: []
        }
      }
    ],
    generatedPaths: [],
    acceptancePlan: ['user_can_create_customer'],
    passStatus: {
      ...PASS_STATUS_PENDING,
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'failed',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending',
      ...options.passStatus
    }
  };
}

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
