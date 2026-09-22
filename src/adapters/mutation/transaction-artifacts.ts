import path from 'node:path';

import type { SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan } from '../../semantics/mutation/types.ts';
import { SemanticMutationContractError, canonicalEquals, mutationDiagnostic, semanticMutationByteDigest } from '../../compiler/semantic-mutation/canonical.ts';
import { assertSemanticMutationSourceEditArtifactsInvariant } from '../../compiler/semantic-mutation/source-edit-artifact.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  flushNoFollowDirectory,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
import { createSemanticMutationTransactionDirectory } from './transaction-directories.ts';

export interface SemanticMutationTransactionArtifacts {
  readonly backupPath: string;
  readonly stagedSourcePath: string;
  readonly editPlanPath: string;
  readonly rollbackManifestPath: string;
}

const ARTIFACT_NAMES = Object.freeze([
  'original.backup', 'staged-source', 'source-edit-plan.json', 'rollback-manifest.json'
] as const);
type ArtifactName = typeof ARTIFACT_NAMES[number];

// Four fixed members, each within the physical owner's bounded byte domain.
// Source modes/Windows attributes belong to the rollback manifest, not to the
// journal's private byte containers. Existing artifacts are never chmod'ed.
const ARTIFACT_MAXIMUM_BYTES = 64 * 1024 * 1024;

function artifactFailure(message: string, relativePath = ''): SemanticMutationContractError {
  return new SemanticMutationContractError(mutationDiagnostic(
    'SEMANTIC-MUTATION-007', 'cas', message,
    relativePath === '' ? {} : { relativePath }
  ));
}

function boundedBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > ARTIFACT_MAXIMUM_BYTES) {
    throw artifactFailure('Transaction artifact exceeds the bounded byte domain');
  }
  return new Uint8Array(bytes);
}

function metadataBytes(value: unknown): Uint8Array {
  return boundedBytes(new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
}

function parseMetadata(bytes: Uint8Array): unknown {
  // Re-encoding also rejects invalid UTF-8, duplicate keys and noncanonical
  // JSON. This is the exact format emitted by the existing journal writer.
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw artifactFailure('Transaction metadata is not valid UTF-8 JSON');
  }
  if (!Buffer.from(metadataBytes(value)).equals(Buffer.from(bytes))) {
    throw artifactFailure('Transaction metadata is not in its canonical byte format');
  }
  return value;
}

interface ArtifactSet {
  readonly root: PhysicalDirectoryIdentity;
  readonly files: ReadonlyMap<ArtifactName, RetainedNoFollowOrdinaryFile>;
  assertCurrent(): void;
}

async function withArtifacts<T>(
  chain: PhysicalDirectoryChain,
  allowMissing: boolean,
  consume: (set: ArtifactSet) => T | Promise<T>
): Promise<T> {
  const files = new Map<ArtifactName, RetainedNoFollowOrdinaryFile>();
  let boundary: RetainedNoFollowChildProcessDirectory | undefined;
  const failures: unknown[] = [];
  let result!: T;
  try {
    boundary = retainNoFollowDirectoryForChildProcess(chain, 4, 'Mutation artifact root');
    for (const name of ARTIFACT_NAMES) {
      // The presence probe classifies absence without following a leaf and
      // binds the subsequent retention to that exact FileId/inode.
      const observed = inspectNoFollowOrdinaryFileEntry(chain.target, name, {
        maximumBytes: ARTIFACT_MAXIMUM_BYTES
      });
      if (observed === null) {
        if (allowMissing) continue;
        throw new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_ABSENT', 'Mutation artifact is absent');
      }
      const file = retainNoFollowOrdinaryFile(
        chain, name, { device: observed.device, inode: observed.inode }, 'Mutation artifact'
      );
      files.set(name, file);
      if (file.linkCount !== 1 || file.size > ARTIFACT_MAXIMUM_BYTES) {
        throw artifactFailure('Transaction artifact must be a bounded unaliased ordinary file');
      }
    }
    const assertCurrent = (): void => {
      boundary!.assertCurrent();
      assertSameNoFollowDirectoryIdentity(chain.target, 'Mutation artifact root');
      for (const file of files.values()) file.assertCurrent();
    };
    assertCurrent();
    result = await consume({ root: chain.target, files, assertCurrent });
    assertCurrent();
  } catch (error) {
    failures.push(error);
  } finally {
    // One close failure must not leak the remaining retained leaves/ancestors.
    for (const file of [...files.values()].reverse()) {
      try { file.dispose(); } catch (error) { failures.push(error); }
    }
    try { boundary?.dispose(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Mutation artifact operation and settlement failed');
  return result;
}

function decodeArtifacts(set: ArtifactSet): {
  readonly plan: SemanticMutationSourceEditPlan;
  readonly manifest: SemanticMutationRollbackManifest;
  readonly originalBytes: Uint8Array;
  readonly stagedBytes: Uint8Array;
} {
  const read = (name: ArtifactName): Uint8Array => {
    const file = set.files.get(name);
    if (file === undefined) throw artifactFailure('Transaction artifact tuple is incomplete');
    return boundedBytes(file.readBytes());
  };
  const plan = parseMetadata(read('source-edit-plan.json')) as SemanticMutationSourceEditPlan;
  const manifest = parseMetadata(read('rollback-manifest.json')) as SemanticMutationRollbackManifest;
  assertSemanticMutationSourceEditArtifactsInvariant(plan, manifest);
  const originalBytes = read('original.backup');
  const stagedBytes = read('staged-source');
  if (semanticMutationByteDigest(originalBytes) !== manifest.beforeByteDigest ||
      semanticMutationByteDigest(stagedBytes) !== manifest.stagedByteDigest ||
      originalBytes.byteLength !== manifest.beforeByteLength ||
      stagedBytes.byteLength !== manifest.stagedByteLength) {
    throw artifactFailure('Retained transaction bytes do not match the frozen rollback manifest', plan.relativePath);
  }
  set.assertCurrent();
  return { plan, manifest, originalBytes, stagedBytes };
}

export async function readSemanticMutationTransactionArtifacts(transactionRoot: string) {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  const chain = inspectNoFollowDirectoryChain(transactionRoot, 'Mutation artifact root');
  return withArtifacts(chain, false, decodeArtifacts);
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
  // Snapshot caller-owned inputs before the first await. A later callback or
  // caller mutation cannot change bytes after their digest was admitted.
  const expected = new Map<ArtifactName, Uint8Array>([
    ['original.backup', boundedBytes(originalBytes)],
    ['staged-source', boundedBytes(stagedBytes)],
    ['source-edit-plan.json', metadataBytes(plan)],
    ['rollback-manifest.json', metadataBytes(manifest)]
  ]);
  const capturedPlan = parseMetadata(expected.get('source-edit-plan.json')!) as SemanticMutationSourceEditPlan;
  const capturedManifest = parseMetadata(expected.get('rollback-manifest.json')!) as SemanticMutationRollbackManifest;
  assertSemanticMutationSourceEditArtifactsInvariant(capturedPlan, capturedManifest);
  if (semanticMutationByteDigest(expected.get('original.backup')!) !== capturedManifest.beforeByteDigest ||
      semanticMutationByteDigest(expected.get('staged-source')!) !== capturedManifest.stagedByteDigest ||
      expected.get('original.backup')!.byteLength !== capturedManifest.beforeByteLength ||
      expected.get('staged-source')!.byteLength !== capturedManifest.stagedByteLength) {
    throw artifactFailure('Transaction backup or staged source does not match the frozen byte manifest', capturedPlan.relativePath);
  }
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  const root = await createSemanticMutationTransactionDirectory(
    workspaceRoot, transactionRoot, commitFence
  );
  const chain = assertSameNoFollowDirectoryIdentity(root, 'Mutation artifact root');
  await withArtifacts(chain, true, async (before) => {
    // Validate the whole existing tuple before creating any missing member.
    // A conflict never licenses replacing an occupied artifact name.
    for (const [name, file] of before.files) {
      const actual = file.readBytes();
      const wanted = expected.get(name)!;
      const matches = name.endsWith('.json')
        ? canonicalEquals(parseMetadata(actual), parseMetadata(wanted))
        : Buffer.from(actual).equals(Buffer.from(wanted));
      if (!matches) throw artifactFailure('Retained transaction artifact conflicts with the current plan', capturedPlan.relativePath);
    }
    const created = new Map<ArtifactName, Readonly<{ device: string; inode: string }>>();
    for (const name of ARTIFACT_NAMES) {
      await commitFence();
      before.assertCurrent();
      if (before.files.has(name)) continue;
      const bytes = expected.get(name)!;
      const receipt = publishExclusiveDurableCanonicalFile({
        parent: root,
        name,
        bytes,
        permissionMode: 0o600,
        validate(actual) {
          if (!Buffer.from(actual).equals(Buffer.from(bytes))) {
            throw artifactFailure('Published transaction artifact differs from admitted bytes', capturedPlan.relativePath);
          }
        }
      });
      if (!receipt.created) {
        throw artifactFailure('A transaction artifact name became occupied during publication', capturedPlan.relativePath);
      }
      created.set(name, receipt.physical);
    }
    await commitFence();
    before.assertCurrent();
    await withArtifacts(chain, false, (after) => {
      for (const [name, identity] of created) {
        const file = after.files.get(name)!;
        if (file.physical.device !== identity.device || file.physical.inode !== identity.inode) {
          throw artifactFailure('Published transaction artifact identity changed', capturedPlan.relativePath);
        }
      }
      const readback = decodeArtifacts(after);
      if (!canonicalEquals(readback.plan, capturedPlan) || !canonicalEquals(readback.manifest, capturedManifest)) {
        throw artifactFailure('Transaction metadata readback differs from the admitted plan', capturedPlan.relativePath);
      }
      flushNoFollowDirectory(root);
      after.assertCurrent();
    });
  });
  return {
    backupPath: path.join(transactionRoot, 'original.backup'),
    stagedSourcePath: path.join(transactionRoot, 'staged-source'),
    editPlanPath: path.join(transactionRoot, 'source-edit-plan.json'),
    rollbackManifestPath: path.join(transactionRoot, 'rollback-manifest.json')
  };
}
