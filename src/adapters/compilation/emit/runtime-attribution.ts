import type { BlockManifest, LockFile } from '../../../compiler/contract.ts';
import {
  buildRuntimeAttributionsFromManifests
} from '../../../assurance/verification/review/runtime-attribution.ts';
import type { ReviewRuntimeEntry } from '../../../assurance/verification/review/contract/types.ts';
import { loadManifestForResolvedBlock } from '../../workspace/sources/load-manifest.ts';

/** Capture resolved Block manifests, then delegate attribution truth to Assurance. */
export async function buildRuntimeAttributions(
  lock: LockFile,
  targetPaths: readonly string[],
  workspaceRoot = process.cwd()
): Promise<ReviewRuntimeEntry[]> {
  const loaded = await Promise.all(
    lock.resolvedBlocks.map(async block => {
      const entry = await loadManifestForResolvedBlock(workspaceRoot, block);
      return [block.id, entry.manifest] as const;
    })
  );
  const manifests = new Map<string, BlockManifest>();
  for (const [blockId, manifest] of loaded) manifests.set(blockId, manifest);
  return buildRuntimeAttributionsFromManifests(lock, targetPaths, manifests);
}
