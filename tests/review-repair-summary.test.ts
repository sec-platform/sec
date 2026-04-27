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
      requiresVerification: false,
      tasks: [
        {
          taskId: 'repair_slot_zeta',
          taskKind: 'repair-slot',
          category: 'slot-rewrite',
          phase: 'repair',
          sourceSlotId: 'zeta',
          targetBlock: 'entity/customer-basic',
          targetFile: 'custom/zeta.ts',
          allowedPaths: ['custom/zeta.ts'],
          requiredSymbols: ['zeta'],
          forbiddenOperations: [],
          testsToPass: [],
          failureSummary: 'build=passed; unit=failed; acceptance=passed; policy=passed; runtime=skipped',
          preview: {
            beforeLines: 1,
            afterLines: 3,
            addedLines: 3,
            removedLines: 1,
            changed: true
          },
          failurePoints: [
            {
              lane: 'fast',
              kind: 'unit',
              issueType: 'slot',
              repairable: true,
              artifactPath: 'tests/unit',
              message: 'Unit verification failed',
              targetIds: ['zeta.test.ts']
            }
          ]
        },
        {
          taskId: 'repair_slot_alpha',
          taskKind: 'repair-slot',
          phase: 'repair',
          sourceSlotId: 'alpha',
          targetBlock: 'entity/customer-basic',
          targetFile: 'custom/alpha.ts',
          allowedPaths: ['custom/alpha.ts'],
          requiredSymbols: ['alpha'],
          forbiddenOperations: [],
          testsToPass: [],
          failureSummary: 'build=passed; unit=failed; acceptance=passed; policy=passed; runtime=skipped',
          failurePoints: [
            {
              lane: 'fast',
              kind: 'unit',
              issueType: 'slot',
              repairable: true,
              artifactPath: 'tests/unit',
              message: 'Unit verification failed',
              targetIds: ['zeta.test.ts']
            }
          ]
        }
      ],
      blockers: [
        {
          blockerId: 'repair_blocker_policy',
          boundary: 'spec',
          reason: 'policy failure is outside automatic slot repair: tenant scope missing',
          decisionRequired: 'Decide whether to change policy/spec, installed source, or project plan before repair can proceed.',
          failurePoints: [
            {
              lane: 'fast',
              kind: 'policy',
              issueType: 'spec',
              repairable: false,
              artifactPath: 'generated/policy-report.json',
              message: 'tenant scope missing',
              targetIds: ['tenant-scope-required']
            }
          ]
        }
      ]
    };
    await writeJson(repairPlanPath, repairPlan);

    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(summary.repairSummary).toMatchObject({
      status: 'pending',
      sourceVerificationStatus: 'failed',
      requiresVerification: false,
      taskCount: 2,
      blockerCount: 1,
      previewCount: 1,
      changedPreviewCount: 1,
      failurePointCount: 3,
      failureTaxonomy: {
        laneSummaries: [{ id: 'fast', count: 3 }],
        kindSummaries: [
          { id: 'policy', count: 1 },
          { id: 'unit', count: 2 }
        ],
        issueTypeSummaries: [
          { id: 'slot', count: 2 },
          { id: 'spec', count: 1 }
        ],
        repairabilitySummaries: [
          { id: 'blocked', count: 1 },
          { id: 'repairable', count: 2 }
        ]
      },
      taskCategorySummaries: [{ id: 'slot-rewrite', count: 2 }],
      targetFiles: ['custom/alpha.ts', 'custom/zeta.ts']
    });
    expect(summary.repairSummary?.taskSummaries).toEqual([
      {
        taskId: 'repair_slot_alpha',
        category: 'slot-rewrite',
        sourceSlotId: 'alpha',
        targetBlock: 'entity/customer-basic',
        targetFile: 'custom/alpha.ts',
        previewStatus: 'missing',
        addedLines: 0,
        removedLines: 0,
        failurePointCount: 1,
        targetIds: ['zeta.test.ts']
      },
      {
        taskId: 'repair_slot_zeta',
        category: 'slot-rewrite',
        sourceSlotId: 'zeta',
        targetBlock: 'entity/customer-basic',
        targetFile: 'custom/zeta.ts',
        previewStatus: 'changed',
        addedLines: 3,
        removedLines: 1,
        failurePointCount: 1,
        targetIds: ['zeta.test.ts']
      }
    ]);
    expect(summary.repairSummary?.blockerSummaries).toEqual([
      {
        blockerId: 'repair_blocker_policy',
        boundary: 'spec',
        reason: 'policy failure is outside automatic slot repair: tenant scope missing',
        decisionRequired: 'Decide whether to change policy/spec, installed source, or project plan before repair can proceed.',
        failurePointCount: 1
      }
    ]);
    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'repair',
      artifactPath: 'generated/repair-plan.json',
      message: 'Repair blocked at spec: policy failure is outside automatic slot repair: tenant scope missing'
    });
    expect(summary.conflictHints).toEqual([
      {
        kind: 'repair-blocked',
        relatedId: 'repair_blocker_policy',
        message:
          'Repair blocked: policy failure is outside automatic slot repair: tenant scope missing; decision Decide whether to change policy/spec, installed source, or project plan before repair can proceed.'
      },
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_slot_alpha',
        message: 'Repair task pending: repair_slot_alpha -> custom/alpha.ts; targets zeta.test.ts'
      },
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_slot_zeta',
        message: 'Repair task pending: repair_slot_zeta -> custom/zeta.ts; preview changed +3/-1; targets zeta.test.ts'
      }
    ]);

    repairPlan.status = 'applied';
    repairPlan.requiresVerification = true;
    await writeJson(repairPlanPath, repairPlan);

    const appliedSummary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(appliedSummary.repairSummary).toMatchObject({
      status: 'applied',
      requiresVerification: true,
      taskCount: 2,
      blockerCount: 1,
      changedPreviewCount: 1
    });
    expect(appliedSummary.conflictHints).toEqual([
      {
        kind: 'repair-blocked',
        relatedId: 'repair_blocker_policy',
        message:
          'Repair blocked: policy failure is outside automatic slot repair: tenant scope missing; decision Decide whether to change policy/spec, installed source, or project plan before repair can proceed.'
      },
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_slot_alpha',
        message: 'Repair task applied, verify pending: repair_slot_alpha -> custom/alpha.ts; targets zeta.test.ts'
      },
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_slot_zeta',
        message: 'Repair task applied, verify pending: repair_slot_zeta -> custom/zeta.ts; preview changed +3/-1; targets zeta.test.ts'
      }
    ]);
    expect(appliedSummary.regressionRisks).toContainEqual({
      kind: 'repair-verification',
      message: 'Repair applied and requires verification rerun'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
