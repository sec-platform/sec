import { createHash } from 'node:crypto';

import { encodeVerificationActionDataV2 } from './verification-action-contract.ts';

/** Content-integrity decision object, not a signature. Consumers independently verify issuer provenance and live candidate facts. */

export const SCOPE_AUTHORIZATION_SCHEMA_V1 = 'sec-scope-authorization-v1' as const;
export type ScopeAuthorizationDigest = `sha256:${string}`;

export interface ScopeAuthorizationIssuerV1 {
  readonly principalId: string;
  readonly role: 'trusted-base-a0';
  readonly trustRevision: string;
  readonly producerIdentity: string;
  readonly sourceTransport: 'trusted-base' | 'github-actions';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: ScopeAuthorizationDigest;
}

export type ScopeAuthorizationStableIssuerV1 = Pick<
  ScopeAuthorizationIssuerV1,
  'principalId' | 'role' | 'trustRevision' | 'producerIdentity'
>;

export interface ScopeAuthorizationV1 {
  readonly schema: typeof SCOPE_AUTHORIZATION_SCHEMA_V1;
  readonly repository: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: ScopeAuthorizationDigest;
  /** Digest of the immutable proposal before trusted-base authorization. */
  readonly proposalDigest: ScopeAuthorizationDigest;
  readonly authorizedPaths: readonly string[];
  /** Full downstream session proposal coherence; excluded from authorizationRevision. */
  readonly sessionProposalDigest: ScopeAuthorizationDigest;
  readonly actionPlanClosureDigest: ScopeAuthorizationDigest;
  readonly profile: string;
  readonly environmentDigest: ScopeAuthorizationDigest;
  readonly issuer: ScopeAuthorizationIssuerV1;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authorizationRevision: ScopeAuthorizationDigest;
  readonly authorizationDigest: ScopeAuthorizationDigest;
}

export type ScopeAuthorizationInputV1 = Omit<
  ScopeAuthorizationV1,
  'schema' | 'authorizedPaths' | 'authorizationRevision' | 'authorizationDigest'
> & { readonly authorizedPaths: readonly string[] };

export type ScopeAuthorizationSemanticInputV1 = Omit<
  ScopeAuthorizationInputV1,
  'issuer' | 'issuedAt' | 'expiresAt' | 'sessionProposalDigest' | 'actionPlanClosureDigest'
> & { readonly issuer: ScopeAuthorizationStableIssuerV1 };

function fail(message: string): never {
  throw new Error(`ScopeAuthorization ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} must be bounded text.`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) fail(`${label} must be a commit/tree SHA.`);
  return value;
}

function digest(value: unknown, label: string): ScopeAuthorizationDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) fail(`${label} must be a SHA-256 digest.`);
  return value as ScopeAuthorizationDigest;
}

function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO timestamp.`);
  return result;
}

function path(value: unknown, label: string): string {
  const result = text(value, label);
  if (result.includes('\\') || result.startsWith('/') || result.includes('/../') || result.startsWith('../') || result === '..') {
    fail(`${label} must be repository-relative.`);
  }
  return result;
}

function canonicalPaths(values: unknown): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) fail('authorizedPaths must be a non-empty array.');
  const result = values.map((value, index) => path(value, `authorizedPaths[${index}]`)).sort();
  if (new Set(result).size !== result.length) fail('authorizedPaths must be unique.');
  return Object.freeze(result);
}

function hash(value: unknown): ScopeAuthorizationDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

export function createScopeAuthorizationRevisionV1(
  input: ScopeAuthorizationSemanticInputV1
): ScopeAuthorizationDigest {
  const issuer = record(input.issuer, 'semantic issuer');
  exact(issuer, ['principalId', 'role', 'trustRevision', 'producerIdentity'], 'semantic issuer');
  if (issuer.role !== 'trusted-base-a0') fail('semantic issuer.role must be trusted-base-a0.');
  return hash(Object.freeze({
    schema: SCOPE_AUTHORIZATION_SCHEMA_V1,
    repository: text(input.repository, 'repository'),
    prNumber: Number.isSafeInteger(input.prNumber) && input.prNumber > 0 ? input.prNumber : fail('prNumber must be positive.'),
    baseSha: sha(input.baseSha, 'baseSha'), baseTreeSha: sha(input.baseTreeSha, 'baseTreeSha'),
    headSha: sha(input.headSha, 'headSha'), headTreeSha: sha(input.headTreeSha, 'headTreeSha'),
    manifestPath: path(input.manifestPath, 'manifestPath'), manifestDigest: digest(input.manifestDigest, 'manifestDigest'),
    proposalDigest: digest(input.proposalDigest, 'proposalDigest'), authorizedPaths: canonicalPaths(input.authorizedPaths),
    profile: text(input.profile, 'profile'), environmentDigest: digest(input.environmentDigest, 'environmentDigest'),
    issuer: Object.freeze({ principalId: text(issuer.principalId, 'issuer.principalId'), role: 'trusted-base-a0' as const,
      trustRevision: sha(issuer.trustRevision, 'issuer.trustRevision'), producerIdentity: text(issuer.producerIdentity, 'issuer.producerIdentity') })
  }));
}

export function createScopeAuthorizationV1(input: ScopeAuthorizationInputV1): ScopeAuthorizationV1 {
  const issuer = record(input.issuer, 'issuer');
  exact(issuer, ['principalId', 'role', 'trustRevision', 'producerIdentity', 'sourceTransport', 'sourceRunId', 'sourceRef', 'sourceDigest'], 'issuer');
  if (issuer.role !== 'trusted-base-a0') fail('issuer.role must be trusted-base-a0.');
  if (issuer.sourceTransport !== 'trusted-base' && issuer.sourceTransport !== 'github-actions') fail('issuer.sourceTransport is invalid.');
  const normalized = Object.freeze({
    schema: SCOPE_AUTHORIZATION_SCHEMA_V1,
    repository: text(input.repository, 'repository'),
    prNumber: Number.isSafeInteger(input.prNumber) && input.prNumber > 0 ? input.prNumber : fail('prNumber must be positive.'),
    baseSha: sha(input.baseSha, 'baseSha'),
    baseTreeSha: sha(input.baseTreeSha, 'baseTreeSha'),
    headSha: sha(input.headSha, 'headSha'),
    headTreeSha: sha(input.headTreeSha, 'headTreeSha'),
    manifestPath: path(input.manifestPath, 'manifestPath'),
    manifestDigest: digest(input.manifestDigest, 'manifestDigest'),
    proposalDigest: digest(input.proposalDigest, 'proposalDigest'),
    authorizedPaths: canonicalPaths(input.authorizedPaths),
    sessionProposalDigest: digest(input.sessionProposalDigest, 'sessionProposalDigest'),
    actionPlanClosureDigest: digest(input.actionPlanClosureDigest, 'actionPlanClosureDigest'),
    profile: text(input.profile, 'profile'),
    environmentDigest: digest(input.environmentDigest, 'environmentDigest'),
    issuer: Object.freeze({
      principalId: text(issuer.principalId, 'issuer.principalId'),
      role: 'trusted-base-a0' as const,
      trustRevision: sha(issuer.trustRevision, 'issuer.trustRevision'),
      producerIdentity: text(issuer.producerIdentity, 'issuer.producerIdentity'),
      sourceTransport: issuer.sourceTransport,
      sourceRunId: text(issuer.sourceRunId, 'issuer.sourceRunId'),
      sourceRef: text(issuer.sourceRef, 'issuer.sourceRef'),
      sourceDigest: digest(issuer.sourceDigest, 'issuer.sourceDigest')
    }),
    issuedAt: instant(input.issuedAt, 'issuedAt'),
    expiresAt: instant(input.expiresAt, 'expiresAt')
  });
  if (normalized.expiresAt <= normalized.issuedAt) fail('expiresAt must be after issuedAt.');
  const { issuedAt: _issuedAt, expiresAt: _expiresAt, issuer: fullIssuer,
    sessionProposalDigest: _sessionProposalDigest, actionPlanClosureDigest: _actionPlanClosureDigest,
    ...semanticCore } = normalized;
  const authorizationRevision = createScopeAuthorizationRevisionV1({ ...semanticCore, issuer: {
    principalId: fullIssuer.principalId, role: fullIssuer.role, trustRevision: fullIssuer.trustRevision,
    producerIdentity: fullIssuer.producerIdentity
  } });
  const receipt = Object.freeze({ ...normalized, authorizationRevision });
  return Object.freeze({ ...receipt, authorizationDigest: hash(receipt) });
}

export function parseScopeAuthorizationV1(source: string): ScopeAuthorizationV1 {
  const parsed = record(JSON.parse(source) as unknown, 'receipt');
  exact(parsed, [
    'schema', 'repository', 'prNumber', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha',
    'manifestPath', 'manifestDigest', 'proposalDigest', 'authorizedPaths', 'sessionProposalDigest',
    'actionPlanClosureDigest', 'profile', 'environmentDigest', 'issuer', 'issuedAt', 'expiresAt',
    'authorizationRevision', 'authorizationDigest'
  ], 'receipt');
  if (parsed.schema !== SCOPE_AUTHORIZATION_SCHEMA_V1) fail('schema mismatch.');
  const authorization = createScopeAuthorizationV1(parsed as unknown as ScopeAuthorizationInputV1);
  if (authorization.authorizationRevision !== parsed.authorizationRevision) fail('semantic revision mismatch.');
  if (authorization.authorizationDigest !== parsed.authorizationDigest) fail('digest mismatch.');
  return authorization;
}

export interface ScopeAuthorizationLiveCandidateV1 {
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestDigest: ScopeAuthorizationDigest;
  readonly changedPaths: readonly string[];
  readonly sessionProposalDigest: ScopeAuthorizationDigest;
  readonly actionPlanClosureDigest: ScopeAuthorizationDigest;
  readonly environmentDigest: ScopeAuthorizationDigest;
  readonly expectedAuthorizationRevision: ScopeAuthorizationDigest;
  readonly now: string;
}

export function assertScopeAuthorizationCurrentV1(
  authorization: ScopeAuthorizationV1,
  live: ScopeAuthorizationLiveCandidateV1
): void {
  const current = parseScopeAuthorizationV1(encodeVerificationActionDataV2(authorization));
  if (live.expectedAuthorizationRevision !== current.authorizationRevision) fail('authorizationRevision drift invalidates authorization.');
  const checks: readonly [unknown, unknown, string][] = [
    [live.baseSha, current.baseSha, 'baseSha'], [live.baseTreeSha, current.baseTreeSha, 'baseTreeSha'],
    [live.headSha, current.headSha, 'headSha'], [live.headTreeSha, current.headTreeSha, 'headTreeSha'],
    [live.manifestDigest, current.manifestDigest, 'manifestDigest'],
    [live.sessionProposalDigest, current.sessionProposalDigest, 'sessionProposalDigest'],
    [live.actionPlanClosureDigest, current.actionPlanClosureDigest, 'actionPlanClosureDigest'],
    [live.environmentDigest, current.environmentDigest, 'environmentDigest']
  ];
  for (const [actual, expected, label] of checks) if (actual !== expected) fail(`${label} drift invalidates authorization.`);
  const livePaths = canonicalPaths(live.changedPaths);
  if (encodeVerificationActionDataV2(livePaths) !== encodeVerificationActionDataV2(current.authorizedPaths)) {
    fail('candidate write-set drift invalidates authorization.');
  }
  if (instant(live.now, 'now') > current.expiresAt) fail('receipt is expired.');
}
