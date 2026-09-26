import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan, issueSemanticOperationAttemptContext, type OperationDigest } from '../../../../execution/operation/semantic.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../filesystem/write-lease.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { assertGitPhysicalProviderReceipt, closeGitPhysicalProvider, openGitPhysicalProvider } from '../../../providers/git/physical-provider.ts';
import { deleteExactGitRef, deleteExactLocalGitRefs } from '../../../providers/git/ref-effect.ts';
import {
  executeGitHubApiOperation,
  GITHUB_API_REQUEST_TIMEOUT_MS,
  GitHubApiProviderError,
  inspectGitHubApiCapability,
  withGitHubApiBranchCloseoutWriteSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  JOURNAL_RETIREMENT_REQUEST_CEILING,
  settleDevelopmentCommitJournalsForRef
} from '../../development/commit/operation.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import { observeActiveWorkPackage } from '../documentation/document-control-plane.ts';
import {
  parsePreparedBranchCloseoutEnvelope,
  prepareClosedUnmergedPullRequestCloseout,
  type PreparedBranchCloseoutEnvelope
} from './branch-closeout.ts';
import type { BranchLifecycleInventory, BranchPullRequestObservation } from './branch-lifecycle-contract.ts';
import { collectBranchLifecycleCloseoutTargetInventory } from './branch-lifecycle-inventory.ts';
import { parsePullRequestObservations } from './branch-lifecycle-parsers.ts';
import {
  observeClosedSupersessionEvidence,
  type ClosedSupersessionEvidence
} from './closed-supersession-review.ts';
import {
  compileClosedUnmergedCloseoutOperation,
  createClosedSupersededDispositionEvidence,
  executeClosedUnmergedCloseoutOperation,
  issueClosedUnmergedCloseoutEffectProvider,
  tryCreateClosedNativeAbsorptionDispositionEvidence,
  type ClosedUnmergedCloseoutEffectAdapter,
  type ClosedUnmergedCloseoutEffectStartReceipt,
  type ClosedUnmergedCloseoutExecutionResult,
  type ClosedUnmergedCloseoutOperation,
  type ClosedUnmergedProviderMutation,
  type ClosedUnmergedTerminal
} from './closed-unmerged-closeout.ts';
import { retireClosedUnmergedRecoveryFamily } from './closed-unmerged-recovery-retirement.ts';

const START_MARKER = '<!-- sec-closed-unmerged-effect-start -->\n';
const TERMINAL_MARKER = '<!-- sec-closed-unmerged-terminal -->\n';
const MAX_COMMENT_PAGES = 20;
const COMMENTS_PER_PAGE = 100;
const LOCAL_EFFECT_DURATION_MS = 120_000;
const LOCAL_EFFECT_REQUIREMENT = 'branch-lifecycle.closed-unmerged.ref-delete';
const LOCAL_EFFECT_CONTRACT = sha256({ owner: 'control.branch-lifecycle', operation: 'closed-unmerged-ref-delete', effect: 'one-exact-native-git-ref-cas' }) as OperationDigest;
const LOCAL_EFFECT_PROVIDER = sha256({ owner: 'external-capabilities.git', provider: 'git-physical-provider' }) as OperationDigest;
const COMPILE_FIXED_SESSION_COUNT = 3;
const COMPLETED_PREPARATION_OBSERVATION_COUNT = 1;
const EXECUTION_INVENTORY_COUNT = 6;
const COMMENT_OBSERVATION_COUNT = 4;
const COMMENT_PUBLICATION_COUNT = 2;
const COMMENT_PAGE_SESSION_COUNT = MAX_COMMENT_PAGES;
const REMOTE_CAS_SESSION_COUNT = 1;
const RETIREMENT_SESSION_COUNT = 1;
const RETIREMENT_GIT_READ_COUNT = 2;
const ENROLLED_SINGLE_READ_REQUESTS = 3;
const ENROLLED_REVIEW_REQUESTS = 4;
const ENROLLED_PUBLICATION_READBACK_REQUESTS = 4;
const ENROLLED_REMOTE_CAS_REQUESTS = 4;
const ENROLLED_RETIREMENT_REQUESTS = 2
  + JOURNAL_RETIREMENT_REQUEST_CEILING;
const WORKFLOW_SESSION_LIMIT = COMPILE_FIXED_SESSION_COUNT
  + COMPLETED_PREPARATION_OBSERVATION_COUNT * COMMENT_PAGE_SESSION_COUNT
  + EXECUTION_INVENTORY_COUNT
  + COMMENT_OBSERVATION_COUNT * COMMENT_PAGE_SESSION_COUNT
  + COMMENT_PUBLICATION_COUNT * (COMMENT_PAGE_SESSION_COUNT + 1)
  + REMOTE_CAS_SESSION_COUNT
  + RETIREMENT_SESSION_COUNT;
const WORKFLOW_REQUEST_LIMIT = 2 * ENROLLED_SINGLE_READ_REQUESTS + ENROLLED_REVIEW_REQUESTS
  + COMPLETED_PREPARATION_OBSERVATION_COUNT
    * COMMENT_PAGE_SESSION_COUNT * ENROLLED_SINGLE_READ_REQUESTS
  + EXECUTION_INVENTORY_COUNT * ENROLLED_SINGLE_READ_REQUESTS
  + COMMENT_OBSERVATION_COUNT * COMMENT_PAGE_SESSION_COUNT * ENROLLED_SINGLE_READ_REQUESTS
  + COMMENT_PUBLICATION_COUNT * (
    COMMENT_PAGE_SESSION_COUNT * ENROLLED_SINGLE_READ_REQUESTS
    + ENROLLED_PUBLICATION_READBACK_REQUESTS
  )
  + REMOTE_CAS_SESSION_COUNT * ENROLLED_REMOTE_CAS_REQUESTS
  + RETIREMENT_SESSION_COUNT * ENROLLED_RETIREMENT_REQUESTS;
const WORKFLOW_DURATION_LIMIT_MS = WORKFLOW_SESSION_LIMIT * GITHUB_API_REQUEST_TIMEOUT_MS
  + (COMPILE_FIXED_SESSION_COUNT + EXECUTION_INVENTORY_COUNT + RETIREMENT_GIT_READ_COUNT)
    * GIT_READ_OPERATION_BUDGET.deadlineMs
  + 2 * LOCAL_EFFECT_DURATION_MS;

type CommentRecord = Readonly<{ id: number; body: string; authorNodeId: string }>;

type ClosedUnmergedProviderObservation<T> =
  | Readonly<{ status: 'observed'; value: T }>
  | Readonly<{ status: 'unavailable' | 'ambiguous'; detail: string }>;

export interface ProductionClosedUnmergedCompileContext {
  observePullRequest(pullRequestNumber: number): Promise<BranchPullRequestObservation>;
  observeHeadRef(branch: string): Promise<Readonly<{
    state: 'present';
    sha: string;
  }> | Readonly<{ state: 'absent' }>>;
  observeSupersessionEvidence(input: Readonly<{
    pullRequestNumber: number;
    commentId: number;
  }>): Promise<ClosedSupersessionEvidence>;
  observeCompletedPreparation(
    pullRequestNumber: number,
    evidenceDigest: `sha256:${string}`
  ): Promise<PreparedBranchCloseoutEnvelope | null>;
}

type BoundGitHubSession = <T>(input: Readonly<{
  requestCeiling: number;
  operation(capability: GitHubApiCapability): Promise<T>;
}>) => Promise<T>;

type WorkflowBinding = ReturnType<typeof inspectGitHubApiCapability>;

function samePrincipal(left: WorkflowBinding, right: WorkflowBinding): boolean {
  return left.repository === right.repository
    && left.effect === right.effect
    && left.principal.transport === right.principal.transport
    && left.principal.login === right.principal.login
    && left.principal.nodeId === right.principal.nodeId
    && left.principal.userId === right.principal.userId
    && left.principal.permission === right.principal.permission;
}

function createWorkflowSessions(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): Readonly<{
  withSession: BoundGitHubSession;
  binding(): WorkflowBinding;
  assertCurrent(): void;
  context: ProductionClosedUnmergedCompileContext;
}> {
  let sessions = 0;
  let requests = 0;
  let established: WorkflowBinding | undefined;
  const deadlineAtUnixMs = Date.now() + WORKFLOW_DURATION_LIMIT_MS;
  const assertCurrent = () => {
    if (Date.now() >= deadlineAtUnixMs) {
      throw new Error('Closed-unmerged workflow aggregate duration budget is exhausted.');
    }
  };
  const withSession: BoundGitHubSession = async ({ requestCeiling, operation }) => {
    assertCurrent();
    if (!Number.isSafeInteger(requestCeiling) || requestCeiling < 1
        || sessions + 1 > WORKFLOW_SESSION_LIMIT
        || requests + requestCeiling > WORKFLOW_REQUEST_LIMIT) {
      throw new Error('Closed-unmerged GitHub workflow aggregate budget is exhausted.');
    }
    sessions += 1;
    requests += requestCeiling;
    return withGitHubApiBranchCloseoutWriteSession({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      operation: async (capability) => {
        const observed = inspectGitHubApiCapability(capability);
        if (observed.repository !== input.repository || observed.effect !== 'branch-closeout-write') {
          throw new Error('Closed-unmerged GitHub session binding differs from the workflow.');
        }
        if (established === undefined) established = observed;
        else if (!samePrincipal(established, observed)) {
          throw new Error('Closed-unmerged GitHub principal changed between bounded sessions.');
        }
        return operation(capability);
      }
    });
  };
  const context = Object.freeze<ProductionClosedUnmergedCompileContext>({
    observePullRequest: (pullRequestNumber) => withSession({ requestCeiling: ENROLLED_SINGLE_READ_REQUESTS,
      operation: (capability) => observeProductionClosedUnmergedPullRequest({ capability, pullRequestNumber }) }),
    observeHeadRef: (branch) => withSession({ requestCeiling: ENROLLED_SINGLE_READ_REQUESTS, operation: async (capability) => {
      try {
        const value = await executeGitHubApiOperation(capability, { kind: 'git-ref', branch });
        const record = value !== null && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown>
          : null;
        const object = value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>).object
          : null;
        const sha = object !== null && typeof object === 'object' && !Array.isArray(object)
          ? (object as Record<string, unknown>).sha
          : null;
        if (record?.ref !== `refs/heads/${branch}`
            || (object as Record<string, unknown> | null)?.type !== 'commit'
            || typeof sha !== 'string' || !/^[0-9a-f]{40}$/u.test(sha)) {
          throw new Error('GitHub exact head ref response is invalid.');
        }
        return Object.freeze({ state: 'present' as const, sha });
      } catch (error) {
        if (error instanceof GitHubApiProviderError && error.statusCode === 404) {
          return Object.freeze({ state: 'absent' as const });
        }
        throw error;
      }
    } }),
    observeSupersessionEvidence: ({ pullRequestNumber, commentId }) => withSession({ requestCeiling: ENROLLED_REVIEW_REQUESTS,
      operation: (capability) => observeClosedSupersessionEvidence({ repositoryRoot: input.repositoryRoot,
        capability, pullRequestNumber, commentId }) }),
    observeCompletedPreparation: (pullRequestNumber, evidenceDigest) => observeCompletedPreparation({
      withSession, pullRequestNumber, evidenceDigest,
      principalNodeId: established?.principal.nodeId ?? ''
    })
  });
  return Object.freeze({ withSession, context, assertCurrent,
    binding: () => {
      if (established === undefined) throw new Error('Closed-unmerged workflow established no GitHub principal.');
      return established;
    } });
}

function canonicalRoot(value: string): string {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || resolved !== value) throw new Error('repositoryRoot must be canonical and absolute.');
  return resolved;
}

function parseExactPull(value: unknown, repository: string, pullRequestNumber: number): BranchPullRequestObservation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub exact pull response is invalid.');
  const pull = value as Record<string, unknown>;
  const head = pull.head as Record<string, unknown> | undefined;
  const base = pull.base as Record<string, unknown> | undefined;
  const headRepository = head?.repo as Record<string, unknown> | undefined;
  const baseRepository = base?.repo as Record<string, unknown> | undefined;
  if (pull.number !== pullRequestNumber
      || pull.html_url !== `https://github.com/${repository}/pull/${pullRequestNumber}`
      || headRepository?.full_name !== repository
      || baseRepository?.full_name !== repository) {
    throw new Error('GitHub exact pull repository identity differs from the active capability.');
  }
  return parsePullRequestObservations(JSON.stringify([{
    number: pull.number,
    headRefName: head?.ref,
    headRefOid: head?.sha,
    baseRefName: base?.ref,
    baseRefOid: base?.sha,
    state: pull.merged_at === null || pull.merged_at === undefined ? pull.state : 'merged',
    isDraft: pull.draft === true,
    isCrossRepository: headRepository?.full_name !== baseRepository?.full_name,
    url: pull.html_url
  }]))[0]!;
}

export async function observeProductionClosedUnmergedPullRequest(input: Readonly<{
  capability: GitHubApiCapability;
  pullRequestNumber: number;
}>): Promise<BranchPullRequestObservation> {
  const binding = inspectGitHubApiCapability(input.capability);
  return parseExactPull(
    await executeGitHubApiOperation(input.capability, { kind: 'pull', pullRequestNumber: input.pullRequestNumber }),
    binding.repository,
    input.pullRequestNumber
  );
}

function commentRecord(value: unknown): CommentRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub issue comment response is invalid.');
  const comment = value as Record<string, unknown>;
  const user = comment.user as Record<string, unknown> | undefined;
  if (!Number.isSafeInteger(comment.id) || Number(comment.id) < 1 || typeof comment.body !== 'string'
      || typeof user?.node_id !== 'string' || user.node_id.length === 0) {
    throw new Error('GitHub issue comment identity is invalid.');
  }
  return Object.freeze({ id: Number(comment.id), body: comment.body, authorNodeId: user.node_id });
}

function renderComment(marker: string, value: unknown): string { return `${marker}${JSON.stringify(value)}`; }

async function listComments(withSession: BoundGitHubSession, pullRequestNumber: number): Promise<readonly CommentRecord[]> {
  const comments: CommentRecord[] = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const value = await withSession({ requestCeiling: ENROLLED_SINGLE_READ_REQUESTS, operation: (capability) => (
      executeGitHubApiOperation(capability, { kind: 'issue-comments', issueNumber: pullRequestNumber, page })
    ) });
    if (!Array.isArray(value)) throw new Error('GitHub issue comments response is invalid.');
    comments.push(...value.map(commentRecord));
    if (value.length < COMMENTS_PER_PAGE) return Object.freeze(comments);
  }
  throw new Error('GitHub issue comment pagination exceeds the bounded complete census.');
}

async function observeMarked<T extends { operationId: string }>(input: Readonly<{
  withSession: BoundGitHubSession;
  pullRequestNumber: number;
  operationId: string;
  marker: string;
  principalNodeId: string;
}>): Promise<ClosedUnmergedProviderObservation<T | null>> {
  try {
    const matches: T[] = [];
    for (const comment of await listComments(input.withSession, input.pullRequestNumber)) {
      if (comment.authorNodeId !== input.principalNodeId) continue;
      if (!comment.body.startsWith(input.marker)) continue;
      let parsed: T;
      try { parsed = JSON.parse(comment.body.slice(input.marker.length)) as T; }
      catch { return Object.freeze({ status: 'ambiguous', detail: 'operation marker has invalid JSON' }); }
      if (parsed?.operationId !== input.operationId) continue;
      if (comment.body !== renderComment(input.marker, parsed)) {
        return Object.freeze({ status: 'ambiguous', detail: 'operation comment provenance is invalid' });
      }
      matches.push(parsed);
    }
    if (matches.length > 1) return Object.freeze({ status: 'ambiguous', detail: 'duplicate operation comments exist' });
    return Object.freeze({ status: 'observed', value: matches[0] ?? null });
  } catch (error) {
    return Object.freeze({ status: 'unavailable', detail: error instanceof Error ? error.message : String(error) });
  }
}

async function observeCompletedPreparation(input: Readonly<{
  withSession: BoundGitHubSession;
  pullRequestNumber: number;
  evidenceDigest: `sha256:${string}`;
  principalNodeId: string;
}>): Promise<PreparedBranchCloseoutEnvelope | null> {
  if (input.principalNodeId.length === 0) {
    throw new Error('Closed-unmerged workflow principal is not established.');
  }
  const matches: unknown[] = [];
  for (const comment of await listComments(input.withSession, input.pullRequestNumber)) {
    if (comment.authorNodeId !== input.principalNodeId) continue;
    if (!comment.body.startsWith(TERMINAL_MARKER)) continue;
    let terminal: ClosedUnmergedTerminal;
    try { terminal = JSON.parse(comment.body.slice(TERMINAL_MARKER.length)) as ClosedUnmergedTerminal; }
    catch { throw new Error('Closed-unmerged terminal marker has invalid JSON.'); }
    if (terminal.evidenceDigest !== input.evidenceDigest) continue;
    if (comment.body !== renderComment(TERMINAL_MARKER, terminal)) {
      throw new Error('Closed-unmerged completed terminal provenance is invalid.');
    }
    matches.push(terminal.prepared);
  }
  if (matches.length > 1) {
    throw new Error('Closed-unmerged completed terminal is ambiguous for the exact evidence.');
  }
  const prepared = matches[0];
  if (prepared === undefined) return null;
  return parsePreparedBranchCloseoutEnvelope(JSON.stringify(prepared));
}

async function publishMarked<T extends { operationId: string }>(input: Readonly<{
  withSession: BoundGitHubSession;
  pullRequestNumber: number;
  value: T;
  marker: string;
  principalNodeId: string;
}>): Promise<ClosedUnmergedProviderMutation> {
  const before = await observeMarked<T>({ ...input, operationId: input.value.operationId });
  if (before.status !== 'observed') return Object.freeze({ status: before.status, detail: before.detail });
  const body = renderComment(input.marker, input.value);
  if (Buffer.byteLength(body, 'utf8') > 65_536) {
    return Object.freeze({ status: 'rejected', detail: 'operation comment exceeds the GitHub native byte limit' });
  }
  if (before.value !== null) {
    const same = JSON.stringify(before.value) === JSON.stringify(input.value);
    return Object.freeze({ status: same ? 'already-applied' : 'rejected', detail: same ? 'exact operation comment already exists' : 'operation comment conflicts with the requested publication' });
  }
  try {
    return await input.withSession({ requestCeiling: ENROLLED_PUBLICATION_READBACK_REQUESTS, operation: async (capability) => {
      const created = commentRecord(await executeGitHubApiOperation(capability, {
        kind: 'create-issue-comment', issueNumber: input.pullRequestNumber, body
      }));
      const readback = commentRecord(await executeGitHubApiOperation(capability, {
        kind: 'issue-comment', commentId: created.id
      }));
      if (readback.id !== created.id || readback.body !== body || readback.authorNodeId !== input.principalNodeId) {
        return Object.freeze({ status: 'ambiguous' as const, detail: 'published comment exact readback differs' });
      }
      return Object.freeze({ status: 'applied' as const, detail: `GitHub issue comment ${created.id} persisted and read back` });
    } });
  } catch (error) {
    return Object.freeze({ status: 'ambiguous', detail: `comment publication outcome is unknown and must not be retried: ${error instanceof Error ? error.message : String(error)}` });
  }
}

function compileLocalRefDeleteOperation(operationId: OperationDigest, local: boolean) {
  const deadlineAtUnixMs = Date.now() + LOCAL_EFFECT_DURATION_MS;
  const plan = compileSemanticOperationPlan({
    operation: 'control.branch-lifecycle.closed-unmerged-ref-delete', intentDigest: operationId,
    decisionDigest: LOCAL_EFFECT_CONTRACT, deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: operationId }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: LOCAL_EFFECT_DURATION_MS }, { resource: 'input-bytes', maximum: local ? 4096 : 0 },
      { resource: 'output-bytes', maximum: 1024 * 1024 }, { resource: 'processes', maximum: local ? 7 : 4 }
    ],
    requirements: [{ id: LOCAL_EFFECT_REQUIREMENT, contractDigest: LOCAL_EFFECT_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: ['filesystem.identity-drift', 'filesystem.write-failed', 'process.cancelled',
        'process.deadline-exhausted', 'process.output-budget-exhausted', 'process.settlement-unproven', 'process.unavailable'] }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({ requirementId: LOCAL_EFFECT_REQUIREMENT,
    contractDigest: LOCAL_EFFECT_CONTRACT, providerIdentityDigest: LOCAL_EFFECT_PROVIDER })]);
}

async function deleteLocalGitRef(input: Readonly<{
  repositoryRoot: string;
  operationId: OperationDigest;
  ref: string;
  expectedOldSha: string;
  coordinatedLease?: WorkspaceWriteLeaseToken;
}>): Promise<'deleted' | 'already-absent'> {
  const local = input.ref.startsWith('refs/heads/');
  const operation = compileLocalRefDeleteOperation(input.operationId, local);
  const processSession = openProcessResourceSession({ operation,
    requirementBindingContext: issueOperationRequirementBindingContext({ operation,
      requirementId: LOCAL_EFFECT_REQUIREMENT, resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  let disposition: 'deleted' | 'already-absent' | undefined;
  let primaryError: unknown;
  try {
    await withAuthorityGitReadSession({ cwd: input.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
      const executablePath = session.gitExecutableIdentity?.realPath;
      if (executablePath === undefined) throw new Error('Git read owner did not retain an executable identity.');
      const resolution = openGitPhysicalProvider({ cwd: input.repositoryRoot, executablePath, operation, processSession,
        environmentSource: process.env, maximumExecutableBytes: 128 * 1024 * 1024 });
      if (resolution.status !== 'ready') throw new Error(`Git physical provider unavailable: ${resolution.reason}`);
      let effectError: unknown;
      try {
        if (local) {
          if (input.coordinatedLease === undefined) throw new Error('Local ref deletion lacks a coordinated common-directory lease.');
          await deleteExactLocalGitRefs({ provider: resolution.capability, coordinatedLease: input.coordinatedLease,
            entries: [{ ref: input.ref, expectedOldSha: input.expectedOldSha }] });
          disposition = 'deleted';
        } else {
          disposition = (await deleteExactGitRef({ provider: resolution.capability, ref: input.ref,
            expectedOldSha: input.expectedOldSha })).disposition;
        }
      }
      catch (error) { effectError = error; }
      try { assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(resolution.capability), resolution.capability); }
      catch (error) { effectError ??= error; }
      if (effectError !== undefined) throw effectError;
    });
  } catch (error) { primaryError = error; }
  try {
    assertProcessResourceSessionReceipt(processSession.close(), { operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest, requirementId: LOCAL_EFFECT_REQUIREMENT });
  } catch (error) { primaryError ??= error; }
  if (primaryError !== undefined) throw primaryError;
  if (disposition === undefined) throw new Error('Git ref delete completed without a disposition.');
  return disposition;
}

async function assertRemoteTrackingRefAbsent(input: Readonly<{
  repositoryRoot: string;
  remote: string;
  branch: string;
}>): Promise<void> {
  const ref = `refs/remotes/${input.remote}/${input.branch}`;
  await withAuthorityGitReadSession({ cwd: input.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const result = await session.run(['for-each-ref', '--format=%(refname)', ref]);
    if (result.kind !== 'completed' || result.result.code !== 0) {
      throw new Error('Closed-unmerged tracking-ref retirement readback is unavailable.');
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(result.result.stdout).trim();
    if (source.length !== 0) {
      throw new Error('Closed-unmerged remote-tracking ref remains live after closeout.');
    }
  });
}

function createProductionClosedUnmergedCloseoutAdapter(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  targetBranch: string;
  preparedInventory: BranchLifecycleInventory;
  binding: WorkflowBinding;
  withSession: BoundGitHubSession;
  assertWorkflowCurrent(): void;
  assertWriteLease(): Promise<void>;
  coordinatedLease: WorkspaceWriteLeaseToken;
}>): ClosedUnmergedCloseoutEffectAdapter {
  const repositoryRoot = canonicalRoot(input.repositoryRoot);
  const binding = input.binding;
  if (binding.effect !== 'branch-closeout-write' || binding.repository !== input.repository) throw new Error('GitHub capability is not the exact branch-closeout write authority.');
  const providerIdentity = `github-api:${binding.principal.nodeId}`;
  const observeInventory = async (): Promise<ClosedUnmergedProviderObservation<BranchLifecycleInventory>> => {
    try {
      const [activeWorkPackageObservation, pull] = await Promise.all([
        observeActiveWorkPackage(repositoryRoot),
        input.withSession({ requestCeiling: ENROLLED_SINGLE_READ_REQUESTS, operation: (capability) => (
          observeProductionClosedUnmergedPullRequest({ capability, pullRequestNumber: input.pullRequestNumber })
        ) })
      ]);
      return Object.freeze({ status: 'observed', value: await collectBranchLifecycleCloseoutTargetInventory({
        repositoryRoot,
        repositoryFullName: input.repository,
        activeWorkPackageObservation,
        targetBranch: input.targetBranch,
        pullRequestNumber: input.pullRequestNumber,
        exactPullRequest: pull,
        preparedInventory: input.preparedInventory
      }) });
    } catch (error) { return Object.freeze({ status: 'unavailable', detail: error instanceof Error ? error.message : String(error) }); }
  };
  return Object.freeze<ClosedUnmergedCloseoutEffectAdapter>({
    providerIdentity, repository: input.repository, observeInventory,
    localRefDeleteCoordination: 'coordinated',
    observeEffectStart: (operationId) => observeMarked<ClosedUnmergedCloseoutEffectStartReceipt>({ withSession: input.withSession,
      pullRequestNumber: input.pullRequestNumber, operationId,
      marker: START_MARKER, principalNodeId: binding.principal.nodeId }),
    publishEffectStart: async (receipt) => { input.assertWorkflowCurrent(); await input.assertWriteLease(); return publishMarked({
      withSession: input.withSession, pullRequestNumber: input.pullRequestNumber,
      value: receipt, marker: START_MARKER, principalNodeId: binding.principal.nodeId }); },
    deleteRemoteRefCas: async (request) => {
      input.assertWorkflowCurrent();
      await input.assertWriteLease();
      if (request.repository !== input.repository) return Object.freeze({ status: 'rejected', detail: 'remote ref delete repository differs' });
      try {
        await input.withSession({ requestCeiling: ENROLLED_REMOTE_CAS_REQUESTS, operation: async (capability) => {
          await executeGitHubApiOperation(capability, { kind: 'delete-ref-cas', branch: request.branch, expectedOldSha: request.expectedOldSha });
        } });
        return Object.freeze({ status: 'applied', detail: 'GitHub updateRefs exact CAS deleted the head ref' });
      } catch (error) { return Object.freeze({ status: 'ambiguous', detail: `GitHub updateRefs outcome is unknown and must not be retried: ${error instanceof Error ? error.message : String(error)}` }); }
    },
    pruneRemote: async (request) => {
      input.assertWorkflowCurrent();
      await input.assertWriteLease();
      try {
        const disposition = await deleteLocalGitRef({ repositoryRoot, operationId: request.operationId,
          ref: `refs/remotes/${request.remote}/${request.branch}`, expectedOldSha: request.expectedOldSha });
        return Object.freeze({ status: disposition === 'deleted' ? 'applied' : 'already-applied', detail: `remote-tracking ref ${disposition}` });
      } catch (error) { return Object.freeze({ status: 'ambiguous', detail: error instanceof Error ? error.message : String(error) }); }
    },
    deleteLocalRefCas: async (request) => {
      input.assertWorkflowCurrent();
      await input.assertWriteLease();
      try {
        await settleDevelopmentCommitJournalsForRef({ repositoryRoot, ref: `refs/heads/${request.branch}` });
        input.assertWorkflowCurrent();
        await input.assertWriteLease();
        const disposition = await deleteLocalGitRef({ repositoryRoot, operationId: request.operationId,
          ref: `refs/heads/${request.branch}`, expectedOldSha: request.expectedOldSha,
          coordinatedLease: input.coordinatedLease });
        return Object.freeze({ status: disposition === 'deleted' ? 'applied' : 'already-applied', detail: `local topic ref ${disposition}` });
      } catch (error) { return Object.freeze({ status: 'ambiguous', detail: error instanceof Error ? error.message : String(error) }); }
    },
    observeTerminalReceipt: (operationId) => observeMarked<ClosedUnmergedTerminal>({ withSession: input.withSession,
      pullRequestNumber: input.pullRequestNumber, operationId,
      marker: TERMINAL_MARKER, principalNodeId: binding.principal.nodeId }),
    publishTerminalReceipt: async (terminal) => { input.assertWorkflowCurrent(); await input.assertWriteLease(); return publishMarked({
      withSession: input.withSession, pullRequestNumber: input.pullRequestNumber,
      value: terminal, marker: TERMINAL_MARKER, principalNodeId: binding.principal.nodeId }); }
  });
}

export async function executeProductionClosedUnmergedCloseout(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  compileOperation(context: ProductionClosedUnmergedCompileContext): Promise<ClosedUnmergedCloseoutOperation>;
}>): Promise<ClosedUnmergedCloseoutExecutionResult> {
  const repositoryRoot = canonicalRoot(input.repositoryRoot);
  const workflow = createWorkflowSessions({ repositoryRoot, repository: input.repository });
  const operation = await input.compileOperation(workflow.context);
  const commonDir = canonicalRoot(operation.prepared.preparation.repository.commonDir);
  return withWorkspaceWriteLease(commonDir, undefined, (coordinatedLease) => (
    withWorkspaceWriteLease(repositoryRoot, undefined, async (lease) => {
    const assertBothLeases = async () => {
      await assertWorkspaceWriteLease(commonDir, coordinatedLease);
      await assertWorkspaceWriteLease(repositoryRoot, lease);
    };
    await assertBothLeases();
    if (operation.prepared.preparation.pullRequestStateAtPreparation !== 'closed') {
      throw new Error('Production closed-unmerged closeout requires an already-closed PR preparation.');
    }
    const completed = await executeClosedUnmergedCloseoutOperation({ operation,
      provider: issueClosedUnmergedCloseoutEffectProvider(createProductionClosedUnmergedCloseoutAdapter({
        repositoryRoot, repository: input.repository, pullRequestNumber: operation.evidence.pullRequestNumber,
        targetBranch: operation.evidence.branch,
        preparedInventory: operation.prepared.before,
        binding: workflow.binding(), withSession: workflow.withSession,
        assertWorkflowCurrent: workflow.assertCurrent,
        assertWriteLease: assertBothLeases,
        coordinatedLease
      })) });
    if (completed.status !== 'completed') return completed;
    workflow.assertCurrent();
    await assertBothLeases();
    await assertRemoteTrackingRefAbsent({ repositoryRoot,
      remote: operation.prepared.preparation.repository.remote,
      branch: operation.evidence.branch });
    let retirement: Awaited<ReturnType<typeof retireClosedUnmergedRecoveryFamily>>;
    try {
      retirement = await workflow.withSession({ requestCeiling: ENROLLED_RETIREMENT_REQUESTS, operation: (capability) => (
        retireClosedUnmergedRecoveryFamily({ operation, completed, capability })
      ) });
    } catch (error) {
      return Object.freeze({ status: 'preserved' as const, operationId: operation.operationId,
        stage: 'recovery-retirement', reasons: Object.freeze([
          error instanceof Error ? error.message : String(error)
        ]) });
    }
    if (retirement.status === 'partial') {
      return Object.freeze({ status: 'preserved' as const, operationId: operation.operationId,
        stage: 'recovery-retirement', reasons: Object.freeze([
          retirement.failure ?? 'closed-unmerged recovery family remains partially retained',
          ...retirement.retained
        ]) });
    }
    return completed;
    })
  ));
}


export interface ProductionClosedUnmergedRetirementRequest {
  readonly repositoryRoot: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly reviewCommentId: number | null;
}

/**
 * Production closeout owner. Caller input selects only the repository/PR
 * subject and, when native retention is impossible, one review-evidence
 * locator. The retention security path itself is derived from live repository
 * facts; callers cannot supply a preparation artifact or choose its kind.
 */
export async function executeProductionClosedUnmergedRetirement(
  input: Readonly<ProductionClosedUnmergedRetirementRequest>
): Promise<ClosedUnmergedCloseoutExecutionResult> {
  const repositoryRoot = canonicalRoot(input.repositoryRoot);
  return executeProductionClosedUnmergedCloseout({
    repositoryRoot,
    repository: input.repository,
    compileOperation: async (context) => {
      const pull = await context.observePullRequest(input.pullRequestNumber);
      if (pull.state !== 'closed' || pull.headSha === null || pull.baseSha == null) {
        throw new Error('closed-superseded production closeout requires one exact closed PR with complete head/base identity');
      }
      const headRef = await context.observeHeadRef(pull.headBranch);
      if (headRef.state === 'present' && headRef.sha !== pull.headSha) {
        throw new Error('current remote head ref differs from the exact closed PR head');
      }
      const scope = {
        repositoryRoot,
        repositoryFullName: input.repository,
        activeWorkPackageObservation: await observeActiveWorkPackage(repositoryRoot)
      };
      const request = {
        number: pull.number,
        refState: headRef.state,
        headBranch: pull.headBranch,
        headSha: pull.headSha,
        baseBranch: pull.baseBranch,
        baseSha: pull.baseSha,
        exactPullRequest: pull
      } as const;

      const mainRef = await context.observeHeadRef(pull.baseBranch);
      if (mainRef.state !== 'present') {
        throw new Error('Closed-unmerged retention requires the exact current base ref.');
      }

      let evidence = await tryCreateClosedNativeAbsorptionDispositionEvidence({
        repositoryRoot,
        repository: input.repository,
        pullRequestNumber: pull.number,
        branch: pull.headBranch,
        headSha: pull.headSha,
        baseBranch: pull.baseBranch,
        baseSha: pull.baseSha,
        currentMainSha: mainRef.sha
      });

      let prepared: PreparedBranchCloseoutEnvelope;
      if (evidence !== null) {
        prepared = await context.observeCompletedPreparation(pull.number, evidence.evidenceDigest)
          ?? await prepareClosedUnmergedPullRequestCloseout(scope, request);
      } else {
        if (input.reviewCommentId === null) {
          throw new Error('Closed-unmerged distinct-tree retirement requires one adopted review comment.');
        }
        const supersession = await context.observeSupersessionEvidence({
          pullRequestNumber: pull.number,
          commentId: input.reviewCommentId
        });
        evidence = createClosedSupersededDispositionEvidence({
          repository: input.repository,
          pullRequestNumber: pull.number,
          branch: pull.headBranch,
          headSha: pull.headSha,
          headTreeSha: supersession.review.headTreeSha,
          baseBranch: pull.baseBranch,
          baseSha: pull.baseSha,
          currentMainSha: supersession.review.currentMainSha,
          currentMainTreeSha: supersession.review.currentMainTreeSha,
          durableGoal: { kind: 'evidence', reference: supersession.reference },
          supersession
        });
        prepared = await context.observeCompletedPreparation(pull.number, evidence.evidenceDigest)
          ?? await prepareClosedUnmergedPullRequestCloseout(scope, {
            ...request,
            reviewEvidence: supersession
          });
      }

      if (prepared.before.repository.fullName !== input.repository
          || prepared.before.repository.defaultBranch !== pull.baseBranch
          || prepared.before.main.remoteSha !== evidence.currentMainSha) {
        throw new Error('prepared repository/main identity differs from the exact retention evidence');
      }
      const compiled = compileClosedUnmergedCloseoutOperation({ prepared, evidence });
      if (compiled.status !== 'ready') {
        throw new Error(`closed-unmerged operation compilation blocked: ${compiled.blockers.join(' | ')}`);
      }
      return compiled.operation;
    }
  });
}

/** Re-observe one exact adopted review through the existing bounded GitHub owner. */
export async function observeProductionClosedSupersessionEvidence(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  commentId: number;
}>): Promise<ClosedSupersessionEvidence> {
  const workflow = createWorkflowSessions({ repositoryRoot: canonicalRoot(input.repositoryRoot),
    repository: input.repository });
  return workflow.context.observeSupersessionEvidence({
    pullRequestNumber: input.pullRequestNumber, commentId: input.commentId
  });
}
