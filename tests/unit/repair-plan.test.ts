import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildRepairPlan, writeRepairPlan } from '../../platform/compiler/repair/build-repair-plan.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { LockFile, RepairPlan, VerificationReport } from '../../platform/shared/types.ts';
import { buildCustomerNormalizerLock, buildCustomerNormalizerPlan } from '../helpers/repair-fixtures.ts';
import { buildPassingReviewReport } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

const plan = buildCustomerNormalizerPlan();
const lock = buildCustomerNormalizerLock({
  slotStatus: 'filled',
  passStatus: { repair: 'skipped' }
});

const policyViolations: VerificationReport['policy']['violations'] = [
  {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/installed/entity/customer-service.ts'],
    message: 'Z policy issue.',
    sourceScope: 'official',
    sourcePath: 'platform/policies/official/policy.spec.yaml'
  },
  {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/installed/entity/customer-service.ts'],
    message: 'A policy issue.',
    sourceScope: 'official',
    sourcePath: 'platform/policies/official/policy.spec.yaml'
  },
  {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/installed/entity/customer-service.ts'],
    message: 'A policy issue.',
    sourceScope: 'official',
    sourcePath: 'platform/policies/official/policy.spec.yaml'
  }
];

const failedReport: VerificationReport = buildPassingReviewReport({
  unit: { status: 'failed', passed: [] },
  acceptance: { status: 'failed', passed: [], failed: ['customer-flow.test.ts'] },
  policy: { status: 'failed', violations: policyViolations },
  fast: {
    status: 'failed',
    unit: { status: 'failed', passed: [] },
    acceptance: { status: 'failed', passed: [], failed: ['customer-flow.test.ts'] },
    policy: { status: 'failed', violations: [] },
    logs: { stdout: 'typecheck:passed', stderr: 'unit assertion failed' }
  },
  summary: {
    status: 'failed',
    failedLanes: ['fast']
  },
  logs: { stdout: 'typecheck:passed', stderr: 'unit assertion failed' }
});

test('writeRepairPlan persists generated path in a missing generated directory', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { lockPath, repairPlanPath } = getWorkspacePaths(workspaceRoot);
    const persistedLockInput: LockFile = {
      ...lock,
      generatedPaths: []
    };
    const repairPlan: RepairPlan = {
      formatVersion: '1',
      status: 'skipped',
      sourceVerificationStatus: 'passed',
      requiresVerification: false,
      tasks: []
    };
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await writeJson(lockPath, persistedLockInput);

    await writeRepairPlan(workspaceRoot, repairPlan, persistedLockInput);

    const persistedRepairPlan = await readJson<RepairPlan>(repairPlanPath);
    const persistedLock = await readJson<LockFile>(lockPath);
    expect(persistedRepairPlan).toEqual(repairPlan);
    expect(persistedLock.generatedPaths).toHaveLength(2);
  });
});

test('repair plan skips when verification passed', () => {
  const report = buildPassingReviewReport({
    summary: {
      requestedLane: 'all'
    }
  });

  expect(buildRepairPlan(plan, lock, report)).toEqual({
    formatVersion: '1',
    status: 'skipped',
    sourceVerificationStatus: 'passed',
    requiresVerification: false,
    tasks: []
  });
});

test('repair plan includes structured failure points for slot and spec failures', () => {
  const repairPlan = buildRepairPlan(plan, lock, failedReport);

  expect(repairPlan.status).toBe('pending');
  expect(repairPlan.requiresVerification).toBe(false);
  expect(repairPlan.tasks).toHaveLength(1);
  expect(repairPlan.tasks[0].category).toBe('slot-rewrite');
  expect(repairPlan.tasks[0].failureSummary).toBe('build=passed; unit=failed; acceptance=failed; policy=failed; runtime=skipped');
  expect(repairPlan.tasks[0].review).toEqual({
    allowedPathCount: 1,
    requiredSymbolCount: 1,
    forbiddenOperationCount: 4,
    testCount: 2,
    failureTargetCount: 3,
    sourceSlotStatus: 'filled',
    sourceWritableZones: ['custom/customer_normalizer.ts'],
    sourceProvenanceHints: {
      generator: 'mock-local-synthesizer',
      verifiedBy: []
    },
    writeBounds: ['custom/customer_normalizer.ts'],
    requiredSymbols: ['normalizeCustomerInput'],
    forbiddenOperations: [
      'modify_other_files',
      'add_dependencies',
      'access_database',
      'change_exports'
    ],
    testsToPass: [
      'tests/unit/customer-normalizer.test.ts',
      'tests/acceptance/customer-flow.test.ts'
    ],
    failureTargets: [
      'customer-flow.test.ts',
      'src/installed/entity/customer-service.ts',
      'tenant-scope-required'
    ]
  });
  expect(repairPlan.tasks[0].failurePoints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        lane: 'fast',
        kind: 'unit',
        issueType: 'slot',
        repairable: true,
        artifactPath: 'tests/unit'
      }),
      expect.objectContaining({
        lane: 'fast',
        kind: 'acceptance',
        issueType: 'slot',
        repairable: true,
        artifactPath: 'tests/acceptance',
        targetIds: ['customer-flow.test.ts']
      }),
      expect.objectContaining({
        lane: 'fast',
        kind: 'policy',
        issueType: 'spec',
        repairable: false,
        artifactPath: CI_ARTIFACT_FILES.policyReport,
        message: 'A policy issue.; Z policy issue.',
        targetIds: ['src/installed/entity/customer-service.ts', 'tenant-scope-required']
      })
    ])
  );
  expect(repairPlan.blockers).toHaveLength(1);
});

test('repair plan records blockers when no slot task is repairable', () => {
  const lockWithoutSlots: LockFile = {
    ...lock,
    slotTasks: []
  };

  const repairPlan = buildRepairPlan(plan, lockWithoutSlots, failedReport);

  expect(repairPlan.status).toBe('blocked');
  expect(repairPlan.tasks).toHaveLength(0);
  expect(repairPlan.blockers).toHaveLength(2);
});

test('repair plan falls back when failed summary has no lane details', () => {
  const report = buildPassingReviewReport({
    summary: {
      status: 'failed',
      requestedLane: 'all',
      failedLanes: []
    }
  });

  const repairPlan = buildRepairPlan(plan, lock, report);

  expect(repairPlan.tasks[0].failurePoints).toHaveLength(1);
});
