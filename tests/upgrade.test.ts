import { afterAll, expect, test } from 'vitest';
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
} from '../platform/orchestrator.ts';
import { writeJson } from '../platform/shared/fs.ts';
import { applyMigrationEntries } from '../platform/upgrade/upgrade-workspace.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import type { LockFile } from '../platform/shared/types.ts';
import { readYaml, writeYaml } from '../platform/shared/yaml.ts';

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
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, prefix));
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

test('upgrade advances ticket block version and surfaces runtime upgrade impact', { timeout: 240000 }, async () => {
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

test('upgrade dry-run writes a planned upgrade without changing project files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-dry-run-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  const { lockPath, provenancePath } = getWorkspacePaths(workspaceRoot);
  const planPath = path.join(workspaceRoot, 'project', 'app.plan.yaml');
  const sessionPath = path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts');
  const beforePlan = await fs.readFile(planPath, 'utf8');
  const beforeSession = await fs.readFile(sessionPath, 'utf8');

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', status: 'passed' }),
      expect.objectContaining({ id: 'migration-entries', status: 'passed' }),
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
      expect.objectContaining({ id: 'impact-scan', status: 'passed' }),
      expect.objectContaining({ id: 'override-conflicts', status: 'passed' })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
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
  expect(upgradePlan.migrationOperations).toEqual([
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
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
  await expect(fs.readFile(sessionPath, 'utf8')).resolves.toBe(beforeSession);

  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
  expect(lock.generatedPaths).toContain('generated/upgrade-plan.json');
  const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
    artifacts: Array<{ path: string; generatedByPass?: string }>;
  };
  expect(provenance.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'generated/upgrade-plan.json', generatedByPass: 'upgrade' })
    ])
  );
});

test('upgrade dry-run records slot contract migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-slot-contract-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const beforePlan = await fs.readFile(planPath, 'utf8');

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.migrationKindCounts).toEqual({
    'slot-contract-update': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', evidence: ['0.1.x'] }),
      expect.objectContaining({ id: 'migration-entries', evidence: ['mig-customer-normalizer-contract:migrations/customer-normalizer-contract.json'] }),
      expect.objectContaining({
        id: 'migration-slot-contracts',
        evidence: [
          'mig-customer-normalizer-contract:inputType:CustomerInputV2',
          'mig-customer-normalizer-contract:outputType:CustomerRecordInput',
          'mig-customer-normalizer-contract:slot:customer_normalizer',
          'mig-customer-normalizer-contract:target:custom/customer_normalizer.ts',
          'mig-customer-normalizer-contract:writableZones:custom/customer_normalizer.ts'
        ]
      }),
      expect.objectContaining({ id: 'impact-scan', evidence: ['custom/customer_normalizer.ts', 'src/installed/private/slot-contract.ts'] }),
      expect.objectContaining({ id: 'override-conflicts', evidence: [] })
    ])
  );
  expect(upgradePlan.impacts).toEqual(['custom/customer_normalizer.ts', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      target: 'custom/customer_normalizer.ts',
      reason: 'Update customer normalizer input contract to v2.',
      requiresVerification: true,
      slotId: 'customer_normalizer'
    }
  ]);
  expect(upgradePlan.migrationOperations).toEqual([
    {
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      target: 'custom/customer_normalizer.ts',
      role: 'slot',
      slotId: 'customer_normalizer',
      inputType: 'CustomerInputV2',
      outputType: 'CustomerRecordInput',
      writableZones: ['custom/customer_normalizer.ts']
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
  await expect(fs.readFile(upgradePlanPath, 'utf8')).resolves.toContain('mig-customer-normalizer-contract');
});

test('upgrade apply writes diagnostics when migration execution fails after planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-apply-diagnostics-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const beforePlan = await fs.readFile(planPath, 'utf8');

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0')).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-016'
  });
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    phase: string;
    failedCheck: string;
    errorCode: string;
    message: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    phase: 'apply',
    failedCheck: 'migration-file-operations',
    errorCode: 'UPGRADE-MIGRATION-016',
    message: 'slot-contract-update target "custom/customer_normalizer.ts" is missing',
    details: {
      migrationId: 'mig-customer-normalizer-contract',
      migrationKind: 'slot-contract-update',
      slotId: 'customer_normalizer',
      target: 'custom/customer_normalizer.ts'
    }
  });
});

test('upgrade dry-run records create directory migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-create-directory-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-create-snapshots-dir',
          kind: 'create-directory',
          entry: 'migrations/create-snapshots-dir.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  const migrationPath = path.join(versionRoot, 'migrations', 'create-snapshots-dir.json');
  await writeJson(migrationPath, {
    id: 'mig-create-snapshots-dir',
    kind: 'create-directory',
    reason: 'Create snapshot directory for generated reports.',
    target: 'generated/reports/snapshots'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/snapshots',
    'src/installed/private/slot-contract.ts'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'create-directory': 1
  });
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-create-snapshots-dir',
      kind: 'create-directory',
      target: 'generated/reports/snapshots',
      reason: 'Create snapshot directory for generated reports.',
      requiresVerification: false
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run rejects create directory migrations when target is a file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-create-directory-file-target-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-create-snapshots-dir',
          kind: 'create-directory',
          entry: 'migrations/create-snapshots-dir.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'create-snapshots-dir.json'), {
    id: 'mig-create-snapshots-dir',
    kind: 'create-directory',
    reason: 'Create snapshot directory for generated reports.',
    target: 'generated/reports/snapshots'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'snapshots'), {
    occupied: true
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-028'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade dry-run records delete file migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-file-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-delete-obsolete-report',
          kind: 'delete-file',
          entry: 'migrations/delete-obsolete-report.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  const migrationPath = path.join(
    versionRoot,
    'migrations',
    'delete-obsolete-report.json'
  );
  await writeJson(migrationPath, {
    id: 'mig-delete-obsolete-report',
    kind: 'delete-file',
    reason: 'Remove obsolete generated report from previous upgrades.',
    target: 'generated/reports/obsolete.json'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete.json'), {
    status: 'obsolete'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/obsolete.json',
    'src/installed/private/slot-contract.ts'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'delete-file': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-delete-obsolete-report:target:file']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-delete-obsolete-report',
      kind: 'delete-file',
      target: 'generated/reports/obsolete.json',
      reason: 'Remove obsolete generated report from previous upgrades.',
      requiresVerification: false
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run records delete directory migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-directory-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-delete-obsolete-report-dir',
          kind: 'delete-directory',
          entry: 'migrations/delete-obsolete-report-dir.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'delete-obsolete-report-dir.json'), {
    id: 'mig-delete-obsolete-report-dir',
    kind: 'delete-directory',
    reason: 'Remove obsolete generated report directory from previous upgrades.',
    target: 'generated/reports/obsolete'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
    status: 'obsolete'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/obsolete',
    'src/installed/private/slot-contract.ts'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'delete-directory': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-delete-obsolete-report-dir:target:directory']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-delete-obsolete-report-dir',
      kind: 'delete-directory',
      target: 'generated/reports/obsolete',
      reason: 'Remove obsolete generated report directory from previous upgrades.',
      requiresVerification: false
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('delete directory migrations remove project directories recursively', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-directory-apply-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
    status: 'obsolete'
  });

  await applyMigrationEntries(
    projectRoot,
    projectRoot,
    ['generated/reports/obsolete'],
    [
      {
        id: 'mig-delete-obsolete-report-dir',
        kind: 'delete-directory',
        reason: 'Remove obsolete generated report directory from previous upgrades.',
        target: 'generated/reports/obsolete'
      }
    ]
  );

  await expect(
    fs.readFile(
      path.join(projectRoot, 'generated', 'reports', 'obsolete', 'daily.json'),
      'utf8'
    )
  ).rejects.toThrow();
});

test('upgrade rejects delete directory migrations when target is not a directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-directory-file-target-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-delete-obsolete-report-dir',
          kind: 'delete-directory',
          entry: 'migrations/delete-obsolete-report-dir.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'delete-obsolete-report-dir.json'), {
    id: 'mig-delete-obsolete-report-dir',
    kind: 'delete-directory',
    reason: 'Remove obsolete generated report directory from previous upgrades.',
    target: 'generated/reports/obsolete'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete'), {
    status: 'not-a-directory'
  });

  await expect(
    upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })
  ).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-026'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain(
    '"failedCheck": "migration-file-operations"'
  );
});

test('upgrade dry-run records copy directory migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          entry: 'migrations/copy-report-templates.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-templates.json'), {
    id: 'mig-copy-report-templates',
    kind: 'copy-directory',
    reason: 'Copy report templates into generated report assets.',
    source: 'files/generated/reports/templates',
    target: 'generated/reports/templates'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
    report: 'daily'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/templates',
    'src/installed/private/slot-contract.ts'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'copy-directory': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-copy-report-templates:manifest-source:directory']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-copy-report-templates',
      kind: 'copy-directory',
      target: 'generated/reports/templates',
      reason: 'Copy report templates into generated report assets.',
      requiresVerification: false,
      source: 'files/generated/reports/templates'
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run rejects copy directory migrations when target is a file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-file-target-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          entry: 'migrations/copy-report-templates.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-templates.json'), {
    id: 'mig-copy-report-templates',
    kind: 'copy-directory',
    reason: 'Copy report templates into generated report assets.',
    source: 'files/generated/reports/templates',
    target: 'generated/reports/templates'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
    report: 'daily'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'templates'), {
    occupied: true
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-027'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade dry-run records copy file migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-file-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-schema',
          kind: 'copy-file',
          entry: 'migrations/copy-report-schema.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-schema.json'), {
    id: 'mig-copy-report-schema',
    kind: 'copy-file',
    reason: 'Copy report schema into generated report assets.',
    source: 'files/generated/reports/schema.json',
    target: 'generated/reports/schema.json'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'schema.json'), {
    schema: 'report-v2'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/schema.json',
    'src/installed/private/slot-contract.ts'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'copy-file': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-copy-report-schema:manifest-source:file']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-copy-report-schema',
      kind: 'copy-file',
      target: 'generated/reports/schema.json',
      reason: 'Copy report schema into generated report assets.',
      requiresVerification: false,
      source: 'files/generated/reports/schema.json'
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('copy file migrations copy manifest files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-file-apply-');
  const { privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );

  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'schema.json'), {
    schema: 'report-v2'
  });

  await applyMigrationEntries(
    projectRoot,
    versionRoot,
    ['generated/reports/schema.json'],
    [
      {
        id: 'mig-copy-report-schema',
        kind: 'copy-file',
        reason: 'Copy report schema into generated report assets.',
        source: 'files/generated/reports/schema.json',
        target: 'generated/reports/schema.json'
      }
    ]
  );

  await expect(
    fs.readFile(path.join(projectRoot, 'generated', 'reports', 'schema.json'), 'utf8')
  ).resolves.toContain('"schema": "report-v2"');
});

test('upgrade rejects copy file migrations when manifest source is not a file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-file-directory-source-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-schema',
          kind: 'copy-file',
          entry: 'migrations/copy-report-schema.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-schema.json'), {
    id: 'mig-copy-report-schema',
    kind: 'copy-file',
    reason: 'Copy report schema into generated report assets.',
    source: 'files/generated/reports/schema',
    target: 'generated/reports/schema.json'
  });
  await fs.mkdir(path.join(versionRoot, 'files', 'generated', 'reports', 'schema'), {
    recursive: true
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-024'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('copy directory migrations recursively copy manifest directories', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-apply-');
  const { privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );

  await fs.mkdir(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'nested'), {
    recursive: true
  });
  await fs.writeFile(
    path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.md'),
    '# Daily report\n',
    'utf8'
  );
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'nested', 'weekly.json'), {
    report: 'weekly'
  });

  await applyMigrationEntries(
    projectRoot,
    versionRoot,
    ['generated/reports/templates'],
    [
      {
        id: 'mig-copy-report-templates',
        kind: 'copy-directory',
        reason: 'Copy report templates into generated report assets.',
        source: 'files/generated/reports/templates',
        target: 'generated/reports/templates'
      }
    ]
  );

  await expect(fs.readFile(path.join(projectRoot, 'generated', 'reports', 'templates', 'daily.md'), 'utf8')).resolves.toBe(
    '# Daily report\n'
  );
  await expect(
    fs.readFile(path.join(projectRoot, 'generated', 'reports', 'templates', 'nested', 'weekly.json'), 'utf8')
  ).resolves.toContain('"report": "weekly"');
});

test('upgrade rejects copy directory migrations when manifest source is missing', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-missing-source-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          entry: 'migrations/copy-report-templates.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-templates.json'), {
    id: 'mig-copy-report-templates',
    kind: 'copy-directory',
    reason: 'Copy report templates into generated report assets.',
    source: 'files/generated/reports/missing-templates',
    target: 'generated/reports/templates'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-008'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade rejects copy directory migrations when manifest source is not a directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-file-source-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          entry: 'migrations/copy-report-templates.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-templates.json'), {
    id: 'mig-copy-report-templates',
    kind: 'copy-directory',
    reason: 'Copy report templates into generated report assets.',
    source: 'files/generated/reports/templates.json',
    target: 'generated/reports/templates'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates.json'), {
    report: 'not-a-directory'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-023'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade dry-run records rename file migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-rename-file-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-rename-report',
          kind: 'rename-file',
          entry: 'migrations/rename-report.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  const migrationPath = path.join(
    versionRoot,
    'migrations',
    'rename-report.json'
  );
  await writeJson(migrationPath, {
    id: 'mig-rename-report',
    kind: 'rename-file',
    reason: 'Move generated report into archive directory.',
    source: 'generated/reports/current.json',
    target: 'generated/reports/archive/current.json'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'current.json'), {
    status: 'current'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/archive/current.json',
    'generated/reports/current.json',
    'src/installed/private/slot-contract.ts'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'rename-file': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: [
          'mig-rename-report:source:file',
          'mig-rename-report:target:available'
        ]
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-rename-report',
      kind: 'rename-file',
      target: 'generated/reports/archive/current.json',
      reason: 'Move generated report into archive directory.',
      requiresVerification: false,
      source: 'generated/reports/current.json'
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade records missing migration entry diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-missing-migration-entry-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-missing-entry-file',
          kind: 'text-append',
          entry: 'migrations/missing-entry-file.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-002',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-missing-entry-file',
      migrationKind: 'text-append',
      entry: 'migrations/missing-entry-file.json'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-002',
    details: {
      migrationId: 'mig-missing-entry-file',
      migrationKind: 'text-append',
      entry: 'migrations/missing-entry-file.json'
    }
  });
});

test('upgrade records mismatched migration entry metadata diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-mismatched-migration-entry-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-expected-entry',
          kind: 'text-append',
          entry: 'migrations/mismatched-entry.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'mismatched-entry.json'), {
    id: 'mig-actual-entry',
    kind: 'text-replace',
    reason: 'Use mismatched metadata.',
    target: 'generated/reports/notes.md',
    search: 'pending',
    replacement: 'applied'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-003',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-expected-entry',
      migrationKind: 'text-append',
      entry: 'migrations/mismatched-entry.json',
      entryId: 'mig-actual-entry',
      entryKind: 'text-replace'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-003',
    details: {
      migrationId: 'mig-expected-entry',
      migrationKind: 'text-append',
      entry: 'migrations/mismatched-entry.json',
      entryId: 'mig-actual-entry',
      entryKind: 'text-replace'
    }
  });
});

test('upgrade rejects duplicate migration ids before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-duplicate-migration-id-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-duplicate-report',
          kind: 'text-append',
          entry: 'migrations/append-report-a.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        },
        {
          id: 'mig-duplicate-report',
          kind: 'text-append',
          entry: 'migrations/append-report-b.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'append-report-a.json'), {
    id: 'mig-duplicate-report',
    kind: 'text-append',
    reason: 'Append first report note.',
    target: 'generated/reports/notes.md',
    content: '- first note\n'
  });
  await writeJson(path.join(versionRoot, 'migrations', 'append-report-b.json'), {
    id: 'mig-duplicate-report',
    kind: 'text-append',
    reason: 'Append second report note.',
    target: 'generated/reports/notes.md',
    content: '- second note\n'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-029',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-duplicate-report',
      entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-029',
    details: {
      migrationId: 'mig-duplicate-report',
      entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
    }
  });
});

test('upgrade records migration target path escape diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-target-escape-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-target-escape',
          kind: 'text-append',
          entry: 'migrations/target-escape.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'target-escape.json'), {
    id: 'mig-target-escape',
    kind: 'text-append',
    reason: 'Attempt to write outside the generated project.',
    target: '../outside-project.md',
    content: '- should be rejected.\n'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-004',
    details: {
      failedCheck: 'migration-targets',
      migrationId: 'mig-target-escape',
      path: '../outside-project.md',
      role: 'target',
      root: 'project'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    details: {
      failedCheck: 'migration-targets',
      migrationId: 'mig-target-escape',
      path: '../outside-project.md',
      role: 'target',
      root: 'project'
    }
  });
});

test('upgrade records migration manifest source escape diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-source-escape-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-source-escape',
          kind: 'file-replace',
          entry: 'migrations/source-escape.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'source-escape.json'), {
    id: 'mig-source-escape',
    kind: 'file-replace',
    reason: 'Attempt to read outside the target manifest root.',
    source: '../outside-source.ts',
    target: 'src/installed/private/slot-contract.ts'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-005',
    details: {
      failedCheck: 'migration-file-operations',
      migrationId: 'mig-source-escape',
      path: '../outside-source.ts',
      role: 'manifest-source',
      root: 'manifest'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-file-operations',
    errorCode: 'UPGRADE-MIGRATION-005',
    details: {
      failedCheck: 'migration-file-operations',
      migrationId: 'mig-source-escape',
      path: '../outside-source.ts',
      role: 'manifest-source',
      root: 'manifest'
    }
  });
});

test('upgrade rejects missing delete file targets before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-file-missing-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-delete-missing-report',
          kind: 'delete-file',
          entry: 'migrations/delete-missing-report.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'delete-missing-report.json'), {
    id: 'mig-delete-missing-report',
    kind: 'delete-file',
    reason: 'Remove obsolete generated report from previous upgrades.',
    target: 'generated/reports/missing.json'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-016'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade rejects occupied rename file targets before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-rename-file-occupied-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-rename-report-occupied',
          kind: 'rename-file',
          entry: 'migrations/rename-report-occupied.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'rename-report-occupied.json'), {
    id: 'mig-rename-report-occupied',
    kind: 'rename-file',
    reason: 'Move generated report into archive directory.',
    source: 'generated/reports/current.json',
    target: 'generated/reports/archive/current.json'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'current.json'), {
    status: 'current'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'archive', 'current.json'), {
    status: 'occupied'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-020'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade dry-run records text append migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-append-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes',
          kind: 'text-append',
          entry: 'migrations/upgrade-notes.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes.json'), {
    id: 'mig-upgrade-notes',
    kind: 'text-append',
    reason: 'Append upgrade notes.',
    target: 'docs/upgrade-notes.md',
    content: '- text append migration applied.\n'
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual(['docs/upgrade-notes.md', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'text-append': 1
  });
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-upgrade-notes',
      kind: 'text-append',
      target: 'docs/upgrade-notes.md',
      reason: 'Append upgrade notes.',
      requiresVerification: false
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade rejects text append migrations when target is a directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-append-directory-target-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes',
          kind: 'text-append',
          entry: 'migrations/upgrade-notes.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes.json'), {
    id: 'mig-upgrade-notes',
    kind: 'text-append',
    reason: 'Append upgrade notes.',
    target: 'docs/upgrade-notes.md',
    content: '- text append migration applied.\n'
  });
  await fs.mkdir(path.join(projectRoot, 'docs', 'upgrade-notes.md'), { recursive: true });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-017'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade dry-run records literal text replace migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-replace-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          entry: 'migrations/upgrade-notes-literal.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: true
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-literal.json'), {
    id: 'mig-upgrade-notes-literal',
    kind: 'text-replace',
    reason: 'Replace upgrade notes marker literally.',
    target: 'docs/upgrade-notes.md',
    search: 'status: pending',
    replacement: 'status: applied'
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual(['docs/upgrade-notes.md', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'text-replace': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-text-patterns',
        status: 'passed',
        evidence: ['mig-upgrade-notes-literal:literal:15']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-upgrade-notes-literal',
      kind: 'text-replace',
      target: 'docs/upgrade-notes.md',
      reason: 'Replace upgrade notes marker literally.',
      requiresVerification: true
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('literal text replace migrations update all matching text', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-replace-apply-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const targetPath = path.join(projectRoot, 'docs', 'upgrade-notes.md');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, 'status: pending\nnext: pending\n', 'utf8');

  await applyMigrationEntries(projectRoot, projectRoot, ['docs/upgrade-notes.md'], [
    {
      id: 'mig-upgrade-notes-literal',
      kind: 'text-replace',
      reason: 'Replace upgrade notes marker literally.',
      target: 'docs/upgrade-notes.md',
      search: 'pending',
      replacement: 'applied'
    }
  ]);

  await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('status: applied\nnext: applied\n');
});

test('upgrade rejects malformed literal text replace migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-text-replace-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          entry: 'migrations/upgrade-notes-literal.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-literal.json'), {
    id: 'mig-upgrade-notes-literal',
    kind: 'text-replace',
    reason: 'Replace upgrade notes marker literally.',
    target: 'docs/upgrade-notes.md',
    replacement: 'status: applied'
  });

  await expect(
    upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })
  ).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-upgrade-notes-literal',
      migrationKind: 'text-replace',
      entry: 'migrations/upgrade-notes-literal.json'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-011',
    details: {
      migrationId: 'mig-upgrade-notes-literal',
      migrationKind: 'text-replace',
      entry: 'migrations/upgrade-notes-literal.json'
    }
  });
});

test('upgrade rejects literal text replace migrations when search text is missing', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-replace-missing-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'status: already-applied\n', 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          entry: 'migrations/upgrade-notes-literal.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-literal.json'), {
    id: 'mig-upgrade-notes-literal',
    kind: 'text-replace',
    reason: 'Replace upgrade notes marker literally.',
    target: 'docs/upgrade-notes.md',
    search: 'status: pending',
    replacement: 'status: applied'
  });

  await expect(
    upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })
  ).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-015'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain(
    '"failedCheck": "migration-text-patterns"'
  );
});

test('upgrade dry-run records text replace regex migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-regex-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-regex',
          kind: 'text-replace-regex',
          entry: 'migrations/upgrade-notes-regex.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: true
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-regex.json'), {
    id: 'mig-upgrade-notes-regex',
    kind: 'text-replace-regex',
    reason: 'Replace upgrade notes marker.',
    target: 'docs/upgrade-notes.md',
    pattern: 'status: pending',
    replacement: 'status: applied'
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual(['docs/upgrade-notes.md', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'text-replace-regex': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-text-patterns',
        status: 'passed',
        evidence: ['mig-upgrade-notes-regex:flags:g']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-upgrade-notes-regex',
      kind: 'text-replace-regex',
      target: 'docs/upgrade-notes.md',
      reason: 'Replace upgrade notes marker.',
      requiresVerification: true
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade rejects malformed text replace regex migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-text-regex-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-regex',
          kind: 'text-replace-regex',
          entry: 'migrations/upgrade-notes-regex.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-regex.json'), {
    id: 'mig-upgrade-notes-regex',
    kind: 'text-replace-regex',
    reason: 'Replace upgrade notes marker.',
    target: 'docs/upgrade-notes.md',
    pattern: 'status: pending'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});

test('upgrade rejects invalid text replace regex patterns before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-invalid-text-regex-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-regex',
          kind: 'text-replace-regex',
          entry: 'migrations/upgrade-notes-regex.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-regex.json'), {
    id: 'mig-upgrade-notes-regex',
    kind: 'text-replace-regex',
    reason: 'Replace upgrade notes marker.',
    target: 'docs/upgrade-notes.md',
    pattern: 'status: (pending',
    replacement: 'status: applied'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-014'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-text-patterns"');
});

test('upgrade rejects empty config rewrite paths before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-empty-config-path-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-empty-config-path',
          kind: 'config-rewrite',
          entry: 'migrations/empty-config-path.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'empty-config-path.json'), {
    id: 'mig-empty-config-path',
    kind: 'config-rewrite',
    reason: 'Reject config rewrites without a concrete target path.',
    target: 'package.json',
    updates: [
      {
        path: [],
        value: 'invalid'
      }
    ]
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-010',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-empty-config-path',
      migrationKind: 'config-rewrite',
      entry: 'migrations/empty-config-path.json'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-010',
    details: {
      migrationId: 'mig-empty-config-path',
      migrationKind: 'config-rewrite',
      entry: 'migrations/empty-config-path.json'
    }
  });
});

test('upgrade rejects malformed text append migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-text-append-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes',
          kind: 'text-append',
          entry: 'migrations/upgrade-notes.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes.json'), {
    id: 'mig-upgrade-notes',
    kind: 'text-append',
    reason: 'Append upgrade notes.',
    target: 'docs/upgrade-notes.md'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});

test('upgrade rejects JSON array structure mismatches before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-json-structure-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-json-array-append',
          kind: 'json-array-append',
          entry: 'migrations/json-array-append.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(projectRoot, 'upgrade.metadata.json'), {
    upgradedBlocks: 'auth/basic-session@0.1.0'
  });
  await writeJson(path.join(versionRoot, 'migrations', 'json-array-append.json'), {
    id: 'mig-json-array-append',
    kind: 'json-array-append',
    reason: 'Append upgrade metadata.',
    target: 'upgrade.metadata.json',
    path: ['upgradedBlocks'],
    items: ['private/slot-contract@0.2.0']
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-012'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-json-structure"');
});

test('upgrade rejects JSON array parent structure mismatches before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-json-parent-structure-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-json-array-append-nested',
          kind: 'json-array-append',
          entry: 'migrations/json-array-append-nested.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(projectRoot, 'upgrade.metadata.json'), {
    upgrade: 'legacy-scalar'
  });
  await writeJson(path.join(versionRoot, 'migrations', 'json-array-append-nested.json'), {
    id: 'mig-json-array-append-nested',
    kind: 'json-array-append',
    reason: 'Append nested upgrade metadata.',
    target: 'upgrade.metadata.json',
    path: ['upgrade', 'blocks'],
    items: ['private/slot-contract@0.2.0']
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-012'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-json-structure"');
});

test('upgrade rejects slot contract mismatches before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-slot-contract-mismatch-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0', 'migrations', 'customer-normalizer-contract.json'), {
    id: 'mig-customer-normalizer-contract',
    kind: 'slot-contract-update',
    reason: 'Update customer normalizer input contract to v2.',
    target: 'custom/customer_normalizer.ts',
    slotId: 'customer_normalizer',
    inputType: 'CustomerInputV3',
    outputType: 'CustomerRecordInput',
    writableZones: ['custom/customer_normalizer.ts']
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-021'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-slot-contracts"');
});

test('upgrade rejects malformed migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-migration-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0', 'migrations', 'customer-normalizer-contract.json'), {
    id: 'mig-customer-normalizer-contract',
    kind: 'slot-contract-update',
    reason: 'Update customer normalizer input contract to v2.',
    target: 'custom/customer_normalizer.ts'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});

test('upgrade is blocked when a manual override conflicts with impacted files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-conflict-');
  const { lockPath, overrideManifestPath, provenancePath, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);

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
  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    status: string;
    failedCheck: string;
    errorCode: string;
    message: string;
  };
  expect(diagnostics).toMatchObject({
    status: 'blocked',
    failedCheck: 'override-conflicts',
    errorCode: 'UPGRADE-CONFLICT-001'
  });
  expect(diagnostics.message).toContain('manual-auth-session-hotfix');
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
  expect(lock.generatedPaths).toContain('generated/upgrade-diagnostics.json');
  const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
    artifacts: Array<{ path: string; generatedByPass?: string }>;
  };
  expect(provenance.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'generated/upgrade-diagnostics.json', generatedByPass: 'upgrade' })
    ])
  );
});
