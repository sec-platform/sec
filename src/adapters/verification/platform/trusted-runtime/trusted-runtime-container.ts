import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { VerificationEvidence, VerificationGateEvidence } from '../../../../execution/verification/session.ts';
import {
  assertLinuxVerificationUnitResult,
  bindLinuxVerificationUnitSession,
  closeLinuxVerificationUnitSession,
  executeLinuxVerificationUnit,
  getLinuxVerificationUnitRecovery,
  LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
  LINUX_VERIFICATION_UNIT_RECOVERY_CONTRACT_DIGEST,
  LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID,
  LINUX_VERIFICATION_UNIT_RECOVERY_RESOURCE_CEILINGS,
  LINUX_VERIFICATION_UNIT_REQUIREMENT_ID,
  linuxVerificationUnitInvocationDigest,
  parseLinuxVerificationUnitReceipt,
  prepareLinuxVerificationUnitSession,
  recoverLinuxVerificationUnitSession,
  type LinuxVerificationUnitInvocation,
  type LinuxVerificationUnitReceipt,
  type LinuxVerificationUnitRecovery,
  type LinuxVerificationUnitResult,
  type LinuxVerificationUnitSession,
  type LinuxVerificationUnitSessionSettlement
} from '../../../runtime-state/physical/runtime/linux-verification-unit.ts';

import { CI_VERIFICATION_WORKFLOW_PATH, type CI_VERIFICATION_CONTRACT_REVISION } from '../../../../assurance/verification/contract/revision.ts';
import { CodexDevelopmentBuildVerificationGateResult, type VerificationGateResult, type VerificationResultStatus } from '../../../../assurance/verification/result/contract/result.ts';
import { throwIfNativeAborted } from '../../../../contracts/native-abort.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest,
  type OwnerTerminalJoinReceipt,
  type ProviderSettlementReceipt
} from '../../../../execution/operation/semantic.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../../execution/resource-settlement.ts';
import type { VerificationSessionHostedEnvelope } from '../../../../execution/verification/hosted.ts';
import type {
  ContainerEngineOperation,
} from '../../../providers/docker/contract/container-engine-session.ts';
import {
  parseDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../../../providers/docker/contract/daemon.ts';
import {
  assertGitCandidateBundleCurrent,
  assertGitCandidateBundleReceipt,
  closeGitCandidateBundle,
  createGitCandidateBundle,
  type GitCandidateBundle
} from '../../../providers/git-bundle/runtime.ts';
import { isolatedGitChildEnvironment } from '../../../providers/git-read/runtime/session.ts';
import { withGitHubApiReadSession } from '../../../providers/github-api/operation-session.ts';
import { observeGitHubRepositoryComment } from '../../../providers/github-api/repository-comment.ts';
import {
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
  SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH,
  SEC_LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH
} from '../../../providers/linux-verification/contract.ts';
import { observeSecLinuxVerificationNativeRuntimeInput, requireSecLinuxVerificationNativeRuntimeInput } from '../../../providers/linux-verification/materialization.ts';
import { repositoryAuditInheritedDeadline, SOURCE_PROGRAM_TRANSITION_DEADLINE_ENV } from '../../../repository/repository-audit/cli-contract.ts';
import { compileSourceProgramTransitionAdoption, parseSourceProgramTransitionAssessment, type SourceProgramTransitionAssessment } from '../../../repository/repository-audit/transition.ts';
import { adoptSourceProgramTestAuthorDecision, assertSourceProgramTestAuthorApproval, type SourceProgramTestAuthorApproval } from '../../../repository/source-program-model/test-disposition-decisions.ts';
import { acquirePhysicalMutationLease } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import { assertSameNoFollowDirectoryIdentity, inspectNoFollowDirectoryChain, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertProcessResourceSessionReceipt } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { resolveSecRuntimeStateForRepository } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import {
  createTrustedRuntimeNativeMainHealthInvocation,
  createTrustedRuntimeNativeMainHealthReceipt,
  TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS,
  type TrustedRuntimeMainHealthNativeReceipt,
  type TrustedRuntimeMainHealthReceipt
} from '../../../self-hosting/control/main-health/main-health-observation.ts';
import {
  assertCompilerDependencyReadGenerationRetirementReceipt,
  observeCompilerDependencyExecutionGenerationAuthority,
  retainCompilerDependencyReadGeneration,
  type RetainedCompilerDependencyReadGeneration
} from '../../../toolchain/dependencies/runtime.ts';
import { compilerRuntimeLayout } from '../../../toolchain/runtime/layout.ts';
import { TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH } from '../../../toolchain/typescript/canary.ts';
import { encodeVerificationActionData } from '../action/contract/action.ts';
import { ciVerificationGateStep, ciVerificationNormalizedOperationArgv, createCiVerificationLocalExecutionEnvironment, createCiVerificationNativeLocalExecutionEnvironment, parseCiSourceProgramTransitionBinding, SOURCE_PROGRAM_TRANSITION_ENTRYPOINT, SOURCE_PROGRAM_TRANSITION_GATE_ID, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE, SOURCE_PROGRAM_TRANSITION_STDOUT_BYTE_LIMIT, sourceProgramAnalysisBinding, sourceProgramTransitionGate, type CiSourceProgramTransitionBinding, type CiVerificationExecutionEnvironment } from '../action/contract/ci.ts';
import { parseTrustedRuntimeSourceProgramActionRecord, parseTrustedRuntimeSourceProgramAttemptCarrier, type TrustedRuntimeSourceProgramActionRecord } from '../ci/contract/evidence.ts';
import {
  type LocalGitHubActionsRunnerToolchainMaterialization
} from '../ci/runtime/local-github-actions-runner.ts';

const ENVIRONMENT = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
const TRUSTED_RUNTIME_CONTAINER_SCHEMA = ENVIRONMENT.trustedRuntime.imageSchema;
const TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA =
  'sec-trusted-runtime-dependency-cache-v1' as const;
const TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA =
  'sec-trusted-runtime-dependency-cache-volume-v1' as const;
const TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH =
  '/tmp/sec-hosted-dependency-home/bun-install' as const;
const TRUSTED_RUNTIME_CONTAINER_IMAGE = ENVIRONMENT.trustedRuntime.imageName;
export const TRUSTED_RUNTIME_CONTAINER_IMAGE_ID = ENVIRONMENT.trustedRuntime.imageDigest;
export const TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256 =
  ENVIRONMENT.trustedRuntime.bunArchiveDigest;
export const TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID = ENVIRONMENT.image.dockerProjectionDigest;
export const TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT:
CiVerificationExecutionEnvironment = createCiVerificationLocalExecutionEnvironment({
  os: 'linux',
  arch: 'x64',
  bunVersion: ENVIRONMENT.trustedRuntime.bunVersion
});

export interface TrustedRuntimeImageBuildPlan {
  readonly args: readonly string[];
  readonly absoluteTimeoutMs: number;
  readonly stallTimeoutMs: number;
}

function trustedRuntimeDockerfilePath(): string {
  const packageRoot = path.resolve(compilerRuntimeLayout.packageRoot);
  const dockerfile = path.resolve(
    packageRoot,
    ...SEC_LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH.split('/')
  );
  const relativeReadback = path.relative(packageRoot, dockerfile).split(path.sep).join('/');
  if (relativeReadback !== SEC_LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH) {
    fail('trusted runtime Dockerfile projection escapes the canonical package root');
  }
  return dockerfile;
}

export function createTrustedRuntimeImageBuildPlan(
  toolchain: LocalGitHubActionsRunnerToolchainMaterialization
): TrustedRuntimeImageBuildPlan {
  const dockerfile = trustedRuntimeDockerfilePath();
  if (!path.isAbsolute(toolchain.layoutPath)
      || toolchain.runtimeManifestDigest !== ENVIRONMENT.image.runtimeContentDigest
      || toolchain.dockerProjectionDigest !== ENVIRONMENT.image.dockerProjectionDigest) {
    fail('trusted runtime toolchain materialization is invalid');
  }
  const layoutUriPath = path.resolve(toolchain.layoutPath).split(path.sep).join('/');
  return Object.freeze({
    args: Object.freeze([
      'buildx', 'build', '--pull=false', '--network', 'none', '--provenance=false',
      '--build-context', `runner=oci-layout://${layoutUriPath}@${toolchain.runtimeManifestDigest}`,
      '--build-arg', `SEC_TRUSTED_RUNTIME_SCHEMA=${ENVIRONMENT.trustedRuntime.imageSchema}`,
      '--build-arg', `SEC_RUNNER_IMAGE_ID=${ENVIRONMENT.image.dockerProjectionDigest}`,
      '--build-arg', `SEC_BUN_ARCHIVE_URL=${ENVIRONMENT.trustedRuntime.bunArchiveUrl}`,
      '--build-arg', `SEC_BUN_ARCHIVE_DIGEST=${ENVIRONMENT.trustedRuntime.bunArchiveDigest}`,
      '--build-arg',
      `SEC_BUN_EXECUTABLE_DIGEST=${SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST}`,
      '--build-arg', `SEC_BUN_VERSION=${ENVIRONMENT.trustedRuntime.bunVersion}`,
      '--tag', TRUSTED_RUNTIME_CONTAINER_IMAGE,
      '--file', dockerfile,
      '--load',
      `--progress=${ENVIRONMENT.provider.progressMode}`,
      import.meta.dir
    ]),
    absoluteTimeoutMs: ENVIRONMENT.provider.timeoutsMs.projectionAbsolute,
    stallTimeoutMs: ENVIRONMENT.provider.timeoutsMs.projectionStall
  });
}

type Digest = `sha256:${string}`;

const TRUSTED_RUNTIME_MUTABLE_ROOT = '/sec-runtime' as const;
const TRUSTED_RUNTIME_CANDIDATE_BUNDLE = '/candidate.bundle' as const;
const TRUSTED_RUNTIME_TEST_TMPFS_TARGET = '/tmp' as const;
export const TRUSTED_RUNTIME_TEST_TMPFS_SPEC =
  `${TRUSTED_RUNTIME_TEST_TMPFS_TARGET}:rw,exec,nosuid,nodev,size=2g` as const;
export const TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC =
  `${TRUSTED_RUNTIME_MUTABLE_ROOT}:rw,noexec,nosuid,nodev,size=10g,mode=0711,uid=1000,gid=1000` as const;
const TRUSTED_RUNTIME_TRUSTED_TREE = `${TRUSTED_RUNTIME_MUTABLE_ROOT}/trusted`;
const TRUSTED_RUNTIME_WORKSPACE = `${TRUSTED_RUNTIME_MUTABLE_ROOT}/workspace`;
const TRUSTED_RUNTIME_OUTPUT = `${TRUSTED_RUNTIME_MUTABLE_ROOT}/output`;
const TRUSTED_RUNTIME_DEPENDENCY_PACKAGE_COMMAND = Object.freeze([
  SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH,
  'run',
  'deps:ensure'
] as const);
export const TRUSTED_RUNTIME_STATE_ENVIRONMENT = Object.freeze({
  SEC_STATE_HOME: `${TRUSTED_RUNTIME_OUTPUT}/state`,
  SEC_CACHE_HOME: `${TRUSTED_RUNTIME_OUTPUT}/cache`
});

export function createTrustedRuntimeCommandEnvironmentArgs(
  environment: Readonly<Record<string, string>>
): readonly string[] {
  for (const key of Object.keys(TRUSTED_RUNTIME_STATE_ENVIRONMENT)) {
    if (key in environment) fail(`trusted runtime command environment cannot replace ${key}`);
  }
  return Object.freeze(Object.entries({
    ...environment,
    ...TRUSTED_RUNTIME_STATE_ENVIRONMENT
  })
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, value]) => ['--env', `${name}=${value}`]));
}

export interface TrustedRuntimeContainerImageObservation {
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  readonly labels: Readonly<Record<string, string>>;
}

/** Issued only after a fresh no-candidate-execution container readback. JSON cannot restore it. */
interface SourceProgramTransitionObservationFields {
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly assessmentDigest: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly executionId: string;
  readonly producerSourceDigest: Digest;
  readonly actionKey: string;
  readonly sessionRevision: string;
  readonly payloadDigest: string | null;
  readonly approvalObservationDigest: string | null;
  readonly approvalDigest: string | null;
  readonly observationDigest: Digest;
  readonly settlementDigest: Digest;
  readonly producerExecutionEvidenceDigest: string;
}
export type TrustedRuntimeSourceProgramTransitionObservation = SourceProgramTransitionObservationFields & (
  | Readonly<{ schema?: never; origin?: never; predecessorActionOutputDigest: Digest }>
  | Readonly<{ schema: 'source-program-transition-observation-v2'; origin: 'first-qualified'; sourceActionOutputDigest: Digest }>
);
const issuedSourceProgramTransitionObservations = new WeakSet<object>();

export function assertTrustedRuntimeSourceProgramTransitionObservation(
  observation: TrustedRuntimeSourceProgramTransitionObservation
): void {
  if (!issuedSourceProgramTransitionObservations.has(observation)) {
    fail('Source Program transition requires an exact live isolated producer observation');
  }
}

/** Host acceptance binds an actual isolated producer and optional live author adoption. */
interface SourceProgramTransitionQualificationFields {
  readonly status: 'accepted';
  readonly assessmentDigest: string;
  readonly attemptId: string;
  readonly actionKey: string;
  readonly sessionRevision: string;
  readonly observationDigest: string;
  readonly approvalDigest: string | null;
  readonly auditResultDigest: string;
  readonly adoptionDigest: string;
  readonly qualificationDigest: Digest;
  readonly attemptEvidenceDigest: Digest;
}
export type SourceProgramTransitionQualification = SourceProgramTransitionQualificationFields & (
  | Readonly<{ schema?: never; origin?: never; predecessorActionOutputDigest: Digest; predecessorDisposition: 'superseded-nonterminal' }>
  | Readonly<{ schema: 'source-program-transition-qualification-v2'; origin: 'first-qualified';
      sourceActionOutputDigest: Digest; sourceActionDigest: string }>
);

/** Only this producer's retained object identity is a live handoff. */
export type TrustedRuntimeSourceProgramAction = TrustedRuntimeSourceProgramActionRecord;
const issuedSourceProgramActions = new WeakMap<object, TrustedRuntimeSourceProgramTransitionObservation>();
const sourceProgramObservationActions = new WeakMap<object, TrustedRuntimeSourceProgramAction>();

export function assertTrustedRuntimeSourceProgramAction(
  sourceAction: TrustedRuntimeSourceProgramAction,
  expected: Readonly<{ envelope?: VerificationSessionHostedEnvelope<typeof import('../ci/contract/session-request.ts').VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA> }> = {}
): void {
  const observation = issuedSourceProgramActions.get(sourceAction);
  if (observation === undefined || observation.origin !== 'first-qualified') {
    fail('Source Program Action requires its exact live isolated producer handoff');
  }
  assertTrustedRuntimeSourceProgramTransitionObservation(observation);
  parseTrustedRuntimeSourceProgramActionRecord(sourceAction);
  const attempt = transitionAttemptEvidence.get(observation);
  if (attempt === undefined || sourceAction.attemptEvidenceDigest !== attempt.evidenceDigest
      || sourceAction.observationDigest !== observation.observationDigest
      || sourceAction.outputByteDigest !== observation.sourceActionOutputDigest
      || sourceAction.gate.action.actionKey !== observation.actionKey
      || sourceAction.sessionRevision !== observation.sessionRevision
      || sourceAction.gate.result.subjectRevision !== observation.headSha) {
    fail('Source Program Action lost its exact live observation and physical attempt');
  }
  if (expected.envelope !== undefined) {
    const { session, actionPlanClosure } = expected.envelope;
    const selected = actionPlanClosure.actions.filter(({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID);
    if (selected.length !== 1 || sourceAction.sessionRevision !== session.sessionRevision
        || observation.repository !== session.repository || observation.pullRequestNumber !== session.prNumber
        || observation.baseSha !== session.baseSha || observation.headSha !== session.headSha
        || observation.headTreeSha !== session.headTreeSha
        || encodeVerificationActionData(selected[0]!.action) !== encodeVerificationActionData(sourceAction.gate.action)) {
      fail('Source Program Action belongs to another exact Session');
    }
  }
}

const issuedSourceProgramTransitionQualifications = new WeakSet<object>();
const sourceProgramQualificationRecords = new WeakMap<object, Readonly<{
  attemptEvidence: TrustedRuntimeSourceProgramAttemptEvidence;
  approval: SourceProgramTestAuthorApproval | null;
  repositoryRoot: string;
}>>();

export function qualifySourceProgramTransitionAssessment(input: Readonly<{
  assessment: SourceProgramTransitionAssessment;
  observation: TrustedRuntimeSourceProgramTransitionObservation;
  approval?: SourceProgramTestAuthorApproval;
}>): SourceProgramTransitionQualification {
  assertTrustedRuntimeSourceProgramTransitionObservation(input.observation);
  const assessment = parseSourceProgramTransitionAssessment(input.assessment);
  const observation = input.observation;
  const attemptEvidence = transitionAttemptEvidence.get(observation);
  if (attemptEvidence === undefined) fail('fresh transition attempt evidence is unavailable');
  if (observation.assessmentDigest !== assessment.assessmentDigest
      || observation.baseSha !== assessment.baseSha || observation.headSha !== assessment.headSha
      || observation.headTreeSha !== assessment.headTreeSha || assessment.runtimeSha !== observation.baseSha) {
    fail('Source Program facts are not the exact isolated producer output');
  }
  if (input.approval === undefined) {
    if (observation.payloadDigest !== null || observation.approvalDigest !== null
        || observation.approvalObservationDigest !== null) fail('live author adoption is missing');
  } else {
    assertSourceProgramTestAuthorApproval(input.approval);
    const payload = input.approval.payload;
    const sourceOnlyObservation = observation.payloadDigest === null
      && observation.approvalDigest === null && observation.approvalObservationDigest === null;
    if (payload.repository !== observation.repository || payload.pullRequestNumber !== observation.pullRequestNumber
        || payload.trustedRevision !== assessment.runtimeSha
        || payload.baseline.commitSha !== assessment.baseSha || payload.baseline.treeSha !== assessment.baseTreeSha
        || payload.current.commitSha !== assessment.headSha || payload.current.treeSha !== assessment.headTreeSha
        || !sourceOnlyObservation && (observation.payloadDigest !== payload.payloadDigest
          || observation.approvalDigest !== input.approval.approvalDigest
          || observation.approvalObservationDigest !== input.approval.providerObservationDigest)) {
      fail('author audience, source revisions or live approval differs from isolated producer binding');
    }
  }
  // This owner authenticates transport only. The repository audit owner reruns
  // the actual author assessment, supersession/reconciliation and audit decision.
  const adopted = compileSourceProgramTransitionAdoption({ assessment,
    ...(input.approval === undefined ? {} : { approval: input.approval }) });
  const sourceAction = observation.origin === 'first-qualified' ? sourceProgramObservationActions.get(observation) : undefined;
  if (observation.origin === 'first-qualified') {
    if (sourceAction === undefined) fail('first-qualified observation has no live source Action');
    assertTrustedRuntimeSourceProgramAction(sourceAction);
  }
  const canonical = Object.freeze({ ...adopted, actionKey: observation.actionKey,
    ...(observation.origin === 'first-qualified' ? {
      schema: 'source-program-transition-qualification-v2' as const, origin: 'first-qualified' as const,
      sourceActionOutputDigest: observation.sourceActionOutputDigest, sourceActionDigest: sourceAction!.sourceActionDigest
    } : {
      predecessorActionOutputDigest: observation.predecessorActionOutputDigest,
      predecessorDisposition: 'superseded-nonterminal' as const
    }), attemptId: observation.executionId,
    attemptEvidenceDigest: attemptEvidence.evidenceDigest,
    sessionRevision: observation.sessionRevision, observationDigest: observation.observationDigest });
  const qualification = Object.freeze({ ...canonical, qualificationDigest: digestValue(canonical) });
  issuedSourceProgramTransitionQualifications.add(qualification);
  const repositoryRoot = transitionAttemptRoots.get(observation);
  if (repositoryRoot === undefined) fail('fresh transition has no admitted runtime root');
  sourceProgramQualificationRecords.set(qualification, Object.freeze({ attemptEvidence, approval: input.approval ?? null, repositoryRoot }));
  return qualification;
}

export function assertSourceProgramTransitionQualification(
  value: SourceProgramTransitionQualification,
  completion?: VerificationGateEvidence<VerificationGateResult>
): void {
  if (!issuedSourceProgramTransitionQualifications.has(value)) {
    fail('Source Program acceptance requires a live isolated host qualification');
  }
  const record = sourceProgramQualificationRecords.get(value);
  if (record === undefined) fail('Source Program acceptance lost its live producer record');
  assertTrustedRuntimeSourceProgramTransitionObservation(record.attemptEvidence.observation);
  if (value.origin === 'first-qualified') {
    const sourceAction = sourceProgramObservationActions.get(record.attemptEvidence.observation);
    if (sourceAction === undefined || sourceAction.sourceActionDigest !== value.sourceActionDigest) {
      fail('Source Program acceptance lost its live first-qualified Action');
    }
    assertTrustedRuntimeSourceProgramAction(sourceAction);
    if (completion !== undefined && encodeVerificationActionData(completion) !== encodeVerificationActionData(sourceAction.gate)) {
      fail('Source Program acceptance differs from the exact first-qualified Action output');
    }
  }
}

/** Preserve the actual fresh producer history; this does not deserialize authority. */
export function sourceProgramTransitionEvidenceForQualification(
  qualification: SourceProgramTransitionQualification
): TrustedRuntimeSourceProgramAttemptEvidence {
  assertSourceProgramTransitionQualification(qualification);
  const record = sourceProgramQualificationRecords.get(qualification);
  if (record === undefined || record.attemptEvidence.evidenceDigest !== qualification.attemptEvidenceDigest) {
    fail('fresh qualified attempt evidence is unavailable');
  }
  return record.attemptEvidence;
}

/** Called by the effect owner immediately before publication, never by a JSON decoder. */
export async function reobserveSourceProgramTransitionQualificationForEffect(
  qualification: SourceProgramTransitionQualification
): Promise<void> {
  assertSourceProgramTransitionQualification(qualification);
  const record = sourceProgramQualificationRecords.get(qualification);
  if (record === undefined) fail('source transition effect requires its live producer record');
  if (record.approval === null) return;
  const prior = record.approval;
  const current = await withGitHubApiReadSession({ repositoryRoot: record.repositoryRoot,
    repository: prior.payload.repository,
    operation: async capability => adoptSourceProgramTestAuthorDecision(await observeGitHubRepositoryComment({
      capability, issueNumber: prior.payload.pullRequestNumber, commentId: prior.commentId
    })) });
  if (current.approvalDigest !== prior.approvalDigest
      || current.providerObservationDigest !== prior.providerObservationDigest) {
    fail('source transition author statement or current permission changed before the effect');
  }
}

/** Historical Docker data keeps its original schema and image interpretation. */
export interface TrustedRuntimeDockerReceipt {
  readonly schema: typeof TRUSTED_RUNTIME_CONTAINER_SCHEMA;
  readonly executionId: string;
  readonly sessionRevision: Digest;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  readonly dockerEndpoint: DockerEndpointIdentity;
  readonly networkIsolatedBeforeSut: true;
  readonly evidenceByteDigest: Digest;
  readonly evidenceByteLength: number;
  readonly evidenceDigest: Digest;
  readonly producerSourceDigest: Digest;
  readonly sourceProgramTransition?: Readonly<{ assessmentDigest: string; outputByteDigest: Digest; actionKey: string }>;
  readonly receiptDigest: Digest;
}

export interface TrustedRuntimeNativeReceipt {
  readonly schema: 'sec-trusted-runtime-native-receipt-v1';
  readonly executionId: string;
  readonly sessionRevision: Digest;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly unitReceipt: LinuxVerificationUnitReceipt;
  readonly networkIsolatedBeforeSut: true;
  readonly evidenceByteDigest: Digest;
  readonly evidenceByteLength: number;
  readonly evidenceDigest: Digest;
  readonly producerSourceDigest: Digest;
  readonly sourceProgramTransition?: Readonly<{ assessmentDigest: string; outputByteDigest: Digest; actionKey: string }>;
  readonly receiptDigest: Digest;
}

export type TrustedRuntimeContainerReceipt = TrustedRuntimeDockerReceipt | TrustedRuntimeNativeReceipt;


export interface TrustedRuntimeDependencyCacheMarker {
  readonly schema: typeof TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA;
  readonly classification: 'rebuildable-derived-cache';
  readonly authority: 'none';
  readonly repository: string;
  readonly bunLockBlobSha: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  readonly bunVersion: string;
  readonly deletionEffect: 'performance-loss-only';
  readonly activeUseFence: 'docker-mounted-volume-plus-operation-lease-v1';
  readonly cacheKey: Digest;
}

export interface TrustedRuntimeDependencyCacheVolumeSpec {
  readonly schema: typeof TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

function fail(message: string): never {
  throw new Error(`Trusted runtime container: ${message}`);
}

function digestBytes(value: string | Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digestValue(value: unknown): Digest {
  return digestBytes(encodeVerificationActionData(value));
}

const TRUSTED_RUNTIME_CONTAINER_OPERATION_LEASE_MS = 4 * 60 * 60_000;
export const TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET = Object.freeze({
  durationMs: TRUSTED_RUNTIME_CONTAINER_OPERATION_LEASE_MS,
  inputBytes: 64 * 1024 * 1024,
  outputBytes: 512 * 1024 * 1024,
  processes: 512
});

/** Original Engine requirement data; neither it nor the plan grants effects. */
export const TRUSTED_RUNTIME_CONTAINER_ENGINE_REQUIREMENT = Object.freeze({
  id: 'external.container-engine-process',
  contractDigest: digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-container-engine-contract-v1',
    environment: ENVIRONMENT.provider.requirement,
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
  })) as OperationDigest,
  effectKinds: Object.freeze(['filesystem', 'process', 'provider'] as const),
  failureKinds: Object.freeze([
    'container-engine.admission-failed',
    'container-engine.desktop-launcher-path-unavailable',
    'container-engine.endpoint-unavailable',
    'container-engine.process-settlement-failed',
    'container-engine.runtime-endpoint-residue'
  ])
});

function issueTrustedRuntimeContainerEngineTerminalJoinWithSettlements(input: Readonly<{
  operation: BoundSemanticOperation;
  primaryProviderSettlement: ProviderSettlementReceipt;
  providerSettlements: readonly ProviderSettlementReceipt[];
  endpointReadback: DockerEndpointIdentity;
  ownerTerminalContractDigest: OperationDigest;
  ownerTerminalReferenceDigest: OperationDigest;
}>) {
  const providerSettlementSet = compileProviderSettlementSet(
    input.operation,
    input.providerSettlements
  );
  const readback = issueNormalDomainReadbackReceipt(input.operation, providerSettlementSet, {
    readbackContractDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-endpoint-readback-contract-v1',
      contextName: input.endpointReadback.contextName,
      endpointHost: input.endpointReadback.endpointHost
    })) as OperationDigest,
    readbackReferenceDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-endpoint-readback-v1',
      endpoint: input.endpointReadback
    })) as OperationDigest,
    currentPhysicalEpochDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-physical-epoch-v1',
      endpointHost: input.endpointReadback.endpointHost,
      daemonId: input.endpointReadback.daemonId
    })) as OperationDigest,
    disposition: input.primaryProviderSettlement.physicalDisposition === 'settled'
      ? 'applied'
      : input.primaryProviderSettlement.physicalDisposition === 'not-started'
        ? 'not-applied'
        : 'unknown'
  });
  const ownerTerminalProjection = issueNormalOwnerTerminalJoinReceipt(
    input.operation,
    providerSettlementSet,
    readback,
    {
      ownerTerminalContractDigest: input.ownerTerminalContractDigest,
      ownerTerminalReferenceDigest: input.ownerTerminalReferenceDigest
    }
  );
  return Object.freeze({ providerSettlementSet, readback, ownerTerminalProjection });
}

export function issueTrustedRuntimeContainerEngineOwnerTerminalJoin(input: Readonly<{
  operation: BoundSemanticOperation;
  providerSettlement: ProviderSettlementReceipt;
  endpointReadback: DockerEndpointIdentity;
  ownerTerminalContractDigest: OperationDigest;
  ownerTerminalReferenceDigest: OperationDigest;
}>): OwnerTerminalJoinReceipt {
  return issueTrustedRuntimeContainerEngineTerminalJoinWithSettlements({
    ...input,
    primaryProviderSettlement: input.providerSettlement,
    providerSettlements: [input.providerSettlement]
  }).ownerTerminalProjection;
}

type TrustedRuntimeContainerEngineSettlement = Readonly<{
  operation: BoundSemanticOperation;
  ownerTerminalReference: Readonly<Record<string, unknown>>;
  endpointReadback: DockerEndpointIdentity;
}> & ReturnType<typeof issueTrustedRuntimeContainerEngineTerminalJoinWithSettlements>;

export function createTrustedRuntimeDependencyCacheMarker(input: Readonly<{
  repository: string;
  bunLockBlobSha: string;
  imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
}>): TrustedRuntimeDependencyCacheMarker {
  const withoutKey = Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA,
    classification: 'rebuildable-derived-cache' as const,
    authority: 'none' as const,
    repository: repository(input.repository),
    bunLockBlobSha: sha(input.bunLockBlobSha, 'dependency cache bunLockBlobSha'),
    imageId: input.imageId,
    bunVersion: ENVIRONMENT.trustedRuntime.bunVersion,
    deletionEffect: 'performance-loss-only' as const,
    activeUseFence: 'docker-mounted-volume-plus-operation-lease-v1' as const
  });
  return Object.freeze({ ...withoutKey, cacheKey: digestValue(withoutKey) });
}

export function createTrustedRuntimeDependencyCacheVolumeSpec(
  marker: TrustedRuntimeDependencyCacheMarker
): TrustedRuntimeDependencyCacheVolumeSpec {
  const name = `sec-trusted-runtime-bun-cache-v1-${marker.cacheKey.slice(7, 39)}`;
  return Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA,
    name,
    labels: Object.freeze({
      'sec.trusted-runtime.cache-schema': TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA,
      'sec.trusted-runtime.repository': marker.repository,
      'sec.trusted-runtime.cache-key': marker.cacheKey,
      'sec.trusted-runtime.image-id': marker.imageId
    })
  });
}

export function assertTrustedRuntimeDependencyCacheVolume(input: Readonly<{
  source: string;
  expected: TrustedRuntimeDependencyCacheVolumeSpec;
  endpointDigest: Digest;
}>): Digest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.source) as unknown;
  } catch {
    fail('Docker dependency-cache volume inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker dependency-cache volume inspect must contain one volume');
  }
  const record = parsed[0] as Record<string, unknown>;
  const labels = record.Labels;
  const options = record.Options;
  if (record.Name !== input.expected.name || record.Driver !== 'local' || record.Scope !== 'local'
      || typeof record.CreatedAt !== 'string' || Number.isNaN(Date.parse(record.CreatedAt))
      || labels === null || typeof labels !== 'object' || Array.isArray(labels)
      || encodeVerificationActionData(labels)
        !== encodeVerificationActionData(input.expected.labels)
      || !(options === null || (typeof options === 'object' && !Array.isArray(options)
        && Object.keys(options as Record<string, unknown>).length === 0))) {
    fail('Docker dependency-cache volume differs from the content-addressed specification');
  }
  return digestValue(Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA,
    endpointDigest: digest(input.endpointDigest, 'dependency-cache volume endpointDigest'),
    name: input.expected.name,
    createdAt: record.CreatedAt,
    driver: record.Driver,
    scope: record.Scope,
    labels: input.expected.labels
  }));
}

function bounded(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be bounded canonical text`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  const result = bounded(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a lowercase Git SHA`);
  return result;
}

function digest(value: unknown, label: string): Digest {
  const result = bounded(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a SHA-256 digest`);
  return result as Digest;
}

function repository(value: unknown): string {
  const result = bounded(value, 'repository');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(result)) {
    fail('repository must be owner/name');
  }
  return result;
}

export function createTrustedRuntimeHostCommandEnvironment(
  _executable: 'git',
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const expected of [
    // Docker receives an explicit retained endpoint in every caller.  Its
    // context/config selectors are therefore authority inputs and must not
    // cross this boundary from the ambient host environment.
    'HOME', 'LOCALAPPDATA',
    'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR'
  ]) {
    const actual = Object.keys(source).find((key) => key.toUpperCase() === expected);
    if (actual !== undefined && source[actual] !== undefined) result[actual] = source[actual];
  }
  return isolatedGitChildEnvironment(result);
}

export function renderTrustedRuntimeCommandFailureDetail(input: Readonly<{
  stdout: string;
  stderr: string;
}>): string {
  const sections = ([
    ['stdout', input.stdout],
    ['stderr', input.stderr]
  ] as const).flatMap(([label, source]) => {
    const tail = source.trim().slice(-4_096);
    return tail.length === 0 ? [] : [`${label}:\n${tail}`];
  });
  return sections.length === 0 ? '<no captured output>' : sections.join('\n');
}

export interface TrustedRuntimeContainerIdentity {
  readonly id: string;
  readonly imageId: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly readOnlyRootfs: true;
  readonly readOnlyCandidateBundle: true;
  readonly candidateBundleSource: string;
  readonly initProcess: true;
  readonly executableTestTmpfs: true;
  readonly nonExecutableMutableTmpfs: true;
  readonly dependencyCacheVolumeName: string | null;
}

export function composeTrustedRuntimeContainerLabels(
  imageLabels: Readonly<Record<string, string>>,
  operationLabels: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  if (Object.keys(imageLabels).some((key) => Object.hasOwn(operationLabels, key))) {
    fail('Docker image labels collide with retained operation identity');
  }
  return Object.freeze({ ...imageLabels, ...operationLabels });
}

function assertCanonicalTmpfs(hostConfig: Readonly<Record<string, unknown>>): void {
  const tmpfs = hostConfig.Tmpfs;
  if (tmpfs === null || typeof tmpfs !== 'object' || Array.isArray(tmpfs)) {
    fail('Docker tmpfs policy is invalid');
  }
  const expected: Readonly<Record<string, string>> = Object.freeze({
    [TRUSTED_RUNTIME_TEST_TMPFS_TARGET]:
      TRUSTED_RUNTIME_TEST_TMPFS_SPEC.slice(TRUSTED_RUNTIME_TEST_TMPFS_TARGET.length + 1),
    [TRUSTED_RUNTIME_MUTABLE_ROOT]:
      TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC.slice(TRUSTED_RUNTIME_MUTABLE_ROOT.length + 1)
  });
  const observed = tmpfs as Record<string, unknown>;
  const expectedTargets = Object.keys(expected).sort();
  const observedTargets = Object.keys(observed).sort();
  if (observedTargets.length !== expectedTargets.length
      || observedTargets.some((target, index) => target !== expectedTargets[index])) {
    fail('Docker tmpfs targets differ from the canonical policy');
  }
  for (const target of expectedTargets) {
    if (typeof observed[target] !== 'string') fail(`Docker tmpfs ${target} options are invalid`);
    const observedOptions = observed[target].split(',');
    const expectedOptions = expected[target]!.split(',');
    if (new Set(observedOptions).size !== observedOptions.length
        || observedOptions.length !== expectedOptions.length
        || observedOptions.some((option) => !expectedOptions.includes(option))) {
      fail(`Docker tmpfs ${target} options differ from the canonical policy`);
    }
  }
}

export function parseTrustedRuntimeContainerIdentity(
  source: string
): TrustedRuntimeContainerIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    fail('Docker container inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker container inspect must contain one container');
  }
  const record = parsed[0] as Record<string, unknown>;
  const config = record.Config;
  const hostConfig = record.HostConfig;
  const mounts = record.Mounts;
  if (typeof record.Id !== 'string' || !/^[0-9a-f]{64}$/u.test(record.Id)
      || typeof record.Image !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.Image)
      || typeof record.Name !== 'string' || !record.Name.startsWith('/')
      || config === null || typeof config !== 'object' || Array.isArray(config)
      || hostConfig === null || typeof hostConfig !== 'object' || Array.isArray(hostConfig)
      || (hostConfig as Record<string, unknown>).ReadonlyRootfs !== true
      || (hostConfig as Record<string, unknown>).Init !== true
      || !Array.isArray(mounts)) {
    fail('Docker container identity is invalid');
  }
  assertCanonicalTmpfs(hostConfig as Record<string, unknown>);
  const candidateBundleMounts = mounts.filter((entry) => entry !== null
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && (entry as Record<string, unknown>).Destination === TRUSTED_RUNTIME_CANDIDATE_BUNDLE);
  if (candidateBundleMounts.length !== 1
      || (candidateBundleMounts[0] as Record<string, unknown>).Type !== 'bind'
      || (candidateBundleMounts[0] as Record<string, unknown>).RW !== false
      || typeof (candidateBundleMounts[0] as Record<string, unknown>).Source !== 'string') {
    fail('Docker candidate bundle must be one read-only bind mount');
  }
  const dependencyCacheMounts = mounts.filter((entry) => entry !== null
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && (entry as Record<string, unknown>).Destination
      === TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH);
  if (dependencyCacheMounts.length > 1) {
    fail('Docker dependency-cache mount must be zero or one');
  }
  let dependencyCacheVolumeName: string | null = null;
  if (dependencyCacheMounts.length === 1) {
    const cacheMount = dependencyCacheMounts[0] as Record<string, unknown>;
    if (cacheMount.Type !== 'volume' || cacheMount.Driver !== 'local' || cacheMount.RW !== true
        || typeof cacheMount.Name !== 'string'
        || !/^sec-trusted-runtime-bun-cache-v1-[0-9a-f]{32}$/u.test(cacheMount.Name)) {
      fail('Docker dependency-cache mount differs from the content-addressed volume');
    }
    dependencyCacheVolumeName = cacheMount.Name;
  }
  const rawLabels = (config as Record<string, unknown>).Labels;
  if (rawLabels === null || typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
    fail('Docker container labels are invalid');
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawLabels)) {
    if (typeof value !== 'string') fail('Docker container label is not text');
    labels[key] = value;
  }
  return Object.freeze({
    id: record.Id,
    imageId: record.Image,
    name: record.Name.slice(1),
    labels: Object.freeze(labels),
    readOnlyRootfs: true,
    readOnlyCandidateBundle: true,
    candidateBundleSource: (candidateBundleMounts[0] as Record<string, unknown>).Source as string,
    initProcess: true,
    executableTestTmpfs: true,
    nonExecutableMutableTmpfs: true,
    dependencyCacheVolumeName
  });
}

function sameContainerIdentity(
  left: TrustedRuntimeContainerIdentity,
  right: TrustedRuntimeContainerIdentity
): boolean {
  return left.id === right.id && left.imageId === right.imageId && left.name === right.name
    && left.readOnlyRootfs === right.readOnlyRootfs
    && left.readOnlyCandidateBundle === right.readOnlyCandidateBundle
    && left.candidateBundleSource === right.candidateBundleSource
    && left.initProcess === right.initProcess
    && left.executableTestTmpfs === right.executableTestTmpfs
    && left.nonExecutableMutableTmpfs === right.nonExecutableMutableTmpfs
    && left.dependencyCacheVolumeName === right.dependencyCacheVolumeName
    && encodeVerificationActionData(left.labels) === encodeVerificationActionData(right.labels);
}

export function authorizeTrustedRuntimeContainerRecovery(input: Readonly<{
  first: TrustedRuntimeContainerIdentity;
  confirmed: TrustedRuntimeContainerIdentity;
  expected: Readonly<{
    operationKey: string;
    repository: string;
    baseSha: string;
    headSha: string;
    endpointDigest: Digest;
    imageId: string;
    imageLabels: Readonly<Record<string, string>>;
    ownerHost: string;
    dependencyCacheKey?: Digest;
    dependencyCacheVolumeName: string | null;
  }>;
  observeProcessLiveness: (pid: number) => 'alive' | 'dead' | 'unknown';
}>): string {
  const ownerPidText = input.first.labels['sec.trusted-runtime.owner-pid'];
  const ownerPid = ownerPidText !== undefined && /^[1-9][0-9]*$/u.test(ownerPidText)
    ? Number(ownerPidText)
    : Number.NaN;
  const ownerNonce = input.first.labels['sec.trusted-runtime.owner-nonce'];
  const expectedLabels = composeTrustedRuntimeContainerLabels(
    input.expected.imageLabels,
    Object.freeze({
      'sec.trusted-runtime.operation': input.expected.operationKey,
      'sec.trusted-runtime.repository': input.expected.repository,
      'sec.trusted-runtime.base-sha': input.expected.baseSha,
      'sec.trusted-runtime.head-sha': input.expected.headSha,
      'sec.trusted-runtime.endpoint-digest': input.expected.endpointDigest,
      'sec.trusted-runtime.owner-host': input.expected.ownerHost,
      'sec.trusted-runtime.owner-pid': ownerPidText ?? '',
      'sec.trusted-runtime.owner-nonce': ownerNonce ?? '',
      'sec.trusted-runtime.image-id': input.expected.imageId,
      ...(input.expected.dependencyCacheKey === undefined ? {} : {
        'sec.trusted-runtime.dependency-cache-key': input.expected.dependencyCacheKey
      })
    })
  );
  if (encodeVerificationActionData(input.first.labels)
        !== encodeVerificationActionData(expectedLabels)
      || input.first.imageId !== input.expected.imageId
      || input.first.readOnlyRootfs !== true
      || input.first.readOnlyCandidateBundle !== true
      || input.first.initProcess !== true
      || input.first.executableTestTmpfs !== true
      || input.first.nonExecutableMutableTmpfs !== true
      || input.first.dependencyCacheVolumeName !== input.expected.dependencyCacheVolumeName
      || ownerNonce === undefined
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(ownerNonce)
      || input.first.name !== `sec-trusted-runtime-${input.expected.operationKey}-${ownerNonce}`
      || !Number.isSafeInteger(ownerPid) || ownerPid > 2_147_483_647) {
    fail('Docker abandoned-container identity differs from the fenced operation');
  }
  const firstLiveness = input.observeProcessLiveness(ownerPid);
  if (firstLiveness !== 'dead') {
    fail(`Docker abandoned-container owner is ${firstLiveness}; recovery is not authorized`);
  }
  if (!sameContainerIdentity(input.first, input.confirmed)
      || input.observeProcessLiveness(ownerPid) !== 'dead') {
    fail('Docker abandoned-container identity or owner liveness changed during recovery');
  }
  return input.confirmed.id;
}

function imageObservation(source: string): TrustedRuntimeContainerImageObservation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('Docker image inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker image inspect must contain one image');
  }
  const image = parsed[0] as Record<string, unknown>;
  if (image.Id !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID) fail('Docker image ID drifted');
  const config = image.Config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail('Docker image config is invalid');
  }
  const labels = (config as Record<string, unknown>).Labels;
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) {
    fail('Docker image labels are invalid');
  }
  const observed = labels as Record<string, unknown>;
  const expected: Readonly<Record<string, string>> = Object.freeze({
    'sec.trusted-runtime.image-schema': TRUSTED_RUNTIME_CONTAINER_SCHEMA,
    'sec.trusted-runtime.base-image-id': TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID,
    'sec.trusted-runtime.bun-archive-sha256': TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256,
    'sec.trusted-runtime.bun-executable-sha256':
      SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
    'sec.trusted-runtime.bun-version': ENVIRONMENT.trustedRuntime.bunVersion
  });
  for (const [key, value] of Object.entries(expected)) {
    if (observed[key] !== value) fail(`Docker image label ${key} drifted`);
  }
  return Object.freeze({
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    labels: Object.freeze(Object.fromEntries(
      Object.entries(observed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ))
  });
}

export function assertTrustedRuntimeContainerImageV1(
  source: string
): TrustedRuntimeContainerImageObservation {
  return imageObservation(source);
}

/** Historical Docker setup bytes remain inspectable; new execution never runs them. */
export const TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT = [
  'set -euo pipefail',
  'base="$1"',
  'head="$2"',
  'mode="$3"',
  '[ "$mode" = "full" ] || [ "$mode" = "lifecycle-canary" ] || [ "$mode" = "dependency-canary" ]',
  `mkdir -p ${TRUSTED_RUNTIME_TRUSTED_TREE} ${TRUSTED_RUNTIME_WORKSPACE} ${TRUSTED_RUNTIME_OUTPUT}`,
  `git init --quiet ${TRUSTED_RUNTIME_TRUSTED_TREE}`,
  `git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} fetch --quiet ${TRUSTED_RUNTIME_CANDIDATE_BUNDLE} refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head`,
  `git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} reset --hard --quiet refs/sec/base`,
  `[ "$(git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} rev-parse HEAD)" = "$base" ]`,
  `git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} update-ref refs/remotes/origin/main "$base"`,
  `[ "$(git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} rev-parse refs/remotes/origin/main)" = "$base" ]`,
  `git init --quiet ${TRUSTED_RUNTIME_WORKSPACE}`,
  `git -C ${TRUSTED_RUNTIME_WORKSPACE} fetch --quiet ${TRUSTED_RUNTIME_CANDIDATE_BUNDLE} refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head`,
  `git -C ${TRUSTED_RUNTIME_WORKSPACE} reset --hard --quiet refs/sec/head`,
  `[ "$(git -C ${TRUSTED_RUNTIME_WORKSPACE} rev-parse HEAD)" = "$head" ]`,
  `git -C ${TRUSTED_RUNTIME_WORKSPACE} update-ref refs/remotes/origin/main "$base"`,
  `[ "$(git -C ${TRUSTED_RUNTIME_WORKSPACE} rev-parse refs/remotes/origin/main)" = "$base" ]`,
  'if [ "$mode" != "lifecycle-canary" ]; then',
  `  cd ${TRUSTED_RUNTIME_TRUSTED_TREE}`,
  `  CI=1 SEC_CACHE_HOME=/tmp/sec-hosted-dependency-home ${TRUSTED_RUNTIME_DEPENDENCY_PACKAGE_COMMAND.join(' ')}`,
  '  if [ "$mode" = "full" ]; then',
  `    rm -rf ${TRUSTED_RUNTIME_WORKSPACE}/node_modules`,
  `    ln -s ${TRUSTED_RUNTIME_TRUSTED_TREE}/node_modules ${TRUSTED_RUNTIME_WORKSPACE}/node_modules`,
  '  else',
  `    [ ! -e ${TRUSTED_RUNTIME_WORKSPACE}/node_modules ]`,
  '  fi',
  'fi',
  `chmod -R a-w ${TRUSTED_RUNTIME_TRUSTED_TREE}`
].join('\n');

function formalEnvironment(input: Readonly<{
  envelope: VerificationSessionHostedEnvelope<typeof import('../ci/contract/session-request.ts').VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  executionId: string;
  executionEnvironment: CiVerificationExecutionEnvironment;
  actorNodeId: string;
  requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
  sourceProgramTransition?: CiSourceProgramTransitionBinding;
  sourceAction?: TrustedRuntimeSourceProgramAction;
}>): Readonly<Record<string, string>> {
  const { envelope } = input;
  const values: Readonly<Record<string, string>> = Object.freeze({
    CI: '1',
    HOME: '/tmp/home',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    SEC_FORMAL_TRUSTED_RUNTIME_MODE: '1',
    ...(input.sourceProgramTransition === undefined ? {} : {
      SEC_SOURCE_PROGRAM_TRANSITION_BINDING: encodeVerificationActionData(sourceProgramAnalysisBinding(input.sourceProgramTransition))
    }),
    ...(input.sourceAction === undefined ? {} : {
      SEC_SOURCE_PROGRAM_ACTION_HANDOFF: encodeVerificationActionData(input.sourceAction)
    }),
    SEC_SESSION_REVISION: envelope.session.sessionRevision,
    SEC_SESSION_PROPOSAL_DIGEST: envelope.session.sessionProposalDigest,
    SEC_SCOPE_AUTHORIZATION_REVISION: envelope.scopeAuthorization.authorizationRevision,
    SEC_SCOPE_AUTHORIZATION_DIGEST: envelope.scopeAuthorization.authorizationDigest,
    SEC_REVIEW_RECEIPT_DIGEST: envelope.preGateReview.receiptDigest,
    SEC_MAIN_HEALTH_REVISION: envelope.mainHealth.healthRevision,
    SEC_MAIN_HEALTH_DIGEST: envelope.mainHealth.ledgerDigest,
    SEC_TRUST_REVISION: envelope.session.trustRevision,
    SEC_BASE_TREE_SHA: envelope.session.baseTreeSha,
    SEC_ACTION_PLAN_DIGEST: envelope.actionPlanClosure.actionPlanDigest,
    SEC_REQUIRED_BLOB_CLOSURE_JSON: encodeVerificationActionData(input.requiredBlobs),
    SEC_EXECUTION_ENVIRONMENT_REVISION:
      input.executionEnvironment.executionEnvironmentRevision,
    SEC_TRUSTED_RUNTIME_EXECUTION_ID: input.executionId,
    SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID: input.actorNodeId,
    SEC_CHANGED_BASE: 'refs/sec/base',
    SEC_AFFECTED_TESTS_BASE: 'refs/sec/base',
    SEC_WORK_PACKAGE_MANIFEST_PATH: envelope.session.manifestPath,
    SEC_CI_VERIFICATION_EVIDENCE_PATH: `${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`
  });
  return Object.freeze({ ...values, ...TRUSTED_RUNTIME_STATE_ENVIRONMENT });
}

function createReceipt(input: Omit<TrustedRuntimeDockerReceipt, 'schema' | 'receiptDigest'>):
TrustedRuntimeDockerReceipt {
  const withoutDigest = Object.freeze({ schema: TRUSTED_RUNTIME_CONTAINER_SCHEMA, ...input });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

function createNativeReceipt(input: Omit<TrustedRuntimeNativeReceipt, 'schema' | 'receiptDigest'>):
TrustedRuntimeNativeReceipt {
  const unitReceipt = parseLinuxVerificationUnitReceipt(input.unitReceipt);
  const evidenceFile = unitReceipt.outputFiles.find(({ path: filePath }: Readonly<{ path: string }>) =>
    filePath === `${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`);
  if (unitReceipt.execution.exitCode !== 0
      || [unitReceipt.gitBefore, unitReceipt.gitAfter].some((identity) =>
        identity.baseSha !== input.baseSha || identity.headSha !== input.headSha
        || identity.baseTreeSha !== input.baseTreeSha || identity.headTreeSha !== input.headTreeSha || identity.status !== '')
      || unitReceipt.inputs.sutArchiveDigest !== null || unitReceipt.inputs.dependencyContentDigest === null
      || unitReceipt.unit.workingDirectory !== TRUSTED_RUNTIME_TRUSTED_TREE
      || evidenceFile === undefined || evidenceFile.digest !== input.evidenceByteDigest
      || evidenceFile.bytes !== input.evidenceByteLength) {
    fail('native receipt differs from the successful exact-subject physical output');
  }
  const withoutDigest = Object.freeze({
    schema: 'sec-trusted-runtime-native-receipt-v1' as const, ...input, unitReceipt
  });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

function parseNativeReceipt(record: Record<string, unknown>): TrustedRuntimeNativeReceipt {
  if (Object.keys(record).sort().join(',') !== [
    'schema', 'executionId', 'sessionRevision', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha',
    'unitReceipt', 'networkIsolatedBeforeSut', 'evidenceByteDigest', 'evidenceByteLength',
    'evidenceDigest', 'producerSourceDigest', 'receiptDigest',
    ...(record.sourceProgramTransition === undefined ? [] : ['sourceProgramTransition'])
  ].sort().join(',') || record.networkIsolatedBeforeSut !== true
      || !Number.isSafeInteger(record.evidenceByteLength) || Number(record.evidenceByteLength) < 1) {
    fail('native receipt shape or fixed identity is invalid');
  }
  const rebuilt = createNativeReceipt({
    executionId: bounded(record.executionId, 'native receipt.executionId'),
    sessionRevision: digest(record.sessionRevision, 'native receipt.sessionRevision'),
    baseSha: sha(record.baseSha, 'native receipt.baseSha'),
    baseTreeSha: sha(record.baseTreeSha, 'native receipt.baseTreeSha'),
    headSha: sha(record.headSha, 'native receipt.headSha'),
    headTreeSha: sha(record.headTreeSha, 'native receipt.headTreeSha'),
    unitReceipt: parseLinuxVerificationUnitReceipt(record.unitReceipt),
    networkIsolatedBeforeSut: true,
    evidenceByteDigest: digest(record.evidenceByteDigest, 'native receipt.evidenceByteDigest'),
    evidenceByteLength: Number(record.evidenceByteLength),
    evidenceDigest: digest(record.evidenceDigest, 'native receipt.evidenceDigest'),
    producerSourceDigest: digest(record.producerSourceDigest, 'native receipt.producerSourceDigest'),
    ...(record.sourceProgramTransition === undefined ? {} : {
      sourceProgramTransition: parseTransitionReceipt(record.sourceProgramTransition)
    })
  });
  if (rebuilt.receiptDigest !== digest(record.receiptDigest, 'native receipt.receiptDigest')) {
    fail('native receipt digest mismatch');
  }
  return rebuilt;
}

export function parseTrustedRuntimeContainerReceipt(
  value: unknown
): TrustedRuntimeContainerReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('receipt must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schema === 'sec-trusted-runtime-native-receipt-v1') return parseNativeReceipt(record);
  const expected = [
    'schema', 'executionId', 'sessionRevision', 'baseSha', 'headSha', 'headTreeSha',
    'imageId', 'dockerEndpoint', 'networkIsolatedBeforeSut', 'evidenceByteDigest',
    'evidenceByteLength', 'evidenceDigest', 'producerSourceDigest', 'receiptDigest',
    ...(record.sourceProgramTransition === undefined ? [] : ['sourceProgramTransition'])
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
      || record.schema !== TRUSTED_RUNTIME_CONTAINER_SCHEMA
      || record.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
      || record.networkIsolatedBeforeSut !== true
      || !Number.isSafeInteger(record.evidenceByteLength)
      || Number(record.evidenceByteLength) < 1) {
    fail('receipt shape or fixed identity is invalid');
  }
  const rebuilt = createReceipt({
    executionId: bounded(record.executionId, 'receipt.executionId'),
    sessionRevision: digest(record.sessionRevision, 'receipt.sessionRevision'),
    baseSha: sha(record.baseSha, 'receipt.baseSha'),
    headSha: sha(record.headSha, 'receipt.headSha'),
    headTreeSha: sha(record.headTreeSha, 'receipt.headTreeSha'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    dockerEndpoint: parseDockerEndpointIdentity(record.dockerEndpoint),
    networkIsolatedBeforeSut: true,
    evidenceByteDigest: digest(record.evidenceByteDigest, 'receipt.evidenceByteDigest'),
    evidenceByteLength: Number(record.evidenceByteLength),
    evidenceDigest: digest(record.evidenceDigest, 'receipt.evidenceDigest'),
    producerSourceDigest: digest(record.producerSourceDigest, 'receipt.producerSourceDigest'),
    ...(record.sourceProgramTransition === undefined ? {} : {
      sourceProgramTransition: parseTransitionReceipt(record.sourceProgramTransition)
    })
  });
  if (rebuilt.receiptDigest !== digest(record.receiptDigest, 'receipt.receiptDigest')) {
    fail('receipt digest mismatch');
  }
  return rebuilt;
}


export class TrustedRuntimePredecessorRecoveryRequiredError extends Error {
  readonly code = 'TRUSTED_RUNTIME_PREDECESSOR_RECOVERY_REQUIRED';
  constructor(readonly operationKey: string) {
    super('The original trusted runtime lease retains predecessor recovery; native execution cannot replace or settle it.');
  }
}

interface TrustedRuntimeNativeWorkspace {
  readonly session: LinuxVerificationUnitSession;
  readonly executionEnvironment: CiVerificationExecutionEnvironment;
  execute(invocation: LinuxVerificationUnitInvocation): Promise<LinuxVerificationUnitResult>;
}

type TrustedRuntimeNativeWorkspaceSettlement = LinuxVerificationUnitSessionSettlement & Readonly<{
  providerSettlement: ProviderSettlementReceipt;
  providerSettlementSet: ReturnType<typeof compileProviderSettlementSet>;
  readback: ReturnType<typeof issueNormalDomainReadbackReceipt>;
  ownerTerminalProjection: OwnerTerminalJoinReceipt;
}>;

interface TrustedRuntimeOwnedRecovery {
  readonly unit: LinuxVerificationUnitRecovery | null;
  /** Captures the original resources; never repeats candidate execution. */
  settle(): Promise<void>;
}

class TrustedRuntimeOwnedRecoveryRequiredError extends AggregateError {
  readonly code = 'TRUSTED_RUNTIME_OWNED_RECOVERY_REQUIRED';
  constructor(readonly recovery: TrustedRuntimeOwnedRecovery, failures: readonly unknown[]) {
    super(failures, 'The original native unit and source resources require bounded owned recovery.');
  }
}

async function recoverTrustedRuntimeOwnedUnit(recovery: LinuxVerificationUnitRecovery,
  originalOperation: BoundSemanticOperation): Promise<void> {
  const requirement = Object.freeze({ id: LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID,
    contractDigest: LINUX_VERIFICATION_UNIT_RECOVERY_CONTRACT_DIGEST,
    effectKinds: Object.freeze(['filesystem', 'process', 'provider', 'persistent-state'] as const),
    failureKinds: Object.freeze(['native-unit.recovery-unknown']) });
  const duration = LINUX_VERIFICATION_UNIT_RECOVERY_RESOURCE_CEILINGS.find(
    (value: Readonly<{ resource: string; maximum: number }>) => value.resource === 'duration-ms');
  if (duration === undefined) fail('native recovery has no fixed cleanup deadline');
  const deadlineAtUnixMs = Date.now() + duration.maximum;
  const operation = bindSemanticOperation(compileSemanticOperationPlan({
    operation: requirement.id,
    intentDigest: digestValue({ originalOperationIdentityDigest: recovery.originalOperationIdentityDigest,
      originalBoundAttemptDigest: recovery.originalBoundAttemptDigest, inputDigest: recovery.inputDigest }) as OperationDigest,
    decisionDigest: requirement.contractDigest, deadlineAtUnixMs,
    aggregateBudgets: LINUX_VERIFICATION_UNIT_RECOVERY_RESOURCE_CEILINGS,
    requirements: [requirement], attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: recovery.originalOperationIdentityDigest,
      runIdDigest: recovery.originalBoundAttemptDigest })
  }), [compileCapabilityBinding({ requirementId: requirement.id, contractDigest: requirement.contractDigest,
    providerIdentityDigest: recovery.providerIdentityDigest })]);
  const settled = await recoverLinuxVerificationUnitSession(recovery, { operation,
    requirementBindingContext: issueOperationRequirementBindingContext({ operation,
      requirementId: requirement.id, resourceCeilings: LINUX_VERIFICATION_UNIT_RECOVERY_RESOURCE_CEILINGS,
      absoluteDeadlineAtUnixMs: deadlineAtUnixMs }) });
  assertProcessResourceSessionReceipt(settled.processReceipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest, requirementId: requirement.id });
  compileProviderSettlementSet(operation, [settled.providerSettlement]);
  compileProviderSettlementSet(originalOperation, [settled.originalProviderSettlement]);
  if (settled.status !== 'settled' || settled.transportRetired !== true
      || originalOperation.plan.identity.identityDigest !== recovery.originalOperationIdentityDigest
      || originalOperation.boundAttemptDigest !== recovery.originalBoundAttemptDigest
      || settled.originalOperationIdentityDigest !== recovery.originalOperationIdentityDigest
      || settled.originalBoundAttemptDigest !== recovery.originalBoundAttemptDigest
      || settled.recoveryOperationIdentityDigest !== operation.plan.identity.identityDigest
      || settled.providerSettlement.physicalDisposition !== 'settled'
      || settled.originalProviderSettlement.physicalDisposition !== 'settled') {
    fail('native recovery did not settle its exact original operation and cleanup scope');
  }
}

/** The existing local runtime owner retains all input issuers and its operation
 * lease. The native provider owns only physical units, never source authority. */
async function withTrustedRuntimeNativeWorkspace<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  operationKey: string;
  dependencies?: boolean;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
  execute(workspace: TrustedRuntimeNativeWorkspace): Promise<T>;
}>): Promise<Readonly<{ value: T; settlement: TrustedRuntimeNativeWorkspaceSettlement }>> {
  throwIfNativeAborted(input.signal);
  const repositoryRoot = path.resolve(input.repositoryRoot);
  if (repositoryRoot !== input.repositoryRoot || !path.isAbsolute(repositoryRoot)) {
    fail('native workspace repository root is noncanonical');
  }
  const repositoryIdentity = repository(input.repository);
  const baseSha = sha(input.baseSha, 'native baseSha');
  const baseTreeSha = sha(input.baseTreeSha, 'native baseTreeSha');
  const headSha = sha(input.headSha, 'native headSha');
  const headTreeSha = sha(input.headTreeSha, 'native headTreeSha');
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/u.test(input.operationKey)) fail('native operation key is invalid');
  const deadlineAtUnixMs = Math.min(input.deadlineAtUnixMs ?? Number.MAX_SAFE_INTEGER,
    Date.now() + TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs);
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) {
    fail('native workspace inherited deadline is invalid or exhausted');
  }
  // Missing accepted native content is an input failure before native effects.
  const runtime = requireSecLinuxVerificationNativeRuntimeInput(
    await observeSecLinuxVerificationNativeRuntimeInput({ repositoryRoot }));
  const executionEnvironment = createCiVerificationNativeLocalExecutionEnvironment();
  throwIfNativeAborted(input.signal);
  const runtimeRoot = inspectNoFollowDirectoryChain(runtime.rootPath, 'Accepted native runtime').target;
  const layout = resolveSecRuntimeStateForRepository({ repositoryRoot, repository: repositoryIdentity });
  // Keep the original coordination and recovery namespace across the physical
  // migration. A predecessor is not declared settled by changing providers.
  const leaseRoot = path.join(layout.repositoryStateRoot, 'trusted-runtime-container-leases', 'v1');
  let authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | null = null;
  let lease: ReturnType<typeof acquirePhysicalMutationLease> = null;
  let temporaryRoot: string | null = null;
  let temporaryIdentity: PhysicalDirectoryIdentity | null = null;
  let bundle: GitCandidateBundle | null = null;
  let dependencies: RetainedCompilerDependencyReadGeneration | null = null;
  let session: LinuxVerificationUnitSession | null = null;
  let nativeOperation: BoundSemanticOperation | null = null;
  let sessionBound = false;
  let borrowedInputsSettled = false;
  let settlement: LinuxVerificationUnitSessionSettlement | null = null;
  const results: LinuxVerificationUnitResult[] = [];
  let value: T | undefined;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  const retired = { dependencies: false, bundle: false, temporaryRoot: false, lease: false, authority: false };
  const releaseBorrowedInputs = async (): Promise<void> => {
    if (borrowedInputsSettled) return;
    await settlePhysicalResourcesAsync({ cleanup: [{
      label: 'native borrowed dependency generation', settle: async () => {
        if (retired.dependencies) return;
        if (dependencies !== null) {
          assertCompilerDependencyReadGenerationRetirementReceipt(await dependencies.retire(), dependencies.generationDigest);
        }
        retired.dependencies = true;
      }
    }, {
      label: 'native borrowed Git bundle', settle: () => {
        if (retired.bundle) return;
        if (bundle !== null) assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle);
        retired.bundle = true;
      }
    }] });
    borrowedInputsSettled = true;
  };
  const retireSources = async (): Promise<void> => {
    await releaseBorrowedInputs();
    if (!retired.temporaryRoot) {
      if (temporaryRoot !== null) {
        if (temporaryIdentity === null) fail('native temporary root acquisition has an unresolved physical identity');
        assertSameNoFollowDirectoryIdentity(temporaryIdentity, 'Native owned temporary root retirement');
        rmSync(temporaryRoot, { recursive: true, force: false });
      }
      retired.temporaryRoot = true;
    }
    if (!retired.lease) {
      await authority?.assertCurrent();
      if (lease?.recoveryPending) lease.restoreReclaimedOwner();
      else lease?.release();
      retired.lease = true;
    }
    if (!retired.authority) {
      await authority?.release();
      retired.authority = true;
    }
  };
  let sourceRetirement: Promise<void> | undefined;
  const releaseSources = async (): Promise<void> => {
    const pending = sourceRetirement ??= retireSources();
    try { await pending; } finally {
      if (sourceRetirement === pending) sourceRetirement = undefined;
    }
  };
  try {
    authority = await acquireSecRuntimeStatePhysicalAuthority({ repositoryRoot,
      stateRoot: layout.stateRoot, cacheRoot: layout.cacheRoot, requiredDirectories: [leaseRoot], deadlineAtUnixMs });
    lease = acquirePhysicalMutationLease(authority.directory(leaseRoot), `container-${input.operationKey}.lock`);
    if (lease === null) fail('native operation is active or its predecessor liveness is unknown');
    if (lease.recoveryPending) {
      throw new TrustedRuntimePredecessorRecoveryRequiredError(input.operationKey);
    }
    if (input.dependencies !== false) {
      const dependencyAuthority = await observeCompilerDependencyExecutionGenerationAuthority({
        deadlineAtUnixMs, signal: input.signal, installMode: 'prebound-only'
      }, compilerRuntimeLayout.dependencyRoot);
      if (dependencyAuthority === null) fail('accepted trusted compiler dependency content is unavailable');
      dependencies = await retainCompilerDependencyReadGeneration(dependencyAuthority, { deadlineAtUnixMs, signal: input.signal });
      await dependencies.assertAuthorityCurrent();
    }
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-trusted-native-'));
    temporaryIdentity = inspectNoFollowDirectoryChain(temporaryRoot, 'Native owned temporary root').target;
    bundle = await createGitCandidateBundle({ sourceRoot: repositoryRoot, temporaryRoot,
      baseSha, headSha, deadlineAtUnixMs, signal: input.signal });
    session = await prepareLinuxVerificationUnitSession({
      recoveryRoot: authority.directory(leaseRoot),
      runtime: { root: runtimeRoot, manifest: runtime.manifest, manifestDigest: runtime.manifestDigest },
      bundle: { file: assertGitCandidateBundleCurrent(bundle), baseSha, baseTreeSha, headSha, headTreeSha,
        bundleDigest: bundle.bundleDigest },
      dependencies: dependencies === null ? null : { physicalGeneration: dependencies.physicalGeneration, generationDigest: dependencies.generationDigest },
      deadlineAtUnixMs
    });
    const requirement = Object.freeze({ id: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID,
      contractDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
      effectKinds: Object.freeze(['filesystem', 'process', 'provider', 'persistent-state'] as const),
      failureKinds: Object.freeze(['native-unit.admission-failed', 'native-unit.execution-failed', 'native-unit.settlement-unknown']) });
    const plan = compileSemanticOperationPlan({
      operation: 'verification.trusted-runtime-native',
      intentDigest: digestValue({ repositoryRoot, repository: repositoryIdentity, baseSha, baseTreeSha, headSha, headTreeSha,
        operationKey: input.operationKey, inputDigest: session.inputDigest }) as OperationDigest,
      decisionDigest: digestValue({ contractDigest: requirement.contractDigest,
        budget: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET }) as OperationDigest,
      deadlineAtUnixMs,
      aggregateBudgets: [
        { resource: 'duration-ms', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs },
        { resource: 'input-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.inputBytes },
        { resource: 'output-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.outputBytes },
        { resource: 'processes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.processes }
      ],
      requirements: [requirement],
      attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: requirement.contractDigest })
    });
    const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId: requirement.id, contractDigest: requirement.contractDigest,
      providerIdentityDigest: session.providerIdentityDigest
    })]);
    nativeOperation = operation;
    bindLinuxVerificationUnitSession(session, { operation,
      requirementBindingContext: issueOperationRequirementBindingContext({ operation,
        requirementId: requirement.id, resourceCeilings: plan.execution.aggregateBudgets }),
      signal: input.signal });
    sessionBound = true;
    const boundSession = session;
    let borrowedSettlement: Promise<void> | undefined;
    value = await input.execute(Object.freeze({ session: boundSession, executionEnvironment,
      execute: async (invocation: LinuxVerificationUnitInvocation): Promise<LinuxVerificationUnitResult> => {
        throwIfNativeAborted(input.signal);
        const executing = executeLinuxVerificationUnit(boundSession, invocation);
        borrowedSettlement ??= boundSession.inputSnapshotReady.then(releaseBorrowedInputs);
        const outcomes = await Promise.allSettled([executing, borrowedSettlement]);
        const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        if (outcomes[0].status !== 'fulfilled') {
          throw new AggregateError(failures.map(({ reason }) => reason), 'Native execution or original input retirement failed');
        }
        const result = outcomes[0].value;
        assertLinuxVerificationUnitResult(result, boundSession);
        if (result.receipt.invocationDigest !== linuxVerificationUnitInvocationDigest(invocation)
            || result.receipt.inputDigest !== boundSession.inputDigest
            || result.receipt.boundAttemptDigest !== operation.boundAttemptDigest
            || result.receipt.operationIdentityDigest !== operation.plan.identity.identityDigest
            || result.receipt.providerIdentityDigest !== boundSession.providerIdentityDigest
            || result.receipt.unit.trustedPackageReadable !== true || result.receipt.unit.outputWritable !== true
            || result.receipt.unit.workingDirectory !== (invocation.cwd === 'trusted'
              ? TRUSTED_RUNTIME_TRUSTED_TREE : invocation.cwd === 'candidate' ? TRUSTED_RUNTIME_WORKSPACE : '/tmp')) {
          fail('native result differs from its exact command, inputs or original attempt');
        }
        results.push(result);
        if (failures.length !== 0) throw new AggregateError(failures.map(({ reason }) => reason), 'Original input retirement failed');
        if (result.receipt.execution.exitCode !== 0) {
          fail(`Native unit command failed (${result.receipt.execution.exitCode}): ${renderTrustedRuntimeCommandFailureDetail({
            stdout: Buffer.from(result.stdout).toString('utf8'), stderr: Buffer.from(result.stderr).toString('utf8') })}`);
        }
        return result;
      }
    }));
  } catch (error) {
    primary = { label: 'trusted native workspace', error };
  }
  const validateOriginalSettlement = (): void => {
    if (session === null) return;
    if (settlement === null || settlement.transportRetired !== true) fail('native input transport retirement is unconfirmed');
    for (const result of results) assertLinuxVerificationUnitResult(result, session);
    if (encodeVerificationActionData(settlement.unitReceiptDigests)
        !== encodeVerificationActionData(results.map(({ receipt }) => receipt.receiptDigest))) {
      fail('native workspace settled a different exact unit inventory');
    }
    if (sessionBound) {
      if (nativeOperation === null || settlement.processReceipt === null || settlement.providerSettlement === null
          || !['settled', 'not-started'].includes(settlement.providerSettlement.physicalDisposition)) {
        fail('native original process or provider settlement is unconfirmed');
      }
      assertProcessResourceSessionReceipt(settlement.processReceipt, {
        operationIdentityDigest: nativeOperation.plan.identity.identityDigest,
        boundAttemptDigest: nativeOperation.boundAttemptDigest,
        requirementId: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID });
      compileProviderSettlementSet(nativeOperation, [settlement.providerSettlement]);
    }
  };
  try {
    if (session !== null) {
      settlement = await closeLinuxVerificationUnitSession(session);
      for (const result of results) assertLinuxVerificationUnitResult(result, session);
    }
  } catch (closeError) {
    if (session === null) throw closeError;
    const originalSession = session;
    let unitRecovery: LinuxVerificationUnitRecovery;
    try { unitRecovery = getLinuxVerificationUnitRecovery(originalSession); }
    catch (recoveryAdmissionError) {
      // Failed admission cannot release the same session's original sources.
      const recovery: TrustedRuntimeOwnedRecovery = Object.freeze({ unit: null,
        async settle() {
          settlement = await closeLinuxVerificationUnitSession(originalSession);
          validateOriginalSettlement(); await releaseSources();
        } });
      throw new TrustedRuntimeOwnedRecoveryRequiredError(recovery,
        [...(primary === undefined ? [] : [primary.error]), closeError, recoveryAdmissionError]);
    }
    let pending: Promise<void> | undefined;
    let unitRecovered = false;
    const recovery: TrustedRuntimeOwnedRecovery = Object.freeze({ unit: unitRecovery,
      async settle(): Promise<void> {
        if (pending !== undefined) return await pending;
        pending = (async () => {
          if (!unitRecovered) {
            if (nativeOperation === null) fail('native recovery lost its original operation object');
            await recoverTrustedRuntimeOwnedUnit(unitRecovery, nativeOperation);
            unitRecovered = true;
          }
          await releaseSources();
        })();
        try { await pending; } finally { pending = undefined; }
      }
    });
    // Consume the retained cleanup capability here. Remaining unknown keeps
    // the same source, lease and authority closures reachable on the error.
    try { await recovery.settle(); }
    catch (recoveryError) {
      throw new TrustedRuntimeOwnedRecoveryRequiredError(recovery,
        [...(primary === undefined ? [] : [primary.error]), closeError, recoveryError]);
    }
    throw new AggregateError([...(primary === undefined ? [] : [primary.error]), closeError],
      'Native execution failed; its original resources settled without issuing qualification.');
  }
  try { validateOriginalSettlement(); }
  catch (error) {
    const recovery: TrustedRuntimeOwnedRecovery = Object.freeze({ unit: null, async settle() {
      if (session !== null) settlement = await closeLinuxVerificationUnitSession(session);
      validateOriginalSettlement(); await releaseSources();
    } });
    throw new TrustedRuntimeOwnedRecoveryRequiredError(recovery,
      [...(primary === undefined ? [] : [primary.error]), error]);
  }
  try { await releaseSources(); }
  catch (error) {
    throw new TrustedRuntimeOwnedRecoveryRequiredError(Object.freeze({ unit: null, settle: releaseSources }),
      [...(primary === undefined ? [] : [primary.error]), error]);
  }
  if (primary !== undefined) throw primary.error;
  const terminal = settlement as LinuxVerificationUnitSessionSettlement | null;
  if (terminal === null || nativeOperation === null || results.length === 0
      || terminal.processReceipt === null || terminal.providerSettlement === null
      || terminal.providerSettlement.physicalDisposition !== 'settled' || terminal.transportRetired !== true) {
    fail('native workspace completed without its successful physical/provider settlement');
  }
  const providerSettlementSet = compileProviderSettlementSet(nativeOperation, [terminal.providerSettlement]);
  const readback = issueNormalDomainReadbackReceipt(nativeOperation, providerSettlementSet, {
    readbackContractDigest: digestValue({ schema: 'sec-trusted-native-unit-terminal-readback-v1',
      requirementId: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID,
      profileDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST }) as OperationDigest,
    readbackReferenceDigest: digestValue({ sessionSettlement: terminal,
      unitReceipts: results.map(({ receipt }) => receipt) }) as OperationDigest,
    currentPhysicalEpochDigest: digestValue(results.map(({ receipt }) => ({
      managerBootId: receipt.unit.managerBootId, managerStartTime: receipt.unit.managerStartTime,
      unit: receipt.unit.name, invocationId: receipt.unit.invocationId,
      cgroupPath: receipt.unit.cgroupPath, mainPid: receipt.unit.mainPid,
      mainPidStartTime: receipt.unit.mainPidStartTime,
      managerMainPid: receipt.unit.managerMainPid, managerMainPidStartTime: receipt.unit.managerMainPidStartTime,
      namespaceIdentities: receipt.unit.namespaceIdentities,
      rootDevice: receipt.unit.rootDevice, rootInode: receipt.unit.rootInode,
      workingDirectory: receipt.unit.workingDirectory,
      workingDirectoryDevice: receipt.unit.workingDirectoryDevice,
      workingDirectoryInode: receipt.unit.workingDirectoryInode
    }))) as OperationDigest,
    disposition: 'applied'
  });
  const ownerTerminalProjection = issueNormalOwnerTerminalJoinReceipt(nativeOperation, providerSettlementSet, readback, {
    ownerTerminalContractDigest: digestValue({ schema: 'sec-trusted-native-workspace-owner-terminal-v1',
      operation: nativeOperation.plan.identity.operation }) as OperationDigest,
    ownerTerminalReferenceDigest: digestValue({ repositoryRoot, repository: repositoryIdentity,
      operationKey: input.operationKey, baseSha, baseTreeSha, headSha, headTreeSha,
      unitReceiptDigests: terminal.unitReceiptDigests }) as OperationDigest
  });
  const joinedSettlement: TrustedRuntimeNativeWorkspaceSettlement = Object.freeze({ ...terminal,
    providerSettlement: terminal.providerSettlement, providerSettlementSet, readback, ownerTerminalProjection });
  throwIfNativeAborted(input.signal);
  if (Date.now() >= deadlineAtUnixMs) fail('native workspace settled after its inherited deadline');
  return Object.freeze({ value: value as T, settlement: joinedSettlement });
}


function parseTransitionReceipt(value: unknown): NonNullable<TrustedRuntimeContainerReceipt['sourceProgramTransition']> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'actionKey,assessmentDigest,outputByteDigest') {
    fail('transition receipt shape is invalid');
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    actionKey: digest(record.actionKey, 'transition actionKey'),
    assessmentDigest: digest(record.assessmentDigest, 'transition assessmentDigest'),
    outputByteDigest: digest(record.outputByteDigest, 'transition outputByteDigest')
  });
}

function assertTransitionInput(input: Readonly<{
  envelope: VerificationSessionHostedEnvelope<typeof import('../ci/contract/session-request.ts').VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  sourceProgramTransition?: CiSourceProgramTransitionBinding;
  authorApproval?: SourceProgramTestAuthorApproval;
}>): CiSourceProgramTransitionBinding | null {
  const action = input.envelope.actionPlanClosure.actions.find(
    ({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID);
  if (input.sourceProgramTransition === undefined) {
    if (action !== undefined || input.authorApproval !== undefined) fail('transition input is incomplete');
    return null;
  }
  const binding = parseCiSourceProgramTransitionBinding(input.sourceProgramTransition);
  const session = input.envelope.session;
  if (action === undefined || binding.baseSha !== session.baseSha || binding.headSha !== session.headSha) {
    fail('transition input differs from exact prepared Session');
  }
  const expected = ciVerificationGateStep(sourceProgramTransitionGate(binding));
  const normalized = input.envelope.actionPlanClosure.normalizedOperations.filter(
    ({ gateId }) => gateId === SOURCE_PROGRAM_TRANSITION_GATE_ID);
  if (normalized.length !== 1
      || encodeVerificationActionData(ciVerificationNormalizedOperationArgv(normalized[0]!))
        !== encodeVerificationActionData(expected.argv)) {
    fail('transition Action command differs from the adopted-base comparison');
  }
  if (!action.action.operation.declaredEnvironment.some(({ name, digest }) =>
    name === 'SEC_SOURCE_PROGRAM_TRANSITION_BINDING' && digest === expected.environment[name])) {
    fail('transition Action does not bind the exact source analysis');
  }
  if (input.authorApproval === undefined) {
    if (binding.payloadDigest !== null) fail('transition author approval is missing');
  } else {
    assertSourceProgramTestAuthorApproval(input.authorApproval);
    const approval = input.authorApproval;
    if (approval.providerOrigin !== 'production'
        || approval.payload.repository !== session.repository
        || approval.payload.pullRequestNumber !== session.prNumber
        || approval.payload.trustedRevision !== session.baseSha
        || approval.payload.baseline.commitSha !== session.baseSha
        || approval.payload.baseline.treeSha !== session.baseTreeSha
        || approval.payload.current.commitSha !== session.headSha
        || approval.payload.current.treeSha !== session.headTreeSha
        || approval.payload.payloadDigest !== binding.payloadDigest
        || approval.providerObservationDigest !== binding.approvalObservationDigest
        || approval.approvalDigest !== binding.approvalDigest) fail('transition author approval differs from exact Session');
  }
  return sourceProgramAnalysisBinding(binding);
}

export interface TrustedRuntimeLegacySourceProgramAttemptEvidence {
  readonly schema: 'source-program-isolated-attempt-evidence-v1' | 'source-program-isolated-attempt-evidence-v2';
  readonly authority: 'historical-evidence-only';
  readonly assessment: SourceProgramTransitionAssessment;
  readonly observation: TrustedRuntimeSourceProgramTransitionObservation;
  readonly physicalEvidence: Readonly<{
    settlements: readonly TrustedRuntimeContainerEngineSettlement[];
    invocation: ContainerEngineOperation;
    image: TrustedRuntimeContainerImageObservation;
    dockerEndpoint: DockerEndpointIdentity;
    dependencyCache: 'private-ephemeral';
    workspaceTerminal: 'retired';
  }>;
  readonly evidenceDigest: Digest;
}
export interface TrustedRuntimeNativeSourceProgramAttemptEvidence {
  readonly schema: 'source-program-isolated-attempt-evidence-v3';
  readonly authority: 'historical-evidence-only';
  readonly assessment: SourceProgramTransitionAssessment;
  readonly observation: TrustedRuntimeSourceProgramTransitionObservation;
  readonly physicalEvidence: Readonly<{
    unitReceipt: LinuxVerificationUnitReceipt;
    invocation: LinuxVerificationUnitInvocation;
    sessionSettlement: TrustedRuntimeNativeWorkspaceSettlement;
    dependencyCache: 'private-ephemeral';
    workspaceTerminal: 'retired';
  }>;
  readonly evidenceDigest: Digest;
}
export type TrustedRuntimeSourceProgramAttemptEvidence =
  | TrustedRuntimeLegacySourceProgramAttemptEvidence
  | TrustedRuntimeNativeSourceProgramAttemptEvidence;
const transitionAttemptEvidence = new WeakMap<object, TrustedRuntimeSourceProgramAttemptEvidence>();
const transitionAttemptRoots = new WeakMap<object, string>();

/** The carrier decoder owns transport joins; this producer also retains the
 * original semantic assessment interpretation. Neither path restores authority. */
export function parseTrustedRuntimeSourceProgramAttemptEvidence(value: unknown): TrustedRuntimeSourceProgramAttemptEvidence {
  const evidence = parseTrustedRuntimeSourceProgramAttemptCarrier(value);
  parseSourceProgramTransitionAssessment(evidence.assessment);
  return evidence;
}

export async function observeTrustedRuntimeSourceProgramTransition(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelope<typeof import('../ci/contract/session-request.ts').VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  receipt: TrustedRuntimeContainerReceipt;
  sourceProgramTransition: CiSourceProgramTransitionBinding;
  authorApproval?: SourceProgramTestAuthorApproval;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  assessment: SourceProgramTransitionAssessment;
  observation: TrustedRuntimeSourceProgramTransitionObservation;
  attemptEvidence: TrustedRuntimeSourceProgramAttemptEvidence;
}>> {
  const binding = assertTransitionInput(input)!;
  const receipt = parseTrustedRuntimeContainerReceipt(input.receipt);
  const session = input.envelope.session;
  const action = input.envelope.actionPlanClosure.actions.find(
    ({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID)!;
  const gate = input.evidence.gates.find(({ action: observed }) => observed.actionKey === action.action.actionKey);
  if (input.evidence.actionPlan.actionPlanDigest !== input.envelope.actionPlanClosure.actionPlanDigest
      || input.evidence.sessionRevision !== session.sessionRevision
      || input.evidence.producer.workflowSha !== session.baseSha
      || input.evidence.producer.workflowPath !== CI_VERIFICATION_WORKFLOW_PATH
      || receipt.sessionRevision !== session.sessionRevision
      || receipt.evidenceDigest !== input.evidence.evidenceDigest
      || receipt.sourceProgramTransition?.actionKey !== action.action.actionKey
      || gate?.result.status !== 'passed' || gate.result.evidenceRefs.length !== 1
      || receipt.sourceProgramTransition.outputByteDigest !== gate.result.evidenceRefs[0]) {
    fail('assessment-completion Action is not exact accepted producer evidence');
  }
  const produced = await executeIsolatedSourceProgramTransition({ ...input, binding,
    predecessorActionOutputDigest: receipt.sourceProgramTransition!.outputByteDigest });
  return Object.freeze({ assessment: produced.assessment, observation: produced.observation, attemptEvidence: produced.attemptEvidence });
}

async function executeIsolatedSourceProgramTransition(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelope<typeof import('../ci/contract/session-request.ts').VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  binding: CiSourceProgramTransitionBinding;
  predecessorActionOutputDigest?: Digest;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  assessment: SourceProgramTransitionAssessment;
  observation: TrustedRuntimeSourceProgramTransitionObservation;
  attemptEvidence: TrustedRuntimeSourceProgramAttemptEvidence;
  startedAt: string;
  finishedAt: string;
}>> {
  const { binding } = input;
  const deadlineAtUnixMs = repositoryAuditInheritedDeadline(input.deadlineAtUnixMs?.toString());
  const session = input.envelope.session;
  const action = input.envelope.actionPlanClosure.actions.find(
    ({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID)!;
  const startedAt = new Date().toISOString();
  const completed = await withTrustedRuntimeNativeWorkspace({
    repositoryRoot: path.resolve(input.repositoryRoot), repository: session.repository,
    baseSha: session.baseSha, baseTreeSha: session.baseTreeSha,
    headSha: session.headSha, headTreeSha: session.headTreeSha,
    operationKey: `transition-${session.sessionRevision.slice(7, 27)}`,
    deadlineAtUnixMs, signal: input.signal,
    execute: async (workspace) => {
      if (action.action.environment.providerRevision !== workspace.executionEnvironment.executionEnvironmentRevision) {
        fail('Source Program Action differs from the accepted native execution environment');
      }
      const invocation: LinuxVerificationUnitInvocation = Object.freeze({
        kind: 'source-program', cwd: 'trusted',
        argv: Object.freeze(['run', '--no-env-file', `--config=${TRUSTED_RUNTIME_TRUSTED_TREE}/bunfig.toml`,
          `${TRUSTED_RUNTIME_TRUSTED_TREE}/${SOURCE_PROGRAM_TRANSITION_ENTRYPOINT}`,
          ...sourceProgramTransitionGate(binding).args.slice(1)]),
        environment: Object.freeze({ CI: '1', HOME: '/tmp/home', LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
          ...TRUSTED_RUNTIME_STATE_ENVIRONMENT,
          [SOURCE_PROGRAM_TRANSITION_DEADLINE_ENV]: String(workspace.session.deadlineAtUnixMs) }),
        outputFiles: Object.freeze([]), maxStdoutBytes: SOURCE_PROGRAM_TRANSITION_STDOUT_BYTE_LIMIT,
        maxStderrBytes: 8 * 1024 * 1024
      });
      const result = await workspace.execute(invocation);
      const stdout = Buffer.from(result.stdout).toString('utf8');
      const assessment = parseSourceProgramTransitionAssessment(JSON.parse(stdout));
      if (stdout !== `${encodeVerificationActionData(assessment)}\n`
          || assessment.baseSha !== session.baseSha || assessment.baseTreeSha !== session.baseTreeSha
          || assessment.headSha !== session.headSha || assessment.headTreeSha !== session.headTreeSha
          || assessment.runtimeSha !== session.baseSha
          || digestValue(assessment.changedPaths) !== digestValue(input.envelope.scopeAuthorization.authorizedPaths)) {
        fail('fresh native Source Program assessment differs from its Action, source pins or scope');
      }
      return Object.freeze({ assessment, invocation, unitReceipt: result.receipt, canonical: Object.freeze({
        repository: session.repository, pullRequestNumber: session.prNumber,
        assessmentDigest: assessment.assessmentDigest,
        ...(input.predecessorActionOutputDigest === undefined ? {
          schema: 'source-program-transition-observation-v2' as const, origin: 'first-qualified' as const,
          sourceActionOutputDigest: digestBytes(result.stdout)
        } : { predecessorActionOutputDigest: input.predecessorActionOutputDigest }),
        baseSha: session.baseSha, headSha: session.headSha, headTreeSha: session.headTreeSha,
        executionId: `source-program-transition-${result.receipt.unit.invocationId}`,
        producerSourceDigest: assessment.producerExecution.observation.implementationDigest,
        producerExecutionEvidenceDigest: assessment.producerExecution.evidenceDigest,
        actionKey: action.action.actionKey, sessionRevision: session.sessionRevision,
        payloadDigest: binding.payloadDigest, approvalObservationDigest: binding.approvalObservationDigest,
        approvalDigest: binding.approvalDigest
      }) });
    }
  });
  const { value, settlement } = completed;
  if (settlement.processReceipt === null || settlement.unitReceiptDigests.length !== 1
      || settlement.unitReceiptDigests[0] !== value.unitReceipt.receiptDigest) {
    fail('fresh Source Program output has no complete native session settlement');
  }
  const observed = Object.freeze({ ...value.canonical,
    settlementDigest: digestValue({ unitReceipt: value.unitReceipt, sessionSettlement: settlement }) });
  const observation: TrustedRuntimeSourceProgramTransitionObservation = Object.freeze({ ...observed,
    observationDigest: digestValue(observed) });
  const carrier = Object.freeze({ schema: 'source-program-isolated-attempt-evidence-v3' as const,
    authority: 'historical-evidence-only' as const, assessment: value.assessment, observation,
    physicalEvidence: Object.freeze({ unitReceipt: value.unitReceipt, invocation: value.invocation,
      sessionSettlement: settlement, dependencyCache: 'private-ephemeral' as const, workspaceTerminal: 'retired' as const }) });
  const attemptEvidence = Object.freeze({ ...carrier, evidenceDigest: digestValue(carrier) });
  parseTrustedRuntimeSourceProgramAttemptEvidence(attemptEvidence);
  throwIfNativeAborted(input.signal);
  if (Date.now() >= deadlineAtUnixMs) fail('settled native Source Program output arrived after its inherited deadline');
  issuedSourceProgramTransitionObservations.add(observation);
  transitionAttemptEvidence.set(observation, attemptEvidence);
  transitionAttemptRoots.set(observation, path.resolve(input.repositoryRoot));
  return Object.freeze({ assessment: value.assessment, observation, attemptEvidence, startedAt,
    finishedAt: new Date().toISOString() });
}

/** The private no-SUT producer is the first physical execution of this Action.
 * Semantic author adoption deliberately happens after complete source production. */
export async function produceTrustedRuntimeSourceProgramTransition(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelope<typeof import('../ci/contract/session-request.ts').VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  sourceProgramTransition: CiSourceProgramTransitionBinding;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  assessment: SourceProgramTransitionAssessment;
  observation: TrustedRuntimeSourceProgramTransitionObservation;
  attemptEvidence: TrustedRuntimeSourceProgramAttemptEvidence;
  sourceAction: TrustedRuntimeSourceProgramAction;
}>> {
  if ('authorApproval' in input || input.sourceProgramTransition.payloadDigest !== null
      || input.sourceProgramTransition.approvalObservationDigest !== null
      || input.sourceProgramTransition.approvalDigest !== null) {
    fail('first-qualified source production cannot consume author approval');
  }
  const binding = assertTransitionInput(input)!;
  const produced = await executeIsolatedSourceProgramTransition({ ...input, binding });
  const observation = produced.observation;
  if (observation.origin !== 'first-qualified') fail('first source Action has a predecessor');
  const plan = input.envelope.actionPlanClosure.actions.find(
    ({ action }) => action.actionKey === observation.actionKey)!;
  const operation = input.envelope.actionPlanClosure.normalizedOperations.find(
    ({ gateId }) => gateId === SOURCE_PROGRAM_TRANSITION_GATE_ID)!;
  const gate = Object.freeze({ action: plan.action, result: CodexDevelopmentBuildVerificationGateResult({
    gateId: SOURCE_PROGRAM_TRANSITION_GATE_ID, gateRevision: plan.action.operation.revision,
    owner: 'ci-verification-maintainer', requirementKey: `gate:${SOURCE_PROGRAM_TRANSITION_GATE_ID}`,
    subjectRevision: observation.headSha, inputDigest: observation.actionKey,
    applicability: 'required', status: 'passed', disposition: 'executed', reasonCode: 'executed-success',
    requiredForClaims: [`gate:${SOURCE_PROGRAM_TRANSITION_GATE_ID}`], supportedClaims: [`gate:${SOURCE_PROGRAM_TRANSITION_GATE_ID}`],
    environment: { runtime: operation.runtime, os: 'linux', arch: 'x64', filesystem: null,
      capabilities: [], toolchainRevision: plan.action.environment.toolchainRevision,
      providerRevisions: [plan.action.environment.providerRevision] },
    execution: { argv: [...ciVerificationNormalizedOperationArgv(operation)], startedAt: produced.startedAt,
      finishedAt: produced.finishedAt, durationMs: Date.parse(produced.finishedAt) - Date.parse(produced.startedAt),
      exitCode: 0, outputDigest: observation.sourceActionOutputDigest, failureFingerprint: null },
    evidenceRefs: [observation.sourceActionOutputDigest],
    invalidationRules: ['ActionKey, source, compiler, dependency, session, or isolation changes'], diagnostic: null
  }), cleanup: Object.freeze({ status: 'passed' as const,
    evidenceRefs: [produced.attemptEvidence.evidenceDigest], diagnostic: null }) });
  const canonical = Object.freeze({ schema: 'source-program-qualified-action-v1' as const,
    authority: 'historical-evidence-only' as const, sessionRevision: observation.sessionRevision,
    observationDigest: observation.observationDigest, attemptEvidenceDigest: produced.attemptEvidence.evidenceDigest,
    outputByteDigest: observation.sourceActionOutputDigest, gate });
  const sourceAction = Object.freeze({ ...canonical, sourceActionDigest: digestValue(canonical) });
  issuedSourceProgramActions.set(sourceAction, observation);
  sourceProgramObservationActions.set(observation, sourceAction);
  assertTrustedRuntimeSourceProgramAction(sourceAction, { envelope: input.envelope });
  return Object.freeze({ assessment: produced.assessment, observation,
    attemptEvidence: produced.attemptEvidence, sourceAction });
}

export async function executeTrustedRuntimeContainerVerification(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelope<typeof import('../ci/contract/session-request.ts').VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  actorNodeId: string;
  requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
  sourceProgramTransition?: CiSourceProgramTransitionBinding;
  authorApproval?: SourceProgramTestAuthorApproval;
  sourceAction?: TrustedRuntimeSourceProgramAction;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  canonicalEvidenceBytes: string;
  receipt: TrustedRuntimeContainerReceipt;
}>> {
  assertTransitionInput(input);
  if (input.sourceAction !== undefined) assertTrustedRuntimeSourceProgramAction(input.sourceAction, { envelope: input.envelope });
  const session = input.envelope.session;
  const completed = await withTrustedRuntimeNativeWorkspace({
    repositoryRoot: path.resolve(input.repositoryRoot), repository: session.repository,
    baseSha: session.baseSha, baseTreeSha: session.baseTreeSha,
    headSha: session.headSha, headTreeSha: session.headTreeSha,
    operationKey: `session-${session.sessionRevision.slice(7, 31)}`,
    deadlineAtUnixMs: input.deadlineAtUnixMs, signal: input.signal,
    execute: async (workspace) => {
      if (input.envelope.actionPlanClosure.actions.some(({ action }) =>
        action.environment.providerRevision !== workspace.executionEnvironment.executionEnvironmentRevision)) {
        fail('verification Action plan differs from the accepted native execution environment');
      }
      const executionId = `trusted-runtime-${randomUUID()}`;
      const result = await workspace.execute(Object.freeze({
        kind: 'verification-action', cwd: 'trusted',
        argv: Object.freeze(['run', '--no-env-file', `--config=${TRUSTED_RUNTIME_TRUSTED_TREE}/bunfig.toml`,
          `${TRUSTED_RUNTIME_TRUSTED_TREE}/${CI_VERIFICATION_WORKFLOW_PATH}`,
          '--profile', session.profile, '--expected-head', session.headSha]),
        environment: formalEnvironment({ envelope: input.envelope, executionId,
          executionEnvironment: workspace.executionEnvironment, actorNodeId: input.actorNodeId,
          requiredBlobs: input.requiredBlobs, sourceProgramTransition: input.sourceProgramTransition,
          sourceAction: input.sourceAction }),
        outputFiles: Object.freeze([
          { path: `${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`, maxBytes: 64 * 1024 * 1024 },
          ...(input.sourceAction === undefined && input.sourceProgramTransition !== undefined
            ? [{ path: `${TRUSTED_RUNTIME_OUTPUT}/${SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE}`, maxBytes: SOURCE_PROGRAM_TRANSITION_STDOUT_BYTE_LIMIT }]
            : [])
        ]),
        maxStdoutBytes: 64 * 1024 * 1024, maxStderrBytes: 16 * 1024 * 1024
      }));
      const evidenceBytes = result.outputFiles[`${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`];
      if (evidenceBytes === undefined) fail('native verification evidence output was not captured');
      const canonicalEvidenceBytes = Buffer.from(evidenceBytes).toString('utf8');
    const parsed = JSON.parse(canonicalEvidenceBytes) as VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
    if (canonicalEvidenceBytes !== `${encodeVerificationActionData(parsed)}\n`) {
      fail('verification Evidence durable bytes are not canonical');
    }
    if (parsed.status !== 'passed' || parsed.sessionRevision !== session.sessionRevision
        || parsed.baseSha !== session.baseSha || parsed.headSha !== session.headSha
        || parsed.headTreeSha !== session.headTreeSha
        || parsed.actionPlan.actionPlanDigest !== input.envelope.actionPlanClosure.actionPlanDigest
        || parsed.producer.sourceTransport !== 'local-dev-runner'
        || parsed.producer.workflowPath !== CI_VERIFICATION_WORKFLOW_PATH
        || parsed.producer.workflowSha !== session.baseSha
        || parsed.producer.runId !== executionId
        || parsed.producer.actorNodeId !== input.actorNodeId) {
      fail('verification Evidence does not bind the trusted runtime Session');
    }
    let sourceProgramTransition: TrustedRuntimeContainerReceipt['sourceProgramTransition'];
    if (input.sourceAction !== undefined) {
      assertTrustedRuntimeSourceProgramAction(input.sourceAction, { envelope: input.envelope });
      const actual = parsed.gates.filter(({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID);
      if (actual.length !== 1 || encodeVerificationActionData(actual[0]) !== encodeVerificationActionData(input.sourceAction.gate)) {
        fail('ordinary verification did not retain the exact first-qualified source Action');
      }
      const observed = issuedSourceProgramActions.get(input.sourceAction)!;
      sourceProgramTransition = Object.freeze({ assessmentDigest: observed.assessmentDigest,
        outputByteDigest: digest(input.sourceAction.outputByteDigest, 'source Action output'),
        actionKey: input.sourceAction.gate.action.actionKey });
    } else if (input.sourceProgramTransition !== undefined) {
      const transitionOutput = result.outputFiles[`${TRUSTED_RUNTIME_OUTPUT}/${SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE}`];
      if (transitionOutput === undefined) fail('native transition output file was not captured');
      const transitionBytes = Buffer.from(transitionOutput).toString('utf8');
      const assessment = parseSourceProgramTransitionAssessment(JSON.parse(transitionBytes));
      const gate = parsed.gates.find(({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID);
      if (transitionBytes !== `${encodeVerificationActionData(assessment)}\n`
          || gate?.result.status !== 'passed' || gate.result.evidenceRefs.length !== 1
          || gate.result.evidenceRefs[0] !== digestBytes(transitionBytes)
          || assessment.baseSha !== session.baseSha || assessment.headSha !== session.headSha
          || assessment.baseTreeSha !== session.baseTreeSha || assessment.headTreeSha !== session.headTreeSha
          || assessment.runtimeSha !== session.baseSha) {
        fail('assessment completion bytes differ from the exact Action producer output');
      }
      sourceProgramTransition = Object.freeze({ assessmentDigest: assessment.assessmentDigest,
        outputByteDigest: digestBytes(transitionBytes),
        actionKey: gate.action.actionKey });
    }
      const receipt = createNativeReceipt({
        executionId,
        ...(sourceProgramTransition === undefined ? {} : { sourceProgramTransition }),
        sessionRevision: digest(session.sessionRevision, 'sessionRevision'),
        baseSha: session.baseSha, baseTreeSha: session.baseTreeSha, headSha: session.headSha, headTreeSha: session.headTreeSha,
        unitReceipt: result.receipt, networkIsolatedBeforeSut: true,
        evidenceByteDigest: digestBytes(evidenceBytes), evidenceByteLength: evidenceBytes.byteLength,
        evidenceDigest: digest(parsed.evidenceDigest, 'evidenceDigest'),
        producerSourceDigest: digest(parsed.producer.sourceDigest, 'producer.sourceDigest')
      });
      return Object.freeze({ evidence: parsed, canonicalEvidenceBytes, receipt });
    }
  });
  const receipt = completed.value.receipt;
  if (completed.settlement.processReceipt === null || completed.settlement.unitReceiptDigests.length !== 1
      || completed.settlement.unitReceiptDigests[0] !== receipt.unitReceipt.receiptDigest) {
    fail('verification lacks its exact native unit and session settlement');
  }
  // Rejoin the same retained Action only after the independent verification unit settled.
  if (input.sourceAction !== undefined) assertTrustedRuntimeSourceProgramAction(input.sourceAction, { envelope: input.envelope });
  return completed.value;
}

const mainHealthExecutionRoots = new WeakMap<object, Readonly<{
  repositoryRoot: string;
  physicalRoot: PhysicalDirectoryIdentity;
  expiresAt: string;
  signal: AbortSignal | undefined;
}>>();

/** Neither the public data factory, parser nor durable-file reader can issue
 * this qualification. The same live computation may be reread at T1 and T2. */
export function assertTrustedRuntimeMainHealthQualification(input: Readonly<{
  receipt: TrustedRuntimeMainHealthReceipt;
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
}>): Readonly<{ expiresAt: string }> {
  const binding = mainHealthExecutionRoots.get(input.receipt);
  if (binding !== undefined) throwIfNativeAborted(binding.signal);
  if (binding === undefined || binding.repositoryRoot !== path.resolve(input.repositoryRoot)
      || Date.now() >= Date.parse(binding.expiresAt)
      || input.receipt.repository !== input.repository
      || input.receipt.mainSha !== input.mainSha
      || input.receipt.mainTreeSha !== input.mainTreeSha) {
    fail('MainHealth requires current live production execution qualification for this exact root and main');
  }
  assertSameNoFollowDirectoryIdentity(binding.physicalRoot, 'MainHealth qualified repository root');
  return Object.freeze({ expiresAt: binding.expiresAt });
}

async function executeTrustedRuntimeMainHealthCommands(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now?: () => Date;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
  selectedCommand?: (typeof TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS)[number];
}>) {
  if (input.selectedCommand !== undefined && !TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.includes(input.selectedCommand)) {
    fail('MainHealth single-check selector is outside the closed command set');
  }
  const commands = input.selectedCommand === undefined ? TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS : [input.selectedCommand];
  const mainSha = sha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = sha(input.mainTreeSha, 'MainHealth mainTreeSha');
  const completed = await withTrustedRuntimeNativeWorkspace({
    repositoryRoot: path.resolve(input.repositoryRoot), repository: input.repository,
    baseSha: mainSha, baseTreeSha: mainTreeSha, headSha: mainSha, headTreeSha: mainTreeSha,
    operationKey: `main-health-${mainSha.slice(0, 24)}`,
    deadlineAtUnixMs: input.deadlineAtUnixMs, signal: input.signal,
    execute: async (workspace) => {
      const actionResults: Array<Readonly<{ command: string; resultDigest: Digest; unitReceipt: LinuxVerificationUnitReceipt }>> = [];
      for (const command of commands) {
        const result = await workspace.execute(createTrustedRuntimeNativeMainHealthInvocation(command));
        if ([result.receipt.gitBefore, result.receipt.gitAfter].some(identity => identity.baseSha !== mainSha
            || identity.headSha !== mainSha || identity.baseTreeSha !== mainTreeSha
            || identity.headTreeSha !== mainTreeSha || identity.status !== '')) {
          fail('MainHealth native unit exact-main identity changed before or during execution');
        }
        actionResults.push(Object.freeze({ command, unitReceipt: result.receipt,
          resultDigest: digestValue({ command, exitCode: result.receipt.execution.exitCode,
            stdoutDigest: result.receipt.execution.stdoutDigest,
            stderrDigest: result.receipt.execution.stderrDigest, unitReceiptDigest: result.receipt.receiptDigest }) }));
      }
      return Object.freeze(actionResults);
    }
  });
  if (completed.settlement.processReceipt === null
      || encodeVerificationActionData(completed.settlement.unitReceiptDigests)
        !== encodeVerificationActionData(completed.value.map(({ unitReceipt }) => unitReceipt.receiptDigest))) {
    fail('MainHealth lacks successful native session settlement for every selected unit');
  }
  const first = completed.value[0]!.unitReceipt;
  return Object.freeze({ repository: repository(input.repository), mainSha, mainTreeSha,
    executionId: `trusted-main-health-${first.boundAttemptDigest.slice(7, 31)}`,
    dependencyCacheKey: null,
    planDigest: digestValue({ schema: 'sec-trusted-runtime-main-health-plan-v3',
      canonicalHostedCommands: commands, profileDigest: first.profileDigest,
      runtimeManifestDigest: first.inputs.runtimeManifestDigest }),
    actionResults: completed.value,
    observedAt: (input.now ?? (() => new Date()))().toISOString() });
}

export async function executeTrustedRuntimeMainHealth(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now?: () => Date;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>): Promise<TrustedRuntimeMainHealthNativeReceipt> {
  return createTrustedRuntimeNativeMainHealthReceipt(await executeTrustedRuntimeMainHealthCommands(input));
}

/** One actual isolated check for one canonical hosted step. This never enters
 * the MainHealth live-proof registry or claims that the other four checks ran. */
export async function executeTrustedRuntimeMainHealthCheck(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  command: (typeof TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS)[number];
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>) {
  input = Object.freeze({ repositoryRoot: input.repositoryRoot, repository: input.repository,
    mainSha: input.mainSha, mainTreeSha: input.mainTreeSha, command: input.command,
    deadlineAtUnixMs: input.deadlineAtUnixMs, signal: input.signal });
  if (!TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.includes(input.command)) {
    fail('MainHealth single-check selector is outside the closed command set');
  }
  const observation = await executeTrustedRuntimeMainHealthCommands({ ...input, selectedCommand: input.command });
  if (observation.actionResults.length !== 1 || observation.actionResults[0]!.command !== input.command) {
    fail('MainHealth single-check result differs from the admitted command');
  }
  return Object.freeze({ schema: 'sec-trusted-runtime-main-health-check-v2' as const,
    authority: 'single-check-observation-only' as const, ...observation,
    command: input.command, resultDigest: observation.actionResults[0]!.resultDigest });
}

/** The admitted physical execution budget bounds the entire live consumption
 * scope. Every exit revokes the proof; serialized results remain historical. */
export async function withTrustedRuntimeMainHealthQualification<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  /** Parent budget may only shorten this operation; it never renews on reads. */
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>, operation: (receipt: TrustedRuntimeMainHealthReceipt) => Promise<T>): Promise<T> {
  const signal = input.signal;
  throwIfNativeAborted(signal);
  if (input.deadlineAtUnixMs !== undefined
      && (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now())) {
    fail('MainHealth parent operation deadline is invalid or expired');
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const physicalRoot = inspectNoFollowDirectoryChain(repositoryRoot, 'MainHealth repository root').target;
  const deadlineAtUnixMs = Math.min(
    Date.now() + TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs,
    input.deadlineAtUnixMs ?? Number.POSITIVE_INFINITY
  );
  const receipt = await executeTrustedRuntimeMainHealth({ ...input, signal, repositoryRoot, deadlineAtUnixMs });
  throwIfNativeAborted(signal);
  // The workspace has completed setup, execution, cleanup and settlement.
  assertSameNoFollowDirectoryIdentity(physicalRoot, 'MainHealth settled repository root');
  mainHealthExecutionRoots.set(receipt, Object.freeze({
    repositoryRoot,
    physicalRoot,
    signal,
    expiresAt: new Date(deadlineAtUnixMs).toISOString()
  }));
  try {
    assertTrustedRuntimeMainHealthQualification({ ...input, repositoryRoot, receipt });
    const result = await operation(receipt);
    assertTrustedRuntimeMainHealthQualification({ ...input, repositoryRoot, receipt });
    return result;
  } finally {
    mainHealthExecutionRoots.delete(receipt);
  }
}

export async function executeTrustedRuntimeWorkspaceCanary(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  headSha: string;
  headTreeSha: string;
  dependencies?: boolean;
}>): Promise<Readonly<{
  schema: 'sec-trusted-runtime-workspace-canary-v2';
  repository: string;
  headSha: string;
  headTreeSha: string;
  dependenciesReady: boolean;
  dependencyCacheKey: null;
  unitReceipts: readonly LinuxVerificationUnitReceipt[];
}>> {
  const headSha = sha(input.headSha, 'workspace canary headSha');
  const headTreeSha = sha(input.headTreeSha, 'workspace canary headTreeSha');
  const completed = await withTrustedRuntimeNativeWorkspace({
    repositoryRoot: path.resolve(input.repositoryRoot), repository: input.repository,
    baseSha: headSha, baseTreeSha: headTreeSha, headSha, headTreeSha,
    operationKey: `${input.dependencies === true ? 'dependency' : 'canary'}-${headSha.slice(0, 24)}`,
    dependencies: input.dependencies === true,
    execute: async (workspace) => {
      const environment = Object.freeze({ CI: '1', HOME: '/tmp/home', LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
        ...TRUSTED_RUNTIME_STATE_ENVIRONMENT });
      const receipts: LinuxVerificationUnitReceipt[] = [];
      if (input.dependencies === true) {
        // The provider resolves its explicit accepted tree. NODE_PATH cannot
        // alter that direct file lookup; the second process changes only cwd.
        const argv = Object.freeze(['--no-install', `${TRUSTED_RUNTIME_TRUSTED_TREE}/${TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH}`,
          '--resolve-from', TRUSTED_RUNTIME_TRUSTED_TREE]);
        const results: Uint8Array[] = [];
        for (const cwd of ['trusted', 'scratch'] as const) {
          const result = await workspace.execute(Object.freeze({ kind: 'dependency-canary', cwd, argv, environment,
            outputFiles: Object.freeze([]), maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 }));
          results.push(result.stdout);
          receipts.push(result.receipt);
        }
        if (!Buffer.from(results[0]!).equals(Buffer.from(results[1]!))) {
          fail('dependency canary isolated cwd observed a different TypeScript Provider');
        }
        const provider = JSON.parse(Buffer.from(results[0]!).toString('utf8')) as Record<string, unknown>;
        if (provider === null || typeof provider !== 'object' || provider.capability !== 'typescript-project-typecheck'
            || provider.providerId !== 'typescript-native-cli') {
          fail('dependency canary produced no canonical TypeScript Provider observation');
        }
      } else {
        const result = await workspace.execute(Object.freeze({ kind: 'lifecycle-canary', cwd: 'candidate',
          argv: Object.freeze([]), environment, outputFiles: Object.freeze([]),
          maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 }));
        if (Buffer.from(result.stdout).toString('utf8').trim() !== ENVIRONMENT.trustedRuntime.bunVersion) {
          fail('lifecycle canary Bun version differs from the accepted runtime');
        }
        receipts.push(result.receipt);
      }
      for (const receipt of receipts) {
        if (receipt.unit.trustedPackageReadable !== true || receipt.unit.outputWritable !== true
            || (input.dependencies === true) !== (receipt.inputs.dependencyContentDigest !== null)) {
          fail('native workspace canary did not observe its original readiness and dependency scope');
        }
        if ([receipt.gitBefore, receipt.gitAfter].some(identity => identity.baseSha !== headSha
            || identity.headSha !== headSha || identity.baseTreeSha !== headTreeSha
            || identity.headTreeSha !== headTreeSha || identity.status !== '')) {
          fail('native workspace canary exact Git identity or clean state differs');
        }
      }
      return Object.freeze(receipts);
    }
  });
  if (completed.settlement.processReceipt === null
      || encodeVerificationActionData(completed.settlement.unitReceiptDigests)
        !== encodeVerificationActionData(completed.value.map(({ receiptDigest }: LinuxVerificationUnitReceipt) => receiptDigest))) {
    fail('native canary has no complete original physical settlement');
  }
  return Object.freeze({ schema: 'sec-trusted-runtime-workspace-canary-v2',
    repository: repository(input.repository), headSha, headTreeSha,
    dependenciesReady: input.dependencies === true, dependencyCacheKey: null,
    unitReceipts: completed.value });
}
