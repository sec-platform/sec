import { expect, test } from 'bun:test';

import { sha256 } from '../../src/compiler/semantic-mutation/canonical.ts';
import { assertSemanticMutationRollbackManifestInvariant, assertSemanticMutationSourceEditArtifactsInvariant, assertSemanticMutationSourceEditPlanInvariant } from '../../src/compiler/semantic-mutation/source-edit-artifact.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_ID, SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION, SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION, SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION, SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION, type SemanticMutationRollbackManifest, type SemanticMutationSourceEditPlan } from '../../src/semantics/mutation/types.ts';

function vectors(): {
  readonly manifest: SemanticMutationRollbackManifest;
  readonly plan: SemanticMutationSourceEditPlan;
} {
  const pathEvidenceWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
    relativePath: 'model/item.yaml',
    workspaceIdentityDigest: sha256('workspace'),
    transactionDirectoryIdentityDigest: sha256('transaction'),
    parentIdentityDigest: sha256('parent'),
    targetIdentityDigest: sha256('target')
  } as const;
  const pathEvidence = {
    ...pathEvidenceWithoutRevision,
    pathEvidenceRevision: sha256({
      domain: 'semantic-mutation-source-path-evidence-v1',
      ...pathEvidenceWithoutRevision
    })
  };
  const manifestWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
    ownerId: 'semantic-contract-owner:item:item-core',
    adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
    adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
    relativePath: 'model/item.yaml',
    beforeByteDigest: sha256('before-bytes'),
    stagedByteDigest: sha256('staged-bytes'),
    beforeByteLength: 100,
    stagedByteLength: 140,
    fileMode: 0o644,
    windowsFileAttributes: null,
    encoding: 'utf-8' as const,
    utf8Bom: false,
    lineEnding: 'lf' as const,
    finalNewline: true,
    pathEvidenceRevision: pathEvidence.pathEvidenceRevision
  } as const;
  const manifest = {
    ...manifestWithoutRevision,
    rollbackManifestDigest: sha256({
      domain: 'semantic-mutation-rollback-manifest-v2',
      ...manifestWithoutRevision
    })
  };
  const planWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
    requestRevision: sha256('request'),
    authorizationRevision: sha256('authorization'),
    preflightRevision: sha256('preflight'),
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
    sourceResolutionRevision: sha256('source-resolution'),
    sourceRevision: sha256('source'),
    sourceKind: 'workspace-authoring' as const,
    ownerId: manifest.ownerId,
    adapterId: manifest.adapterId,
    adapterRevision: manifest.adapterRevision,
    namespace: 'item',
    contractId: 'item-core',
    relativePath: manifest.relativePath,
    pathEvidence,
    operations: [{
      operationId: 'operation:add-transition',
      kind: 'add-state-transition' as const,
      contract: { namespace: 'item', contractId: 'item-core' },
      stateId: 'item-status',
      from: 'open',
      to: 'closed',
      by: 'closeItem'
    }],
    beforeByteDigest: manifest.beforeByteDigest,
    stagedByteDigest: manifest.stagedByteDigest,
    rollbackManifestDigest: manifest.rollbackManifestDigest
  } as const;
  const plan = {
    ...planWithoutRevision,
    editPlanRevision: sha256({ domain: 'semantic-mutation-source-edit-plan-v1', ...planWithoutRevision })
  };
  return { manifest, plan };
}

test('SM-2 edit-plan and rollback vectors satisfy the exact validators', () => {
  const { manifest, plan } = vectors();
  expect(() => assertSemanticMutationRollbackManifestInvariant(manifest)).not.toThrow();
  expect(() => assertSemanticMutationSourceEditPlanInvariant(plan)).not.toThrow();
  expect(() => assertSemanticMutationSourceEditArtifactsInvariant(plan, manifest)).not.toThrow();
});

test('unknown fields, stale revisions, digest forgery, and non-canonical operation order fail closed', () => {
  const { manifest, plan } = vectors();
  expect(() => assertSemanticMutationRollbackManifestInvariant({
    ...manifest,
    backupPath: '.sec/backup/item.yaml'
  } as never)).toThrow('schema');
  expect(() => assertSemanticMutationRollbackManifestInvariant({
    ...manifest,
    rollbackManifestDigest: sha256('forged')
  })).toThrow('digest');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    absolutePath: 'C:\\workspace\\source\\model\\item.yaml'
  } as never)).toThrow('schema');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    adapterRevision: 'semantic-contract-yaml-v0'
  } as never)).toThrow('digest');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    operations: [
      { ...plan.operations[0]!, operationId: 'operation:z' },
      { ...plan.operations[0]!, operationId: 'operation:a', from: 'closed', to: 'open' }
    ]
  } as never)).toThrow('digest');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    pathEvidence: { ...plan.pathEvidence, targetIdentityDigest: sha256('forged-target') }
  })).toThrow('digest');
  const mismatchedManifestWithoutRevision = {
    ...manifest,
    stagedByteDigest: sha256('other-staged')
  };
  const { rollbackManifestDigest: _ignored, ...mismatchedWithoutDigest } = mismatchedManifestWithoutRevision;
  const mismatchedManifest = {
    ...mismatchedWithoutDigest,
    rollbackManifestDigest: sha256({
      domain: 'semantic-mutation-rollback-manifest-v2',
      ...mismatchedWithoutDigest
    })
  };
  expect(() => assertSemanticMutationSourceEditArtifactsInvariant(plan, mismatchedManifest)).toThrow('paired');
});
