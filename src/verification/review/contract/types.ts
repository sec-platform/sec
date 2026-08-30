import type { PolicySeverity, PolicySourceScope } from '../../../compiler/policies/contract/types.ts';
import type { RegistryKind, RegistryLocation } from '../../../compiler/registry/contract/types.ts';
import type { SemanticViewKind, SemanticViewSet } from '../../../semantic/projection/contract/types.ts';
import type { OverrideStatus, ProvenanceOriginType } from '../../../semantic/provenance/contract/types.ts';
import type { RepairTaskCategory } from '../../../semantic/repair/contract/types.ts';
import type { VerificationStatus } from '../../contract/types.ts';

export const REVIEW_SUMMARY_FORMAT_VERSION = '2' as const;

export type ReviewRuntimeEntryKind = 'library' | 'service';

export interface ReviewRuntimeEntry {
  path: string;
  kind: ReviewRuntimeEntryKind;
  vertical?: string;
  relatedBlocks: string[];
}

export interface ReviewVerticalSlice {
  id: string;
  runtimeEntries: string[];
  relatedBlocks: string[];
}

export interface ReviewCoverageTargetSummary {
  id: string;
  declaredAcceptanceCount: number;
  coveredByCount: number;
  declaredAcceptance: string[];
  coveredBy: string[];
}

export interface ReviewCoverageSummary {
  status: VerificationStatus;
  acceptancePassedCount: number;
  blockCount: number;
  slotCount: number;
  coveredBlockCount: number;
  coveredSlotCount: number;
  uncoveredBlockCount: number;
  uncoveredSlotCount: number;
  acceptancePassed: string[];
  uncoveredBlocks: string[];
  uncoveredSlots: string[];
  blockSummaries: ReviewCoverageTargetSummary[];
  slotSummaries: ReviewCoverageTargetSummary[];
}

export interface ReviewFailurePoint {
  lane: 'fast' | 'runtime' | 'all';
  kind: 'summary' | 'policy' | 'build' | 'unit' | 'acceptance' | 'upgrade' | 'repair';
  message: string;
  artifactPath: string;
}

export interface ReviewRegressionRisk {
  kind: 'coverage-gap' | 'override-active' | 'upgrade-impact' | 'upgrade-verification' | 'repair-verification';
  message: string;
  blockId?: string;
  slotId?: string;
}

export interface ReviewConflictHint {
  kind:
    | 'override-conflict'
    | 'upgrade-plan-present'
    | 'upgrade-preflight-passed'
    | 'repair-plan-present'
    | 'repair-blocked';
  message: string;
  relatedId: string;
}

export type ReviewChainStageId = 'verification' | 'coverage' | 'artifacts' | 'review';
export type ReviewChainStageStatus = 'passed' | 'attention' | 'failed';

export interface ReviewChainStageSummary {
  id: ReviewChainStageId;
  status: ReviewChainStageStatus;
  detail: string;
}

export interface ReviewChainSummary {
  status: ReviewChainStageStatus;
  stageCount: number;
  passedStageCount: number;
  attentionStageCount: number;
  failedStageCount: number;
  stageSummaries: ReviewChainStageSummary[];
}

export interface ReviewCiSummary {
  status: 'passed' | 'attention' | 'failed';
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  impactedBlockCount: number;
  impactedSlotCount: number;
  runtimeEntryCount: number;
}

export interface ReviewSemanticViewEntrySummary {
  viewKind: SemanticViewKind;
  subject?: string;
  nodeCount: number;
  edgeCount: number;
  factCount: number;
  factIds: string[];
}

export interface ReviewSemanticViewSummary {
  formatVersion: SemanticViewSet['formatVersion'];
  inputRevision: string;
  semanticRevision: string;
  viewCount: number;
  subjectCount: number;
  nodeCount: number;
  edgeCount: number;
  factCount: number;
  viewKindCounts: Record<SemanticViewKind, number>;
  factIds: string[];
  views: ReviewSemanticViewEntrySummary[];
}

export interface ReviewProvenanceOriginSummary {
  originType: ProvenanceOriginType;
  count: number;
  paths: string[];
}

export interface ReviewProvenanceOverrideSummary {
  overrideStatus: OverrideStatus;
  count: number;
  paths: string[];
}

export interface ReviewProvenanceRegistrySummary {
  registrySourceId: string;
  registryKind?: RegistryKind;
  registryLocation?: RegistryLocation;
  count: number;
  paths: string[];
}

export interface ReviewProvenancePassSummary {
  pass: string;
  count: number;
  paths: string[];
}

export interface ReviewProvenanceSummary {
  artifactCount: number;
  verifiedArtifactCount: number;
  unverifiedArtifactCount: number;
  overrideArtifactCount: number;
  registryArtifactCount: number;
  generatedArtifactCount: number;
  generatedPassCount: number;
  originSummaryCount: number;
  originSummaries: ReviewProvenanceOriginSummary[];
  overrideSummaryCount: number;
  overrideSummaries: ReviewProvenanceOverrideSummary[];
  registrySummaryCount: number;
  registrySummaries: ReviewProvenanceRegistrySummary[];
  generatedPassSummaries: ReviewProvenancePassSummary[];
  unverifiedArtifacts: string[];
}

export interface ReviewInstallImpact {
  blockId: string;
  actionKinds: string[];
  sourceRoots: string[];
  targetPaths: string[];
  verticals: string[];
  runtimeEntries: string[];
}

export interface ReviewInstallImpactGroupSummary {
  vertical: string;
  blockCount: number;
  actionKindCount: number;
  runtimeEntryCount: number;
  targetPathCount: number;
  blocks: string[];
  actionKinds: string[];
  runtimeEntries: string[];
  targetPaths: string[];
}

export interface ReviewInstallImpactSummary {
  impactCount: number;
  blockCount: number;
  actionKindCount: number;
  sourceRootCount: number;
  targetPathCount: number;
  verticalCount: number;
  runtimeEntryCount: number;
  groupCount: number;
  blocks: string[];
  actionKinds: string[];
  sourceRoots: string[];
  targetPaths: string[];
  verticals: string[];
  runtimeEntries: string[];
  groupSummaries: ReviewInstallImpactGroupSummary[];
}

export interface ReviewPolicySourceSummary {
  scope: PolicySourceScope;
  path: string;
  policyIds: string[];
}

export interface ReviewPolicyMergedSummary {
  id: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
  targetCount: number;
  targets: string[];
}

export interface ReviewPolicyViolationSummary {
  id: string;
  severity: PolicySeverity;
  rule: string;
  fileCount: number;
  files: string[];
  appliesTo: string[];
  message: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
}

export interface ReviewPolicySummary {
  /** Review projection: unsupported/unknown assurance is attention, never passed. */
  status: 'passed' | 'attention' | 'failed' | 'skipped';
  sourceReportStatus: 'passed' | 'failed' | 'skipped';
  assurance: 'source-structure' | 'semantic' | 'unknown';
  evaluatorProviderId: string | null;
  evaluatorProviderRevision: string | null;
  unsupportedSemanticPredicates: string[];
  diagnosticCount: number;
  officialPolicyCount: number;
  projectPolicyCount: number;
  mergedPolicyCount: number;
  sourceCount: number;
  violationCount: number;
  severityCounts: Partial<Record<PolicySeverity, number>>;
  sourceSummaries: ReviewPolicySourceSummary[];
  mergedSummaries: ReviewPolicyMergedSummary[];
  violationSummaries: ReviewPolicyViolationSummary[];
}

export type { ReviewArtifactMissingEntry, ReviewArtifactSummary, ReviewArtifactUploadGroup } from './artifact.ts';

export type { ReviewUpgradeDiagnosticsSummary, ReviewUpgradeMigrationOperationSummary, ReviewUpgradeMigrationSummary, ReviewUpgradePreflightSummary, ReviewUpgradeSummary, ReviewUpgradeVerificationSummary } from './upgrade.ts';

export interface ReviewRepairTaskSummary {
  taskId: string;
  category: RepairTaskCategory;
  sourceSlotId: string;
  targetBlock: string;
  targetFile: string;
  previewStatus: 'changed' | 'unchanged' | 'missing';
  addedLines: number;
  removedLines: number;
  failurePointCount: number;
  targetIds: string[];
  allowedPathCount: number;
  requiredSymbolCount: number;
  forbiddenOperationCount: number;
  testCount: number;
  failureTargetCount: number;
  writeBounds: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  testsToPass: string[];
  failureTargets: string[];
}

export interface ReviewRepairBlockerSummary {
  blockerId: string;
  boundary: string;
  reason: string;
  decisionRequired: string;
  failurePointCount: number;
}

export interface ReviewRepairFailureTaxonomyEntry {
  id: string;
  count: number;
}

export interface ReviewRepairFailureTaxonomySummary {
  laneSummaries: ReviewRepairFailureTaxonomyEntry[];
  kindSummaries: ReviewRepairFailureTaxonomyEntry[];
  issueTypeSummaries: ReviewRepairFailureTaxonomyEntry[];
  repairabilitySummaries: ReviewRepairFailureTaxonomyEntry[];
}

export type ReviewRepairTargetType =
  | 'generated-file'
  | 'slot-target'
  | 'acceptance-case'
  | 'policy-target'
  | 'runtime-target'
  | 'unknown';

export interface ReviewRepairTargetSummary {
  id: string;
  targetType: ReviewRepairTargetType;
  count: number;
}

export interface ReviewRepairVerificationTrace {
  pendingReason: 'repair-not-applied' | 'verify-required' | 'blocked' | 'none';
  nextAction: 'apply-repair' | 'rerun-verify' | 'resolve-blocker' | 'none';
}

export interface ReviewRepairSummary {
  status: 'pending' | 'applied' | 'skipped' | 'blocked';
  sourceVerificationStatus: 'passed' | 'failed';
  requiresVerification: boolean;
  taskCount: number;
  blockerCount: number;
  previewCount: number;
  changedPreviewCount: number;
  failurePointCount: number;
  verificationTrace: ReviewRepairVerificationTrace;
  failureTaxonomy: ReviewRepairFailureTaxonomySummary;
  targetSummaries: ReviewRepairTargetSummary[];
  taskCategorySummaries: ReviewRepairFailureTaxonomyEntry[];
  targetFileCount: number;
  targetFiles: string[];
  taskSummaries: ReviewRepairTaskSummary[];
  blockerSummaries: ReviewRepairBlockerSummary[];
}

export interface ReviewSummary {
  formatVersion: typeof REVIEW_SUMMARY_FORMAT_VERSION;
  ciSummary: ReviewCiSummary;
  chainSummary: ReviewChainSummary;
  semanticViewSummary?: ReviewSemanticViewSummary;
  artifactSummary?: import('./artifact.ts').ReviewArtifactSummary;
  coverageSummary?: ReviewCoverageSummary;
  provenanceSummary?: ReviewProvenanceSummary;
  repairSummary?: ReviewRepairSummary;
  upgradeSummary?: import('./upgrade.ts').ReviewUpgradeSummary;
  policySummary?: ReviewPolicySummary;
  changeSourceCount: number;
  runtimeEntryCount: number;
  installImpactCount: number;
  changeSources: Array<{
    path: string;
    originType: ProvenanceOriginType;
    originId: string;
    sourcePath?: string;
    runtimeTarget?: string;
    registrySourceId?: string;
    registryKind?: RegistryKind;
    registryLocation?: RegistryLocation;
    runtimeKind?: ReviewRuntimeEntryKind;
    vertical?: string;
    relatedBlocks?: string[];
  }>;
  runtimeEntries: ReviewRuntimeEntry[];
  verticalSlices: ReviewVerticalSlice[];
  installImpacts: ReviewInstallImpact[];
  installImpactSummary: ReviewInstallImpactSummary;
  impactedBlocks: string[];
  impactedSlots: string[];
  failurePoints: ReviewFailurePoint[];
  regressionRisks: ReviewRegressionRisk[];
  conflictHints: ReviewConflictHint[];
}
