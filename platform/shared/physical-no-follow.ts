import { dlopen, FFIType, ptr, read } from 'bun:ffi';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  opendirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

/**
 * A deliberately narrow filesystem primitive.  It owns neither a repository
 * nor an operation's authorization semantics: callers bind these physical
 * observations to their own contracts.
 */
export const PHYSICAL_NO_FOLLOW_SCHEMA_V1 = 'sec-physical-no-follow-v1' as const;
const NO_FOLLOW_FILE_READ_LIMIT_BYTES = 64 * 1024 * 1024;

export type PhysicalNoFollowFailureCode =
  | 'PHYSICAL_NO_FOLLOW_ABSENT'
  | 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
  | 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
  | 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
  | 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED';

export class PhysicalNoFollowError extends Error {
  readonly code: PhysicalNoFollowFailureCode;

  constructor(code: PhysicalNoFollowFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PhysicalNoFollowError';
    this.code = code;
  }
}

export interface PhysicalDirectoryIdentityV1 {
  readonly schema: typeof PHYSICAL_NO_FOLLOW_SCHEMA_V1;
  /** Caller-supplied lexical absolute location, normalized by this module. */
  readonly path: string;
  /** Handle-derived physical final path on Windows; lexical path on Linux. */
  readonly finalPath: string;
  readonly device: string;
  readonly inode: string;
  /** FileIdInfo on Windows; dev/inode material on Linux. */
  readonly objectId: string;
}

export interface PhysicalDirectoryChainV1 {
  readonly target: PhysicalDirectoryIdentityV1;
  /** Root-to-target identities.  Each component was opened without following links. */
  readonly ancestors: readonly PhysicalDirectoryIdentityV1[];
}

/**
 * A directory retained for a bounded child-process read lifecycle. On Linux
 * the child receives the already-open directory as one explicit stdio file
 * descriptor and addresses that object through `/proc/self/fd`. On Windows
 * every lexical ancestor is retained and identity-checked; the target and its
 * direct parent are additionally held without delete sharing. Windows blocks
 * ancestor relocation while those descendant boundary handles are live, but
 * ordinary shared ancestor handles remain compatible with the process cwd,
 * Git watchers, and other read-only repository users.
 */
export interface RetainedNoFollowChildProcessDirectoryV1 {
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  assertCurrent(): void;
  dispose(): void;
}

export interface RetainedNoFollowChildProcessFileV1 {
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  assertCurrent(): void;
  dispose(): void;
}

export type ExactNoFollowDirectoryPresenceV1 =
  | Readonly<{ state: 'present'; directory: PhysicalDirectoryChainV1 }>
  | Readonly<{ state: 'absent' }>;

export type NoFollowDirectoryTreeEntryKindV1 = 'directory' | 'file' | 'link';

export interface NoFollowDirectoryTreeEntryV1 {
  readonly relativePath: string;
  readonly kind: NoFollowDirectoryTreeEntryKindV1;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly bytes: Uint8Array | null;
  readonly linkTarget: string | null;
}

/**
 * Inventory projection for arbitrarily large ordinary leaves.  File bytes are
 * never retained.  `contentDigest` deliberately preserves the historical
 * canonical `{ bytes: lowerHex }` digest domain used by worktree closeout, so
 * an interrupted authorization does not split when a leaf crosses the former
 * in-memory read limit.
 */
export interface NoFollowDirectoryTreeInventoryEntryV1 {
  readonly relativePath: string;
  readonly kind: NoFollowDirectoryTreeEntryKindV1;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly contentDigest: `sha256:${string}` | null;
  readonly linkTarget: string | null;
}

interface InternalNoFollowDirectoryTreeEntryV1 extends NoFollowDirectoryTreeEntryV1 {
  readonly contentDigest: `sha256:${string}` | null;
}

type NoFollowDirectoryTreeFileModeV1 = 'bounded-bytes' | 'metadata-only' | 'streaming-digest';

export interface NoFollowDirectoryTreeMetadataOptionsV1 {
  /** Monotonic `performance.now()` deadline. */
  readonly deadlineAtMs: number;
  /** Hard entry ceiling, checked while directory entries are enumerated. */
  readonly maximumEntries: number;
}

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code.toUpperCase() : null;
}

function absent(error: unknown): boolean {
  return codeOf(error) === 'ENOENT';
}

function physicalError(
  code: PhysicalNoFollowFailureCode,
  message: string,
  cause?: unknown
): PhysicalNoFollowError {
  return new PhysicalNoFollowError(code, message, cause === undefined ? undefined : { cause });
}

function requireAbsoluteDirectoryPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} must be an absolute path.`);
  }
  return path.resolve(value);
}

function identityFromStats(input: {
  readonly absolutePath: string;
  readonly finalPath: string;
  readonly device: bigint | number | string;
  readonly inode: bigint | number | string;
  readonly objectId: string;
}): PhysicalDirectoryIdentityV1 {
  return Object.freeze({
    schema: PHYSICAL_NO_FOLLOW_SCHEMA_V1,
    path: input.absolutePath,
    finalPath: input.finalPath,
    device: String(input.device),
    inode: String(input.inode),
    objectId: input.objectId
  });
}

function sameIdentity(left: PhysicalDirectoryIdentityV1, right: PhysicalDirectoryIdentityV1): boolean {
  return left.schema === right.schema && left.path === right.path && left.finalPath === right.finalPath &&
    left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function samePhysicalObject(
  left: PhysicalDirectoryIdentityV1,
  right: PhysicalDirectoryIdentityV1
): boolean {
  return left.schema === right.schema
    && left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

/** True when outer's physical target is equal to or contains inner's target. */
export function physicallyContainsDirectoryChainV1(
  outer: PhysicalDirectoryChainV1,
  inner: PhysicalDirectoryChainV1
): boolean {
  return inner.ancestors.some((entry) => samePhysicalObject(outer.target, entry));
}

/**
 * Rejects containment or equality between two fully no-follow-proven directory
 * chains. Sharing an ancestor is allowed; either target appearing in the
 * other's ancestor chain is not.
 */
export function assertPhysicallyDisjointDirectoryChainsV1(
  left: PhysicalDirectoryChainV1,
  right: PhysicalDirectoryChainV1,
  label = 'directory chains'
): void {
  if (physicallyContainsDirectoryChainV1(left, right)
    || physicallyContainsDirectoryChainV1(right, left)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} must be physically disjoint.`
    );
  }
}

const LINUX_O_RDONLY = 0;
const LINUX_O_WRONLY = 1;
const LINUX_O_DIRECTORY = 0x0001_0000;
const LINUX_O_NOFOLLOW = 0x0002_0000;
const LINUX_O_CLOEXEC = 0x0008_0000;
const LINUX_O_PATH = 0x0020_0000;
const LINUX_O_CREAT = 0x40;
const LINUX_O_EXCL = 0x80;
const LINUX_O_NONBLOCK = 0x800;
const LINUX_AT_FDCWD = -100;
const LINUX_AT_REMOVEDIR = 0x0200;
const LINUX_RENAME_NOREPLACE = 1;
const LINUX_IN_CREATE = 0x0000_0100;
const LINUX_IN_DELETE = 0x0000_0200;
const LINUX_IN_MOVED_FROM = 0x0000_0040;
const LINUX_IN_MOVED_TO = 0x0000_0080;
const LINUX_IN_DELETE_SELF = 0x0000_0400;
const LINUX_IN_MOVE_SELF = 0x0000_0800;
const LINUX_IN_Q_OVERFLOW = 0x0000_4000;
const LINUX_IN_IGNORED = 0x0000_8000;
const LINUX_IN_ONLYDIR = 0x0100_0000;
const LINUX_IN_ISDIR = 0x4000_0000;
const LINUX_DIRECTORY_CREATE_WATCH_MASK = LINUX_IN_CREATE | LINUX_IN_DELETE |
  LINUX_IN_MOVED_FROM | LINUX_IN_MOVED_TO | LINUX_IN_DELETE_SELF |
  LINUX_IN_MOVE_SELF | LINUX_IN_ONLYDIR;
const LINUX_INOTIFY_EVENT_HEADER_BYTES = 16;
const LINUX_INOTIFY_READ_BYTES = 64 * 1024;
const LINUX_INOTIFY_MAX_EVENTS = 1024;

type LinuxLibc = ReturnType<typeof loadLinuxLibc>;
let linuxLibc: LinuxLibc | undefined;

function loadLinuxLibc() {
  if (process.platform !== 'linux') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `No safe no-follow directory backend is available on ${process.platform}.`
    );
  }
  try {
    return dlopen('libc.so.6', {
      openat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      readlinkat: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
      mkdirat: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      unlinkat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
      linkat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
      renameat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
      renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      inotify_init1: { args: [FFIType.i32], returns: FFIType.i32 },
      inotify_add_watch: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      fsync: { args: [FFIType.i32], returns: FFIType.i32 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
      __errno_location: { args: [], returns: FFIType.ptr }
    } as const);
  } catch (error) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Linux openat no-follow backend is unavailable.', error);
  }
}

function requireLinuxLibc(): LinuxLibc {
  linuxLibc ??= loadLinuxLibc();
  return linuxLibc;
}

function linuxErrno(): number {
  const location = requireLinuxLibc().symbols.__errno_location();
  if (location === null) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Linux errno location is unavailable.');
  }
  return read.i32(location as never);
}

function linuxOpenAt(parentFd: number, component: string, label: string): number {
  if (component.length === 0 || component.includes('/') || component.includes('\0')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} has an invalid no-follow component.`);
  }
  const library = requireLinuxLibc();
  const fd = library.symbols.openat(
    parentFd,
    Buffer.from(`${component}\0`, 'utf8'),
    LINUX_O_RDONLY | LINUX_O_DIRECTORY | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC,
    0
  );
  if (fd < 0) {
    const errno = linuxErrno();
    if (errno === 2) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} could not be opened without following links (errno ${errno}).`);
  }
  return fd;
}

function linuxOpenLeafAt(parentFd: number, component: string, label: string): number {
  if (component.length === 0 || component.includes('/') || component.includes('\0')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} has an invalid no-follow leaf.`);
  }
  const fd = requireLinuxLibc().symbols.openat(
    // O_PATH retains the link object itself under O_NOFOLLOW, including a
    // dangling symlink.  fstat on that retained fd is the leaf identity fence
    // immediately before unlinkat; it never follows a target.
    parentFd, Buffer.from(`${component}\0`, 'utf8'), LINUX_O_PATH | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC, 0
  );
  if (fd < 0) {
    const errno = linuxErrno();
    if (errno === 2) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} cannot be retained without link following (errno ${errno}).`);
  }
  return fd;
}

function linuxReadRetainedLinkTargetV1(linkFd: number, label: string): string {
  const emptyPath = Buffer.from([0]);
  for (let capacity = 256; capacity <= 1024 * 1024; capacity *= 2) {
    const target = Buffer.alloc(capacity);
    const observed = Number(requireLinuxLibc().symbols.readlinkat(
      linkFd, emptyPath, target, BigInt(target.byteLength)
    ));
    if (!Number.isSafeInteger(observed) || observed < 0) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
        `${label} retained readlinkat failed (errno ${linuxErrno()}).`
      );
    }
    if (observed < target.byteLength) {
      const bytes = target.subarray(0, observed);
      const value = bytes.toString('utf8');
      if (value.length === 0 || value.includes('\0') || !Buffer.from(value, 'utf8').equals(bytes)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} target is not exact nonempty UTF-8.`);
      }
      return value;
    }
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} target exceeds the retained link bound.`);
}

function linuxOpenRetainedAbsoluteDirectory(absolutePath: string, label: string): { readonly filesystemRootFd: number; readonly directoryFd: number } {
  const filesystemRootFd = linuxOpenRoot(label);
  let directoryFd = filesystemRootFd;
  try {
    for (const segment of absolutePath.slice(path.parse(absolutePath).root.length).split('/').filter(Boolean)) {
      const next = linuxOpenAt(directoryFd, segment, label);
      if (directoryFd !== filesystemRootFd) closeSync(directoryFd);
      directoryFd = next;
    }
    return Object.freeze({ filesystemRootFd, directoryFd });
  } catch (error) {
    if (directoryFd !== filesystemRootFd) closeSync(directoryFd);
    closeSync(filesystemRootFd);
    throw error;
  }
}

function linuxOpenReadableLeafAt(parentFd: number, component: string, label: string): number {
  if (component.length === 0 || component.includes('/') || component.includes('\\0')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} has an invalid no-follow leaf.`);
  }
  const fd = requireLinuxLibc().symbols.openat(
    parentFd, Buffer.from(`${component}\0`, 'utf8'),
    LINUX_O_RDONLY | LINUX_O_NONBLOCK | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC, 0
  );
  if (fd < 0) {
    const errno = linuxErrno();
    if (errno === 2) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} cannot be opened as an ordinary no-follow file (errno ${errno}).`);
  }
  return fd;
}

function linuxOpenRoot(label: string): number {
  const library = requireLinuxLibc();
  const fd = library.symbols.openat(
    LINUX_AT_FDCWD,
    Buffer.from('/\0', 'utf8'),
    LINUX_O_RDONLY | LINUX_O_DIRECTORY | LINUX_O_CLOEXEC,
    0
  );
  if (fd < 0) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} root directory cannot be opened.`);
  return fd;
}

function linuxIdentity(fd: number, absolutePath: string): PhysicalDirectoryIdentityV1 {
  const stats = fstatSync(fd, { bigint: true });
  if (!stats.isDirectory()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${absolutePath} is not an ordinary directory.`);
  const objectId = `linux:${String(stats.dev)}:${String(stats.ino)}:${String(stats.mode)}`;
  return identityFromStats({ absolutePath, finalPath: absolutePath, device: stats.dev, inode: stats.ino, objectId });
}

interface LinuxDirectoryMutationEventV1 {
  readonly watchDescriptor: number;
  readonly mask: number;
  readonly name: string;
}

interface LinuxDirectoryCreateWitnessV1 {
  readonly fd: number;
  readonly watchDescriptor: number;
  readonly ancestorEdges: ReadonlyMap<number, string>;
}

interface LinuxDirectoryCreateTransactionV1 {
  readonly filesystemRootFd: number;
  readonly witnessFd: number;
  currentFd: number;
  current: PhysicalDirectoryIdentityV1;
  currentWatchDescriptor: number;
  readonly ancestorEdges: Map<number, string>;
}

function linuxOpenDirectoryMutationWitness(label: string): number {
  const symbols = requireLinuxLibc().symbols;
  const fd = symbols.inotify_init1(LINUX_O_NONBLOCK | LINUX_O_CLOEXEC);
  if (fd < 0) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} cannot open the retained Linux mutation witness (errno ${linuxErrno()}).`
    );
  }
  return fd;
}

function linuxAddDirectoryMutationWatch(witnessFd: number, directoryFd: number, label: string): number {
  // /proc/self/fd is a kernel-owned spelling of the already-retained
  // directory, not a second lookup of the caller's lexical path.
  const watchDescriptor = requireLinuxLibc().symbols.inotify_add_watch(
    witnessFd,
    Buffer.from(`/proc/self/fd/${directoryFd}\0`, 'utf8'),
    LINUX_DIRECTORY_CREATE_WATCH_MASK
  );
  if (watchDescriptor < 0) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} cannot bind the retained Linux mutation witness (errno ${linuxErrno()}).`
    );
  }
  return watchDescriptor;
}

function linuxReadDirectoryMutationEvents(
  witness: LinuxDirectoryCreateWitnessV1,
  label: string
): readonly LinuxDirectoryMutationEventV1[] {
  const events: LinuxDirectoryMutationEventV1[] = [];
  const buffer = Buffer.allocUnsafe(LINUX_INOTIFY_READ_BYTES);
  while (true) {
    let observed: number;
    try {
      observed = readSync(witness.fd, buffer, 0, buffer.byteLength, null);
    } catch (error) {
      const code = codeOf(error);
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK') break;
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} mutation witness read failed.`, error);
    }
    if (observed === 0) break;
    let offset = 0;
    while (offset < observed) {
      if (observed - offset < LINUX_INOTIFY_EVENT_HEADER_BYTES) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} mutation witness header is truncated.`);
      }
      const watchDescriptor = buffer.readInt32LE(offset);
      const mask = buffer.readUInt32LE(offset + 4);
      const nameLength = buffer.readUInt32LE(offset + 12);
      const eventBytes = LINUX_INOTIFY_EVENT_HEADER_BYTES + nameLength;
      if (nameLength > LINUX_INOTIFY_READ_BYTES || offset + eventBytes > observed) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} mutation witness name is malformed.`);
      }
      const rawName = buffer.subarray(
        offset + LINUX_INOTIFY_EVENT_HEADER_BYTES,
        offset + eventBytes
      );
      const terminator = rawName.indexOf(0);
      const nameBytes = terminator < 0 ? rawName : rawName.subarray(0, terminator);
      if (terminator >= 0 && rawName.subarray(terminator).some((value) => value !== 0)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} mutation witness name padding is malformed.`);
      }
      const name = nameBytes.toString('utf8');
      if (!Buffer.from(name, 'utf8').equals(nameBytes)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} mutation witness name is not exact UTF-8.`);
      }
      events.push(Object.freeze({ watchDescriptor, mask, name }));
      if (events.length > LINUX_INOTIFY_MAX_EVENTS) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} mutation witness exceeded its event bound.`);
      }
      offset += eventBytes;
    }
  }
  return Object.freeze(events);
}

function linuxAssertDirectoryCreateWitness(
  witness: LinuxDirectoryCreateWitnessV1,
  events: readonly LinuxDirectoryMutationEventV1[],
  name: string,
  created: boolean,
  label: string
): void {
  if (events.some((event) => event.mask & (LINUX_IN_Q_OVERFLOW | LINUX_IN_IGNORED))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} mutation witness was invalidated or overflowed.`);
  }
  const relevant: LinuxDirectoryMutationEventV1[] = [];
  for (const event of events) {
    const ancestorName = witness.ancestorEdges.get(event.watchDescriptor);
    if (ancestorName !== undefined) {
      if (event.name === ancestorName || event.mask & (LINUX_IN_DELETE_SELF | LINUX_IN_MOVE_SELF)) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
          `${label} authorized ancestor edge changed during directory creation.`
        );
      }
      continue;
    }
    if (event.watchDescriptor !== witness.watchDescriptor) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} observed an unknown mutation watch.`);
    }
    if (event.mask & (LINUX_IN_DELETE_SELF | LINUX_IN_MOVE_SELF)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent moved during directory creation.`);
    }
    if (event.name === name) relevant.push(event);
  }
  if (!created && relevant.length === 0) return;
  const exactCreateMask = LINUX_IN_CREATE | LINUX_IN_ISDIR;
  if (created && relevant.length === 1) {
    const [event] = relevant;
    if (event.watchDescriptor === witness.watchDescriptor && event.mask === exactCreateMask && event.name === name) {
      return;
    }
  }
  throw physicalError(
    'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
    `${label} observed a foreign or replacement namespace mutation during directory creation.`
  );
}

function linuxOpenWatchedCanonicalDirectoryChain(
  expected: PhysicalDirectoryChainV1,
  label: string
): LinuxDirectoryCreateTransactionV1 {
  const rootFd = linuxOpenRoot(label);
  const witnessFd = linuxOpenDirectoryMutationWitness(label);
  const ancestorEdges = new Map<number, string>();
  let currentFd = rootFd;
  let currentPath = path.parse(expected.target.path).root;
  try {
    const segments = expected.target.path.slice(currentPath.length).split('/').filter(Boolean);
    if (segments.length === 0) {
      const current = linuxIdentity(rootFd, expected.target.path);
      if (expected.ancestors.length !== 1 || !sameIdentity(expected.target, current) ||
        !sameIdentity(expected.ancestors[0]!, current)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} canonical root identity changed.`);
      }
      const currentWatchDescriptor = linuxAddDirectoryMutationWatch(witnessFd, rootFd, label);
      return {
        filesystemRootFd: rootFd,
        witnessFd,
        currentFd: rootFd,
        current,
        currentWatchDescriptor,
        ancestorEdges
      };
    }
    if (expected.ancestors.length !== segments.length) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        `${label} authorized ancestor chain shape changed.`
      );
    }
    let current: PhysicalDirectoryIdentityV1 | null = null;
    for (const [index, segment] of segments.entries()) {
      const ancestorWatchDescriptor = linuxAddDirectoryMutationWatch(witnessFd, currentFd, `${label} ancestor`);
      ancestorEdges.set(ancestorWatchDescriptor, segment);
      const nextPath = path.join(currentPath, segment);
      const nextFd = linuxOpenAt(currentFd, segment, `${label} ancestor`);
      const next = linuxIdentity(nextFd, nextPath);
      if (!sameIdentity(expected.ancestors[index]!, next)) {
        closeSync(nextFd);
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} authorized ancestor identity changed.`);
      }
      if (currentFd !== rootFd) closeSync(currentFd);
      currentFd = nextFd;
      currentPath = nextPath;
      current = next;
    }
    if (current === null || !sameIdentity(expected.target, current)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} authorized parent identity changed.`);
    }
    const currentWatchDescriptor = linuxAddDirectoryMutationWatch(witnessFd, currentFd, label);
    return {
      filesystemRootFd: rootFd,
      witnessFd,
      currentFd,
      current,
      currentWatchDescriptor,
      ancestorEdges
    };
  } catch (error) {
    if (currentFd !== rootFd) closeSync(currentFd);
    closeSync(rootFd);
    closeSync(witnessFd);
    throw error;
  }
}

function linuxCloseDirectoryCreateTransaction(transaction: LinuxDirectoryCreateTransactionV1): void {
  if (transaction.currentFd !== transaction.filesystemRootFd) closeSync(transaction.currentFd);
  closeSync(transaction.filesystemRootFd);
  closeSync(transaction.witnessFd);
}

function linuxDirectoryCreateTransactionWitness(
  transaction: LinuxDirectoryCreateTransactionV1
): LinuxDirectoryCreateWitnessV1 {
  return Object.freeze({
    fd: transaction.witnessFd,
    watchDescriptor: transaction.currentWatchDescriptor,
    ancestorEdges: transaction.ancestorEdges
  });
}

function linuxAdvanceDirectoryCreateTransaction(
  transaction: LinuxDirectoryCreateTransactionV1,
  opened: Readonly<{ fd: number; identity: PhysicalDirectoryIdentityV1 }>,
  label: string
): void {
  try {
    transaction.ancestorEdges.set(
      transaction.currentWatchDescriptor,
      path.basename(opened.identity.path)
    );
    const nextWatchDescriptor = linuxAddDirectoryMutationWatch(transaction.witnessFd, opened.fd, label);
    if (transaction.currentFd !== transaction.filesystemRootFd) closeSync(transaction.currentFd);
    transaction.currentFd = opened.fd;
    transaction.current = opened.identity;
    transaction.currentWatchDescriptor = nextWatchDescriptor;
  } catch (error) {
    closeSync(opened.fd);
    throw error;
  }
}

function linuxOpenOrCreateDirectoryAt(input: {
  readonly parentFd: number;
  readonly parent: PhysicalDirectoryIdentityV1;
  readonly witness: LinuxDirectoryCreateWitnessV1;
  readonly name: string;
  readonly absolutePath: string;
  readonly allowExisting: boolean;
  readonly label: string;
}): Readonly<{ fd: number; created: boolean; identity: PhysicalDirectoryIdentityV1 }> {
  let childFd: number | null = null;
  let readbackFd: number | null = null;
  let created = false;
  try {
    linuxAssertDirectoryCreateWitness(
      input.witness,
      linuxReadDirectoryMutationEvents(input.witness, input.label),
      input.name,
      false,
      input.label
    );
    if (!sameIdentity(input.parent, linuxIdentity(input.parentFd, input.parent.path))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${input.label} parent changed before mkdirat.`);
    }
    if (requireLinuxLibc().symbols.mkdirat(
      input.parentFd,
      Buffer.from(`${input.name}\0`, 'utf8'),
      0o700
    ) === 0) {
      created = true;
    } else {
      const errno = linuxErrno();
      if (errno !== 17 || !input.allowExisting) {
        throw physicalError(
          errno === 17 ? 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' : 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
          errno === 17
            ? `${input.label} name already exists.`
            : `${input.label} relative mkdirat failed (errno ${errno}).`
        );
      }
    }
    childFd = linuxOpenAt(input.parentFd, input.name, input.label);
    const identity = linuxIdentity(childFd, input.absolutePath);
    if (created && requireLinuxLibc().symbols.fsync(input.parentFd) !== 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${input.label} parent fsync failed.`);
    }
    readbackFd = linuxOpenAt(input.parentFd, input.name, `${input.label} final readback`);
    const readbackIdentity = linuxIdentity(readbackFd, input.absolutePath);
    if (!sameIdentity(identity, readbackIdentity)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${input.label} final identity differs from the retained child.`);
    }
    linuxAssertDirectoryCreateWitness(
      input.witness,
      linuxReadDirectoryMutationEvents(input.witness, input.label),
      input.name,
      created,
      input.label
    );
    if (!sameIdentity(input.parent, linuxIdentity(input.parentFd, input.parent.path))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${input.label} parent changed during final readback.`);
    }
    const result = Object.freeze({ fd: childFd, created, identity });
    childFd = null;
    return result;
  } finally {
    if (readbackFd !== null) closeSync(readbackFd);
    if (childFd !== null) closeSync(childFd);
  }
}

const WINDOWS_INVALID_HANDLE = 0xffff_ffff_ffff_ffffn;
const WINDOWS_OPEN_EXISTING = 3;
const WINDOWS_FILE_ATTRIBUTE_DIRECTORY = 0x0000_0010;
const WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT = 0x0000_0400;
const WINDOWS_FILE_FLAG_BACKUP_SEMANTICS = 0x0200_0000;
const WINDOWS_FILE_FLAG_OPEN_REPARSE_POINT = 0x0020_0000;
const WINDOWS_FILE_ATTRIBUTE_TAG_INFO = 9;
const WINDOWS_FILE_BASIC_INFO = 0;
const WINDOWS_FILE_STANDARD_INFO = 1;
const WINDOWS_FILE_ID_INFO = 18;
const WINDOWS_GENERIC_READ = 0x8000_0000;
const WINDOWS_GENERIC_WRITE = 0x4000_0000;
const WINDOWS_SYNCHRONIZE = 0x0010_0000;
const WINDOWS_FILE_READ_DATA = 0x0000_0001;
const WINDOWS_FILE_WRITE_DATA = 0x0000_0002;
const WINDOWS_FILE_READ_ATTRIBUTES = 0x0000_0080;
const WINDOWS_FILE_READ_EA = 0x0000_0008;
const WINDOWS_READ_CONTROL = 0x0002_0000;
const WINDOWS_DELETE = 0x0001_0000;
const WINDOWS_FILE_WRITE_ATTRIBUTES = 0x0000_0100;
const WINDOWS_SHARE_READ_WRITE_DELETE = 0x0000_0007;
const WINDOWS_SHARE_READ = 0x0000_0001;
// FILE_INFO_BY_HANDLE_CLASS::FileDispositionInfoEx.  The native
// FILE_INFORMATION_CLASS value is 64; SetFileInformationByHandle requires
// the Win32 enum value 21.
const WINDOWS_FILE_DISPOSITION_INFO_EX = 21;
const WINDOWS_FILE_DISPOSITION_FLAG_DELETE = 0x0000_0001;
const WINDOWS_FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE = 0x0000_0010;
const WINDOWS_FILE_RENAME_INFO_EX = 22;
const WINDOWS_FILE_RENAME_INFO = 3;
const WINDOWS_NT_FILE_RENAME_INFORMATION = 10;
const WINDOWS_NT_FILE_RENAME_INFORMATION_EX = 65;
const WINDOWS_FILE_ATTRIBUTE_NORMAL = 0x0000_0080;
const WINDOWS_FSCTL_GET_REPARSE_POINT = 0x0009_00a8;
const WINDOWS_MAXIMUM_REPARSE_DATA_BUFFER_SIZE = 16 * 1024;
const WINDOWS_FILE_CREATE = 2;
const WINDOWS_FILE_OPEN = 1;
const WINDOWS_FILE_NON_DIRECTORY_FILE = 0x0000_0040;
const WINDOWS_FILE_DIRECTORY_FILE = 0x0000_0001;
const WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT = 0x0000_0020;
const WINDOWS_FILE_OPEN_REPARSE_POINT_NT = 0x0020_0000;
const WINDOWS_STATUS_OBJECT_NAME_NOT_FOUND = -1_073_741_772;
const WINDOWS_STATUS_OBJECT_PATH_NOT_FOUND = -1_073_741_766;
const WINDOWS_STATUS_OBJECT_NAME_COLLISION = -1_073_741_771;

type WindowsKernel32 = ReturnType<typeof loadWindowsKernel32>;
let windowsKernel32: WindowsKernel32 | undefined;
type WindowsNtdll = ReturnType<typeof loadWindowsNtdll>;
let windowsNtdll: WindowsNtdll | undefined;

function loadWindowsKernel32() {
  try {
    return dlopen('kernel32.dll', {
      CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u64 },
      GetFileInformationByHandleEx: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      GetFinalPathNameByHandleW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u32 },
      DeviceIoControl: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      SetFileInformationByHandle: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      ReadFile: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      WriteFile: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      SetFilePointerEx: { args: [FFIType.u64, FFIType.i64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      FlushFileBuffers: { args: [FFIType.u64], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
      GetLastError: { args: [], returns: FFIType.u32 }
    } as const);
  } catch (error) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows no-follow handle backend is unavailable.', error);
  }
}

function requireWindowsKernel32(): WindowsKernel32 {
  windowsKernel32 ??= loadWindowsKernel32();
  return windowsKernel32;
}

function loadWindowsNtdll() {
  try {
    return dlopen('ntdll.dll', {
      NtSetInformationFile: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
      NtCreateFile: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 }
    } as const);
  } catch (error) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows native rename-by-handle backend is unavailable.', error);
  }
}

function requireWindowsNtdll(): WindowsNtdll {
  windowsNtdll ??= loadWindowsNtdll();
  return windowsNtdll;
}

function windowsWide(value: string): Buffer {
  return Buffer.from(`${path.toNamespacedPath(path.resolve(value))}\0`, 'utf16le');
}

function windowsPathKey(value: string): string {
  return value.replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US');
}

function windowsAssertParentWithinRetainedRoot(
  root: PhysicalDirectoryIdentityV1,
  parent: PhysicalDirectoryIdentityV1,
  relativeDirectorySegments: readonly string[]
): void {
  const expected = path.win32.join(root.finalPath, ...relativeDirectorySegments);
  if (windowsPathKey(parent.finalPath) !== windowsPathKey(expected)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion parent final path is not a descendant of the held root.');
  }
}

function windowsFinalPath(handle: bigint, label: string): string {
  const library = requireWindowsKernel32();
  const output = Buffer.alloc(32_768 * 2);
  const length = library.symbols.GetFinalPathNameByHandleW(handle, output, 32_768, 0);
  if (length === 0 || length >= 32_768) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} final path cannot be proven.`);
  }
  return output.subarray(0, length * 2).toString('utf16le');
}

function windowsIdentity(handle: bigint, absolutePath: string, label: string): PhysicalDirectoryIdentityV1 {
  const library = requireWindowsKernel32();
  const tag = Buffer.alloc(8);
  if (library.symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ATTRIBUTE_TAG_INFO, tag, tag.byteLength) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} file attributes cannot be proven.`);
  }
  const attributes = tag.readUInt32LE(0);
  if ((attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) === 0 || (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} is not an ordinary non-reparse directory.`);
  }
  const finalPath = windowsFinalPath(handle, label);
  if (windowsPathKey(finalPath) !== windowsPathKey(path.toNamespacedPath(absolutePath))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} escaped its exact lexical path.`);
  }
  const id = Buffer.alloc(24);
  if (library.symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ID_INFO, id, id.byteLength) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} physical identity cannot be proven.`);
  }
  return identityFromStats({
    absolutePath,
    finalPath,
    device: id.subarray(0, 8).toString('hex'),
    inode: id.subarray(8).toString('hex'),
    objectId: `windows:${id.toString('hex')}`
  });
}

function windowsOpenDirectory(absolutePath: string, label: string, forFlush = false): bigint {
  const library = requireWindowsKernel32();
  const handle = library.symbols.CreateFileW(
    windowsWide(absolutePath),
    forFlush ? WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE : WINDOWS_GENERIC_READ,
    WINDOWS_SHARE_READ_WRITE_DELETE,
    null,
    WINDOWS_OPEN_EXISTING,
    WINDOWS_FILE_FLAG_BACKUP_SEMANTICS | WINDOWS_FILE_FLAG_OPEN_REPARSE_POINT,
    null
  );
  if (handle === WINDOWS_INVALID_HANDLE) {
    const lastError = library.symbols.GetLastError();
    if (lastError === 2 || lastError === 3) {
      throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    }
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} cannot be opened without following reparse points (Win32 ${lastError}).`);
  }
  return handle;
}

function windowsOpenPinnedReadDirectory(absolutePath: string, label: string): bigint {
  const library = requireWindowsKernel32();
  const handle = library.symbols.CreateFileW(
    windowsWide(absolutePath),
    WINDOWS_GENERIC_READ,
    WINDOWS_SHARE_READ,
    null,
    WINDOWS_OPEN_EXISTING,
    WINDOWS_FILE_FLAG_BACKUP_SEMANTICS | WINDOWS_FILE_FLAG_OPEN_REPARSE_POINT,
    null
  );
  if (handle === WINDOWS_INVALID_HANDLE) {
    const lastError = library.symbols.GetLastError();
    if (lastError === 2 || lastError === 3) {
      throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    }
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} cannot be pinned without delete sharing (Win32 ${lastError}).`
    );
  }
  return handle;
}

function windowsOpenPinnedReadFile(absolutePath: string, label: string): bigint {
  const library = requireWindowsKernel32();
  const handle = library.symbols.CreateFileW(
    windowsWide(absolutePath),
    WINDOWS_GENERIC_READ,
    WINDOWS_SHARE_READ,
    null,
    WINDOWS_OPEN_EXISTING,
    WINDOWS_FILE_FLAG_OPEN_REPARSE_POINT,
    null
  );
  if (handle === WINDOWS_INVALID_HANDLE) {
    const lastError = library.symbols.GetLastError();
    if (lastError === 2 || lastError === 3) {
      throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    }
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} cannot be pinned without delete sharing (Win32 ${lastError}).`
    );
  }
  return handle;
}

function windowsOpenNoFollowLeaf(absolutePath: string, label: string, desiredAccess: number): bigint {
  const library = requireWindowsKernel32();
  const handle = library.symbols.CreateFileW(
    windowsWide(absolutePath),
    desiredAccess,
    WINDOWS_SHARE_READ_WRITE_DELETE,
    null,
    WINDOWS_OPEN_EXISTING,
    WINDOWS_FILE_FLAG_BACKUP_SEMANTICS | WINDOWS_FILE_FLAG_OPEN_REPARSE_POINT,
    null
  );
  if (handle === WINDOWS_INVALID_HANDLE) {
    const lastError = library.symbols.GetLastError();
    if (lastError === 2 || lastError === 3) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} cannot be retained without following reparse points (Win32 ${lastError}).`);
  }
  return handle;
}

function windowsOpenRetainedLeaf(absolutePath: string, label: string): bigint {
  return windowsOpenNoFollowLeaf(
    absolutePath, label, WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES
  );
}

/**
 * Builds native OBJECT_ATTRIBUTES rooted at an already retained directory.
 * The object name is one validated leaf only; no pathname parent is resolved
 * after the caller has proved the parent FileId.
 */
function windowsRelativeLeafObjectAttributes(parentHandle: bigint, name: string): Readonly<{ objectAttributes: Buffer; objectName: Buffer; unicodeString: Buffer }> {
  ensureLeafName(name);
  const fileName = Buffer.from(name, 'utf16le');
  const objectName = Buffer.concat([fileName, Buffer.alloc(2)]);
  // UNICODE_STRING (16 bytes on Win64): Length, MaximumLength, padding, Buffer.
  const unicodeString = Buffer.alloc(16);
  unicodeString.writeUInt16LE(fileName.byteLength, 0);
  unicodeString.writeUInt16LE(objectName.byteLength, 2);
  unicodeString.writeBigUInt64LE(BigInt(ptr(objectName)), 8);
  // OBJECT_ATTRIBUTES (48 bytes on Win64).  RootDirectory gives NtCreateFile
  // its namespace anchor; ObjectName is deliberately the single leaf above.
  const objectAttributes = Buffer.alloc(48);
  objectAttributes.writeUInt32LE(objectAttributes.byteLength, 0);
  objectAttributes.writeBigUInt64LE(parentHandle, 8);
  objectAttributes.writeBigUInt64LE(BigInt(ptr(unicodeString)), 16);
  objectAttributes.writeUInt32LE(0, 24);
  return Object.freeze({ objectAttributes, objectName, unicodeString });
}

function windowsOpenRelativeLeaf(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  absolutePath: string,
  desiredAccess: number,
  disposition: number,
  label: string,
  allowAbsent = false
): bigint | null {
  const object = windowsRelativeLeafObjectAttributes(parentHandle, name);
  const handleBuffer = Buffer.alloc(8);
  const ioStatus = Buffer.alloc(16);
  const status = requireWindowsNtdll().symbols.NtCreateFile(
    handleBuffer,
    (desiredAccess & WINDOWS_GENERIC_READ) !== 0 && (desiredAccess & WINDOWS_GENERIC_WRITE) !== 0
      ? WINDOWS_FILE_READ_DATA | WINDOWS_FILE_WRITE_DATA | WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_FILE_READ_EA |
        WINDOWS_FILE_WRITE_ATTRIBUTES | WINDOWS_DELETE | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE
      : WINDOWS_FILE_READ_DATA | WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_FILE_READ_EA | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE,
    object.objectAttributes,
    ioStatus,
    null,
    WINDOWS_FILE_ATTRIBUTE_NORMAL,
    WINDOWS_SHARE_READ_WRITE_DELETE,
    disposition,
    WINDOWS_FILE_NON_DIRECTORY_FILE | WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT |
      (disposition === WINDOWS_FILE_CREATE ? 0 : WINDOWS_FILE_OPEN_REPARSE_POINT_NT),
    null,
    0
  );
  if (status < 0) {
    if (allowAbsent && (status === WINDOWS_STATUS_OBJECT_NAME_NOT_FOUND || status === WINDOWS_STATUS_OBJECT_PATH_NOT_FOUND)) return null;
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative NtCreateFile failed (NTSTATUS ${status}).`);
  }
  const handle = handleBuffer.readBigUInt64LE(0);
  if (handle === 0n || handle === WINDOWS_INVALID_HANDLE) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative NtCreateFile returned no handle.`);
  }
  const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent`);
  if (!sameIdentity(parent, observedParent)) {
    closeWindowsHandle(handle);
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during relative leaf open.`);
  }
  return handle;
}

function windowsOpenRelativeDirectory(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  absolutePath: string,
  disposition: typeof WINDOWS_FILE_CREATE | typeof WINDOWS_FILE_OPEN,
  label: string
): bigint | null {
  const object = windowsRelativeLeafObjectAttributes(parentHandle, name);
  const handleBuffer = Buffer.alloc(8);
  const ioStatus = Buffer.alloc(16);
  const status = requireWindowsNtdll().symbols.NtCreateFile(
    handleBuffer,
    WINDOWS_FILE_READ_DATA | WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_FILE_READ_EA |
      WINDOWS_FILE_WRITE_ATTRIBUTES | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE,
    object.objectAttributes,
    ioStatus,
    null,
    WINDOWS_FILE_ATTRIBUTE_NORMAL,
    WINDOWS_SHARE_READ_WRITE_DELETE,
    disposition,
    WINDOWS_FILE_DIRECTORY_FILE | WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT |
      (disposition === WINDOWS_FILE_OPEN ? WINDOWS_FILE_OPEN_REPARSE_POINT_NT : 0),
    null,
    0
  );
  if (status < 0) {
    if (disposition === WINDOWS_FILE_CREATE && status === WINDOWS_STATUS_OBJECT_NAME_COLLISION) return null;
    if (disposition === WINDOWS_FILE_OPEN &&
      (status === WINDOWS_STATUS_OBJECT_NAME_NOT_FOUND || status === WINDOWS_STATUS_OBJECT_PATH_NOT_FOUND)) return null;
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative directory NtCreateFile failed (NTSTATUS ${status}).`);
  }
  const handle = handleBuffer.readBigUInt64LE(0);
  if (handle === 0n || handle === WINDOWS_INVALID_HANDLE) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative directory NtCreateFile returned no handle.`);
  }
  const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent`);
  if (!sameIdentity(parent, observedParent)) {
    closeWindowsHandle(handle);
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during relative directory open.`);
  }
  windowsIdentity(handle, absolutePath, label);
  return handle;
}

function windowsOpenRelativeNoFollowEntry(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  absolutePath: string,
  kind: 'directory' | 'file' | 'link',
  label: string
): bigint {
  const object = windowsRelativeLeafObjectAttributes(parentHandle, name);
  const handleBuffer = Buffer.alloc(8);
  const ioStatus = Buffer.alloc(16);
  const kindOption = kind === 'directory' ? WINDOWS_FILE_DIRECTORY_FILE
    : kind === 'file' ? WINDOWS_FILE_NON_DIRECTORY_FILE : 0;
  const status = requireWindowsNtdll().symbols.NtCreateFile(
    handleBuffer,
    WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_FILE_READ_EA | WINDOWS_FILE_WRITE_ATTRIBUTES |
      WINDOWS_DELETE | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE,
    object.objectAttributes,
    ioStatus,
    null,
    WINDOWS_FILE_ATTRIBUTE_NORMAL,
    WINDOWS_SHARE_READ_WRITE_DELETE,
    WINDOWS_FILE_OPEN,
    kindOption | WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT | WINDOWS_FILE_OPEN_REPARSE_POINT_NT,
    null,
    0
  );
  if (status < 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative no-follow open failed (NTSTATUS ${status}).`);
  }
  const handle = handleBuffer.readBigUInt64LE(0);
  if (handle === 0n || handle === WINDOWS_INVALID_HANDLE) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative no-follow open returned no handle.`);
  }
  const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent`);
  if (!sameIdentity(parent, observedParent)) {
    closeWindowsHandle(handle);
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during relative no-follow open.`);
  }
  windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
  return handle;
}

function windowsWriteRetainedFile(handle: bigint, bytes: Uint8Array, label: string): void {
  const library = requireWindowsKernel32();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const span = Math.min(64 * 1024, bytes.byteLength - offset);
    const written = Buffer.alloc(4);
    if (library.symbols.WriteFile(handle, Buffer.from(bytes.subarray(offset, offset + span)), span, written, null) === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained handle write failed (Win32 ${library.symbols.GetLastError()}).`);
    }
    const count = written.readUInt32LE(0);
    if (count === 0 || count > span) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained handle short write.`);
    offset += count;
  }
  if (library.symbols.FlushFileBuffers(handle) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained file flush failed (Win32 ${library.symbols.GetLastError()}).`);
  }
}

function windowsRewindRetainedFile(handle: bigint, label: string): void {
  if (requireWindowsKernel32().symbols.SetFilePointerEx(handle, 0n, null, 0) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained handle rewind failed (Win32 ${requireWindowsKernel32().symbols.GetLastError()}).`);
  }
}

function windowsReadRelativeOrdinaryLeaf(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  label: string
): Uint8Array | null {
  const absolutePath = path.join(parent.path, name);
  const handle = windowsOpenRelativeLeaf(parentHandle, parent, name, absolutePath, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, label, true);
  if (handle === null) return null;
  try {
    windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
    const bytes = readWindowsRetainedFile(handle, label);
    const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent readback`);
    if (!sameIdentity(parent, observedParent)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during retained readback.`);
    return bytes;
  } finally {
    closeWindowsHandle(handle);
  }
}

function windowsScanLeafIdentity(
  absolutePath: string,
  kind: 'directory' | 'file' | 'link',
  label: string
): Readonly<{ device: string; inode: string }> {
  const handle = windowsOpenNoFollowLeaf(absolutePath, label, WINDOWS_GENERIC_READ);
  try {
    return windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
  } finally {
    closeWindowsHandle(handle);
  }
}

function windowsRetainedLeafIdentity(
  handle: bigint,
  absolutePath: string,
  kind: 'directory' | 'file' | 'link',
  label: string
): Readonly<{ device: string; inode: string }> {
  const library = requireWindowsKernel32();
  const tag = Buffer.alloc(8);
  if (library.symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ATTRIBUTE_TAG_INFO, tag, tag.byteLength) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} attributes cannot be proven.`);
  }
  const attributes = tag.readUInt32LE(0);
  const reparse = (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
  if ((kind === 'link' && !reparse) || (kind !== 'link' && reparse) ||
      (kind === 'directory' && (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) === 0) ||
      (kind === 'file' && (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) !== 0)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} kind changed before retained deletion.`);
  }
  const finalPath = windowsFinalPath(handle, label);
  if (windowsPathKey(finalPath) !== windowsPathKey(path.toNamespacedPath(absolutePath))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} escaped its exact lexical path.`);
  }
  const id = Buffer.alloc(24);
  if (library.symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ID_INFO, id, id.byteLength) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} identity cannot be proven.`);
  }
  return Object.freeze({ device: id.subarray(0, 8).toString('hex'), inode: id.subarray(8).toString('hex') });
}

function windowsRetainedReparseObservationV1(
  handle: bigint,
  label: string
): Readonly<{ size: number; linkTarget: string }> {
  const library = requireWindowsKernel32();
  const output = Buffer.alloc(WINDOWS_MAXIMUM_REPARSE_DATA_BUFFER_SIZE);
  const returned = Buffer.alloc(4);
  if (library.symbols.DeviceIoControl(
    handle,
    WINDOWS_FSCTL_GET_REPARSE_POINT,
    null,
    0,
    output,
    output.byteLength,
    returned,
    null
  ) === 0) {
    const lastError = library.symbols.GetLastError();
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} reparse bytes cannot be proven (Win32 ${lastError}).`);
  }
  const size = returned.readUInt32LE(0);
  if (size < 8 || size > output.byteLength) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} returned malformed reparse bytes.`);
  }
  return Object.freeze({
    size,
    linkTarget: `windows-reparse-sha256:${createHash('sha256').update(output.subarray(0, size)).digest('hex')}`
  });
}

function windowsScanRetainedEntry(absolutePath: string, label: string): NoFollowDirectoryTreeEntryV1 {
  const handle = windowsOpenNoFollowLeaf(absolutePath, label, WINDOWS_GENERIC_READ);
  try {
    const tag = Buffer.alloc(8);
    if (requireWindowsKernel32().symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ATTRIBUTE_TAG_INFO, tag, tag.byteLength) === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} attributes cannot be proven.`);
    }
    const attributes = tag.readUInt32LE(0);
    const kind: NoFollowDirectoryTreeEntryKindV1 = (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0
      ? 'link' : (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) !== 0 ? 'directory' : 'file';
    const identity = windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
    const bytes = kind === 'file' ? readWindowsRetainedFile(handle, label) : null;
    const reparse = kind === 'link' ? windowsRetainedReparseObservationV1(handle, label) : null;
    return Object.freeze({
      relativePath: '', kind, ...identity, size: bytes?.byteLength ?? reparse?.size ?? 0, bytes,
      linkTarget: reparse?.linkTarget ?? null
    });
  } finally {
    closeWindowsHandle(handle);
  }
}

function windowsInventoryRetainedEntry(
  absolutePath: string,
  label: string
): Omit<NoFollowDirectoryTreeInventoryEntryV1, 'relativePath'> {
  const handle = windowsOpenNoFollowLeaf(absolutePath, label, WINDOWS_GENERIC_READ);
  try {
    const tag = Buffer.alloc(8);
    if (requireWindowsKernel32().symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ATTRIBUTE_TAG_INFO, tag, tag.byteLength) === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} attributes cannot be proven.`);
    }
    const attributes = tag.readUInt32LE(0);
    const kind: NoFollowDirectoryTreeEntryKindV1 = (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0
      ? 'link' : (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) !== 0 ? 'directory' : 'file';
    const identity = windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
    const content = kind === 'file'
      ? digestWindowsRetainedFile(handle, absolutePath, identity, label)
      : kind === 'link'
        ? Object.freeze({ ...windowsRetainedReparseObservationV1(handle, label), contentDigest: null })
        : Object.freeze({ size: 0, contentDigest: null, linkTarget: null });
    return Object.freeze({ kind, ...identity, ...content, linkTarget: 'linkTarget' in content ? content.linkTarget : null });
  } finally {
    closeWindowsHandle(handle);
  }
}

function windowsMetadataRetainedEntry(
  absolutePath: string,
  label: string
): Omit<NoFollowDirectoryTreeInventoryEntryV1, 'relativePath'> {
  const handle = windowsOpenNoFollowLeaf(absolutePath, label, WINDOWS_GENERIC_READ);
  try {
    const tag = Buffer.alloc(8);
    if (requireWindowsKernel32().symbols.GetFileInformationByHandleEx(
      handle,
      WINDOWS_FILE_ATTRIBUTE_TAG_INFO,
      tag,
      tag.byteLength
    ) === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} attributes cannot be proven.`);
    }
    const attributes = tag.readUInt32LE(0);
    const kind: NoFollowDirectoryTreeEntryKindV1 = (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0
      ? 'link' : (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) !== 0 ? 'directory' : 'file';
    const identity = windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
    const observation = kind === 'file'
      ? windowsRetainedFileSnapshotV1(handle, label)
      : kind === 'link'
        ? windowsRetainedReparseObservationV1(handle, label)
        : Object.freeze({ size: 0n, linkTarget: null });
    const rawSize = typeof observation.size === 'bigint' ? observation.size : BigInt(observation.size);
    if (rawSize < 0n || rawSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the metadata inventory domain.`);
    }
    return Object.freeze({
      kind,
      ...identity,
      size: Number(rawSize),
      contentDigest: null,
      linkTarget: 'linkTarget' in observation ? observation.linkTarget : null
    });
  } finally {
    closeWindowsHandle(handle);
  }
}

function windowsMarkRetainedLeafForDelete(handle: bigint, label: string): void {
  const library = requireWindowsKernel32();
  const extended = Buffer.alloc(4);
  extended.writeUInt32LE(
    WINDOWS_FILE_DISPOSITION_FLAG_DELETE | WINDOWS_FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
    0
  );
  if (library.symbols.SetFileInformationByHandle(
    handle, WINDOWS_FILE_DISPOSITION_INFO_EX, extended, extended.byteLength
  ) === 0) {
    const lastError = library.symbols.GetLastError();
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} requires FileDispositionInfoEx with IGNORE_READONLY_ATTRIBUTE (Win32 ${lastError}).`
    );
  }
}

function windowsRenameRetainedDirectory(
  sourceHandle: bigint,
  expectedSource: PhysicalDirectoryIdentityV1,
  targetParentHandle: bigint,
  destinationLeafName: string,
  label: string
): void {
  const before = windowsIdentity(sourceHandle, expectedSource.path, label);
  if (!sameIdentity(expectedSource, before)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before handle rename.`);
  }
  ensureLeafName(destinationLeafName);
  const fileName = Buffer.from(destinationLeafName, 'utf16le');
  // The documented byte count excludes the terminator, but kernel32's
  // FileRenameInfo marshaller requires backing storage for it on this host.
  const name = Buffer.concat([fileName, Buffer.alloc(2)]);
  // FILE_RENAME_INFO_EX on 64-bit Windows: Flags(4), pad(4), RootDirectory(8),
  // FileNameLength(4), FileName.  RootDirectory is the same verified parent
  // handle retained across the effect.  This is not a path lookup: the only
  // destination component is the validated tombstone leaf.
  // `FILE_RENAME_INFO` has tail padding on Win64 (sizeof is 24 even though
  // FileName begins at byte 20).  Supply that canonical backing size plus the
  // NUL-backed leaf bytes; a 20-byte header is rejected by kernel32 with 87.
  const info = Buffer.alloc(24 + name.byteLength);
  info.writeUInt32LE(0, 0);
  info.writeBigUInt64LE(targetParentHandle, 8);
  info.writeUInt32LE(fileName.byteLength, 16);
  name.copy(info, 20);
  const ioStatus = Buffer.alloc(16);
  const exStatus = requireWindowsNtdll().symbols.NtSetInformationFile(
    sourceHandle, ioStatus, info, info.byteLength, WINDOWS_NT_FILE_RENAME_INFORMATION_EX
  );
  if (exStatus >= 0) return;
  // FileRenameInformation is the native non-Ex compatibility class.  Both
  // calls retain the source handle and root-relative parent handle; neither
  // resolves a destination path through kernel32.
  info.writeUInt8(0, 0);
  const legacyStatus = requireWindowsNtdll().symbols.NtSetInformationFile(
    sourceHandle, ioStatus, info, info.byteLength, WINDOWS_NT_FILE_RENAME_INFORMATION
  );
  if (legacyStatus < 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} native handle rename failed (NTSTATUS ${exStatus}; ${legacyStatus}).`);
  }
}

/** Rename a retained ordinary source file through a retained parent handle. */
function windowsRenameRetainedOrdinaryFile(
  sourceHandle: bigint,
  sourcePath: string,
  sourceIdentity: Readonly<{ device: string; inode: string }>,
  targetParentHandle: bigint,
  destinationLeafName: string,
  replaceExisting: boolean,
  label: string
): void {
  const before = windowsRetainedLeafIdentity(sourceHandle, sourcePath, 'file', label);
  if (before.device !== sourceIdentity.device || before.inode !== sourceIdentity.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed before handle rename.`);
  }
  ensureLeafName(destinationLeafName);
  const fileName = Buffer.from(destinationLeafName, 'utf16le');
  const name = Buffer.concat([fileName, Buffer.alloc(2)]);
  const info = Buffer.alloc(24 + name.byteLength);
  info.writeUInt32LE(replaceExisting ? 1 : 0, 0);
  info.writeBigUInt64LE(targetParentHandle, 8);
  info.writeUInt32LE(fileName.byteLength, 16);
  name.copy(info, 20);
  const ioStatus = Buffer.alloc(16);
  const exStatus = requireWindowsNtdll().symbols.NtSetInformationFile(
    sourceHandle, ioStatus, info, info.byteLength, WINDOWS_NT_FILE_RENAME_INFORMATION_EX
  );
  if (exStatus >= 0) return;
  // Legacy FileRenameInformation retains the same relative parent semantics;
  // its leading byte is ReplaceIfExists rather than the Ex flags field.
  info.writeUInt8(replaceExisting ? 1 : 0, 0);
  const legacyStatus = requireWindowsNtdll().symbols.NtSetInformationFile(
    sourceHandle, ioStatus, info, info.byteLength, WINDOWS_NT_FILE_RENAME_INFORMATION
  );
  if (legacyStatus < 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} native retained-file rename failed (NTSTATUS ${exStatus}; ${legacyStatus}).`);
  }
}

function windowsFlushRetainedDirectory(handle: bigint, expected: PhysicalDirectoryIdentityV1, label: string): void {
  const observed = windowsIdentity(handle, expected.path, label);
  if (!sameIdentity(expected, observed)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before durability barrier.`);
  }
  // Windows does not support a portable directory FlushFileBuffers contract:
  // NTFS/ReFS commonly reject it for a correctly retained directory handle.
  // File publication instead flushes the retained source file before and
  // after native root-relative rename, then proves final FileId/readback.
}

function streamCanonicalHexContentDigestV1(
  readChunk: (chunk: Buffer) => number,
  expectedSize: bigint,
  label: string
): Readonly<{ size: number; contentDigest: `sha256:${string}` }> {
  if (expectedSize < 0n || expectedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the exact inventory number domain.`);
  }
  const hash = createHash('sha256');
  // This is exactly JSON.stringify(canonicalJson({ bytes: lowerHex })).
  // Keep the framing here so streaming and historical in-memory inventory
  // generations remain byte-identical.
  hash.update('{"bytes":"');
  const chunk = Buffer.alloc(64 * 1024);
  let total = 0;
  for (;;) {
    const count = readChunk(chunk);
    if (!Number.isInteger(count) || count < 0 || count > chunk.byteLength) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} returned an invalid retained read length.`);
    }
    if (count === 0) break;
    total += count;
    if (!Number.isSafeInteger(total) || BigInt(total) > expectedSize) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} grew during retained streaming inventory.`);
    }
    hash.update(chunk.subarray(0, count).toString('hex'));
  }
  if (BigInt(total) !== expectedSize) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} size changed during retained streaming inventory.`);
  }
  hash.update('"}');
  return Object.freeze({ size: total, contentDigest: `sha256:${hash.digest('hex')}` });
}

function windowsRetainedFileSnapshotV1(
  handle: bigint,
  label: string
): Readonly<{ basic: string; size: bigint }> {
  const library = requireWindowsKernel32();
  const basic = Buffer.alloc(40);
  const standard = Buffer.alloc(24);
  if (library.symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_BASIC_INFO, basic, basic.byteLength) === 0 ||
      library.symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_STANDARD_INFO, standard, standard.byteLength) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} stable file metadata cannot be proven.`);
  }
  // LastAccessTime may advance as a consequence of this retained read and is
  // not a content mutation fence.  Creation, last-write, change time and
  // attributes remain stable inputs.
  const stableBasic = Buffer.concat([basic.subarray(0, 8), basic.subarray(16, 40)]).toString('hex');
  return Object.freeze({ basic: stableBasic, size: standard.readBigInt64LE(8) });
}

function digestWindowsRetainedFile(
  handle: bigint,
  absolutePath: string,
  identity: Readonly<{ device: string; inode: string }>,
  label: string
): Readonly<{ size: number; contentDigest: `sha256:${string}` }> {
  const beforeIdentity = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
  if (beforeIdentity.device !== identity.device || beforeIdentity.inode !== identity.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before retained streaming inventory.`);
  }
  const before = windowsRetainedFileSnapshotV1(handle, label);
  const library = requireWindowsKernel32();
  const received = Buffer.alloc(4);
  const result = streamCanonicalHexContentDigestV1((chunk) => {
    if (library.symbols.ReadFile(handle, chunk, chunk.byteLength, received, null) === 0) {
      const lastError = library.symbols.GetLastError();
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} retained streaming read failed (Win32 ${lastError}).`);
    }
    return received.readUInt32LE(0);
  }, before.size, label);
  const after = windowsRetainedFileSnapshotV1(handle, label);
  const afterIdentity = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
  if (after.basic !== before.basic || after.size !== before.size ||
      afterIdentity.device !== identity.device || afterIdentity.inode !== identity.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} changed during retained streaming inventory.`);
  }
  return result;
}

function readWindowsRetainedFile(handle: bigint, label: string): Uint8Array {
  const library = requireWindowsKernel32();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.alloc(64 * 1024);
    const received = Buffer.alloc(4);
    if (library.symbols.ReadFile(handle, chunk, chunk.byteLength, received, null) === 0) {
      const lastError = library.symbols.GetLastError();
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} retained handle read failed (Win32 ${lastError}).`);
    }
    const count = received.readUInt32LE(0);
    if (count === 0) break;
    total += count;
    if (total > NO_FOLLOW_FILE_READ_LIMIT_BYTES) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} exceeds the bounded no-follow read size.`);
    }
    chunks.push(chunk.subarray(0, count));
    if (count < chunk.byteLength) break;
  }
  return Buffer.concat(chunks, total);
}

function readLinuxRetainedFile(fd: number, label: string): Uint8Array {
  const initial = fstatSync(fd, { bigint: true });
  if (!initial.isFile()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} is not an ordinary file.`);
  if (initial.size > BigInt(NO_FOLLOW_FILE_READ_LIMIT_BYTES)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} exceeds the bounded no-follow read size.`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.alloc(64 * 1024);
    const count = readSync(fd, chunk, 0, chunk.byteLength, null);
    if (count === 0) break;
    total += count;
    if (total > NO_FOLLOW_FILE_READ_LIMIT_BYTES) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} exceeds the bounded no-follow read size.`);
    }
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

function digestRetainedOrdinaryFileFdV1(
  fd: number,
  expected: Readonly<{ device: string; inode: string }>,
  label: string
): Readonly<{ size: number; contentDigest: `sha256:${string}` }> {
  const before = fstatSync(fd, { bigint: true });
  if (!before.isFile() || String(before.dev) !== expected.device || String(before.ino) !== expected.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before retained streaming inventory.`);
  }
  const result = streamCanonicalHexContentDigestV1(
    (chunk) => readSync(fd, chunk, 0, chunk.byteLength, null), before.size, label
  );
  const after = fstatSync(fd, { bigint: true });
  if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mode !== before.mode || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} changed during retained streaming inventory.`);
  }
  return result;
}

function closeWindowsHandle(handle: bigint): void {
  if (requireWindowsKernel32().symbols.CloseHandle(handle) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'CloseHandle failed after physical operation.');
  }
}

function inspectWindowsDirectoryChain(absolutePath: string, label: string): PhysicalDirectoryChainV1 {
  const parsed = path.win32.parse(absolutePath);
  let current = parsed.root;
  const ancestors: PhysicalDirectoryIdentityV1[] = [];
  for (const segment of absolutePath.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean)) {
    current = path.win32.join(current, segment);
    const handle = windowsOpenDirectory(current, label);
    try {
      ancestors.push(windowsIdentity(handle, current, label));
    } finally {
      closeWindowsHandle(handle);
    }
  }
  if (ancestors.length === 0) {
    const handle = windowsOpenDirectory(absolutePath, label);
    try { ancestors.push(windowsIdentity(handle, absolutePath, label)); } finally { closeWindowsHandle(handle); }
  }
  return Object.freeze({ target: ancestors[ancestors.length - 1]!, ancestors: Object.freeze(ancestors) });
}

function inspectLinuxDirectoryChain(absolutePath: string, label: string): PhysicalDirectoryChainV1 {
  const rootFd = linuxOpenRoot(label);
  let parentFd = rootFd;
  let current = path.parse(absolutePath).root;
  const ancestors: PhysicalDirectoryIdentityV1[] = [];
  try {
    for (const segment of absolutePath.slice(current.length).split('/').filter(Boolean)) {
      const nextFd = linuxOpenAt(parentFd, segment, label);
      if (parentFd !== rootFd) closeSync(parentFd);
      parentFd = nextFd;
      current = path.join(current, segment);
      ancestors.push(linuxIdentity(parentFd, current));
    }
    if (ancestors.length === 0) ancestors.push(linuxIdentity(rootFd, absolutePath));
    return Object.freeze({ target: ancestors[ancestors.length - 1]!, ancestors: Object.freeze(ancestors) });
  } finally {
    if (parentFd !== rootFd) closeSync(parentFd);
    closeSync(rootFd);
  }
}

/** Proves every component of an absolute directory path without link following. */
export function inspectNoFollowDirectoryChainV1(
  absoluteDirectoryPath: string,
  label = 'directory'
): PhysicalDirectoryChainV1 {
  const absolutePath = requireAbsoluteDirectoryPath(absoluteDirectoryPath, label);
  try {
    if (process.platform === 'win32') return inspectWindowsDirectoryChain(absolutePath, label);
    if (process.platform === 'linux') return inspectLinuxDirectoryChain(absolutePath, label);
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} has no trusted no-follow backend on ${process.platform}.`);
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) throw error;
    if (absent(error)) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`, error);
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} cannot be proven as an ordinary no-follow directory.`, error);
  }
}

/** Only a literal ENOENT is absence.  Dangling links and inaccessible paths remain unsafe. */
export function inspectExactNoFollowDirectoryPresenceV1(
  absoluteDirectoryPath: string,
  label = 'directory'
): ExactNoFollowDirectoryPresenceV1 {
  try {
    return Object.freeze({ state: 'present', directory: inspectNoFollowDirectoryChainV1(absoluteDirectoryPath, label) });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return Object.freeze({ state: 'absent' });
    }
    throw error;
  }
}

/** Re-observes the same lexical directory and rejects any physical substitution. */
export function assertSameNoFollowDirectoryIdentityV1(
  expected: PhysicalDirectoryIdentityV1,
  label = 'directory'
): PhysicalDirectoryChainV1 {
  const current = inspectNoFollowDirectoryChainV1(expected.path, label);
  if (!sameIdentity(expected, current.target)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} physical identity changed.`);
  }
  return current;
}

/**
 * Retains one fully-proven directory chain for repeated child-process reads.
 * The caller chooses the Linux child descriptor so multiple retained
 * directories can be inherited by the same child without an implicit global
 * descriptor convention. The capability is single-owner and must be disposed.
 */
export function retainNoFollowDirectoryForChildProcessV1(
  expected: PhysicalDirectoryChainV1,
  childDescriptor: number,
  label = 'child-process directory'
): RetainedNoFollowChildProcessDirectoryV1 {
  if (!Number.isSafeInteger(childDescriptor) || childDescriptor < 3 || childDescriptor > 64) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} child descriptor must be one bounded inherited descriptor.`
    );
  }
  const absolutePath = requireAbsoluteDirectoryPath(expected.target.path, label);
  if (expected.ancestors.length === 0 || !sameIdentity(expected.target, expected.ancestors.at(-1)!)
      || expected.ancestors.some((entry) => entry.schema !== PHYSICAL_NO_FOLLOW_SCHEMA_V1)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} expected chain is malformed.`);
  }

  if (process.platform === 'linux') {
    const rootFd = linuxOpenRoot(label);
    let directoryFd = rootFd;
    let disposed = false;
    try {
      const rootPath = path.parse(absolutePath).root;
      const segments = absolutePath.slice(rootPath.length).split('/').filter(Boolean);
      if (segments.length === 0) {
        const identity = linuxIdentity(rootFd, absolutePath);
        if (expected.ancestors.length !== 1 || !sameIdentity(expected.target, identity)
            || !sameIdentity(expected.ancestors[0]!, identity)) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} root identity changed.`);
        }
      } else {
        if (segments.length !== expected.ancestors.length) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} chain shape changed.`);
        }
        let currentPath = rootPath;
        for (const [index, segment] of segments.entries()) {
          const nextFd = linuxOpenAt(directoryFd, segment, label);
          if (directoryFd !== rootFd) closeSync(directoryFd);
          directoryFd = nextFd;
          currentPath = path.join(currentPath, segment);
          const current = linuxIdentity(directoryFd, currentPath);
          if (!sameIdentity(expected.ancestors[index]!, current)) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
          }
        }
      }
      const assertCurrent = (): void => {
        if (disposed) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        if (!sameIdentity(expected.target, linuxIdentity(directoryFd, absolutePath))) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity changed.`);
        }
      };
      return Object.freeze({
        childPath: `/proc/self/fd/${childDescriptor}`,
        stdioSourceDescriptor: directoryFd,
        assertCurrent,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          if (directoryFd !== rootFd) closeSync(directoryFd);
          closeSync(rootFd);
        }
      });
    } catch (error) {
      if (directoryFd !== rootFd) closeSync(directoryFd);
      closeSync(rootFd);
      throw error;
    }
  }

  if (process.platform === 'win32') {
    const parsed = path.win32.parse(absolutePath);
    const paths: string[] = [];
    let currentPath = parsed.root;
    for (const segment of absolutePath.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean)) {
      currentPath = path.win32.join(currentPath, segment);
      paths.push(currentPath);
    }
    if (paths.length === 0) paths.push(absolutePath);
    if (paths.length !== expected.ancestors.length) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} chain shape changed.`);
    }
    const handles: bigint[] = [];
    let disposed = false;
    try {
      const pinnedBoundaryStart = Math.max(0, paths.length - 2);
      for (const [index, current] of paths.entries()) {
        const currentLabel = `${label} ancestor[${index}] ${current}`;
        const handle = index >= pinnedBoundaryStart
          ? windowsOpenPinnedReadDirectory(current, currentLabel)
          : windowsOpenDirectory(current, currentLabel);
        handles.push(handle);
        if (!sameIdentity(
          expected.ancestors[index]!,
          windowsIdentity(handle, current, currentLabel)
        )) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
        }
      }
      const targetHandle = handles.at(-1)!;
      const assertCurrent = (): void => {
        if (disposed) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        if (!sameIdentity(expected.target, windowsIdentity(targetHandle, absolutePath, label))) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity changed.`);
        }
      };
      return Object.freeze({
        childPath: absolutePath,
        stdioSourceDescriptor: null,
        assertCurrent,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          for (const handle of handles.reverse()) closeWindowsHandle(handle);
        }
      });
    } catch (error) {
      for (const handle of handles.reverse()) closeWindowsHandle(handle);
      throw error;
    }
  }

  throw physicalError(
    'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
    `${label} retained child-process backend is unavailable on ${process.platform}.`
  );
}

/** Retains one already-observed ordinary file for exact child-process reads. */
export function retainNoFollowOrdinaryFileForChildProcessV1(
  parent: PhysicalDirectoryChainV1,
  expected: NoFollowDirectoryTreeEntryV1,
  childDescriptor: number,
  label = 'child-process file'
): RetainedNoFollowChildProcessFileV1 {
  ensureLeafName(expected.relativePath);
  if (expected.kind !== 'file' || !Number.isSafeInteger(childDescriptor)
      || childDescriptor < 3 || childDescriptor > 64) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} retention input is invalid.`);
  }
  const retainedParent = retainNoFollowDirectoryForChildProcessV1(parent, 64, `${label} parent`);
  const absolutePath = path.join(parent.target.path, expected.relativePath);
  if (process.platform === 'linux') {
    let descriptor: number | null = null;
    let disposed = false;
    try {
      descriptor = openSync(
        path.join(`/proc/self/fd/${retainedParent.stdioSourceDescriptor!}`, expected.relativePath),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC
      );
      const assertCurrent = (): void => {
        if (disposed || descriptor === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        const current = fstatSync(descriptor, { bigint: true });
        if (!current.isFile() || String(current.dev) !== expected.device || String(current.ino) !== expected.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity changed.`);
        }
        retainedParent.assertCurrent();
      };
      assertCurrent();
      return Object.freeze({
        childPath: `/proc/self/fd/${childDescriptor}`,
        stdioSourceDescriptor: descriptor,
        assertCurrent,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          closeSync(descriptor!);
          descriptor = null;
          retainedParent.dispose();
        }
      });
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      retainedParent.dispose();
      throw error;
    }
  }
  if (process.platform === 'win32') {
    let handle: bigint | null = null;
    let disposed = false;
    try {
      handle = windowsOpenPinnedReadFile(absolutePath, label);
      const retainedIdentity = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
      if (retainedIdentity.device !== expected.device || retainedIdentity.inode !== expected.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before retention.`);
      }
      const assertCurrent = (): void => {
        if (disposed || handle === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        const current = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
        if (current.device !== expected.device || current.inode !== expected.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity changed.`);
        }
        retainedParent.assertCurrent();
      };
      assertCurrent();
      return Object.freeze({
        childPath: absolutePath,
        stdioSourceDescriptor: null,
        assertCurrent,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          closeWindowsHandle(handle!);
          handle = null;
          retainedParent.dispose();
        }
      });
    } catch (error) {
      if (handle !== null) closeWindowsHandle(handle);
      retainedParent.dispose();
      throw error;
    }
  }
  retainedParent.dispose();
  throw physicalError(
    'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
    `${label} retained child-process backend is unavailable on ${process.platform}.`
  );
}

/**
 * Observes a directory tree without descending through a symlink or Windows
 * reparse directory.  Reparse descendants are represented as link entries so
 * the owning operation may unlink that exact entry but never traverse it.
 */
function metadataScanNamesV1(
  directory: string,
  observedEntries: number,
  options: Required<NoFollowDirectoryTreeMetadataOptionsV1>
): readonly string[] {
  const names: string[] = [];
  const handle = opendirSync(directory);
  try {
    for (;;) {
      if (performance.now() > options.deadlineAtMs) {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow metadata inventory deadline exceeded.');
      }
      const entry = handle.readSync();
      if (entry === null) break;
      if (observedEntries + names.length >= options.maximumEntries) {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow metadata inventory entry bound exceeded.');
      }
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return Object.freeze(names.sort((left, right) => left.localeCompare(right)));
}

function scanNoFollowDirectoryTreeInternalV1(
  root: PhysicalDirectoryIdentityV1,
  fileMode: NoFollowDirectoryTreeFileModeV1,
  metadataOptions: Partial<NoFollowDirectoryTreeMetadataOptionsV1> = {}
): readonly InternalNoFollowDirectoryTreeEntryV1[] {
  const boundedMetadata = Object.freeze({
    deadlineAtMs: metadataOptions.deadlineAtMs ?? Number.POSITIVE_INFINITY,
    maximumEntries: metadataOptions.maximumEntries ?? 100_000
  });
  if (!Number.isFinite(boundedMetadata.deadlineAtMs) && boundedMetadata.deadlineAtMs !== Number.POSITIVE_INFINITY) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow metadata inventory deadline is invalid.');
  }
  if (!Number.isSafeInteger(boundedMetadata.maximumEntries) || boundedMetadata.maximumEntries < 1) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow metadata inventory entry bound is invalid.');
  }
  const target = assertSameNoFollowDirectoryIdentityV1(root, 'No-follow scan root').target;
  const entries: InternalNoFollowDirectoryTreeEntryV1[] = [];
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
        const names = fileMode === 'metadata-only'
          ? metadataScanNamesV1(`/proc/self/fd/${directoryFd}`, entries.length, boundedMetadata)
          : readdirSync(`/proc/self/fd/${directoryFd}`).sort((left, right) => left.localeCompare(right));
        for (const name of names) {
          if (name.includes('\0')) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Directory entry contains NUL.');
          const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
          const retained = linuxOpenLeafAt(directoryFd, name, 'No-follow scan leaf');
          try {
            const stat = fstatSync(retained, { bigint: true });
            const kind: NoFollowDirectoryTreeEntryKindV1 = stat.isSymbolicLink()
              ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : (() => {
                throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `Unsupported no-follow directory entry: ${relativePath}.`);
              })();
            let bytes: Uint8Array | null = null;
            let contentDigest: `sha256:${string}` | null = null;
            if (kind === 'file' && fileMode !== 'metadata-only') {
              const readable = linuxOpenReadableLeafAt(directoryFd, name, 'No-follow scan file');
              try {
                const readableBefore = fstatSync(readable, { bigint: true });
                if (readableBefore.dev !== stat.dev || readableBefore.ino !== stat.ino || !readableBefore.isFile()) {
                  throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow scan file changed before retained read.');
                }
                if (fileMode === 'bounded-bytes') {
                  bytes = readLinuxRetainedFile(readable, 'No-follow scan file');
                } else {
                  const streamed = digestRetainedOrdinaryFileFdV1(
                    readable, { device: String(stat.dev), inode: String(stat.ino) }, 'No-follow scan file'
                  );
                  contentDigest = streamed.contentDigest;
                }
                const readableAfter = fstatSync(readable, { bigint: true });
                if (readableAfter.dev !== stat.dev || readableAfter.ino !== stat.ino || !readableAfter.isFile()) {
                  throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow scan file changed during retained read.');
                }
              } finally { closeSync(readable); }
            }
            entries.push(Object.freeze({
              relativePath, kind, device: String(stat.dev), inode: String(stat.ino), size: Number(stat.size),
              bytes, contentDigest,
              linkTarget: kind === 'link'
                ? linuxReadRetainedLinkTargetV1(retained, 'No-follow scan retained link')
                : null
            }));
            if (kind === 'directory') visitRetained(retained, relativePath);
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
    assertSameNoFollowDirectoryIdentityV1(
      prefix.length === 0 ? target : inspectNoFollowDirectoryChainV1(directory, 'No-follow scan directory').target,
      'No-follow scan directory'
    );
    const names = fileMode === 'metadata-only'
      ? metadataScanNamesV1(directory, entries.length, boundedMetadata)
      : readdirSync(directory).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      if (name.includes('\0')) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Directory entry contains NUL.');
      const absolute = path.join(directory, name);
      const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
      if (process.platform === 'win32') {
        const scanned = fileMode === 'bounded-bytes'
          ? Object.freeze({ ...windowsScanRetainedEntry(absolute, 'No-follow scan entry'), contentDigest: null })
          : fileMode === 'metadata-only'
            ? Object.freeze({ ...windowsMetadataRetainedEntry(absolute, 'No-follow metadata entry'), bytes: null })
            : Object.freeze({ ...windowsInventoryRetainedEntry(absolute, 'No-follow inventory entry'), bytes: null });
        entries.push(Object.freeze({ ...scanned, relativePath }));
        if (scanned.kind === 'directory') visit(absolute, relativePath);
        continue;
      }
      const metadata = lstatSync(absolute, { bigint: true });
      const size = Number(metadata.size);
      if (metadata.isSymbolicLink()) {
        const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
        entries.push(Object.freeze({ relativePath, kind: 'link', ...identity, size, bytes: null, contentDigest: null, linkTarget: readlinkSync(absolute) }));
        continue;
      }
      if (metadata.isDirectory()) {
        try {
          inspectNoFollowDirectoryChainV1(absolute, 'No-follow scan descendant');
        } catch (error) {
          if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH') {
            const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
            entries.push(Object.freeze({ relativePath, kind: 'link', ...identity, size, bytes: null, contentDigest: null, linkTarget: null }));
            continue;
          }
          throw error;
        }
        const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
        entries.push(Object.freeze({ relativePath, kind: 'directory', ...identity, size, bytes: null, contentDigest: null, linkTarget: null }));
        visit(absolute, relativePath);
        continue;
      }
      if (metadata.isFile()) {
        const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
        if (fileMode === 'metadata-only') {
          entries.push(Object.freeze({
            relativePath, kind: 'file', ...identity, size,
            bytes: null, contentDigest: null, linkTarget: null
          }));
          continue;
        }
        const fd = openSync(
          absolute,
          fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
        );
        try {
          const retained = fstatSync(fd, { bigint: true });
          if (!retained.isFile() || String(retained.dev) !== identity.device || String(retained.ino) !== identity.inode) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `No-follow scan file changed before retained read: ${relativePath}.`);
          }
          if (fileMode === 'bounded-bytes') {
            entries.push(Object.freeze({
              relativePath, kind: 'file', ...identity, size,
              bytes: readLinuxRetainedFile(fd, 'No-follow scan file'), contentDigest: null, linkTarget: null
            }));
          } else {
            const streamed = digestRetainedOrdinaryFileFdV1(fd, identity, 'No-follow scan file');
            entries.push(Object.freeze({
              relativePath, kind: 'file', ...identity, size: streamed.size,
              bytes: null, contentDigest: streamed.contentDigest, linkTarget: null
            }));
          }
        } finally {
          closeSync(fd);
        }
        continue;
      }
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `Unsupported no-follow directory entry: ${relativePath}.`);
    }
  };
  visit(target.path, '');
  assertSameNoFollowDirectoryIdentityV1(target, 'No-follow scan root');
  return Object.freeze(entries);
}

/**
 * Bounded byte reader for canonical control and recovery trees.  Ordinary
 * files larger than the fixed read limit fail closed.
 */
export function scanNoFollowDirectoryTreeV1(
  root: PhysicalDirectoryIdentityV1
): readonly NoFollowDirectoryTreeEntryV1[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternalV1(root, 'bounded-bytes').map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    bytes: entry.bytes,
    linkTarget: entry.linkTarget
  })));
}

/**
 * Bounded-memory physical inventory.  File content is streamed in 64-KiB
 * chunks through the stable canonical digest domain; bytes are never retained.
 */
export function scanNoFollowDirectoryTreeInventoryV1(
  root: PhysicalDirectoryIdentityV1
): readonly NoFollowDirectoryTreeInventoryEntryV1[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternalV1(root, 'streaming-digest').map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest: entry.contentDigest,
    linkTarget: entry.linkTarget
  })));
}

/**
 * Retained metadata-only inventory for destructive convergence.  It never
 * opens ordinary leaves for content reads, and enumeration is bounded by both
 * a monotonic deadline and an entry ceiling supplied by the owning operation.
 */
export function scanNoFollowDirectoryTreeMetadataV1(
  root: PhysicalDirectoryIdentityV1,
  options: NoFollowDirectoryTreeMetadataOptionsV1
): readonly NoFollowDirectoryTreeInventoryEntryV1[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternalV1(root, 'metadata-only', options).map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest: null,
    linkTarget: entry.linkTarget
  })));
}

function createNoFollowDirectoryChainInternalV1(
  root: PhysicalDirectoryIdentityV1,
  segments: readonly string[]
): PhysicalDirectoryIdentityV1 {
  const rootChain = assertSameNoFollowDirectoryIdentityV1(root, 'No-follow directory creation root');
  let current = rootChain.target;
  if (process.platform === 'linux') {
    const transaction = linuxOpenWatchedCanonicalDirectoryChain(
      rootChain,
      'No-follow directory creation root'
    );
    try {
      for (const segment of segments) {
        const nextPath = path.join(current.path, segment);
        const opened = linuxOpenOrCreateDirectoryAt({
          parentFd: transaction.currentFd,
          parent: current,
          witness: linuxDirectoryCreateTransactionWitness(transaction),
          name: segment,
          absolutePath: nextPath,
          allowExisting: true,
          label: 'No-follow directory creation target'
        });
        linuxAdvanceDirectoryCreateTransaction(
          transaction,
          opened,
          'No-follow directory creation target'
        );
        current = transaction.current;
      }
      const witness = linuxDirectoryCreateTransactionWitness(transaction);
      linuxAssertDirectoryCreateWitness(
        witness,
        linuxReadDirectoryMutationEvents(witness, 'No-follow directory creation final readback'),
        '',
        false,
        'No-follow directory creation final readback'
      );
      return current;
    } finally {
      linuxCloseDirectoryCreateTransaction(transaction);
    }
  }
  if (process.platform === 'win32') {
    for (const segment of segments) {
      const parent = current;
      const nextPath = path.join(current.path, segment);
      const parentHandle = windowsOpenDirectory(current.path, 'No-follow directory creation parent', true);
      let nextHandle: bigint | null = null;
      try {
        if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'No-follow directory creation parent'))) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation parent changed before relative create.');
        }
        nextHandle = windowsOpenRelativeDirectory(
          parentHandle, parent, segment, nextPath, WINDOWS_FILE_CREATE, 'No-follow directory creation target'
        );
        if (nextHandle === null) {
          nextHandle = windowsOpenRelativeDirectory(
            parentHandle, parent, segment, nextPath, WINDOWS_FILE_OPEN, 'No-follow directory creation target'
          );
        }
        if (nextHandle === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', 'No-follow directory creation target disappeared.');
        current = windowsIdentity(nextHandle, nextPath, 'No-follow directory creation target');
        windowsFlushRetainedDirectory(parentHandle, parent, 'No-follow directory creation parent');
      } finally {
        if (nextHandle !== null) closeWindowsHandle(nextHandle);
        closeWindowsHandle(parentHandle);
      }
    }
    return current;
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Retained no-follow directory creation is unavailable on this platform.');
}

/** Creates only canonical SEC namespace components beneath an already-proven directory. */
export function createNoFollowDirectoryChainV1(
  root: PhysicalDirectoryIdentityV1,
  segments: readonly string[]
): PhysicalDirectoryIdentityV1 {
  for (const segment of segments) {
    if (segment !== '.tmp' && !/^[a-z0-9-]+$/u.test(segment)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow directory creation segment is invalid.');
    }
  }
  return createNoFollowDirectoryChainInternalV1(root, segments);
}

function ensureOrdinaryDirectorySegmentV1(segment: string): void {
  if (typeof segment !== 'string' || segment.length === 0 || segment.length > 255
    || segment === '.' || segment === '..' || /[\\/\0]/u.test(segment)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Ordinary no-follow directory segment is invalid.');
  }
  if (process.platform === 'win32') {
    const base = segment.split('.')[0]!.toLocaleUpperCase('en-US');
    if (/[:<>"|?*]/u.test(segment) || /[ .]$/u.test(segment)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Ordinary no-follow directory segment is invalid on Windows.');
    }
  }
}

/**
 * Materializes ordinary host path components without following aliases. This
 * is the path-allocation primitive for external runtime roots whose existing
 * parent names are not SEC-controlled lowercase namespace identifiers.
 */
export function createNoFollowOrdinaryDirectoryChainV1(
  root: PhysicalDirectoryIdentityV1,
  segments: readonly string[]
): PhysicalDirectoryIdentityV1 {
  for (const segment of segments) ensureOrdinaryDirectorySegmentV1(segment);
  return createNoFollowDirectoryChainInternalV1(root, segments);
}

/**
 * Opens one already-existing ordinary directory relative to a retained parent.
 * This is deliberately inspect-only: an absent child never becomes a create
 * effect, which lets a delegated consumer adopt an issuer-created inode
 * without acquiring directory-creation authority.
 */
export function inspectNoFollowDirectoryChildV1(
  parentInput: PhysicalDirectoryIdentityV1,
  name: string,
  label = 'No-follow directory child'
): PhysicalDirectoryIdentityV1 | null {
  if (!/^[a-z0-9-]+$/u.test(name)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} name is invalid.`);
  }
  const parent = assertSameNoFollowDirectoryIdentityV1(parentInput, `${label} parent`).target;
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
 * Creates exactly one absent ordinary directory relative to a retained parent.
 * Existing names are never adopted: an EEXIST/name collision is a foreign
 * effect boundary, not a successful retry.
 */
export function createExclusiveNoFollowDirectoryV1(
  parentInput: PhysicalDirectoryIdentityV1,
  name: string
): PhysicalDirectoryIdentityV1 {
  if (!/^[a-z0-9-]+$/u.test(name)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Exclusive no-follow directory name is invalid.');
  }
  const parentChain = assertSameNoFollowDirectoryIdentityV1(
    parentInput,
    'Exclusive no-follow directory parent'
  );
  const parent = parentChain.target;
  const absolutePath = path.join(parent.path, name);
  if (process.platform === 'linux') {
    const transaction = linuxOpenWatchedCanonicalDirectoryChain(
      parentChain,
      'Exclusive no-follow directory parent'
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
        label: 'Exclusive no-follow directory'
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

function ensureLeafName(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value === '.' || value === '..' ||
    value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Durable publication file name must be one ordinary leaf name.');
  }
}

function syncDirectory(parent: PhysicalDirectoryIdentityV1): void {
  assertSameNoFollowDirectoryIdentityV1(parent, 'Durable publication parent');
  if (process.platform === 'linux') {
    const chain = inspectLinuxDirectoryChain(parent.path, 'Durable publication parent');
    if (!sameIdentity(parent, chain.target)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable publication parent changed before fsync.');
    }
    const fd = linuxOpenRoot('Durable publication parent');
    let currentFd = fd;
    try {
      const segments = parent.path.slice(path.parse(parent.path).root.length).split('/').filter(Boolean);
      for (const segment of segments) {
        const next = linuxOpenAt(currentFd, segment, 'Durable publication parent');
        if (currentFd !== fd) closeSync(currentFd);
        currentFd = next;
      }
      if (requireLinuxLibc().symbols.fsync(currentFd) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Linux parent directory fsync failed.');
      }
      assertSameNoFollowDirectoryIdentityV1(chain.target, 'Durable publication parent');
    } finally {
      if (currentFd !== fd) closeSync(currentFd);
      closeSync(fd);
    }
    return;
  }
  if (process.platform === 'win32') {
    const handle = windowsOpenDirectory(parent.path, 'Durable publication parent', true);
    try {
      const checked = windowsIdentity(handle, parent.path, 'Durable publication parent');
      if (!sameIdentity(parent, checked)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable publication parent changed before FlushFileBuffers.');
      }
      // NTFS/ReFS commonly reject FlushFileBuffers on directory handles.  The
      // Windows publication path flushes its retained source file before and
      // after native root-relative rename, then proves the final FileId.
      // This call remains an identity fence, not a false POSIX fsync claim.
    } finally {
      closeWindowsHandle(handle);
    }
    return;
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Directory durability backend is unavailable.');
}

function bytesDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function linuxRetainedPublicationParent(parent: PhysicalDirectoryIdentityV1, label: string): { rootFd: number; parentFd: number } {
  const retained = linuxOpenRetainedAbsoluteDirectory(parent.path, label);
  const observed = linuxIdentity(retained.directoryFd, parent.path);
  if (!sameIdentity(parent, observed)) {
    if (retained.directoryFd !== retained.filesystemRootFd) closeSync(retained.directoryFd);
    closeSync(retained.filesystemRootFd);
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent identity changed.`);
  }
  return Object.freeze({ rootFd: retained.filesystemRootFd, parentFd: retained.directoryFd });
}

function closeLinuxRetainedPublicationParent(input: { rootFd: number; parentFd: number }): void {
  if (input.parentFd !== input.rootFd) closeSync(input.parentFd);
  closeSync(input.rootFd);
}

function windowsRetainedPublicationParent(parent: PhysicalDirectoryIdentityV1, label: string): bigint {
  const handle = windowsOpenDirectory(parent.path, label, true);
  try {
    const observed = windowsIdentity(handle, parent.path, label);
    if (!sameIdentity(parent, observed)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent identity changed.`);
    return handle;
  } catch (error) {
    closeWindowsHandle(handle);
    throw error;
  }
}

function windowsReadRenamedCandidate(
  sourceHandle: bigint,
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentityV1,
  finalName: string,
  expected: Buffer,
  label: string
): Uint8Array {
  const finalPath = path.join(parent.path, finalName);
  windowsRetainedLeafIdentity(sourceHandle, finalPath, 'file', label);
  // A second file flush after the atomic metadata transition is the supported
  // Windows retained-handle durability barrier.  We intentionally do not
  // pretend that FlushFileBuffers on a directory is portable.
  if (requireWindowsKernel32().symbols.FlushFileBuffers(sourceHandle) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} renamed file flush failed (Win32 ${requireWindowsKernel32().symbols.GetLastError()}).`);
  }
  windowsRewindRetainedFile(sourceHandle, label);
  const current = readWindowsRetainedFile(sourceHandle, label);
  if (!Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained final readback differs.`);
  const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent readback`);
  if (!sameIdentity(parent, observedParent)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during final readback.`);
  return current;
}

function linuxCreateCandidateAt(parentFd: number, name: string, expected: Buffer, label: string): number {
  const fd = requireLinuxLibc().symbols.openat(
    parentFd, Buffer.from(`${name}\0`, 'utf8'),
    LINUX_O_WRONLY | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC | LINUX_O_CREAT | LINUX_O_EXCL,
    0o600
  );
  if (fd < 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} candidate create failed (errno ${linuxErrno()}).`);
  try { writeFileSync(fd, expected); fsyncSync(fd); } catch (error) { closeSync(fd); throw error; }
  return fd;
}

/**
 * Publishes one immutable, canonical file below an already-proven parent.
 * The final name is created via a retained-parent no-replace rename, so an
 * existing value is never replaced and no final-plus-candidate alias exists.
 * The parent is identity-checked before and after every effect.
 */
export function publishExclusiveDurableCanonicalFileV1(input: {
  readonly parent: PhysicalDirectoryIdentityV1;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly validate: (bytes: Uint8Array) => void;
}): Readonly<{ path: string; digest: string; created: boolean }> {
  ensureLeafName(input.name);
  const parent = assertSameNoFollowDirectoryIdentityV1(input.parent, 'Durable publication parent').target;
  const finalPath = path.join(parent.path, input.name);
  const expected = Buffer.from(input.bytes);
  input.validate(expected);
  const expectedDigest = bytesDigest(expected);

  const existing = (): Readonly<{ path: string; digest: string; created: boolean }> => {
    const current = readNoFollowOrdinaryFileV1(parent, input.name);
    if (current === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', 'Durable publication target disappeared before no-follow readback.');
    input.validate(current);
    if (!Buffer.from(current).equals(expected)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable publication target conflicts with canonical bytes.');
    }
    // An already-present byte-identical file is not a proof that a previous
    // publication reached the required parent-directory durability boundary.
    syncDirectory(parent);
    assertSameNoFollowDirectoryIdentityV1(parent, 'Durable publication parent');
    return Object.freeze({ path: finalPath, digest: expectedDigest, created: false });
  };

  if (process.platform === 'linux') {
    const retained = linuxRetainedPublicationParent(parent, 'Exclusive durable publication');
    const temporaryName = `.${input.name}.${randomUUID()}.candidate`;
    let candidateFd: number | null = null;
    let candidateCreated = false;
    try {
      candidateFd = linuxCreateCandidateAt(retained.parentFd, temporaryName, expected, 'Exclusive durable publication');
      candidateCreated = true;
      closeSync(candidateFd); candidateFd = null;
      if (requireLinuxLibc().symbols.renameat2(
        retained.parentFd, Buffer.from(`${temporaryName}\0`, 'utf8'),
        retained.parentFd, Buffer.from(`${input.name}\0`, 'utf8'), LINUX_RENAME_NOREPLACE
      ) !== 0) {
        if (linuxErrno() === 17) return existing();
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Exclusive durable publication renameat2 no-replace failed (errno ${linuxErrno()}).`);
      }
      candidateCreated = false;
      if (requireLinuxLibc().symbols.fsync(retained.parentFd) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication parent fsync failed.');
      }
      const current = readNoFollowOrdinaryFileV1(parent, input.name);
      if (current === null || !Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication retained readback differs.');
      input.validate(current);
      return Object.freeze({ path: finalPath, digest: expectedDigest, created: true });
    } finally {
      if (candidateFd !== null) closeSync(candidateFd);
      try {
        if (candidateCreated) {
          // A failure or existing final name can leave the unpublished
          // candidate behind in this process.  Normal completion moves the
          // only name atomically with RENAME_NOREPLACE, so it never creates a
          // durable final-plus-candidate hard-link state.
          if (requireLinuxLibc().symbols.unlinkat(retained.parentFd, Buffer.from(`${temporaryName}\0`, 'utf8'), 0) !== 0) {
            throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Exclusive durable publication candidate cleanup failed (errno ${linuxErrno()}).`);
          }
          if (requireLinuxLibc().symbols.fsync(retained.parentFd) !== 0) {
            throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication candidate cleanup fsync failed.');
          }
        }
      } finally {
        closeLinuxRetainedPublicationParent(retained);
      }
    }
  }
  if (process.platform !== 'win32') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Exclusive durable publication backend is unavailable on this platform.');
  }

  const parentHandle = windowsRetainedPublicationParent(parent, 'Exclusive durable publication');
  const temporaryName = `.${input.name}.${randomUUID()}.candidate`;
  const temporaryPath = path.join(parent.path, temporaryName);
  let candidate: bigint | null = null;
  let renamed = false;
  try {
    candidate = windowsOpenRelativeLeaf(
      parentHandle, parent, temporaryName, temporaryPath,
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
      WINDOWS_FILE_CREATE, 'Exclusive durable publication candidate'
    );
    if (candidate === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication candidate unexpectedly absent.');
    const candidateIdentity = windowsRetainedLeafIdentity(candidate, temporaryPath, 'file', 'Exclusive durable publication candidate');
    windowsWriteRetainedFile(candidate, expected, 'Exclusive durable publication candidate');
    try {
      windowsRenameRetainedOrdinaryFile(candidate, temporaryPath, candidateIdentity, parentHandle, input.name, false, 'Exclusive durable publication');
      renamed = true;
    } catch (error) {
      const current = windowsReadRelativeOrdinaryLeaf(parentHandle, parent, input.name, 'Exclusive durable publication existing');
      if (current === null) throw error;
      input.validate(current);
      if (!Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable publication target conflicts with canonical bytes.', error);
      return Object.freeze({ path: finalPath, digest: expectedDigest, created: false });
    }
    const current = windowsReadRenamedCandidate(candidate, parentHandle, parent, input.name, expected, 'Exclusive durable publication');
    input.validate(current);
    return Object.freeze({ path: finalPath, digest: expectedDigest, created: true });
  } finally {
    try {
      if (candidate !== null) {
        if (!renamed) windowsMarkRetainedLeafForDelete(candidate, 'Exclusive durable publication candidate cleanup');
        closeWindowsHandle(candidate);
        candidate = null;
        if (!renamed && windowsReadRelativeOrdinaryLeaf(
          parentHandle, parent, temporaryName, 'Exclusive durable publication candidate cleanup readback'
        ) !== null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication candidate remains after cleanup.');
        }
      }
    } finally {
      if (candidate !== null) closeWindowsHandle(candidate);
      closeWindowsHandle(parentHandle);
    }
  }
}

/**
 * Replaces a single canonical pointer only under a retained, revalidated
 * parent.  It is deliberately separate from immutable evidence publication:
 * callers first publish a generation file, then atomically advance this
 * pointer.  Windows uses a native source-handle rename rooted at the retained
 * parent handle, and both platforms perform exact no-follow readback before
 * returning.
 */
export function replaceDurableCanonicalFileV1(input: {
  readonly parent: PhysicalDirectoryIdentityV1;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly validate: (bytes: Uint8Array) => void;
}): Readonly<{ path: string; digest: string }> {
  ensureLeafName(input.name);
  const parent = assertSameNoFollowDirectoryIdentityV1(input.parent, 'Durable replacement parent').target;
  const finalPath = path.join(parent.path, input.name);
  const expected = Buffer.from(input.bytes);
  input.validate(expected);
  if (process.platform === 'linux') {
    const retained = linuxRetainedPublicationParent(parent, 'Durable replacement');
    const temporaryName = `.${input.name}.${randomUUID()}.replacement`;
    let candidateFd: number | null = null;
    try {
      candidateFd = linuxCreateCandidateAt(retained.parentFd, temporaryName, expected, 'Durable replacement');
      closeSync(candidateFd); candidateFd = null;
      if (requireLinuxLibc().symbols.renameat(
        retained.parentFd, Buffer.from(`${temporaryName}\0`, 'utf8'),
        retained.parentFd, Buffer.from(`${input.name}\0`, 'utf8')
      ) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Durable replacement renameat failed (errno ${linuxErrno()}).`);
      if (requireLinuxLibc().symbols.fsync(retained.parentFd) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable replacement parent fsync failed.');
      const current = readNoFollowOrdinaryFileV1(parent, input.name);
      if (current === null || !Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable replacement retained readback differs.');
      input.validate(current);
      return Object.freeze({ path: finalPath, digest: bytesDigest(expected) });
    } finally {
      if (candidateFd !== null) closeSync(candidateFd);
      requireLinuxLibc().symbols.unlinkat(retained.parentFd, Buffer.from(`${temporaryName}\0`, 'utf8'), 0);
      closeLinuxRetainedPublicationParent(retained);
    }
  }
  if (process.platform !== 'win32') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Durable replacement backend is unavailable on this platform.');
  }
  const parentHandle = windowsRetainedPublicationParent(parent, 'Durable replacement');
  const temporaryName = `.${input.name}.${randomUUID()}.replacement`;
  const temporaryPath = path.join(parent.path, temporaryName);
  let candidate: bigint | null = null;
  let renamed = false;
  try {
    candidate = windowsOpenRelativeLeaf(
      parentHandle, parent, temporaryName, temporaryPath,
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
      WINDOWS_FILE_CREATE, 'Durable replacement candidate'
    );
    if (candidate === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable replacement candidate unexpectedly absent.');
    const candidateIdentity = windowsRetainedLeafIdentity(candidate, temporaryPath, 'file', 'Durable replacement candidate');
    windowsWriteRetainedFile(candidate, expected, 'Durable replacement candidate');
    windowsRenameRetainedOrdinaryFile(candidate, temporaryPath, candidateIdentity, parentHandle, input.name, true, 'Durable replacement');
    renamed = true;
    const current = windowsReadRenamedCandidate(candidate, parentHandle, parent, input.name, expected, 'Durable replacement');
    input.validate(current);
    return Object.freeze({ path: finalPath, digest: bytesDigest(expected) });
  } finally {
    try {
      if (candidate !== null) {
        if (!renamed) windowsMarkRetainedLeafForDelete(candidate, 'Durable replacement candidate cleanup');
        closeWindowsHandle(candidate);
        candidate = null;
        if (!renamed && windowsReadRelativeOrdinaryLeaf(
          parentHandle, parent, temporaryName, 'Durable replacement candidate cleanup readback'
        ) !== null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable replacement candidate remains after cleanup.');
        }
      }
    } finally {
      if (candidate !== null) closeWindowsHandle(candidate);
      closeWindowsHandle(parentHandle);
    }
  }
}

/**
 * Moves one ordinary directory to an unused same-parent tombstone only after
 * its retained no-follow identity has been proven.  The source becomes
 * ENOENT before returning; callers retain the returned identity and must
 * relocate any protocol rooted inside it before destroying the tombstone.
 */
export function relocateRetainedNoFollowDirectoryV1(input: {
  readonly directory: PhysicalDirectoryIdentityV1;
  readonly tombstoneName: string;
}): PhysicalDirectoryIdentityV1 {
  ensureLeafName(input.tombstoneName);
  const source = assertSameNoFollowDirectoryIdentityV1(input.directory, 'Retained directory relocation source').target;
  const parentPath = path.dirname(source.path);
  const parent = inspectNoFollowDirectoryChainV1(parentPath, 'Retained directory relocation parent').target;
  const destination = path.join(parent.path, input.tombstoneName);
  if (inspectExactNoFollowDirectoryPresenceV1(destination, 'Retained directory relocation tombstone').state !== 'absent') {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained directory relocation tombstone already exists.');
  }
  if (process.platform === 'win32') {
    const sourceHandle = windowsOpenNoFollowLeaf(
      source.path, 'Retained directory relocation source',
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES
    );
    const parentHandle = windowsOpenDirectory(parent.path, 'Retained directory relocation parent', true);
    try {
      const sourceBefore = windowsIdentity(sourceHandle, source.path, 'Retained directory relocation source');
      const parentBefore = windowsIdentity(parentHandle, parent.path, 'Retained directory relocation parent');
      if (!sameIdentity(source, sourceBefore) || !sameIdentity(parent, parentBefore)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained directory relocation identity changed before move.');
      }
      windowsRenameRetainedDirectory(sourceHandle, source, parentHandle, input.tombstoneName, 'Retained directory relocation source');
      windowsFlushRetainedDirectory(parentHandle, parent, 'Retained directory relocation parent');
    } finally {
      closeWindowsHandle(parentHandle);
      closeWindowsHandle(sourceHandle);
    }
  } else if (process.platform === 'linux') {
    const retained = linuxOpenRetainedAbsoluteDirectory(parent.path, 'Retained directory relocation parent');
    let sourceFd: number | null = null;
    let destinationFd: number | null = null;
    try {
      const retainedParent = linuxIdentity(retained.directoryFd, parent.path);
      if (!sameIdentity(parent, retainedParent)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained directory relocation parent changed before renameat.');
      }
      const sourceName = path.basename(source.path);
      sourceFd = linuxOpenAt(retained.directoryFd, sourceName, 'Retained directory relocation source');
      const retainedSource = linuxIdentity(sourceFd, source.path);
      if (!sameIdentity(source, retainedSource)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained directory relocation source changed before renameat.');
      }
      try {
        destinationFd = linuxOpenLeafAt(retained.directoryFd, input.tombstoneName, 'Retained directory relocation tombstone');
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained directory relocation tombstone already exists.');
      } catch (error) {
        if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      } finally {
        if (destinationFd !== null) { closeSync(destinationFd); destinationFd = null; }
      }
      if (requireLinuxLibc().symbols.renameat2(
        retained.directoryFd, Buffer.from(`${sourceName}\0`, 'utf8'),
        retained.directoryFd, Buffer.from(`${input.tombstoneName}\0`, 'utf8'),
        LINUX_RENAME_NOREPLACE
      ) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Retained renameat2 no-replace failed (errno ${linuxErrno()}).`);
      }
      if (requireLinuxLibc().symbols.fsync(retained.directoryFd) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained directory relocation parent fsync failed.');
      }
      destinationFd = linuxOpenAt(retained.directoryFd, input.tombstoneName, 'Retained directory relocation tombstone');
      const retainedDestination = linuxIdentity(destinationFd, destination);
      if (source.device !== retainedDestination.device || source.inode !== retainedDestination.inode || source.objectId !== retainedDestination.objectId) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained directory relocation destination identity differs.');
      }
      const parentAfter = linuxIdentity(retained.directoryFd, parent.path);
      if (!sameIdentity(parent, parentAfter)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained directory relocation parent changed during renameat.');
      }
    } finally {
      if (destinationFd !== null) closeSync(destinationFd);
      if (sourceFd !== null) closeSync(sourceFd);
      if (retained.directoryFd !== retained.filesystemRootFd) closeSync(retained.directoryFd);
      closeSync(retained.filesystemRootFd);
    }
  } else {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Retained directory relocation backend is unavailable.');
  }
  if (inspectExactNoFollowDirectoryPresenceV1(source.path, 'Retained directory relocation source').state !== 'absent') {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained directory relocation source remains present.');
  }
  const moved = inspectNoFollowDirectoryChainV1(destination, 'Retained directory relocation tombstone').target;
  if (source.device !== moved.device || source.inode !== moved.inode || source.objectId !== moved.objectId) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained directory relocation destination identity differs.');
  }
  return moved;
}

/**
 * Retained no-follow move between two already-proven directories.  This is
 * used when the source parent's namespace is provider-visible (Git's
 * `worktrees/*`) and therefore cannot safely hold a registry tombstone.
 */
export function relocateRetainedNoFollowDirectoryAcrossParentsV1(input: {
  readonly directory: PhysicalDirectoryIdentityV1;
  readonly destinationParent: PhysicalDirectoryIdentityV1;
  readonly tombstoneName: string;
}): PhysicalDirectoryIdentityV1 {
  ensureLeafName(input.tombstoneName);
  const source = assertSameNoFollowDirectoryIdentityV1(input.directory, 'Retained cross-parent relocation source').target;
  const sourceParent = inspectNoFollowDirectoryChainV1(path.dirname(source.path), 'Retained cross-parent relocation source parent').target;
  const destinationParent = assertSameNoFollowDirectoryIdentityV1(input.destinationParent, 'Retained cross-parent relocation destination parent').target;
  const destination = path.join(destinationParent.path, input.tombstoneName);
  if (inspectExactNoFollowDirectoryPresenceV1(destination, 'Retained cross-parent relocation tombstone').state !== 'absent') {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained cross-parent relocation tombstone already exists.');
  }
  if (process.platform === 'win32') {
    const sourceHandle = windowsOpenNoFollowLeaf(source.path, 'Retained cross-parent relocation source', WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES);
    const sourceParentHandle = windowsOpenDirectory(sourceParent.path, 'Retained cross-parent relocation source parent', true);
    const destinationParentHandle = windowsOpenDirectory(destinationParent.path, 'Retained cross-parent relocation destination parent', true);
    try {
      if (!sameIdentity(source, windowsIdentity(sourceHandle, source.path, 'Retained cross-parent relocation source')) ||
        !sameIdentity(sourceParent, windowsIdentity(sourceParentHandle, sourceParent.path, 'Retained cross-parent relocation source parent')) ||
        !sameIdentity(destinationParent, windowsIdentity(destinationParentHandle, destinationParent.path, 'Retained cross-parent relocation destination parent'))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained cross-parent relocation identity changed before move.');
      }
      windowsRenameRetainedDirectory(sourceHandle, source, destinationParentHandle, input.tombstoneName, 'Retained cross-parent relocation source');
      windowsFlushRetainedDirectory(sourceParentHandle, sourceParent, 'Retained cross-parent relocation source parent');
      windowsFlushRetainedDirectory(destinationParentHandle, destinationParent, 'Retained cross-parent relocation destination parent');
    } finally { closeWindowsHandle(destinationParentHandle); closeWindowsHandle(sourceParentHandle); closeWindowsHandle(sourceHandle); }
  } else if (process.platform === 'linux') {
    const from = linuxOpenRetainedAbsoluteDirectory(sourceParent.path, 'Retained cross-parent relocation source parent');
    const to = linuxOpenRetainedAbsoluteDirectory(destinationParent.path, 'Retained cross-parent relocation destination parent');
    let sourceFd: number | null = null; let destinationFd: number | null = null;
    try {
      if (!sameIdentity(sourceParent, linuxIdentity(from.directoryFd, sourceParent.path)) || !sameIdentity(destinationParent, linuxIdentity(to.directoryFd, destinationParent.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained cross-parent relocation parent changed before renameat.');
      }
      const sourceName = path.basename(source.path);
      sourceFd = linuxOpenAt(from.directoryFd, sourceName, 'Retained cross-parent relocation source');
      if (!sameIdentity(source, linuxIdentity(sourceFd, source.path))) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained cross-parent relocation source changed before renameat.');
      try { destinationFd = linuxOpenLeafAt(to.directoryFd, input.tombstoneName, 'Retained cross-parent relocation tombstone'); throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained cross-parent relocation tombstone already exists.'); }
      catch (error) { if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error; }
      finally { if (destinationFd !== null) { closeSync(destinationFd); destinationFd = null; } }
      if (requireLinuxLibc().symbols.renameat2(
        from.directoryFd, Buffer.from(`${sourceName}\0`, 'utf8'),
        to.directoryFd, Buffer.from(`${input.tombstoneName}\0`, 'utf8'),
        LINUX_RENAME_NOREPLACE
      ) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Retained cross-parent renameat2 no-replace failed (errno ${linuxErrno()}).`);
      if (requireLinuxLibc().symbols.fsync(from.directoryFd) !== 0 || requireLinuxLibc().symbols.fsync(to.directoryFd) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained cross-parent relocation parent fsync failed.');
    } finally { if (destinationFd !== null) closeSync(destinationFd); if (sourceFd !== null) closeSync(sourceFd); if (from.directoryFd !== from.filesystemRootFd) closeSync(from.directoryFd); closeSync(from.filesystemRootFd); if (to.directoryFd !== to.filesystemRootFd) closeSync(to.directoryFd); closeSync(to.filesystemRootFd); }
  } else throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Retained cross-parent relocation backend is unavailable.');
  if (inspectExactNoFollowDirectoryPresenceV1(source.path, 'Retained cross-parent relocation source').state !== 'absent') throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained cross-parent relocation source remains present.');
  const moved = inspectNoFollowDirectoryChainV1(destination, 'Retained cross-parent relocation tombstone').target;
  if (source.device !== moved.device || source.inode !== moved.inode || source.objectId !== moved.objectId) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained cross-parent relocation destination identity differs.');
  }
  return moved;
}

/**
 * Deletes exactly one previously inventoried descendant while retaining both
 * its parent directory and the leaf object.  Linux uses handle-relative
 * openat/unlinkat and confirms the selected retained parent/name is absent;
 * unrelated hard links to the same inode remain outside this authority. A
 * platform without an equivalent kernel primitive fails closed.
 */
export function deleteRetainedNoFollowEntryV1(input: {
  readonly root: PhysicalDirectoryIdentityV1;
  readonly relativePath: string;
  readonly kind: 'directory' | 'file' | 'link';
  readonly device: string;
  readonly inode: string;
  readonly ancestorDirectories: readonly Readonly<{
    relativePath: string;
    device: string;
    inode: string;
  }>[];
}): void {
  if (!/^(?!.*(?:^|\/)\.\.?$)[^/\\\0]+(?:\/[^/\\\0]+)*$/u.test(input.relativePath)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Retained deletion relative path is invalid.');
  }
  const root = assertSameNoFollowDirectoryIdentityV1(input.root, 'Retained deletion root').target;
  const parts = input.relativePath.split('/');
  const leaf = parts.pop()!;
  if (input.ancestorDirectories.length !== parts.length || input.ancestorDirectories.some((entry, index) =>
    entry.relativePath !== parts.slice(0, index + 1).join('/')
  )) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Retained deletion ancestor inventory is incomplete or noncanonical.');
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
          parentHandle, parent, parts[index]!, nextPath, WINDOWS_FILE_OPEN, 'Retained deletion ancestor'
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
        parentHandle, parent, leaf, leafPath, input.kind, 'Retained deletion leaf'
      );
      const identity = windowsRetainedLeafIdentity(leafHandle, leafPath, input.kind, 'Retained deletion leaf');
      if (identity.device !== input.device || identity.inode !== input.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion leaf FileId changed.');
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
      const absentAfter = inspectExactNoFollowDirectoryPresenceV1(leafPath, 'Retained deletion leaf readback');
      if (input.kind === 'directory' && absentAfter.state !== 'absent') {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained directory deletion did not reach absent readback.');
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
  const filesystemRootFd = linuxOpenRoot('Retained deletion root');
  let retainedRootFd = filesystemRootFd;
  let parentFd: number | null = null;
  let leafFd: number | null = null;
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
    leafFd = linuxOpenLeafAt(parentFd, leaf, 'Retained deletion leaf');
    const stat = fstatSync(leafFd, { bigint: true });
    const kindMatches = input.kind === 'directory' ? stat.isDirectory() : input.kind === 'file' ? stat.isFile() : stat.isSymbolicLink();
    if (String(stat.dev) !== input.device || String(stat.ino) !== input.inode || !kindMatches) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion leaf identity changed.');
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
    const retainedRootAfter = linuxIdentity(retainedRootFd, root.path);
    if (!sameIdentity(root, retainedRootAfter)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion root changed during unlinkat.');
    }
  } finally {
    if (leafFd !== null) closeSync(leafFd);
    if (parentFd !== null && parentFd !== retainedRootFd) closeSync(parentFd);
    if (retainedRootFd !== filesystemRootFd) closeSync(retainedRootFd);
    closeSync(filesystemRootFd);
  }
}

/**
 * Observes one ordinary leaf below a retained parent. This is intentionally
 * O(1): proving one control file must never scan unrelated siblings or trees.
 */
export function inspectNoFollowOrdinaryFileEntryV1(
  parent: PhysicalDirectoryIdentityV1,
  name: string
): NoFollowDirectoryTreeEntryV1 | null {
  ensureLeafName(name);
  const checked = assertSameNoFollowDirectoryIdentityV1(parent, 'No-follow file parent').target;
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
      const bytes = readWindowsRetainedFile(leafHandle, 'No-follow file');
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
      const bytes = readLinuxRetainedFile(leafFd, 'No-follow file');
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

/** Reads one ordinary leaf file below a revalidated no-follow parent, or null only for ENOENT. */
export function readNoFollowOrdinaryFileV1(
  parent: PhysicalDirectoryIdentityV1,
  name: string
): Uint8Array | null {
  return inspectNoFollowOrdinaryFileEntryV1(parent, name)?.bytes ?? null;
}
