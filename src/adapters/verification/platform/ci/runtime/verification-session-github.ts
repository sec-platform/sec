/** GitHub observation and mutation adapter for the VerificationSession operator. */

/**
 * Keep transport effects, live Review authority and principal decisions here.
 * Response decoding is separate because provider wire-shape changes must not
 * acquire API/session capabilities or mint authority-bearing observations.
 */
import type { GitHubIssueReference } from '../../../../../execution/verification/integration.ts';
import type { GitHubActionsArtifactObservation, GitHubCandidateObservation, GitHubCheckObservation, GitHubComparisonObservation, GitHubReviewBarrierObservation, GitHubWorkflowRunObservation, PlatformEnforcementObservation, ReviewPrincipal, SessionDigest } from '../../../../../execution/verification/session.ts';


import type { GitHubIssueCommentObservation, GitHubPage, GitHubPullRequestFileInventory, GitHubPullRequestFileInventoryExpectation, GitHubReviewObservation, GitHubReviewThreadObservation } from './verification-session-github-response.ts';
import {
  assertSha,
  assertSuccessfulGraphqlReviewConnection,
  bindProviderShapeSource,
  boundedText,
  canonicalChangedPaths,
  fail,
  GITHUB_OPEN_PULL_REQUEST_MAXIMUM_PAGES,
  GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE,
  githubOpenPullRequestPage,
  GitHubProviderResponseShapeError,
  hash,
  issueCommentObservation,
  parseGitHubCheckPages,
  parseGitHubOpenPullRequestCensus,
  parseGitHubPullRequestFileInventory,
  parseGitHubReviewPages,
  parseGitHubReviewThreadPages,
  parseGitHubWorkflowJobsForAttempt,
  parseJson,
  providerPageInfo,
  providerResponseShapeDigest,
  providerShapeSource,
  repoParts,
  rethrowProviderResponseShape
} from './verification-session-github-response.ts';

export {
  parseGitHubCheckPages, parseGitHubOpenPullRequestCensus,
  parseGitHubPullRequestFileInventory, parseGitHubReviewPages,
  parseGitHubReviewThreadPages, parseGitHubWorkflowJobsForAttempt
} from './verification-session-github-response.ts';
export type { GitHubIssueCommentObservation, GitHubPage, GitHubPullRequestFileInventory, GitHubPullRequestFileInventoryExpectation, GitHubReviewObservation, GitHubReviewThreadObservation } from './verification-session-github-response.ts';

import { currentGitHubCredentialStoreIdentity } from '../../../../providers/github-api/credential-store.ts';
import {
  currentGitHubApiCapability, executeGitHubApiOperation,
  GitHubApiGraphqlResponseError,
  GitHubApiProviderError,
  inspectGitHubApiCapability, withGitHubApiVerificationSession, type GitHubApiOperation
} from '../../../../providers/github-api/operation-session.ts';
import { normalizeGitHubRepositoryPermission } from '../../../../providers/github-api/repository-permission.ts';
import {
  GITHUB_PRINCIPAL_NODE_QUERY,
  GITHUB_PULL_REQUEST_CLOSING_QUERY,
  GITHUB_REVIEW_REQUESTS_QUERY,
  GITHUB_REVIEWS_QUERY,
  GITHUB_THREAD_COMMENTS_QUERY,
  GITHUB_THREADS_QUERY,
  isGitHubGraphQLSchemaFailure
} from '../../../../providers/github-api/verification-queries.ts';

import type { GitHubWorkflowJobObservation } from '../../../../providers/github-api/contract.ts';
import { parseGitHubPullRequestClosingFactsPage, type GitHubPullRequestClosingFacts } from '../../../../self-hosting/control/issues/disposition.ts';
import { createMainAuthorityRulesetReceipt } from '../../../../self-hosting/control/main-health/authority-ruleset.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, matchesCiCompilerWorkflowRunIdentity } from '../../action/contract/provider.ts';
import { classifyProviderDiagnosticTextV1 } from '../../provider/contract/capability.ts';

import { createReviewSnapshotDigest, isCodexCleanReviewAboutBlock, isCodexCleanReviewVerdict, REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, SEC_REVIEW_STABILITY_POLICY } from '../../review/contract/stability.ts';
import {
  CI_VERIFICATION_SESSION_ARTIFACT_PREFIX
} from '../contract/revision.ts';
import type { VerificationSessionHostedRequest } from '../contract/session-request.ts';

const validatedClearReviewObservations = new WeakSet<object>();
const authorityBearingGitHubAdapters = new WeakSet<object>();

export function assertGitHubReviewAuthorityObservation(
  observation: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>
): void {
  if (!validatedClearReviewObservations.has(observation)) {
    throw new Error('Review receipt authority must be a live observation produced by the private GitHub adapter.');
  }
}

export interface GitHubReviewRequestObservation {
  nodeId: string;
  login: string;
  kind: 'user' | 'team';
}

export interface GitHubAppReviewCommentObservation {
  id: string;
  authorNodeId: string;
  appId: number;
  body: string;
  createdAt: string;
}

export type GitHubReviewProviderAvailabilityObservation = Readonly<{
  status: 'unavailable';
  reasonCode: 'provider-quota-unavailable' | 'provider-revalidation-consumed';
  receiptRef: SessionDigest;
  sourceCommentId: string;
  sourceObservedAt: string;
  censusDigest: SessionDigest;
  observedAt: string;
}> | Readonly<{
  status: 'no-current-negative';
  revalidationCommentId: string | null;
  revalidationObservedAt: string | null;
  revalidationDigest: SessionDigest | null;
  censusDigest: SessionDigest;
  observedAt: string;
}> | Readonly<{
  status: 'unresolved';
  reason: 'pagination-budget-exhausted' | 'provider-comment-page-drift' | 'provider-comment-ordering-invalid';
  censusDigest: SessionDigest;
  observedAt: string;
}>;

export type GitHubCommitResolutionObservation = Readonly<{
  repository: string;
  locator: string;
  status: 'resolved';
  commitSha: string;
  treeSha: string;
  responseDigest: SessionDigest;
}> | Readonly<{
  repository: string;
  locator: string;
  status: 'missing' | 'ambiguous';
  commitSha: null;
  treeSha: null;
  responseDigest: SessionDigest;
}>;

export type VerificationSessionWorkflowJoin = Readonly<{
  status: 'joined';
  reason: 'active-run' | 'artifact-publication-window';
  runIds: readonly string[];
}> | Readonly<{
  status: 'redispatch-eligible';
  reason: 'no-matching-run' | 'terminal-run' | 'artifact-publication-window-expired';
  runIds: readonly string[];
}>;

const VERIFICATION_SESSION_ARTIFACT_PUBLICATION_WINDOW_MS = 10 * 60 * 1000;

interface GitHubPrincipalObservation {
  login: string;
  nodeId: string;
  permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
}

class GitHubApiFailure extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = 'GitHubApiFailure';
  }
}

interface VerificationSessionGitHubTransport {
  candidate(repository: string, prNumber: number): GitHubCandidateObservation | Promise<GitHubCandidateObservation>;
  pullRequestClosingFacts(repository: string, prNumber: number): GitHubPullRequestClosingFacts | Promise<GitHubPullRequestClosingFacts>;
  reviewPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewObservation> | Promise<GitHubPage<GitHubReviewObservation>>;
  threadPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewThreadObservation> | Promise<GitHubPage<GitHubReviewThreadObservation>>;
  reviewRequestPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewRequestObservation> | Promise<GitHubPage<GitHubReviewRequestObservation>>;
  appCommentPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubAppReviewCommentObservation> | Promise<GitHubPage<GitHubAppReviewCommentObservation>>;
  issueCommentPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubIssueCommentObservation> | Promise<GitHubPage<GitHubIssueCommentObservation>>;
  repositoryIssueCommentPage(repository: string, after: string | null): GitHubPage<GitHubIssueCommentObservation> | Promise<GitHubPage<GitHubIssueCommentObservation>>;
  resolveCommitOid(repository: string, locator: string): GitHubCommitResolutionObservation | Promise<GitHubCommitResolutionObservation>;
  collaboratorPermission(repository: string, login: string): 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none' | Promise<'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none'>;
  checkPage(repository: string, headSha: string, after: string | null): GitHubPage<GitHubCheckObservation> | Promise<GitHubPage<GitHubCheckObservation>>;
  workflowRunPage(repository: string, headSha: string, after: string | null): GitHubPage<GitHubWorkflowRunObservation> | Promise<GitHubPage<GitHubWorkflowRunObservation>>;
  workflowJobsForAttempt?(repository: string, runId: string, runAttempt: number): readonly GitHubWorkflowJobObservation[] | Promise<readonly GitHubWorkflowJobObservation[]>;
  repositoryRulesets(repository: string): unknown | Promise<unknown>;
  dispatchVerificationSession(repository: string, request: VerificationSessionHostedRequest): void | Promise<void>;
  pullRequestFileInventory?(
    repository: string,
    prNumber: number
  ): GitHubPullRequestFileInventory | Promise<GitHubPullRequestFileInventory>;
  blobText?(repository: string, ref: string, path: string): string | Promise<string>;
  comparison?(repository: string, baseSha: string, headSha: string): GitHubComparisonObservation | Promise<GitHubComparisonObservation>;
  openPullRequestCountForHead?(repository: string, headSha: string): number | Promise<number>;
  principal?(repository: string, login: string): GitHubPrincipalObservation | Promise<GitHubPrincipalObservation>;
  principalByNodeId?(repository: string, nodeId: string): GitHubPrincipalObservation | Promise<GitHubPrincipalObservation>;
  viewerPrincipal?(repository: string): GitHubPrincipalObservation | Promise<GitHubPrincipalObservation>;
  actionsArtifact?(repository: string, artifactId: string): GitHubActionsArtifactObservation | Promise<GitHubActionsArtifactObservation>;
  actionsArtifactsForRun?(repository: string, runId: string): readonly GitHubActionsArtifactObservation[] | Promise<readonly GitHubActionsArtifactObservation[]>;
  actionsArtifacts?(repository: string): readonly GitHubActionsArtifactObservation[] | Promise<readonly GitHubActionsArtifactObservation[]>;
  downloadArtifactText?(repository: string, artifact: GitHubActionsArtifactObservation, fileName: string): string | Promise<string>;
}

const VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_SCHEMA =
  'sec-verification-session-review-locator-comment-v3' as const;
export const VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER =
  '<!-- sec-verification-session-review-locator-v3 -->' as const;
const VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_SCHEMA =
  'sec-verification-session-review-wakeup-comment-v1' as const;
export const VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER =
  '<!-- sec-verification-session-review-wakeup-v1 -->' as const;
const VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_SCHEMA =
  'sec-review-provider-revalidation-v1' as const;
export const VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_MARKER =
  '<!-- sec-review-provider-revalidation-v1 -->' as const;

export const PROVIDER_SCHEMA_UNSUPPORTED_STATUS = 'provider-schema-unsupported' as const;
const RETIRED_REVIEW_WAKEUP_TOMBSTONE =
  '<!-- retired: codex review trigger transport noise -->' as const;
const REVIEW_PROVIDER_COMMENT_MAXIMUM_PAGES = 64;

/** Pure signal routing only; returning true never grants Review or mutation authority. */
export function shouldPublishMaintainerReviewWakeup(input: Readonly<{
  reviewBarrierStatus: 'clear' | 'waiting' | 'blocked' | typeof PROVIDER_SCHEMA_UNSUPPORTED_STATUS;
  localVerificationStatus: 'passed' | 'failed' | 'blocked' | null;
  hostedArtifactPresent: boolean;
}>): boolean {
  return input.reviewBarrierStatus === 'waiting'
    && input.localVerificationStatus === 'passed'
    && !input.hostedArtifactPresent;
}

/**
 * Typed provider schema drift (Issue #347 section C). Unknown/removed GitHub
 * GraphQL fields/layouts become this typed state with a bounded reasonCode and
 * a response digest; raw GitHub error prose never enters the control plane.
 */
export interface GitHubProviderSchemaFailure {
  readonly status: typeof PROVIDER_SCHEMA_UNSUPPORTED_STATUS;
  readonly reasonCode: string;
  readonly responseDigest: SessionDigest;
}

class GitHubProviderSchemaUnsupportedError extends Error {
  readonly code = PROVIDER_SCHEMA_UNSUPPORTED_STATUS;
  readonly reasonCode: string;
  readonly responseDigest: SessionDigest;
  constructor(failure: GitHubProviderSchemaFailure) {
    super(`${PROVIDER_SCHEMA_UNSUPPORTED_STATUS}: ${failure.reasonCode} (${failure.responseDigest})`);
    this.name = 'GitHubProviderSchemaUnsupportedError';
    this.reasonCode = failure.reasonCode;
    this.responseDigest = failure.responseDigest;
  }
}

export function classifyGitHubGraphQLSchemaFailure(source: string): GitHubProviderSchemaFailure | null {
  const normalized = source.replaceAll('\r\n', '\n');
  if (!isGitHubGraphQLSchemaFailure(normalized)) return null;
  return Object.freeze({
    status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
    reasonCode: 'github-graphql-schema-unsupported',
    responseDigest: hash(Object.freeze({ schema: 'sec-provider-graphql-schema-failure-v1', source: normalized }))
  });
}

export function isGitHubProviderSchemaUnsupportedError(
  error: unknown
): error is GitHubProviderSchemaUnsupportedError {
  return error instanceof GitHubProviderSchemaUnsupportedError;
}

interface VerificationSessionReviewLocatorComment {
  schema: typeof VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_SCHEMA;
  repository: string;
  sessionRevision: SessionDigest;
  operationId: SessionDigest;
  locatorDigest: SessionDigest;
  prNumber: number;
  headSha: string;
  headTreeSha: string;
  sourceRunId: string;
  sourceRunAttempt: number;
  workflowRef: string;
  publicationDigest: SessionDigest;
}

function createReviewLocatorComment(input: Omit<VerificationSessionReviewLocatorComment,
  'schema' | 'locatorDigest' | 'publicationDigest'>): VerificationSessionReviewLocatorComment {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input.repository)
    || !/^sha256:[0-9a-f]{64}$/u.test(input.sessionRevision)
    || !/^sha256:[0-9a-f]{64}$/u.test(input.operationId)
    || !Number.isSafeInteger(input.prNumber) || input.prNumber < 1
    || !/^[0-9a-f]{40}$/u.test(input.headSha)
    || !/^[0-9a-f]{40}$/u.test(input.headTreeSha)
    || !/^[1-9][0-9]*$/u.test(input.sourceRunId)
    || !Number.isSafeInteger(input.sourceRunAttempt) || input.sourceRunAttempt < 1
    || !/^\.github\/workflows\/compiler-pr-validation\.yml@[0-9a-f]{40}$/u.test(input.workflowRef)) {
    fail('hosted Review locator identity is invalid.');
  }
  const locatorDigest = hash({ repository: input.repository,
    sessionRevision: input.sessionRevision, operationId: input.operationId,
    prNumber: input.prNumber, headSha: input.headSha, headTreeSha: input.headTreeSha });
  const payload = Object.freeze({ schema: VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_SCHEMA,
    repository: input.repository, sessionRevision: input.sessionRevision,
    operationId: input.operationId, locatorDigest, prNumber: input.prNumber,
    headSha: input.headSha, headTreeSha: input.headTreeSha,
    sourceRunId: input.sourceRunId, sourceRunAttempt: input.sourceRunAttempt,
    workflowRef: input.workflowRef });
  return Object.freeze({ ...payload, publicationDigest: hash(payload) });
}

function renderReviewLocatorComment(value: VerificationSessionReviewLocatorComment): string {
  return `${VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER}\n` +
    `\`\`\`json\n${encodeVerificationActionData(value)}\n\`\`\``;
}

function parseReviewLocatorComment(source: string): VerificationSessionReviewLocatorComment | null {
  if (!source.includes(VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER)) return null;
  const prefix = `${VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER}\n\`\`\`json\n`;
  const suffix = '\n```';
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) fail('hosted Review locator comment shape is invalid.');
  const value: unknown = JSON.parse(source.slice(prefix.length, -suffix.length));
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('hosted Review locator payload must be an object.');
  const record = value as Record<string, unknown>;
  const expected = ['schema', 'repository', 'sessionRevision', 'operationId', 'locatorDigest', 'prNumber',
    'headSha', 'headTreeSha', 'sourceRunId', 'sourceRunAttempt', 'workflowRef', 'publicationDigest'].sort();
  if (Object.keys(record).sort().join('\0') !== expected.join('\0')
    || record.schema !== VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_SCHEMA) {
    fail('hosted Review locator payload keys/schema are invalid.');
  }
  const rebuilt = createReviewLocatorComment({ repository: record.repository as string,
    sessionRevision: record.sessionRevision as SessionDigest,
    operationId: record.operationId as SessionDigest, prNumber: record.prNumber as number,
    headSha: record.headSha as string, headTreeSha: record.headTreeSha as string,
    sourceRunId: record.sourceRunId as string, sourceRunAttempt: record.sourceRunAttempt as number,
    workflowRef: record.workflowRef as string });
  if (rebuilt.locatorDigest !== record.locatorDigest
    || rebuilt.publicationDigest !== record.publicationDigest
    || source !== renderReviewLocatorComment(rebuilt)) fail('hosted Review locator comment bytes/digest mismatch.');
  return rebuilt;
}

interface VerificationSessionReviewWakeupComment {
  schema: typeof VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_SCHEMA;
  repository: string;
  sessionRevision: SessionDigest;
  operationId: SessionDigest;
  requestOperationId: SessionDigest;
  prNumber: number;
  headSha: string;
  headTreeSha: string;
  publisherLogin: string;
  publisherNodeId: string;
  wakeupDigest: SessionDigest;
}

function createReviewWakeupComment(input: Omit<VerificationSessionReviewWakeupComment,
  'schema' | 'wakeupDigest'>): VerificationSessionReviewWakeupComment {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input.repository)
    || !/^sha256:[0-9a-f]{64}$/u.test(input.sessionRevision)
    || !/^sha256:[0-9a-f]{64}$/u.test(input.operationId)
    || !/^sha256:[0-9a-f]{64}$/u.test(input.requestOperationId)
    || !Number.isSafeInteger(input.prNumber) || input.prNumber < 1
    || !/^[0-9a-f]{40}$/u.test(input.headSha)
    || !/^[0-9a-f]{40}$/u.test(input.headTreeSha)
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(input.publisherLogin)
    || input.publisherNodeId.length === 0 || input.publisherNodeId.length > 256
    || !/^[\x21-\x7e]+$/u.test(input.publisherNodeId)) fail('maintainer Review wake-up identity is invalid.');
  const payload = Object.freeze({ schema: VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_SCHEMA,
    repository: input.repository, sessionRevision: input.sessionRevision,
    operationId: input.operationId, requestOperationId: input.requestOperationId,
    prNumber: input.prNumber, headSha: input.headSha, headTreeSha: input.headTreeSha,
    publisherLogin: input.publisherLogin, publisherNodeId: input.publisherNodeId });
  return Object.freeze({ ...payload, wakeupDigest: hash(payload) });
}

function renderReviewWakeupComment(value: VerificationSessionReviewWakeupComment): string {
  return `@codex review\n\n${VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER}\n` +
    `\`\`\`json\n${encodeVerificationActionData(value)}\n\`\`\``;
}

function parseReviewWakeupComment(source: string): VerificationSessionReviewWakeupComment | null {
  if (!source.includes(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER)) return null;
  const prefix = `@codex review\n\n${VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER}\n\`\`\`json\n`;
  const suffix = '\n```';
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) fail('maintainer Review wake-up comment shape is invalid.');
  const value: unknown = JSON.parse(source.slice(prefix.length, -suffix.length));
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('maintainer Review wake-up payload must be an object.');
  const record = value as Record<string, unknown>;
  const expected = ['schema', 'repository', 'sessionRevision', 'operationId', 'requestOperationId',
    'prNumber', 'headSha', 'headTreeSha', 'publisherLogin', 'publisherNodeId', 'wakeupDigest'].sort();
  if (Object.keys(record).sort().join('\0') !== expected.join('\0')
    || record.schema !== VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_SCHEMA) {
    fail('maintainer Review wake-up payload keys/schema are invalid.');
  }
  const rebuilt = createReviewWakeupComment({ repository: record.repository as string,
    sessionRevision: record.sessionRevision as SessionDigest,
    operationId: record.operationId as SessionDigest,
    requestOperationId: record.requestOperationId as SessionDigest,
    prNumber: record.prNumber as number, headSha: record.headSha as string,
    headTreeSha: record.headTreeSha as string,
    publisherLogin: record.publisherLogin as string,
    publisherNodeId: record.publisherNodeId as string });
  if (rebuilt.wakeupDigest !== record.wakeupDigest
    || source !== renderReviewWakeupComment(rebuilt)) fail('maintainer Review wake-up comment bytes/digest mismatch.');
  return rebuilt;
}

interface VerificationSessionReviewProviderRevalidationComment {
  schema: typeof VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_SCHEMA;
  repository: string;
  capability: 'codex-review';
  prNumber: number;
  headSha: string;
  headTreeSha: string;
  publisherNodeId: string;
  revalidationDigest: SessionDigest;
}

function createReviewProviderRevalidationComment(input: Omit<
  VerificationSessionReviewProviderRevalidationComment,
  'schema' | 'capability' | 'revalidationDigest'
>): VerificationSessionReviewProviderRevalidationComment {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input.repository)
    || !Number.isSafeInteger(input.prNumber) || input.prNumber < 1
    || !/^[0-9a-f]{40}$/u.test(input.headSha)
    || !/^[0-9a-f]{40}$/u.test(input.headTreeSha)
    || input.publisherNodeId.length === 0 || input.publisherNodeId.length > 256
    || !/^[\x21-\x7e]+$/u.test(input.publisherNodeId)) {
    fail('Review provider revalidation identity is invalid.');
  }
  const payload = Object.freeze({
    schema: VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_SCHEMA,
    repository: input.repository,
    capability: 'codex-review' as const,
    prNumber: input.prNumber,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    publisherNodeId: input.publisherNodeId
  });
  return Object.freeze({ ...payload, revalidationDigest: hash(payload) });
}

function renderReviewProviderRevalidationComment(
  value: VerificationSessionReviewProviderRevalidationComment
): string {
  return `${VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_MARKER}\n${encodeVerificationActionData(value)}`;
}

function parseReviewProviderRevalidationComment(
  source: string
): VerificationSessionReviewProviderRevalidationComment | null {
  if (!source.includes(VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_MARKER)) return null;
  const prefix = `${VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_MARKER}\n`;
  if (!source.startsWith(prefix) || source.includes('\r')) {
    fail('Review provider revalidation comment shape is invalid.');
  }
  const value: unknown = JSON.parse(source.slice(prefix.length));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Review provider revalidation payload must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expected = [
    'schema', 'repository', 'capability', 'prNumber', 'headSha', 'headTreeSha',
    'publisherNodeId', 'revalidationDigest'
  ].sort();
  if (Object.keys(record).sort().join('\0') !== expected.join('\0')
      || record.schema !== VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_SCHEMA
      || record.capability !== 'codex-review') {
    fail('Review provider revalidation payload keys/schema are invalid.');
  }
  const rebuilt = createReviewProviderRevalidationComment({
    repository: record.repository as string,
    prNumber: record.prNumber as number,
    headSha: record.headSha as string,
    headTreeSha: record.headTreeSha as string,
    publisherNodeId: record.publisherNodeId as string
  });
  if (rebuilt.revalidationDigest !== record.revalidationDigest
      || source !== renderReviewProviderRevalidationComment(rebuilt)) {
    fail('Review provider revalidation comment bytes/digest mismatch.');
  }
  return rebuilt;
}

export function createReviewProviderRevalidationCommentBody(input: Readonly<{
  repository: string;
  prNumber: number;
  headSha: string;
  headTreeSha: string;
  publisherNodeId: string;
}>): Readonly<{ body: string; revalidationDigest: SessionDigest }> {
  const receipt = createReviewProviderRevalidationComment(input);
  return Object.freeze({
    body: renderReviewProviderRevalidationComment(receipt),
    revalidationDigest: receipt.revalidationDigest
  });
}
function trustedHostedPublisher(comment: GitHubIssueCommentObservation): boolean {
  const policy = CI_GITHUB_ACTIONS_IDENTITY_POLICY;
  if (comment.authorLogin !== policy.bot.login || comment.authorId !== policy.bot.id
    || comment.authorNodeId !== policy.bot.nodeId || comment.authorType !== policy.bot.type) return false;
  return comment.performedViaGitHubApp !== null
    && comment.performedViaGitHubApp.id === policy.app.id
    && comment.performedViaGitHubApp.nodeId === policy.app.nodeId
    && comment.performedViaGitHubApp.slug === policy.app.slug;
}

export type GitHubObservationFailureClassification =
  | Readonly<{ kind: 'provider-invalid'; responseDigest: SessionDigest }>
  | Readonly<{ kind: 'transport-unavailable'; diagnostic: string }>;

/**
 * Provider failure routing for physical GitHub observations. A transport that
 * cannot be reached is absence; bytes that were reached but violate the
 * provider contract are invalid Evidence and must remain fail-closed.
 */
export function classifyGitHubObservationFailureV1(
  error: unknown
): GitHubObservationFailureClassification {
  if (error instanceof GitHubProviderResponseShapeError) {
    return Object.freeze({
      kind: 'provider-invalid',
      responseDigest: providerResponseShapeDigest(error)
    });
  }
  if (error instanceof GitHubProviderSchemaUnsupportedError) {
    return Object.freeze({ kind: 'provider-invalid', responseDigest: error.responseDigest });
  }
  if (error instanceof GitHubApiFailure) {
    return Object.freeze({
      kind: 'transport-unavailable',
      diagnostic: `${error.name}:${error.message}`
    });
  }
  let identity: Readonly<{ type: string; name: string | null; message: string | null }>;
  try {
    identity = Object.freeze({
      type: typeof error,
      name: error instanceof Error ? error.name : null,
      message: error instanceof Error ? error.message : String(error)
    });
  } catch {
    identity = Object.freeze({ type: typeof error, name: null, message: null });
  }
  return Object.freeze({
    kind: 'provider-invalid',
    responseDigest: hash(Object.freeze({
      schema: 'sec-github-observation-unknown-failure-v1',
      identity
    }))
  });
}

function assertCursorProgress(previous: string | null, page: GitHubPage<unknown>, label: string): string | null {
  if (!page.hasNextPage) {
    if (page.endCursor !== null && typeof page.endCursor !== 'string') fail(`${label} end cursor is invalid.`);
    return null;
  }
  if (page.endCursor === null || page.endCursor.length === 0 || page.endCursor === previous) {
    fail(`${label} pagination did not advance.`);
  }
  return page.endCursor;
}

async function collectPages<T>(
  label: string,
  read: (cursor: string | null) => GitHubPage<T> | Promise<GitHubPage<T>>
): Promise<{ nodes: T[]; pageDigests: SessionDigest[]; sourceBundles: unknown[] }> {
  const nodes: T[] = [];
  const pageDigests: SessionDigest[] = [];
  const sourceBundles: unknown[] = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const page = await read(cursor);
    if (!/^sha256:[0-9a-f]{64}$/u.test(page.pageDigest)) fail(`${label} page digest is invalid.`);
    nodes.push(...page.nodes);
    pageDigests.push(page.pageDigest);
    sourceBundles.push(providerShapeSource(page));
    const next = assertCursorProgress(cursor, page, label);
    if (next === null) return { nodes, pageDigests, sourceBundles };
    cursor = next;
  }
  return fail(`${label} pagination exceeded the bounded page count.`);
}

function canonicalInstant(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u
    .exec(result);
  if (match === null) fail(`${label} must be an RFC3339 timestamp.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const maximumDay = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  const offsetMatch = offset === 'Z' ? null : /^([+-])(\d{2}):(\d{2})$/u.exec(offset!);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > maximumDay
    || hour > 23 || minute > 59 || second > 59
    || (offsetMatch !== null
      && (Number(offsetMatch[2]) > 23 || Number(offsetMatch[3]) > 59))) {
    fail(`${label} must be an RFC3339 timestamp.`);
  }
  const instant = new Date(result);
  if (!Number.isFinite(instant.getTime())) fail(`${label} must be an RFC3339 timestamp.`);
  return instant.toISOString();
}

function positiveDecimal(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) fail(`${label} must be positive decimal text.`);
  return value;
}

type ActionsArtifactAttemptAuthority =
  | Readonly<{ kind: 'artifact-name'; runAttempt: number }>
  | Readonly<{ kind: 'workflow-run'; runAttempt: number }>;

const VERIFICATION_SESSION_ARTIFACT_NAME_PATTERN = new RegExp(
  `^${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-pr-[1-9][0-9]*-session-[0-9a-f]{64}` +
    '-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$',
  'u'
);

const SESSION_ATTEMPT_BOUND_ARTIFACT_NAME_PATTERNS = Object.freeze([
  /^sec-verification-action-parent-dispatch-plan-v2-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u,
  VERIFICATION_SESSION_ARTIFACT_NAME_PATTERN,
  /^sec-verification-action-(?:resolution|prepared|raw)-v2-[0-9a-f]{64}-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u,
  /^sec-merge-gate-result-v2-pr-[1-9][0-9]*-session-[0-9a-f]{64}-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u,
  /^sec-branch-closeout-recovery-v1-pr-[1-9][0-9]*-session-[0-9a-f]{64}-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u,
  /^sec-closeout-projections-v1-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u
]);

const SESSION_ATTEMPT_BOUND_ARTIFACT_PREFIXES = Object.freeze([
  'sec-verification-action-parent-dispatch-plan-v2-',
  `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-`,
  'sec-verification-action-resolution-v2-',
  'sec-verification-action-prepared-v2-',
  'sec-verification-action-raw-v2-',
  'sec-merge-gate-result-v2-',
  'sec-branch-closeout-recovery-v1-',
  'sec-closeout-projections-v1-'
]);

function classifyActionsArtifactAttemptAuthority(
  artifactName: string,
  runId: string,
  workflowRunAttempt: number
): ActionsArtifactAttemptAuthority {
  if (!Number.isSafeInteger(workflowRunAttempt) || workflowRunAttempt < 1) {
    fail('Actions artifact workflow run attempt is invalid.');
  }
  for (const pattern of SESSION_ATTEMPT_BOUND_ARTIFACT_NAME_PATTERNS) {
    const identity = pattern.exec(artifactName);
    if (identity === null) continue;
    const producingRunAttempt = Number(identity[2]);
    if (identity[1] !== runId || !Number.isSafeInteger(producingRunAttempt)
      || producingRunAttempt < 1) {
      fail('Attempt-bound Session artifact name does not bind one canonical producing run/attempt.');
    }
    return Object.freeze({ kind: 'artifact-name', runAttempt: producingRunAttempt });
  }
  if (SESSION_ATTEMPT_BOUND_ARTIFACT_PREFIXES.some((prefix) => artifactName.startsWith(prefix))) {
    fail('Attempt-bound Session artifact name is not canonical.');
  }
  return Object.freeze({ kind: 'workflow-run', runAttempt: workflowRunAttempt });
}

type GitHubRepositoryActionsArtifactSummary = Readonly<{
  artifactId: string;
  artifactName: string;
  archiveDigest: SessionDigest | null;
  expired: boolean;
  family: 'session' | 'unrelated';
  expectedRunId: string | null;
  sessionRunAttempt: number | null;
}>;

type GitHubRepositoryActionsArtifactInventory = Readonly<{
  schema: 'sec-github-repository-actions-artifact-inventory-v1';
  repository: string;
  totalCount: number;
  perPage: 100;
  paginationComplete: true;
  pageDigests: readonly SessionDigest[];
  artifacts: readonly GitHubRepositoryActionsArtifactSummary[];
  sessionArtifactIds: readonly string[];
  inventoryDigest: SessionDigest;
}>;

function boundedOpaqueActionsArtifactName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 1024
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be bounded opaque provider text.`);
  }
  return value;
}

export async function evaluateGitHubRepositoryActionsArtifactInventory(input: Readonly<{
  repository: string;
  source: unknown;
  observeArtifact(summary: GitHubRepositoryActionsArtifactSummary): GitHubActionsArtifactObservation | Promise<GitHubActionsArtifactObservation>;
}>): Promise<Readonly<{
  inventory: GitHubRepositoryActionsArtifactInventory;
  artifacts: readonly GitHubActionsArtifactObservation[];
}>> {
  repoParts(input.repository);
  const pages = typeof input.source === 'string'
    ? parseJson<unknown>(input.source, 'repository Actions artifact inventory')
    : input.source;
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 1000) {
    fail('repository Actions artifact pagination is invalid or exceeds its bounded census.');
  }
  const pageDigests: SessionDigest[] = [];
  const opaqueArtifacts: Array<Readonly<{
    artifactId: string;
    artifactName: string;
    archiveDigest: SessionDigest | null;
    expired: boolean;
  }>> = [];
  const artifactIds = new Set<string>();
  let totalCount: number | null = null;
  let finalPageArtifactCount = 0;
  for (const [pageIndex, rawPage] of pages.entries()) {
    const page = rawPage !== null && typeof rawPage === 'object' && !Array.isArray(rawPage)
      ? rawPage as Record<string, unknown>
      : fail(`repository Actions artifact page ${pageIndex + 1} must be an object.`);
    if (!Number.isSafeInteger(page.total_count) || Number(page.total_count) < 0
      || !Array.isArray(page.artifacts) || page.artifacts.length > 100
      || (pageIndex < pages.length - 1 && page.artifacts.length !== 100)) {
      fail(`repository Actions artifact page ${pageIndex + 1} is incomplete or malformed.`);
    }
    const pageTotalCount = Number(page.total_count);
    finalPageArtifactCount = page.artifacts.length;
    if (totalCount === null) totalCount = pageTotalCount;
    if (pageTotalCount !== totalCount) fail('repository Actions artifact total_count drifted across pages.');
    pageDigests.push(hash(Object.freeze({ schema: 'sec-github-actions-artifact-page-v1',
      page: pageIndex + 1, perPage: 100, totalCount: pageTotalCount, records: page.artifacts })));
    for (const [index, raw] of page.artifacts.entries()) {
      const entry = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : fail(`repository Actions artifact page ${pageIndex + 1}[${index}] must be an object.`);
      if (!Number.isSafeInteger(entry.id) || Number(entry.id) < 1
        || typeof entry.expired !== 'boolean') {
        fail(`repository Actions artifact page ${pageIndex + 1}[${index}] fields are invalid.`);
      }
      const artifactId = String(entry.id);
      if (artifactIds.has(artifactId)) fail('repository Actions artifact inventory contains a duplicate id.');
      artifactIds.add(artifactId);
      const artifactName = boundedOpaqueActionsArtifactName(entry.name,
        `repository Actions artifact page ${pageIndex + 1}[${index}].name`);
      const archiveDigest = entry.digest === null || entry.digest === undefined
        ? null
        : typeof entry.digest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(entry.digest)
          ? entry.digest as SessionDigest
          : fail(`repository Actions artifact page ${pageIndex + 1}[${index}].digest is malformed.`);
      opaqueArtifacts.push(Object.freeze({ artifactId, artifactName, archiveDigest,
        expired: entry.expired }));
    }
  }
  if (totalCount === null || opaqueArtifacts.length !== totalCount
    || pages.length !== Math.max(1, Math.ceil(totalCount / 100))
    || (totalCount > 0 && finalPageArtifactCount === 0)) {
    fail('repository Actions artifact pagination does not match the complete declared census.');
  }
  const artifacts: GitHubRepositoryActionsArtifactSummary[] = opaqueArtifacts.map((entry) => {
    const sessionIdentity = VERIFICATION_SESSION_ARTIFACT_NAME_PATTERN.exec(entry.artifactName);
    if (sessionIdentity === null
      && entry.artifactName.startsWith(`${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-`)) {
      fail('repository Actions artifact inventory contains a malformed Session-family name.');
    }
    const expectedRunId = sessionIdentity?.[1] ?? null;
    const sessionRunAttempt = sessionIdentity === null ? null : Number(sessionIdentity[2]);
    if (sessionIdentity !== null && (sessionRunAttempt === null
      || !Number.isSafeInteger(sessionRunAttempt) || sessionRunAttempt < 1)) {
      fail('repository Actions artifact Session-family attempt identity is invalid.');
    }
    return Object.freeze({ ...entry, family: sessionIdentity === null ? 'unrelated' as const : 'session' as const,
      expectedRunId, sessionRunAttempt });
  });
  const sessionArtifactIds = Object.freeze(artifacts.filter((entry) => entry.family === 'session')
    .map((entry) => entry.artifactId));
  const withoutDigest = Object.freeze({ schema: 'sec-github-repository-actions-artifact-inventory-v1' as const,
    repository: input.repository, totalCount, perPage: 100 as const, paginationComplete: true as const,
    pageDigests: Object.freeze(pageDigests), artifacts: Object.freeze(artifacts), sessionArtifactIds });
  const inventory = Object.freeze({ ...withoutDigest, inventoryDigest: hash(withoutDigest) });
  const hydrated: GitHubActionsArtifactObservation[] = [];
  for (const entry of inventory.artifacts.filter(entry => entry.family === 'session' && !entry.expired)) {
      const observed = await input.observeArtifact(entry);
      if (observed.artifactId !== entry.artifactId || observed.artifactName !== entry.artifactName
        || observed.archiveDigest !== entry.archiveDigest || observed.expired !== entry.expired
        || observed.runId !== entry.expectedRunId
        || observed.runAttempt !== entry.sessionRunAttempt) {
        fail('repository Actions artifact hydration differs from its selected summary identity.');
      }
      hydrated.push(Object.freeze({ ...observed }));
  }
  return Object.freeze({ inventory, artifacts: Object.freeze(hydrated) });
}

function compareDecimal(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function normalizeReviews(reviews: readonly GitHubReviewObservation[]): readonly GitHubReviewObservation[] {
  const ids = new Set<string>();
  const normalized = reviews.map((review, index) => {
    const id = boundedText(review.id, `reviews[${index}].id`, 256);
    if (ids.has(id)) fail('review inventory contains a duplicate id.');
    ids.add(id);
    const authorNodeId = boundedText(review.authorNodeId, `reviews[${index}].authorNodeId`, 256);
    const authorLogin = boundedText(review.authorLogin, `reviews[${index}].authorLogin`, 256);
    if (review.authorType !== 'Bot' && review.authorType !== 'User') {
      fail(`reviews[${index}].authorType is unknown.`);
    }
    if (review.appId === null) {
      if (review.appNodeId !== null || review.appSlug !== null) fail(`reviews[${index}] App identity is partial.`);
    } else if (!Number.isSafeInteger(review.appId) || review.appId <= 0
      || typeof review.appNodeId !== 'string' || typeof review.appSlug !== 'string') {
      fail(`reviews[${index}] App identity is invalid.`);
    }
    const appNodeId = review.appNodeId === null ? null
      : boundedText(review.appNodeId, `reviews[${index}].appNodeId`, 256);
    const appSlug = review.appSlug === null ? null
      : boundedText(review.appSlug, `reviews[${index}].appSlug`, 256);
    const commitSha = assertSha(review.commitSha, `reviews[${index}].commitSha`);
    if (!['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) {
      fail(`reviews[${index}].state is unknown.`);
    }
    const submittedAt = canonicalInstant(review.submittedAt, `reviews[${index}].submittedAt`);
    return Object.freeze({ id, authorNodeId, authorLogin, authorType: review.authorType,
      appId: review.appId, appNodeId, appSlug, commitSha, state: review.state, submittedAt });
  });
  const atPrincipalTime = new Map<string, SessionDigest>();
  for (const review of normalized) {
    const key = `${review.authorNodeId}\0${review.submittedAt}`;
    const semantic = hash({ commitSha: review.commitSha, state: review.state, authorType: review.authorType,
      appId: review.appId,
      appNodeId: review.appNodeId, appSlug: review.appSlug });
    const previous = atPrincipalTime.get(key);
    if (previous !== undefined && previous !== semantic) {
      fail('same-principal reviews at one timestamp contain conflicting state/commit/App identity.');
    }
    atPrincipalTime.set(key, semantic);
  }
  return Object.freeze(normalized);
}

function normalizeThreads(threads: readonly GitHubReviewThreadObservation[]): readonly GitHubReviewThreadObservation[] {
  const ids = new Set<string>();
  return Object.freeze(threads.map((thread, index) => {
    const id = boundedText(thread.id, `reviewThreads[${index}].id`, 256);
    if (ids.has(id)) fail('review thread inventory contains a duplicate id.');
    ids.add(id);
    if (typeof thread.isResolved !== 'boolean' || typeof thread.isOutdated !== 'boolean') {
      fail(`reviewThreads[${index}] resolution state is invalid.`);
    }
    const path = boundedText(thread.path, `reviewThreads[${index}].path`, 4096);
    if (!Array.isArray(thread.authorNodeIds)) fail(`reviewThreads[${index}].authorNodeIds is invalid.`);
    const authorNodeIds = thread.authorNodeIds.map((nodeId, authorIndex) =>
      boundedText(nodeId, `reviewThreads[${index}].authorNodeIds[${authorIndex}]`, 256));
    return Object.freeze({ id, isResolved: thread.isResolved, isOutdated: thread.isOutdated,
      path, authorNodeIds: Object.freeze(authorNodeIds) });
  }));
}

function normalizeReviewRequests(
  requests: readonly GitHubReviewRequestObservation[]
): readonly GitHubReviewRequestObservation[] {
  const keys = new Set<string>();
  return Object.freeze(requests.map((request, index) => {
    const nodeId = boundedText(request.nodeId, `reviewRequests[${index}].nodeId`, 256);
    const login = boundedText(request.login, `reviewRequests[${index}].login`, 256);
    if (request.kind !== 'user' && request.kind !== 'team') fail(`reviewRequests[${index}].kind is invalid.`);
    const key = `${request.kind}:${nodeId}`;
    if (keys.has(key)) fail('review request inventory contains a duplicate principal.');
    keys.add(key);
    return Object.freeze({ nodeId, login, kind: request.kind });
  }));
}

function normalizeIssueComments(
  comments: readonly GitHubIssueCommentObservation[]
): readonly GitHubIssueCommentObservation[] {
  const ids = new Set<string>();
  return Object.freeze(comments.map((comment, index) => {
    if (!/^[1-9][0-9]*$/u.test(comment.id)) fail(`issueComments[${index}].id is invalid.`);
    if (ids.has(comment.id)) fail('issue comment inventory contains a duplicate id.');
    ids.add(comment.id);
    const body = boundedText(comment.body, `issueComments[${index}].body`, 1024 * 1024);
    const authorLogin = boundedText(comment.authorLogin, `issueComments[${index}].authorLogin`, 256);
    if (!Number.isSafeInteger(comment.authorId) || comment.authorId <= 0) {
      fail(`issueComments[${index}].authorId is invalid.`);
    }
    const authorNodeId = boundedText(comment.authorNodeId, `issueComments[${index}].authorNodeId`, 256);
    const authorType = boundedText(comment.authorType, `issueComments[${index}].authorType`, 64);
    const performedViaGitHubApp = comment.performedViaGitHubApp === null ? null : (() => {
      const app = comment.performedViaGitHubApp;
      if (!Number.isSafeInteger(app.id) || app.id <= 0) fail(`issueComments[${index}].app.id is invalid.`);
      return Object.freeze({ id: app.id,
        nodeId: boundedText(app.nodeId, `issueComments[${index}].app.nodeId`, 256),
        slug: boundedText(app.slug, `issueComments[${index}].app.slug`, 256) });
    })();
    const createdAt = canonicalInstant(comment.createdAt, `issueComments[${index}].createdAt`);
    const normalized = Object.freeze({ id: comment.id, body, authorLogin, authorId: comment.authorId,
      authorNodeId, authorType, performedViaGitHubApp, createdAt });
    if (trustedHostedPublisher(normalized)) {
      if (body.includes(VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER)) {
        const locator = parseReviewLocatorComment(body);
        if (locator === null) fail('trusted hosted Review locator marker did not parse.');
      }
    }
    return normalized;
  }));
}

function reviewOrder(left: GitHubReviewObservation, right: GitHubReviewObservation): number {
  return left.submittedAt.localeCompare(right.submittedAt) || left.id.localeCompare(right.id);
}

function commentOrder(left: GitHubIssueCommentObservation, right: GitHubIssueCommentObservation): number {
  return left.createdAt.localeCompare(right.createdAt)
    || (BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0);
}

function reviewDecisionsByPrincipal(
  reviews: readonly GitHubReviewObservation[],
  headSha: string
): Map<string, GitHubReviewObservation> {
  const result = new Map<string, GitHubReviewObservation>();
  for (const review of [...reviews].sort(reviewOrder)) {
    // GitHub mutates the dismissed review record in place; DISMISSED is not a
    // later opinion event and must not erase another still-active review.
    if (review.state === 'COMMENTED' || review.state === 'DISMISSED') continue;
    if (review.state === 'CHANGES_REQUESTED' || review.commitSha === headSha) {
      result.set(review.authorNodeId, review);
    }
  }
  return result;
}

function blockingReviewPrincipals(
  decisions: ReadonlyMap<string, GitHubReviewObservation>
): readonly string[] {
  return Object.freeze([...decisions.values()]
    .filter((review) => review.state === 'CHANGES_REQUESTED')
    .map((review) => review.authorNodeId)
    .sort());
}

function reviewedCommitLocator(body: string): { locator: string; clean: boolean } | null {
  const normalized = body.replaceAll('\r\n', '\n');
  const labels = [...normalized.matchAll(/Reviewed commit:/gu)];
  if (labels.length === 0) return null;
  const matches = [...normalized.matchAll(/^\*\*Reviewed commit:\*\* `([0-9a-f]+)`[ \t]*$/gmu)];
  if (labels.length !== 1 || matches.length !== 1) return null;
  const locator = matches[0]![1]!;
  if (locator.length !== 10 && locator.length !== 40) return null;
  const firstLine = normalized.split('\n', 1)[0]!;
  const core = `${firstLine}\n\n**Reviewed commit:** \`${locator}\``;
  const cleanShape = normalized === core
    || (normalized.startsWith(`${core}\n\n`)
      && isCodexCleanReviewAboutBlock(normalized.slice(core.length + 2)));
  return { locator, clean: cleanShape && isCodexCleanReviewVerdict(firstLine) };
}

function assertResolution(
  resolution: GitHubCommitResolutionObservation,
  repository: string,
  locator: string
): GitHubCommitResolutionObservation {
  if (resolution.repository !== repository || resolution.locator !== locator
    || !/^sha256:[0-9a-f]{64}$/u.test(resolution.responseDigest)) {
    fail('commit resolver identity/digest is invalid.');
  }
  if (resolution.status === 'resolved') {
    assertSha(resolution.commitSha, 'resolved commitSha');
    assertSha(resolution.treeSha, 'resolved treeSha');
    if (!resolution.commitSha.startsWith(locator)) fail('commit resolver response does not match its locator.');
  } else if (resolution.status !== 'missing' && resolution.status !== 'ambiguous') {
    fail('commit resolver status is unknown.');
  }
  return resolution;
}

class VerificationSessionGitHubAdapter {
  readonly #transport: VerificationSessionGitHubTransport;

  constructor(transport: VerificationSessionGitHubTransport) {
    this.#transport = transport;
  }

  async observeCandidate(repository: string, prNumber: number): Promise<GitHubCandidateObservation> {
    const candidate = (await this.#transport.candidate(repository, prNumber));
    try {
      if (candidate.repository !== repository || candidate.number !== prNumber) fail('candidate identity mismatch.');
      assertSha(candidate.baseSha, 'candidate baseSha');
      assertSha(candidate.baseTreeSha, 'candidate baseTreeSha');
      assertSha(candidate.headSha, 'candidate headSha');
      assertSha(candidate.headTreeSha, 'candidate headTreeSha');
      if (typeof candidate.title !== 'string' || candidate.title.length === 0
        || typeof candidate.body !== 'string') {
        fail('candidate title or body is invalid.');
      }
      if (candidate.mergeCommitSha !== null) assertSha(candidate.mergeCommitSha, 'mergeCommitSha');
      if (candidate.mergeCommitTreeSha !== null) assertSha(candidate.mergeCommitTreeSha, 'mergeCommitTreeSha');
      let mergeCommitParentShas: readonly string[] | null = null;
      if (candidate.mergeCommitParentShas !== null) {
        if (!Array.isArray(candidate.mergeCommitParentShas)) {
          fail('mergeCommitParentShas must be an array or null.');
        }
        const parentShas = candidate.mergeCommitParentShas.map((parentSha, index) =>
          assertSha(parentSha, `mergeCommitParentShas[${index}]`));
        if (new Set(parentShas).size !== parentShas.length) {
          fail('mergeCommitParentShas contains a duplicate commit.');
        }
        mergeCommitParentShas = Object.freeze(parentShas);
      }
      if ((candidate.mergeCommitSha === null) !== (candidate.mergeCommitTreeSha === null)
        || (candidate.mergeCommitSha === null) !== (candidate.mergeCommitMessage === null)
        || (candidate.mergeCommitSha === null) !== (candidate.mergeCommitParentShas === null)
        || (candidate.mergeCommitMessage !== null && typeof candidate.mergeCommitMessage !== 'string')) fail('merge commit identity is partial.');
      return bindProviderShapeSource(
        Object.freeze({ ...candidate, mergeCommitParentShas }),
        providerShapeSource(candidate)
      );
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-candidate-pr-tree-merge', providerShapeSource(candidate));
    }
  }

  async observePullRequestClosingFacts(
    repository: string,
    prNumber: number
  ): Promise<GitHubPullRequestClosingFacts> {
    const facts = (await this.#transport.pullRequestClosingFacts(repository, prNumber));
    if (facts.repository !== repository || facts.prNumber !== prNumber
      || !/^sha256:[0-9a-f]{64}$/u.test(facts.responseDigest)
      || !Array.isArray(facts.closingIssues) || facts.closingIssues.length > 256) {
      fail('pull request closing facts identity, digest, or bound is invalid.');
    }
    const keys = facts.closingIssues.map((issue, index) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(issue.repository)
        || !Number.isSafeInteger(issue.issueNumber) || issue.issueNumber < 1) {
        fail(`pull request closing facts issue ${index} is invalid.`);
      }
      return `${issue.repository.toLowerCase()}#${issue.issueNumber}`;
    });
    if (new Set(keys).size !== keys.length) fail('pull request closing facts contain duplicates.');
    return Object.freeze({ ...facts, closingIssues: Object.freeze([...facts.closingIssues]) });
  }

  private async observeReviewBarrierUnchecked(input: {
    repository: string;
    prNumber: number;
    headSha: string;
    excludedPrincipalNodeIds: ReadonlySet<string>;
    observedAt?: string;
  }): Promise<GitHubReviewBarrierObservation> {
    const observedAt = input.observedAt ?? new Date().toISOString();
    canonicalInstant(observedAt, 'Review observedAt');
    assertSha(input.headSha, 'requested Review headSha');
    const candidateBefore = (await this.observeCandidate(input.repository, input.prNumber));
    if (candidateBefore.headSha !== input.headSha) {
      fail('requested Review head differs from the provider PR head.');
    }
    const reviewPages = (await collectPages('reviews', async (cursor) => (await this.#transport.reviewPage(input.repository, input.prNumber, cursor))));
    const threadPages = (await collectPages('review threads', async (cursor) => (await this.#transport.threadPage(input.repository, input.prNumber, cursor))));
    const requestPages = (await collectPages('review requests', async (cursor) => (await this.#transport.reviewRequestPage(input.repository, input.prNumber, cursor))));
    const issueCommentPages = (await collectPages('issue comments', async (cursor) =>
      (await this.#transport.issueCommentPage(input.repository, input.prNumber, cursor))));
    const pageBundle = (pages: { sourceBundles: readonly unknown[] }) => Object.freeze({
      pages: Object.freeze([...pages.sourceBundles])
    });
    let reviews: readonly GitHubReviewObservation[];
    let threads: readonly GitHubReviewThreadObservation[];
    let issueComments: readonly GitHubIssueCommentObservation[];
    try {
      reviews = normalizeReviews(reviewPages.nodes);
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-review-post-normalization', pageBundle(reviewPages));
    }
    try {
      threads = normalizeThreads(threadPages.nodes);
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-thread-post-normalization', pageBundle(threadPages));
    }
    try {
      normalizeReviewRequests(requestPages.nodes);
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-review-request-post-normalization', pageBundle(requestPages));
    }
    try {
      issueComments = normalizeIssueComments(issueCommentPages.nodes);
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-issue-comment-post-normalization', pageBundle(issueCommentPages));
    }
    const unresolved = threads.filter((thread) => !thread.isResolved);
    const decisions = reviewDecisionsByPrincipal(reviews, input.headSha);
    const requestChanges = blockingReviewPrincipals(decisions);
    const exactWakeups: Array<{ comment: GitHubIssueCommentObservation; wakeup: VerificationSessionReviewWakeupComment }> = [];
    for (const comment of issueComments) {
      if (!comment.body.includes(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER)
          || comment.authorType !== 'User' || comment.performedViaGitHubApp !== null) continue;
      const permission = (await this.#transport.collaboratorPermission(input.repository, comment.authorLogin));
      if (permission !== 'admin' && permission !== 'maintain') continue;
      const wakeup = parseReviewWakeupComment(comment.body);
      if (wakeup === null
          || wakeup.repository !== input.repository
          || wakeup.prNumber !== input.prNumber
          || wakeup.headSha !== input.headSha
          || wakeup.headTreeSha !== candidateBefore.headTreeSha
          || wakeup.publisherNodeId !== comment.authorNodeId) continue;
      exactWakeups.push(Object.freeze({ comment, wakeup }));
    }
    const hasBoundWakeupBefore = (providerObservedAt: string): boolean => exactWakeups.some(({ comment }) => (
      comment.createdAt <= providerObservedAt
    ));
    let unboundTrustedAppActivation = false;
    const resolverRecords: Array<Readonly<{
      comment: GitHubIssueCommentObservation;
      trustedApp: { actorNodeId: string; appId: number; appNodeId: string; appSlug: string };
      locator: string;
      clean: boolean;
      resolution: Extract<GitHubCommitResolutionObservation, { status: 'resolved' }>;
      recordDigest: SessionDigest;
    }>> = [];
    const resolverPageDigests: SessionDigest[] = [];
    for (const comment of issueComments) {
      const performedApp = comment.performedViaGitHubApp;
      if (performedApp === null) continue;
      const trustedApp = SEC_REVIEW_STABILITY_POLICY.trustedApps.find((app) => (
        app.actorNodeId === comment.authorNodeId
        && performedApp.id === app.appId
        && performedApp.nodeId === app.appNodeId
        && performedApp.slug === app.appSlug
        && comment.authorType === 'Bot'
        && !input.excludedPrincipalNodeIds.has(comment.authorNodeId)
      ));
      if (trustedApp === undefined) continue;
      const marker = reviewedCommitLocator(comment.body);
      if (marker === null) continue;
      const resolution = assertResolution(
        (await this.#transport.resolveCommitOid(input.repository, marker.locator)), input.repository, marker.locator
      );
      const recordDigest = hash({
        schema: 'sec-provider-resolved-rest-review-v1',
        repository: input.repository,
        prNumber: input.prNumber,
        requestedHeadSha: input.headSha,
        requestedHeadTreeSha: candidateBefore.headTreeSha,
        locator: marker.locator,
        resolvedCommitSha: resolution.commitSha,
        resolvedTreeSha: resolution.treeSha,
        resolverStatus: resolution.status,
        resolverResponseDigest: resolution.responseDigest,
        commentId: comment.id,
        commentBodyDigest: hash(comment.body),
        commentCreatedAt: comment.createdAt,
        authorLogin: comment.authorLogin,
        authorId: comment.authorId,
        authorType: comment.authorType,
        authorNodeId: comment.authorNodeId,
        appId: performedApp.id,
        appNodeId: performedApp.nodeId,
        appSlug: performedApp.slug,
        cleanVerdict: marker.clean
      });
      resolverPageDigests.push(recordDigest);
      if (resolution.status === 'resolved') {
        resolverRecords.push(Object.freeze({ comment, trustedApp, locator: marker.locator,
          clean: marker.clean, resolution, recordDigest }));
      }
    }
    const rawReviewPageDigests = Object.freeze([
      ...reviewPages.pageDigests,
      ...requestPages.pageDigests,
      ...issueCommentPages.pageDigests,
      ...resolverPageDigests
    ]);
    const threadPageDigests = Object.freeze([...threadPages.pageDigests]);
    const candidateAfter = (await this.observeCandidate(input.repository, input.prNumber));
    const snapshotBase = {
      paginationComplete: true as const,
      reviewedHeadSha: input.headSha,
      reviewPageDigests: rawReviewPageDigests,
      threadPageDigests,
      reviewCount: reviews.length + issueComments.length,
      threadCount: threads.length,
      unresolvedBlockingThreadCount: unresolved.length,
      requestChangesPrincipalIds: requestChanges,
    };
    const blockedSnapshotDigest = hash(snapshotBase);
    if (candidateAfter.headSha !== candidateBefore.headSha
      || candidateAfter.headTreeSha !== candidateBefore.headTreeSha
      || candidateAfter.state !== candidateBefore.state) {
      return Object.freeze({ status: 'blocked', reason: 'review-observation-head-drift',
        snapshotDigest: blockedSnapshotDigest, observedAt });
    }
    if (unresolved.length > 0) {
      return Object.freeze({ status: 'blocked', reason: 'unresolved-review-thread', snapshotDigest: blockedSnapshotDigest, observedAt });
    }
    if (requestChanges.length > 0) {
      return Object.freeze({ status: 'blocked', reason: 'request-changes-current', snapshotDigest: blockedSnapshotDigest, observedAt });
    }

    const emptyRequestChanges = Object.freeze([]) as readonly [];
    const clear = (
      principal: ReviewPrincipal,
      sourceTransport: 'github-graphql' | 'github-rest',
      authorityRecord: unknown
    ): Extract<GitHubReviewBarrierObservation, { status: 'clear' }> => {
      const authorityRecordDigest = hash(authorityRecord);
      const reviewPageDigests = Object.freeze([...rawReviewPageDigests, authorityRecordDigest]);
      const clearSnapshotBase = {
        ...snapshotBase,
        reviewPageDigests,
        unresolvedBlockingThreadCount: 0 as const,
        requestChangesPrincipalIds: emptyRequestChanges
      };
      const snapshotDigest = createReviewSnapshotDigest(clearSnapshotBase);
      const sourceDigest = sourceTransport === 'github-graphql' ? snapshotDigest : authorityRecordDigest;
      const observation = Object.freeze({
        status: 'clear',
        principal,
        snapshot: Object.freeze({
          paginationComplete: true,
          reviewedHeadSha: input.headSha,
          reviewPageDigests,
          threadPageDigests,
          reviewCount: snapshotBase.reviewCount,
          threadCount: snapshotBase.threadCount,
          unresolvedBlockingThreadCount: 0,
          requestChangesPrincipalIds: emptyRequestChanges,
          snapshotDigest
        }),
        authority: Object.freeze({ sourceTransport, sourceDigest,
          executionIdentity: `github-review-observer:${input.repository}:${input.prNumber}:${input.headSha}`,
          providerIdentity: 'github' as const,
          candidateWriteCapability: 'read-only' as const,
          capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT }),
        observedAt
      });
      if (authorityBearingGitHubAdapters.has(this)) {
        validatedClearReviewObservations.add(observation);
      }
      return observation;
    };

    for (const trustedApp of SEC_REVIEW_STABILITY_POLICY.trustedApps) {
      const trustedReview = decisions.get(trustedApp.actorNodeId);
      if (trustedReview !== undefined && trustedReview.authorType === 'Bot'
        && trustedReview.appId === trustedApp.appId
        && trustedReview.appNodeId === trustedApp.appNodeId
        && trustedReview.appSlug === trustedApp.appSlug
        && trustedReview.state === 'APPROVED'
        && !input.excludedPrincipalNodeIds.has(trustedReview.authorNodeId)) {
        if (!hasBoundWakeupBefore(trustedReview.submittedAt)) {
          unboundTrustedAppActivation = true;
          continue;
        }
        return clear(Object.freeze({ kind: 'github-app', actorNodeId: trustedReview.authorNodeId,
          appId: trustedReview.appId, appNodeId: trustedReview.appNodeId,
          appSlug: trustedReview.appSlug, reviewState: 'APPROVED' }), 'github-graphql', {
          schema: 'sec-provider-resolved-graphql-approved-review-authority-v1',
          repository: input.repository,
          prNumber: input.prNumber,
          headSha: input.headSha,
          headTreeSha: candidateBefore.headTreeSha,
          review: trustedReview,
          reviewPageDigests: rawReviewPageDigests,
          threadPageDigests
        });
      }
    }

    const latestRestByApp = new Map<string, (typeof resolverRecords)[number]>();
    for (const record of [...resolverRecords]
      .filter((candidate) => candidate.resolution.commitSha === input.headSha
        && candidate.resolution.treeSha === candidateBefore.headTreeSha)
      .sort((left, right) => commentOrder(left.comment, right.comment))) {
      latestRestByApp.set(`${record.trustedApp.appId}:${record.trustedApp.actorNodeId}:` +
        `${record.trustedApp.appNodeId}:${record.trustedApp.appSlug}`, record);
    }
    for (const trustedApp of SEC_REVIEW_STABILITY_POLICY.trustedApps) {
      const trustedComment = latestRestByApp.get(`${trustedApp.appId}:${trustedApp.actorNodeId}:` +
        `${trustedApp.appNodeId}:${trustedApp.appSlug}`);
      if (trustedComment?.clean === true) {
        if (!hasBoundWakeupBefore(trustedComment.comment.createdAt)) {
          unboundTrustedAppActivation = true;
          continue;
        }
        return clear(Object.freeze({ kind: 'github-app', actorNodeId: trustedApp.actorNodeId,
          appId: trustedApp.appId, appNodeId: trustedApp.appNodeId, appSlug: trustedApp.appSlug,
          reviewState: 'COMMENTED' }), 'github-rest', {
          schema: 'sec-provider-resolved-rest-review-authority-v1',
          repository: input.repository,
          prNumber: input.prNumber,
          headShaBefore: candidateBefore.headSha,
          headTreeShaBefore: candidateBefore.headTreeSha,
          headShaAfter: candidateAfter.headSha,
          headTreeShaAfter: candidateAfter.headTreeSha,
          locator: trustedComment.locator,
          resolvedCommitSha: trustedComment.resolution.commitSha,
          resolvedTreeSha: trustedComment.resolution.treeSha,
          resolverResponseDigest: trustedComment.resolution.responseDigest,
          commentId: trustedComment.comment.id,
          commentBodyDigest: hash(trustedComment.comment.body),
          commentCreatedAt: trustedComment.comment.createdAt,
          authorLogin: trustedComment.comment.authorLogin,
          authorId: trustedComment.comment.authorId,
          authorType: trustedComment.comment.authorType,
          authorNodeId: trustedComment.comment.authorNodeId,
          appId: trustedComment.comment.performedViaGitHubApp?.id,
          appNodeId: trustedComment.comment.performedViaGitHubApp?.nodeId,
          appSlug: trustedComment.comment.performedViaGitHubApp?.slug,
          providerRecordDigest: trustedComment.recordDigest,
          reviewPageDigests: rawReviewPageDigests,
          threadPageDigests
        });
      }
    }

    for (const trustedApp of SEC_REVIEW_STABILITY_POLICY.trustedApps) {
      const appReview = decisions.get(trustedApp.actorNodeId);
      if (appReview !== undefined
          && appReview.authorType === 'Bot'
          && appReview.appId === trustedApp.appId
          && appReview.appNodeId === trustedApp.appNodeId
          && appReview.appSlug === trustedApp.appSlug
          && !input.excludedPrincipalNodeIds.has(appReview.authorNodeId)
          && !hasBoundWakeupBefore(appReview.submittedAt)) {
        unboundTrustedAppActivation = true;
      }
    }

    const humans = [...decisions.values()]
      .filter((review) => (
        review.state === 'APPROVED'
        && review.authorType === 'User'
        && review.appId === null
        && !input.excludedPrincipalNodeIds.has(review.authorNodeId)
      ))
      .sort((left, right) => left.authorNodeId.localeCompare(right.authorNodeId));
    for (const review of humans) {
      const permission = (await this.#transport.collaboratorPermission(input.repository, review.authorLogin));
      if (permission !== 'admin' && permission !== 'maintain') continue;
      return clear(Object.freeze({ kind: 'human', nodeId: review.authorNodeId,
        approvalState: 'APPROVED' }), 'github-graphql', {
        schema: 'sec-graphql-human-approved-review-authority-v1',
        repository: input.repository,
        prNumber: input.prNumber,
        headSha: input.headSha,
        headTreeSha: candidateBefore.headTreeSha,
        permission,
        review,
        reviewPageDigests: rawReviewPageDigests,
        threadPageDigests
      });
    }
    const waitingSnapshotDigest = createReviewSnapshotDigest({ ...snapshotBase,
      unresolvedBlockingThreadCount: 0, requestChangesPrincipalIds: emptyRequestChanges });
    if (unboundTrustedAppActivation) {
      return Object.freeze({ status: 'blocked', reason: 'review-provider-unbound-activation',
        snapshotDigest: waitingSnapshotDigest, observedAt });
    }
    return Object.freeze({ status: 'waiting', reason: 'exact-head-independent-review-missing',
      snapshotDigest: waitingSnapshotDigest, observedAt });
  }

  async observeReviewProviderAvailability(input: {
    repository: string;
    prNumber?: number;
    headSha?: string;
    headTreeSha?: string;
    observedAt?: string;
  }): Promise<GitHubReviewProviderAvailabilityObservation> {
    const observedAt = input.observedAt ?? new Date().toISOString();
    canonicalInstant(observedAt, 'Review provider observedAt');
    const observedAtMs = new Date(observedAt).getTime();
    const targetFields = [input.prNumber, input.headSha, input.headTreeSha];
    const targetPresent = targetFields.every((value) => value !== undefined);
    if (targetFields.some((value) => value !== undefined) && !targetPresent) {
      fail('Review provider availability target identity is partial.');
    }
    if (targetPresent && (
      !Number.isSafeInteger(input.prNumber) || (input.prNumber as number) < 1
      || !/^[0-9a-f]{40}$/u.test(input.headSha as string)
      || !/^[0-9a-f]{40}$/u.test(input.headTreeSha as string)
    )) {
      fail('Review provider availability target identity is invalid.');
    }
    let cursor: string | null = null;
    let previousCreatedAtMs = Number.POSITIVE_INFINITY;
    let complete = false;
    const visitedPages: Array<Readonly<{ cursor: string | null; digest: SessionDigest }>> = [];
    let latestEvent: Readonly<{
      kind: 'quota';
      comment: GitHubIssueCommentObservation;
      receiptRef: SessionDigest;
    }> | Readonly<{
      kind: 'probe-consumed';
      comment: GitHubIssueCommentObservation;
      receiptRef: SessionDigest;
    }> | Readonly<{
      kind: 'revalidation';
      comment: GitHubIssueCommentObservation;
      revalidationDigest: SessionDigest;
    }> | null = null;

    for (let pageNumber = 0; pageNumber < REVIEW_PROVIDER_COMMENT_MAXIMUM_PAGES; pageNumber += 1) {
      const pageCursor = cursor;
      const page = (await this.#transport.repositoryIssueCommentPage(input.repository, pageCursor));
      if (!/^sha256:[0-9a-f]{64}$/u.test(page.pageDigest)) {
        fail('Review provider comment page digest is invalid.');
      }
      visitedPages.push(Object.freeze({ cursor: pageCursor, digest: page.pageDigest }));
      const comments = normalizeIssueComments(page.nodes);
      for (const comment of comments) {
        const createdAtMs = new Date(comment.createdAt).getTime();
        if (createdAtMs > previousCreatedAtMs) {
          return Object.freeze({
            status: 'unresolved' as const,
            reason: 'provider-comment-ordering-invalid' as const,
            censusDigest: hash({ visitedPages, commentId: comment.id }),
            observedAt
          });
        }
        previousCreatedAtMs = createdAtMs;
        if (createdAtMs > observedAtMs) continue;

        const performedApp = comment.performedViaGitHubApp;
        const trustedApp = performedApp === null ? undefined
          : SEC_REVIEW_STABILITY_POLICY.trustedApps.find((app) => (
              app.actorNodeId === comment.authorNodeId
              && performedApp.id === app.appId
              && performedApp.nodeId === app.appNodeId
              && performedApp.slug === app.appSlug
              && comment.authorType === 'Bot'
            ));
        if (trustedApp !== undefined) {
          const diagnostic = classifyProviderDiagnosticTextV1(comment.body);
          if (diagnostic.reasonCode === 'provider-quota-unavailable') {
            latestEvent = Object.freeze({
              kind: 'quota' as const,
              comment,
              receiptRef: diagnostic.receiptRef
            });
            break;
          }
        }

        if (comment.authorType === 'User' && comment.performedViaGitHubApp === null
            && (comment.body.includes(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER)
              || comment.body === RETIRED_REVIEW_WAKEUP_TOMBSTONE)) {
          const permission = (await this.#transport.collaboratorPermission(
            input.repository,
            comment.authorLogin
          ));
          if (permission === 'admin' || permission === 'maintain') {
            if (comment.body.includes(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER)) {
              const wakeup = parseReviewWakeupComment(comment.body);
              if (wakeup === null || wakeup.publisherNodeId !== comment.authorNodeId) {
                fail(`Review wake-up comment ${comment.id} marker did not bind its publisher.`);
              }
            }
            latestEvent = Object.freeze({
              kind: 'probe-consumed' as const,
              comment,
              receiptRef: hash({
                schema: 'sec-review-provider-probe-consumed-v1',
                repository: input.repository,
                commentId: comment.id,
                commentCreatedAt: comment.createdAt,
                commentBodyDigest: hash(comment.body),
                authorNodeId: comment.authorNodeId
              })
            });
            break;
          }
        }

        if (targetPresent
            && comment.authorType === 'User' && comment.performedViaGitHubApp === null
            && comment.body.includes(VERIFICATION_SESSION_REVIEW_PROVIDER_REVALIDATION_MARKER)) {
          const permission = (await this.#transport.collaboratorPermission(
            input.repository,
            comment.authorLogin
          ));
          if (permission !== 'admin' && permission !== 'maintain') continue;
          const revalidation = parseReviewProviderRevalidationComment(comment.body);
          if (revalidation === null) {
            fail(`Review provider revalidation comment ${comment.id} marker did not parse.`);
          }
          if (revalidation.publisherNodeId !== comment.authorNodeId) continue;
          if (revalidation.repository !== input.repository
              || revalidation.prNumber !== input.prNumber
              || revalidation.headSha !== input.headSha
              || revalidation.headTreeSha !== input.headTreeSha) {
            continue;
          }
          latestEvent = Object.freeze({
            kind: 'revalidation' as const,
            comment,
            revalidationDigest: revalidation.revalidationDigest
          });
          break;
        }
      }

      const next = assertCursorProgress(cursor, page, 'Review provider repository comments');
      if (latestEvent !== null || next === null) {
        complete = true;
        break;
      }
      cursor = next;
    }

    const censusDigest = hash({
      schema: 'sec-review-provider-availability-census-v2',
      target: targetPresent ? {
        repository: input.repository,
        prNumber: input.prNumber,
        headSha: input.headSha,
        headTreeSha: input.headTreeSha
      } : null,
      pages: visitedPages
    });
    if (!complete) {
      return Object.freeze({
        status: 'unresolved' as const,
        reason: 'pagination-budget-exhausted' as const,
        censusDigest,
        observedAt
      });
    }
    for (const visited of visitedPages) {
      const readback = (await this.#transport.repositoryIssueCommentPage(
        input.repository,
        visited.cursor
      ));
      if (readback.pageDigest !== visited.digest) {
        return Object.freeze({
          status: 'unresolved' as const,
          reason: 'provider-comment-page-drift' as const,
          censusDigest: hash({
            censusDigest,
            cursor: visited.cursor,
            expected: visited.digest,
            readback: readback.pageDigest
          }),
          observedAt
        });
      }
    }

    if (latestEvent === null) {
      return Object.freeze({
        status: 'no-current-negative' as const,
        revalidationCommentId: null,
        revalidationObservedAt: null,
        revalidationDigest: null,
        censusDigest,
        observedAt
      });
    }
    if (latestEvent.kind === 'revalidation') {
      return Object.freeze({
        status: 'no-current-negative' as const,
        revalidationCommentId: latestEvent.comment.id,
        revalidationObservedAt: latestEvent.comment.createdAt,
        revalidationDigest: latestEvent.revalidationDigest,
        censusDigest,
        observedAt
      });
    }
    return Object.freeze({
      status: 'unavailable' as const,
      reasonCode: latestEvent.kind === 'quota'
        ? 'provider-quota-unavailable' as const
        : 'provider-revalidation-consumed' as const,
      receiptRef: latestEvent.receiptRef,
      sourceCommentId: latestEvent.comment.id,
      sourceObservedAt: latestEvent.comment.createdAt,
      censusDigest,
      observedAt
    });
  }
  async observeReviewBarrier(input: {
    repository: string;
    prNumber: number;
    headSha: string;
    excludedPrincipalNodeIds: ReadonlySet<string>;
    observedAt?: string;
  }): Promise<GitHubReviewBarrierObservation> {
    const observedAt = input.observedAt ?? new Date().toISOString();
    try {
      return (await this.observeReviewBarrierUnchecked({ ...input, observedAt }));
    } catch (error) {
      if (isGitHubProviderSchemaUnsupportedError(error)) return Object.freeze({
        status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS, reasonCode: error.reasonCode,
        responseDigest: error.responseDigest, observedAt
      });
      if (error instanceof GitHubProviderResponseShapeError) return Object.freeze({
        status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
        reasonCode: 'github-provider-response-shape-unsupported',
        responseDigest: providerResponseShapeDigest(error), observedAt
      });
      throw error;
    }
  }

  async observeChecks(repository: string, headSha: string): Promise<readonly GitHubCheckObservation[]> {
    return Object.freeze((await collectPages('check runs', async (cursor) => (await this.#transport.checkPage(repository, headSha, cursor)))).nodes);
  }

  async observeWorkflowRuns(repository: string, headSha: string): Promise<readonly GitHubWorkflowRunObservation[]> {
    assertSha(headSha, 'workflow run headSha');
    const runs = (await collectPages('workflow runs', async (cursor) =>
      (await this.#transport.workflowRunPage(repository, headSha, cursor)))).nodes;
    const identities = new Set<string>();
    return Object.freeze(runs.map((run, index) => {
      const id = positiveDecimal(run.id, `workflowRuns[${index}].id`);
      const name = boundedText(run.name, `workflowRuns[${index}].name`, 256);
      const displayTitle = boundedText(run.displayTitle, `workflowRuns[${index}].displayTitle`, 1024);
      const workflowPath = boundedText(run.workflowPath, `workflowRuns[${index}].workflowPath`, 512);
      const event = boundedText(run.event, `workflowRuns[${index}].event`, 64);
      if (!['queued', 'in_progress', 'waiting', 'requested', 'pending', 'completed'].includes(run.status)) {
        fail(`workflowRuns[${index}].status is unknown.`);
      }
      const allowedConclusions = ['success', 'failure', 'cancelled', 'skipped', 'timed_out',
        'action_required', 'neutral', 'stale', 'startup_failure'];
      if (run.status === 'completed') {
        if (run.conclusion === null || !allowedConclusions.includes(run.conclusion)) {
          fail(`workflowRuns[${index}].conclusion is unknown.`);
        }
      } else if (run.conclusion !== null) fail(`workflowRuns[${index}] nonterminal conclusion is invalid.`);
      const observedHeadSha = assertSha(run.headSha, `workflowRuns[${index}].headSha`);
      if (observedHeadSha !== headSha) fail(`workflowRuns[${index}] head filter was not honored.`);
      if (!Number.isSafeInteger(run.runAttempt) || run.runAttempt < 1) {
        fail(`workflowRuns[${index}].runAttempt is invalid.`);
      }
      const updatedAt = canonicalInstant(run.updatedAt, `workflowRuns[${index}].updatedAt`);
      const identity = `${id}:${run.runAttempt}`;
      if (identities.has(identity)) fail('workflow run inventory contains a duplicate run/attempt.');
      identities.add(identity);
      return Object.freeze({ id, name, displayTitle, workflowPath, event, status: run.status,
        conclusion: run.conclusion, headSha: observedHeadSha, runAttempt: run.runAttempt, updatedAt });
    }));
  }

  async observeWorkflowJobsForAttempt(
    repository: string,
    runId: string,
    runAttempt: number
  ): Promise<readonly GitHubWorkflowJobObservation[]> {
    if (this.#transport.workflowJobsForAttempt === undefined) {
      fail('workflow attempt job/step observation is unavailable.');
    }
    if (!/^[1-9][0-9]*$/u.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
      fail('workflow attempt identity is invalid.');
    }
    return Object.freeze([...(await this.#transport.workflowJobsForAttempt(repository, runId, runAttempt))]);
  }

  async observeVerificationSessionWorkflowJoin(input: {
    repository: string;
    prNumber: number;
    sessionRevision: SessionDigest;
    actionPlanDigest: SessionDigest;
    baseSha: string;
    now?: string;
  }): Promise<VerificationSessionWorkflowJoin> {
    if (!Number.isSafeInteger(input.prNumber) || input.prNumber < 1
      || !/^sha256:[0-9a-f]{64}$/u.test(input.sessionRevision)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.actionPlanDigest)) {
      fail('Session workflow join identity is invalid.');
    }
    const now = canonicalInstant(input.now ?? new Date().toISOString(), 'Session workflow join now');
    const expectedTitle = `verify session PR #${input.prNumber} session ${input.sessionRevision}`;
    const sessionPrefix = expectedTitle;
    const matching: GitHubWorkflowRunObservation[] = [];
    for (const run of (await this.observeWorkflowRuns(input.repository, input.baseSha))) {
      if (!run.displayTitle.startsWith(sessionPrefix)) continue;
      // GitHub REST exposes the evaluated `run-name` through both `name` and
      // `display_title`; `name` is presentation metadata, not the workflow
      // definition identity.  The immutable workflow path, event, exact title,
      // and exact main SHA form the provider-bound join identity.
      if (!matchesCiCompilerWorkflowRunIdentity({
        workflowPath: run.workflowPath,
        eventName: run.event,
        displayTitle: run.displayTitle,
        headSha: run.headSha,
        expectedDisplayTitle: expectedTitle,
        expectedHeadSha: input.baseSha
      })) {
        fail('Session workflow inventory contains a conflicting run identity.');
      }
      matching.push(run);
    }
    matching.sort((left, right) => compareDecimal(left.id, right.id) || left.runAttempt - right.runAttempt);
    const runIds = Object.freeze(matching.map((run) => `${run.id}:${run.runAttempt}`));
    const active = matching.filter((run) => run.status !== 'completed');
    if (active.length > 0) return Object.freeze({ status: 'joined', reason: 'active-run', runIds });
    const successful = matching.filter((run) => run.conclusion === 'success');
    if (successful.some((run) => {
      const age = new Date(now).getTime() - new Date(run.updatedAt).getTime();
      if (age < 0) fail('Session workflow run update time is in the future.');
      return age <= VERIFICATION_SESSION_ARTIFACT_PUBLICATION_WINDOW_MS;
    })) {
      return Object.freeze({ status: 'joined', reason: 'artifact-publication-window', runIds });
    }
    if (matching.length === 0) {
      return Object.freeze({ status: 'redispatch-eligible', reason: 'no-matching-run', runIds });
    }
    return Object.freeze({ status: 'redispatch-eligible',
      reason: successful.length > 0 ? 'artifact-publication-window-expired' : 'terminal-run', runIds });
  }

  async observeChangedPaths(
    expected: GitHubPullRequestFileInventoryExpectation
  ): Promise<GitHubPullRequestFileInventory> {
    repoParts(expected.repository);
    if (!Number.isSafeInteger(expected.prNumber) || expected.prNumber < 1
      || expected.state !== 'OPEN' || expected.draft !== false) {
      fail('changed-path expected PR identity is invalid.');
    }
    const expectedBaseSha = assertSha(expected.baseSha, 'changed-path expected base SHA');
    const expectedHeadSha = assertSha(expected.headSha, 'changed-path expected head SHA');
    if (this.#transport.pullRequestFileInventory === undefined) {
      fail('changed-path observation is unavailable.');
    }
    const observed = (await this.#transport.pullRequestFileInventory(expected.repository, expected.prNumber));
    repoParts(observed.repository);
    if (observed.schema !== 'sec-github-pr-files-inventory-v1'
      || !Number.isSafeInteger(observed.prNumber) || observed.prNumber < 1
      || (observed.state !== 'OPEN' && observed.state !== 'CLOSED')
      || typeof observed.draft !== 'boolean'
      || !Number.isSafeInteger(observed.changedFiles) || observed.changedFiles < 1
      || observed.changedFiles > 3000 || observed.recordCount !== observed.changedFiles) {
      fail('changed-path inventory shape is invalid.');
    }
    const baseSha = assertSha(observed.baseSha, 'changed-path inventory base SHA');
    const headSha = assertSha(observed.headSha, 'changed-path inventory head SHA');
    const digest = (value: unknown, label: string): SessionDigest => {
      if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
        fail(`${label} is invalid.`);
      }
      return value as SessionDigest;
    };
    const beforeMetadataDigest = digest(observed.beforeMetadataDigest,
      'changed-path inventory before metadata digest');
    const afterMetadataDigest = digest(observed.afterMetadataDigest,
      'changed-path inventory after metadata digest');
    const paginationSourceDigest = digest(observed.paginationSourceDigest,
      'changed-path inventory pagination source digest');
    if (!Array.isArray(observed.pageDigests)
      || observed.pageDigests.length !== Math.ceil(observed.recordCount / 100)) {
      fail('changed-path inventory page digest census is invalid.');
    }
    const pageDigests = Object.freeze(observed.pageDigests.map((entry, index) => (
      digest(entry, `changed-path inventory page[${index}] digest`)
    )));
    const paths = canonicalChangedPaths(observed.paths);
    if (encodeVerificationActionData(paths) !== encodeVerificationActionData(observed.paths)) {
      fail('changed-path inventory paths are not canonical.');
    }
    const withoutDigest = Object.freeze({
      schema: 'sec-github-pr-files-inventory-v1' as const,
      repository: observed.repository,
      prNumber: observed.prNumber,
      state: observed.state,
      draft: observed.draft,
      baseSha,
      headSha,
      changedFiles: observed.changedFiles,
      recordCount: observed.recordCount,
      beforeMetadataDigest,
      afterMetadataDigest,
      paginationSourceDigest,
      pageDigests,
      paths
    });
    const inventoryDigest = digest(observed.inventoryDigest, 'changed-path inventory digest');
    if (hash(withoutDigest) !== inventoryDigest) {
      fail('changed-path inventory digest does not bind its observation.');
    }
    if (observed.repository !== expected.repository || observed.prNumber !== expected.prNumber
      || observed.state !== expected.state || observed.draft !== expected.draft
      || baseSha !== expectedBaseSha || headSha !== expectedHeadSha) {
      fail('changed-path inventory differs from the expected open candidate identity.');
    }
    return Object.freeze({ ...withoutDigest, inventoryDigest });
  }

  async readBlobText(repository: string, ref: string, blobPath: string): Promise<string> {
    if (this.#transport.blobText === undefined) fail('blob observation is unavailable.');
    const source = (await this.#transport.blobText(repository, ref, blobPath));
    if (typeof source !== 'string' || source.length === 0 || Buffer.byteLength(source, 'utf8') > 131_072) {
      fail('blob observation is invalid.');
    }
    return source;
  }

  async observeComparison(repository: string, baseSha: string, headSha: string): Promise<GitHubComparisonObservation> {
    if (this.#transport.comparison === undefined) fail('comparison observation is unavailable.');
    const comparison = (await this.#transport.comparison(repository, baseSha, headSha));
    if (!['ahead', 'behind', 'diverged', 'identical'].includes(comparison.status)
      || !Number.isSafeInteger(comparison.behindBy) || comparison.behindBy < 0) fail('comparison observation is invalid.');
    return Object.freeze({ ...comparison });
  }

  async observeOpenPullRequestCountForHead(repository: string, headSha: string): Promise<number> {
    if (this.#transport.openPullRequestCountForHead === undefined) fail('same-head PR observation is unavailable.');
    const count = (await this.#transport.openPullRequestCountForHead(repository, headSha));
    if (!Number.isSafeInteger(count) || count < 0) fail('same-head PR observation is invalid.');
    return count;
  }

  async observePrincipal(repository: string, login: string): Promise<GitHubPrincipalObservation> {
    if (this.#transport.principal === undefined) fail('principal observation is unavailable.');
    const principal = (await this.#transport.principal(repository, login));
    if (principal.login !== login || typeof principal.nodeId !== 'string' || principal.nodeId.length === 0
      || !['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(principal.permission)) {
      fail('principal observation is invalid.');
    }
    return Object.freeze({ ...principal });
  }

  async observePrincipalByNodeId(repository: string, nodeId: string): Promise<GitHubPrincipalObservation> {
    if (this.#transport.principalByNodeId === undefined) fail('principal node observation is unavailable.');
    const principal = (await this.#transport.principalByNodeId(repository, nodeId));
    if (principal.nodeId !== nodeId || typeof principal.login !== 'string' || principal.login.length === 0) {
      fail('principal node observation is invalid.');
    }
    return Object.freeze({ ...principal });
  }

  async observeViewerPrincipal(repository: string): Promise<GitHubPrincipalObservation> {
    if (this.#transport.viewerPrincipal === undefined) fail('viewer principal observation is unavailable.');
    const principal = (await this.#transport.viewerPrincipal(repository));
    if (typeof principal.nodeId !== 'string' || principal.nodeId.length === 0
      || typeof principal.login !== 'string' || principal.login.length === 0) fail('viewer principal observation is invalid.');
    return Object.freeze({ ...principal });
  }

  async observeActionsArtifact(repository: string, artifactId: string): Promise<GitHubActionsArtifactObservation> {
    if (this.#transport.actionsArtifact === undefined) fail('Actions artifact observation is unavailable.');
    const artifact = (await this.#transport.actionsArtifact(repository, artifactId));
    if (artifact.artifactId !== artifactId || artifact.artifactName.length === 0
      || !/^[0-9a-f]{40}$/u.test(artifact.workflowSha) || artifact.runId.length === 0
      || !Number.isSafeInteger(artifact.runAttempt) || artifact.runAttempt < 1 || artifact.actorNodeId.length === 0
      || artifact.expired) {
      fail('Actions artifact observation is invalid.');
    }
    return Object.freeze({ ...artifact });
  }

  async observeActionsArtifactsForRun(repository: string, runId: string): Promise<readonly GitHubActionsArtifactObservation[]> {
    if (this.#transport.actionsArtifactsForRun === undefined) fail('Actions run artifact observation is unavailable.');
    const artifacts = (await (await this.#transport.actionsArtifactsForRun(repository, runId)).filter((entry) => !entry.expired));
    for (const artifact of artifacts) {
      if (artifact.artifactName.length === 0 || !/^[0-9a-f]{40}$/u.test(artifact.workflowSha)
        || artifact.runId !== runId || !Number.isSafeInteger(artifact.runAttempt)
        || artifact.runAttempt < 1 || artifact.actorNodeId.length === 0) {
        fail('Actions run artifact inventory is invalid.');
      }
    }
    return Object.freeze([...artifacts]);
  }

  async observeActionsArtifacts(repository: string): Promise<readonly GitHubActionsArtifactObservation[]> {
    if (this.#transport.actionsArtifacts === undefined) fail('repository Actions artifact observation is unavailable.');
    const artifacts = (await (await this.#transport.actionsArtifacts(repository)).filter((entry) => !entry.expired));
    for (const artifact of artifacts) {
      if (artifact.artifactName.length === 0 || !/^[0-9a-f]{40}$/u.test(artifact.workflowSha)
        || artifact.runId.length === 0 || !Number.isSafeInteger(artifact.runAttempt)
        || artifact.runAttempt < 1 || artifact.actorNodeId.length === 0) {
        fail('repository Actions artifact inventory is invalid.');
      }
    }
    return Object.freeze([...artifacts]);
  }

  async downloadArtifactText(repository: string, artifact: GitHubActionsArtifactObservation, fileName: string): Promise<string> {
    if (this.#transport.downloadArtifactText === undefined) fail('Actions artifact download is unavailable.');
    const source = (await this.#transport.downloadArtifactText(repository, artifact, fileName));
    if (source.length === 0 || Buffer.byteLength(source, 'utf8') > 10 * 1024 * 1024) fail('Actions artifact file is empty or oversized.');
    return source;
  }

  async observePlatformEnforcement(repository: string): Promise<PlatformEnforcementObservation> {
    try {
      const source = await this.#transport.repositoryRulesets(repository);
      if (source === null || typeof source !== 'object' || Array.isArray(source)) {
        fail('platform enforcement readback must be one canonical ruleset bundle.');
      }
      const bundle = source as Record<string, unknown>;
      const keys = Object.keys(bundle).sort();
      if (keys.length !== 3
          || keys[0] !== 'defaultBranch'
          || keys[1] !== 'detailedRulesets'
          || keys[2] !== 'effectiveRules'
          || typeof bundle.defaultBranch !== 'string') {
        fail('platform enforcement readback fields are invalid.');
      }
      const receipt = createMainAuthorityRulesetReceipt({
        repository,
        defaultBranch: bundle.defaultBranch,
        effectiveRules: bundle.effectiveRules,
        detailedRulesets: bundle.detailedRulesets,
        expectedIntegrationId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id
      });
      return Object.freeze({
        status: 'available',
        rulesetDigest: receipt.rulesetDigest,
        reason: null
      });
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : null;
      const message = error instanceof Error ? error.message : String(error);
      if (statusCode === 403) {
        return Object.freeze({
          status: 'platform-enforcement-unavailable',
          rulesetDigest: hash({ status: 'platform-enforcement-unavailable', statusCode: 403 }),
          reason: 'GitHub canonical main-authority ruleset readback is unavailable'
        });
      }
      return Object.freeze({
        status: 'unknown',
        rulesetDigest: hash({
          status: 'unknown',
          reasonCode: 'main-authority-ruleset-not-proven'
        }),
        reason: `Canonical MainAuthority ruleset proof failed: ${message}`
      });
    }
  }

  async observeHostedReviewLocator(input: {
    repository: string;
    prNumber: number;
    sessionRevision: SessionDigest;
    operationId: SessionDigest;
    headSha: string;
    headTreeSha: string;
    sourceRunId: string;
    sourceRunAttempt: number;
    workflowRef: string;
  }): Promise<Readonly<{
    status: 'absent' | 'reused';
    commentId: string | null;
    publicationDigest: SessionDigest;
    body: string;
  }>> {
    const expected = createReviewLocatorComment(input);
    const inventory = async () => normalizeIssueComments((await collectPages('hosted Review locator comments', async (cursor) => (
      (await this.#transport.issueCommentPage(input.repository, input.prNumber, cursor))
    ))).nodes);
    const classify = (comments: readonly GitHubIssueCommentObservation[]) => {
      const matching: Array<{ comment: GitHubIssueCommentObservation;
        publication: VerificationSessionReviewLocatorComment }> = [];
      for (const comment of comments) {
        if (!comment.body.includes(VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER)) continue;
        if (!trustedHostedPublisher(comment)) continue;
        const publication = parseReviewLocatorComment(comment.body);
        if (publication === null) fail(`Review locator comment ${comment.id} marker did not parse.`);
        if (publication.sessionRevision === input.sessionRevision
          && publication.operationId === input.operationId) matching.push({ comment, publication });
      }
      if (matching.length > 1) fail('duplicate hosted Review locator comments exist for one operation.');
      if (matching.length === 1
        && matching[0]!.publication.publicationDigest !== expected.publicationDigest) {
        fail('hosted Review locator operation has conflicting semantic bytes.');
      }
      return matching[0] ?? null;
    };
    const existing = classify(await inventory());
    const body = renderReviewLocatorComment(expected);
    return existing === null
      ? Object.freeze({ status: 'absent' as const, commentId: null,
          publicationDigest: expected.publicationDigest, body })
      : Object.freeze({ status: 'reused' as const, commentId: existing.comment.id,
          publicationDigest: existing.publication.publicationDigest, body });
  }

  async observeMaintainerReviewWakeup(input: {
    repository: string;
    prNumber: number;
    sessionRevision: SessionDigest;
    operationId: SessionDigest;
    requestOperationId: SessionDigest;
    headSha: string;
    headTreeSha: string;
    publisherLogin: string;
    publisherNodeId: string;
  }): Promise<Readonly<{
    status: 'absent' | 'reused';
    commentId: string | null;
    wakeupDigest: SessionDigest;
    body: string;
  }>> {
    const publisherLogin = boundedText(input.publisherLogin, 'Review wake-up publisherLogin', 256);
    const publisherNodeId = boundedText(input.publisherNodeId, 'Review wake-up publisherNodeId', 256);
    const currentPermission = (await this.#transport.collaboratorPermission(input.repository, publisherLogin));
    if (currentPermission !== 'admin' && currentPermission !== 'maintain') {
      fail('Review wake-up publisher lacks current maintain/admin permission.');
    }
    const expected = createReviewWakeupComment({ ...input, publisherLogin, publisherNodeId });
    const comments = normalizeIssueComments((await collectPages('maintainer Review wake-up comments', async (cursor) => (
      (await this.#transport.issueCommentPage(input.repository, input.prNumber, cursor))
    ))).nodes);
    const matching: Array<{ comment: GitHubIssueCommentObservation;
      wakeup: VerificationSessionReviewWakeupComment }> = [];
    for (const comment of comments) {
      if (!comment.body.includes(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER)) continue;
      if (comment.authorType !== 'User' || comment.performedViaGitHubApp !== null) continue;
      const permission = (await this.#transport.collaboratorPermission(input.repository, comment.authorLogin));
      if (permission !== 'admin' && permission !== 'maintain') continue;
      const wakeup = parseReviewWakeupComment(comment.body);
      if (wakeup === null) fail(`Review wake-up comment ${comment.id} marker did not parse.`);
      // GitHub login is a mutable projection: an account rename rewrites the login
      // observed on an existing comment. The node id is the immutable publisher
      // identity; current permission is deliberately re-read through the comment's
      // current login immediately above.
      if (wakeup.publisherNodeId !== comment.authorNodeId) continue;
      if (wakeup.sessionRevision !== input.sessionRevision
        || wakeup.operationId !== input.operationId) continue;
      if (wakeup.repository !== input.repository
        || wakeup.requestOperationId !== input.requestOperationId
        || wakeup.prNumber !== input.prNumber || wakeup.headSha !== input.headSha
        || wakeup.headTreeSha !== input.headTreeSha) {
        fail('maintainer Review wake-up operation has conflicting semantic bytes.');
      }
      matching.push({ comment, wakeup });
    }
    if (matching.length > 1) fail('duplicate maintainer Review wake-up comments exist for one operation.');
    const existing = matching[0] ?? null;
    const body = existing === null ? renderReviewWakeupComment(expected) : existing.comment.body;
    return existing === null
      ? Object.freeze({ status: 'absent' as const, commentId: null,
          wakeupDigest: expected.wakeupDigest, body })
      : Object.freeze({ status: 'reused' as const, commentId: existing.comment.id,
          wakeupDigest: existing.wakeup.wakeupDigest, body });
  }

  async ensureVerificationSessionWakeup(repository: string, request: VerificationSessionHostedRequest): Promise<void> {
    (await this.#transport.dispatchVerificationSession(repository, request));
  }

}

const VERIFICATION_CLIENT_METHODS = [
  'observeCandidate',
  'observePullRequestClosingFacts',
  'observeReviewBarrier',
  'observeChecks',
  'observeWorkflowRuns',
  'observeWorkflowJobsForAttempt',
  'observeVerificationSessionWorkflowJoin',
  'observeChangedPaths',
  'readBlobText',
  'observeComparison',
  'observeOpenPullRequestCountForHead',
  'observePrincipal',
  'observePrincipalByNodeId',
  'observeViewerPrincipal',
  'observeActionsArtifact',
  'observeActionsArtifactsForRun',
  'observeActionsArtifacts',
  'downloadArtifactText',
  'observePlatformEnforcement',
  'observeReviewProviderAvailability',
  'observeHostedReviewLocator',
  'observeMaintainerReviewWakeup',
  'ensureVerificationSessionWakeup',
] as const;
export type VerificationSessionGitHubClient = Readonly<Pick<
  VerificationSessionGitHubAdapter, (typeof VERIFICATION_CLIENT_METHODS)[number]
>>;

export type VerificationSessionGitHubOptions = Readonly<{
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>;

export function createVerificationSessionGitHubClient(
  repositoryRoot: string,
  repository: string,
  options: VerificationSessionGitHubOptions = {}
): VerificationSessionGitHubClient {
  const processOptions = Object.freeze({...options});
  const adapter = new VerificationSessionGitHubAdapter(
    new HttpVerificationSessionTransport(repository)
  );
  authorityBearingGitHubAdapters.add(adapter);
  const client: Record<string, unknown> = {};
  for (const method of VERIFICATION_CLIENT_METHODS) {
    const selectedStore = currentGitHubCredentialStoreIdentity();
    client[method] = async (...args: unknown[]) => {
      const capturedArgs = structuredClone(args);
      const selectedRepository = typeof capturedArgs[0] === 'string' ? capturedArgs[0] : (capturedArgs[0] as {repository?: unknown})?.repository;
      if (selectedRepository !== repository) fail('GitHub transport repository binding changed.');
      if (currentGitHubCredentialStoreIdentity() !== selectedStore) fail('GitHub transport credential binding changed.');
      return await withGitHubApiVerificationSession({
      repositoryRoot, repository,
      effect: method === 'ensureVerificationSessionWakeup' ? 'verification-dispatch' : 'verification-read',
      ...(processOptions.deadlineAtUnixMs === undefined ? {} : { deadlineAtUnixMs: processOptions.deadlineAtUnixMs }),
      ...(processOptions.signal === undefined ? {} : {signal:processOptions.signal}),
      operation: async () => await Reflect.apply(adapter[method], adapter, capturedArgs)
    }); };
  }
  return Object.freeze(client) as VerificationSessionGitHubClient;
}

/** Immutable, observation-only transaction seam for deterministic Review evaluation. */
export interface VerificationSessionReviewObservationTransaction {
  candidate(repository: string, prNumber: number): GitHubCandidateObservation | Promise<GitHubCandidateObservation>;
  reviewPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewObservation> | Promise<GitHubPage<GitHubReviewObservation>>;
  threadPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewThreadObservation> | Promise<GitHubPage<GitHubReviewThreadObservation>>;
  reviewRequestPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewRequestObservation> | Promise<GitHubPage<GitHubReviewRequestObservation>>;
  appCommentPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubAppReviewCommentObservation> | Promise<GitHubPage<GitHubAppReviewCommentObservation>>;
  issueCommentPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubIssueCommentObservation> | Promise<GitHubPage<GitHubIssueCommentObservation>>;
  repositoryIssueCommentPage(repository: string, after: string | null): GitHubPage<GitHubIssueCommentObservation> | Promise<GitHubPage<GitHubIssueCommentObservation>>;
  resolveCommitOid(repository: string, locator: string): GitHubCommitResolutionObservation | Promise<GitHubCommitResolutionObservation>;
  collaboratorPermission(repository: string, login: string): 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none' | Promise<'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none'>;
}

export async function evaluateReviewProviderAvailabilityObservation(
  transaction: Pick<VerificationSessionReviewObservationTransaction, 'repositoryIssueCommentPage'>
    & Partial<Pick<VerificationSessionReviewObservationTransaction, 'collaboratorPermission'>>,
  input: Parameters<VerificationSessionGitHubAdapter['observeReviewProviderAvailability']>[0]
): Promise<Awaited<ReturnType<VerificationSessionGitHubAdapter['observeReviewProviderAvailability']>>> {
  const transport = Object.freeze({
    repositoryIssueCommentPage: (repository: string, after: string | null) =>
      transaction.repositoryIssueCommentPage(repository, after),
    collaboratorPermission: (repository: string, login: string) =>
      transaction.collaboratorPermission?.(repository, login) ?? 'none'
  });
  return await new VerificationSessionGitHubAdapter(
    transport as unknown as VerificationSessionGitHubTransport
  ).observeReviewProviderAvailability(input);
}

export async function evaluateVerificationSessionReviewObservation(
  transaction: VerificationSessionReviewObservationTransaction,
  input: Parameters<VerificationSessionGitHubAdapter['observeReviewBarrier']>[0]
): Promise<GitHubReviewBarrierObservation> {
  return (await new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeReviewBarrier(input));
}

/** Effectful observation seam for exact hosted Review locator producer/consumer round trips. */
export async function evaluateHostedReviewLocatorObservation(
  transaction: Pick<VerificationSessionReviewObservationTransaction, 'issueCommentPage'>,
  input: Parameters<VerificationSessionGitHubAdapter['observeHostedReviewLocator']>[0]
): Promise<Awaited<ReturnType<VerificationSessionGitHubAdapter['observeHostedReviewLocator']>>> {
  return (await new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeHostedReviewLocator(input));
}

/** Effectful observation seam for the maintainer-authored Review activation signal. */
export async function evaluateMaintainerReviewWakeupObservation(
  transaction: Pick<VerificationSessionReviewObservationTransaction,
    'issueCommentPage' | 'collaboratorPermission'>,
  input: Parameters<VerificationSessionGitHubAdapter['observeMaintainerReviewWakeup']>[0]
): Promise<Awaited<ReturnType<VerificationSessionGitHubAdapter['observeMaintainerReviewWakeup']>>> {
  return (await new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeMaintainerReviewWakeup(input));
}

export interface VerificationSessionWorkflowObservationTransaction {
  workflowRunPage(
    repository: string,
    headSha: string,
    after: string | null
  ): GitHubPage<GitHubWorkflowRunObservation> | Promise<GitHubPage<GitHubWorkflowRunObservation>>;
}

export async function evaluateVerificationSessionWorkflowJoin(
  transaction: VerificationSessionWorkflowObservationTransaction,
  input: Parameters<VerificationSessionGitHubAdapter['observeVerificationSessionWorkflowJoin']>[0]
): Promise<VerificationSessionWorkflowJoin> {
  return (await new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeVerificationSessionWorkflowJoin(input));
}

export async function evaluatePlatformEnforcementObservation(input: {
  repository: string;
  readRulesets(): unknown;
}): Promise<PlatformEnforcementObservation> {
  return (await new VerificationSessionGitHubAdapter({
    repositoryRulesets: () => input.readRulesets()
  } as unknown as VerificationSessionGitHubTransport).observePlatformEnforcement(input.repository));
}

export async function evaluateVerificationSessionChangedPaths(
  transaction: Readonly<{
    pullRequestFileInventory(
      repository: string,
      prNumber: number
    ): GitHubPullRequestFileInventory;
  }>,
  expected: GitHubPullRequestFileInventoryExpectation
): Promise<GitHubPullRequestFileInventory> {
  return (await new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeChangedPaths(expected));
}

function apiFailure(message: string, statusCode?: number): GitHubApiFailure {
  return new GitHubApiFailure(message, statusCode);
}

/** Concrete provider transport; construction is module-private. */
class HttpVerificationSessionTransport implements VerificationSessionGitHubTransport {
  private readonly repository: string;
  private readonly credentialStoreIdentity: string | undefined;

  private bindRepository(repository: string): void {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
        this.repository !== repository) {
      fail('GitHub transport repository binding changed.');
    }
    if (currentGitHubCredentialStoreIdentity() !== this.credentialStoreIdentity) {
      fail('GitHub transport credential binding changed.');
    }
  }
  constructor(repository: string) {
    this.repository = repository;
    this.credentialStoreIdentity = currentGitHubCredentialStoreIdentity();
    this.bindRepository(repository);
  }

  private async request(operation: GitHubApiOperation): Promise<string> {
    try {
      const value = await executeGitHubApiOperation(
        currentGitHubApiCapability(this.repository, 'verification-read'), operation);
      return JSON.stringify(value);
    } catch (error) {
      if (error instanceof GitHubApiGraphqlResponseError && error.schemaUnsupported) {
        throw new GitHubProviderSchemaUnsupportedError({status:PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
          reasonCode:'github-graphql-schema-unsupported',responseDigest:error.responseDigest});
      }
      if (error instanceof GitHubApiProviderError) {
        const schemaFailure = classifyGitHubGraphQLSchemaFailure(error.message);
        if (schemaFailure !== null) throw new GitHubProviderSchemaUnsupportedError(schemaFailure);
        throw apiFailure(error.message, error.statusCode ?? undefined);
      }
      throw error;
    }
  }

  private async commitTreeSha(operation: GitHubApiOperation): Promise<string> {
    const value = parseJson<any>(await this.request(operation), 'GitHub scalar observation');
    return String(value?.tree?.sha);
  }

  private async pagesText(operation: (page: number) => GitHubApiOperation, field?: string): Promise<string> {
    const pages: unknown[] = [];
    let totalCount: number | undefined;
    let count = 0;
    for (let page = 1; page <= 1000; page += 1) {
      const value = parseJson<any>(await this.request(operation(page)), 'GitHub REST page');
      const entries = field === undefined ? value : value?.[field];
      if (!Array.isArray(entries) || entries.length > 100) fail('GitHub REST page is not a bounded array.');
      if (field !== undefined && value.total_count !== undefined) {
        if (!Number.isSafeInteger(value.total_count) || value.total_count < 0 ||
            (totalCount !== undefined && totalCount !== value.total_count)) fail('GitHub REST total count changed.');
        totalCount = value.total_count;
      }
      pages.push(value); count += entries.length;
      if (entries.length < 100 || (totalCount !== undefined && count === totalCount)) {
        if (totalCount !== undefined && count !== totalCount) fail('GitHub REST pagination is incomplete.');
        return JSON.stringify(pages);
      }
    }
    return fail('GitHub REST pagination exceeded its bound.');
  }

  private async candidateProjection(prNumber: number): Promise<string> {
    const source = await this.request({kind:'pull',pullRequestNumber:prNumber});
    try {
      const pr = parseJson<any>(source,'PR readback');
      if (!['open','closed'].includes(pr?.state) || typeof pr?.merged !== 'boolean' || typeof pr?.draft !== 'boolean' ||
          typeof pr?.head?.repo?.full_name !== 'string' || pr?.base?.repo?.full_name !== this.repository ||
          typeof pr?.user?.node_id !== 'string' || pr.user.node_id.length === 0) fail('PR repository/state identity is incomplete.');
      return JSON.stringify({ number:pr.number, state:pr.merged ? 'MERGED' : pr.state.toUpperCase(),
        isDraft:pr.draft, isCrossRepository:pr.head.repo.full_name !== pr.base.repo.full_name,
        author:{id:pr.user.node_id}, baseRefName:pr.base.ref, baseRefOid:pr.base.sha,
        headRefName:pr.head.ref, headRefOid:pr.head.sha, title:pr.title, body:pr.body ?? '',
        mergeCommit:pr.merged ? {oid:pr.merge_commit_sha} : null });
    } catch (error) {
      return rethrowProviderResponseShape(error,'github-rest-pr-readback',{repository:this.repository,prNumber,source});
    }
  }

  private async graphql(query: string, variables: Readonly<Record<string, unknown>>, _label: string): Promise<string> {
    return await this.request({kind:'verification-query',document:query,variables});
  }

  async pullRequestClosingFacts(
    repository: string,
    prNumber: number
  ): Promise<GitHubPullRequestClosingFacts> {
    this.bindRepository(repository);
    const [owner, name] = repository.split('/');
    if (owner === undefined || name === undefined || repository !== `${owner}/${name}`) {
      fail('repository must be owner/name.');
    }
    let cursor: string | null = null;
    let common: ReturnType<typeof parseGitHubPullRequestClosingFactsPage>['facts'] | null = null;
    let expectedTotal: number | null = null;
    let terminalObserved = false;
    const closingIssues: GitHubIssueReference[] = [];
    const pageDigests: SessionDigest[] = [];
    for (let page = 0; page < 256; page += 1) {
      const parsed = parseGitHubPullRequestClosingFactsPage({
        source: (await this.graphql(GITHUB_PULL_REQUEST_CLOSING_QUERY,
          { owner, name, number: prNumber, cursor }, 'PR closing issue page')), repository, prNumber,
        expectedCursor: cursor, observedBeforeCount: closingIssues.length,
        expectedTotalCount: expectedTotal
      });
      if (common === null) common = parsed.facts;
      else if (encodeVerificationActionData(common)
        !== encodeVerificationActionData(parsed.facts)) {
        fail('PR prose or identity changed during closing issue pagination.');
      }
      if (expectedTotal === null) expectedTotal = parsed.totalCount;
      else if (parsed.totalCount !== expectedTotal) {
        fail('PR closing issue totalCount changed during pagination.');
      }
      if (closingIssues.length + parsed.closingIssues.length > 256
        || closingIssues.length + parsed.closingIssues.length > parsed.totalCount) {
        fail('PR closing issue inventory exceeded its bound or totalCount.');
      }
      closingIssues.push(...parsed.closingIssues);
      pageDigests.push(parsed.responseDigest);
      if (parsed.nextCursor === null) {
        terminalObserved = true;
        break;
      }
      cursor = parsed.nextCursor;
      if (page === 255) fail('PR closing issue pagination exceeded its bound.');
    }
    if (common === null || expectedTotal === null || !terminalObserved
      || closingIssues.length !== expectedTotal) {
      fail('PR closing issue observation is incomplete against totalCount.');
    }
    const keys = closingIssues.map((issue) => `${issue.repository.toLowerCase()}#${issue.issueNumber}`);
    if (new Set(keys).size !== keys.length) fail('PR closing issue observation contains duplicates.');
    return Object.freeze({ ...common, closingIssues: Object.freeze(closingIssues),
      responseDigest: hash(Object.freeze({ pages: pageDigests, facts: common,
        providerTotalCount: expectedTotal, closingIssues })) });
  }

  async candidate(repository: string, prNumber: number): Promise<GitHubCandidateObservation> {
    this.bindRepository(repository);
    const prSource = (await this.candidateProjection(prNumber));
    let prValue: Record<string, any> | undefined;
    let baseTreeSource: string | undefined;
    let headTreeSource: string | undefined;
    let mergeCommitSource: string | undefined;
    let mergeCommitValue: Record<string, any> | undefined;
    const sourceBundle = () => Object.freeze({ repository, prNumber,
      pr: Object.freeze({ source: prSource, parsedValue: prValue ?? null }),
      baseTree: baseTreeSource === undefined ? null : Object.freeze({ source: baseTreeSource }),
      headTree: headTreeSource === undefined ? null : Object.freeze({ source: headTreeSource }),
      mergeCommit: mergeCommitSource === undefined ? null : Object.freeze({
        source: mergeCommitSource, parsedValue: mergeCommitValue ?? null
      })
    });
    try {
      const parsedPrValue = parseJson<unknown>(prSource, 'PR readback');
      if (parsedPrValue === null || typeof parsedPrValue !== 'object' || Array.isArray(parsedPrValue)) {
        throw new GitHubProviderResponseShapeError('PR readback returned a non-object payload.',
          'github-pr-readback-not-object', Object.freeze({ source: prSource, parsedValue: parsedPrValue }));
      }
      prValue = parsedPrValue as Record<string, any>;
      baseTreeSource = (await this.commitTreeSha({kind:'git-commit',sha:prValue.baseRefOid}));
      headTreeSource = (await this.commitTreeSha({kind:'git-commit',sha:prValue.headRefOid}));
      const mergeCommitSha = prValue.mergeCommit?.oid ?? null;
      if (mergeCommitSha !== null) {
        mergeCommitSource = (await this.request({kind:'git-commit',sha:mergeCommitSha}));
        const parsedMergeCommitValue = parseJson<unknown>(mergeCommitSource, 'merge commit readback');
        if (parsedMergeCommitValue === null || typeof parsedMergeCommitValue !== 'object'
          || Array.isArray(parsedMergeCommitValue)) {
          throw new GitHubProviderResponseShapeError('Merge commit readback returned a non-object payload.',
            'github-merge-commit-readback-not-object', Object.freeze({
              source: mergeCommitSource, parsedValue: parsedMergeCommitValue
            }));
        }
        mergeCommitValue = parsedMergeCommitValue as Record<string, any>;
      }
      const observation = Object.freeze({
        repository, number: prValue.number, state: prValue.state, isDraft: prValue.isDraft,
        isCrossRepository: prValue.isCrossRepository, authorNodeId: prValue.author?.id,
        baseBranch: prValue.baseRefName, baseSha: prValue.baseRefOid, baseTreeSha: baseTreeSource.trim(),
        headBranch: prValue.headRefName, headSha: prValue.headRefOid, headTreeSha: headTreeSource.trim(),
        title: prValue.title, body: prValue.body,
        mergeCommitSha, mergeCommitTreeSha: mergeCommitValue?.tree?.sha ?? null,
        mergeCommitMessage: mergeCommitValue?.message ?? null,
        mergeCommitParentShas: mergeCommitValue === undefined
          ? null
          : Array.isArray(mergeCommitValue.parents)
            ? Object.freeze(mergeCommitValue.parents.map((parent) => parent?.sha))
            : mergeCommitValue.parents
      });
      return bindProviderShapeSource(observation, sourceBundle());
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-candidate-pr-tree-merge', sourceBundle());
    }
  }

  async pullRequestFileInventory(
    repository: string,
    prNumber: number
  ): Promise<GitHubPullRequestFileInventory> {
    this.bindRepository(repository);
    const beforeSource = (await this.request({kind:'pull',pullRequestNumber:prNumber}));
    const pagesSource = (await this.pagesText(page => ({kind:'verification-pull-files',pullRequestNumber:prNumber,page})));
    const afterSource = (await this.request({kind:'pull',pullRequestNumber:prNumber}));
    return parseGitHubPullRequestFileInventory({ repository, prNumber,
      beforeSource, pagesSource, afterSource });
  }

  async blobText(repository: string, ref: string, blobPath: string): Promise<string> {
    this.bindRepository(repository);
    const value = parseJson<Record<string, any>>((await this.request({kind:'verification-blob',ref,path:blobPath})), 'blob readback');
    if (value.type !== 'file' || value.encoding !== 'base64' || typeof value.content !== 'string') {
      fail('blob readback did not return one base64 file.');
    }
    return Buffer.from(value.content.replaceAll('\n', ''), 'base64').toString('utf8');
  }

  async comparison(repository: string, baseSha: string, headSha: string): Promise<GitHubComparisonObservation> {
    this.bindRepository(repository);
    const value = parseJson<Record<string, any>>((await this.request({kind:'verification-compare',baseSha,headSha})), 'comparison readback');
    return { status: value.status, behindBy: value.behind_by };
  }

  async openPullRequestCountForHead(repository: string, headSha: string): Promise<number> {
    this.bindRepository(repository);
    repoParts(repository);
    assertSha(headSha, 'same-head PR census SHA');
    const readPage = async (page: number, label: string) => {
      const source = (await this.request({kind:'verification-open-pulls',page}));
      return Object.freeze({
        source,
        page: githubOpenPullRequestPage(parseJson<unknown>(source, label), label)
      });
    };
    const readCensus = async (label: string): Promise<string> => {
      const pages: unknown[][] = [];
      let complete = false;
      for (let page = 1; page <= GITHUB_OPEN_PULL_REQUEST_MAXIMUM_PAGES; page += 1) {
        const observed = await readPage(page, `${label} page ${page}`);
        pages.push([...observed.page]);
        if (observed.page.length < GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE) {
          complete = true;
          break;
        }
      }
      if (!complete) fail(`${label} exceeded the bounded page count.`);
      return JSON.stringify(pages);
    };
    const firstPagesSource = await readCensus('same-head PR first exhaustive census');
    const secondPagesSource = await readCensus('same-head PR second exhaustive census');
    return parseGitHubOpenPullRequestCensus({ repository, headSha,
      firstPagesSource, secondPagesSource });
  }

  async principal(repository: string, login: string): Promise<GitHubPrincipalObservation> {
    this.bindRepository(repository);
    const user = parseJson<Record<string, any>>((await this.request({kind:'verification-user',login})), 'principal readback');
    return { login, nodeId: String(user.node_id ?? ''), permission: (await this.collaboratorPermission(repository, login)) };
  }


  async principalByNodeId(repository: string, nodeId: string): Promise<GitHubPrincipalObservation> {
    this.bindRepository(repository);
    const value = parseJson<Record<string, any>>((await this.graphql(GITHUB_PRINCIPAL_NODE_QUERY,{id:nodeId},'principal node')), 'principal node readback');
    const user = value.data?.node;
    if (user?.id !== nodeId || typeof user.login !== 'string') fail('principal node did not resolve to one User.');
    return { login: user.login, nodeId, permission: (await this.collaboratorPermission(repository, user.login)) };
  }


  async viewerPrincipal(repository: string): Promise<GitHubPrincipalObservation> {
    this.bindRepository(repository);
    const principal = inspectGitHubApiCapability(currentGitHubApiCapability(repository,'verification-read')).principal;
    if (principal.permission === 'workflow') fail('Viewer requires a user principal.');
    return { login:principal.login, nodeId:principal.nodeId, permission:principal.permission };
  }

  async actionsArtifact(repository: string, artifactId: string): Promise<GitHubActionsArtifactObservation> {
    this.bindRepository(repository);
    const artifact = parseJson<Record<string, any>>((await this.request({kind:'verification-artifact',artifactId})), 'Actions artifact metadata');
    const runId = artifact.workflow_run?.id;
    if (!Number.isSafeInteger(runId)) fail('Actions artifact has no workflow run identity.');
    const run = parseJson<Record<string, any>>((await this.request({kind:'workflow-run',runId:String(runId)})), 'Actions run metadata');
    const canonicalRunId = String(runId);
    if (String(run.id ?? '') !== canonicalRunId) fail('Actions artifact workflow run identity drifted.');
    const actor = run.actor;
    if (typeof actor?.login !== 'string' || typeof actor?.node_id !== 'string') fail('Actions run actor identity is unavailable.');
    const artifactName = String(artifact.name);
    const attemptAuthority = classifyActionsArtifactAttemptAuthority(
      artifactName,
      canonicalRunId,
      Number(run.run_attempt)
    );
    const workflowPath = String(run.path ?? '');
    const workflowSha = String(run.head_sha ?? '');
    const archiveDigest = artifact.digest === null || artifact.digest === undefined
      ? null
      : typeof artifact.digest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(artifact.digest)
        ? artifact.digest as SessionDigest
        : fail('Actions artifact archive digest is malformed.');
    return { artifactId: String(artifact.id), artifactName, workflowPath,
      workflowRef: `${workflowPath}@${workflowSha}`, workflowSha, runId: canonicalRunId,
      runAttempt: attemptAuthority.runAttempt, eventName: String(run.event), actorNodeId: actor.node_id,
      actorPermission: (await this.collaboratorPermission(repository, actor.login)), archiveDigest,
      expired: artifact.expired === true };
  }


  async actionsArtifactsForRun(repository: string, runId: string): Promise<readonly GitHubActionsArtifactObservation[]> {
    this.bindRepository(repository);
    const pages = parseJson<any[]>((await this.pagesText(page => ({kind:'verification-artifacts',runId,page}),'artifacts')), 'Actions run artifact inventory');
    const artifacts: GitHubActionsArtifactObservation[] = [];
    for (const artifact of pages.flatMap(page => page.artifacts ?? [])) {
      if (artifact.expired !== true) artifacts.push(await this.actionsArtifact(repository, String(artifact.id)));
    }
    return artifacts;
  }


  async actionsArtifacts(repository: string): Promise<readonly GitHubActionsArtifactObservation[]> {
    this.bindRepository(repository);
    const source = (await this.pagesText(page => ({kind:'verification-artifacts',page}),'artifacts'));
    return (await evaluateGitHubRepositoryActionsArtifactInventory({ repository, source,
      observeArtifact: async (summary) => (await this.actionsArtifact(repository, summary.artifactId)) })).artifacts;
  }

  async downloadArtifactText(repository: string, artifact: GitHubActionsArtifactObservation, fileName: string): Promise<string> {
    this.bindRepository(repository);
    const text = await executeGitHubApiOperation(currentGitHubApiCapability(repository,'verification-read'),{kind:'verification-artifact-text',
      artifactId:artifact.artifactId,artifactName:artifact.artifactName,runId:artifact.runId,
      archiveDigest:artifact.archiveDigest,fileName });
    if (typeof text !== 'string') fail('Artifact member response is not text.');
    return text;
  }

  private async graphPages(query: string, repository: string, prNumber: number, label: string): Promise<any[]> {
    const { owner, name } = repoParts(repository);
    const field = query === GITHUB_REVIEWS_QUERY ? 'reviews' : query === GITHUB_THREADS_QUERY ? 'reviewThreads' : 'reviewRequests';
    const pages: any[] = [];
    const seen = new Set<string>();
    let endCursor: string | null = null;
    for (let count = 0; count < 1000; count += 1) {
      const source = await this.graphql(query,{owner,name,number:prNumber,endCursor},label);
      const value = parseJson<any>(source,label);
      pages.push(value);
      const connection = value?.data?.repository?.pullRequest?.[field];
      if (!connection) return bindProviderShapeSource(pages,{label,pages});
      const info = providerPageInfo(connection.pageInfo,label);
      if (!info.hasNextPage) return bindProviderShapeSource(pages,{label,pages});
      if (info.endCursor === null || seen.has(info.endCursor)) fail('GraphQL pagination did not advance.');
      seen.add(info.endCursor); endCursor = info.endCursor;
    }
    return fail('GraphQL pagination exceeded its bounded page count.');
  }

  private async reviewThreadCommentPage(threadId: string, after: string): Promise<Readonly<{ value: unknown; source: unknown }>> {
    const query = GITHUB_THREAD_COMMENTS_QUERY;
    const source = (await this.graphql(query,{threadId,endCursor:after},'thread comment page'));
    try {
      const value = parseJson<unknown>(source, 'review thread comment pagination');
      return Object.freeze({ value, source: Object.freeze({ threadId, after, source, parsedValue: value }) });
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-graphql-review-thread-comment-page',
        Object.freeze({ threadId, after, source }));
    }
  }

  async reviewPage(repository: string, prNumber: number, after: string | null): Promise<GitHubPage<GitHubReviewObservation>> {
    this.bindRepository(repository);
    if (after !== null) fail('default GraphQL transport returns all review pages in one page.');
    const query = GITHUB_REVIEWS_QUERY;
    const pages = (await this.graphPages(query, repository, prNumber, 'review pagination'));
    const resolverSources: unknown[] = [];
    let parsed: ReturnType<typeof parseGitHubReviewPages>;
    try {
      assertSuccessfulGraphqlReviewConnection(pages, 'reviews');
      const appResponses = new Map<string, unknown>();
      for (const page of pages) {
        for (const node of page.data.repository.pullRequest.reviews.nodes) {
          for (const app of SEC_REVIEW_STABILITY_POLICY.trustedApps) {
            if (node?.author?.__typename !== 'Bot' || node.author.id !== app.actorNodeId ||
                node.author.resourcePath !== `/apps/${app.appSlug}` || appResponses.has(app.appSlug)) continue;
            const source = await this.request({kind:'verification-app',slug:app.appSlug});
            const parsedValue = parseJson<unknown>(source, 'trusted Review App resolution');
            resolverSources.push(Object.freeze({ appSlug: app.appSlug, source, parsedValue }));
            appResponses.set(app.appSlug, parsedValue);
          }
        }
      }
      parsed = parseGitHubReviewPages({ source: pages, resolveApp: appSlug => {
        if (!appResponses.has(appSlug)) fail('Trusted App response was not collected.');
        return appResponses.get(appSlug);
      } });
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-graphql-review-pages', Object.freeze({
        field: 'reviews', pages: providerShapeSource(pages), resolverSources: Object.freeze(resolverSources)
      }));
    }
    return bindProviderShapeSource(Object.freeze({ nodes: parsed.nodes, hasNextPage: false, endCursor: null,
      pageDigest: parsed.pageDigest }), Object.freeze({ field: 'reviews',
      pages: providerShapeSource(pages), resolverSources: Object.freeze(resolverSources) }));
  }

  async threadPage(repository: string, prNumber: number, after: string | null): Promise<GitHubPage<GitHubReviewThreadObservation>> {
    this.bindRepository(repository);
    if (after !== null) fail('default GraphQL transport returns all thread pages in one page.');
    const query = GITHUB_THREADS_QUERY;
    const pages = (await this.graphPages(query, repository, prNumber, 'thread pagination'));
    const nestedThreadCommentResponses: unknown[] = [];
    let parsed: ReturnType<typeof parseGitHubReviewThreadPages>;
    try {
      assertSuccessfulGraphqlReviewConnection(pages, 'reviewThreads');
      const responses = new Map<string, unknown>();
      for (const page of pages) {
        for (const node of page.data.repository.pullRequest.reviewThreads.nodes) {
          if (typeof node?.id !== 'string' || node.id.length === 0) fail('Review thread identity is invalid.');
          let info = providerPageInfo(node.comments?.pageInfo, 'review thread comments');
          const seen = new Set<string>();
          for (let count = 0; info.hasNextPage; count += 1) {
            const cursor = info.endCursor;
            if (cursor === null || count >= 1000 || seen.has(cursor)) fail('Review thread pagination did not advance.');
            seen.add(cursor);
            const response = await this.reviewThreadCommentPage(node.id, cursor);
            nestedThreadCommentResponses.push(response.source);
            responses.set(JSON.stringify([node.id, cursor]), response.value);
            const value = response.value as any;
            if (value?.data?.node?.id !== node.id) fail('Review thread pagination identity changed.');
            info = providerPageInfo(value.data.node.comments?.pageInfo, 'review thread comment page');
          }
        }
      }
      parsed = parseGitHubReviewThreadPages({ source: pages, readCommentPage: (threadId, cursor) => {
        const key = JSON.stringify([threadId, cursor]);
        if (!responses.has(key)) fail('Review thread comment response was not collected.');
        return responses.get(key);
      } });
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-graphql-review-thread-pages',
        Object.freeze({ field: 'reviewThreads', pages: providerShapeSource(pages),
          nestedThreadCommentResponses: Object.freeze(nestedThreadCommentResponses) }));
    }
    return bindProviderShapeSource(Object.freeze({ nodes: parsed.nodes, hasNextPage: false,
      endCursor: null, pageDigest: parsed.pageDigest }), Object.freeze({ field: 'reviewThreads',
      pages: providerShapeSource(pages), nestedThreadCommentResponses: Object.freeze(nestedThreadCommentResponses) }));
  }

  async reviewRequestPage(repository: string, prNumber: number, after: string | null): Promise<GitHubPage<GitHubReviewRequestObservation>> {
    this.bindRepository(repository);
    if (after !== null) fail('default GraphQL transport returns all request pages in one page.');
    const query = GITHUB_REVIEW_REQUESTS_QUERY;
    const pages = (await this.graphPages(query, repository, prNumber, 'review request pagination'));
    try {
      assertSuccessfulGraphqlReviewConnection(pages, 'reviewRequests');
      const nodes = pages.flatMap((page) => page.data.repository.pullRequest.reviewRequests.nodes).map((node: any) => {
        const reviewer = node.requestedReviewer;
        if (reviewer === null || typeof reviewer !== 'object' || Array.isArray(reviewer)
          || typeof reviewer.id !== 'string' || (typeof reviewer.login !== 'string' && typeof reviewer.name !== 'string')) {
          throw new GitHubProviderResponseShapeError(
            'VerificationSession GitHub adapter GraphQL reviewRequests node shape is invalid.',
            'github-graphql-review-request-node', Object.freeze({ field: 'reviewRequests',
              pages: providerShapeSource(pages) })
          );
        }
        return {
          nodeId: reviewer.id,
          login: reviewer.login ?? reviewer.name,
          kind: reviewer.login ? 'user' as const : 'team' as const
        };
      });
      return bindProviderShapeSource(Object.freeze({ nodes, hasNextPage: false, endCursor: null,
        pageDigest: hash(pages) }), Object.freeze({ field: 'reviewRequests',
        pages: providerShapeSource(pages) }));
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-graphql-review-request-pages',
        Object.freeze({ field: 'reviewRequests', pages: providerShapeSource(pages) }));
    }
  }

  async appCommentPage(repository: string, prNumber: number, after: string | null): Promise<GitHubPage<GitHubAppReviewCommentObservation>> {
    this.bindRepository(repository);
    if (after !== null) fail('default REST transport returns all comment pages in one page.');
    const pages = parseJson<any[]>((await this.pagesText(page => ({kind:'issue-comments',issueNumber:prNumber,page}))), 'comment pagination');
    const nodes = pages.flat().filter((node: any) => node.performed_via_github_app?.id && node.user?.node_id).map((node: any) => ({
      id: String(node.id), authorNodeId: node.user.node_id, appId: node.performed_via_github_app.id,
      body: node.body, createdAt: node.created_at
    }));
    return { nodes, hasNextPage: false, endCursor: null, pageDigest: hash(pages) };
  }

  async issueCommentPage(repository: string, prNumber: number, after: string | null): Promise<GitHubPage<GitHubIssueCommentObservation>> {
    this.bindRepository(repository);
    if (after !== null) fail('default REST transport returns the complete issue-comment page set once.');
    const source = (await this.pagesText(page => ({kind:'issue-comments',issueNumber:prNumber,page})));
    try {
      const pages = parseJson<unknown>(source, 'issue comment pagination');
      if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
        fail('issue comment pagination must be the complete --paginate --slurp page set.');
      }
      const nodes = pages.flat().map((value, index) => issueCommentObservation(value,
        `issue comment ${index}`));
      return bindProviderShapeSource(Object.freeze({ nodes, hasNextPage: false, endCursor: null,
        pageDigest: hash(pages) }), Object.freeze({ repository, prNumber, source, parsedValue: pages }));
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-rest-issue-comment-pages',
        Object.freeze({ repository, prNumber, source }));
    }
  }

  async repositoryIssueCommentPage(repository: string, after: string | null): Promise<GitHubPage<GitHubIssueCommentObservation>> {
    this.bindRepository(repository);
    const pageNumber = after === null ? 1 : Number(after);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      fail('repository issue-comment page cursor is invalid.');
    }
    const source = (await this.request({kind:'verification-repository-comments',page:pageNumber}));
    try {
      const page = parseJson<unknown>(source, 'repository issue comment page');
      if (!Array.isArray(page) || page.length > 100) {
        fail('repository issue comment response must be one bounded REST page.');
      }
      const nodes = page.map((value, index) => issueCommentObservation(value,
        `repository issue comment ${index}`));
      const hasNextPage = page.length === 100;
      return bindProviderShapeSource(Object.freeze({
        nodes,
        hasNextPage,
        endCursor: hasNextPage ? String(pageNumber + 1) : null,
        pageDigest: hash(page)
      }), Object.freeze({ repository, pageNumber, source, parsedValue: page }));
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-rest-repository-issue-comment-page',
        Object.freeze({ repository, pageNumber, source }));
    }
  }

  async resolveCommitOid(repository: string, locator: string): Promise<GitHubCommitResolutionObservation> {
    this.bindRepository(repository);
    if (!/^(?:[0-9a-f]{10}|[0-9a-f]{40})$/u.test(locator)) {
      fail('reviewed commit locator must be exactly 10 or 40 lowercase hexadecimal characters.');
    }
    let source: string;
    try { source = await this.request({kind:'verification-commit-locator',locator}); }
    catch (error) {
      const status = error instanceof GitHubApiFailure ? error.statusCode : undefined;
      if (status === 404 || status === 409 || status === 422) return Object.freeze({
        repository,locator,status:status === 404 ? 'missing' : 'ambiguous',commitSha:null,treeSha:null,
        responseDigest:hash({repository,locator,status}) });
      throw error;
    }
    const value = parseJson<Record<string, any>>(source, 'reviewed commit resolution');
    const commitSha = assertSha(value.sha, 'resolved commitSha');
    const treeSha = assertSha(value.commit?.tree?.sha, 'resolved treeSha');
    if (!commitSha.startsWith(locator)) fail('resolved commit does not match the requested locator.');
    return Object.freeze({ repository, locator, status: 'resolved', commitSha, treeSha,
      responseDigest: hash(value) });
  }

  async collaboratorPermission(repository: string, login: string): Promise<'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none'> {
    this.bindRepository(repository);
    const source = await this.request({kind:'collaborator-permission',login});
    const parsedValue = parseJson<unknown>(source, 'GitHub collaborator permission');
    const permission = normalizeGitHubRepositoryPermission(parsedValue);
    if (permission === null) {
      throw new GitHubProviderResponseShapeError('VerificationSession GitHub adapter permission value is unknown.',
        'github-rest-collaborator-permission', Object.freeze({ repository, login, source, parsedValue }));
    }
    return permission;
  }

  async checkPage(repository: string, headSha: string, after: string | null): Promise<GitHubPage<GitHubCheckObservation>> {
    this.bindRepository(repository);
    if (after !== null) fail('default REST transport returns all check pages in one page.');
    const source = (await this.pagesText(page => ({kind:'check-runs',sha:headSha,page}),'check_runs'));
    try {
      const parsed = parseJson<unknown>(source, 'check pagination');
      const runs = new Map<string, unknown>();
      if (Array.isArray(parsed)) {
        for (const page of parsed) {
          if (!Array.isArray(page?.check_runs)) continue;
          for (const node of page.check_runs) {
            const runId = typeof node?.details_url === 'string'
              ? /\/actions\/runs\/([1-9][0-9]*)/u.exec(node.details_url)?.[1] : undefined;
            if (runId === undefined || runs.has(runId)) continue;
            runs.set(runId, parseJson<unknown>(await this.request({kind:'workflow-run',runId:String(runId)}), 'check workflow provenance'));
          }
        }
      }
      const nodes = parseGitHubCheckPages({ source: parsed, repository, headSha,
        observeWorkflowRun: runId => runs.get(runId) });
      return Object.freeze({ nodes, hasNextPage: false, endCursor: null,
        pageDigest: hash(parsed) });
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-rest-check-pages',
        Object.freeze({ repository, headSha, source }));
    }
  }

  async workflowRunPage(repository: string, headSha: string, after: string | null): Promise<GitHubPage<GitHubWorkflowRunObservation>> {
    this.bindRepository(repository);
    if (after !== null) fail('default REST transport returns all workflow pages in one page.');
    const pages = parseJson<any[]>((await this.pagesText(page => ({kind:'verification-workflow-runs',headSha,page}),'workflow_runs')), 'workflow pagination');
    const nodes = pages.flatMap((page) => page.workflow_runs ?? []).map((node: any) => ({
      id: String(node.id), name: node.name, displayTitle: node.display_title, workflowPath: node.path,
      event: node.event, status: node.status, conclusion: node.conclusion, headSha: node.head_sha,
      runAttempt: node.run_attempt, updatedAt: node.updated_at
    }));
    return { nodes, hasNextPage: false, endCursor: null, pageDigest: hash(pages) };
  }

  async workflowJobsForAttempt(
    repository: string,
    runId: string,
    runAttempt: number
  ): Promise<readonly GitHubWorkflowJobObservation[]> {
    this.bindRepository(repository);
    const pages = parseJson<unknown>((await this.pagesText(page => ({kind:'verification-workflow-jobs',runId,runAttempt,page}),'jobs')), 'workflow attempt job pagination');
    return parseGitHubWorkflowJobsForAttempt({ source: pages, runId, runAttempt });
  }

  async repositoryRulesets(repository: string): Promise<unknown> {
    this.bindRepository(repository);
    const repositorySource = parseJson(await this.request({ kind: 'repository' }),
      'repository metadata readback');
    if (repositorySource === null || typeof repositorySource !== 'object'
        || Array.isArray(repositorySource)
        || typeof (repositorySource as Record<string, unknown>).default_branch !== 'string') {
      fail('repository metadata has no canonical default branch.');
    }
    const defaultBranch = (repositorySource as Record<string, unknown>).default_branch as string;
    const pages = parseJson<unknown>(await this.pagesText(page => ({
      kind: 'effective-branch-rules', branch: defaultBranch, page
    })), 'effective branch rules readback');
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      fail('effective branch rules pagination is not a complete page array.');
    }
    const effectiveRules = pages.flatMap((page) => page as readonly unknown[]);
    const rulesetIds = new Set<number>();
    for (const [index, entry] of effectiveRules.entries()) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
          || !Number.isSafeInteger((entry as Record<string, unknown>).ruleset_id)
          || Number((entry as Record<string, unknown>).ruleset_id) < 1) {
        fail(`effective branch rule ${index} has no exact ruleset id.`);
      }
      rulesetIds.add(Number((entry as Record<string, unknown>).ruleset_id));
    }
    const detailedRulesets: unknown[] = [];
    for (const rulesetId of [...rulesetIds].sort((left, right) => left - right)) {
      detailedRulesets.push(parseJson(await this.request({ kind: 'ruleset', rulesetId }),
        `ruleset ${rulesetId} detail readback`));
    }
    return Object.freeze({
      defaultBranch,
      effectiveRules: Object.freeze([...effectiveRules]),
      detailedRulesets: Object.freeze(detailedRulesets)
    });
  }

  async dispatchVerificationSession(repository: string, request: VerificationSessionHostedRequest): Promise<void> {
    this.bindRepository(repository);
    await executeGitHubApiOperation(currentGitHubApiCapability(repository,'verification-dispatch'),
      {kind:'verification-dispatch',request:{...request}});
  }

}
