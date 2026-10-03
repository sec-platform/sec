/**
 * Pure GitHub wire-response decoding and source provenance for VerificationSession.
 * Complete census/identity checks and exact raw-source digests live together so
 * schema drift remains invalid evidence rather than transport unavailability.
 * This module never acquires GitHub capabilities, performs API requests, or
 * creates the live Review authority retained by verification-session-github.ts.
 */

import { createHash } from 'node:crypto';
import type { GitHubCheckObservation, GitHubWorkflowJobObservation, GitHubWorkflowJobStepObservation } from '../../../../providers/github-api/contract.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { SEC_REVIEW_STABILITY_POLICY } from '../../review/contract/stability.ts';


export type SessionDigest = `sha256:${string}`;

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

const ABSENT_PROVIDER_RESPONSE_SOURCE = Object.freeze({ present: false as const });

function providerResponseShapeSource(source: unknown): unknown {
  return source === undefined ? ABSENT_PROVIDER_RESPONSE_SOURCE : source;
}

export class GitHubProviderResponseShapeError extends Error {
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

export function bindProviderShapeSource<T extends object>(value: T, source: unknown): T {
  providerShapeSources.set(value, source);
  return value;
}

export function providerShapeSource(value: object): unknown {
  return providerShapeSources.get(value) ?? value;
}

export function assertSuccessfulGraphqlReviewConnection(
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

export function hash(value: unknown): SessionDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

export function fail(message: string): never {
  throw new GitHubProviderResponseShapeError(`VerificationSession GitHub adapter ${message}`,
    'github-adapter-shape', undefined);
}

export function rethrowProviderResponseShape(error: unknown, classification: string, source: unknown): never {
  if (error instanceof GitHubProviderResponseShapeError) {
    throw error.bindProviderResponse(classification, Object.freeze({
      boundarySource: providerResponseShapeSource(source),
      causeClassification: error.classification,
      causeSource: error.source
    }));
  }
  throw error;
}

export function providerResponseShapeDigest(error: GitHubProviderResponseShapeError): SessionDigest {
  return hash(Object.freeze({
    schema: 'sec-provider-response-shape-v2', classification: error.classification, source: error.source
  }));
}

export function assertSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) fail(`${label} must be a SHA.`);
  return value;
}

export function canonicalChangedPaths(paths: readonly unknown[]): readonly string[] {
  const result = [...paths].sort();
  if (result.length === 0 || new Set(result).size !== result.length || result.some((entry) => (
    typeof entry !== 'string' || entry.length === 0 || entry.includes('\\') || entry.startsWith('/')
      || entry.split('/').some((segment) => segment === '..')
  ))) fail('changed-path observation is invalid.');
  return Object.freeze(result as string[]);
}

export const GITHUB_OPEN_PULL_REQUEST_PAGE_SIZE = 100;
export const GITHUB_OPEN_PULL_REQUEST_MAXIMUM_PAGES = 1000;

export function githubOpenPullRequestPage(value: unknown, label: string): readonly unknown[] {
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

export function boundedText(value: unknown, label: string, maximum = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    fail(`${label} must be bounded text.`);
  }
  return value;
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

export function parseJson<T>(source: string, label: string): T {
  try { return JSON.parse(source) as T; } catch (error) {
    throw new GitHubProviderResponseShapeError(`${label} returned invalid JSON.`, 'github-provider-invalid-json', source);
  }
}

type GitHubProviderPageInfo = Readonly<{
  hasNextPage: boolean;
  endCursor: string | null;
}>;

export function providerPageInfo(value: unknown, label: string): GitHubProviderPageInfo {
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
      ? SEC_REVIEW_STABILITY_POLICY.trustedApps.filter((app) => app.actorNodeId === author.id)
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

export function issueCommentObservation(value: any, label: string): GitHubIssueCommentObservation {
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

export function repoParts(repository: string): { owner: string; name: string } {
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
