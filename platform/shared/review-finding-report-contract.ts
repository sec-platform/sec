import type {
  DocumentationAuthorityRecord,
  DocumentationAuthorityRegistry
} from './documentation-authority-contract.ts';
import {
  reviewAssertKeys,
  reviewAssertObject,
  reviewDigest,
  reviewEnum,
  reviewEvidenceKey,
  reviewEvidenceObservationKey,
  reviewEvidencePath,
  reviewLineRange,
  reviewNullableSha,
  reviewNullableText,
  reviewPath,
  reviewPaths,
  reviewPositiveLine,
  reviewRepository,
  reviewSha,
  reviewSlug,
  reviewSplitReference,
  reviewText
} from './review-finding-internal.ts';
import {
  SEC_REVIEW_CONFIDENCE,
  SEC_REVIEW_EVIDENCE_KINDS,
  SEC_REVIEW_FINDING_BASES,
  SEC_REVIEW_FINDING_SEVERITIES,
  SEC_REVIEW_REPORT_SCHEMA,
  SEC_REVIEW_RESTATEMENT_POLICY,
  SEC_REVIEWER_ROLES,
  type SecReviewEvidenceKind,
  type SecReviewEvidenceReferenceV1,
  type SecReviewFindingSeverity,
  type SecReviewFindingV1,
  type SecReviewReportV1,
  type SecReviewScopeV1
} from './review-finding-model.ts';

const REPORT_KEYS = new Set([
  'schema', 'repository', 'baseSha', 'headSha', 'treeSha',
  'trustedInstructionSha', 'reviewerRole', 'reviewerId',
  'containsExternalText', 'restatementPolicy', 'scope', 'findings'
]);
const SCOPE_KEYS = new Set(['reviewedPaths', 'unreviewedPaths', 'limitation']);
const FINDING_KEYS = new Set([
  'id', 'severity', 'title', 'path', 'line', 'lineRevisionSha', 'symbol', 'ownerAuthorityId',
  'invariant', 'basis', 'evidenceRefs', 'confidence', 'limitation',
  'remediationConstraint'
]);
const EVIDENCE_KEYS = new Set(['kind', 'reference', 'revisionSha', 'digest']);
const SEVERITY_SET = new Set(SEC_REVIEW_FINDING_SEVERITIES);
const BASIS_SET = new Set(SEC_REVIEW_FINDING_BASES);
const EVIDENCE_KIND_SET = new Set(SEC_REVIEW_EVIDENCE_KINDS);
const CONFIDENCE_SET = new Set(SEC_REVIEW_CONFIDENCE);
const REVIEWER_ROLE_SET = new Set(SEC_REVIEWER_ROLES);
const STRUCTURAL_BLOCKING = new Set<SecReviewFindingSeverity>(['p0', 'p1', 'p2']);

type ReviewIdentity = Pick<SecReviewReportV1, 'baseSha' | 'headSha' | 'trustedInstructionSha'>;

function validateEvidenceReference(
  kind: SecReviewEvidenceKind,
  reference: ReturnType<typeof reviewSplitReference>,
  revisionSha: string | null,
  identity: ReviewIdentity,
  label: string
): void {
  if (kind === 'source-location') {
    if (reference.fragment === null) {
      throw new Error(`${label} source-location requires an exact line fragment.`);
    }
    reviewLineRange(reference.fragment, label);
    if (revisionSha !== identity.baseSha && revisionSha !== identity.headSha) {
      throw new Error(`${label} source-location must bind baseSha or headSha.`);
    }
    return;
  }
  if (kind === 'canonical-contract') {
    if (reference.fragment !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(reference.fragment)) {
      throw new Error(`${label} canonical-contract fragment is invalid.`);
    }
    if (revisionSha !== identity.trustedInstructionSha) {
      throw new Error(`${label} canonical-contract must bind trustedInstructionSha.`);
    }
    return;
  }
  if (kind === 'test') {
    if (reference.fragment !== null || !/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(reference.path)) {
      throw new Error(`${label} test evidence must reference one test file.`);
    }
    if (revisionSha !== identity.baseSha && revisionSha !== identity.headSha) {
      throw new Error(`${label} test evidence must bind baseSha or headSha.`);
    }
    return;
  }
  if (kind === 'physical-evidence') {
    if (reference.fragment !== null || !/^docs\/evidence\//u.test(reference.path)) {
      throw new Error(`${label} physical-evidence must reference docs/evidence.`);
    }
    if (revisionSha !== null) {
      throw new Error(`${label} physical-evidence must use null revisionSha.`);
    }
    return;
  }
  if (reference.fragment !== null || !/^(?:scripts|tests)\//u.test(reference.path)) {
    throw new Error(`${label} reproduction must reference a script or test path.`);
  }
  if (revisionSha !== identity.baseSha && revisionSha !== identity.headSha) {
    throw new Error(`${label} reproduction must bind baseSha or headSha.`);
  }
}

function parseEvidenceReference(
  value: unknown,
  findingIndex: number,
  evidenceIndex: number,
  identity: ReviewIdentity
): SecReviewEvidenceReferenceV1 {
  const label = `findings[${findingIndex}].evidenceRefs[${evidenceIndex}]`;
  reviewAssertObject(value, label);
  reviewAssertKeys(value, EVIDENCE_KEYS, label);
  const kind = reviewEnum(value.kind, EVIDENCE_KIND_SET, `${label}.kind`);
  const parsed = reviewSplitReference(value.reference, `${label}.reference`);
  const revisionSha = reviewNullableSha(value.revisionSha, `${label}.revisionSha`);
  validateEvidenceReference(kind, parsed, revisionSha, identity, `${label}.reference`);
  return {
    kind,
    reference: parsed.reference,
    revisionSha,
    digest: reviewDigest(value.digest, `${label}.digest`)
  };
}

function owningAuthority(
  registry: DocumentationAuthorityRegistry,
  id: string
): DocumentationAuthorityRecord {
  const record = registry.documents.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Review finding references unknown authority ${id}.`);
  if (
    record.owns.length === 0 || record.kind === 'proposal' || record.kind === 'navigation'
    || record.kind === 'agent-projection' || record.generatedFrom !== undefined
  ) {
    throw new Error(`Review finding owner ${id} must be one owning canonical authority.`);
  }
  return record;
}

function hasOwnerContractEvidence(
  evidenceRefs: readonly SecReviewEvidenceReferenceV1[],
  owner: DocumentationAuthorityRecord
): boolean {
  return evidenceRefs.some((reference) => (
    reference.kind === 'canonical-contract' && reviewEvidencePath(reference) === owner.path
  ));
}

function hasFindingLocationEvidence(
  evidenceRefs: readonly SecReviewEvidenceReferenceV1[],
  findingPath: string,
  findingLine: number,
  findingRevisionSha: string
): boolean {
  return evidenceRefs.some((reference) => {
    if (reference.kind !== 'source-location') return false;
    const parsed = reviewSplitReference(reference.reference, 'source-location evidence');
    if (
      parsed.path !== findingPath
      || parsed.fragment === null
      || reference.revisionSha !== findingRevisionSha
    ) return false;
    const range = reviewLineRange(parsed.fragment, 'source-location evidence');
    return range.start <= findingLine && findingLine <= range.end;
  });
}

function parseFinding(
  value: unknown,
  index: number,
  reviewedPaths: ReadonlySet<string>,
  registry: DocumentationAuthorityRegistry,
  identity: ReviewIdentity
): SecReviewFindingV1 {
  const label = `findings[${index}]`;
  reviewAssertObject(value, label);
  reviewAssertKeys(value, FINDING_KEYS, label);
  const severity = reviewEnum(value.severity, SEVERITY_SET, `${label}.severity`);
  const basis = reviewEnum(value.basis, BASIS_SET, `${label}.basis`);
  const confidence = reviewEnum(value.confidence, CONFIDENCE_SET, `${label}.confidence`);
  const path = reviewPath(value.path, `${label}.path`);
  if (!reviewedPaths.has(path)) throw new Error(`${label}.path must be inside the reviewed scope.`);
  const line = reviewPositiveLine(value.line, `${label}.line`);
  const lineRevisionSha = reviewNullableSha(value.lineRevisionSha, `${label}.lineRevisionSha`);
  if (line === null && lineRevisionSha !== null) {
    throw new Error(`${label}.lineRevisionSha requires a finding line.`);
  }
  if (line !== null && lineRevisionSha !== identity.baseSha && lineRevisionSha !== identity.headSha) {
    throw new Error(`${label}.lineRevisionSha must bind baseSha or headSha.`);
  }
  const ownerAuthorityId = reviewSlug(value.ownerAuthorityId, `${label}.ownerAuthorityId`);
  const owner = owningAuthority(registry, ownerAuthorityId);

  if (!Array.isArray(value.evidenceRefs)) throw new Error(`${label}.evidenceRefs must be an array.`);
  const evidenceRefs = value.evidenceRefs.map((entry, evidenceIndex) => (
    parseEvidenceReference(entry, index, evidenceIndex, identity)
  ));
  const evidenceKeys = evidenceRefs.map(reviewEvidenceKey);
  if (new Set(evidenceKeys).size !== evidenceKeys.length) {
    throw new Error(`${label}.evidenceRefs must be unique.`);
  }
  const sortedEvidence = [...evidenceKeys].sort();
  if (sortedEvidence.some((key, evidenceIndex) => key !== evidenceKeys[evidenceIndex])) {
    throw new Error(`${label}.evidenceRefs must use canonical order.`);
  }

  const limitation = reviewNullableText(value.limitation, `${label}.limitation`);
  const remediationConstraint = reviewNullableText(
    value.remediationConstraint,
    `${label}.remediationConstraint`
  );

  if (STRUCTURAL_BLOCKING.has(severity)) {
    if (basis === 'preference') {
      throw new Error(`${label} blocking severity cannot use preference as its basis.`);
    }
    if (line === null || lineRevisionSha === null) {
      throw new Error(`${label} blocking severity requires an exact finding line and revision.`);
    }
    if (evidenceRefs.length === 0) {
      throw new Error(`${label} blocking severity requires evidence references.`);
    }
    if (!hasOwnerContractEvidence(evidenceRefs, owner)) {
      throw new Error(`${label} blocking severity requires the owning canonical contract.`);
    }
    if (!hasFindingLocationEvidence(evidenceRefs, path, line, lineRevisionSha)) {
      throw new Error(`${label} blocking severity requires source-location evidence covering its line.`);
    }
    if (remediationConstraint === null) {
      throw new Error(`${label} blocking severity requires a remediation constraint.`);
    }
    if ((severity === 'p0' || severity === 'p1') && confidence !== 'confirmed') {
      throw new Error(`${label} ${severity} requires confirmed confidence.`);
    }
    if (severity === 'p2' && confidence === 'moderate') {
      throw new Error(`${label} p2 requires confirmed or high confidence.`);
    }
  }
  if (confidence !== 'confirmed' && limitation === null) {
    throw new Error(`${label} non-confirmed confidence requires a limitation.`);
  }

  return {
    id: reviewSlug(value.id, `${label}.id`),
    severity,
    title: reviewText(value.title, `${label}.title`, 5, 240),
    path,
    line,
    lineRevisionSha,
    symbol: reviewNullableText(value.symbol, `${label}.symbol`, 300),
    ownerAuthorityId,
    invariant: reviewText(value.invariant, `${label}.invariant`, 20, 800),
    basis,
    evidenceRefs,
    confidence,
    limitation,
    remediationConstraint
  };
}

function parseScope(value: unknown): SecReviewScopeV1 {
  reviewAssertObject(value, 'review scope');
  reviewAssertKeys(value, SCOPE_KEYS, 'review scope');
  const reviewedPaths = reviewPaths(value.reviewedPaths, 'review scope.reviewedPaths');
  const unreviewedPaths = reviewPaths(value.unreviewedPaths, 'review scope.unreviewedPaths');
  if (reviewedPaths.length === 0) throw new Error('Review scope must include at least one reviewed path.');
  const overlap = reviewedPaths.filter((path) => unreviewedPaths.includes(path));
  if (overlap.length > 0) throw new Error(`Review scope paths overlap: ${overlap.join(', ')}.`);
  const limitation = reviewNullableText(value.limitation, 'review scope.limitation');
  if (unreviewedPaths.length > 0 && limitation === null) {
    throw new Error('Partial review scope requires a limitation.');
  }
  if (unreviewedPaths.length === 0 && limitation !== null) {
    throw new Error('Complete review scope cannot carry an unreviewed limitation.');
  }
  return { reviewedPaths, unreviewedPaths, limitation };
}

function assertEvidenceDigestConsistency(findings: readonly SecReviewFindingV1[]): void {
  const seen = new Map<string, string>();
  for (const finding of findings) {
    for (const reference of finding.evidenceRefs) {
      const key = reviewEvidenceObservationKey(reference.revisionSha, reviewEvidencePath(reference));
      const previous = seen.get(key);
      if (previous !== undefined && previous !== reference.digest) {
        throw new Error(`Review report contains conflicting digests for ${key}.`);
      }
      seen.set(key, reference.digest);
    }
  }
}

function freezeReport(report: SecReviewReportV1): SecReviewReportV1 {
  return Object.freeze({
    ...report,
    scope: Object.freeze({
      ...report.scope,
      reviewedPaths: Object.freeze([...report.scope.reviewedPaths]),
      unreviewedPaths: Object.freeze([...report.scope.unreviewedPaths])
    }),
    findings: Object.freeze(report.findings.map((finding) => Object.freeze({
      ...finding,
      evidenceRefs: Object.freeze(finding.evidenceRefs.map((reference) => Object.freeze({ ...reference })))
    })))
  });
}

export function parseSecReviewReportV1(
  value: unknown,
  registry: DocumentationAuthorityRegistry
): SecReviewReportV1 {
  reviewAssertObject(value, 'review report');
  reviewAssertKeys(value, REPORT_KEYS, 'review report');
  if (value.schema !== SEC_REVIEW_REPORT_SCHEMA) {
    throw new Error(`Review report schema must be ${SEC_REVIEW_REPORT_SCHEMA}.`);
  }
  if (value.containsExternalText !== false || value.restatementPolicy !== SEC_REVIEW_RESTATEMENT_POLICY) {
    throw new Error('Review report must contain only independent SEC restatements.');
  }
  const identity = {
    baseSha: reviewSha(value.baseSha, 'review report.baseSha'),
    headSha: reviewSha(value.headSha, 'review report.headSha'),
    trustedInstructionSha: reviewSha(value.trustedInstructionSha, 'review report.trustedInstructionSha')
  };
  const scope = parseScope(value.scope);
  if (!Array.isArray(value.findings)) throw new Error('Review report findings must be an array.');
  const reviewedPaths = new Set(scope.reviewedPaths);
  const findings = value.findings.map((finding, index) => (
    parseFinding(finding, index, reviewedPaths, registry, identity)
  ));
  const findingIds = findings.map((finding) => finding.id);
  if (new Set(findingIds).size !== findingIds.length) {
    throw new Error('Review finding IDs must be unique.');
  }
  const sortedFindingIds = [...findingIds].sort();
  if (sortedFindingIds.some((id, index) => id !== findingIds[index])) {
    throw new Error('Review findings must use canonical identity order.');
  }
  assertEvidenceDigestConsistency(findings);
  return freezeReport({
    schema: SEC_REVIEW_REPORT_SCHEMA,
    repository: reviewRepository(value.repository, 'review report.repository'),
    baseSha: identity.baseSha,
    headSha: identity.headSha,
    treeSha: reviewSha(value.treeSha, 'review report.treeSha'),
    trustedInstructionSha: identity.trustedInstructionSha,
    reviewerRole: reviewEnum(value.reviewerRole, REVIEWER_ROLE_SET, 'review report.reviewerRole'),
    reviewerId: reviewSlug(value.reviewerId, 'review report.reviewerId'),
    containsExternalText: false,
    restatementPolicy: SEC_REVIEW_RESTATEMENT_POLICY,
    scope,
    findings
  });
}
