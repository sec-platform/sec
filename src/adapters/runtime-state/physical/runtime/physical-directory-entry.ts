import { randomUUID } from 'node:crypto';
import { closeSync } from 'node:fs';
import path from 'node:path';

import { assertSameNoFollowDirectoryIdentity } from './physical-directory-chain.ts';
import {
  PhysicalNoFollowError,
  type LinuxNoFollowDirectoryCreateRaceActor,
  type PhysicalDirectoryIdentity
} from './physical-no-follow-contract.ts';
import {
  WINDOWS_FILE_CREATE, WINDOWS_FILE_OPEN, closeWindowsHandle,
  linuxCloseDirectoryCreateTransaction, linuxDirectoryCreateTransactionWitness,
  linuxIdentity, linuxOpenAt, linuxOpenOrCreateDirectoryAt,
  linuxOpenRetainedAbsoluteDirectory, linuxOpenWatchedCanonicalDirectoryChain,
  windowsFlushRetainedDirectory, windowsIdentity, windowsOpenDirectory,
  windowsOpenRelativeDirectory
} from './physical-no-follow-native.ts';
import {
  ensureLeafName, ensureOrdinaryDirectorySegment, physicalError, sameIdentity
} from './physical-no-follow-shared.ts';

/** Relative directory entry observation and exclusive operation-owned creation. */

function inspectNoFollowDirectoryChildInternal(
  parentInput: PhysicalDirectoryIdentity,
  name: string,
  label: string
): PhysicalDirectoryIdentity | null {
  const parent = assertSameNoFollowDirectoryIdentity(parentInput, `${label} parent`).target;
  const absolutePath = path.join(parent.path, name);
  if (process.platform === 'linux') {
    const retained = linuxOpenRetainedAbsoluteDirectory(parent.path, `${label} parent`);
    let childFd: number | null = null;
    try {
      if (!sameIdentity(parent, linuxIdentity(retained.directoryFd, parent.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed before relative open.`);
      }
      try {
        childFd = linuxOpenAt(retained.directoryFd, name, label);
      } catch (error) {
        if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
        throw error;
      }
      const child = linuxIdentity(childFd, absolutePath);
      if (!sameIdentity(parent, linuxIdentity(retained.directoryFd, parent.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during relative open.`);
      }
      return child;
    } finally {
      if (childFd !== null) closeSync(childFd);
      if (retained.directoryFd !== retained.filesystemRootFd) closeSync(retained.directoryFd);
      closeSync(retained.filesystemRootFd);
    }
  }
  if (process.platform === 'win32') {
    const parentHandle = windowsOpenDirectory(parent.path, `${label} parent`, true);
    let childHandle: bigint | null = null;
    try {
      if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, `${label} parent`))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed before relative open.`);
      }
      childHandle = windowsOpenRelativeDirectory(
        parentHandle,
        parent,
        name,
        absolutePath,
        WINDOWS_FILE_OPEN,
        label
      );
      return childHandle === null ? null : windowsIdentity(childHandle, absolutePath, label);
    } finally {
      if (childHandle !== null) closeWindowsHandle(childHandle);
      closeWindowsHandle(parentHandle);
    }
  }
  throw physicalError(
    'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
    'Retained no-follow directory child inspection is unavailable on this platform.'
  );
}

/**
 * Inspects one canonical lowercase namespace child relative to a proven
 * parent.  Namespace identifiers remain deliberately narrower than ordinary
 * filesystem leaf names.
 */
export function inspectNoFollowDirectoryChild(
  parentInput: PhysicalDirectoryIdentity,
  name: string,
  label = 'No-follow directory child'
): PhysicalDirectoryIdentity | null {
  if (!/^[a-z0-9-]+$/u.test(name)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} name is invalid.`);
  }
  return inspectNoFollowDirectoryChildInternal(parentInput, name, label);
}

/**
 * Inspects one ordinary directory leaf relative to a proven parent.  This is
 * the control-file counterpart to the narrower namespace-child operation:
 * dot-prefixed canonical owner names are supported, while path traversal is
 * rejected and the retained native handle never escapes this physical owner.
 */
export function inspectNoFollowDirectoryLeaf(
  parentInput: PhysicalDirectoryIdentity,
  name: string,
  label = 'No-follow directory leaf'
): PhysicalDirectoryIdentity | null {
  ensureLeafName(name);
  return inspectNoFollowDirectoryChildInternal(parentInput, name, label);
}

/**
 * Creates exactly one absent ordinary directory relative to a retained parent.
 * Existing names are never adopted: an EEXIST/name collision is a foreign
 * effect boundary, not a successful retry.
 */
export function createExclusiveNoFollowDirectory(
  parentInput: PhysicalDirectoryIdentity,
  name: string,
  testOnlyRaceActor?: LinuxNoFollowDirectoryCreateRaceActor,
  creationMode = 0o700
): PhysicalDirectoryIdentity {
  // POSIX mode applies only to a newly created directory; the kernel retains
  // its umask/default-ACL inheritance. Windows keeps its inherited ACL;
  // this parameter never changes an existing object's permissions.
  if (!Number.isSafeInteger(creationMode) || creationMode < 0 || creationMode > 0o777) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Exclusive no-follow directory creation mode is invalid.');
  }
  // Random operation-owned names use the ordinary namespace's dot-bearing
  // prefixes (for example `c.staging-*`).  Keep one component validator for
  // both callers so the exclusive effect does not accidentally reject a
  // canonical generated name or grow a weaker second validation rule.
  ensureOrdinaryDirectorySegment(name);
  const parentChain = assertSameNoFollowDirectoryIdentity(
    parentInput,
    'Exclusive no-follow directory parent'
  );
  const parent = parentChain.target;
  const absolutePath = path.join(parent.path, name);
  if (process.platform === 'linux') {
    const transaction = linuxOpenWatchedCanonicalDirectoryChain(
      parentChain,
      'Exclusive no-follow directory parent',
      testOnlyRaceActor
    );
    let childFd: number | null = null;
    try {
      const opened = linuxOpenOrCreateDirectoryAt({
        parentFd: transaction.currentFd,
        parent,
        witness: linuxDirectoryCreateTransactionWitness(transaction),
        name,
        absolutePath,
        allowExisting: false,
        creationMode,
        label: 'Exclusive no-follow directory',
        testOnlyRaceActor
      });
      childFd = opened.fd;
      return opened.identity;
    } finally {
      if (childFd !== null) closeSync(childFd);
      linuxCloseDirectoryCreateTransaction(transaction);
    }
  }
  if (process.platform === 'win32') {
    const parentHandle = windowsOpenDirectory(parent.path, 'Exclusive no-follow directory parent', true);
    let childHandle: bigint | null = null;
    try {
      if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'Exclusive no-follow directory parent'))) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
          'Exclusive no-follow directory parent changed before relative create.'
        );
      }
      childHandle = windowsOpenRelativeDirectory(
        parentHandle,
        parent,
        name,
        absolutePath,
        WINDOWS_FILE_CREATE,
        'Exclusive no-follow directory'
      );
      if (childHandle === null) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Exclusive no-follow directory name already exists.');
      }
      const child = windowsIdentity(childHandle, absolutePath, 'Exclusive no-follow directory');
      windowsFlushRetainedDirectory(parentHandle, parent, 'Exclusive no-follow directory parent');
      return child;
    } finally {
      if (childHandle !== null) closeWindowsHandle(childHandle);
      closeWindowsHandle(parentHandle);
    }
  }
  throw physicalError(
    'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
    'Retained exclusive no-follow directory creation is unavailable on this platform.'
  );
}

/**
 * Allocates one operation-owned random child beneath a retained parent.  The
 * parent is reopened/retained by the exclusive primitive for the actual
 * mkdir, so a caller's earlier lexical fence cannot redirect the effect into
 * a replacement junction/reparse directory.  A bounded collision retry is
 * allowed only for the generated name; no existing child is ever adopted.
 */
export function createExclusiveNoFollowRandomDirectory(
  parentInput: PhysicalDirectoryIdentity,
  prefix: string,
  maximumAttempts = 8
): PhysicalDirectoryIdentity {
  ensureOrdinaryDirectorySegment(prefix);
  if (!prefix.endsWith('-') || !Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 64) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Exclusive random no-follow directory allocation arguments are invalid.');
  }
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const name = `${prefix}${randomUUID().replaceAll('-', '').slice(0, 6)}`;
    try {
      return createExclusiveNoFollowDirectory(parentInput, name);
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') {
        // The generated name may have collided with a foreign child.  The
        // exclusive primitive never adopted it; try another bounded name.
        continue;
      }
      throw error;
    }
  }
  throw physicalError(
    'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
    'Exclusive random no-follow directory allocation exhausted its collision bound.'
  );
}
