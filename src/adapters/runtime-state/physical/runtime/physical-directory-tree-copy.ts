import {
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  readSync,
  writeSync
} from 'node:fs';
import path from 'node:path';

import {
  assertPhysicallyDisjointDirectoryChains,
  assertSameNoFollowDirectoryIdentity,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  samePhysicalObject
} from './physical-directory-chain.ts';
import {
  copyInventoryRelativePathExcluded,
  directoryTreeEntryPosixOwnership,
  projectNoFollowDirectoryTreeInventoryEntry,
  scanNoFollowDirectoryTreeInternal
} from './physical-directory-tree-observation.ts';
import {
  PhysicalNoFollowError,
  type NoFollowDirectoryTreeCopyOptions,
  type NoFollowDirectoryTreeCopyRoot,
  type NoFollowDirectoryTreeInventoryEntry,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from './physical-no-follow-contract.ts';
import {
  closeLinuxDescriptorsBestEffort,
  closeWindowsHandle,
  closeWindowsHandlesBestEffort,
  LINUX_O_CLOEXEC,
  LINUX_O_CREAT,
  LINUX_O_EXCL,
  LINUX_O_NOFOLLOW,
  LINUX_O_WRONLY,
  linuxErrno,
  linuxIdentity,
  linuxOpenAt,
  linuxOpenReadableLeafAt,
  linuxOpenRoot,
  linuxRaiseDescriptorFloor,
  requireLinuxLibc,
  requireWindowsKernel32,
  streamCanonicalHexContentDigest,
  WINDOWS_FILE_CREATE,
  WINDOWS_FILE_OPEN,
  WINDOWS_GENERIC_READ,
  WINDOWS_GENERIC_WRITE,
  WINDOWS_SHARE_READ,
  windowsIdentity,
  windowsOpenDirectory,
  windowsOpenPinnedReadDirectory,
  windowsOpenRelativeDirectory,
  windowsOpenRelativeLeaf,
  windowsRetainedFileSnapshot,
  windowsRetainedLeafIdentity,
  windowsWriteRetainedChunk,
  type WindowsBulkDirectoryHandle
} from './physical-no-follow-native.ts';
import {
  ensureLeafName,
  physicalError,
  requireAbsoluteDirectoryPath,
  sameIdentity
} from './physical-no-follow-shared.ts';

/** Physical directory-tree copy/materialization orchestration over retained native handles. */

function copyInventoryRelativePathIncluded(
  relativePath: string,
  skipNestedNodeModules: boolean,
  includeRelativePaths?: ReadonlySet<string>,
  excludeRelativePaths?: ReadonlySet<string>
): boolean {
  if (copyInventoryRelativePathExcluded(relativePath, excludeRelativePaths)) return false;
  if (skipNestedNodeModules && relativePath.split('/').includes('node_modules')) return false;
  if (includeRelativePaths === undefined || relativePath.length === 0) return true;
  for (const included of includeRelativePaths) {
    if (relativePath === included || relativePath.startsWith(`${included}/`) || included.startsWith(`${relativePath}/`)) {
      return true;
    }
  }
  return false;
}

function comparableCopyInventory(
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[],
  skipNestedNodeModules: boolean,
  includeRelativePaths?: ReadonlySet<string>,
  excludeRelativePaths?: ReadonlySet<string>
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  return Object.freeze(inventory
    .filter(({ relativePath }) => copyInventoryRelativePathIncluded(
      relativePath,
      skipNestedNodeModules,
      includeRelativePaths,
      excludeRelativePaths
    )));
}

function copyTargetCoveredByExcludedSourceSubtree(
  sourcePath: string,
  targetPath: string,
  excludeRelativePaths?: ReadonlySet<string>
): boolean {
  if (excludeRelativePaths === undefined) return false;
  const relative = path.relative(path.resolve(sourcePath), path.resolve(targetPath));
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return false;
  }
  return copyInventoryRelativePathExcluded(relative.split(path.sep).join('/'), excludeRelativePaths);
}

type CopyPermissionComparison = 'none' | 'files' | 'all';

function sameCopyInventory(
  left: readonly NoFollowDirectoryTreeInventoryEntry[],
  right: readonly NoFollowDirectoryTreeInventoryEntry[],
  permissionComparison: CopyPermissionComparison,
  comparison: 'materialized-target' | 'source-reobservation'
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    const comparePermission = permissionComparison === 'all' ||
      (permissionComparison === 'files' && a.kind === 'file');
    // Directory st_size describes filesystem storage, not copied contents.
    // Keep it in the same-source drift fence, but compare a new directory by
    // its complete membership and requested metadata instead.
    const compareSize = comparison === 'source-reobservation' || a.kind !== 'directory';
    if (a.relativePath !== b.relativePath || a.kind !== b.kind || (compareSize && a.size !== b.size) ||
        a.contentDigest !== b.contentDigest || a.linkTarget !== b.linkTarget ||
        (comparePermission && a.permissionMode !== b.permissionMode)) return false;
    if (comparePermission && ((a.permissionMode ?? 0) & 0o7000) !== 0) {
      const aOwnership = directoryTreeEntryPosixOwnership(a);
      const bOwnership = directoryTreeEntryPosixOwnership(b);
      if (aOwnership === undefined || bOwnership === undefined ||
          aOwnership.ownerUserId !== bOwnership.ownerUserId ||
          aOwnership.ownerGroupId !== bOwnership.ownerGroupId) return false;
    }
  }
  return true;
}

function locateNoFollowExistingDirectoryAncestor(
  directoryPath: string,
  label: string
): Readonly<{
  readonly ancestor: PhysicalDirectoryIdentity;
  readonly segments: readonly string[];
}> {
  let cursor = path.resolve(directoryPath);
  const segments: string[] = [];
  for (;;) {
    try {
      return Object.freeze({
        ancestor: inspectNoFollowDirectoryChain(cursor, `${label} ancestor`).target,
        segments: Object.freeze(segments)
      });
    } catch (error) {
      if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} has no physical ancestor.`);
      }
      segments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function lexicalPathOverlap(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value).replaceAll('\\', '/');
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
  };
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizedCopyIncludePaths(
  values: readonly string[] | undefined
): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  const normalized = values.map((value) => value.replaceAll('\\', '/'));
  if (normalized.some((value) => value.length === 0 || path.isAbsolute(value) ||
      value.split('/').some((segment) => segment === '..' || segment.length === 0))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy include paths are not safe relative paths.');
  }
  return new Set(normalized);
}

function normalizedCopyExcludePaths(
  values: readonly string[] | undefined
): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  const normalized = values.map((value) => value.replaceAll('\\', '/'));
  if (normalized.some((value) => value.length === 0 || path.isAbsolute(value) ||
      value.split('/').some((segment) => segment === '..' || segment.length === 0))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy exclude paths are not safe relative paths.');
  }
  return new Set(normalized);
}

export interface LinuxBulkDirectoryHandle {
  readonly fd: number;
  readonly identity: PhysicalDirectoryIdentity;
}

export interface LinuxBulkDirectoryChain {
  readonly directories: readonly LinuxBulkDirectoryHandle[];
  readonly target: LinuxBulkDirectoryHandle;
  assertCurrent(): void;
  dispose(): void;
}

export function linuxRetainBulkDirectoryChain(
  expected: PhysicalDirectoryChain,
  label: string
): LinuxBulkDirectoryChain {
  const openedRootFd = linuxOpenRoot(label);
  let filesystemRootFd: number;
  try {
    filesystemRootFd = linuxRaiseDescriptorFloor(openedRootFd, label);
  } catch (error) {
    closeLinuxDescriptorsBestEffort([openedRootFd], label);
    throw error;
  }
  const handles: LinuxBulkDirectoryHandle[] = [];
  let currentFd = filesystemRootFd;
  let currentPath = path.parse(expected.target.path).root;
  let disposed = false;
  try {
    // Ordinary-file consumers close the returned directories directly. The
    // root must belong to this same collection, not only to dispose().
    handles.push({ fd: filesystemRootFd, identity: linuxIdentity(filesystemRootFd, currentPath) });
    const segments = expected.target.path.slice(currentPath.length).split('/').filter(Boolean);
    if (segments.length === 0) {
      const identity = linuxIdentity(currentFd, expected.target.path);
      if (expected.ancestors.length !== 1 || !sameIdentity(identity, expected.target) ||
          !sameIdentity(identity, expected.ancestors[0]!)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} root identity changed.`);
      }
    } else {
      if (expected.ancestors.length !== segments.length) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} chain shape changed.`);
      }
      for (const [index, segment] of segments.entries()) {
        const openedFd = linuxOpenAt(currentFd, segment, label);
        let nextFd = openedFd;
        try {
          nextFd = linuxRaiseDescriptorFloor(openedFd, label);
        } catch (error) {
          try { closeSync(openedFd); } catch { /* retain the primary capability error */ }
          throw error;
        }
        currentFd = nextFd;
        currentPath = path.join(currentPath, segment);
        const identity = linuxIdentity(currentFd, currentPath);
        if (!sameIdentity(identity, expected.ancestors[index]!)) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
        }
        handles.push({ fd: currentFd, identity });
      }
    }
    const target = handles.at(-1)!;
    if (!sameIdentity(target.identity, expected.target)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} target identity changed.`);
    }
    const assertCurrent = (): void => {
      if (disposed) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} directory chain is disposed.`);
      for (const handle of handles) {
        if (!sameIdentity(handle.identity, linuxIdentity(handle.fd, handle.identity.path))) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity changed.`);
        }
      }
    };
    return Object.freeze({
      directories: Object.freeze(handles),
      target,
      assertCurrent,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const closeError = closeLinuxDescriptorsBestEffort(
          [...handles].reverse().map((handle) => handle.fd),
          label
        );
        if (closeError !== null) throw closeError;
      }
    });
  } catch (error) {
    closeLinuxDescriptorsBestEffort([
      currentFd,
      ...[...handles].reverse().map((entry) => entry.fd),
      filesystemRootFd
    ], label);
    throw error;
  }
}

export interface WindowsBulkDirectoryChain {
  readonly directories: readonly WindowsBulkDirectoryHandle[];
  readonly target: WindowsBulkDirectoryHandle;
  assertCurrent(): void;
  dispose(): void;
}

export function windowsRetainBulkDirectoryChain(
  expected: PhysicalDirectoryChain,
  label: string
): WindowsBulkDirectoryChain {
  const parsed = path.win32.parse(expected.target.path);
  let currentPath = parsed.root;
  const paths: string[] = [];
  for (const segment of expected.target.path.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean)) {
    currentPath = path.win32.join(currentPath, segment);
    paths.push(currentPath);
  }
  if (paths.length === 0) paths.push(expected.target.path);
  if (paths.length !== expected.ancestors.length) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} chain shape changed.`);
  }
  const handles: WindowsBulkDirectoryHandle[] = [];
  let pendingHandle: bigint | null = null;
  let disposed = false;
  try {
    for (const [index, current] of paths.entries()) {
      // Withhold delete sharing on every ancestor, not just the final two.
      // The child-process capability is intentionally weaker for ordinary
      // readers; this operation owns a write destination and needs lexical
      // path use to remain anchored for its whole effect.
      const ancestorLabel = `${label} ancestor[${index}] ${current}`;
      const handle = windowsOpenPinnedReadDirectory(current, ancestorLabel);
      pendingHandle = handle;
      const identity = windowsIdentity(handle, current, ancestorLabel);
      if (!sameIdentity(identity, expected.ancestors[index]!)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
      }
      handles.push({ handle, identity });
      pendingHandle = null;
    }
    const target = handles.at(-1)!;
    if (!sameIdentity(target.identity, expected.target)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} target identity changed.`);
    }
    const assertCurrent = (): void => {
      if (disposed) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} directory chain is disposed.`);
      for (const entry of handles) {
        if (!sameIdentity(entry.identity, windowsIdentity(entry.handle, entry.identity.path, label))) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity changed.`);
        }
      }
    };
    return Object.freeze({
      directories: Object.freeze(handles),
      target,
      assertCurrent,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const closeError = closeWindowsHandlesBestEffort(
          [...handles].reverse().map((entry) => entry.handle),
          label
        );
        if (closeError !== null) throw closeError;
      }
    });
  } catch (error) {
    closeWindowsHandlesBestEffort(
      [...(pendingHandle === null ? [] : [pendingHandle]), ...[...handles].reverse().map((entry) => entry.handle)],
      label
    );
    throw error;
  }
}

/**
 * Retains handle identities for a read-only source chain while continuing to
 * share delete access.  This is intentionally weaker than a destination/copy
 * pin: the caller must perform a final lexical-chain readback before it
 * publishes authority.  It is appropriate for a junction source because the
 * junction stores a path and the final path-to-object equality is the actual
 * invariant; temporarily excluding Git/AV delete handles adds no authority
 * and makes the read boundary spuriously unavailable.
 */
export function windowsRetainObservedDirectoryChain(
  expected: PhysicalDirectoryChain,
  label: string
): WindowsBulkDirectoryChain {
  const parsed = path.win32.parse(expected.target.path);
  let currentPath = parsed.root;
  const paths: string[] = [];
  for (const segment of expected.target.path.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean)) {
    currentPath = path.win32.join(currentPath, segment);
    paths.push(currentPath);
  }
  if (paths.length === 0) paths.push(expected.target.path);
  if (paths.length !== expected.ancestors.length) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} chain shape changed.`);
  }
  const handles: WindowsBulkDirectoryHandle[] = [];
  let pendingHandle: bigint | null = null;
  let disposed = false;
  try {
    for (const [index, current] of paths.entries()) {
      const ancestorLabel = `${label} ancestor[${index}] ${current}`;
      const handle = windowsOpenDirectory(current, ancestorLabel);
      pendingHandle = handle;
      const identity = windowsIdentity(handle, current, ancestorLabel);
      if (!sameIdentity(identity, expected.ancestors[index]!)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
      }
      handles.push({ handle, identity });
      pendingHandle = null;
    }
    const target = handles.at(-1)!;
    const assertCurrent = (): void => {
      if (disposed) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} directory chain is disposed.`);
      for (const entry of handles) {
        if (!sameIdentity(entry.identity, windowsIdentity(entry.handle, entry.identity.path, label))) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity changed.`);
        }
      }
      const lexical = inspectNoFollowDirectoryChain(expected.target.path, `${label} lexical readback`);
      if (lexical.ancestors.length !== expected.ancestors.length ||
          lexical.ancestors.some((entry, index) => !sameIdentity(entry, expected.ancestors[index]!))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} lexical chain changed.`);
      }
    };
    assertCurrent();
    return Object.freeze({
      directories: Object.freeze(handles),
      target,
      assertCurrent,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const closeError = closeWindowsHandlesBestEffort(
          [...handles].reverse().map((entry) => entry.handle),
          label
        );
        if (closeError !== null) throw closeError;
      }
    });
  } catch (error) {
    closeWindowsHandlesBestEffort(
      [...(pendingHandle === null ? [] : [pendingHandle]), ...[...handles].reverse().map((entry) => entry.handle)],
      label
    );
    throw error;
  }
}

function linuxCreateBulkDirectory(
  parent: LinuxBulkDirectoryHandle,
  name: string,
  absolutePath: string,
  label: string
): LinuxBulkDirectoryHandle {
  ensureLeafName(name);
  if (requireLinuxLibc().symbols.mkdirat(
    parent.fd,
    Buffer.from(`${name}\0`, 'utf8'),
    0o700
  ) !== 0) {
    const errno = linuxErrno();
    if (errno === 17) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} destination already exists.`);
    }
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} mkdirat failed (errno ${errno}).`);
  }
  const childFd = linuxOpenAt(parent.fd, name, label);
  try {
    const identity = linuxIdentity(childFd, absolutePath);
    if (requireLinuxLibc().symbols.fsync(parent.fd) !== 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} parent fsync failed.`);
    }
    return Object.freeze({ fd: childFd, identity });
  } catch (error) {
    closeSync(childFd);
    throw error;
  }
}

function linuxCreateBulkFile(
  parent: LinuxBulkDirectoryHandle,
  name: string,
  label: string
): number {
  ensureLeafName(name);
  const fd = requireLinuxLibc().symbols.openat(
    parent.fd,
    Buffer.from(`${name}\0`, 'utf8'),
    LINUX_O_WRONLY | LINUX_O_CLOEXEC | LINUX_O_CREAT | LINUX_O_EXCL | LINUX_O_NOFOLLOW,
    0o600
  );
  if (fd < 0) {
    const errno = linuxErrno();
    if (errno === 17) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} destination already exists.`);
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} file create failed (errno ${errno}).`);
  }
  return fd;
}

function windowsCreateBulkDirectory(
  parent: WindowsBulkDirectoryHandle,
  name: string,
  absolutePath: string,
  label: string
): WindowsBulkDirectoryHandle {
  ensureLeafName(name);
  const handle = windowsOpenRelativeDirectory(
    parent.handle,
    parent.identity,
    name,
    absolutePath,
    WINDOWS_FILE_CREATE,
    label,
    WINDOWS_SHARE_READ
  );
  if (handle === null) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} destination already exists.`);
  }
  try {
    const identity = windowsIdentity(handle, absolutePath, label);
    return Object.freeze({ handle, identity });
  } catch (error) {
    closeWindowsHandle(handle);
    throw error;
  }
}

function windowsCreateBulkFile(
  parent: WindowsBulkDirectoryHandle,
  name: string,
  absolutePath: string,
  label: string
): bigint {
  ensureLeafName(name);
  const handle = windowsOpenRelativeLeaf(
    parent.handle,
    parent.identity,
    name,
    absolutePath,
    WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE,
    WINDOWS_FILE_CREATE,
    label,
    false,
    WINDOWS_SHARE_READ,
    true
  );
  if (handle === null) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} destination already exists.`);
  }
  return handle;
}

function copyLinuxBulkFile(
  sourceParent: LinuxBulkDirectoryHandle,
  targetParent: LinuxBulkDirectoryHandle,
  entry: NoFollowDirectoryTreeInventoryEntry,
  name: string,
  assertDeadline: () => void,
  label: string,
  preservePermissionMode: boolean,
  rejectHardLinks: boolean
): void {
  const sourceFd = linuxOpenReadableLeafAt(sourceParent.fd, name, label);
  let targetFd: number | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const before = fstatSync(sourceFd, { bigint: true });
    if (!before.isFile() || String(before.dev) !== entry.device || String(before.ino) !== entry.inode ||
        before.size !== BigInt(entry.size) || (preservePermissionMode &&
          Number(before.mode & 0o7777n) !== requiredPermissionMode(entry, label))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed before copy.`);
    }
    if (rejectHardLinks && before.nlink !== 1n) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} source has another hard-link name.`);
    }
    targetFd = linuxCreateBulkFile(targetParent, name, label);
    const result = streamCanonicalHexContentDigest((chunk) => {
      assertDeadline();
      const count = readSync(sourceFd, chunk, 0, chunk.byteLength, null);
      let written = 0;
      while (written < count) {
        const current = writeSync(targetFd!, chunk, written, count - written, null);
        if (current <= 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} short target write.`);
        written += current;
      }
      return count;
    }, before.size, label);
    if (entry.contentDigest === null || result.contentDigest !== entry.contentDigest) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source content changed during copy.`);
    }
    if (preservePermissionMode) {
      fchmodSync(targetFd, permissionModeForCopiedTarget(
        entry,
        before,
        fstatSync(targetFd, { bigint: true }),
        label
      ));
    }
    const after = fstatSync(sourceFd, { bigint: true });
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.nlink !== before.nlink ||
        after.mode !== before.mode || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed during copy.`);
    }
    if (fsyncSync(targetFd) !== undefined) {
      // fsyncSync either completes or throws.  The branch keeps the effect
      // boundary explicit without treating a truthy return as authority.
    }
    const targetStat = fstatSync(targetFd, { bigint: true });
    const expectedTargetMode = preservePermissionMode
      ? permissionModeForCopiedTarget(entry, after, targetStat, label)
      : null;
    if (!targetStat.isFile() || targetStat.size !== before.size || (preservePermissionMode &&
        Number(targetStat.mode & 0o7777n) !== expectedTargetMode)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} target readback differs.`);
    }
  } catch (error) {
    primaryFailure = { error };
    throw error;
  } finally {
    const closeError = closeLinuxDescriptorsBestEffort([sourceFd, ...(targetFd === null ? [] : [targetFd])], label);
    if (closeError !== null) {
      if (primaryFailure !== undefined) throw new AggregateError([primaryFailure.error, closeError], `${label} copy and settlement failed.`);
      throw closeError;
    }
  }
}

function requiredPermissionMode(entry: NoFollowDirectoryTreeInventoryEntry, label: string): number {
  if (!Number.isSafeInteger(entry.permissionMode) || entry.permissionMode! < 0 || entry.permissionMode! > 0o7777) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} permission mode is invalid.`);
  }
  return entry.permissionMode!;
}

function permissionModeForCopiedTarget(
  sourceEntry: NoFollowDirectoryTreeInventoryEntry,
  source: Readonly<{ gid: bigint; uid: bigint }>,
  target: Readonly<{ gid: bigint; mode: bigint; uid: bigint }>,
  label: string
): number {
  const mode = requiredPermissionMode(sourceEntry, label);
  if ((mode & 0o7000) === 0) return mode;
  const sourceOwnership = directoryTreeEntryPosixOwnership(sourceEntry);
  const effectiveUserId = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid())
    : null;
  if (sourceOwnership === undefined || effectiveUserId === null ||
      sourceOwnership.ownerUserId !== source.uid || sourceOwnership.ownerGroupId !== source.gid ||
      source.uid !== effectiveUserId || target.uid !== effectiveUserId || source.gid !== target.gid) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} cannot preserve special permission bits without same-owner source and target descriptors.`
    );
  }
  return mode;
}

function permissionModeForCopiedRoot(
  source: Readonly<{ gid: bigint; mode: bigint; uid: bigint }>,
  target: Readonly<{ gid: bigint; mode: bigint; uid: bigint }>
): number {
  const mode = Number(source.mode & 0o7777n);
  if ((mode & 0o7000) === 0) return mode;
  const effectiveUserId = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid())
    : null;
  if (effectiveUserId === null || source.uid !== effectiveUserId || target.uid !== effectiveUserId ||
      source.gid !== target.gid) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'No-follow bulk target root cannot preserve special permission bits without same-owner source and target descriptors.'
    );
  }
  return mode;
}

function copyWindowsBulkFile(
  sourceParent: WindowsBulkDirectoryHandle,
  targetParent: WindowsBulkDirectoryHandle,
  entry: NoFollowDirectoryTreeInventoryEntry,
  name: string,
  absoluteTargetPath: string,
  assertDeadline: () => void,
  label: string,
  rejectHardLinks: boolean
): void {
  const sourceHandle = windowsOpenRelativeLeaf(
    sourceParent.handle,
    sourceParent.identity,
    name,
    path.join(sourceParent.identity.path, name),
    WINDOWS_GENERIC_READ,
    WINDOWS_FILE_OPEN,
    label,
    false,
    WINDOWS_SHARE_READ
  );
  if (sourceHandle === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} source is absent.`);
  let targetHandle: bigint | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const sourceIdentity = windowsRetainedLeafIdentity(
      sourceHandle,
      path.join(sourceParent.identity.path, name),
      'file',
      label
    );
    const before = windowsRetainedFileSnapshot(sourceHandle, label);
    if (sourceIdentity.device !== entry.device || sourceIdentity.inode !== entry.inode ||
        before.size !== BigInt(entry.size)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed before copy.`);
    }
    if (rejectHardLinks && before.linkCount !== 1) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} source has another hard-link name.`);
    }
    targetHandle = windowsCreateBulkFile(targetParent, name, absoluteTargetPath, label);
    const library = requireWindowsKernel32();
    const received = Buffer.alloc(4);
    const result = streamCanonicalHexContentDigest((chunk) => {
      assertDeadline();
      if (library.symbols.ReadFile(sourceHandle, chunk, chunk.byteLength, received, null) === 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} source read failed (Win32 ${library.symbols.GetLastError()}).`);
      }
      const count = received.readUInt32LE(0);
      if (count > 0) windowsWriteRetainedChunk(targetHandle!, chunk.subarray(0, count), label);
      return count;
    }, before.size, label);
    if (entry.contentDigest === null || result.contentDigest !== entry.contentDigest) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source content changed during copy.`);
    }
    const after = windowsRetainedFileSnapshot(sourceHandle, label);
    const afterIdentity = windowsRetainedLeafIdentity(
      sourceHandle,
      path.join(sourceParent.identity.path, name),
      'file',
      label
    );
    if (after.basic !== before.basic || after.size !== before.size || after.linkCount !== before.linkCount ||
        afterIdentity.device !== entry.device || afterIdentity.inode !== entry.inode) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed during copy.`);
    }
    if (requireWindowsKernel32().symbols.FlushFileBuffers(targetHandle!) === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} target flush failed (Win32 ${requireWindowsKernel32().symbols.GetLastError()}).`);
    }
    const targetIdentity = windowsRetainedLeafIdentity(targetHandle!, absoluteTargetPath, 'file', label);
    const targetSnapshot = windowsRetainedFileSnapshot(targetHandle!, label);
    if (targetSnapshot.size !== before.size || targetIdentity.device.length === 0 || targetIdentity.inode.length === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} target readback differs.`);
    }
  } catch (error) {
    primaryFailure = { error };
    throw error;
  } finally {
    const closeError = closeWindowsHandlesBestEffort([sourceHandle, ...(targetHandle === null ? [] : [targetHandle])], label);
    if (closeError !== null) {
      if (primaryFailure !== undefined) throw new AggregateError([primaryFailure.error, closeError], `${label} copy and settlement failed.`);
      throw closeError;
    }
  }
}

async function copyNoFollowSingleTreeWithRetainedHandles(input: Readonly<{
  readonly source: PhysicalDirectoryChain;
  readonly target: string;
  readonly targetParent: PhysicalDirectoryChain;
  readonly sourceInventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  readonly maximumEntries: number;
  readonly assertDeadline: () => void;
  readonly preserveDirectoryPermissionMode: boolean;
  readonly preserveFilePermissionMode: boolean;
  readonly rejectHardLinks: boolean;
}>): Promise<void> {
  const entries = [...input.sourceInventory].sort((left, right) => {
    const depth = (value: string): number => value.split('/').length;
    return depth(left.relativePath) - depth(right.relativePath) ||
      left.relativePath.localeCompare(right.relativePath);
  });
  if (entries.length > input.maximumEntries) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow bulk copy effect entry bound exceeded.');
  }
  if (process.platform === 'linux') {
    const sourceChain = linuxRetainBulkDirectoryChain(input.source, 'No-follow bulk source');
    let targetParentChain: LinuxBulkDirectoryChain | undefined;
    const targetDirectories: LinuxBulkDirectoryHandle[] = [];
    let pendingSourceFd: number | null = null;
    let primaryFailure: Readonly<{ error: unknown }> | undefined;
    const sourceDirectories = new Map<string, LinuxBulkDirectoryHandle>([['', sourceChain.target]]);
    const targetDirectoryModes: Array<Readonly<{
      assertFinalOwnership: (target: Readonly<{ gid: bigint; mode: bigint; uid: bigint }>) => number;
      directory: LinuxBulkDirectoryHandle;
      mode: number;
    }>> = [];
    try {
      targetParentChain = linuxRetainBulkDirectoryChain(input.targetParent, 'No-follow bulk target parent');
      sourceChain.assertCurrent();
      targetParentChain.assertCurrent();
      const sourceRootBefore = fstatSync(sourceChain.target.fd, { bigint: true });
      if (!sourceRootBefore.isDirectory()) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk source root is no longer a directory.');
      }
      const targetRoot = linuxCreateBulkDirectory(
        targetParentChain.target,
        path.basename(input.target),
        input.target,
        'No-follow bulk target root'
      );
      targetDirectories.push(targetRoot);
      if (input.preserveDirectoryPermissionMode) {
        targetDirectoryModes.push(Object.freeze({
          assertFinalOwnership: (target) => {
            const source = fstatSync(sourceChain.target.fd, { bigint: true });
            if (source.uid !== sourceRootBefore.uid || source.gid !== sourceRootBefore.gid) {
              throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk source root ownership changed during copy.');
            }
            return permissionModeForCopiedRoot(source, target);
          },
          directory: targetRoot,
          mode: permissionModeForCopiedRoot(
            sourceRootBefore,
            fstatSync(targetRoot.fd, { bigint: true })
          )
        }));
      }
      const directoryByPath = new Map<string, LinuxBulkDirectoryHandle>([['', targetRoot]]);
      for (const entry of entries) {
        input.assertDeadline();
        const parts = entry.relativePath.split('/');
        const name = parts.pop()!;
        const parentPath = parts.join('/');
        const sourceParent = sourceDirectories.get(parentPath);
        if (sourceParent === undefined) {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk source parent is missing for ${entry.relativePath}.`);
        }
        const targetParent = directoryByPath.get(parentPath);
        if (targetParent === undefined) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk target parent is missing for ${entry.relativePath}.`);
        if (entry.kind === 'directory') {
          const sourceFd = linuxOpenAt(sourceParent.fd, name, 'No-follow bulk source directory');
          pendingSourceFd = sourceFd;
          const sourceIdentity = linuxIdentity(sourceFd, path.join(sourceParent.identity.path, name));
          if (sourceIdentity.device !== entry.device || sourceIdentity.inode !== entry.inode) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `No-follow bulk source directory changed for ${entry.relativePath}.`);
          }
          const sourceStat = fstatSync(sourceFd, { bigint: true });
          if (input.preserveFilePermissionMode &&
              Number(sourceStat.mode & 0o7777n) !== requiredPermissionMode(entry, 'No-follow bulk source directory')) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `No-follow bulk source directory mode changed for ${entry.relativePath}.`);
          }
          sourceDirectories.set(entry.relativePath, { fd: sourceFd, identity: sourceIdentity });
          pendingSourceFd = null;
          const child = linuxCreateBulkDirectory(targetParent, name, path.join(targetParent.identity.path, name), 'No-follow bulk target directory');
          targetDirectories.push(child);
          if (input.preserveDirectoryPermissionMode) {
            targetDirectoryModes.push(Object.freeze({
              assertFinalOwnership: (target) => permissionModeForCopiedTarget(
                entry,
                fstatSync(sourceFd, { bigint: true }),
                target,
                'No-follow bulk target directory readback'
              ),
              directory: child,
              mode: permissionModeForCopiedTarget(
                entry,
                sourceStat,
                fstatSync(child.fd, { bigint: true }),
                'No-follow bulk target directory'
              )
            }));
          }
          directoryByPath.set(entry.relativePath, child);
        } else if (entry.kind === 'file') {
          copyLinuxBulkFile(
            sourceParent,
            targetParent,
            entry,
            name,
            input.assertDeadline,
            'No-follow bulk file',
            input.preserveFilePermissionMode,
            input.rejectHardLinks
          );
        } else {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk source contains an unsupported link: ${entry.relativePath}.`);
        }
      }
      if (input.preserveDirectoryPermissionMode) {
        for (const target of [...targetDirectoryModes].reverse()) {
          input.assertDeadline();
          fchmodSync(target.directory.fd, target.mode);
          fsyncSync(target.directory.fd);
          const readback = fstatSync(target.directory.fd, { bigint: true });
          const expectedMode = target.assertFinalOwnership(readback);
          if (!readback.isDirectory() || expectedMode !== target.mode ||
              Number(readback.mode & 0o7777n) !== expectedMode) {
            throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'No-follow bulk target directory mode readback differs.');
          }
        }
        const sourceRootAfter = fstatSync(sourceChain.target.fd, { bigint: true });
        if (!sourceRootAfter.isDirectory() || sourceRootAfter.dev !== sourceRootBefore.dev ||
            sourceRootAfter.ino !== sourceRootBefore.ino || sourceRootAfter.mode !== sourceRootBefore.mode ||
            sourceRootAfter.uid !== sourceRootBefore.uid || sourceRootAfter.gid !== sourceRootBefore.gid) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk source root mode changed during copy.');
        }
      }
      sourceChain.assertCurrent();
      targetParentChain.assertCurrent();
    } catch (error) {
      primaryFailure = { error };
      if (input.preserveDirectoryPermissionMode) {
        // Mode publication is the last copy phase, but it can still fail after
        // an earlier directory became read-only. Restore owner-created target
        // directories to the copier's safe mode through their retained
        // descriptors so the caller's existing retirement path can remove the
        // incomplete tree without accepting a caller-supplied override.
        for (const target of targetDirectoryModes) {
          try { fchmodSync(target.directory.fd, 0o700); } catch { /* retain the primary copy failure */ }
        }
      }
      throw error;
    } finally {
      const closeError = closeLinuxDescriptorsBestEffort([
        ...(pendingSourceFd === null ? [] : [pendingSourceFd]),
        ...[...targetDirectories].reverse().map((entry) => entry.fd),
        ...[...sourceDirectories.values()].reverse().map((entry) => entry.fd),
        ...[...sourceChain.directories].reverse().map((entry) => entry.fd),
        ...[...(targetParentChain?.directories ?? [])].reverse().map((entry) => entry.fd)
      ], 'No-follow bulk copy settlement');
      if (closeError !== null) {
        if (primaryFailure !== undefined) throw new AggregateError([primaryFailure.error, closeError], 'No-follow bulk copy and settlement failed.');
        throw closeError;
      }
    }
    return;
  }
  if (process.platform === 'win32') {
    const sourceChain = windowsRetainBulkDirectoryChain(input.source, 'No-follow bulk source');
    let targetParentChain: WindowsBulkDirectoryChain | undefined;
    const targetDirectories: WindowsBulkDirectoryHandle[] = [];
    let pendingSourceHandle: bigint | null = null;
    let primaryFailure: Readonly<{ error: unknown }> | undefined;
    const sourceDirectories = new Map<string, WindowsBulkDirectoryHandle>([['', sourceChain.target]]);
    try {
      targetParentChain = windowsRetainBulkDirectoryChain(input.targetParent, 'No-follow bulk target parent');
      sourceChain.assertCurrent();
      targetParentChain.assertCurrent();
      const targetRoot = windowsCreateBulkDirectory(
        targetParentChain.target,
        path.basename(input.target),
        input.target,
        'No-follow bulk target root'
      );
      targetDirectories.push(targetRoot);
      const directoryByPath = new Map<string, WindowsBulkDirectoryHandle>([['', targetRoot]]);
      for (const entry of entries) {
        input.assertDeadline();
        const parts = entry.relativePath.split('/');
        const name = parts.pop()!;
        const parentPath = parts.join('/');
        const sourceParent = sourceDirectories.get(parentPath);
        if (sourceParent === undefined) {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk source parent is missing for ${entry.relativePath}.`);
        }
        const targetParent = directoryByPath.get(parentPath);
        if (targetParent === undefined) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk target parent is missing for ${entry.relativePath}.`);
        if (entry.kind === 'directory') {
          const sourcePath = path.join(sourceParent.identity.path, name);
          const next = windowsOpenRelativeDirectory(
            sourceParent.handle,
            sourceParent.identity,
            name,
            sourcePath,
            WINDOWS_FILE_OPEN,
            'No-follow bulk source directory',
            WINDOWS_SHARE_READ,
            true
          );
          if (next === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `No-follow bulk source directory disappeared for ${entry.relativePath}.`);
          pendingSourceHandle = next;
          const sourceIdentity = windowsIdentity(next, sourcePath, 'No-follow bulk source directory');
          if (sourceIdentity.device !== entry.device || sourceIdentity.inode !== entry.inode) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `No-follow bulk source directory changed for ${entry.relativePath}.`);
          }
          sourceDirectories.set(entry.relativePath, { handle: next, identity: sourceIdentity });
          pendingSourceHandle = null;
          const child = windowsCreateBulkDirectory(targetParent, name, path.join(targetParent.identity.path, name), 'No-follow bulk target directory');
          targetDirectories.push(child);
          directoryByPath.set(entry.relativePath, child);
        } else if (entry.kind === 'file') {
          copyWindowsBulkFile(
            sourceParent,
            targetParent,
            entry,
            name,
            path.join(targetParent.identity.path, name),
            input.assertDeadline,
            'No-follow bulk file',
            input.rejectHardLinks
          );
        } else {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk source contains an unsupported link: ${entry.relativePath}.`);
        }
      }
      sourceChain.assertCurrent();
      targetParentChain.assertCurrent();
    } catch (error) {
      primaryFailure = { error };
      throw error;
    } finally {
      const closeError = closeWindowsHandlesBestEffort([
        ...(pendingSourceHandle === null ? [] : [pendingSourceHandle]),
        ...[...targetDirectories].reverse().map((entry) => entry.handle),
        ...[...sourceDirectories.values()].reverse().map((entry) => entry.handle),
        ...[...sourceChain.directories].reverse().map((entry) => entry.handle),
        ...[...(targetParentChain?.directories ?? [])].reverse().map((entry) => entry.handle)
      ], 'No-follow bulk copy settlement');
      if (closeError !== null) {
        if (primaryFailure !== undefined) throw new AggregateError([primaryFailure.error, closeError], 'No-follow bulk copy and settlement failed.');
        throw closeError;
      }
    }
    return;
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `No-follow bulk copy is unavailable on ${process.platform}.`);
}

/**
 * Performs one operation-scoped physical directory copy.  The mature
 * recursive copier is used only inside this contract: every source root is
 * first traversed with no-follow inventory, reparse children are rejected,
 * target names must be absent, and both source and destination are read back
 * with content digests after the effect.  The caller's authority fence is
 * intentionally invoked only at the operation boundaries, never once per
 * copied entry.
 */
export async function copyNoFollowDirectoryTreesBulk(
  roots: readonly NoFollowDirectoryTreeCopyRoot[],
  options: NoFollowDirectoryTreeCopyOptions = {}
): Promise<void> {
  if (roots.length === 0) return;
  // The capability has one operation-scoped source/target fence.  Multiple
  // independent roots would otherwise permit the first copy to publish before
  // a later root fails, leaving a partial multi-root operation with no journal
  // owner.  Callers that need several roots must form one bounded source tree
  // and select its children with includeRelativePaths.
  if (roots.length !== 1) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      'No-follow bulk copy requires exactly one source/target root per operation.'
    );
  }
  const skipNestedNodeModules = options.skipNestedNodeModules === true;
  const maximumEntries = options.maximumEntries ?? 100_000;
  const maximumBytes = options.maximumBytes ?? Number.POSITIVE_INFINITY;
  const deadlineAtMs = options.deadlineAtMs ?? Number.POSITIVE_INFINITY;
  const includeRelativePaths = normalizedCopyIncludePaths(options.includeRelativePaths);
  const excludeRelativePaths = normalizedCopyExcludePaths(options.excludeRelativePaths);
  const preserveDirectoryPermissionMode = options.preservePermissionMode ?? false;
  const preserveFilePermissionMode =
    preserveDirectoryPermissionMode || (options.preserveFilePermissionMode ?? false);
  const rejectHardLinks = options.rejectHardLinks ?? false;
  if (includeRelativePaths !== undefined && excludeRelativePaths !== undefined) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      'No-follow bulk copy include and exclude projections cannot be combined in one operation.'
    );
  }
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy entry bound is invalid.');
  }
  if (maximumBytes !== Number.POSITIVE_INFINITY &&
      (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy byte bound is invalid.');
  }
  if (!Number.isFinite(deadlineAtMs) && deadlineAtMs !== Number.POSITIVE_INFINITY) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy deadline is invalid.');
  }
  if (typeof preserveDirectoryPermissionMode !== 'boolean' ||
      typeof (options.preserveFilePermissionMode ?? false) !== 'boolean' ||
      typeof rejectHardLinks !== 'boolean') {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy permission-mode option is invalid.');
  }
  const assertDeadline = (): void => {
    options.signal?.throwIfAborted();
    if (performance.now() > deadlineAtMs) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow bulk copy deadline exceeded.');
    }
  };
  assertDeadline();

  const sourceChains: PhysicalDirectoryChain[] = [];
  const targetLexicalPaths: string[] = [];
  const targetParentLexicalPaths: string[] = [];
  // The bound is for the complete operation, not for one filtered view of
  // one scan.  The source pre-scan, destination readback, and final source
  // readback all consume the same budget; excluded entries therefore cannot
  // make an otherwise-unbounded traversal look small, and a later readback
  // cannot silently reset the ceiling.
  let traversedEntryCount = 0;
  let traversedByteCount = 0;
  const consumeBytes = (bytes: number, label: string): void => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 ||
        (maximumBytes !== Number.POSITIVE_INFINITY && bytes > maximumBytes - traversedByteCount)) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `No-follow bulk copy total byte bound exceeded during ${label}.`
      );
    }
    traversedByteCount += bytes;
  };
  const boundedInventory = (
    root: PhysicalDirectoryIdentity,
    label: string,
    excludedSourceSubtrees?: ReadonlySet<string>
  ): readonly NoFollowDirectoryTreeInventoryEntry[] => {
    assertDeadline();
    const remaining = maximumEntries - traversedEntryCount;
    if (remaining < 1) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `No-follow bulk copy total entry bound exhausted before ${label}.`);
    }
    const scanOptions = {
      deadlineAtMs,
      includePermissionMode: preserveFilePermissionMode,
      maximumEntries: remaining,
      maximumBytes: maximumBytes === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : maximumBytes - traversedByteCount,
      signal: options.signal
    };
    const inventory = Object.freeze(scanNoFollowDirectoryTreeInternal(
      root,
      'streaming-digest',
      scanOptions,
      null,
      false,
      false,
      excludedSourceSubtrees,
      () => { traversedEntryCount += 1; }
    ).map((entry) => projectNoFollowDirectoryTreeInventoryEntry(entry, entry.contentDigest)));
    consumeBytes(
      inventory.reduce((total, entry) => entry.kind === 'file' ? total + entry.size : total, 0),
      label
    );
    if (traversedEntryCount > maximumEntries) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `No-follow bulk copy total entry bound exceeded after ${label}.`);
    }
    return inventory;
  };

  const snapshots = roots.map((root) => {
    assertDeadline();
    const source = assertSameNoFollowDirectoryIdentity(root.source, 'No-follow bulk copy source').target;
    const target = requireAbsoluteDirectoryPath(root.target, 'No-follow bulk copy target');
    const targetParent = locateNoFollowExistingDirectoryAncestor(
      path.dirname(target),
      'No-follow bulk copy target parent'
    );
    const targetParentPath = path.join(targetParent.ancestor.path, ...targetParent.segments);
    const sourceChain = inspectNoFollowDirectoryChain(source.path, 'No-follow bulk copy source chain');
    // A source and its ordinary destination parent normally share an ancestor
    // (for example sibling `source` and `target` directories).  Only the
    // destination itself, or a destination parent physically contained by the
    // source, is unsafe.
    const targetCoveredByExcludedSourceSubtree =
      copyTargetCoveredByExcludedSourceSubtree(source.path, target, excludeRelativePaths);
    if (lexicalPathOverlap(source.path, target) && !targetCoveredByExcludedSourceSubtree) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy source and destination are lexically overlapping.');
    }
    const targetParentChain = inspectNoFollowDirectoryChain(
      targetParent.ancestor.path,
      'No-follow bulk copy existing target parent chain'
    );
    if (targetParentChain.ancestors.some((ancestor) => samePhysicalObject(ancestor, source))
        && !targetCoveredByExcludedSourceSubtree) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy target parent is physically contained by the source.');
    }
    sourceChains.push(sourceChain);
    targetLexicalPaths.push(target);
    targetParentLexicalPaths.push(targetParentPath);
    const targetPresence = inspectExactNoFollowDirectoryPresence(target, 'No-follow bulk copy target');
    if (targetPresence.state !== 'absent') {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy target is already occupied.');
    }
    // Source exclusions are traversal boundaries, not post-hoc hiding.  The
    // retained scanner never opens descendants below an excluded root. Other
    // projections remain post-scan filters and therefore still consume the
    // operation budget.
    const completeSourceInventory = boundedInventory(
      source,
      'source inventory',
      excludeRelativePaths
    );
    const sourceInventory = comparableCopyInventory(
      completeSourceInventory,
      skipNestedNodeModules,
      includeRelativePaths,
      excludeRelativePaths
    );
    if (sourceInventory.some(({ kind }) => kind === 'link')) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy source contains a reparse entry.');
    }
    return Object.freeze({
      source,
      target,
      targetParent,
      targetParentPath,
      sourceChain,
      targetParentChain,
      sourceInventory,
      targetCoveredByExcludedSourceSubtree
    });
  });

  for (let left = 0; left < sourceChains.length; left += 1) {
    for (let right = left + 1; right < sourceChains.length; right += 1) {
      if (lexicalPathOverlap(sourceChains[left]!.target.path, sourceChains[right]!.target.path) ||
          lexicalPathOverlap(targetLexicalPaths[left]!, targetLexicalPaths[right]!)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy roots overlap lexically.');
      }
      assertPhysicallyDisjointDirectoryChains(
        sourceChains[left]!,
        sourceChains[right]!,
        'No-follow bulk copy source roots'
      );
    }
  }
  for (let sourceIndex = 0; sourceIndex < sourceChains.length; sourceIndex += 1) {
    for (let targetIndex = 0; targetIndex < targetLexicalPaths.length; targetIndex += 1) {
      const admittedEmbeddedTarget = sourceIndex === targetIndex &&
        snapshots[sourceIndex]?.targetCoveredByExcludedSourceSubtree === true;
      if (lexicalPathOverlap(sourceChains[sourceIndex]!.target.path, targetLexicalPaths[targetIndex]!)
          && !admittedEmbeddedTarget) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy source and destination roots overlap.');
      }
    }
  }

  await options.assertCurrent?.();
  assertDeadline();
  const preparedSnapshots = snapshots.map((snapshot) => {
    const targetParentIdentity = createNoFollowOrdinaryDirectoryChain(
      snapshot.targetParent.ancestor,
      snapshot.targetParent.segments
    );
    return Object.freeze({
      ...snapshot,
      targetParentIdentity,
      targetParentChain: inspectNoFollowDirectoryChain(
        targetParentIdentity.path,
        'No-follow bulk copy prepared target parent chain'
      )
    });
  });
  for (const snapshot of preparedSnapshots) {
    assertDeadline();
    consumeBytes(
      snapshot.sourceInventory.reduce((total, entry) => entry.kind === 'file' ? total + entry.size : total, 0),
      'copy effect'
    );
    await copyNoFollowSingleTreeWithRetainedHandles({
      source: snapshot.sourceChain,
      target: snapshot.target,
      targetParent: snapshot.targetParentChain,
      sourceInventory: snapshot.sourceInventory,
      maximumEntries,
      assertDeadline,
      preserveDirectoryPermissionMode,
      preserveFilePermissionMode,
      rejectHardLinks
    });
    const target = inspectNoFollowDirectoryChain(snapshot.target, 'No-follow bulk copy target readback').target;
    if (!samePhysicalObject(snapshot.targetParentIdentity, inspectNoFollowDirectoryChain(
      path.dirname(snapshot.target),
      'No-follow bulk copy target parent readback'
    ).target)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy target parent changed.');
    }
    // The destination is newly materialized and must contain exactly the
    // projected source inventory. Never apply source-side filters to target
    // readback: doing so would hide injected residue under an excluded name.
    const targetInventory = boundedInventory(target, 'target readback');
    const targetPermissionComparison: CopyPermissionComparison = preserveDirectoryPermissionMode
      ? 'all'
      : preserveFilePermissionMode
        ? 'files'
        : 'none';
    if (!sameCopyInventory(snapshot.sourceInventory, targetInventory, targetPermissionComparison, 'materialized-target')) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy target readback differs.');
    }
    const sourceAfterChain = assertSameNoFollowDirectoryIdentity(
      snapshot.source,
      'No-follow bulk copy source readback'
    );
    const sourceAfterInventory = comparableCopyInventory(
      boundedInventory(sourceAfterChain.target, 'source readback', excludeRelativePaths),
      skipNestedNodeModules,
      includeRelativePaths,
      excludeRelativePaths
    );
    if (!sameCopyInventory(
      snapshot.sourceInventory,
      sourceAfterInventory,
      preserveFilePermissionMode ? 'all' : 'none',
      'source-reobservation'
    )) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy source changed during effect.');
    }
    if (preserveDirectoryPermissionMode && process.platform === 'linux') {
      const retainedSourceRoot = linuxRetainBulkDirectoryChain(
        sourceAfterChain,
        'No-follow bulk copy source root mode readback'
      );
      const retainedTargetRoot = linuxRetainBulkDirectoryChain(
        inspectNoFollowDirectoryChain(snapshot.target, 'No-follow bulk copy target root mode readback'),
        'No-follow bulk copy target root mode readback'
      );
      try {
        retainedSourceRoot.assertCurrent();
        retainedTargetRoot.assertCurrent();
        const sourceBefore = fstatSync(retainedSourceRoot.target.fd, { bigint: true });
        const targetMode = fstatSync(retainedTargetRoot.target.fd, { bigint: true });
        const sourceAfter = fstatSync(retainedSourceRoot.target.fd, { bigint: true });
        const expectedTargetMode = permissionModeForCopiedRoot(sourceBefore, targetMode);
        if (!sourceBefore.isDirectory() || !targetMode.isDirectory() || !sourceAfter.isDirectory() ||
            sourceBefore.dev !== sourceAfter.dev || sourceBefore.ino !== sourceAfter.ino ||
            sourceBefore.mode !== sourceAfter.mode || sourceBefore.uid !== sourceAfter.uid ||
            sourceBefore.gid !== sourceAfter.gid ||
            expectedTargetMode !== Number(targetMode.mode & 0o7777n)) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
            'No-follow bulk copy root permission-mode readback differs.'
          );
        }
        retainedSourceRoot.assertCurrent();
        retainedTargetRoot.assertCurrent();
      } finally {
        retainedTargetRoot.dispose();
        retainedSourceRoot.dispose();
      }
    }
  }
  assertDeadline();
  await options.assertCurrent?.();
}
