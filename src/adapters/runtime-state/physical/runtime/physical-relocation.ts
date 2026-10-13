import { createHash } from 'node:crypto';
import { closeSync, fstatSync } from 'node:fs';
import path from 'node:path';

import {
  assertSemanticOperationProjection,
  type BoundSemanticOperation
} from '../../../../execution/operation/semantic.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain
} from './physical-directory-chain.ts';
import {
  linuxRetainBulkDirectoryChain,
  windowsRetainBulkDirectoryChain,
  windowsRetainObservedDirectoryChain,
  type LinuxBulkDirectoryChain,
  type WindowsBulkDirectoryChain
} from './physical-directory-tree-copy.ts';
import { assertRetainedNoFollowProvenDirectoryGeneration } from './physical-no-follow-authority.ts';
import {
  PhysicalNoFollowError,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowProvenDirectoryGeneration,
  type WindowsLegacySealedDirectoryRelocationCapability
} from './physical-no-follow-contract.ts';
import {
  LINUX_RENAME_NOREPLACE,
  WINDOWS_DELETE,
  WINDOWS_FILE_READ_ATTRIBUTES,
  WINDOWS_FILE_WRITE_ATTRIBUTES,
  WINDOWS_GENERIC_READ,
  WINDOWS_GENERIC_WRITE,
  WINDOWS_NT_FILE_RENAME_INFORMATION,
  WINDOWS_NT_FILE_RENAME_INFORMATION_EX,
  WINDOWS_READ_CONTROL,
  WINDOWS_SYNCHRONIZE,
  closeWindowsHandle,
  linuxErrno,
  linuxIdentity,
  linuxOpenAt,
  linuxOpenLeafAt,
  linuxOpenRetainedAbsoluteDirectory,
  linuxReadRetainedLinkTarget,
  requireLinuxLibc,
  requireWindowsNtdll,
  windowsCreateRelativeJunction,
  windowsFlushRetainedDirectory,
  windowsIdentity,
  windowsOpenDirectory,
  windowsOpenNoFollowLeaf,
  windowsOpenRelativeNoFollowEntry,
  windowsReadRetainedJunctionTarget,
  windowsRenameRetainedDirectory,
  windowsRetainedLeafIdentity
} from './physical-no-follow-native.ts';
import {
  assertPhysicalLinkTarget, ensureLeafName,
  normalizePhysicalLinkTarget, physicalError, sameIdentity
} from './physical-no-follow-shared.ts';
import {
  windowsRelocationDescriptorDigest,
  windowsSecurityDescriptorBytes,
  windowsTemporaryRelocationDescriptor,
  windowsWriteSecurityDescriptorBytes
} from './physical-windows-security.ts';

/** Retained directory/link relocation and Windows legacy relocation capability lifecycle. */

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

type WindowsLegacySealedDirectoryRelocationProof = Readonly<{
  schema: 'sec-windows-legacy-sealed-directory-relocation-proof-v1';
  proofDigest: `sha256:${string}`;
  sourcePath: string;
  destinationPath: string;
  operationIdentityDigest: `sha256:${string}`;
  sourcePhysical: Readonly<Pick<PhysicalDirectoryIdentity, 'device' | 'inode' | 'objectId'>>;
  sourceParentPhysical: Readonly<Pick<PhysicalDirectoryIdentity, 'device' | 'inode' | 'objectId'>>;
  destinationParentPhysical: Readonly<Pick<PhysicalDirectoryIdentity, 'device' | 'inode' | 'objectId'>>;
  predecessorDescriptorBase64: string;
  predecessorDescriptorDigest: `sha256:${string}`;
  temporaryDescriptorBase64: string;
  temporaryDescriptorDigest: `sha256:${string}`;
}>;

const windowsLegacyRelocationCapabilities = new WeakMap<
  object,
  Readonly<{
    operation: BoundSemanticOperation;
    proof: WindowsLegacySealedDirectoryRelocationProof;
  }>
>();

function assertWindowsLegacyRelocationOperation(
  operation: BoundSemanticOperation,
  expectedIdentityDigest?: `sha256:${string}`
): void {
  assertSemanticOperationProjection(operation);
  if (operation.plan.attempt.deadlineAtUnixMs <= Date.now() ||
      (expectedIdentityDigest !== undefined &&
        operation.plan.identity.identityDigest !== expectedIdentityDigest)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation operation is expired or foreign.');
  }
  const requirement = operation.plan.execution.requirements.find(
    ({ id }) => id === 'runtime-physical.legacy-relocation'
  );
  if (requirement === undefined || !requirement.effectKinds.includes('filesystem') ||
      !requirement.effectKinds.includes('persistent-state')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation operation has no exact Effect requirement.');
  }
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
    // A directory rename requires DELETE on the source handle, not generic
    // write access to its contents.  Requesting GENERIC_WRITE would make a
    // correctly preserved content-write deny block the namespace-only move.
    const sourceHandle = windowsOpenNoFollowLeaf(
      source.path,
      'Retained cross-parent relocation source',
      WINDOWS_DELETE | WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE
    );
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

function windowsLegacyRelocationProofUnsigned(
  proof: Omit<WindowsLegacySealedDirectoryRelocationProof, 'proofDigest'>
): object {
  return Object.freeze({
    schema: proof.schema,
    sourcePath: proof.sourcePath,
    destinationPath: proof.destinationPath,
    operationIdentityDigest: proof.operationIdentityDigest,
    sourcePhysical: proof.sourcePhysical,
    sourceParentPhysical: proof.sourceParentPhysical,
    destinationParentPhysical: proof.destinationParentPhysical,
    predecessorDescriptorBase64: proof.predecessorDescriptorBase64,
    predecessorDescriptorDigest: proof.predecessorDescriptorDigest,
    temporaryDescriptorBase64: proof.temporaryDescriptorBase64,
    temporaryDescriptorDigest: proof.temporaryDescriptorDigest
  });
}

function parseWindowsLegacyRelocationProof(text: string): WindowsLegacySealedDirectoryRelocationProof {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation proof JSON is invalid.', error);
  }
  const exact = (candidate: object, keys: readonly string[]): boolean =>
    JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify([...keys].sort());
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !exact(value, [
    'schema', 'proofDigest', 'sourcePath', 'destinationPath', 'operationIdentityDigest',
    'sourcePhysical', 'sourceParentPhysical', 'destinationParentPhysical',
    'predecessorDescriptorBase64', 'predecessorDescriptorDigest',
    'temporaryDescriptorBase64', 'temporaryDescriptorDigest'
  ])) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation proof shape is invalid.');
  }
  const proof = value as WindowsLegacySealedDirectoryRelocationProof;
  const physical = (candidate: unknown): candidate is WindowsLegacySealedDirectoryRelocationProof['sourcePhysical'] =>
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) &&
    exact(candidate, ['device', 'inode', 'objectId']) &&
    Object.values(candidate).every((entry) => typeof entry === 'string' && entry.length > 0);
  if (proof.schema !== 'sec-windows-legacy-sealed-directory-relocation-proof-v1' ||
      !path.isAbsolute(proof.sourcePath) || !path.isAbsolute(proof.destinationPath) ||
      !/^sha256:[0-9a-f]{64}$/u.test(proof.operationIdentityDigest) ||
      !physical(proof.sourcePhysical) || !physical(proof.sourceParentPhysical) ||
      !physical(proof.destinationParentPhysical) ||
      !/^sha256:[0-9a-f]{64}$/u.test(proof.proofDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(proof.predecessorDescriptorDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(proof.temporaryDescriptorDigest)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation proof values are invalid.');
  }
  const predecessor = Buffer.from(proof.predecessorDescriptorBase64, 'base64');
  const temporary = Buffer.from(proof.temporaryDescriptorBase64, 'base64');
  if (windowsRelocationDescriptorDigest(predecessor) !== proof.predecessorDescriptorDigest ||
      windowsRelocationDescriptorDigest(temporary) !== proof.temporaryDescriptorDigest ||
      (!predecessor.equals(temporary) &&
        !windowsTemporaryRelocationDescriptor(predecessor).equals(temporary))) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation descriptor proof differs.');
  }
  const digest = `sha256:${createHash('sha256').update(JSON.stringify(
    windowsLegacyRelocationProofUnsigned(proof)
  )).digest('hex')}`;
  if (digest !== proof.proofDigest) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation proof digest differs.');
  }
  return Object.freeze(proof);
}

export function prepareWindowsLegacySealedDirectoryRelocation(input: Readonly<{
  directory: PhysicalDirectoryIdentity;
  destinationParent: PhysicalDirectoryIdentity;
  destinationName: string;
  operation: BoundSemanticOperation;
}>): WindowsLegacySealedDirectoryRelocationCapability {
  if (process.platform !== 'win32') {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation is unavailable on this platform.');
  }
  assertWindowsLegacyRelocationOperation(input.operation);
  ensureLeafName(input.destinationName);
  const source = assertSameNoFollowDirectoryIdentity(input.directory, 'Windows legacy relocation source').target;
  const sourceParent = inspectNoFollowDirectoryChain(
    path.dirname(source.path),
    'Windows legacy relocation source parent'
  ).target;
  const destinationParent = assertSameNoFollowDirectoryIdentity(input.destinationParent, 'Windows legacy relocation destination parent').target;
  const destinationPath = path.join(destinationParent.path, input.destinationName);
  if (inspectExactNoFollowDirectoryPresence(destinationPath, 'Windows legacy relocation destination').state !== 'absent') {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Windows legacy relocation destination is occupied.');
  }
  const predecessor = windowsSecurityDescriptorBytes(source.path);
  let temporary = predecessor;
  let deleteProbe: bigint | null = null;
  try {
    deleteProbe = windowsOpenNoFollowLeaf(
      source.path,
      'Windows legacy relocation delete authority probe',
      WINDOWS_DELETE | WINDOWS_FILE_READ_ATTRIBUTES | WINDOWS_READ_CONTROL | WINDOWS_SYNCHRONIZE
    );
    if (!sameIdentity(
      source,
      windowsIdentity(deleteProbe, source.path, 'Windows legacy relocation delete authority probe')
    )) {
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        'Windows legacy relocation delete authority probe identity differs.'
      );
    }
  } catch (error) {
    if (!(error instanceof PhysicalNoFollowError) ||
        error.nativeFailure?.failureClass !== 'access-denied') {
      throw error;
    }
    // Only the known owner-sealed shape may be narrowed.  If the live token
    // already has DELETE, the predecessor descriptor is itself the least-
    // authority temporary descriptor and no ACL Effect is performed.
    temporary = windowsTemporaryRelocationDescriptor(predecessor);
  } finally {
    if (deleteProbe !== null) closeWindowsHandle(deleteProbe);
  }
  const unsigned = Object.freeze({
    schema: 'sec-windows-legacy-sealed-directory-relocation-proof-v1' as const,
    sourcePath: source.path,
    destinationPath,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    sourcePhysical: Object.freeze({ device: source.device, inode: source.inode, objectId: source.objectId }),
    sourceParentPhysical: Object.freeze({ device: sourceParent.device, inode: sourceParent.inode, objectId: sourceParent.objectId }),
    destinationParentPhysical: Object.freeze({
      device: destinationParent.device,
      inode: destinationParent.inode,
      objectId: destinationParent.objectId
    }),
    predecessorDescriptorBase64: predecessor.toString('base64'),
    predecessorDescriptorDigest: windowsRelocationDescriptorDigest(predecessor),
    temporaryDescriptorBase64: temporary.toString('base64'),
    temporaryDescriptorDigest: windowsRelocationDescriptorDigest(temporary)
  });
  const proof = Object.freeze({
    ...unsigned,
    proofDigest: `sha256:${createHash('sha256').update(JSON.stringify(
      windowsLegacyRelocationProofUnsigned(unsigned)
    )).digest('hex')}`
  }) as WindowsLegacySealedDirectoryRelocationProof;
  const capability = Object.freeze({ recoveryProofText: JSON.stringify(proof) });
  windowsLegacyRelocationCapabilities.set(capability, Object.freeze({ operation: input.operation, proof }));
  return capability;
}

export function openWindowsLegacySealedDirectoryRelocation(input: Readonly<{
  operation: BoundSemanticOperation;
  recoveryProofText: string;
}>): WindowsLegacySealedDirectoryRelocationCapability {
  assertWindowsLegacyRelocationOperation(input.operation);
  const proof = parseWindowsLegacyRelocationProof(input.recoveryProofText);
  assertWindowsLegacyRelocationOperation(input.operation, proof.operationIdentityDigest);
  const capability = Object.freeze({ recoveryProofText: input.recoveryProofText });
  windowsLegacyRelocationCapabilities.set(capability, Object.freeze({ operation: input.operation, proof }));
  return capability;
}

export function relocateWindowsLegacySealedDirectory(
  capability: WindowsLegacySealedDirectoryRelocationCapability
): Readonly<{
  destination: PhysicalDirectoryIdentity;
  predecessorDescriptorDigest: `sha256:${string}`;
  temporaryDescriptorDigest: `sha256:${string}`;
}> {
  const issued = windowsLegacyRelocationCapabilities.get(capability);
  if (issued === undefined) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation requires an owner-issued capability.');
  }
  assertWindowsLegacyRelocationOperation(issued.operation, issued.proof.operationIdentityDigest);
  const proof = issued.proof;
  const predecessor = Buffer.from(proof.predecessorDescriptorBase64, 'base64');
  const temporary = Buffer.from(proof.temporaryDescriptorBase64, 'base64');
  const sameProofPhysical = (candidate: PhysicalDirectoryIdentity): boolean =>
    candidate.device === proof.sourcePhysical.device && candidate.inode === proof.sourcePhysical.inode &&
    candidate.objectId === proof.sourcePhysical.objectId;
  const source = inspectExactNoFollowDirectoryPresence(proof.sourcePath, 'Windows legacy relocation source');
  const destination = inspectExactNoFollowDirectoryPresence(proof.destinationPath, 'Windows legacy relocation destination');
  const sourceParent = inspectNoFollowDirectoryChain(
    path.dirname(proof.sourcePath),
    'Windows legacy relocation source parent'
  ).target;
  const destinationParent = inspectNoFollowDirectoryChain(
    path.dirname(proof.destinationPath),
    'Windows legacy relocation destination parent'
  ).target;
  if (sourceParent.device !== proof.sourceParentPhysical.device ||
      sourceParent.inode !== proof.sourceParentPhysical.inode ||
      sourceParent.objectId !== proof.sourceParentPhysical.objectId) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Windows legacy relocation source parent identity differs.');
  }
  if (destinationParent.device !== proof.destinationParentPhysical.device ||
      destinationParent.inode !== proof.destinationParentPhysical.inode ||
      destinationParent.objectId !== proof.destinationParentPhysical.objectId) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Windows legacy relocation destination parent identity differs.');
  }
  if (source.state === 'present') {
    if (!sameProofPhysical(source.directory.target) || destination.state !== 'absent') {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Windows legacy relocation source/destination topology differs.');
    }
    const descriptor = windowsSecurityDescriptorBytes(proof.sourcePath);
    if (!temporary.equals(predecessor) && descriptor.equals(predecessor)) {
      windowsWriteSecurityDescriptorBytes(proof.sourcePath, temporary);
      if (!windowsSecurityDescriptorBytes(proof.sourcePath).equals(temporary)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Windows legacy relocation temporary descriptor failed readback.');
      }
    } else if (!descriptor.equals(predecessor) && !descriptor.equals(temporary)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Windows legacy relocation source descriptor is foreign.');
    }
    relocateRetainedNoFollowDirectoryAcrossParents({
      directory: source.directory.target,
      destinationParent: inspectNoFollowDirectoryChain(
        path.dirname(proof.destinationPath),
        'Windows legacy relocation destination parent'
      ).target,
      tombstoneName: path.basename(proof.destinationPath)
    });
  } else if (destination.state === 'absent') {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Windows legacy relocation physical generation is missing.');
  }
  const moved = inspectNoFollowDirectoryChain(proof.destinationPath, 'Windows legacy relocation moved generation').target;
  if (!sameProofPhysical(moved)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Windows legacy relocation moved generation identity differs.');
  }
  const descriptor = windowsSecurityDescriptorBytes(proof.destinationPath);
  if (!temporary.equals(predecessor) && descriptor.equals(temporary)) {
    windowsWriteSecurityDescriptorBytes(proof.destinationPath, predecessor);
  } else if (!descriptor.equals(predecessor)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Windows legacy relocation moved descriptor is foreign.');
  }
  if (!windowsSecurityDescriptorBytes(proof.destinationPath).equals(predecessor)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Windows legacy relocation predecessor descriptor failed readback.');
  }
  return Object.freeze({
    destination: moved,
    predecessorDescriptorDigest: proof.predecessorDescriptorDigest,
    temporaryDescriptorDigest: proof.temporaryDescriptorDigest
  });
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

/**
 * Publishes a locator to an already-issued proven generation. Linux targets
 * the inherited dirfd spelling rather than reopening the lexical source;
 * Windows uses the pinned absolute generation root. Only the opaque physical
 * capability can select this route.
 */
export function publishExclusiveNoFollowProvenDirectoryLink(input: Readonly<{
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly source: RetainedNoFollowProvenDirectoryGeneration;
}>): Readonly<{ path: string; source: PhysicalDirectoryIdentity; linkTarget: string }> {
  assertRetainedNoFollowProvenDirectoryGeneration(input.source, 'No-follow proven link source');
  input.source.assertCurrent();
  if (process.platform !== 'linux') {
    return publishExclusiveNoFollowLink({
      parent: input.parent,
      name: input.name,
      source: input.source.root,
      expectedTargetPath: input.source.root.path
    });
  }
  ensureLeafName(input.name);
  // The parent retains a high-numbered source fd; the process boundary maps
  // it to the bounded child slot named by childPath. Those numbers need not
  // (and normally do not) match.
  const childSlot = /^\/proc\/self\/fd\/([1-9][0-9]*)$/u.exec(input.source.childPath);
  if (input.source.stdioSourceDescriptor === null || childSlot === null
      || Number(childSlot[1]) < 3 || Number(childSlot[1]) > 64) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Linux proven generation has no canonical inherited dirfd path.'
    );
  }
  const parentChain = inspectNoFollowDirectoryChain(input.parent.path, 'No-follow proven link parent');
  const retained = linuxRetainBulkDirectoryChain(parentChain, 'No-follow proven link parent');
  let linkFd: number | null = null;
  try {
    retained.assertCurrent();
    input.source.assertCurrent();
    const status = requireLinuxLibc().symbols.symlinkat(
      Buffer.from(`${input.source.childPath}\0`, 'utf8'),
      retained.target.fd,
      Buffer.from(`${input.name}\0`, 'utf8')
    );
    if (status !== 0) {
      const errno = linuxErrno();
      if (errno === 17) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow proven link destination exists.');
      }
      throw physicalError(
        'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
        `No-follow proven link publication failed (errno ${errno}).`
      );
    }
    linkFd = linuxOpenLeafAt(retained.target.fd, input.name, 'No-follow proven link readback');
    const actual = linuxReadRetainedLinkTarget(linkFd, 'No-follow proven link readback');
    if (actual !== input.source.childPath) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'No-follow proven link target changed.');
    }
    retained.assertCurrent();
    input.source.assertCurrent();
    return Object.freeze({
      path: path.join(parentChain.target.path, input.name),
      source: input.source.root,
      linkTarget: actual
    });
  } finally {
    if (linkFd !== null) closeSync(linkFd);
    retained.dispose();
  }
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
