import { dlopen, FFIType, ptr, read } from 'bun:ffi';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  renameSync,
  symlinkSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import path from 'node:path';

/**
 * A deliberately narrow filesystem primitive.  It owns neither a repository
 * nor an operation's authorization semantics: callers bind these physical
 * observations to their own contracts.
 */
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

const RETAINED_NO_FOLLOW_CAPABILITY_BRAND: unique symbol = Symbol('sec-retained-no-follow-capability');
export type RetainedNoFollowCapabilityRole =
  | 'ordinary-file'
  | 'executable'
  | 'working-directory';
const retainedNoFollowCapabilityRoles = new WeakMap<object, RetainedNoFollowCapabilityRole>();

function issueRetainedNoFollowCapability<T extends object>(
  capability: T,
  role: RetainedNoFollowCapabilityRole
): T {
  retainedNoFollowCapabilityRoles.set(capability, role);
  return capability;
}

/**
 * Runtime admission for the process owner.  The structural child-process
 * view deliberately does not carry authority by itself; only an object
 * issued by this physical owner, with the requested role, is admissible.
 * Callers cannot manufacture a valid entry in the private WeakMap.
 */
export function assertRetainedNoFollowCapability(
  capability: unknown,
  role: RetainedNoFollowCapabilityRole,
  label = 'retained no-follow capability'
): void {
  if (capability === null || typeof capability !== 'object'
      || retainedNoFollowCapabilityRoles.get(capability) !== role) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} was not issued by the physical no-follow owner for role ${role}.`
    );
  }
}

export interface PhysicalDirectoryIdentity {
  /** Caller-supplied lexical absolute location, normalized by this module. */
  readonly path: string;
  /** Handle-derived physical final path on Windows; lexical path on Linux. */
  readonly finalPath: string;
  readonly device: string;
  readonly inode: string;
  /** FileIdInfo on Windows; dev/inode material on Linux. */
  readonly objectId: string;
}

export interface PhysicalDirectoryChain {
  readonly target: PhysicalDirectoryIdentity;
  /** Root-to-target identities.  Each component was opened without following links. */
  readonly ancestors: readonly PhysicalDirectoryIdentity[];
}

/**
 * A bounded Linux-only race actor used by the physical primitive's focused
 * tests.  It is deliberately an observation seam, not a filesystem or
 * operation capability: the private issuer below is the only way to obtain a
 * runtime-admissible actor, and the actor can only replace one explicitly
 * named directory once at one explicitly named transaction point.
 */
export type LinuxNoFollowDirectoryCreateRacePoint =
  | 'before-canonical-chain-open'
  | 'after-ancestor-open'
  | 'before-child-witness';

export interface LinuxNoFollowDirectoryCreateRaceActor {
  readonly point: LinuxNoFollowDirectoryCreateRacePoint;
  readonly targetPath: string;
  readonly displacedPath: string;
}

interface LinuxNoFollowDirectoryCreateRaceActorRecord {
  readonly point: LinuxNoFollowDirectoryCreateRacePoint;
  readonly targetPath: string;
  readonly displacedPath: string;
  used: boolean;
}

const linuxNoFollowDirectoryCreateRaceActors =
  new WeakMap<object, LinuxNoFollowDirectoryCreateRaceActorRecord>();

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
export interface RetainedNoFollowChildProcessDirectory {
  readonly [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]?: 'working-directory';
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  assertCurrent(): void;
  dispose(): void;
}

export interface RetainedNoFollowChildProcessFile {
  readonly [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]?: 'ordinary-file' | 'executable';
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  readonly path: string;
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly size: number;
  assertCurrent(): void;
  digest(): Readonly<{
    size: number;
    contentDigest: `sha256:${string}`;
    byteDigest: `sha256:${string}`;
  }>;
  dispose(): void;
}

/**
 * One ordinary file retained below a no-follow parent for a bounded
 * observation.  The digest is computed through the same retained file handle
 * that supplied the physical identity and size; callers never need to reopen
 * a lexical path between the metadata and byte observations.
 */
export interface RetainedNoFollowOrdinaryFile {
  readonly [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]?: 'ordinary-file' | 'executable';
  readonly path: string;
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly size: number;
  /**
   * Child-facing spelling of this same retained object.  On Linux the
   * caller must map `stdioSourceDescriptor` to the advertised descriptor
   * before spawning; the `/proc/self/fd` path then names the open file
   * description that supplied `digest()`, rather than a second lexical
   * open.  A Windows executable capability uses the pinned absolute path
   * while its retained file handle withholds both write and delete sharing,
   * so the kernel excludes every competing writer for the capability
   * lifetime.
   */
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  assertCurrent(): void;
  /** Reads the complete bounded byte sequence through this same retained handle. */
  readBytes(): Uint8Array;
  digest(): Readonly<{
    size: number;
    contentDigest: `sha256:${string}`;
    byteDigest: `sha256:${string}`;
  }>;
  dispose(): void;
}

export type ExactNoFollowDirectoryPresence =
  | Readonly<{ state: 'present'; directory: PhysicalDirectoryChain }>
  | Readonly<{ state: 'absent' }>;

export type NoFollowDirectoryTreeEntryKind = 'directory' | 'file' | 'link';

export interface NoFollowDirectoryTreeEntry {
  readonly relativePath: string;
  readonly kind: NoFollowDirectoryTreeEntryKind;
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
export interface NoFollowDirectoryTreeInventoryEntry {
  readonly relativePath: string;
  readonly kind: NoFollowDirectoryTreeEntryKind;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly contentDigest: `sha256:${string}` | null;
  readonly linkTarget: string | null;
}

interface InternalNoFollowDirectoryTreeEntry extends NoFollowDirectoryTreeEntry {
  readonly contentDigest: `sha256:${string}` | null;
}

type NoFollowDirectoryTreeFileMode = 'bounded-bytes' | 'metadata-only' | 'streaming-digest';

export interface NoFollowDirectoryTreeMetadataOptions {
  /** Monotonic `performance.now()` deadline. */
  readonly deadlineAtMs: number;
  /** Hard entry ceiling, checked while directory entries are enumerated. */
  readonly maximumEntries: number;
  /** Aggregate ordinary-file byte ceiling, checked before every retained read. */
  readonly maximumBytes?: number;
  /** Operation-scoped cancellation observed throughout retained traversal. */
  readonly signal?: AbortSignal;
}

export interface NoFollowDirectoryTreeCopyRoot {
  /** Source identity observed through the no-follow directory backend. */
  readonly source: PhysicalDirectoryIdentity;
  /** Destination path, which must be absent before the copy starts. */
  readonly target: string;
}

export interface NoFollowDirectoryTreeCopyOptions {
  /** Optional operation fence invoked only before and after the bulk effect. */
  readonly assertCurrent?: () => void | Promise<void>;
  /** Do not duplicate nested package-manager module roots. */
  readonly skipNestedNodeModules?: boolean;
  readonly maximumEntries?: number;
  /** Aggregate ordinary-file bytes across pre-scan, copy, and readbacks. */
  readonly maximumBytes?: number;
  /** Monotonic operation deadline for the complete inventory/effect/readback. */
  readonly deadlineAtMs?: number;
  /** Operation-scoped cancellation observed throughout inventory and copy. */
  readonly signal?: AbortSignal;
  /** Optional lexical roots to include; ancestors are retained for traversal. */
  readonly includeRelativePaths?: readonly string[];
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
}): PhysicalDirectoryIdentity {
  return Object.freeze({
    path: input.absolutePath,
    finalPath: input.finalPath,
    device: String(input.device),
    inode: String(input.inode),
    objectId: input.objectId
  });
}

function sameIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return left.path === right.path && left.finalPath === right.finalPath &&
    left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function samePhysicalObject(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

/** True when outer's physical target is equal to or contains inner's target. */
export function physicallyContainsDirectoryChain(
  outer: PhysicalDirectoryChain,
  inner: PhysicalDirectoryChain
): boolean {
  return inner.ancestors.some((entry) => samePhysicalObject(outer.target, entry));
}

/**
 * Rejects containment or equality between two fully no-follow-proven directory
 * chains. Sharing an ancestor is allowed; either target appearing in the
 * other's ancestor chain is not.
 */
export function assertPhysicallyDisjointDirectoryChains(
  left: PhysicalDirectoryChain,
  right: PhysicalDirectoryChain,
  label = 'directory chains'
): void {
  if (physicallyContainsDirectoryChain(left, right)
    || physicallyContainsDirectoryChain(right, left)) {
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
// F_DUPFD_CLOEXEC is the Linux command shared by the supported architectures.
// Retained descriptors are kept above the child transport's fixed 3/4 slots;
// this remains true even when a host has closed stdin/stdout/stderr before the
// capability is created.
const LINUX_F_DUPFD_CLOEXEC = 1_030;
const LINUX_RETAINED_DESCRIPTOR_MIN = 5;
const LINUX_AT_REMOVEDIR = 0x0200;
const LINUX_RENAME_NOREPLACE = 1;
const LINUX_RENAME_EXCHANGE = 2;
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
      fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      readlinkat: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
      symlinkat: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
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

/**
 * Keeps a retained Linux descriptor disjoint from the child transport's
 * advertised descriptors.  `fcntl(F_DUPFD_CLOEXEC)` is used instead of a
 * caller-visible `dup`/reopen so the descriptor remains the same open file
 * description whose identity is subsequently observed.
 */
function linuxRaiseDescriptorFloor(fd: number, label: string): number {
  if (!Number.isSafeInteger(fd) || fd < 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} returned an invalid Linux descriptor.`);
  }
  if (fd >= LINUX_RETAINED_DESCRIPTOR_MIN) return fd;
  const duplicate = requireLinuxLibc().symbols.fcntl(
    fd,
    LINUX_F_DUPFD_CLOEXEC,
    LINUX_RETAINED_DESCRIPTOR_MIN
  );
  if (duplicate < LINUX_RETAINED_DESCRIPTOR_MIN) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} could not allocate a retained descriptor above the child transport range (errno ${linuxErrno()}).`
    );
  }
  try {
    closeSync(fd);
  } catch (error) {
    try { closeSync(duplicate); } catch { /* preserve the primary close error */ }
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
      `${label} could not close the pre-floor descriptor after duplication.`,
      error
    );
  }
  return duplicate;
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

function linuxReadRetainedLinkTarget(linkFd: number, label: string): string {
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

function linuxIdentity(fd: number, absolutePath: string): PhysicalDirectoryIdentity {
  const stats = fstatSync(fd, { bigint: true });
  if (!stats.isDirectory()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${absolutePath} is not an ordinary directory.`);
  const objectId = `linux:${String(stats.dev)}:${String(stats.ino)}:${String(stats.mode)}`;
  return identityFromStats({ absolutePath, finalPath: absolutePath, device: stats.dev, inode: stats.ino, objectId });
}

interface LinuxDirectoryMutationEvent {
  readonly watchDescriptor: number;
  readonly mask: number;
  readonly name: string;
}

interface LinuxDirectoryCreateWitness {
  readonly fd: number;
  readonly watchDescriptor: number;
  readonly ancestorEdges: ReadonlyMap<number, string>;
}

interface LinuxDirectoryCreateTransaction {
  readonly filesystemRootFd: number;
  readonly witnessFd: number;
  currentFd: number;
  current: PhysicalDirectoryIdentity;
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
  witness: LinuxDirectoryCreateWitness,
  label: string
): readonly LinuxDirectoryMutationEvent[] {
  const events: LinuxDirectoryMutationEvent[] = [];
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
  witness: LinuxDirectoryCreateWitness,
  events: readonly LinuxDirectoryMutationEvent[],
  name: string,
  created: boolean,
  label: string
): void {
  if (events.some((event) => event.mask & (LINUX_IN_Q_OVERFLOW | LINUX_IN_IGNORED))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} mutation witness was invalidated or overflowed.`);
  }
  const relevant: LinuxDirectoryMutationEvent[] = [];
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
  expected: PhysicalDirectoryChain,
  label: string,
  testOnlyRaceActor?: LinuxNoFollowDirectoryCreateRaceActor
): LinuxDirectoryCreateTransaction {
  linuxInvokeNoFollowDirectoryCreateRaceActor(
    testOnlyRaceActor,
    'before-canonical-chain-open',
    expected.target.path,
    label
  );
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
    let current: PhysicalDirectoryIdentity | null = null;
    for (const [index, segment] of segments.entries()) {
      const ancestorWatchDescriptor = linuxAddDirectoryMutationWatch(witnessFd, currentFd, `${label} ancestor`);
      ancestorEdges.set(ancestorWatchDescriptor, segment);
      const nextPath = path.join(currentPath, segment);
      const nextFd = linuxOpenAt(currentFd, segment, `${label} ancestor`);
      try {
        linuxInvokeNoFollowDirectoryCreateRaceActor(
          testOnlyRaceActor,
          'after-ancestor-open',
          nextPath,
          `${label} ancestor`
        );
      } catch (error) {
        closeSync(nextFd);
        throw error;
      }
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

function linuxCloseDirectoryCreateTransaction(transaction: LinuxDirectoryCreateTransaction): void {
  if (transaction.currentFd !== transaction.filesystemRootFd) closeSync(transaction.currentFd);
  closeSync(transaction.filesystemRootFd);
  closeSync(transaction.witnessFd);
}

function linuxDirectoryCreateTransactionWitness(
  transaction: LinuxDirectoryCreateTransaction
): LinuxDirectoryCreateWitness {
  return Object.freeze({
    fd: transaction.witnessFd,
    watchDescriptor: transaction.currentWatchDescriptor,
    ancestorEdges: transaction.ancestorEdges
  });
}

function linuxAdvanceDirectoryCreateTransaction(
  transaction: LinuxDirectoryCreateTransaction,
  opened: Readonly<{ fd: number; identity: PhysicalDirectoryIdentity }>,
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
  readonly parent: PhysicalDirectoryIdentity;
  readonly witness: LinuxDirectoryCreateWitness;
  readonly name: string;
  readonly absolutePath: string;
  readonly allowExisting: boolean;
  readonly label: string;
  readonly testOnlyRaceActor?: LinuxNoFollowDirectoryCreateRaceActor;
}): Readonly<{ fd: number; created: boolean; identity: PhysicalDirectoryIdentity }> {
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
            ? `${input.label} name already exists at ${input.absolutePath}.`
            : `${input.label} relative mkdirat failed for ${input.absolutePath} (errno ${errno}).`
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
    linuxInvokeNoFollowDirectoryCreateRaceActor(
      input.testOnlyRaceActor,
      'before-child-witness',
      input.absolutePath,
      input.label
    );
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
const WINDOWS_SHARE_READ_WRITE = 0x0000_0003;
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
const WINDOWS_FSCTL_SET_REPARSE_POINT = 0x0009_00a4;
const WINDOWS_MAXIMUM_REPARSE_DATA_BUFFER_SIZE = 16 * 1024;
const WINDOWS_IO_REPARSE_TAG_MOUNT_POINT = 0xa000_0003;
const WINDOWS_FILE_CREATE = 2;
const WINDOWS_FILE_OPEN = 1;
const WINDOWS_FILE_NON_DIRECTORY_FILE = 0x0000_0040;
const WINDOWS_FILE_DIRECTORY_FILE = 0x0000_0001;
const WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT = 0x0000_0020;
const WINDOWS_FILE_OPEN_REPARSE_POINT_NT = 0x0020_0000;
const WINDOWS_STATUS_OBJECT_NAME_NOT_FOUND = -1_073_741_772;
const WINDOWS_STATUS_OBJECT_PATH_NOT_FOUND = -1_073_741_766;
const WINDOWS_STATUS_OBJECT_NAME_COLLISION = -1_073_741_771;
const WINDOWS_STATUS_SHARING_VIOLATION = -1_073_741_757;
// A just-disposed Windows handle can leave the namespace entry in the
// delete-pending state until the final handle reference is released.  For an
// exact retained-leaf readback this is the kernel's absent-equivalent; it is
// not used to admit a create or to authorize a path-only deletion.
const WINDOWS_STATUS_DELETE_PENDING = -1_073_741_738;

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
  root: PhysicalDirectoryIdentity,
  parent: PhysicalDirectoryIdentity,
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

function windowsIdentity(handle: bigint, absolutePath: string, label: string): PhysicalDirectoryIdentity {
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
    // Directory path stability requires withholding delete sharing, not
    // excluding independent metadata writers.  Allowing write sharing keeps
    // this read/pin capability compatible with Git, antivirus and watcher
    // handles while a rename/delete of the directory object remains blocked.
    WINDOWS_SHARE_READ_WRITE,
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

/**
 * Opens an ordinary directory with delete sharing withheld.  The regular
 * inspection handles intentionally allow repository watchers to coexist; a
 * copy effect needs the stronger boundary so its lexical fallback spelling
 * cannot be redirected while the retained handle is live.
 */
function windowsOpenPinnedWriteDirectory(absolutePath: string, label: string): bigint {
  const library = requireWindowsKernel32();
  const handle = library.symbols.CreateFileW(
    windowsWide(absolutePath),
    WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE,
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
      `${label} cannot be pinned for copy without delete sharing (Win32 ${lastError}).`
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
  parent: PhysicalDirectoryIdentity,
  name: string,
  absolutePath: string,
  desiredAccess: number,
  disposition: number,
  label: string,
  allowAbsent = false,
  shareAccess = WINDOWS_SHARE_READ_WRITE_DELETE,
  allowCollision = false,
  requireWriterExclusion = false
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
    shareAccess,
    disposition,
    WINDOWS_FILE_NON_DIRECTORY_FILE | WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT |
      (disposition === WINDOWS_FILE_CREATE ? 0 : WINDOWS_FILE_OPEN_REPARSE_POINT_NT),
    null,
    0
  );
  if (status < 0) {
    if (requireWriterExclusion && status === WINDOWS_STATUS_SHARING_VIOLATION) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} executable writer exclusion cannot be acquired while a writable or delete-capable handle is live.`
      );
    }
    if (allowAbsent && (status === WINDOWS_STATUS_OBJECT_NAME_NOT_FOUND ||
        status === WINDOWS_STATUS_OBJECT_PATH_NOT_FOUND || status === WINDOWS_STATUS_DELETE_PENDING)) return null;
    if (allowCollision && disposition === WINDOWS_FILE_CREATE && status === WINDOWS_STATUS_OBJECT_NAME_COLLISION) return null;
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative NtCreateFile failed (NTSTATUS ${status}).`);
  }
  const handle = handleBuffer.readBigUInt64LE(0);
  if (handle === 0n || handle === WINDOWS_INVALID_HANDLE) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative NtCreateFile returned no handle.`);
  }
  try {
    const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent`);
    if (!sameIdentity(parent, observedParent)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during relative leaf open.`);
    }
    return handle;
  } catch (error) {
    closeWindowsHandle(handle);
    throw error;
  }
}

function windowsOpenRelativeDirectory(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  absolutePath: string,
  disposition: typeof WINDOWS_FILE_CREATE | typeof WINDOWS_FILE_OPEN,
  label: string,
  shareAccess = WINDOWS_SHARE_READ_WRITE_DELETE
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
    shareAccess,
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
  try {
    const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent`);
    if (!sameIdentity(parent, observedParent)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during relative directory open.`);
    }
    windowsIdentity(handle, absolutePath, label);
    return handle;
  } catch (error) {
    closeWindowsHandle(handle);
    throw error;
  }
}

function windowsOpenRelativeNoFollowEntry(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
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
    if (status === WINDOWS_STATUS_OBJECT_NAME_NOT_FOUND || status === WINDOWS_STATUS_OBJECT_PATH_NOT_FOUND ||
        status === WINDOWS_STATUS_DELETE_PENDING) {
      throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
    }
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative no-follow open failed (NTSTATUS ${status}).`);
  }
  const handle = handleBuffer.readBigUInt64LE(0);
  if (handle === 0n || handle === WINDOWS_INVALID_HANDLE) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative no-follow open returned no handle.`);
  }
  try {
    const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent`);
    if (!sameIdentity(parent, observedParent)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during relative no-follow open.`);
    }
    windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
    return handle;
  } catch (error) {
    closeWindowsHandle(handle);
    throw error;
  }
}

function windowsWriteRetainedFile(handle: bigint, bytes: Uint8Array, label: string): void {
  const library = requireWindowsKernel32();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const span = Math.min(64 * 1024, bytes.byteLength - offset);
    windowsWriteRetainedChunk(handle, bytes.subarray(offset, offset + span), label);
    const count = span;
    offset += count;
  }
  if (library.symbols.FlushFileBuffers(handle) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained file flush failed (Win32 ${library.symbols.GetLastError()}).`);
  }
}

function windowsWriteRetainedChunk(handle: bigint, bytes: Uint8Array, label: string): void {
  const library = requireWindowsKernel32();
  const written = Buffer.alloc(4);
  if (library.symbols.WriteFile(handle, Buffer.from(bytes), bytes.byteLength, written, null) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained handle write failed (Win32 ${library.symbols.GetLastError()}).`);
  }
  const count = written.readUInt32LE(0);
  if (count !== bytes.byteLength) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained handle short write.`);
  }
}

function windowsRewindRetainedFile(handle: bigint, label: string): void {
  if (requireWindowsKernel32().symbols.SetFilePointerEx(handle, 0n, null, 0) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained handle rewind failed (Win32 ${requireWindowsKernel32().symbols.GetLastError()}).`);
  }
}

function windowsReadRelativeOrdinaryLeaf(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
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

function windowsReadRetainedReparseData(handle: bigint, label: string): Buffer {
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
  return Buffer.from(output.subarray(0, size));
}

function windowsRetainedReparseObservation(
  handle: bigint,
  label: string
): Readonly<{ size: number; linkTarget: string }> {
  const data = windowsReadRetainedReparseData(handle, label);
  return Object.freeze({
    size: data.byteLength,
    linkTarget: `windows-reparse-sha256:${createHash('sha256').update(data).digest('hex')}`
  });
}

/**
 * Decodes the canonical target of a directory junction from the same
 * retained reparse handle that supplied its FileId.  Reading the target via
 * readlink(path) would reopen the destination parent lexically and would
 * make a parent replacement a second, weaker physical authority.
 */
function windowsReadRetainedJunctionTarget(
  handle: bigint,
  expectedPath: string,
  parentPath: string,
  label: string
): string {
  const data = windowsReadRetainedReparseData(handle, label);
  if (data.readUInt32LE(0) !== WINDOWS_IO_REPARSE_TAG_MOUNT_POINT || data.byteLength < 16) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} is not a directory junction.`);
  }
  const dataLength = data.readUInt16LE(4);
  if (dataLength + 8 !== data.byteLength || dataLength < 8) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} junction payload length is invalid.`);
  }
  const substituteOffset = data.readUInt16LE(8);
  const substituteLength = data.readUInt16LE(10);
  const printOffset = data.readUInt16LE(12);
  const printLength = data.readUInt16LE(14);
  const pathBufferLength = data.byteLength - 16;
  const validSlice = (offset: number, length: number): boolean =>
    offset % 2 === 0 && length % 2 === 0 && offset <= pathBufferLength &&
    length <= pathBufferLength - offset;
  if (!validSlice(substituteOffset, substituteLength) || !validSlice(printOffset, printLength)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} junction target offsets are invalid.`);
  }
  const substitute = data.subarray(16 + substituteOffset, 16 + substituteOffset + substituteLength)
    .toString('utf16le');
  if (!substitute.startsWith('\\??\\')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} junction target is not an NT device path.`);
  }
  const target = substitute.slice('\\??\\'.length);
  if (target.startsWith('UNC\\')) {
    if (target.length <= 'UNC\\'.length) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} junction target is empty.`);
    }
    const unc = `\\\\${target.slice('UNC\\'.length)}`;
    assertPhysicalLinkTarget(unc, expectedPath, parentPath, label);
    return normalizePhysicalLinkTarget(unc, parentPath);
  }
  if (!/^[A-Za-z]:[\\/]/u.test(target)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} junction target is not an absolute volume path.`);
  }
  assertPhysicalLinkTarget(target, expectedPath, parentPath, label);
  return normalizePhysicalLinkTarget(target, parentPath);
}

function windowsJunctionSubstitutePath(sourcePath: string): string {
  const absolute = path.win32.normalize(path.resolve(sourcePath)).replaceAll('/', '\\');
  const namespaced = path.toNamespacedPath(absolute).replaceAll('/', '\\');
  const withoutPrefix = namespaced.startsWith('\\\\?\\')
    ? namespaced.slice('\\\\?\\'.length)
    : namespaced;
  if (!/^(?:[A-Za-z]:[\\/]|UNC\\[^\\/]+[\\/][^\\/]+)/u.test(withoutPrefix)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Windows junction source is not an absolute volume path.');
  }
  return `\\??\\${withoutPrefix}`;
}

/**
 * Creates one junction relative to a retained parent and returns the still
 * retained link handle.  The ordinary directory is created no-replace via
 * NtCreateFile(parentHandle, leaf), then converted in place through the
 * handle.  No path-based symlink primitive is used for this effect.
 */
function windowsCreateRelativeJunction(
  parent: WindowsBulkDirectoryHandle,
  name: string,
  sourcePath: string,
  absolutePath: string,
  label: string
): bigint {
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
    const substitute = Buffer.from(windowsJunctionSubstitutePath(sourcePath), 'utf16le');
    const print = Buffer.from(path.win32.normalize(path.resolve(sourcePath)).replaceAll('/', '\\'), 'utf16le');
    const pathBuffer = Buffer.concat([substitute, Buffer.alloc(2), print, Buffer.alloc(2)]);
    const reparse = Buffer.alloc(16 + pathBuffer.byteLength);
    reparse.writeUInt32LE(WINDOWS_IO_REPARSE_TAG_MOUNT_POINT, 0);
    reparse.writeUInt16LE(8 + pathBuffer.byteLength, 4);
    reparse.writeUInt16LE(0, 6);
    reparse.writeUInt16LE(0, 8);
    reparse.writeUInt16LE(substitute.byteLength, 10);
    reparse.writeUInt16LE(substitute.byteLength + 2, 12);
    reparse.writeUInt16LE(print.byteLength, 14);
    pathBuffer.copy(reparse, 16);
    const returned = Buffer.alloc(4);
    if (requireWindowsKernel32().symbols.DeviceIoControl(
      handle,
      WINDOWS_FSCTL_SET_REPARSE_POINT,
      reparse,
      reparse.byteLength,
      null,
      0,
      returned,
      null
    ) === 0) {
      const lastError = requireWindowsKernel32().symbols.GetLastError();
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} relative junction publication failed (Win32 ${lastError}).`);
    }
    windowsRetainedLeafIdentity(handle, absolutePath, 'link', label);
    windowsReadRetainedJunctionTarget(handle, sourcePath, parent.identity.path, label);
    if (!sameIdentity(parent.identity, windowsIdentity(parent.handle, parent.identity.path, `${label} parent`))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during publication.`);
    }
    return handle;
  } catch (error) {
    closeWindowsHandle(handle);
    throw error;
  }
}

type ReserveNoFollowFileBytes = (size: number) => void;

function windowsScanRetainedEntry(
  absolutePath: string,
  label: string,
  reserveFileBytes?: ReserveNoFollowFileBytes
): NoFollowDirectoryTreeEntry {
  const handle = windowsOpenNoFollowLeaf(absolutePath, label, WINDOWS_GENERIC_READ);
  try {
    const tag = Buffer.alloc(8);
    if (requireWindowsKernel32().symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ATTRIBUTE_TAG_INFO, tag, tag.byteLength) === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} attributes cannot be proven.`);
    }
    const attributes = tag.readUInt32LE(0);
    const kind: NoFollowDirectoryTreeEntryKind = (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0
      ? 'link' : (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) !== 0 ? 'directory' : 'file';
    const identity = windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
    let bytes: Uint8Array | null = null;
    if (kind === 'file') {
      const snapshot = windowsRetainedFileSnapshot(handle, label);
      if (snapshot.size < 0n || snapshot.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the inventory number domain.`);
      }
      reserveFileBytes?.(Number(snapshot.size));
      bytes = readWindowsRetainedFile(handle, label);
    }
    const reparse = kind === 'link' ? windowsRetainedReparseObservation(handle, label) : null;
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
  label: string,
  reserveFileBytes?: ReserveNoFollowFileBytes
): Omit<NoFollowDirectoryTreeInventoryEntry, 'relativePath'> {
  const handle = windowsOpenNoFollowLeaf(absolutePath, label, WINDOWS_GENERIC_READ);
  try {
    const tag = Buffer.alloc(8);
    if (requireWindowsKernel32().symbols.GetFileInformationByHandleEx(handle, WINDOWS_FILE_ATTRIBUTE_TAG_INFO, tag, tag.byteLength) === 0) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} attributes cannot be proven.`);
    }
    const attributes = tag.readUInt32LE(0);
    const kind: NoFollowDirectoryTreeEntryKind = (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0
      ? 'link' : (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) !== 0 ? 'directory' : 'file';
    const identity = windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
    if (kind === 'file') {
      const snapshot = windowsRetainedFileSnapshot(handle, label);
      if (snapshot.size < 0n || snapshot.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the inventory number domain.`);
      }
      reserveFileBytes?.(Number(snapshot.size));
    }
    const content = kind === 'file'
      ? digestWindowsRetainedFile(handle, absolutePath, identity, label)
      : kind === 'link'
        ? Object.freeze({ ...windowsRetainedReparseObservation(handle, label), contentDigest: null })
        : Object.freeze({ size: 0, contentDigest: null, linkTarget: null });
    return Object.freeze({ kind, ...identity, ...content, linkTarget: 'linkTarget' in content ? content.linkTarget : null });
  } finally {
    closeWindowsHandle(handle);
  }
}

function windowsMetadataRetainedEntry(
  absolutePath: string,
  label: string
): Omit<NoFollowDirectoryTreeInventoryEntry, 'relativePath'> {
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
    const kind: NoFollowDirectoryTreeEntryKind = (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0
      ? 'link' : (attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY) !== 0 ? 'directory' : 'file';
    const identity = windowsRetainedLeafIdentity(handle, absolutePath, kind, label);
    const observation = kind === 'file'
      ? windowsRetainedFileSnapshot(handle, label)
      : kind === 'link'
        ? windowsRetainedReparseObservation(handle, label)
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
  expectedSource: PhysicalDirectoryIdentity,
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

function windowsFlushRetainedDirectory(handle: bigint, expected: PhysicalDirectoryIdentity, label: string): void {
  const observed = windowsIdentity(handle, expected.path, label);
  if (!sameIdentity(expected, observed)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before durability barrier.`);
  }
  // Windows does not support a portable directory FlushFileBuffers contract:
  // NTFS/ReFS commonly reject it for a correctly retained directory handle.
  // File publication instead flushes the retained source file before and
  // after native root-relative rename, then proves final FileId/readback.
}

function streamCanonicalHexContentDigest(
  readChunk: (chunk: Buffer) => number,
  expectedSize: bigint,
  label: string
): Readonly<{
  size: number;
  contentDigest: `sha256:${string}`;
  byteDigest: `sha256:${string}`;
}> {
  if (expectedSize < 0n || expectedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the exact inventory number domain.`);
  }
  const hash = createHash('sha256');
  const byteHash = createHash('sha256');
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
    byteHash.update(chunk.subarray(0, count));
    hash.update(chunk.subarray(0, count).toString('hex'));
  }
  if (BigInt(total) !== expectedSize) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} size changed during retained streaming inventory.`);
  }
  hash.update('"}');
  return Object.freeze({
    size: total,
    contentDigest: `sha256:${hash.digest('hex')}`,
    byteDigest: `sha256:${byteHash.digest('hex')}`
  });
}

function windowsRetainedFileSnapshot(
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
): Readonly<{
  size: number;
  contentDigest: `sha256:${string}`;
  byteDigest: `sha256:${string}`;
}> {
  const beforeIdentity = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
  if (beforeIdentity.device !== identity.device || beforeIdentity.inode !== identity.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before retained streaming inventory.`);
  }
  const before = windowsRetainedFileSnapshot(handle, label);
  const library = requireWindowsKernel32();
  const received = Buffer.alloc(4);
  const result = streamCanonicalHexContentDigest((chunk) => {
    if (library.symbols.ReadFile(handle, chunk, chunk.byteLength, received, null) === 0) {
      const lastError = library.symbols.GetLastError();
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} retained streaming read failed (Win32 ${lastError}).`);
    }
    return received.readUInt32LE(0);
  }, before.size, label);
  const after = windowsRetainedFileSnapshot(handle, label);
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

function digestRetainedOrdinaryFileFd(
  fd: number,
  expected: Readonly<{ device: string; inode: string }>,
  label: string
): Readonly<{
  size: number;
  contentDigest: `sha256:${string}`;
  byteDigest: `sha256:${string}`;
}> {
  const before = fstatSync(fd, { bigint: true });
  if (!before.isFile() || String(before.dev) !== expected.device || String(before.ino) !== expected.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before retained streaming inventory.`);
  }
  let offset = 0;
  const result = streamCanonicalHexContentDigest(
    (chunk) => {
      const count = readSync(fd, chunk, 0, chunk.byteLength, offset);
      offset += count;
      return count;
    }, before.size, label
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

/**
 * Close every subordinate handle even when one close fails.  A cleanup error
 * is returned (rather than thrown in the loop) so a caller that is already
 * unwinding an operation can preserve that operation's primary error.
 */
function closeLinuxDescriptorsBestEffort(
  descriptors: readonly number[],
  label: string
): PhysicalNoFollowError | null {
  const closed = new Set<number>();
  let firstError: PhysicalNoFollowError | null = null;
  for (const descriptor of descriptors) {
    if (closed.has(descriptor)) continue;
    closed.add(descriptor);
    try {
      closeSync(descriptor);
    } catch (error) {
      firstError ??= physicalError(
        'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
        `${label} could not close a retained Linux handle.`,
        error
      );
    }
  }
  return firstError;
}

function closeWindowsHandlesBestEffort(
  handles: readonly bigint[],
  label: string
): PhysicalNoFollowError | null {
  const closed = new Set<bigint>();
  let firstError: PhysicalNoFollowError | null = null;
  for (const handle of handles) {
    if (closed.has(handle)) continue;
    closed.add(handle);
    try {
      closeWindowsHandle(handle);
    } catch (error) {
      firstError ??= error instanceof PhysicalNoFollowError
        ? error
        : physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} could not close a retained Windows handle.`, error);
    }
  }
  return firstError;
}

function inspectWindowsDirectoryChain(absolutePath: string, label: string): PhysicalDirectoryChain {
  const parsed = path.win32.parse(absolutePath);
  let current = parsed.root;
  const ancestors: PhysicalDirectoryIdentity[] = [];
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

function inspectLinuxDirectoryChain(absolutePath: string, label: string): PhysicalDirectoryChain {
  const rootFd = linuxOpenRoot(label);
  let parentFd = rootFd;
  let current = path.parse(absolutePath).root;
  const ancestors: PhysicalDirectoryIdentity[] = [];
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
export function inspectNoFollowDirectoryChain(
  absoluteDirectoryPath: string,
  label = 'directory'
): PhysicalDirectoryChain {
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
export function inspectExactNoFollowDirectoryPresence(
  absoluteDirectoryPath: string,
  label = 'directory'
): ExactNoFollowDirectoryPresence {
  try {
    return Object.freeze({ state: 'present', directory: inspectNoFollowDirectoryChain(absoluteDirectoryPath, label) });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return Object.freeze({ state: 'absent' });
    }
    throw error;
  }
}

/** Re-observes the same lexical directory and rejects any physical substitution. */
export function assertSameNoFollowDirectoryIdentity(
  expected: PhysicalDirectoryIdentity,
  label = 'directory'
): PhysicalDirectoryChain {
  const current = inspectNoFollowDirectoryChain(expected.path, label);
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
export function retainNoFollowDirectoryForChildProcess(
  expected: PhysicalDirectoryChain,
  childDescriptor: number,
  label = 'child-process directory'
): RetainedNoFollowChildProcessDirectory {
  if (!Number.isSafeInteger(childDescriptor) || childDescriptor < 3 || childDescriptor > 64) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} child descriptor must be one bounded inherited descriptor.`
    );
  }
  const absolutePath = requireAbsoluteDirectoryPath(expected.target.path, label);
  if (expected.ancestors.length === 0 || !sameIdentity(expected.target, expected.ancestors.at(-1)!)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} expected chain is malformed.`);
  }

  if (process.platform === 'linux') {
    const rootFd = linuxRaiseDescriptorFloor(linuxOpenRoot(label), label);
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
          const openedFd = linuxOpenAt(directoryFd, segment, label);
          let nextFd = openedFd;
          try {
            nextFd = linuxRaiseDescriptorFloor(openedFd, label);
          } catch (error) {
            try { closeSync(openedFd); } catch { /* retain the primary capability error */ }
            throw error;
          }
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
      const capability = Object.freeze({
        [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]: 'working-directory' as const,
        childPath: `/proc/self/fd/${childDescriptor}`,
        stdioSourceDescriptor: directoryFd,
        assertCurrent,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          const closeError = closeLinuxDescriptorsBestEffort(
            directoryFd === rootFd ? [rootFd] : [directoryFd, rootFd],
            label
          );
          if (closeError !== null) throw closeError;
        }
      });
      return issueRetainedNoFollowCapability(capability, 'working-directory');
    } catch (error) {
      closeLinuxDescriptorsBestEffort(
        directoryFd === rootFd ? [rootFd] : [directoryFd, rootFd],
        label
      );
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
    const handles: Array<{ readonly handle: bigint; readonly identity: PhysicalDirectoryIdentity }> = [];
    let disposed = false;
    try {
      for (const [index, current] of paths.entries()) {
        const currentLabel = `${label} ancestor[${index}] ${current}`;
        // The child receives an absolute Windows path, so every ancestor in
        // that spelling must remain the retained object for the whole process
        // lifetime.  Pinning only the final two ancestors leaves a deeper
        // junction/reparse replacement able to redirect CreateProcess before
        // the target handle is consulted.
        const handle = windowsOpenPinnedReadDirectory(current, currentLabel);
        const identity = windowsIdentity(handle, current, currentLabel);
        if (!sameIdentity(
          expected.ancestors[index]!,
          identity
        )) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
        }
        handles.push({ handle, identity });
      }
      const assertCurrent = (): void => {
        if (disposed) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        for (const [index, entry] of handles.entries()) {
          if (!sameIdentity(
            expected.ancestors[index]!,
            windowsIdentity(entry.handle, entry.identity.path, `${label} ancestor[${index}]`)
          )) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained ancestor identity changed.`);
          }
        }
      };
      const capability = Object.freeze({
        [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]: 'working-directory' as const,
        childPath: absolutePath,
        stdioSourceDescriptor: null,
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
      return issueRetainedNoFollowCapability(capability, 'working-directory');
    } catch (error) {
      closeWindowsHandlesBestEffort(
        [...handles].reverse().map((entry) => entry.handle),
        label
      );
      throw error;
    }
  }

  throw physicalError(
    'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
    `${label} retained child-process backend is unavailable on ${process.platform}.`
  );
}

/**
 * Retains one ordinary file and exposes a same-handle streaming digest plus
 * the child-process spelling of that same retained object.  Executable and
 * control-file consumers never need to copy the file into memory or reopen a
 * lexical path.  On Windows the executable role is issued only while pinned
 * parent/file handles hold a mandatory writer/delete exclusion; on Linux all
 * reads are relative to retained no-follow directory handles and the child
 * path is `/proc/self/fd/<advertised-descriptor>`.
 */
export function retainNoFollowOrdinaryFile(
  expectedParent: PhysicalDirectoryChain,
  name: string,
  expectedPhysical?: Readonly<{ device: string; inode: string }>,
  label = 'retained ordinary file',
  childDescriptor = 3,
  role: 'ordinary-file' | 'executable' = 'ordinary-file'
): RetainedNoFollowOrdinaryFile {
  ensureLeafName(name);
  if (role !== 'ordinary-file' && role !== 'executable') {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} capability role is invalid.`);
  }
  if (role === 'executable' && process.platform !== 'win32') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} executable admission requires a sealed image or mandatory writer-exclusion primitive.`
    );
  }
  if (!Number.isSafeInteger(childDescriptor) || childDescriptor < 3 || childDescriptor > 64) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} child descriptor must be one bounded inherited descriptor.`
    );
  }
  const parent = expectedParent.target;
  const absolutePath = path.join(parent.path, name);

  if (process.platform === 'linux') {
    const retainedParent = linuxRetainBulkDirectoryChain(expectedParent, `${label} parent`);
    let descriptor: number | null = null;
    let disposed = false;
    try {
      const openedDescriptor = linuxOpenReadableLeafAt(retainedParent.target.fd, name, label);
      try {
        descriptor = linuxRaiseDescriptorFloor(openedDescriptor, label);
      } catch (error) {
        try { closeSync(openedDescriptor); } catch { /* retain the primary capability error */ }
        throw error;
      }
      const initial = fstatSync(descriptor, { bigint: true });
      if (!initial.isFile()) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} is not an ordinary file.`);
      }
      const physical = Object.freeze({ device: String(initial.dev), inode: String(initial.ino) });
      if (expectedPhysical !== undefined &&
          (physical.device !== expectedPhysical.device || physical.inode !== expectedPhysical.inode)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} physical identity changed before retention.`);
      }
      if (initial.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the safe observation domain.`);
      }
      const initialMode = initial.mode;
      const initialSize = initial.size;
      const initialMtimeNs = initial.mtimeNs;
      const initialCtimeNs = initial.ctimeNs;
      const assertCurrent = (): void => {
        if (disposed || descriptor === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        const current = fstatSync(descriptor, { bigint: true });
        if (!current.isFile() || current.dev !== initial.dev || current.ino !== initial.ino ||
            current.mode !== initialMode || current.size !== initialSize ||
            current.mtimeNs !== initialMtimeNs || current.ctimeNs !== initialCtimeNs) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity or metadata changed.`);
        }
        const lexicalParent = inspectNoFollowDirectoryChain(parent.path, `${label} lexical parent`).target;
        if (!sameIdentity(parent, lexicalParent)) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} lexical parent identity changed.`);
        }
        const lexicalLeaf = linuxOpenReadableLeafAt(retainedParent.target.fd, name, `${label} leaf readback`);
        try {
          const leaf = fstatSync(lexicalLeaf, { bigint: true });
          if (!leaf.isFile() || leaf.dev !== initial.dev || leaf.ino !== initial.ino
              || leaf.mode !== initialMode || leaf.size !== initialSize
              || leaf.mtimeNs !== initialMtimeNs || leaf.ctimeNs !== initialCtimeNs) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} lexical leaf identity changed.`);
          }
        } finally {
          closeSync(lexicalLeaf);
        }
        retainedParent.assertCurrent();
      };
      assertCurrent();
      const capability = Object.freeze({
        [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]: role,
        path: absolutePath,
        parent,
        name,
        physical,
        size: Number(initialSize),
        childPath: `/proc/self/fd/${childDescriptor}`,
        stdioSourceDescriptor: descriptor,
        assertCurrent,
        readBytes: () => {
          assertCurrent();
          const before = fstatSync(descriptor!, { bigint: true });
          if (!before.isFile() || String(before.dev) !== physical.device ||
              String(before.ino) !== physical.inode ||
              before.size > BigInt(NO_FOLLOW_FILE_READ_LIMIT_BYTES)) {
            throw physicalError(
              'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
              `${label} changed before retained byte read.`
            );
          }
          const chunks: Buffer[] = [];
          let total = 0;
          let offset = 0;
          for (;;) {
            const chunk = Buffer.alloc(64 * 1024);
            const count = readSync(descriptor!, chunk, 0, chunk.byteLength, offset);
            if (count === 0) break;
            offset += count;
            total += count;
            if (total > NO_FOLLOW_FILE_READ_LIMIT_BYTES) {
              throw physicalError(
                'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
                `${label} exceeds the bounded retained byte-read domain.`
              );
            }
            chunks.push(chunk.subarray(0, count));
          }
          if (BigInt(total) !== before.size) {
            throw physicalError(
              'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
              `${label} size changed during retained byte read.`
            );
          }
          assertCurrent();
          return Buffer.concat(chunks, total);
        },
        digest: () => {
          assertCurrent();
          const result = digestRetainedOrdinaryFileFd(descriptor!, physical, label);
          assertCurrent();
          return result;
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          const closeError = closeLinuxDescriptorsBestEffort(
            [descriptor!, ...[...retainedParent.directories].reverse().map((entry) => entry.fd)],
            label
          );
          descriptor = null;
          if (closeError !== null) throw closeError;
        }
      });
      return issueRetainedNoFollowCapability(capability, role);
    } catch (error) {
      const descriptors = descriptor === null
        ? [...retainedParent.directories].reverse().map((entry) => entry.fd)
        : [descriptor, ...[...retainedParent.directories].reverse().map((entry) => entry.fd)];
      closeLinuxDescriptorsBestEffort(descriptors, label);
      throw error;
    }
  }

  if (process.platform === 'win32') {
    const retainedParent = windowsRetainBulkDirectoryChain(expectedParent, `${label} parent`);
    let handle: bigint | null = null;
    let disposed = false;
    try {
      handle = windowsOpenRelativeLeaf(
        retainedParent.target.handle,
        retainedParent.target.identity,
        name,
        absolutePath,
        WINDOWS_GENERIC_READ,
        WINDOWS_FILE_OPEN,
        label,
        false,
        WINDOWS_SHARE_READ,
        false,
        role === 'executable'
      );
      if (handle === null) {
        throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
      }
      const physical = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
      if (expectedPhysical !== undefined &&
          (physical.device !== expectedPhysical.device || physical.inode !== expectedPhysical.inode)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} physical identity changed before retention.`);
      }
      const initial = windowsRetainedFileSnapshot(handle, label);
      if (initial.size < 0n || initial.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the safe observation domain.`);
      }
      const assertCurrent = (): void => {
        if (disposed || handle === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        const currentIdentity = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
        const current = windowsRetainedFileSnapshot(handle, label);
        if (currentIdentity.device !== physical.device || currentIdentity.inode !== physical.inode ||
            current.basic !== initial.basic || current.size !== initial.size) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained identity or metadata changed.`);
        }
        const lexicalLeaf = windowsOpenRelativeLeaf(
          retainedParent.target.handle,
          retainedParent.target.identity,
          name,
          absolutePath,
          WINDOWS_GENERIC_READ,
          WINDOWS_FILE_OPEN,
          `${label} leaf readback`,
          true,
          WINDOWS_SHARE_READ
        );
        if (lexicalLeaf === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} lexical leaf disappeared.`);
        }
        try {
          const leafIdentity = windowsRetainedLeafIdentity(lexicalLeaf, absolutePath, 'file', `${label} leaf readback`);
          if (leafIdentity.device !== physical.device || leafIdentity.inode !== physical.inode) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} lexical leaf identity changed.`);
          }
        } finally {
          closeWindowsHandle(lexicalLeaf);
        }
        retainedParent.assertCurrent();
      };
      assertCurrent();
      const capability = Object.freeze({
        [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]: role,
        path: absolutePath,
        parent,
        name,
        physical,
        size: Number(initial.size),
        childPath: absolutePath,
        stdioSourceDescriptor: null,
        assertCurrent,
        readBytes: () => {
          assertCurrent();
          windowsRewindRetainedFile(handle!, label);
          const bytes = readWindowsRetainedFile(handle!, label);
          if (bytes.byteLength !== Number(initial.size)) {
            throw physicalError(
              'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
              `${label} size changed during retained byte read.`
            );
          }
          assertCurrent();
          return bytes;
        },
        digest: () => {
          assertCurrent();
          windowsRewindRetainedFile(handle!, label);
          const result = digestWindowsRetainedFile(handle!, absolutePath, physical, label);
          assertCurrent();
          return result;
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          const closeError = closeWindowsHandlesBestEffort(
            [handle!, ...[...retainedParent.directories].reverse().map((entry) => entry.handle)],
            label
          );
          handle = null;
          if (closeError !== null) throw closeError;
        }
      });
      return issueRetainedNoFollowCapability(capability, role);
    } catch (error) {
      const handles = handle === null
        ? [...retainedParent.directories].reverse().map((entry) => entry.handle)
        : [handle, ...[...retainedParent.directories].reverse().map((entry) => entry.handle)];
      closeWindowsHandlesBestEffort(handles, label);
      throw error;
    }
  }

  throw physicalError(
    'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
    `${label} retained ordinary-file backend is unavailable on ${process.platform}.`
  );
}

/**
 * Retains one already-observed ordinary file for exact child-process reads.
 *
 * This is intentionally only a typed view of the canonical ordinary-file
 * capability above.  It must not open a second file handle: the digest and
 * the child receive the same retained object, with the caller mapping the
 * returned source descriptor to `childDescriptor` in the child stdio table.
 */
export function retainNoFollowOrdinaryFileForChildProcess(
  parent: PhysicalDirectoryChain,
  expected: NoFollowDirectoryTreeEntry,
  childDescriptor: number,
  label = 'child-process file'
): RetainedNoFollowChildProcessFile {
  ensureLeafName(expected.relativePath);
  if (expected.kind !== 'file' || !Number.isSafeInteger(childDescriptor)
      || childDescriptor < 3 || childDescriptor > 64) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} retention input is invalid.`);
  }
  return retainNoFollowOrdinaryFile(
    parent,
    expected.relativePath,
    { device: expected.device, inode: expected.inode },
    label,
    childDescriptor
  );
}

/**
 * Observes a directory tree without descending through a symlink or Windows
 * reparse directory.  Reparse descendants are represented as link entries so
 * the owning operation may unlink that exact entry but never traverse it.
 */
function metadataScanNames(
  directory: string,
  observedEntries: number,
  options: Required<Omit<NoFollowDirectoryTreeMetadataOptions, 'signal'>> &
    Pick<NoFollowDirectoryTreeMetadataOptions, 'signal'>
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
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return Object.freeze(names.sort((left, right) => left.localeCompare(right)));
}

function scanNoFollowDirectoryTreeInternal(
  root: PhysicalDirectoryIdentity,
  fileMode: NoFollowDirectoryTreeFileMode,
  metadataOptions: Partial<NoFollowDirectoryTreeMetadataOptions> = {}
): readonly InternalNoFollowDirectoryTreeEntry[] {
  const boundedMetadata = Object.freeze({
    deadlineAtMs: metadataOptions.deadlineAtMs ?? Number.POSITIVE_INFINITY,
    maximumEntries: metadataOptions.maximumEntries ?? 100_000,
    maximumBytes: metadataOptions.maximumBytes ?? Number.POSITIVE_INFINITY,
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
      const names = fileMode === 'metadata-only'
          ? metadataScanNames(`/proc/self/fd/${directoryFd}`, entries.length, boundedMetadata)
        : readdirSync(`/proc/self/fd/${directoryFd}`).sort((left, right) => left.localeCompare(right));
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
          const retained = linuxOpenLeafAt(directoryFd, name, 'No-follow scan leaf');
          try {
            const stat = fstatSync(retained, { bigint: true });
            const kind: NoFollowDirectoryTreeEntryKind = stat.isSymbolicLink()
              ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : (() => {
                throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `Unsupported no-follow directory entry: ${relativePath}.`);
              })();
            let bytes: Uint8Array | null = null;
            let contentDigest: `sha256:${string}` | null = null;
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
                  bytes = readLinuxRetainedFile(readable, 'No-follow scan file');
                } else {
                  const streamed = digestRetainedOrdinaryFileFd(
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
                ? linuxReadRetainedLinkTarget(retained, 'No-follow scan retained link')
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
    boundedMetadata.signal?.throwIfAborted();
    assertSameNoFollowDirectoryIdentity(
      prefix.length === 0 ? target : inspectNoFollowDirectoryChain(directory, 'No-follow scan directory').target,
      'No-follow scan directory'
    );
    const names = fileMode === 'metadata-only'
      ? metadataScanNames(directory, entries.length, boundedMetadata)
      : readdirSync(directory).sort((left, right) => left.localeCompare(right));
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
      if (process.platform === 'win32') {
        const scanned = fileMode === 'bounded-bytes'
          ? Object.freeze({ ...windowsScanRetainedEntry(absolute, 'No-follow scan entry', reserveFileBytes), contentDigest: null })
          : fileMode === 'metadata-only'
            ? Object.freeze({ ...windowsMetadataRetainedEntry(absolute, 'No-follow metadata entry'), bytes: null })
            : Object.freeze({ ...windowsInventoryRetainedEntry(absolute, 'No-follow inventory entry', reserveFileBytes), bytes: null });
        if (fileMode === 'metadata-only' && scanned.kind === 'file') reserveFileBytes(scanned.size);
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
          inspectNoFollowDirectoryChain(absolute, 'No-follow scan descendant');
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
            const streamed = digestRetainedOrdinaryFileFd(fd, identity, 'No-follow scan file');
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
    linkTarget: entry.linkTarget
  })));
}

/**
 * Bounded-memory physical inventory.  File content is streamed in 64-KiB
 * chunks through the stable canonical digest domain; bytes are never retained.
 */
export function scanNoFollowDirectoryTreeInventory(
  root: PhysicalDirectoryIdentity,
  options: Partial<NoFollowDirectoryTreeMetadataOptions> = {}
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternal(root, 'streaming-digest', options).map((entry) => Object.freeze({
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
export function scanNoFollowDirectoryTreeMetadata(
  root: PhysicalDirectoryIdentity,
  options: NoFollowDirectoryTreeMetadataOptions
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  return Object.freeze(scanNoFollowDirectoryTreeInternal(root, 'metadata-only', options).map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest: null,
    linkTarget: entry.linkTarget
  })));
}

function copyInventoryRelativePathIncluded(
  relativePath: string,
  skipNestedNodeModules: boolean,
  includeRelativePaths?: ReadonlySet<string>
): boolean {
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
  includeRelativePaths?: ReadonlySet<string>
): readonly NoFollowDirectoryTreeInventoryEntry[] {
  return Object.freeze(inventory
    .filter(({ relativePath }) => copyInventoryRelativePathIncluded(
      relativePath,
      skipNestedNodeModules,
      includeRelativePaths
    ))
    .map((entry) => Object.freeze({ ...entry })));
}

function sameCopyInventory(
  left: readonly NoFollowDirectoryTreeInventoryEntry[],
  right: readonly NoFollowDirectoryTreeInventoryEntry[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.relativePath !== b.relativePath || a.kind !== b.kind || a.size !== b.size ||
        a.contentDigest !== b.contentDigest || a.linkTarget !== b.linkTarget) return false;
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

interface LinuxBulkDirectoryHandle {
  readonly fd: number;
  readonly identity: PhysicalDirectoryIdentity;
}

interface LinuxBulkDirectoryChain {
  readonly directories: readonly LinuxBulkDirectoryHandle[];
  readonly target: LinuxBulkDirectoryHandle;
  assertCurrent(): void;
  dispose(): void;
}

function linuxRetainBulkDirectoryChain(
  expected: PhysicalDirectoryChain,
  label: string
): LinuxBulkDirectoryChain {
  const filesystemRootFd = linuxRaiseDescriptorFloor(linuxOpenRoot(label), label);
  const handles: LinuxBulkDirectoryHandle[] = [];
  let currentFd = filesystemRootFd;
  let currentPath = path.parse(expected.target.path).root;
  try {
    const segments = expected.target.path.slice(currentPath.length).split('/').filter(Boolean);
    if (segments.length === 0) {
      const identity = linuxIdentity(currentFd, expected.target.path);
      if (expected.ancestors.length !== 1 || !sameIdentity(identity, expected.target) ||
          !sameIdentity(identity, expected.ancestors[0]!)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} root identity changed.`);
      }
      handles.push({ fd: currentFd, identity });
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
        const closeError = closeLinuxDescriptorsBestEffort(
          [...handles].reverse().map((handle) => handle.fd),
          label
        );
        if (closeError !== null) throw closeError;
      }
    });
  } catch (error) {
    // When the target path has components, the current fd is also present in
    // handles only after its identity was accepted.  Close exactly the open
    // descriptors, without trying a lexical cleanup.
    const known = new Set(handles.map((entry) => entry.fd));
    const cleanup = currentFd !== filesystemRootFd && !known.has(currentFd)
      ? [currentFd, ...handles.map((entry) => entry.fd)]
      : handles.map((entry) => entry.fd);
    closeLinuxDescriptorsBestEffort([...cleanup].reverse(), label);
    throw error;
  }
}

interface WindowsBulkDirectoryHandle {
  readonly handle: bigint;
  readonly identity: PhysicalDirectoryIdentity;
}

interface WindowsBulkDirectoryChain {
  readonly directories: readonly WindowsBulkDirectoryHandle[];
  readonly target: WindowsBulkDirectoryHandle;
  assertCurrent(): void;
  dispose(): void;
}

function windowsRetainBulkDirectoryChain(
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
  try {
    for (const [index, current] of paths.entries()) {
      // Withhold delete sharing on every ancestor, not just the final two.
      // The child-process capability is intentionally weaker for ordinary
      // readers; this operation owns a write destination and needs lexical
      // path use to remain anchored for its whole effect.
      const ancestorLabel = `${label} ancestor[${index}] ${current}`;
      const handle = windowsOpenPinnedReadDirectory(current, ancestorLabel);
      const identity = windowsIdentity(handle, current, ancestorLabel);
      if (!sameIdentity(identity, expected.ancestors[index]!)) {
        closeWindowsHandle(handle);
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
      }
      handles.push({ handle, identity });
    }
    const target = handles.at(-1)!;
    if (!sameIdentity(target.identity, expected.target)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} target identity changed.`);
    }
    const assertCurrent = (): void => {
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
        const closeError = closeWindowsHandlesBestEffort(
          [...handles].reverse().map((entry) => entry.handle),
          label
        );
        if (closeError !== null) throw closeError;
      }
    });
  } catch (error) {
    closeWindowsHandlesBestEffort(
      [...handles].reverse().map((entry) => entry.handle),
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
function windowsRetainObservedDirectoryChain(
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
  try {
    for (const [index, current] of paths.entries()) {
      const ancestorLabel = `${label} ancestor[${index}] ${current}`;
      const handle = windowsOpenDirectory(current, ancestorLabel);
      const identity = windowsIdentity(handle, current, ancestorLabel);
      if (!sameIdentity(identity, expected.ancestors[index]!)) {
        closeWindowsHandle(handle);
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
      }
      handles.push({ handle, identity });
    }
    const target = handles.at(-1)!;
    const assertCurrent = (): void => {
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
        const closeError = closeWindowsHandlesBestEffort(
          [...handles].reverse().map((entry) => entry.handle),
          label
        );
        if (closeError !== null) throw closeError;
      }
    });
  } catch (error) {
    closeWindowsHandlesBestEffort(
      [...handles].reverse().map((entry) => entry.handle),
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
  label: string
): void {
  const sourceFd = linuxOpenReadableLeafAt(sourceParent.fd, name, label);
  let targetFd: number | null = null;
  try {
    const before = fstatSync(sourceFd, { bigint: true });
    if (!before.isFile() || String(before.dev) !== entry.device || String(before.ino) !== entry.inode ||
        before.size !== BigInt(entry.size)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed before copy.`);
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
    const after = fstatSync(sourceFd, { bigint: true });
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mode !== before.mode || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed during copy.`);
    }
    if (fsyncSync(targetFd) !== undefined) {
      // fsyncSync either completes or throws.  The branch keeps the effect
      // boundary explicit without treating a truthy return as authority.
    }
    const targetStat = fstatSync(targetFd, { bigint: true });
    if (!targetStat.isFile() || targetStat.size !== before.size) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} target readback differs.`);
    }
  } finally {
    closeSync(sourceFd);
    if (targetFd !== null) closeSync(targetFd);
  }
}

function copyWindowsBulkFile(
  sourceParent: WindowsBulkDirectoryHandle,
  targetParent: WindowsBulkDirectoryHandle,
  entry: NoFollowDirectoryTreeInventoryEntry,
  name: string,
  absoluteTargetPath: string,
  assertDeadline: () => void,
  label: string
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
    if (after.basic !== before.basic || after.size !== before.size ||
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
  } finally {
    closeWindowsHandle(sourceHandle);
    if (targetHandle !== null) closeWindowsHandle(targetHandle);
  }
}

async function copyNoFollowSingleTreeWithRetainedHandles(input: Readonly<{
  readonly source: PhysicalDirectoryChain;
  readonly target: string;
  readonly targetParent: PhysicalDirectoryChain;
  readonly sourceInventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  readonly maximumEntries: number;
  readonly assertDeadline: () => void;
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
    const targetParentChain = linuxRetainBulkDirectoryChain(input.targetParent, 'No-follow bulk target parent');
    const targetDirectories: LinuxBulkDirectoryHandle[] = [];
    const sourceDirectories = new Map<string, LinuxBulkDirectoryHandle>([['', sourceChain.target]]);
    try {
      sourceChain.assertCurrent();
      targetParentChain.assertCurrent();
      const targetRoot = linuxCreateBulkDirectory(
        targetParentChain.target,
        path.basename(input.target),
        input.target,
        'No-follow bulk target root'
      );
      targetDirectories.push(targetRoot);
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
          const sourceIdentity = linuxIdentity(sourceFd, path.join(sourceParent.identity.path, name));
          if (sourceIdentity.device !== entry.device || sourceIdentity.inode !== entry.inode) {
            closeSync(sourceFd);
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `No-follow bulk source directory changed for ${entry.relativePath}.`);
          }
          sourceDirectories.set(entry.relativePath, { fd: sourceFd, identity: sourceIdentity });
          const child = linuxCreateBulkDirectory(targetParent, name, path.join(targetParent.identity.path, name), 'No-follow bulk target directory');
          targetDirectories.push(child);
          directoryByPath.set(entry.relativePath, child);
        } else if (entry.kind === 'file') {
          copyLinuxBulkFile(sourceParent, targetParent, entry, name, input.assertDeadline, 'No-follow bulk file');
        } else {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk source contains an unsupported link: ${entry.relativePath}.`);
        }
      }
      sourceChain.assertCurrent();
      targetParentChain.assertCurrent();
    } finally {
      for (const directory of [...targetDirectories].reverse()) closeSync(directory.fd);
      // Source directory handles are retained for the whole operation so a
      // descendant cannot be redirected between inventory and its effect.
      // The root is owned by sourceChain and must not be closed twice.
      const retainedSourceDirectories = new Set(sourceDirectories.values());
      for (const directory of [...retainedSourceDirectories].reverse()) {
        if (directory.fd !== sourceChain.target.fd) closeSync(directory.fd);
      }
      sourceChain.dispose();
      targetParentChain.dispose();
    }
    return;
  }
  if (process.platform === 'win32') {
    const sourceChain = windowsRetainBulkDirectoryChain(input.source, 'No-follow bulk source');
    const targetParentChain = windowsRetainBulkDirectoryChain(input.targetParent, 'No-follow bulk target parent');
    const targetDirectories: WindowsBulkDirectoryHandle[] = [];
    const sourceDirectories = new Map<string, WindowsBulkDirectoryHandle>([['', sourceChain.target]]);
    try {
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
            WINDOWS_SHARE_READ
          );
          if (next === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `No-follow bulk source directory disappeared for ${entry.relativePath}.`);
          const sourceIdentity = windowsIdentity(next, sourcePath, 'No-follow bulk source directory');
          if (sourceIdentity.device !== entry.device || sourceIdentity.inode !== entry.inode) {
            closeWindowsHandle(next);
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `No-follow bulk source directory changed for ${entry.relativePath}.`);
          }
          sourceDirectories.set(entry.relativePath, { handle: next, identity: sourceIdentity });
          const child = windowsCreateBulkDirectory(targetParent, name, path.join(targetParent.identity.path, name), 'No-follow bulk target directory');
          targetDirectories.push(child);
          directoryByPath.set(entry.relativePath, child);
        } else if (entry.kind === 'file') {
          copyWindowsBulkFile(sourceParent, targetParent, entry, name, path.join(targetParent.identity.path, name), input.assertDeadline, 'No-follow bulk file');
        } else {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `No-follow bulk source contains an unsupported link: ${entry.relativePath}.`);
        }
      }
      sourceChain.assertCurrent();
      targetParentChain.assertCurrent();
    } finally {
      for (const directory of [...targetDirectories].reverse()) closeWindowsHandle(directory.handle);
      const retainedSourceDirectories = new Set(sourceDirectories.values());
      for (const directory of [...retainedSourceDirectories].reverse()) {
        if (directory.handle !== sourceChain.target.handle) closeWindowsHandle(directory.handle);
      }
      sourceChain.dispose();
      targetParentChain.dispose();
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
    label: string
  ): readonly NoFollowDirectoryTreeInventoryEntry[] => {
    assertDeadline();
    const remaining = maximumEntries - traversedEntryCount;
    if (remaining < 1) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `No-follow bulk copy total entry bound exhausted before ${label}.`);
    }
    const inventory = scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs,
      maximumEntries: remaining,
      maximumBytes: maximumBytes === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : maximumBytes - traversedByteCount,
      signal: options.signal
    });
    traversedEntryCount += inventory.length;
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
    if (lexicalPathOverlap(source.path, target)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy source and destination are lexically overlapping.');
    }
    const targetParentChain = inspectNoFollowDirectoryChain(
      targetParentPath,
      'No-follow bulk copy target parent chain'
    );
    if (targetParentChain.ancestors.some((ancestor) => samePhysicalObject(ancestor, source))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy target parent is physically contained by the source.');
    }
    sourceChains.push(sourceChain);
    targetLexicalPaths.push(target);
    targetParentLexicalPaths.push(targetParentPath);
    const targetPresence = inspectExactNoFollowDirectoryPresence(target, 'No-follow bulk copy target');
    if (targetPresence.state !== 'absent') {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy target is already occupied.');
    }
    // Scan and bound the complete source tree before creating a destination
    // parent or invoking the copier.  Filtering is a projection of this
    // already-bounded inventory; excluded entries still consume the operation
    // budget and cannot turn an unbounded source into a bounded copy.
    const completeSourceInventory = boundedInventory(source, 'source inventory');
    const sourceInventory = comparableCopyInventory(
      completeSourceInventory,
      skipNestedNodeModules,
      includeRelativePaths
    );
    if (sourceInventory.some(({ kind }) => kind === 'link')) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy source contains a reparse entry.');
    }
    return Object.freeze({ source, target, targetParent, targetParentPath, sourceChain, targetParentChain, sourceInventory });
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
      if (lexicalPathOverlap(sourceChains[sourceIndex]!.target.path, targetLexicalPaths[targetIndex]!)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow bulk copy source and destination roots overlap.');
      }
    }
  }

  await options.assertCurrent?.();
  assertDeadline();
  const preparedSnapshots = snapshots.map((snapshot) => Object.freeze({
    ...snapshot,
    targetParentIdentity: createNoFollowOrdinaryDirectoryChain(
      snapshot.targetParent.ancestor,
      snapshot.targetParent.segments
    )
  }));
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
      assertDeadline
    });
    const target = inspectNoFollowDirectoryChain(snapshot.target, 'No-follow bulk copy target readback').target;
    if (!samePhysicalObject(snapshot.targetParentIdentity, inspectNoFollowDirectoryChain(
      path.dirname(snapshot.target),
      'No-follow bulk copy target parent readback'
    ).target)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy target parent changed.');
    }
    const targetInventory = comparableCopyInventory(
      boundedInventory(target, 'target readback'),
      skipNestedNodeModules,
      includeRelativePaths
    );
    if (!sameCopyInventory(snapshot.sourceInventory, targetInventory)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy target readback differs.');
    }
    const sourceAfterChain = assertSameNoFollowDirectoryIdentity(
      snapshot.source,
      'No-follow bulk copy source readback'
    );
    const sourceAfterInventory = comparableCopyInventory(
      boundedInventory(sourceAfterChain.target, 'source readback'),
      skipNestedNodeModules,
      includeRelativePaths
    );
    if (!sameCopyInventory(snapshot.sourceInventory, sourceAfterInventory)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow bulk copy source changed during effect.');
    }
  }
  assertDeadline();
  await options.assertCurrent?.();
}

function createNoFollowDirectoryChainInternal(
  root: PhysicalDirectoryIdentity,
  segments: readonly string[],
  testOnlyRaceActor?: LinuxNoFollowDirectoryCreateRaceActor
): PhysicalDirectoryIdentity {
  const rootChain = assertSameNoFollowDirectoryIdentity(root, 'No-follow directory creation root');
  let current = rootChain.target;
  if (process.platform === 'linux') {
    const transaction = linuxOpenWatchedCanonicalDirectoryChain(
      rootChain,
      'No-follow directory creation root',
      testOnlyRaceActor
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
          label: 'No-follow directory creation target',
          testOnlyRaceActor
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
export function createNoFollowDirectoryChain(
  root: PhysicalDirectoryIdentity,
  segments: readonly string[],
  testOnlyRaceActor?: LinuxNoFollowDirectoryCreateRaceActor
): PhysicalDirectoryIdentity {
  for (const segment of segments) {
    if (segment !== '.tmp' && !/^[a-z0-9-]+$/u.test(segment)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow directory creation segment is invalid.');
    }
  }
  return createNoFollowDirectoryChainInternal(root, segments, testOnlyRaceActor);
}

function ensureOrdinaryDirectorySegment(segment: string): void {
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
 * Issues the only runtime-admissible actor for the Linux replacement-race
 * seam.  This is intentionally named and shaped as a test issuer: it does
 * not carry a retained descriptor, a directory identity, an authorization,
 * or any other production capability.  The returned object can only be
 * consumed by the optional test seam on the creation primitives below.
 */
export function createLinuxNoFollowDirectoryCreateRaceActorForTests(input: {
  readonly point: LinuxNoFollowDirectoryCreateRacePoint;
  readonly targetPath: string;
  readonly displacedPath: string;
}): LinuxNoFollowDirectoryCreateRaceActor {
  if (input === null || typeof input !== 'object') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Linux race actor issuer input is unavailable.'
    );
  }
  if (process.platform !== 'linux') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'The Linux no-follow directory-create race actor is unavailable on this platform.'
    );
  }
  if (input.point !== 'before-canonical-chain-open'
    && input.point !== 'after-ancestor-open'
    && input.point !== 'before-child-witness') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      'Linux race actor point is not a supported retained-transaction boundary.'
    );
  }
  const targetPath = requireAbsoluteDirectoryPath(input.targetPath, 'Linux race target');
  const displacedPath = requireAbsoluteDirectoryPath(input.displacedPath, 'Linux race displacement');
  if (targetPath === displacedPath || path.dirname(targetPath) !== path.dirname(displacedPath)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      'Linux race target and displacement must be distinct sibling directory paths.'
    );
  }
  ensureOrdinaryDirectorySegment(path.basename(targetPath));
  ensureOrdinaryDirectorySegment(path.basename(displacedPath));
  const actor = Object.freeze({
    point: input.point,
    targetPath,
    displacedPath
  });
  linuxNoFollowDirectoryCreateRaceActors.set(actor, {
    point: input.point,
    targetPath,
    displacedPath,
    used: false
  });
  return actor;
}

/**
 * Executes one issued test race at a precise retained-transaction boundary.
 * The effect is intentionally fixed to sibling directory replacement and is
 * never used to grant, retain, or validate a production capability.
 */
function linuxInvokeNoFollowDirectoryCreateRaceActor(
  actorInput: unknown,
  point: LinuxNoFollowDirectoryCreateRacePoint,
  observedPath: string,
  label: string
): void {
  if (actorInput === undefined) return;
  if (actorInput === null || typeof actorInput !== 'object') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} received an invalid Linux test race actor.`
    );
  }
  const actor = actorInput as Partial<LinuxNoFollowDirectoryCreateRaceActor>;
  const record = linuxNoFollowDirectoryCreateRaceActors.get(actorInput);
  if (record === undefined
    || actor.point !== record.point
    || actor.targetPath !== record.targetPath
    || actor.displacedPath !== record.displacedPath) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} received a Linux test race actor not issued by this physical owner.`
    );
  }
  if (record.point !== point) return;
  if (record.targetPath !== path.resolve(observedPath)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} Linux test race actor target does not match the retained transaction point.`
    );
  }
  if (record.used) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} Linux test race actor is single-use.`
    );
  }
  record.used = true;
  try {
    let displacedExists = false;
    try {
      lstatSync(record.displacedPath);
      displacedExists = true;
    } catch (error) {
      if (!absent(error)) throw error;
    }
    if (displacedExists) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} Linux test race displacement already exists.`
      );
    }
    renameSync(record.targetPath, record.displacedPath);
    mkdirSync(record.targetPath, { mode: 0o700 });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) throw error;
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
      `${label} Linux test race actor could not replace its target directory.`,
      error
    );
  }
}

/**
 * Materializes ordinary host path components without following aliases. This
 * is the path-allocation primitive for external runtime roots whose existing
 * parent names are not SEC-controlled lowercase namespace identifiers.
 */
export function createNoFollowOrdinaryDirectoryChain(
  root: PhysicalDirectoryIdentity,
  segments: readonly string[]
): PhysicalDirectoryIdentity {
  for (const segment of segments) ensureOrdinaryDirectorySegment(segment);
  return createNoFollowDirectoryChainInternal(root, segments);
}

/**
 * Opens one already-existing ordinary directory relative to a retained parent.
 * This is deliberately inspect-only: an absent child never becomes a create
 * effect, which lets a delegated consumer adopt an issuer-created inode
 * without acquiring directory-creation authority.
 */
export function inspectNoFollowDirectoryChild(
  parentInput: PhysicalDirectoryIdentity,
  name: string,
  label = 'No-follow directory child'
): PhysicalDirectoryIdentity | null {
  if (!/^[a-z0-9-]+$/u.test(name)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} name is invalid.`);
  }
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
 * Creates exactly one absent ordinary directory relative to a retained parent.
 * Existing names are never adopted: an EEXIST/name collision is a foreign
 * effect boundary, not a successful retry.
 */
export function createExclusiveNoFollowDirectory(
  parentInput: PhysicalDirectoryIdentity,
  name: string,
  testOnlyRaceActor?: LinuxNoFollowDirectoryCreateRaceActor
): PhysicalDirectoryIdentity {
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

function ensureLeafName(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value === '.' || value === '..' ||
    value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Durable publication file name must be one ordinary leaf name.');
  }
}

function syncDirectory(parent: PhysicalDirectoryIdentity): void {
  assertSameNoFollowDirectoryIdentity(parent, 'Durable publication parent');
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
      assertSameNoFollowDirectoryIdentity(chain.target, 'Durable publication parent');
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

function linuxRetainedPublicationParent(parent: PhysicalDirectoryIdentity, label: string): { rootFd: number; parentFd: number } {
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

function windowsRetainedPublicationParent(parent: PhysicalDirectoryIdentity, label: string): bigint {
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
  parent: PhysicalDirectoryIdentity,
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
export function publishExclusiveDurableCanonicalFile(input: {
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly validate: (bytes: Uint8Array) => void;
}): Readonly<{ path: string; digest: string; created: boolean }> {
  ensureLeafName(input.name);
  const parent = assertSameNoFollowDirectoryIdentity(input.parent, 'Durable publication parent').target;
  const finalPath = path.join(parent.path, input.name);
  const expected = Buffer.from(input.bytes);
  const validateCanonicalBytes = (bytes: Uint8Array, label: string): void => {
    try {
      input.validate(bytes);
    } catch (error) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
        `${label} is not canonical.`,
        error
      );
    }
  };
  validateCanonicalBytes(expected, 'Durable publication input');
  const expectedDigest = bytesDigest(expected);

  const existing = (): Readonly<{ path: string; digest: string; created: boolean }> => {
    const current = readNoFollowOrdinaryFile(parent, input.name);
    if (current === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', 'Durable publication target disappeared before no-follow readback.');
    if (!Buffer.from(current).equals(expected)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable publication target conflicts with canonical bytes.');
    }
    validateCanonicalBytes(current, 'Durable publication target');
    // An already-present byte-identical file is not a proof that a previous
    // publication reached the required parent-directory durability boundary.
    syncDirectory(parent);
    assertSameNoFollowDirectoryIdentity(parent, 'Durable publication parent');
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
      const current = readNoFollowOrdinaryFile(parent, input.name);
      if (current === null || !Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication retained readback differs.');
      validateCanonicalBytes(current, 'Exclusive durable publication retained readback');
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
      if (!Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable publication target conflicts with canonical bytes.', error);
      validateCanonicalBytes(current, 'Durable publication target');
      return Object.freeze({ path: finalPath, digest: expectedDigest, created: false });
    }
    const current = windowsReadRenamedCandidate(candidate, parentHandle, parent, input.name, expected, 'Exclusive durable publication');
    validateCanonicalBytes(current, 'Exclusive durable publication retained readback');
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
type DurableCanonicalFileReplacementInput = {
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly validate: (bytes: Uint8Array) => void;
  /**
   * Optional expected current file identity.  When supplied, publication is
   * a physical CAS: `null` means the final name must still be absent; a file
   * identity is moved aside through a retained handle before a no-replace
   * publication.  A foreign writer is never overwritten.
   */
  readonly expectedExisting?: Readonly<{ device: string; inode: string }> | null;
};

function replaceDurableCanonicalFileWithExpectedIdentity(
  input: DurableCanonicalFileReplacementInput
): Readonly<{ path: string; digest: string }> {
  const expectedExisting = input.expectedExisting;
  if (expectedExisting === null) {
    const published = publishExclusiveDurableCanonicalFile({
      parent: input.parent,
      name: input.name,
      bytes: input.bytes,
      validate: input.validate
    });
    if (!published.created) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable pointer CAS expected an absent leaf but it is occupied.');
    }
    return Object.freeze({ path: published.path, digest: published.digest });
  }
  if (expectedExisting === undefined) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Durable pointer CAS requires an explicit current identity.');
  }
  const expectedCurrent = expectedExisting;
  const parent = assertSameNoFollowDirectoryIdentity(input.parent, 'Durable CAS parent').target;
  const finalPath = path.join(parent.path, input.name);
  const expected = Buffer.from(input.bytes);
  input.validate(expected);
  if (process.platform === 'linux') {
    const retained = linuxRetainedPublicationParent(parent, 'Durable CAS');
    const temporaryName = `.${input.name}.${randomUUID()}.cas`;
    let candidateFd: number | null = null;
    let exchanged = false;
    try {
      candidateFd = linuxCreateCandidateAt(retained.parentFd, temporaryName, expected, 'Durable CAS');
      const currentFd = linuxOpenLeafAt(retained.parentFd, input.name, 'Durable CAS current');
      try {
        const current = fstatSync(currentFd, { bigint: true });
        if (!current.isFile() || String(current.dev) !== expectedCurrent.device || String(current.ino) !== expectedCurrent.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable pointer CAS current identity changed.');
        }
      } finally {
        closeSync(currentFd);
      }
      if (requireLinuxLibc().symbols.renameat2(
        retained.parentFd,
        Buffer.from(`${temporaryName}\0`, 'utf8'),
        retained.parentFd,
        Buffer.from(`${input.name}\0`, 'utf8'),
        LINUX_RENAME_EXCHANGE
      ) !== 0) {
        throw physicalError(
          linuxErrno() === 22 || linuxErrno() === 38
            ? 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
            : 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
          `Durable pointer CAS exchange failed (errno ${linuxErrno()}).`
        );
      }
      exchanged = true;
      const oldFd = linuxOpenLeafAt(retained.parentFd, temporaryName, 'Durable CAS old current');
      try {
        const old = fstatSync(oldFd, { bigint: true });
        if (!old.isFile() || String(old.dev) !== expectedCurrent.device || String(old.ino) !== expectedCurrent.inode) {
          if (requireLinuxLibc().symbols.renameat2(
            retained.parentFd,
            Buffer.from(`${temporaryName}\0`, 'utf8'),
            retained.parentFd,
            Buffer.from(`${input.name}\0`, 'utf8'),
            LINUX_RENAME_EXCHANGE
          ) !== 0) {
            throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Durable pointer CAS rollback exchange failed (errno ${linuxErrno()}).`);
          }
          exchanged = false;
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable pointer CAS observed a foreign current identity.');
        }
      } finally {
        closeSync(oldFd);
      }
      if (requireLinuxLibc().symbols.unlinkat(
        retained.parentFd,
        Buffer.from(`${temporaryName}\0`, 'utf8'),
        0
      ) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Durable pointer CAS old-current cleanup failed (errno ${linuxErrno()}).`);
      }
      exchanged = false;
      if (requireLinuxLibc().symbols.fsync(retained.parentFd) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable pointer CAS parent fsync failed.');
      }
      const current = readNoFollowOrdinaryFile(parent, input.name);
      if (current === null || !Buffer.from(current).equals(expected)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable pointer CAS final readback differs.');
      }
      input.validate(current);
      return Object.freeze({ path: finalPath, digest: bytesDigest(expected) });
    } finally {
      if (candidateFd !== null) closeSync(candidateFd);
      if (exchanged) {
        // If an effect failed after exchange, never silently remove the
        // current name.  Exchange back preserves both the candidate and the
        // preimage; failure to restore is a typed residue condition.
        if (requireLinuxLibc().symbols.renameat2(
          retained.parentFd,
          Buffer.from(`${temporaryName}\0`, 'utf8'),
          retained.parentFd,
          Buffer.from(`${input.name}\0`, 'utf8'),
          LINUX_RENAME_EXCHANGE
        ) !== 0) {
          throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Durable pointer CAS effect rollback failed (errno ${linuxErrno()}).`);
        }
      }
      if (requireLinuxLibc().symbols.unlinkat(
        retained.parentFd,
        Buffer.from(`${temporaryName}\0`, 'utf8'),
        0
      ) !== 0 && linuxErrno() !== 2) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Durable pointer CAS candidate cleanup failed (errno ${linuxErrno()}).`);
      }
      closeLinuxRetainedPublicationParent(retained);
    }
  }
  if (process.platform !== 'win32') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Durable pointer CAS backend is unavailable on this platform.');
  }
  const parentHandle = windowsRetainedPublicationParent(parent, 'Durable CAS');
  const temporaryName = `.${input.name}.${randomUUID()}.cas`;
  const temporaryPath = path.join(parent.path, temporaryName);
  const oldName = `.${input.name}.${randomUUID()}.old`;
  let candidate: bigint | null = null;
  let oldCurrent: bigint | null = null;
  let candidateRenamed = false;
  let oldRenamed = false;
  try {
    candidate = windowsOpenRelativeLeaf(
      parentHandle, parent, temporaryName, temporaryPath,
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
      WINDOWS_FILE_CREATE, 'Durable CAS candidate'
    );
    if (candidate === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS candidate unexpectedly absent.');
    const candidateIdentity = windowsRetainedLeafIdentity(candidate, temporaryPath, 'file', 'Durable CAS candidate');
    windowsWriteRetainedFile(candidate, expected, 'Durable CAS candidate');
    oldCurrent = windowsOpenRelativeLeaf(
      parentHandle, parent, input.name, finalPath,
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
      WINDOWS_FILE_OPEN, 'Durable CAS current'
    );
    if (oldCurrent === null) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable pointer CAS current disappeared.');
    const currentIdentity = windowsRetainedLeafIdentity(oldCurrent, finalPath, 'file', 'Durable CAS current');
    if (currentIdentity.device !== expectedCurrent.device || currentIdentity.inode !== expectedCurrent.inode) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable pointer CAS current identity changed.');
    }
    windowsRenameRetainedOrdinaryFile(
      oldCurrent, finalPath, expectedCurrent, parentHandle, oldName, false, 'Durable CAS old current'
    );
    oldRenamed = true;
    windowsRenameRetainedOrdinaryFile(
      candidate, temporaryPath, candidateIdentity, parentHandle, input.name, false, 'Durable CAS publication'
    );
    candidateRenamed = true;
    const current = windowsReadRenamedCandidate(candidate, parentHandle, parent, input.name, expected, 'Durable CAS');
    input.validate(current);
    windowsMarkRetainedLeafForDelete(oldCurrent, 'Durable CAS old current cleanup');
    closeWindowsHandle(oldCurrent);
    oldCurrent = null;
    const oldReadback = windowsReadRelativeOrdinaryLeaf(parentHandle, parent, oldName, 'Durable CAS old current cleanup readback');
    if (oldReadback !== null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS old current residue remains.');
    return Object.freeze({ path: finalPath, digest: bytesDigest(expected) });
  } finally {
    if (oldCurrent !== null) {
      if (oldRenamed) {
        try { windowsMarkRetainedLeafForDelete(oldCurrent, 'Durable CAS old current rollback cleanup'); } catch { /* preserve residue */ }
      }
      closeWindowsHandle(oldCurrent);
    }
    if (candidate !== null) {
      if (!candidateRenamed) {
        try { windowsMarkRetainedLeafForDelete(candidate, 'Durable CAS candidate cleanup'); } catch { /* preserve residue */ }
      }
      closeWindowsHandle(candidate);
    }
    if (windowsReadRelativeOrdinaryLeaf(parentHandle, parent, temporaryName, 'Durable CAS candidate cleanup readback') !== null) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS candidate residue remains.');
    }
    if (windowsReadRelativeOrdinaryLeaf(parentHandle, parent, oldName, 'Durable CAS old current final readback') !== null) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS old-current residue remains.');
    }
    closeWindowsHandle(parentHandle);
  }
}

export function replaceDurableCanonicalFile(input: DurableCanonicalFileReplacementInput): Readonly<{ path: string; digest: string }> {
  ensureLeafName(input.name);
  const parent = assertSameNoFollowDirectoryIdentity(input.parent, 'Durable replacement parent').target;
  const finalPath = path.join(parent.path, input.name);
  const expected = Buffer.from(input.bytes);
  input.validate(expected);
  if (input.expectedExisting !== undefined) {
    return replaceDurableCanonicalFileWithExpectedIdentity(input);
  }
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
      const current = readNoFollowOrdinaryFile(parent, input.name);
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
export function relocateRetainedNoFollowDirectory(input: {
  readonly directory: PhysicalDirectoryIdentity;
  readonly tombstoneName: string;
}): PhysicalDirectoryIdentity {
  ensureLeafName(input.tombstoneName);
  const source = assertSameNoFollowDirectoryIdentity(input.directory, 'Retained directory relocation source').target;
  const parentPath = path.dirname(source.path);
  const parent = inspectNoFollowDirectoryChain(parentPath, 'Retained directory relocation parent').target;
  const destination = path.join(parent.path, input.tombstoneName);
  if (inspectExactNoFollowDirectoryPresence(destination, 'Retained directory relocation tombstone').state !== 'absent') {
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
  if (inspectExactNoFollowDirectoryPresence(source.path, 'Retained directory relocation source').state !== 'absent') {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained directory relocation source remains present.');
  }
  const moved = inspectNoFollowDirectoryChain(destination, 'Retained directory relocation tombstone').target;
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
export function relocateRetainedNoFollowDirectoryAcrossParents(input: {
  readonly directory: PhysicalDirectoryIdentity;
  readonly destinationParent: PhysicalDirectoryIdentity;
  readonly tombstoneName: string;
}): PhysicalDirectoryIdentity {
  ensureLeafName(input.tombstoneName);
  const source = assertSameNoFollowDirectoryIdentity(input.directory, 'Retained cross-parent relocation source').target;
  const sourceParent = inspectNoFollowDirectoryChain(path.dirname(source.path), 'Retained cross-parent relocation source parent').target;
  const destinationParent = assertSameNoFollowDirectoryIdentity(input.destinationParent, 'Retained cross-parent relocation destination parent').target;
  const destination = path.join(destinationParent.path, input.tombstoneName);
  if (inspectExactNoFollowDirectoryPresence(destination, 'Retained cross-parent relocation tombstone').state !== 'absent') {
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
  if (inspectExactNoFollowDirectoryPresence(source.path, 'Retained cross-parent relocation source').state !== 'absent') throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained cross-parent relocation source remains present.');
  const moved = inspectNoFollowDirectoryChain(destination, 'Retained cross-parent relocation tombstone').target;
  if (source.device !== moved.device || source.inode !== moved.inode || source.objectId !== moved.objectId) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained cross-parent relocation destination identity differs.');
  }
  return moved;
}

function normalizePhysicalLinkTarget(value: string, parentPath: string): string {
  const candidate = path.isAbsolute(value) ? value : path.resolve(parentPath, value);
  const resolved = path.resolve(candidate);
  if (process.platform !== 'win32') return resolved;
  const withoutDevicePrefix = resolved.startsWith('\\\\?\\UNC\\')
    ? `\\\\${resolved.slice('\\\\?\\UNC\\'.length)}`
    : resolved.startsWith('\\\\?\\')
      ? resolved.slice('\\\\?\\'.length)
      : resolved;
  return withoutDevicePrefix.toLocaleLowerCase('en-US');
}

function assertPhysicalLinkTarget(
  actual: string,
  expected: string,
  parentPath: string,
  label: string
): void {
  if (normalizePhysicalLinkTarget(actual, parentPath) !== normalizePhysicalLinkTarget(expected, parentPath)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} target changed.`);
  }
}

/**
 * Publishes one directory locator link below a retained parent.  Creation is
 * no-replace and the target directory identity is fenced before and after the
 * link effect.  On Linux the effect is `symlinkat` relative to the retained
 * parent fd; on Windows every parent component is pinned without delete
 * sharing while the narrowly-scoped native link call runs.
 */
export function publishExclusiveNoFollowLink(input: Readonly<{
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly source: PhysicalDirectoryIdentity;
  readonly expectedTargetPath: string;
}>): Readonly<{ path: string; source: PhysicalDirectoryIdentity; linkTarget: string }> {
  ensureLeafName(input.name);
  const source = assertSameNoFollowDirectoryIdentity(input.source, 'No-follow link source').target;
  assertPhysicalLinkTarget(source.path, input.expectedTargetPath, input.parent.path, 'No-follow link source');
  const parentChain = inspectNoFollowDirectoryChain(input.parent.path, 'No-follow link parent');
  // Retain the source generation for the complete link effect as well as the
  // destination parent.  A post-effect source check alone would discover an
  // ABA replacement only after a link had already been published to a
  // foreign target path.
  const sourceChain = inspectNoFollowDirectoryChain(source.path, 'No-follow link source');
  const finalPath = path.join(parentChain.target.path, input.name);
  if (process.platform === 'linux') {
    const retained = linuxRetainBulkDirectoryChain(parentChain, 'No-follow link parent');
    let retainedSource: LinuxBulkDirectoryChain | null = null;
    let linkFd: number | null = null;
    try {
      retainedSource = linuxRetainBulkDirectoryChain(sourceChain, 'No-follow link source');
      retained.assertCurrent();
      retainedSource.assertCurrent();
      const status = requireLinuxLibc().symbols.symlinkat(
        Buffer.from(`${source.path}\0`, 'utf8'),
        retained.target.fd,
        Buffer.from(`${input.name}\0`, 'utf8')
      );
      if (status !== 0) {
        const errno = linuxErrno();
        if (errno === 17) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link destination already exists.');
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `No-follow link publication failed (errno ${errno}).`);
      }
      linkFd = linuxOpenLeafAt(retained.target.fd, input.name, 'No-follow link publication readback');
      const stat = fstatSync(linkFd, { bigint: true });
      if (!stat.isSymbolicLink()) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link publication kind changed.');
      const actual = linuxReadRetainedLinkTarget(linkFd, 'No-follow link publication readback');
      assertPhysicalLinkTarget(actual, source.path, parentChain.target.path, 'No-follow link publication');
      if (!sameIdentity(source, linuxIdentity(retainedSource.target.fd, source.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link source changed after publication.');
      }
      retained.assertCurrent();
      retainedSource.assertCurrent();
      return Object.freeze({
        path: finalPath,
        source,
        linkTarget: normalizePhysicalLinkTarget(actual, parentChain.target.path)
      });
    } finally {
      if (linkFd !== null) closeSync(linkFd);
      retained.dispose();
      retainedSource?.dispose();
    }
  }
  if (process.platform === 'win32') {
    const retained = windowsRetainBulkDirectoryChain(parentChain, 'No-follow link parent');
    let retainedSource: WindowsBulkDirectoryChain | null = null;
    let linkHandle: bigint | null = null;
    try {
      retainedSource = windowsRetainObservedDirectoryChain(sourceChain, 'No-follow link source');
      retained.assertCurrent();
      retainedSource.assertCurrent();
      linkHandle = windowsCreateRelativeJunction(
        retained.target,
        input.name,
        source.path,
        finalPath,
        'No-follow link publication'
      );
      const linkIdentity = windowsRetainedLeafIdentity(
        linkHandle,
        finalPath,
        'link',
        'No-follow link publication'
      );
      const actual = windowsReadRetainedJunctionTarget(
        linkHandle,
        source.path,
        retained.target.identity.path,
        'No-follow link publication'
      );
      if (!sameIdentity(source, retainedSource.target.identity)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link source changed after publication.');
      }
      retained.assertCurrent();
      retainedSource.assertCurrent();
      const lexicalSource = assertSameNoFollowDirectoryIdentity(
        source,
        'No-follow link source final lexical readback'
      ).target;
      if (!sameIdentity(source, lexicalSource)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link source changed after publication.');
      }
      if (linkIdentity.device.length === 0 || linkIdentity.inode.length === 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link publication has no physical identity.');
      }
      return Object.freeze({ path: finalPath, source, linkTarget: actual });
    } finally {
      if (linkHandle !== null) closeWindowsHandle(linkHandle);
      retained.dispose();
      retainedSource?.dispose();
    }
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `No-follow link publication is unavailable on ${process.platform}.`);
}

function windowsRenameRetainedNoFollowLeaf(
  sourceHandle: bigint,
  sourcePath: string,
  kind: 'file' | 'link',
  sourceIdentity: Readonly<{ device: string; inode: string }>,
  targetParentHandle: bigint,
  destinationLeafName: string,
  label: string
): void {
  const before = windowsRetainedLeafIdentity(sourceHandle, sourcePath, kind, label);
  if (before.device !== sourceIdentity.device || before.inode !== sourceIdentity.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} source identity changed before handle rename.`);
  }
  ensureLeafName(destinationLeafName);
  const fileName = Buffer.from(destinationLeafName, 'utf16le');
  const name = Buffer.concat([fileName, Buffer.alloc(2)]);
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
  const legacyStatus = requireWindowsNtdll().symbols.NtSetInformationFile(
    sourceHandle, ioStatus, info, info.byteLength, WINDOWS_NT_FILE_RENAME_INFORMATION
  );
  if (legacyStatus < 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} native handle rename failed (NTSTATUS ${exStatus}; ${legacyStatus}).`);
  }
}

/** Moves an exact directory locator link between retained parents without replacing a target. */
export function relocateRetainedNoFollowLinkAcrossParents(input: Readonly<{
  readonly sourceParent: PhysicalDirectoryIdentity;
  readonly destinationParent: PhysicalDirectoryIdentity;
  readonly sourceName: string;
  readonly destinationName: string;
  readonly expectedSource: PhysicalDirectoryIdentity;
  readonly expectedTargetPath: string;
}>): void {
  ensureLeafName(input.sourceName);
  ensureLeafName(input.destinationName);
  const sourceParentChain = inspectNoFollowDirectoryChain(input.sourceParent.path, 'No-follow link source parent');
  const destinationParentChain = inspectNoFollowDirectoryChain(input.destinationParent.path, 'No-follow link destination parent');
  const expectedSource = assertSameNoFollowDirectoryIdentity(input.expectedSource, 'No-follow link source target').target;
  const expectedSourceChain = inspectNoFollowDirectoryChain(expectedSource.path, 'No-follow link source target');
  if (process.platform === 'linux') {
    const sourceParent = linuxRetainBulkDirectoryChain(sourceParentChain, 'No-follow link source parent');
    const destinationParent = linuxRetainBulkDirectoryChain(destinationParentChain, 'No-follow link destination parent');
    let sourceTarget: LinuxBulkDirectoryChain | null = null;
    let sourceFd: number | null = null;
    let destinationFd: number | null = null;
    try {
      sourceTarget = linuxRetainBulkDirectoryChain(expectedSourceChain, 'No-follow link source target');
      sourceParent.assertCurrent();
      destinationParent.assertCurrent();
      sourceTarget.assertCurrent();
      sourceFd = linuxOpenLeafAt(sourceParent.target.fd, input.sourceName, 'No-follow link relocation source');
      const stat = fstatSync(sourceFd, { bigint: true });
      if (!stat.isSymbolicLink()) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link relocation source kind changed.');
      const actual = linuxReadRetainedLinkTarget(sourceFd, 'No-follow link relocation source');
      assertPhysicalLinkTarget(actual, input.expectedTargetPath, sourceParent.target.identity.path, 'No-follow link relocation');
      const expectedLinkIdentity = { device: String(stat.dev), inode: String(stat.ino) };
      const destinationPath = path.join(destinationParent.target.identity.path, input.destinationName);
      try {
        destinationFd = linuxOpenLeafAt(destinationParent.target.fd, input.destinationName, 'No-follow link relocation destination');
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link relocation destination already exists.');
      } catch (error) {
        if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      } finally {
        if (destinationFd !== null) { closeSync(destinationFd); destinationFd = null; }
      }
      if (requireLinuxLibc().symbols.renameat2(
        sourceParent.target.fd,
        Buffer.from(`${input.sourceName}\0`, 'utf8'),
        destinationParent.target.fd,
        Buffer.from(`${input.destinationName}\0`, 'utf8'),
        LINUX_RENAME_NOREPLACE
      ) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `No-follow link relocation failed (errno ${linuxErrno()}).`);
      }
      if (requireLinuxLibc().symbols.fsync(sourceParent.target.fd) !== 0 ||
          requireLinuxLibc().symbols.fsync(destinationParent.target.fd) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'No-follow link relocation parent fsync failed.');
      }
      try {
        sourceFd = linuxOpenLeafAt(sourceParent.target.fd, input.sourceName, 'No-follow link relocation source readback');
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'No-follow link relocation source remains present.');
      } catch (error) {
        if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      } finally {
        if (sourceFd !== null) { closeSync(sourceFd); sourceFd = null; }
      }
      destinationFd = linuxOpenLeafAt(destinationParent.target.fd, input.destinationName, 'No-follow link relocation target readback');
      const moved = fstatSync(destinationFd, { bigint: true });
      const movedTarget = linuxReadRetainedLinkTarget(destinationFd, 'No-follow link relocation target readback');
      if (!moved.isSymbolicLink() || String(moved.dev) !== expectedLinkIdentity.device ||
          String(moved.ino) !== expectedLinkIdentity.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link relocation target identity changed.');
      }
      assertPhysicalLinkTarget(movedTarget, input.expectedTargetPath, destinationParent.target.identity.path, 'No-follow link relocation target');
      sourceParent.assertCurrent();
      destinationParent.assertCurrent();
      sourceTarget.assertCurrent();
    } finally {
      if (destinationFd !== null) closeSync(destinationFd);
      if (sourceFd !== null) closeSync(sourceFd);
      sourceParent.dispose();
      destinationParent.dispose();
      sourceTarget?.dispose();
    }
    return;
  }
  if (process.platform === 'win32') {
    const sourceParent = windowsRetainBulkDirectoryChain(sourceParentChain, 'No-follow link source parent');
    const destinationParent = windowsRetainBulkDirectoryChain(destinationParentChain, 'No-follow link destination parent');
    let sourceTarget: WindowsBulkDirectoryChain | null = null;
    let sourceHandle: bigint | null = null;
    let destinationHandle: bigint | null = null;
    try {
      sourceTarget = windowsRetainBulkDirectoryChain(expectedSourceChain, 'No-follow link source target');
      sourceParent.assertCurrent();
      destinationParent.assertCurrent();
      sourceTarget.assertCurrent();
      sourceHandle = windowsOpenRelativeNoFollowEntry(
        sourceParent.target.handle,
        sourceParent.target.identity,
        input.sourceName,
        path.join(sourceParent.target.identity.path, input.sourceName),
        'link',
        'No-follow link relocation source'
      );
      const sourceIdentity = windowsRetainedLeafIdentity(
        sourceHandle,
        path.join(sourceParent.target.identity.path, input.sourceName),
        'link',
        'No-follow link relocation source'
      );
      const sourceLinkTarget = windowsReadRetainedJunctionTarget(
        sourceHandle,
        input.expectedTargetPath,
        sourceParent.target.identity.path,
        'No-follow link relocation source'
      );
      try {
        const existing = windowsOpenRelativeNoFollowEntry(
          destinationParent.target.handle,
          destinationParent.target.identity,
          input.destinationName,
          path.join(destinationParent.target.identity.path, input.destinationName),
          'link',
          'No-follow link relocation destination'
        );
        closeWindowsHandle(existing);
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link relocation destination already exists.');
      } catch (error) {
        if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      }
      windowsRenameRetainedNoFollowLeaf(
        sourceHandle,
        path.join(sourceParent.target.identity.path, input.sourceName),
        'link',
        sourceIdentity,
        destinationParent.target.handle,
        input.destinationName,
        'No-follow link relocation'
      );
      closeWindowsHandle(sourceHandle);
      sourceHandle = null;
      try {
        const sourceReadback = windowsOpenRelativeNoFollowEntry(
          sourceParent.target.handle,
          sourceParent.target.identity,
          input.sourceName,
          path.join(sourceParent.target.identity.path, input.sourceName),
          'link',
          'No-follow link relocation source readback'
        );
        closeWindowsHandle(sourceReadback);
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'No-follow link relocation source remains present.');
      } catch (error) {
        if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      }
      destinationHandle = windowsOpenRelativeNoFollowEntry(
        destinationParent.target.handle,
        destinationParent.target.identity,
        input.destinationName,
        path.join(destinationParent.target.identity.path, input.destinationName),
        'link',
        'No-follow link relocation target readback'
      );
      const destinationIdentity = windowsRetainedLeafIdentity(
        destinationHandle,
        path.join(destinationParent.target.identity.path, input.destinationName),
        'link',
        'No-follow link relocation target readback'
      );
      if (destinationIdentity.device !== sourceIdentity.device ||
          destinationIdentity.inode !== sourceIdentity.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link relocation target identity changed.');
      }
      const targetPath = windowsReadRetainedJunctionTarget(
        destinationHandle,
        input.expectedTargetPath,
        destinationParent.target.identity.path,
        'No-follow link relocation target'
      );
      if (sourceLinkTarget !== targetPath) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow link relocation target changed.');
      sourceParent.assertCurrent();
      destinationParent.assertCurrent();
      sourceTarget.assertCurrent();
    } finally {
      if (destinationHandle !== null) closeWindowsHandle(destinationHandle);
      if (sourceHandle !== null) closeWindowsHandle(sourceHandle);
      sourceParent.dispose();
      destinationParent.dispose();
      sourceTarget?.dispose();
    }
    return;
  }
  throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `No-follow link relocation is unavailable on ${process.platform}.`);
}

/**
 * Deletes exactly one previously inventoried descendant while retaining both
 * its parent directory and the leaf object.  Linux uses handle-relative
 * openat/unlinkat and confirms the selected retained parent/name is absent;
 * unrelated hard links to the same inode remain outside this authority. A
 * platform without an equivalent kernel primitive fails closed.
 */
export function deleteRetainedNoFollowEntry(input: {
  readonly root: PhysicalDirectoryIdentity;
  readonly relativePath: string;
  readonly kind: 'directory' | 'file' | 'link';
  readonly device: string;
  readonly inode: string;
  readonly expectedLinkTarget?: string;
  readonly ancestorDirectories: readonly Readonly<{
    relativePath: string;
    device: string;
    inode: string;
  }>[];
}): void {
  if (!/^(?!.*(?:^|\/)\.\.?$)[^/\\\0]+(?:\/[^/\\\0]+)*$/u.test(input.relativePath)) {
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
    if (input.kind === 'link' && input.expectedLinkTarget !== undefined
        && linuxReadRetainedLinkTarget(leafFd, 'Retained deletion leaf') !== input.expectedLinkTarget) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Retained deletion link target changed.');
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
export function inspectNoFollowOrdinaryFileEntry(
  parent: PhysicalDirectoryIdentity,
  name: string
): NoFollowDirectoryTreeEntry | null {
  ensureLeafName(name);
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

export interface NoFollowOrdinaryFileDigest {
  readonly size: number;
  /** Raw SHA-256 over the retained ordinary-file bytes. */
  readonly byteDigest: `sha256:${string}`;
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
          parentHandle, checked, name, target, 'link', 'No-follow link'
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
  name: string
): Uint8Array | null {
  return inspectNoFollowOrdinaryFileEntry(parent, name)?.bytes ?? null;
}
