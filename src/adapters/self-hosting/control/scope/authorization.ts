import { z } from 'zod';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';

/** Content-integrity decision object, not a signature. Consumers independently verify issuer provenance and live candidate facts. */

const SCOPE_AUTHORIZATION_SCHEMA = 'sec-scope-authorization-v1' as const;
export type ScopeAuthorizationDigest = `sha256:${string}`;

interface ScopeAuthorizationIssuer {
  readonly principalId: string;
  readonly role: 'trusted-base-a0';
  readonly trustRevision: string;
  readonly producerIdentity: string;
  readonly sourceTransport: 'trusted-base' | 'github-actions';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: ScopeAuthorizationDigest;
}

type ScopeAuthorizationStableIssuer = Pick<
  ScopeAuthorizationIssuer,
  'principalId' | 'role' | 'trustRevision' | 'producerIdentity'
>;

export interface ScopeAuthorization {
  readonly schema: typeof SCOPE_AUTHORIZATION_SCHEMA;
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
  readonly issuer: ScopeAuthorizationIssuer;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authorizationRevision: ScopeAuthorizationDigest;
  readonly authorizationDigest: ScopeAuthorizationDigest;
}

export type ScopeAuthorizationInput = Omit<
  ScopeAuthorization,
  'schema' | 'authorizedPaths' | 'authorizationRevision' | 'authorizationDigest'
> & { readonly authorizedPaths: readonly string[] };

export type ScopeAuthorizationSemanticInput = Omit<
  ScopeAuthorizationInput,
  'issuer' | 'issuedAt' | 'expiresAt' | 'sessionProposalDigest' | 'actionPlanClosureDigest'
> & { readonly issuer: ScopeAuthorizationStableIssuer };

function fail(message: string): never {
  throw new Error(`ScopeAuthorization ${message}`);
}

const text = z.string().min(1).max(512).refine(value => !/[\u0000-\u001f]/u.test(value), 'must be bounded text.');
const sha = z.string().regex(/^[0-9a-f]{40}$/u, 'must be a commit/tree SHA.');
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u, 'must be a SHA-256 digest.')
  .transform(value => value as ScopeAuthorizationDigest);
const instant = text.refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, 'must be a canonical ISO timestamp.');
const path = text.refine(value => !(
  value.includes('\\') || value.startsWith('/') || value.includes('/../') || value.startsWith('../') || value === '..'
), 'must be repository-relative.');
const canonicalPaths = z.array(path).min(1).transform(values => values.sort())
  .refine(values => new Set(values).size === values.length, 'authorizedPaths must be unique.').readonly();
const stableIssuer = z.object({
  principalId: text,
  role: z.literal('trusted-base-a0'),
  trustRevision: sha,
  producerIdentity: text
}).strict();
const fullIssuer = stableIssuer.extend({
  sourceTransport: z.enum(['trusted-base', 'github-actions']),
  sourceRunId: text,
  sourceRef: text,
  sourceDigest: digest
}).strict();
// Issuer identity requires own enumerable fields; object schemas also read inherited fields.
const stableIssuerKeys = stableIssuer.keyof().array().length(stableIssuer.keyof().options.length);
const fullIssuerKeys = fullIssuer.keyof().array().length(fullIssuer.keyof().options.length);
const semanticInput = z.object({
  repository: text,
  prNumber: z.int().positive(),
  baseSha: sha,
  baseTreeSha: sha,
  headSha: sha,
  headTreeSha: sha,
  manifestPath: path,
  manifestDigest: digest,
  proposalDigest: digest,
  authorizedPaths: canonicalPaths,
  profile: text,
  environmentDigest: digest,
  issuer: z.preprocess(value => {
    stableIssuerKeys.parse(Object.keys(value ?? {}));
    return value;
  }, stableIssuer.readonly())
});
const authorizationInput = semanticInput.extend({
  issuer: z.preprocess(value => {
    fullIssuerKeys.parse(Object.keys(value ?? {}));
    return value;
  }, fullIssuer.readonly()),
  sessionProposalDigest: digest,
  actionPlanClosureDigest: digest,
  issuedAt: instant,
  expiresAt: instant
});
const authorizationEnvelope = authorizationInput.extend({
  schema: z.literal(SCOPE_AUTHORIZATION_SCHEMA),
  authorizationRevision: z.string(),
  authorizationDigest: z.string()
}).strict();

function hash(value: unknown): ScopeAuthorizationDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

export function createScopeAuthorizationRevision(
  input: ScopeAuthorizationSemanticInput
): ScopeAuthorizationDigest {
  return hashSemanticScope(semanticInput.parse(input));
}

export function createScopeAuthorization(input: ScopeAuthorizationInput): ScopeAuthorization {
  return sealScopeAuthorization(authorizationInput.parse(input));
}

function hashSemanticScope(input: ScopeAuthorizationSemanticInput): ScopeAuthorizationDigest {
  return hash(Object.freeze({ schema: SCOPE_AUTHORIZATION_SCHEMA, ...input }));
}

function sealScopeAuthorization(input: ScopeAuthorizationInput): ScopeAuthorization {
  const normalized = Object.freeze({
    schema: SCOPE_AUTHORIZATION_SCHEMA,
    ...input
  });
  if (normalized.expiresAt <= normalized.issuedAt) fail('expiresAt must be after issuedAt.');
  const { issuedAt: _issuedAt, expiresAt: _expiresAt, issuer: fullIssuer,
    sessionProposalDigest: _sessionProposalDigest, actionPlanClosureDigest: _actionPlanClosureDigest,
    ...semanticCore } = normalized;
  const authorizationRevision = hashSemanticScope({ ...semanticCore, issuer: {
    principalId: fullIssuer.principalId, role: fullIssuer.role, trustRevision: fullIssuer.trustRevision,
    producerIdentity: fullIssuer.producerIdentity
  } });
  const receipt = Object.freeze({ ...normalized, authorizationRevision });
  return Object.freeze({ ...receipt, authorizationDigest: hash(receipt) });
}

export function parseScopeAuthorization(source: string): ScopeAuthorization {
  const parsed = authorizationEnvelope.parse(JSON.parse(source) as unknown);
  const { schema: _schema, authorizationRevision: _revision, authorizationDigest: _digest, ...input } = parsed;
  const authorization = sealScopeAuthorization(input);
  if (authorization.authorizationRevision !== parsed.authorizationRevision) fail('semantic revision mismatch.');
  if (authorization.authorizationDigest !== parsed.authorizationDigest) fail('digest mismatch.');
  return authorization;
}

export interface ScopeAuthorizationLiveCandidate {
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

export function assertScopeAuthorizationCurrent(
  authorization: ScopeAuthorization,
  live: ScopeAuthorizationLiveCandidate
): void {
  const current = parseScopeAuthorization(encodeVerificationActionData(authorization));
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
  const livePaths = canonicalPaths.parse(live.changedPaths);
  if (encodeVerificationActionData(livePaths) !== encodeVerificationActionData(current.authorizedPaths)) {
    fail('candidate write-set drift invalidates authorization.');
  }
  if (instant.parse(live.now) > current.expiresAt) fail('receipt is expired.');
}
