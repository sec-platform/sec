import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/paths.ts';
import { expectFileUnchanged } from '../helpers/assertion-helpers.ts';
import { writeSlotUpgradeFixture } from '../helpers/slot-upgrade-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('upgrade apply writes diagnostics when migration execution fails after planning', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeSlotUpgradeFixture(workspaceRoot);

    const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
    const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.upgradeDiagnostics
    );
    const beforePlan = await fs.readFile(workspaceConfigPath, 'utf8');

    await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0')).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-016'
    });
    await expectFileUnchanged(workspaceConfigPath, beforePlan);

    const diagnostics = await readJson<{
      phase: string;
      failedCheck: string;
      errorCode: string;
      message: string;
      details?: unknown;
    }>(upgradeDiagnosticsPath);
    expect(diagnostics).toMatchObject({
      phase: 'apply',
      failedCheck: 'migration-file-operations',
      errorCode: 'UPGRADE-MIGRATION-016',
      message: 'slot-contract-update target "custom/customer_normalizer.ts" is missing',
      details: {
        migrationId: 'mig-customer-normalizer-contract',
        migrationKind: 'slot-contract-update',
        slotId: 'customer_normalizer',
        target: 'custom/customer_normalizer.ts',
        rollbackStatus: 'restored'
      }
    });
  }, 'engineering-compiler-upgrade-apply-diagnostics-');
});
