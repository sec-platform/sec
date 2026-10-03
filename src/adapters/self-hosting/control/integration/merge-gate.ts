import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../verification/platform/action/contract/provider.ts';
import { isResumedSessionProducer, parseResumedSessionProducer, type ResumedSessionProducer } from '../../../verification/platform/ci/contract/resumed-session-producer.ts';
import { assertAuthenticatedSessionResumeAdmissionCurrent, assertAuthenticatedSessionResumeArtifactTransportCurrent, authenticatedSessionResumeAuthorizationPrincipal, revalidateAuthenticatedSessionResumeAdmission, type SessionResumeAdmission } from '../../../verification/platform/ci/runtime/verification-session-resume-authority.ts';
import { assertSourceProgramTransitionQualification, sourceProgramTransitionEvidenceForQualification, type SourceProgramTransitionQualification } from '../../../verification/platform/trusted-runtime/trusted-runtime-container.ts';

import { CI_VERIFICATION_WORKFLOW_PATH } from '../../../../assurance/verification/contract/revision.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { parseCiVerificationActionPlanClosure, type CiVerificationActionPlanClosure } from '../../../verification/platform/action/contract/ci.ts';
import { CodexDevelopmentAssertVerificationEvidenceV4, CodexDevelopmentAssertVerificationSessionArtifact, parseSourceProgramTransitionAcceptanceRecord, type CodexDevelopmentVerificationSessionArtifact, type SourceProgramTransitionAcceptanceRecord } from '../../../verification/platform/ci/contract/evidence.ts';
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
import { assertTrustedRuntimeMainHealthPublication } from '../main-health/live-admission.ts';
import type { TrustedRuntimeMainHealthReceipt } from '../main-health/main-health-observation.ts';
import type { MainHealthPublicationAuthority } from '../main-health/work-selection-main-health.ts';
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

export const CodexDevelopmentMergeGateInputSchema =
  'codex-development-merge-gate-input-v2' as const;
export const CodexDevelopmentMergeGateResultSchema =
  'codex-development-merge-gate-result-v2' as const;
const CodexDevelopmentTrustedRuntimeMergeGateInputSchema =
  'sec-trusted-runtime-merge-gate-input-v1' as const;
export const CodexDevelopmentTrustedRuntimeMergeGateResultSchema =
  'sec-trusted-runtime-merge-gate-result-v1' as const;
export const CodexDevelopmentMergeGateProducerIdentity =
  'src/adapters/self-hosting/control/integration/merge-gate.ts' as const;
export const CodexDevelopmentMergeGateTerminalStatusContext =
  INTEGRATION_AUTHORIZATION_STATUS_CONTEXT;

type MergeGateDigest = `sha256:${string}`;

interface MergeGateProvenanceFields {
  readonly workflowPath: '.github/workflows/merge-gate.yml';
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly eventName: 'workflow_run';
  readonly sourceRunId: string;
  readonly sourceRunAttempt: number;
  readonly sourceDigest: MergeGateDigest;
}
export const RESUMED_MERGE_GATE_PROVENANCE_SCHEMA = 'sec-resumed-merge-gate-provenance-v2' as const;
export type CodexDevelopmentMergeGateProvenance = MergeGateProvenanceFields & (Readonly<{
  schema?: never; actorNodeId: string; actorPermission: 'maintain' | 'admin';
}> | Readonly<{
  schema: typeof RESUMED_MERGE_GATE_PROVENANCE_SCHEMA;
  authorizationPrincipal: ResumedSessionProducer['originalParentActor'];
  sourceProducer: ResumedSessionProducer;
}>);
export type MergeGateProvenanceInput = CodexDevelopmentMergeGateProvenance extends infer T
  ? T extends CodexDevelopmentMergeGateProvenance ? Omit<T, 'sourceDigest'> : never : never;

/** A data projection only. Authorization issuance separately requires live admission. */
export function mergeGateAuthorizationPrincipal(provenance: CodexDevelopmentMergeGateProvenance): Readonly<{ nodeId: string; permission: 'maintain' | 'admin' }> {
  return provenance.schema === RESUMED_MERGE_GATE_PROVENANCE_SCHEMA
    ? provenance.authorizationPrincipal
    : Object.freeze({ nodeId: provenance.actorNodeId, permission: provenance.actorPermission });
}

export interface CodexDevelopmentTrustedRuntimeMergeGateProvenance {
  readonly runtimePath: typeof CodexDevelopmentMergeGateProducerIdentity;
  readonly runtimeRef: string;
  readonly runtimeSha: string;
  readonly executionId: string;
  readonly actorNodeId: string;
  readonly actorPermission: 'maintain' | 'admin';
  readonly sourceDigest: MergeGateDigest;
}

export interface CodexDevelopmentMergeGateCandidate {
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

interface CodexDevelopmentMergeGatePlatformObservation {
  readonly status: 'available' | 'platform-enforcement-unavailable';
  readonly rulesetDigest: MergeGateDigest;
  readonly reason: string | null;
}

export const RESUMED_HOSTED_ARTIFACT_OBSERVATION_SCHEMA = 'sec-hosted-session-artifact-observation-v2' as const;

interface HostedArtifactObservationFields {
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
  readonly downloadTransport: 'github-actions-artifact-api';
}
export type CodexDevelopmentHostedArtifactObservation = HostedArtifactObservationFields & (Readonly<{
  schema?: never; actorPermission: 'maintain' | 'admin'; originalParentActor?: never;
}> | Readonly<{
  schema: typeof RESUMED_HOSTED_ARTIFACT_OBSERVATION_SCHEMA; actorPermission: 'workflow';
  originalParentActor: ResumedSessionProducer['originalParentActor'];
}>);

export interface CodexDevelopmentTrustedRuntimeArtifactObservation {
  readonly artifactFileName: 'verification-session-artifact.json';
  readonly artifactByteDigest: MergeGateDigest;
  readonly artifactByteLength: number;
  readonly runtimeRef: string;
  readonly runtimeSha: string;
  readonly executionId: string;
  readonly producerSourceDigest: MergeGateDigest;
  readonly readbackTransport: 'trusted-runtime-durable-file';
}

export interface CodexDevelopmentMergeGateInput {
  readonly schema: typeof CodexDevelopmentMergeGateInputSchema;
  readonly provenance: CodexDevelopmentMergeGateProvenance;
  readonly candidate: CodexDevelopmentMergeGateCandidate;
  readonly artifact: CodexDevelopmentVerificationSessionArtifact;
  readonly hostedArtifactOrigin: CodexDevelopmentHostedArtifactObservation;
  readonly hostedArtifactTransport: CodexDevelopmentHostedArtifactObservation;
  readonly expectedActionPlan: CiVerificationActionPlanClosure;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly reviewSnapshotDigest: MergeGateDigest;
  readonly mainHealth: MainHealthLedger;
  readonly environmentDigest: MergeGateDigest;
  readonly trustRevision: string;
  readonly platformObservation: CodexDevelopmentMergeGatePlatformObservation;
  readonly consumptionOperationId: MergeGateDigest;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type CodexDevelopmentMergeGateInputFields = Omit<
  CodexDevelopmentMergeGateInput,
  'schema'
>;

export interface CodexDevelopmentTrustedRuntimeMergeGateInput {
  readonly schema: typeof CodexDevelopmentTrustedRuntimeMergeGateInputSchema;
  readonly provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenance;
  readonly candidate: CodexDevelopmentMergeGateCandidate;
  readonly artifact: CodexDevelopmentVerificationSessionArtifact;
  readonly artifactObservation: CodexDevelopmentTrustedRuntimeArtifactObservation;
  readonly expectedActionPlan: CiVerificationActionPlanClosure;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly reviewSnapshotDigest: MergeGateDigest;
  readonly mainHealth: MainHealthLedger;
  readonly environmentDigest: MergeGateDigest;
  readonly trustRevision: string;
  readonly platformObservation: CodexDevelopmentMergeGatePlatformObservation;
  readonly consumptionOperationId: MergeGateDigest;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type CodexDevelopmentTrustedRuntimeMergeGateInputFields = Omit<
  CodexDevelopmentTrustedRuntimeMergeGateInput,
  'schema'
>;

export interface CodexDevelopmentMergeGateResult {
  readonly schema: typeof CodexDevelopmentMergeGateResultSchema;
  readonly status: 'authorized';
  readonly authorization: IntegrationAuthorization;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly mainHealth: MainHealthLedger;
  readonly platformObservation: CodexDevelopmentMergeGatePlatformObservation;
  readonly hostedArtifactOrigin: CodexDevelopmentHostedArtifactObservation;
  readonly hostedArtifactTransport: CodexDevelopmentHostedArtifactObservation;
  readonly provenance: CodexDevelopmentMergeGateProvenance;
  readonly terminalStatusContext: typeof CodexDevelopmentMergeGateTerminalStatusContext;
  readonly resultDigest: MergeGateDigest;
}

export interface CodexDevelopmentTrustedRuntimeMergeGateResult {
  readonly schema: typeof CodexDevelopmentTrustedRuntimeMergeGateResultSchema;
  readonly status: 'authorized';
  readonly authorization: IntegrationAuthorization;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly mainHealth: MainHealthLedger;
  readonly platformObservation: CodexDevelopmentMergeGatePlatformObservation;
  readonly artifactObservation: CodexDevelopmentTrustedRuntimeArtifactObservation;
  readonly provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenance;
  readonly terminalStatusContext: typeof CodexDevelopmentMergeGateTerminalStatusContext;
  readonly resultDigest: MergeGateDigest;
  readonly sourceProgramTransitionAcceptance?: SourceProgramTransitionAcceptanceRecord;
}

const issuedIntegrationGateResults = new WeakMap<object, Readonly<{
  resultDigest: MergeGateDigest;
  transitionQualification: SourceProgramTransitionQualification;
}>>();

export function requireIssuedIntegrationGateResult(
  result: CodexDevelopmentMergeGateResult | CodexDevelopmentTrustedRuntimeMergeGateResult
): SourceProgramTransitionQualification {
  const issued = issuedIntegrationGateResults.get(result);
  const { resultDigest, ...canonical } = result;
  if (issued === undefined || issued.resultDigest !== resultDigest || hash(canonical) !== resultDigest) {
    fail('direct status publication requires the actual trusted-runtime transition producer; pure evaluation and saved JSON are historical. Non-transition publication uses the existing hosted workflow reconstruction.');
  }
  assertSourceProgramTransitionQualification(issued.transitionQualification);
  const subject = sourceProgramTransitionEvidenceForQualification(issued.transitionQualification).observation;
  if (result.schema !== CodexDevelopmentTrustedRuntimeMergeGateResultSchema
      || result.sourceProgramTransitionAcceptance?.qualificationDigest !== issued.transitionQualification.qualificationDigest
      || subject.repository !== result.authorization.repository
      || subject.pullRequestNumber !== result.authorization.prNumber
      || subject.baseSha !== result.authorization.baseSha
      || subject.headSha !== result.authorization.headSha
      || subject.headTreeSha !== result.authorization.headTreeSha
      || subject.sessionRevision !== result.authorization.sessionRevision) {
    fail('status publication subject differs from the actual live transition producer');
  }
  return issued.transitionQualification;
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
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
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

export function createMergeGateProvenance(input: MergeGateProvenanceInput): CodexDevelopmentMergeGateProvenance {
  if (input.workflowPath !== '.github/workflows/merge-gate.yml') fail('workflowPath is not canonical.');
  const workflowSha = sha(input.workflowSha, 'provenance.workflowSha');
  const expectedRef = `.github/workflows/merge-gate.yml@${workflowSha}`;
  if (input.workflowRef !== expectedRef) fail('workflowRef must bind the exact trusted workflow blob revision.');
  if (input.eventName !== 'workflow_run') {
    fail('authorization can only originate from the completed compiler workflow wakeup.');
  }
  if (!Number.isSafeInteger(input.sourceRunAttempt) || input.sourceRunAttempt < 1) fail('sourceRunAttempt is invalid.');
  if (input.schema === RESUMED_MERGE_GATE_PROVENANCE_SCHEMA) {
    const sourceProducer = parseResumedSessionProducer(input.sourceProducer);
    if (sourceProducer.workflowSha !== workflowSha
        || encodeVerificationActionData(input.authorizationPrincipal) !== encodeVerificationActionData(sourceProducer.originalParentActor)) {
      fail('resumed provenance source or original authorization principal differs.');
    }
    const withoutDigest = Object.freeze({ schema: RESUMED_MERGE_GATE_PROVENANCE_SCHEMA,
      workflowPath: input.workflowPath, workflowRef: input.workflowRef, workflowSha, eventName: input.eventName,
      sourceRunId: text(input.sourceRunId, 'provenance.sourceRunId'), sourceRunAttempt: input.sourceRunAttempt,
      authorizationPrincipal: sourceProducer.originalParentActor, sourceProducer });
    return Object.freeze({ ...withoutDigest, sourceDigest: hash(withoutDigest) });
  }
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
  CodexDevelopmentTrustedRuntimeMergeGateProvenance,
  'sourceDigest'
>): CodexDevelopmentTrustedRuntimeMergeGateProvenance {
  if (input.runtimePath !== CodexDevelopmentMergeGateProducerIdentity) {
    fail('trusted runtime path is not the canonical merge-gate entrypoint.');
  }
  const runtimeSha = sha(input.runtimeSha, 'trustedRuntimeProvenance.runtimeSha');
  const expectedRef = `${CodexDevelopmentMergeGateProducerIdentity}@${runtimeSha}`;
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
  provenance: CodexDevelopmentMergeGateProvenance,
  currentBase: string
): CodexDevelopmentMergeGateProvenance {
  const parsed = exact(provenance, [
    'workflowPath', 'workflowRef', 'workflowSha', 'eventName', 'sourceRunId', 'sourceRunAttempt',
    ...(provenance.schema === RESUMED_MERGE_GATE_PROVENANCE_SCHEMA
      ? ['schema', 'authorizationPrincipal', 'sourceProducer'] : ['actorNodeId', 'actorPermission']), 'sourceDigest'
  ], 'provenance');
  const rebuilt = createMergeGateProvenance(parsed as unknown as MergeGateProvenanceInput);
  if (rebuilt.sourceDigest !== parsed.sourceDigest) fail('provenance source digest mismatch.');
  if (rebuilt.workflowSha !== currentBase) fail('candidate/runtime workflow cannot issue authorization; workflow SHA must equal live trusted base.');
  return rebuilt;
}

function assertTrustedRuntimeProvenance(
  provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenance,
  currentBase: string
): CodexDevelopmentTrustedRuntimeMergeGateProvenance {
  const parsed = exact(provenance, [
    'runtimePath', 'runtimeRef', 'runtimeSha', 'executionId', 'actorNodeId', 'actorPermission', 'sourceDigest'
  ], 'trustedRuntimeProvenance');
  const rebuilt = createTrustedRuntimeMergeGateProvenance(
    parsed as unknown as Omit<CodexDevelopmentTrustedRuntimeMergeGateProvenance, 'sourceDigest'>
  );
  if (rebuilt.sourceDigest !== parsed.sourceDigest) fail('trusted runtime provenance source digest mismatch.');
  if (rebuilt.runtimeSha !== currentBase) {
    fail('candidate runtime cannot issue authorization; trusted runtime SHA must equal live trusted base.');
  }
  return rebuilt;
}

function assertCandidate(candidate: CodexDevelopmentMergeGateCandidate): void {
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
  value: CodexDevelopmentMergeGatePlatformObservation
): CodexDevelopmentMergeGatePlatformObservation {
  try {
    return canonicalizeIntegrationPlatformObservation(value);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export function CodexDevelopmentCreateHostedArtifactObservation(
  value: CodexDevelopmentHostedArtifactObservation
): CodexDevelopmentHostedArtifactObservation {
  const resumed = value.schema === RESUMED_HOSTED_ARTIFACT_OBSERVATION_SCHEMA;
  exact(value, [
    ...(resumed ? ['schema', 'originalParentActor'] : []),
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
  if (resumed) {
    const actor = exact(value.originalParentActor, ['login', 'id', 'nodeId', 'type', 'permission'], 'hosted artifact original human');
    if (value.actorPermission !== 'workflow' || value.actorNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId
        || actor.type !== 'User' || !Number.isSafeInteger(actor.id) || Number(actor.id) < 1
        || actor.permission !== 'maintain' && actor.permission !== 'admin'
        || actor.nodeId === value.actorNodeId) fail('hosted artifact App/human identities differ.');
    text(actor.login, 'hosted artifact original human login');
    text(actor.nodeId, 'hosted artifact original human node id');
  } else if (value.actorPermission !== 'maintain' && value.actorPermission !== 'admin') {
    fail('hosted artifact actor permission is insufficient.');
  }
  if (value.downloadTransport !== 'github-actions-artifact-api') fail('hosted artifact download transport is not canonical.');
  return Object.freeze({
    ...(resumed ? { schema: RESUMED_HOSTED_ARTIFACT_OBSERVATION_SCHEMA,
      originalParentActor: Object.freeze({ ...value.originalParentActor }) } : {}),
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
  }) as CodexDevelopmentHostedArtifactObservation;
}

export function createTrustedRuntimeArtifactObservation(
  value: CodexDevelopmentTrustedRuntimeArtifactObservation
): CodexDevelopmentTrustedRuntimeArtifactObservation {
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
  if (value.runtimeRef !== `${CodexDevelopmentMergeGateProducerIdentity}@${runtimeSha}`) {
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
  observation: CodexDevelopmentHostedArtifactObservation
): string {
  return `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-pr-${prNumber}-session-${sessionRevision.slice('sha256:'.length)}-run-${observation.runId}-attempt-${observation.runAttempt}`;
}

function canonicalArtifactBytes(artifact: CodexDevelopmentVerificationSessionArtifact): Readonly<{
  bytes: string;
  digest: MergeGateDigest;
  length: number;
}> {
  const bytes = `${encodeVerificationActionData(artifact)}\n`;
  return Object.freeze({
    bytes,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    length: Buffer.byteLength(bytes, 'utf8')
  });
}

function assertHostedArtifactClosure(
  artifact: CodexDevelopmentVerificationSessionArtifact,
  origin: CodexDevelopmentHostedArtifactObservation,
  transport: CodexDevelopmentHostedArtifactObservation,
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
  for (const observation of [origin, transport]) {
    if (isResumedSessionProducer(producer)) {
      if (observation.schema !== RESUMED_HOSTED_ARTIFACT_OBSERVATION_SCHEMA
          || encodeVerificationActionData(observation.originalParentActor) !== encodeVerificationActionData(producer.originalParentActor)) {
        fail('resumed hosted artifact lost its independent original human authority.');
      }
    } else if (observation.schema !== undefined) fail('legacy artifact cannot use resumed transport provenance.');
  }
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
  artifact: CodexDevelopmentVerificationSessionArtifact,
  observation: CodexDevelopmentTrustedRuntimeArtifactObservation,
  provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenance,
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
  origin: CodexDevelopmentHostedArtifactObservation,
  transport: CodexDevelopmentHostedArtifactObservation
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
  observation: CodexDevelopmentTrustedRuntimeArtifactObservation,
  provenance: CodexDevelopmentTrustedRuntimeMergeGateProvenance
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
export function CodexDevelopmentCreateMergeGateInput(
  input: CodexDevelopmentMergeGateInputFields
): CodexDevelopmentMergeGateInput {
  const candidate = Object.freeze({
    ...input.candidate,
    changedPaths: Object.freeze([...input.candidate.changedPaths])
  });
  assertCandidate(candidate);
  const provenance = assertProvenance(input.provenance, candidate.currentBaseSha);
  CodexDevelopmentAssertVerificationSessionArtifact(input.artifact);
  const hostedArtifactOrigin = CodexDevelopmentCreateHostedArtifactObservation(input.hostedArtifactOrigin);
  const hostedArtifactTransport = CodexDevelopmentCreateHostedArtifactObservation(input.hostedArtifactTransport);
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
    schema: CodexDevelopmentMergeGateInputSchema,
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

export function CodexDevelopmentCreateTrustedRuntimeMergeGateInput(
  input: CodexDevelopmentTrustedRuntimeMergeGateInputFields
): CodexDevelopmentTrustedRuntimeMergeGateInput {
  const candidate = Object.freeze({
    ...input.candidate,
    changedPaths: Object.freeze([...input.candidate.changedPaths])
  });
  assertCandidate(candidate);
  const provenance = assertTrustedRuntimeProvenance(input.provenance, candidate.currentBaseSha);
  CodexDevelopmentAssertVerificationSessionArtifact(input.artifact);
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
    schema: CodexDevelopmentTrustedRuntimeMergeGateInputSchema,
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
  candidate: CodexDevelopmentMergeGateCandidate;
  artifact: CodexDevelopmentVerificationSessionArtifact;
  expectedActionPlan: CiVerificationActionPlanClosure;
  reviewReceipt: ReviewStabilityReceipt;
  reviewSnapshotDigest: MergeGateDigest;
  mainHealth: MainHealthLedger;
  environmentDigest: MergeGateDigest;
  trustRevision: string;
  platformObservation: CodexDevelopmentMergeGatePlatformObservation;
  consumptionOperationId: MergeGateDigest;
  issuedAt: string;
  expiresAt: string;
  issuer: MergeGateIssuerInput;
}>;

type MergeGateCoreResult = Readonly<{
  authorization: IntegrationAuthorization;
  reviewReceipt: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  platformObservation: CodexDevelopmentMergeGatePlatformObservation;
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
  CodexDevelopmentAssertVerificationSessionArtifact(input.artifact);
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
      input.mainHealth.producer.trustRevision !== trustRevision) {
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
      producerIdentity: CodexDevelopmentMergeGateProducerIdentity,
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

function assertHostedMainHealthProvenance(ledger: MainHealthLedger, candidate: CodexDevelopmentMergeGateCandidate): void {
  if (ledger.producer.sourceTransport !== 'github-api'
      || ledger.producer.sourceRef !== `github-check-runs:${candidate.repository}@${candidate.currentBaseSha}`) {
    fail('fresh MainHealth producer provenance is not bound to the trusted authorization runtime.');
  }
}

const resumedGateEvaluations = new WeakSet<object>();

/** Copy only data through the original strict codec, preserving the separately
 * authenticated artifact object. This helper itself never grants admission. */
export function snapshotHostedMergeGateEvaluationInput(input: CodexDevelopmentMergeGateInput): CodexDevelopmentMergeGateInput {
  const artifact = input.artifact;
  const snapshot = parseInput(encodeVerificationActionData(input));
  return Object.freeze({ ...snapshot, artifact });
}


/** The only resumed issuance entry: recheck the original human using the same
 * live API scope, then evaluate synchronously before another await can intervene. */
export async function evaluateAuthenticatedResumedSessionMergeGate(input: CodexDevelopmentMergeGateInput,
  admission: SessionResumeAdmission): Promise<CodexDevelopmentMergeGateResult> {
  assertAuthenticatedSessionResumeAdmissionCurrent(admission, { artifact: input.artifact });
  const snapshot = snapshotHostedMergeGateEvaluationInput(input);
  assertAuthenticatedSessionResumeArtifactTransportCurrent(admission, snapshot.hostedArtifactOrigin);
  assertAuthenticatedSessionResumeArtifactTransportCurrent(admission, snapshot.hostedArtifactTransport);
  await revalidateAuthenticatedSessionResumeAdmission(admission);
  assertAuthenticatedSessionResumeAdmissionCurrent(admission, { artifact: snapshot.artifact });
  resumedGateEvaluations.add(admission);
  try { return CodexDevelopmentEvaluateMergeGate(snapshot, admission); }
  finally { resumedGateEvaluations.delete(admission); }
}

export function CodexDevelopmentEvaluateMergeGate(
  input: CodexDevelopmentMergeGateInput,
  resumeAdmission?: SessionResumeAdmission
): CodexDevelopmentMergeGateResult {
  if (isResumedSessionProducer(input.artifact.producer)) {
    if (resumeAdmission === undefined || !resumedGateEvaluations.has(resumeAdmission)) fail('resumed Session requires freshly revalidated private API admission.');
    assertAuthenticatedSessionResumeAdmissionCurrent(resumeAdmission, { artifact: input.artifact });
    assertAuthenticatedSessionResumeArtifactTransportCurrent(resumeAdmission, input.hostedArtifactOrigin);
    assertAuthenticatedSessionResumeArtifactTransportCurrent(resumeAdmission, input.hostedArtifactTransport);
  } else if (resumeAdmission !== undefined) fail('legacy Session cannot borrow resumed admission.');
  const record = exact(input, [
    'schema', 'provenance', 'candidate', 'artifact', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'input');
  if (input.schema !== CodexDevelopmentMergeGateInputSchema) fail('input schema mismatch; scope-attestation V1 is retired.');
  const { schema: _schema, ...fields } = record;
  input = CodexDevelopmentCreateMergeGateInput(
    fields as unknown as CodexDevelopmentMergeGateInputFields
  );
  if (input.artifact.sourceProgramTransitionAcceptance !== undefined
      || input.artifact.evidence.gates.some(({ action }) => action.operation.identity === 'source-program-transition-assessment')) {
    fail('the hosted merge route does not qualify trusted-runtime test transitions');
  }
  const provenance = assertProvenance(input.provenance, input.candidate.currentBaseSha);
  let issuerPrincipalId = mergeGateAuthorizationPrincipal(provenance).nodeId;
  if (isResumedSessionProducer(input.artifact.producer)) {
    if (provenance.schema !== RESUMED_MERGE_GATE_PROVENANCE_SCHEMA
        || encodeVerificationActionData(provenance.sourceProducer) !== encodeVerificationActionData(input.artifact.producer)) {
      fail('resumed Gate provenance does not bind the actual Session producer.');
    }
    const livePrincipal = authenticatedSessionResumeAuthorizationPrincipal(resumeAdmission!);
    if (encodeVerificationActionData(livePrincipal) !== encodeVerificationActionData(provenance.authorizationPrincipal)) {
      fail('Gate authorization principal differs from the currently admitted original human.');
    }
    issuerPrincipalId = livePrincipal.nodeId;
  } else if (provenance.schema !== undefined) fail('legacy Session cannot use resumed Gate provenance.');
  const hostedArtifactOrigin = CodexDevelopmentCreateHostedArtifactObservation(input.hostedArtifactOrigin);
  const hostedArtifactTransport = CodexDevelopmentCreateHostedArtifactObservation(input.hostedArtifactTransport);
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
  assertHostedMainHealthProvenance(input.mainHealth, input.candidate);
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
      principalId: issuerPrincipalId,
      trustedRevision: provenance.workflowSha,
      sourceTransport: 'github-actions',
      sourceRunId: `${provenance.sourceRunId}:${provenance.sourceRunAttempt}`,
      sourceRef: provenance.workflowRef,
      sourceDigest: provenance.sourceDigest
    }
  });
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentMergeGateResultSchema,
    status: 'authorized' as const,
    authorization: core.authorization,
    reviewReceipt: core.reviewReceipt,
    mainHealth: core.mainHealth,
    platformObservation: core.platformObservation,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    provenance,
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContext
  });
  const result = Object.freeze({ ...withoutDigest, resultDigest: hash(withoutDigest) });
  return result;
}

export function CodexDevelopmentEvaluateTrustedRuntimeMergeGate(
  input: CodexDevelopmentTrustedRuntimeMergeGateInput,
  transitionQualification?: SourceProgramTransitionQualification,
  mainHealthAdmission?: Readonly<{
    authority: MainHealthPublicationAuthority;
    receipt: TrustedRuntimeMainHealthReceipt;
    repositoryRoot: string;
  }>
): CodexDevelopmentTrustedRuntimeMergeGateResult {
  const record = exact(input, [
    'schema', 'provenance', 'candidate', 'artifact', 'artifactObservation', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'trustedRuntimeInput');
  if (input.schema !== CodexDevelopmentTrustedRuntimeMergeGateInputSchema) {
    fail('trusted runtime input schema mismatch.');
  }
  const { schema: _schema, ...fields } = record;
  input = CodexDevelopmentCreateTrustedRuntimeMergeGateInput(
    fields as unknown as CodexDevelopmentTrustedRuntimeMergeGateInputFields
  );
  const acceptance = input.artifact.sourceProgramTransitionAcceptance;
  if (acceptance !== undefined) {
    if (transitionQualification === undefined) fail('serialized transition input cannot authorize a gate without live qualification');
    assertSourceProgramTransitionQualification(transitionQualification);
    if (transitionQualification.qualificationDigest !== acceptance.qualificationDigest
        || transitionQualification.sessionRevision !== input.artifact.session.sessionRevision) {
      fail('live transition qualification differs from the exact accepted artifact');
    }
  } else if (transitionQualification !== undefined) fail('unselected test transition cannot qualify this gate');
  const provenance = assertTrustedRuntimeProvenance(input.provenance, input.candidate.currentBaseSha);
  const artifactObservation = createTrustedRuntimeArtifactObservation(input.artifactObservation);
  assertTrustedRuntimeArtifactClosure(
    input.artifact,
    artifactObservation,
    provenance,
    input.candidate.currentBaseSha
  );
  if (input.mainHealth.producer.sourceTransport === 'trusted-runtime-durable-readback') {
    if (mainHealthAdmission === undefined) fail('local MainHealth requires live production admission');
    assertTrustedRuntimeMainHealthPublication({
      admission: mainHealthAdmission,
      ledger: input.mainHealth,
      repository: input.candidate.repository,
      mainSha: input.candidate.currentBaseSha,
      mainTreeSha: input.candidate.currentBaseTreeSha,
      now: input.issuedAt
    });
  } else assertHostedMainHealthProvenance(input.mainHealth, input.candidate);
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
    schema: CodexDevelopmentTrustedRuntimeMergeGateResultSchema,
    status: 'authorized' as const,
    authorization: core.authorization,
    reviewReceipt: core.reviewReceipt,
    mainHealth: core.mainHealth,
    platformObservation: core.platformObservation,
    artifactObservation,
    ...(acceptance === undefined ? {} : { sourceProgramTransitionAcceptance: acceptance }),
    provenance,
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContext
  });
  const result = Object.freeze({ ...withoutDigest, resultDigest: hash(withoutDigest) });
  // Only an actual physical-owner qualification can issue direct publication
  // provenance. Pure evaluation of either schema must remain historical data.
  if (transitionQualification !== undefined) {
    const observed = sourceProgramTransitionEvidenceForQualification(transitionQualification).observation;
    if (observed.repository !== core.authorization.repository
        || observed.pullRequestNumber !== core.authorization.prNumber
        || observed.baseSha !== core.authorization.baseSha
        || observed.headSha !== core.authorization.headSha
        || observed.headTreeSha !== core.authorization.headTreeSha
        || observed.sessionRevision !== core.authorization.sessionRevision
        || !input.expectedActionPlan.actions.some(({ action }) => action.actionKey === observed.actionKey)) {
      fail('direct publication qualification belongs to another subject or Action');
    }
    issuedIntegrationGateResults.set(result, Object.freeze({ resultDigest: result.resultDigest, transitionQualification }));
  }
  return result;
}

export function CodexDevelopmentParseMergeGateResult(
  source: string
): CodexDevelopmentMergeGateResult {
  const value = exact(JSON.parse(source), [
    'schema', 'status', 'authorization', 'reviewReceipt', 'mainHealth',
    'platformObservation', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'provenance', 'terminalStatusContext', 'resultDigest'
  ], 'merge-gate result');
  if (value.schema !== CodexDevelopmentMergeGateResultSchema || value.status !== 'authorized' ||
      value.terminalStatusContext !== CodexDevelopmentMergeGateTerminalStatusContext) {
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
    value.platformObservation as unknown as CodexDevelopmentMergeGatePlatformObservation
  );
  const hostedArtifactOrigin = CodexDevelopmentCreateHostedArtifactObservation(
    value.hostedArtifactOrigin as unknown as CodexDevelopmentHostedArtifactObservation
  );
  const hostedArtifactTransport = CodexDevelopmentCreateHostedArtifactObservation(
    value.hostedArtifactTransport as unknown as CodexDevelopmentHostedArtifactObservation
  );
  const provenance = assertProvenance(
    value.provenance as unknown as CodexDevelopmentMergeGateProvenance,
    authorization.baseSha
  );
  assertHostedArtifactResultClosure(authorization, hostedArtifactOrigin, hostedArtifactTransport);
  if (provenance.schema === RESUMED_MERGE_GATE_PROVENANCE_SCHEMA) {
    const producer = provenance.sourceProducer;
    if (hostedArtifactOrigin.schema !== RESUMED_HOSTED_ARTIFACT_OBSERVATION_SCHEMA
        || hostedArtifactTransport.schema !== RESUMED_HOSTED_ARTIFACT_OBSERVATION_SCHEMA
        || producer.runId !== hostedArtifactOrigin.runId || producer.runAttempt !== hostedArtifactOrigin.runAttempt
        || producer.workflowSha !== hostedArtifactOrigin.workflowSha || producer.actorNodeId !== hostedArtifactOrigin.actorNodeId
        || encodeVerificationActionData(provenance.authorizationPrincipal) !== encodeVerificationActionData(hostedArtifactOrigin.originalParentActor)
        || encodeVerificationActionData(provenance.authorizationPrincipal) !== encodeVerificationActionData(hostedArtifactTransport.originalParentActor)) {
      fail('resumed Gate result producer/original human differs from its exact artifact origin.');
    }
  } else if (hostedArtifactOrigin.schema !== undefined || hostedArtifactTransport.schema !== undefined) {
    fail('legacy Gate result cannot carry resumed artifact observations.');
  }

  if (authorization.reviewRevision !== reviewReceipt.reviewRevision ||
      authorization.reviewReceiptDigest !== reviewReceipt.receiptDigest ||
      authorization.mainHealthRevision !== mainHealth.healthRevision ||
      authorization.mainHealthReceiptDigest !== mainHealth.ledgerDigest ||
      authorization.rulesetDigest !== platformObservation.rulesetDigest ||
      authorization.issuer.principalId !== mergeGateAuthorizationPrincipal(provenance).nodeId ||
      authorization.issuer.producerIdentity !== CodexDevelopmentMergeGateProducerIdentity ||
      authorization.issuer.trustedRevision !== provenance.workflowSha ||
      authorization.issuer.sourceTransport !== 'github-actions' ||
      authorization.issuer.sourceRunId !== `${provenance.sourceRunId}:${provenance.sourceRunAttempt}` ||
      authorization.issuer.sourceRef !== provenance.workflowRef ||
      authorization.issuer.sourceDigest !== provenance.sourceDigest) {
    fail('authorization artifact receipt or issuer closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentMergeGateResultSchema,
    status: 'authorized' as const,
    authorization,
    reviewReceipt,
    mainHealth,
    platformObservation,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    provenance,
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContext
  });
  const resultDigest = digest(value.resultDigest, 'resultDigest');
  if (resultDigest !== hash(withoutDigest)) fail('result digest mismatch.');
  return Object.freeze({ ...withoutDigest, resultDigest });
}

export function CodexDevelopmentParseTrustedRuntimeMergeGateResult(
  source: string
): CodexDevelopmentTrustedRuntimeMergeGateResult {
  const parsed = JSON.parse(source);
  const value = exact(parsed, [
    'schema', 'status', 'authorization', 'reviewReceipt', 'mainHealth',
    'platformObservation', 'artifactObservation', 'provenance', 'terminalStatusContext', 'resultDigest',
    ...(parsed?.sourceProgramTransitionAcceptance === undefined ? [] : ['sourceProgramTransitionAcceptance'])
  ], 'trusted runtime merge-gate result');
  if (value.schema !== CodexDevelopmentTrustedRuntimeMergeGateResultSchema || value.status !== 'authorized' ||
      value.terminalStatusContext !== CodexDevelopmentMergeGateTerminalStatusContext) {
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
    value.platformObservation as unknown as CodexDevelopmentMergeGatePlatformObservation
  );
  const artifactObservation = createTrustedRuntimeArtifactObservation(
    value.artifactObservation as unknown as CodexDevelopmentTrustedRuntimeArtifactObservation
  );
  const provenance = assertTrustedRuntimeProvenance(
    value.provenance as unknown as CodexDevelopmentTrustedRuntimeMergeGateProvenance,
    authorization.baseSha
  );
  assertTrustedRuntimeArtifactResultClosure(authorization, artifactObservation, provenance);
  if (authorization.reviewRevision !== reviewReceipt.reviewRevision ||
      authorization.reviewReceiptDigest !== reviewReceipt.receiptDigest ||
      authorization.mainHealthRevision !== mainHealth.healthRevision ||
      authorization.mainHealthReceiptDigest !== mainHealth.ledgerDigest ||
      authorization.rulesetDigest !== platformObservation.rulesetDigest ||
      authorization.issuer.principalId !== provenance.actorNodeId ||
      authorization.issuer.producerIdentity !== CodexDevelopmentMergeGateProducerIdentity ||
      authorization.issuer.trustedRevision !== provenance.runtimeSha ||
      authorization.issuer.sourceTransport !== 'trusted-integration-runtime' ||
      authorization.issuer.sourceRunId !== provenance.executionId ||
      authorization.issuer.sourceRef !== provenance.runtimeRef ||
      authorization.issuer.sourceDigest !== provenance.sourceDigest) {
    fail('trusted runtime authorization artifact receipt or issuer closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentTrustedRuntimeMergeGateResultSchema,
    status: 'authorized' as const,
    authorization,
    reviewReceipt,
    mainHealth,
    platformObservation,
    artifactObservation,
    ...(value.sourceProgramTransitionAcceptance === undefined ? {} : {
      sourceProgramTransitionAcceptance: parseSourceProgramTransitionAcceptanceRecord(value.sourceProgramTransitionAcceptance)
    }),
    provenance,
    terminalStatusContext: CodexDevelopmentMergeGateTerminalStatusContext
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

function parseInput(source: string): CodexDevelopmentMergeGateInput {
  const value = exact(JSON.parse(source), [
    'schema', 'provenance', 'candidate', 'artifact', 'hostedArtifactOrigin', 'hostedArtifactTransport', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'input');
  if (value.schema !== CodexDevelopmentMergeGateInputSchema) fail('input schema mismatch.');
  const { schema: _schema, ...fields } = value;
  return CodexDevelopmentCreateMergeGateInput(
    fields as unknown as CodexDevelopmentMergeGateInputFields
  );
}

function parseTrustedRuntimeInput(source: string): CodexDevelopmentTrustedRuntimeMergeGateInput {
  const value = exact(JSON.parse(source), [
    'schema', 'provenance', 'candidate', 'artifact', 'artifactObservation', 'expectedActionPlan',
    'reviewReceipt', 'reviewSnapshotDigest', 'mainHealth', 'environmentDigest', 'trustRevision', 'platformObservation',
    'consumptionOperationId', 'issuedAt', 'expiresAt'
  ], 'trustedRuntimeInput');
  if (value.schema !== CodexDevelopmentTrustedRuntimeMergeGateInputSchema) {
    fail('trusted runtime input schema mismatch.');
  }
  const { schema: _schema, ...fields } = value;
  return CodexDevelopmentCreateTrustedRuntimeMergeGateInput(
    fields as unknown as CodexDevelopmentTrustedRuntimeMergeGateInputFields
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
    ? CodexDevelopmentEvaluateMergeGate(parseInput(source))
    : CodexDevelopmentEvaluateTrustedRuntimeMergeGate(parseTrustedRuntimeInput(source));
  writeFileSync(outputPath, `${encodeVerificationActionData(result)}\n`, 'utf8');
}

if (import.meta.main) await main();
