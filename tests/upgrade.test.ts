import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

test('upgrade advances an official block version and preserves a passing pipeline', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-'));

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  const beforeUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  assert.match(beforeUpgrade, /SESSION_BLOCK_VERSION = '0\.1\.0'/);

  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  const { plan, lock, upgradePlan } = await upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1');
  assert.equal(plan.blocks.find((block) => block.id === 'auth/basic-session')?.version, '0.1.1');
  assert.equal(lock.resolvedBlocks.find((block) => block.id === 'auth/basic-session')?.version, '0.1.1');
  assert.equal(lock.passStatus.lock, 'succeeded');
  assert.equal(upgradePlan.status, 'applied');
  assert.ok(lock.generatedPaths.includes('generated/upgrade-plan.json'));

  const afterUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  assert.match(afterUpgrade, /SESSION_BLOCK_VERSION = '0\.1\.1'/);
  assert.match(afterUpgrade, /SUPPORTED_USERNAMES/);

  const persistedUpgradePlan = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'upgrade-plan.json'), 'utf8')
  ) as { toVersion: string; status: string; impacts: string[] };
  assert.equal(persistedUpgradePlan.toVersion, '0.1.1');
  assert.equal(persistedUpgradePlan.status, 'applied');
  assert.ok(persistedUpgradePlan.impacts.includes('src/installed/auth/session.ts'));
});

test('upgrade is blocked when a manual override conflicts with impacted files', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-conflict-'));
  const { overrideManifestPath } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'manual-auth-session-hotfix',
        entry: 'patches/manual-auth-session-hotfix.ts',
        target: 'src/installed/auth/session.ts',
        reason: 'manual-auth-session-hotfix',
        source: 'manual',
        appliesAfter: ['adapt'],
        conflictsWith: []
      }
    ]
  });

  await assert.rejects(
    async () => upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1'),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'UPGRADE-CONFLICT-001'
  );
});
