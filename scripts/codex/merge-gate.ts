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
  canonicalizeIntegrationPlatformObservationV1
} from '../../platform/shared/integration-platform-policy.ts';
import {
  parseMainHealthLedgerV1,
  resolveOrdinaryMainHealthLaneV1,
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
export const CodexDevelopmentTrustedRuntimeMergeGateInputSchemaV1 =
  'sec-trusted-runtime-merge-gate-input-v1' as const;
export const CodexDevelopmentTrustedRuntimeMergeGateResultSchemaV1 =
  'sec-trusted-runtime-merge-gate-result-v1' as const;
export const CodexDevelopmentMergeGateProducerIdentityV2 =
  'scripts/codex/merge-gate.ts' as const;
export const CodexDevelopmentMergeGateTerminalStatusContextV2 =
  'sec/integration-authorization' as const;

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

export interface CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1 {
  readonly runtimePath: typeof CodexDevelopmentMergeGateProducerIdentityV2;
  readonly runtimeRef: string;
  readonly runtimeSha: string;
  readonly executionId: string;
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

export interface CodexDevelopmentTrustedRuntimeArtifactObservationV1 {
  readonly artifactFileName: 'verification-session-artifact.json';
  readonly artifactByteDigest: MergeGateDigestV2;
  readonly artifactByteLength: number;
  readonly runtimeRef: string;
  readonly runtimeSha: string;
  readonly executionId: string;
  readonly producerSourceDigest: MergeGateDigestV2;
  readonly readbackTransport: 'trusted-runtime-durable-file';
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

export interface CodexDevelopmentTrustedRuntimeMergeGateInputV1 {
  readonly schema: typeof CodexDevelopmentTrustedRuntimeMergeGateInputSchemaV1;
  readonly provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1;
  readonly candidate: CodexDevelopmentMergeGateCandidateV2;
  readonly artifact: CodexDevelopmentVerificationSessionArtifactV2;
  readonly artifactObservation: CodexDevelopmentTrustedRuntimeArtifactObservationV1;
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

export type CodexDevelopmentTrustedRuntimeMergeGateInputFieldsV1 = Omit<
  CodexDevelopmentTrustedRuntimeMergeGateInputV1,
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
  readonly terminalStatusContext: typeof CodexDevelopmentMergeGateTerminalStatusContextV2;
  readonly resultDigest: MergeGateDigestV2;
}

export interface CodexDevelopmentTrustedRuntimeMergeGateResultV1 {
  readonly schema: typeof CodexDevelopmentTrustedRuntimeMergeGateResultSchemaV1;
  readonly status: 'authorized';
  readonly authorization: IntegrationAuthorizationV1;
  readonly reviewReceipt: ReviewStabilityReceiptV1;
  readonly mainHealth: MainHealthLedgerV1;
  readonly platformObservation: CodexDevelopmentMergeGatePlatformObservationV2;
  readonly artifactObservation: CodexDevelopmentTrustedRuntimeArtifactObservationV1;
  readonly provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1;
  readonly terminalStatusContext: typeof CodexDevelopmentMergeGateTerminalStatusContextV2;
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

export function createTrustedRuntimeMergeGateProvenanceV1(input: Omit<
  CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1,
  'sourceDigest'
>): CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1 {
  if (input.runtimePath !== CodexDevelopmentMergeGateProducerIdentityV2) {
    fail('trusted runtime path is not the canonical merge-gate entrypoint.');
  }
  const runtimeSha = sha(input.runtimeSha, 'trustedRuntimeProvenance.runtimeSha');
  const expectedRef = `${CodexDevelopmentMergeGateProducerIdentityV2}@${runtimeSha}`;
  if (input.runtimeRef !== expectedRef) fail('trusted runtime ref must bind the exact merge-gate revision.');
  if (input.actorPermission !== 'maintain' && input.actorPermission !== 'admin') {
    fail('trusted runtime actor permission is insufficient.');
  }
  const withoutDigest = Object.freeze({
    runtimePath: input.runtimePath,
    runtimeRef: input.runtimeRef,
    runtimeSha,
    executionId: text(input.executionId, 'trustedRuntimeProvenance.executionId'),
    actorNodeId: text(input.actorNodeId, 'trustedRuntimeProvenance.actorNodeId'),
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

function assertTrustedRuntimeProvenance(
  provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1,
  currentBase: string
): CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1 {
  const parsed = exact(provenance, [
    'runtimePath', 'runtimeRef', 'runtimeSha', 'executionId', 'actorNodeId', 'actorPermission', 'sourceDigest'
  ], 'trustedRuntimeProvenance');
  const rebuilt = createTrustedRuntimeMergeGateProvenanceV1(
    parsed as unknown as Omit<CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1, 'sourceDigest'>
  );
  if (rebuilt.sourceDigest !== parsed.sourceDigest) fail('trusted runtime provenance source digest mismatch.');
  if (rebuilt.runtimeSha !== currentBase) {
    fail('candidate runtime cannot issue authorization; trusted runtime SHA must equal live trusted base.');
  }
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
  try {
    return canonicalizeIntegrationPlatformObservationV1(value);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
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

export function createTrustedRuntimeArtifactObservationV1(
  value: CodexDevelopmentTrustedRuntimeArtifactObservationV1
): CodexDevelopmentTrustedRuntimeArtifactObservationV1 {
  exact(value, [
    'artifactFileName', 'artifactByteDigest', 'artifactByteLength', 'runtimeRef', 'runtimeSha',
    'executionId', 'producerSourceDigest', 'readbackTransport'
  ], 'trustedRuntimeArtifactObservation');
  if (value.artifactFileName !== 'verification-session-artifact.json') {
    fail('trusted runtime artifact file name is not canonical.');
  }
  if (!Number.isSafeInteger(value.artifactByteLength) || value.artifactByteLength < 1) {
    fail('trusted runtime artifact byte length is invalid.');
  }
  const runtimeSha = sha(value.runtimeSha, 'trustedRuntimeArtifactObservation.runtimeSha');
  if (value.runtimeRef !== `${CodexDevelopmentMergeGateProducerIdentityV2}@${runtimeSha}`) {
    fail('trusted runtime artifact ref is not exact.');
  }
  if (value.readbackTransport !== 'trusted-runtime-durable-file') {
    fail('trusted runtime artifact readback transport is not canonical.');
  }
  return Object.freeze({
    artifactFileName: value.artifactFileName,
    artifactByteDigest: digest(value.artifactByteDigest, 'trustedRuntimeArtifactObservation.artifactByteDigest'),
    artifactByteLength: value.artifactByteLength,
    runtimeRef: value.runtimeRef,
    runtimeSha,
    executionId: text(value.executionId, 'trustedRuntimeArtifactObservation.executionId'),
    producerSourceDigest: digest(value.producerSourceDigest, 'trustedRuntimeArtifactObservation.producerSourceDigest'),
    readbackTransport: value.readbackTransport
  });
}

function expectedHostedArtifactName(
  prNumber: number,
  sessionRevision: string,
  observation: CodexDevelopmentHostedArtifactObservationV2
): string {
  return `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-pr-${prNumber}-session-${sessionRevision.slice('sha256:'.length)}-run-${observation.runId}-attempt-${observation.runAttempt}`;
}

function canonicalArtifactBytes(artifact: CodexDevelopmentVerificationSessionArtifactV2): Readonly<{
  bytes: string;
  digest: MergeGateDigestV2;
  length: number;
}> {
  const bytes = `${encodeVerificationActionDataV2(artifact)}\n`;
  return Object.freeze({
    bytes,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    length: Buffer.byteLength(bytes, 'utf8')
  });
}

function assertHostedArtifactClosure(
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  origin: CodexDevelopmentHostedArtifactObservationV2,
  transport: CodexDevelopmentHostedArtifactObservationV2,
  currentBaseSha: string
): void {
  const canonical = canonicalArtifactBytes(artifact);
  for (const [label, observation] of [['origin', origin], ['transport', transport]] as const) {
    if (observation.workflowSha !== currentBaseSha ||
        observation.artifactName !== expectedHostedArtifactName(artifact.session.prNumber, artifact.session.sessionRevision, observation) ||
        observation.artifactByteDigest !== canonical.digest ||
        observation.artifactByteLength !== canonical.length) {
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

function assertTrustedRuntimeArtifactClosure(
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  observation: CodexDevelopmentTrustedRuntimeArtifactObservationV1,
  provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1,
  currentBaseSha: string
): void {
  const canonical = canonicalArtifactBytes(artifact);
  if (observation.artifactByteDigest !== canonical.digest || observation.artifactByteLength !== canonical.length) {
    fail('trusted runtime artifact observation does not bind the exact canonical artifact bytes.');
  }
  if (observation.runtimeSha !== currentBaseSha || observation.runtimeSha !== provenance.runtimeSha ||
      observation.runtimeRef !== provenance.runtimeRef || observation.executionId !== provenance.executionId) {
    fail('trusted runtime artifact observation is not bound to the exact trusted runtime execution.');
  }
  const producer = artifact.producer;
  if (producer.sourceTransport !== 'local-dev-runner' ||
      producer.workflowPath !== 'scripts/ci-verification.ts' ||
      producer.workflowSha !== currentBaseSha ||
      producer.workflowRef !== `scripts/ci-verification.ts@${currentBaseSha}` ||
      producer.runId !== provenance.executionId ||
      producer.actorNodeId !== provenance.actorNodeId ||
      producer.sourceDigest !== observation.producerSourceDigest) {
    fail('trusted runtime artifact does not bind a trusted-base local verifier producer receipt.');
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

function assertTrustedRuntimeArtifactResultClosure(
  authorization: IntegrationAuthorizationV1,
  observation: CodexDevelopmentTrustedRuntimeArtifactObservationV1,
  provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1
): void {
  if (observation.runtimeSha !== authorization.baseSha || observation.runtimeSha !== provenance.runtimeSha ||
      observation.runtimeRef !== provenance.runtimeRef || observation.executionId !== provenance.executionId) {
    fail('authorization result trusted runtime artifact observation is not exact.');
  }
}

/**
 * The only constructor for the complete GitHub-Actions merge-gate wire input.
 * The Session runtime may supply freshly observed facts, but it cannot emit a
 * parallel summary schema and ask the authorization CLI to infer missing authority.
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

export function CodexDevelopmentCreateTrustedRuntimeMergeGateInputV1(
  input: CodexDevelopmentTrustedRuntimeMergeGateInputFieldsV1
): CodexDevelopmentTrustedRuntimeMergeGateInputV1 {
  const candidate = Object.freeze({
    ...input.candidate,
    changedPaths: Object.freeze([...input.candidate.changedPaths])
  });
  assertCandidate(candidate);
  const provenance = assertTrustedRuntimeProvenance(input.provenance, candidate.currentBaseSha);
  CodexDevelopmentAssertVerificationSessionArtifactV2(input.artifact);
  const artifactObservation = createTrustedRuntimeArtifactObservationV1(input.artifactObservation);
  assertTrustedRuntimeArtifactClosure(input.artifact, artifactObservation, provenance, candidate.currentBaseSha);
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
    schema: CodexDevelopmentTrustedRuntimeMergeGateInputSchemaV1,
    provenance,
    candidate,
    artifact: input.artifact,
    artifactObservation,
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

type MergeGateIssuerInputV1 = Readonly<{
  principalId: string;
  trustedRevision: string;
  sourceTransport: 'github-actions' | 'trusted-integration-runtime';
  sourceRunId: string;
  sourceRef: string;
  sourceDigest: MergeGateDigestV2;
}>;

type MergeGateCoreInputV1 = Readonly<{
  candidate: CodexDevelopmentMergeGateCandidateV2;
  artifact: CodexDevelopmentVerificationSessionArtifactV2;
  expectedActionPlan: CiVerificationActionPlanClosureV1;
  reviewReceipt: ReviewStabilityReceiptV1;
  reviewSnapshotDigest: MergeGateDigestV2;
  mainHealth: MainHealthLedgerV1;
  environmentDigest: MergeGateDigestV2;
  trustRevision: string;
  platformObservation: CodexDevelopmentMergeGatePlatformObservationV2;
  consumptionOperationId: MergeGateDigestV2;
  issuedAt: string;
  expiresAt: string;
  trustedSourceRef: string;
  issuer: MergeGateIssuerInputV1;
}>;

type MergeGateCoreResultV1 = Readonly<{
  authorization: IntegrationAuthorizationV1;
  reviewReceipt: ReviewStabilityReceiptV1;
  mainHealth: MainHealthLedgerV1;
  platformObservation: CodexDevelopmentMergeGatePlatformObservationV2;
}>;

/**
 * Single semantic integration-authorization reducer. Provider adapters must
 * authenticate their own transport/provenance before calling this function;
 * all candidate/scope/review/MainHealth/Evidence/platform invariants live here
 * once and are shared by Actions and independent trusted runtimes.
 */
function evaluateMergeGateCoreV1(input: MergeGateCoreInputV1): MergeGateCoreResultV1 {
  assertCandidate(input.candidate);
  const now = instant(input.issuedAt, 'issuedAt');
  instant(input.expiresAt, 'expiresAt');
  const trustRevision = sha(input.trustRevision, 'trustRevision');
  const environmentDigest = digest(input.environmentDigest, 'environmentDigest');
  const platformObservation = canonicalPlatformObservation(input.platformObservation);
  const rulesetDigest = platformObservation.rulesetDigest;
  CodexDevelopmentAssertVerificationSessionArtifactV2(input.artifact);
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
  const health = resolveOrdinaryMainHealthLaneV1({
    ledger: input.mainHealth,
    now,
    expectedRepository: candidate.repository,
    expectedDefaultBranch: 'main',
    expectedMainSha: candidate.currentBaseSha,
    expectedMainTreeSha: candidate.currentBaseTreeSha,
    expectedTrustRevision: trustRevision
  });
  if (!health.allowed || health.status !== 'healthy') fail(`ordinary lane is locked: ${health.reason}`);
  const mainHealthTransportAccepted = input.mainHealth.producer.sourceTransport === 'github-api'
    || input.issuer.sourceTransport === 'trusted-integration-runtime'
      && input.mainHealth.producer.sourceTransport === 'trusted-local-readback';
  if (input.mainHealth.producer.identity !== 'platform/shared/default-branch-revision-health.ts' ||
      !mainHealthTransportAccepted ||
      input.mainHealth.producer.trustRevision !== trustRevision ||
      input.mainHealth.producer.sourceRef !== input.trustedSourceRef) {
    fail('fresh MainHealth producer provenance is not bound to the trusted authorization runtime.');
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
      principalId: input.issuer.principalId,
      producerIdentity: CodexDevelopmentMergeGateProducerIdentityV2,
      trustedRevision: input.issuer.trustedRevision,
      sourceTransport: input.issuer.sourceTransport,
      sourceRunId: input.issuer.sourceRunId,
      sourceRef: input.issuer.sourceRef,
      sourceDigest: input.issuer.sourceDigest
    }
  });
  return Object.freeze({
    authorization,
    reviewReceipt: input.reviewReceipt,
    mainHealth: input.mainHealth,
    platformObservation
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
  const provenance = assertProvenance(input.provenance, input.candidate.currentBaseSha);
  const hostedArtifactOrigin = CodexDevelopmentCreateHostedArtifactObservationV2(input.hostedArtifactOrigin);
  const hostedArtifactTransport = CodexDevelopmentCreateHostedArtifactObservationV2(input.hostedArtifactTransport);
  assertHostedArtifactClosure(
    input.artifact,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    input.candidate.currentBaseSha
  );
  const evidence = input.artifact.evidence;
  if (evidence.producer.sourceTransport !== 'github-actions' ||
      evidence.producer.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      evidence.producer.workflowSha !== input.candidate.currentBaseSha ||
      evidence.producer.workflowRef !== `.github/workflows/compiler-pr-validation.yml@${input.candidate.currentBaseSha}`) {
    fail('Evidence artifact was not produced by the trusted current-base verification workflow.');
  }
  const core = evaluateMergeGateCoreV1({
    candidate: input.candidate,
    artifact: input.artifact,
    expectedActionPlan: input.expectedActionPlan,
    reviewReceipt: input.reviewReceipt,
    reviewSnapshotDigest: input.reviewSnapshotDigest,
    mainHealth: input.mainHealth,
    environmentDigest: input.environmentDigest,
    trustRevision: input.trustRevision,
    platformObservation: input.platformObservation,
    consumptionOperationId: input.consumptionOperationId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    trustedSourceRef: provenance.workflowRef,
    issuer: {
      principalId: provenance.actorNodeId,
      trustedRevision: provenance.workflowSha,
      sourceTransport: 'github-actions',
      sourceRunId: `${provenance.sourceRunId}:${provenance.sourceRunAttempt}`,
      sourceRef: provenance.workflowRef,
      sourceDigest: provenance.sourceDigest
    }
  });
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentMergeGateResultSchemaV2,
    status: 'authorized' as const,
    authorization: core.authorization,
    reviewReceipt: core.reviewReceipt,
    mainHealth: core.mainHealth,
    platformObservation: core.platformObservation,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    provenance,
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContextV2
  });
  return Object.freeze({ ...withoutDigest, resultDigest: hash(withoutDigest) });
}

export function CodexDevelopmentEvaluateTrustedRuntimeMergeGateV1(
  input: CodexDevelopmentTrustedRuntimeMergeGateInputV1
): CodexDevelopmentTrustedRuntimeMergeGateResultV1 {
  const record = exact(input, [
    'schema', 'provenance', 'candidate', 'artifact', 'artifactObservation', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'trustedRuntimeInput');
  if (input.schema !== CodexDevelopmentTrustedRuntimeMergeGateInputSchemaV1) {
    fail('trusted runtime input schema mismatch.');
  }
  const { schema: _schema, ...fields } = record;
  input = CodexDevelopmentCreateTrustedRuntimeMergeGateInputV1(
    fields as unknown as CodexDevelopmentTrustedRuntimeMergeGateInputFieldsV1
  );
  const provenance = assertTrustedRuntimeProvenance(input.provenance, input.candidate.currentBaseSha);
  const artifactObservation = createTrustedRuntimeArtifactObservationV1(input.artifactObservation);
  assertTrustedRuntimeArtifactClosure(
    input.artifact,
    artifactObservation,
    provenance,
    input.candidate.currentBaseSha
  );
  const core = evaluateMergeGateCoreV1({
    candidate: input.candidate,
    artifact: input.artifact,
    expectedActionPlan: input.expectedActionPlan,
    reviewReceipt: input.reviewReceipt,
    reviewSnapshotDigest: input.reviewSnapshotDigest,
    mainHealth: input.mainHealth,
    environmentDigest: input.environmentDigest,
    trustRevision: input.trustRevision,
    platformObservation: input.platformObservation,
    consumptionOperationId: input.consumptionOperationId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    trustedSourceRef: provenance.runtimeRef,
    issuer: {
      principalId: provenance.actorNodeId,
      trustedRevision: provenance.runtimeSha,
      sourceTransport: 'trusted-integration-runtime',
      sourceRunId: provenance.executionId,
      sourceRef: provenance.runtimeRef,
      sourceDigest: provenance.sourceDigest
    }
  });
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentTrustedRuntimeMergeGateResultSchemaV1,
    status: 'authorized' as const,
    authorization: core.authorization,
    reviewReceipt: core.reviewReceipt,
    mainHealth: core.mainHealth,
    platformObservation: core.platformObservation,
    artifactObservation,
    provenance,
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContextV2
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
      value.terminalStatusContext !== CodexDevelopmentMergeGateTerminalStatusContextV2) {
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
      authorization.issuer.sourceTransport !== 'github-actions' ||
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
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContextV2
  });
  const resultDigest = digest(value.resultDigest, 'resultDigest');
  if (resultDigest !== hash(withoutDigest)) fail('result digest mismatch.');
  return Object.freeze({ ...withoutDigest, resultDigest });
}

export function CodexDevelopmentParseTrustedRuntimeMergeGateResultV1(
  source: string
): CodexDevelopmentTrustedRuntimeMergeGateResultV1 {
  const value = exact(JSON.parse(source), [
    'schema', 'status', 'authorization', 'reviewReceipt', 'mainHealth',
    'platformObservation', 'artifactObservation', 'provenance', 'terminalStatusContext', 'resultDigest'
  ], 'trusted runtime merge-gate result');
  if (value.schema !== CodexDevelopmentTrustedRuntimeMergeGateResultSchemaV1 || value.status !== 'authorized' ||
      value.terminalStatusContext !== CodexDevelopmentMergeGateTerminalStatusContextV2) {
    fail('trusted runtime result identity is invalid.');
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
  const artifactObservation = createTrustedRuntimeArtifactObservationV1(
    value.artifactObservation as unknown as CodexDevelopmentTrustedRuntimeArtifactObservationV1
  );
  const provenance = assertTrustedRuntimeProvenance(
    value.provenance as unknown as CodexDevelopmentTrustedRuntimeMergeGateProvenanceV1,
    authorization.baseSha
  );
  assertTrustedRuntimeArtifactResultClosure(authorization, artifactObservation, provenance);
  if (authorization.reviewRevision !== reviewReceipt.reviewRevision ||
      authorization.reviewReceiptDigest !== reviewReceipt.receiptDigest ||
      authorization.mainHealthRevision !== mainHealth.healthRevision ||
      authorization.mainHealthReceiptDigest !== mainHealth.ledgerDigest ||
      authorization.rulesetDigest !== platformObservation.rulesetDigest ||
      authorization.issuer.principalId !== provenance.actorNodeId ||
      authorization.issuer.producerIdentity !== CodexDevelopmentMergeGateProducerIdentityV2 ||
      authorization.issuer.trustedRevision !== provenance.runtimeSha ||
      authorization.issuer.sourceTransport !== 'trusted-integration-runtime' ||
      authorization.issuer.sourceRunId !== provenance.executionId ||
      authorization.issuer.sourceRef !== provenance.runtimeRef ||
      authorization.issuer.sourceDigest !== provenance.sourceDigest) {
    fail('trusted runtime authorization artifact receipt or issuer closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentTrustedRuntimeMergeGateResultSchemaV1,
    status: 'authorized' as const,
    authorization,
    reviewReceipt,
    mainHealth,
    platformObservation,
    artifactObservation,
    provenance,
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContextV2
  });
  const resultDigest = digest(value.resultDigest, 'resultDigest');
  if (resultDigest !== hash(withoutDigest)) fail('trusted runtime result digest mismatch.');
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
  const publicationMarkerPrefixes = [
    'Integration-Authorization: ',
    'Integration-Authorization-Receipt: ',
    'Integration-Authorization-Operation: ',
    'Integration-Authorization-Publication: ',
    'Integration-Authorization-Publication-Digest: ',
    'Integration-Authorization-Comment: ',
    'Verification-Session: '
  ] as const;
  const statusMarkerPrefixes = [
    'Verification-Session: ',
    'Integration-Authorization: ',
    'Integration-Authorization-Receipt: ',
    'Integration-Authorization-Operation: ',
    'Integration-Authorization-Status-Publication: ',
    'Integration-Authorization-Status-Id: ',
    'Merge-Gate-Result: ',
    'Platform-Observation: ',
    'Platform-Enforcement: ',
    'Platform-No-Bypass-Claim: '
  ] as const;
  const issueMarkerPrefixes = [
    'Issue-Disposition-Plan: ',
    'Issue-Disposition-Mode: ',
    'Issue-Disposition-Tracking: ',
    'Issue-Disposition-Prose: '
  ] as const;
  const issueMarkers = input.authorizationMarkers.filter((line) =>
    issueMarkerPrefixes.some((prefix) => line.startsWith(prefix)));
  const authorizationMarkers = input.authorizationMarkers.filter((line) =>
    !issueMarkerPrefixes.some((prefix) => line.startsWith(prefix)));
  const matchesClosure = (prefixes: readonly string[]): boolean =>
    authorizationMarkers.length === prefixes.length
    && prefixes.every((prefix) =>
      authorizationMarkers.filter((line) => line.startsWith(prefix)).length === 1);
  const markerPrefixes = matchesClosure(publicationMarkerPrefixes)
    ? publicationMarkerPrefixes
    : matchesClosure(statusMarkerPrefixes)
      ? statusMarkerPrefixes
      : null;
  if (markerPrefixes === null
    || (issueMarkers.length !== 0
      && (issueMarkers.length !== issueMarkerPrefixes.length
        || !issueMarkerPrefixes.every((prefix) =>
          issueMarkers.filter((line) => line.startsWith(prefix)).length === 1)))
    || new Set(input.authorizationMarkers).size !== input.authorizationMarkers.length) {
    fail('authorization marker closure must contain each typed marker exactly once.');
  }
  if (markerPrefixes === statusMarkerPrefixes) {
    const noBypass = authorizationMarkers.find((line) =>
      line.startsWith('Platform-No-Bypass-Claim: '));
    const enforcement = authorizationMarkers.find((line) =>
      line.startsWith('Platform-Enforcement: '));
    if (noBypass !== 'Platform-No-Bypass-Claim: false'
      || (enforcement !== 'Platform-Enforcement: available'
        && enforcement !== 'Platform-Enforcement: platform-enforcement-unavailable')) {
      fail('status-backed platform claim markers are invalid.');
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

function parseTrustedRuntimeInput(source: string): CodexDevelopmentTrustedRuntimeMergeGateInputV1 {
  const value = exact(JSON.parse(source), [
    'schema', 'provenance', 'candidate', 'artifact', 'artifactObservation', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'trustedRuntimeInput');
  if (value.schema !== CodexDevelopmentTrustedRuntimeMergeGateInputSchemaV1) {
    fail('trusted runtime input schema mismatch.');
  }
  const { schema: _schema, ...fields } = value;
  return CodexDevelopmentCreateTrustedRuntimeMergeGateInputV1(
    fields as unknown as CodexDevelopmentTrustedRuntimeMergeGateInputFieldsV1
  );
}

async function main(): Promise<void> {
  const [command, inputFlag, inputPath, outputFlag, outputPath] = process.argv.slice(2);
  if ((command !== 'authorize' && command !== 'authorize-trusted-runtime') ||
      inputFlag !== '--input' || outputFlag !== '--output' || !inputPath || !outputPath) {
    throw new Error(
      'Usage: bun scripts/codex/merge-gate.ts authorize|authorize-trusted-runtime --input <json> --output <json>'
    );
  }
  const source = readFileSync(inputPath, 'utf8');
  const result = command === 'authorize'
    ? CodexDevelopmentEvaluateMergeGateV2(parseInput(source))
    : CodexDevelopmentEvaluateTrustedRuntimeMergeGateV1(parseTrustedRuntimeInput(source));
  writeFileSync(outputPath, `${encodeVerificationActionDataV2(result)}\n`, 'utf8');
}

if (import.meta.main) await main();
