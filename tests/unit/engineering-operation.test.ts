import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import {
  applyEngineeringOperations,
  type EngineeringOperation
} from '../../src/adapters/compilation/operations/engineering-operation.ts';
import { initWorkspace } from '../../src/application/engineering/workspace-orchestrator.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease
} from '../../src/adapters/filesystem/write-lease.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { readYaml } from '../../src/adapters/workspace/yaml.ts';
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
    }>(getWorkspacePaths(workspaceRoot).workspaceConfigPath);
    expect(plan.app.name).toBe('renamed-app');
    expect(plan.acceptance.some((entry) => entry.id === 'acceptance_extra_proof')).toBe(true);
  }, 'engineering-operation-direct-');
});

test('failed operation batch publishes no partial Plan mutation', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);
    const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
    const before = await fs.readFile(workspaceConfigPath);

    await expect(applyWithLease(workspaceRoot, [
      { id: 'must-rollback-in-memory', kind: 'set-app-name', value: 'must-not-publish' },
      { id: 'invalid-acceptance', kind: 'add-acceptance', acceptanceId: 'INVALID ACCEPTANCE' }
    ])).rejects.toMatchObject({ code: 'PLAN-VALIDATION-025' });

    expect(await fs.readFile(workspaceConfigPath)).toEqual(before);
  }, 'engineering-operation-failure-');
});
