import path from 'node:path';

import { CompilerError } from '../../shared/errors.ts';
import type { CommitFence } from '../../shared/fs.ts';
import { readLockFile } from '../../shared/lock-utils.ts';
import type { SlotTask } from '../../shared/lock-types.ts';
import {
  createNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChainV1,
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1
} from '../../shared/physical-no-follow.ts';
import {
  getWorkspacePaths,
  isPathInside,
  posixPath,
  sourceSlotsRelativePath
} from '../../shared/paths.ts';

const SLOT_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const TYPESCRIPT_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const NO_FOLLOW_CREATABLE_DIRECTORY_SEGMENT = /^[a-z0-9-]+$/u;

export interface BootstrapSlotSourceResult {
  readonly status: 'created' | 'existing';
  readonly path: string;
}

export interface ResolvedAuthorizedSlotSource {
  readonly task: SlotTask;
  readonly relativePath: string;
  readonly targetPath: string;
  readonly lexicalRoot: string;
}

export interface ReadAuthorizedSlotSourceResult {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function assertSlotId(slotId: string): void {
  if (!SLOT_ID_PATTERN.test(slotId)) {
    throw new CompilerError(
      'WORKBENCH-SLOT-001',
      'Workbench slotId must be one filesystem-safe identifier.'
    );
  }
}

function assertBlockId(blockId: string): void {
  if (blockId.trim().length === 0 || blockId.length > 256 || blockId.includes('\0')) {
    throw new CompilerError('WORKBENCH-SLOT-001', 'Workbench block id must be one non-empty bounded string');
  }
}

function selectSlotTask(lockTasks: readonly SlotTask[], slotId: string, blockId?: string): SlotTask {
  const matches = lockTasks.filter((task) =>
    task.id === slotId && (blockId === undefined || task.block === blockId)
  );
  if (matches.length !== 1) {
    throw new CompilerError(
      'WORKBENCH-SLOT-002',
      blockId === undefined
        ? `Workbench slot "${slotId}" is unavailable or ambiguous in the current Lock`
        : `Workbench operation requires exactly one current Lock slot for "${blockId}:${slotId}"`
    );
  }
  return matches[0]!;
}

function slotSourceRelativePath(task: SlotTask): string {
  const candidate = posixPath(task.sourcePath ?? `${sourceSlotsRelativePath}/${task.id}.ts`);
  if (
    (!candidate.startsWith('source/code/slots/') && !candidate.startsWith('source/slots/')) ||
    path.posix.normalize(candidate) !== candidate ||
    path.posix.isAbsolute(candidate) ||
    candidate.includes('/../') ||
    candidate.startsWith('../')
  ) {
    throw new CompilerError(
      'WORKBENCH-SLOT-003',
      `Current Lock slot "${task.block}:${task.id}" has an invalid developer source path`
    );
  }
  return candidate;
}

function lexicalSlotRoot(workspaceRoot: string, targetPath: string): string {
  const { sourceSlotsRoot, legacySourceSlotsRoot } = getWorkspacePaths(workspaceRoot);
  if (isPathInside(sourceSlotsRoot, targetPath)) return sourceSlotsRoot;
  if (isPathInside(legacySourceSlotsRoot, targetPath)) return legacySourceSlotsRoot;
  throw new CompilerError(
    'WORKBENCH-SLOT-003',
    'Workbench slot source escaped the configured source-slot roots'
  );
}

function workbenchPhysicalError(message: string, error: unknown): CompilerError {
  return new CompilerError(
    'WORKBENCH-SLOT-004',
    `${message}${error instanceof Error ? `: ${error.message}` : ''}`
  );
}

export async function resolveAuthorizedSlotSource(
  workspaceRoot: string,
  slotId: string,
  blockId?: string
): Promise<ResolvedAuthorizedSlotSource> {
  assertSlotId(slotId);
  if (blockId !== undefined) assertBlockId(blockId);

  const lock = await readLockFile(workspaceRoot);
  const task = selectSlotTask(lock.slotTasks, slotId, blockId);
  const relativePath = slotSourceRelativePath(task);
  const targetPath = path.resolve(workspaceRoot, ...relativePath.split('/'));
  const lexicalRoot = lexicalSlotRoot(workspaceRoot, targetPath);

  return Object.freeze({ task, relativePath, targetPath, lexicalRoot });
}

function existingSlotParent(resolved: ResolvedAuthorizedSlotSource) {
  try {
    return inspectNoFollowDirectoryChainV1(
      path.dirname(resolved.targetPath),
      'Workbench slot source parent'
    ).target;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw workbenchPhysicalError('Workbench slot source parent cannot be proven no-follow', error);
  }
}

function createSlotParent(workspaceRoot: string, resolved: ResolvedAuthorizedSlotSource) {
  const workspacePath = path.resolve(workspaceRoot);
  const parentPath = path.dirname(resolved.targetPath);
  const relative = path.relative(workspacePath, parentPath);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new CompilerError('WORKBENCH-SLOT-004', 'Workbench slot source parent escaped the workspace root');
  }
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.some((segment) => !NO_FOLLOW_CREATABLE_DIRECTORY_SEGMENT.test(segment))) {
    throw new CompilerError(
      'WORKBENCH-SLOT-004',
      'Workbench cannot safely create a missing slot-source directory whose segment is outside the retained no-follow directory contract'
    );
  }

  try {
    const workspace = inspectNoFollowDirectoryChainV1(
      workspacePath,
      'Workbench workspace root'
    ).target;
    return createNoFollowDirectoryChainV1(workspace, segments);
  } catch (error) {
    throw workbenchPhysicalError('Workbench slot source parent creation failed closed', error);
  }
}

function slotParent(workspaceRoot: string, resolved: ResolvedAuthorizedSlotSource, create: boolean) {
  const existing = existingSlotParent(resolved);
  if (existing !== null) return existing;
  if (!create) return null;
  return createSlotParent(workspaceRoot, resolved);
}

export async function readAuthorizedSlotSource(
  workspaceRoot: string,
  slotId: string,
  blockId?: string
): Promise<ReadAuthorizedSlotSourceResult | null> {
  const resolved = await resolveAuthorizedSlotSource(workspaceRoot, slotId, blockId);
  const parent = slotParent(workspaceRoot, resolved, false);
  if (parent === null) return null;
  try {
    const bytes = readNoFollowOrdinaryFileV1(parent, path.basename(resolved.targetPath));
    return bytes === null
      ? null
      : Object.freeze({ path: resolved.relativePath, bytes });
  } catch (error) {
    throw workbenchPhysicalError('Workbench slot source cannot be read as one retained ordinary file', error);
  }
}

function genericSlotSource(task: SlotTask): string {
  if (!TYPESCRIPT_IDENTIFIER_PATTERN.test(task.symbol)) {
    throw new CompilerError(
      'WORKBENCH-SLOT-005',
      `Slot symbol "${task.symbol}" is not a safe TypeScript identifier for bootstrap generation`
    );
  }
  return [
    '/** Generated bootstrap for an already-authorized SEC slot. */',
    `export async function ${task.symbol}(input: unknown): Promise<unknown> {`,
    '  return { input };',
    '}',
    ''
  ].join('\n');
}

export async function bootstrapAuthorizedSlotSource(
  workspaceRoot: string,
  blockId: string,
  slotId: string,
  commitFence?: CommitFence
): Promise<BootstrapSlotSourceResult> {
  const resolved = await resolveAuthorizedSlotSource(workspaceRoot, slotId, blockId);
  await commitFence?.();
  const parent = slotParent(workspaceRoot, resolved, true);
  if (parent === null) {
    throw new CompilerError('WORKBENCH-SLOT-004', 'Workbench slot source parent is unavailable');
  }
  const leaf = path.basename(resolved.targetPath);

  try {
    const existing = readNoFollowOrdinaryFileV1(parent, leaf);
    if (existing !== null) {
      return Object.freeze({ status: 'existing', path: resolved.relativePath });
    }
  } catch (error) {
    throw workbenchPhysicalError('Existing Workbench slot source is not one retained ordinary file', error);
  }

  const source = resolved.task.mockTemplate ?? genericSlotSource(resolved.task);
  const expected = Buffer.from(source, 'utf8');
  await commitFence?.();
  try {
    const published = publishExclusiveDurableCanonicalFileV1({
      parent,
      name: leaf,
      bytes: expected,
      validate: (bytes) => {
        if (!Buffer.from(bytes).equals(expected)) {
          throw new Error('Workbench bootstrap bytes changed during retained publication');
        }
      }
    });
    return Object.freeze({
      status: published.created ? 'created' : 'existing',
      path: resolved.relativePath
    });
  } catch (error) {
    throw workbenchPhysicalError('Workbench slot source publication failed closed', error);
  }
}
