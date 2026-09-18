import { expect, test } from 'bun:test';

import { projectRepairSummary } from '../../src/application/repair-summary.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { writeJson } from '../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { formatRepairSummary } from '../../src/entry/cli/repair-summary.ts';
import { buildRepairBlocker, buildRepairPlanArtifact, buildRepairTask } from '../helpers/repair-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('repair plan routing uses application projection and entry rendering without changing JSON authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const plan = buildRepairPlanArtifact({
      tasks: [buildRepairTask()],
      blockers: [buildRepairBlocker()]
    });
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    await writeJson(repairPlanPath, plan);

    await expectCliSuccess(
      workspaceRoot,
      ['repair', 'plan'],
      `${formatRepairSummary(projectRepairSummary(plan, true))}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['repair', 'plan', '--json']);
    expect(json).toEqual(plan);
  }, 'repair-summary-routing-');
});
