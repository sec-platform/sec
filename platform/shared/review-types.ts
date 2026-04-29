export type {
  ReviewFailurePoint,
  ReviewRegressionRisk,
  ReviewConflictHint,
  ReviewChainStageId,
  ReviewChainStageStatus,
  ReviewChainStageSummary,
  ReviewChainSummary,
  ReviewCiSummary
} from './review-ci.ts';

export type {
  ReviewCoverageTargetSummary,
  ReviewCoverageSummary
} from './review-coverage.ts';

export type {
  ReviewProvenanceOriginSummary,
  ReviewProvenanceOverrideSummary,
  ReviewProvenanceRegistrySummary,
  ReviewProvenancePassSummary,
  ReviewProvenanceSummary
} from './review-provenance.ts';

export type {
  ReviewPolicySourceSummary,
  ReviewPolicyMergedSummary,
  ReviewPolicyViolationSummary,
  ReviewPolicySummary
} from './review-policy.ts';

export type {
  ReviewArtifactMissingEntry,
  ReviewArtifactUploadGroup,
  ReviewArtifactSummary
} from './review-artifact.ts';

export type {
  ReviewRuntimeEntryKind,
  ReviewRuntimeEntry,
  ReviewVerticalSlice
} from './review-runtime.ts';

export type {
  ReviewUpgradePreflightSummary,
  ReviewUpgradeMigrationSummary,
  ReviewUpgradeMigrationOperationSummary,
  ReviewUpgradeVerificationSummary,
  ReviewUpgradeDiagnosticsSummary,
  ReviewUpgradeSummary
} from './review-upgrade.ts';

export type {
  ReviewInstallImpact,
  ReviewInstallImpactGroupSummary,
  ReviewInstallImpactSummary
} from './review-install.ts';

export type {
  ReviewRepairTaskSummary,
  ReviewRepairBlockerSummary,
  ReviewRepairFailureTaxonomyEntry,
  ReviewRepairFailureTaxonomySummary,
  ReviewRepairTargetType,
  ReviewRepairTargetSummary,
  ReviewRepairVerificationTrace,
  ReviewRepairSummary
} from './review-repair.ts';

import type { ReviewCiSummary, ReviewChainSummary, ReviewFailurePoint, ReviewRegressionRisk, ReviewConflictHint } from './review-ci.ts';
import type { ReviewCoverageSummary } from './review-coverage.ts';
import type { ReviewProvenanceSummary } from './review-provenance.ts';
import type { ReviewPolicySummary } from './review-policy.ts';
import type { ReviewArtifactSummary } from './review-artifact.ts';
import type { ReviewRuntimeEntry, ReviewRuntimeEntryKind, ReviewVerticalSlice } from './review-runtime.ts';
import type { ReviewUpgradeSummary } from './review-upgrade.ts';
import type { ReviewInstallImpact, ReviewInstallImpactSummary } from './review-install.ts';
import type { ReviewRepairSummary } from './review-repair.ts';
import type { ProvenanceOriginType } from './provenance-types.ts';
import type { RegistryKind, RegistryLocation } from './registry-types.ts';

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
