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
import { writeJson } from '../platform/shared/fs.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import type { LockFile } from '../platform/shared/types.ts';
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

async function writeSlotUpgradeFixture(workspaceRoot: string): Promise<void> {
  const { lockPath, planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const blockRoot = path.join(privateRegistryRoot, 'private.slot-contract');
  const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
  const baseManifest = {
    id: 'private/slot-contract',
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: ['nextjs-ts-prisma-sqlite'],
    requires: [],
    provides: ['private/slot-contract'],
    conflicts: [],
    installs: [
      {
        kind: 'copy',
        from: 'files/src/installed/private/slot-contract.ts',
        to: 'src/installed/private/slot-contract.ts'
      }
    ],
    pins: {
      inputs: [],
      outputs: []
    },
    slots: [
      {
        id: 'customer_normalizer',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomer',
        inputType: 'CustomerInputV1',
        outputType: 'CustomerRecordInput',
        writableZones: ['custom/customer_normalizer.ts']
      }
    ],
    acceptance: [],
    routes: []
  };

  await writeYaml(planPath, {
    app: {
      name: 'customer-admin',
      stack: 'nextjs-ts-prisma-sqlite',
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: {
      sources: [
        {
          id: 'private',
          kind: 'private',
          location: 'workspace',
          path: 'platform/registry/private'
        }
      ]
    },
    blocks: [{ id: 'private/slot-contract', version: '0.1.0' }],
    slots: [],
    acceptance: []
  });
  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), baseManifest);
  await writeYaml(path.join(versionRoot, 'block.manifest.yaml'), {
    ...baseManifest,
    version: '0.2.0',
    slots: [
      {
        id: 'customer_normalizer',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomer',
        inputType: 'CustomerInputV2',
        outputType: 'CustomerRecordInput',
        writableZones: ['custom/customer_normalizer.ts']
      }
    ],
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-customer-normalizer-contract',
          kind: 'slot-contract-update',
          entry: 'migrations/customer-normalizer-contract.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: true
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'customer-normalizer-contract.json'), {
    id: 'mig-customer-normalizer-contract',
    kind: 'slot-contract-update',
    reason: 'Update customer normalizer input contract to v2.',
    target: 'custom/customer_normalizer.ts',
    slotId: 'customer_normalizer',
    inputType: 'CustomerInputV2',
    outputType: 'CustomerRecordInput',
    writableZones: ['custom/customer_normalizer.ts']
  });

  const lock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'succeeded',
      emit: 'succeeded'
    }
  };
  await writeJson(lockPath, lock);
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
    migrationSummaries: Array<{ id: string; kind: string; target: string; reason: string; requiresVerification: boolean }>;
  };
  expect(persistedUpgradePlan.toVersion).toBe('0.1.1');
  expect(persistedUpgradePlan.status).toBe('applied');
  expect(persistedUpgradePlan.impacts).toContain('src/installed/auth/session.ts');
  expect(persistedUpgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
      requiresVerification: true
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
      reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
      requiresVerification: true
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
  await expect(fs.readFile(sessionPath, 'utf8')).resolves.toBe(beforeSession);
});

test('upgrade dry-run records slot contract migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-slot-contract-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const beforePlan = await fs.readFile(planPath, 'utf8');

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual(['custom/customer_normalizer.ts', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      target: 'custom/customer_normalizer.ts',
      reason: 'Update customer normalizer input contract to v2.',
      requiresVerification: true
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
  await expect(fs.readFile(upgradePlanPath, 'utf8')).resolves.toContain('mig-customer-normalizer-contract');
});

test('upgrade rejects malformed migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-migration-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  await writeJson(path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0', 'migrations', 'customer-normalizer-contract.json'), {
    id: 'mig-customer-normalizer-contract',
    kind: 'slot-contract-update',
    reason: 'Update customer normalizer input contract to v2.',
    target: 'custom/customer_normalizer.ts'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
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
