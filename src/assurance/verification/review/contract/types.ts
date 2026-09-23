import type { RegistryKind, RegistryLocation } from '../../../../contracts/registry-source.ts';
import type { PolicySeverity, PolicySourceScope } from '../../../../semantics/policies/types.ts';
import type { SemanticViewKind, SemanticViewSet } from '../../../../semantics/projection/types.ts';
import type { OverrideStatus, ProvenanceOriginType } from '../../../../semantics/provenance/types.ts';
import type { RepairTaskCategory } from '../../../../semantics/repair/types.ts';
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

interface ReviewCoverageTargetSummary {
  id: string;
  declaredAcceptanceCount: number;
  coveredByCount: number;
  declaredAcceptance: string[];
  coveredBy: string[];
}

interface ReviewCoverageSummary {
  status: VerificationStatus;
  acceptancePassedCount: number;
  blockCount: number;
  coveredBlockCount: number;
  uncoveredBlockCount: number;
  acceptancePassed: string[];
  uncoveredBlocks: string[];
  blockSummaries: ReviewCoverageTargetSummary[];
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
type ReviewChainStageStatus = 'passed' | 'attention' | 'failed';

interface ReviewChainStageSummary {
  id: ReviewChainStageId;
  status: ReviewChainStageStatus;
  detail: string;
}

interface ReviewChainSummary {
  status: ReviewChainStageStatus;
  stageCount: number;
  passedStageCount: number;
  attentionStageCount: number;
  failedStageCount: number;
  stageSummaries: ReviewChainStageSummary[];
}

interface ReviewCiSummary {
  status: 'passed' | 'attention' | 'failed';
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  impactedBlockCount: number;
  runtimeEntryCount: number;
}

interface ReviewSemanticViewEntrySummary {
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

interface ReviewProvenanceOriginSummary {
  originType: ProvenanceOriginType;
  count: number;
  paths: string[];
}

interface ReviewProvenanceOverrideSummary {
  overrideStatus: OverrideStatus;
  count: number;
  paths: string[];
}

interface ReviewProvenanceRegistrySummary {
  registrySourceId: string;
  registryKind?: RegistryKind;
  registryLocation?: RegistryLocation;
  count: number;
  paths: string[];
}

interface ReviewProvenancePassSummary {
  pass: string;
  count: number;
  paths: string[];
}

interface ReviewProvenanceSummary {
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

interface ReviewInstallImpactGroupSummary {
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

interface ReviewInstallImpactSummary {
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

interface ReviewPolicyMergedSummary {
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

;

;

interface ReviewRepairTaskSummary {
  taskId: string;
  category: RepairTaskCategory;
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

interface ReviewRepairBlockerSummary {
  blockerId: string;
  boundary: string;
  reason: string;
  decisionRequired: string;
  failurePointCount: number;
}

interface ReviewRepairFailureTaxonomyEntry {
  id: string;
  count: number;
}

interface ReviewRepairFailureTaxonomySummary {
  laneSummaries: ReviewRepairFailureTaxonomyEntry[];
  kindSummaries: ReviewRepairFailureTaxonomyEntry[];
  issueTypeSummaries: ReviewRepairFailureTaxonomyEntry[];
  repairabilitySummaries: ReviewRepairFailureTaxonomyEntry[];
}

type ReviewRepairTargetType =
  | 'generated-file'
  | 'file-target'
  | 'acceptance-case'
  | 'policy-target'
  | 'runtime-target'
  | 'unknown';

interface ReviewRepairTargetSummary {
  id: string;
  targetType: ReviewRepairTargetType;
  count: number;
}

export interface ReviewRepairVerificationTrace {
  pendingReason: 'repair-not-applied' | 'verify-required' | 'blocked' | 'none';
  nextAction: 'apply-repair' | 'rerun-verify' | 'resolve-blocker' | 'none';
}

interface ReviewRepairSummary {
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
  failurePoints: ReviewFailurePoint[];
  regressionRisks: ReviewRegressionRisk[];
  conflictHints: ReviewConflictHint[];
}
