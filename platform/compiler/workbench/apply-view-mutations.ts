import path from 'node:path';

import {
  isCanonicalBlockId,
  isCanonicalRegistryVersion
} from '../../shared/block-identity.ts';
import { rawSha256 } from '../../shared/canonical-primitives.ts';
import { countMatching } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import { formatJsonFile } from '../../shared/fs.ts';
import {
  getWorkspacePaths,
  isSafeRelativePath,
  posixPath,
  workspaceRelativePath
} from '../../shared/paths.ts';
import {
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  PhysicalNoFollowError,
  scanNoFollowDirectoryTreeMetadataV1,
  type NoFollowDirectoryTreeInventoryEntryV1,
  type PhysicalDirectoryIdentityV1
} from '../../shared/physical-no-follow.ts';
import type { AppMode, SlotKind } from '../../shared/plan-manifest-types.ts';
import { publishCanonicalWorkspaceFileV1 } from '../../shared/workspace-file-publication.ts';
import { compareCodeUnits } from '../ir/ir-canonical-primitives.ts';
import {
  applyEngineeringOperations,
  type EngineeringOperation,
  type EngineeringOperationKind
} from '../operations/engineering-operation.ts';

/** Compatibility transport name; canonical semantics live in EngineeringOperation. */
export type ViewMutationKind = EngineeringOperationKind;
/** Compatibility transport name; canonical semantics live in EngineeringOperation. */
export type ViewMutation = EngineeringOperation;

export interface ViewMutationFile {
  formatVersion: '1';
  mutations: ViewMutation[];
}

export interface ViewMutationResult {
  id: string;
  kind: ViewMutationKind;
  sourcePath: string;
  status: 'applied' | 'skipped';
  targetPath: 'source/app.yaml';
  detail: string;
}

export interface ViewMutationReport {
  formatVersion: '1';
  status: 'applied' | 'skipped';
  sourceRoot: 'source/views/mutations';
  targetPath: 'source/app.yaml';
  mutationFileCount: number;
  mutationCount: number;
  appliedCount: number;
  skippedCount: number;
  mutations: ViewMutationResult[];
}

export type ViewMutationCommitFence = () => Promise<void>;

const SUPPORTED_APP_MODES = new Set<AppMode>(['single-tenant', 'multi-tenant']);
const SUPPORTED_SLOT_KINDS = new Set<SlotKind>(['adapter', 'policy', 'ux', 'repair']);
const MAX_VIEW_MUTATION_FILE_BYTES = 1024 * 1024;
// One mutation file can already carry an arbitrary mutation array. Limiting the
// flat queue to 64 files keeps aggregate raw envelope bytes at or below the
// existing 64-MiB no-follow read domain while preserving batch authoring.
const MAX_VIEW_MUTATION_FILES = 64;
const MAX_VIEW_MUTATION_TOTAL_BYTES = MAX_VIEW_MUTATION_FILE_BYTES * MAX_VIEW_MUTATION_FILES;
const VIEW_MUTATION_SCAN_BUDGET_MS = 10_000;

type MutationSourceSnapshot = Readonly<{
  relativePath: string;
  sourcePath: string;
  file: ViewMutationFile;
  device: string;
  inode: string;
  size: number;
  contentDigest: `sha256:${string}`;
}>;

type LoadedMutationSources = Readonly<{
  root: PhysicalDirectoryIdentityV1 | null;
  files: readonly MutationSourceSnapshot[];
}>;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompilerError('WORKBENCH-MUTATION-001', `${label} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CompilerError('WORKBENCH-MUTATION-001', `${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertCanonicalBlockId(value: unknown, label: string): string {
  const blockId = assertNonEmptyString(value, label);
  if (!isCanonicalBlockId(blockId)) {
    throw new CompilerError('WORKBENCH-MUTATION-007', `${label} must be one canonical block id`);
  }
  return blockId;
}

function assertCanonicalVersion(value: unknown, label: string): string {
  const version = assertNonEmptyString(value, label);
  if (!isCanonicalRegistryVersion(version)) {
    throw new CompilerError('WORKBENCH-MUTATION-008', `${label} must be one canonical registry version`);
  }
  return version;
}

function assertSlotKind(value: unknown, label: string): SlotKind {
  const slotKind = assertNonEmptyString(value, label);
  if (!SUPPORTED_SLOT_KINDS.has(slotKind as SlotKind)) {
    throw new CompilerError('WORKBENCH-MUTATION-009', `${label} must be adapter, policy, ux, or repair`);
  }
  return slotKind as SlotKind;
}

function assertSlotTarget(value: unknown, label: string): string {
  const target = posixPath(assertNonEmptyString(value, label));
  if (!isSafeRelativePath(target) || !target.startsWith('custom/')) {
    throw new CompilerError('WORKBENCH-MUTATION-010', `${label} must stay under custom/**`);
  }
  return target;
}

function assertSlotSourcePath(value: unknown, label: string): string {
  const sourcePath = posixPath(assertNonEmptyString(value, label));
  const normalized = path.posix.normalize(sourcePath);
  if (
    normalized !== sourcePath ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized) ||
    !normalized.startsWith('source/code/slots/')
  ) {
    throw new CompilerError('WORKBENCH-MUTATION-002', `${label} must stay under source/code/slots/**`);
  }
  return normalized;
}

function parseMutation(raw: unknown, sourcePath: string): ViewMutation {
  assertObject(raw, `Mutation in ${sourcePath}`);
  const id = assertNonEmptyString(raw.id, `Mutation id in ${sourcePath}`);
  const kind = assertNonEmptyString(raw.kind, `Mutation kind in ${sourcePath}`);

  if (kind === 'set-app-name') return { id, kind, value: assertNonEmptyString(raw.value, `${id}.value`) };
  if (kind === 'set-app-mode') {
    const value = assertNonEmptyString(raw.value, `${id}.value`);
    if (!SUPPORTED_APP_MODES.has(value as AppMode)) {
      throw new CompilerError('WORKBENCH-MUTATION-003', `${id}.value must be single-tenant or multi-tenant`);
    }
    return { id, kind, value: value as AppMode };
  }
  if (kind === 'add-acceptance') {
    return { id, kind, acceptanceId: assertNonEmptyString(raw.acceptanceId, `${id}.acceptanceId`) };
  }
  if (kind === 'set-slot-description') {
    return {
      id,
      kind,
      slotId: assertNonEmptyString(raw.slotId, `${id}.slotId`),
      description: assertNonEmptyString(raw.description, `${id}.description`)
    };
  }
  if (kind === 'set-slot-source-path') {
    return {
      id,
      kind,
      slotId: assertNonEmptyString(raw.slotId, `${id}.slotId`),
      sourcePath: assertSlotSourcePath(raw.sourcePath, `${id}.sourcePath`)
    };
  }
  if (kind === 'add-block') {
    return {
      id,
      kind,
      blockId: assertCanonicalBlockId(raw.blockId, `${id}.blockId`),
      version: assertCanonicalVersion(raw.version, `${id}.version`)
    };
  }
  if (kind === 'remove-block') {
    return { id, kind, blockId: assertCanonicalBlockId(raw.blockId, `${id}.blockId`) };
  }
  if (kind === 'bind-slot') {
    return {
      id,
      kind,
      slotId: assertNonEmptyString(raw.slotId, `${id}.slotId`),
      block: assertCanonicalBlockId(raw.block, `${id}.block`),
      slotKind: assertSlotKind(raw.slotKind, `${id}.slotKind`),
      target: assertSlotTarget(raw.target, `${id}.target`),
      sourcePath: assertSlotSourcePath(raw.sourcePath, `${id}.sourcePath`),
      symbol: assertNonEmptyString(raw.symbol, `${id}.symbol`),
      description: typeof raw.description === 'string' ? raw.description : undefined
    };
  }
  if (kind === 'unbind-slot') {
    return { id, kind, slotId: assertNonEmptyString(raw.slotId, `${id}.slotId`) };
  }
  throw new CompilerError('WORKBENCH-MUTATION-004', `Unsupported Workbench mutation kind "${kind}"`);
}

export function parseViewMutationFile(raw: unknown, sourcePath: string): ViewMutationFile {
  assertObject(raw, sourcePath);
  if (raw.formatVersion !== '1') {
    throw new CompilerError('WORKBENCH-MUTATION-005', `${sourcePath} must use formatVersion "1"`);
  }
  if (!Array.isArray(raw.mutations)) {
    throw new CompilerError('WORKBENCH-MUTATION-001', `${sourcePath}.mutations must be an array`);
  }
  return { formatVersion: '1', mutations: raw.mutations.map((mutation) => parseMutation(mutation, sourcePath)) };
}

function decodeMutationUtf8(bytes: Uint8Array, sourcePath: string): string {
  if (bytes.byteLength > MAX_VIEW_MUTATION_FILE_BYTES) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-012',
      `${sourcePath} exceeds the ${MAX_VIEW_MUTATION_FILE_BYTES}-byte Workbench mutation limit`
    );
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-013',
      `${sourcePath} is not exact UTF-8`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

function mutationMetadata(root: PhysicalDirectoryIdentityV1): readonly NoFollowDirectoryTreeInventoryEntryV1[] {
  return scanNoFollowDirectoryTreeMetadataV1(root, {
    deadlineAtMs: performance.now() + VIEW_MUTATION_SCAN_BUDGET_MS,
    maximumEntries: MAX_VIEW_MUTATION_FILES
  });
}

function assertFlatJsonMutationEntry(entry: NoFollowDirectoryTreeInventoryEntryV1): void {
  if (entry.kind === 'link') {
    throw new CompilerError(
      'WORKBENCH-MUTATION-011',
      `Workbench mutation source tree contains a link entry "${entry.relativePath}"`
    );
  }
  if (entry.kind !== 'file' || entry.relativePath.includes('/') || !entry.relativePath.endsWith('.json')) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-011',
      `Workbench mutation source tree contains a non-canonical entry "${entry.relativePath}"`
    );
  }
  if (entry.size > MAX_VIEW_MUTATION_FILE_BYTES) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-012',
      `source/views/mutations/${entry.relativePath} exceeds the ${MAX_VIEW_MUTATION_FILE_BYTES}-byte Workbench mutation limit`
    );
  }
}

function sameMutationMetadata(
  left: NoFollowDirectoryTreeInventoryEntryV1,
  right: Pick<MutationSourceSnapshot, 'relativePath' | 'device' | 'inode' | 'size'>
): boolean {
  return left.kind === 'file' &&
    left.relativePath === right.relativePath &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size;
}

function readMutationSnapshot(
  workspaceRoot: string,
  sourceViewMutationsRoot: string,
  mutationRoot: PhysicalDirectoryIdentityV1,
  metadata: NoFollowDirectoryTreeInventoryEntryV1
): MutationSourceSnapshot {
  assertFlatJsonMutationEntry(metadata);
  const current = inspectNoFollowOrdinaryFileEntryV1(mutationRoot, metadata.relativePath);
  if (current === null || current.bytes === null || !sameMutationMetadata(metadata, current)) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-011',
      `Workbench mutation source "${metadata.relativePath}" changed between inventory and retained read`
    );
  }
  const absolutePath = path.join(sourceViewMutationsRoot, metadata.relativePath);
  const sourcePath = workspaceRelativePath(workspaceRoot, absolutePath);
  const raw = decodeMutationUtf8(current.bytes, sourcePath);
  return Object.freeze({
    relativePath: metadata.relativePath,
    sourcePath,
    file: parseViewMutationFile(JSON.parse(raw) as unknown, sourcePath),
    device: current.device,
    inode: current.inode,
    size: current.size,
    contentDigest: rawSha256(current.bytes)
  });
}

function assertMutationSourcesCurrent(
  workspaceRoot: string,
  expected: LoadedMutationSources
): void {
  const observed = loadMutationFiles(workspaceRoot);
  if ((expected.root === null) !== (observed.root === null)) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-011',
      'Workbench mutation source set changed after planning'
    );
  }
  if (
    expected.root !== null && observed.root !== null &&
    (
      expected.root.device !== observed.root.device ||
      expected.root.inode !== observed.root.inode ||
      expected.root.objectId !== observed.root.objectId
    )
  ) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-011',
      'Workbench mutation source root changed after planning'
    );
  }
  if (expected.files.length !== observed.files.length) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-011',
      'Workbench mutation source set changed after planning'
    );
  }
  for (let index = 0; index < expected.files.length; index += 1) {
    const expectedFile = expected.files[index]!;
    const observedFile = observed.files[index]!;
    if (
      expectedFile.relativePath !== observedFile.relativePath ||
      expectedFile.sourcePath !== observedFile.sourcePath ||
      expectedFile.device !== observedFile.device ||
      expectedFile.inode !== observedFile.inode ||
      expectedFile.size !== observedFile.size ||
      expectedFile.contentDigest !== observedFile.contentDigest
    ) {
      throw new CompilerError(
        'WORKBENCH-MUTATION-011',
        `Workbench mutation source "${expectedFile.relativePath}" changed after planning`
      );
    }
  }
}

function loadMutationFiles(workspaceRoot: string): LoadedMutationSources {
  const { sourceViewMutationsRoot } = getWorkspacePaths(workspaceRoot);
  let mutationRoot: PhysicalDirectoryIdentityV1;
  try {
    mutationRoot = inspectNoFollowDirectoryChainV1(
      path.resolve(sourceViewMutationsRoot),
      'Workbench mutation source root'
    ).target;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return Object.freeze({ root: null, files: Object.freeze([]) });
    }
    throw error;
  }

  const entries = [...mutationMetadata(mutationRoot)]
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  for (const entry of entries) assertFlatJsonMutationEntry(entry);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_VIEW_MUTATION_TOTAL_BYTES) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-012',
      `Workbench mutation source bytes exceed the ${MAX_VIEW_MUTATION_TOTAL_BYTES}-byte aggregate limit`
    );
  }

  const files = entries.map((entry) =>
    readMutationSnapshot(workspaceRoot, sourceViewMutationsRoot, mutationRoot, entry)
  );
  return Object.freeze({ root: mutationRoot, files: Object.freeze(files) });
}

export async function applyViewMutations(
  workspaceRoot: string,
  commitFence: ViewMutationCommitFence
): Promise<ViewMutationReport> {
  const { viewMutationReportPath } = getWorkspacePaths(workspaceRoot);
  const mutationSources = loadMutationFiles(workspaceRoot);
  const mutationFiles = mutationSources.files;
  const mutationEntries = mutationFiles.flatMap((entry) =>
    entry.file.mutations.map((mutation) => ({ mutation, sourcePath: entry.sourcePath }))
  );
  const operationCommitFence = async (): Promise<void> => {
    await commitFence();
    assertMutationSourcesCurrent(workspaceRoot, mutationSources);
  };
  const operationResults = await applyEngineeringOperations(
    workspaceRoot,
    mutationEntries.map((entry) => entry.mutation),
    operationCommitFence
  );
  const results: ViewMutationResult[] = operationResults.map((entry, index) => ({
    id: entry.id,
    kind: entry.kind,
    sourcePath: mutationEntries[index]!.sourcePath,
    status: entry.status,
    targetPath: 'source/app.yaml',
    detail: entry.detail
  }));
  const appliedCount = countMatching(results, (entry) => entry.status === 'applied');
  const report: ViewMutationReport = {
    formatVersion: '1',
    status: appliedCount > 0 ? 'applied' : 'skipped',
    sourceRoot: 'source/views/mutations',
    targetPath: 'source/app.yaml',
    mutationFileCount: mutationFiles.length,
    mutationCount: results.length,
    appliedCount,
    skippedCount: results.length - appliedCount,
    mutations: results
  };

  await publishCanonicalWorkspaceFileV1({
    workspaceRoot,
    targetPath: viewMutationReportPath,
    bytes: Buffer.from(formatJsonFile(report), 'utf8'),
    label: 'Workbench mutation report',
    commitFence: operationCommitFence
  });
  return report;
}
