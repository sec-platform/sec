import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest, VerificationActionPlan } from '../../../../execution/verification/action.ts';
import type { HostedActionArtifactInput, HostedActionExecutionTicket, HostedActionResolution, HostedSutCommandPlan, HostedSutInventory, HostedSutProcessObservation, VerificationSessionHostedRequest } from "../../../../execution/verification/hosted.ts";
import { encodeVerificationActionData, parseVerificationActionPlan } from '../action/contract/action.ts';
import { parseCiVerificationActionPlanClosure, parseCiVerificationActionProposal, resolveCiVerificationHostedExecutionEnvironment, type CiVerificationActionProposal, type CiVerificationExecutionEnvironment } from '../action/contract/ci.ts';
import { parseVerificationActionProviderStatusReadback, parseVerificationActionProviderStartMarker as parseVerificationActionStartMarkerV2, parseVerificationActionProviderTerminalAnchor as parseVerificationActionTerminalStatusAnchorV2, reduceVerificationActionProviderState, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderStartArtifactName as verificationActionStartMarkerNameV2, type VerificationActionProviderDecision, type VerificationActionProviderStartObservation, type VerificationActionProviderStatusObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchorObservation, type VerificationActionProviderTerminalObservation, type VerificationActionProviderStartMarker as VerificationActionStartMarkerV2 } from '../action/contract/provider.ts';
import { CodexDevelopmentParseVerificationActionTerminalArtifact, CodexDevelopmentVerificationActionCandidateBytesDigest, CodexDevelopmentVerificationDigest, type CodexDevelopmentVerificationActionArtifactProducer, type CodexDevelopmentVerificationActionTerminalArtifact } from './contract/evidence.ts';

import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
} from './contract/revision.ts';

import type { VerificationSessionHostedEnvelope } from "../../../../execution/verification/hosted.ts";
import { parseVerificationSessionHostedRequest, VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA } from "./contract/session-request.ts";
import {
  type CodexDevelopmentGateProcessResult
} from './runtime/ci-orchestration-core.ts';
import {
  type VerificationActionGitHubProviderSnapshot
} from './runtime/verification-action-github-provider.ts';
import type { CodexDevelopmentRetainedHostedSutArchive } from './verification-materialization.ts';

export const VERIFICATION_EVIDENCE_PATH = '.tmp/ci-verification-evidence.json';

export const FORMAL_VERIFICATION_ENV_KEYS = Object.freeze([
  'SEC_SESSION_REVISION', 'SEC_SESSION_PROPOSAL_DIGEST', 'SEC_SCOPE_AUTHORIZATION_REVISION',
  'SEC_SCOPE_AUTHORIZATION_DIGEST',
  'SEC_REVIEW_RECEIPT_DIGEST', 'SEC_MAIN_HEALTH_REVISION', 'SEC_MAIN_HEALTH_DIGEST', 'SEC_TRUST_REVISION',
  'SEC_BASE_TREE_SHA', 'SEC_ACTION_PLAN_DIGEST', 'SEC_REQUIRED_BLOB_CLOSURE_JSON',
  'SEC_EXECUTION_ENVIRONMENT_REVISION'
] as const);

export const FORMAL_HOSTED_ONLY_ENV_KEYS = Object.freeze([
  'SEC_TRUSTED_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA', 'SEC_WORKFLOW_ACTOR_NODE_ID',
  'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'
] as const);

export const FORMAL_TRUSTED_RUNTIME_ONLY_ENV_KEYS = Object.freeze([
  'SEC_TRUSTED_RUNTIME_EXECUTION_ID', 'SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID'
] as const);

export const INVALIDATION_RULES = [
  'exact head SHA or tree SHA changes',
  'current PR base SHA or exact affected base SHA changes',
  'CI contract revision, profile, gate plan, or changed paths change',
  'Work Package manifest path or digest changes',
  'tracked worktree is not clean before and after verification',
  'hosted artifact is missing, expired, or has a mismatched digest'
];

export const CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA =
  'sec-verification-action-resolution-v2' as const;

export const CI_VERIFICATION_ACTION_COORDINATION_SCHEMA =
  'sec-verification-action-coordination-v2' as const;

export const CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA =
  'sec-verification-action-artifact-index-v2' as const;

export const CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA =
  'sec-verification-action-execution-ticket-v2' as const;

export const CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA =
  'sec-verification-action-sandbox-command-plan-v1' as const;

export const CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER =
  '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__';

const HOSTED_SUT_RETAINED_ARCHIVE_CHILD_FD = 3;

export const HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH =
  `/proc/self/fd/${HOSTED_SUT_RETAINED_ARCHIVE_CHILD_FD}` as const;





export type CodexDevelopmentHostedSutSandboxProcess = (
  plan: HostedSutCommandPlan<typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST>,
  retainedArchive?: CodexDevelopmentRetainedHostedSutArchive
) => Promise<HostedSutProcessObservation<import("./runtime/ci-orchestration-core.ts").CodexDevelopmentGateProcessResult>>;

export type CodexDevelopmentHostedActionProposal = CiVerificationActionProposal & Readonly<{
  sessionRequest: VerificationSessionHostedRequest<typeof import("./contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>;
}>;





export type CodexDevelopmentHostedActionArtifactObservation = Readonly<{
  providerObservation: VerificationActionProviderTerminalObservation;
  artifact: CodexDevelopmentVerificationActionTerminalArtifact | null;
}>;

export type CodexDevelopmentHostedActionStartObservation = VerificationActionProviderStartObservation;

export type CodexDevelopmentHostedActionTerminalAnchorObservation =
  VerificationActionProviderTerminalAnchorObservation;

export type CodexDevelopmentHostedActionCoordination = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_COORDINATION_SCHEMA;
  disposition: 'dispatch' | 'waiting' | 'complete' | 'blocked';
  actionPlanDigest: VerificationActionKeyDigest;
  dispatchActionKeys: readonly VerificationActionKeyDigest[];
  terminalActionKeys: readonly VerificationActionKeyDigest[];
  missingActionKeys: readonly VerificationActionKeyDigest[];
  reason: string | null;
  coordinationDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedActionProviderIndex = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA;
  terminalObservations: readonly CodexDevelopmentHostedActionArtifactObservation[];
  startObservations: readonly VerificationActionProviderStartObservation[];
  terminalAnchorObservations: readonly VerificationActionProviderTerminalAnchorObservation[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadback[];
}>;

export function ciActionDigest(value: unknown): VerificationActionKeyDigest {
  return CodexDevelopmentVerificationDigest(value) as VerificationActionKeyDigest;
}

export function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}.`);
  }
  return record;
}

export function CodexDevelopmentReadHostedActionArtifactIndex(input: Readonly<{
  source: string;
}>): Readonly<{
  observations: readonly CodexDevelopmentHostedActionArtifactObservation[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservation[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservation[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadback[];
}> {
  const value = exactObject(JSON.parse(input.source) as unknown, [
    'schema', 'terminalObservations', 'startObservations', 'terminalAnchorObservations',
    'providerStatusReadbacks'
  ], 'Hosted Action artifact index V2');
  if (value.schema !== CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA ||
      !Array.isArray(value.terminalObservations) || !Array.isArray(value.startObservations) ||
      !Array.isArray(value.terminalAnchorObservations) || !Array.isArray(value.providerStatusReadbacks)) {
    throw new Error('Hosted Action artifact index V2 identity is invalid.');
  }
  const observations = Object.freeze(value.terminalObservations.map((entry, index) => {
    const terminal = exactObject(entry, ['providerObservation', 'artifact'],
      'Hosted Action terminal observation[' + index + ']');
    const providerObservation = terminal.providerObservation as VerificationActionProviderTerminalObservation;
    const artifact = terminal.artifact === null
      ? null
      : CodexDevelopmentParseVerificationActionTerminalArtifact(
        encodeVerificationActionData(terminal.artifact)
      );
    if (providerObservation === null || typeof providerObservation !== 'object' ||
        (providerObservation.payload === null) !== (artifact === null)) {
      throw new Error('Hosted Action terminal provider observation/payload mismatch.');
    }
    return Object.freeze({ providerObservation, artifact });
  }));
  const startObservations = Object.freeze(value.startObservations.map((entry) => {
    const observation = entry as VerificationActionProviderStartObservation;
    if (observation !== null && typeof observation === 'object' && observation.payload !== null) {
      parseVerificationActionStartMarkerV2(observation.payload);
    }
    return observation;
  }));
  const terminalAnchorObservations = Object.freeze(value.terminalAnchorObservations.map((entry) => {
    const observation = entry as VerificationActionProviderTerminalAnchorObservation;
    if (observation !== null && typeof observation === 'object' && observation.payload !== null) {
      parseVerificationActionTerminalStatusAnchorV2(observation.payload);
    }
    return observation;
  }));
  const providerStatusReadbacks = Object.freeze(value.providerStatusReadbacks.map((entry) =>
    parseVerificationActionProviderStatusReadback(entry)
  ));
  return Object.freeze({ observations, startObservations, terminalAnchorObservations, providerStatusReadbacks });
}

export function CodexDevelopmentParseHostedActionRequest(
  source: string
): CodexDevelopmentHostedActionProposal {
  const value = parseCiVerificationActionProposal(JSON.parse(source) as unknown);
  const sessionRequest = parseVerificationSessionHostedRequest(
    encodeVerificationActionData(value.sessionRequest)
  );
  return Object.freeze({
    schema: value.schema,
    sessionRequest,
    proposedActionKey: value.proposedActionKey
  });
}

export function parseHostedEnvelope(value: unknown): VerificationSessionHostedEnvelope<typeof import("./contract/session-request.ts").VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA> {
  const envelope = exactObject(value, [
    'schema', 'requestOperationId', 'scopeAuthorization', 'preGateReview', 'mainHealth',
    'session', 'actionPlanClosure', 'envelopeDigest'
  ], 'Hosted Session envelope');
  if (envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA ||
      typeof envelope.envelopeDigest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(envelope.envelopeDigest)) {
    throw new Error('Hosted Session envelope identity is invalid.');
  }
  const { envelopeDigest, ...withoutDigest } = envelope;
  if (envelopeDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted Session envelope digest mismatch.');
  }
  const actionPlanClosure = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(envelope.actionPlanClosure)
  );
  const session = exactObject(envelope.session, [
    'schema', 'sessionId', 'createdAt', 'repository', 'prNumber', 'baseSha', 'baseTreeSha', 'headSha',
    'headTreeSha', 'manifestPath', 'manifestDigest', 'sessionProposalDigest', 'scopeAuthorizationRevision',
    'scopeAuthorizationReceiptDigest', 'actionPlanClosureDigest', 'profile', 'environmentDigest',
    'trustRevision', 'reviewPolicyDigest', 'evidenceRequirementDigest', 'integrationPolicyDigest',
    'mainHealthRef', 'sessionRevision'
  ], 'Hosted Session envelope session');
  if (session.actionPlanClosureDigest !== actionPlanClosure.actionPlanDigest) {
    throw new Error('Hosted Session envelope Action closure mismatch.');
  }
  return Object.freeze({
    ...(envelope as unknown as VerificationSessionHostedEnvelope<typeof import("./contract/session-request.ts").VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>),
    actionPlanClosure
  });
}

export function CodexDevelopmentResolveHostedAction(input: Readonly<{
  request: CodexDevelopmentHostedActionProposal;
  envelope: VerificationSessionHostedEnvelope<typeof import("./contract/session-request.ts").VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
}>): HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA> {
  const request = CodexDevelopmentParseHostedActionRequest(
    encodeVerificationActionData(input.request)
  );
  const envelope = parseHostedEnvelope(input.envelope);
  const sessionRequest = request.sessionRequest;
  const session = envelope.session;
  const requestChecks: readonly [unknown, unknown, string][] = [
    [envelope.requestOperationId, sessionRequest.requestOperationId, 'operation'],
    [session.prNumber, sessionRequest.prNumber, 'PR'],
    [session.baseSha, sessionRequest.expectedBaseSha, 'base'],
    [session.baseTreeSha, sessionRequest.expectedBaseTreeSha, 'base tree'],
    [session.headSha, sessionRequest.expectedHeadSha, 'head'],
    [session.headTreeSha, sessionRequest.expectedHeadTreeSha, 'head tree'],
    [session.manifestPath, sessionRequest.manifestPath, 'manifest path'],
    [session.manifestDigest, sessionRequest.manifestDigest, 'manifest digest'],
    [session.actionPlanClosureDigest, sessionRequest.expectedActionPlanDigest, 'Action closure'],
    [session.sessionRevision, sessionRequest.expectedSessionRevision, 'Session revision']
  ];
  for (const [actual, expected, label] of requestChecks) {
    if (actual !== expected) throw new Error(`Hosted Action request ${label} differs from trusted envelope.`);
  }
  const matches = envelope.actionPlanClosure.actions.filter(
    (candidate) => candidate.action.actionKey === request.proposedActionKey
  );
  if (matches.length !== 1) {
    throw new Error('Hosted Action proposed key is not one exact canonical plan member.');
  }
  const actionPlan = parseVerificationActionPlan(encodeVerificationActionData(matches[0]));
  const executionEnvironment = resolveCiVerificationHostedExecutionEnvironment(actionPlan.action.environment.providerRevision);
  const artifactInput = Object.freeze({
    baseSha: session.baseSha,
    baseTreeSha: session.baseTreeSha,
    headSha: session.headSha,
    headTreeSha: session.headTreeSha,
    manifestPath: session.manifestPath,
    manifestDigest: session.manifestDigest,
    inputClosureDigest: ciActionDigest(actionPlan.action.inputClosure),
    candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigest({
      baseSha: session.baseSha,
      baseTreeSha: session.baseTreeSha,
      headSha: session.headSha,
      headTreeSha: session.headTreeSha,
      manifestPath: session.manifestPath,
      manifestDigest: session.manifestDigest,
      action: actionPlan.action
    })
  }) satisfies HostedActionArtifactInput;
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
    requestDigest: ciActionDigest(request),
    actionKeyHex: actionPlan.action.actionKey.slice('sha256:'.length),
    actionPlan,
    actionPlanClosure: envelope.actionPlanClosure,
    artifactInput,
    executionEnvironment
  });
  return Object.freeze({ ...withoutDigest, resolutionDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentParseHostedActionResolution(
  source: string
): HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA> {
  const value = exactObject(JSON.parse(source) as unknown, [
    'schema', 'requestDigest', 'actionKeyHex', 'actionPlan', 'actionPlanClosure', 'artifactInput',
    'executionEnvironment', 'resolutionDigest'
  ], 'Hosted Action resolution V2');
  if (value.schema !== CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA ||
      typeof value.requestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.requestDigest) ||
      typeof value.resolutionDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.resolutionDigest)) {
    throw new Error('Hosted Action resolution V2 identity is invalid.');
  }
  const actionPlanClosure = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(value.actionPlanClosure)
  );
  const actionPlan = parseVerificationActionPlan(encodeVerificationActionData(value.actionPlan));
  const memberIndex = actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === actionPlan.action.actionKey
  );
  if (memberIndex < 0 || encodeVerificationActionData(actionPlanClosure.actions[memberIndex]) !==
      encodeVerificationActionData(actionPlan)) {
    throw new Error('Hosted Action resolution plan is not one exact closure member.');
  }
  const executionEnvironment = resolveCiVerificationHostedExecutionEnvironment(actionPlan.action.environment.providerRevision);
  if (value.actionKeyHex !== actionPlan.action.actionKey.slice(7) ||
      encodeVerificationActionData(value.executionEnvironment) !==
        encodeVerificationActionData(executionEnvironment)) {
    throw new Error('Hosted Action resolution environment or key projection mismatch.');
  }
  const artifactInput = value.artifactInput as HostedActionArtifactInput;
  if (artifactInput === null || typeof artifactInput !== 'object' ||
      artifactInput.inputClosureDigest !== ciActionDigest(actionPlan.action.inputClosure) ||
      artifactInput.candidateBytesDigest !== CodexDevelopmentVerificationActionCandidateBytesDigest({
        ...artifactInput,
        action: actionPlan.action
      })) {
    throw new Error('Hosted Action resolution candidate byte closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
    requestDigest: value.requestDigest as VerificationActionKeyDigest,
    actionKeyHex: value.actionKeyHex as string,
    actionPlan,
    actionPlanClosure,
    artifactInput,
    executionEnvironment
  });
  if (value.resolutionDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted Action resolution digest mismatch.');
  }
  return Object.freeze({
    ...withoutDigest,
    resolutionDigest: value.resolutionDigest as VerificationActionKeyDigest
  });
}

export function CodexDevelopmentCreateHostedActionExecutionTicket(input: Readonly<{
  resolution: HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>;
  marker: VerificationActionStartMarkerV2;
  startObservation: VerificationActionProviderStartObservation;
  startStatus: VerificationActionProviderStatusObservation;
  preparedCandidateArtifactName: string;
  preparedCandidateInventory: HostedSutInventory;
}>): HostedActionExecutionTicket<import("./contract/evidence.ts").CodexDevelopmentVerificationActionArtifactProducer, typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA> {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const marker = parseVerificationActionStartMarkerV2(input.marker);
  const observation = input.startObservation;
  const expectedName = verificationActionStartMarkerNameV2(resolution.actionPlan.action.actionKey);
  if (marker.actionKey !== resolution.actionPlan.action.actionKey ||
      marker.candidateSha !== resolution.artifactInput.headSha ||
      marker.executionEnvironmentRevision !== resolution.executionEnvironment.executionEnvironmentRevision ||
      observation.expired || observation.payload === null || observation.archiveDigest === null ||
      observation.referencedOrigin === null || observation.artifactName !== expectedName ||
      observation.payload.markerDigest !== marker.markerDigest ||
      encodeVerificationActionData(observation.referencedOrigin) !== encodeVerificationActionData(marker.producer) ||
      input.startStatus.state !== 'pending' || input.startStatus.commitSha !== marker.candidateSha ||
      input.startStatus.context !== verificationActionProviderStatusContext(marker.actionKey) ||
      input.startStatus.description !== verificationActionProviderStartDescription(marker.markerDigest) ||
      encodeVerificationActionData(input.startStatus.referencedOrigin) !== encodeVerificationActionData(marker.producer)) {
    throw new Error('Hosted Action execution ticket does not bind the exact start marker/status/origin.');
  }
  const expectedPreparedArtifactName =
    `sec-verification-action-prepared-v2-${marker.actionKey.slice(7)}-run-${marker.producer.runId}` +
    `-attempt-${marker.producer.runAttempt}`;
  const inventory = input.preparedCandidateInventory;
  if (input.preparedCandidateArtifactName !== expectedPreparedArtifactName ||
      !/^sha256:[0-9a-f]{64}$/u.test(inventory.archiveDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(inventory.inventoryDigest) ||
      !Number.isSafeInteger(inventory.entryCount) || inventory.entryCount < 1 ||
      !Number.isSafeInteger(inventory.totalFileBytes) || inventory.totalFileBytes < 1 ||
      !/^sha256:[0-9a-f]{64}$/u.test(inventory.dependencyClosureDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(inventory.gitBundleDigest)) {
    throw new Error('Hosted Action execution ticket prepared-candidate transport is invalid.');
  }
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA,
    resolutionDigest: resolution.resolutionDigest,
    actionKey: marker.actionKey,
    candidateSha: marker.candidateSha,
    candidateBytesDigest: resolution.artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
    startStatusId: input.startStatus.id,
    startStatusNodeId: input.startStatus.nodeId,
    startMarkerDigest: marker.markerDigest,
    startArtifactOriginId: observation.originId,
    startArtifactName: observation.artifactName,
    startArtifactArchiveDigest: observation.archiveDigest,
    preparedCandidateArtifactName: input.preparedCandidateArtifactName,
    preparedCandidateArchiveDigest: inventory.archiveDigest,
    preparedCandidateInventoryDigest: inventory.inventoryDigest,
    preparedCandidateEntryCount: inventory.entryCount,
    preparedCandidateTotalFileBytes: inventory.totalFileBytes,
    baseDependencyClosureDigest: inventory.dependencyClosureDigest,
    authenticatedGitClosureDigest: inventory.gitBundleDigest,
    producer: marker.producer
  });
  return Object.freeze({ ...withoutDigest, ticketDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentParseHostedActionExecutionTicket(
  source: string
): HostedActionExecutionTicket<import("./contract/evidence.ts").CodexDevelopmentVerificationActionArtifactProducer, typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA> {
  const value = exactObject(JSON.parse(source) as unknown, [
    'schema', 'resolutionDigest', 'actionKey', 'candidateSha', 'candidateBytesDigest',
    'startStatusId', 'startStatusNodeId', 'startMarkerDigest', 'startArtifactOriginId',
    'startArtifactName', 'startArtifactArchiveDigest', 'preparedCandidateArtifactName',
    'preparedCandidateArchiveDigest', 'preparedCandidateInventoryDigest',
    'preparedCandidateEntryCount', 'preparedCandidateTotalFileBytes',
    'baseDependencyClosureDigest', 'authenticatedGitClosureDigest', 'producer', 'ticketDigest'
  ], 'Hosted Action execution ticket V2');
  if (value.schema !== CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA ||
      typeof value.resolutionDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.resolutionDigest) ||
      typeof value.actionKey !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.actionKey) ||
      typeof value.candidateSha !== 'string' || !/^[0-9a-f]{40}$/u.test(value.candidateSha) ||
      typeof value.candidateBytesDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.candidateBytesDigest) ||
      !Number.isSafeInteger(value.startStatusId) || Number(value.startStatusId) < 1 ||
      typeof value.startStatusNodeId !== 'string' || value.startStatusNodeId.length === 0 ||
      typeof value.startMarkerDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.startMarkerDigest) ||
      typeof value.startArtifactOriginId !== 'string' || !/^[1-9][0-9]*$/u.test(value.startArtifactOriginId) ||
      typeof value.startArtifactName !== 'string' ||
      typeof value.startArtifactArchiveDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.startArtifactArchiveDigest) ||
      typeof value.preparedCandidateArtifactName !== 'string' ||
      typeof value.preparedCandidateArchiveDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.preparedCandidateArchiveDigest) ||
      typeof value.preparedCandidateInventoryDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.preparedCandidateInventoryDigest) ||
      !Number.isSafeInteger(value.preparedCandidateEntryCount) || Number(value.preparedCandidateEntryCount) < 1 ||
      !Number.isSafeInteger(value.preparedCandidateTotalFileBytes) ||
        Number(value.preparedCandidateTotalFileBytes) < 1 ||
      typeof value.baseDependencyClosureDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.baseDependencyClosureDigest) ||
      typeof value.authenticatedGitClosureDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.authenticatedGitClosureDigest) ||
      typeof value.ticketDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.ticketDigest)) {
    throw new Error('Hosted Action execution ticket V2 identity is invalid.');
  }
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA,
    resolutionDigest: value.resolutionDigest as VerificationActionKeyDigest,
    actionKey: value.actionKey as VerificationActionKeyDigest,
    candidateSha: value.candidateSha,
    candidateBytesDigest: value.candidateBytesDigest as VerificationActionKeyDigest,
    startStatusId: Number(value.startStatusId),
    startStatusNodeId: value.startStatusNodeId,
    startMarkerDigest: value.startMarkerDigest as VerificationActionKeyDigest,
    startArtifactOriginId: value.startArtifactOriginId,
    startArtifactName: value.startArtifactName,
    startArtifactArchiveDigest: value.startArtifactArchiveDigest as VerificationActionKeyDigest,
    preparedCandidateArtifactName: value.preparedCandidateArtifactName,
    preparedCandidateArchiveDigest: value.preparedCandidateArchiveDigest as VerificationActionKeyDigest,
    preparedCandidateInventoryDigest: value.preparedCandidateInventoryDigest as VerificationActionKeyDigest,
    preparedCandidateEntryCount: Number(value.preparedCandidateEntryCount),
    preparedCandidateTotalFileBytes: Number(value.preparedCandidateTotalFileBytes),
    baseDependencyClosureDigest: value.baseDependencyClosureDigest as VerificationActionKeyDigest,
    authenticatedGitClosureDigest: value.authenticatedGitClosureDigest as VerificationActionKeyDigest,
    producer: value.producer as CodexDevelopmentVerificationActionArtifactProducer
  });
  const expectedPreparedArtifactName =
    `sec-verification-action-prepared-v2-${withoutDigest.actionKey.slice(7)}-run-${withoutDigest.producer.runId}` +
    `-attempt-${withoutDigest.producer.runAttempt}`;
  if (value.startArtifactName !== verificationActionStartMarkerNameV2(withoutDigest.actionKey) ||
      value.preparedCandidateArtifactName !== expectedPreparedArtifactName ||
      value.ticketDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted Action execution ticket V2 digest or artifact name mismatch.');
  }
  return Object.freeze({ ...withoutDigest, ticketDigest: value.ticketDigest as VerificationActionKeyDigest });
}

export function hostedActionProviderIndexFromSnapshot(
  snapshot: VerificationActionGitHubProviderSnapshot
): CodexDevelopmentHostedActionProviderIndex {
  const terminalObservations = snapshot.terminalObservations.map((observation) => {
    const artifact = observation.payload === null
      ? null
      : CodexDevelopmentParseVerificationActionTerminalArtifact(
        encodeVerificationActionData(observation.payload)
      );
    return Object.freeze({
      providerObservation: Object.freeze({
        ...observation,
        payload: artifact === null ? null : Object.freeze({
          actionKey: artifact.actionPlan.action.actionKey,
          candidateSha: artifact.input.headSha,
          payloadDigest: artifact.artifactDigest as VerificationActionKeyDigest,
          producer: artifact.producer
        })
      }),
      artifact
    });
  });
  return Object.freeze({
    schema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA,
    terminalObservations: Object.freeze(terminalObservations),
    startObservations: snapshot.startObservations,
    terminalAnchorObservations: snapshot.terminalAnchorObservations,
    providerStatusReadbacks: Object.freeze([snapshot.statusReadback])
  });
}

export function CodexDevelopmentReduceHostedActionProviderIndex(input: Readonly<{
  resolution: HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>;
  repositoryId: number;
  repository: string;
  index: CodexDevelopmentHostedActionProviderIndex;
}>): VerificationActionProviderDecision {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const actionKey = resolution.actionPlan.action.actionKey;
  const readbacks = input.index.providerStatusReadbacks.filter((entry) => entry.actionKey === actionKey);
  if (readbacks.length !== 1) {
    throw new Error('Hosted Action provider index must contain one exact status readback per ActionKey.');
  }
  return reduceVerificationActionProviderState({
    repositoryId: input.repositoryId,
    repository: input.repository,
    actionKey,
    candidateSha: resolution.artifactInput.headSha,
    executionEnvironmentRevision: resolution.executionEnvironment.executionEnvironmentRevision,
    statusReadback: readbacks[0]!,
    startObservations: input.index.startObservations.filter(
      (entry) => entry.payload?.actionKey === actionKey || entry.artifactName === verificationActionStartMarkerNameV2(actionKey)
    ),
    terminalObservations: input.index.terminalObservations
      .map((entry) => entry.providerObservation)
      .filter((entry) => entry.payload?.actionKey === actionKey ||
        entry.artifactName === verificationActionProviderTerminalArtifactName(actionKey)),
    terminalAnchorObservations: input.index.terminalAnchorObservations.filter(
      (entry) => entry.payload?.actionKey === actionKey ||
        entry.artifactName === verificationActionProviderTerminalAnchorName(actionKey)
    )
  });
}
