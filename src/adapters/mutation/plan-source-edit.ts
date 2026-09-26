import {
  SemanticMutationContractError,
  canonicalEquals,
  cloneAndDeepFreeze,
  mutationDiagnostic,
  semanticMutationByteDigest
} from '../../compiler/semantic-mutation/canonical.ts';
import { normalizeSemanticMutationRequest } from '../../compiler/semantic-mutation/normalize-request.ts';
import { preflightSemanticMutation } from '../../compiler/semantic-mutation/preflight.ts';
import { resolveSemanticMutationSource } from '../../compiler/semantic-mutation/source-adapter-registry.ts';
import {
  assertSemanticMutationRollbackManifestInvariant,
  assertSemanticMutationSourceEditArtifactsInvariant,
  assertSemanticMutationSourceEditPlanInvariant,
  semanticMutationRollbackManifestDigest,
  semanticMutationSourceEditPlanRevision
} from '../../compiler/semantic-mutation/source-edit-artifact.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION, SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION, SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION, type SemanticMutationLoadedSourceCandidate, type SemanticMutationPreflight, type SemanticMutationPreflightInput, type SemanticMutationSourceEditPlan, type SemanticMutationSourceEditPlanningRejectedAt, type SemanticMutationSourceEditPlanningResult } from '../../semantics/mutation/types.ts';
import {
  renderSemanticContractYamlEdit,
  transformSemanticContractYaml
} from './semantic-contract-yaml-adapter.ts';
import { readSemanticMutationSource } from './source-path-boundary.ts';

export interface SemanticMutationSourceEditPlanningInput extends SemanticMutationPreflightInput {
  readonly preflight: SemanticMutationPreflight;
  readonly sourceAdapterRegistryRevision: string;
  readonly adapterRevision: string;
  readonly sourceCandidates: readonly SemanticMutationLoadedSourceCandidate[];
  readonly workspaceRoot: string;
  readonly transactionDirectory: string;
}

function rejected(
  rejectedAt: SemanticMutationSourceEditPlanningRejectedAt,
  preflightRevision: string,
  error: SemanticMutationContractError
): SemanticMutationSourceEditPlanningResult {
  return cloneAndDeepFreeze({
    status: 'rejected',
    rejectedAt,
    preflightRevision,
    diagnostics: [error.diagnostic]
  });
}

function sourceResolutionFailure(
  preflightRevision: string,
  message: string
): SemanticMutationSourceEditPlanningResult {
  return cloneAndDeepFreeze({
    status: 'rejected',
    rejectedAt: 'source-resolution',
    preflightRevision,
    diagnostics: [mutationDiagnostic('SEMANTIC-MUTATION-004', 'source-resolution', message)]
  });
}

export async function planSemanticMutationSourceEdit(
  input: SemanticMutationSourceEditPlanningInput
): Promise<SemanticMutationSourceEditPlanningResult> {
  const freshPreflight = preflightSemanticMutation({
    request: input.request,
    base: input.base,
    authorization: input.authorization
  });
  const suppliedRevision = 'preflightRevision' in input.preflight ? input.preflight.preflightRevision : '';
  if (freshPreflight.status !== 'ready' || !canonicalEquals(freshPreflight, input.preflight)) {
    return sourceResolutionFailure(suppliedRevision, 'Source planning requires the exact recomputed ready preflight');
  }
  if (input.sourceAdapterRegistryRevision !== SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION ||
    input.adapterRevision !== SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION) {
    return sourceResolutionFailure(freshPreflight.preflightRevision, 'Source adapter registry or adapter revision mismatch');
  }
  const request = normalizeSemanticMutationRequest(input.request);
  const resolution = resolveSemanticMutationSource(
    request,
    input.base,
    input.authorization,
    input.sourceCandidates
  );
  if (resolution.status === 'rejected') {
    return cloneAndDeepFreeze({
      status: 'rejected',
      rejectedAt: 'source-resolution',
      preflightRevision: freshPreflight.preflightRevision,
      diagnostics: resolution.diagnostics
    });
  }

  let read;
  try {
    read = await readSemanticMutationSource(
      input.workspaceRoot,
      input.transactionDirectory,
      resolution.source.relativePath
    );
  } catch (error) {
    if (error instanceof SemanticMutationContractError) {
      return rejected(
        error.diagnostic.stage === 'cas' ? 'cas' : 'path',
        freshPreflight.preflightRevision,
        error
      );
    }
    return sourceResolutionFailure(freshPreflight.preflightRevision, 'Source path boundary failed without trusted evidence');
  }

  let transform;
  try {
    transform = transformSemanticContractYaml(
      read.bytes,
      resolution.source.loadedContract,
      resolution.source.operations
    );
  } catch (error) {
    if (error instanceof SemanticMutationContractError) {
      return rejected('transform', freshPreflight.preflightRevision, error);
    }
    return cloneAndDeepFreeze({
      status: 'rejected',
      rejectedAt: 'transform',
      preflightRevision: freshPreflight.preflightRevision,
      diagnostics: [mutationDiagnostic(
        'SEMANTIC-MUTATION-006',
        'transform',
        'Semantic contract adapter failed without trusted deterministic evidence'
      )]
    });
  }

  const rollbackWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
    ownerId: resolution.source.ownerId,
    adapterId: resolution.source.adapterId,
    adapterRevision: resolution.source.adapterRevision,
    relativePath: resolution.source.relativePath,
    beforeByteDigest: transform.beforeByteDigest,
    stagedByteDigest: transform.stagedByteDigest,
    beforeByteLength: read.bytes.byteLength,
    stagedByteLength: transform.stagedBytes.byteLength,
    fileMode: read.fileMode,
    windowsFileAttributes: read.windowsFileAttributes,
    encoding: 'utf-8' as const,
    utf8Bom: transform.utf8Bom,
    lineEnding: transform.lineEnding,
    finalNewline: transform.finalNewline,
    pathEvidenceRevision: read.pathEvidence.pathEvidenceRevision
  } as const;
  const rollbackManifest = cloneAndDeepFreeze({
    ...rollbackWithoutRevision,
    rollbackManifestDigest: semanticMutationRollbackManifestDigest(rollbackWithoutRevision)
  });
  const planWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
    requestRevision: request.requestRevision,
    authorizationRevision: freshPreflight.authorizationRevision,
    preflightRevision: freshPreflight.preflightRevision,
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
    sourceResolutionRevision: resolution.source.sourceResolutionRevision,
    sourceRevision: resolution.source.sourceRevision,
    sourceKind: resolution.source.sourceKind,
    ownerId: resolution.source.ownerId,
    adapterId: resolution.source.adapterId,
    adapterRevision: resolution.source.adapterRevision,
    namespace: resolution.source.loadedContract.contract.namespace,
    contractId: resolution.source.loadedContract.contract.id,
    relativePath: resolution.source.relativePath,
    pathEvidence: read.pathEvidence,
    operations: resolution.source.operations,
    beforeByteDigest: transform.beforeByteDigest,
    stagedByteDigest: transform.stagedByteDigest,
    rollbackManifestDigest: rollbackManifest.rollbackManifestDigest
  } as const;
  const plan = cloneAndDeepFreeze({
    ...planWithoutRevision,
    editPlanRevision: semanticMutationSourceEditPlanRevision(planWithoutRevision)
  });
  assertSemanticMutationRollbackManifestInvariant(rollbackManifest);
  assertSemanticMutationSourceEditPlanInvariant(plan);
  assertSemanticMutationSourceEditArtifactsInvariant(plan, rollbackManifest);
  return cloneAndDeepFreeze({ status: 'planned', plan, rollbackManifest });
}

export function renderSemanticMutationSourceEdit(
  plan: SemanticMutationSourceEditPlan,
  currentBytes: Uint8Array
): Uint8Array {
  assertSemanticMutationSourceEditPlanInvariant(plan);
  if (semanticMutationByteDigest(currentBytes) !== plan.beforeByteDigest) {
    throw new SemanticMutationContractError(mutationDiagnostic(
      'SEMANTIC-MUTATION-007',
      'cas',
      'Current source bytes do not match the planned before-byte CAS digest',
      { relativePath: plan.relativePath }
    ));
  }
  const transform = renderSemanticContractYamlEdit(currentBytes, plan.operations);
  if (transform.beforeByteDigest !== plan.beforeByteDigest || transform.stagedByteDigest !== plan.stagedByteDigest) {
    throw new SemanticMutationContractError(mutationDiagnostic(
      'SEMANTIC-MUTATION-006',
      'transform',
      'Deterministic source transform no longer matches the frozen edit plan',
      { relativePath: plan.relativePath }
    ));
  }
  return new Uint8Array(transform.stagedBytes);
}
