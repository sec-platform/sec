import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, type CommitFence } from '../../shared/fs.ts';
import { readLockFile } from '../../shared/lock-utils.ts';
import type { SlotTask } from '../../shared/lock-types.ts';
import {
  getWorkspacePaths,
  isPathInside,
  posixPath,
  sourceSlotsRelativePath
} from '../../shared/paths.ts';

const SLOT_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const TYPESCRIPT_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

export interface BootstrapSlotSourceResult {
  readonly status: 'created' | 'existing';
  readonly path: string;
}

function assertSlotId(slotId: string): void {
  if (!SLOT_ID_PATTERN.test(slotId)) {
    throw new CompilerError(
      'WORKBENCH-SLOT-001',
      'Workbench slotId must be one filesystem-safe identifier.'
    );
  }
}

function selectSlotTask(lockTasks: readonly SlotTask[], blockId: string, slotId: string): SlotTask {
  const matches = lockTasks.filter((task) => task.id === slotId && task.block === blockId);
  if (matches.length !== 1) {
    throw new CompilerError(
      'WORKBENCH-SLOT-002',
      `Workbench bootstrap requires exactly one current Lock slot for "${blockId}:${slotId}"`
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

async function assertExistingAncestorsAreDirectories(root: string, targetDirectory: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetDirectory);
  if (!isPathInside(resolvedRoot, resolvedTarget)) {
    throw new CompilerError('WORKBENCH-SLOT-004', 'Workbench slot source escaped the workspace root');
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let cursor = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const metadata = await fs.lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (metadata === null) return;
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new CompilerError(
        'WORKBENCH-SLOT-004',
        `Workbench slot ancestor is not one ordinary directory: ${cursor}`
      );
    }
  }
}

async function assertPhysicalSlotBoundary(
  workspaceRoot: string,
  targetPath: string,
  commitFence?: CommitFence
): Promise<void> {
  const { sourceSlotsRoot, legacySourceSlotsRoot } = getWorkspacePaths(workspaceRoot);
  const lexicalRoot = isPathInside(sourceSlotsRoot, targetPath)
    ? sourceSlotsRoot
    : isPathInside(legacySourceSlotsRoot, targetPath)
      ? legacySourceSlotsRoot
      : null;
  if (!lexicalRoot) {
    throw new CompilerError('WORKBENCH-SLOT-003', 'Workbench slot source escaped the configured source-slot roots');
  }

  await assertExistingAncestorsAreDirectories(workspaceRoot, path.dirname(targetPath));
  await ensureDir(lexicalRoot, commitFence);
  await ensureDir(path.dirname(targetPath), commitFence);
  await assertExistingAncestorsAreDirectories(workspaceRoot, path.dirname(targetPath));

  const [physicalRoot, physicalParent] = await Promise.all([
    fs.realpath(lexicalRoot),
    fs.realpath(path.dirname(targetPath))
  ]);
  if (!isPathInside(physicalRoot, physicalParent)) {
    throw new CompilerError('WORKBENCH-SLOT-004', 'Workbench slot source traverses a symbolic-link/reparse boundary');
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

async function existingOrdinaryFile(targetPath: string): Promise<boolean> {
  const metadata = await fs.lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (metadata === null) return false;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new CompilerError(
      'WORKBENCH-SLOT-006',
      'Existing slot source is not one unaliased ordinary file'
    );
  }
  return true;
}

async function publishCreateOnly(
  targetPath: string,
  expectedBytes: Buffer,
  commitFence?: CommitFence
): Promise<'created' | 'existing'> {
  if (await existingOrdinaryFile(targetPath)) return 'existing';

  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.bootstrap-${randomUUID()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(expectedBytes);
    await handle.sync();
    await handle.close();
    handle = null;

    await commitFence?.();
    try {
      await fs.link(temporaryPath, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        if (await existingOrdinaryFile(targetPath)) return 'existing';
      }
      throw error;
    }

    const readback = await fs.readFile(targetPath);
    if (!readback.equals(expectedBytes)) {
      throw new CompilerError(
        'WORKBENCH-SLOT-007',
        'Published slot source could not be read back as the exact planned bytes'
      );
    }
    return 'created';
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function bootstrapAuthorizedSlotSource(
  workspaceRoot: string,
  blockId: string,
  slotId: string,
  commitFence?: CommitFence
): Promise<BootstrapSlotSourceResult> {
  assertSlotId(slotId);
  if (typeof blockId !== 'string' || blockId.trim().length === 0 || blockId.length > 256) {
    throw new CompilerError('WORKBENCH-SLOT-001', 'Workbench block id must be one non-empty bounded string');
  }

  const lock = await readLockFile(workspaceRoot);
  const task = selectSlotTask(lock.slotTasks, blockId, slotId);
  const relativePath = slotSourceRelativePath(task);
  const targetPath = path.resolve(workspaceRoot, ...relativePath.split('/'));
  await assertPhysicalSlotBoundary(workspaceRoot, targetPath, commitFence);

  const source = task.mockTemplate ?? genericSlotSource(task);
  const status = await publishCreateOnly(targetPath, Buffer.from(source, 'utf8'), commitFence);
  return Object.freeze({ status, path: relativePath });
}
