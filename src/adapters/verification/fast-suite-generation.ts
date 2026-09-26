import os from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../contracts/canonical.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { settleResourcesAsync } from '../../execution/resource-settlement.ts';
import {
  createExclusiveNoFollowRandomDirectory,
  inspectNoFollowDirectoryChain,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeInventory,
  scanNoFollowDirectoryTreeSelectedForest,
  type NoFollowDirectoryTreeEntry,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  materializeSealedExecutionTree,
  retainMutableSealedExecutionProtectedRoot,
  type RetainedSealedExecutionTreeGeneration
} from '../runtime-state/physical/runtime/sealed-execution-tree-generation.ts';

const FAST_SUITE_GENERATION_MAXIMUM_ENTRIES = 300_000;
const FAST_SUITE_GENERATION_MAXIMUM_BYTES = 1024 * 1024 * 1024;
const FAST_SUITE_GENERATION_DURATION_MS = 180_000;

export interface FastSuiteExecutionGeneration {
  readonly generation: RetainedSealedExecutionTreeGeneration;
  readonly sourceRoot: PhysicalDirectoryIdentity;
  readonly inputDigest: `sha256:${string}`;
  assertCurrent(): Promise<void>;
  retire(): Promise<void>;
}

function snapshotEqual(
  left: readonly NoFollowDirectoryTreeEntry[],
  right: readonly NoFollowDirectoryTreeEntry[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.relativePath !== b.relativePath || a.kind !== b.kind
        || a.device !== b.device || a.inode !== b.inode
        || a.size !== b.size || a.linkTarget !== b.linkTarget
        || a.permissionMode !== b.permissionMode) return false;
    if (a.bytes === null || b.bytes === null) {
      if (a.bytes !== b.bytes) return false;
    } else if (!Buffer.from(a.bytes).equals(Buffer.from(b.bytes))) {
      return false;
    }
  }
  return true;
}

function exactTree(snapshot: readonly NoFollowDirectoryTreeEntry[]) {
  if (snapshot.some(({ kind }) => kind === 'link')) {
    throw new Error('Fast suite sealed generation does not admit workspace links');
  }
  return Object.freeze({
    directories: Object.freeze(snapshot
      .filter(({ kind }) => kind === 'directory')
      .map(({ relativePath }) => relativePath)),
    files: Object.freeze(snapshot
      .filter((entry): entry is NoFollowDirectoryTreeEntry & Readonly<{ bytes: Uint8Array }> =>
        entry.kind === 'file' && entry.bytes !== null)
      .map((entry) => Object.freeze({
        bytes: Buffer.from(entry.bytes),
        path: entry.relativePath,
        ...(entry.permissionMode === null || entry.permissionMode === undefined
          ? {}
          : { permissionMode: entry.permissionMode })
      })))
  });
}

function selectedTopLevelPaths(
  root: PhysicalDirectoryIdentity,
  deadlineAtMs: number
): Readonly<{
  includeRelativePaths: readonly string[];
}> {
  const direct = scanNoFollowDirectoryDirectMetadata(root, {
    deadlineAtMs,
    maximumEntries: FAST_SUITE_GENERATION_MAXIMUM_ENTRIES
  });
  const excluded = new Set([
    '.runtime-deps.stamp.json',
    'coverage',
    'test-results'
  ]);
  const includeRelativePaths = Object.freeze(direct
    .map(({ relativePath }) => relativePath)
    .filter((relativePath) => !excluded.has(relativePath))
    .sort());
  return Object.freeze({ includeRelativePaths });
}

function sameTopLevelPaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function readSnapshot(
  root: PhysicalDirectoryIdentity,
  includeRelativePaths: readonly string[],
  deadlineAtMs: number,
  signal: AbortSignal | undefined
): readonly NoFollowDirectoryTreeEntry[] {
  if (includeRelativePaths.length === 0) return Object.freeze([]);
  return scanNoFollowDirectoryTreeSelectedForest(root, {
    deadlineAtMs,
    includeRelativePaths,
    maximumBytes: FAST_SUITE_GENERATION_MAXIMUM_BYTES,
    maximumEntries: FAST_SUITE_GENERATION_MAXIMUM_ENTRIES,
    includePermissionMode: process.platform === 'linux',
    signal
  });
}

async function retireEmptyGenerationParent(
  hostTempRoot: PhysicalDirectoryIdentity,
  generationParent: PhysicalDirectoryIdentity
): Promise<void> {
  const deadlineAtMonotonicMs = performance.now() + 30_000;
  const inventory = scanNoFollowDirectoryTreeInventory(generationParent, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumBytes: 0,
    maximumEntries: 1
  });
  if (inventory.length !== 0) {
    throw new Error('Fast suite generation parent retained unexpected residue');
  }
  retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs,
    inventory,
    parent: hostTempRoot,
    root: generationParent
  });
}

export async function materializeFastSuiteExecutionGeneration(input: Readonly<{
  workspaceRoot: string;
  commitFence?: CommitFence;
  signal?: AbortSignal;
}>): Promise<FastSuiteExecutionGeneration> {
  const startedAtUnixMs = Date.now();
  const deadlineAtUnixMs = startedAtUnixMs + FAST_SUITE_GENERATION_DURATION_MS;
  const deadlineAtMonotonicMs = performance.now() + FAST_SUITE_GENERATION_DURATION_MS;
  const assertCurrent = async (): Promise<void> => {
    input.signal?.throwIfAborted();
    if (Date.now() >= deadlineAtUnixMs || performance.now() >= deadlineAtMonotonicMs) {
      throw new Error('Fast suite execution generation deadline exceeded');
    }
    await input.commitFence?.();
    input.signal?.throwIfAborted();
  };

  const sourceChain = inspectNoFollowDirectoryChain(
    path.resolve(input.workspaceRoot),
    'Fast suite sealed source workspace'
  );
  const sourceRoot = sourceChain.target;
  const protectedRoot = retainMutableSealedExecutionProtectedRoot(sourceRoot);
  const hostTempRoot = inspectNoFollowDirectoryChain(
    os.tmpdir(),
    'Fast suite generation host temp root'
  ).target;
  const generationParent = createExclusiveNoFollowRandomDirectory(
    hostTempRoot,
    'sec-fast-suite-generation-parent-'
  );
  let generation: RetainedSealedExecutionTreeGeneration | undefined;

  try {
    await assertCurrent();
    await protectedRoot.assertCurrent();
    const selection = selectedTopLevelPaths(sourceRoot, deadlineAtMonotonicMs);
    const before = readSnapshot(
      sourceRoot,
      selection.includeRelativePaths,
      deadlineAtMonotonicMs,
      input.signal
    );
    const exact = exactTree(before);
    const files = exact.files;
    await assertCurrent();
    await protectedRoot.assertCurrent();

    // The Semantic Mutation isolated runtime has already materialized an exact
    // node_modules tree into this staging workspace. Seal those actual bytes.
    // The prebound v1 marker carries only a manifest hash and cannot prove
    // byte-for-byte equivalence with a different host dependency generation.
    const inputDigest = sha256({
      domain: 'verification.fast-suite.sealed-input-v3',
      directories: exact.directories,
      files: files.map((file) => Object.freeze({
        path: file.path,
        byteDigest: rawSha256(file.bytes),
        permissionMode: file.permissionMode ?? null
      }))
    }) as `sha256:${string}`;

    generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs,
      directoryNamePrefix: 'fast-suite-generation-',
      directories: exact.directories,
      files,
      generationParent,
      links: [],
      maximumBytes: FAST_SUITE_GENERATION_MAXIMUM_BYTES,
      maximumEntries: FAST_SUITE_GENERATION_MAXIMUM_ENTRIES,
      protectedRoots: [protectedRoot],
      signal: input.signal
    });

    await assertCurrent();
    await protectedRoot.assertCurrent();
    const afterSelection = selectedTopLevelPaths(sourceRoot, deadlineAtMonotonicMs);
    if (!sameTopLevelPaths(selection.includeRelativePaths, afterSelection.includeRelativePaths)) {
      throw new Error('Fast suite source top-level membership changed while its sealed generation was materialized');
    }
    const after = readSnapshot(
      sourceRoot,
      afterSelection.includeRelativePaths,
      deadlineAtMonotonicMs,
      input.signal
    );
    const finalSelection = selectedTopLevelPaths(sourceRoot, deadlineAtMonotonicMs);
    if (!sameTopLevelPaths(afterSelection.includeRelativePaths, finalSelection.includeRelativePaths)) {
      throw new Error('Fast suite source top-level membership changed during final snapshot');
    }
    if (!snapshotEqual(before, after)) {
      throw new Error('Fast suite source snapshot changed while its sealed generation was materialized');
    }
    await generation.assertCurrent();

    let retired = false;
    let retirement: Promise<void> | undefined;
    const issued: FastSuiteExecutionGeneration = Object.freeze({
      generation,
      sourceRoot: Object.freeze({ ...sourceRoot }),
      inputDigest,
      assertCurrent: async () => {
        if (retired) throw new Error('Fast suite execution generation is retired');
        await generation!.assertCurrent();
      },
      retire: () => {
        if (retirement !== undefined) return retirement;
        retired = true;
        retirement = (async () => {
          let retirementPrimary: Readonly<{ error: unknown }> | undefined;
          try {
            await generation!.retire();
          } catch (error) {
            retirementPrimary = Object.freeze({ error });
          }
          await settleResourcesAsync({
            ...(retirementPrimary === undefined
              ? {}
              : { primary: { label: 'fast suite sealed generation', error: retirementPrimary.error } }),
            cleanup: [
              {
                label: 'fast suite protected source root',
                settle: () => protectedRoot.release()
              },
              {
                label: 'fast suite generation parent',
                settle: async () => {
                  await retireEmptyGenerationParent(hostTempRoot, generationParent);
                }
              }
            ]
          });
        })();
        return retirement;
      }
    });
    return issued;
  } catch (error) {
    await settleResourcesAsync({
      primary: { label: 'fast suite generation setup', error },
      cleanup: [
        ...(generation === undefined ? [] : [{
          label: 'fast suite partial generation',
          settle: async () => { await generation!.retire(); }
        }]),
        {
          label: 'fast suite protected source root',
          settle: () => protectedRoot.release()
        },
        {
          label: 'fast suite generation parent',
          settle: async () => {
            await retireEmptyGenerationParent(hostTempRoot, generationParent);
          }
        }
      ]
    });
    throw error;
  }
}
