export type {
  SemanticMutationApplyInputV1,
  SemanticMutationApplyOutcomeV1,
  SemanticMutationRecoveryFailureState,
  SemanticMutationRecoveryOutcomeV1,
  SemanticMutationRecoveryState,
  SemanticMutationRequestIdentityV1,
  SemanticMutationRequestRecordViewV1,
  SemanticMutationTransactionInputV1
} from '../shared/semantic-mutation-transaction-types.ts';
export type * from '../shared/semantic-mutation-types.ts';
export { alignInterfaces } from './align/align-interfaces.ts';
export { buildCiArtifactManifest } from './emit/ci-artifacts.ts';
export { readReviewGovernanceReports } from './emit/read-review-governance-reports.ts';
export { semanticViewArtifactsAreCurrent } from './emit/semantic-view-artifact-contract.ts';
export {
  buildExplainGraph,
  renderExplainGraphDot,
  renderExplainGraphMermaid
} from './emit/write-explain-graph.ts';
export { buildLocalViewArtifacts } from './emit/write-local-views.ts';
export { buildProvenance } from './emit/write-provenance.ts';
export {
  buildProvenanceSummary,
  buildReviewSummary,
  buildSemanticViewSummary
} from './emit/write-review-summary.ts';
export {
  buildEngineeringIR,
  type BuildEngineeringIRInput,
  type EngineeringIRManifestInput
} from './ir/build-engineering-ir.ts';
export { buildFactDelta } from './ir/build-fact-delta.ts';
export {
  indexEngineeringIR,
  indexValidatedEngineeringIR,
  type EngineeringIRIndex
} from './ir/index-engineering-ir.ts';
export { loadWorkspaceEngineeringIRBuildInput } from './ir/load-workspace-engineering-ir-input.ts';
export {
  buildValidatedEngineeringIR,
  validateEngineeringIR
} from './ir/validate-engineering-ir.ts';
export {
  loadAuthoringSemanticContractSources
} from './parse/load-authoring-semantic-contracts.ts';
export { loadManifestById, loadManifestForResolvedBlock } from './parse/load-manifest.ts';
export { loadOverrideManifest } from './parse/load-override-manifest.ts';
export { loadPlan, loadWorkspacePlan } from './parse/load-plan.ts';
export { loadPolicyDeclarations } from './parse/load-policy-declarations.ts';
export {
  loadSemanticContractsForManifestEntry,
  normalizeSemanticContract
} from './parse/load-semantic-contract.ts';
export { buildSemanticViewSet } from './projection/build-semantic-view-set.ts';
export { projectArchitectureView } from './projection/project-architecture-view.ts';
export { projectScenarioView } from './projection/project-scenario-view.ts';
export { projectStateView } from './projection/project-state-view.ts';
export { buildSemanticInspector } from './projection/semantic-view-utils.ts';
export {
  buildRepairPlan,
  previewRepairPlan
} from './repair/build-repair-plan.ts';
export { resolveGraph } from './resolve/resolve-graph.ts';
export {
  buildWorkspaceSemanticBundle,
  type WorkspaceSemanticBundle
} from './semantic-frontend.ts';
export { buildImpactPropagation } from './semantic-impact/build-impact-propagation.ts';
export {
  linkWorkspaceSemanticContracts,
  splitLinkedSemanticReference
} from './semantic-linker.ts';
export { normalizeSemanticMutationRequest } from './semantic-mutation/normalize-request.ts';
export {
  assertSemanticMutationPlanInvariant,
  planSemanticMutation
} from './semantic-mutation/plan-semantic-mutation.ts';
export {
  assertSemanticMutationRollbackManifestInvariant,
  assertSemanticMutationSourceEditArtifactsInvariant,
  assertSemanticMutationSourceEditPlanInvariant,
  planSemanticMutationSourceEdit,
  renderSemanticMutationSourceEdit,
  type SemanticMutationSourceEditPlanningInputV1
} from './semantic-mutation/plan-source-edit.ts';
export { preflightSemanticMutation } from './semantic-mutation/preflight-semantic-mutation.ts';
export {
  assertSemanticMutationResultInvariant,
  buildSemanticMutationResult,
  type SemanticMutationTerminalEvidenceV2
} from './semantic-mutation/semantic-mutation-result.ts';
export {
  semanticMutationRequestIdentityDigest,
  semanticMutationStagedTransactionId
} from './semantic-mutation/transaction-identity.ts';
export { buildSemanticMutationVerificationPlanningContext } from './semantic-mutation/verification-policy.ts';
export { buildSemanticGeneratorPlan } from './semantic-plan.ts';
export { assertIsolatedStagingTree } from './verify/assert-isolated-staging-tree.ts';
export { buildAcceptanceCoverage } from './verify/build-acceptance-coverage.ts';
export { createSkippedRuntimeLane } from './verify/run-runtime-verification.ts';
export {
  probeSemanticMutationIsolatedRuntimeCapability,
  runSemanticMutationIsolatedVerificationChild,
  SemanticMutationIsolatedVerificationUnavailableError,
  type IsolatedVerificationArtifacts,
  type SemanticMutationIsolatedVerificationFailure
} from './verify/run-semantic-mutation-isolated-child.ts';
export { isSemanticMutationStagingWorkspace } from './verify/semantic-mutation-staging-boundary.ts';
export {
  executeSemanticMutationVerification,
  planSemanticMutationVerificationCapabilities
} from './verify/semantic-mutation-verification-adapter.ts';
export { validateResolvedTemplates } from './verify/validate-resolved-templates.ts';
export type { ViewMutationReport } from './workbench/apply-view-mutations.ts';
