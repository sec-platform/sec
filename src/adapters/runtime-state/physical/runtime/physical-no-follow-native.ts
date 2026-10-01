import { dlopen, FFIType, ptr, read } from 'bun:ffi';

import { createHash } from 'node:crypto';

import { closeSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, writeSync } from 'node:fs';

import path from 'node:path';



import { PhysicalNoFollowError, type LinuxNoFollowDirectoryCreateRaceActor, type LinuxNoFollowDirectoryCreateRacePoint, type NoFollowDirectoryCreateTestActor, type NoFollowDirectoryTreeEntry, type NoFollowDirectoryTreeEntryKind, type NoFollowDirectoryTreeInventoryEntry, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity, type RetainedWindowsHostNamespaceDirectory } from './physical-no-follow-contract.ts';

import { absent, assertPhysicalLinkTarget, codeOf, ensureLeafName, ensureOrdinaryDirectorySegment, identityFromStats, NO_FOLLOW_FILE_READ_LIMIT_BYTES, normalizePhysicalLinkTarget, physicalError, physicalWin32Error, requireAbsoluteDirectoryPath, sameIdentity } from './physical-no-follow-shared.ts';



/** Native Linux/Windows backend. This module alone owns Bun FFI handles and platform syscall constants for the no-follow provider. */

interface LinuxNoFollowDirectoryCreateRaceActorRecord {
  readonly point: LinuxNoFollowDirectoryCreateRacePoint;
  readonly targetPath: string;
  readonly displacedPath: string;
  used: boolean;
}

const linuxNoFollowDirectoryCreateRaceActors =
  new WeakMap<object, LinuxNoFollowDirectoryCreateRaceActorRecord>();

const LINUX_O_RDONLY = 0;

export const LINUX_O_WRONLY = 1;

export const LINUX_O_RDWR = 2;

const LINUX_O_DIRECTORY = 0x0001_0000;

export const LINUX_O_NOFOLLOW = 0x0002_0000;

export const LINUX_O_CLOEXEC = 0x0008_0000;

const LINUX_O_PATH = 0x0020_0000;

export const LINUX_O_CREAT = 0x40;

export const LINUX_O_EXCL = 0x80;

const LINUX_O_NONBLOCK = 0x800;

export const LINUX_AT_FDCWD = -100;

// F_DUPFD_CLOEXEC is the Linux command shared by the supported architectures.
// Retained descriptors are kept above every admitted child slot (3 through 64),
// including auxiliary inputs and ignored gaps. Spawn file actions must not close
// a retained source before a later child slot duplicates it.
const LINUX_F_DUPFD_CLOEXEC = 1_030;

const LINUX_F_ADD_SEALS = 1_033;

const LINUX_F_GET_SEALS = 1_034;

const LINUX_F_SEAL_SEAL = 0x0001;

const LINUX_F_SEAL_SHRINK = 0x0002;

const LINUX_F_SEAL_GROW = 0x0004;

const LINUX_F_SEAL_WRITE = 0x0008;

const LINUX_EXECUTABLE_SEALS = LINUX_F_SEAL_SEAL | LINUX_F_SEAL_SHRINK |
  LINUX_F_SEAL_GROW | LINUX_F_SEAL_WRITE;

const LINUX_MFD_CLOEXEC = 0x0001;

const LINUX_MFD_ALLOW_SEALING = 0x0002;

const LINUX_RETAINED_DESCRIPTOR_MIN = 65;

export const LINUX_AT_REMOVEDIR = 0x0200;

export const LINUX_AT_EMPTY_PATH = 0x1000;

export const LINUX_AT_SYMLINK_FOLLOW = 0x400;

export const LINUX_RENAME_NOREPLACE = 1;

export const LINUX_RENAME_EXCHANGE = 2;

const LINUX_IN_CREATE = 0x0000_0100;

const LINUX_IN_MODIFY = 0x0000_0002;

const LINUX_IN_ATTRIB = 0x0000_0004;

const LINUX_IN_CLOSE_WRITE = 0x0000_0008;

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

const LINUX_RETAINED_EXECUTABLE_WATCH_MASK = LINUX_IN_MODIFY | LINUX_IN_ATTRIB |
  LINUX_IN_CLOSE_WRITE | LINUX_IN_CREATE | LINUX_IN_DELETE | LINUX_IN_MOVED_FROM |
  LINUX_IN_MOVED_TO | LINUX_IN_DELETE_SELF | LINUX_IN_MOVE_SELF | LINUX_IN_ONLYDIR;

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

export function requireLinuxLibc(): LinuxLibc {
  linuxLibc ??= loadLinuxLibc();
  return linuxLibc;
}

type LinuxExecutableLibc = ReturnType<typeof loadLinuxExecutableLibc>;

let linuxExecutableLibc: LinuxExecutableLibc | undefined;

function loadLinuxExecutableLibc() {
  if (process.platform !== 'linux') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `No immutable retained executable backend is available on ${process.platform}.`
    );
  }
  try {
    return dlopen('libc.so.6', {
      memfd_create: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 }
    } as const);
  } catch (error) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Linux sealed executable-image backend is unavailable.',
      error
    );
  }
}

function requireLinuxExecutableLibc(): LinuxExecutableLibc {
  linuxExecutableLibc ??= loadLinuxExecutableLibc();
  return linuxExecutableLibc;
}

/**
 * Keeps a retained Linux descriptor disjoint from the child transport's
 * advertised descriptors.  `fcntl(F_DUPFD_CLOEXEC)` is used instead of a
 * caller-visible `dup`/reopen so the descriptor remains the same open file
 * description whose identity is subsequently observed.
 */
export function linuxRaiseDescriptorFloor(fd: number, label: string): number {
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

export function linuxErrno(): number {
  const location = requireLinuxLibc().symbols.__errno_location();
  if (location === null) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Linux errno location is unavailable.');
  }
  return read.i32(location as never);
}

export interface LinuxSealedExecutableImage {
  readonly fd: number;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly mode: bigint;
  readonly size: bigint;
  readonly digest: Readonly<{
    size: number;
    contentDigest: `sha256:${string}`;
    byteDigest: `sha256:${string}`;
  }>;
}

/**
 * Copies one already-retained executable into an anonymous Linux image and
 * seals every content-changing operation before the descriptor can be
 * inherited. The lexical source remains retained and independently fenced;
 * the child executes only this immutable image through its fixed descriptor.
 */
export function linuxCreateSealedExecutableImage(
  sourceFd: number,
  sourceSize: bigint,
  sourceMode: bigint,
  label: string
): LinuxSealedExecutableImage {
  if ((sourceMode & 0o111n) === 0n) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} is not an executable ordinary file.`
    );
  }
  let imageFd: number | null = null;
  try {
    const created = requireLinuxExecutableLibc().symbols.memfd_create(
      Buffer.from('sec-retained-executable\0', 'utf8'),
      LINUX_MFD_CLOEXEC | LINUX_MFD_ALLOW_SEALING
    );
    if (created < 0) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} cannot create an immutable retained executable image (errno ${linuxErrno()}).`
      );
    }
    imageFd = created;
    imageFd = linuxRaiseDescriptorFloor(imageFd, `${label} immutable image`);
    const maximumBytes = Number(sourceSize);
    let offset = 0;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (offset < maximumBytes) {
      const requested = Math.min(buffer.byteLength, maximumBytes - offset);
      const observed = readSync(sourceFd, buffer, 0, requested, offset);
      if (observed < 1) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
          `${label} source changed while materializing its immutable executable image.`
        );
      }
      let written = 0;
      while (written < observed) {
        const count = writeSync(
          imageFd,
          buffer,
          written,
          observed - written,
          offset + written
        );
        if (count < 1) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
            `${label} immutable executable image write did not make progress.`
          );
        }
        written += count;
      }
      offset += observed;
    }
    try {
      fchmodSync(imageFd, Number(sourceMode & 0o777n));
    } catch (error) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} host policy does not admit an executable anonymous image.`,
        error
      );
    }
    if (requireLinuxLibc().symbols.fcntl(
      imageFd,
      LINUX_F_ADD_SEALS,
      LINUX_EXECUTABLE_SEALS
    ) !== 0) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} cannot seal its retained executable image (errno ${linuxErrno()}).`
      );
    }
    const seals = requireLinuxLibc().symbols.fcntl(imageFd, LINUX_F_GET_SEALS, 0);
    if (seals < 0 || (seals & LINUX_EXECUTABLE_SEALS) !== LINUX_EXECUTABLE_SEALS) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} immutable executable seals cannot be proven.`
      );
    }
    const snapshot = fstatSync(imageFd, { bigint: true });
    if (!snapshot.isFile() || snapshot.size !== sourceSize) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        `${label} immutable executable image does not match its retained source size.`
      );
    }
    const physical = Object.freeze({
      device: String(snapshot.dev),
      inode: String(snapshot.ino)
    });
    return Object.freeze({
      fd: imageFd,
      physical,
      mode: snapshot.mode,
      size: snapshot.size,
      digest: Object.freeze(digestRetainedOrdinaryFileFd(imageFd, physical, `${label} immutable image`))
    });
  } catch (error) {
    if (imageFd !== null) closeLinuxDescriptorsBestEffort([imageFd], label);
    throw error;
  }
}

export function linuxAssertSealedExecutableImage(
  image: LinuxSealedExecutableImage,
  label: string
): void {
  const seals = requireLinuxLibc().symbols.fcntl(image.fd, LINUX_F_GET_SEALS, 0);
  if (seals < 0 || (seals & LINUX_EXECUTABLE_SEALS) !== LINUX_EXECUTABLE_SEALS) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
      `${label} immutable executable seals are no longer current.`
    );
  }
  const current = fstatSync(image.fd, { bigint: true });
  if (!current.isFile() || String(current.dev) !== image.physical.device
      || String(current.ino) !== image.physical.inode || current.mode !== image.mode
      || current.size !== image.size) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
      `${label} immutable executable image identity changed.`
    );
  }
}

export interface LinuxCurrentSealedExecutableImage {
  readonly fd: number;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly mode: bigint;
  readonly size: bigint;
  readonly linkCount: bigint;
  readonly sealMask: number;
  readonly digest: Readonly<{
    size: number;
    contentDigest: `sha256:${string}`;
    byteDigest: `sha256:${string}`;
  }>;
}

/**
 * Retains the executable image of the current Linux process when that image is
 * one SEC-compatible sealed memfd.  The inherited descriptor and
 * /proc/self/exe must name the same kernel object; the returned duplicate owns
 * its lifetime independently of the inherited transport descriptor.
 */
export function linuxRetainCurrentSealedExecutableImage(
  sourceFd: number,
  label: string
): LinuxCurrentSealedExecutableImage {
  if (process.platform !== 'linux' || !Number.isSafeInteger(sourceFd)
      || sourceFd < 3 || sourceFd > 64) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} requires one bounded Linux inherited executable descriptor.`
    );
  }
  const duplicate = requireLinuxLibc().symbols.fcntl(
    sourceFd,
    LINUX_F_DUPFD_CLOEXEC,
    LINUX_RETAINED_DESCRIPTOR_MIN
  );
  if (duplicate < LINUX_RETAINED_DESCRIPTOR_MIN) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} cannot duplicate the inherited executable descriptor (errno ${linuxErrno()}).`
    );
  }
  let currentExecutableFd: number | null = null;
  try {
    currentExecutableFd = openSync('/proc/self/exe', 'r');
    const retained = fstatSync(duplicate, { bigint: true });
    const current = fstatSync(currentExecutableFd, { bigint: true });
    if (!retained.isFile() || !current.isFile()
        || retained.dev !== current.dev || retained.ino !== current.ino
        || retained.mode !== current.mode || retained.size !== current.size) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        `${label} inherited descriptor does not name the current executable image.`
      );
    }
    const seals = requireLinuxLibc().symbols.fcntl(duplicate, LINUX_F_GET_SEALS, 0);
    if (seals < 0 || (seals & LINUX_EXECUTABLE_SEALS) !== LINUX_EXECUTABLE_SEALS) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} current executable image is not fully sealed.`
      );
    }
    const physical = Object.freeze({
      device: String(retained.dev),
      inode: String(retained.ino)
    });
    const imageDigest = digestRetainedOrdinaryFileFd(
      duplicate,
      physical,
      `${label} content`,
      () => {
        const sealReadback = requireLinuxLibc().symbols.fcntl(
          duplicate,
          LINUX_F_GET_SEALS,
          0
        );
        if (sealReadback < 0
            || (sealReadback & LINUX_EXECUTABLE_SEALS) !== LINUX_EXECUTABLE_SEALS) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
            `${label} executable seals changed during observation.`
          );
        }
      }
    );
    const after = fstatSync(duplicate, { bigint: true });
    const currentAfter = fstatSync(currentExecutableFd, { bigint: true });
    if (after.dev !== retained.dev || after.ino !== retained.ino
        || after.mode !== retained.mode || after.size !== retained.size
        || currentAfter.dev !== retained.dev || currentAfter.ino !== retained.ino
        || currentAfter.mode !== retained.mode || currentAfter.size !== retained.size) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        `${label} current executable image changed during observation.`
      );
    }
    return Object.freeze({
      fd: duplicate,
      physical,
      mode: retained.mode,
      size: retained.size,
      linkCount: retained.nlink,
      sealMask: seals,
      digest: imageDigest
    });
  } catch (error) {
    try { closeSync(duplicate); } catch { /* preserve the primary retained-image error */ }
    throw error;
  } finally {
    if (currentExecutableFd !== null) {
      try { closeSync(currentExecutableFd); } catch { /* read-only witness cleanup */ }
    }
  }
}

export function linuxOpenAt(parentFd: number, component: string, label: string): number {
  if (component.length === 0 || component === '.' || component === '..' || component.includes('/') || component.includes('\0')) {
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

export function linuxOpenLeafAt(parentFd: number, component: string, label: string): number {
  if (component.length === 0 || component === '.' || component === '..' || component.includes('/') || component.includes('\0')) {
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

export function linuxReadRetainedLinkTarget(linkFd: number, label: string): string {
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

export function linuxOpenRetainedAbsoluteDirectory(absolutePath: string, label: string): { readonly filesystemRootFd: number; readonly directoryFd: number } {
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

export function linuxOpenReadableLeafAt(parentFd: number, component: string, label: string): number {
  if (component.length === 0 || component === '.' || component === '..' || component.includes('/') || component.includes('\0')) {
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

export function linuxOpenRoot(label: string): number {
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

export function linuxIdentity(fd: number, absolutePath: string): PhysicalDirectoryIdentity {
  const stats = fstatSync(fd, { bigint: true });
  if (!stats.isDirectory()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${absolutePath} is not an ordinary directory.`);
  // Directory identity must survive an owner-authorized chmod (sealing and
  // retirement). Permission/ctime drift is checked by the generation proof,
  // not encoded as a different physical object. Version the identifier so an
  // older persisted observation cannot silently acquire the new semantics.
  const objectId = `linux-directory-v2:${String(stats.dev)}:${String(stats.ino)}`;
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

export function linuxReadDirectoryMutationEvents(
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

export interface LinuxRetainedExecutableWitness {
  readonly fd: number;
  readonly watchDescriptor: number;
  readonly name: string;
  invalidated: boolean;
}

export function linuxOpenRetainedExecutableWitness(
  parentFd: number,
  name: string,
  label: string
): LinuxRetainedExecutableWitness {
  const fd = linuxOpenDirectoryMutationWitness(label);
  const watchDescriptor = requireLinuxLibc().symbols.inotify_add_watch(
    fd,
    Buffer.from(`/proc/self/fd/${parentFd}\0`, 'utf8'),
    LINUX_RETAINED_EXECUTABLE_WATCH_MASK
  );
  if (watchDescriptor < 0) {
    const errno = linuxErrno();
    closeLinuxDescriptorsBestEffort([fd], label);
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} cannot bind its retained executable mutation witness (errno ${errno}).`
    );
  }
  return { fd, watchDescriptor, name, invalidated: false };
}

export function linuxAssertRetainedExecutableWitness(
  witness: LinuxRetainedExecutableWitness,
  label: string
): void {
  if (!witness.invalidated) {
    const events = linuxReadDirectoryMutationEvents(Object.freeze({
      fd: witness.fd,
      watchDescriptor: witness.watchDescriptor,
      ancestorEdges: new Map<number, string>()
    }), label);
    witness.invalidated = events.some((event) => (
      event.mask & (LINUX_IN_Q_OVERFLOW | LINUX_IN_IGNORED |
        LINUX_IN_DELETE_SELF | LINUX_IN_MOVE_SELF)
    ) !== 0 || (
      event.watchDescriptor === witness.watchDescriptor
      && event.name === witness.name
    ));
  }
  if (witness.invalidated) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
      `${label} lexical executable edge changed during the retained lifecycle.`
    );
  }
}

export function linuxAssertDirectoryCreateWitness(
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

export function linuxOpenWatchedCanonicalDirectoryChain(
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
  // The actor is already issuer-validated above. An ancestor race must name
  // an edge in this exact chain, then run once at that edge, not at every
  // preceding directory encountered while opening the chain.
  if (testOnlyRaceActor?.point === 'after-ancestor-open'
      && !expected.ancestors.some((ancestor) => ancestor.path === testOnlyRaceActor.targetPath)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} Linux test race actor target is outside the retained ancestor chain.`
    );
  }
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
        if (testOnlyRaceActor?.point === 'after-ancestor-open'
            && testOnlyRaceActor.targetPath === nextPath) {
          linuxInvokeNoFollowDirectoryCreateRaceActor(
            testOnlyRaceActor,
            'after-ancestor-open',
            nextPath,
            `${label} ancestor`
          );
        }
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

export function linuxCloseDirectoryCreateTransaction(transaction: LinuxDirectoryCreateTransaction): void {
  if (transaction.currentFd !== transaction.filesystemRootFd) closeSync(transaction.currentFd);
  closeSync(transaction.filesystemRootFd);
  closeSync(transaction.witnessFd);
}

export function linuxDirectoryCreateTransactionWitness(
  transaction: LinuxDirectoryCreateTransaction
): LinuxDirectoryCreateWitness {
  return Object.freeze({
    fd: transaction.witnessFd,
    watchDescriptor: transaction.currentWatchDescriptor,
    ancestorEdges: transaction.ancestorEdges
  });
}

export function linuxAdvanceDirectoryCreateTransaction(
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

export function linuxOpenOrCreateDirectoryAt(input: {
  readonly parentFd: number;
  readonly parent: PhysicalDirectoryIdentity;
  readonly witness: LinuxDirectoryCreateWitness;
  readonly name: string;
  readonly absolutePath: string;
  readonly allowExisting: boolean;
  readonly creationMode: number;
  readonly label: string;
  readonly testOnlyRaceActor?: LinuxNoFollowDirectoryCreateRaceActor;
  readonly testOnlyCreateActor?: NoFollowDirectoryCreateTestActor;
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
    try {
      childFd = linuxOpenAt(input.parentFd, input.name, input.label);
      if (!input.allowExisting) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${input.label} name already exists at ${input.absolutePath}.`);
      }
    } catch (error) {
      if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      input.testOnlyCreateActor?.beforeCreate?.({ parentPath: input.parent.path, targetPath: input.absolutePath });
      linuxAssertDirectoryCreateWitness(
        input.witness,
        linuxReadDirectoryMutationEvents(input.witness, input.label),
        input.name,
        false,
        input.label
      );
      if (!sameIdentity(input.parent, linuxIdentity(input.parentFd, input.parent.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${input.label} parent changed after before-create actor.`);
      }
      if (requireLinuxLibc().symbols.mkdirat(input.parentFd, Buffer.from(`${input.name}\0`, 'utf8'), input.creationMode) !== 0) {
        const errno = linuxErrno();
        throw physicalError(
          errno === 17 ? 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' : 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
          errno === 17
            ? `${input.label} name appeared during relative creation at ${input.absolutePath}.`
            : `${input.label} relative mkdirat failed for ${input.absolutePath} (errno ${errno}).`
        );
      }
      created = true;
      childFd = linuxOpenAt(input.parentFd, input.name, input.label);
    }
    const identity = linuxIdentity(childFd, input.absolutePath);
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
    if (created) {
      input.testOnlyCreateActor?.beforeParentBarrier?.({ parentPath: input.parent.path, createdPath: input.absolutePath });
      linuxAssertDirectoryCreateWitness(
        input.witness,
        linuxReadDirectoryMutationEvents(input.witness, input.label),
        input.name,
        false,
        input.label
      );
      if (!sameIdentity(input.parent, linuxIdentity(input.parentFd, input.parent.path))
          || !sameIdentity(identity, linuxIdentity(childFd, input.absolutePath))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${input.label} identity changed after before-parent-barrier actor.`);
      }
      if (requireLinuxLibc().symbols.fsync(input.parentFd) !== 0) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${input.label} parent fsync failed.`);
      }
      if (!sameIdentity(input.parent, linuxIdentity(input.parentFd, input.parent.path))
          || !sameIdentity(identity, linuxIdentity(readbackFd, input.absolutePath))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${input.label} identity changed after parent barrier.`);
      }
      input.testOnlyCreateActor?.durabilityObserver?.({ parentPath: input.parent.path, createdPath: input.absolutePath });
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

const WINDOWS_EXTENDED_FILE_ID_TYPE = 2;

export const WINDOWS_GENERIC_READ = 0x8000_0000;

export const WINDOWS_GENERIC_WRITE = 0x4000_0000;

export const WINDOWS_SYNCHRONIZE = 0x0010_0000;

const WINDOWS_FILE_READ_DATA = 0x0000_0001;

const WINDOWS_FILE_WRITE_DATA = 0x0000_0002;

export const WINDOWS_FILE_READ_ATTRIBUTES = 0x0000_0080;

const WINDOWS_FILE_READ_EA = 0x0000_0008;

export const WINDOWS_READ_CONTROL = 0x0002_0000;

export const WINDOWS_WRITE_DAC = 0x0004_0000;

export const WINDOWS_DELETE = 0x0001_0000;

export const WINDOWS_FILE_WRITE_ATTRIBUTES = 0x0000_0100;

export const WINDOWS_SHARE_READ_WRITE_DELETE = 0x0000_0007;

const WINDOWS_SHARE_READ_WRITE = 0x0000_0003;

export const WINDOWS_SHARE_READ = 0x0000_0001;

// FILE_INFO_BY_HANDLE_CLASS::FileDispositionInfoEx.  The native
// FILE_INFORMATION_CLASS value is 64; SetFileInformationByHandle requires
// the Win32 enum value 21.
const WINDOWS_FILE_DISPOSITION_INFO_EX = 21;

const WINDOWS_FILE_DISPOSITION_FLAG_DELETE = 0x0000_0001;

const WINDOWS_FILE_DISPOSITION_FLAG_POSIX_SEMANTICS = 0x0000_0002;

const WINDOWS_FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE = 0x0000_0010;

export const WINDOWS_NT_FILE_RENAME_INFORMATION = 10;

const WINDOWS_NT_FILE_END_OF_FILE_INFORMATION = 20;

export const WINDOWS_NT_FILE_RENAME_INFORMATION_EX = 65;

const WINDOWS_FILE_ATTRIBUTE_NORMAL = 0x0000_0080;

const WINDOWS_FSCTL_GET_REPARSE_POINT = 0x0009_00a8;

const WINDOWS_FSCTL_SET_REPARSE_POINT = 0x0009_00a4;

const WINDOWS_MAXIMUM_REPARSE_DATA_BUFFER_SIZE = 16 * 1024;

const WINDOWS_IO_REPARSE_TAG_MOUNT_POINT = 0xa000_0003;

export const WINDOWS_FILE_CREATE = 2;

export const WINDOWS_FILE_OPEN = 1;

const WINDOWS_FILE_NON_DIRECTORY_FILE = 0x0000_0040;

const WINDOWS_FILE_DIRECTORY_FILE = 0x0000_0001;

const WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT = 0x0000_0020;

const WINDOWS_FILE_OPEN_REPARSE_POINT_NT = 0x0020_0000;

const WINDOWS_STATUS_OBJECT_NAME_NOT_FOUND = -1_073_741_772;

const WINDOWS_STATUS_OBJECT_PATH_NOT_FOUND = -1_073_741_766;

const WINDOWS_STATUS_OBJECT_NAME_COLLISION = -1_073_741_771;

const WINDOWS_STATUS_SHARING_VIOLATION = -1_073_741_757;

const WINDOWS_STATUS_ACCESS_DENIED = -1_073_741_790;

const WINDOWS_STATUS_FILE_IS_A_DIRECTORY = -1_073_741_638;

// A just-disposed Windows handle can leave the namespace entry in the
// delete-pending state until the final handle reference is released.  For an
// exact retained-leaf readback this is the kernel's absent-equivalent; it is
// not used to admit a create or to authorize a path-only deletion.
const WINDOWS_STATUS_DELETE_PENDING = -1_073_741_738;

type WindowsKernel32 = ReturnType<typeof loadWindowsKernel32>;

let windowsKernel32: WindowsKernel32 | undefined;

type WindowsNtdll = ReturnType<typeof loadWindowsNtdll>;

let windowsNtdll: WindowsNtdll | undefined;

type WindowsAdvapi32 = ReturnType<typeof loadWindowsAdvapi32>;

let windowsAdvapi32: WindowsAdvapi32 | undefined;

export const WINDOWS_OWNER_SECURITY_INFORMATION = 0x0000_0001;

export const WINDOWS_DACL_SECURITY_INFORMATION = 0x0000_0004;

export const WINDOWS_PROTECTED_DACL_SECURITY_INFORMATION = 0x8000_0000;

export const WINDOWS_UNPROTECTED_DACL_SECURITY_INFORMATION = 0x2000_0000;

export const WINDOWS_SE_DACL_PROTECTED = 0x1000;

export const WINDOWS_FILE_DELETE_CHILD = 0x0000_0040;

export const WINDOWS_ACCESS_ALLOWED_ACE_TYPE = 0;

export const WINDOWS_ACCESS_DENIED_ACE_TYPE = 1;

export const WINDOWS_EVERYONE_SID = Buffer.from([1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);

function loadWindowsKernel32() {
  try {
    return dlopen('kernel32.dll', {
      CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u64 },
      OpenFileById: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.u64 },
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

export function requireWindowsKernel32(): WindowsKernel32 {
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

export function requireWindowsNtdll(): WindowsNtdll {
  windowsNtdll ??= loadWindowsNtdll();
  return windowsNtdll;
}

function loadWindowsAdvapi32() {
  try {
    return dlopen('advapi32.dll', {
      GetFileSecurityW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
      GetKernelObjectSecurity: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
      SetKernelObjectSecurity: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
      SetFileSecurityW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 }
    } as const);
  } catch (error) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows security descriptor backend is unavailable.', error);
  }
}

export function requireWindowsAdvapi32(): WindowsAdvapi32 {
  windowsAdvapi32 ??= loadWindowsAdvapi32();
  return windowsAdvapi32;
}

export function windowsWide(value: string): Buffer {
  return Buffer.from(`${path.toNamespacedPath(path.resolve(value))}\0`, 'utf16le');
}

function windowsLiteralWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

function windowsPathKey(value: string): string {
  return value.replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US');
}

export function windowsAssertParentWithinRetainedRoot(
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

function windowsDirectoryIdentity(
  handle: bigint,
  absolutePath: string,
  label: string,
  requireExactLexicalPath: boolean
): PhysicalDirectoryIdentity {
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
  if (requireExactLexicalPath
      && windowsPathKey(finalPath) !== windowsPathKey(path.toNamespacedPath(absolutePath))) {
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

export function windowsIdentity(handle: bigint, absolutePath: string, label: string): PhysicalDirectoryIdentity {
  return windowsDirectoryIdentity(handle, absolutePath, label, true);
}

export function windowsOpenDirectory(absolutePath: string, label: string, forFlush = false): bigint {
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
    // A few Windows filesystem providers leave the thread error slot at zero
    // after an already-removed directory is opened through the no-follow
    // handle API.  Confirm that narrow case with lstat (which does not follow
    // a reparse point); an existing entry still falls through to the unsafe
    // classification below.
    if (lastError === 0) {
      try {
        lstatSync(absolutePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} is absent.`);
        }
      }
    }
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} cannot be opened without following reparse points (Win32 ${lastError}).`);
  }
  return handle;
}

interface RetainedWindowsHostNamespaceDirectoryRecord {
  readonly handle: bigint;
  readonly identity: PhysicalDirectoryIdentity;
  state: 'open' | 'closed';
}

const retainedWindowsHostNamespaceDirectories =
  new WeakMap<object, RetainedWindowsHostNamespaceDirectoryRecord>();

/**
 * Reopens one Windows directory through its 128-bit FileId and retains that
 * kernel object.  The handle-derived final path must equal the caller's
 * expected host path.  This detects AppData/MSIX merged views where a lexical
 * open has the requested spelling but its FileId actually belongs to a
 * package-local backing directory.
 */
export function retainWindowsHostNamespaceDirectoryById(
  expected: PhysicalDirectoryIdentity,
  label = 'Windows host namespace directory'
): RetainedWindowsHostNamespaceDirectory {
  if (process.platform !== 'win32') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} requires the Windows OpenFileById backend.`
    );
  }
  if (!/^[a-f0-9]{16}$/u.test(expected.device)
      || !/^[a-f0-9]{32}$/u.test(expected.inode)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} has no Windows 128-bit FileId identity.`
    );
  }
  const normalizedPath = requireAbsoluteDirectoryPath(expected.path, label);
  const root = path.win32.parse(normalizedPath).root;
  if (!/^[A-Za-z]:\\$/u.test(root)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} volume cannot be opened by a local Windows drive identity.`
    );
  }
  const library = requireWindowsKernel32();
  const volumePath = `\\\\.\\${root.slice(0, 2)}`;
  const volumeHandle = library.symbols.CreateFileW(
    windowsLiteralWide(volumePath),
    0,
    WINDOWS_SHARE_READ_WRITE_DELETE,
    null,
    WINDOWS_OPEN_EXISTING,
    0,
    null
  );
  if (volumeHandle === WINDOWS_INVALID_HANDLE) {
    throw physicalWin32Error(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} volume identity cannot be retained.`,
      library.symbols.GetLastError()
    );
  }
  let handle: bigint | null = null;
  let volumeOpen = true;
  let capability: RetainedWindowsHostNamespaceDirectory | null = null;
  let primaryError: unknown;
  try {
    const descriptor = Buffer.alloc(24);
    descriptor.writeUInt32LE(descriptor.byteLength, 0);
    descriptor.writeUInt32LE(WINDOWS_EXTENDED_FILE_ID_TYPE, 4);
    Buffer.from(expected.inode, 'hex').copy(descriptor, 8);
    handle = library.symbols.OpenFileById(
      volumeHandle,
      descriptor,
      0,
      WINDOWS_SHARE_READ_WRITE_DELETE,
      null,
      WINDOWS_FILE_FLAG_BACKUP_SEMANTICS | WINDOWS_FILE_FLAG_OPEN_REPARSE_POINT
    );
    if (handle === null || handle === WINDOWS_INVALID_HANDLE) {
      handle = null;
      throw physicalWin32Error(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} FileId cannot be reopened in the host namespace.`,
        library.symbols.GetLastError()
      );
    }
    const observed = windowsDirectoryIdentity(handle, normalizedPath, label, false);
    if (windowsPathKey(observed.finalPath) !== windowsPathKey(path.toNamespacedPath(normalizedPath))
        || !sameIdentity(expected, observed)) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} FileId does not resolve to the expected host namespace identity.`,
        { expected, observed }
      );
    }
    const volumeCloseError = closeWindowsHandlesBestEffort(
      [volumeHandle],
      `${label} volume`
    );
    volumeOpen = false;
    if (volumeCloseError !== null) throw volumeCloseError;
    const record: RetainedWindowsHostNamespaceDirectoryRecord = {
      handle,
      identity: observed,
      state: 'open'
    };
    capability = Object.freeze({
      path: observed.path,
      identity: observed,
      assertCurrent(): void {
        if (record.state !== 'open') {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
            `${label} host namespace capability is closed.`
          );
        }
        const current = windowsIdentity(record.handle, record.identity.path, label);
        if (!sameIdentity(record.identity, current)) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
            `${label} host namespace identity changed.`
          );
        }
        let lexicalHandle: bigint | null = null;
        let lexicalFailure: Readonly<{ error: unknown }> | undefined;
        let lexicalCloseFailure: Readonly<{ error: unknown }> | undefined;
        try {
          lexicalHandle = windowsOpenDirectory(
            record.identity.path,
            `${label} current lexical binding`
          );
          const lexical = windowsIdentity(
            lexicalHandle,
            record.identity.path,
            `${label} current lexical binding`
          );
          if (!sameIdentity(record.identity, lexical)) {
            throw physicalError(
              'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
              `${label} current lexical binding no longer resolves to the retained host object.`
            );
          }
        } catch (error) {
          lexicalFailure = Object.freeze({ error });
        } finally {
          const closeError = closeWindowsHandlesBestEffort(
            lexicalHandle === null ? [] : [lexicalHandle],
            `${label} current lexical binding`
          );
          if (closeError !== null) lexicalCloseFailure = Object.freeze({ error: closeError });
        }
        if (lexicalFailure !== undefined && lexicalCloseFailure !== undefined) {
          throw new AggregateError(
            [lexicalFailure.error, lexicalCloseFailure.error],
            `${label} lexical binding and descriptor close both failed.`
          );
        }
        if (lexicalFailure !== undefined) throw lexicalFailure.error;
        if (lexicalCloseFailure !== undefined) throw lexicalCloseFailure.error;
      },
      dispose(): void {
        if (record.state === 'closed') return;
        closeWindowsHandle(record.handle);
        record.state = 'closed';
      }
    });
    retainedWindowsHostNamespaceDirectories.set(capability, record);
    handle = null;
  } catch (error) {
    primaryError = error;
  } finally {
    const closeError = closeWindowsHandlesBestEffort([
      ...(handle === null ? [] : [handle]),
      ...(volumeOpen ? [volumeHandle] : [])
    ], `${label} admission`);
    if (primaryError === undefined && closeError !== null) primaryError = closeError;
  }
  if (primaryError !== undefined) throw primaryError;
  return capability!;
}

export function assertRetainedWindowsHostNamespaceDirectory(
  capability: unknown,
  label = 'Windows host namespace directory'
): asserts capability is RetainedWindowsHostNamespaceDirectory {
  if (capability === null || typeof capability !== 'object') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} was not issued by Runtime Physical.`);
  }
  const record = retainedWindowsHostNamespaceDirectories.get(capability);
  if (record === undefined || record.state !== 'open') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} was not issued as a live host namespace capability.`);
  }
  (capability as RetainedWindowsHostNamespaceDirectory).assertCurrent();
}

export function windowsOpenPinnedReadDirectory(absolutePath: string, label: string): bigint {
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

export function windowsOpenSealedReadDirectory(absolutePath: string, label: string): bigint {
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
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} cannot acquire directory membership exclusion (Win32 ${lastError}).`
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
export function windowsOpenNoFollowLeaf(absolutePath: string, label: string, desiredAccess: number): bigint {
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
    throw physicalWin32Error(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} cannot be retained without following reparse points (Win32 ${lastError}).`,
      lastError
    );
  }
  return handle;
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

export function windowsOpenRelativeLeaf(
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
  if (windowsPathKey(path.resolve(absolutePath)) !== windowsPathKey(path.resolve(parent.path, name))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} absolute path differs from its retained parent and leaf.`);
  }
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
    if (status === WINDOWS_STATUS_FILE_IS_A_DIRECTORY) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} is a directory rather than an ordinary file.`);
    }
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

export function windowsOpenRelativeDirectory(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  absolutePath: string,
  disposition: typeof WINDOWS_FILE_CREATE | typeof WINDOWS_FILE_OPEN,
  label: string,
  shareAccess = WINDOWS_SHARE_READ_WRITE_DELETE,
  readOnly = false
): bigint | null {
  const object = windowsRelativeLeafObjectAttributes(parentHandle, name);
  const handleBuffer = Buffer.alloc(8);
  const ioStatus = Buffer.alloc(16);
  const status = requireWindowsNtdll().symbols.NtCreateFile(
    handleBuffer,
    WINDOWS_FILE_READ_DATA | WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_FILE_READ_EA |
      (readOnly ? 0 : WINDOWS_FILE_WRITE_ATTRIBUTES) | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE,
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
    if (readOnly && status === WINDOWS_STATUS_SHARING_VIOLATION) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} cannot acquire writer exclusion while a writable or delete-capable handle is live.`
      );
    }
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

export function windowsOpenRelativeNoFollowEntry(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  absolutePath: string,
  kind: 'directory' | 'file' | 'link',
  label: string,
  shareAccess?: number,
  readOnly?: boolean,
  accessDeniedAsNull?: false,
  readData?: boolean
): bigint;

export function windowsOpenRelativeNoFollowEntry(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  absolutePath: string,
  kind: 'directory' | 'file' | 'link',
  label: string,
  shareAccess: number,
  readOnly: boolean,
  accessDeniedAsNull: true,
  readData?: boolean
): bigint | null;

export function windowsOpenRelativeNoFollowEntry(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  absolutePath: string,
  kind: 'directory' | 'file' | 'link',
  label: string,
  shareAccess = WINDOWS_SHARE_READ_WRITE_DELETE,
  readOnly = false,
  accessDeniedAsNull = false,
  readData = false
): bigint | null {
  const object = windowsRelativeLeafObjectAttributes(parentHandle, name);
  const handleBuffer = Buffer.alloc(8);
  const ioStatus = Buffer.alloc(16);
  const kindOption = kind === 'directory' ? WINDOWS_FILE_DIRECTORY_FILE
    : kind === 'file' ? WINDOWS_FILE_NON_DIRECTORY_FILE : 0;
  const status = requireWindowsNtdll().symbols.NtCreateFile(
    handleBuffer,
    (readData ? WINDOWS_FILE_READ_DATA : 0) |
      WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_FILE_READ_EA | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE |
      (readOnly ? 0 : WINDOWS_DELETE),
    object.objectAttributes,
    ioStatus,
    null,
    WINDOWS_FILE_ATTRIBUTE_NORMAL,
    shareAccess,
    WINDOWS_FILE_OPEN,
    kindOption | WINDOWS_FILE_SYNCHRONOUS_IO_NONALERT | WINDOWS_FILE_OPEN_REPARSE_POINT_NT,
    null,
    0
  );
  if (status < 0) {
    if (accessDeniedAsNull && status === WINDOWS_STATUS_ACCESS_DENIED) return null;
    if (readOnly && status === WINDOWS_STATUS_SHARING_VIOLATION) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        `${label} cannot acquire writer exclusion while a writable or delete-capable handle is live.`
      );
    }
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

export function windowsRetainedOrdinaryFileLinkCount(handle: bigint, label: string): number {
  const standard = Buffer.alloc(24);
  if (requireWindowsKernel32().symbols.GetFileInformationByHandleEx(
    handle, WINDOWS_FILE_STANDARD_INFO, standard, standard.byteLength
  ) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} link count cannot be proven.`);
  }
  const links = standard.readUInt32LE(16);
  if (!Number.isSafeInteger(links) || links < 1) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} link count is invalid.`);
  }
  return links;
}

export function windowsTruncateRetainedOrdinaryFile(handle: bigint, size: number, label: string): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is invalid.`);
  }
  const end = Buffer.alloc(8);
  end.writeBigInt64LE(BigInt(size));
  const ioStatus = Buffer.alloc(16);
  const status = requireWindowsNtdll().symbols.NtSetInformationFile(
    handle,
    ioStatus,
    end,
    end.byteLength,
    WINDOWS_NT_FILE_END_OF_FILE_INFORMATION
  );
  if (status < 0) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
      `${label} retained truncate failed (NTSTATUS ${status}).`
    );
  }
}

export function windowsWriteRetainedFile(handle: bigint, bytes: Uint8Array, label: string): void {
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

export function windowsWriteRetainedChunk(handle: bigint, bytes: Uint8Array, label: string): void {
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

export function windowsRewindRetainedFile(handle: bigint, label: string): void {
  if (requireWindowsKernel32().symbols.SetFilePointerEx(handle, 0n, null, 0) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} retained handle rewind failed (Win32 ${requireWindowsKernel32().symbols.GetLastError()}).`);
  }
}

export function windowsReadRelativeOrdinaryLeaf(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  label: string,
  maximumBytes?: number
): Uint8Array | null {
  const absolutePath = path.join(parent.path, name);
  const handle = windowsOpenRelativeLeaf(parentHandle, parent, name, absolutePath, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, label, true);
  if (handle === null) return null;
  try {
    windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
    const bytes = readWindowsRetainedFile(handle, label, maximumBytes);
    const observedParent = windowsIdentity(parentHandle, parent.path, `${label} parent readback`);
    if (!sameIdentity(parent, observedParent)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent changed during retained readback.`);
    return bytes;
  } finally {
    closeWindowsHandle(handle);
  }
}

export function windowsRetainedLeafIdentity(
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

export function windowsRetainedReparseObservation(
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
export function windowsReadRetainedJunctionTarget(
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
export function windowsCreateRelativeJunction(
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

export type ReserveNoFollowFileBytes = (size: number) => void;

export function windowsScanRetainedEntry(
  absolutePath: string,
  label: string,
  reserveFileBytes?: ReserveNoFollowFileBytes,
  assertReadCurrent?: () => void
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
      bytes = readWindowsRetainedFile(handle, label, undefined, assertReadCurrent);
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

export function windowsInventoryRetainedEntry(
  absolutePath: string,
  label: string,
  reserveFileBytes?: ReserveNoFollowFileBytes,
  assertReadCurrent?: () => void
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
      ? digestWindowsRetainedFile(handle, absolutePath, identity, label, assertReadCurrent)
      : kind === 'link'
        ? Object.freeze({ ...windowsRetainedReparseObservation(handle, label), contentDigest: null })
        : Object.freeze({ size: 0, contentDigest: null, linkTarget: null });
    return Object.freeze({ kind, ...identity, ...content, linkTarget: 'linkTarget' in content ? content.linkTarget : null });
  } finally {
    closeWindowsHandle(handle);
  }
}

export function windowsMetadataRetainedEntry(
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

export function windowsMarkRetainedLeafForDelete(handle: bigint, label: string): void {
  const library = requireWindowsKernel32();
  const extended = Buffer.alloc(4);
  extended.writeUInt32LE(
    WINDOWS_FILE_DISPOSITION_FLAG_DELETE | WINDOWS_FILE_DISPOSITION_FLAG_POSIX_SEMANTICS |
      WINDOWS_FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
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

export function windowsRenameRetainedDirectory(
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
export function windowsRenameRetainedOrdinaryFile(
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
    if (!replaceExisting && legacyStatus === WINDOWS_STATUS_OBJECT_NAME_COLLISION) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT',
        `${label} destination already exists.`
      );
    }
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} native retained-file rename failed (NTSTATUS ${exStatus}; ${legacyStatus}).`);
  }
}

export function windowsFlushRetainedDirectory(handle: bigint, expected: PhysicalDirectoryIdentity, label: string): void {
  const observed = windowsIdentity(handle, expected.path, label);
  if (!sameIdentity(expected, observed)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} identity changed before durability barrier.`);
  }
  // Windows does not support a portable directory FlushFileBuffers contract:
  // NTFS/ReFS commonly reject it for a correctly retained directory handle.
  // File publication instead flushes the retained source file before and
  // after native root-relative rename, then proves final FileId/readback.
}

export function streamCanonicalHexContentDigest(
  readChunk: (chunk: Buffer) => number,
  expectedSize: bigint,
  label: string,
  assertReadCurrent?: () => void
): Readonly<{
  size: number;
  contentDigest: `sha256:${string}`;
  byteDigest: `sha256:${string}`;
}> {
  if (expectedSize < 0n || expectedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} size is outside the exact inventory number domain.`);
  }
  assertReadCurrent?.();
  const hash = createHash('sha256');
  const byteHash = createHash('sha256');
  // This is exactly JSON.stringify(canonicalJson({ bytes: lowerHex })).
  // Keep the framing here so streaming and historical in-memory inventory
  // generations remain byte-identical.
  hash.update('{"bytes":"');
  const chunk = Buffer.alloc(64 * 1024);
  let total = 0;
  for (;;) {
    assertReadCurrent?.();
    const count = readChunk(chunk);
    assertReadCurrent?.();
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

export function windowsRetainedFileSnapshot(
  handle: bigint,
  label: string
): Readonly<{ basic: string; size: bigint; linkCount: number }> {
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
  return Object.freeze({
    basic: stableBasic,
    size: standard.readBigInt64LE(8),
    linkCount: standard.readUInt32LE(16)
  });
}

export function digestWindowsRetainedFile(
  handle: bigint,
  absolutePath: string,
  identity: Readonly<{ device: string; inode: string }>,
  label: string,
  assertReadCurrent?: () => void
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
  }, before.size, label, assertReadCurrent);
  const after = windowsRetainedFileSnapshot(handle, label);
  const afterIdentity = windowsRetainedLeafIdentity(handle, absolutePath, 'file', label);
  if (after.basic !== before.basic || after.size !== before.size ||
      after.linkCount !== before.linkCount ||
      afterIdentity.device !== identity.device || afterIdentity.inode !== identity.inode) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} changed during retained streaming inventory.`);
  }
  return result;
}

export function boundedNoFollowFileReadMaximum(maximumBytes: number | undefined): number {
  const maximum = maximumBytes ?? NO_FOLLOW_FILE_READ_LIMIT_BYTES;
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow file read maximum must be one finite non-negative safe integer.');
  }
  return maximum;
}

export function readWindowsRetainedFile(
  handle: bigint,
  label: string,
  maximumBytes?: number,
  assertReadCurrent?: () => void
): Uint8Array {
  assertReadCurrent?.();
  const maximum = boundedNoFollowFileReadMaximum(maximumBytes);
  const initial = windowsRetainedFileSnapshot(handle, label);
  if (initial.size < 0n || initial.size > BigInt(maximum)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED', `${label} exceeds the bounded no-follow read size.`);
  }
  const library = requireWindowsKernel32();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    assertReadCurrent?.();
    const chunk = Buffer.alloc(64 * 1024);
    const received = Buffer.alloc(4);
    if (library.symbols.ReadFile(handle, chunk, chunk.byteLength, received, null) === 0) {
      const lastError = library.symbols.GetLastError();
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} retained handle read failed (Win32 ${lastError}).`);
    }
    assertReadCurrent?.();
    const count = received.readUInt32LE(0);
    if (count === 0) break;
    total += count;
    if (total > maximum) {
      throw physicalError('PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED', `${label} exceeds the bounded no-follow read size.`);
    }
    chunks.push(chunk.subarray(0, count));
    if (count < chunk.byteLength) break;
  }
  return Buffer.concat(chunks, total);
}

export function readLinuxRetainedFile(fd: number, label: string, maximumBytes?: number, assertReadCurrent?: () => void): Uint8Array {
  assertReadCurrent?.();
  const maximum = boundedNoFollowFileReadMaximum(maximumBytes);
  const initial = fstatSync(fd, { bigint: true });
  if (!initial.isFile()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} is not an ordinary file.`);
  if (initial.size < 0n || initial.size > BigInt(maximum)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED', `${label} exceeds the bounded no-follow read size.`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    assertReadCurrent?.();
    const chunk = Buffer.alloc(64 * 1024);
    const count = readSync(fd, chunk, 0, chunk.byteLength, null);
    assertReadCurrent?.();
    if (count === 0) break;
    total += count;
    if (total > maximum) {
      throw physicalError('PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED', `${label} exceeds the bounded no-follow read size.`);
    }
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

export function digestRetainedOrdinaryFileFd(
  fd: number,
  expected: Readonly<{ device: string; inode: string }>,
  label: string,
  assertReadCurrent?: () => void
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
    }, before.size, label, assertReadCurrent
  );
  const after = fstatSync(fd, { bigint: true });
  if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mode !== before.mode || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} changed during retained streaming inventory.`);
  }
  return result;
}

export function closeWindowsHandle(handle: bigint): void {
  if (requireWindowsKernel32().symbols.CloseHandle(handle) === 0) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'CloseHandle failed after physical operation.');
  }
}

/**
 * Close every subordinate handle even when one close fails.  A cleanup error
 * is returned (rather than thrown in the loop) so a caller that is already
 * unwinding an operation can preserve that operation's primary error.
 */
export function closeLinuxDescriptorsBestEffort(
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

export function closeWindowsHandlesBestEffort(
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

export function inspectWindowsDirectoryChain(absolutePath: string, label: string): PhysicalDirectoryChain {
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

export function inspectLinuxDirectoryChain(absolutePath: string, label: string): PhysicalDirectoryChain {
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

export interface WindowsBulkDirectoryHandle {
  readonly handle: bigint;
  readonly identity: PhysicalDirectoryIdentity;
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

export function isLinuxNoFollowDirectoryCreateRaceActorForTests(value: unknown): value is LinuxNoFollowDirectoryCreateRaceActor {
  return value !== null && typeof value === 'object' && linuxNoFollowDirectoryCreateRaceActors.has(value);
}
