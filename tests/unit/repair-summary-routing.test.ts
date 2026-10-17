import { expect, test } from 'bun:test';

import { writeJson } from '../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectRepairSummary } from '../../src/application/repair-summary.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatRepairSummary } from '../../src/entry/cli/repair-summary.ts';
import { buildRepairBlocker, buildRepairPlanArtifact, buildRepairTask } from '../helpers/repair-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('repair plan routing uses application projection and entry rendering without changing JSON authority', async () => {
  // Keep the independently fixed non-CLI state projections formerly registered in tests/unit/repair-summary-presentation.test.ts.
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

  const expectedText = [
    'Repair pending (1 tasks, 1 blockers) (dry-run)',
    'Source verification: failed; requires verification: false',
    'Task repair_file_customer_service: entity/customer-basic -> src/installed/entity/customer-service.ts',
    'Review repair_file_customer_service: writeBounds=src/installed/entity/customer-service.ts; symbols=normalizeCustomerInput; tests=none; forbidden=none; failureTargets=zeta.test.ts',
    'Failure fast/unit; issue=file; repairable=true; Unit verification failed',
    'Blocker repair_blocker_policy: spec; policy failure is outside automatic file repair: tenant scope missing',
    'Failure fast/policy; issue=spec; repairable=false; tenant scope missing'
  ].join('\n');
  expect(formatRepairSummary(view)).toBe(expectedText);

  await withTempWorkspace(async (workspaceRoot) => {
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    await writeJson(repairPlanPath, originalPlan);

    await expectCliSuccess(
      workspaceRoot,
      ['repair', 'plan'],
      `${expectedText}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['repair', 'plan', '--json']);
    expect(json).toEqual(originalPlan);
  }, 'repair-summary-routing-');
});
