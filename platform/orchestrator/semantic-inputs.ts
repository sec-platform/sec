import {
  loadManifestForResolvedBlock,
  loadSemanticContractsForManifestEntry
} from '../compiler/index.ts';
import type { ResolvedBlock } from '../shared/lock-types.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';
import type { LoadedSemanticContract } from '../shared/semantic-contract-types.ts';

export interface WorkspaceSemanticInputs {
  manifestEntries: ManifestEntry[];
  semanticContracts: LoadedSemanticContract[];
}

export async function loadWorkspaceSemanticInputs(
  workspaceRoot: string,
  resolvedBlocks: readonly ResolvedBlock[]
): Promise<WorkspaceSemanticInputs> {
  const manifestEntries = await Promise.all(
    resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );
  const semanticContracts = (await Promise.all(
    manifestEntries.map((entry) => loadSemanticContractsForManifestEntry(entry))
  )).flat();

  return { manifestEntries, semanticContracts };
}
