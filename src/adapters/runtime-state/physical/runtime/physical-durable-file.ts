import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fchmodSync, fstatSync, fsyncSync, ftruncateSync, readSync, writeFileSync
} from 'node:fs';
import path from 'node:path';

import {
  assertSameNoFollowDirectoryIdentity, inspectNoFollowDirectoryChain
} from './physical-directory-chain.ts';
import {
  inspectNoFollowOrdinaryFileEntry,
  readNoFollowOrdinaryFile
} from './physical-leaf-observation.ts';
import { assertRetainedNoFollowCapability } from './physical-no-follow-authority.ts';
import {
  PhysicalNoFollowError,
  type DurableCanonicalFileIdentityReceipt,
  type DurableCanonicalFilePublicationReceipt,
  type DurableCanonicalFileReplacementRecovery,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowFileObservation,
  type RetainedNoFollowFileTransaction,
  type RetainedNoFollowFileTransactionTestActor,
  type RetainedNoFollowOrdinaryFile,
  type WindowsDurableCanonicalFileReplacementInterruptionActor,
  type WindowsDurableCanonicalFileReplacementInterruptionPoint
} from './physical-no-follow-contract.ts';
import {
  LINUX_AT_EMPTY_PATH, LINUX_AT_FDCWD, LINUX_AT_SYMLINK_FOLLOW,
  LINUX_O_CLOEXEC, LINUX_O_CREAT, LINUX_O_EXCL, LINUX_O_NOFOLLOW,
  LINUX_O_RDWR, LINUX_O_WRONLY, LINUX_RENAME_EXCHANGE, LINUX_RENAME_NOREPLACE,
  WINDOWS_DELETE, WINDOWS_FILE_CREATE, WINDOWS_FILE_OPEN, WINDOWS_FILE_WRITE_ATTRIBUTES,
  WINDOWS_GENERIC_READ, WINDOWS_GENERIC_WRITE, WINDOWS_SHARE_READ,
  WINDOWS_SHARE_READ_WRITE_DELETE, WINDOWS_SYNCHRONIZE,
  closeLinuxDescriptorsBestEffort, closeWindowsHandle, closeWindowsHandlesBestEffort,
  inspectLinuxDirectoryChain, linuxErrno, linuxIdentity, linuxOpenAt, linuxOpenLeafAt,
  linuxOpenReadableLeafAt, linuxOpenRetainedAbsoluteDirectory, linuxOpenRoot,
  readWindowsRetainedFile, requireLinuxLibc, requireWindowsKernel32,
  windowsFlushRetainedDirectory, windowsIdentity, windowsMarkRetainedLeafForDelete,
  windowsOpenDirectory, windowsOpenRelativeDirectory, windowsOpenRelativeLeaf,
  windowsReadRelativeOrdinaryLeaf, windowsRenameRetainedOrdinaryFile,
  windowsRetainedLeafIdentity, windowsRetainedOrdinaryFileLinkCount,
  windowsRewindRetainedFile, windowsTruncateRetainedOrdinaryFile,
  windowsWriteRetainedChunk, windowsWriteRetainedFile
} from './physical-no-follow-native.ts';
import {
  NO_FOLLOW_FILE_READ_LIMIT_BYTES, ensureLeafName, physicalError, sameIdentity
} from './physical-no-follow-shared.ts';
import {
  retainNoFollowOrdinaryFile,
  retainedNoFollowOrdinaryFilePosixMetadataForInternal,
  type RetainedNoFollowPosixMetadataForInternal
} from './physical-retained-file.ts';

/** Durable canonical-file publication, transaction and replacement recovery. */

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

/** Revalidates the exact directory identity and executes its platform durability barrier. */
export function flushNoFollowDirectory(parent: PhysicalDirectoryIdentity): void {
  syncDirectory(parent);
}

function bytesDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const issuedDurableCanonicalFileIdentityReceipts = new WeakSet<object>();

function issueDurableCanonicalFileIdentityReceipt<T extends DurableCanonicalFileIdentityReceipt>(receipt: T): T {
  issuedDurableCanonicalFileIdentityReceipts.add(receipt);
  return receipt;
}

export function assertDurableCanonicalFileIdentityReceipt(
  receipt: DurableCanonicalFileIdentityReceipt
): void {
  if (!issuedDurableCanonicalFileIdentityReceipts.has(receipt)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Durable canonical file identity was not issued by Runtime Physical.'
    );
  }
}

function linuxRetainedPublicationParent(parent: PhysicalDirectoryIdentity, label: string): { rootFd: number; parentFd: number } {
  const retained = linuxOpenRetainedAbsoluteDirectory(parent.path, label);
  try {
    const observed = linuxIdentity(retained.directoryFd, parent.path);
    if (!sameIdentity(parent, observed)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} parent identity changed.`);
    }
    return Object.freeze({ rootFd: retained.filesystemRootFd, parentFd: retained.directoryFd });
  } catch (error) {
    closeLinuxDescriptorsBestEffort([retained.directoryFd, retained.filesystemRootFd], label);
    throw error;
  }
}

function closeLinuxRetainedPublicationParent(input: { rootFd: number; parentFd: number }): void {
  const failure = closeLinuxDescriptorsBestEffort([input.parentFd, input.rootFd], 'Publication parent settlement');
  if (failure !== null) throw failure;
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
  label: string,
  maximumBytes?: number
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
  const current = readWindowsRetainedFile(sourceHandle, label, maximumBytes);
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

type RetainedFileRecord = {
  observation: RetainedNoFollowFileObservation;
  expectedBytes: Buffer;
  parent: PhysicalDirectoryIdentity;
  name: string;
  windowsHandle: bigint | null;
  windowsParentHandle: bigint | null;
  linuxFd: number | null;
  linuxParentFd: number | null;
};
const retainedFileTestActors = new WeakSet<object>();
const retainedFileObservations = new WeakMap<object, RetainedFileRecord>();
export function createRetainedNoFollowFileTransactionTestActorForTests(
  actor: RetainedNoFollowFileTransactionTestActor
): RetainedNoFollowFileTransactionTestActor {
  const issued = Object.freeze({ ...actor });
  retainedFileTestActors.add(issued);
  return issued;
}

/** One root-retained, file-only transaction for a single recovery edge. */
export function retainNoFollowFileTransaction(
  boundaryRoot: string,
  label: string,
  testOnlyActor?: RetainedNoFollowFileTransactionTestActor
): RetainedNoFollowFileTransaction {
  if (testOnlyActor !== undefined && !retainedFileTestActors.has(testOnlyActor)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} test actor was not issued by Physical.`);
  }
  const actor: RetainedNoFollowFileTransactionTestActor = testOnlyActor ?? Object.freeze({});
  const root = inspectNoFollowDirectoryChain(path.resolve(boundaryRoot), `${label} root`).target;
  const records = new Set<RetainedFileRecord>();
  const byPath = new Map<string, RetainedFileRecord>();
  let disposed = false;
  let windowsRootHandle: bigint | null = null;
  let linuxFilesystemRootFd: number | null = null;
  let linuxRootFd: number | null = null;
  try {
    if (process.platform === 'win32') {
      windowsRootHandle = windowsOpenDirectory(root.path, `${label} retained root`, true);
      if (!sameIdentity(root, windowsIdentity(windowsRootHandle, root.path, `${label} retained root`))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} root changed before retention.`);
      }
    } else if (process.platform === 'linux') {
      const retained = linuxOpenRetainedAbsoluteDirectory(root.path, `${label} retained root`);
      linuxFilesystemRootFd = retained.filesystemRootFd;
      linuxRootFd = retained.directoryFd;
      if (!sameIdentity(root, linuxIdentity(linuxRootFd, root.path))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} root changed before retention.`);
      }
    } else throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} platform is unsupported.`);
  } catch (error) {
    closeWindowsHandlesBestEffort(windowsRootHandle === null ? [] : [windowsRootHandle], label);
    closeLinuxDescriptorsBestEffort([
      ...(linuxRootFd === null ? [] : [linuxRootFd]),
      ...(linuxFilesystemRootFd === null ? [] : [linuxFilesystemRootFd])
    ], label);
    throw error;
  }

  const live = (): void => {
    if (disposed) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} transaction is disposed.`);
    const current = process.platform === 'win32'
      ? windowsIdentity(windowsRootHandle!, root.path, `${label} retained root`)
      : linuxIdentity(linuxRootFd!, root.path);
    if (!sameIdentity(root, current)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained root changed.`);
    assertSameNoFollowDirectoryIdentity(root, `${label} lexical root`);
  };
  const parts = (relativePath: string): readonly string[] => {
    if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} path must be root-relative.`);
    }
    const segments = relativePath.replaceAll('\\', '/').split('/');
    if (segments.some((part) => part.length === 0 || part === '.' || part === '..' || part.includes('\0'))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} path contains an unsafe component.`);
    }
    return Object.freeze(segments);
  };
  const absolute = (relativePath: string): string => path.join(root.path, ...parts(relativePath));
  const windowsParent = (relativePath: string, operation: string): Readonly<{ handle: bigint; identity: PhysicalDirectoryIdentity; owned: bigint[] }> => {
    live(); const segments = [...parts(relativePath)]; segments.pop();
    let handle = windowsRootHandle!; let identity = root; const owned: bigint[] = [];
    try {
      for (const segment of segments) {
        const nextPath = path.join(identity.path, segment);
        const next = windowsOpenRelativeDirectory(handle, identity, segment, nextPath, WINDOWS_FILE_OPEN, operation);
        if (next === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${operation} parent is absent.`);
        owned.push(next); handle = next; identity = windowsIdentity(next, nextPath, operation);
      }
      return Object.freeze({ handle, identity, owned });
    } catch (error) { for (const ownedHandle of owned.reverse()) closeWindowsHandle(ownedHandle); throw error; }
  };
  const linuxParent = (relativePath: string, operation: string): Readonly<{ fd: number; identity: PhysicalDirectoryIdentity; owned: number[] }> => {
    live(); const segments = [...parts(relativePath)]; segments.pop();
    let fd = linuxRootFd!; let identity = root; const owned: number[] = [];
    try {
      for (const segment of segments) {
        const next = linuxOpenAt(fd, segment, operation); owned.push(next); fd = next;
        identity = linuxIdentity(fd, path.join(identity.path, segment));
      }
      return Object.freeze({ fd, identity, owned });
    } catch (error) { for (const ownedFd of owned.reverse()) closeSync(ownedFd); throw error; }
  };
  const closeParent = (parent: Readonly<{ owned: readonly (bigint | number)[] }>): void => {
    for (const descriptor of [...parent.owned].reverse()) {
      if (typeof descriptor === 'bigint') closeWindowsHandle(descriptor); else closeSync(descriptor);
    }
  };
  const transferWindowsDirectParent = (
    parent: Readonly<{ handle: bigint; owned: bigint[] }>
  ): bigint => {
    const direct = parent.handle;
    const intermediate = parent.owned.slice(0, -1);
    for (const handle of intermediate.reverse()) closeWindowsHandle(handle);
    parent.owned.splice(0, parent.owned.length);
    return direct;
  };
  const transferLinuxDirectParent = (
    parent: Readonly<{ fd: number; owned: number[] }>
  ): number => {
    const direct = parent.fd;
    const intermediate = parent.owned.slice(0, -1);
    for (const fd of intermediate.reverse()) closeSync(fd);
    parent.owned.splice(0, parent.owned.length);
    return direct;
  };
  const issue = (record: RetainedFileRecord): RetainedNoFollowFileObservation => {
    records.add(record); byPath.set(record.observation.path, record); retainedFileObservations.set(record.observation, record);
    return record.observation;
  };
  const readLinuxRecordBytes = (fd: number, operation: string): Buffer => {
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.size > BigInt(NO_FOLLOW_FILE_READ_LIMIT_BYTES)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} retained bytes are outside the bounded ordinary-file domain.`);
    }
    const bytes = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(fd, bytes, offset, bytes.byteLength - offset, offset);
      if (count === 0) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} retained bytes ended early.`);
      offset += count;
    }
    return bytes;
  };
  const retain = (relativePath: string, operation: string): RetainedNoFollowFileObservation | null => {
    live(); const target = absolute(relativePath); const cached = byPath.get(target); if (cached !== undefined) return cached.observation;
    const name = parts(relativePath).at(-1)!;
    if (process.platform === 'win32') {
      const parent = windowsParent(relativePath, `${operation} parent`); let handle: bigint | null = null;
      try {
        handle = windowsOpenRelativeLeaf(parent.handle, parent.identity, name, target, WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES + WINDOWS_SYNCHRONIZE, WINDOWS_FILE_OPEN, operation, true);
        if (handle === null) { closeParent(parent); return null; }
        const identity = windowsRetainedLeafIdentity(handle, target, 'file', operation); windowsRewindRetainedFile(handle, operation);
        const expectedBytes = Buffer.from(readWindowsRetainedFile(handle, operation));
        const observation = Object.freeze({ path: target, bytes: Buffer.from(expectedBytes), identity, permissionMode: null });
        const retainedParentHandle = transferWindowsDirectParent(parent);
        return issue({ observation, expectedBytes, parent: parent.identity, name, windowsHandle: handle, windowsParentHandle: retainedParentHandle, linuxFd: null, linuxParentFd: null });
      } catch (error) { if (handle !== null) closeWindowsHandle(handle); closeParent(parent); throw error; }
    }
    const parent = linuxParent(relativePath, `${operation} parent`); let fd: number | null = null;
    try {
      try { fd = linuxOpenReadableLeafAt(parent.fd, name, operation); }
      catch (error) { if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') { closeParent(parent); return null; } throw error; }
      const stat = fstatSync(fd, { bigint: true }); if (!stat.isFile()) throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} is not ordinary.`);
      const expectedBytes = readLinuxRecordBytes(fd, operation);
      const observation = Object.freeze({
        path: target,
        bytes: Buffer.from(expectedBytes),
        identity: Object.freeze({ device: String(stat.dev), inode: String(stat.ino) }),
        permissionMode: Number(stat.mode & 0o7777n)
      });
      const retainedParentFd = transferLinuxDirectParent(parent);
      return issue({ observation, expectedBytes, parent: parent.identity, name, windowsHandle: null, windowsParentHandle: null, linuxFd: fd, linuxParentFd: retainedParentFd });
    } catch (error) { if (fd !== null) closeSync(fd); closeParent(parent); throw error; }
  };
  const selected = (relativePath: string, observation: RetainedNoFollowFileObservation, operation: string): RetainedFileRecord => {
    live(); const record = retainedFileObservations.get(observation);
    if (record === undefined || !records.has(record) || record.observation !== observation || observation.path !== absolute(relativePath)) throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${operation} observation is foreign or stale.`);
    const current = process.platform === 'win32' ? windowsRetainedLeafIdentity(record.windowsHandle!, observation.path, 'file', operation) : (() => { const value = fstatSync(record.linuxFd!, { bigint: true }); return { device: String(value.dev), inode: String(value.ino) }; })();
    if (current.device !== observation.identity.device || current.inode !== observation.identity.inode) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} retained identity changed.`);
    const currentBytes = process.platform === 'win32'
      ? (windowsRewindRetainedFile(record.windowsHandle!, operation), Buffer.from(readWindowsRetainedFile(record.windowsHandle!, operation)))
      : readLinuxRecordBytes(record.linuxFd!, operation);
    if (!currentBytes.equals(record.expectedBytes)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} retained bytes changed.`);
    }
    return record;
  };
  const verifyCurrentName = (relativePath: string, record: RetainedFileRecord, operation: string): void => {
    if (process.platform === 'win32') {
      const parent = windowsParent(relativePath, operation);
      let current: bigint | null = null;
      try {
        if (!sameIdentity(parent.identity, record.parent)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} source parent changed.`);
        current = windowsOpenRelativeLeaf(parent.handle, parent.identity, record.name, record.observation.path, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, operation, true);
        if (current === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${operation} source disappeared.`);
        const identity = windowsRetainedLeafIdentity(current, record.observation.path, 'file', operation);
        if (identity.device !== record.observation.identity.device || identity.inode !== record.observation.identity.inode) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} source name changed.`);
      } finally { if (current !== null) closeWindowsHandle(current); closeParent(parent); }
      return;
    }
    const parent = linuxParent(relativePath, operation);
    let current: number | null = null;
    try {
      if (!sameIdentity(parent.identity, record.parent)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} source parent changed.`);
      current = linuxOpenReadableLeafAt(parent.fd, record.name, operation);
      const value = fstatSync(current, { bigint: true });
      if (String(value.dev) !== record.observation.identity.device || String(value.ino) !== record.observation.identity.inode) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} source name changed.`);
    } finally { if (current !== null) closeSync(current); closeParent(parent); }
  };
  const flushRecord = async (record: RetainedFileRecord, targetPath: string, targetParent: PhysicalDirectoryIdentity, targetParentHandle: bigint | null, targetParentFd: number | null, operation: string): Promise<void> => {
    const targetRelativePath = path.relative(root.path, targetPath).split(path.sep).join('/');
    const revalidateRetainedParent = (stage: string): void => {
      const current = process.platform === 'win32'
        ? windowsIdentity(targetParentHandle!, targetParent.path, `${operation} ${stage} parent`)
        : linuxIdentity(targetParentFd!, targetParent.path);
      if (!sameIdentity(targetParent, current)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} retained parent changed ${stage}.`);
      }
    };
    const revalidateAfterActor = (stage: string): void => {
      selected(targetRelativePath, record.observation, `${operation} ${stage}`);
      verifyCurrentName(targetRelativePath, record, `${operation} ${stage}`);
      revalidateRetainedParent(stage);
    };
    if (process.platform === 'win32') {
      if (requireWindowsKernel32().symbols.FlushFileBuffers(record.windowsHandle!) === 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} file flush failed.`);
      await actor.durabilityObserver?.({ label: operation, targetPath, stage: 'file-flushed' });
      revalidateAfterActor('after file-flushed observer');
      await actor.beforeParentBarrier?.({ label: operation, targetPath, parentPath: targetParent.path });
      revalidateAfterActor('after before-parent-barrier actor');
      windowsFlushRetainedDirectory(targetParentHandle!, targetParent, `${operation} parent`);
    } else {
      fsyncSync(record.linuxFd!);
      await actor.durabilityObserver?.({ label: operation, targetPath, stage: 'file-flushed' });
      revalidateAfterActor('after file-flushed observer');
      await actor.beforeParentBarrier?.({ label: operation, targetPath, parentPath: targetParent.path });
      revalidateAfterActor('after before-parent-barrier actor');
      if (requireLinuxLibc().symbols.fsync(targetParentFd!) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} parent fsync failed.`);
    }
    await actor.durabilityObserver?.({ label: operation, targetPath, stage: 'parent-barrier' });
    revalidateAfterActor('after parent-barrier observer');
  };
  const capability: RetainedNoFollowFileTransaction = Object.freeze({
    rootPath: root.path,
    rootIdentity: root,
    assertCurrent: live,
    observe: retain,
    observeTuple: (entries: readonly Readonly<{ key: string; relativePath: string; label: string }>[]) => Object.freeze(Object.fromEntries(entries.map((entry) => [entry.key, retain(entry.relativePath, entry.label)]))),
    createExclusive: async (relativePath: string, bytes: Uint8Array, operation: string, creationMode = 0o600) => {
      if (!Number.isSafeInteger(creationMode) || creationMode < 0 || creationMode > 0o7777) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} creation mode is invalid.`);
      }
      if (bytes.byteLength > NO_FOLLOW_FILE_READ_LIMIT_BYTES) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} creation bytes exceed the retained ordinary-file bound.`);
      }
      const expected = Buffer.from(bytes);
      live(); const target = absolute(relativePath); const name = parts(relativePath).at(-1)!; await actor.beforeCreate?.({ label: operation, parentPath: path.dirname(target), targetPath: target }); live();
      const parent = process.platform === 'win32' ? windowsParent(relativePath, operation) : linuxParent(relativePath, operation); let leaf: bigint | number | null = null;
      let parentTransferred = false;
      try {
        if (process.platform === 'win32') { leaf = windowsOpenRelativeLeaf((parent as ReturnType<typeof windowsParent>).handle, parent.identity, name, target, WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES + WINDOWS_SYNCHRONIZE, WINDOWS_FILE_CREATE, operation, false, WINDOWS_SHARE_READ_WRITE_DELETE, true); if (leaf === null) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} already exists.`); windowsWriteRetainedFile(leaf, expected, operation); }
        else { leaf = requireLinuxLibc().symbols.openat((parent as ReturnType<typeof linuxParent>).fd, Buffer.from(`${name}\0`), LINUX_O_RDWR | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC | LINUX_O_CREAT | LINUX_O_EXCL, creationMode); if ((leaf as number) < 0) { leaf = null; throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} create failed (errno ${linuxErrno()}).`); } writeFileSync(leaf as number, expected); }
        const createdMetadata = process.platform === 'win32' ? null : fstatSync(leaf as number, { bigint: true });
        const identity = process.platform === 'win32'
          ? windowsRetainedLeafIdentity(leaf as bigint, target, 'file', operation)
          : { device: String(createdMetadata!.dev), inode: String(createdMetadata!.ino) };
        const observation = Object.freeze({
          path: target,
          bytes: Buffer.from(expected),
          identity: Object.freeze(identity),
          permissionMode: createdMetadata === null ? null : Number(createdMetadata.mode & 0o7777n)
        });
        const retainedParent = process.platform === 'win32'
          ? transferWindowsDirectParent(parent as ReturnType<typeof windowsParent>)
          : transferLinuxDirectParent(parent as ReturnType<typeof linuxParent>);
        parentTransferred = true;
        const record: RetainedFileRecord = { observation, expectedBytes: Buffer.from(expected), parent: parent.identity, name, windowsHandle: process.platform === 'win32' ? leaf as bigint : null, windowsParentHandle: process.platform === 'win32' ? retainedParent as bigint : null, linuxFd: process.platform === 'linux' ? leaf as number : null, linuxParentFd: process.platform === 'linux' ? retainedParent as number : null };
        issue(record); leaf = null; await flushRecord(record, target, parent.identity, record.windowsParentHandle, record.linuxParentFd, operation); return observation;
      } finally {
        if (leaf !== null) typeof leaf === 'bigint' ? closeWindowsHandle(leaf) : closeSync(leaf);
        if (!parentTransferred) closeParent(parent);
      }
    },
    rewriteExact: async (relativePath: string, source: RetainedNoFollowFileObservation, bytes: Uint8Array, operation: string) => {
      const record = selected(relativePath, source, operation);
      verifyCurrentName(relativePath, record, operation);
      const expected = Buffer.from(bytes);
      if (expected.byteLength > NO_FOLLOW_FILE_READ_LIMIT_BYTES) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} replacement bytes exceed the retained ordinary-file bound.`);
      }
      if (process.platform === 'win32') {
        const current = windowsRetainedLeafIdentity(record.windowsHandle!, source.path, 'file', operation);
        if (current.device !== source.identity.device || current.inode !== source.identity.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} retained source identity changed before rewrite.`);
        }
        if (windowsRetainedOrdinaryFileLinkCount(record.windowsHandle!, operation) !== 1) {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} refuses a hard-linked target.`);
        }
        windowsRewindRetainedFile(record.windowsHandle!, operation);
        windowsTruncateRetainedOrdinaryFile(record.windowsHandle!, 0, operation);
        windowsWriteRetainedFile(record.windowsHandle!, expected, operation);
        windowsRewindRetainedFile(record.windowsHandle!, operation);
        const readback = Buffer.from(readWindowsRetainedFile(record.windowsHandle!, operation));
        if (!readback.equals(expected)) {
          throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} retained rewrite readback differs.`);
        }
      } else if (process.platform === 'linux') {
        const fd = requireLinuxLibc().symbols.openat(
          record.linuxParentFd!, Buffer.from(`${record.name}\0`, 'utf8'),
          LINUX_O_RDWR | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC, 0
        );
        if (fd < 0) {
          throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} cannot open the retained target for rewrite (errno ${linuxErrno()}).`);
        }
        try {
          const before = fstatSync(fd, { bigint: true });
          if (!before.isFile() || String(before.dev) !== source.identity.device || String(before.ino) !== source.identity.inode) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} retained source identity changed before rewrite.`);
          }
          if (source.permissionMode === null || Number(before.mode & 0o7777n) !== source.permissionMode) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} permission mode changed before rewrite.`);
          }
          if (before.nlink !== 1n) {
            throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${operation} refuses a hard-linked target.`);
          }
          ftruncateSync(fd, 0);
          writeFileSync(fd, expected);
          fsyncSync(fd);
          const after = fstatSync(fd, { bigint: true });
          if (!after.isFile() || String(after.dev) !== source.identity.device || String(after.ino) !== source.identity.inode ||
              after.size !== BigInt(expected.byteLength) || after.mode !== before.mode ||
              after.uid !== before.uid || after.gid !== before.gid || after.nlink !== 1n) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} retained target identity changed during rewrite.`);
          }
          const readback = readLinuxRecordBytes(fd, operation);
          if (!readback.equals(expected)) {
            throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} retained rewrite readback differs.`);
          }
        } finally {
          closeSync(fd);
        }
      } else {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${operation} rewrite is unavailable on ${process.platform}.`);
      }
      verifyCurrentName(relativePath, record, `${operation} readback`);
      const successor = Object.freeze({
        path: source.path,
        bytes: Buffer.from(expected),
        identity: source.identity,
        permissionMode: source.permissionMode
      });
      retainedFileObservations.delete(source);
      record.observation = successor;
      record.expectedBytes = Buffer.from(expected);
      byPath.set(source.path, record);
      retainedFileObservations.set(successor, record);
      return successor;
    },
    renameNoReplace: async (sourcePath: string, targetPath: string, source: RetainedNoFollowFileObservation, operation: string) => {
      const record = selected(sourcePath, source, operation); verifyCurrentName(sourcePath, record, operation); const target = absolute(targetPath); const targetParent = process.platform === 'win32' ? windowsParent(targetPath, operation) : linuxParent(targetPath, operation);
      let targetParentTransferred = false;
      try { await actor.beforeRename?.({ label: operation, sourcePath: source.path, targetPath: target });
        selected(sourcePath, source, `${operation} post-actor source`);
        verifyCurrentName(sourcePath, record, `${operation} post-actor source`);
        if (process.platform === 'win32') windowsRenameRetainedOrdinaryFile(record.windowsHandle!, source.path, source.identity, (targetParent as ReturnType<typeof windowsParent>).handle, parts(targetPath).at(-1)!, false, operation);
        else if (requireLinuxLibc().symbols.renameat2(record.linuxParentFd!, Buffer.from(`${record.name}\0`), (targetParent as ReturnType<typeof linuxParent>).fd, Buffer.from(`${parts(targetPath).at(-1)!}\0`), LINUX_RENAME_NOREPLACE) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} rename failed (errno ${linuxErrno()}).`);
        await actor.durabilityObserver?.({ label: operation, targetPath: target, stage: 'renamed' }); await actor.afterNamespaceMutationBeforeFlush?.({ label: operation, sourcePath: source.path, targetPath: target });
        const targetName = parts(targetPath).at(-1)!;
        const destination = process.platform === 'win32' ? windowsOpenRelativeLeaf((targetParent as ReturnType<typeof windowsParent>).handle, targetParent.identity, targetName, target, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, `${operation} destination`, true) : linuxOpenReadableLeafAt((targetParent as ReturnType<typeof linuxParent>).fd, targetName, `${operation} destination`);
        if (destination === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} destination disappeared before FileId readback.`);
        try {
          const id = process.platform === 'win32' ? windowsRetainedLeafIdentity(destination as bigint, target, 'file', operation) : (() => { const value = fstatSync(destination as number, { bigint: true }); return { device: String(value.dev), inode: String(value.ino) }; })();
          if (id.device !== source.identity.device || id.inode !== source.identity.inode) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} destination FileId differs.`);
          const destinationBytes = process.platform === 'win32'
            ? (windowsRewindRetainedFile(destination as bigint, operation), Buffer.from(readWindowsRetainedFile(destination as bigint, operation)))
            : readLinuxRecordBytes(destination as number, operation);
          if (!destinationBytes.equals(record.expectedBytes)) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} destination bytes differ.`);
        } finally { typeof destination === 'bigint' ? closeWindowsHandle(destination) : closeSync(destination); }
        const oldWindowsParent = record.windowsParentHandle;
        const oldLinuxParent = record.linuxParentFd;
        const retainedTargetParent = process.platform === 'win32'
          ? transferWindowsDirectParent(targetParent as ReturnType<typeof windowsParent>)
          : transferLinuxDirectParent(targetParent as ReturnType<typeof linuxParent>);
        targetParentTransferred = true;
        if (oldWindowsParent !== null && oldWindowsParent !== windowsRootHandle && oldWindowsParent !== retainedTargetParent) closeWindowsHandle(oldWindowsParent);
        if (oldLinuxParent !== null && oldLinuxParent !== linuxRootFd && oldLinuxParent !== retainedTargetParent) closeSync(oldLinuxParent);
        const successor = Object.freeze({ path: target, bytes: Buffer.from(record.expectedBytes), identity: source.identity, permissionMode: source.permissionMode });
        retainedFileObservations.delete(source); byPath.delete(source.path);
        record.observation = successor; record.parent = targetParent.identity; record.name = targetName;
        record.windowsParentHandle = process.platform === 'win32' ? retainedTargetParent as bigint : null;
        record.linuxParentFd = process.platform === 'linux' ? retainedTargetParent as number : null;
        byPath.set(target, record); retainedFileObservations.set(successor, record);
        await flushRecord(record, target, targetParent.identity, record.windowsParentHandle, record.linuxParentFd, operation);
        return successor;
      } finally { if (!targetParentTransferred) closeParent(targetParent); }
    },
    linkExactNoReplace: async (sourcePath: string, targetPath: string, source: RetainedNoFollowFileObservation, operation: string) => {
      if (process.platform !== 'linux') throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${operation} is Linux-only.`); const record = selected(sourcePath, source, operation); verifyCurrentName(sourcePath, record, operation); const target = absolute(targetPath); const targetParent = linuxParent(targetPath, operation);
      let targetParentTransferred = false;
      try { await actor.beforeRename?.({ label: operation, sourcePath: source.path, targetPath: target }); selected(sourcePath, source, `${operation} post-actor source`); verifyCurrentName(sourcePath, record, `${operation} post-actor source`); let status = actor.forceExactLinkEmptyPathErrno === undefined ? requireLinuxLibc().symbols.linkat(record.linuxFd!, Buffer.from([0]), targetParent.fd, Buffer.from(`${parts(targetPath).at(-1)!}\0`), LINUX_AT_EMPTY_PATH) : -1; if (status !== 0) { const errno = actor.forceExactLinkEmptyPathErrno ?? linuxErrno(); if (errno !== 1 && errno !== 13) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} link failed (errno ${errno}).`); const procPath = `/proc/self/fd/${record.linuxFd!}`; const before = fstatSync(record.linuxFd!, { bigint: true }); if (String(before.dev) !== source.identity.device || String(before.ino) !== source.identity.inode) throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} fallback descriptor identity changed.`); status = requireLinuxLibc().symbols.linkat(LINUX_AT_FDCWD, Buffer.from(`${procPath}\0`), targetParent.fd, Buffer.from(`${parts(targetPath).at(-1)!}\0`), LINUX_AT_SYMLINK_FOLLOW); if (status !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} fallback link failed (errno ${linuxErrno()}).`); }
        await actor.durabilityObserver?.({ label: operation, targetPath: target, stage: 'renamed' }); await actor.afterNamespaceMutationBeforeFlush?.({ label: operation, sourcePath: source.path, targetPath: target }); const destination = linuxOpenReadableLeafAt(targetParent.fd, parts(targetPath).at(-1)!, `${operation} destination`); const value = fstatSync(destination, { bigint: true }); if (String(value.dev) !== source.identity.device || String(value.ino) !== source.identity.inode || !readLinuxRecordBytes(destination, operation).equals(record.expectedBytes)) { closeSync(destination); throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${operation} destination FileId or bytes differ.`); }
        const retainedTargetParent = transferLinuxDirectParent(targetParent); targetParentTransferred = true;
        const successor = Object.freeze({ path: target, bytes: Buffer.from(record.expectedBytes), identity: source.identity, permissionMode: source.permissionMode });
        const linked: RetainedFileRecord = { observation: successor, expectedBytes: Buffer.from(record.expectedBytes), parent: targetParent.identity, name: parts(targetPath).at(-1)!, windowsHandle: null, windowsParentHandle: null, linuxFd: destination, linuxParentFd: retainedTargetParent }; issue(linked); await flushRecord(linked, target, targetParent.identity, null, retainedTargetParent, operation); return successor;
      } finally { if (!targetParentTransferred) closeParent(targetParent); }
    },
    removeExact: async (relativePath: string, source: RetainedNoFollowFileObservation, operation: string) => { const record = selected(relativePath, source, operation); verifyCurrentName(relativePath, record, operation); await actor.beforeCleanup?.({ label: operation, filePath: source.path }); selected(relativePath, source, `${operation} post-actor source`); verifyCurrentName(relativePath, record, `${operation} post-actor source`); if (process.platform === 'win32') { windowsMarkRetainedLeafForDelete(record.windowsHandle!, operation); closeWindowsHandle(record.windowsHandle!); record.windowsHandle = null; const current = windowsOpenRelativeLeaf(record.windowsParentHandle!, record.parent, record.name, source.path, WINDOWS_GENERIC_READ, WINDOWS_FILE_OPEN, `${operation} absence`, true); if (current !== null) { closeWindowsHandle(current); throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} name remains.`); } windowsFlushRetainedDirectory(record.windowsParentHandle!, record.parent, `${operation} parent`); } else { if (requireLinuxLibc().symbols.unlinkat(record.linuxParentFd!, Buffer.from(`${record.name}\0`), 0) !== 0 || requireLinuxLibc().symbols.fsync(record.linuxParentFd!) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} unlink/barrier failed.`); try { const current = linuxOpenReadableLeafAt(record.linuxParentFd!, record.name, `${operation} absence`); closeSync(current); throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${operation} name remains.`); } catch (error) { if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error; } } if (record.windowsParentHandle !== null && record.windowsParentHandle !== windowsRootHandle) closeWindowsHandle(record.windowsParentHandle); if (record.linuxFd !== null) closeSync(record.linuxFd); if (record.linuxParentFd !== null && record.linuxParentFd !== linuxRootFd) closeSync(record.linuxParentFd); record.windowsParentHandle = null; record.linuxFd = null; record.linuxParentFd = null; records.delete(record); byPath.delete(source.path); retainedFileObservations.delete(source); },
    flushExact: async (relativePath: string, source: RetainedNoFollowFileObservation, operation: string) => { const record = selected(relativePath, source, operation); verifyCurrentName(relativePath, record, operation); await flushRecord(record, source.path, record.parent, record.windowsParentHandle, record.linuxParentFd, operation); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const windowsHandles: bigint[] = [];
      const linuxDescriptors: number[] = [];
      for (const record of records) {
        if (record.windowsHandle !== null) windowsHandles.push(record.windowsHandle);
        if (record.windowsParentHandle !== null) windowsHandles.push(record.windowsParentHandle);
        if (record.linuxFd !== null) linuxDescriptors.push(record.linuxFd);
        if (record.linuxParentFd !== null) linuxDescriptors.push(record.linuxParentFd);
        retainedFileObservations.delete(record.observation);
        record.windowsHandle = null;
        record.windowsParentHandle = null;
        record.linuxFd = null;
        record.linuxParentFd = null;
      }
      if (windowsRootHandle !== null) windowsHandles.push(windowsRootHandle);
      if (linuxRootFd !== null) linuxDescriptors.push(linuxRootFd);
      if (linuxFilesystemRootFd !== null) linuxDescriptors.push(linuxFilesystemRootFd);
      windowsRootHandle = null;
      linuxRootFd = null;
      linuxFilesystemRootFd = null;
      records.clear();
      byPath.clear();
      const windowsFailure = closeWindowsHandlesBestEffort(windowsHandles, label);
      const linuxFailure = closeLinuxDescriptorsBestEffort(linuxDescriptors, label);
      if (windowsFailure !== null && linuxFailure !== null) {
        throw new AggregateError([windowsFailure, linuxFailure], `${label} native settlement failed.`);
      }
      if (windowsFailure !== null) throw windowsFailure;
      if (linuxFailure !== null) throw linuxFailure;
    }
  });
  return capability;
}

/**
 * Creates a file only inside a private execution generation that is not yet
 * exposed to a child. The generation owner must verify the complete byte and
 * path inventory, seal it, and retire it after use. Unlike durable publication,
 * a crash during construction has no adopted file to recover, so per-file
 * FlushFileBuffers and temporary rename provide no consumer guarantee.
 */
export function publishExclusiveSealedExecutionFile(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  bytes: Uint8Array;
}>): void {
  ensureLeafName(input.name);
  const parent = assertSameNoFollowDirectoryIdentity(
    input.parent, 'Sealed execution file parent'
  ).target;
  if (process.platform !== 'win32') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Sealed execution file creation is supported only on Windows.');
  }
  const expected = Buffer.from(input.bytes);
  const finalPath = path.join(parent.path, input.name);
  const parentHandle = windowsRetainedPublicationParent(parent, 'Sealed execution file parent');
  let fileHandle: bigint | null = null;
  try {
    fileHandle = windowsOpenRelativeLeaf(
      parentHandle, parent, input.name, finalPath,
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
      WINDOWS_FILE_CREATE, 'Sealed execution file'
    );
    if (fileHandle === null) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Sealed execution file create returned no handle.');
    }
    const created = windowsRetainedLeafIdentity(fileHandle, finalPath, 'file', 'Sealed execution file');
    for (let offset = 0; offset < expected.byteLength; offset += 64 * 1024) {
      windowsWriteRetainedChunk(
        fileHandle, expected.subarray(offset, offset + 64 * 1024), 'Sealed execution file'
      );
    }
    const current = windowsRetainedLeafIdentity(fileHandle, finalPath, 'file', 'Sealed execution file readback');
    if (created.device !== current.device || created.inode !== current.inode
        || !sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'Sealed execution file parent readback'))) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Sealed execution file identity changed during publication.');
    }
  } finally {
    try {
      if (fileHandle !== null) closeWindowsHandle(fileHandle);
    } finally {
      closeWindowsHandle(parentHandle);
    }
  }
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
  /**
   * Opt-in permission source for rollback snapshots.  The physical owner reads
   * the mode from this issued, retained file capability; callers cannot turn
   * a numeric DTO into permission authority.
   */
  readonly permissionSource?: RetainedNoFollowOrdinaryFile;
  /**
   * Opt-in ordinary POSIX creation mode for a newly-materialized file whose
   * mode is itself part of an authenticated source format (for example Git
   * 100644/100755). Special bits remain capability-derived only.
   */
  readonly permissionMode?: number;
}): DurableCanonicalFilePublicationReceipt {
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
  if (input.permissionMode !== undefined && input.permissionSource !== undefined) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      'Durable publication cannot combine an explicit mode with a retained permission source.'
    );
  }
  const requestedPermissionMode = input.permissionMode;
  const explicitPermissionMode = requestedPermissionMode === undefined
    ? null
    : (() => {
        if (!Number.isSafeInteger(requestedPermissionMode)
            || requestedPermissionMode < 0 || requestedPermissionMode > 0o777) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
            'Durable publication explicit mode must contain ordinary POSIX permission bits only.'
          );
        }
        return requestedPermissionMode;
      })();
  const permissionMetadata = input.permissionSource === undefined
    ? undefined
    : (() => {
        assertRetainedNoFollowCapability(
          input.permissionSource,
          'ordinary-file',
          'Durable publication permission source'
        );
        input.permissionSource.assertCurrent();
        if (!Buffer.from(input.permissionSource.readBytes()).equals(expected)) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
            'Durable publication permission source bytes differ from the canonical input.'
          );
        }
        const metadata = retainedNoFollowOrdinaryFilePosixMetadataForInternal(input.permissionSource);
        if (metadata === undefined) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
            'Durable publication permission source has no owner-issued mode projection.'
          );
        }
        input.permissionSource.assertCurrent();
        return metadata;
      })();
  const assertPermissionSourceCurrent = (): void => {
    input.permissionSource?.assertCurrent();
  };
  const permissionModeForTarget = (
    targetMetadata: RetainedNoFollowPosixMetadataForInternal,
    label: string
  ): number | null => {
    if (explicitPermissionMode !== null) {
      return process.platform === 'linux' ? explicitPermissionMode : null;
    }
    if (permissionMetadata === undefined || permissionMetadata.mode === null) return null;
    if ((permissionMetadata.mode & 0o7000) !== 0) {
      const effectiveUserId = typeof process.geteuid === 'function'
        ? BigInt(process.geteuid())
        : null;
      if (effectiveUserId === null || permissionMetadata.ownerUserId !== effectiveUserId ||
          targetMetadata.ownerUserId !== effectiveUserId ||
          permissionMetadata.ownerGroupId !== targetMetadata.ownerGroupId) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
          `${label} cannot preserve special permission bits without same-owner source and target descriptors.`
        );
      }
    }
    return permissionMetadata.mode;
  };

  const existing = (): DurableCanonicalFilePublicationReceipt => {
    let current: ReturnType<typeof inspectNoFollowOrdinaryFileEntry>;
    try {
      current = inspectNoFollowOrdinaryFileEntry(parent, input.name, {
        maximumBytes: expected.byteLength
      });
    } catch (error) {
      if (error instanceof PhysicalNoFollowError &&
          error.code === 'PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED') {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT',
          'Durable publication target exceeds the canonical byte length.',
          error
        );
      }
      throw error;
    }
    if (current === null || current.bytes === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', 'Durable publication target disappeared before no-follow readback.');
    if (!Buffer.from(current.bytes).equals(expected)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT', 'Durable publication target conflicts with canonical bytes.');
    }
    if (permissionMetadata !== undefined || explicitPermissionMode !== null) {
      const chain = inspectNoFollowDirectoryChain(parent.path, 'Durable publication existing parent');
      const retainedCurrent = retainNoFollowOrdinaryFile(
        chain,
        input.name,
        { device: current.device, inode: current.inode },
        'Durable publication existing target'
      );
      try {
        retainedCurrent.assertCurrent();
        const currentMetadata = retainedNoFollowOrdinaryFilePosixMetadataForInternal(retainedCurrent);
        if (currentMetadata === undefined ||
            currentMetadata.mode !== permissionModeForTarget(currentMetadata, 'Durable publication target')) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
            'Durable publication target conflicts with the retained source permission mode.'
          );
        }
      } finally {
        retainedCurrent.dispose();
      }
    }
    validateCanonicalBytes(current.bytes, 'Durable publication target');
    assertPermissionSourceCurrent();
    // An already-present byte-identical file is not a proof that a previous
    // publication reached the required parent-directory durability boundary.
    syncDirectory(parent);
    assertSameNoFollowDirectoryIdentity(parent, 'Durable publication parent');
    return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
      path: finalPath, digest: expectedDigest, created: false,
      physical: Object.freeze({ device: current.device, inode: current.inode })
    }));
  };

  if (process.platform === 'linux') {
    const retained = linuxRetainedPublicationParent(parent, 'Exclusive durable publication');
    const temporaryName = `.${input.name}.${randomUUID()}.candidate`;
    let candidateFd: number | null = null;
    let candidatePhysical: Readonly<{ device: string; inode: string }> | null = null;
    let candidateCreated = false;
    try {
      candidateFd = linuxCreateCandidateAt(retained.parentFd, temporaryName, expected, 'Exclusive durable publication');
      candidateCreated = true;
      let candidateStat = fstatSync(candidateFd, { bigint: true });
      if (permissionMetadata !== undefined || explicitPermissionMode !== null) {
        if (explicitPermissionMode === null && permissionMetadata?.mode === null) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
            'Exclusive durable publication has no Linux permission projection.'
          );
        }
        const targetMode = permissionModeForTarget(Object.freeze({
          mode: Number(candidateStat.mode & 0o7777n),
          ownerGroupId: candidateStat.gid,
          ownerUserId: candidateStat.uid
        }), 'Exclusive durable publication candidate');
        if (targetMode === null) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
            'Exclusive durable publication could not derive one Linux permission mode.'
          );
        }
        fchmodSync(candidateFd, targetMode);
        fsyncSync(candidateFd);
        candidateStat = fstatSync(candidateFd, { bigint: true });
        if (Number(candidateStat.mode & 0o7777n) !== targetMode) {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
            'Exclusive durable publication candidate permission readback differs.'
          );
        }
      }
      candidatePhysical = Object.freeze({ device: String(candidateStat.dev), inode: String(candidateStat.ino) });
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
      const current = readNoFollowOrdinaryFile(parent, input.name, {
        maximumBytes: expected.byteLength
      });
      if (current === null || !Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication retained readback differs.');
      const currentIdentity = inspectNoFollowOrdinaryFileEntry(parent, input.name, {
        maximumBytes: expected.byteLength
      });
      if (currentIdentity === null || candidatePhysical === null ||
          currentIdentity.device !== candidatePhysical.device || currentIdentity.inode !== candidatePhysical.inode) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Exclusive durable publication retained identity readback differs.');
      }
      if (permissionMetadata !== undefined || explicitPermissionMode !== null) {
        const publishedStat = fstatSync(candidateFd, { bigint: true });
        const targetMode = permissionModeForTarget(Object.freeze({
          mode: Number(publishedStat.mode & 0o7777n),
          ownerGroupId: publishedStat.gid,
          ownerUserId: publishedStat.uid
        }), 'Exclusive durable publication readback');
        if (Number(publishedStat.mode & 0o7777n) !== targetMode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication permission readback differs.');
        }
      }
      validateCanonicalBytes(current, 'Exclusive durable publication retained readback');
      assertPermissionSourceCurrent();
      if (candidatePhysical === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Exclusive durable publication lost candidate identity.');
      return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
        path: finalPath, digest: expectedDigest, created: true, physical: candidatePhysical
      }));
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
      let current: Uint8Array | null;
      try {
        current = windowsReadRelativeOrdinaryLeaf(
          parentHandle, parent, input.name, 'Exclusive durable publication existing', expected.byteLength
        );
      } catch (readError) {
        if (readError instanceof PhysicalNoFollowError &&
            readError.code === 'PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED') {
          throw physicalError(
            'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT',
            'Durable publication target exceeds the canonical byte length.',
            readError
          );
        }
        throw readError;
      }
      if (current === null) throw error;
      if (!Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT', 'Durable publication target conflicts with canonical bytes.', error);
      validateCanonicalBytes(current, 'Durable publication target');
      const existingIdentity = windowsOpenDurableReplacementLeaf(
        parentHandle, parent, input.name, 'Exclusive durable publication existing identity',
        WINDOWS_SHARE_READ_WRITE_DELETE, expected.byteLength
      );
      if (existingIdentity === null) throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', 'Durable publication existing target disappeared.');
      try {
        windowsReadRenamedCandidate(
          existingIdentity.handle, parentHandle, parent, input.name, expected,
          'Exclusive durable publication existing target', expected.byteLength
        );
        assertPermissionSourceCurrent();
        return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
          path: finalPath, digest: expectedDigest, created: false, physical: existingIdentity.identity
        }));
      } finally { closeWindowsHandle(existingIdentity.handle); }
    }
    const current = windowsReadRenamedCandidate(
      candidate, parentHandle, parent, input.name, expected,
      'Exclusive durable publication', expected.byteLength
    );
    validateCanonicalBytes(current, 'Exclusive durable publication retained readback');
    assertPermissionSourceCurrent();
    return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
      path: finalPath, digest: expectedDigest, created: true, physical: candidateIdentity
    }));
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
  /** Owner-issued interruption seam for native recovery tests only. */
  readonly windowsInterruptionActor?: WindowsDurableCanonicalFileReplacementInterruptionActor;
};

const windowsDurableReplacementInterruptionActors = new WeakMap<
  object,
  { point: WindowsDurableCanonicalFileReplacementInterruptionPoint; used: boolean; beforeInterrupt?: () => void }
>();

export function createWindowsDurableCanonicalFileReplacementInterruptionActorForTests(
  point: WindowsDurableCanonicalFileReplacementInterruptionPoint,
  beforeInterrupt?: () => void
): WindowsDurableCanonicalFileReplacementInterruptionActor {
  const actor = Object.freeze({ point });
  windowsDurableReplacementInterruptionActors.set(actor, { point, used: false, ...(beforeInterrupt ? { beforeInterrupt } : {}) });
  return actor;
}

function interruptWindowsDurableReplacementForTests(
  actor: WindowsDurableCanonicalFileReplacementInterruptionActor | undefined,
  point: WindowsDurableCanonicalFileReplacementInterruptionPoint
): void {
  if (actor === undefined) return;
  const record = windowsDurableReplacementInterruptionActors.get(actor);
  if (record === undefined || record.used) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Durable CAS interruption actor was not issued for this point.');
  }
  if (record.point !== point) return;
  record.used = true;
  record.beforeInterrupt?.();
  throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Durable CAS interrupted at ${point}.`);
}

type WindowsDurableCanonicalFileReplacementRecord = Readonly<{
  schema: 'sec-windows-durable-canonical-file-replacement-v1';
  targetName: string;
  parent: Readonly<{ device: string; inode: string; objectId: string }>;
  expectedExisting: Readonly<{ device: string; inode: string }>;
  candidateIdentity: Readonly<{ device: string; inode: string }>;
  candidateDigest: string;
  candidateName: string;
  quarantineName: string;
  transactionIdentity: string;
  recordDigest: string;
}>;

function windowsDurableReplacementAnchorName(name: string): string {
  return `.sec-cas-${createHash('sha256').update(name).digest('hex').slice(0, 32)}.txn`;
}

function windowsWindowsDurableCanonicalFileReplacementRecordUnsigned(
  record: Omit<WindowsDurableCanonicalFileReplacementRecord, 'recordDigest'>
): object {
  return Object.freeze({
    schema: record.schema,
    targetName: record.targetName,
    parent: record.parent,
    expectedExisting: record.expectedExisting,
    candidateIdentity: record.candidateIdentity,
    candidateDigest: record.candidateDigest,
    candidateName: record.candidateName,
    quarantineName: record.quarantineName,
    transactionIdentity: record.transactionIdentity
  });
}

function windowsCreateWindowsDurableCanonicalFileReplacementRecord(
  parent: PhysicalDirectoryIdentity,
  name: string,
  expectedExisting: Readonly<{ device: string; inode: string }>,
  candidateDigest: string,
  candidateIdentity: Readonly<{ device: string; inode: string }>
): WindowsDurableCanonicalFileReplacementRecord {
  const candidateName = windowsDurableReplacementCandidateName(parent, name, expectedExisting, candidateDigest);
  const transactionIdentity = bytesDigest(Buffer.from(JSON.stringify({
    schema: 'sec-windows-durable-canonical-file-replacement-identity-v1',
    targetName: name,
    parent: { device: parent.device, inode: parent.inode, objectId: parent.objectId },
    expectedExisting,
    candidateIdentity,
    candidateDigest
  }), 'utf8'));
  const unsigned = Object.freeze({
    schema: 'sec-windows-durable-canonical-file-replacement-v1' as const,
    targetName: name,
    parent: Object.freeze({ device: parent.device, inode: parent.inode, objectId: parent.objectId }),
    expectedExisting: Object.freeze({ ...expectedExisting }),
    candidateIdentity: Object.freeze({ ...candidateIdentity }),
    candidateDigest,
    candidateName,
    quarantineName: `.sec-cas-${transactionIdentity.slice('sha256:'.length, 'sha256:'.length + 32)}.old`,
    transactionIdentity
  });
  return Object.freeze({
    ...unsigned,
    recordDigest: bytesDigest(Buffer.from(JSON.stringify(windowsWindowsDurableCanonicalFileReplacementRecordUnsigned(unsigned)), 'utf8'))
  });
}

function windowsDurableReplacementCandidateName(
  parent: PhysicalDirectoryIdentity,
  name: string,
  expectedExisting: Readonly<{ device: string; inode: string }>,
  candidateDigest: string
): string {
  const candidateNameKey = createHash('sha256').update(JSON.stringify({
    schema: 'sec-windows-durable-canonical-file-replacement-candidate-v1',
    targetName: name,
    parent: { device: parent.device, inode: parent.inode, objectId: parent.objectId },
    expectedExisting,
    candidateDigest
  })).digest('hex').slice(0, 32);
  return `.sec-cas-${candidateNameKey}.new`;
}

function windowsParseWindowsDurableCanonicalFileReplacementRecord(
  bytes: Uint8Array,
  parent: PhysicalDirectoryIdentity,
  targetName: string
): WindowsDurableCanonicalFileReplacementRecord {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (error) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS transaction record JSON is invalid.', error);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS transaction record shape is invalid.');
  }
  const record = value as WindowsDurableCanonicalFileReplacementRecord;
  const exactKeys = (candidate: object, keys: readonly string[]): boolean =>
    JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify([...keys].sort());
  if (!exactKeys(record, [
    'schema', 'targetName', 'parent', 'expectedExisting', 'candidateIdentity', 'candidateDigest',
    'candidateName', 'quarantineName', 'transactionIdentity', 'recordDigest'
  ]) || record.schema !== 'sec-windows-durable-canonical-file-replacement-v1' ||
      record.targetName !== targetName || record.parent === null || typeof record.parent !== 'object' ||
      record.expectedExisting === null || typeof record.expectedExisting !== 'object' ||
      record.candidateIdentity === null || typeof record.candidateIdentity !== 'object' ||
      !exactKeys(record.parent, ['device', 'inode', 'objectId']) ||
      !exactKeys(record.expectedExisting, ['device', 'inode']) ||
      !exactKeys(record.candidateIdentity, ['device', 'inode']) ||
      record.parent.device !== parent.device || record.parent.inode !== parent.inode ||
      record.parent.objectId !== parent.objectId ||
      !/^sha256:[0-9a-f]{64}$/u.test(record.candidateDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(record.transactionIdentity) ||
      !/^sha256:[0-9a-f]{64}$/u.test(record.recordDigest)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS transaction record binding is invalid.');
  }
  ensureLeafName(record.candidateName);
  ensureLeafName(record.quarantineName);
  const expected = windowsCreateWindowsDurableCanonicalFileReplacementRecord(
    parent, targetName, record.expectedExisting, record.candidateDigest, record.candidateIdentity
  );
  if (JSON.stringify(record) !== JSON.stringify(expected)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS transaction record digest or derived names differ.');
  }
  return expected;
}

type WindowsDurableReplacementLeaf = Readonly<{
  handle: bigint;
  path: string;
  identity: Readonly<{ device: string; inode: string }>;
  bytes: Uint8Array;
}>;

function windowsOpenDurableReplacementLeaf(
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  label: string,
  shareAccess = WINDOWS_SHARE_READ_WRITE_DELETE,
  maximumBytes?: number
): WindowsDurableReplacementLeaf | null {
  const absolutePath = path.join(parent.path, name);
  const handle = windowsOpenRelativeLeaf(
    parentHandle, parent, name, absolutePath,
    WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
    WINDOWS_FILE_OPEN, label, true, shareAccess
  );
  if (handle === null) return null;
  try {
    return Object.freeze({
      handle,
      path: absolutePath,
      identity: windowsRetainedLeafIdentity(handle, absolutePath, 'file', label),
      bytes: readWindowsRetainedFile(handle, label, maximumBytes)
    });
  } catch (error) {
    closeWindowsHandle(handle);
    throw error;
  }
}

function windowsDeleteDurableReplacementLeaf(
  leaf: WindowsDurableReplacementLeaf | null,
  parentHandle: bigint,
  parent: PhysicalDirectoryIdentity,
  name: string,
  label: string
): void {
  if (leaf === null) return;
  windowsMarkRetainedLeafForDelete(leaf.handle, label);
  closeWindowsHandle(leaf.handle);
  if (windowsReadRelativeOrdinaryLeaf(parentHandle, parent, name, `${label} readback`) !== null) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `${label} remains present.`);
  }
}

/**
 * Settles the one fixed Windows replacement transaction slot for `name`.
 * Callers that may interpret an absent canonical leaf must call this first.
 * A quarantined preimage is restored before `rolled-back` is returned; a
 * byte-proven installed candidate is completed before `completed` is returned.
 */
export function recoverDurableCanonicalFileReplacement(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
}>): DurableCanonicalFileReplacementRecovery {
  ensureLeafName(input.name);
  if (process.platform !== 'win32') return Object.freeze({ status: 'none', digest: null, physical: null });
  const parent = assertSameNoFollowDirectoryIdentity(input.parent, 'Durable CAS recovery parent').target;
  const parentHandle = windowsRetainedPublicationParent(parent, 'Durable CAS recovery');
  const anchorName = windowsDurableReplacementAnchorName(input.name);
  let anchor: WindowsDurableReplacementLeaf | null = null;
  let candidate: WindowsDurableReplacementLeaf | null = null;
  let quarantine: WindowsDurableReplacementLeaf | null = null;
  let current: WindowsDurableReplacementLeaf | null = null;
  try {
    // SHARE_READ is the transaction mutex: another live writer holding the
    // anchor makes this open fail rather than allowing concurrent recovery.
    anchor = windowsOpenDurableReplacementLeaf(
      parentHandle, parent, anchorName, 'Durable CAS recovery transaction', WINDOWS_SHARE_READ
    );
    if (anchor === null) return Object.freeze({ status: 'none', digest: null, physical: null });
    const record = windowsParseWindowsDurableCanonicalFileReplacementRecord(anchor.bytes, parent, input.name);
    candidate = windowsOpenDurableReplacementLeaf(parentHandle, parent, record.candidateName, 'Durable CAS recovery candidate');
    quarantine = windowsOpenDurableReplacementLeaf(parentHandle, parent, record.quarantineName, 'Durable CAS recovery quarantine');
    current = windowsOpenDurableReplacementLeaf(parentHandle, parent, input.name, 'Durable CAS recovery current');
    if (candidate !== null && (bytesDigest(candidate.bytes) !== record.candidateDigest ||
        candidate.identity.device !== record.candidateIdentity.device ||
        candidate.identity.inode !== record.candidateIdentity.inode)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable CAS recovery candidate identity or bytes changed.');
    }
    if (quarantine !== null && (quarantine.identity.device !== record.expectedExisting.device ||
        quarantine.identity.inode !== record.expectedExisting.inode)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable CAS recovery quarantine identity changed.');
    }
    const currentIsPreimage = current !== null && current.identity.device === record.expectedExisting.device &&
      current.identity.inode === record.expectedExisting.inode;
    const currentIsCandidate = current !== null && bytesDigest(current.bytes) === record.candidateDigest &&
      current.identity.device === record.candidateIdentity.device &&
      current.identity.inode === record.candidateIdentity.inode;
    if (currentIsCandidate) {
      windowsDeleteDurableReplacementLeaf(candidate, parentHandle, parent, record.candidateName, 'Durable CAS recovery candidate cleanup');
      candidate = null;
      windowsDeleteDurableReplacementLeaf(quarantine, parentHandle, parent, record.quarantineName, 'Durable CAS recovery quarantine cleanup');
      quarantine = null;
      windowsDeleteDurableReplacementLeaf(anchor, parentHandle, parent, anchorName, 'Durable CAS recovery transaction cleanup');
      anchor = null;
      return Object.freeze({
        status: 'completed', digest: record.candidateDigest, physical: record.candidateIdentity
      });
    }
    if (currentIsPreimage) {
      if (quarantine !== null) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable CAS recovery found the preimage at two transaction names.');
      }
      windowsDeleteDurableReplacementLeaf(candidate, parentHandle, parent, record.candidateName, 'Durable CAS recovery candidate rollback');
      candidate = null;
      windowsDeleteDurableReplacementLeaf(anchor, parentHandle, parent, anchorName, 'Durable CAS recovery transaction rollback');
      anchor = null;
      return Object.freeze({ status: 'rolled-back', digest: null, physical: null });
    }
    if (current === null && quarantine !== null) {
      windowsRenameRetainedOrdinaryFile(
        quarantine.handle, quarantine.path, quarantine.identity, parentHandle, input.name, false,
        'Durable CAS recovery preimage restore'
      );
      const restored = windowsReadRenamedCandidate(
        quarantine.handle, parentHandle, parent, input.name, Buffer.from(quarantine.bytes),
        'Durable CAS recovery preimage restore'
      );
      if (bytesDigest(restored) !== bytesDigest(quarantine.bytes)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS recovery restored preimage bytes differ.');
      }
      closeWindowsHandle(quarantine.handle);
      quarantine = null;
      windowsDeleteDurableReplacementLeaf(candidate, parentHandle, parent, record.candidateName, 'Durable CAS recovery candidate rollback');
      candidate = null;
      windowsDeleteDurableReplacementLeaf(anchor, parentHandle, parent, anchorName, 'Durable CAS recovery transaction rollback');
      anchor = null;
      return Object.freeze({ status: 'rolled-back', digest: null, physical: null });
    }
    throw physicalError(
      current === null ? 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED' : 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
      current === null
        ? 'Durable CAS recovery cannot explain an absent canonical leaf without its exact quarantined preimage.'
        : 'Durable CAS recovery canonical identity belongs to another writer.'
    );
  } finally {
    if (current !== null) closeWindowsHandle(current.handle);
    if (quarantine !== null) closeWindowsHandle(quarantine.handle);
    if (candidate !== null) closeWindowsHandle(candidate.handle);
    if (anchor !== null) closeWindowsHandle(anchor.handle);
    closeWindowsHandle(parentHandle);
  }
}

function replaceDurableCanonicalFileWithExpectedIdentity(
  input: DurableCanonicalFileReplacementInput
): DurableCanonicalFileIdentityReceipt {
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
    return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
      path: published.path, digest: published.digest, physical: published.physical
    }));
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
    let candidatePhysical: Readonly<{ device: string; inode: string }> | null = null;
    let exchanged = false;
    try {
      candidateFd = linuxCreateCandidateAt(retained.parentFd, temporaryName, expected, 'Durable CAS');
      const candidateStat = fstatSync(candidateFd, { bigint: true });
      candidatePhysical = Object.freeze({ device: String(candidateStat.dev), inode: String(candidateStat.ino) });
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
      if (candidatePhysical === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable pointer CAS lost candidate identity.');
      return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
        path: finalPath, digest: bytesDigest(expected), physical: candidatePhysical
      }));
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
  const recovered = recoverDurableCanonicalFileReplacement({ parent, name: input.name });
  if (recovered.status === 'completed') {
    if (recovered.digest !== bytesDigest(expected)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable pointer CAS recovered another completed transaction.');
    }
    const current = readNoFollowOrdinaryFile(parent, input.name);
    if (current === null || !Buffer.from(current).equals(expected)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable pointer CAS recovered final readback differs.');
    }
    input.validate(current);
    if (recovered.physical === null) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable pointer CAS recovered no final identity.');
    }
    return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
      path: finalPath, digest: recovered.digest, physical: recovered.physical
    }));
  }
  const parentHandle = windowsRetainedPublicationParent(parent, 'Durable CAS');
  const candidateDigest = bytesDigest(expected);
  const candidateName = windowsDurableReplacementCandidateName(parent, input.name, expectedCurrent, candidateDigest);
  const anchorName = windowsDurableReplacementAnchorName(input.name);
  const anchorPath = path.join(parent.path, anchorName);
  const candidatePath = path.join(parent.path, candidateName);
  let candidate: bigint | null = null;
  let oldCurrent: bigint | null = null;
  let anchor: bigint | null = null;
  let record: WindowsDurableCanonicalFileReplacementRecord | null = null;
  try {
    // Retain and validate the expected preimage before publishing the
    // transaction record.  The handle-level rename below rechecks that this
    // exact object still owns the canonical name immediately before Effect.
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
    const staleCandidate = windowsOpenDurableReplacementLeaf(
      parentHandle, parent, candidateName, 'Durable CAS unbound candidate', WINDOWS_SHARE_READ
    );
    if (staleCandidate !== null) {
      if (bytesDigest(staleCandidate.bytes) !== candidateDigest) {
        closeWindowsHandle(staleCandidate.handle);
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable CAS unbound candidate bytes differ.');
      }
      windowsDeleteDurableReplacementLeaf(
        staleCandidate, parentHandle, parent, candidateName, 'Durable CAS unbound candidate cleanup'
      );
    }
    candidate = windowsOpenRelativeLeaf(
      parentHandle, parent, candidateName, candidatePath,
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
      WINDOWS_FILE_CREATE, 'Durable CAS candidate', false, WINDOWS_SHARE_READ, true
    );
    if (candidate === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS candidate unexpectedly absent.');
    const candidateIdentity = windowsRetainedLeafIdentity(candidate, candidatePath, 'file', 'Durable CAS candidate');
    windowsWriteRetainedFile(candidate, expected, 'Durable CAS candidate');
    record = windowsCreateWindowsDurableCanonicalFileReplacementRecord(
      parent, input.name, expectedCurrent, candidateDigest, candidateIdentity
    );
    anchor = windowsOpenRelativeLeaf(
      parentHandle, parent, anchorName, anchorPath,
      WINDOWS_GENERIC_READ + WINDOWS_GENERIC_WRITE + WINDOWS_DELETE + WINDOWS_FILE_WRITE_ATTRIBUTES,
      WINDOWS_FILE_CREATE, 'Durable CAS transaction', false, WINDOWS_SHARE_READ, true
    );
    if (anchor === null) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Durable CAS transaction slot became occupied.');
    }
    windowsWriteRetainedFile(anchor, Buffer.from(JSON.stringify(record), 'utf8'), 'Durable CAS transaction');
    interruptWindowsDurableReplacementForTests(input.windowsInterruptionActor, 'after-transaction-record');
    windowsRenameRetainedOrdinaryFile(
      oldCurrent, finalPath, expectedCurrent, parentHandle, record.quarantineName, false, 'Durable CAS old current'
    );
    interruptWindowsDurableReplacementForTests(input.windowsInterruptionActor, 'after-preimage-quarantine');
    windowsRenameRetainedOrdinaryFile(
      candidate, candidatePath, candidateIdentity, parentHandle, input.name, false, 'Durable CAS publication'
    );
    interruptWindowsDurableReplacementForTests(input.windowsInterruptionActor, 'after-candidate-publication');
    const current = windowsReadRenamedCandidate(candidate, parentHandle, parent, input.name, expected, 'Durable CAS');
    input.validate(current);
    windowsMarkRetainedLeafForDelete(oldCurrent, 'Durable CAS old current cleanup');
    closeWindowsHandle(oldCurrent);
    oldCurrent = null;
    const oldReadback = windowsReadRelativeOrdinaryLeaf(parentHandle, parent, record.quarantineName, 'Durable CAS old current cleanup readback');
    if (oldReadback !== null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS old current residue remains.');
    windowsMarkRetainedLeafForDelete(anchor, 'Durable CAS transaction cleanup');
    closeWindowsHandle(anchor);
    anchor = null;
    if (windowsReadRelativeOrdinaryLeaf(parentHandle, parent, anchorName, 'Durable CAS transaction cleanup readback') !== null) {
      throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable CAS transaction residue remains.');
    }
    return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
      path: finalPath, digest: candidateDigest, physical: candidateIdentity
    }));
  } finally {
    // An interrupted transaction deliberately preserves its anchor and exact
    // candidate/quarantine names.  The next acquisition must call the
    // recovery entry above; deleting either side here would recreate the
    // unrecoverable missing-canonical window this protocol exists to close.
    if (oldCurrent !== null) closeWindowsHandle(oldCurrent);
    if (candidate !== null) closeWindowsHandle(candidate);
    if (anchor !== null) closeWindowsHandle(anchor);
    closeWindowsHandle(parentHandle);
  }
}

export function replaceDurableCanonicalFile(input: DurableCanonicalFileReplacementInput): DurableCanonicalFileIdentityReceipt {
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
    let candidatePhysical: Readonly<{ device: string; inode: string }> | null = null;
    try {
      candidateFd = linuxCreateCandidateAt(retained.parentFd, temporaryName, expected, 'Durable replacement');
      const candidateStat = fstatSync(candidateFd, { bigint: true });
      candidatePhysical = Object.freeze({ device: String(candidateStat.dev), inode: String(candidateStat.ino) });
      closeSync(candidateFd); candidateFd = null;
      if (requireLinuxLibc().symbols.renameat(
        retained.parentFd, Buffer.from(`${temporaryName}\0`, 'utf8'),
        retained.parentFd, Buffer.from(`${input.name}\0`, 'utf8')
      ) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Durable replacement renameat failed (errno ${linuxErrno()}).`);
      if (requireLinuxLibc().symbols.fsync(retained.parentFd) !== 0) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable replacement parent fsync failed.');
      const current = readNoFollowOrdinaryFile(parent, input.name);
      if (current === null || !Buffer.from(current).equals(expected)) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable replacement retained readback differs.');
      input.validate(current);
      if (candidatePhysical === null) throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Durable replacement lost candidate identity.');
      return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
        path: finalPath, digest: bytesDigest(expected), physical: candidatePhysical
      }));
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
    return issueDurableCanonicalFileIdentityReceipt(Object.freeze({
      path: finalPath, digest: bytesDigest(expected), physical: candidateIdentity
    }));
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
