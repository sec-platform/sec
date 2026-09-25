import path from 'node:path';

import { semanticMutationByteDigest } from '../../compiler/semantic-mutation/canonical.ts';
import { assertSemanticMutationSourceEditArtifactsInvariant } from '../../compiler/semantic-mutation/source-edit-artifact.ts';
import type { SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan } from '../../semantics/mutation/types.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  copyNoFollowDirectoryTreesBulk,
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowFileTransaction,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { copyRetainedNoFollowFilePermissions } from '../runtime-state/physical/runtime/retained-file-permissions.ts';
import { retireSemanticMutationStagingWorkspace } from './transaction-directories.ts';
import {
  assertSemanticMutationTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';

const EXCLUDED_SOURCE_SUBTREES = Object.freeze([
  '.git', 'node_modules', '.sec/semantic-mutation', '.sec/workspace-write-lease'
] as const);
const STAGING_MAXIMUM_ENTRIES = 300_000;
const STAGING_MAXIMUM_BYTES = 1024 * 1024 * 1024;
const STAGING_TIMEOUT_MS = 30_000;

/** Aggregate physical work, not a promise of an equally large workspace. */
export function semanticMutationStagingCopyOptions(commitFence: SemanticMutationCommitFence) {
  const deadlineAtMs = performance.now() + STAGING_TIMEOUT_MS;
  function assertDeadline(): void {
    if (performance.now() >= deadlineAtMs) {
      throw Object.assign(new Error('Semantic Mutation staging copy deadline exceeded'), {
        code: 'SEMANTIC_MUTATION_STAGING_DEADLINE'
      });
    }
  }
  return Object.freeze({
    async assertCurrent(): Promise<void> {
      assertDeadline();
      await commitFence();
      assertDeadline();
    },
    deadlineAtMs,
    maximumEntries: STAGING_MAXIMUM_ENTRIES,
    maximumBytes: STAGING_MAXIMUM_BYTES,
    excludeRelativePaths: EXCLUDED_SOURCE_SUBTREES,
    preserveFilePermissionMode: true
  });
}

function changed(message: string): never {
  throw new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', message);
}

/**
 * Materializes one isolated staging workspace. A source edit is published only
 * into that private snapshot, never into the live workspace. Failure keeps a
 * rejected/incomplete snapshot for the same bounded retirement route; there is
 * no unbounded recursive rm fallback and no cleanup of unobserved entries.
 */
export async function prepareSemanticMutationStagingWorkspace(input: Readonly<{
  workspaceRoot: string;
  transactionRoot: string;
  plan: SemanticMutationSourceEditPlan;
  manifest: SemanticMutationRollbackManifest;
  originalBytes: Uint8Array;
  stagedBytes: Uint8Array;
  commitFence: SemanticMutationCommitFence;
}>): Promise<string> {
  assertSemanticMutationSourceEditArtifactsInvariant(input.plan, input.manifest);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const transactionRoot = path.resolve(input.transactionRoot);
  const relativePath = input.plan.relativePath;
  const beforeDigest = input.plan.beforeByteDigest;
  const stagedDigest = input.plan.stagedByteDigest;
  const fileMode = input.manifest.fileMode;
  const attributes = input.manifest.windowsFileAttributes;
  const windowsAttributes = attributes === null ? null :
    (attributes.readOnly ? 1 : 0) | (attributes.hidden ? 2 : 0) |
    (attributes.system ? 4 : 0) | (attributes.archive ? 32 : 0);
  if (input.originalBytes.byteLength > 64 * 1024 * 1024 || input.stagedBytes.byteLength > 64 * 1024 * 1024 ||
      input.originalBytes.byteLength !== input.manifest.beforeByteLength || input.stagedBytes.byteLength !== input.manifest.stagedByteLength) {
    changed('Staging source byte lengths are outside the admitted manifest.');
  }
  const originalBytes = Buffer.from(input.originalBytes);
  const stagedBytes = Buffer.from(input.stagedBytes);
  const commitFence = input.commitFence;
  if (originalBytes.byteLength > 64 * 1024 * 1024 || stagedBytes.byteLength > 64 * 1024 * 1024 ||
      semanticMutationByteDigest(originalBytes) !== beforeDigest || semanticMutationByteDigest(stagedBytes) !== stagedDigest ||
      relativePath.includes('\\') || relativePath.includes(':') || path.posix.isAbsolute(relativePath) ||
      relativePath.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    changed('Staging source preimage or relative path is invalid.');
  }
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'Mutation staging workspace');
  const transaction = inspectNoFollowDirectoryChain(transactionRoot, 'Mutation staging transaction');
  const stagingWorkspaceRoot = path.join(transactionRoot, 'workspace');
  const sourcePath = path.join(workspaceRoot, ...relativePath.split('/'));
  let source: RetainedNoFollowOrdinaryFile | undefined;
  let workspaceBoundary: RetainedNoFollowChildProcessDirectory | undefined;
  let transactionBoundary: RetainedNoFollowChildProcessDirectory | undefined;
  const failures: unknown[] = [];
  try {
    workspaceBoundary = retainNoFollowDirectoryForChildProcess(workspace, 4, 'Mutation staging workspace');
    transactionBoundary = retainNoFollowDirectoryForChildProcess(transaction, 5, 'Mutation staging transaction');
    source = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(sourcePath), 'Mutation staging source parent'),
      path.basename(sourcePath), undefined, 'Mutation staging source'
    );
    if (source.linkCount !== 1 || source.size !== originalBytes.length ||
        !Buffer.from(source.readBytes()).equals(originalBytes)) changed('Staging live source changed.');
    const assertCurrent = async (): Promise<void> => {
      await commitFence();
      workspaceBoundary!.assertCurrent();
      transactionBoundary!.assertCurrent();
      assertSameNoFollowDirectoryIdentity(workspace.target, 'Mutation staging workspace');
      assertSameNoFollowDirectoryIdentity(transaction.target, 'Mutation staging transaction');
      source!.assertCurrent();
    };
    await assertCurrent();
    await retireSemanticMutationStagingWorkspace(transaction.target, assertCurrent);
    const options = semanticMutationStagingCopyOptions(assertCurrent);
    await options.assertCurrent();
    await copyNoFollowDirectoryTreesBulk([{ source: workspace.target, target: stagingWorkspaceRoot }], options);
    await options.assertCurrent();
    const staging = inspectNoFollowDirectoryChain(stagingWorkspaceRoot, 'Mutation copied staging workspace').target;
    const leaf = retainNoFollowFileTransaction(staging.path, 'Mutation staged source edit');
    let leafFailure: Readonly<{ error: unknown }> | undefined;
    try {
      const copied = leaf.observe(relativePath, 'Mutation copied source');
      if (copied === null || !Buffer.from(copied.bytes).equals(originalBytes) ||
          (copied.permissionMode !== null && copied.permissionMode !== fileMode)) {
        changed('Copied staging source does not match its planned bytes and mode.');
      }
      await options.assertCurrent();
      assertSameNoFollowDirectoryIdentity(staging, 'Mutation staged source root');
      // This gap is inside an unpublished staging snapshot, not a live source
      // replacement. A failed recreation cannot be accepted as a staged plan.
      await leaf.removeExact(relativePath, copied, 'Mutation staged preimage retirement');
    } catch (error) {
      leafFailure = { error };
      throw error;
    } finally {
      try { leaf.dispose(); } catch (error) {
        if (leafFailure !== undefined) throw new AggregateError([leafFailure.error, error], 'Staging leaf edit and settlement failed');
        throw error;
      }
    }
    await options.assertCurrent();
    assertSameNoFollowDirectoryIdentity(staging, 'Mutation staged source root');
    const stagedPath = path.join(staging.path, ...relativePath.split('/'));
    const parent = inspectNoFollowDirectoryChain(path.dirname(stagedPath), 'Mutation staged source parent').target;
    const published = publishExclusiveDurableCanonicalFile({
      parent,
      name: path.basename(stagedPath),
      bytes: stagedBytes,
      permissionMode: 0o600,
      validate(bytes) {
        if (!Buffer.from(bytes).equals(stagedBytes)) changed('Staged source publication bytes differ.');
      }
    });
    if (!published.created) changed('Staged source name became occupied.');
    await options.assertCurrent();
    await copyRetainedNoFollowFilePermissions({
      source,
      target: published,
      parent,
      expectedSourceMode: fileMode,
      expectedWindowsAttributes: windowsAttributes
    });
    await options.assertCurrent();
    assertSameNoFollowDirectoryIdentity(staging, 'Mutation staged source root');
    const readback = retainNoFollowOrdinaryFile(
      assertSameNoFollowDirectoryIdentity(parent, 'Mutation staged source parent'),
      path.basename(stagedPath), published.physical, 'Mutation staged source readback'
    );
    try {
      if (readback.linkCount !== 1 || !Buffer.from(readback.readBytes()).equals(stagedBytes)) {
        changed('Staged source publication readback differs.');
      }
    } finally {
      readback.dispose();
    }
  } catch (error) {
    failures.push(error);
  } finally {
    for (const held of [source, transactionBoundary, workspaceBoundary]) {
      try { held?.dispose(); } catch (error) { failures.push(error); }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Mutation staging and settlement failed');
  return stagingWorkspaceRoot;
}
