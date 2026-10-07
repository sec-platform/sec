import os from 'node:os';
import path from 'node:path';
import { deepFreeze, sha256 } from '../../contracts/canonical.ts';

import { CompilerError } from '../../compiler/errors.ts';
import { upgradeFailureWithSecondaryFailures } from '../../compiler/upgrade/failure.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync, settleResources, withAcquiredResource } from '../../execution/resource-settlement.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  copyNoFollowDirectoryTreesBulk,
  createExclusiveNoFollowDirectory,
  createExclusiveNoFollowRandomDirectory,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowFileTransaction,
  retainNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { secRelativePath } from '../workspace-context.ts';
import { acknowledgeUpgradeRestoredFile, admitUpgradeRecovery, assertUpgradeRecoveryFileCurrent, assertUpgradeRecoveryIntent, assertUpgradeRecoveryRecordInventory, createUpgradeRecoveryIntent, type UpgradeRecoveryBinding, type UpgradeRecoveryIntent } from './recovery-intent.ts';

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
  identity?: Readonly<{ device: string; inode: string }>;
}>;

export type UpgradeWorkspaceSnapshot = Readonly<{
  workspace: PhysicalDirectoryIdentity;
  temporaryParent: PhysicalDirectoryIdentity;
  backup: PhysicalDirectoryIdentity;
  preimage: PhysicalDirectoryIdentity;
  recoveryIntent: UpgradeRecoveryIntent;
  backupInventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  projection: readonly UpgradeSnapshotProjectionEntry[];
  lockWasPresent: boolean;
  lockRelativePath: string;
  lockParents: readonly PhysicalDirectoryIdentity[];
}>;

// A persisted locator is content/recovery evidence, never a reusable physical
// capability. Unknown/legacy reconstructed snapshots require fresh admission.
const issuedUpgradeSnapshots = new WeakSet<UpgradeWorkspaceSnapshot>();
function assertIssuedSnapshot(snapshot: UpgradeWorkspaceSnapshot): void {
  if (!issuedUpgradeSnapshots.has(snapshot)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade recovery required: unissued or legacy snapshot cannot authorize restore');
  }
}

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
      permissionMode: entry.permissionMode ?? null,
      identity: { device: entry.device, inode: entry.inode }
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
}>): Readonly<{ projection: readonly UpgradeSnapshotProjectionEntry[]; lockWasPresent: boolean; lockParents: readonly PhysicalDirectoryIdentity[] }> {
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
        permissionMode: entry.permissionMode ?? null,
      identity: { device: entry.device, inode: entry.inode }
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
        permissionMode: entry.permissionMode ?? null,
      identity: { device: entry.device, inode: entry.inode }
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
  const lockChain = inspectNoFollowDirectoryChain(lockParent.path, 'Upgrade snapshot lock ancestors');
  const lockParents = [...new Map([...lockChain.ancestors, lockChain.target].filter(directory => {
    const relative = path.relative(workspace.path, directory.path);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }).map(directory => [directory.path, directory])).values()];
  const lockName = path.basename(input.lockPath);
  const lockEntry = scanNoFollowDirectoryDirectMetadata(lockParent, {
    deadlineAtMs: input.deadlineAtMs,
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES,
    includePermissionMode: true
  }).find(({ relativePath }) => relativePath === lockName);
  if (lockEntry === undefined) return Object.freeze({ projection: canonicalSnapshotProjection(projection), lockWasPresent: false, lockParents });
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
      relativePath: path.relative(workspace.path, path.resolve(input.lockPath)).split(path.sep).join('/'),
      kind: 'file',
      size: digest.size,
      contentDigest: digest.contentDigest,
      permissionMode: lockEntry.permissionMode ?? null,
      identity: { device: lockEntry.device, inode: lockEntry.inode }
    }));
  } finally {
    retainedLock.dispose();
  }
  return Object.freeze({ projection: canonicalSnapshotProjection(projection), lockWasPresent: true, lockParents });
}

export async function retireUpgradeBackup(snapshot: UpgradeWorkspaceSnapshot): Promise<void> {
  assertIssuedSnapshot(snapshot);
  assertUpgradeRecoveryIntent(snapshot.recoveryIntent);
  const backup = assertSameNoFollowDirectoryIdentity(snapshot.backup, 'Upgrade backup retirement root').target;
  const preimage = assertSameNoFollowDirectoryIdentity(snapshot.preimage, 'Upgrade backup preimage').target;
  const sealed = scanNoFollowDirectoryTreeInventory(preimage, {
    deadlineAtMs: upgradeSnapshotDeadline(), maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES, includePermissionMode: true
  });
  if (!samePhysicalInventory(snapshot.backupInventory, sealed)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade backup preimage changed before retirement');
  }
  const inventory = scanNoFollowDirectoryTreeInventory(backup, {
    deadlineAtMs: upgradeSnapshotDeadline(), maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES, includePermissionMode: true
  });
  const observedPreimage = inventory.find(entry => entry.relativePath === 'preimage');
  const observedContents = inventory.filter(entry => entry.relativePath.startsWith('preimage/'))
    .map(entry => ({ ...entry, relativePath: entry.relativePath.slice('preimage/'.length) }));
  if (observedPreimage?.kind !== 'directory' || observedPreimage.device !== snapshot.preimage.device
      || observedPreimage.inode !== snapshot.preimage.inode
      || !samePhysicalInventory(snapshot.backupInventory, observedContents)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade retirement census differs from its owned preimage');
  }
  assertUpgradeRecoveryRecordInventory(snapshot.recoveryIntent,
    inventory.filter(entry => entry.relativePath !== 'preimage' && !entry.relativePath.startsWith('preimage/')));
  retireNoFollowDirectoryTree({ deadlineAtMonotonicMs: upgradeSnapshotDeadline(), inventory,
    parent: snapshot.temporaryParent, root: backup, restoreOwnerPermissions: true });
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
      preservePermissionMode: true,
      rejectHardLinks: true
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
    if (retained.linkCount !== 1) {
      throw new CompilerError(
        'UPGRADE-BLOCKED-005',
        `Upgrade snapshot file ${input.sourceName} has another hard-link name`
      );
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
  commitFence: CommitFence,
  binding: UpgradeRecoveryBinding
): Promise<UpgradeWorkspaceSnapshot> {
  const capturedBinding = Object.freeze({
    operationIdentityDigest: binding.operationIdentityDigest,
    attemptRevision: binding.attemptRevision
  });
  const deadlineAtMs = upgradeSnapshotDeadline();
  await commitFence();
  const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'Upgrade snapshot workspace root').target;
  const before = observeUpgradeWorkspaceProjection({ workspace, lockPath, deadlineAtMs });
  const temporaryParent = inspectNoFollowDirectoryChain(os.tmpdir(), 'Upgrade snapshot temporary parent').target;
  const envelope = createExclusiveNoFollowRandomDirectory(
    temporaryParent,
    'engineering-compiler-upgrade-'
  );
  try {
    const backup = createExclusiveNoFollowDirectory(envelope, 'preimage');
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
    if (before.lockWasPresent !== after.lockWasPresent || !sameSnapshotProjection(before.projection, after.projection)
        || JSON.stringify(before.lockParents) !== JSON.stringify(after.lockParents)) {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade workspace changed while its snapshot was created');
    }
    await commitFence();
    const snapshot: UpgradeWorkspaceSnapshot = deepFreeze({
      workspace,
      temporaryParent,
      backup: envelope,
      preimage: backup,
      recoveryIntent: createUpgradeRecoveryIntent({ workspace, backup: envelope, binding: capturedBinding, projection: before.projection,
        limits: {
          maximumRecords: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES - backupInventory.length - 1,
          maximumRecordBytes: UPGRADE_SNAPSHOT_MAXIMUM_ROOT_FILE_BYTES,
          maximumTotalBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES - backupInventory.reduce(
            (total, entry) => total + (entry.kind === 'file' ? entry.size : 0), 0)
        }
      }),
      backupInventory,
      projection: before.projection,
      lockWasPresent: before.lockWasPresent,
      lockRelativePath: path.relative(workspace.path, path.resolve(lockPath)).split(path.sep).join('/'),
      lockParents: before.lockParents
    });
    issuedUpgradeSnapshots.add(snapshot);
    return snapshot;
  } catch (error) {
    let inventory: readonly NoFollowDirectoryTreeInventoryEntry[] = [];
    try {
      inventory = scanNoFollowDirectoryTreeInventory(envelope, {
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
        label: `incomplete-upgrade-backup:${envelope.path}`,
        settle: () => {
          retireNoFollowDirectoryTree({
            deadlineAtMonotonicMs: upgradeSnapshotDeadline(),
            inventory,
            parent: temporaryParent,
            root: envelope,
            restoreOwnerPermissions: true
          });
        }
      }]
    });
    throw error;
  }
}

/** Compare every in-workspace ancestor with the original snapshot facts.
 * The excluded control tree still has the separately captured lock ancestry. */
function assertUpgradeRecoveryParent(snapshot: UpgradeWorkspaceSnapshot, relativePath: string): PhysicalDirectoryIdentity {
  const parentPath = path.dirname(path.join(snapshot.workspace.path, relativePath));
  const chain = inspectNoFollowDirectoryChain(parentPath, 'Upgrade recovery constituent parent');
  for (const current of [...chain.ancestors, chain.target]) {
    const relative = path.relative(snapshot.workspace.path, current.path).split(path.sep).join('/');
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) continue;
    const expected = relative === '' ? snapshot.workspace
      : snapshot.lockParents.find(directory => directory.path === current.path)
        ?? snapshot.projection.find(entry => entry.kind === 'directory' && entry.relativePath === relative)?.identity;
    if (expected === undefined || expected.device !== current.device || expected.inode !== current.inode) {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade recovery parent differs from its original identity');
    }
  }
  return chain.target;
}

function assertUpgradeRecoveryFreshFile(snapshot: UpgradeWorkspaceSnapshot, relativePath: string): void {
  const reader = retainNoFollowFileTransaction(snapshot.workspace.path, 'Upgrade recovery fresh post-fence observation');
  let primary: { label: string; error: unknown } | undefined;
  try {
    assertUpgradeRecoveryFileCurrent(snapshot.recoveryIntent, relativePath,
      reader.observe(relativePath, 'Upgrade recovery fresh constituent'));
  } catch (error) { primary = { label: 'upgrade recovery fresh observation', error }; throw error; }
  finally { settleResources({ ...(primary === undefined ? {} : { primary }),
    cleanup: [{ label: 'upgrade recovery fresh observation', settle: () => reader.dispose() }] }); }
}

/** Restore only exact recorded file constituents. Untracked effects, legacy
 * locators and foreign changes retain the backup instead of broad deletion. */
export async function restoreWorkspace(
  snapshot: UpgradeWorkspaceSnapshot,
  lockPath: string,
  commitFence: CommitFence
): Promise<void> {
  assertIssuedSnapshot(snapshot);
  const lockRelativePath = path.relative(snapshot.workspace.path, path.resolve(lockPath)).split(path.sep).join('/');
  if (lockRelativePath !== snapshot.lockRelativePath) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade recovery graph lock differs from its original binding');
  }
  await commitFence();
  assertUpgradeRecoveryIntent(snapshot.recoveryIntent);
  const workspace = assertSameNoFollowDirectoryIdentity(snapshot.workspace, 'Upgrade rollback workspace').target;
  const preimage = assertSameNoFollowDirectoryIdentity(snapshot.preimage, 'Upgrade rollback preimage').target;
  const inventory = scanNoFollowDirectoryTreeInventory(preimage, {
    deadlineAtMs: upgradeSnapshotDeadline(),
    maximumEntries: UPGRADE_SNAPSHOT_MAXIMUM_ENTRIES,
    maximumBytes: UPGRADE_SNAPSHOT_MAXIMUM_BYTES,
    includePermissionMode: true
  });
  if (!samePhysicalInventory(snapshot.backupInventory, inventory)) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade backup changed before rollback');
  }
  const current = observeUpgradeWorkspaceProjection({ workspace, lockPath, deadlineAtMs: upgradeSnapshotDeadline() });
  const paths = admitUpgradeRecovery(snapshot.recoveryIntent, current.projection);
  return withAcquiredResource({
    operationLabel: 'upgrade-rollback',
    resourceLabel: 'upgrade-live-files',
    acquire: () => retainNoFollowFileTransaction(workspace.path, 'Upgrade rollback live'),
    release: (live) => live.dispose(),
    use: (live) =>
      withAcquiredResource({
        operationLabel: 'upgrade-rollback',
        resourceLabel: 'upgrade-original-files',
        acquire: () => retainNoFollowFileTransaction(preimage.path, 'Upgrade rollback original'),
        release: (original) => original.dispose(),
        use: async (original) => {
          const actions = paths.map((relativePath) => {
            const parent = assertUpgradeRecoveryParent(snapshot, relativePath);
            const backupRelativePath = relativePath === snapshot.lockRelativePath ? UPGRADE_LOCK_BACKUP_NAME : relativePath;
            const before = original.observe(backupRelativePath, 'Upgrade original constituent');
            const after = live.observe(relativePath, 'Upgrade current constituent');
            assertUpgradeRecoveryFileCurrent(snapshot.recoveryIntent, relativePath, after);
            const sealed = snapshot.backupInventory.find((entry) => entry.relativePath === backupRelativePath);
            const originalEntry = snapshot.projection.find((entry) => entry.relativePath === relativePath);
            if (
              (before === null) !== (originalEntry === undefined) ||
              (before !== null &&
                (originalEntry?.kind !== 'file' ||
                  sealed?.kind !== 'file' ||
                  before.identity.device !== sealed.device ||
                  before.identity.inode !== sealed.inode ||
                  before.permissionMode !== originalEntry.permissionMode ||
                  before.bytes.byteLength !== originalEntry.size ||
                  sha256({ bytes: Buffer.from(before.bytes).toString('hex') }) !== originalEntry.contentDigest))
            ) {
              throw new CompilerError(
                'UPGRADE-BLOCKED-005',
                'Upgrade original constituent changed after backup admission'
              );
            }
            if (
              before !== null &&
              after === null &&
              before.permissionMode !== null &&
              (before.permissionMode & 0o7000) !== 0
            ) {
              throw new CompilerError(
                'UPGRADE-BLOCKED-005',
                'Upgrade recovery requires unsupported special-bit file creation'
              );
            }
            if (before !== null && after !== null && before.permissionMode !== after.permissionMode) {
              throw new CompilerError(
                'UPGRADE-BLOCKED-005',
                'Upgrade recovery requires an unsupported file permission transition'
              );
            }
            return { relativePath, before, after, parent };
          });
          for (const { relativePath, before, after, parent } of actions) {
            if (before === null && after === null) continue;
            if (before !== null && after !== null && Buffer.from(before.bytes).equals(Buffer.from(after.bytes)))
              continue;
            await commitFence();
            assertUpgradeRecoveryParent(snapshot, relativePath);
            assertUpgradeRecoveryFreshFile(snapshot, relativePath);
            assertUpgradeRecoveryFileCurrent(snapshot.recoveryIntent, relativePath, after);
            let restored = before;
            if (before === null) {
              await live.removeExact(relativePath, after!, 'Upgrade remove owned created constituent');
              restored = null;
            } else if (after !== null) {
              restored = await live.rewriteExact(
                relativePath,
                after,
                before.bytes,
                'Upgrade restore exact constituent'
              );
            } else {
              const target = path.join(workspace.path, relativePath);
              const receipt = publishExclusiveDurableCanonicalFile({
                parent,
                name: path.basename(target),
                bytes: before.bytes,
                ...(before.permissionMode === null ? {} : { permissionMode: before.permissionMode }),
                validate: (bytes) => {
                  if (!Buffer.from(bytes).equals(Buffer.from(before.bytes)))
                    throw new Error('Upgrade restored bytes differ');
                }
              });
              const observed = live.observe(relativePath, 'Upgrade restored deleted constituent');
              if (
                observed === null ||
                observed.identity.device !== receipt.physical.device ||
                observed.identity.inode !== receipt.physical.inode
              ) {
                throw new CompilerError(
                  'UPGRADE-BLOCKED-005',
                  'Upgrade restored file identity changed before readback'
                );
              }
              restored = observed;
            }
            acknowledgeUpgradeRestoredFile(snapshot.recoveryIntent, relativePath, restored);
          }
          await commitFence();
          const restored = observeUpgradeWorkspaceProjection({
            workspace,
            lockPath,
            deadlineAtMs: upgradeSnapshotDeadline()
          });
          // A restored file may legitimately have a new native identity. The
          // private ledger owns those acknowledged successors; logical B alone
          // cannot adopt an unrelated same-byte replacement at final readback.
          admitUpgradeRecovery(snapshot.recoveryIntent, restored.projection);
          for (const parent of snapshot.lockParents) {
            assertSameNoFollowDirectoryIdentity(parent, 'Upgrade final lock ancestor');
          }
          const logical = (entries: readonly UpgradeSnapshotProjectionEntry[]) =>
            entries.map(({ identity: _identity, ...entry }) =>
              entry.kind === 'directory' ? { ...entry, size: 0 } : entry
            );
          if (
            snapshot.lockWasPresent !== restored.lockWasPresent ||
            !sameSnapshotProjection(logical(snapshot.projection), logical(restored.projection))
          ) {
            throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade rollback readback differs from its preimage');
          }
        }
      })
  });
}
