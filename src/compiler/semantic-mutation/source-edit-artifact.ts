import {
  SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
  SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
  SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
  SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
  SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
  SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
  type SemanticMutationRollbackManifest,
  type SemanticMutationSourceEditPlan,
  type SemanticMutationSourcePathEvidence
} from '../../semantics/mutation/types.ts';
import {
  digestString,
  exactOwnKeys,
  isPlainObject,
  nonEmptyString,
  sha256
} from './canonical.ts';

export function semanticMutationSourcePathEvidenceRevision(
  value: Omit<SemanticMutationSourcePathEvidence, 'pathEvidenceRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-source-path-evidence-v1', ...value });
}

export function semanticMutationRollbackManifestDigest(
  value: Omit<SemanticMutationRollbackManifest, 'rollbackManifestDigest'>
): string {
  return sha256({ domain: 'semantic-mutation-rollback-manifest-v2', ...value });
}

export function semanticMutationSourceEditPlanRevision(
  value: Omit<SemanticMutationSourceEditPlan, 'editPlanRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-source-edit-plan-v1', ...value });
}

function windowsAttributesLookValid(
  value: SemanticMutationRollbackManifest['windowsFileAttributes']
): boolean {
  return value === null ||
    (isPlainObject(value) &&
      exactOwnKeys(value, ['readOnly', 'hidden', 'system', 'archive']) &&
      typeof value.readOnly === 'boolean' &&
      typeof value.hidden === 'boolean' &&
      typeof value.system === 'boolean' &&
      typeof value.archive === 'boolean');
}

function pathEvidenceLooksValid(
  value: unknown
): value is SemanticMutationSourcePathEvidence {
  if (!isPlainObject(value) ||
      !exactOwnKeys(value, [
        'formatRevision',
        'relativePath',
        'workspaceIdentityDigest',
        'transactionDirectoryIdentityDigest',
        'parentIdentityDigest',
        'targetIdentityDigest',
        'pathEvidenceRevision'
      ]) ||
      value.formatRevision !== SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION ||
      !nonEmptyString(value.relativePath) ||
      !digestString(value.workspaceIdentityDigest) ||
      !digestString(value.transactionDirectoryIdentityDigest) ||
      !digestString(value.parentIdentityDigest) ||
      !digestString(value.targetIdentityDigest) ||
      !digestString(value.pathEvidenceRevision)) {
    return false;
  }
  const { pathEvidenceRevision: revision, ...withoutRevision } = value;
  return revision === semanticMutationSourcePathEvidenceRevision(
    withoutRevision as Omit<
      SemanticMutationSourcePathEvidence,
      'pathEvidenceRevision'
    >
  );
}

function operationsLookValid(plan: SemanticMutationSourceEditPlan): boolean {
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    return false;
  }
  let previous = '';
  for (const operation of plan.operations) {
    if (!isPlainObject(operation) ||
        !exactOwnKeys(operation, [
          'operationId',
          'kind',
          'contract',
          'stateId',
          'from',
          'to',
          'by'
        ]) ||
        operation.kind !== 'add-state-transition' ||
        !nonEmptyString(operation.operationId) ||
        !isPlainObject(operation.contract) ||
        !exactOwnKeys(operation.contract, ['namespace', 'contractId']) ||
        operation.contract.namespace !== plan.namespace ||
        operation.contract.contractId !== plan.contractId ||
        !nonEmptyString(operation.stateId) ||
        !nonEmptyString(operation.from) ||
        !nonEmptyString(operation.to) ||
        !nonEmptyString(operation.by) ||
        operation.operationId <= previous) {
      return false;
    }
    previous = operation.operationId;
  }
  return true;
}

export function assertSemanticMutationRollbackManifestInvariant(
  manifest: SemanticMutationRollbackManifest
): void {
  if (!isPlainObject(manifest) ||
      !exactOwnKeys(manifest, [
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
      ])) {
    throw new Error(
      'Semantic Mutation rollback manifest violates the frozen v2 schema'
    );
  }
  const { rollbackManifestDigest: revision, ...withoutRevision } = manifest;
  if (manifest.formatRevision !== SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION ||
      !nonEmptyString(manifest.ownerId) ||
      manifest.adapterId !== 'semantic-contract-yaml' ||
      manifest.adapterRevision !== SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION ||
      !nonEmptyString(manifest.relativePath) ||
      !digestString(manifest.beforeByteDigest) ||
      !digestString(manifest.stagedByteDigest) ||
      !Number.isSafeInteger(manifest.beforeByteLength) ||
      manifest.beforeByteLength < 0 ||
      !Number.isSafeInteger(manifest.stagedByteLength) ||
      manifest.stagedByteLength < 0 ||
      !Number.isSafeInteger(manifest.fileMode) ||
      manifest.fileMode < 0 ||
      !windowsAttributesLookValid(manifest.windowsFileAttributes) ||
      manifest.encoding !== 'utf-8' ||
      typeof manifest.utf8Bom !== 'boolean' ||
      (manifest.lineEnding !== 'lf' &&
        manifest.lineEnding !== 'crlf' &&
        manifest.lineEnding !== 'none') ||
      typeof manifest.finalNewline !== 'boolean' ||
      !digestString(manifest.pathEvidenceRevision) ||
      !digestString(revision) ||
      revision !== semanticMutationRollbackManifestDigest(withoutRevision)) {
    throw new Error(
      'Semantic Mutation rollback manifest digest or content is invalid'
    );
  }
}

export function assertSemanticMutationSourceEditPlanInvariant(
  plan: SemanticMutationSourceEditPlan
): void {
  if (!isPlainObject(plan) ||
      !exactOwnKeys(plan, [
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
      ])) {
    throw new Error(
      'Semantic Mutation source edit plan violates the frozen v1 schema'
    );
  }
  const { editPlanRevision: revision, ...withoutRevision } = plan;
  if (plan.formatRevision !== SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION ||
      !digestString(plan.requestRevision) ||
      !digestString(plan.authorizationRevision) ||
      !digestString(plan.preflightRevision) ||
      plan.operationRegistryRevision !==
        SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION ||
      plan.sourceAdapterRegistryRevision !==
        SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION ||
      !digestString(plan.sourceResolutionRevision) ||
      !digestString(plan.sourceRevision) ||
      plan.sourceKind !== 'workspace-authoring' ||
      !nonEmptyString(plan.ownerId) ||
      plan.adapterId !== 'semantic-contract-yaml' ||
      plan.adapterRevision !== SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION ||
      !nonEmptyString(plan.namespace) ||
      !nonEmptyString(plan.contractId) ||
      !nonEmptyString(plan.relativePath) ||
      !pathEvidenceLooksValid(plan.pathEvidence) ||
      plan.pathEvidence.relativePath !== plan.relativePath ||
      !operationsLookValid(plan) ||
      !digestString(plan.beforeByteDigest) ||
      !digestString(plan.stagedByteDigest) ||
      !digestString(plan.rollbackManifestDigest) ||
      !digestString(revision) ||
      revision !== semanticMutationSourceEditPlanRevision(withoutRevision)) {
    throw new Error(
      'Semantic Mutation source edit plan digest or content is invalid'
    );
  }
}

export function assertSemanticMutationSourceEditArtifactsInvariant(
  plan: SemanticMutationSourceEditPlan,
  manifest: SemanticMutationRollbackManifest
): void {
  assertSemanticMutationSourceEditPlanInvariant(plan);
  assertSemanticMutationRollbackManifestInvariant(manifest);
  if (manifest.rollbackManifestDigest !== plan.rollbackManifestDigest ||
      manifest.ownerId !== plan.ownerId ||
      manifest.adapterId !== plan.adapterId ||
      manifest.adapterRevision !== plan.adapterRevision ||
      manifest.relativePath !== plan.relativePath ||
      manifest.beforeByteDigest !== plan.beforeByteDigest ||
      manifest.stagedByteDigest !== plan.stagedByteDigest ||
      manifest.pathEvidenceRevision !== plan.pathEvidence.pathEvidenceRevision) {
    throw new Error(
      'Semantic Mutation edit plan and rollback manifest are not exact paired artifacts'
    );
  }
}
