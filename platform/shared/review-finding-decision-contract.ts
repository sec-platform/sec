import type { DocumentationAuthorityRegistry } from './documentation-authority-contract.ts';
import {
  reviewAssertKeys,
  reviewAssertObject,
  reviewDigest,
  reviewEnum,
  reviewEvidenceObservationKey,
  reviewEvidencePath,
  reviewObservedEvidenceKey,
  reviewPath,
  reviewPaths,
  reviewRepository,
  reviewSameValues,
  reviewSeverityPolicyOrder,
  reviewSha,
  reviewSha256,
  reviewSlug
} from './review-finding-internal.ts';
import {
  SEC_REVIEW_DECISION_SCHEMA,
  SEC_REVIEW_FINDING_SEVERITIES,
  SEC_REVIEWER_ROLES,
  type SecReviewBlockingState,
  type SecReviewCompleteness,
  type SecReviewDecisionV1,
  type SecReviewExpectedBindingV1,
  type SecReviewFindingSeverity,
  type SecReviewFreshness,
  type SecReviewObservedEvidenceV1,
  type SecReviewReportV1
} from './review-finding-model.ts';
import { parseSecReviewReportV1 } from './review-finding-report-contract.ts';

const POLICY_KEYS = new Set(['sourcePath', 'revisionSha', 'digest', 'blockingSeverities']);
const OBSERVED_EVIDENCE_KEYS = new Set(['revisionSha', 'path', 'digest']);
const SEVERITY_SET = new Set(SEC_REVIEW_FINDING_SEVERITIES);
const REVIEWER_ROLE_SET = new Set(SEC_REVIEWER_ROLES);

function canonicalSeverityPolicy(
  value: unknown,
  trustedInstructionSha: string
): {
  sourcePath: string;
  revisionSha: string;
  digest: `sha256:${string}`;
  blockingSeverities: SecReviewFindingSeverity[];
} {
  reviewAssertObject(value, 'review blocking policy');
  reviewAssertKeys(value, POLICY_KEYS, 'review blocking policy');
  const sourcePath = reviewPath(value.sourcePath, 'review blocking policy sourcePath');
  if (
    !/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(sourcePath)
    && sourcePath !== 'docs/work/active-work-package.md'
    && sourcePath !== 'scripts/codex/merge-gate.ts'
    && sourcePath !== 'docs/development-governance.md'
  ) {
    throw new Error('Review blocking policy sourcePath is not an approved policy owner.');
  }
  const revisionSha = reviewSha(value.revisionSha, 'review blocking policy revisionSha');
  if (revisionSha !== trustedInstructionSha) {
    throw new Error('Review blocking policy must bind trustedInstructionSha.');
  }
  const sourceDigest = reviewDigest(value.digest, 'review blocking policy digest');
  if (!Array.isArray(value.blockingSeverities)) {
    throw new Error('Review blocking policy severities must be an array.');
  }
  const severities = value.blockingSeverities.map((entry, index) => (
    reviewEnum(entry, SEVERITY_SET, `blockingSeverities[${index}]`)
  ));
  if (new Set(severities).size !== severities.length) {
    throw new Error('Review blocking policy severities must be unique.');
  }
  const expectedOrder = reviewSeverityPolicyOrder(SEC_REVIEW_FINDING_SEVERITIES, severities);
  if (expectedOrder.some((severity, index) => severity !== severities[index])) {
    throw new Error('Review blocking policy severities must use canonical severity order.');
  }
  if (!severities.includes('p0') || !severities.includes('p1')) {
    throw new Error('Review blocking policy must always block p0 and p1.');
  }
  if (severities.includes('advisory') || severities.includes('nit')) {
    throw new Error('Review blocking policy cannot block advisory or nit findings.');
  }
  return {
    sourcePath,
    revisionSha,
    digest: sourceDigest,
    blockingSeverities: severities
  };
}

function parseObservedEvidence(value: unknown, index: number): SecReviewObservedEvidenceV1 {
  const label = `expected observedEvidence[${index}]`;
  reviewAssertObject(value, label);
  reviewAssertKeys(value, OBSERVED_EVIDENCE_KEYS, label);
  return {
    revisionSha: value.revisionSha === null ? null : reviewSha(value.revisionSha, `${label}.revisionSha`),
    path: reviewPath(value.path, `${label}.path`),
    digest: reviewDigest(value.digest, `${label}.digest`)
  };
}

function canonicalObservedEvidence(value: unknown): SecReviewObservedEvidenceV1[] {
  if (!Array.isArray(value)) throw new Error('Expected observedEvidence must be an array.');
  const observations = value.map(parseObservedEvidence);
  const keys = observations.map(reviewObservedEvidenceKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Expected observedEvidence identities must be unique.');
  }
  const sorted = [...keys].sort();
  if (sorted.some((key, index) => key !== keys[index])) {
    throw new Error('Expected observedEvidence must use canonical identity order.');
  }
  return observations;
}

function assertExpectedBinding(expected: SecReviewExpectedBindingV1): {
  changedPaths: string[];
  blockingPolicy: ReturnType<typeof canonicalSeverityPolicy>;
  observedEvidence: SecReviewObservedEvidenceV1[];
} {
  reviewRepository(expected.repository, 'expected review repository');
  reviewSha(expected.baseSha, 'expected review baseSha');
  reviewSha(expected.headSha, 'expected review headSha');
  reviewSha(expected.treeSha, 'expected review treeSha');
  reviewSha(expected.trustedInstructionSha, 'expected review trustedInstructionSha');
  reviewEnum(expected.reviewerRole, REVIEWER_ROLE_SET, 'expected review reviewerRole');
  reviewSlug(expected.reviewerId, 'expected review reviewerId');
  const changedPaths = reviewPaths(expected.changedPaths, 'expected review changedPaths');
  if (changedPaths.length === 0) throw new Error('Expected review changedPaths cannot be empty.');
  return {
    changedPaths,
    blockingPolicy: canonicalSeverityPolicy(
      expected.blockingPolicy,
      expected.trustedInstructionSha
    ),
    observedEvidence: canonicalObservedEvidence(expected.observedEvidence)
  };
}

function reportEvidenceRequirements(report: SecReviewReportV1): SecReviewObservedEvidenceV1[] {
  const requirements = new Map<string, SecReviewObservedEvidenceV1>();
  for (const finding of report.findings) {
    for (const reference of finding.evidenceRefs) {
      const requirement = {
        revisionSha: reference.revisionSha,
        path: reviewEvidencePath(reference),
        digest: reference.digest
      } satisfies SecReviewObservedEvidenceV1;
      const key = reviewObservedEvidenceKey(requirement);
      const previous = requirements.get(key);
      if (previous !== undefined && previous.digest !== requirement.digest) {
        throw new Error(`Review report contains conflicting evidence requirement ${key}.`);
      }
      requirements.set(key, requirement);
    }
  }
  return [...requirements.values()].sort((left, right) => (
    reviewObservedEvidenceKey(left) < reviewObservedEvidenceKey(right) ? -1 :
      reviewObservedEvidenceKey(left) > reviewObservedEvidenceKey(right) ? 1 : 0
  ));
}

function verifyObservedEvidence(
  report: SecReviewReportV1,
  blockingPolicy: ReturnType<typeof canonicalSeverityPolicy>,
  observations: readonly SecReviewObservedEvidenceV1[]
): void {
  const policyRequirement = {
    revisionSha: blockingPolicy.revisionSha,
    path: blockingPolicy.sourcePath,
    digest: blockingPolicy.digest
  } satisfies SecReviewObservedEvidenceV1;
  const requiredByIdentity = new Map<string, SecReviewObservedEvidenceV1>();
  for (const requirement of [...reportEvidenceRequirements(report), policyRequirement]) {
    const key = reviewObservedEvidenceKey(requirement);
    const previous = requiredByIdentity.get(key);
    if (previous !== undefined && previous.digest !== requirement.digest) {
      throw new Error(`Review policy and findings conflict on Evidence ${key}.`);
    }
    requiredByIdentity.set(key, requirement);
  }
  const required = [...requiredByIdentity.values()].sort((left, right) => (
    reviewObservedEvidenceKey(left) < reviewObservedEvidenceKey(right) ? -1 :
      reviewObservedEvidenceKey(left) > reviewObservedEvidenceKey(right) ? 1 : 0
  ));
  const requiredKeys = required.map(reviewObservedEvidenceKey);
  const observedKeys = observations.map(reviewObservedEvidenceKey);
  if (!reviewSameValues(requiredKeys, observedKeys)) {
    throw new Error('Observed Review Evidence must exactly match report Evidence identities.');
  }
  for (let index = 0; index < required.length; index += 1) {
    if (required[index]!.digest !== observations[index]!.digest) {
      throw new Error(`Observed Review Evidence digest mismatch for ${requiredKeys[index]}.`);
    }
  }
}

function freezeDecision(decision: SecReviewDecisionV1): SecReviewDecisionV1 {
  return Object.freeze({
    ...decision,
    reviewedPaths: Object.freeze([...decision.reviewedPaths]),
    unreviewedPaths: Object.freeze([...decision.unreviewedPaths]),
    blockingFindingIds: Object.freeze([...decision.blockingFindingIds]),
    nonBlockingFindingIds: Object.freeze([...decision.nonBlockingFindingIds]),
    staleFields: Object.freeze([...decision.staleFields])
  });
}

export function bindSecCurrentReviewReportV1(
  value: unknown,
  registry: DocumentationAuthorityRegistry,
  expected: SecReviewExpectedBindingV1
): SecReviewDecisionV1 {
  const expectedValues = assertExpectedBinding(expected);
  const report = parseSecReviewReportV1(value, registry);
  const reportDigest = reviewSha256(report);
  const blockingPolicyDigest = reviewSha256(expectedValues.blockingPolicy);
  const blockingSeverities = new Set(expectedValues.blockingPolicy.blockingSeverities);
  const blockingFindingIds = report.findings
    .filter((finding) => blockingSeverities.has(finding.severity))
    .map((finding) => finding.id);
  const nonBlockingFindingIds = report.findings
    .filter((finding) => !blockingSeverities.has(finding.severity))
    .map((finding) => finding.id);
  const staleFields = [
    report.repository === expected.repository ? null : 'repository',
    report.baseSha === expected.baseSha ? null : 'baseSha',
    report.headSha === expected.headSha ? null : 'headSha',
    report.treeSha === expected.treeSha ? null : 'treeSha',
    report.trustedInstructionSha === expected.trustedInstructionSha ? null : 'trustedInstructionSha',
    report.reviewerRole === expected.reviewerRole ? null : 'reviewerRole',
    report.reviewerId === expected.reviewerId ? null : 'reviewerId'
  ].filter((field): field is string => field !== null);

  const freshness: SecReviewFreshness = staleFields.length > 0 ? 'stale' : 'current';
  const completeness: SecReviewCompleteness = report.scope.unreviewedPaths.length > 0
    ? 'incomplete'
    : 'complete';
  const blocking: SecReviewBlockingState = blockingFindingIds.length > 0 ? 'blocked' : 'clear';
  let evidenceVerified = false;
  if (freshness === 'current') {
    const scopedPaths = [...report.scope.reviewedPaths, ...report.scope.unreviewedPaths].sort();
    if (!reviewSameValues(scopedPaths, expectedValues.changedPaths)) {
      throw new Error('Current review scope must exactly partition the candidate changed paths.');
    }
    verifyObservedEvidence(
      report,
      expectedValues.blockingPolicy,
      expectedValues.observedEvidence
    );
    evidenceVerified = true;
  }

  return freezeDecision({
    schema: SEC_REVIEW_DECISION_SCHEMA,
    repository: report.repository,
    baseSha: report.baseSha,
    headSha: report.headSha,
    treeSha: report.treeSha,
    trustedInstructionSha: report.trustedInstructionSha,
    reviewerRole: report.reviewerRole,
    reviewerId: report.reviewerId,
    reportDigest,
    blockingPolicyDigest,
    blockingPolicySourcePath: expectedValues.blockingPolicy.sourcePath,
    blockingPolicyRevisionSha: expectedValues.blockingPolicy.revisionSha,
    blockingPolicySourceDigest: expectedValues.blockingPolicy.digest,
    freshness,
    completeness,
    blocking,
    evidenceVerified,
    mergeEligible: freshness === 'current'
      && completeness === 'complete'
      && blocking === 'clear'
      && evidenceVerified,
    reviewedPaths: report.scope.reviewedPaths,
    unreviewedPaths: report.scope.unreviewedPaths,
    blockingFindingIds,
    nonBlockingFindingIds,
    staleFields
  });
}
