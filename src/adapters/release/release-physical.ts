import path from 'node:path';

import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowRandomDirectory,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeMetadata,
  type NoFollowDirectoryTreeRetirementReceipt,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';

const RELEASE_PHYSICAL_CLEANUP_BUDGET_MS = 30_000;
const RELEASE_PHYSICAL_CLEANUP_MAXIMUM_ENTRIES = 100_000;

export function materializeReleaseDirectory(
  absolutePath: string,
  label: string
): PhysicalDirectoryIdentity {
  const target = path.resolve(absolutePath);
  let cursor = target;
  const missing: string[] = [];
  for (;;) {
    const presence = inspectExactNoFollowDirectoryPresence(cursor, `${label} ancestor`);
    if (presence.state === 'present') {
      const materialized = missing.length === 0
        ? presence.directory.target
        : createNoFollowOrdinaryDirectoryChain(
            presence.directory.target,
            missing,
            undefined,
            0o755
          );
      const readback = inspectNoFollowDirectoryChain(target, `${label} readback`).target;
      if (materialized.device !== readback.device
          || materialized.inode !== readback.inode
          || materialized.objectId !== readback.objectId) {
        throw new Error(`${label} physical identity changed during materialization`);
      }
      return readback;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`${label} has no existing physical ancestor`);
    }
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
}

export function allocateReleaseStage(
  parent: PhysicalDirectoryIdentity,
  prefix: string
): PhysicalDirectoryIdentity {
  return createExclusiveNoFollowRandomDirectory(
    assertSameNoFollowDirectoryIdentity(parent, 'Release stage parent').target,
    prefix
  );
}

export function retireReleaseTree(
  root: PhysicalDirectoryIdentity,
  parent: PhysicalDirectoryIdentity,
  label: string
): NoFollowDirectoryTreeRetirementReceipt {
  const deadlineAtMonotonicMs = performance.now() + RELEASE_PHYSICAL_CLEANUP_BUDGET_MS;
  const retainedRoot = assertSameNoFollowDirectoryIdentity(root, `${label} root`).target;
  const retainedParent = assertSameNoFollowDirectoryIdentity(parent, `${label} parent`).target;
  const inventory = scanNoFollowDirectoryTreeMetadata(retainedRoot, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: RELEASE_PHYSICAL_CLEANUP_MAXIMUM_ENTRIES
  });
  return retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs,
    inventory,
    parent: retainedParent,
    root: retainedRoot
  });
}
