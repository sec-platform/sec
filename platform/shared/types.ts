import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import type { ExplainGraph } from './explain-types.ts';
import type { SlotProvenanceHints, SlotTask } from './lock-types.ts';
import type { SlotKind, UpgradeMigration } from './plan-manifest-types.ts';
import type { RepairTaskCategory } from './repair-types.ts';
import type {
  OverrideSource,
  OverrideStatus,
  ProvenanceOriginType
} from './provenance-types.ts';
import type { RegistryKind, RegistryLocation } from './registry-types.ts';
import type { PolicySeverity, PolicySourceScope } from './policy-types.ts';
import type { VerificationStatus } from './verification-types.ts';

export type { RegistryKind, RegistryLocation } from './registry-types.ts';
export type {
  InstallPlanStep,
  LockFile,
  PassState,
  PassStatus,
  ResolvedBlock,
  SlotProvenanceHints,
  SlotTask
} from './lock-types.ts';
export type {
  AppMode,
  BlockManifest,
  InstallInstruction,
  ManifestCompatibility,
  ManifestEntry,
  ManifestKind,
  ManifestPin,
  ManifestPins,
  ManifestRoute,
  ManifestSlot,
  PackageManager,
  PlanApp,
  PlanBlock,
  PlanFile,
  PlanRegistry,
  PlanRegistrySource,
  PlanSlot,
  SlotKind,
  UpgradeConfig,
  UpgradeConfigRewriteMigrationEntry,
  UpgradeCopyDirectoryMigrationEntry,
  UpgradeCopyFileMigrationEntry,
  UpgradeCreateDirectoryMigrationEntry,
  UpgradeDeleteDirectoryMigrationEntry,
  UpgradeDeleteFileMigrationEntry,
  UpgradeFileReplaceMigrationEntry,
  UpgradeJsonArrayAppendMigrationEntry,
  UpgradeJsonArrayRemoveMigrationEntry,
  UpgradeJsonObjectMergeMigrationEntry,
  UpgradeMigration,
  UpgradeMigrationEntry,
  UpgradeRenameDirectoryMigrationEntry,
  UpgradeRenameFileMigrationEntry,
  UpgradeSlotContractUpdateMigrationEntry,
  UpgradeTextAppendMigrationEntry,
  UpgradeTextReplaceMigrationEntry,
  UpgradeTextReplaceRegexMigrationEntry
} from './plan-manifest-types.ts';
export type {
  RepairBlocker,
  RepairFailurePoint,
  RepairPlan,
  RepairTask,
  RepairTaskCategory,
  RepairTaskPreview,
  RepairTaskReview
} from './repair-types.ts';
export type {
  OverrideApplyPhase,
  OverrideEntry,
  OverrideManifest,
  OverrideSource,
  OverrideStatus,
  ProvenanceArtifact,
  ProvenanceFile,
  ProvenanceOriginType
} from './provenance-types.ts';
export type {
  CoverageOverlay,
  ExplainEdgeType,
  ExplainGraph,
  ExplainGraphEdge,
  ExplainGraphNode,
  ExplainNodeType
} from './explain-types.ts';
export type {
  AcceptanceCoverageEntry,
  AcceptanceCoverageReport,
  AcceptanceItem
} from './acceptance-types.ts';

export type { WorkspacePaths } from './workspace-types.ts';

export type {
  MergedPolicyReportEntry,
  PolicyReport,
  PolicyRule,
  PolicySeverity,
  PolicySourceFileReport,
  PolicySourceScope,
  PolicySpec,
  PolicyViolation
} from './policy-types.ts';

export type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationLane,
  VerificationLogs,
  VerificationReport,
  VerificationStatus,
  VerificationStepReport
} from './verification-types.ts';

export interface TaskEnvelope {
  taskId: string;
  taskKind: `${SlotKind}-slot`;
  phase: 'adapt';
  targetBlock: string;
  targetFile: string;
  sourceSlot: {
    id: string;
    status: SlotTask['status'];
    writableZones: string[];
    provenanceHints: SlotProvenanceHints;
  };
  allowedPaths: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  inputContracts: {
    description: string;
    inputType?: string;
    outputType?: string;
  };
  testsToPass: string[];
  budget: {
    maxAttempts: number;
    timeoutSeconds: number;
    maxTokens: number;
  };
  expectedOutput: {
    type: 'source-file';
    language: 'typescript';
  };
  lockSummary: {
    blocks: string[];
  };
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

export type ReviewRuntimeEntryKind = 'page' | 'api';

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

export interface ReviewArtifactMissingEntry {
  path: string;
  reason: string;
  declaredBy: string;
}

export interface ReviewArtifactUploadGroup {
  kind: string;
  count: number;
  paths: string[];
}

export interface ReviewArtifactSummary {
  artifactStatus?: 'passed' | 'attention';
  artifactCount: number;
  governanceCount: number;
  viewCount: number;
  testCount?: number;
  contractCount?: number;
  contractPaths?: string[];
  uploadGroupCount?: number;
  missingCount: number;
  missingReasonTypeCount?: number;
  missingReasonCounts?: Record<string, number>;
  uploadGroups?: ReviewArtifactUploadGroup[];
  missing?: ReviewArtifactMissingEntry[];
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

export interface ReviewUpgradePreflightSummary {
  group: string;
  checkCount: number;
  evidenceCount: number;
}

export interface ReviewUpgradeMigrationSummary {
  id: string;
  kind: string;
  target: string;
  reason: string;
  requiresVerification: boolean;
  source?: string;
  slotId?: string;
}

export type ReviewUpgradeMigrationOperationSummary = UpgradeMigrationOperation;

export interface ReviewUpgradeVerificationSummary {
  id: 'required' | 'skipped';
  count: number;
}

export type UpgradeDiagnosticsPhase = 'planning' | 'apply';

export interface ReviewUpgradeDiagnosticsSummary {
  status: 'blocked';
  phase: UpgradeDiagnosticsPhase;
  failedCheck: string;
  errorCode: string;
  message: string;
  details?: unknown;
}

export interface ReviewUpgradeSummary {
  status: 'planned' | 'applied' | 'blocked';
  blockId: string;
  fromVersion?: string;
  toVersion: string;
  preflightCheckCount: number;
  preflightEvidenceCount: number;
  migrationCount: number;
  migrationKindCounts: Record<string, number>;
  requiresVerification: boolean;
  requiresVerificationCount: number;
  impactCount: number;
  impacts: string[];
  sourceMigrationCount: number;
  slotMigrationCount: number;
  verificationSummaries: ReviewUpgradeVerificationSummary[];
  preflightSummaries: ReviewUpgradePreflightSummary[];
  migrationSummaries: ReviewUpgradeMigrationSummary[];
  migrationOperationCount: number;
  migrationOperationSummaries: ReviewUpgradeMigrationOperationSummary[];
  diagnostics?: ReviewUpgradeDiagnosticsSummary;
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
  status: 'passed' | 'failed' | 'skipped';
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

export interface ReviewSummary {
  formatVersion: '2';
  ciSummary: ReviewCiSummary;
  chainSummary: ReviewChainSummary;
  artifactSummary?: ReviewArtifactSummary;
  coverageSummary?: ReviewCoverageSummary;
  provenanceSummary?: ReviewProvenanceSummary;
  repairSummary?: ReviewRepairSummary;
  upgradeSummary?: ReviewUpgradeSummary;
  policySummary?: ReviewPolicySummary;
  changeSourceCount: number;
  runtimeEntryCount: number;
  installImpactCount: number;
  changeSources: Array<{
    path: string;
    originType: ProvenanceOriginType;
    originId: string;
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

export type UpgradeMigrationOperationRole = 'file' | 'directory' | 'json' | 'text' | 'slot';

export interface UpgradeMigrationOperation {
  id: string;
  kind: string;
  target: string;
  role: UpgradeMigrationOperationRole;
  source?: string;
  slotId?: string;
  inputType?: string;
  outputType?: string;
  writableZones?: string[];
  path?: string[];
  updateCount?: number;
  itemCount?: number;
  valueKeyCount?: number;
  contentLength?: number;
  searchLength?: number;
  replacementLength?: number;
  pattern?: string;
  flags?: string;
}

export interface UpgradeMigrationSummary {
  id: string;
  kind: string;
  target: string;
  reason: string;
  requiresVerification: boolean;
  slotId?: string;
  source?: string;
}

export type UpgradePreflightCheckId =
  | 'version-range'
  | 'migration-entries'
  | 'migration-targets'
  | 'migration-file-operations'
  | 'migration-json-shapes'
  | 'migration-json-structure'
  | 'migration-text-patterns'
  | 'migration-slot-contracts'
  | 'impact-scan'
  | 'override-conflicts';

export interface UpgradePreflightCheck {
  id: UpgradePreflightCheckId;
  status: 'passed';
  message: string;
  evidence: string[];
}

export interface UpgradePlan {
  formatVersion: string;
  blockId: string;
  fromVersion: string;
  toVersion: string;
  status: 'planned' | 'applied';
  preflightChecks: UpgradePreflightCheck[];
  impacts: string[];
  migrations: UpgradeMigration[];
  migrationKindCounts: Record<string, number>;
  migrationSummaries: UpgradeMigrationSummary[];
  migrationOperations: UpgradeMigrationOperation[];
}

export interface UpgradeDiagnostics {
  formatVersion: string;
  status: 'blocked';
  phase: UpgradeDiagnosticsPhase;
  blockId: string;
  targetVersion: string;
  failedCheck: UpgradePreflightCheckId | 'target-manifest' | 'plan-block';
  errorCode: string;
  message: string;
  details?: unknown;
}
