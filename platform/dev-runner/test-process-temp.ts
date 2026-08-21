import { rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveSecWorkspaceRuntimeRootsV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';
import {
  assertPhysicallyDisjointDirectoryChainsV1,
  assertSameNoFollowDirectoryIdentityV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  physicallyContainsDirectoryChainV1,
  type PhysicalDirectoryChainV1
} from '../shared/physical-no-follow.ts';

export interface TestProcessTempRootV1 {
  readonly processRoot: string;
  readonly tempRoot: string;
  readonly cleanup: () => void;
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
      assertSameNoFollowDirectoryIdentityV1(hostTemp.target, 'SEC test OS temp cleanup parent');
      assertSameNoFollowDirectoryIdentityV1(processGeneration.target, 'SEC test process cleanup generation');
      if (path.dirname(processRoot) !== hostTempRoot
        || !path.basename(processRoot).startsWith('sec-test-process-')) return;
      rmSync(processRoot, { recursive: true, force: true });
    } catch {
      // Ambiguous or replaced generations are preserved instead of risking a
      // recursive delete against anything other than the created object.
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
    cleanup();
    throw error;
  }
}
