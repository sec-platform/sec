import { closeSync, fstatSync } from 'node:fs';

import { assertSameNoFollowDirectoryIdentity } from './physical-directory-chain.ts';
import { inspectNoFollowOrdinaryFileEntry } from './physical-leaf-observation.ts';
import {
  type PhysicalDirectoryIdentity,
  type RetainedExclusiveFileGuard
} from './physical-no-follow-contract.ts';
import {
  closeWindowsHandle,
  linuxIdentity,
  linuxOpenReadableLeafAt,
  linuxOpenRetainedAbsoluteDirectory,
  linuxRaiseDescriptorFloor,
  linuxReleaseExclusiveFileGuard,
  linuxTryExclusiveFileGuard,
  WINDOWS_FILE_OPEN,
  WINDOWS_GENERIC_READ,
  windowsIdentity,
  windowsOpenDirectory,
  windowsOpenRelativeLeaf,
  windowsReleaseExclusiveFileGuard,
  windowsRetainedLeafIdentity,
  windowsRetainedOrdinaryFileLinkCount,
  windowsTryExclusiveFileGuard
} from './physical-no-follow-native.ts';
import { ensureLeafName, physicalError, sameIdentity } from './physical-no-follow-shared.ts';

const MAXIMUM_ANCHOR_BYTES = 8192;
const issuedGuardResources = new WeakMap<object, Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
}>>();

/** Effect admission consumes the retained native token, never a cloned shape. */
export function assertExclusiveFileGuardResource(
  guard: RetainedExclusiveFileGuard,
  parent: PhysicalDirectoryIdentity,
  resourceName: string
): void {
  const resource = issuedGuardResources.get(guard);
  if (resource === undefined || resource.name !== resourceName
    || resource.parent.path !== parent.path || !sameIdentity(resource.parent, parent)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Native file guard does not bind this exact parent/resource leaf.');
  }
  guard.assertCurrent();
}


/**
 * Retain an already admitted immutable anchor. Creation and persistent binding
 * belong to the resource owner; absence never means permission to recreate it.
 * Checks fence cooperative namespace changes, not hostile unlink/write races.
 */
export function tryRetainExclusiveFileGuard(
  parent: PhysicalDirectoryIdentity,
  name: string,
  expectedPhysical: Readonly<{ device: string; inode: string }>,
  expectedBytes: Uint8Array,
  protectedResourceName?: string
): RetainedExclusiveFileGuard | null {
  ensureLeafName(name);
  if (protectedResourceName !== undefined) ensureLeafName(protectedResourceName);
  const label = 'Physical exclusive resource guard';
  if (expectedBytes.byteLength === 0 || expectedBytes.byteLength > MAXIMUM_ANCHOR_BYTES) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} anchor bytes are outside the bounded domain.`);
  }
  const bytes = Buffer.from(expectedBytes);
  assertSameNoFollowDirectoryIdentity(parent, `${label} parent`);
  let rootFd: number | null = null;
  let parentFd: number | null = null;
  let fileFd: number | null = null;
  let parentHandle: bigint | null = null;
  let fileHandle: bigint | null = null;
  let acquired = false;
  let closed = false;
  let closeFailure: unknown;

  const assertCurrent = (): void => {
    if (closed) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} is closed.`);
    assertSameNoFollowDirectoryIdentity(parent, `${label} parent readback`);
    const retainedParent = parentFd === null
      ? windowsIdentity(parentHandle!, parent.path, label)
      : linuxIdentity(parentFd, parent.path);
    if (!sameIdentity(parent, retainedParent)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent identity changed.`);
    }
    const retained = fileFd === null
      ? windowsRetainedLeafIdentity(fileHandle!, `${parent.path}/${name}`, 'file', label)
      : (() => {
          const value = fstatSync(fileFd!, { bigint: true });
          if (!value.isFile() || value.nlink !== 1n) {
            throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} anchor is not one ordinary file.`);
          }
          return { device: String(value.dev), inode: String(value.ino) };
        })();
    if (fileHandle !== null && windowsRetainedOrdinaryFileLinkCount(fileHandle, label) !== 1) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} anchor has an unexpected link.`);
    }
    const named = inspectNoFollowOrdinaryFileEntry(parent, name, { maximumBytes: MAXIMUM_ANCHOR_BYTES });
    if (retained.device !== expectedPhysical.device || retained.inode !== expectedPhysical.inode
      || named === null || named.bytes === null || named.device !== retained.device
      || named.inode !== retained.inode || !Buffer.from(named.bytes).equals(bytes)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} anchor binding changed.`);
    }
  };
  const dispose = (): void => {
    if (closed) {
      if (closeFailure !== undefined) throw closeFailure;
      return;
    }
    closed = true;
    const failures: unknown[] = [];
    if (acquired) {
      try {
        if (fileFd !== null) linuxReleaseExclusiveFileGuard(fileFd, label);
        else if (fileHandle !== null) windowsReleaseExclusiveFileGuard(fileHandle, label);
      } catch (error) { failures.push(error); }
    }
    for (const descriptor of [fileFd, parentFd, rootFd]) {
      if (descriptor !== null) try { closeSync(descriptor); } catch (error) { failures.push(error); }
    }
    for (const handle of [fileHandle, parentHandle]) {
      if (handle !== null) try { closeWindowsHandle(handle); } catch (error) { failures.push(error); }
    }
    fileFd = parentFd = rootFd = null;
    fileHandle = parentHandle = null;
    if (failures.length > 0) {
      closeFailure = failures.length === 1 ? failures[0] : new AggregateError(failures, `${label} settlement failed.`);
      throw closeFailure;
    }
  };
  try {
    if (process.platform === 'linux') {
      const directory = linuxOpenRetainedAbsoluteDirectory(parent.path, label);
      rootFd = directory.filesystemRootFd;
      parentFd = directory.directoryFd;
      fileFd = linuxRaiseDescriptorFloor(linuxOpenReadableLeafAt(parentFd, name, label), label);
      assertCurrent();
      acquired = linuxTryExclusiveFileGuard(fileFd, label);
    } else if (process.platform === 'win32') {
      parentHandle = windowsOpenDirectory(parent.path, label);
      const absolutePath = `${parent.path}/${name}`;
      fileHandle = windowsOpenRelativeLeaf(
        parentHandle, parent, name, absolutePath, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, label
      );
      if (fileHandle === null) {
        throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} anchor is absent.`);
      }
      assertCurrent();
      acquired = windowsTryExclusiveFileGuard(fileHandle, windowsIdentity(parentHandle, parent.path, label).finalPath, label);
    } else {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} native platform is unsupported.`);
    }
    if (!acquired) { dispose(); return null; }
    // Mandatory post-lock readback rejects an opener detached while waiting.
    assertCurrent();
    const guard = Object.freeze({ physical: Object.freeze({ ...expectedPhysical }), assertCurrent, dispose });
    if (protectedResourceName !== undefined) {
      issuedGuardResources.set(guard, Object.freeze({ parent: Object.freeze({ ...parent }), name: protectedResourceName }));
    }
    return guard;
  } catch (error) {
    try { dispose(); } catch (settlement) {
      throw new AggregateError([error, settlement], `${label} admission and settlement failed.`);
    }
    throw error;
  }
}
