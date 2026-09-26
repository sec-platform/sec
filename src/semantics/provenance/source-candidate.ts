import { deepFreeze, rawSha256Hex } from '../../contracts/canonical.ts';
import type { LoadedSemanticContract } from '../definitions/types.ts';
import type { SemanticMutationLoadedSourceCandidate, SemanticMutationSourceKind } from '../mutation/types.ts';

export function semanticContractSourceRevision(
  sourceKind: SemanticMutationSourceKind,
  loadedContract: LoadedSemanticContract
): string {
  const payload = JSON.stringify({
    domain: 'semantic-mutation-loaded-source-v1',
    sourceKind,
    blockId: loadedContract.blockId,
    contractPath: loadedContract.contractPath,
    contract: loadedContract.contract
  });
  return `sha256:${rawSha256Hex(payload)}`;
}

export function buildSemanticContractSourceCandidate(
  sourceKind: SemanticMutationSourceKind,
  loadedContract: LoadedSemanticContract
): SemanticMutationLoadedSourceCandidate {
  const captured = structuredClone(loadedContract);
  // Fingerprint the same snapshot we return, not a second read of the caller.
  // The existing digest format and field order are deliberately unchanged.
  return deepFreeze({
    sourceKind,
    loadedContract: captured,
    sourceRevision: semanticContractSourceRevision(sourceKind, captured)
  });
}
