import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { readJson } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { writeBlockUpgradeFixture } from '../helpers/block-upgrade-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('upgrade apply restores the workspace when compilation fails after a file migration', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);

    const paths = getWorkspacePaths(workspaceRoot);
    const migratedTarget = paths.workspaceRoot + '/src/installed/private/customer-normalizer.ts';
    const originalTarget = await fs.readFile(migratedTarget, 'utf8');
    await fs.rm(paths.privateRegistryRoot + '/private.block-upgrade/files/src/installed/private/block-upgrade.ts');
    const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.upgradeDiagnostics
    );
    await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0')).rejects.toMatchObject({
      details: { rollbackStatus: 'restored' }
    });
    await expect(fs.readFile(migratedTarget, 'utf8')).resolves.toBe(originalTarget);

    const diagnostics = await readJson<{
      phase: string;
      details?: unknown;
    }>(upgradeDiagnosticsPath);
    expect(diagnostics).toMatchObject({
      phase: 'apply',
      details: { rollbackStatus: 'restored' }
    });
  }, 'engineering-compiler-upgrade-apply-diagnostics-');
});
