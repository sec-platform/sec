/**
 * SEC VerificationSession contracts. V1 remains a reader-only stale boundary;
 * V2 owns semantic revision independently from run identity and timestamps.
 *
 * This module defines the machine registry projection and stable
 * manifest/session separation. The #313 published receipt mechanism
 * is an input fact for sessions; publication and readback stay with their
 * owning modules.
 */

import { z } from 'zod';

import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';

export const VERIFICATION_REGISTRY_PROJECTION_SCHEMA =
  'sec-verification-registry-projection-v1' as const;
export const VERIFICATION_FREEZE_SESSION_SCHEMA =
  'sec-verification-freeze-session-v1' as const;
export const VERIFICATION_SESSION_SCHEMA = 'sec-verification-session-v2' as const;
export const VERIFICATION_SESSION_RUNTIME_ENTRYPOINT_PATH =
  'src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts' as const;
export const VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY =
  'src/adapters/verification/platform/ci/runtime/verification-session.ts' as const;

type VerificationManifestSource = 'default' | 'open-pr';

export interface VerificationRegistryEntry {
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  source: VerificationManifestSource;
  prNumber: number | null;
  baseSha: string | null;
  headSha: string | null;
  headTreeSha: string | null;
}

export interface VerificationRegistryProjection {
  schema: typeof VERIFICATION_REGISTRY_PROJECTION_SCHEMA;
  observedAt: string;
  repository: string;
  defaultBranch: string;
  defaultTreeSha: string;
  entries: VerificationRegistryEntry[];
}

export interface VerificationFreezeSession {
  schema: typeof VERIFICATION_FREEZE_SESSION_SCHEMA;
  sessionId: string;
  frozenAt: string;
  repository: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  candidateTreeSha: string;
  sessionDigest: `sha256:${string}`;
}

const sha = z.string().regex(/^[0-9a-f]{40}$/u, 'must be a 40-character SHA.');
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u, 'must be a SHA-256 digest.')
  .transform(value => value as `sha256:${string}`);
const repository = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u,
  'Verification session repository must be one owner/name identity.');
const manifestPath = z.string().regex(/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u,
  'Manifest path must match config/repository/work-packages/<id>.md.');
const sessionId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,127}$/u,
  'Session id must be a bounded lowercase identifier.');
const prNumber = z.int().positive();
// This existing wire contract validates timestamp syntax, not calendar validity.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  'must be an ISO-8601 UTC timestamp.');
const text = z.string().min(1).max(512).refine(value => !/[\u0000-\u001f]/u.test(value),
  'must be bounded text.');
const registryEntry = z.object({
  manifestPath,
  manifestDigest: digest,
  source: z.enum(['default', 'open-pr']),
  prNumber: prNumber.nullable(),
  baseSha: sha.nullable(),
  headSha: sha.nullable(),
  headTreeSha: sha.nullable()
}).strict().refine(entry => entry.source !== 'open-pr' || (
  entry.prNumber !== null && entry.baseSha !== null && entry.headSha !== null && entry.headTreeSha !== null
), 'open-pr source requires PR/base/head/tree identity.').refine(entry => entry.source !== 'default' || (
  entry.prNumber === null && entry.baseSha === null && entry.headSha === null && entry.headTreeSha === null
), 'default source cannot bind PR identity.');
const registryProjection = z.object({
  schema: z.literal(VERIFICATION_REGISTRY_PROJECTION_SCHEMA),
  observedAt: isoDate,
  repository,
  defaultBranch: z.string().min(1),
  defaultTreeSha: sha,
  entries: z.array(registryEntry).refine(entries =>
    new Set(entries.map(entry => entry.manifestPath)).size === entries.length,
  'Registry projection contains duplicate manifest paths.')
}).strict();
const freezeSession = z.object({
  schema: z.literal(VERIFICATION_FREEZE_SESSION_SCHEMA),
  sessionId,
  frozenAt: isoDate,
  repository,
  prNumber,
  baseSha: sha,
  headSha: sha,
  manifestPath,
  manifestDigest: digest,
  candidateTreeSha: sha,
  sessionDigest: z.string()
}).strict();

export function parseVerificationRegistryProjection(
  source: string
): VerificationRegistryProjection {
  return registryProjection.parse(JSON.parse(source) as unknown);
}

function sessionDigest(value: Record<string, unknown>): `sha256:${string}` {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

export function parseVerificationFreezeSession(source: string): VerificationFreezeSession {
  const parsed = freezeSession.parse(JSON.parse(source) as unknown);
  const { sessionDigest: _sessionDigest, ...withoutDigest } = parsed;
  const expectedDigest = sessionDigest(withoutDigest);
  if (expectedDigest !== parsed.sessionDigest) {
    throw new Error('Verification freeze session digest mismatch.');
  }
  return { ...withoutDigest, sessionDigest: expectedDigest };
}

interface VerificationSessionMainHealthRef {
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly healthRevision: `sha256:${string}`;
  /** Full observation receipt reference; excluded from stable sessionRevision. */
  readonly ledgerReceiptDigest: `sha256:${string}`;
}

export interface VerificationSession {
  readonly schema: typeof VERIFICATION_SESSION_SCHEMA;
  /** Run identity only; excluded from sessionRevision. */
  readonly sessionId: string;
  /** Run timestamp only; excluded from sessionRevision. */
  readonly createdAt: string;
  readonly repository: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly sessionProposalDigest: `sha256:${string}`;
  readonly scopeAuthorizationRevision: `sha256:${string}`;
  /** Full provenance receipt reference; excluded from stable sessionRevision. */
  readonly scopeAuthorizationReceiptDigest: `sha256:${string}`;
  readonly actionPlanClosureDigest: `sha256:${string}`;
  readonly profile: string;
  readonly environmentDigest: `sha256:${string}`;
  readonly trustRevision: string;
  readonly reviewPolicyDigest: `sha256:${string}`;
  readonly evidenceRequirementDigest: `sha256:${string}`;
  readonly integrationPolicyDigest: `sha256:${string}`;
  readonly mainHealthRef: VerificationSessionMainHealthRef;
  readonly sessionRevision: `sha256:${string}`;
}

export type VerificationSessionInput = Omit<VerificationSession, 'schema' | 'sessionRevision'>;
export type VerificationSessionSemanticInput = Omit<
  VerificationSessionInput,
  'sessionId' | 'createdAt' | 'scopeAuthorizationReceiptDigest' | 'mainHealthRef'
> & { readonly mainHealthRef: Omit<VerificationSessionMainHealthRef, 'ledgerReceiptDigest'> };

export interface VerificationSessionProposalInput {
  readonly repository: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly testImpactTransitionDigest: `sha256:${string}`;
  readonly scopeProposalDigest: `sha256:${string}`;
  readonly actionPlanClosureDigest: `sha256:${string}`;
  readonly profile: string;
  readonly environmentDigest: `sha256:${string}`;
  readonly trustRevision: string;
  readonly reviewPolicyDigest: `sha256:${string}`;
  readonly mainHealthPolicyDigest: `sha256:${string}`;
}

const candidateInput = z.object({
  repository,
  prNumber,
  baseSha: sha,
  baseTreeSha: sha,
  headSha: sha,
  headTreeSha: sha,
  manifestPath,
  manifestDigest: digest,
  actionPlanClosureDigest: digest,
  profile: text,
  environmentDigest: digest,
  trustRevision: sha,
  reviewPolicyDigest: digest
});
const proposalInput = candidateInput.extend({
  testImpactTransitionDigest: digest,
  scopeProposalDigest: digest,
  mainHealthPolicyDigest: digest
});
const semanticMainHealth = z.object({
  mainSha: sha,
  mainTreeSha: sha,
  healthRevision: digest
});
const semanticMainHealthKeys = semanticMainHealth.keyof().array()
  .length(semanticMainHealth.keyof().options.length);
const semanticFields = candidateInput.extend({
  sessionProposalDigest: digest,
  scopeAuthorizationRevision: digest,
  evidenceRequirementDigest: digest,
  integrationPolicyDigest: digest
});
const semanticInput = semanticFields.extend({
  // Validate keys and values from the same captured reference, without accepting inherited identity fields.
  mainHealthRef: z.preprocess(value => {
    semanticMainHealthKeys.parse(Object.keys(value ?? {}));
    return value;
  }, semanticMainHealth.strict().readonly())
});
const sessionInput = semanticFields.extend({
  sessionId,
  createdAt: isoDate,
  scopeAuthorizationReceiptDigest: digest,
  // Full creation has always projected this reference, including ignoring extra fields.
  mainHealthRef: semanticMainHealth.extend({ ledgerReceiptDigest: digest }).readonly()
});
const sessionEnvelope = sessionInput.extend({
  schema: z.literal(VERIFICATION_SESSION_SCHEMA),
  sessionRevision: z.string()
}).strict();

export function createVerificationSessionProposalDigest(
  input: VerificationSessionProposalInput
): `sha256:${string}` {
  return sessionDigest(proposalInput.parse(input));
}

export function createVerificationSession(input: VerificationSessionInput): VerificationSession {
  // Stable fields historically come from object rest: inherited/non-enumerable fields cannot supply them.
  const { sessionId, createdAt, scopeAuthorizationReceiptDigest, mainHealthRef, ...stable } = input;
  return sealSession(sessionInput.parse({
    ...stable, sessionId, createdAt, scopeAuthorizationReceiptDigest, mainHealthRef
  }));
}

function sealSession(input: VerificationSessionInput): VerificationSession {
  const { sessionId, createdAt, scopeAuthorizationReceiptDigest, mainHealthRef, ...stable } = input;
  const semantic = Object.freeze({ ...stable, mainHealthRef: Object.freeze({
    mainSha: mainHealthRef.mainSha, mainTreeSha: mainHealthRef.mainTreeSha,
    healthRevision: mainHealthRef.healthRevision
  }) });
  return Object.freeze({
    schema: VERIFICATION_SESSION_SCHEMA,
    sessionId,
    createdAt,
    scopeAuthorizationReceiptDigest,
    ...semantic,
    mainHealthRef,
    sessionRevision: sessionDigest(semantic)
  });
}

export function createVerificationSessionRevision(
  input: VerificationSessionSemanticInput
): `sha256:${string}` {
  return sessionDigest(semanticInput.parse(input));
}

export function parseVerificationSession(source: string): VerificationSession {
  const parsed = sessionEnvelope.parse(JSON.parse(source) as unknown);
  const { schema: _schema, sessionRevision: _sessionRevision, ...input } = parsed;
  const session = sealSession(input);
  if (session.sessionRevision !== parsed.sessionRevision) throw new Error('Verification session V2 revision mismatch.');
  return session;
}
