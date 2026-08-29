import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import {
  applyEngineeringOperations,
  type EngineeringOperation
} from '../../src/compiler/operations/engineering-operation.ts';
import { initWorkspace } from '../../src/compiler/orchestration/workspace-orchestrator.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease
} from '../../src/workspace/lease.ts';
import { readYaml } from '../../src/workspace/yaml.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function applyWithLease(workspaceRoot: string, operations: readonly EngineeringOperation[]) {
  return withWorkspaceWriteLease(workspaceRoot, undefined, (token) => applyEngineeringOperations(
    workspaceRoot,
    operations,
    () => assertWorkspaceWriteLease(workspaceRoot, token)
  ));
}

test('canonical Engineering Operation writer applies Plan operations through the sole mutation owner', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);
    const results = await applyWithLease(workspaceRoot, [
      { id: 'rename-app', kind: 'set-app-name', value: 'renamed-app' },
      { id: 'add-proof', kind: 'add-acceptance', acceptanceId: 'acceptance_extra_proof' }
    ]);

    expect(results).toEqual([
      { id: 'rename-app', kind: 'set-app-name', status: 'applied', detail: 'set app.name to renamed-app' },
      { id: 'add-proof', kind: 'add-acceptance', status: 'applied', detail: 'added acceptance acceptance_extra_proof' }
    ]);
    const plan = await readYaml<{
      app: { name: string };
      acceptance: Array<{ id: string }>;
    }>(getWorkspacePaths(workspaceRoot).planPath);
    expect(plan.app.name).toBe('renamed-app');
    expect(plan.acceptance.some((entry) => entry.id === 'acceptance_extra_proof')).toBe(true);
  }, 'engineering-operation-direct-');
});

test('failed operation batch publishes no partial Plan mutation', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);
    const { planPath } = getWorkspacePaths(workspaceRoot);
    const before = await fs.readFile(planPath);

    await expect(applyWithLease(workspaceRoot, [
      { id: 'must-rollback-in-memory', kind: 'set-app-name', value: 'must-not-publish' },
      { id: 'missing-slot', kind: 'set-slot-description', slotId: 'missing_slot', description: 'blocked' }
    ])).rejects.toMatchObject({ code: 'ENGINEERING-OPERATION-001' });

    expect(await fs.readFile(planPath)).toEqual(before);
  }, 'engineering-operation-failure-');
});
