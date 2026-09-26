import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import {
  type ReviewPrincipal,
  type ReviewStabilityDigest,
  type ReviewStabilityStage
} from './stability.ts';

const REVIEW_REPORT_SCHEMA = 'sec-review-report-v1' as const;
const REVIEW_REPORT_METHOD_REVISION = 'sec-review-report-reducer-v1' as const;

export type ReviewCoverageMode = 'exact-head-change-set' | 'explicit-surface-set';

export type ReviewFindingSeverity = 'p0' | 'p1' | 'p2' | 'advisory' | 'nit';
export type ReviewFindingStatus =
  | 'open' | 'resolved' | 'accepted-risk' | 'invalid' | 'superseded' | 'not-applicable';
export type ReviewReportTerminal = 'clear' | 'blocked' | 'incomplete' | 'stale' | 'unresolved';
export type ReviewConfidence = 'high' | 'medium' | 'low';
export type ReviewRemediationClass =
  | 'code' | 'architecture' | 'test' | 'documentation' | 'provider' | 'none';

export interface ReviewFinding {
  readonly findingId: string;
  readonly subject: string;
  readonly owner: string;
  readonly invariantRef: string;
  readonly severity: ReviewFindingSeverity;
  readonly blocking: boolean;
  readonly evidenceRefs: readonly ReviewStabilityDigest[];
  readonly reproduction: string | null;
  readonly confidence: ReviewConfidence;
  readonly limitations: readonly string[];
  readonly remediationClass: ReviewRemediationClass;
  readonly status: ReviewFindingStatus;
  readonly riskAcceptanceRef: ReviewStabilityDigest | null;
}

export interface ReviewReport {
  readonly schema: typeof REVIEW_REPORT_SCHEMA;
  readonly methodRevision: typeof REVIEW_REPORT_METHOD_REVISION;
  readonly stage: ReviewStabilityStage;
  readonly repository: string;
  readonly prNumber: number;
  readonly sessionRevision: ReviewStabilityDigest;
  readonly scopeAuthorizationRevision: ReviewStabilityDigest;
  readonly scopeAuthorizationReceiptDigest: ReviewStabilityDigest;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly policyDigest: ReviewStabilityDigest;
  readonly principal: ReviewPrincipal;
  readonly reviewMethodRevision: string;
  readonly coverageMode: ReviewCoverageMode;
  readonly requiredSurfaces: readonly string[];
  readonly reviewedSurfaces: readonly string[];
  readonly unreviewedSurfaces: readonly string[];
  readonly findings: readonly ReviewFinding[];
  readonly terminal: ReviewReportTerminal;
  readonly sourceReviewRevision: ReviewStabilityDigest;
  readonly sourceReceiptDigest: ReviewStabilityDigest;
  readonly reportRevision: ReviewStabilityDigest;
  readonly reportDigest: ReviewStabilityDigest;
}

type ReviewReportInput = Omit<
  ReviewReport,
  'schema' | 'methodRevision' | 'unreviewedSurfaces' | 'terminal' | 'reportRevision' | 'reportDigest'
>;

function fail(message: string): never { throw new Error(`ReviewReport ${message}`); }
function text(value: unknown, label: string, maximum = 1024): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be bounded text.`);
  return value;
}
function sha(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a Git SHA.`);
  return result;
}
function digest(value: unknown, label: string): ReviewStabilityDigest {
  const result = text(value, label, 80);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a SHA-256 digest.`);
  return result as ReviewStabilityDigest;
}
function hash(value: unknown): ReviewStabilityDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} fields are invalid.`);
  }
}
function canonicalStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const result = value.map((entry, index) => text(entry, `${label}[${index}]`, 4096)).sort();
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates.`);
  return Object.freeze(result);
}
function principal(value: unknown): ReviewPrincipal {
  const input = record(value, 'principal');
  if (input.kind === 'human') {
    exact(input, ['kind', 'nodeId', 'approvalState'], 'human principal');
    if (input.approvalState !== 'APPROVED') fail('human principal must be APPROVED.');
    return Object.freeze({ kind: 'human', nodeId: text(input.nodeId, 'principal.nodeId', 256), approvalState: 'APPROVED' });
  }
  if (input.kind === 'github-app') {
    exact(input, ['kind', 'actorNodeId', 'appId', 'appNodeId', 'appSlug', 'reviewState'], 'GitHub App principal');
    if (!Number.isSafeInteger(input.appId) || Number(input.appId) < 1) fail('principal.appId must be positive.');
    if (input.reviewState !== 'APPROVED' && input.reviewState !== 'COMMENTED') fail('principal.reviewState is invalid.');
    return Object.freeze({
      kind: 'github-app', actorNodeId: text(input.actorNodeId, 'principal.actorNodeId', 256),
      appId: Number(input.appId), appNodeId: text(input.appNodeId, 'principal.appNodeId', 256),
      appSlug: text(input.appSlug, 'principal.appSlug', 100), reviewState: input.reviewState
    });
  }
  return fail('principal kind is unknown.');
}

function finding(value: unknown, index: number): ReviewFinding {
  const input = record(value, `findings[${index}]`);
  exact(input, [
    'findingId', 'subject', 'owner', 'invariantRef', 'severity', 'blocking', 'evidenceRefs',
    'reproduction', 'confidence', 'limitations', 'remediationClass', 'status', 'riskAcceptanceRef'
  ], `findings[${index}]`);
  const severity = text(input.severity, `findings[${index}].severity`) as ReviewFindingSeverity;
  if (!['p0', 'p1', 'p2', 'advisory', 'nit'].includes(severity)) fail(`findings[${index}].severity is invalid.`);
  const status = text(input.status, `findings[${index}].status`) as ReviewFindingStatus;
  if (!['open', 'resolved', 'accepted-risk', 'invalid', 'superseded', 'not-applicable'].includes(status)) {
    fail(`findings[${index}].status is invalid.`);
  }
  if (typeof input.blocking !== 'boolean') fail(`findings[${index}].blocking must be boolean.`);
  const confidence = text(input.confidence, `findings[${index}].confidence`) as ReviewConfidence;
  if (!['high', 'medium', 'low'].includes(confidence)) fail(`findings[${index}].confidence is invalid.`);
  const remediationClass = text(input.remediationClass, `findings[${index}].remediationClass`) as ReviewRemediationClass;
  if (!['code', 'architecture', 'test', 'documentation', 'provider', 'none'].includes(remediationClass)) {
    fail(`findings[${index}].remediationClass is invalid.`);
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length < 1) {
    fail(`findings[${index}] requires evidence.`);
  }
  const evidenceRefs = input.evidenceRefs.map((entry, evidenceIndex) =>
    digest(entry, `findings[${index}].evidenceRefs[${evidenceIndex}]`));
  if (new Set(evidenceRefs).size !== evidenceRefs.length) fail(`findings[${index}] evidence contains duplicates.`);
  const limitations = canonicalStrings(input.limitations, `findings[${index}].limitations`);
  const riskAcceptanceRef = input.riskAcceptanceRef === null ? null
    : digest(input.riskAcceptanceRef, `findings[${index}].riskAcceptanceRef`);
  if (status === 'accepted-risk' && riskAcceptanceRef === null) {
    fail(`findings[${index}] accepted-risk requires riskAcceptanceRef.`);
  }
  if (status !== 'accepted-risk' && riskAcceptanceRef !== null) {
    fail(`findings[${index}] non accepted-risk must not carry riskAcceptanceRef.`);
  }
  if ((severity === 'p0' || severity === 'p1' || severity === 'p2')
      && status === 'open' && input.blocking !== true) {
    fail(`findings[${index}] open ${severity} must block under ${REVIEW_REPORT_METHOD_REVISION}.`);
  }
  if ((severity === 'advisory' || severity === 'nit') && input.blocking !== false) {
    fail(`findings[${index}] ${severity} must not block.`);
  }
  if (status !== 'open' && input.blocking !== false) {
    fail(`findings[${index}] non-open finding must not block.`);
  }
  return Object.freeze({
    findingId: text(input.findingId, `findings[${index}].findingId`, 256),
    subject: text(input.subject, `findings[${index}].subject`, 4096),
    owner: text(input.owner, `findings[${index}].owner`, 512),
    invariantRef: text(input.invariantRef, `findings[${index}].invariantRef`, 4096),
    severity, blocking: input.blocking, evidenceRefs: Object.freeze(evidenceRefs),
    reproduction: input.reproduction === null ? null : text(input.reproduction, `findings[${index}].reproduction`, 8192),
    confidence, limitations, remediationClass, status, riskAcceptanceRef
  });
}

function deriveTerminal(unreviewedSurfaces: readonly string[], findings: readonly ReviewFinding[]): ReviewReportTerminal {
  if (unreviewedSurfaces.length > 0) return 'incomplete';
  if (findings.some((entry) => entry.status === 'invalid' || entry.status === 'accepted-risk')) return 'unresolved';
  if (findings.some((entry) => entry.status === 'open' && entry.blocking)) return 'blocked';
  return 'clear';
}

export function createReviewReport(input: ReviewReportInput): ReviewReport {
  const requiredSurfaces = canonicalStrings(input.requiredSurfaces, 'requiredSurfaces');
  const reviewedSurfaces = canonicalStrings(input.reviewedSurfaces, 'reviewedSurfaces');
  const required = new Set(requiredSurfaces);
  if (reviewedSurfaces.some((surface) => !required.has(surface))) {
    fail('reviewedSurfaces must be a subset of requiredSurfaces.');
  }
  const reviewed = new Set(reviewedSurfaces);
  const unreviewedSurfaces = Object.freeze(requiredSurfaces.filter((surface) => !reviewed.has(surface)));
  if (input.coverageMode === 'exact-head-change-set' && unreviewedSurfaces.length > 0) {
    fail('exact-head-change-set coverage must cover every required surface.');
  }
  if (!Array.isArray(input.findings)) fail('findings must be an array.');
  const findings = Object.freeze(input.findings.map(finding).sort((left, right) =>
    left.findingId.localeCompare(right.findingId)));
  if (new Set(findings.map((entry) => entry.findingId)).size !== findings.length) fail('findingId must be unique.');
  const terminal = deriveTerminal(unreviewedSurfaces, findings);
  const withoutDigest = Object.freeze({
    schema: REVIEW_REPORT_SCHEMA,
    methodRevision: REVIEW_REPORT_METHOD_REVISION,
    stage: input.stage,
    repository: text(input.repository, 'repository'),
    prNumber: Number.isSafeInteger(input.prNumber) && input.prNumber > 0 ? input.prNumber : fail('prNumber must be positive.'),
    sessionRevision: digest(input.sessionRevision, 'sessionRevision'),
    scopeAuthorizationRevision: digest(input.scopeAuthorizationRevision, 'scopeAuthorizationRevision'),
    scopeAuthorizationReceiptDigest: digest(input.scopeAuthorizationReceiptDigest, 'scopeAuthorizationReceiptDigest'),
    headSha: sha(input.headSha, 'headSha'), headTreeSha: sha(input.headTreeSha, 'headTreeSha'),
    policyDigest: digest(input.policyDigest, 'policyDigest'), principal: principal(input.principal),
    reviewMethodRevision: text(input.reviewMethodRevision, 'reviewMethodRevision', 256),
    coverageMode: input.coverageMode === 'exact-head-change-set' || input.coverageMode === 'explicit-surface-set'
      ? input.coverageMode : fail('coverageMode is invalid.'),
    requiredSurfaces, reviewedSurfaces, unreviewedSurfaces, findings, terminal,
    sourceReviewRevision: digest(input.sourceReviewRevision, 'sourceReviewRevision'),
    sourceReceiptDigest: digest(input.sourceReceiptDigest, 'sourceReceiptDigest')
  });
  const reportRevision = hash({
    schema: withoutDigest.schema, methodRevision: withoutDigest.methodRevision, stage: withoutDigest.stage,
    repository: withoutDigest.repository, prNumber: withoutDigest.prNumber,
    sessionRevision: withoutDigest.sessionRevision,
    scopeAuthorizationRevision: withoutDigest.scopeAuthorizationRevision,
    headSha: withoutDigest.headSha, headTreeSha: withoutDigest.headTreeSha,
    policyDigest: withoutDigest.policyDigest, principal: withoutDigest.principal,
    reviewMethodRevision: withoutDigest.reviewMethodRevision, coverageMode: withoutDigest.coverageMode,
    requiredSurfaces: withoutDigest.requiredSurfaces, reviewedSurfaces: withoutDigest.reviewedSurfaces,
    findings: withoutDigest.findings, terminal: withoutDigest.terminal,
    sourceReviewRevision: withoutDigest.sourceReviewRevision
  });
  const report = Object.freeze({ ...withoutDigest, reportRevision });
  return Object.freeze({ ...report, reportDigest: hash(report) });
}

export function parseReviewReport(source: string): ReviewReport {
  const input = record(JSON.parse(source) as unknown, 'report');
  exact(input, [
    'schema', 'methodRevision', 'stage', 'repository', 'prNumber', 'sessionRevision',
    'scopeAuthorizationRevision', 'scopeAuthorizationReceiptDigest', 'headSha', 'headTreeSha',
    'policyDigest', 'principal', 'reviewMethodRevision', 'coverageMode', 'requiredSurfaces', 'reviewedSurfaces', 'unreviewedSurfaces',
    'findings', 'terminal', 'sourceReviewRevision', 'sourceReceiptDigest', 'reportRevision', 'reportDigest'
  ], 'report');
  if (input.schema !== REVIEW_REPORT_SCHEMA || input.methodRevision !== REVIEW_REPORT_METHOD_REVISION) {
    fail('schema or method revision mismatch.');
  }
  const report = createReviewReport(input as unknown as ReviewReportInput);
  if (JSON.stringify(report.unreviewedSurfaces) !== JSON.stringify(input.unreviewedSurfaces)
      || report.terminal !== input.terminal || report.reportRevision !== input.reportRevision
      || report.reportDigest !== input.reportDigest) {
    fail('derived terminal, surfaces or digest mismatch.');
  }
  return report;
}

export function assertReviewReportCurrent(report: ReviewReport, input: Readonly<{
  stage: ReviewStabilityStage;
  sessionRevision: ReviewStabilityDigest;
  scopeAuthorizationRevision: ReviewStabilityDigest;
  scopeAuthorizationReceiptDigest: ReviewStabilityDigest;
  headSha: string;
  headTreeSha: string;
  policyDigest: ReviewStabilityDigest;
  sourceReviewRevision: ReviewStabilityDigest;
  sourceReceiptDigest: ReviewStabilityDigest;
  reviewMethodRevision: string;
  coverageMode: ReviewCoverageMode;
  requiredSurfaces: readonly string[];
  requireClear?: boolean;
}>): void {
  const current = parseReviewReport(encodeVerificationActionData(report));
  const checks: readonly [unknown, unknown, string][] = [
    [input.stage, current.stage, 'stage'],
    [input.sessionRevision, current.sessionRevision, 'sessionRevision'],
    [input.scopeAuthorizationRevision, current.scopeAuthorizationRevision, 'scopeAuthorizationRevision'],
    [input.scopeAuthorizationReceiptDigest, current.scopeAuthorizationReceiptDigest, 'scopeAuthorizationReceiptDigest'],
    [input.headSha, current.headSha, 'headSha'], [input.headTreeSha, current.headTreeSha, 'headTreeSha'],
    [input.policyDigest, current.policyDigest, 'policyDigest'],
    [input.sourceReviewRevision, current.sourceReviewRevision, 'sourceReviewRevision'],
    [input.sourceReceiptDigest, current.sourceReceiptDigest, 'sourceReceiptDigest'],
    [input.reviewMethodRevision, current.reviewMethodRevision, 'reviewMethodRevision'],
    [input.coverageMode, current.coverageMode, 'coverageMode']
  ];
  for (const [expected, actual, label] of checks) if (expected !== actual) fail(`${label} drift makes report stale.`);
  if (JSON.stringify(canonicalStrings(input.requiredSurfaces, 'live.requiredSurfaces'))
      !== JSON.stringify(current.requiredSurfaces)) fail('requiredSurfaces drift makes report stale.');
  if (input.requireClear !== false && current.terminal !== 'clear') {
    fail(`terminal ${current.terminal} does not authorize integration.`);
  }
}
