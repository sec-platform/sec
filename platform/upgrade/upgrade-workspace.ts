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
import type { LockFile, PlanFile, UpgradeDiagnostics, UpgradeMigration, UpgradeMigrationEntry, UpgradePlan, UpgradePreflightCheck } from '../shared/types.ts';

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

async function detectOverrideConflicts(workspaceRoot: string, blockId: string, impacts: string[]): Promise<string[]> {
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

  return manifest.overrides.map((entry) => entry.id).sort((left, right) => left.localeCompare(right));
}

function ensureMigrationString(value: unknown, field: string, entryPath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires ${field}`);
  }
  return value;
}

function ensureMigrationStringArray(value: unknown, field: string, entryPath: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires ${field}`);
  }
  return value;
}

function validateMigrationEntry(entry: UpgradeMigrationEntry, entryPath: string): void {
  ensureMigrationString(entry.id, 'id', entryPath);
  ensureMigrationString(entry.kind, 'kind', entryPath);
  ensureMigrationString(entry.reason, 'reason', entryPath);
  ensureMigrationString(entry.target, 'target', entryPath);

  if (entry.kind === 'file-replace') {
    ensureMigrationString(entry.source, 'source', entryPath);
    return;
  }

  if (entry.kind === 'config-rewrite') {
    if (!Array.isArray(entry.updates)) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates`);
    }
    for (const update of entry.updates) {
      if (typeof update !== 'object' || update === null || Array.isArray(update)) {
        throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[]`);
      }
      ensureMigrationStringArray(update.path, 'updates[].path', entryPath);
      if (update.operation !== undefined && update.operation !== 'set' && update.operation !== 'delete') {
        throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[].operation`);
      }
      if ((update.operation === undefined || update.operation === 'set') && !Object.prototype.hasOwnProperty.call(update, 'value')) {
        throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[].value`);
      }
    }
    return;
  }

  if (entry.kind === 'json-array-append') {
    ensureMigrationStringArray(entry.path, 'path', entryPath);
    if (entry.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON array append path must not be empty');
    }
    if (!Array.isArray(entry.items) || entry.items.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires items`);
    }
    return;
  }

  if (entry.kind === 'slot-contract-update') {
    ensureMigrationString(entry.slotId, 'slotId', entryPath);
    if (entry.inputType !== undefined) {
      ensureMigrationString(entry.inputType, 'inputType', entryPath);
    }
    if (entry.outputType !== undefined) {
      ensureMigrationString(entry.outputType, 'outputType', entryPath);
    }
    if (entry.writableZones !== undefined) {
      ensureMigrationStringArray(entry.writableZones, 'writableZones', entryPath);
    }
    return;
  }

  const unsupportedEntry = entry as { kind: string };
  throw new CompilerError('UPGRADE-MIGRATION-006', `Unsupported migration kind "${unsupportedEntry.kind}"`);
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
    validateMigrationEntry(entry, migration.entry);
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

function ensureJsonObject(config: unknown, label: string): Record<string, unknown> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new CompilerError('UPGRADE-MIGRATION-009', `${label} target must contain a JSON object`);
  }
  return config as Record<string, unknown>;
}

function applyConfigUpdates(config: unknown, updates: Array<{ path: string[]; value?: unknown; operation?: 'set' | 'delete' }>): unknown {
  const root = ensureJsonObject(config, 'Config rewrite');

  for (const update of updates) {
    if (update.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'Config rewrite path must not be empty');
    }
    let current = root;
    for (const segment of update.path.slice(0, -1)) {
      const next = current[segment];
      if (update.operation === 'delete' && (typeof next !== 'object' || next === null || Array.isArray(next))) {
        current = {};
        break;
      }
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
    const key = update.path[update.path.length - 1];
    if (update.operation === 'delete') {
      delete current[key];
      continue;
    }
    current[key] = update.value;
  }

  return config;
}

function applyJsonArrayAppend(config: unknown, entry: Extract<UpgradeMigrationEntry, { kind: 'json-array-append' }>): unknown {
  if (entry.path.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON array append path must not be empty');
  }
  const root = ensureJsonObject(config, 'JSON array append');
  let current = root;
  for (const segment of entry.path.slice(0, -1)) {
    const next = current[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const key = entry.path[entry.path.length - 1];
  const target = current[key];
  if (target !== undefined && !Array.isArray(target)) {
    throw new CompilerError('UPGRADE-MIGRATION-012', 'JSON array append target must be an array');
  }

  const existing = Array.isArray(target) ? target : [];
  const seen = new Set(existing.map((item) => JSON.stringify(item)));
  for (const item of entry.items) {
    const serialized = JSON.stringify(item);
    if (!seen.has(serialized)) {
      existing.push(item);
      seen.add(serialized);
    }
  }
  current[key] = existing;

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

    if (entry.kind === 'json-array-append') {
      const config = applyJsonArrayAppend((await pathExists(targetPath)) ? await readJson<unknown>(targetPath) : {}, entry);
      await ensureDir(path.dirname(targetPath));
      await writeJson(targetPath, config);
      continue;
    }

    if (entry.kind === 'slot-contract-update') {
      continue;
    }

    const unsupportedEntry = entry as { kind: string };
    throw new CompilerError('UPGRADE-MIGRATION-006', `Unsupported migration kind "${unsupportedEntry.kind}"`);
  }
}

function buildUpgradePreflightChecks(
  currentVersion: string,
  targetVersion: string,
  acceptedRanges: string[],
  migrations: UpgradeMigration[],
  migrationEntries: UpgradeMigrationEntry[],
  impacts: string[],
  scannedOverrides: string[]
): UpgradePreflightCheck[] {
  return [
    {
      id: 'version-range',
      status: 'passed',
      message: `Upgrade path ${currentVersion} -> ${targetVersion} is allowed`,
      evidence: acceptedRanges
    },
    {
      id: 'migration-entries',
      status: 'passed',
      message: `${migrationEntries.length} migration entries loaded and validated`,
      evidence: migrations.map((migration) => `${migration.id}:${migration.entry}`)
    },
    {
      id: 'impact-scan',
      status: 'passed',
      message: `${impacts.length} upgrade impacts calculated`,
      evidence: impacts
    },
    {
      id: 'override-conflicts',
      status: 'passed',
      message: `${scannedOverrides.length} overrides scanned with no conflicts`,
      evidence: scannedOverrides
    }
  ];
}

function classifyPreflightFailure(code: string): UpgradeDiagnostics['failedCheck'] {
  if (code === 'UPGRADE-BLOCKED-003') {
    return 'plan-block';
  }
  if (code === 'MANIFEST-SCHEMA-004') {
    return 'target-manifest';
  }
  if (code === 'UPGRADE-NOOP-001' || code === 'UPGRADE-BLOCKED-001' || code === 'UPGRADE-BLOCKED-002') {
    return 'version-range';
  }
  if (code.startsWith('UPGRADE-MIGRATION-')) {
    return 'migration-entries';
  }
  if (code === 'UPGRADE-CONFLICT-001') {
    return 'override-conflicts';
  }
  return 'impact-scan';
}

async function writeUpgradeDiagnostics(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  error: CompilerError,
  lock: LockFile | null
): Promise<void> {
  const { lockPath, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(upgradeDiagnosticsPath, {
    formatVersion: '1',
    status: 'blocked',
    blockId,
    targetVersion,
    failedCheck: classifyPreflightFailure(error.code),
    errorCode: error.code,
    message: error.message
  } satisfies UpgradeDiagnostics);
  if (!lock) {
    return;
  }
  if (!lock.generatedPaths.includes('generated/upgrade-diagnostics.json')) {
    lock.generatedPaths.push('generated/upgrade-diagnostics.json');
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  }
  await writeProvenance(workspaceRoot, lock);
}

function buildUpgradePlan(
  blockId: string,
  fromVersion: string,
  toVersion: string,
  preflightChecks: UpgradePreflightCheck[],
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
    preflightChecks,
    impacts,
    migrations,
    migrationSummaries: migrationEntries.map((entry) => {
      const migration = migrations.find((candidate) => candidate.id === entry.id);
      return {
        id: entry.id,
        kind: entry.kind,
        target: entry.target,
        reason: entry.reason,
        requiresVerification: migration?.requiresVerification ?? true,
        ...(entry.kind === 'slot-contract-update' ? { slotId: entry.slotId } : {})
      };
    })
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
  const existingLock = (await pathExists(lockPath)) ? await readJson<LockFile>(lockPath) : null;
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  let targetManifestRoot = '';
  let migrationEntries: UpgradeMigrationEntry[] = [];
  let impacts: string[] = [];
  let upgradePlan: UpgradePlan;
  try {
    if (!currentBlock?.version) {
      throw new CompilerError('UPGRADE-BLOCKED-003', `Block "${blockId}" is not declared in app.plan.yaml`);
    }

    const currentVersion = currentBlock.version;
    const targetEntry = await loadManifestById(blockId, {
      workspaceRoot,
      version: targetVersion,
      registrySources: plan.registry.sources
    });
    const migrationImpacts = (entries: UpgradeMigrationEntry[]): string[] => entries.map((entry) => entry.target);
    const migrations = targetEntry.manifest.upgrade?.migrations ?? [];
    const acceptedRanges = targetEntry.manifest.upgrade?.from ?? [];
    ensureUpgradeAllowed(currentVersion, targetVersion, migrations, acceptedRanges);
    targetManifestRoot = path.dirname(targetEntry.manifestPath);
    migrationEntries = await loadMigrationEntries(targetManifestRoot, blockId, targetVersion, migrations);
    impacts = [...new Set([...targetEntry.manifest.installs.map((install) => install.to), ...migrationImpacts(migrationEntries)])].sort(
      (left, right) => left.localeCompare(right)
    );
    const scannedOverrides = await detectOverrideConflicts(workspaceRoot, blockId, impacts);
    const preflightChecks = buildUpgradePreflightChecks(
      currentVersion,
      targetVersion,
      acceptedRanges,
      migrations,
      migrationEntries,
      impacts,
      scannedOverrides
    );

    upgradePlan = buildUpgradePlan(blockId, currentVersion, targetVersion, preflightChecks, impacts, migrations, migrationEntries);
  } catch (error) {
    if (error instanceof CompilerError) {
      await writeUpgradeDiagnostics(workspaceRoot, blockId, targetVersion, error, existingLock);
    }
    throw error;
  }
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
