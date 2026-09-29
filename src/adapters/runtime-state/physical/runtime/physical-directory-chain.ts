import { closeSync } from 'node:fs';
import path from 'node:path';
import { issueRetainedNoFollowCapability } from './physical-no-follow-authority.ts';
import type { ExactNoFollowDirectoryPresence, LinuxNoFollowDirectoryCreateRaceActor, NoFollowDirectoryCreateTestActor, PhysicalDirectoryChain, PhysicalDirectoryIdentity, RetainedNoFollowChildProcessDirectory } from './physical-no-follow-contract.ts';
import { PhysicalNoFollowError } from './physical-no-follow-contract.ts';
import {
  WINDOWS_FILE_CREATE,
  WINDOWS_FILE_OPEN,
  closeLinuxDescriptorsBestEffort,
  closeWindowsHandle,
  closeWindowsHandlesBestEffort,
  inspectLinuxDirectoryChain,
  inspectWindowsDirectoryChain,
  isLinuxNoFollowDirectoryCreateRaceActorForTests,
  linuxAdvanceDirectoryCreateTransaction,
  linuxAssertDirectoryCreateWitness,
  linuxCloseDirectoryCreateTransaction,
  linuxDirectoryCreateTransactionWitness,
  linuxIdentity,
  linuxOpenAt,
  linuxOpenOrCreateDirectoryAt,
  linuxOpenRoot,
  linuxOpenWatchedCanonicalDirectoryChain,
  linuxRaiseDescriptorFloor,
  linuxReadDirectoryMutationEvents,
  windowsFlushRetainedDirectory,
  windowsIdentity,
  windowsOpenDirectory,
  windowsOpenPinnedReadDirectory,
  windowsOpenRelativeDirectory
} from './physical-no-follow-native.ts';
import { absent, ensureOrdinaryDirectorySegment, physicalError, requireAbsoluteDirectoryPath, sameIdentity } from './physical-no-follow-shared.ts';

/** Physical directory-chain observation and containment. No lifecycle or copy policy lives here. */

export function samePhysicalObject(
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


const noFollowDirectoryCreateTestActors = new WeakSet<object>();

function createNoFollowDirectoryChainInternal(
  root: PhysicalDirectoryIdentity,
  segments: readonly string[],
  testOnlyRaceActor: LinuxNoFollowDirectoryCreateRaceActor | undefined,
  testOnlyCreateActor: NoFollowDirectoryCreateTestActor | undefined,
  creationMode: number
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
          creationMode,
          label: 'No-follow directory creation target',
          testOnlyRaceActor,
          testOnlyCreateActor
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
      let created = false;
      let parentBarrierRequired = false;
      try {
        if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'No-follow directory creation parent'))) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation parent changed before relative create.');
        }
        nextHandle = windowsOpenRelativeDirectory(
          parentHandle, parent, segment, nextPath, WINDOWS_FILE_OPEN, 'No-follow directory creation target'
        );
        if (nextHandle === null) {
          testOnlyCreateActor?.beforeCreate?.({ parentPath: parent.path, targetPath: nextPath });
          if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'No-follow directory creation parent'))) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation parent changed after before-create actor.');
          }
          nextHandle = windowsOpenRelativeDirectory(
            parentHandle, parent, segment, nextPath, WINDOWS_FILE_CREATE, 'No-follow directory creation target'
          );
          if (nextHandle === null) {
            if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'No-follow directory creation parent'))) {
              throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation parent changed after competing create.');
            }
            nextHandle = windowsOpenRelativeDirectory(
              parentHandle, parent, segment, nextPath, WINDOWS_FILE_OPEN, 'No-follow directory creation competing target'
            );
            if (nextHandle === null) {
              throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation target disappeared after competing create.');
            }
          } else {
            created = true;
          }
          parentBarrierRequired = true;
        }
        current = windowsIdentity(nextHandle, nextPath, 'No-follow directory creation target');
        if (parentBarrierRequired) {
          if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'No-follow directory creation parent'))) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation parent changed before parent barrier.');
          }
          if (created) {
            testOnlyCreateActor?.beforeParentBarrier?.({ parentPath: parent.path, createdPath: nextPath });
          }
          if (!sameIdentity(parent, windowsIdentity(parentHandle, parent.path, 'No-follow directory creation parent'))
              || !sameIdentity(current, windowsIdentity(nextHandle, nextPath, 'No-follow directory creation target'))) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation identity changed after before-parent-barrier actor.');
          }
          windowsFlushRetainedDirectory(parentHandle, parent, 'No-follow directory creation parent');
          if (!sameIdentity(current, windowsIdentity(nextHandle, nextPath, 'No-follow directory creation target'))) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow directory creation target changed after parent barrier.');
          }
          if (created) {
            testOnlyCreateActor?.durabilityObserver?.({ parentPath: parent.path, createdPath: nextPath });
          }
        }
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
  testOnlyActor?: LinuxNoFollowDirectoryCreateRaceActor | NoFollowDirectoryCreateTestActor
): PhysicalDirectoryIdentity {
  for (const segment of segments) {
    if (segment !== '.tmp' && !/^[a-z0-9-]+$/u.test(segment)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'No-follow directory creation segment is invalid.');
    }
  }
  const testOnlyRaceActor = testOnlyActor !== undefined && isLinuxNoFollowDirectoryCreateRaceActorForTests(testOnlyActor)
    ? testOnlyActor as LinuxNoFollowDirectoryCreateRaceActor
    : undefined;
  const testOnlyCreateActor = testOnlyActor !== undefined && noFollowDirectoryCreateTestActors.has(testOnlyActor)
    ? testOnlyActor as NoFollowDirectoryCreateTestActor
    : undefined;
  if (testOnlyActor !== undefined && testOnlyRaceActor === undefined && testOnlyCreateActor === undefined) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'No-follow directory-create test actor was not issued by Physical.');
  }
  return createNoFollowDirectoryChainInternal(root, segments, testOnlyRaceActor, testOnlyCreateActor, 0o700);
}

export function createNoFollowDirectoryCreateTestActorForTests(
  actor: NoFollowDirectoryCreateTestActor
): NoFollowDirectoryCreateTestActor {
  const issued = Object.freeze({ ...actor });
  noFollowDirectoryCreateTestActors.add(issued);
  return issued;
}

/**
 * Materializes ordinary host path components without following aliases. This
 * is the path-allocation primitive for external runtime roots whose existing
 * parent names are not SEC-controlled lowercase namespace identifiers.
 */
export function createNoFollowOrdinaryDirectoryChain(
  root: PhysicalDirectoryIdentity,
  segments: readonly string[],
  testOnlyActor?: LinuxNoFollowDirectoryCreateRaceActor | NoFollowDirectoryCreateTestActor,
  creationMode = 0o700
): PhysicalDirectoryIdentity {
  for (const segment of segments) ensureOrdinaryDirectorySegment(segment);
  if (!Number.isSafeInteger(creationMode) || creationMode < 0 || creationMode > 0o777) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Ordinary no-follow directory creation mode is invalid.');
  }
  const testOnlyRaceActor = testOnlyActor !== undefined && isLinuxNoFollowDirectoryCreateRaceActorForTests(testOnlyActor)
    ? testOnlyActor as LinuxNoFollowDirectoryCreateRaceActor
    : undefined;
  const testOnlyCreateActor = testOnlyActor !== undefined && noFollowDirectoryCreateTestActors.has(testOnlyActor)
    ? testOnlyActor as NoFollowDirectoryCreateTestActor
    : undefined;
  if (testOnlyActor !== undefined && testOnlyRaceActor === undefined && testOnlyCreateActor === undefined) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Ordinary no-follow directory-create test actor was not issued by Physical.');
  }
  return createNoFollowDirectoryChainInternal(root, segments, testOnlyRaceActor, testOnlyCreateActor, creationMode);
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
    const openedRootFd = linuxOpenRoot(label);
    let rootFd: number;
    try {
      rootFd = linuxRaiseDescriptorFloor(openedRootFd, label);
    } catch (error) {
      closeLinuxDescriptorsBestEffort([openedRootFd], label);
      throw error;
    }
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
    let pendingHandle: bigint | null = null;
    try {
      for (const [index, current] of paths.entries()) {
        const currentLabel = `${label} ancestor[${index}] ${current}`;
        // The child receives an absolute Windows path, so every ancestor in
        // that spelling must remain the retained object for the whole process
        // lifetime.  Pinning only the final two ancestors leaves a deeper
        // junction/reparse replacement able to redirect CreateProcess before
        // the target handle is consulted.
        const handle = windowsOpenPinnedReadDirectory(current, currentLabel);
        pendingHandle = handle;
        const identity = windowsIdentity(handle, current, currentLabel);
        if (!sameIdentity(
          expected.ancestors[index]!,
          identity
        )) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} ancestor identity changed.`);
        }
        handles.push({ handle, identity });
        pendingHandle = null;
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
        [...(pendingHandle === null ? [] : [pendingHandle]), ...[...handles].reverse().map((entry) => entry.handle)],
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
