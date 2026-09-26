import { readFileSync } from 'node:fs';
import path from 'node:path';

import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { encodeVerificationActionData, type VerificationActionKeyDigest } from '../../action/contract/action.ts';
import { assertCiVerificationActionProviderEnvelopeMember, CI_VERIFICATION_ACTION_DISPATCH_TYPE, CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE, ciVerificationActionParentDispatchPlanPayloadDigest, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionPlanClosure, parseCiVerificationActionProviderEnvelope, type CiVerificationActionPlanClosure, type CiVerificationActionProviderEnvelope } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, finalizeVerificationActionProviderStatusReadback, matchesCiCompilerWorkflowRunIdentity, parseVerificationActionProviderStartMarker, parseVerificationActionProviderTerminalAnchor, reduceVerificationActionProviderState, VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE, VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX, VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE, VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX, verificationActionProviderRunTargetUrl, verificationActionProviderStartArtifactName, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderTerminalDescription, type VerificationActionProviderArtifactObservation, type VerificationActionProviderOrigin, type VerificationActionProviderStartMarker, type VerificationActionProviderStatusObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchor, type VerificationActionProviderTerminalObservation } from '../../action/contract/provider.ts';
import {
  parseVerificationActionTerminalArtifact
} from '../contract/evidence.ts';
import {
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from '../contract/revision.ts';
import {
  executeGitHubApiOperation,
  executeObservedGitHubApiOperation,
  readGitHubApiBytes,
  withGitHubApiReadSession,
  withGitHubApiRepositoryDispatchWriteSession,
  withGitHubApiStatusWriteSession,
  type GitHubApiOperation
} from '../../../../providers/github-api/operation-session.ts';
import { readZipTextFile } from '../../../../providers/zip/runtime.ts';

const GITHUB_EXACT_COMMIT_STATUS_HISTORY_SCHEMA =
  'sec-github-exact-commit-status-history-v1' as const;

type GitHubExactCommitStatusState = 'error' | 'failure' | 'pending' | 'success';

type GitHubExactCommitStatusObservation = Readonly<{
  id: number;
  nodeId: string;
  state: GitHubExactCommitStatusState;
  context: string;
  /** GitHub permits these optional fields to be null on statuses outside this provider's context. */
  description: string | null;
  targetUrl: string | null;
  commitSha: string;
  createdAt: string;
  updatedAt: string;
  creator: Readonly<{
    login: string;
    id: number;
    nodeId: string;
    type: string;
  }>;
}>;

type GitHubExactCommitStatusProviderObservation =
  GitHubExactCommitStatusObservation & Readonly<{
    description: string;
    targetUrl: string;
  }>;

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

interface GitHubExactCommitStatusTransport {
  listCommitStatusesPage(input: Readonly<{
    repository: string;
    sha: string;
    perPage: 100;
    page: number;
  }>): Promise<GitHubExactCommitStatusPage>;
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

interface VerificationActionGitHubProviderTransport
  extends GitHubExactCommitStatusTransport {
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
  getWorkflow(input: Readonly<{ repository: string }>): Promise<unknown>;
  getPrincipalPermission(input: Readonly<{ repository: string; login: string }>): Promise<unknown>;
  listWorkflowJobsPage(input: Readonly<{
    repository: string;
    runId: string;
    runAttempt: number;
    page: number;
  }>): Promise<GitHubProviderPage>;
  downloadArtifact(input: Readonly<{
    repository: string;
    artifactId: string;
    expectedFileName: string;
  }>): Promise<Readonly<{
    archiveBytes: Uint8Array;
    files: Readonly<Record<string, string>>;
  }>>;
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

class GitHubApiVerificationActionTransport implements VerificationActionGitHubProviderTransport {
  readonly #repositoryRoot: string;

  constructor(repositoryRoot: string) {
    this.#repositoryRoot = path.resolve(repositoryRoot);
  }

  async #read(repositoryName: string, operation: GitHubApiOperation): Promise<unknown> {
    return await withGitHubApiReadSession({
      repositoryRoot: this.#repositoryRoot,
      repository: repository(repositoryName),
      operation: async (api) => await executeGitHubApiOperation(api, operation)
    });
  }

  async #readObserved(repositoryName: string, operation: GitHubApiOperation): Promise<Readonly<{
    value: unknown;
    rawResponseDigest: VerificationActionKeyDigest;
  }>> {
    const observed = await withGitHubApiReadSession({
      repositoryRoot: this.#repositoryRoot,
      repository: repository(repositoryName),
      operation: async (api) => await executeObservedGitHubApiOperation(api, operation)
    });
    return Object.freeze({
      value: observed.value,
      rawResponseDigest: bytesDigest(Buffer.from(observed.source, 'utf8'))
    });
  }

  async createRepositoryDispatch(input: Readonly<{
    repository: string;
    eventType: typeof CI_VERIFICATION_ACTION_DISPATCH_TYPE;
    clientPayload: VerificationActionRepositoryDispatchClientPayload;
  }>): Promise<void> {
    await withGitHubApiRepositoryDispatchWriteSession({
      repositoryRoot: this.#repositoryRoot,
      repository: repository(input.repository),
      operation: async (api) => {
        await executeGitHubApiOperation(api, {
          kind: 'repository-dispatch',
          eventType: input.eventType,
          clientPayload: createVerificationActionRepositoryDispatchClientPayload(input.clientPayload.payload)
        });
      }
    });
  }

  async getRepository(input: Readonly<{ repository: string }>): Promise<unknown> {
    return await this.#read(input.repository, { kind: 'repository' });
  }

  async getWorkflow(input: Readonly<{ repository: string }>): Promise<unknown> {
    return await this.#read(input.repository, {
      kind: 'workflow', path: '.github/workflows/compiler-pr-validation.yml'
    });
  }

  async getPrincipalPermission(input: Readonly<{ repository: string; login: string }>): Promise<unknown> {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(input.login)) fail('principal login is invalid.');
    return await this.#read(input.repository, { kind: 'collaborator-permission', login: input.login });
  }

  async listWorkflowJobsPage(input: Readonly<{
    repository: string;
    runId: string;
    runAttempt: number;
    page: number;
  }>): Promise<GitHubProviderPage> {
    if (!Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1 ||
        !Number.isSafeInteger(input.page) || input.page < 1) fail('workflow job page request is invalid.');
    const response = record(await this.#read(input.repository, {
      kind: 'workflow-jobs', runId: positiveId(input.runId, 'run id'),
      runAttempt: input.runAttempt, page: input.page
    }), 'workflow job page');
    if (!Array.isArray(response.jobs)) fail('workflow job page jobs are invalid.');
    return Object.freeze({ records: response.jobs, hasNextPage: response.jobs.length === 100 });
  }

  async listArtifactsPage(input: Readonly<{
    repository: string;
    perPage: 100;
    page: number;
  }>): Promise<GitHubProviderArtifactPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      fail('artifact inventory page request is invalid.');
    }
    const raw = await this.#readObserved(input.repository, { kind: 'artifacts', page: input.page });
    const response = record(raw.value, 'artifact inventory page');
    if (!Array.isArray(response.artifacts) || !Number.isSafeInteger(response.total_count) ||
        Number(response.total_count) < 0) {
      fail('artifact inventory page response is invalid.');
    }
    return Object.freeze({
      records: response.artifacts,
      totalCount: Number(response.total_count),
      rawResponseDigest: raw.rawResponseDigest
    });
  }

  async listCommitStatusesPage(input: Readonly<{
    repository: string;
    sha: string;
    perPage: 100;
    page: number;
  }>): Promise<GitHubExactCommitStatusPage> {
    const response = await this.#readObserved(input.repository, {
      kind: 'commit-statuses', sha: sha(input.sha), page: input.page
    });
    const records = response.value;
    if (!Array.isArray(records)) fail('commit status page response is not an array.');
    return Object.freeze({ records, hasNextPage: records.length === input.perPage,
      rawResponseDigest: response.rawResponseDigest });
  }

  async createCommitStatus(input: Readonly<{
    repository: string;
    sha: string;
    state: GitHubExactCommitStatusState;
    context: string;
    description: string;
    targetUrl: string;
  }>): Promise<unknown> {
    return await withGitHubApiStatusWriteSession({
      repositoryRoot: this.#repositoryRoot,
      repository: repository(input.repository),
      operation: async (api) => await executeGitHubApiOperation(api, {
        kind: 'create-commit-status', sha: sha(input.sha),
        status: {
          state: input.state,
          context: input.context, description: input.description, targetUrl: input.targetUrl
        }
      })
    });
  }

  async getWorkflowRun(input: Readonly<{ repository: string; runId: string }>): Promise<unknown> {
    return await this.#read(input.repository, { kind: 'workflow-run', runId: positiveId(input.runId, 'run id') });
  }

  async getWorkflowRunAttempt(input: Readonly<{
    repository: string;
    runId: string;
    runAttempt: number;
  }>): Promise<unknown> {
    if (!Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1) {
      fail('workflow run attempt is invalid.');
    }
    return await this.#read(input.repository, {
      kind: 'workflow-run-attempt', runId: positiveId(input.runId, 'run id'), runAttempt: input.runAttempt
    });
  }

  async getCheckSuite(input: Readonly<{ repository: string; checkSuiteId: number }>): Promise<unknown> {
    if (!Number.isSafeInteger(input.checkSuiteId) || input.checkSuiteId < 1) fail('check suite id is invalid.');
    return await this.#read(input.repository, { kind: 'check-suite', checkSuiteId: input.checkSuiteId });
  }

  async getArtifact(input: Readonly<{ repository: string; artifactId: string }>): Promise<unknown> {
    return await this.#read(input.repository, {
      kind: 'artifact', artifactId: Number(positiveId(input.artifactId, 'artifact id'))
    });
  }

  async downloadArtifact(input: Readonly<{
    repository: string;
    artifactId: string;
    expectedFileName: string;
  }>): Promise<Readonly<{ archiveBytes: Uint8Array; files: Readonly<Record<string, string>> }>> {
    const artifactId = Number(positiveId(input.artifactId, 'artifact id'));
    const archiveBytes = await withGitHubApiReadSession({
      repositoryRoot: this.#repositoryRoot,
      repository: repository(input.repository),
      operation: async (api) => await readGitHubApiBytes(api, { kind: 'artifact-archive', artifactId })
    });
    const source = await readZipTextFile({
      archiveBytes,
      expectedFileName: input.expectedFileName
    });
    return Object.freeze({
      archiveBytes,
      files: Object.freeze({ [input.expectedFileName]: source })
    });
  }
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) fail(`${label} is invalid.`);
  return value;
}

function fail(message: string): never {
  throw new Error(`VerificationAction GitHub provider ${message}`);
}

function digest(value: unknown): VerificationActionKeyDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

function bytesDigest(value: Uint8Array): VerificationActionKeyDigest {
  return `sha256:${rawSha256Hex(value)}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function repository(value: string): string {
  if (!/^[^/\s]+\/[^/\s]+$/u.test(value)) fail('repository is invalid.');
  return value;
}

const VERIFICATION_ACTION_ARTIFACT_FAMILIES = Object.freeze([
  VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX
]);

function artifactInventoryName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 1024 ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} is not bounded opaque provider data.`);
  }
  const family = VERIFICATION_ACTION_ARTIFACT_FAMILIES.find((prefix) =>
    value.startsWith(prefix));
  if (family !== undefined) {
    const suffix = value.startsWith(`${family}-`) ? value.slice(family.length + 1) : '';
    if (!/^[0-9a-f]{64}$/u.test(suffix)) fail(`${label} provider-family name is malformed.`);
    return value;
  }
  return value;
}

function sha(value: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) fail('exact SHA is invalid.');
  return value;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
      Number.isNaN(Date.parse(value))) fail(`${label} is invalid.`);
  return value;
}

function normalizeStatus(
  value: unknown,
  expectedSha: string,
  label: string,
  providerContext: string
): GitHubExactCommitStatusObservation {
  const status = record(value, label);
  const creator = record(status.creator, `${label}.creator`);
  const ownsContext = typeof status.context === 'string' &&
    status.context.toLowerCase() === providerContext;
  if (!Number.isSafeInteger(status.id) || Number(status.id) < 1 ||
      typeof status.node_id !== 'string' || status.node_id.length < 1 ||
      !['error', 'failure', 'pending', 'success'].includes(String(status.state)) ||
      typeof status.context !== 'string' || status.context.length < 1 || status.context.length > 100 ||
      (status.description !== null &&
        (typeof status.description !== 'string' || status.description.length > 140)) ||
      (status.target_url !== null &&
        (typeof status.target_url !== 'string' || status.target_url.length < 1)) ||
      (ownsContext && (typeof status.description !== 'string' ||
        typeof status.target_url !== 'string' || status.target_url.length < 1)) ||
      status.sha !== expectedSha || typeof creator.login !== 'string' ||
      !Number.isSafeInteger(creator.id) || Number(creator.id) < 1 ||
      typeof creator.node_id !== 'string' || creator.node_id.length < 1 ||
      typeof creator.type !== 'string' || creator.type.length < 1) {
    fail(`${label} fields are invalid.`);
  }
  const createdAt = iso(status.created_at, `${label}.created_at`);
  const updatedAt = iso(status.updated_at, `${label}.updated_at`);
  if (updatedAt !== createdAt) fail(`${label} was mutated after append.`);
  return Object.freeze({
    id: Number(status.id),
    nodeId: status.node_id,
    state: status.state as GitHubExactCommitStatusState,
    context: status.context,
    description: status.description as string | null,
    targetUrl: status.target_url as string | null,
    commitSha: expectedSha,
    createdAt,
    updatedAt,
    creator: Object.freeze({
      login: creator.login,
      id: Number(creator.id),
      nodeId: creator.node_id,
      type: creator.type
    })
  });
}

async function readGitHubExactCommitStatusHistory(
  transport: GitHubExactCommitStatusTransport,
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
  return (error instanceof Error ? error.message : String(error))
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
  transport: VerificationActionGitHubProviderTransport,
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
  transport: VerificationActionGitHubProviderTransport,
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
  transport: VerificationActionGitHubProviderTransport,
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
  transport: VerificationActionGitHubProviderTransport,
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
  transport: VerificationActionGitHubProviderTransport,
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
    artifactId: input.artifactId,
    expectedFileName: input.expectedFileName
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
  return Object.freeze({
    originId: input.artifactId,
    artifactName: input.expectedArtifactName,
    archiveDigest: bytesDigest(download.archiveBytes),
    expired: false,
    payload,
    referencedOrigin: origin
  });
}

type VerificationActionGitHubProviderResolution = Readonly<{
  repositoryId: number;
  repository: string;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
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
  transport: VerificationActionGitHubProviderTransport,
  repositoryName: string,
  runId: string,
  runAttempt: number
): Promise<readonly Record<string, unknown>[]> {
  const jobs: Record<string, unknown>[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const response = await transport.listWorkflowJobsPage({
      repository: repositoryName,
      runId,
      runAttempt,
      page
    });
    if (!Array.isArray(response.records) || response.records.length > 100 ||
        (response.hasNextPage && response.records.length !== 100)) {
      fail(`parent workflow job page ${page} is incomplete.`);
    }
    jobs.push(...response.records.map((entry, index) =>
      record(entry, `parent workflow job page ${page}[${index}]`)
    ));
    if (!response.hasNextPage) return Object.freeze(jobs);
  }
  fail('parent workflow job pagination exceeded the bounded 1000-page census.');
}

async function authenticateVerificationActionAuthority(
  transport: VerificationActionGitHubProviderTransport,
  authority: VerificationActionGitHubProviderAuthority,
  currentRole: 'parent-session' | 'child-action'
): Promise<Readonly<{
  resolution: VerificationActionGitHubProviderResolution;
  currentOrigin: VerificationActionProviderOrigin;
}>> {
  const envelope = parseCiVerificationActionProviderEnvelope(authority.envelope);
  const closure = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(authority.actionPlanClosure)
  );
  const request = record(envelope.proposal.sessionRequest, 'embedded Session request');
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

  const repositoryReadback = record(await transport.getRepository({ repository: repositoryName }),
    'repository readback');
  if (String(repositoryReadback.id ?? '') !== repositoryIdText ||
      repositoryReadback.full_name !== repositoryName || repositoryReadback.default_branch !== 'main') {
    fail('repository readback differs from the trusted runtime identity.');
  }

  const event = record(JSON.parse(readFileSync(requiredEnvironment('GITHUB_EVENT_PATH'), 'utf8')) as unknown,
    'repository dispatch event');
  if (String(record(event.repository, 'event repository').id ?? '') !== repositoryIdText) {
    fail('repository dispatch event repository identity mismatch.');
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
      String(parentMetadataRun.id ?? '') !== envelope.parentRunId) {
    fail('parent dispatch plan artifact metadata differs from its envelope.');
  }
  const parentDownload = await transport.downloadArtifact({
    repository: repositoryName,
    artifactId: envelope.parentDispatchPlanArtifactId,
    expectedFileName: CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE
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
  if (permission.permission !== parentPlan.parentActor.permission) {
    fail('parent actor live permission differs from the dispatch plan.');
  }
  const jobs = await readCompleteParentJobs(
    transport, repositoryName, envelope.parentRunId, envelope.parentRunAttempt
  );
  const parentJobs = jobs.filter((job) => String(job.id ?? '') === envelope.parentJobId);
  const steps = parentJobs.length === 1 && Array.isArray(parentJobs[0]!.steps)
    ? parentJobs[0]!.steps.map((entry, index) => record(entry, `parent plan job step[${index}]`))
    : [];
  const planSteps = steps.filter((step) => step.name === envelope.parentPlanStepName);
  if (parentJobs.length !== 1 || parentJobs[0]!.name !== envelope.parentJobName ||
      String(parentJobs[0]!.run_id ?? '') !== envelope.parentRunId ||
      parentJobs[0]!.run_attempt !== envelope.parentRunAttempt ||
      parentJobs[0]!.head_sha !== request.expectedBaseSha ||
      !['in_progress', 'completed'].includes(String(parentJobs[0]!.status)) ||
      (parentJobs[0]!.status === 'completed' && parentJobs[0]!.conclusion !== 'success') ||
      planSteps.length !== 1 ||
      planSteps[0]!.status !== 'completed' || planSteps[0]!.conclusion !== 'success') {
    fail('parent plan-producing job and step provenance mismatch.');
  }

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
    const parentCheckSuiteId = Number(parentRun.check_suite_id);
    const parentWorkflowId = Number(parentRun.workflow_id);
    if (!Number.isSafeInteger(parentCheckSuiteId) || parentCheckSuiteId < 1 ||
        !Number.isSafeInteger(parentWorkflowId) || parentWorkflowId < 1) {
      fail('parent external Session run lacks workflow/check-suite provenance.');
    }
    const workflow = record(await transport.getWorkflow({ repository: repositoryName }),
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
      resolution: Object.freeze({
        repositoryId,
        repository: repositoryName,
        actionKey: envelope.proposal.proposedActionKey,
        candidateSha: sha(matchingOperation.candidate.headSha)
      }),
      currentOrigin: parentOrigin
    });
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
  const workflow = record(await transport.getWorkflow({ repository: repositoryName }),
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
  return Object.freeze({
    resolution: Object.freeze({
      repositoryId,
      repository: repositoryName,
      actionKey: envelope.proposal.proposedActionKey,
      candidateSha: sha(matchingOperation.candidate.headSha)
    }),
    currentOrigin
  });
}

async function readVerificationActionGitHubProviderSnapshot(
  transport: VerificationActionGitHubProviderTransport,
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
        parsePayload: (value) => parseVerificationActionTerminalArtifact(
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
      const artifact = parseVerificationActionTerminalArtifact(
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
    executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
    statusReadback: snapshot.statusReadback,
    startObservations: snapshot.startObservations,
    terminalObservations,
    terminalAnchorObservations: snapshot.terminalAnchorObservations
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
 * The sole public GitHub provider transaction. Callers choose a semantic
 * operation and supply canonical Action objects; raw REST paths, status fields,
 * target URLs, pagination, and the mutation transport remain module-private.
 */
export async function ensureVerificationActionGitHubProviderTransaction(input: Readonly<{
  repositoryRoot: string;
  authority: VerificationActionGitHubProviderAuthority;
  intent: VerificationActionGitHubProviderIntent;
}>): Promise<VerificationActionGitHubProviderTransactionResult> {
  const transport = new GitHubApiVerificationActionTransport(input.repositoryRoot);
  const authenticated = await authenticateVerificationActionAuthority(
    transport,
    input.authority,
    input.intent.kind === 'coordinate-parent' || input.intent.kind === 'dispatch-child'
      ? 'parent-session'
      : 'child-action'
  );
  const { resolution, currentOrigin } = authenticated;
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
}
