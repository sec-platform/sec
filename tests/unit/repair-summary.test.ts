import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { writeJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { buildRepairBlocker, buildRepairFailurePoint, buildRepairPlanArtifact, buildRepairTask } from '../helpers/repair-fixtures.ts';
import type { ReviewInputsOptions } from '../helpers/review-fixtures.ts';
import { buildPassingReviewReport, buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const FILE_TARGET_ZETA = 'src/installed/generated/zeta.ts';
const FILE_TARGET_ALPHA = 'src/installed/generated/alpha.ts';

test('review summary surfaces pending repair tasks', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
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
    const reviewOptions: ReviewInputsOptions = {
      lock: {
        passStatus: {
          verify: 'failed',
          repair: 'succeeded'
        }
      },
      coverage: { status: 'failed' },
      report
    };
    const repairPlan = buildRepairPlanArtifact({
      tasks: [
        buildRepairTask({
          taskId: 'repair_file_zeta',
          category: 'file-repair',
          targetFile: FILE_TARGET_ZETA,
          requiredSymbols: ['zeta'],
          failurePoints: [buildRepairFailurePoint({ targetIds: [FILE_TARGET_ZETA] })],
          preview: {
            beforeLines: 1,
            afterLines: 3,
            addedLines: 3,
            removedLines: 1,
            changed: true
          }
        }),
        buildRepairTask({
          taskId: 'repair_file_alpha',
          targetFile: FILE_TARGET_ALPHA,
          requiredSymbols: ['alpha'],
          failurePoints: [buildRepairFailurePoint({ targetIds: [FILE_TARGET_ALPHA] })]
        })
      ],
      blockers: [buildRepairBlocker()]
    });
    await writeJson(repairPlanPath, repairPlan);

    const summary = await buildReviewSummaryFromInputs(workspaceRoot, reviewOptions);

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
          { id: 'file', count: 2 },
          { id: 'spec', count: 1 }
        ],
        repairabilitySummaries: [
          { id: 'blocked', count: 1 },
          { id: 'repairable', count: 2 }
        ]
      },
      targetSummaries: [
        { id: FILE_TARGET_ALPHA, targetType: 'file-target', count: 1 },
        { id: FILE_TARGET_ZETA, targetType: 'file-target', count: 1 },
        { id: 'tenant-scope-required', targetType: 'policy-target', count: 1 },
      ],
      taskCategorySummaries: [{ id: 'file-repair', count: 2 }],
      targetFileCount: 2,
      targetFiles: [FILE_TARGET_ALPHA, FILE_TARGET_ZETA]
    });
    expect(summary.repairSummary?.taskSummaries).toHaveLength(2);
    expect(summary.repairSummary?.blockerSummaries).toHaveLength(1);
    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'repair',
      artifactPath: CI_ARTIFACT_FILES.repairPlan,
      message: 'Repair blocked at spec: policy failure is outside automatic file repair: tenant scope missing'
    });
    expect(summary.conflictHints).toHaveLength(3);

    repairPlan.status = 'applied';
    repairPlan.requiresVerification = true;
    await writeJson(repairPlanPath, repairPlan);

    const appliedSummary = await buildReviewSummaryFromInputs(workspaceRoot, reviewOptions);

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
    expect(appliedSummary.conflictHints).toHaveLength(3);
    expect(appliedSummary.regressionRisks).toContainEqual({
      kind: 'repair-verification',
      message: 'Repair applied and requires verification rerun'
    });
  });
});
