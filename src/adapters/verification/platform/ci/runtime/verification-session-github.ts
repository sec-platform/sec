/** GitHub observation and mutation adapter for the VerificationSession operator. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import {
  GITHUB_PULL_REQUEST_CLOSING_QUERY,
  type GitHubCheckObservation,
  type GitHubWorkflowJobObservation,
  type GitHubWorkflowJobStepObservation,
  type GitHubWorkflowRunObservation
} from '../../../../providers/github-api/contract.ts';
import {
  decodeBranchLifecycleChildError,
  decodeBranchLifecycleChildStdout
} from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import {
  parseGitHubPullRequestClosingFactsPage,
  type GitHubIssueReference,
  type GitHubPullRequestClosingFacts
} from '../../../../self-hosting/control/issues/disposition.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { matchesCiCompilerWorkflowRunIdentity } from '../../action/contract/provider.ts';
import type { ReviewPrincipal, ReviewSnapshot } from '../../review/contract/stability.ts';
import { createReviewSnapshotDigest, REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, REVIEW_STABILITY_POLICY } from '../../review/contract/stability.ts';
import { isCodexCleanReviewAboutBlock, isCodexCleanReviewVerdict } from '../../review/provider/codex-github.ts';
import {
  CI_VERIFICATION_SESSION_ARTIFACT_PREFIX,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from '../contract/revision.ts';
import type { VerificationSessionHostedRequest } from '../contract/session-request.ts';

export type SessionDigest = `sha256:${string}`;

const validatedClearReviewObservations = new WeakSet<object>();
const authorityBearingGitHubAdapters = new WeakSet<object>();

export function assertGitHubReviewAuthorityObservation(
  observation: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>
): void {
  if (!validatedClearReviewObservations.has(observation)) {
    throw new Error('Review receipt authority must be a live observation produced by the private GitHub adapter.');
  }
}


export interface GitHubCandidateObservation {
  repository: string;
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  isCrossRepository: boolean;
  authorNodeId: string;
  baseBranch: string;
  baseSha: string;
  baseTreeSha: string;
  headBranch: string;
  headSha: string;
  headTreeSha: string;
  title: string;
  body: string;
  mergeCommitSha: string | null;
  mergeCommitTreeSha: string | null;
  mergeCommitMessage: string | null;
  mergeCommitParentShas: readonly string[] | null;
}

export interface GitHubReviewObservation {
  id: string;
  authorNodeId: string;
  authorLogin: string;
  authorType: 'Bot' | 'User';
  appId: number | null;
  appNodeId: string | null;
  appSlug: string | null;
  commitSha: string;
  state: 'APPROVED' | 'COMMENTED' | 'CHANGES_REQUESTED' | 'DISMISSED';
  submittedAt: string;
}

export interface GitHubReviewThreadObservation {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  authorNodeIds: readonly string[];
}

export interface GitHubReviewRequestObservation {
  nodeId: string;
  login: string;
  kind: 'user' | 'team';
}


export interface GitHubIssueCommentObservation {
  id: string;
  body: string;
  authorLogin: string;
  authorId: number;
  authorNodeId: string;
  authorType: string;
  performedViaGitHubApp: { id: number; nodeId: string; slug: string } | null;
  createdAt: string;
}

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

export interface GitHubComparisonObservation {
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
  behindBy: number;
}

export interface GitHubActionsArtifactObservation {
  artifactId: string;
  artifactName: string;
  /** Provider-supplied digest of the immutable artifact archive, when available. */
  archiveDigest: SessionDigest | null;
  workflowPath: string;
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  eventName: string;
  actorNodeId: string;
  actorPermission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
  expired: boolean;
}

export interface GitHubPage<T> {
  nodes: readonly T[];
  hasNextPage: boolean;
  endCursor: string | null;
  pageDigest: SessionDigest;
}

export interface GitHubPullRequestFileInventory {
  readonly schema: 'sec-github-pr-files-inventory-v1';
  readonly repository: string;
  readonly prNumber: number;
  readonly state: 'OPEN' | 'CLOSED';
  readonly draft: boolean;
  readonly baseSha: string;
  readonly headSha: string;
  readonly changedFiles: number;
  readonly recordCount: number;
  readonly beforeMetadataDigest: SessionDigest;
  readonly afterMetadataDigest: SessionDigest;
  readonly paginationSourceDigest: SessionDigest;
  readonly pageDigests: readonly SessionDigest[];
  readonly paths: readonly string[];
  readonly inventoryDigest: SessionDigest;
}

export interface GitHubPullRequestFileInventoryExpectation {
  readonly repository: string;
  readonly prNumber: number;
  readonly state: 'OPEN';
  readonly draft: false;
  readonly baseSha: string;
  readonly headSha: string;
}

class GitHubApiFailure extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = 'GitHubApiFailure';
  }
}

interface VerificationSessionGitHubTransport {
  candidate(repository: string, prNumber: number): GitHubCandidateObservation;
  pullRequestClosingFacts(repository: string, prNumber: number): GitHubPullRequestClosingFacts;
  reviewPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewObservation>;
  threadPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewThreadObservation>;
  reviewRequestPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewRequestObservation>;
  issueCommentPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubIssueCommentObservation>;
  resolveCommitOid(repository: string, locator: string): GitHubCommitResolutionObservation;
  collaboratorPermission(repository: string, login: string): 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
  checkPage(repository: string, headSha: string, after: string | null): GitHubPage<GitHubCheckObservation>;
  workflowRunPage(repository: string, headSha: string, after: string | null): GitHubPage<GitHubWorkflowRunObservation>;
  workflowJobsForAttempt?(repository: string, runId: string, runAttempt: number): readonly GitHubWorkflowJobObservation[];
  repositoryRulesets(repository: string): unknown;
  dispatchVerificationSession(repository: string, request: VerificationSessionHostedRequest): void;
  pullRequestFileInventory?(
    repository: string,
    prNumber: number
  ): GitHubPullRequestFileInventory;
  blobText?(repository: string, ref: string, path: string): string;
  comparison?(repository: string, baseSha: string, headSha: string): GitHubComparisonObservation;
  openPullRequestCountForHead?(repository: string, headSha: string): number;
  principal?(repository: string, login: string): GitHubPrincipalObservation;
  principalByNodeId?(repository: string, nodeId: string): GitHubPrincipalObservation;
  viewerPrincipal?(repository: string): GitHubPrincipalObservation;
  actionsArtifact?(repository: string, artifactId: string): GitHubActionsArtifactObservation;
  actionsArtifactsForRun?(repository: string, runId: string): readonly GitHubActionsArtifactObservation[];
  actionsArtifacts?(repository: string): readonly GitHubActionsArtifactObservation[];
  downloadArtifactText?(repository: string, artifact: GitHubActionsArtifactObservation, fileName: string): string;
}

export type GitHubReviewBarrierObservation = Readonly<{
  status: 'clear';
  principal: ReviewPrincipal;
  snapshot: ReviewSnapshot;
  authority: Readonly<{
    sourceTransport: 'github-graphql' | 'github-rest';
    sourceDigest: SessionDigest;
    executionIdentity: string;
    providerIdentity: 'github';
    candidateWriteCapability: 'read-only';
    capabilityReceiptDigest: SessionDigest;
  }>;
  observedAt: string;
}> | Readonly<{
  status: 'waiting' | 'blocked';
  reason: string;
  snapshotDigest: SessionDigest;
  observedAt: string;
}> | Readonly<{
  status: 'provider-schema-unsupported';
  reasonCode: string;
  responseDigest: SessionDigest;
  observedAt: string;
}>;

export interface PlatformEnforcementObservation {
  status: 'available' | 'platform-enforcement-unavailable' | 'unknown';
  rulesetDigest: SessionDigest;
  reason: string | null;
}

export const PROVIDER_SCHEMA_UNSUPPORTED_STATUS = 'provider-schema-unsupported' as const;

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

const ABSENT_PROVIDER_RESPONSE_SOURCE = Object.freeze({ present: false as const });

function providerResponseShapeSource(source: unknown): unknown {
  return source === undefined ? ABSENT_PROVIDER_RESPONSE_SOURCE : source;
}

class GitHubProviderResponseShapeError extends Error {
  readonly source: unknown;

  constructor(
    message: string,
    readonly classification: string,
    source: unknown
  ) {
    super(message);
    this.name = 'GitHubProviderResponseShapeError';
    this.source = providerResponseShapeSource(source);
  }

  bindProviderResponse(classification: string, source: unknown): GitHubProviderResponseShapeError {
    return new GitHubProviderResponseShapeError(this.message, classification, source);
  }
}

// Private provenance sidecar: normalized observations never expose provider
// bytes, while their producing boundary can retain the exact source for a
// later typed schema projection.
const providerShapeSources = new WeakMap<object, unknown>();

function bindProviderShapeSource<T extends object>(value: T, source: unknown): T {
  providerShapeSources.set(value, source);
  return value;
}

function providerShapeSource(value: object): unknown {
  return providerShapeSources.get(value) ?? value;
}

function assertSuccessfulGraphqlReviewConnection(
  pages: readonly unknown[],
  field: 'reviews' | 'reviewThreads' | 'reviewRequests'
): void {
  if (pages.length === 0) {
    throw new GitHubProviderResponseShapeError(
      `VerificationSession GitHub adapter GraphQL ${field} pagination returned no successful pages.`,
      'github-graphql-empty-page-set', Object.freeze({ field, pages })
    );
  }
  const seenCursors = new Set<string>();
  for (const [index, page] of pages.entries()) {
    const connection = (page as any)?.data?.repository?.pullRequest?.[field];
    if (connection === null || typeof connection !== 'object' || Array.isArray(connection)
      || !Array.isArray(connection.nodes) || connection.pageInfo === null
      || typeof connection.pageInfo !== 'object' || Array.isArray(connection.pageInfo)
      || typeof connection.pageInfo.hasNextPage !== 'boolean'
      || (connection.pageInfo.endCursor !== null && typeof connection.pageInfo.endCursor !== 'string')) {
      throw new GitHubProviderResponseShapeError(
        `VerificationSession GitHub adapter GraphQL ${field} connection shape is invalid.`,
        'github-graphql-review-connection-shape', Object.freeze({ field, pages })
      );
    }
    const terminal = index === pages.length - 1;
    if (terminal ? connection.pageInfo.hasNextPage : !connection.pageInfo.hasNextPage) {
      throw new GitHubProviderResponseShapeError(
        `VerificationSession GitHub adapter GraphQL ${field} pagination is incomplete or extends beyond its terminal page.`,
        'github-graphql-review-pagination-incomplete', Object.freeze({ field, pages })
      );
    }
    const cursor = connection.pageInfo.endCursor;
    if (!terminal) {
      if (typeof cursor !== 'string' || cursor.length === 0 || seenCursors.has(cursor)) {
        throw new GitHubProviderResponseShapeError(
          `VerificationSession GitHub adapter GraphQL ${field} pagination cursor did not advance.`,
          'github-graphql-review-pagination-cursor', Object.freeze({ field, pages })
        );
      }
      seenCursors.add(cursor);
    } else if (typeof cursor === 'string' && cursor.length > 0 && seenCursors.has(cursor)) {
      throw new GitHubProviderResponseShapeError(
        `VerificationSession GitHub adapter GraphQL ${field} terminal pagination cursor did not advance.`,
        'github-graphql-review-pagination-cursor', Object.freeze({ field, pages })
      );
    }
  }
}

export function classifyGitHubGraphQLSchemaFailure(source: string): GitHubProviderSchemaFailure | null {
  const normalized = source.replaceAll('\r\n', '\n');
  const schemaMarkers = [
    /Field '[^']+' doesn't exist on type '[^']+'/u,
    /Unknown field '[^']+' on type '[^']+'/u,
    /Cannot query field '[^']+' on type '[^']+'/u,
    /Unknown type '[^']+'/u,
    /Field '[^']+' of required type '[^']+' was not provided/u
  ];
  if (!schemaMarkers.some((marker) => marker.test(normalized))) return null;
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

function hash(value: unknown): SessionDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

function fail(message: string): never {
  throw new GitHubProviderResponseShapeError(`VerificationSession GitHub adapter ${message}`,
    'github-adapter-shape', undefined);
}

function rethrowProviderResponseShape(error: unknown, classification: string, source: unknown): never {
  if (error instanceof GitHubProviderResponseShapeError) {
    throw error.bindProviderResponse(classification, Object.freeze({
      boundarySource: providerResponseShapeSource(source),
      causeClassification: error.classification,
      causeSource: error.source
    }));
  }
  throw error;
}

function providerResponseShapeDigest(error: GitHubProviderResponseShapeError): SessionDigest {
  return hash(Object.freeze({
    schema: 'sec-provider-response-shape-v2', classification: error.classification, source: error.source
  }));
}

export type GitHubObservationFailureClassification =
  | Readonly<{ kind: 'provider-invalid'; responseDigest: SessionDigest }>
  | Readonly<{ kind: 'transport-unavailable'; diagnostic: string }>;

/**
 * Provider failure routing for physical GitHub observations. A transport that
 * cannot be reached is absence; bytes that were reached but violate the
 * provider contract are invalid Evidence and must remain fail-closed.
 */
export function classifyGitHubObservationFailure(
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

function assertSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) fail(`${label} must be a SHA.`);
  return value;
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

function collectPages<T>(
  label: string,
  read: (cursor: string | null) => GitHubPage<T>
): { nodes: T[]; pageDigests: SessionDigest[]; sourceBundles: unknown[] } {
  const nodes: T[] = [];
  const pageDigests: SessionDigest[] = [];
  const sourceBundles: unknown[] = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const page = read(cursor);
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

function canonicalChangedPaths(paths: readonly unknown[]): readonly string[] {
  const result = [...paths].sort();
  if (result.length === 0 || new Set(result).size !== result.length || result.some((entry) => (
    typeof entry !== 'string' || entry.length === 0 || entry.includes('\\') || entry.startsWith('/')
      || entry.split('/').some((segment) => segment === '..')
  ))) fail('changed-path observation is invalid.');
  return Object.freeze(result as string[]);
}

const GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE = 100;
const GITHUB_OPEN_PULL_REQUEST_MAXIMUM_PAGES = 1000;

function githubOpenPullRequestPage(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE) {
    fail(`${label} must be one bounded REST page.`);
  }
  return value;
}

type GitHubOpenPullRequestCensusRecord = Readonly<{
  id: number;
  number: number;
  headSha: string;
}>;

function githubOpenPullRequestCensusRecord(
  raw: unknown,
  label: string
): GitHubOpenPullRequestCensusRecord {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`${label} must be an object.`);
  }
  const value = raw as Record<string, any>;
  if (!Number.isSafeInteger(value.id) || value.id < 1
    || !Number.isSafeInteger(value.number) || value.number < 1
    || value.state !== 'open') {
    fail(`${label} identity/state is invalid.`);
  }
  return Object.freeze({
    id: value.id as number,
    number: value.number as number,
    headSha: assertSha(value.head?.sha, `${label} head SHA`)
  });
}

export function parseGitHubOpenPullRequestCensus(input: {
  repository: string;
  headSha: string;
  firstPagesSource: string;
  secondPagesSource: string;
}): number {
  repoParts(input.repository);
  const expectedHeadSha = assertSha(input.headSha, 'same-head PR census SHA');
  const parsePass = (source: string, label: string) => {
    const rawPages = parseJson<unknown>(source, `${label} pagination`);
    if (!Array.isArray(rawPages) || rawPages.length < 1
      || rawPages.length > GITHUB_OPEN_PULL_REQUEST_MAXIMUM_PAGES) {
      fail(`${label} page set is empty or overbound.`);
    }
    const pages = rawPages.map((rawPage, pageIndex) => {
      const page = githubOpenPullRequestPage(rawPage, `${label} page[${pageIndex}]`);
      const finalPage = pageIndex === rawPages.length - 1;
      if ((!finalPage && page.length !== GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE)
        || (finalPage && page.length === GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE)) {
        fail(`${label} page[${pageIndex}] does not prove complete pagination.`);
      }
      return page.map((raw, recordIndex) => githubOpenPullRequestCensusRecord(
        raw,
        `${label} page[${pageIndex}][${recordIndex}]`
      ));
    });
    const records = pages.flat();
    const ids = new Set<number>();
    const numbers = new Set<number>();
    for (const record of records) {
      if (ids.has(record.id) || numbers.has(record.number)) {
        fail(`${label} contains a duplicate global PR id or number.`);
      }
      ids.add(record.id);
      numbers.add(record.number);
    }
    return records;
  };
  const canonical = (records: readonly GitHubOpenPullRequestCensusRecord[]) =>
    [...records].sort((left, right) => left.number - right.number || left.id - right.id
      || left.headSha.localeCompare(right.headSha))
      .map(({ number, id, headSha }) => Object.freeze({ number, id, headSha }));
  const first = parsePass(input.firstPagesSource, 'same-head PR first exhaustive census');
  const second = parsePass(input.secondPagesSource, 'same-head PR second exhaustive census');
  if (first.length !== second.length || hash(canonical(first)) !== hash(canonical(second))) {
    fail('same-head PR census changed between complete exhaustive passes.');
  }
  return first.filter((record) => record.headSha === expectedHeadSha).length;
}

export function parseGitHubPullRequestFileInventory(input: {
  repository: string;
  prNumber: number;
  beforeSource: string;
  pagesSource: string;
  afterSource: string;
}): GitHubPullRequestFileInventory {
  repoParts(input.repository);
  if (!Number.isSafeInteger(input.prNumber) || input.prNumber < 1) {
    fail('changed-path PR identity is invalid.');
  }
  const metadata = (source: string, label: string) => {
    const value = parseJson<Record<string, any>>(source, label);
    const changedFiles = value.changed_files;
    if (value.number !== input.prNumber || !Number.isSafeInteger(changedFiles) || changedFiles < 1
      || (value.state !== 'open' && value.state !== 'closed') || typeof value.draft !== 'boolean'
      || typeof value.base?.sha !== 'string' || typeof value.head?.sha !== 'string') {
      fail(`${label} identity/count is invalid.`);
    }
    return Object.freeze({ number: value.number as number,
      state: value.state === 'open' ? 'OPEN' as const : 'CLOSED' as const,
      draft: value.draft as boolean,
      baseSha: assertSha(value.base.sha, `${label} base SHA`),
      headSha: assertSha(value.head.sha, `${label} head SHA`),
      changedFiles: changedFiles as number,
      sourceDigest: hash(source) });
  };
  const before = metadata(input.beforeSource, 'changed-path PR before readback');
  const after = metadata(input.afterSource, 'changed-path PR after readback');
  if (before.state !== after.state || before.draft !== after.draft
    || before.baseSha !== after.baseSha || before.headSha !== after.headSha
    || before.changedFiles !== after.changedFiles) {
    fail('changed-path PR identity/count drifted during pagination.');
  }
  if (before.changedFiles > 3000) {
    fail('changed-path PR exceeds the provider 3000-file completeness boundary.');
  }
  const pages = parseJson<unknown>(input.pagesSource, 'changed-path pagination');
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 30
    || !pages.every(Array.isArray)) {
    fail('changed-path pagination page set is invalid or exceeds the provider boundary.');
  }
  const records: unknown[] = [];
  const pageDigests: SessionDigest[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    if (page.length > 100 || (pageIndex < pages.length - 1 && page.length !== 100)
      || (pageIndex === pages.length - 1 && page.length === 0)) {
      fail(`changed-path pagination page[${pageIndex}] is incomplete or malformed.`);
    }
    pageDigests.push(hash(Object.freeze({ schema: 'sec-github-pr-files-page-v1',
      page: pageIndex + 1, perPage: 100, records: page })));
    records.push(...page);
  }
  if (records.length !== before.changedFiles) {
    fail('changed-path paginated record count differs from provider-declared changed_files.');
  }
  const paths: string[] = [];
  const filenames = new Set<string>();
  for (const [index, raw] of records.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(`changedPaths[${index}] must be an object.`);
    }
    const entry = raw as Record<string, unknown>;
    const filename = boundedText(entry.filename, `changedPaths[${index}].filename`, 4096);
    const status = entry.status;
    if (typeof status !== 'string'
      || !['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(status)) {
      fail(`changedPaths[${index}].status is unknown.`);
    }
    if (filenames.has(filename)) fail('changed-path pagination contains a duplicate file record.');
    filenames.add(filename);
    paths.push(filename);
    const hasPreviousFilename = Object.hasOwn(entry, 'previous_filename');
    const paired = status === 'renamed' || status === 'copied';
    if (paired) {
      if (!hasPreviousFilename) fail(`changedPaths[${index}] ${status} record has no previous_filename.`);
      const previousFilename = boundedText(entry.previous_filename,
        `changedPaths[${index}].previous_filename`, 4096);
      if (previousFilename === filename) {
        fail(`changedPaths[${index}] ${status} record does not change its filename.`);
      }
      paths.push(previousFilename);
    } else if (hasPreviousFilename) {
      fail(`changedPaths[${index}] non-renamed record unexpectedly has previous_filename.`);
    }
  }
  const canonicalPaths = canonicalChangedPaths([...new Set(paths)]);
  const withoutDigest = Object.freeze({
    schema: 'sec-github-pr-files-inventory-v1' as const,
    repository: input.repository,
    prNumber: input.prNumber,
    state: before.state,
    draft: before.draft,
    baseSha: before.baseSha,
    headSha: before.headSha,
    changedFiles: before.changedFiles,
    recordCount: records.length,
    beforeMetadataDigest: before.sourceDigest,
    afterMetadataDigest: after.sourceDigest,
    paginationSourceDigest: hash(input.pagesSource),
    pageDigests: Object.freeze(pageDigests),
    paths: canonicalPaths
  });
  return Object.freeze({ ...withoutDigest, inventoryDigest: hash(withoutDigest) });
}

function boundedText(value: unknown, label: string, maximum = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    fail(`${label} must be bounded text.`);
  }
  return value;
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
  /^sec-merge-gate-result-v3-pr-[1-9][0-9]*-session-[0-9a-f]{64}-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u,
  /^sec-branch-closeout-recovery-v1-pr-[1-9][0-9]*-session-[0-9a-f]{64}-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u,
  /^sec-closeout-projections-v1-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u
]);

const SESSION_ATTEMPT_BOUND_ARTIFACT_PREFIXES = Object.freeze([
  'sec-verification-action-parent-dispatch-plan-v2-',
  `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-`,
  'sec-verification-action-resolution-v2-',
  'sec-verification-action-prepared-v2-',
  'sec-verification-action-raw-v2-',
  'sec-merge-gate-result-v3-',
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

export function evaluateGitHubRepositoryActionsArtifactInventory(input: Readonly<{
  repository: string;
  source: unknown;
  observeArtifact(summary: GitHubRepositoryActionsArtifactSummary): GitHubActionsArtifactObservation;
}>): Readonly<{
  inventory: GitHubRepositoryActionsArtifactInventory;
  artifacts: readonly GitHubActionsArtifactObservation[];
}> {
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
  const hydrated = inventory.artifacts.filter((entry) => entry.family === 'session' && !entry.expired)
    .map((entry) => {
      const observed = input.observeArtifact(entry);
      if (observed.artifactId !== entry.artifactId || observed.artifactName !== entry.artifactName
        || observed.archiveDigest !== entry.archiveDigest || observed.expired !== entry.expired
        || observed.runId !== entry.expectedRunId
        || observed.runAttempt !== entry.sessionRunAttempt) {
        fail('repository Actions artifact hydration differs from its selected summary identity.');
      }
      return Object.freeze({ ...observed });
    });
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

  observeCandidate(repository: string, prNumber: number): GitHubCandidateObservation {
    const candidate = this.#transport.candidate(repository, prNumber);
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

  observePullRequestClosingFacts(
    repository: string,
    prNumber: number
  ): GitHubPullRequestClosingFacts {
    const facts = this.#transport.pullRequestClosingFacts(repository, prNumber);
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

  private observeReviewBarrierUnchecked(input: {
    repository: string;
    prNumber: number;
    headSha: string;
    excludedPrincipalNodeIds: ReadonlySet<string>;
    observedAt?: string;
  }): GitHubReviewBarrierObservation {
    const observedAt = input.observedAt ?? new Date().toISOString();
    canonicalInstant(observedAt, 'Review observedAt');
    assertSha(input.headSha, 'requested Review headSha');
    const candidateBefore = this.observeCandidate(input.repository, input.prNumber);
    if (candidateBefore.headSha !== input.headSha) {
      fail('requested Review head differs from the provider PR head.');
    }
    const reviewPages = collectPages('reviews', (cursor) => this.#transport.reviewPage(input.repository, input.prNumber, cursor));
    const threadPages = collectPages('review threads', (cursor) => this.#transport.threadPage(input.repository, input.prNumber, cursor));
    const requestPages = collectPages('review requests', (cursor) => this.#transport.reviewRequestPage(input.repository, input.prNumber, cursor));
    const issueCommentPages = collectPages('issue comments', (cursor) =>
      this.#transport.issueCommentPage(input.repository, input.prNumber, cursor));
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
      const trustedApp = REVIEW_STABILITY_POLICY.trustedApps.find((app) => (
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
        this.#transport.resolveCommitOid(input.repository, marker.locator), input.repository, marker.locator
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
    const candidateAfter = this.observeCandidate(input.repository, input.prNumber);
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

    for (const trustedApp of REVIEW_STABILITY_POLICY.trustedApps) {
      const trustedReview = decisions.get(trustedApp.actorNodeId);
      if (trustedReview !== undefined && trustedReview.authorType === 'Bot'
        && trustedReview.appId === trustedApp.appId
        && trustedReview.appNodeId === trustedApp.appNodeId
        && trustedReview.appSlug === trustedApp.appSlug
        && trustedReview.state === 'APPROVED'
        && !input.excludedPrincipalNodeIds.has(trustedReview.authorNodeId)) {
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
    for (const trustedApp of REVIEW_STABILITY_POLICY.trustedApps) {
      const trustedComment = latestRestByApp.get(`${trustedApp.appId}:${trustedApp.actorNodeId}:` +
        `${trustedApp.appNodeId}:${trustedApp.appSlug}`);
      if (trustedComment?.clean === true) {
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

    const humans = [...decisions.values()]
      .filter((review) => (
        review.state === 'APPROVED'
        && review.authorType === 'User'
        && review.appId === null
        && !input.excludedPrincipalNodeIds.has(review.authorNodeId)
      ))
      .sort((left, right) => left.authorNodeId.localeCompare(right.authorNodeId));
    for (const review of humans) {
      const permission = this.#transport.collaboratorPermission(input.repository, review.authorLogin);
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
    return Object.freeze({ status: 'waiting', reason: 'exact-head-independent-review-missing',
      snapshotDigest: waitingSnapshotDigest, observedAt });
  }

  observeReviewBarrier(input: {
    repository: string;
    prNumber: number;
    headSha: string;
    excludedPrincipalNodeIds: ReadonlySet<string>;
    observedAt?: string;
  }): GitHubReviewBarrierObservation {
    const observedAt = input.observedAt ?? new Date().toISOString();
    try {
      return this.observeReviewBarrierUnchecked({ ...input, observedAt });
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

  observeChecks(repository: string, headSha: string): readonly GitHubCheckObservation[] {
    return Object.freeze(collectPages('check runs', (cursor) => this.#transport.checkPage(repository, headSha, cursor)).nodes);
  }

  observeWorkflowRuns(repository: string, headSha: string): readonly GitHubWorkflowRunObservation[] {
    assertSha(headSha, 'workflow run headSha');
    const runs = collectPages('workflow runs', (cursor) =>
      this.#transport.workflowRunPage(repository, headSha, cursor)).nodes;
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

  observeWorkflowJobsForAttempt(
    repository: string,
    runId: string,
    runAttempt: number
  ): readonly GitHubWorkflowJobObservation[] {
    if (this.#transport.workflowJobsForAttempt === undefined) {
      fail('workflow attempt job/step observation is unavailable.');
    }
    if (!/^[1-9][0-9]*$/u.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
      fail('workflow attempt identity is invalid.');
    }
    return Object.freeze([...this.#transport.workflowJobsForAttempt(repository, runId, runAttempt)]);
  }

  observeVerificationSessionWorkflowJoin(input: {
    repository: string;
    prNumber: number;
    sessionRevision: SessionDigest;
    actionPlanDigest: SessionDigest;
    baseSha: string;
    now?: string;
  }): VerificationSessionWorkflowJoin {
    if (!Number.isSafeInteger(input.prNumber) || input.prNumber < 1
      || !/^sha256:[0-9a-f]{64}$/u.test(input.sessionRevision)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.actionPlanDigest)) {
      fail('Session workflow join identity is invalid.');
    }
    const now = canonicalInstant(input.now ?? new Date().toISOString(), 'Session workflow join now');
    const expectedTitle = `verify session PR #${input.prNumber} session ${input.sessionRevision}`;
    const sessionPrefix = expectedTitle;
    const matching: GitHubWorkflowRunObservation[] = [];
    for (const run of this.observeWorkflowRuns(input.repository, input.baseSha)) {
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

  observeChangedPaths(
    expected: GitHubPullRequestFileInventoryExpectation
  ): GitHubPullRequestFileInventory {
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
    const observed = this.#transport.pullRequestFileInventory(expected.repository, expected.prNumber);
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

  readBlobText(repository: string, ref: string, blobPath: string): string {
    if (this.#transport.blobText === undefined) fail('blob observation is unavailable.');
    const source = this.#transport.blobText(repository, ref, blobPath);
    if (typeof source !== 'string' || source.length === 0 || Buffer.byteLength(source, 'utf8') > 131_072) {
      fail('blob observation is invalid.');
    }
    return source;
  }

  observeComparison(repository: string, baseSha: string, headSha: string): GitHubComparisonObservation {
    if (this.#transport.comparison === undefined) fail('comparison observation is unavailable.');
    const comparison = this.#transport.comparison(repository, baseSha, headSha);
    if (!['ahead', 'behind', 'diverged', 'identical'].includes(comparison.status)
      || !Number.isSafeInteger(comparison.behindBy) || comparison.behindBy < 0) fail('comparison observation is invalid.');
    return Object.freeze({ ...comparison });
  }

  observeOpenPullRequestCountForHead(repository: string, headSha: string): number {
    if (this.#transport.openPullRequestCountForHead === undefined) fail('same-head PR observation is unavailable.');
    const count = this.#transport.openPullRequestCountForHead(repository, headSha);
    if (!Number.isSafeInteger(count) || count < 0) fail('same-head PR observation is invalid.');
    return count;
  }

  observePrincipal(repository: string, login: string): GitHubPrincipalObservation {
    if (this.#transport.principal === undefined) fail('principal observation is unavailable.');
    const principal = this.#transport.principal(repository, login);
    if (principal.login !== login || typeof principal.nodeId !== 'string' || principal.nodeId.length === 0
      || !['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(principal.permission)) {
      fail('principal observation is invalid.');
    }
    return Object.freeze({ ...principal });
  }

  observePrincipalByNodeId(repository: string, nodeId: string): GitHubPrincipalObservation {
    if (this.#transport.principalByNodeId === undefined) fail('principal node observation is unavailable.');
    const principal = this.#transport.principalByNodeId(repository, nodeId);
    if (principal.nodeId !== nodeId || typeof principal.login !== 'string' || principal.login.length === 0) {
      fail('principal node observation is invalid.');
    }
    return Object.freeze({ ...principal });
  }

  observeViewerPrincipal(repository: string): GitHubPrincipalObservation {
    if (this.#transport.viewerPrincipal === undefined) fail('viewer principal observation is unavailable.');
    const principal = this.#transport.viewerPrincipal(repository);
    if (typeof principal.nodeId !== 'string' || principal.nodeId.length === 0
      || typeof principal.login !== 'string' || principal.login.length === 0) fail('viewer principal observation is invalid.');
    return Object.freeze({ ...principal });
  }

  observeActionsArtifact(repository: string, artifactId: string): GitHubActionsArtifactObservation {
    if (this.#transport.actionsArtifact === undefined) fail('Actions artifact observation is unavailable.');
    const artifact = this.#transport.actionsArtifact(repository, artifactId);
    if (artifact.artifactId !== artifactId || artifact.artifactName.length === 0
      || !/^[0-9a-f]{40}$/u.test(artifact.workflowSha) || artifact.runId.length === 0
      || !Number.isSafeInteger(artifact.runAttempt) || artifact.runAttempt < 1 || artifact.actorNodeId.length === 0
      || artifact.expired) {
      fail('Actions artifact observation is invalid.');
    }
    return Object.freeze({ ...artifact });
  }

  observeActionsArtifactsForRun(repository: string, runId: string): readonly GitHubActionsArtifactObservation[] {
    if (this.#transport.actionsArtifactsForRun === undefined) fail('Actions run artifact observation is unavailable.');
    const artifacts = this.#transport.actionsArtifactsForRun(repository, runId).filter((entry) => !entry.expired);
    for (const artifact of artifacts) {
      if (artifact.artifactName.length === 0 || !/^[0-9a-f]{40}$/u.test(artifact.workflowSha)
        || artifact.runId !== runId || !Number.isSafeInteger(artifact.runAttempt)
        || artifact.runAttempt < 1 || artifact.actorNodeId.length === 0) {
        fail('Actions run artifact inventory is invalid.');
      }
    }
    return Object.freeze([...artifacts]);
  }

  observeActionsArtifacts(repository: string): readonly GitHubActionsArtifactObservation[] {
    if (this.#transport.actionsArtifacts === undefined) fail('repository Actions artifact observation is unavailable.');
    const artifacts = this.#transport.actionsArtifacts(repository).filter((entry) => !entry.expired);
    for (const artifact of artifacts) {
      if (artifact.artifactName.length === 0 || !/^[0-9a-f]{40}$/u.test(artifact.workflowSha)
        || artifact.runId.length === 0 || !Number.isSafeInteger(artifact.runAttempt)
        || artifact.runAttempt < 1 || artifact.actorNodeId.length === 0) {
        fail('repository Actions artifact inventory is invalid.');
      }
    }
    return Object.freeze([...artifacts]);
  }

  downloadArtifactText(repository: string, artifact: GitHubActionsArtifactObservation, fileName: string): string {
    if (this.#transport.downloadArtifactText === undefined) fail('Actions artifact download is unavailable.');
    const source = this.#transport.downloadArtifactText(repository, artifact, fileName);
    if (source.length === 0 || Buffer.byteLength(source, 'utf8') > 10 * 1024 * 1024) fail('Actions artifact file is empty or oversized.');
    return source;
  }

  observePlatformEnforcement(repository: string): PlatformEnforcementObservation {
    try {
      const rulesets = this.#transport.repositoryRulesets(repository);
      return Object.freeze({ status: 'available', rulesetDigest: hash(rulesets), reason: null });
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : null;
      const message = error instanceof Error ? error.message : String(error);
      if (statusCode === 403) {
        return Object.freeze({
          status: 'platform-enforcement-unavailable',
          rulesetDigest: hash({ status: 'platform-enforcement-unavailable', statusCode: 403 }),
          reason: 'GitHub ruleset/branch-protection readback unavailable for this repository plan'
        });
      }
      return Object.freeze({ status: 'unknown', rulesetDigest: hash({ status: 'unknown', message }), reason: message });
    }
  }

  ensureVerificationSessionWakeup(repository: string, request: VerificationSessionHostedRequest): void {
    this.#transport.dispatchVerificationSession(repository, request);
  }

}

export type VerificationSessionGitHubClient = Readonly<Pick<
  VerificationSessionGitHubAdapter,
  | 'observeCandidate'
  | 'observePullRequestClosingFacts'
  | 'observeReviewBarrier'
  | 'observeChecks'
  | 'observeWorkflowRuns'
  | 'observeWorkflowJobsForAttempt'
  | 'observeVerificationSessionWorkflowJoin'
  | 'observeChangedPaths'
  | 'readBlobText'
  | 'observeComparison'
  | 'observeOpenPullRequestCountForHead'
  | 'observePrincipal'
  | 'observePrincipalByNodeId'
  | 'observeViewerPrincipal'
  | 'observeActionsArtifact'
  | 'observeActionsArtifactsForRun'
  | 'observeActionsArtifacts'
  | 'downloadArtifactText'
  | 'observePlatformEnforcement'
  | 'ensureVerificationSessionWakeup'
>>;

export function createVerificationSessionGitHubClient(
  repositoryRoot = process.cwd()
): VerificationSessionGitHubClient {
  const adapter = new VerificationSessionGitHubAdapter(
    new GhVerificationSessionTransport(repositoryRoot)
  );
  authorityBearingGitHubAdapters.add(adapter);
  return Object.freeze(adapter);
}

/** Immutable, observation-only transaction seam for deterministic Review evaluation. */
export interface VerificationSessionReviewObservationTransaction {
  candidate(repository: string, prNumber: number): GitHubCandidateObservation;
  reviewPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewObservation>;
  threadPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewThreadObservation>;
  reviewRequestPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewRequestObservation>;
  issueCommentPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubIssueCommentObservation>;
  resolveCommitOid(repository: string, locator: string): GitHubCommitResolutionObservation;
  collaboratorPermission(repository: string, login: string): 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
}

export function evaluateVerificationSessionReviewObservation(
  transaction: VerificationSessionReviewObservationTransaction,
  input: Parameters<VerificationSessionGitHubAdapter['observeReviewBarrier']>[0]
): GitHubReviewBarrierObservation {
  return new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeReviewBarrier(input);
}

export interface VerificationSessionWorkflowObservationTransaction {
  workflowRunPage(
    repository: string,
    headSha: string,
    after: string | null
  ): GitHubPage<GitHubWorkflowRunObservation>;
}

export function evaluateVerificationSessionWorkflowJoin(
  transaction: VerificationSessionWorkflowObservationTransaction,
  input: Parameters<VerificationSessionGitHubAdapter['observeVerificationSessionWorkflowJoin']>[0]
): VerificationSessionWorkflowJoin {
  return new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeVerificationSessionWorkflowJoin(input);
}

export function evaluatePlatformEnforcementObservation(input: {
  repository: string;
  readRulesets(): unknown;
}): PlatformEnforcementObservation {
  return new VerificationSessionGitHubAdapter({
    repositoryRulesets: () => input.readRulesets()
  } as unknown as VerificationSessionGitHubTransport).observePlatformEnforcement(input.repository);
}

export function evaluateVerificationSessionChangedPaths(
  transaction: Readonly<{
    pullRequestFileInventory(
      repository: string,
      prNumber: number
    ): GitHubPullRequestFileInventory;
  }>,
  expected: GitHubPullRequestFileInventoryExpectation
): GitHubPullRequestFileInventory {
  return new VerificationSessionGitHubAdapter(
    transaction as unknown as VerificationSessionGitHubTransport
  ).observeChangedPaths(expected);
}

/**
 * Pure parser for one provider-paginated workflow-attempt job inventory. The
 * production transport owns command execution; tests can validate provider
 * shape and fail-closed pagination without receiving a command runner port.
 */
export function parseGitHubWorkflowJobsForAttempt(input: {
  source: unknown;
  runId: string;
  runAttempt: number;
}): readonly GitHubWorkflowJobObservation[] {
  const { source: pages, runId, runAttempt } = input;
  if (!/^[1-9][0-9]*$/u.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1
    || runAttempt > 1000) {
    fail('workflow attempt identity is invalid.');
  }
  if (!Array.isArray(pages) || !pages.every((page) => page !== null && typeof page === 'object'
    && !Array.isArray(page) && Array.isArray((page as any).jobs))) {
    fail('workflow attempt job pagination must be a complete page-object array.');
  }
  const jobs = (pages as Array<Record<string, any>>).flatMap((page) => page.jobs).map((job: any) => {
    if (!Number.isSafeInteger(job.id) || !Number.isSafeInteger(job.run_id)
      || job.run_attempt !== runAttempt || typeof job.name !== 'string'
      || !['queued', 'in_progress', 'completed'].includes(job.status)
      || (job.conclusion !== null && typeof job.conclusion !== 'string')
      || typeof job.head_sha !== 'string' || !Array.isArray(job.steps)) {
      fail('workflow attempt job record is malformed.');
    }
    const steps = job.steps.map((step: any) => {
      if (typeof step.name !== 'string' || !Number.isSafeInteger(step.number) || step.number < 1
        || !['queued', 'in_progress', 'completed'].includes(step.status)
        || (step.conclusion !== null && typeof step.conclusion !== 'string')
        || (step.started_at !== null && typeof step.started_at !== 'string')
        || (step.completed_at !== null && typeof step.completed_at !== 'string')) {
        fail('workflow attempt step record is malformed.');
      }
      return Object.freeze({ name: step.name, number: step.number, status: step.status,
        conclusion: step.conclusion, startedAt: step.started_at, completedAt: step.completed_at
      }) as GitHubWorkflowJobStepObservation;
    });
    const numbers = new Set<number>();
    for (const step of steps) {
      if (numbers.has(step.number)) fail('workflow attempt job contains duplicate step numbers.');
      numbers.add(step.number);
    }
    return Object.freeze({ id: String(job.id), runId: String(job.run_id), runAttempt,
      name: job.name, status: job.status, conclusion: job.conclusion, headSha: job.head_sha,
      startedAt: job.started_at ?? null, completedAt: job.completed_at ?? null,
      steps: Object.freeze(steps) }) as GitHubWorkflowJobObservation;
  });
  const ids = new Set<string>();
  for (const job of jobs) {
    if (job.runId !== runId || ids.has(job.id)) {
      fail('workflow attempt job inventory has a run identity mismatch or duplicate job id.');
    }
    ids.add(job.id);
  }
  return Object.freeze(jobs);
}

function parseJson<T>(source: string, label: string): T {
  try { return JSON.parse(source) as T; } catch (error) {
    throw new GitHubProviderResponseShapeError(`${label} returned invalid JSON.`, 'github-provider-invalid-json', source);
  }
}

type GitHubProviderPageInfo = Readonly<{
  hasNextPage: boolean;
  endCursor: string | null;
}>;

function providerPageInfo(value: unknown, label: string): GitHubProviderPageInfo {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as any).hasNextPage !== 'boolean'
    || ((value as any).endCursor !== null && typeof (value as any).endCursor !== 'string')) {
    fail(`${label} pageInfo is invalid.`);
  }
  const pageInfo = value as GitHubProviderPageInfo;
  if (pageInfo.hasNextPage && (pageInfo.endCursor === null || pageInfo.endCursor.length === 0)) {
    fail(`${label} pagination did not expose a next cursor.`);
  }
  return pageInfo;
}

export function parseGitHubReviewPages(input: {
  source: unknown;
  resolveApp(appSlug: string): unknown;
}): Readonly<{ nodes: readonly GitHubReviewObservation[]; pageDigest: SessionDigest }> {
  if (!Array.isArray(input.source) || input.source.length === 0) {
    fail('review pagination must be a non-empty page array.');
  }
  const pages = input.source as any[];
  const rawNodes: any[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const connection = page?.data?.repository?.pullRequest?.reviews;
    if (connection === null || typeof connection !== 'object' || Array.isArray(connection)
      || !Array.isArray(connection.nodes)) {
      fail(`review pagination page[${pageIndex}] is invalid.`);
    }
    const pageInfo = providerPageInfo(connection.pageInfo, `review pagination page[${pageIndex}]`);
    if (pageInfo.hasNextPage !== (pageIndex < pages.length - 1)) {
      fail('review pagination is incomplete or contains pages beyond its terminal page.');
    }
    rawNodes.push(...connection.nodes);
  }

  const appResolutions = new Map<string, Readonly<{ app: {
    id: number; nodeId: string; slug: string
  }; rawResponse: unknown; responseDigest: SessionDigest }>>();
  const nodes = rawNodes.map((node, index) => {
    const author = node?.author;
    if (node === null || typeof node !== 'object' || Array.isArray(node)
      || author === null || typeof author !== 'object' || Array.isArray(author)
      || (author.__typename !== 'Bot' && author.__typename !== 'User')
      || typeof author.id !== 'string' || typeof author.login !== 'string'
      || typeof author.resourcePath !== 'string') {
      fail(`reviews[${index}] GraphQL actor identity is invalid.`);
    }
    const actorApps = author.__typename === 'Bot'
      ? REVIEW_STABILITY_POLICY.trustedApps.filter((app) => app.actorNodeId === author.id)
      : [];
    let trustedApp: { id: number; nodeId: string; slug: string } | null = null;
    if (actorApps.length > 0) {
      const pathMatches = actorApps.filter((app) => author.resourcePath === `/apps/${app.appSlug}`);
      if (pathMatches.length !== 1) {
        fail(`reviews[${index}] trusted GraphQL App actor path is ambiguous or drifted.`);
      }
      const policyApp = pathMatches[0]!;
      const resolutionKey = [policyApp.actorNodeId, policyApp.appId, policyApp.appNodeId,
        policyApp.appSlug].join('\0');
      let resolution = appResolutions.get(resolutionKey);
      if (resolution === undefined) {
        const rawResponse = input.resolveApp(policyApp.appSlug);
        if (rawResponse === null || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
          fail(`reviews[${index}] trusted GraphQL App resolver response is invalid.`);
        }
        const record = rawResponse as Record<string, unknown>;
        if (record.id !== policyApp.appId || record.node_id !== policyApp.appNodeId
          || record.slug !== policyApp.appSlug) {
          fail(`reviews[${index}] trusted GraphQL App resolver identity drifted from policy.`);
        }
        resolution = Object.freeze({
          app: Object.freeze({ id: policyApp.appId, nodeId: policyApp.appNodeId,
            slug: policyApp.appSlug }),
          rawResponse,
          responseDigest: hash(rawResponse)
        });
        appResolutions.set(resolutionKey, resolution);
      }
      trustedApp = resolution.app;
    }
    return Object.freeze({
      id: node.id,
      authorNodeId: author.id,
      authorLogin: author.login,
      authorType: author.__typename,
      appId: trustedApp?.id ?? null,
      appNodeId: trustedApp?.nodeId ?? null,
      appSlug: trustedApp?.slug ?? null,
      commitSha: node.commit?.oid,
      state: node.state,
      submittedAt: node.submittedAt
    }) as GitHubReviewObservation;
  });
  return Object.freeze({
    nodes: Object.freeze(nodes),
    pageDigest: hash(Object.freeze({
      schema: 'sec-github-review-provider-pages-v1',
      pages,
      appResolutions: Object.freeze([...appResolutions.values()])
    }))
  });
}

function providerCommentAuthors(value: unknown, label: string): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray((value as any).nodes)) {
    fail(`${label} comment connection is invalid.`);
  }
  return (value as any).nodes.flatMap((comment: any, index: number) => {
    if (comment === null || typeof comment !== 'object' || Array.isArray(comment)) {
      fail(`${label}.nodes[${index}] is invalid.`);
    }
    const author = comment.author;
    if (author === null || author === undefined) return [];
    if (typeof author !== 'object' || Array.isArray(author) || typeof author.id !== 'string'
      || author.id.length === 0) {
      fail(`${label}.nodes[${index}].author is invalid.`);
    }
    return [author.id];
  });
}

export function parseGitHubReviewThreadPages(input: {
  source: unknown;
  readCommentPage(threadId: string, after: string): unknown;
}): Readonly<{ nodes: readonly GitHubReviewThreadObservation[]; pageDigest: SessionDigest }> {
  if (!Array.isArray(input.source) || input.source.length === 0) {
    fail('thread pagination must be a non-empty page array.');
  }
  const outerPages = input.source as any[];
  let previousOuterCursor: string | null = null;
  const rawNodes: any[] = [];
  for (const [pageIndex, page] of outerPages.entries()) {
    const connection = page?.data?.repository?.pullRequest?.reviewThreads;
    if (connection === null || typeof connection !== 'object' || Array.isArray(connection)
      || !Array.isArray(connection.nodes)) {
      fail(`thread pagination page[${pageIndex}] is invalid.`);
    }
    const pageInfo = providerPageInfo(connection.pageInfo, `thread pagination page[${pageIndex}]`);
    const isLast = pageIndex === outerPages.length - 1;
    if (pageInfo.hasNextPage !== !isLast) {
      fail('thread pagination is incomplete or contains pages beyond its terminal page.');
    }
    if (pageInfo.hasNextPage) {
      if (pageInfo.endCursor === previousOuterCursor) fail('thread pagination did not advance.');
      previousOuterCursor = pageInfo.endCursor;
    }
    rawNodes.push(...connection.nodes);
  }

  const additionalCommentPages: unknown[] = [];
  const nodes = rawNodes.map((node, threadIndex) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)
      || typeof node.id !== 'string' || node.id.length === 0) {
      fail(`reviewThreads[${threadIndex}] provider identity is invalid.`);
    }
    const authorNodeIds = providerCommentAuthors(
      node.comments,
      `reviewThreads[${threadIndex}].comments`
    );
    let pageInfo = providerPageInfo(
      node.comments?.pageInfo,
      `reviewThreads[${threadIndex}].comments`
    );
    let cursor = pageInfo.endCursor;
    for (let pageNumber = 0; pageInfo.hasNextPage; pageNumber += 1) {
      if (pageNumber >= 1000 || cursor === null) {
        fail(`reviewThreads[${threadIndex}] comment pagination exceeded its bounded page count.`);
      }
      const response = input.readCommentPage(node.id, cursor);
      additionalCommentPages.push(Object.freeze({ threadId: node.id, after: cursor, response }));
      const connection = (response as any)?.data?.node?.comments;
      if ((response as any)?.data?.node?.id !== node.id || connection === null
        || typeof connection !== 'object' || Array.isArray(connection)) {
        fail(`reviewThreads[${threadIndex}] comment page[${pageNumber}] is invalid.`);
      }
      authorNodeIds.push(...providerCommentAuthors(
        connection,
        `reviewThreads[${threadIndex}].comments.page[${pageNumber}]`
      ));
      pageInfo = providerPageInfo(
        connection.pageInfo,
        `reviewThreads[${threadIndex}].comments.page[${pageNumber}]`
      );
      if (pageInfo.hasNextPage && pageInfo.endCursor === cursor) {
        fail(`reviewThreads[${threadIndex}] comment pagination did not advance.`);
      }
      cursor = pageInfo.endCursor;
    }
    return Object.freeze({
      id: node.id,
      isResolved: node.isResolved,
      isOutdated: node.isOutdated,
      path: node.path,
      authorNodeIds: Object.freeze(authorNodeIds)
    });
  });
  return Object.freeze({
    nodes: Object.freeze(nodes),
    pageDigest: hash(Object.freeze({
      schema: 'sec-github-review-thread-provider-pages-v1',
      outerPages,
      additionalCommentPages: Object.freeze(additionalCommentPages)
    }))
  });
}

function issueCommentObservation(value: any, label: string): GitHubIssueCommentObservation {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.id)
    || typeof value.body !== 'string' || typeof value.created_at !== 'string'
    || !value.user || typeof value.user !== 'object' || typeof value.user.login !== 'string'
    || !Number.isSafeInteger(value.user.id) || typeof value.user.node_id !== 'string'
    || typeof value.user.type !== 'string') fail(`${label} identity is invalid.`);
  const rawApp = value.performed_via_github_app;
  const performedViaGitHubApp = rawApp === null || rawApp === undefined ? null : (() => {
    if (!Number.isSafeInteger(rawApp.id) || typeof rawApp.node_id !== 'string'
      || typeof rawApp.slug !== 'string') fail(`${label} app identity is invalid.`);
    return { id: rawApp.id, nodeId: rawApp.node_id, slug: rawApp.slug };
  })();
  return Object.freeze({ id: String(value.id), body: value.body, authorLogin: value.user.login,
    authorId: value.user.id, authorNodeId: value.user.node_id, authorType: value.user.type,
    performedViaGitHubApp, createdAt: value.created_at });
}

function repoParts(repository: string): { owner: string; name: string } {
  const match = /^([^/]+)\/([^/]+)$/u.exec(repository);
  if (!match) fail('repository must be owner/name.');
  return { owner: match[1]!, name: match[2]! };
}

export function parseGitHubCheckPages(input: Readonly<{
  source: unknown;
  repository: string;
  headSha: string;
  observeWorkflowRun: (runId: string) => unknown;
}>): readonly GitHubCheckObservation[] {
  if (!Array.isArray(input.source) || input.source.length === 0) {
    fail('check pagination returned no complete REST page set.');
  }
  const pages = input.source as Array<Record<string, unknown>>;
  let totalCount: number | null = null;
  const rawNodes: unknown[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    if (page === null || typeof page !== 'object' || Array.isArray(page)
      || !Number.isSafeInteger(page.total_count) || (page.total_count as number) < 0
      || !Array.isArray(page.check_runs) || page.check_runs.length > 100) {
      fail(`check pagination page[${pageIndex}] is malformed.`);
    }
    if (totalCount === null) totalCount = page.total_count as number;
    else if (totalCount !== page.total_count) fail('check pagination total_count changed between pages.');
    rawNodes.push(...page.check_runs);
  }
  if (totalCount === null || rawNodes.length !== totalCount
    || pages.length !== Math.max(1, Math.ceil(totalCount / 100))) {
    fail('check pagination does not match its declared complete census.');
  }
  const identities = new Set<number>();
  return Object.freeze(rawNodes.map((rawNode, index) => {
    if (rawNode === null || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
      fail(`checkRuns[${index}] is not an object.`);
    }
    const node = rawNode as Record<string, any>;
    if (!Number.isSafeInteger(node.id) || node.id < 1 || identities.has(node.id)) {
      fail(`checkRuns[${index}].id is invalid or duplicated.`);
    }
    identities.add(node.id);
    const name = boundedText(node.name, `checkRuns[${index}].name`, 256);
    if (!['queued', 'in_progress', 'completed'].includes(node.status)
      || (node.status === 'completed' ? typeof node.conclusion !== 'string' : node.conclusion !== null)
      || (node.details_url !== null && typeof node.details_url !== 'string')) {
      fail(`checkRuns[${index}] lifecycle or details URL is invalid.`);
    }
    const observedHeadSha = assertSha(node.head_sha, `checkRuns[${index}].headSha`);
    if (observedHeadSha !== input.headSha) fail(`checkRuns[${index}] head filter was not honored.`);
    const rawApp = node.app;
    if (rawApp !== null && rawApp !== undefined
      && (typeof rawApp !== 'object' || Array.isArray(rawApp))) {
      fail(`checkRuns[${index}].app is invalid.`);
    }
    const appId = Number.isSafeInteger(rawApp?.id) && rawApp.id > 0 ? rawApp.id : null;
    const appNodeId = typeof rawApp?.node_id === 'string'
      ? boundedText(rawApp.node_id, `checkRuns[${index}].app.nodeId`, 256)
      : null;
    const appSlug = typeof rawApp?.slug === 'string'
      ? boundedText(rawApp.slug, `checkRuns[${index}].app.slug`, 256)
      : null;
    if ((appId === null) !== (appNodeId === null) || (appId === null) !== (appSlug === null)) {
      fail(`checkRuns[${index}].app identity is partial.`);
    }
    const detailsUrl = node.details_url as string | null;
    const runId = detailsUrl === null
      ? null
      : /\/actions\/runs\/([1-9][0-9]*)/u.exec(detailsUrl)?.[1] ?? null;
    const run = runId === null ? null : input.observeWorkflowRun(runId) as Record<string, any>;
    if (run !== null && (typeof run !== 'object' || Array.isArray(run)
      || !Number.isSafeInteger(run.id) || String(run.id) !== runId
      || typeof run.path !== 'string' || typeof run.event !== 'string'
      || typeof run.display_title !== 'string' || run.head_sha !== observedHeadSha)) {
      fail(`checkRuns[${index}] workflow provenance is invalid.`);
    }
    const workflowPath = run === null
      ? null
      : boundedText(run.path, `checkRuns[${index}].workflowPath`, 512);
    return Object.freeze({ id: node.id, name, status: node.status, conclusion: node.conclusion,
      headSha: observedHeadSha, detailsUrl, appId, appNodeId, appSlug,
      workflowPath, workflowRef: workflowPath === null ? null : `${workflowPath}@${observedHeadSha}`,
      eventName: run === null ? null : boundedText(run.event, `checkRuns[${index}].eventName`, 64),
      workflowRunId: runId,
      workflowRunDisplayTitle: run === null ? null
        : boundedText(run.display_title, `checkRuns[${index}].displayTitle`, 1024) });
  }));
}

function apiFailure(message: string, statusCode?: number): GitHubApiFailure {
  return new GitHubApiFailure(message, statusCode);
}

function runVerificationSessionGh(
  repositoryRoot: string,
  args: readonly string[],
  input?: Buffer
) {
  if (args.some((arg) => arg.includes('\0'))) fail('GitHub observation argument contains NUL.');
  const spawned = spawnSync('gh', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    input,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' }
  });
  return {
    status: spawned.status,
    stdout: Buffer.isBuffer(spawned.stdout)
      ? spawned.stdout
      : Buffer.from(String(spawned.stdout ?? '')),
    stderr: Buffer.isBuffer(spawned.stderr)
      ? spawned.stderr
      : Buffer.from(String(spawned.stderr ?? spawned.error?.message ?? ''))
  };
}

/** Concrete provider transport; construction is module-private. */
class GhVerificationSessionTransport implements VerificationSessionGitHubTransport {
  private readonly repositoryRoot: string;
  constructor(repositoryRoot = process.cwd()) { this.repositoryRoot = repositoryRoot; }

  private gh(args: readonly string[], label: string, input?: Buffer): string {
    const result = runVerificationSessionGh(this.repositoryRoot, args, input);
    if (result.status !== 0) {
      const message = decodeBranchLifecycleChildError(result);
      const schemaFailure = classifyGitHubGraphQLSchemaFailure(message);
      if (schemaFailure !== null) {
        // Raw GitHub schema prose never becomes control-plane text; the typed
        // status carries only a bounded reasonCode and a response digest.
        throw new GitHubProviderSchemaUnsupportedError(schemaFailure);
      }
      const status = /HTTP\s+403|status\s*403|Resource not accessible/iu.test(message) ? 403 : undefined;
      throw apiFailure(`${label}: ${message}`, status);
    }
    return decodeBranchLifecycleChildStdout(result);
  }

  private graphql(query: string, variables: Readonly<Record<string, unknown>>, label: string): string {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [name, value] of Object.entries(variables)) {
      if (value !== null) args.push('-F', `${name}=${String(value)}`);
    }
    return this.gh(args, label);
  }

  pullRequestClosingFacts(
    repository: string,
    prNumber: number
  ): GitHubPullRequestClosingFacts {
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
        source: this.graphql(GITHUB_PULL_REQUEST_CLOSING_QUERY,
          { owner, name, number: prNumber, cursor }, 'PR closing issue page'), repository, prNumber,
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

  candidate(repository: string, prNumber: number): GitHubCandidateObservation {
    const prSource = this.gh(['pr', 'view', String(prNumber), '--repo', repository, '--json',
      'number,state,isDraft,isCrossRepository,author,baseRefName,baseRefOid,headRefName,headRefOid,title,body,mergeCommit'], 'PR readback');
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
      baseTreeSource = this.gh(['api', `/repos/${repository}/git/commits/${prValue.baseRefOid}`, '--jq', '.tree.sha'], 'base tree readback');
      headTreeSource = this.gh(['api', `/repos/${repository}/git/commits/${prValue.headRefOid}`, '--jq', '.tree.sha'], 'head tree readback');
      const mergeCommitSha = prValue.mergeCommit?.oid ?? null;
      if (mergeCommitSha !== null) {
        mergeCommitSource = this.gh(['api', `/repos/${repository}/git/commits/${mergeCommitSha}`], 'merge commit readback');
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

  pullRequestFileInventory(
    repository: string,
    prNumber: number
  ): GitHubPullRequestFileInventory {
    const metadataEndpoint = `/repos/${repository}/pulls/${prNumber}`;
    const beforeSource = this.gh([
      'api', '--method', 'GET', metadataEndpoint
    ], 'changed-path PR before readback');
    const pagesSource = this.gh([
      'api', '--method', 'GET', `/repos/${repository}/pulls/${prNumber}/files`,
      '--paginate', '--slurp', '-f', 'per_page=100'
    ], 'changed-path pagination');
    const afterSource = this.gh([
      'api', '--method', 'GET', metadataEndpoint
    ], 'changed-path PR after readback');
    return parseGitHubPullRequestFileInventory({ repository, prNumber,
      beforeSource, pagesSource, afterSource });
  }

  blobText(repository: string, ref: string, blobPath: string): string {
    const value = parseJson<Record<string, any>>(this.gh([
      'api', '--method', 'GET', `/repos/${repository}/contents/${blobPath}`, '-f', `ref=${ref}`
    ], 'blob readback'), 'blob readback');
    if (value.type !== 'file' || value.encoding !== 'base64' || typeof value.content !== 'string') {
      fail('blob readback did not return one base64 file.');
    }
    return Buffer.from(value.content.replaceAll('\n', ''), 'base64').toString('utf8');
  }

  comparison(repository: string, baseSha: string, headSha: string): GitHubComparisonObservation {
    const value = parseJson<Record<string, any>>(this.gh([
      'api', `/repos/${repository}/compare/${baseSha}...${headSha}`
    ], 'comparison readback'), 'comparison readback');
    return { status: value.status, behindBy: value.behind_by };
  }

  openPullRequestCountForHead(repository: string, headSha: string): number {
    repoParts(repository);
    assertSha(headSha, 'same-head PR census SHA');
    const readPage = (page: number, label: string) => {
      const source = this.gh([
        'api', '--method', 'GET', `/repos/${repository}/pulls`,
        '-f', 'state=open', '-f', 'sort=created', '-f', 'direction=asc',
        '-f', `per_page=${GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE}`, '-f', `page=${page}`
      ], label);
      return Object.freeze({
        source,
        page: githubOpenPullRequestPage(parseJson<unknown>(source, label), label)
      });
    };
    const readCensus = (label: string): string => {
      const pages: unknown[][] = [];
      let complete = false;
      for (let page = 1; page <= GITHUB_OPEN_PULL_REQUEST_MAXIMUM_PAGES; page += 1) {
        const observed = readPage(page, `${label} page ${page}`);
        pages.push([...observed.page]);
        if (observed.page.length < GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE) {
          complete = true;
          break;
        }
      }
      if (!complete) fail(`${label} exceeded the bounded page count.`);
      return JSON.stringify(pages);
    };
    const firstPagesSource = readCensus('same-head PR first exhaustive census');
    const secondPagesSource = readCensus('same-head PR second exhaustive census');
    return parseGitHubOpenPullRequestCensus({ repository, headSha,
      firstPagesSource, secondPagesSource });
  }

  principal(repository: string, login: string): GitHubPrincipalObservation {
    const user = parseJson<Record<string, any>>(this.gh(['api', `/users/${login}`], 'principal readback'), 'principal readback');
    return { login, nodeId: String(user.node_id ?? ''), permission: this.collaboratorPermission(repository, login) };
  }


  principalByNodeId(repository: string, nodeId: string): GitHubPrincipalObservation {
    const value = parseJson<Record<string, any>>(this.gh([
      'api', 'graphql', '-f', 'query=query($id:ID!){node(id:$id){... on User{id login}}}', '-F', `id=${nodeId}`
    ], 'principal node readback'), 'principal node readback');
    const user = value.data?.node;
    if (user?.id !== nodeId || typeof user.login !== 'string') fail('principal node did not resolve to one User.');
    return { login: user.login, nodeId, permission: this.collaboratorPermission(repository, user.login) };
  }


  viewerPrincipal(repository: string): GitHubPrincipalObservation {
    const user = parseJson<Record<string, any>>(this.gh(['api', 'user'], 'viewer principal readback'), 'viewer principal readback');
    if (typeof user.login !== 'string' || typeof user.node_id !== 'string') fail('viewer principal identity is unavailable.');
    return { login: user.login, nodeId: user.node_id, permission: this.collaboratorPermission(repository, user.login) };
  }


  actionsArtifact(repository: string, artifactId: string): GitHubActionsArtifactObservation {
    const artifact = parseJson<Record<string, any>>(this.gh([
      'api', `/repos/${repository}/actions/artifacts/${artifactId}`
    ], 'Actions artifact metadata'), 'Actions artifact metadata');
    const runId = artifact.workflow_run?.id;
    if (!Number.isSafeInteger(runId)) fail('Actions artifact has no workflow run identity.');
    const run = parseJson<Record<string, any>>(this.gh([
      'api', `/repos/${repository}/actions/runs/${runId}`
    ], 'Actions run metadata'), 'Actions run metadata');
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
      actorPermission: this.collaboratorPermission(repository, actor.login), archiveDigest,
      expired: artifact.expired === true };
  }


  actionsArtifactsForRun(repository: string, runId: string): readonly GitHubActionsArtifactObservation[] {
    const pages = parseJson<any[]>(this.gh([
      'api', `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`, '--paginate', '--slurp'
    ], 'Actions run artifact inventory'), 'Actions run artifact inventory');
    return pages.flatMap((page) => page.artifacts ?? []).filter((artifact: any) => artifact.expired !== true)
      .map((artifact: any) => this.actionsArtifact(repository, String(artifact.id)));
  }


  actionsArtifacts(repository: string): readonly GitHubActionsArtifactObservation[] {
    const source = this.gh([
      'api', `/repos/${repository}/actions/artifacts?per_page=100`, '--paginate', '--slurp'
    ], 'repository Actions artifact inventory');
    return evaluateGitHubRepositoryActionsArtifactInventory({ repository, source,
      observeArtifact: (summary) => this.actionsArtifact(repository, summary.artifactId) }).artifacts;
  }

  downloadArtifactText(repository: string, artifact: GitHubActionsArtifactObservation, fileName: string): string {
    if (!/^[A-Za-z0-9._-]+$/u.test(fileName)) fail('artifact file name is invalid.');
    const directory = mkdtempSync(path.join(tmpdir(), 'sec-verification-artifact-'));
    try {
      this.gh(['run', 'download', artifact.runId, '--repo', repository, '--name', artifact.artifactName,
        '--dir', directory], 'Actions artifact download');
      return readFileSync(path.join(directory, fileName), 'utf8');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  private graphPages(query: string, repository: string, prNumber: number, label: string): any[] {
    const { owner, name } = repoParts(repository);
    const source = this.gh([
      'api', 'graphql', '--paginate', '--slurp', '-f', `query=${query}`,
      '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${prNumber}`
    ], label);
    try {
      const pages = parseJson<unknown>(source, label);
      if (!Array.isArray(pages)) {
        throw new GitHubProviderResponseShapeError(`${label} returned a non-array GraphQL page set.`,
          'github-graphql-page-set-not-array', Object.freeze({ label, source, parsedValue: pages }));
      }
      return bindProviderShapeSource(pages, Object.freeze({ label, source, parsedValue: pages }));
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-graphql-page-set', Object.freeze({ label, source }));
    }
  }

  private reviewThreadCommentPage(threadId: string, after: string): Readonly<{ value: unknown; source: unknown }> {
    const query = 'query($threadId:ID!,$endCursor:String!){node(id:$threadId){... on PullRequestReviewThread{id comments(first:100,after:$endCursor){nodes{author{__typename ... on Node{id}}}pageInfo{hasNextPage endCursor}}}}}';
    const source = this.gh([
      'api', 'graphql', '-f', `query=${query}`, '-F', `threadId=${threadId}`, '-F', `endCursor=${after}`
    ], 'review thread comment pagination');
    try {
      const value = parseJson<unknown>(source, 'review thread comment pagination');
      return Object.freeze({ value, source: Object.freeze({ threadId, after, source, parsedValue: value }) });
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-graphql-review-thread-comment-page',
        Object.freeze({ threadId, after, source }));
    }
  }

  reviewPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewObservation> {
    if (after !== null) fail('default GraphQL transport returns all review pages in one page.');
    const query = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(first:100,after:$endCursor){nodes{id state submittedAt commit{oid} author{__typename login resourcePath ... on Node{id}} authorAssociation}pageInfo{hasNextPage endCursor}}}}}';
    const pages = this.graphPages(query, repository, prNumber, 'review pagination');
    const resolverSources: unknown[] = [];
    let parsed: ReturnType<typeof parseGitHubReviewPages>;
    try {
      assertSuccessfulGraphqlReviewConnection(pages, 'reviews');
      parsed = parseGitHubReviewPages({ source: pages, resolveApp: (appSlug) => {
        const source = this.gh(['api', `/apps/${appSlug}`], 'trusted Review App resolution');
        try {
          const parsedValue = parseJson<unknown>(source, 'trusted Review App resolution');
          const resolverSource = Object.freeze({ appSlug, source, parsedValue });
          resolverSources.push(resolverSource);
          return parsedValue;
        } catch (error) {
          return rethrowProviderResponseShape(error, 'github-rest-trusted-app-resolver',
            Object.freeze({ appSlug, source }));
        }
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

  threadPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewThreadObservation> {
    if (after !== null) fail('default GraphQL transport returns all thread pages in one page.');
    const query = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{id isResolved isOutdated path comments(first:100){nodes{author{__typename ... on Node{id}}}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}}}';
    const pages = this.graphPages(query, repository, prNumber, 'thread pagination');
    const nestedThreadCommentResponses: unknown[] = [];
    let parsed: ReturnType<typeof parseGitHubReviewThreadPages>;
    try {
      assertSuccessfulGraphqlReviewConnection(pages, 'reviewThreads');
      parsed = parseGitHubReviewThreadPages({
        source: pages,
        readCommentPage: (threadId, cursor) => {
          try {
            const response = this.reviewThreadCommentPage(threadId, cursor);
            nestedThreadCommentResponses.push(response.source);
            return response.value;
          } catch (error) {
            if (error instanceof GitHubProviderResponseShapeError) {
              nestedThreadCommentResponses.push(Object.freeze({ threadId, cursor, source: error.source }));
            }
            throw error;
          }
        }
      });
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-graphql-review-thread-pages',
        Object.freeze({ field: 'reviewThreads', pages: providerShapeSource(pages),
          nestedThreadCommentResponses: Object.freeze(nestedThreadCommentResponses) }));
    }
    return bindProviderShapeSource(Object.freeze({ nodes: parsed.nodes, hasNextPage: false,
      endCursor: null, pageDigest: parsed.pageDigest }), Object.freeze({ field: 'reviewThreads',
      pages: providerShapeSource(pages), nestedThreadCommentResponses: Object.freeze(nestedThreadCommentResponses) }));
  }

  reviewRequestPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubReviewRequestObservation> {
    if (after !== null) fail('default GraphQL transport returns all request pages in one page.');
    const query = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewRequests(first:100,after:$endCursor){nodes{requestedReviewer{... on User{id login}... on Team{id name}}}pageInfo{hasNextPage endCursor}}}}}';
    const pages = this.graphPages(query, repository, prNumber, 'review request pagination');
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


  issueCommentPage(repository: string, prNumber: number, after: string | null): GitHubPage<GitHubIssueCommentObservation> {
    if (after !== null) fail('default REST transport returns the complete issue-comment page set once.');
    const source = this.gh(['api',
      `/repos/${repository}/issues/${prNumber}/comments?per_page=100`, '--paginate', '--slurp'],
    'issue comment pagination');
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

  resolveCommitOid(repository: string, locator: string): GitHubCommitResolutionObservation {
    if (!/^(?:[0-9a-f]{10}|[0-9a-f]{40})$/u.test(locator)) {
      fail('reviewed commit locator must be exactly 10 or 40 lowercase hexadecimal characters.');
    }
    const result = runVerificationSessionGh(
      this.repositoryRoot,
      ['api', `/repos/${repository}/commits/${locator}`]
    );
    if (result.status !== 0) {
      const message = decodeBranchLifecycleChildError(result);
      const responseDigest = hash({ repository, locator, error: message });
      if (/HTTP\s+404|status\s*404|not found/iu.test(message)) {
        return Object.freeze({ repository, locator, status: 'missing', commitSha: null,
          treeSha: null, responseDigest });
      }
      if (/HTTP\s+(?:409|422)|status\s*(?:409|422)|ambiguous/iu.test(message)) {
        return Object.freeze({ repository, locator, status: 'ambiguous', commitSha: null,
          treeSha: null, responseDigest });
      }
      throw apiFailure(`reviewed commit resolution: ${message}`);
    }
    const source = decodeBranchLifecycleChildStdout(result);
    const value = parseJson<Record<string, any>>(source, 'reviewed commit resolution');
    const commitSha = assertSha(value.sha, 'resolved commitSha');
    const treeSha = assertSha(value.commit?.tree?.sha, 'resolved treeSha');
    if (!commitSha.startsWith(locator)) fail('resolved commit does not match the requested locator.');
    return Object.freeze({ repository, locator, status: 'resolved', commitSha, treeSha,
      responseDigest: hash(value) });
  }

  collaboratorPermission(repository: string, login: string): 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none' {
    const source = this.gh(['api', `/repos/${repository}/collaborators/${login}/permission`, '--jq', '.permission'], 'permission readback');
    const permission = source.trim();
    if (!['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(permission)) {
      throw new GitHubProviderResponseShapeError('VerificationSession GitHub adapter permission value is unknown.',
        'github-rest-collaborator-permission', Object.freeze({ repository, login, source }));
    }
    return permission as ReturnType<VerificationSessionGitHubTransport['collaboratorPermission']>;
  }

  checkPage(repository: string, headSha: string, after: string | null): GitHubPage<GitHubCheckObservation> {
    if (after !== null) fail('default REST transport returns all check pages in one page.');
    const source = this.gh(['api', `/repos/${repository}/commits/${headSha}/check-runs?per_page=100`,
      '--paginate', '--slurp'], 'check pagination');
    try {
      const parsed = parseJson<unknown>(source, 'check pagination');
      const nodes = parseGitHubCheckPages({
        source: parsed,
        repository,
        headSha,
        observeWorkflowRun: (runId) => parseJson<unknown>(this.gh([
          'api', `/repos/${repository}/actions/runs/${runId}`
        ], 'check workflow provenance'), 'check workflow provenance')
      });
      return Object.freeze({ nodes, hasNextPage: false, endCursor: null,
        pageDigest: hash(parsed) });
    } catch (error) {
      return rethrowProviderResponseShape(error, 'github-rest-check-pages',
        Object.freeze({ repository, headSha, source }));
    }
  }

  workflowRunPage(repository: string, headSha: string, after: string | null): GitHubPage<GitHubWorkflowRunObservation> {
    if (after !== null) fail('default REST transport returns all workflow pages in one page.');
    const pages = parseJson<any[]>(this.gh(['api', `/repos/${repository}/actions/runs?head_sha=${headSha}&per_page=100`, '--paginate', '--slurp'], 'workflow pagination'), 'workflow pagination');
    const nodes = pages.flatMap((page) => page.workflow_runs ?? []).map((node: any) => ({
      id: String(node.id), name: node.name, displayTitle: node.display_title, workflowPath: node.path,
      event: node.event, status: node.status, conclusion: node.conclusion, headSha: node.head_sha,
      runAttempt: node.run_attempt, updatedAt: node.updated_at
    }));
    return { nodes, hasNextPage: false, endCursor: null, pageDigest: hash(pages) };
  }

  workflowJobsForAttempt(
    repository: string,
    runId: string,
    runAttempt: number
  ): readonly GitHubWorkflowJobObservation[] {
    const pages = parseJson<unknown>(this.gh(['api',
      `/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`,
      '--paginate', '--slurp'], 'workflow attempt job pagination'), 'workflow attempt job pagination');
    return parseGitHubWorkflowJobsForAttempt({ source: pages, runId, runAttempt });
  }

  repositoryRulesets(repository: string): unknown {
    return parseJson(this.gh(['api', `/repos/${repository}/rulesets?per_page=100`, '--paginate', '--slurp'], 'ruleset readback'), 'ruleset readback');
  }

  dispatchVerificationSession(repository: string, request: VerificationSessionHostedRequest): void {
    const body = Buffer.from(`${encodeVerificationActionData({
      event_type: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
      client_payload: { payload: request }
    })}\n`, 'utf8');
    this.gh([
      'api', '--method', 'POST', `/repos/${repository}/dispatches`, '--input', '-'
    ], 'hosted VerificationSession dispatch', body);
  }

}
