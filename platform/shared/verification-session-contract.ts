/**
 * SEC VerificationSession contracts. V1 remains a reader-only stale boundary;
 * V2 owns semantic revision independently from run identity and timestamps.
 *
 * This module defines the machine registry projection, stable manifest/session
 * separation, and candidate-tree parity. The #313 published receipt mechanism
 * is an input fact for sessions; publication and readback stay with their
 * owning modules.
 */

import { createHash } from 'node:crypto';

import { encodeVerificationActionDataV2 } from './verification-action-contract.ts';

export const VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1 =
  'sec-verification-registry-projection-v1' as const;
export const VERIFICATION_FREEZE_SESSION_SCHEMA_V1 =
  'sec-verification-freeze-session-v1' as const;
export const VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1 =
  'sec-verification-candidate-tree-parity-v1' as const;
export const VERIFICATION_SESSION_SCHEMA_V2 = 'sec-verification-session-v2' as const;

export type VerificationManifestSource = 'default' | 'open-pr';

export interface VerificationRegistryEntryV1 {
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  source: VerificationManifestSource;
  prNumber: number | null;
  baseSha: string | null;
  headSha: string | null;
  headTreeSha: string | null;
}

export interface VerificationRegistryProjectionV1 {
  schema: typeof VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1;
  observedAt: string;
  repository: string;
  defaultBranch: string;
  defaultTreeSha: string;
  entries: VerificationRegistryEntryV1[];
}

export interface VerificationFreezeSessionV1 {
  schema: typeof VERIFICATION_FREEZE_SESSION_SCHEMA_V1;
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

export interface VerificationCandidateTreeParityV1 {
  schema: typeof VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1;
  checkedAt: string;
  repository: string;
  sessionId: string;
  prNumber: number;
  candidateTreeSha: string;
  mergedTreeSha: string;
  parity: 'matched' | 'drift';
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function assertSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a 40-character SHA.`);
  }
  return value;
}

function assertDigest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function assertRepository(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)
  ) {
    throw new Error('Verification session repository must be one owner/name identity.');
  }
  return value;
}

function assertManifestPath(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(value)
  ) {
    throw new Error('Manifest path must match docs/work-packages/<id>.md.');
  }
  return value;
}

function assertSessionId(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[a-z0-9][a-z0-9-]{1,127}$/u.test(value)
  ) {
    throw new Error('Session id must be a bounded lowercase identifier.');
  }
  return value;
}

function assertPrNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error('Pull request number must be a positive safe integer.');
  }
  return value as number;
}

function assertIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return value;
}

export function parseVerificationRegistryProjectionV1(
  source: string
): VerificationRegistryProjectionV1 {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Verification registry projection');
  if (parsed.schema !== VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1) {
    throw new Error('Verification registry projection schema mismatch.');
  }
  assertExactKeys(
    parsed,
    ['schema', 'observedAt', 'repository', 'defaultBranch', 'defaultTreeSha', 'entries'],
    'Verification registry projection'
  );
  const entries = parsed.entries;
  if (!Array.isArray(entries)) throw new Error('Registry entries must be an array.');
  const normalizedEntries = entries.map((entry, index) => {
    assertRecord(entry, `Registry entry ${index}`);
    assertExactKeys(
      entry,
      ['manifestPath', 'manifestDigest', 'source', 'prNumber', 'baseSha', 'headSha', 'headTreeSha'],
      `Registry entry ${index}`
    );
    const source = entry.source;
    let sourceKind: VerificationManifestSource;
    if (source === 'default') {
      sourceKind = 'default';
    } else if (source === 'open-pr') {
      sourceKind = 'open-pr';
    } else {
      throw new Error(`Registry entry ${index} source is invalid.`);
    }
    const manifestPath = assertManifestPath(entry.manifestPath);
    const prNumber = entry.prNumber === null ? null : assertPrNumber(entry.prNumber);
    if (sourceKind === 'open-pr' && (prNumber === null || entry.baseSha === null || entry.headSha === null || entry.headTreeSha === null)) {
      throw new Error(`Registry entry ${index} open-pr source requires PR/base/head/tree identity.`);
    }
    if (sourceKind === 'default' && (prNumber !== null || entry.baseSha !== null || entry.headSha !== null || entry.headTreeSha !== null)) {
      throw new Error(`Registry entry ${index} default source cannot bind PR identity.`);
    }
    return {
      manifestPath,
      manifestDigest: assertDigest(entry.manifestDigest, `Registry entry ${index} digest`),
      source: sourceKind,
      prNumber,
      baseSha: entry.baseSha === null ? null : assertSha(entry.baseSha, `Registry entry ${index} base`),
      headSha: entry.headSha === null ? null : assertSha(entry.headSha, `Registry entry ${index} head`),
      headTreeSha: entry.headTreeSha === null
        ? null
        : assertSha(entry.headTreeSha, `Registry entry ${index} head tree`)
    };
  });
  const paths = normalizedEntries.map(({ manifestPath }) => manifestPath);
  if (new Set(paths).size !== paths.length) {
    throw new Error('Registry projection contains duplicate manifest paths.');
  }
  return {
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
    observedAt: assertIsoDate(parsed.observedAt, 'Registry observedAt'),
    repository: assertRepository(parsed.repository),
    defaultBranch: typeof parsed.defaultBranch === 'string' && parsed.defaultBranch.length > 0
      ? parsed.defaultBranch
      : (() => { throw new Error('Registry defaultBranch is invalid.'); })(),
    defaultTreeSha: assertSha(parsed.defaultTreeSha, 'Registry defaultTreeSha'),
    entries: normalizedEntries
  };
}

function sessionDigest(value: Record<string, unknown>): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

/** @deprecated Legacy V1 projection builder; never valid as a V2 session or authorization input. */
export function createFreezeSessionV1(input: Omit<
  VerificationFreezeSessionV1,
  'schema' | 'sessionDigest'
>): VerificationFreezeSessionV1 {
  const withoutDigest = {
    schema: VERIFICATION_FREEZE_SESSION_SCHEMA_V1,
    sessionId: assertSessionId(input.sessionId),
    frozenAt: assertIsoDate(input.frozenAt, 'Freeze session frozenAt'),
    repository: assertRepository(input.repository),
    prNumber: assertPrNumber(input.prNumber),
    baseSha: assertSha(input.baseSha, 'Freeze session base'),
    headSha: assertSha(input.headSha, 'Freeze session head'),
    manifestPath: assertManifestPath(input.manifestPath),
    manifestDigest: assertDigest(input.manifestDigest, 'Freeze session manifestDigest'),
    candidateTreeSha: assertSha(input.candidateTreeSha, 'Freeze session candidateTreeSha')
  };
  return Object.freeze({ ...withoutDigest, sessionDigest: sessionDigest(withoutDigest) });
}

export function parseVerificationFreezeSessionV1(source: string): VerificationFreezeSessionV1 {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Verification freeze session');
  if (parsed.schema !== VERIFICATION_FREEZE_SESSION_SCHEMA_V1) {
    throw new Error('Verification freeze session schema mismatch.');
  }
  assertExactKeys(
    parsed,
    ['schema', 'sessionId', 'frozenAt', 'repository', 'prNumber', 'baseSha', 'headSha', 'manifestPath', 'manifestDigest', 'candidateTreeSha', 'sessionDigest'],
    'Verification freeze session'
  );
  const { sessionDigest: _sessionDigest, ...withoutDigest } = parsed;
  if (sessionDigest(withoutDigest) !== parsed.sessionDigest) {
    throw new Error('Verification freeze session digest mismatch.');
  }
  return {
    schema: VERIFICATION_FREEZE_SESSION_SCHEMA_V1,
    sessionId: assertSessionId(parsed.sessionId),
    frozenAt: assertIsoDate(parsed.frozenAt, 'Freeze session frozenAt'),
    repository: assertRepository(parsed.repository),
    prNumber: assertPrNumber(parsed.prNumber),
    baseSha: assertSha(parsed.baseSha, 'Freeze session base'),
    headSha: assertSha(parsed.headSha, 'Freeze session head'),
    manifestPath: assertManifestPath(parsed.manifestPath),
    manifestDigest: assertDigest(parsed.manifestDigest, 'Freeze session manifestDigest'),
    candidateTreeSha: assertSha(parsed.candidateTreeSha, 'Freeze session candidateTreeSha'),
    sessionDigest: assertDigest(parsed.sessionDigest, 'Freeze session sessionDigest')
  };
}

export function parseVerificationCandidateTreeParityV1(
  source: string
): VerificationCandidateTreeParityV1 {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Candidate tree parity');
  if (parsed.schema !== VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1) {
    throw new Error('Candidate tree parity schema mismatch.');
  }
  assertExactKeys(
    parsed,
    ['schema', 'checkedAt', 'repository', 'sessionId', 'prNumber', 'candidateTreeSha', 'mergedTreeSha', 'parity'],
    'Candidate tree parity'
  );
  if (parsed.parity !== 'matched' && parsed.parity !== 'drift') {
    throw new Error('Candidate tree parity value is invalid.');
  }
  return {
    schema: VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1,
    checkedAt: assertIsoDate(parsed.checkedAt, 'Candidate tree parity checkedAt'),
    repository: assertRepository(parsed.repository),
    sessionId: assertSessionId(parsed.sessionId),
    prNumber: assertPrNumber(parsed.prNumber),
    candidateTreeSha: assertSha(parsed.candidateTreeSha, 'Candidate tree candidateTreeSha'),
    mergedTreeSha: assertSha(parsed.mergedTreeSha, 'Candidate tree mergedTreeSha'),
    parity: parsed.parity
  };
}

/** @deprecated Legacy V1 tree-parity projection; V2 authorization consumes exact tree facts directly. */
export function createCandidateTreeParityV1(input: Omit<
  VerificationCandidateTreeParityV1,
  'schema' | 'parity'
>): VerificationCandidateTreeParityV1 {
  const candidateTreeSha = assertSha(input.candidateTreeSha, 'Candidate tree candidateTreeSha');
  const mergedTreeSha = assertSha(input.mergedTreeSha, 'Candidate tree mergedTreeSha');
  return Object.freeze({
    schema: VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1,
    checkedAt: assertIsoDate(input.checkedAt, 'Candidate tree parity checkedAt'),
    repository: assertRepository(input.repository),
    sessionId: assertSessionId(input.sessionId),
    prNumber: assertPrNumber(input.prNumber),
    candidateTreeSha,
    mergedTreeSha,
    parity: candidateTreeSha === mergedTreeSha ? 'matched' : 'drift'
  });
}

export interface VerificationSessionMainHealthRefV2 {
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly healthRevision: `sha256:${string}`;
  /** Full observation receipt reference; excluded from stable sessionRevision. */
  readonly ledgerReceiptDigest: `sha256:${string}`;
}

export interface VerificationSessionV2 {
  readonly schema: typeof VERIFICATION_SESSION_SCHEMA_V2;
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
  readonly mainHealthRef: VerificationSessionMainHealthRefV2;
  readonly sessionRevision: `sha256:${string}`;
}

export type VerificationSessionInputV2 = Omit<VerificationSessionV2, 'schema' | 'sessionRevision'>;
export type VerificationSessionSemanticInputV2 = Omit<
  VerificationSessionInputV2,
  'sessionId' | 'createdAt' | 'scopeAuthorizationReceiptDigest' | 'mainHealthRef'
> & { readonly mainHealthRef: Omit<VerificationSessionMainHealthRefV2, 'ledgerReceiptDigest'> };

export interface VerificationSessionProposalInputV1 {
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

function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be bounded text.`);
  }
  return value;
}

export function createVerificationSessionProposalDigestV1(
  input: VerificationSessionProposalInputV1
): `sha256:${string}` {
  return sessionDigest(Object.freeze({
    repository: assertRepository(input.repository), prNumber: assertPrNumber(input.prNumber),
    baseSha: assertSha(input.baseSha, 'Session proposal baseSha'),
    baseTreeSha: assertSha(input.baseTreeSha, 'Session proposal baseTreeSha'),
    headSha: assertSha(input.headSha, 'Session proposal headSha'),
    headTreeSha: assertSha(input.headTreeSha, 'Session proposal headTreeSha'),
    manifestPath: assertManifestPath(input.manifestPath),
    manifestDigest: assertDigest(input.manifestDigest, 'Session proposal manifestDigest'),
    testImpactTransitionDigest: assertDigest(
      input.testImpactTransitionDigest,
      'Session proposal testImpactTransitionDigest'
    ),
    scopeProposalDigest: assertDigest(input.scopeProposalDigest, 'Session proposal scopeProposalDigest'),
    actionPlanClosureDigest: assertDigest(input.actionPlanClosureDigest, 'Session proposal actionPlanClosureDigest'),
    profile: assertText(input.profile, 'Session proposal profile'),
    environmentDigest: assertDigest(input.environmentDigest, 'Session proposal environmentDigest'),
    trustRevision: assertSha(input.trustRevision, 'Session proposal trustRevision'),
    reviewPolicyDigest: assertDigest(input.reviewPolicyDigest, 'Session proposal reviewPolicyDigest'),
    mainHealthPolicyDigest: assertDigest(input.mainHealthPolicyDigest, 'Session proposal mainHealthPolicyDigest')
  }));
}

function createVerificationSessionSemanticInputV2(input: VerificationSessionSemanticInputV2) {
  const mainHealthRef = input.mainHealthRef;
  assertRecord(mainHealthRef, 'Verification session mainHealthRef');
  assertExactKeys(mainHealthRef, ['mainSha', 'mainTreeSha', 'healthRevision'], 'Verification session mainHealthRef');
  return Object.freeze({
    repository: assertRepository(input.repository),
    prNumber: assertPrNumber(input.prNumber),
    baseSha: assertSha(input.baseSha, 'Verification session baseSha'),
    baseTreeSha: assertSha(input.baseTreeSha, 'Verification session baseTreeSha'),
    headSha: assertSha(input.headSha, 'Verification session headSha'),
    headTreeSha: assertSha(input.headTreeSha, 'Verification session headTreeSha'),
    manifestPath: assertManifestPath(input.manifestPath),
    manifestDigest: assertDigest(input.manifestDigest, 'Verification session manifestDigest'),
    sessionProposalDigest: assertDigest(input.sessionProposalDigest, 'Verification session sessionProposalDigest'),
    scopeAuthorizationRevision: assertDigest(input.scopeAuthorizationRevision, 'Verification session scopeAuthorizationRevision'),
    actionPlanClosureDigest: assertDigest(input.actionPlanClosureDigest, 'Verification session actionPlanClosureDigest'),
    profile: assertText(input.profile, 'Verification session profile'),
    environmentDigest: assertDigest(input.environmentDigest, 'Verification session environmentDigest'),
    trustRevision: assertSha(input.trustRevision, 'Verification session trustRevision'),
    reviewPolicyDigest: assertDigest(input.reviewPolicyDigest, 'Verification session reviewPolicyDigest'),
    evidenceRequirementDigest: assertDigest(input.evidenceRequirementDigest, 'Verification session evidenceRequirementDigest'),
    integrationPolicyDigest: assertDigest(input.integrationPolicyDigest, 'Verification session integrationPolicyDigest'),
    mainHealthRef: Object.freeze({
      mainSha: assertSha(mainHealthRef.mainSha, 'Verification session mainHealthRef.mainSha'),
      mainTreeSha: assertSha(mainHealthRef.mainTreeSha, 'Verification session mainHealthRef.mainTreeSha'),
      healthRevision: assertDigest(mainHealthRef.healthRevision, 'Verification session mainHealthRef.healthRevision')
    })
  });
}

export function createVerificationSessionV2(input: VerificationSessionInputV2): VerificationSessionV2 {
  const { sessionId: _sessionId, createdAt: _createdAt,
    scopeAuthorizationReceiptDigest: _scopeReceipt, mainHealthRef, ...stable } = input;
  const semantic = createVerificationSessionSemanticInputV2({ ...stable, mainHealthRef: {
    mainSha: mainHealthRef.mainSha, mainTreeSha: mainHealthRef.mainTreeSha,
    healthRevision: mainHealthRef.healthRevision
  } });
  return Object.freeze({
    schema: VERIFICATION_SESSION_SCHEMA_V2,
    sessionId: assertSessionId(input.sessionId),
    createdAt: assertIsoDate(input.createdAt, 'Verification session createdAt'),
    scopeAuthorizationReceiptDigest: assertDigest(input.scopeAuthorizationReceiptDigest, 'Verification session scopeAuthorizationReceiptDigest'),
    ...semantic,
    mainHealthRef: Object.freeze({ ...semantic.mainHealthRef,
      ledgerReceiptDigest: assertDigest(input.mainHealthRef.ledgerReceiptDigest, 'Verification session mainHealthRef.ledgerReceiptDigest') }),
    sessionRevision: sessionDigest(semantic)
  });
}

export function createVerificationSessionRevisionV2(
  input: VerificationSessionSemanticInputV2
): `sha256:${string}` {
  return sessionDigest(createVerificationSessionSemanticInputV2(input));
}

export function parseVerificationSessionV2(source: string): VerificationSessionV2 {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Verification session V2');
  if (parsed.schema !== VERIFICATION_SESSION_SCHEMA_V2) throw new Error('Verification session V2 schema mismatch.');
  assertExactKeys(parsed, [
    'schema', 'sessionId', 'createdAt', 'repository', 'prNumber', 'baseSha', 'baseTreeSha',
    'headSha', 'headTreeSha', 'manifestPath', 'manifestDigest', 'sessionProposalDigest', 'scopeAuthorizationRevision',
    'scopeAuthorizationReceiptDigest',
    'actionPlanClosureDigest', 'profile', 'environmentDigest', 'trustRevision', 'reviewPolicyDigest',
    'evidenceRequirementDigest', 'integrationPolicyDigest', 'mainHealthRef', 'sessionRevision'
  ], 'Verification session V2');
  const { schema: _schema, sessionRevision: _sessionRevision, ...input } = parsed;
  const session = createVerificationSessionV2(input as unknown as VerificationSessionInputV2);
  if (session.sessionRevision !== parsed.sessionRevision) throw new Error('Verification session V2 revision mismatch.');
  return session;
}
