import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';
import {
    adaptProject,
    composeProject,
    loadManifestById,
    loadOverrideManifest,
    loadWorkspacePlan,
    lockProject,
    resolveGraph,
    validateResolvedTemplates,
    verifyProject,
    writeProvenance
} from '../compiler/index.ts';
import { CI_ARTIFACT_FILES } from '../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../shared/collections.ts';
import { CompilerError } from '../shared/errors.ts';
import { copyRecursive, ensureDir, isFileNotFoundError, pathExists, readJson, removeDir, writeJson } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { addGeneratedPaths, readLockFile, saveLock } from '../shared/lock-utils.ts';
import { getWorkspacePaths, resolvePathInside, resolveWorkspaceLockPath } from '../shared/paths.ts';
import type {
    ManifestSlot,
    PlanFile,
    UpgradeMigration,
    UpgradeMigrationEntry
} from '../shared/plan-manifest-types.ts';
import type {
    UpgradeDiagnostics,
    UpgradePlan,
    UpgradePreflightCheck
} from '../shared/upgrade-types.ts';
import { writeYaml } from '../shared/yaml.ts';

function matchesUpgradeRange(version: string, range: string): boolean {
  const supportedRange = semver.valid(range) === range || /^\d+\.\d+\.x$/.test(range);
  return supportedRange && semver.satisfies(version, range);
}

function migrationManifestDetails(migration: UpgradeMigration): Record<string, unknown> {
  return {
    failedCheck: 'migration-entries',
    migrationId: migration.id,
    migrationKind: migration.kind,
    ...(migration.entry ? { entry: migration.entry } : {})
  };
}

function withMigrationManifestDetails(migration: UpgradeMigration, error: CompilerError): CompilerError {
  if (isEmptyDiagnosticsDetails(error.details)) {
    return new CompilerError(error.code, error.message, migrationManifestDetails(migration));
  }
  if (isPlainObjectDetails(error.details)) {
    return new CompilerError(error.code, error.message, {
      ...migrationManifestDetails(migration),
      ...error.details
    });
  }
  return new CompilerError(error.code, error.message, {
    ...migrationManifestDetails(migration),
    causeDetails: normalizeCauseDetails(error.details)
  });
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
      throw new CompilerError(
        'UPGRADE-MIGRATION-001',
        `Migration "${migration.id}" is missing entry`,
        migrationManifestDetails(migration)
      );
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

  return uniqueSorted(manifest.overrides.map((entry) => entry.id));
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

type MigrationEntryValidationContext<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> = {
  entry: Extract<UpgradeMigrationEntry, { kind: K }>;
  entryPath: string;
};

type SourceMigrationEntryValidationContext = {
  entry: Extract<UpgradeMigrationEntry, { source: string }>;
  entryPath: string;
};

type JsonArrayMigrationEntryValidationContext = {
  entry: Extract<UpgradeMigrationEntry, { kind: 'json-array-append' | 'json-array-remove' }>;
  entryPath: string;
};

function validateSourceMigrationEntry({ entry, entryPath }: SourceMigrationEntryValidationContext): void {
  ensureMigrationString(entry.source, 'source', entryPath);
}

function validateConfigRewriteMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'config-rewrite'>): void {
  if (!Array.isArray(entry.updates)) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates`);
  }
  for (const update of entry.updates) {
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[]`);
    }
    ensureMigrationStringArray(update.path, 'updates[].path', entryPath);
    if (update.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'Config rewrite path must not be empty');
    }
    if (update.operation !== undefined && update.operation !== 'set' && update.operation !== 'delete') {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[].operation`);
    }
    if ((update.operation === undefined || update.operation === 'set') && !Object.prototype.hasOwnProperty.call(update, 'value')) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[].value`);
    }
  }
}

function validateJsonArrayMigrationEntry({
  entry,
  entryPath
}: JsonArrayMigrationEntryValidationContext): void {
  ensureMigrationStringArray(entry.path, 'path', entryPath);
  if (entry.path.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON array migration path must not be empty');
  }
  if (!Array.isArray(entry.items) || entry.items.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires items`);
  }
}

function validateJsonObjectMergeMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'json-object-merge'>): void {
  ensureMigrationStringArray(entry.path, 'path', entryPath);
  if (entry.path.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON object merge path must not be empty');
  }
  if (!isJsonObject(entry.value)) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires value`);
  }
}

function validateTextReplaceRegexMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'text-replace-regex'>): void {
  ensureMigrationString(entry.pattern, 'pattern', entryPath);
  ensureMigrationString(entry.replacement, 'replacement', entryPath);
  if (entry.flags !== undefined) {
    ensureMigrationString(entry.flags, 'flags', entryPath);
  }
}

function validateSlotContractMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'slot-contract-update'>): void {
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
}

function validateDbExpandContractMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'db-expand-contract'>): void {
  ensureMigrationString(entry.entity, 'entity', entryPath);
  ensureMigrationString(entry.expandField, 'expandField', entryPath);
  ensureMigrationString(entry.contractField, 'contractField', entryPath);
  if (entry.copyJobCode !== undefined) {
    ensureMigrationString(entry.copyJobCode, 'copyJobCode', entryPath);
  }
}

function unsupportedMigrationKindError(entry: { kind: string }): CompilerError {
  return new CompilerError('UPGRADE-MIGRATION-006', `Unsupported migration kind "${entry.kind}"`);
}

function validateMigrationEntry(entry: UpgradeMigrationEntry, entryPath: string): void {
  ensureMigrationString(entry.id, 'id', entryPath);
  ensureMigrationString(entry.kind, 'kind', entryPath);
  ensureMigrationString(entry.reason, 'reason', entryPath);
  ensureMigrationString(entry.target, 'target', entryPath);

  const spec = getMigrationOperationSpec(entry);
  if (!spec) {
    throw unsupportedMigrationKindError(entry as { kind: string });
  }
  spec.validate?.({ entry, entryPath });
}

async function loadMigrationEntries(
  targetManifestRoot: string,
  blockId: string,
  targetVersion: string,
  migrations: UpgradeMigration[]
): Promise<UpgradeMigrationEntry[]> {
  const entries: UpgradeMigrationEntry[] = [];
  const seenMigrationEntries = new Map<string, string>();
  for (const migration of migrations) {
    const existingEntry = seenMigrationEntries.get(migration.id);
    if (existingEntry !== undefined) {
      throw new CompilerError('UPGRADE-MIGRATION-029', `Migration "${migration.id}" is declared more than once`, {
        ...migrationManifestDetails(migration),
        entries: [existingEntry, migration.entry]
      });
    }
    seenMigrationEntries.set(migration.id, migration.entry);
  }

  for (const migration of migrations) {
    const entryPath = resolveManifestPath(targetManifestRoot, migration.entry, {
      migrationId: migration.id,
      role: 'manifest-source'
    });
    if (!(await pathExists(entryPath))) {
      throw new CompilerError(
        'UPGRADE-MIGRATION-002',
        `Migration entry "${migration.entry}" for "${blockId}@${targetVersion}" is missing`,
        migrationManifestDetails(migration)
      );
    }
    const entry = await readJson<UpgradeMigrationEntry>(entryPath);
    try {
      validateMigrationEntry(entry, migration.entry);
    } catch (error) {
      if (error instanceof CompilerError) {
        throw withMigrationManifestDetails(migration, error);
      }
      throw error;
    }
    if (entry.id !== migration.id || entry.kind !== migration.kind) {
      throw new CompilerError(
        'UPGRADE-MIGRATION-003',
        `Migration entry "${migration.entry}" does not match manifest metadata`,
        {
          ...migrationManifestDetails(migration),
          entryId: entry.id,
          entryKind: entry.kind
        }
      );
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
  const resolvedPath = resolvePathInside(projectRoot, relativePath);
  if (!resolvedPath) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-004',
      `Migration path "${relativePath}" escapes project root`,
      migrationPathDetails('migration-targets', relativePath, 'project', context)
    );
  }
  return resolvedPath;
}

function resolveManifestPath(manifestRoot: string, relativePath: string, context: MigrationPathContext = {}): string {
  const resolvedPath = resolvePathInside(manifestRoot, relativePath);
  if (!resolvedPath) {
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

function withRollbackDiagnostics(error: CompilerError): CompilerError {
  const rollbackDetails = { rollbackStatus: 'restored' };
  if (isEmptyDiagnosticsDetails(error.details)) {
    return new CompilerError(error.code, error.message, rollbackDetails);
  }
  if (isPlainObjectDetails(error.details)) {
    return new CompilerError(error.code, error.message, {
      ...error.details,
      ...rollbackDetails
    });
  }
  return new CompilerError(error.code, error.message, {
    ...rollbackDetails,
    causeDetails: normalizeCauseDetails(error.details)
  });
}

type ProjectSourceMigrationEntry = Extract<UpgradeMigrationEntry, { kind: 'rename-file' | 'rename-directory' }>;

type ManifestSourceMigrationEntry = Extract<
  UpgradeMigrationEntry,
  { kind: ManifestFileMigrationKind | 'copy-directory' }
>;

type BaseMigrationOperationContext = {
  projectRoot: string;
  targetManifestRoot: string;
  targetPath: string;
};

type MigrationApplyContext<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> =
  BaseMigrationOperationContext & {
    entry: Extract<UpgradeMigrationEntry, { kind: K }>;
  };

type ManifestFileMigrationContext = BaseMigrationOperationContext & {
  entry: Extract<UpgradeMigrationEntry, { kind: ManifestFileMigrationKind }>;
};

type TextReplaceMigrationContext = BaseMigrationOperationContext & {
  entry: Extract<UpgradeMigrationEntry, { kind: 'text-replace' | 'text-replace-regex' }>;
};

type FileOperationEvidenceContext<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> =
  BaseMigrationOperationContext & {
    entry: Extract<UpgradeMigrationEntry, { kind: K }>;
  };

type ManifestFileOperationEvidenceContext = BaseMigrationOperationContext & {
  entry: Extract<UpgradeMigrationEntry, { kind: ManifestFileMigrationKind }>;
};

type UpgradeMigrationOperationRecord = UpgradePlan['migrationOperations'][number];

type MigrationOperationSpec<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> = {
  validate?: (context: MigrationEntryValidationContext<K>) => void;
  apply: (context: MigrationApplyContext<K>) => Promise<void>;
  collectFileEvidence?: (context: FileOperationEvidenceContext<K>) => Promise<string[]>;
  collectImpacts?: (entry: Extract<UpgradeMigrationEntry, { kind: K }>) => string[];
  buildOperation: (entry: Extract<UpgradeMigrationEntry, { kind: K }>) => UpgradeMigrationOperationRecord;
};

type MigrationOperationSpecs = {
  [K in UpgradeMigrationEntry['kind']]: MigrationOperationSpec<K>;
};

type AnyMigrationOperationSpec = {
  validate?: (context: MigrationEntryValidationContext) => void;
  apply: (context: MigrationApplyContext) => Promise<void>;
  collectFileEvidence?: (context: FileOperationEvidenceContext) => Promise<string[]>;
  collectImpacts?: (entry: UpgradeMigrationEntry) => string[];
  buildOperation: (entry: UpgradeMigrationEntry) => UpgradeMigrationOperationRecord;
};

function getMigrationOperationSpec(entry: { kind: string }): AnyMigrationOperationSpec | undefined {
  return (migrationOperationSpecs as Partial<Record<string, AnyMigrationOperationSpec>>)[entry.kind];
}

function collectMigrationProjectPaths(entry: UpgradeMigrationEntry): Array<readonly ['source' | 'target', string]> {
  const spec = getMigrationOperationSpec(entry);
  if (!spec) throw unsupportedMigrationKindError(entry as { kind: string });
  return (spec.collectImpacts?.(entry) ?? [entry.target]).map((relativePath) => [relativePath === entry.target ? 'target' : 'source', relativePath]);
}

function resolveProjectMigrationTarget(projectRoot: string, entry: UpgradeMigrationEntry): string {
  return resolveProjectPath(projectRoot, entry.target, {
    migrationId: entry.id,
    role: 'target'
  });
}

function resolveManifestMigrationSource(targetManifestRoot: string, entry: ManifestSourceMigrationEntry): string {
  return resolveManifestPath(targetManifestRoot, entry.source, {
    migrationId: entry.id,
    role: 'manifest-source'
  });
}

function resolveProjectMigrationSource(projectRoot: string, entry: ProjectSourceMigrationEntry): string {
  return resolveProjectPath(projectRoot, entry.source, {
    migrationId: entry.id,
    role: 'source'
  });
}

function ensureMigrationPathImpacted(
  impacts: string[],
  entry: UpgradeMigrationEntry,
  role: 'source' | 'target',
  relativePath: string
): void {
  if (impacts.includes(relativePath)) {
    return;
  }
  throw new CompilerError(
    'UPGRADE-MIGRATION-007',
    `Migration ${role} "${relativePath}" is outside upgrade impacts`,
    migrationPathDetails('migration-targets', relativePath, 'project', {
      migrationId: entry.id,
      role
    })
  );
}

function ensureMigrationImpacts(impacts: string[], entry: UpgradeMigrationEntry): void {
  for (const [role, relativePath] of collectMigrationProjectPaths(entry)) {
    ensureMigrationPathImpacted(impacts, entry, role, relativePath);
  }
}

async function applyManifestFileMigration(context: ManifestFileMigrationContext): Promise<void> {
  const { entry, targetManifestRoot, targetPath } = context;
  const sourcePath = resolveManifestMigrationSource(targetManifestRoot, entry);
  await statManifestFileMigrationSource(sourcePath, entry.source, entry.kind);
  await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function applyTextReplaceMigration(context: TextReplaceMigrationContext): Promise<void> {
  const { entry, targetPath } = context;
  await statFileMigrationTarget(targetPath, entry.target, entry.kind);
  const source = await fs.readFile(targetPath, 'utf8');
  await fs.writeFile(
    targetPath,
    entry.kind === 'text-replace'
      ? applyTextReplace(source, entry)
      : applyTextReplaceRegex(source, entry),
    'utf8'
  );
}

async function applyDbExpandContractMigration(context: MigrationApplyContext<'db-expand-contract'>): Promise<void> {
  const { entry, targetPath, projectRoot } = context;
  await statFileMigrationTarget(targetPath, entry.target, entry.kind);
  let content = await fs.readFile(targetPath, 'utf8');

  const modelStart = content.indexOf(`model ${entry.entity} {`);
  if (modelStart === -1) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-031',
      `Target database model "${entry.entity}" not found in schema "${entry.target}"`
    );
  }
  const modelEnd = content.indexOf('}', modelStart);
  if (modelEnd === -1) {
    throw new CompilerError(
      'UPGRADE-MIGRATION-031',
      `Invalid schema structure for model "${entry.entity}" in "${entry.target}"`
    );
  }

  const modelContent = content.substring(modelStart, modelEnd);
  let updatedModelContent = modelContent;
  if (!modelContent.includes(entry.expandField)) {
    updatedModelContent = modelContent.trim() + `\n  ${entry.expandField}\n`;
  }

  if (entry.contractField) {
    const lines = updatedModelContent.split('\n');
    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith(entry.contractField) || trimmed.startsWith(`${entry.contractField} `)) {
        return `  // [Contracted Old Field]: ${line.trim()}`;
      }
      return line;
    });
    updatedModelContent = updatedLines.join('\n');
  }

  content = content.substring(0, modelStart) + updatedModelContent + content.substring(modelEnd);
  await fs.writeFile(targetPath, content, 'utf8');

  if (entry.copyJobCode) {
    const jobDir = path.join(projectRoot, 'src', 'jobs', 'db-migrations');
    await ensureDir(jobDir);
    const jobFile = path.join(jobDir, `${entry.id}.ts`);
    const jobContent = `// @generated-db-migration-job migration-id:${entry.id}
export async function runMigrationJob(prisma: any): Promise<void> {
  console.log('[Migration Job ${entry.id}] Starting copy process for entity ${entry.entity}...');
  ${entry.copyJobCode}
  console.log('[Migration Job ${entry.id}] Copy process completed successfully.');
}
`;
    await fs.writeFile(jobFile, jobContent, 'utf8');
  }
}

async function applyMigrationEntry(
  projectRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entry: UpgradeMigrationEntry
): Promise<void> {
  ensureMigrationImpacts(impacts, entry);
  const targetPath = resolveProjectMigrationTarget(projectRoot, entry);
  const spec = getMigrationOperationSpec(entry);
  if (!spec) {
    throw unsupportedMigrationKindError(entry as { kind: string });
  }
  await spec.apply({ entry, projectRoot, targetManifestRoot, targetPath });
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
    for (const [role, relativePath] of collectMigrationProjectPaths(entry)) {
      evidence.push(await describeMigrationPathStatus(projectRoot, entry.id, role, relativePath));
    }
  }
  return uniqueSorted(evidence);
}

type MigrationPathStats = Awaited<ReturnType<typeof fs.stat>>;

async function statOptionalMigrationPath(targetPath: string): Promise<MigrationPathStats | null> {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

async function statExistingMigrationPath(targetPath: string, missingError: CompilerError): Promise<MigrationPathStats> {
  const stats = await statOptionalMigrationPath(targetPath);
  if (!stats) {
    throw missingError;
  }
  return stats;
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
    | 'slot-contract-update'
    | 'db-expand-contract' = 'delete-file',
  options: { allowMissing?: boolean } = {}
): Promise<'file' | 'missing'> {
  const stats = await statOptionalMigrationPath(targetPath);
  if (!stats) {
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
  const stats = await statExistingMigrationPath(targetPath, new CompilerError('UPGRADE-MIGRATION-025', `Delete-directory target "${target}" is missing`));
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-026', `Delete-directory target "${target}" must be a directory`);
  }
}

async function statCreateDirectoryMigrationTarget(targetPath: string, target: string): Promise<void> {
  const stats = await statOptionalMigrationPath(targetPath);
  if (!stats) {
    return;
  }
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-028', `Create-directory target "${target}" must be a directory when it already exists`);
  }
}

async function statRenameMigrationSource(sourcePath: string, source: string): Promise<void> {
  const stats = await statExistingMigrationPath(sourcePath, new CompilerError('UPGRADE-MIGRATION-018', `Rename-file source "${source}" is missing`));
  if (!stats.isFile()) {
    throw new CompilerError('UPGRADE-MIGRATION-019', `Rename-file source "${source}" must be a file`);
  }
}

async function statRenameDirectoryMigrationSource(sourcePath: string, source: string): Promise<void> {
  const stats = await statExistingMigrationPath(sourcePath, new CompilerError('UPGRADE-MIGRATION-018', `Rename-directory source "${source}" is missing`));
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-019', `Rename-directory source "${source}" must be a directory`);
  }
}

async function statManifestFileMigrationSource(
  sourcePath: string,
  source: string,
  kind: ManifestFileMigrationKind
): Promise<void> {
  const stats = await statExistingMigrationPath(sourcePath, new CompilerError('UPGRADE-MIGRATION-008', `Migration source "${source}" is missing`));
  if (!stats.isFile()) {
    throw new CompilerError('UPGRADE-MIGRATION-024', `${kind} source "${source}" must be a file`);
  }
}

async function statCopyDirectoryMigrationSource(sourcePath: string, source: string): Promise<void> {
  const stats = await statExistingMigrationPath(sourcePath, new CompilerError('UPGRADE-MIGRATION-008', `Migration source "${source}" is missing`));
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-023', `Copy-directory source "${source}" must be a directory`);
  }
}

async function statCopyDirectoryMigrationTarget(targetPath: string, target: string): Promise<void> {
  const stats = await statOptionalMigrationPath(targetPath);
  if (!stats) {
    return;
  }
  if (!stats.isDirectory()) {
    throw new CompilerError('UPGRADE-MIGRATION-027', `Copy-directory target "${target}" must be a directory when it already exists`);
  }
}

async function collectManifestFileOperationEvidence(
  context: ManifestFileOperationEvidenceContext
): Promise<string[]> {
  const { entry, targetManifestRoot, targetPath } = context;
  const sourcePath = resolveManifestMigrationSource(targetManifestRoot, entry);
  await statManifestFileMigrationSource(sourcePath, entry.source, entry.kind);
  await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
  return [
    entry.kind === 'file-replace'
      ? `${entry.id}:manifest-source:exists`
      : `${entry.id}:manifest-source:file`
  ];
}

function buildMigrationOperationRecord(
  entry: UpgradeMigrationEntry,
  role: UpgradeMigrationOperationRecord['role'],
  details: Omit<Partial<UpgradeMigrationOperationRecord>, 'id' | 'kind' | 'target' | 'role'> = {}
): UpgradeMigrationOperationRecord {
  return {
    id: entry.id,
    kind: entry.kind,
    target: entry.target,
    role,
    ...details
  };
}

type ManifestFileMigrationKind = 'file-replace' | 'copy-file';
type JsonItemMigrationEntry = Extract<UpgradeMigrationEntry, { kind: 'json-array-append' | 'json-array-remove' }>;
type JsonTargetMigrationEntry = Extract<UpgradeMigrationEntry, { kind: 'json-array-append' | 'json-array-remove' | 'json-object-merge' }>;

function buildJsonItemMigrationOperation(entry: JsonItemMigrationEntry): UpgradeMigrationOperationRecord {
  return buildMigrationOperationRecord(entry, 'json', {
    path: [...entry.path],
    itemCount: entry.items.length
  });
}

function createManifestFileMigrationSpec<K extends ManifestFileMigrationKind>(): MigrationOperationSpec<K> {
  return {
    validate: validateSourceMigrationEntry,
    apply: applyManifestFileMigration,
    collectFileEvidence: collectManifestFileOperationEvidence,
    buildOperation: (entry: Extract<UpgradeMigrationEntry, { kind: ManifestFileMigrationKind }>) => buildMigrationOperationRecord(entry, 'file', { source: entry.source })
  };
}

function createDeleteMigrationSpec<K extends 'delete-file' | 'delete-directory'>(
  role: 'file' | 'directory',
  remove: (targetPath: string, target: string) => Promise<void>,
  stat: (targetPath: string, target: string) => Promise<unknown>
): MigrationOperationSpec<K> {
  return {
    apply: async ({ entry, targetPath }: MigrationApplyContext<'delete-file' | 'delete-directory'>) => {
      await remove(targetPath, entry.target);
    },
    collectFileEvidence: async ({ entry, targetPath }: FileOperationEvidenceContext<'delete-file' | 'delete-directory'>) => {
      await stat(targetPath, entry.target);
      return [`${entry.id}:target:${role}`];
    },
    buildOperation: (entry: Extract<UpgradeMigrationEntry, { kind: 'delete-file' | 'delete-directory' }>) => buildMigrationOperationRecord(entry, role)
  };
}

async function prepareRenameMigrationTarget(
  entry: ProjectSourceMigrationEntry,
  projectRoot: string,
  targetPath: string,
  label: 'Rename-file' | 'Rename-directory',
  statSource: (sourcePath: string, source: string) => Promise<void>
): Promise<string> {
  const sourcePath = resolveProjectMigrationSource(projectRoot, entry);
  await statSource(sourcePath, entry.source);
  if (await pathExists(targetPath)) {
    throw new CompilerError('UPGRADE-MIGRATION-020', `${label} target "${entry.target}" already exists`);
  }
  return sourcePath;
}

function createRenameMigrationSpec<K extends ProjectSourceMigrationEntry['kind']>(
  role: 'file' | 'directory',
  label: 'Rename-file' | 'Rename-directory',
  statSource: (sourcePath: string, source: string) => Promise<void>
): MigrationOperationSpec<K> {
  return {
    validate: validateSourceMigrationEntry,
    collectImpacts: (entry: ProjectSourceMigrationEntry) => [entry.source, entry.target],
    apply: async ({ entry, projectRoot, targetPath }: MigrationApplyContext<ProjectSourceMigrationEntry['kind']>) => {
      const sourcePath = await prepareRenameMigrationTarget(entry, projectRoot, targetPath, label, statSource);
      await ensureDir(path.dirname(targetPath));
      await fs.rename(sourcePath, targetPath);
    },
    collectFileEvidence: async ({ entry, projectRoot, targetPath }: FileOperationEvidenceContext<ProjectSourceMigrationEntry['kind']>) => {
      await prepareRenameMigrationTarget(entry, projectRoot, targetPath, label, statSource);
      return [`${entry.id}:source:${role}`, `${entry.id}:target:available`];
    },
    buildOperation: (entry: ProjectSourceMigrationEntry) => buildMigrationOperationRecord(entry, role, { source: entry.source })
  };
}

async function prepareCopyDirectoryMigration(context: MigrationApplyContext<'copy-directory'>): Promise<string> {
  const { entry, targetManifestRoot, targetPath } = context;
  const sourcePath = resolveManifestMigrationSource(targetManifestRoot, entry);
  await statCopyDirectoryMigrationSource(sourcePath, entry.source);
  await statCopyDirectoryMigrationTarget(targetPath, entry.target);
  return sourcePath;
}

async function applyJsonTargetMigration(
  entry: JsonTargetMigrationEntry,
  targetPath: string,
  update: (config: unknown) => unknown,
  createMissing: boolean
): Promise<void> {
  const targetStatus = await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
  if (targetStatus === 'missing' && !createMissing) {
    return;
  }
  const config = update(targetStatus === 'file' ? await readJson<unknown>(targetPath) : {});
  if (createMissing) {
    await ensureDir(path.dirname(targetPath));
  }
  await writeJson(targetPath, config);
}

const migrationOperationSpecs = {
  'file-replace': createManifestFileMigrationSpec<'file-replace'>(),
  'copy-file': createManifestFileMigrationSpec<'copy-file'>(),
  'copy-directory': {
    validate: validateSourceMigrationEntry,
    apply: async (context) => {
      await copyRecursive(await prepareCopyDirectoryMigration(context), context.targetPath);
    },
    collectFileEvidence: async (context) => {
      await prepareCopyDirectoryMigration(context);
      return [`${context.entry.id}:manifest-source:directory`];
    },
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'directory', { source: entry.source })
  },
  'config-rewrite': {
    validate: validateConfigRewriteMigrationEntry,
    apply: async ({ entry, targetPath }) => {
      await statFileMigrationTarget(targetPath, entry.target, entry.kind);
      const config = applyConfigUpdates(await readJson<unknown>(targetPath), entry.updates);
      await writeJson(targetPath, config);
    },
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'json', { updateCount: entry.updates.length })
  },
  'json-array-append': {
    validate: validateJsonArrayMigrationEntry,
    apply: async ({ entry, targetPath }) => {
      await applyJsonTargetMigration(entry, targetPath, (config) => applyJsonArrayAppend(config, entry), true);
    },
    buildOperation: buildJsonItemMigrationOperation
  },
  'json-array-remove': {
    validate: validateJsonArrayMigrationEntry,
    apply: async ({ entry, targetPath }) => {
      await applyJsonTargetMigration(entry, targetPath, (config) => applyJsonArrayRemove(config, entry), false);
    },
    buildOperation: buildJsonItemMigrationOperation
  },
  'json-object-merge': {
    validate: validateJsonObjectMergeMigrationEntry,
    apply: async ({ entry, targetPath }) => {
      await applyJsonTargetMigration(entry, targetPath, (config) => applyJsonObjectMerge(config, entry), true);
    },
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'json', {
      path: [...entry.path],
      valueKeyCount: Object.keys(entry.value).length
    })
  },
  'text-append': {
    validate: ({ entry, entryPath }) => {
      ensureMigrationString(entry.content, 'content', entryPath);
    },
    apply: async ({ entry, targetPath }) => {
      await appendTextMigrationTarget(targetPath, entry.target, entry.content);
    },
    collectFileEvidence: async ({ entry, targetPath }) => [
      `${entry.id}:target:${await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true })}`
    ],
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'text', { contentLength: entry.content.length })
  },
  'text-replace': {
    validate: ({ entry, entryPath }) => {
      ensureMigrationString(entry.search, 'search', entryPath);
      ensureMigrationString(entry.replacement, 'replacement', entryPath);
    },
    apply: applyTextReplaceMigration,
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'text', {
      searchLength: entry.search.length,
      replacementLength: entry.replacement.length
    })
  },
  'text-replace-regex': {
    validate: validateTextReplaceRegexMigrationEntry,
    apply: applyTextReplaceMigration,
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'text', {
      pattern: entry.pattern,
      replacementLength: entry.replacement.length,
      ...(entry.flags ? { flags: entry.flags } : {})
    })
  },
  'create-directory': {
    apply: async ({ entry, targetPath }) => {
      await statCreateDirectoryMigrationTarget(targetPath, entry.target);
      await ensureDir(targetPath);
    },
    collectFileEvidence: async ({ entry, targetPath }) => {
      await statCreateDirectoryMigrationTarget(targetPath, entry.target);
      return [];
    },
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'directory')
  },
  'delete-file': createDeleteMigrationSpec<'delete-file'>('file', removeFileMigrationTarget, statFileMigrationTarget),
  'delete-directory': createDeleteMigrationSpec<'delete-directory'>('directory', removeDirectoryMigrationTarget, statDirectoryMigrationTarget),
  'rename-file': createRenameMigrationSpec<'rename-file'>('file', 'Rename-file', statRenameMigrationSource),
  'rename-directory': createRenameMigrationSpec<'rename-directory'>('directory', 'Rename-directory', statRenameDirectoryMigrationSource),
  'slot-contract-update': {
    validate: validateSlotContractMigrationEntry,
    apply: async ({ entry, targetPath }) => {
      await statFileMigrationTarget(targetPath, entry.target, entry.kind);
    },
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'slot', {
      slotId: entry.slotId,
      ...(entry.inputType ? { inputType: entry.inputType } : {}),
      ...(entry.outputType ? { outputType: entry.outputType } : {}),
      ...(entry.writableZones ? { writableZones: [...entry.writableZones] } : {})
    })
  },
  'db-expand-contract': {
    validate: validateDbExpandContractMigrationEntry,
    apply: applyDbExpandContractMigration,
    buildOperation: (entry) => buildMigrationOperationRecord(entry, 'prisma', {
      entity: entry.entity,
      expandField: entry.expandField,
      contractField: entry.contractField
    })
  }
} satisfies MigrationOperationSpecs;

async function collectFileOperationEvidence(
  projectRoot: string,
  targetManifestRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    const spec = getMigrationOperationSpec(entry);
    if (!spec?.collectFileEvidence) {
      continue;
    }
    evidence.push(...await spec.collectFileEvidence({
      entry,
      projectRoot,
      targetManifestRoot,
      targetPath: resolveProjectMigrationTarget(projectRoot, entry)
    }));
  }
  return uniqueSorted(evidence);
}

function collectJsonShapeEvidence(migrationEntries: UpgradeMigrationEntry[]): string[] {
  return uniqueSorted(migrationEntries.flatMap((entry) => {
    const operation = buildMigrationOperation(entry);
    const path = operation.path?.join('.');
    return operation.role !== 'json' ? []
      : operation.updateCount !== undefined ? [`${entry.id}:updates:${operation.updateCount}`]
      : operation.itemCount !== undefined && path ? [`${entry.id}:path:${path}:array:${operation.itemCount}`]
      : operation.valueKeyCount !== undefined && path ? [`${entry.id}:path:${path}:object:${operation.valueKeyCount}`]
      : [];
  }));
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
  return uniqueSorted(evidence);
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

function assertJsonParentPath(config: unknown, pathSegments: string[], errorCode: string, message: string): void {
  let current = config;
  for (const segment of pathSegments.slice(0, -1)) {
    if (!isJsonObject(current)) {
      return;
    }
    const next = current[segment];
    if (next !== undefined && !isJsonObject(next)) {
      throw new CompilerError(errorCode, message);
    }
    current = next;
  }
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
  return uniqueSorted(evidence);
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
    if (entry.kind === 'json-array-append' || entry.kind === 'json-array-remove') {
      assertJsonParentPath(
        config,
        entry.path,
        'UPGRADE-MIGRATION-012',
        `JSON array migration parent must be an object for "${entry.target}"`
      );
      const target = readJsonPath(config, entry.path);
      if (target !== undefined && !Array.isArray(target)) {
        throw new CompilerError('UPGRADE-MIGRATION-012', `JSON array migration target must be an array for "${entry.target}"`);
      }
      evidence.push(`${entry.id}:target:${target === undefined ? 'missing' : 'array'}`);
      continue;
    }
    assertJsonParentPath(
      config,
      entry.path,
      'UPGRADE-MIGRATION-013',
      `JSON object merge parent must be an object for "${entry.target}"`
    );
    const target = readJsonPath(config, entry.path);
    if (target !== undefined && !isJsonObject(target)) {
      throw new CompilerError('UPGRADE-MIGRATION-013', `JSON object merge target must be an object for "${entry.target}"`);
    }
    evidence.push(`${entry.id}:target:${target === undefined ? 'missing' : 'object'}`);
  }
  return uniqueSorted(evidence);
}

type UpgradePreflightEvidence = {
  fileOperationEvidence: string[];
  jsonShapeEvidence: string[];
  jsonStructureEvidence: string[];
  migrationTargetEvidence: string[];
  scannedOverrides: string[];
  slotContractEvidence: string[];
  textPatternEvidence: string[];
};

type UpgradePreflightCheckInput = {
  acceptedRanges: string[];
  currentVersion: string;
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  migrations: UpgradeMigration[];
  targetVersion: string;
  evidence: UpgradePreflightEvidence;
};

type UpgradePreflightCheckSpec = {
  id: UpgradePreflightCheck['id'];
  message: (input: UpgradePreflightCheckInput) => string;
  evidence: (input: UpgradePreflightCheckInput) => string[];
};

const UPGRADE_PREFLIGHT_CHECK_SPECS = [
  {
    id: 'version-range',
    message: ({ currentVersion, targetVersion }) => `Upgrade path ${currentVersion} -> ${targetVersion} is allowed`,
    evidence: ({ acceptedRanges }) => acceptedRanges
  },
  {
    id: 'migration-entries',
    message: ({ migrationEntries }) => `${migrationEntries.length} migration entries loaded and validated`,
    evidence: ({ migrations }) => migrations.map((migration) => `${migration.id}:${migration.entry}`)
  },
  {
    id: 'migration-targets',
    message: ({ evidence }) => `${evidence.migrationTargetEvidence.length} migration paths checked`,
    evidence: ({ evidence }) => evidence.migrationTargetEvidence
  },
  {
    id: 'migration-file-operations',
    message: ({ evidence }) => `${evidence.fileOperationEvidence.length} file operations checked`,
    evidence: ({ evidence }) => evidence.fileOperationEvidence
  },
  {
    id: 'migration-json-shapes',
    message: ({ evidence }) => `${evidence.jsonShapeEvidence.length} JSON migration shapes checked`,
    evidence: ({ evidence }) => evidence.jsonShapeEvidence
  },
  {
    id: 'migration-json-structure',
    message: ({ evidence }) => `${evidence.jsonStructureEvidence.length} JSON migration targets checked`,
    evidence: ({ evidence }) => evidence.jsonStructureEvidence
  },
  {
    id: 'migration-text-patterns',
    message: ({ evidence }) => `${evidence.textPatternEvidence.length} text replacement patterns checked`,
    evidence: ({ evidence }) => evidence.textPatternEvidence
  },
  {
    id: 'migration-slot-contracts',
    message: ({ evidence }) => `${evidence.slotContractEvidence.length} slot contract fields checked`,
    evidence: ({ evidence }) => evidence.slotContractEvidence
  },
  {
    id: 'impact-scan',
    message: ({ impacts }) => `${impacts.length} upgrade impacts calculated`,
    evidence: ({ impacts }) => impacts
  },
  {
    id: 'override-conflicts',
    message: ({ evidence }) => `${evidence.scannedOverrides.length} overrides scanned with no conflicts`,
    evidence: ({ evidence }) => evidence.scannedOverrides
  }
] satisfies readonly UpgradePreflightCheckSpec[];

function buildUpgradePreflightChecks(input: UpgradePreflightCheckInput): UpgradePreflightCheck[] {
  return UPGRADE_PREFLIGHT_CHECK_SPECS.map((spec) => ({
    id: spec.id,
    status: 'passed',
    message: spec.message(input),
    evidence: spec.evidence(input)
  }));
}

function collectMigrationImpacts(migrationEntries: UpgradeMigrationEntry[]): string[] {
  return migrationEntries.flatMap((entry) => {
    const spec = getMigrationOperationSpec(entry);
    if (!spec) {
      throw unsupportedMigrationKindError(entry as { kind: string });
    }
    return spec.collectImpacts?.(entry) ?? [entry.target];
  });
}

type UpgradePreflightEvidenceOptions = {
  blockId: string;
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  projectRoot: string;
  targetManifestRoot: string;
  targetSlots: ManifestSlot[];
  workspaceRoot: string;
};

async function collectUpgradePreflightEvidence(
  options: UpgradePreflightEvidenceOptions
): Promise<UpgradePreflightEvidence> {
  const {
    blockId,
    impacts,
    migrationEntries,
    projectRoot,
    targetManifestRoot,
    targetSlots,
    workspaceRoot
  } = options;

  return {
    migrationTargetEvidence: await collectMigrationTargetEvidence(projectRoot, migrationEntries),
    fileOperationEvidence: await collectFileOperationEvidence(projectRoot, targetManifestRoot, migrationEntries),
    jsonShapeEvidence: collectJsonShapeEvidence(migrationEntries),
    jsonStructureEvidence: await collectJsonStructureEvidence(projectRoot, migrationEntries),
    textPatternEvidence: await collectTextPatternEvidence(projectRoot, migrationEntries),
    slotContractEvidence: collectSlotContractEvidence(targetSlots, migrationEntries),
    scannedOverrides: await detectOverrideConflicts(workspaceRoot, blockId, impacts)
  };
}

type UpgradePlanningOptions = {
  blockId: string;
  currentBlock: PlanFile['blocks'][number] | undefined;
  plan: PlanFile;
  projectRoot: string;
  targetVersion: string;
  workspaceRoot: string;
};

type PlannedWorkspaceUpgrade = {
  currentBlock: PlanFile['blocks'][number];
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  targetManifestRoot: string;
  upgradePlan: UpgradePlan;
};

async function planWorkspaceUpgrade(options: UpgradePlanningOptions): Promise<PlannedWorkspaceUpgrade> {
  const { blockId, currentBlock, plan, projectRoot, targetVersion, workspaceRoot } = options;
  if (!currentBlock?.version) {
    throw new CompilerError('UPGRADE-BLOCKED-003', `Block "${blockId}" is not declared in app.plan.yaml`);
  }

  const currentVersion = currentBlock.version;
  const targetEntry = await loadManifestById(blockId, {
    workspaceRoot,
    version: targetVersion,
    registrySources: plan.registry.sources
  });
  const migrations = targetEntry.manifest.upgrade?.migrations ?? [];
  const acceptedRanges = targetEntry.manifest.upgrade?.from ?? [];
  ensureUpgradeAllowed(currentVersion, targetVersion, migrations, acceptedRanges);

  const targetManifestRoot = path.dirname(targetEntry.manifestPath);
  const migrationEntries = await loadMigrationEntries(targetManifestRoot, blockId, targetVersion, migrations);
  const impacts = uniqueSorted([
    ...targetEntry.manifest.installs.map((install) => install.to),
    ...collectMigrationImpacts(migrationEntries)
  ]);
  const evidence = await collectUpgradePreflightEvidence({
    blockId,
    impacts,
    migrationEntries,
    projectRoot,
    targetManifestRoot,
    targetSlots: targetEntry.manifest.slots,
    workspaceRoot
  });
  const preflightChecks = buildUpgradePreflightChecks({
    acceptedRanges,
    currentVersion,
    evidence,
    impacts,
    migrationEntries,
    migrations,
    targetVersion
  });

  return {
    currentBlock,
    impacts,
    migrationEntries,
    targetManifestRoot,
    upgradePlan: buildUpgradePlan(
      blockId,
      currentVersion,
      targetVersion,
      preflightChecks,
      impacts,
      migrations,
      migrationEntries
    )
  };
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

async function recordUpgradeGeneratedArtifact(workspaceRoot: string, lock: LockFile, artifactPath: string): Promise<void> {
  addGeneratedPaths(lock, [artifactPath]);
  await writeProvenance(workspaceRoot, lock);
}

const PREFLIGHT_FAILURE_BY_ERROR_CODE = new Map<string, UpgradeDiagnostics['failedCheck']>([
  ['UPGRADE-BLOCKED-003', 'plan-block'],
  ['MANIFEST-SCHEMA-004', 'target-manifest'],
  ['UPGRADE-NOOP-001', 'version-range'],
  ['UPGRADE-BLOCKED-001', 'version-range'],
  ['UPGRADE-BLOCKED-002', 'version-range'],
  ['UPGRADE-MIGRATION-004', 'migration-targets'],
  ['UPGRADE-MIGRATION-007', 'migration-targets'],
  ['UPGRADE-MIGRATION-012', 'migration-json-structure'],
  ['UPGRADE-MIGRATION-013', 'migration-json-structure'],
  ['UPGRADE-MIGRATION-014', 'migration-text-patterns'],
  ['UPGRADE-MIGRATION-015', 'migration-text-patterns'],
  ['UPGRADE-MIGRATION-021', 'migration-slot-contracts'],
  ['UPGRADE-MIGRATION-022', 'migration-slot-contracts'],
  ['UPGRADE-CONFLICT-001', 'override-conflicts']
]);

const MIGRATION_FILE_OPERATION_FAILURE_CODES = new Set([
  'UPGRADE-MIGRATION-005',
  'UPGRADE-MIGRATION-008',
  'UPGRADE-MIGRATION-016',
  'UPGRADE-MIGRATION-017',
  'UPGRADE-MIGRATION-018',
  'UPGRADE-MIGRATION-019',
  'UPGRADE-MIGRATION-020',
  'UPGRADE-MIGRATION-023',
  'UPGRADE-MIGRATION-024',
  'UPGRADE-MIGRATION-025',
  'UPGRADE-MIGRATION-026',
  'UPGRADE-MIGRATION-027',
  'UPGRADE-MIGRATION-028'
]);

function classifyPreflightFailure(code: string): UpgradeDiagnostics['failedCheck'] {
  const failedCheck = PREFLIGHT_FAILURE_BY_ERROR_CODE.get(code);
  if (failedCheck) {
    return failedCheck;
  }
  if (MIGRATION_FILE_OPERATION_FAILURE_CODES.has(code)) {
    return 'migration-file-operations';
  }
  return code.startsWith('UPGRADE-MIGRATION-') ? 'migration-entries' : 'impact-scan';
}

async function writeUpgradeDiagnostics(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  phase: UpgradeDiagnostics['phase'],
  error: CompilerError,
  lock: LockFile | null
): Promise<void> {
  const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
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
  await recordUpgradeGeneratedArtifact(workspaceRoot, lock, CI_ARTIFACT_FILES.upgradeDiagnostics);
}

function buildMigrationKindCounts(migrationEntries: UpgradeMigrationEntry[]): Record<string, number> {
  return migrationEntries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function buildMigrationSummary(entry: UpgradeMigrationEntry, migrations: UpgradeMigration[]): UpgradePlan['migrationSummaries'][number] {
  const migration = migrations.find((candidate) => candidate.id === entry.id);
  const operation = buildMigrationOperation(entry);
  return {
    id: entry.id,
    kind: entry.kind,
    target: entry.target,
    reason: entry.reason,
    requiresVerification: migration?.requiresVerification ?? true,
    ...(operation.slotId ? { slotId: operation.slotId } : {}),
    ...(operation.source ? { source: operation.source } : {})
  };
}

function buildMigrationOperation(entry: UpgradeMigrationEntry): UpgradeMigrationOperationRecord {
  const spec = getMigrationOperationSpec(entry);
  if (!spec) {
    throw unsupportedMigrationKindError(entry as { kind: string });
  }
  return spec.buildOperation(entry);
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
    migrationSummaries: migrationEntries.map((entry) => buildMigrationSummary(entry, migrations)),
    migrationOperations: migrationEntries.map(buildMigrationOperation)
  };
}

const VOLATILE_PROJECT_SNAPSHOT_ENTRIES = new Set(['node_modules', '.next', 'test-results', 'playwright-report', 'coverage']);

async function copyProjectSnapshot(source: string, target: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(source);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return;
    }
    throw error;
  }

  if (stat.isDirectory()) {
    await ensureDir(target);
    let entries: string[];
    try {
      entries = await fs.readdir(source);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (VOLATILE_PROJECT_SNAPSHOT_ENTRIES.has(entry)) {
        continue;
      }
      await copyProjectSnapshot(path.join(source, entry), path.join(target, entry));
    }
    return;
  }

  await ensureDir(path.dirname(target));
  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

async function removeProjectSnapshotContents(projectRoot: string): Promise<void> {
  if (!(await pathExists(projectRoot))) {
    return;
  }

  const entries = await fs.readdir(projectRoot);
  for (const entry of entries) {
    if (VOLATILE_PROJECT_SNAPSHOT_ENTRIES.has(entry)) {
      continue;
    }
    await removeDir(path.join(projectRoot, entry));
  }
}

async function snapshotProject(projectRoot: string): Promise<string> {
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-'));
  await copyProjectSnapshot(projectRoot, backupRoot);
  return backupRoot;
}

async function restoreProject(projectRoot: string, backupRoot: string): Promise<void> {
  await ensureDir(projectRoot);
  await removeProjectSnapshotContents(projectRoot);
  await copyProjectSnapshot(backupRoot, projectRoot);
}

async function snapshotTextFile(filePath: string): Promise<string | null> {
  return (await pathExists(filePath)) ? fs.readFile(filePath, 'utf8') : null;
}

async function restoreTextFile(filePath: string, snapshot: string | null): Promise<void> {
  if (snapshot === null) {
    await removeDir(filePath);
    return;
  }
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, snapshot, 'utf8');
}

type UpgradeApplyContext = PlannedWorkspaceUpgrade & {
  lockPath: string;
  plan: PlanFile;
  planPath: string;
  projectRoot: string;
  targetVersion: string;
  upgradePlanPath: string;
  workspaceRoot: string;
};

type UpgradeApplyStep = (context: UpgradeApplyContext, lock: LockFile) => Promise<void>;

const upgradeApplySteps: UpgradeApplyStep[] = [
  async ({ workspaceRoot }, lock) => {
    await composeProject(workspaceRoot, lock);
    await writeProvenance(workspaceRoot, lock);
  },
  async ({ plan, workspaceRoot }, lock) => {
    await adaptProject(workspaceRoot, plan, lock);
  },
  async ({ workspaceRoot }, lock) => {
    await verifyProject(workspaceRoot, lock);
  },
  async ({ workspaceRoot }, lock) => {
    await lockProject(workspaceRoot, lock);
  }
];

async function readWorkspaceLock(workspaceRoot: string): Promise<LockFile> {
  return readLockFile(workspaceRoot);
}

async function runUpgradeApplySteps(context: UpgradeApplyContext, lock: LockFile): Promise<LockFile> {
  let currentLock = lock;
  for (const step of upgradeApplySteps) {
    await step(context, currentLock);
    currentLock = await readWorkspaceLock(context.workspaceRoot);
  }
  return currentLock;
}

async function applyPlannedWorkspaceUpgrade(context: UpgradeApplyContext): Promise<LockFile> {
  const {
    impacts,
    migrationEntries,
    plan,
    currentBlock,
    planPath,
    projectRoot,
    targetManifestRoot,
    targetVersion,
    upgradePlan,
    upgradePlanPath,
    workspaceRoot
  } = context;

  currentBlock.version = targetVersion;
  await writeYaml(planPath, plan);
  await applyMigrationEntries(projectRoot, targetManifestRoot, impacts, migrationEntries);

  let lock = await resolveGraph(workspaceRoot, plan);
  await validateResolvedTemplates(workspaceRoot, lock);
  await saveLock(workspaceRoot, lock);

  lock = await runUpgradeApplySteps(context, lock);
  await recordUpgradeGeneratedArtifact(workspaceRoot, lock, CI_ARTIFACT_FILES.upgradePlan);

  upgradePlan.status = 'applied';
  await writeJson(upgradePlanPath, upgradePlan);
  return lock;
}

export async function upgradeWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  options: { dryRun?: boolean } = {}
): Promise<{ plan: PlanFile; lock: LockFile; upgradePlan: UpgradePlan }> {
  const { lockPath, projectRoot, planPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadWorkspacePlan(workspaceRoot);
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  const existingLock = (await pathExists(readableLockPath)) ? await readJson<LockFile>(readableLockPath) : null;
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  let plannedUpgrade: PlannedWorkspaceUpgrade;
  try {
    plannedUpgrade = await planWorkspaceUpgrade({
      blockId,
      currentBlock,
      plan,
      projectRoot,
      targetVersion,
      workspaceRoot
    });
  } catch (error) {
    if (error instanceof CompilerError) {
      await writeUpgradeDiagnostics(workspaceRoot, blockId, targetVersion, 'planning', error, existingLock);
    }
    throw error;
  }

  const { upgradePlan } = plannedUpgrade;

  if (options.dryRun) {
    const lock = await readLockFile(workspaceRoot);
    await writeJson(upgradePlanPath, upgradePlan);
    await recordUpgradeGeneratedArtifact(workspaceRoot, lock, CI_ARTIFACT_FILES.upgradePlan);
    return { plan, lock, upgradePlan };
  }

  const backupRoot = await snapshotProject(projectRoot);
  const planSnapshot = await snapshotTextFile(planPath);
  const lockSnapshot = await snapshotTextFile(lockPath);
  await writeJson(upgradePlanPath, upgradePlan);

  try {
    const lock = await applyPlannedWorkspaceUpgrade({
      ...plannedUpgrade,
      lockPath,
      plan,
      planPath,
      projectRoot,
      targetVersion,
      upgradePlanPath,
      workspaceRoot
    });
    return { plan, lock, upgradePlan };
  } catch (error) {
    await restoreProject(projectRoot, backupRoot);
    await restoreTextFile(planPath, planSnapshot);
    await restoreTextFile(lockPath, lockSnapshot);
    if (error instanceof CompilerError) {
      const rollbackError = withRollbackDiagnostics(error);
      await writeUpgradeDiagnostics(workspaceRoot, blockId, targetVersion, 'apply', rollbackError, existingLock);
      throw rollbackError;
    }
    throw error;
  } finally {
    await removeDir(backupRoot);
  }
}
