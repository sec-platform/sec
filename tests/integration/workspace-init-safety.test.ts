import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { loadPlan } from '../../platform/compiler/parse/load-plan.ts';
import { initWorkspace } from '../../platform/orchestrator/workspace-orchestrator.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  acquireWorkspaceWriteLease,
  WorkspaceWriteLeaseError
} from '../../platform/shared/workspace-write-lease.ts';
import { createWorkspace } from '../testkit/workspace.ts';

test('legacy reset flag remains compatible only on an empty minimal create surface', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-empty-reset-');
  const result = await initWorkspace(workspaceRoot, { reset: true });
  const paths = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(result.planPath);

  expect(result.planPath).toBe(paths.planPath);
  expect(plan.app.id).toBe('app');
  expect(plan.blocks).toEqual([]);
  expect(plan.slots).toEqual([]);
  expect(plan.acceptance).toEqual([]);
  expect(await fs.readFile(result.lockPath, 'utf8')).not.toContain('customer-admin');
  await expect(fs.lstat(paths.projectRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('reference Customer scaffold requires an explicit create template', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-reference-');
  const result = await initWorkspace(workspaceRoot, { template: 'reference-customer' });
  const paths = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(result.planPath);

  expect(plan.app.id).toBe('customer-admin');
  expect(plan.blocks.map((block) => block.id)).toEqual([
    'auth/basic-session',
    'tenant/basic-workspace',
    'entity/customer-basic'
  ]);
  await expect(fs.lstat(paths.projectRoot)).resolves.toMatchObject({});
  expect(await fs.readFile(paths.projectPackagePath, 'utf8')).toContain('generated-customer-admin');
});

test('unsupported create template fails before lifecycle publication', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-invalid-template-');
  await expect(initWorkspace(
    workspaceRoot,
    { template: 'unknown-template' as 'minimal' }
  )).rejects.toMatchObject({ code: 'WORKSPACE-INIT-002' });

  await expect(fs.lstat(path.join(workspaceRoot, '.sec'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('init and reset refuse a non-empty foreign root before acquiring deletion authority', async () => {
  for (const reset of [false, true]) {
    const workspaceRoot = await createWorkspace(`engineering-compiler-init-foreign-${reset ? 'reset' : 'normal'}-`);
    const foreignPath = path.join(workspaceRoot, 'foreign.txt');
    const foreignBytes = Buffer.from('do not overwrite\n', 'utf8');
    await fs.writeFile(foreignPath, foreignBytes);

    await expect(initWorkspace(workspaceRoot, { reset }))
      .rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });

    expect(await fs.readFile(foreignPath)).toEqual(foreignBytes);
    await expect(fs.lstat(path.join(workspaceRoot, '.sec'))).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

test('repeated init cannot overwrite an existing SEC workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-repeat-');
  await initWorkspace(workspaceRoot);
  const { planPath, lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const before = await Promise.all([
    fs.readFile(planPath),
    fs.readFile(lockPath),
    fs.readFile(verificationReportPath)
  ]);

  await expect(initWorkspace(workspaceRoot))
    .rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });

  const after = await Promise.all([
    fs.readFile(planPath),
    fs.readFile(lockPath),
    fs.readFile(verificationReportPath)
  ]);
  expect(after).toEqual(before);
});

test('active writer contention remains a lease error instead of being relabeled as lifecycle conflict', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-active-writer-');
  await initWorkspace(workspaceRoot);
  const lease = await acquireWorkspaceWriteLease(workspaceRoot);
  try {
    await expect(initWorkspace(workspaceRoot, { reset: true }))
      .rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-001' });
  } finally {
    await lease.release();
  }
});

test('supplied lease authority is proven before the workspace create surface is inspected', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-released-token-');
  const lease = await acquireWorkspaceWriteLease(workspaceRoot);
  const releasedToken = lease.token;
  await lease.release();

  const foreignPath = path.join(workspaceRoot, 'foreign.txt');
  const foreignBytes = Buffer.from('foreign-state\n', 'utf8');
  await fs.writeFile(foreignPath, foreignBytes);

  let failure: unknown;
  try {
    await initWorkspace(workspaceRoot, {}, releasedToken);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(WorkspaceWriteLeaseError);
  expect((failure as WorkspaceWriteLeaseError).code).toMatch(/^WORKSPACE-WRITE-LEASE-/u);
  expect((failure as WorkspaceWriteLeaseError).code).not.toBe('WORKSPACE-INIT-001');
  expect(await fs.readFile(foreignPath)).toEqual(foreignBytes);
});
