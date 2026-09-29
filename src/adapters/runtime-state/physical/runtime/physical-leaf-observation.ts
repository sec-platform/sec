import { closeSync, fstatSync } from 'node:fs';
import path from 'node:path';

import { assertSameNoFollowDirectoryIdentity } from './physical-directory-chain.ts';
import {
  PhysicalNoFollowError,
  type NoFollowDirectoryTreeEntry,
  type NoFollowOrdinaryFileDigest,
  type PhysicalDirectoryIdentity
} from './physical-no-follow-contract.ts';
import {
  WINDOWS_FILE_OPEN,
  WINDOWS_GENERIC_READ,
  WINDOWS_SHARE_READ_WRITE_DELETE,
  boundedNoFollowFileReadMaximum,
  closeWindowsHandle,
  digestRetainedOrdinaryFileFd,
  digestWindowsRetainedFile,
  linuxIdentity,
  linuxOpenAt,
  linuxOpenLeafAt,
  linuxOpenReadableLeafAt,
  linuxOpenRetainedAbsoluteDirectory,
  linuxOpenRoot,
  linuxReadRetainedLinkTarget,
  readLinuxRetainedFile,
  readWindowsRetainedFile,
  windowsIdentity,
  windowsOpenDirectory,
  windowsOpenRelativeLeaf,
  windowsOpenRelativeNoFollowEntry,
  windowsReadRetainedJunctionTarget,
  windowsRetainedLeafIdentity,
  windowsRetainedReparseObservation
} from './physical-no-follow-native.ts';
import {
  assertPhysicalLinkTarget, ensureLeafName, physicalError, sameIdentity
} from './physical-no-follow-shared.ts';

/** Stable leaf/link observations and bounded ordinary-file reads. */

export function inspectNoFollowOrdinaryFileEntry(
  parent: PhysicalDirectoryIdentity,
  name: string,
  options: Readonly<{ maximumBytes?: number }> = {}
): NoFollowDirectoryTreeEntry | null {
  ensureLeafName(name);
  const maximumBytes = boundedNoFollowFileReadMaximum(options.maximumBytes);
  const checked = assertSameNoFollowDirectoryIdentity(parent, 'No-follow file parent').target;
  const target = path.join(checked.path, name);
  if (process.platform === 'win32') {
    let parentHandle: bigint | null = null;
    let leafHandle: bigint | null = null;
    try {
      parentHandle = windowsOpenDirectory(checked.path, 'No-follow file retained parent');
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'No-follow file retained parent'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow file parent changed before retained leaf open.');
      }
      leafHandle = windowsOpenRelativeLeaf(
        parentHandle, checked, name, target, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, 'No-follow file', true
      );
      if (leafHandle === null) return null;
      const identity = windowsRetainedLeafIdentity(leafHandle, target, 'file', 'No-follow file');
      const bytes = readWindowsRetainedFile(leafHandle, 'No-follow file', maximumBytes);
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'No-follow file retained parent readback'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow file parent changed during retained leaf read.');
      }
      return Object.freeze({ relativePath: name, kind: 'file', ...identity, size: bytes.byteLength, bytes, linkTarget: null });
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow file is not an ordinary non-reparse leaf.', error);
      }
      throw error;
    } finally {
      if (leafHandle !== null) closeWindowsHandle(leafHandle);
      if (parentHandle !== null) closeWindowsHandle(parentHandle);
    }
  }
  if (process.platform === 'linux') {
    const rootFd = linuxOpenRoot('No-follow file parent');
    let parentFd = rootFd;
    let leafFd: number | null = null;
    try {
      const segments = checked.path.slice(path.parse(checked.path).root.length).split('/').filter(Boolean);
      for (const segment of segments) {
        const next = linuxOpenAt(parentFd, segment, 'No-follow file parent');
        if (parentFd !== rootFd) closeSync(parentFd);
        parentFd = next;
      }
      if (!sameIdentity(checked, linuxIdentity(parentFd, checked.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow file parent changed before retained leaf open.');
      }
      try {
        leafFd = linuxOpenReadableLeafAt(parentFd, name, 'No-follow file');
      } catch (error) {
        if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
        throw error;
      }
      const stat = fstatSync(leafFd, { bigint: true });
      if (!stat.isFile()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow file is not an ordinary file.');
      const bytes = readLinuxRetainedFile(leafFd, 'No-follow file', maximumBytes);
      const after = fstatSync(leafFd, { bigint: true });
      if (stat.dev !== after.dev || stat.ino !== after.ino || !after.isFile()) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow file retained identity changed during read.');
      }
      if (!sameIdentity(checked, linuxIdentity(parentFd, checked.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow file parent changed during retained leaf read.');
      }
      return Object.freeze({
        relativePath: name,
        kind: 'file',
        device: String(stat.dev),
        inode: String(stat.ino),
        size: bytes.byteLength,
        bytes,
        linkTarget: null
      });
    } finally {
      if (leafFd !== null) closeSync(leafFd);
      if (parentFd !== rootFd) closeSync(parentFd);
      closeSync(rootFd);
    }
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow ordinary file reader backend is unavailable.');
}

/**
 * Streams one arbitrarily large ordinary leaf through a retained no-follow
 * handle. This is the raw-byte counterpart of the canonical inventory digest
 * and is intended for external CAS/OCI descriptor verification.
 */
export function inspectNoFollowOrdinaryFileDigest(
  parent: PhysicalDirectoryIdentity,
  name: string
): NoFollowOrdinaryFileDigest | null {
  ensureLeafName(name);
  const checked = assertSameNoFollowDirectoryIdentity(parent, 'No-follow digest parent').target;
  const target = path.join(checked.path, name);
  if (process.platform === 'win32') {
    let parentHandle: bigint | null = null;
    let leafHandle: bigint | null = null;
    try {
      parentHandle = windowsOpenDirectory(checked.path, 'No-follow digest retained parent');
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'No-follow digest retained parent'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow digest parent changed before retained leaf open.');
      }
      leafHandle = windowsOpenRelativeLeaf(
        parentHandle, checked, name, target, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, 'No-follow digest file', true
      );
      if (leafHandle === null) return null;
      const identity = windowsRetainedLeafIdentity(leafHandle, target, 'file', 'No-follow digest file');
      const result = digestWindowsRetainedFile(leafHandle, target, identity, 'No-follow digest file');
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'No-follow digest retained parent readback'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow digest parent changed during retained leaf read.');
      }
      return Object.freeze({ size: result.size, byteDigest: result.byteDigest });
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow digest file is not a stable ordinary leaf.', error);
      }
      throw error;
    } finally {
      if (leafHandle !== null) closeWindowsHandle(leafHandle);
      if (parentHandle !== null) closeWindowsHandle(parentHandle);
    }
  }
  if (process.platform === 'linux') {
    const rootFd = linuxOpenRoot('No-follow digest parent');
    let parentFd = rootFd;
    let leafFd: number | null = null;
    try {
      const segments = checked.path.slice(path.parse(checked.path).root.length).split('/').filter(Boolean);
      for (const segment of segments) {
        const next = linuxOpenAt(parentFd, segment, 'No-follow digest parent');
        if (parentFd !== rootFd) closeSync(parentFd);
        parentFd = next;
      }
      if (!sameIdentity(checked, linuxIdentity(parentFd, checked.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow digest parent changed before retained leaf open.');
      }
      try {
        leafFd = linuxOpenReadableLeafAt(parentFd, name, 'No-follow digest file');
      } catch (error) {
        if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
        throw error;
      }
      const stat = fstatSync(leafFd, { bigint: true });
      if (!stat.isFile()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow digest file is not ordinary.');
      const result = digestRetainedOrdinaryFileFd(leafFd, {
        device: String(stat.dev), inode: String(stat.ino)
      }, 'No-follow digest file');
      if (!sameIdentity(checked, linuxIdentity(parentFd, checked.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow digest parent changed during retained leaf read.');
      }
      return Object.freeze({ size: result.size, byteDigest: result.byteDigest });
    } finally {
      if (leafFd !== null) closeSync(leafFd);
      if (parentFd !== rootFd) closeSync(parentFd);
      closeSync(rootFd);
    }
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow ordinary file digest backend is unavailable.');
}

/**
 * Observes one retained link/reparse leaf without resolving its target. The
 * target bytes/digest are part of the observation so an in-place retarget is
 * an identity change even when the filesystem keeps the same FileId/inode.
 */
export function inspectNoFollowLinkEntry(
  parent: PhysicalDirectoryIdentity,
  name: string
): NoFollowDirectoryTreeEntry | null {
  ensureLeafName(name);
  const checked = assertSameNoFollowDirectoryIdentity(parent, 'No-follow link parent').target;
  const target = path.join(checked.path, name);
  if (process.platform === 'win32') {
    let parentHandle: bigint | null = null;
    let leafHandle: bigint | null = null;
    try {
      parentHandle = windowsOpenDirectory(checked.path, 'No-follow link retained parent');
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'No-follow link retained parent'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link parent changed before retained leaf open.');
      }
      try {
        leafHandle = windowsOpenRelativeNoFollowEntry(
          parentHandle,
          checked,
          name,
          target,
          'link',
          'No-follow link',
          WINDOWS_SHARE_READ_WRITE_DELETE,
          true
        );
      } catch (error) {
        if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
        throw error;
      }
      const identity = windowsRetainedLeafIdentity(leafHandle, target, 'link', 'No-follow link');
      const reparse = windowsRetainedReparseObservation(leafHandle, 'No-follow link');
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'No-follow link retained parent readback'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link parent changed during retained leaf read.');
      }
      return Object.freeze({
        relativePath: name,
        kind: 'link',
        ...identity,
        size: reparse.size,
        bytes: null,
        linkTarget: reparse.linkTarget
      });
    } finally {
      if (leafHandle !== null) closeWindowsHandle(leafHandle);
      if (parentHandle !== null) closeWindowsHandle(parentHandle);
    }
  }
  if (process.platform === 'linux') {
    const retained = linuxOpenRetainedAbsoluteDirectory(checked.path, 'No-follow link parent');
    let leafFd: number | null = null;
    try {
      if (!sameIdentity(checked, linuxIdentity(retained.directoryFd, checked.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link parent changed before retained leaf open.');
      }
      try {
        leafFd = linuxOpenLeafAt(retained.directoryFd, name, 'No-follow link');
      } catch (error) {
        if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
        throw error;
      }
      const stat = fstatSync(leafFd, { bigint: true });
      if (!stat.isSymbolicLink()) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow link is not a symbolic link.');
      }
      const linkTarget = linuxReadRetainedLinkTarget(leafFd, 'No-follow link');
      const after = fstatSync(leafFd, { bigint: true });
      if (stat.dev !== after.dev || stat.ino !== after.ino || !after.isSymbolicLink()) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link retained identity changed during read.');
      }
      if (!sameIdentity(checked, linuxIdentity(retained.directoryFd, checked.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link parent changed during retained leaf read.');
      }
      return Object.freeze({
        relativePath: name,
        kind: 'link',
        device: String(stat.dev),
        inode: String(stat.ino),
        size: Number(stat.size),
        bytes: null,
        linkTarget
      });
    } finally {
      if (leafFd !== null) closeSync(leafFd);
      if (retained.directoryFd !== retained.filesystemRootFd) closeSync(retained.directoryFd);
      closeSync(retained.filesystemRootFd);
    }
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow link reader backend is unavailable.');
}

/**
 * Observes one no-follow link and proves, from the retained link handle, that
 * it names the caller's exact expected directory target. Generic inventory
 * deliberately exposes only a reparse-byte digest on Windows; semantic owners
 * must use this boundary instead of interpreting that digest as a pathname.
 */
export function inspectExactNoFollowLinkEntry(
  parent: PhysicalDirectoryIdentity,
  name: string,
  expectedTargetPath: string
): ReturnType<typeof inspectNoFollowLinkEntry> {
  const observed = inspectNoFollowLinkEntry(parent, name);
  if (observed === null) return null;
  if (observed.kind !== 'link' || observed.linkTarget === null) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Exact no-follow link observation found a non-link entry.');
  }
  const checked = assertSameNoFollowDirectoryIdentity(parent, 'Exact no-follow link parent').target;
  if (process.platform === 'win32') {
    let parentHandle: bigint | null = null;
    let leafHandle: bigint | null = null;
    try {
      parentHandle = windowsOpenDirectory(checked.path, 'Exact no-follow link parent');
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'Exact no-follow link parent'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Exact no-follow link parent changed before retained read.');
      }
      const targetPath = path.join(checked.path, name);
      leafHandle = windowsOpenRelativeNoFollowEntry(
        parentHandle,
        checked,
        name,
        targetPath,
        'link',
        'Exact no-follow link'
      );
      const identity = windowsRetainedLeafIdentity(leafHandle, targetPath, 'link', 'Exact no-follow link');
      if (identity.device !== observed.device || identity.inode !== observed.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Exact no-follow link identity changed before target read.');
      }
      windowsReadRetainedJunctionTarget(
        leafHandle,
        expectedTargetPath,
        checked.path,
        'Exact no-follow link'
      );
      const reparse = windowsRetainedReparseObservation(leafHandle, 'Exact no-follow link');
      if (reparse.linkTarget !== observed.linkTarget) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Exact no-follow link reparse bytes changed during read.');
      }
      if (!sameIdentity(checked, windowsIdentity(parentHandle, checked.path, 'Exact no-follow link parent readback'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Exact no-follow link parent changed during retained read.');
      }
      return observed;
    } finally {
      if (leafHandle !== null) closeWindowsHandle(leafHandle);
      if (parentHandle !== null) closeWindowsHandle(parentHandle);
    }
  }
  if (process.platform === 'linux') {
    assertPhysicalLinkTarget(observed.linkTarget, expectedTargetPath, checked.path, 'Exact no-follow link');
    return observed;
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Exact no-follow link target validation is unavailable.');
}

/** Reads one ordinary leaf file below a revalidated no-follow parent, or null only for ENOENT. */
export function readNoFollowOrdinaryFile(
  parent: PhysicalDirectoryIdentity,
  name: string,
  options: Readonly<{ maximumBytes?: number }> = {}
): Uint8Array | null {
  return inspectNoFollowOrdinaryFileEntry(parent, name, options)?.bytes ?? null;
}
