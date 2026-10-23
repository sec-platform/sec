import { expect, test } from 'bun:test';

import { writeJson } from '../../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectUpgradeDiagnostics } from '../../../src/application/upgrade-diagnostics.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatUpgradeDiagnostics } from '../../../src/entry/cli/upgrade-diagnostics.ts';
import { buildUpgradeDiagnostics } from '../../helpers/upgrade-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('upgrade diagnostics routing uses application projection and entry rendering without changing JSON authority', async () => {
  const diagnostics = buildUpgradeDiagnostics({
    details: {
      migrationId: 'mig-target-escape',
      migrationKind: 'file-replace',
      path: '../outside-project.md',
      role: 'target'
    }
  });
  const originalDiagnostics = structuredClone(diagnostics);
  const view = projectUpgradeDiagnostics(diagnostics);

  expect(view).toEqual({
    phase: 'planning',
    blockId: 'private/block-upgrade',
    targetVersion: '0.2.0',
    status: 'blocked',
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    message: 'Migration path "../outside-project.md" escapes project root',
    attribution: [
      'migration=mig-target-escape',
      'kind=file-replace',
      'target=../outside-project.md'
    ]
  });
  const assertDiagnosticText = (text: string): void => {
    for (const field of [
      'Upgrade diagnostics planning',
      'Block: private/block-upgrade', 'target: 0.2.0', 'status: blocked',
      'Failed check: migration-targets', 'code: UPGRADE-MIGRATION-004',
      'Message: Migration path "../outside-project.md" escapes project root',
      'migration=mig-target-escape', 'kind=file-replace', 'target=../outside-project.md'
    ]) {
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      expect(text).toMatch(new RegExp(`(?:^|[\\s;,])${escaped}(?=\\s*(?:[;,\\r\\n]|$))`, 'u'));
    }
  };
  assertDiagnosticText(formatUpgradeDiagnostics(view));

  await withTempWorkspace(async (workspaceRoot) => {
    const diagnosticsPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics);
    await writeJson(diagnosticsPath, originalDiagnostics);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['upgrade', 'diagnostics']);
    assertDiagnosticText(stdout);

    const json = await expectCliJson(workspaceRoot, ['upgrade', 'diagnostics', '--json']);
    expect(json).toEqual(originalDiagnostics);
  }, 'upgrade-diagnostics-routing-');
});
