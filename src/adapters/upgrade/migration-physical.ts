import path from 'node:path';

import type { CommitFence } from '../../contracts/commit-fence.ts';
import {
  createNoFollowOrdinaryDirectoryChain,
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  relocateRetainedNoFollowDirectoryAcrossParents,
  retainNoFollowFileTransaction,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeMetadata,
  type RetainedNoFollowFileObservation
} from '../runtime-state/physical/runtime/physical-no-follow.ts';

import { acknowledgeUpgradeFileMutation, markUpgradeRecoveryUnknown, prepareUpgradeFileMutation, type UpgradeRecoveryIntent } from './recovery-intent.ts';

const ORDINARY_FILE_CREATE_MODE = 0o666;
const ORDINARY_DIRECTORY_CREATE_MODE = 0o777;
const MIGRATION_TREE_MAXIMUM_ENTRIES = 100_000;
const MIGRATION_TREE_DEADLINE_MS = 30_000;

export interface NoFollowMigrationFileProjection {
  readonly bytes: Uint8Array;
  readonly permissionMode: number | null;
}

function rootRelativePath(root: string, targetPath: string, label: string, allowRoot = false): string {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative === '') {
    if (allowRoot) return '';
    throw new Error(`${label} must name a descendant rather than the migration root`);
  }
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} escapes the migration root`);
  }
  const normalized = relative.split(path.sep).join('/');
  if (normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} is not a canonical root-relative path`);
  }
  return normalized;
}

async function ensureTargetParent(
  root: string,
  targetPath: string,
  commitFence: CommitFence,
  label: string,
  recoveryIntent?: UpgradeRecoveryIntent
): Promise<void> {
  const relative = rootRelativePath(root, targetPath, label);
  const segments = relative.split('/');
  segments.pop();
  if (segments.length === 0) {
    inspectNoFollowDirectoryChain(path.resolve(root), `${label} root`);
    return;
  }
  const rootIdentity = inspectNoFollowDirectoryChain(path.resolve(root), `${label} root`).target;
  let exists = true;
  try { inspectNoFollowDirectoryChain(path.dirname(path.resolve(targetPath)), `${label} existing parent`); }
  catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') exists = false;
    else throw error;
  }
  await commitFence();
  if (!exists) markUpgradeRecoveryUnknown(recoveryIntent, 'untracked-ancestor-creation');
  createNoFollowOrdinaryDirectoryChain(
    rootIdentity,
    segments,
    undefined,
    ORDINARY_DIRECTORY_CREATE_MODE
  );
}

function projection(observed: RetainedNoFollowFileObservation): NoFollowMigrationFileProjection {
  return Object.freeze({
    bytes: Buffer.from(observed.bytes),
    permissionMode: observed.permissionMode
  });
}

export function readNoFollowMigrationFile(
  root: string,
  targetPath: string,
  label: string
): NoFollowMigrationFileProjection | null {
  const relative = rootRelativePath(root, targetPath, label);
  inspectNoFollowDirectoryChain(path.resolve(root), `${label} root`);
  let transaction: ReturnType<typeof retainNoFollowFileTransaction>;
  try {
    transaction = retainNoFollowFileTransaction(root, label);
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw error;
  }
  try {
    try {
      const observed = transaction.observe(relative, label);
      return observed === null ? null : projection(observed);
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
        return null;
      }
      throw error;
    }
  } finally {
    transaction.dispose();
  }
}

export async function updateNoFollowMigrationFile(input: Readonly<{
  root: string;
  targetPath: string;
  label: string;
  commitFence: CommitFence;
  recoveryIntent?: UpgradeRecoveryIntent;
  createParents: boolean;
  creationMode?: number;
  update: (current: NoFollowMigrationFileProjection | null) => Uint8Array;
}>): Promise<void> {
  if (input.createParents) {
    await ensureTargetParent(input.root, input.targetPath, input.commitFence, input.label, input.recoveryIntent);
  } else {
    inspectNoFollowDirectoryChain(path.dirname(path.resolve(input.targetPath)), `${input.label} parent`);
  }
  const relative = rootRelativePath(input.root, input.targetPath, input.label);
  const transaction = retainNoFollowFileTransaction(input.root, input.label);
  try {
    let current = transaction.observe(relative, input.label);
    const next = Buffer.from(input.update(current === null ? null : projection(current)));
    const mutation = prepareUpgradeFileMutation(input.recoveryIntent, [{ path: input.targetPath, before: current, after: next }]);
    await input.commitFence();
    current = current === null
      ? await transaction.createExclusive(
          relative,
          next,
          input.label,
          input.creationMode ?? ORDINARY_FILE_CREATE_MODE
        )
      : await transaction.rewriteExact(relative, current, next, input.label);
    if (!Buffer.from(current.bytes).equals(next)) {
      throw new Error(`${input.label} retained write readback differs`);
    }
    acknowledgeUpgradeFileMutation(input.recoveryIntent, mutation, [current]);
  } finally {
    transaction.dispose();
  }
}

export async function removeNoFollowMigrationFile(input: Readonly<{
  root: string;
  targetPath: string;
  label: string;
  commitFence: CommitFence;
  recoveryIntent?: UpgradeRecoveryIntent;
}>): Promise<void> {
  const relative = rootRelativePath(input.root, input.targetPath, input.label);
  const transaction = retainNoFollowFileTransaction(input.root, input.label);
  try {
    const current = transaction.observe(relative, input.label);
    if (current === null) throw new Error(`${input.label} target disappeared before retained removal`);
    const mutation = prepareUpgradeFileMutation(input.recoveryIntent, [{ path: input.targetPath, before: current, after: null }]);
    await input.commitFence();
    await transaction.removeExact(relative, current, input.label);
    acknowledgeUpgradeFileMutation(input.recoveryIntent, mutation, [null]);
  } finally {
    transaction.dispose();
  }
}

export async function renameNoFollowMigrationFile(input: Readonly<{
  root: string;
  sourcePath: string;
  targetPath: string;
  label: string;
  commitFence: CommitFence;
  recoveryIntent?: UpgradeRecoveryIntent;
}>): Promise<void> {
  await ensureTargetParent(input.root, input.targetPath, input.commitFence, input.label, input.recoveryIntent);
  const sourceRelative = rootRelativePath(input.root, input.sourcePath, `${input.label} source`);
  const targetRelative = rootRelativePath(input.root, input.targetPath, `${input.label} target`);
  const transaction = retainNoFollowFileTransaction(input.root, input.label);
  try {
    const source = transaction.observe(sourceRelative, input.label);
    if (source === null) throw new Error(`${input.label} source disappeared before retained rename`);
    const destination = transaction.observe(targetRelative, input.label);
    const mutation = prepareUpgradeFileMutation(input.recoveryIntent, [
      { path: input.sourcePath, before: source, after: null },
      { path: input.targetPath, before: destination, after: source.bytes, afterPermissionMode: source.permissionMode }
    ]);
    await input.commitFence();
    const renamed = await transaction.renameNoReplace(sourceRelative, targetRelative, source, input.label);
    acknowledgeUpgradeFileMutation(input.recoveryIntent, mutation, [null, renamed]);
  } finally {
    transaction.dispose();
  }
}

export async function createNoFollowMigrationDirectory(input: Readonly<{
  root: string;
  targetPath: string;
  label: string;
  commitFence: CommitFence;
  recoveryIntent?: UpgradeRecoveryIntent;
}>): Promise<void> {
  const relative = rootRelativePath(input.root, input.targetPath, input.label, true);
  const rootIdentity = inspectNoFollowDirectoryChain(path.resolve(input.root), `${input.label} root`).target;
  if (relative === '') return;
  await input.commitFence();
  markUpgradeRecoveryUnknown(input.recoveryIntent, 'untracked-directory-creation');
  createNoFollowOrdinaryDirectoryChain(
    rootIdentity,
    relative.split('/'),
    undefined,
    ORDINARY_DIRECTORY_CREATE_MODE
  );
}

export async function deleteNoFollowMigrationDirectory(input: Readonly<{
  root: string;
  targetPath: string;
  label: string;
  commitFence: CommitFence;
  recoveryIntent?: UpgradeRecoveryIntent;
}>): Promise<void> {
  rootRelativePath(input.root, input.targetPath, input.label);
  const target = inspectNoFollowDirectoryChain(path.resolve(input.targetPath), input.label).target;
  const parent = inspectNoFollowDirectoryChain(path.dirname(target.path), `${input.label} parent`).target;
  const inventory = scanNoFollowDirectoryTreeMetadata(target, {
    deadlineAtMs: performance.now() + MIGRATION_TREE_DEADLINE_MS,
    maximumEntries: MIGRATION_TREE_MAXIMUM_ENTRIES
  });
  await input.commitFence();
  markUpgradeRecoveryUnknown(input.recoveryIntent, 'untracked-directory-retirement');
  retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs: performance.now() + MIGRATION_TREE_DEADLINE_MS,
    inventory,
    parent,
    root: target
  });
}

export async function renameNoFollowMigrationDirectory(input: Readonly<{
  root: string;
  sourcePath: string;
  targetPath: string;
  label: string;
  commitFence: CommitFence;
  recoveryIntent?: UpgradeRecoveryIntent;
}>): Promise<void> {
  rootRelativePath(input.root, input.sourcePath, `${input.label} source`);
  rootRelativePath(input.root, input.targetPath, `${input.label} target`);
  await ensureTargetParent(input.root, input.targetPath, input.commitFence, input.label, input.recoveryIntent);
  const source = inspectNoFollowDirectoryChain(path.resolve(input.sourcePath), `${input.label} source`).target;
  const destinationParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(input.targetPath)),
    `${input.label} destination parent`
  ).target;
  await input.commitFence();
  markUpgradeRecoveryUnknown(input.recoveryIntent, 'untracked-directory-relocation');
  relocateRetainedNoFollowDirectoryAcrossParents({
    directory: source,
    destinationParent,
    tombstoneName: path.basename(input.targetPath)
  });
}
