import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  CodexDevelopmentAssertVerificationEvidenceV4,
  CodexDevelopmentAssertVerificationSessionArtifactV2,
  type CodexDevelopmentVerificationSessionArtifactV2
} from '../../platform/shared/ci-evidence-contract.ts';
import { CI_VERIFICATION_SESSION_ARTIFACT_PREFIX } from '../../platform/shared/ci-verification-revision.ts';
import {
  createIntegrationAuthorizationV1,
  parseIntegrationAuthorizationV1,
  type IntegrationAuthorizationV1
} from '../../platform/shared/integration-authorization-contract.ts';
import {
  parseMainHealthLedgerV1,
  resolveMainHealthLaneV1,
  type MainHealthLedgerV1
} from '../../platform/shared/main-health-contract.ts';
import {
  assertReviewStabilityReceiptCurrentV1,
  parseReviewStabilityReceiptV1,
  renderIndependentReviewTrailerV1,
  type ReviewStabilityReceiptV1
} from '../../platform/shared/review-stability-contract.ts';
import {
  assertScopeAuthorizationCurrentV1,
  type ScopeAuthorizationV1
} from '../../platform/shared/scope-authorization-contract.ts';
import {
  parseCiVerificationActionPlanClosureV1,
  type CiVerificationActionPlanClosureV1
} from '../../platform/shared/verification-action-ci-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import type { VerificationSessionV2 } from '../../platform/shared/verification-session-contract.ts';

export const CodexDevelopmentMergeGateInputSchemaV2 =
  'codex-development-merge-gate-input-v2' as const;
export const CodexDevelopmentMergeGateResultSchemaV2 =
  'codex-development-merge-gate-result-v2' as const;
export const CodexDevelopmentMergeGateProducerIdentityV2 =
  'scripts/codex/merge-gate.ts' as const;

export type MergeGateDigestV2 = `sha256:${string}`;

export interface CodexDevelopmentMergeGateProvenanceV2 {
  readonly workflowPath: '.github/workflows/sec-merge-gate.yml';
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly eventName: 'workflow_run';
  readonly sourceRunId: string;
  readonly sourceRunAttempt: number;
  readonly actorNodeId: string;
  readonly actorPermission: 'maintain' | 'admin';
  readonly sourceDigest: MergeGateDigestV2;
}

export interface CodexDevelopmentMergeGateCandidateV2 {
  readonly repository: string;
  readonly prNumber: number;
  readonly draft: false;
  readonly headOpenPullRequestCount: 1;
  readonly currentBaseSha: string;
  readonly currentBaseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly baseIsAncestor: true;
  readonly behindBy: 0;
  readonly manifestPath: string;
  readonly manifestDigest: MergeGateDigestV2;
  readonly changedPaths: readonly string[];
}

export interface CodexDevelopmentMergeGatePlatformObservationV2 {
  readonly status: 'available' | 'platform-enforcement-unavailable';
  readonly rulesetDigest: MergeGateDigestV2;
  readonly reason: string | null;
}

export interface CodexDevelopmentHostedArtifactObservationV2 {
  readonly artifactId: string;
  readonly artifactName: string;
  readonly artifactFileName: 'verification-session-artifact.json';
  readonly artifactByteDigest: MergeGateDigestV2;
  readonly artifactByteLength: number;
  readonly artifactExpired: false;
  readonly workflowPath: '.github/workflows/compiler-pr-validation.yml';
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly eventName: 'repository_dispatch';
  readonly actorNodeId: string;
  readonly actorPermission: 'maintain' | 'admin';
  readonly downloadTransport: 'github-actions-artifact-api';
}

export interface CodexDevelopmentMergeGateInputV2 {
  readonly schema: typeof CodexDevelopmentMergeGateInputSchemaV2;
  readonly provenance: CodexDevelopmentMergeGateProvenanceV2;
  readonly candidate: CodexDevelopmentMergeGateCandidateV2;
  readonly artifact: CodexDevelopmentVerificationSessionArtifactV2;
  readonly hostedArtifactOrigin: CodexDevelopmentHostedArtifactObservationV2;
  readonly hostedArtifactTransport: CodexDevelopmentHostedArtifactObservationV2;
  readonly expectedActionPlan: CiVerificationActionPlanClosureV1;
  readonly reviewReceipt: ReviewStabilityReceiptV1;
  readonly reviewSnapshotDigest: MergeGateDigestV2;
  readonly mainHealth: MainHealthLedgerV1;
  readonly environmentDigest: MergeGateDigestV2;
  readonly trustRevision: string;
  readonly platformObservation: CodexDevelopmentMergeGatePlatformObservationV2;
  readonly consumptionOperationId: MergeGateDigestV2;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type CodexDevelopmentMergeGateInputFieldsV2 = Omit<
  CodexDevelopmentMergeGateInputV2,
  'schema'
>;

export interface CodexDevelopmentMergeGateResultV2 {
  readonly schema: typeof CodexDevelopmentMergeGateResultSchemaV2;
  readonly status: 'authorized';
  readonly authorization: IntegrationAuthorizationV1;
  readonly reviewReceipt: ReviewStabilityReceiptV1;
  readonly mainHealth: MainHealthLedgerV1;
  readonly platformObservation: CodexDevelopmentMergeGatePlatformObservationV2;
  readonly hostedArtifactOrigin: CodexDevelopmentHostedArtifactObservationV2;
  readonly hostedArtifactTransport: CodexDevelopmentHostedArtifactObservationV2;
  readonly provenance: CodexDevelopmentMergeGateProvenanceV2;
  readonly terminalStatusContext: 'sec/merge-gate';
  readonly resultDigest: MergeGateDigestV2;
}

function fail(message: string): never { throw new Error(`MergeGate ${message}`); }
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) fail(`${label} must be bounded text.`);
  return value;
}
function sha(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a lowercase Git SHA.`);
  return result;
}
function digest(value: unknown, label: string): MergeGateDigestV2 {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) fail(`${label} must be a SHA-256 digest.`);
  return value as MergeGateDigestV2;
}
function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO timestamp.`);
  return result;
}
function hash(value: unknown): MergeGateDigestV2 {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(', ')}.`);
  }
  return record;
}

export function createMergeGateProvenanceV2(input: Omit<
  CodexDevelopmentMergeGateProvenanceV2,
  'sourceDigest'
>): CodexDevelopmentMergeGateProvenanceV2 {
  if (input.workflowPath !== '.github/workflows/sec-merge-gate.yml') fail('workflowPath is not canonical.');
  const workflowSha = sha(input.workflowSha, 'provenance.workflowSha');
  const expectedRef = `.github/workflows/sec-merge-gate.yml@${workflowSha}`;
  if (input.workflowRef !== expectedRef) fail('workflowRef must bind the exact trusted workflow blob revision.');
  if (input.eventName !== 'workflow_run') fail('authorization can only originate from workflow_run after hosted Evidence.');
  if (!Number.isSafeInteger(input.sourceRunAttempt) || input.sourceRunAttempt < 1) fail('sourceRunAttempt is invalid.');
  if (input.actorPermission !== 'maintain' && input.actorPermission !== 'admin') fail('actor permission is insufficient.');
  const withoutDigest = Object.freeze({
    workflowPath: input.workflowPath,
    workflowRef: input.workflowRef,
    workflowSha,
    eventName: input.eventName,
    sourceRunId: text(input.sourceRunId, 'provenance.sourceRunId'),
    sourceRunAttempt: input.sourceRunAttempt,
    actorNodeId: text(input.actorNodeId, 'provenance.actorNodeId'),
    actorPermission: input.actorPermission
  });
  return Object.freeze({ ...withoutDigest, sourceDigest: hash(withoutDigest) });
}

function assertProvenance(
  provenance: CodexDevelopmentMergeGateProvenanceV2,
  currentBase: string
): CodexDevelopmentMergeGateProvenanceV2 {
  const parsed = exact(provenance, [
    'workflowPath', 'workflowRef', 'workflowSha', 'eventName', 'sourceRunId', 'sourceRunAttempt',
    'actorNodeId', 'actorPermission', 'sourceDigest'
  ], 'provenance');
  const rebuilt = createMergeGateProvenanceV2(parsed as unknown as Omit<CodexDevelopmentMergeGateProvenanceV2, 'sourceDigest'>);
  if (rebuilt.sourceDigest !== parsed.sourceDigest) fail('provenance source digest mismatch.');
  if (rebuilt.workflowSha !== currentBase) fail('candidate/runtime workflow cannot issue authorization; workflow SHA must equal live trusted base.');
  return rebuilt;
}

function assertCandidate(candidate: CodexDevelopmentMergeGateCandidateV2): void {
  exact(candidate, [
    'repository', 'prNumber', 'draft', 'headOpenPullRequestCount', 'currentBaseSha', 'currentBaseTreeSha',
    'headSha', 'headTreeSha', 'baseIsAncestor', 'behindBy', 'manifestPath', 'manifestDigest', 'changedPaths'
  ], 'candidate');
  text(candidate.repository, 'candidate.repository');
  if (!Number.isSafeInteger(candidate.prNumber) || candidate.prNumber < 1) fail('candidate.prNumber is invalid.');
  if (candidate.draft !== false || candidate.headOpenPullRequestCount !== 1) fail('candidate is draft or exact head is ambiguous.');
  sha(candidate.currentBaseSha, 'candidate.currentBaseSha');
  sha(candidate.currentBaseTreeSha, 'candidate.currentBaseTreeSha');
  sha(candidate.headSha, 'candidate.headSha');
  sha(candidate.headTreeSha, 'candidate.headTreeSha');
  if (candidate.baseIsAncestor !== true || candidate.behindBy !== 0) {
    fail('candidate must contain current base and must not be behind; multi-commit candidates are allowed.');
  }
  text(candidate.manifestPath, 'candidate.manifestPath');
  digest(candidate.manifestDigest, 'candidate.manifestDigest');
  if (!Array.isArray(candidate.changedPaths) || candidate.changedPaths.length === 0) fail('candidate.changedPaths is unresolved.');
}

function canonicalPlatformObservation(
  value: CodexDevelopmentMergeGatePlatformObservationV2
): CodexDevelopmentMergeGatePlatformObservationV2 {
  exact(value, ['status', 'rulesetDigest', 'reason'], 'platformObservation');
  if (value.status !== 'available' && value.status !== 'platform-enforcement-unavailable') {
    fail('platformObservation status is unknown; authorization is locked.');
  }
  if (value.reason !== null) text(value.reason, 'platformObservation.reason');
  return Object.freeze({
    status: value.status,
    rulesetDigest: digest(value.rulesetDigest, 'platformObservation.rulesetDigest'),
    reason: value.reason
  });
}

export function CodexDevelopmentCreateHostedArtifactObservationV2(
  value: CodexDevelopmentHostedArtifactObservationV2
): CodexDevelopmentHostedArtifactObservationV2 {
  exact(value, [
    'artifactId', 'artifactName', 'artifactFileName', 'artifactByteDigest', 'artifactByteLength',
    'artifactExpired', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt',
    'eventName', 'actorNodeId', 'actorPermission', 'downloadTransport'
  ], 'hostedArtifactObservation');
  const artifactId = text(value.artifactId, 'hostedArtifactObservation.artifactId');
  if (!/^[1-9][0-9]*$/u.test(artifactId)) fail('hostedArtifactObservation.artifactId must be a decimal GitHub artifact id.');
  if (value.artifactFileName !== 'verification-session-artifact.json') fail('hosted artifact file name is not canonical.');
  if (!Number.isSafeInteger(value.artifactByteLength) || value.artifactByteLength < 1) fail('hosted artifact byte length is invalid.');
  if (value.artifactExpired !== false) fail('expired hosted artifacts cannot authorize integration.');
  if (value.workflowPath !== '.github/workflows/compiler-pr-validation.yml') fail('hosted artifact workflow path is not canonical.');
  const workflowSha = sha(value.workflowSha, 'hostedArtifactObservation.workflowSha');
  if (value.workflowRef !== `${value.workflowPath}@${workflowSha}`) fail('hosted artifact workflow ref is not exact.');
  if (!Number.isSafeInteger(value.runAttempt) || value.runAttempt < 1) fail('hosted artifact run attempt is invalid.');
  if (value.eventName !== 'repository_dispatch') fail('hosted artifact event is not the Session dispatch.');
  if (value.actorPermission !== 'maintain' && value.actorPermission !== 'admin') fail('hosted artifact actor permission is insufficient.');
  if (value.downloadTransport !== 'github-actions-artifact-api') fail('hosted artifact download transport is not canonical.');
  return Object.freeze({
    artifactId,
    artifactName: text(value.artifactName, 'hostedArtifactObservation.artifactName'),
    artifactFileName: value.artifactFileName,
    artifactByteDigest: digest(value.artifactByteDigest, 'hostedArtifactObservation.artifactByteDigest'),
    artifactByteLength: value.artifactByteLength,
    artifactExpired: false,
    workflowPath: value.workflowPath,
    workflowRef: value.workflowRef,
    workflowSha,
    runId: text(value.runId, 'hostedArtifactObservation.runId'),
    runAttempt: value.runAttempt,
    eventName: value.eventName,
    actorNodeId: text(value.actorNodeId, 'hostedArtifactObservation.actorNodeId'),
    actorPermission: value.actorPermission,
    downloadTransport: value.downloadTransport
  });
}

function expectedHostedArtifactName(
  prNumber: number,
  sessionRevision: string,
  observation: CodexDevelopmentHostedArtifactObservationV2
): string {
  return `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-pr-${prNumber}-session-${sessionRevision.slice('sha256:'.length)}-run-${observation.runId}-attempt-${observation.runAttempt}`;
}

function assertHostedArtifactClosure(
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  origin: CodexDevelopmentHostedArtifactObservationV2,
  transport: CodexDevelopmentHostedArtifactObservationV2,
  currentBaseSha: string
): void {
  const canonicalBytes = `${encodeVerificationActionDataV2(artifact)}\n`;
  const canonicalByteDigest = `sha256:${createHash('sha256').update(canonicalBytes).digest('hex')}`;
  const canonicalByteLength = Buffer.byteLength(canonicalBytes, 'utf8');
  for (const [label, observation] of [['origin', origin], ['transport', transport]] as const) {
    if (observation.workflowSha !== currentBaseSha ||
        observation.artifactName !== expectedHostedArtifactName(artifact.session.prNumber, artifact.session.sessionRevision, observation) ||
        observation.artifactByteDigest !== canonicalByteDigest ||
        observation.artifactByteLength !== canonicalByteLength) {
      fail(`hosted artifact ${label} does not bind the exact trusted canonical artifact bytes.`);
    }
  }
  const producer = artifact.producer;
  if (origin.workflowPath !== producer.workflowPath || origin.workflowRef !== producer.workflowRef ||
      origin.workflowSha !== producer.workflowSha || origin.runId !== producer.runId ||
      origin.runAttempt !== producer.runAttempt || origin.actorNodeId !== producer.actorNodeId) {
    fail('hosted artifact origin does not bind the immutable internal producer provenance.');
  }
  if (origin.artifactByteDigest !== transport.artifactByteDigest ||
      origin.artifactByteLength !== transport.artifactByteLength) {
    fail('hosted artifact origin and transport are not byte-identical.');
  }
  const sameRun = origin.runId === transport.runId && origin.runAttempt === transport.runAttempt;
  if (sameRun !== (origin.artifactId === transport.artifactId)) {
    fail('hosted artifact transport identity is inconsistent with direct versus reuploaded provenance.');
  }
}

function assertHostedArtifactResultClosure(
  authorization: IntegrationAuthorizationV1,
  origin: CodexDevelopmentHostedArtifactObservationV2,
  transport: CodexDevelopmentHostedArtifactObservationV2
): void {
  for (const observation of [origin, transport]) {
    if (observation.workflowSha !== authorization.baseSha ||
        observation.artifactName !== expectedHostedArtifactName(
          authorization.prNumber,
          authorization.sessionRevision,
          observation
        )) {
      fail('authorization result hosted artifact observation is not exact.');
    }
  }
  if (origin.artifactByteDigest !== transport.artifactByteDigest ||
      origin.artifactByteLength !== transport.artifactByteLength) {
    fail('authorization result hosted artifact observations are not byte-identical.');
  }
  const sameRun = origin.runId === transport.runId && origin.runAttempt === transport.runAttempt;
  if (sameRun !== (origin.artifactId === transport.artifactId)) {
    fail('authorization result hosted artifact transport identity is inconsistent.');
  }
}

/**
 * The only constructor for the complete merge-gate wire input. The Session
 * runtime may supply freshly observed facts, but it cannot emit a parallel
 * summary schema and ask the authorization CLI to infer the missing authority.
 */
export function CodexDevelopmentCreateMergeGateInputV2(
  input: CodexDevelopmentMergeGateInputFieldsV2
): CodexDevelopmentMergeGateInputV2 {
  const candidate = Object.freeze({
    ...input.candidate,
    changedPaths: Object.freeze([...input.candidate.changedPaths])
  });
  assertCandidate(candidate);
  const provenance = assertProvenance(input.provenance, candidate.currentBaseSha);
  CodexDevelopmentAssertVerificationSessionArtifactV2(input.artifact);
  const hostedArtifactOrigin = CodexDevelopmentCreateHostedArtifactObservationV2(input.hostedArtifactOrigin);
  const hostedArtifactTransport = CodexDevelopmentCreateHostedArtifactObservationV2(input.hostedArtifactTransport);
  assertHostedArtifactClosure(
    input.artifact,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    input.candidate.currentBaseSha
  );
  const expectedActionPlan = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(input.expectedActionPlan)
  );
  digest(input.reviewSnapshotDigest, 'reviewSnapshotDigest');
  digest(input.environmentDigest, 'environmentDigest');
  sha(input.trustRevision, 'trustRevision');
  const platformObservation = canonicalPlatformObservation(input.platformObservation);
  digest(input.consumptionOperationId, 'consumptionOperationId');
  const issuedAt = instant(input.issuedAt, 'issuedAt');
  const expiresAt = instant(input.expiresAt, 'expiresAt');
  if (new Date(expiresAt).getTime() <= new Date(issuedAt).getTime()) fail('expiresAt must be after issuedAt.');
  return Object.freeze({
    schema: CodexDevelopmentMergeGateInputSchemaV2,
    provenance,
    candidate,
    artifact: input.artifact,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    expectedActionPlan,
    reviewReceipt: input.reviewReceipt,
    reviewSnapshotDigest: input.reviewSnapshotDigest,
    mainHealth: input.mainHealth,
    environmentDigest: input.environmentDigest,
    trustRevision: input.trustRevision,
    platformObservation,
    consumptionOperationId: input.consumptionOperationId,
    issuedAt,
    expiresAt
  });
}

export function CodexDevelopmentEvaluateMergeGateV2(
  input: CodexDevelopmentMergeGateInputV2
): CodexDevelopmentMergeGateResultV2 {
  const record = exact(input, [
    'schema', 'provenance', 'candidate', 'artifact', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'input');
  if (input.schema !== CodexDevelopmentMergeGateInputSchemaV2) fail('input schema mismatch; scope-attestation V1 is retired.');
  const { schema: _schema, ...fields } = record;
  input = CodexDevelopmentCreateMergeGateInputV2(
    fields as unknown as CodexDevelopmentMergeGateInputFieldsV2
  );
  assertCandidate(input.candidate);
  const provenance = assertProvenance(input.provenance, input.candidate.currentBaseSha);
  const now = instant(input.issuedAt, 'issuedAt');
  instant(input.expiresAt, 'expiresAt');
  const trustRevision = sha(input.trustRevision, 'trustRevision');
  const environmentDigest = digest(input.environmentDigest, 'environmentDigest');
  const platformObservation = canonicalPlatformObservation(input.platformObservation);
  const rulesetDigest = platformObservation.rulesetDigest;
  CodexDevelopmentAssertVerificationSessionArtifactV2(input.artifact);
  const hostedArtifactOrigin = CodexDevelopmentCreateHostedArtifactObservationV2(input.hostedArtifactOrigin);
  const hostedArtifactTransport = CodexDevelopmentCreateHostedArtifactObservationV2(input.hostedArtifactTransport);
  assertHostedArtifactClosure(
    input.artifact,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    input.candidate.currentBaseSha
  );
  const session: VerificationSessionV2 = input.artifact.session;
  const scopeAuthorization: ScopeAuthorizationV1 = input.artifact.scopeAuthorization;
  const evidence = input.artifact.evidence;
  const candidate = input.candidate;
  const identityChecks: readonly [unknown, unknown, string][] = [
    [session.repository, candidate.repository, 'session.repository'], [session.prNumber, candidate.prNumber, 'session.prNumber'],
    [session.baseSha, candidate.currentBaseSha, 'session.baseSha'], [session.baseTreeSha, candidate.currentBaseTreeSha, 'session.baseTreeSha'],
    [session.headSha, candidate.headSha, 'session.headSha'], [session.headTreeSha, candidate.headTreeSha, 'session.headTreeSha'],
    [session.manifestPath, candidate.manifestPath, 'session.manifestPath'], [session.manifestDigest, candidate.manifestDigest, 'session.manifestDigest'],
    [session.sessionProposalDigest, scopeAuthorization.sessionProposalDigest, 'session.sessionProposalDigest'],
    [session.scopeAuthorizationRevision, scopeAuthorization.authorizationRevision, 'session.scopeAuthorizationRevision'],
    [session.scopeAuthorizationReceiptDigest, scopeAuthorization.authorizationDigest, 'session.scopeAuthorizationReceiptDigest'],
    [session.actionPlanClosureDigest, input.expectedActionPlan.actionPlanDigest, 'session.actionPlanClosureDigest'],
    [session.environmentDigest, environmentDigest, 'session.environmentDigest'], [session.trustRevision, trustRevision, 'session.trustRevision'],
    [session.mainHealthRef.healthRevision, input.mainHealth.healthRevision, 'session.mainHealthRef.healthRevision'],
    [session.mainHealthRef.mainSha, candidate.currentBaseSha, 'session.mainHealthRef.mainSha'],
    [session.mainHealthRef.mainTreeSha, candidate.currentBaseTreeSha, 'session.mainHealthRef.mainTreeSha']
  ];
  for (const [actual, expected, label] of identityChecks) if (actual !== expected) fail(`${label} drifted.`);

  assertScopeAuthorizationCurrentV1(scopeAuthorization, {
    baseSha: candidate.currentBaseSha,
    baseTreeSha: candidate.currentBaseTreeSha,
    headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha,
    manifestDigest: candidate.manifestDigest,
    changedPaths: candidate.changedPaths,
    sessionProposalDigest: scopeAuthorization.sessionProposalDigest,
    actionPlanClosureDigest: input.expectedActionPlan.actionPlanDigest,
    environmentDigest,
    expectedAuthorizationRevision: scopeAuthorization.authorizationRevision,
    now
  });
  assertReviewStabilityReceiptCurrentV1(input.reviewReceipt, {
    stage: 'pre-merge',
    sessionRevision: session.sessionRevision,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha,
    expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: digest(input.reviewSnapshotDigest, 'reviewSnapshotDigest'),
    expectedReviewRevision: input.reviewReceipt.reviewRevision,
    now
  });
  const health = resolveMainHealthLaneV1({
    ledger: input.mainHealth,
    lane: 'ordinary',
    now,
    expectedRepository: candidate.repository,
    expectedDefaultBranch: 'main',
    expectedMainSha: candidate.currentBaseSha,
    expectedMainTreeSha: candidate.currentBaseTreeSha,
    expectedTrustRevision: trustRevision
  });
  if (!health.allowed || health.status !== 'healthy') fail(`ordinary lane is locked: ${health.reason}`);
  if (input.mainHealth.producer.identity !== 'platform/shared/default-branch-revision-health.ts' ||
      input.mainHealth.producer.sourceTransport !== 'github-api' ||
      input.mainHealth.producer.trustRevision !== trustRevision ||
      input.mainHealth.producer.sourceRef !== provenance.workflowRef) {
    fail('fresh MainHealth producer provenance is not bound to the trusted merge workflow.');
  }
  CodexDevelopmentAssertVerificationEvidenceV4(evidence, {
    sessionRevision: session.sessionRevision,
    sessionProposalDigest: scopeAuthorization.sessionProposalDigest,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationDigest: scopeAuthorization.authorizationDigest,
    reviewReceiptDigest: input.artifact.preGateReview.receiptDigest,
    mainHealthRevision: input.artifact.mainHealth.healthRevision,
    mainHealthDigest: input.artifact.mainHealth.ledgerDigest,
    trustRevision,
    profile: session.profile as 'quick' | 'full',
    baseSha: candidate.currentBaseSha,
    baseTreeSha: candidate.currentBaseTreeSha,
    headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha,
    manifestPath: candidate.manifestPath,
    manifestDigest: candidate.manifestDigest,
    actionPlan: input.expectedActionPlan
  }, new Date(now));
  if (evidence.status !== 'passed') fail('five-state Evidence is not PASS.');
  if (evidence.producer.sourceTransport !== 'github-actions' ||
      evidence.producer.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      evidence.producer.workflowSha !== candidate.currentBaseSha ||
      evidence.producer.workflowRef !== `.github/workflows/compiler-pr-validation.yml@${candidate.currentBaseSha}`) {
    fail('Evidence artifact was not produced by the trusted current-base verification workflow.');
  }
  const reviewSourceDigestIsCurrent = input.reviewReceipt.producer.sourceTransport === 'github-graphql'
    ? input.reviewReceipt.producer.sourceDigest === input.reviewReceipt.snapshot.snapshotDigest
    : input.reviewReceipt.producer.sourceTransport === 'github-rest'
      ? input.reviewReceipt.snapshot.reviewPageDigests.includes(input.reviewReceipt.producer.sourceDigest)
      : false;
  if (input.reviewReceipt.producer.identity !== 'scripts/codex/verification-session-github.ts' ||
      input.reviewReceipt.producer.sourceRef !==
        `github://${candidate.repository}/pull/${candidate.prNumber}@${candidate.headSha}` ||
      !reviewSourceDigestIsCurrent) {
    fail('Review producer does not bind the independently reread GitHub snapshot.');
  }

  const authorization = createIntegrationAuthorizationV1({
    consumptionOperationId: digest(input.consumptionOperationId, 'consumptionOperationId'),
    repository: candidate.repository,
    prNumber: candidate.prNumber,
    sessionRevision: session.sessionRevision,
    baseSha: candidate.currentBaseSha,
    baseTreeSha: candidate.currentBaseTreeSha,
    headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha,
    manifestDigest: candidate.manifestDigest,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionClosureDigest: input.expectedActionPlan.actionPlanDigest,
    evidenceDigest: digest(evidence.evidenceDigest, 'evidence.evidenceDigest'),
    reviewRevision: input.reviewReceipt.reviewRevision,
    reviewReceiptDigest: input.reviewReceipt.receiptDigest,
    mainHealthRevision: input.mainHealth.healthRevision,
    mainHealthReceiptDigest: input.mainHealth.ledgerDigest,
    trustRevision,
    rulesetDigest,
    issuedAt: now,
    expiresAt: input.expiresAt,
    issuer: {
      principalId: provenance.actorNodeId,
      producerIdentity: CodexDevelopmentMergeGateProducerIdentityV2,
      trustedRevision: trustRevision,
      sourceTransport: 'github-actions',
      sourceRunId: `${provenance.sourceRunId}:${provenance.sourceRunAttempt}`,
      sourceRef: provenance.workflowRef,
      sourceDigest: provenance.sourceDigest
    }
  });
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentMergeGateResultSchemaV2,
    status: 'authorized' as const,
    authorization,
    reviewReceipt: input.reviewReceipt,
    mainHealth: input.mainHealth,
    platformObservation,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    provenance,
    terminalStatusContext: 'sec/merge-gate' as const
  });
  return Object.freeze({ ...withoutDigest, resultDigest: hash(withoutDigest) });
}

export function CodexDevelopmentParseMergeGateResultV2(
  source: string
): CodexDevelopmentMergeGateResultV2 {
  const value = exact(JSON.parse(source), [
    'schema', 'status', 'authorization', 'reviewReceipt', 'mainHealth',
    'platformObservation', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'provenance', 'terminalStatusContext', 'resultDigest'
  ], 'merge-gate result');
  if (value.schema !== CodexDevelopmentMergeGateResultSchemaV2 || value.status !== 'authorized' ||
      value.terminalStatusContext !== 'sec/merge-gate') {
    fail('result identity is invalid.');
  }
  const authorization = parseIntegrationAuthorizationV1(
    encodeVerificationActionDataV2(value.authorization)
  );
  const reviewReceipt = parseReviewStabilityReceiptV1(
    encodeVerificationActionDataV2(value.reviewReceipt)
  );
  const mainHealth = parseMainHealthLedgerV1(
    encodeVerificationActionDataV2(value.mainHealth)
  );
  const platformObservation = canonicalPlatformObservation(
    value.platformObservation as unknown as CodexDevelopmentMergeGatePlatformObservationV2
  );
  const hostedArtifactOrigin = CodexDevelopmentCreateHostedArtifactObservationV2(
    value.hostedArtifactOrigin as unknown as CodexDevelopmentHostedArtifactObservationV2
  );
  const hostedArtifactTransport = CodexDevelopmentCreateHostedArtifactObservationV2(
    value.hostedArtifactTransport as unknown as CodexDevelopmentHostedArtifactObservationV2
  );
  const provenance = assertProvenance(
    value.provenance as unknown as CodexDevelopmentMergeGateProvenanceV2,
    authorization.baseSha
  );
  assertHostedArtifactResultClosure(authorization, hostedArtifactOrigin, hostedArtifactTransport);
  if (authorization.reviewRevision !== reviewReceipt.reviewRevision ||
      authorization.reviewReceiptDigest !== reviewReceipt.receiptDigest ||
      authorization.mainHealthRevision !== mainHealth.healthRevision ||
      authorization.mainHealthReceiptDigest !== mainHealth.ledgerDigest ||
      authorization.rulesetDigest !== platformObservation.rulesetDigest ||
      authorization.issuer.principalId !== provenance.actorNodeId ||
      authorization.issuer.producerIdentity !== CodexDevelopmentMergeGateProducerIdentityV2 ||
      authorization.issuer.trustedRevision !== provenance.workflowSha ||
      authorization.issuer.sourceRunId !== `${provenance.sourceRunId}:${provenance.sourceRunAttempt}` ||
      authorization.issuer.sourceRef !== provenance.workflowRef ||
      authorization.issuer.sourceDigest !== provenance.sourceDigest) {
    fail('authorization artifact receipt or issuer closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentMergeGateResultSchemaV2,
    status: 'authorized' as const,
    authorization,
    reviewReceipt,
    mainHealth,
    platformObservation,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    provenance,
    terminalStatusContext: 'sec/merge-gate' as const
  });
  const resultDigest = digest(value.resultDigest, 'resultDigest');
  if (resultDigest !== hash(withoutDigest)) fail('result digest mismatch.');
  return Object.freeze({ ...withoutDigest, resultDigest });
}

/**
 * Machine trailer closure for a physical squash merge message. The only
 * permitted body lines are the canonical IntegrationAuthorization markers;
 * any `Independent-*` / `Manual-Transition-*` line must be the exact trailer
 * rendered from a validated review receipt (Issue #347 section G). The
 * PR #345 free-text `Independent-Exact-Head-Review: P0=0 P1=0 P2=0` shape is
 * rejected by this validator.
 */
export function assertCanonicalMergeMessageV1(input: {
  authorizationMarkers: readonly string[];
  reviewReceipt: ReviewStabilityReceiptV1;
  expectedTitle: string;
  message: string;
}): void {
  if (!Array.isArray(input.authorizationMarkers) || input.authorizationMarkers.length === 0) {
    fail('merge message validation requires at least one canonical marker.');
  }
  if (typeof input.expectedTitle !== 'string' || input.expectedTitle.length === 0
    || /[\r\n]/u.test(input.expectedTitle)) fail('merge title is not canonical.');
  const markerPrefixes = [
    'Integration-Authorization: ',
    'Integration-Authorization-Receipt: ',
    'Integration-Authorization-Operation: ',
    'Integration-Authorization-Publication: ',
    'Integration-Authorization-Publication-Digest: ',
    'Integration-Authorization-Comment: ',
    'Verification-Session: '
  ] as const;
  if (input.authorizationMarkers.length !== markerPrefixes.length
    || new Set(input.authorizationMarkers).size !== input.authorizationMarkers.length) {
    fail('authorization marker closure must contain each typed marker exactly once.');
  }
  for (const prefix of markerPrefixes) {
    if (input.authorizationMarkers.filter((line) => line.startsWith(prefix)).length !== 1) {
      fail(`authorization marker closure requires exactly one ${prefix.trim()} marker.`);
    }
  }
  for (const line of input.authorizationMarkers) {
    if (/^(?:Independent-|Manual-Transition-)/u.test(line)) {
      fail('unbound merge trailer is forbidden; integration trailers must derive from validated receipts, never model free text.');
    }
  }
  const expected = [
    input.expectedTitle,
    ...input.authorizationMarkers,
    renderIndependentReviewTrailerV1(input.reviewReceipt)
  ];
  const actual = input.message.replaceAll('\r\n', '\n').split('\n').filter((line) => line.length > 0);
  if (actual.length !== expected.length
    || actual.some((line, index) => line !== expected[index])) {
    fail('merge message must equal the exact typed title and trailer multiset once each.');
  }
}

function parseInput(source: string): CodexDevelopmentMergeGateInputV2 {
  const value = exact(JSON.parse(source), [
    'schema', 'provenance', 'candidate', 'artifact', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'input');
  if (value.schema !== CodexDevelopmentMergeGateInputSchemaV2) fail('input schema mismatch.');
  const { schema: _schema, ...fields } = value;
  return CodexDevelopmentCreateMergeGateInputV2(
    fields as unknown as CodexDevelopmentMergeGateInputFieldsV2
  );
}

async function main(): Promise<void> {
  const [command, inputFlag, inputPath, outputFlag, outputPath] = process.argv.slice(2);
  if (command !== 'authorize' || inputFlag !== '--input' || outputFlag !== '--output' || !inputPath || !outputPath) {
    throw new Error('Usage: bun scripts/codex/merge-gate.ts authorize --input <json> --output <json>');
  }
  const result = CodexDevelopmentEvaluateMergeGateV2(parseInput(readFileSync(inputPath, 'utf8')));
  writeFileSync(outputPath, `${encodeVerificationActionDataV2(result)}\n`, 'utf8');
}

if (import.meta.main) await main();
