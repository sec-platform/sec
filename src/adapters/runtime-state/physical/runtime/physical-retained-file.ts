import { closeSync, fstatSync, readSync } from 'node:fs';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from './physical-directory-chain.ts';
import {
  linuxRetainBulkDirectoryChain,
  windowsRetainBulkDirectoryChain
} from './physical-directory-tree.ts';
import {
  assertRetainedNoFollowCapability,
  assertRetainedNoFollowProvenDirectoryGeneration,
  issueRetainedNoFollowCapability
} from './physical-no-follow-authority.ts';
import type {
  NoFollowDirectoryTreeEntry,
  PhysicalDirectoryChain,
  RetainedNoFollowChildProcessFile,
  RetainedNoFollowOrdinaryFile,
  RetainedNoFollowProvenDirectoryGeneration
} from './physical-no-follow-contract.ts';
import {
  WINDOWS_FILE_OPEN,
  WINDOWS_GENERIC_READ,
  WINDOWS_SHARE_READ,
  closeLinuxDescriptorsBestEffort,
  closeWindowsHandle,
  closeWindowsHandlesBestEffort,
  digestRetainedOrdinaryFileFd,
  digestWindowsRetainedFile,
  linuxAssertRetainedExecutableWitness,
  linuxAssertSealedExecutableImage,
  linuxCreateSealedExecutableImage,
  linuxOpenReadableLeafAt,
  linuxOpenRetainedExecutableWitness,
  linuxRaiseDescriptorFloor,
  linuxRetainCurrentSealedExecutableImage,
  readWindowsRetainedFile,
  windowsOpenRelativeLeaf,
  windowsRetainedFileSnapshot,
  windowsRetainedLeafIdentity,
  windowsRewindRetainedFile,
  type LinuxRetainedExecutableWitness,
  type LinuxSealedExecutableImage
} from './physical-no-follow-native.ts';
import {
  NO_FOLLOW_FILE_READ_LIMIT_BYTES,
  ensureLeafName,
  physicalError,
  sameIdentity
} from './physical-no-follow-shared.ts';

/** Retained ordinary/executable file capability lifecycle. */


/**
 * A deliberately narrow filesystem primitive.  It owns neither a repository
 * nor an operation's authorization semantics: callers bind these physical
 * observations to their own contracts.
 */

export type RetainedNoFollowPosixMetadataForInternal = Readonly<{
  mode: number | null;
  ownerGroupId: bigint | null;
  ownerUserId: bigint | null;
}>;
const adoptedCurrentLinuxExecutables = new WeakSet<object>();
const retainedOrdinaryFileMtimes = new WeakMap<object, bigint>();
const retainedNoFollowOrdinaryFilePosixMetadata = new WeakMap<object, RetainedNoFollowPosixMetadataForInternal>();

/** Retain the current runtime through its actual physical execution mode. */
export function retainCurrentProcessExecutable(
  childDescriptor = 3,
  label = 'current process executable'
): RetainedNoFollowOrdinaryFile {
  if (process.platform === 'linux' && process.execPath.startsWith('/memfd:sec-retained-executable')) {
    return retainCurrentLinuxSealedExecutable(3, childDescriptor, label);
  }
  const executablePath = path.resolve(process.execPath);
  return retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(executablePath), `${label} parent`),
    path.basename(executablePath), undefined, label, childDescriptor, 'executable'
  );
}

/** Revalidate the transported source using the same no-follow physical owner. */
export function observeAdoptedExecutableSource(
  executable: RetainedNoFollowOrdinaryFile,
  inheritedSourcePath: string | undefined
): Readonly<{
  path: string;
  device: string;
  inode: string;
  mode: string;
  size: number;
  modifiedAtNanoseconds: string;
  byteDigest: `sha256:${string}`;
}> {
  assertRetainedNoFollowCapability(executable, 'executable', 'executable source provenance');
  executable.assertCurrent();
  if (process.platform !== 'linux' || !adoptedCurrentLinuxExecutables.has(executable)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Source provenance observation requires an adopted current sealed executable.');
  }
  if (inheritedSourcePath === undefined || !path.isAbsolute(inheritedSourcePath)
      || inheritedSourcePath.includes('\0') || path.resolve(inheritedSourcePath) !== inheritedSourcePath) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      'Adopted executable requires a canonical source locator.');
  }
  const expected = executable.digest();
  const source = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(inheritedSourcePath), 'executable source parent'),
    path.basename(inheritedSourcePath), undefined, 'executable source provenance'
  );
  try {
    if (source.size !== expected.size) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        'Executable source size does not match the retained sealed image.');
    }
    const metadata = fstatSync(source.stdioSourceDescriptor!, {bigint: true});
    const observed = source.digest();
    if (observed.size !== expected.size || observed.byteDigest !== expected.byteDigest) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        'Executable source provenance does not match the retained sealed image.');
    }
    source.assertCurrent();
    executable.assertCurrent();
    return Object.freeze({path: source.path, device: String(metadata.dev), inode: String(metadata.ino),
      mode: String(metadata.mode), size: observed.size, modifiedAtNanoseconds: String(metadata.mtimeNs),
      byteDigest: observed.byteDigest});
  } finally {
    source.dispose();
  }
}

/** A locator is transported only after its retained source bytes are proven. */
export function retainedExecutableSourcePath(
  executable: RetainedNoFollowOrdinaryFile,
  inheritedSourcePath: string | undefined
): string {
  assertRetainedNoFollowCapability(executable, 'executable', 'executable source provenance');
  executable.assertCurrent();
  return adoptedCurrentLinuxExecutables.has(executable)
    ? observeAdoptedExecutableSource(executable, inheritedSourcePath).path
    : executable.path;
}

/**
 * Keep an executable's native package location when its resource lookup depends
 * on os.Executable()/GetModuleFileName. Unlike the default anonymous sealed
 * image, this requires an owner-issued read-only generation for the WHOLE
 * package. Both the executable and its adjacent resources remain under that
 * generation's admission, readback and retirement contract.
 */
export async function retainNoFollowGenerationExecutable(
  generation: RetainedNoFollowProvenDirectoryGeneration,
  relativePath: string,
  childDescriptor = 3,
  label = 'generation-backed executable'
): Promise<RetainedNoFollowOrdinaryFile> {
  assertRetainedNoFollowProvenDirectoryGeneration(generation, label);
  if (!relativePath || relativePath.includes('\\') || relativePath.includes('\0')
      || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} requires a canonical contained path.`);
  }
  generation.assertCurrent();
  await generation.assertAuthorityCurrent();
  const executablePath = path.join(generation.root.path, ...relativePath.split('/'));
  const retained = retainNoFollowFile(
    inspectNoFollowDirectoryChain(path.dirname(executablePath), `${label} parent`),
    path.basename(executablePath), undefined, label, childDescriptor, 'executable', generation
  );
  try {
    await generation.assertAuthorityCurrent();
    retained.assertCurrent();
    return retained;
  } catch (error) {
    retained.dispose();
    throw error;
  }
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
  return retainNoFollowFile(expectedParent, name, expectedPhysical, label, childDescriptor, role);
}


/**
 * Adopts the SEC-sealed executable image already running this Linux process
 * into a fresh owned executable capability.  This is the nested-process path:
 * it never reopens a mutable source pathname and it owns a duplicate of the
 * inherited sealed descriptor.
 */
export function retainCurrentLinuxSealedExecutable(
  sourceDescriptor = 3,
  childDescriptor = 3,
  label = 'current sealed Linux executable'
): RetainedNoFollowOrdinaryFile {
  if (process.platform !== 'linux'
      || !Number.isSafeInteger(childDescriptor)
      || childDescriptor < 3 || childDescriptor > 64) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} requires Linux and one bounded child descriptor.`
    );
  }
  const image = linuxRetainCurrentSealedExecutableImage(sourceDescriptor, label);
  let disposed = false;
  try {
    const procFdParent = inspectNoFollowDirectoryChain(
      `/proc/${process.pid}/fd`,
      `${label} proc descriptor parent`
    ).target;
    const assertCurrent = (): void => {
      if (disposed) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
          `${label} capability is disposed.`
        );
      }
      linuxAssertSealedExecutableImage(image, label);
    };
    const readBytes = (): Uint8Array => {
      assertCurrent();
      if (image.size > BigInt(NO_FOLLOW_FILE_READ_LIMIT_BYTES)) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED',
          `${label} exceeds the bounded retained byte-read domain.`
        );
      }
      const size = Number(image.size);
      const bytes = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const count = readSync(image.fd, bytes, offset, size - offset, offset);
        if (count < 1) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
            `${label} stopped making progress during retained byte read.`
          );
        }
        offset += count;
      }
      assertCurrent();
      return bytes;
    };
    const capability = Object.freeze({
      path: `/proc/self/fd/${sourceDescriptor}`,
      parent: procFdParent,
      name: String(sourceDescriptor),
      physical: image.physical,
      size: Number(image.size),
      linkCount: Number(image.linkCount),
      childPath: `/proc/self/fd/${childDescriptor}`,
      stdioSourceDescriptor: image.fd,
      assertCurrent,
      readBytes,
      digest: () => {
        assertCurrent();
        return image.digest;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        closeSync(image.fd);
      }
    });
    retainedNoFollowOrdinaryFilePosixMetadata.set(capability, Object.freeze({
      mode: Number(image.mode & 0o7777n),
      ownerGroupId: null,
      ownerUserId: null
    }));
    const issued = issueRetainedNoFollowCapability(capability, 'executable');
    adoptedCurrentLinuxExecutables.add(issued);
    return issued;
  } catch (error) {
    if (!disposed) {
      disposed = true;
      try { closeSync(image.fd); } catch { /* preserve primary capability error */ }
    }
    throw error;
  }
}

function retainNoFollowFile(
  expectedParent: PhysicalDirectoryChain,
  name: string,
  expectedPhysical?: Readonly<{ device: string; inode: string }>,
  label = 'retained ordinary file',
  childDescriptor = 3,
  role: 'ordinary-file' | 'executable' = 'ordinary-file',
  generation?: RetainedNoFollowProvenDirectoryGeneration
): RetainedNoFollowOrdinaryFile {
  ensureLeafName(name);
  if (role !== 'ordinary-file' && role !== 'executable') {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} capability role is invalid.`);
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
    let executableImage: LinuxSealedExecutableImage | null = null;
    let executableWitness: LinuxRetainedExecutableWitness | null = null;
    let disposed = false;
    try {
      if (role === 'executable') {
        executableWitness = linuxOpenRetainedExecutableWitness(
          retainedParent.target.fd,
          name,
          label
        );
      }
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
      if (initial.nlink < 0n || initial.nlink > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} link count is outside the safe observation domain.`);
      }
      const initialLinkCount = initial.nlink;
      const initialMode = initial.mode;
      const initialOwnerGroupId = initial.gid;
      const initialOwnerUserId = initial.uid;
      const initialSize = initial.size;
      const initialMtimeNs = initial.mtimeNs;
      const initialCtimeNs = initial.ctimeNs;
      if (generation !== undefined && ((initialMode & 0o222n) !== 0n || (initialMode & 0o111n) === 0n)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} is not a read-only executable in its generation.`);
      }
      if (role === 'executable' && generation === undefined) {
        executableImage = linuxCreateSealedExecutableImage(
          descriptor,
          initialSize,
          initialMode,
          label
        );
        const afterImage = fstatSync(descriptor, { bigint: true });
        if (!afterImage.isFile() || afterImage.dev !== initial.dev || afterImage.ino !== initial.ino
            || afterImage.mode !== initialMode || afterImage.size !== initialSize
            || afterImage.mtimeNs !== initialMtimeNs || afterImage.ctimeNs !== initialCtimeNs) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
            `${label} source changed while sealing its executable image.`
          );
        }
      }
      const assertCurrent = (): void => {
        generation?.assertCurrent();
        if (disposed || descriptor === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
        }
        if (executableWitness !== null) {
          linuxAssertRetainedExecutableWitness(executableWitness, label);
        }
        const current = fstatSync(descriptor, { bigint: true });
        if (!current.isFile() || current.dev !== initial.dev || current.ino !== initial.ino ||
            current.mode !== initialMode || current.size !== initialSize ||
            current.nlink !== initialLinkCount ||
            current.gid !== initialOwnerGroupId || current.uid !== initialOwnerUserId ||
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
              || leaf.nlink !== initialLinkCount
              || leaf.gid !== initialOwnerGroupId || leaf.uid !== initialOwnerUserId
              || leaf.mtimeNs !== initialMtimeNs || leaf.ctimeNs !== initialCtimeNs) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} lexical leaf identity changed.`);
          }
        } finally {
          closeSync(lexicalLeaf);
        }
        retainedParent.assertCurrent();
        if (executableImage !== null) {
          linuxAssertSealedExecutableImage(executableImage, label);
        }
      };
      assertCurrent();
      const contentDescriptor = executableImage?.fd ?? descriptor;
      const contentPhysical = executableImage?.physical ?? physical;
      const contentSize = executableImage?.size ?? initialSize;
      const capability = Object.freeze({
        path: absolutePath,
        parent,
        name,
        physical,
        size: Number(initialSize),
        linkCount: Number(initialLinkCount),
        childPath: `/proc/self/fd/${childDescriptor}`,
        stdioSourceDescriptor: contentDescriptor,
        assertCurrent,
        readBytes: () => {
          assertCurrent();
          const before = fstatSync(contentDescriptor, { bigint: true });
          if (!before.isFile() || String(before.dev) !== contentPhysical.device ||
              String(before.ino) !== contentPhysical.inode || before.size !== contentSize ||
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
            const count = readSync(contentDescriptor, chunk, 0, chunk.byteLength, offset);
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
          const result = executableImage?.digest
            ?? digestRetainedOrdinaryFileFd(descriptor!, physical, label);
          assertCurrent();
          return result;
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          const closeError = closeLinuxDescriptorsBestEffort(
            [
              ...(executableWitness === null ? [] : [executableWitness.fd]),
              ...(executableImage === null ? [] : [executableImage.fd]),
              descriptor!,
              ...[...retainedParent.directories].reverse().map((entry) => entry.fd)
            ],
            label
          );
          descriptor = null;
          executableImage = null;
          executableWitness = null;
          if (closeError !== null) throw closeError;
        }
      });
      if (role === 'ordinary-file') retainedOrdinaryFileMtimes.set(capability, initialMtimeNs);
      retainedNoFollowOrdinaryFilePosixMetadata.set(capability, Object.freeze({
        mode: Number(initialMode & 0o7777n),
        ownerGroupId: initialOwnerGroupId,
        ownerUserId: initialOwnerUserId
      }));
      return issueRetainedNoFollowCapability(capability, role);
    } catch (error) {
      const descriptors = [
        ...(executableWitness === null ? [] : [executableWitness.fd]),
        ...(executableImage === null ? [] : [executableImage.fd]),
        ...(descriptor === null ? [] : [descriptor]),
        ...[...retainedParent.directories].reverse().map((entry) => entry.fd)
      ];
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
        true,
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
            current.basic !== initial.basic || current.size !== initial.size ||
            current.linkCount !== initial.linkCount) {
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
      // This handle was opened with read sharing only. Windows therefore
      // rejects every concurrent writer and delete-capable handle for the
      // complete retained lifetime. Prove executable content once through
      // that exact handle; later process fences still revalidate the handle,
      // metadata, lexical edge and retained ancestors, but do not repeatedly
      // stream the same immutable executable bytes on the event-loop thread.
      const retainedExecutableDigest = role === 'executable'
        ? (() => {
            windowsRewindRetainedFile(handle!, label);
            const observed = digestWindowsRetainedFile(
              handle!,
              absolutePath,
              physical,
              label
            );
            assertCurrent();
            return observed;
          })()
        : null;
      const capability = Object.freeze({
        path: absolutePath,
        parent,
        name,
        physical,
        size: Number(initial.size),
        linkCount: initial.linkCount,
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
          if (retainedExecutableDigest !== null) return retainedExecutableDigest;
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
      if (role === 'ordinary-file') {
        // stableBasic omits access time: retained last-write FILETIME is its
        // second 8-byte field. FILETIME is 100ns ticks since 1601-01-01.
        const lastWrite = Buffer.from(initial.basic, 'hex').readBigInt64LE(8);
        retainedOrdinaryFileMtimes.set(capability, (lastWrite - 116444736000000000n) * 100n);
      }
      retainedNoFollowOrdinaryFilePosixMetadata.set(capability, Object.freeze({
        mode: null,
        ownerGroupId: null,
        ownerUserId: null
      }));
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

/** Internal POSIX metadata projection for durable publication; does not issue authority. */
export function retainedNoFollowOrdinaryFilePosixMetadataForInternal(
  capability: RetainedNoFollowOrdinaryFile
): RetainedNoFollowPosixMetadataForInternal | undefined {
  return retainedNoFollowOrdinaryFilePosixMetadata.get(capability);
}

/** Immutable metadata of this live retained ordinary file, never path-based
 * authority. Both native backends fence this timestamp for the full lifetime. */
export function retainedNoFollowOrdinaryFileMtimeForInternal(capability: RetainedNoFollowOrdinaryFile): bigint {
  assertRetainedNoFollowCapability(capability, 'ordinary-file', 'Retained file timestamp');
  capability.assertCurrent();
  const timestamp = retainedOrdinaryFileMtimes.get(capability);
  if (timestamp === undefined) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Retained file timestamp is unavailable.');
  return timestamp;
}
