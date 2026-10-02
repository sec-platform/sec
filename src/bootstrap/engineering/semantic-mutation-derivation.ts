import { prepareSemanticMutationDerivationScope, semanticMutationStagedRebuildDiagnostic } from '../../adapters/mutation/derive-staged-mutation.ts';
import { planSemanticMutationSourceEdit, renderSemanticMutationSourceEdit } from '../../adapters/mutation/plan-source-edit.ts';
import { readSemanticMutationSource } from '../../adapters/mutation/source-path-boundary.ts';
import { prepareSemanticMutationStagingWorkspace } from '../../adapters/mutation/staging-workspace.ts';
import type { SemanticMutationCommitFence } from '../../adapters/mutation/transaction-identity.ts';
import { buildWorkspaceSemanticBundle } from '../../adapters/workspace/semantic-bundle.ts';
import { deriveSemanticMutation, type SemanticMutationPlanningCapability } from '../../application/semantic-mutation-derivation.ts';
import type { SemanticMutationTransactionInput } from '../../semantics/mutation/transaction.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION } from '../../semantics/mutation/types.ts';
export type { DerivedSemanticMutationTransaction } from '../../application/semantic-mutation-derivation.ts';

/** Bind the staged mutation use case to existing physical providers. */
export function deriveStagedSemanticMutation(
  workspaceRoot: string,
  input: SemanticMutationTransactionInput,
  verificationAdapter: SemanticMutationPlanningCapability,
  commitFence: SemanticMutationCommitFence
) {
  return deriveSemanticMutation(input, verificationAdapter, {
    readCurrentBundle: () => buildWorkspaceSemanticBundle(workspaceRoot),
    prepareScope: identity => prepareSemanticMutationDerivationScope(workspaceRoot, identity, commitFence),
    assertScope: scope => scope.assertCurrent(),
    planSourceEdit: (scope, selected) => planSemanticMutationSourceEdit({
      ...selected,
      sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
      workspaceRoot,
      transactionDirectory: scope.pathProofDirectory
    }),
    readOriginalBytes: async (scope, relativePath) => (await readSemanticMutationSource(
      workspaceRoot, scope.transactionRoot, relativePath
    )).bytes,
    renderSourceEdit: renderSemanticMutationSourceEdit,
    prepareWorkspace: async (scope, selected) => { await prepareSemanticMutationStagingWorkspace({
      ...selected,
      workspaceRoot,
      transactionRoot: scope.transactionRoot,
      commitFence: scope.assertCurrent
    }); },
    readStagedBundle: scope => buildWorkspaceSemanticBundle(scope.stagingWorkspaceRoot),
    stagedRebuildDiagnostic: semanticMutationStagedRebuildDiagnostic
  });
}
