import path from 'node:path';
import { snapshotByteView } from '../../contracts/byte-snapshot.ts';

import {
  createNoFollowDirectoryChain,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  readNoFollowOrdinaryFile,
  replaceDurableCanonicalFile,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import type { CommitFence } from "../../contracts/commit-fence.ts";

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

type CanonicalWorkspacePublicationFailurePhase =
  | 'before-effect'
  | 'effect-possible'
  | 'unknown';

const canonicalWorkspacePublicationFailurePhases =
  new WeakMap<object, Exclude<CanonicalWorkspacePublicationFailurePhase, 'unknown'>>();

function throwCanonicalWorkspacePublicationFailure(
  error: unknown,
  phase: Exclude<CanonicalWorkspacePublicationFailurePhase, 'unknown'>
): never {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    const existing = canonicalWorkspacePublicationFailurePhases.get(error);
    canonicalWorkspacePublicationFailurePhases.set(
      error,
      existing === 'effect-possible' || phase === 'effect-possible'
        ? 'effect-possible'
        : 'before-effect'
    );
    throw error;
  }
  const wrapped = new Error('Canonical workspace publication failed with a non-object error.', { cause: error });
  canonicalWorkspacePublicationFailurePhases.set(wrapped, phase);
  throw wrapped;
}

/**
 * Reads only failure-stage evidence issued by this publication owner. Unknown
 * values and errors from other operations never acquire before-effect proof.
 */
export function classifyCanonicalWorkspacePublicationFailure(
  error: unknown
): CanonicalWorkspacePublicationFailurePhase {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? canonicalWorkspacePublicationFailurePhases.get(error) ?? 'unknown'
    : 'unknown';
}


// A request is a decision snapshot, not a source of authority. Capture before
// the first fence and preserve a method's real receiver, not a record clone.
type PublicationTarget = Pick<CanonicalWorkspaceFilePublicationInput,
  'workspaceRoot' | 'targetPath' | 'label' | 'commitFence'>;
function captureTarget(input: PublicationTarget): PublicationTarget {
  const cwd = process.cwd();
  const { workspaceRoot, targetPath, label, commitFence } = input;
  if (typeof label !== 'string') throw new TypeError('Publication label must be text');
  if (commitFence !== undefined && typeof commitFence !== 'function') {
    throw new TypeError('Publication commit fence must be callable');
  }
  return Object.freeze({
    workspaceRoot: path.resolve(cwd, workspaceRoot), targetPath: path.resolve(cwd, targetPath), label,
    commitFence: commitFence === undefined ? undefined : () => Reflect.apply(commitFence, input, [])
  });
}

function capturePublication(input: CanonicalWorkspaceFilePublicationInput): CanonicalWorkspaceFilePublicationInput {
  const target = captureTarget(input);
  return Object.freeze({ ...target, bytes: snapshotByteView(input.bytes, `${target.label} bytes`) });
}

function captureExpectedPublication(input: ExpectedCanonicalWorkspaceFilePublicationInput): ExpectedCanonicalWorkspaceFilePublicationInput {
  const publication = capturePublication(input);
  return Object.freeze({ ...publication, expectedBytes: snapshotByteView(input.expectedBytes, `${publication.label} preimage`) });
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
  input: PublicationTarget
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
  input: PublicationTarget
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
  input = capturePublication(input);
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
  let phase: Exclude<CanonicalWorkspacePublicationFailurePhase, 'unknown'> = 'before-effect';
  try {
    input = capturePublication(input);
    const { parent, leafName } = await retainedExistingPublicationParent(input);
    await input.commitFence?.();
    // No await or caller code may run between this owner-issued transition and
    // the synchronous physical replacement Effect.
    phase = 'effect-possible';
    replaceDurableCanonicalFile({
      parent,
      name: leafName,
      bytes: input.bytes,
      validate: (current) => validateRequestedBytes(input, current)
    });
  } catch (error) {
    throwCanonicalWorkspacePublicationFailure(error, phase);
  }
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
  input = captureExpectedPublication(input);
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
  input = capturePublication(input);
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
  const target = captureTarget(input);
  // Deletion consumes only its observed preimage, never input.bytes.
  const expectedBytes = snapshotByteView(input.expectedBytes, `${target.label} preimage`);
  const { parent, leafName } = await retainedExistingPublicationParent(target);
  await target.commitFence?.();
  const current = inspectNoFollowOrdinaryFileEntry(parent, leafName);
  if (
    current === null
    || current.kind !== 'file'
    || current.bytes === null
    || !Buffer.from(current.bytes).equals(Buffer.from(expectedBytes))
  ) {
    throw new Error(`${target.label} rollback preimage changed before deletion`);
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
