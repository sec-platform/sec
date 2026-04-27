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
import type {
  LockFile,
  ManifestSlot,
  PlanFile,
  UpgradeDiagnostics,
  UpgradeMigration,
  UpgradeMigrationEntry,
  UpgradePlan,
  UpgradePreflightCheck
} from '../shared/types.ts';

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

  if (entry.kind === 'file-replace' || entry.kind === 'copy-file' || entry.kind === 'copy-directory') {
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

  if (entry.kind === 'json-array-append' || entry.kind === 'json-array-remove') {
    ensureMigrationStringArray(entry.path, 'path', entryPath);
    if (entry.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON array migration path must not be empty');
    }
    if (!Array.isArray(entry.items) || entry.items.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires items`);
    }
    return;
  }

  if (entry.kind === 'json-object-merge') {
    ensureMigrationStringArray(entry.path, 'path', entryPath);
    if (entry.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON object merge path must not be empty');
    }
    if (!isJsonObject(entry.value)) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires value`);
    }
    return;
  }

  if (entry.kind === 'text-append') {
    ensureMigrationString(entry.content, 'content', entryPath);
    return;
  }

  if (entry.kind === 'text-replace') {
    ensureMigrationString(entry.search, 'search', entryPath);
    ensureMigrationString(entry.replacement, 'replacement', entryPath);
    return;
  }

  if (entry.kind === 'text-replace-regex') {
    ensureMigrationString(entry.pattern, 'pattern', entryPath);
    ensureMigrationString(entry.replacement, 'replacement', entryPath);
    if (entry.flags !== undefined) {
      ensureMigrationString(entry.flags, 'flags', entryPath);
    }
    return;
  }

  if (
    entry.kind === 'create-directory' ||
    entry.kind === 'delete-file' ||
    entry.kind === 'delete-directory'
  ) {
    return;
  }

  if (entry.kind === 'rename-file') {
    ensureMigrationString(entry.source, 'source', entryPath);
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

type MigrationPathContext = {
  migrationId?: string;
  role?: 'source' | 'target' | 'manifest-source';
};

function migrationPathDetails(
  failedCheck: UpgradePreflightCheck['id'],
  relativePath: string,
  root: 'project' | 'manifest',
  context: MigrationPathContext = {}
): Record<string, unknown> {
  return {
    failedCheck,
    root,
    path: relativePath,
    ...(context.migrationId ? { migrationId: context.migrationId } : {}),
    ...(context.role ? { role: context.role } : {})
  };
}

function resolveProjectPath(projectRoot: string, relativePath: string, context: MigrationPathContext = {}): string {
  const resolvedPath = path.resolve(projectRoot, relativePath);
  const projectRootWithSeparator = `${projectRoot}${path.sep}`;
  if (resolvedPath !== projectRoot && !resolvedPath.startsWith(projectRootWithSeparator)) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-004',
      `Migration path "${relativePath}" escapes project root`,
      migrationPathDetails('migration-targets', relativePath, 'project', context)
    );
  }
  return resolvedPath;
}

function resolveManifestPath(manifestRoot: string, relativePath: string, context: MigrationPathContext = {}): string {
  const resolvedPath = path.resolve(manifestRoot, relativePath);
  const manifestRootWithSeparator = `${manifestRoot}${path.sep}`;
  if (resolvedPath !== manifestRoot && !resolvedPath.startsWith(manifestRootWithSeparator)) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-005',
      `Migration source "${relativePath}" escapes manifest root`,
      migrationPathDetails('migration-file-operations', relativePath, 'manifest', context)
    );
  }
  return resolvedPath;
}

function ensureJsonObject(config: unknown, label: string): Record<string, unknown> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new CompilerError('UPGRADE-MIGRATION-009', `${label} target must contain a JSON object`);
  }
  return config as Record<string, unknown>;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function resolveJsonArrayTarget(
  config: unknown,
  pathSegments: string[],
  label: string,
  options: { createParents: boolean }
): { root: Record<string, unknown>; parent: Record<string, unknown>; key: string; target: unknown } {
  if (pathSegments.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON array migration path must not be empty');
  }
  const root = ensureJsonObject(config, label);
  let current = root;
  for (const segment of pathSegments.slice(0, -1)) {
    const next = current[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      if (!options.createParents) {
        return { root, parent: {}, key: pathSegments[pathSegments.length - 1], target: undefined };
      }
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const key = pathSegments[pathSegments.length - 1];
  return { root, parent: current, key, target: current[key] };
}

function applyJsonArrayAppend(config: unknown, entry: Extract<UpgradeMigrationEntry, { kind: 'json-array-append' }>): unknown {
  const { parent, key, target } = resolveJsonArrayTarget(config, entry.path, 'JSON array append', { createParents: true });
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
  parent[key] = existing;

  return config;
}

function applyJsonArrayRemove(config: unknown, entry: Extract<UpgradeMigrationEntry, { kind: 'json-array-remove' }>): unknown {
  const { parent, key, target } = resolveJsonArrayTarget(config, entry.path, 'JSON array remove', { createParents: false });
  if (target === undefined) {
    return config;
  }
  if (!Array.isArray(target)) {
    throw new CompilerError('UPGRADE-MIGRATION-012', 'JSON array remove target must be an array');
  }

  const removeItems = new Set(entry.items.map((item) => JSON.stringify(item)));
  parent[key] = target.filter((item) => !removeItems.has(JSON.stringify(item)));
  return config;
}

function mergeJsonObjects(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isJsonObject(existing) && isJsonObject(value)) {
      mergeJsonObjects(existing, value);
      continue;
    }
    target[key] = value;
  }
}

function applyJsonObjectMerge(config: unknown, entry: Extract<UpgradeMigrationEntry, { kind: 'json-object-merge' }>): unknown {
  if (entry.path.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON object merge path must not be empty');
  }
  const root = ensureJsonObject(config, 'JSON object merge');
  let current = root;
  for (const segment of entry.path.slice(0, -1)) {
    const next = current[segment];
    if (next !== undefined && !isJsonObject(next)) {
      throw new CompilerError('UPGRADE-MIGRATION-013', 'JSON object merge parent must be an object');
    }
    if (next === undefined) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const key = entry.path[entry.path.length - 1];
  const target = current[key];
  if (target !== undefined && !isJsonObject(target)) {
    throw new CompilerError('UPGRADE-MIGRATION-013', 'JSON object merge target must be an object');
  }
  const targetObject = isJsonObject(target) ? target : {};
  mergeJsonObjects(targetObject, entry.value);
  current[key] = targetObject;
  return config;
}

function buildTextReplaceRegex(entry: Extract<UpgradeMigrationEntry, { kind: 'text-replace-regex' }>): RegExp {
  try {
    return new RegExp(entry.pattern, entry.flags ?? 'g');
  } catch (error) {
    throw new CompilerError('UPGRADE-MIGRATION-014', `Invalid text replacement regex for "${entry.id}"`, error);
  }
}

function applyTextReplace(source: string, entry: Extract<UpgradeMigrationEntry, { kind: 'text-replace' }>): string {
  if (!source.includes(entry.search)) {
    throw new CompilerError('UPGRADE-MIGRATION-015', `Text replacement pattern did not match "${entry.target}"`);
  }
  return source.split(entry.search).join(entry.replacement);
}

function applyTextReplaceRegex(
  source: string,
  entry: Extract<UpgradeMigrationEntry, { kind: 'text-replace-regex' }>
): string {
  const pattern = buildTextReplaceRegex(entry);
  if (!pattern.test(source)) {
    throw new CompilerError('UPGRADE-MIGRATION-015', `Text replacement pattern did not match "${entry.target}"`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, entry.replacement);
}

async function removeFileMigrationTarget(targetPath: string, target: string): Promise<void> {
  await statFileMigrationTarget(targetPath, target);
  await fs.rm(targetPath);
}

async function removeDirectoryMigrationTarget(targetPath: string, target: string): Promise<void> {
  await statDirectoryMigrationTarget(targetPath, target);
  await fs.rm(targetPath, { recursive: true });
}

async function renameFileMigrationTarget(
  sourcePath: string,
  targetPath: string,
  source: string,
  target: string
): Promise<void> {
  await statRenameMigrationSource(sourcePath, source);
  if (await pathExists(targetPath)) {
    throw new CompilerError('UPGRADE-MIGRATION-020', `Rename-file target "${target}" already exists`);
  }
  await ensureDir(path.dirname(targetPath));
  await fs.rename(sourcePath, targetPath);
}

function migrationErrorDetails(entry: UpgradeMigrationEntry): Record<string, unknown> {
  return {
    migrationId: entry.id,
    migrationKind: entry.kind,
    target: entry.target,
    ...('source' in entry ? { source: entry.source } : {}),
    ...('slotId' in entry ? { slotId: entry.slotId } : {})
  };
}

function isPlainObjectDetails(details: unknown): details is Record<string, unknown> {
  return (
    typeof details === 'object' &&
    details !== null &&
    !Array.isArray(details) &&
    Object.getPrototypeOf(details) === Object.prototype
  );
}

function normalizeCauseDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message
    };
  }
  return details;
}

function withMigrationErrorDetails(entry: UpgradeMigrationEntry, error: CompilerError): CompilerError {
  const details = migrationErrorDetails(entry);
  if (isEmptyDiagnosticsDetails(error.details)) {
    return new CompilerError(error.code, error.message, details);
  }
  if (isPlainObjectDetails(error.details)) {
    return new CompilerError(error.code, error.message, {
      ...details,
      ...error.details
    });
  }
  return new CompilerError(error.code, error.message, {
    ...details,
    causeDetails: normalizeCauseDetails(error.details)
  });
}

async function applyMigrationEntry(
  projectRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entry: UpgradeMigrationEntry
): Promise<void> {
  if (!impacts.includes(entry.target)) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-007',
      `Migration target "${entry.target}" is outside upgrade impacts`,
      migrationPathDetails('migration-targets', entry.target, 'project', {
        migrationId: entry.id,
        role: 'target'
      })
    );
  }
  if (entry.kind === 'rename-file' && !impacts.includes(entry.source)) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-007',
      `Migration source "${entry.source}" is outside upgrade impacts`,
      migrationPathDetails('migration-targets', entry.source, 'project', {
        migrationId: entry.id,
        role: 'source'
      })
    );
  }
  const targetPath = resolveProjectPath(projectRoot, entry.target, {
    migrationId: entry.id,
    role: 'target'
  });

  if (entry.kind === 'file-replace' || entry.kind === 'copy-file') {
    const sourcePath = resolveManifestPath(targetManifestRoot, entry.source, {
      migrationId: entry.id,
      role: 'manifest-source'
    });
    await statManifestFileMigrationSource(sourcePath, entry.source, entry.kind);
    await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
    return;
  }

  if (entry.kind === 'copy-directory') {
    const sourcePath = resolveManifestPath(targetManifestRoot, entry.source, {
      migrationId: entry.id,
      role: 'manifest-source'
    });
    await statCopyDirectoryMigrationSource(sourcePath, entry.source);
    await statCopyDirectoryMigrationTarget(targetPath, entry.target);
    await copyRecursive(sourcePath, targetPath);
    return;
  }

  if (entry.kind === 'config-rewrite') {
    await statFileMigrationTarget(targetPath, entry.target, entry.kind);
    const config = applyConfigUpdates(await readJson<unknown>(targetPath), entry.updates);
    await writeJson(targetPath, config);
    return;
  }

  if (entry.kind === 'json-array-append') {
    const targetStatus = await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
    const config = applyJsonArrayAppend(targetStatus === 'file' ? await readJson<unknown>(targetPath) : {}, entry);
    await ensureDir(path.dirname(targetPath));
    await writeJson(targetPath, config);
    return;
  }

  if (entry.kind === 'json-array-remove') {
    const targetStatus = await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
    if (targetStatus === 'missing') {
      return;
    }
    const config = applyJsonArrayRemove(await readJson<unknown>(targetPath), entry);
    await writeJson(targetPath, config);
    return;
  }

  if (entry.kind === 'json-object-merge') {
    const targetStatus = await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
    const config = applyJsonObjectMerge(targetStatus === 'file' ? await readJson<unknown>(targetPath) : {}, entry);
    await ensureDir(path.dirname(targetPath));
    await writeJson(targetPath, config);
    return;
  }

  if (entry.kind === 'text-append') {
    await appendTextMigrationTarget(targetPath, entry.target, entry.content);
    return;
  }

  if (entry.kind === 'text-replace') {
    await statFileMigrationTarget(targetPath, entry.target, entry.kind);
    const source = await fs.readFile(targetPath, 'utf8');
    await fs.writeFile(targetPath, applyTextReplace(source, entry), 'utf8');
    return;
  }

  if (entry.kind === 'text-replace-regex') {
    await statFileMigrationTarget(targetPath, entry.target, entry.kind);
    const source = await fs.readFile(targetPath, 'utf8');
    await fs.writeFile(targetPath, applyTextReplaceRegex(source, entry), 'utf8');
    return;
  }

  if (entry.kind === 'create-directory') {
    await statCreateDirectoryMigrationTarget(targetPath, entry.target);
    await ensureDir(targetPath);
    return;
  }

  if (entry.kind === 'delete-file') {
    await removeFileMigrationTarget(targetPath, entry.target);
    return;
  }

  if (entry.kind === 'delete-directory') {
    await removeDirectoryMigrationTarget(targetPath, entry.target);
    return;
  }

  if (entry.kind === 'rename-file') {
    const sourcePath = resolveProjectPath(projectRoot, entry.source, {
      migrationId: entry.id,
      role: 'source'
    });
    await renameFileMigrationTarget(sourcePath, targetPath, entry.source, entry.target);
    return;
  }

  if (entry.kind === 'slot-contract-update') {
    await statFileMigrationTarget(targetPath, entry.target, entry.kind);
    return;
  }

  const unsupportedEntry = entry as { kind: string };
  throw new CompilerError('UPGRADE-MIGRATION-006', `Unsupported migration kind "${unsupportedEntry.kind}"`);
}

export async function applyMigrationEntries(
  projectRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entries: UpgradeMigrationEntry[]
): Promise<void> {
  for (const entry of entries) {
    try {
      await applyMigrationEntry(projectRoot, targetManifestRoot, impacts, entry);
    } catch (error) {
      if (error instanceof CompilerError) {
        throw withMigrationErrorDetails(entry, error);
      }
      throw error;
    }
  }
}

async function describeMigrationPathStatus(
  projectRoot: string,
  migrationId: string,
  role: 'source' | 'target',
  relativePath: string
): Promise<string> {
  const exists = await pathExists(resolveProjectPath(projectRoot, relativePath, { migrationId, role }));
  return `${migrationId}:${role}:${relativePath}:${exists ? 'exists' : 'missing'}`;
}

async function collectMigrationTargetEvidence(
  projectRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (entry.kind === 'rename-file') {
      evidence.push(await describeMigrationPathStatus(projectRoot, entry.id, 'source', entry.source));
    }
    evidence.push(await describeMigrationPathStatus(projectRoot, entry.id, 'target', entry.target));
  }
  return evidence.sort((left, right) => left.localeCompare(right));
}

async function statFileMigrationTarget(
  targetPath: string,
  target: string,
  kind:
    | 'config-rewrite'
    | 'copy-file'
    | 'delete-file'
    | 'file-replace'
    | 'json-array-append'
    | 'json-array-remove'
    | 'json-object-merge'
    | 'text-replace'
    | 'text-replace-regex'
    | 'text-append'
    | 'slot-contract-update' = 'delete-file',
  options: { allowMissing?: boolean } = {}
): Promise<'file' | 'missing'> {
  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch {
    if (options.allowMissing) {
      return 'missing';
    }
    throw new CompilerError('UPGRADE-MIGRATION-016', `${kind} target "${target}" is missing`);
  }
  if (!stats.isFile()) {
    throw new CompilerError('UPGRADE-MIGRATION-017', `${kind} target "${target}" must be a file`);
  }
  return 'file';
}

async function appendTextMigrationTarget(targetPath: string, target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  try {
    await fs.appendFile(targetPath, content, 'utf8');
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'EISDIR' || failure.code === 'EPERM' || failure.code === 'ENOTDIR') {
      throw new CompilerError('UPGRADE-MIGRATION-017', `text-append target "${target}" must be a file`);
    }
    throw error;
  }
}

async function statDirectoryMigrationTarget(targetPath: string, target: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch {
    throw new CompilerError('UPGRADE-MIGRATION-025', `Delete-directory target "${target}" is missing`);
  }
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-026', `Delete-directory target "${target}" must be a directory`);
  }
}

async function statCreateDirectoryMigrationTarget(targetPath: string, target: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch {
    return;
  }
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-028', `Create-directory target "${target}" must be a directory when it already exists`);
  }
}

async function statRenameMigrationSource(sourcePath: string, source: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(sourcePath);
  } catch {
    throw new CompilerError('UPGRADE-MIGRATION-018', `Rename-file source "${source}" is missing`);
  }
  if (!stats.isFile()) {
    throw new CompilerError('UPGRADE-MIGRATION-019', `Rename-file source "${source}" must be a file`);
  }
}

async function statManifestFileMigrationSource(
  sourcePath: string,
  source: string,
  kind: 'file-replace' | 'copy-file'
): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(sourcePath);
  } catch {
    throw new CompilerError('UPGRADE-MIGRATION-008', `Migration source "${source}" is missing`);
  }
  if (!stats.isFile()) {
    throw new CompilerError('UPGRADE-MIGRATION-024', `${kind} source "${source}" must be a file`);
  }
}

async function statCopyDirectoryMigrationSource(sourcePath: string, source: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(sourcePath);
  } catch {
    throw new CompilerError('UPGRADE-MIGRATION-008', `Migration source "${source}" is missing`);
  }
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-023', `Copy-directory source "${source}" must be a directory`);
  }
}

async function statCopyDirectoryMigrationTarget(targetPath: string, target: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch {
    return;
  }
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-027', `Copy-directory target "${target}" must be a directory when it already exists`);
  }
}

async function collectFileOperationEvidence(
  projectRoot: string,
  targetManifestRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (entry.kind === 'file-replace' || entry.kind === 'copy-file') {
      const sourcePath = resolveManifestPath(targetManifestRoot, entry.source, {
        migrationId: entry.id,
        role: 'manifest-source'
      });
      const targetPath = resolveProjectPath(projectRoot, entry.target, {
        migrationId: entry.id,
        role: 'target'
      });
      await statManifestFileMigrationSource(sourcePath, entry.source, entry.kind);
      await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
      evidence.push(
        entry.kind === 'file-replace'
          ? `${entry.id}:manifest-source:exists`
          : `${entry.id}:manifest-source:file`
      );
    }
    if (entry.kind === 'copy-directory') {
      const sourcePath = resolveManifestPath(targetManifestRoot, entry.source, {
        migrationId: entry.id,
        role: 'manifest-source'
      });
      await statCopyDirectoryMigrationSource(sourcePath, entry.source);
      evidence.push(`${entry.id}:manifest-source:directory`);
    }
    if (entry.kind === 'delete-file') {
      await statFileMigrationTarget(
        resolveProjectPath(projectRoot, entry.target, {
          migrationId: entry.id,
          role: 'target'
        }),
        entry.target
      );
      evidence.push(`${entry.id}:target:file`);
    }
    if (entry.kind === 'delete-directory') {
      await statDirectoryMigrationTarget(
        resolveProjectPath(projectRoot, entry.target, {
          migrationId: entry.id,
          role: 'target'
        }),
        entry.target
      );
      evidence.push(`${entry.id}:target:directory`);
    }
    if (entry.kind === 'rename-file') {
      const sourcePath = resolveProjectPath(projectRoot, entry.source, {
        migrationId: entry.id,
        role: 'source'
      });
      const targetPath = resolveProjectPath(projectRoot, entry.target, {
        migrationId: entry.id,
        role: 'target'
      });
      await statRenameMigrationSource(sourcePath, entry.source);
      if (await pathExists(targetPath)) {
        throw new CompilerError('UPGRADE-MIGRATION-020', `Rename-file target "${entry.target}" already exists`);
      }
      evidence.push(`${entry.id}:source:file`);
      evidence.push(`${entry.id}:target:available`);
    }
    if (entry.kind === 'text-append') {
      evidence.push(`${entry.id}:target:${await statFileMigrationTarget(
        resolveProjectPath(projectRoot, entry.target, {
          migrationId: entry.id,
          role: 'target'
        }),
        entry.target,
        entry.kind,
        { allowMissing: true }
      )}`);
    }
  }
  return evidence.sort((left, right) => left.localeCompare(right));
}

function collectJsonShapeEvidence(migrationEntries: UpgradeMigrationEntry[]): string[] {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (entry.kind === 'config-rewrite') {
      evidence.push(`${entry.id}:updates:${entry.updates.length}`);
    }
    if (entry.kind === 'json-array-append' || entry.kind === 'json-array-remove') {
      evidence.push(`${entry.id}:path:${entry.path.join('.')}:array:${entry.items.length}`);
    }
    if (entry.kind === 'json-object-merge') {
      evidence.push(`${entry.id}:path:${entry.path.join('.')}:object:${Object.keys(entry.value).length}`);
    }
  }
  return evidence.sort((left, right) => left.localeCompare(right));
}

function ensureSlotContractValue(
  migrationId: string,
  field: 'inputType' | 'outputType',
  expected: string | undefined,
  actual: string | undefined
): string[] {
  if (expected === undefined) {
    return [];
  }
  if (actual !== expected) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-021',
      `Slot contract migration "${migrationId}" ${field} does not match target manifest slot`
    );
  }
  return [`${migrationId}:${field}:${actual}`];
}

function ensureSlotWritableZones(
  migrationId: string,
  expected: string[] | undefined,
  actual: string[] | undefined
): string[] {
  if (expected === undefined) {
    return [];
  }
  const actualZones = actual ?? [];
  if (
    expected.length !== actualZones.length ||
    expected.some((zone, index) => zone !== actualZones[index])
  ) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-022',
      `Slot contract migration "${migrationId}" writableZones do not match target manifest slot`
    );
  }
  return [`${migrationId}:writableZones:${actualZones.join(',')}`];
}

function collectSlotContractEvidence(
  targetSlots: ManifestSlot[],
  migrationEntries: UpgradeMigrationEntry[]
): string[] {
  const slotsById = new Map(targetSlots.map((slot) => [slot.id, slot]));
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (entry.kind !== 'slot-contract-update') {
      continue;
    }
    const slot = slotsById.get(entry.slotId);
    if (!slot) {
      throw new CompilerError(
        'UPGRADE-MIGRATION-021',
        `Slot contract migration "${entry.id}" references missing target slot "${entry.slotId}"`
      );
    }
    if (slot.target !== entry.target) {
      throw new CompilerError(
        'UPGRADE-MIGRATION-021',
        `Slot contract migration "${entry.id}" target does not match target manifest slot`
      );
    }
    evidence.push(`${entry.id}:slot:${entry.slotId}`);
    evidence.push(`${entry.id}:target:${slot.target}`);
    evidence.push(...ensureSlotContractValue(entry.id, 'inputType', entry.inputType, slot.inputType));
    evidence.push(...ensureSlotContractValue(entry.id, 'outputType', entry.outputType, slot.outputType));
    evidence.push(...ensureSlotWritableZones(entry.id, entry.writableZones, slot.writableZones));
  }
  return evidence.sort((left, right) => left.localeCompare(right));
}

function isJsonMigrationEntry(entry: UpgradeMigrationEntry): entry is Extract<
  UpgradeMigrationEntry,
  { kind: 'config-rewrite' | 'json-array-append' | 'json-array-remove' | 'json-object-merge' }
> {
  return (
    entry.kind === 'config-rewrite' ||
    entry.kind === 'json-array-append' ||
    entry.kind === 'json-array-remove' ||
    entry.kind === 'json-object-merge'
  );
}

function readJsonPath(config: unknown, pathSegments: string[]): unknown {
  let current = config;
  for (const segment of pathSegments) {
    if (!isJsonObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

async function collectTextPatternEvidence(
  projectRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (entry.kind !== 'text-replace' && entry.kind !== 'text-replace-regex') {
      continue;
    }
    const pattern = entry.kind === 'text-replace-regex' ? buildTextReplaceRegex(entry) : null;
    const targetPath = resolveProjectPath(projectRoot, entry.target, {
      migrationId: entry.id,
      role: 'target'
    });
    await statFileMigrationTarget(targetPath, entry.target, entry.kind);
    const source = await fs.readFile(targetPath, 'utf8');
    if (entry.kind === 'text-replace') {
      applyTextReplace(source, entry);
      evidence.push(`${entry.id}:literal:${entry.search.length}`);
      continue;
    }
    if (!pattern || !pattern.test(source)) {
      throw new CompilerError('UPGRADE-MIGRATION-015', `Text replacement pattern did not match "${entry.target}"`);
    }
    pattern.lastIndex = 0;
    evidence.push(`${entry.id}:flags:${pattern.flags}`);
  }
  return evidence.sort((left, right) => left.localeCompare(right));
}

async function collectJsonStructureEvidence(
  projectRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (!isJsonMigrationEntry(entry)) {
      continue;
    }
    const targetPath = resolveProjectPath(projectRoot, entry.target, {
      migrationId: entry.id,
      role: 'target'
    });
    if (entry.kind === 'config-rewrite') {
      await statFileMigrationTarget(targetPath, entry.target, entry.kind);
      const config = await readJson<unknown>(targetPath);
      ensureJsonObject(config, 'Config rewrite preflight');
      evidence.push(`${entry.id}:target:object`);
      continue;
    }
    const targetStatus = await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
    if (targetStatus === 'missing') {
      evidence.push(`${entry.id}:target:missing`);
      continue;
    }
    const config = await readJson<unknown>(targetPath);
    const target = readJsonPath(config, entry.path);
    if (entry.kind === 'json-array-append' || entry.kind === 'json-array-remove') {
      if (target !== undefined && !Array.isArray(target)) {
        throw new CompilerError('UPGRADE-MIGRATION-012', `JSON array migration target must be an array for "${entry.target}"`);
      }
      evidence.push(`${entry.id}:target:${target === undefined ? 'missing' : 'array'}`);
      continue;
    }
    if (target !== undefined && !isJsonObject(target)) {
      throw new CompilerError('UPGRADE-MIGRATION-013', `JSON object merge target must be an object for "${entry.target}"`);
    }
    evidence.push(`${entry.id}:target:${target === undefined ? 'missing' : 'object'}`);
  }
  return evidence.sort((left, right) => left.localeCompare(right));
}

function buildUpgradePreflightChecks(
  currentVersion: string,
  targetVersion: string,
  acceptedRanges: string[],
  migrations: UpgradeMigration[],
  migrationEntries: UpgradeMigrationEntry[],
  migrationTargetEvidence: string[],
  fileOperationEvidence: string[],
  jsonShapeEvidence: string[],
  jsonStructureEvidence: string[],
  textPatternEvidence: string[],
  slotContractEvidence: string[],
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
      id: 'migration-targets',
      status: 'passed',
      message: `${migrationTargetEvidence.length} migration paths checked`,
      evidence: migrationTargetEvidence
    },
    {
      id: 'migration-file-operations',
      status: 'passed',
      message: `${fileOperationEvidence.length} file operations checked`,
      evidence: fileOperationEvidence
    },
    {
      id: 'migration-json-shapes',
      status: 'passed',
      message: `${jsonShapeEvidence.length} JSON migration shapes checked`,
      evidence: jsonShapeEvidence
    },
    {
      id: 'migration-json-structure',
      status: 'passed',
      message: `${jsonStructureEvidence.length} JSON migration targets checked`,
      evidence: jsonStructureEvidence
    },
    {
      id: 'migration-text-patterns',
      status: 'passed',
      message: `${textPatternEvidence.length} text replacement patterns checked`,
      evidence: textPatternEvidence
    },
    {
      id: 'migration-slot-contracts',
      status: 'passed',
      message: `${slotContractEvidence.length} slot contract fields checked`,
      evidence: slotContractEvidence
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

function isEmptyDiagnosticsDetails(details: unknown): boolean {
  if (details === undefined || details === null) {
    return true;
  }
  if (typeof details !== 'object' || Array.isArray(details)) {
    return false;
  }
  return Object.getPrototypeOf(details) === Object.prototype && Object.keys(details).length === 0;
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
  if (code === 'UPGRADE-MIGRATION-004' || code === 'UPGRADE-MIGRATION-007') {
    return 'migration-targets';
  }
  if (code === 'UPGRADE-MIGRATION-012' || code === 'UPGRADE-MIGRATION-013') {
    return 'migration-json-structure';
  }
  if (code === 'UPGRADE-MIGRATION-014' || code === 'UPGRADE-MIGRATION-015') {
    return 'migration-text-patterns';
  }
  if (code === 'UPGRADE-MIGRATION-021' || code === 'UPGRADE-MIGRATION-022') {
    return 'migration-slot-contracts';
  }
  if (
    code === 'UPGRADE-MIGRATION-005' ||
    code === 'UPGRADE-MIGRATION-008' ||
    code === 'UPGRADE-MIGRATION-016' ||
    code === 'UPGRADE-MIGRATION-017' ||
    code === 'UPGRADE-MIGRATION-018' ||
    code === 'UPGRADE-MIGRATION-019' ||
    code === 'UPGRADE-MIGRATION-020' ||
    code === 'UPGRADE-MIGRATION-023' ||
    code === 'UPGRADE-MIGRATION-024' ||
    code === 'UPGRADE-MIGRATION-025' ||
    code === 'UPGRADE-MIGRATION-026' ||
    code === 'UPGRADE-MIGRATION-027' ||
    code === 'UPGRADE-MIGRATION-028'
  ) {
    return 'migration-file-operations';
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
  phase: UpgradeDiagnostics['phase'],
  error: CompilerError,
  lock: LockFile | null
): Promise<void> {
  const { lockPath, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const details = isEmptyDiagnosticsDetails(error.details) ? undefined : error.details;
  await writeJson(upgradeDiagnosticsPath, {
    formatVersion: '1',
    status: 'blocked',
    phase,
    blockId,
    targetVersion,
    failedCheck: classifyPreflightFailure(error.code),
    errorCode: error.code,
    message: error.message,
    ...(details === undefined ? {} : { details })
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

function buildMigrationKindCounts(migrationEntries: UpgradeMigrationEntry[]): Record<string, number> {
  return migrationEntries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function buildMigrationOperation(entry: UpgradeMigrationEntry): UpgradePlan['migrationOperations'][number] {
  if (entry.kind === 'file-replace' || entry.kind === 'copy-file') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'file',
      source: entry.source
    };
  }

  if (entry.kind === 'copy-directory') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'directory',
      source: entry.source
    };
  }

  if (entry.kind === 'create-directory' || entry.kind === 'delete-directory') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'directory'
    };
  }

  if (entry.kind === 'delete-file') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'file'
    };
  }

  if (entry.kind === 'rename-file') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'file',
      source: entry.source
    };
  }

  if (entry.kind === 'config-rewrite') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'json',
      updateCount: entry.updates.length
    };
  }

  if (entry.kind === 'json-array-append' || entry.kind === 'json-array-remove') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'json',
      path: [...entry.path],
      itemCount: entry.items.length
    };
  }

  if (entry.kind === 'json-object-merge') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'json',
      path: [...entry.path],
      valueKeyCount: Object.keys(entry.value).length
    };
  }

  if (entry.kind === 'text-append') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'text',
      contentLength: entry.content.length
    };
  }

  if (entry.kind === 'text-replace') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'text',
      searchLength: entry.search.length,
      replacementLength: entry.replacement.length
    };
  }

  if (entry.kind === 'text-replace-regex') {
    return {
      id: entry.id,
      kind: entry.kind,
      target: entry.target,
      role: 'text',
      pattern: entry.pattern,
      replacementLength: entry.replacement.length,
      ...(entry.flags ? { flags: entry.flags } : {})
    };
  }

  return {
    id: entry.id,
    kind: entry.kind,
    target: entry.target,
    role: 'slot',
    slotId: entry.slotId,
    ...(entry.inputType ? { inputType: entry.inputType } : {}),
    ...(entry.outputType ? { outputType: entry.outputType } : {}),
    ...(entry.writableZones ? { writableZones: [...entry.writableZones] } : {})
  };
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
    migrationKindCounts: buildMigrationKindCounts(migrationEntries),
    migrationSummaries: migrationEntries.map((entry) => {
      const migration = migrations.find((candidate) => candidate.id === entry.id);
      return {
        id: entry.id,
        kind: entry.kind,
        target: entry.target,
        reason: entry.reason,
        requiresVerification: migration?.requiresVerification ?? true,
        ...(entry.kind === 'slot-contract-update' ? { slotId: entry.slotId } : {}),
        ...(
          entry.kind === 'file-replace' ||
          entry.kind === 'rename-file' ||
          entry.kind === 'copy-file' ||
          entry.kind === 'copy-directory'
            ? { source: entry.source }
            : {}
        )
      };
    }),
    migrationOperations: migrationEntries.map(buildMigrationOperation)
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
    const migrationImpacts = (entries: UpgradeMigrationEntry[]): string[] =>
      entries.flatMap((entry) =>
        entry.kind === 'rename-file' ? [entry.source, entry.target] : [entry.target]
      );
    const migrations = targetEntry.manifest.upgrade?.migrations ?? [];
    const acceptedRanges = targetEntry.manifest.upgrade?.from ?? [];
    ensureUpgradeAllowed(currentVersion, targetVersion, migrations, acceptedRanges);
    targetManifestRoot = path.dirname(targetEntry.manifestPath);
    migrationEntries = await loadMigrationEntries(targetManifestRoot, blockId, targetVersion, migrations);
    impacts = [...new Set([...targetEntry.manifest.installs.map((install) => install.to), ...migrationImpacts(migrationEntries)])].sort(
      (left, right) => left.localeCompare(right)
    );
    const migrationTargetEvidence = await collectMigrationTargetEvidence(projectRoot, migrationEntries);
    const fileOperationEvidence = await collectFileOperationEvidence(
      projectRoot,
      targetManifestRoot,
      migrationEntries
    );
    const jsonShapeEvidence = collectJsonShapeEvidence(migrationEntries);
    const jsonStructureEvidence = await collectJsonStructureEvidence(projectRoot, migrationEntries);
    const textPatternEvidence = await collectTextPatternEvidence(projectRoot, migrationEntries);
    const slotContractEvidence = collectSlotContractEvidence(targetEntry.manifest.slots, migrationEntries);
    const scannedOverrides = await detectOverrideConflicts(workspaceRoot, blockId, impacts);
    const preflightChecks = buildUpgradePreflightChecks(
      currentVersion,
      targetVersion,
      acceptedRanges,
      migrations,
      migrationEntries,
      migrationTargetEvidence,
      fileOperationEvidence,
      jsonShapeEvidence,
      jsonStructureEvidence,
      textPatternEvidence,
      slotContractEvidence,
      impacts,
      scannedOverrides
    );

    upgradePlan = buildUpgradePlan(blockId, currentVersion, targetVersion, preflightChecks, impacts, migrations, migrationEntries);
  } catch (error) {
    if (error instanceof CompilerError) {
      await writeUpgradeDiagnostics(workspaceRoot, blockId, targetVersion, 'planning', error, existingLock);
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
    if (error instanceof CompilerError) {
      await writeUpgradeDiagnostics(workspaceRoot, blockId, targetVersion, 'apply', error, existingLock);
    }
    throw error;
  } finally {
    await removeDir(backupRoot);
  }
}
