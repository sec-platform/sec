import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { acquireSecRuntimeStatePhysicalAuthorityV1 } from '../../tooling/sec-dev/runtime-state-authority.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';
import {
  assertPhysicallyDisjointDirectoryChainsV1,
  assertSameNoFollowDirectoryIdentityV1,
  createExclusiveNoFollowDirectoryV1,
  deleteRetainedNoFollowEntryV1,
  deleteRetainedNoFollowInventoryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  physicallyContainsDirectoryChainV1,
  PhysicalNoFollowError,
  scanNoFollowDirectoryTreeMetadataV1,
  type PhysicalDirectoryChainV1
} from '../shared/physical-no-follow.ts';
import { encodeSecRuntimeOpaquePathTokenV1 } from '../shared/sec-runtime-state-contract.ts';
export interface TestProcessTempRootV1 {
  readonly processRoot: string;
  readonly tempRoot: string;
  readonly cleanup: () => void;
}

export interface TestInvocationRuntimeRootsV1 {
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly cleanup: () => void;
}

const TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS = 10_000;

export function testInvocationRuntimeIsolationModeForPlatformV1(
  platform: NodeJS.Platform
): 'retained' | 'unavailable' {
  return platform === 'win32' || platform === 'linux' ? 'retained' : 'unavailable';
}

function isReplacementSafeCleanupPreservation(error: unknown): boolean {
  return error instanceof PhysicalNoFollowError
    && (error.code === 'PHYSICAL_NO_FOLLOW_ABSENT'
      || error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED');
}

function deleteOwnedDirectoryGenerationV1(
  generation: PhysicalDirectoryChainV1,
  label: string
): void {
  const inventory = scanNoFollowDirectoryTreeMetadataV1(generation.target, {
    deadlineAtMs: performance.now() + TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS,
    maximumEntries: 100_000
  });
  deleteRetainedNoFollowInventoryV1({ root: generation.target, inventory });
  const parent = generation.ancestors.at(-2);
  if (parent === undefined) throw new Error(`${label} has no retained parent.`);
  deleteRetainedNoFollowEntryV1({
    root: parent,
    relativePath: path.basename(generation.target.path),
    kind: 'directory',
    device: generation.target.device,
    inode: generation.target.inode,
    ancestorDirectories: []
  });
}

function createExclusiveOwnedDirectoryGenerationV1(
  parent: PhysicalDirectoryChainV1,
  name: string
): PhysicalDirectoryChainV1 {
  const target = createExclusiveNoFollowDirectoryV1(parent.target, name);
  return Object.freeze({
    target,
    ancestors: Object.freeze([...parent.ancestors, target])
  });
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = process.platform === 'win32'
    ? path.resolve(candidate).toLowerCase()
    : path.resolve(candidate);
  const normalizedParent = process.platform === 'win32'
    ? path.resolve(parent).toLowerCase()
    : path.resolve(parent);
  const relative = path.relative(normalizedParent, normalizedCandidate);
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertLexicallyDisjoint(left: string, right: string, label: string): void {
  if (isSameOrInside(left, right) || isSameOrInside(right, left)) {
    throw new Error(`SEC test process temp ${label} must be disjoint.`);
  }
}

async function canonicalPlannedPath(absolutePath: string): Promise<string> {
  let cursor = path.resolve(absolutePath);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(await fs.realpath(cursor), ...missing.reverse());
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function assertLocationOutsidePhysicalRoot(
  absolutePath: string,
  physicalRoot: PhysicalDirectoryChainV1,
  label: string
): void {
  let cursor = path.resolve(absolutePath);
  for (;;) {
    const presence = inspectExactNoFollowDirectoryPresenceV1(cursor, label);
    if (presence.state === 'present') {
      if (cursor === path.resolve(absolutePath)) {
        assertPhysicallyDisjointDirectoryChainsV1(physicalRoot, presence.directory, label);
      } else if (physicallyContainsDirectoryChainV1(physicalRoot, presence.directory)) {
        throw new Error(`SEC test process temp ${label} planned location is inside the OS temp physical root.`);
      }
      return;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`SEC test process temp ${label} has no existing no-follow ancestor.`);
    }
    cursor = parent;
  }
}

/**
 * Creates one process-owned temporary generation outside repository, Runtime
 * State and Runtime Cache authority. The caller owns lifecycle registration;
 * cleanup is identity-bound and deliberately preserves ambiguous replacements.
 */
export async function createTestProcessTempRootV1(input: Readonly<{
  repositoryRoot: string;
  hostTempRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<TestProcessTempRootV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const hostTempRoot = path.resolve(input.hostTempRoot);
  const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot, environment: input.environment });

  assertLexicallyDisjoint(hostTempRoot, repositoryRoot, 'OS temp root and repository');
  assertLexicallyDisjoint(hostTempRoot, roots.stateRoot, 'OS temp root and Runtime State');
  assertLexicallyDisjoint(hostTempRoot, roots.cacheRoot, 'OS temp root and Runtime Cache');

  if (process.platform === 'darwin') {
    const [physicalHostTempRoot, physicalRepositoryRoot, physicalStateRoot, physicalCacheRoot] =
      await Promise.all([
        canonicalPlannedPath(hostTempRoot),
        canonicalPlannedPath(repositoryRoot),
        canonicalPlannedPath(roots.stateRoot),
        canonicalPlannedPath(roots.cacheRoot)
      ]);
    assertLexicallyDisjoint(physicalHostTempRoot, physicalRepositoryRoot, 'physical OS temp root and repository');
    assertLexicallyDisjoint(physicalHostTempRoot, physicalStateRoot, 'physical OS temp root and Runtime State');
    assertLexicallyDisjoint(physicalHostTempRoot, physicalCacheRoot, 'physical OS temp root and Runtime Cache');

    const processRoot = await fs.mkdtemp(path.join(physicalHostTempRoot, 'sec-test-process-'));
    const tempRoot = path.join(processRoot, 'tmp');
    await fs.mkdir(tempRoot);
    input.environment.TMPDIR = tempRoot;
    input.environment.TMP = tempRoot;
    input.environment.TEMP = tempRoot;
    // Darwin supplies no path API that can recursively delete only if the
    // created directory identity is still current. The OS temporary lifecycle
    // owns reclamation, so this capability intentionally has no delete effect.
    return Object.freeze({ processRoot, tempRoot, cleanup: () => undefined });
  }

  const hostTemp = inspectNoFollowDirectoryChainV1(hostTempRoot, 'SEC test OS temp root');
  const repository = inspectNoFollowDirectoryChainV1(repositoryRoot, 'SEC test repository root');
  assertPhysicallyDisjointDirectoryChainsV1(hostTemp, repository, 'SEC test OS temp root and repository');
  assertLocationOutsidePhysicalRoot(roots.stateRoot, hostTemp, 'Runtime State root');
  assertLocationOutsidePhysicalRoot(roots.cacheRoot, hostTemp, 'Runtime Cache root');

  const processRoot = await fs.mkdtemp(path.join(hostTempRoot, 'sec-test-process-'));
  let processGeneration: PhysicalDirectoryChainV1 | null = null;
  const cleanup = (): void => {
    if (processGeneration === null) return;
    try {
      if (path.dirname(processRoot) !== hostTempRoot
        || !path.basename(processRoot).startsWith('sec-test-process-')) return;
      deleteOwnedDirectoryGenerationV1(processGeneration, 'SEC test process cleanup generation');
    } catch (error) {
      // Only a proven absence or identity replacement is a safe preservation
      // outcome. Operational failures remain visible to the preload owner.
      if (!isReplacementSafeCleanupPreservation(error)) throw error;
    }
  };

  try {
    assertSameNoFollowDirectoryIdentityV1(hostTemp.target, 'SEC test OS temp creation parent');
    processGeneration = inspectNoFollowDirectoryChainV1(processRoot, 'SEC test process temp generation');
    assertPhysicallyDisjointDirectoryChainsV1(
      processGeneration, repository, 'SEC test process temp generation and repository'
    );
    assertLocationOutsidePhysicalRoot(roots.stateRoot, hostTemp, 'Runtime State root readback');
    assertLocationOutsidePhysicalRoot(roots.cacheRoot, hostTemp, 'Runtime Cache root readback');
    const tempRoot = path.join(processRoot, 'tmp');
    await fs.mkdir(tempRoot);
    inspectNoFollowDirectoryChainV1(tempRoot, 'SEC test process TMP root');
    input.environment.TMPDIR = tempRoot;
    input.environment.TMP = tempRoot;
    input.environment.TEMP = tempRoot;
    return Object.freeze({ processRoot, tempRoot, cleanup });
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'SEC test process temp preparation and cleanup failed.');
    }
    throw error;
  }
}

/**
 * Allocates one invocation-owned State/Cache pair beneath their canonical
 * external roots. Children may freely materialize within the pair; cleanup is
 * bound to the two exact directory objects and preserves replacements.
 */
export async function createTestInvocationRuntimeRootsV1(input: Readonly<{
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<TestInvocationRuntimeRootsV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot, environment: input.environment });
  // The retained physical identity, not the presentation path, owns this
  // generation. 128 random bits plus exclusive creation preserve collision
  // safety without consuming the Windows descendant-path budget twice.
  const generationName = `r-${encodeSecRuntimeOpaquePathTokenV1(randomBytes(16))}`;
  const stateParentPath = path.join(roots.stateRoot, 't', '1');
  const cacheParentPath = path.join(roots.cacheRoot, 't', '1');

  let state: PhysicalDirectoryChainV1 | null = null;
  let cache: PhysicalDirectoryChainV1 | null = null;
  const cleanupGeneration = (generation: PhysicalDirectoryChainV1 | null, label: string): void => {
    if (generation === null) return;
    deleteOwnedDirectoryGenerationV1(generation, label);
  };
  const cleanup = (): void => {
    const failures: unknown[] = [];
    for (const [generation, label] of [
      [cache, 'SEC test invocation Cache cleanup generation'],
      [state, 'SEC test invocation State cleanup generation']
    ] as const) {
      try {
        cleanupGeneration(generation, label);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'SEC test invocation runtime cleanup failed.');
    }
  };

  try {
    const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
      repositoryRoot,
      stateRoot: roots.stateRoot,
      cacheRoot: roots.cacheRoot,
      requiredDirectories: [stateParentPath, cacheParentPath]
    });
    state = createExclusiveOwnedDirectoryGenerationV1(
      authority.directoryChain(stateParentPath), generationName
    );
    cache = createExclusiveOwnedDirectoryGenerationV1(
      authority.directoryChain(cacheParentPath), generationName
    );
    await authority.assertCurrent();
    assertPhysicallyDisjointDirectoryChainsV1(state, cache, 'SEC test invocation State and Cache generations');
    return Object.freeze({ stateRoot: state.target.path, cacheRoot: cache.target.path, cleanup });
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'SEC test invocation runtime preparation and cleanup failed.');
    }
    throw error;
  }
}
