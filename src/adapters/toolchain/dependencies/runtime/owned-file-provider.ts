import path from 'node:path';

import { FailureError } from '../../../../contracts/failure.ts';
import {
  deleteRetainedNoFollowEntry,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowOrdinaryFileEntry,
  readNoFollowOrdinaryFile,
  type PhysicalDirectoryIdentity
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

export type NoFollowOwnedFileObservation = Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  device: string;
  inode: string;
  size: number;
}>;

/** Observe one ordinary file under a retained physical parent without granting mutation authority. */
export function observeNoFollowOwnedFile(
  filePath: string,
  label: string
): NoFollowOwnedFileObservation | null {
  const presence = inspectExactNoFollowDirectoryPresence(path.dirname(filePath), `${label} parent`);
  if (presence.state === 'absent') return null;
  const parent = presence.directory.target;
  const name = path.basename(filePath);
  const entry = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (entry === null) return null;
  if (entry.kind !== 'file') {
    throw new FailureError('RUNTIME-DEPS-003', `${label} is occupied by a non-file identity and is preserved`, {
      path: filePath, kind: entry.kind
    });
  }
  return Object.freeze({ parent, name, device: entry.device, inode: entry.inode, size: entry.size });
}

export function sameNoFollowOwnedFileObservation(
  left: NoFollowOwnedFileObservation,
  right: NoFollowOwnedFileObservation
): boolean {
  return left.parent.path === right.parent.path &&
    left.parent.device === right.parent.device &&
    left.parent.inode === right.parent.inode &&
    left.parent.objectId === right.parent.objectId &&
    left.name === right.name && left.device === right.device &&
    left.inode === right.inode && left.size === right.size;
}

export function readNoFollowOwnedFileBytes(
  observation: NoFollowOwnedFileObservation,
  label: string
): Buffer {
  const before = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name), `${label} read`
  );
  if (before === null || !sameNoFollowOwnedFileObservation(before, observation)) {
    throw new FailureError('RUNTIME-DEPS-003', `${label} identity changed before read and is preserved`);
  }
  const bytes = readNoFollowOrdinaryFile(observation.parent, observation.name);
  if (bytes === null) {
    throw new FailureError('RUNTIME-DEPS-003', `${label} disappeared during read and is preserved`);
  }
  const after = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name), `${label} readback`
  );
  if (after === null || !sameNoFollowOwnedFileObservation(after, observation)) {
    throw new FailureError('RUNTIME-DEPS-003', `${label} identity changed during read and is preserved`);
  }
  return Buffer.from(bytes);
}

export function readNoFollowOwnedFileJson(
  observation: NoFollowOwnedFileObservation,
  label: string
): unknown {
  try {
    return JSON.parse(readNoFollowOwnedFileBytes(observation, label).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Exact retained-identity file deletion. State machines must perform their own byte/owner checks first. */
export function deleteNoFollowOwnedFile(
  filePath: string,
  expected: NoFollowOwnedFileObservation,
  label: string
): void {
  const current = observeNoFollowOwnedFile(filePath, `${label} cleanup`);
  if (current === null) return;
  if (!sameNoFollowOwnedFileObservation(current, expected)) {
    throw new FailureError('RUNTIME-DEPS-003', `${label} identity changed before exact cleanup and is preserved`, {
      path: filePath
    });
  }
  deleteRetainedNoFollowEntry({
    root: expected.parent, relativePath: expected.name, kind: 'file',
    device: expected.device, inode: expected.inode, ancestorDirectories: []
  });
}
