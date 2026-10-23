import { expect, test } from 'bun:test';

import { writeJson } from '../../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectRepairSummary } from '../../../src/application/repair-summary.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatRepairSummary } from '../../../src/entry/cli/repair-summary.ts';
import { buildRepairBlocker, buildRepairPlanArtifact, buildRepairTask } from '../../helpers/repair-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('repair plan routing uses application projection and entry rendering without changing JSON authority', async () => {
  // An applied repair still awaits verification, even when requested as a dry run.
  {
    const tasks = Array.from({ length: 4 }, (_, index) => buildRepairTask({
      taskId: `repair_${index}`,
      targetFile: `src/${index}.ts`
    }));
    const blockers = Array.from({ length: 4 }, (_, index) => buildRepairBlocker({
      blockerId: `blocker_${index}`
    }));
    const plan = buildRepairPlanArtifact({
      status: 'applied',
      requiresVerification: true,
      tasks,
      blockers
    });

    const view = projectRepairSummary(plan, true);

    expect(view.presentation).toBe('verify-pending');
    expect(formatRepairSummary(view)).toMatch(/\bverify pending(?=$|[\s;,()])/u);
    expect(formatRepairSummary(view)).not.toContain('dry-run');
    expect(view.taskCount).toBe(4);
    expect(view.blockerCount).toBe(4);
    expect(view.tasks).toHaveLength(3);
    expect(view.blockers).toHaveLength(3);
  }
  const task = buildRepairTask();
  const plan = buildRepairPlanArtifact({
    tasks: [task],
    blockers: [buildRepairBlocker()]
  });

  const originalPlan = structuredClone(plan);
  const view = projectRepairSummary(plan, true);

  expect(view.presentation).toBe('dry-run');
  expect(view.tasks[0]!.review).toEqual({
    writeBounds: ['src/installed/entity/customer-service.ts'],
    requiredSymbols: ['normalizeCustomerInput'],
    forbiddenOperations: [],
    testsToPass: [],
    failureTargets: ['zeta.test.ts']
  });
  task.allowedPaths.push('later.ts');
  task.failurePoints[0]!.targetIds!.push('later-target');
  expect(view.tasks[0]!.review.writeBounds).toEqual(['src/installed/entity/customer-service.ts']);
  expect(view.tasks[0]!.review.failureTargets).toEqual(['zeta.test.ts']);

  // Keep failure and review fields tied to their subjects without freezing whole lines.
  function expectPendingRepair(text: string): void {
    for (const meaning of [
      /Repair\s+pending(?=$|[\s;,()])[^\n]*\bdry-run(?=$|[\s;,()])/u,
      /\b1 tasks(?=$|[\s;,()])/u,
      /\b1 blockers(?=$|[\s;,()])/u,
      /Source verification\W+failed(?=$|[\s;,()])/u,
      /requires verification\W+false(?=$|[\s;,()])/u,
      /Task repair_file_customer_service(?=[\s:])[^\n]*entity\/customer-basic(?=$|[\s;,()])[^\n]*src\/installed\/entity\/customer-service\.ts(?=$|[\s;,()])/u,
      /Review repair_file_customer_service(?=[\s:])[^\n]*writeBounds=src\/installed\/entity\/customer-service\.ts(?=$|[\s;,()])/u,
      /Review repair_file_customer_service(?=[\s:])[^\n]*symbols=normalizeCustomerInput(?=$|[\s;,()])/u,
      /Review repair_file_customer_service(?=[\s:])[^\n]*tests=none(?=$|[\s;,()])/u,
      /Review repair_file_customer_service(?=[\s:])[^\n]*forbidden=none(?=$|[\s;,()])/u,
      /Review repair_file_customer_service(?=[\s:])[^\n]*failureTargets=zeta\.test\.ts(?=$|[\s;,()])/u,
      /Failure fast\/unit(?=$|[\s;,()])[^\n]*issue=file(?=$|[\s;,()])/u,
      /Failure fast\/unit(?=$|[\s;,()])[^\n]*repairable=true(?=$|[\s;,()])/u,
      /Blocker repair_blocker_policy\W+spec(?=$|[\s;,()])[^\n]*tenant scope missing/u,
      /Failure fast\/policy(?=$|[\s;,()])[^\n]*issue=spec(?=$|[\s;,()])/u,
      /Failure fast\/policy(?=$|[\s;,()])[^\n]*repairable=false(?=$|[\s;,()])/u
    ]) expect(text).toMatch(meaning);
  }
  expectPendingRepair(formatRepairSummary(view));

  await withTempWorkspace(async (workspaceRoot) => {
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    await writeJson(repairPlanPath, originalPlan);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['repair', 'plan']);
    expectPendingRepair(stdout);

    const json = await expectCliJson(workspaceRoot, ['repair', 'plan', '--json']);
    expect(json).toEqual(originalPlan);
  }, 'repair-summary-routing-');
});
