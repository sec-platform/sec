import path from 'node:path';

import {
  createNoFollowDirectoryChain,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  readNoFollowOrdinaryFile,
  replaceDurableCanonicalFile,
  type PhysicalDirectoryIdentity
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { isCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import type { CommitFence } from './files.ts';

export interface CanonicalWorkspaceFilePublicationInput {
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly bytes: Uint8Array;
  readonly label: string;
  readonly commitFence?: CommitFence;
}

export interface ExpectedCanonicalWorkspaceFilePublicationInput
extends CanonicalWorkspaceFilePublicationInput {
  readonly expectedBytes: Uint8Array;
}

function workspaceRelativeSegments(workspaceRoot: string, targetPath: string): string[] {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Canonical workspace publication target "${targetPath}" must be one file inside "${root}"`);
  }
  const segments = relative.split(path.sep);
  const logicalPath = segments.join('/');
  if (!isCanonicalPortableLogicalPath(logicalPath)) {
    throw new Error(`Canonical workspace publication target "${targetPath}" is not one portable logical path`);
  }
  return segments;
}

function creatableWorkspaceRelativeSegments(workspaceRoot: string, targetPath: string): string[] {
  const segments = workspaceRelativeSegments(workspaceRoot, targetPath);
  for (const segment of segments.slice(0, -1)) {
    if (segment !== '.tmp' && !/^[a-z0-9-]+$/u.test(segment)) {
      throw new Error(
        `Canonical workspace publication parent "${segment}" is outside the retained canonical-directory vocabulary`
      );
    }
  }
  return segments;
}

async function retainedCreatablePublicationParent(
  input: CanonicalWorkspaceFilePublicationInput
): Promise<Readonly<{ parent: PhysicalDirectoryIdentity; leafName: string }>> {
  const rootPath = path.resolve(input.workspaceRoot);
  const segments = creatableWorkspaceRelativeSegments(rootPath, input.targetPath);
  const leafName = segments.at(-1)!;
  const parentSegments = segments.slice(0, -1);
  const workspace = inspectNoFollowDirectoryChain(
    rootPath,
    `${input.label} workspace root`
  ).target;

  await input.commitFence?.();
  const parent = parentSegments.length === 0
    ? workspace
    : createNoFollowDirectoryChain(workspace, parentSegments);
  return Object.freeze({ parent, leafName });
}

async function retainedExistingPublicationParent(
  input: CanonicalWorkspaceFilePublicationInput
): Promise<Readonly<{ parent: PhysicalDirectoryIdentity; leafName: string }>> {
  const rootPath = path.resolve(input.workspaceRoot);
  const segments = workspaceRelativeSegments(rootPath, input.targetPath);
  const leafName = segments.at(-1)!;
  const parentPath = path.join(rootPath, ...segments.slice(0, -1));

  // Existing-parent mode deliberately owns no directory creation. This lets a
  // domain whose lifecycle already established a retained authority zone (for
  // example `.sec` under the active Workspace write lease) reuse durable file
  // publication without expanding the canonical directory-creation vocabulary.
  await input.commitFence?.();
  const parent = inspectNoFollowDirectoryChain(
    parentPath,
    `${input.label} existing parent`
  ).target;
  return Object.freeze({ parent, leafName });
}

function validateRequestedBytes(input: CanonicalWorkspaceFilePublicationInput, current: Uint8Array): void {
  if (!Buffer.from(current).equals(Buffer.from(input.bytes))) {
    throw new Error(`${input.label} readback differs from requested bytes`);
  }
}

/**
 * Physical publisher for already-authorized canonical workspace control/source
 * files whose missing parent directory names are in the retained canonical
 * creation vocabulary. Domain authorization remains with the caller.
 */
export async function publishCanonicalWorkspaceFile(
  input: CanonicalWorkspaceFilePublicationInput
): Promise<void> {
  const { parent, leafName } = await retainedCreatablePublicationParent(input);
  await input.commitFence?.();
  replaceDurableCanonicalFile({
    parent,
    name: leafName,
    bytes: input.bytes,
    validate: (current) => validateRequestedBytes(input, current)
  });
}

/**
 * Durable replacement below an already-existing retained parent. It never
 * creates directories and therefore does not broaden directory-lifecycle
 * authority. The caller must own the parent lifecycle and write authorization.
 */
export async function publishExistingParentCanonicalWorkspaceFile(
  input: CanonicalWorkspaceFilePublicationInput
): Promise<void> {
  const { parent, leafName } = await retainedExistingPublicationParent(input);
  await input.commitFence?.();
  replaceDurableCanonicalFile({
    parent,
    name: leafName,
    bytes: input.bytes,
    validate: (current) => validateRequestedBytes(input, current)
  });
}

/**
 * Replaces one existing file only while its exact observed preimage is still
 * current under the caller's workspace write lease.  Callers that publish a
 * set must plan and validate the complete set before the first call; repeated
 * execution remains safe only when their transformation is idempotent.
 */
export async function publishExpectedCanonicalWorkspaceFile(
  input: ExpectedCanonicalWorkspaceFilePublicationInput
): Promise<void> {
  const { parent, leafName } = await retainedExistingPublicationParent(input);
  await input.commitFence?.();
  const current = readNoFollowOrdinaryFile(parent, leafName);
  if (current === null || !Buffer.from(current).equals(Buffer.from(input.expectedBytes))) {
    throw new Error(`${input.label} preimage changed before publication`);
  }
  replaceDurableCanonicalFile({
    parent,
    name: leafName,
    bytes: input.bytes,
    validate: (readback) => validateRequestedBytes(input, readback)
  });
}

/**
 * Create-if-absent counterpart used when overwriting a concurrent/pre-existing
 * file would violate the caller's state transition. If another writer wins the
 * race with different bytes, exact readback fails closed rather than silently
 * replacing the new state.
 */
export async function publishExclusiveCanonicalWorkspaceFile(
  input: CanonicalWorkspaceFilePublicationInput
): Promise<Readonly<{ created: boolean }>> {
  const { parent, leafName } = await retainedCreatablePublicationParent(input);
  await input.commitFence?.();
  const result = publishExclusiveDurableCanonicalFile({
    parent,
    name: leafName,
    bytes: input.bytes,
    validate: (current) => validateRequestedBytes(input, current)
  });
  return Object.freeze({ created: result.created });
}

/**
 * Deletes one file only while the exact bytes and retained physical leaf that
 * were just published remain current. This is the rollback counterpart of an
 * exclusive canonical publication; it never treats a missing or substituted
 * target as successful settlement.
 */
export async function deleteExpectedCanonicalWorkspaceFile(
  input: ExpectedCanonicalWorkspaceFilePublicationInput
): Promise<void> {
  const { parent, leafName } = await retainedExistingPublicationParent(input);
  await input.commitFence?.();
  const current = inspectNoFollowOrdinaryFileEntry(parent, leafName);
  if (
    current === null
    || current.kind !== 'file'
    || current.bytes === null
    || !Buffer.from(current.bytes).equals(Buffer.from(input.expectedBytes))
  ) {
    throw new Error(`${input.label} rollback preimage changed before deletion`);
  }
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: leafName,
    kind: 'file',
    device: current.device,
    inode: current.inode,
    ancestorDirectories: []
  });
}
