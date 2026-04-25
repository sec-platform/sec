import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  adaptWorkspace,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

test('upgrade advances an official block version and preserves a passing pipeline', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  const beforeUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  expect(beforeUpgrade).toMatch(/SESSION_BLOCK_VERSION = '0\.1\.0'/);

  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  const { plan, lock, upgradePlan } = await upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1');
  expect(plan.blocks.find((block) => block.id === 'auth/basic-session')?.version).toBe('0.1.1');
  expect(lock.resolvedBlocks.find((block) => block.id === 'auth/basic-session')?.version).toBe('0.1.1');
  expect(lock.passStatus.lock).toBe('succeeded');
  expect(upgradePlan.status).toBe('applied');
  expect(lock.generatedPaths).toContain('generated/upgrade-plan.json');

  const afterUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  expect(afterUpgrade).toMatch(/SESSION_BLOCK_VERSION = '0\.1\.1'/);
  expect(afterUpgrade).toMatch(/SUPPORTED_USERNAMES/);

  const persistedUpgradePlan = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'upgrade-plan.json'), 'utf8')
  ) as {
    toVersion: string;
    status: string;
    impacts: string[];
    migrationSummaries: Array<{ id: string; kind: string; target: string; reason: string }>;
  };
  expect(persistedUpgradePlan.toVersion).toBe('0.1.1');
  expect(persistedUpgradePlan.status).toBe('applied');
  expect(persistedUpgradePlan.impacts).toContain('src/installed/auth/session.ts');
  expect(persistedUpgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.'
    }
  ]);

  const { reviewSummary } = await explainWorkspace(workspaceRoot);
  expect(reviewSummary.conflictHints).toEqual(
    expect.arrayContaining([
      {
        kind: 'upgrade-plan-present',
        relatedId: 'auth/basic-session',
        message: 'Upgrade plan applied, verify pending: auth/basic-session 0.1.0 -> 0.1.1'
      }
    ])
  );
});

test('upgrade dry-run writes a planned upgrade without changing project files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-dry-run-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  const planPath = path.join(workspaceRoot, 'project', 'app.plan.yaml');
  const sessionPath = path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts');
  const beforePlan = await fs.readFile(planPath, 'utf8');
  const beforeSession = await fs.readFile(sessionPath, 'utf8');

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.'
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
  await expect(fs.readFile(sessionPath, 'utf8')).resolves.toBe(beforeSession);
});

test('upgrade is blocked when a manual override conflicts with impacted files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-conflict-');
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

  await expect(upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1')).rejects.toThrow();
});
