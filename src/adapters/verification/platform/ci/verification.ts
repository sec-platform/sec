import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  fstatSync, lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync, writeFileSync
} from 'node:fs';
import path from 'node:path';
import { uniqueSorted } from '../../../../contracts/canonical.ts';
import {
  enableExecutionProgress,
  observeExecutionProgressPhase,
  reportExecutionProgress
} from '../../../../execution/execution-progress.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecProviderSettlementSet,
  compileSecSemanticOperationPlan,
  issueSecNormalDomainReadbackReceipt,
  issueSecNormalOwnerTerminalJoinReceipt,
  issueSecProviderSettlementReceipt,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../../../execution/operation/semantic.ts';

import { CI_VERIFICATION_CONTRACT_REVISION, CI_VERIFICATION_WORKFLOW_PATH } from '../../../../assurance/verification/contract/revision.ts';
import { CodexDevelopmentBuildVerificationGateResult, type VerificationGateResult } from '../../../../assurance/verification/result/contract/result.ts';
import {
  withAuthorityGitReadOperation,
  type AuthorityGitReadOperation
} from '../../../providers/git-read/authority.ts';
import {
  type CodexDevelopmentExactGitBlobReadOptions
} from '../../../providers/git-read/exact-blob.ts';
import {
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  type GitBlobBytes
} from '../../../providers/git-read/runtime/session.ts';
import type { PhysicalWorkspaceSourceSnapshot } from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import { assertSameNoFollowDirectoryIdentity, inspectNoFollowDirectoryChain, scanNoFollowDirectoryTreeInventory, type NoFollowDirectoryTreeInventoryEntry, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertProcessResourceSessionReceipt } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest, type CodexDevelopmentWorkPackageManifest
} from '../../../self-hosting/control/task/contract/work-package.ts';
import { DEV_RUNNER_ENTRYPOINT_PATH } from '../../../self-hosting/development/runner/contract.ts';
import { encodeVerificationActionData, issueProcessVerificationActionTerminalSettlement, issueVerificationActionOwnerTerminalReceipt, isVerificationActionRunnable, parseVerificationActionPlan, type VerificationActionDependencyResolution, type VerificationActionKeyDigest, type VerificationActionPlan } from '../action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationActionParentDispatchPlanArtifactName, ciVerificationActionParentDispatchPlanPayloadDigest, ciVerificationGateStep, ciVerificationNormalizedOperationArgv, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, createCiVerificationLocalExecutionEnvironment, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionPlanClosure, parseCiVerificationActionProposal, parseCiVerificationActionProviderEnvelope, resolveCiVerificationDevRunnerTarget, type CiVerificationActionCandidate, type CiVerificationActionParentActor, type CiVerificationActionParentDispatchPlan, type CiVerificationActionPlanClosure, type CiVerificationActionProposal, type CiVerificationActionProviderEnvelope, type CiVerificationExecutionEnvironment, type CiVerificationGateStep, type CiVerificationProducerGate } from '../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS, CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, createVerificationActionProviderStartMarker as createVerificationActionStartMarkerV2, createVerificationActionProviderTerminalAnchor as createVerificationActionTerminalStatusAnchorV2, parseVerificationActionProviderStatusReadback, parseVerificationActionProviderStartMarker as parseVerificationActionStartMarkerV2, parseVerificationActionProviderTerminalAnchor as parseVerificationActionTerminalStatusAnchorV2, reduceVerificationActionProviderState, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderStartArtifactName as verificationActionStartMarkerNameV2, type VerificationActionProviderDecision, type VerificationActionProviderOrigin, type VerificationActionProviderStartObservation, type VerificationActionProviderStatusObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchorObservation, type VerificationActionProviderTerminalObservation, type VerificationActionProviderStartMarker as VerificationActionStartMarkerV2 } from '../action/contract/provider.ts';
import {
  writeVerificationActionStartMarkerV2Atomic,
  writeVerificationActionTerminalStatusAnchorV2Atomic
} from '../action/journal.ts';
import {
  createVerificationActionRunner,
  type VerificationActionRunner,
  type VerificationActionRunOutcome
} from '../action/runner.ts';
import type { CodexDevelopmentTestImpactSourceProvider } from '../test-impact/runtime/impact.ts';
import type { CodexDevelopmentGitChangedRecord, CodexDevelopmentTestImpactTransitionObservation } from '../test-impact/runtime/transition.ts';
import { CodexDevelopmentAssertTestImpactTransitionSelection } from '../test-impact/runtime/transition.ts';
import {
  aggregateV4Status,
  CodexDevelopmentAssertVerificationActionTerminalArtifact,
  CodexDevelopmentCreateVerificationEvidenceProducer,
  CodexDevelopmentFinalizeVerificationActionTerminalArtifact,
  CodexDevelopmentFinalizeVerificationEvidenceV4,
  CodexDevelopmentParseVerificationActionTerminalArtifact,
  CodexDevelopmentPrepareVerificationEvidenceTarget,
  CodexDevelopmentVerificationActionCandidateBytesDigest,
  CodexDevelopmentVerificationDigest,
  CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic,
  CodexDevelopmentWriteVerificationEvidenceV4Atomic,
  type CodexDevelopmentVerificationActionArtifactInput,
  type CodexDevelopmentVerificationActionArtifactProducer,
  type CodexDevelopmentVerificationActionTerminalArtifact,
  type CodexDevelopmentVerificationEvidenceV4,
  type CodexDevelopmentVerificationGateEvidenceV4
} from './contract/evidence.ts';
import {
  CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
  CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT,
  CodexDevelopmentCreateHostedSutExecutionAuthorization,
  CodexDevelopmentFinalizeHostedActionRawResult,
  CodexDevelopmentHostedSutCandidateEnvironment,
  CodexDevelopmentParseHostedSutSandboxReceipt,
  CodexDevelopmentReduceHostedSutObservation,
  CodexDevelopmentParseHostedActionRawResult as parseHostedActionRawResultContractV2,
  type CodexDevelopmentHostedActionRawResult,
  type CodexDevelopmentHostedSutExecutionAuthorization,
  type CodexDevelopmentHostedSutInventoryClosure,
  type CodexDevelopmentHostedSutSandboxReceipt
} from './contract/hosted-sut-observation.ts';
import {
  assertCiExpectedHead,
  CodexDevelopmentBuildVerificationPlan,
  type CodexDevelopmentVerificationPlan,
  type CodexDevelopmentVerificationPlanProfile
} from './contract/plan.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
  CI_VERIFICATION_SESSION_CONTRACT_REVISION,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from './contract/revision.ts';
import type { VerificationSessionHostedRequest } from './contract/session-request.ts';
import {
  CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT,
  CODEX_DEVELOPMENT_GATE_STDOUT_BYTE_LIMIT,
  CodexDevelopmentChangedFilesFromRecords,
  CodexDevelopmentDefaultChangedPaths,
  CodexDevelopmentDefaultGitRevision,
  CodexDevelopmentDefaultTrackedTreeIsClean,
  CodexDevelopmentExactGitWorkspaceSourceSnapshot,
  CodexDevelopmentFailureTail,
  CodexDevelopmentReadExactGitBlobs,
  CodexDevelopmentRunGateProcess,
  CodexDevelopmentTestImpactSourceProviderFromSnapshot,
  type CodexDevelopmentChangedPathSnapshot,
  type CodexDevelopmentGateProcessResult,
  type CodexDevelopmentGateProcessSettlement
} from './runtime/ci-orchestration-core.ts';
import {
  ensureVerificationActionGitHubProviderTransaction,
  type VerificationActionGitHubProviderSnapshot
} from './runtime/verification-action-github-provider.ts';
import {
  parseVerificationSessionHostedRequest,
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA,
  type VerificationSessionHostedEnvelope
} from './runtime/verification-session-runtime.ts';
export {
  CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  type CodexDevelopmentHostedActionRawResult,
  type CodexDevelopmentHostedSutSandboxReceipt
} from './contract/hosted-sut-observation.ts';

const VERIFICATION_EVIDENCE_PATH = '.tmp/ci-verification-evidence.json';
const FORMAL_VERIFICATION_ENV_KEYS = Object.freeze([
  'SEC_SESSION_REVISION', 'SEC_SESSION_PROPOSAL_DIGEST', 'SEC_SCOPE_AUTHORIZATION_REVISION',
  'SEC_SCOPE_AUTHORIZATION_DIGEST',
  'SEC_REVIEW_RECEIPT_DIGEST', 'SEC_MAIN_HEALTH_REVISION', 'SEC_MAIN_HEALTH_DIGEST', 'SEC_TRUST_REVISION',
  'SEC_BASE_TREE_SHA', 'SEC_ACTION_PLAN_DIGEST', 'SEC_REQUIRED_BLOB_CLOSURE_JSON',
  'SEC_EXECUTION_ENVIRONMENT_REVISION'
] as const);
const FORMAL_HOSTED_ONLY_ENV_KEYS = Object.freeze([
  'SEC_TRUSTED_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA', 'SEC_WORKFLOW_ACTOR_NODE_ID',
  'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'
] as const);
const FORMAL_TRUSTED_RUNTIME_ONLY_ENV_KEYS = Object.freeze([
  'SEC_TRUSTED_RUNTIME_EXECUTION_ID', 'SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID'
] as const);
const INVALIDATION_RULES = [
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

const CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER =
  '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__';
const CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER =
  '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__';
const HOSTED_SUT_RETAINED_ARCHIVE_CHILD_FD = 3;
const HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH =
  `/proc/self/fd/${HOSTED_SUT_RETAINED_ARCHIVE_CHILD_FD}` as const;

export type CodexDevelopmentHostedSutSandboxCommandPlan = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA;
  policyDigest: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST;
  phase: 'capability-self-test' | 'execute' | 'bootstrap-execute' | 'teardown';
  unitName: string;
  command: '/usr/bin/unshare' | '/usr/bin/bash';
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
  planDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutSandboxProcessObservation =
  CodexDevelopmentGateProcessResult & Readonly<{
    commandStarted: boolean;
    stdoutDigest: VerificationActionKeyDigest;
    stderrDigest: VerificationActionKeyDigest;
    stdoutBytesObserved: number;
    stderrBytesObserved: number;
    outputTruncated: boolean;
  }>;

export type CodexDevelopmentHostedSutSandboxProcess = (
  plan: CodexDevelopmentHostedSutSandboxCommandPlan,
  retainedArchive?: CodexDevelopmentRetainedHostedSutArchive
) => Promise<CodexDevelopmentHostedSutSandboxProcessObservation>;

export type CodexDevelopmentHostedActionProposal = CiVerificationActionProposal & Readonly<{
  sessionRequest: VerificationSessionHostedRequest;
}>;

export type CodexDevelopmentHostedActionResolution = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA;
  requestDigest: VerificationActionKeyDigest;
  actionKeyHex: string;
  actionPlan: VerificationActionPlan;
  actionPlanClosure: CiVerificationActionPlanClosure;
  artifactInput: CodexDevelopmentVerificationActionArtifactInput;
  executionEnvironment: typeof CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT;
  resolutionDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedActionExecutionTicket = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA;
  resolutionDigest: VerificationActionKeyDigest;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  candidateBytesDigest: VerificationActionKeyDigest;
  startStatusId: number;
  startStatusNodeId: string;
  startMarkerDigest: VerificationActionKeyDigest;
  startArtifactOriginId: string;
  startArtifactName: string;
  startArtifactArchiveDigest: VerificationActionKeyDigest;
  preparedCandidateArtifactName: string;
  preparedCandidateArchiveDigest: VerificationActionKeyDigest;
  preparedCandidateInventoryDigest: VerificationActionKeyDigest;
  preparedCandidateEntryCount: number;
  preparedCandidateTotalFileBytes: number;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  producer: CodexDevelopmentVerificationActionArtifactProducer;
  ticketDigest: VerificationActionKeyDigest;
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

function ciActionDigest(value: unknown): VerificationActionKeyDigest {
  return CodexDevelopmentVerificationDigest(value) as VerificationActionKeyDigest;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
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

function parseHostedEnvelope(value: unknown): VerificationSessionHostedEnvelope {
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
    ...(envelope as unknown as VerificationSessionHostedEnvelope),
    actionPlanClosure
  });
}

export function CodexDevelopmentResolveHostedAction(input: Readonly<{
  request: CodexDevelopmentHostedActionProposal;
  envelope: VerificationSessionHostedEnvelope;
}>): CodexDevelopmentHostedActionResolution {
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
  if (actionPlan.action.environment.providerRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION) {
    throw new Error('Hosted Action member does not bind the canonical hosted execution environment.');
  }
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
  }) satisfies CodexDevelopmentVerificationActionArtifactInput;
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
    requestDigest: ciActionDigest(request),
    actionKeyHex: actionPlan.action.actionKey.slice('sha256:'.length),
    actionPlan,
    actionPlanClosure: envelope.actionPlanClosure,
    artifactInput,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT
  });
  return Object.freeze({ ...withoutDigest, resolutionDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentParseHostedActionResolution(
  source: string
): CodexDevelopmentHostedActionResolution {
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
  if (value.actionKeyHex !== actionPlan.action.actionKey.slice(7) ||
      actionPlan.action.environment.providerRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION ||
      encodeVerificationActionData(value.executionEnvironment) !==
        encodeVerificationActionData(CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT)) {
    throw new Error('Hosted Action resolution environment or key projection mismatch.');
  }
  const artifactInput = value.artifactInput as CodexDevelopmentVerificationActionArtifactInput;
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
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT
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
  resolution: CodexDevelopmentHostedActionResolution;
  marker: VerificationActionStartMarkerV2;
  startObservation: VerificationActionProviderStartObservation;
  startStatus: VerificationActionProviderStatusObservation;
  preparedCandidateArtifactName: string;
  preparedCandidateInventory: CodexDevelopmentHostedSutInventoryClosure;
}>): CodexDevelopmentHostedActionExecutionTicket {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const marker = parseVerificationActionStartMarkerV2(input.marker);
  const observation = input.startObservation;
  const expectedName = verificationActionStartMarkerNameV2(resolution.actionPlan.action.actionKey);
  if (marker.actionKey !== resolution.actionPlan.action.actionKey ||
      marker.candidateSha !== resolution.artifactInput.headSha ||
      marker.executionEnvironmentRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION ||
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
): CodexDevelopmentHostedActionExecutionTicket {
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

function hostedActionProviderIndexFromSnapshot(
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
  resolution: CodexDevelopmentHostedActionResolution;
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
    executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
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

function hostedActionRepositoryIdentity(): Readonly<{
  repositoryId: number;
  repository: string;
}> {
  const repositoryId = positiveEnvironmentInteger('GITHUB_REPOSITORY_ID');
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error('GITHUB_REPOSITORY must be one exact owner/name identity.');
  }
  return Object.freeze({ repositoryId, repository });
}

function currentHostedActionProducer(): VerificationActionProviderOrigin {
  const identity = hostedActionRepositoryIdentity();
  const runId = process.env.GITHUB_RUN_ID ?? '';
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('GITHUB_RUN_ID must be a positive integer.');
  const runAttempt = positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT');
  const workflowSha = process.env.GITHUB_WORKFLOW_SHA ?? '';
  if (!/^[0-9a-f]{40}$/u.test(workflowSha)) throw new Error('GITHUB_WORKFLOW_SHA must be one full SHA.');
  return Object.freeze({
    ...identity,
    workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${workflowSha}`,
    workflowSha,
    runId,
    runAttempt,
    appId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id,
    appNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.nodeId,
    sourceEvent: 'repository_dispatch' as const
  });
}

function gitCandidateBytes(repositoryRoot: string, args: readonly string[]): Buffer {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Hosted Action candidate Git readback failed: ${String(result.stderr).slice(0, 512)}`);
  }
  return result.stdout;
}

function hostedActionFileDigest(filePath: string): VerificationActionKeyDigest {
  const descriptor = openSync(path.resolve(filePath), 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
  return `sha256:${hash.digest('hex')}`;
}

type CodexDevelopmentRetainedHostedSutArchive = Readonly<{
  fileDescriptor: number;
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}>;

function retainedHostedSutArchiveObservation(fileDescriptor: number): Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}> {
  const before = fstatSync(fileDescriptor, { bigint: true });
  if (!before.isFile() || before.size < 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Hosted SUT retained archive is not one bounded ordinary file.');
  }
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  while (offset < Number(before.size)) {
    const bytes = readSync(
      fileDescriptor,
      buffer,
      0,
      Math.min(buffer.byteLength, Number(before.size) - offset),
      offset
    );
    if (bytes === 0) throw new Error('Hosted SUT retained archive ended before its retained size.');
    hash.update(buffer.subarray(0, bytes));
    offset += bytes;
  }
  const after = fstatSync(fileDescriptor, { bigint: true });
  const identity = (value: typeof before) => Object.freeze({
    device: value.dev.toString(),
    inode: value.ino.toString(),
    mode: value.mode.toString(),
    size: value.size.toString()
  });
  const beforeIdentity = identity(before);
  const afterIdentity = identity(after);
  if (encodeVerificationActionData(beforeIdentity) !== encodeVerificationActionData(afterIdentity)) {
    throw new Error('Hosted SUT retained archive changed while its bytes were observed.');
  }
  return Object.freeze({
    archiveDigest: `sha256:${hash.digest('hex')}`,
    identityDigest: ciActionDigest(beforeIdentity)
  });
}

function retainHostedSutArchive(
  filePath: string,
  expectedDigest: VerificationActionKeyDigest
): CodexDevelopmentRetainedHostedSutArchive {
  const noFollow = process.platform === 'linux' ? fsConstants.O_NOFOLLOW : 0;
  const fileDescriptor = openSync(path.resolve(filePath), fsConstants.O_RDONLY | noFollow);
  try {
    const observed = retainedHostedSutArchiveObservation(fileDescriptor);
    if (observed.archiveDigest !== expectedDigest) {
      throw new Error('Hosted SUT retained archive differs from its authenticated digest.');
    }
    return Object.freeze({ fileDescriptor, ...observed });
  } catch (error) {
    closeSync(fileDescriptor);
    throw error;
  }
}

function assertRetainedHostedSutArchive(
  retained: CodexDevelopmentRetainedHostedSutArchive
): VerificationActionKeyDigest {
  const observed = retainedHostedSutArchiveObservation(retained.fileDescriptor);
  if (observed.archiveDigest !== retained.archiveDigest ||
      observed.identityDigest !== retained.identityDigest) {
    throw new Error('Hosted SUT retained archive changed after authentication.');
  }
  return observed.archiveDigest;
}

/** Verify prepared candidate bytes before the durable start tombstone exists. */
export function CodexDevelopmentAssertPreparedHostedActionCandidate(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  candidateRoot: string;
}>): void {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const gitText = (...args: string[]): string => gitCandidateBytes(candidateRoot, args).toString('utf8').trim();
  if (gitText('rev-parse', 'HEAD') !== resolution.artifactInput.headSha ||
      gitText('rev-parse', 'HEAD^{tree}') !== resolution.artifactInput.headTreeSha ||
      gitText('status', '--porcelain=v1', '--untracked-files=all') !== '') {
    throw new Error('Hosted Action prepared candidate is not the exact clean resolved head/tree.');
  }
  for (const entry of resolution.actionPlan.action.inputClosure) {
    if (entry.path.includes('\\') || entry.path.startsWith('/') || entry.path.split('/').some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )) {
      throw new Error('Hosted Action input closure contains a non-canonical repository path.');
    }
    const absolute = path.resolve(candidateRoot, ...entry.path.split('/'));
    const relative = path.relative(candidateRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !lstatSync(absolute).isFile()) {
      throw new Error(`Hosted Action input closure is not one ordinary candidate file: ${entry.path}.`);
    }
    const trackedBytes = gitCandidateBytes(candidateRoot, ['show', `${resolution.artifactInput.headSha}:${entry.path}`]);
    if (!trackedBytes.equals(readFileSync(absolute))) {
      throw new Error(`Hosted Action prepared candidate input bytes drifted: ${entry.path}.`);
    }
  }
  const manifestSource = readFileSync(
    path.resolve(candidateRoot, ...resolution.artifactInput.manifestPath.split('/')),
    'utf8'
  );
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== resolution.artifactInput.manifestDigest) {
    throw new Error('Hosted Action prepared candidate manifest bytes differ from the trusted resolution.');
  }
}

export type CodexDevelopmentHostedActionArchiveInventory = Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  inventoryDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyClosureDigest: VerificationActionKeyDigest;
  gitBundleDigest: VerificationActionKeyDigest;
}>;

const HOSTED_ACTION_DEPENDENCY_AUTHORITY_PATHS = Object.freeze([
  '.bun-version', 'bun.lock', 'bunfig.toml', 'package.json'
] as const);

export function CodexDevelopmentHostedDependencyMaterializerEnvironment(): NodeJS.ProcessEnv {
  return Object.freeze({
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/sec-hosted-dependency-home',
    TMPDIR: '/tmp/sec-hosted-dependency-tmp',
    LANG: 'C.UTF-8',
    // Cache transport may restore this runner-private path before the trusted
    // materializer runs. Candidate code never sees the host path; every install
    // is driven by the exact trusted-base closure with lifecycle scripts off.
    BUN_INSTALL_CACHE_DIR: '/tmp/sec-hosted-dependency-home/.bun/install/cache',
    CI: '1'
  });
}

function hostedActionDependencyClosure(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  baseSha: string;
}>): Readonly<{
  schema: 'sec-hosted-action-base-dependency-closure-v1';
  baseSha: string;
  authority: readonly Readonly<{ path: string; bytesDigest: string }>[];
  installArgv: readonly string[];
  materializerEnvironment: NodeJS.ProcessEnv;
}> {
  if (!/^[0-9a-f]{40}$/u.test(input.baseSha)) {
    throw new Error('Hosted Action dependency base SHA is invalid.');
  }
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  for (const root of [baseRoot, candidateRoot]) {
    const npmrc = path.resolve(root, '.npmrc');
    try {
      if (lstatSync(npmrc).isFile() || lstatSync(npmrc).isSymbolicLink()) {
        throw new Error('Hosted Action dependency materializer forbids repository .npmrc authority.');
      }
    } catch (error) {
      if (error instanceof Error && !('code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw error;
      }
    }
  }
  const authority = HOSTED_ACTION_DEPENDENCY_AUTHORITY_PATHS.map((relativePath) => {
    const base = path.resolve(baseRoot, ...relativePath.split('/'));
    const candidate = path.resolve(candidateRoot, ...relativePath.split('/'));
    if (!lstatSync(base).isFile() || !lstatSync(candidate).isFile() ||
        realpathSync.native(base) !== base || realpathSync.native(candidate) !== candidate) {
      throw new Error(`Hosted Action dependency authority is not an ordinary file: ${relativePath}.`);
    }
    const baseBytes = readFileSync(base);
    const candidateBytes = readFileSync(candidate);
    if (!baseBytes.equals(candidateBytes)) {
      throw new Error(`Hosted Action candidate dependency authority drifted from exact base: ${relativePath}.`);
    }
    return Object.freeze({
      path: relativePath,
      bytesDigest: `sha256:${createHash('sha256').update(baseBytes).digest('hex')}`
    });
  });
  return Object.freeze({
    schema: 'sec-hosted-action-base-dependency-closure-v1',
    baseSha: input.baseSha,
    authority: Object.freeze(authority),
    installArgv: Object.freeze(['bun', 'install', '--frozen-lockfile', '--ignore-scripts']),
    materializerEnvironment: CodexDevelopmentHostedDependencyMaterializerEnvironment()
  });
}

export function CodexDevelopmentAssertHostedActionDependencyInputsV1(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  baseSha: string;
}>): VerificationActionKeyDigest {
  return ciActionDigest(hostedActionDependencyClosure(input));
}

type HostedActionArchiveInventoryEntry = Readonly<{
  path: string;
  type: 'directory' | 'file' | 'hardlink' | 'symlink';
  linkTarget: string | null;
  size: number;
  mode: number;
  physicalContentDigest: VerificationActionKeyDigest | null;
  contentDigest: VerificationActionKeyDigest | null;
}>;

const HOSTED_ACTION_ARCHIVE_MAX_ENTRIES = 250_000;

function strictPosixDescendant(root: string, candidate: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative);
}

export type CodexDevelopmentHostedDependencyPhysicalSnapshot = Readonly<{
  schema: 'sec-hosted-dependency-physical-snapshot-v1';
  root: PhysicalDirectoryIdentity;
  entries: readonly NoFollowDirectoryTreeInventoryEntry[];
}>;

export type CodexDevelopmentHostedDependencyArchiveProjection = Readonly<{
  schema: 'sec-hosted-dependency-archive-projection-v1';
  entriesObserved: number;
  linksProjected: number;
  sourceSnapshotDigest: VerificationActionKeyDigest;
  archiveProjectionDigest: VerificationActionKeyDigest;
}>;

export function CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(
  dependencyRoot: string
): CodexDevelopmentHostedDependencyPhysicalSnapshot {
  const root = inspectNoFollowDirectoryChain(
    path.resolve(dependencyRoot), 'Hosted dependency physical snapshot root'
  ).target;
  const entries = scanNoFollowDirectoryTreeInventory(root);
  if (entries.length > HOSTED_ACTION_ARCHIVE_MAX_ENTRIES) {
    throw new Error('Hosted dependency tree exceeds the archive entry bound.');
  }
  return Object.freeze({
    schema: 'sec-hosted-dependency-physical-snapshot-v1',
    root,
    entries
  });
}

function dependencyArchiveTarget(
  dependencyRoot: string,
  relativeLinkPath: string,
  rawTarget: string
): string {
  if (!path.posix.isAbsolute(dependencyRoot) || path.posix.normalize(dependencyRoot) !== dependencyRoot ||
      rawTarget === '' || rawTarget.includes('\0') || rawTarget.includes('\\')) {
    throw new Error('Hosted dependency symlink target or root is not canonical POSIX material.');
  }
  const linkPath = path.posix.join(dependencyRoot, relativeLinkPath);
  const lexicalTarget = path.posix.isAbsolute(rawTarget)
    ? path.posix.normalize(rawTarget)
    : path.posix.resolve(path.posix.dirname(linkPath), rawTarget);
  if (!strictPosixDescendant(dependencyRoot, linkPath) ||
      !strictPosixDescendant(dependencyRoot, lexicalTarget)) {
    throw new Error('Hosted dependency symlink escapes the exact dependency root.');
  }
  if (lexicalTarget === linkPath || strictPosixDescendant(lexicalTarget, linkPath)) {
    throw new Error('Hosted dependency symlink targets itself or an ancestor directory.');
  }
  return `node_modules/${path.posix.relative(dependencyRoot, lexicalTarget)}`;
}

/**
 * Proves that archive projection was read from one unchanged physical
 * dependency generation.  The source tree is never rewritten: absolute
 * in-root links are normalized only in the archive header, then every
 * dependency archive entry is compared with the retained pre-read snapshot.
 */
export function CodexDevelopmentAssertHostedDependencyArchiveProjection(input: Readonly<{
  before: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  after: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  archiveEntries: readonly HostedActionArchiveInventoryEntry[];
}>): CodexDevelopmentHostedDependencyArchiveProjection {
  if (input.before.schema !== 'sec-hosted-dependency-physical-snapshot-v1' ||
      input.after.schema !== 'sec-hosted-dependency-physical-snapshot-v1' ||
      JSON.stringify(input.before) !== JSON.stringify(input.after)) {
    throw new Error('Hosted dependency physical generation changed during archive projection.');
  }
  const dependencyRoot = input.before.root.path.split(path.sep).join('/');
  if (!path.posix.isAbsolute(dependencyRoot) || path.posix.normalize(dependencyRoot) !== dependencyRoot) {
    throw new Error('Hosted dependency physical root is not one canonical POSIX path.');
  }
  const sourceByPath = new Map<string, NoFollowDirectoryTreeInventoryEntry>();
  for (const entry of input.before.entries) {
    const canonical = canonicalHostedArchivePath(entry.relativePath, 'dependency snapshot path', false);
    if (canonical === null || canonical !== entry.relativePath || sourceByPath.has(canonical)) {
      throw new Error('Hosted dependency physical snapshot contains a duplicate or noncanonical path.');
    }
    sourceByPath.set(canonical, entry);
  }
  const archivedDependencies = input.archiveEntries.filter(
    (entry) => entry.path === 'node_modules' || entry.path.startsWith('node_modules/')
  );
  const archiveByPath = new Map(archivedDependencies.map((entry) => [entry.path, entry]));
  if (archiveByPath.size !== archivedDependencies.length ||
      archiveByPath.get('node_modules')?.type !== 'directory' ||
      archivedDependencies.length !== input.before.entries.length + 1) {
    throw new Error('Hosted dependency archive projection has a missing, duplicate, or foreign entry.');
  }
  let linksProjected = 0;
  for (const [relativePath, source] of sourceByPath) {
    const archivePath = `node_modules/${relativePath}`;
    const archived = archiveByPath.get(archivePath);
    if (archived === undefined) {
      throw new Error(`Hosted dependency archive omits frozen entry: ${relativePath}.`);
    }
    if (source.kind === 'directory') {
      if (archived.type !== 'directory' || archived.linkTarget !== null ||
          archived.physicalContentDigest !== null) {
        throw new Error(`Hosted dependency archive directory differs from frozen entry: ${relativePath}.`);
      }
      continue;
    }
    if (source.kind === 'file') {
      if ((archived.type !== 'file' && archived.type !== 'hardlink') ||
          source.contentDigest === null || archived.physicalContentDigest !== source.contentDigest ||
          (archived.type === 'file' && archived.size !== source.size)) {
        throw new Error(`Hosted dependency archive file differs from frozen entry: ${relativePath}.`);
      }
      continue;
    }
    const expectedTarget = dependencyArchiveTarget(
      dependencyRoot, relativePath, source.linkTarget ?? ''
    );
    const targetRelativePath = expectedTarget.slice('node_modules/'.length);
    if (archived.type !== 'symlink' || archived.linkTarget !== expectedTarget ||
        archived.physicalContentDigest !== null || !sourceByPath.has(targetRelativePath)) {
      throw new Error(`Hosted dependency archive link differs from frozen entry: ${relativePath}.`);
    }
    linksProjected += 1;
  }
  const sourceSnapshotDigest = ciActionDigest(Object.freeze({
    schema: 'sec-hosted-dependency-physical-generation-v1',
    root: Object.freeze({
      device: input.before.root.device,
      inode: input.before.root.inode,
      objectId: input.before.root.objectId
    }),
    entries: input.before.entries
  }));
  const canonicalArchiveProjection = Object.freeze([...archivedDependencies]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return Object.freeze({
    schema: 'sec-hosted-dependency-archive-projection-v1',
    entriesObserved: input.before.entries.length,
    linksProjected,
    sourceSnapshotDigest,
    archiveProjectionDigest: ciActionDigest(canonicalArchiveProjection)
  });
}

const HOSTED_ACTION_ARCHIVE_MATERIALIZER_SCRIPT = [
  'import os, posixpath, stat, sys, tarfile',
  'candidate_root, dependency_root, output_root, output_name = sys.argv[1:5]',
  'candidate_dev, candidate_ino, dependency_dev, dependency_ino, output_dev, output_ino = sys.argv[5:11]',
  'max_entries, max_bytes = int(sys.argv[11]), int(sys.argv[12])',
  'flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)',
  'candidate_fd = os.open(candidate_root, flags)',
  'dependency_fd = os.open(dependency_root, flags)',
  'output_fd = os.open(output_root, flags)',
  'output_leaf_fd = None',
  'output_identity = None',
  'completed = False',
  'entries = 0',
  'file_bytes = 0',
  'seen = {}',
  'def identity(fd):',
  '  value = os.fstat(fd)',
  '  return str(value.st_dev), str(value.st_ino)',
  'def require_identity(fd, expected_dev, expected_ino, label):',
  '  if identity(fd) != (expected_dev, expected_ino): raise RuntimeError(label + " identity changed")',
  'def tar_info(name, value, kind):',
  '  info = tarfile.TarInfo(name=name)',
  '  info.uid = 0; info.gid = 0; info.uname = ""; info.gname = ""; info.mtime = 0',
  '  info.mode = stat.S_IMODE(value.st_mode); info.type = kind; info.size = 0',
  '  return info',
  'def same_stat(left, right):',
  '  return (left.st_dev, left.st_ino, left.st_mode, left.st_size, left.st_mtime_ns, left.st_ctime_ns) == (right.st_dev, right.st_ino, right.st_mode, right.st_size, right.st_mtime_ns, right.st_ctime_ns)',
  'def normalized_dependency_link(archive_name, raw_target):',
  '  if "\\x00" in raw_target or "\\\\" in raw_target: raise RuntimeError("dependency link is non-POSIX")',
  '  root = dependency_root.rstrip("/")',
  '  if posixpath.isabs(raw_target):',
  '    normalized = posixpath.normpath(raw_target)',
  '    if normalized == root or not normalized.startswith(root + "/"): raise RuntimeError("dependency link escapes exact root")',
  '    target = "node_modules/" + posixpath.relpath(normalized, root)',
  '  else:',
  '    target = posixpath.normpath(posixpath.join(posixpath.dirname(archive_name), raw_target))',
  '    if target == "node_modules" or not target.startswith("node_modules/"): raise RuntimeError("dependency link escapes exact root")',
  '  if target == archive_name or archive_name.startswith(target.rstrip("/") + "/"): raise RuntimeError("dependency link targets itself or ancestor")',
  '  return posixpath.relpath(target, posixpath.dirname(archive_name) or ".") if posixpath.isabs(raw_target) else raw_target',
  'def add_tree(archive, directory_fd, archive_prefix, dependency, top_level):',
  '  global entries, file_bytes, seen',
  '  before_directory = os.fstat(directory_fd)',
  '  for name in sorted(os.listdir(directory_fd)):',
  '    if top_level and not dependency and name in (".git", "node_modules"): continue',
  '    if not name or "/" in name or "\\x00" in name: raise RuntimeError("invalid source leaf")',
  '    entries += 1',
  '    if entries > max_entries: raise RuntimeError("archive entry bound exceeded")',
  '    archive_name = archive_prefix + "/" + name if archive_prefix else name',
  '    observed = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)',
  '    if stat.S_ISDIR(observed.st_mode):',
  '      child = os.open(name, flags, dir_fd=directory_fd)',
  '      try:',
  '        if not same_stat(observed, os.fstat(child)): raise RuntimeError("directory changed before retained traversal")',
  '        archive.addfile(tar_info(archive_name, observed, tarfile.DIRTYPE))',
  '        add_tree(archive, child, archive_name, dependency, False)',
  '        if not same_stat(observed, os.fstat(child)): raise RuntimeError("directory changed during retained traversal")',
  '      finally: os.close(child)',
  '    elif stat.S_ISREG(observed.st_mode):',
  '      leaf = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0), dir_fd=directory_fd)',
  '      try:',
  '        retained = os.fstat(leaf)',
  '        if not same_stat(observed, retained): raise RuntimeError("file changed before retained read")',
  '        key = (retained.st_dev, retained.st_ino)',
  '        if key in seen:',
  '          info = tar_info(archive_name, retained, tarfile.LNKTYPE); info.linkname = seen[key]',
  '          archive.addfile(info)',
  '        else:',
  '          seen[key] = archive_name',
  '          file_bytes += retained.st_size',
  '          if file_bytes > max_bytes: raise RuntimeError("archive file byte bound exceeded")',
  '          info = tar_info(archive_name, retained, tarfile.REGTYPE); info.size = retained.st_size',
  '          with os.fdopen(os.dup(leaf), "rb", closefd=True) as stream: archive.addfile(info, stream)',
  '        if not same_stat(retained, os.fstat(leaf)): raise RuntimeError("file changed during retained read")',
  '      finally: os.close(leaf)',
  '    elif stat.S_ISLNK(observed.st_mode):',
  '      link_fd = os.open(name, os.O_PATH | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0), dir_fd=directory_fd)',
  '      try:',
  '        retained = os.fstat(link_fd)',
  '        if not same_stat(observed, retained): raise RuntimeError("link changed before retained read")',
  '        raw_target = os.readlink("", dir_fd=link_fd)',
  '        info = tar_info(archive_name, retained, tarfile.SYMTYPE)',
  '        info.linkname = normalized_dependency_link(archive_name, raw_target) if dependency else raw_target',
  '        archive.addfile(info)',
  '        if not same_stat(retained, os.fstat(link_fd)) or os.readlink("", dir_fd=link_fd) != raw_target: raise RuntimeError("link changed during retained read")',
  '      finally: os.close(link_fd)',
  '    else: raise RuntimeError("unsupported source entry")',
  '  if not same_stat(before_directory, os.fstat(directory_fd)): raise RuntimeError("directory changed during enumeration")',
  'try:',
  '  require_identity(candidate_fd, candidate_dev, candidate_ino, "candidate root")',
  '  require_identity(dependency_fd, dependency_dev, dependency_ino, "dependency root")',
  '  require_identity(output_fd, output_dev, output_ino, "output root")',
  '  output_leaf_fd = os.open(output_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o600, dir_fd=output_fd)',
  '  output_identity = identity(output_leaf_fd)',
  '  with os.fdopen(output_leaf_fd, "wb", closefd=True) as output_stream:',
  '    output_leaf_fd = None',
  '    with tarfile.open(fileobj=output_stream, mode="w:", format=tarfile.PAX_FORMAT, dereference=False) as archive:',
  '      seen = {}; add_tree(archive, candidate_fd, "", False, True)',
  '      dependency_stat = os.fstat(dependency_fd)',
  '      archive.addfile(tar_info("node_modules", dependency_stat, tarfile.DIRTYPE))',
  '      entries += 1',
  '      if entries > max_entries: raise RuntimeError("archive entry bound exceeded")',
  '      seen = {}; add_tree(archive, dependency_fd, "node_modules", True, True)',
  '    output_stream.flush(); os.fsync(output_stream.fileno())',
  '  os.fsync(output_fd)',
  '  require_identity(candidate_fd, candidate_dev, candidate_ino, "candidate root")',
  '  require_identity(dependency_fd, dependency_dev, dependency_ino, "dependency root")',
  '  require_identity(output_fd, output_dev, output_ino, "output root")',
  '  completed = True',
  'finally:',
  '  if output_leaf_fd is not None: os.close(output_leaf_fd)',
  '  if not completed and output_identity is not None:',
  '    try:',
  '      current = os.stat(output_name, dir_fd=output_fd, follow_symlinks=False)',
  '      if (str(current.st_dev), str(current.st_ino)) == output_identity:',
  '        os.unlink(output_name, dir_fd=output_fd); os.fsync(output_fd)',
  '    except FileNotFoundError: pass',
  '  os.close(output_fd); os.close(dependency_fd); os.close(candidate_fd)'
].join('\n');

export function CodexDevelopmentMaterializeTrustedBootstrapArchive(input: Readonly<{
  candidateRoot: string;
  dependencySnapshot: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  outputDirectory: string;
}>): string {
  if (process.platform !== 'linux') {
    throw new Error('Trusted bootstrap retained archive projection requires the Linux provider.');
  }
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const dependencyRoot = realpathSync.native(path.resolve(input.dependencySnapshot.root.path));
  const outputDirectory = realpathSync.native(path.resolve(input.outputDirectory));
  const candidate = inspectNoFollowDirectoryChain(
    candidateRoot, 'Trusted bootstrap archive candidate root'
  ).target;
  const dependency = assertSameNoFollowDirectoryIdentity(
    input.dependencySnapshot.root, 'Trusted bootstrap archive dependency root'
  ).target;
  const output = inspectNoFollowDirectoryChain(
    outputDirectory, 'Trusted bootstrap archive output root'
  ).target;
  if (dependency.path !== dependencyRoot) {
    throw new Error('Trusted bootstrap archive dependency snapshot root is not canonical.');
  }
  const archiveName = 'prepared-candidate.tar';
  const archivePath = path.resolve(outputDirectory, archiveName);
  if (existsSync(archivePath)) {
    throw new Error('Trusted bootstrap prepared candidate archive already exists.');
  }
  runHostedMaterializerCommand('/usr/bin/python3', [
    '-c', HOSTED_ACTION_ARCHIVE_MATERIALIZER_SCRIPT,
    candidate.path, dependency.path, output.path, archiveName,
    candidate.device, candidate.inode, dependency.device, dependency.inode,
    output.device, output.inode,
    String(HOSTED_ACTION_ARCHIVE_MAX_ENTRIES),
    String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes)
  ], 'Trusted bootstrap retained archive projection');
  assertSameNoFollowDirectoryIdentity(candidate, 'Trusted bootstrap archive candidate root');
  assertSameNoFollowDirectoryIdentity(dependency, 'Trusted bootstrap archive dependency root');
  assertSameNoFollowDirectoryIdentity(output, 'Trusted bootstrap archive output root');
  const archive = lstatSync(archivePath);
  if (!archive.isFile() || archive.isSymbolicLink() || realpathSync.native(archivePath) !== archivePath) {
    throw new Error('Trusted bootstrap retained archive projection did not publish one ordinary output.');
  }
  return archivePath;
}

const HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT = [
  'import hashlib, json, sys, tarfile',
  'result=[]',
  'with tarfile.open(sys.argv[1], mode="r:*") as archive:',
  '  for member in archive.getmembers():',
  '    kind = "file" if member.isreg() else "directory" if member.isdir() else "symlink" if member.issym() else "hardlink" if member.islnk() else "unsupported"',
  '    digest = None; physical_digest = None',
  '    normalized = member.name[2:] if member.name.startswith("./") else member.name',
  '    if member.isreg() or member.islnk():',
  '      stream = archive.extractfile(member)',
  '      hasher = hashlib.sha256(); physical_hasher = hashlib.sha256(); physical_hasher.update(b\'{"bytes":"\')',
  '      while True:',
  '        chunk = stream.read(1048576) if stream is not None else b""',
  '        if not chunk: break',
  '        hasher.update(chunk); physical_hasher.update(chunk.hex().encode("ascii"))',
  '      physical_hasher.update(b\'"}\'); physical_digest = "sha256:" + physical_hasher.hexdigest()',
  '      if member.isreg() and normalized in (".sec-trusted-input/candidate.bundle", ".sec-trusted-input/dependency-closure.json"): digest = "sha256:" + hasher.hexdigest()',
  '    result.append({"path": member.name, "type": kind, "linkTarget": member.linkname if member.issym() or member.islnk() else None, "size": member.size, "mode": member.mode, "physicalContentDigest": physical_digest, "contentDigest": digest})',
  'sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":"), sort_keys=True))'
].join('\n');

function inspectHostedActionArchiveMetadata(archive: string, label: string): unknown {
  const inventory = spawnSync(
    '/usr/bin/python3',
    ['-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT, archive],
    {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
    }
  );
  if (inventory.status !== 0 || typeof inventory.stdout !== 'string') {
    throw new Error(`${label} metadata is unreadable without extraction.`);
  }
  return JSON.parse(inventory.stdout) as unknown;
}

function canonicalHostedArchivePath(source: string, label: string, allowRoot: boolean): string | null {
  if (source.includes('\0') || source.includes('\\') || source.startsWith('/')) {
    throw new Error(`Hosted Action archive ${label} is absolute or non-POSIX.`);
  }
  let value = source;
  while (value.startsWith('./')) value = value.slice(2);
  while (value.endsWith('/')) value = value.slice(0, -1);
  if ((value === '' || value === '.') && allowRoot) return null;
  const segments = value.split('/');
  if (value === '' || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Hosted Action archive ${label} is not canonical.`);
  }
  return value;
}

function resolveHostedArchiveLinkTarget(entryPath: string, target: string, hardlink: boolean): string {
  if (target.includes('\0') || target.includes('\\') || target.startsWith('/')) {
    throw new Error(`Hosted Action archive link target is unsafe: ${entryPath}.`);
  }
  const stack = hardlink ? [] : entryPath.split('/').slice(0, -1);
  let value = target;
  while (value.startsWith('./')) value = value.slice(2);
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) throw new Error(`Hosted Action archive link escapes its root: ${entryPath}.`);
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  if (stack.length === 0) throw new Error(`Hosted Action archive link target is empty: ${entryPath}.`);
  return stack.join('/');
}

export function CodexDevelopmentValidateHostedActionArchiveInventory(
  source: unknown
): Readonly<{
  entries: readonly HostedActionArchiveInventoryEntry[];
  inventoryDigest: VerificationActionKeyDigest;
  totalFileBytes: number;
}> {
  if (!Array.isArray(source) || source.length === 0 || source.length > HOSTED_ACTION_ARCHIVE_MAX_ENTRIES) {
    throw new Error('Hosted Action archive inventory is empty or exceeds its entry bound.');
  }
  const entries: HostedActionArchiveInventoryEntry[] = [];
  const exactPaths = new Set<string>();
  const casePaths = new Map<string, string>();
  for (const raw of source) {
    const value = exactObject(raw, [
      'contentDigest', 'linkTarget', 'mode', 'path', 'physicalContentDigest', 'size', 'type'
    ], 'Hosted Action archive entry');
    if (typeof value.path !== 'string' || typeof value.type !== 'string' ||
        !Number.isSafeInteger(value.size) || Number(value.size) < 0 ||
        !Number.isSafeInteger(value.mode) || Number(value.mode) < 0 || Number(value.mode) > 0o7777 ||
        (value.linkTarget !== null && typeof value.linkTarget !== 'string') ||
        (value.contentDigest !== null && (typeof value.contentDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.contentDigest))) ||
        (value.physicalContentDigest !== null &&
          (typeof value.physicalContentDigest !== 'string' ||
            !/^sha256:[0-9a-f]{64}$/u.test(value.physicalContentDigest)))) {
      throw new Error('Hosted Action archive metadata is invalid.');
    }
    if (!['directory', 'file', 'hardlink', 'symlink'].includes(value.type)) {
      throw new Error(`Hosted Action archive entry type is forbidden: ${value.type}.`);
    }
    const entryPath = canonicalHostedArchivePath(value.path, 'entry path', value.type === 'directory');
    if (entryPath === null) continue;
    if ((Number(value.mode) & 0o6000) !== 0) {
      throw new Error(`Hosted Action archive set-id mode is forbidden: ${entryPath}.`);
    }
    const folded = entryPath.normalize('NFC').toLowerCase();
    const conflict = casePaths.get(folded);
    if (exactPaths.has(entryPath) || (conflict !== undefined && conflict !== entryPath)) {
      throw new Error(`Hosted Action archive contains a duplicate or case-conflicting path: ${entryPath}.`);
    }
    exactPaths.add(entryPath);
    casePaths.set(folded, entryPath);
    const linkTarget = value.type === 'hardlink' || value.type === 'symlink'
      ? resolveHostedArchiveLinkTarget(entryPath, String(value.linkTarget ?? ''), value.type === 'hardlink')
      : null;
    if (linkTarget === null && value.linkTarget !== null) {
      throw new Error(`Hosted Action archive ordinary entry has a link target: ${entryPath}.`);
    }
    if (linkTarget !== null && Number(value.size) !== 0) {
      throw new Error(`Hosted Action archive link has nonzero payload bytes: ${entryPath}.`);
    }
    const trustedContentPath = entryPath === '.sec-trusted-input/candidate.bundle' ||
      entryPath === '.sec-trusted-input/dependency-closure.json';
    const physicalContentEntry = value.type === 'file' || value.type === 'hardlink';
    if ((trustedContentPath && (value.type !== 'file' || value.contentDigest === null)) ||
        (!trustedContentPath && value.contentDigest !== null) ||
        (physicalContentEntry !== (value.physicalContentDigest !== null))) {
      throw new Error(`Hosted Action archive trusted content digest placement is invalid: ${entryPath}.`);
    }
    entries.push(Object.freeze({
      path: entryPath,
      type: value.type as HostedActionArchiveInventoryEntry['type'],
      linkTarget,
      size: Number(value.size),
      mode: Number(value.mode),
      physicalContentDigest: value.physicalContentDigest as VerificationActionKeyDigest | null,
      contentDigest: value.contentDigest as VerificationActionKeyDigest | null
    }));
  }
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    if (entry.linkTarget === null) continue;
    const target = byPath.get(entry.linkTarget);
    if (target === undefined || (entry.type === 'hardlink' && target.type !== 'file' && target.type !== 'hardlink')) {
      throw new Error(`Hosted Action archive link target is absent or has the wrong type: ${entry.path}.`);
    }
    if (entry.type === 'symlink' &&
        (entry.path === target.path || entry.path.startsWith(`${target.path}/`))) {
      throw new Error(`Hosted Action archive symlink targets itself or an ancestor: ${entry.path}.`);
    }
    if (entry.type === 'hardlink' && entry.physicalContentDigest !== target.physicalContentDigest) {
      throw new Error(`Hosted Action archive hardlink content differs from its target: ${entry.path}.`);
    }
    const seen = new Set<string>([entry.path]);
    let cursor: HostedActionArchiveInventoryEntry | undefined = target;
    while (cursor?.linkTarget !== null) {
      if (seen.has(cursor.path)) throw new Error(`Hosted Action archive link cycle is forbidden: ${entry.path}.`);
      seen.add(cursor.path);
      cursor = byPath.get(cursor.linkTarget);
      if (cursor === undefined) throw new Error(`Hosted Action archive link chain is incomplete: ${entry.path}.`);
    }
  }
  const totalFileBytes = entries.reduce((total, entry) => total + (entry.type === 'file' ? entry.size : 0), 0);
  if (!Number.isSafeInteger(totalFileBytes) ||
      totalFileBytes > CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes) {
    throw new Error('Hosted Action archive file bytes exceed the private workspace bound.');
  }
  const canonicalEntries = Object.freeze([...entries].sort((left, right) => left.path.localeCompare(right.path)));
  return Object.freeze({
    entries: canonicalEntries,
    inventoryDigest: ciActionDigest(canonicalEntries),
    totalFileBytes
  });
}

export function CodexDevelopmentInspectHostedActionArchiveInventory(
  archive: string,
  label: string = 'Hosted Action archive inventory'
): ReturnType<typeof CodexDevelopmentValidateHostedActionArchiveInventory> {
  return CodexDevelopmentValidateHostedActionArchiveInventory(
    inspectHostedActionArchiveMetadata(archive, label)
  );
}

export function CodexDevelopmentInspectHostedActionArchive(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  preparedCandidateArchive: string;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  inspectArchive?: (archive: string) => unknown;
}>): CodexDevelopmentHostedActionArchiveInventory {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.baseDependencyClosureDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.authenticatedGitClosureDigest)) {
    throw new Error('Hosted Action archive expected Git or dependency closure digest is invalid.');
  }
  const archive = realpathSync.native(path.resolve(input.preparedCandidateArchive));
  const archiveStat = lstatSync(archive);
  const archiveDigest = hostedActionFileDigest(archive);
  if (!archiveStat.isFile()) {
    throw new Error('Hosted Action prepared candidate archive is not one ordinary file.');
  }
  let rawInventory: unknown;
  if (input.inspectArchive !== undefined) {
    rawInventory = input.inspectArchive(archive);
  } else {
    rawInventory = inspectHostedActionArchiveMetadata(
      archive,
      'Hosted Action prepared candidate archive'
    );
  }
  const validated = CodexDevelopmentValidateHostedActionArchiveInventory(rawInventory);
  for (const required of [
    ...resolution.actionPlan.action.inputClosure.map((entry) => entry.path),
    resolution.artifactInput.manifestPath,
    '.sec-trusted-input/candidate.bundle',
    '.sec-trusted-input/dependency-closure.json'
  ]) {
    const entry = validated.entries.find((candidate) => candidate.path === required);
    if (entry?.type !== 'file') {
      throw new Error(`Hosted Action archive omits one required ordinary input: ${required}.`);
    }
  }
  const gitBundleDigest = validated.entries.find(
    (entry) => entry.path === '.sec-trusted-input/candidate.bundle'
  )?.contentDigest;
  const dependencyClosureDigest = validated.entries.find(
    (entry) => entry.path === '.sec-trusted-input/dependency-closure.json'
  )?.contentDigest;
  if (gitBundleDigest !== input.authenticatedGitClosureDigest ||
      dependencyClosureDigest !== input.baseDependencyClosureDigest) {
    throw new Error('Hosted Action archive Git or dependency closure differs from trusted pre-start inputs.');
  }
  return Object.freeze({
    archiveDigest,
    inventoryDigest: validated.inventoryDigest,
    entryCount: validated.entries.length,
    totalFileBytes: validated.totalFileBytes,
    dependencyClosureDigest,
    gitBundleDigest
  });
}

export type CodexDevelopmentPreparedHostedActionInputs = Readonly<{
  preparedCandidateArchive: string;
  archiveInventory: CodexDevelopmentHostedActionArchiveInventory;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
}>;

function runHostedMaterializerCommand(
  executable: string,
  args: readonly string[],
  label: string,
  options: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv }> = {}
): void {
  const result = spawnSync(executable, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    cwd: options.cwd,
    env: options.env ?? {
      PATH: '/usr/bin:/bin',
      HOME: '/tmp/sec-hosted-materializer-home',
      LANG: 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${String(result.stderr).slice(0, 1024)}`);
  }
}

export type CodexDevelopmentDependencyMaterializationRecovery = Readonly<{
  attempts: 1 | 2;
  recoveredFrom: 'none' | 'bun-tarball-extraction';
}>;

function dependencyMaterializationFailureDiagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2048);
}

function isBunTarballExtractionFailure(error: unknown): boolean {
  const diagnostic = dependencyMaterializationFailureDiagnostic(error);
  return diagnostic.includes('error: Fail extracting tarball for "') &&
    diagnostic.includes('error: Fail extracting tarball from ');
}

export function CodexDevelopmentRunBoundedDependencyMaterialization(
  runExactMaterialization: () => void
): CodexDevelopmentDependencyMaterializationRecovery {
  try {
    runExactMaterialization();
    return Object.freeze({ attempts: 1, recoveredFrom: 'none' as const });
  } catch (firstError) {
    if (!isBunTarballExtractionFailure(firstError)) throw firstError;
    try {
      runExactMaterialization();
      return Object.freeze({ attempts: 2, recoveredFrom: 'bun-tarball-extraction' as const });
    } catch (secondError) {
      const firstDiagnostic = dependencyMaterializationFailureDiagnostic(firstError);
      const secondDiagnostic = dependencyMaterializationFailureDiagnostic(secondError);
      const firstDigest = createHash('sha256').update(firstDiagnostic).digest('hex');
      const secondDigest = createHash('sha256').update(secondDiagnostic).digest('hex');
      throw new Error(
        'Trusted bootstrap exact-base dependency materialization failed after one bounded ' +
        `Bun tarball-extraction recovery retry: first=sha256:${firstDigest} ` +
        `second=sha256:${secondDigest}; ${secondDiagnostic}`
      );
    }
  }
}

export function CodexDevelopmentPrepareHostedActionInputs(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
}>): CodexDevelopmentPreparedHostedActionInputs {
  if (process.platform !== 'linux') {
    throw new Error('Hosted Action input preparation requires the pinned ubuntu-24.04 runner.');
  }
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseHead = gitCandidateBytes(baseRoot, ['rev-parse', 'HEAD']).toString('utf8').trim();
  const baseTree = gitCandidateBytes(baseRoot, ['rev-parse', 'HEAD^{tree}']).toString('utf8').trim();
  if (baseHead !== resolution.artifactInput.baseSha || baseTree !== resolution.artifactInput.baseTreeSha) {
    throw new Error('Hosted Action dependency materializer is not the exact resolved base/tree.');
  }
  CodexDevelopmentAssertPreparedHostedActionCandidate({ resolution, candidateRoot });
  const dependencyClosure = hostedActionDependencyClosure({
    baseRoot,
    candidateRoot,
    baseSha: resolution.artifactInput.baseSha
  });
  const outputDirectory = path.resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  if (!lstatSync(outputDirectory).isDirectory() || realpathSync.native(outputDirectory) !== outputDirectory) {
    throw new Error('Hosted Action prepared transport output is not one ordinary directory.');
  }
  const trustedInputDirectory = path.resolve(candidateRoot, '.sec-trusted-input');
  try {
    lstatSync(trustedInputDirectory);
    throw new Error('Hosted Action candidate collides with the reserved trusted-input directory.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
  }
  mkdirSync(trustedInputDirectory, { recursive: false });
  const dependencyClosurePath = path.resolve(trustedInputDirectory, 'dependency-closure.json');
  writeHostedActionJson(dependencyClosurePath, dependencyClosure);
  const baseDependencyClosureDigest = hostedActionFileDigest(dependencyClosurePath);
  const gitBundlePath = path.resolve(trustedInputDirectory, 'candidate.bundle');
  for (const revision of [resolution.artifactInput.baseSha, resolution.artifactInput.headSha]) {
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'cat-file', '-e', `${revision}^{commit}`],
      `Hosted Action Git object readback ${revision}`
    );
  }
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/base', resolution.artifactInput.baseSha],
    'Hosted Action exact base ref materialization'
  );
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/head', resolution.artifactInput.headSha],
    'Hosted Action exact head ref materialization'
  );
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'create', gitBundlePath, 'refs/sec/base', 'refs/sec/head'],
    'Hosted Action authenticated candidate Git bundle materialization'
  );
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'verify', gitBundlePath],
    'Hosted Action authenticated candidate Git bundle verification'
  );
  const authenticatedGitClosureDigest = hostedActionFileDigest(gitBundlePath);
  const preparedCandidateArchive = path.resolve(outputDirectory, 'prepared-candidate.tar');
  try {
    lstatSync(preparedCandidateArchive);
    throw new Error('Hosted Action prepared candidate archive already exists.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
  }
  runHostedMaterializerCommand('/usr/bin/tar', [
    '--sort=name', '--mtime=UTC 1970-01-01', '--owner=0', '--group=0', '--numeric-owner',
    '--exclude=./.git', '-cf', preparedCandidateArchive, '-C', candidateRoot, '.'
  ], 'Hosted Action raw prepared candidate archive materialization');
  const archiveInventory = CodexDevelopmentInspectHostedActionArchive({
    resolution,
    preparedCandidateArchive,
    baseDependencyClosureDigest,
    authenticatedGitClosureDigest
  });
  return Object.freeze({
    preparedCandidateArchive,
    archiveInventory,
    baseDependencyClosureDigest,
    authenticatedGitClosureDigest
  });
}

export type CodexDevelopmentPreparedTrustedBootstrapSutInputs = Readonly<{
  preparedCandidateArchive: string;
  archiveDigest: VerificationActionKeyDigest;
  archiveInventoryDigest: VerificationActionKeyDigest;
  dependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyMaterialization: CodexDevelopmentDependencyMaterializationRecovery;
  dependencyArchiveProjection: CodexDevelopmentHostedDependencyArchiveProjection;
}>;

export function CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
}>): void {
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseTopLevel = realpathSync.native(gitCandidateBytes(
    baseRoot, ['rev-parse', '--show-toplevel']
  ).toString('utf8').trim());
  const candidateTopLevel = realpathSync.native(gitCandidateBytes(
    candidateRoot, ['rev-parse', '--show-toplevel']
  ).toString('utf8').trim());
  if (baseTopLevel !== baseRoot || candidateTopLevel !== candidateRoot || baseRoot === candidateRoot) {
    throw new Error('Trusted bootstrap SUT materialization requires two exact Git checkout roots.');
  }

  const relativeCandidateRoot = path.relative(baseRoot, candidateRoot);
  const candidateIsContained = relativeCandidateRoot !== '' && relativeCandidateRoot !== '..' &&
    !relativeCandidateRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeCandidateRoot);
  const baseStatusArgs = candidateIsContained
    ? [
        'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching', '--', '.',
        `:(top,exclude,literal)${relativeCandidateRoot.split(path.sep).join('/')}`
      ]
    : ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'];
  if (gitCandidateBytes(baseRoot, baseStatusArgs).length !== 0 ||
      gitCandidateBytes(candidateRoot, [
        'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'
      ]).length !== 0) {
    throw new Error('Trusted bootstrap SUT materialization requires clean base and candidate checkouts.');
  }
}

export function CodexDevelopmentPrepareTrustedBootstrapSutInputs(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
  baseSha: string;
  headSha: string;
  treeSha: string;
}>): CodexDevelopmentPreparedTrustedBootstrapSutInputs {
  if (process.platform !== 'linux' || !/^[0-9a-f]{40}$/u.test(input.baseSha) ||
      !/^[0-9a-f]{40}$/u.test(input.headSha) || !/^[0-9a-f]{40}$/u.test(input.treeSha)) {
    throw new Error('Trusted bootstrap SUT input identity is invalid or unsupported on this host.');
  }
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseHead = gitCandidateBytes(baseRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    .toString('utf8').trim();
  const candidateHead = gitCandidateBytes(candidateRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    .toString('utf8').trim();
  const candidateTree = gitCandidateBytes(candidateRoot, ['rev-parse', '--verify', 'HEAD^{tree}'])
    .toString('utf8').trim();
  const candidateParents = gitCandidateBytes(candidateRoot, ['rev-list', '--parents', '-n', '1', 'HEAD'])
    .toString('utf8').trim().split(/\s+/u);
  if (baseHead !== input.baseSha || candidateHead !== input.headSha || candidateTree !== input.treeSha ||
      candidateParents.length !== 2 || candidateParents[0] !== input.headSha ||
      candidateParents[1] !== input.baseSha) {
    throw new Error('Trusted bootstrap SUT checkouts are not the exact base and single-parent candidate.');
  }
  CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({ baseRoot, candidateRoot });
  const dependencyClosure = hostedActionDependencyClosure({
    baseRoot, candidateRoot, baseSha: input.baseSha
  });
  const materializerEnvironment = CodexDevelopmentHostedDependencyMaterializerEnvironment();
  mkdirSync(materializerEnvironment.BUN_INSTALL_CACHE_DIR!, { recursive: true });
  mkdirSync(materializerEnvironment.HOME!, { recursive: true });
  mkdirSync(materializerEnvironment.TMPDIR!, { recursive: true });
  const dependencyMaterialization = CodexDevelopmentRunBoundedDependencyMaterialization(() => {
    runHostedMaterializerCommand(
      realpathSync.native(process.execPath),
      ['install', '--frozen-lockfile', '--ignore-scripts'],
      'Trusted bootstrap exact-base dependency materialization',
      { cwd: baseRoot, env: materializerEnvironment }
    );
  });
  const baseNodeModules = path.resolve(baseRoot, 'node_modules');
  const candidateNodeModules = path.resolve(candidateRoot, 'node_modules');
  if (!lstatSync(baseNodeModules).isDirectory() || realpathSync.native(baseNodeModules) !== baseNodeModules) {
    throw new Error('Trusted bootstrap exact-base dependency materialization has no ordinary node_modules.');
  }
  const dependencyPhysicalBefore =
    CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(baseNodeModules);
  if (existsSync(candidateNodeModules)) {
    throw new Error('Trusted bootstrap candidate node_modules already exists.');
  }
  const outputDirectory = path.resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  if (!lstatSync(outputDirectory).isDirectory() || realpathSync.native(outputDirectory) !== outputDirectory) {
    throw new Error('Trusted bootstrap transport root is not one ordinary directory.');
  }
  const trustedInputDirectory = path.resolve(candidateRoot, '.sec-trusted-input');
  if (existsSync(trustedInputDirectory)) {
    throw new Error('Trusted bootstrap candidate collides with the reserved trusted-input directory.');
  }
  mkdirSync(trustedInputDirectory, { recursive: false });
  const dependencyClosurePath = path.resolve(trustedInputDirectory, 'dependency-closure.json');
  const gitBundlePath = path.resolve(trustedInputDirectory, 'candidate.bundle');
  const preparedCandidateArchive = path.resolve(outputDirectory, 'prepared-candidate.tar');
  try {
    writeHostedActionJson(dependencyClosurePath, dependencyClosure);
    for (const revision of [input.baseSha, input.headSha]) {
      runHostedMaterializerCommand(
        '/usr/bin/git', ['-C', candidateRoot, 'cat-file', '-e', `${revision}^{commit}`],
        `Trusted bootstrap Git object readback ${revision}`
      );
    }
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/base', input.baseSha],
      'Trusted bootstrap exact base ref materialization'
    );
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/head', input.headSha],
      'Trusted bootstrap exact head ref materialization'
    );
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'create', gitBundlePath, 'refs/sec/base', 'refs/sec/head'],
      'Trusted bootstrap authenticated candidate Git bundle materialization'
    );
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'verify', gitBundlePath],
      'Trusted bootstrap authenticated candidate Git bundle verification'
    );
    const materializedArchive = CodexDevelopmentMaterializeTrustedBootstrapArchive({
      candidateRoot,
      dependencySnapshot: dependencyPhysicalBefore,
      outputDirectory
    });
    if (materializedArchive !== preparedCandidateArchive) {
      throw new Error('Trusted bootstrap retained archive projection returned the wrong output identity.');
    }
    const validated = CodexDevelopmentInspectHostedActionArchiveInventory(
      preparedCandidateArchive,
      'Trusted bootstrap prepared candidate archive inventory'
    );
    const bundleEntry = validated.entries.find(
      (entry) => entry.path === '.sec-trusted-input/candidate.bundle'
    );
    const dependencyEntry = validated.entries.find(
      (entry) => entry.path === '.sec-trusted-input/dependency-closure.json'
    );
    const authenticatedGitClosureDigest = hostedActionFileDigest(gitBundlePath);
    const dependencyClosureDigest = hostedActionFileDigest(dependencyClosurePath);
    if (bundleEntry?.type !== 'file' || bundleEntry.contentDigest !== authenticatedGitClosureDigest ||
        dependencyEntry?.type !== 'file' || dependencyEntry.contentDigest !== dependencyClosureDigest) {
      throw new Error('Trusted bootstrap archive lost its authenticated Git or dependency closure.');
    }
    const dependencyPhysicalAfter =
      CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(baseNodeModules);
    const dependencyArchiveProjection = CodexDevelopmentAssertHostedDependencyArchiveProjection({
      before: dependencyPhysicalBefore,
      after: dependencyPhysicalAfter,
      archiveEntries: validated.entries
    });
    return Object.freeze({
      preparedCandidateArchive,
      archiveDigest: hostedActionFileDigest(preparedCandidateArchive),
      archiveInventoryDigest: validated.inventoryDigest,
      dependencyClosureDigest,
      authenticatedGitClosureDigest,
      entryCount: validated.entries.length,
      totalFileBytes: validated.totalFileBytes,
      dependencyMaterialization,
      dependencyArchiveProjection
    });
  } finally {
    rmSync(trustedInputDirectory, { recursive: true, force: true });
  }
}

export function CodexDevelopmentMaterializeHostedActionCandidate(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  ticket: CodexDevelopmentHostedActionExecutionTicket;
  preparedCandidateArchive: string;
  inspectArchive?: (archive: string) => unknown;
}>): CodexDevelopmentHostedActionArchiveInventory {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    encodeVerificationActionData(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest) {
    throw new Error('Hosted Action execution ticket differs from the trusted resolution.');
  }
  const inspected = CodexDevelopmentInspectHostedActionArchive({
    resolution,
    preparedCandidateArchive: input.preparedCandidateArchive,
    baseDependencyClosureDigest: ticket.baseDependencyClosureDigest,
    authenticatedGitClosureDigest: ticket.authenticatedGitClosureDigest,
    inspectArchive: input.inspectArchive
  });
  if (inspected.archiveDigest !== ticket.preparedCandidateArchiveDigest ||
      inspected.inventoryDigest !== ticket.preparedCandidateInventoryDigest ||
      inspected.entryCount !== ticket.preparedCandidateEntryCount ||
      inspected.totalFileBytes !== ticket.preparedCandidateTotalFileBytes ||
      inspected.dependencyClosureDigest !== ticket.baseDependencyClosureDigest ||
      inspected.gitBundleDigest !== ticket.authenticatedGitClosureDigest) {
    throw new Error('Hosted Action prepared candidate exact inventory differs from the execution ticket.');
  }
  return inspected;
}

const HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES = Object.freeze([
  'SEC_ACTION_PLAN_DIGEST',
  'SEC_AFFECTED_TESTS_BASE',
  'SEC_BASE_TREE_SHA',
  'SEC_BOOTSTRAP_BASE',
  'SEC_BOOTSTRAP_HEAD',
  'SEC_BOOTSTRAP_TREE',
  'SEC_CHANGED_BASE',
  'SEC_MAIN_HEALTH_DIGEST',
  'SEC_MAIN_HEALTH_REVISION',
  'SEC_REQUIRED_BLOB_CLOSURE_JSON',
  'SEC_REVIEW_RECEIPT_DIGEST',
  'SEC_REPOSITORY_AUDIT_DEFAULT_REF',
  'SEC_SCOPE_AUTHORIZATION_DIGEST',
  'SEC_SCOPE_AUTHORIZATION_REVISION',
  'SEC_SESSION_PROPOSAL_DIGEST',
  'SEC_SESSION_REVISION',
  'SEC_TEST_WORKSPACE_NAMESPACE',
  'SEC_TRUST_REVISION',
  'SEC_TRUSTED_WORKFLOW_REF',
  'SEC_WORKFLOW_ACTOR_NODE_ID',
  'SEC_WORK_PACKAGE_MANIFEST_PATH'
] as const);

export function CodexDevelopmentCandidateProcessEnvironment(
  source: NodeJS.ProcessEnv,
  semanticBindings: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    PATH: '/tool/bin:/usr/bin:/bin',
    HOME: '/home/sut',
    TMPDIR: '/tmp',
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    SEC_FORMAL_HOSTED_MODE: '1',
    SEC_EXECUTION_ENVIRONMENT_REVISION: CI_VERIFICATION_HOSTED_PROVIDER_REVISION
  };
  for (const name of HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES) {
    const value = semanticBindings[name] ?? source[name];
    if (value !== undefined) result[name] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

const HOSTED_SUT_RUNTIME_COPY_FUNCTION = Object.freeze([
  'copy_runtime() {',
  '  source="$1"',
  '  destination="$2"',
  '  [ -f "$source" ]',
  '  /usr/bin/install -D -m 0555 -- "$source" "$root$destination"',
  '  while IFS= read -r library; do',
  '    [ -n "$library" ] || continue',
  '    /usr/bin/install -D -m 0555 -- "$library" "$root$library"',
  `  done < <(/usr/bin/ldd "$source" 2>/dev/null | /usr/bin/awk '$2 == "=>" && $3 ~ /^\\// { print $3 } $1 ~ /^\\// { print $1 }' || true)`,
  '}',
  'copy_required_dynamic_dependencies() {',
  '  dependency_source="$1"',
  '  dependency_output="$(/usr/bin/ldd "$dependency_source")"',
  '  if /usr/bin/grep -F "not found" <<< "$dependency_output" >/dev/null; then return 1; fi',
  '  dependency_inventory="$root/tmp/python-extension-dependencies"',
  '  /usr/bin/awk \u0027$2 == "=>" && $3 ~ /^\\// { print $3 } $1 ~ /^\\// { print $1 }\u0027 <<< "$dependency_output" > "$dependency_inventory"',
  '  while IFS= read -r library; do',
  '    [ -n "$library" ] || continue',
  '    /usr/bin/install -D -m 0555 -- "$library" "$root$library"',
  '  done < "$dependency_inventory"',
  '  /usr/bin/rm -- "$dependency_inventory"',
  '}'
] as const);

const HOSTED_SUT_RUNTIME_TOOL_CLOSURE = Object.freeze([
  '# runtime-binary-closure',
  ...HOSTED_SUT_RUNTIME_COPY_FUNCTION,
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries.map(
    (runtimePath) => `copy_runtime ${runtimePath} ${runtimePath}`
  ),
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeDirectories.flatMap((runtimePath) => [
    `mkdir -p "$root${path.posix.dirname(runtimePath)}"`,
    `/usr/bin/cp -a -- ${JSON.stringify(runtimePath)} "$root${runtimePath}"`
  ]),
  'python_extension_inventory="$root/tmp/python-extension-inventory"',
  'python_extension_inventory_sorted="$root/tmp/python-extension-inventory.sorted"',
  `/usr/bin/find ${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory)} -type f -name '*.so' -print0 > "$python_extension_inventory"`,
  '/usr/bin/sort -z "$python_extension_inventory" > "$python_extension_inventory_sorted"',
  'while IFS= read -r -d \u0027\u0027 extension; do copy_required_dynamic_dependencies "$extension"; done < "$python_extension_inventory_sorted"',
  '/usr/bin/rm -- "$python_extension_inventory" "$python_extension_inventory_sorted"',
  'copy_runtime "$bun_host" "/tool/bin/bun"',
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeAliases.map(
    (alias) => `ln -s ${JSON.stringify(alias.target)} "$root${alias.path}"`
  )
]);

const HOSTED_SUT_PYTHON_CAPABILITY_SCRIPT = [
  'import hashlib,html,json,locale,pathlib,platform,re,sys,tempfile,unittest',
  'def normalized_encoding(value):',
  "    return value.lower().replace('_', '-')",
  "if normalized_encoding(sys.getfilesystemencoding()) != 'utf-8':",
  "    raise RuntimeError('filesystem encoding is not UTF-8')",
  "if normalized_encoding(locale.getpreferredencoding(False)) != 'utf-8':",
  "    raise RuntimeError('preferred encoding is not UTF-8')",
  "with tempfile.TemporaryDirectory(dir='/tmp') as temporary_directory:",
  "    probe = pathlib.Path(temporary_directory) / '文档能力.txt'",
  "    expected = 'SEC 中文文档能力'",
  "    probe.write_text(expected, encoding='utf-8')",
  "    if probe.read_text(encoding='utf-8') != expected:",
  "        raise RuntimeError('non-ASCII path/content roundtrip failed')",
  'print(platform.python_version())'
].join('\n');

const HOSTED_SUT_CHROOT_EXECUTION_SCRIPT = [
  'expected_archive_digest="$1"',
  'base_sha="$2"',
  'head_sha="$3"',
  'environment_count="$4"',
  'shift 4',
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 1 ]',
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  '[ "sha256:$(/usr/bin/sha256sum /authenticated-input/prepared-candidate.tar | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  '/usr/bin/tar --extract --file=/authenticated-input/prepared-candidate.tar --directory=/workspace --no-same-owner --no-same-permissions --delay-directory-restore',
  'rm -f /authenticated-input/prepared-candidate.tar',
  'rmdir /authenticated-input',
  '[ -f /workspace/.sec-trusted-input/candidate.bundle ]',
  '/usr/bin/git -C /workspace init --quiet',
  '/usr/bin/git -C /workspace -c protocol.file.allow=always fetch --quiet /workspace/.sec-trusted-input/candidate.bundle refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/base)" = "$base_sha" ]',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/head)" = "$head_sha" ]',
  '/usr/bin/git -C /workspace reset --hard --quiet refs/sec/head',
  'rm -rf -- /workspace/.sec-trusted-input',
  '[ -z "$(/usr/bin/git -C /workspace config --local --get-regexp \u0027^(credential\\.|remote\\.|http\\.|core\\.(worktree|sshCommand)|include)\u0027 || true)" ]',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} /workspace`,
  'cd /workspace',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes} -- /usr/bin/env -i "\${environment[@]}" /tool/bin/bun "$@"`
].join('\n');

const HOSTED_SUT_NAMESPACE_SCRIPT = [
  'unit_name="$1"',
  'candidate_archive="$2"',
  'expected_archive_digest="$3"',
  'bun_host="$4"',
  'base_sha="$5"',
  'head_sha="$6"',
  'environment_count="$7"',
  'shift 7',
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 2 ]',
  '[ "$1" = "bun" ]',
  'shift',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root" >/dev/null 2>&1 || true\u0027 EXIT',
  `mount -t tmpfs -o nodev,nosuid,mode=0755,size=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes} tmpfs "$root"`,
  'mkdir -p "$root/tool/bin" "$root/authenticated-input" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/etc"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE,
  '[ "$candidate_archive" = "/proc/self/fd/3" ]',
  '/usr/bin/cat -- "$candidate_archive" > "$root/authenticated-input/prepared-candidate.tar"',
  '[ "sha256:$(/usr/bin/sha256sum "$root/authenticated-input/prepared-candidate.tar" | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  '/usr/bin/chmod 0400 "$root/authenticated-input/prepared-candidate.tar"',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=' +
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes + ' tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=268435456 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=268435456 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'for device in null zero random urandom; do touch "$root/dev/$device"; mount --bind "/dev/$device" "$root/dev/$device"; mount -o remount,bind,nosuid,noexec "$root/dev/$device"; done',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'printf \u0027sut:x:65532:65532:SEC hosted SUT:/home/sut:/usr/sbin/nologin\\n\u0027 > "$root/etc/passwd"',
  'printf \u0027sut:x:65532:\\n\u0027 > "$root/etc/group"',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} "$root/workspace" "$root/home/sut" "$root/tmp"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuote(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT)} sec-hosted-sut-root "$expected_archive_digest" "$base_sha" "$head_sha" "\${#environment[@]}" "\${environment[@]}" "$@"`
].join('\n');

const TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS = Object.freeze([
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/test-runner.test.ts',
  'tests/contract/ci-contract.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/documentation-authority.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/contract/ci-lanes.test.ts'
] as const);

// This program is frozen in the trusted base CLI and is the only command the
// bootstrap candidate may execute. Child output is streamed into bounded
// digest/tail observations; it never reaches GitHub command files or the host
// runner's inherited stdout directly.
export const CodexDevelopmentTrustedBootstrapSutHarness = [
  '(async () => {',
  'const { createHash } = require("node:crypto");',
  'const CAP = 2097152;',
  'const TAIL = 512;',
  'const required = (name) => process.env[name] ?? (() => { throw new Error(`missing:${name}`); })();',
  'const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;',
  'const results = [];',
  'const collect = async (stream, state, child) => {',
  '  const reader = stream.getReader();',
  '  try {',
  '    for (;;) {',
  '      const { done, value } = await reader.read();',
  '      if (done) break;',
  '      const chunk = Buffer.from(value);',
  '      state.bytes += chunk.byteLength;',
  '      const remaining = Math.max(0, CAP - state.hashed);',
  '      if (remaining > 0) { const retained = chunk.subarray(0, remaining); state.hash.update(retained); state.hashed += retained.byteLength; }',
  '      state.tail = Buffer.concat([state.tail, chunk]).subarray(-TAIL);',
  '      if (state.bytes > CAP && !state.truncated) { state.truncated = true; child.kill(9); }',
  '    }',
  '  } catch (error) {',
  '    try { await reader.cancel(error); } catch {}',
  '    throw error;',
  '  } finally {',
  '    try { reader.releaseLock(); } catch {}',
  '  }',
  '};',
  'const run = async (label, argv) => {',
  '  const child = Bun.spawn(argv, { cwd: "/workspace", env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });',
  '  const stdout = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const stderr = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const exitPromise = child.exited;',
  '  const stdoutCollection = collect(child.stdout, stdout, child);',
  '  const stderrCollection = collect(child.stderr, stderr, child);',
  '  let exitCode;',
  '  try {',
  '    await Promise.all([stdoutCollection, stderrCollection]);',
  '    exitCode = await exitPromise;',
  '  } catch (error) {',
  '    try { child.kill(9); } catch {}',
  '    await Promise.allSettled([stdoutCollection, stderrCollection, exitPromise]);',
  '    throw error;',
  '  }',
  '  const result = { label, argvDigest: digest(JSON.stringify(argv)), exitCode, stdoutDigest: `sha256:${stdout.hash.digest("hex")}`, stderrDigest: `sha256:${stderr.hash.digest("hex")}`, stdoutBytes: stdout.bytes, stderrBytes: stderr.bytes, truncated: stdout.truncated || stderr.truncated, stdoutTail: stdout.tail.toString("utf8"), stderrTail: stderr.tail.toString("utf8") };',
  '  results.push(result);',
  '  return result;',
  '};',
  'const execute = async (label, argv) => { const result = await run(label, argv); if (result.exitCode !== 0 || result.truncated) throw new Error(`${label}:${result.exitCode}:${result.truncated}`); return result; };',
  'const baseSha = required("SEC_BOOTSTRAP_BASE");',
  'const expectedHead = required("SEC_BOOTSTRAP_HEAD");',
  'const expectedTree = required("SEC_BOOTSTRAP_TREE");',
  'let status = "passed";',
  'let diagnostic = null;',
  'let parentSha = null;',
  'try {',
  '  const head = (await execute("identity-head", ["git", "rev-parse", "--verify", "HEAD^{commit}"])).stdoutTail.trim();',
  '  const tree = (await execute("identity-tree", ["git", "rev-parse", "--verify", "HEAD^{tree}"])).stdoutTail.trim();',
  '  const parents = (await execute("identity-parents", ["git", "rev-list", "--parents", "-n", "1", "HEAD"])).stdoutTail.trim().split(/\\s+/u);',
  '  if (head !== expectedHead || tree !== expectedTree || parents.length !== 2 || parents[0] !== expectedHead || parents[1] !== baseSha) throw new Error("candidate-identity");',
  '  parentSha = parents[1];',
  '  await execute("bind-origin-main", ["git", "update-ref", "refs/remotes/origin/main", baseSha]);',
  '  await execute("imports", ["bun", "run", "imports:check"]);',
  '  await execute("docs-doctor", ["bun", "run", "docs:doctor"]);',
  '  await execute("typecheck", ["bun", "run", "typecheck:verified"]);',
  '  await execute("diff-check", ["git", "diff", "--check", `${baseSha}..${expectedHead}`]);',
  `  await execute("focused-tests", ${JSON.stringify([
    'bun', 'test', '--timeout', '180000', ...TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS
  ])});`,
  '  await execute("repository-audit", ["bun", "src/adapters/repository/repository-audit/cli.ts", "--json"]);',
  '  await execute("affected-plan", ["bun", "run", "check:affected", "--plan"]);',
  '  await execute("affected-tests", ["bun", "run", "test:affected"]);',
  '  const worktree = await execute("worktree-readback", ["git", "status", "--porcelain=v1"]);',
  '  if (worktree.stdoutTail.length !== 0) throw new Error("tracked-worktree-not-clean");',
  '} catch (error) { status = "failed"; diagnostic = error instanceof Error ? error.message : String(error); }',
  'const summary = { schema: "sec-trusted-bootstrap-sandbox-summary-v1", baseSha, headSha: expectedHead, treeSha: expectedTree, parentSha, status, diagnostic, results };',
  'process.stdout.write(`${JSON.stringify(summary)}\\n`);',
  'if (status !== "passed") process.exitCode = 1;',
  '})().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: "sec-trusted-bootstrap-sandbox-summary-v1", status: "failed", diagnostic: error instanceof Error ? error.message : String(error), results: [] })}\\n`); process.exitCode = 1; });'
].join('');

export const CodexDevelopmentHostedSutCapabilityAssertion = [
  '(async () => {',
  'const fs = require("node:fs");',
  'const { execFileSync, spawn } = require("node:child_process");',
  'const fail = (message) => { throw new Error(message); };',
  'if (process.getuid() !== 65532 || process.getgid() !== 65532) fail(`uid-gid:${process.getuid()}:${process.getgid()}`);',
  'const status = fs.readFileSync("/proc/self/status", "utf8");',
  'if (!/^CapEff:\\s+0+$/m.test(status) || !/^NoNewPrivs:\\s+1$/m.test(status)) fail("privileges");',
  'try { const parentEnvironment = fs.readFileSync("/proc/1/environ"); if (parentEnvironment.includes(Buffer.from("SEC_HOST_SANDBOX_SENTINEL"))) fail("parent-environment"); } catch (error) { if (error?.code !== "ENOENT" && error?.code !== "EACCES") throw error; }',
  'for (const hidden of ["/.oldroot", "/actions-runner", "/actions-runner/_work/_actions", "/home/runner/work", "/runner/_work", "/run", "/var/run", "/tmp/sec-host-sentinel"]) if (fs.existsSync(hidden)) fail(`host-path:${hidden}`);',
  'const routes = fs.readFileSync("/proc/net/route", "utf8").trim().split(/\\r?\\n/);',
  'if (routes.length > 1) fail("network-route");',
  'const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8");',
  'const mountLines = mounts.trim().split(/\\r?\\n/);',
  'const mountAt = (mountpoint) => mountLines.find((line) => line.split(" ")[4] === mountpoint);',
  'for (const mountpoint of ["/", "/workspace", "/tmp", "/home", "/dev"]) { const line = mountAt(mountpoint); if (!line || !line.includes(" - tmpfs ")) fail(`tmpfs:${mountpoint}`); }',
  'if (mountAt("/usr") || !mountAt("/proc")?.includes(" - proc ")) fail("host-usr-or-proc-mount");',
  `const expectedUsrBin = ${JSON.stringify(Object.freeze([
    ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries.map((entry) => path.posix.basename(entry)),
    'sh'
  ].sort()))};`,
  'const actualUsrBin = fs.readdirSync("/usr/bin").sort();',
  'if (JSON.stringify(actualUsrBin) !== JSON.stringify(expectedUsrBin)) fail("runtime-binary-closure");',
  'if (JSON.stringify(fs.readdirSync("/tool/bin").sort()) !== JSON.stringify(["bun", "node"])) fail("runtime-tool-aliases");',
  'if (!fs.statSync("/usr/lib/git-core").isDirectory()) fail("git-runtime-closure");',
  `if (!fs.statSync(${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory)}).isDirectory()) fail("python-stdlib-closure");`,
  `const pythonVersion = execFileSync(${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.executablePath)}, ["-B", "-c", ${JSON.stringify(HOSTED_SUT_PYTHON_CAPABILITY_SCRIPT)}], { encoding: "utf8" }).trim();`,
  `if (pythonVersion !== ${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.version)}) fail("python-runtime-closure");`,
  'for (const descriptor of fs.readdirSync("/proc/self/fd")) { try { const target = fs.readlinkSync(`/proc/self/fd/${descriptor}`); if (/\\/(?:actions-runner|home\\/runner|runner\\/_work|run|var\\/run|workspace)|\\.oldroot|prepared-candidate\\.tar/u.test(target)) fail(`inherited-fd:${descriptor}`); } catch {} }',
  'const cgroup = JSON.parse(fs.readFileSync("/capability/cgroup.json", "utf8"));',
  'if (cgroup.memoryMax !== "4294967296" || cgroup.pidsMax !== "256" || cgroup.cpuMax !== "200000 100000") fail("cgroup-limits");',
  'const softLimit = (name) => execFileSync("/usr/bin/prlimit", ["--pid", String(process.pid), `--${name}`, "--noheadings", "--output", "SOFT"], { encoding: "utf8" }).trim();',
  `if (softLimit("cpu") !== "${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds}" || softLimit("as") !== "4294967296" || softLimit("fsize") !== "268435456" || softLimit("nofile") !== "1024" || softLimit("nproc") !== "256") fail("prlimit-limits");`,
  'let connected = false;',
  'try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(200) }); connected = true; } catch {}',
  'if (connected) fail("network-egress");',
  'const descendant = spawn("/usr/bin/sleep", ["300"], { detached: true, stdio: "ignore" });',
  'descendant.unref();',
  `process.stdout.write("${CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER}\\n");`,
  '})().catch((error) => { console.error(error); process.exitCode = 1; });'
].join('');

const HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT = [
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes} -- /usr/bin/env -i PATH=/tool/bin:/usr/bin:/bin HOME=/home/sut TMPDIR=/tmp LANG=C /tool/bin/bun -e ${shellSingleQuote(CodexDevelopmentHostedSutCapabilityAssertion)}`
].join('\n');

const HOSTED_SUT_CAPABILITY_SCRIPT = [
  'unit_name="$1"',
  'bun_host="$2"',
  'export SEC_HOST_SANDBOX_SENTINEL=must-not-cross-boundary',
  'touch /tmp/sec-host-sentinel',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root" >/dev/null 2>&1 || true; rm -f -- /tmp/sec-host-sentinel\u0027 EXIT',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=268435456 tmpfs "$root"',
  'mkdir -p "$root/tool/bin" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/capability"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE,
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=67108864 tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=16777216 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'for device in null zero random urandom; do touch "$root/dev/$device"; mount --bind "/dev/$device" "$root/dev/$device"; mount -o remount,bind,nosuid,noexec "$root/dev/$device"; done',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'cgroup_path="$(/usr/bin/awk -F: \u0027$1 == "0" { print $3 }\u0027 /proc/self/cgroup)"',
  'memory_max="$(cat "/sys/fs/cgroup${cgroup_path}/memory.max")"',
  'pids_max="$(cat "/sys/fs/cgroup${cgroup_path}/pids.max")"',
  'cpu_max="$(cat "/sys/fs/cgroup${cgroup_path}/cpu.max")"',
  'printf \u0027{"cpuMax":"%s","memoryMax":"%s","pidsMax":"%s"}\\n\u0027 "$cpu_max" "$memory_max" "$pids_max" > "$root/capability/cgroup.json"',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} "$root/home/sut" "$root/tmp" "$root/workspace"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuote(HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT)} sec-hosted-capability-root`
].join('\n');

const HOSTED_SUT_TEARDOWN_SCRIPT = [
  'unit_name="$1"',
  'root="/tmp/$unit_name"',
  'if [ -e "$root" ]; then [ -d "$root" ] && [ ! -L "$root" ]; rmdir -- "$root"; fi',
  '[ ! -e "$root" ]',
  'rm -f -- /tmp/sec-host-sentinel',
  `printf \u0027${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER}:direct-process-closed\\n\u0027`
].join('\n');

function hostedSutSandboxUnitName(actionKey: VerificationActionKeyDigest, nonce: string): string {
  if (!/^[A-Za-z0-9_.-]{1,32}$/u.test(nonce)) {
    throw new Error('Hosted SUT sandbox unit nonce is invalid.');
  }
  return `sec-sut-${actionKey.slice('sha256:'.length, 'sha256:'.length + 16)}-${nonce}`;
}

function finalizeHostedSutSandboxCommandPlan(input: Readonly<{
  phase: CodexDevelopmentHostedSutSandboxCommandPlan['phase'];
  command: CodexDevelopmentHostedSutSandboxCommandPlan['command'];
  unitName: string;
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(input.unitName) ||
      input.argv.length === 0 || input.argv.some((entry) => typeof entry !== 'string' || entry.includes('\0'))) {
    throw new Error('Hosted SUT sandbox command plan identity is invalid.');
  }
  const candidateEnvironmentNames = Object.freeze([...input.candidateEnvironmentNames].sort());
  if (new Set(candidateEnvironmentNames).size !== candidateEnvironmentNames.length ||
      candidateEnvironmentNames.some((name) => !/^[A-Z][A-Z0-9_]*$/u.test(name))) {
    throw new Error('Hosted SUT sandbox candidate environment allowlist is invalid.');
  }
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    phase: input.phase,
    unitName: input.unitName,
    command: input.command,
    argv: Object.freeze([...input.argv]),
    candidateEnvironmentNames,
    executionAuthorizationDigest: input.executionAuthorizationDigest,
    physicalCommandProjectionDigest: input.physicalCommandProjectionDigest
  });
  return Object.freeze({ ...withoutDigest, planDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentAssertHostedSutSandboxCommandPlan(
  plan: CodexDevelopmentHostedSutSandboxCommandPlan
): void {
  const value = exactObject(plan, [
    'schema', 'policyDigest', 'phase', 'unitName', 'command', 'argv',
    'candidateEnvironmentNames', 'executionAuthorizationDigest',
    'physicalCommandProjectionDigest', 'planDigest'
  ], 'Hosted SUT sandbox command plan V1');
  const phase = String(value.phase);
  const commandMatchesPhase = phase === 'teardown'
    ? value.command === '/usr/bin/bash'
    : value.command === '/usr/bin/unshare';
  if (value.schema !== CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA ||
      value.policyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      !commandMatchesPhase ||
      !['capability-self-test', 'execute', 'bootstrap-execute', 'teardown'].includes(phase) ||
      typeof value.unitName !== 'string' ||
      !/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(value.unitName) ||
      !Array.isArray(value.argv) || value.argv.some((entry) => typeof entry !== 'string') ||
      !Array.isArray(value.candidateEnvironmentNames) ||
      value.candidateEnvironmentNames.some((entry) => typeof entry !== 'string') ||
      (value.executionAuthorizationDigest !== null &&
        (typeof value.executionAuthorizationDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.executionAuthorizationDigest))) ||
      (value.physicalCommandProjectionDigest !== null &&
        (typeof value.physicalCommandProjectionDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.physicalCommandProjectionDigest))) ||
      typeof value.planDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.planDigest)) {
    throw new Error('Hosted SUT sandbox command plan identity is invalid.');
  }
  const { planDigest, ...withoutDigest } = value;
  if (planDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted SUT sandbox command plan digest mismatch.');
  }
  if (value.phase === 'execute' || value.phase === 'bootstrap-execute') {
    if (value.phase === 'execute' &&
        (value.executionAuthorizationDigest === null || value.physicalCommandProjectionDigest === null)) {
      throw new Error('Hosted SUT execution command plan is not bound to its authorization.');
    }
    if (value.phase === 'bootstrap-execute' &&
        (value.executionAuthorizationDigest !== null || value.physicalCommandProjectionDigest !== null)) {
      throw new Error('Trusted bootstrap SUT command plan cannot claim Action authorization.');
    }
    const encoded = encodeVerificationActionData(value.argv);
    for (const invariant of [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/sbin/chroot', 'mount -t proc', '--no-new-privs', '--bounding-set=-all',
      '/usr/bin/env -i', '/authenticated-input/prepared-candidate.tar',
      HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, '/usr/bin/sha256sum',
      '/usr/bin/cat --', '$candidate_archive',
      'copy_runtime /usr/bin/bash /usr/bin/bash',
      'copy_runtime /usr/bin/tar /usr/bin/tar',
      'runtime-binary-closure'
    ]) {
      if (!encoded.includes(invariant)) throw new Error(`Hosted SUT sandbox command plan omits ${invariant}.`);
    }
    for (const forbidden of [
      'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_STEP_SUMMARY', 'ACTIONS_RUNTIME_TOKEN',
      '/var/run/docker.sock', '/run/docker.sock', '${RUNNER_TEMP}', 'mount --bind /usr',
      '/usr/bin/sudo', '/usr/bin/systemd-run'
    ]) {
      if (encoded.includes(forbidden)) throw new Error(`Hosted SUT sandbox command plan exposes ${forbidden}.`);
    }
  } else if (value.phase === 'capability-self-test') {
    if ((value.executionAuthorizationDigest === null) !==
        (value.physicalCommandProjectionDigest === null)) {
      throw new Error('Hosted SUT capability command plan has a partial authorization binding.');
    }
  } else if (value.executionAuthorizationDigest !== null || value.physicalCommandProjectionDigest !== null) {
    throw new Error('Hosted SUT auxiliary command plan cannot claim candidate authorization.');
  }
}

export function CodexDevelopmentBuildHostedSutSandboxCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  normalizedArgv: readonly string[];
  candidateEnvironment: NodeJS.ProcessEnv;
  executionAuthorization: CodexDevelopmentHostedSutExecutionAuthorization;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.actionKey) || input.normalizedArgv[0] !== 'bun' ||
      input.normalizedArgv.length < 2 || !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) || !/^[0-9a-f]{40}$/u.test(input.baseSha) ||
      !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Hosted SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const names = environment.map(([name]) => name);
  const environmentProjection = environment.map(([name, value]) => Object.freeze({
    name,
    valueDigest: ciActionDigest(value)
  }));
  const authorization = input.executionAuthorization;
  const { authorizationDigest, ...authorizationWithoutDigest } = authorization;
  const { projectionDigest, ...physicalCommandWithoutDigest } = authorization.physicalCommand;
  const expectedUnitName = `sec-sut-${authorization.actionKey.slice(7, 23)}-${authorization.ticketDigest.slice(7, 23)}`;
  if (authorization.schema !== CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA ||
      authorizationDigest !== ciActionDigest(authorizationWithoutDigest) ||
      authorization.actionKey !== input.actionKey ||
      authorization.physicalCommand.actionKey !== input.actionKey ||
      authorization.physicalCommand.schema !== CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA ||
      projectionDigest !== ciActionDigest(physicalCommandWithoutDigest) ||
      authorization.physicalCommand.operationSemanticDigest !== authorization.operationSemanticDigest ||
      authorization.physicalCommand.unitName !== expectedUnitName ||
      input.baseSha !== authorization.providerOrigin.workflowSha ||
      input.headSha !== authorization.candidateSha ||
      authorization.physicalCommand.canonicalArgvDigest !== ciActionDigest(input.normalizedArgv) ||
      authorization.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      authorization.physicalCommand.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      authorization.physicalCommand.providerRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION ||
      encodeVerificationActionData(authorization.normalizedArgv) !==
        encodeVerificationActionData(input.normalizedArgv) ||
      encodeVerificationActionData(authorization.physicalCommand.fixedSandboxEnvironment) !==
        encodeVerificationActionData(environmentProjection)) {
    throw new Error('Hosted SUT physical command differs from its Action-bound execution authorization.');
  }
  const unitName = authorization.physicalCommand.unitName;
  const plan = finalizeHostedSutSandboxCommandPlan({
    phase: 'execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: names,
    executionAuthorizationDigest: authorization.authorizationDigest,
    physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_NAMESPACE_SCRIPT, 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`), ...input.normalizedArgv
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  return plan;
}

export function CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan(input: Readonly<{
  bootstrapDigest: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  candidateEnvironment: NodeJS.ProcessEnv;
  unitNonce: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.bootstrapDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) ||
      !/^[0-9a-f]{40}$/u.test(input.baseSha) || !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Trusted bootstrap SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const unitName = hostedSutSandboxUnitName(input.bootstrapDigest, input.unitNonce);
  const plan = finalizeHostedSutSandboxCommandPlan({
    phase: 'bootstrap-execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: environment.map(([name]) => name),
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_NAMESPACE_SCRIPT, 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`),
      'bun', '-e', CodexDevelopmentTrustedBootstrapSutHarness
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  return plan;
}

function hostedSutCapabilityCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  bunExecutable: string;
  unitNonce: string;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorization;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (input.executionAuthorization !== undefined &&
      input.executionAuthorization.actionKey !== input.actionKey) {
    throw new Error('Hosted SUT capability plan authorization differs from its ActionKey.');
  }
  const unitName = input.executionAuthorization?.physicalCommand.unitName ??
    hostedSutSandboxUnitName(input.actionKey, input.unitNonce);
  return finalizeHostedSutSandboxCommandPlan({
    phase: 'capability-self-test',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: input.executionAuthorization?.authorizationDigest ?? null,
    physicalCommandProjectionDigest: input.executionAuthorization?.physicalCommand.projectionDigest ?? null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_CAPABILITY_SCRIPT, 'sec-hosted-capability',
      unitName, input.bunExecutable
    ]
  });
}

function hostedSutTeardownCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  unitName: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  return finalizeHostedSutSandboxCommandPlan({
    phase: 'teardown',
    command: '/usr/bin/bash',
    unitName: input.unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '-ceu', HOSTED_SUT_TEARDOWN_SCRIPT, 'sec-hosted-teardown', input.unitName
    ]
  });
}

function defaultHostedSutSandboxProcess(
  plan: CodexDevelopmentHostedSutSandboxCommandPlan,
  retainedArchive?: CodexDevelopmentRetainedHostedSutArchive
): Promise<CodexDevelopmentHostedSutSandboxProcessObservation> {
  const consumesArchive = plan.phase === 'execute' || plan.phase === 'bootstrap-execute';
  if (consumesArchive !== (retainedArchive !== undefined)) {
    throw new Error('Hosted SUT process has a missing or extraneous retained archive descriptor.');
  }
  if (retainedArchive !== undefined) {
    assertRetainedHostedSutArchive(retainedArchive);
    if (plan.argv.filter((entry) => entry === HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH).length !== 1 ||
        plan.argv.filter((entry) => entry === retainedArchive.archiveDigest).length !== 1) {
      throw new Error('Hosted SUT process plan differs from its retained archive binding.');
    }
  }
  const outputByteLimit = CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT;
  const tailByteLimit = 64 * 1024;
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.argv, {
      cwd: process.cwd(),
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      stdio: retainedArchive === undefined
        ? ['ignore', 'pipe', 'pipe']
        : ['ignore', 'pipe', 'pipe', retainedArchive.fileDescriptor],
      windowsHide: true
    });
    const streams = {
      stdout: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) },
      stderr: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) }
    };
    let outputTruncated = false;
    let wallTimedOut = false;
    let commandStarted = false;
    let settled = false;
    let wallTimer: ReturnType<typeof setTimeout> | null = null;
    const observe = (kind: 'stdout' | 'stderr', chunk: Buffer): void => {
      const stream = streams[kind];
      stream.bytes += chunk.byteLength;
      const remaining = Math.max(0, outputByteLimit - stream.hashed);
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining);
        stream.hash.update(retained);
        stream.hashed += retained.byteLength;
      }
      const tail = Buffer.concat([stream.tail, chunk]);
      stream.tail = tail.subarray(Math.max(0, tail.byteLength - tailByteLimit));
      if (stream.bytes > outputByteLimit && !outputTruncated) {
        outputTruncated = true;
        child.kill('SIGKILL');
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => observe('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => observe('stderr', chunk));
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (wallTimer !== null) clearTimeout(wallTimer);
      const stdoutDigest = `sha256:${streams.stdout.hash.digest('hex')}` as VerificationActionKeyDigest;
      const stderrDigest = `sha256:${streams.stderr.hash.digest('hex')}` as VerificationActionKeyDigest;
      const failureTail = wallTimedOut
        ? 'Hosted SUT exceeded the trusted wall-clock bound and the unshare process was terminated.'
        : outputTruncated
        ? 'Hosted SUT stdout/stderr exceeded the trusted capture bound and the whole unit was terminated.'
        : [streams.stdout.tail.toString('utf8'), streams.stderr.tail.toString('utf8')]
            .filter((entry) => entry.length > 0).join('\n').trim();
      const outputProjection = Object.freeze({
        stdoutDigest, stderrDigest,
        stdoutBytesObserved: streams.stdout.bytes,
        stderrBytesObserved: streams.stderr.bytes,
        outputTruncated,
        commandStarted
      });
      resolve(Object.freeze({
        code: wallTimedOut ? 124 : outputTruncated ? 125 : code,
        rawOutputDigest: ciActionDigest({ ...outputProjection, wallTimedOut }),
        failureTail,
        ...outputProjection
      }));
    };
    child.on('spawn', () => { commandStarted = true; });
    child.on('error', (error) => {
      observe('stderr', Buffer.from(error instanceof Error ? error.message : String(error)));
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
    wallTimer = setTimeout(() => {
      if (settled) return;
      wallTimedOut = true;
      child.kill('SIGKILL');
    }, CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds * 1_000);
    wallTimer.unref();
  });
}

function syntheticHostedSutSandboxProcessObservation(
  code: number,
  diagnostic: string
): CodexDevelopmentHostedSutSandboxProcessObservation {
  const stdoutDigest = ciActionDigest('');
  const stderrDigest = ciActionDigest(diagnostic);
  return Object.freeze({
    code,
    rawOutputDigest: ciActionDigest({ stdoutDigest, stderrDigest, diagnostic }),
    failureTail: diagnostic,
    stdoutDigest,
    stderrDigest,
    stdoutBytesObserved: 0,
    stderrBytesObserved: Buffer.byteLength(diagnostic, 'utf8'),
    outputTruncated: false,
    commandStarted: false
  });
}

const TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES = Object.freeze([
  ['tcb-lock-pre.json', 'tcb-lock-pre'],
  ['imports.log', 'imports'],
  ['docs-doctor.log', 'docs-doctor'],
  ['typecheck.log', 'typecheck'],
  ['diff-check.log', 'diff-check'],
  ['focused-tests.log', 'focused-tests'],
  ['repository-audit.json', 'repository-audit'],
  ['affected-plan.json', 'affected-plan'],
  ['affected-tests.log', 'affected-tests'],
  ['tcb-lock-post.json', 'tcb-lock-post']
] as const);

export async function CodexDevelopmentExecuteTrustedBootstrapSut(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
  baseSha: string;
  headSha: string;
  treeSha: string;
  manifestPath: string;
}>): Promise<Readonly<{
  status: 'passed' | 'failed';
  bootstrapDigest: VerificationActionKeyDigest;
  receiptDigest: VerificationActionKeyDigest;
}>> {
  if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]{1,1024}$/u.test(input.manifestPath)) {
    throw new Error('Trusted bootstrap SUT manifest path is invalid.');
  }
  const outputDirectory = path.resolve(input.outputDirectory);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length !== 0) {
    throw new Error('Trusted bootstrap SUT evidence root must begin empty.');
  }
  mkdirSync(outputDirectory, { recursive: true });
  const transportDirectory = path.resolve(outputDirectory, '.transport');
  const candidateNodeModules = path.resolve(input.candidateRoot, 'node_modules');
  let prepared: CodexDevelopmentPreparedTrustedBootstrapSutInputs | null = null;
  let retainedArchive: CodexDevelopmentRetainedHostedSutArchive | null = null;
  try {
    prepared = CodexDevelopmentPrepareTrustedBootstrapSutInputs({
      baseRoot: input.baseRoot,
      candidateRoot: input.candidateRoot,
      outputDirectory: transportDirectory,
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha
    });
    const bootstrapDigest = ciActionDigest(Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-operation-v1',
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha,
      manifestPath: input.manifestPath,
      archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      dependencyMaterialization: prepared.dependencyMaterialization,
      dependencyArchiveProjection: prepared.dependencyArchiveProjection,
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
    }));
    const candidateEnvironment = CodexDevelopmentCandidateProcessEnvironment({}, {
      SEC_BOOTSTRAP_BASE: input.baseSha,
      SEC_BOOTSTRAP_HEAD: input.headSha,
      SEC_BOOTSTRAP_TREE: input.treeSha,
      SEC_CHANGED_BASE: input.baseSha,
      SEC_AFFECTED_TESTS_BASE: input.baseSha,
      SEC_REPOSITORY_AUDIT_DEFAULT_REF: input.baseSha,
      SEC_WORK_PACKAGE_MANIFEST_PATH: input.manifestPath
    });
    const capability = await CodexDevelopmentProbeHostedSutSandboxCapability({
      actionKey: bootstrapDigest
    });
    let commandPlan: CodexDevelopmentHostedSutSandboxCommandPlan | null = null;
    let execution = syntheticHostedSutSandboxProcessObservation(
      1, capability.diagnostic ?? `sandbox-capability:${capability.state}`
    );
    let teardown = syntheticHostedSutSandboxProcessObservation(1, 'sandbox-not-started');
    let retainedArchiveStable = false;
    if (capability.state === 'supported') {
      retainedArchive = retainHostedSutArchive(
        prepared.preparedCandidateArchive,
        prepared.archiveDigest
      );
      commandPlan = CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan({
        bootstrapDigest,
        candidateArchiveDigest: retainedArchive.archiveDigest,
        bunExecutable: realpathSync.native(process.execPath),
        baseSha: input.baseSha,
        headSha: input.headSha,
        candidateEnvironment,
        unitNonce: `${process.pid}-${Date.now()}`.slice(0, 32)
      });
      try {
        execution = await defaultHostedSutSandboxProcess(commandPlan, retainedArchive);
      } finally {
        try {
          teardown = await defaultHostedSutSandboxProcess(hostedSutTeardownCommandPlan({
            actionKey: bootstrapDigest,
            unitName: commandPlan.unitName
          }));
        } finally {
          try {
            retainedArchiveStable =
              assertRetainedHostedSutArchive(retainedArchive) === prepared.archiveDigest;
          } finally {
            closeSync(retainedArchive.fileDescriptor);
            retainedArchive = null;
          }
        }
      }
    }
    let summary: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(execution.failureTail) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        summary = parsed as Record<string, unknown>;
      }
    } catch {
      summary = null;
    }
    const results = Array.isArray(summary?.results)
      ? summary.results.filter((entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      : [];
    const resultByLabel = new Map(results.map((result) => [String(result.label), result] as const));
    for (const [fileName, label] of TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES) {
      writeHostedActionJson(path.resolve(outputDirectory, fileName), Object.freeze({
        schema: 'sec-trusted-bootstrap-sandbox-step-observation-v1',
        bootstrapDigest,
        sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
        label,
        observation: resultByLabel.get(label) ?? null
      }));
    }
    const sumsSource = `${TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES.map(([fileName]) =>
      `${createHash('sha256').update(readFileSync(path.resolve(outputDirectory, fileName))).digest('hex')}  ${fileName}`
    ).join('\n')}\n`;
    writeFileSync(path.resolve(outputDirectory, 'SHA256SUMS'), sumsSource, { encoding: 'utf8', flag: 'wx' });
    const residuePassed = teardown.commandStarted && teardown.code === 0 &&
      teardown.failureTail.includes(`${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER}:direct-process-closed`);
    const archiveStable = retainedArchiveStable;
    const summaryIdentityPassed = summary?.schema === 'sec-trusted-bootstrap-sandbox-summary-v1' &&
      summary.baseSha === input.baseSha && summary.headSha === input.headSha &&
      summary.treeSha === input.treeSha && summary.parentSha === input.baseSha;
    const status = capability.state === 'supported' && commandPlan !== null && execution.commandStarted &&
      execution.code === 0 && !execution.outputTruncated && residuePassed && archiveStable &&
      summaryIdentityPassed && summary?.status === 'passed'
      ? 'passed' as const : 'failed' as const;
    const semantic = Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-receipt-v2' as const,
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha,
      parentSha: input.baseSha,
      auxiliaryStatus: status,
      evidenceSetDigest: `sha256:${createHash('sha256').update(sumsSource).digest('hex')}`,
      bootstrapDigest,
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
      commandPlanDigest: commandPlan?.planDigest ?? null,
      archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      executionOutputDigest: execution.rawOutputDigest,
      residueReadbackDigest: teardown.rawOutputDigest
    });
    const receiptDigest = (`sha256:${createHash('sha256').update(JSON.stringify(semantic)).digest('hex')}`) as VerificationActionKeyDigest;
    writeFileSync(
      path.resolve(outputDirectory, 'sut-receipt.json'),
      `${JSON.stringify({ ...semantic, receiptDigest }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    if (status !== 'passed') {
      throw new Error(
        `Trusted bootstrap candidate SUT failed inside the private sandbox: ${
          summary?.diagnostic ?? capability.diagnostic ?? execution.failureTail}`.slice(0, 2048)
      );
    }
    return Object.freeze({ status, bootstrapDigest, receiptDigest });
  } finally {
    if (retainedArchive !== null) closeSync(retainedArchive.fileDescriptor);
    if (prepared !== null && existsSync(prepared.preparedCandidateArchive)) {
      rmSync(prepared.preparedCandidateArchive, { force: true });
    }
    if (existsSync(transportDirectory)) rmSync(transportDirectory, { recursive: true, force: true });
    if (existsSync(candidateNodeModules)) rmSync(candidateNodeModules, { recursive: true, force: true });
  }
}

function hostedSutDiagnostic(value: string, fallback: string): string {
  const bounded = CodexDevelopmentFailureTail(value, fallback);
  const escaped = bounded.replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`
  );
  return CodexDevelopmentFailureTail(escaped, fallback);
}

type HostedSutSandboxCapabilityObservation = Readonly<{
  state: 'supported' | 'unsupported' | 'invalidated' | 'unknown';
  commandPlanDigest: VerificationActionKeyDigest | null;
  commandStarted: boolean;
  exitCode: number | null;
  markerObserved: boolean;
  outputDigest: VerificationActionKeyDigest;
  teardownCommandStarted: boolean;
  teardownExitCode: number | null;
  residueMarkerObserved: boolean;
  residueReadbackDigest: VerificationActionKeyDigest;
  cgroupEmpty: boolean;
  diagnostic: string | null;
}>;

export async function CodexDevelopmentProbeHostedSutSandboxCapability(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorization;
  bunExecutable?: string;
  unitNonce?: string;
  platform?: NodeJS.Platform;
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcess;
}>): Promise<HostedSutSandboxCapabilityObservation> {
  if ((input.platform ?? process.platform) !== 'linux') {
    const diagnostic = 'Hosted SUT sandbox requires the native ubuntu-24.04 Linux runner.';
    return Object.freeze({
      state: 'unsupported', commandPlanDigest: null,
      commandStarted: false, exitCode: null, markerObserved: false,
      outputDigest: ciActionDigest(diagnostic),
      teardownCommandStarted: false, teardownExitCode: null, residueMarkerObserved: false,
      residueReadbackDigest: ciActionDigest('no-unshare-process'), cgroupEmpty: true, diagnostic
    });
  }
  const run = input.runSandboxProcess ?? defaultHostedSutSandboxProcess;
  const plan = hostedSutCapabilityCommandPlan({
    actionKey: input.actionKey,
    bunExecutable: input.bunExecutable ?? process.execPath,
    unitNonce: input.unitNonce ?? `${process.pid}`,
    executionAuthorization: input.executionAuthorization
  });
  let observed: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    observed = await run(plan);
  } catch (error) {
    observed = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const teardownPlan = hostedSutTeardownCommandPlan({ actionKey: input.actionKey, unitName: plan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    teardown = await run(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const selfTestPassed = observed.commandStarted && observed.code === 0 &&
    observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER);
  const directProcessClosed = teardown.failureTail.includes(
    `${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER}:direct-process-closed`
  );
  const residuePassed = teardown.commandStarted && teardown.code === 0 &&
    directProcessClosed && observed.commandStarted;
  if (selfTestPassed && residuePassed) {
    return Object.freeze({
      state: 'supported',
      commandPlanDigest: plan.physicalCommandProjectionDigest ?? plan.planDigest,
      commandStarted: observed.commandStarted, exitCode: observed.code,
      markerObserved: observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER),
      outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest,
      teardownCommandStarted: teardown.commandStarted, teardownExitCode: teardown.code,
      residueMarkerObserved: teardown.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER),
      residueReadbackDigest: teardown.rawOutputDigest as VerificationActionKeyDigest,
      cgroupEmpty: true, diagnostic: null
    });
  }
  const failure = `${observed.failureTail}\n${teardown.failureTail}`.trim();
  const unsupported = /not found|no such file|operation not permitted|failed to connect to bus|unshare failed|unknown option/iu
    .test(failure);
  const unknown = !observed.commandStarted || !teardown.commandStarted;
  return Object.freeze({
    state: unknown ? 'unknown' : unsupported ? 'unsupported' : 'invalidated',
    commandPlanDigest: plan.physicalCommandProjectionDigest ?? plan.planDigest,
    commandStarted: observed.commandStarted, exitCode: observed.code,
    markerObserved: observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER),
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest,
    teardownCommandStarted: teardown.commandStarted, teardownExitCode: teardown.code,
    residueMarkerObserved: teardown.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER),
    residueReadbackDigest: teardown.rawOutputDigest as VerificationActionKeyDigest,
    cgroupEmpty: residuePassed,
    diagnostic: failure.length > 0 ? hostedSutDiagnostic(
      failure,
      'Hosted SUT sandbox capability self-test failed.'
    ) : 'Hosted SUT sandbox capability self-test failed without a diagnostic.'
  });
}

function finalizeHostedSutSandboxReceipt(input: Omit<
  CodexDevelopmentHostedSutSandboxReceipt,
  'schema' | 'policyDigest' | 'resources' | 'receiptDigest'
>): CodexDevelopmentHostedSutSandboxReceipt {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey: input.actionKey,
    capability: input.capability,
    commandPlanDigest: input.commandPlanDigest,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits,
    authenticatedArchive: input.authenticatedArchive,
    rootIsolation: input.rootIsolation,
    execution: input.execution,
    reap: input.reap,
    residue: input.residue,
    diagnostic: input.diagnostic
  });
  return CodexDevelopmentParseHostedSutSandboxReceipt(Object.freeze({
    ...withoutDigest,
    receiptDigest: ciActionDigest(withoutDigest)
  }));
}

function hostedSutRootIsolationReceipt(environmentNames: readonly string[]):
CodexDevelopmentHostedSutSandboxReceipt['rootIsolation'] {
  return Object.freeze({
    substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.substrate,
    namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.namespaces,
    uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid,
    gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid,
    network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.network,
    inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.inputMount,
    workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.workspace,
    outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outputTransport,
    candidateEnvironmentNames: Object.freeze([...environmentNames].sort())
  });
}

function hostedSutCapabilityReceipt(
  capability: HostedSutSandboxCapabilityObservation
): CodexDevelopmentHostedSutSandboxReceipt['capability'] {
  return Object.freeze({
    commandPlanDigest: capability.commandPlanDigest,
    commandStarted: capability.commandStarted,
    exitCode: capability.exitCode,
    markerObserved: capability.markerObserved,
    outputDigest: capability.outputDigest,
    teardownCommandStarted: capability.teardownCommandStarted,
    teardownExitCode: capability.teardownExitCode,
    residueMarkerObserved: capability.residueMarkerObserved,
    cgroupEmpty: capability.cgroupEmpty,
    residueReadbackDigest: capability.residueReadbackDigest,
    diagnostic: capability.diagnostic
  });
}

function hostedSutInventoryClosureFromTicket(
  ticket: CodexDevelopmentHostedActionExecutionTicket
): CodexDevelopmentHostedSutInventoryClosure {
  return Object.freeze({
    archiveDigest: ticket.preparedCandidateArchiveDigest,
    inventoryDigest: ticket.preparedCandidateInventoryDigest,
    entryCount: ticket.preparedCandidateEntryCount,
    totalFileBytes: ticket.preparedCandidateTotalFileBytes,
    dependencyClosureDigest: ticket.baseDependencyClosureDigest,
    gitBundleDigest: ticket.authenticatedGitClosureDigest
  });
}

type HostedSutExecutionGrantInput =
  Parameters<typeof CodexDevelopmentCreateHostedSutExecutionAuthorization>[0];

/**
 * Validation/reconstruction belongs to the caller. Once that typed context
 * reaches this gateway, authority-artifact issuance is unconditional.
 */
function issueHostedSutExecutionGrant(
  input: HostedSutExecutionGrantInput
): ReturnType<typeof CodexDevelopmentCreateHostedSutExecutionAuthorization> {
  return CodexDevelopmentCreateHostedSutExecutionAuthorization(input);
}

export async function CodexDevelopmentExecuteHostedActionSut(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  ticket: CodexDevelopmentHostedActionExecutionTicket;
  candidateArchive: string;
  archiveInventory: CodexDevelopmentHostedActionArchiveInventory;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  platform?: NodeJS.Platform;
  bunExecutable?: string;
  unitNonce?: string;
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcess;
}>): Promise<CodexDevelopmentHostedActionRawResult> {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    encodeVerificationActionData(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
    throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
  }
  const ticketInventory = hostedSutInventoryClosureFromTicket(ticket);
  if (encodeVerificationActionData(ticketInventory) !== encodeVerificationActionData(input.archiveInventory)) {
    throw new Error('Hosted Action SUT archive inventory differs from the trusted execution ticket.');
  }
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex];
  if (normalizedOperation === undefined ||
      normalizedOperation.semanticDigest !== resolution.actionPlan.action.operation.semanticDigest) {
    throw new Error('Hosted Action resolution lost its normalized operation.');
  }
  const executionAuthorization = issueHostedSutExecutionGrant({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: ticketInventory,
    producer: ticket.producer
  });
  const env = CodexDevelopmentHostedSutCandidateEnvironment({
    normalizedOperation,
    manifestPath: resolution.artifactInput.manifestPath
  });
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const actionKey = resolution.actionPlan.action.actionKey;
  const unitNonce = input.unitNonce ?? `${process.pid}-${startedAt.getTime()}`;
  const runSandboxProcess = input.runSandboxProcess ?? defaultHostedSutSandboxProcess;
  const capability = await CodexDevelopmentProbeHostedSutSandboxCapability({
    actionKey,
    executionAuthorization,
    bunExecutable: input.bunExecutable,
    unitNonce: `cap-${unitNonce}`.slice(0, 32),
    platform: input.platform,
    runSandboxProcess
  });
  if (capability.state !== 'supported') {
    const finishedAt = now();
    const emptyDigest = ciActionDigest('not-executed');
    const receipt = finalizeHostedSutSandboxReceipt({
      actionKey,
      capability: hostedSutCapabilityReceipt(capability),
      commandPlanDigest: null,
      authenticatedArchive: Object.freeze({
        archiveDigest: input.archiveInventory.archiveDigest,
        inventoryDigest: input.archiveInventory.inventoryDigest,
        dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
        gitBundleDigest: input.archiveInventory.gitBundleDigest,
        entryCount: input.archiveInventory.entryCount,
        totalFileBytes: input.archiveInventory.totalFileBytes
      }),
      rootIsolation: hostedSutRootIsolationReceipt(Object.keys(env)),
      execution: Object.freeze({
        started: false, unitName: null, exitCode: null,
        commandStarted: false,
        authenticatedInputDigest: null,
        postExecutionInputDigest: null,
        postExecutionReadbackErrorDigest: null,
        stdoutStderrDigest: capability.outputDigest,
        stdoutDigest: emptyDigest,
        stderrDigest: capability.outputDigest,
        stdoutBytesObserved: 0,
        stderrBytesObserved: 0,
        outputTruncated: false,
        boundedFailureTailDigest: ciActionDigest(capability.diagnostic ?? '')
      }),
      reap: Object.freeze({
        namespacePid1Exited: false, killChildEnabled: true,
        unshareProcessClosed: capability.cgroupEmpty
      }),
      residue: Object.freeze({
        cgroupEmpty: capability.cgroupEmpty,
        hostReadbackDigest: capability.residueReadbackDigest
      }),
      diagnostic: capability.diagnostic
    });
    return CodexDevelopmentFinalizeHostedActionRawResult({
      executionAuthorizationDigest: executionAuthorization.authorizationDigest,
      command: null,
      sandboxReceipt: receipt,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    });
  }

  const candidateArchive = realpathSync.native(path.resolve(input.candidateArchive));
  const retainedArchive = retainHostedSutArchive(
    candidateArchive,
    input.archiveInventory.archiveDigest
  );
  const preExecutionArchiveDigest = retainedArchive.archiveDigest;
  try {
  const commandPlan = CodexDevelopmentBuildHostedSutSandboxCommandPlan({
    actionKey,
    candidateArchiveDigest: retainedArchive.archiveDigest,
    bunExecutable: realpathSync.native(path.resolve(input.bunExecutable ?? process.execPath)),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: ciVerificationNormalizedOperationArgv(normalizedOperation),
    candidateEnvironment: env,
    executionAuthorization
  });
  const authorizedOperation = resolveCiVerificationDevRunnerTarget({
    plan: resolution.actionPlan,
    authorizedClosure: resolution.actionPlanClosure
  });
  if (authorizedOperation.semanticDigest !== normalizedOperation.semanticDigest) {
    throw new Error('Hosted SUT executor received a substituted normalized operation.');
  }
  let physical: CodexDevelopmentHostedSutSandboxProcessObservation | null = null;
  let executionObservationLost = false;
  try {
    physical = await runSandboxProcess(commandPlan, retainedArchive);
  } catch (error) {
    executionObservationLost = true;
    physical = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const exitCode = physical.code;
  const observedPhysical = physical as CodexDevelopmentHostedSutSandboxProcessObservation | null;
  if (observedPhysical === null || exitCode !== observedPhysical.code) {
    throw new Error('Hosted Action facade lost its one physical process observation.');
  }
  const processResult = observedPhysical;
  const teardownPlan = hostedSutTeardownCommandPlan({ actionKey, unitName: commandPlan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    teardown = await runSandboxProcess(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const directProcessClosed = teardown.failureTail.includes(
    `${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER}:direct-process-closed`
  );
  const residuePassed = teardown.commandStarted && teardown.code === 0 &&
    directProcessClosed && processResult.commandStarted;
  let postExecutionArchiveDigest: VerificationActionKeyDigest | null = null;
  let archiveReadbackDiagnostic: string | null = null;
  try {
    postExecutionArchiveDigest = assertRetainedHostedSutArchive(retainedArchive);
    if (hostedActionFileDigest(candidateArchive) !== retainedArchive.archiveDigest) {
      throw new Error('Hosted SUT archive pathname no longer names the retained authenticated bytes.');
    }
  } catch (error) {
    archiveReadbackDiagnostic = error instanceof Error ? error.message : String(error);
  }
  const archiveStable = postExecutionArchiveDigest === preExecutionArchiveDigest;
  const sandboxInvalidated = executionObservationLost || !processResult.commandStarted ||
    processResult.outputTruncated ||
    processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT ||
    processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT ||
    !residuePassed || !archiveStable;
  const finishedAt = now();
  const diagnostic = sandboxInvalidated
    ? hostedSutDiagnostic([
        executionObservationLost ? 'Hosted SUT physical process observation was lost.' : '',
        processResult.outputTruncated ? 'Hosted SUT physical process output was truncated.' : '',
        processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT
          ? 'Hosted SUT stdout exceeded its observed byte bound.' : '',
        processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT
          ? 'Hosted SUT stderr exceeded its observed byte bound.' : '',
        residuePassed ? '' : `Hosted SUT residue readback failed: ${teardown.failureTail}`,
        archiveStable ? '' : `Hosted SUT authenticated archive readback failed: ${archiveReadbackDiagnostic ?? 'digest changed'}`
      ].filter(Boolean).join('\n'), 'Hosted SUT sandbox was invalidated.')
    : processResult.code === 0 ? null
      : hostedSutDiagnostic(processResult.failureTail, `${normalizedOperation.gateId} failed.`);
  const receipt = finalizeHostedSutSandboxReceipt({
    actionKey,
    capability: hostedSutCapabilityReceipt(capability),
    commandPlanDigest: commandPlan.physicalCommandProjectionDigest,
    authenticatedArchive: Object.freeze({
      archiveDigest: input.archiveInventory.archiveDigest,
      inventoryDigest: input.archiveInventory.inventoryDigest,
      dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
      gitBundleDigest: input.archiveInventory.gitBundleDigest,
      entryCount: input.archiveInventory.entryCount,
      totalFileBytes: input.archiveInventory.totalFileBytes
    }),
    rootIsolation: hostedSutRootIsolationReceipt(Object.keys(env)),
    execution: Object.freeze({
      started: processResult.commandStarted,
      commandStarted: processResult.commandStarted,
      unitName: commandPlan.unitName,
      exitCode: processResult.code,
      authenticatedInputDigest: preExecutionArchiveDigest,
      postExecutionInputDigest: postExecutionArchiveDigest,
      postExecutionReadbackErrorDigest: archiveReadbackDiagnostic === null
        ? null : ciActionDigest(archiveReadbackDiagnostic),
      stdoutStderrDigest: processResult.rawOutputDigest as VerificationActionKeyDigest,
      stdoutDigest: processResult.stdoutDigest,
      stderrDigest: processResult.stderrDigest,
      stdoutBytesObserved: processResult.stdoutBytesObserved,
      stderrBytesObserved: processResult.stderrBytesObserved,
      outputTruncated: processResult.outputTruncated,
      boundedFailureTailDigest: ciActionDigest(processResult.failureTail)
    }),
    reap: Object.freeze({
      namespacePid1Exited: processResult.commandStarted,
      killChildEnabled: true,
      unshareProcessClosed: residuePassed
    }),
    residue: Object.freeze({
      cgroupEmpty: residuePassed,
      hostReadbackDigest: teardown.rawOutputDigest as VerificationActionKeyDigest
    }),
    diagnostic
  });
  return CodexDevelopmentFinalizeHostedActionRawResult({
    executionAuthorizationDigest: executionAuthorization.authorizationDigest,
    command: Object.freeze({
      commandPlanDigest: commandPlan.physicalCommandProjectionDigest!,
      executionAuthorizationDigest: commandPlan.executionAuthorizationDigest!,
      physicalCommandProjectionDigest: commandPlan.physicalCommandProjectionDigest!
    }),
    sandboxReceipt: receipt,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString()
  });
  } finally {
    closeSync(retainedArchive.fileDescriptor);
  }
}

export function CodexDevelopmentParseHostedActionRawResult(
  source: string
): CodexDevelopmentHostedActionRawResult {
  return parseHostedActionRawResultContractV2(source);
}

export function CodexDevelopmentAssembleHostedActionTerminal(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  ticket: CodexDevelopmentHostedActionExecutionTicket;
  rawResult: CodexDevelopmentHostedActionRawResult;
  expectedRawResultDigest: VerificationActionKeyDigest;
  producer: CodexDevelopmentVerificationActionArtifactProducer;
}>): CodexDevelopmentVerificationActionTerminalArtifact {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    encodeVerificationActionData(input.ticket)
  );
  const rawResult = CodexDevelopmentParseHostedActionRawResult(
    encodeVerificationActionData(input.rawResult)
  );
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex];
  if (normalizedOperation === undefined ||
      normalizedOperation.semanticDigest !== resolution.actionPlan.action.operation.semanticDigest) {
    throw new Error('Hosted Action assembler cannot reconstruct the exact normalized operation.');
  }
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest ||
      encodeVerificationActionData(input.producer) !== encodeVerificationActionData(ticket.producer)) {
    throw new Error('Hosted Action assembler inputs differ from the original trusted execution ticket.');
  }
  const authorization = issueHostedSutExecutionGrant({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: hostedSutInventoryClosureFromTicket(ticket),
    producer: input.producer
  });
  const terminal = CodexDevelopmentReduceHostedSutObservation({
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    producer: input.producer,
    authorization,
    observation: rawResult,
    expectedRawResultDigest: input.expectedRawResultDigest
  });
  return CodexDevelopmentFinalizeVerificationActionTerminalArtifact({
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    result: terminal.result,
    cleanup: terminal.cleanup,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
    input: resolution.artifactInput,
    producer: input.producer,
    executionProof: terminal.proof
  });
}

function terminalDependencyState(
  artifact: CodexDevelopmentVerificationActionTerminalArtifact | undefined
): VerificationActionDependencyResolution['state'] {
  if (artifact === undefined) return 'unknown';
  if (artifact.cleanup.status === 'failed') return 'terminal-failed';
  switch (artifact.result.status) {
    case 'passed': return 'terminal-passed';
    case 'failed': return 'terminal-failed';
    case 'not-run': return 'not-run';
    case 'unsupported': return 'unsupported';
    case 'invalidated': return 'invalidated';
  }
}

function deriveHostedSyntheticNotRunActionKeys(
  plan: CiVerificationActionPlanClosure,
  terminalArtifactsByKey: ReadonlyMap<VerificationActionKeyDigest,
    CodexDevelopmentVerificationActionTerminalArtifact>
): ReadonlySet<VerificationActionKeyDigest> {
  const syntheticNotRunActionKeys = new Set<VerificationActionKeyDigest>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const member of plan.actions) {
      const actionKey = member.action.actionKey;
      if (terminalArtifactsByKey.has(actionKey) || syntheticNotRunActionKeys.has(actionKey)) continue;
      const hasDirectNonPassingDependency = member.dependencies.some((dependency) => {
        if (syntheticNotRunActionKeys.has(dependency.actionKey)) return true;
        const dependencyArtifact = terminalArtifactsByKey.get(dependency.actionKey);
        return dependencyArtifact !== undefined && terminalDependencyState(dependencyArtifact) !== 'terminal-passed';
      });
      if (hasDirectNonPassingDependency) {
        syntheticNotRunActionKeys.add(actionKey);
        changed = true;
      }
    }
  }
  return syntheticNotRunActionKeys;
}

export function CodexDevelopmentCoordinateHostedActions(input: Readonly<{
  envelope: VerificationSessionHostedEnvelope;
  observations: readonly CodexDevelopmentHostedActionArtifactObservation[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservation[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservation[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadback[];
}>): CodexDevelopmentHostedActionCoordination {
  const envelope = parseHostedEnvelope(input.envelope);
  const plan = envelope.actionPlanClosure;
  const membersByKey = new Map(plan.actions.map((member) => [member.action.actionKey, member] as const));
  const actionKeyForName = (name: string, kind: 'start' | 'terminal' | 'anchor'): VerificationActionKeyDigest => {
    const member = plan.actions.find((entry) => {
      if (kind === 'start') return verificationActionStartMarkerNameV2(entry.action.actionKey) === name;
      if (kind === 'terminal') return verificationActionProviderTerminalArtifactName(entry.action.actionKey) === name;
      return verificationActionProviderTerminalAnchorName(entry.action.actionKey) === name;
    });
    if (member === undefined) throw new Error('Hosted Action provider artifact is outside the canonical Session closure.');
    return member.action.actionKey;
  };
  const origins = new Set<string>();
  const assertCurrentBaseOrigin = (
    origin: CodexDevelopmentVerificationActionArtifactProducer | null,
    label: string
  ): void => {
    if (origin === null || origin.repository !== envelope.scopeAuthorization.repository ||
        origin.workflowSha !== envelope.session.baseSha ||
        origin.workflowRef !== `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`) {
      throw new Error(`${label} is not produced by the exact trusted current-base workflow.`);
    }
  };
  const claimOrigin = (originId: string): void => {
    if (origins.has(originId)) throw new Error('Hosted Action provider index repeats one artifact origin.');
    origins.add(originId);
  };
  const terminalsByKey = new Map<VerificationActionKeyDigest, CodexDevelopmentHostedActionArtifactObservation>();
  for (const observation of input.observations) {
    const provider = observation.providerObservation;
    assertCurrentBaseOrigin(provider.referencedOrigin, 'Hosted Action terminal origin');
    claimOrigin(provider.originId);
    const actionKey = actionKeyForName(provider.artifactName, 'terminal');
    if (terminalsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple terminal origins.');
    if (observation.artifact !== null) {
      const member = membersByKey.get(actionKey)!;
      CodexDevelopmentAssertVerificationActionTerminalArtifact(observation.artifact, {
        actionPlan: member,
        executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION
      });
      if (provider.payload === null || provider.payload.payloadDigest !== observation.artifact.artifactDigest ||
          provider.payload.actionKey !== actionKey || provider.payload.candidateSha !== envelope.session.headSha ||
          encodeVerificationActionData(provider.payload.producer) !==
            encodeVerificationActionData(observation.artifact.producer)) {
        throw new Error('Hosted Action terminal provider fact differs from the canonical terminal artifact.');
      }
    }
    terminalsByKey.set(actionKey, observation);
  }
  const startsByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderStartObservation>();
  for (const observation of input.startObservations) {
    assertCurrentBaseOrigin(observation.referencedOrigin, 'Hosted Action start origin');
    claimOrigin(observation.originId);
    const actionKey = actionKeyForName(observation.artifactName, 'start');
    if (startsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple start origins.');
    startsByKey.set(actionKey, observation);
  }
  const anchorsByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderTerminalAnchorObservation>();
  for (const observation of input.terminalAnchorObservations) {
    assertCurrentBaseOrigin(observation.referencedOrigin, 'Hosted Action terminal anchor origin');
    claimOrigin(observation.originId);
    const actionKey = actionKeyForName(observation.artifactName, 'anchor');
    if (anchorsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple terminal anchor origins.');
    anchorsByKey.set(actionKey, observation);
  }
  const statusReadbacksByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderStatusReadback>();
  const statusIds = new Set<number>();
  for (const readback of input.providerStatusReadbacks) {
    if (!membersByKey.has(readback.actionKey) || statusReadbacksByKey.has(readback.actionKey)) {
      throw new Error('Hosted Action provider readback is outside or duplicates the canonical Session closure.');
    }
    for (const status of readback.statuses) {
      assertCurrentBaseOrigin(status.referencedOrigin, 'Hosted Action status referenced origin');
      if (statusIds.has(status.id)) throw new Error('Hosted Action provider index repeats one status id.');
      statusIds.add(status.id);
    }
    statusReadbacksByKey.set(readback.actionKey, readback);
  }
  if (statusReadbacksByKey.size !== plan.actions.length) {
    throw new Error('Hosted Action provider status census is incomplete for the canonical Session closure.');
  }

  const byKey = new Map<VerificationActionKeyDigest, CodexDevelopmentVerificationActionTerminalArtifact>();
  const repairable: VerificationActionKeyDigest[] = [];
  const firstExecutionCandidates = new Set<VerificationActionKeyDigest>();
  for (const member of plan.actions) {
    const actionKey = member.action.actionKey;
    const decision = reduceVerificationActionProviderState({
      repositoryId: statusReadbacksByKey.get(actionKey)!.repositoryId,
      repository: envelope.scopeAuthorization.repository,
      actionKey,
      candidateSha: envelope.session.headSha,
      executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
      statusReadback: statusReadbacksByKey.get(actionKey)!,
      startObservations: startsByKey.has(actionKey) ? [startsByKey.get(actionKey)!] : [],
      terminalObservations: terminalsByKey.has(actionKey)
        ? [terminalsByKey.get(actionKey)!.providerObservation]
        : [],
      terminalAnchorObservations: anchorsByKey.has(actionKey) ? [anchorsByKey.get(actionKey)!] : []
    });
    if (decision.disposition === 'blocked') {
      return finalizeCoordination(
        plan.actionPlanDigest, 'blocked', [], [...byKey.keys()],
        plan.actions.filter((entry) => !byKey.has(entry.action.actionKey)).map((entry) => entry.action.actionKey),
        decision.reason
      );
    }
    if (decision.disposition === 'start-allowed') {
      firstExecutionCandidates.add(actionKey);
      continue;
    }
    const terminal = terminalsByKey.get(actionKey);
    if (terminal?.artifact === null || terminal?.artifact === undefined ||
        decision.terminalPayloadDigest !== terminal.artifact.artifactDigest) {
      throw new Error('Hosted Action provider terminal decision has no exact terminal artifact bytes.');
    }
    byKey.set(actionKey, terminal.artifact);
    if (decision.disposition === 'repair-terminal-anchor' ||
        decision.disposition === 'repair-terminal-status') {
      repairable.push(actionKey);
    }
  }

  const missing = plan.actions.filter((entry) => !byKey.has(entry.action.actionKey));
  const syntheticNotRunActionKeys = deriveHostedSyntheticNotRunActionKeys(plan, byKey);
  const runnable: VerificationActionKeyDigest[] = [];
  for (const member of missing) {
    if (syntheticNotRunActionKeys.has(member.action.actionKey)) continue;
    if (!firstExecutionCandidates.has(member.action.actionKey)) continue;
    const dependencies = member.dependencies.map((dependency) => Object.freeze({
      actionKey: dependency.actionKey,
      state: syntheticNotRunActionKeys.has(dependency.actionKey)
        ? 'not-run' as const
        : terminalDependencyState(byKey.get(dependency.actionKey)),
      observationDigest: (byKey.get(dependency.actionKey)?.artifactDigest ?? null) as VerificationActionKeyDigest | null
    }));
    const runnableDecision = isVerificationActionRunnable(member, dependencies);
    if (runnableDecision.runnable) runnable.push(member.action.actionKey);
  }
  const dispatch = [...new Set([...repairable, ...runnable])];
  if (dispatch.length > 0) {
    return finalizeCoordination(plan.actionPlanDigest, 'dispatch', dispatch, [...byKey.keys()],
      missing.map((entry) => entry.action.actionKey), null);
  }
  if (byKey.size + syntheticNotRunActionKeys.size === plan.actions.length) {
    return finalizeCoordination(plan.actionPlanDigest, 'complete', [], [...byKey.keys()],
      missing.map((entry) => entry.action.actionKey), null);
  }
  return finalizeCoordination(plan.actionPlanDigest, 'waiting', [], [...byKey.keys()],
    missing.map((entry) => entry.action.actionKey), 'required upstream Action terminal has not arrived');
}


function finalizeCoordination(
  actionPlanDigest: VerificationActionKeyDigest,
  disposition: CodexDevelopmentHostedActionCoordination['disposition'],
  dispatchActionKeys: readonly VerificationActionKeyDigest[],
  terminalActionKeys: readonly VerificationActionKeyDigest[],
  missingActionKeys: readonly VerificationActionKeyDigest[],
  reason: string | null
): CodexDevelopmentHostedActionCoordination {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_COORDINATION_SCHEMA,
    disposition,
    actionPlanDigest,
    dispatchActionKeys: Object.freeze([...dispatchActionKeys].sort()),
    terminalActionKeys: Object.freeze([...terminalActionKeys].sort()),
    missingActionKeys: Object.freeze([...missingActionKeys].sort()),
    reason
  });
  return Object.freeze({ ...withoutDigest, coordinationDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentComposeHostedEvidence(input: Readonly<{
  envelope: VerificationSessionHostedEnvelope;
  observations: readonly CodexDevelopmentHostedActionArtifactObservation[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservation[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservation[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadback[];
  producer: ReturnType<typeof CodexDevelopmentCreateVerificationEvidenceProducer>;
  now?: () => Date;
}>): Readonly<{
  coordination: CodexDevelopmentHostedActionCoordination;
  evidence: CodexDevelopmentVerificationEvidenceV4 | null;
}> {
  const envelope = parseHostedEnvelope(input.envelope);
  const coordination = CodexDevelopmentCoordinateHostedActions({
    envelope,
    observations: input.observations,
    startObservations: input.startObservations,
    terminalAnchorObservations: input.terminalAnchorObservations,
    providerStatusReadbacks: input.providerStatusReadbacks
  });
  if (coordination.disposition !== 'complete') {
    return Object.freeze({ coordination, evidence: null });
  }
  const byKey = new Map<VerificationActionKeyDigest, CodexDevelopmentVerificationActionTerminalArtifact>();
  for (const observation of input.observations) {
    if (!observation.providerObservation.expired && observation.artifact !== null) {
      byKey.set(observation.artifact.actionPlan.action.actionKey, observation.artifact);
    }
  }
  const syntheticNotRunActionKeys = deriveHostedSyntheticNotRunActionKeys(
    envelope.actionPlanClosure,
    byKey
  );
  const gates = envelope.actionPlanClosure.actions.map((member) => {
    const artifact = byKey.get(member.action.actionKey);
    if (artifact !== undefined) {
      const evidenceRef = `verification-action-artifact:${artifact.artifactDigest}`;
      const reusableTerminal = artifact.result.status === 'passed' || artifact.result.status === 'failed';
      const result = CodexDevelopmentBuildVerificationGateResult({
        ...artifact.result,
        disposition: reusableTerminal ? 'reused' : artifact.result.disposition,
        execution: reusableTerminal ? null : artifact.result.execution,
        evidenceRefs: [...new Set([...artifact.result.evidenceRefs, evidenceRef])]
      });
      return Object.freeze({
        action: member.action,
        result,
        cleanup: artifact.cleanup
      });
    }
    if (!syntheticNotRunActionKeys.has(member.action.actionKey)) {
      throw new Error('Hosted Evidence composition is complete without a terminal or failed prerequisite.');
    }
    return Object.freeze({
      action: member.action,
      result: CodexDevelopmentBuildVerificationGateResult({
        gateId: member.action.operation.identity,
        gateRevision: member.action.operation.revision,
        owner: 'ci-verification-maintainer',
        requirementKey: `gate:${member.action.operation.identity}`,
        subjectRevision: envelope.session.headSha,
        inputDigest: member.action.actionKey,
        applicability: 'required',
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'fail-fast-prerequisite-failed',
        requiredForClaims: [`gate:${member.action.operation.identity}`],
        supportedClaims: [`gate:${member.action.operation.identity}`],
        environment: null,
        execution: null,
        evidenceRefs: [],
        invalidationRules: ['ActionKey or dependency closure changes'],
        diagnostic: 'A declared direct prerequisite has a canonical nonpassing hosted Action outcome.'
      }),
      cleanup: Object.freeze({ status: 'not-required' as const, evidenceRefs: Object.freeze([]), diagnostic: null })
    });
  });
  const timestamps = [...byKey.values()].flatMap((artifact) => artifact.result.execution === null
    ? []
    : [artifact.result.execution.startedAt, artifact.result.execution.finishedAt]);
  const observedAt = (input.now ?? (() => new Date()))().toISOString();
  const startedAt = [...timestamps, observedAt].sort()[0]!;
  const finishedAt = [...timestamps, observedAt].sort().at(-1)!;
  const status = aggregateV4Status(gates);
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    sessionRevision: envelope.session.sessionRevision,
    sessionProposalDigest: envelope.session.sessionProposalDigest,
    scopeAuthorizationRevision: envelope.scopeAuthorization.authorizationRevision,
    scopeAuthorizationDigest: envelope.scopeAuthorization.authorizationDigest,
    reviewReceiptDigest: envelope.preGateReview.receiptDigest,
    mainHealthRevision: envelope.mainHealth.healthRevision,
    mainHealthDigest: envelope.mainHealth.ledgerDigest,
    trustRevision: envelope.session.trustRevision,
    profile: envelope.session.profile as 'quick' | 'full',
    baseSha: envelope.session.baseSha,
    baseTreeSha: envelope.session.baseTreeSha,
    headSha: envelope.session.headSha,
    headTreeSha: envelope.session.headTreeSha,
    manifestPath: envelope.session.manifestPath,
    manifestDigest: envelope.session.manifestDigest,
    producer: input.producer,
    actionPlan: envelope.actionPlanClosure,
    status,
    startedAt,
    finishedAt,
    gates,
    evidenceRefs: [...byKey.values()].map((artifact) =>
      `verification-action-artifact:${artifact.artifactDigest}`
    ),
    invalidationRules: [
      ...INVALIDATION_RULES,
      'Session, Scope, Review, MainHealth, trust, Action member, or immutable terminal origin changes'
    ]
  });
  return Object.freeze({ coordination, evidence });
}

export type CodexDevelopmentCiVerificationTestOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  repositoryRoot?: string;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  changedRecords?: (baseRef: string) => CodexDevelopmentGitChangedRecord[] | null;
  transitionObservation?: CodexDevelopmentTestImpactTransitionObservation;
  readGitBlob?: (ref: string, file: string) => GitBlobBytes | null;
  runGate?: (
    step: { id: string; argv: string[]; env: NodeJS.ProcessEnv },
    execution: Readonly<{
      operation: SecBoundSemanticOperation;
      requirementId: string;
    }>
  ) => Promise<CodexDevelopmentGateProcessSettlement>;
  writeEvidence?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV4) => void;
  actionRunner?: VerificationActionRunner;
  readDurableActionResult?: (actionKey: VerificationActionKeyDigest) => Readonly<{
    result: VerificationGateResult;
    evidenceRefs: readonly string[];
  }> | null;
  readExactGitBlob?: (options: CodexDevelopmentExactGitBlobReadOptions) => GitBlobBytes;
  /** Owner-issued test seam; production CLI always acquires the exact candidate projection. */
  testImpactSourceProvider?: CodexDevelopmentTestImpactSourceProvider;
  /** Test-only pure plan seam; never exposed by the production CLI entry. */
  testVerificationPlan?: CodexDevelopmentVerificationPlan;
};

export interface CodexDevelopmentCiActionExecution {
  readonly actionPlan: CiVerificationActionPlanClosure;
  readonly gates: readonly CodexDevelopmentVerificationGateEvidenceV4[];
  readonly failed: boolean;
}

const CI_ACTION_EFFECT_LEASE_MS = 300_000;
const CI_ACTION_PROCESS_REQUIREMENT_ID = 'verification.hosted-process';
const CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID = 'verification.action-diagnostics';
const CI_ACTION_EFFECT_RESOURCE_BUDGET = Object.freeze({
  maximumDurationMs: CI_ACTION_EFFECT_LEASE_MS,
  maximumInputBytes: 16 * 1024 * 1024,
  maximumOutputBytes:
    CODEX_DEVELOPMENT_GATE_STDOUT_BYTE_LIMIT + CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT,
  maximumProcesses: 1
});

function bindCiActionEffect(
  plan: VerificationActionPlan,
  operation: CiVerificationActionPlanClosure['normalizedOperations'][number],
  deadlineAtUnixMs: number
): SecBoundSemanticOperation {
  const processContractDigest = CodexDevelopmentVerificationDigest({
    schema: 'sec-ci-action-effect-contract-v1',
    actionKey: plan.action.actionKey,
    operation
  }) as SecOperationDigest;
  const diagnosticContractDigest = CodexDevelopmentVerificationDigest({
    schema: 'sec-ci-action-combined-diagnostic-contract-v1',
    actionKey: plan.action.actionKey
  }) as SecOperationDigest;
  const authorityGrantDigest = CodexDevelopmentVerificationDigest({
    processContractDigest,
    diagnosticContractDigest
  }) as SecOperationDigest;
  const semanticPlan = compileSecSemanticOperationPlan({
    operation: 'verification.hosted-ci',
    intentDigest: plan.action.actionKey as SecOperationDigest,
    decisionDigest: operation.semanticDigest as SecOperationDigest,
    deadlineAtUnixMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumDurationMs },
      { resource: 'input-bytes', maximum: CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumInputBytes },
      { resource: 'output-bytes', maximum: CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumOutputBytes },
      { resource: 'processes', maximum: CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumProcesses }
    ],
    requirements: [{
      id: CI_ACTION_PROCESS_REQUIREMENT_ID,
      contractDigest: processContractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed', 'process.settlement-failed']
    }, {
      id: CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID,
      contractDigest: diagnosticContractDigest,
      effectKinds: ['filesystem'],
      failureKinds: ['diagnostic.incomplete-object', 'diagnostic.resource-exhausted']
    }],
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest })
  });
  return bindSecSemanticOperation(semanticPlan, [
    compileSecCapabilityBinding({
      requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID,
      contractDigest: processContractDigest,
      providerIdentityDigest: CodexDevelopmentVerificationDigest({
        schema: 'sec-ci-action-provider-binding-v1',
        environment: plan.action.environment,
        declaredEnvironment: plan.action.operation.declaredEnvironment
      }) as SecOperationDigest
    }),
    compileSecCapabilityBinding({
      requirementId: CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID,
      contractDigest: diagnosticContractDigest,
      providerIdentityDigest: CodexDevelopmentVerificationDigest(
        'runtime-state.process-diagnostics'
      ) as SecOperationDigest
    })
  ]);
}

async function issueCiActionEffectSettlement(input: Readonly<{
  runner: VerificationActionRunner;
  repositoryRoot: string;
  operation: SecBoundSemanticOperation;
  plan: VerificationActionPlan;
  gateId: string;
  settlement: CodexDevelopmentGateProcessSettlement;
}>) {
  const { operation, plan, gateId, settlement } = input;
  const { result, processResourceReceipt } = settlement;
  assertProcessResourceSessionReceipt(processResourceReceipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID
  });
  if (processResourceReceipt.processCount !== CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumProcesses
      || processResourceReceipt.settledProcessCount !== processResourceReceipt.processCount) {
    throw new Error('CI Action process settlement requires one completely settled physical process.');
  }
  if (!Number.isSafeInteger(result.code) || result.code < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(result.rawOutputDigest)) {
    throw new Error('CI Action process settlement is not canonical.');
  }
  const processSettlement = issueSecProviderSettlementReceipt(operation, {
    requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID,
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-provider-settlement-reference-v1',
      actionKey: plan.action.actionKey,
      gateId,
      exitCode: result.code,
      rawOutputDigest: result.rawOutputDigest,
      processResourceReceiptDigest: processResourceReceipt.receiptDigest
    }) as SecOperationDigest
  });
  const diagnosticObjects = await input.runner.publishBoundProcessDiagnostics({
    repositoryRoot: input.repositoryRoot,
    action: plan.action,
    operation,
    processSettlement,
    streams: [{
      stream: 'combined-tail',
      bytes: new TextEncoder().encode(result.failureTail)
    }]
  });
  const diagnosticSettlement = issueSecProviderSettlementReceipt(operation, {
    requirementId: CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID,
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: CodexDevelopmentVerificationDigest(
      diagnosticObjects.map(({ receipt, readback }) => ({
        objectDigest: receipt.objectDigest,
        readbackDigest: readback.readbackDigest
      }))
    ) as SecOperationDigest
  });
  const providerSettlementSet = compileSecProviderSettlementSet(
    operation,
    [processSettlement, diagnosticSettlement]
  );
  const failureTailDigest = CodexDevelopmentVerificationDigest(result.failureTail);
  const readback = issueSecNormalDomainReadbackReceipt(operation, providerSettlementSet, {
    readbackContractDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-domain-readback-contract-v1',
      resultSchemaRevision: plan.action.resultSchemaRevision
    }) as SecOperationDigest,
    readbackReferenceDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-domain-readback-reference-v1',
      actionKey: plan.action.actionKey,
      gateId,
      exitCode: result.code,
      rawOutputDigest: result.rawOutputDigest,
      failureTailDigest
    }) as SecOperationDigest,
    currentPhysicalEpochDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-physical-epoch-v1',
      actionKey: plan.action.actionKey,
      gateId,
      rawOutputDigest: result.rawOutputDigest
    }) as SecOperationDigest,
    disposition: 'applied'
  });
  const ownerTerminalJoin = issueSecNormalOwnerTerminalJoinReceipt(
    operation,
    providerSettlementSet,
    readback,
    {
      ownerTerminalContractDigest: CodexDevelopmentVerificationDigest({
        schema: 'sec-verification-action-terminal-contract-v1',
        resultSchemaRevision: plan.action.resultSchemaRevision
      }) as SecOperationDigest,
      ownerTerminalReferenceDigest: CodexDevelopmentVerificationDigest({
        schema: 'sec-ci-action-owner-terminal-reference-v1',
        actionKey: plan.action.actionKey,
        gateId,
        exitCode: result.code,
        rawOutputDigest: result.rawOutputDigest,
        failureTailDigest
      }) as SecOperationDigest
    }
  );
  const actionTerminalReceipt = issueVerificationActionOwnerTerminalReceipt({
    action: plan.action,
    operation,
    providerSettlementSet,
    readback,
    ownerTerminalProjection: ownerTerminalJoin
  });
  return issueProcessVerificationActionTerminalSettlement(actionTerminalReceipt, {
    status: result.code === 0 ? 'passed' : 'failed',
    reasonCode: result.code === 0 ? 'executed-success' : 'executed-failure',
    diagnosticObjects
  });
}

export async function CodexDevelopmentExecuteCiActionClosure(options: {
  readonly repositoryRoot: string;
  readonly actionPlan: CiVerificationActionPlanClosure;
  readonly gates: readonly Readonly<{
    gate: CiVerificationProducerGate;
    env: NodeJS.ProcessEnv;
  }>[];
  readonly headSha: string;
  readonly now: () => Date;
  readonly runGate: (
    step: { id: string; argv: string[]; env: NodeJS.ProcessEnv },
    execution: Readonly<{
      operation: SecBoundSemanticOperation;
      requirementId: string;
    }>
  ) => Promise<CodexDevelopmentGateProcessSettlement>;
  readonly actionRunner?: VerificationActionRunner;
  readonly readDurableActionResult?: CodexDevelopmentCiVerificationTestOptions['readDurableActionResult'];
}): Promise<CodexDevelopmentCiActionExecution> {
  const actionPlan = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(options.actionPlan)
  );
  if (options.gates.length !== actionPlan.actions.length) {
    throw new Error('CI Action executor gate/plan cardinality mismatch.');
  }
  const runner = options.actionRunner ?? createVerificationActionRunner();
  const evidence: CodexDevelopmentVerificationGateEvidenceV4[] = [];
  let failed = false;
  for (let index = 0; index < actionPlan.actions.length; index += 1) {
    const plan = actionPlan.actions[index]!;
    const operation = actionPlan.normalizedOperations[index]!;
    const descriptor = options.gates[index]!;
    const authorizedArgv = ciVerificationNormalizedOperationArgv(operation);
    if (operation.gateId !== plan.action.operation.identity ||
        descriptor.gate.id !== plan.action.operation.identity) {
      throw new Error(`CI Action executor gate ${descriptor.gate.id} does not match Action ${plan.action.operation.identity}.`);
    }
    const descriptorBindings = Object.entries(descriptor.gate.environment)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, bindingDigest]) => ({ name, digest: bindingDigest }));
    const operationBindings = operation.environmentBindings.filter(
      ({ name }) => name !== 'SEC_EXECUTION_ENVIRONMENT_REVISION'
    );
    if (descriptor.gate.runtime !== operation.runtime || descriptor.gate.phase !== operation.phase ||
        encodeVerificationActionData(descriptor.gate.argv) !==
          encodeVerificationActionData(authorizedArgv) ||
        encodeVerificationActionData(descriptor.gate.coveredScopeIds) !==
          encodeVerificationActionData(operation.coveredScopeIds) ||
        encodeVerificationActionData(descriptorBindings) !==
          encodeVerificationActionData(operationBindings)) {
      throw new Error(`CI Action executor descriptor for ${operation.gateId} differs from its authorized operation.`);
    }
    if (failed) {
      evidence.push({
        action: plan.action,
        result: CodexDevelopmentBuildVerificationGateResult({
          gateId: descriptor.gate.id,
          gateRevision: plan.action.operation.revision,
          owner: 'ci-verification-maintainer',
          requirementKey: `gate:${descriptor.gate.id}`,
          subjectRevision: options.headSha,
          inputDigest: plan.action.actionKey,
          applicability: 'required',
          status: 'not-run',
          disposition: 'not-executed',
          reasonCode: 'fail-fast-prerequisite-failed',
          requiredForClaims: [`gate:${descriptor.gate.id}`],
          supportedClaims: [`gate:${descriptor.gate.id}`],
          environment: null,
          execution: null,
          evidenceRefs: [],
          invalidationRules: ['ActionKey or dependency closure changes'],
          diagnostic: 'A prior Action failed.'
        }),
        cleanup: { status: 'not-required', evidenceRefs: [], diagnostic: null }
      });
      continue;
    }
    let physical: CodexDevelopmentGateProcessSettlement | null = null;
    let gateStarted: Date | null = null;
    let gateFinished: Date | null = null;
    const outcome: VerificationActionRunOutcome = await runner.execute({
      repositoryRoot: options.repositoryRoot,
      action: plan.action,
      plan,
      executionDomain: 'hosted-ci',
      leaseDurationMs: CI_ACTION_EFFECT_LEASE_MS,
      executor: async () => {
        gateStarted = options.now();
        const boundEffect = bindCiActionEffect(
          plan,
          operation,
          Date.now() + CI_ACTION_EFFECT_LEASE_MS
        );
        physical = await options.runGate({
          id: operation.gateId,
          argv: [...authorizedArgv],
          env: descriptor.env
        }, {
          operation: boundEffect,
          requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID
        });
        gateFinished = options.now();
        return await issueCiActionEffectSettlement({
          runner,
          repositoryRoot: options.repositoryRoot,
          operation: boundEffect,
          plan,
          gateId: operation.gateId,
          settlement: physical
        });
      }
    });
    let result: VerificationGateResult;
    if (outcome.physicalExecution) {
      if (physical === null || gateStarted === null || gateFinished === null || outcome.terminal === null) {
        throw new Error(
          `CI Action ${plan.action.actionKey} did not receive an owner-issued process terminal: ${
            outcome.reason ?? 'physical terminal observation unavailable'
          }`
        );
      }
      const processResult = (physical as CodexDevelopmentGateProcessSettlement).result;
      const started = gateStarted as Date;
      const finished = gateFinished as Date;
      result = CodexDevelopmentBuildVerificationGateResult({
        gateId: descriptor.gate.id,
        gateRevision: plan.action.operation.revision,
        owner: 'ci-verification-maintainer',
        requirementKey: `gate:${descriptor.gate.id}`,
        subjectRevision: options.headSha,
        inputDigest: plan.action.actionKey,
        applicability: 'required',
        status: processResult.code === 0 ? 'passed' : 'failed',
        disposition: 'executed',
        reasonCode: processResult.code === 0 ? 'executed-success' : 'executed-failure',
        requiredForClaims: [`gate:${descriptor.gate.id}`],
        supportedClaims: [`gate:${descriptor.gate.id}`],
        environment: {
          runtime: operation.runtime,
          os: process.platform,
          arch: process.arch,
          filesystem: null,
          capabilities: [],
          toolchainRevision: plan.action.environment.toolchainRevision,
          providerRevisions: [plan.action.environment.providerRevision]
        },
        execution: {
          argv: [...authorizedArgv],
          startedAt: started.toISOString(),
          finishedAt: finished.toISOString(),
          durationMs: Math.max(0, finished.getTime() - started.getTime()),
          exitCode: processResult.code,
          outputDigest: processResult.rawOutputDigest,
          failureFingerprint: processResult.code === 0 ? null : processResult.rawOutputDigest
        },
        evidenceRefs: [],
        invalidationRules: ['ActionKey, session, scope, review, main health, or trust revision changes'],
        diagnostic: processResult.code === 0
          ? null
          : CodexDevelopmentFailureTail(processResult.failureTail, `${descriptor.gate.id} failed.`)
      });
    } else {
      const durable = options.readDurableActionResult?.(plan.action.actionKey) ?? null;
      if (durable === null || durable.evidenceRefs.length === 0 ||
          durable.result.inputDigest !== plan.action.actionKey ||
          durable.result.subjectRevision !== options.headSha) {
        throw new Error(`CI Action ${plan.action.actionKey} ${outcome.disposition} without independently readable durable Evidence.`);
      }
      result = CodexDevelopmentBuildVerificationGateResult({
        ...durable.result,
        disposition: 'reused',
        execution: null,
        evidenceRefs: [...durable.evidenceRefs]
      });
    }
    evidence.push({
      action: plan.action,
      result,
      cleanup: { status: 'not-required', evidenceRefs: [], diagnostic: null }
    });
    if (result.status !== 'passed') failed = true;
  }
  return Object.freeze({ actionPlan, gates: Object.freeze(evidence), failed });
}

function formalVerificationBinding(env: NodeJS.ProcessEnv): Readonly<{
  mode: 'github-actions' | 'trusted-runtime';
  sessionRevision: string;
  sessionProposalDigest: `sha256:${string}`;
  scopeAuthorizationRevision: `sha256:${string}`;
  scopeAuthorizationDigest: `sha256:${string}`;
  reviewReceiptDigest: `sha256:${string}`;
  mainHealthRevision: `sha256:${string}`;
  mainHealthDigest: `sha256:${string}`;
  trustRevision: string;
  baseTreeSha: string;
  actionPlanDigest: `sha256:${string}`;
  executionEnvironment: CiVerificationExecutionEnvironment;
  requiredBlobs: readonly { path: string; digest: `sha256:${string}` }[];
}> | null {
  const hosted = env.SEC_FORMAL_HOSTED_MODE === '1';
  const trustedRuntime = env.SEC_FORMAL_TRUSTED_RUNTIME_MODE === '1';
  if (!hosted && !trustedRuntime) return null;
  if (hosted === trustedRuntime) {
    throw new Error('Formal verification requires exactly one provider mode.');
  }
  const mode = hosted ? 'github-actions' : 'trusted-runtime';
  const requiredKeys = [
    ...FORMAL_VERIFICATION_ENV_KEYS,
    ...(hosted ? FORMAL_HOSTED_ONLY_ENV_KEYS : FORMAL_TRUSTED_RUNTIME_ONLY_ENV_KEYS)
  ];
  for (const key of requiredKeys) {
    if (env[key] === undefined || env[key] === '') {
      throw new Error(`Formal ${mode} verification requires ${key}.`);
    }
  }
  const sha = (value: string, label: string): string => {
    if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be a lowercase Git SHA.`);
    return value;
  };
  const digest = (value: string, label: string): `sha256:${string}` => {
    if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
    return value as `sha256:${string}`;
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.SEC_REQUIRED_BLOB_CLOSURE_JSON!);
  } catch (error) {
    throw new Error('SEC_REQUIRED_BLOB_CLOSURE_JSON is not valid JSON.', { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error('SEC_REQUIRED_BLOB_CLOSURE_JSON must be an array.');
  const requiredBlobs = parsed.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'digest,path') {
      throw new Error(`Formal ${mode} requiredBlobs[${index}] is invalid.`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.path !== 'string' || candidate.path.length === 0 || candidate.path.includes('\\') ||
        candidate.path.startsWith('/') || candidate.path.startsWith('../')) {
      throw new Error(`Formal ${mode} requiredBlobs[${index}].path is invalid.`);
    }
    return Object.freeze({
      path: candidate.path,
      digest: digest(String(candidate.digest), `requiredBlobs[${index}].digest`)
    });
  });
  const executionEnvironment = hosted
    ? CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT
    : createCiVerificationLocalExecutionEnvironment({
        os: process.platform,
        arch: process.arch,
        bunVersion: Bun.version
      });
  if (env.SEC_EXECUTION_ENVIRONMENT_REVISION !== executionEnvironment.executionEnvironmentRevision) {
    throw new Error(`Formal ${mode} verification execution environment revision is not canonical.`);
  }
  return Object.freeze({
    mode,
    sessionRevision: env.SEC_SESSION_REVISION!,
    sessionProposalDigest: digest(env.SEC_SESSION_PROPOSAL_DIGEST!, 'SEC_SESSION_PROPOSAL_DIGEST'),
    scopeAuthorizationRevision: digest(env.SEC_SCOPE_AUTHORIZATION_REVISION!, 'SEC_SCOPE_AUTHORIZATION_REVISION'),
    scopeAuthorizationDigest: digest(env.SEC_SCOPE_AUTHORIZATION_DIGEST!, 'SEC_SCOPE_AUTHORIZATION_DIGEST'),
    reviewReceiptDigest: digest(env.SEC_REVIEW_RECEIPT_DIGEST!, 'SEC_REVIEW_RECEIPT_DIGEST'),
    mainHealthRevision: digest(env.SEC_MAIN_HEALTH_REVISION!, 'SEC_MAIN_HEALTH_REVISION'),
    mainHealthDigest: digest(env.SEC_MAIN_HEALTH_DIGEST!, 'SEC_MAIN_HEALTH_DIGEST'),
    trustRevision: sha(env.SEC_TRUST_REVISION!, 'SEC_TRUST_REVISION'),
    baseTreeSha: sha(env.SEC_BASE_TREE_SHA!, 'SEC_BASE_TREE_SHA'),
    actionPlanDigest: digest(env.SEC_ACTION_PLAN_DIGEST!, 'SEC_ACTION_PLAN_DIGEST'),
    executionEnvironment,
    requiredBlobs: Object.freeze(requiredBlobs)
  });
}

function parseProfile(argv: string[]): { profile: CodexDevelopmentVerificationPlanProfile; expectedHead: string | undefined } {
  let profile: CodexDevelopmentVerificationPlanProfile | null = null;
  let expectedHead: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument !== '--profile' && argument !== '--expected-head') {
      throw new Error(`Unknown CI verification argument: ${argument}.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`CI verification ${argument} requires a value.`);
    if (argument === '--profile') {
      if (profile !== null) throw new Error('CI verification --profile may only be specified once.');
      if (value !== 'quick' && value !== 'full') throw new Error('CI verification requires --profile quick|full.');
      profile = value;
    } else {
      if (expectedHead !== undefined) throw new Error('CI verification --expected-head may only be specified once.');
      expectedHead = value;
    }
    index += 1;
  }
  if (profile === null) throw new Error('CI verification requires --profile quick|full.');
  return { profile, expectedHead };
}

type ManifestBinding = {
  manifestPath: string | null;
  manifestDigest: string | null;
  manifest: CodexDevelopmentWorkPackageManifest | null;
};

function manifestBinding(
  env: NodeJS.ProcessEnv,
  sourceBlob: GitBlobBytes | null
): ManifestBinding {
  const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
  if (!manifestPath) return { manifestPath: null, manifestDigest: null, manifest: null };
  if (!/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('SEC_WORK_PACKAGE_MANIFEST_PATH must be a canonical repository-relative Work Package path.');
  }
  if (sourceBlob === null) {
    throw new Error(`Work Package manifest is unavailable at the exact candidate: ${manifestPath}.`);
  }
  const source = sourceBlob.bytes;
  if (source.byteLength > 1024 * 1024) {
    throw new Error('Work Package manifest exceeds its canonical byte limit.');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(text, manifestPath);
  return {
    manifestPath,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(source),
    manifest
  };
}

async function runCodexDevelopmentCiVerification(
  options: CodexDevelopmentCiVerificationTestOptions,
  gitOperation: AuthorityGitReadOperation
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const gitRevision = options.gitRevision;
  const trackedTreeIsClean = options.trackedTreeIsClean;
  const changedFileResolver = options.changedFiles;
  const changedRecordResolver = options.changedRecords;
  const readGitBlob = options.readGitBlob;
  const runGate = options.runGate
    ?? ((step, execution) => CodexDevelopmentRunGateProcess(repositoryRoot, step, execution));
  const writeEvidence = options.writeEvidence;
  const evidencePath = path.resolve(env.SEC_CI_VERIFICATION_EVIDENCE_PATH ?? VERIFICATION_EVIDENCE_PATH);
  let started = new Date();
  let startedAt = started.toISOString();
  let headSha: string | null = null;
  let treeSha: string | null = null;
  const prBaseRef = env.SEC_CHANGED_BASE ?? 'refs/remotes/origin/main';
  const affectedBaseRef = env.SEC_AFFECTED_TESTS_BASE ?? prBaseRef;
  let prBaseSha: string | null = null;
  let affectedBaseSha: string | null = null;
  let cleanBefore: boolean | null = null;
  let cleanAfter: boolean | null = null;
  let profile: CodexDevelopmentVerificationPlanProfile = 'quick';
  let files: string[] | null = null;
  let steps: CiVerificationGateStep[] = [];
  let actionPlan: CiVerificationActionPlanClosure | null = null;
  let actionCandidate: CiVerificationActionCandidate | null = null;
  let actionGates: readonly CodexDevelopmentVerificationGateEvidenceV4[] = [];
  let formalBinding: ReturnType<typeof formalVerificationBinding> = null;
  let failure: { stage: string; tail: string } | null = null;
  let exitCode = 0;
  let stage = 'argv';
  let binding: ManifestBinding = { manifestPath: null, manifestDigest: null, manifest: null };
  let initializationFailure: string | null = null;
  let defaultChangedSnapshot: CodexDevelopmentChangedPathSnapshot | null = null;
  let defaultBaseTreeSha: string | null = null;
  let exactCandidateBlobs: ReadonlyMap<string, GitBlobBytes> = new Map();
  let exactWorkspaceSnapshot: PhysicalWorkspaceSourceSnapshot | null = null;
  let parsedProfile: ReturnType<typeof parseProfile> | null = null;

  try {
    CodexDevelopmentPrepareVerificationEvidenceTarget(evidencePath);
  } catch (error) {
    initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  if (initializationFailure === null) {
    try {
      started = now();
      startedAt = started.toISOString();
      parsedProfile = parseProfile(argv);
      if (gitRevision !== undefined) {
        headSha = gitRevision('HEAD');
        treeSha = gitRevision('HEAD^{tree}');
        prBaseSha = gitRevision(prBaseRef);
        affectedBaseSha = gitRevision(affectedBaseRef);
      }
      if (trackedTreeIsClean !== undefined) cleanBefore = trackedTreeIsClean();
      const requiresDefaultChangedObservation = changedRecordResolver === undefined
        && changedFileResolver === undefined
        && options.transitionObservation === undefined;
      const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
      const exactBlobPaths = uniqueSorted([
        ...(options.readGitBlob === undefined ? ['config/repository/active-work-package.md'] : []),
        ...(options.readExactGitBlob === undefined
          ? [
              ...CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS,
              ...(manifestPath === undefined ? [] : [manifestPath])
            ]
          : [])
      ]);
      const requiresGitPhase = gitRevision === undefined
        || trackedTreeIsClean === undefined
        || requiresDefaultChangedObservation
        || (options.testVerificationPlan === undefined
          && options.testImpactSourceProvider === undefined)
        || exactBlobPaths.length > 0;
      if (requiresGitPhase) {
        const observed = await observeExecutionProgressPhase(
          'ci-verification',
          'preflight.git-and-exact-inputs',
          () => gitOperation.runPhase('preflight', async (session) => {
            let observedHeadSha = headSha;
            let observedTreeSha = treeSha;
            let observedPrBaseSha = prBaseSha;
            let observedAffectedBaseSha = affectedBaseSha;
            let observedCleanBefore = cleanBefore;
            let observedBaseTreeSha: string | null = null;
            let observedChangedSnapshot: CodexDevelopmentChangedPathSnapshot | null = null;
            if (gitRevision === undefined) {
              observedHeadSha = await CodexDevelopmentDefaultGitRevision(session, 'HEAD');
              observedTreeSha = await CodexDevelopmentDefaultGitRevision(session, 'HEAD^{tree}');
              observedPrBaseSha = await CodexDevelopmentDefaultGitRevision(session, prBaseRef);
              observedAffectedBaseSha = await CodexDevelopmentDefaultGitRevision(
                session,
                affectedBaseRef
              );
              observedBaseTreeSha = await CodexDevelopmentDefaultGitRevision(
                session,
                `${observedPrBaseSha}^{tree}`
              );
            }
            if (trackedTreeIsClean === undefined) {
              observedCleanBefore = await CodexDevelopmentDefaultTrackedTreeIsClean(session);
            }
            if (requiresDefaultChangedObservation
                && observedPrBaseSha !== null
                && observedHeadSha !== null) {
              observedChangedSnapshot = await CodexDevelopmentDefaultChangedPaths(
                session,
                observedPrBaseSha,
                observedHeadSha
              );
            }
            if (observedHeadSha === null) {
              throw new Error('CI Git preflight cannot acquire candidate inputs without an exact head.');
            }
            const observedExactBlobs = exactBlobPaths.length === 0
              ? new Map<string, GitBlobBytes>()
              : await CodexDevelopmentReadExactGitBlobs(
                  session,
                  observedHeadSha,
                  exactBlobPaths
                );
            const observedWorkspaceSnapshot = parsedProfile?.profile === 'quick'
                && options.testVerificationPlan === undefined
                && options.testImpactSourceProvider === undefined
              ? await CodexDevelopmentExactGitWorkspaceSourceSnapshot(session, observedHeadSha)
              : null;
            return Object.freeze({
              headSha: observedHeadSha,
              treeSha: observedTreeSha,
              prBaseSha: observedPrBaseSha,
              affectedBaseSha: observedAffectedBaseSha,
              cleanBefore: observedCleanBefore,
              baseTreeSha: observedBaseTreeSha,
              changedSnapshot: observedChangedSnapshot,
              exactBlobs: observedExactBlobs,
              workspaceSnapshot: observedWorkspaceSnapshot
            });
          })
        );
        headSha = observed.headSha;
        treeSha = observed.treeSha;
        prBaseSha = observed.prBaseSha;
        affectedBaseSha = observed.affectedBaseSha;
        cleanBefore = observed.cleanBefore;
        defaultBaseTreeSha = observed.baseTreeSha;
        defaultChangedSnapshot = observed.changedSnapshot;
        exactCandidateBlobs = observed.exactBlobs;
        exactWorkspaceSnapshot = observed.workspaceSnapshot;
      }
    } catch (error) {
      initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
    }
  }

  try {
    if (initializationFailure) throw new Error(`CI verification initialization failed: ${initializationFailure}`);
    const parsed = parsedProfile;
    if (parsed === null) throw new Error('CI verification profile was not parsed.');
    profile = parsed.profile;
    stage = 'preflight';
    if (!headSha || !treeSha || !prBaseSha || !affectedBaseSha) {
      throw new Error('CI verification cannot resolve exact head/tree/two bases.');
    }
    const exactHeadSha = headSha;
    assertCiExpectedHead(headSha, parsed.expectedHead ?? env.SEC_EXPECTED_HEAD_SHA);
    if (!cleanBefore) throw new Error('CI verification requires a clean complete worktree before execution.');
    stage = 'manifest';
    const configuredManifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
    const manifestBlob = configuredManifestPath === undefined
      ? null
      : options.readExactGitBlob !== undefined
        ? options.readExactGitBlob({
            repositoryRoot,
            commitSha: headSha,
            maxBytes: 1024 * 1024,
            repositoryPath: configuredManifestPath
          })
        : exactCandidateBlobs.get(configuredManifestPath) ?? null;
    binding = manifestBinding(env, manifestBlob);
    stage = 'preflight';
    if (binding.manifest !== null && binding.manifest.base !== prBaseSha) {
      throw new Error('Work Package manifest base does not match the exact PR base.');
    }
    if (binding.manifestPath !== null && prBaseSha !== affectedBaseSha) {
      throw new Error('Frozen verification requires the exact affected base to equal the current PR base.');
    }
    formalBinding = formalVerificationBinding(env);
    let rawChangedFiles: string[] | null;
    let transitionObservation: CodexDevelopmentTestImpactTransitionObservation | undefined;
    let injectedChangedRecords: CodexDevelopmentGitChangedRecord[] | null | undefined;
    if (changedRecordResolver) {
      const changedRecords = changedRecordResolver(prBaseSha);
      injectedChangedRecords = changedRecords;
      rawChangedFiles = changedRecords === null
        ? null
        : CodexDevelopmentChangedFilesFromRecords(changedRecords);
      transitionObservation = options.transitionObservation;
    } else if (changedFileResolver) {
      if (options.transitionObservation !== undefined) {
        throw new Error('CI verification transition injection requires the exact changed-record test seam.');
      }
      rawChangedFiles = changedFileResolver(prBaseSha);
    } else {
      if (options.transitionObservation !== undefined) {
        throw new Error('CI verification transition injection requires an explicit changed-input test seam.');
      }
      if (defaultChangedSnapshot === null) {
        throw new Error('CI verification did not receive its default changed-path observation.');
      }
      rawChangedFiles = defaultChangedSnapshot.files;
      transitionObservation = defaultChangedSnapshot.transitionObservation;
    }
    if (rawChangedFiles !== null && transitionObservation !== undefined) {
      CodexDevelopmentAssertTestImpactTransitionSelection({
        baseSha: prBaseSha,
        headSha,
        changedPaths: rawChangedFiles,
        ...(injectedChangedRecords === undefined || injectedChangedRecords === null
          ? {}
          : { records: injectedChangedRecords }),
        observation: transitionObservation
      });
    }
    // Selection consumes the same immutable candidate generation regardless
    // of how the changed-path observation was obtained. Injected paths can
    // vary the transition input in tests, but cannot inject or suppress the
    // Source Program authority used to interpret those paths.
    const plan = options.testVerificationPlan ?? (() => {
      const testImpactProvider = profile === 'full'
        ? null
        : options.testImpactSourceProvider
          ?? (exactWorkspaceSnapshot === null
            ? null
            : CodexDevelopmentTestImpactSourceProviderFromSnapshot(
                exactWorkspaceSnapshot,
                repositoryRoot
              ));
      if (profile === 'quick' && testImpactProvider === null) {
        throw new Error('CI verification did not receive an owner-issued exact test-impact source provider.');
      }
      return CodexDevelopmentBuildVerificationPlan(
        profile,
        rawChangedFiles,
        testImpactProvider,
        transitionObservation
      );
    })();
    files = plan.changedFiles;
    steps = plan.gates;
    if (steps.some((step) => step.phase === 'risk')) {
      console.log(`CI verification: risk gate required; reasons=[${plan.selectionReasons.join(', ')}]; owners=[${plan.affectedOwners.join(', ')}]`);
    } else {
      console.log('CI verification: no slow/workspace risk impact detected; risk gate skipped.');
    }
    if (!plan.selectionResolved) throw new Error('CI verification changed-file selection is unresolved.');

    console.log(`SEC verification contract revision: ${CI_VERIFICATION_CONTRACT_REVISION}`);
    console.log(`SEC verification profile: ${profile}`);
    console.log(`SEC verification exact head: ${headSha}`);
    console.log(`SEC verification tree: ${treeSha}`);
    console.log(`SEC verification PR base: ${prBaseSha}`);
    console.log(`SEC verification affected base: ${affectedBaseSha}`);

    stage = 'gates';
    const fallbackManifestPath = 'config/repository/active-work-package.md';
    const fallbackManifest = readGitBlob === undefined
      ? exactCandidateBlobs.get(fallbackManifestPath) ?? null
      : readGitBlob(headSha, fallbackManifestPath);
    if (binding.manifestPath === null && fallbackManifest === null) {
      throw new Error('CI Action producer cannot bind a manifest/control-plane blob.');
    }
    const baseTreeSha = formalBinding?.baseTreeSha
      ?? (gitRevision === undefined
        ? defaultBaseTreeSha
        : gitRevision(`${prBaseSha}^{tree}`));
    if (baseTreeSha === null) throw new Error('CI Action producer cannot resolve the exact base tree.');
    const localDigest = (value: unknown): `sha256:${string}` => (
      CodexDevelopmentVerificationDigest(value) as `sha256:${string}`
    );
    const executionEnvironment = formalBinding !== null
      ? formalBinding.executionEnvironment
      : createCiVerificationLocalExecutionEnvironment({
          os: process.platform,
          arch: process.arch,
          bunVersion: Bun.version
        });
    const localDependencyBlobs = formalBinding === null
      ? CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath) => {
          const blob = options.readExactGitBlob === undefined
            ? exactCandidateBlobs.get(dependencyPath) ?? null
            : options.readExactGitBlob({
                repositoryRoot,
                commitSha: exactHeadSha,
                repositoryPath: dependencyPath
              });
          if (blob === null || blob.type !== 'blob') {
            throw new Error(`Local VerificationAction dependency input is unavailable: ${dependencyPath}.`);
          }
          return Object.freeze({
            path: dependencyPath,
            digest: `sha256:${createHash('sha256').update(blob.bytes).digest('hex')}` as VerificationActionKeyDigest
          });
        })
      : [];
    const candidate: CiVerificationActionCandidate = {
      baseSha: prBaseSha,
      baseTreeSha,
      headSha,
      headTreeSha: treeSha,
      manifestPath: binding.manifestPath ?? fallbackManifestPath,
      manifestDigest: (binding.manifestDigest ?? localDigest(fallbackManifest!.bytes)) as `sha256:${string}`,
      scopeAuthorizationRevision: formalBinding?.scopeAuthorizationRevision ?? localDigest({
        baseSha: prBaseSha, baseTreeSha, headSha, headTreeSha: treeSha, files
      }),
      profile,
      toolchainRevision: executionEnvironment.toolchainRevision,
      providerRevision: executionEnvironment.executionEnvironmentRevision,
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      requiredBlobs: formalBinding?.requiredBlobs ?? localDependencyBlobs
    };
    actionCandidate = candidate;
    const producerGates: readonly CiVerificationProducerGate[] = steps.map(ciVerificationGateStep);
    const descriptors = producerGates.map((gate) => Object.freeze({
      gate,
      env: {
        ...env,
        SEC_TEST_WORKSPACE_NAMESPACE: `verification-${gate.id.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`
      }
    }));
    actionPlan = buildCiVerificationActionPlanClosure({ candidate, gates: producerGates });
    if (formalBinding !== null && actionPlan.actionPlanDigest !== formalBinding.actionPlanDigest) {
      throw new Error('Formal hosted Action plan digest differs from the trusted dispatcher reconstruction.');
    }
    const actionExecution = await CodexDevelopmentExecuteCiActionClosure({
      repositoryRoot,
      actionPlan,
      gates: descriptors,
      headSha,
      now,
      runGate: async (descriptor, execution) => {
        console.log(`::group::SEC verification: ${descriptor.id}`);
        try {
          return await runGate(descriptor, execution);
        } finally {
          console.log('::endgroup::');
        }
      },
      actionRunner: options.actionRunner,
      readDurableActionResult: options.readDurableActionResult
    });
    actionGates = actionExecution.gates;
    if (actionExecution.failed) {
      exitCode = 1;
      const failedGate = actionGates.find((gate) => gate.result.status !== 'passed');
      failure = {
        stage: `gate:${failedGate?.result.gateId ?? 'unknown'}`,
        tail: failedGate?.result.diagnostic ?? 'CI Action plan did not pass.'
      };
    }
  } catch (error) {
    exitCode = exitCode || 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    failure ??= { stage, tail: CodexDevelopmentFailureTail(message, 'CI verification failed.') };
    console.error(message);
  } finally {
    let finalObservationStage = 'exact-identity';
    try {
      let finalHead: string | null = null;
      let finalTree: string | null = null;
      if (headSha !== null && treeSha !== null && gitRevision !== undefined) {
        finalHead = gitRevision('HEAD');
        finalTree = gitRevision('HEAD^{tree}');
      }
      if (trackedTreeIsClean !== undefined) {
        finalObservationStage = 'clean-state';
        cleanAfter = trackedTreeIsClean();
      }
      if (gitRevision === undefined || trackedTreeIsClean === undefined) {
        await gitOperation.runPhase('readback', async (session) => {
          if (headSha !== null && treeSha !== null && gitRevision === undefined) {
            finalObservationStage = 'exact-identity';
            finalHead = await CodexDevelopmentDefaultGitRevision(session, 'HEAD');
            finalTree = await CodexDevelopmentDefaultGitRevision(session, 'HEAD^{tree}');
          }
          if (trackedTreeIsClean === undefined) {
            finalObservationStage = 'clean-state';
            cleanAfter = await CodexDevelopmentDefaultTrackedTreeIsClean(session);
          }
        });
      }
      if (headSha !== null && treeSha !== null) {
        if (finalHead !== headSha || finalTree !== treeSha) {
          exitCode = 1;
          failure ??= { stage: 'exact-identity', tail: 'CI verification exact head or tree changed during execution.' };
        }
      }
    } catch (error) {
      cleanAfter = null;
      exitCode = 1;
      failure ??= {
        stage: finalObservationStage,
        tail: CodexDevelopmentFailureTail(
          error instanceof Error ? error.stack ?? error.message : String(error),
          finalObservationStage === 'exact-identity'
            ? 'Exact identity recheck failed.'
            : 'Clean-state probe failed.'
        )
      };
    }
    if (cleanAfter !== true && exitCode === 0) {
      exitCode = 1;
      failure = { stage: 'clean-state', tail: 'CI verification left the complete worktree dirty or unresolved.' };
    }
    let finished = new Date(Math.max(Date.now(), started.getTime()));
    try {
      finished = now();
    } catch (error) {
      exitCode = 1;
      failure = {
        stage: 'clock',
        tail: CodexDevelopmentFailureTail(
          error instanceof Error ? error.stack ?? error.message : String(error),
          'Clock probe failed.'
        )
      };
    }
    try {
      if (actionPlan === null || actionCandidate === null) {
        throw new Error('CI verification did not construct a canonical Action plan; V2/V3 fallback publication is retired.');
      }
      const finalGates = [...actionGates];
      if (exitCode !== 0 && finalGates.every((gate) => gate.result.status === 'passed') && finalGates.length > 0) {
        const last = finalGates.at(-1)!;
        finalGates[finalGates.length - 1] = {
          ...last,
          cleanup: {
            status: 'failed',
            evidenceRefs: [],
            diagnostic: failure?.tail ?? 'Post-action exact identity or cleanup failed.'
          }
        };
      }
      const status = finalGates.some((gate) => gate.cleanup.status === 'failed' || gate.result.status === 'failed')
        ? 'failed' as const
        : finalGates.some((gate) => gate.result.status === 'invalidated') ? 'invalidated' as const
          : finalGates.some((gate) => gate.result.status === 'unsupported') ? 'unsupported' as const
            : finalGates.some((gate) => gate.result.status === 'not-run') ? 'not-run' as const
              : 'passed' as const;
      const localBindingDigest = (value: unknown): `sha256:${string}` => (
        CodexDevelopmentVerificationDigest(value) as `sha256:${string}`
      );
      const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
        contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
        sessionRevision: formalBinding?.sessionRevision ?? CI_VERIFICATION_SESSION_CONTRACT_REVISION,
        sessionProposalDigest: formalBinding?.sessionProposalDigest ?? localBindingDigest({
          actionPlanDigest: actionPlan.actionPlanDigest,
          scopeAuthorizationRevision: actionCandidate.scopeAuthorizationRevision,
          baseSha: actionCandidate.baseSha,
          headSha: actionCandidate.headSha
        }),
        scopeAuthorizationRevision: actionCandidate.scopeAuthorizationRevision,
        scopeAuthorizationDigest: formalBinding?.scopeAuthorizationDigest ?? actionCandidate.scopeAuthorizationRevision,
        reviewReceiptDigest: formalBinding?.reviewReceiptDigest ?? localBindingDigest('local-nonformal-review'),
        mainHealthRevision: formalBinding?.mainHealthRevision ?? localBindingDigest('local-nonformal-main-health-revision'),
        mainHealthDigest: formalBinding?.mainHealthDigest ?? localBindingDigest('local-nonformal-main-health'),
        trustRevision: formalBinding?.trustRevision ?? actionCandidate.baseSha,
        profile,
        baseSha: actionCandidate.baseSha,
        baseTreeSha: actionCandidate.baseTreeSha,
        headSha: actionCandidate.headSha,
        headTreeSha: actionCandidate.headTreeSha,
        manifestPath: actionCandidate.manifestPath,
        manifestDigest: actionCandidate.manifestDigest,
        producer: CodexDevelopmentCreateVerificationEvidenceProducer({
          sourceTransport: formalBinding?.mode === 'github-actions' ? 'github-actions' : 'local-dev-runner',
          workflowPath: formalBinding?.mode === 'github-actions'
            ? '.github/workflows/compiler-pr-validation.yml'
            : formalBinding?.mode === 'trusted-runtime'
              ? CI_VERIFICATION_WORKFLOW_PATH
              : DEV_RUNNER_ENTRYPOINT_PATH,
          workflowRef: formalBinding?.mode === 'github-actions'
            ? (env.SEC_TRUSTED_WORKFLOW_REF ?? '')
            : `${formalBinding?.mode === 'trusted-runtime'
              ? CI_VERIFICATION_WORKFLOW_PATH
              : DEV_RUNNER_ENTRYPOINT_PATH}@${actionCandidate.baseSha}`,
          workflowSha: formalBinding?.mode === 'github-actions'
            ? (env.GITHUB_WORKFLOW_SHA ?? '')
            : actionCandidate.baseSha,
          runId: formalBinding?.mode === 'trusted-runtime'
            ? env.SEC_TRUSTED_RUNTIME_EXECUTION_ID!
            : env.GITHUB_RUN_ID ?? 'local-run',
          runAttempt: formalBinding?.mode === 'trusted-runtime'
            ? 1
            : Number(env.GITHUB_RUN_ATTEMPT ?? '1'),
          actorNodeId: formalBinding?.mode === 'trusted-runtime'
            ? env.SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID!
            : env.SEC_WORKFLOW_ACTOR_NODE_ID ?? 'local-dev-runner'
        }),
        actionPlan,
        status,
        startedAt,
        finishedAt: finished.toISOString(),
        gates: finalGates,
        evidenceRefs: finalGates.flatMap((gate) => gate.result.evidenceRefs),
        invalidationRules: [
          ...INVALIDATION_RULES,
          'session, scope authorization, Action closure, Review receipt, MainHealth, or trust revision changes'
        ]
      });
      if (writeEvidence) writeEvidence(evidencePath, evidence);
      else CodexDevelopmentWriteVerificationEvidenceV4Atomic(evidencePath, evidence);
      console.log(`SEC verification evidence: ${evidencePath}`);
      console.log(`SEC_VERIFICATION_SUMMARY ${JSON.stringify(evidence)}`);
    } catch (error) {
      exitCode = 1;
      console.error(`SEC verification evidence write failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
  return exitCode;
}

async function runCiVerificationWithGitRead(
  repositoryRoot: string,
  deadlineAtUnixMs: number,
  options: CodexDevelopmentCiVerificationTestOptions
): Promise<number> {
  return withAuthorityGitReadOperation({
    cwd: repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET,
    deadlineAtUnixMs
  }, (gitOperation) => runCodexDevelopmentCiVerification(options, gitOperation));
}

async function executeCodexDevelopmentCiVerification(
  options: CodexDevelopmentCiVerificationTestOptions
): Promise<number> {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const deadlineAtUnixMs = Date.now()
    + CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds * 1_000;
  return runCiVerificationWithGitRead(repositoryRoot, deadlineAtUnixMs, options);
}

/** Production CLI entry. Provider and repository observations are never caller-injected. */
export async function CodexDevelopmentCiVerificationMain(): Promise<number> {
  return executeCodexDevelopmentCiVerification({});
}

/** Test-only execution harness; production modules must not import this entry. */
export async function CodexDevelopmentCiVerificationMainForTests(
  options: CodexDevelopmentCiVerificationTestOptions
): Promise<number> {
  return executeCodexDevelopmentCiVerification(options);
}

const HOSTED_ACTION_COMMANDS = new Set([
  'ensure-hosted-action-provider',
  'resolve-hosted-action',
  'prepare-hosted-action-inputs',
  'execute-trusted-bootstrap-sut',
  'self-test-hosted-action-sandbox',
  'execute-hosted-action-sut',
  'assemble-hosted-action-terminal',
  'compose-hosted-evidence'
]);

function hostedActionCliArgs(
  argv: readonly string[],
  allowed: readonly string[]
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const allow = new Set(allowed);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--json') continue;
    if (!allow.has(flag) || result.has(flag)) throw new Error(`Unknown or repeated ${argv[0]} flag: ${flag}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires one value.`);
    result.set(flag, value);
    index += 1;
  }
  for (const flag of allowed) if (!result.has(flag)) throw new Error(`${argv[0]} requires ${flag}.`);
  return result;
}

function writeHostedActionJson(filePath: string, value: unknown): void {
  const absolute = path.resolve(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const bytes = `${encodeVerificationActionData(value)}\n`;
  writeFileSync(absolute, bytes, 'utf8');
  if (readFileSync(absolute, 'utf8') !== bytes) throw new Error('Hosted Action JSON readback mismatch.');
}

function positiveEnvironmentInteger(name: string): number {
  const value = process.env[name];
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} exceeds the safe integer range.`);
  return parsed;
}

function hostedActionGhReadJson(args: readonly string[], label: string): unknown {
  const result = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`${label} readback failed: ${String(result.error ?? result.stderr).slice(0, 512)}`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error(`${label} readback is not JSON: ${String(error).slice(0, 512)}`);
  }
}

function hostedActionRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function hostedActionCanonicalFile<T>(
  filePath: string,
  parser: (value: unknown) => T,
  label: string
): T {
  const source = readFileSync(path.resolve(filePath), 'utf8');
  const value = parser(JSON.parse(source) as unknown);
  if (source !== `${encodeVerificationActionData(value)}\n`) {
    throw new Error(`${label} is not one exact canonical JSON line.`);
  }
  return value;
}

function hostedActionParentActor(repository: string): CiVerificationActionParentActor {
  const event = hostedActionRecord(
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')) as unknown,
    'parent Session event'
  );
  const sender = hostedActionRecord(event.sender, 'parent Session sender');
  const login = sender.login;
  const id = sender.id;
  const nodeId = sender.node_id;
  if (typeof login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login) ||
      !Number.isSafeInteger(id) || Number(id) < 1 || typeof nodeId !== 'string' || nodeId.length === 0 ||
      sender.type !== 'User' || process.env.GITHUB_ACTOR !== login || process.env.GITHUB_TRIGGERING_ACTOR !== login) {
    throw new Error('parent Session event sender is not one exact human principal.');
  }
  const permissionReadback = hostedActionRecord(hostedActionGhReadJson([
    `/repos/${repository}/collaborators/${login}/permission`
  ], 'parent actor permission'), 'parent actor permission');
  const user = hostedActionRecord(permissionReadback.user, 'parent actor permission user');
  const permission = permissionReadback.permission;
  if ((permission !== 'maintain' && permission !== 'admin') || user.login !== login || user.id !== id ||
      user.node_id !== nodeId || user.type !== 'User') {
    throw new Error('parent Session actor lacks exact live maintain/admin authority.');
  }
  return Object.freeze({
    login,
    id: Number(id),
    nodeId,
    type: 'User' as const,
    permission
  });
}

function hostedActionParentJobId(repository: string, runId: string, runAttempt: number): string {
  const jobs: Record<string, unknown>[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const response = hostedActionRecord(hostedActionGhReadJson([
      `/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100&page=${page}`
    ], `parent job page ${page}`), `parent job page ${page}`);
    if (!Array.isArray(response.jobs) || response.jobs.length > 100) {
      throw new Error(`parent job page ${page} is incomplete.`);
    }
    jobs.push(...response.jobs.map((entry, index) =>
      hostedActionRecord(entry, `parent job page ${page}[${index}]`)
    ));
    if (response.jobs.length < 100) break;
    if (page === 1000) throw new Error('parent job pagination exceeded the bounded census.');
  }
  const expectedSha = process.env.GITHUB_WORKFLOW_SHA;
  const matches = jobs.filter((job) => job.name === 'coordinate-verification-session' &&
    String(job.run_id ?? '') === runId && job.run_attempt === runAttempt && job.head_sha === expectedSha &&
    (job.status === 'in_progress' || job.status === 'completed'));
  if (matches.length !== 1 || !/^[1-9][0-9]*$/u.test(String(matches[0]!.id ?? ''))) {
    throw new Error('parent Session coordinator job is not one exact current provider job.');
  }
  return String(matches[0]!.id);
}

export function CodexDevelopmentAssertHostedActionParentEvent(
  eventValue: unknown,
  sessionRequest: VerificationSessionHostedRequest
): void {
  const event = hostedActionRecord(eventValue, 'parent Session event');
  const expectedClientPayload = Object.freeze({ payload: sessionRequest });
  if (event.action !== CI_VERIFICATION_SESSION_DISPATCH_TYPE ||
      encodeVerificationActionData(event.client_payload) !==
        encodeVerificationActionData(expectedClientPayload)) {
    throw new Error('parent dispatch plan event does not contain the exact Session request wrapper.');
  }
}

function createHostedActionParentPlan(input: Readonly<{
  sessionRequest: VerificationSessionHostedRequest;
  envelope: VerificationSessionHostedEnvelope;
}>): CiVerificationActionParentDispatchPlan {
  const repositoryIdentity = hostedActionRepositoryIdentity();
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const runAttempt = positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT');
  const workflowSha = process.env.GITHUB_WORKFLOW_SHA ?? '';
  const workflowRef = process.env.GITHUB_WORKFLOW_REF ?? '';
  if (!/^[1-9][0-9]*$/u.test(runId) || !/^[0-9a-f]{40}$/u.test(workflowSha) ||
      workflowSha !== input.sessionRequest.expectedBaseSha ||
      workflowRef !== `${repositoryIdentity.repository}/.github/workflows/compiler-pr-validation.yml@refs/heads/main` ||
      process.env.GITHUB_JOB !== 'coordinate-verification-session') {
    throw new Error('parent dispatch plan is not running in the exact trusted Session coordinator.');
  }
  CodexDevelopmentAssertHostedActionParentEvent(
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')) as unknown,
    input.sessionRequest
  );
  const proposals = input.envelope.actionPlanClosure.actions.map((member) =>
    createCiVerificationActionProposal({
      sessionRequest: input.sessionRequest,
      proposedActionKey: member.action.actionKey
    })
  );
  for (const proposal of proposals) {
    CodexDevelopmentResolveHostedAction({
      request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(proposal)),
      envelope: input.envelope
    });
  }
  return createCiVerificationActionParentDispatchPlan({
    repositoryId: String(repositoryIdentity.repositoryId),
    repository: repositoryIdentity.repository,
    parentRunId: runId,
    parentRunAttempt: runAttempt,
    parentJobId: hostedActionParentJobId(repositoryIdentity.repository, runId, runAttempt),
    parentWorkflowRef: workflowRef,
    parentWorkflowSha: workflowSha,
    parentActor: hostedActionParentActor(repositoryIdentity.repository),
    proposals
  });
}

function hostedActionParentContext(input: Readonly<{
  requestPath: string;
  envelopePath: string;
  parentPlanPath: string;
  parentArtifactId: string;
  parentArtifactArchiveDigest: string;
}>): Readonly<{
  sessionRequest: VerificationSessionHostedRequest;
  envelope: VerificationSessionHostedEnvelope;
  parentPlan: CiVerificationActionParentDispatchPlan;
  providerEnvelopes: readonly CiVerificationActionProviderEnvelope[];
}> {
  const sessionRequest = parseVerificationSessionHostedRequest(
    readFileSync(path.resolve(input.requestPath), 'utf8')
  );
  const envelope = parseHostedEnvelope(
    JSON.parse(readFileSync(path.resolve(input.envelopePath), 'utf8')) as unknown
  );
  const parentPlan = hostedActionCanonicalFile(
    input.parentPlanPath,
    parseCiVerificationActionParentDispatchPlan,
    'parent dispatch plan'
  );
  const expectedProposals = envelope.actionPlanClosure.actions.map((member) =>
    createCiVerificationActionProposal({ sessionRequest, proposedActionKey: member.action.actionKey })
  ).sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  if (encodeVerificationActionData(parentPlan.proposals) !== encodeVerificationActionData(expectedProposals)) {
    throw new Error('parent dispatch plan proposals differ from the exact hosted Action closure.');
  }
  if (!/^[1-9][0-9]*$/u.test(input.parentArtifactId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.parentArtifactArchiveDigest)) {
    throw new Error('parent dispatch plan artifact identity is invalid.');
  }
  const providerEnvelopes = parentPlan.proposals.map((proposal) =>
    createCiVerificationActionProviderEnvelope({
      proposal,
      parentPlan,
      parentDispatchPlanArtifactId: input.parentArtifactId,
      parentDispatchPlanArchiveDigest: input.parentArtifactArchiveDigest as VerificationActionKeyDigest
    })
  );
  return Object.freeze({ sessionRequest, envelope, parentPlan, providerEnvelopes: Object.freeze(providerEnvelopes) });
}

function hostedActionChildContext(input: Readonly<{
  providerEnvelopePath: string;
  envelopePath: string;
  resolutionPath?: string;
}>): Readonly<{
  providerEnvelope: CiVerificationActionProviderEnvelope;
  envelope: VerificationSessionHostedEnvelope;
  resolution: CodexDevelopmentHostedActionResolution;
}> {
  const providerEnvelope = hostedActionCanonicalFile(
    input.providerEnvelopePath,
    parseCiVerificationActionProviderEnvelope,
    'internal Action provider envelope'
  );
  const envelope = parseHostedEnvelope(
    JSON.parse(readFileSync(path.resolve(input.envelopePath), 'utf8')) as unknown
  );
  const resolution = CodexDevelopmentResolveHostedAction({
    request: CodexDevelopmentParseHostedActionRequest(
      encodeVerificationActionData(providerEnvelope.proposal)
    ),
    envelope
  });
  if (input.resolutionPath !== undefined) {
    const supplied = CodexDevelopmentParseHostedActionResolution(
      readFileSync(path.resolve(input.resolutionPath), 'utf8')
    );
    if (encodeVerificationActionData(supplied) !== encodeVerificationActionData(resolution)) {
      throw new Error('caller Action resolution differs from the authenticated provider envelope.');
    }
  }
  return Object.freeze({ providerEnvelope, envelope, resolution });
}

async function observeHostedActionState(input: Readonly<{
  providerEnvelope: CiVerificationActionProviderEnvelope;
  envelope: VerificationSessionHostedEnvelope;
  role: 'parent' | 'child';
}>): Promise<Readonly<{
  index: CodexDevelopmentHostedActionProviderIndex;
  decision: VerificationActionProviderDecision;
}>> {
  const result = await ensureVerificationActionGitHubProviderTransaction({
    authority: {
      envelope: input.providerEnvelope,
      actionPlanClosure: input.envelope.actionPlanClosure
    },
    intent: { kind: input.role === 'parent' ? 'coordinate-parent' : 'coordinate' }
  });
  if (result.disposition !== 'observed') {
    throw new Error(`hosted Action provider observation returned ${result.disposition}.`);
  }
  const index = hostedActionProviderIndexFromSnapshot(result.snapshot);
  const resolution = CodexDevelopmentResolveHostedAction({
    request: CodexDevelopmentParseHostedActionRequest(
      encodeVerificationActionData(input.providerEnvelope.proposal)
    ),
    envelope: input.envelope
  });
  const decision = CodexDevelopmentReduceHostedActionProviderIndex({
    resolution,
    ...hostedActionRepositoryIdentity(),
    index
  });
  return Object.freeze({ index, decision });
}


async function readParentPlanObservation(
  authority: ReturnType<typeof hostedActionParentContext>
): Promise<string> {
  const first = authority.providerEnvelopes[0];
  if (first === undefined) throw new Error('parent dispatch plan has no Action proposal.');
  const observed = await observeHostedActionState({
    providerEnvelope: first,
    envelope: authority.envelope,
    role: 'parent'
  });
  return JSON.stringify({
    status: 'verified',
    parentDispatchPlanDigest: authority.parentPlan.parentDispatchPlanDigest,
    parentArtifactPayloadDigest: first.parentDispatchPlanPayloadDigest,
    firstActionDisposition: observed.decision.disposition
  });
}

async function coordinateHostedSessionProvider(input: Readonly<{
  authority: ReturnType<typeof hostedActionParentContext>;
  allowDispatch: boolean;
}>): Promise<Readonly<{
  artifactIndex: CodexDevelopmentHostedActionProviderIndex;
  coordination: CodexDevelopmentHostedActionCoordination;
  dispatched: number;
}>> {
  const terminalObservations: CodexDevelopmentHostedActionArtifactObservation[] = [];
  const startObservations: VerificationActionProviderStartObservation[] = [];
  const terminalAnchorObservations: VerificationActionProviderTerminalAnchorObservation[] = [];
  const providerStatusReadbacks: VerificationActionProviderStatusReadback[] = [];
  const envelopesByKey = new Map<VerificationActionKeyDigest, CiVerificationActionProviderEnvelope>();
  for (const providerEnvelope of input.authority.providerEnvelopes) {
    const observed = await observeHostedActionState({
      providerEnvelope,
      envelope: input.authority.envelope,
      role: 'parent'
    });
    terminalObservations.push(...observed.index.terminalObservations);
    startObservations.push(...observed.index.startObservations);
    terminalAnchorObservations.push(...observed.index.terminalAnchorObservations);
    providerStatusReadbacks.push(...observed.index.providerStatusReadbacks);
    envelopesByKey.set(providerEnvelope.proposal.proposedActionKey, providerEnvelope);
  }
  const artifactIndex = Object.freeze({
    schema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA,
    terminalObservations: Object.freeze(terminalObservations),
    startObservations: Object.freeze(startObservations),
    terminalAnchorObservations: Object.freeze(terminalAnchorObservations),
    providerStatusReadbacks: Object.freeze(providerStatusReadbacks)
  });
  const coordination = CodexDevelopmentCoordinateHostedActions({
    envelope: input.authority.envelope,
    observations: artifactIndex.terminalObservations,
    startObservations: artifactIndex.startObservations,
    terminalAnchorObservations: artifactIndex.terminalAnchorObservations,
    providerStatusReadbacks: artifactIndex.providerStatusReadbacks
  });
  let dispatched = 0;
  if (input.allowDispatch && coordination.disposition === 'dispatch') {
    for (const actionKey of coordination.dispatchActionKeys) {
      const providerEnvelope = envelopesByKey.get(actionKey);
      if (providerEnvelope === undefined) {
        throw new Error('coordinator selected an Action outside the authenticated parent plan.');
      }
      const result = await ensureVerificationActionGitHubProviderTransaction({
        authority: {
          envelope: providerEnvelope,
          actionPlanClosure: input.authority.envelope.actionPlanClosure
        },
        intent: { kind: 'dispatch-child' }
      });
      if (result.disposition !== 'dispatched') {
        throw new Error(`internal Action wake-up was not accepted: ${result.reason ?? result.disposition}.`);
      }
      dispatched += 1;
    }
  }
  return Object.freeze({ artifactIndex, coordination, dispatched });
}

export async function CodexDevelopmentCiVerificationHostedActionCli(argv: string[]): Promise<string> {
  const command = argv[0];
  const commandHandlers: Readonly<Record<string, () => Promise<string>>> = Object.freeze({
    'execute-trusted-bootstrap-sut': async () => {
      const args = hostedActionCliArgs(argv, [
        '--base-root', '--candidate-root', '--output-directory', '--base-sha',
        '--head-sha', '--tree-sha', '--manifest-path'
      ]);
      const result = await CodexDevelopmentExecuteTrustedBootstrapSut({
        baseRoot: args.get('--base-root')!,
        candidateRoot: args.get('--candidate-root')!,
        outputDirectory: args.get('--output-directory')!,
        baseSha: args.get('--base-sha')!,
        headSha: args.get('--head-sha')!,
        treeSha: args.get('--tree-sha')!,
        manifestPath: args.get('--manifest-path')!
      });
      return JSON.stringify(result);
    },
    'ensure-hosted-action-provider': async () => {
      const intentIndex = argv.indexOf('--intent');
      const intent = intentIndex >= 0 ? argv[intentIndex + 1] : undefined;
      const createParentSessionIntentHandler = (
        mode: 'verify-parent-plan' | 'coordinate-session' | 'observe-session'
      ): (() => Promise<string>) => async () => {
          const allowed = [
            '--intent', '--request', '--envelope', '--parent-plan', '--parent-artifact-id',
            '--parent-artifact-archive-digest', ...(mode === 'verify-parent-plan' ? [] : ['--artifact-index'])
          ];
          const args = hostedActionCliArgs(argv, allowed);
          const authority = hostedActionParentContext({
            requestPath: args.get('--request')!,
            envelopePath: args.get('--envelope')!,
            parentPlanPath: args.get('--parent-plan')!,
            parentArtifactId: args.get('--parent-artifact-id')!,
            parentArtifactArchiveDigest: args.get('--parent-artifact-archive-digest')!
          });
        if (mode === 'verify-parent-plan') {
            return readParentPlanObservation(authority);
        }
          const coordinated = await coordinateHostedSessionProvider({
            authority,
            allowDispatch: mode === 'coordinate-session'
          });
          writeHostedActionJson(args.get('--artifact-index')!, coordinated.artifactIndex);
          return JSON.stringify({
            ...coordinated.coordination,
            dispatched: coordinated.dispatched,
            artifactIndex: path.resolve(args.get('--artifact-index')!)
          });
      };
      const intentHandlers: Readonly<Record<string, () => Promise<string>>> = Object.freeze({
        'prepare-parent-plan': async () => {
          const args = hostedActionCliArgs(argv, ['--intent', '--request', '--envelope', '--output']);
          const sessionRequest = parseVerificationSessionHostedRequest(
            readFileSync(path.resolve(args.get('--request')!), 'utf8')
          );
          const envelope = parseHostedEnvelope(
            JSON.parse(readFileSync(path.resolve(args.get('--envelope')!), 'utf8')) as unknown
          );
          const parentPlan = createHostedActionParentPlan({ sessionRequest, envelope });
          writeHostedActionJson(args.get('--output')!, parentPlan);
          return JSON.stringify({
            status: 'prepared',
            artifactName: ciVerificationActionParentDispatchPlanArtifactName(
              parentPlan.parentRunId,
              parentPlan.parentRunAttempt
            ),
            payloadDigest: ciVerificationActionParentDispatchPlanPayloadDigest(parentPlan),
            parentDispatchPlanDigest: parentPlan.parentDispatchPlanDigest,
            proposalCount: parentPlan.proposals.length,
            output: path.resolve(args.get('--output')!)
          });
        },
        'verify-parent-plan': createParentSessionIntentHandler('verify-parent-plan'),
        'coordinate-session': createParentSessionIntentHandler('coordinate-session'),
        'observe-session': createParentSessionIntentHandler('observe-session'),
        'observe-action': async () => {
          const args = hostedActionCliArgs(argv, [
            '--intent', '--provider-envelope', '--envelope', '--resolution', '--artifact-index'
          ]);
          const authority = hostedActionChildContext({
            providerEnvelopePath: args.get('--provider-envelope')!,
            envelopePath: args.get('--envelope')!,
            resolutionPath: args.get('--resolution')!
          });
          const observed = await observeHostedActionState({
            providerEnvelope: authority.providerEnvelope,
            envelope: authority.envelope,
            role: 'child'
          });
          writeHostedActionJson(args.get('--artifact-index')!, observed.index);
          return JSON.stringify({
            ...observed.decision,
            artifactIndex: path.resolve(args.get('--artifact-index')!)
          });
        },
        'prepare-start-marker': async () => {
          const args = hostedActionCliArgs(argv, [
            '--intent', '--provider-envelope', '--envelope', '--resolution',
            '--prepared-candidate-archive', '--base-dependency-closure-digest',
            '--authenticated-git-closure-digest', '--output'
          ]);
          const authority = hostedActionChildContext({
            providerEnvelopePath: args.get('--provider-envelope')!,
            envelopePath: args.get('--envelope')!,
            resolutionPath: args.get('--resolution')!
          });
          const archiveInventory = CodexDevelopmentInspectHostedActionArchive({
            resolution: authority.resolution,
            preparedCandidateArchive: args.get('--prepared-candidate-archive')!,
            baseDependencyClosureDigest:
              args.get('--base-dependency-closure-digest')! as VerificationActionKeyDigest,
            authenticatedGitClosureDigest:
              args.get('--authenticated-git-closure-digest')! as VerificationActionKeyDigest
          });
          const sandboxCapability = await CodexDevelopmentProbeHostedSutSandboxCapability({
            actionKey: authority.resolution.actionPlan.action.actionKey
          });
          if (sandboxCapability.state === 'unknown') {
            throw new Error(`Hosted Action sandbox pre-start capability is an ambiguous machine observation: ${
              sandboxCapability.diagnostic ?? 'no diagnostic'
            }`);
          }
          const observed = await observeHostedActionState({
            providerEnvelope: authority.providerEnvelope,
            envelope: authority.envelope,
            role: 'child'
          });
          if (observed.decision.disposition !== 'start-allowed' || !observed.decision.physicalExecutionAllowed) {
            throw new Error(`start marker cannot be prepared from ${observed.decision.disposition}.`);
          }
          const marker = createVerificationActionStartMarkerV2({
            actionKey: authority.resolution.actionPlan.action.actionKey,
            candidateSha: authority.resolution.artifactInput.headSha,
            executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
            producer: currentHostedActionProducer()
          });
          writeVerificationActionStartMarkerV2Atomic(args.get('--output')!, marker);
          return JSON.stringify({
            status: 'marker-prepared',
            actionKey: marker.actionKey,
            markerName: verificationActionStartMarkerNameV2(marker.actionKey),
            markerDigest: marker.markerDigest,
            archiveDigest: archiveInventory.archiveDigest,
            archiveInventoryDigest: archiveInventory.inventoryDigest,
            sandboxCapabilityState: sandboxCapability.state,
            sandboxCapabilityDigest: ciActionDigest(sandboxCapability),
            output: path.resolve(args.get('--output')!)
          });
        },
        'claim-start': async () => {
          const args = hostedActionCliArgs(argv, [
            '--intent', '--provider-envelope', '--envelope', '--resolution',
            '--prepared-candidate-archive', '--base-dependency-closure-digest',
            '--authenticated-git-closure-digest', '--output'
          ]);
          const authority = hostedActionChildContext({
            providerEnvelopePath: args.get('--provider-envelope')!,
            envelopePath: args.get('--envelope')!,
            resolutionPath: args.get('--resolution')!
          });
          const before = await ensureVerificationActionGitHubProviderTransaction({
            authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
            intent: { kind: 'coordinate' }
          });
          const markerObservation = before.snapshot.startObservations[0];
          if (before.disposition !== 'observed' || before.snapshot.startObservations.length !== 1 ||
              markerObservation?.expired !== false || markerObservation.payload === null) {
            throw new Error('claim-start requires one exact uploaded immutable start marker.');
          }
          const marker = parseVerificationActionStartMarkerV2(markerObservation.payload);
          const claimed = await ensureVerificationActionGitHubProviderTransaction({
            authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
            intent: { kind: 'claim-start', marker }
          });
          if (claimed.disposition !== 'started' || !claimed.newlyCreatedByThisInvocation || claimed.status === null) {
            return JSON.stringify({
              status: 'joined',
              actionKey: claimed.actionKey,
              issued: false,
              ticketDigest: null,
              output: null,
              reason: claimed.reason
            });
          }
          const startObservation = claimed.snapshot.startObservations[0];
          if (claimed.snapshot.startObservations.length !== 1 || startObservation?.payload === null) {
            throw new Error('claim-start readback lost the exact start marker.');
          }
          const preparedCandidateInventory = CodexDevelopmentInspectHostedActionArchive({
            resolution: authority.resolution,
            preparedCandidateArchive: args.get('--prepared-candidate-archive')!,
            baseDependencyClosureDigest:
              args.get('--base-dependency-closure-digest')! as VerificationActionKeyDigest,
            authenticatedGitClosureDigest:
              args.get('--authenticated-git-closure-digest')! as VerificationActionKeyDigest
          });
          const ticket = CodexDevelopmentCreateHostedActionExecutionTicket({
            resolution: authority.resolution,
            marker,
            startObservation,
            startStatus: claimed.status,
            preparedCandidateArtifactName:
              `sec-verification-action-prepared-v2-${marker.actionKey.slice(7)}-run-${marker.producer.runId}` +
              `-attempt-${marker.producer.runAttempt}`,
            preparedCandidateInventory
          });
          writeHostedActionJson(args.get('--output')!, ticket);
          return JSON.stringify({
            status: 'ticket-issued',
            actionKey: ticket.actionKey,
            issued: true,
            ticketDigest: ticket.ticketDigest,
            output: path.resolve(args.get('--output')!)
          });
        },
        'prepare-terminal-anchor': async () => {
          const args = hostedActionCliArgs(argv, [
            '--intent', '--provider-envelope', '--envelope', '--resolution', '--output'
          ]);
          const authority = hostedActionChildContext({
            providerEnvelopePath: args.get('--provider-envelope')!,
            envelopePath: args.get('--envelope')!,
            resolutionPath: args.get('--resolution')!
          });
          const observed = await observeHostedActionState({
            providerEnvelope: authority.providerEnvelope,
            envelope: authority.envelope,
            role: 'child'
          });
          if (observed.decision.disposition !== 'repair-terminal-anchor' ||
              !observed.decision.terminalAnchorRepairAllowed) {
            throw new Error(`terminal anchor cannot be prepared from ${observed.decision.disposition}.`);
          }
          const startObservation = observed.index.startObservations[0];
          const terminalObservation = observed.index.terminalObservations[0];
          const startStatus = observed.index.providerStatusReadbacks[0]?.statuses.find(
            (entry) => entry.state === 'pending'
          );
          if (startObservation?.payload === null || startObservation?.payload === undefined ||
              startObservation.archiveDigest === null || terminalObservation?.artifact === null ||
              terminalObservation?.artifact === undefined ||
              terminalObservation.providerObservation.archiveDigest === null || startStatus === undefined) {
            throw new Error('terminal anchor lacks exact authenticated start and terminal bytes.');
          }
          const anchor = createVerificationActionTerminalStatusAnchorV2({
            actionKey: authority.resolution.actionPlan.action.actionKey,
            candidateSha: authority.resolution.artifactInput.headSha,
            startStatusId: startStatus.id,
            startStatusNodeId: startStatus.nodeId,
            startArtifactOriginId: startObservation.originId,
            startArtifactName: startObservation.artifactName,
            startArtifactArchiveDigest: startObservation.archiveDigest,
            startMarkerDigest: startObservation.payload.markerDigest,
            terminalArtifactOriginId: terminalObservation.providerObservation.originId,
            terminalArtifactName: terminalObservation.providerObservation.artifactName,
            terminalArtifactArchiveDigest: terminalObservation.providerObservation.archiveDigest,
            terminalArtifactPayloadDigest: terminalObservation.artifact.artifactDigest as VerificationActionKeyDigest,
            terminalAssemblerOrigin: terminalObservation.artifact.producer,
            anchorPublisherOrigin: currentHostedActionProducer()
          });
          writeVerificationActionTerminalStatusAnchorV2Atomic(args.get('--output')!, anchor);
          return JSON.stringify({
            status: 'anchor-prepared',
            actionKey: anchor.actionKey,
            anchorName: verificationActionProviderTerminalAnchorName(anchor.actionKey),
            anchorDigest: anchor.anchorDigest,
            output: path.resolve(args.get('--output')!)
          });
        },
        'anchor-terminal': async () => {
          const args = hostedActionCliArgs(argv, [
            '--intent', '--provider-envelope', '--envelope', '--resolution'
          ]);
          const authority = hostedActionChildContext({
            providerEnvelopePath: args.get('--provider-envelope')!,
            envelopePath: args.get('--envelope')!,
            resolutionPath: args.get('--resolution')!
          });
          const before = await ensureVerificationActionGitHubProviderTransaction({
            authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
            intent: { kind: 'coordinate' }
          });
          const anchorObservation = before.snapshot.terminalAnchorObservations[0];
          if (before.disposition !== 'observed' || before.snapshot.terminalAnchorObservations.length !== 1 ||
              anchorObservation?.expired !== false || anchorObservation.payload === null) {
            throw new Error('anchor-terminal requires one exact uploaded terminal anchor.');
          }
          const result = await ensureVerificationActionGitHubProviderTransaction({
            authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
            intent: { kind: 'anchor-terminal', anchor: anchorObservation.payload }
          });
          if ((result.disposition !== 'terminal-anchored' && result.disposition !== 'complete') ||
              result.status === null) {
            throw new Error(`neutral terminal tombstone was not anchored: ${result.reason ?? result.disposition}.`);
          }
          const index = hostedActionProviderIndexFromSnapshot(result.snapshot);
          const decision = CodexDevelopmentReduceHostedActionProviderIndex({
            resolution: authority.resolution,
            ...hostedActionRepositoryIdentity(),
            index
          });
          if (decision.disposition !== 'terminal-anchored') {
            throw new Error('neutral terminal tombstone did not read back as terminal-anchored.');
          }
          return JSON.stringify({
            status: 'terminal-anchored',
            actionKey: decision.actionKey,
            terminalPayloadDigest: decision.terminalPayloadDigest,
            decisionDigest: decision.decisionDigest
          });
        }
      });
      switch (intent) {
        case 'prepare-parent-plan': return intentHandlers['prepare-parent-plan']!();
        case 'verify-parent-plan': return intentHandlers['verify-parent-plan']!();
        case 'coordinate-session': return intentHandlers['coordinate-session']!();
        case 'observe-session': return intentHandlers['observe-session']!();
        case 'observe-action': return intentHandlers['observe-action']!();
        case 'prepare-start-marker': return intentHandlers['prepare-start-marker']!();
        case 'claim-start': return intentHandlers['claim-start']!();
        case 'prepare-terminal-anchor': return intentHandlers['prepare-terminal-anchor']!();
        case 'anchor-terminal': return intentHandlers['anchor-terminal']!();
        default:
          throw new Error(`Unknown ensure-hosted-action-provider intent: ${intent ?? '<missing>'}.`);
      }
    },
    'prepare-hosted-action-inputs': async () => {
      const args = hostedActionCliArgs(argv, [
        '--resolution', '--base-root', '--candidate-root', '--output-directory'
      ]);
      const resolution = CodexDevelopmentParseHostedActionResolution(
        readFileSync(path.resolve(args.get('--resolution')!), 'utf8')
      );
      const prepared = CodexDevelopmentPrepareHostedActionInputs({
        resolution,
        baseRoot: args.get('--base-root')!,
        candidateRoot: args.get('--candidate-root')!,
        outputDirectory: args.get('--output-directory')!
      });
      return JSON.stringify({
        status: 'prepared',
        actionKey: resolution.actionPlan.action.actionKey,
        preparedCandidateArchive: prepared.preparedCandidateArchive,
        archiveDigest: prepared.archiveInventory.archiveDigest,
        archiveInventoryDigest: prepared.archiveInventory.inventoryDigest,
        baseDependencyClosureDigest: prepared.baseDependencyClosureDigest,
        authenticatedGitClosureDigest: prepared.authenticatedGitClosureDigest
      });
    },
    'self-test-hosted-action-sandbox': async () => {
      const args = hostedActionCliArgs(argv, ['--resolution']);
      const resolution = CodexDevelopmentParseHostedActionResolution(
        readFileSync(path.resolve(args.get('--resolution')!), 'utf8')
      );
      const observation = await CodexDevelopmentProbeHostedSutSandboxCapability({
        actionKey: resolution.actionPlan.action.actionKey
      });
      if (observation.state === 'unknown') {
        throw new Error(`Hosted Action sandbox capability is a retryable unknown machine observation: ${
          observation.diagnostic ?? 'no diagnostic'
        }`);
      }
      return JSON.stringify({
        status: observation.state,
        actionKey: resolution.actionPlan.action.actionKey,
        policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
        commandPlanDigest: observation.commandPlanDigest,
        outputDigest: observation.outputDigest,
        residueReadbackDigest: observation.residueReadbackDigest,
        diagnostic: observation.diagnostic
      });
    },
    'resolve-hosted-action': async () => {
      const args = hostedActionCliArgs(argv, ['--provider-envelope', '--envelope', '--output']);
      const providerEnvelope = parseCiVerificationActionProviderEnvelope(
        JSON.parse(readFileSync(path.resolve(args.get('--provider-envelope')!), 'utf8')) as unknown
      );
      const request = CodexDevelopmentParseHostedActionRequest(
        encodeVerificationActionData(providerEnvelope.proposal)
      );
      const envelope = parseHostedEnvelope(
        JSON.parse(readFileSync(path.resolve(args.get('--envelope')!), 'utf8')) as unknown
      );
      const resolution = CodexDevelopmentResolveHostedAction({ request, envelope });
      writeHostedActionJson(args.get('--output')!, resolution);
      return JSON.stringify({
        status: 'resolved',
        actionKey: resolution.actionPlan.action.actionKey,
        actionKeyHex: resolution.actionKeyHex,
        resolutionDigest: resolution.resolutionDigest,
        output: path.resolve(args.get('--output')!)
      });
    },
    'execute-hosted-action-sut': async () => {
      const args = hostedActionCliArgs(argv, [
        '--resolution', '--ticket', '--prepared-candidate-archive', '--output'
      ]);
      const resolution = CodexDevelopmentParseHostedActionResolution(
        readFileSync(path.resolve(args.get('--resolution')!), 'utf8')
      );
      const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
        readFileSync(path.resolve(args.get('--ticket')!), 'utf8')
      );
      if (ticket.resolutionDigest !== resolution.resolutionDigest ||
          ticket.actionKey !== resolution.actionPlan.action.actionKey ||
          ticket.candidateSha !== resolution.artifactInput.headSha ||
          ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
        throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
      }
      const archiveInventory = CodexDevelopmentMaterializeHostedActionCandidate({
        resolution,
        ticket,
        preparedCandidateArchive: args.get('--prepared-candidate-archive')!
      });
      const rawResult = await CodexDevelopmentExecuteHostedActionSut({
        resolution,
        ticket,
        candidateArchive: args.get('--prepared-candidate-archive')!,
        archiveInventory
      });
      writeHostedActionJson(args.get('--output')!, rawResult);
      return JSON.stringify({
        rawResultDigest: rawResult.rawResultDigest,
        output: path.resolve(args.get('--output')!)
      });
    },
    'assemble-hosted-action-terminal': async () => {
      const args = hostedActionCliArgs(argv, [
        '--provider-envelope', '--envelope', '--resolution', '--ticket', '--raw-result',
        '--expected-raw-result-digest', '--output'
      ]);
      const authority = hostedActionChildContext({
        providerEnvelopePath: args.get('--provider-envelope')!,
        envelopePath: args.get('--envelope')!,
        resolutionPath: args.get('--resolution')!
      });
      const resolution = authority.resolution;
      const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
        readFileSync(path.resolve(args.get('--ticket')!), 'utf8')
      );
      const rawResult = CodexDevelopmentParseHostedActionRawResult(
        readFileSync(path.resolve(args.get('--raw-result')!), 'utf8')
      );
      const observed = await ensureVerificationActionGitHubProviderTransaction({
        authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
        intent: { kind: 'coordinate' }
      });
      if (observed.disposition !== 'observed') {
        throw new Error(`Hosted Action assembler provider observation returned ${observed.disposition}.`);
      }
      const producer = currentHostedActionProducer();
      if (encodeVerificationActionData(producer) !== encodeVerificationActionData(ticket.producer)) {
        throw new Error('Hosted Action terminal assembler is not the original trusted claim run.');
      }
      const index = hostedActionProviderIndexFromSnapshot(observed.snapshot);
      const startObservation = index.startObservations[0];
      const readback = index.providerStatusReadbacks[0];
      const startStatus = readback?.statuses.find((entry) => entry.id === ticket.startStatusId);
      if (index.startObservations.length !== 1 || startObservation === undefined || startStatus === undefined ||
          index.terminalObservations.length !== 0 || index.terminalAnchorObservations.length !== 0) {
        throw new Error('Hosted Action assembler does not own the sole exact unresolved start ticket.');
      }
      const rebuiltTicket = CodexDevelopmentCreateHostedActionExecutionTicket({
        resolution,
        marker: startObservation.payload!,
        startObservation,
        startStatus,
        preparedCandidateArtifactName: ticket.preparedCandidateArtifactName,
        preparedCandidateInventory: hostedSutInventoryClosureFromTicket(ticket)
      });
      if (rebuiltTicket.ticketDigest !== ticket.ticketDigest) {
        throw new Error('Hosted Action assembler ticket no longer matches provider readback.');
      }
      const artifact = CodexDevelopmentAssembleHostedActionTerminal({
        resolution,
        ticket,
        rawResult,
        expectedRawResultDigest: args.get('--expected-raw-result-digest')! as VerificationActionKeyDigest,
        producer
      });
      CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic(args.get('--output')!, artifact);
      return JSON.stringify({
        status: artifact.result.status,
        actionKey: artifact.actionPlan.action.actionKey,
        artifactName: verificationActionProviderTerminalArtifactName(artifact.actionPlan.action.actionKey),
        artifactDigest: artifact.artifactDigest,
        output: path.resolve(args.get('--output')!)
      });
    },
    'compose-hosted-evidence': async () => {
      const args = hostedActionCliArgs(argv, [
        '--envelope', '--artifact-index', '--output'
      ]);
      const envelope = parseHostedEnvelope(
        JSON.parse(readFileSync(path.resolve(args.get('--envelope')!), 'utf8')) as unknown
      );
      const index = CodexDevelopmentReadHostedActionArtifactIndex({
        source: readFileSync(path.resolve(args.get('--artifact-index')!), 'utf8')
      });
      const producer = CodexDevelopmentCreateVerificationEvidenceProducer({
        sourceTransport: 'github-actions',
        workflowPath: '.github/workflows/compiler-pr-validation.yml',
        workflowRef: `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`,
        workflowSha: envelope.session.baseSha,
        runId: process.env.GITHUB_RUN_ID ?? '',
        runAttempt: positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT'),
        actorNodeId: envelope.scopeAuthorization.issuer.principalId
      });
      const composed = CodexDevelopmentComposeHostedEvidence({
        envelope,
        observations: index.observations,
        startObservations: index.startObservations,
        terminalAnchorObservations: index.terminalAnchorObservations,
        providerStatusReadbacks: index.providerStatusReadbacks,
        producer
      });
      if (composed.evidence !== null) {
        CodexDevelopmentWriteVerificationEvidenceV4Atomic(args.get('--output')!, composed.evidence);
      }
      return JSON.stringify({
        ...composed.coordination,
        evidenceWritten: composed.evidence !== null,
        output: composed.evidence === null ? null : path.resolve(args.get('--output')!)
      });
    }
  });
  switch (command) {
    case 'execute-trusted-bootstrap-sut': return commandHandlers['execute-trusted-bootstrap-sut']!();
    case 'ensure-hosted-action-provider': return commandHandlers['ensure-hosted-action-provider']!();
    case 'prepare-hosted-action-inputs': return commandHandlers['prepare-hosted-action-inputs']!();
    case 'self-test-hosted-action-sandbox': return commandHandlers['self-test-hosted-action-sandbox']!();
    case 'resolve-hosted-action': return commandHandlers['resolve-hosted-action']!();
    case 'execute-hosted-action-sut': return commandHandlers['execute-hosted-action-sut']!();
    case 'assemble-hosted-action-terminal': return commandHandlers['assemble-hosted-action-terminal']!();
    case 'compose-hosted-evidence': return commandHandlers['compose-hosted-evidence']!();
    default:
      throw new Error(`Unknown hosted Action command: ${command ?? '<missing>'}.`);
  }
}

async function main(): Promise<number> {
  if (HOSTED_ACTION_COMMANDS.has(process.argv[2] ?? '')) {
    const result = await CodexDevelopmentCiVerificationHostedActionCli(process.argv.slice(2));
    process.stdout.write(`${result}\n`);
    return 0;
  }
  return CodexDevelopmentCiVerificationMain();
}

if (import.meta.main) {
  enableExecutionProgress();
  reportExecutionProgress({ command: 'ci-verification', phase: 'command', state: 'start' });
  try {
    const exitCode = await main();
    reportExecutionProgress({
      command: 'ci-verification', phase: 'command',
      state: exitCode === 0 ? 'complete' : 'failed', detail: { exitCode }
    });
    process.exitCode = exitCode;
  } catch (error) {
    reportExecutionProgress({
      command: 'ci-verification', phase: 'command', state: 'failed',
      detail: { error: error instanceof Error ? error.message : String(error) }
    });
    throw error;
  }
}
