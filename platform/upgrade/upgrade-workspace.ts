import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeProject } from '../compiler/compose/compose-project.ts';
import { lockProject } from '../compiler/emit/lock-project.ts';
import { writeProvenance } from '../compiler/emit/write-provenance.ts';
import { loadManifestById } from '../compiler/parse/load-manifest.ts';
import { loadOverrideManifest } from '../compiler/parse/load-override-manifest.ts';
import { loadPlan } from '../compiler/parse/load-plan.ts';
import { resolveGraph } from '../compiler/resolve/resolve-graph.ts';
import { adaptProject } from '../compiler/synthesize/adapt-project.ts';
import { validateResolvedTemplates } from '../compiler/verify/validate-resolved-templates.ts';
import { verifyProject } from '../compiler/verify/verify-project.ts';
import { CompilerError } from '../shared/errors.ts';
import { copyRecursive, ensureDir, pathExists, readJson, removeDir, writeJson } from '../shared/fs.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { writeYaml } from '../shared/yaml.ts';
import type { LockFile, PlanFile, UpgradeMigration, UpgradeMigrationEntry, UpgradePlan } from '../shared/types.ts';

function matchesUpgradeRange(version: string, range: string): boolean {
  if (range === version) {
    return true;
  }
  if (/^\d+\.\d+\.x$/.test(range)) {
    const prefix = range.slice(0, -1);
    return version.startsWith(prefix);
  }
  return false;
}

function ensureUpgradeAllowed(currentVersion: string, targetVersion: string, migrations: UpgradeMigration[], from: string[]): void {
  if (currentVersion === targetVersion) {
    throw new CompilerError('UPGRADE-NOOP-001', `Block is already at version "${targetVersion}"`);
  }
  if (from.length === 0) {
    throw new CompilerError('UPGRADE-BLOCKED-001', `Target version "${targetVersion}" does not support automatic upgrade`);
  }
  if (!from.some((range) => matchesUpgradeRange(currentVersion, range))) {
    throw new CompilerError(
      'UPGRADE-BLOCKED-002',
      `Target version "${targetVersion}" does not accept upgrade from "${currentVersion}"`
    );
  }
  for (const migration of migrations) {
    if (!migration.entry) {
      throw new CompilerError('UPGRADE-MIGRATION-001', `Migration "${migration.id}" is missing entry`);
    }
  }
}

async function detectOverrideConflicts(workspaceRoot: string, blockId: string, impacts: string[]): Promise<void> {
  const manifest = await loadOverrideManifest(workspaceRoot);
  const conflictingOverride = manifest.overrides.find(
    (entry) =>
      impacts.includes(entry.target) ||
      entry.conflictsWith?.some((candidate) => candidate.startsWith(`${blockId}@`))
  );

  if (conflictingOverride) {
    throw new CompilerError(
      'UPGRADE-CONFLICT-001',
      `Override "${conflictingOverride.id}" conflicts with upgrade of "${blockId}"`,
      conflictingOverride
    );
  }
}

async function loadMigrationEntries(
  targetManifestRoot: string,
  blockId: string,
  targetVersion: string,
  migrations: UpgradeMigration[]
): Promise<UpgradeMigrationEntry[]> {
  const entries: UpgradeMigrationEntry[] = [];
  for (const migration of migrations) {
    const entryPath = path.join(targetManifestRoot, migration.entry);
    if (!(await pathExists(entryPath))) {
      throw new CompilerError(
        'UPGRADE-MIGRATION-002',
        `Migration entry "${migration.entry}" for "${blockId}@${targetVersion}" is missing`
      );
    }
    const entry = await readJson<UpgradeMigrationEntry>(entryPath);
    if (entry.id !== migration.id || entry.kind !== migration.kind) {
      throw new CompilerError('UPGRADE-MIGRATION-003', `Migration entry "${migration.entry}" does not match manifest metadata`);
    }
    entries.push(entry);
  }
  return entries;
}

function resolveProjectPath(projectRoot: string, relativePath: string): string {
  const resolvedPath = path.resolve(projectRoot, relativePath);
  const projectRootWithSeparator = `${projectRoot}${path.sep}`;
  if (resolvedPath !== projectRoot && !resolvedPath.startsWith(projectRootWithSeparator)) {
    throw new CompilerError('UPGRADE-MIGRATION-004', `Migration path "${relativePath}" escapes project root`);
  }
  return resolvedPath;
}

function resolveManifestPath(manifestRoot: string, relativePath: string): string {
  const resolvedPath = path.resolve(manifestRoot, relativePath);
  const manifestRootWithSeparator = `${manifestRoot}${path.sep}`;
  if (resolvedPath !== manifestRoot && !resolvedPath.startsWith(manifestRootWithSeparator)) {
    throw new CompilerError('UPGRADE-MIGRATION-005', `Migration source "${relativePath}" escapes manifest root`);
  }
  return resolvedPath;
}

function applyConfigUpdates(config: unknown, updates: Array<{ path: string[]; value: unknown }>): unknown {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new CompilerError('UPGRADE-MIGRATION-009', 'Config rewrite target must contain a JSON object');
  }

  for (const update of updates) {
    if (update.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'Config rewrite path must not be empty');
    }
    let current: Record<string, unknown> = config as Record<string, unknown>;
    for (const segment of update.path.slice(0, -1)) {
      const next = current[segment];
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
    current[update.path[update.path.length - 1]] = update.value;
  }

  return config;
}

export async function applyMigrationEntries(
  projectRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entries: UpgradeMigrationEntry[]
): Promise<void> {
  for (const entry of entries) {
    if (!impacts.includes(entry.target)) {
      throw new CompilerError('UPGRADE-MIGRATION-007', `Migration target "${entry.target}" is outside upgrade impacts`);
    }
    const targetPath = resolveProjectPath(projectRoot, entry.target);

    if (entry.kind === 'file-replace') {
      const sourcePath = resolveManifestPath(targetManifestRoot, entry.source);
      if (!(await pathExists(sourcePath))) {
        throw new CompilerError('UPGRADE-MIGRATION-008', `Migration source "${entry.source}" is missing`);
      }
      await ensureDir(path.dirname(targetPath));
      await fs.copyFile(sourcePath, targetPath);
      continue;
    }

    if (entry.kind === 'config-rewrite') {
      const config = applyConfigUpdates(await readJson<unknown>(targetPath), entry.updates);
      await writeJson(targetPath, config);
      continue;
    }

    const unsupportedEntry = entry as { kind: string };
    throw new CompilerError('UPGRADE-MIGRATION-006', `Unsupported migration kind "${unsupportedEntry.kind}"`);
  }
}

function buildUpgradePlan(
  blockId: string,
  fromVersion: string,
  toVersion: string,
  impacts: string[],
  migrations: UpgradeMigration[],
  migrationEntries: UpgradeMigrationEntry[]
): UpgradePlan {
  return {
    formatVersion: '1',
    blockId,
    fromVersion,
    toVersion,
    status: 'planned',
    impacts,
    migrations,
    migrationSummaries: migrationEntries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      reason: entry.reason
    }))
  };
}

async function snapshotProject(projectRoot: string): Promise<string> {
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-'));
  await copyRecursive(projectRoot, backupRoot);
  return backupRoot;
}

async function restoreProject(projectRoot: string, backupRoot: string): Promise<void> {
  await removeDir(projectRoot);
  await copyRecursive(backupRoot, projectRoot);
}

export async function upgradeWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  options: { dryRun?: boolean } = {}
): Promise<{ plan: PlanFile; lock: LockFile; upgradePlan: UpgradePlan }> {
  const { projectRoot, planPath, lockPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  if (!currentBlock?.version) {
    throw new CompilerError('UPGRADE-BLOCKED-003', `Block "${blockId}" is not declared in app.plan.yaml`);
  }

  const currentVersion = currentBlock.version;
  const targetEntry = await loadManifestById(blockId, {
    workspaceRoot,
    version: targetVersion,
    registrySources: plan.registry.sources
  });
  const impacts = targetEntry.manifest.installs.map((install) => install.to);
  const migrations = targetEntry.manifest.upgrade?.migrations ?? [];
  ensureUpgradeAllowed(currentVersion, targetVersion, migrations, targetEntry.manifest.upgrade?.from ?? []);
  await detectOverrideConflicts(workspaceRoot, blockId, impacts);
  const targetManifestRoot = path.dirname(targetEntry.manifestPath);
  const migrationEntries = await loadMigrationEntries(targetManifestRoot, blockId, targetVersion, migrations);

  const upgradePlan = buildUpgradePlan(blockId, currentVersion, targetVersion, impacts, migrations, migrationEntries);
  if (options.dryRun) {
    const lock = await readJson<LockFile>(lockPath);
    await writeJson(upgradePlanPath, upgradePlan);
    return { plan, lock, upgradePlan };
  }

  const backupRoot = await snapshotProject(projectRoot);
  await writeJson(upgradePlanPath, upgradePlan);

  try {
    currentBlock.version = targetVersion;
    await writeYaml(planPath, plan);
    await applyMigrationEntries(projectRoot, targetManifestRoot, impacts, migrationEntries);

    let lock = await resolveGraph(workspaceRoot, plan);
    await validateResolvedTemplates(workspaceRoot, lock);
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    await composeProject(workspaceRoot, lock);
    lock = await readJson<LockFile>(lockPath);
    await adaptProject(workspaceRoot, plan, lock);
    lock = await readJson<LockFile>(lockPath);
    await verifyProject(workspaceRoot, lock);
    lock = await readJson<LockFile>(lockPath);
    await lockProject(workspaceRoot, lock);
    lock = await readJson<LockFile>(lockPath);

    if (!lock.generatedPaths.includes('generated/upgrade-plan.json')) {
      lock.generatedPaths.push('generated/upgrade-plan.json');
      lock.generatedPaths.sort((left, right) => left.localeCompare(right));
      await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
      await writeProvenance(workspaceRoot, lock);
    }

    upgradePlan.status = 'applied';
    await writeJson(upgradePlanPath, upgradePlan);
    return { plan, lock, upgradePlan };
  } catch (error) {
    await restoreProject(projectRoot, backupRoot);
    throw error;
  } finally {
    await removeDir(backupRoot);
  }
}
