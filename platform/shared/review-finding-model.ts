export const SEC_REVIEW_REPORT_SCHEMA = 'sec-review-report-v1' as const;
export const SEC_REVIEW_DECISION_SCHEMA = 'sec-review-decision-v1' as const;
export const SEC_REVIEW_RESTATEMENT_POLICY = 'independent-sec-restatement-v1' as const;

export const SEC_REVIEW_FINDING_SEVERITIES = ['p0', 'p1', 'p2', 'advisory', 'nit'] as const;
export const SEC_REVIEW_FINDING_BASES = [
  'canonical-contract', 'measured-evidence', 'technical-fact',
  'repository-consistency', 'preference'
] as const;
export const SEC_REVIEW_EVIDENCE_KINDS = [
  'source-location', 'canonical-contract', 'test', 'physical-evidence', 'reproduction'
] as const;
export const SEC_REVIEW_CONFIDENCE = ['confirmed', 'high', 'moderate'] as const;
export const SEC_REVIEWER_ROLES = [
  'architecture-reviewer', 'integration-reviewer', 'verification-evidence-reviewer'
] as const;

export type SecReviewFindingSeverity = (typeof SEC_REVIEW_FINDING_SEVERITIES)[number];
export type SecReviewFindingBasis = (typeof SEC_REVIEW_FINDING_BASES)[number];
export type SecReviewEvidenceKind = (typeof SEC_REVIEW_EVIDENCE_KINDS)[number];
export type SecReviewConfidence = (typeof SEC_REVIEW_CONFIDENCE)[number];
export type SecReviewerRole = (typeof SEC_REVIEWER_ROLES)[number];

export interface SecReviewEvidenceReferenceV1 {
  readonly kind: SecReviewEvidenceKind;
  readonly reference: string;
  readonly revisionSha: string | null;
  readonly digest: `sha256:${string}`;
}

export interface SecReviewFindingV1 {
  readonly id: string;
  readonly severity: SecReviewFindingSeverity;
  readonly title: string;
  readonly path: string;
  readonly line: number | null;
  readonly lineRevisionSha: string | null;
  readonly symbol: string | null;
  readonly ownerAuthorityId: string;
  readonly invariant: string;
  readonly basis: SecReviewFindingBasis;
  readonly evidenceRefs: readonly SecReviewEvidenceReferenceV1[];
  readonly confidence: SecReviewConfidence;
  readonly limitation: string | null;
  readonly remediationConstraint: string | null;
}

export interface SecReviewScopeV1 {
  readonly reviewedPaths: readonly string[];
  readonly unreviewedPaths: readonly string[];
  readonly limitation: string | null;
}

export interface SecReviewReportV1 {
  readonly schema: typeof SEC_REVIEW_REPORT_SCHEMA;
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly trustedInstructionSha: string;
  readonly reviewerRole: SecReviewerRole;
  readonly reviewerId: string;
  readonly containsExternalText: false;
  readonly restatementPolicy: typeof SEC_REVIEW_RESTATEMENT_POLICY;
  readonly scope: SecReviewScopeV1;
  readonly findings: readonly SecReviewFindingV1[];
}

export interface SecReviewBlockingPolicyV1 {
  readonly sourcePath: string;
  readonly revisionSha: string;
  readonly digest: `sha256:${string}`;
  readonly blockingSeverities: readonly SecReviewFindingSeverity[];
}

export interface SecReviewObservedEvidenceV1 {
  readonly revisionSha: string | null;
  readonly path: string;
  readonly digest: `sha256:${string}`;
}

export interface SecReviewExpectedBindingV1 {
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly trustedInstructionSha: string;
  readonly reviewerRole: SecReviewerRole;
  readonly reviewerId: string;
  readonly changedPaths: readonly string[];
  readonly blockingPolicy: SecReviewBlockingPolicyV1;
  readonly observedEvidence: readonly SecReviewObservedEvidenceV1[];
}

export type SecReviewFreshness = 'current' | 'stale';
export type SecReviewCompleteness = 'complete' | 'incomplete';
export type SecReviewBlockingState = 'blocked' | 'clear';

export interface SecReviewDecisionV1 {
  readonly schema: typeof SEC_REVIEW_DECISION_SCHEMA;
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly trustedInstructionSha: string;
  readonly reviewerRole: SecReviewerRole;
  readonly reviewerId: string;
  readonly reportDigest: `sha256:${string}`;
  readonly blockingPolicyDigest: `sha256:${string}`;
  readonly blockingPolicySourcePath: string;
  readonly blockingPolicyRevisionSha: string;
  readonly blockingPolicySourceDigest: `sha256:${string}`;
  readonly freshness: SecReviewFreshness;
  readonly completeness: SecReviewCompleteness;
  readonly blocking: SecReviewBlockingState;
  readonly evidenceVerified: boolean;
  readonly mergeEligible: boolean;
  readonly reviewedPaths: readonly string[];
  readonly unreviewedPaths: readonly string[];
  readonly blockingFindingIds: readonly string[];
  readonly nonBlockingFindingIds: readonly string[];
  readonly staleFields: readonly string[];
}
