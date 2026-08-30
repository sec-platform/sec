import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { assertPhysicallyDisjointDirectoryChains, assertSameNoFollowDirectoryIdentity, createExclusiveNoFollowDirectory, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, physicallyContainsDirectoryChain, PhysicalNoFollowError, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryChain } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority } from '../../runtime-state/workspace-state/physical-authority.ts';
export interface TestProcessTempRoot {
  readonly processRoot: string;
  readonly tempRoot: string;
  readonly cleanup: () => void;
}

export interface TestInvocationRuntimeRoots {
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly cleanup: () => void;
}

const TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS = 10_000;

export function testInvocationRuntimeIsolationModeForPlatform(
  platform: NodeJS.Platform
): 'retained' | 'unavailable' {
  return platform === 'win32' || platform === 'linux' ? 'retained' : 'unavailable';
}

function isReplacementSafeCleanupPreservation(error: unknown): boolean {
  return error instanceof PhysicalNoFollowError
    && (error.code === 'PHYSICAL_NO_FOLLOW_ABSENT'
      || error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED');
}

function deleteOwnedDirectoryGeneration(
  generation: PhysicalDirectoryChain,
  label: string
): void {
  const inventory = scanNoFollowDirectoryTreeMetadata(generation.target, {
    deadlineAtMs: performance.now() + TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS,
    maximumEntries: 100_000
  });
  const directories = new Map(inventory
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => [entry.relativePath, entry]));
  for (const entry of [...inventory].sort((left, right) => {
    const depth = (value: string): number => value.split('/').length;
    return depth(right.relativePath) - depth(left.relativePath) ||
      right.relativePath.localeCompare(left.relativePath);
  })) {
    const components = entry.relativePath.split('/');
    components.pop();
    const ancestorDirectories = components.map((_, index) => {
      const relativePath = components.slice(0, index + 1).join('/');
      const ancestor = directories.get(relativePath);
      if (ancestor === undefined) throw new Error(`${label} cleanup inventory is incomplete.`);
      return Object.freeze({ relativePath, device: ancestor.device, inode: ancestor.inode });
    });
    deleteRetainedNoFollowEntry({
      root: generation.target,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories
    });
  }
  const parent = generation.ancestors.at(-2);
  if (parent === undefined) throw new Error(`${label} has no retained parent.`);
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(generation.target.path),
    kind: 'directory',
    device: generation.target.device,
    inode: generation.target.inode,
    ancestorDirectories: []
  });
}

function createExclusiveOwnedDirectoryGeneration(
  parent: PhysicalDirectoryChain,
  name: string
): PhysicalDirectoryChain {
  const target = createExclusiveNoFollowDirectory(parent.target, name);
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
  physicalRoot: PhysicalDirectoryChain,
  label: string
): void {
  let cursor = path.resolve(absolutePath);
  for (;;) {
    const presence = inspectExactNoFollowDirectoryPresence(cursor, label);
    if (presence.state === 'present') {
      if (cursor === path.resolve(absolutePath)) {
        assertPhysicallyDisjointDirectoryChains(physicalRoot, presence.directory, label);
      } else if (physicallyContainsDirectoryChain(physicalRoot, presence.directory)) {
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
}>): Promise<TestProcessTempRoot> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const hostTempRoot = path.resolve(input.hostTempRoot);
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment: input.environment });

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

  const hostTemp = inspectNoFollowDirectoryChain(hostTempRoot, 'SEC test OS temp root');
  const repository = inspectNoFollowDirectoryChain(repositoryRoot, 'SEC test repository root');
  assertPhysicallyDisjointDirectoryChains(hostTemp, repository, 'SEC test OS temp root and repository');
  assertLocationOutsidePhysicalRoot(roots.stateRoot, hostTemp, 'Runtime State root');
  assertLocationOutsidePhysicalRoot(roots.cacheRoot, hostTemp, 'Runtime Cache root');

  const processRoot = await fs.mkdtemp(path.join(hostTempRoot, 'sec-test-process-'));
  let processGeneration: PhysicalDirectoryChain | null = null;
  const cleanup = (): void => {
    if (processGeneration === null) return;
    try {
      if (path.dirname(processRoot) !== hostTempRoot
        || !path.basename(processRoot).startsWith('sec-test-process-')) return;
      deleteOwnedDirectoryGeneration(processGeneration, 'SEC test process cleanup generation');
    } catch (error) {
      // Only a proven absence or identity replacement is a safe preservation
      // outcome. Operational failures remain visible to the preload owner.
      if (!isReplacementSafeCleanupPreservation(error)) throw error;
    }
  };

  try {
    assertSameNoFollowDirectoryIdentity(hostTemp.target, 'SEC test OS temp creation parent');
    processGeneration = inspectNoFollowDirectoryChain(processRoot, 'SEC test process temp generation');
    assertPhysicallyDisjointDirectoryChains(
      processGeneration, repository, 'SEC test process temp generation and repository'
    );
    assertLocationOutsidePhysicalRoot(roots.stateRoot, hostTemp, 'Runtime State root readback');
    assertLocationOutsidePhysicalRoot(roots.cacheRoot, hostTemp, 'Runtime Cache root readback');
    const tempRoot = path.join(processRoot, 'tmp');
    await fs.mkdir(tempRoot);
    inspectNoFollowDirectoryChain(tempRoot, 'SEC test process TMP root');
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
export async function createTestInvocationRuntimeRoots(input: Readonly<{
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<TestInvocationRuntimeRoots> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment: input.environment });
  const generationName = `run-${randomBytes(32).toString('hex')}`;
  const stateParentPath = path.join(roots.stateRoot, 'test-invocation-runs', 'v1');
  const cacheParentPath = path.join(roots.cacheRoot, 'test-invocation-runs', 'v1');

  let state: PhysicalDirectoryChain | null = null;
  let cache: PhysicalDirectoryChain | null = null;
  const cleanupGeneration = (generation: PhysicalDirectoryChain | null, label: string): void => {
    if (generation === null) return;
    deleteOwnedDirectoryGeneration(generation, label);
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
    const authority = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot: roots.stateRoot,
      cacheRoot: roots.cacheRoot,
      requiredDirectories: [stateParentPath, cacheParentPath]
    });
    state = createExclusiveOwnedDirectoryGeneration(
      authority.directoryChain(stateParentPath), generationName
    );
    cache = createExclusiveOwnedDirectoryGeneration(
      authority.directoryChain(cacheParentPath), generationName
    );
    await authority.assertCurrent();
    assertPhysicallyDisjointDirectoryChains(state, cache, 'SEC test invocation State and Cache generations');
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
