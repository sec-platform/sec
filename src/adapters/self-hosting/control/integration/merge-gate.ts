import { readFileSync, writeFileSync } from 'node:fs';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { CI_VERIFICATION_WORKFLOW_PATH } from '../../../../assurance/verification/contract/revision.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { parseCiVerificationActionPlanClosure, type CiVerificationActionPlanClosure } from '../../../verification/platform/action/contract/ci.ts';
import { assertVerificationEvidence, assertVerificationSessionArtifact, type VerificationSessionArtifact } from '../../../verification/platform/ci/contract/evidence.ts';
import { CI_VERIFICATION_SESSION_ARTIFACT_PREFIX } from '../../../verification/platform/ci/contract/revision.ts';
import { assertReviewStabilityReceiptCurrent, parseReviewStabilityReceipt, renderIndependentReviewTrailer, REVIEW_OBSERVER_PRODUCER_IDENTITY, type ReviewStabilityReceipt } from '../../../verification/platform/review/contract/stability.ts';
import type { VerificationSession } from '../../../verification/platform/session/contract/session.ts';
import {
  DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY,
  parseMainHealthLedger,
  resolveOrdinaryMainHealthLane,
  type MainHealthLedger
} from '../main-health/contract.ts';
import { INTEGRATION_AUTHORIZATION_STATUS_CONTEXT } from '../main-health/github-status-namespace.ts';
import {
  assertScopeAuthorizationCurrent,
  type ScopeAuthorization
} from '../scope/authorization.ts';
import {
  createIntegrationAuthorization,
  parseIntegrationAuthorization,
  type IntegrationAuthorization
} from './authorization.ts';
import {
  canonicalizeIntegrationPlatformObservation
} from './platform-policy.ts';

export const MergeGateInputSchema =
  'codex-development-merge-gate-input-v2' as const;
export const MergeGateResultSchema =
  'codex-development-merge-gate-result-v2' as const;
const TrustedRuntimeMergeGateInputSchema =
  'sec-trusted-runtime-merge-gate-input-v1' as const;
export const TrustedRuntimeMergeGateResultSchema =
  'sec-trusted-runtime-merge-gate-result-v1' as const;
export const MergeGateProducerIdentity =
  'src/adapters/self-hosting/control/integration/merge-gate.ts' as const;
export const MergeGateTerminalStatusContext =
  INTEGRATION_AUTHORIZATION_STATUS_CONTEXT;

type MergeGateDigest = `sha256:${string}`;

export interface MergeGateProvenance {
  readonly workflowPath: '.github/workflows/merge-gate.yml';
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly eventName: 'workflow_run';
  readonly sourceRunId: string;
  readonly sourceRunAttempt: number;
  readonly actorNodeId: string;
  readonly actorPermission: 'maintain' | 'admin';
  readonly sourceDigest: MergeGateDigest;
}

export interface TrustedRuntimeMergeGateProvenance {
  readonly runtimePath: typeof MergeGateProducerIdentity;
  readonly runtimeRef: string;
  readonly runtimeSha: string;
  readonly executionId: string;
  readonly actorNodeId: string;
  readonly actorPermission: 'maintain' | 'admin';
  readonly sourceDigest: MergeGateDigest;
}

export interface MergeGateCandidate {
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
  readonly manifestDigest: MergeGateDigest;
  readonly changedPaths: readonly string[];
}

interface MergeGatePlatformObservation {
  readonly status: 'available' | 'platform-enforcement-unavailable';
  readonly rulesetDigest: MergeGateDigest;
  readonly reason: string | null;
}

export interface HostedArtifactObservation {
  readonly artifactId: string;
  readonly artifactName: string;
  readonly artifactFileName: 'verification-session-artifact.json';
  readonly artifactByteDigest: MergeGateDigest;
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

export interface TrustedRuntimeArtifactObservation {
  readonly artifactFileName: 'verification-session-artifact.json';
  readonly artifactByteDigest: MergeGateDigest;
  readonly artifactByteLength: number;
  readonly runtimeRef: string;
  readonly runtimeSha: string;
  readonly executionId: string;
  readonly producerSourceDigest: MergeGateDigest;
  readonly readbackTransport: 'trusted-runtime-durable-file';
}

export interface MergeGateInput {
  readonly schema: typeof MergeGateInputSchema;
  readonly provenance: MergeGateProvenance;
  readonly candidate: MergeGateCandidate;
  readonly artifact: VerificationSessionArtifact;
  readonly hostedArtifactOrigin: HostedArtifactObservation;
  readonly hostedArtifactTransport: HostedArtifactObservation;
  readonly expectedActionPlan: CiVerificationActionPlanClosure;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly reviewSnapshotDigest: MergeGateDigest;
  readonly mainHealth: MainHealthLedger;
  readonly environmentDigest: MergeGateDigest;
  readonly trustRevision: string;
  readonly platformObservation: MergeGatePlatformObservation;
  readonly consumptionOperationId: MergeGateDigest;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type MergeGateInputFields = Omit<
  MergeGateInput,
  'schema'
>;

export interface TrustedRuntimeMergeGateInput {
  readonly schema: typeof TrustedRuntimeMergeGateInputSchema;
  readonly provenance: TrustedRuntimeMergeGateProvenance;
  readonly candidate: MergeGateCandidate;
  readonly artifact: VerificationSessionArtifact;
  readonly artifactObservation: TrustedRuntimeArtifactObservation;
  readonly expectedActionPlan: CiVerificationActionPlanClosure;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly reviewSnapshotDigest: MergeGateDigest;
  readonly mainHealth: MainHealthLedger;
  readonly environmentDigest: MergeGateDigest;
  readonly trustRevision: string;
  readonly platformObservation: MergeGatePlatformObservation;
  readonly consumptionOperationId: MergeGateDigest;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type TrustedRuntimeMergeGateInputFields = Omit<
  TrustedRuntimeMergeGateInput,
  'schema'
>;

export interface MergeGateResult {
  readonly schema: typeof MergeGateResultSchema;
  readonly status: 'authorized';
  readonly authorization: IntegrationAuthorization;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly mainHealth: MainHealthLedger;
  readonly platformObservation: MergeGatePlatformObservation;
  readonly hostedArtifactOrigin: HostedArtifactObservation;
  readonly hostedArtifactTransport: HostedArtifactObservation;
  readonly provenance: MergeGateProvenance;
  readonly terminalStatusContext: typeof MergeGateTerminalStatusContext;
  readonly resultDigest: MergeGateDigest;
}

export interface TrustedRuntimeMergeGateResult {
  readonly schema: typeof TrustedRuntimeMergeGateResultSchema;
  readonly status: 'authorized';
  readonly authorization: IntegrationAuthorization;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly mainHealth: MainHealthLedger;
  readonly platformObservation: MergeGatePlatformObservation;
  readonly artifactObservation: TrustedRuntimeArtifactObservation;
  readonly provenance: TrustedRuntimeMergeGateProvenance;
  readonly terminalStatusContext: typeof MergeGateTerminalStatusContext;
  readonly resultDigest: MergeGateDigest;
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
function digest(value: unknown, label: string): MergeGateDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) fail(`${label} must be a SHA-256 digest.`);
  return value as MergeGateDigest;
}
function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO timestamp.`);
  return result;
}
function hash(value: unknown): MergeGateDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
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

export function createMergeGateProvenance(input: Omit<
  MergeGateProvenance,
  'sourceDigest'
>): MergeGateProvenance {
  if (input.workflowPath !== '.github/workflows/merge-gate.yml') fail('workflowPath is not canonical.');
  const workflowSha = sha(input.workflowSha, 'provenance.workflowSha');
  const expectedRef = `.github/workflows/merge-gate.yml@${workflowSha}`;
  if (input.workflowRef !== expectedRef) fail('workflowRef must bind the exact trusted workflow blob revision.');
  if (input.eventName !== 'workflow_run') {
    fail('authorization can only originate from the completed compiler workflow wakeup.');
  }
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

export function createTrustedRuntimeMergeGateProvenance(input: Omit<
  TrustedRuntimeMergeGateProvenance,
  'sourceDigest'
>): TrustedRuntimeMergeGateProvenance {
  if (input.runtimePath !== MergeGateProducerIdentity) {
    fail('trusted runtime path is not the canonical merge-gate entrypoint.');
  }
  const runtimeSha = sha(input.runtimeSha, 'trustedRuntimeProvenance.runtimeSha');
  const expectedRef = `${MergeGateProducerIdentity}@${runtimeSha}`;
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
  provenance: MergeGateProvenance,
  currentBase: string
): MergeGateProvenance {
  const parsed = exact(provenance, [
    'workflowPath', 'workflowRef', 'workflowSha', 'eventName', 'sourceRunId', 'sourceRunAttempt',
    'actorNodeId', 'actorPermission', 'sourceDigest'
  ], 'provenance');
  const rebuilt = createMergeGateProvenance(parsed as unknown as Omit<MergeGateProvenance, 'sourceDigest'>);
  if (rebuilt.sourceDigest !== parsed.sourceDigest) fail('provenance source digest mismatch.');
  if (rebuilt.workflowSha !== currentBase) fail('candidate/runtime workflow cannot issue authorization; workflow SHA must equal live trusted base.');
  return rebuilt;
}

function assertTrustedRuntimeProvenance(
  provenance: TrustedRuntimeMergeGateProvenance,
  currentBase: string
): TrustedRuntimeMergeGateProvenance {
  const parsed = exact(provenance, [
    'runtimePath', 'runtimeRef', 'runtimeSha', 'executionId', 'actorNodeId', 'actorPermission', 'sourceDigest'
  ], 'trustedRuntimeProvenance');
  const rebuilt = createTrustedRuntimeMergeGateProvenance(
    parsed as unknown as Omit<TrustedRuntimeMergeGateProvenance, 'sourceDigest'>
  );
  if (rebuilt.sourceDigest !== parsed.sourceDigest) fail('trusted runtime provenance source digest mismatch.');
  if (rebuilt.runtimeSha !== currentBase) {
    fail('candidate runtime cannot issue authorization; trusted runtime SHA must equal live trusted base.');
  }
  return rebuilt;
}

function assertCandidate(candidate: MergeGateCandidate): void {
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
  value: MergeGatePlatformObservation
): MergeGatePlatformObservation {
  try {
    return canonicalizeIntegrationPlatformObservation(value);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export function CreateHostedArtifactObservation(
  value: HostedArtifactObservation
): HostedArtifactObservation {
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

export function createTrustedRuntimeArtifactObservation(
  value: TrustedRuntimeArtifactObservation
): TrustedRuntimeArtifactObservation {
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
  if (value.runtimeRef !== `${MergeGateProducerIdentity}@${runtimeSha}`) {
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
  observation: HostedArtifactObservation
): string {
  return `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-pr-${prNumber}-session-${sessionRevision.slice('sha256:'.length)}-run-${observation.runId}-attempt-${observation.runAttempt}`;
}

function canonicalArtifactBytes(artifact: VerificationSessionArtifact): Readonly<{
  bytes: string;
  digest: MergeGateDigest;
  length: number;
}> {
  const bytes = `${encodeVerificationActionData(artifact)}\n`;
  return Object.freeze({
    bytes,
    digest: `sha256:${rawSha256Hex(bytes)}`,
    length: Buffer.byteLength(bytes, 'utf8')
  });
}

function assertHostedArtifactClosure(
  artifact: VerificationSessionArtifact,
  origin: HostedArtifactObservation,
  transport: HostedArtifactObservation,
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
  artifact: VerificationSessionArtifact,
  observation: TrustedRuntimeArtifactObservation,
  provenance: TrustedRuntimeMergeGateProvenance,
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
      producer.workflowPath !== CI_VERIFICATION_WORKFLOW_PATH ||
      producer.workflowSha !== currentBaseSha ||
      producer.workflowRef !== `${CI_VERIFICATION_WORKFLOW_PATH}@${currentBaseSha}` ||
      producer.runId !== provenance.executionId ||
      producer.actorNodeId !== provenance.actorNodeId ||
      producer.sourceDigest !== observation.producerSourceDigest) {
    fail('trusted runtime artifact does not bind a trusted-base local verifier producer receipt.');
  }
}

function assertHostedArtifactResultClosure(
  authorization: IntegrationAuthorization,
  origin: HostedArtifactObservation,
  transport: HostedArtifactObservation
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
  authorization: IntegrationAuthorization,
  observation: TrustedRuntimeArtifactObservation,
  provenance: TrustedRuntimeMergeGateProvenance
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
export function CreateMergeGateInput(
  input: MergeGateInputFields
): MergeGateInput {
  const candidate = Object.freeze({
    ...input.candidate,
    changedPaths: Object.freeze([...input.candidate.changedPaths])
  });
  assertCandidate(candidate);
  const provenance = assertProvenance(input.provenance, candidate.currentBaseSha);
  assertVerificationSessionArtifact(input.artifact);
  const hostedArtifactOrigin = CreateHostedArtifactObservation(input.hostedArtifactOrigin);
  const hostedArtifactTransport = CreateHostedArtifactObservation(input.hostedArtifactTransport);
  assertHostedArtifactClosure(
    input.artifact,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    input.candidate.currentBaseSha
  );
  const expectedActionPlan = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(input.expectedActionPlan)
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
    schema: MergeGateInputSchema,
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

export function CreateTrustedRuntimeMergeGateInput(
  input: TrustedRuntimeMergeGateInputFields
): TrustedRuntimeMergeGateInput {
  const candidate = Object.freeze({
    ...input.candidate,
    changedPaths: Object.freeze([...input.candidate.changedPaths])
  });
  assertCandidate(candidate);
  const provenance = assertTrustedRuntimeProvenance(input.provenance, candidate.currentBaseSha);
  assertVerificationSessionArtifact(input.artifact);
  const artifactObservation = createTrustedRuntimeArtifactObservation(input.artifactObservation);
  assertTrustedRuntimeArtifactClosure(input.artifact, artifactObservation, provenance, candidate.currentBaseSha);
  const expectedActionPlan = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(input.expectedActionPlan)
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
    schema: TrustedRuntimeMergeGateInputSchema,
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

type MergeGateIssuerInput = Readonly<{
  principalId: string;
  trustedRevision: string;
  sourceTransport: 'github-actions' | 'trusted-integration-runtime';
  sourceRunId: string;
  sourceRef: string;
  sourceDigest: MergeGateDigest;
}>;

type MergeGateCoreInput = Readonly<{
  candidate: MergeGateCandidate;
  artifact: VerificationSessionArtifact;
  expectedActionPlan: CiVerificationActionPlanClosure;
  reviewReceipt: ReviewStabilityReceipt;
  reviewSnapshotDigest: MergeGateDigest;
  mainHealth: MainHealthLedger;
  environmentDigest: MergeGateDigest;
  trustRevision: string;
  platformObservation: MergeGatePlatformObservation;
  consumptionOperationId: MergeGateDigest;
  issuedAt: string;
  expiresAt: string;
  issuer: MergeGateIssuerInput;
}>;

type MergeGateCoreResult = Readonly<{
  authorization: IntegrationAuthorization;
  reviewReceipt: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  platformObservation: MergeGatePlatformObservation;
}>;

/**
 * Single semantic integration-authorization reducer. Provider adapters must
 * authenticate their own transport/provenance before calling this function;
 * all candidate/scope/review/MainHealth/Evidence/platform invariants live here
 * once and are shared by Actions and independent trusted runtimes.
 */
function evaluateMergeGateCore(input: MergeGateCoreInput): MergeGateCoreResult {
  assertCandidate(input.candidate);
  const now = instant(input.issuedAt, 'issuedAt');
  instant(input.expiresAt, 'expiresAt');
  const trustRevision = sha(input.trustRevision, 'trustRevision');
  const environmentDigest = digest(input.environmentDigest, 'environmentDigest');
  const platformObservation = canonicalPlatformObservation(input.platformObservation);
  const rulesetDigest = platformObservation.rulesetDigest;
  assertVerificationSessionArtifact(input.artifact);
  const session: VerificationSession = input.artifact.session;
  const scopeAuthorization: ScopeAuthorization = input.artifact.scopeAuthorization;
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

  assertScopeAuthorizationCurrent(scopeAuthorization, {
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
  assertReviewStabilityReceiptCurrent(input.reviewReceipt, {
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
  const health = resolveOrdinaryMainHealthLane({
    ledger: input.mainHealth,
    now,
    expectedRepository: candidate.repository,
    expectedDefaultBranch: 'main',
    expectedMainSha: candidate.currentBaseSha,
    expectedMainTreeSha: candidate.currentBaseTreeSha,
    expectedTrustRevision: trustRevision
  });
  if (!health.allowed || health.status !== 'healthy') fail(`ordinary lane is locked: ${health.reason}`);
  if (input.mainHealth.producer.identity !== DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY ||
      input.mainHealth.producer.sourceTransport !== 'github-api' ||
      input.mainHealth.producer.trustRevision !== trustRevision ||
      input.mainHealth.producer.sourceRef
        !== `github-check-runs:${candidate.repository}@${candidate.currentBaseSha}`) {
    fail('fresh MainHealth producer provenance is not bound to the trusted authorization runtime.');
  }
  assertVerificationEvidence(evidence, {
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
  if (input.reviewReceipt.producer.identity !== REVIEW_OBSERVER_PRODUCER_IDENTITY ||
      input.reviewReceipt.producer.sourceRef !==
        `github://${candidate.repository}/pull/${candidate.prNumber}@${candidate.headSha}` ||
      !reviewSourceDigestIsCurrent) {
    fail('Review producer does not bind the independently reread GitHub snapshot.');
  }

  const authorization = createIntegrationAuthorization({
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
      producerIdentity: MergeGateProducerIdentity,
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

export function EvaluateMergeGate(
  input: MergeGateInput
): MergeGateResult {
  const record = exact(input, [
    'schema', 'provenance', 'candidate', 'artifact', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'input');
  if (input.schema !== MergeGateInputSchema) fail('input schema mismatch; scope-attestation V1 is retired.');
  const { schema: _schema, ...fields } = record;
  input = CreateMergeGateInput(
    fields as unknown as MergeGateInputFields
  );
  const provenance = assertProvenance(input.provenance, input.candidate.currentBaseSha);
  const hostedArtifactOrigin = CreateHostedArtifactObservation(input.hostedArtifactOrigin);
  const hostedArtifactTransport = CreateHostedArtifactObservation(input.hostedArtifactTransport);
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
  const core = evaluateMergeGateCore({
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
    schema: MergeGateResultSchema,
    status: 'authorized' as const,
    authorization: core.authorization,
    reviewReceipt: core.reviewReceipt,
    mainHealth: core.mainHealth,
    platformObservation: core.platformObservation,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    provenance,
    terminalStatusContext: MergeGateTerminalStatusContext
  });
  return Object.freeze({ ...withoutDigest, resultDigest: hash(withoutDigest) });
}

export function EvaluateTrustedRuntimeMergeGate(
  input: TrustedRuntimeMergeGateInput
): TrustedRuntimeMergeGateResult {
  const record = exact(input, [
    'schema', 'provenance', 'candidate', 'artifact', 'artifactObservation', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'trustedRuntimeInput');
  if (input.schema !== TrustedRuntimeMergeGateInputSchema) {
    fail('trusted runtime input schema mismatch.');
  }
  const { schema: _schema, ...fields } = record;
  input = CreateTrustedRuntimeMergeGateInput(
    fields as unknown as TrustedRuntimeMergeGateInputFields
  );
  const provenance = assertTrustedRuntimeProvenance(input.provenance, input.candidate.currentBaseSha);
  const artifactObservation = createTrustedRuntimeArtifactObservation(input.artifactObservation);
  assertTrustedRuntimeArtifactClosure(
    input.artifact,
    artifactObservation,
    provenance,
    input.candidate.currentBaseSha
  );
  const core = evaluateMergeGateCore({
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
    schema: TrustedRuntimeMergeGateResultSchema,
    status: 'authorized' as const,
    authorization: core.authorization,
    reviewReceipt: core.reviewReceipt,
    mainHealth: core.mainHealth,
    platformObservation: core.platformObservation,
    artifactObservation,
    provenance,
    terminalStatusContext: MergeGateTerminalStatusContext
  });
  return Object.freeze({ ...withoutDigest, resultDigest: hash(withoutDigest) });
}

export function ParseMergeGateResult(
  source: string
): MergeGateResult {
  const value = exact(JSON.parse(source), [
    'schema', 'status', 'authorization', 'reviewReceipt', 'mainHealth',
    'platformObservation', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'provenance', 'terminalStatusContext', 'resultDigest'
  ], 'merge-gate result');
  if (value.schema !== MergeGateResultSchema || value.status !== 'authorized' ||
      value.terminalStatusContext !== MergeGateTerminalStatusContext) {
    fail('result identity is invalid.');
  }
  const authorization = parseIntegrationAuthorization(
    encodeVerificationActionData(value.authorization)
  );
  const reviewReceipt = parseReviewStabilityReceipt(
    encodeVerificationActionData(value.reviewReceipt)
  );
  const mainHealth = parseMainHealthLedger(
    encodeVerificationActionData(value.mainHealth)
  );
  const platformObservation = canonicalPlatformObservation(
    value.platformObservation as unknown as MergeGatePlatformObservation
  );
  const hostedArtifactOrigin = CreateHostedArtifactObservation(
    value.hostedArtifactOrigin as unknown as HostedArtifactObservation
  );
  const hostedArtifactTransport = CreateHostedArtifactObservation(
    value.hostedArtifactTransport as unknown as HostedArtifactObservation
  );
  const provenance = assertProvenance(
    value.provenance as unknown as MergeGateProvenance,
    authorization.baseSha
  );
  assertHostedArtifactResultClosure(authorization, hostedArtifactOrigin, hostedArtifactTransport);
  if (authorization.reviewRevision !== reviewReceipt.reviewRevision ||
      authorization.reviewReceiptDigest !== reviewReceipt.receiptDigest ||
      authorization.mainHealthRevision !== mainHealth.healthRevision ||
      authorization.mainHealthReceiptDigest !== mainHealth.ledgerDigest ||
      authorization.rulesetDigest !== platformObservation.rulesetDigest ||
      authorization.issuer.principalId !== provenance.actorNodeId ||
      authorization.issuer.producerIdentity !== MergeGateProducerIdentity ||
      authorization.issuer.trustedRevision !== provenance.workflowSha ||
      authorization.issuer.sourceTransport !== 'github-actions' ||
      authorization.issuer.sourceRunId !== `${provenance.sourceRunId}:${provenance.sourceRunAttempt}` ||
      authorization.issuer.sourceRef !== provenance.workflowRef ||
      authorization.issuer.sourceDigest !== provenance.sourceDigest) {
    fail('authorization artifact receipt or issuer closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: MergeGateResultSchema,
    status: 'authorized' as const,
    authorization,
    reviewReceipt,
    mainHealth,
    platformObservation,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    provenance,
    terminalStatusContext: MergeGateTerminalStatusContext
  });
  const resultDigest = digest(value.resultDigest, 'resultDigest');
  if (resultDigest !== hash(withoutDigest)) fail('result digest mismatch.');
  return Object.freeze({ ...withoutDigest, resultDigest });
}

export function ParseTrustedRuntimeMergeGateResult(
  source: string
): TrustedRuntimeMergeGateResult {
  const value = exact(JSON.parse(source), [
    'schema', 'status', 'authorization', 'reviewReceipt', 'mainHealth',
    'platformObservation', 'artifactObservation', 'provenance', 'terminalStatusContext', 'resultDigest'
  ], 'trusted runtime merge-gate result');
  if (value.schema !== TrustedRuntimeMergeGateResultSchema || value.status !== 'authorized' ||
      value.terminalStatusContext !== MergeGateTerminalStatusContext) {
    fail('trusted runtime result identity is invalid.');
  }
  const authorization = parseIntegrationAuthorization(
    encodeVerificationActionData(value.authorization)
  );
  const reviewReceipt = parseReviewStabilityReceipt(
    encodeVerificationActionData(value.reviewReceipt)
  );
  const mainHealth = parseMainHealthLedger(
    encodeVerificationActionData(value.mainHealth)
  );
  const platformObservation = canonicalPlatformObservation(
    value.platformObservation as unknown as MergeGatePlatformObservation
  );
  const artifactObservation = createTrustedRuntimeArtifactObservation(
    value.artifactObservation as unknown as TrustedRuntimeArtifactObservation
  );
  const provenance = assertTrustedRuntimeProvenance(
    value.provenance as unknown as TrustedRuntimeMergeGateProvenance,
    authorization.baseSha
  );
  assertTrustedRuntimeArtifactResultClosure(authorization, artifactObservation, provenance);
  if (authorization.reviewRevision !== reviewReceipt.reviewRevision ||
      authorization.reviewReceiptDigest !== reviewReceipt.receiptDigest ||
      authorization.mainHealthRevision !== mainHealth.healthRevision ||
      authorization.mainHealthReceiptDigest !== mainHealth.ledgerDigest ||
      authorization.rulesetDigest !== platformObservation.rulesetDigest ||
      authorization.issuer.principalId !== provenance.actorNodeId ||
      authorization.issuer.producerIdentity !== MergeGateProducerIdentity ||
      authorization.issuer.trustedRevision !== provenance.runtimeSha ||
      authorization.issuer.sourceTransport !== 'trusted-integration-runtime' ||
      authorization.issuer.sourceRunId !== provenance.executionId ||
      authorization.issuer.sourceRef !== provenance.runtimeRef ||
      authorization.issuer.sourceDigest !== provenance.sourceDigest) {
    fail('trusted runtime authorization artifact receipt or issuer closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: TrustedRuntimeMergeGateResultSchema,
    status: 'authorized' as const,
    authorization,
    reviewReceipt,
    mainHealth,
    platformObservation,
    artifactObservation,
    provenance,
    terminalStatusContext: MergeGateTerminalStatusContext
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
export function assertCanonicalMergeMessage(input: {
  authorizationMarkers: readonly string[];
  reviewReceipt: ReviewStabilityReceipt;
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
    renderIndependentReviewTrailer(input.reviewReceipt)
  ];
  const actual = input.message.replaceAll('\r\n', '\n').split('\n').filter((line) => line.length > 0);
  if (actual.length !== expected.length
    || actual.some((line, index) => line !== expected[index])) {
    fail('merge message must equal the exact typed title and trailer multiset once each.');
  }
}

function parseInput(source: string): MergeGateInput {
  const value = exact(JSON.parse(source), [
    'schema', 'provenance', 'candidate', 'artifact', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'input');
  if (value.schema !== MergeGateInputSchema) fail('input schema mismatch.');
  const { schema: _schema, ...fields } = value;
  return CreateMergeGateInput(
    fields as unknown as MergeGateInputFields
  );
}

function parseTrustedRuntimeInput(source: string): TrustedRuntimeMergeGateInput {
  const value = exact(JSON.parse(source), [
    'schema', 'provenance', 'candidate', 'artifact', 'artifactObservation', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'trustedRuntimeInput');
  if (value.schema !== TrustedRuntimeMergeGateInputSchema) {
    fail('trusted runtime input schema mismatch.');
  }
  const { schema: _schema, ...fields } = value;
  return CreateTrustedRuntimeMergeGateInput(
    fields as unknown as TrustedRuntimeMergeGateInputFields
  );
}

async function main(): Promise<void> {
  const [command, inputFlag, inputPath, outputFlag, outputPath] = process.argv.slice(2);
  if ((command !== 'authorize' && command !== 'authorize-trusted-runtime') ||
      inputFlag !== '--input' || outputFlag !== '--output' || !inputPath || !outputPath) {
    throw new Error(
      'Usage: bun src/adapters/self-hosting/control/integration/merge-gate.ts authorize|authorize-trusted-runtime --input <json> --output <json>'
    );
  }
  const source = readFileSync(inputPath, 'utf8');
  const result = command === 'authorize'
    ? EvaluateMergeGate(parseInput(source))
    : EvaluateTrustedRuntimeMergeGate(parseTrustedRuntimeInput(source));
  writeFileSync(outputPath, `${encodeVerificationActionData(result)}\n`, 'utf8');
}

if (import.meta.main) await main();
