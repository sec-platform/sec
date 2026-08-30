import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LockFile } from '../../src/compiler/contract.ts';
import { readReviewGovernanceReports } from '../../src/compiler/emit/read-review-governance-reports.ts';
import {
  applyRepairPlan,
  buildRepairPlan,
  writeRepairPlan
} from '../../src/compiler/repair/build-repair-plan.ts';
import { parseRepairPlanJson, REPAIR_PLAN_FORMAT_VERSION, type RepairPlan } from '../../src/semantic/repair/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { readJson, writeJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { buildCustomerNormalizerLock, buildCustomerNormalizerPlan } from '../helpers/repair-fixtures.ts';
import { buildPassingReviewReport } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

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
    sourcePath: 'catalog/policies/official/policy.spec.yaml'
  },
  {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/installed/entity/customer-service.ts'],
    message: 'A policy issue.',
    sourceScope: 'official',
    sourcePath: 'catalog/policies/official/policy.spec.yaml'
  },
  {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/installed/entity/customer-service.ts'],
    message: 'A policy issue.',
    sourceScope: 'official',
    sourcePath: 'catalog/policies/official/policy.spec.yaml'
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
      formatVersion: REPAIR_PLAN_FORMAT_VERSION,
      status: 'skipped',
      sourceVerificationStatus: 'passed',
      requiresVerification: false,
      tasks: []
    };
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await writeJson(lockPath, persistedLockInput);

    await expect(writeRepairPlan(
      workspaceRoot,
      { ...repairPlan, formatVersion: 'future' } as unknown as RepairPlan,
      persistedLockInput
    )).rejects.toThrow();
    await expect(fs.access(repairPlanPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await writeRepairPlan(workspaceRoot, repairPlan, persistedLockInput);

    const persistedRepairPlan = await readJson<RepairPlan>(repairPlanPath);
    const persistedLock = await readJson<LockFile>(lockPath);
    expect(persistedRepairPlan).toEqual(repairPlan);
    expect(persistedLock.generatedPaths).toHaveLength(2);
    expect(readReviewGovernanceReports(workspaceRoot).repairPlan).toEqual(repairPlan);

    const duplicateStatusJson = JSON.stringify(repairPlan).replace(
      '"status":"skipped"',
      '"status":"skipped","status":"skipped"'
    );
    await fs.writeFile(repairPlanPath, duplicateStatusJson, 'utf8');
    expect(() => readReviewGovernanceReports(workspaceRoot)).toThrow(/duplicate key/iu);
  });
});

test('RepairPlan parser rejects ambiguous JSON and unbound status/provenance combinations', () => {
  const skippedPlan: RepairPlan = {
    formatVersion: REPAIR_PLAN_FORMAT_VERSION,
    status: 'skipped',
    sourceVerificationStatus: 'passed',
    requiresVerification: false,
    tasks: []
  };

  const duplicateStatusJson = JSON.stringify(skippedPlan).replace(
    '"status":"skipped"',
    '"status":"skipped","status":"skipped"'
  );
  expect(() => parseRepairPlanJson(duplicateStatusJson)).toThrow(/duplicate key/iu);
  expect(() => parseRepairPlanJson(JSON.stringify({ ...skippedPlan, unknownField: true }))).toThrow();
  expect(() => parseRepairPlanJson(JSON.stringify({ ...skippedPlan, status: 'future' }))).toThrow();
  expect(() => parseRepairPlanJson(JSON.stringify({
    ...skippedPlan,
    sourceVerificationStatus: 'failed'
  }))).toThrow();

  const pendingPlan = buildRepairPlan(plan, lock, failedReport);
  expect(() => parseRepairPlanJson(JSON.stringify({
    ...pendingPlan,
    sourceVerificationStatus: 'passed'
  }))).toThrow();
  expect(() => parseRepairPlanJson(JSON.stringify({
    ...pendingPlan,
    status: 'applied',
    requiresVerification: false
  }))).toThrow();
});

test('applyRepairPlan checks the commit fence immediately before each live file write', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const repairLock = structuredClone(lock);
    const repairPlan = buildRepairPlan(plan, repairLock, failedReport);
    expect(repairPlan.status).toBe('pending');
    expect(repairPlan.tasks).toHaveLength(1);
    const targetPath = path.join(workspaceRoot, ...repairPlan.tasks[0].targetFile.split('/'));
    const leaseLost = new Error('injected lease loss');
    let fenceChecks = 0;

    await expect(applyRepairPlan(
      workspaceRoot,
      plan,
      repairLock,
      repairPlan,
      async () => {
        fenceChecks += 1;
        if (fenceChecks === 2) throw leaseLost;
      }
    )).rejects.toBe(leaseLost);

    expect(fenceChecks).toBe(2);
    await expect(fs.readFile(targetPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('repair plan skips when verification passed', () => {
  const report = buildPassingReviewReport({
    summary: {
      requestedLane: 'all'
    }
  });

  expect(buildRepairPlan(plan, lock, report)).toEqual({
    formatVersion: REPAIR_PLAN_FORMAT_VERSION,
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

  expect(repairPlan).toMatchObject({
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [
      expect.objectContaining({
        taskId: 'repair_slot_customer_normalizer',
        taskKind: 'repair-slot',
        category: 'slot-rewrite',
        phase: 'repair',
        sourceSlotId: 'customer_normalizer',
        targetBlock: 'entity/customer-basic',
        targetFile: 'custom/customer_normalizer.ts'
      })
    ],
    blockers: [
      expect.objectContaining({
        blockerId: 'repair_blocker_1_all_summary',
        boundary: 'unknown',
        failurePoints: [
          {
            lane: 'all',
            kind: 'summary',
            issueType: 'unknown',
            repairable: false,
            artifactPath: CI_ARTIFACT_FILES.verificationReport,
            message: 'Verification failed without lane-specific failure details'
          }
        ]
      })
    ]
  });
  expect(repairPlan.tasks).toHaveLength(1);
});
