import {
  closeSync,
  fstatSync,
  lstatSync,
  opendirSync,
  readlinkSync
} from 'node:fs';
import path from 'node:path';

import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain
} from './physical-directory-chain.ts';
import {
  PhysicalNoFollowError,
  type NoFollowDirectoryTreeEntry,
  type NoFollowDirectoryTreeEntryKind,
  type NoFollowDirectoryTreeInventoryEntry,
  type NoFollowDirectoryTreeMetadataOptions,
  type NoFollowSelectedDirectoryForestOptions,
  type PhysicalDirectoryIdentity
} from './physical-no-follow-contract.ts';
import {
  digestRetainedOrdinaryFileFd,
  linuxIdentity,
  linuxOpenAt,
  linuxOpenLeafAt,
  linuxOpenReadableLeafAt,
  linuxOpenRoot,
  linuxReadRetainedLinkTarget,
  readLinuxRetainedFile,
  windowsInventoryRetainedEntry,
  windowsMetadataRetainedEntry,
  windowsScanRetainedEntry,
  type ReserveNoFollowFileBytes
} from './physical-no-follow-native.ts';
import {
  physicalError,
  sameIdentity
} from './physical-no-follow-shared.ts';

/** Read-only bounded directory-tree observation and inventory projection. */

const noFollowDirectoryTreeEntryPosixOwnership = new WeakMap<object, Readonly<{
  ownerGroupId: bigint;
  ownerUserId: bigint;
}>>();

export function directoryTreeEntryPosixOwnership(
  entry: NoFollowDirectoryTreeEntry | NoFollowDirectoryTreeInventoryEntry
): Readonly<{ ownerGroupId: bigint; ownerUserId: bigint }> | undefined {
  return noFollowDirectoryTreeEntryPosixOwnership.get(entry);
}

interface InternalNoFollowDirectoryTreeEntry extends NoFollowDirectoryTreeEntry {
  readonly contentDigest: `sha256:${string}` | null;
  readonly byteDigest?: `sha256:${string}`;
  readonly permissionMode?: number | null;
  readonly ownerGroupId?: bigint;
  readonly ownerUserId?: bigint;
}

type NoFollowDirectoryTreeFileMode = 'bounded-bytes' | 'metadata-only' | 'streaming-digest';

function projectedPermissionMode(
  mode: bigint,
  kind: NoFollowDirectoryTreeEntryKind,
  include: boolean,
  owner?: Readonly<{ gid: bigint; uid: bigint }>
): Readonly<{
  permissionMode: number | null;
  ownerGroupId?: bigint;
  ownerUserId?: bigint;
}> | Record<string, never> {
  if (!include) return Object.freeze({});
  return Object.freeze({
    permissionMode: process.platform === 'linux' && kind !== 'link'
      ? Number(mode & 0o7777n)
      : null,
    ...(process.platform === 'linux' && kind !== 'link' && owner !== undefined
      ? { ownerGroupId: owner.gid, ownerUserId: owner.uid }
      : {})
  });
}

function selectedForestPatterns(values: readonly string[]): readonly (readonly string[])[] {
  if (values.length === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Selected forest requires at least one include path.');
  }
  return Object.freeze(values.map((value) => {
    if (value.length === 0 || value.includes('\\') || value.startsWith('/') || value.endsWith('/')) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Selected forest include path is not canonical.');
    }
    const segments = value.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..'
        || segment.includes('\0') || (segment !== '*' && !/^[A-Za-z0-9._-]+$/u.test(segment)))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Selected forest include path is not canonical.');
    }
    return Object.freeze(segments);
  }));
}

function selectedForestPathRole(
  relativePath: string,
  patterns: readonly (readonly string[])[]
): 'excluded' | 'navigation' | 'selected' {
  const segments = relativePath.split('/');
  let navigation = false;
  for (const pattern of patterns) {
    const shared = Math.min(pattern.length, segments.length);
    let matches = true;
    for (let index = 0; index < shared; index += 1) {
      if (pattern[index] !== '*' && pattern[index] !== segments[index]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (segments.length >= pattern.length) return 'selected';
    navigation = true;
  }
  return navigation ? 'navigation' : 'excluded';
}

function selectedForestLiteralChildren(
  relativePath: string,
  patterns: readonly (readonly string[])[]
): readonly string[] | null {
  const segments = relativePath.split('/');
  const children = new Set<string>();
  for (const pattern of patterns) {
    if (segments.length >= pattern.length) continue;
    let matches = true;
    for (const [index, segment] of segments.entries()) {
      if (pattern[index] !== '*' && pattern[index] !== segment) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const child = pattern[segments.length]!;
    if (child === '*') return null;
    children.add(child);
  }
  return Object.freeze([...children].sort((left, right) => left.localeCompare(right)));
}


function metadataScanNames(
  directory: string,
  observedEntries: number,
  options: Required<Omit<NoFollowDirectoryTreeMetadataOptions, 'signal'>> &
    Pick<NoFollowDirectoryTreeMetadataOptions, 'signal'>,
  consumeEntry?: () => void
): readonly string[] {
  const names: string[] = [];
  const handle = opendirSync(directory);
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      if (performance.now() > options.deadlineAtMs) {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow metadata inventory deadline exceeded.');
      }
      const entry = handle.readSync();
      if (entry === null) break;
      if (observedEntries + names.length >= options.maximumEntries) {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow metadata inventory entry bound exceeded.');
      }
      consumeEntry?.();
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return Object.freeze(names.sort((left, right) => left.localeCompare(right)));
}

export function scanNoFollowDirectoryTreeInternal(
  root: PhysicalDirectoryIdentity,
  fileMode: NoFollowDirectoryTreeFileMode,
  metadataOptions: Partial<NoFollowDirectoryTreeMetadataOptions> = {},
  selectedPatterns: readonly (readonly string[])[] | null = null,
  omitNavigationPrefixes = false,
  directChildrenOnly = false,
  excludedRelativePaths?: ReadonlySet<string>,
  onEntryVisited?: () => void,
  volatileDirectEntries = false
): readonly InternalNoFollowDirectoryTreeEntry[] {
  const boundedMetadata = Object.freeze({
    deadlineAtMs: metadataOptions.deadlineAtMs ?? Number.POSITIVE_INFINITY,
    maximumEntries: metadataOptions.maximumEntries ?? 100_000,
    maximumBytes: metadataOptions.maximumBytes ?? Number.POSITIVE_INFINITY,
    includePermissionMode: metadataOptions.includePermissionMode ?? false,
    signal: metadataOptions.signal
  });
  boundedMetadata.signal?.throwIfAborted();
  if (!Number.isFinite(boundedMetadata.deadlineAtMs) && boundedMetadata.deadlineAtMs !== Number.POSITIVE_INFINITY) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow metadata inventory deadline is invalid.');
  }
  if (!Number.isSafeInteger(boundedMetadata.maximumEntries) || boundedMetadata.maximumEntries < 1) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow metadata inventory entry bound is invalid.');
  }
  if (boundedMetadata.maximumBytes !== Number.POSITIVE_INFINITY
      && (!Number.isSafeInteger(boundedMetadata.maximumBytes) || boundedMetadata.maximumBytes < 0)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow inventory byte bound is invalid.');
  }
  if (typeof boundedMetadata.includePermissionMode !== 'boolean') {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow inventory permission-mode option is invalid.');
  }
  let enumeratedEntries = 0;
  const assertReadCurrent = (): void => {
    boundedMetadata.signal?.throwIfAborted();
    if (performance.now() >= boundedMetadata.deadlineAtMs) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory deadline exceeded.');
    }
  };
  const consumeEntry = (): void => {
    assertReadCurrent();
    if (enumeratedEntries >= boundedMetadata.maximumEntries) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory entry bound exceeded.');
    }
    enumeratedEntries += 1;
    onEntryVisited?.();
  };
  let observedBytes = 0;
  const reserveFileBytes: ReserveNoFollowFileBytes = (size) => {
    if (!Number.isSafeInteger(size) || size < 0
        || observedBytes > boundedMetadata.maximumBytes - size) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory byte bound exceeded.');
    }
    observedBytes += size;
  };
  const target = assertSameNoFollowDirectoryIdentity(root, 'No-follow scan root').target;
  const entries: InternalNoFollowDirectoryTreeEntry[] = [];
  if (process.platform === 'linux') {
    const filesystemRootFd = linuxOpenRoot('No-follow scan root');
    let retainedRootFd = filesystemRootFd;
    try {
      for (const segment of target.path.slice(path.parse(target.path).root.length).split('/').filter(Boolean)) {
        const next = linuxOpenAt(retainedRootFd, segment, 'No-follow scan root');
        if (retainedRootFd !== filesystemRootFd) closeSync(retainedRootFd);
        retainedRootFd = next;
      }
      if (!sameIdentity(target, linuxIdentity(retainedRootFd, target.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow scan root changed before retained traversal.');
      }
      const visitRetained = (directoryFd: number, prefix: string): void => {
        // `/proc/self/fd/<fd>` denotes this already-open directory object; it
        // is only a directory enumeration view.  Every child observation and
        // content read below is relative to `directoryFd`, never this path.
        const names = metadataScanNames(`/proc/self/fd/${directoryFd}`, enumeratedEntries, boundedMetadata, consumeEntry);
        for (const name of names) {
          boundedMetadata.signal?.throwIfAborted();
          if (performance.now() > boundedMetadata.deadlineAtMs) {
            throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory deadline exceeded.');
          }
          if (entries.length >= boundedMetadata.maximumEntries) {
            throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory entry bound exceeded.');
          }
          if (name.includes('\0')) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Directory entry contains NUL.');
          const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
          if (copyInventoryRelativePathExcluded(relativePath, excludedRelativePaths)) continue;
          const selectedRole = selectedPatterns === null
            ? 'selected'
            : selectedForestPathRole(relativePath, selectedPatterns);
          if (selectedRole === 'excluded') continue;
          let retained: number;
          try {
            retained = linuxOpenLeafAt(directoryFd, name, 'No-follow scan leaf');
          } catch (error) {
            if (volatileDirectEntries && directChildrenOnly && prefix.length === 0
                && error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') continue;
            throw error;
          }
          try {
            const stat = fstatSync(retained, { bigint: true });
            const kind: NoFollowDirectoryTreeEntryKind = stat.isSymbolicLink()
              ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : (() => {
                throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `Unsupported no-follow directory entry: ${relativePath}.`);
              })();
            let bytes: Uint8Array | null = null;
            let contentDigest: `sha256:${string}` | null = null;
            let byteDigest: `sha256:${string}` | null = null;
            if (kind === 'file') {
              const size = Number(stat.size);
              reserveFileBytes(size);
            }
            if (kind === 'file' && fileMode !== 'metadata-only') {
              const readable = linuxOpenReadableLeafAt(directoryFd, name, 'No-follow scan file');
              try {
                const readableBefore = fstatSync(readable, { bigint: true });
                if (readableBefore.dev !== stat.dev || readableBefore.ino !== stat.ino || !readableBefore.isFile()) {
                  throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow scan file changed before retained read.');
                }
                if (fileMode === 'bounded-bytes') {
                  bytes = readLinuxRetainedFile(readable, 'No-follow scan file', undefined, assertReadCurrent);
                } else {
                  const streamed = digestRetainedOrdinaryFileFd(
                    readable, { device: String(stat.dev), inode: String(stat.ino) }, 'No-follow scan file', assertReadCurrent
                  );
                  contentDigest = streamed.contentDigest;
                  byteDigest = streamed.byteDigest;
                }
                const readableAfter = fstatSync(readable, { bigint: true });
                if (readableAfter.dev !== stat.dev || readableAfter.ino !== stat.ino || !readableAfter.isFile()) {
                  throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow scan file changed during retained read.');
                }
              } finally { closeSync(readable); }
            }
            if (!(omitNavigationPrefixes && selectedRole === 'navigation')) {
              entries.push(Object.freeze({
                relativePath, kind, device: String(stat.dev), inode: String(stat.ino), size: Number(stat.size),
                bytes, contentDigest,
                ...(byteDigest === null ? {} : { byteDigest }),
                linkTarget: kind === 'link'
                  ? linuxReadRetainedLinkTarget(retained, 'No-follow scan retained link')
                  : null,
                ...projectedPermissionMode(stat.mode, kind, boundedMetadata.includePermissionMode, stat)
              }));
            }
            if (kind === 'directory' && !directChildrenOnly) visitRetained(retained, relativePath);
          } finally { closeSync(retained); }
        }
      };
      visitRetained(retainedRootFd, '');
      if (!sameIdentity(target, linuxIdentity(retainedRootFd, target.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow scan root changed during retained traversal.');
      }
      return Object.freeze(entries);
    } finally {
      if (retainedRootFd !== filesystemRootFd) closeSync(retainedRootFd);
      closeSync(filesystemRootFd);
    }
  }
  const visit = (directory: string, prefix: string): void => {
    boundedMetadata.signal?.throwIfAborted();
    assertSameNoFollowDirectoryIdentity(
      prefix.length === 0 ? target : inspectNoFollowDirectoryChain(directory, 'No-follow scan directory').target,
      'No-follow scan directory'
    );
    const names = metadataScanNames(directory, enumeratedEntries, boundedMetadata, consumeEntry);
    for (const name of names) {
      boundedMetadata.signal?.throwIfAborted();
      if (performance.now() > boundedMetadata.deadlineAtMs) {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory deadline exceeded.');
      }
      if (entries.length >= boundedMetadata.maximumEntries) {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory entry bound exceeded.');
      }
      if (name.includes('\0')) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Directory entry contains NUL.');
      const absolute = path.join(directory, name);
      const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
      if (copyInventoryRelativePathExcluded(relativePath, excludedRelativePaths)) continue;
      const selectedRole = selectedPatterns === null
        ? 'selected'
        : selectedForestPathRole(relativePath, selectedPatterns);
      if (selectedRole === 'excluded') continue;
      if (process.platform === 'win32') {
        if (omitNavigationPrefixes && selectedRole === 'navigation' && selectedPatterns !== null) {
          const literalChildren = selectedForestLiteralChildren(relativePath, selectedPatterns);
          if (literalChildren !== null) {
            for (const child of literalChildren) {
              boundedMetadata.signal?.throwIfAborted();
              if (performance.now() > boundedMetadata.deadlineAtMs) {
                throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory deadline exceeded.');
              }
              if (entries.length >= boundedMetadata.maximumEntries) {
                throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow inventory entry bound exceeded.');
              }
              consumeEntry();
              const childAbsolute = path.join(absolute, child);
              const childRelativePath = `${relativePath}/${child}`;
              const childRole = selectedForestPathRole(childRelativePath, selectedPatterns);
              if (childRole === 'excluded') continue;
              let scanned: InternalNoFollowDirectoryTreeEntry;
              try {
                scanned = Object.freeze({
                  ...windowsScanRetainedEntry(childAbsolute, 'No-follow selected forest root', reserveFileBytes, assertReadCurrent),
                  relativePath: childRelativePath,
                  contentDigest: null,
                  ...(boundedMetadata.includePermissionMode ? { permissionMode: null } : {})
                });
              } catch (error) {
                if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') continue;
                throw error;
              }
              if (childRole === 'navigation') {
                if (scanned.kind !== 'directory') {
                  throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow selected forest navigation path is not a directory.');
                }
                visit(childAbsolute, childRelativePath);
                continue;
              }
              entries.push(scanned);
              if (scanned.kind === 'directory' && !directChildrenOnly) visit(childAbsolute, childRelativePath);
            }
            continue;
          }
        }
        let scanned: Omit<InternalNoFollowDirectoryTreeEntry, 'relativePath'>;
        try {
          scanned = fileMode === 'bounded-bytes'
            ? Object.freeze({ ...windowsScanRetainedEntry(absolute, 'No-follow scan entry', reserveFileBytes, assertReadCurrent), contentDigest: null })
            : fileMode === 'metadata-only'
              ? Object.freeze({ ...windowsMetadataRetainedEntry(absolute, 'No-follow metadata entry'), bytes: null })
              : Object.freeze({ ...windowsInventoryRetainedEntry(absolute, 'No-follow inventory entry', reserveFileBytes, assertReadCurrent), bytes: null });
        } catch (error) {
          if (volatileDirectEntries && directChildrenOnly && prefix.length === 0
              && error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') continue;
          throw error;
        }
        if (fileMode === 'metadata-only' && scanned.kind === 'file') reserveFileBytes(scanned.size);
        if (!(omitNavigationPrefixes && selectedRole === 'navigation')) {
          entries.push(Object.freeze({
            ...scanned,
            relativePath,
            ...(boundedMetadata.includePermissionMode ? { permissionMode: null } : {})
          }));
        }
        if (scanned.kind === 'directory' && !directChildrenOnly) visit(absolute, relativePath);
        continue;
      }
      const metadata = lstatSync(absolute, { bigint: true });
      const size = Number(metadata.size);
      if (metadata.isSymbolicLink()) {
        const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
        entries.push(Object.freeze({
          relativePath, kind: 'link', ...identity, size, bytes: null, contentDigest: null,
          linkTarget: readlinkSync(absolute),
          ...projectedPermissionMode(metadata.mode, 'link', boundedMetadata.includePermissionMode, metadata)
        }));
        continue;
      }
      if (metadata.isDirectory()) {
        try {
          inspectNoFollowDirectoryChain(absolute, 'No-follow scan descendant');
        } catch (error) {
          if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH') {
            const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
            entries.push(Object.freeze({
              relativePath, kind: 'link', ...identity, size, bytes: null, contentDigest: null, linkTarget: null,
              ...projectedPermissionMode(metadata.mode, 'link', boundedMetadata.includePermissionMode, metadata)
            }));
            continue;
          }
          throw error;
        }
        const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
        entries.push(Object.freeze({
          relativePath, kind: 'directory', ...identity, size, bytes: null, contentDigest: null, linkTarget: null,
          ...projectedPermissionMode(metadata.mode, 'directory', boundedMetadata.includePermissionMode, metadata)
        }));
        if (!directChildrenOnly) visit(absolute, relativePath);
        continue;
      }
      if (metadata.isFile()) {
        const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
        reserveFileBytes(size);
        if (fileMode !== 'metadata-only') {
          // Linux and Windows use retained descriptor/handle traversal above.
          // On other hosts a pathname reopen after lstat would recreate a
          // check/use race even if a later fstat detected the substitution;
          // fail closed instead of reading through a lexical path.
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
            `No-follow retained file-content observation is unavailable on ${process.platform}.`
          );
        }
        entries.push(Object.freeze({
          relativePath, kind: 'file', ...identity, size,
          bytes: null, contentDigest: null, linkTarget: null,
          ...projectedPermissionMode(metadata.mode, 'file', boundedMetadata.includePermissionMode, metadata)
        }));
        continue;
      }
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `Unsupported no-follow directory entry: ${relativePath}.`);
    }
  };
  visit(target.path, '');
  boundedMetadata.signal?.throwIfAborted();
  assertSameNoFollowDirectoryIdentity(target, 'No-follow scan root');
  return Object.freeze(entries);
}

/**
 * Bounded byte reader for canonical control and recovery trees.  Ordinary
 * files larger than the fixed read limit fail closed.
 */
export function scanNoFollowDirectoryTree(
  root: PhysicalDirectoryIdentity,
  options: Partial<NoFollowDirectoryTreeMetadataOptions> = {}
): readonly NoFollowDirectoryTreeEntry[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternal(root, 'bounded-bytes', options).map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    bytes: entry.bytes,
    linkTarget: entry.linkTarget,
    ...('permissionMode' in entry ? { permissionMode: entry.permissionMode } : {})
  })));
}

/**
 * Retains one root while inventorying a caller-selected forest. Selection is
 * structural only: canonical relative path segments plus a one-segment `*`.
 * Prefix entries are retained and emitted, so callers can classify unknown
 * top-level residue without reopening each selected subtree.
 */
export function scanNoFollowDirectoryTreeSelectedForest(
  root: PhysicalDirectoryIdentity,
  options: NoFollowSelectedDirectoryForestOptions
): readonly NoFollowDirectoryTreeEntry[] {
  const patterns = selectedForestPatterns(options.includeRelativePaths);
  return Object.freeze(scanNoFollowDirectoryTreeInternal(
    root,
    'bounded-bytes',
    options,
    patterns,
    options.omitNavigationPrefixes ?? false
  ).map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    bytes: entry.bytes,
    linkTarget: entry.linkTarget,
    ...('permissionMode' in entry ? { permissionMode: entry.permissionMode } : {})
  })));
}

/**
 * Bounded-memory physical inventory.  File content is streamed in 64-KiB
 * chunks through the stable canonical digest domain; bytes are never retained.
 */
export function projectNoFollowDirectoryTreeInventoryEntry(
  entry: InternalNoFollowDirectoryTreeEntry,
  contentDigest: `sha256:${string}` | null,
  includeByteDigest = false
): NoFollowDirectoryTreeInventoryEntry {
  const projected = Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest,
    ...(includeByteDigest && entry.byteDigest !== undefined ? { byteDigest: entry.byteDigest } : {}),
    linkTarget: entry.linkTarget,
    ...('permissionMode' in entry ? { permissionMode: entry.permissionMode } : {})
  });
  if (entry.ownerGroupId !== undefined && entry.ownerUserId !== undefined) {
    noFollowDirectoryTreeEntryPosixOwnership.set(projected, Object.freeze({
      ownerGroupId: entry.ownerGroupId,
      ownerUserId: entry.ownerUserId
    }));
  }
  return projected;
}

export function scanNoFollowDirectoryTreeInventory(
  root: PhysicalDirectoryIdentity,
  options: Partial<NoFollowDirectoryTreeMetadataOptions> & Readonly<{ includeByteDigest?: boolean }> = {}
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  if (options.includeByteDigest !== undefined && typeof options.includeByteDigest !== 'boolean') {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow inventory byte-digest projection flag is invalid.');
  }
  return Object.freeze(scanNoFollowDirectoryTreeInternal(root, 'streaming-digest', options)
    .map((entry) => projectNoFollowDirectoryTreeInventoryEntry(
      entry,
      entry.contentDigest,
      options.includeByteDigest === true
    )));
}

/**
 * Retained metadata-only inventory for destructive convergence.  It never
 * opens ordinary leaves for content reads, and enumeration is bounded by both
 * a monotonic deadline and an entry ceiling supplied by the owning operation.
 */
export function scanNoFollowDirectoryTreeMetadata(
  root: PhysicalDirectoryIdentity,
  options: NoFollowDirectoryTreeMetadataOptions
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternal(root, 'metadata-only', options)
    .map((entry) => projectNoFollowDirectoryTreeInventoryEntry(entry, null)));
}

/**
 * Retained metadata census of exactly the root's direct children. Descendant
 * entries are neither opened nor charged against the direct-entry ceiling.
 */
export function scanNoFollowDirectoryDirectMetadata(
  root: PhysicalDirectoryIdentity,
  options: NoFollowDirectoryTreeMetadataOptions
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternal(
    root,
    'metadata-only',
    options,
    null,
    false,
    true
  ).map((entry) => projectNoFollowDirectoryTreeInventoryEntry(entry, null)));
}

/**
 * Discovers candidates in a volatile direct-child namespace. A name that
 * disappears between enumeration and retained open contributes no candidate;
 * every returned entry still has a retained no-follow identity. Callers must
 * independently acquire and validate an entry before any mutation.
 */
export function scanNoFollowVolatileDirectoryDirectMetadata(
  root: PhysicalDirectoryIdentity,
  options: NoFollowDirectoryTreeMetadataOptions
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternal(
    root,
    'metadata-only',
    options,
    null,
    false,
    true,
    undefined,
    undefined,
    true
  ).map((entry) => projectNoFollowDirectoryTreeInventoryEntry(entry, null)));
}

export function copyInventoryRelativePathExcluded(
  relativePath: string,
  excludeRelativePaths?: ReadonlySet<string>
): boolean {
  if (excludeRelativePaths === undefined) return false;
  for (const excluded of excludeRelativePaths) {
    if (relativePath === excluded || relativePath.startsWith(`${excluded}/`)) return true;
  }
  return false;
}
