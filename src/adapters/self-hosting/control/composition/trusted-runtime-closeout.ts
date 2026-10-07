#!/usr/bin/env bun
import type { CI_VERIFICATION_CONTRACT_REVISION } from "../../../../assurance/verification/contract/revision.ts";
import type { VerificationGateResult, VerificationResultStatus } from "../../../../assurance/verification/result/contract/result.ts";

import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs as parseNativeArgs } from 'node:util';
import type { GitHubCandidateObservation, MainHealthLedger, VerificationSessionArtifact } from '../../../../execution/verification/session.ts';
import type { SourceProgramTransitionAcceptanceRecord } from '../../../verification/platform/ci/contract/evidence.ts';
import type { TrustedRuntimeSourceProgramAttemptEvidence } from '../../../verification/platform/trusted-runtime/trusted-runtime-container.ts';

import { settleResources, settleResourcesAsync, withAcquiredResource, type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { getAuthenticatedGitHubJobOriginSignal, type AuthenticatedGitHubJobOrigin } from '../../../providers/github-api/hosted-job-origin.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiMergeWriteSession,
  withGitHubApiReadSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { observeGitHubRepositoryComment } from '../../../providers/github-api/repository-comment.ts';
import { adoptSourceProgramTestAuthorDecision, type SourceProgramTestAuthorApproval } from '../../../repository/source-program-model/test-disposition-decisions.ts';
import { acquirePhysicalMutationLease } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import { inspectExactNoFollowDirectoryPresence, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, scanNoFollowDirectoryDirectMetadata, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecRuntimeStateForRepository } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority, type SecRuntimeStatePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { createCiVerificationNativeLocalExecutionEnvironment, parseCiSourceProgramTransitionBinding } from '../../../verification/platform/action/contract/ci.ts';
import { CodexDevelopmentAssertVerificationEvidenceV4, CodexDevelopmentParseVerificationSessionArtifact, parseSourceProgramTransitionAcceptanceRecord } from '../../../verification/platform/ci/contract/evidence.ts';
import { CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA, CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA, assertVerificationSessionLocalPreparationV2Current, type VerificationSessionLocalPreparation, type VerificationSessionLocalPreparationRequestV2 } from '../../../verification/platform/ci/contract/session-request.ts';
import { readSessionArtifactText } from '../../../verification/platform/ci/runtime/session-artifact-files.ts';
import { createVerificationSessionGitHubClient, type VerificationSessionGitHubClient } from '../../../verification/platform/ci/runtime/verification-session-github.ts';
import {
  assertVerificationSessionLocalPreparationCurrent,
  createTrustedRuntimeArtifactObservationFromDurableFile,
  createVerificationSessionMergeOperationId,
  createVerificationSessionReviewReceipt,
  finalizeVerificationSessionHostedArtifact,
  parseVerificationSessionLocalPreparationRequest,
  prepareLocalVerificationIntent,
  prepareTrustedMainVerificationSession,
  prepareTrustedRuntimeVerificationSession,
  prepareVerificationSessionTrustedRuntimeMergeInput,
  refreshVerificationSessionHostedArtifact
} from '../../../verification/platform/ci/runtime/verification-session-runtime.ts';
import {
  assertHostedSquashMergeCompletion,
  observeExactIssueDispositionPlan,
  observePostMergeIssueReconciliation,
  observeVerificationSessionActionDependencyBlobs,
  observeVerificationSessionChangedSelection,
  parseHostedSynchronousSquashMergeResponse,
  readExactCommitMarker
} from '../../../verification/platform/ci/runtime/verification-session.ts';
import { renderIndependentReviewTrailer } from '../../../verification/platform/review/contract/stability.ts';
import {
  executeTrustedRuntimeContainerVerification,
  executeTrustedRuntimeWorkspaceCanary,
  parseTrustedRuntimeContainerReceipt,
  parseTrustedRuntimeSourceProgramAttemptEvidence,
  withTrustedRuntimeMainHealthQualification,
  type SourceProgramTransitionQualification,
  type TrustedRuntimeContainerReceipt
} from '../../../verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { GIT_READ_OPERATION_BUDGET, gitReadText } from '../../development/tooling/git/git-read.ts';
import {
  integrationAuthorizationStatusMergeMarkers,
  parseIntegrationAuthorizationStatusPublication,
  publishIntegrationAuthorizationStatus
} from '../integration/integration-authorization-status-github.ts';
import {
  CodexDevelopmentEvaluateTrustedRuntimeMergeGate,
  CodexDevelopmentMergeGateProducerIdentity,
  CodexDevelopmentParseTrustedRuntimeMergeGateResult
} from '../integration/merge-gate.ts';
import {
  parseGitHubClosingKeywordOccurrences
} from '../issues/disposition.ts';
import { assertIntegrationMainHealthProducer, assertTrustedRuntimeMainHealthPublication, type TrustedRuntimeMainHealthPublicationAdmission } from '../main-health/live-admission.ts';
import type { TrustedRuntimeMainHealthReceipt } from '../main-health/main-health-observation.ts';
import { assertTrustedRuntimePostMergeMainHealthPlanCurrent, type TrustedRuntimePostMergeMainHealthPlan } from '../main-health/post-merge-plan.ts';
import {
  assertMainHealthPublicationAuthorityStable,
  observeCanonicalMainHealthForPublication,
  observeMainHealthGitHubDefaultBranchSha,
  withMainHealthGitHubReadOperationBudget
} from '../main-health/work-selection-main-health.ts';
import {
  CodexDevelopmentAssertWorkPackageOwnership,
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentWorkPackageManifestDigest
} from '../task/contract/work-package.ts';

const TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA =
  'sec-trusted-runtime-action-bundle-v1' as const;
type Digest = `sha256:${string}`;

async function withTrustedRuntimeStateAuthority<T>(input: Readonly<{
  repositoryRoot: string;
  stateRoot: string;
  cacheRoot: string;
  sessionRoot: string;
}>, operation: (authority: SecRuntimeStatePhysicalAuthority) => T | Promise<T>): Promise<T> {
  return withAcquiredResource({
    operationLabel: 'trusted-runtime-state-operation',
    resourceLabel: 'trusted-runtime-state-authority',
    acquire: () => acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot: input.repositoryRoot,
      stateRoot: input.stateRoot,
      cacheRoot: input.cacheRoot,
      requiredDirectories: [input.sessionRoot]
    }),
    use: operation,
    release: (authority) => authority.release()
  });
}

interface TrustedRuntimeActionBundle {
  readonly schema: typeof TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA;
  readonly sessionRevision: Digest;
  readonly actionPlanDigest: Digest;
  readonly artifact: VerificationSessionArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  readonly containerReceipt: TrustedRuntimeContainerReceipt;
  readonly bundleDigest: Digest;
}

/** Borrowed data and owner operations for the application use case. The
 * enclosing retained state/lease scope remains owned here until return. */
export interface TrustedRuntimeSourceTransitionContext {
  readonly repositoryRoot: string;
  readonly envelope: Parameters<typeof executeTrustedRuntimeContainerVerification>[0]['envelope'];
  readonly sourceProgramTransition: NonNullable<Parameters<typeof executeTrustedRuntimeContainerVerification>[0]['sourceProgramTransition']>;
  readonly actorNodeId: string;
  readonly requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
  readonly previousVerification: Readonly<{
    evidence: TrustedRuntimeActionBundle['artifact']['evidence'];
    receipt: TrustedRuntimeContainerReceipt;
  }> | null;
  observeAuthorApproval(): Promise<SourceProgramTestAuthorApproval | undefined>;
  assertCurrentSubject(): Promise<void>;
  publishAttempt(evidence: ReturnType<typeof parseTrustedRuntimeSourceProgramAttemptEvidence>): void;
  publishVerification(result: Readonly<{
    evidence: TrustedRuntimeActionBundle['artifact']['evidence'];
    receipt: TrustedRuntimeContainerReceipt;
  }>): void;
  publishAdoption(qualification: SourceProgramTransitionQualification): void;
}

export type TrustedRuntimeSourceTransitionUseCaseResult =
  | Readonly<{ kind: 'accepted'; qualification: SourceProgramTransitionQualification;
      verification: Readonly<{ evidence: TrustedRuntimeActionBundle['artifact']['evidence']; receipt: TrustedRuntimeContainerReceipt }> }>
  | Readonly<{ kind: 'waiting'; value: unknown }>;

export type TrustedRuntimeSourceTransitionUseCase =
  (context: TrustedRuntimeSourceTransitionContext) => Promise<TrustedRuntimeSourceTransitionUseCaseResult>;

type TrustedRuntimeCloseoutPreMerge = Readonly<{
  kind: 'ready';
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
  actionBundle: TrustedRuntimeActionBundle;
  gateReadback: ReturnType<typeof CodexDevelopmentParseTrustedRuntimeMergeGateResult>;
  statusReadback: ReturnType<typeof parseIntegrationAuthorizationStatusPublication>;
  actionEvidenceReused: boolean;
  integrationPrincipal: Readonly<{ login: string; nodeId: string }>;
  title: string;
  message: string;
  manifestPath: string;
  manifestDigest: Digest;
  disposition: Awaited<ReturnType<typeof observeExactIssueDispositionPlan>>;
  /** Lexical owner callback; never serialized into a recovery record. */
  assertMainHealthCurrent(): Promise<void>;
  assertMainHealthQualification(): void;
}>;

type TrustedRuntimeCloseoutOpenResult =
  | TrustedRuntimeCloseoutPreMerge
  | Readonly<{ kind: 'verified'; value: unknown }>
  | Readonly<{ kind: 'waiting'; value: unknown }>;

function fail(message: string): never {
  throw new Error(`Trusted runtime closeout: ${message}`);
}

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be one SHA-256 digest`);
  }
  return value as Digest;
}

function canonicalBytes(value: unknown): Uint8Array {
  return Buffer.from(`${encodeVerificationActionData(value)}\n`, 'utf8');
}

type TrustedRuntimeOperatorArgs =
  | Readonly<{ mode: 'closeout'; repository: string; prNumber: number; testAuthorCommentId?: number }>
  | Readonly<{ mode: 'verification-only'; repository: string; request: VerificationSessionLocalPreparation; testAuthorCommentId?: number }>
  | Readonly<{ mode: 'runtime-canary'; repository: string; dependencies: boolean }>
  | Readonly<{ mode: 'main-health'; repository: string }>;

function parseArgs(argv: readonly string[]): TrustedRuntimeOperatorArgs {
  const { values, tokens } = parseNativeArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      'runtime-canary': { type: 'boolean' },
      'verification-only': { type: 'boolean' },
      request: { type: 'string' },
      'main-health': { type: 'boolean' },
      dependencies: { type: 'boolean' },
      pr: { type: 'string' },
      'test-author-comment': { type: 'string' },
      repository: { type: 'string' }
    }
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option' || token.inlineValue || seen.has(token.name)) {
      fail('arguments must be unique --key value pairs');
    }
    seen.add(token.name);
  }
  if (values.dependencies && !values['runtime-canary']) {
    fail('trusted runtime operator mode must appear exactly once');
  }
  if ([values['runtime-canary'], values['main-health'], values['verification-only']].filter(Boolean).length > 1) {
    fail('trusted runtime operator mode must appear exactly once');
  }
  const rawAuthorComment = values['test-author-comment'];
  if (rawAuthorComment !== undefined && (!/^[1-9][0-9]*$/u.test(rawAuthorComment)
      || !Number.isSafeInteger(Number(rawAuthorComment)) || values['runtime-canary'] || values['main-health'])) {
    fail('--test-author-comment requires one exact positive comment id in PR closeout mode');
  }
  const rawPr = values.pr;
  const repository = values.repository ?? 'sec-platform/sec';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) fail('--repository is invalid');
  if (values.request !== undefined && !values['verification-only']) {
    fail('--request requires --verification-only; it cannot select full closeout');
  }
  if (values['verification-only']) {
    if (rawPr !== undefined || values.request === undefined || values.dependencies) {
      fail('--verification-only requires --request and cannot be combined with --pr or --dependencies');
    }
    const request = parseVerificationSessionLocalPreparationRequest(readSessionArtifactText(values.request));
    return Object.freeze({ mode: 'verification-only', repository, request,
      ...(rawAuthorComment === undefined ? {} : { testAuthorCommentId: Number(rawAuthorComment) }) });
  }
  if (values['runtime-canary']) {
    if (rawPr !== undefined) fail('standalone trusted runtime mode cannot be combined with --pr');
    return Object.freeze({ mode: 'runtime-canary', repository, dependencies: values.dependencies === true });
  }
  if (values['main-health']) {
    if (rawPr !== undefined || values.dependencies) {
      fail('MainHealth mode cannot be combined with --pr or --dependencies');
    }
    return Object.freeze({ mode: 'main-health', repository });
  }
  if (rawPr === undefined || !/^[1-9][0-9]*$/u.test(rawPr)) fail('--pr must be positive');
  return Object.freeze({ mode: 'closeout', repository, prNumber: Number(rawPr),
    ...(rawAuthorComment === undefined ? {} : { testAuthorCommentId: Number(rawAuthorComment) }) });
}

async function assertTrustedBaseRuntime(
  repositoryRoot: string,
  candidate: GitHubCandidateObservation
): Promise<void> {
  const { branch, headSha: head, treeSha: tree, status, originUrl } =
    await observeTrustedRuntimeGitFence(repositoryRoot);
  assertOriginMatchesRepository(originUrl, candidate.repository);
  if (branch !== 'main' || head !== candidate.baseSha || tree !== candidate.baseTreeSha || status !== '') {
    fail('command must execute from the clean exact live-base main worktree');
  }
}

async function assertTrustedMergedRecoveryRuntime(
  repositoryRoot: string,
  candidate: GitHubCandidateObservation
): Promise<void> {
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
      || candidate.mergeCommitTreeSha === null) {
    fail('merged recovery requires one exact merged candidate identity');
  }
  const { branch, headSha: head, treeSha: tree, status, originUrl } =
    await observeTrustedRuntimeGitFence(repositoryRoot);
  assertOriginMatchesRepository(originUrl, candidate.repository);
  const retainedBase = head === candidate.baseSha && tree === candidate.baseTreeSha;
  const synchronizedMain = head === candidate.mergeCommitSha
    && tree === candidate.mergeCommitTreeSha;
  if (branch !== 'main' || status !== '' || (!retainedBase && !synchronizedMain)) {
    fail('merged recovery must execute from clean main at the retained base or exact merged main');
  }
}

function createActionBundle(input: Readonly<{
  artifact: VerificationSessionArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  containerReceipt: TrustedRuntimeContainerReceipt;
}>): TrustedRuntimeActionBundle {
  const artifact = CodexDevelopmentParseVerificationSessionArtifact(
    encodeVerificationActionData(input.artifact)
  );
  const receipt = parseTrustedRuntimeContainerReceipt(input.containerReceipt);
  if (artifact.session.sessionRevision !== receipt.sessionRevision
      || artifact.session.baseSha !== receipt.baseSha
      || artifact.session.headSha !== receipt.headSha
      || artifact.session.headTreeSha !== receipt.headTreeSha
      || artifact.evidence.evidenceDigest !== receipt.evidenceDigest
      || artifact.producer.sourceDigest !== receipt.producerSourceDigest) {
    fail('Action bundle artifact and container receipt differ');
  }
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA,
    sessionRevision: artifact.session.sessionRevision as Digest,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest as Digest,
    artifact,
    containerReceipt: receipt
  });
  return Object.freeze({ ...withoutDigest, bundleDigest: hash(withoutDigest) });
}

function parseActionBundle(source: Uint8Array): TrustedRuntimeActionBundle {
  const text = Buffer.from(source).toString('utf8');
  const value = JSON.parse(text) as Record<string, unknown>;
  const expected = [
    'schema', 'sessionRevision', 'actionPlanDigest', 'artifact', 'containerReceipt', 'bundleDigest'
  ].sort();
  if (Object.keys(value).sort().join(',') !== expected.join(',')
      || value.schema !== TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA) {
    fail('Action bundle shape is invalid');
  }
  const rebuilt = createActionBundle({
    artifact: CodexDevelopmentParseVerificationSessionArtifact(
      encodeVerificationActionData(value.artifact)
    ),
    containerReceipt: parseTrustedRuntimeContainerReceipt(value.containerReceipt)
  });
  if (value.sessionRevision !== rebuilt.sessionRevision
      || value.actionPlanDigest !== rebuilt.actionPlanDigest
      || value.bundleDigest !== rebuilt.bundleDigest
      || text !== `${encodeVerificationActionData(rebuilt)}\n`) {
    fail('Action bundle digest or canonical bytes mismatch');
  }
  return rebuilt;
}

/** Durable computation evidence only; this record cannot be consumed as a Session artifact. */
interface PendingTrustedRuntimeEvidence {
  readonly schema: 'sec-trusted-runtime-pending-qualification-v1';
  readonly evidence: TrustedRuntimeActionBundle['artifact']['evidence'];
  readonly receipt: TrustedRuntimeContainerReceipt;
  readonly pendingDigest: Digest;
}

function createPendingTrustedRuntimeEvidence(input: Readonly<{
  evidence: TrustedRuntimeActionBundle['artifact']['evidence'];
  receipt: TrustedRuntimeContainerReceipt;
}>): PendingTrustedRuntimeEvidence {
  CodexDevelopmentAssertVerificationEvidenceV4(input.evidence);
  const receipt = parseTrustedRuntimeContainerReceipt(input.receipt);
  const bytes = `${encodeVerificationActionData(input.evidence)}\n`;
  if (receipt.evidenceDigest !== input.evidence.evidenceDigest
      || receipt.baseSha !== input.evidence.baseSha
      || receipt.headSha !== input.evidence.headSha
      || receipt.headTreeSha !== input.evidence.headTreeSha
      || receipt.sessionRevision !== input.evidence.sessionRevision
      || receipt.producerSourceDigest !== input.evidence.producer.sourceDigest
      || receipt.evidenceByteLength !== Buffer.byteLength(bytes, 'utf8')
      || receipt.evidenceByteDigest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) {
    fail('pending qualification evidence differs from the exact container receipt');
  }
  const canonical = Object.freeze({ schema: 'sec-trusted-runtime-pending-qualification-v1' as const,
    evidence: input.evidence, receipt });
  return Object.freeze({ ...canonical, pendingDigest: hash(canonical) });
}

function parsePendingTrustedRuntimeEvidence(bytes: Uint8Array): PendingTrustedRuntimeEvidence {
  const source = Buffer.from(bytes).toString('utf8');
  const value = JSON.parse(source) as PendingTrustedRuntimeEvidence;
  if (value === null || typeof value !== 'object'
      || Object.keys(value).sort().join(',') !== 'evidence,pendingDigest,receipt,schema') {
    fail('pending qualification shape is invalid');
  }
  const rebuilt = createPendingTrustedRuntimeEvidence(value);
  if (value.schema !== rebuilt.schema || value.pendingDigest !== rebuilt.pendingDigest
      || source !== `${encodeVerificationActionData(rebuilt)}\n`) {
    fail('pending qualification bytes are not canonical');
  }
  return rebuilt;
}

function publishCanonical<T>(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  value: T;
  parse: (source: Uint8Array) => T;
}>): T {
  const bytes = canonicalBytes(input.value);
  publishExclusiveDurableCanonicalFile({
    parent: input.parent,
    name: input.name,
    bytes,
    validate: (candidate) => {
      const parsed = input.parse(candidate);
      if (encodeVerificationActionData(parsed) !== encodeVerificationActionData(input.value)) {
        fail(`durable ${input.name} semantic readback mismatch`);
      }
    }
  });
  const readback = readNoFollowOrdinaryFile(input.parent, input.name);
  if (readback === null) fail(`durable ${input.name} disappeared`);
  return input.parse(readback);
}

function readCanonical<T>(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  parse: (source: Uint8Array) => T;
}>): T {
  const bytes = readNoFollowOrdinaryFile(input.parent, input.name);
  if (bytes === null) fail(`durable ${input.name} is unavailable`);
  const value = input.parse(bytes);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes(value)))) {
    fail(`durable ${input.name} bytes are not canonical`);
  }
  return value;
}

async function observeTrustedRuntimeGitFence(repositoryRoot: string) {
  return withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    // A retained GitRead session is single-flight. The whole fence settles
    // before its observations can enter publication or hosted admission.
    // Initial and final fences each own one bounded observation; no read
    // session stays retained across container verification or publication.
    const branch = (await gitReadText(session, ['branch', '--show-current'])).trim();
    const headSha = (await gitReadText(session, ['rev-parse', 'HEAD'])).trim();
    const treeSha = (await gitReadText(session, ['rev-parse', 'HEAD^{tree}'])).trim();
    const status = await gitReadText(session, ['status', '--porcelain=v1', '--untracked-files=all']);
    const originUrl = (await gitReadText(session, ['remote', 'get-url', 'origin'])).trim();
    return Object.freeze({ branch, headSha, treeSha, status, originUrl });
  });
}

function assertOriginMatchesRepository(originUrl: string, repository: string): void {
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(
    `^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${escapedRepository}(?:\\.git)?$`,
    'u'
  ).test(originUrl)) {
    fail('origin remote does not match the requested GitHub repository');
  }
}

export async function runCurrentTrustedRuntimeWorkspaceCanary(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  dependencies?: boolean;
}>): Promise<Awaited<ReturnType<typeof executeTrustedRuntimeWorkspaceCanary>>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const { branch, headSha, treeSha: headTreeSha, status, originUrl } =
    await observeTrustedRuntimeGitFence(repositoryRoot);
  assertOriginMatchesRepository(originUrl, input.repository);
  if (branch === '' || status !== '' || !/^[0-9a-f]{40}$/u.test(headSha)
      || !/^[0-9a-f]{40}$/u.test(headTreeSha)) {
    fail('runtime workspace canary requires one clean attached exact Git head');
  }
  return await executeTrustedRuntimeWorkspaceCanary({
    repositoryRoot,
    repository: input.repository,
    headSha,
    headTreeSha,
    dependencies: input.dependencies === true
  });
}

async function assertCurrentTrustedRuntimeMainHealthSubject(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  expectedHeadSha: string;
  expectedTreeSha: string;
  expectedOriginUrl: string;
}>): Promise<void> {
  const fence = await observeTrustedRuntimeGitFence(input.repositoryRoot);
  const liveMain = await observeMainHealthGitHubDefaultBranchSha({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    defaultBranch: 'main'
  });
  if (fence.branch !== 'main' || fence.status !== ''
      || fence.headSha !== input.expectedHeadSha
      || fence.treeSha !== input.expectedTreeSha
      || fence.originUrl !== input.expectedOriginUrl
      || liveMain !== input.expectedHeadSha) {
    fail('MainHealth exact-main subject drifted during current readback');
  }
}

async function withCurrentTrustedRuntimeMainHealth<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>, operation: (receipt: TrustedRuntimeMainHealthReceipt) => Promise<T>): Promise<T> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const firstFence = await observeTrustedRuntimeGitFence(repositoryRoot);
  assertOriginMatchesRepository(firstFence.originUrl, input.repository);
  if (firstFence.branch !== 'main' || firstFence.status !== ''
      || !/^[0-9a-f]{40}$/u.test(firstFence.headSha)
      || !/^[0-9a-f]{40}$/u.test(firstFence.treeSha)) {
    fail('MainHealth producer requires one clean attached exact main');
  }
  const liveMainBefore = await observeMainHealthGitHubDefaultBranchSha({
    repositoryRoot,
    repository: input.repository,
    defaultBranch: 'main'
  });
  if (liveMainBefore !== firstFence.headSha) {
    fail('MainHealth producer local main differs from the live default branch');
  }

  return await withProducedTrustedRuntimeMainHealth({
    repositoryRoot,
    repository: input.repository,
    mainSha: firstFence.headSha,
    mainTreeSha: firstFence.treeSha,
    assertSubjectCurrent: () => assertCurrentTrustedRuntimeMainHealthSubject({
      repositoryRoot, repository: input.repository,
      expectedHeadSha: firstFence.headSha, expectedTreeSha: firstFence.treeSha,
      expectedOriginUrl: firstFence.originUrl
    })
  }, operation);
}

/** Internal lexical composition only: callers supply their actual owner
 * fences. This helper never accepts a serialized proof or issues authority from
 * an assertion callback; only the physical producer can mint the live receipt. */
async function withProducedTrustedRuntimeMainHealth<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
  assertSubjectCurrent(): Promise<void>;
}>, operation: (receipt: TrustedRuntimeMainHealthReceipt) => Promise<T>): Promise<T> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot
  });
  // Preserve the original generation coordination and any unknown recovery
  // residue. Receipts themselves live only in their producer-owned scope.
  const generationDirectory = path.join(runtimeLayout.repositoryStateRoot, 'trusted-main-health', 'v2');
  return await withTrustedRuntimeStateAuthority({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    sessionRoot: generationDirectory
  }, async (authority) => {
    const stateDirectory = authority.directory(generationDirectory);
    const generationLease = acquirePhysicalMutationLease(
      stateDirectory, `main-health-${input.mainSha}.lock`
    );
    if (generationLease === null) {
      fail('MainHealth receipt generation is already active or its owner liveness is unknown');
    }
    let generationSettled = false;
    let primary: ResourceSettlementFailure | undefined;
    try {
      // Historical JSON cannot recover production qualification. The original
      // runtime owner performs a fresh isolated attempt and owns live reuse.
      return await withTrustedRuntimeMainHealthQualification({
        repositoryRoot,
        repository: input.repository,
        mainSha: input.mainSha,
        mainTreeSha: input.mainTreeSha,
        signal: input.signal,
        ...(input.deadlineAtUnixMs === undefined ? {} : { deadlineAtUnixMs: input.deadlineAtUnixMs })
      }, async (receipt) => {
        await input.assertSubjectCurrent();
        if (generationLease.recoveryPending) generationLease.acknowledgeReclaimedRecovery();
        generationLease.release();
        generationSettled = true;
        return await operation(receipt);
      });
    } catch (error) {
      primary = { label: 'MainHealth execution', error };
      throw error;
    } finally {
      settleResources({ primary, cleanup: [{ label: 'MainHealth generation lease', settle: () => {
        if (!generationSettled) {
          if (generationLease.recoveryPending) generationLease.restoreReclaimedOwner();
          else generationLease.release();
        }
      } }] });
    }
  });
}

/** The trusted driver stays at its admitted revision. Only the exact new
 * main is materialized inside the original isolated MainHealth workspace. */
export async function withAuthenticatedPostMergeMainHealth<T>(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  plan: TrustedRuntimePostMergeMainHealthPlan;
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
}>, operation: (health: Readonly<{
  ledger: MainHealthLedger;
  admission: TrustedRuntimeMainHealthPublicationAdmission;
  observedAt: string;
  assertCurrent(): Promise<void>;
}>) => Promise<T>): Promise<T> {
  input = Object.freeze({ origin: input.origin,
    plan: input.plan, repositoryRoot: input.repositoryRoot, repository: input.repository,
    mainSha: input.mainSha, mainTreeSha: input.mainTreeSha });
  const assertSubjectCurrent = async (): Promise<void> => {
    const origin = await assertTrustedRuntimePostMergeMainHealthPlanCurrent(input);
    if (origin.repository !== input.repository || origin.trustedDriverRoot !== input.repositoryRoot) {
      fail('post-merge MainHealth authenticated origin belongs to another operation');
    }
    const liveMain = await observeMainHealthGitHubDefaultBranchSha({ ...input, defaultBranch: 'main' });
    if (liveMain !== input.mainSha) fail('post-merge MainHealth exact default advanced');
  };
  await assertSubjectCurrent();
  const origin = await assertTrustedRuntimePostMergeMainHealthPlanCurrent(input);
  return await withProducedTrustedRuntimeMainHealth({ ...input,
    deadlineAtUnixMs: origin.deadlineAtUnixMs,
    signal: getAuthenticatedGitHubJobOriginSignal(input.origin),
    assertSubjectCurrent
  }, async (receipt) => {
    const selected = await observeCanonicalMainHealthForPublication({ ...input,
      defaultBranch: 'main', qualifiedLocalReceipt: receipt });
    if (selected.projection.state !== 'healthy' || selected.ledger === null) {
      fail('post-merge MainHealth canonical selection is not qualified and healthy');
    }
    const admission = Object.freeze({ authority: selected.authority, receipt,
      repositoryRoot: input.repositoryRoot });
    const assertCurrent = async (): Promise<void> => {
      await assertSubjectCurrent();
      const current = await observeCanonicalMainHealthForPublication({ ...input,
        defaultBranch: 'main', qualifiedLocalReceipt: receipt });
      if (current.projection.state !== 'healthy' || current.ledger === null) {
        fail('post-merge MainHealth provider evidence became invalid or conflicting');
      }
      assertMainHealthPublicationAuthorityStable(selected.authority, current.authority);
      assertTrustedRuntimeMainHealthPublication({ admission, ledger: selected.ledger!,
        repository: input.repository, mainSha: input.mainSha, mainTreeSha: input.mainTreeSha,
        now: new Date(Date.now()).toISOString() });
    };
    await assertCurrent();
    return await operation(Object.freeze({ ledger: selected.ledger, admission,
      observedAt: selected.observedAt, assertCurrent }));
  });
}

export async function runCurrentTrustedRuntimeMainHealth(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): Promise<Readonly<{
  reused: false;
  receipt: TrustedRuntimeMainHealthReceipt;
  authority: 'historical-evidence-only';
}>> {
  return await withCurrentTrustedRuntimeMainHealth(input, async (receipt) => Object.freeze({
    reused: false as const, receipt, authority: 'historical-evidence-only' as const
  }));
}

async function mergeExactHead(input: Readonly<{
  repository: string;
  prNumber: number;
  headSha: string;
  title: string;
  message: string;
  capability: GitHubApiCapability;
}>): Promise<ReturnType<typeof parseHostedSynchronousSquashMergeResponse>> {
  const response = await executeGitHubApiOperation(input.capability, {
    kind: 'merge-pull',
    pullRequestNumber: input.prNumber,
    headSha: input.headSha,
    title: input.title,
    message: input.message
  });
  return parseHostedSynchronousSquashMergeResponse(JSON.stringify(response));
}

async function finalizeMergedTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
  actionBundle: TrustedRuntimeActionBundle;
  gateReadback: ReturnType<typeof CodexDevelopmentParseTrustedRuntimeMergeGateResult>;
  statusReadback: ReturnType<typeof parseIntegrationAuthorizationStatusPublication>;
  providerMergeCommitSha: string | null;
  actionEvidenceReused: boolean;
}>): Promise<unknown> {
  const { candidate, actionBundle, gateReadback, statusReadback } = input;
  const artifact = actionBundle.artifact;
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
      || candidate.mergeCommitTreeSha === null || candidate.mergeCommitMessage === null) {
    fail('post-merge finalization requires one exact merged candidate');
  }
  if (candidate.repository !== input.repository || candidate.number !== input.prNumber
      || artifact.session.repository !== input.repository
      || artifact.session.prNumber !== input.prNumber
      || artifact.session.baseSha !== candidate.baseSha
      || artifact.session.baseTreeSha !== candidate.baseTreeSha
      || artifact.session.headSha !== candidate.headSha
      || artifact.session.headTreeSha !== candidate.headTreeSha
      || actionBundle.sessionRevision !== artifact.session.sessionRevision) {
    fail('merged candidate differs from its durable trusted-runtime Session');
  }
  const manifestSource = (await input.github.readBlobText(
    input.repository,
    candidate.headSha,
    artifact.session.manifestPath
  ));
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource)
      !== artifact.session.manifestDigest) {
    fail('merged candidate Work Package bytes differ from the durable Session');
  }
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    manifestSource,
    artifact.session.manifestPath
  );
  const disposition = (await observeExactIssueDispositionPlan({
    github: input.github,
    repository: input.repository,
    candidate,
    manifestPath: artifact.session.manifestPath,
    manifestDigest: artifact.session.manifestDigest,
    tracking: manifest.tracking
  }));
  const authorizationMarkers = integrationAuthorizationStatusMergeMarkers({
    result: gateReadback,
    publication: statusReadback
  });
  const issueMarkers = [
    `Issue-Disposition-Plan: ${disposition.planDigest}`,
    `Issue-Disposition-Mode: ${disposition.mode}`,
    `Issue-Disposition-Tracking: ${disposition.trackingIssueNumber ?? 'none'}`,
    `Issue-Disposition-Prose: ${disposition.titleBodyDigest}`
  ];
  const mergeMarkers = [...authorizationMarkers, ...issueMarkers];
  const title = `Verified integration ${artifact.session.sessionRevision.slice(7, 19)}`;
  assertHostedSquashMergeCompletion({
    candidate,
    expectedBaseSha: artifact.session.baseSha,
    expectedHeadSha: artifact.session.headSha,
    expectedHeadTreeSha: artifact.session.headTreeSha,
    markers: mergeMarkers,
    reviewReceipt: gateReadback.reviewReceipt,
    expectedTitle: title,
    providerMergeCommitSha: input.providerMergeCommitSha
  });
  const issueReconciliation = observePostMergeIssueReconciliation({
    repository: input.repository,
    prNumber: input.prNumber,
    candidate
  });
  if (issueReconciliation.status !== 'no-op') {
    fail(`external-maintainer-action-required: post-merge IssueDisposition is ${String(
      issueReconciliation.status
    )}`);
  }

  const remoteMain = await observeMainHealthGitHubDefaultBranchSha({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    defaultBranch: 'main'
  });
  if (remoteMain !== candidate.mergeCommitSha) {
    fail('remote main does not equal the physical merge commit');
  }
  if (candidate.mergeCommitTreeSha !== candidate.headTreeSha) {
    fail('remote main tree does not equal the verified candidate tree');
  }
  return Object.freeze({
    status: 'MERGED',
    provider: 'sec-trusted-runtime',
    sessionRevision: artifact.session.sessionRevision,
    actionEvidenceReused: input.actionEvidenceReused,
    gateResultDigest: gateReadback.resultDigest,
    statusPublicationDigest: statusReadback.publicationDigest,
    mergeCommitSha: candidate.mergeCommitSha,
    mergeCommitTreeSha: candidate.mergeCommitTreeSha,
    platformEnforcement: gateReadback.platformObservation.status,
    claimsNoBypassEnforcement: false
  });
}

async function recoverMergedTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
}>): Promise<unknown> {
  await assertTrustedMergedRecoveryRuntime(input.repositoryRoot, input.candidate);
  if (input.candidate.mergeCommitMessage === null) {
    fail('merged recovery has no merge message locator');
  }
  const sessionRevision = digest(
    readExactCommitMarker(input.candidate.mergeCommitMessage, 'Verification-Session'),
    'merged recovery session revision'
  );
  const gateResultDigest = digest(
    readExactCommitMarker(input.candidate.mergeCommitMessage, 'Merge-Gate-Result'),
    'merged recovery Gate result digest'
  );
  const statusPublicationDigest = digest(
    readExactCommitMarker(
      input.candidate.mergeCommitMessage,
      'Integration-Authorization-Status-Publication'
    ),
    'merged recovery status publication digest'
  );
  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot: input.repositoryRoot
  });
  const sessionRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-runtime',
    'v1',
    sessionRevision.slice(7)
  );
  return withTrustedRuntimeStateAuthority({
    repositoryRoot: input.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    sessionRoot
  }, async (authority) => {
    const stateDirectory = authority.directory(sessionRoot);
    const actionBundle = readCanonical({
      parent: stateDirectory,
      name: 'verification-action.json',
      parse: parseActionBundle
    });
    const gateReadback = readCanonical({
      parent: stateDirectory,
      name: `merge-gate-${gateResultDigest.slice(7)}.json`,
      parse: (bytes) => CodexDevelopmentParseTrustedRuntimeMergeGateResult(
        Buffer.from(bytes).toString('utf8')
      )
    });
    const statusReadback = readCanonical({
      parent: stateDirectory,
      name: `status-${statusPublicationDigest.slice(7)}.json`,
      parse: (bytes) => parseIntegrationAuthorizationStatusPublication(
        Buffer.from(bytes).toString('utf8')
      )
    });
    if (actionBundle.sessionRevision !== sessionRevision
        || gateReadback.resultDigest !== gateResultDigest
        || statusReadback.publicationDigest !== statusPublicationDigest) {
      fail('merged recovery locators differ from the durable canonical artifacts');
    }
    return (await finalizeMergedTrustedRuntime({
      ...input,
      actionBundle,
      gateReadback,
      statusReadback,
      providerMergeCommitSha: null,
      actionEvidenceReused: true
    }));
  });
}

export async function closeoutWithTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  testAuthorCommentId?: number;
}>, sourceTransitionUseCase?: TrustedRuntimeSourceTransitionUseCase): Promise<unknown> {
  return executeTrustedRuntimeCandidateStage(input, { kind: 'closeout' }, sourceTransitionUseCase);
}

/** Execute the original source/verification owners, stopping before integration. */
export async function verifyWithTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  request: VerificationSessionLocalPreparation;
  testAuthorCommentId?: number;
}>, sourceTransitionUseCase?: TrustedRuntimeSourceTransitionUseCase): Promise<unknown> {
  const request = parseVerificationSessionLocalPreparationRequest(JSON.stringify(input.request));
  if (request.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA
      && request.request.repository !== input.repository) {
    fail('V2 preparation belongs to another repository');
  }
  return executeTrustedRuntimeCandidateStage({ ...input, prNumber: request.request.prNumber },
    { kind: 'verification-only', request }, sourceTransitionUseCase);
}

type TrustedRuntimeCandidateStage =
  | Readonly<{ kind: 'closeout' }>
  | Readonly<{ kind: 'verification-only'; request: VerificationSessionLocalPreparation }>;

async function executeTrustedRuntimeCandidateStage(
  input: TrustedRuntimeCandidatePreparationInput,
  stage: TrustedRuntimeCandidateStage,
  sourceTransitionUseCase?: TrustedRuntimeSourceTransitionUseCase
): Promise<unknown> {
  if (sourceTransitionUseCase === undefined) {
    fail('cold-source use case must be assembled by the canonical bootstrap entry');
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const github = createVerificationSessionGitHubClient(repositoryRoot, input.repository);
  const candidate = (await github.observeCandidate(input.repository, input.prNumber));
  if (stage.kind === 'verification-only') {
    const expected = stage.request.request;
    if (candidate.state !== 'OPEN' || candidate.baseSha !== expected.expectedBaseSha
        || candidate.baseTreeSha !== expected.expectedBaseTreeSha
        || candidate.headSha !== expected.expectedHeadSha
        || candidate.headTreeSha !== expected.expectedHeadTreeSha) {
      fail('local verification requires the exact saved open candidate; it cannot recover merged integration');
    }
  }
  if (candidate.state !== 'MERGED'
      && (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository)) {
    fail('candidate must be one open same-repository non-draft PR or its exact merged recovery');
  }
  const latePreparation = stage.kind === 'verification-only'
    && stage.request.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA
      ? stage.request : undefined;
  if (latePreparation !== undefined) {
    const facts = await observeOpenCandidatePreparationFacts({ input, repositoryRoot, github, candidate });
    assertVerificationSessionLocalPreparationV2Current(latePreparation,
      prepareLocalVerificationIntent(facts.preparationInput));
    // Unresolved accepted content is a real missing input, not a substitute
    // environment or a speculative Session. No execution state is created here.
    if (latePreparation.request.qualificationRequirements.nativeContentManifestDigest === null) {
      return Object.freeze({ status: 'LOCAL_QUALIFICATION_UNAVAILABLE' as const,
        stage: 'qualification-not-started' as const, execution: 'local' as const,
        reason: 'native-runtime-content-not-accepted' as const,
        requestOperationId: latePreparation.request.requestOperationId,
        executionStarted: false as const, integrationAuthorization: 'not-issued' as const });
    }
  }
  // Serialize exact PR/base/head attempts across assessment, host adoption,
  // artifact publication and the final effect/readback. A computation result
  // from an interrupted predecessor never resumes as live authority.
  const layout = resolveSecRuntimeStateForRepository({ repository: input.repository, repositoryRoot });
  const leaseRoot = path.join(layout.repositoryStateRoot, 'trusted-runtime', 'closeout-leases');
  return await withTrustedRuntimeStateAuthority({ repositoryRoot, stateRoot: layout.stateRoot,
    cacheRoot: layout.cacheRoot, sessionRoot: leaseRoot }, async (authority) => {
    const lease = acquirePhysicalMutationLease(authority.directory(leaseRoot),
      `pr-${input.prNumber}-${candidate.headSha}.lock`);
    if (lease === null) fail('this exact PR transition already has an active closeout attempt or unknown owner liveness');
    let primary: ResourceSettlementFailure | undefined;
    try {
      const current = await github.observeCandidate(input.repository, input.prNumber);
      if (current.headSha !== candidate.headSha || current.headTreeSha !== candidate.headTreeSha) {
        fail('PR candidate drifted before serialized closeout admission');
      }
      if (current.state === 'MERGED') {
        if (stage.kind !== 'closeout') fail('local verification cannot enter merged closeout recovery');
        const settled = await recoverMergedTrustedRuntime({ repositoryRoot, repository: input.repository,
          prNumber: input.prNumber, github, candidate: current });
        if (lease.recoveryPending) lease.acknowledgeReclaimedRecovery();
        return settled;
      }
      if (current.state !== 'OPEN' || current.baseSha !== candidate.baseSha || current.headSha !== candidate.headSha
          || current.baseTreeSha !== candidate.baseTreeSha || current.headTreeSha !== candidate.headTreeSha) {
        fail('PR transition drifted before serialized closeout admission');
      }
      let mergedReadback: TrustedRuntimeCloseoutMergedReadback | undefined;
      const executePrepared = async (qualifiedLocalReceipt?: TrustedRuntimeMainHealthReceipt) => {
        const preMerge = await closeoutOpenCandidateWithTrustedRuntime({
          input, repositoryRoot, github, candidate: current, sourceTransitionUseCase, stage,
          ...(qualifiedLocalReceipt === undefined ? {} : { qualifiedLocalReceipt })
        });
        // Recovery records never revive MainHealth qualification. The original
        // producer scope stays live through the actual merge effect/readback.
        if (lease.recoveryPending) lease.acknowledgeReclaimedRecovery();
        if (preMerge.kind !== 'ready') return Object.freeze({ kind: 'without-merge' as const, value: preMerge.value });
        mergedReadback = await executeTrustedRuntimeCloseoutMergeEffect(preMerge);
        return Object.freeze({ kind: 'merged' as const, value: mergedReadback });
      };
      // Only an explicit execution entry may obtain qualification. V2 runs the
      // same original producer in this operation; public prepare never does.
      // Legacy V1 retains its original already-observed healthy provider path.
      let execution: Awaited<ReturnType<typeof executePrepared>>;
      try {
        execution = stage.kind === 'closeout' || latePreparation !== undefined
          ? await withCurrentTrustedRuntimeMainHealth({ repositoryRoot,
              repository: input.repository }, executePrepared)
          : await executePrepared();
      } catch (error) {
        if (mergedReadback !== undefined) {
          throw new AggregateError([error],
            `MERGED readback ${mergedReadback.candidate.mergeCommitSha} was observed; `
            + 'MainHealth scope settlement failed after that effect. Resume original merged recovery; do not repeat the merge.');
        }
        throw error;
      }
      // The old-main proof is now revoked. New-main health and closeout belong
      // to the original post-merge owner and must not borrow the old proof.
      return execution.kind === 'without-merge' ? execution.value
        : await finalizeMergedTrustedRuntime(execution.value);
    } catch (error) {
      primary = { label: 'trusted runtime closeout', error };
      throw error;
    } finally {
      await settleResourcesAsync({ primary, cleanup: [
        { label: 'closeout authority readback', settle: async () => { await authority.assertCurrent(); } },
        { label: 'closeout mutation lease', settle: () => {
          if (lease.recoveryPending) lease.restoreReclaimedOwner();
          else lease.release();
        } }
      ] });
    }
  });
}

type TrustedRuntimeCandidatePreparationInput = Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  testAuthorCommentId?: number;
}>;

/** Preparation observes and binds inputs; it does not execute candidate code or
 * produce verification evidence, publish status, or merge. Full closeout uses
 * this same preparation under its original effect lease and budget. */
async function observeOpenCandidatePreparationFacts(args: Readonly<{
  input: TrustedRuntimeCandidatePreparationInput;
  repositoryRoot: string;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
}>) {
  const { input, repositoryRoot, github } = args;
  // Source SHA equality does not freeze mutable PR metadata such as the Work
  // Package locator. Every factual observation consumes its own fresh body.
  const candidate = await github.observeCandidate(input.repository, input.prNumber);
  if (candidate.repository !== input.repository || candidate.number !== input.prNumber
      || candidate.baseSha !== args.candidate.baseSha || candidate.baseTreeSha !== args.candidate.baseTreeSha
      || candidate.headSha !== args.candidate.headSha || candidate.headTreeSha !== args.candidate.headTreeSha
      || candidate.baseBranch !== args.candidate.baseBranch) {
    fail('exact PR subject changed during local preparation observation');
  }
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
    fail('candidate changed before trusted-runtime verification preparation');
  }
  await assertTrustedBaseRuntime(repositoryRoot, candidate);
  const observeAuthorApproval = async (): Promise<SourceProgramTestAuthorApproval | undefined> => {
    if (input.testAuthorCommentId === undefined) return undefined;
    return await withGitHubApiReadSession({ repositoryRoot, repository: input.repository,
      operation: async (capability) => adoptSourceProgramTestAuthorDecision(
        await observeGitHubRepositoryComment({ capability, issueNumber: input.prNumber,
          commentId: input.testAuthorCommentId! })) });
  };
  const authorApproval = await observeAuthorApproval();
  if (authorApproval !== undefined && (authorApproval.providerOrigin !== 'production'
      || authorApproval.payload.trustedRevision !== candidate.baseSha
      || authorApproval.payload.baseline.commitSha !== candidate.baseSha
      || authorApproval.payload.baseline.treeSha !== candidate.baseTreeSha
      || authorApproval.payload.current.commitSha !== candidate.headSha
      || authorApproval.payload.current.treeSha !== candidate.headTreeSha)) {
    fail('external author decision does not bind the exact live PR base and candidate');
  }
  const sourceProgramTransition = parseCiSourceProgramTransitionBinding({
    baseSha: candidate.baseSha, headSha: candidate.headSha,
    payloadDigest: authorApproval?.payload.payloadDigest ?? null,
    approvalObservationDigest: authorApproval?.providerObservationDigest ?? null,
    approvalDigest: authorApproval?.approvalDigest ?? null
  });
  const comparison = (await github.observeComparison(input.repository, candidate.baseSha, candidate.headSha));
  const openCount = (await github.observeOpenPullRequestCountForHead(input.repository, candidate.headSha));
  if (comparison.status !== 'ahead' || comparison.behindBy !== 0 || openCount !== 1) {
    fail('candidate ancestry or same-head PR identity is not exact');
  }
  const manifestPath = CodexDevelopmentParseWorkPackageLocator(candidate.body);
  const manifestSource = (await github.readBlobText(input.repository, candidate.headSha, manifestPath));
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestSource) as Digest;
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource, manifestPath);
  const changed = await observeVerificationSessionChangedSelection({ repositoryRoot,
    repository: input.repository, prNumber: input.prNumber, candidate, github });
  CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changed.changedPaths]);
  const dependencyBlobs = (await observeVerificationSessionActionDependencyBlobs({ github,
    repository: input.repository, baseSha: candidate.baseSha, headSha: candidate.headSha }));
  const principal = (await github.observeViewerPrincipal(input.repository));
  if (principal.permission !== 'admin' && principal.permission !== 'maintain') {
    fail('current principal lacks maintain/admin permission');
  }
  const integrationPermission: 'admin' | 'maintain' = principal.permission;
  const reviewBarrier = (await github.observeReviewBarrier({ repository: input.repository,
    prNumber: input.prNumber, headSha: candidate.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) }));
  const observedAt = new Date().toISOString();
  const runtimeRef = `${CodexDevelopmentMergeGateProducerIdentity}@${candidate.baseSha}`;
  const preparationInput = {
    repository: input.repository, candidate, manifestPath, manifestDigest,
    changedPaths: changed.changedPaths, testImpactTransition: changed.testImpactTransition,
    testImpactSourceProvider: changed.testImpactSourceProvider,
    profile: manifest.requiredProfile, integrationPrincipalNodeId: principal.nodeId,
    producerPrincipalNodeId: principal.nodeId,
    sourceRunId: `trusted-runtime-${candidate.headSha.slice(0, 16)}`,
    sourceRef: runtimeRef, observedAt, reviewBarrier, dependencyBlobs, sourceProgramTransition
  } as const;
  return Object.freeze({ candidate, preparationInput, principal, integrationPermission,
    observedAt, runtimeRef, sourceProgramTransition, dependencyBlobs, reviewBarrier,
    observeAuthorApproval, authorApproval, manifestPath, manifestDigest, manifest, changed });
}

/** Qualification-dependent internal preparation. Public prepare uses only the
 * factual reader above and never enters the MainHealth physical producer. */
async function prepareOpenCandidateWithTrustedRuntime(args: Readonly<{
  input: TrustedRuntimeCandidatePreparationInput;
  repositoryRoot: string;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
  qualifiedLocalReceipt?: TrustedRuntimeMainHealthReceipt;
  latePreparation?: VerificationSessionLocalPreparationRequestV2;
}>) {
  const { input, repositoryRoot, github } = args;
  const facts = await observeOpenCandidatePreparationFacts({ input, repositoryRoot, github, candidate: args.candidate });
  const { candidate, principal, integrationPermission, observedAt, runtimeRef,
    sourceProgramTransition, dependencyBlobs, reviewBarrier, observeAuthorApproval,
    authorApproval, manifestPath, manifestDigest, manifest, changed } = facts;
  if (args.latePreparation !== undefined) {
    if (args.qualifiedLocalReceipt === undefined) fail('V2 Session binding requires the original live MainHealth producer');
    assertVerificationSessionLocalPreparationV2Current(args.latePreparation,
      prepareLocalVerificationIntent(facts.preparationInput));
  }
  const mainHealthObservation = await withMainHealthGitHubReadOperationBudget({
    repositoryRoot, repository: input.repository,
    operation: async () => await observeCanonicalMainHealthForPublication({
      repositoryRoot, repository: input.repository,
      defaultBranch: candidate.baseBranch, mainSha: candidate.baseSha,
      mainTreeSha: candidate.baseTreeSha,
      ...(args.qualifiedLocalReceipt === undefined ? {} : {
        qualifiedLocalReceipt: args.qualifiedLocalReceipt
      })
    })
  });
  if (mainHealthObservation.ledger === null
      || mainHealthObservation.projection.state !== 'healthy'
      || mainHealthObservation.repairDecision.routingState !== 'ordinary-only') {
    fail(
      `canonical MainHealth is not healthy and ordinary-only at verification preparation: `
      + `${mainHealthObservation.repairDecision.reasonCode}`
    );
  }
  const mainHealthInput = mainHealthObservation.ledger;
  const localMainHealthAdmission = args.qualifiedLocalReceipt === undefined ? undefined
    : Object.freeze({ authority: mainHealthObservation.authority,
        receipt: args.qualifiedLocalReceipt, repositoryRoot });
  assertIntegrationMainHealthProducer({ ledger: mainHealthInput,
    repository: input.repository, mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha, now: observedAt,
    ...(localMainHealthAdmission === undefined ? {} : { localAdmission: localMainHealthAdmission }) });
  const preparationInput = { ...facts.preparationInput,
    mainHealthChecks: Object.freeze([]),
    executionEnvironment: createCiVerificationNativeLocalExecutionEnvironment(),
    mainHealthInput
  } as const;
  const planning = prepareTrustedMainVerificationSession(preparationInput);
  if (reviewBarrier.status !== 'clear') {
    return Object.freeze({
      kind: 'waiting' as const,
      request: planning.request,
      value: Object.freeze({
        status: 'WAITING_REVIEW',
        sessionRevision: planning.sessionRevision,
        reason: reviewBarrier.status === 'provider-schema-unsupported'
          ? reviewBarrier.reasonCode
          : reviewBarrier.reason
      })
    });
  }
  const prepared = prepareTrustedRuntimeVerificationSession(preparationInput);
  return Object.freeze({
    kind: 'prepared' as const, candidate, prepared, principal, integrationPermission,
    observedAt, runtimeRef, sourceProgramTransition, dependencyBlobs,
    observeAuthorApproval, authorApproval, manifestPath, manifestDigest,
    manifest, changed, mainHealthObservation
  });
}

const LOCAL_PREPARATION_INPUT_FILE = 'local-preparation-request.json';

function hasUnboundLocalPreparationRecords(directory: PhysicalDirectoryIdentity): boolean {
  return scanNoFollowDirectoryDirectMetadata(directory, {
    deadlineAtMs: performance.now() + 30_000, maximumEntries: 4096
  }).length > 0;
}

function localPreparationV2StateRoot(repositoryStateRoot: string,
  input: VerificationSessionLocalPreparationRequestV2): string {
  return path.join(repositoryStateRoot, 'trusted-runtime', 'local-preparation-v2',
    input.request.requestOperationId.slice(7));
}

/** Saved input only. This decoder never reconstructs execution qualification. */
function assertStoredLocalPreparationV2(bytes: Uint8Array,
  expected: VerificationSessionLocalPreparationRequestV2): VerificationSessionLocalPreparationRequestV2 {
  const source = Buffer.from(bytes).toString('utf8');
  const parsed = parseVerificationSessionLocalPreparationRequest(source);
  if (parsed.schema !== CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA
      || source !== `${encodeVerificationActionData(parsed)}\n`) {
    fail('V2 preparation input is not canonical original request data');
  }
  assertVerificationSessionLocalPreparationV2Current(expected, parsed);
  return parsed;
}

function readLocalVerificationV2Status(input: Readonly<{
  repositoryRoot: string; repository: string; request: VerificationSessionLocalPreparationRequestV2;
}>) {
  const saved = input.request;
  const request = saved.request;
  if (request.repository !== input.repository) fail('V2 status belongs to another repository');
  const layout = resolveSecRuntimeStateForRepository({
    repositoryRoot: path.resolve(input.repositoryRoot), repository: input.repository });
  const root = localPreparationV2StateRoot(layout.repositoryStateRoot, saved);
  const presence = inspectExactNoFollowDirectoryPresence(root, 'V2 local verification record directory');
  const read = (name: string) => presence.state === 'absent' ? null
    : readNoFollowOrdinaryFile(presence.directory.target, name);
  const preparationBytes = read(LOCAL_PREPARATION_INPUT_FILE);
  const actionBytes = read('verification-action.json');
  const pendingBytes = actionBytes === null ? read('verification-pending-qualification.json') : null;
  if (preparationBytes === null && presence.state === 'present'
      && hasUnboundLocalPreparationRecords(presence.directory.target)) {
    fail('V2 computation has no exact stored preparation input');
  }
  if (preparationBytes !== null) assertStoredLocalPreparationV2(preparationBytes, saved);
  const action = actionBytes === null ? null : parseActionBundle(actionBytes);
  const pending = pendingBytes === null ? null : parsePendingTrustedRuntimeEvidence(pendingBytes);
  const evidence = action?.artifact.evidence ?? pending?.evidence ?? null;
  if (evidence !== null) {
    CodexDevelopmentAssertVerificationEvidenceV4(evidence, {
      baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
      headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
      manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
      profile: request.profile
    });
  }
  if (action !== null) {
    const { session, scopeAuthorization } = action.artifact;
    const requirements = request.qualificationRequirements;
    if (session.repository !== request.repository || session.prNumber !== request.prNumber
        || session.trustRevision !== requirements.trustedRevision
        || session.reviewPolicyDigest !== requirements.reviewPolicyDigest
        || session.evidenceRequirementDigest !== requirements.evidenceRequirementDigest
        || session.integrationPolicyDigest !== requirements.integrationPolicyDigest
        || scopeAuthorization.issuer.principalId !== request.actorNodeId
        || encodeVerificationActionData(scopeAuthorization.authorizedPaths)
          !== encodeVerificationActionData(request.authorizedPaths)) {
      fail('V2 recorded Session differs from the frozen preparation requirements');
    }
  }
  return Object.freeze({ status: evidence === null ? 'LOCAL_REQUEST_OBSERVED' as const : 'LOCAL_EVIDENCE_RECORDED' as const,
    execution: 'local' as const, stage: 'read-only-projection' as const,
    observationScope: 'saved-local-request-and-durable-records' as const,
    savedRequest: saved, requestOperationId: request.requestOperationId,
    preparationInputMatched: preparationBytes !== null,
    sessionRevision: evidence?.sessionRevision ?? null,
    verificationStatus: evidence?.status ?? 'not-observed', evidenceDigest: evidence?.evidenceDigest ?? null,
    evidenceRecord: action !== null ? 'verification-action' as const
      : pending !== null ? 'pending-qualification' as const : 'not-observed' as const,
    artifactDigest: action?.artifact.artifactDigest ?? null,
    // Saved input equality authenticates neither a live host nor the complete
    // source observation. Original owners reobserve all of these on execution.
    unverifiedRequestFields: Object.freeze(evidence === null ? Object.keys(request)
      : ['sourceFactsDigest', 'verificationPlanDigest', 'sourceProgramBindingDigest',
          'qualificationRequirements', ...(action === null ? ['repository', 'prNumber', 'actorNodeId', 'authorizedPaths'] : [])]),
    currentSubject: 'not-observed' as const, sourceQualification: 'not-revalidated' as const,
    integrationAuthorization: 'not-evaluated' as const, executionStarted: false as const });
}

/** Read only the original owner's durable records. Their presence is historical
 * computation evidence, never a live qualification, current candidate or grant. */
export function readLocalVerificationStatusWithTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  request: VerificationSessionLocalPreparation;
}>) {
  const saved = parseVerificationSessionLocalPreparationRequest(JSON.stringify(input.request));
  if (saved.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA) {
    return readLocalVerificationV2Status({ ...input, request: saved });
  }
  const request = saved.request;
  const layout = resolveSecRuntimeStateForRepository({
    repositoryRoot: path.resolve(input.repositoryRoot), repository: input.repository
  });
  const sessionRoot = path.join(layout.repositoryStateRoot, 'trusted-runtime', 'v1',
    request.expectedSessionRevision.slice(7));
  const presence = inspectExactNoFollowDirectoryPresence(sessionRoot, 'Local verification record directory');
  const actionBytes = presence.state === 'absent' ? null
    : readNoFollowOrdinaryFile(presence.directory.target, 'verification-action.json');
  const pendingBytes = actionBytes !== null || presence.state === 'absent' ? null
    : readNoFollowOrdinaryFile(presence.directory.target, 'verification-pending-qualification.json');
  const action = actionBytes === null ? null : parseActionBundle(actionBytes);
  const pending = pendingBytes === null ? null : parsePendingTrustedRuntimeEvidence(pendingBytes);
  const evidence = action?.artifact.evidence ?? pending?.evidence ?? null;
  if (evidence !== null) {
    // Both completed and pending records must agree with every saved scalar
    // pin available in Evidence V4. Matching digest labels alone is insufficient.
    CodexDevelopmentAssertVerificationEvidenceV4(evidence, {
      sessionRevision: request.expectedSessionRevision,
      baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
      headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
      manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
      profile: request.profile as 'quick' | 'full'
    });
    if (evidence.actionPlan.actionPlanDigest !== request.expectedActionPlanDigest) {
      fail('saved local evidence differs from the requested Action plan');
    }
  }
  if (action !== null) {
    const { session, scopeAuthorization } = action.artifact;
    if (session.repository !== input.repository || session.prNumber !== request.prNumber
        || session.baseSha !== request.expectedBaseSha || session.baseTreeSha !== request.expectedBaseTreeSha
        || session.headSha !== request.expectedHeadSha || session.headTreeSha !== request.expectedHeadTreeSha
        || session.manifestPath !== request.manifestPath || session.manifestDigest !== request.manifestDigest
        || session.profile !== request.profile || session.reviewPolicyDigest !== request.reviewPolicyDigest
        || scopeAuthorization.proposalDigest !== request.expectedScopeProposalDigest) {
      fail('saved local artifact differs from exact preparation inputs');
    }
  }
  return Object.freeze({
    status: evidence === null ? 'LOCAL_REQUEST_OBSERVED' as const : 'LOCAL_EVIDENCE_RECORDED' as const,
    execution: 'local' as const,
    stage: 'read-only-projection' as const,
    observationScope: 'saved-local-request-and-durable-records' as const,
    savedRequest: saved,
    sessionRevision: request.expectedSessionRevision,
    verificationStatus: evidence?.status ?? 'not-observed',
    evidenceDigest: evidence?.evidenceDigest ?? null,
    evidenceRecord: action !== null ? 'verification-action' as const
      : pending !== null ? 'pending-qualification' as const : 'not-observed' as const,
    artifactDigest: action?.artifact.artifactDigest ?? null,
    // Pending evidence has no Session/scope/review carrier. Expose precisely
    // which associations the available records cannot independently establish.
    unverifiedRequestFields: Object.freeze(evidence === null
      ? ['repository', ...Object.keys(request).filter((key) => key !== 'schema')]
      : action === null
        ? ['repository', 'prNumber', 'expectedScopeProposalDigest', 'reviewPolicyDigest', 'requestOperationId']
        : ['requestOperationId']),
    currentSubject: 'not-observed' as const,
    sourceQualification: 'not-revalidated' as const,
    integrationAuthorization: 'not-evaluated' as const,
    executionStarted: false as const
  });
}

export async function prepareWithTrustedRuntime(input: TrustedRuntimeCandidatePreparationInput) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const github = createVerificationSessionGitHubClient(repositoryRoot, input.repository);
  const candidate = await github.observeCandidate(input.repository, input.prNumber);
  const facts = await observeOpenCandidatePreparationFacts({ input, repositoryRoot, github, candidate });
  const request = prepareLocalVerificationIntent(facts.preparationInput);
  return Object.freeze({ status: 'LOCAL_PREPARED' as const, execution: 'local' as const,
    stage: 'preparation-only' as const, request,
    requestOperationId: request.request.requestOperationId,
    qualification: 'not-run' as const,
    unresolvedRequirements: Object.freeze(request.request.qualificationRequirements.nativeContentManifestDigest === null
      ? ['native-runtime-content-not-accepted'] as const : []),
    reviewReadiness: facts.reviewBarrier.status,
    verificationStatus: 'not-run' as const, sourceQualification: 'not-run' as const,
    integrationAuthorization: 'not-issued' as const });
}

async function closeoutOpenCandidateWithTrustedRuntime(args: Readonly<{
  input: Readonly<{
    repositoryRoot: string;
    repository: string;
    prNumber: number;
    testAuthorCommentId?: number;
  }>;
  repositoryRoot: string;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
  sourceTransitionUseCase: TrustedRuntimeSourceTransitionUseCase;
  stage: TrustedRuntimeCandidateStage;
  qualifiedLocalReceipt?: TrustedRuntimeMainHealthReceipt;
}>): Promise<TrustedRuntimeCloseoutOpenResult> {
  const { input, repositoryRoot, github, sourceTransitionUseCase } = args;
  const preparation = await prepareOpenCandidateWithTrustedRuntime({
    input, repositoryRoot, github, candidate: args.candidate,
    ...(args.qualifiedLocalReceipt === undefined ? {} : {
      qualifiedLocalReceipt: args.qualifiedLocalReceipt
    }),
    ...(args.stage.kind === 'verification-only'
      && args.stage.request.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA
        ? { latePreparation: args.stage.request } : {})
  });
  if (args.stage.kind === 'verification-only'
      && args.stage.request.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA) {
    assertVerificationSessionLocalPreparationCurrent(args.stage.request,
      preparation.kind === 'waiting' ? preparation.request : preparation.prepared.request);
  }
  if (preparation.kind === 'waiting') return preparation;
  const { candidate, prepared, principal, integrationPermission, observedAt, runtimeRef,
    sourceProgramTransition, dependencyBlobs, observeAuthorApproval, authorApproval,
    manifestPath, manifestDigest, manifest, changed, mainHealthObservation } = preparation;
  const envelope = prepared.envelope;
  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot
  });
  const latePreparation = args.stage.kind === 'verification-only'
    && args.stage.request.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA
      ? args.stage.request : undefined;
  const sessionRoot = latePreparation === undefined
    ? path.join(runtimeLayout.repositoryStateRoot, 'trusted-runtime', 'v1', envelope.session.sessionRevision.slice(7))
    : localPreparationV2StateRoot(runtimeLayout.repositoryStateRoot, latePreparation);
  return withTrustedRuntimeStateAuthority({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    sessionRoot
  }, async (authority) => {
    const stateDirectory = authority.directory(sessionRoot);
    const actionFile = 'verification-action.json';
    const existingAction = readNoFollowOrdinaryFile(stateDirectory, actionFile);
    const pendingFile = 'verification-pending-qualification.json';
    const pendingBytes = existingAction === null ? readNoFollowOrdinaryFile(stateDirectory, pendingFile) : null;
    if (latePreparation !== undefined) {
      const existingPreparation = readNoFollowOrdinaryFile(stateDirectory, LOCAL_PREPARATION_INPUT_FILE);
      if (existingPreparation === null && hasUnboundLocalPreparationRecords(stateDirectory)) {
        fail('V2 prior computation has no exact original preparation input');
      }
      if (existingPreparation !== null) assertStoredLocalPreparationV2(existingPreparation, latePreparation);
      else publishCanonical({ parent: stateDirectory, name: LOCAL_PREPARATION_INPUT_FILE,
        value: latePreparation,
        parse: bytes => assertStoredLocalPreparationV2(bytes, latePreparation) });
    }
    let actionBundle: TrustedRuntimeActionBundle | null = existingAction === null
      ? null : parseActionBundle(existingAction);
    const previousVerification = actionBundle === null
      ? pendingBytes === null ? null : parsePendingTrustedRuntimeEvidence(pendingBytes)
      : Object.freeze({ evidence: actionBundle.artifact.evidence, receipt: actionBundle.containerReceipt });
    if (previousVerification !== null && (
      previousVerification.evidence.sessionRevision !== envelope.session.sessionRevision
      || previousVerification.evidence.actionPlan.actionPlanDigest !== envelope.actionPlanClosure.actionPlanDigest
    )) fail('prior computation belongs to another Session or Action plan');
    const transitionResult = await sourceTransitionUseCase({
      repositoryRoot, envelope, sourceProgramTransition, actorNodeId: principal.nodeId,
      requiredBlobs: dependencyBlobs.map(({ path: dependencyPath, candidateSource }) => Object.freeze({
        path: dependencyPath, digest: `sha256:${createHash('sha256').update(candidateSource).digest('hex')}` as Digest
      })),
      previousVerification,
      observeAuthorApproval,
      assertCurrentSubject: async () => {
        const current = await github.observeCandidate(input.repository, input.prNumber);
        if (current.state !== 'OPEN' || current.isDraft || current.isCrossRepository
            || current.baseSha !== candidate.baseSha || current.baseTreeSha !== candidate.baseTreeSha
            || current.headSha !== candidate.headSha || current.headTreeSha !== candidate.headTreeSha
            || CodexDevelopmentParseWorkPackageLocator(current.body) !== manifestPath) {
          fail('exact PR subject or Work Package locator drifted before accepted publication');
        }
      },
      publishAttempt: (evidence) => {
        publishCanonical({ parent: stateDirectory,
          name: `source-program-attempt-${evidence.evidenceDigest.slice(7)}.json`, value: evidence,
          parse: (bytes) => parseTrustedRuntimeSourceProgramAttemptEvidence(JSON.parse(Buffer.from(bytes).toString('utf8'))) });
      },
      publishVerification: (result) => {
        publishCanonical({ parent: stateDirectory, name: pendingFile,
          value: createPendingTrustedRuntimeEvidence(result), parse: parsePendingTrustedRuntimeEvidence });
      },
      publishAdoption: (qualification) => {
        publishCanonical({ parent: stateDirectory,
          name: `source-program-adoption-${qualification.qualificationDigest.slice(7)}.json`, value: qualification,
          parse: (bytes) => parseSourceProgramTransitionAcceptanceRecord(JSON.parse(Buffer.from(bytes).toString('utf8'))) });
      }
    });
    if (transitionResult.kind === 'waiting') return transitionResult;
    const sourceProgramTransitionQualification = transitionResult.qualification;
    if (actionBundle === null) {
      const artifact = finalizeVerificationSessionHostedArtifact({
        envelope, sourceProgramTransitionQualification, evidence: transitionResult.verification.evidence
      });
      actionBundle = publishCanonical({ parent: stateDirectory, name: actionFile,
        value: createActionBundle({ artifact, containerReceipt: transitionResult.verification.receipt }),
        parse: parseActionBundle });
    }
    const artifact = existingAction === null ? actionBundle.artifact : refreshVerificationSessionHostedArtifact({
      envelope,
      previousArtifact: actionBundle.artifact,
      producer: actionBundle.artifact.producer,
      refreshedAt: observedAt,
      sourceProgramTransitionQualification
    });
    const artifactText = `${encodeVerificationActionData(artifact)}\n`;
    publishCanonical({
      parent: stateDirectory,
      name: `artifact-${artifact.artifactDigest.slice(7)}.json`,
      value: artifact,
      parse: (bytes) => CodexDevelopmentParseVerificationSessionArtifact(
        Buffer.from(bytes).toString('utf8')
      )
    });
    const freshCandidate = (await github.observeCandidate(input.repository, input.prNumber));
    if (freshCandidate.headSha !== candidate.headSha || freshCandidate.baseSha !== candidate.baseSha
        || freshCandidate.headTreeSha !== candidate.headTreeSha || freshCandidate.baseTreeSha !== candidate.baseTreeSha
        || freshCandidate.state !== 'OPEN' || freshCandidate.isDraft || freshCandidate.isCrossRepository
        || CodexDevelopmentParseWorkPackageLocator(freshCandidate.body) !== manifestPath) {
      fail('candidate drifted after durable Verification');
    }
    // The explicit verification stage ends at the original durable artifact
    // boundary. No pre-merge review, grant, remote status or merge is acquired.
    if (args.stage.kind === 'verification-only') {
      return Object.freeze({ kind: 'verified' as const, value: Object.freeze({
        status: artifact.evidence.status === 'passed' ? 'LOCAL_VERIFIED' as const : 'LOCAL_VERIFICATION_RECORDED' as const,
        execution: 'local' as const,
        stage: 'verification-only' as const,
        ...(latePreparation === undefined ? {} : { requestOperationId: latePreparation.request.requestOperationId }),
        sessionRevision: artifact.session.sessionRevision,
        actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest,
        artifactDigest: artifact.artifactDigest,
        verificationStatus: artifact.evidence.status,
        sourceQualificationDigest: sourceProgramTransitionQualification.qualificationDigest,
        actionEvidenceReused: existingAction !== null || pendingBytes !== null,
        integrationAuthorization: 'not-issued-by-this-operation' as const
      }) });
    }
    const preMergeBarrier = (await github.observeReviewBarrier({ repository: input.repository,
      prNumber: input.prNumber, headSha: candidate.headSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) }));
    if (preMergeBarrier.status !== 'clear') {
      return Object.freeze({
        kind: 'waiting' as const,
        value: Object.freeze({
          status: 'WAITING_REVIEW',
          sessionRevision: envelope.session.sessionRevision,
          reason: preMergeBarrier.status === 'provider-schema-unsupported'
            ? preMergeBarrier.reasonCode : preMergeBarrier.reason
        })
      });
    }
    const issuedAt = preMergeBarrier.observedAt;
    const preMergeReview = createVerificationSessionReviewReceipt({
      stage: 'pre-merge',
      session: artifact.session,
      scope: artifact.scopeAuthorization,
      barrier: preMergeBarrier,
      candidateAuthorNodeId: candidate.authorNodeId,
      integrationPrincipalNodeId: principal.nodeId,
      expiresAt: new Date(Date.parse(issuedAt) + 5 * 60_000).toISOString(),
      operationId: hash({ schema: 'sec-trusted-runtime-pre-merge-review-v1',
        sessionRevision: artifact.session.sessionRevision,
        snapshotDigest: preMergeBarrier.snapshot.snapshotDigest })
    });
    // T2 reobserves the same canonical selection and borrows the original live
    // receipt. A healthy projection alone cannot revive expired qualification.
    const freshMainHealthObservation = await withMainHealthGitHubReadOperationBudget({
      repositoryRoot, repository: input.repository,
      operation: async () => await observeCanonicalMainHealthForPublication({
        repositoryRoot, repository: input.repository,
        defaultBranch: candidate.baseBranch, mainSha: candidate.baseSha,
        mainTreeSha: candidate.baseTreeSha,
        ...(args.qualifiedLocalReceipt === undefined ? {} : {
          qualifiedLocalReceipt: args.qualifiedLocalReceipt
        })
      })
    });
    if (freshMainHealthObservation.ledger === null
        || freshMainHealthObservation.projection.state !== 'healthy'
        || freshMainHealthObservation.repairDecision.routingState !== 'ordinary-only') {
      fail(
        `canonical MainHealth is not healthy and ordinary-only at merge admission: `
        + `${freshMainHealthObservation.repairDecision.reasonCode}`
      );
    }
    assertMainHealthPublicationAuthorityStable(mainHealthObservation.authority, freshMainHealthObservation.authority);
    if (freshMainHealthObservation.stableDigest !== mainHealthObservation.stableDigest) {
      fail('canonical MainHealth producer provenance drifted between closeout snapshots');
    }
    const freshMainHealth = freshMainHealthObservation.ledger;
    const freshLocalMainHealthAdmission = args.qualifiedLocalReceipt === undefined ? undefined
      : Object.freeze({ authority: freshMainHealthObservation.authority,
          receipt: args.qualifiedLocalReceipt, repositoryRoot });
    assertIntegrationMainHealthProducer({ ledger: freshMainHealth,
      repository: input.repository, mainSha: candidate.baseSha,
      mainTreeSha: candidate.baseTreeSha, now: issuedAt,
      ...(freshLocalMainHealthAdmission === undefined ? {} : {
        localAdmission: freshLocalMainHealthAdmission
      }) });
    const artifactObservation = createTrustedRuntimeArtifactObservationFromDurableFile({
      artifact,
      artifactText,
      runtimeSha: candidate.baseSha,
      executionId: actionBundle.containerReceipt.executionId
    });
    const consumptionOperationId = createVerificationSessionMergeOperationId({
      sessionRevision: artifact.session.sessionRevision,
      headSha: candidate.headSha,
      actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest
    });
    const platform = (await github.observePlatformEnforcement(input.repository));
    const gateInput = prepareVerificationSessionTrustedRuntimeMergeInput({
      artifact,
      sourceProgramTransitionQualification,
      preMergeReview,
      platform,
      candidate: {
        repository: input.repository,
        prNumber: input.prNumber,
        draft: false,
        headOpenPullRequestCount: 1,
        currentBaseSha: candidate.baseSha,
        currentBaseTreeSha: candidate.baseTreeSha,
        headSha: candidate.headSha,
        headTreeSha: candidate.headTreeSha,
        baseIsAncestor: true,
        behindBy: 0,
        manifestPath,
        manifestDigest,
        changedPaths: changed.changedPaths
      },
      artifactObservation,
      provenance: {
        runtimePath: CodexDevelopmentMergeGateProducerIdentity,
        runtimeRef,
        runtimeSha: candidate.baseSha,
        executionId: actionBundle.containerReceipt.executionId,
        actorNodeId: principal.nodeId,
        actorPermission: integrationPermission
      },
      mainHealth: freshMainHealth,
      consumptionOperationId,
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + 5 * 60_000).toISOString()
    });
    const gate = CodexDevelopmentEvaluateTrustedRuntimeMergeGate(gateInput,
      sourceProgramTransitionQualification, freshLocalMainHealthAdmission);
    const gateReadback = publishCanonical({
      parent: stateDirectory,
      name: `merge-gate-${gate.resultDigest.slice(7)}.json`,
      value: gate,
      parse: (bytes) => CodexDevelopmentParseTrustedRuntimeMergeGateResult(
        Buffer.from(bytes).toString('utf8')
      )
    });
    const publication = await publishIntegrationAuthorizationStatus({
      repositoryRoot, result: gate,
      targetUrl: `https://github.com/${input.repository}/pull/${input.prNumber}`,
      expectedPrincipal: { login: principal.login, nodeId: principal.nodeId }
    });
    const statusReadback = publishCanonical({
      parent: stateDirectory,
      name: `status-${publication.publicationDigest.slice(7)}.json`,
      value: publication,
      parse: (bytes) => parseIntegrationAuthorizationStatusPublication(
        Buffer.from(bytes).toString('utf8')
      )
    });
    const disposition = (await observeExactIssueDispositionPlan({
      github,
      repository: input.repository,
      candidate,
      manifestPath,
      manifestDigest,
      tracking: manifest.tracking
    }));
    const authorizationMarkers = integrationAuthorizationStatusMergeMarkers({
      result: gateReadback,
      publication: statusReadback
    });
    const issueMarkers = [
      `Issue-Disposition-Plan: ${disposition.planDigest}`,
      `Issue-Disposition-Mode: ${disposition.mode}`,
      `Issue-Disposition-Tracking: ${disposition.trackingIssueNumber ?? 'none'}`,
      `Issue-Disposition-Prose: ${disposition.titleBodyDigest}`
    ];
    const mergeMarkers = [...authorizationMarkers, ...issueMarkers];
    const title = `Verified integration ${artifact.session.sessionRevision.slice(7, 19)}`;
    const message = [...mergeMarkers, renderIndependentReviewTrailer(gateReadback.reviewReceipt)].join('\n');
    if (parseGitHubClosingKeywordOccurrences(`${title}\n${message}`, input.repository).length > 0) {
      fail('canonical merge message contains a forbidden closing keyword');
    }
    const platformBeforeMerge = (await github.observePlatformEnforcement(input.repository));
    const liveBeforeMerge = (await github.observeCandidate(input.repository, input.prNumber));
    if (platformBeforeMerge.status !== gateReadback.platformObservation.status
        || platformBeforeMerge.rulesetDigest !== gateReadback.platformObservation.rulesetDigest
        || platformBeforeMerge.reason !== gateReadback.platformObservation.reason
        || liveBeforeMerge.state !== 'OPEN' || liveBeforeMerge.headSha !== candidate.headSha
        || liveBeforeMerge.headTreeSha !== candidate.headTreeSha
        || liveBeforeMerge.baseSha !== candidate.baseSha
        || liveBeforeMerge.baseTreeSha !== candidate.baseTreeSha
        || liveBeforeMerge.isDraft || liveBeforeMerge.isCrossRepository
        || CodexDevelopmentParseWorkPackageLocator(liveBeforeMerge.body) !== manifestPath) {
      fail('candidate or platform observation drifted immediately before merge');
    }
    const immediateDisposition = (await observeExactIssueDispositionPlan({
      github,
      repository: input.repository,
      candidate: liveBeforeMerge,
      manifestPath,
      manifestDigest,
      tracking: manifest.tracking
    }));
    if (immediateDisposition.planDigest !== disposition.planDigest) {
      fail('IssueDisposition plan drifted immediately before merge');
    }
    // Re-read the exact comment, author principal/role and edit before admitting the effect.
    const immediateAuthorApproval = await observeAuthorApproval();
    if (immediateAuthorApproval?.approvalDigest !== authorApproval?.approvalDigest
        || immediateAuthorApproval?.providerObservationDigest !== authorApproval?.providerObservationDigest) {
      fail('external test author decision or current author role drifted before merge');
    }
    // T1 and T2 each ended their bounded read operation before status or merge
    // effects. Their budgets never enclose candidate execution or write effects;
    // the original physical MainHealth deadline still bounds live consumption.
    let effectMainHealth = { ledger: freshMainHealth, localAdmission: freshLocalMainHealthAdmission };
    const assertEffectMainHealth = (): void => {
      assertIntegrationMainHealthProducer({ ledger: effectMainHealth.ledger,
        repository: input.repository, mainSha: candidate.baseSha,
        mainTreeSha: candidate.baseTreeSha, now: new Date().toISOString(),
        ...(effectMainHealth.localAdmission === undefined ? {} : {
          localAdmission: effectMainHealth.localAdmission
        }) });
    };
    return Object.freeze({
      kind: 'ready' as const,
      repositoryRoot,
      repository: input.repository,
      prNumber: input.prNumber,
      github,
      candidate,
      actionBundle,
      gateReadback,
      statusReadback,
      actionEvidenceReused: existingAction !== null || pendingBytes !== null,
      integrationPrincipal: Object.freeze({ login: principal.login, nodeId: principal.nodeId }),
      title,
      message,
      manifestPath,
      manifestDigest,
      disposition,
      assertMainHealthQualification: assertEffectMainHealth,
      assertMainHealthCurrent: async () => {
        // The earlier read budget has ended. A distinct bounded effect-time
        // observation cannot renew the producer's original physical deadline.
        await withMainHealthGitHubReadOperationBudget({ repositoryRoot,
          repository: input.repository, operation: async () => {
            const liveMain = await observeMainHealthGitHubDefaultBranchSha({
              repositoryRoot, repository: input.repository, defaultBranch: 'main' });
            if (liveMain !== candidate.baseSha) fail('MainHealth exact main drifted before merge effect');
            const current = await observeCanonicalMainHealthForPublication({ repositoryRoot,
              repository: input.repository, defaultBranch: 'main',
              mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha,
              ...(args.qualifiedLocalReceipt === undefined ? {} : {
                qualifiedLocalReceipt: args.qualifiedLocalReceipt
              }) });
            assertMainHealthPublicationAuthorityStable(freshMainHealthObservation.authority, current.authority);
            if (current.ledger === null || current.stableDigest !== freshMainHealthObservation.stableDigest) {
              fail('canonical MainHealth qualification drifted before merge effect');
            }
            const localAdmission = args.qualifiedLocalReceipt === undefined ? undefined
              : Object.freeze({ authority: current.authority,
                  receipt: args.qualifiedLocalReceipt, repositoryRoot });
            assertIntegrationMainHealthProducer({ ledger: current.ledger,
              repository: input.repository, mainSha: candidate.baseSha,
              mainTreeSha: candidate.baseTreeSha, now: new Date().toISOString(),
              ...(localAdmission === undefined ? {} : { localAdmission }) });
            effectMainHealth = { ledger: current.ledger, localAdmission };
          } });
      }
    });
  });
}

type TrustedRuntimeCloseoutMergedReadback = Parameters<typeof finalizeMergedTrustedRuntime>[0];

async function executeTrustedRuntimeCloseoutMergeEffect(
  preMerge: TrustedRuntimeCloseoutPreMerge
): Promise<TrustedRuntimeCloseoutMergedReadback> {
  // Reads complete before the write capability is acquired; provider sessions
  // never nest a read effect inside the merge effect. The live proof is checked
  // again synchronously at the actual mutation boundary below.
  await preMerge.assertMainHealthCurrent();
  preMerge.assertMainHealthQualification();
  let providerMergeCommitSha: string | null = null;
  let mergeFailure: ResourceSettlementFailure | undefined;
  try {
    providerMergeCommitSha = (await withGitHubApiMergeWriteSession({
      repositoryRoot: preMerge.repositoryRoot,
      repository: preMerge.repository,
      operation: async (capability) => {
        const principal = inspectGitHubApiCapability(capability).principal;
        if (principal.login !== preMerge.integrationPrincipal.login
            || principal.nodeId !== preMerge.integrationPrincipal.nodeId) {
          fail('GitHub merge capability principal differs from status publication principal');
        }
        preMerge.assertMainHealthQualification();
        return await mergeExactHead({
          repository: preMerge.repository,
          prNumber: preMerge.prNumber,
          headSha: preMerge.candidate.headSha,
          title: preMerge.title,
          message: preMerge.message,
          capability
        });
      }
    })).sha;
  } catch (error) {
    mergeFailure = { label: 'merge provider', error };
  }
  let readback: GitHubCandidateObservation;
  try {
    readback = (await preMerge.github.observeCandidate(preMerge.repository, preMerge.prNumber));
  } catch (error) {
    settleResources({ primary: mergeFailure, cleanup: [
      { label: 'AMBIGUOUS_SIDE_EFFECT: merge exact readback', settle: () => { throw error; } }
    ] });
    throw error;
  }
  if (readback.state !== 'MERGED' && mergeFailure !== undefined) throw mergeFailure.error;
  if (readback.state !== 'MERGED') {
    fail('AMBIGUOUS_SIDE_EFFECT: provider reported merge success without a merged readback');
  }
  return Object.freeze({
    repositoryRoot: preMerge.repositoryRoot,
    repository: preMerge.repository,
    prNumber: preMerge.prNumber,
    github: preMerge.github,
    candidate: readback,
    actionBundle: preMerge.actionBundle,
    gateReadback: preMerge.gateReadback,
    statusReadback: preMerge.statusReadback,
    providerMergeCommitSha,
    actionEvidenceReused: preMerge.actionEvidenceReused
  });
}

async function main(): Promise<void> {
  const { withGitHubCredentialBootstrap } = await import('../../../providers/github-api/credential-bootstrap.ts');
  return withGitHubCredentialBootstrap(process.argv.slice(2), runTrustedRuntimeOperatorCli);
}

export async function runTrustedRuntimeOperatorCli(argv: readonly string[], sourceTransitionUseCase?: TrustedRuntimeSourceTransitionUseCase): Promise<void> {
  const args = parseArgs(argv);
  const result = args.mode === 'runtime-canary'
      ? await runCurrentTrustedRuntimeWorkspaceCanary({
          repositoryRoot: process.cwd(),
          repository: args.repository,
          dependencies: args.dependencies
        })
      : args.mode === 'main-health'
        ? await runCurrentTrustedRuntimeMainHealth({
            repositoryRoot: process.cwd(),
            repository: args.repository
          })
        : args.mode === 'verification-only'
          ? await verifyWithTrustedRuntime({ repositoryRoot: process.cwd(), repository: args.repository,
              request: args.request,
              ...(args.testAuthorCommentId === undefined ? {} : { testAuthorCommentId: args.testAuthorCommentId })
            }, sourceTransitionUseCase)
          : await closeoutWithTrustedRuntime({
            repositoryRoot: process.cwd(),
            repository: args.repository,
            prNumber: args.prNumber,
            ...(args.testAuthorCommentId === undefined ? {} : { testAuthorCommentId: args.testAuthorCommentId })
          }, sourceTransitionUseCase);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main) await main();
