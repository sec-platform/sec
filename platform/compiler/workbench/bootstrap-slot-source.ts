import path from 'node:path';

import { isCanonicalBlockId } from '../../shared/block-identity.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { CommitFence } from '../../shared/fs.ts';
import type { SlotTask } from '../../shared/lock-types.ts';
import { readLockFile } from '../../shared/lock-utils.ts';
import { isCanonicalPortableLogicalPathV1 } from '../../shared/logical-path-identity.ts';
import {
  posixPath,
  sourceSlotsRelativePath
} from '../../shared/paths.ts';
import { readOptionalRetainedOrdinaryFileV1 } from '../../shared/retained-file-read.ts';
import { isCanonicalSlotId } from '../../shared/slot-identity.ts';
import { publishExclusiveCanonicalWorkspaceFileV1 } from '../../shared/workspace-file-publication.ts';

const TYPESCRIPT_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const CANONICAL_SOURCE_SLOTS_RELATIVE_PATH = posixPath(sourceSlotsRelativePath);

export interface BootstrapSlotSourceResult {
  readonly status: 'created' | 'existing';
  readonly path: string;
}

export interface ResolvedAuthorizedSlotSource {
  readonly task: SlotTask;
  readonly relativePath: string;
  readonly targetPath: string;
}

export interface ReadAuthorizedSlotSourceResult {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function assertSlotId(slotId: string): void {
  if (!isCanonicalSlotId(slotId)) {
    throw new CompilerError(
      'WORKBENCH-SLOT-001',
      'Workbench slotId must be one canonical lowercase Slot identity.'
    );
  }
}

function assertBlockId(blockId: string): void {
  if (!isCanonicalBlockId(blockId)) {
    throw new CompilerError('WORKBENCH-SLOT-001', 'Workbench block id must be one canonical Block identity');
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
  const candidate = task.sourcePath
    ?? `${CANONICAL_SOURCE_SLOTS_RELATIVE_PATH}/${task.id}.ts`;
  if (
    !isCanonicalPortableLogicalPathV1(candidate)
    || (
      !candidate.startsWith(`${CANONICAL_SOURCE_SLOTS_RELATIVE_PATH}/`)
      && !candidate.startsWith('source/slots/')
    )
  ) {
    throw new CompilerError(
      'WORKBENCH-SLOT-003',
      `Current Lock slot "${task.block}:${task.id}" has a non-canonical developer source path`
    );
  }
  return candidate;
}

function workbenchPhysicalError(message: string, error: unknown): CompilerError {
  return new CompilerError(
    'WORKBENCH-SLOT-004',
    `${message}${error instanceof Error ? `: ${error.message}` : ''}`
  );
}

/** Retained Lock/source resolution is synchronous; only publication is async. */
export function resolveAuthorizedSlotSource(
  workspaceRoot: string,
  slotId: string,
  blockId?: string
): ResolvedAuthorizedSlotSource {
  assertSlotId(slotId);
  if (blockId !== undefined) assertBlockId(blockId);

  const lock = readLockFile(workspaceRoot);
  const task = selectSlotTask(lock.slotTasks, slotId, blockId);
  const relativePath = slotSourceRelativePath(task);
  const targetPath = path.resolve(workspaceRoot, ...relativePath.split('/'));
  return Object.freeze({ task, relativePath, targetPath });
}

export function readAuthorizedSlotSource(
  workspaceRoot: string,
  slotId: string,
  blockId?: string
): ReadAuthorizedSlotSourceResult | null {
  const resolved = resolveAuthorizedSlotSource(workspaceRoot, slotId, blockId);
  try {
    const bytes = readOptionalRetainedOrdinaryFileV1(
      resolved.targetPath,
      `Workbench slot source ${resolved.relativePath}`
    );
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
  const resolved = resolveAuthorizedSlotSource(workspaceRoot, slotId, blockId);
  try {
    const existing = readOptionalRetainedOrdinaryFileV1(
      resolved.targetPath,
      `Workbench slot source ${resolved.relativePath}`
    );
    if (existing !== null) {
      return Object.freeze({ status: 'existing', path: resolved.relativePath });
    }

    const source = resolved.task.mockTemplate ?? genericSlotSource(resolved.task);
    const published = await publishExclusiveCanonicalWorkspaceFileV1({
      workspaceRoot,
      targetPath: resolved.targetPath,
      bytes: Buffer.from(source, 'utf8'),
      label: `Workbench Slot bootstrap ${resolved.task.block}:${resolved.task.id}`,
      commitFence
    });
    return Object.freeze({
      status: published.created ? 'created' : 'existing',
      path: resolved.relativePath
    });
  } catch (error) {
    throw workbenchPhysicalError('Workbench slot source publication failed closed', error);
  }
}
