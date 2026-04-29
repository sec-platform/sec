export type {
  ReviewChainStageId,
  ReviewChainStageStatus,
  ReviewChainStageSummary,
  ReviewChainSummary,
  ReviewCiSummary, ReviewConflictHint, ReviewFailurePoint,
  ReviewRegressionRisk
} from './review-ci.ts';

export type {
  ReviewCoverageSummary, ReviewCoverageTargetSummary
} from './review-coverage.ts';

export type {
  ReviewProvenanceOriginSummary,
  ReviewProvenanceOverrideSummary, ReviewProvenancePassSummary, ReviewProvenanceRegistrySummary, ReviewProvenanceSummary
} from './review-provenance.ts';

export type {
  ReviewPolicyMergedSummary, ReviewPolicySourceSummary, ReviewPolicySummary, ReviewPolicyViolationSummary
} from './review-policy.ts';

export type {
  ReviewArtifactMissingEntry, ReviewArtifactSummary, ReviewArtifactUploadGroup
} from './review-artifact.ts';

export type {
  ReviewRuntimeEntry, ReviewRuntimeEntryKind, ReviewVerticalSlice
} from './review-runtime.ts';

export type {
  ReviewUpgradeDiagnosticsSummary, ReviewUpgradeMigrationOperationSummary, ReviewUpgradeMigrationSummary, ReviewUpgradePreflightSummary, ReviewUpgradeSummary, ReviewUpgradeVerificationSummary
} from './review-upgrade.ts';

export type {
  ReviewInstallImpact,
  ReviewInstallImpactGroupSummary,
  ReviewInstallImpactSummary
} from './review-install.ts';

export type {
  ReviewRepairBlockerSummary,
  ReviewRepairFailureTaxonomyEntry,
  ReviewRepairFailureTaxonomySummary, ReviewRepairSummary, ReviewRepairTargetSummary, ReviewRepairTargetType, ReviewRepairTaskSummary, ReviewRepairVerificationTrace
} from './review-repair.ts';

import type { ProvenanceOriginType } from './provenance-types.ts';
import type { RegistryKind, RegistryLocation } from './registry-types.ts';
import type { ReviewArtifactSummary } from './review-artifact.ts';
import type { ReviewChainSummary, ReviewCiSummary, ReviewConflictHint, ReviewFailurePoint, ReviewRegressionRisk } from './review-ci.ts';
import type { ReviewCoverageSummary } from './review-coverage.ts';
import type { ReviewInstallImpact, ReviewInstallImpactSummary } from './review-install.ts';
import type { ReviewPolicySummary } from './review-policy.ts';
import type { ReviewProvenanceSummary } from './review-provenance.ts';
import type { ReviewRepairSummary } from './review-repair.ts';
import type { ReviewRuntimeEntry, ReviewRuntimeEntryKind, ReviewVerticalSlice } from './review-runtime.ts';
import type { ReviewUpgradeSummary } from './review-upgrade.ts';

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
