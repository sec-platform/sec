import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  LockFile,
  PlanFile,
  UpgradeMigration
} from '../../compiler/contract.ts';
import { writeProvenance } from '../../adapters/compilation/emit/write-provenance.ts';
import { CompilerError } from '../../compiler/errors.ts';
import {
  throwUpgradeFailureWithSecondaryFailures,
  upgradeFailureWithSecondaryFailures
} from '../../compiler/upgrade/failure.ts';
import {
  applyConfigUpdates,
  applyJsonArrayAppend,
  applyJsonArrayRemove,
  applyJsonObjectMerge,
  applyTextReplace,
  compileUpgradeMigrationOperation,
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
import {
  buildUpgradePreflightChecks,
  buildUpgradePreview,
  classifyPreflightFailure,
  collectJsonShapeEvidence,
  collectMigrationImpacts,
  lockStateRevision,
  planningRequestRevision,
  type UpgradePreflightEvidence
} from '../../compiler/upgrade/planning.ts';
import { addGeneratedPaths } from "../../compiler/contract/lock-schema.ts";
import { readLockFile } from "../../adapters/workspace/lock.ts";
import {
  restoreWorkspace,
  retireUpgradeBackup,
  snapshotWorkspace,
  type UpgradeWorkspaceSnapshot
} from '../../adapters/upgrade/workspace-snapshot.ts';
import { compileWorkspace } from '../engineering/pipeline-orchestrator.ts';
import { loadManifestById } from '../../adapters/workspace/sources/load-manifest.ts';
import { loadOverrideManifest } from '../../adapters/workspace/sources/load-override-manifest.ts';
import { loadWorkspacePlan } from '../../adapters/workspace/sources/load-plan.ts';
import { settlePhysicalResourcesAsync } from '../../adapters/runtime-state/physical/runtime/resource-settlement.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../adapters/runtime-state/physical/runtime/retained-file-read.ts';
import { isCanonicalRegistryVersion } from '../../semantics/identity/block.ts';
import { uniqueSorted } from '../../contracts/canonical.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { ensureDir, pathExists, readJson, readOptionalJson, removeDir, writeJson } from "../../adapters/filesystem/files.ts";
import { formatJsonFile } from "../../contracts/json-text.ts";
import { publishExistingParentCanonicalWorkspaceFile } from "../../adapters/filesystem/file-publication.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { copyRecursive } from '../../adapters/filesystem/discovery.ts';
import { classifyCanonicalWorkspacePublicationFailure } from '../../adapters/filesystem/file-publication.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath } from "../../adapters/workspace-context.ts";
import { resolvePathInside } from "../../contracts/relative-path.ts";
import { withProjectWriteAuthorization } from '../../adapters/workspace/project-write-authorization.ts';
import { writeYaml } from '../../adapters/workspace/yaml.ts';
import type { UpgradeMigrationEntry } from '../../semantics/upgrade/manifest-types.ts';
import {
  createUpgradeExecutionAttempt,
  createUpgradeExecutionTerminal,
  createUpgradePlan,
  createUpgradePreview,
  parseUpgradeExecutionTerminalJson,
  parseUpgradePlanJson,
  requireUpgradeDigest,
  UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
  upgradeArtifactDigest,
  validateUpgradeDiagnostics,
  type UpgradeDiagnostics,
  type UpgradeExecutionTerminal,
  type UpgradePlan,
  type UpgradePreflightCheck,
  type UpgradePreview
} from '../../semantics/upgrade/upgrade-artifact.ts';

function matchesUpgradeRange(version: string, range: string): boolean {
  const supportedRange = isCanonicalRegistryVersion(range) || /^\d+\.\d+\.x$/u.test(range);
  return supportedRange && Bun.semver.satisfies(version, range);
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
    return new CompilerError(error.code, error.message, rollbackDetails, { cause: error });
  }
  if (isPlainObjectDetails(error.details)) {
    return new CompilerError(error.code, error.message, {
      ...error.details,
      ...rollbackDetails
    }, { cause: error });
  }
  return new CompilerError(error.code, error.message, {
    ...rollbackDetails,
    causeDetails: normalizeCauseDetails(error.details)
  }, { cause: error });
}

async function publishUpgradeFailureArtifacts(
  primary: Error,
  publications: readonly (() => Promise<void>)[],
  message: string
): Promise<never> {
  const secondaryFailures: unknown[] = [];
  for (const publish of publications) {
    try {
      await publish();
    } catch (error) {
      secondaryFailures.push(error);
    }
  }
  throwUpgradeFailureWithSecondaryFailures(primary, secondaryFailures, message);
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

async function collectUpgradePreflightEvidence(
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

type UpgradePlanningOptions = {
  blockId: string;
  currentBlock: PlanFile['blocks'][number] | undefined;
  lock: LockFile | null;
  plan: PlanFile;
  targetVersion: string;
  workspaceRoot: string;
};

type PlannedWorkspaceUpgrade = {
  currentBlock: PlanFile['blocks'][number];
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  targetManifestRoot: string;
  upgradePreview: UpgradePreview;
};

async function planWorkspaceUpgrade(options: UpgradePlanningOptions): Promise<PlannedWorkspaceUpgrade> {
  const { blockId, currentBlock, lock, plan, targetVersion, workspaceRoot } = options;
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
    targetManifestRoot,
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
  const compatibility = targetEntry.manifest.compatibility;
  if (!compatibility) {
    throw new CompilerError('UPGRADE-BLOCKED-004', `Block "${blockId}" target compatibility is unresolved`);
  }
  const sourceRevision = upgradeArtifactDigest({
    domain: 'sec.upgrade.source',
    manifest: targetEntry.manifest,
    manifestPath: targetEntry.manifestPath,
    registrySourceId: targetEntry.registrySourceId,
    registryKind: targetEntry.registryKind,
    registryLocation: targetEntry.registryLocation,
    registryPath: targetEntry.registryPath,
    migrationEntries
  });
  const lockRevision = lockStateRevision(lock);

  return {
    currentBlock,
    impacts,
    migrationEntries,
    targetManifestRoot,
    upgradePreview: buildUpgradePreview(
      blockId,
      currentVersion,
      targetVersion,
      upgradeArtifactDigest({
        domain: 'sec.upgrade.planning-input',
        blockId,
        targetVersion,
        workspacePlan: plan,
        sourceRevision,
        lockRevision,
        compatibility
      }),
      sourceRevision,
      lockRevision,
      compatibility,
      preflightChecks,
      impacts,
      migrations,
      migrationEntries
    )
  };
}

/**
 * Computes an Upgrade preview from retained workspace inputs without acquiring
 * write authority or publishing diagnostics, plans, provenance, or Lock state.
 */
export async function planUpgradeWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string
): Promise<{
  resultKind: 'preview';
  plan: PlanFile;
  lock: LockFile;
  upgradePlan: UpgradePreview;
}> {
  workspaceRoot = getWorkspacePaths(workspaceRoot).workspaceRoot;
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  const plannedUpgrade = await planWorkspaceUpgrade({
    blockId,
    currentBlock,
    lock,
    plan,
    targetVersion,
    workspaceRoot
  });
  return { resultKind: 'preview', plan, lock, upgradePlan: plannedUpgrade.upgradePreview };
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

async function recordUpgradeGeneratedArtifact(
  workspaceRoot: string,
  lock: LockFile,
  artifactPaths: readonly string[],
  commitFence: CommitFence
): Promise<void> {
  addGeneratedPaths(lock, artifactPaths);
  await writeProvenance(workspaceRoot, lock, commitFence);
}

async function writeUpgradeDiagnostics(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  provenance:
    | {
        phase: 'planning';
        workspaceIdentityDigest: string;
        planningRequestRevision: `sha256:${string}`;
      }
    | {
        phase: 'apply' | 'recovery';
        plan: UpgradePlan;
        terminal: UpgradeExecutionTerminal;
      },
  error: CompilerError,
  lock: LockFile | null,
  commitFence: CommitFence
): Promise<void> {
  const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeDiagnostics
  );
  const details = isEmptyDiagnosticsDetails(error.details) ? undefined : error.details;
  const diagnostics: UpgradeDiagnostics = provenance.phase === 'planning'
    ? validateUpgradeDiagnostics({
        formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
        artifactKind: 'upgrade-diagnostics',
        status: 'blocked',
        phase: 'planning',
        workspaceIdentityDigest: provenance.workspaceIdentityDigest,
        planningRequestRevision: provenance.planningRequestRevision,
        blockId,
        targetVersion,
        failedCheck: classifyPreflightFailure(error.code),
        errorCode: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details })
      })
    : validateUpgradeDiagnostics({
        formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
        artifactKind: 'upgrade-diagnostics',
        status: 'blocked',
        phase: provenance.phase,
        workspaceIdentityDigest: provenance.plan.workspaceIdentityDigest,
        operationIdentityDigest: provenance.plan.operationIdentityDigest,
        planRevision: provenance.plan.planRevision,
        attemptRevision: provenance.terminal.attempt.attemptRevision,
        executionTerminalRevision: provenance.terminal.terminalRevision,
        blockId,
        targetVersion,
        failedCheck: classifyPreflightFailure(error.code),
        errorCode: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details })
      });
  await writeJson(upgradeDiagnosticsPath, diagnostics, commitFence);
  if (!lock) {
    return;
  }
  await recordUpgradeGeneratedArtifact(
    workspaceRoot,
    lock,
    provenance.phase === 'planning'
      ? [CI_ARTIFACT_FILES.upgradeDiagnostics]
      : [
          CI_ARTIFACT_FILES.upgradePlan,
          CI_ARTIFACT_FILES.upgradeExecutionTerminal,
          CI_ARTIFACT_FILES.upgradeDiagnostics
        ],
    commitFence
  );
}

type UpgradeApplyContext = PlannedWorkspaceUpgrade & {
  commitFence: CommitFence;
  plan: PlanFile;
  targetVersion: string;
  workspaceWriteLease: WorkspaceWriteLeaseToken;
  workspaceRoot: string;
};

async function applyPlannedWorkspaceUpgrade(context: UpgradeApplyContext): Promise<LockFile> {
  const {
    commitFence,
    impacts,
    migrationEntries,
    plan,
    currentBlock,
    targetManifestRoot,
    targetVersion,
    workspaceWriteLease,
    workspaceRoot
  } = context;

  currentBlock.version = targetVersion;
  await writeYaml(getWorkspacePaths(workspaceRoot).workspaceConfigPath, plan, commitFence);
  await applyMigrationEntries(
    workspaceRoot,
    targetManifestRoot,
    impacts,
    migrationEntries,
    commitFence
  );

  const { lock } = await compileWorkspace(workspaceRoot, {
    source: 'upgrade',
    through: 'lock',
    verificationLane: 'all',
    workspaceWriteLease
  });
  return lock;
}

function readPersistedUpgradePlan(workspaceRoot: string): UpgradePlan {
  const artifactPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
  const bytes = readOptionalRetainedOrdinaryFile(artifactPath, 'Upgrade plan readback');
  if (bytes === null) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade plan readback is absent after publication');
  }
  return parseUpgradePlanJson(decodeExactUtf8(bytes, 'Upgrade plan readback'));
}

function readPersistedUpgradeExecutionTerminal(workspaceRoot: string): UpgradeExecutionTerminal {
  const artifactPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeExecutionTerminal
  );
  const bytes = readOptionalRetainedOrdinaryFile(artifactPath, 'Upgrade execution terminal readback');
  if (bytes === null) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade execution terminal readback is absent after publication');
  }
  return parseUpgradeExecutionTerminalJson(decodeExactUtf8(bytes, 'Upgrade execution terminal readback'));
}

async function buildUpgradeExecutionTerminal(input: {
  workspaceRoot: string;
  plan: UpgradePlan;
  attempt: UpgradeExecutionTerminal['attempt'];
  resultLock: LockFile | null;
  settlement: UpgradeExecutionTerminal['settlement'];
}): Promise<UpgradeExecutionTerminal> {
  const persistedPlan = readPersistedUpgradePlan(input.workspaceRoot);
  let workspacePlan: PlanFile | null = null;
  try {
    workspacePlan = await loadWorkspacePlan(input.workspaceRoot);
  } catch (error) {
    if (input.settlement !== 'recovery-required') throw error;
  }
  const workspaceBlockVersion = workspacePlan?.blocks.find((block) => block.id === input.plan.blockId)?.version ?? null;
  const resolvedBlockVersion = input.resultLock?.resolvedBlocks
    .find((block) => block.id === input.plan.blockId)?.version ?? null;
  return createUpgradeExecutionTerminal({
    workspaceIdentityDigest: input.plan.workspaceIdentityDigest,
    operationIdentityDigest: input.plan.operationIdentityDigest,
    planRevision: input.plan.planRevision,
    attempt: input.attempt,
    receipts: {
      workspacePlanRevision: upgradeArtifactDigest({
        domain: 'sec.upgrade.workspace-plan-readback',
        state: workspacePlan === null ? 'unresolved' : 'observed',
        plan: workspacePlan
      }),
      resultLockRevision: lockStateRevision(input.resultLock),
      planArtifactRevision: persistedPlan.planRevision
    },
    settlement: input.settlement,
    readback: {
      workspaceBlockVersion,
      resolvedBlockVersion
    }
  });
}

async function publishUpgradeExecutionTerminal(
  workspaceRoot: string,
  terminal: UpgradeExecutionTerminal,
  commitFence: CommitFence
): Promise<UpgradeExecutionTerminal> {
  await publishExistingParentCanonicalWorkspaceFile({
    workspaceRoot,
    targetPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
    bytes: Buffer.from(formatJsonFile(terminal), 'utf8'),
    label: 'Upgrade execution terminal',
    commitFence
  });
  const readback = readPersistedUpgradeExecutionTerminal(workspaceRoot);
  if (readback.terminalRevision !== terminal.terminalRevision) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade execution terminal readback differs from publication');
  }
  return readback;
}

function resolveUpgradeExecutionTerminalPublication(
  workspaceRoot: string,
  expected: UpgradeExecutionTerminal
): 'committed' | 'absent' | 'unknown' {
  try {
    const bytes = readOptionalRetainedOrdinaryFile(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      'Upgrade execution terminal commit resolution'
    );
    if (bytes === null) return 'absent';
    const expectedBytes = Buffer.from(formatJsonFile(expected), 'utf8');
    if (!Buffer.from(bytes).equals(expectedBytes)) return 'unknown';
    const parsed = parseUpgradeExecutionTerminalJson(decodeExactUtf8(bytes, 'Upgrade execution terminal commit resolution'));
    return parsed.terminalRevision === expected.terminalRevision ? 'committed' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function runUpgradeWorkspaceWithLease(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  workspaceWriteLease: WorkspaceWriteLeaseToken
): Promise<{
  resultKind: 'applied';
  plan: PlanFile;
  lock: LockFile;
  upgradePlan: UpgradePlan;
  upgradeExecutionTerminal: UpgradeExecutionTerminal;
}> {
  const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
  await commitFence();
  workspaceRoot = getWorkspacePaths(workspaceRoot).workspaceRoot;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const plan = await loadWorkspacePlan(workspaceRoot);
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  const existingLock = await readOptionalJson<LockFile>(readableLockPath);
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  const requestRevision = planningRequestRevision({
    workspaceIdentityDigest: workspaceWriteLease.workspaceIdentityDigest,
    blockId,
    targetVersion,
    plan,
    lock: existingLock
  });
  let plannedUpgrade: PlannedWorkspaceUpgrade;
  try {
    plannedUpgrade = await planWorkspaceUpgrade({
      blockId,
      currentBlock,
      lock: existingLock,
      plan,
      targetVersion,
      workspaceRoot
    });
  } catch (error) {
    if (error instanceof CompilerError) {
      await publishUpgradeFailureArtifacts(
        error,
        [
          () => removeDir(
            resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
            commitFence
          ),
          () => removeDir(
            resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
            commitFence
          ),
          () => writeUpgradeDiagnostics(
            workspaceRoot,
            blockId,
            targetVersion,
            {
              phase: 'planning',
              workspaceIdentityDigest: workspaceWriteLease.workspaceIdentityDigest,
              planningRequestRevision: requestRevision
            },
            error,
            existingLock,
            commitFence
          )
        ],
        'Upgrade planning failed and failure artifact publication did not complete'
      );
    }
    throw error;
  }

  const { artifactKind: ignoredPreviewKind, ...previewMaterial } = plannedUpgrade.upgradePreview;
  const upgradePlan = createUpgradePlan({
    workspaceIdentityDigest: requireUpgradeDigest(
      workspaceWriteLease.workspaceIdentityDigest,
      'Workspace write lease identity'
    ),
    ...previewMaterial
  });
  const attempt = createUpgradeExecutionAttempt({
    leaseGeneration: workspaceWriteLease.generation,
    leaseId: workspaceWriteLease.leaseId,
    ownerFileIdentityDigest: workspaceWriteLease.ownerFileIdentityDigest
  });

  const backup = await snapshotWorkspace(workspaceRoot, lockPath, commitFence);
  let pendingApplyFailure: Error | null = null;
  let retainBackupForRecovery = false;
  let appliedTerminalCommitted = false;
  let appliedTerminalCommitUnknown = false;
  let appliedTerminalDurabilityUncertain = false;
  const postCommitFailures: unknown[] = [];

  try {
    await removeDir(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      commitFence
    );
    await removeDir(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
      commitFence
    );
    await writeJson(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
      upgradePlan,
      commitFence
    );
    const persistedPlan = readPersistedUpgradePlan(workspaceRoot);
    if (persistedPlan.planRevision !== upgradePlan.planRevision) {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade plan readback differs from publication');
    }
    const lock = await withProjectWriteAuthorization(
      {
        workspaceRoot,
        operation: 'change.upgrade',
        impactPaths: upgradePlan.impacts,
        beforeCommit: commitFence
      },
      () => applyPlannedWorkspaceUpgrade({
        ...plannedUpgrade,
        commitFence,
        plan,
        targetVersion,
        workspaceWriteLease,
        workspaceRoot
      })
    );
    const expectedTerminal = await buildUpgradeExecutionTerminal({
        workspaceRoot,
        plan: upgradePlan,
        attempt,
        resultLock: lock,
        settlement: 'applied'
      });
    let terminal: UpgradeExecutionTerminal;
    try {
      terminal = await publishUpgradeExecutionTerminal(workspaceRoot, expectedTerminal, commitFence);
      appliedTerminalCommitted = true;
    } catch (publicationFailure) {
      const resolution = resolveUpgradeExecutionTerminalPublication(workspaceRoot, expectedTerminal);
      if (resolution === 'committed') {
        appliedTerminalCommitted = true;
        appliedTerminalDurabilityUncertain = true;
        retainBackupForRecovery = true;
        terminal = expectedTerminal;
        postCommitFailures.push(publicationFailure);
      } else {
        appliedTerminalCommitUnknown = resolution === 'unknown'
          || classifyCanonicalWorkspacePublicationFailure(publicationFailure) !== 'before-effect';
        throw publicationFailure;
      }
    }
    if (terminal.settlement !== 'applied') {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade execution did not settle as applied');
    }
    if (appliedTerminalDurabilityUncertain) {
      const publicationFailure = postCommitFailures[0];
      throw publicationFailure instanceof Error
        ? publicationFailure
        : new Error(String(publicationFailure));
    }
    await recordUpgradeGeneratedArtifact(
      workspaceRoot,
      lock,
      [CI_ARTIFACT_FILES.upgradePlan, CI_ARTIFACT_FILES.upgradeExecutionTerminal],
      commitFence
    );
    if (postCommitFailures.length > 0) {
      const primary = postCommitFailures[0] instanceof Error
        ? postCommitFailures[0]
        : new Error(String(postCommitFailures[0]));
      throwUpgradeFailureWithSecondaryFailures(
        primary,
        postCommitFailures.slice(1),
        'Upgrade applied terminal committed with later publication failures'
      );
    }
    return {
      resultKind: 'applied',
      plan,
      lock,
      upgradePlan,
      upgradeExecutionTerminal: terminal
    };
  } catch (error) {
    if (appliedTerminalCommitted) {
      const primary = error instanceof Error ? error : new Error(String(error));
      const postCommitFailure = appliedTerminalDurabilityUncertain
        ? new CompilerError(
            'UPGRADE-BLOCKED-005',
            `Upgrade applied terminal is externally visible but its durability did not settle: ${primary.message}`,
            {
              rollbackStatus: 'recovery-required',
              recoverySnapshot: {
                path: backup.backup.path,
                device: backup.backup.device,
                inode: backup.backup.inode,
                parentPath: backup.temporaryParent.path,
                parentDevice: backup.temporaryParent.device,
                parentInode: backup.temporaryParent.inode,
                status: 'retained-locator-only'
              }
            },
            { cause: primary }
          )
        : primary;
      pendingApplyFailure = upgradeFailureWithSecondaryFailures(
        postCommitFailure,
        postCommitFailures.filter((failure) => failure !== error),
        'Upgrade applied terminal committed but post-commit work failed'
      );
      throw pendingApplyFailure;
    }
    let settlement: UpgradeExecutionTerminal['settlement'] = 'rolled-back';
    let rollbackFailure: unknown = appliedTerminalCommitUnknown
      ? new CompilerError(
          'UPGRADE-BLOCKED-005',
          'Upgrade applied terminal publication could not be resolved as committed or absent'
        )
      : null;
    if (appliedTerminalCommitUnknown) {
      settlement = 'recovery-required';
      retainBackupForRecovery = true;
    }
    if (rollbackFailure === null) {
      try {
        await commitFence();
        await restoreWorkspace(backup, lockPath, commitFence);
      } catch (recoveryError) {
        settlement = 'recovery-required';
        rollbackFailure = recoveryError;
        retainBackupForRecovery = true;
      }
    }
    const failure = error instanceof CompilerError
      ? withRollbackDiagnostics(error)
      : new CompilerError(
          'UPGRADE-BLOCKED-005',
          `Upgrade apply failed: ${error instanceof Error ? error.message : String(error)}`,
          { rollbackStatus: settlement === 'rolled-back' ? 'restored' : 'recovery-required' },
          { cause: error }
        );
    const diagnosticFailure = rollbackFailure === null
      ? failure
      : new CompilerError(
          'UPGRADE-BLOCKED-005',
          `Upgrade recovery is required: ${rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure)}`,
          {
            rollbackStatus: 'recovery-required',
            originalErrorCode: failure.code,
            recoverySnapshot: {
              path: backup.backup.path,
              device: backup.backup.device,
              inode: backup.backup.inode,
              parentPath: backup.temporaryParent.path,
              parentDevice: backup.temporaryParent.device,
              parentInode: backup.temporaryParent.inode,
              status: 'retained-locator-only'
            }
          },
          {
            cause: new AggregateError(
              [error, rollbackFailure],
              'Upgrade apply and rollback failed',
              { cause: error }
            )
          }
        );
    let terminal: UpgradeExecutionTerminal | null = null;
    const publicationFailures: unknown[] = [];
    if (!appliedTerminalCommitUnknown) {
      try {
        terminal = await publishUpgradeExecutionTerminal(
          workspaceRoot,
          await buildUpgradeExecutionTerminal({
            workspaceRoot,
            plan: upgradePlan,
            attempt,
            resultLock: settlement === 'rolled-back' ? existingLock : null,
            settlement
          }),
          commitFence
        );
      } catch (publicationFailure) {
        publicationFailures.push(publicationFailure);
      }
    }
    if (terminal !== null) {
      try {
        await writeUpgradeDiagnostics(
          workspaceRoot,
          blockId,
          targetVersion,
          { phase: settlement === 'rolled-back' ? 'apply' : 'recovery', plan: upgradePlan, terminal },
          diagnosticFailure,
          settlement === 'rolled-back' ? null : existingLock,
          commitFence
        );
      } catch (publicationFailure) {
        publicationFailures.push(publicationFailure);
      }
    }
    pendingApplyFailure = upgradeFailureWithSecondaryFailures(
      diagnosticFailure,
      publicationFailures,
      'Upgrade apply failed and failure artifact publication did not complete'
    );
    throw pendingApplyFailure;
  } finally {
    if (!retainBackupForRecovery) {
      await settlePhysicalResourcesAsync({
        ...(pendingApplyFailure === null ? {} : {
          primary: { label: 'upgrade-apply', error: pendingApplyFailure }
        }),
        cleanup: [{
          label: `upgrade-backup:${backup.backup.path}`,
          settle: () => retireUpgradeBackup(backup)
        }]
      });
    }
  }
}
