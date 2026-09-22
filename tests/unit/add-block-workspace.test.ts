import { expect, test } from 'bun:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addBlock } from '../../src/bootstrap/engineering/block-orchestrator.ts';
import { initWorkspace } from '../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { loadPlan } from '../../src/adapters/workspace/sources/load-plan.ts';
import { getWorkspacePaths } from '../../src/adapters/workspace-context.ts';
import { installPrivateBannerBlock } from '../helpers/private-registry-fixtures.ts';

test('real block addition keeps its admitted root when cwd changes during lease acquisition', async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), 'sec-add-block-'));
  const elsewhere = await mkdtemp(path.join(tmpdir(), 'sec-add-decoy-'));
  try {
    await initWorkspace(root);
    await installPrivateBannerBlock(root);
    const pending = addBlock(path.relative(originalCwd, root), 'private/banner-basic');
    process.chdir(elsewhere);
    const result = await pending;
    expect(result).toMatchObject({ changed: true, selectedBlock: { id: 'private/banner-basic', version: '0.1.0', registryKind: 'private' } });
    expect(loadPlan(getWorkspacePaths(root).workspaceConfigPath).blocks).toContainEqual({ id: 'private/banner-basic', version: '0.1.0' });
    expect(await readdir(elsewhere)).toEqual([]);
    const again = await addBlock(root, 'private/banner-basic');
    expect(again.changed).toBe(false);
    expect(again.plan.blocks).toEqual(result.plan.blocks);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});
