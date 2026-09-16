import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  LOCK_FILE_FORMAT_VERSION,
  type LockFile
} from '../../src/compiler/contract.ts';
import { readReviewGovernanceReports } from '../../src/compiler/emit/read-review-governance-reports.ts';
import {
  buildRepairPlan,
  writeRepairPlan
} from '../../src/compiler/repair/build-repair-plan.ts';
import {
  parseRepairPlanJson,
  REPAIR_PLAN_FORMAT_VERSION,
  type RepairPlan
} from '../../src/semantic/repair/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { readJson, writeJson } from '../../src/workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { buildPassingReviewReport } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function lock(): LockFile {
  return {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    app: {
      id: 'repair-test',
      name: 'Repair test',
      stack: 'node-ts-prisma-postgres',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      verify: 'failed',
      repair: 'skipped',
      lock: 'pending',
      emit: 'pending'
    }
  };
}

const skippedPlan: RepairPlan = {
  formatVersion: REPAIR_PLAN_FORMAT_VERSION,
  status: 'skipped',
  sourceVerificationStatus: 'passed',
  requiresVerification: false,
  tasks: []
};

test('RepairPlan writer validates and reads back the canonical durable artifact', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const repairLock = lock();
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.mkdir(path.dirname(provenancePath), { recursive: true });
    await writeJson(lockPath, repairLock);

    await expect(writeRepairPlan(
      workspaceRoot,
      { ...skippedPlan, formatVersion: 'future' } as unknown as RepairPlan,
      repairLock
    )).rejects.toThrow();
    await expect(fs.access(repairPlanPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await writeRepairPlan(workspaceRoot, skippedPlan, repairLock);

    expect(await readJson<RepairPlan>(repairPlanPath)).toEqual(skippedPlan);
    expect((await readJson<LockFile>(lockPath)).generatedPaths).toEqual([
      CI_ARTIFACT_FILES.provenance,
      CI_ARTIFACT_FILES.repairPlan
    ]);
    expect(readReviewGovernanceReports(workspaceRoot).repairPlan).toEqual(skippedPlan);
  }, 'repair-plan-readback-');
});

test('RepairPlan parser rejects ambiguous or inconsistent durable input', () => {
  const duplicateStatusJson = JSON.stringify(skippedPlan).replace(
    '"status":"skipped"',
    '"status":"skipped","status":"skipped"'
  );
  expect(() => parseRepairPlanJson(duplicateStatusJson)).toThrow(/duplicate key/iu);
  expect(() => parseRepairPlanJson(JSON.stringify({ ...skippedPlan, unknownField: true }))).toThrow();
  expect(() => parseRepairPlanJson(JSON.stringify({
    ...skippedPlan,
    sourceVerificationStatus: 'failed'
  }))).toThrow();
});

test('compiler repair reports failed verification as owner-classified blockers without synthesizing source', () => {
  const failedReport = buildPassingReviewReport({
    unit: { status: 'failed', passed: [] },
    fast: {
      status: 'failed',
      unit: { status: 'failed', passed: [] },
      logs: { stdout: '', stderr: 'unit assertion failed' }
    },
    summary: { status: 'failed', failedLanes: ['fast'] },
    logs: { stdout: '', stderr: 'unit assertion failed' }
  });

  const plan = buildRepairPlan(failedReport);
  expect(plan).toMatchObject({
    status: 'blocked',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [],
    blockers: [
      expect.objectContaining({
        blockerId: 'repair_blocker_1_fast_unit',
        boundary: 'unknown',
        failurePoints: [
          expect.objectContaining({
            lane: 'fast',
            kind: 'unit',
            repairable: false,
            message: 'unit assertion failed'
          })
        ]
      })
    ]
  });
});

test('compiler repair skips when verification passed', () => {
  expect(buildRepairPlan(buildPassingReviewReport())).toEqual(skippedPlan);
});
