import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import { inspectNoFollowDirectoryChain, inspectNoFollowDirectoryLeaf, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { upgradeWorkspace } from '../../src/bootstrap/upgrade/orchestration.ts';
import { settleResourcesAsync } from '../../src/execution/resource-settlement.ts';
import { writeBlockUpgradeFixture } from '../helpers/block-upgrade-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('upgrade compiler failure preserves migrated live state and original recovery bytes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);
    const paths = getWorkspacePaths(workspaceRoot);
    const relativeTarget = 'src/installed/private/customer-normalizer.ts';
    const migratedTarget = path.join(workspaceRoot, relativeTarget);
    const originalTarget = await fs.readFile(migratedTarget);
    const expectedMigrated = await fs.readFile(path.join(paths.privateRegistryRoot,
      'private.block-upgrade', 'versions', '0.2.0', 'files', relativeTarget));
    await fs.rm(paths.privateRegistryRoot + '/private.block-upgrade/files/src/installed/private/block-upgrade.ts');
    const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics);
    let failure: unknown;
    try { await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0'); }
    catch (error) { failure = error; }
    const snapshot = (failure as { details?: { recoverySnapshot?: {
      path: string; device: string; inode: string; parentPath: string; parentDevice: string; parentInode: string;
    } } })?.details?.recoverySnapshot;
    let assertionFailure: { label: string; error: unknown } | undefined;
    try {
      expect(failure).toMatchObject({ details: { rollbackStatus: 'recovery-required' } });
      expect(snapshot).toBeDefined();
      expect(expectedMigrated).not.toEqual(originalTarget);
      expect(await fs.readFile(migratedTarget)).toEqual(expectedMigrated);
      expect(await fs.readFile(path.join(snapshot!.path, 'preimage', relativeTarget))).toEqual(originalTarget);
      const diagnostics = await readJson<{ phase: string; details?: unknown }>(upgradeDiagnosticsPath);
      expect(diagnostics).toMatchObject({ phase: 'recovery', details: { rollbackStatus: 'recovery-required' } });
    } catch (error) { assertionFailure = { label: 'upgrade compiler recovery assertions', error }; }
    await settleResourcesAsync({
      ...(assertionFailure === undefined ? {} : { primary: assertionFailure }),
      cleanup: snapshot === undefined ? [] : [{
        label: 'upgrade compiler recovery fixture backup',
        settle: () => {
          const parent = inspectNoFollowDirectoryChain(snapshot.parentPath, 'Recovery fixture parent').target;
          const root = inspectNoFollowDirectoryLeaf(parent, path.basename(snapshot.path), 'Recovery fixture backup');
          if (parent.device !== snapshot.parentDevice || parent.inode !== snapshot.parentInode ||
              root === null || root.device !== snapshot.device || root.inode !== snapshot.inode) {
            throw new Error('Recovery fixture backup identity changed');
          }
          const inventory = scanNoFollowDirectoryTreeInventory(root, {
            deadlineAtMs: performance.now() + 30_000, maximumEntries: 100_000,
            maximumBytes: 1024 * 1024 * 1024, includePermissionMode: true
          });
          retireNoFollowDirectoryTree({ deadlineAtMonotonicMs: performance.now() + 30_000,
            inventory, parent, root, restoreOwnerPermissions: true });
        }
      }]
    });
  }, 'engineering-compiler-upgrade-apply-diagnostics-');
});
