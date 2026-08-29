import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan } from '../../semantic/mutation/contract/types.ts';
import {
  SemanticMutationContractError,
  canonicalEquals,
  mutationDiagnostic
} from './canonical.ts';
import {
  assertSemanticMutationSourceEditArtifactsInvariant
} from './plan-source-edit.ts';
import { semanticMutationByteDigest } from './semantic-contract-yaml-adapter.ts';
import { readSemanticMutationSource } from './source-path-boundary.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
import {
  applySemanticMutationWindowsFileAttributes,
  replaceSemanticMutationFileAtomically
} from './windows-file-attributes.ts';

export interface SemanticMutationTransactionArtifacts {
  readonly backupPath: string;
  readonly stagedSourcePath: string;
  readonly editPlanPath: string;
  readonly rollbackManifestPath: string;
}

export interface SemanticMutationAtomicFileOperations {
  readonly rename: (source: string, target: string) => Promise<void>;
}

const DEFAULT_FILE_OPERATIONS: SemanticMutationAtomicFileOperations = {
  rename: replaceSemanticMutationFileAtomically
};

function sourcePath(workspaceRoot: string, relativePath: string): string {
  return path.join(workspaceRoot, ...relativePath.split('/'));
}

async function fsyncDirectory(
  directory: string,
  commitFence: SemanticMutationCommitFence
): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await commitFence();
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function failWithOwnedTemporaryCleanup(
  filePath: string,
  commitFence: SemanticMutationCommitFence,
  primaryError: unknown
): Promise<never> {
  try {
    await commitFence();
    await rm(filePath, { force: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Semantic Mutation temporary publication failed and cleanup also failed'
    );
  }
  throw primaryError;
}

async function writeDurableFile(
  filePath: string,
  bytes: Uint8Array,
  mode: number,
  commitFence: SemanticMutationCommitFence
): Promise<void> {
  let created = false;
  try {
    await commitFence();
    const handle = await open(filePath, 'wx', mode);
    created = true;
    try {
      await commitFence();
      await handle.writeFile(bytes);
      await commitFence();
      await handle.sync();
    } finally {
      await handle.close();
    }
    await commitFence();
    await chmod(filePath, mode);
  } catch (error) {
    if (created) await failWithOwnedTemporaryCleanup(filePath, commitFence, error);
    throw error;
  }
}

async function publishDurableArtifact(
  targetPath: string,
  bytes: Uint8Array,
  mode: number,
  commitFence: SemanticMutationCommitFence
): Promise<void> {
  const directory = path.dirname(targetPath);
  const temporary = path.join(directory, `.artifact-${randomUUID()}.tmp`);
  let temporaryOwned = false;
  try {
    await writeDurableFile(temporary, bytes, mode, commitFence);
    temporaryOwned = true;
    await commitFence();
    await rename(temporary, targetPath);
    temporaryOwned = false;
    await fsyncDirectory(directory, commitFence);
  } catch (error) {
    if (temporaryOwned) await failWithOwnedTemporaryCleanup(temporary, commitFence, error);
    throw error;
  }
}

function contractError(
  code: 'SEMANTIC-MUTATION-007' | 'SEMANTIC-MUTATION-011' | 'SEMANTIC-MUTATION-012',
  stage: 'cas' | 'publish' | 'rollback',
  message: string,
  relativePath: string,
  safeDetails: Readonly<Record<string, string>> = {}
): SemanticMutationContractError {
  return new SemanticMutationContractError(mutationDiagnostic(code, stage, message, {
    relativePath,
    ...(Object.keys(safeDetails).length === 0 ? {} : { details: safeDetails })
  }));
}

type AtomicPublishFailurePhase =
  | 'temp-write'
  | 'attribute-apply'
  | 'atomic-replace'
  | 'directory-sync'
  | 'post-readback';

function sanitizedErrorCode(error: unknown): string {
  if (error instanceof AggregateError) return 'CLEANUP_FAILURE';
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)) return code;
  if (typeof code === 'number' && Number.isSafeInteger(code) && code >= 0) return `EXIT_${code}`;
  return 'UNKNOWN';
}

function publishFailure(
  phase: AtomicPublishFailurePhase,
  error: unknown,
  relativePath: string
): SemanticMutationContractError {
  const errorCode = sanitizedErrorCode(error);
  return contractError(
    'SEMANTIC-MUTATION-011',
    'publish',
    `Atomic source publish failed; phase=${phase}; code=${errorCode}`,
    relativePath,
    { phase, errorCode }
  );
}

export async function writeSemanticMutationTransactionArtifacts(
  transactionRoot: string,
  plan: SemanticMutationSourceEditPlan,
  manifest: SemanticMutationRollbackManifest,
  originalBytes: Uint8Array,
  stagedBytes: Uint8Array,
  commitFence: SemanticMutationCommitFence
): Promise<SemanticMutationTransactionArtifacts> {
  assertSemanticMutationSourceEditArtifactsInvariant(plan, manifest);
  if (semanticMutationByteDigest(originalBytes) !== manifest.beforeByteDigest ||
    semanticMutationByteDigest(stagedBytes) !== manifest.stagedByteDigest ||
    originalBytes.byteLength !== manifest.beforeByteLength ||
    stagedBytes.byteLength !== manifest.stagedByteLength) {
    throw contractError(
      'SEMANTIC-MUTATION-007',
      'cas',
      'Transaction backup or staged source does not match the frozen byte manifest',
      plan.relativePath
    );
  }
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  await commitFence();
  await mkdir(transactionRoot, { recursive: true });
  await assertSemanticMutationTransactionRoot(
    workspaceRoot,
    transactionRoot
  );
  const backupPath = path.join(transactionRoot, 'original.backup');
  const stagedSourcePath = path.join(transactionRoot, 'staged-source');
  for (const target of [backupPath, stagedSourcePath]) {
    try {
      const current = await readFile(target);
      const expected = target === backupPath ? manifest.beforeByteDigest : manifest.stagedByteDigest;
      if (semanticMutationByteDigest(current) !== expected) {
        throw contractError(
          'SEMANTIC-MUTATION-007',
          'cas',
          'Retained transaction artifact does not match the current mutation plan',
          plan.relativePath
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await publishDurableArtifact(
        target,
        target === backupPath ? originalBytes : stagedBytes,
        manifest.fileMode,
        commitFence
      );
    }
  }
  const editPlanPath = path.join(transactionRoot, 'source-edit-plan.json');
  const rollbackManifestPath = path.join(transactionRoot, 'rollback-manifest.json');
  for (const [target, value] of [
    [editPlanPath, plan],
    [rollbackManifestPath, manifest]
  ] as const) {
    try {
      const current = JSON.parse(await readFile(target, 'utf8')) as unknown;
      if (!canonicalEquals(current, value)) {
        throw contractError(
          'SEMANTIC-MUTATION-007',
          'cas',
          'Retained transaction metadata does not match the current mutation plan',
          plan.relativePath
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await publishDurableArtifact(
        target,
        new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
        0o600,
        commitFence
      );
    }
  }
  await fsyncDirectory(transactionRoot, commitFence);
  return { backupPath, stagedSourcePath, editPlanPath, rollbackManifestPath };
}

export async function readSemanticMutationTransactionArtifacts(
  transactionRoot: string
): Promise<{
  readonly plan: SemanticMutationSourceEditPlan;
  readonly manifest: SemanticMutationRollbackManifest;
  readonly originalBytes: Uint8Array;
  readonly stagedBytes: Uint8Array;
}> {
  const [planJson, manifestJson, original, staged] = await Promise.all([
    readFile(path.join(transactionRoot, 'source-edit-plan.json'), 'utf8'),
    readFile(path.join(transactionRoot, 'rollback-manifest.json'), 'utf8'),
    readFile(path.join(transactionRoot, 'original.backup')),
    readFile(path.join(transactionRoot, 'staged-source'))
  ]);
  const plan = JSON.parse(planJson) as SemanticMutationSourceEditPlan;
  const manifest = JSON.parse(manifestJson) as SemanticMutationRollbackManifest;
  assertSemanticMutationSourceEditArtifactsInvariant(plan, manifest);
  if (semanticMutationByteDigest(original) !== manifest.beforeByteDigest ||
    semanticMutationByteDigest(staged) !== manifest.stagedByteDigest ||
    original.byteLength !== manifest.beforeByteLength ||
    staged.byteLength !== manifest.stagedByteLength) {
    throw contractError(
      'SEMANTIC-MUTATION-007',
      'cas',
      'Retained transaction bytes do not match the frozen rollback manifest',
      plan.relativePath
    );
  }
  return {
    plan,
    manifest,
    originalBytes: new Uint8Array(original),
    stagedBytes: new Uint8Array(staged)
  };
}

async function assertSameDevice(targetPath: string, transactionRoot: string, relativePath: string): Promise<void> {
  const [targetParent, transaction] = await Promise.all([
    stat(path.dirname(targetPath)),
    stat(transactionRoot)
  ]);
  if (String(targetParent.dev) !== String(transaction.dev)) {
    throw contractError(
      'SEMANTIC-MUTATION-011',
      'publish',
      'Atomic source publish requires staging and target to be on the same filesystem device',
      relativePath
    );
  }
}

export async function atomicPublishSemanticMutationSource(
  workspaceRoot: string,
  transactionRoot: string,
  plan: SemanticMutationSourceEditPlan,
  manifest: SemanticMutationRollbackManifest,
  commitFence: SemanticMutationCommitFence,
  operations: SemanticMutationAtomicFileOperations = DEFAULT_FILE_OPERATIONS
): Promise<void> {
  assertSemanticMutationSourceEditArtifactsInvariant(plan, manifest);
  const target = sourcePath(workspaceRoot, plan.relativePath);
  const before = await readSemanticMutationSource(workspaceRoot, transactionRoot, plan.relativePath);
  if (semanticMutationByteDigest(before.bytes) !== plan.beforeByteDigest ||
    !canonicalEquals(before.windowsFileAttributes, manifest.windowsFileAttributes)) {
    throw contractError('SEMANTIC-MUTATION-007', 'cas', 'Live source changed before atomic publish', plan.relativePath);
  }
  const stagedPath = path.join(transactionRoot, 'staged-source');
  const stagedBytes = await readFile(stagedPath);
  if (semanticMutationByteDigest(stagedBytes) !== plan.stagedByteDigest) {
    throw contractError('SEMANTIC-MUTATION-007', 'cas', 'Staged source changed before atomic publish', plan.relativePath);
  }
  await assertSameDevice(target, transactionRoot, plan.relativePath);
  const publishTemp = path.join(transactionRoot, `.publish-${randomUUID()}.tmp`);
  try {
    await writeDurableFile(publishTemp, stagedBytes, manifest.fileMode, commitFence);
  } catch (error) {
    throw publishFailure('temp-write', error, plan.relativePath);
  }
  try {
    await commitFence();
    await applySemanticMutationWindowsFileAttributes(publishTemp, manifest.windowsFileAttributes);
  } catch (error) {
    await failWithOwnedTemporaryCleanup(
      publishTemp,
      commitFence,
      publishFailure('attribute-apply', error, plan.relativePath)
    );
  }
  let finalBefore: Awaited<ReturnType<typeof readSemanticMutationSource>>;
  try {
    finalBefore = await readSemanticMutationSource(workspaceRoot, transactionRoot, plan.relativePath);
  } catch (error) {
    await failWithOwnedTemporaryCleanup(
      publishTemp,
      commitFence,
      publishFailure('post-readback', error, plan.relativePath)
    );
    throw error;
  }
  if (semanticMutationByteDigest(finalBefore.bytes) !== plan.beforeByteDigest ||
    !canonicalEquals(finalBefore.windowsFileAttributes, manifest.windowsFileAttributes)) {
    await failWithOwnedTemporaryCleanup(
      publishTemp,
      commitFence,
      contractError(
        'SEMANTIC-MUTATION-007',
        'cas',
        'Live source changed during final publish CAS',
        plan.relativePath
      )
    );
  }
  try {
    await commitFence();
    await operations.rename(publishTemp, target);
  } catch (error) {
    await failWithOwnedTemporaryCleanup(
      publishTemp,
      commitFence,
      publishFailure('atomic-replace', error, plan.relativePath)
    );
  }
  try {
    await fsyncDirectory(path.dirname(target), commitFence);
  } catch (error) {
    throw publishFailure('directory-sync', error, plan.relativePath);
  }
  let committed: Awaited<ReturnType<typeof readSemanticMutationSource>>;
  try {
    committed = await readSemanticMutationSource(workspaceRoot, transactionRoot, plan.relativePath);
  } catch (error) {
    throw publishFailure('post-readback', error, plan.relativePath);
  }
  const committedBytesMismatch = semanticMutationByteDigest(committed.bytes) !== plan.stagedByteDigest;
  const committedAttributesMismatch =
    !canonicalEquals(committed.windowsFileAttributes, manifest.windowsFileAttributes);
  if (committedBytesMismatch || committedAttributesMismatch) {
    const errorCode = committedBytesMismatch && committedAttributesMismatch
      ? 'BYTE_AND_ATTRIBUTE_MISMATCH'
      : committedBytesMismatch
        ? 'BYTE_MISMATCH'
        : 'ATTRIBUTE_MISMATCH';
    throw contractError(
      'SEMANTIC-MUTATION-011',
      'publish',
      'Committed source readback does not match the staged mutation',
      plan.relativePath,
      { phase: 'post-readback', errorCode }
    );
  }
}

export async function atomicRestoreSemanticMutationSource(
  workspaceRoot: string,
  transactionRoot: string,
  plan: SemanticMutationSourceEditPlan,
  manifest: SemanticMutationRollbackManifest,
  commitFence: SemanticMutationCommitFence,
  operations: SemanticMutationAtomicFileOperations = DEFAULT_FILE_OPERATIONS
): Promise<void> {
  assertSemanticMutationSourceEditArtifactsInvariant(plan, manifest);
  const target = sourcePath(workspaceRoot, plan.relativePath);
  const committed = await readSemanticMutationSource(workspaceRoot, transactionRoot, plan.relativePath);
  if (semanticMutationByteDigest(committed.bytes) !== plan.stagedByteDigest ||
    !canonicalEquals(committed.windowsFileAttributes, manifest.windowsFileAttributes)) {
    throw contractError(
      'SEMANTIC-MUTATION-012',
      'rollback',
      'Rollback CAS refused to overwrite source bytes not committed by this transaction',
      plan.relativePath
    );
  }
  const backup = await readFile(path.join(transactionRoot, 'original.backup'));
  if (semanticMutationByteDigest(backup) !== plan.beforeByteDigest) {
    throw contractError('SEMANTIC-MUTATION-012', 'rollback', 'Rollback backup digest is invalid', plan.relativePath);
  }
  await assertSameDevice(target, transactionRoot, plan.relativePath);
  const restoreTemp = path.join(transactionRoot, `.restore-${randomUUID()}.tmp`);
  await writeDurableFile(restoreTemp, backup, manifest.fileMode, commitFence);
  try {
    await commitFence();
    await applySemanticMutationWindowsFileAttributes(restoreTemp, manifest.windowsFileAttributes);
  } catch (error) {
    await failWithOwnedTemporaryCleanup(restoreTemp, commitFence, error);
  }
  let finalCommitted: Awaited<ReturnType<typeof readSemanticMutationSource>>;
  try {
    await commitFence();
    finalCommitted = await readSemanticMutationSource(
      workspaceRoot,
      transactionRoot,
      plan.relativePath
    );
  } catch (error) {
    await failWithOwnedTemporaryCleanup(restoreTemp, commitFence, error);
    throw error;
  }
  if (semanticMutationByteDigest(finalCommitted.bytes) !== plan.stagedByteDigest ||
    !canonicalEquals(finalCommitted.windowsFileAttributes, manifest.windowsFileAttributes)) {
    await failWithOwnedTemporaryCleanup(
      restoreTemp,
      commitFence,
      contractError(
        'SEMANTIC-MUTATION-012',
        'rollback',
        'Rollback CAS refused to overwrite source bytes not committed by this transaction',
        plan.relativePath
      )
    );
  }
  try {
    await commitFence();
    await operations.rename(restoreTemp, target);
  } catch (error) {
    await failWithOwnedTemporaryCleanup(
      restoreTemp,
      commitFence,
      contractError(
        'SEMANTIC-MUTATION-012',
        'rollback',
        `Atomic source restore failed${(error as NodeJS.ErrnoException).code ? ` (${(error as NodeJS.ErrnoException).code})` : ''}`,
        plan.relativePath
      )
    );
  }
  try {
    await fsyncDirectory(path.dirname(target), commitFence);
  } catch (error) {
    throw contractError(
      'SEMANTIC-MUTATION-012',
      'rollback',
      `Atomic source restore failed${(error as NodeJS.ErrnoException).code ? ` (${(error as NodeJS.ErrnoException).code})` : ''}`,
      plan.relativePath
    );
  }
  const restored = await readSemanticMutationSource(workspaceRoot, transactionRoot, plan.relativePath);
  if (semanticMutationByteDigest(restored.bytes) !== plan.beforeByteDigest ||
    !canonicalEquals(restored.windowsFileAttributes, manifest.windowsFileAttributes)) {
    throw contractError('SEMANTIC-MUTATION-012', 'rollback', 'Restored source digest does not match original bytes', plan.relativePath);
  }
}
