import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LockFile } from '../../src/compiler/contract.ts';
import { rebaseRelativeImports } from '../../src/compiler/source/import-paths.ts';
import { writeJson, writeText } from '../../src/workspace/files.ts';
import {
  getWorkspacePaths,
  resolveWorkspaceArtifactPath,
  toProjectRuntimePath
} from '../../src/workspace/paths.ts';
import { readYaml, writeYaml } from '../../src/workspace/yaml.ts';
import { createWorkspace } from '../testkit/workspace.ts';
import { buildSingleTenantLockApp } from './lock-fixtures.ts';
import { buildPrivatePlanRegistrySource, buildSingleTenantPlanApp } from './plan-fixtures.ts';

const SLOT_UPGRADE_WORKSPACE_FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'slot-upgrade-workspace'
);

async function materializeSlotUpgradeWorkspaceFixture(
  sourceRoot: string,
  targetRoot: string
): Promise<void> {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    if (entry.isDirectory()) {
      await materializeSlotUpgradeWorkspaceFixture(sourcePath, path.join(targetRoot, entry.name));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.fixture')) {
      throw new Error(`Unsupported slot-upgrade fixture entry: ${sourcePath}`);
    }
    const targetPath = path.join(targetRoot, entry.name.slice(0, -'.fixture'.length));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

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

/**
 * 推荐使用的 callback 风格 API：在内部 try/finally 中确保 workspace 立即清理，
 * 不依赖 afterAll 批量清理。
 * 调用方应在 callback 内完成所有测试逻辑（包括 dryRun/apply/断言）。
 */
export async function withSlotUpgradeDryRunFixture<T>(
  options: SlotUpgradeDryRunFixtureOptions,
  callback: (context: SlotUpgradeDryRunFixtureContext & { beforePlan: string }) => Promise<T>
): Promise<T> {
  const context = await prepareSlotUpgradeDryRunFixture(options);
  try {
    const result = await callback(context);
    try {
      await fs.lstat(context.paths.upgradeDiagnosticsPath);
      throw new Error('Upgrade dry-run published a diagnostics artifact');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    return result;
  } finally {
    await fs.rm(context.workspaceRoot, { recursive: true, force: true });
  }
}

export async function writeSlotUpgradeFixture(workspaceRoot: string): Promise<void> {
  const { lockPath, planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const blockId = 'private/slot-contract';
  const slotId = 'customer_normalizer';
  const slotSourcePath = 'source/code/slots/customer_normalizer.ts';
  const slotTargetPath = 'custom/customer_normalizer.ts';
  const blockRoot = path.join(privateRegistryRoot, 'private.slot-contract');
  const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
  const acceptanceId = 'user_can_create_customer';
  const acceptanceContract = {
    id: acceptanceId,
    covers: {
      blocks: [blockId],
      slots: [slotId]
    }
  };
  const baseManifest = {
    id: blockId,
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: ['typescript-library'],
    requires: [],
    provides: [blockId],
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
        id: slotId,
        kind: 'adapter',
        target: slotTargetPath,
        symbol: 'normalizeCustomer',
        inputType: 'CustomerInput',
        outputType: 'NormalizedCustomerInput',
        writableZones: ['custom/']
      }
    ],
    acceptance: [acceptanceContract],
    routes: []
  };

  await writeYaml(planPath, {
    app: buildSingleTenantPlanApp(),
    registry: {
      sources: [buildPrivatePlanRegistrySource()]
    },
    blocks: [{ id: blockId, version: '0.1.0' }],
    slots: [{
      id: slotId,
      block: blockId,
      kind: 'adapter',
      target: slotTargetPath,
      sourcePath: slotSourcePath,
      symbol: 'normalizeCustomer',
      description: 'Normalize customer input through the private slot contract.'
    }],
    acceptance: [{ id: acceptanceId }]
  });
  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), baseManifest);
  await writeYaml(path.join(versionRoot, 'block.manifest.yaml'), {
    ...baseManifest,
    version: '0.2.0',
    slots: [
      {
        id: slotId,
        kind: 'adapter',
        target: slotTargetPath,
        symbol: 'normalizeCustomer',
        inputType: 'NormalizedCustomerInput',
        outputType: 'NormalizedCustomerInput',
        writableZones: ['custom/']
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
    reason: 'Require the customer normalizer to consume normalized input.',
    target: slotTargetPath,
    slotId,
    inputType: 'NormalizedCustomerInput',
    outputType: 'NormalizedCustomerInput',
    writableZones: ['custom/']
  });
  await materializeSlotUpgradeWorkspaceFixture(SLOT_UPGRADE_WORKSPACE_FIXTURE_ROOT, workspaceRoot);
  const authoredSource = await fs.readFile(
    resolveWorkspaceArtifactPath(workspaceRoot, slotSourcePath),
    'utf8'
  );
  await writeText(
    resolveWorkspaceArtifactPath(workspaceRoot, slotTargetPath),
    rebaseRelativeImports(authoredSource, slotSourcePath, toProjectRuntimePath(slotTargetPath))
  );

  const lock: LockFile = {
    formatVersion: '1',
    app: buildSingleTenantLockApp(),
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [acceptanceId],
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
