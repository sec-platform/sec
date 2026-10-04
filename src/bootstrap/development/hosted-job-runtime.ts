import { createHash } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, fsyncSync, openSync, readSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST,
  ciVerificationHostedActionClaimFiles, ciVerificationHostedActionResolverFiles, ciVerificationHostedCoordinatorFiles,
  ciVerificationHostedJobTransportSlot,
  getCiVerificationPerJobHostedJobPolicy
} from '../../adapters/providers/github-api/contract/hosted-job-policy.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent, closeAuthenticatedGitHubJobOrigin,
  getAuthenticatedGitHubJobOriginSignal, openAuthenticatedGitHubJobOrigin,
  type AuthenticatedGitHubJobOrigin
} from '../../adapters/providers/github-api/hosted-job-origin.ts';
import {
  createNoFollowDirectoryChain, inspectNoFollowDirectoryChain, PhysicalNoFollowError
} from '../../adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE,
  parseAgentOperationActivationPreparation, parseAgentOperationActivationReceipt,
  parseAgentOperationActivationRequest
} from '../../adapters/self-hosting/control/agent/operation-activation.ts';
import {
  BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
  parseBranchCloseoutRecoveryArtifact
} from '../../adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { CodexDevelopmentParseMergeGateResult } from '../../adapters/self-hosting/control/integration/merge-gate.ts';
import { encodeVerificationActionData } from '../../adapters/verification/platform/action/contract/action.ts';
import {
  ciVerificationActionParentDispatchPlanArtifactName, ciVerificationActionParentDispatchPlanPayloadDigest,
  parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionProviderEnvelope
} from '../../adapters/verification/platform/action/contract/ci.ts';
import {
  parseVerificationActionProviderStartMarker, parseVerificationActionProviderTerminalAnchor,
  verificationActionProviderStartArtifactName
} from '../../adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentParseVerificationActionTerminalArtifact, CodexDevelopmentParseVerificationSessionArtifact, parseHostedSessionTerminalArtifact } from '../../adapters/verification/platform/ci/contract/evidence.ts';
import {
  CodexDevelopmentParseHostedActionRawResult,
  parseHostedSutCapabilityObservation
} from '../../adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE,
  hostedResumeDispatchOutcomesArtifactName, hostedSessionArtifactName
} from '../../adapters/verification/platform/ci/contract/revision.ts';
import { hostedJobSutArtifactName } from '../../adapters/verification/platform/ci/runtime/hosted-job-runtime-provenance.ts';
import {
  HOSTED_SUT_SUPERVISOR_CONTRACT_DIGEST, HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID,
  HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS
} from '../../adapters/verification/platform/ci/runtime/hosted-sut-supervisor.ts';
import {
  readSessionArtifactBytes, readSessionArtifactText, writeCanonicalDurable
} from '../../adapters/verification/platform/ci/runtime/session-artifact-files.ts';
import { hostedActionResolutionArtifactName } from '../../adapters/verification/platform/ci/runtime/verification-action-github-provider.ts';
import { createVerificationSessionGitHubClient } from '../../adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { parseHostedResumeDispatchOutcomeCollection } from '../../adapters/verification/platform/ci/runtime/verification-session-journal.ts';
import {
  branchCloseoutRecoveryArtifactName,
  createBranchLifecycleVerificationScope, githubEvent,
  hostedIntegrationPreflightTransportPath,
  hostedMergeWakeupLocator,
  observeHostedResumeReceiverSignal, openRuntimeJournalFileSystem
} from '../../adapters/verification/platform/ci/runtime/verification-session.ts';
import { hostedActionTransportText } from '../../adapters/verification/platform/ci/verification-cli.ts';
import {
  CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionRequest,
  CodexDevelopmentParseHostedActionResolution, CodexDevelopmentResolveHostedAction, parseHostedEnvelope
} from '../../adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import { CodexDevelopmentMaterializeHostedActionCandidate } from '../../adapters/verification/platform/ci/verification-materialization.ts';
import { withQualifiedHostedJobContainerEngine } from '../../adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { runHostedSutExecution, runHostedSutPreflight, selectHostedJobRuntimePhase } from '../../application/hosted-job-runtime.ts';
import { canonicalJson, sha256 } from '../../contracts/canonical.ts';
import { parseHostedVerificationCommand } from '../../entry/verification-session-hosted-cli.ts';
import { issueOperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext, type OperationDigest
} from '../../execution/operation/semantic.ts';
import { settleResourcesAsync } from '../../execution/resource-settlement.ts';
import { worktreePhysicalCloseoutOperations } from '../runtime-state/worktree-closeout.ts';
import { produceHostedAgentOperationActivation, publishHostedAgentOperationActivation } from './agent-operation-activation.ts';
import {
  executeHostedSessionResumeReceiverCommand, executeHostedSessionResumeSender,
  executeHostedVerificationCommand
} from './closeout/verification-session-hosted.ts';
import {
  claimHostedActionStart,
  completeHostedActionCoordinationSession,
  prepareHostedActionClaim,
  prepareHostedActionCoordinationSession,
  resolveHostedActionCoordinationSession
} from './hosted-action-coordination.ts';
import {
  anchorHostedActionTerminal,
  assembleHostedActionTerminal, prepareHostedActionTerminalAnchor
} from './hosted-action-terminal.ts';
import { prepareHostedActionSutInputs, runHostedActionSut, runHostedSutCapabilityProbe } from './hosted-sut.ts';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Paths are fixed transport slots below the original source checkout. The
 * old no-follow reader admits this same .tmp/codex namespace; no path grants
 * provider authority or changes the authenticated job. */
function hostedJobTransportSlot(origin: AuthenticatedGitHubJobOrigin, ...segments: readonly string[]): string {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (path.resolve(process.cwd()) !== job.trustedDriverRoot) {
    throw new Error('Hosted transport working directory differs from the authenticated source root.');
  }
  return path.join(job.trustedDriverRoot, '.tmp', 'codex', 'hosted-job', job.policyJobId, ...segments);
}

function createHostedJobOutputParent(origin: AuthenticatedGitHubJobOrigin, slot: string): string {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const root = inspectNoFollowDirectoryChain(job.trustedDriverRoot).target;
  const parent = createNoFollowDirectoryChain(root,
    ['.tmp', 'codex', 'hosted-job', job.policyJobId, 'out', slot]);
  const expected = hostedJobTransportSlot(origin, 'out', slot);
  if (parent.path !== expected) throw new Error('Hosted output parent differs from its original source root.');
  return expected;
}

function ensureHostedJobOutputParent(origin: AuthenticatedGitHubJobOrigin, slot: string): string {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const policy = getCiVerificationPerJobHostedJobPolicy(job.workflowPath, job.policyJobId);
  if (policy === null || !policy.stages.some(stage => stage.kind === 'upload' && stage.slot === slot)) {
    throw new Error('Hosted output slot has no unique canonical policy consumer.');
  }
  return createHostedJobOutputParent(origin, slot);
}

function ensureHostedCloseoutProjectionParent(origin: AuthenticatedGitHubJobOrigin): string {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.policyJobId !== 'integrate' || job.role !== 'control'
      || !['integrate-hosted', 'closeout-mutate-hosted', 'closeout-publish-hosted'].includes(job.phase)) {
    throw new Error('Hosted closeout projection has no canonical control phase.');
  }
  return createHostedJobOutputParent(origin, 'closeout');
}

function assertCanonicalHostedOutput(filePath: string, value: unknown): string {
  const source = readSessionArtifactText(filePath);
  if (source !== `${encodeVerificationActionData(value)}\n`) {
    throw new Error('Hosted fixed-slot output readback differs from its canonical source value.');
  }
  return source;
}

function dataObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Hosted ${label} transport is not one object.`);
  }
  return value as Record<string, unknown>;
}

function hostedCoordinatorFiles(origin: AuthenticatedGitHubJobOrigin) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.policyJobId !== 'coordinate-verification-session' || job.role !== 'control') {
    throw new Error('Hosted coordinator paths require their authenticated control job.');
  }
  const files = ciVerificationHostedCoordinatorFiles();
  const work = createNoFollowDirectoryChain(inspectNoFollowDirectoryChain(job.trustedDriverRoot).target,
    ['.tmp', 'codex', 'hosted-job', job.policyJobId, 'work']);
  if (work.path !== path.resolve(job.trustedDriverRoot, files.root)) {
    throw new Error('Hosted coordinator work directory differs from its canonical policy location.');
  }
  return Object.freeze({
    requestPath: path.resolve(job.trustedDriverRoot, files.requestPath),
    factsPath: path.resolve(job.trustedDriverRoot, files.factsPath),
    envelopePath: path.resolve(job.trustedDriverRoot, files.envelopePath),
    artifactIndexPath: path.resolve(job.trustedDriverRoot, files.artifactIndexPath),
    evidencePath: path.resolve(job.trustedDriverRoot, files.evidencePath),
    parentPlanPath: path.resolve(job.trustedDriverRoot, files.parentPlanPath),
    artifactPath: path.resolve(job.trustedDriverRoot, files.artifactPath)
  });
}

function hostedCoordinatorRequest(origin: AuthenticatedGitHubJobOrigin): string {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const source = process.env.SEC_HOSTED_NEEDS_JSON;
  if (typeof source !== 'string' || source.length > 128 * 1024) {
    throw new Error('Hosted coordinator validated request transport is unavailable or unbounded.');
  }
  const needs = dataObject(JSON.parse(source) as unknown, 'coordinator needs');
  const validator = dataObject(needs['validate-hosted-request'], 'coordinator validation predecessor');
  if (validator.result !== 'success') throw new Error('Hosted coordinator requires its successful request validation.');
  const encoded = dataObject(validator.outputs, 'coordinator validation outputs')['session-request-base64'];
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length > 64 * 1024
      || Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
    throw new Error('Hosted coordinator request has noncanonical base64 transport.');
  }
  return encoded;
}

function hostedCoordinatorParentUpload(origin: AuthenticatedGitHubJobOrigin): Readonly<{
  parentArtifactId: string; parentArtifactArchiveDigest: `sha256:${string}`;
}> {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const source = process.env.SEC_HOSTED_STEPS_JSON;
  if (typeof source !== 'string' || source.length > 128 * 1024) {
    throw new Error('Hosted coordinator parent upload transport is unavailable or unbounded.');
  }
  const steps = dataObject(JSON.parse(source) as unknown, 'coordinator steps');
  const upload = dataObject(steps['upload-parent-plan'], 'coordinator parent upload');
  if (upload.conclusion !== 'success') throw new Error('Hosted coordinator requires its successful parent upload.');
  const outputs = dataObject(upload.outputs, 'coordinator parent upload outputs');
  const parentArtifactId = outputs['artifact-id'];
  const digest = outputs['artifact-digest'];
  if (typeof parentArtifactId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(parentArtifactId)
      || typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error('Hosted coordinator parent upload identity is invalid.');
  }
  return Object.freeze({ parentArtifactId, parentArtifactArchiveDigest: `sha256:${digest}` as const });
}

function hostedResolverFiles(origin: AuthenticatedGitHubJobOrigin) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.policyJobId !== 'resolve-verification-action' || job.role !== 'trusted') {
    throw new Error('Hosted Action resolver paths require their authenticated trusted job.');
  }
  const files = ciVerificationHostedActionResolverFiles();
  const work = createNoFollowDirectoryChain(inspectNoFollowDirectoryChain(job.trustedDriverRoot).target,
    ['.tmp', 'codex', 'hosted-job', job.policyJobId, 'work']);
  if (work.path !== path.resolve(job.trustedDriverRoot, files.root)) {
    throw new Error('Hosted Action resolver work directory differs from its canonical policy location.');
  }
  return Object.freeze({
    requestPath: path.resolve(job.trustedDriverRoot, files.requestPath),
    factsPath: path.resolve(job.trustedDriverRoot, files.factsPath),
    artifactIndexPath: path.resolve(job.trustedDriverRoot, files.artifactIndexPath),
    providerEnvelopePath: path.resolve(job.trustedDriverRoot, files.providerEnvelopePath),
    envelopePath: path.resolve(job.trustedDriverRoot, files.envelopePath),
    resolutionPath: path.resolve(job.trustedDriverRoot, files.resolutionPath)
  });
}

function hostedActionEnvelopeTransport(origin: AuthenticatedGitHubJobOrigin): string {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.policyJobId !== 'resolve-verification-action' || job.role !== 'trusted') {
    throw new Error('Hosted Action envelope transport requires its authenticated resolver.');
  }
  const source = process.env.SEC_HOSTED_NEEDS_JSON;
  if (typeof source !== 'string' || source.length > 256 * 1024) {
    throw new Error('Hosted Action validated envelope transport is unavailable or unbounded.');
  }
  const needs = dataObject(JSON.parse(source) as unknown, 'Action resolver needs');
  const validator = dataObject(needs['validate-hosted-request'], 'Action resolver validation predecessor');
  if (validator.result !== 'success') throw new Error('Hosted Action resolver requires its successful request validation.');
  const encoded = dataObject(validator.outputs, 'Action resolver validation outputs')['action-envelope-base64'];
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length > 128 * 1024
      || Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
    throw new Error('Hosted Action provider envelope has noncanonical base64 transport.');
  }
  return encoded;
}

function hostedClaimFiles(origin: AuthenticatedGitHubJobOrigin) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.policyJobId !== 'claim-verification-action' || job.role !== 'trusted') {
    throw new Error('Hosted Action claim paths require their authenticated trusted job.');
  }
  const files = ciVerificationHostedActionClaimFiles();
  return Object.freeze({
    providerEnvelopePath: path.resolve(job.trustedDriverRoot, files.providerEnvelopePath),
    envelopePath: path.resolve(job.trustedDriverRoot, files.envelopePath),
    resolutionPath: path.resolve(job.trustedDriverRoot, files.resolutionPath),
    candidateRoot: path.resolve(job.trustedDriverRoot, files.candidateRoot),
    archiveOutputDirectory: path.resolve(job.trustedDriverRoot, files.archiveOutputDirectory),
    markerOutputPath: path.resolve(job.trustedDriverRoot, files.markerOutputPath),
    preparedCandidateArchive: path.resolve(job.trustedDriverRoot, files.preparedCandidateArchive),
    ticketOutputPath: path.resolve(job.trustedDriverRoot, files.ticketOutputPath)
  });
}

function hostedClaimCapabilityArtifactId(origin: AuthenticatedGitHubJobOrigin): string {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const source = process.env.SEC_HOSTED_NEEDS_JSON;
  if (typeof source !== 'string' || source.length > 256 * 1024) {
    throw new Error('Hosted Action preflight artifact transport is unavailable or unbounded.');
  }
  const needs = dataObject(JSON.parse(source) as unknown, 'Action claim needs');
  const preflight = dataObject(needs['preflight-verification-action-sut'], 'Action claim preflight predecessor');
  if (preflight.result !== 'success') throw new Error('Hosted Action claim requires its successful SUT preflight.');
  const artifactId = dataObject(preflight.outputs, 'Action claim preflight outputs')['capability-artifact-id'];
  if (typeof artifactId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(artifactId)) {
    throw new Error('Hosted Action preflight upload has no exact artifact ID.');
  }
  return artifactId;
}

function hostedClaimPreparedDigests(origin: AuthenticatedGitHubJobOrigin): Readonly<{
  baseDependencyClosureDigest: `sha256:${string}`; authenticatedGitClosureDigest: `sha256:${string}`;
}> {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const source = process.env.SEC_HOSTED_STEPS_JSON;
  if (typeof source !== 'string' || source.length > 128 * 1024) {
    throw new Error('Hosted Action preparation output transport is unavailable or unbounded.');
  }
  const steps = dataObject(JSON.parse(source) as unknown, 'Action claim steps');
  const prepare = dataObject(steps.prepare, 'Action claim preparation step');
  if (prepare.conclusion !== 'success') throw new Error('Hosted Action claim requires its successful preparation.');
  const outputs = dataObject(prepare.outputs, 'Action claim preparation outputs');
  const base = outputs['base-dependency-closure-digest'];
  const git = outputs['authenticated-git-closure-digest'];
  if (typeof base !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(base)
      || typeof git !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(git)) {
    throw new Error('Hosted Action prepared closure digests are invalid.');
  }
  return Object.freeze({ baseDependencyClosureDigest: base as `sha256:${string}`,
    authenticatedGitClosureDigest: git as `sha256:${string}` });
}

/** Needs and steps are only data locators. The activation owner parses the
 * request again and reobserves all Git/provider facts before any effect. */
function hostedActivationNeed(origin: AuthenticatedGitHubJobOrigin): Readonly<{
  request: ReturnType<typeof parseAgentOperationActivationRequest>; requestPath: string;
}> {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.policyJobId !== 'agent-operation-activation' || job.role !== 'trusted') {
    throw new Error('Activation request has no authenticated activation job.');
  }
  const source = process.env.SEC_HOSTED_NEEDS_JSON;
  if (typeof source !== 'string' || source.length > 128 * 1024) {
    throw new Error('Activation needs transport is unavailable or unbounded.');
  }
  const needs = dataObject(JSON.parse(source) as unknown, 'activation needs');
  const validation = dataObject(needs['validate-agent-operation-activation-request'], 'activation validation');
  if (validation.result !== 'success') throw new Error('Activation validation has no successful source.');
  const outputs = dataObject(validation.outputs, 'activation validation outputs');
  const encoded = outputs['request-base64'];
  if (typeof encoded !== 'string' || encoded.length > 64 * 1024
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error('Activation request transport is not bounded canonical base64.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length < 2 || bytes.length > 48 * 1024) {
    throw new Error('Activation request base64 has noncanonical bytes.');
  }
  const request = parseAgentOperationActivationRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
  if (outputs['head-sha'] !== request.expectedHeadSha || outputs.phase !== request.phase
      || outputs['request-operation-hex'] !== request.requestOperationId.slice(7)) {
    throw new Error('Activation validated needs differ from the exact request.');
  }
  const parent = createNoFollowDirectoryChain(inspectNoFollowDirectoryChain(job.trustedDriverRoot).target,
    ['.tmp', 'codex', 'hosted-job', job.policyJobId, 'in', 'request']);
  const requestPath = path.join(parent.path, 'agent-operation-activation-request.json');
  writeCanonicalDurable(requestPath, request);
  parseAgentOperationActivationRequest(JSON.parse(assertCanonicalHostedOutput(requestPath, request)) as unknown);
  return Object.freeze({ request, requestPath });
}

function hostedActivationUpload(origin: AuthenticatedGitHubJobOrigin): Readonly<{
  artifactId: string; artifactDigest: `sha256:${string}`;
}> {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const source = process.env.SEC_HOSTED_STEPS_JSON;
  if (typeof source !== 'string' || source.length > 128 * 1024) {
    throw new Error('Activation upload step transport is unavailable or unbounded.');
  }
  const steps = dataObject(JSON.parse(source) as unknown, 'activation steps');
  const producer = dataObject(steps.produce, 'activation producer step');
  if (dataObject(producer.outputs, 'activation producer outputs').disposition !== 'created') {
    throw new Error('Activation publication requires a created original payload.');
  }
  const upload = dataObject(steps['upload-activation'], 'activation upload step');
  if (upload.conclusion !== 'success') throw new Error('Activation upload has no successful producer step.');
  const outputs = dataObject(upload.outputs, 'activation upload outputs');
  const artifactId = outputs['artifact-id'];
  const digest = outputs['artifact-digest'];
  if (typeof artifactId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(artifactId)
      || typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error('Activation upload transport identity is invalid.');
  }
  return Object.freeze({ artifactId, artifactDigest: `sha256:${digest}` as const });
}

function hostedActivationPayload(origin: AuthenticatedGitHubJobOrigin,
  phase: 'prepare' | 'finalize', outputPath: string, payloadDigest: string): void {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const source = readSessionArtifactText(outputPath);
  const parsed = JSON.parse(source) as unknown;
  const payload = phase === 'prepare'
    ? parseAgentOperationActivationPreparation(parsed)
    : parseAgentOperationActivationReceipt(parsed);
  if (source !== `${JSON.stringify(canonicalJson(payload), null, 2)}\n`
      || ('preparationDigest' in payload ? payload.preparationDigest : payload.activationDigest) !== payloadDigest) {
    throw new Error('Activation payload differs from its original canonical writer or result.');
  }
}

function hostedTerminalInputs(origin: AuthenticatedGitHubJobOrigin) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.policyJobId !== 'assemble-verification-action-terminal' || job.role !== 'trusted') {
    throw new Error('Hosted terminal inputs require the authenticated assembler job.');
  }
  return Object.freeze({
    providerEnvelopePath: hostedJobTransportSlot(origin, 'in', 'resolution', 'verification-action-provider-envelope.json'),
    envelopePath: hostedJobTransportSlot(origin, 'in', 'resolution', 'hosted-envelope.json'),
    resolutionPath: hostedJobTransportSlot(origin, 'in', 'resolution', 'hosted-action-resolution.json')
  });
}

function hostedTerminalExpectedRawDigest(origin: AuthenticatedGitHubJobOrigin): `sha256:${string}` {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const source = process.env.SEC_HOSTED_NEEDS_JSON;
  if (typeof source !== 'string' || source.length > 128 * 1024) {
    throw new Error('Hosted terminal needs transport is unavailable or unbounded.');
  }
  const needs = dataObject(JSON.parse(source) as unknown, 'terminal needs');
  const execution = dataObject(needs['execute-verification-action-sut'], 'terminal execution predecessor');
  if (execution.result !== 'success') throw new Error('Hosted terminal lacks its successful SUT predecessor.');
  const outputs = dataObject(execution.outputs, 'terminal execution outputs');
  const digest = outputs['raw-result-digest'];
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new Error('Hosted terminal raw result digest transport is invalid.');
  }
  return digest as `sha256:${string}`;
}

/** GitHub's step output file is only a transport projection. The fixed output
 * artifact must already have passed its original parser and physical readback. */
function projectHostedStepOutputs(origin: AuthenticatedGitHubJobOrigin,
  values: Readonly<Record<string, string>>): void {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const outputPath = process.env.GITHUB_OUTPUT;
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw new Error('Authenticated hosted step output sink is unavailable.');
  }
  const parent = inspectNoFollowDirectoryChain(path.dirname(outputPath), 'hosted step output parent');
  if (parent.target.path !== path.dirname(outputPath)) throw new Error('Hosted step output parent changed.');
  const lines = Object.entries(values).map(([key, value]) => {
    if (!/^[a-z][a-z0-9-]*$/u.test(key) || !/^[\x21-\x7e]{1,512}$/u.test(value)
        || value.includes('=')) throw new Error('Hosted step output projection is invalid.');
    return `${key}=${value}\n`;
  });
  const bytes = Buffer.from(lines.join(''), 'ascii');
  const fd = openSync(outputPath, fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > 1024 * 1024) {
      throw new Error('Hosted step output sink is not one bounded ordinary file.');
    }
    if (writeSync(fd, bytes) !== bytes.length) throw new Error('Hosted step output projection was not fully written.');
    fsyncSync(fd);
    const observed = Buffer.alloc(bytes.length);
    if (readSync(fd, observed, 0, observed.length, before.size) !== bytes.length
        || !observed.equals(bytes)) throw new Error('Hosted step output projection readback differs.');
  } finally {
    closeSync(fd);
  }
}

/** The operation foundation binds the original authenticated job to the
 * native supervisor's one process requirement. Its digests are correlation
 * data; only the supervisor's retained process session can execute effects. */
function issueHostedSutInvocation(origin: AuthenticatedGitHubJobOrigin, actionKey: string) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const requirement = Object.freeze({
    id: HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID,
    contractDigest: HOSTED_SUT_SUPERVISOR_CONTRACT_DIGEST,
    effectKinds: Object.freeze(['process'] as const),
    failureKinds: Object.freeze(['hosted-sut.process-admission', 'hosted-sut.process-settlement'])
  });
  const operation = bindSemanticOperation(compileSemanticOperationPlan({
    operation: 'verification.hosted-sut',
    intentDigest: sha256({ job: job.identityDigest, phase: job.phase, actionKey }) as OperationDigest,
    decisionDigest: sha256({ policy: job.policyDigest, requirement: requirement.contractDigest }) as OperationDigest,
    deadlineAtUnixMs: job.originalDeadlineAtUnixMs,
    aggregateBudgets: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS,
    requirements: [requirement],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: job.identityDigest })
  }), [compileCapabilityBinding({
    requirementId: requirement.id,
    contractDigest: requirement.contractDigest,
    providerIdentityDigest: sha256({
      issuer: 'authenticated-hosted-sut-native-process',
      job: job.identityDigest,
      source: job.trustedSourceSha,
      contract: requirement.contractDigest
    }) as OperationDigest
  })]);
  return Object.freeze({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation, requirementId: requirement.id,
      resourceCeilings: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS,
      absoluteDeadlineAtUnixMs: job.originalDeadlineAtUnixMs
    }),
    trustedSourceRoot: job.trustedDriverRoot,
    signal: getAuthenticatedGitHubJobOriginSignal(origin)
  });
}

async function executeVerificationControl(origin: AuthenticatedGitHubJobOrigin,
  command: ReturnType<typeof parseHostedVerificationCommand>): Promise<string> {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.role !== 'control' || command.command !== job.phase || command.repository !== job.repository) {
    throw new Error('Hosted integration selector differs from its authenticated control job.');
  }
  return await withQualifiedHostedJobContainerEngine({ origin, execute: async engineExporter => {
    const environment = process.env;
    const ctx = await createBranchLifecycleVerificationScope(job.trustedDriverRoot);
    const github = createVerificationSessionGitHubClient(job.trustedDriverRoot, job.repository, {
      deadlineAtUnixMs: job.originalDeadlineAtUnixMs,
      signal: getAuthenticatedGitHubJobOriginSignal(origin)
    });
    const event = githubEvent(environment);
    const journalFs = await openRuntimeJournalFileSystem(job.trustedDriverRoot, environment);
    return await executeHostedVerificationCommand({
      command, origin, engineExporter, ctx, github, event, environment, journalFs,
      closeoutOperations: worktreePhysicalCloseoutOperations
    });
  } });
}

async function probeSut(origin: AuthenticatedGitHubJobOrigin, resolutionPath: string): Promise<string> {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.role !== 'sut') throw new Error('Hosted SUT probe requires an authenticated SUT job.');
  const output = path.join(ensureHostedJobOutputParent(origin, 'capability'), 'hosted-sut-capability.json');
  const projection = await runHostedSutPreflight({
    readResolution: () => CodexDevelopmentParseHostedActionResolution(
      hostedActionTransportText(resolutionPath, 'hosted Action resolution')
    ),
    issueInvocation: actionKey => issueHostedSutInvocation(origin, actionKey),
    probe: (input, invocation) => runHostedSutCapabilityProbe(input, invocation),
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
  });
  writeCanonicalDurable(output, projection);
  const observed = JSON.parse(assertCanonicalHostedOutput(output, projection)) as typeof projection;
  if (observed.schema !== projection.schema || observed.status !== projection.status
      || observed.actionKey !== projection.actionKey || observed.policyDigest !== projection.policyDigest) {
    throw new Error('Hosted SUT capability fixed-slot projection changed after publication.');
  }
  parseHostedSutCapabilityObservation(observed.observation);
  projectHostedStepOutputs(origin, {
    'capability-artifact-name': hostedJobSutArtifactName(
      'preflight-verification-action-sut', observed.actionKey, job.runId, job.runAttempt),
    'capability-ready': 'true'
  });
  return JSON.stringify(projection);
}

async function executeSut(origin: AuthenticatedGitHubJobOrigin, input: Readonly<{
  resolutionPath: string; ticketPath: string; candidateArchive: string; outputPath: string;
}>): Promise<string> {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (job.role !== 'sut') throw new Error('Hosted SUT execution requires an authenticated SUT job.');
  ensureHostedJobOutputParent(origin, 'raw');
  const result = await runHostedSutExecution({
    candidateArchive: input.candidateArchive, outputPath: path.resolve(input.outputPath)
  }, {
    readResolution: () => CodexDevelopmentParseHostedActionResolution(
      hostedActionTransportText(input.resolutionPath, 'hosted Action resolution')
    ),
    readTicket: () => CodexDevelopmentParseHostedActionExecutionTicket(
      hostedActionTransportText(input.ticketPath, 'hosted Action execution ticket')
    ),
    issueInvocation: actionKey => issueHostedSutInvocation(origin, actionKey),
    materializeCandidate: source => CodexDevelopmentMaterializeHostedActionCandidate({
      resolution: source.resolution, ticket: source.ticket,
      preparedCandidateArchive: source.candidateArchive
    }),
    prepare: prepareHostedActionSutInputs,
    run: (prepared, invocation) => runHostedActionSut(prepared, invocation),
    writeResult: (outputPath, rawResult) => {
      writeCanonicalDurable(outputPath, rawResult);
      const source = assertCanonicalHostedOutput(outputPath, rawResult);
      const observed = CodexDevelopmentParseHostedActionRawResult(source);
      if (observed.rawResultDigest !== rawResult.rawResultDigest) {
        throw new Error('Hosted SUT raw-result digest changed after fixed-slot publication.');
      }
    }
  });
  const raw = CodexDevelopmentParseHostedActionRawResult(readSessionArtifactText(input.outputPath));
  const reported = JSON.parse(result) as Readonly<{ rawResultDigest?: unknown }>;
  if (reported.rawResultDigest !== raw.rawResultDigest) {
    throw new Error('Hosted raw result changed after its original application publication.');
  }
  const resolution = CodexDevelopmentParseHostedActionResolution(
    hostedActionTransportText(input.resolutionPath, 'hosted Action resolution'));
  projectHostedStepOutputs(origin, {
    'raw-result-digest': raw.rawResultDigest,
    'raw-artifact-name': hostedJobSutArtifactName(
      'execute-verification-action-sut', resolution.actionPlan.action.actionKey, job.runId, job.runAttempt),
    'raw-ready': 'true'
  });
  return result;
}

async function withAuthenticatedHostedOrigin<T>(
  execute: (origin: AuthenticatedGitHubJobOrigin) => Promise<T>
): Promise<T> {
  const origin = await openAuthenticatedGitHubJobOrigin({ repositoryRoot: SOURCE_ROOT });
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    return await execute(origin);
  } catch (error) {
    primary = Object.freeze({ label: 'authenticated-hosted-job', error });
    throw error;
  } finally {
    await settleResourcesAsync({ ...(primary === undefined ? {} : { primary }), cleanup: [
      { label: 'authenticated-hosted-job-origin', settle: () => closeAuthenticatedGitHubJobOrigin(origin) }
    ] });
  }
}

function assertCanonicalHostedJobPolicy(origin: AuthenticatedGitHubJobOrigin) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const policy = getCiVerificationPerJobHostedJobPolicy(job.workflowPath, job.policyJobId);
  if (policy === null || policy.runtime.kind !== 'per-job-runtime' ||
      policy.role !== job.role || job.policyDigest !== CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST ||
      !policy.stages.some(stage => stage.kind === 'phase' && stage.phase === job.phase && stage.stepName === job.stepName)) {
    throw new Error('Hosted job phase differs from its canonical authenticated policy member.');
  }
  return job;
}

/** The original public parser supplies only a typed command/transport path.
 * The genuine job origin and reviewed phase still own effect admission. */
export async function runHostedVerificationInvocation(
  command: ReturnType<typeof parseHostedVerificationCommand>
): Promise<string> {
  return await withAuthenticatedHostedOrigin(async origin => {
    assertCanonicalHostedJobPolicy(origin);
    return await executeVerificationControl(origin, command);
  });
}

/** Single authenticated hosted production entry. The original native issuer
 * owns source, deadline and closeout; argv never creates an Effect grant. */
export async function runHostedJobRuntime(argv: readonly string[]): Promise<string> {
  return await withAuthenticatedHostedOrigin(async origin => {
    const job = assertCanonicalHostedJobPolicy(origin);
    const phase = selectHostedJobRuntimePhase({
      argv, authenticatedJobId: job.policyJobId, authenticatedPhase: job.phase
    });
    switch (phase) {
      case 'prepare-parent-plan': {
        if (job.role !== 'control' || job.policyJobId !== 'coordinate-verification-session') {
          throw new Error('Hosted parent preparation requires its authenticated coordinator.');
        }
        const environment = process.env;
        const files = hostedCoordinatorFiles(origin);
        if (path.dirname(files.parentPlanPath) !== ensureHostedJobOutputParent(origin, 'parent-plan')) {
          throw new Error('Hosted parent plan is outside its sole upload member.');
        }
        const ctx = await createBranchLifecycleVerificationScope(job.trustedDriverRoot);
        const github = createVerificationSessionGitHubClient(job.trustedDriverRoot, job.repository, {
          deadlineAtUnixMs: job.originalDeadlineAtUnixMs,
          signal: getAuthenticatedGitHubJobOriginSignal(origin)
        });
        const result = await prepareHostedActionCoordinationSession({
          origin, ctx, github, event: githubEvent(environment), environment
        }, { sessionRequestBase64: hostedCoordinatorRequest(origin), requestPath: files.requestPath,
          factsPath: files.factsPath, envelopePath: files.envelopePath, parentPlanPath: files.parentPlanPath });
        const source = readSessionArtifactText(files.parentPlanPath);
        const plan = parseCiVerificationActionParentDispatchPlan(JSON.parse(source) as unknown);
        if (source !== `${encodeVerificationActionData(plan)}\n` || result.output !== files.parentPlanPath
            || result.payloadDigest !== ciVerificationActionParentDispatchPlanPayloadDigest(plan)
            || result.parentDispatchPlanDigest !== plan.parentDispatchPlanDigest
            || result.artifactName !== ciVerificationActionParentDispatchPlanArtifactName(
              plan.parentRunId, plan.parentRunAttempt)) {
          throw new Error('Hosted parent plan differs from its original canonical writer.');
        }
        projectHostedStepOutputs(origin, {
          'parent-plan-artifact-name': result.artifactName,
          'parent-plan-ready': 'true'
        });
        return JSON.stringify(result);
      }
      case 'coordinate-session': {
        if (job.role !== 'control' || job.policyJobId !== 'coordinate-verification-session') {
          throw new Error('Hosted Session completion requires its authenticated coordinator.');
        }
        const environment = process.env;
        const files = hostedCoordinatorFiles(origin);
        if (path.dirname(files.artifactPath) !== ensureHostedJobOutputParent(origin, 'session')) {
          throw new Error('Hosted Session artifact is outside its sole upload member.');
        }
        const ctx = await createBranchLifecycleVerificationScope(job.trustedDriverRoot);
        const github = createVerificationSessionGitHubClient(job.trustedDriverRoot, job.repository, {
          deadlineAtUnixMs: job.originalDeadlineAtUnixMs,
          signal: getAuthenticatedGitHubJobOriginSignal(origin)
        });
        const result = await completeHostedActionCoordinationSession({
          origin, ctx, github, event: githubEvent(environment), environment
        }, { ...files, ...hostedCoordinatorParentUpload(origin) });
        const source = readSessionArtifactText(files.artifactPath);
        const artifact = CodexDevelopmentParseVerificationSessionArtifact(source);
        if (result.status !== 'finalized' || result.output !== files.artifactPath
            || result.artifactDigest !== artifact.artifactDigest
            || source !== `${encodeVerificationActionData(artifact)}\n`) {
          throw new Error('Hosted Session terminal differs from its original canonical writer.');
        }
        projectHostedStepOutputs(origin, {
          'session-artifact-name': hostedSessionArtifactName({
            prNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision,
            runId: job.runId, runAttempt: job.runAttempt
          }),
          'session-ready': 'true'
        });
        return JSON.stringify(result);
      }
      case 'resolve-hosted-action': {
        if (job.role !== 'trusted' || job.policyJobId !== 'resolve-verification-action') {
          throw new Error('Hosted Action resolution requires its authenticated resolver.');
        }
        const environment = process.env;
        const files = hostedResolverFiles(origin);
        const resolutionParent = ensureHostedJobOutputParent(origin, 'resolution');
        if ([files.providerEnvelopePath, files.envelopePath, files.resolutionPath]
          .some(file => path.dirname(file) !== resolutionParent)) {
          throw new Error('Hosted Action resolution members differ from their sole upload slot.');
        }
        const ctx = await createBranchLifecycleVerificationScope(job.trustedDriverRoot);
        const github = createVerificationSessionGitHubClient(job.trustedDriverRoot, job.repository, {
          deadlineAtUnixMs: job.originalDeadlineAtUnixMs,
          signal: getAuthenticatedGitHubJobOriginSignal(origin)
        });
        const result = await resolveHostedActionCoordinationSession({
          origin, ctx, github, event: githubEvent(environment), environment
        }, { ...files, actionEnvelopeBase64: hostedActionEnvelopeTransport(origin) });
        const providerSource = readSessionArtifactText(files.providerEnvelopePath);
        const providerEnvelope = parseCiVerificationActionProviderEnvelope(JSON.parse(providerSource) as unknown);
        const envelope = parseHostedEnvelope(JSON.parse(readSessionArtifactText(files.envelopePath)) as unknown);
        const resolutionSource = readSessionArtifactText(files.resolutionPath);
        const resolution = CodexDevelopmentParseHostedActionResolution(resolutionSource);
        const derived = CodexDevelopmentResolveHostedAction({
          request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(providerEnvelope.proposal)), envelope
        });
        if (providerSource !== `${encodeVerificationActionData(providerEnvelope)}\n`
            || resolutionSource !== `${encodeVerificationActionData(resolution)}\n`
            || encodeVerificationActionData(derived) !== encodeVerificationActionData(resolution)
            || result.resolution.output !== files.resolutionPath
            || result.resolution.resolutionDigest !== resolution.resolutionDigest
            || result.resolution.actionKey !== resolution.actionPlan.action.actionKey
            || result.resolution.actionKeyHex !== resolution.actionKeyHex
            || result.provider.artifactIndex !== files.artifactIndexPath
            || envelope.session.repository !== job.repository) {
          throw new Error('Hosted Action resolution transport differs from its original writer and observation.');
        }
        projectHostedStepOutputs(origin, {
          'action-key-hex': result.resolution.actionKeyHex,
          'provider-disposition': result.provider.disposition,
          'resolution-artifact-name': hostedActionResolutionArtifactName(
            resolution.actionPlan.action.actionKey, job.runId, job.runAttempt),
          'resolution-ready': 'true'
        });
        return JSON.stringify(result);
      }
      case 'prepare-start-marker': {
        if (job.role !== 'trusted' || job.policyJobId !== 'claim-verification-action') {
          throw new Error('Hosted Action marker preparation requires its authenticated claim job.');
        }
        const files = hostedClaimFiles(origin);
        if (path.dirname(files.markerOutputPath) !== ensureHostedJobOutputParent(origin, 'start')
            || files.archiveOutputDirectory !== ensureHostedJobOutputParent(origin, 'prepared')
            || path.dirname(files.preparedCandidateArchive) !== files.archiveOutputDirectory) {
          throw new Error('Hosted Action preparation differs from its canonical fixed output members.');
        }
        const resolution = CodexDevelopmentParseHostedActionResolution(readSessionArtifactText(files.resolutionPath));
        const result = await prepareHostedActionClaim(origin, {
          providerEnvelopePath: files.providerEnvelopePath, envelopePath: files.envelopePath,
          resolutionPath: files.resolutionPath, archiveOutputDirectory: files.archiveOutputDirectory,
          markerOutputPath: files.markerOutputPath,
          capabilitySelection: Object.freeze({ repository: job.repository,
            artifactId: hostedClaimCapabilityArtifactId(origin), runId: job.runId, runAttempt: job.runAttempt,
            policyJobId: 'preflight-verification-action-sut' as const,
            phase: 'self-test-hosted-action-sandbox' as const,
            actionKey: resolution.actionPlan.action.actionKey })
        });
        const markerSource = readSessionArtifactText(files.markerOutputPath);
        const marker = parseVerificationActionProviderStartMarker(JSON.parse(markerSource) as unknown);
        const archive = readSessionArtifactBytes(files.preparedCandidateArchive);
        const archiveDigest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
        if (markerSource !== `${encodeVerificationActionData(marker)}\n`
            || result.output !== files.markerOutputPath || result.preparedCandidateArchive !== files.preparedCandidateArchive
            || result.actionKey !== marker.actionKey || result.markerDigest !== marker.markerDigest
            || result.markerName !== verificationActionProviderStartArtifactName(marker.actionKey)
            || result.archiveDigest !== archiveDigest) {
          throw new Error('Hosted Action marker or prepared archive differs from its original writer.');
        }
        projectHostedStepOutputs(origin, {
          'start-artifact-name': result.markerName,
          'start-ready': 'true',
          'base-dependency-closure-digest': result.baseDependencyClosureDigest,
          'authenticated-git-closure-digest': result.authenticatedGitClosureDigest
        });
        return JSON.stringify(result);
      }
      case 'claim-start': {
        if (job.role !== 'trusted' || job.policyJobId !== 'claim-verification-action') {
          throw new Error('Hosted Action claim requires its authenticated claim job.');
        }
        const files = hostedClaimFiles(origin);
        if (files.archiveOutputDirectory !== ensureHostedJobOutputParent(origin, 'prepared')
            || path.dirname(files.ticketOutputPath) !== files.archiveOutputDirectory) {
          throw new Error('Hosted Action ticket differs from its canonical prepared member.');
        }
        const digests = hostedClaimPreparedDigests(origin);
        const result = await claimHostedActionStart(origin, {
          providerEnvelopePath: files.providerEnvelopePath, envelopePath: files.envelopePath,
          resolutionPath: files.resolutionPath, preparedCandidateArchive: files.preparedCandidateArchive,
          ...digests, outputPath: files.ticketOutputPath
        });
        if (!result.issued) {
          projectHostedStepOutputs(origin, { 'ticket-issued': 'false' });
          return JSON.stringify(result);
        }
        const ticketSource = readSessionArtifactText(files.ticketOutputPath);
        const ticket = CodexDevelopmentParseHostedActionExecutionTicket(ticketSource);
        const archive = readSessionArtifactBytes(files.preparedCandidateArchive);
        const archiveDigest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
        if (ticketSource !== `${encodeVerificationActionData(ticket)}\n`
            || result.output !== files.ticketOutputPath || result.actionKey !== ticket.actionKey
            || result.ticketDigest !== ticket.ticketDigest || ticket.preparedCandidateArchiveDigest !== archiveDigest
            || ticket.baseDependencyClosureDigest !== digests.baseDependencyClosureDigest
            || ticket.authenticatedGitClosureDigest !== digests.authenticatedGitClosureDigest) {
          throw new Error('Hosted Action execution ticket or archive differs from its original writer.');
        }
        projectHostedStepOutputs(origin, {
          'ticket-issued': 'true',
          'ticket-digest': ticket.ticketDigest,
          'prepared-artifact-name': ticket.preparedCandidateArtifactName,
          'prepared-ready': 'true'
        });
        return JSON.stringify(result);
      }
      case 'assemble-hosted-action-terminal': {
        const output = path.join(ensureHostedJobOutputParent(origin, 'terminal'),
          'verification-action-terminal-artifact.json');
        const result = await assembleHostedActionTerminal(origin, {
          ...hostedTerminalInputs(origin),
          ticketPath: hostedJobTransportSlot(origin, 'in', 'prepared', 'verification-action-execution-ticket.json'),
          rawResultPath: hostedJobTransportSlot(origin, 'in', 'raw', 'verification-action-raw-observation.json'),
          expectedRawResultDigest: hostedTerminalExpectedRawDigest(origin), outputPath: output
        });
        const source = readSessionArtifactText(output);
        const observed = CodexDevelopmentParseVerificationActionTerminalArtifact(source);
        if (result.output !== output || observed.artifactDigest !== result.artifactDigest
            || observed.actionPlan.action.actionKey !== result.actionKey
            || source !== `${encodeVerificationActionData(observed)}\n`) {
          throw new Error('Hosted terminal output differs from original writer readback.');
        }
        projectHostedStepOutputs(origin, {
          'terminal-artifact-name': result.artifactName,
          'terminal-ready': 'true'
        });
        return JSON.stringify(result);
      }
      case 'prepare-terminal-anchor': {
        const output = path.join(ensureHostedJobOutputParent(origin, 'anchor'),
          'verification-action-terminal-status-anchor.json');
        const result = await prepareHostedActionTerminalAnchor(origin, {
          ...hostedTerminalInputs(origin), outputPath: output
        });
        const source = readSessionArtifactText(output);
        const anchor = parseVerificationActionProviderTerminalAnchor(JSON.parse(source) as unknown);
        if (result.output !== output || anchor.anchorDigest !== result.anchorDigest
            || anchor.actionKey !== result.actionKey
            || source !== `${encodeVerificationActionData(anchor)}\n`) {
          throw new Error('Hosted terminal anchor differs from original writer readback.');
        }
        projectHostedStepOutputs(origin, {
          'anchor-artifact-name': result.anchorName,
          'anchor-ready': 'true'
        });
        return JSON.stringify(result);
      }
      case 'anchor-terminal':
        return JSON.stringify(await anchorHostedActionTerminal(origin, hostedTerminalInputs(origin)));
      case 'produce-hosted': {
        const activation = hostedActivationNeed(origin);
        const outputPath = path.join(ensureHostedJobOutputParent(origin, 'activation'),
          AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE);
        const result = await produceHostedAgentOperationActivation({
          runtimeRoot: job.trustedDriverRoot,
          candidateRoot: path.join(job.trustedDriverRoot, 'candidate'),
          requestPath: activation.requestPath, outputPath
        });
        if (result.disposition === 'created') {
          hostedActivationPayload(origin, activation.request.phase, outputPath, result.payloadDigest);
          projectHostedStepOutputs(origin, {
            disposition: 'created',
            'activation-artifact-name': result.artifactName,
            'activation-ready': 'true'
          });
        } else {
          projectHostedStepOutputs(origin, { disposition: 'existing' });
        }
        return JSON.stringify(result);
      }
      case 'publish-hosted': {
        const activation = hostedActivationNeed(origin);
        const upload = hostedActivationUpload(origin);
        const payloadPath = hostedJobTransportSlot(origin, 'out', 'activation',
          AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE);
        const result = publishHostedAgentOperationActivation({
          runtimeRoot: job.trustedDriverRoot, requestPath: activation.requestPath,
          payloadPath, artifactId: upload.artifactId, artifactDigest: upload.artifactDigest
        });
        return JSON.stringify(result);
      }
      case 'prepare-integration-hosted':
      case 'integrate-hosted':
      case 'closeout-mutate-hosted':
      case 'closeout-publish-hosted': {
        const slot = phase === 'prepare-integration-hosted' ? 'recovery' : 'closeout';
        const parent = slot === 'closeout'
          ? ensureHostedCloseoutProjectionParent(origin)
          : ensureHostedJobOutputParent(origin, slot);
        const file = phase === 'closeout-publish-hosted'
          ? 'closeout-publication-projection.json' : 'integration-projection.json';
        const command = parseHostedVerificationCommand([
          phase, '--repository', job.repository, '--output', path.join(parent, file), '--json'
        ]);
        const result = await executeVerificationControl(origin, command);
        if (phase === 'prepare-integration-hosted') {
          const projection = dataObject(JSON.parse(result) as unknown, 'recovery projection');
          const projectionPath = path.join(parent, file);
          const readback = dataObject(JSON.parse(readSessionArtifactText(projectionPath)) as unknown,
            'recovery projection readback');
          const { output: projectedPath, ...originalProjection } = projection;
          if (projectedPath !== projectionPath
              || encodeVerificationActionData(readback) !== encodeVerificationActionData(originalProjection)) {
            throw new Error('Recovery projection differs from its original native writer.');
          }
          const lane = readback.lane;
          if (lane !== 'open-first-effect' && lane !== 'merged-recovery' && lane !== 'blocked') {
            throw new Error('Recovery projection has no admitted integration lane.');
          }
          const outputs: Record<string, string> = { 'integration-lane': lane };
          if (projection.recoveryArtifact !== undefined) {
            const recovery = dataObject(projection.recoveryArtifact, 'recovery artifact projection');
            const artifactPath = path.join(parent, BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME);
            if (recovery.artifactFilePath !== undefined && (recovery.artifactFilePath !== artifactPath
                || projection.output !== path.join(parent, file))) {
              throw new Error('Recovery materialization differs from its canonical fixed output.');
            }
            if (recovery.artifactFilePath === artifactPath) {
              const artifact = parseBranchCloseoutRecoveryArtifact(readSessionArtifactText(artifactPath));
              const preflight = CodexDevelopmentParseMergeGateResult(readSessionArtifactText(
                hostedIntegrationPreflightTransportPath(job.trustedDriverRoot, 'producer')));
              if (artifact.artifactDigest !== recovery.artifactDigest
                  || preflight.resultDigest !== projection.preflightResultDigest
                  || preflight.authorization.headSha !== artifact.headSha
                  || preflight.authorization.rulesetDigest !== preflight.platformObservation.rulesetDigest
                  || recovery.artifactName !== branchCloseoutRecoveryArtifactName({
                    prNumber: artifact.pullRequestNumber, sessionRevision: artifact.sessionRevision,
                    runId: job.runId, runAttempt: job.runAttempt
                  })) throw new Error('Recovery upload members differ from original preparation.');
              outputs['recovery-artifact-name'] = recovery.artifactName as string;
              outputs['recovery-ready'] = 'true';
              outputs['head-sha'] = preflight.authorization.headSha;
              outputs['preflight-result-digest'] = preflight.resultDigest;
              outputs['ruleset-digest'] = preflight.authorization.rulesetDigest;
            }
          }
          if (lane === 'open-first-effect' && outputs['recovery-ready'] !== 'true') {
            throw new Error('Open integration preparation has no original recovery and preflight readback.');
          }
          projectHostedStepOutputs(origin, outputs);
        }
        return result;
      }
      case 'self-test-hosted-action-sandbox':
        return await probeSut(origin, hostedJobTransportSlot(
          origin, 'in', 'resolution', 'hosted-action-resolution.json'
        ));
      case 'execute-hosted-action-sut':
        return await executeSut(origin, {
          resolutionPath: hostedJobTransportSlot(origin, 'in', 'resolution', 'hosted-action-resolution.json'),
          ticketPath: hostedJobTransportSlot(origin, 'in', 'prepared', 'verification-action-execution-ticket.json'),
          candidateArchive: hostedJobTransportSlot(origin, 'in', 'prepared', 'prepared-candidate.tar'),
          outputPath: hostedJobTransportSlot(origin, 'out', 'raw', 'verification-action-raw-observation.json')
        });
      case 'resume-verification-session': {
        if (job.role !== 'control') throw new Error('Hosted Session resume sender requires its control job.');
        const wakeup = hostedMergeWakeupLocator(githubEvent(process.env));
        return JSON.stringify(await executeHostedSessionResumeSender({
          origin, sourceRunId: wakeup.sourceRunId, sourceRunAttempt: wakeup.sourceRunAttempt
        }));
      }
      case 'receive-verification-session-resume': {
        if (job.role !== 'control') throw new Error('Hosted Session resume receiver requires its control job.');
        const environment = process.env;
        const event = githubEvent(environment);
        const ctx = await createBranchLifecycleVerificationScope(job.trustedDriverRoot);
        const github = createVerificationSessionGitHubClient(job.trustedDriverRoot, job.repository, {
          deadlineAtUnixMs: job.originalDeadlineAtUnixMs,
          signal: getAuthenticatedGitHubJobOriginSignal(origin)
        });
        const journalFs = await openRuntimeJournalFileSystem(job.trustedDriverRoot, environment);
        const output = path.join(ensureHostedJobOutputParent(origin, 'session'), 'verification-session-artifact.json');
        const dispatchOutcomesOutput = path.join(ensureHostedJobOutputParent(origin, 'resume-outcomes'),
          HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE);
        const runReceiver = () => executeHostedSessionResumeReceiverCommand({
          origin, ctx, github, journalFs, event, environment, output, dispatchOutcomesOutput
        });
        let result: Awaited<ReturnType<typeof runReceiver>> | undefined;
        let primary: Readonly<{ label: string; error: unknown }> | undefined;
        try {
          result = await runReceiver();
          if (result.status === 'finalized' && result.artifact !== null) {
            const observed = parseHostedSessionTerminalArtifact(readSessionArtifactText(output));
            if (observed.schema !== 'verification-session-delegated-terminal'
                || observed.artifactDigest !== result.artifact.artifactDigest) {
              throw new Error('Hosted resumed Session artifact changed after native publication.');
            }
            projectHostedStepOutputs(origin, {
              'session-artifact-name': hostedSessionArtifactName({
                prNumber: observed.session.prNumber, sessionRevision: observed.session.sessionRevision,
                runId: job.runId, runAttempt: job.runAttempt
              }),
              'session-ready': 'true'
            });
          }
        } catch (error) {
          primary = Object.freeze({ label: 'hosted resume receiver', error });
        }
        await settleResourcesAsync({ ...(primary === undefined ? {} : { primary }), cleanup: [{
          label: 'resume outcome fixed-slot readback', settle: () => {
            const expected = path.resolve(job.trustedDriverRoot,
              ciVerificationHostedJobTransportSlot(job.policyJobId, 'out', 'resume-outcomes'),
              HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE);
            if (path.resolve(dispatchOutcomesOutput) !== expected) {
              throw new Error('Resume outcome projection differs from its canonical transport member.');
            }
            let source: string;
            try {
              source = readSessionArtifactText(dispatchOutcomesOutput);
            } catch (error) {
              if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
                if (result !== undefined && 'coordination' in result && result.coordination.disposition === 'dispatch') {
                  throw new Error('Resume dispatch completed without its required outcome collection.');
                }
                return;
              }
              throw error;
            }
            if (Buffer.byteLength(source, 'utf8') > 10 * 1024 * 1024) {
              throw new Error('Resume outcome collection exceeds its original member bound.');
            }
            const selector = JSON.parse(source) as { expectedActionKeys?: unknown };
            if (!Array.isArray(selector.expectedActionKeys)) {
              throw new Error('Resume outcome collection has no Action membership selector.');
            }
            const observed = parseHostedResumeDispatchOutcomeCollection(source,
              selector.expectedActionKeys as readonly `sha256:${string}`[]);
            const currentSignal = observeHostedResumeReceiverSignal({ origin, ctx, event: githubEvent(environment) });
            if (observed.receiver.repository !== job.repository || observed.receiver.workflowPath !== job.workflowPath
                || observed.receiver.workflowSha !== job.workflowSha || observed.receiver.runId !== job.runId
                || observed.receiver.runAttempt !== job.runAttempt || observed.receiver.jobId !== job.jobId
                || JSON.stringify(observed.signal) !== JSON.stringify(currentSignal)) {
              throw new Error('Resume outcome collection differs from the current authenticated receiver cause.');
            }
            projectHostedStepOutputs(origin, {
              'resume-outcomes-artifact-name': hostedResumeDispatchOutcomesArtifactName(job.runId, job.runAttempt),
              'resume-outcomes-ready': 'true'
            });
          }
        }] });
        if (result === undefined) throw new Error('Hosted resume receiver has no settled result.');
        return JSON.stringify({ status: result.status,
          artifactDigest: result.artifact?.artifactDigest ?? null,
          output: result.artifact === null ? null : output });
      }
      default:
        throw new Error('Authenticated hosted job phase has no admitted runtime consumer.');
    }
  });
}

// The reviewed hosted policy names this bootstrap path as its launcher. The
// separate entry module uses the same public function for local CLI routing.
if (import.meta.main) {
  const result = await runHostedJobRuntime(process.argv.slice(2));
  process.stdout.write(`${result}\n`);
}
