import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from "../../../src/adapters/filesystem/files.ts";
import { inspectNoFollowDirectoryChain, inspectNoFollowDirectoryLeaf, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { writeBlockUpgradeFixture } from '../../helpers/block-upgrade-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('upgrade compiler failure preserves migrated live state and original recovery bytes, entries and modes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);
    const paths = getWorkspacePaths(workspaceRoot);
    const relativeTarget = 'src/installed/private/customer-normalizer.ts';
    const migratedTarget = path.join(workspaceRoot, relativeTarget);
    const originalTarget = await fs.readFile(migratedTarget);
    const expectedMigrated = await fs.readFile(path.join(paths.privateRegistryRoot,
      'private.block-upgrade', 'versions', '0.2.0', 'files', relativeTarget));
    const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics);
    const nestedPath = path.join(workspaceRoot, 'src', 'coverage', 'retained.txt');
    const rootFilePath = path.join(workspaceRoot, 'rollback-root.txt');
    const graphLockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const graphLockPreimage = await fs.readFile(graphLockPath);
    await fs.mkdir(path.dirname(nestedPath), { recursive: true });
    await fs.writeFile(nestedPath, 'nested preimage\n');
    await fs.writeFile(rootFilePath, 'root preimage\n');
    if (process.platform === 'linux') {
      await fs.chmod(nestedPath, 0o640);
      await fs.chmod(rootFilePath, 0o750);
    }
    const nestedMode = (await fs.lstat(nestedPath)).mode & 0o7777;
    const rootMode = (await fs.lstat(rootFilePath)).mode & 0o7777;
    await fs.rm(path.join(
      paths.privateRegistryRoot,
      'private.block-upgrade',
      'files',
      'src',
      'installed',
      'private',
      'block-upgrade.ts'
    ));

    let failure: unknown;
    try { await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0'); }
    catch (error) { failure = error; }
    const snapshot = (failure as { details?: { recoverySnapshot?: {
      path: string; device: string; inode: string; parentPath: string;
      parentDevice: string; parentInode: string;
    } } })?.details?.recoverySnapshot;
    let assertionFailure: unknown;
    try {
      expect(failure).toMatchObject({ details: { rollbackStatus: 'recovery-required' } });
      expect(snapshot).toBeDefined();
      const preimage = path.join(snapshot!.path, 'preimage');
      expect(expectedMigrated).not.toEqual(originalTarget);
      expect(await fs.readFile(migratedTarget)).toEqual(expectedMigrated);
      expect(await fs.readFile(path.join(preimage, relativeTarget))).toEqual(originalTarget);
      const diagnostics = await readJson<{ phase: string; details?: unknown }>(upgradeDiagnosticsPath);
      expect(diagnostics).toMatchObject({ phase: 'recovery', details: { rollbackStatus: 'recovery-required' } });
      await expect(fs.readFile(nestedPath, 'utf8')).resolves.toBe('nested preimage\n');
      await expect(fs.readFile(rootFilePath, 'utf8')).resolves.toBe('root preimage\n');
      expect(await fs.readFile(path.join(preimage, '.sec-lock.snapshot'))).toEqual(graphLockPreimage);
      expect(await fs.readFile(path.join(preimage, 'src', 'coverage', 'retained.txt'), 'utf8')).toBe('nested preimage\n');
      if (process.platform === 'linux') {
        expect((await fs.lstat(path.join(preimage, 'src', 'coverage', 'retained.txt'))).mode & 0o7777).toBe(nestedMode);
        expect((await fs.lstat(path.join(preimage, 'rollback-root.txt'))).mode & 0o7777).toBe(rootMode);
      }
    } catch (error) { assertionFailure = error; }
    await settleResourcesAsync({
      ...(assertionFailure === undefined ? {} : { primary: { label: 'upgrade-compiler-recovery-test', error: assertionFailure } }),
      cleanup: snapshot === undefined ? [] : [{
        label: 'upgrade-compiler-recovery-test-backup',
        settle: () => {
          const parent = inspectNoFollowDirectoryChain(snapshot.parentPath, 'Recovery test parent').target;
          const root = inspectNoFollowDirectoryLeaf(parent, path.basename(snapshot.path), 'Recovery test backup');
          if (parent.device !== snapshot.parentDevice || parent.inode !== snapshot.parentInode ||
              root === null || root.device !== snapshot.device || root.inode !== snapshot.inode) {
            throw new Error('Recovery test backup identity changed');
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
  }, 'engineering-compiler-upgrade-nested-rollback-');
});
