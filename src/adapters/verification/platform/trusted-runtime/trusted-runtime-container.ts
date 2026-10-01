import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import { CI_VERIFICATION_WORKFLOW_PATH } from '../../../../assurance/verification/contract/revision.ts';
import { CodexDevelopmentBuildVerificationGateResult } from '../../../../assurance/verification/result/contract/result.ts';
import { throwIfNativeAborted } from '../../../../contracts/native-abort.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecProviderSettlementSet,
  compileSecSemanticOperationPlan,
  issueSecNormalDomainReadbackReceipt,
  issueSecNormalOwnerTerminalJoinReceipt,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecOwnerTerminalJoinReceipt,
  type SecProviderSettlementReceipt
} from '../../../../execution/operation/semantic.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../../execution/resource-settlement.ts';
import type {
  ContainerEngineOperation,
  ContainerEngineOperationOptions,
  ContainerEngineOperationScope,
  ContainerEngineSession
} from '../../../providers/docker/contract/container-engine-session.ts';
import {
  parseDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../../../providers/docker/contract/daemon.ts';
import { disposeUnclaimedDockerCommandProviderCapability } from '../../../providers/docker/runtime/command-provider.ts';
import {
  openContainerEngineSession
} from '../../../providers/docker/runtime/container-engine-session.ts';
import {
  openWindowsDockerCommandProvider
} from '../../../providers/docker/runtime/windows-command-provider.ts';
import {
  assertGitCandidateBundleReceipt,
  closeGitCandidateBundle,
  createGitCandidateBundle,
  type GitCandidateBundle
} from '../../../providers/git-bundle/runtime.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { isolatedGitChildEnvironment } from '../../../providers/git-read/runtime/session.ts';
import { withGitHubApiReadSession } from '../../../providers/github-api/operation-session.ts';
import { observeGitHubRepositoryComment } from '../../../providers/github-api/repository-comment.ts';
import {
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
  SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH,
  SEC_LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH
} from '../../../providers/linux-verification/contract.ts';
import { repositoryAuditInheritedDeadline, SOURCE_PROGRAM_TRANSITION_DEADLINE_ENV } from '../../../repository/repository-audit/cli-contract.ts';
import { compileSourceProgramTransitionAdoption, parseSourceProgramTransitionAssessment, type SourceProgramTransitionAssessment } from '../../../repository/repository-audit/transition.ts';
import { adoptSourceProgramTestAuthorDecision, assertSourceProgramTestAuthorApproval, type SourceProgramTestAuthorApproval } from '../../../repository/source-program-model/test-disposition-decisions.ts';
import {
  parseGitObjectIdReply
} from '../../../runtime-state/physical/contract/git-worktree-observation.ts';
import { acquirePhysicalMutationLease } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import { resolveSecRuntimeStateForRepository } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import {
  createTrustedRuntimeMainHealthReceipt,
  TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
  type TrustedRuntimeMainHealthReceipt
} from '../../../self-hosting/control/main-health/main-health-observation.ts';
import { compilerRuntimeLayout } from '../../../toolchain/runtime/layout.ts';
import { TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH } from '../../../toolchain/typescript/canary.ts';
import { encodeVerificationActionData } from '../action/contract/action.ts';
import { ciVerificationGateStep, ciVerificationNormalizedOperationArgv, createCiVerificationLocalExecutionEnvironment, parseCiSourceProgramTransitionBinding, SOURCE_PROGRAM_TRANSITION_ENTRYPOINT, SOURCE_PROGRAM_TRANSITION_GATE_ID, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE, SOURCE_PROGRAM_TRANSITION_STDOUT_BYTE_LIMIT, sourceProgramAnalysisBinding, sourceProgramTransitionGate, type CiSourceProgramTransitionBinding, type CiVerificationExecutionEnvironment } from '../action/contract/ci.ts';
import { parseTrustedRuntimeSourceProgramActionRecord, type CodexDevelopmentVerificationEvidenceV4, type CodexDevelopmentVerificationGateEvidenceV4, type TrustedRuntimeSourceProgramActionRecord } from '../ci/contract/evidence.ts';
import {
  createBuildxRawJsonProgressAdmission,
  ensureLocalGitHubActionsRunnerToolchainMaterialization,
  type LocalGitHubActionsRunnerToolchainMaterialization
} from '../ci/runtime/local-github-actions-runner.ts';
import type { VerificationSessionHostedEnvelope } from '../ci/runtime/verification-session-runtime.ts';

const ENVIRONMENT = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
const TRUSTED_RUNTIME_CONTAINER_SCHEMA = ENVIRONMENT.trustedRuntime.imageSchema;
const TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA =
  'sec-trusted-runtime-dependency-cache-v1' as const;
const TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA =
  'sec-trusted-runtime-dependency-cache-volume-v1' as const;
const TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE =
  '.sec-derived-cache.json' as const;
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
  expected: Readonly<{ envelope?: VerificationSessionHostedEnvelope }> = {}
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
  completion?: CodexDevelopmentVerificationGateEvidenceV4
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

export interface TrustedRuntimeContainerReceipt {
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
const TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET = Object.freeze({
  durationMs: TRUSTED_RUNTIME_CONTAINER_OPERATION_LEASE_MS,
  inputBytes: 64 * 1024 * 1024,
  outputBytes: 512 * 1024 * 1024,
  processes: 512
});

function bindTrustedRuntimeContainerEngineOperation(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  headSha: string;
  operationKey: string;
  setupMode: 'full' | 'lifecycle-canary' | 'dependency-canary';
  providerIdentityDigest: SecOperationDigest;
  deadlineAtUnixMs?: number;
}>): SecBoundSemanticOperation {
  const contractDigest = digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-container-engine-contract-v1',
    environment: ENVIRONMENT.provider.requirement,
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
  })) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'verification.trusted-runtime-container',
    intentDigest: digestValue(Object.freeze({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      baseSha: input.baseSha,
      headSha: input.headSha,
      operationKey: input.operationKey,
      setupMode: input.setupMode
    })) as SecOperationDigest,
    decisionDigest: digestValue(Object.freeze({
      contractDigest,
      budget: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET
    })) as SecOperationDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
      ?? Date.now() + TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs },
      { resource: 'input-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.inputBytes },
      { resource: 'output-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.outputBytes },
      { resource: 'processes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.processes }
    ],
    requirements: [{
      id: 'external.container-engine-process',
      contractDigest,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'container-engine.admission-failed',
        'container-engine.desktop-launcher-path-unavailable',
        'container-engine.endpoint-unavailable',
        'container-engine.process-settlement-failed',
        'container-engine.runtime-endpoint-residue'
      ]
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    })
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: 'external.container-engine-process',
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

function issueTrustedRuntimeContainerEngineTerminalJoinWithSettlements(input: Readonly<{
  operation: SecBoundSemanticOperation;
  primaryProviderSettlement: SecProviderSettlementReceipt;
  providerSettlements: readonly SecProviderSettlementReceipt[];
  endpointReadback: DockerEndpointIdentity;
  ownerTerminalContractDigest: SecOperationDigest;
  ownerTerminalReferenceDigest: SecOperationDigest;
}>) {
  const providerSettlementSet = compileSecProviderSettlementSet(
    input.operation,
    input.providerSettlements
  );
  const readback = issueSecNormalDomainReadbackReceipt(input.operation, providerSettlementSet, {
    readbackContractDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-endpoint-readback-contract-v1',
      contextName: input.endpointReadback.contextName,
      endpointHost: input.endpointReadback.endpointHost
    })) as SecOperationDigest,
    readbackReferenceDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-endpoint-readback-v1',
      endpoint: input.endpointReadback
    })) as SecOperationDigest,
    currentPhysicalEpochDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-physical-epoch-v1',
      endpointHost: input.endpointReadback.endpointHost,
      daemonId: input.endpointReadback.daemonId
    })) as SecOperationDigest,
    disposition: input.primaryProviderSettlement.physicalDisposition === 'settled'
      ? 'applied'
      : input.primaryProviderSettlement.physicalDisposition === 'not-started'
        ? 'not-applied'
        : 'unknown'
  });
  const ownerTerminalProjection = issueSecNormalOwnerTerminalJoinReceipt(
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
  operation: SecBoundSemanticOperation;
  providerSettlement: SecProviderSettlementReceipt;
  endpointReadback: DockerEndpointIdentity;
  ownerTerminalContractDigest: SecOperationDigest;
  ownerTerminalReferenceDigest: SecOperationDigest;
}>): SecOwnerTerminalJoinReceipt {
  return issueTrustedRuntimeContainerEngineTerminalJoinWithSettlements({
    ...input,
    primaryProviderSettlement: input.providerSettlement,
    providerSettlements: [input.providerSettlement]
  }).ownerTerminalProjection;
}

type TrustedRuntimeContainerEngineSettlement = Readonly<{
  operation: SecBoundSemanticOperation;
  ownerTerminalReference: Readonly<Record<string, unknown>>;
  endpointReadback: DockerEndpointIdentity;
}> & ReturnType<typeof issueTrustedRuntimeContainerEngineTerminalJoinWithSettlements>;

async function settleTrustedRuntimeContainerEngineOperation(input: Readonly<{
  session: ContainerEngineSession;
  operation: SecBoundSemanticOperation;
  scope: ContainerEngineOperationScope;
  ownerTerminalReference: Readonly<Record<string, unknown>>;
  observeSettlement?: (settlement: TrustedRuntimeContainerEngineSettlement) => void;
}>): Promise<TrustedRuntimeContainerEngineSettlement> {
  const providerSettlement = input.scope.settle();
  const endpointReadback = await input.session.observeEndpoint();
  const joined = issueTrustedRuntimeContainerEngineTerminalJoinWithSettlements({
    operation: input.operation, primaryProviderSettlement: providerSettlement,
    providerSettlements: [providerSettlement], endpointReadback,
    ownerTerminalContractDigest: digestValue(Object.freeze({
      schema: 'sec-trusted-runtime-container-engine-owner-terminal-contract-v1',
      operation: input.operation.plan.identity.operation
    })) as SecOperationDigest,
    ownerTerminalReferenceDigest: digestValue(Object.freeze({
      schema: 'sec-trusted-runtime-container-engine-owner-terminal-reference-v1',
      ...input.ownerTerminalReference
    })) as SecOperationDigest
  });
  const settlement = Object.freeze({ operation: input.operation,
    ownerTerminalReference: input.ownerTerminalReference, endpointReadback, ...joined });
  input.observeSettlement?.(settlement);
  return settlement;
}

async function executeTrustedRuntimeContainerEngineOwnerOperation<T>(input: Readonly<{
  session: ContainerEngineSession;
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  headSha: string;
  operationKey: string;
  setupMode: 'full' | 'lifecycle-canary' | 'dependency-canary';
  execute: () => Promise<T>;
  observeSettlement?: (settlement: TrustedRuntimeContainerEngineSettlement) => void;
}>): Promise<T> {
  const operation = bindTrustedRuntimeContainerEngineOperation({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    baseSha: input.baseSha,
    headSha: input.headSha,
    operationKey: input.operationKey,
    setupMode: input.setupMode,
    providerIdentityDigest: input.session.providerIdentityDigest,
    deadlineAtUnixMs: input.session.deadlineAtUnixMs
  });
  const scope = input.session.openOperationScope({
    operation,
    requirementId: 'external.container-engine-process'
  });
  try {
    return await input.execute();
  } finally {
    await settleTrustedRuntimeContainerEngineOperation({
      observeSettlement: input.observeSettlement,
      session: input.session,
      operation,
      scope,
      ownerTerminalReference: Object.freeze({
        phase: 'owner-operation',
        operationKey: input.operationKey
      })
    });
  }
}

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

function canonicalDependencyCacheMarkerBytes(
  marker: TrustedRuntimeDependencyCacheMarker
): Uint8Array {
  return Buffer.from(`${encodeVerificationActionData(marker)}\n`, 'utf8');
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

async function observeContainerEngineOperation(
  session: ContainerEngineSession,
  operation: ContainerEngineOperation,
  options: ContainerEngineOperationOptions = {}
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  const result = await session.execute(operation, options);
  return Object.freeze({
    code: result.code,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8')
  });
}

async function containerEngineOperationResult(
  session: ContainerEngineSession,
  operation: ContainerEngineOperation,
  options: ContainerEngineOperationOptions = {}
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  const result = await observeContainerEngineOperation(session, operation, options);
  if (result.code !== 0) {
    fail(`Container Engine ${operation.kind} failed (${result.code}): ${
      renderTrustedRuntimeCommandFailureDetail(result)}`);
  }
  return result;
}

async function containerEngineOutput(
  session: ContainerEngineSession,
  operation: ContainerEngineOperation,
  options: ContainerEngineOperationOptions = {}
): Promise<string> {
  return (await containerEngineOperationResult(session, operation, options)).stdout.trim();
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

const TRUSTED_RUNTIME_OWNER_HOST = hostname();

function localProcessLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
      return 'dead';
    }
    return 'unknown';
  }
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

async function inspectContainerIdentity(
  session: ContainerEngineSession,
  container: string
): Promise<TrustedRuntimeContainerIdentity> {
  return parseTrustedRuntimeContainerIdentity(await containerEngineOutput(session, {
    kind: 'container-inspect', arguments: [container]
  }));
}

/**
 * Dead local owners are collected only after two identical Docker identity
 * observations. Unknown, foreign-host, live, malformed, or changed resources
 * are retained and block the same operation while its repository-scoped lease
 * is held; a collision-free name cannot bypass an unresolved prior start.
 */
async function reclaimAbandonedTrustedRuntimeContainers(input: Readonly<{
  session: ContainerEngineSession;
  operationKey: string;
  repository: string;
  baseSha: string;
  headSha: string;
  endpointDigest: Digest;
  imageId: string;
  imageLabels: Readonly<Record<string, string>>;
  dependencyCacheKey?: Digest;
  dependencyCacheVolumeName: string | null;
}>): Promise<void> {
  const list = await observeContainerEngineOperation(input.session, {
    kind: 'container-list',
    arguments: [
      '--all', '--quiet', '--no-trunc',
      '--filter', `label=sec.trusted-runtime.operation=${input.operationKey}`
    ]
  }, { acceptAnyExitCode: true });
  if (list.code !== 0) {
    fail(`Docker abandoned-container inventory failed: ${list.stderr.trim().slice(-4_096)}`);
  }
  const idLines = list.stdout.split(/\r?\n/u);
  while (idLines.at(-1) === '') idLines.pop();
  if (idLines.some((value) => !/^[0-9a-f]{64}$/u.test(value))
      || new Set(idLines).size !== idLines.length) {
    fail('Docker abandoned-container inventory is malformed or duplicated');
  }
  const ids = Object.freeze([...idLines]);
  for (const id of ids) {
    let first: TrustedRuntimeContainerIdentity;
    try {
      first = await inspectContainerIdentity(input.session, id);
    } catch (error) {
      fail(`Docker abandoned-container identity cannot be observed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let confirmed: TrustedRuntimeContainerIdentity;
    try {
      confirmed = await inspectContainerIdentity(input.session, first.id);
    } catch (error) {
      fail(`Docker abandoned-container confirmation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const recoveryTarget = authorizeTrustedRuntimeContainerRecovery({
      first,
      confirmed,
      expected: {
        operationKey: input.operationKey,
        repository: input.repository,
        baseSha: input.baseSha,
        headSha: input.headSha,
        endpointDigest: input.endpointDigest,
        imageId: input.imageId,
        imageLabels: input.imageLabels,
        ownerHost: TRUSTED_RUNTIME_OWNER_HOST,
        dependencyCacheVolumeName: input.dependencyCacheVolumeName,
        ...(input.dependencyCacheKey === undefined ? {} : {
          dependencyCacheKey: input.dependencyCacheKey
        })
      },
      observeProcessLiveness: localProcessLiveness
    });
    const removed = await observeContainerEngineOperation(input.session, {
      kind: 'container-remove', arguments: ['--force', recoveryTarget]
    }, { acceptAnyExitCode: true });
    if (removed.code !== 0) {
      fail(`Docker abandoned-container removal failed: ${removed.stderr.trim().slice(-4_096)}`);
    }
  }
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

async function ensureImage(
  repositoryRoot: string,
  session: ContainerEngineSession
): Promise<TrustedRuntimeContainerImageObservation> {
  const inspected = await observeContainerEngineOperation(session, {
    kind: 'image-inspect', arguments: [TRUSTED_RUNTIME_CONTAINER_IMAGE]
  }, { acceptAnyExitCode: true });
  if (inspected.code === 0) return imageObservation(inspected.stdout);
  const toolchain = await ensureLocalGitHubActionsRunnerToolchainMaterialization({
    repositoryRoot,
    containerEngineSession: session
  });
  if (toolchain.dockerProjectionDigest !== TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID) {
    fail('trusted toolchain base image identity drifted');
  }
  const plan = createTrustedRuntimeImageBuildPlan(toolchain);
  const progress = createBuildxRawJsonProgressAdmission();
  const built = await observeContainerEngineOperation(session, {
    kind: 'buildx-build', arguments: plan.args.slice(2)
  }, {
    acceptAnyExitCode: true,
    maxStdoutBytes: 32 * 1024 * 1024,
    maxStderrBytes: 32 * 1024 * 1024,
    stallTimeoutMs: plan.stallTimeoutMs,
    admitProgress: (chunk, stream) => stream === 'stderr' && progress.push(chunk)
  });
  progress.finish();
  if (built.code !== 0) {
    fail(`docker buildx failed (${built.code}): ${renderTrustedRuntimeCommandFailureDetail(built)}`);
  }
  return imageObservation(await containerEngineOutput(session, {
    kind: 'image-inspect', arguments: [TRUSTED_RUNTIME_CONTAINER_IMAGE]
  }));
}

async function ensureTrustedRuntimeDependencyCacheVolume(input: Readonly<{
  session: ContainerEngineSession;
  endpointDigest: Digest;
  marker: TrustedRuntimeDependencyCacheMarker;
}>): Promise<Readonly<{
  spec: TrustedRuntimeDependencyCacheVolumeSpec;
  observationDigest: Digest;
}>> {
  const spec = createTrustedRuntimeDependencyCacheVolumeSpec(input.marker);
  let inspected = await observeContainerEngineOperation(input.session, {
    kind: 'volume-inspect', arguments: [spec.name]
  }, { acceptAnyExitCode: true });
  if (inspected.code !== 0) {
    if (!/no such volume/iu.test(inspected.stderr)) {
      fail(`Docker dependency-cache volume inventory failed: ${inspected.stderr.trim().slice(-4_096)}`);
    }
    const created = await containerEngineOutput(input.session, {
      kind: 'volume-create',
      arguments: [
        '--driver', 'local',
        ...Object.entries(spec.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        spec.name
      ]
    });
    if (created !== spec.name) fail('Docker dependency-cache volume create returned another name');
    inspected = await containerEngineOperationResult(input.session, {
      kind: 'volume-inspect', arguments: [spec.name]
    });
  }
  return Object.freeze({
    spec,
    observationDigest: assertTrustedRuntimeDependencyCacheVolume({
      source: inspected.stdout,
      expected: spec,
      endpointDigest: input.endpointDigest
    })
  });
}

const PUBLISH_DEPENDENCY_CACHE_MARKER_SCRIPT = [
  'set -euo pipefail',
  'expected="$1"',
  'expected_digest="$2"',
  `root="${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH}"`,
  `marker="$root/${TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE}"`,
  '[ -d "$root" ] && [ ! -L "$root" ]',
  '[ "$(stat -c %a "$root")" = "1777" ] || chmod 1777 "$root"',
  'if [ -e "$marker" ]; then',
  '  [ -f "$marker" ] && [ ! -L "$marker" ]',
  '  [ "$(cat -- "$marker")" = "$expected" ]',
  'else',
  '  temporary="$root/.sec-derived-cache.new-$$"',
  '  (umask 077; set -C; printf \'%s\\n\' "$expected" > "$temporary")',
  '  mv -T -- "$temporary" "$marker"',
  'fi',
  'actual="$(sha256sum "$marker")"',
  'actual="${actual%% *}"',
  '[ "sha256:$actual" = "$expected_digest" ]',
  'printf \'sha256:%s\\n\' "$actual"'
].join('\n');

const READ_DEPENDENCY_CACHE_MARKER_DIGEST_SCRIPT = [
  'set -euo pipefail',
  `marker="${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH}/${TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE}"`,
  '[ -f "$marker" ] && [ ! -L "$marker" ]',
  'actual="$(sha256sum "$marker")"',
  'actual="${actual%% *}"',
  'printf \'sha256:%s\\n\' "$actual"'
].join('\n');

const READ_CANDIDATE_BUNDLE_IDENTITY_SCRIPT = [
  'set -euo pipefail',
  'expected_size="$1"',
  'expected_digest="$2"',
  `bundle="${TRUSTED_RUNTIME_CANDIDATE_BUNDLE}"`,
  '[ -f "$bundle" ] && [ ! -L "$bundle" ]',
  '[ "$(stat -c %s "$bundle")" = "$expected_size" ]',
  'actual="$(sha256sum "$bundle")"',
  'actual="${actual%% *}"',
  '[ "sha256:$actual" = "$expected_digest" ]',
  'printf \'sha256:%s\\n\' "$actual"'
].join('\n');

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
  envelope: VerificationSessionHostedEnvelope;
  executionId: string;
  actorNodeId: string;
  requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
  sourceProgramTransition?: CiSourceProgramTransitionBinding;
  sourceAction?: TrustedRuntimeSourceProgramAction;
}>): readonly string[] {
  const { envelope } = input;
  const values: Readonly<Record<string, string>> = Object.freeze({
    CI: '1',
    HOME: '/home/ubuntu',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
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
      TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
    SEC_TRUSTED_RUNTIME_EXECUTION_ID: input.executionId,
    SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID: input.actorNodeId,
    SEC_CHANGED_BASE: 'refs/sec/base',
    SEC_AFFECTED_TESTS_BASE: 'refs/sec/base',
    SEC_WORK_PACKAGE_MANIFEST_PATH: envelope.session.manifestPath,
    SEC_CI_VERIFICATION_EVIDENCE_PATH: `${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`
  });
  return createTrustedRuntimeCommandEnvironmentArgs(values);
}

function createReceipt(input: Omit<TrustedRuntimeContainerReceipt, 'schema' | 'receiptDigest'>):
TrustedRuntimeContainerReceipt {
  const withoutDigest = Object.freeze({ schema: TRUSTED_RUNTIME_CONTAINER_SCHEMA, ...input });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

export function parseTrustedRuntimeContainerReceipt(
  value: unknown
): TrustedRuntimeContainerReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('receipt must be an object');
  }
  const record = value as Record<string, unknown>;
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

interface TrustedRuntimeWorkspace {
  readonly containerName: string;
  readonly temporaryRoot: string;
  readonly image: TrustedRuntimeContainerImageObservation;
  readonly containerEngineSession: ContainerEngineSession;
  readonly dockerEndpoint: DockerEndpointIdentity;
  readonly dependencyCacheKey: Digest | null;
}

async function withTrustedRuntimeWorkspace<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  headSha: string;
  operationKey: string;
  setupMode: 'full' | 'lifecycle-canary' | 'dependency-canary';
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
  /** Fresh authority consumers never mount a cache writable by candidate execution. */
  dependencyCachePolicy?: 'shared-sut' | 'private-authority';
  observeSettlement?: (settlement: TrustedRuntimeContainerEngineSettlement) => void;
  execute: (workspace: TrustedRuntimeWorkspace) => Promise<T>;
}>): Promise<T> {
  if (input.deadlineAtUnixMs !== undefined && !Number.isSafeInteger(input.deadlineAtUnixMs)) {
    fail('workspace inherited deadline is not a finite safe timestamp');
  }
  const deadlineAtUnixMs = Math.min(input.deadlineAtUnixMs ?? Number.MAX_SAFE_INTEGER,
    Date.now() + TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs);
  const remainingMs = (): number => {
    throwIfNativeAborted(input.signal);
    const remaining = deadlineAtUnixMs - Date.now();
    if (!Number.isSafeInteger(deadlineAtUnixMs) || remaining <= 0) fail('workspace inherited deadline is exhausted or invalid');
    return remaining;
  };
  remainingMs();
  const repositoryRoot = path.resolve(input.repositoryRoot);
  if (!path.isAbsolute(input.repositoryRoot) || repositoryRoot !== input.repositoryRoot) {
    fail('workspace repository root is noncanonical');
  }
  const repositoryIdentity = repository(input.repository);
  const baseSha = sha(input.baseSha, 'workspace baseSha');
  const headSha = sha(input.headSha, 'workspace headSha');
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/u.test(input.operationKey)) {
    fail('workspace operation key is invalid');
  }
  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: repositoryIdentity,
    repositoryRoot
  });
  const operationLeaseRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-runtime-container-leases',
    'v1'
  );
  let operationLeaseAuthority:
    Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | null = null;
  let operationLease: ReturnType<typeof acquirePhysicalMutationLease> = null;
  let commandProvider: Awaited<ReturnType<typeof openWindowsDockerCommandProvider>> | null = null;
  let commandProviderTransferred = false;
  let containerEngineSession: ContainerEngineSession | null = null;
  let primaryFailure: unknown;
  let hasPrimaryFailure = false;
  try {
    operationLeaseAuthority = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot: runtimeLayout.stateRoot,
      cacheRoot: runtimeLayout.cacheRoot,
      requiredDirectories: [operationLeaseRoot]
    });
    operationLease = acquirePhysicalMutationLease(
      operationLeaseAuthority.directory(operationLeaseRoot),
      `container-${input.operationKey}.lock`
    );
    if (operationLease === null) {
      fail('trusted runtime operation is already active or its owner liveness is unknown');
    }
    operationLease.acknowledgeReclaimedRecovery();
    const bunLockBlobSha = input.setupMode === 'lifecycle-canary'
      ? null
      : await withAuthorityGitReadSession({
          cwd: repositoryRoot,
          source: process.env,
          budget: {
            deadlineMs: Math.min(30_000, remainingMs()),
            maxProcesses: 1,
            maxTotalArgumentBytes: 2 * 1024,
            maxStdinBytes: 1,
            maxStdoutBytes: 16 * 1024,
            maxStderrBytes: 16 * 1024,
            maxRecords: 2,
            maxRootObservedBytes: 128 * 1024 * 1024,
            maxReopenRefreshes: 2,
            maxSettlementAttempts: 3,
            maxCommandStdoutBytes: 8 * 1024,
            maxCommandStderrBytes: 8 * 1024,
            maxExecutableBytes: 64 * 1024 * 1024
          }
        }, async (git) => {
          const observed = await git.run([
            'rev-parse', '--verify', '--quiet', '--end-of-options', `${baseSha}:bun.lock`
          ]);
          const objectId = observed.kind === 'completed' && observed.result.code === 0
            ? parseGitObjectIdReply(
                observed.result.stdout,
                baseSha.length === 40 ? 'sha1' : 'sha256'
              )
            : null;
          if (objectId === null) fail('trusted runtime bun.lock blob observation is invalid');
          return objectId;
        });
    remainingMs();
    commandProvider = await openWindowsDockerCommandProvider({
      workingDirectory: repositoryRoot
    });
    const operation = bindTrustedRuntimeContainerEngineOperation({
      repositoryRoot,
      repository: repositoryIdentity,
      baseSha,
      headSha,
      operationKey: input.operationKey,
      setupMode: input.setupMode,
      providerIdentityDigest: commandProvider.providerIdentityDigest,
      deadlineAtUnixMs
    });
    const openingSession = openContainerEngineSession({
      operation,
      provider: commandProvider,
      cwd: repositoryRoot,
      availability: 'ensure-started',
      signal: input.signal
    });
    commandProviderTransferred = true;
    containerEngineSession = await openingSession;
    const session = containerEngineSession;
    const dockerEndpoint = session.endpoint;
    const setupOperation = bindTrustedRuntimeContainerEngineOperation({
      repositoryRoot,
      repository: repositoryIdentity,
      baseSha,
      headSha,
      operationKey: `${input.operationKey}-setup`,
      setupMode: input.setupMode,
      providerIdentityDigest: session.providerIdentityDigest,
      deadlineAtUnixMs: session.deadlineAtUnixMs
    });
    const setupScope = session.openOperationScope({
      operation: setupOperation,
      requirementId: 'external.container-engine-process'
    });
    let setupSettled = false;
    const image = await ensureImage(repositoryRoot, session);
    const endpointDigest = digestValue(dockerEndpoint);
    const dependencyCacheMarker = input.dependencyCachePolicy === 'private-authority' || bunLockBlobSha === null
      ? null
      : createTrustedRuntimeDependencyCacheMarker({
          repository: repositoryIdentity,
          bunLockBlobSha,
          imageId: image.imageId
        });
    const dependencyCacheVolume = dependencyCacheMarker === null
      ? null
      : await ensureTrustedRuntimeDependencyCacheVolume({
          session,
          endpointDigest,
          marker: dependencyCacheMarker
        });
    await reclaimAbandonedTrustedRuntimeContainers({
      session,
      operationKey: input.operationKey,
      repository: repositoryIdentity,
      baseSha,
      headSha,
      endpointDigest,
      imageId: image.imageId,
      imageLabels: image.labels,
      dependencyCacheVolumeName: dependencyCacheVolume?.spec.name ?? null,
      ...(dependencyCacheMarker === null ? {} : {
        dependencyCacheKey: dependencyCacheMarker.cacheKey
      })
    });
    const ownerNonce = randomUUID();
    const containerName = `sec-trusted-runtime-${input.operationKey}-${ownerNonce}`;
    const operationLabels = Object.freeze({
      'sec.trusted-runtime.operation': input.operationKey,
      'sec.trusted-runtime.repository': repositoryIdentity,
      'sec.trusted-runtime.base-sha': baseSha,
      'sec.trusted-runtime.head-sha': headSha,
      'sec.trusted-runtime.endpoint-digest': endpointDigest,
      'sec.trusted-runtime.owner-host': TRUSTED_RUNTIME_OWNER_HOST,
      'sec.trusted-runtime.owner-pid': String(process.pid),
      'sec.trusted-runtime.owner-nonce': ownerNonce,
      'sec.trusted-runtime.image-id': image.imageId,
      ...(dependencyCacheMarker === null ? {} : {
        'sec.trusted-runtime.dependency-cache-key': dependencyCacheMarker.cacheKey
      })
    });
    const containerLabels = composeTrustedRuntimeContainerLabels(image.labels, operationLabels);
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-trusted-runtime-'));
    let containerCreated = false;
    let containerId: string | null = null;
    let candidateBundle: GitCandidateBundle | null = null;
    let workspacePrimary: Readonly<{ label: string; error: unknown }> | undefined;
    try {
      candidateBundle = await createGitCandidateBundle({
        sourceRoot: repositoryRoot,
        temporaryRoot,
        baseSha,
        headSha,
        deadlineAtUnixMs,
        signal: input.signal
      });
      const dependencyCacheMarkerBytes = dependencyCacheMarker === null
        ? null
        : canonicalDependencyCacheMarkerBytes(dependencyCacheMarker);
      const dependencyCacheMarkerFileDigest = dependencyCacheMarkerBytes === null
        ? null
        : digestBytes(dependencyCacheMarkerBytes);
      containerId = await containerEngineOutput(session, {
        kind: 'container-create',
        arguments: ['--name', containerName,
        ...Object.entries(containerLabels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '--init',
        '--read-only',
        '--pids-limit', String(ENVIRONMENT.runtime.resources.trusted.pids),
        '--cpus', String(ENVIRONMENT.runtime.resources.trusted.cpus),
        '--memory', `${ENVIRONMENT.runtime.resources.trusted.memoryGiB}g`,
        '--tmpfs', TRUSTED_RUNTIME_TEST_TMPFS_SPEC,
        '--tmpfs', TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC,
        '--mount', `type=bind,source=${candidateBundle.bundlePath},target=${TRUSTED_RUNTIME_CANDIDATE_BUNDLE},readonly`,
        ...(dependencyCacheVolume === null ? [] : [
          '--mount', `type=volume,source=${dependencyCacheVolume.spec.name},target=${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH}`
        ]),
        image.imageId]
      });
      containerCreated = true;
      if (!/^[0-9a-f]{64}$/u.test(containerId)) {
        fail('Docker container create returned an invalid identity');
      }
      const containerTarget = containerId;
      const createdIdentity = await inspectContainerIdentity(
        session,
        containerTarget
      );
      if (createdIdentity.id !== containerTarget
          || createdIdentity.name !== containerName
          || createdIdentity.imageId !== image.imageId
          || createdIdentity.readOnlyRootfs !== true
          || createdIdentity.readOnlyCandidateBundle !== true
          || createdIdentity.candidateBundleSource !== candidateBundle.bundlePath
          || createdIdentity.initProcess !== true
          || createdIdentity.executableTestTmpfs !== true
          || createdIdentity.nonExecutableMutableTmpfs !== true
          || createdIdentity.dependencyCacheVolumeName
            !== (dependencyCacheVolume?.spec.name ?? null)
          || encodeVerificationActionData(createdIdentity.labels)
            !== encodeVerificationActionData(containerLabels)) {
        fail('Docker container creation readback differs from the retained attempt identity');
      }
      await containerEngineOutput(session, {
        kind: 'container-start', arguments: [containerTarget]
      });
      const mountedBundleDigest = digest(await containerEngineOutput(session, {
        kind: 'container-exec', arguments: [containerTarget, '/bin/bash', '-ceu',
        READ_CANDIDATE_BUNDLE_IDENTITY_SCRIPT, '--',
        String(candidateBundle.bundleSize), candidateBundle.bundleDigest]
      }), 'mounted candidate bundle digest');
      if (mountedBundleDigest !== candidateBundle.bundleDigest) {
        fail('mounted candidate bundle identity differs from its retained capability');
      }
      if (dependencyCacheMarkerBytes !== null && dependencyCacheMarkerFileDigest !== null) {
        const publishedMarkerDigest = digest(await containerEngineOutput(session, {
          kind: 'container-exec', arguments: [containerTarget, '/bin/bash', '-ceu',
          PUBLISH_DEPENDENCY_CACHE_MARKER_SCRIPT, '--',
          Buffer.from(dependencyCacheMarkerBytes).toString('utf8').trimEnd(),
          dependencyCacheMarkerFileDigest]
        }), 'published dependency-cache marker digest');
        if (publishedMarkerDigest !== dependencyCacheMarkerFileDigest) {
          fail('published dependency-cache marker digest differs');
        }
      }
      await containerEngineOutput(session, {
        kind: 'container-exec',
        arguments: ['--user', '1000:1000', containerTarget, '/bin/mkdir', '-p', TRUSTED_RUNTIME_OUTPUT]
      });
      await containerEngineOutput(session, {
        kind: 'container-exec', arguments: ['--user', '1000:1000',
        ...createTrustedRuntimeCommandEnvironmentArgs({ HOME: '/home/ubuntu' }),
        containerTarget, '/bin/bash', '-lc', TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT, '--',
        baseSha, headSha, input.setupMode]
      });
      if (dependencyCacheMarkerFileDigest !== null) {
        const readbackDigest = digest(await containerEngineOutput(session, {
          kind: 'container-exec',
          arguments: [containerTarget, '/bin/bash', '-ceu', READ_DEPENDENCY_CACHE_MARKER_DIGEST_SCRIPT]
        }), 'dependency-cache marker readback digest');
        if (readbackDigest !== dependencyCacheMarkerFileDigest) {
          fail('dependency-cache marker changed during setup');
        }
      }
      const networksSource = await containerEngineOutput(session, {
        kind: 'container-inspect',
        arguments: ['--format', '{{json .NetworkSettings.Networks}}', containerTarget]
      });
      const networks = JSON.parse(networksSource) as Record<string, unknown>;
      for (const network of Object.keys(networks).sort()) {
        await containerEngineOutput(session, {
          kind: 'network-disconnect', arguments: [network, containerTarget]
        });
      }
      const isolated = JSON.parse(await containerEngineOutput(session, {
        kind: 'container-inspect',
        arguments: ['--format', '{{json .NetworkSettings.Networks}}', containerTarget]
      })) as Record<string, unknown>;
      if (Object.keys(isolated).length !== 0) {
        fail('network isolation readback is not empty before trusted execution');
      }
      await settleTrustedRuntimeContainerEngineOperation({
        observeSettlement: input.observeSettlement,
        session,
        operation: setupOperation,
        scope: setupScope,
        ownerTerminalReference: Object.freeze({
          phase: 'setup',
          operationKey: input.operationKey,
          containerName: containerTarget,
          imageId: image.imageId
        })
      });
      setupSettled = true;
      return await input.execute(Object.freeze({
        containerName: containerTarget,
        temporaryRoot,
        image,
        containerEngineSession: session,
        dockerEndpoint,
        dependencyCacheKey: dependencyCacheMarker?.cacheKey ?? null
      }));
    } catch (error) {
      workspacePrimary = Object.freeze({ label: 'trusted-runtime-workspace', error });
      throw error;
    } finally {
      await settlePhysicalResourcesAsync({
        primary: workspacePrimary,
        cleanup: [{
          label: 'trusted-runtime-container-setup-operation',
          settle: async () => {
            if (setupSettled) return;
          await settleTrustedRuntimeContainerEngineOperation({
        observeSettlement: input.observeSettlement,
            session,
            operation: setupOperation,
            scope: setupScope,
            ownerTerminalReference: Object.freeze({
              phase: 'setup-failure',
              operationKey: input.operationKey
            })
          });
          }
        }, {
          label: 'trusted-runtime-container-removal',
          settle: async () => {
            if (!containerCreated) return;
            const cleanupOperation = bindTrustedRuntimeContainerEngineOperation({
              repositoryRoot,
              repository: repositoryIdentity,
              baseSha,
              headSha,
              operationKey: `${input.operationKey}-cleanup`,
              setupMode: input.setupMode,
              providerIdentityDigest: session.providerIdentityDigest,
              deadlineAtUnixMs: session.deadlineAtUnixMs
            });
            const cleanupScope = session.openOperationScope({
              operation: cleanupOperation,
              requirementId: 'external.container-engine-process'
            });
            let removalPrimary: Readonly<{ label: string; error: unknown }> | undefined;
            try {
              const removed = await observeContainerEngineOperation(session, {
                kind: 'container-remove', arguments: ['--force', containerId ?? containerName]
              }, { acceptAnyExitCode: true });
              if (removed.code !== 0) {
                fail(`container cleanup failed and ${containerName} was retained`);
              }
            } catch (error) {
              removalPrimary = Object.freeze({ label: 'trusted-runtime-container-remove-effect', error });
            }
            await settlePhysicalResourcesAsync({
              primary: removalPrimary,
              cleanup: [{
                label: 'trusted-runtime-container-cleanup-operation',
                settle: async () => {
                  await settleTrustedRuntimeContainerEngineOperation({
        observeSettlement: input.observeSettlement,
                  session,
                  operation: cleanupOperation,
                  scope: cleanupScope,
                  ownerTerminalReference: Object.freeze({
                    phase: 'cleanup',
                    operationKey: input.operationKey,
                    containerName: containerId ?? containerName
                  })
                  });
                }
              }]
            });
          }
        }, {
          label: 'git-candidate-bundle-capability',
          settle: () => {
            if (candidateBundle === null) return;
            assertGitCandidateBundleReceipt(
              closeGitCandidateBundle(candidateBundle),
              candidateBundle
            );
          }
        }, {
          label: 'trusted-runtime-temporary-root',
          settle: () => rmSync(temporaryRoot, { recursive: true, force: true })
        }]
      });
    }
  } catch (error) {
    primaryFailure = error;
    hasPrimaryFailure = true;
    throw error;
  } finally {
    await settlePhysicalResourcesAsync({
      ...(hasPrimaryFailure ? {
        primary: { label: 'trusted-runtime-operation', error: primaryFailure }
      } : {}),
      cleanup: [{
        label: 'trusted-runtime-container-engine-session',
        settle: () => { containerEngineSession?.close(); }
      }, {
        label: 'trusted-runtime-unclaimed-command-provider',
        settle: () => {
          if (commandProvider !== null && !commandProviderTransferred) {
            disposeUnclaimedDockerCommandProviderCapability(commandProvider);
          }
        }
      }, {
        label: 'trusted-runtime-operation-lease-current',
        settle: async () => { await operationLeaseAuthority?.assertCurrent(); }
      }, {
        label: 'trusted-runtime-operation-lease',
        settle: () => {
          if (operationLease === null) return;
          if (operationLease.recoveryPending) operationLease.restoreReclaimedOwner();
          else operationLease.release();
        }
      }, {
        label: 'trusted-runtime-state-physical-authority',
        settle: async () => { await operationLeaseAuthority?.release(); }
      }]
    });
  }
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
  envelope: VerificationSessionHostedEnvelope;
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

export interface TrustedRuntimeSourceProgramAttemptEvidence {
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
const transitionAttemptEvidence = new WeakMap<object, TrustedRuntimeSourceProgramAttemptEvidence>();
const transitionAttemptRoots = new WeakMap<object, string>();

/** Historical bytes are inspectable but never recreate a live observation. */
export function parseTrustedRuntimeSourceProgramAttemptEvidence(value: unknown): TrustedRuntimeSourceProgramAttemptEvidence {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('transition attempt evidence is not data');
  const evidence = value as TrustedRuntimeSourceProgramAttemptEvidence;
  if (Object.keys(evidence).sort().join(',') !== 'assessment,authority,evidenceDigest,observation,physicalEvidence,schema') {
    fail('transition attempt evidence fields are invalid');
  }
  const { evidenceDigest, ...canonical } = evidence;
  const { observationDigest, ...observed } = evidence.observation;
  if (evidence.schema !== (evidence.observation.origin === 'first-qualified' ? 'source-program-isolated-attempt-evidence-v2' : 'source-program-isolated-attempt-evidence-v1') || evidence.authority !== 'historical-evidence-only'
      || evidenceDigest !== digestValue(canonical) || observationDigest !== digestValue(observed)
      || evidence.observation.assessmentDigest !== evidence.assessment.assessmentDigest
      || evidence.observation.settlementDigest !== digestValue(evidence.physicalEvidence.settlements)
      || evidence.physicalEvidence.dependencyCache !== 'private-ephemeral'
      || evidence.physicalEvidence.workspaceTerminal !== 'retired') fail('transition attempt historical join is invalid');
  parseSourceProgramTransitionAssessment(evidence.assessment);
  if (evidence.observation.origin === 'first-qualified') {
    if (evidence.observation.schema !== 'source-program-transition-observation-v2'
        || 'predecessorActionOutputDigest' in evidence.observation
        || evidence.observation.sourceActionOutputDigest !== digestBytes(`${encodeVerificationActionData(evidence.assessment)}\n`)
        || evidence.observation.baseSha !== evidence.assessment.baseSha
        || evidence.observation.headSha !== evidence.assessment.headSha
        || evidence.observation.headTreeSha !== evidence.assessment.headTreeSha
        || evidence.observation.baseSha !== evidence.assessment.runtimeSha
        || evidence.observation.producerSourceDigest !== evidence.assessment.producerExecution.observation.implementationDigest
        || evidence.observation.producerExecutionEvidenceDigest !== evidence.assessment.producerExecution.evidenceDigest
        || evidence.physicalEvidence.settlements.length !== 3
        || evidence.physicalEvidence.settlements.map(({ ownerTerminalReference }) => ownerTerminalReference.phase).join(',')
          !== 'setup,owner-operation,cleanup') {
      fail('first-qualified Source Program attempt lost its exact physical/output joins');
    }
  } else if (evidence.observation.schema !== undefined
      || !/^sha256:[0-9a-f]{64}$/u.test(evidence.observation.predecessorActionOutputDigest)) {
    fail('legacy Source Program attempt must retain its genuine predecessor');
  }
  return Object.freeze(evidence);
}

export async function observeTrustedRuntimeSourceProgramTransition(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelope;
  evidence: CodexDevelopmentVerificationEvidenceV4;
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
  envelope: VerificationSessionHostedEnvelope;
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
  const settlements: TrustedRuntimeContainerEngineSettlement[] = [];
  const observeSettlement = (settlement: TrustedRuntimeContainerEngineSettlement): void => { settlements.push(settlement); };
  const completed = await withTrustedRuntimeWorkspace({
    repositoryRoot: path.resolve(input.repositoryRoot), repository: session.repository,
    baseSha: session.baseSha, headSha: session.headSha,
    operationKey: `transition-${session.sessionRevision.slice(7, 27)}`, setupMode: 'full',
    dependencyCachePolicy: 'private-authority', observeSettlement,
    deadlineAtUnixMs, signal: input.signal,
    execute: async (workspace) => await executeTrustedRuntimeContainerEngineOwnerOperation({
      session: workspace.containerEngineSession, repositoryRoot: path.resolve(input.repositoryRoot),
      repository: session.repository, baseSha: session.baseSha, headSha: session.headSha,
      operationKey: `transition-${session.sessionRevision.slice(7, 23)}-assessment`, setupMode: 'full', observeSettlement,
      execute: async () => {
        const executionId = `source-program-transition-${randomUUID()}`;
        if (workspace.dependencyCacheKey !== null) fail('fresh authority workspace consumed a shared dependency cache');
        const invocation: ContainerEngineOperation = {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
            ...createTrustedRuntimeCommandEnvironmentArgs({ CI: '1', HOME: '/home/ubuntu', LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
              [SOURCE_PROGRAM_TRANSITION_DEADLINE_ENV]: String(workspace.containerEngineSession.deadlineAtUnixMs) }),
            workspace.containerName, 'bun', 'run', '--no-env-file', `--config=${TRUSTED_RUNTIME_TRUSTED_TREE}/bunfig.toml`,
            `${TRUSTED_RUNTIME_TRUSTED_TREE}/${SOURCE_PROGRAM_TRANSITION_ENTRYPOINT}`,
            ...sourceProgramTransitionGate(binding).args.slice(1)]
        };
        const result = await containerEngineOperationResult(workspace.containerEngineSession, invocation,
          { maxStdoutBytes: SOURCE_PROGRAM_TRANSITION_STDOUT_BYTE_LIMIT, maxStderrBytes: 8 * 1024 * 1024 });
        const assessment = parseSourceProgramTransitionAssessment(JSON.parse(result.stdout));
        if (result.stdout !== `${encodeVerificationActionData(assessment)}\n`
            || assessment.baseSha !== session.baseSha || assessment.baseTreeSha !== session.baseTreeSha
            || assessment.headSha !== session.headSha || assessment.headTreeSha !== session.headTreeSha
            || assessment.runtimeSha !== session.baseSha
            || digestValue(assessment.changedPaths) !== digestValue(input.envelope.scopeAuthorization.authorizedPaths)) {
          fail('fresh isolated Source Program assessment differs from bound Action output or exact source pins');
        }
        const canonical = Object.freeze({
          repository: session.repository, pullRequestNumber: session.prNumber,
          assessmentDigest: assessment.assessmentDigest,
          ...(input.predecessorActionOutputDigest === undefined ? {
            schema: 'source-program-transition-observation-v2' as const, origin: 'first-qualified' as const,
            sourceActionOutputDigest: digestBytes(result.stdout)
          } : { predecessorActionOutputDigest: input.predecessorActionOutputDigest }),
          baseSha: session.baseSha, headSha: session.headSha,
          headTreeSha: session.headTreeSha, executionId,
          producerSourceDigest: assessment.producerExecution.observation.implementationDigest,
          producerExecutionEvidenceDigest: assessment.producerExecution.evidenceDigest,
          actionKey: action.action.actionKey, sessionRevision: session.sessionRevision,
          payloadDigest: binding.payloadDigest, approvalObservationDigest: binding.approvalObservationDigest,
          approvalDigest: binding.approvalDigest
        });
        return Object.freeze({ assessment, canonical, invocation, image: workspace.image, dockerEndpoint: workspace.dockerEndpoint });
      }
    })
  });
  if (settlements.length !== 3 || settlements.map(({ ownerTerminalReference }) => ownerTerminalReference.phase).join(',')
      !== 'setup,owner-operation,cleanup') fail('fresh Source Program workspace has no complete settled physical history');
  const observationFields = Object.freeze({ ...completed.canonical, settlementDigest: digestValue(settlements) });
  const observation: TrustedRuntimeSourceProgramTransitionObservation = Object.freeze({ ...observationFields, observationDigest: digestValue(observationFields) });
  const carrier = Object.freeze({ schema: observation.origin === 'first-qualified'
    ? 'source-program-isolated-attempt-evidence-v2' as const : 'source-program-isolated-attempt-evidence-v1' as const,
    authority: 'historical-evidence-only' as const, assessment: completed.assessment, observation,
    physicalEvidence: Object.freeze({ settlements: Object.freeze(settlements), invocation: completed.invocation,
      image: completed.image, dockerEndpoint: completed.dockerEndpoint,
      dependencyCache: 'private-ephemeral' as const, workspaceTerminal: 'retired' as const }) });
  const attemptEvidence = Object.freeze({ ...carrier, evidenceDigest: digestValue(carrier) });
  throwIfNativeAborted(input.signal);
  if (Date.now() >= deadlineAtUnixMs) {
    fail('settled Source Program output arrived after its inherited deadline');
  }
  issuedSourceProgramTransitionObservations.add(observation);
  transitionAttemptEvidence.set(observation, attemptEvidence);
  transitionAttemptRoots.set(observation, path.resolve(input.repositoryRoot));
  return Object.freeze({ assessment: completed.assessment, observation, attemptEvidence, startedAt, finishedAt: new Date().toISOString() });
}

/** The private no-SUT producer is the first physical execution of this Action.
 * Semantic author adoption deliberately happens after complete source production. */
export async function produceTrustedRuntimeSourceProgramTransition(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelope;
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
  envelope: VerificationSessionHostedEnvelope;
  actorNodeId: string;
  requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
  sourceProgramTransition?: CiSourceProgramTransitionBinding;
  authorApproval?: SourceProgramTestAuthorApproval;
  sourceAction?: TrustedRuntimeSourceProgramAction;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  evidence: CodexDevelopmentVerificationEvidenceV4;
  canonicalEvidenceBytes: string;
  receipt: TrustedRuntimeContainerReceipt;
}>> {
  assertTransitionInput(input);
  if (input.sourceAction !== undefined) {
    assertTrustedRuntimeSourceProgramAction(input.sourceAction, { envelope: input.envelope });
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const session = input.envelope.session;
  sha(session.baseSha, 'baseSha');
  sha(session.headSha, 'headSha');
  sha(session.headTreeSha, 'headTreeSha');
  const completed = await withTrustedRuntimeWorkspace({
    repositoryRoot,
    repository: session.repository,
    baseSha: session.baseSha,
    headSha: session.headSha,
    operationKey: `session-${session.sessionRevision.slice(7, 31)}`,
    setupMode: 'full',
    deadlineAtUnixMs: input.deadlineAtUnixMs, signal: input.signal,
    execute: async ({
      containerName,
      temporaryRoot,
      image,
      containerEngineSession,
      dockerEndpoint
    }) => {
      return await executeTrustedRuntimeContainerEngineOwnerOperation({
        session: containerEngineSession,
        repositoryRoot,
        repository: session.repository,
        baseSha: session.baseSha,
        headSha: session.headSha,
        operationKey: `session-${session.sessionRevision.slice(7, 23)}-verification`,
        setupMode: 'full',
        execute: async () => {
      const outputPath = path.join(temporaryRoot, 'verification-evidence.json');
      const executionId = `trusted-runtime-${digestValue(Object.freeze({
        sessionRevision: session.sessionRevision,
        imageId: image.imageId,
        dockerEndpoint
      })).slice(7, 31)}`;
    await containerEngineOutput(containerEngineSession, {
      kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
      ...formalEnvironment({ envelope: input.envelope, executionId,
        actorNodeId: input.actorNodeId, requiredBlobs: input.requiredBlobs,
        sourceProgramTransition: input.sourceProgramTransition, sourceAction: input.sourceAction }),
      containerName,
      'bun', 'run', '--no-env-file', `--config=${TRUSTED_RUNTIME_TRUSTED_TREE}/bunfig.toml`,
      `${TRUSTED_RUNTIME_TRUSTED_TREE}/${CI_VERIFICATION_WORKFLOW_PATH}`,
      '--profile', session.profile, '--expected-head', session.headSha]
    });
    await containerEngineOutput(containerEngineSession, {
      kind: 'container-copy',
      arguments: [`${containerName}:${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`, outputPath]
    });
    const canonicalEvidenceBytes = readFileSync(outputPath, 'utf8');
    const parsed = JSON.parse(canonicalEvidenceBytes) as CodexDevelopmentVerificationEvidenceV4;
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
      const transitionPath = path.join(temporaryRoot, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE);
      await containerEngineOutput(containerEngineSession, { kind: 'container-copy',
        arguments: [`${containerName}:${TRUSTED_RUNTIME_OUTPUT}/${SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE}`, transitionPath] });
      const transitionBytes = readFileSync(transitionPath, 'utf8');
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
    const receipt = createReceipt({
      executionId,
      ...(sourceProgramTransition === undefined ? {} : { sourceProgramTransition }),
      sessionRevision: digest(session.sessionRevision, 'sessionRevision'),
      baseSha: session.baseSha,
      headSha: session.headSha,
      headTreeSha: session.headTreeSha,
      imageId: image.imageId,
      dockerEndpoint,
      networkIsolatedBeforeSut: true,
      evidenceByteDigest: digestBytes(canonicalEvidenceBytes),
      evidenceByteLength: Buffer.byteLength(canonicalEvidenceBytes, 'utf8'),
      evidenceDigest: digest(parsed.evidenceDigest, 'evidenceDigest'),
      producerSourceDigest: digest(parsed.producer.sourceDigest, 'producer.sourceDigest')
    });
    return Object.freeze({ evidence: parsed, canonicalEvidenceBytes, receipt });
        }
      });
    }
  });
  // Container transport cannot restore authority. Rejoin the retained host
  // object only after the ordinary workspace has physically settled as well.
  if (input.sourceAction !== undefined) {
    assertTrustedRuntimeSourceProgramAction(input.sourceAction, { envelope: input.envelope });
  }
  throwIfNativeAborted(input.signal);
  if (input.deadlineAtUnixMs !== undefined && Date.now() >= input.deadlineAtUnixMs) fail('verification completed after its inherited deadline');
  return completed;
}

function trustedRuntimeMainHealthCommandArgv(command: string): readonly string[] {
  switch (command) {
    case 'bun run imports:check --all':
      return Object.freeze(['bun', 'run', 'imports:check', '--all']);
    case 'bun run typecheck:verified':
      return Object.freeze(['bun', 'run', 'typecheck:verified']);
    case 'bun run audit -- --worktree-source-program --enforce':
      return Object.freeze(['bun', 'run', 'audit', '--', '--worktree-source-program', '--enforce']);
    case 'bun run docs:doctor':
      return Object.freeze(['bun', 'run', 'docs:doctor']);
    case 'bun run test -- --scope fast':
      return Object.freeze(['bun', 'run', 'test', '--', '--scope', 'fast']);
    default:
      fail(`unsupported trusted MainHealth command: ${command}`);
  }
}

export async function executeTrustedRuntimeMainHealth(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now?: () => Date;
}>): Promise<TrustedRuntimeMainHealthReceipt> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const repositoryIdentity = repository(input.repository);
  const mainSha = sha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = sha(input.mainTreeSha, 'MainHealth mainTreeSha');
  return await withTrustedRuntimeWorkspace({
    repositoryRoot,
    repository: repositoryIdentity,
    baseSha: mainSha,
    headSha: mainSha,
    operationKey: `main-health-${mainSha.slice(0, 24)}`,
    setupMode: 'full',
    execute: async ({
      containerName,
      image,
      containerEngineSession,
      dockerEndpoint,
      dependencyCacheKey
    }) => {
      if (dependencyCacheKey === null) {
        fail('MainHealth full workspace did not bind the dependency cache generation');
      }
      return await executeTrustedRuntimeContainerEngineOwnerOperation({
        session: containerEngineSession,
        repositoryRoot,
        repository: repositoryIdentity,
        baseSha: mainSha,
        headSha: mainSha,
        operationKey: `main-health-${mainSha.slice(0, 16)}-execute`,
        setupMode: 'full',
        execute: async () => {
          const environmentArgs = createTrustedRuntimeCommandEnvironmentArgs({
            CI: '1',
            HOME: '/home/ubuntu',
            LANG: 'C',
            LC_ALL: 'C',
            TZ: 'UTC',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_TERMINAL_PROMPT: '0'
          });
          const observeIdentity = async () => Object.freeze({
            head: await containerEngineOutput(containerEngineSession, {
              kind: 'container-exec',
              arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
                containerName, 'git', 'rev-parse', 'HEAD']
            }),
            tree: await containerEngineOutput(containerEngineSession, {
              kind: 'container-exec',
              arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
                containerName, 'git', 'rev-parse', 'HEAD^{tree}']
            }),
            status: await containerEngineOutput(containerEngineSession, {
              kind: 'container-exec',
              arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
                containerName, 'git', 'status', '--porcelain=v1', '--untracked-files=all']
            })
          });
          const before = await observeIdentity();
          if (before.head !== mainSha || before.tree !== mainTreeSha || before.status !== '') {
            fail('MainHealth exact-main workspace identity differs before execution');
          }

          const actionResults: Array<Readonly<{ command: string; resultDigest: Digest }>> = [];
          for (const command of TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS) {
            const argv = trustedRuntimeMainHealthCommandArgv(command);
            const result = await containerEngineOperationResult(containerEngineSession, {
              kind: 'container-exec',
              arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
                ...environmentArgs, containerName, ...argv]
            }, {
              maxStdoutBytes: 16 * 1024 * 1024,
              maxStderrBytes: 16 * 1024 * 1024
            });
            actionResults.push(Object.freeze({
              command,
              resultDigest: digestValue(Object.freeze({
                command,
                exitCode: result.code,
                stdoutDigest: digestBytes(result.stdout),
                stderrDigest: digestBytes(result.stderr)
              }))
            }));
          }

          const after = await observeIdentity();
          if (after.head !== mainSha || after.tree !== mainTreeSha || after.status !== '') {
            fail('MainHealth exact-main workspace identity changed during execution');
          }
          const endpointReadback = await containerEngineSession.observeEndpoint();
          if (encodeVerificationActionData(endpointReadback)
              !== encodeVerificationActionData(dockerEndpoint)) {
            fail('MainHealth Docker endpoint drifted during execution');
          }
          const executionId = `trusted-main-health-${digestValue(Object.freeze({
            repository: repositoryIdentity,
            mainSha,
            mainTreeSha,
            imageId: image.imageId,
            dockerEndpoint,
            dependencyCacheKey,
            planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST
          })).slice(7, 31)}`;
          return createTrustedRuntimeMainHealthReceipt({
            repository: repositoryIdentity,
            mainSha,
            mainTreeSha,
            executionId,
            dockerEndpoint,
            dependencyCacheKey,
            actionResults,
            observedAt: (input.now ?? (() => new Date()))().toISOString()
          });
        }
      });
    }
  });
}

export async function executeTrustedRuntimeWorkspaceCanary(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  headSha: string;
  headTreeSha: string;
  dependencies?: boolean;
}>): Promise<Readonly<{
  schema: 'sec-trusted-runtime-workspace-canary-v1';
  repository: string;
  headSha: string;
  headTreeSha: string;
  dependenciesReady: boolean;
  dependencyCacheKey: Digest | null;
  imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  dockerEndpoint: DockerEndpointIdentity;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const repositoryIdentity = repository(input.repository);
  const headSha = sha(input.headSha, 'workspace canary headSha');
  const headTreeSha = sha(input.headTreeSha, 'workspace canary headTreeSha');
  return await withTrustedRuntimeWorkspace({
    repositoryRoot,
    repository: repositoryIdentity,
    baseSha: headSha,
    headSha,
    operationKey: `${input.dependencies === true ? 'dependency' : 'canary'}-${headSha.slice(0, 24)}`,
    setupMode: input.dependencies === true ? 'dependency-canary' : 'lifecycle-canary',
    execute: async ({
      containerName,
      image,
      containerEngineSession,
      dockerEndpoint,
      dependencyCacheKey
    }) => {
      return await executeTrustedRuntimeContainerEngineOwnerOperation({
        session: containerEngineSession,
        repositoryRoot,
        repository: repositoryIdentity,
        baseSha: headSha,
        headSha,
        operationKey: `${input.dependencies === true ? 'dependency' : 'canary'}-${headSha.slice(0, 16)}-execute`,
        setupMode: input.dependencies === true ? 'dependency-canary' : 'lifecycle-canary',
        execute: async () => {
      if (input.dependencies === true) {
        await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
          ...createTrustedRuntimeCommandEnvironmentArgs({ CI: '1', HOME: '/home/ubuntu' }),
          containerName,
          ...TRUSTED_RUNTIME_DEPENDENCY_PACKAGE_COMMAND]
        });
        const providerIdentity = await containerEngineOutput(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
            containerName, 'bun', TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH,
            '--resolve-from', TRUSTED_RUNTIME_TRUSTED_TREE]
          });
        const isolatedProviderIdentity = await containerEngineOutput(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', '/tmp',
            containerName, '/bin/bash', '-ceu',
            `NODE_PATH="$(realpath ${TRUSTED_RUNTIME_TRUSTED_TREE}/node_modules)" ` +
              `exec bun --no-install ${TRUSTED_RUNTIME_TRUSTED_TREE}/${TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH} ` +
              '--resolve-from /tmp']
          });
        if (isolatedProviderIdentity !== providerIdentity) {
          fail('dependency canary isolated TypeCheck Provider identity differs from its canonical owner');
        }
      }
      const observedHead = await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
            containerName, 'git', 'rev-parse', 'HEAD']
        });
      const observedTree = await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
            containerName, 'git', 'rev-parse', 'HEAD^{tree}']
        });
      const observedStatus = await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
            containerName, 'git', 'status', '--porcelain=v1', '--untracked-files=all']
        });
      await containerEngineOutput(containerEngineSession, {
        kind: 'container-exec', arguments: ['--user', '1000:1000', containerName,
          '/bin/bash', '-lc', `test -r ${TRUSTED_RUNTIME_TRUSTED_TREE}/package.json && test -w ${TRUSTED_RUNTIME_OUTPUT}`]
      });
      if (observedHead !== headSha || observedTree !== headTreeSha || observedStatus !== '') {
        fail('workspace canary exact Git identity or clean state differs');
      }
      return Object.freeze({
        schema: 'sec-trusted-runtime-workspace-canary-v1',
        repository: repositoryIdentity,
        headSha,
        headTreeSha,
        dependenciesReady: input.dependencies === true,
        dependencyCacheKey,
        imageId: image.imageId,
        dockerEndpoint
      });
        }
      });
    }
  });
}
