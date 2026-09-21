import { expect, test } from 'bun:test';

import { projectUpgradeDiagnostics } from '../../src/application/upgrade-diagnostics.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { writeJson } from '../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { formatUpgradeDiagnostics } from '../../src/entry/cli/upgrade-diagnostics.ts';
import { buildUpgradeDiagnostics } from '../helpers/upgrade-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('upgrade diagnostics routing uses application projection and entry rendering without changing JSON authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const diagnostics = buildUpgradeDiagnostics({
      details: {
        migrationId: 'mig-target-escape',
        migrationKind: 'file-replace',
        path: '../outside-project.md',
        role: 'target'
      }
    });
    const diagnosticsPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics);
    await writeJson(diagnosticsPath, diagnostics);

    await expectCliSuccess(
      workspaceRoot,
      ['upgrade', 'diagnostics'],
      `${formatUpgradeDiagnostics(projectUpgradeDiagnostics(diagnostics))}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['upgrade', 'diagnostics', '--json']);
    expect(json).toEqual(diagnostics);
  }, 'upgrade-diagnostics-routing-');
});
