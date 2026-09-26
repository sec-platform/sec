import path from 'node:path';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import type { GitHubCheckObservation } from '../../../providers/github-api/contract.ts';
import {
  assertGitHubApiReadOperationBudgetCurrent,
  currentGitHubApiCapability,
  executeGitHubApiOperation,
  GitHubApiProviderError as MainHealthGitHubProviderError,
  withGitHubApiReadOperationBudget,
  withGitHubApiReadSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import {
  createMainHealthLedger,
  resolveOrdinaryMainHealthLane,
  type MainHealthDigest,
  type MainHealthLedger,
  type MainHealthRoutingState
} from './contract.ts';
import {
  createRegisteredHostedMainHealthInputs,
  GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY,
  HOSTED_MAIN_HEALTH_FRESHNESS_MS
} from './main-health-observation.ts';
import {
  compileMainHealthRepairDecision,
  type MainHealthRepairDecision,
  type MainHealthRepairObservation
} from './repair.ts';

const WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA =
  'sec-work-selection-main-health-providers-v1' as const;

export type WorkSelectionMainHealthProviderObservation =
  | Readonly<{ kind: 'available'; ledger: MainHealthLedger }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'unavailable'; ref: MainHealthDigest }>
  | Readonly<{ kind: 'invalid'; ref: MainHealthDigest }>;

/**
 * Opens the sole production read session. The callback receives no bearer
 * token or transport object; all provider requests stay inside this owner.
 * A same-capability nested read reuses the operation budget, while a nested
 * repository/effect session is rejected instead of silently creating a new
 * authority.
 */
export async function withMainHealthGitHubReadSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: () => Promise<T>;
}>): Promise<T> {
  return await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => await input.operation()
  });
}

/**
 * Bounds one logical read operation that may need two independently live
 * hosted snapshots.  Each nested MainHealth read session gets its own
 * per-request 30-second transport deadline, while credential, request-count,
 * response-byte and absolute parent deadlines remain shared.  Only two
 * session roots are admitted (T1 and a fresh T2); a third session is a typed
 * provider failure rather than a silent budget reset.
 */
export async function withMainHealthGitHubReadOperationBudget<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: () => Promise<T>;
}>): Promise<T> {
  return await withGitHubApiReadOperationBudget({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: input.operation
  });
}

/**
 * Checks the current parent budget at an effect owner's final admission
 * boundary. The check is intentionally unavailable outside the composition
 * helper, so a caller cannot manufacture a future deadline or use it as an
 * effect authority.
 */
export function assertMainHealthGitHubReadOperationBudgetCurrent(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): void {
  assertGitHubApiReadOperationBudgetCurrent({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository
  });
}

/** Opens the separate production status-write session used only by reconcile. */
type HostedMainHealthObservation =
  | Readonly<{ kind: 'observed'; checks: readonly GitHubCheckObservation[] }>
  | Readonly<{ kind: 'unavailable'; ref: MainHealthDigest }>
  | Readonly<{ kind: 'invalid'; ref: MainHealthDigest }>;

export type WorkSelectionMainHealthProjection = Readonly<{
  state: MainHealthRoutingState;
  ref: MainHealthDigest;
}>;

function digestRef(value: unknown): MainHealthDigest {
  return sha256(value) as MainHealthDigest;
}

function invalidRef(label: string, value: Uint8Array | string): MainHealthDigest {
  return digestRef(Object.freeze({
    schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
    label,
    valueDigest: rawSha256(value)
  }));
}

function currentMainHealthGitHubReadCapability(repository: string): GitHubApiCapability {
  return currentGitHubApiCapability(repository, 'read');
}

/**
 * Repository-bound MainAuthority ruleset facts from the active MainHealth
 * GitHub read session.  Callers receive semantic JSON only; credential,
 * endpoint, transport and request-budget authority remain in this owner.
 */
export async function observeMainAuthorityRulesetGitHubFacts(input: Readonly<{
  repository: string;
  defaultBranch: string;
}>): Promise<Readonly<{
  effectiveRules: readonly unknown[];
  detailedRulesets: readonly unknown[];
}>> {
  const capability = currentMainHealthGitHubReadCapability(input.repository);
  const effectiveRules: unknown[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 100; page += 1) {
    const records = await executeGitHubApiOperation(capability, {
      kind: 'effective-branch-rules',
      branch: input.defaultBranch,
      page
    });
    if (!Array.isArray(records)) {
      throw new MainHealthGitHubProviderError(
        'MainAuthority effective branch rules response is not an array'
      );
    }
    effectiveRules.push(...records);
    if (records.length < pageSize) break;
    if (page === 100) {
      throw new MainHealthGitHubProviderError(
        'MainAuthority effective branch rules exceed the bounded pagination capacity'
      );
    }
  }

  const rulesetIds = [...new Set(effectiveRules.map((rule, index) => {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new MainHealthGitHubProviderError(
        `MainAuthority effective branch rule ${index} is malformed`
      );
    }
    const id = (rule as Record<string, unknown>).ruleset_id;
    if (!Number.isSafeInteger(id) || (id as number) < 1) {
      throw new MainHealthGitHubProviderError(
        `MainAuthority effective branch rule ${index} has no exact ruleset id`
      );
    }
    return id as number;
  }))].sort((left, right) => left - right);
  const detailedRulesets: unknown[] = [];
  for (const rulesetId of rulesetIds) {
    detailedRulesets.push(await executeGitHubApiOperation(capability, {
      kind: 'ruleset',
      rulesetId
    }));
  }
  return Object.freeze({
    effectiveRules: Object.freeze(effectiveRules),
    detailedRulesets: Object.freeze(detailedRulesets)
  });
}

export type WorkSelectionGitHubIssue = Readonly<{
  number: number;
  nodeId: string;
  state: 'OPEN' | 'CLOSED';
  body: string;
}>;

export type WorkSelectionGitHubPullRequest = Readonly<{
  number: number;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  body: string;
}>;

function workSelectionGitHubRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MainHealthGitHubProviderError(`WorkSelection GitHub ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function workSelectionGitHubSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new MainHealthGitHubProviderError(`WorkSelection GitHub ${label} SHA is invalid`);
  }
  return value;
}

type MainHealthGitHubNumberedInventoryEntry = Readonly<{
  number: number;
  title: string;
}>;

type MainHealthGitHubReviewThreadConnection = Readonly<{
  totalCount: number;
  nodes: readonly Readonly<{ isResolved: boolean }>[];
  pageInfo: Readonly<{ hasNextPage: false; endCursor: null }>;
}>;

export type MainHealthGitHubControlInventory = Readonly<{
  openPullRequests: readonly MainHealthGitHubNumberedInventoryEntry[];
  openIssues: readonly MainHealthGitHubNumberedInventoryEntry[];
  reviewThreads: readonly Readonly<{
    number: number;
    reviewThreads: MainHealthGitHubReviewThreadConnection;
  }>[];
}>;

function mainHealthGitHubNonNegativeCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MainHealthGitHubProviderError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function mainHealthGitHubPositiveNumber(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new MainHealthGitHubProviderError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function mainHealthGitHubGraphQLRepository(
  value: unknown,
  label: string
): Record<string, unknown> {
  const root = workSelectionGitHubRecord(value, `${label} response`);
  if ('errors' in root
      && (!Array.isArray(root.errors) || root.errors.length !== 0)) {
    throw new MainHealthGitHubProviderError(`${label} response contains GraphQL errors`);
  }
  const data = workSelectionGitHubRecord(root.data, `${label} data`);
  return workSelectionGitHubRecord(data.repository, `${label} repository`);
}

async function observeMainHealthGitHubOpenCounts(repository: string): Promise<Readonly<{
  pullRequests: number;
  issues: number;
}>> {
  const repositoryValue = mainHealthGitHubGraphQLRepository(
    await executeGitHubApiOperation(
      currentMainHealthGitHubReadCapability(repository),
      { kind: 'control-inventory-open-counts' }
    ),
    'MainHealth GitHub open inventory count'
  );
  const pullRequests = workSelectionGitHubRecord(
    repositoryValue.pullRequests,
    'open pull request count'
  );
  const issues = workSelectionGitHubRecord(repositoryValue.issues, 'open issue count');
  return Object.freeze({
    pullRequests: mainHealthGitHubNonNegativeCount(
      pullRequests.totalCount,
      'MainHealth GitHub open pull request totalCount'
    ),
    issues: mainHealthGitHubNonNegativeCount(
      issues.totalCount,
      'MainHealth GitHub open issue totalCount'
    )
  });
}

async function observeMainHealthGitHubOpenNumberedInventory(repository: string): Promise<Readonly<{
  pullRequests: readonly MainHealthGitHubNumberedInventoryEntry[];
  issues: readonly MainHealthGitHubNumberedInventoryEntry[];
}>> {
  const pullRequests: MainHealthGitHubNumberedInventoryEntry[] = [];
  const issues: MainHealthGitHubNumberedInventoryEntry[] = [];
  const observedNumbers = new Set<number>();
  for (let page = 1; page <= 1_000; page += 1) {
    const value = await executeGitHubApiOperation(
      currentMainHealthGitHubReadCapability(repository),
      { kind: 'open-issues', page }
    );
    if (!Array.isArray(value)) {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub open issue inventory response is not an array'
      );
    }
    for (const [index, entry] of value.entries()) {
      const record = workSelectionGitHubRecord(entry, `open inventory ${page}:${index}`);
      const number = mainHealthGitHubPositiveNumber(
        record.number,
        `MainHealth GitHub open inventory ${page}:${index} number`
      );
      if (observedNumbers.has(number) || typeof record.title !== 'string') {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub open inventory ${page}:${index} is duplicate or malformed`
        );
      }
      observedNumbers.add(number);
      const observation = Object.freeze({ number, title: record.title });
      if ('pull_request' in record) pullRequests.push(observation);
      else issues.push(observation);
    }
    if (value.length < 100) {
      const byNumber = (
        left: MainHealthGitHubNumberedInventoryEntry,
        right: MainHealthGitHubNumberedInventoryEntry
      ): number => left.number - right.number;
      return Object.freeze({
        pullRequests: Object.freeze(pullRequests.sort(byNumber)),
        issues: Object.freeze(issues.sort(byNumber))
      });
    }
  }
  throw new MainHealthGitHubProviderError(
    'MainHealth GitHub open inventory exceeded 100,000 records'
  );
}

async function observeMainHealthGitHubReviewThreads(
  repository: string,
  pullRequestNumbers: readonly number[]
): Promise<MainHealthGitHubControlInventory['reviewThreads']> {
  const result: Array<MainHealthGitHubControlInventory['reviewThreads'][number]> = [];
  for (const number of pullRequestNumbers) {
    mainHealthGitHubPositiveNumber(number, 'MainHealth GitHub review-thread pull request');
    let cursor: string | null = null;
    let expectedTotalCount: number | null = null;
    const nodes: Readonly<{ isResolved: boolean }>[] = [];
    for (let page = 1; page <= 1_000; page += 1) {
      const repositoryValue = mainHealthGitHubGraphQLRepository(
        await executeGitHubApiOperation(
          currentMainHealthGitHubReadCapability(repository),
          {
            kind: 'control-inventory-review-threads',
            pullRequestNumber: number,
            endCursor: cursor
          }
        ),
        `MainHealth GitHub pull request ${number} review threads page ${page}`
      );
      const pullRequest = workSelectionGitHubRecord(
        repositoryValue.pullRequest,
        `pull request ${number}`
      );
      if (pullRequest.number !== number) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub review-thread response resolved the wrong pull request ${number}`
        );
      }
      const connection = workSelectionGitHubRecord(
        pullRequest.reviewThreads,
        `pull request ${number} reviewThreads`
      );
      const totalCount = mainHealthGitHubNonNegativeCount(
        connection.totalCount,
        `pull request ${number} reviewThreads totalCount`
      );
      expectedTotalCount ??= totalCount;
      if (totalCount !== expectedTotalCount || !Array.isArray(connection.nodes)) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread census drifted or is malformed`
        );
      }
      for (const [index, entry] of connection.nodes.entries()) {
        const node = workSelectionGitHubRecord(
          entry,
          `pull request ${number} reviewThreads node ${index}`
        );
        if (typeof node.isResolved !== 'boolean') {
          throw new MainHealthGitHubProviderError(
            `MainHealth GitHub pull request ${number} review-thread node is malformed`
          );
        }
        nodes.push(Object.freeze({ isResolved: node.isResolved }));
      }
      const pageInfo = workSelectionGitHubRecord(
        connection.pageInfo,
        `pull request ${number} reviewThreads pageInfo`
      );
      if (typeof pageInfo.hasNextPage !== 'boolean') {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread pageInfo is malformed`
        );
      }
      if (!pageInfo.hasNextPage) {
        if (nodes.length !== expectedTotalCount) {
          throw new MainHealthGitHubProviderError(
            `MainHealth GitHub pull request ${number} review-thread terminal page is incomplete: `
            + `expected ${expectedTotalCount}, observed ${nodes.length}`
          );
        }
        result.push(Object.freeze({
          number,
          reviewThreads: Object.freeze({
            totalCount: expectedTotalCount,
            nodes: Object.freeze(nodes),
            pageInfo: Object.freeze({ hasNextPage: false as const, endCursor: null })
          })
        }));
        break;
      }
      if (typeof pageInfo.endCursor !== 'string'
          || pageInfo.endCursor.length === 0
          || pageInfo.endCursor === cursor) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread cursor is invalid`
        );
      }
      cursor = pageInfo.endCursor;
      if (page === 1_000) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread pagination exceeded 100,000 records`
        );
      }
    }
  }
  return Object.freeze(result);
}

/**
 * Complete PR/Issue/review-thread inventory from the active repository-bound
 * MainHealth read session. Transport, credential, pagination, counts and the
 * final drift fence remain private to this semantic owner.
 */
export async function observeMainHealthGitHubControlInventory(input: Readonly<{
  repository: string;
}>): Promise<MainHealthGitHubControlInventory> {
  currentMainHealthGitHubReadCapability(input.repository);
  const before = await observeMainHealthGitHubOpenCounts(input.repository);
  const inventory = await observeMainHealthGitHubOpenNumberedInventory(input.repository);
  if (inventory.pullRequests.length !== before.pullRequests
      || inventory.issues.length !== before.issues) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub open inventory is incomplete or changed after its first count fence'
    );
  }
  const reviewThreads = await observeMainHealthGitHubReviewThreads(
    input.repository,
    inventory.pullRequests.map((entry) => entry.number)
  );
  const after = await observeMainHealthGitHubOpenCounts(input.repository);
  if (after.pullRequests !== before.pullRequests || after.issues !== before.issues) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub open inventory changed during its final count fence'
    );
  }
  return Object.freeze({
    openPullRequests: inventory.pullRequests,
    openIssues: inventory.issues,
    reviewThreads
  });
}

export async function observeWorkSelectionGitHubDefaultRef(input: Readonly<{
  repository: string;
  defaultBranch: string;
}>): Promise<string> {
  const value = workSelectionGitHubRecord(await executeGitHubApiOperation(
    currentMainHealthGitHubReadCapability(input.repository),
    { kind: 'git-ref', branch: input.defaultBranch }
  ), 'default ref');
  const object = workSelectionGitHubRecord(value.object, 'default ref object');
  return workSelectionGitHubSha(object.sha, 'default ref object');
}

export async function observeWorkSelectionGitHubIssues(input: Readonly<{
  repository: string;
  issueNumbers: readonly number[];
}>): Promise<readonly WorkSelectionGitHubIssue[]> {
  const observations: WorkSelectionGitHubIssue[] = [];
  for (const issueNumber of input.issueNumbers) {
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
      throw new MainHealthGitHubProviderError('WorkSelection GitHub issue number is invalid');
    }
    const value = workSelectionGitHubRecord(await executeGitHubApiOperation(
      currentMainHealthGitHubReadCapability(input.repository),
      { kind: 'issue', issueNumber }
    ), `issue ${issueNumber}`);
    if (value.number !== issueNumber
        || typeof value.node_id !== 'string' || value.node_id.length === 0
        || (value.state !== 'open' && value.state !== 'closed')
        || typeof value.body !== 'string') {
      throw new MainHealthGitHubProviderError(`WorkSelection GitHub issue ${issueNumber} is malformed`);
    }
    observations.push(Object.freeze({
      number: issueNumber,
      nodeId: value.node_id,
      state: value.state === 'open' ? 'OPEN' : 'CLOSED',
      body: value.body
    }));
  }
  return Object.freeze(observations);
}

export async function observeWorkSelectionGitHubOpenPullRequests(input: Readonly<{
  repository: string;
  defaultBranch: string;
}>): Promise<readonly WorkSelectionGitHubPullRequest[]> {
  const value = await executeGitHubApiOperation(
    currentMainHealthGitHubReadCapability(input.repository),
    { kind: 'open-pulls', baseBranch: input.defaultBranch }
  );
  if (!Array.isArray(value)) {
    throw new MainHealthGitHubProviderError('WorkSelection GitHub pull request census is invalid');
  }
  return Object.freeze(value.map((entry, index) => {
    const record = workSelectionGitHubRecord(entry, `pull request ${index}`);
    const head = workSelectionGitHubRecord(record.head, `pull request ${index} head`);
    const base = workSelectionGitHubRecord(record.base, `pull request ${index} base`);
    if (!Number.isSafeInteger(record.number) || (record.number as number) < 1
        || typeof head.ref !== 'string' || head.ref.length === 0
        || typeof base.ref !== 'string' || base.ref.length === 0
        || typeof record.body !== 'string') {
      throw new MainHealthGitHubProviderError(`WorkSelection GitHub pull request ${index} is malformed`);
    }
    return Object.freeze({
      number: record.number as number,
      headBranch: head.ref,
      headSha: workSelectionGitHubSha(head.sha, `pull request ${index} head`),
      baseBranch: base.ref,
      baseSha: workSelectionGitHubSha(base.sha, `pull request ${index} base`),
      body: record.body
    });
  }));
}

function projectLedger(input: Readonly<{
  ledger: MainHealthLedger;
  now: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): WorkSelectionMainHealthProjection {
  const decision = resolveOrdinaryMainHealthLane({
    ledger: input.ledger,
    now: input.now,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.mainSha
  });
  const state: MainHealthRoutingState =
    decision.observationValidity === 'invalid' || decision.ledger === null
      ? 'unresolved'
      : input.ledger.status === 'degraded'
        ? 'unhealthy'
        : input.ledger.status === 'healthy' && decision.allowed
          ? 'healthy'
          : 'unresolved';
  return Object.freeze({ state, ref: input.ledger.healthRevision });
}

export async function observeWorkSelectionGitHubBranchRefs(input: Readonly<{
  repository: string;
}>): Promise<readonly Readonly<{ branch: string; sha: string }>[]> {
  const observations: Array<Readonly<{ branch: string; sha: string }>> = [];
  for (let page = 1; page <= 1_000; page += 1) {
    const value = await executeGitHubApiOperation(
      currentMainHealthGitHubReadCapability(input.repository),
      { kind: 'matching-head-refs', page }
    );
    if (!Array.isArray(value)) {
      throw new MainHealthGitHubProviderError('WorkSelection GitHub branch census is invalid');
    }
    for (const [index, entry] of value.entries()) {
      const record = workSelectionGitHubRecord(entry, `branch ${page}:${index}`);
      const ref = record.ref;
      if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')
          || ref.length <= 'refs/heads/'.length) {
        throw new MainHealthGitHubProviderError(`WorkSelection GitHub branch ${page}:${index} is malformed`);
      }
      const object = workSelectionGitHubRecord(record.object, `branch ${page}:${index} object`);
      observations.push(Object.freeze({
        branch: ref.slice('refs/heads/'.length),
        sha: workSelectionGitHubSha(object.sha, `branch ${page}:${index}`)
      }));
    }
    if (value.length < 100) return Object.freeze(observations);
  }
  throw new MainHealthGitHubProviderError('WorkSelection GitHub branch census exceeded 100,000 refs');
}

/** Reads the live default-branch ref through the already-issued MainHealth
 * GitHub capability. This is intentionally part of the same bound resolver so
 * GH_HOST or an ambient gh CLI host cannot alter the exact-main fence. */
async function observeMainHealthGitHubDefaultBranchShaBound(input: Readonly<{
  repository: string;
  defaultBranch: string;
  capability: GitHubApiCapability;
}>): Promise<string> {
  if (input.defaultBranch !== 'main') {
    throw new MainHealthGitHubProviderError(
      'MainHealth default branch is not the canonical main branch'
    );
  }
  const value = await executeGitHubApiOperation(input.capability, {
    kind: 'git-ref',
    branch: input.defaultBranch
  });
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || typeof (value as Record<string, unknown>).object !== 'object'
      || (value as Record<string, unknown>).object === null
      || Array.isArray((value as Record<string, unknown>).object)
      || typeof ((value as Record<string, unknown>).object as Record<string, unknown>).sha
        !== 'string'
      || !/^[0-9a-f]{40}$/u.test(
        ((value as Record<string, unknown>).object as Record<string, unknown>).sha as string
      )) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub default-branch ref response is invalid'
    );
  }
  return ((value as Record<string, unknown>).object as Record<string, unknown>).sha as string;
}

/** Reads the live default-branch ref through the production read session. */
export async function observeMainHealthGitHubDefaultBranchSha(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
}>): Promise<string> {
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => await observeMainHealthGitHubDefaultBranchShaBound({
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      capability: currentGitHubApiCapability(input.repository, 'read')
    })
  });
}

function observeHostedProvider(input: Readonly<{
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  expiresAt: string;
  observation: HostedMainHealthObservation;
}>): WorkSelectionMainHealthProviderObservation {
  if (input.observation.kind === 'invalid') return input.observation;
  if (input.observation.kind === 'unavailable') return input.observation;
  const checks = input.observation.checks;
  const ledgers = createRegisteredHostedMainHealthInputs({
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    trustRevision: input.mainSha,
    observedAt: input.now,
    expiresAt: input.expiresAt,
    sourceRef: `github-check-runs:${input.repository}@${input.mainSha}`,
    checks
  }).map((ledgerInput) => createMainHealthLedger(ledgerInput));
  if (ledgers.length === 0) return Object.freeze({ kind: 'absent' });
  if (ledgers.some((ledger) => ledger.status === 'locked')
      || new Set(ledgers.map((ledger) => ledger.healthRevision)).size !== 1) {
    return Object.freeze({
      kind: 'invalid',
      ref: digestRef(Object.freeze({
        schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
        status: 'hosted-provider-invalid-or-conflicting',
        healthRevisions: ledgers.map((ledger) => ledger.healthRevision).sort()
      }))
    });
  }
  return Object.freeze({ kind: 'available', ledger: ledgers[0]! });
}

export type CanonicalMainHealthProviderResolution = Readonly<{
  projection: WorkSelectionMainHealthProjection;
  ledger: MainHealthLedger | null;
  repairObservation: MainHealthRepairObservation;
}>;

export function resolveWorkSelectionMainHealthProviders(input: Readonly<{
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  hosted: WorkSelectionMainHealthProviderObservation;
}>): CanonicalMainHealthProviderResolution {
  if (input.hosted.kind === 'invalid') {
    const ref = digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
      status: 'hosted-provider-invalid',
      hosted: input.hosted.ref
    }));
    return Object.freeze({
      projection: Object.freeze({
        state: 'unresolved',
        ref
      }),
      ledger: null,
      repairObservation: Object.freeze({ kind: 'provider-invalid', observationRef: ref })
    });
  }

  if (input.hosted.kind === 'unavailable') {
    const ref = digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
      status: 'hosted-provider-unavailable',
      hosted: input.hosted.ref,
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    }));
    return Object.freeze({
      projection: Object.freeze({ state: 'unresolved', ref }),
      ledger: null,
      repairObservation: Object.freeze({ kind: 'provider-unavailable', observationRef: ref })
    });
  }

  const hostedLedger = input.hosted.kind === 'available' ? input.hosted.ledger : null;
  if (hostedLedger !== null) {
    return Object.freeze({
      projection: projectLedger({
        ledger: hostedLedger,
        now: input.now,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        mainSha: input.mainSha,
        mainTreeSha: input.mainTreeSha
      }),
      ledger: hostedLedger,
      repairObservation: Object.freeze({ kind: 'available', ledger: hostedLedger })
    });
  }

  const ref = digestRef(Object.freeze({
    schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
    status: 'provider-missing',
    hosted: input.hosted.kind,
    hostedRef: null,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha
  }));
  return Object.freeze({
    projection: Object.freeze({
      state: 'unresolved',
      ref
    }),
    ledger: null,
    repairObservation: Object.freeze({
      kind: 'provider-missing',
      observationRef: ref
    })
  });
}

function boundedMainHealthProviderText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`MainHealth hosted provider ${label} is invalid`);
  }
  return value;
}

function positiveMainHealthProviderId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`MainHealth hosted provider ${label} is invalid`);
  }
  return value as number;
}

const MAIN_HEALTH_MAX_MATCHING_WORKFLOW_RUNS = 128;

type MainHealthWorkflowProvenance = Readonly<{
  raw: Record<string, unknown>;
  workflowPath: string;
  eventName: string;
  workflowRunDisplayTitle: string;
}>;

async function observeHostedMainHealthChecks(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  capability: GitHubApiCapability;
}>): Promise<HostedMainHealthObservation> {
  try {
    const checks: GitHubCheckObservation[] = [];
    const identities = new Set<number>();
    const matchingWorkflowRunIds = new Set<string>();
    const firstWorkflowByRunId = new Map<string, MainHealthWorkflowProvenance>();
    const secondWorkflowByRunId = new Map<string, MainHealthWorkflowProvenance>();
    const pageSnapshots: string[] = [];
    let matchingProviderCheckCount = 0;
    let expectedTotalCount: number | null = null;
    const readWorkflow = async (runId: string): Promise<MainHealthWorkflowProvenance> => {
      const workflowValue = await executeGitHubApiOperation(input.capability, {
        kind: 'workflow-run',
        runId
      });
      if (workflowValue === null || typeof workflowValue !== 'object'
          || Array.isArray(workflowValue)) {
        throw new Error('MainHealth hosted workflow provenance is not an object');
      }
      const workflow = workflowValue as Record<string, unknown>;
      if (String(workflow.id) !== runId || workflow.head_sha !== input.mainSha) {
        throw new Error('MainHealth hosted workflow provenance differs from check head');
      }
      return Object.freeze({
        raw: workflow,
        workflowPath: boundedMainHealthProviderText(
          workflow.path,
          `workflowRun[${runId}].workflowPath`
        ),
        eventName: boundedMainHealthProviderText(
          workflow.event,
          `workflowRun[${runId}].eventName`
        ),
        workflowRunDisplayTitle: boundedMainHealthProviderText(
          workflow.display_title,
          `workflowRun[${runId}].workflowRunDisplayTitle`
        )
      });
    };
    for (let page = 1; page <= 10; page += 1) {
      const value = await executeGitHubApiOperation(input.capability, {
        kind: 'check-runs',
        sha: input.mainSha,
        page
      });
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('MainHealth hosted check response is not an object');
      }
      const record = value as Record<string, unknown>;
      if (!Number.isSafeInteger(record.total_count) || (record.total_count as number) < 0
          || !Array.isArray(record.check_runs) || record.check_runs.length > 100) {
        throw new Error('MainHealth hosted check response shape is invalid');
      }
      const totalCount = record.total_count as number;
      if (totalCount > 1_000) {
        throw new Error('MainHealth hosted check inventory exceeds bounded pagination');
      }
      if (expectedTotalCount === null) {
        expectedTotalCount = totalCount;
      } else if (expectedTotalCount !== totalCount) {
        throw new Error('MainHealth hosted check inventory total_count drifted between pages');
      }
      pageSnapshots.push(encodeVerificationActionData(Object.freeze({
        total_count: totalCount,
        check_runs: record.check_runs
      })));
      for (const [index, candidate] of record.check_runs.entries()) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
          throw new Error(`MainHealth hosted check ${index} is not an object`);
        }
        const check = candidate as Record<string, unknown>;
        const id = positiveMainHealthProviderId(check.id, `checkRuns[${index}].id`);
        if (identities.has(id)) throw new Error('MainHealth hosted check IDs are duplicated');
        identities.add(id);
        const name = boundedMainHealthProviderText(check.name, `checkRuns[${index}].name`);
        const status = boundedMainHealthProviderText(check.status, `checkRuns[${index}].status`);
        const conclusion = check.conclusion;
        if (!['queued', 'in_progress', 'completed'].includes(status)
            || (status === 'completed'
              ? typeof conclusion !== 'string'
              : conclusion !== null)) {
          throw new Error(`MainHealth hosted check ${index} lifecycle is invalid`);
        }
        const headSha = boundedMainHealthProviderText(
          check.head_sha,
          `checkRuns[${index}].head_sha`
        );
        if (headSha !== input.mainSha || !/^[0-9a-f]{40}$/u.test(headSha)) {
          throw new Error(`MainHealth hosted check ${index} head SHA differs`);
        }
        const detailsUrl = check.details_url;
        if (detailsUrl !== null && detailsUrl !== undefined
            && typeof detailsUrl !== 'string') {
          throw new Error(`MainHealth hosted check ${index} details URL is invalid`);
        }
        const appValue = check.app;
        if (appValue !== null && appValue !== undefined
            && (typeof appValue !== 'object' || Array.isArray(appValue))) {
          throw new Error(`MainHealth hosted check ${index} app is invalid`);
        }
        const app = appValue as Record<string, unknown> | null | undefined;
        const appId = app === null || app === undefined || app.id === undefined
          ? null
          : positiveMainHealthProviderId(app.id, `checkRuns[${index}].app.id`);
        const appNodeId = appId === null
          ? null
          : boundedMainHealthProviderText(app?.node_id, `checkRuns[${index}].app.node_id`);
        const appSlug = appId === null
          ? null
          : boundedMainHealthProviderText(app?.slug, `checkRuns[${index}].app.slug`);
        if (appId === null && (app?.node_id !== undefined || app?.slug !== undefined)) {
          throw new Error(`MainHealth hosted check ${index} app identity is partial`);
        }
        const normalizedDetailsUrl = detailsUrl === undefined ? null : detailsUrl as string | null;
        const workflowRunId = normalizedDetailsUrl === null
          ? null
          : /\/actions\/runs\/([1-9][0-9]*)/u.exec(normalizedDetailsUrl)?.[1] ?? null;
        const mayMatchRegisteredProvider = name === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.context
          && appId === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.app.id
          && appNodeId === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.app.nodeId
          && appSlug === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.app.slug;
        if (mayMatchRegisteredProvider) {
          matchingProviderCheckCount += 1;
          if (matchingProviderCheckCount > MAIN_HEALTH_MAX_MATCHING_WORKFLOW_RUNS) {
            throw new Error(
              'MainHealth hosted matching provider check count exceeds bounded workflow provenance'
            );
          }
          if (workflowRunId !== null) matchingWorkflowRunIds.add(workflowRunId);
        }
        checks.push(Object.freeze({
          id,
          name,
          status,
          conclusion: conclusion as string | null,
          headSha,
          detailsUrl: normalizedDetailsUrl,
          appId,
          appNodeId,
          appSlug,
          workflowPath: null,
          workflowRef: null,
          eventName: null,
          workflowRunId,
          workflowRunDisplayTitle: null
        }));
      }
      if (record.check_runs.length < 100) break;
      if (page === 10) throw new Error('MainHealth hosted check pagination exceeded bound');
    }
    if (expectedTotalCount === null || checks.length !== expectedTotalCount
        || pageSnapshots.length === 0) {
      throw new Error('MainHealth hosted check inventory is incomplete');
    }
    // First provenance pass is fenced by a complete second census. Every
    // page's canonical raw bytes, count, IDs and ordering must remain exact;
    // rereading only page one cannot detect a middle-page mutation.
    for (const runId of matchingWorkflowRunIds) {
      firstWorkflowByRunId.set(runId, await readWorkflow(runId));
    }
    for (let page = 1; page <= pageSnapshots.length; page += 1) {
      const value = await executeGitHubApiOperation(input.capability, {
        kind: 'check-runs',
        sha: input.mainSha,
        page
      });
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('MainHealth hosted check stable response is not an object');
      }
      const record = value as Record<string, unknown>;
      if (record.total_count !== expectedTotalCount
          || !Array.isArray(record.check_runs)
          || record.check_runs.length > 100
          || encodeVerificationActionData(Object.freeze({
            total_count: record.total_count,
            check_runs: record.check_runs
          })) !== pageSnapshots[page - 1]) {
        throw new Error('MainHealth hosted check inventory changed during complete stable readback');
      }
      if (page < pageSnapshots.length && record.check_runs.length < 100) {
        throw new Error('MainHealth hosted check pagination shortened during stable readback');
      }
      if (page === pageSnapshots.length && record.check_runs.length === 100
          && pageSnapshots.length < 10) {
        throw new Error('MainHealth hosted check pagination extended during stable readback');
      }
    }
    for (const runId of matchingWorkflowRunIds) {
      secondWorkflowByRunId.set(runId, await readWorkflow(runId));
      const first = firstWorkflowByRunId.get(runId)!;
      const second = secondWorkflowByRunId.get(runId)!;
      if (encodeVerificationActionData(first.raw)
          !== encodeVerificationActionData(second.raw)) {
        throw new Error('MainHealth hosted workflow provenance changed during stable readback');
      }
    }
    const stableChecks = checks.map((check) => {
      if (check.workflowRunId === null) return check;
      const workflow = secondWorkflowByRunId.get(check.workflowRunId);
      if (workflow === undefined) {
        throw new Error('MainHealth hosted workflow provenance was not observed');
      }
      return Object.freeze({
        ...check,
        workflowPath: workflow.workflowPath,
        workflowRef: `${workflow.workflowPath}@${input.mainSha}`,
        eventName: workflow.eventName,
        workflowRunDisplayTitle: workflow.workflowRunDisplayTitle
      });
    });
    return Object.freeze({ kind: 'observed', checks: Object.freeze(stableChecks) });
  } catch (error) {
    if (error instanceof MainHealthGitHubProviderError) {
      return Object.freeze({
        kind: 'unavailable',
        ref: invalidRef(
          'hosted-main-health-transport-unavailable',
          `${input.repository}\n${input.mainSha}\n${error.message}`
        )
      });
    }
    return Object.freeze({
      kind: 'invalid',
      ref: invalidRef(
        'hosted-main-health-provider-invalid',
        `${input.repository}\n${input.mainSha}\n${error instanceof Error ? error.message : String(error)}`
      )
    });
  }
}

async function observeWorkSelectionMainHealthProvider(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  capability: GitHubApiCapability;
}>): Promise<Readonly<{
  observedAt: string;
  hostedProvider: WorkSelectionMainHealthProviderObservation;
  resolution: CanonicalMainHealthProviderResolution;
}>> {
  const observedAt = new Date().toISOString();
  const hosted = await observeHostedMainHealthChecks(input);
  const hostedProvider = observeHostedProvider({
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    now: observedAt,
    expiresAt: new Date(
      Date.parse(observedAt) + HOSTED_MAIN_HEALTH_FRESHNESS_MS
    ).toISOString(),
    observation: hosted
  });
  return Object.freeze({
    observedAt,
    hostedProvider,
    resolution: resolveWorkSelectionMainHealthProviders({
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: observedAt,
      hosted: hostedProvider
    })
  });
}

function compileMainHealthRepairDecisionFromWorkSelectionObservation(
  input: Readonly<{
    repository: string;
    defaultBranch: string;
    mainSha: string;
    mainTreeSha: string;
  }>,
  observation: Readonly<{
    observedAt: string;
    resolution: CanonicalMainHealthProviderResolution;
  }>
): MainHealthRepairDecision {
  return compileMainHealthRepairDecision({
    observation: observation.resolution.repairObservation,
    now: observation.observedAt,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.mainSha
  });
}

declare const mainHealthPublicationAuthorityBrand: unique symbol;

export type MainHealthPublicationAuthority = Readonly<{
  readonly [mainHealthPublicationAuthorityBrand]: true;
}>;

type MainHealthPublicationAuthorityBinding = Readonly<{
  subject: Readonly<{
    repository: string;
    defaultBranch: string;
    mainSha: string;
    mainTreeSha: string;
  }>;
  hostedProviderEpoch: MainHealthDigest | null;
  hostedProvenanceDigest: MainHealthDigest | null;
}>;

const mainHealthPublicationAuthorityBindings =
  new WeakMap<object, MainHealthPublicationAuthorityBinding>();

function mainHealthPublicationAuthorityBinding(
  authority: MainHealthPublicationAuthority
): MainHealthPublicationAuthorityBinding {
  const binding = mainHealthPublicationAuthorityBindings.get(authority);
  if (binding === undefined) {
    throw new Error('MainHealth publication authority is forged or not issued in this process');
  }
  return binding;
}

export function assertMainHealthPublicationAuthorityStable(
  first: MainHealthPublicationAuthority,
  second: MainHealthPublicationAuthority
): void {
  if (encodeVerificationActionData(mainHealthPublicationAuthorityBinding(first))
      !== encodeVerificationActionData(mainHealthPublicationAuthorityBinding(second))) {
    throw new Error('MainHealth publication authority drifted between live snapshots');
  }
}

function createWorkSelectionMainHealthPublicationAuthority(input: Readonly<{
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  hostedProvider: WorkSelectionMainHealthProviderObservation;
}>): MainHealthPublicationAuthority {
  const hostedLedger = input.hostedProvider.kind === 'available'
    ? input.hostedProvider.ledger
    : null;
  const authority = Object.freeze({}) as MainHealthPublicationAuthority;
  mainHealthPublicationAuthorityBindings.set(authority, Object.freeze({
    subject: Object.freeze({
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    }),
    hostedProviderEpoch: hostedLedger === null ? null : hostedLedger.healthRevision,
    hostedProvenanceDigest: hostedLedger === null
      ? null
      : digestRef(Object.freeze({
          schema: 'sec-main-health-hosted-provenance-v2',
          producer: hostedLedger.producer
        }))
  }));
  return authority;
}

function mainHealthPublicationStableDigest(input: Readonly<{
  projection: WorkSelectionMainHealthProjection;
  ledger: MainHealthLedger | null;
  repairDecision: MainHealthRepairDecision;
  authority: MainHealthPublicationAuthority;
}>): MainHealthDigest {
  const ledger = input.ledger;
  return digestRef(Object.freeze({
    schema: 'sec-hosted-main-health-publication-stable-observation-v1',
    projection: input.projection,
    authority: mainHealthPublicationAuthorityBinding(input.authority),
    ledger: ledger === null ? null : Object.freeze({
      repository: ledger.repository,
      defaultBranch: ledger.defaultBranch,
      mainSha: ledger.mainSha,
      mainTreeSha: ledger.mainTreeSha,
      status: ledger.status,
      failureFingerprints: ledger.failureFingerprints,
      owner: ledger.owner,
      repairWorkPackage: ledger.repairWorkPackage,
      allowedLanes: ledger.allowedLanes,
      trustRevision: ledger.trustRevision,
      healthRevision: ledger.healthRevision,
      producer: ledger.producer
    }),
    repairDecision: Object.freeze({
      status: input.repairDecision.status,
      routingState: input.repairDecision.routingState,
      reasonCode: input.repairDecision.reasonCode,
      binding: input.repairDecision.binding
    })
  }));
}

const mainHealthTestingResultBrand = Symbol('sec-main-health-testing-result-v2');
type MainHealthTestingResult<T> = T & Readonly<{
  readonly [mainHealthTestingResultBrand]: true;
}>;

declare const workSelectionMainHealthSnapshotBrand: unique symbol;
export type WorkSelectionMainHealthSnapshot = Readonly<{
  readonly [workSelectionMainHealthSnapshotBrand]: true;
}>;

type WorkSelectionMainHealthSnapshotBinding = Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  projection: WorkSelectionMainHealthProjection;
  stableDigest: MainHealthDigest;
}>;

const workSelectionMainHealthSnapshotBindings =
  new WeakMap<object, WorkSelectionMainHealthSnapshotBinding>();

function issueWorkSelectionMainHealthSnapshot(
  input: WorkSelectionMainHealthSnapshotBinding
): WorkSelectionMainHealthSnapshot {
  const snapshot = Object.freeze({}) as WorkSelectionMainHealthSnapshot;
  workSelectionMainHealthSnapshotBindings.set(snapshot, Object.freeze({
    ...input,
    repositoryRoot: path.resolve(input.repositoryRoot)
  }));
  return snapshot;
}

export function resolveWorkSelectionMainHealthSnapshot(input: Readonly<{
  snapshot: WorkSelectionMainHealthSnapshot;
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): Readonly<{
  projection: WorkSelectionMainHealthProjection;
  stableDigest: MainHealthDigest;
}> {
  const binding = workSelectionMainHealthSnapshotBindings.get(input.snapshot);
  if (binding === undefined
      || binding.repositoryRoot !== path.resolve(input.repositoryRoot)
      || binding.repository !== input.repository
      || binding.defaultBranch !== input.defaultBranch
      || binding.mainSha !== input.mainSha
      || binding.mainTreeSha !== input.mainTreeSha) {
    throw new MainHealthGitHubProviderError(
      'WorkSelection MainHealth snapshot is absent, forged, or bound to another exact main'
    );
  }
  return Object.freeze({
    projection: binding.projection,
    stableDigest: binding.stableDigest
  });
}

export async function observeCanonicalMainHealthForPublication(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): Promise<Readonly<{
  observedAt: string;
  projection: WorkSelectionMainHealthProjection;
  ledger: MainHealthLedger | null;
  repairDecision: MainHealthRepairDecision;
  authority: MainHealthPublicationAuthority;
  stableDigest: MainHealthDigest;
  workSelectionSnapshot: WorkSelectionMainHealthSnapshot;
}>> {
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => {
      const observation = await observeWorkSelectionMainHealthProvider({
        ...input,
        capability: currentGitHubApiCapability(input.repository, 'read')
      });
      const repairDecision = compileMainHealthRepairDecisionFromWorkSelectionObservation(
        input,
        observation
      );
      const authority = createWorkSelectionMainHealthPublicationAuthority({
        ...input,
        hostedProvider: observation.hostedProvider
      });
      const result = Object.freeze({
        observedAt: observation.observedAt,
        projection: observation.resolution.projection,
        ledger: observation.resolution.ledger,
        repairDecision,
        authority,
        stableDigest: '' as MainHealthDigest
      });
      const stable = Object.freeze({
        ...result,
        stableDigest: mainHealthPublicationStableDigest(result)
      });
      return Object.freeze({
        ...stable,
        workSelectionSnapshot: issueWorkSelectionMainHealthSnapshot({
          repositoryRoot: input.repositoryRoot,
          repository: input.repository,
          defaultBranch: input.defaultBranch,
          mainSha: input.mainSha,
          mainTreeSha: input.mainTreeSha,
          projection: stable.projection,
          stableDigest: stable.stableDigest
        })
      });
    }
  });
}

/**
 * @internal Test-only document-control observation. Both projections are
 * compiled from one canonical provider observation so a fixture can preserve
 * the production T2 routing relationship without receiving a production
 * WorkSelection snapshot or publication authority.
 */
export async function observeCanonicalMainHealthForDocumentControlTesting(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  capability: GitHubApiCapability;
}>): Promise<MainHealthTestingResult<Readonly<{
  projection: WorkSelectionMainHealthProjection;
  repairDecision: MainHealthRepairDecision;
  stableDigest: MainHealthDigest;
}>>> {
  const observation = await observeWorkSelectionMainHealthProvider(input);
  const repairDecision = compileMainHealthRepairDecisionFromWorkSelectionObservation(input, observation);
  const authority = createWorkSelectionMainHealthPublicationAuthority({
    ...input,
    hostedProvider: observation.hostedProvider
  });
  return Object.freeze({
    projection: observation.resolution.projection,
    repairDecision,
    stableDigest: mainHealthPublicationStableDigest({
      projection: observation.resolution.projection,
      ledger: observation.resolution.ledger,
      repairDecision,
      authority
    }),
    [mainHealthTestingResultBrand]: true as const
  });
}
