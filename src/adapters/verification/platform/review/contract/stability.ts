import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY } from '../../session/contract/session.ts';

import { encodeVerificationActionData } from '../../action/contract/action.ts';

/** Content-integrity decision object, not a signature. The GitHub adapter must independently verify stable principal and source provenance. */

const REVIEW_STABILITY_POLICY_SCHEMA = 'sec-review-stability-policy-v1' as const;
const REVIEW_STABILITY_RECEIPT_SCHEMA = 'sec-review-stability-receipt-v1' as const;
export const CODEX_CLEAN_REVIEW_VERDICT_PREFIX =
  "Codex Review: Didn't find any major issues." as const;
export const CODEX_CLEAN_REVIEW_CONGRATULATIONS = Object.freeze([
  'Bravo.',
  'Delightful!',
  'Swish!',
  'What shall we build next?',
  'You’re on a roll!',
  'Chef’s kiss.',
  '🚀'
] as const);
export const CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES = Object.freeze([
  '<details> <summary>ℹ️ About Codex in GitHub</summary>',
  '<br/>',
  '[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you',
  '- Open a pull request for review',
  '- Mark a draft as ready',
  '- Comment "@codex review".',
  'If Codex has suggestions, it will comment; otherwise it will react with 👍.',
  'Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".',
  '</details>'
] as const);
export type ReviewStabilityDigest = `sha256:${string}`;
export type ReviewStabilityStage = 'pre-expensive' | 'pre-merge';

/**
 * The trusted Codex App owns the clean-verdict semantic prefix. Presentation
 * text is accepted only from this versioned closed vocabulary: arbitrary
 * natural language cannot be proved non-finding content and therefore fails
 * closed until a later trust revision explicitly admits it.
 */
export function isCodexCleanReviewVerdict(firstLine: unknown): boolean {
  if (typeof firstLine !== 'string') return false;
  if (firstLine === CODEX_CLEAN_REVIEW_VERDICT_PREFIX) return true;
  const prefix = `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} `;
  if (!firstLine.startsWith(prefix)) return false;
  const congratulation = firstLine.slice(prefix.length);
  return CODEX_CLEAN_REVIEW_CONGRATULATIONS.some((candidate) => candidate === congratulation);
}

/** Closed grammar for the optional provider help block; blank-line layout may vary, semantic lines may not. */
export function isCodexCleanReviewAboutBlock(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const semanticLines = value.replaceAll('\r\n', '\n').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return semanticLines.length === CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES.length
    && semanticLines.every((line, index) => line === CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES[index]);
}

interface ReviewStabilityTrustedApp {
  readonly actorNodeId: string;
  readonly appId: number;
  readonly appNodeId: string;
  readonly appSlug: string;
}

export interface ReviewStabilityPolicy {
  readonly schema: typeof REVIEW_STABILITY_POLICY_SCHEMA;
  readonly policyId: string;
  readonly trustedRevision: string;
  readonly trustedApps: readonly ReviewStabilityTrustedApp[];
  readonly allowIndependentHumanApproval: boolean;
  readonly policyDigest: ReviewStabilityDigest;
}

export type ReviewStabilityPolicyInput = Omit<ReviewStabilityPolicy, 'schema' | 'policyDigest'>;

export type ReviewPrincipal = Readonly<{
  kind: 'human'; nodeId: string; approvalState: 'APPROVED';
}> | Readonly<{
  kind: 'github-app'; actorNodeId: string; appId: number; appNodeId: string; appSlug: string;
  reviewState: 'APPROVED' | 'COMMENTED';
}>;

interface ReviewStabilityProducer {
  readonly identity: string;
  readonly executionIdentity: string;
  readonly providerIdentity: 'github';
  readonly candidateWriteCapability: 'read-only';
  readonly capabilityReceiptDigest: ReviewStabilityDigest;
  readonly trustedRevision: string;
  readonly sourceTransport: 'github-graphql' | 'github-rest';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: ReviewStabilityDigest;
}

interface ReviewIndependence {
  readonly candidateAuthorNodeId: string;
  readonly integrationPrincipalNodeId: string;
}

export interface ReviewSnapshot {
  readonly paginationComplete: true;
  readonly reviewedHeadSha: string;
  readonly reviewPageDigests: readonly ReviewStabilityDigest[];
  readonly threadPageDigests: readonly ReviewStabilityDigest[];
  readonly reviewCount: number;
  readonly threadCount: number;
  readonly unresolvedBlockingThreadCount: 0;
  readonly requestChangesPrincipalIds: readonly [];
  readonly snapshotDigest: ReviewStabilityDigest;
}

export interface ReviewStabilityReceipt {
  readonly schema: typeof REVIEW_STABILITY_RECEIPT_SCHEMA;
  readonly stage: ReviewStabilityStage;
  readonly repository: string;
  readonly prNumber: number;
  readonly sessionRevision: ReviewStabilityDigest;
  readonly scopeAuthorizationRevision: ReviewStabilityDigest;
  readonly scopeAuthorizationReceiptDigest: ReviewStabilityDigest;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly policy: ReviewStabilityPolicy;
  readonly principal: ReviewPrincipal;
  readonly independence: ReviewIndependence;
  readonly producer: ReviewStabilityProducer;
  readonly snapshot: ReviewSnapshot;
  readonly reviewedAt: string;
  readonly expiresAt: string;
  readonly reviewRevision: ReviewStabilityDigest;
  readonly receiptDigest: ReviewStabilityDigest;
}

export type ReviewStabilityReceiptInput = Omit<ReviewStabilityReceipt, 'schema' | 'reviewRevision' | 'receiptDigest'>;

function fail(message: string): never { throw new Error(`ReviewStability ${message}`); }
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) fail(`${label} must be bounded text.`);
  return value;
}
function nodeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
    || !/^[\x21-\x7e]+$/u.test(value)) fail(`${label} must be a bounded GitHub node ID.`);
  return value;
}
function appId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(`${label} must be a positive safe integer.`);
  return value as number;
}
function appSlug(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) fail(`${label} must be a bounded canonical GitHub App slug.`);
  return value;
}
function digest(value: unknown, label: string): ReviewStabilityDigest {
  const result = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a SHA-256 digest.`);
  return result as ReviewStabilityDigest;
}
function sha(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a commit/tree SHA.`);
  return result;
}
function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO timestamp.`);
  return result;
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${label} must contain exactly: ${wanted.join(', ')}.`);
}
function hash(value: unknown): ReviewStabilityDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}
export function createReviewSnapshotDigest(
  snapshot: Omit<ReviewSnapshot, 'snapshotDigest'>
): ReviewStabilityDigest {
  return hash(snapshot);
}
function digestList(value: unknown, label: string): readonly ReviewStabilityDigest[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const digests = value.map((entry, index) => digest(entry, `${label}[${index}]`));
  if (new Set(digests).size !== digests.length) fail(`${label} contains a duplicate page digest.`);
  return Object.freeze(digests);
}

export function createReviewStabilityPolicy(input: ReviewStabilityPolicyInput): ReviewStabilityPolicy {
  if (!Array.isArray(input.trustedApps)) fail('trustedApps must be an array.');
  const trustedApps = input.trustedApps.map((entry, index) => {
    const app = record(entry, `trustedApps[${index}]`);
    exact(app, ['actorNodeId', 'appId', 'appNodeId', 'appSlug'], `trustedApps[${index}]`);
    return Object.freeze({
      actorNodeId: nodeId(app.actorNodeId, `trustedApps[${index}].actorNodeId`),
      appId: appId(app.appId, `trustedApps[${index}].appId`),
      appNodeId: nodeId(app.appNodeId, `trustedApps[${index}].appNodeId`),
      appSlug: appSlug(app.appSlug, `trustedApps[${index}].appSlug`)
    });
  }).sort((left, right) => left.actorNodeId.localeCompare(right.actorNodeId)
    || left.appId - right.appId
    || left.appNodeId.localeCompare(right.appNodeId)
    || left.appSlug.localeCompare(right.appSlug));
  if (new Set(trustedApps.map((app) => [app.actorNodeId, app.appId, app.appNodeId, app.appSlug].join(':'))).size !== trustedApps.length) fail('trustedApps must be unique.');
  if (typeof input.allowIndependentHumanApproval !== 'boolean') fail('allowIndependentHumanApproval must be boolean.');
  const withoutDigest = Object.freeze({
    schema: REVIEW_STABILITY_POLICY_SCHEMA,
    policyId: text(input.policyId, 'policyId'),
    trustedRevision: text(input.trustedRevision, 'trustedRevision'),
    trustedApps: Object.freeze(trustedApps),
    allowIndependentHumanApproval: input.allowIndependentHumanApproval
  });
  return Object.freeze({ ...withoutDigest, policyDigest: hash(withoutDigest) });
}

export function parseReviewStabilityPolicy(source: string): ReviewStabilityPolicy {
  const parsed = record(JSON.parse(source) as unknown, 'policy');
  exact(parsed, ['schema', 'policyId', 'trustedRevision', 'trustedApps', 'allowIndependentHumanApproval', 'policyDigest'], 'policy');
  if (parsed.schema !== REVIEW_STABILITY_POLICY_SCHEMA) fail('policy schema mismatch.');
  const policy = createReviewStabilityPolicy(parsed as unknown as ReviewStabilityPolicyInput);
  if (policy.policyDigest !== parsed.policyDigest) fail('policy digest mismatch.');
  return policy;
}

export const REVIEW_STABILITY_POLICY = createReviewStabilityPolicy({
  policyId: 'sec-independent-exact-head-review-v1',
  trustedRevision: 'sec-review-stability-trust-v1',
  trustedApps: [{
    actorNodeId: 'BOT_kgDOC98s_g',
    appId: 1144995,
    appNodeId: 'A_kwHOAOQ6Gs4AEXij',
    appSlug: 'chatgpt-codex-connector'
  }],
  allowIndependentHumanApproval: true
});

export const REVIEW_OBSERVER_PRODUCER_IDENTITY =
  'src/adapters/verification/platform/ci/runtime/verification-session-github.ts' as const;

export const REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT = hash(Object.freeze({
  schema: 'sec-review-observer-capability-receipt-v1',
  producerIdentity: REVIEW_OBSERVER_PRODUCER_IDENTITY,
  providerIdentity: 'github',
  candidateWriteCapability: 'read-only',
  trustedRevision: REVIEW_STABILITY_POLICY.trustedRevision
}));

export function createReviewStabilityReceipt(input: ReviewStabilityReceiptInput): ReviewStabilityReceipt {
  if (input.stage !== 'pre-expensive' && input.stage !== 'pre-merge') fail('stage is invalid.');
  const policy = parseReviewStabilityPolicy(encodeVerificationActionData(input.policy));
  const principalValue = record(input.principal, 'principal');
  let principal: ReviewPrincipal;
  if (principalValue.kind === 'human') {
    exact(principalValue, ['kind', 'nodeId', 'approvalState'], 'principal');
    if (!policy.allowIndependentHumanApproval || principalValue.approvalState !== 'APPROVED') fail('human principal is not policy-authorized APPROVED review.');
    principal = Object.freeze({ kind: 'human', nodeId: nodeId(principalValue.nodeId, 'principal.nodeId'), approvalState: 'APPROVED' });
  } else if (principalValue.kind === 'github-app') {
    exact(principalValue, ['kind', 'actorNodeId', 'appId', 'appNodeId', 'appSlug', 'reviewState'], 'principal');
    if (principalValue.reviewState !== 'APPROVED' && principalValue.reviewState !== 'COMMENTED') fail('principal.reviewState is invalid.');
    const candidate = Object.freeze({
      actorNodeId: nodeId(principalValue.actorNodeId, 'principal.actorNodeId'),
      appId: appId(principalValue.appId, 'principal.appId'),
      appNodeId: nodeId(principalValue.appNodeId, 'principal.appNodeId'),
      appSlug: appSlug(principalValue.appSlug, 'principal.appSlug')
    });
    if (!policy.trustedApps.some((app) => app.actorNodeId === candidate.actorNodeId
      && app.appId === candidate.appId
      && app.appNodeId === candidate.appNodeId
      && app.appSlug === candidate.appSlug)) fail('GitHub App principal is not in trusted policy.');
    principal = Object.freeze({ kind: 'github-app', ...candidate, reviewState: principalValue.reviewState });
  } else fail('principal kind is unknown.');
  const independenceValue = record(input.independence, 'independence');
  exact(independenceValue, ['candidateAuthorNodeId', 'integrationPrincipalNodeId'], 'independence');
  const independence = Object.freeze({ candidateAuthorNodeId: text(independenceValue.candidateAuthorNodeId, 'independence.candidateAuthorNodeId'), integrationPrincipalNodeId: text(independenceValue.integrationPrincipalNodeId, 'independence.integrationPrincipalNodeId') });
  const principalNodeId = principal.kind === 'human' ? principal.nodeId : principal.actorNodeId;
  if (principalNodeId === independence.candidateAuthorNodeId || principalNodeId === independence.integrationPrincipalNodeId) fail('review principal is not independent.');
  const producerValue = record(input.producer, 'producer');
  exact(producerValue, ['identity', 'executionIdentity', 'providerIdentity', 'candidateWriteCapability',
    'capabilityReceiptDigest', 'trustedRevision', 'sourceTransport', 'sourceRunId', 'sourceRef', 'sourceDigest'], 'producer');
  if (producerValue.sourceTransport !== 'github-graphql' && producerValue.sourceTransport !== 'github-rest') fail('producer.sourceTransport is invalid.');
  if (producerValue.providerIdentity !== 'github'
    || producerValue.candidateWriteCapability !== 'read-only') {
    fail('producer must be the GitHub-backed read-only Review observer.');
  }
  const producer = Object.freeze({ identity: text(producerValue.identity, 'producer.identity'),
    executionIdentity: text(producerValue.executionIdentity, 'producer.executionIdentity'),
    providerIdentity: 'github' as const,
    candidateWriteCapability: 'read-only' as const,
    capabilityReceiptDigest: digest(producerValue.capabilityReceiptDigest, 'producer.capabilityReceiptDigest'),
    trustedRevision: text(producerValue.trustedRevision, 'producer.trustedRevision'),
    sourceTransport: producerValue.sourceTransport, sourceRunId: text(producerValue.sourceRunId, 'producer.sourceRunId'),
    sourceRef: text(producerValue.sourceRef, 'producer.sourceRef'),
    sourceDigest: digest(producerValue.sourceDigest, 'producer.sourceDigest') });
  if (producer.identity !== REVIEW_OBSERVER_PRODUCER_IDENTITY
    || producer.executionIdentity === VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY
    || producer.capabilityReceiptDigest !== REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT) {
    fail('producer is not bound to the canonical independent read-only observer execution.');
  }
  if (producer.trustedRevision !== policy.trustedRevision) fail('producer trustedRevision must match policy.');
  const snapshotValue = record(input.snapshot, 'snapshot');
  exact(snapshotValue, ['paginationComplete', 'reviewedHeadSha', 'reviewPageDigests', 'threadPageDigests', 'reviewCount', 'threadCount', 'unresolvedBlockingThreadCount', 'requestChangesPrincipalIds', 'snapshotDigest'], 'snapshot');
  if (snapshotValue.paginationComplete !== true) fail('incomplete pagination is not a receipt.');
  if (snapshotValue.unresolvedBlockingThreadCount !== 0) fail('unresolved blocking threads reject receipt.');
  if (!Array.isArray(snapshotValue.requestChangesPrincipalIds) || snapshotValue.requestChangesPrincipalIds.length !== 0) fail('current REQUEST_CHANGES rejects receipt.');
  if (!Number.isSafeInteger(snapshotValue.reviewCount) || (snapshotValue.reviewCount as number) < 1 || !Number.isSafeInteger(snapshotValue.threadCount) || (snapshotValue.threadCount as number) < 0) fail('snapshot counts are invalid.');
  const headSha = sha(input.headSha, 'headSha');
  const snapshotWithoutDigest = Object.freeze({ paginationComplete: true as const, reviewedHeadSha: sha(snapshotValue.reviewedHeadSha, 'snapshot.reviewedHeadSha'), reviewPageDigests: digestList(snapshotValue.reviewPageDigests, 'snapshot.reviewPageDigests'), threadPageDigests: digestList(snapshotValue.threadPageDigests, 'snapshot.threadPageDigests'), reviewCount: snapshotValue.reviewCount as number, threadCount: snapshotValue.threadCount as number, unresolvedBlockingThreadCount: 0 as const, requestChangesPrincipalIds: Object.freeze([]) as readonly [] });
  const computedSnapshotDigest = createReviewSnapshotDigest(snapshotWithoutDigest);
  if (digest(snapshotValue.snapshotDigest, 'snapshot.snapshotDigest') !== computedSnapshotDigest) fail('snapshot digest mismatch.');
  const snapshot = Object.freeze({ ...snapshotWithoutDigest, snapshotDigest: computedSnapshotDigest });
  if (snapshot.reviewedHeadSha !== headSha) fail('reviewed commit marker does not match exact head.');
  const normalized = Object.freeze({ schema: REVIEW_STABILITY_RECEIPT_SCHEMA, stage: input.stage, repository: text(input.repository, 'repository'), prNumber: Number.isSafeInteger(input.prNumber) && input.prNumber > 0 ? input.prNumber : fail('prNumber must be positive.'), sessionRevision: digest(input.sessionRevision, 'sessionRevision'), scopeAuthorizationRevision: digest(input.scopeAuthorizationRevision, 'scopeAuthorizationRevision'), scopeAuthorizationReceiptDigest: digest(input.scopeAuthorizationReceiptDigest, 'scopeAuthorizationReceiptDigest'), headSha, headTreeSha: sha(input.headTreeSha, 'headTreeSha'), policy, principal, independence, producer, snapshot, reviewedAt: instant(input.reviewedAt, 'reviewedAt'), expiresAt: instant(input.expiresAt, 'expiresAt') });
  if (normalized.expiresAt <= normalized.reviewedAt) fail('expiresAt must be after reviewedAt.');
  const { producer: _producer, reviewedAt: _reviewedAt, expiresAt: _expiresAt,
    scopeAuthorizationReceiptDigest: _scopeReceipt, ...semantic } = normalized;
  const receipt = Object.freeze({ ...normalized, reviewRevision: hash(semantic) });
  return Object.freeze({ ...receipt, receiptDigest: hash(receipt) });
}

export function parseReviewStabilityReceipt(source: string): ReviewStabilityReceipt {
  const parsed = record(JSON.parse(source) as unknown, 'receipt');
  exact(parsed, ['schema', 'stage', 'repository', 'prNumber', 'sessionRevision', 'scopeAuthorizationRevision', 'scopeAuthorizationReceiptDigest', 'headSha', 'headTreeSha', 'policy', 'principal', 'independence', 'producer', 'snapshot', 'reviewedAt', 'expiresAt', 'reviewRevision', 'receiptDigest'], 'receipt');
  if (parsed.schema !== REVIEW_STABILITY_RECEIPT_SCHEMA) fail('schema mismatch.');
  const receipt = createReviewStabilityReceipt(parsed as unknown as ReviewStabilityReceiptInput);
  if (receipt.reviewRevision !== parsed.reviewRevision) fail('review semantic revision mismatch.');
  if (receipt.receiptDigest !== parsed.receiptDigest) fail('receipt digest mismatch.');
  return receipt;
}

export function assertReviewStabilityReceiptCurrent(receipt: ReviewStabilityReceipt, live: { readonly stage: ReviewStabilityStage; readonly sessionRevision: ReviewStabilityDigest; readonly scopeAuthorizationRevision: ReviewStabilityDigest; readonly scopeAuthorizationReceiptDigest: ReviewStabilityDigest; readonly headSha: string; readonly headTreeSha: string; readonly expectedPolicyDigest: ReviewStabilityDigest; readonly snapshotDigest: ReviewStabilityDigest; readonly expectedReviewRevision: ReviewStabilityDigest; readonly now: string }): void {
  const current = parseReviewStabilityReceipt(encodeVerificationActionData(receipt));
  const checks: readonly [unknown, unknown, string][] = [[live.stage, current.stage, 'stage'], [live.sessionRevision, current.sessionRevision, 'sessionRevision'], [live.scopeAuthorizationRevision, current.scopeAuthorizationRevision, 'scopeAuthorizationRevision'], [live.scopeAuthorizationReceiptDigest,current.scopeAuthorizationReceiptDigest,'scopeAuthorizationReceiptDigest'], [live.headSha, current.headSha, 'headSha'], [live.headTreeSha, current.headTreeSha, 'headTreeSha'], [live.expectedPolicyDigest, current.policy.policyDigest, 'policy'], [live.snapshotDigest, current.snapshot.snapshotDigest, 'review snapshot']];
  for (const [actual, expected, label] of checks) if (actual !== expected) fail(`${label} drift invalidates receipt.`);
  if (live.expectedReviewRevision !== current.reviewRevision) fail('reviewRevision drift invalidates receipt.');
  if (instant(live.now, 'now') > current.expiresAt) fail('receipt is expired.');
}

/**
 * The only origin of an `Independent-*` integration trailer is a validated
 * ReviewStabilityReceipt. Model free text can never fabricate one
 * (Issue #347 section G; PR #345 negative regression).
 */
export function renderIndependentReviewTrailer(receipt: ReviewStabilityReceipt): string {
  const current = parseReviewStabilityReceipt(encodeVerificationActionData(receipt));
  return `Independent-Exact-Head-Review: receipt=${current.receiptDigest} `
    + `revision=${current.reviewRevision} threads=${current.snapshot.threadCount} unresolved=0`;
}

export function assertMergeTrailerLines(
  lines: readonly string[],
  receipt: ReviewStabilityReceipt
): void {
  const canonical = renderIndependentReviewTrailer(receipt);
  for (const line of lines) {
    if (!line.startsWith('Independent-')) continue;
    if (line !== canonical) {
      fail('unbound Independent-* trailer is forbidden; integration trailers must derive from a validated receipt.');
    }
  }
}
