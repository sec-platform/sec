import path from 'node:path';
import { isProxy } from 'node:util/types';

import type { SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan } from '../../semantics/mutation/types.ts';
import {
  SemanticMutationContractError,
  canonicalEquals,
  cloneAndDeepFreeze,
  mutationDiagnostic,
  semanticMutationByteDigest
} from '../../compiler/semantic-mutation/canonical.ts';
import { assertSemanticMutationSourceEditArtifactsInvariant } from '../../compiler/semantic-mutation/source-edit-artifact.ts';
import { readSemanticMutationSource } from './source-path-boundary.ts';
import type { SemanticMutationCommitFence } from './transaction-identity.ts';
import { inspectNoFollowDirectoryChain, PhysicalNoFollowError } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  replaceRetainedNoFollowSourceFile,
  settleRetainedNoFollowSourceReplacementResidue,
  SourceReplacementFailure,
  type SourceReplacementPhase,
  type SourceReplacementTestActor
} from '../runtime-state/physical/runtime/retained-source-replacement.ts';
import { readSemanticMutationTransactionArtifacts } from './transaction-artifacts.ts';

export { readSemanticMutationTransactionArtifacts, writeSemanticMutationTransactionArtifacts } from './transaction-artifacts.ts';
export type { SemanticMutationTransactionArtifacts } from './transaction-artifacts.ts';
export { createSourceReplacementTestActorForTests } from '../runtime-state/physical/runtime/retained-source-replacement.ts';

function contractError(
  code: 'SEMANTIC-MUTATION-007' | 'SEMANTIC-MUTATION-011' | 'SEMANTIC-MUTATION-012',
  stage: 'cas' | 'publish' | 'rollback',
  message: string,
  relativePath: string,
  safeDetails: Readonly<Record<string, string>> = {},
  cause?: unknown
): SemanticMutationContractError {
  const error = new SemanticMutationContractError(mutationDiagnostic(code, stage, message, {
    relativePath,
    ...(Object.keys(safeDetails).length === 0 ? {} : { details: safeDetails })
  }));
  // Physical residue is available to the recovery owner, not serialized into
  // a public diagnostic or an absolute-path-bearing native message.
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

/** Public error context is a bounded own-data label, never an effect path. */
function diagnosticRelativePath(plan: unknown): string {
  if (plan === null || typeof plan !== 'object' || isProxy(plan)) return '';
  const descriptor = Object.getOwnPropertyDescriptor(plan, 'relativePath');
  const value: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (typeof value !== 'string' || value.length > 4096 || value.length === 0 ||
      /[\\\0\r\n:]/u.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) return '';
  return value;
}

function sanitizedErrorCode(error: unknown): string {
  if (error === null || typeof error !== 'object' || isProxy(error)) return 'UNKNOWN';
  if (Object.getPrototypeOf(error) === AggregateError.prototype) return 'CLEANUP_FAILURE';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const code: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)) return code;
  if (typeof code === 'number' && Number.isSafeInteger(code) && code >= 0) return `EXIT_${code}`;
  return 'UNKNOWN';
}

function publishFailure(phase: SourceReplacementPhase, error: unknown, relativePath: string, cause = error) {
  const errorCode = sanitizedErrorCode(error);
  return contractError('SEMANTIC-MUTATION-011', 'publish',
    `Atomic source publish failed; phase=${phase}; code=${errorCode}`,
    relativePath, { phase, errorCode }, cause);
}

async function replaceSource(
  direction: 'publish' | 'restore',
  workspaceRoot: string,
  transactionRoot: string,
  inputPlan: SemanticMutationSourceEditPlan,
  inputManifest: SemanticMutationRollbackManifest,
  commitFence: SemanticMutationCommitFence,
  testOnlyActor?: SourceReplacementTestActor
): Promise<void> {
  assertSemanticMutationSourceEditArtifactsInvariant(inputPlan, inputManifest);
  const plan = cloneAndDeepFreeze(inputPlan);
  const manifest = cloneAndDeepFreeze(inputManifest);
  const relativePath = plan.relativePath;
  const target = path.join(path.resolve(workspaceRoot), ...relativePath.split('/'));
  // Capture both identities before any awaited artifact/source observation.
  // A later lexical replacement is never adopted as a fresh effect boundary.
  const transaction = inspectNoFollowDirectoryChain(transactionRoot, 'Mutation publication transaction').target;
  const parent = inspectNoFollowDirectoryChain(path.dirname(target), 'Mutation publication target parent').target;
  const restoring = direction === 'restore';
  const expectedDigest = restoring ? plan.stagedByteDigest : plan.beforeByteDigest;
  const nextDigest = restoring ? plan.beforeByteDigest : plan.stagedByteDigest;
  const casFailure = (cause?: unknown) => contractError(
    restoring ? 'SEMANTIC-MUTATION-012' : 'SEMANTIC-MUTATION-007',
    restoring ? 'rollback' : 'cas',
    restoring
      ? 'Rollback CAS refused to overwrite source bytes not committed by this transaction'
      : 'Live source changed before atomic publish',
    relativePath, {}, cause
  );
  const before = await readSemanticMutationSource(workspaceRoot, transactionRoot, relativePath);
  if (semanticMutationByteDigest(before.bytes) !== expectedDigest || before.fileMode !== manifest.fileMode ||
      !canonicalEquals(before.windowsFileAttributes, manifest.windowsFileAttributes)) throw casFailure();
  const artifacts = await readSemanticMutationTransactionArtifacts(transactionRoot);
  if (!canonicalEquals(artifacts.plan, plan) || !canonicalEquals(artifacts.manifest, manifest)) {
    throw contractError('SEMANTIC-MUTATION-007', 'cas', 'Transaction artifacts belong to another mutation plan', relativePath);
  }
  const expectedBytes = restoring ? artifacts.stagedBytes : artifacts.originalBytes;
  const bytes = restoring ? artifacts.originalBytes : artifacts.stagedBytes;
  if (semanticMutationByteDigest(expectedBytes) !== expectedDigest || semanticMutationByteDigest(bytes) !== nextDigest) {
    throw casFailure();
  }
  if (parent.device !== transaction.device) {
    throw contractError('SEMANTIC-MUTATION-011', 'publish',
      'Atomic source publish requires staging and target to be on the same filesystem device', relativePath);
  }
  const attributes = manifest.windowsFileAttributes;
  const windowsAttributes = attributes === null ? null :
    (attributes.readOnly ? 1 : 0) | (attributes.hidden ? 2 : 0) |
    (attributes.system ? 4 : 0) | (attributes.archive ? 32 : 0);
  try {
    await replaceRetainedNoFollowSourceFile({
      sourceParent: transaction,
      targetParent: parent,
      targetName: path.basename(target),
      expectedBytes,
      bytes,
      expectedMode: manifest.fileMode,
      expectedWindowsAttributes: windowsAttributes,
      direction,
      commitFence,
      testOnlyActor
    });
  } catch (error) {
    const failure = error instanceof SourceReplacementFailure ? error : undefined;
    const native = failure === undefined ? error : failure.cause;
    if (failure?.namespaceChanged === false && native !== null && typeof native === 'object' &&
        !isProxy(native) && native instanceof PhysicalNoFollowError &&
        native.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') throw casFailure(failure);
    if (restoring) {
      throw contractError('SEMANTIC-MUTATION-012', 'rollback',
        `Atomic source restore failed; code=${sanitizedErrorCode(native)}`, relativePath, {}, error);
    }
    throw publishFailure(failure?.phase ?? 'temp-write', native, relativePath, error);
  }
  let after: Awaited<ReturnType<typeof readSemanticMutationSource>>;
  try { after = await readSemanticMutationSource(workspaceRoot, transactionRoot, relativePath); }
  catch (error) {
    if (!restoring) throw publishFailure('post-readback', error, relativePath);
    throw contractError('SEMANTIC-MUTATION-012', 'rollback', 'Restored source readback failed', relativePath, {}, error);
  }
  const bytesMismatch = semanticMutationByteDigest(after.bytes) !== nextDigest;
  const attributesMismatch = !canonicalEquals(after.windowsFileAttributes, manifest.windowsFileAttributes);
  const modeMismatch = after.fileMode !== manifest.fileMode;
  if (bytesMismatch || attributesMismatch || modeMismatch) {
    const errorCode = modeMismatch ? 'MODE_MISMATCH'
      : bytesMismatch && attributesMismatch ? 'BYTE_AND_ATTRIBUTE_MISMATCH'
        : bytesMismatch ? 'BYTE_MISMATCH' : 'ATTRIBUTE_MISMATCH';
    throw contractError(restoring ? 'SEMANTIC-MUTATION-012' : 'SEMANTIC-MUTATION-011', restoring ? 'rollback' : 'publish',
      restoring ? 'Restored source digest or metadata does not match original bytes'
        : 'Committed source readback does not match the staged mutation',
      relativePath, { phase: 'post-readback', errorCode });
  }
}


export async function settleSemanticMutationSourceReplacementResidue(
  workspaceRoot: string,
  transactionRoot: string,
  inputPlan: SemanticMutationSourceEditPlan,
  inputManifest: SemanticMutationRollbackManifest,
  inputOriginalBytes: Uint8Array,
  inputStagedBytes: Uint8Array,
  commitFence: SemanticMutationCommitFence
) {
  assertSemanticMutationSourceEditArtifactsInvariant(inputPlan, inputManifest);
  const plan = cloneAndDeepFreeze(inputPlan);
  const manifest = cloneAndDeepFreeze(inputManifest);
  const originalBytes = new Uint8Array(inputOriginalBytes);
  const stagedBytes = new Uint8Array(inputStagedBytes);
  if (semanticMutationByteDigest(originalBytes) !== plan.beforeByteDigest ||
      semanticMutationByteDigest(stagedBytes) !== plan.stagedByteDigest ||
      originalBytes.byteLength !== manifest.beforeByteLength ||
      stagedBytes.byteLength !== manifest.stagedByteLength) {
    throw contractError(
      'SEMANTIC-MUTATION-012',
      'rollback',
      'Source replacement residue artifacts do not match the retained transaction',
      plan.relativePath
    );
  }
  const target = path.join(path.resolve(workspaceRoot), ...plan.relativePath.split('/'));
  const transaction = inspectNoFollowDirectoryChain(
    transactionRoot, 'Mutation recovery transaction'
  ).target;
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(target), 'Mutation recovery target parent'
  ).target;
  const attributes = manifest.windowsFileAttributes;
  const windowsAttributes = attributes === null ? null :
    (attributes.readOnly ? 1 : 0) | (attributes.hidden ? 2 : 0) |
    (attributes.system ? 4 : 0) | (attributes.archive ? 32 : 0);
  return settleRetainedNoFollowSourceReplacementResidue({
    sourceParent: transaction,
    targetParent: parent,
    targetName: path.basename(target),
    originalBytes,
    stagedBytes,
    expectedMode: manifest.fileMode,
    expectedWindowsAttributes: windowsAttributes,
    commitFence
  });
}

export async function atomicPublishSemanticMutationSource(
  workspaceRoot: string,
  transactionRoot: string,
  plan: SemanticMutationSourceEditPlan,
  manifest: SemanticMutationRollbackManifest,
  commitFence: SemanticMutationCommitFence,
  testOnlyActor?: SourceReplacementTestActor
): Promise<void> {
  const relativePath = diagnosticRelativePath(plan);
  try {
    await replaceSource('publish', workspaceRoot, transactionRoot, plan, manifest, commitFence, testOnlyActor);
  } catch (error) {
    if (error !== null && typeof error === 'object' && !isProxy(error) &&
        error instanceof SemanticMutationContractError) throw error;
    throw publishFailure('temp-write', error, relativePath);
  }
}

export async function atomicRestoreSemanticMutationSource(
  workspaceRoot: string,
  transactionRoot: string,
  plan: SemanticMutationSourceEditPlan,
  manifest: SemanticMutationRollbackManifest,
  commitFence: SemanticMutationCommitFence,
  testOnlyActor?: SourceReplacementTestActor
): Promise<void> {
  const relativePath = diagnosticRelativePath(plan);
  try {
    await replaceSource('restore', workspaceRoot, transactionRoot, plan, manifest, commitFence, testOnlyActor);
  } catch (error) {
    if (error !== null && typeof error === 'object' && !isProxy(error) &&
        error instanceof SemanticMutationContractError) throw error;
    throw contractError('SEMANTIC-MUTATION-012', 'rollback',
      `Atomic source restore failed; code=${sanitizedErrorCode(error)}`, relativePath, {}, error);
  }
}
