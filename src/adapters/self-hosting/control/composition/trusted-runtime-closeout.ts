#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs as parseNativeArgs } from 'node:util';

import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiMergeWriteSession,
  withGitHubApiReadSession,
  withGitHubApiStatusWriteSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { observeGitHubRepositoryComment } from '../../../providers/github-api/repository-comment.ts';
import { adoptSourceProgramTestAuthorDecision, type SourceProgramTestAuthorApproval } from '../../../repository/source-program-model/test-disposition-decisions.ts';
import { acquirePhysicalMutationLease } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import { publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecRuntimeStateForRepository } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority, type SecRuntimeStatePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { parseCiSourceProgramTransitionBinding } from '../../../verification/platform/action/contract/ci.ts';
import { CodexDevelopmentAssertVerificationEvidenceV4, CodexDevelopmentParseVerificationSessionArtifact, parseSourceProgramTransitionAcceptanceRecord, type CodexDevelopmentVerificationSessionArtifact } from '../../../verification/platform/ci/contract/evidence.ts';
import {
  createVerificationSessionGitHubClient,
  type GitHubCandidateObservation,
  type VerificationSessionGitHubClient
} from '../../../verification/platform/ci/runtime/verification-session-github.ts';
import {
  createTrustedRuntimeArtifactObservationFromDurableFile,
  createVerificationSessionMergeOperationId,
  createVerificationSessionReviewReceipt,
  finalizeVerificationSessionHostedArtifact,
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
  executeTrustedRuntimeMainHealth,
  executeTrustedRuntimeWorkspaceCanary,
  parseTrustedRuntimeContainerReceipt,
  parseTrustedRuntimeSourceProgramAttemptEvidence,
  TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT,
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
import {
  parseTrustedRuntimeMainHealthReceipt,
  trustedRuntimeMainHealthReceiptLocator,
  type TrustedRuntimeMainHealthReceipt
} from '../main-health/main-health-observation.ts';
import {
  assertMainHealthGitHubReadOperationBudgetCurrent,
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
  readonly artifact: CodexDevelopmentVerificationSessionArtifact;
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
}>;

type TrustedRuntimeCloseoutOpenResult =
  | TrustedRuntimeCloseoutPreMerge
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
  if (values['runtime-canary'] && values['main-health']) {
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
  artifact: CodexDevelopmentVerificationSessionArtifact;
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

function parseCanonicalTrustedRuntimeMainHealthReceipt(bytes: Uint8Array):
TrustedRuntimeMainHealthReceipt {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!Buffer.from(source, 'utf8').equals(Buffer.from(bytes))) {
    fail('MainHealth durable receipt is not exact UTF-8');
  }
  const receipt = parseTrustedRuntimeMainHealthReceipt(source);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes(receipt)))) {
    fail('MainHealth durable receipt bytes are not canonical');
  }
  return receipt;
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

export async function runCurrentTrustedRuntimeMainHealth(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): Promise<Readonly<{
  reused: boolean;
  receipt: TrustedRuntimeMainHealthReceipt;
}>> {
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

  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot
  });
  const locator = trustedRuntimeMainHealthReceiptLocator({
    repositoryStateRoot: runtimeLayout.repositoryStateRoot,
    mainSha: firstFence.headSha
  });
  return await withTrustedRuntimeStateAuthority({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    sessionRoot: locator.directory
  }, async (authority) => {
    const stateDirectory = authority.directory(locator.directory);
    const generationLease = acquirePhysicalMutationLease(
      stateDirectory,
      `main-health-${firstFence.headSha}.lock`
    );
    if (generationLease === null) {
      fail('MainHealth receipt generation is already active or its owner liveness is unknown');
    }
    try {
      const existing = readNoFollowOrdinaryFile(stateDirectory, locator.fileName);
      if (existing !== null) {
        const receipt = parseCanonicalTrustedRuntimeMainHealthReceipt(existing);
        if (receipt.repository !== input.repository
            || receipt.mainSha !== firstFence.headSha
            || receipt.mainTreeSha !== firstFence.treeSha) {
          fail('existing MainHealth receipt belongs to another exact subject');
        }
        // Re-enter the immutable publication owner with the exact same bytes.
        // An interrupted predecessor may have completed the no-replace rename
        // before its parent-directory durability boundary. This call validates
        // the same physical final value and re-establishes durable readback.
        const recovered = publishCanonical({
          parent: stateDirectory,
          name: locator.fileName,
          value: receipt,
          parse: parseCanonicalTrustedRuntimeMainHealthReceipt
        });
        if (generationLease.recoveryPending) {
          generationLease.acknowledgeReclaimedRecovery();
        }
        await assertCurrentTrustedRuntimeMainHealthSubject({
          repositoryRoot,
          repository: input.repository,
          expectedHeadSha: firstFence.headSha,
          expectedTreeSha: firstFence.treeSha,
          expectedOriginUrl: firstFence.originUrl
        });
        return Object.freeze({ reused: true, receipt: recovered });
      }
      // Final-name absence proves an interrupted predecessor never published
      // an adopted receipt. Any private random candidate was never authority;
      // after this exact readback the successor may clear predecessor lineage
      // and execute the same exact-main generation.
      if (generationLease.recoveryPending) {
        generationLease.acknowledgeReclaimedRecovery();
      }

      const receipt = await executeTrustedRuntimeMainHealth({
        repositoryRoot,
        repository: input.repository,
        mainSha: firstFence.headSha,
        mainTreeSha: firstFence.treeSha
      });

      await assertCurrentTrustedRuntimeMainHealthSubject({
        repositoryRoot,
        repository: input.repository,
        expectedHeadSha: firstFence.headSha,
        expectedTreeSha: firstFence.treeSha,
        expectedOriginUrl: firstFence.originUrl
      });
      const published = publishCanonical({
        parent: stateDirectory,
        name: locator.fileName,
        value: receipt,
        parse: parseCanonicalTrustedRuntimeMainHealthReceipt
      });
      await assertCurrentTrustedRuntimeMainHealthSubject({
        repositoryRoot,
        repository: input.repository,
        expectedHeadSha: firstFence.headSha,
        expectedTreeSha: firstFence.treeSha,
        expectedOriginUrl: firstFence.originUrl
      });
      return Object.freeze({ reused: false, receipt: published });
    } finally {
      if (generationLease.recoveryPending) generationLease.restoreReclaimedOwner();
      else generationLease.release();
    }
  });
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
  if (sourceTransitionUseCase === undefined) {
    fail('cold-source use case must be assembled by the canonical bootstrap entry');
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const github = createVerificationSessionGitHubClient(repositoryRoot, input.repository);
  const candidate = (await github.observeCandidate(input.repository, input.prNumber));
  if (candidate.state !== 'MERGED'
      && (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository)) {
    fail('candidate must be one open same-repository non-draft PR or its exact merged recovery');
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
    try {
      const current = await github.observeCandidate(input.repository, input.prNumber);
      if (current.headSha !== candidate.headSha || current.headTreeSha !== candidate.headTreeSha) {
        fail('PR candidate drifted before serialized closeout admission');
      }
      if (current.state === 'MERGED') {
        const settled = await recoverMergedTrustedRuntime({ repositoryRoot, repository: input.repository,
          prNumber: input.prNumber, github, candidate: current });
        if (lease.recoveryPending) lease.acknowledgeReclaimedRecovery();
        return settled;
      }
      if (current.state !== 'OPEN' || current.baseSha !== candidate.baseSha || current.headSha !== candidate.headSha
          || current.baseTreeSha !== candidate.baseTreeSha || current.headTreeSha !== candidate.headTreeSha) {
        fail('PR transition drifted before serialized closeout admission');
      }
      const preMerge = await withMainHealthGitHubReadOperationBudget({
        repositoryRoot,
        repository: input.repository,
        operation: async () => await closeoutOpenCandidateWithTrustedRuntime({
          input, repositoryRoot, github, candidate: current, sourceTransitionUseCase
        })
      });
      // All predecessor evidence was read and a fresh isolated assessment was
      // adopted, or the live review barrier deliberately held this attempt.
      if (lease.recoveryPending) lease.acknowledgeReclaimedRecovery();
      if (preMerge.kind === 'waiting') return preMerge.value;
      return await executeTrustedRuntimeCloseoutMergeEffect(preMerge);
    } finally {
      try {
        await authority.assertCurrent();
      } finally {
        if (lease.recoveryPending) lease.restoreReclaimedOwner();
        else lease.release();
      }
    }
  });
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
}>): Promise<TrustedRuntimeCloseoutOpenResult> {
  const { input, repositoryRoot, github, candidate, sourceTransitionUseCase } = args;
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
    fail('candidate changed before trusted-runtime closeout admission');
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
  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot
  });
  const mainHealthObservation = await observeCanonicalMainHealthForPublication({
    repositoryRoot,
    repository: input.repository,
    defaultBranch: candidate.baseBranch,
    mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha
  });
  if (mainHealthObservation.ledger === null
      || mainHealthObservation.ledger.producer.sourceTransport !== 'github-api'
      || mainHealthObservation.projection.state !== 'healthy'
      || mainHealthObservation.repairDecision.routingState !== 'ordinary-only') {
    fail(
      `canonical MainHealth is not healthy and ordinary-only at closeout admission: `
      + `${mainHealthObservation.repairDecision.reasonCode}`
    );
  }
  const mainHealthInput = mainHealthObservation.ledger;
  const preparationInput = {
    repository: input.repository,
    candidate,
    manifestPath,
    manifestDigest,
    changedPaths: changed.changedPaths,
    testImpactTransition: changed.testImpactTransition,
    testImpactSourceProvider: changed.testImpactSourceProvider,
    profile: manifest.requiredProfile,
    integrationPrincipalNodeId: principal.nodeId,
    producerPrincipalNodeId: principal.nodeId,
    sourceRunId: `trusted-runtime-${candidate.headSha.slice(0, 16)}`,
    sourceRef: runtimeRef,
    observedAt,
    reviewBarrier,
    mainHealthChecks: Object.freeze([]),
    dependencyBlobs,
    executionEnvironment: TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT,
    sourceProgramTransition,
    mainHealthInput
  } as const;
  const planning = prepareTrustedMainVerificationSession(preparationInput);
  if (reviewBarrier.status !== 'clear') {
    return Object.freeze({
      kind: 'waiting' as const,
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
  const envelope = prepared.envelope;
  const sessionRoot = path.join(runtimeLayout.repositoryStateRoot, 'trusted-runtime', 'v1',
    envelope.session.sessionRevision.slice(7));
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
            || current.headSha !== candidate.headSha || current.headTreeSha !== candidate.headTreeSha) {
          fail('exact PR subject drifted before accepted publication');
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
        || freshCandidate.state !== 'OPEN') fail('candidate drifted after durable Verification');
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
    // T2 rereads the hosted producer. Its stable digest excludes observation
    // time but binds producer provenance and the exact repository result, so
    // healthy-to-healthy provenance drift cannot pass the merge gate.
    const freshMainHealthObservation = await observeCanonicalMainHealthForPublication({
      repositoryRoot,
      repository: input.repository,
      defaultBranch: candidate.baseBranch,
      mainSha: candidate.baseSha,
      mainTreeSha: candidate.baseTreeSha
    });
    if (freshMainHealthObservation.ledger === null
        || freshMainHealthObservation.ledger.producer.sourceTransport !== 'github-api'
        || freshMainHealthObservation.projection.state !== 'healthy'
        || freshMainHealthObservation.repairDecision.routingState !== 'ordinary-only') {
      fail(
        `canonical MainHealth is not healthy and ordinary-only at merge admission: `
        + `${freshMainHealthObservation.repairDecision.reasonCode}`
      );
    }
    if (freshMainHealthObservation.stableDigest !== mainHealthObservation.stableDigest) {
      fail('canonical MainHealth hosted producer provenance drifted between closeout snapshots');
    }
    const freshMainHealth = freshMainHealthObservation.ledger;
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
    const gate = CodexDevelopmentEvaluateTrustedRuntimeMergeGate(gateInput, sourceProgramTransitionQualification);
    const gateReadback = publishCanonical({
      parent: stateDirectory,
      name: `merge-gate-${gate.resultDigest.slice(7)}.json`,
      value: gate,
      parse: (bytes) => CodexDevelopmentParseTrustedRuntimeMergeGateResult(
        Buffer.from(bytes).toString('utf8')
      )
    });
    const publication = await withGitHubApiStatusWriteSession({
      repositoryRoot,
      repository: input.repository,
      operation: async (capability) => {
        const capabilityPrincipal = inspectGitHubApiCapability(capability).principal;
        if (capabilityPrincipal.login !== principal.login
            || capabilityPrincipal.nodeId !== principal.nodeId
            || capabilityPrincipal.userId === null) {
          fail('GitHub status capability principal differs from the observed maintainer');
        }
        return await publishIntegrationAuthorizationStatus({
          result: gate,
          targetUrl: `https://github.com/${input.repository}/pull/${input.prNumber}`,
          capability
        });
      }
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
        || liveBeforeMerge.isDraft || liveBeforeMerge.isCrossRepository) {
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
    // The read budget ends at this final pre-effect fence. Merge and its
    // readback run after the budget owner returns, so a long provider-side
    // mutation cannot turn a successful merge into a post-effect timeout.
    assertMainHealthGitHubReadOperationBudgetCurrent({
      repositoryRoot,
      repository: input.repository
    });
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
      disposition
    });
  });
}

async function executeTrustedRuntimeCloseoutMergeEffect(
  preMerge: TrustedRuntimeCloseoutPreMerge
): Promise<unknown> {
  let providerMergeCommitSha: string | null = null;
  let mergeFailure: unknown = null;
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
    mergeFailure = error;
  }
  let readback: GitHubCandidateObservation;
  try {
    readback = (await preMerge.github.observeCandidate(preMerge.repository, preMerge.prNumber));
  } catch (error) {
    const providerReason = mergeFailure instanceof Error
      ? mergeFailure.message
      : mergeFailure === null ? 'provider reported success' : String(mergeFailure);
    const readbackReason = error instanceof Error ? error.message : String(error);
    fail(`AMBIGUOUS_SIDE_EFFECT: merge requires exact retry readback; provider=${providerReason}; readback=${readbackReason}`);
  }
  if (readback.state !== 'MERGED' && mergeFailure !== null) throw mergeFailure;
  if (readback.state !== 'MERGED') {
    fail('AMBIGUOUS_SIDE_EFFECT: provider reported merge success without a merged readback');
  }
  return (await finalizeMergedTrustedRuntime({
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
  }));
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
        : await closeoutWithTrustedRuntime({
            repositoryRoot: process.cwd(),
            repository: args.repository,
            prNumber: args.prNumber,
            ...(args.testAuthorCommentId === undefined ? {} : { testAuthorCommentId: args.testAuthorCommentId })
          }, sourceTransitionUseCase);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main) await main();
