import type { SlotProvenanceHints, SlotTask } from './lock-types.ts';
import type { SlotKind } from './plan-manifest-types.ts';

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
  UpgradeDiagnostics,
  UpgradeDiagnosticsPhase,
  UpgradeMigrationOperation,
  UpgradeMigrationOperationRole,
  UpgradeMigrationSummary,
  UpgradePlan,
  UpgradePreflightCheck,
  UpgradePreflightCheckId
} from './upgrade-types.ts';
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
export type {
  ReviewArtifactMissingEntry,
  ReviewArtifactSummary,
  ReviewArtifactUploadGroup,
  ReviewChainStageId,
  ReviewChainStageStatus,
  ReviewChainStageSummary,
  ReviewChainSummary,
  ReviewCiSummary,
  ReviewConflictHint,
  ReviewCoverageSummary,
  ReviewCoverageTargetSummary,
  ReviewFailurePoint,
  ReviewInstallImpact,
  ReviewInstallImpactGroupSummary,
  ReviewInstallImpactSummary,
  ReviewPolicyMergedSummary,
  ReviewPolicySourceSummary,
  ReviewPolicySummary,
  ReviewPolicyViolationSummary,
  ReviewProvenanceOriginSummary,
  ReviewProvenanceOverrideSummary,
  ReviewProvenancePassSummary,
  ReviewProvenanceRegistrySummary,
  ReviewProvenanceSummary,
  ReviewRegressionRisk,
  ReviewRepairBlockerSummary,
  ReviewRepairFailureTaxonomyEntry,
  ReviewRepairFailureTaxonomySummary,
  ReviewRepairSummary,
  ReviewRepairTargetSummary,
  ReviewRepairTargetType,
  ReviewRepairTaskSummary,
  ReviewRepairVerificationTrace,
  ReviewRuntimeEntry,
  ReviewRuntimeEntryKind,
  ReviewSummary,
  ReviewUpgradeDiagnosticsSummary,
  ReviewUpgradeMigrationOperationSummary,
  ReviewUpgradeMigrationSummary,
  ReviewUpgradePreflightSummary,
  ReviewUpgradeSummary,
  ReviewUpgradeVerificationSummary,
  ReviewVerticalSlice
} from './review-types.ts';

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
