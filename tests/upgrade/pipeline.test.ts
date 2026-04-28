import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { createWorkspace } from '../helpers/test-utils.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';

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
  await expect(fs.readFile(path.join(workspaceRoot, 'project', 'upgrade.metadata.json'), 'utf8')).resolves.toContain('"auth/basic-session@0.1.1"');

  const persistedUpgradePlan = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'upgrade-plan.json'), 'utf8')
  ) as {
    toVersion: string;
    status: string;
    preflightChecks: Array<{ id: string; status: string; message: string; evidence: string[] }>;
    impacts: string[];
    migrationKindCounts: Record<string, number>;
    migrationSummaries: Array<{
      id: string;
      kind: string;
      source?: string;
      target: string;
      reason: string;
      requiresVerification: boolean;
    }>;
    migrationOperations: Array<{
      id: string;
      kind: string;
      target: string;
      role: string;
      source?: string;
      path?: string[];
      itemCount?: number;
    }>;
  };
  expect(persistedUpgradePlan.toVersion).toBe('0.1.1');
  expect(persistedUpgradePlan.status).toBe('applied');
  expect(persistedUpgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', status: 'passed', evidence: ['0.1.x'] }),
      expect.objectContaining({
        id: 'migration-entries',
        status: 'passed',
        evidence: [
          'mig-auth-session-refresh:migrations/auth-session-refresh.json',
          'mig-auth-session-upgrade-metadata:migrations/auth-session-upgrade-metadata.json'
        ]
      }),
      expect.objectContaining({
        id: 'migration-targets',
        status: 'passed',
        evidence: [
          'mig-auth-session-refresh:target:src/installed/auth/session.ts:exists',
          'mig-auth-session-upgrade-metadata:target:upgrade.metadata.json:missing'
        ]
      }),
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-auth-session-refresh:manifest-source:exists']
      }),
      expect.objectContaining({
        id: 'migration-json-shapes',
        status: 'passed',
        evidence: ['mig-auth-session-upgrade-metadata:path:upgradedBlocks:array:1']
      }),
      expect.objectContaining({
        id: 'migration-json-structure',
        status: 'passed',
        evidence: ['mig-auth-session-upgrade-metadata:target:missing']
      }),
      expect.objectContaining({ id: 'impact-scan', status: 'passed', evidence: ['src/installed/auth/session.ts', 'upgrade.metadata.json'] }),
      expect.objectContaining({ id: 'override-conflicts', status: 'passed', evidence: [] })
    ])
  );
  expect(persistedUpgradePlan.impacts).toEqual(['src/installed/auth/session.ts', 'upgrade.metadata.json']);
  expect(persistedUpgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });
  expect(persistedUpgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
      requiresVerification: true,
      source: 'files/src/installed/auth/session.ts'
    },
    {
      id: 'mig-auth-session-upgrade-metadata',
      kind: 'json-array-append',
      target: 'upgrade.metadata.json',
      reason: 'Record auth session upgrade metadata in package configuration.',
      requiresVerification: false
    }
  ]);
  expect(persistedUpgradePlan.migrationOperations).toEqual([
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      role: 'file',
      source: 'files/src/installed/auth/session.ts'
    },
    {
      id: 'mig-auth-session-upgrade-metadata',
      kind: 'json-array-append',
      target: 'upgrade.metadata.json',
      role: 'json',
      path: ['upgradedBlocks'],
      itemCount: 1
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

test('upgrade advances ticket block version and surfaces runtime upgrade impact', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-ticket-upgrade-');

  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'ticket/basic');
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  const ticketServicePath = path.join(workspaceRoot, 'project', 'src', 'installed', 'ticket', 'ticket-service.ts');
  const beforeUpgrade = await fs.readFile(ticketServicePath, 'utf8');
  expect(beforeUpgrade).not.toMatch(/TICKET_BLOCK_VERSION/);

  const { plan, lock, upgradePlan } = await upgradeWorkspace(workspaceRoot, 'ticket/basic', '0.1.1');

  const plannedTicketBlock = plan.blocks.find((block) => block.id === 'ticket/basic');
  const resolvedTicketBlock = lock.resolvedBlocks.find((block) => block.id === 'ticket/basic');
  expect(plannedTicketBlock?.version).toBe('0.1.1');
  expect(resolvedTicketBlock?.version).toBe('0.1.1');
  expect(lock.passStatus.lock).toBe('succeeded');
  expect(upgradePlan.status).toBe('applied');
  expect(upgradePlan.impacts).toEqual([
    'prisma/schema.prisma',
    'src/installed/ticket/ticket-service.ts',
    'tests/acceptance/ticket-flow.test.ts',
    'tests/unit/ticket-service.test.ts',
    'upgrade.metadata.json'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });

  const afterUpgrade = await fs.readFile(ticketServicePath, 'utf8');
  expect(afterUpgrade).toMatch(/TICKET_BLOCK_VERSION = '0\.1\.1'/);
  const upgradeMetadataPath = path.join(workspaceRoot, 'project', 'upgrade.metadata.json');
  const upgradeMetadata = await fs.readFile(upgradeMetadataPath, 'utf8');
  expect(upgradeMetadata).toContain('"ticket/basic@0.1.1"');

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expect(reviewSummary.conflictHints).toEqual(
    expect.arrayContaining([
      {
        kind: 'upgrade-plan-present',
        relatedId: 'ticket/basic',
        message: 'Upgrade plan applied, verify pending: ticket/basic 0.1.0 -> 0.1.1'
      }
    ])
  );
  expect(reviewSummary.regressionRisks).toEqual(
    expect.arrayContaining([
      {
        kind: 'upgrade-impact',
        blockId: 'ticket/basic',
        message: 'Upgrade ticket/basic impacts src/installed/ticket/ticket-service.ts'
      }
    ])
  );
  expect(
    graph.edges.some(
      (edge) =>
        edge.from === 'block:ticket/basic' &&
        edge.to === 'file:app/tickets/page.tsx' &&
        edge.type === 'writes_to'
    )
  ).toBe(true);
});
