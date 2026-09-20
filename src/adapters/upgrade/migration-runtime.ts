import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { UpgradeMigration } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import {
  isEmptyDiagnosticsDetails,
  isPlainObjectDetails,
  migrationManifestDetails,
  normalizeCauseDetails,
  withMigrationManifestDetails
} from '../../compiler/upgrade/failure.ts';
import {
  applyConfigUpdates,
  applyJsonArrayAppend,
  applyJsonArrayRemove,
  applyJsonObjectMerge,
  applyTextReplace,
  compileUpgradeMigrationProjectPaths,
  ensureJsonObject,
  ensureMigrationString,
  isJsonObject,
  validateConfigRewriteMigrationEntry,
  validateDbExpandContractMigrationEntry,
  validateJsonArrayMigrationEntry,
  validateJsonObjectMergeMigrationEntry,
  validateSourceMigrationEntry,
  type MigrationEntryValidationContext
} from '../../compiler/upgrade/migration-rules.ts';
import { collectJsonShapeEvidence, type UpgradePreflightEvidence } from '../../compiler/upgrade/planning.ts';
import { uniqueSorted } from '../../contracts/canonical.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { resolvePathInside } from '../../contracts/relative-path.ts';
import type { UpgradeMigrationEntry } from '../../semantics/upgrade/manifest-types.ts';
import type { UpgradePreflightCheck } from '../../semantics/upgrade/upgrade-artifact.ts';
import { copyRecursive } from '../filesystem/discovery.ts';
import { ensureDir, pathExists, readJson, writeJson } from '../filesystem/files.ts';
import { loadOverrideManifest } from '../workspace/sources/load-override-manifest.ts';

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
      { override: conflictingOverride }
    );
  }

  return uniqueSorted(manifest.overrides.map((entry) => entry.id));
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

export async function loadMigrationEntries(
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

function resolveWorkspaceMigrationPath(workspaceRoot: string, relativePath: string, context: MigrationPathContext = {}): string {
  const resolvedPath = resolvePathInside(workspaceRoot, relativePath);
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

async function removeFileMigrationTarget(
  targetPath: string,
  target: string,
  commitFence: CommitFence
): Promise<void> {
  await statFileMigrationTarget(targetPath, target);
  await commitFence();
  await fs.rm(targetPath);
}

async function removeDirectoryMigrationTarget(
  targetPath: string,
  target: string,
  commitFence: CommitFence
): Promise<void> {
  await statDirectoryMigrationTarget(targetPath, target);
  await commitFence();
  await fs.rm(targetPath, { recursive: true });
}

function migrationErrorDetails(entry: UpgradeMigrationEntry): Record<string, unknown> {
  return {
    migrationId: entry.id,
    migrationKind: entry.kind,
    target: entry.target,
    ...('source' in entry ? { source: entry.source } : {})
  };
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

type ProjectSourceMigrationEntry = Extract<UpgradeMigrationEntry, { kind: 'rename-file' | 'rename-directory' }>;

type ManifestSourceMigrationEntry = Extract<
  UpgradeMigrationEntry,
  { kind: ManifestFileMigrationKind | 'copy-directory' }
>;

type BaseMigrationOperationContext = {
  workspaceRoot: string;
  targetManifestRoot: string;
  targetPath: string;
};

type MigrationApplyContext<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> =
  BaseMigrationOperationContext & {
    commitFence: CommitFence;
    entry: Extract<UpgradeMigrationEntry, { kind: K }>;
  };

type ManifestFileMigrationContext = MigrationApplyContext<ManifestFileMigrationKind>;

type TextReplaceMigrationContext = MigrationApplyContext<'text-replace'>;

type FileOperationEvidenceContext<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> =
  BaseMigrationOperationContext & {
    entry: Extract<UpgradeMigrationEntry, { kind: K }>;
  };

type ManifestFileOperationEvidenceContext = BaseMigrationOperationContext & {
  entry: Extract<UpgradeMigrationEntry, { kind: ManifestFileMigrationKind }>;
};

type MigrationOperationSpec<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> = {
  validate?: (context: MigrationEntryValidationContext<K>) => void;
  apply: (context: MigrationApplyContext<K>) => Promise<void>;
  collectFileEvidence?: (context: FileOperationEvidenceContext<K>) => Promise<string[]>;
};

type MigrationOperationSpecs = {
  [K in UpgradeMigrationEntry['kind']]: MigrationOperationSpec<K>;
};

type AnyMigrationOperationSpec = {
  validate?: (context: MigrationEntryValidationContext) => void;
  apply: (context: MigrationApplyContext) => Promise<void>;
  collectFileEvidence?: (context: FileOperationEvidenceContext) => Promise<string[]>;
};

function getMigrationOperationSpec(entry: { kind: string }): AnyMigrationOperationSpec | undefined {
  return (migrationOperationSpecs as Partial<Record<string, AnyMigrationOperationSpec>>)[entry.kind];
}

function collectMigrationProjectPaths(entry: UpgradeMigrationEntry): Array<readonly ['source' | 'target', string]> {
  return [...compileUpgradeMigrationProjectPaths(entry)];
}

function resolveWorkspaceMigrationTarget(workspaceRoot: string, entry: UpgradeMigrationEntry): string {
  return resolveWorkspaceMigrationPath(workspaceRoot, entry.target, {
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

function resolveWorkspaceMigrationSource(workspaceRoot: string, entry: ProjectSourceMigrationEntry): string {
  return resolveWorkspaceMigrationPath(workspaceRoot, entry.source, {
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
  const { commitFence, entry, targetManifestRoot, targetPath } = context;
  const sourcePath = resolveManifestMigrationSource(targetManifestRoot, entry);
  await statManifestFileMigrationSource(sourcePath, entry.source, entry.kind);
  await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
  await ensureDir(path.dirname(targetPath), commitFence);
  await commitFence();
  await fs.copyFile(sourcePath, targetPath);
}

async function applyTextReplaceMigration(context: TextReplaceMigrationContext): Promise<void> {
  const { commitFence, entry, targetPath } = context;
  await statFileMigrationTarget(targetPath, entry.target, entry.kind);
  const source = await fs.readFile(targetPath, 'utf8');
  await commitFence();
  await fs.writeFile(targetPath, applyTextReplace(source, entry), 'utf8');
}

async function applyDbExpandContractMigration(context: MigrationApplyContext<'db-expand-contract'>): Promise<void> {
  const { commitFence, entry, targetPath, workspaceRoot } = context;
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
  await commitFence();
  await fs.writeFile(targetPath, content, 'utf8');

  if (entry.copyJobCode) {
    const jobDir = path.join(workspaceRoot, 'src', 'jobs', 'db-migrations');
    await ensureDir(jobDir, commitFence);
    const jobFile = path.join(jobDir, `${entry.id}.ts`);
    const jobContent = `// @generated-db-migration-job migration-id:${entry.id}
export async function runMigrationJob(prisma: any): Promise<void> {
  console.log('[Migration Job ${entry.id}] Starting copy process for entity ${entry.entity}...');
  ${entry.copyJobCode}
  console.log('[Migration Job ${entry.id}] Copy process completed successfully.');
}
`;
    await commitFence();
    await fs.writeFile(jobFile, jobContent, 'utf8');
  }
}

async function applyMigrationEntry(
  workspaceRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entry: UpgradeMigrationEntry,
  commitFence: CommitFence
): Promise<void> {
  ensureMigrationImpacts(impacts, entry);
  const targetPath = resolveWorkspaceMigrationTarget(workspaceRoot, entry);
  const spec = getMigrationOperationSpec(entry);
  if (!spec) {
    throw unsupportedMigrationKindError(entry as { kind: string });
  }
  await spec.apply({ commitFence, entry, workspaceRoot, targetManifestRoot, targetPath });
}

export async function applyMigrationEntries(
  workspaceRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entries: UpgradeMigrationEntry[],
  commitFence: CommitFence
): Promise<void> {
  for (const entry of entries) {
    try {
      await applyMigrationEntry(workspaceRoot, targetManifestRoot, impacts, entry, commitFence);
    } catch (error) {
      if (error instanceof CompilerError) {
        throw withMigrationErrorDetails(entry, error);
      }
      throw error;
    }
  }
}

async function describeMigrationPathStatus(
  workspaceRoot: string,
  migrationId: string,
  role: 'source' | 'target',
  relativePath: string
): Promise<string> {
  const exists = await pathExists(resolveWorkspaceMigrationPath(workspaceRoot, relativePath, { migrationId, role }));
  return `${migrationId}:${role}:${relativePath}:${exists ? 'exists' : 'missing'}`;
}

async function collectMigrationTargetEvidence(
  workspaceRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    for (const [role, relativePath] of collectMigrationProjectPaths(entry)) {
      evidence.push(await describeMigrationPathStatus(workspaceRoot, entry.id, role, relativePath));
    }
  }
  return uniqueSorted(evidence);
}

type MigrationPathStats = Stats;

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
    | 'text-append'
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

async function appendTextMigrationTarget(
  targetPath: string,
  target: string,
  content: string,
  commitFence: CommitFence
): Promise<void> {
  await ensureDir(path.dirname(targetPath), commitFence);
  try {
    await commitFence();
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

type ManifestFileMigrationKind = 'file-replace' | 'copy-file';
type JsonTargetMigrationEntry = Extract<UpgradeMigrationEntry, { kind: 'json-array-append' | 'json-array-remove' | 'json-object-merge' }>;

function createManifestFileMigrationSpec<K extends ManifestFileMigrationKind>(): MigrationOperationSpec<K> {
  return {
    validate: validateSourceMigrationEntry,
    apply: applyManifestFileMigration,
    collectFileEvidence: collectManifestFileOperationEvidence
  };
}

function createDeleteMigrationSpec<K extends 'delete-file' | 'delete-directory'>(
  role: 'file' | 'directory',
  remove: (targetPath: string, target: string, commitFence: CommitFence) => Promise<void>,
  stat: (targetPath: string, target: string) => Promise<unknown>
): MigrationOperationSpec<K> {
  return {
    apply: async ({ commitFence, entry, targetPath }: MigrationApplyContext<'delete-file' | 'delete-directory'>) => {
      await remove(targetPath, entry.target, commitFence);
    },
    collectFileEvidence: async ({ entry, targetPath }: FileOperationEvidenceContext<'delete-file' | 'delete-directory'>) => {
      await stat(targetPath, entry.target);
      return [`${entry.id}:target:${role}`];
    }
  };
}

async function prepareRenameMigrationTarget(
  entry: ProjectSourceMigrationEntry,
  workspaceRoot: string,
  targetPath: string,
  label: 'Rename-file' | 'Rename-directory',
  statSource: (sourcePath: string, source: string) => Promise<void>
): Promise<string> {
  const sourcePath = resolveWorkspaceMigrationSource(workspaceRoot, entry);
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
    apply: async ({ commitFence, entry, workspaceRoot, targetPath }: MigrationApplyContext<ProjectSourceMigrationEntry['kind']>) => {
      const sourcePath = await prepareRenameMigrationTarget(entry, workspaceRoot, targetPath, label, statSource);
      await ensureDir(path.dirname(targetPath), commitFence);
      await commitFence();
      await fs.rename(sourcePath, targetPath);
    },
    collectFileEvidence: async ({ entry, workspaceRoot, targetPath }: FileOperationEvidenceContext<ProjectSourceMigrationEntry['kind']>) => {
      await prepareRenameMigrationTarget(entry, workspaceRoot, targetPath, label, statSource);
      return [`${entry.id}:source:${role}`, `${entry.id}:target:available`];
    }
  };
}

async function prepareCopyDirectoryMigration(context: FileOperationEvidenceContext<'copy-directory'>): Promise<string> {
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
  createMissing: boolean,
  commitFence: CommitFence
): Promise<void> {
  const targetStatus = await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true });
  if (targetStatus === 'missing' && !createMissing) {
    return;
  }
  const config = update(targetStatus === 'file' ? await readJson<unknown>(targetPath) : {});
  if (createMissing) {
    await ensureDir(path.dirname(targetPath), commitFence);
  }
  await writeJson(targetPath, config, commitFence);
}

const migrationOperationSpecs = {
  'file-replace': createManifestFileMigrationSpec<'file-replace'>(),
  'copy-file': createManifestFileMigrationSpec<'copy-file'>(),
  'copy-directory': {
    validate: validateSourceMigrationEntry,
    apply: async (context) => {
      await copyRecursive(
        await prepareCopyDirectoryMigration(context),
        context.targetPath,
        context.commitFence
      );
    },
    collectFileEvidence: async (context) => {
      await prepareCopyDirectoryMigration(context);
      return [`${context.entry.id}:manifest-source:directory`];
    },
  },
  'config-rewrite': {
    validate: validateConfigRewriteMigrationEntry,
    apply: async ({ commitFence, entry, targetPath }) => {
      await statFileMigrationTarget(targetPath, entry.target, entry.kind);
      const config = applyConfigUpdates(await readJson<unknown>(targetPath), entry.updates);
      await writeJson(targetPath, config, commitFence);
    },
  },
  'json-array-append': {
    validate: validateJsonArrayMigrationEntry,
    apply: async ({ commitFence, entry, targetPath }) => {
      await applyJsonTargetMigration(
        entry,
        targetPath,
        (config) => applyJsonArrayAppend(config, entry),
        true,
        commitFence
      );
    },
  },
  'json-array-remove': {
    validate: validateJsonArrayMigrationEntry,
    apply: async ({ commitFence, entry, targetPath }) => {
      await applyJsonTargetMigration(
        entry,
        targetPath,
        (config) => applyJsonArrayRemove(config, entry),
        false,
        commitFence
      );
    },
  },
  'json-object-merge': {
    validate: validateJsonObjectMergeMigrationEntry,
    apply: async ({ commitFence, entry, targetPath }) => {
      await applyJsonTargetMigration(
        entry,
        targetPath,
        (config) => applyJsonObjectMerge(config, entry),
        true,
        commitFence
      );
    },
  },
  'text-append': {
    validate: ({ entry, entryPath }) => {
      ensureMigrationString(entry.content, 'content', entryPath);
    },
    apply: async ({ commitFence, entry, targetPath }) => {
      await appendTextMigrationTarget(targetPath, entry.target, entry.content, commitFence);
    },
    collectFileEvidence: async ({ entry, targetPath }) => [
      `${entry.id}:target:${await statFileMigrationTarget(targetPath, entry.target, entry.kind, { allowMissing: true })}`
    ],
  },
  'text-replace': {
    validate: ({ entry, entryPath }) => {
      ensureMigrationString(entry.search, 'search', entryPath);
      ensureMigrationString(entry.replacement, 'replacement', entryPath);
    },
    apply: applyTextReplaceMigration,
  },
  'create-directory': {
    apply: async ({ commitFence, entry, targetPath }) => {
      await statCreateDirectoryMigrationTarget(targetPath, entry.target);
      await ensureDir(targetPath, commitFence);
    },
    collectFileEvidence: async ({ entry, targetPath }) => {
      await statCreateDirectoryMigrationTarget(targetPath, entry.target);
      return [];
    },
  },
  'delete-file': createDeleteMigrationSpec<'delete-file'>('file', removeFileMigrationTarget, statFileMigrationTarget),
  'delete-directory': createDeleteMigrationSpec<'delete-directory'>('directory', removeDirectoryMigrationTarget, statDirectoryMigrationTarget),
  'rename-file': createRenameMigrationSpec<'rename-file'>('file', 'Rename-file', statRenameMigrationSource),
  'rename-directory': createRenameMigrationSpec<'rename-directory'>('directory', 'Rename-directory', statRenameDirectoryMigrationSource),
  'db-expand-contract': {
    validate: validateDbExpandContractMigrationEntry,
    apply: applyDbExpandContractMigration,
  }
} satisfies MigrationOperationSpecs;

async function collectFileOperationEvidence(
  workspaceRoot: string,
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
      workspaceRoot,
      targetManifestRoot,
      targetPath: resolveWorkspaceMigrationTarget(workspaceRoot, entry)
    }));
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
  workspaceRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (entry.kind !== 'text-replace') continue;
    const targetPath = resolveWorkspaceMigrationPath(workspaceRoot, entry.target, {
      migrationId: entry.id,
      role: 'target'
    });
    await statFileMigrationTarget(targetPath, entry.target, entry.kind);
    const source = await fs.readFile(targetPath, 'utf8');
    applyTextReplace(source, entry);
    evidence.push(`${entry.id}:literal:${entry.search.length}`);
  }
  return uniqueSorted(evidence);
}

async function collectJsonStructureEvidence(
  workspaceRoot: string,
  migrationEntries: UpgradeMigrationEntry[]
): Promise<string[]> {
  const evidence: string[] = [];
  for (const entry of migrationEntries) {
    if (!isJsonMigrationEntry(entry)) {
      continue;
    }
    const targetPath = resolveWorkspaceMigrationPath(workspaceRoot, entry.target, {
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

type UpgradePreflightEvidenceOptions = {
  blockId: string;
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  targetManifestRoot: string;
  workspaceRoot: string;
};

export async function collectUpgradePreflightEvidence(
  options: UpgradePreflightEvidenceOptions
): Promise<UpgradePreflightEvidence> {
  const {
    blockId,
    impacts,
    migrationEntries,
    targetManifestRoot,
    workspaceRoot
  } = options;

  return {
    migrationTargetEvidence: await collectMigrationTargetEvidence(workspaceRoot, migrationEntries),
    fileOperationEvidence: await collectFileOperationEvidence(workspaceRoot, targetManifestRoot, migrationEntries),
    jsonShapeEvidence: collectJsonShapeEvidence(migrationEntries),
    jsonStructureEvidence: await collectJsonStructureEvidence(workspaceRoot, migrationEntries),
    textPatternEvidence: await collectTextPatternEvidence(workspaceRoot, migrationEntries),
    scannedOverrides: await detectOverrideConflicts(workspaceRoot, blockId, impacts)
  };
}
