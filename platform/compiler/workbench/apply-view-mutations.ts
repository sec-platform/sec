import path from 'node:path';

import {
  isCanonicalBlockId,
  isCanonicalRegistryVersion
} from '../../shared/block-identity.ts';
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
  PhysicalNoFollowError,
  scanNoFollowDirectoryTreeV1
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

function loadMutationFiles(workspaceRoot: string): Array<{ sourcePath: string; file: ViewMutationFile }> {
  const { sourceViewMutationsRoot } = getWorkspacePaths(workspaceRoot);
  let mutationRoot;
  try {
    mutationRoot = inspectNoFollowDirectoryChainV1(
      path.resolve(sourceViewMutationsRoot),
      'Workbench mutation source root'
    ).target;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return [];
    throw error;
  }

  const entries = scanNoFollowDirectoryTreeV1(mutationRoot);
  const linkedEntry = entries.find((entry) => entry.kind === 'link');
  if (linkedEntry) {
    throw new CompilerError(
      'WORKBENCH-MUTATION-011',
      `Workbench mutation source tree contains a link entry "${linkedEntry.relativePath}"`
    );
  }

  return entries
    .filter((entry) => entry.kind === 'file' && entry.relativePath.endsWith('.json'))
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath))
    .map((entry) => {
      if (entry.bytes === null) {
        throw new CompilerError(
          'WORKBENCH-MUTATION-011',
          `Workbench mutation source "${entry.relativePath}" is not an ordinary readable file`
        );
      }
      const absolutePath = path.join(sourceViewMutationsRoot, entry.relativePath);
      const sourcePath = workspaceRelativePath(workspaceRoot, absolutePath);
      const raw = decodeMutationUtf8(entry.bytes, sourcePath);
      return { sourcePath, file: parseViewMutationFile(JSON.parse(raw) as unknown, sourcePath) };
    });
}

export async function applyViewMutations(
  workspaceRoot: string,
  commitFence: ViewMutationCommitFence
): Promise<ViewMutationReport> {
  const { viewMutationReportPath } = getWorkspacePaths(workspaceRoot);
  const mutationFiles = loadMutationFiles(workspaceRoot);
  const mutationEntries = mutationFiles.flatMap((entry) =>
    entry.file.mutations.map((mutation) => ({ mutation, sourcePath: entry.sourcePath }))
  );
  const operationResults = await applyEngineeringOperations(
    workspaceRoot,
    mutationEntries.map((entry) => entry.mutation),
    commitFence
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
    commitFence
  });
  return report;
}
