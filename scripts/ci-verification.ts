import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
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

import {
  createVerificationActionCallbackEffectProviderV1,
  executeVerifiedCiActionPlanV1
} from '../platform/dev-runner/verification-action-executor.ts';
import {
  CodexDevelopmentReadExactGitBlobV1,
  type CodexDevelopmentExactGitBlobReadOptionsV1
} from '../platform/git/objects.ts';
import { SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1 } from '../platform/runtime/environments/sec-linux-verification-v1/authority.ts';
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
  type CodexDevelopmentVerificationEvidenceV4,
  type CodexDevelopmentVerificationGateEvidenceV2,
  type CodexDevelopmentVerificationGateEvidenceV4
} from '../platform/shared/ci-evidence-contract.ts';
import {
  type CodexDevelopmentExactGitBlobBytesV1
} from '../platform/shared/ci-evidence-reuse-contract.ts';
import type {
  CodexDevelopmentGitChangedRecordV1,
  CodexDevelopmentTestImpactTransitionObservationV1
} from '../platform/shared/ci-git-changed-files.ts';
import { CodexDevelopmentAssertTestImpactTransitionSelectionV1 } from '../platform/shared/ci-git-changed-files.ts';
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
  CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from '../platform/shared/ci-verification-revision.ts';
import {
  createEnvironmentDependencyCacheHandleV1,
  createEnvironmentDependencyCacheIdentityV1,
  createEnvironmentDependencyCachePhysicalReceiptV2,
  createEnvironmentDependencyClosureV1,
  parseEnvironmentDependencyCachePhysicalReceiptV2,
  type EnvironmentDependencyCacheHandleV1,
  type EnvironmentDependencyCacheIdentityV1,
  type EnvironmentDependencyClosureV1
} from '../platform/shared/environment-materialization-contract.ts';
import { acquirePhysicalMutationLeaseV1 } from '../platform/shared/physical-mutation-lease.ts';
import {
  assertSameNoFollowDirectoryIdentityV1,
  deleteRetainedNoFollowEntryV1,
  deleteRetainedNoFollowInventoryV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChildV1,
  inspectNoFollowOrdinaryFileDigestV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  scanNoFollowDirectoryTreeInventoryV1,
  scanNoFollowDirectoryTreeMetadataV1,
  type NoFollowDirectoryTreeInventoryEntryV1,
  type PhysicalDirectoryChainV1,
  type PhysicalDirectoryIdentityV1
} from '../platform/shared/physical-no-follow.ts';
import { resolveSecRuntimeCacheLayoutV1 } from '../platform/shared/sec-runtime-state-contract.ts';
import {
  assertCiVerificationActionEffectProviderV1,
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
  type CiVerificationExecutionEnvironmentV2,
  type CiVerificationProducerGateV1
} from '../platform/shared/verification-action-ci-contract.ts';
import {
  createVerificationActionPlanClosureV1,
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  isVerificationActionRunnableV2,
  parseVerificationActionPlanV2,
  type VerificationActionDependencyResolutionV2,
  type VerificationActionEffectProviderV1,
  type VerificationActionEvidenceV1,
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
import {
  enforceEnvironmentDependencyCacheBudgetV2,
  ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2,
  openEnvironmentDependencyCacheLifecycleV2,
  type EnvironmentDependencyCacheLifecycleV2
} from '../tooling/sec-dev/environment-cache-lifecycle.ts';
import { acquireSecRuntimeCachePhysicalAuthorityV1 } from '../tooling/sec-dev/runtime-state-authority.ts';
import {
  writeVerificationActionStartMarkerV2Atomic,
  writeVerificationActionTerminalStatusAnchorV2Atomic
} from '../tooling/sec-dev/verification-action-journal.ts';
import {
  createVerificationActionRunnerV2,
  type VerificationActionRunnerV2,
  type VerificationActionRunOutcomeV2
} from '../tooling/sec-dev/verification-action-runner.ts';
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
  ensureVerificationActionGitHubProviderTransactionV2,
  type VerificationActionGitHubProviderSnapshotV2
} from './codex/verification-action-github-provider.ts';
import {
  parseVerificationSessionHostedRequestV1,
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1,
  type VerificationSessionHostedEnvelopeV1,
  type VerificationSessionHostedRequestV1
} from './codex/verification-session-runtime.ts';
import {
  CodexDevelopmentParseCurrentWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest, type CodexDevelopmentWorkPackageManifest
} from './codex/work-package-contract.ts';
export {
  CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA_V2,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
  type CodexDevelopmentHostedActionRawResultV2,
  type CodexDevelopmentHostedSutSandboxReceiptV1
} from '../platform/shared/ci-hosted-sut-observation-contract.ts';

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
const HOSTED_SUT_RETAINED_ARCHIVE_CHILD_FD_V1 = 3;
const HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH_V1 =
  `/proc/self/fd/${HOSTED_SUT_RETAINED_ARCHIVE_CHILD_FD_V1}` as const;
const HOSTED_SUT_RETAINED_DEPENDENCY_ARCHIVE_CHILD_FD_V1 = 4;
const HOSTED_SUT_RETAINED_DEPENDENCY_ARCHIVE_CHILD_PATH_V1 =
  `/proc/self/fd/${HOSTED_SUT_RETAINED_DEPENDENCY_ARCHIVE_CHILD_FD_V1}` as const;

export type CodexDevelopmentHostedSutSandboxCommandPlanV1 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA_V1;
  policyDigest: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1;
  phase: 'capability-self-test' | 'execute' | 'bootstrap-execute' | 'teardown';
  unitName: string;
  command: '/usr/bin/unshare' | '/usr/bin/bash';
  argv: readonly string[];
  operations: readonly CodexDevelopmentHostedSutSandboxOperationV1[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
  /** Exact compiler binding from typed operations to the one canonical shell transport. */
  rendererBindingDigest: VerificationActionKeyDigest;
  planDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutSandboxOperationV1 =
  | Readonly<{
      kind: 'namespace';
      namespaces: readonly ['mount', 'pid', 'network'];
      killChildOnSupervisorExit: true;
    }>
  | Readonly<{
      kind: 'runtime-copy-closure';
      policyDigest: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1;
      hostDirectoryBindAllowed: false;
    }>
  | Readonly<{
      kind: 'retained-input-bind';
      role: 'candidate' | 'dependency';
      childDescriptor: 3 | 4;
      childPath: '/proc/self/fd/3' | '/proc/self/fd/4';
      targetPath: '/authenticated-input/prepared-candidate.tar' | '/authenticated-input/dependencies.tar';
      readOnly: true;
      mountFlags: readonly ['bind', 'ro', 'nosuid', 'nodev', 'noexec'];
    }>
  | Readonly<{
      kind: 'ephemeral-filesystems';
      root: 'tmpfs-chroot';
      workspace: 'tmpfs';
      hostSocketExposure: false;
    }>
  | Readonly<{
      kind: 'privilege-drop';
      uid: 65532;
      gid: 65532;
      noNewPrivileges: true;
      capabilityBoundingSet: 'empty';
    }>
  | Readonly<{
      kind: 'bounded-runtime-exec';
      runtime: 'bun';
      environment: 'empty-then-allowlist';
    }>
  | Readonly<{
      kind: 'exact-residue-cleanup';
      rootKind: 'sandbox-unit';
      parentPath: '/tmp';
      targetIdentity: 'unit-name-bound';
      noFollow: true;
      absenceReadback: true;
      trigger: 'finally' | 'explicit-readback';
    }>;

export type CodexDevelopmentHostedSutSandboxProcessObservationV1 =
  CodexDevelopmentGateProcessResultV1 & Readonly<{
    termination: NonNullable<CodexDevelopmentGateProcessResultV1['termination']>;
    commandStarted: boolean;
    stdoutDigest: VerificationActionKeyDigest;
    stderrDigest: VerificationActionKeyDigest;
    stdoutBytesObserved: number;
    stderrBytesObserved: number;
    outputTruncated: boolean;
  }>;

export type CodexDevelopmentHostedSutSandboxProcessV1 = (
  plan: CodexDevelopmentHostedSutSandboxCommandPlanV1,
  retainedArchive?: CodexDevelopmentRetainedHostedSutArchiveV1,
  retainedDependencyArchive?: CodexDevelopmentRetainedHostedSutArchiveV1
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

function deleteExactOwnedDirectoryGenerationV1(
  generation: PhysicalDirectoryChainV1,
  label: string
): void {
  const inventory = scanNoFollowDirectoryTreeMetadataV1(generation.target, {
    deadlineAtMs: performance.now() + 30_000,
    maximumEntries: 100_000
  });
  deleteRetainedNoFollowInventoryV1({ root: generation.target, inventory });
  const parent = generation.ancestors.at(-2);
  if (parent === undefined) throw new Error(`${label} has no retained parent identity.`);
  deleteRetainedNoFollowEntryV1({
    root: parent,
    relativePath: path.basename(generation.target.path),
    kind: 'directory',
    device: generation.target.device,
    inode: generation.target.inode,
    ancestorDirectories: []
  });
  if (existsSync(generation.target.path)) throw new Error(`${label} remains after exact cleanup.`);
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

type CodexDevelopmentRetainedHostedSutArchiveV1 = Readonly<{
  fileDescriptor: number;
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}>;

function retainedHostedSutArchiveObservationV1(fileDescriptor: number): Readonly<{
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
  if (encodeVerificationActionDataV2(beforeIdentity) !== encodeVerificationActionDataV2(afterIdentity)) {
    throw new Error('Hosted SUT retained archive changed while its bytes were observed.');
  }
  return Object.freeze({
    archiveDigest: `sha256:${hash.digest('hex')}`,
    identityDigest: ciActionDigest(beforeIdentity)
  });
}

function retainHostedSutArchiveV1(
  filePath: string,
  expectedDigest: VerificationActionKeyDigest
): CodexDevelopmentRetainedHostedSutArchiveV1 {
  const noFollow = process.platform === 'linux' ? fsConstants.O_NOFOLLOW : 0;
  const fileDescriptor = openSync(path.resolve(filePath), fsConstants.O_RDONLY | noFollow);
  try {
    const observed = retainedHostedSutArchiveObservationV1(fileDescriptor);
    if (observed.archiveDigest !== expectedDigest) {
      throw new Error('Hosted SUT retained archive differs from its authenticated digest.');
    }
    return Object.freeze({ fileDescriptor, ...observed });
  } catch (error) {
    closeSync(fileDescriptor);
    throw error;
  }
}

function assertRetainedHostedSutArchiveV1(
  retained: CodexDevelopmentRetainedHostedSutArchiveV1
): VerificationActionKeyDigest {
  const observed = retainedHostedSutArchiveObservationV1(retained.fileDescriptor);
  if (observed.archiveDigest !== retained.archiveDigest ||
      observed.identityDigest !== retained.identityDigest) {
    throw new Error('Hosted SUT retained archive changed after authentication.');
  }
  return observed.archiveDigest;
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
    // Cache transport may restore this runner-private path before the trusted
    // materializer runs. Candidate code never sees the host path; every install
    // is driven by the exact trusted-base closure with lifecycle scripts off.
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
  physicalContentDigest: VerificationActionKeyDigest | null;
  contentDigest: VerificationActionKeyDigest | null;
}>;

const HOSTED_ACTION_ARCHIVE_MAX_ENTRIES_V2 = 250_000;

function strictPosixDescendantV1(root: string, candidate: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative);
}

export type CodexDevelopmentHostedDependencyPhysicalSnapshotV1 = Readonly<{
  schema: 'sec-hosted-dependency-physical-snapshot-v1';
  root: PhysicalDirectoryIdentityV1;
  entries: readonly NoFollowDirectoryTreeInventoryEntryV1[];
}>;

export type CodexDevelopmentHostedDependencyArchiveProjectionV1 = Readonly<{
  schema: 'sec-hosted-dependency-archive-projection-v1';
  entriesObserved: number;
  linksProjected: number;
  sourceSnapshotDigest: VerificationActionKeyDigest;
  archiveProjectionDigest: VerificationActionKeyDigest;
}>;

export function CodexDevelopmentCaptureHostedDependencyPhysicalSnapshotV1(
  dependencyRoot: string
): CodexDevelopmentHostedDependencyPhysicalSnapshotV1 {
  const root = inspectNoFollowDirectoryChainV1(
    path.resolve(dependencyRoot), 'Hosted dependency physical snapshot root'
  ).target;
  const entries = scanNoFollowDirectoryTreeInventoryV1(root);
  if (entries.length > HOSTED_ACTION_ARCHIVE_MAX_ENTRIES_V2) {
    throw new Error('Hosted dependency tree exceeds the archive entry bound.');
  }
  return Object.freeze({
    schema: 'sec-hosted-dependency-physical-snapshot-v1',
    root,
    entries
  });
}

function dependencyArchiveTargetV1(
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
  if (!strictPosixDescendantV1(dependencyRoot, linkPath) ||
      !strictPosixDescendantV1(dependencyRoot, lexicalTarget)) {
    throw new Error('Hosted dependency symlink escapes the exact dependency root.');
  }
  if (lexicalTarget === linkPath || strictPosixDescendantV1(lexicalTarget, linkPath)) {
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
export function CodexDevelopmentAssertHostedDependencyArchiveProjectionV1(input: Readonly<{
  before: CodexDevelopmentHostedDependencyPhysicalSnapshotV1;
  after: CodexDevelopmentHostedDependencyPhysicalSnapshotV1;
  archiveEntries: readonly HostedActionArchiveInventoryEntryV2[];
}>): CodexDevelopmentHostedDependencyArchiveProjectionV1 {
  if (input.before.schema !== 'sec-hosted-dependency-physical-snapshot-v1' ||
      input.after.schema !== 'sec-hosted-dependency-physical-snapshot-v1' ||
      JSON.stringify(input.before) !== JSON.stringify(input.after)) {
    throw new Error('Hosted dependency physical generation changed during archive projection.');
  }
  const dependencyRoot = input.before.root.path.split(path.sep).join('/');
  if (!path.posix.isAbsolute(dependencyRoot) || path.posix.normalize(dependencyRoot) !== dependencyRoot) {
    throw new Error('Hosted dependency physical root is not one canonical POSIX path.');
  }
  const sourceByPath = new Map<string, NoFollowDirectoryTreeInventoryEntryV1>();
  for (const entry of input.before.entries) {
    const canonical = canonicalHostedArchivePathV2(entry.relativePath, 'dependency snapshot path', false);
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
    const expectedTarget = dependencyArchiveTargetV1(
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

const HOSTED_ACTION_ARCHIVE_MATERIALIZER_SCRIPT_V3 = [
  'import os, posixpath, stat, sys, tarfile',
  'source_root, output_root, output_name = sys.argv[1:4]',
  'source_dev, source_ino, output_dev, output_ino = sys.argv[4:8]',
  'max_entries, max_bytes = int(sys.argv[8]), int(sys.argv[9])',
  'archive_mode = sys.argv[10]',
  'if archive_mode not in ("candidate", "dependency"): raise RuntimeError("invalid archive mode")',
  'flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)',
  'source_fd = os.open(source_root, flags)',
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
  '  root = source_root.rstrip("/")',
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
  '  require_identity(source_fd, source_dev, source_ino, "archive source root")',
  '  require_identity(output_fd, output_dev, output_ino, "output root")',
  '  output_leaf_fd = os.open(output_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o600, dir_fd=output_fd)',
  '  output_identity = identity(output_leaf_fd)',
  '  with os.fdopen(output_leaf_fd, "wb", closefd=True) as output_stream:',
  '    output_leaf_fd = None',
  '    with tarfile.open(fileobj=output_stream, mode="w:", format=tarfile.PAX_FORMAT, dereference=False) as archive:',
  '      if archive_mode != "dependency":',
  '        seen = {}; add_tree(archive, source_fd, "", False, True)',
  '      if archive_mode != "candidate":',
  '        dependency_stat = os.fstat(source_fd)',
  '        archive.addfile(tar_info("node_modules", dependency_stat, tarfile.DIRTYPE))',
  '        entries += 1',
  '        if entries > max_entries: raise RuntimeError("archive entry bound exceeded")',
  '        seen = {}; add_tree(archive, source_fd, "node_modules", True, True)',
  '    output_stream.flush(); os.fsync(output_stream.fileno())',
  '  os.fsync(output_fd)',
  '  require_identity(source_fd, source_dev, source_ino, "archive source root")',
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
  '  os.close(output_fd); os.close(source_fd)'
].join('\n');

type TrustedBootstrapSplitArchiveInputV1 =
  | Readonly<{
      mode: 'candidate';
      candidateRoot: string;
      outputDirectory: string;
      archiveName: 'prepared-candidate.tar';
    }>
  | Readonly<{
      mode: 'dependency';
      dependencySnapshot: CodexDevelopmentHostedDependencyPhysicalSnapshotV1;
      outputDirectory: string;
      archiveName: 'dependencies.tar';
    }>;

function materializeTrustedBootstrapSplitArchiveV1(
  input: TrustedBootstrapSplitArchiveInputV1
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,96}$/u.test(input.archiveName)) {
    throw new Error('Trusted bootstrap split archive name is invalid.');
  }
  const sourceRoot = realpathSync.native(path.resolve(input.mode === 'candidate'
    ? input.candidateRoot
    : input.dependencySnapshot.root.path));
  const outputDirectory = realpathSync.native(path.resolve(input.outputDirectory));
  const source = input.mode === 'candidate'
    ? inspectNoFollowDirectoryChainV1(
        sourceRoot, 'Trusted bootstrap candidate archive source root'
      ).target
    : assertSameNoFollowDirectoryIdentityV1(
        input.dependencySnapshot.root, 'Trusted bootstrap dependency archive source root'
      ).target;
  const output = inspectNoFollowDirectoryChainV1(
    outputDirectory, 'Trusted bootstrap split archive output root'
  ).target;
  if (source.path !== sourceRoot) {
    throw new Error('Trusted bootstrap split archive source root is not canonical.');
  }
  const archivePath = path.resolve(outputDirectory, input.archiveName);
  if (existsSync(archivePath)) {
    throw new Error('Trusted bootstrap split archive already exists.');
  }
  runHostedMaterializerCommandV2('/usr/bin/python3', [
    '-c', HOSTED_ACTION_ARCHIVE_MATERIALIZER_SCRIPT_V3,
    source.path, output.path, input.archiveName,
    source.device, source.inode, output.device, output.inode,
    String(HOSTED_ACTION_ARCHIVE_MAX_ENTRIES_V2),
    String(input.mode === 'dependency'
      ? ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxTotalBytes
      : CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.workspaceBytes),
    input.mode
  ], `Trusted bootstrap ${input.mode} archive materialization`);
  assertSameNoFollowDirectoryIdentityV1(source, 'Trusted bootstrap split archive source root');
  assertSameNoFollowDirectoryIdentityV1(output, 'Trusted bootstrap split archive output root');
  const archive = lstatSync(archivePath);
  if (!archive.isFile() || archive.isSymbolicLink() || realpathSync.native(archivePath) !== archivePath) {
    throw new Error('Trusted bootstrap split archive did not publish one ordinary output.');
  }
  chmodSync(archivePath, 0o444);
  return archivePath;
}

/** Candidate/head-specific input: it intentionally contains no node_modules. */
export function CodexDevelopmentMaterializeTrustedBootstrapCandidateArchiveV1(input: Readonly<{
  candidateRoot: string;
  outputDirectory: string;
}>): string {
  return materializeTrustedBootstrapSplitArchiveV1({
    ...input,
    archiveName: 'prepared-candidate.tar',
    mode: 'candidate'
  });
}

/** Content-addressed dependency input: it contains only the frozen node_modules tree. */
export function CodexDevelopmentMaterializeDependencyCacheArchiveV1(input: Readonly<{
  dependencySnapshot: CodexDevelopmentHostedDependencyPhysicalSnapshotV1;
  outputDirectory: string;
}>): string {
  return materializeTrustedBootstrapSplitArchiveV1({
    ...input,
    archiveName: 'dependencies.tar',
    mode: 'dependency'
  });
}

const HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT_V3 = [
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

function inspectHostedActionArchiveMetadataV2(archive: string, label: string): unknown {
  const inventory = spawnSync(
    '/usr/bin/python3',
    ['-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT_V3, archive],
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
  if (!Array.isArray(source) || source.length === 0 || source.length > HOSTED_ACTION_ARCHIVE_MAX_ENTRIES_V2) {
    throw new Error('Hosted Action archive inventory is empty or exceeds its entry bound.');
  }
  const entries: HostedActionArchiveInventoryEntryV2[] = [];
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
    const physicalContentEntry = value.type === 'file' || value.type === 'hardlink';
    if ((trustedContentPath && (value.type !== 'file' || value.contentDigest === null)) ||
        (!trustedContentPath && value.contentDigest !== null) ||
        (physicalContentEntry !== (value.physicalContentDigest !== null))) {
      throw new Error(`Hosted Action archive trusted content digest placement is invalid: ${entryPath}.`);
    }
    entries.push(Object.freeze({
      path: entryPath,
      type: value.type as HostedActionArchiveInventoryEntryV2['type'],
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

export function CodexDevelopmentInspectHostedActionArchiveInventoryV3(
  archive: string,
  label: string = 'Hosted Action archive inventory'
): ReturnType<typeof CodexDevelopmentValidateHostedActionArchiveInventoryV2> {
  return CodexDevelopmentValidateHostedActionArchiveInventoryV2(
    inspectHostedActionArchiveMetadataV2(archive, label)
  );
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
    rawInventory = inspectHostedActionArchiveMetadataV2(
      archive,
      'Hosted Action prepared candidate archive'
    );
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

export type CodexDevelopmentDependencyMaterializationRecoveryV1 = Readonly<{
  attempts: 0 | 1 | 2;
  recoveredFrom: 'exact-cache' | 'none' | 'bun-tarball-extraction';
}>;

function dependencyMaterializationFailureDiagnosticV1(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2048);
}

function isBunTarballExtractionFailureV1(error: unknown): boolean {
  const diagnostic = dependencyMaterializationFailureDiagnosticV1(error);
  return diagnostic.includes('error: Fail extracting tarball for "') &&
    diagnostic.includes('error: Fail extracting tarball from ');
}

export function CodexDevelopmentRunBoundedDependencyMaterializationV1(
  runExactMaterialization: () => void
): CodexDevelopmentDependencyMaterializationRecoveryV1 {
  try {
    runExactMaterialization();
    return Object.freeze({ attempts: 1, recoveredFrom: 'none' as const });
  } catch (firstError) {
    if (!isBunTarballExtractionFailureV1(firstError)) throw firstError;
    try {
      runExactMaterialization();
      return Object.freeze({ attempts: 2, recoveredFrom: 'bun-tarball-extraction' as const });
    } catch (secondError) {
      const firstDiagnostic = dependencyMaterializationFailureDiagnosticV1(firstError);
      const secondDiagnostic = dependencyMaterializationFailureDiagnosticV1(secondError);
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
  const trustedInputGeneration = inspectNoFollowDirectoryChainV1(
    trustedInputDirectory,
    'Hosted Action reserved input generation'
  );
  try {
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
  } finally {
    deleteExactOwnedDirectoryGenerationV1(
      trustedInputGeneration,
      'Hosted Action reserved input generation'
    );
  }
}

export type CodexDevelopmentPreparedTrustedBootstrapSutInputsV1 = Readonly<{
  preparedCandidateArchive: string;
  archiveDigest: VerificationActionKeyDigest;
  archiveInventoryDigest: VerificationActionKeyDigest;
  dependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyMaterialization: CodexDevelopmentDependencyMaterializationRecoveryV1;
  dependencyArchiveProjection: CodexDevelopmentHostedDependencyArchiveProjectionV1;
  environmentDependencyClosure: EnvironmentDependencyClosureV1;
  dependencyCacheIdentity: EnvironmentDependencyCacheIdentityV1;
  dependencyArchive: string;
  dependencyArchiveDigest: VerificationActionKeyDigest;
  dependencyCacheHandle: EnvironmentDependencyCacheHandleV1;
}>;

function trustedBootstrapEnvironmentDependencyClosureV1(input: Readonly<{
  dependencyClosure: ReturnType<typeof hostedActionDependencyClosureV1>;
}>): EnvironmentDependencyClosureV1 {
  const lock = input.dependencyClosure.authority.find((entry) => entry.path === 'bun.lock');
  const toolchain = input.dependencyClosure.authority.find((entry) => entry.path === '.bun-version');
  if (lock === undefined || toolchain === undefined) {
    throw new Error('Trusted bootstrap dependency closure lacks lock/toolchain authority.');
  }
  return createEnvironmentDependencyClosureV1({
    environmentSpecDigest: SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1,
    lockDigest: lock.bytesDigest as `sha256:${string}`,
    toolchainDigest: toolchain.bytesDigest as `sha256:${string}`,
    providerRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
    authority: input.dependencyClosure.authority.map((entry) => Object.freeze({
      path: entry.path,
      bytesDigest: entry.bytesDigest as `sha256:${string}`
    }))
  });
}

function trustedBootstrapRepositoryIdentityV1(): string {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error('GITHUB_REPOSITORY must bind the trusted dependency cache owner.');
  }
  return repository;
}

function trustedBootstrapReadPublishedDependencyCacheV1(input: Readonly<{
  paths: Readonly<{ archive: string; receipt: string }>;
  parent: PhysicalDirectoryIdentityV1;
  identity: EnvironmentDependencyCacheIdentityV1;
  ownerHandle: EnvironmentDependencyCacheHandleV1;
}>): EnvironmentDependencyCacheHandleV1 | null {
  const archivePresent = existsSync(input.paths.archive);
  const receiptPresent = existsSync(input.paths.receipt);
  if (!archivePresent && !receiptPresent) return null;
  if (!archivePresent) {
    throw new Error(`typed-block:dependency-cache-generation-crashed:${input.identity.identityDigest}`);
  }
  if (!lstatSync(input.paths.archive).isFile() ||
      realpathSync.native(input.paths.archive) !== input.paths.archive ||
      (lstatSync(input.paths.archive).mode & 0o222) !== 0 ||
      (receiptPresent && (!lstatSync(input.paths.receipt).isFile() ||
      realpathSync.native(input.paths.receipt) !== input.paths.receipt ||
      (lstatSync(input.paths.receipt).mode & 0o222) !== 0))) {
    throw new Error('typed-block:dependency-cache-digest-conflict:identity');
  }
  const receiptBytes = receiptPresent
    ? readNoFollowOrdinaryFileV1(input.parent, path.basename(input.paths.receipt))
    : null;
  if (receiptPresent && receiptBytes === null) {
    throw new Error('typed-block:dependency-cache-digest-conflict:receipt-identity');
  }
  const receipt = receiptBytes !== null
    ? parseEnvironmentDependencyCachePhysicalReceiptV2(Buffer.from(receiptBytes).toString('utf8'))
    : null;
  if (receipt !== null && (receipt.resourceId !== input.ownerHandle.resourceId ||
      receipt.identityDigest !== input.identity.identityDigest ||
      receipt.closureDigest !== input.identity.closureDigest ||
      receipt.archiveDigest !== input.ownerHandle.archiveDigest ||
      receipt.archiveBytes !== input.ownerHandle.archiveBytes ||
      receipt.sourceSnapshotDigest !== input.ownerHandle.sourceSnapshotDigest ||
      receipt.archiveProjectionDigest !== input.ownerHandle.archiveProjectionDigest)) {
    throw new Error('typed-block:dependency-cache-digest-conflict:binding');
  }
  const observedArchive = inspectNoFollowOrdinaryFileDigestV1(
    input.parent, path.basename(input.paths.archive)
  );
  if (observedArchive === null || observedArchive.byteDigest !== input.ownerHandle.archiveDigest ||
      observedArchive.size !== input.ownerHandle.archiveBytes) {
    throw new Error('typed-block:dependency-cache-digest-conflict:archive');
  }
  return input.ownerHandle;
}

function trustedBootstrapPublishedArchiveProjectionV1(
  handle: EnvironmentDependencyCacheHandleV1,
  archiveEntries: readonly HostedActionArchiveInventoryEntryV2[]
): CodexDevelopmentHostedDependencyArchiveProjectionV1 {
  const entries = archiveEntries.filter(
    (entry) => entry.path === 'node_modules' || entry.path.startsWith('node_modules/')
  );
  const canonical = Object.freeze([...entries]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const archiveProjectionDigest = ciActionDigest(canonical);
  if (archiveProjectionDigest !== handle.archiveProjectionDigest ||
      entries.length === 0 || entries[0]?.path !== 'node_modules') {
    throw new Error('typed-block:dependency-cache-digest-conflict:projection');
  }
  return Object.freeze({
    schema: 'sec-hosted-dependency-archive-projection-v1',
    entriesObserved: entries.length - 1,
    linksProjected: entries.filter(({ type }) => type === 'symlink').length,
    sourceSnapshotDigest: handle.sourceSnapshotDigest,
    archiveProjectionDigest
  });
}

function trustedBootstrapRetireCrashedDependencyCacheV1(
  parent: PhysicalDirectoryIdentityV1,
  paths: Readonly<{ archive: string; receipt: string; leaseName: string }>
): void {
  const allowed = new Set([path.basename(paths.archive), path.basename(paths.receipt), paths.leaseName]);
  const entries = scanNoFollowDirectoryTreeMetadataV1(parent, {
    maximumEntries: 4,
    deadlineAtMs: performance.now() + 5_000
  });
  if (entries.some((entry) => !allowed.has(entry.relativePath) || entry.kind !== 'file')) {
    throw new Error('typed-block:dependency-cache-recovery-foreign-residue');
  }
  for (const entry of entries) {
    if (entry.relativePath === paths.leaseName) continue;
    deleteRetainedNoFollowEntryV1({
      root: parent,
      relativePath: entry.relativePath,
      kind: 'file',
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories: []
    });
  }
}

async function trustedBootstrapPublishDependencyCacheV1(input: Readonly<{
  repositoryRoot: string;
  dependencyClosure: EnvironmentDependencyClosureV1;
  materialize: (input: Readonly<{ recovering: boolean }>) => Readonly<{
    snapshot: CodexDevelopmentHostedDependencyPhysicalSnapshotV1;
    recovery: CodexDevelopmentDependencyMaterializationRecoveryV1;
  }>;
}>): Promise<Readonly<{
  archive: string;
  handle: EnvironmentDependencyCacheHandleV1;
  identity: EnvironmentDependencyCacheIdentityV1;
  projection: CodexDevelopmentHostedDependencyArchiveProjectionV1;
  materialization: CodexDevelopmentDependencyMaterializationRecoveryV1;
}>> {
  const identity = createEnvironmentDependencyCacheIdentityV1({ closure: input.dependencyClosure });
  const repository = trustedBootstrapRepositoryIdentityV1();
  const lifecycle = await openEnvironmentDependencyCacheLifecycleV2({
    repository,
    repositoryRoot: input.repositoryRoot,
    identity,
    providerRevision: input.dependencyClosure.providerRevision,
    platform: input.dependencyClosure.platform
  });
  const paths = Object.freeze({
    entry: lifecycle.locators.cacheEntryPath,
    archive: lifecycle.locators.cacheArchivePath,
    receipt: lifecycle.locators.cacheReceiptPath,
    leaseName: lifecycle.locators.cacheMutationLeaseName
  });
  let ownerCurrent = lifecycle.recoverDeadConsumers().current;
  let recovering = false;
  if (ownerCurrent.phase === 'materializing') {
    if (Date.parse(ownerCurrent.leaseExpiresAt) > Date.now()) {
      throw new Error(`typed-block:dependency-cache-generation-in-flight:${identity.identityDigest}`);
    }
    recovering = true;
  } else if (ownerCurrent.phase !== 'registered' && ownerCurrent.phase !== 'published') {
    throw new Error(`typed-block:dependency-cache-${ownerCurrent.phase}:${identity.identityDigest}`);
  }
  const cacheLayout = resolveSecRuntimeCacheLayoutV1({
    platform: 'linux',
    environment: Object.freeze({
      SEC_STATE_HOME: process.env.SEC_STATE_HOME,
      SEC_CACHE_HOME: process.env.SEC_CACHE_HOME,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
      HOME: process.env.HOME
    }),
    repositoryRoot: input.repositoryRoot
  });
  const cacheRootAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    cacheRoot: cacheLayout.cacheRoot,
    requiredDirectories: [path.dirname(paths.entry)]
  });
  cacheRootAuthority.assertCurrent();
  if (ownerCurrent.phase === 'published') {
    const cacheEntry = inspectNoFollowDirectoryChildV1(
      cacheRootAuthority.directory(path.dirname(paths.entry)),
      path.basename(paths.entry),
      'trusted bootstrap published dependency cache entry'
    );
    if (cacheEntry === null) {
      throw new Error(`typed-block:dependency-cache-published-bytes-absent:${identity.identityDigest}`);
    }
    const ownerHandle = createEnvironmentDependencyCacheHandleV1({ current: ownerCurrent });
    const existing = trustedBootstrapReadPublishedDependencyCacheV1({
      paths, parent: cacheEntry, identity, ownerHandle
    });
    if (existing === null) {
      throw new Error(`typed-block:dependency-cache-published-bytes-absent:${identity.identityDigest}`);
    }
    if (!existsSync(paths.receipt)) {
      const physicalReceipt = createEnvironmentDependencyCachePhysicalReceiptV2({
        current: ownerCurrent
      });
      publishExclusiveDurableCanonicalFileV1({
        parent: cacheEntry,
        name: path.basename(paths.receipt),
        bytes: Buffer.from(`${encodeVerificationActionDataV2(physicalReceipt)}\n`, 'utf8'),
        unixMode: 0o400,
        validate: (bytes) => {
          const parsed = parseEnvironmentDependencyCachePhysicalReceiptV2(
            Buffer.from(bytes).toString('utf8')
          );
          if (parsed.receiptDigest !== physicalReceipt.receiptDigest) {
            throw new Error('Dependency cache physical receipt differs from owner current.');
          }
        }
      });
    }
    const inventory = CodexDevelopmentInspectHostedActionArchiveInventoryV3(
      paths.archive, 'Trusted bootstrap dependency cache reuse inventory'
    );
    await enforceEnvironmentDependencyCacheBudgetV2({
      repository,
      repositoryRoot: input.repositoryRoot,
      protectedIdentityDigest: identity.identityDigest,
      platform: input.dependencyClosure.platform
    });
    return Object.freeze({
      archive: paths.archive,
      handle: existing,
      identity,
      projection: trustedBootstrapPublishedArchiveProjectionV1(existing, inventory.entries),
      materialization: Object.freeze({ attempts: 0, recoveredFrom: 'exact-cache' })
    });
  }
  ownerCurrent = recovering
    ? lifecycle.recoverMaterialization()
    : lifecycle.beginMaterialization();
  const cacheAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    cacheRoot: cacheLayout.cacheRoot,
    requiredDirectories: [path.dirname(paths.entry), paths.entry]
  });
  cacheAuthority.assertCurrent();
  const physicalLease = acquirePhysicalMutationLeaseV1(
    cacheAuthority.directory(paths.entry), paths.leaseName
  );
  if (physicalLease === null) {
    throw new Error(`typed-block:dependency-cache-generation-in-flight:${identity.identityDigest}`);
  }
  try {
    if (existsSync(paths.archive) || existsSync(paths.receipt)) {
      trustedBootstrapRetireCrashedDependencyCacheV1(cacheAuthority.directory(paths.entry), paths);
    }
    const materialized = input.materialize({ recovering });
    const archive = CodexDevelopmentMaterializeDependencyCacheArchiveV1({
      dependencySnapshot: materialized.snapshot,
      outputDirectory: paths.entry
    });
    chmodSync(archive, 0o444);
    const archiveBytes = lstatSync(archive).size;
    const archiveDigest = hostedActionFileDigestV2(archive);
    const after = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshotV1(
      materialized.snapshot.root.path
    );
    const inventory = CodexDevelopmentInspectHostedActionArchiveInventoryV3(
      archive, 'Trusted bootstrap dependency cache publication inventory'
    );
    const projection = CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
      before: materialized.snapshot,
      after,
      archiveEntries: inventory.entries
    });
    ownerCurrent = lifecycle.publishPhysical({
      sourceSnapshotDigest: projection.sourceSnapshotDigest,
      archiveProjectionDigest: projection.archiveProjectionDigest
    });
    const handle = createEnvironmentDependencyCacheHandleV1({ current: ownerCurrent });
    const physicalReceipt = createEnvironmentDependencyCachePhysicalReceiptV2({
      current: ownerCurrent
    });
    publishExclusiveDurableCanonicalFileV1({
      parent: cacheAuthority.directory(paths.entry),
      name: path.basename(paths.receipt),
      bytes: Buffer.from(`${encodeVerificationActionDataV2(physicalReceipt)}\n`, 'utf8'),
      unixMode: 0o400,
      validate: (bytes) => {
        const parsed = parseEnvironmentDependencyCachePhysicalReceiptV2(
          Buffer.from(bytes).toString('utf8')
        );
        if (parsed.receiptDigest !== physicalReceipt.receiptDigest) {
          throw new Error('Dependency cache physical receipt durable readback mismatch.');
        }
      }
    });
    const readback = trustedBootstrapReadPublishedDependencyCacheV1({
      paths, parent: cacheAuthority.directory(paths.entry), identity, ownerHandle: handle
    });
    if (readback === null || readback.handleDigest !== handle.handleDigest) {
      throw new Error('Trusted bootstrap dependency cache handle readback mismatch.');
    }
    await enforceEnvironmentDependencyCacheBudgetV2({
      repository,
      repositoryRoot: input.repositoryRoot,
      protectedIdentityDigest: identity.identityDigest,
      platform: input.dependencyClosure.platform
    });
    return Object.freeze({
      archive, handle, identity, projection, materialization: materialized.recovery
    });
  } finally {
    physicalLease.release();
  }
}

export function CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
}>): void {
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseTopLevel = realpathSync.native(gitCandidateBytesV2(
    baseRoot, ['rev-parse', '--show-toplevel']
  ).toString('utf8').trim());
  const candidateTopLevel = realpathSync.native(gitCandidateBytesV2(
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
        `:(top,exclude,literal)${relativeCandidateRoot.split(path.sep).join('/')}`,
        ':(top,exclude,literal)node_modules'
      ]
    : [
        'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching', '--', '.',
        ':(top,exclude,literal)node_modules'
      ];
  if (gitCandidateBytesV2(baseRoot, baseStatusArgs).length !== 0 ||
      gitCandidateBytesV2(candidateRoot, [
        'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'
      ]).length !== 0) {
    throw new Error('Trusted bootstrap SUT materialization requires clean base and candidate checkouts.');
  }
}

export async function CodexDevelopmentPrepareTrustedBootstrapSutInputsV1(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
  baseSha: string;
  headSha: string;
  treeSha: string;
}>): Promise<CodexDevelopmentPreparedTrustedBootstrapSutInputsV1> {
  if (process.platform !== 'linux') {
    throw new Error('typed-block:unsafe-host-capability:linux-provider-required');
  }
  if (!/^[0-9a-f]{40}$/u.test(input.baseSha) ||
      !/^[0-9a-f]{40}$/u.test(input.headSha) || !/^[0-9a-f]{40}$/u.test(input.treeSha)) {
    throw new Error('Trusted bootstrap SUT input identity is invalid.');
  }
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseHead = gitCandidateBytesV2(baseRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    .toString('utf8').trim();
  const candidateHead = gitCandidateBytesV2(candidateRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    .toString('utf8').trim();
  const candidateTree = gitCandidateBytesV2(candidateRoot, ['rev-parse', '--verify', 'HEAD^{tree}'])
    .toString('utf8').trim();
  const candidateParents = gitCandidateBytesV2(candidateRoot, ['rev-list', '--parents', '-n', '1', 'HEAD'])
    .toString('utf8').trim().split(/\s+/u);
  if (baseHead !== input.baseSha || candidateHead !== input.headSha || candidateTree !== input.treeSha ||
      candidateParents.length !== 2 || candidateParents[0] !== input.headSha ||
      candidateParents[1] !== input.baseSha) {
    throw new Error('Trusted bootstrap SUT checkouts are not the exact base and single-parent candidate.');
  }
  CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1({ baseRoot, candidateRoot });
  const dependencyClosure = hostedActionDependencyClosureV1({
    baseRoot, candidateRoot, baseSha: input.baseSha
  });
  const baseNodeModules = path.resolve(baseRoot, 'node_modules');
  const candidateNodeModules = path.resolve(candidateRoot, 'node_modules');
  if (existsSync(candidateNodeModules)) {
    throw new Error('Trusted bootstrap candidate node_modules already exists.');
  }
  const outputDirectory = path.resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  if (!lstatSync(outputDirectory).isDirectory() || realpathSync.native(outputDirectory) !== outputDirectory) {
    throw new Error('Trusted bootstrap transport root is not one ordinary directory.');
  }
  const environmentDependencyClosure = trustedBootstrapEnvironmentDependencyClosureV1({ dependencyClosure });
  const dependencyCache = await trustedBootstrapPublishDependencyCacheV1({
    repositoryRoot: baseRoot,
    dependencyClosure: environmentDependencyClosure,
    materialize: ({ recovering }) => {
      if (!recovering && existsSync(baseNodeModules)) {
        throw new Error('typed-block:dependency-cache-unowned-base-node-modules');
      }
      const materializerEnvironment = CodexDevelopmentHostedDependencyMaterializerEnvironmentV1();
      mkdirSync(materializerEnvironment.BUN_INSTALL_CACHE_DIR!, { recursive: true });
      mkdirSync(materializerEnvironment.HOME!, { recursive: true });
      mkdirSync(materializerEnvironment.TMPDIR!, { recursive: true });
      const recovery = CodexDevelopmentRunBoundedDependencyMaterializationV1(() => {
        runHostedMaterializerCommandV2(
          realpathSync.native(process.execPath),
          ['install', '--frozen-lockfile', '--ignore-scripts'],
          'Trusted bootstrap exact-base dependency materialization',
          { cwd: baseRoot, env: materializerEnvironment }
        );
      });
      if (!lstatSync(baseNodeModules).isDirectory() ||
          realpathSync.native(baseNodeModules) !== baseNodeModules) {
        throw new Error('Trusted bootstrap exact-base dependency materialization has no ordinary node_modules.');
      }
      return Object.freeze({
        snapshot: CodexDevelopmentCaptureHostedDependencyPhysicalSnapshotV1(baseNodeModules),
        recovery
      });
    }
  });
  const dependencyMaterialization = dependencyCache.materialization;
  const dependencyArchiveProjection = dependencyCache.projection;
  const trustedInputDirectory = path.resolve(candidateRoot, '.sec-trusted-input');
  if (existsSync(trustedInputDirectory)) {
    throw new Error('Trusted bootstrap candidate collides with the reserved trusted-input directory.');
  }
  mkdirSync(trustedInputDirectory, { recursive: false });
  const trustedInputGeneration = inspectNoFollowDirectoryChainV1(
    trustedInputDirectory,
    'Trusted bootstrap reserved input generation'
  );
  const dependencyClosurePath = path.resolve(trustedInputDirectory, 'dependency-closure.json');
  const gitBundlePath = path.resolve(trustedInputDirectory, 'candidate.bundle');
  const preparedCandidateArchive = path.resolve(outputDirectory, 'prepared-candidate.tar');
  try {
    writeHostedActionJson(dependencyClosurePath, dependencyClosure);
    for (const revision of [input.baseSha, input.headSha]) {
      runHostedMaterializerCommandV2(
        '/usr/bin/git', ['-C', candidateRoot, 'cat-file', '-e', `${revision}^{commit}`],
        `Trusted bootstrap Git object readback ${revision}`
      );
    }
    runHostedMaterializerCommandV2(
      '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/base', input.baseSha],
      'Trusted bootstrap exact base ref materialization'
    );
    runHostedMaterializerCommandV2(
      '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/head', input.headSha],
      'Trusted bootstrap exact head ref materialization'
    );
    runHostedMaterializerCommandV2(
      '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'create', gitBundlePath, 'refs/sec/base', 'refs/sec/head'],
      'Trusted bootstrap authenticated candidate Git bundle materialization'
    );
    runHostedMaterializerCommandV2(
      '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'verify', gitBundlePath],
      'Trusted bootstrap authenticated candidate Git bundle verification'
    );
    const materializedArchive = CodexDevelopmentMaterializeTrustedBootstrapCandidateArchiveV1({
      candidateRoot,
      outputDirectory
    });
    if (materializedArchive !== preparedCandidateArchive) {
      throw new Error('Trusted bootstrap retained archive projection returned the wrong output identity.');
    }
    const validated = CodexDevelopmentInspectHostedActionArchiveInventoryV3(
      preparedCandidateArchive,
      'Trusted bootstrap prepared candidate archive inventory'
    );
    const bundleEntry = validated.entries.find(
      (entry) => entry.path === '.sec-trusted-input/candidate.bundle'
    );
    const dependencyEntry = validated.entries.find(
      (entry) => entry.path === '.sec-trusted-input/dependency-closure.json'
    );
    const authenticatedGitClosureDigest = hostedActionFileDigestV2(gitBundlePath);
    const dependencyClosureDigest = hostedActionFileDigestV2(dependencyClosurePath);
    if (bundleEntry?.type !== 'file' || bundleEntry.contentDigest !== authenticatedGitClosureDigest ||
        dependencyEntry?.type !== 'file' || dependencyEntry.contentDigest !== dependencyClosureDigest) {
      throw new Error('Trusted bootstrap archive lost its authenticated Git or dependency closure.');
    }
    if (validated.entries.some((entry) => entry.path === 'node_modules' ||
        entry.path.startsWith('node_modules/'))) {
      throw new Error('Trusted bootstrap candidate archive must not contain node_modules.');
    }
    return Object.freeze({
      preparedCandidateArchive,
      archiveDigest: hostedActionFileDigestV2(preparedCandidateArchive),
      archiveInventoryDigest: validated.inventoryDigest,
      dependencyClosureDigest,
      authenticatedGitClosureDigest,
      entryCount: validated.entries.length,
      totalFileBytes: validated.totalFileBytes,
      dependencyMaterialization,
      dependencyArchiveProjection,
      environmentDependencyClosure,
      dependencyCacheIdentity: dependencyCache.identity,
      dependencyArchive: dependencyCache.archive,
      dependencyArchiveDigest: dependencyCache.handle.archiveDigest,
      dependencyCacheHandle: dependencyCache.handle
    });
  } finally {
    deleteExactOwnedDirectoryGenerationV1(
      trustedInputGeneration,
      'Trusted bootstrap reserved input generation'
    );
  }
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

function shellSingleQuoteV1(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
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

function hostedSutChrootExecutionScriptV1(includeDependencyArchive: boolean): string {
  return [
  'expected_archive_digest="$1"',
  ...(includeDependencyArchive ? ['expected_dependency_archive_digest="$2"'] : []),
  `base_sha="$${includeDependencyArchive ? 3 : 2}"`,
  `head_sha="$${includeDependencyArchive ? 4 : 3}"`,
  `environment_count="$${includeDependencyArchive ? 5 : 4}"`,
  `shift ${includeDependencyArchive ? 5 : 4}`,
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 1 ]',
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  '[ "sha256:$(/usr/bin/sha256sum /authenticated-input/prepared-candidate.tar | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  ...(includeDependencyArchive ? [
    '[ "sha256:$(/usr/bin/sha256sum /authenticated-input/dependencies.tar | /usr/bin/cut -d " " -f 1)" = "$expected_dependency_archive_digest" ]'
  ] : []),
  '/usr/bin/tar --extract --file=/authenticated-input/prepared-candidate.tar --directory=/workspace --no-same-owner --no-same-permissions --delay-directory-restore',
  ...(includeDependencyArchive ? [
    '/usr/bin/tar --extract --file=/authenticated-input/dependencies.tar --directory=/workspace --no-same-owner --no-same-permissions --delay-directory-restore'
  ] : []),
  '[ -f /workspace/.sec-trusted-input/candidate.bundle ]',
  '/usr/bin/git -C /workspace init --quiet',
  '/usr/bin/git -C /workspace -c protocol.file.allow=always fetch --quiet /workspace/.sec-trusted-input/candidate.bundle refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/base)" = "$base_sha" ]',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/head)" = "$head_sha" ]',
  '/usr/bin/git -C /workspace reset --hard --quiet refs/sec/head',
  'rm -f -- /workspace/.sec-trusted-input/candidate.bundle /workspace/.sec-trusted-input/dependency-closure.json',
  'rmdir -- /workspace/.sec-trusted-input',
  '[ -z "$(/usr/bin/git -C /workspace config --local --get-regexp \u0027^(credential\\.|remote\\.|http\\.|core\\.(worktree|sshCommand)|include)\u0027 || true)" ]',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} /workspace`,
  'cd /workspace',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.processes} -- /usr/bin/env -i "\${environment[@]}" /tool/bin/bun "$@"`
  ].join('\n');
}

function hostedSutNamespaceScriptV1(includeDependencyArchive: boolean): string {
  const bunPosition = includeDependencyArchive ? 6 : 4;
  const basePosition = includeDependencyArchive ? 7 : 5;
  const headPosition = includeDependencyArchive ? 8 : 6;
  const environmentCountPosition = includeDependencyArchive ? 9 : 7;
  return [
  'unit_name="$1"',
  'candidate_archive="$2"',
  'expected_archive_digest="$3"',
  ...(includeDependencyArchive ? [
    'dependency_archive="$4"',
    'expected_dependency_archive_digest="$5"'
  ] : []),
  `bun_host="$${bunPosition}"`,
  `base_sha="$${basePosition}"`,
  `head_sha="$${headPosition}"`,
  `environment_count="$${environmentCountPosition}"`,
  `shift ${environmentCountPosition}`,
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 2 ]',
  '[ "$1" = "bun" ]',
  'shift',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rmdir -- "$root" >/dev/null 2>&1 || true\u0027 EXIT',
  `mount -t tmpfs -o nodev,nosuid,mode=0755,size=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.workspaceBytes} tmpfs "$root"`,
  'mkdir -p "$root/tool/bin" "$root/authenticated-input" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/etc"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE_V2,
  '[ "$candidate_archive" = "/proc/self/fd/3" ]',
  ...(includeDependencyArchive ? ['[ "$dependency_archive" = "/proc/self/fd/4" ]'] : []),
  `/usr/bin/touch "$root/authenticated-input/prepared-candidate.tar"${includeDependencyArchive ? ' "$root/authenticated-input/dependencies.tar"' : ''}`,
  '/usr/bin/mount --bind "$candidate_archive" "$root/authenticated-input/prepared-candidate.tar"',
  '/usr/bin/mount -o remount,bind,ro,nosuid,nodev,noexec "$root/authenticated-input/prepared-candidate.tar"',
  ...(includeDependencyArchive ? [
    '/usr/bin/mount --bind "$dependency_archive" "$root/authenticated-input/dependencies.tar"',
    '/usr/bin/mount -o remount,bind,ro,nosuid,nodev,noexec "$root/authenticated-input/dependencies.tar"'
  ] : []),
  `/usr/bin/awk -v target="$root/authenticated-input/prepared-candidate.tar" '$5 == target && $6 ~ /(^|,)ro(,|$)/ { found += 1 } END { exit found == 1 ? 0 : 1 }' /proc/self/mountinfo`,
  ...(includeDependencyArchive ? [
    `/usr/bin/awk -v target="$root/authenticated-input/dependencies.tar" '$5 == target && $6 ~ /(^|,)ro(,|$)/ { found += 1 } END { exit found == 1 ? 0 : 1 }' /proc/self/mountinfo`
  ] : []),
  '[ "sha256:$(/usr/bin/sha256sum "$root/authenticated-input/prepared-candidate.tar" | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  ...(includeDependencyArchive ? [
    '[ "sha256:$(/usr/bin/sha256sum "$root/authenticated-input/dependencies.tar" | /usr/bin/cut -d " " -f 1)" = "$expected_dependency_archive_digest" ]'
  ] : []),
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=' +
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.workspaceBytes + ' tmpfs "$root/workspace"',
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
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} "$root/workspace" "$root/home/sut" "$root/tmp"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuoteV1(hostedSutChrootExecutionScriptV1(includeDependencyArchive))} sec-hosted-sut-root "$expected_archive_digest"${includeDependencyArchive ? ' "$expected_dependency_archive_digest"' : ''} "$base_sha" "$head_sha" "\${#environment[@]}" "\${environment[@]}" "$@"`
  ].join('\n');
}

const TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS_V1 = Object.freeze([
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/test-runner.test.ts',
  'tests/contract/ci-contract.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/default-branch-revision-health.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/documentation-authority.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/contract/ci-lanes.test.ts'
] as const);

// This program is frozen in the trusted base CLI and is the only command the
// bootstrap candidate may execute. Child output is streamed into bounded
// digest/tail observations; it never reaches GitHub command files or the host
// runner's inherited stdout directly.
export const CodexDevelopmentTrustedBootstrapSutHarnessV1 = [
  '(async () => {',
  'const { createHash } = require("node:crypto");',
  'const CAP = 2097152;',
  'const TAIL = 512;',
  'const required = (name) => process.env[name] ?? (() => { throw new Error(`missing:${name}`); })();',
  'const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;',
  'const results = [];',
  'const collect = async (stream, state, child) => {',
  '  const reader = stream.getReader();',
  '  for (;;) {',
  '    const { done, value } = await reader.read();',
  '    if (done) break;',
  '    const chunk = Buffer.from(value);',
  '    state.bytes += chunk.byteLength;',
  '    const remaining = Math.max(0, CAP - state.hashed);',
  '    if (remaining > 0) { const retained = chunk.subarray(0, remaining); state.hash.update(retained); state.hashed += retained.byteLength; }',
  '    state.tail = Buffer.concat([state.tail, chunk]).subarray(-TAIL);',
  '    if (state.bytes > CAP && !state.truncated) { state.truncated = true; child.kill(9); }',
  '  }',
  '};',
  'const run = async (label, argv) => {',
  '  const child = Bun.spawn(argv, { cwd: "/workspace", env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });',
  '  const stdout = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const stderr = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const exitPromise = child.exited;',
  '  await Promise.all([collect(child.stdout, stdout, child), collect(child.stderr, stderr, child)]);',
  '  const exitCode = await exitPromise;',
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
  '  await execute("typecheck", ["bun", "run", "typecheck"]);',
  '  await execute("diff-check", ["git", "diff", "--check", `${baseSha}..${expectedHead}`]);',
  `  await execute("focused-tests", ${JSON.stringify([
    'bun', 'test', '--timeout', '180000', ...TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS_V1
  ])});`,
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

export const CodexDevelopmentHostedSutCapabilityAssertionV1 = [
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
    ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeBinaries.map((entry) => path.posix.basename(entry)),
    'sh'
  ].sort()))};`,
  'const actualUsrBin = fs.readdirSync("/usr/bin").sort();',
  'if (JSON.stringify(actualUsrBin) !== JSON.stringify(expectedUsrBin)) fail("runtime-binary-closure");',
  'if (JSON.stringify(fs.readdirSync("/tool/bin").sort()) !== JSON.stringify(["bun", "node"])) fail("runtime-tool-aliases");',
  'if (!fs.statSync("/usr/lib/git-core").isDirectory()) fail("git-runtime-closure");',
  'for (const descriptor of fs.readdirSync("/proc/self/fd")) { try { const target = fs.readlinkSync(`/proc/self/fd/${descriptor}`); if (/\\/(?:actions-runner|home\\/runner|runner\\/_work|run|var\\/run|workspace)|\\.oldroot|prepared-candidate\\.tar|dependencies\\.tar/u.test(target)) fail(`inherited-fd:${descriptor}`); } catch {} }',
  'const cgroup = JSON.parse(fs.readFileSync("/capability/cgroup.json", "utf8"));',
  'if (cgroup.memoryMax !== "4294967296" || cgroup.pidsMax !== "256" || cgroup.cpuMax !== "200000 100000") fail("cgroup-limits");',
  'const softLimit = (name) => execFileSync("/usr/bin/prlimit", ["--pid", String(process.pid), `--${name}`, "--noheadings", "--output", "SOFT"], { encoding: "utf8" }).trim();',
  `if (softLimit("cpu") !== "${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.perProcessCpuSeconds}" || softLimit("as") !== "4294967296" || softLimit("fsize") !== "268435456" || softLimit("nofile") !== "1024" || softLimit("nproc") !== "256") fail("prlimit-limits");`,
  'let connected = false;',
  'try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(200) }); connected = true; } catch {}',
  'if (connected) fail("network-egress");',
  'const descendant = spawn("/usr/bin/sleep", ["300"], { detached: true, stdio: "ignore" });',
  'descendant.unref();',
  `process.stdout.write("${CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER_V1}\\n");`,
  '})().catch((error) => { console.error(error); process.exitCode = 1; });'
].join('');

const HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT_V1 = [
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.processes} -- /usr/bin/env -i PATH=/tool/bin:/usr/bin:/bin HOME=/home/sut TMPDIR=/tmp LANG=C /tool/bin/bun -e ${shellSingleQuoteV1(CodexDevelopmentHostedSutCapabilityAssertionV1)}`
].join('\n');

const HOSTED_SUT_CAPABILITY_SCRIPT_V1 = [
  'unit_name="$1"',
  'bun_host="$2"',
  'export SEC_HOST_SANDBOX_SENTINEL=must-not-cross-boundary',
  'touch /tmp/sec-host-sentinel',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rmdir -- "$root" >/dev/null 2>&1 || true; rm -f -- /tmp/sec-host-sentinel\u0027 EXIT',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=268435456 tmpfs "$root"',
  'mkdir -p "$root/tool/bin" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/capability"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE_V2,
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
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid} "$root/home/sut" "$root/tmp" "$root/workspace"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuoteV1(HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT_V1)} sec-hosted-capability-root`
].join('\n');

const HOSTED_SUT_TEARDOWN_SCRIPT_V1 = [
  'unit_name="$1"',
  'root="/tmp/$unit_name"',
  'if [ -e "$root" ]; then [ -d "$root" ] && [ ! -L "$root" ]; rmdir -- "$root"; fi',
  '[ ! -e "$root" ]',
  'rm -f -- /tmp/sec-host-sentinel',
  `printf \u0027${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:direct-process-closed\\n\u0027`
].join('\n');

function hostedSutSandboxUnitNameV1(actionKey: VerificationActionKeyDigest, nonce: string): string {
  if (!/^[A-Za-z0-9_.-]{1,32}$/u.test(nonce)) {
    throw new Error('Hosted SUT sandbox unit nonce is invalid.');
  }
  return `sec-sut-${actionKey.slice('sha256:'.length, 'sha256:'.length + 16)}-${nonce}`;
}

function hostedSutSandboxOperationsV1(
  phase: CodexDevelopmentHostedSutSandboxCommandPlanV1['phase']
): readonly CodexDevelopmentHostedSutSandboxOperationV1[] {
  if (phase === 'teardown') {
    return Object.freeze([{
      kind: 'exact-residue-cleanup',
      rootKind: 'sandbox-unit',
      parentPath: '/tmp',
      targetIdentity: 'unit-name-bound',
      noFollow: true,
      absenceReadback: true,
      trigger: 'explicit-readback'
    }] as const);
  }
  const operations: CodexDevelopmentHostedSutSandboxOperationV1[] = [
    Object.freeze({
      kind: 'namespace',
      namespaces: Object.freeze(['mount', 'pid', 'network'] as const),
      killChildOnSupervisorExit: true
    }),
    Object.freeze({
      kind: 'runtime-copy-closure',
      policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
      hostDirectoryBindAllowed: false
    }),
    Object.freeze({
      kind: 'ephemeral-filesystems',
      root: 'tmpfs-chroot',
      workspace: 'tmpfs',
      hostSocketExposure: false
    })
  ];
  if (phase === 'execute' || phase === 'bootstrap-execute') {
    operations.push(Object.freeze({
      kind: 'retained-input-bind',
      role: 'candidate',
      childDescriptor: 3,
      childPath: HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH_V1,
      targetPath: '/authenticated-input/prepared-candidate.tar',
      readOnly: true,
      mountFlags: Object.freeze(['bind', 'ro', 'nosuid', 'nodev', 'noexec'] as const)
    }));
    if (phase === 'bootstrap-execute') {
      operations.push(Object.freeze({
        kind: 'retained-input-bind',
        role: 'dependency',
        childDescriptor: 4,
        childPath: HOSTED_SUT_RETAINED_DEPENDENCY_ARCHIVE_CHILD_PATH_V1,
        targetPath: '/authenticated-input/dependencies.tar',
        readOnly: true,
        mountFlags: Object.freeze(['bind', 'ro', 'nosuid', 'nodev', 'noexec'] as const)
      }));
    }
  }
  operations.push(
    Object.freeze({
      kind: 'privilege-drop',
      uid: 65532,
      gid: 65532,
      noNewPrivileges: true,
      capabilityBoundingSet: 'empty'
    }),
    Object.freeze({
      kind: 'bounded-runtime-exec',
      runtime: 'bun',
      environment: 'empty-then-allowlist'
    }),
    Object.freeze({
      kind: 'exact-residue-cleanup',
      rootKind: 'sandbox-unit',
      parentPath: '/tmp',
      targetIdentity: 'unit-name-bound',
      noFollow: true,
      absenceReadback: true,
      trigger: 'finally'
    })
  );
  return Object.freeze(operations);
}

function hostedSutSandboxRendererV1(
  phase: CodexDevelopmentHostedSutSandboxCommandPlanV1['phase']
): Readonly<{
  command: '/usr/bin/unshare' | '/usr/bin/bash';
  prefix: readonly string[];
  script: string;
  label: string;
}> {
  if (phase === 'teardown') {
    return Object.freeze({
      command: '/usr/bin/bash',
      prefix: Object.freeze(['-ceu']),
      script: HOSTED_SUT_TEARDOWN_SCRIPT_V1,
      label: 'sec-hosted-teardown'
    });
  }
  return Object.freeze({
    command: '/usr/bin/unshare',
    prefix: Object.freeze([
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net', '/usr/bin/bash', '-ceu'
    ]),
    script: phase === 'capability-self-test'
      ? HOSTED_SUT_CAPABILITY_SCRIPT_V1
      : hostedSutNamespaceScriptV1(phase === 'bootstrap-execute'),
    label: phase === 'capability-self-test' ? 'sec-hosted-capability' : 'sec-hosted-sut'
  });
}

function hostedSutSandboxRendererBindingDigestV1(
  phase: CodexDevelopmentHostedSutSandboxCommandPlanV1['phase'],
  operations: readonly CodexDevelopmentHostedSutSandboxOperationV1[]
): VerificationActionKeyDigest {
  const renderer = hostedSutSandboxRendererV1(phase);
  return ciActionDigest(Object.freeze({
    schema: 'sec-hosted-sut-operation-renderer-binding-v1',
    phase,
    operations,
    renderer
  }));
}

function finalizeHostedSutSandboxCommandPlanV1(input: Readonly<{
  phase: CodexDevelopmentHostedSutSandboxCommandPlanV1['phase'];
  command: CodexDevelopmentHostedSutSandboxCommandPlanV1['command'];
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
  const operations = hostedSutSandboxOperationsV1(input.phase);
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA_V1,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
    phase: input.phase,
    unitName: input.unitName,
    command: input.command,
    argv: Object.freeze([...input.argv]),
    operations,
    candidateEnvironmentNames,
    executionAuthorizationDigest: input.executionAuthorizationDigest,
    physicalCommandProjectionDigest: input.physicalCommandProjectionDigest,
    rendererBindingDigest: hostedSutSandboxRendererBindingDigestV1(input.phase, operations)
  });
  return Object.freeze({ ...withoutDigest, planDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentAssertHostedSutSandboxCommandPlanV1(
  plan: CodexDevelopmentHostedSutSandboxCommandPlanV1
): void {
  const value = exactObject(plan, [
    'schema', 'policyDigest', 'phase', 'unitName', 'command', 'argv', 'operations',
    'candidateEnvironmentNames', 'executionAuthorizationDigest',
    'physicalCommandProjectionDigest', 'rendererBindingDigest', 'planDigest'
  ], 'Hosted SUT sandbox command plan V1');
  const phase = String(value.phase);
  const commandMatchesPhase = phase === 'teardown'
    ? value.command === '/usr/bin/bash'
    : value.command === '/usr/bin/unshare';
  if (value.schema !== CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA_V1 ||
      value.policyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1 ||
      !commandMatchesPhase ||
      !['capability-self-test', 'execute', 'bootstrap-execute', 'teardown'].includes(phase) ||
      typeof value.unitName !== 'string' ||
      !/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(value.unitName) ||
      !Array.isArray(value.argv) || value.argv.some((entry) => typeof entry !== 'string') ||
      !Array.isArray(value.operations) ||
      !Array.isArray(value.candidateEnvironmentNames) ||
      value.candidateEnvironmentNames.some((entry) => typeof entry !== 'string') ||
      (value.executionAuthorizationDigest !== null &&
        (typeof value.executionAuthorizationDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.executionAuthorizationDigest))) ||
      (value.physicalCommandProjectionDigest !== null &&
        (typeof value.physicalCommandProjectionDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.physicalCommandProjectionDigest))) ||
      typeof value.rendererBindingDigest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.rendererBindingDigest) ||
      typeof value.planDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.planDigest)) {
    throw new Error('Hosted SUT sandbox command plan identity is invalid.');
  }
  const { planDigest, ...withoutDigest } = value;
  if (planDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted SUT sandbox command plan digest mismatch.');
  }
  if (encodeVerificationActionDataV2(value.operations) !==
      encodeVerificationActionDataV2(hostedSutSandboxOperationsV1(phase as CodexDevelopmentHostedSutSandboxCommandPlanV1['phase']))) {
    throw new Error('Hosted SUT sandbox structured operation graph differs from its phase policy.');
  }
  const canonicalPhase = phase as CodexDevelopmentHostedSutSandboxCommandPlanV1['phase'];
  const renderer = hostedSutSandboxRendererV1(canonicalPhase);
  const prefix = value.argv.slice(0, renderer.prefix.length);
  const scriptIndex = renderer.prefix.length;
  if (value.command !== renderer.command ||
      encodeVerificationActionDataV2(prefix) !== encodeVerificationActionDataV2(renderer.prefix) ||
      value.argv[scriptIndex] !== renderer.script || value.argv[scriptIndex + 1] !== renderer.label ||
      value.rendererBindingDigest !== hostedSutSandboxRendererBindingDigestV1(
        canonicalPhase,
        value.operations as CodexDevelopmentHostedSutSandboxOperationV1[]
      )) {
    throw new Error('Hosted SUT sandbox transport is not the canonical typed-operation renderer projection.');
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
    const encoded = encodeVerificationActionDataV2(value.argv);
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

export function CodexDevelopmentBuildHostedSutSandboxCommandPlanV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  normalizedArgv: readonly string[];
  candidateEnvironment: NodeJS.ProcessEnv;
  executionAuthorization: CodexDevelopmentHostedSutExecutionAuthorizationV1;
}>): CodexDevelopmentHostedSutSandboxCommandPlanV1 {
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
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: names,
    executionAuthorizationDigest: authorization.authorizationDigest,
    physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', hostedSutNamespaceScriptV1(false), 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH_V1, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`), ...input.normalizedArgv
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlanV1(plan);
  return plan;
}

export function CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlanV1(input: Readonly<{
  bootstrapDigest: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  dependencyArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  candidateEnvironment: NodeJS.ProcessEnv;
  unitNonce: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlanV1 {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.bootstrapDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.dependencyArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) ||
      !/^[0-9a-f]{40}$/u.test(input.baseSha) || !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Trusted bootstrap SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const unitName = hostedSutSandboxUnitNameV1(input.bootstrapDigest, input.unitNonce);
  const plan = finalizeHostedSutSandboxCommandPlanV1({
    phase: 'bootstrap-execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: environment.map(([name]) => name),
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', hostedSutNamespaceScriptV1(true), 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH_V1, input.candidateArchiveDigest,
      HOSTED_SUT_RETAINED_DEPENDENCY_ARCHIVE_CHILD_PATH_V1, input.dependencyArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`),
      'bun', '-e', CodexDevelopmentTrustedBootstrapSutHarnessV1
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
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: input.executionAuthorization?.authorizationDigest ?? null,
    physicalCommandProjectionDigest: input.executionAuthorization?.physicalCommand.projectionDigest ?? null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_CAPABILITY_SCRIPT_V1, 'sec-hosted-capability',
      unitName, input.bunExecutable
    ]
  });
}

function hostedSutTeardownCommandPlanV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  unitName: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlanV1 {
  return finalizeHostedSutSandboxCommandPlanV1({
    phase: 'teardown',
    command: '/usr/bin/bash',
    unitName: input.unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '-ceu', HOSTED_SUT_TEARDOWN_SCRIPT_V1, 'sec-hosted-teardown', input.unitName
    ]
  });
}

function defaultHostedSutSandboxProcessV1(
  plan: CodexDevelopmentHostedSutSandboxCommandPlanV1,
  retainedArchive?: CodexDevelopmentRetainedHostedSutArchiveV1,
  retainedDependencyArchive?: CodexDevelopmentRetainedHostedSutArchiveV1
): Promise<CodexDevelopmentHostedSutSandboxProcessObservationV1> {
  const consumesArchive = plan.phase === 'execute' || plan.phase === 'bootstrap-execute';
  if (consumesArchive !== (retainedArchive !== undefined)) {
    throw new Error('Hosted SUT process has a missing or extraneous retained archive descriptor.');
  }
  const consumesDependencyArchive = plan.phase === 'bootstrap-execute';
  if (consumesDependencyArchive !== (retainedDependencyArchive !== undefined)) {
    throw new Error('Trusted bootstrap SUT process has a missing or extraneous dependency archive descriptor.');
  }
  if (retainedArchive !== undefined) {
    assertRetainedHostedSutArchiveV1(retainedArchive);
    if (plan.argv.filter((entry) => entry === HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH_V1).length !== 1 ||
        plan.argv.filter((entry) => entry === retainedArchive.archiveDigest).length !== 1) {
      throw new Error('Hosted SUT process plan differs from its retained archive binding.');
    }
  }
  if (retainedDependencyArchive !== undefined) {
    assertRetainedHostedSutArchiveV1(retainedDependencyArchive);
    if (plan.argv.filter((entry) => entry === HOSTED_SUT_RETAINED_DEPENDENCY_ARCHIVE_CHILD_PATH_V1).length !== 1 ||
        plan.argv.filter((entry) => entry === retainedDependencyArchive.archiveDigest).length !== 1) {
      throw new Error('Trusted bootstrap SUT process plan differs from its retained dependency archive binding.');
    }
  }
  const outputByteLimit = CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1;
  const tailByteLimit = 64 * 1024;
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.argv, {
      cwd: process.cwd(),
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      stdio: retainedArchive === undefined
        ? ['ignore', 'pipe', 'pipe']
        : retainedDependencyArchive === undefined
          ? ['ignore', 'pipe', 'pipe', retainedArchive.fileDescriptor]
          : ['ignore', 'pipe', 'pipe', retainedArchive.fileDescriptor,
              retainedDependencyArchive.fileDescriptor],
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
        termination: wallTimedOut ? 'timeout' as const
          : outputTruncated ? 'cancelled' as const
            : 'completed' as const,
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
    }, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.wallSeconds * 1_000);
    wallTimer.unref();
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
    commandStarted: false,
    termination: 'transport-failed'
  });
}

const TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES_V1 = Object.freeze([
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

async function trustedBootstrapBoundRepositoryAuditV1(input: Readonly<{
  candidateRoot: string;
  baseSha: string;
  headSha: string;
  treeSha: string;
  manifestPath: string;
}>): Promise<CodexDevelopmentVerificationGateEvidenceV4> {
  const baseTreeSha = CodexDevelopmentDefaultGitRevisionV1(input.candidateRoot, `${input.baseSha}^{tree}`);
  if (baseTreeSha === null) throw new Error('Trusted bootstrap semantic audit base tree is unavailable.');
  const fileDigest = (repositoryPath: string): VerificationActionKeyDigest => {
    const filePath = path.resolve(input.candidateRoot, ...repositoryPath.split('/'));
    return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
  };
  const executionEnvironment = createCiVerificationLocalExecutionEnvironmentV2({
    os: process.platform,
    arch: process.arch,
    bunVersion: Bun.version
  });
  const candidate: CiVerificationActionCandidateV1 = {
    baseSha: input.baseSha,
    baseTreeSha,
    headSha: input.headSha,
    headTreeSha: input.treeSha,
    manifestPath: input.manifestPath,
    manifestDigest: fileDigest(input.manifestPath),
    scopeAuthorizationRevision: ciActionDigest({
      schema: 'sec-trusted-bootstrap-repository-audit-scope-v1',
      headSha: input.headSha,
      treeSha: input.treeSha,
      manifestPath: input.manifestPath
    }),
    profile: 'quick',
    toolchainRevision: executionEnvironment.toolchainRevision,
    providerRevision: executionEnvironment.executionEnvironmentRevision,
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    requiredBlobs: CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2.map((repositoryPath) => ({
      path: repositoryPath,
      digest: fileDigest(repositoryPath)
    }))
  };
  const gate: CiVerificationProducerGateV1 = {
    id: 'repository-audit',
    phase: 'quick',
    argv: [
      'bun',
      'scripts/codex/repository-audit.ts',
      '--inventory-only',
      '--default-ref',
      input.baseSha
    ],
    runtime: 'bun',
    environment: {},
    coveredScopeIds: ['repository-semantic-assurance']
  };
  const closure = buildCiVerificationActionPlanClosureV1({ candidate, gates: [gate] });
  const execution = await CodexDevelopmentExecuteCiActionClosureV1({
    runtimeStateRepositoryRoot: input.candidateRoot,
    staticAuthorityRepositoryRoot: input.candidateRoot,
    physicalExecutionRepositoryRoot: input.candidateRoot,
    actionPlan: closure,
    gates: [{
      gate,
      env: CodexDevelopmentCandidateProcessEnvironmentV2({}, {
        SEC_REPOSITORY_AUDIT_DEFAULT_REF: input.baseSha,
        SEC_WORK_PACKAGE_MANIFEST_PATH: input.manifestPath
      })
    }],
    headSha: input.headSha,
    now: () => new Date()
  });
  const evidence = execution.gates[0];
  if (evidence === undefined || execution.failed || evidence.result.status !== 'passed') {
    throw new Error(
      `Trusted bootstrap bound repository audit Action failed: ${JSON.stringify({
        actionPlanDigest: execution.actionPlan.actionPlanDigest,
        failed: execution.failed,
        status: evidence?.result.status ?? 'missing-evidence',
        reasonCode: evidence?.result.reasonCode ?? null,
        diagnostic: evidence?.result.diagnostic ?? null
      })}`
    );
  }
  return evidence;
}

export async function CodexDevelopmentExecuteTrustedBootstrapSutV1(input: Readonly<{
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
  const preCapabilityActionKey = ciActionDigest(Object.freeze({
    schema: 'sec-trusted-bootstrap-sut-pre-capability-v1',
    baseSha: input.baseSha,
    headSha: input.headSha,
    treeSha: input.treeSha,
    manifestPath: input.manifestPath,
    sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1
  }));
  const preCapability = await CodexDevelopmentProbeHostedSutSandboxCapabilityV1({
    actionKey: preCapabilityActionKey
  });
  if (preCapability.state !== 'supported') {
    throw new Error(
      `trusted-bootstrap-provider-pre-admission-${preCapability.state}: ${
        preCapability.diagnostic ?? 'sandbox capability is unavailable'}`.slice(0, 2048)
    );
  }
  const outputDirectory = path.resolve(input.outputDirectory);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length !== 0) {
    throw new Error('Trusted bootstrap SUT evidence root must begin empty.');
  }
  mkdirSync(outputDirectory, { recursive: true });
  const hostRepositoryAudit = await trustedBootstrapBoundRepositoryAuditV1({
    candidateRoot: input.candidateRoot,
    baseSha: input.baseSha,
    headSha: input.headSha,
    treeSha: input.treeSha,
    manifestPath: input.manifestPath
  });
  const transportDirectory = path.resolve(outputDirectory, '.transport');
  mkdirSync(transportDirectory, { recursive: false });
  const transportGeneration = inspectNoFollowDirectoryChainV1(
    transportDirectory,
    'Trusted bootstrap transport generation'
  );
  let prepared: CodexDevelopmentPreparedTrustedBootstrapSutInputsV1 | null = null;
  let retainedArchive: CodexDevelopmentRetainedHostedSutArchiveV1 | null = null;
  let retainedDependencyArchive: CodexDevelopmentRetainedHostedSutArchiveV1 | null = null;
  let dependencyCacheConsumer: Readonly<{
    lifecycle: EnvironmentDependencyCacheLifecycleV2;
    consumerId: string;
    acquireCredentialDigest: `sha256:${string}`;
  }> | null = null;
  try {
    prepared = await CodexDevelopmentPrepareTrustedBootstrapSutInputsV1({
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
      environmentDependencyClosure: prepared.environmentDependencyClosure,
      dependencyCacheIdentity: prepared.dependencyCacheIdentity,
      dependencyCacheHandleDigest: prepared.dependencyCacheHandle.handleDigest,
      dependencyArchiveDigest: prepared.dependencyArchiveDigest,
      preCapabilityPlanDigest: preCapability.commandPlanDigest,
      preCapabilityOutputDigest: preCapability.outputDigest,
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1
    }));
    const candidateEnvironment = CodexDevelopmentCandidateProcessEnvironmentV2({}, {
      SEC_BOOTSTRAP_BASE: input.baseSha,
      SEC_BOOTSTRAP_HEAD: input.headSha,
      SEC_BOOTSTRAP_TREE: input.treeSha,
      SEC_CHANGED_BASE: input.baseSha,
      SEC_AFFECTED_TESTS_BASE: input.baseSha,
      SEC_REPOSITORY_AUDIT_DEFAULT_REF: input.baseSha,
      SEC_WORK_PACKAGE_MANIFEST_PATH: input.manifestPath
    });
    const capability = await CodexDevelopmentProbeHostedSutSandboxCapabilityV1({
      actionKey: bootstrapDigest
    });
    let commandPlan: CodexDevelopmentHostedSutSandboxCommandPlanV1 | null = null;
    let execution = syntheticHostedSutSandboxProcessObservationV1(
      1, capability.diagnostic ?? `sandbox-capability:${capability.state}`
    );
    let teardown = syntheticHostedSutSandboxProcessObservationV1(1, 'sandbox-not-started');
    let retainedArchiveStable = false;
    if (capability.state === 'supported') {
      const lifecycle = await openEnvironmentDependencyCacheLifecycleV2({
        repository: trustedBootstrapRepositoryIdentityV1(),
        repositoryRoot: input.baseRoot,
        identity: prepared.dependencyCacheIdentity,
        providerRevision: prepared.environmentDependencyClosure.providerRevision,
        platform: prepared.environmentDependencyClosure.platform
      });
      lifecycle.recoverDeadConsumers();
      const consumerId = `trusted-bootstrap:${bootstrapDigest}`;
      const acquired = lifecycle.acquire({ consumerId });
      dependencyCacheConsumer = Object.freeze({
        lifecycle,
        consumerId,
        acquireCredentialDigest: acquired.handle.acquireCredentialDigest!
      });
      retainedArchive = retainHostedSutArchiveV1(
        prepared.preparedCandidateArchive,
        prepared.archiveDigest
      );
      retainedDependencyArchive = retainHostedSutArchiveV1(
        prepared.dependencyArchive,
        prepared.dependencyArchiveDigest
      );
      commandPlan = CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlanV1({
        bootstrapDigest,
        candidateArchiveDigest: retainedArchive.archiveDigest,
        dependencyArchiveDigest: retainedDependencyArchive.archiveDigest,
        bunExecutable: realpathSync.native(process.execPath),
        baseSha: input.baseSha,
        headSha: input.headSha,
        candidateEnvironment,
        unitNonce: `${process.pid}-${Date.now()}`.slice(0, 32)
      });
      try {
        execution = await defaultHostedSutSandboxProcessV1(
          commandPlan, retainedArchive, retainedDependencyArchive
        );
      } finally {
        try {
          teardown = await defaultHostedSutSandboxProcessV1(hostedSutTeardownCommandPlanV1({
            actionKey: bootstrapDigest,
            unitName: commandPlan.unitName
          }));
        } finally {
          try {
            retainedArchiveStable =
              assertRetainedHostedSutArchiveV1(retainedArchive) === prepared.archiveDigest;
            const retainedDependencyArchiveStable =
              assertRetainedHostedSutArchiveV1(retainedDependencyArchive!) === prepared.dependencyArchiveDigest;
            retainedArchiveStable = retainedArchiveStable && retainedDependencyArchiveStable;
          } finally {
            closeSync(retainedArchive.fileDescriptor);
            retainedArchive = null;
            closeSync(retainedDependencyArchive!.fileDescriptor);
            retainedDependencyArchive = null;
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
    resultByLabel.set('repository-audit', {
      label: 'repository-audit',
      status: hostRepositoryAudit.result.status,
      actionKey: hostRepositoryAudit.action.actionKey,
      evidenceDigest: CodexDevelopmentVerificationDigest(hostRepositoryAudit),
      reasonCode: hostRepositoryAudit.result.reasonCode,
      evidenceRefs: hostRepositoryAudit.result.evidenceRefs
    });
    for (const [fileName, label] of TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES_V1) {
      writeHostedActionJson(path.resolve(outputDirectory, fileName), Object.freeze({
        schema: 'sec-trusted-bootstrap-sandbox-step-observation-v1',
        bootstrapDigest,
        sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
        label,
        observation: resultByLabel.get(label) ?? null
      }));
    }
    const sumsSource = `${TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES_V1.map(([fileName]) =>
      `${createHash('sha256').update(readFileSync(path.resolve(outputDirectory, fileName))).digest('hex')}  ${fileName}`
    ).join('\n')}\n`;
    writeFileSync(path.resolve(outputDirectory, 'SHA256SUMS'), sumsSource, { encoding: 'utf8', flag: 'wx' });
    const residuePassed = teardown.commandStarted && teardown.code === 0 &&
      teardown.failureTail.includes(`${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:direct-process-closed`);
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
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
      commandPlanDigest: commandPlan?.planDigest ?? null,
      archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      dependencyArchiveDigest: prepared.dependencyArchiveDigest,
      dependencyCacheIdentityDigest: prepared.dependencyCacheIdentity.identityDigest,
      dependencyCacheHandleDigest: prepared.dependencyCacheHandle.handleDigest,
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
    if (retainedDependencyArchive !== null) closeSync(retainedDependencyArchive.fileDescriptor);
    if (dependencyCacheConsumer !== null) {
      dependencyCacheConsumer.lifecycle.release({
        consumerId: dependencyCacheConsumer.consumerId,
        acquireCredentialDigest: dependencyCacheConsumer.acquireCredentialDigest
      });
      dependencyCacheConsumer = null;
    }
    deleteExactOwnedDirectoryGenerationV1(
      transportGeneration,
      'Trusted bootstrap transport generation'
    );
  }
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
  sandboxRootAbsent: boolean;
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
      residueReadbackDigest: ciActionDigest('no-unshare-process'), sandboxRootAbsent: true, diagnostic
    });
  }
  const run = input.runSandboxProcess ?? defaultHostedSutSandboxProcessV1;
  const plan = hostedSutCapabilityCommandPlanV1({
    actionKey: input.actionKey,
    bunExecutable: input.bunExecutable ?? process.execPath,
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
  const selfTestPassed = observed.commandStarted && observed.termination === 'completed' && observed.code === 0 &&
    observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER_V1);
  const directProcessClosed = teardown.failureTail.includes(
    `${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:direct-process-closed`
  );
  const residuePassed = teardown.commandStarted && teardown.termination === 'completed' && teardown.code === 0 &&
    directProcessClosed && observed.commandStarted;
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
      sandboxRootAbsent: true, diagnostic: null
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
    sandboxRootAbsent: residuePassed,
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
    sandboxRootAbsent: capability.sandboxRootAbsent,
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
        supervisorExitObserved: false, killChildPolicyBound: true,
        supervisorClosed: capability.sandboxRootAbsent
      }),
      residue: Object.freeze({
        sandboxRootAbsent: capability.sandboxRootAbsent,
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
  const retainedArchive = retainHostedSutArchiveV1(
    candidateArchive,
    input.archiveInventory.archiveDigest
  );
  const preExecutionArchiveDigest = retainedArchive.archiveDigest;
  try {
  const commandPlan = CodexDevelopmentBuildHostedSutSandboxCommandPlanV1({
    actionKey,
    candidateArchiveDigest: retainedArchive.archiveDigest,
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
        physical = await runSandboxProcess(commandPlan, retainedArchive);
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
  const directProcessClosed = teardown.failureTail.includes(
    `${CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1}:direct-process-closed`
  );
  const residuePassed = teardown.commandStarted && teardown.termination === 'completed' && teardown.code === 0 &&
    directProcessClosed && processResult.commandStarted;
  let postExecutionArchiveDigest: VerificationActionKeyDigest | null = null;
  let archiveReadbackDiagnostic: string | null = null;
  try {
    postExecutionArchiveDigest = assertRetainedHostedSutArchiveV1(retainedArchive);
    if (hostedActionFileDigestV2(candidateArchive) !== retainedArchive.archiveDigest) {
      throw new Error('Hosted SUT archive pathname no longer names the retained authenticated bytes.');
    }
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
      supervisorExitObserved: processResult.termination === 'completed',
      killChildPolicyBound: true,
      supervisorClosed: processResult.termination === 'completed' && residuePassed
    }),
    residue: Object.freeze({
      sandboxRootAbsent: residuePassed,
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
  } finally {
    closeSync(retainedArchive.fileDescriptor);
  }
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
  /** Optional role split for adapters/tests whose durable state is not the exact Git authority. */
  runtimeStateRepositoryRoot?: string;
  staticAuthorityRepositoryRoot?: string;
  physicalExecutionRepositoryRoot?: string;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  changedRecords?: (baseRef: string) => CodexDevelopmentGitChangedRecordV1[] | null;
  transitionObservation?: CodexDevelopmentTestImpactTransitionObservationV1;
  readGitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobBytesV1 | null;
  /** Provider-issued Effect/Evidence authority. Required outside test seams. */
  effectProvider?: VerificationActionEffectProviderV1;
  writeEvidence?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV2) => void;
  writeEvidenceV4?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV4) => void;
  actionRunner?: VerificationActionRunnerV2;
  readExactGitBlob?: typeof CodexDevelopmentReadExactGitBlobV1;
};

export interface CodexDevelopmentCiActionExecutionV1 {
  readonly actionPlan: CiVerificationActionPlanClosureV1;
  readonly gates: readonly CodexDevelopmentVerificationGateEvidenceV4[];
  readonly failed: boolean;
}

export type CodexDevelopmentCiPhysicalExecutionBindingV1 = Readonly<{
  canonicalRoot: string;
  headSha: string;
  headTreeSha: string;
  trackedClean: true;
}>;

/**
 * Physical cwd admission is independent from static Git-object authority.
 * It is observed immediately before and after a fresh Effect; callers cannot
 * claim the binding with DTO fields.
 */
export function CodexDevelopmentObserveCiPhysicalExecutionBindingV1(
  repositoryRoot: string
): CodexDevelopmentCiPhysicalExecutionBindingV1 {
  const canonicalRoot = realpathSync.native(path.resolve(repositoryRoot));
  const headSha = CodexDevelopmentDefaultGitRevisionV1(canonicalRoot, 'HEAD');
  const headTreeSha = CodexDevelopmentDefaultGitRevisionV1(canonicalRoot, 'HEAD^{tree}');
  if (headSha === null || headTreeSha === null ||
      !CodexDevelopmentDefaultTrackedTreeIsCleanV1(canonicalRoot)) {
    throw new Error('physical-execution-binding-unresolved: cwd must be one clean exact Git worktree');
  }
  return Object.freeze({ canonicalRoot, headSha, headTreeSha, trackedClean: true });
}

function assertCiPhysicalExecutionBindingV1(
  repositoryRoot: string,
  expected: Readonly<{ headSha: string; headTreeSha: string }>
): CodexDevelopmentCiPhysicalExecutionBindingV1 {
  const binding = CodexDevelopmentObserveCiPhysicalExecutionBindingV1(repositoryRoot);
  if (binding.headSha !== expected.headSha || binding.headTreeSha !== expected.headTreeSha) {
    throw new Error('physical-execution-binding-mismatch: cwd does not match the authorized Action head/tree');
  }
  return binding;
}

export async function CodexDevelopmentExecuteCiActionClosureV1(options: {
  /** Durable Runtime State authority; it is not a source-code or process cwd claim. */
  readonly runtimeStateRepositoryRoot: string;
  /** Exact Git read root from which static admission authority is produced. */
  readonly staticAuthorityRepositoryRoot: string;
  /** Physical cwd used by the bounded process provider after static admission. */
  readonly physicalExecutionRepositoryRoot: string;
  readonly actionPlan: CiVerificationActionPlanClosureV1;
  readonly gates: readonly Readonly<{
    gate: CiVerificationProducerGateV1;
    env: NodeJS.ProcessEnv;
  }>[];
  readonly headSha: string;
  readonly now: () => Date;
  readonly effectProvider?: VerificationActionEffectProviderV1;
  readonly actionRunner?: VerificationActionRunnerV2;
}): Promise<CodexDevelopmentCiActionExecutionV1> {
  const actionPlan = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(options.actionPlan)
  );
  if (options.gates.length !== actionPlan.actions.length) {
    throw new Error('CI Action executor gate/plan cardinality mismatch.');
  }
  const runner = options.actionRunner ?? createVerificationActionRunnerV2();
  const producerActionPlanClosure = createVerificationActionPlanClosureV1({
    producer: {
      identity: 'sec-ci-verification-action-plan-closure',
      revision: actionPlan.producerRevision
    },
    plans: actionPlan.actions
  });
  const firstProviderRevision = actionPlan.actions[0]?.action.environment.providerRevision ?? 'unwired';
  if (options.effectProvider !== undefined) {
    assertCiVerificationActionEffectProviderV1(options.effectProvider, firstProviderRevision);
  }
  // The ordinary CLI owns exactly one process provider.  It resolves the
  // normalized operation and descriptor from the frozen producer closure,
  // then routes the bounded process transport through the provider factory so
  // the runner still controls start receipt, one-shot capability, Evidence,
  // terminal journal projection, observation and release.  A caller callback
  // is not an execution authority; alternate providers must arrive through
  // the explicit provider contract.
  const usesDefaultPhysicalProvider = options.effectProvider === undefined;
  if (usesDefaultPhysicalProvider) {
    const firstOperation = actionPlan.normalizedOperations[0];
    if (firstOperation === undefined || firstOperation.candidate.headSha !== options.headSha ||
        actionPlan.normalizedOperations.some((operation) =>
          operation.candidate.headSha !== firstOperation.candidate.headSha ||
          operation.candidate.headTreeSha !== firstOperation.candidate.headTreeSha)) {
      throw new Error('physical-execution-binding-mismatch: Action closure has no single exact candidate');
    }
    assertCiPhysicalExecutionBindingV1(options.physicalExecutionRepositoryRoot, {
      headSha: firstOperation.candidate.headSha,
      headTreeSha: firstOperation.candidate.headTreeSha
    });
  }
  const effectProvider = options.effectProvider ?? createVerificationActionCallbackEffectProviderV1({
    providerRevision: firstProviderRevision,
    execute: async ({ action, signal }) => {
      const index = actionPlan.actions.findIndex((entry) => entry.action.actionKey === action.actionKey);
      const descriptor = index < 0 ? undefined : options.gates[index];
      const operation = index < 0 ? undefined : actionPlan.normalizedOperations[index];
      if (descriptor === undefined || operation === undefined) {
        throw new Error('CI process provider received an Action outside the authorized closure.');
      }
      assertCiPhysicalExecutionBindingV1(options.physicalExecutionRepositoryRoot, {
        headSha: operation.candidate.headSha,
        headTreeSha: operation.candidate.headTreeSha
      });
      const startedAt = options.now();
      const processResult = await CodexDevelopmentRunGateProcessV1(options.physicalExecutionRepositoryRoot, {
        id: operation.gateId,
        argv: [...ciVerificationNormalizedOperationArgvV2(operation)],
        env: descriptor.env,
        budget: action.environment.executionBudget,
        signal
      });
      const finishedAt = options.now();
      assertCiPhysicalExecutionBindingV1(options.physicalExecutionRepositoryRoot, {
        headSha: operation.candidate.headSha,
        headTreeSha: operation.candidate.headTreeSha
      });
      return {
        terminal: createVerificationActionTerminalV2({
          status: processResult.code === 0
            ? 'passed'
            : processResult.termination === 'cancelled'
              ? 'invalidated'
              : 'failed',
          reasonCode: processResult.code === 0
            ? 'executed-success'
            : processResult.termination === 'timeout'
              ? 'timeout'
              : processResult.termination === 'cancelled'
                ? 'cancelled'
                : 'executed-failure',
          resultDigest: processResult.rawOutputDigest as VerificationActionKeyDigest
        }),
        evidenceRefs: [
          `verification-action-run:${processResult.rawOutputDigest}`,
          `verification-action-termination:${processResult.termination}`,
          `verification-action-failure-tail:${ciActionDigest(processResult.failureTail)}`
        ],
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString()
      };
    }
  });
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
    const outcome: VerificationActionRunOutcomeV2 = await runner.execute({
      runtimeStateRepositoryRoot: options.runtimeStateRepositoryRoot,
      staticAuthorityRepositoryRoot: options.staticAuthorityRepositoryRoot,
      physicalExecutionRepositoryRoot: options.physicalExecutionRepositoryRoot,
      action: plan.action,
      plan,
      actionPlanClosure: producerActionPlanClosure,
      executionDomain: 'hosted-ci',
      effectProvider
    });
    let result: VerificationGateResultV1;
    if (outcome.physicalExecution) {
      if (outcome.terminal === null || outcome.evidence === null) {
        throw new Error(
          `CI Action ${plan.action.actionKey} lost its physical terminal observation: `
          + `${outcome.disposition}; ${outcome.reason ?? 'no diagnostic'}`
        );
      }
      const started = new Date(outcome.evidence.startedAt);
      const finished = new Date(outcome.evidence.finishedAt);
      const outputDigest = outcome.evidence.terminal.resultDigest ??
        (CodexDevelopmentVerificationDigest(outcome.evidence) as VerificationActionKeyDigest);
      const exitCode = outcome.terminal.status === 'passed' ? 0 : 1;
      const settlementBlocked = outcome.disposition === 'blocked';
      const failureTail =
        settlementBlocked
          ? outcome.reason ?? 'Provider terminal settlement remains pending.'
          : (exitCode === 0 ? '' : `Provider terminal Evidence reported ${outcome.terminal.status}.`);
      result = CodexDevelopmentBuildVerificationGateResultV1({
        gateId: descriptor.gate.id,
        gateRevision: plan.action.operation.revision,
        owner: 'ci-verification-maintainer',
        requirementKey: `gate:${descriptor.gate.id}`,
        subjectRevision: options.headSha,
        inputDigest: plan.action.actionKey,
        applicability: 'required',
        status: settlementBlocked ? 'failed' : outcome.terminal.status,
        disposition: 'executed',
        reasonCode: settlementBlocked
          ? 'process-settlement-failed'
          : outcome.terminal.reasonCode,
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
          exitCode,
          outputDigest,
          failureFingerprint: settlementBlocked || exitCode !== 0 ? outputDigest : null
        },
        evidenceRefs: [...outcome.evidence.evidenceRefs],
        invalidationRules: ['ActionKey, session, scope, review, main health, or trust revision changes'],
        diagnostic: !settlementBlocked && exitCode === 0
          ? null
          : CodexDevelopmentFailureTailV1(failureTail, `${descriptor.gate.id} failed.`)
      });
    } else if (outcome.disposition === 'blocked') {
      result = CodexDevelopmentBuildVerificationGateResultV1({
        gateId: descriptor.gate.id,
        gateRevision: plan.action.operation.revision,
        owner: 'ci-verification-maintainer',
        requirementKey: `gate:${descriptor.gate.id}`,
        subjectRevision: options.headSha,
        inputDigest: plan.action.actionKey,
        applicability: 'required',
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'not-dispatched',
        requiredForClaims: [`gate:${descriptor.gate.id}`],
        supportedClaims: [`gate:${descriptor.gate.id}`],
        environment: null,
        execution: null,
        evidenceRefs: [],
        invalidationRules: ['ActionKey, session, scope, review, main health, or trust revision changes'],
        diagnostic: CodexDevelopmentFailureTailV1(
          outcome.reason ?? 'VerificationAction admission blocked before Effect.',
          `${descriptor.gate.id} was not dispatched.`
        )
      });
    } else {
      const observedEvidence = outcome.evidence;
      if (observedEvidence === null || observedEvidence.evidenceRefs.length === 0 ||
          observedEvidence.actionKey !== plan.action.actionKey) {
        throw new Error(`CI Action ${plan.action.actionKey} ${outcome.disposition} without independently readable durable Evidence.`);
      }
      const baseResult = CodexDevelopmentBuildVerificationGateResultV1({
        gateId: descriptor.gate.id,
        gateRevision: plan.action.operation.revision,
        owner: 'ci-verification-maintainer',
        requirementKey: `gate:${descriptor.gate.id}`,
        subjectRevision: options.headSha,
        inputDigest: plan.action.actionKey,
        applicability: 'required',
        status: observedEvidence.terminal.status,
        disposition: 'reused',
        reasonCode: observedEvidence.terminal.reasonCode,
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
        execution: null,
        evidenceRefs: [...observedEvidence.evidenceRefs],
        invalidationRules: ['ActionKey, session, scope, review, main health, or trust revision changes'],
        diagnostic: observedEvidence.terminal.status === 'failed'
          ? `Provider terminal Evidence reported failure for ${descriptor.gate.id}.`
          : null
      });
      result = CodexDevelopmentBuildVerificationGateResultV1({
        ...baseResult,
        disposition: 'reused',
        execution: null,
        evidenceRefs: [...observedEvidence.evidenceRefs]
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
  executionEnvironment: CiVerificationExecutionEnvironmentV2;
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
    ? CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2
    : createCiVerificationLocalExecutionEnvironmentV2({
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
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifestV1(text, manifestPath);
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
  const readGitBlob = options.readGitBlob
    ?? ((ref: string, file: string) =>
      defaultReadGitBlob(repositoryRoot, readExactGitBlob, ref, file));
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
  let actionPlan: CiVerificationActionPlanClosureV1 | null = null;
  let actionCandidate: CiVerificationActionCandidateV1 | null = null;
  let actionGates: readonly CodexDevelopmentVerificationGateEvidenceV4[] = [];
  let formalBinding: ReturnType<typeof formalVerificationBinding> = null;
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
    formalBinding = formalVerificationBinding(env);
    let rawChangedFiles: string[] | null;
    let transitionObservation: CodexDevelopmentTestImpactTransitionObservationV1 | undefined;
    let injectedChangedRecords: CodexDevelopmentGitChangedRecordV1[] | null | undefined;
    if (changedRecordResolver) {
      const changedRecords = changedRecordResolver(prBaseSha);
      injectedChangedRecords = changedRecords;
      rawChangedFiles = changedRecords === null
        ? null
        : CodexDevelopmentChangedFilesFromRecordsV1(changedRecords);
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
      const snapshot = CodexDevelopmentDefaultChangedPathsV1(repositoryRoot, prBaseSha, headSha);
      rawChangedFiles = snapshot?.files ?? null;
      transitionObservation = snapshot?.transitionObservation;
    }
    if (rawChangedFiles !== null && transitionObservation !== undefined) {
      CodexDevelopmentAssertTestImpactTransitionSelectionV1({
        baseSha: prBaseSha,
        headSha,
        changedPaths: rawChangedFiles,
        ...(injectedChangedRecords === undefined || injectedChangedRecords === null
          ? {}
          : { records: injectedChangedRecords }),
        observation: transitionObservation
      });
    }
    const plan = CodexDevelopmentBuildVerificationPlanV1(
      profile,
      rawChangedFiles,
      undefined,
      transitionObservation
    );
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

    console.log(`SEC verification contract revision: ${CI_VERIFICATION_CONTRACT_REVISION}`);
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
      ? formalBinding.executionEnvironment
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
    const producerGates: readonly CiVerificationProducerGateV1[] = steps.map(ciVerificationGateStepV1);
    const descriptors = producerGates.map((gate) => Object.freeze({
      gate,
      env: {
        ...env,
        SEC_TEST_WORKSPACE_NAMESPACE: `verification-${gate.id.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`
      }
    }));
    actionPlan = buildCiVerificationActionPlanClosureV1({ candidate, gates: producerGates });
    if (formalBinding !== null && actionPlan.actionPlanDigest !== formalBinding.actionPlanDigest) {
      throw new Error('Formal hosted Action plan digest differs from the trusted dispatcher reconstruction.');
    }
    const actionExecution = await CodexDevelopmentExecuteCiActionClosureV1({
      runtimeStateRepositoryRoot: path.resolve(options.runtimeStateRepositoryRoot ?? repositoryRoot),
      staticAuthorityRepositoryRoot: path.resolve(options.staticAuthorityRepositoryRoot ?? repositoryRoot),
      physicalExecutionRepositoryRoot: path.resolve(options.physicalExecutionRepositoryRoot ?? repositoryRoot),
      actionPlan,
      gates: descriptors,
      headSha,
      now,
      effectProvider: options.effectProvider,
      actionRunner: options.actionRunner
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
          sourceTransport: formalBinding?.mode === 'github-actions' ? 'github-actions' : 'local-dev-runner',
          workflowPath: formalBinding?.mode === 'github-actions'
            ? '.github/workflows/compiler-pr-validation.yml'
            : formalBinding?.mode === 'trusted-runtime'
              ? 'scripts/ci-verification.ts'
              : 'platform/dev-runner.ts',
          workflowRef: formalBinding?.mode === 'github-actions'
            ? (env.SEC_TRUSTED_WORKFLOW_REF ?? '')
            : `${formalBinding?.mode === 'trusted-runtime'
              ? 'scripts/ci-verification.ts'
              : 'platform/dev-runner.ts'}@${actionCandidate.baseSha}`,
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
  if (command === 'execute-trusted-bootstrap-sut') {
    const args = hostedActionCliArgs(argv, [
      '--base-root', '--candidate-root', '--output-directory', '--base-sha',
      '--head-sha', '--tree-sha', '--manifest-path'
    ]);
    const result = await CodexDevelopmentExecuteTrustedBootstrapSutV1({
      baseRoot: args.get('--base-root')!,
      candidateRoot: args.get('--candidate-root')!,
      outputDirectory: args.get('--output-directory')!,
      baseSha: args.get('--base-sha')!,
      headSha: args.get('--head-sha')!,
      treeSha: args.get('--tree-sha')!,
      manifestPath: args.get('--manifest-path')!
    });
    return JSON.stringify(result);
  }
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
