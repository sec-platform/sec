import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultInstallRegistry } from '../../src/adapters/compilation/compose/install-strategies.ts';
import type { PlanFile } from '../../src/compiler/contract.ts';
import { resolveGraph } from '../../src/adapters/workspace/resolve-graph.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { ensureCanonicalWorkspaceArtifactParents } from '../../src/adapters/workspace/project-base.ts';
import { writeJson } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { readYaml, writeYaml } from '../../src/adapters/workspace/yaml.ts';
import { createWorkspace } from '../testkit/workspace.ts';
import { buildPrivatePlanRegistrySource, buildSingleTenantPlanApp } from './plan-fixtures.ts';

const BLOCK_UPGRADE_WORKSPACE_FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'block-upgrade-workspace'
);

async function materializeBlockUpgradeWorkspaceFixture(sourceRoot: string, targetRoot: string): Promise<void> {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    if (entry.isDirectory()) {
      await materializeBlockUpgradeWorkspaceFixture(sourcePath, path.join(targetRoot, entry.name));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.fixture')) {
      throw new Error(`Unsupported block-upgrade fixture entry: ${sourcePath}`);
    }
    const targetPath = path.join(targetRoot, entry.name.slice(0, -'.fixture'.length));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

type BlockUpgradeDryRunFixtureContext = {
  workspaceRoot: string;
  paths: ReturnType<typeof getWorkspacePaths>;
  versionRoot: string;
};

type BlockUpgradeMigrationFixture = {
  id: string;
  kind: string;
  entry: string;
  requiresVerification: boolean;
  body?: Record<string, unknown>;
};

type BlockUpgradeDryRunFixtureOptions = {
  prefix: string;
  setup?: (context: BlockUpgradeDryRunFixtureContext) => Promise<void>;
} & ({ migration: BlockUpgradeMigrationFixture } | { migrations: BlockUpgradeMigrationFixture[] });

export async function prepareBlockUpgradeDryRunFixture(
  options: BlockUpgradeDryRunFixtureOptions
): Promise<BlockUpgradeDryRunFixtureContext & { beforePlan: string }> {
  const workspaceRoot = await createWorkspace(options.prefix);
  await writeBlockUpgradeFixture(workspaceRoot);
  const paths = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(paths.privateRegistryRoot, 'private.block-upgrade', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(paths.workspaceConfigPath, 'utf8');
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

export async function withBlockUpgradeDryRunFixture<T>(
  options: BlockUpgradeDryRunFixtureOptions,
  callback: (context: BlockUpgradeDryRunFixtureContext & { beforePlan: string }) => Promise<T>
): Promise<T> {
  const context = await prepareBlockUpgradeDryRunFixture(options);
  try {
    const result = await callback(context);
    try {
      await fs.lstat(resolveWorkspaceArtifactPath(context.workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics));
      throw new Error('Upgrade dry-run published a diagnostics artifact');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return result;
  } finally {
    await fs.rm(context.workspaceRoot, { recursive: true, force: true });
  }
}

export async function writeBlockUpgradeFixture(workspaceRoot: string): Promise<void> {
  await ensureCanonicalWorkspaceArtifactParents(workspaceRoot);
  const paths = getWorkspacePaths(workspaceRoot);
  const blockId = 'private/block-upgrade';
  const blockRoot = path.join(paths.privateRegistryRoot, 'private.block-upgrade');
  const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
  const targetPath = 'src/installed/private/customer-normalizer.ts';
  const acceptanceId = 'user_can_create_customer';
  const baseManifest = {
    id: blockId,
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: ['typescript-library'],
    requires: ['tenant/context'],
    provides: [blockId],
    conflicts: [],
    installs: [{
      kind: 'copy', from: 'files/src/installed/private/block-upgrade.ts',
      to: 'src/installed/private/block-upgrade.ts'
    }],
    pins: { inputs: [], outputs: [] },
    acceptance: [{ id: acceptanceId, covers: { blocks: [blockId] } }]
  };
  const plan: PlanFile = {
    app: buildSingleTenantPlanApp(),
    registry: { sources: [buildPrivatePlanRegistrySource()] },
    blocks: [{ id: blockId, version: '0.1.0' }],
    acceptance: [{ id: acceptanceId }]
  };
  await writeYaml(paths.workspaceConfigPath, plan);
  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), baseManifest);
  await writeYaml(path.join(versionRoot, 'block.manifest.yaml'), {
    ...baseManifest,
    version: '0.2.0',
    upgrade: {
      from: ['0.1.x'],
      migrations: [{
        id: 'mig-customer-normalizer-file', kind: 'file-replace',
        entry: 'migrations/customer-normalizer-file.json', fromVersion: '0.1.0',
        toVersion: '0.2.0', requiresVerification: true
      }]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'customer-normalizer-file.json'), {
    id: 'mig-customer-normalizer-file', kind: 'file-replace',
    reason: 'Replace the block-owned customer normalization implementation.',
    source: 'files/src/installed/private/customer-normalizer.ts', target: targetPath
  });
  await materializeBlockUpgradeWorkspaceFixture(BLOCK_UPGRADE_WORKSPACE_FIXTURE_ROOT, workspaceRoot);
  const lock = await resolveGraph(workspaceRoot, plan);
  await defaultInstallRegistry.executeAll(lock.installPlan, { workspaceRoot, lock });
  await writeJson(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock), lock);
}
