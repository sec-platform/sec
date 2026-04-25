import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildReviewSummary } from '../platform/compiler/emit/write-review-summary.ts';
import { writeJson } from '../platform/shared/fs.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import type { AcceptanceCoverageReport, LockFile, ProvenanceFile, RepairPlan, VerificationReport } from '../platform/shared/types.ts';

test('review summary surfaces pending repair tasks', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-review-repair-'));
  try {
    const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs-ts-prisma-sqlite',
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'failed',
        repair: 'succeeded',
        lock: 'pending',
        emit: 'pending'
      }
    };
    const provenance: ProvenanceFile = {
      formatVersion: '1',
      artifacts: []
    };
    const report: VerificationReport = {
      build: { status: 'passed' },
      unit: { status: 'failed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      fast: {
        status: 'failed',
        build: { status: 'passed' },
        unit: { status: 'failed', passed: [] },
        acceptance: { status: 'passed', passed: [], failed: [] },
        policy: { status: 'passed', violations: [] },
        logs: { stdout: '', stderr: '' }
      },
      runtime: {
        status: 'skipped',
        build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
        unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
        acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
        logs: { stdout: '', stderr: '' }
      },
      summary: {
        status: 'failed',
        requestedLane: 'fast',
        failedLanes: ['fast']
      },
      logs: { stdout: '', stderr: '' }
    };
    const coverage: AcceptanceCoverageReport = {
      formatVersion: '1',
      status: 'failed',
      acceptancePassed: [],
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    };
    const repairPlan: RepairPlan = {
      formatVersion: '1',
      status: 'pending',
      sourceVerificationStatus: 'failed',
      tasks: [
        {
          taskId: 'repair_slot_customer_normalizer',
          taskKind: 'repair-slot',
          phase: 'repair',
          sourceSlotId: 'customer_normalizer',
          targetBlock: 'entity/customer-basic',
          targetFile: 'custom/customer_normalizer.ts',
          allowedPaths: ['custom/customer_normalizer.ts'],
          requiredSymbols: ['normalizeCustomerInput'],
          forbiddenOperations: [],
          testsToPass: ['tests/unit/customer-normalizer.test.ts'],
          failureSummary: 'build=passed; unit=failed; acceptance=passed; policy=passed; runtime=skipped',
          failurePoints: [
            {
              lane: 'fast',
              kind: 'unit',
              issueType: 'slot',
              repairable: true,
              artifactPath: 'tests/unit',
              message: 'Unit verification failed'
            }
          ]
        }
      ]
    };
    await writeJson(repairPlanPath, repairPlan);

    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(summary.conflictHints).toEqual(
      expect.arrayContaining([
        {
          kind: 'repair-plan-present',
          relatedId: 'repair_slot_customer_normalizer',
          message: 'Repair task pending: repair_slot_customer_normalizer -> custom/customer_normalizer.ts'
        }
      ])
    );

    repairPlan.status = 'applied';
    await writeJson(repairPlanPath, repairPlan);

    const appliedSummary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(appliedSummary.conflictHints).toEqual(
      expect.arrayContaining([
        {
          kind: 'repair-plan-present',
          relatedId: 'repair_slot_customer_normalizer',
          message: 'Repair task applied, verify pending: repair_slot_customer_normalizer -> custom/customer_normalizer.ts'
        }
      ])
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
