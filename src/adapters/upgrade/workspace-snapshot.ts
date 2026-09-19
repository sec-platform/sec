import os from 'node:os';
import path from 'node:path';

import { CompilerError } from '../../compiler/errors.ts';
import { upgradeFailureWithSecondaryFailures } from '../../compiler/upgrade/failure.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { secRelativePath } from '../workspace-context.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  copyNoFollowDirectoryTreesBulk,
  createExclusiveNoFollowRandomDirectory,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { settlePhysicalResourcesAsync } from '../runtime-state/physical/runtime/resource-settlement.ts';

const PRESERVED_WORKSPACE_SNAPSHOT_ENTRIES = new Set([
  '.git',
  secRelativePath,
  'node_modules',
  'test-results',
  'coverage'
]);

const UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES = 100_000;
const UPGRADE_SNAPSHOT_MAXIMUM_BYTES = 1024 * 1024 * 1024;
const UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES = 64 * 1024 * 1024;
const UPGRADE_SNAPSHOT_OPERATION_DURATION_MS = 300_000;
const UPGRADE_LOCK_BACKUP_NAME = '.sec-lock.snapshot';

type UpgradeSnapshotProjectionEntry = Readonly<{
  relativePath: string;
  kind: 'directory' | 'file';
  size: number;
  contentDigest: `sha256:${string}` | null;
  permissionMode: number | null;
}>;

export type UpgradeWorkspaceSnapshot = Readonly<{
  workspace: PhysicalDirectoryIdentity;
  temporaryParent: PhysicalDirectoryIdentity;
  backup: PhysicalDirectoryIdentity;
  backupInventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  projection: readonly UpgradeSnapshotProjectionEntry[];
  lockWasPresent: boolean;
}>;

function upgradeSnapshotDeadline(): number {
  return performance.now() + UPGRADE_SNAPSHOT_OPERATION_DURATION_MS;
}

function checkedSnapshotMultiplier(value: number, multiplier: number, label: string): number {
  const result = value * multiplier;
  if (!Number.isSafeInteger(result)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', `${label} exceeds the upgrade snapshot accounting range`);
  }
  return result;
}

function samePhysicalInventory(
  left: readonly NoFollowDirectoryTreeInventoryEntry[],
  right: readonly NoFollowDirectoryTreeInventoryEntry[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSnapshotProjection(
  left: readonly UpgradeSnapshotProjectionEntry[],
  right: readonly UpgradeSnapshotProjectionEntry[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalSnapshotProjection(
  entries: readonly UpgradeSnapshotProjectionEntry[]
): readonly UpgradeSnapshotProjectionEntry[] {
  return Object.freeze([...entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath)));
}

function inspectUpgradeLockParent(
  workspace: PhysicalDirectoryIdentity,
  lockPath: string
): PhysicalDirectoryIdentity {
  const parentPath = path.dirname(path.resolve(lockPath));
  const relative = path.relative(workspace.path, parentPath);
  if (relative.length === 0 || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade graph lock parent is outside the retained workspace');
  }
  const chain = inspectNoFollowDirectoryChain(parentPath, 'Upgrade graph lock parent');
  if (!chain.ancestors.some((ancestor) => ancestor.device === workspace.device && ancestor.inode === workspace.inode)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade graph lock parent escaped the retained workspace');
  }
  assertSameNoFollowDirectoryIdentity(workspace, 'Upgrade graph lock workspace');
  return chain.target;
}

function addProjectedInventory(
  projection: UpgradeSnapshotProjectionEntry[],
  prefix: string,
  entries: readonly NoFollowDirectoryTreeInventoryEntry[]
): void {
  for (const entry of entries) {
    if (entry.kind === 'link') {
      throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot rejects linked entry ${prefix}/${entry.relativePath}`);
    }
    projection.push(Object.freeze({
      relativePath: `${prefix}/${entry.relativePath}`,
      kind: entry.kind,
      size: entry.size,
      contentDigest: entry.contentDigest,
      permissionMode: entry.permissionMode ?? null
    }));
  }
}

function publishSnapshotFile(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  bytes: Uint8Array;
  permissionSource: RetainedNoFollowOrdinaryFile;
}>): void {
  const expected = Buffer.from(input.bytes);
  publishExclusiveDurableCanonicalFile({
    parent: input.parent,
    name: input.name,
    bytes: expected,
    permissionSource: input.permissionSource,
    validate: (actual) => {
      if (!Buffer.from(actual).equals(expected)) {
        throw new Error('Upgrade snapshot file bytes differ from the retained source.');
      }
    }
  });
}

function observeUpgradeWorkspaceProjection(input: Readonly<{
  workspace: PhysicalDirectoryIdentity;
  lockPath: string;
  deadlineAtMs: number;
}>): Readonly<{ projection: readonly UpgradeSnapshotProjectionEntry[]; lockWasPresent: boolean }> {
  const workspace = assertSameNoFollowDirectoryIdentity(input.workspace, 'Upgrade snapshot workspace').target;
  const direct = scanNoFollowDirectoryDirectMetadata(workspace, {
    deadlineAtMs: input.deadlineAtMs,
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
    includePermissionMode: true
  });
  const projection: UpgradeSnapshotProjectionEntry[] = [];
  let entryCount = 0;
  let byteCount = 0;
  for (const entry of direct) {
    if (PRESERVED_WORKSPACE_SNAPSHOT_ENTRIES.has(entry.relativePath)) continue;
    if (entry.kind === 'link') {
      throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot rejects linked workspace entry ${entry.relativePath}`);
    }
    entryCount += 1;
    if (entry.kind === 'directory') {
      const child = inspectNoFollowDirectoryLeaf(workspace, entry.relativePath, 'Upgrade snapshot directory');
      if (child === null || child.device !== entry.device || child.inode !== entry.inode) {
        throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot directory ${entry.relativePath} changed before observation`);
      }
      const inventory = scanNoFollowDirectoryTreeInventory(child, {
        deadlineAtMs: input.deadlineAtMs,
        maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES - entryCount,
        maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES - byteCount,
        includePermissionMode: true
      });
      entryCount += inventory.length;
      byteCount += inventory.reduce((total, childEntry) => total + (childEntry.kind === 'file' ? childEntry.size : 0), 0);
      projection.push(Object.freeze({
        relativePath: entry.relativePath,
        kind: 'directory',
        size: entry.size,
        contentDigest: null,
        permissionMode: entry.permissionMode ?? null
      }));
      addProjectedInventory(projection, entry.relativePath, inventory);
      continue;
    }
    if (entry.size > UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES || entry.size > UPGRADE_SNAPSHOT_MAXIMUM_BYTES - byteCount) {
      throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot root file ${entry.relativePath} exceeds its byte ceiling`);
    }
    const retained = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(workspace.path, 'Upgrade snapshot workspace file parent'),
      entry.relativePath,
      { device: entry.device, inode: entry.inode },
      'Upgrade snapshot workspace file'
    );
    try {
      const digest = retained.digest();
      retained.assertCurrent();
      projection.push(Object.freeze({
        relativePath: entry.relativePath,
        kind: 'file',
        size: digest.size,
        contentDigest: digest.contentDigest,
        permissionMode: entry.permissionMode ?? null
      }));
      byteCount += digest.size;
    } finally {
      retained.dispose();
    }
  }
  if (entryCount > UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES || byteCount > UPGRADE_SNAPSHOT_MAXIMUM_BYTES) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade snapshot exceeds its selected workspace ceiling');
  }

  const lockParent = inspectUpgradeLockParent(workspace, input.lockPath);
  const lockName = path.basename(input.lockPath);
  const lockEntry = scanNoFollowDirectoryDirectMetadata(lockParent, {
    deadlineAtMs: input.deadlineAtMs,
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES,
    includePermissionMode: true
  }).find(({ relativePath }) => relativePath === lockName);
  if (lockEntry === undefined) return Object.freeze({ projection: canonicalSnapshotProjection(projection), lockWasPresent: false });
  if (lockEntry.kind !== 'file' || lockEntry.size > UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade snapshot lock is not a bounded ordinary file');
  }
  const retainedLock = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(lockParent.path, 'Upgrade snapshot lock parent'),
    lockName,
    { device: lockEntry.device, inode: lockEntry.inode },
    'Upgrade snapshot lock'
  );
  try {
    const digest = retainedLock.digest();
    retainedLock.assertCurrent();
    const selectedBytes = projection.reduce(
      (total, entry) => total + (entry.kind === 'file' ? entry.size : 0),
      0
    );
    if (projection.length >= UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES
        || digest.size > UPGRADE_SNAPSHOT_MAXIMUM_BYTES - selectedBytes) {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade snapshot lock exceeds the selected workspace ceiling');
    }
    projection.push(Object.freeze({
      relativePath: `${secRelativePath}/${lockName}`,
      kind: 'file',
      size: digest.size,
      contentDigest: digest.contentDigest,
      permissionMode: lockEntry.permissionMode ?? null
    }));
  } finally {
    retainedLock.dispose();
  }
  return Object.freeze({ projection: canonicalSnapshotProjection(projection), lockWasPresent: true });
}

export async function retireUpgradeBackup(snapshot: UpgradeWorkspaceSnapshot): Promise<void> {
  const backup = assertSameNoFollowDirectoryIdentity(snapshot.backup, 'Upgrade backup retirement root').target;
  const current = scanNoFollowDirectoryTreeInventory(backup, {
    deadlineAtMs: upgradeSnapshotDeadline(),
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
    includePermissionMode: true
  });
  if (!samePhysicalInventory(snapshot.backupInventory, current)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade backup changed before retirement');
  }
  retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs: upgradeSnapshotDeadline(),
    inventory: current,
    parent: snapshot.temporaryParent,
    root: backup,
    restoreOwnerPermissions: true
  });
}

async function copyRetainedDirectoryForUpgrade(input: Readonly<{
  source: PhysicalDirectoryIdentity;
  target: string;
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  deadlineAtMs: number;
  commitFence: CommitFence;
}>): Promise<void> {
  const entries = Math.max(1, checkedSnapshotMultiplier(input.inventory.length, 3, 'Upgrade directory entry budget'));
  const bytes = input.inventory.reduce(
    (total, entry) => total + (entry.kind === 'file' ? entry.size : 0),
    0
  );
  await copyNoFollowDirectoryTreesBulk(
    [{ source: input.source, target: input.target }],
    {
      assertCurrent: input.commitFence,
      deadlineAtMs: input.deadlineAtMs,
      maximumEntries: entries,
      maximumBytes: checkedSnapshotMultiplier(bytes, 4, 'Upgrade directory byte budget'),
      preservePermissionMode: true
    }
  );
}

function copyRetainedFileForUpgrade(input: Readonly<{
  sourceParent: PhysicalDirectoryIdentity;
  sourceName: string;
  expected: Readonly<{ device: string; inode: string; size: number; permissionMode?: number | null }>;
  targetParent: PhysicalDirectoryIdentity;
  targetName: string;
}>): void {
  if (input.expected.size > UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES) {
    throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot file ${input.sourceName} exceeds its byte ceiling`);
  }
  const retained = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(input.sourceParent.path, 'Upgrade snapshot retained file parent'),
    input.sourceName,
    { device: input.expected.device, inode: input.expected.inode },
    'Upgrade snapshot retained file'
  );
  try {
    if (retained.size !== input.expected.size) {
      throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot file ${input.sourceName} changed size`);
    }
    const bytes = retained.readBytes();
    retained.assertCurrent();
    publishSnapshotFile({
      parent: input.targetParent,
      name: input.targetName,
      bytes,
      permissionSource: retained
    });
    retained.assertCurrent();
  } finally {
    retained.dispose();
  }
}

export async function snapshotWorkspace(
  workspaceRoot: string,
  lockPath: string,
  commitFence: CommitFence
): Promise<UpgradeWorkspaceSnapshot> {
  const deadlineAtMs = upgradeSnapshotDeadline();
  await commitFence();
  const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'Upgrade snapshot workspace root').target;
  const before = observeUpgradeWorkspaceProjection({ workspace, lockPath, deadlineAtMs });
  const temporaryParent = inspectNoFollowDirectoryChain(os.tmpdir(), 'Upgrade snapshot temporary parent').target;
  const backup = createExclusiveNoFollowRandomDirectory(
    temporaryParent,
    'engineering-compiler-upgrade-'
  );
  try {
    const direct = scanNoFollowDirectoryDirectMetadata(workspace, {
      deadlineAtMs,
      maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
      maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
      includePermissionMode: true
    });
    for (const entry of direct) {
      if (PRESERVED_WORKSPACE_SNAPSHOT_ENTRIES.has(entry.relativePath)) continue;
      if (entry.kind === 'link') {
        throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot rejects linked workspace entry ${entry.relativePath}`);
      }
      if (entry.kind === 'directory') {
        const source = inspectNoFollowDirectoryLeaf(workspace, entry.relativePath, 'Upgrade snapshot copy source');
        if (source === null || source.device !== entry.device || source.inode !== entry.inode) {
          throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade snapshot directory ${entry.relativePath} changed before copy`);
        }
        const inventory = scanNoFollowDirectoryTreeInventory(source, {
          deadlineAtMs,
          maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
          maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
          includePermissionMode: true
        });
        await copyRetainedDirectoryForUpgrade({
          source,
          target: path.join(backup.path, entry.relativePath),
          inventory,
          deadlineAtMs,
          commitFence
        });
      } else {
        copyRetainedFileForUpgrade({
          sourceParent: workspace,
          sourceName: entry.relativePath,
          expected: entry,
          targetParent: backup,
          targetName: entry.relativePath
        });
      }
    }
    const lockParent = inspectUpgradeLockParent(workspace, lockPath);
    const lockName = path.basename(lockPath);
    const lockEntry = scanNoFollowDirectoryDirectMetadata(lockParent, {
      deadlineAtMs,
      maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
      maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES,
      includePermissionMode: true
    }).find(({ relativePath }) => relativePath === lockName);
    if (lockEntry !== undefined) {
      if (lockEntry.kind !== 'file') throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade snapshot lock is not an ordinary file');
      copyRetainedFileForUpgrade({
        sourceParent: lockParent,
        sourceName: lockName,
        expected: lockEntry,
        targetParent: backup,
        targetName: UPGRADE_LOCK_BACKUP_NAME
      });
    }
    const backupInventory = scanNoFollowDirectoryTreeInventory(backup, {
      deadlineAtMs,
      maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
      maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
      includePermissionMode: true
    });
    const after = observeUpgradeWorkspaceProjection({ workspace, lockPath, deadlineAtMs });
    if (before.lockWasPresent !== after.lockWasPresent || !sameSnapshotProjection(before.projection, after.projection)) {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade workspace changed while its snapshot was created');
    }
    await commitFence();
    return Object.freeze({
      workspace,
      temporaryParent,
      backup,
      backupInventory,
      projection: before.projection,
      lockWasPresent: before.lockWasPresent
    });
  } catch (error) {
    let inventory: readonly NoFollowDirectoryTreeInventoryEntry[] = [];
    try {
      inventory = scanNoFollowDirectoryTreeInventory(backup, {
        deadlineAtMs: upgradeSnapshotDeadline(),
        maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
        maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
        includePermissionMode: true
      });
    } catch (cleanupAdmissionFailure) {
      throw upgradeFailureWithSecondaryFailures(
        error instanceof Error ? error : new Error(String(error)),
        [cleanupAdmissionFailure],
        'Upgrade snapshot failed and its incomplete backup could not be inventoried'
      );
    }
    await settlePhysicalResourcesAsync({
      primary: { label: 'upgrade-workspace-snapshot', error },
      cleanup: [{
        label: `incomplete-upgrade-backup:${backup.path}`,
        settle: () => {
          retireNoFollowDirectoryTree({
            deadlineAtMonotonicMs: upgradeSnapshotDeadline(),
            inventory,
            parent: temporaryParent,
            root: backup,
            restoreOwnerPermissions: true
          });
        }
      }]
    });
    throw error;
  }
}

export async function restoreWorkspace(
  snapshot: UpgradeWorkspaceSnapshot,
  lockPath: string,
  commitFence: CommitFence
): Promise<void> {
  const deadlineAtMs = upgradeSnapshotDeadline();
  await commitFence();
  const workspace = assertSameNoFollowDirectoryIdentity(snapshot.workspace, 'Upgrade rollback workspace').target;
  const backup = assertSameNoFollowDirectoryIdentity(snapshot.backup, 'Upgrade rollback backup').target;
  const backupInventory = scanNoFollowDirectoryTreeInventory(backup, {
    deadlineAtMs,
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
    includePermissionMode: true
  });
  if (!samePhysicalInventory(snapshot.backupInventory, backupInventory)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade backup changed before rollback');
  }

  const currentDirect = scanNoFollowDirectoryDirectMetadata(workspace, {
    deadlineAtMs,
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
    includePermissionMode: true
  });
  for (const entry of currentDirect) {
    if (PRESERVED_WORKSPACE_SNAPSHOT_ENTRIES.has(entry.relativePath)) continue;
    await commitFence();
    if (entry.kind === 'link') throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade rollback rejects linked entry ${entry.relativePath}`);
    if (entry.kind === 'directory') {
      const child = inspectNoFollowDirectoryLeaf(workspace, entry.relativePath, 'Upgrade rollback removal root');
      if (child === null || child.device !== entry.device || child.inode !== entry.inode) {
        throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade rollback directory ${entry.relativePath} changed before removal`);
      }
      const inventory = scanNoFollowDirectoryTreeInventory(child, {
        deadlineAtMs,
        maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
        maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
        includePermissionMode: true
      });
      retireNoFollowDirectoryTree({
        deadlineAtMonotonicMs: deadlineAtMs,
        inventory,
        parent: workspace,
        root: child,
        restoreOwnerPermissions: true
      });
    } else {
      deleteRetainedNoFollowEntry({
        root: workspace,
        relativePath: entry.relativePath,
        kind: 'file',
        device: entry.device,
        inode: entry.inode,
        ancestorDirectories: []
      });
    }
  }

  const backupDirect = scanNoFollowDirectoryDirectMetadata(backup, {
    deadlineAtMs,
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
    includePermissionMode: true
  });
  for (const entry of backupDirect) {
    if (entry.relativePath === UPGRADE_LOCK_BACKUP_NAME) continue;
    if (entry.kind === 'link') throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade backup contains linked entry ${entry.relativePath}`);
    if (entry.kind === 'directory') {
      const source = inspectNoFollowDirectoryLeaf(backup, entry.relativePath, 'Upgrade rollback copy source');
      if (source === null || source.device !== entry.device || source.inode !== entry.inode) {
        throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade backup directory ${entry.relativePath} changed before restore`);
      }
      const inventory = scanNoFollowDirectoryTreeInventory(source, {
        deadlineAtMs,
        maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
        maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
        includePermissionMode: true
      });
      await copyRetainedDirectoryForUpgrade({
        source,
        target: path.join(workspace.path, entry.relativePath),
        inventory,
        deadlineAtMs,
        commitFence
      });
    } else {
      copyRetainedFileForUpgrade({
        sourceParent: backup,
        sourceName: entry.relativePath,
        expected: entry,
        targetParent: workspace,
        targetName: entry.relativePath
      });
    }
  }

  const lockParent = inspectUpgradeLockParent(workspace, lockPath);
  const lockName = path.basename(lockPath);
  const currentLock = scanNoFollowDirectoryDirectMetadata(lockParent, {
    deadlineAtMs,
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES,
    includePermissionMode: true
  }).find(({ relativePath }) => relativePath === lockName);
  if (currentLock !== undefined) {
    if (currentLock.kind !== 'file') throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade rollback lock is not an ordinary file');
    deleteRetainedNoFollowEntry({
      root: lockParent,
      relativePath: lockName,
      kind: 'file',
      device: currentLock.device,
      inode: currentLock.inode,
      ancestorDirectories: []
    });
  }
  if (snapshot.lockWasPresent) {
    const backupLock = backupDirect.find(({ relativePath }) => relativePath === UPGRADE_LOCK_BACKUP_NAME);
    if (backupLock === undefined || backupLock.kind !== 'file') {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade backup lock is absent or nonregular');
    }
    copyRetainedFileForUpgrade({
      sourceParent: backup,
      sourceName: UPGRADE_LOCK_BACKUP_NAME,
      expected: backupLock,
      targetParent: lockParent,
      targetName: lockName
    });
  }
  const restored = observeUpgradeWorkspaceProjection({ workspace, lockPath, deadlineAtMs });
  if (snapshot.lockWasPresent !== restored.lockWasPresent || !sameSnapshotProjection(snapshot.projection, restored.projection)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade rollback readback differs from its preimage');
  }
  await commitFence();
}
