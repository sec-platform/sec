import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deepFreeze } from '../../../../../contracts/canonical.ts';
import { parseDigest } from '../../../../../contracts/digest.ts';
import { failureMessage } from '../../../../../contracts/failure-inspection.ts';
import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest } from '../../../../../execution/verification/action.ts';
import type { HostedResumeSignal } from '../../../../../execution/verification/hosted.ts';

import { readVerificationDataRecord, snapshotVerificationData } from '../../../../../assurance/verification/contract/data.ts';
import type { HostedSourceArtifactProjection } from '../../../../providers/github-api/contract/hosted-artifact-projections.ts';
import { assertCiVerificationPerJobHostedWholeWorkflowShape, assertCiVerificationPerJobHostedWorkflowShape, type CiVerificationPerJobHostedJobPolicy } from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import { HOSTED_RESUME_DISPATCH_EVENT, HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent,
  getAuthenticatedGitHubJobOriginSignal,
  type AuthenticatedGitHubJobOrigin
} from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  assertGitHubApiCapability, executeGitHubApiOperation, inspectGitHubApiCapability,
  withGitHubApiVerificationActionProviderSession,
  withGitHubApiVerificationSession,
  type GitHubApiCapability, type GitHubApiOperation
} from '../../../../providers/github-api/operation-session.ts';
import { normalizeGitHubRepositoryPermission } from '../../../../providers/github-api/repository-permission.ts';
import { assertIssuedRuntimeJournalFileSystem } from '../../../../runtime-state/workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../../runtime-state/workspace-state/paths.ts';
import { assertScopeAuthorizationCurrent, parseScopeAuthorization } from '../../../../self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { assertCiVerificationActionProviderEnvelopeMember, CI_VERIFICATION_ACTION_DISPATCH_TYPE, CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE, ciVerificationActionParentDispatchPlanPayloadDigest, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionPlanClosure, parseCiVerificationActionProviderEnvelope, resolveCiVerificationHostedExecutionEnvironment, type CiVerificationActionProviderEnvelope } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, finalizeVerificationActionProviderStatusReadback, matchesCiCompilerWorkflowRunIdentity, parseVerificationActionProviderStartMarker, parseVerificationActionProviderTerminalAnchor, reduceVerificationActionProviderState, VERIFICATION_ACTION_PROVIDER_POLICY, VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE, VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX, verificationActionProviderRunTargetUrl, verificationActionProviderStartArtifactName, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderTerminalDescription, type VerificationActionProviderArtifactObservation, type VerificationActionProviderOrigin, type VerificationActionProviderStartMarker, type VerificationActionProviderStatusObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchor, type VerificationActionProviderTerminalObservation } from '../../action/contract/provider.ts';
import { assertReviewStabilityReceiptCurrent, parseReviewStabilityReceipt } from '../../review/contract/stability.ts';
import { parseVerificationSession } from '../../session/contract/session.ts';
import {
  CodexDevelopmentParseVerificationActionTerminalArtifact,
  parseHostedSessionTerminalArtifact
} from '../contract/evidence.ts';
import {
  CI_VERIFICATION_SESSION_DISPATCH_TYPE,
  HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE,
  hostedResumeDispatchOutcomesArtifactName,
  hostedSessionArtifactName
} from '../contract/revision.ts';
import { parseVerificationSessionHostedRequest } from '../contract/session-request.ts';
import { CodexDevelopmentParseHostedActionRequest, CodexDevelopmentParseHostedActionResolution, CodexDevelopmentResolveHostedAction, parseHostedEnvelope } from '../verification-hosted-action-contract.ts';
import {
  artifactInventoryName, canonicalHostedWorkflowSource, fail, normalizeStatus, record,
  sourceArtifactProjectionForFile,
  type GitHubExactCommitStatusObservation, type GitHubExactCommitStatusProviderObservation,
  type GitHubExactCommitStatusState
} from './verification-action-github-transport-data.ts';
import { claimHostedResumeDispatch, parseHostedResumeDispatchOutcomeCollection, type VerificationSessionJournalFileSystem } from './verification-session-journal.ts';

const GITHUB_EXACT_COMMIT_STATUS_HISTORY_SCHEMA =
  'sec-github-exact-commit-status-history-v1' as const;

type GitHubExactCommitStatusHistory = Readonly<{
  schema: typeof GITHUB_EXACT_COMMIT_STATUS_HISTORY_SCHEMA;
  repository: string;
  sha: string;
  perPage: 100;
  paginationComplete: true;
  pageDigests: readonly VerificationActionKeyDigest[];
  statuses: readonly GitHubExactCommitStatusObservation[];
  readbackDigest: VerificationActionKeyDigest;
}>;

type GitHubProviderPage = Readonly<{
  records: readonly unknown[];
  hasNextPage: boolean;
}>;

type GitHubExactCommitStatusPage = GitHubProviderPage & Readonly<{
  rawResponseDigest: VerificationActionKeyDigest;
}>;

type GitHubProviderArtifactPage = Readonly<{
  records: readonly unknown[];
  totalCount: number;
  rawResponseDigest: VerificationActionKeyDigest;
}>;

type GitHubProviderJobPage = Readonly<{
  records: readonly unknown[];
  totalCount: number;
  responseDigest: VerificationActionKeyDigest;
}>;

interface GitHubExactCommitStatusReadFacts {
  listCommitStatusesPage(input: Readonly<{
    repository: string;
    sha: string;
    perPage: 100;
    page: number;
  }>): Promise<GitHubExactCommitStatusPage>;
}

interface GitHubExactCommitStatusTransport extends GitHubExactCommitStatusReadFacts {
  /** Exactly one REST mutation call. The adapter never retries this method. */
  createCommitStatus(input: Readonly<{
    repository: string;
    sha: string;
    state: GitHubExactCommitStatusState;
    context: string;
    description: string;
    targetUrl: string;
  }>): Promise<unknown>;
}

type GitHubExactCommitStatusPublishResult = Readonly<{
  disposition: 'created' | 'existing' | 'ambiguous';
  newlyCreatedByThisInvocation: boolean;
  status: GitHubExactCommitStatusObservation | null;
  readback: GitHubExactCommitStatusHistory;
  reason: string | null;
}>;

interface VerificationActionGitHubProviderReadFacts
  extends GitHubExactCommitStatusReadFacts {
  listArtifactsPage(input: Readonly<{
    repository: string;
    perPage: 100;
    page: number;
  }>): Promise<GitHubProviderArtifactPage>;
  getWorkflowRun(input: Readonly<{ repository: string; runId: string }>): Promise<unknown>;
  getWorkflowRunAttempt(input: Readonly<{
    repository: string;
    runId: string;
    runAttempt: number;
  }>): Promise<unknown>;
  getCheckSuite(input: Readonly<{ repository: string; checkSuiteId: number }>): Promise<unknown>;
  getArtifact(input: Readonly<{ repository: string; artifactId: string }>): Promise<unknown>;
  getRepository(input: Readonly<{ repository: string }>): Promise<unknown>;
  getWorkflow(input: Readonly<{ repository: string; workflowId: number }>): Promise<unknown>;
  getCanonicalHostedWorkflowSource(input: Readonly<{ repository: string; revision: string }>): Promise<string>;
  getPrincipalPermission(input: Readonly<{ repository: string; login: string }>): Promise<unknown>;
  listWorkflowJobsPage(input: Readonly<{
    repository: string;
    runId: string;
    runAttempt: number;
    page: number;
  }>): Promise<GitHubProviderJobPage>;
  downloadArtifact(input: Readonly<{
    repository: string;
    artifactId: string;
    artifactName: string;
    runId: string;
    archiveDigest: string | null;
    projection: HostedSourceArtifactProjection;
  }>): Promise<Readonly<{
    archiveBytes: Uint8Array;
    files: Readonly<Record<string, string>>;
  }>>;
}

interface VerificationActionGitHubProviderTransport extends VerificationActionGitHubProviderReadFacts,
  GitHubExactCommitStatusTransport {
  /** Exactly one at-least-once wake-up mutation. The adapter never retries it. */
  createRepositoryDispatch(input: Readonly<{
    repository: string;
    eventType: typeof CI_VERIFICATION_ACTION_DISPATCH_TYPE;
    clientPayload: VerificationActionRepositoryDispatchClientPayload;
  }>): Promise<void>;
}

type VerificationActionRepositoryDispatchClientPayload = Readonly<{
  payload: CiVerificationActionProviderEnvelope;
}>;

function createVerificationActionRepositoryDispatchClientPayload(
  envelope: CiVerificationActionProviderEnvelope
): VerificationActionRepositoryDispatchClientPayload {
  return Object.freeze({ payload: parseCiVerificationActionProviderEnvelope(envelope) });
}



type HistoricalSourceReadOperation = Extract<GitHubApiOperation, { kind:
  'repository' | 'workflow-run' | 'collaborator-permission' | 'verification-workflow-run-attempt' |
  'verification-check-suite' | 'verification-workflow' | 'verification-workflow-jobs' | 'verification-blob' |
  'verification-artifact' | 'verification-source-artifact-inventory-page' |
  'verification-source-commit-status-page' | 'verification-source-artifact-archive' }>;

/** An internal binding to the original production read issuer, never a caller backend. */
class RetainedHistoricalSourceReadFacts implements VerificationActionGitHubProviderReadFacts {
  constructor(private readonly capability: GitHubApiCapability, private readonly repositoryName: string) {
    this.assertCurrent();
  }

  assertCurrent(): void {
    assertGitHubApiCapability(this.capability, this.repositoryName, 'verification-read');
    if (inspectGitHubApiCapability(this.capability).origin !== 'production') {
      fail('historical source facts require the original production read capability.');
    }
  }

  private assertRepository(selected: string): void {
    this.assertCurrent();
    if (selected !== this.repositoryName) fail('historical source fact belongs to another read repository.');
  }

  private async read(operation: HistoricalSourceReadOperation): Promise<unknown> {
    this.assertCurrent();
    const value = await executeGitHubApiOperation(this.capability, operation);
    this.assertCurrent();
    return value;
  }

  async getRepository(input: Readonly<{ repository: string }>): Promise<unknown> {
    this.assertRepository(input.repository);
    return await this.read({ kind: 'repository' });
  }
  async getWorkflowRun(input: Readonly<{ repository: string; runId: string }>): Promise<unknown> {
    this.assertRepository(input.repository);
    return await this.read({ kind: 'workflow-run', runId: input.runId });
  }
  async getWorkflowRunAttempt(input: Readonly<{ repository: string; runId: string; runAttempt: number }>): Promise<unknown> {
    this.assertRepository(input.repository);
    return await this.read({ kind: 'verification-workflow-run-attempt', runId: input.runId, runAttempt: input.runAttempt });
  }
  async getCheckSuite(input: Readonly<{ repository: string; checkSuiteId: number }>): Promise<unknown> {
    this.assertRepository(input.repository);
    return await this.read({ kind: 'verification-check-suite', checkSuiteId: String(input.checkSuiteId) });
  }
  async getArtifact(input: Readonly<{ repository: string; artifactId: string }>): Promise<unknown> {
    this.assertRepository(input.repository);
    return await this.read({ kind: 'verification-artifact', artifactId: input.artifactId });
  }
  async getWorkflow(input: Readonly<{ repository: string; workflowId: number }>): Promise<unknown> {
    this.assertRepository(input.repository);
    return await this.read({ kind: 'verification-workflow', workflowId: String(input.workflowId) });
  }
  async getPrincipalPermission(input: Readonly<{ repository: string; login: string }>): Promise<unknown> {
    this.assertRepository(input.repository);
    return await this.read({ kind: 'collaborator-permission', login: input.login });
  }
  async getCanonicalHostedWorkflowSource(input: Readonly<{ repository: string; revision: string }>): Promise<string> {
    this.assertRepository(input.repository);
    return canonicalHostedWorkflowSource(await this.read({ kind: 'verification-blob', ref: input.revision,
      path: '.github/workflows/compiler-pr-validation.yml' }));
  }
  async listWorkflowJobsPage(input: Readonly<{ repository: string; runId: string; runAttempt: number; page: number }>): Promise<GitHubProviderJobPage> {
    this.assertRepository(input.repository);
    const value = record(await this.read({ kind: 'verification-workflow-jobs',
      runId: input.runId, runAttempt: input.runAttempt, page: input.page }), 'retained source job page');
    if (!Array.isArray(value.jobs) || !Number.isSafeInteger(value.total_count) || Number(value.total_count) < 0) {
      fail('retained source job page is invalid.');
    }
    return Object.freeze({ records: value.jobs, totalCount: Number(value.total_count), responseDigest: digest(value) });
  }
  async listArtifactsPage(input: Readonly<{ repository: string; perPage: 100; page: number }>): Promise<GitHubProviderArtifactPage> {
    this.assertRepository(input.repository);
    const captured = record(await this.read({ kind: 'verification-source-artifact-inventory-page', page: input.page }),
      'retained source artifact page capture');
    const value = record(captured.value, 'retained source artifact page');
    if (!Array.isArray(value.artifacts) || !Number.isSafeInteger(value.total_count) || Number(value.total_count) < 0 ||
        typeof captured.rawResponseDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(captured.rawResponseDigest)) {
      fail('retained source artifact page capture is invalid.');
    }
    return Object.freeze({ records: value.artifacts, totalCount: Number(value.total_count),
      rawResponseDigest: captured.rawResponseDigest as VerificationActionKeyDigest });
  }
  async listCommitStatusesPage(input: Readonly<{ repository: string; sha: string; perPage: 100; page: number }>): Promise<GitHubExactCommitStatusPage> {
    this.assertRepository(input.repository);
    const captured = record(await this.read({ kind: 'verification-source-commit-status-page', sha: input.sha, page: input.page }),
      'retained source status page capture');
    if (!Array.isArray(captured.value) || typeof captured.rawResponseDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(captured.rawResponseDigest)) fail('retained source status page capture is invalid.');
    return Object.freeze({ records: captured.value, hasNextPage: captured.value.length === 100,
      rawResponseDigest: captured.rawResponseDigest as VerificationActionKeyDigest });
  }
  async downloadArtifact(input: Parameters<VerificationActionGitHubProviderReadFacts['downloadArtifact']>[0]) {
    this.assertRepository(input.repository);
    const captured = record(await this.read({ kind: 'verification-source-artifact-archive',
      artifactId: input.artifactId, artifactName: input.artifactName, runId: input.runId,
      archiveDigest: input.archiveDigest, projection: input.projection }), 'retained source archive capture');
    if (!(captured.archiveBytes instanceof Uint8Array)) fail('retained source archive bytes are invalid.');
    const files = record(captured.files, 'retained source archive files');
    return Object.freeze({ archiveBytes: captured.archiveBytes, files: files as Readonly<Record<string, string>> });
  }
}

function captureActionProviderInput<Input extends object>(input: Input): Input {
  const captured = readVerificationDataRecord(input, 'Action provider input');
  const owned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(captured)) {
    Object.defineProperty(owned, key, { enumerable: true, writable: true, value: key === 'origin' || key === 'journalFileSystem'
      ? value : deepFreeze(snapshotVerificationData(value, `Action provider ${key}`)) });
  }
  if (owned.authority !== undefined) {
    const authority = readVerificationDataRecord(owned.authority, 'Action provider authority');
    if (Object.keys(authority).length !== 2 || !Object.hasOwn(authority, 'envelope') || !Object.hasOwn(authority, 'actionPlanClosure')) {
      fail('Action provider authority has an invalid field set.');
    }
    owned.authority = deepFreeze({ envelope: parseCiVerificationActionProviderEnvelope(authority.envelope),
      actionPlanClosure: parseCiVerificationActionPlanClosure(encodeVerificationActionData(authority.actionPlanClosure)) });
  }
  if (owned.intent !== undefined) {
    const intent = readVerificationDataRecord(owned.intent, 'Action provider intent');
    const keys = intent.kind === 'claim-start' ? ['kind', 'marker'] : intent.kind === 'anchor-terminal' ? ['kind', 'anchor'] : ['kind'];
    if (!['coordinate-parent', 'dispatch-child', 'coordinate', 'claim-start', 'anchor-terminal'].includes(String(intent.kind))
        || Object.keys(intent).length !== keys.length || keys.some(key => !Object.hasOwn(intent, key))) fail('Action provider intent is not closed.');
    owned.intent = deepFreeze(intent.kind === 'claim-start' ? { kind: intent.kind, marker: parseVerificationActionProviderStartMarker(intent.marker) }
      : intent.kind === 'anchor-terminal' ? { kind: intent.kind, anchor: parseVerificationActionProviderTerminalAnchor(intent.anchor) }
      : { kind: intent.kind });
  }
  if (owned.signal !== undefined) owned.signal = deepFreeze(parseHostedResumeDispatchSignal(encodeVerificationActionData(owned.signal)));
  if (owned.hostedEnvelope !== undefined) owned.hostedEnvelope = deepFreeze(parseHostedEnvelope(owned.hostedEnvelope));
  return Object.freeze(owned) as Input;
}

class RetainedVerificationActionTransport extends RetainedHistoricalSourceReadFacts implements VerificationActionGitHubProviderTransport {
  constructor(private readonly effectCapability: GitHubApiCapability,
    private readonly providerOrigin: AuthenticatedGitHubJobOrigin, private readonly providerRepository: string) {
    super(effectCapability, providerRepository);
  }

  private current(repositoryName: string): void {
    const observed = assertAuthenticatedGitHubJobOriginCurrent(this.providerOrigin);
    assertGitHubApiCapability(this.effectCapability, this.providerRepository, 'verification-action-provider');
    if (repositoryName !== this.providerRepository || observed.repository !== this.providerRepository) fail('Action transport repository changed.');
  }

  async createRepositoryDispatch(input: Parameters<VerificationActionGitHubProviderTransport['createRepositoryDispatch']>[0]): Promise<void> {
    this.current(input.repository);
    if (input.eventType !== CI_VERIFICATION_ACTION_DISPATCH_TYPE) fail('Action transport event differs.');
    await executeGitHubApiOperation(this.effectCapability, { kind: 'verification-action-dispatch',
      envelope: createVerificationActionRepositoryDispatchClientPayload(input.clientPayload.payload).payload });
    this.current(input.repository);
  }

  async createCommitStatus(input: Parameters<VerificationActionGitHubProviderTransport['createCommitStatus']>[0]): Promise<unknown> {
    this.current(input.repository);
    const actionKey = `sha256:${input.context.slice(VERIFICATION_ACTION_PROVIDER_POLICY.contextPrefix.length)}` as VerificationActionKeyDigest;
    if (verificationActionProviderStatusContext(actionKey) !== input.context) fail('Action transport context differs.');
    const result = await executeGitHubApiOperation(this.effectCapability, { kind: 'verification-action-status',
      actionKey, sha: input.sha, state: input.state, description: input.description, targetUrl: input.targetUrl });
    this.current(input.repository);
    return result;
  }
}

async function withNativeActionProviderTransport<Result>(origin: AuthenticatedGitHubJobOrigin,
  effects: boolean, operation: (transport: VerificationActionGitHubProviderTransport) => Promise<Result>): Promise<Result> {
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (effects) return await withGitHubApiVerificationActionProviderSession({ origin,
    operation: async capability => await operation(new RetainedVerificationActionTransport(capability, origin, observed.repository)) });
  return await withGitHubApiVerificationSession({ repositoryRoot: observed.trustedDriverRoot,
    repository: observed.repository, effect: 'verification-read', deadlineAtUnixMs: observed.originalDeadlineAtUnixMs,
    signal: getAuthenticatedGitHubJobOriginSignal(origin), operation: async capability => {
      const read = new RetainedHistoricalSourceReadFacts(capability, observed.repository);
      const transport: VerificationActionGitHubProviderTransport = Object.assign(read, {
        createRepositoryDispatch: async (): Promise<void> => { fail('Read-only Action observation cannot dispatch.'); },
        createCommitStatus: async (): Promise<unknown> => { fail('Read-only Action observation cannot publish status.'); }
      });
      const result = await operation(transport);
      assertAuthenticatedGitHubJobOriginCurrent(origin);
      return result;
    }
  });
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) fail(`${label} is invalid.`);
  return value;
}





function digest(value: unknown): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function bytesDigest(value: Uint8Array): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function repository(value: string): string {
  if (!/^[^/\s]+\/[^/\s]+$/u.test(value)) fail('repository is invalid.');
  return value;
}

function sha(value: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) fail('exact SHA is invalid.');
  return value;
}

async function readGitHubExactCommitStatusHistory(
  transport: GitHubExactCommitStatusReadFacts,
  input: Readonly<{ repository: string; sha: string; providerContext: string }>
): Promise<GitHubExactCommitStatusHistory> {
  const expectedRepository = repository(input.repository);
  const expectedSha = sha(input.sha);
  if (!/^[\x21-\x7e]{1,100}$/u.test(input.providerContext) ||
      input.providerContext !== input.providerContext.toLowerCase()) {
    fail('provider status context is invalid.');
  }
  const pageDigests: VerificationActionKeyDigest[] = [];
  const statuses: GitHubExactCommitStatusObservation[] = [];
  const statusIds = new Set<number>();
  const statusNodeIds = new Set<string>();
  let leadingBoundaryFingerprint: VerificationActionKeyDigest | null = null;
  const assertPage = (response: GitHubExactCommitStatusPage, page: number): void => {
    if (response === null || typeof response !== 'object' || !Array.isArray(response.records) ||
        typeof response.hasNextPage !== 'boolean' || response.records.length > 100 ||
        (response.hasNextPage && response.records.length !== 100) ||
        !/^sha256:[0-9a-f]{64}$/u.test(response.rawResponseDigest)) {
      fail(`status page ${page} is incomplete or malformed.`);
    }
  };
  const boundaryFingerprint = (response: GitHubExactCommitStatusPage): VerificationActionKeyDigest =>
    digest({ schema: 'sec-github-exact-commit-status-leading-boundary-v1', perPage: 100,
      rawResponseDigest: response.rawResponseDigest, hasNextPage: response.hasNextPage });
  for (let page = 1; page <= 1000; page += 1) {
    const response = await transport.listCommitStatusesPage({
      repository: expectedRepository,
      sha: expectedSha,
      perPage: 100,
      page
    });
    assertPage(response, page);
    if (page === 1) leadingBoundaryFingerprint = boundaryFingerprint(response);
    pageDigests.push(digest({ page, perPage: 100, rawResponseDigest: response.rawResponseDigest,
      records: response.records, hasNextPage: response.hasNextPage }));
    for (const [index, entry] of response.records.entries()) {
      const status = normalizeStatus(entry, expectedSha,
        `status page ${page}[${index}]`, input.providerContext);
      if (statusIds.has(status.id) || statusNodeIds.has(status.nodeId)) {
        fail('complete status history contains a duplicate status identity.');
      }
      statusIds.add(status.id);
      statusNodeIds.add(status.nodeId);
      statuses.push(status);
    }
    if (!response.hasNextPage) {
      const stableBoundary = await transport.listCommitStatusesPage({
        repository: expectedRepository,
        sha: expectedSha,
        perPage: 100,
        page: 1
      });
      assertPage(stableBoundary, 1);
      const stableBoundaryFingerprint = boundaryFingerprint(stableBoundary);
      if (leadingBoundaryFingerprint === null ||
          stableBoundaryFingerprint !== leadingBoundaryFingerprint) {
        fail('commit status history leading boundary changed during offset pagination.');
      }
      pageDigests.push(digest({
        schema: 'sec-github-exact-commit-status-stable-boundary-evidence-v1',
        leadingBoundaryFingerprint,
        stableBoundaryFingerprint
      }));
      const withoutDigest = Object.freeze({
        schema: GITHUB_EXACT_COMMIT_STATUS_HISTORY_SCHEMA,
        repository: expectedRepository,
        sha: expectedSha,
        perPage: 100 as const,
        paginationComplete: true as const,
        pageDigests: Object.freeze(pageDigests),
        statuses: Object.freeze(statuses)
      });
      return Object.freeze({ ...withoutDigest, readbackDigest: digest(withoutDigest) });
    }
  }
  fail('status pagination exceeded the bounded 1000-page census.');
}

function sameStatusRequest(
  status: GitHubExactCommitStatusObservation,
  request: Readonly<{
    sha: string;
    state: GitHubExactCommitStatusState;
    context: string;
    description: string;
    targetUrl: string;
  }>
): boolean {
  return status.commitSha === request.sha && status.state === request.state &&
    status.context.toLowerCase() === request.context.toLowerCase() &&
    status.description === request.description && status.targetUrl === request.targetUrl;
}

function providerStatus(
  status: GitHubExactCommitStatusObservation,
  label: string
): GitHubExactCommitStatusProviderObservation {
  if (typeof status.description !== 'string' || typeof status.targetUrl !== 'string') {
    fail(`${label} optional fields are invalid.`);
  }
  return status as GitHubExactCommitStatusProviderObservation;
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function ambiguous(
  readback: GitHubExactCommitStatusHistory,
  reason: string
): GitHubExactCommitStatusPublishResult {
  return Object.freeze({
    disposition: 'ambiguous',
    newlyCreatedByThisInvocation: false,
    status: null,
    readback,
    reason
  });
}

async function publishGitHubExactCommitStatusOnce(
  transport: GitHubExactCommitStatusTransport,
  input: Readonly<{
    repository: string;
    sha: string;
    state: GitHubExactCommitStatusState;
    context: string;
    description: string;
    targetUrl: string;
    expectedContextStatusIds: readonly number[];
  }>
): Promise<GitHubExactCommitStatusPublishResult> {
  const expectedRepository = repository(input.repository);
  const expectedSha = sha(input.sha);
  if (!['error', 'failure', 'pending', 'success'].includes(input.state) ||
      !/^[\x21-\x7e]{1,100}$/u.test(input.context) || input.context !== input.context.toLowerCase() ||
      input.description.length < 1 || input.description.length > 140 ||
      !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*$/u
        .test(input.targetUrl) ||
      input.expectedContextStatusIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(input.expectedContextStatusIds).size !== input.expectedContextStatusIds.length) {
    fail('status publication request is invalid.');
  }
  const request = Object.freeze({
    repository: expectedRepository,
    sha: expectedSha,
    state: input.state,
    context: input.context,
    description: input.description,
    targetUrl: input.targetUrl
  });
  const before = await readGitHubExactCommitStatusHistory(transport, {
    ...request,
    providerContext: request.context
  });
  const inContext = before.statuses.filter((status) =>
    status.context.toLowerCase() === request.context.toLowerCase()
  );
  const matching = inContext.filter((status) => sameStatusRequest(status, request));
  if (matching.length > 1) return ambiguous(before, 'multiple exact statuses already exist');
  if (matching.length === 1) {
    const expectedWithExisting = [...input.expectedContextStatusIds, matching[0]!.id];
    if (!sameIds(inContext.map((entry) => entry.id), input.expectedContextStatusIds) &&
        !sameIds(inContext.map((entry) => entry.id), expectedWithExisting)) {
      return ambiguous(before, 'existing exact status is accompanied by an unexpected context history');
    }
    return Object.freeze({
      disposition: 'existing',
      newlyCreatedByThisInvocation: false,
      status: matching[0]!,
      readback: before,
      reason: null
    });
  }
  if (!sameIds(inContext.map((entry) => entry.id), input.expectedContextStatusIds)) {
    return ambiguous(before, 'provider state changed before the one-shot status publication');
  }

  let createdRaw: unknown;
  try {
    createdRaw = await transport.createCommitStatus(request);
  } catch (error) {
    return ambiguous(before, `one-shot status POST outcome is unknown: ${boundedError(error)}`);
  }
  let created: GitHubExactCommitStatusObservation;
  try {
    created = providerStatus(
      normalizeStatus(createdRaw, expectedSha, 'created status response', request.context),
      'created status response'
    );
  } catch (error) {
    return ambiguous(before, `one-shot status POST returned malformed bytes: ${boundedError(error)}`);
  }
  if (!sameStatusRequest(created, request)) {
    return ambiguous(before, 'one-shot status POST response differs from the exact request');
  }
  let after: GitHubExactCommitStatusHistory;
  try {
    after = await readGitHubExactCommitStatusHistory(transport, {
      ...request,
      providerContext: request.context
    });
  } catch (error) {
    return ambiguous(before, `post-publication full readback is unknown: ${boundedError(error)}`);
  }
  const afterContext = after.statuses.filter((status) =>
    status.context.toLowerCase() === request.context.toLowerCase()
  );
  const afterExact = afterContext.filter((status) => sameStatusRequest(status, request));
  if (afterExact.length !== 1 || afterExact[0]!.id !== created.id ||
      !sameIds(afterContext.map((entry) => entry.id), [...input.expectedContextStatusIds, created.id])) {
    return ambiguous(after, 'one-shot status did not read back as the sole exact new context record');
  }
  return Object.freeze({
    disposition: 'created',
    newlyCreatedByThisInvocation: true,
    status: afterExact[0]!,
    readback: after,
    reason: null
  });
}

function boundedError(error: unknown): string {
  return failureMessage(error)
    .replace(/[\u0000-\u001f]/gu, ' ')
    .slice(0, 256);
}

function parseRunTarget(targetUrl: string, expectedRepository: string): Readonly<{
  runId: string;
  runAttempt: number;
}> {
  const match = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/u
    .exec(targetUrl);
  if (match === null || match[1] !== expectedRepository) fail('status target URL is not an exact repository run attempt.');
  return Object.freeze({ runId: match[2]!, runAttempt: Number(match[3]) });
}

async function readVerificationActionExactAttemptOrigin(
  transport: VerificationActionGitHubProviderReadFacts,
  input: Readonly<{
    repositoryId: number;
    repository: string;
    runId: string;
    runAttempt: number;
  }>
): Promise<VerificationActionProviderOrigin> {
  if (!Number.isSafeInteger(input.repositoryId) || input.repositoryId < 1
    || !Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1) {
    fail('repository or producing-attempt identity is invalid.');
  }
  const expectedRepository = repository(input.repository);
  const runId = positiveId(input.runId, 'producing run id');
  const run = record(await transport.getWorkflowRunAttempt({
    repository: expectedRepository,
    runId,
    runAttempt: input.runAttempt
  }), 'exact workflow run attempt readback');
  const runRepository = record(run.repository, 'exact workflow run attempt repository');
  if (run.id !== Number(runId) || run.run_attempt !== input.runAttempt ||
      runRepository.id !== input.repositoryId || runRepository.full_name !== expectedRepository ||
      run.path !== '.github/workflows/compiler-pr-validation.yml' ||
      typeof run.head_sha !== 'string' || !/^[0-9a-f]{40}$/u.test(run.head_sha) ||
      run.event !== 'repository_dispatch' || !Number.isSafeInteger(run.check_suite_id) ||
      Number(run.check_suite_id) < 1) {
    fail('exact workflow run attempt does not bind the canonical Action producer origin.');
  }
  const suite = record(await transport.getCheckSuite({
    repository: expectedRepository,
    checkSuiteId: Number(run.check_suite_id)
  }), 'check suite readback');
  const app = record(suite.app, 'check suite app');
  const suiteRepository = record(suite.repository, 'check suite repository');
  const expectedApp = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  if (suite.id !== run.check_suite_id || suite.head_sha !== run.head_sha
    || suiteRepository.id !== input.repositoryId || suiteRepository.full_name !== expectedRepository
    || app.id !== expectedApp.id || app.node_id !== expectedApp.nodeId || app.slug !== expectedApp.slug) {
    fail('workflow run check suite is not owned by the canonical GitHub Actions App.');
  }
  return Object.freeze({
    repositoryId: input.repositoryId,
    repository: expectedRepository,
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${run.head_sha}`,
    workflowSha: run.head_sha,
    runId,
    runAttempt: input.runAttempt,
    appId: expectedApp.id,
    appNodeId: expectedApp.nodeId,
    sourceEvent: 'repository_dispatch'
  });
}

async function readVerificationActionReferencedOrigin(
  transport: VerificationActionGitHubProviderReadFacts,
  input: Readonly<{
    repositoryId: number;
    repository: string;
    targetUrl: string;
  }>
): Promise<VerificationActionProviderOrigin> {
  const expectedRepository = repository(input.repository);
  const target = parseRunTarget(input.targetUrl, expectedRepository);
  return readVerificationActionExactAttemptOrigin(transport, {
    repositoryId: input.repositoryId,
    repository: expectedRepository,
    runId: target.runId,
    runAttempt: target.runAttempt
  });
}

async function readVerificationActionProviderStatusReadback(
  transport: VerificationActionGitHubProviderReadFacts,
  input: Readonly<{
    repositoryId: number;
    repository: string;
    candidateSha: string;
    actionKey: VerificationActionKeyDigest;
  }>
): Promise<VerificationActionProviderStatusReadback> {
  const expectedContext = `sec/action/${input.actionKey.slice(7)}`;
  const history = await readGitHubExactCommitStatusHistory(transport, {
    repository: input.repository,
    sha: input.candidateSha,
    providerContext: expectedContext
  });
  const statuses = await Promise.all(history.statuses
    .filter((status) => status.context.toLowerCase() === expectedContext)
    .map(async (status): Promise<VerificationActionProviderStatusObservation> => {
      const ownedStatus = providerStatus(status, 'provider status readback');
      return Object.freeze({
        ...ownedStatus,
        context: ownedStatus.context,
        referencedOrigin: await readVerificationActionReferencedOrigin(transport, {
          repositoryId: input.repositoryId,
          repository: input.repository,
          targetUrl: ownedStatus.targetUrl
        })
      });
    }));
  return finalizeVerificationActionProviderStatusReadback({
    repositoryId: input.repositoryId,
    repository: input.repository,
    actionKey: input.actionKey,
    candidateSha: input.candidateSha,
    context: expectedContext,
    perPage: 100,
    paginationComplete: true,
    pageDigests: history.pageDigests,
    statuses
  });
}

type VerificationActionGitHubArtifactInventoryEntry = Readonly<{
  artifactId: string;
  artifactName: string;
  expired: boolean;
  runId: string;
}>;

type VerificationActionGitHubArtifactInventory = Readonly<{
  repository: string;
  paginationComplete: true;
  perPage: 100;
  pageDigests: readonly VerificationActionKeyDigest[];
  artifacts: readonly VerificationActionGitHubArtifactInventoryEntry[];
  inventoryDigest: VerificationActionKeyDigest;
}>;

async function readVerificationActionArtifactInventory(
  transport: VerificationActionGitHubProviderReadFacts,
  input: Readonly<{ repository: string }>
): Promise<VerificationActionGitHubArtifactInventory> {
  const expectedRepository = repository(input.repository);
  const pageDigests: VerificationActionKeyDigest[] = [];
  const artifacts: VerificationActionGitHubArtifactInventoryEntry[] = [];
  const artifactIds = new Set<string>();
  const assertPage = (
    response: GitHubProviderArtifactPage,
    page: number,
    frozenTotal: number
  ): void => {
    const expectedCardinality = Math.min(100, Math.max(0, frozenTotal - ((page - 1) * 100)));
    if (response === null || typeof response !== 'object' || !Array.isArray(response.records) ||
        !Number.isSafeInteger(response.totalCount) || response.totalCount < 0 ||
        !/^sha256:[0-9a-f]{64}$/u.test(response.rawResponseDigest) ||
        response.totalCount !== frozenTotal || response.records.length !== expectedCardinality) {
      fail(`artifact inventory page ${page} is incomplete or malformed.`);
    }
  };
  const firstPage = await transport.listArtifactsPage({
    repository: expectedRepository,
    perPage: 100,
    page: 1
  });
  if (firstPage === null || typeof firstPage !== 'object' ||
      !Number.isSafeInteger(firstPage.totalCount) || firstPage.totalCount < 0) {
    fail('artifact inventory page 1 is incomplete or malformed.');
  }
  const frozenTotal = firstPage.totalCount;
  const pageCount = Math.max(1, Math.ceil(frozenTotal / 100));
  if (pageCount > 1000) fail('artifact pagination exceeded the bounded 1000-page census.');
  const leadingBoundaryDigest = firstPage.rawResponseDigest;
  for (let page = 1; page <= pageCount; page += 1) {
    const response = page === 1 ? firstPage : await transport.listArtifactsPage({
      repository: expectedRepository,
      perPage: 100,
      page
    });
    assertPage(response, page, frozenTotal);
    pageDigests.push(digest({ page, perPage: 100, totalCount: frozenTotal,
      rawResponseDigest: response.rawResponseDigest }));
    for (const [index, raw] of response.records.entries()) {
      const entry = record(raw, `artifact inventory page ${page}[${index}]`);
      const workflowRun = record(entry.workflow_run, `artifact inventory page ${page}[${index}].workflow_run`);
      if (!Number.isSafeInteger(entry.id) || Number(entry.id) < 1 ||
          typeof entry.expired !== 'boolean' || !Number.isSafeInteger(workflowRun.id) ||
          Number(workflowRun.id) < 1) {
        fail(`artifact inventory page ${page}[${index}] fields are invalid.`);
      }
      const artifactName = artifactInventoryName(entry.name,
        `artifact inventory page ${page}[${index}].name`);
      const artifactId = String(entry.id);
      if (artifactIds.has(artifactId)) fail('artifact inventory repeats one provider artifact id.');
      artifactIds.add(artifactId);
      artifacts.push(Object.freeze({
        artifactId,
        artifactName,
        expired: entry.expired,
        runId: String(workflowRun.id)
      }));
    }
  }
  if (artifacts.length !== frozenTotal) fail('artifact inventory count differs from its frozen total.');
  const stableBoundary = await transport.listArtifactsPage({
    repository: expectedRepository,
    perPage: 100,
    page: 1
  });
  assertPage(stableBoundary, 1, frozenTotal);
  if (stableBoundary.totalCount !== frozenTotal || stableBoundary.rawResponseDigest !== leadingBoundaryDigest) {
    fail('artifact inventory total or leading boundary changed during offset pagination.');
  }
  pageDigests.push(digest({
    schema: 'sec-github-artifact-inventory-stable-boundary-evidence-v2',
    totalCount: frozenTotal,
    leadingBoundaryDigest,
    stableBoundaryDigest: stableBoundary.rawResponseDigest
  }));
  const withoutDigest = Object.freeze({
    repository: expectedRepository,
    paginationComplete: true as const,
    perPage: 100 as const,
    pageDigests: Object.freeze(pageDigests),
    artifacts: Object.freeze(artifacts)
  });
  return Object.freeze({ ...withoutDigest, inventoryDigest: digest(withoutDigest) });
}

async function readVerificationActionArtifactObservation<TPayload>(
  transport: VerificationActionGitHubProviderReadFacts,
  input: Readonly<{
    repositoryId: number;
    repository: string;
    artifactId: string;
    expectedArtifactName: string;
    expectedFileName: string;
    parsePayload: (source: unknown) => TPayload;
    producingOrigin: (payload: TPayload) => VerificationActionProviderOrigin;
  }>
): Promise<VerificationActionProviderArtifactObservation<TPayload>> {
  if (!/^[1-9][0-9]*$/u.test(input.artifactId) ||
      !/^[a-z0-9][a-z0-9-]*$/u.test(input.expectedArtifactName) ||
      !/^[a-z0-9][a-z0-9.-]*\.json$/u.test(input.expectedFileName)) {
    fail('artifact observation request is invalid.');
  }
  const metadata = record(await transport.getArtifact({
    repository: repository(input.repository),
    artifactId: input.artifactId
  }), 'artifact metadata');
  const workflowRun = record(metadata.workflow_run, 'artifact workflow run');
  if (metadata.id !== Number(input.artifactId) || metadata.name !== input.expectedArtifactName ||
      typeof metadata.expired !== 'boolean' || !Number.isSafeInteger(workflowRun.id) ||
      Number(workflowRun.id) < 1) {
    fail('artifact metadata identity mismatch.');
  }
  if (metadata.expired) {
    return Object.freeze({
      originId: input.artifactId,
      artifactName: input.expectedArtifactName,
      archiveDigest: null,
      expired: true,
      payload: null,
      referencedOrigin: null
    });
  }
  const download = await transport.downloadArtifact({
    repository: input.repository,
    artifactId: input.artifactId, artifactName: input.expectedArtifactName,
    runId: String(workflowRun.id), archiveDigest: typeof metadata.digest === 'string' ? metadata.digest : null,
    projection: sourceArtifactProjectionForFile(input.expectedFileName)
  });
  if (!(download.archiveBytes instanceof Uint8Array) ||
      Object.keys(download.files).length !== 1 ||
      typeof download.files[input.expectedFileName] !== 'string') {
    fail('artifact archive does not contain exactly the canonical payload file.');
  }
  const payload = input.parsePayload(JSON.parse(download.files[input.expectedFileName]!));
  const payloadOrigin = input.producingOrigin(payload);
  if (payloadOrigin.repositoryId !== input.repositoryId || payloadOrigin.repository !== input.repository
    || payloadOrigin.runId !== String(workflowRun.id)) {
    fail('artifact payload producing origin differs from its immutable metadata identity.');
  }
  const origin = await readVerificationActionExactAttemptOrigin(transport, {
    repositoryId: input.repositoryId,
    repository: input.repository,
    runId: payloadOrigin.runId,
    runAttempt: payloadOrigin.runAttempt
  });
  if (!canonicalEquals(origin, payloadOrigin)) {
    fail('artifact payload producing origin differs from its exact attempt readback.');
  }
  await assertVerificationActionArtifactPublisher(transport, {
    origin, metadata, fileName: input.expectedFileName
  });
  return Object.freeze({
    originId: input.artifactId,
    artifactName: input.expectedArtifactName,
    archiveDigest: bytesDigest(download.archiveBytes),
    expired: false,
    payload,
    referencedOrigin: origin
  });
}

/** Metadata identifies a run, not its writer job. Only these original closed
 * slots may supply Action, Session or outcome data; returned facts create no live authority. */
async function assertVerificationActionArtifactPublisher(transport: VerificationActionGitHubProviderReadFacts,
  input: Readonly<{ origin: VerificationActionProviderOrigin; metadata: Record<string, unknown>; fileName: string }>
): Promise<Readonly<{ jobId: string; status: string; conclusion: unknown }>> {
  const selected = input.fileName === VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE
    ? { jobId: 'claim-verification-action', slot: 'start' }
    : input.fileName === VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE
      ? { jobId: 'assemble-verification-action-terminal', slot: 'terminal' }
      : input.fileName === VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE
        ? { jobId: 'assemble-verification-action-terminal', slot: 'anchor' }
        : input.fileName === 'hosted-action-resolution.json'
          ? { jobId: 'resolve-verification-action', slot: 'resolution' }
          : input.fileName === 'verification-session-artifact.json'
            ? { jobId: 'receive-verification-session-resume', slot: 'session' }
            : input.fileName === HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE
              ? { jobId: 'receive-verification-session-resume', slot: 'resume-outcomes' } : null;
  if (selected === null) fail('Action artifact has no closed publisher slot.');
  // Outcome observations retain their original ended success-or-failure phase
  // policy. Their job conclusion does not issue an Effect or retry permission.
  const outcomeCarrier = selected.slot === 'resume-outcomes';
  const { origin } = input;
  if (record(input.metadata.workflow_run, 'Action artifact run').head_sha !== origin.workflowSha) {
    fail('Action artifact metadata source differs from its immutable producing attempt.');
  }
  const workflow = await transport.getCanonicalHostedWorkflowSource({ repository: origin.repository, revision: origin.workflowSha });
  assertCiVerificationPerJobHostedWholeWorkflowShape(workflow);
  const policy = assertCiVerificationPerJobHostedWorkflowShape(workflow, selected.jobId);
  if (policy.workflowPath !== origin.workflowPath) fail('Action artifact publisher source workflow differs.');
  const jobs = await readCompleteParentJobs(transport, origin.repository, origin.runId, origin.runAttempt);
  const matches = jobs.filter(job => job.name === policy.jobName);
  const job = matches.length === 1 ? matches[0]! : undefined;
  if (job === undefined || job.head_sha !== origin.workflowSha || !['in_progress', 'completed'].includes(String(job.status))) {
    fail('Action artifact publisher is not one exact source-defined job.');
  }
  const uploads = policy.stages.filter(stage => stage.kind === 'upload').filter(stage => stage.slot === selected.slot);
  const producers = policy.stages.filter(stage => stage.kind === 'phase')
    .filter(stage => uploads.length === 1 && stage.stepId === uploads[0]!.producerStepId);
  if (uploads.length !== 1 || producers.length !== 1 || !Array.isArray(job.steps) || job.steps.length > 100) {
    fail('Action artifact publisher has no unique closed producer/upload pair.');
  }
  const steps = job.steps.map((entry, index) => record(entry, `Action artifact publisher step[${index}]`));
  const producer = steps.filter(step => step.name === producers[0]!.stepName);
  const upload = steps.filter(step => step.name === uploads[0]!.stepName);
  if (steps.some(step => !Number.isSafeInteger(step.number) || Number(step.number) < 1 || Number(step.number) > 100)
      || new Set(steps.map(step => step.number)).size !== steps.length
      || producer.length !== 1 || upload.length !== 1
      || producer[0]!.status !== 'completed'
      || (producer[0]!.conclusion !== 'success' && !(outcomeCarrier && producer[0]!.conclusion === 'failure'))
      || upload[0]!.status !== 'completed' || upload[0]!.conclusion !== 'success'
      || Number(producer[0]!.number) >= Number(upload[0]!.number)) {
    fail('Action artifact producer/upload steps are absent, ambiguous, unsuccessful or unordered.');
  }
  const time = (value: unknown): number => providerArtifactTime(value, 'Action artifact');
  const jobStarted = time(job.started_at), deadline = jobStarted + policy.maximumJobDurationMs;
  const producerStarted = time(producer[0]!.started_at), producerCompleted = time(producer[0]!.completed_at);
  const uploadStarted = time(upload[0]!.started_at), uploadCompleted = time(upload[0]!.completed_at);
  const created = time(input.metadata.created_at), updated = time(input.metadata.updated_at);
  if (!Number.isSafeInteger(deadline) || producerStarted < jobStarted || producerCompleted < producerStarted
      || uploadStarted < producerCompleted || uploadCompleted < uploadStarted || uploadCompleted > deadline
      || created < uploadStarted || updated < created || updated > uploadCompleted) {
    fail('Action artifact is outside its source-defined producer/upload window.');
  }
  // A later failure/cancellation/timeout must not erase a successful immutable
  // upload needed for start/terminal/anchor recovery. Only that upload must fit
  // the original job budget; subsequent job settlement may occur later.
  if (job.status === 'completed') {
    if ((!outcomeCarrier && !['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral'].includes(String(job.conclusion)))
        || time(job.completed_at) < uploadCompleted) {
      fail('Action artifact publisher completion contradicts its successful upload.');
    }
  } else if (job.conclusion !== null || job.completed_at !== null) {
    fail('Action artifact active publisher already has terminal facts.');
  }
  return Object.freeze({ jobId: String(job.id), status: String(job.status), conclusion: job.conclusion });
}

type VerificationActionGitHubProviderResolution = Readonly<{
  repositoryId: number;
  repository: string;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  executionEnvironmentRevision: string;
}>;

export type VerificationActionGitHubProviderAuthority = Readonly<{
  envelope: CiVerificationActionProviderEnvelope;
  actionPlanClosure: CiVerificationActionPlanClosure;
}>;

export type VerificationActionGitHubProviderIntent =
  | Readonly<{ kind: 'coordinate-parent' }>
  | Readonly<{ kind: 'dispatch-child' }>
  | Readonly<{ kind: 'coordinate' }>
  | Readonly<{
    kind: 'claim-start';
    marker: VerificationActionProviderStartMarker;
  }>
  | Readonly<{
    kind: 'anchor-terminal';
    anchor: VerificationActionProviderTerminalAnchor;
  }>;

export type VerificationActionGitHubProviderSnapshot = Readonly<{
  statusReadback: VerificationActionProviderStatusReadback;
  artifactInventory: VerificationActionGitHubArtifactInventory;
  startObservations: readonly VerificationActionProviderArtifactObservation<
    VerificationActionProviderStartMarker
  >[];
  terminalObservations: readonly VerificationActionProviderArtifactObservation<unknown>[];
  terminalAnchorObservations: readonly VerificationActionProviderArtifactObservation<
    VerificationActionProviderTerminalAnchor
  >[];
}>;

export type VerificationActionGitHubProviderTransactionResult = Readonly<{
  disposition: 'blocked' | 'started' | 'terminal-anchored' | 'repair' | 'complete' | 'observed' | 'dispatched';
  actionKey: VerificationActionKeyDigest;
  newlyCreatedByThisInvocation: boolean;
  status: VerificationActionProviderStatusObservation | null;
  snapshot: VerificationActionGitHubProviderSnapshot;
  reason: string | null;
}>;

function canonicalEquals(left: unknown, right: unknown): boolean {
  return encodeVerificationActionData(left) === encodeVerificationActionData(right);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0 || /[\u0000-\u001f]/u.test(value)) {
    fail(`trusted runtime environment ${name} is unavailable.`);
  }
  return value;
}

function identityRecord(value: unknown, expected: Readonly<{
  login: string;
  id: number;
  nodeId: string;
  type: string;
}>, label: string): void {
  const actual = record(value, label);
  if (actual.login !== expected.login || actual.id !== expected.id ||
      actual.node_id !== expected.nodeId || actual.type !== expected.type) {
    fail(`${label} is not the canonical GitHub principal.`);
  }
}

async function readCompleteParentJobs(
  transport: VerificationActionGitHubProviderReadFacts,
  repositoryName: string,
  runId: string,
  runAttempt: number
): Promise<readonly Record<string, unknown>[]> {
  const jobs: Record<string, unknown>[] = [];
  const seenJobIds = new Set<number>();
  let frozenTotal: number | undefined;
  let leadingDigest: VerificationActionKeyDigest | undefined;
  const assertPage = (response: GitHubProviderJobPage, page: number): void => {
    if (!Number.isSafeInteger(response.totalCount) || response.totalCount < 0 || response.totalCount > 100_000
        || (frozenTotal !== undefined && response.totalCount !== frozenTotal)
        || !Array.isArray(response.records)
        || response.records.length !== Math.min(100, Math.max(0, response.totalCount - (page - 1) * 100))
        || !/^sha256:[0-9a-f]{64}$/u.test(response.responseDigest)) {
      fail(`parent workflow job page ${page} is incomplete or changed.`);
    }
  };
  for (let page = 1; page <= 1000; page += 1) {
    const response = await transport.listWorkflowJobsPage({
      repository: repositoryName,
      runId,
      runAttempt,
      page
    });
    assertPage(response, page);
    if (frozenTotal === undefined) {
      frozenTotal = response.totalCount;
      leadingDigest = response.responseDigest;
    }
    for (const [index, entry] of response.records.entries()) {
      const job = record(entry, `parent workflow job page ${page}[${index}]`);
      // The native transport selected the exact attempt endpoint. GitHub may
      // omit the job's run_attempt; a present contradictory value cannot rebind it.
      if (!Number.isSafeInteger(job.id) || Number(job.id) < 1 || seenJobIds.has(Number(job.id))
          || job.run_id !== Number(runId) || ('run_attempt' in job && job.run_attempt !== runAttempt)) {
        fail('parent workflow job census has duplicated or foreign immutable identities.');
      }
      seenJobIds.add(Number(job.id));
      jobs.push(job);
    }
    if (jobs.length === frozenTotal) {
      const boundary = await transport.listWorkflowJobsPage({ repository: repositoryName, runId, runAttempt, page: 1 });
      assertPage(boundary, 1);
      if (boundary.responseDigest !== leadingDigest) fail('parent workflow job census changed during pagination.');
      return Object.freeze(jobs);
    }
  }
  fail('parent workflow job pagination exceeded the bounded 1000-page census.');
}

function providerArtifactTime(value: unknown, label: string): number {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isSafeInteger(time) || time < 1) fail(`${label} provider timestamp is invalid.`);
  return time;
}

/** Data predicate over an already authenticated exact source/job/archive.
 * The native source and parent authority readers remain the sole issuers. */
function assertParentPlanArtifactUploadWindow(input: Readonly<{
  policy: CiVerificationPerJobHostedJobPolicy; job: Record<string, unknown>;
  metadata: Record<string, unknown>; expectedProducerStepName: string;
}>): void {
  const uploads = input.policy.stages.filter(stage => stage.kind === 'upload').filter(stage => stage.slot === 'parent-plan');
  const producers = input.policy.stages.filter(stage => stage.kind === 'phase')
    .filter(stage => stage.phase === 'prepare-parent-plan');
  if (uploads.length !== 1 || producers.length !== 1
      || uploads[0]!.producerStepId !== producers[0]!.stepId
      || producers[0]!.stepName !== input.expectedProducerStepName
      || !Array.isArray(input.job.steps) || input.job.steps.length > 100) {
    fail('parent plan has no exact canonical producer/upload stages.');
  }
  const steps = input.job.steps.map((entry, index) => record(entry, `parent plan job step[${index}]`));
  const producer = steps.filter(step => step.name === producers[0]!.stepName);
  const upload = steps.filter(step => step.name === uploads[0]!.stepName);
  if (steps.some(step => !Number.isSafeInteger(step.number) || Number(step.number) < 1 || Number(step.number) > 100)
      || new Set(steps.map(step => step.number)).size !== steps.length
      || producer.length !== 1 || upload.length !== 1
      || producer[0]!.status !== 'completed' || producer[0]!.conclusion !== 'success'
      || upload[0]!.status !== 'completed' || upload[0]!.conclusion !== 'success'
      || Number(producer[0]!.number) >= Number(upload[0]!.number)) {
    fail('parent plan producer/upload step order is absent, ambiguous or unsuccessful.');
  }
  const time = (value: unknown): number => providerArtifactTime(value, 'parent plan');
  const jobStarted = time(input.job.started_at);
  const deadline = jobStarted + input.policy.maximumJobDurationMs;
  const producerStarted = time(producer[0]!.started_at);
  const producerCompleted = time(producer[0]!.completed_at);
  const uploadStarted = time(upload[0]!.started_at);
  const uploadCompleted = time(upload[0]!.completed_at);
  const created = time(input.metadata.created_at);
  const updated = time(input.metadata.updated_at);
  if (!Number.isSafeInteger(deadline) || producerStarted < jobStarted || producerCompleted < producerStarted
      || uploadStarted < producerCompleted || uploadCompleted < uploadStarted || uploadCompleted > deadline
      || created < uploadStarted || updated < created || updated > uploadCompleted) {
    fail('parent plan artifact is outside its original producer/upload window.');
  }
  if (input.job.status === 'completed') {
    const completed = time(input.job.completed_at);
    if (completed < uploadCompleted || completed > deadline) fail('parent plan job completion differs from its original lifetime.');
  } else if (input.job.completed_at !== null || input.job.conclusion !== null) {
    fail('parent plan active job already has terminal facts.');
  }
}

async function authenticateReferencedParentAuthority(
  transport: VerificationActionGitHubProviderReadFacts,
  authority: VerificationActionGitHubProviderAuthority,
  authenticatedRepository: Readonly<{ repositoryName: string; repositoryId: number; repositoryIdText: string }>
) {
  const { repositoryName, repositoryId, repositoryIdText } = authenticatedRepository;
  const envelope = parseCiVerificationActionProviderEnvelope(authority.envelope);
  const closure = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(authority.actionPlanClosure)
  );
  const request = parseVerificationSessionHostedRequest(encodeVerificationActionData(envelope.proposal.sessionRequest));
  if (request.expectedActionPlanDigest !== closure.actionPlanDigest ||
      typeof request.expectedBaseSha !== 'string' || !/^[0-9a-f]{40}$/u.test(request.expectedBaseSha) ||
      !Number.isSafeInteger(request.prNumber) || Number(request.prNumber) < 1 ||
      typeof request.expectedSessionRevision !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(request.expectedSessionRevision)) {
    fail('embedded Session request does not bind the supplied Action closure and trusted base.');
  }
  const matchingPlans = closure.actions.map((plan, index) => ({ plan, index })).filter(({ plan }) =>
    plan.action.actionKey === envelope.proposal.proposedActionKey
  );
  if (matchingPlans.length !== 1) fail('proposal ActionKey is not one exact member of the Action closure.');
  const matchingOperation = closure.normalizedOperations[matchingPlans[0]!.index];
  if (matchingOperation === undefined) fail('proposal Action has no normalized operation member.');

  const repositoryReadback = record(await transport.getRepository({ repository: repositoryName }),
    'repository readback');
  if (String(repositoryReadback.id ?? '') !== repositoryIdText ||
      repositoryReadback.full_name !== repositoryName || repositoryReadback.default_branch !== 'main') {
    fail('repository readback differs from the trusted runtime identity.');
  }

  const inventory = await readVerificationActionArtifactInventory(transport, {
    repository: repositoryName
  });
  const parentArtifacts = inventory.artifacts.filter((entry) =>
    entry.artifactName === envelope.parentDispatchPlanArtifactName
  );
  if (parentArtifacts.length !== 1 ||
      parentArtifacts[0]!.artifactId !== envelope.parentDispatchPlanArtifactId ||
      parentArtifacts[0]!.runId !== envelope.parentRunId || parentArtifacts[0]!.expired) {
    fail('parent dispatch plan artifact is not one unique current provider origin.');
  }
  const parentMetadata = record(await transport.getArtifact({
    repository: repositoryName,
    artifactId: envelope.parentDispatchPlanArtifactId
  }), 'parent dispatch plan artifact metadata');
  const parentMetadataRun = record(parentMetadata.workflow_run, 'parent artifact workflow run');
  if (parentMetadata.id !== Number(envelope.parentDispatchPlanArtifactId) ||
      parentMetadata.name !== envelope.parentDispatchPlanArtifactName || parentMetadata.expired !== false ||
      String(parentMetadataRun.id ?? '') !== envelope.parentRunId || parentMetadataRun.head_sha !== request.expectedBaseSha) {
    fail('parent dispatch plan artifact metadata differs from its envelope.');
  }
  const parentDownload = await transport.downloadArtifact({
    repository: repositoryName,
    artifactId: envelope.parentDispatchPlanArtifactId, artifactName: envelope.parentDispatchPlanArtifactName,
    runId: envelope.parentRunId, archiveDigest: typeof parentMetadata.digest === 'string' ? parentMetadata.digest : null,
    projection: 'action-parent-plan'
  });
  const parentSource = parentDownload.files[CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE];
  if (bytesDigest(parentDownload.archiveBytes) !== envelope.parentDispatchPlanArchiveDigest ||
      Object.keys(parentDownload.files).length !== 1 || typeof parentSource !== 'string') {
    fail('parent dispatch plan archive bytes differ from the authenticated envelope.');
  }
  const parentPlan = parseCiVerificationActionParentDispatchPlan(JSON.parse(parentSource) as unknown);
  const canonicalParentSource = `${encodeVerificationActionData(parentPlan)}\n`;
  if (parentSource !== canonicalParentSource ||
      ciVerificationActionParentDispatchPlanPayloadDigest(parentPlan) !==
        envelope.parentDispatchPlanPayloadDigest ||
      bytesDigest(Buffer.from(parentSource, 'utf8')) !== envelope.parentDispatchPlanPayloadDigest) {
    fail('parent dispatch plan payload is not the exact canonical line and digest.');
  }
  assertCiVerificationActionProviderEnvelopeMember(envelope, parentPlan);
  if (parentPlan.repository !== repositoryName || parentPlan.repositoryId !== repositoryIdText ||
      parentPlan.parentWorkflowSha !== request.expectedBaseSha ||
      parentPlan.parentWorkflowRef !==
        `${repositoryName}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`) {
    fail('parent dispatch plan repository or trusted-base identity differs from the Session request.');
  }

  const parentRun = record(await transport.getWorkflowRun({
    repository: repositoryName,
    runId: envelope.parentRunId
  }), 'parent external Session run');
  identityRecord(parentRun.actor, parentPlan.parentActor, 'parent external Session actor');
  const expectedParentTitle =
    `verify session PR #${request.prNumber} session ${request.expectedSessionRevision}`;
  if (String(parentRun.id ?? '') !== envelope.parentRunId ||
      parentRun.run_attempt !== envelope.parentRunAttempt ||
      !matchesCiCompilerWorkflowRunIdentity({
        workflowPath: parentRun.path,
        eventName: parentRun.event,
        displayTitle: parentRun.display_title,
        headSha: parentRun.head_sha,
        expectedDisplayTitle: expectedParentTitle,
        expectedHeadSha: request.expectedBaseSha
      }) || parentRun.path !== envelope.parentWorkflowPath ||
      parentRun.head_branch !== 'main' ||
      String(record(parentRun.repository, 'parent run repository').id ?? '') !== repositoryIdText) {
    fail('parent external Session run provenance mismatch.');
  }
  const parentOrigin = await readVerificationActionReferencedOrigin(transport, {
    repositoryId,
    repository: repositoryName,
    targetUrl: `https://github.com/${repositoryName}/actions/runs/${envelope.parentRunId}` +
      `/attempts/${envelope.parentRunAttempt}`
  });
  if (parentOrigin.workflowSha !== request.expectedBaseSha) {
    fail('parent artifact workflow origin is not the trusted base.');
  }
  const permission = record(await transport.getPrincipalPermission({
    repository: repositoryName,
    login: parentPlan.parentActor.login
  }), 'parent actor live permission');
  identityRecord(permission.user, parentPlan.parentActor, 'parent actor live identity');
  if (normalizeGitHubRepositoryPermission(permission) !== parentPlan.parentActor.permission) {
    fail('parent actor live permission differs from the dispatch plan.');
  }
  const jobs = await readCompleteParentJobs(
    transport, repositoryName, envelope.parentRunId, envelope.parentRunAttempt
  );
  const parentJobs = jobs.filter((job) => String(job.id ?? '') === envelope.parentJobId);
  if (parentJobs.length !== 1 || parentJobs[0]!.name !== envelope.parentJobName ||
      String(parentJobs[0]!.run_id ?? '') !== envelope.parentRunId ||
      parentJobs[0]!.head_sha !== request.expectedBaseSha ||
      !['in_progress', 'completed'].includes(String(parentJobs[0]!.status)) ||
      (parentJobs[0]!.status === 'completed' && parentJobs[0]!.conclusion !== 'success')) {
    fail('parent plan-producing job and step provenance mismatch.');
  }
  const parentWorkflowSource = await transport.getCanonicalHostedWorkflowSource({
    repository: repositoryName, revision: request.expectedBaseSha
  });
  assertCiVerificationPerJobHostedWholeWorkflowShape(parentWorkflowSource);
  const parentPolicy = assertCiVerificationPerJobHostedWorkflowShape(parentWorkflowSource, 'coordinate-verification-session');
  if (parentPolicy.workflowPath !== envelope.parentWorkflowPath || parentPolicy.jobName !== envelope.parentJobName) {
    fail('parent plan canonical source policy differs from its authenticated job.');
  }
  assertParentPlanArtifactUploadWindow({ policy: parentPolicy, job: parentJobs[0]!, metadata: parentMetadata,
    expectedProducerStepName: envelope.parentPlanStepName });

  const expectedApp = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  const parentCheckSuiteId = Number(parentRun.check_suite_id);
  const parentWorkflowId = Number(parentRun.workflow_id);
  if (!Number.isSafeInteger(parentCheckSuiteId) || parentCheckSuiteId < 1 ||
      !Number.isSafeInteger(parentWorkflowId) || parentWorkflowId < 1) {
    fail('parent external Session run lacks workflow/check-suite provenance.');
  }
  const workflow = record(await transport.getWorkflow({ repository: repositoryName, workflowId: parentWorkflowId }),
    'parent current workflow readback');
  if (String(workflow.id ?? '') !== String(parentWorkflowId) ||
      workflow.path !== '.github/workflows/compiler-pr-validation.yml' || workflow.state !== 'active') {
    fail('parent current compiler workflow readback mismatch.');
  }
  const suite = record(await transport.getCheckSuite({
    repository: repositoryName,
    checkSuiteId: parentCheckSuiteId
  }), 'parent current check suite');
  const suiteRepository = record(suite.repository, 'parent current check suite repository');
  const app = record(suite.app, 'parent current check suite App');
  if (String(suite.id ?? '') !== String(parentCheckSuiteId) ||
      suite.head_sha !== request.expectedBaseSha ||
      String(suiteRepository.id ?? '') !== repositoryIdText ||
      suiteRepository.full_name !== repositoryName || app.id !== expectedApp.id ||
      app.node_id !== expectedApp.nodeId || app.slug !== expectedApp.slug) {
    fail('parent current check-suite App/repository/head provenance mismatch.');
  }
  return Object.freeze({
    envelope, closure, originalRequest: request, parentPlan, parentOrigin, parentRun,
    resolution: Object.freeze({
      repositoryId, repository: repositoryName, actionKey: envelope.proposal.proposedActionKey,
      candidateSha: sha(matchingOperation.candidate.headSha),
      executionEnvironmentRevision: resolveCiVerificationHostedExecutionEnvironment(matchingOperation.candidate.executionEnvironmentRevision).executionEnvironmentRevision
    })
  });
}

async function authenticateVerificationActionAuthority(
  transport: VerificationActionGitHubProviderReadFacts,
  authority: VerificationActionGitHubProviderAuthority,
  currentRole: 'parent-session' | 'child-action'
): Promise<Readonly<{
  resolution: VerificationActionGitHubProviderResolution;
  currentOrigin: VerificationActionProviderOrigin;
}>> {
  const envelope = parseCiVerificationActionProviderEnvelope(authority.envelope);
  const request = record(envelope.proposal.sessionRequest, 'embedded Session request');
  const repositoryName = repository(requiredEnvironment('GITHUB_REPOSITORY'));
  const repositoryIdText = requiredEnvironment('GITHUB_REPOSITORY_ID');
  const repositoryId = Number(repositoryIdText);
  const runId = positiveId(requiredEnvironment('GITHUB_RUN_ID'), 'current run id');
  const runAttempt = Number(requiredEnvironment('GITHUB_RUN_ATTEMPT'));
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 1 ||
      !Number.isSafeInteger(runAttempt) || runAttempt < 1 ||
      requiredEnvironment('GITHUB_EVENT_NAME') !== 'repository_dispatch' ||
      requiredEnvironment('GITHUB_SHA') !== request.expectedBaseSha ||
      requiredEnvironment('GITHUB_REF') !== 'refs/heads/main' ||
      requiredEnvironment('GITHUB_WORKFLOW_REF') !==
        `${repositoryName}/.github/workflows/compiler-pr-validation.yml@refs/heads/main` ||
      requiredEnvironment('GITHUB_WORKFLOW_SHA') !== request.expectedBaseSha) {
    fail('current environment is not the exact trusted compiler workflow.');
  }

  const event = record(JSON.parse(readFileSync(requiredEnvironment('GITHUB_EVENT_PATH'), 'utf8')) as unknown,
    'repository dispatch event');
  if (String(record(event.repository, 'event repository').id ?? '') !== repositoryIdText) {
    fail('repository dispatch event repository identity mismatch.');
  }

  const referenced = await authenticateReferencedParentAuthority(transport, authority, {
    repositoryName, repositoryId, repositoryIdText
  });
  const { parentPlan, parentOrigin, resolution } = referenced;
  const expectedApp = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  if (currentRole === 'parent-session') {
    if (runId !== envelope.parentRunId || runAttempt !== envelope.parentRunAttempt ||
        requiredEnvironment('GITHUB_ACTOR') !== parentPlan.parentActor.login ||
        requiredEnvironment('GITHUB_TRIGGERING_ACTOR') !== parentPlan.parentActor.login) {
      fail('current environment is not the exact parent external Session run.');
    }
    identityRecord(event.sender, parentPlan.parentActor, 'parent event sender');
    const expectedParentPayload = Object.freeze({ payload: envelope.proposal.sessionRequest });
    if (event.action !== CI_VERIFICATION_SESSION_DISPATCH_TYPE ||
        !canonicalEquals(event.client_payload, expectedParentPayload)) {
      fail('parent repository dispatch event does not carry the exact Session request.');
    }
    return Object.freeze({ resolution, currentOrigin: parentOrigin });
  }

  identityRecord(event.sender, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, 'child event sender');
  const expectedChildPayload = createVerificationActionRepositoryDispatchClientPayload(envelope);
  if (event.action !== CI_VERIFICATION_ACTION_DISPATCH_TYPE ||
      !canonicalEquals(event.client_payload, expectedChildPayload) || runAttempt !== 1 ||
      requiredEnvironment('GITHUB_ACTOR') !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login ||
      requiredEnvironment('GITHUB_TRIGGERING_ACTOR') !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login) {
    fail('current environment/event is not the exact first-attempt internal Action dispatch.');
  }

  const currentRun = record(await transport.getWorkflowRun({ repository: repositoryName, runId }),
    'current Action run');
  identityRecord(currentRun.actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, 'current run actor');
  const checkSuiteId = Number(currentRun.check_suite_id);
  const workflowId = Number(currentRun.workflow_id);
  if (String(currentRun.id ?? '') !== runId || currentRun.run_attempt !== 1 ||
      !matchesCiCompilerWorkflowRunIdentity({
        workflowPath: currentRun.path,
        eventName: currentRun.event,
        displayTitle: currentRun.display_title,
        headSha: currentRun.head_sha,
        expectedDisplayTitle: `produce Action ${envelope.proposal.proposedActionKey}`,
        expectedHeadSha: request.expectedBaseSha
      }) || currentRun.head_branch !== 'main' ||
      String(record(currentRun.repository, 'current run repository').id ?? '') !== repositoryIdText ||
      !Number.isSafeInteger(checkSuiteId) || checkSuiteId < 1 ||
      !Number.isSafeInteger(workflowId) || workflowId < 1) {
    fail('current Action workflow run provenance mismatch.');
  }
  const workflow = record(await transport.getWorkflow({ repository: repositoryName, workflowId }),
    'current workflow readback');
  if (String(workflow.id ?? '') !== String(workflowId) ||
      workflow.path !== '.github/workflows/compiler-pr-validation.yml' || workflow.state !== 'active') {
    fail('current compiler workflow readback mismatch.');
  }
  const suite = record(await transport.getCheckSuite({ repository: repositoryName, checkSuiteId }),
    'current check suite');
  const suiteRepository = record(suite.repository, 'current check suite repository');
  const app = record(suite.app, 'current check suite App');
  if (String(suite.id ?? '') !== String(checkSuiteId) || suite.head_sha !== request.expectedBaseSha ||
      String(suiteRepository.id ?? '') !== repositoryIdText || suiteRepository.full_name !== repositoryName ||
      app.id !== expectedApp.id || app.node_id !== expectedApp.nodeId || app.slug !== expectedApp.slug) {
    fail('current check-suite App/repository/head provenance mismatch.');
  }

  const currentOrigin = Object.freeze({
    repositoryId,
    repository: repositoryName,
    workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${request.expectedBaseSha}`,
    workflowSha: request.expectedBaseSha,
    runId,
    runAttempt: 1,
    appId: expectedApp.id,
    appNodeId: expectedApp.nodeId,
    sourceEvent: 'repository_dispatch' as const
  });
  return Object.freeze({ resolution, currentOrigin });
}

async function readVerificationActionGitHubProviderSnapshot(
  transport: VerificationActionGitHubProviderReadFacts,
  resolution: VerificationActionGitHubProviderResolution
): Promise<VerificationActionGitHubProviderSnapshot> {
  const statusReadback = await readVerificationActionProviderStatusReadback(transport, {
    repositoryId: resolution.repositoryId,
    repository: resolution.repository,
    candidateSha: resolution.candidateSha,
    actionKey: resolution.actionKey
  });
  const artifactInventory = await readVerificationActionArtifactInventory(transport, {
    repository: resolution.repository
  });
  const startName = verificationActionProviderStartArtifactName(resolution.actionKey);
  const terminalName = verificationActionProviderTerminalArtifactName(resolution.actionKey);
  const terminalAnchorName = verificationActionProviderTerminalAnchorName(resolution.actionKey);
  const startObservations: VerificationActionProviderArtifactObservation<
    VerificationActionProviderStartMarker
  >[] = [];
  const terminalObservations: VerificationActionProviderArtifactObservation<unknown>[] = [];
  const terminalAnchorObservations: VerificationActionProviderArtifactObservation<
    VerificationActionProviderTerminalAnchor
  >[] = [];

  for (const entry of artifactInventory.artifacts) {
    if (entry.artifactName === startName) {
      startObservations.push(await readVerificationActionArtifactObservation(transport, {
        repositoryId: resolution.repositoryId,
        repository: resolution.repository,
        artifactId: entry.artifactId,
        expectedArtifactName: startName,
        expectedFileName: VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE,
        parsePayload: parseVerificationActionProviderStartMarker,
        producingOrigin: (payload) => payload.producer
      }));
    } else if (entry.artifactName === terminalName) {
      terminalObservations.push(await readVerificationActionArtifactObservation(transport, {
        repositoryId: resolution.repositoryId,
        repository: resolution.repository,
        artifactId: entry.artifactId,
        expectedArtifactName: terminalName,
        expectedFileName: VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE,
        parsePayload: (value) => CodexDevelopmentParseVerificationActionTerminalArtifact(
          encodeVerificationActionData(value)
        ),
        producingOrigin: (payload) => payload.producer
      }));
    } else if (entry.artifactName === terminalAnchorName) {
      terminalAnchorObservations.push(await readVerificationActionArtifactObservation(transport, {
        repositoryId: resolution.repositoryId,
        repository: resolution.repository,
        artifactId: entry.artifactId,
        expectedArtifactName: terminalAnchorName,
        expectedFileName: VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE,
        parsePayload: parseVerificationActionProviderTerminalAnchor,
        producingOrigin: (payload) => payload.anchorPublisherOrigin
      }));
    }
  }
  return Object.freeze({
    statusReadback,
    artifactInventory,
    startObservations: Object.freeze(startObservations),
    terminalObservations: Object.freeze(terminalObservations),
    terminalAnchorObservations: Object.freeze(terminalAnchorObservations)
  });
}

function reduceVerificationActionGitHubProviderSnapshot(
  resolution: VerificationActionGitHubProviderResolution,
  snapshot: VerificationActionGitHubProviderSnapshot
) {
  const terminalObservations: VerificationActionProviderTerminalObservation[] =
    snapshot.terminalObservations.map((observation) => {
      if (observation.payload === null) {
        return Object.freeze({ ...observation, payload: null });
      }
      const artifact = CodexDevelopmentParseVerificationActionTerminalArtifact(
        encodeVerificationActionData(observation.payload)
      );
      return Object.freeze({
        ...observation,
        payload: Object.freeze({
          actionKey: artifact.actionPlan.action.actionKey,
          candidateSha: artifact.input.headSha,
          payloadDigest: artifact.artifactDigest as VerificationActionKeyDigest,
          producer: artifact.producer
        })
      });
    });
  return reduceVerificationActionProviderState({
    repositoryId: resolution.repositoryId,
    repository: resolution.repository,
    actionKey: resolution.actionKey,
    candidateSha: resolution.candidateSha,
    executionEnvironmentRevision: resolution.executionEnvironmentRevision,
    statusReadback: snapshot.statusReadback,
    startObservations: snapshot.startObservations,
    terminalObservations,
    terminalAnchorObservations: snapshot.terminalAnchorObservations
  });
}

export function hostedActionResolutionArtifactName(
  actionKey: VerificationActionKeyDigest,
  runId: string,
  runAttempt: number
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey) ||
      !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    fail('hosted Action resolution artifact identity is invalid.');
  }
  return `sec-verification-action-resolution-v2-${actionKey.slice(7)}-run-${positiveId(runId, 'resolution run id')}-attempt-${runAttempt}`;
}

async function readHostedActionResolutionTransport(
  transport: VerificationActionGitHubProviderReadFacts,
  resolution: Pick<VerificationActionGitHubProviderResolution, 'repositoryId' | 'repository' | 'actionKey' | 'candidateSha'>,
  producingOrigin: VerificationActionProviderOrigin
) {
  const artifactName = hostedActionResolutionArtifactName(
    resolution.actionKey, producingOrigin.runId, producingOrigin.runAttempt
  );
  const inventory = await readVerificationActionArtifactInventory(transport, {
    repository: resolution.repository
  });
  const matches = inventory.artifacts.filter((entry) => entry.artifactName === artifactName);
  if (matches.length !== 1 || matches[0]!.expired || matches[0]!.runId !== producingOrigin.runId) {
    fail('hosted Action resolution archive is absent, duplicated, expired, or foreign.');
  }
  const artifactId = matches[0]!.artifactId;
  const metadata = record(await transport.getArtifact({
    repository: resolution.repository, artifactId
  }), 'hosted Action resolution artifact metadata');
  const artifactRun = record(metadata.workflow_run, 'hosted Action resolution artifact run');
  if (metadata.id !== Number(artifactId) || metadata.name !== artifactName ||
      metadata.expired !== false || String(artifactRun.id ?? '') !== producingOrigin.runId ||
      artifactRun.head_sha !== producingOrigin.workflowSha) {
    fail('hosted Action resolution archive metadata differs from the completed Action.');
  }
  const origin = await readVerificationActionExactAttemptOrigin(transport, {
    repositoryId: resolution.repositoryId, repository: resolution.repository,
    runId: producingOrigin.runId, runAttempt: producingOrigin.runAttempt
  });
  if (!canonicalEquals(origin, producingOrigin)) {
    fail('hosted Action resolution producer differs from the completed Action exact attempt.');
  }
  const publisher = await assertVerificationActionArtifactPublisher(transport, {
    origin, metadata, fileName: 'hosted-action-resolution.json'
  });
  // Resolution retains its original completed-success requirement. The shared
  // readback above returns facts about the very same source/job/upload; later
  // failed-job recovery of start/terminal/anchor does not authorize resolution.
  if (publisher.status !== 'completed' || publisher.conclusion !== 'success') {
    fail('hosted Action resolution producing job is not the exact completed successful producer.');
  }
  const download = await transport.downloadArtifact({ repository: resolution.repository, artifactId,
    artifactName, runId: producingOrigin.runId,
    archiveDigest: typeof metadata.digest === 'string' ? metadata.digest : null, projection: 'action-resolution' });
  const members = ['verification-action-provider-envelope.json', 'hosted-action-resolution.json',
    'hosted-envelope.json'] as const;
  if (!(download.archiveBytes instanceof Uint8Array) || Object.keys(download.files).length !== members.length ||
      members.some((name) => typeof download.files[name] !== 'string')) {
    fail('hosted Action resolution archive does not contain exactly its three original members.');
  }
  const archiveDigest = bytesDigest(download.archiveBytes);
  if (metadata.digest !== undefined && metadata.digest !== null &&
      (typeof metadata.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(metadata.digest) ||
       metadata.digest !== archiveDigest)) {
    fail('hosted Action resolution archive digest differs from provider metadata.');
  }
  return Object.freeze({
    artifactId, artifactName, archiveDigest, artifactMetadata: metadata,
    inventoryDigest: inventory.inventoryDigest,
    providerArchiveDigest: typeof metadata.digest === 'string' ? metadata.digest : null,
    producingOrigin: origin, producingJobId: publisher.jobId,
    files: Object.freeze({
      'verification-action-provider-envelope.json': download.files[members[0]]!,
      'hosted-action-resolution.json': download.files[members[1]]!,
      'hosted-envelope.json': download.files[members[2]]!
    })
  });
}

function assertHostedResumeObservationOrigin(origin: AuthenticatedGitHubJobOrigin) {
  const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const sender = current.workflowPath === '.github/workflows/merge-gate.yml' &&
    current.policyJobId === 'integrate' && current.phase === 'resume-verification-session';
  const receiver = current.workflowPath === '.github/workflows/compiler-pr-validation.yml' &&
    current.policyJobId === 'receive-verification-session-resume' &&
    current.phase === 'receive-verification-session-resume';
  if (current.role !== 'control' || current.runAttempt !== 1 || (!sender && !receiver)) {
    fail('current authenticated job phase cannot observe a hosted Session resume.');
  }
  const repositoryName = repository(current.repository);
  const repositoryIdText = current.repositoryId;
  const repositoryId = Number(repositoryIdText);
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 1) {
    fail('authenticated job repository identity is invalid.');
  }
  return Object.freeze({ repositoryName, repositoryIdText, repositoryId });
}

/** Capture authentic archive data before its original parsers reconstruct the
 * referenced closure. This does not admit a terminal, human, Scope or Session. */
export async function readHostedCompletedActionWakeup(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  sourceRunId: string;
  sourceRunAttempt: number;
}>) {
  input = captureActionProviderInput(input);
  return await withNativeActionProviderTransport(input.origin, false, async transport => {
  const origin = input.origin;
  const authenticatedRepository = assertHostedResumeObservationOrigin(origin);
  const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (current.workflowPath !== '.github/workflows/merge-gate.yml' ||
      current.policyJobId !== 'integrate' || current.phase !== 'resume-verification-session' ||
      requiredEnvironment('GITHUB_EVENT_NAME') !== 'workflow_run' ||
      requiredEnvironment('GITHUB_RUN_ID') !== current.runId ||
      requiredEnvironment('GITHUB_RUN_ATTEMPT') !== String(current.runAttempt)) {
    fail('hosted Action wakeup discovery is not the exact current completion-triggered sender.');
  }
  const sourceRunId = positiveId(input.sourceRunId, 'wakeup source run id');
  const sourceRunAttempt = input.sourceRunAttempt;
  if (!Number.isSafeInteger(sourceRunAttempt) || sourceRunAttempt < 1) {
    fail('wakeup source run attempt is invalid.');
  }
  const eventPath = requiredEnvironment('GITHUB_EVENT_PATH');
  const eventSource = readFileSync(eventPath, 'utf8');
  const event = record(JSON.parse(eventSource) as unknown, 'wakeup workflow completion event');
  const eventRepository = record(event.repository, 'wakeup event repository');
  const sourceRun = record(event.workflow_run, 'wakeup event source workflow run');
  const sourceRepository = record(sourceRun.repository, 'wakeup event source repository');
  if (event.action !== 'completed' ||
      String(eventRepository.id ?? '') !== authenticatedRepository.repositoryIdText ||
      eventRepository.full_name !== authenticatedRepository.repositoryName ||
      String(sourceRepository.id ?? '') !== authenticatedRepository.repositoryIdText ||
      sourceRepository.full_name !== authenticatedRepository.repositoryName ||
      String(sourceRun.id ?? '') !== sourceRunId || sourceRun.run_attempt !== sourceRunAttempt ||
      sourceRun.path !== '.github/workflows/compiler-pr-validation.yml' ||
      sourceRun.event !== 'repository_dispatch' || sourceRun.head_branch !== 'main' ||
      sourceRun.status !== 'completed') {
    fail('wakeup source differs from the exact current workflow completion cause.');
  }

  const currentRun = record(await transport.getWorkflowRunAttempt({
    repository: authenticatedRepository.repositoryName,
    runId: current.runId, runAttempt: current.runAttempt
  }), 'wakeup current sender attempt');
  const currentRepository = record(currentRun.repository, 'wakeup current sender repository');
  if (String(currentRun.id ?? '') !== current.runId || currentRun.run_attempt !== current.runAttempt ||
      currentRun.path !== current.workflowPath || currentRun.event !== 'workflow_run' ||
      currentRun.head_sha !== current.workflowSha || currentRun.head_branch !== 'main' ||
      String(currentRepository.id ?? '') !== authenticatedRepository.repositoryIdText ||
      currentRepository.full_name !== authenticatedRepository.repositoryName) {
    fail('wakeup current sender attempt differs from its original authenticated job scope.');
  }
  const sourceOrigin = await readVerificationActionExactAttemptOrigin(transport, {
    repositoryId: authenticatedRepository.repositoryId,
    repository: authenticatedRepository.repositoryName, runId: sourceRunId, runAttempt: sourceRunAttempt
  });
  if (sourceOrigin.workflowSha !== sourceRun.head_sha) {
    fail('wakeup source head differs from the exact completed producer attempt.');
  }
  const inventory = await readVerificationActionArtifactInventory(transport, {
    repository: authenticatedRepository.repositoryName
  });
  const matches = inventory.artifacts.filter((entry) =>
    entry.runId === sourceRunId &&
    entry.artifactName.startsWith(`${VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX}-`)
  );
  if (matches.length !== 1 || matches[0]!.expired) {
    fail('wakeup completed producer has no unique nonexpired terminal archive.');
  }
  const selected = matches[0]!;
  const terminal = await readVerificationActionArtifactObservation(transport, {
    repositoryId: authenticatedRepository.repositoryId,
    repository: authenticatedRepository.repositoryName,
    artifactId: selected.artifactId, expectedArtifactName: selected.artifactName,
    expectedFileName: VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE,
    parsePayload: (value) => CodexDevelopmentParseVerificationActionTerminalArtifact(
      encodeVerificationActionData(value)
    ),
    producingOrigin: (payload) => payload.producer
  });
  if (terminal.payload === null || terminal.archiveDigest === null || terminal.referencedOrigin === null ||
      !canonicalEquals(terminal.referencedOrigin, sourceOrigin) ||
      selected.artifactName !== verificationActionProviderTerminalArtifactName(
        terminal.payload.actionPlan.action.actionKey
      )) {
    fail('wakeup terminal archive differs from its actual original payload and source attempt.');
  }
  const resolutionTransport = await readHostedActionResolutionTransport(transport, {
    repositoryId: authenticatedRepository.repositoryId,
    repository: authenticatedRepository.repositoryName,
    actionKey: terminal.payload.actionPlan.action.actionKey,
    candidateSha: sha(terminal.payload.input.headSha)
  }, sourceOrigin);
  const providerEnvelope = parseCiVerificationActionProviderEnvelope(
    JSON.parse(resolutionTransport.files['verification-action-provider-envelope.json']) as unknown
  );
  if (providerEnvelope.proposal.proposedActionKey !== terminal.payload.actionPlan.action.actionKey) {
    fail('wakeup resolution provider envelope differs from the original terminal ActionKey.');
  }
  if (requiredEnvironment('GITHUB_EVENT_PATH') !== eventPath || readFileSync(eventPath, 'utf8') !== eventSource) {
    fail('wakeup workflow completion cause changed during discovery.');
  }
  assertHostedResumeObservationOrigin(origin);
  return deepFreeze({
    completedAction: {
      providerEnvelope, runId: sourceOrigin.runId, runAttempt: sourceOrigin.runAttempt,
      terminalArtifactId: selected.artifactId, terminalArtifactName: selected.artifactName,
      terminalArchiveDigest: terminal.archiveDigest,
      terminalPayloadDigest: terminal.payload.artifactDigest as VerificationActionKeyDigest
    },
    resolutionTransport
  });

  });
}

/** Capture authentic archive data before its original parsers reconstruct the
 * referenced closure. This does not admit a terminal, human, Scope or Session. */
export async function readHostedResumeResolutionTransport(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  completedAction: HostedResumeSignal<string>['completedAction'];
}>) {
  input = captureActionProviderInput(input);
  return await withNativeActionProviderTransport(input.origin, false, async transport => {
  const origin = input.origin;
  const authenticatedRepository = assertHostedResumeObservationOrigin(origin);
  return readReferencedHostedResumeResolutionTransport(transport, origin,
    input.completedAction, authenticatedRepository);

  });
}

async function readReferencedHostedResumeResolutionTransport(
  transport: VerificationActionGitHubProviderReadFacts,
  origin: AuthenticatedGitHubJobOrigin | null,
  locator: HostedResumeSignal<string>['completedAction'],
  authenticatedRepository: ReturnType<typeof assertHostedResumeObservationOrigin>
) {
  const completedAction = Object.freeze({ ...locator });
  const envelope = parseCiVerificationActionProviderEnvelope(completedAction.providerEnvelope);
  const actionKey = envelope.proposal.proposedActionKey;
  const artifactName = verificationActionProviderTerminalArtifactName(actionKey);
  if (completedAction.terminalArtifactName !== artifactName ||
      !Number.isSafeInteger(completedAction.runAttempt) || completedAction.runAttempt < 1) {
    fail('hosted resume completed Action locator is invalid.');
  }
  positiveId(completedAction.runId, 'completed Action run id');
  positiveId(completedAction.terminalArtifactId, 'completed Action artifact id');
  const inventory = await readVerificationActionArtifactInventory(transport, {
    repository: authenticatedRepository.repositoryName
  });
  const matches = inventory.artifacts.filter((entry) => entry.artifactName === artifactName);
  if (matches.length !== 1 || matches[0]!.expired ||
      matches[0]!.artifactId !== completedAction.terminalArtifactId ||
      matches[0]!.runId !== completedAction.runId) {
    fail('hosted resume terminal archive locator differs from its complete inventory.');
  }
  const terminal = await readVerificationActionArtifactObservation(transport, {
    repositoryId: authenticatedRepository.repositoryId,
    repository: authenticatedRepository.repositoryName,
    artifactId: completedAction.terminalArtifactId,
    expectedArtifactName: artifactName,
    expectedFileName: VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE,
    parsePayload: (value) => CodexDevelopmentParseVerificationActionTerminalArtifact(
      encodeVerificationActionData(value)
    ),
    producingOrigin: (payload) => payload.producer
  });
  if (terminal.payload === null || terminal.referencedOrigin === null ||
      terminal.archiveDigest !== completedAction.terminalArchiveDigest ||
      terminal.payload.artifactDigest !== completedAction.terminalPayloadDigest ||
      terminal.payload.actionPlan.action.actionKey !== actionKey ||
      terminal.referencedOrigin.runId !== completedAction.runId ||
      terminal.referencedOrigin.runAttempt !== completedAction.runAttempt) {
    fail('hosted resume terminal locator differs from its exact original archive and producer.');
  }
  const result = await readHostedActionResolutionTransport(transport, {
    repositoryId: authenticatedRepository.repositoryId,
    repository: authenticatedRepository.repositoryName,
    actionKey, candidateSha: sha(terminal.payload.input.headSha)
  }, terminal.referencedOrigin);
  if (origin !== null) assertAuthenticatedGitHubJobOriginCurrent(origin);
  return deepFreeze(result);
}

/** Observe settled Action facts under the original live job-origin scope.
 * This entry cannot publish, claim, repair, or dispatch a provider operation. */
export async function observeHostedResumeAction(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  authority: VerificationActionGitHubProviderAuthority;
}>) {
  input = captureActionProviderInput(input);
  return await withNativeActionProviderTransport(input.origin, false, async transport => {
  const origin = input.origin;
  const authenticatedRepository = assertHostedResumeObservationOrigin(origin);
  return observeReferencedHostedResumeAction(transport, origin,
    input.authority, authenticatedRepository);

  });
}

async function observeReferencedHostedResumeAction(
  transport: VerificationActionGitHubProviderReadFacts,
  origin: AuthenticatedGitHubJobOrigin | null,
  authority: VerificationActionGitHubProviderAuthority,
  authenticatedRepository: ReturnType<typeof assertHostedResumeObservationOrigin>
) {
  const { repositoryName, repositoryIdText } = authenticatedRepository;
  const parent = await authenticateReferencedParentAuthority(transport, authority, authenticatedRepository);

  const parentSourceAttempt = record(await transport.getWorkflowRunAttempt({
    repository: repositoryName, runId: parent.envelope.parentRunId,
    runAttempt: parent.envelope.parentRunAttempt
  }), 'parent source attempt');
  if (String(parentSourceAttempt.id ?? '') !== parent.envelope.parentRunId ||
      parentSourceAttempt.run_attempt !== parent.envelope.parentRunAttempt ||
      parentSourceAttempt.path !== parent.envelope.parentWorkflowPath ||
      parentSourceAttempt.head_sha !== parent.originalRequest.expectedBaseSha ||
      parentSourceAttempt.head_branch !== 'main' ||
      parentSourceAttempt.workflow_id !== parent.parentRun.workflow_id ||
      String(record(parentSourceAttempt.repository, 'parent source attempt repository').id ?? '') !== repositoryIdText) {
    fail('parent source attempt differs from the authenticated historical origin.');
  }
  identityRecord(parentSourceAttempt.actor, parent.parentPlan.parentActor, 'parent source attempt actor');
  const initiatingActor = record(parentSourceAttempt.triggering_actor, 'parent attempt initiating actor');
  if (initiatingActor.type !== 'User' || typeof initiatingActor.login !== 'string' ||
      !Number.isSafeInteger(initiatingActor.id) || Number(initiatingActor.id) < 1 ||
      typeof initiatingActor.node_id !== 'string' || initiatingActor.node_id.length === 0 ||
      /[\u0000-\u001f]/u.test(initiatingActor.node_id)) {
    fail('source attempt initiating actor is not an exact human principal.');
  }
  const sourceIdentity = Object.freeze({
    login: initiatingActor.login, id: Number(initiatingActor.id),
    nodeId: initiatingActor.node_id, type: 'User' as const
  });
  const initiatorPermission = record(await transport.getPrincipalPermission({
    repository: repositoryName, login: sourceIdentity.login
  }), 'source attempt initiator live permission');
  identityRecord(initiatorPermission.user, sourceIdentity, 'source attempt initiator live identity');
  const permission = normalizeGitHubRepositoryPermission(initiatorPermission);
  if (permission !== 'maintain' && permission !== 'admin') {
    fail('source attempt initiating actor lacks current maintainer authority.');
  }
  const parentAttemptInitiator = Object.freeze({ ...sourceIdentity, permission });

  if (origin !== null) assertAuthenticatedGitHubJobOriginCurrent(origin);
  const snapshot = await readVerificationActionGitHubProviderSnapshot(transport, parent.resolution);
  const decision = reduceVerificationActionGitHubProviderSnapshot(parent.resolution, snapshot);
  if (decision.disposition !== 'terminal-anchored') {
    fail(`hosted Session resume Action is not terminal-anchored (${decision.disposition}).`);
  }
  const start = snapshot.startObservations[0];
  const terminal = snapshot.terminalObservations[0];
  const anchor = snapshot.terminalAnchorObservations[0];
  if (start === undefined || start.payload === null || start.archiveDigest === null ||
      terminal === undefined || terminal.payload === null || terminal.archiveDigest === null ||
      terminal.referencedOrigin === null || anchor === undefined || anchor.payload === null ||
      anchor.archiveDigest === null || anchor.referencedOrigin === null) {
    fail('terminal-anchored Action lacks its complete original artifact facts.');
  }
  const terminalArtifact = CodexDevelopmentParseVerificationActionTerminalArtifact(
    encodeVerificationActionData(terminal.payload)
  );
  const startStatus = snapshot.statusReadback.statuses.find((status) =>
    status.id === anchor.payload!.startStatusId && status.nodeId === anchor.payload!.startStatusNodeId
  );
  const terminalDescription = verificationActionProviderTerminalDescription(
    anchor.payload.anchorDigest
  );
  const terminalStatuses = snapshot.statusReadback.statuses.filter((status) =>
    status.description === terminalDescription
  );
  if (startStatus === undefined || terminalStatuses.length !== 1) {
    fail('terminal-anchored Action lacks its exact original status readback.');
  }
  const completedAction = Object.freeze({
    providerEnvelope: parent.envelope,
    runId: terminal.referencedOrigin.runId, runAttempt: terminal.referencedOrigin.runAttempt,
    terminalArtifactId: terminal.originId, terminalArtifactName: terminal.artifactName,
    terminalArchiveDigest: terminal.archiveDigest,
    terminalPayloadDigest: terminalArtifact.artifactDigest as VerificationActionKeyDigest
  });
  const resolutionTransport = await readHostedActionResolutionTransport(
    transport, parent.resolution, terminal.referencedOrigin
  );
  if (origin !== null) assertAuthenticatedGitHubJobOriginCurrent(origin);
  return deepFreeze({
    originalRequest: parent.originalRequest,
    parentActor: parent.parentPlan.parentActor, parentPlan: parent.parentPlan,
    parentAttemptInitiator, parentSourceAttempt, completedAction, resolutionTransport, snapshot, decision,
    terminal: { ...terminal, payload: terminalArtifact }, start, anchor,
    startStatus, terminalStatus: terminalStatuses[0]!
  });
}

async function authenticateHistoricalHostedResumeEmitter(
  transport: VerificationActionGitHubProviderReadFacts,
  signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>,
  authenticatedRepository: ReturnType<typeof assertHostedResumeObservationOrigin>
) {
  const emitter = signal.emitter;
  if (emitter.repository !== authenticatedRepository.repositoryName ||
      emitter.repositoryId !== authenticatedRepository.repositoryIdText) {
    fail('resume provider emitter belongs to another repository.');
  }
  const emitterRun = record(await transport.getWorkflowRunAttempt({
    repository: authenticatedRepository.repositoryName,
    runId: emitter.runId, runAttempt: emitter.runAttempt
  }), 'resume provider original emitter attempt');
  const emitterRepository = record(emitterRun.repository, 'resume provider emitter repository');
  if (String(emitterRun.id ?? '') !== emitter.runId || emitterRun.run_attempt !== emitter.runAttempt ||
      emitterRun.path !== emitter.workflowPath || emitterRun.head_sha !== emitter.workflowSha ||
      emitterRun.event !== 'workflow_run' || emitterRun.head_branch !== 'main' ||
      String(emitterRepository.id ?? '') !== emitter.repositoryId || emitterRepository.full_name !== emitter.repository) {
    fail('resume provider emitter differs from its original workflow attempt.');
  }
  const emitterJobs = await readCompleteParentJobs(transport, emitter.repository, emitter.runId, emitter.runAttempt);
  const selectedJobs = emitterJobs.filter((job) => String(job.id ?? '') === emitter.jobId);
  const emitterJob = selectedJobs.length === 1 ? selectedJobs[0] : undefined;
  const emitterSteps = emitterJob !== undefined && Array.isArray(emitterJob.steps)
    ? emitterJob.steps.map((entry, index) => record(entry, `resume emitter step[${index}]`)) : [];
  const selectedSteps = emitterSteps.filter((step) =>
    step.number === emitter.stepNumber && step.name === emitter.stepName);
  if (emitterJob === undefined || emitterJob.name !== 'integrate' ||
      String(emitterJob.run_id ?? '') !== emitter.runId || emitterJob.run_attempt !== emitter.runAttempt ||
      emitterJob.head_sha !== emitter.workflowSha ||
      emitterJob.check_run_url !== `https://api.github.com/repos/${emitter.repository}/check-runs/${emitter.checkRunId}` ||
      selectedSteps.length !== 1 || !['in_progress', 'completed'].includes(String(selectedSteps[0]!.status)) ||
      (selectedSteps[0]!.status === 'completed' && selectedSteps[0]!.conclusion !== 'success')) {
    fail('resume provider emitter lacks its exact original job and phase provenance.');
  }
  const suiteId = Number(emitterRun.check_suite_id);
  if (!Number.isSafeInteger(suiteId) || suiteId < 1) fail('resume provider emitter check suite is invalid.');
  const suite = record(await transport.getCheckSuite({ repository: emitter.repository, checkSuiteId: suiteId }),
    'resume provider emitter check suite');
  const suiteRepository = record(suite.repository, 'resume provider emitter suite repository');
  const app = record(suite.app, 'resume provider emitter App');
  const expectedApp = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  if (suite.id !== suiteId || suite.head_sha !== emitter.workflowSha ||
      String(suiteRepository.id ?? '') !== emitter.repositoryId || suiteRepository.full_name !== emitter.repository ||
      app.id !== expectedApp.id || app.node_id !== expectedApp.nodeId || app.slug !== expectedApp.slug) {
    fail('resume provider emitter does not bind the original Actions App and subject.');
  }
}

async function authenticateHostedResumeReceiverAuthority(
  transport: VerificationActionGitHubProviderReadFacts,
  input: Readonly<{
    origin: AuthenticatedGitHubJobOrigin;
    signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
    authority: VerificationActionGitHubProviderAuthority;
  }>
) {
  const origin = input.origin;
  const authenticatedRepository = assertHostedResumeObservationOrigin(origin);
  const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (current.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      current.policyJobId !== 'receive-verification-session-resume' ||
      current.phase !== 'receive-verification-session-resume' ||
      requiredEnvironment('GITHUB_EVENT_NAME') !== 'repository_dispatch' ||
      requiredEnvironment('GITHUB_RUN_ID') !== current.runId ||
      requiredEnvironment('GITHUB_RUN_ATTEMPT') !== String(current.runAttempt)) {
    fail('resume provider coordination requires the exact original dedicated receiver invocation.');
  }
  const signal = parseHostedResumeDispatchSignal(encodeVerificationActionData(input.signal));
  const authority = Object.freeze({
    envelope: parseCiVerificationActionProviderEnvelope(input.authority.envelope),
    actionPlanClosure: parseCiVerificationActionPlanClosure(encodeVerificationActionData(input.authority.actionPlanClosure))
  });
  const eventPath = requiredEnvironment('GITHUB_EVENT_PATH');
  const eventSource = readFileSync(eventPath, 'utf8');
  const event = record(JSON.parse(eventSource) as unknown, 'resume provider receiver event');
  const eventRepository = record(event.repository, 'resume provider event repository');
  if (event.action !== HOSTED_RESUME_DISPATCH_EVENT ||
      String(eventRepository.id ?? '') !== authenticatedRepository.repositoryIdText ||
      eventRepository.full_name !== authenticatedRepository.repositoryName ||
      !canonicalEquals(event.client_payload, { payload: signal })) {
    fail('resume provider signal differs from the original current receiver event.');
  }
  identityRecord(event.sender, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, 'resume provider event sender');
  const currentRun = record(await transport.getWorkflowRunAttempt({
    repository: authenticatedRepository.repositoryName,
    runId: current.runId, runAttempt: current.runAttempt
  }), 'resume provider current receiver attempt');
  identityRecord(currentRun.actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, 'resume provider receiver actor');
  identityRecord(currentRun.triggering_actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot,
    'resume provider receiver triggering actor');
  const currentOrigin = await readVerificationActionExactAttemptOrigin(transport, {
    repositoryId: authenticatedRepository.repositoryId,
    repository: authenticatedRepository.repositoryName, runId: current.runId, runAttempt: current.runAttempt
  });
  if (currentOrigin.workflowSha !== current.workflowSha || currentRun.head_branch !== 'main') {
    fail('resume provider receiver attempt differs from its original authenticated subject.');
  }
  await authenticateHistoricalHostedResumeEmitter(transport, signal, authenticatedRepository);
  const completedEnvelope = parseCiVerificationActionProviderEnvelope(signal.completedAction.providerEnvelope);
  const completed = await observeReferencedHostedResumeAction(transport, origin, {
    envelope: completedEnvelope, actionPlanClosure: authority.actionPlanClosure
  }, authenticatedRepository);
  if (!canonicalEquals(completed.completedAction, signal.completedAction)) {
    fail('resume provider completed cause differs from its original terminal readback.');
  }
  const referenced = await authenticateReferencedParentAuthority(transport, authority, authenticatedRepository);
  if (!canonicalEquals(referenced.parentPlan, completed.parentPlan) ||
      !canonicalEquals(referenced.originalRequest, completed.originalRequest) ||
      current.workflowSha !== referenced.originalRequest.expectedBaseSha) {
    fail('resume provider member is not part of the same original parent request and trusted receiver base.');
  }
  if (requiredEnvironment('GITHUB_EVENT_PATH') !== eventPath || readFileSync(eventPath, 'utf8') !== eventSource) {
    fail('resume provider receiver event changed during authentication.');
  }
  assertHostedResumeObservationOrigin(origin);
  return { origin, signal, eventPath, eventSource, referenced, completed };
}

/** Complete raw provider facts for one original closure member, under the
 * dedicated receiver cause. Observing a member does not admit its terminal. */
export async function observeHostedResumeActionSnapshot(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  authority: VerificationActionGitHubProviderAuthority;
}>) {
  input = captureActionProviderInput(input);
  return await withNativeActionProviderTransport(input.origin, false, async transport => {

  const authenticated = await authenticateHostedResumeReceiverAuthority(transport, input);
  const snapshot = await readVerificationActionGitHubProviderSnapshot(transport, authenticated.referenced.resolution);
  assertHostedResumeObservationOrigin(authenticated.origin);
  return deepFreeze({
    snapshot, parentPlan: authenticated.referenced.parentPlan,
    originalRequest: authenticated.referenced.originalRequest,
    parentActor: authenticated.referenced.parentPlan.parentActor,
    parentSourceAttempt: authenticated.completed.parentSourceAttempt,
    parentAttemptInitiator: authenticated.completed.parentAttemptInitiator
  });

  });
}

/** Original closed parent/cause read for the CI reassessment Domain. Returned
 * data carry no Effect grant; the Domain invokes this read again at consume. */
export async function observeHostedResumeReassessmentParent(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  authority: VerificationActionGitHubProviderAuthority;
}>) {
  return await observeHostedResumeActionSnapshot(input);
}

function parseResumeDispatchHistoryCollection(source: string,
  parentPlan: Awaited<ReturnType<typeof authenticateReferencedParentAuthority>>['parentPlan']) {
  if (Buffer.byteLength(source, 'utf8') > 10 * 1024 * 1024) fail('resume outcome history exceeds the original archive member bound.');
  const declaration = readVerificationDataRecord(JSON.parse(source) as unknown, 'historical resume outcome declaration');
  if (!Array.isArray(declaration.expectedActionKeys) || declaration.expectedActionKeys.length > 256) {
    fail('historical resume outcome planned membership is absent or unbounded.');
  }
  const expectedActionKeys = declaration.expectedActionKeys.map(key => parseDigest(key, 'sha256'));
  const parentKeys = parentPlan.proposals.map(proposal => proposal.proposedActionKey);
  let previousIndex = -1;
  for (const key of expectedActionKeys) {
    const index = parentKeys.indexOf(key);
    if (index <= previousIndex) fail('historical resume planned membership is not an ordered subset of its native parent.');
    previousIndex = index;
  }
  // Declaration bytes navigate the historical plan; the unique finite parser
  // and independently authenticated original parent establish its exact census.
  return parseHostedResumeDispatchOutcomeCollection(source, expectedActionKeys);
}

/** Historical restrictions only. Absence cannot prove a first or retry POST. */
export async function observeHostedResumeDispatchOutcomeHistory(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  authority: VerificationActionGitHubProviderAuthority;
  sessionRevision: VerificationActionKeyDigest;
  actionKeys: readonly VerificationActionKeyDigest[];
}>) {
  const data = readVerificationDataRecord(input, 'Resume outcome history input');
  const origin = input.origin;
  const selected = readVerificationDataRecord(snapshotVerificationData({ signal: data.signal,
    authority: data.authority, sessionRevision: data.sessionRevision, actionKeys: data.actionKeys }, 'Resume history selectors'));
  const signal = parseHostedResumeDispatchSignal(encodeVerificationActionData(selected.signal));
  const authorityData = readVerificationDataRecord(selected.authority, 'Resume history authority data');
  const authority = Object.freeze({ envelope: parseCiVerificationActionProviderEnvelope(authorityData.envelope),
    actionPlanClosure: parseCiVerificationActionPlanClosure(encodeVerificationActionData(authorityData.actionPlanClosure)) });
  const sessionRevision = parseDigest(selected.sessionRevision, 'sha256');
  if (!Array.isArray(selected.actionKeys) || selected.actionKeys.length > 256) fail('resume history queried Action membership is invalid.');
  const actionKeys = selected.actionKeys.map(key => parseDigest(key, 'sha256'));
  if (new Set(actionKeys).size !== actionKeys.length) fail('resume history queried Action membership repeats.');
  const authenticatedRepository = assertHostedResumeObservationOrigin(origin);
  const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const observations: Array<Readonly<{ artifactId: string; artifactName: string; archiveDigest: VerificationActionKeyDigest;
    providerArchiveDigest: string | null; producerOrigin: VerificationActionProviderOrigin;
    collection: ReturnType<typeof parseHostedResumeDispatchOutcomeCollection> }>> = [];
  let inventoryDigest: VerificationActionKeyDigest | null = null;
  const unavailable = (reason: string) => deepFreeze({ disposition: 'unavailable' as const,
    observations: [...observations], inventoryDigest, reason, use: 'observer-only' as const });
  try {
    return await withGitHubApiVerificationSession({ repositoryRoot: current.trustedDriverRoot,
      repository: authenticatedRepository.repositoryName, effect: 'verification-read',
      deadlineAtUnixMs: current.deadlineAtUnixMs, signal: getAuthenticatedGitHubJobOriginSignal(origin),
      operation: async capability => {
        const scope = await createHistoricalSourceReadScope(capability, authenticatedRepository.repositoryName, origin);
        const authenticated = await authenticateHostedResumeReceiverAuthority(scope.facts, { origin, signal, authority });
        if (authenticated.referenced.originalRequest.expectedSessionRevision !== sessionRevision ||
            actionKeys.some(key => !authenticated.referenced.parentPlan.proposals.some(proposal => proposal.proposedActionKey === key))) {
          fail('resume history query differs from its native original Session or parent members.');
        }
        const inventory = await readVerificationActionArtifactInventory(scope.facts, { repository: authenticatedRepository.repositoryName });
        inventoryDigest = inventory.inventoryDigest;
        // Names are navigation only. Every selected archive is subsequently
        // bound to the unique name factory and its actual native producer.
        const candidates = inventory.artifacts.filter(entry => /^verification-session-resume-dispatch-outcomes-run-/u.test(entry.artifactName));
        const nameCounts = new Map<string, number>();
        for (const entry of candidates) nameCounts.set(entry.artifactName, (nameCounts.get(entry.artifactName) ?? 0) + 1);
        for (const entry of candidates) {
          if (entry.expired || nameCounts.get(entry.artifactName) !== 1) {
            return unavailable('historical outcome archive is expired or ambiguous; missing bytes do not prove non-entry');
          }
          const metadata = record(await scope.facts.getArtifact({ repository: authenticatedRepository.repositoryName,
            artifactId: entry.artifactId }), 'historical resume outcome metadata');
          const artifactRun = record(metadata.workflow_run, 'historical resume outcome producing run');
          if (metadata.id !== Number(entry.artifactId) || metadata.name !== entry.artifactName || metadata.expired !== false ||
              artifactRun.id !== Number(entry.runId)) fail('historical resume outcome metadata differs from the complete inventory.');
          const download = await scope.facts.downloadArtifact({ repository: authenticatedRepository.repositoryName,
            artifactId: entry.artifactId, artifactName: entry.artifactName, runId: entry.runId,
            archiveDigest: typeof metadata.digest === 'string' ? metadata.digest : null, projection: 'resume-dispatch-outcomes' });
          const source = download.files[HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE];
          if (!(download.archiveBytes instanceof Uint8Array) || Object.keys(download.files).length !== 1 || typeof source !== 'string') {
            fail('historical resume outcome archive does not contain its exact sole member.');
          }
          const declaration = readVerificationDataRecord(JSON.parse(source) as unknown, 'historical outcome cause navigation');
          if (!canonicalEquals(declaration.signal, signal) || declaration.sessionRevision !== sessionRevision) continue;
          const collection = parseResumeDispatchHistoryCollection(source, authenticated.referenced.parentPlan);
          const producer = collection.receiver;
          if (producer.repository !== authenticatedRepository.repositoryName || producer.runId !== entry.runId ||
              producer.workflowSha !== authenticated.referenced.originalRequest.expectedBaseSha ||
              artifactRun.head_sha !== producer.workflowSha ||
              entry.artifactName !== hostedResumeDispatchOutcomesArtifactName(producer.runId, producer.runAttempt)) {
            fail('historical outcome archive does not bind its exact receiver and original trusted base.');
          }
          const producerOrigin = await readVerificationActionExactAttemptOrigin(scope.facts, {
            repositoryId: authenticatedRepository.repositoryId, repository: authenticatedRepository.repositoryName,
            runId: producer.runId, runAttempt: producer.runAttempt });
          if (producerOrigin.workflowSha !== producer.workflowSha) fail('historical outcome origin differs from its actual archive producer.');
          const run = record(await scope.facts.getWorkflowRunAttempt({ repository: authenticatedRepository.repositoryName,
            runId: producer.runId, runAttempt: producer.runAttempt }), 'historical outcome receiver attempt');
          identityRecord(run.actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, 'historical outcome receiver actor');
          identityRecord(run.triggering_actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, 'historical outcome receiver initiator');
          if (run.status !== 'completed' || run.head_branch !== 'main') fail('historical outcome receiver is not its completed canonical attempt.');
          const publisher = await assertVerificationActionArtifactPublisher(scope.facts, {
            origin: producerOrigin, metadata, fileName: HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE
          });
          if (publisher.jobId !== producer.jobId || publisher.status !== 'completed') {
            fail('historical outcome lacks its exact completed receiver publisher.');
          }
          const archiveDigest = `sha256:${createHash('sha256').update(download.archiveBytes).digest('hex')}` as VerificationActionKeyDigest;
          if (metadata.digest !== undefined && metadata.digest !== null && metadata.digest !== archiveDigest) fail('historical outcome provider archive digest differs.');
          observations.push(deepFreeze({ artifactId: entry.artifactId, artifactName: entry.artifactName,
            archiveDigest, providerArchiveDigest: metadata.digest === undefined || metadata.digest === null ? null : String(metadata.digest),
            producerOrigin, collection }));
        }
        await authenticateHostedResumeReceiverAuthority(scope.facts, { origin, signal, authority });
        const freshInventory = await readVerificationActionArtifactInventory(scope.facts, { repository: authenticatedRepository.repositoryName });
        if (freshInventory.inventoryDigest !== inventoryDigest) fail('historical outcome complete inventory changed during its observation.');
        scope.assertCurrent();
        return observations.length === 0 ? unavailable('no authenticated historical outcome carrier is available; absence is not non-entry')
          : deepFreeze({ disposition: 'observed' as const, observations: [...observations], inventoryDigest,
            reason: null, use: 'observer-only' as const });
      } });
  } catch (error) {
    return unavailable(`historical outcome observation is unavailable: ${failureMessage(error)}`);
  }
}

const hostedResumeChildDispatchAttempts = new WeakMap<AuthenticatedGitHubJobOrigin,
  Map<string, 'entered' | 'submitted'>>();

type HistoricalHostedSessionArtifact = ReturnType<typeof parseHostedSessionTerminalArtifact>;
interface HistoricalHostedSessionSourceRecord {
  readonly origin: AuthenticatedGitHubJobOrigin;
  readonly artifactId: string;
  readonly artifactText: string;
  readonly archiveDigest: string | null;
}
const historicalHostedSessionSources = new WeakMap<HistoricalHostedSessionArtifact,
  HistoricalHostedSessionSourceRecord>();

function historicalHostedSessionReaderRepository(origin: AuthenticatedGitHubJobOrigin) {
  const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (current.role !== 'control') fail('historical hosted Session intake requires a genuine control reader.');
  const repositoryName = repository(current.repository);
  const repositoryIdText = current.repositoryId;
  const repositoryId = Number(repositoryIdText);
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 1) {
    fail('historical hosted Session reader repository identity is invalid.');
  }
  return Object.freeze({ repositoryName, repositoryIdText, repositoryId });
}

async function readHistoricalHostedSessionTerminalSource(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  artifact: HistoricalHostedSessionArtifact;
  artifactText: string;
  artifactId: string;
}>) {
  const origin = input.origin;
  const authenticatedRepository = historicalHostedSessionReaderRepository(origin);
  const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
  return await withGitHubApiVerificationSession({ repositoryRoot: current.trustedDriverRoot,
    repository: authenticatedRepository.repositoryName, effect: 'verification-read',
    deadlineAtUnixMs: current.deadlineAtUnixMs, signal: getAuthenticatedGitHubJobOriginSignal(origin),
    operation: async capability => {
      const scope = await createHistoricalSourceReadScope(capability, authenticatedRepository.repositoryName, origin);
      if (!canonicalEquals(scope.repositoryFacts, authenticatedRepository)) {
        fail('historical reader and retained API repository identities differ.');
      }
      return await readHistoricalHostedSessionSourceFacts(scope, input);
    } });
}

class HistoricalSourceReadScope {
  constructor(readonly facts: RetainedHistoricalSourceReadFacts,
    readonly repositoryFacts: ReturnType<typeof historicalHostedSessionReaderRepository>,
    readonly origin: AuthenticatedGitHubJobOrigin | null) {}

  assertCurrent(): void {
    this.facts.assertCurrent();
    if (this.origin !== null && !canonicalEquals(historicalHostedSessionReaderRepository(this.origin), this.repositoryFacts)) {
      fail('historical Hosted reader scope identity drifted.');
    }
  }
}

async function createHistoricalSourceReadScope(capability: GitHubApiCapability, repositoryName: string,
  origin: AuthenticatedGitHubJobOrigin | null) {
  const facts = new RetainedHistoricalSourceReadFacts(capability, repositoryName);
  const observed = record(await facts.getRepository({ repository: repositoryName }), 'historical read repository');
  if (observed.full_name !== repositoryName || observed.default_branch !== 'main' ||
      !Number.isSafeInteger(observed.id) || Number(observed.id) < 1) {
    fail('historical retained read repository identity is invalid.');
  }
  const repositoryFacts = Object.freeze({ repositoryName, repositoryIdText: String(observed.id), repositoryId: Number(observed.id) });
  const scope = new HistoricalSourceReadScope(facts, repositoryFacts, origin);
  scope.assertCurrent();
  return scope;
}

/** Local observation does not issue or revive Hosted SOURCE qualification. */
export async function observeHistoricalHostedSessionTerminalSourceForLocalRead(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  artifactId: string;
  artifactName: string;
  artifactDigest: VerificationActionKeyDigest;
  archiveDigest: VerificationActionKeyDigest;
}>) {
  const captured = Object.freeze({ repositoryRoot: input.repositoryRoot, repository: repository(input.repository),
    artifactId: positiveId(input.artifactId, 'local historical Session artifact id'), artifactName: input.artifactName,
    artifactDigest: parseDigest(input.artifactDigest, 'sha256'), archiveDigest: parseDigest(input.archiveDigest, 'sha256') });
  return await withGitHubApiVerificationSession({ repositoryRoot: captured.repositoryRoot,
    repository: captured.repository, effect: 'verification-read', operation: async capability => {
      const scope = await createHistoricalSourceReadScope(capability, captured.repository, null);
      const metadata = record(await scope.facts.getArtifact({ repository: captured.repository,
        artifactId: captured.artifactId }), 'local historical Session artifact metadata');
      const run = record(metadata.workflow_run, 'local historical Session artifact workflow run');
      if (metadata.id !== Number(captured.artifactId) || metadata.name !== captured.artifactName ||
          metadata.expired !== false || !Number.isSafeInteger(run.id) || Number(run.id) < 1) {
        fail('local historical Session locator differs from native artifact metadata.');
      }
      const download = await scope.facts.downloadArtifact({ repository: captured.repository,
        artifactId: captured.artifactId, artifactName: captured.artifactName, runId: String(run.id),
        archiveDigest: typeof metadata.digest === 'string' ? metadata.digest : null, projection: 'session-terminal' });
      const artifactText = download.files['verification-session-artifact.json'];
      if (!(download.archiveBytes instanceof Uint8Array) || Object.keys(download.files).length !== 1 ||
          typeof artifactText !== 'string' ||
          `sha256:${createHash('sha256').update(download.archiveBytes).digest('hex')}` !== captured.archiveDigest) {
        fail('local historical Session locator does not bind its exact sole archive bytes.');
      }
      const artifact = parseHostedSessionTerminalArtifact(artifactText);
      if (artifact.schema !== 'verification-session-delegated-terminal' ||
          artifact.artifactDigest !== captured.artifactDigest ||
          hostedSessionArtifactName({ prNumber: artifact.session.prNumber,
            sessionRevision: artifact.session.sessionRevision, runId: artifact.producer.runId,
            runAttempt: artifact.producer.runAttempt }) !== captured.artifactName) {
        fail('local historical Session locator differs from its canonical parsed source.');
      }
      const facts = await readHistoricalHostedSessionSourceFacts(scope, {
        artifact, artifactText, artifactId: captured.artifactId });
      if (facts.artifactName !== captured.artifactName || facts.artifactDigest !== captured.artifactDigest ||
          facts.archiveDigest !== captured.archiveDigest) {
        fail('local historical Session source changed during complete qualification.');
      }
      scope.assertCurrent();
      return facts;
    } });
}

async function readHistoricalHostedSessionSourceFacts(scope: HistoricalSourceReadScope, input: Readonly<{
  artifact: HistoricalHostedSessionArtifact;
  artifactText: string;
  artifactId: string;
}>) {
  scope.assertCurrent();
  const origin = scope.origin;
  const authenticatedRepository = scope.repositoryFacts;
  const transport = scope.facts;
  const artifactId = positiveId(input.artifactId, 'historical Session artifact id');
  const artifactText = input.artifactText;
  const artifact = parseHostedSessionTerminalArtifact(artifactText);
  if (artifact.schema !== 'verification-session-delegated-terminal' ||
      artifactText !== `${encodeVerificationActionData(artifact)}\n` ||
      artifactText !== `${encodeVerificationActionData(input.artifact)}\n` ||
      artifact.session.repository !== authenticatedRepository.repositoryName) {
    fail('historical delegated Session object does not bind its exact canonical bytes and repository.');
  }
  const producer = artifact.producer;
  const runId = positiveId(producer.runId, 'historical Session producer run id');
  if (!Number.isSafeInteger(producer.runAttempt) || producer.runAttempt < 1 ||
      producer.sourceTransport !== 'github-actions' ||
      producer.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      producer.workflowSha !== artifact.session.baseSha ||
      producer.actorNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId) {
    fail('historical delegated Session producer does not bind its original trusted base and bot.');
  }
  const artifactName = hostedSessionArtifactName({
    prNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision,
    runId, runAttempt: producer.runAttempt
  });
  const inventory = await readVerificationActionArtifactInventory(transport, {
    repository: authenticatedRepository.repositoryName
  });
  const matches = inventory.artifacts.filter((entry) => entry.artifactName === artifactName);
  if (matches.length !== 1 || matches[0]!.expired || matches[0]!.artifactId !== artifactId ||
      matches[0]!.runId !== runId) fail('historical Session archive is missing, expired or ambiguous.');
  const metadata = record(await transport.getArtifact({
    repository: authenticatedRepository.repositoryName, artifactId
  }), 'historical Session artifact metadata');
  const artifactRun = record(metadata.workflow_run, 'historical Session artifact workflow run');
  if (metadata.id !== Number(artifactId) || metadata.name !== artifactName || metadata.expired !== false ||
      artifactRun.id !== Number(runId) || artifactRun.head_sha !== producer.workflowSha) {
    fail('historical Session archive metadata differs from its original producer.');
  }
  const download = await transport.downloadArtifact({
    repository: authenticatedRepository.repositoryName, artifactId, artifactName, runId,
    archiveDigest: typeof metadata.digest === 'string' ? metadata.digest : null, projection: 'session-terminal'
  });
  if (!(download.archiveBytes instanceof Uint8Array) || Object.keys(download.files).length !== 1 ||
      download.files['verification-session-artifact.json'] !== artifactText) {
    fail('historical Session archive does not contain its exact sole canonical Session bytes.');
  }
  // Only the server archive's independently parsed data is returned to effects.
  // The caller object remains an identity selector, never a mutable data source.
  const authenticatedArtifact = parseHostedSessionTerminalArtifact(download.files['verification-session-artifact.json']!);
  if (authenticatedArtifact.schema !== 'verification-session-delegated-terminal') {
    fail('historical Session server archive interpretation changed during its readback.');
  }
  const archiveDigest = `sha256:${createHash('sha256').update(download.archiveBytes).digest('hex')}` as const;
  if (metadata.digest !== undefined && metadata.digest !== null &&
      (typeof metadata.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(metadata.digest) ||
      metadata.digest !== archiveDigest)) {
    fail('historical Session provider archive digest differs from downloaded bytes.');
  }
  const receiverOrigin = await readVerificationActionExactAttemptOrigin(transport, {
    repositoryId: authenticatedRepository.repositoryId, repository: authenticatedRepository.repositoryName,
    runId, runAttempt: producer.runAttempt
  });
  const receiverRun = record(await transport.getWorkflowRunAttempt({
    repository: authenticatedRepository.repositoryName, runId, runAttempt: producer.runAttempt
  }), 'historical Session receiver attempt');
  identityRecord(receiverRun.actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, 'historical Session receiver actor');
  identityRecord(receiverRun.triggering_actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot,
    'historical Session receiver triggering actor');
  if (receiverOrigin.workflowSha !== producer.workflowSha || receiverOrigin.workflowRef !== producer.workflowRef ||
      receiverRun.head_branch !== 'main' || receiverRun.status !== 'completed' || receiverRun.conclusion !== 'success') {
    fail('historical Session receiver attempt is not its exact completed canonical producer.');
  }
  const publisher = await assertVerificationActionArtifactPublisher(transport, {
    origin: receiverOrigin, metadata, fileName: 'verification-session-artifact.json'
  });
  if (publisher.status !== 'completed' || publisher.conclusion !== 'success') {
    fail('historical Session receiver is not its exact completed successful publisher.');
  }
  const signal = artifact.sourceCause.signal;
  await authenticateHistoricalHostedResumeEmitter(transport, signal, authenticatedRepository);
  const resolutionTransport = await readReferencedHostedResumeResolutionTransport(
    transport, origin, signal.completedAction, authenticatedRepository);
  const hostedEnvelope = parseHostedEnvelope(JSON.parse(resolutionTransport.files['hosted-envelope.json']) as unknown);
  const envelope = parseCiVerificationActionProviderEnvelope(
    JSON.parse(resolutionTransport.files['verification-action-provider-envelope.json']) as unknown);
  const resolution = CodexDevelopmentParseHostedActionResolution(resolutionTransport.files['hosted-action-resolution.json']);
  if (!canonicalEquals(envelope, signal.completedAction.providerEnvelope) ||
      resolutionTransport.files['verification-action-provider-envelope.json'] !== `${encodeVerificationActionData(envelope)}\n` ||
      resolutionTransport.files['hosted-envelope.json'] !== `${encodeVerificationActionData(hostedEnvelope)}\n` ||
      resolutionTransport.files['hosted-action-resolution.json'] !== `${encodeVerificationActionData(resolution)}\n` ||
      !canonicalEquals(resolution, CodexDevelopmentResolveHostedAction({ request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(envelope.proposal)), envelope: hostedEnvelope })) ||
      hostedEnvelope.actionPlanClosure.actionPlanDigest !== artifact.sourceCause.actionPlanClosureDigest) {
    fail('historical Session delegated cause differs from the original complete resolution archive.');
  }
  const completed = await observeReferencedHostedResumeAction(transport, origin, {
    envelope, actionPlanClosure: hostedEnvelope.actionPlanClosure
  }, authenticatedRepository);
  if (!canonicalEquals(completed.completedAction, signal.completedAction) ||
      !canonicalEquals(completed.resolutionTransport, resolutionTransport) ||
      completed.originalRequest.requestOperationId !== artifact.sourceCause.requestOperationId ||
      completed.parentActor.nodeId !== artifact.scopeAuthorization.issuer.principalId ||
      artifact.scopeAuthorization.issuer.sourceTransport !== 'github-actions' ||
      artifact.scopeAuthorization.issuer.sourceRunId !== runId ||
      artifact.scopeAuthorization.issuer.sourceRef !== 'refs/heads/main' ||
      artifact.scopeAuthorization.issuer.trustRevision !== producer.workflowSha ||
      completed.originalRequest.expectedBaseSha !== producer.workflowSha ||
      artifact.sourceCause.scopeAuthorizationDigest !== artifact.scopeAuthorization.authorizationDigest ||
      artifact.sourceCause.sessionRevision !== artifact.session.sessionRevision) {
    fail('historical Session source is not the exact original live-human request and completed Action cause.');
  }
  const currentHuman = record(await transport.getPrincipalPermission({
    repository: authenticatedRepository.repositoryName, login: completed.parentActor.login
  }), 'historical Session source final current human permission');
  identityRecord(currentHuman.user, completed.parentActor, 'historical Session source final human identity');
  if (normalizeGitHubRepositoryPermission(currentHuman) !== completed.parentActor.permission) {
    fail('historical Session original human permission changed before qualification.');
  }
  if (artifactText !== `${encodeVerificationActionData(input.artifact)}\n`) {
    fail('historical Session artifact object changed during qualification.');
  }
  scope.assertCurrent();
  return deepFreeze({ originalRequest: completed.originalRequest, parentActor: completed.parentActor,
    parentAttemptInitiator: completed.parentAttemptInitiator, parentSourceAttempt: completed.parentSourceAttempt,
    receiverOrigin, artifactId, artifactName, artifactDigest: artifact.artifactDigest,
    artifactByteDigest: `sha256:${createHash('sha256').update(artifactText).digest('hex')}` as const,
    archiveDigest, providerArchiveDigest: metadata.digest ?? null, sourceCause: artifact.sourceCause,
    authenticatedArtifact });
}

/** Qualify the exact parsed object, not a JSON flag or a reconstructed Scope. */
export async function authenticateHistoricalHostedSessionTerminalSource(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  artifact: HistoricalHostedSessionArtifact;
  artifactText: string;
  artifactId: string;
}>) {
  const captured = Object.freeze({ origin: input.origin, artifact: input.artifact,
    artifactId: input.artifactId, artifactText: input.artifactText });
  if (historicalHostedSessionSources.has(captured.artifact)) {
    fail('historical Session source already has an original qualification responsibility.');
  }
  const pending = Object.freeze({ origin: captured.origin, artifactId: captured.artifactId,
    artifactText: captured.artifactText, archiveDigest: null });
  historicalHostedSessionSources.set(captured.artifact, pending);
  try {
    const facts = await readHistoricalHostedSessionTerminalSource(captured);
    if (historicalHostedSessionSources.get(captured.artifact) !== pending) {
      fail('historical Session source was closed during its qualification.');
    }
    historicalHostedSessionSources.set(captured.artifact, Object.freeze({ ...pending,
      archiveDigest: facts.archiveDigest }));
    return facts;
  } catch (error) {
    if (historicalHostedSessionSources.get(captured.artifact) === pending) {
      historicalHostedSessionSources.delete(captured.artifact);
    }
    throw error;
  }
}

/** Effects must consume this same private object binding and fresh readback. */
export async function assertHistoricalHostedSessionTerminalSourceCurrent(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  artifact: HistoricalHostedSessionArtifact;
}>) {
  const origin = input.origin;
  const artifact = input.artifact;
  const source = historicalHostedSessionSources.get(artifact);
  if (source === undefined || source.origin !== origin || source.archiveDigest === null) {
    fail('historical Session source is unqualified, pending or closed.');
  }
  const facts = await readHistoricalHostedSessionTerminalSource({ ...source, artifact });
  if (historicalHostedSessionSources.get(artifact) !== source || facts.archiveDigest !== source.archiveDigest) {
    fail('historical Session source was closed or replaced during its readback.');
  }
  return facts;
}

/** Closing lexical qualification needs no live origin and cannot mask settlement. */
export function closeHistoricalHostedSessionTerminalSource(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  artifact: HistoricalHostedSessionArtifact;
}>): void {
  const source = historicalHostedSessionSources.get(input.artifact);
  if (source?.origin === input.origin) historicalHostedSessionSources.delete(input.artifact);
}

function hostedResumeDispatchResult(
  disposition: 'dispatched' | 'joined' | 'blocked' | 'unknown',
  resolution: VerificationActionGitHubProviderResolution,
  snapshot: VerificationActionGitHubProviderSnapshot,
  publicationState: 'not-entered' | 'entered-unknown' | 'submitted',
  reason: string | null,
  primaryFailure: unknown = undefined
) {
  const projection = deepFreeze({ disposition, actionKey: resolution.actionKey, snapshot, publicationState, reason });
  // The thrown value is not owned data. Preserve its identity without invoking
  // accessors, Proxy traps or a recursive freezer while reporting UNKNOWN.
  return Object.freeze({ ...projection, primaryFailure });
}

/** A constrained child wake-up, not a Scope or SUT execution grant. The child
 * must reconstruct its own fresh permissions through the original pipeline. */
export async function ensureHostedResumeActionProviderTransaction(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  authority: VerificationActionGitHubProviderAuthority;
  hostedEnvelope: ReturnType<typeof parseHostedEnvelope>;
  journalFileSystem: VerificationSessionJournalFileSystem;
}>) {
  input = captureActionProviderInput(input);
  return await withNativeActionProviderTransport(input.origin, true, async transport => {
  const journalFileSystem = readVerificationDataRecord(input, 'Resume provider input').journalFileSystem;
  if (journalFileSystem === null || typeof journalFileSystem !== 'object') fail('resume provider requires its issued journal filesystem.');

  const authenticated = await authenticateHostedResumeReceiverAuthority(transport, input);
  const { origin, referenced } = authenticated;
  // This is consistency data. Its hashes do not authenticate current review
  // observations or replace the native parent/cause qualification above.
  const hostedEnvelope = parseHostedEnvelope(JSON.parse(encodeVerificationActionData(input.hostedEnvelope)) as unknown);
  CodexDevelopmentResolveHostedAction({ request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(referenced.envelope.proposal)), envelope: hostedEnvelope });
  if (!canonicalEquals(hostedEnvelope.actionPlanClosure, referenced.closure)) {
    fail('resume child wake-up envelope differs from the original authenticated member closure.');
  }
  const session = parseVerificationSession(encodeVerificationActionData(hostedEnvelope.session));
  const scope = parseScopeAuthorization(encodeVerificationActionData(hostedEnvelope.scopeAuthorization));
  const review = parseReviewStabilityReceipt(encodeVerificationActionData(hostedEnvelope.preGateReview));
  const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (scope.issuer.principalId !== referenced.parentPlan.parentActor.nodeId ||
      scope.issuer.trustRevision !== referenced.originalRequest.expectedBaseSha ||
      scope.issuer.sourceTransport !== 'github-actions' || scope.issuer.sourceRunId !== current.runId ||
      scope.issuer.sourceRef !== 'refs/heads/main' ||
      scope.proposalDigest !== referenced.originalRequest.expectedScopeProposalDigest ||
      session.repository !== referenced.resolution.repository ||
      session.sessionRevision !== referenced.originalRequest.expectedSessionRevision ||
      session.profile !== referenced.originalRequest.profile ||
      session.reviewPolicyDigest !== referenced.originalRequest.reviewPolicyDigest) {
    fail('resume child wake-up consistency data differs from its native original human and request.');
  }
  const now = new Date().toISOString();
  assertScopeAuthorizationCurrent(scope, {
    baseSha: session.baseSha, baseTreeSha: session.baseTreeSha,
    headSha: session.headSha, headTreeSha: session.headTreeSha,
    manifestDigest: session.manifestDigest, changedPaths: scope.authorizedPaths,
    sessionProposalDigest: session.sessionProposalDigest,
    actionPlanClosureDigest: session.actionPlanClosureDigest,
    environmentDigest: session.environmentDigest,
    expectedAuthorizationRevision: session.scopeAuthorizationRevision, now
  });
  if (scope.authorizationDigest !== session.scopeAuthorizationReceiptDigest) {
    fail('resume child wake-up Scope receipt differs from its original Session.');
  }
  assertReviewStabilityReceiptCurrent(review, {
    stage: 'pre-expensive', sessionRevision: session.sessionRevision,
    scopeAuthorizationRevision: session.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: session.scopeAuthorizationReceiptDigest,
    headSha: session.headSha, headTreeSha: session.headTreeSha,
    expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: review.snapshot.snapshotDigest, expectedReviewRevision: review.reviewRevision, now
  });
  const before = await readVerificationActionGitHubProviderSnapshot(transport, referenced.resolution);
  const decision = reduceVerificationActionGitHubProviderSnapshot(referenced.resolution, before);
  const attempts = hostedResumeChildDispatchAttempts.get(origin) ?? new Map<string, 'entered' | 'submitted'>();
  hostedResumeChildDispatchAttempts.set(origin, attempts);
  const attemptKey = referenced.resolution.actionKey;
  const priorAttempt = attempts.get(attemptKey);
  const priorPublication = priorAttempt === 'entered' ? 'entered-unknown' as const
    : priorAttempt === 'submitted' ? 'submitted' as const : 'not-entered' as const;
  if (decision.disposition === 'terminal-anchored') {
    return hostedResumeDispatchResult('joined', referenced.resolution, before, priorPublication,
      priorPublication === 'entered-unknown' ? 'original provider terminal joined; prior dispatch HTTP uncertainty is not a settlement receipt' : null);
  }
  if (!['start-allowed', 'repair-terminal-anchor', 'repair-terminal-status'].includes(decision.disposition)) {
    return hostedResumeDispatchResult(priorPublication === 'not-entered' ? 'blocked' : 'unknown',
      referenced.resolution, before, priorPublication, decision.reason);
  }
  if (priorAttempt !== undefined) {
    return hostedResumeDispatchResult('unknown', referenced.resolution, before,
      priorAttempt === 'entered' ? 'entered-unknown' : 'submitted',
      'this original receiver already entered the same wake-up; absence does not prove non-publication or authorize retry');
  }
  const permission = record(await transport.getPrincipalPermission({
    repository: referenced.resolution.repository, login: referenced.parentPlan.parentActor.login
  }), 'resume child wake-up original human current permission');
  identityRecord(permission.user, referenced.parentPlan.parentActor, 'resume child wake-up original human identity');
  if (normalizeGitHubRepositoryPermission(permission) !== referenced.parentPlan.parentActor.permission ||
      requiredEnvironment('GITHUB_EVENT_PATH') !== authenticated.eventPath ||
      readFileSync(authenticated.eventPath, 'utf8') !== authenticated.eventSource) {
    fail('resume child wake-up native permission or original receiver cause changed before publication.');
  }
  assertHostedResumeObservationOrigin(origin);
  const concurrentAttempt = attempts.get(attemptKey);
  if (concurrentAttempt !== undefined) {
    return hostedResumeDispatchResult('unknown', referenced.resolution, before,
      concurrentAttempt === 'entered' ? 'entered-unknown' : 'submitted',
      'this original receiver concurrently entered the same wake-up; do not repeat the POST');
  }
  const canonicalRoot = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: current.trustedDriverRoot }).workspaceStateRoot;
  assertHostedResumeObservationOrigin(origin);
  assertIssuedRuntimeJournalFileSystem(journalFileSystem, canonicalRoot);
  const claim = claimHostedResumeDispatch({ fs: journalFileSystem, signal: authenticated.signal,
    sessionRevision: session.sessionRevision, actionKey: referenced.resolution.actionKey });
  if (!claim.claimed) {
    return hostedResumeDispatchResult('unknown', referenced.resolution, before, 'entered-unknown',
      'this same-machine Session/Action wake-up has a permanent responsibility claim; observe or join without repeating the POST');
  }
  assertHostedResumeObservationOrigin(origin);
  assertIssuedRuntimeJournalFileSystem(journalFileSystem, canonicalRoot);
  attempts.set(attemptKey, 'entered');
  try {
    await transport.createRepositoryDispatch({
      repository: referenced.resolution.repository,
      eventType: CI_VERIFICATION_ACTION_DISPATCH_TYPE,
      clientPayload: createVerificationActionRepositoryDispatchClientPayload(referenced.envelope)
    });
    attempts.set(attemptKey, 'submitted');
  } catch (error) {
    return hostedResumeDispatchResult('unknown', referenced.resolution, before, 'entered-unknown',
      `one-shot child dispatch response is uncertain; do not retry: ${failureMessage(error)}`, error);
  }
  try {
    const after = await readVerificationActionGitHubProviderSnapshot(transport, referenced.resolution);
    assertHostedResumeObservationOrigin(origin);
    return hostedResumeDispatchResult('dispatched', referenced.resolution, after, 'submitted',
      'repository dispatch was submitted; child execution and terminal settlement require original provider readback');
  } catch (error) {
    return hostedResumeDispatchResult('unknown', referenced.resolution, before, 'submitted',
      `child dispatch was submitted but its readback is unavailable; do not retry: ${failureMessage(error)}`, error);
  }

  });
}

function transactionResult(
  disposition: VerificationActionGitHubProviderTransactionResult['disposition'],
  resolution: VerificationActionGitHubProviderResolution,
  snapshot: VerificationActionGitHubProviderSnapshot,
  newlyCreatedByThisInvocation: boolean,
  status: VerificationActionProviderStatusObservation | null,
  reason: string | null
): VerificationActionGitHubProviderTransactionResult {
  return Object.freeze({
    disposition,
    actionKey: resolution.actionKey,
    newlyCreatedByThisInvocation,
    status,
    snapshot,
    reason
  });
}

/**
 * The original parent/child GitHub provider transaction. Callers choose a semantic
 * operation and supply canonical Action objects; raw REST paths, status fields,
 * target URLs, pagination, and the mutation transport remain module-private.
 */
export async function ensureVerificationActionGitHubProviderTransaction(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  authority: VerificationActionGitHubProviderAuthority;
  intent: VerificationActionGitHubProviderIntent;
}>): Promise<VerificationActionGitHubProviderTransactionResult> {
  input = captureActionProviderInput(input);
  return await withNativeActionProviderTransport(input.origin, true, async transport => {

  const authenticated = await authenticateVerificationActionAuthority(
    transport,
    input.authority,
    input.intent.kind === 'coordinate-parent' || input.intent.kind === 'dispatch-child'
      ? 'parent-session'
      : 'child-action'
  );
  const { resolution, currentOrigin } = authenticated;
  const genuine = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  if (String(currentOrigin.repositoryId) !== genuine.repositoryId || currentOrigin.repository !== genuine.repository
      || currentOrigin.workflowPath !== genuine.workflowPath || currentOrigin.workflowSha !== genuine.workflowSha
      || currentOrigin.runId !== genuine.runId || currentOrigin.runAttempt !== genuine.runAttempt) {
    fail('Provider authentication differs from its genuine current transport origin.');
  }
  const before = await readVerificationActionGitHubProviderSnapshot(transport, resolution);
  if (input.intent.kind === 'coordinate' || input.intent.kind === 'coordinate-parent') {
    return transactionResult('observed', resolution, before, false, null, null);
  }
  if (input.intent.kind === 'dispatch-child') {
    const decision = reduceVerificationActionGitHubProviderSnapshot(resolution, before);
    if (!['start-allowed', 'repair-terminal-anchor', 'repair-terminal-status'].includes(
      decision.disposition
    )) {
      return transactionResult(
        'blocked', resolution, before, false, null,
        decision.reason ?? `internal Action wake-up is forbidden from ${decision.disposition}`
      );
    }
    await transport.createRepositoryDispatch({
      repository: resolution.repository,
      eventType: CI_VERIFICATION_ACTION_DISPATCH_TYPE,
      clientPayload: createVerificationActionRepositoryDispatchClientPayload(
        input.authority.envelope
      )
    });
    return transactionResult('dispatched', resolution, before, true, null, null);
  }

  let state: GitHubExactCommitStatusState;
  let description: string;
  let publisher: VerificationActionProviderOrigin;
  let expectedContextStatusIds: readonly number[];
  let completedDisposition: 'started' | 'terminal-anchored';

  if (input.intent.kind === 'claim-start') {
    const marker = parseVerificationActionProviderStartMarker(input.intent.marker);
    const observed = before.startObservations;
    if (marker.actionKey !== resolution.actionKey || marker.candidateSha !== resolution.candidateSha ||
        marker.producer.repositoryId !== resolution.repositoryId ||
        marker.producer.repository !== resolution.repository ||
        !canonicalEquals(marker.producer, currentOrigin) || observed.length !== 1 ||
        observed[0]?.expired !== false || observed[0].payload === null ||
        !canonicalEquals(observed[0].payload, marker) ||
        !canonicalEquals(observed[0].referencedOrigin, marker.producer) ||
        before.terminalObservations.length !== 0 || before.terminalAnchorObservations.length !== 0) {
      return transactionResult(
        'blocked', resolution, before, false, null,
        'claim-start requires the sole exact authenticated marker and no terminal provider state'
      );
    }
    state = 'pending';
    description = verificationActionProviderStartDescription(marker.markerDigest);
    publisher = marker.producer;
    expectedContextStatusIds = [];
    completedDisposition = 'started';
  } else {
    const anchor = parseVerificationActionProviderTerminalAnchor(input.intent.anchor);
    const observed = before.terminalAnchorObservations;
    const startObservation = before.startObservations[0];
    const terminalObservation = before.terminalObservations[0];
    const start = before.statusReadback.statuses.find((entry) =>
      entry.id === anchor.startStatusId && entry.nodeId === anchor.startStatusNodeId &&
      entry.state === 'pending'
    );
    const terminalPayload = terminalObservation?.payload === null ||
      terminalObservation?.payload === undefined
      ? null
      : record(terminalObservation.payload, 'terminal artifact payload');
    if (anchor.actionKey !== resolution.actionKey || anchor.candidateSha !== resolution.candidateSha ||
        anchor.anchorPublisherOrigin.repositoryId !== resolution.repositoryId ||
        anchor.anchorPublisherOrigin.repository !== resolution.repository ||
        !canonicalEquals(anchor.anchorPublisherOrigin, currentOrigin) || start === undefined ||
        start.description !== verificationActionProviderStartDescription(anchor.startMarkerDigest) ||
        observed.length !== 1 || observed[0]?.expired !== false || observed[0].payload === null ||
        !canonicalEquals(observed[0].payload, anchor) ||
        !canonicalEquals(observed[0].referencedOrigin, anchor.anchorPublisherOrigin) ||
        before.startObservations.length !== 1 || startObservation?.expired !== false ||
        startObservation.payload === null || startObservation.archiveDigest !== anchor.startArtifactArchiveDigest ||
        startObservation.originId !== anchor.startArtifactOriginId ||
        startObservation.artifactName !== anchor.startArtifactName ||
        startObservation.payload.markerDigest !== anchor.startMarkerDigest ||
        !canonicalEquals(startObservation.referencedOrigin, start.referencedOrigin) ||
        before.terminalObservations.length !== 1 || terminalObservation?.expired !== false ||
        terminalObservation.archiveDigest !== anchor.terminalArtifactArchiveDigest ||
        terminalObservation.originId !== anchor.terminalArtifactOriginId ||
        terminalObservation.artifactName !== anchor.terminalArtifactName ||
        terminalPayload?.artifactDigest !== anchor.terminalArtifactPayloadDigest ||
        !canonicalEquals(terminalObservation.referencedOrigin, anchor.terminalAssemblerOrigin)) {
      return transactionResult(
        'blocked', resolution, before, false, null,
        'anchor-terminal requires exact authenticated start, terminal, and anchor provider state'
      );
    }
    state = 'success';
    description = verificationActionProviderTerminalDescription(anchor.anchorDigest);
    publisher = anchor.anchorPublisherOrigin;
    expectedContextStatusIds = [start.id];
    completedDisposition = 'terminal-anchored';
  }

  const published = await publishGitHubExactCommitStatusOnce(transport, {
    repository: resolution.repository,
    sha: resolution.candidateSha,
    state,
    context: verificationActionProviderStatusContext(resolution.actionKey),
    description,
    targetUrl: verificationActionProviderRunTargetUrl(publisher),
    expectedContextStatusIds
  });
  if (published.disposition === 'ambiguous' || published.status === null) {
    return transactionResult(
      'blocked', resolution, before, false, null,
      published.reason ?? 'one-shot provider publication is ambiguous'
    );
  }

  const after = await readVerificationActionGitHubProviderSnapshot(transport, resolution);
  const canonicalStatus = after.statusReadback.statuses.find((entry) => entry.id === published.status!.id);
  if (canonicalStatus === undefined || canonicalStatus.state !== state ||
      canonicalStatus.description !== description ||
      canonicalStatus.targetUrl !== verificationActionProviderRunTargetUrl(publisher)) {
    return transactionResult(
      'blocked', resolution, after, published.newlyCreatedByThisInvocation, null,
      'semantic provider publication did not survive the canonical full readback'
    );
  }
  return transactionResult(
    published.disposition === 'existing' ? 'complete' : completedDisposition,
    resolution,
    after,
    published.newlyCreatedByThisInvocation,
    canonicalStatus,
    null
  );

  });
}
