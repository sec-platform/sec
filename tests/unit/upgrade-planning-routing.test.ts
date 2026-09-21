import { expect, test } from 'bun:test';

import { projectUpgradePlan } from '../../src/application/upgrade-planning.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { writeJson } from '../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { formatUpgradePlanning } from '../../src/entry/cli/upgrade-planning.ts';
import { buildUpgradePlanArtifact } from '../helpers/upgrade-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('upgrade plan routing uses application projection and entry rendering without changing JSON authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const plan = buildUpgradePlanArtifact();
    const planPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    await writeJson(planPath, plan);

    await expectCliSuccess(
      workspaceRoot,
      ['upgrade', 'plan'],
      `${formatUpgradePlanning(projectUpgradePlan(plan, null))}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['upgrade', 'plan', '--json']);
    expect(json).toEqual(plan);
  }, 'upgrade-planning-routing-');
});
