import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getWorkspacePaths } from '../../../src/adapters/workspace-context.ts';
import { loadPlan } from '../../../src/adapters/workspace/sources/load-plan.ts';
import { addBlock } from '../../../src/bootstrap/engineering/block-orchestrator.ts';
import { initWorkspace } from '../../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { installPrivateBannerBlock } from '../../helpers/private-registry-fixtures.ts';

test('real block addition keeps its admitted root when cwd changes during lease acquisition', async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), 'sec-add-block-'));
  const roots = [root];
  await settleWorkspaceCallback(async () => {
    const elsewhere = await mkdtemp(path.join(tmpdir(), 'sec-add-decoy-'));
    roots.push(elsewhere);
    await initWorkspace(root);
    await installPrivateBannerBlock(root);
    const pending = addBlock(path.relative(originalCwd, root), 'private/banner-basic');
    const result = await settleWorkspaceCallback(async () => {
      process.chdir(elsewhere);
      return await pending;
    }, async () => { await pending; });
    expect(result).toMatchObject({ changed: true, selectedBlock: { id: 'private/banner-basic', version: '0.1.0', registryKind: 'private' } });
    expect(loadPlan(getWorkspacePaths(root).workspaceConfigPath).blocks).toContainEqual({ id: 'private/banner-basic', version: '0.1.0' });
    expect(await readdir(elsewhere)).toEqual([]);
    const again = await addBlock(root, 'private/banner-basic');
    expect(again.changed).toBe(false);
    expect(again.plan.blocks).toEqual(result.plan.blocks);
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'original cwd', settle: () => process.chdir(originalCwd) },
      ...roots.map(directory => ({ label: directory, settle: () => rm(directory, { recursive: true, force: true }) }))
    ] });
  });
});
