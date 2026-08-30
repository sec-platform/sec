import { SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION, SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION, SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION, SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION, type SemanticMutationLoadedSourceCandidate, type SemanticMutationPreflight, type SemanticMutationPreflightInput, type SemanticMutationRollbackManifest, type SemanticMutationSourceEditPlan, type SemanticMutationSourceEditPlanningRejectedAt, type SemanticMutationSourceEditPlanningResult, type SemanticMutationSourcePathEvidence } from '../../semantic/mutation/contract/types.ts';
import {
  SemanticMutationContractError,
  canonicalEquals,
  cloneAndDeepFreeze,
  digestString,
  exactOwnKeys,
  isPlainObject,
  mutationDiagnostic,
  nonEmptyString,
  sha256
} from './canonical.ts';
import { normalizeSemanticMutationRequest } from './normalize-request.ts';
import { preflightSemanticMutation } from './preflight-semantic-mutation.ts';
import {
  renderSemanticContractYamlEdit,
  semanticMutationByteDigest,
  transformSemanticContractYaml
} from './semantic-contract-yaml-adapter.ts';
import { resolveSemanticMutationSource } from './source-adapter-registry.ts';
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

function pathEvidenceRevision(value: Omit<SemanticMutationSourcePathEvidence, 'pathEvidenceRevision'>): string {
  return sha256({ domain: 'semantic-mutation-source-path-evidence-v1', ...value });
}

function rollbackManifestDigest(
  value: Omit<SemanticMutationRollbackManifest, 'rollbackManifestDigest'>
): string {
  return sha256({ domain: 'semantic-mutation-rollback-manifest-v2', ...value });
}

function windowsAttributesLookValid(value: SemanticMutationRollbackManifest['windowsFileAttributes']): boolean {
  return value === null || (isPlainObject(value) && exactOwnKeys(value, [
    'readOnly', 'hidden', 'system', 'archive'
  ]) && typeof value.readOnly === 'boolean' && typeof value.hidden === 'boolean' &&
    typeof value.system === 'boolean' && typeof value.archive === 'boolean');
}

function sourceEditPlanRevision(value: Omit<SemanticMutationSourceEditPlan, 'editPlanRevision'>): string {
  return sha256({ domain: 'semantic-mutation-source-edit-plan-v1', ...value });
}

function pathEvidenceLooksValid(value: unknown): value is SemanticMutationSourcePathEvidence {
  if (!isPlainObject(value) || !exactOwnKeys(value, [
    'formatRevision',
    'relativePath',
    'workspaceIdentityDigest',
    'transactionDirectoryIdentityDigest',
    'parentIdentityDigest',
    'targetIdentityDigest',
    'pathEvidenceRevision'
  ]) || value.formatRevision !== SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION ||
    !nonEmptyString(value.relativePath) || !digestString(value.workspaceIdentityDigest) ||
    !digestString(value.transactionDirectoryIdentityDigest) || !digestString(value.parentIdentityDigest) ||
    !digestString(value.targetIdentityDigest) || !digestString(value.pathEvidenceRevision)) {
    return false;
  }
  const { pathEvidenceRevision: revision, ...withoutRevision } = value;
  return revision === pathEvidenceRevision(withoutRevision as Omit<
    SemanticMutationSourcePathEvidence,
    'pathEvidenceRevision'
  >);
}

function operationsLookValid(plan: SemanticMutationSourceEditPlan): boolean {
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) return false;
  let previous = '';
  for (const operation of plan.operations) {
    if (!isPlainObject(operation) || !exactOwnKeys(operation, [
      'operationId', 'kind', 'contract', 'stateId', 'from', 'to', 'by'
    ]) || operation.kind !== 'add-state-transition' || !nonEmptyString(operation.operationId) ||
      !isPlainObject(operation.contract) || !exactOwnKeys(operation.contract, ['namespace', 'contractId']) ||
      operation.contract.namespace !== plan.namespace || operation.contract.contractId !== plan.contractId ||
      !nonEmptyString(operation.stateId) || !nonEmptyString(operation.from) ||
      !nonEmptyString(operation.to) || !nonEmptyString(operation.by) || operation.operationId <= previous) {
      return false;
    }
    previous = operation.operationId;
  }
  return true;
}

export function assertSemanticMutationRollbackManifestInvariant(
  manifest: SemanticMutationRollbackManifest
): void {
  if (!isPlainObject(manifest) || !exactOwnKeys(manifest, [
    'formatRevision',
    'ownerId',
    'adapterId',
    'adapterRevision',
    'relativePath',
    'beforeByteDigest',
    'stagedByteDigest',
    'beforeByteLength',
    'stagedByteLength',
    'fileMode',
    'windowsFileAttributes',
    'encoding',
    'utf8Bom',
    'lineEnding',
    'finalNewline',
    'pathEvidenceRevision',
    'rollbackManifestDigest'
  ])) throw new Error('Semantic Mutation rollback manifest violates the frozen v2 schema');
  const { rollbackManifestDigest: revision, ...withoutRevision } = manifest;
  if (manifest.formatRevision !== SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION ||
    !nonEmptyString(manifest.ownerId) || manifest.adapterId !== 'semantic-contract-yaml' ||
    manifest.adapterRevision !== SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION ||
    !nonEmptyString(manifest.relativePath) || !digestString(manifest.beforeByteDigest) ||
    !digestString(manifest.stagedByteDigest) || !Number.isSafeInteger(manifest.beforeByteLength) ||
    manifest.beforeByteLength < 0 || !Number.isSafeInteger(manifest.stagedByteLength) ||
    manifest.stagedByteLength < 0 || !Number.isSafeInteger(manifest.fileMode) || manifest.fileMode < 0 ||
    !windowsAttributesLookValid(manifest.windowsFileAttributes) ||
    manifest.encoding !== 'utf-8' ||
    typeof manifest.utf8Bom !== 'boolean' ||
    (manifest.lineEnding !== 'lf' && manifest.lineEnding !== 'crlf' && manifest.lineEnding !== 'none') ||
    typeof manifest.finalNewline !== 'boolean' || !digestString(manifest.pathEvidenceRevision) ||
    !digestString(revision) || revision !== rollbackManifestDigest(withoutRevision)) {
    throw new Error('Semantic Mutation rollback manifest digest or content is invalid');
  }
}

export function assertSemanticMutationSourceEditPlanInvariant(plan: SemanticMutationSourceEditPlan): void {
  if (!isPlainObject(plan) || !exactOwnKeys(plan, [
    'formatRevision',
    'requestRevision',
    'authorizationRevision',
    'preflightRevision',
    'operationRegistryRevision',
    'sourceAdapterRegistryRevision',
    'sourceResolutionRevision',
    'sourceRevision',
    'sourceKind',
    'ownerId',
    'adapterId',
    'adapterRevision',
    'namespace',
    'contractId',
    'relativePath',
    'pathEvidence',
    'operations',
    'beforeByteDigest',
    'stagedByteDigest',
    'rollbackManifestDigest',
    'editPlanRevision'
  ])) throw new Error('Semantic Mutation source edit plan violates the frozen v1 schema');
  const { editPlanRevision: revision, ...withoutRevision } = plan;
  if (plan.formatRevision !== SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION ||
    !digestString(plan.requestRevision) || !digestString(plan.authorizationRevision) ||
    !digestString(plan.preflightRevision) ||
    plan.operationRegistryRevision !== SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION ||
    plan.sourceAdapterRegistryRevision !== SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION ||
    !digestString(plan.sourceResolutionRevision) || !digestString(plan.sourceRevision) ||
    plan.sourceKind !== 'workspace-authoring' ||
    !nonEmptyString(plan.ownerId) || plan.adapterId !== 'semantic-contract-yaml' ||
    plan.adapterRevision !== SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION || !nonEmptyString(plan.namespace) ||
    !nonEmptyString(plan.contractId) || !nonEmptyString(plan.relativePath) ||
    !pathEvidenceLooksValid(plan.pathEvidence) || plan.pathEvidence.relativePath !== plan.relativePath ||
    !operationsLookValid(plan) || !digestString(plan.beforeByteDigest) || !digestString(plan.stagedByteDigest) ||
    !digestString(plan.rollbackManifestDigest) || !digestString(revision) ||
    revision !== sourceEditPlanRevision(withoutRevision)) {
    throw new Error('Semantic Mutation source edit plan digest or content is invalid');
  }
}

export function assertSemanticMutationSourceEditArtifactsInvariant(
  plan: SemanticMutationSourceEditPlan,
  manifest: SemanticMutationRollbackManifest
): void {
  assertSemanticMutationSourceEditPlanInvariant(plan);
  assertSemanticMutationRollbackManifestInvariant(manifest);
  if (manifest.rollbackManifestDigest !== plan.rollbackManifestDigest ||
    manifest.ownerId !== plan.ownerId || manifest.adapterId !== plan.adapterId ||
    manifest.adapterRevision !== plan.adapterRevision || manifest.relativePath !== plan.relativePath ||
    manifest.beforeByteDigest !== plan.beforeByteDigest || manifest.stagedByteDigest !== plan.stagedByteDigest ||
    manifest.pathEvidenceRevision !== plan.pathEvidence.pathEvidenceRevision) {
    throw new Error('Semantic Mutation edit plan and rollback manifest are not exact paired artifacts');
  }
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
    rollbackManifestDigest: rollbackManifestDigest(rollbackWithoutRevision)
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
    editPlanRevision: sourceEditPlanRevision(planWithoutRevision)
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
