import { expect, test } from 'vitest';

import { buildReviewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  buildPassingReviewReport,
  buildRepairBlocker,
  buildRepairPlanArtifact,
  buildRepairTask,
  buildReviewInputs,
  withTempWorkspace
} from '../helpers/test-utils.ts';

test('review summary surfaces pending repair tasks', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
    const { lock, provenance, coverage } = buildReviewInputs({
      lock: {
        passStatus: {
          verify: 'failed',
          repair: 'succeeded'
        }
      },
      coverage: { status: 'failed' }
    });
    const report = buildPassingReviewReport({
      unit: { status: 'failed', passed: [] },
      fast: {
        status: 'failed',
        unit: { status: 'failed', passed: [] }
      },
      summary: {
        status: 'failed',
        failedLanes: ['fast']
      }
    });
    const repairPlan = buildRepairPlanArtifact({
      tasks: [
        buildRepairTask({
          taskId: 'repair_slot_zeta',
          category: 'slot-rewrite',
          sourceSlotId: 'zeta',
          targetFile: 'custom/zeta.ts',
          requiredSymbols: ['zeta'],
          preview: {
            beforeLines: 1,
            afterLines: 3,
            addedLines: 3,
            removedLines: 1,
            changed: true
          }
        }),
        buildRepairTask({
          taskId: 'repair_slot_alpha',
          sourceSlotId: 'alpha',
          targetFile: 'custom/alpha.ts',
          requiredSymbols: ['alpha']
        })
      ],
      blockers: [buildRepairBlocker()]
    });
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
      verificationTrace: {
        pendingReason: 'repair-not-applied',
        nextAction: 'apply-repair'
      },
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
      targetSummaries: [
        { id: 'tenant-scope-required', targetType: 'policy-target', count: 1 },
        { id: 'zeta.test.ts', targetType: 'slot-target', count: 2 }
      ],
      taskCategorySummaries: [{ id: 'slot-rewrite', count: 2 }],
      targetFileCount: 2,
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
        targetIds: ['zeta.test.ts'],
        allowedPathCount: 1,
        requiredSymbolCount: 1,
        forbiddenOperationCount: 0,
        testCount: 0,
        failureTargetCount: 1,
        writeBounds: ['custom/alpha.ts'],
        requiredSymbols: ['alpha'],
        forbiddenOperations: [],
        testsToPass: [],
        failureTargets: ['zeta.test.ts']
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
        targetIds: ['zeta.test.ts'],
        allowedPathCount: 1,
        requiredSymbolCount: 1,
        forbiddenOperationCount: 0,
        testCount: 0,
        failureTargetCount: 1,
        writeBounds: ['custom/zeta.ts'],
        requiredSymbols: ['zeta'],
        forbiddenOperations: [],
        testsToPass: [],
        failureTargets: ['zeta.test.ts']
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
      artifactPath: CI_ARTIFACT_FILES.repairPlan,
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
      changedPreviewCount: 1,
      verificationTrace: {
        pendingReason: 'verify-required',
        nextAction: 'rerun-verify'
      }
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
  });
});
