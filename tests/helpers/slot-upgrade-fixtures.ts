import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';
import { buildSingleTenantLockApp } from './lock-fixtures.ts';
import { buildPrivatePlanRegistrySource, buildSingleTenantPlanApp } from './plan-fixtures.ts';
import { createWorkspace } from './workspace-fixtures.ts';

type SlotUpgradeDryRunFixtureContext = {
  workspaceRoot: string;
  paths: ReturnType<typeof getWorkspacePaths>;
  versionRoot: string;
};

type SlotUpgradeMigrationFixture = {
  id: string;
  kind: string;
  entry: string;
  requiresVerification: boolean;
  body?: Record<string, unknown>;
};

type SlotUpgradeDryRunFixtureOptions = {
  prefix: string;
  setup?: (context: SlotUpgradeDryRunFixtureContext) => Promise<void>;
} & ({ migration: SlotUpgradeMigrationFixture } | { migrations: SlotUpgradeMigrationFixture[] });

export async function prepareSlotUpgradeDryRunFixture(
  options: SlotUpgradeDryRunFixtureOptions
): Promise<SlotUpgradeDryRunFixtureContext & { beforePlan: string }> {
  const workspaceRoot = await createWorkspace(options.prefix);
  await writeSlotUpgradeFixture(workspaceRoot);

  const paths = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(paths.privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(paths.planPath, 'utf8');
  const migrations = 'migrations' in options ? options.migrations : [options.migration];

  await options.setup?.({ workspaceRoot, paths, versionRoot });
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: migrations.map((migration) => ({
        id: migration.id,
        kind: migration.kind,
        entry: migration.entry,
        fromVersion: '0.1.0',
        toVersion: '0.2.0',
        requiresVerification: migration.requiresVerification
      }))
    }
  });

  for (const migration of migrations) {
    if (migration.body !== undefined) {
      await writeJson(path.join(versionRoot, ...migration.entry.split('/')), migration.body);
    }
  }

  return { workspaceRoot, paths, versionRoot, beforePlan };
}

export async function writeSlotUpgradeFixture(workspaceRoot: string): Promise<void> {
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
    app: buildSingleTenantPlanApp(),
    registry: {
      sources: [buildPrivatePlanRegistrySource()]
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
    app: buildSingleTenantLockApp(),
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
