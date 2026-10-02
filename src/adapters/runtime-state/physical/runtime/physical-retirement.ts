import { closeSync, fchmodSync, fstatSync, lstatSync } from 'node:fs';
import path from 'node:path';

import { assertSameNoFollowDirectoryIdentity } from './physical-directory-chain.ts';
import { inspectNoFollowDirectoryLeaf } from './physical-directory-entry.ts';
import { directoryTreeEntryPosixOwnership } from './physical-directory-tree.ts';
import { assertExclusiveFileGuardResource } from './physical-exclusive-guard.ts';
import {
  PhysicalNoFollowError,
  type NoFollowDirectoryTreeInventoryEntry,
  type NoFollowDirectoryTreeRetirementReceipt,
  type PhysicalDirectoryIdentity,
  type PhysicalNoFollowEntryAccessFailureObservation,
  type RetainedExclusiveFileGuard
} from './physical-no-follow-contract.ts';
import {
  LINUX_AT_REMOVEDIR,
  WINDOWS_FILE_OPEN,
  WINDOWS_FILE_READ_ATTRIBUTES,
  WINDOWS_GENERIC_READ,
  WINDOWS_READ_CONTROL,
  WINDOWS_SHARE_READ,
  WINDOWS_SHARE_READ_WRITE_DELETE,
  WINDOWS_SYNCHRONIZE,
  WINDOWS_WRITE_DAC,
  closeLinuxDescriptorsBestEffort,
  closeWindowsHandle,
  linuxErrno,
  linuxIdentity,
  linuxOpenAt,
  linuxOpenLeafAt,
  linuxOpenReadableLeafAt,
  linuxOpenRetainedAbsoluteDirectory,
  linuxOpenRoot,
  linuxReadRetainedLinkTarget,
  readLinuxRetainedFile,
  readWindowsRetainedFile,
  requireLinuxLibc,
  windowsAssertParentWithinRetainedRoot,
  windowsFlushRetainedDirectory,
  windowsIdentity,
  windowsMarkRetainedLeafForDelete,
  windowsOpenDirectory,
  windowsOpenNoFollowLeaf,
  windowsOpenRelativeDirectory,
  windowsOpenRelativeNoFollowEntry,
  windowsRetainedLeafIdentity,
  windowsRetainedReparseObservation,
  windowsRewindRetainedFile
} from './physical-no-follow-native.ts';
import { ensureLeafName, physicalError, sameIdentity } from './physical-no-follow-shared.ts';
import {
  windowsHandleSecurityDescriptorBytes,
  windowsTemporaryRelocationDescriptor,
  windowsWriteHandleSecurityDescriptorBytes
} from './physical-windows-security.ts';

/** Exact entry and tree retirement with access-failure observation. */

export function deleteRetainedNoFollowEntry(input: {
  readonly root: PhysicalDirectoryIdentity;
  readonly relativePath: string;
  readonly kind: 'directory' | 'file' | 'link';
  readonly device: string;
  readonly inode: string;
  readonly expectedLinkTarget?: string;
  /** Exact file bytes, compared through a retained native handle immediately before deletion. */
  readonly expectedFileBytes?: Uint8Array;
  /** Live same-resource native exclusion; only cooperative namespace effects are covered. */
  readonly resourceGuard?: RetainedExclusiveFileGuard;
  readonly ancestorDirectories: readonly Readonly<{
    relativePath: string;
    device: string;
    inode: string;
  }>[];
}): void {
  if (input.expectedFileBytes !== undefined && input.kind !== 'file') {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Byte-CAS deletion requires an ordinary file.');
  }
  if (typeof input.relativePath !== 'string' || input.relativePath.length === 0 ||
      input.relativePath.includes('\\') || input.relativePath.includes('\0') ||
      input.relativePath.split('/').some((component) => component === '' || component === '.' || component === '..')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Retained deletion relative path is invalid.');
  }
  const root = assertSameNoFollowDirectoryIdentity(input.root, 'Retained deletion root').target;
  const parts = input.relativePath.split('/');
  const leaf = parts.pop()!;
  if (input.ancestorDirectories.length !== parts.length || input.ancestorDirectories.some((entry, index) =>
    entry.relativePath !== parts.slice(0, index + 1).join('/')
  )) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Retained deletion ancestor inventory is incomplete or noncanonical.');
  }
  if (input.resourceGuard !== undefined) {
    if (parts.length !== 0 || input.kind !== 'file' || input.expectedFileBytes === undefined) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Guarded byte-CAS requires one exact direct resource leaf.');
    }
    assertExclusiveFileGuardResource(input.resourceGuard, root, leaf);
  }
  if (process.platform === 'win32') {
    const rootHandle = windowsOpenDirectory(root.path, 'Retained deletion root');
    const descendantHandles: bigint[] = [];
    let parentHandle = rootHandle;
    let parent = root;
    let leafHandle: bigint | null = null;
    try {
      const checkedRoot = windowsIdentity(rootHandle, root.path, 'Retained deletion root');
      if (!sameIdentity(root, checkedRoot)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion root changed before handle disposition.');
      }
      for (let index = 0; index < parts.length; index += 1) {
        const nextPath = path.join(root.path, ...parts.slice(0, index + 1));
        const nextHandle = windowsOpenRelativeDirectory(
          parentHandle,
          parent,
          parts[index]!,
          nextPath,
          WINDOWS_FILE_OPEN,
          'Retained deletion ancestor',
          WINDOWS_SHARE_READ_WRITE_DELETE,
          true
        );
        if (nextHandle === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', 'Retained deletion ancestor disappeared.');
        descendantHandles.push(nextHandle);
        const next = windowsIdentity(nextHandle, nextPath, 'Retained deletion ancestor');
        const expected = input.ancestorDirectories[index]!;
        if (next.device !== expected.device || next.inode !== expected.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion ancestor identity changed.');
        }
        parentHandle = nextHandle;
        parent = next;
      }
      const leafPath = path.join(parent.path, leaf);
      leafHandle = windowsOpenRelativeNoFollowEntry(
        parentHandle,
        parent,
        leaf,
        leafPath,
        input.kind,
        'Retained deletion leaf',
        input.expectedFileBytes === undefined ? WINDOWS_SHARE_READ_WRITE_DELETE : WINDOWS_SHARE_READ,
        false,
        true,
        input.expectedFileBytes !== undefined
      );
      if (leafHandle === null) {
        if (input.expectedFileBytes !== undefined) {
          // A byte-CAS failure must not change a sealed leaf's DACL merely to
          // discover that the bytes or DELETE permission were unavailable.
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
            'Retained byte-CAS deletion cannot project leaf permissions.'
          );
        }
        let readOnlyLeaf: bigint | null = null;
        let projectionHandle: bigint | null = null;
        try {
          readOnlyLeaf = windowsOpenRelativeNoFollowEntry(
            parentHandle,
            parent,
            leaf,
            leafPath,
            input.kind,
            'Retained deletion sealed leaf admission',
            WINDOWS_SHARE_READ_WRITE_DELETE,
            true
          );
          const sealedIdentity = windowsRetainedLeafIdentity(
            readOnlyLeaf,
            leafPath,
            input.kind,
            'Retained deletion sealed leaf admission'
          );
          if (sealedIdentity.device !== input.device || sealedIdentity.inode !== input.inode) {
            throw physicalError(
              'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
              'Retained deletion sealed leaf FileId changed before authority projection.'
            );
          }
          projectionHandle = windowsOpenNoFollowLeaf(
            leafPath,
            'Retained deletion sealed leaf authority projection',
            WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_READ_CONTROL | WINDOWS_WRITE_DAC | WINDOWS_SYNCHRONIZE
          );
          const projectionIdentity = windowsRetainedLeafIdentity(
            projectionHandle,
            leafPath,
            input.kind,
            'Retained deletion sealed leaf authority projection'
          );
          if (projectionIdentity.device !== sealedIdentity.device ||
              projectionIdentity.inode !== sealedIdentity.inode) {
            throw physicalError(
              'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
              'Retained deletion sealed leaf changed before authority projection.'
            );
          }
          const predecessor = windowsHandleSecurityDescriptorBytes(
            projectionHandle,
            'Retained deletion sealed leaf authority projection'
          );
          const temporary = windowsTemporaryRelocationDescriptor(predecessor);
          windowsWriteHandleSecurityDescriptorBytes(
            projectionHandle,
            temporary,
            'Retained deletion sealed leaf authority projection'
          );
          if (!windowsHandleSecurityDescriptorBytes(
            projectionHandle,
            'Retained deletion sealed leaf authority projection readback'
          ).equals(temporary)) {
            throw physicalError(
              'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
              'Retained deletion sealed leaf descriptor projection failed readback.'
            );
          }
        } finally {
          if (projectionHandle !== null) closeWindowsHandle(projectionHandle);
          if (readOnlyLeaf !== null) closeWindowsHandle(readOnlyLeaf);
        }
        leafHandle = windowsOpenRelativeNoFollowEntry(
          parentHandle,
          parent,
          leaf,
          leafPath,
          input.kind,
          'Retained deletion projected leaf',
          input.expectedFileBytes === undefined ? WINDOWS_SHARE_READ_WRITE_DELETE : WINDOWS_SHARE_READ,
          false,
          false,
          input.expectedFileBytes !== undefined
        );
      }
      const identity = windowsRetainedLeafIdentity(leafHandle, leafPath, input.kind, 'Retained deletion leaf');
      if (identity.device !== input.device || identity.inode !== input.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion leaf FileId changed.');
      }
      if (input.expectedFileBytes !== undefined) {
        windowsRewindRetainedFile(leafHandle, 'Retained byte-CAS deletion leaf');
        const actual = readWindowsRetainedFile(
          leafHandle,
          'Retained byte-CAS deletion leaf',
          input.expectedFileBytes.byteLength
        );
        if (!Buffer.from(actual).equals(input.expectedFileBytes)) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion file bytes changed.');
        }
      }
      if (input.kind === 'link' && input.expectedLinkTarget !== undefined
          && windowsRetainedReparseObservation(leafHandle, 'Retained deletion leaf').linkTarget
            !== input.expectedLinkTarget) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion link target changed.');
      }
      windowsMarkRetainedLeafForDelete(leafHandle, 'Retained deletion leaf');
      closeWindowsHandle(leafHandle);
      leafHandle = null;
      // Deletion is only accepted after the original retained parent and root
      // are re-proven.  The caller's subsequent durable receipt pointer is
      // published through a retained source-handle native rename.
      const parentAfter = windowsIdentity(parentHandle, parent.path, 'Retained deletion parent');
      if (!sameIdentity(parent, parentAfter)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion parent changed during handle disposition.');
      }
      // A leaf may be a file or reparse link as well as a directory.  Probe
      // relative to the retained parent handle so readback never turns the
      // lexical leaf path into a new authority (and never asks a directory
      // opener to classify a file/link).
      try {
        const reopened = windowsOpenRelativeNoFollowEntry(
          parentHandle,
          parent,
          leaf,
          leafPath,
          input.kind,
          'Retained deletion leaf readback'
        );
        closeWindowsHandle(reopened);
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained deletion parent/name remains present.');
      } catch (error) {
        if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      }
      windowsFlushRetainedDirectory(parentHandle, parent, 'Retained deletion target parent');
      const rootAfter = windowsIdentity(rootHandle, root.path, 'Retained deletion root');
      if (!sameIdentity(root, rootAfter)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion root changed after handle disposition.');
      }
      windowsAssertParentWithinRetainedRoot(rootAfter, parentAfter, parts);
      return;
    } finally {
      if (leafHandle !== null) closeWindowsHandle(leafHandle);
      for (const handle of descendantHandles.reverse()) closeWindowsHandle(handle);
      closeWindowsHandle(rootHandle);
    }
  }
  if (process.platform !== 'linux') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Retained destructive deletion backend is unavailable on this platform.');
  }
  if (input.expectedFileBytes !== undefined && input.resourceGuard === undefined) {
    // POSIX unlinkat removes a name, not the inspected file descriptor.
    // Without an owner-issued namespace exclusion, read-then-unlink cannot
    // promise byte-CAS against an uncooperative rename or in-place writer.
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Retained byte-CAS deletion needs a native namespace exclusion on Linux.'
    );
  }
  const filesystemRootFd = linuxOpenRoot('Retained deletion root');
  let retainedRootFd = filesystemRootFd;
  let parentFd: number | null = null;
  let leafFd: number | null = null;
  let primaryFailure: unknown;
  try {
    const rootSegments = root.path.slice(path.parse(root.path).root.length).split('/').filter(Boolean);
    for (const segment of rootSegments) {
      const next = linuxOpenAt(retainedRootFd, segment, 'Retained deletion root');
      if (retainedRootFd !== filesystemRootFd) closeSync(retainedRootFd);
      retainedRootFd = next;
    }
    const retainedRoot = linuxIdentity(retainedRootFd, root.path);
    if (!sameIdentity(root, retainedRoot)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion root changed before unlinkat.');
    }
    // Every descendant effect is resolved from the retained authorized root
    // fd.  Do not reopen from `/`: an absolute second traversal would create
    // a replacement window between the authorization fence and `unlinkat`.
    parentFd = retainedRootFd;
    for (let index = 0; index < parts.length; index += 1) {
      const segment = parts[index]!;
      const next = linuxOpenAt(parentFd, segment, 'Retained deletion parent');
      if (parentFd !== retainedRootFd) closeSync(parentFd);
      parentFd = next;
      const expected = input.ancestorDirectories[index]!;
      const actual = fstatSync(parentFd, { bigint: true });
      if (!actual.isDirectory() || String(actual.dev) !== expected.device || String(actual.ino) !== expected.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion ancestor identity changed.');
      }
    }
    leafFd = input.expectedFileBytes === undefined
      ? linuxOpenLeafAt(parentFd, leaf, 'Retained deletion leaf')
      : linuxOpenReadableLeafAt(parentFd, leaf, 'Retained guarded deletion leaf');
    const stat = fstatSync(leafFd, { bigint: true });
    const kindMatches = input.kind === 'directory' ? stat.isDirectory() : input.kind === 'file' ? stat.isFile() : stat.isSymbolicLink();
    if (String(stat.dev) !== input.device || String(stat.ino) !== input.inode || !kindMatches) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion leaf identity changed.');
    }
    if (input.kind === 'link' && input.expectedLinkTarget !== undefined
        && linuxReadRetainedLinkTarget(leafFd, 'Retained deletion leaf') !== input.expectedLinkTarget) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion link target changed.');
    }
    if (input.expectedFileBytes !== undefined) {
      assertExclusiveFileGuardResource(input.resourceGuard!, root, leaf);
      const bytes = readLinuxRetainedFile(leafFd, 'Retained guarded deletion exact bytes', input.expectedFileBytes.byteLength);
      if (!Buffer.from(bytes).equals(input.expectedFileBytes)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained guarded deletion bytes changed.');
      }
      // The retained fd is evidence; the held resource guard provides the
      // cooperative exclusion around the following native name effect.
      const namedFd = linuxOpenReadableLeafAt(parentFd, leaf, 'Retained guarded deletion named preimage');
      try {
        const named = fstatSync(namedFd, { bigint: true });
        if (String(named.dev) !== input.device || String(named.ino) !== input.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained guarded deletion named identity changed.');
        }
      } finally { closeSync(namedFd); }
      assertExclusiveFileGuardResource(input.resourceGuard!, root, leaf);
    }
    if (requireLinuxLibc().symbols.unlinkat(parentFd, Buffer.from(`${leaf}\0`, 'utf8'), input.kind === 'directory' ? LINUX_AT_REMOVEDIR : 0) !== 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Retained unlinkat failed (errno ${linuxErrno()}).`);
    }
    if (requireLinuxLibc().symbols.fsync(parentFd) !== 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained deletion parent fsync failed.');
    }
    try {
      const reopened = linuxOpenLeafAt(parentFd, leaf, 'Retained deletion leaf readback');
      closeSync(reopened);
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained deletion parent/name remains present.');
    } catch (error) {
      if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
    }
    if (input.resourceGuard !== undefined) assertExclusiveFileGuardResource(input.resourceGuard, root, leaf);
    const retainedRootAfter = linuxIdentity(retainedRootFd, root.path);
    if (!sameIdentity(root, retainedRootAfter)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion root changed during unlinkat.');
    }
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const failures: unknown[] = [];
    for (const fd of [leafFd, parentFd !== retainedRootFd ? parentFd : null,
      retainedRootFd !== filesystemRootFd ? retainedRootFd : null, filesystemRootFd]) {
      if (fd !== null) try { closeSync(fd); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) {
      throw new AggregateError(primaryFailure === undefined ? failures : [primaryFailure, ...failures],
        'Retained deletion descriptor settlement failed.');
    }
  }
}

/**
 * Observes an exact leaf preimage below a retained parent, then attempts one
 * no-follow retained open. A receipt is returned only when the operating
 * system rejects that physical entry with typed native status; presentation
 * text and caller-authored failure labels are never classification inputs.
 */
export function observeNoFollowEntryAccessFailure(
  parent: PhysicalDirectoryIdentity,
  name: string
): PhysicalNoFollowEntryAccessFailureObservation | null {
  ensureLeafName(name);
  const checked = assertSameNoFollowDirectoryIdentity(
    parent,
    'No-follow endpoint residue parent'
  ).target;
  if (process.platform !== 'win32') return null;
  const target = path.join(checked.path, name);
  const before = lstatSync(target, { bigint: true });
  const kind = before.isDirectory()
    ? 'directory' as const
    : before.isFile()
      ? 'file' as const
      : before.isSymbolicLink()
        ? 'link' as const
        : 'other' as const;
  let handle: bigint | null = null;
  try {
    handle = windowsOpenNoFollowLeaf(target, 'No-follow endpoint residue', WINDOWS_GENERIC_READ);
    return null;
  } catch (error) {
    if (!(error instanceof PhysicalNoFollowError) || error.nativeFailure === null) throw error;
    const currentParent = assertSameNoFollowDirectoryIdentity(
      checked,
      'No-follow endpoint residue parent readback'
    ).target;
    if (!sameIdentity(checked, currentParent)) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        'No-follow endpoint residue parent changed during native failure observation.'
      );
    }
    return Object.freeze({
      path: target,
      kind,
      device: String(before.dev),
      inode: String(before.ino),
      objectId: `lstat:${before.dev}:${before.ino}`,
      nativeFailure: error.nativeFailure
    });
  } finally {
    if (handle !== null) closeWindowsHandle(handle);
  }
}

interface LinuxTreeRetirementPermissionRecovery {
  settle(retired: boolean): void;
}

function prepareLinuxTreeRetirementPermissionRecovery(
  expectedRoot: PhysicalDirectoryIdentity,
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[],
  assertRecoveryBudget: () => void
): LinuxTreeRetirementPermissionRecovery {
  const effectiveUserId = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid())
    : null;
  if (effectiveUserId === null) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'No-follow tree retirement cannot observe the effective POSIX owner.'
    );
  }
  const retainedRoot = linuxOpenRetainedAbsoluteDirectory(
    expectedRoot.path,
    'No-follow tree retirement permission root'
  );
  const openedDirectories: number[] = [];
  const directoryFds = new Map<string, number>([['', retainedRoot.directoryFd]]);
  const retainedModes: Array<Readonly<{ fd: number; mode: number }>> = [];
  const closeAll = (): void => {
    const descriptors = [
      ...openedDirectories.reverse(),
      ...(retainedRoot.directoryFd === retainedRoot.filesystemRootFd
        ? [retainedRoot.directoryFd]
        : [retainedRoot.directoryFd, retainedRoot.filesystemRootFd])
    ];
    const closeError = closeLinuxDescriptorsBestEffort(descriptors, 'No-follow tree retirement permission recovery');
    if (closeError !== null) throw closeError;
  };
  try {
    assertRecoveryBudget();
    const rootStat = fstatSync(retainedRoot.directoryFd, { bigint: true });
    if (!rootStat.isDirectory() || String(rootStat.dev) !== expectedRoot.device ||
        String(rootStat.ino) !== expectedRoot.inode || rootStat.uid !== effectiveUserId) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        'No-follow tree retirement permission root identity or owner changed.'
      );
    }
    retainedModes.push(Object.freeze({
      fd: retainedRoot.directoryFd,
      mode: Number(rootStat.mode & 0o7777n)
    }));
    const orderedDirectories = inventory.filter(({ kind }) => kind === 'directory').sort((left, right) => {
      const depth = left.relativePath.split('/').length - right.relativePath.split('/').length;
      return depth || left.relativePath.localeCompare(right.relativePath);
    });
    for (const entry of orderedDirectories) {
      assertRecoveryBudget();
      const parts = entry.relativePath.split('/');
      const name = parts.pop()!;
      const parentFd = directoryFds.get(parts.join('/'));
      if (parentFd === undefined) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow tree retirement permission inventory is incomplete.');
      }
      const fd = linuxOpenAt(parentFd, name, 'No-follow tree retirement permission directory');
      openedDirectories.push(fd);
      const current = fstatSync(fd, { bigint: true });
      const ownership = directoryTreeEntryPosixOwnership(entry);
      if (!current.isDirectory() || String(current.dev) !== entry.device || String(current.ino) !== entry.inode ||
          !Number.isSafeInteger(entry.permissionMode) || Number(current.mode & 0o7777n) !== entry.permissionMode ||
          ownership === undefined || ownership.ownerUserId !== current.uid ||
          ownership.ownerGroupId !== current.gid || current.uid !== effectiveUserId) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
          `No-follow tree retirement permission identity, mode, or owner changed: ${entry.relativePath}.`
        );
      }
      directoryFds.set(entry.relativePath, fd);
      retainedModes.push(Object.freeze({ fd, mode: entry.permissionMode }));
    }
  } catch (error) {
    try { closeAll(); } catch { /* no permission mutation occurred; retain the admission failure */ }
    throw error;
  }

  try {
    for (const retained of retainedModes) {
      assertRecoveryBudget();
      fchmodSync(retained.fd, retained.mode | 0o700);
      const readback = fstatSync(retained.fd, { bigint: true });
      if (readback.uid !== effectiveUserId || Number(readback.mode & 0o7777n) !== (retained.mode | 0o700)) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
          'No-follow tree retirement temporary owner permission readback differs.'
        );
      }
    }
  } catch (error) {
    for (const retained of [...retainedModes].reverse()) {
      try { fchmodSync(retained.fd, retained.mode); } catch { /* retain the primary permission failure */ }
    }
    try { closeAll(); } catch { /* retain the primary permission failure */ }
    throw error;
  }

  let settled = false;
  let settlementFailure: Readonly<{ error: unknown }> | undefined;
  return Object.freeze({
    settle: (retired: boolean): void => {
      if (settled) {
        if (settlementFailure !== undefined) throw settlementFailure.error;
        return;
      }
      settled = true;
      const restoreFailures: unknown[] = [];
      if (!retired) {
        for (const retained of [...retainedModes].reverse()) {
          try {
            fchmodSync(retained.fd, retained.mode);
            const readback = fstatSync(retained.fd, { bigint: true });
            if (Number(readback.mode & 0o7777n) !== retained.mode) {
              throw physicalError(
                'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
                'No-follow tree retirement permission restoration readback differs.'
              );
            }
          } catch (error) {
            restoreFailures.push(error);
          }
        }
      }
      try { closeAll(); } catch (error) { restoreFailures.push(error); }
      if (restoreFailures.length > 0) {
        const error = restoreFailures.length === 1
          ? restoreFailures[0]
          : new AggregateError(
              restoreFailures,
              'No-follow tree retirement permission settlement had multiple failures.'
            );
        settlementFailure = Object.freeze({ error });
        throw error;
      }
    }
  });
}

/**
 * Retires one exact operation-owned directory tree from its retained parent.
 * Every descendant is deleted by its inventoried physical identity and exact
 * retained ancestor chain; a fresh, caller-supplied recovery deadline bounds
 * cleanup independently from the execution deadline that produced the tree.
 */
export function retireNoFollowDirectoryTree(input: Readonly<{
  deadlineAtMonotonicMs: number;
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  parent: PhysicalDirectoryIdentity;
  /** Opt-in retained-fd permission recovery for an operation-owned POSIX snapshot. */
  restoreOwnerPermissions?: boolean;
  root: PhysicalDirectoryIdentity;
}>): NoFollowDirectoryTreeRetirementReceipt {
  if (!Number.isFinite(input.deadlineAtMonotonicMs)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow tree retirement deadline is invalid.');
  }
  if (input.restoreOwnerPermissions !== undefined && typeof input.restoreOwnerPermissions !== 'boolean') {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow tree retirement permission option is invalid.');
  }
  const parent = assertSameNoFollowDirectoryIdentity(input.parent, 'No-follow tree retirement parent').target;
  const root = assertSameNoFollowDirectoryIdentity(input.root, 'No-follow tree retirement root').target;
  if (path.dirname(root.path) !== parent.path) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow tree retirement root is not a direct child of its parent.');
  }
  const assertRecoveryBudget = (): void => {
    if (performance.now() >= input.deadlineAtMonotonicMs) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow tree retirement recovery deadline exceeded.');
    }
  };
  const directories = new Map(input.inventory
    .filter(({ kind }) => kind === 'directory')
    .map((entry) => [entry.relativePath, entry] as const));
  const ordered = [...input.inventory].sort((left, right) => {
    const depth = right.relativePath.split('/').length - left.relativePath.split('/').length;
    if (depth !== 0) return depth;
    if (left.kind === 'directory' && right.kind !== 'directory') return 1;
    if (right.kind === 'directory' && left.kind !== 'directory') return -1;
    return right.relativePath.localeCompare(left.relativePath);
  });
  const permissionRecovery = input.restoreOwnerPermissions === true && process.platform === 'linux'
    ? prepareLinuxTreeRetirementPermissionRecovery(root, input.inventory, assertRecoveryBudget)
    : null;
  try {
    for (const entry of ordered) {
      assertRecoveryBudget();
      const parts = entry.relativePath.split('/');
      parts.pop();
      const ancestorDirectories = parts.map((_, index) => {
        const relativePath = parts.slice(0, index + 1).join('/');
        const ancestor = directories.get(relativePath);
        if (ancestor === undefined) {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow tree retirement inventory is incomplete.');
        }
        return Object.freeze({ relativePath, device: ancestor.device, inode: ancestor.inode });
      });
      deleteRetainedNoFollowEntry({
        root,
        relativePath: entry.relativePath,
        kind: entry.kind,
        device: entry.device,
        inode: entry.inode,
        ...(entry.linkTarget === null ? {} : { expectedLinkTarget: entry.linkTarget }),
        ancestorDirectories
      });
    }
    assertRecoveryBudget();
    deleteRetainedNoFollowEntry({
      root: parent,
      relativePath: path.basename(root.path),
      kind: 'directory',
      device: root.device,
      inode: root.inode,
      ancestorDirectories: []
    });
    assertRecoveryBudget();
    if (inspectNoFollowDirectoryLeaf(parent, path.basename(root.path), 'No-follow tree retirement root readback') !== null) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'No-follow tree retirement left root residue.');
    }
    permissionRecovery?.settle(true);
    return Object.freeze({ entryCount: ordered.length, root, status: 'physically-absent' as const });
  } catch (error) {
    try { permissionRecovery?.settle(false); } catch { /* retain the primary retirement failure */ }
    throw error;
  }
}

/**
 * Observes one ordinary leaf below a retained parent. This is intentionally
 * O(1): proving one control file must never scan unrelated siblings or trees.
 */
