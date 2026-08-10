import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import path from 'node:path';

import { CodexDevelopmentBuildSanitizedChildEnvironmentV1 } from '../platform/shared/ci-execution-environment.ts';

import { executeVerifiedCiActionPlanV1 } from '../platform/dev-runner.ts';
import {
  CodexDevelopmentRegisteredEvidenceCompositionPolicyV1,
  CodexDevelopmentRequiredEvidenceCompositionPolicyV1,
  CodexDevelopmentSm3P0WorkPackageIdV1
} from '../platform/shared/ci-evidence-composition-policy-registry.ts';
import {
  aggregateV4Status,
  CodexDevelopmentAssertVerificationActionTerminalArtifactV2,
  CodexDevelopmentCreateVerificationEvidenceProducerV4,
  CodexDevelopmentFinalizeVerificationActionTerminalArtifactV2,
  CodexDevelopmentFinalizeVerificationEvidenceV4,
  CodexDevelopmentParseVerificationActionTerminalArtifactV2,
  CodexDevelopmentPrepareVerificationEvidenceTarget,
  CodexDevelopmentVerificationActionCandidateBytesDigestV2,
  CodexDevelopmentVerificationArtifactRetentionDays,
  CodexDevelopmentVerificationDigest,
  CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic,
  CodexDevelopmentWriteVerificationEvidenceV4Atomic,
  type CodexDevelopmentVerificationActionArtifactInputV2,
  type CodexDevelopmentVerificationActionArtifactProducerV2,
  type CodexDevelopmentVerificationActionTerminalArtifactV2,
  type CodexDevelopmentVerificationEvidenceV2,
  type CodexDevelopmentVerificationEvidenceV3,
  type CodexDevelopmentVerificationEvidenceV4,
  type CodexDevelopmentVerificationGateEvidenceV2,
  type CodexDevelopmentVerificationGateEvidenceV3,
  type CodexDevelopmentVerificationGateEvidenceV4
} from '../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentBuildEvidenceCompositionPlanV1,
  type CodexDevelopmentEvidenceCompositionGateV1,
  type CodexDevelopmentEvidenceCompositionPlanV1,
  type CodexDevelopmentEvidenceCompositionPolicyV1,
  type CodexDevelopmentExactGitBlobBytesV1,
  type CodexDevelopmentExactGitBlobV1
} from '../platform/shared/ci-evidence-reuse-contract.ts';
import {
  decodeGitPathOutput,
  type CodexDevelopmentGitChangedRecordV1
} from '../platform/shared/ci-git-changed-files.ts';
import {
  CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA_V1,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
  CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA_V1,
  CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1,
  CodexDevelopmentCreateHostedSutExecutionAuthorizationV1,
  CodexDevelopmentFinalizeHostedActionRawResultV2,
  CodexDevelopmentHostedSutCandidateEnvironmentV1,
  CodexDevelopmentParseHostedSutSandboxReceiptV1,
  CodexDevelopmentReduceHostedSutObservationV1,
  CodexDevelopmentParseHostedActionRawResultV2 as parseHostedActionRawResultContractV2,
  type CodexDevelopmentHostedActionRawResultV2,
  type CodexDevelopmentHostedSutExecutionAuthorizationV1,
  type CodexDevelopmentHostedSutInventoryClosureV1,
  type CodexDevelopmentHostedSutSandboxReceiptV1
} from '../platform/shared/ci-hosted-sut-observation-contract.ts';
import {
  assertCiExpectedHead,
  CI_VERIFICATION_CONTRACT_REVISION,
  CI_VERIFICATION_SESSION_CONTRACT_REVISION,
  CodexDevelopmentBuildVerificationPlanV1,
  type CiVerificationGateStep,
  type CodexDevelopmentVerificationPlanProfileV1
} from '../platform/shared/ci-verification-plan.ts';
import {
  CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1,
  CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2,
  CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION,
  CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from '../platform/shared/ci-verification-revision.ts';
import { compilerRoot } from '../platform/shared/paths.ts';
import type {
  TcbClosureGeneratedRegionV2,
  TcbClosureLock,
  TcbClosureLockSourcePlanV2
} from '../platform/shared/tcb-closure-lock.ts';
import { isTestFile } from '../platform/shared/test-budget-contract.ts';
import {
  buildCiVerificationActionPlanClosureV1,
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
  ciVerificationActionParentDispatchPlanArtifactNameV2,
  ciVerificationActionParentDispatchPlanPayloadDigestV2,
  ciVerificationGateStepV1,
  ciVerificationNormalizedOperationArgvV2,
  createCiVerificationActionParentDispatchPlanV2,
  createCiVerificationActionProposalV2,
  createCiVerificationActionProviderEnvelopeV2,
  createCiVerificationLocalExecutionEnvironmentV2,
  parseCiVerificationActionParentDispatchPlanV2,
  parseCiVerificationActionPlanClosureV1,
  parseCiVerificationActionProposalV2,
  parseCiVerificationActionProviderEnvelopeV2,
  type CiVerificationActionCandidateV1,
  type CiVerificationActionParentActorV2,
  type CiVerificationActionParentDispatchPlanV2,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationActionProposalV2,
  type CiVerificationActionProviderEnvelopeV2,
  type CiVerificationProducerGateV1
} from '../platform/shared/verification-action-ci-contract.ts';
import {
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  isVerificationActionRunnableV2,
  parseVerificationActionPlanV2,
  type VerificationActionDependencyResolutionV2,
  type VerificationActionKeyDigest,
  type VerificationActionPlanV2
} from '../platform/shared/verification-action-contract.ts';
import {
  createVerificationActionProviderStartMarkerV2 as createVerificationActionStartMarkerV2,
  createVerificationActionProviderTerminalAnchorV2 as createVerificationActionTerminalStatusAnchorV2,
  parseVerificationActionProviderStatusReadbackV2,
  parseVerificationActionProviderStartMarkerV2 as parseVerificationActionStartMarkerV2,
  parseVerificationActionProviderTerminalAnchorV2 as parseVerificationActionTerminalStatusAnchorV2,
  reduceVerificationActionProviderStateV2,
  verificationActionProviderStartDescriptionV2,
  verificationActionProviderStatusContextV2,
  verificationActionProviderTerminalAnchorNameV2,
  verificationActionProviderTerminalArtifactNameV2,
  verificationActionProviderStartArtifactNameV2 as verificationActionStartMarkerNameV2,
  type VerificationActionProviderDecisionV2,
  type VerificationActionProviderOriginV2,
  type VerificationActionProviderStartObservationV2,
  type VerificationActionProviderStatusObservationV2,
  type VerificationActionProviderStatusReadbackV2,
  type VerificationActionProviderTerminalAnchorObservationV2,
  type VerificationActionProviderTerminalObservationV2,
  type VerificationActionProviderStartMarkerV2 as VerificationActionStartMarkerV2
} from '../platform/shared/verification-action-provider-contract.ts';
import {
  CodexDevelopmentBuildVerificationGateResultV1,
  type VerificationGateResultV1
} from '../platform/shared/verification-result-contract.ts';
import { CodexDevelopmentBuildVerificationScopeInventoryV1 } from '../platform/shared/verification-scope-inventory.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease
} from '../platform/shared/workspace-write-lease.ts';
import {
  CodexDevelopmentChangedFilesFromRecordsV1,
  CodexDevelopmentCreateNotRunGateV2,
  CodexDevelopmentDefaultChangedPathsV1,
  CodexDevelopmentDefaultGitRevisionV1,
  CodexDevelopmentDefaultTrackedTreeIsCleanV1,
  CodexDevelopmentFailureTailV1,
  CodexDevelopmentRunGateProcessV1,
  type CodexDevelopmentGateProcessResultV1
} from './codex/ci-orchestration-core.ts';
import {
  CodexDevelopmentReadExactGitBlobEntryV1,
  CodexDevelopmentReadExactGitBlobV1,
  type CodexDevelopmentExactGitBlobReadOptionsV1
} from './codex/exact-git-blob.ts';
import {
  ensureVerificationActionGitHubProviderTransactionV2,
  type VerificationActionGitHubProviderSnapshotV2
} from './codex/verification-action-github-provider.ts';
import {
  writeVerificationActionStartMarkerV2Atomic,
  writeVerificationActionTerminalStatusAnchorV2Atomic
} from './codex/verification-action-journal.ts';
import {
  createVerificationActionRunnerV2,
  type VerificationActionRunnerV2,
  type VerificationActionRunOutcomeV2
} from './codex/verification-action-runner.ts';
import {
  parseVerificationSessionHostedRequestV1,
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1,
  type VerificationSessionHostedEnvelopeV1,
  type VerificationSessionHostedRequestV1
} from './codex/verification-session-runtime.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest,
  CodexDevelopmentWorkPackageSchemaV1,
  CodexDevelopmentWorkPackageSchemaV2,
  type CodexDevelopmentWorkPackageManifest
} from './codex/work-package-contract.ts';
export {
  CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA_V2,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
  type CodexDevelopmentHostedActionRawResultV2,
  type CodexDevelopmentHostedSutSandboxReceiptV1
} from '../platform/shared/ci-hosted-sut-observation-contract.ts';

const VERIFICATION_EVIDENCE_PATH = '.tmp/ci-verification-evidence.json';
function isCompositionProtectedEnvKey(key: string): boolean {
  return key === 'SEC_TEST_WORKSPACE_NAMESPACE' || key.startsWith('SEC_RUN_');
}
const FORMAL_HOSTED_ENV_KEYS = Object.freeze([
  'SEC_SESSION_REVISION', 'SEC_SESSION_PROPOSAL_DIGEST', 'SEC_SCOPE_AUTHORIZATION_REVISION',
  'SEC_SCOPE_AUTHORIZATION_DIGEST',
  'SEC_REVIEW_RECEIPT_DIGEST', 'SEC_MAIN_HEALTH_REVISION', 'SEC_MAIN_HEALTH_DIGEST', 'SEC_TRUST_REVISION',
  'SEC_BASE_TREE_SHA', 'SEC_ACTION_PLAN_DIGEST', 'SEC_REQUIRED_BLOB_CLOSURE_JSON',
  'SEC_EXECUTION_ENVIRONMENT_REVISION',
  'SEC_TRUSTED_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA', 'SEC_WORKFLOW_ACTOR_NODE_ID',
  'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'
] as const);
const INVALIDATION_RULES = [
  'exact head SHA or tree SHA changes',
  'current PR base SHA or exact affected base SHA changes',
  'CI contract revision, profile, gate plan, or changed paths change',
  'Work Package manifest path or digest changes',
  'tracked worktree is not clean before and after verification',
  'hosted artifact is missing, expired, or has a mismatched digest'
];

export const CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA_V2 =
  'sec-verification-action-resolution-v2' as const;
export const CI_VERIFICATION_ACTION_COORDINATION_SCHEMA_V2 =
  'sec-verification-action-coordination-v2' as const;
export const CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA_V2 =
  'sec-verification-action-artifact-index-v2' as const;
export const CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA_V2 =
  'sec-verification-action-execution-ticket-v2' as const;
export const CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA_V1 =
  'sec-verification-action-sandbox-command-plan-v1' as const;
export const CI_VERIFICATION_ACTION_DISPATCH_PLAN_SCHEMA_V2 =
  'sec-verification-action-dispatch-plan-v2' as const;

const CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER_V1 =
  '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__';
const CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1 =
  '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__';
const CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_REF_PREFIX_V1 =
  'sandbox-receipt:';

export type CodexDevelopmentHostedSutSandboxCommandPlanV1 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA_V1;
  policyDigest: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1;
  phase: 'capability-self-test' | 'execute' | 'teardown';
  unitName: string;
  command: '/usr/bin/sudo';
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
  planDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutSandboxProcessObservationV1 =
  CodexDevelopmentGateProcessResultV1 & Readonly<{
    commandStarted: boolean;
    stdoutDigest: VerificationActionKeyDigest;
    stderrDigest: VerificationActionKeyDigest;
    stdoutBytesObserved: number;
    stderrBytesObserved: number;
    outputTruncated: boolean;
  }>;

export type CodexDevelopmentHostedSutSandboxProcessV1 = (
  plan: CodexDevelopmentHostedSutSandboxCommandPlanV1
) => Promise<CodexDevelopmentHostedSutSandboxProcessObservationV1>;

/** Compatibility type name for the single canonical internal Action proposal. */
export type CodexDevelopmentHostedActionRequestV2 = CiVerificationActionProposalV2 & Readonly<{
  sessionRequest: VerificationSessionHostedRequestV1;
}>;

export type CodexDevelopmentHostedActionResolutionV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA_V2;
  requestDigest: VerificationActionKeyDigest;
  actionKeyHex: string;
  actionPlan: VerificationActionPlanV2;
  actionPlanClosure: CiVerificationActionPlanClosureV1;
  artifactInput: CodexDevelopmentVerificationActionArtifactInputV2;
  executionEnvironment: typeof CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2;
  resolutionDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedActionExecutionTicketV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA_V2;
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
  producer: CodexDevelopmentVerificationActionArtifactProducerV2;
  ticketDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedActionArtifactObservationV2 = Readonly<{
  providerObservation: VerificationActionProviderTerminalObservationV2;
  artifact: CodexDevelopmentVerificationActionTerminalArtifactV2 | null;
}>;

export type CodexDevelopmentHostedActionStartObservationV2 = VerificationActionProviderStartObservationV2;

export type CodexDevelopmentHostedActionTerminalAnchorObservationV2 =
  VerificationActionProviderTerminalAnchorObservationV2;

export type CodexDevelopmentHostedActionCoordinationV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_COORDINATION_SCHEMA_V2;
  disposition: 'dispatch' | 'waiting' | 'complete' | 'blocked';
  actionPlanDigest: VerificationActionKeyDigest;
  dispatchActionKeys: readonly VerificationActionKeyDigest[];
  terminalActionKeys: readonly VerificationActionKeyDigest[];
  missingActionKeys: readonly VerificationActionKeyDigest[];
  reason: string | null;
  coordinationDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedActionProviderIndexV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA_V2;
  terminalObservations: readonly CodexDevelopmentHostedActionArtifactObservationV2[];
  startObservations: readonly VerificationActionProviderStartObservationV2[];
  terminalAnchorObservations: readonly VerificationActionProviderTerminalAnchorObservationV2[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadbackV2[];
}>;

export type CodexDevelopmentHostedActionDispatchPlanV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_DISPATCH_PLAN_SCHEMA_V2;
  coordination: CodexDevelopmentHostedActionCoordinationV2;
  dispatchRequests: readonly CodexDevelopmentHostedActionRequestV2[];
  dispatchPlanDigest: VerificationActionKeyDigest;
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

export function CodexDevelopmentReadHostedActionArtifactIndexV2(input: Readonly<{
  source: string;
}>): Readonly<{
  observations: readonly CodexDevelopmentHostedActionArtifactObservationV2[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservationV2[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservationV2[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadbackV2[];
}> {
  const value = exactObject(JSON.parse(input.source) as unknown, [
    'schema', 'terminalObservations', 'startObservations', 'terminalAnchorObservations',
    'providerStatusReadbacks'
  ], 'Hosted Action artifact index V2');
  if (value.schema !== CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA_V2 ||
      !Array.isArray(value.terminalObservations) || !Array.isArray(value.startObservations) ||
      !Array.isArray(value.terminalAnchorObservations) || !Array.isArray(value.providerStatusReadbacks)) {
    throw new Error('Hosted Action artifact index V2 identity is invalid.');
  }
  const observations = Object.freeze(value.terminalObservations.map((entry, index) => {
    const terminal = exactObject(entry, ['providerObservation', 'artifact'],
      'Hosted Action terminal observation[' + index + ']');
    const providerObservation = terminal.providerObservation as VerificationActionProviderTerminalObservationV2;
    const artifact = terminal.artifact === null
      ? null
      : CodexDevelopmentParseVerificationActionTerminalArtifactV2(
        encodeVerificationActionDataV2(terminal.artifact)
      );
    if (providerObservation === null || typeof providerObservation !== 'object' ||
        (providerObservation.payload === null) !== (artifact === null)) {
      throw new Error('Hosted Action terminal provider observation/payload mismatch.');
    }
    return Object.freeze({ providerObservation, artifact });
  }));
  const startObservations = Object.freeze(value.startObservations.map((entry) => {
    const observation = entry as VerificationActionProviderStartObservationV2;
    if (observation !== null && typeof observation === 'object' && observation.payload !== null) {
      parseVerificationActionStartMarkerV2(observation.payload);
    }
    return observation;
  }));
  const terminalAnchorObservations = Object.freeze(value.terminalAnchorObservations.map((entry) => {
    const observation = entry as VerificationActionProviderTerminalAnchorObservationV2;
    if (observation !== null && typeof observation === 'object' && observation.payload !== null) {
      parseVerificationActionTerminalStatusAnchorV2(observation.payload);
    }
    return observation;
  }));
  const providerStatusReadbacks = Object.freeze(value.providerStatusReadbacks.map((entry) =>
    parseVerificationActionProviderStatusReadbackV2(entry)
  ));
  return Object.freeze({ observations, startObservations, terminalAnchorObservations, providerStatusReadbacks });
}



export function CodexDevelopmentParseHostedActionRequestV2(
  source: string
): CodexDevelopmentHostedActionRequestV2 {
  const value = parseCiVerificationActionProposalV2(JSON.parse(source) as unknown);
  const sessionRequest = parseVerificationSessionHostedRequestV1(
    encodeVerificationActionDataV2(value.sessionRequest)
  );
  return Object.freeze({
    schema: value.schema,
    sessionRequest,
    proposedActionKey: value.proposedActionKey
  });
}

function parseHostedEnvelopeV1(value: unknown): VerificationSessionHostedEnvelopeV1 {
  const envelope = exactObject(value, [
    'schema', 'requestOperationId', 'scopeAuthorization', 'preGateReview', 'mainHealth',
    'session', 'actionPlanClosure', 'envelopeDigest'
  ], 'Hosted Session envelope');
  if (envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1 ||
      typeof envelope.envelopeDigest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(envelope.envelopeDigest)) {
    throw new Error('Hosted Session envelope identity is invalid.');
  }
  const { envelopeDigest, ...withoutDigest } = envelope;
  if (envelopeDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted Session envelope digest mismatch.');
  }
  const actionPlanClosure = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(envelope.actionPlanClosure)
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
    ...(envelope as unknown as VerificationSessionHostedEnvelopeV1),
    actionPlanClosure
  });
}

export function CodexDevelopmentResolveHostedActionV2(input: Readonly<{
  request: CodexDevelopmentHostedActionRequestV2;
  envelope: VerificationSessionHostedEnvelopeV1;
}>): CodexDevelopmentHostedActionResolutionV2 {
  const request = CodexDevelopmentParseHostedActionRequestV2(
    encodeVerificationActionDataV2(input.request)
  );
  const envelope = parseHostedEnvelopeV1(input.envelope);
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
  const actionPlan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(matches[0]));
  if (actionPlan.action.environment.providerRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2) {
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
    candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigestV2({
      baseSha: session.baseSha,
      baseTreeSha: session.baseTreeSha,
      headSha: session.headSha,
      headTreeSha: session.headTreeSha,
      manifestPath: session.manifestPath,
      manifestDigest: session.manifestDigest,
      action: actionPlan.action
    })
  }) satisfies CodexDevelopmentVerificationActionArtifactInputV2;
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA_V2,
    requestDigest: ciActionDigest(request),
    actionKeyHex: actionPlan.action.actionKey.slice('sha256:'.length),
    actionPlan,
    actionPlanClosure: envelope.actionPlanClosure,
    artifactInput,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2
  });
  return Object.freeze({ ...withoutDigest, resolutionDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentParseHostedActionResolutionV2(
  source: string
): CodexDevelopmentHostedActionResolutionV2 {
  const value = exactObject(JSON.parse(source) as unknown, [
    'schema', 'requestDigest', 'actionKeyHex', 'actionPlan', 'actionPlanClosure', 'artifactInput',
    'executionEnvironment', 'resolutionDigest'
  ], 'Hosted Action resolution V2');
  if (value.schema !== CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA_V2 ||
      typeof value.requestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.requestDigest) ||
      typeof value.resolutionDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.resolutionDigest)) {
    throw new Error('Hosted Action resolution V2 identity is invalid.');
  }
  const actionPlanClosure = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(value.actionPlanClosure)
  );
  const actionPlan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(value.actionPlan));
  const memberIndex = actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === actionPlan.action.actionKey
  );
  if (memberIndex < 0 || encodeVerificationActionDataV2(actionPlanClosure.actions[memberIndex]) !==
      encodeVerificationActionDataV2(actionPlan)) {
    throw new Error('Hosted Action resolution plan is not one exact closure member.');
  }
  if (value.actionKeyHex !== actionPlan.action.actionKey.slice(7) ||
      actionPlan.action.environment.providerRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2 ||
      encodeVerificationActionDataV2(value.executionEnvironment) !==
        encodeVerificationActionDataV2(CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2)) {
    throw new Error('Hosted Action resolution environment or key projection mismatch.');
  }
  const artifactInput = value.artifactInput as CodexDevelopmentVerificationActionArtifactInputV2;
  if (artifactInput === null || typeof artifactInput !== 'object' ||
      artifactInput.inputClosureDigest !== ciActionDigest(actionPlan.action.inputClosure) ||
      artifactInput.candidateBytesDigest !== CodexDevelopmentVerificationActionCandidateBytesDigestV2({
        ...artifactInput,
        action: actionPlan.action
      })) {
    throw new Error('Hosted Action resolution candidate byte closure mismatch.');
  }
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA_V2,
    requestDigest: value.requestDigest as VerificationActionKeyDigest,
    actionKeyHex: value.actionKeyHex as string,
    actionPlan,
    actionPlanClosure,
    artifactInput,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2
  });
  if (value.resolutionDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted Action resolution digest mismatch.');
  }
  return Object.freeze({
    ...withoutDigest,
    resolutionDigest: value.resolutionDigest as VerificationActionKeyDigest
  });
}

export function CodexDevelopmentCreateHostedActionExecutionTicketV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  marker: VerificationActionStartMarkerV2;
  startObservation: VerificationActionProviderStartObservationV2;
  startStatus: VerificationActionProviderStatusObservationV2;
  preparedCandidateArtifactName: string;
  preparedCandidateInventory: CodexDevelopmentHostedSutInventoryClosureV1;
}>): CodexDevelopmentHostedActionExecutionTicketV2 {
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  const marker = parseVerificationActionStartMarkerV2(input.marker);
  const observation = input.startObservation;
  const expectedName = verificationActionStartMarkerNameV2(resolution.actionPlan.action.actionKey);
  if (marker.actionKey !== resolution.actionPlan.action.actionKey ||
      marker.candidateSha !== resolution.artifactInput.headSha ||
      marker.executionEnvironmentRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2 ||
      observation.expired || observation.payload === null || observation.archiveDigest === null ||
      observation.referencedOrigin === null || observation.artifactName !== expectedName ||
      observation.payload.markerDigest !== marker.markerDigest ||
      encodeVerificationActionDataV2(observation.referencedOrigin) !== encodeVerificationActionDataV2(marker.producer) ||
      input.startStatus.state !== 'pending' || input.startStatus.commitSha !== marker.candidateSha ||
      input.startStatus.context !== verificationActionProviderStatusContextV2(marker.actionKey) ||
      input.startStatus.description !== verificationActionProviderStartDescriptionV2(marker.markerDigest) ||
      encodeVerificationActionDataV2(input.startStatus.referencedOrigin) !== encodeVerificationActionDataV2(marker.producer)) {
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
    schema: CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA_V2,
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

export function CodexDevelopmentParseHostedActionExecutionTicketV2(
  source: string
): CodexDevelopmentHostedActionExecutionTicketV2 {
  const value = exactObject(JSON.parse(source) as unknown, [
    'schema', 'resolutionDigest', 'actionKey', 'candidateSha', 'candidateBytesDigest',
    'startStatusId', 'startStatusNodeId', 'startMarkerDigest', 'startArtifactOriginId',
    'startArtifactName', 'startArtifactArchiveDigest', 'preparedCandidateArtifactName',
    'preparedCandidateArchiveDigest', 'preparedCandidateInventoryDigest',
    'preparedCandidateEntryCount', 'preparedCandidateTotalFileBytes',
    'baseDependencyClosureDigest', 'authenticatedGitClosureDigest', 'producer', 'ticketDigest'
  ], 'Hosted Action execution ticket V2');
  if (value.schema !== CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA_V2 ||
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
    schema: CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA_V2,
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
    producer: value.producer as CodexDevelopmentVerificationActionArtifactProducerV2
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

function hostedActionProviderIndexFromSnapshotV2(
  snapshot: VerificationActionGitHubProviderSnapshotV2
): CodexDevelopmentHostedActionProviderIndexV2 {
  const terminalObservations = snapshot.terminalObservations.map((observation) => {
    const artifact = observation.payload === null
      ? null
      : CodexDevelopmentParseVerificationActionTerminalArtifactV2(
        encodeVerificationActionDataV2(observation.payload)
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
    schema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA_V2,
    terminalObservations: Object.freeze(terminalObservations),
    startObservations: snapshot.startObservations,
    terminalAnchorObservations: snapshot.terminalAnchorObservations,
    providerStatusReadbacks: Object.freeze([snapshot.statusReadback])
  });
}

export function CodexDevelopmentReduceHostedActionProviderIndexV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  repositoryId: number;
  repository: string;
  index: CodexDevelopmentHostedActionProviderIndexV2;
}>): VerificationActionProviderDecisionV2 {
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  const actionKey = resolution.actionPlan.action.actionKey;
  const readbacks = input.index.providerStatusReadbacks.filter((entry) => entry.actionKey === actionKey);
  if (readbacks.length !== 1) {
    throw new Error('Hosted Action provider index must contain one exact status readback per ActionKey.');
  }
  return reduceVerificationActionProviderStateV2({
    repositoryId: input.repositoryId,
    repository: input.repository,
    actionKey,
    candidateSha: resolution.artifactInput.headSha,
    executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
    statusReadback: readbacks[0]!,
    startObservations: input.index.startObservations.filter(
      (entry) => entry.payload?.actionKey === actionKey || entry.artifactName === verificationActionStartMarkerNameV2(actionKey)
    ),
    terminalObservations: input.index.terminalObservations
      .map((entry) => entry.providerObservation)
      .filter((entry) => entry.payload?.actionKey === actionKey ||
        entry.artifactName === verificationActionProviderTerminalArtifactNameV2(actionKey)),
    terminalAnchorObservations: input.index.terminalAnchorObservations.filter(
      (entry) => entry.payload?.actionKey === actionKey ||
        entry.artifactName === verificationActionProviderTerminalAnchorNameV2(actionKey)
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

function currentHostedActionProducerV2(): VerificationActionProviderOriginV2 {
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
    appId: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.id,
    appNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.nodeId,
    sourceEvent: 'repository_dispatch' as const
  });
}

function gitCandidateBytesV2(repositoryRoot: string, args: readonly string[]): Buffer {
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

function hostedActionFileDigestV2(filePath: string): VerificationActionKeyDigest {
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

/** Verify prepared candidate bytes before the durable start tombstone exists. */
export function CodexDevelopmentAssertPreparedHostedActionCandidateV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  candidateRoot: string;
}>): void {
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const gitText = (...args: string[]): string => gitCandidateBytesV2(candidateRoot, args).toString('utf8').trim();
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
    const trackedBytes = gitCandidateBytesV2(candidateRoot, ['show', `${resolution.artifactInput.headSha}:${entry.path}`]);
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

export type CodexDevelopmentHostedActionArchiveInventoryV2 = Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  inventoryDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyClosureDigest: VerificationActionKeyDigest;
  gitBundleDigest: VerificationActionKeyDigest;
}>;

const HOSTED_ACTION_DEPENDENCY_AUTHORITY_PATHS_V1 = Object.freeze([
  '.bun-version', 'bun.lock', 'bunfig.toml', 'package.json'
] as const);

export function CodexDevelopmentHostedDependencyMaterializerEnvironmentV1(): NodeJS.ProcessEnv {
  return Object.freeze({
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/sec-hosted-dependency-home',
    TMPDIR: '/tmp/sec-hosted-dependency-tmp',
    LANG: 'C.UTF-8',
    BUN_INSTALL_CACHE_DIR: '/tmp/sec-hosted-dependency-home/.bun/install/cache',
    CI: '1'
  });
}

function hostedActionDependencyClosureV1(input: Readonly<{
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
  const authority = HOSTED_ACTION_DEPENDENCY_AUTHORITY_PATHS_V1.map((relativePath) => {
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
    materializerEnvironment: CodexDevelopmentHostedDependencyMaterializerEnvironmentV1()
  });
}

export function CodexDevelopmentAssertHostedActionDependencyInputsV1(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  baseSha: string;
}>): VerificationActionKeyDigest {
  return ciActionDigest(hostedActionDependencyClosureV1(input));
}

type HostedActionArchiveInventoryEntryV2 = Readonly<{
  path: string;
  type: 'directory' | 'file' | 'hardlink' | 'symlink';
  linkTarget: string | null;
  size: number;
  mode: number;
  contentDigest: VerificationActionKeyDigest | null;
}>;

const HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT_V2 = [
  'import hashlib, json, sys, tarfile',
  'result=[]',
  'with tarfile.open(sys.argv[1], mode="r:*") as archive:',
  '  for member in archive.getmembers():',
  '    kind = "file" if member.isreg() else "directory" if member.isdir() else "symlink" if member.issym() else "hardlink" if member.islnk() else "unsupported"',
  '    digest = None',
  '    normalized = member.name[2:] if member.name.startswith("./") else member.name',
  '    if member.isreg() and normalized in (".sec-trusted-input/candidate.bundle", ".sec-trusted-input/dependency-closure.json"):',
  '      stream = archive.extractfile(member)',
  '      hasher = hashlib.sha256()',
  '      while True:',
  '        chunk = stream.read(1048576) if stream is not None else b""',
  '        if not chunk: break',
  '        hasher.update(chunk)',
  '      digest = "sha256:" + hasher.hexdigest()',
  '    result.append({"path": member.name, "type": kind, "linkTarget": member.linkname if member.issym() or member.islnk() else None, "size": member.size, "mode": member.mode, "contentDigest": digest})',
  'sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":"), sort_keys=True))'
].join('\n');

function canonicalHostedArchivePathV2(source: string, label: string, allowRoot: boolean): string | null {
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

function resolveHostedArchiveLinkTargetV2(entryPath: string, target: string, hardlink: boolean): string {
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

export function CodexDevelopmentValidateHostedActionArchiveInventoryV2(
  source: unknown
): Readonly<{
  entries: readonly HostedActionArchiveInventoryEntryV2[];
  inventoryDigest: VerificationActionKeyDigest;
  totalFileBytes: number;
}> {
  if (!Array.isArray(source) || source.length === 0 || source.length > 250_000) {
    throw new Error('Hosted Action archive inventory is empty or exceeds its entry bound.');
  }
  const entries: HostedActionArchiveInventoryEntryV2[] = [];
  const exactPaths = new Set<string>();
  const casePaths = new Map<string, string>();
  for (const raw of source) {
    const value = exactObject(raw, [
      'contentDigest', 'linkTarget', 'mode', 'path', 'size', 'type'
    ], 'Hosted Action archive entry');
    if (typeof value.path !== 'string' || typeof value.type !== 'string' ||
        !Number.isSafeInteger(value.size) || Number(value.size) < 0 ||
        !Number.isSafeInteger(value.mode) || Number(value.mode) < 0 || Number(value.mode) > 0o7777 ||
        (value.linkTarget !== null && typeof value.linkTarget !== 'string') ||
        (value.contentDigest !== null && (typeof value.contentDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.contentDigest)))) {
      throw new Error('Hosted Action archive metadata is invalid.');
    }
    if (!['directory', 'file', 'hardlink', 'symlink'].includes(value.type)) {
      throw new Error(`Hosted Action archive entry type is forbidden: ${value.type}.`);
    }
    const entryPath = canonicalHostedArchivePathV2(value.path, 'entry path', value.type === 'directory');
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
      ? resolveHostedArchiveLinkTargetV2(entryPath, String(value.linkTarget ?? ''), value.type === 'hardlink')
      : null;
    if (linkTarget === null && value.linkTarget !== null) {
      throw new Error(`Hosted Action archive ordinary entry has a link target: ${entryPath}.`);
    }
    if (linkTarget !== null && Number(value.size) !== 0) {
      throw new Error(`Hosted Action archive link has nonzero payload bytes: ${entryPath}.`);
    }
    const trustedContentPath = entryPath === '.sec-trusted-input/candidate.bundle' ||
      entryPath === '.sec-trusted-input/dependency-closure.json';
    if ((trustedContentPath && (value.type !== 'file' || value.contentDigest === null)) ||
        (!trustedContentPath && value.contentDigest !== null)) {
      throw new Error(`Hosted Action archive trusted content digest placement is invalid: ${entryPath}.`);
    }
    entries.push(Object.freeze({
      path: entryPath,
      type: value.type as HostedActionArchiveInventoryEntryV2['type'],
      linkTarget,
      size: Number(value.size),
      mode: Number(value.mode),
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
    const seen = new Set<string>([entry.path]);
    let cursor: HostedActionArchiveInventoryEntryV2 | undefined = target;
    while (cursor?.linkTarget !== null) {
      if (seen.has(cursor.path)) throw new Error(`Hosted Action archive link cycle is forbidden: ${entry.path}.`);
      seen.add(cursor.path);
      cursor = byPath.get(cursor.linkTarget);
      if (cursor === undefined) throw new Error(`Hosted Action archive link chain is incomplete: ${entry.path}.`);
    }
  }
  const totalFileBytes = entries.reduce((total, entry) => total + (entry.type === 'file' ? entry.size : 0), 0);
  if (!Number.isSafeInteger(totalFileBytes) ||
      totalFileBytes > CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.workspaceBytes) {
    throw new Error('Hosted Action archive file bytes exceed the private workspace bound.');
  }
  const canonicalEntries = Object.freeze([...entries].sort((left, right) => left.path.localeCompare(right.path)));
  return Object.freeze({
    entries: canonicalEntries,
    inventoryDigest: ciActionDigest(canonicalEntries),
    totalFileBytes
  });
}

export function CodexDevelopmentInspectHostedActionArchiveV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  preparedCandidateArchive: string;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  inspectArchive?: (archive: string) => unknown;
}>): CodexDevelopmentHostedActionArchiveInventoryV2 {
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.baseDependencyClosureDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.authenticatedGitClosureDigest)) {
    throw new Error('Hosted Action archive expected Git or dependency closure digest is invalid.');
  }
  const archive = realpathSync.native(path.resolve(input.preparedCandidateArchive));
  const archiveStat = lstatSync(archive);
  const archiveDigest = hostedActionFileDigestV2(archive);
  if (!archiveStat.isFile()) {
    throw new Error('Hosted Action prepared candidate archive is not one ordinary file.');
  }
  let rawInventory: unknown;
  if (input.inspectArchive !== undefined) {
    rawInventory = input.inspectArchive(archive);
  } else {
    const inventory = spawnSync('/usr/bin/python3', ['-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT_V2, archive], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 128 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
    });
    if (inventory.status !== 0 || typeof inventory.stdout !== 'string') {
      throw new Error('Hosted Action prepared candidate archive metadata is unreadable without extraction.');
    }
    rawInventory = JSON.parse(inventory.stdout) as unknown;
  }
  const validated = CodexDevelopmentValidateHostedActionArchiveInventoryV2(rawInventory);
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

export type CodexDevelopmentPreparedHostedActionInputsV2 = Readonly<{
  preparedCandidateArchive: string;
  archiveInventory: CodexDevelopmentHostedActionArchiveInventoryV2;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
}>;

function runHostedMaterializerCommandV2(
  executable: string,
  args: readonly string[],
  label: string
): void {
  const result = spawnSync(executable, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: {
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

export function CodexDevelopmentPrepareHostedActionInputsV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
}>): CodexDevelopmentPreparedHostedActionInputsV2 {
  if (process.platform !== 'linux') {
    throw new Error('Hosted Action input preparation requires the pinned ubuntu-24.04 runner.');
  }
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseHead = gitCandidateBytesV2(baseRoot, ['rev-parse', 'HEAD']).toString('utf8').trim();
  const baseTree = gitCandidateBytesV2(baseRoot, ['rev-parse', 'HEAD^{tree}']).toString('utf8').trim();
  if (baseHead !== resolution.artifactInput.baseSha || baseTree !== resolution.artifactInput.baseTreeSha) {
    throw new Error('Hosted Action dependency materializer is not the exact resolved base/tree.');
  }
  CodexDevelopmentAssertPreparedHostedActionCandidateV2({ resolution, candidateRoot });
  const dependencyClosure = hostedActionDependencyClosureV1({
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
  const baseDependencyClosureDigest = hostedActionFileDigestV2(dependencyClosurePath);
  const gitBundlePath = path.resolve(trustedInputDirectory, 'candidate.bundle');
  for (const revision of [resolution.artifactInput.baseSha, resolution.artifactInput.headSha]) {
    runHostedMaterializerCommandV2(
      '/usr/bin/git', ['-C', candidateRoot, 'cat-file', '-e', `${revision}^{commit}`],
      `Hosted Action Git object readback ${revision}`
    );
  }
  runHostedMaterializerCommandV2(
    '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/base', resolution.artifactInput.baseSha],
    'Hosted Action exact base ref materialization'
  );
  runHostedMaterializerCommandV2(
    '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/head', resolution.artifactInput.headSha],
    'Hosted Action exact head ref materialization'
  );
  runHostedMaterializerCommandV2(
    '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'create', gitBundlePath, 'refs/sec/base', 'refs/sec/head'],
    'Hosted Action authenticated candidate Git bundle materialization'
  );
  runHostedMaterializerCommandV2(
    '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'verify', gitBundlePath],
    'Hosted Action authenticated candidate Git bundle verification'
  );
  const authenticatedGitClosureDigest = hostedActionFileDigestV2(gitBundlePath);
  const preparedCandidateArchive = path.resolve(outputDirectory, 'prepared-candidate.tar');
  try {
    lstatSync(preparedCandidateArchive);
    throw new Error('Hosted Action prepared candidate archive already exists.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
  }
  runHostedMaterializerCommandV2('/usr/bin/tar', [
    '--sort=name', '--mtime=UTC 1970-01-01', '--owner=0', '--group=0', '--numeric-owner',
    '--exclude=./.git', '-cf', preparedCandidateArchive, '-C', candidateRoot, '.'
  ], 'Hosted Action raw prepared candidate archive materialization');
  const archiveInventory = CodexDevelopmentInspectHostedActionArchiveV2({
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

export function CodexDevelopmentMaterializeHostedActionCandidateV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  ticket: CodexDevelopmentHostedActionExecutionTicketV2;
  preparedCandidateArchive: string;
  inspectArchive?: (archive: string) => unknown;
}>): CodexDevelopmentHostedActionArchiveInventoryV2 {
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicketV2(
    encodeVerificationActionDataV2(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest) {
    throw new Error('Hosted Action execution ticket differs from the trusted resolution.');
  }
  const inspected = CodexDevelopmentInspectHostedActionArchiveV2({
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

const HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES_V1 = Object.freeze([
  'SEC_ACTION_PLAN_DIGEST',
  'SEC_AFFECTED_TESTS_BASE',
  'SEC_BASE_TREE_SHA',
  'SEC_CHANGED_BASE',
  'SEC_MAIN_HEALTH_DIGEST',
  'SEC_MAIN_HEALTH_REVISION',
  'SEC_REQUIRED_BLOB_CLOSURE_JSON',
  'SEC_REVIEW_RECEIPT_DIGEST',
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

export function CodexDevelopmentCandidateProcessEnvironmentV2(
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
    SEC_EXECUTION_ENVIRONMENT_REVISION: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2
  };
  for (const name of HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES_V1) {
    const value = semanticBindings[name] ?? source[name];
    if (value !== undefined) result[name] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

const HOSTED_SUT_RUNTIME_COPY_FUNCTION_V2 = Object.freeze([
  'copy_runtime() {',
  '  source="$1"',
  '  destination="$2"',
  '  [ -f "$source" ]',
  '  /usr/bin/install -D -m 0555 -- "$source" "$root$destination"',
  '  while IFS= read -r library; do',
  '    [ -n "$library" ] || continue',
  '    /usr/bin/install -D -m 0555 -- "$library" "$root$library"',
  `  done < <(/usr/bin/ldd "$source" 2>/dev/null | /usr/bin/awk '$2 == "=>" && $3 ~ /^\\// { print $3 } $1 ~ /^\\// { print $1 }' || true)`,
  '}'
] as const);

const HOSTED_SUT_RUNTIME_TOOL_CLOSURE_V2 = Object.freeze([
  '# runtime-binary-closure',
  ...HOSTED_SUT_RUNTIME_COPY_FUNCTION_V2,
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeBinaries.map(
    (runtimePath) => `copy_runtime ${runtimePath} ${runtimePath}`
  ),
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeDirectories.flatMap((runtimePath) => [
    `mkdir -p "$root${path.posix.dirname(runtimePath)}"`,
    `/usr/bin/cp -a -- ${JSON.stringify(runtimePath)} "$root${runtimePath}"`
  ]),
  'copy_runtime "$bun_host" "/tool/bin/bun"',
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeAliases.map(
    (alias) => `ln -s ${JSON.stringify(alias.target)} "$root${alias.path}"`
  )
]);

const HOSTED_SUT_NAMESPACE_SCRIPT_V1 = [
  'candidate_archive="$1"',
  'bun_host="$2"',
  'base_sha="$3"',
  'head_sha="$4"',
  'environment_count="$5"',
  'shift 5',
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 2 ]',
  '[ "$1" = "bun" ]',
  'shift',
  'mount --make-rprivate /',
  'root="$(mktemp -d /tmp/sec-hosted-sut.XXXXXX)"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root"\u0027 EXIT',
  `mount -t tmpfs -o nodev,nosuid,mode=0755,size=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.workspaceBytes} tmpfs "$root"`,
  'mkdir -p "$root/tool/bin" "$root/authenticated-input" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/etc" "$root/.oldroot"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE_V2,
  'touch "$root/authenticated-input/prepared-candidate.tar"',
  'mount --bind "$candidate_archive" "$root/authenticated-input/prepared-candidate.tar"',
  'mount -o remount,bind,ro,nosuid,nodev,noexec "$root/authenticated-input/prepared-candidate.tar"',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=' +
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.workspaceBytes + ' tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=268435456 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=268435456 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'mknod -m 0666 "$root/dev/null" c 1 3',
  'mknod -m 0666 "$root/dev/zero" c 1 5',
  'mknod -m 0666 "$root/dev/random" c 1 8',
  'mknod -m 0666 "$root/dev/urandom" c 1 9',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'printf \u0027sut:x:65532:65532:SEC hosted SUT:/home/sut:/usr/sbin/nologin\\n\u0027 > "$root/etc/passwd"',
  'printf \u0027sut:x:65532:\\n\u0027 > "$root/etc/group"',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} "$root/workspace" "$root/home/sut" "$root/tmp"`,
  'pivot_root "$root" "$root/.oldroot"',
  'cd /',
  'umount -l /.oldroot',
  'rmdir /.oldroot',
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  '/usr/bin/tar --extract --file=/authenticated-input/prepared-candidate.tar --directory=/workspace --no-same-owner --no-same-permissions --delay-directory-restore',
  'umount /authenticated-input/prepared-candidate.tar',
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
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} /workspace`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  'cd /workspace',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.cpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.processes} -- /usr/bin/env -i "\${environment[@]}" /tool/bin/bun "$@"`
].join('\n');

const HOSTED_SUT_CAPABILITY_ASSERTION_V1 = [
  'const fs = require("node:fs");',
  'const fail = (message) => { throw new Error(message); };',
  'if (process.getuid() !== 65532 || process.getgid() !== 65532 || process.pid !== 1) fail("uid-gid-pid");',
  'const status = fs.readFileSync("/proc/self/status", "utf8");',
  'if (!/^CapEff:\\s+0+$/m.test(status) || !/^NoNewPrivs:\\s+1$/m.test(status)) fail("privileges");',
  'const parentEnvironment = fs.readFileSync("/proc/1/environ");',
  'if (parentEnvironment.includes(Buffer.from("SEC_HOST_SANDBOX_SENTINEL"))) fail("parent-environment");',
  'for (const hidden of ["/.oldroot", "/home/runner/work", "/runner/_work", "/run", "/var/run", "/tmp/sec-host-sentinel"]) if (fs.existsSync(hidden)) fail(`host-path:${hidden}`);',
  'const routes = fs.readFileSync("/proc/net/route", "utf8").trim().split(/\\r?\\n/);',
  'if (routes.length > 1) fail("network-route");',
  'const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8");',
  'const mountLines = mounts.trim().split(/\\r?\\n/);',
  'const mountAt = (mountpoint) => mountLines.find((line) => line.split(" ")[4] === mountpoint);',
  'for (const mountpoint of ["/", "/workspace", "/tmp", "/home", "/dev"]) { const line = mountAt(mountpoint); if (!line || !line.includes(" - tmpfs ")) fail(`tmpfs:${mountpoint}`); }',
  'if (mountAt("/usr") || !mountAt("/proc")?.includes(" - proc ")) fail("host-usr-or-proc-mount");',
  `const expectedUsrBin = ${JSON.stringify(Object.freeze([
    ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeBinaries.map((entry) => path.posix.basename(entry)),
    'sh'
  ].sort()))};`,
  'const actualUsrBin = fs.readdirSync("/usr/bin").sort();',
  'if (JSON.stringify(actualUsrBin) !== JSON.stringify(expectedUsrBin)) fail("runtime-binary-closure");',
  'if (JSON.stringify(fs.readdirSync("/tool/bin").sort()) !== JSON.stringify(["bun", "node"])) fail("runtime-tool-aliases");',
  'if (!fs.statSync("/usr/lib/git-core").isDirectory()) fail("git-runtime-closure");',
  'for (const descriptor of fs.readdirSync("/proc/self/fd")) { try { const target = fs.readlinkSync(`/proc/self/fd/${descriptor}`); if (/\\/(?:home\\/runner|runner\\/_work|run|var\\/run|workspace)|\\.oldroot|prepared-candidate\\.tar/u.test(target)) fail(`inherited-fd:${descriptor}`); } catch {} }',
  'const cgroup = JSON.parse(fs.readFileSync("/capability/cgroup.json", "utf8"));',
  'if (cgroup.memoryMax !== "4294967296" || cgroup.pidsMax !== "256" || cgroup.cpuMax !== "200000 100000") fail("cgroup-limits");',
  'let connected = false;',
  'try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(200) }); connected = true; } catch {}',
  'if (connected) fail("network-egress");',
  'const descendant = Bun.spawn({ cmd: ["/usr/bin/sleep", "300"], detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" });',
  'descendant.unref();',
  `process.stdout.write("${CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER_V1}\\n");`
].join('');

const HOSTED_SUT_CAPABILITY_SCRIPT_V1 = [
  'bun_host="$1"',
  'export SEC_HOST_SANDBOX_SENTINEL=must-not-cross-boundary',
  'touch /tmp/sec-host-sentinel',
  'mount --make-rprivate /',
  'root="$(mktemp -d /tmp/sec-hosted-capability.XXXXXX)"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root"\u0027 EXIT',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=268435456 tmpfs "$root"',
  'mkdir -p "$root/tool/bin" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/capability" "$root/.oldroot"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE_V2,
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=67108864 tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=16777216 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'mknod -m 0666 "$root/dev/null" c 1 3',
  'mknod -m 0666 "$root/dev/zero" c 1 5',
  'mknod -m 0666 "$root/dev/random" c 1 8',
  'mknod -m 0666 "$root/dev/urandom" c 1 9',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'cgroup_path="$(/usr/bin/awk -F: \u0027$1 == "0" { print $3 }\u0027 /proc/self/cgroup)"',
  'memory_max="$(cat "/sys/fs/cgroup${cgroup_path}/memory.max")"',
  'pids_max="$(cat "/sys/fs/cgroup${cgroup_path}/pids.max")"',
  'cpu_max="$(cat "/sys/fs/cgroup${cgroup_path}/cpu.max")"',
  'printf \u0027{"cpuMax":"%s","memoryMax":"%s","pidsMax":"%s"}\\n\u0027 "$cpu_max" "$memory_max" "$pids_max" > "$root/capability/cgroup.json"',
  '[ "$(/usr/bin/prlimit --pid $$ --cpu --noheadings --output SOFT | /usr/bin/xargs)" = "1800" ]',
  '[ "$(/usr/bin/prlimit --pid $$ --as --noheadings --output SOFT | /usr/bin/xargs)" = "4294967296" ]',
  '[ "$(/usr/bin/prlimit --pid $$ --fsize --noheadings --output SOFT | /usr/bin/xargs)" = "268435456" ]',
  '[ "$(/usr/bin/prlimit --pid $$ --nofile --noheadings --output SOFT | /usr/bin/xargs)" = "1024" ]',
  '[ "$(/usr/bin/prlimit --pid $$ --nproc --noheadings --output SOFT | /usr/bin/xargs)" = "256" ]',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} "$root/home/sut" "$root/tmp" "$root/workspace" "$root/capability"`,
  'pivot_root "$root" "$root/.oldroot"',
  'cd /',
  'umount -l /.oldroot',
  'rmdir /.oldroot',
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.cpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.processes} -- /usr/bin/env -i PATH=/tool/bin:/usr/bin:/bin HOME=/home/sut TMPDIR=/tmp LANG=C /tool/bin/bun -e ${JSON.stringify(HOSTED_SUT_CAPABILITY_ASSERTION_V1)}`
].join('\n');

const HOSTED_SUT_TEARDOWN_SCRIPT_V1 = [
  'unit="$1"',
  '/usr/bin/systemctl kill --kill-who=all --signal=KILL "$unit" >/dev/null 2>&1 || true',
  '/usr/bin/systemctl stop "$unit" >/dev/null 2>&1 || true',
  'properties="$(/usr/bin/systemctl show "$unit" --property=LoadState --property=ActiveState --property=SubState --property=ControlGroup --no-pager 2>/dev/null || true)"',
  'load="$(printf \u0027%s\\n\u0027 "$properties" | /usr/bin/sed -n \u0027s/^LoadState=//p\u0027)"',
  `if [ "$load" = "not-found" ]; then printf \u0027${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:not-found\\n%s\\n\u0027 "$properties"; exit 0; fi`,
  '[ "$load" = "loaded" ]',
  'active="$(printf \u0027%s\\n\u0027 "$properties" | /usr/bin/sed -n \u0027s/^ActiveState=//p\u0027)"',
  'case "$active" in active|activating|reloading|deactivating) exit 91;; esac',
  'control_group="$(printf \u0027%s\\n\u0027 "$properties" | /usr/bin/sed -n \u0027s/^ControlGroup=//p\u0027)"',
  'if [ -n "$control_group" ] && [ -e "/sys/fs/cgroup${control_group}/cgroup.procs" ]; then remaining="$(cat "/sys/fs/cgroup${control_group}/cgroup.procs")"; [ -z "$(printf \u0027%s\u0027 "$remaining" | /usr/bin/tr -d \u0027[:space:]\u0027)" ]; fi',
  `printf \u0027${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:empty-cgroup\\n%s\\n\u0027 "$properties"`,
  '/usr/bin/systemctl reset-failed "$unit" >/dev/null 2>&1 || true'
].join('\n');

function hostedSutSandboxUnitNameV1(actionKey: VerificationActionKeyDigest, nonce: string): string {
  if (!/^[A-Za-z0-9_.-]{1,32}$/u.test(nonce)) {
    throw new Error('Hosted SUT sandbox unit nonce is invalid.');
  }
  return `sec-sut-${actionKey.slice('sha256:'.length, 'sha256:'.length + 16)}-${nonce}`;
}

function hostedSutSystemdPropertiesV1(): readonly string[] {
  return Object.freeze([
    '--property=Type=exec',
    '--property=KillMode=control-group',
    '--property=TimeoutStopSec=15s',
    `--property=RuntimeMaxSec=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.wallSeconds}s`,
    `--property=MemoryMax=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.addressSpaceBytes}`,
    `--property=TasksMax=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.processes}`,
    '--property=CPUQuota=200%',
    `--property=LimitCPU=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.cpuSeconds}`,
    `--property=LimitAS=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.addressSpaceBytes}`,
    `--property=LimitFSIZE=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.fileSizeBytes}`,
    `--property=LimitNOFILE=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.openFiles}`,
    `--property=LimitNPROC=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.processes}`,
    '--property=PrivateTmp=yes'
  ]);
}

function finalizeHostedSutSandboxCommandPlanV1(input: Readonly<{
  phase: CodexDevelopmentHostedSutSandboxCommandPlanV1['phase'];
  unitName: string;
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
}>): CodexDevelopmentHostedSutSandboxCommandPlanV1 {
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
    schema: CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA_V1,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
    phase: input.phase,
    unitName: input.unitName,
    command: '/usr/bin/sudo' as const,
    argv: Object.freeze([...input.argv]),
    candidateEnvironmentNames,
    executionAuthorizationDigest: input.executionAuthorizationDigest,
    physicalCommandProjectionDigest: input.physicalCommandProjectionDigest
  });
  return Object.freeze({ ...withoutDigest, planDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentAssertHostedSutSandboxCommandPlanV1(
  plan: CodexDevelopmentHostedSutSandboxCommandPlanV1
): void {
  const value = exactObject(plan, [
    'schema', 'policyDigest', 'phase', 'unitName', 'command', 'argv',
    'candidateEnvironmentNames', 'executionAuthorizationDigest',
    'physicalCommandProjectionDigest', 'planDigest'
  ], 'Hosted SUT sandbox command plan V1');
  if (value.schema !== CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA_V1 ||
      value.policyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1 ||
      value.command !== '/usr/bin/sudo' ||
      !['capability-self-test', 'execute', 'teardown'].includes(String(value.phase)) ||
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
  if (value.phase === 'execute') {
    if (value.executionAuthorizationDigest === null || value.physicalCommandProjectionDigest === null) {
      throw new Error('Hosted SUT execution command plan is not bound to its authorization.');
    }
    const encoded = encodeVerificationActionDataV2(value.argv);
    for (const invariant of [
      '/usr/bin/systemd-run', '--property=KillMode=control-group',
      `--property=RuntimeMaxSec=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.wallSeconds}s`,
      '/usr/bin/unshare', '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      'pivot_root', 'mount -t proc', '--no-new-privs', '--bounding-set=-all',
      '/usr/bin/env -i', '/authenticated-input/prepared-candidate.tar',
      'copy_runtime /usr/bin/bash /usr/bin/bash',
      'copy_runtime /usr/bin/tar /usr/bin/tar',
      'runtime-binary-closure'
    ]) {
      if (!encoded.includes(invariant)) throw new Error(`Hosted SUT sandbox command plan omits ${invariant}.`);
    }
    for (const forbidden of [
      'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_STEP_SUMMARY', 'ACTIONS_RUNTIME_TOKEN',
      '/var/run/docker.sock', '/run/docker.sock', '${RUNNER_TEMP}', 'mount --bind /usr'
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

export function CodexDevelopmentBuildHostedSutSandboxCommandPlanV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  candidateArchive: string;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  normalizedArgv: readonly string[];
  candidateEnvironment: NodeJS.ProcessEnv;
  executionAuthorization: CodexDevelopmentHostedSutExecutionAuthorizationV1;
}>): CodexDevelopmentHostedSutSandboxCommandPlanV1 {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.actionKey) || input.normalizedArgv[0] !== 'bun' ||
      input.normalizedArgv.length < 2 || !path.isAbsolute(input.candidateArchive) ||
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
  if (authorization.schema !== CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA_V1 ||
      authorizationDigest !== ciActionDigest(authorizationWithoutDigest) ||
      authorization.actionKey !== input.actionKey ||
      authorization.physicalCommand.actionKey !== input.actionKey ||
      authorization.physicalCommand.schema !== CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA_V1 ||
      projectionDigest !== ciActionDigest(physicalCommandWithoutDigest) ||
      authorization.physicalCommand.operationSemanticDigest !== authorization.operationSemanticDigest ||
      authorization.physicalCommand.unitName !== expectedUnitName ||
      input.baseSha !== authorization.providerOrigin.workflowSha ||
      input.headSha !== authorization.candidateSha ||
      authorization.physicalCommand.canonicalArgvDigest !== ciActionDigest(input.normalizedArgv) ||
      authorization.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1 ||
      authorization.physicalCommand.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1 ||
      authorization.physicalCommand.providerRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2 ||
      encodeVerificationActionDataV2(authorization.normalizedArgv) !==
        encodeVerificationActionDataV2(input.normalizedArgv) ||
      encodeVerificationActionDataV2(authorization.physicalCommand.fixedSandboxEnvironment) !==
        encodeVerificationActionDataV2(environmentProjection)) {
    throw new Error('Hosted SUT physical command differs from its Action-bound execution authorization.');
  }
  const unitName = authorization.physicalCommand.unitName;
  const plan = finalizeHostedSutSandboxCommandPlanV1({
    phase: 'execute',
    unitName,
    candidateEnvironmentNames: names,
    executionAuthorizationDigest: authorization.authorizationDigest,
    physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest,
    argv: [
      '--non-interactive', '--', '/usr/bin/systemd-run', '--quiet', '--wait', '--pipe',
      `--unit=${unitName}`, ...hostedSutSystemdPropertiesV1(), '--',
      '/usr/bin/unshare', '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_NAMESPACE_SCRIPT_V1, 'sec-hosted-sut',
      input.candidateArchive, input.bunExecutable, input.baseSha, input.headSha,
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`), ...input.normalizedArgv
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlanV1(plan);
  return plan;
}

function hostedSutCapabilityCommandPlanV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  bunExecutable: string;
  unitNonce: string;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorizationV1;
}>): CodexDevelopmentHostedSutSandboxCommandPlanV1 {
  if (input.executionAuthorization !== undefined &&
      input.executionAuthorization.actionKey !== input.actionKey) {
    throw new Error('Hosted SUT capability plan authorization differs from its ActionKey.');
  }
  const unitName = input.executionAuthorization?.physicalCommand.unitName ??
    hostedSutSandboxUnitNameV1(input.actionKey, input.unitNonce);
  return finalizeHostedSutSandboxCommandPlanV1({
    phase: 'capability-self-test',
    unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: input.executionAuthorization?.authorizationDigest ?? null,
    physicalCommandProjectionDigest: input.executionAuthorization?.physicalCommand.projectionDigest ?? null,
    argv: [
      '--non-interactive', '--', '/usr/bin/systemd-run', '--quiet', '--wait', '--pipe',
      `--unit=${unitName}`, ...hostedSutSystemdPropertiesV1(), '--',
      '/usr/bin/unshare', '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_CAPABILITY_SCRIPT_V1, 'sec-hosted-capability',
      input.bunExecutable
    ]
  });
}

function hostedSutTeardownCommandPlanV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  unitName: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlanV1 {
  return finalizeHostedSutSandboxCommandPlanV1({
    phase: 'teardown',
    unitName: input.unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '--non-interactive', '--', '/usr/bin/bash', '-ceu', HOSTED_SUT_TEARDOWN_SCRIPT_V1,
      'sec-hosted-teardown', input.unitName
    ]
  });
}

function defaultHostedSutSandboxProcessV1(
  plan: CodexDevelopmentHostedSutSandboxCommandPlanV1
): Promise<CodexDevelopmentHostedSutSandboxProcessObservationV1> {
  const outputByteLimit = CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1;
  const tailByteLimit = 64 * 1024;
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.argv, {
      cwd: process.cwd(),
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const streams = {
      stdout: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) },
      stderr: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) }
    };
    let outputTruncated = false;
    let commandStarted = false;
    let settled = false;
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
      const stdoutDigest = `sha256:${streams.stdout.hash.digest('hex')}` as VerificationActionKeyDigest;
      const stderrDigest = `sha256:${streams.stderr.hash.digest('hex')}` as VerificationActionKeyDigest;
      const failureTail = outputTruncated
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
        code: outputTruncated ? 125 : code,
        rawOutputDigest: ciActionDigest(outputProjection),
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
  });
}

function syntheticHostedSutSandboxProcessObservationV1(
  code: number,
  diagnostic: string
): CodexDevelopmentHostedSutSandboxProcessObservationV1 {
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

function hostedSutDiagnosticV1(value: string, fallback: string): string {
  const bounded = CodexDevelopmentFailureTailV1(value, fallback);
  const escaped = bounded.replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`
  );
  return CodexDevelopmentFailureTailV1(escaped, fallback);
}

type HostedSutSandboxCapabilityObservationV1 = Readonly<{
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

export async function CodexDevelopmentProbeHostedSutSandboxCapabilityV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorizationV1;
  bunExecutable?: string;
  unitNonce?: string;
  platform?: NodeJS.Platform;
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcessV1;
}>): Promise<HostedSutSandboxCapabilityObservationV1> {
  if ((input.platform ?? process.platform) !== 'linux') {
    const diagnostic = 'Hosted SUT sandbox requires the native ubuntu-24.04 Linux runner.';
    return Object.freeze({
      state: 'unsupported', commandPlanDigest: null,
      commandStarted: false, exitCode: null, markerObserved: false,
      outputDigest: ciActionDigest(diagnostic),
      teardownCommandStarted: false, teardownExitCode: null, residueMarkerObserved: false,
      residueReadbackDigest: ciActionDigest('no-systemd-unit'), cgroupEmpty: true, diagnostic
    });
  }
  const run = input.runSandboxProcess ?? defaultHostedSutSandboxProcessV1;
  const plan = hostedSutCapabilityCommandPlanV1({
    actionKey: input.actionKey,
    bunExecutable: path.resolve(input.bunExecutable ?? process.execPath),
    unitNonce: input.unitNonce ?? `${process.pid}`,
    executionAuthorization: input.executionAuthorization
  });
  let observed: CodexDevelopmentHostedSutSandboxProcessObservationV1;
  try {
    observed = await run(plan);
  } catch (error) {
    observed = syntheticHostedSutSandboxProcessObservationV1(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const teardownPlan = hostedSutTeardownCommandPlanV1({ actionKey: input.actionKey, unitName: plan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservationV1;
  try {
    teardown = await run(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservationV1(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const selfTestPassed = observed.commandStarted && observed.code === 0 &&
    observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER_V1);
  const collectedUnit = teardown.failureTail.includes(
    `${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:not-found`
  );
  const residuePassed = teardown.commandStarted && teardown.code === 0 &&
    teardown.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1) &&
    (!collectedUnit || observed.commandStarted);
  if (selfTestPassed && residuePassed) {
    return Object.freeze({
      state: 'supported',
      commandPlanDigest: plan.physicalCommandProjectionDigest ?? plan.planDigest,
      commandStarted: observed.commandStarted, exitCode: observed.code,
      markerObserved: observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER_V1),
      outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest,
      teardownCommandStarted: teardown.commandStarted, teardownExitCode: teardown.code,
      residueMarkerObserved: teardown.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1),
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
    markerObserved: observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER_V1),
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest,
    teardownCommandStarted: teardown.commandStarted, teardownExitCode: teardown.code,
    residueMarkerObserved: teardown.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1),
    residueReadbackDigest: teardown.rawOutputDigest as VerificationActionKeyDigest,
    cgroupEmpty: residuePassed,
    diagnostic: failure.length > 0 ? hostedSutDiagnosticV1(
      failure,
      'Hosted SUT sandbox capability self-test failed.'
    ) : 'Hosted SUT sandbox capability self-test failed without a diagnostic.'
  });
}

function finalizeHostedSutSandboxReceiptV1(input: Omit<
  CodexDevelopmentHostedSutSandboxReceiptV1,
  'schema' | 'policyDigest' | 'resources' | 'receiptDigest'
>): CodexDevelopmentHostedSutSandboxReceiptV1 {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
    actionKey: input.actionKey,
    capability: input.capability,
    commandPlanDigest: input.commandPlanDigest,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits,
    authenticatedArchive: input.authenticatedArchive,
    rootIsolation: input.rootIsolation,
    execution: input.execution,
    reap: input.reap,
    residue: input.residue,
    diagnostic: input.diagnostic
  });
  return CodexDevelopmentParseHostedSutSandboxReceiptV1(Object.freeze({
    ...withoutDigest,
    receiptDigest: ciActionDigest(withoutDigest)
  }));
}

function hostedSutRootIsolationReceiptV1(environmentNames: readonly string[]):
CodexDevelopmentHostedSutSandboxReceiptV1['rootIsolation'] {
  return Object.freeze({
    substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate,
    namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.namespaces,
    uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid,
    gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid,
    network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.network,
    inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.inputMount,
    workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.workspace,
    outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport,
    candidateEnvironmentNames: Object.freeze([...environmentNames].sort())
  });
}

function hostedSutCapabilityReceiptV1(
  capability: HostedSutSandboxCapabilityObservationV1
): CodexDevelopmentHostedSutSandboxReceiptV1['capability'] {
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

function hostedSutInventoryClosureFromTicketV1(
  ticket: CodexDevelopmentHostedActionExecutionTicketV2
): CodexDevelopmentHostedSutInventoryClosureV1 {
  return Object.freeze({
    archiveDigest: ticket.preparedCandidateArchiveDigest,
    inventoryDigest: ticket.preparedCandidateInventoryDigest,
    entryCount: ticket.preparedCandidateEntryCount,
    totalFileBytes: ticket.preparedCandidateTotalFileBytes,
    dependencyClosureDigest: ticket.baseDependencyClosureDigest,
    gitBundleDigest: ticket.authenticatedGitClosureDigest
  });
}

export async function CodexDevelopmentExecuteHostedActionSutV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  ticket: CodexDevelopmentHostedActionExecutionTicketV2;
  candidateArchive: string;
  archiveInventory: CodexDevelopmentHostedActionArchiveInventoryV2;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  platform?: NodeJS.Platform;
  bunExecutable?: string;
  unitNonce?: string;
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcessV1;
}>): Promise<CodexDevelopmentHostedActionRawResultV2> {
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicketV2(
    encodeVerificationActionDataV2(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
    throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
  }
  const ticketInventory = hostedSutInventoryClosureFromTicketV1(ticket);
  if (encodeVerificationActionDataV2(ticketInventory) !== encodeVerificationActionDataV2(input.archiveInventory)) {
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
  const executionAuthorization = CodexDevelopmentCreateHostedSutExecutionAuthorizationV1({
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
  const env = CodexDevelopmentHostedSutCandidateEnvironmentV1({
    normalizedOperation,
    manifestPath: resolution.artifactInput.manifestPath
  });
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const actionKey = resolution.actionPlan.action.actionKey;
  const unitNonce = input.unitNonce ?? `${process.pid}-${startedAt.getTime()}`;
  const runSandboxProcess = input.runSandboxProcess ?? defaultHostedSutSandboxProcessV1;
  const capability = await CodexDevelopmentProbeHostedSutSandboxCapabilityV1({
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
    const receipt = finalizeHostedSutSandboxReceiptV1({
      actionKey,
      capability: hostedSutCapabilityReceiptV1(capability),
      commandPlanDigest: null,
      authenticatedArchive: Object.freeze({
        archiveDigest: input.archiveInventory.archiveDigest,
        inventoryDigest: input.archiveInventory.inventoryDigest,
        dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
        gitBundleDigest: input.archiveInventory.gitBundleDigest,
        entryCount: input.archiveInventory.entryCount,
        totalFileBytes: input.archiveInventory.totalFileBytes
      }),
      rootIsolation: hostedSutRootIsolationReceiptV1(Object.keys(env)),
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
        systemdUnitStopped: capability.cgroupEmpty
      }),
      residue: Object.freeze({
        cgroupEmpty: capability.cgroupEmpty,
        hostReadbackDigest: capability.residueReadbackDigest
      }),
      diagnostic: capability.diagnostic
    });
    return CodexDevelopmentFinalizeHostedActionRawResultV2({
      executionAuthorizationDigest: executionAuthorization.authorizationDigest,
      command: null,
      sandboxReceipt: receipt,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    });
  }

  const candidateArchive = realpathSync.native(path.resolve(input.candidateArchive));
  const preExecutionArchiveDigest = hostedActionFileDigestV2(candidateArchive);
  if (!lstatSync(candidateArchive).isFile() ||
      preExecutionArchiveDigest !== input.archiveInventory.archiveDigest) {
    throw new Error('Hosted SUT authenticated archive changed after metadata validation.');
  }
  const commandPlan = CodexDevelopmentBuildHostedSutSandboxCommandPlanV1({
    actionKey,
    candidateArchive,
    bunExecutable: realpathSync.native(path.resolve(input.bunExecutable ?? process.execPath)),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: ciVerificationNormalizedOperationArgvV2(normalizedOperation),
    candidateEnvironment: env,
    executionAuthorization
  });
  let physical: CodexDevelopmentHostedSutSandboxProcessObservationV1 | null = null;
  let executionObservationLost = false;
  const exitCode = await executeVerifiedCiActionPlanV1({
    plan: resolution.actionPlan,
    authorizedClosure: resolution.actionPlanClosure,
    repositoryRoot: '/',
    environment: env,
    executeNormalizedOperation: async (operation) => {
      if (operation.semanticDigest !== normalizedOperation.semanticDigest) {
        throw new Error('Hosted SUT executor received a substituted normalized operation.');
      }
      try {
        physical = await runSandboxProcess(commandPlan);
        return physical.code;
      } catch (error) {
        executionObservationLost = true;
        physical = syntheticHostedSutSandboxProcessObservationV1(
          1, error instanceof Error ? error.message : String(error)
        );
        return 1;
      }
    }
  });
  const observedPhysical = physical as CodexDevelopmentHostedSutSandboxProcessObservationV1 | null;
  if (observedPhysical === null || exitCode !== observedPhysical.code) {
    throw new Error('Hosted Action facade lost its one physical process observation.');
  }
  const processResult = observedPhysical;
  const teardownPlan = hostedSutTeardownCommandPlanV1({ actionKey, unitName: commandPlan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservationV1;
  try {
    teardown = await runSandboxProcess(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservationV1(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const collectedUnit = teardown.failureTail.includes(
    `${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:not-found`
  );
  const residuePassed = teardown.commandStarted && teardown.code === 0 &&
    teardown.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1) &&
    (!collectedUnit || processResult.commandStarted);
  let postExecutionArchiveDigest: VerificationActionKeyDigest | null = null;
  let archiveReadbackDiagnostic: string | null = null;
  try {
    postExecutionArchiveDigest = hostedActionFileDigestV2(candidateArchive);
  } catch (error) {
    archiveReadbackDiagnostic = error instanceof Error ? error.message : String(error);
  }
  const archiveStable = postExecutionArchiveDigest === preExecutionArchiveDigest;
  const sandboxInvalidated = executionObservationLost || !processResult.commandStarted ||
    processResult.outputTruncated ||
    processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1 ||
    processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1 ||
    !residuePassed || !archiveStable;
  const finishedAt = now();
  const diagnostic = sandboxInvalidated
    ? hostedSutDiagnosticV1([
        executionObservationLost ? 'Hosted SUT physical process observation was lost.' : '',
        processResult.outputTruncated ? 'Hosted SUT physical process output was truncated.' : '',
        processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1
          ? 'Hosted SUT stdout exceeded its observed byte bound.' : '',
        processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1
          ? 'Hosted SUT stderr exceeded its observed byte bound.' : '',
        residuePassed ? '' : `Hosted SUT residue readback failed: ${teardown.failureTail}`,
        archiveStable ? '' : `Hosted SUT authenticated archive readback failed: ${archiveReadbackDiagnostic ?? 'digest changed'}`
      ].filter(Boolean).join('\n'), 'Hosted SUT sandbox was invalidated.')
    : processResult.code === 0 ? null
      : hostedSutDiagnosticV1(processResult.failureTail, `${normalizedOperation.gateId} failed.`);
  const receipt = finalizeHostedSutSandboxReceiptV1({
    actionKey,
    capability: hostedSutCapabilityReceiptV1(capability),
    commandPlanDigest: commandPlan.physicalCommandProjectionDigest,
    authenticatedArchive: Object.freeze({
      archiveDigest: input.archiveInventory.archiveDigest,
      inventoryDigest: input.archiveInventory.inventoryDigest,
      dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
      gitBundleDigest: input.archiveInventory.gitBundleDigest,
      entryCount: input.archiveInventory.entryCount,
      totalFileBytes: input.archiveInventory.totalFileBytes
    }),
    rootIsolation: hostedSutRootIsolationReceiptV1(Object.keys(env)),
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
      systemdUnitStopped: residuePassed
    }),
    residue: Object.freeze({
      cgroupEmpty: residuePassed,
      hostReadbackDigest: teardown.rawOutputDigest as VerificationActionKeyDigest
    }),
    diagnostic
  });
  return CodexDevelopmentFinalizeHostedActionRawResultV2({
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
}

export function CodexDevelopmentParseHostedActionRawResultV2(
  source: string
): CodexDevelopmentHostedActionRawResultV2 {
  return parseHostedActionRawResultContractV2(source);
}

export function CodexDevelopmentAssembleHostedActionTerminalV2(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolutionV2;
  ticket: CodexDevelopmentHostedActionExecutionTicketV2;
  rawResult: CodexDevelopmentHostedActionRawResultV2;
  expectedRawResultDigest: VerificationActionKeyDigest;
  producer: CodexDevelopmentVerificationActionArtifactProducerV2;
}>): CodexDevelopmentVerificationActionTerminalArtifactV2 {
  const resolution = CodexDevelopmentParseHostedActionResolutionV2(
    encodeVerificationActionDataV2(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicketV2(
    encodeVerificationActionDataV2(input.ticket)
  );
  const rawResult = CodexDevelopmentParseHostedActionRawResultV2(
    encodeVerificationActionDataV2(input.rawResult)
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
      encodeVerificationActionDataV2(input.producer) !== encodeVerificationActionDataV2(ticket.producer)) {
    throw new Error('Hosted Action assembler inputs differ from the original trusted execution ticket.');
  }
  const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorizationV1({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: hostedSutInventoryClosureFromTicketV1(ticket),
    producer: input.producer
  });
  const terminal = CodexDevelopmentReduceHostedSutObservationV1({
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
  return CodexDevelopmentFinalizeVerificationActionTerminalArtifactV2({
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    result: terminal.result,
    cleanup: terminal.cleanup,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
    input: resolution.artifactInput,
    producer: input.producer,
    executionProof: terminal.proof
  });
}

function terminalDependencyState(
  artifact: CodexDevelopmentVerificationActionTerminalArtifactV2 | undefined
): VerificationActionDependencyResolutionV2['state'] {
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

function deriveHostedSyntheticNotRunActionKeysV2(
  plan: CiVerificationActionPlanClosureV1,
  terminalArtifactsByKey: ReadonlyMap<VerificationActionKeyDigest,
    CodexDevelopmentVerificationActionTerminalArtifactV2>
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

export function CodexDevelopmentCoordinateHostedActionsV2(input: Readonly<{
  envelope: VerificationSessionHostedEnvelopeV1;
  observations: readonly CodexDevelopmentHostedActionArtifactObservationV2[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservationV2[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservationV2[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadbackV2[];
}>): CodexDevelopmentHostedActionCoordinationV2 {
  const envelope = parseHostedEnvelopeV1(input.envelope);
  const plan = envelope.actionPlanClosure;
  const membersByKey = new Map(plan.actions.map((member) => [member.action.actionKey, member] as const));
  const actionKeyForName = (name: string, kind: 'start' | 'terminal' | 'anchor'): VerificationActionKeyDigest => {
    const member = plan.actions.find((entry) => {
      if (kind === 'start') return verificationActionStartMarkerNameV2(entry.action.actionKey) === name;
      if (kind === 'terminal') return verificationActionProviderTerminalArtifactNameV2(entry.action.actionKey) === name;
      return verificationActionProviderTerminalAnchorNameV2(entry.action.actionKey) === name;
    });
    if (member === undefined) throw new Error('Hosted Action provider artifact is outside the canonical Session closure.');
    return member.action.actionKey;
  };
  const origins = new Set<string>();
  const assertCurrentBaseOrigin = (
    origin: CodexDevelopmentVerificationActionArtifactProducerV2 | null,
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
  const terminalsByKey = new Map<VerificationActionKeyDigest, CodexDevelopmentHostedActionArtifactObservationV2>();
  for (const observation of input.observations) {
    const provider = observation.providerObservation;
    assertCurrentBaseOrigin(provider.referencedOrigin, 'Hosted Action terminal origin');
    claimOrigin(provider.originId);
    const actionKey = actionKeyForName(provider.artifactName, 'terminal');
    if (terminalsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple terminal origins.');
    if (observation.artifact !== null) {
      const member = membersByKey.get(actionKey)!;
      CodexDevelopmentAssertVerificationActionTerminalArtifactV2(observation.artifact, {
        actionPlan: member,
        executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2
      });
      if (provider.payload === null || provider.payload.payloadDigest !== observation.artifact.artifactDigest ||
          provider.payload.actionKey !== actionKey || provider.payload.candidateSha !== envelope.session.headSha ||
          encodeVerificationActionDataV2(provider.payload.producer) !==
            encodeVerificationActionDataV2(observation.artifact.producer)) {
        throw new Error('Hosted Action terminal provider fact differs from the canonical terminal artifact.');
      }
    }
    terminalsByKey.set(actionKey, observation);
  }
  const startsByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderStartObservationV2>();
  for (const observation of input.startObservations) {
    assertCurrentBaseOrigin(observation.referencedOrigin, 'Hosted Action start origin');
    claimOrigin(observation.originId);
    const actionKey = actionKeyForName(observation.artifactName, 'start');
    if (startsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple start origins.');
    startsByKey.set(actionKey, observation);
  }
  const anchorsByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderTerminalAnchorObservationV2>();
  for (const observation of input.terminalAnchorObservations) {
    assertCurrentBaseOrigin(observation.referencedOrigin, 'Hosted Action terminal anchor origin');
    claimOrigin(observation.originId);
    const actionKey = actionKeyForName(observation.artifactName, 'anchor');
    if (anchorsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple terminal anchor origins.');
    anchorsByKey.set(actionKey, observation);
  }
  const statusReadbacksByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderStatusReadbackV2>();
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

  const byKey = new Map<VerificationActionKeyDigest, CodexDevelopmentVerificationActionTerminalArtifactV2>();
  const repairable: VerificationActionKeyDigest[] = [];
  const firstExecutionCandidates = new Set<VerificationActionKeyDigest>();
  for (const member of plan.actions) {
    const actionKey = member.action.actionKey;
    const decision = reduceVerificationActionProviderStateV2({
      repositoryId: statusReadbacksByKey.get(actionKey)!.repositoryId,
      repository: envelope.scopeAuthorization.repository,
      actionKey,
      candidateSha: envelope.session.headSha,
      executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
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
  const syntheticNotRunActionKeys = deriveHostedSyntheticNotRunActionKeysV2(plan, byKey);
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
    const runnableDecision = isVerificationActionRunnableV2(member, dependencies);
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
  disposition: CodexDevelopmentHostedActionCoordinationV2['disposition'],
  dispatchActionKeys: readonly VerificationActionKeyDigest[],
  terminalActionKeys: readonly VerificationActionKeyDigest[],
  missingActionKeys: readonly VerificationActionKeyDigest[],
  reason: string | null
): CodexDevelopmentHostedActionCoordinationV2 {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_COORDINATION_SCHEMA_V2,
    disposition,
    actionPlanDigest,
    dispatchActionKeys: Object.freeze([...dispatchActionKeys].sort()),
    terminalActionKeys: Object.freeze([...terminalActionKeys].sort()),
    missingActionKeys: Object.freeze([...missingActionKeys].sort()),
    reason
  });
  return Object.freeze({ ...withoutDigest, coordinationDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentComposeHostedEvidenceV2(input: Readonly<{
  envelope: VerificationSessionHostedEnvelopeV1;
  observations: readonly CodexDevelopmentHostedActionArtifactObservationV2[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservationV2[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservationV2[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadbackV2[];
  producer: ReturnType<typeof CodexDevelopmentCreateVerificationEvidenceProducerV4>;
  now?: () => Date;
}>): Readonly<{
  coordination: CodexDevelopmentHostedActionCoordinationV2;
  evidence: CodexDevelopmentVerificationEvidenceV4 | null;
}> {
  const envelope = parseHostedEnvelopeV1(input.envelope);
  const coordination = CodexDevelopmentCoordinateHostedActionsV2({
    envelope,
    observations: input.observations,
    startObservations: input.startObservations,
    terminalAnchorObservations: input.terminalAnchorObservations,
    providerStatusReadbacks: input.providerStatusReadbacks
  });
  if (coordination.disposition !== 'complete') {
    return Object.freeze({ coordination, evidence: null });
  }
  const byKey = new Map<VerificationActionKeyDigest, CodexDevelopmentVerificationActionTerminalArtifactV2>();
  for (const observation of input.observations) {
    if (!observation.providerObservation.expired && observation.artifact !== null) {
      byKey.set(observation.artifact.actionPlan.action.actionKey, observation.artifact);
    }
  }
  const syntheticNotRunActionKeys = deriveHostedSyntheticNotRunActionKeysV2(
    envelope.actionPlanClosure,
    byKey
  );
  const gates = envelope.actionPlanClosure.actions.map((member) => {
    const artifact = byKey.get(member.action.actionKey);
    if (artifact !== undefined) {
      const evidenceRef = `verification-action-artifact:${artifact.artifactDigest}`;
      const reusableTerminal = artifact.result.status === 'passed' || artifact.result.status === 'failed';
      const result = CodexDevelopmentBuildVerificationGateResultV1({
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
      result: CodexDevelopmentBuildVerificationGateResultV1({
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

export type CodexDevelopmentCiVerificationMainOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  repositoryRoot?: string;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  changedRecords?: (baseRef: string) => CodexDevelopmentGitChangedRecordV1[] | null;
  gitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
  readGitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobBytesV1 | null;
  gitFiles?: (ref: string, prefix: string) => string[] | null;
  runGate?: (
    step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }
  ) => Promise<CodexDevelopmentGateProcessResultV1>;
  writeEvidence?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV2) => void;
  /** Legacy test injection only. V3 publication is retired and this callback is never invoked. */
  writeEvidenceV3?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV3) => void;
  writeEvidenceV4?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV4) => void;
  actionRunner?: VerificationActionRunnerV2;
  readDurableActionResult?: (actionKey: VerificationActionKeyDigest) => Readonly<{
    result: VerificationGateResultV1;
    evidenceRefs: readonly string[];
  }> | null;
  readExactGitBlob?: typeof CodexDevelopmentReadExactGitBlobV1;
  resolvePolicy?: (policyId: string) => CodexDevelopmentEvidenceCompositionPolicyV1;
};

export interface CodexDevelopmentCiActionExecutionV1 {
  readonly actionPlan: CiVerificationActionPlanClosureV1;
  readonly gates: readonly CodexDevelopmentVerificationGateEvidenceV4[];
  readonly failed: boolean;
}

export async function CodexDevelopmentExecuteCiActionClosureV1(options: {
  readonly repositoryRoot: string;
  readonly actionPlan: CiVerificationActionPlanClosureV1;
  readonly gates: readonly Readonly<{
    gate: CiVerificationProducerGateV1;
    env: NodeJS.ProcessEnv;
  }>[];
  readonly headSha: string;
  readonly now: () => Date;
  readonly runGate: (step: {
    id: string;
    argv: string[];
    env: NodeJS.ProcessEnv;
  }) => Promise<CodexDevelopmentGateProcessResultV1>;
  readonly actionRunner?: VerificationActionRunnerV2;
  readonly readDurableActionResult?: CodexDevelopmentCiVerificationMainOptions['readDurableActionResult'];
}): Promise<CodexDevelopmentCiActionExecutionV1> {
  const actionPlan = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(options.actionPlan)
  );
  if (options.gates.length !== actionPlan.actions.length) {
    throw new Error('CI Action executor gate/plan cardinality mismatch.');
  }
  const runner = options.actionRunner ?? createVerificationActionRunnerV2();
  const evidence: CodexDevelopmentVerificationGateEvidenceV4[] = [];
  let failed = false;
  for (let index = 0; index < actionPlan.actions.length; index += 1) {
    const plan = actionPlan.actions[index]!;
    const operation = actionPlan.normalizedOperations[index]!;
    const descriptor = options.gates[index]!;
    const authorizedArgv = ciVerificationNormalizedOperationArgvV2(operation);
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
        encodeVerificationActionDataV2(descriptor.gate.argv) !==
          encodeVerificationActionDataV2(authorizedArgv) ||
        encodeVerificationActionDataV2(descriptor.gate.coveredScopeIds) !==
          encodeVerificationActionDataV2(operation.coveredScopeIds) ||
        encodeVerificationActionDataV2(descriptorBindings) !==
          encodeVerificationActionDataV2(operationBindings)) {
      throw new Error(`CI Action executor descriptor for ${operation.gateId} differs from its authorized operation.`);
    }
    if (failed) {
      evidence.push({
        action: plan.action,
        result: CodexDevelopmentBuildVerificationGateResultV1({
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
    let physical: CodexDevelopmentGateProcessResultV1 | null = null;
    let gateStarted: Date | null = null;
    let gateFinished: Date | null = null;
    const outcome: VerificationActionRunOutcomeV2 = await runner.execute({
      repositoryRoot: options.repositoryRoot,
      action: plan.action,
      plan,
      executionDomain: 'hosted-ci',
      executor: async () => {
        gateStarted = options.now();
        physical = await options.runGate({
          id: operation.gateId,
          argv: [...authorizedArgv],
          env: descriptor.env
        });
        gateFinished = options.now();
        return createVerificationActionTerminalV2({
          status: physical.code === 0 ? 'passed' : 'failed',
          reasonCode: physical.code === 0 ? 'executed-success' : 'executed-failure',
          resultDigest: physical.rawOutputDigest
        });
      }
    });
    let result: VerificationGateResultV1;
    if (outcome.physicalExecution) {
      if (physical === null || gateStarted === null || gateFinished === null || outcome.terminal === null) {
        throw new Error(`CI Action ${plan.action.actionKey} lost its physical terminal observation.`);
      }
      const processResult = physical as CodexDevelopmentGateProcessResultV1;
      const started = gateStarted as Date;
      const finished = gateFinished as Date;
      result = CodexDevelopmentBuildVerificationGateResultV1({
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
          : CodexDevelopmentFailureTailV1(processResult.failureTail, `${descriptor.gate.id} failed.`)
      });
    } else {
      const durable = options.readDurableActionResult?.(plan.action.actionKey) ?? null;
      if (durable === null || durable.evidenceRefs.length === 0 ||
          durable.result.inputDigest !== plan.action.actionKey ||
          durable.result.subjectRevision !== options.headSha) {
        throw new Error(`CI Action ${plan.action.actionKey} ${outcome.disposition} without independently readable durable Evidence.`);
      }
      result = CodexDevelopmentBuildVerificationGateResultV1({
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

function formalHostedBinding(env: NodeJS.ProcessEnv): Readonly<{
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
  executionEnvironmentRevision: string;
  requiredBlobs: readonly { path: string; digest: `sha256:${string}` }[];
}> | null {
  if (env.SEC_FORMAL_HOSTED_MODE !== '1') return null;
  for (const key of FORMAL_HOSTED_ENV_KEYS) {
    if (env[key] === undefined || env[key] === '') throw new Error(`Formal hosted verification requires ${key}.`);
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
      throw new Error(`Formal hosted requiredBlobs[${index}] is invalid.`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.path !== 'string' || candidate.path.length === 0 || candidate.path.includes('\\') ||
        candidate.path.startsWith('/') || candidate.path.startsWith('../')) {
      throw new Error(`Formal hosted requiredBlobs[${index}].path is invalid.`);
    }
    return Object.freeze({
      path: candidate.path,
      digest: digest(String(candidate.digest), `requiredBlobs[${index}].digest`)
    });
  });
  return Object.freeze({
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
    executionEnvironmentRevision: (() => {
      if (env.SEC_EXECUTION_ENVIRONMENT_REVISION !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2) {
        throw new Error('Formal hosted verification execution environment revision is not canonical.');
      }
      return env.SEC_EXECUTION_ENVIRONMENT_REVISION;
    })(),
    requiredBlobs: Object.freeze(requiredBlobs)
  });
}

function parseProfile(argv: string[]): { profile: CodexDevelopmentVerificationPlanProfileV1; expectedHead: string | undefined } {
  let profile: CodexDevelopmentVerificationPlanProfileV1 | null = null;
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

function defaultGitBlob(
  repositoryRoot: string,
  ref: string,
  file: string
): CodexDevelopmentExactGitBlobV1 | null {
  try {
    const entry = CodexDevelopmentReadExactGitBlobEntryV1({
      repositoryRoot,
      commitSha: ref,
      repositoryPath: file
    });
    return { mode: entry.mode, type: entry.type, blobSha: entry.blobSha };
  } catch {
    return null;
  }
}

function defaultReadGitBlob(
  repositoryRoot: string,
  readExactGitBlob: (
    options: CodexDevelopmentExactGitBlobReadOptionsV1
  ) => ReturnType<typeof CodexDevelopmentReadExactGitBlobV1>,
  ref: string,
  file: string
): CodexDevelopmentExactGitBlobBytesV1 | null {
  try {
    return readExactGitBlob({
      repositoryRoot,
      commitSha: ref,
      repositoryPath: file
    });
  } catch {
    return null;
  }
}

function defaultGitFiles(repositoryRoot: string, ref: string, prefix: string): string[] | null {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', '--full-tree', ref, '--', prefix], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  let output: string;
  try {
    output = decodeGitPathOutput(result.stdout, 'tree-path');
  } catch {
    return null;
  }
  if (output.length > 0 && !output.endsWith('\0')) return null;
  return output.split('\0').filter(Boolean);
}

function notRunGate(step: CiVerificationGateStep): CodexDevelopmentVerificationGateEvidenceV2 {
  return CodexDevelopmentCreateNotRunGateV2({
    id: step.id,
    argv: ['bun', ...step.args]
  });
}

type ManifestBinding = {
  manifestPath: string | null;
  manifestDigest: string | null;
  manifest: CodexDevelopmentWorkPackageManifest | null;
};

function manifestBinding(
  env: NodeJS.ProcessEnv,
  repositoryRoot: string,
  headSha: string,
  readExactGitBlob: (
    options: CodexDevelopmentExactGitBlobReadOptionsV1
  ) => ReturnType<typeof CodexDevelopmentReadExactGitBlobV1>
): ManifestBinding {
  const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
  if (!manifestPath) return { manifestPath: null, manifestDigest: null, manifest: null };
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('SEC_WORK_PACKAGE_MANIFEST_PATH must be a canonical repository-relative Work Package path.');
  }
  const source = readExactGitBlob({
    repositoryRoot,
    commitSha: headSha,
    maxBytes: 1024 * 1024,
    repositoryPath: manifestPath
  }).bytes;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const manifest = CodexDevelopmentParseWorkPackageManifest(text, manifestPath);
  if (manifest.schema === CodexDevelopmentWorkPackageSchemaV1
    && manifest.ciRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
    throw new Error('Work Package manifest does not target the current CI verification revision.');
  }
  return {
    manifestPath,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(source),
    manifest
  };
}

function afterRetention(date: Date): string {
  return new Date(
    date.getTime() + CodexDevelopmentVerificationArtifactRetentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

function notRunCompositionGate(
  gate: CodexDevelopmentEvidenceCompositionGateV1
): CodexDevelopmentVerificationGateEvidenceV3 {
  return {
    id: gate.gateId,
    argv: [...gate.argv],
    runtime: gate.runtime,
    envAllowlistRevision: gate.envAllowlistRevision,
    envDigest: gate.envDigest,
    disposition: gate.disposition,
    coveredScopeIds: [...gate.coveredScopeIds],
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'Gate was not reached because preflight or an earlier fail-fast gate did not complete.'
  };
}

export async function CodexDevelopmentCiVerificationMain(
  options: CodexDevelopmentCiVerificationMainOptions = {}
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const readExactGitBlob = options.readExactGitBlob ?? CodexDevelopmentReadExactGitBlobV1;
  const gitRevision = options.gitRevision
    ?? ((ref: string) => CodexDevelopmentDefaultGitRevisionV1(repositoryRoot, ref));
  const trackedTreeIsClean = options.trackedTreeIsClean
    ?? (() => CodexDevelopmentDefaultTrackedTreeIsCleanV1(repositoryRoot));
  const changedFileResolver = options.changedFiles;
  const changedRecordResolver = options.changedRecords;
  const gitBlob = options.gitBlob
    ?? ((ref: string, file: string) => defaultGitBlob(repositoryRoot, ref, file));
  const readGitBlob = options.readGitBlob
    ?? ((ref: string, file: string) =>
      defaultReadGitBlob(repositoryRoot, readExactGitBlob, ref, file));
  const gitFiles = options.gitFiles
    ?? ((ref: string, prefix: string) => defaultGitFiles(repositoryRoot, ref, prefix));
  const runGate = options.runGate
    ?? ((step) => CodexDevelopmentRunGateProcessV1(repositoryRoot, step));
  const writeEvidence = options.writeEvidence;
  const writeEvidenceV4 = options.writeEvidenceV4;
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
  let profile: CodexDevelopmentVerificationPlanProfileV1 = 'quick';
  let files: string[] | null = null;
  let selectionResolved = false;
  let steps: CiVerificationGateStep[] = [];
  let gates: CodexDevelopmentVerificationGateEvidenceV2[] = [];
  let compositionPlan: CodexDevelopmentEvidenceCompositionPlanV1 | null = null;
  let compositionExecutionEnvironment: NodeJS.ProcessEnv | null = null;
  let compositionGates: CodexDevelopmentVerificationGateEvidenceV3[] = [];
  let actionPlan: CiVerificationActionPlanClosureV1 | null = null;
  let actionCandidate: CiVerificationActionCandidateV1 | null = null;
  let actionGates: readonly CodexDevelopmentVerificationGateEvidenceV4[] = [];
  let formalBinding: ReturnType<typeof formalHostedBinding> = null;
  let failure: CodexDevelopmentVerificationEvidenceV2['failure'] = null;
  let exitCode = 0;
  let stage = 'argv';
  let binding: ManifestBinding = { manifestPath: null, manifestDigest: null, manifest: null };
  let initializationFailure: string | null = null;

  try {
    CodexDevelopmentPrepareVerificationEvidenceTarget(evidencePath);
  } catch (error) {
    initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  if (initializationFailure === null) {
    try {
      started = now();
      startedAt = started.toISOString();
      headSha = gitRevision('HEAD');
      treeSha = gitRevision('HEAD^{tree}');
      prBaseSha = gitRevision(prBaseRef);
      affectedBaseSha = gitRevision(affectedBaseRef);
      cleanBefore = trackedTreeIsClean();
    } catch (error) {
      initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
    }
  }

  try {
    if (initializationFailure) throw new Error(`CI verification initialization failed: ${initializationFailure}`);
    const parsed = parseProfile(argv);
    profile = parsed.profile;
    stage = 'preflight';
    if (!headSha || !treeSha || !prBaseSha || !affectedBaseSha) {
      throw new Error('CI verification cannot resolve exact head/tree/two bases.');
    }
    assertCiExpectedHead(headSha, parsed.expectedHead ?? env.SEC_EXPECTED_HEAD_SHA);
    if (!cleanBefore) throw new Error('CI verification requires a clean complete worktree before execution.');
    stage = 'manifest';
    binding = manifestBinding(env, repositoryRoot, headSha, readExactGitBlob);
    stage = 'preflight';
    if (binding.manifest !== null && binding.manifest.base !== prBaseSha) {
      throw new Error('Work Package manifest base does not match the exact PR base.');
    }
    if (binding.manifestPath !== null && prBaseSha !== affectedBaseSha) {
      throw new Error('Frozen verification requires the exact affected base to equal the current PR base.');
    }
    formalBinding = formalHostedBinding(env);
    let changedRecords: CodexDevelopmentGitChangedRecordV1[] | null;
    let rawChangedFiles: string[] | null;
    if (changedRecordResolver) {
      changedRecords = changedRecordResolver(prBaseSha);
      rawChangedFiles = changedRecords === null
        ? null
        : CodexDevelopmentChangedFilesFromRecordsV1(changedRecords);
    } else if (changedFileResolver) {
      rawChangedFiles = changedFileResolver(prBaseSha);
      changedRecords = rawChangedFiles?.map((file) => ({ status: 'changed' as const, path: file })) ?? null;
    } else {
      const snapshot = CodexDevelopmentDefaultChangedPathsV1(repositoryRoot, prBaseSha);
      changedRecords = snapshot?.records ?? null;
      rawChangedFiles = snapshot?.files ?? null;
    }
    const requiredPolicyId = changedRecords === null
      ? null
      : CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
        records: changedRecords,
        baseHead: prBaseSha,
        currentHead: headSha,
        gitBlob
      });
    if (requiredPolicyId !== null && (
      binding.manifest?.schema !== CodexDevelopmentWorkPackageSchemaV2
      || binding.manifest.id !== CodexDevelopmentSm3P0WorkPackageIdV1
      || binding.manifest.evidenceComposition.policyId !== requiredPolicyId
    )) {
      throw new Error(`Protected SM3 P0 inputs require Work Package V2 policy ${requiredPolicyId}.`);
    }
    if (binding.manifest?.schema === CodexDevelopmentWorkPackageSchemaV2) {
      if (profile !== 'quick') throw new Error('Composition verification supports --profile quick only.');
      if (!rawChangedFiles) throw new Error('Composition verification cannot resolve the complete changed-path set.');
      const testFiles = gitFiles(headSha, 'tests');
      if (!testFiles) throw new Error('Composition verification cannot enumerate exact-head test files.');
      const testImpactSourceProvider = {
        testFiles: testFiles.filter(isTestFile),
        readTestSource: (testFile: string): string | null => {
          const entry = readGitBlob(headSha!, testFile);
          if (!entry) throw new Error(`Composition verification cannot read exact-head test source: ${testFile}.`);
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
          } catch (error) {
            throw new Error(`Composition verification exact-head test source is not UTF-8: ${testFile}.`, { cause: error });
          }
        }
      };
      const inventory = CodexDevelopmentBuildVerificationScopeInventoryV1({
        profile,
        changedFiles: rawChangedFiles,
        runtime: `bun@${Bun.version}`,
        currentHead: headSha,
        baseHead: prBaseSha,
        changedRecords: changedRecords!,
        gitBlob,
        testImpactSourceProvider
      });
      files = inventory.fullChangedFiles;
      selectionResolved = true;
      compositionExecutionEnvironment = { ...env, SEC_CHANGED_BASE: prBaseSha };
      compositionPlan = CodexDevelopmentBuildEvidenceCompositionPlanV1({
        policyId: binding.manifest.evidenceComposition.policyId,
        workPackageId: binding.manifest.id,
        ciRevision: CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION,
        profile,
        inventory,
        runtime: `bun@${Bun.version}`,
        currentHead: headSha,
        currentTree: treeSha,
        gitBlob,
        gitTree: (ref) => gitRevision(`${ref}^{tree}`),
        readEvidence: readGitBlob,
        resolvePolicy: options.resolvePolicy ?? ((policyId) => (
          CodexDevelopmentRegisteredEvidenceCompositionPolicyV1({
            policyId,
            workPackageId: binding.manifest!.id,
            inventory,
            runtime: `bun@${Bun.version}`,
            currentHead: headSha!,
            gitBlob
          })
        )),
        executionEnvironment: compositionExecutionEnvironment
      });
      compositionGates = compositionPlan.gates.map(notRunCompositionGate);
      for (const gate of compositionPlan.gates) {
        for (const [key, value] of Object.entries(gate.env)) {
          if (
            !isCompositionProtectedEnvKey(key)
            && env[key] !== undefined
            && env[key] !== value
          ) {
            throw new Error(`Composition verification inherited environment conflicts with ${gate.gateId}:${key}.`);
          }
        }
      }
    } else {
      const plan = CodexDevelopmentBuildVerificationPlanV1(profile, rawChangedFiles);
      files = plan.changedFiles;
      selectionResolved = plan.selectionResolved;
      steps = plan.gates;
      gates = steps.map(notRunGate);
      if (steps.some((step) => step.id === 'impact-risk')) {
        console.log(`CI verification: risk gate required; reasons=[${plan.selectionReasons.join(', ')}]; owners=[${plan.affectedOwners.join(', ')}]`);
      } else {
        console.log('CI verification: no slow/workspace risk impact detected; risk gate skipped.');
      }
      if (!plan.selectionResolved) throw new Error('CI verification changed-file selection is unresolved.');
    }

    console.log(`SEC verification contract revision: ${compositionPlan ? CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION : CI_VERIFICATION_CONTRACT_REVISION}`);
    console.log(`SEC verification profile: ${profile}`);
    console.log(`SEC verification exact head: ${headSha}`);
    console.log(`SEC verification tree: ${treeSha}`);
    console.log(`SEC verification PR base: ${prBaseSha}`);
    console.log(`SEC verification affected base: ${affectedBaseSha}`);

    stage = 'gates';
    const fallbackManifestPath = 'docs/work/active-work-package.md';
    const fallbackManifest = readGitBlob(headSha, fallbackManifestPath);
    if (binding.manifestPath === null && fallbackManifest === null) {
      throw new Error('CI Action producer cannot bind a manifest/control-plane blob.');
    }
    const baseTreeSha = formalBinding?.baseTreeSha ?? gitRevision(`${prBaseSha}^{tree}`);
    if (baseTreeSha === null) throw new Error('CI Action producer cannot resolve the exact base tree.');
    const localDigest = (value: unknown): `sha256:${string}` => (
      CodexDevelopmentVerificationDigest(value) as `sha256:${string}`
    );
    const executionEnvironment = formalBinding !== null
      ? CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2
      : createCiVerificationLocalExecutionEnvironmentV2({
          os: process.platform,
          arch: process.arch,
          bunVersion: Bun.version
        });
    const localDependencyBlobs = formalBinding === null
      ? CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2.map((dependencyPath) => {
          const blob = defaultReadGitBlob(repositoryRoot, readExactGitBlob, headSha, dependencyPath);
          if (blob === null || blob.type !== 'blob') {
            throw new Error(`Local VerificationAction dependency input is unavailable: ${dependencyPath}.`);
          }
          return Object.freeze({
            path: dependencyPath,
            digest: `sha256:${createHash('sha256').update(blob.bytes).digest('hex')}` as VerificationActionKeyDigest
          });
        })
      : [];
    const candidate: CiVerificationActionCandidateV1 = {
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
    const producerGates: readonly CiVerificationProducerGateV1[] = compositionPlan
      ? compositionPlan.gates.map((gate) => Object.freeze({
          id: gate.gateId,
          phase: 'quick' as const,
          argv: Object.freeze([...gate.argv]),
          runtime: 'bun' as const,
          environment: Object.freeze({
            [`${gate.envAllowlistRevision}:environment`]: gate.envDigest as `sha256:${string}`
          }),
          coveredScopeIds: Object.freeze([...gate.coveredScopeIds])
        }))
      : steps.map(ciVerificationGateStepV1);
    const descriptors = producerGates.map((gate, index) => {
      if (!compositionPlan) return Object.freeze({
        gate,
        env: {
          ...env,
          SEC_TEST_WORKSPACE_NAMESPACE: `verification-${gate.id.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`
        }
      });
      if (!compositionExecutionEnvironment) throw new Error('Composition verification execution environment was not initialized.');
      const source = compositionPlan.gates[index]!;
      const childEnvironment = CodexDevelopmentBuildSanitizedChildEnvironmentV1(
        compositionExecutionEnvironment,
        source.env,
        source.gateId
      );
      if (childEnvironment.binding.allowlistRevision !== source.envAllowlistRevision ||
          childEnvironment.binding.digest !== source.envDigest) {
        throw new Error(`Composition verification execution environment drifted for ${source.gateId}.`);
      }
      return Object.freeze({ gate, env: childEnvironment.environment });
    });
    actionPlan = buildCiVerificationActionPlanClosureV1({ candidate, gates: producerGates });
    if (formalBinding !== null && actionPlan.actionPlanDigest !== formalBinding.actionPlanDigest) {
      throw new Error('Formal hosted Action plan digest differs from the trusted dispatcher reconstruction.');
    }
    const actionExecution = await CodexDevelopmentExecuteCiActionClosureV1({
      repositoryRoot,
      actionPlan,
      gates: descriptors,
      headSha,
      now,
      runGate: async (descriptor) => {
        console.log(`::group::SEC verification: ${descriptor.id}`);
        try {
          return await runGate(descriptor);
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
    failure ??= { stage, tail: CodexDevelopmentFailureTailV1(message, 'CI verification failed.') };
    console.error(message);
  } finally {
    if (headSha !== null && treeSha !== null) {
      try {
        const finalHead = gitRevision('HEAD');
        const finalTree = gitRevision('HEAD^{tree}');
        if (finalHead !== headSha || finalTree !== treeSha) {
          exitCode = 1;
          failure ??= { stage: 'exact-identity', tail: 'CI verification exact head or tree changed during execution.' };
        }
      } catch (error) {
        exitCode = 1;
        failure ??= {
          stage: 'exact-identity',
          tail: CodexDevelopmentFailureTailV1(
            error instanceof Error ? error.stack ?? error.message : String(error),
            'Exact identity recheck failed.'
          )
        };
      }
    }
    try {
      cleanAfter = trackedTreeIsClean();
    } catch (error) {
      cleanAfter = null;
      exitCode = 1;
      failure = {
        stage: 'clean-state',
        tail: CodexDevelopmentFailureTailV1(
          error instanceof Error ? error.stack ?? error.message : String(error),
          'Clean-state probe failed.'
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
        tail: CodexDevelopmentFailureTailV1(
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
        producer: CodexDevelopmentCreateVerificationEvidenceProducerV4({
          sourceTransport: env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local-dev-runner',
          workflowPath: env.GITHUB_ACTIONS === 'true'
            ? '.github/workflows/compiler-pr-validation.yml'
            : 'platform/dev-runner.ts',
          workflowRef: env.GITHUB_ACTIONS === 'true'
            ? (env.SEC_TRUSTED_WORKFLOW_REF ?? '')
            : `platform/dev-runner.ts@${actionCandidate.baseSha}`,
          workflowSha: env.GITHUB_ACTIONS === 'true'
            ? (env.GITHUB_WORKFLOW_SHA ?? '')
            : actionCandidate.baseSha,
          runId: env.GITHUB_RUN_ID ?? 'local-run',
          runAttempt: Number(env.GITHUB_RUN_ATTEMPT ?? '1'),
          actorNodeId: env.SEC_WORKFLOW_ACTOR_NODE_ID ?? 'local-dev-runner'
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
      if (writeEvidenceV4) writeEvidenceV4(evidencePath, evidence);
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

export const CI_TCB_CLOSURE_LOCK_TARGET_V1 = 'platform/shared/tcb-closure-lock.ts' as const;
const CI_TCB_CLOSURE_ARCHIVE_ROOT_V1 = '.tmp/codex/tcb-closure-lock-v2' as const;
const TCB_CLOSURE_ARCHIVE_NAME_PATTERN_V1 = /^tcb-closure-lock-v3-([0-9a-f]{64})\.old\.ts$/u;
const TCB_CLOSURE_OPERATION_NAME_PATTERN_V1 = /^tcb-closure-lock-v3-([0-9a-f]{64})\.operation\.json$/u;

export type CodexDevelopmentTcbClosureLockModeV1 = 'check' | 'dry-run' | 'apply';

export interface CodexDevelopmentTcbClosureLockCommandResultV1 {
  readonly schema: 'sec-tcb-closure-lock-command-result-v1';
  readonly mode: CodexDevelopmentTcbClosureLockModeV1;
  readonly status: 'current' | 'update-required' | 'applied' | 'recovered';
  readonly target: typeof CI_TCB_CLOSURE_LOCK_TARGET_V1;
  readonly changed: boolean;
  readonly trustRevision: string;
  readonly closureDigest: string;
  readonly oldRawSourceDigest: string;
  readonly nextRawSourceDigest: string;
  readonly generatedAt: string;
  readonly archivePath: string | null;
  readonly archiveDigest: string | null;
}

interface TcbClosureRuntimeV1 {
  readonly generateTcbClosureLockV2: () => TcbClosureLock;
  readonly parseTcbClosureGeneratedRegionV2: (source: string) => TcbClosureGeneratedRegionV2;
  readonly planTcbClosureLockSourceV2: (input: Readonly<{
    source: string;
    nextLock: TcbClosureLock;
    generatedAt: string;
  }>) => TcbClosureLockSourcePlanV2;
}

async function loadTcbClosureRuntimeV1(targetSource: string | null): Promise<TcbClosureRuntimeV1> {
  if (targetSource === null) {
    throw new Error('TCB closure semantic runtime cannot load before the target exists.');
  }
  return await import('../platform/shared/tcb-closure-lock.ts');
}

function tcbClosureFsErrorCodeV1(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

class TcbClosureUnsupportedTransactionV1 extends Error {
  readonly code = 'TCB_CLOSURE_UNSUPPORTED_TRANSACTION';
}

class TcbClosureDestinationRaceV1 extends Error {
  readonly code = 'TCB_CLOSURE_DESTINATION_RACE';
}

type TcbClosureTransactionRacePointV1 =
  | 'before-authority-open'
  | 'before-current-entry-recheck'
  | 'before-destination-final-fence';

type TcbClosureTransactionRaceContextV1 = Readonly<{
  source: string;
  destination: string;
  expectedSource: string;
}>;

/* Module-private deterministic seam. Production has no CLI, environment or export that can mutate it. */
const tcbClosureTransactionRaceObserverV1: (
  (point: TcbClosureTransactionRacePointV1, context: TcbClosureTransactionRaceContextV1) => void
) | null = null;

function observeTcbClosureTransactionRaceV1(
  point: TcbClosureTransactionRacePointV1,
  context: TcbClosureTransactionRaceContextV1
): void {
  tcbClosureTransactionRaceObserverV1?.(point, context);
}

function tcbClosureLockTargetV1(): {
  readonly root: string;
  readonly parent: string;
  readonly target: string;
  readonly stage: string;
  readonly forbiddenLegacyResidue: string;
  readonly archiveRoot: string;
} {
  const root = realpathSync(compilerRoot);
  const target = path.join(root, ...CI_TCB_CLOSURE_LOCK_TARGET_V1.split('/'));
  const parent = path.dirname(target);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('TCB closure lock target parent must be one ordinary directory.');
  }
  return {
    root,
    parent,
    target,
    stage: path.join(parent, '.tcb-closure-lock.ts.sec-stage-v2'),
    forbiddenLegacyResidue: path.join(parent, '.tcb-closure-lock.ts.sec-old-v2'),
    archiveRoot: path.join(root, ...CI_TCB_CLOSURE_ARCHIVE_ROOT_V1.split('/'))
  };
}

function readTcbClosureOrdinaryFileV1(filePath: string, label: string): string | null {
  if (!existsSync(filePath)) return null;
  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be one ordinary file.`);
  }
  return readFileSync(filePath, 'utf8');
}

interface TcbClosureKernel32SymbolsV1 {
  readonly CreateFileW: (
    fileName: Buffer,
    desiredAccess: number,
    shareMode: number,
    securityAttributes: null,
    creationDisposition: number,
    flagsAndAttributes: number,
    templateFile: null
  ) => bigint;
  readonly FlushFileBuffers: (handle: bigint) => number;
  readonly CloseHandle: (handle: bigint) => number;
  readonly GetLastError: () => number;
  readonly GetFileInformationByHandleEx: (
    handle: bigint, informationClass: number, output: Buffer, outputBytes: number
  ) => number;
  readonly GetFinalPathNameByHandleW: (
    handle: bigint, output: Buffer, outputCharacters: number, flags: number
  ) => number;
  readonly GetFileSizeEx: (handle: bigint, output: Buffer) => number;
  readonly SetFilePointerEx: (handle: bigint, distance: bigint, output: null, method: number) => number;
  readonly ReadFile: (
    handle: bigint, output: Buffer, bytes: number, bytesRead: Buffer, overlapped: null
  ) => number;
  readonly CreateDirectoryW: (directoryName: Buffer, securityAttributes: null) => number;
  readonly SetFileInformationByHandle: (
    handle: bigint, informationClass: number, input: Buffer, inputBytes: number
  ) => number;
}

interface TcbClosureKernel32V1 {
  readonly symbols: TcbClosureKernel32SymbolsV1;
}

interface TcbClosureLibcSymbolsV1 {
  readonly open: (source: Buffer, flags: number, mode: number) => number;
  readonly openat: (directory: number, source: Buffer, flags: number, mode: number) => number;
  readonly mkdirat: (directory: number, name: Buffer, mode: number) => number;
  readonly renameat2: (
    sourceDirectory: number,
    source: Buffer,
    destinationDirectory: number,
    destination: Buffer,
    flags: number
  ) => number;
  readonly fsync: (descriptor: number) => number;
  readonly close: (descriptor: number) => number;
  readonly __errno_location: () => unknown;
}

interface TcbClosureLibcV1 {
  readonly symbols: TcbClosureLibcSymbolsV1;
  readonly errno: () => number;
}

interface TcbClosureNtdllSymbolsV1 {
  readonly NtSetInformationFile: (
    handle: bigint, ioStatusBlock: Buffer, input: Buffer, inputBytes: number, informationClass: number
  ) => number;
  readonly RtlNtStatusToDosError: (status: number) => number;
}

interface TcbClosureNtdllV1 {
  readonly symbols: TcbClosureNtdllSymbolsV1;
}

const TCB_CLOSURE_WINDOWS_INVALID_HANDLE_V1 = 0xffff_ffff_ffff_ffffn;
const TCB_CLOSURE_WINDOWS_DELETE_V1 = 0x0001_0000;
const TCB_CLOSURE_WINDOWS_GENERIC_READ_V1 = 0x8000_0000;
const TCB_CLOSURE_WINDOWS_GENERIC_WRITE_V1 = 0x4000_0000;
const TCB_CLOSURE_WINDOWS_FILE_LIST_DIRECTORY_V1 = 0x0000_0001;
const TCB_CLOSURE_WINDOWS_FILE_READ_ATTRIBUTES_V1 = 0x0000_0080;
const TCB_CLOSURE_WINDOWS_SYNCHRONIZE_V1 = 0x0010_0000;
const TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_V1 = 0x0000_0003;
const TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_DELETE_V1 = 0x0000_0007;
const TCB_CLOSURE_WINDOWS_OPEN_EXISTING_V1 = 3;
const TCB_CLOSURE_WINDOWS_BACKUP_SEMANTICS_V1 = 0x0200_0000;
const TCB_CLOSURE_WINDOWS_OPEN_REPARSE_POINT_V1 = 0x0020_0000;
const TCB_CLOSURE_WINDOWS_FILE_ATTRIBUTE_DIRECTORY_V1 = 0x0000_0010;
const TCB_CLOSURE_WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT_V1 = 0x0000_0400;
const TCB_CLOSURE_WINDOWS_FILE_ATTRIBUTE_TAG_INFO_V1 = 9;
const TCB_CLOSURE_WINDOWS_FILE_ID_INFO_V1 = 18;
const TCB_CLOSURE_WINDOWS_FILE_RENAME_INFO_V1 = 3;
const TCB_CLOSURE_WINDOWS_FILE_RENAME_INFORMATION_EX_V1 = 65;
const TCB_CLOSURE_WINDOWS_FILE_RENAME_INFO_SIZE_V1 = 24;
const TCB_CLOSURE_WINDOWS_FILE_RENAME_POSIX_SEMANTICS_V1 = 0x0000_0002;
const TCB_CLOSURE_WINDOWS_FILE_RENAME_IGNORE_READONLY_V1 = 0x0000_0040;
const TCB_CLOSURE_WINDOWS_FILE_BEGIN_V1 = 0;
const TCB_CLOSURE_WINDOWS_ERROR_FILE_NOT_FOUND_V1 = 2;
const TCB_CLOSURE_WINDOWS_ERROR_PATH_NOT_FOUND_V1 = 3;
const TCB_CLOSURE_WINDOWS_ERROR_INVALID_PARAMETER_V1 = 87;
const TCB_CLOSURE_WINDOWS_ERROR_FILE_EXISTS_V1 = 80;
const TCB_CLOSURE_WINDOWS_ERROR_ALREADY_EXISTS_V1 = 183;
const TCB_CLOSURE_LINUX_RENAME_NOREPLACE_V1 = 1;
const TCB_CLOSURE_LINUX_ERROR_NO_ENTRY_V1 = 2;
const TCB_CLOSURE_LINUX_ERROR_EXISTS_V1 = 17;
const TCB_CLOSURE_LINUX_ERROR_INVALID_ARGUMENT_V1 = 22;
const TCB_CLOSURE_LINUX_ERROR_FUNCTION_NOT_IMPLEMENTED_V1 = 38;
const TCB_CLOSURE_LINUX_ERROR_OPERATION_NOT_SUPPORTED_V1 = 95;
// Pinned Linux x64 UAPI: request close-on-exec atomically at open/openat creation.
// A follow-up fcntl(F_SETFD) would permit a concurrent fork+exec descriptor leak.
const TCB_CLOSURE_LINUX_X64_O_CLOEXEC_V1 = 0o2_000_000;

let tcbClosureKernel32PromiseV1: Promise<TcbClosureKernel32V1> | undefined;
let tcbClosureLibcPromiseV1: Promise<TcbClosureLibcV1> | undefined;
let tcbClosureNtdllPromiseV1: Promise<TcbClosureNtdllV1> | undefined;

async function loadTcbClosureKernel32V1(): Promise<TcbClosureKernel32V1> {
  tcbClosureKernel32PromiseV1 ??= (async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    return dlopen('kernel32.dll', {
      CreateFileW: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
        returns: FFIType.u64
      },
      FlushFileBuffers: { args: [FFIType.u64], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
      GetLastError: { args: [], returns: FFIType.u32 },
      GetFileInformationByHandleEx: {
        args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32
      },
      GetFinalPathNameByHandleW: {
        args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u32
      },
      GetFileSizeEx: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      SetFilePointerEx: { args: [FFIType.u64, FFIType.i64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      ReadFile: {
        args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32
      },
      CreateDirectoryW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      SetFileInformationByHandle: {
        args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32
      }
    } as const) as unknown as TcbClosureKernel32V1;
  })();
  return tcbClosureKernel32PromiseV1;
}

async function loadTcbClosureLibcV1(): Promise<TcbClosureLibcV1> {
  tcbClosureLibcPromiseV1 ??= (async () => {
    const { dlopen, FFIType, read } = await import('bun:ffi');
    const library = dlopen('libc.so.6', {
      open: { args: [FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      openat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      mkdirat: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      renameat2: {
        args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
        returns: FFIType.i32
      },
      fsync: { args: [FFIType.i32], returns: FFIType.i32 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
      __errno_location: { args: [], returns: FFIType.ptr }
    } as const) as unknown as { symbols: TcbClosureLibcSymbolsV1 };
    return Object.freeze({
      symbols: library.symbols,
      errno: () => read.i32(library.symbols.__errno_location() as never)
    });
  })();
  return tcbClosureLibcPromiseV1;
}

async function loadTcbClosureNtdllV1(): Promise<TcbClosureNtdllV1> {
  tcbClosureNtdllPromiseV1 ??= (async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    return dlopen('ntdll.dll', {
      NtSetInformationFile: {
        args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32
      },
      RtlNtStatusToDosError: { args: [FFIType.i32], returns: FFIType.u32 }
    } as const) as unknown as TcbClosureNtdllV1;
  })();
  return tcbClosureNtdllPromiseV1;
}

function tcbClosureWindowsWidePathV1(value: string): Buffer {
  return Buffer.from(`${path.toNamespacedPath(path.resolve(value))}\0`, 'utf16le');
}

function tcbClosureLinuxNameV1(value: string): Buffer {
  if (value.includes('\0') || value.includes('/')) throw new Error('TCB closure anchored entry name is invalid.');
  return Buffer.from(`${value}\0`, 'utf8');
}

function tcbClosureWindowsPathIdentityV1(value: string): string {
  return value.replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US');
}

function tcbClosureWindowsFinalPathV1(
  kernel32: TcbClosureKernel32V1,
  handle: bigint,
  label: string
): string {
  const output = Buffer.alloc(32_768 * 2);
  const length = kernel32.symbols.GetFinalPathNameByHandleW(handle, output, 32_768, 0);
  if (length === 0 || length >= 32_768) {
    throw new Error(`${label} final path read failed (${kernel32.symbols.GetLastError()}).`);
  }
  return output.subarray(0, length * 2).toString('utf16le');
}

function assertTcbClosureWindowsHandleV1(
  kernel32: TcbClosureKernel32V1,
  handle: bigint,
  expectedPath: string,
  label: string,
  kind: 'file' | 'directory'
): void {
  const attributes = Buffer.alloc(8);
  if (kernel32.symbols.GetFileInformationByHandleEx(
    handle,
    TCB_CLOSURE_WINDOWS_FILE_ATTRIBUTE_TAG_INFO_V1,
    attributes,
    attributes.byteLength
  ) === 0) throw new Error(`${label} attribute read failed (${kernel32.symbols.GetLastError()}).`);
  const mask = attributes.readUInt32LE(0);
  if ((mask & TCB_CLOSURE_WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT_V1) !== 0) {
    throw new Error(`${label} must be one ordinary non-reparse ${kind}.`);
  }
  const isDirectory = (mask & TCB_CLOSURE_WINDOWS_FILE_ATTRIBUTE_DIRECTORY_V1) !== 0;
  if (isDirectory !== (kind === 'directory')) throw new Error(`${label} must be one ordinary ${kind}.`);
  if (tcbClosureWindowsPathIdentityV1(tcbClosureWindowsFinalPathV1(kernel32, handle, label))
      !== tcbClosureWindowsPathIdentityV1(path.toNamespacedPath(path.resolve(expectedPath)))) {
    throw new Error(`${label} exact handle escaped its fixed-root path.`);
  }
}

function tcbClosureWindowsFileIdentityV1(
  kernel32: TcbClosureKernel32V1,
  handle: bigint,
  label: string
): Buffer {
  const identity = Buffer.alloc(24);
  if (kernel32.symbols.GetFileInformationByHandleEx(
    handle,
    TCB_CLOSURE_WINDOWS_FILE_ID_INFO_V1,
    identity,
    identity.byteLength
  ) === 0) throw new Error(`${label} FileId read failed (${kernel32.symbols.GetLastError()}).`);
  return identity;
}

function readTcbClosureWindowsHandleV1(
  kernel32: TcbClosureKernel32V1,
  handle: bigint,
  label: string
): string {
  if (kernel32.symbols.SetFilePointerEx(handle, 0n, null, TCB_CLOSURE_WINDOWS_FILE_BEGIN_V1) === 0) {
    throw new Error(`${label} seek failed (${kernel32.symbols.GetLastError()}).`);
  }
  const sizeBytes = Buffer.alloc(8);
  if (kernel32.symbols.GetFileSizeEx(handle, sizeBytes) === 0) {
    throw new Error(`${label} size read failed (${kernel32.symbols.GetLastError()}).`);
  }
  const size = sizeBytes.readBigUInt64LE(0);
  if (size > 16n * 1024n * 1024n) throw new Error(`${label} exceeds the bounded transaction file size.`);
  const bytes = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < bytes.byteLength) {
    const readCount = Buffer.alloc(4);
    const chunk = bytes.subarray(offset);
    if (kernel32.symbols.ReadFile(handle, chunk, chunk.byteLength, readCount, null) === 0) {
      throw new Error(`${label} read failed (${kernel32.symbols.GetLastError()}).`);
    }
    const count = readCount.readUInt32LE(0);
    if (count === 0) throw new Error(`${label} read made no progress.`);
    offset += count;
  }
  return bytes.toString('utf8');
}

function tcbClosureLinuxRenameFailureV1(errno: number, label: string): Error {
  if ([
    TCB_CLOSURE_LINUX_ERROR_FUNCTION_NOT_IMPLEMENTED_V1,
    TCB_CLOSURE_LINUX_ERROR_INVALID_ARGUMENT_V1,
    TCB_CLOSURE_LINUX_ERROR_OPERATION_NOT_SUPPORTED_V1
  ].includes(errno)) {
    return new TcbClosureUnsupportedTransactionV1(
      `${label} requires renameat2(RENAME_NOREPLACE), unsupported errno ${errno}.`
    );
  }
  if (errno === TCB_CLOSURE_LINUX_ERROR_EXISTS_V1) {
    return new TcbClosureDestinationRaceV1(
      `${label} destination final fence observed EEXIST; all bytes were preserved.`
    );
  }
  return new Error(`${label} anchored renameat2 failed (errno ${errno}); all observed bytes were preserved.`);
}

type TcbClosureTransactionParentV1 = 'target' | 'archive';

interface TcbClosureAnchoredTransactionV1 {
  readonly read: (
    parent: TcbClosureTransactionParentV1, name: string, label: string
  ) => string | null;
  readonly listArchive: () => readonly string[];
  readonly createExclusive: (
    parent: TcbClosureTransactionParentV1, name: string, source: string, label: string
  ) => void;
  readonly moveNoReplace: (
    sourceParent: TcbClosureTransactionParentV1,
    sourceName: string,
    destinationParent: TcbClosureTransactionParentV1,
    destinationName: string,
    expectedSource: string,
    label: string
  ) => void;
}

function tcbClosureWindowsDestinationFailureV1(errorCode: number, label: string): Error {
  if ([
    TCB_CLOSURE_WINDOWS_ERROR_FILE_EXISTS_V1,
    TCB_CLOSURE_WINDOWS_ERROR_ALREADY_EXISTS_V1
  ].includes(errorCode)) {
    return new TcbClosureDestinationRaceV1(
      `${label} destination final fence observed Win32 ${errorCode}; all bytes were preserved.`
    );
  }
  return new Error(`${label} handle-relative no-replace rename failed (Win32 ${errorCode}).`);
}

async function withTcbClosureWindowsTransactionV1<T>(
  paths: ReturnType<typeof tcbClosureLockTargetV1>,
  operation: (transaction: TcbClosureAnchoredTransactionV1) => Promise<T> | T
): Promise<T> {
  const kernel32 = await loadTcbClosureKernel32V1();
  const ntdll = await loadTcbClosureNtdllV1();
  const owned: Array<Readonly<{ handle: bigint; label: string }>> = [];
  const own = (handle: bigint, label: string): bigint => {
    owned.push(Object.freeze({ handle, label }));
    return handle;
  };
  const openDirectory = (directory: string, label: string): bigint => {
    const handle = kernel32.symbols.CreateFileW(
      tcbClosureWindowsWidePathV1(directory),
      (
        TCB_CLOSURE_WINDOWS_GENERIC_WRITE_V1 | TCB_CLOSURE_WINDOWS_FILE_LIST_DIRECTORY_V1
        | TCB_CLOSURE_WINDOWS_FILE_READ_ATTRIBUTES_V1 | TCB_CLOSURE_WINDOWS_SYNCHRONIZE_V1
      ) >>> 0,
      TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_V1,
      null,
      TCB_CLOSURE_WINDOWS_OPEN_EXISTING_V1,
      TCB_CLOSURE_WINDOWS_BACKUP_SEMANTICS_V1 | TCB_CLOSURE_WINDOWS_OPEN_REPARSE_POINT_V1,
      null
    );
    if (BigInt.asUintN(64, handle) === TCB_CLOSURE_WINDOWS_INVALID_HANDLE_V1) {
      throw new Error(`${label} open failed (${kernel32.symbols.GetLastError()}).`);
    }
    own(handle, label);
    assertTcbClosureWindowsHandleV1(kernel32, handle, directory, label, 'directory');
    return handle;
  };
  const directoryHandles = new Map<string, bigint>();
  const retainDirectoryPath = (directory: string, label: string, create: boolean): bigint => {
    const root = path.resolve(paths.root);
    const resolved = path.resolve(directory);
    const relative = path.relative(root, resolved);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${label} escapes the fixed TCB closure root.`);
    }
    let current = root;
    let handle = directoryHandles.get(current);
    if (handle === undefined) {
      handle = openDirectory(current, 'TCB closure fixed root');
      directoryHandles.set(current, handle);
    }
    for (const segment of relative === '' ? [] : relative.split(path.sep)) {
      const parentHandle = handle;
      current = path.join(current, segment);
      handle = directoryHandles.get(current);
      if (handle !== undefined) continue;
      try {
        handle = openDirectory(current, `${label} component ${segment}`);
      } catch (error) {
        if (!create || ![
          TCB_CLOSURE_WINDOWS_ERROR_FILE_NOT_FOUND_V1,
          TCB_CLOSURE_WINDOWS_ERROR_PATH_NOT_FOUND_V1
        ].some((code) => String(error).includes(`(${code})`))) throw error;
        if (kernel32.symbols.CreateDirectoryW(tcbClosureWindowsWidePathV1(current), null) === 0) {
          const errorCode = kernel32.symbols.GetLastError();
          if (errorCode !== TCB_CLOSURE_WINDOWS_ERROR_ALREADY_EXISTS_V1) {
            throw new Error(`${label} anchored directory create failed (${errorCode}).`);
          }
        } else if (kernel32.symbols.FlushFileBuffers(parentHandle) === 0) {
          throw new Error(`${label} created-parent FlushFileBuffers failed (${kernel32.symbols.GetLastError()}).`);
        }
        handle = openDirectory(current, `${label} created component ${segment}`);
      }
      directoryHandles.set(current, handle);
    }
    return handle;
  };
  let result: T | undefined;
  let failure: unknown;
  try {
    const targetParentHandle = retainDirectoryPath(paths.parent, 'TCB closure target ancestry', false);
    const archiveParentHandle = retainDirectoryPath(paths.archiveRoot, 'TCB closure archive ancestry', true);
    const targetVolume = tcbClosureWindowsFileIdentityV1(
      kernel32, targetParentHandle, 'TCB closure target parent'
    ).subarray(0, 8);
    const archiveVolume = tcbClosureWindowsFileIdentityV1(
      kernel32, archiveParentHandle, 'TCB closure archive parent'
    ).subarray(0, 8);
    if (!targetVolume.equals(archiveVolume)) {
      throw new Error('TCB closure archive root must be on the same retained volume as the target parent.');
    }
    const parentHandle = (parent: TcbClosureTransactionParentV1): bigint =>
      parent === 'target' ? targetParentHandle : archiveParentHandle;
    const parentPath = (parent: TcbClosureTransactionParentV1): string =>
      parent === 'target' ? paths.parent : paths.archiveRoot;
    const openFile = (
      parent: TcbClosureTransactionParentV1,
      name: string,
      label: string,
      desiredAccess: number,
      shareMode = TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_DELETE_V1
    ): bigint | null => {
      const filePath = path.join(parentPath(parent), name);
      const handle = kernel32.symbols.CreateFileW(
        tcbClosureWindowsWidePathV1(filePath),
        desiredAccess >>> 0,
        shareMode,
        null,
        TCB_CLOSURE_WINDOWS_OPEN_EXISTING_V1,
        TCB_CLOSURE_WINDOWS_OPEN_REPARSE_POINT_V1,
        null
      );
      if (BigInt.asUintN(64, handle) === TCB_CLOSURE_WINDOWS_INVALID_HANDLE_V1) {
        const errorCode = kernel32.symbols.GetLastError();
        if ([
          TCB_CLOSURE_WINDOWS_ERROR_FILE_NOT_FOUND_V1,
          TCB_CLOSURE_WINDOWS_ERROR_PATH_NOT_FOUND_V1
        ].includes(errorCode)) return null;
        throw new Error(`${label} open failed (${errorCode}).`);
      }
      own(handle, label);
      assertTcbClosureWindowsHandleV1(kernel32, handle, filePath, label, 'file');
      return handle;
    };
    const read = (
      parent: TcbClosureTransactionParentV1,
      name: string,
      label: string
    ): string | null => {
      const handle = openFile(
        parent,
        name,
        label,
        TCB_CLOSURE_WINDOWS_GENERIC_READ_V1 | TCB_CLOSURE_WINDOWS_FILE_READ_ATTRIBUTES_V1
      );
      return handle === null ? null : readTcbClosureWindowsHandleV1(kernel32, handle, label);
    };
    const flush = (handle: bigint, label: string): void => {
      if (kernel32.symbols.FlushFileBuffers(handle) === 0) {
        throw new Error(`${label} FlushFileBuffers failed (${kernel32.symbols.GetLastError()}).`);
      }
    };
    result = await operation(Object.freeze({
      read,
      listArchive: () => Object.freeze(readdirSync(paths.archiveRoot).sort()),
      createExclusive(
        parent: TcbClosureTransactionParentV1,
        name: string,
        source: string,
        label: string
      ) {
        const filePath = path.join(parentPath(parent), name);
        const bytes = Buffer.from(source, 'utf8');
        let descriptor: number;
        try {
          descriptor = openSync(filePath, 'wx', 0o600);
        } catch (error) {
          if (tcbClosureFsErrorCodeV1(error) === 'EEXIST') {
            throw new TcbClosureDestinationRaceV1(`${label} exclusive destination already exists.`);
          }
          throw error;
        }
        try {
          let offset = 0;
          while (offset < bytes.byteLength) {
            const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
            if (written <= 0) throw new Error(`${label} write made no progress.`);
            offset += written;
          }
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        if (read(parent, name, `${label} canonical readback`) !== source) {
          throw new Error(`${label} canonical readback mismatch.`);
        }
        flush(parentHandle(parent), `${label} retained parent`);
      },
      moveNoReplace(
        sourceParent: TcbClosureTransactionParentV1,
        sourceName: string,
        destinationParent: TcbClosureTransactionParentV1,
        destinationName: string,
        expectedSource: string,
        label: string
      ) {
        const sourcePath = path.join(parentPath(sourceParent), sourceName);
        const destinationPath = path.join(parentPath(destinationParent), destinationName);
        const retainedSource = openFile(
          sourceParent,
          sourceName,
          `${label} retained source`,
          TCB_CLOSURE_WINDOWS_GENERIC_READ_V1 | TCB_CLOSURE_WINDOWS_GENERIC_WRITE_V1
            | TCB_CLOSURE_WINDOWS_DELETE_V1 | TCB_CLOSURE_WINDOWS_FILE_READ_ATTRIBUTES_V1
            | TCB_CLOSURE_WINDOWS_SYNCHRONIZE_V1,
          TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_DELETE_V1
        );
        if (retainedSource === null) throw new Error(`${label} source is missing.`);
        const retainedIdentity = tcbClosureWindowsFileIdentityV1(kernel32, retainedSource, `${label} source`);
        if (readTcbClosureWindowsHandleV1(kernel32, retainedSource, `${label} retained source`) !== expectedSource) {
          throw new Error(`${label} retained source bytes changed before transition.`);
        }
        flush(retainedSource, `${label} retained source`);
        flush(parentHandle(sourceParent), `${label} retained source parent`);
        if (destinationParent !== sourceParent) {
          flush(parentHandle(destinationParent), `${label} retained destination parent`);
        }
        const raceContext = Object.freeze({ source: sourcePath, destination: destinationPath, expectedSource });
        observeTcbClosureTransactionRaceV1('before-current-entry-recheck', raceContext);
        observeTcbClosureTransactionRaceV1('before-destination-final-fence', raceContext);
        const currentSource = openFile(
          sourceParent,
          sourceName,
          `${label} current source entry`,
          TCB_CLOSURE_WINDOWS_GENERIC_READ_V1 | TCB_CLOSURE_WINDOWS_FILE_READ_ATTRIBUTES_V1,
          TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_DELETE_V1
        );
        if (currentSource === null) throw new Error(`${label} current source entry is missing.`);
        if (!retainedIdentity.equals(tcbClosureWindowsFileIdentityV1(
          kernel32, currentSource, `${label} current source entry`
        ))) throw new Error(`${label} current source entry has a retained FileId/volume identity mismatch.`);
        if (readTcbClosureWindowsHandleV1(kernel32, currentSource, `${label} current source entry`)
            !== expectedSource) throw new Error(`${label} current source entry bytes changed at the final fence.`);
        if (read(destinationParent, destinationName, `${label} destination final fence`) !== null) {
          throw new TcbClosureDestinationRaceV1(`${label} destination final fence is occupied.`);
        }
        const targetName = Buffer.from(destinationName, 'utf16le');
        const renameInfo = Buffer.alloc(TCB_CLOSURE_WINDOWS_FILE_RENAME_INFO_SIZE_V1 + targetName.byteLength);
        renameInfo.writeUInt8(0, 0);
        renameInfo.writeBigUInt64LE(parentHandle(destinationParent), 8);
        renameInfo.writeUInt32LE(targetName.byteLength, 16);
        renameInfo.set(targetName, 20);
        if (kernel32.symbols.SetFileInformationByHandle(
          retainedSource,
          TCB_CLOSURE_WINDOWS_FILE_RENAME_INFO_V1,
          renameInfo,
          renameInfo.byteLength
        ) === 0) {
          const win32Error = kernel32.symbols.GetLastError();
          if (win32Error !== TCB_CLOSURE_WINDOWS_ERROR_INVALID_PARAMETER_V1) {
            throw tcbClosureWindowsDestinationFailureV1(win32Error, label);
          }
          renameInfo.writeUInt32LE(
            TCB_CLOSURE_WINDOWS_FILE_RENAME_POSIX_SEMANTICS_V1
              | TCB_CLOSURE_WINDOWS_FILE_RENAME_IGNORE_READONLY_V1,
            0
          );
          const ioStatusBlock = Buffer.alloc(16);
          const status = ntdll.symbols.NtSetInformationFile(
            retainedSource,
            ioStatusBlock,
            renameInfo,
            renameInfo.byteLength,
            TCB_CLOSURE_WINDOWS_FILE_RENAME_INFORMATION_EX_V1
          );
          if (status !== 0) {
            const nativeError = ntdll.symbols.RtlNtStatusToDosError(status);
            if (nativeError === TCB_CLOSURE_WINDOWS_ERROR_INVALID_PARAMETER_V1) {
              throw new TcbClosureUnsupportedTransactionV1(
                `${label} Windows handle-relative no-replace rename is unsupported.`
              );
            }
            throw tcbClosureWindowsDestinationFailureV1(nativeError, label);
          }
        }
        flush(retainedSource, `${label} retained moved file`);
        flush(parentHandle(sourceParent), `${label} retained source parent`);
        if (destinationParent !== sourceParent) {
          flush(parentHandle(destinationParent), `${label} retained destination parent`);
        }
        if (read(sourceParent, sourceName, `${label} moved source`) !== null) {
          throw new Error(`${label} source remained after the no-replace transition.`);
        }
        const destination = openFile(
          destinationParent,
          destinationName,
          `${label} moved destination`,
          TCB_CLOSURE_WINDOWS_GENERIC_READ_V1 | TCB_CLOSURE_WINDOWS_FILE_READ_ATTRIBUTES_V1
        );
        if (destination === null
            || !retainedIdentity.equals(tcbClosureWindowsFileIdentityV1(kernel32, destination, label))
            || readTcbClosureWindowsHandleV1(kernel32, destination, label) !== expectedSource) {
          throw new Error(`${label} retained destination identity/bytes readback mismatch.`);
        }
      }
    }));
  } catch (error) {
    failure = error;
  }
  const closeFailures: Error[] = [];
  for (const entry of owned.reverse()) {
    if (kernel32.symbols.CloseHandle(entry.handle) === 0) {
      closeFailures.push(new Error(
        `${entry.label} checked CloseHandle failed (${kernel32.symbols.GetLastError()}).`
      ));
    }
  }
  if (failure !== undefined) {
    if (closeFailures.length > 0) {
      throw new AggregateError([failure, ...closeFailures], 'TCB closure Windows transaction and close failed.');
    }
    throw failure;
  }
  if (closeFailures.length > 0) throw new AggregateError(closeFailures, 'TCB closure Windows close failed.');
  return result!;
}

async function withTcbClosureLinuxTransactionV1<T>(
  paths: ReturnType<typeof tcbClosureLockTargetV1>,
  operation: (transaction: TcbClosureAnchoredTransactionV1) => Promise<T> | T
): Promise<T> {
  const libc = await loadTcbClosureLibcV1();
  if (process.arch !== 'x64') {
    throw new TcbClosureUnsupportedTransactionV1(
      `TCB closure Linux transaction is unsupported on ${process.arch}; expected pinned x64.`
    );
  }
  const closeOnExec = TCB_CLOSURE_LINUX_X64_O_CLOEXEC_V1;
  const directoryFlags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | closeOnExec;
  const owned: Array<Readonly<{ descriptor: number; label: string }>> = [];
  const own = (descriptor: number, label: string): number => {
    owned.push(Object.freeze({ descriptor, label }));
    return descriptor;
  };
  const openAbsoluteRoot = (): number => {
    const descriptor = libc.symbols.open(
      Buffer.from(`${path.resolve(paths.root)}\0`, 'utf8'),
      directoryFlags,
      0
    );
    if (descriptor === -1) throw new Error(`TCB closure fixed root open failed (errno ${libc.errno()}).`);
    own(descriptor, 'TCB closure fixed root');
    if (!statSync(`/proc/self/fd/${descriptor}`).isDirectory()) {
      throw new Error('TCB closure fixed root must be one ordinary directory.');
    }
    return descriptor;
  };
  let rootDescriptor: number | undefined;
  const retainDirectory = (directory: string, label: string, create: boolean): number => {
    if (rootDescriptor === undefined) {
      throw new Error('TCB closure fixed root authority is unavailable.');
    }
    const relative = path.relative(paths.root, path.resolve(directory));
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${label} escapes the fixed TCB closure root.`);
    }
    let current = rootDescriptor;
    for (const segment of relative === '' ? [] : relative.split(path.sep)) {
      let next = libc.symbols.openat(current, tcbClosureLinuxNameV1(segment), directoryFlags, 0);
      if (next === -1) {
        const errno = libc.errno();
        if (!create || errno !== TCB_CLOSURE_LINUX_ERROR_NO_ENTRY_V1) {
          throw new Error(`${label} openat failed (errno ${errno}).`);
        }
        if (libc.symbols.mkdirat(current, tcbClosureLinuxNameV1(segment), 0o700) !== 0) {
          const mkdirErrno = libc.errno();
          if (mkdirErrno !== TCB_CLOSURE_LINUX_ERROR_EXISTS_V1) {
            throw new Error(`${label} mkdirat failed (errno ${mkdirErrno}).`);
          }
        } else if (libc.symbols.fsync(current) !== 0) {
          throw new Error(`${label} created-parent fsync failed (errno ${libc.errno()}).`);
        }
        next = libc.symbols.openat(current, tcbClosureLinuxNameV1(segment), directoryFlags, 0);
        if (next === -1) throw new Error(`${label} created openat failed (errno ${libc.errno()}).`);
      }
      own(next, `${label} component ${segment}`);
      if (!statSync(`/proc/self/fd/${next}`).isDirectory()) {
        throw new Error(`${label} component ${segment} must be one ordinary directory.`);
      }
      current = next;
    }
    return current;
  };
  let result: T | undefined;
  let failure: unknown;
  try {
    rootDescriptor = openAbsoluteRoot();
    const targetParentDescriptor = retainDirectory(paths.parent, 'TCB closure target ancestry', false);
    const archiveParentDescriptor = retainDirectory(paths.archiveRoot, 'TCB closure archive ancestry', true);
    const targetParentStat = statSync(`/proc/self/fd/${targetParentDescriptor}`);
    const archiveParentStat = statSync(`/proc/self/fd/${archiveParentDescriptor}`);
    if (targetParentStat.dev !== archiveParentStat.dev) {
      throw new Error('TCB closure archive root must be on the same retained device as the target parent.');
    }
    const parentDescriptor = (parent: TcbClosureTransactionParentV1): number =>
      parent === 'target' ? targetParentDescriptor : archiveParentDescriptor;
    const parentPath = (parent: TcbClosureTransactionParentV1): string =>
      parent === 'target' ? paths.parent : paths.archiveRoot;
    const openFile = (
      parent: TcbClosureTransactionParentV1,
      name: string,
      label: string,
      flags: number
    ): number | null => {
      const descriptor = libc.symbols.openat(
        parentDescriptor(parent),
        tcbClosureLinuxNameV1(name),
        flags | fsConstants.O_NOFOLLOW | closeOnExec,
        0
      );
      if (descriptor === -1) {
        const errno = libc.errno();
        if (errno === TCB_CLOSURE_LINUX_ERROR_NO_ENTRY_V1) return null;
        throw new Error(`${label} openat failed (errno ${errno}).`);
      }
      own(descriptor, label);
      if (!statSync(`/proc/self/fd/${descriptor}`).isFile()) {
        throw new Error(`${label} must be one ordinary non-symlink file.`);
      }
      return descriptor;
    };
    const read = (
      parent: TcbClosureTransactionParentV1,
      name: string,
      label: string
    ): string | null => {
      const descriptor = openFile(parent, name, label, fsConstants.O_RDONLY);
      return descriptor === null ? null : readFileSync(`/proc/self/fd/${descriptor}`, 'utf8');
    };
    const flush = (descriptor: number, label: string): void => {
      if (libc.symbols.fsync(descriptor) !== 0) {
        throw new Error(`${label} retained fsync failed (errno ${libc.errno()}).`);
      }
    };
    result = await operation(Object.freeze({
      read,
      listArchive: () => Object.freeze(readdirSync(`/proc/self/fd/${archiveParentDescriptor}`).sort()),
      createExclusive(
        parent: TcbClosureTransactionParentV1,
        name: string,
        source: string,
        label: string
      ) {
        const descriptor = libc.symbols.openat(
          parentDescriptor(parent),
          tcbClosureLinuxNameV1(name),
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | closeOnExec,
          0o600
        );
        if (descriptor === -1) {
          const errno = libc.errno();
          if (errno === TCB_CLOSURE_LINUX_ERROR_EXISTS_V1) {
            throw new TcbClosureDestinationRaceV1(`${label} exclusive destination already exists.`);
          }
          throw new Error(`${label} exclusive openat failed (errno ${errno}).`);
        }
        own(descriptor, label);
        const bytes = Buffer.from(source, 'utf8');
        let offset = 0;
        while (offset < bytes.byteLength) {
          const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
          if (written <= 0) throw new Error(`${label} write made no progress.`);
          offset += written;
        }
        flush(descriptor, label);
        if (readFileSync(`/proc/self/fd/${descriptor}`, 'utf8') !== source) {
          throw new Error(`${label} canonical readback mismatch.`);
        }
        flush(parentDescriptor(parent), `${label} retained parent`);
      },
      moveNoReplace(
        sourceParent: TcbClosureTransactionParentV1,
        sourceName: string,
        destinationParent: TcbClosureTransactionParentV1,
        destinationName: string,
        expectedSource: string,
        label: string
      ) {
        const retainedSource = openFile(sourceParent, sourceName, `${label} retained source`, fsConstants.O_RDWR);
        if (retainedSource === null) throw new Error(`${label} source is missing.`);
        const retainedStat = statSync(`/proc/self/fd/${retainedSource}`);
        if (readFileSync(`/proc/self/fd/${retainedSource}`, 'utf8') !== expectedSource) {
          throw new Error(`${label} retained source bytes changed before transition.`);
        }
        flush(retainedSource, `${label} retained source`);
        flush(parentDescriptor(sourceParent), `${label} retained source parent`);
        if (destinationParent !== sourceParent) {
          flush(parentDescriptor(destinationParent), `${label} retained destination parent`);
        }
        const raceContext = Object.freeze({
          source: path.join(parentPath(sourceParent), sourceName),
          destination: path.join(parentPath(destinationParent), destinationName),
          expectedSource
        });
        observeTcbClosureTransactionRaceV1('before-current-entry-recheck', raceContext);
        observeTcbClosureTransactionRaceV1('before-destination-final-fence', raceContext);
        const currentSource = openFile(
          sourceParent,
          sourceName,
          `${label} current source entry`,
          fsConstants.O_RDONLY
        );
        if (currentSource === null) throw new Error(`${label} current source entry is missing.`);
        const currentStat = statSync(`/proc/self/fd/${currentSource}`);
        if (retainedStat.dev !== currentStat.dev || retainedStat.ino !== currentStat.ino) {
          throw new Error(`${label} current source entry has a retained dev:ino identity mismatch.`);
        }
        if (readFileSync(`/proc/self/fd/${currentSource}`, 'utf8') !== expectedSource) {
          throw new Error(`${label} current source entry bytes changed at the final fence.`);
        }
        if (read(destinationParent, destinationName, `${label} destination final fence`) !== null) {
          throw new TcbClosureDestinationRaceV1(`${label} destination final fence is occupied.`);
        }
        if (libc.symbols.renameat2(
          parentDescriptor(sourceParent),
          tcbClosureLinuxNameV1(sourceName),
          parentDescriptor(destinationParent),
          tcbClosureLinuxNameV1(destinationName),
          TCB_CLOSURE_LINUX_RENAME_NOREPLACE_V1
        ) !== 0) throw tcbClosureLinuxRenameFailureV1(libc.errno(), label);
        flush(retainedSource, `${label} retained moved file`);
        flush(parentDescriptor(sourceParent), `${label} retained source parent`);
        if (destinationParent !== sourceParent) {
          flush(parentDescriptor(destinationParent), `${label} retained destination parent`);
        }
        if (read(sourceParent, sourceName, `${label} moved source`) !== null) {
          throw new Error(`${label} source remained after the no-replace transition.`);
        }
        const destination = openFile(
          destinationParent, destinationName, `${label} moved destination`, fsConstants.O_RDONLY
        );
        if (destination === null) throw new Error(`${label} moved destination is missing.`);
        const destinationStat = statSync(`/proc/self/fd/${destination}`);
        if (retainedStat.dev !== destinationStat.dev || retainedStat.ino !== destinationStat.ino
            || readFileSync(`/proc/self/fd/${destination}`, 'utf8') !== expectedSource) {
          throw new Error(`${label} retained destination identity/bytes readback mismatch.`);
        }
      }
    }));
  } catch (error) {
    failure = error;
  }
  const closeFailures: Error[] = [];
  for (const entry of owned.reverse()) {
    if (libc.symbols.close(entry.descriptor) !== 0) {
      closeFailures.push(new Error(`${entry.label} checked close failed (errno ${libc.errno()}).`));
    }
  }
  if (failure !== undefined) {
    if (closeFailures.length > 0) {
      throw new AggregateError([failure, ...closeFailures], 'TCB closure Linux transaction and close failed.');
    }
    throw failure;
  }
  if (closeFailures.length > 0) throw new AggregateError(closeFailures, 'TCB closure Linux close failed.');
  return result!;
}

async function withTcbClosureAnchoredTransactionV1<T>(
  paths: ReturnType<typeof tcbClosureLockTargetV1>,
  operation: (transaction: TcbClosureAnchoredTransactionV1) => Promise<T> | T
): Promise<T> {
  observeTcbClosureTransactionRaceV1('before-authority-open', Object.freeze({
    source: paths.parent,
    destination: paths.archiveRoot,
    expectedSource: ''
  }));
  if (process.platform === 'win32') return withTcbClosureWindowsTransactionV1(paths, operation);
  if (process.platform === 'linux') return withTcbClosureLinuxTransactionV1(paths, operation);
  throw new TcbClosureUnsupportedTransactionV1(
    `TCB closure anchored transaction is unsupported on ${process.platform}.`
  );
}

interface TcbClosureOperationRecordV1 {
  readonly schema: 'sec-tcb-closure-lock-archive-operation-v3';
  readonly target: typeof CI_TCB_CLOSURE_LOCK_TARGET_V1;
  readonly oldDigest: string;
  readonly nextDigest: string;
  readonly generatedAt: string;
  readonly operationKey: string;
}

interface TcbClosureArchiveOperationV1 {
  readonly operationKey: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly archiveName: string;
  readonly recordName: string;
  readonly recordRelativePath: string;
  readonly recordAbsolutePath: string;
  readonly recordSource: string;
  readonly oldRawSourceDigest: string;
  readonly nextRawSourceDigest: string;
  readonly generatedAt: string;
  readonly oldSource: string;
}

interface TcbClosureArchiveRecordV1 extends TcbClosureArchiveOperationV1 {
  readonly archivePresent: boolean;
}

interface TcbClosureArchiveCensusV1 {
  readonly records: readonly TcbClosureArchiveRecordV1[];
  readonly latest: TcbClosureArchiveRecordV1 | null;
}

interface TcbClosureArchiveRawDataV1 extends TcbClosureArchiveCensusV1 {
  readonly sourcesByDigest: ReadonlyMap<string, Readonly<{ source: string; label: string }>>;
  readonly targetSource: string | null;
  readonly stageSource: string | null;
}

function tcbClosureRawSourceDigestV1(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

function tcbClosureOperationKeyV1(
  record: Omit<TcbClosureOperationRecordV1, 'operationKey'>
): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

function encodeTcbClosureOperationRecordV1(record: TcbClosureOperationRecordV1): string {
  return `${JSON.stringify(record)}\n`;
}

function parseTcbClosureOperationRecordV1(source: string, label: string): TcbClosureOperationRecordV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not canonical JSON.`, { cause: error });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be one canonical operation record.`);
  }
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value);
  if (JSON.stringify(keys) !== JSON.stringify([
    'schema', 'target', 'oldDigest', 'nextDigest', 'generatedAt', 'operationKey'
  ])) throw new Error(`${label} has a non-canonical or open-world field set.`);
  if (
    value.schema !== 'sec-tcb-closure-lock-archive-operation-v3'
    || value.target !== CI_TCB_CLOSURE_LOCK_TARGET_V1
    || typeof value.oldDigest !== 'string'
    || typeof value.nextDigest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(value.oldDigest)
    || !/^sha256:[0-9a-f]{64}$/u.test(value.nextDigest)
    || typeof value.generatedAt !== 'string'
    || typeof value.operationKey !== 'string'
    || !/^[0-9a-f]{64}$/u.test(value.operationKey)
  ) throw new Error(`${label} has an invalid operation tuple.`);
  const record = Object.freeze({
    schema: value.schema,
    target: value.target,
    oldDigest: value.oldDigest,
    nextDigest: value.nextDigest,
    generatedAt: value.generatedAt,
    operationKey: value.operationKey
  }) as TcbClosureOperationRecordV1;
  if (!Number.isFinite(Date.parse(record.generatedAt))
      || new Date(record.generatedAt).toISOString() !== record.generatedAt) {
    throw new Error(`${label} generatedAt must be canonical ISO-8601 UTC.`);
  }
  if (tcbClosureOperationKeyV1({
    schema: record.schema,
    target: record.target,
    oldDigest: record.oldDigest,
    nextDigest: record.nextDigest,
    generatedAt: record.generatedAt
  }) !== record.operationKey) throw new Error(`${label} operationKey does not bind its exact tuple.`);
  if (encodeTcbClosureOperationRecordV1(record) !== source) {
    throw new Error(`${label} bytes are not canonical.`);
  }
  return record;
}

function tcbClosureArchiveOperationV1(
  paths: ReturnType<typeof tcbClosureLockTargetV1>,
  plan: TcbClosureLockSourcePlanV2,
  oldSource: string
): TcbClosureArchiveOperationV1 {
  if (plan.status !== 'update-required') {
    throw new Error('TCB closure archive operation requires one exact source update.');
  }
  const tuple = Object.freeze({
    schema: 'sec-tcb-closure-lock-archive-operation-v3' as const,
    target: CI_TCB_CLOSURE_LOCK_TARGET_V1,
    oldDigest: plan.oldRawSourceDigest,
    nextDigest: plan.nextRawSourceDigest,
    generatedAt: plan.nextGeneratedAt
  });
  const operationKey = tcbClosureOperationKeyV1(tuple);
  const archiveName = `tcb-closure-lock-v3-${operationKey}.old.ts`;
  const recordName = `tcb-closure-lock-v3-${operationKey}.operation.json`;
  const record = Object.freeze({ ...tuple, operationKey });
  if (tcbClosureRawSourceDigestV1(oldSource) !== plan.oldRawSourceDigest) {
    throw new Error('TCB closure archive old source does not match the planned operation.');
  }
  return Object.freeze({
    operationKey,
    relativePath: `${CI_TCB_CLOSURE_ARCHIVE_ROOT_V1}/${archiveName}`,
    absolutePath: path.join(paths.archiveRoot, archiveName),
    archiveName,
    recordName,
    recordRelativePath: `${CI_TCB_CLOSURE_ARCHIVE_ROOT_V1}/${recordName}`,
    recordAbsolutePath: path.join(paths.archiveRoot, recordName),
    recordSource: encodeTcbClosureOperationRecordV1(record),
    oldRawSourceDigest: plan.oldRawSourceDigest,
    nextRawSourceDigest: plan.nextRawSourceDigest,
    generatedAt: plan.nextGeneratedAt,
    oldSource
  });
}

function tcbClosurePathIdentityV1(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function assertTcbClosureOrdinaryDirectoryV1(directory: string, label: string): void {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be one ordinary non-reparse directory.`);
  }
  if (tcbClosurePathIdentityV1(realpathSync(directory)) !== tcbClosurePathIdentityV1(directory)) {
    throw new Error(`${label} must not traverse a reparse or redirected path.`);
  }
}

function inspectTcbClosureArchiveRootV1(
  paths: ReturnType<typeof tcbClosureLockTargetV1>
): boolean {
  let current = paths.root;
  for (const segment of CI_TCB_CLOSURE_ARCHIVE_ROOT_V1.split('/')) {
    current = path.join(current, segment);
    if (!existsSync(current)) return false;
    assertTcbClosureOrdinaryDirectoryV1(current, `TCB closure archive directory ${segment}`);
  }
  const targetParent = lstatSync(paths.parent);
  const archiveParent = lstatSync(paths.archiveRoot);
  if (targetParent.dev !== archiveParent.dev) {
    throw new Error('TCB closure archive root must be on the same device as the target parent.');
  }
  if (
    tcbClosurePathIdentityV1(path.parse(realpathSync(paths.parent)).root)
    !== tcbClosurePathIdentityV1(path.parse(realpathSync(paths.archiveRoot)).root)
  ) {
    throw new Error('TCB closure archive root must be on the same volume as the target parent.');
  }
  return true;
}

function readTcbClosureArchiveRawDataV1(
  paths: ReturnType<typeof tcbClosureLockTargetV1>,
  targetSource: string | null,
  stageSource: string | null,
  transaction?: TcbClosureAnchoredTransactionV1
): TcbClosureArchiveRawDataV1 {
  const readTargetEntry = (name: string, label: string): string | null => transaction === undefined
    ? readTcbClosureOrdinaryFileV1(path.join(paths.parent, name), label)
    : transaction.read('target', name, label);
  const readArchiveEntry = (name: string, label: string): string | null => transaction === undefined
    ? readTcbClosureOrdinaryFileV1(path.join(paths.archiveRoot, name), label)
    : transaction.read('archive', name, label);
  if (readTargetEntry(path.basename(paths.forbiddenLegacyResidue), 'TCB closure forbidden legacy residue') !== null) {
    throw new Error('TCB closure archive census found forbidden legacy backup residue.');
  }
  if (transaction === undefined && !inspectTcbClosureArchiveRootV1(paths)) {
    if (targetSource === null && stageSource !== null) {
      throw new Error('TCB closure target is absent without an exact retained archive.');
    }
    return Object.freeze({
      records: Object.freeze([]),
      latest: null,
      sourcesByDigest: new Map(),
      targetSource,
      stageSource
    });
  }
  const names = transaction === undefined
    ? readdirSync(paths.archiveRoot).sort((left, right) => left.localeCompare(right, 'en-US'))
    : [...transaction.listArchive()].sort((left, right) => left.localeCompare(right, 'en-US'));
  const operationSources = new Map<string, Readonly<{ name: string; source: string }>>();
  const archiveSources = new Map<string, Readonly<{ name: string; source: string }>>();
  for (const name of names) {
    const operationMatch = TCB_CLOSURE_OPERATION_NAME_PATTERN_V1.exec(name);
    const archiveMatch = TCB_CLOSURE_ARCHIVE_NAME_PATTERN_V1.exec(name);
    if ((operationMatch === null) === (archiveMatch === null)) {
      throw new Error(`TCB closure archive census found an unknown closed-world entry: ${name}.`);
    }
    const source = readArchiveEntry(name, `TCB closure archive entry ${name}`);
    if (source === null) throw new Error(`TCB closure archive entry disappeared during census: ${name}.`);
    const operationKey = (operationMatch ?? archiveMatch)![1]!;
    const owner = operationMatch === null ? archiveSources : operationSources;
    if (owner.has(operationKey)) throw new Error(`TCB closure archive census found duplicate operation ${operationKey}.`);
    owner.set(operationKey, Object.freeze({ name, source }));
  }
  const rawRecords = [...operationSources.entries()].map(([operationKey, operationEntry]) => {
    const operation = parseTcbClosureOperationRecordV1(
      operationEntry.source,
      `TCB closure operation record ${operationEntry.name}`
    );
    if (operation.operationKey !== operationKey) {
      throw new Error(`TCB closure operation filename does not match record ${operationKey}.`);
    }
    const archiveEntry = archiveSources.get(operationKey) ?? null;
    const oldSource = archiveEntry?.source
      ?? (targetSource !== null && tcbClosureRawSourceDigestV1(targetSource) === operation.oldDigest
        ? targetSource
        : null);
    if (oldSource === null) {
      throw new Error(`TCB closure operation ${operationKey} has neither its exact archive nor PREPARED target.`);
    }
    if (archiveEntry !== null && archiveEntry.name !== `tcb-closure-lock-v3-${operationKey}.old.ts`) {
      throw new Error(`TCB closure archive filename does not match operation ${operationKey}.`);
    }
    if (tcbClosureRawSourceDigestV1(oldSource) !== operation.oldDigest) {
      throw new Error(`TCB closure archive ${operationKey} oldDigest mismatch.`);
    }
    return Object.freeze({
      operationKey,
      relativePath: `${CI_TCB_CLOSURE_ARCHIVE_ROOT_V1}/tcb-closure-lock-v3-${operationKey}.old.ts`,
      absolutePath: path.join(paths.archiveRoot, `tcb-closure-lock-v3-${operationKey}.old.ts`),
      archiveName: `tcb-closure-lock-v3-${operationKey}.old.ts`,
      recordName: operationEntry.name,
      recordRelativePath: `${CI_TCB_CLOSURE_ARCHIVE_ROOT_V1}/${operationEntry.name}`,
      recordAbsolutePath: path.join(paths.archiveRoot, operationEntry.name),
      recordSource: operationEntry.source,
      oldRawSourceDigest: operation.oldDigest,
      nextRawSourceDigest: operation.nextDigest,
      generatedAt: operation.generatedAt,
      oldSource,
      archivePresent: archiveEntry !== null
    });
  });
  for (const operationKey of archiveSources.keys()) {
    if (!operationSources.has(operationKey)) {
      throw new Error(`TCB closure archive ${operationKey} has no durable operation record.`);
    }
  }
  const pending = rawRecords.filter((record) => !record.archivePresent);
  if (pending.length > 1) throw new Error('TCB closure archive census found multiple PREPARED operations.');
  if (pending.length === 1) {
    const record = pending[0]!;
    if (targetSource === null || tcbClosureRawSourceDigestV1(targetSource) !== record.oldRawSourceDigest) {
      throw new Error('TCB closure PREPARED operation lost its exact target bytes.');
    }
    if (stageSource !== null && tcbClosureRawSourceDigestV1(stageSource) !== record.nextRawSourceDigest) {
      throw new Error('TCB closure PREPARED operation stage does not match its recorded nextDigest.');
    }
  }
  const physicalSources = [
    ...rawRecords.map((record) => ({ source: record.oldSource, label: record.relativePath })),
    ...(targetSource === null ? [] : [{ source: targetSource, label: CI_TCB_CLOSURE_LOCK_TARGET_V1 }]),
    ...(stageSource === null ? [] : [{ source: stageSource, label: 'TCB closure lock stage' }])
  ];
  const sourcesByDigest = new Map<string, { readonly source: string; readonly label: string }>();
  for (const candidate of physicalSources) {
    const digest = tcbClosureRawSourceDigestV1(candidate.source);
    if (sourcesByDigest.has(digest) && sourcesByDigest.get(digest)!.label !== candidate.label) {
      const preparedDuplicate = pending.some((record) =>
        record.oldRawSourceDigest === digest
        && (
          candidate.label === record.relativePath
          || candidate.label === CI_TCB_CLOSURE_LOCK_TARGET_V1
        )
      );
      if (preparedDuplicate) continue;
      throw new Error(`TCB closure archive census found duplicate physical source bytes: ${digest}.`);
    }
    sourcesByDigest.set(digest, candidate);
  }
  for (const record of rawRecords) {
    const candidate = sourcesByDigest.get(record.nextRawSourceDigest);
    if (candidate === undefined) {
      if (record.archivePresent || stageSource !== null || pending[0]?.operationKey !== record.operationKey) {
        throw new Error(`TCB closure operation ${record.operationKey} recorded successor bytes are absent.`);
      }
      continue;
    }
    if (tcbClosureRawSourceDigestV1(candidate.source) !== record.nextRawSourceDigest) {
      throw new Error(`TCB closure operation ${record.operationKey} nextDigest mismatch.`);
    }
  }
  const records = rawRecords;
  const recordsByOldDigest = new Map<string, TcbClosureArchiveRecordV1>();
  const predecessorCounts = new Map<string, number>();
  for (const record of records) {
    if (recordsByOldDigest.has(record.oldRawSourceDigest)) {
      throw new Error(`TCB closure archive census found a fork at ${record.oldRawSourceDigest}.`);
    }
    recordsByOldDigest.set(record.oldRawSourceDigest, record);
    predecessorCounts.set(record.nextRawSourceDigest, (predecessorCounts.get(record.nextRawSourceDigest) ?? 0) + 1);
    if ((predecessorCounts.get(record.nextRawSourceDigest) ?? 0) > 1) {
      throw new Error(`TCB closure archive census found multiple predecessors for ${record.nextRawSourceDigest}.`);
    }
  }
  const terminalSource = stageSource ?? targetSource;
  if (terminalSource === null) {
    if (records.length > 0) throw new Error('TCB closure archive census has no target or staged terminal source.');
    return Object.freeze({
      records: Object.freeze([]),
      latest: null,
      sourcesByDigest,
      targetSource,
      stageSource
    });
  }
  const terminalDigest = tcbClosureRawSourceDigestV1(terminalSource);
  const latest = pending[0] ?? records.find((record) => record.nextRawSourceDigest === terminalDigest) ?? null;
  if (records.length > 0 && latest === null) {
    throw new Error('TCB closure archive history does not terminate at the exact target or staged source.');
  }
  const roots = records.filter((record) => !predecessorCounts.has(record.oldRawSourceDigest));
  if (records.length > 0 && roots.length !== 1) {
    throw new Error('TCB closure archive history must be one acyclic chain.');
  }
  if (roots.length === 1) {
    const visited = new Set<string>();
    let cursor: TcbClosureArchiveRecordV1 | undefined = roots[0];
    while (cursor !== undefined) {
      if (visited.has(cursor.oldRawSourceDigest)) {
        throw new Error('TCB closure archive history contains a cycle.');
      }
      visited.add(cursor.oldRawSourceDigest);
      cursor = recordsByOldDigest.get(cursor.nextRawSourceDigest);
    }
    if (visited.size !== records.length) {
      throw new Error('TCB closure archive history contains a disconnected record.');
    }
  }
  return Object.freeze({
    records: Object.freeze(records),
    latest,
    sourcesByDigest,
    targetSource,
    stageSource
  });
}

function tcbClosureArchiveCensusV1(
  paths: ReturnType<typeof tcbClosureLockTargetV1>,
  raw: TcbClosureArchiveRawDataV1,
  runtime: TcbClosureRuntimeV1
): TcbClosureArchiveCensusV1 {
  for (const record of raw.records) {
    runtime.parseTcbClosureGeneratedRegionV2(record.oldSource);
    const candidate = raw.sourcesByDigest.get(record.nextRawSourceDigest);
    if (candidate === undefined) {
      if (record.archivePresent || raw.stageSource !== null || raw.latest?.operationKey !== record.operationKey) {
        throw new Error(`TCB closure operation ${record.operationKey} recorded successor bytes are absent.`);
      }
      continue;
    }
    const parsedNext = runtime.parseTcbClosureGeneratedRegionV2(candidate.source);
    const transition = runtime.planTcbClosureLockSourceV2({
      source: record.oldSource,
      nextLock: parsedNext.lock,
      generatedAt: record.generatedAt
    });
    if (
      transition.status !== 'update-required'
      || transition.nextSource !== candidate.source
      || transition.oldRawSourceDigest !== record.oldRawSourceDigest
      || transition.nextRawSourceDigest !== record.nextRawSourceDigest
      || tcbClosureArchiveOperationV1(paths, transition, record.oldSource).operationKey !== record.operationKey
    ) throw new Error(`TCB closure operation ${record.operationKey} record does not bind its exact successor.`);
  }
  return Object.freeze({ records: raw.records, latest: raw.latest });
}

function assertTcbClosureArchiveCensusUnchangedV1(
  expected: TcbClosureArchiveCensusV1,
  actual: TcbClosureArchiveCensusV1,
  label: string
): void {
  const identity = (census: TcbClosureArchiveCensusV1): string => JSON.stringify(
    census.records.map((record) => ({
      operationKey: record.operationKey,
      relativePath: record.relativePath,
      oldRawSourceDigest: record.oldRawSourceDigest,
      nextRawSourceDigest: record.nextRawSourceDigest,
      generatedAt: record.generatedAt,
      recordSource: record.recordSource,
      archivePresent: record.archivePresent
    }))
  );
  if (identity(expected) !== identity(actual)) {
    throw new Error(`${label} observed concurrent archive namespace drift; all bytes were preserved.`);
  }
}

function assertTcbClosureArchiveRawDataUnchangedV1(
  expected: TcbClosureArchiveRawDataV1,
  actual: TcbClosureArchiveRawDataV1,
  label: string
): void {
  assertTcbClosureArchiveCensusUnchangedV1(expected, actual, label);
  if (expected.targetSource !== actual.targetSource || expected.stageSource !== actual.stageSource) {
    throw new Error(`${label} observed concurrent target or stage byte drift; all bytes were preserved.`);
  }
}

function recoverTcbClosureStagePlanV1(
  runtime: TcbClosureRuntimeV1,
  oldSource: string,
  stageSource: string,
  nextLock: TcbClosureLock
): TcbClosureLockSourcePlanV2 {
  const staged = runtime.parseTcbClosureGeneratedRegionV2(stageSource);
  if (JSON.stringify(staged.lock) !== JSON.stringify(nextLock)) {
    throw new Error('TCB closure lock stage conflicts with the live causal input closure.');
  }
  const recovered = runtime.planTcbClosureLockSourceV2({
    source: oldSource,
    nextLock: staged.lock,
    generatedAt: staged.receipt.generatedAt
  });
  if (recovered.status !== 'update-required' || recovered.nextSource !== stageSource) {
    throw new Error('TCB closure lock stage is not an exact recoverable successor of the current source.');
  }
  return recovered;
}

function tcbClosureCommandResultV1(
  mode: CodexDevelopmentTcbClosureLockModeV1,
  status: CodexDevelopmentTcbClosureLockCommandResultV1['status'],
  plan: TcbClosureLockSourcePlanV2,
  changed: boolean,
  archive: TcbClosureArchiveOperationV1 | null
): CodexDevelopmentTcbClosureLockCommandResultV1 {
  return Object.freeze({
    schema: 'sec-tcb-closure-lock-command-result-v1',
    mode,
    status,
    target: CI_TCB_CLOSURE_LOCK_TARGET_V1,
    changed,
    trustRevision: plan.nextLock.trustRevision,
    closureDigest: plan.nextLock.closureDigest,
    oldRawSourceDigest: plan.oldRawSourceDigest,
    nextRawSourceDigest: plan.nextRawSourceDigest,
    generatedAt: plan.nextGeneratedAt,
    archivePath: archive?.relativePath ?? null,
    archiveDigest: archive?.oldRawSourceDigest ?? null
  });
}

async function currentTcbClosureLockPlanV1(
  generatedAt: string | null
): Promise<{
  readonly plan: TcbClosureLockSourcePlanV2;
  readonly paths: ReturnType<typeof tcbClosureLockTargetV1>;
  readonly source: string;
  readonly census: TcbClosureArchiveCensusV1;
}> {
  const paths = tcbClosureLockTargetV1();
  const source = readTcbClosureOrdinaryFileV1(paths.target, 'TCB closure lock target');
  if (source === null) throw new Error('TCB closure lock target is missing outside a recoverable apply state.');
  const stageSource = readTcbClosureOrdinaryFileV1(paths.stage, 'TCB closure lock exclusive stage');
  const runtime = await loadTcbClosureRuntimeV1(source);
  const census = tcbClosureArchiveCensusV1(
    paths,
    readTcbClosureArchiveRawDataV1(paths, source, stageSource),
    runtime
  );
  if (stageSource !== null) throw new Error('TCB closure lock read-only mode observed an unresolved staged operation.');
  const current = runtime.parseTcbClosureGeneratedRegionV2(source);
  const plan = runtime.planTcbClosureLockSourceV2({
    source,
    nextLock: runtime.generateTcbClosureLockV2(),
    generatedAt: generatedAt ?? current.receipt.generatedAt
  });
  return { plan, paths, source, census };
}

async function completeTcbClosureApplyV1(
  paths: ReturnType<typeof tcbClosureLockTargetV1>,
  transaction: TcbClosureAnchoredTransactionV1,
  runtime: TcbClosureRuntimeV1,
  plan: TcbClosureLockSourcePlanV2,
  oldSource: string,
  stageSourceAtEntry: string | null,
  censusAtEntry: TcbClosureArchiveCensusV1,
  assertLeaseOwned: () => Promise<void>
): Promise<CodexDevelopmentTcbClosureLockCommandResultV1> {
  const targetName = path.basename(paths.target);
  const stageName = path.basename(paths.stage);
  const targetSource = transaction.read('target', targetName, 'TCB closure lock target');
  const stageSource = transaction.read('target', stageName, 'TCB closure lock exclusive stage');
  if (targetSource !== oldSource || stageSource !== stageSourceAtEntry) {
    throw new Error('TCB closure lock physical state changed after apply planning.');
  }
  let activePlan = plan;
  const recordedPrepared = censusAtEntry.latest?.archivePresent === false
    ? censusAtEntry.latest
    : null;
  const recovered = stageSource !== null || recordedPrepared !== null;
  if (stageSource !== null) {
    activePlan = recoverTcbClosureStagePlanV1(runtime, oldSource, stageSource, plan.nextLock);
  }
  const plannedArchive = tcbClosureArchiveOperationV1(paths, activePlan, oldSource);
  if (recordedPrepared !== null && recordedPrepared.operationKey !== plannedArchive.operationKey) {
    throw new Error('TCB closure PREPARED record conflicts with the live planned operation.');
  }
  if (recordedPrepared === null) {
    if (stageSource !== null) {
      throw new Error('TCB closure staged source has no prior durable operation record.');
    }
    if (censusAtEntry.records.some((record) => record.operationKey === plannedArchive.operationKey)) {
      throw new Error('TCB closure planned archive operation already exists before PREPARED publication.');
    }
    await assertLeaseOwned();
    transaction.createExclusive(
      'archive',
      plannedArchive.recordName,
      plannedArchive.recordSource,
      'TCB closure durable operation record'
    );
  }
  const archive = recordedPrepared ?? Object.freeze({ ...plannedArchive, archivePresent: false });
  if (stageSource === null) {
    const causalBeforeStage = runtime.generateTcbClosureLockV2();
    if (JSON.stringify(causalBeforeStage) !== JSON.stringify(activePlan.nextLock)) {
      throw new Error('TCB closure lock causal input changed before PREPARED stage publication.');
    }
    if (transaction.read('target', targetName, 'TCB closure lock PREPARED target fence') !== oldSource) {
      throw new Error('TCB closure lock raw-source CAS failed before PREPARED stage publication.');
    }
    await assertLeaseOwned();
    transaction.createExclusive(
      'target',
      stageName,
      activePlan.nextSource,
      'TCB closure lock exclusive PREPARED stage'
    );
  }
  if (transaction.read('target', targetName, 'TCB closure lock target causal fence') !== oldSource) {
    throw new Error('TCB closure lock raw-source CAS failed before the causal input fence.');
  }
  const fencedLock = runtime.generateTcbClosureLockV2();
  if (JSON.stringify(fencedLock) !== JSON.stringify(activePlan.nextLock)) {
    throw new Error('TCB closure lock causal input changed after planning.');
  }
  if (transaction.read('target', targetName, 'TCB closure lock target final fence') !== targetSource) {
    throw new Error('TCB closure lock raw-source CAS failed at the final fence.');
  }
  if (transaction.read('target', stageName, 'TCB closure lock stage final fence') !== activePlan.nextSource) {
    throw new Error('TCB closure lock exclusive stage changed before target capture.');
  }
  if (transaction.read('archive', archive.archiveName, 'TCB closure lock planned archive') !== null) {
    throw new Error('TCB closure lock planned archive destination is occupied; all bytes were preserved.');
  }
  const preparedCensus = tcbClosureArchiveCensusV1(
    paths,
    readTcbClosureArchiveRawDataV1(paths, oldSource, activePlan.nextSource, transaction),
    runtime
  );
  if (preparedCensus.latest?.operationKey !== archive.operationKey
      || preparedCensus.latest.archivePresent) {
    throw new Error('TCB closure PREPARED state is not owned by its durable operation record.');
  }
  assertTcbClosureArchiveCensusUnchangedV1(
    preparedCensus,
    tcbClosureArchiveCensusV1(
      paths,
      readTcbClosureArchiveRawDataV1(paths, oldSource, activePlan.nextSource, transaction),
      runtime
    ),
    'TCB closure lock pre-capture fence'
  );
  await assertLeaseOwned();
  transaction.moveNoReplace(
    'target',
    targetName,
    'archive',
    archive.archiveName,
    oldSource,
    'TCB closure lock exact-old capture'
  );
  const capturedCensus = tcbClosureArchiveCensusV1(
    paths,
    readTcbClosureArchiveRawDataV1(paths, null, activePlan.nextSource, transaction),
    runtime
  );
  if (capturedCensus.latest?.operationKey !== archive.operationKey) {
    throw new Error('TCB closure lock captured archive is not the unique terminal recovery authority.');
  }
  assertTcbClosureArchiveCensusUnchangedV1(
    capturedCensus,
    tcbClosureArchiveCensusV1(
      paths,
      readTcbClosureArchiveRawDataV1(paths, null, activePlan.nextSource, transaction),
      runtime
    ),
    'TCB closure lock pre-install fence'
  );
  transaction.moveNoReplace(
    'target',
    stageName,
    'target',
    targetName,
    activePlan.nextSource,
    'TCB closure lock successor install'
  );
  if (transaction.read('target', targetName, 'TCB closure lock installed target') !== activePlan.nextSource) {
    throw new Error('TCB closure lock atomic apply readback mismatch.');
  }
  const installedCensus = tcbClosureArchiveCensusV1(
    paths,
    readTcbClosureArchiveRawDataV1(paths, activePlan.nextSource, null, transaction),
    runtime
  );
  if (installedCensus.latest?.operationKey !== archive.operationKey) {
    throw new Error('TCB closure lock installed target does not bind the retained exact archive.');
  }
  return tcbClosureCommandResultV1('apply', recovered ? 'recovered' : 'applied', activePlan, true, archive);
}

async function executeTcbClosureLockCommandV1(
  mode: CodexDevelopmentTcbClosureLockModeV1,
  generatedAt: string | null
): Promise<CodexDevelopmentTcbClosureLockCommandResultV1> {
  if (mode === 'apply' && process.env.GITHUB_ACTIONS === 'true') {
    throw new Error('TCB closure lock apply is forbidden in hosted execution.');
  }
  if (mode !== 'apply') {
    const { plan, source, census } = await currentTcbClosureLockPlanV1(generatedAt);
    if (mode === 'check' && plan.status === 'update-required') {
      throw new Error(
        `TCB closure lock check failed: update required (${plan.currentLock.closureDigest} -> ${plan.nextLock.closureDigest}).`
      );
    }
    return tcbClosureCommandResultV1(
      mode,
      plan.status === 'current' ? 'current' : 'update-required',
      plan,
      false,
      plan.status === 'update-required'
        ? tcbClosureArchiveOperationV1(tcbClosureLockTargetV1(), plan, source)
        : census.latest
    );
  }
  return withWorkspaceWriteLease(compilerRoot, undefined, async (token) => {
    const paths = tcbClosureLockTargetV1();
    return withTcbClosureAnchoredTransactionV1(paths, async (transaction) => {
      const targetName = path.basename(paths.target);
      const stageName = path.basename(paths.stage);
      const targetSource = transaction.read('target', targetName, 'TCB closure lock target');
      const stageSource = transaction.read('target', stageName, 'TCB closure lock exclusive stage');
      const raw = readTcbClosureArchiveRawDataV1(paths, targetSource, stageSource, transaction);
      if (targetSource === null) {
        if (stageSource === null || raw.latest === null || !raw.latest.archivePresent) {
          throw new Error('TCB closure lock target is absent without one exact CAPTURED recovery record.');
        }
        const captured = raw.latest;
        if (generatedAt !== captured.generatedAt) {
          throw new Error('TCB closure lock recovery generatedAt does not match the recorded operation.');
        }
        if (
          tcbClosureRawSourceDigestV1(captured.oldSource) !== captured.oldRawSourceDigest
          || tcbClosureRawSourceDigestV1(stageSource) !== captured.nextRawSourceDigest
        ) throw new Error('TCB closure lock recorded CAPTURED operation lost its exact raw source bytes.');
        await assertWorkspaceWriteLease(compilerRoot, token);
        assertTcbClosureArchiveRawDataUnchangedV1(
          raw,
          readTcbClosureArchiveRawDataV1(paths, null, stageSource, transaction),
          'TCB closure lock CAPTURED rollback fence'
        );
        transaction.moveNoReplace(
          'archive',
          captured.archiveName,
          'target',
          targetName,
          captured.oldSource,
          'TCB closure lock CAPTURED rollback'
        );
        const restoredTargetSource = transaction.read(
          'target',
          targetName,
          'TCB closure lock restored PREPARED target'
        );
        const retainedStageSource = transaction.read(
          'target',
          stageName,
          'TCB closure lock retained PREPARED stage'
        );
        if (restoredTargetSource !== captured.oldSource || retainedStageSource !== stageSource) {
          throw new Error('TCB closure lock CAPTURED rollback readback mismatch; retained bytes were preserved.');
        }
        const runtime = await loadTcbClosureRuntimeV1(restoredTargetSource);
        const preparedRaw = readTcbClosureArchiveRawDataV1(
          paths,
          restoredTargetSource,
          retainedStageSource,
          transaction
        );
        const preparedCensus = tcbClosureArchiveCensusV1(paths, preparedRaw, runtime);
        if (
          preparedCensus.latest?.operationKey !== captured.operationKey
          || preparedCensus.latest.archivePresent
        ) throw new Error('TCB closure lock rollback did not restore its exact PREPARED recovery state.');
        const recoveredPlan = recoverTcbClosureStagePlanV1(
          runtime,
          restoredTargetSource,
          retainedStageSource,
          runtime.generateTcbClosureLockV2()
        );
        if (
          recoveredPlan.nextGeneratedAt !== captured.generatedAt
          || recoveredPlan.oldRawSourceDigest !== captured.oldRawSourceDigest
          || recoveredPlan.nextRawSourceDigest !== captured.nextRawSourceDigest
          || tcbClosureArchiveOperationV1(paths, recoveredPlan, restoredTargetSource).operationKey
            !== captured.operationKey
        ) throw new Error('TCB closure lock recorded CAPTURED operation does not bind the live replay plan.');
        await assertWorkspaceWriteLease(compilerRoot, token);
        return completeTcbClosureApplyV1(
          paths,
          transaction,
          runtime,
          recoveredPlan,
          restoredTargetSource,
          retainedStageSource,
          preparedCensus,
          () => assertWorkspaceWriteLease(compilerRoot, token)
        );
      }
      const runtime = await loadTcbClosureRuntimeV1(targetSource);
      const census = tcbClosureArchiveCensusV1(paths, raw, runtime);
      const recordedPrepared = census.latest?.archivePresent === false ? census.latest : null;
      const stagedGeneratedAt = stageSource === null
        ? recordedPrepared?.generatedAt ?? null
        : runtime.parseTcbClosureGeneratedRegionV2(stageSource).receipt.generatedAt;
      if (stagedGeneratedAt !== null && generatedAt !== stagedGeneratedAt) {
        throw new Error('TCB closure lock PREPARED operation generatedAt does not match the apply request.');
      }
      const plan = runtime.planTcbClosureLockSourceV2({
        source: targetSource,
        nextLock: runtime.generateTcbClosureLockV2(),
        generatedAt: stagedGeneratedAt ?? generatedAt!
      });
      if (plan.status === 'current') {
        if (stageSource !== null || recordedPrepared !== null) {
          throw new Error('TCB closure lock is current but an unresolved PREPARED operation remains.');
        }
        return tcbClosureCommandResultV1('apply', 'current', plan, false, census.latest);
      }
      await assertWorkspaceWriteLease(compilerRoot, token);
      return completeTcbClosureApplyV1(
        paths,
        transaction,
        runtime,
        plan,
        targetSource,
        stageSource,
        census,
        () => assertWorkspaceWriteLease(compilerRoot, token)
      );
    });
  });
}

export async function CodexDevelopmentCiVerificationTcbClosureLockCliV1(
  argv: readonly string[]
): Promise<string> {
  const mode = argv[0] === 'tcb-closure-lock' && argv[1] === '--mode'
    ? argv[2]
    : undefined;
  const isCheck = mode === 'check' && argv.length === 3;
  const isPlannedWrite = (
    (mode === 'dry-run' || mode === 'apply')
    && argv.length === 5
    && argv[3] === '--generated-at'
  );
  if (!isCheck && !isPlannedWrite) {
    throw new Error(
      'Usage: bun scripts/ci-verification.ts tcb-closure-lock --mode check | '
      + '--mode dry-run|apply --generated-at <canonical-iso-utc>'
    );
  }
  const result = await executeTcbClosureLockCommandV1(
    mode as CodexDevelopmentTcbClosureLockModeV1,
    isCheck ? null : argv[4]!
  );
  return JSON.stringify(result);
}

const HOSTED_ACTION_COMMANDS = new Set([
  'ensure-hosted-action-provider',
  'resolve-hosted-action',
  'prepare-hosted-action-inputs',
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
  const bytes = `${encodeVerificationActionDataV2(value)}\n`;
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

function hostedActionGhReadJsonV2(args: readonly string[], label: string): unknown {
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

function hostedActionRecordV2(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function hostedActionCanonicalFileV2<T>(
  filePath: string,
  parser: (value: unknown) => T,
  label: string
): T {
  const source = readFileSync(path.resolve(filePath), 'utf8');
  const value = parser(JSON.parse(source) as unknown);
  if (source !== `${encodeVerificationActionDataV2(value)}\n`) {
    throw new Error(`${label} is not one exact canonical JSON line.`);
  }
  return value;
}

function hostedActionParentActorV2(repository: string): CiVerificationActionParentActorV2 {
  const event = hostedActionRecordV2(
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')) as unknown,
    'parent Session event'
  );
  const sender = hostedActionRecordV2(event.sender, 'parent Session sender');
  const login = sender.login;
  const id = sender.id;
  const nodeId = sender.node_id;
  if (typeof login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login) ||
      !Number.isSafeInteger(id) || Number(id) < 1 || typeof nodeId !== 'string' || nodeId.length === 0 ||
      sender.type !== 'User' || process.env.GITHUB_ACTOR !== login || process.env.GITHUB_TRIGGERING_ACTOR !== login) {
    throw new Error('parent Session event sender is not one exact human principal.');
  }
  const permissionReadback = hostedActionRecordV2(hostedActionGhReadJsonV2([
    `/repos/${repository}/collaborators/${login}/permission`
  ], 'parent actor permission'), 'parent actor permission');
  const user = hostedActionRecordV2(permissionReadback.user, 'parent actor permission user');
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

function hostedActionParentJobIdV2(repository: string, runId: string, runAttempt: number): string {
  const jobs: Record<string, unknown>[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const response = hostedActionRecordV2(hostedActionGhReadJsonV2([
      `/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100&page=${page}`
    ], `parent job page ${page}`), `parent job page ${page}`);
    if (!Array.isArray(response.jobs) || response.jobs.length > 100) {
      throw new Error(`parent job page ${page} is incomplete.`);
    }
    jobs.push(...response.jobs.map((entry, index) =>
      hostedActionRecordV2(entry, `parent job page ${page}[${index}]`)
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

export function CodexDevelopmentAssertHostedActionParentEventV2(
  eventValue: unknown,
  sessionRequest: VerificationSessionHostedRequestV1
): void {
  const event = hostedActionRecordV2(eventValue, 'parent Session event');
  const expectedClientPayload = Object.freeze({ payload: sessionRequest });
  if (event.action !== CI_VERIFICATION_SESSION_DISPATCH_TYPE ||
      encodeVerificationActionDataV2(event.client_payload) !==
        encodeVerificationActionDataV2(expectedClientPayload)) {
    throw new Error('parent dispatch plan event does not contain the exact Session request wrapper.');
  }
}

function createHostedActionParentPlanV2(input: Readonly<{
  sessionRequest: VerificationSessionHostedRequestV1;
  envelope: VerificationSessionHostedEnvelopeV1;
}>): CiVerificationActionParentDispatchPlanV2 {
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
  CodexDevelopmentAssertHostedActionParentEventV2(
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')) as unknown,
    input.sessionRequest
  );
  const proposals = input.envelope.actionPlanClosure.actions.map((member) =>
    createCiVerificationActionProposalV2({
      sessionRequest: input.sessionRequest,
      proposedActionKey: member.action.actionKey
    })
  );
  for (const proposal of proposals) {
    CodexDevelopmentResolveHostedActionV2({
      request: CodexDevelopmentParseHostedActionRequestV2(encodeVerificationActionDataV2(proposal)),
      envelope: input.envelope
    });
  }
  return createCiVerificationActionParentDispatchPlanV2({
    repositoryId: String(repositoryIdentity.repositoryId),
    repository: repositoryIdentity.repository,
    parentRunId: runId,
    parentRunAttempt: runAttempt,
    parentJobId: hostedActionParentJobIdV2(repositoryIdentity.repository, runId, runAttempt),
    parentWorkflowRef: workflowRef,
    parentWorkflowSha: workflowSha,
    parentActor: hostedActionParentActorV2(repositoryIdentity.repository),
    proposals
  });
}

function hostedActionParentAuthorityV2(input: Readonly<{
  requestPath: string;
  envelopePath: string;
  parentPlanPath: string;
  parentArtifactId: string;
  parentArtifactArchiveDigest: string;
}>): Readonly<{
  sessionRequest: VerificationSessionHostedRequestV1;
  envelope: VerificationSessionHostedEnvelopeV1;
  parentPlan: CiVerificationActionParentDispatchPlanV2;
  providerEnvelopes: readonly CiVerificationActionProviderEnvelopeV2[];
}> {
  const sessionRequest = parseVerificationSessionHostedRequestV1(
    readFileSync(path.resolve(input.requestPath), 'utf8')
  );
  const envelope = parseHostedEnvelopeV1(
    JSON.parse(readFileSync(path.resolve(input.envelopePath), 'utf8')) as unknown
  );
  const parentPlan = hostedActionCanonicalFileV2(
    input.parentPlanPath,
    parseCiVerificationActionParentDispatchPlanV2,
    'parent dispatch plan'
  );
  const expectedProposals = envelope.actionPlanClosure.actions.map((member) =>
    createCiVerificationActionProposalV2({ sessionRequest, proposedActionKey: member.action.actionKey })
  ).sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  if (encodeVerificationActionDataV2(parentPlan.proposals) !== encodeVerificationActionDataV2(expectedProposals)) {
    throw new Error('parent dispatch plan proposals differ from the exact hosted Action closure.');
  }
  if (!/^[1-9][0-9]*$/u.test(input.parentArtifactId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.parentArtifactArchiveDigest)) {
    throw new Error('parent dispatch plan artifact identity is invalid.');
  }
  const providerEnvelopes = parentPlan.proposals.map((proposal) =>
    createCiVerificationActionProviderEnvelopeV2({
      proposal,
      parentPlan,
      parentDispatchPlanArtifactId: input.parentArtifactId,
      parentDispatchPlanArchiveDigest: input.parentArtifactArchiveDigest as VerificationActionKeyDigest
    })
  );
  return Object.freeze({ sessionRequest, envelope, parentPlan, providerEnvelopes: Object.freeze(providerEnvelopes) });
}

function hostedActionChildAuthorityV2(input: Readonly<{
  providerEnvelopePath: string;
  envelopePath: string;
  resolutionPath?: string;
}>): Readonly<{
  providerEnvelope: CiVerificationActionProviderEnvelopeV2;
  envelope: VerificationSessionHostedEnvelopeV1;
  resolution: CodexDevelopmentHostedActionResolutionV2;
}> {
  const providerEnvelope = hostedActionCanonicalFileV2(
    input.providerEnvelopePath,
    parseCiVerificationActionProviderEnvelopeV2,
    'internal Action provider envelope'
  );
  const envelope = parseHostedEnvelopeV1(
    JSON.parse(readFileSync(path.resolve(input.envelopePath), 'utf8')) as unknown
  );
  const resolution = CodexDevelopmentResolveHostedActionV2({
    request: CodexDevelopmentParseHostedActionRequestV2(
      encodeVerificationActionDataV2(providerEnvelope.proposal)
    ),
    envelope
  });
  if (input.resolutionPath !== undefined) {
    const supplied = CodexDevelopmentParseHostedActionResolutionV2(
      readFileSync(path.resolve(input.resolutionPath), 'utf8')
    );
    if (encodeVerificationActionDataV2(supplied) !== encodeVerificationActionDataV2(resolution)) {
      throw new Error('caller Action resolution differs from the authenticated provider envelope.');
    }
  }
  return Object.freeze({ providerEnvelope, envelope, resolution });
}

async function observeHostedActionAuthorityV2(input: Readonly<{
  providerEnvelope: CiVerificationActionProviderEnvelopeV2;
  envelope: VerificationSessionHostedEnvelopeV1;
  role: 'parent' | 'child';
}>): Promise<Readonly<{
  index: CodexDevelopmentHostedActionProviderIndexV2;
  decision: VerificationActionProviderDecisionV2;
}>> {
  const result = await ensureVerificationActionGitHubProviderTransactionV2({
    authority: {
      envelope: input.providerEnvelope,
      actionPlanClosure: input.envelope.actionPlanClosure
    },
    intent: { kind: input.role === 'parent' ? 'coordinate-parent' : 'coordinate' }
  });
  if (result.disposition !== 'observed') {
    throw new Error(`hosted Action provider observation returned ${result.disposition}.`);
  }
  const index = hostedActionProviderIndexFromSnapshotV2(result.snapshot);
  const resolution = CodexDevelopmentResolveHostedActionV2({
    request: CodexDevelopmentParseHostedActionRequestV2(
      encodeVerificationActionDataV2(input.providerEnvelope.proposal)
    ),
    envelope: input.envelope
  });
  const decision = CodexDevelopmentReduceHostedActionProviderIndexV2({
    resolution,
    ...hostedActionRepositoryIdentity(),
    index
  });
  return Object.freeze({ index, decision });
}

async function coordinateHostedSessionProviderV2(input: Readonly<{
  authority: ReturnType<typeof hostedActionParentAuthorityV2>;
  allowDispatch: boolean;
}>): Promise<Readonly<{
  artifactIndex: CodexDevelopmentHostedActionProviderIndexV2;
  coordination: CodexDevelopmentHostedActionCoordinationV2;
  dispatched: number;
}>> {
  const terminalObservations: CodexDevelopmentHostedActionArtifactObservationV2[] = [];
  const startObservations: VerificationActionProviderStartObservationV2[] = [];
  const terminalAnchorObservations: VerificationActionProviderTerminalAnchorObservationV2[] = [];
  const providerStatusReadbacks: VerificationActionProviderStatusReadbackV2[] = [];
  const envelopesByKey = new Map<VerificationActionKeyDigest, CiVerificationActionProviderEnvelopeV2>();
  for (const providerEnvelope of input.authority.providerEnvelopes) {
    const observed = await observeHostedActionAuthorityV2({
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
    schema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA_V2,
    terminalObservations: Object.freeze(terminalObservations),
    startObservations: Object.freeze(startObservations),
    terminalAnchorObservations: Object.freeze(terminalAnchorObservations),
    providerStatusReadbacks: Object.freeze(providerStatusReadbacks)
  });
  const coordination = CodexDevelopmentCoordinateHostedActionsV2({
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
      const result = await ensureVerificationActionGitHubProviderTransactionV2({
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
  if (command === 'ensure-hosted-action-provider') {
    const intentIndex = argv.indexOf('--intent');
    const intent = intentIndex >= 0 ? argv[intentIndex + 1] : undefined;
    if (intent === 'prepare-parent-plan') {
      const args = hostedActionCliArgs(argv, ['--intent', '--request', '--envelope', '--output']);
      const sessionRequest = parseVerificationSessionHostedRequestV1(
        readFileSync(path.resolve(args.get('--request')!), 'utf8')
      );
      const envelope = parseHostedEnvelopeV1(
        JSON.parse(readFileSync(path.resolve(args.get('--envelope')!), 'utf8')) as unknown
      );
      const parentPlan = createHostedActionParentPlanV2({ sessionRequest, envelope });
      writeHostedActionJson(args.get('--output')!, parentPlan);
      return JSON.stringify({
        status: 'prepared',
        artifactName: ciVerificationActionParentDispatchPlanArtifactNameV2(
          parentPlan.parentRunId,
          parentPlan.parentRunAttempt
        ),
        payloadDigest: ciVerificationActionParentDispatchPlanPayloadDigestV2(parentPlan),
        parentDispatchPlanDigest: parentPlan.parentDispatchPlanDigest,
        proposalCount: parentPlan.proposals.length,
        output: path.resolve(args.get('--output')!)
      });
    }
    if (intent === 'verify-parent-plan' || intent === 'coordinate-session' || intent === 'observe-session') {
      const allowed = [
        '--intent', '--request', '--envelope', '--parent-plan', '--parent-artifact-id',
        '--parent-artifact-archive-digest', ...(intent === 'verify-parent-plan' ? [] : ['--artifact-index'])
      ];
      const args = hostedActionCliArgs(argv, allowed);
      const authority = hostedActionParentAuthorityV2({
        requestPath: args.get('--request')!,
        envelopePath: args.get('--envelope')!,
        parentPlanPath: args.get('--parent-plan')!,
        parentArtifactId: args.get('--parent-artifact-id')!,
        parentArtifactArchiveDigest: args.get('--parent-artifact-archive-digest')!
      });
      if (intent === 'verify-parent-plan') {
        const first = authority.providerEnvelopes[0];
        if (first === undefined) throw new Error('parent dispatch plan has no Action proposal.');
        const observed = await observeHostedActionAuthorityV2({
          providerEnvelope: first,
          envelope: authority.envelope,
          role: 'parent'
        });
        return JSON.stringify({
          status: 'verified',
          parentDispatchPlanDigest: authority.parentPlan.parentDispatchPlanDigest,
          parentArtifactPayloadDigest: authority.providerEnvelopes[0]!.parentDispatchPlanPayloadDigest,
          firstActionDisposition: observed.decision.disposition
        });
      }
      const coordinated = await coordinateHostedSessionProviderV2({
        authority,
        allowDispatch: intent === 'coordinate-session'
      });
      writeHostedActionJson(args.get('--artifact-index')!, coordinated.artifactIndex);
      return JSON.stringify({
        ...coordinated.coordination,
        dispatched: coordinated.dispatched,
        artifactIndex: path.resolve(args.get('--artifact-index')!)
      });
    }
    if (intent === 'observe-action') {
      const args = hostedActionCliArgs(argv, [
        '--intent', '--provider-envelope', '--envelope', '--resolution', '--artifact-index'
      ]);
      const authority = hostedActionChildAuthorityV2({
        providerEnvelopePath: args.get('--provider-envelope')!,
        envelopePath: args.get('--envelope')!,
        resolutionPath: args.get('--resolution')!
      });
      const observed = await observeHostedActionAuthorityV2({
        providerEnvelope: authority.providerEnvelope,
        envelope: authority.envelope,
        role: 'child'
      });
      writeHostedActionJson(args.get('--artifact-index')!, observed.index);
      return JSON.stringify({
        ...observed.decision,
        artifactIndex: path.resolve(args.get('--artifact-index')!)
      });
    }
    if (intent === 'prepare-start-marker') {
      const args = hostedActionCliArgs(argv, [
        '--intent', '--provider-envelope', '--envelope', '--resolution',
        '--prepared-candidate-archive', '--base-dependency-closure-digest',
        '--authenticated-git-closure-digest', '--output'
      ]);
      const authority = hostedActionChildAuthorityV2({
        providerEnvelopePath: args.get('--provider-envelope')!,
        envelopePath: args.get('--envelope')!,
        resolutionPath: args.get('--resolution')!
      });
      const archiveInventory = CodexDevelopmentInspectHostedActionArchiveV2({
        resolution: authority.resolution,
        preparedCandidateArchive: args.get('--prepared-candidate-archive')!,
        baseDependencyClosureDigest:
          args.get('--base-dependency-closure-digest')! as VerificationActionKeyDigest,
        authenticatedGitClosureDigest:
          args.get('--authenticated-git-closure-digest')! as VerificationActionKeyDigest
      });
      const sandboxCapability = await CodexDevelopmentProbeHostedSutSandboxCapabilityV1({
        actionKey: authority.resolution.actionPlan.action.actionKey
      });
      if (sandboxCapability.state === 'unknown') {
        throw new Error(`Hosted Action sandbox pre-start capability is an ambiguous machine observation: ${
          sandboxCapability.diagnostic ?? 'no diagnostic'
        }`);
      }
      const observed = await observeHostedActionAuthorityV2({
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
        executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
        producer: currentHostedActionProducerV2()
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
    }
    if (intent === 'claim-start') {
      const args = hostedActionCliArgs(argv, [
        '--intent', '--provider-envelope', '--envelope', '--resolution',
        '--prepared-candidate-archive', '--base-dependency-closure-digest',
        '--authenticated-git-closure-digest', '--output'
      ]);
      const authority = hostedActionChildAuthorityV2({
        providerEnvelopePath: args.get('--provider-envelope')!,
        envelopePath: args.get('--envelope')!,
        resolutionPath: args.get('--resolution')!
      });
      const before = await ensureVerificationActionGitHubProviderTransactionV2({
        authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
        intent: { kind: 'coordinate' }
      });
      const markerObservation = before.snapshot.startObservations[0];
      if (before.disposition !== 'observed' || before.snapshot.startObservations.length !== 1 ||
          markerObservation?.expired !== false || markerObservation.payload === null) {
        throw new Error('claim-start requires one exact uploaded immutable start marker.');
      }
      const marker = parseVerificationActionStartMarkerV2(markerObservation.payload);
      const claimed = await ensureVerificationActionGitHubProviderTransactionV2({
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
      const preparedCandidateInventory = CodexDevelopmentInspectHostedActionArchiveV2({
        resolution: authority.resolution,
        preparedCandidateArchive: args.get('--prepared-candidate-archive')!,
        baseDependencyClosureDigest:
          args.get('--base-dependency-closure-digest')! as VerificationActionKeyDigest,
        authenticatedGitClosureDigest:
          args.get('--authenticated-git-closure-digest')! as VerificationActionKeyDigest
      });
      const ticket = CodexDevelopmentCreateHostedActionExecutionTicketV2({
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
    }
    if (intent === 'prepare-terminal-anchor') {
      const args = hostedActionCliArgs(argv, [
        '--intent', '--provider-envelope', '--envelope', '--resolution', '--output'
      ]);
      const authority = hostedActionChildAuthorityV2({
        providerEnvelopePath: args.get('--provider-envelope')!,
        envelopePath: args.get('--envelope')!,
        resolutionPath: args.get('--resolution')!
      });
      const observed = await observeHostedActionAuthorityV2({
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
        anchorPublisherOrigin: currentHostedActionProducerV2()
      });
      writeVerificationActionTerminalStatusAnchorV2Atomic(args.get('--output')!, anchor);
      return JSON.stringify({
        status: 'anchor-prepared',
        actionKey: anchor.actionKey,
        anchorName: verificationActionProviderTerminalAnchorNameV2(anchor.actionKey),
        anchorDigest: anchor.anchorDigest,
        output: path.resolve(args.get('--output')!)
      });
    }
    if (intent === 'anchor-terminal') {
      const args = hostedActionCliArgs(argv, [
        '--intent', '--provider-envelope', '--envelope', '--resolution'
      ]);
      const authority = hostedActionChildAuthorityV2({
        providerEnvelopePath: args.get('--provider-envelope')!,
        envelopePath: args.get('--envelope')!,
        resolutionPath: args.get('--resolution')!
      });
      const before = await ensureVerificationActionGitHubProviderTransactionV2({
        authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
        intent: { kind: 'coordinate' }
      });
      const anchorObservation = before.snapshot.terminalAnchorObservations[0];
      if (before.disposition !== 'observed' || before.snapshot.terminalAnchorObservations.length !== 1 ||
          anchorObservation?.expired !== false || anchorObservation.payload === null) {
        throw new Error('anchor-terminal requires one exact uploaded terminal anchor.');
      }
      const result = await ensureVerificationActionGitHubProviderTransactionV2({
        authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
        intent: { kind: 'anchor-terminal', anchor: anchorObservation.payload }
      });
      if ((result.disposition !== 'terminal-anchored' && result.disposition !== 'complete') ||
          result.status === null) {
        throw new Error(`neutral terminal tombstone was not anchored: ${result.reason ?? result.disposition}.`);
      }
      const index = hostedActionProviderIndexFromSnapshotV2(result.snapshot);
      const decision = CodexDevelopmentReduceHostedActionProviderIndexV2({
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
    throw new Error(`Unknown ensure-hosted-action-provider intent: ${intent ?? '<missing>'}.`);
  }
  if (command === 'prepare-hosted-action-inputs') {
    const args = hostedActionCliArgs(argv, [
      '--resolution', '--base-root', '--candidate-root', '--output-directory'
    ]);
    const resolution = CodexDevelopmentParseHostedActionResolutionV2(
      readFileSync(path.resolve(args.get('--resolution')!), 'utf8')
    );
    const prepared = CodexDevelopmentPrepareHostedActionInputsV2({
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
  }
  if (command === 'self-test-hosted-action-sandbox') {
    const args = hostedActionCliArgs(argv, ['--resolution']);
    const resolution = CodexDevelopmentParseHostedActionResolutionV2(
      readFileSync(path.resolve(args.get('--resolution')!), 'utf8')
    );
    const observation = await CodexDevelopmentProbeHostedSutSandboxCapabilityV1({
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
      policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
      commandPlanDigest: observation.commandPlanDigest,
      outputDigest: observation.outputDigest,
      residueReadbackDigest: observation.residueReadbackDigest,
      diagnostic: observation.diagnostic
    });
  }
  if (command === 'resolve-hosted-action') {
    const args = hostedActionCliArgs(argv, ['--provider-envelope', '--envelope', '--output']);
    const providerEnvelope = parseCiVerificationActionProviderEnvelopeV2(
      JSON.parse(readFileSync(path.resolve(args.get('--provider-envelope')!), 'utf8')) as unknown
    );
    const request = CodexDevelopmentParseHostedActionRequestV2(
      encodeVerificationActionDataV2(providerEnvelope.proposal)
    );
    const envelope = parseHostedEnvelopeV1(
      JSON.parse(readFileSync(path.resolve(args.get('--envelope')!), 'utf8')) as unknown
    );
    const resolution = CodexDevelopmentResolveHostedActionV2({ request, envelope });
    writeHostedActionJson(args.get('--output')!, resolution);
    return JSON.stringify({
      status: 'resolved',
      actionKey: resolution.actionPlan.action.actionKey,
      actionKeyHex: resolution.actionKeyHex,
      resolutionDigest: resolution.resolutionDigest,
      output: path.resolve(args.get('--output')!)
    });
  }
  if (command === 'execute-hosted-action-sut') {
    const args = hostedActionCliArgs(argv, [
      '--resolution', '--ticket', '--prepared-candidate-archive', '--output'
    ]);
    const resolution = CodexDevelopmentParseHostedActionResolutionV2(
      readFileSync(path.resolve(args.get('--resolution')!), 'utf8')
    );
    const ticket = CodexDevelopmentParseHostedActionExecutionTicketV2(
      readFileSync(path.resolve(args.get('--ticket')!), 'utf8')
    );
    if (ticket.resolutionDigest !== resolution.resolutionDigest ||
        ticket.actionKey !== resolution.actionPlan.action.actionKey ||
        ticket.candidateSha !== resolution.artifactInput.headSha ||
        ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
      throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
    }
    const archiveInventory = CodexDevelopmentMaterializeHostedActionCandidateV2({
      resolution,
      ticket,
      preparedCandidateArchive: args.get('--prepared-candidate-archive')!
    });
    const rawResult = await CodexDevelopmentExecuteHostedActionSutV2({
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
  }
  if (command === 'assemble-hosted-action-terminal') {
    const args = hostedActionCliArgs(argv, [
      '--provider-envelope', '--envelope', '--resolution', '--ticket', '--raw-result',
      '--expected-raw-result-digest', '--output'
    ]);
    const authority = hostedActionChildAuthorityV2({
      providerEnvelopePath: args.get('--provider-envelope')!,
      envelopePath: args.get('--envelope')!,
      resolutionPath: args.get('--resolution')!
    });
    const resolution = authority.resolution;
    const ticket = CodexDevelopmentParseHostedActionExecutionTicketV2(
      readFileSync(path.resolve(args.get('--ticket')!), 'utf8')
    );
    const rawResult = CodexDevelopmentParseHostedActionRawResultV2(
      readFileSync(path.resolve(args.get('--raw-result')!), 'utf8')
    );
    const observed = await ensureVerificationActionGitHubProviderTransactionV2({
      authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
      intent: { kind: 'coordinate' }
    });
    if (observed.disposition !== 'observed') {
      throw new Error(`Hosted Action assembler provider observation returned ${observed.disposition}.`);
    }
    const producer = currentHostedActionProducerV2();
    if (encodeVerificationActionDataV2(producer) !== encodeVerificationActionDataV2(ticket.producer)) {
      throw new Error('Hosted Action terminal assembler is not the original trusted claim run.');
    }
    const index = hostedActionProviderIndexFromSnapshotV2(observed.snapshot);
    const startObservation = index.startObservations[0];
    const readback = index.providerStatusReadbacks[0];
    const startStatus = readback?.statuses.find((entry) => entry.id === ticket.startStatusId);
    if (index.startObservations.length !== 1 || startObservation === undefined || startStatus === undefined ||
        index.terminalObservations.length !== 0 || index.terminalAnchorObservations.length !== 0) {
      throw new Error('Hosted Action assembler does not own the sole exact unresolved start ticket.');
    }
    const rebuiltTicket = CodexDevelopmentCreateHostedActionExecutionTicketV2({
      resolution,
      marker: startObservation.payload!,
      startObservation,
      startStatus,
      preparedCandidateArtifactName: ticket.preparedCandidateArtifactName,
      preparedCandidateInventory: hostedSutInventoryClosureFromTicketV1(ticket)
    });
    if (rebuiltTicket.ticketDigest !== ticket.ticketDigest) {
      throw new Error('Hosted Action assembler ticket no longer matches provider readback.');
    }
    const artifact = CodexDevelopmentAssembleHostedActionTerminalV2({
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
      artifactName: verificationActionProviderTerminalArtifactNameV2(artifact.actionPlan.action.actionKey),
      artifactDigest: artifact.artifactDigest,
      output: path.resolve(args.get('--output')!)
    });
  }
  if (command === 'compose-hosted-evidence') {
    const args = hostedActionCliArgs(argv, [
      '--envelope', '--artifact-index', '--output'
    ]);
    const envelope = parseHostedEnvelopeV1(
      JSON.parse(readFileSync(path.resolve(args.get('--envelope')!), 'utf8')) as unknown
    );
    const index = CodexDevelopmentReadHostedActionArtifactIndexV2({
      source: readFileSync(path.resolve(args.get('--artifact-index')!), 'utf8')
    });
    const producer = CodexDevelopmentCreateVerificationEvidenceProducerV4({
      sourceTransport: 'github-actions',
      workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef: `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`,
      workflowSha: envelope.session.baseSha,
      runId: process.env.GITHUB_RUN_ID ?? '',
      runAttempt: positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT'),
      actorNodeId: envelope.scopeAuthorization.issuer.principalId
    });
    const composed = CodexDevelopmentComposeHostedEvidenceV2({
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
  throw new Error(`Unknown hosted Action command: ${command ?? '<missing>'}.`);
}

async function main(): Promise<number> {
  if (process.argv[2] === 'tcb-closure-lock') {
    process.stdout.write(`${await CodexDevelopmentCiVerificationTcbClosureLockCliV1(process.argv.slice(2))}\n`);
    return 0;
  }
  if (HOSTED_ACTION_COMMANDS.has(process.argv[2] ?? '')) {
    const result = await CodexDevelopmentCiVerificationHostedActionCli(process.argv.slice(2));
    process.stdout.write(`${result}\n`);
    return 0;
  }
  return CodexDevelopmentCiVerificationMain();
}

if (import.meta.main) {
  process.exitCode = await main();
}
