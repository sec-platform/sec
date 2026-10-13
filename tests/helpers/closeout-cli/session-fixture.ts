import { expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBranchCloseoutOperationBinding, createBranchCloseoutPreparation } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { CodexDevelopmentEvaluateMergeGate } from '../../../src/adapters/self-hosting/control/integration/merge-gate.ts';
import { INTEGRATION_AUTHORIZATION_STATUS_CONTEXT } from '../../../src/adapters/self-hosting/control/main-health/authority-ruleset.ts';
import { createMainHealthLedger } from '../../../src/adapters/self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import { createScopeAuthorization } from '../../../src/adapters/self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT } from '../../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../src/adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentFinalizeVerificationEvidenceV4, CodexDevelopmentFinalizeVerificationSessionArtifact } from '../../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { bindDocumentationVerificationGateInput } from '../../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA, VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA } from '../../../src/adapters/verification/platform/ci/contract/session-request.ts';
import { createVerificationSessionGitHubClient, evaluateMaintainerReviewWakeupObservation, evaluatePlatformEnforcementObservation, evaluateReviewProviderAvailabilityObservation, evaluateVerificationSessionReviewObservation, PROVIDER_SCHEMA_UNSUPPORTED_STATUS, VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER, type GitHubAppReviewCommentObservation, type GitHubCommitResolutionObservation, type GitHubIssueCommentObservation, type GitHubPage, type GitHubReviewObservation, type GitHubReviewRequestObservation, type GitHubReviewThreadObservation, type VerificationSessionGitHubClient, type VerificationSessionReviewObservationTransaction, type VerificationSessionWorkflowObservationTransaction } from '../../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { createEphemeralVerificationSessionJournalFs } from '../../../src/adapters/verification/platform/ci/runtime/verification-session-journal.ts';
import { createHostedArtifactObservation, createTrustedHostedArtifactProvenance, createTrustedIntegrationAuthorizationArtifact, createVerificationSessionMergeOperationId, integrationAuthorizationMergeMarkers, prepareTrustedMainVerificationSession, prepareVerificationSessionMergeInput, reconstructVerificationSessionHostedFacts, type VerificationSessionRuntimeExternal } from '../../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { createReviewStabilityReceipt, renderIndependentReviewTrailer, SEC_REVIEW_STABILITY_POLICY } from '../../../src/adapters/verification/platform/review/contract/stability.ts';
import { createVerificationSession } from '../../../src/adapters/verification/platform/session/contract/session.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation, type CodexDevelopmentTestImpactTransitionObservation } from '../../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { CodexDevelopmentBuildVerificationGateResult } from '../../../src/assurance/verification/result/contract/result.ts';
import { settleResources } from '../../../src/execution/resource-settlement.ts';
import type { VerificationSessionHostedEnvelope, VerificationSessionHostedFacts, VerificationSessionHostedRequest } from '../../../src/execution/verification/hosted.ts';
import type { MergeGateResult } from '../../../src/execution/verification/integration.ts';
import type { GitHubCandidateObservation, GitHubCheckObservation, GitHubComparisonObservation, GitHubReviewBarrierObservation, GitHubWorkflowRunObservation, ScopeAuthorization, SessionDigest, VerificationSession } from '../../../src/execution/verification/session.ts';
import { createRawTestExecutableFixture } from '../../testkit/raw-process.ts';

export const HEAD = '2222222222222222222222222222222222222222';
export const BASE = '1111111111111111111111111111111111111111';
export const BOT = 'BOT_kgDOC98s_g';
export const PAGE = `sha256:${'a'.repeat(64)}` as const;
export const JOIN_SESSION = `sha256:${'6'.repeat(64)}` as const;


export function createVerificationSessionFixtureSupport(
  getTestImpactSourceProvider: () => ReturnType<typeof bindDocumentationVerificationGateInput>
) {
function changedTransition(
  changedPaths: readonly string[],
  baseSha = BASE,
  headSha = HEAD
): CodexDevelopmentTestImpactTransitionObservation {
  return CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: changedPaths.map((changedPath) => ({ status: 'changed' as const, path: changedPath })),
    readPathBlob: () => null
  });
}

function workflowRun(overrides: Partial<GitHubWorkflowRunObservation> = {}): GitHubWorkflowRunObservation {
  const displayTitle = `verify session PR #42 session ${JOIN_SESSION}`;
  return { id: '10', name: displayTitle, displayTitle,
    workflowPath: '.github/workflows/compiler-pr-validation.yml', event: 'repository_dispatch',
    status: 'in_progress', conclusion: null, headSha: BASE, runAttempt: 1,
    updatedAt: '2026-08-09T14:00:00.000Z', ...overrides };
}

function page<T>(nodes: readonly T[], hasNextPage = false, endCursor: string | null = null): GitHubPage<T> {
  return { nodes, hasNextPage, endCursor, pageDigest: PAGE };
}

class FakeTransport implements VerificationSessionReviewObservationTransaction,
  VerificationSessionWorkflowObservationTransaction {
  reviews: GitHubReviewObservation[][] = [[]];
  threads: GitHubReviewThreadObservation[][] = [[]];
  requests: GitHubReviewRequestObservation[][] = [[]];
  comments: GitHubAppReviewCommentObservation[][] = [[]];
  issueComments: GitHubIssueCommentObservation[][] = [[]];
  repositoryIssueComments: GitHubIssueCommentObservation[][] = [[]];
  workflowRuns: GitHubWorkflowRunObservation[][] = [[]];
  resolutions = new Map<string, GitHubCommitResolutionObservation>();
  reviewRequests = 0;
  dispatches = 0;
  rulesetError: Error & { statusCode?: number } | null = null;
  collaboratorPermissions = new Map<string, 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none'>();

  candidate(): GitHubCandidateObservation {
    return {
      repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
      isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE,
      baseTreeSha: BASE, headBranch: 'feat/example', headSha: HEAD, headTreeSha: HEAD,
      title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
      mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null,
      mergeCommitParentShas: null
    };
  }
  private at<T>(pages: T[][], after: string | null, digestCharacter: string): GitHubPage<T> {
    const index = after === null ? 0 : Number(after);
    const next = index + 1 < pages.length ? String(index + 1) : null;
    return { ...page(pages[index] ?? [], next !== null, next),
      pageDigest: `sha256:${digestCharacter.repeat(64).slice(0, 64)}` as SessionDigest };
  }
  reviewPage(_r: string, _p: number, after: string | null): GitHubPage<GitHubReviewObservation> { return this.at(this.reviews, after, 'a'); }
  threadPage(_r: string, _p: number, after: string | null): GitHubPage<GitHubReviewThreadObservation> { return this.at(this.threads, after, 'b'); }
  reviewRequestPage(_r: string, _p: number, after: string | null): GitHubPage<GitHubReviewRequestObservation> { return this.at(this.requests, after, 'c'); }
  appCommentPage(_r: string, _p: number, after: string | null): GitHubPage<GitHubAppReviewCommentObservation> { return this.at(this.comments, after, 'd'); }
  issueCommentPage(_r: string, _p: number, after: string | null): GitHubPage<GitHubIssueCommentObservation> { return this.at(this.issueComments, after, 'e'); }
  repositoryIssueCommentPage(_r: string, after: string | null): GitHubPage<GitHubIssueCommentObservation> {
    return this.at(this.repositoryIssueComments, after, '9');
  }
  resolveCommitOid(repository: string, locator: string): GitHubCommitResolutionObservation {
    const configured = this.resolutions.get(locator);
    if (configured !== undefined) return configured;
    const commitSha = HEAD.startsWith(locator) ? HEAD : locator.padEnd(40, locator.at(-1) ?? '0').slice(0, 40);
    return { repository, locator, status: 'resolved', commitSha, treeSha: commitSha,
      responseDigest: `sha256:${'f'.repeat(64)}` };
  }
  collaboratorPermission(_repository: string, login: string) {
    return this.collaboratorPermissions.get(login) ?? 'admin';
  }
  principalByNodeId(_repository: string, nodeId: string) {
    return { login: nodeId === BOT ? 'codex-review-bot' : 'integrator', nodeId,
      permission: 'maintain' as const };
  }
  checkPage(): GitHubPage<GitHubCheckObservation> { return page([]); }
  workflowRunPage(_r: string, _h: string, after: string | null): GitHubPage<GitHubWorkflowRunObservation> {
    return this.at(this.workflowRuns, after, '7');
  }
  repositoryRulesets(): unknown {
    if (this.rulesetError) throw this.rulesetError;
    const authorityId = 42;
    const principalId = 43;
    const requiredStatus = {
      required_status_checks: [{
        context: INTEGRATION_AUTHORIZATION_STATUS_CONTEXT,
        integration_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id
      }],
      strict_required_status_checks_policy: true
    };
    const update = { update_allows_fetch_and_merge: false };
    return {
      defaultBranch: 'main',
      effectiveRules: [
        { type: 'pull_request', ruleset_id: authorityId },
        { type: 'deletion', ruleset_id: authorityId },
        { type: 'non_fast_forward', ruleset_id: authorityId },
        { type: 'required_status_checks', ruleset_id: authorityId, parameters: requiredStatus },
        { type: 'update', ruleset_id: principalId, parameters: update }
      ],
      detailedRulesets: [{
        id: authorityId,
        name: 'SEC main authority',
        target: 'branch',
        source_type: 'Repository',
        source: 'sec-platform/sec',
        enforcement: 'active',
        bypass_actors: [],
        conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
        rules: [
          { type: 'pull_request' },
          { type: 'deletion' },
          { type: 'non_fast_forward' },
          { type: 'required_status_checks', parameters: requiredStatus }
        ]
      }, {
        id: principalId,
        name: 'SEC integration principal',
        target: 'branch',
        source_type: 'Repository',
        source: 'sec-platform/sec',
        enforcement: 'active',
        bypass_actors: [{
          actor_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id,
          actor_type: 'Integration',
          bypass_mode: 'pull_request'
        }],
        conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
        rules: [{ type: 'update', parameters: update }]
      }]
    };
  }
  comparison(_repository: string, _baseSha: string, _headSha: string): GitHubComparisonObservation {
    return { status: 'ahead', behindBy: 0 };
  }
  ensureVerificationSessionWakeup(): void { this.dispatches += 1; }
}

class ReducerTransport extends FakeTransport {
  observation = super.candidate();
  mergedTreeSha = HEAD;
  comparisons = new Map<string, GitHubComparisonObservation>();

  override candidate(): GitHubCandidateObservation { return { ...this.observation }; }

  override comparison(_repository: string, baseSha: string, headSha: string): GitHubComparisonObservation {
    return this.comparisons.get(`${baseSha}...${headSha}`) ?? { status: 'ahead', behindBy: 0 };
  }

  adoptMerged(markers: readonly string[], reviewReceipt: ReturnType<typeof createReviewStabilityReceipt>,
    sessionRevision: `sha256:${string}`): void {
    this.observation = {
      ...this.observation,
      state: 'MERGED',
      mergeCommitSha: '9'.repeat(40),
      mergeCommitTreeSha: this.mergedTreeSha,
      mergeCommitParentShas: Object.freeze([this.observation.baseSha]),
      mergeCommitMessage: `Verified integration ${sessionRevision.slice(7, 19)}\n\n${markers.join('\n')}\n${
        renderIndependentReviewTrailer(reviewReceipt)}`
    };
  }
}

function botIssueComment(body = `Codex Review: Didn't find any major issues. Bravo.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
  overrides: Partial<GitHubIssueCommentObservation> = {}): GitHubIssueCommentObservation {
  return { id: '101', body, authorLogin: 'codex-review[bot]', authorId: 101,
    authorNodeId: BOT, authorType: 'Bot',
    performedViaGitHubApp: { id: 1144995, nodeId: 'A_kwHOAOQ6Gs4AEXij',
      slug: 'chatgpt-codex-connector' },
    createdAt: '2026-08-09T14:00:00.000Z', ...overrides };
}

function actionsIssueComment(body: string, id = '101'): GitHubIssueCommentObservation {
  return botIssueComment(body, {
    id,
    authorLogin: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login,
    authorId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.id,
    authorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId,
    authorType: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.type,
    performedViaGitHubApp: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app
  });
}

function maintainerIssueComment(body: string, id = '201', overrides: Partial<
  GitHubIssueCommentObservation> = {}): GitHubIssueCommentObservation {
  return botIssueComment(body, {
    id,
    authorLogin: 'maintainer',
    authorId: 501,
    authorNodeId: 'MAINTAINER_NODE',
    authorType: 'User',
    performedViaGitHubApp: null,
    ...overrides
  });
}

let defaultReviewWakeupBodyCache = '';

async function defaultReviewWakeupBody(): Promise<string> {
  if (defaultReviewWakeupBodyCache !== '') return defaultReviewWakeupBodyCache;
  const transport = new FakeTransport();
  transport.issueComments = [[]];
  defaultReviewWakeupBodyCache = (await evaluateMaintainerReviewWakeupObservation(transport, {
    repository: 'sec-platform/sec',
    sessionRevision: `sha256:${'1'.repeat(64)}`,
    operationId: `sha256:${'2'.repeat(64)}`,
    requestOperationId: `sha256:${'3'.repeat(64)}`,
    prNumber: 42,
    headSha: HEAD,
    headTreeSha: HEAD,
    publisherLogin: 'maintainer',
    publisherNodeId: 'MAINTAINER_NODE'
  })).body;
  return defaultReviewWakeupBodyCache;
}

async function ensureBoundReviewWakeup(transport: FakeTransport): Promise<void> {
  if (transport.issueComments.flat().some(({ body }) =>
    body.includes(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER))) return;
  const first = transport.issueComments[0] ?? [];
  transport.issueComments[0] = [
    maintainerIssueComment((await defaultReviewWakeupBody()), '99'),
    ...first
  ];
}

async function observe(transport: FakeTransport, bindWakeup = true) {
  if (bindWakeup) await ensureBoundReviewWakeup(transport);
  return (await evaluateVerificationSessionReviewObservation(transport, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
    observedAt: '2026-08-09T14:01:00.000Z'
  }));
}

function expectTypedProviderSchemaUnsupported(observation: GitHubReviewBarrierObservation): void {
  expect(observation).toMatchObject({ status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
    reasonCode: 'github-provider-response-shape-unsupported' });
  if (observation.status !== PROVIDER_SCHEMA_UNSUPPORTED_STATUS) {
    throw new Error('expected typed provider schema rejection');
  }
  expect(observation.responseDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
}

let privateGhProxySuiteRoot = '';

function privateGhProxyRoot(): string {
  if (privateGhProxySuiteRoot !== '') return privateGhProxySuiteRoot;
  privateGhProxySuiteRoot = mkdtempSync(path.join(tmpdir(), 'sec-private-gh-token-'));
  const source = path.join(privateGhProxySuiteRoot, 'credential.ts');
  const output = path.join(privateGhProxySuiteRoot, process.platform === 'win32' ? 'gh.exe' : 'gh');
  writeFileSync(source, `if (process.argv.slice(-4).join(' ') !== 'auth token --hostname github.com') process.exit(1); process.stdout.write('ghp_private_fixture_token_000000000000');`, 'utf8');
  const runtime = createRawTestExecutableFixture();
  try {
    const compiled = spawnSync(runtime.command, ['build','--compile',`--compile-executable-path=${runtime.command}`,source,'--outfile',output],
      {cwd:privateGhProxySuiteRoot,encoding:'utf8',windowsHide:true,timeout:30_000});
    if (compiled.status !== 0) throw new Error('Private credential fixture compilation failed');
  } finally { runtime.dispose(); }
  return privateGhProxySuiteRoot;
}

async function withPrivateGitHubHttp<T>(
  respond: (url: URL, init: RequestInit | undefined) => unknown,
  operation: (root: string) => Promise<T>
): Promise<T> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-private-github-http-'));
  const previousPath = process.env.PATH;
  const previousFetch = globalThis.fetch;
  process.env.PATH = `${privateGhProxyRoot()}${path.delimiter}${previousPath ?? ''}`;
  globalThis.fetch = (async (target: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof target === 'string' || target instanceof URL ? target : target.url);
    if (url.origin !== 'https://api.github.com') throw new Error('Fixture received a foreign host');
    const value = url.pathname === '/user'
      ? {login:'enrollment',node_id:'ENROLLMENT',id:1}
      : url.pathname.endsWith('/collaborators/enrollment/permission') ? {permission:'maintain'}
      : respond(url, init);
    return new Response(typeof value === 'string' ? value : JSON.stringify(value),
      {status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  try { return await operation(root); }
  finally {
    globalThis.fetch = previousFetch;
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    rmSync(root,{recursive:true,force:true});
  }
}

async function observePrivateGhProviderBarrier(
  mode: 'clear' | 'candidate' | 'permission' | 'trusted-app' | 'review-post-normalization'
    | 'thread-post-normalization' | 'request-post-normalization' | 'issue-post-normalization',
  malformedSource: string,
  observedAt = '2026-08-09T14:01:00.000Z'
) {
  const terminal = {hasNextPage:false,endCursor:null};
  const candidate = {number:42,state:'open',merged:false,draft:false,
    user:{node_id:'AUTHOR'}, base:{ref:'main',sha:BASE,repo:{full_name:'sec-platform/sec'}},
    head:{ref:'feature/provider-shape',sha:HEAD,repo:{full_name:'sec-platform/sec'}},
    title:'Safe provider shape candidate',body:'',merge_commit_sha:null};
  return await withPrivateGitHubHttp((url,init) => {
    const endpoint = url.pathname;
    if (endpoint === '/repos/sec-platform/sec/pulls/42') return candidate;
    if (endpoint.includes('/git/commits/')) return {tree:{sha:endpoint.endsWith(BASE)
      ? mode === 'candidate' ? malformedSource : BASE : HEAD}};
    if (endpoint === '/graphql') {
      const query = JSON.parse(String(init?.body)).query as string;
      const page = (connection: unknown) => ({data:{repository:{pullRequest:connection}}});
      if (query.includes('closingIssuesReferences(first:100')) return page({number:42,title:candidate.title,
        body:'',state:'OPEN',mergeCommit:null,closingIssuesReferences:{totalCount:0,nodes:[],pageInfo:terminal}});
      if (query.includes('reviews(first')) return page({reviews:{nodes:[{id:'R1',
        state:mode === 'review-post-normalization' ? malformedSource : 'APPROVED',
        submittedAt:'2026-08-09T14:00:00.000Z',commit:{oid:HEAD},
        author:mode === 'trusted-app' ? {__typename:'Bot',id:BOT,login:'codex-review[bot]',resourcePath:'/apps/chatgpt-codex-connector'}
          : {__typename:'User',id:'REVIEWER',login:'reviewer',resourcePath:'/reviewer'}}],pageInfo:terminal}});
      if (query.includes('reviewThreads(first')) return page({reviewThreads:{nodes:mode === 'thread-post-normalization'
        ? [{id:'T1',isResolved:malformedSource,isOutdated:false,path:'src/example.ts',comments:{nodes:[],pageInfo:terminal}}] : [],pageInfo:terminal}});
      if (query.includes('reviewRequests(first')) return page({reviewRequests:{nodes:mode === 'request-post-normalization'
        ? [{requestedReviewer:{id:'USER_request',login:malformedSource}}] : [],pageInfo:terminal}});
    }
    if (endpoint === '/apps/chatgpt-codex-connector') return mode === 'trusted-app' ? malformedSource
      : {id:1144995,node_id:'A_kwHOAOQ6Gs4AEXij',slug:'chatgpt-codex-connector'};
    if (endpoint.endsWith('/permission')) return {permission:mode === 'permission' ? malformedSource : 'maintain'};
    if (endpoint.endsWith('/issues/42/comments')) return mode === 'issue-post-normalization' ? [
      {id:101,body:malformedSource,created_at:'2026-08-09T14:00:00.000Z',user:{login:'reviewer',id:7,node_id:'USER_reviewer',type:'User'},performed_via_github_app:null},
      {id:101,body:'duplicate',created_at:'2026-08-09T14:00:01.000Z',user:{login:'reviewer',id:7,node_id:'USER_reviewer',type:'User'},performed_via_github_app:null}
    ] : [];
    throw new Error('Unsupported private HTTP fixture operation');
  }, async root => await createVerificationSessionGitHubClient(root,'sec-platform/sec').observeReviewBarrier({
    repository:'sec-platform/sec',prNumber:42,headSha:HEAD,
    excludedPrincipalNodeIds:new Set(['AUTHOR','INTEGRATOR']),observedAt
  }));
}

async function observePrivateMergedCandidate(parentShas: readonly string[]): Promise<GitHubCandidateObservation> {
  const mergeCommitSha = '9'.repeat(40);
  return await withPrivateGitHubHttp(url => {
    if (url.pathname.endsWith('/pulls/42')) return {number:42,state:'closed',merged:true,draft:false,
      user:{node_id:'AUTHOR'},base:{ref:'main',sha:BASE,repo:{full_name:'sec-platform/sec'}},
      head:{ref:'feature',sha:HEAD,repo:{full_name:'sec-platform/sec'}},title:'Merged',body:'',merge_commit_sha:mergeCommitSha};
    if (url.pathname.endsWith(mergeCommitSha)) return {tree:{sha:HEAD},message:'merge',parents:parentShas.map(sha=>({sha}))};
    if (url.pathname.includes('/git/commits/')) return {tree:{sha:url.pathname.endsWith(BASE) ? BASE : HEAD}};
    throw new Error('Unsupported merged HTTP fixture operation');
  }, async root => await createVerificationSessionGitHubClient(root,'sec-platform/sec').observeCandidate('sec-platform/sec',42));
}

const privateClearReviewBarriers = new Map<string,
  Extract<GitHubReviewBarrierObservation, { status: 'clear' }>>();

async function observePrivateClearReviewBarrier(observedAt: string): Promise<Extract<GitHubReviewBarrierObservation, { status: 'clear' }>> {
  const cached = privateClearReviewBarriers.get(observedAt);
  if (cached !== undefined) return cached;
  const barrier = (await observePrivateGhProviderBarrier('clear', '', observedAt));
  if (barrier.status !== 'clear') throw new Error('production private adapter fixture Review must be clear');
  privateClearReviewBarriers.set(observedAt, barrier);
  return barrier;
}

function fakeGitHubClient(
  transport: FakeTransport,
  observePrivateBarrier?: (input: Parameters<VerificationSessionGitHubClient['observeReviewBarrier']>[0]) => GitHubReviewBarrierObservation | Promise<GitHubReviewBarrierObservation>
): VerificationSessionGitHubClient {
  const client: Pick<VerificationSessionGitHubClient,
    'observeCandidate' | 'observeReviewBarrier' | 'observeReviewProviderAvailability'
    | 'observePrincipalByNodeId' | 'observePlatformEnforcement' | 'observeComparison'
    | 'ensureVerificationSessionWakeup'> = {
    observeCandidate: async () => transport.candidate(),
    observeReviewBarrier: async (input) => observePrivateBarrier?.(input)
      ?? (await evaluateVerificationSessionReviewObservation(transport, input)),
    observeReviewProviderAvailability: async (input) =>
      (await evaluateReviewProviderAvailabilityObservation(transport, input)),
    observePrincipalByNodeId: async (repository, nodeId) => transport.principalByNodeId(repository, nodeId),
    observePlatformEnforcement: async (repository) => (await evaluatePlatformEnforcementObservation({
      repository,
      readRulesets: () => transport.repositoryRulesets()
    })),
    observeComparison: async (repository, baseSha, headSha) => transport.comparison(repository, baseSha, headSha),
    ensureVerificationSessionWakeup: async () => transport.ensureVerificationSessionWakeup()
  };
  return client as unknown as VerificationSessionGitHubClient;
}

function mainHealthCheck(overrides: Partial<GitHubCheckObservation> = {}): GitHubCheckObservation {
  const eventName = overrides.eventName ?? CI_MAIN_HEALTH_POLICY.producer.eventNames[0];
  const workflowRunDisplayTitle = CI_MAIN_HEALTH_POLICY.producer.runTitleFormats.repositoryDispatch
    .replace('<exact-main-sha>', BASE)
    .replace('<request-operation-id>', createCiMainHealthRequestOperationId(BASE));
  return {
    id: 7, name: CI_MAIN_HEALTH_POLICY.context, status: 'completed', conclusion: 'success',
    headSha: BASE, detailsUrl: 'https://github.example/actions/runs/7', appId: CI_MAIN_HEALTH_POLICY.app.id,
    appNodeId: CI_MAIN_HEALTH_POLICY.app.nodeId, appSlug: CI_MAIN_HEALTH_POLICY.app.slug,
    workflowPath: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
    workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${BASE}`,
    eventName,
    workflowRunId: '7',
    workflowRunDisplayTitle,
    ...overrides
  };
}

const V6_MANIFEST_PATH = 'config/repository/work-packages/verification-action-trusted-cutover-v6.md';
const V6_MANIFEST_DIGEST = 'sha256:decaeacc27a8cc249f524736e16a3bfc407fff72adc7932233ce0dff5c57d16f' as const;
const VERIFIED_AT = '2026-08-09T14:01:00.000Z';
const MERGE_AT = '2026-08-09T14:05:00.000Z';

function actionDependencyBlobs(driftPath?: (typeof CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS)[number]) {
  return CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath) => ({
    path: dependencyPath,
    baseSource: `exact dependency bytes for ${dependencyPath}\n`,
    candidateSource: driftPath === dependencyPath
      ? `drifted dependency bytes for ${dependencyPath}\n`
      : `exact dependency bytes for ${dependencyPath}\n`
  }));
}

/**
 * Pure downstream fixture only: it deliberately uses the public receipt and
 * session contracts, never the production adapter WeakSet or hosted prepare
 * issuance path. Authority issuance is covered solely by the negative test.
 */
function createPureReviewFixture(input: {
  stage: 'pre-expensive' | 'pre-merge';
  session: VerificationSession;
  scope: ScopeAuthorization;
  barrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
  candidateAuthorNodeId: string;
  integrationPrincipalNodeId: string;
  expiresAt: string;
  operationId: `sha256:${string}`;
}) {
  return createReviewStabilityReceipt({
    stage: input.stage, repository: input.session.repository, prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision,
    scopeAuthorizationRevision: input.scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: input.scope.authorizationDigest,
    headSha: input.session.headSha, headTreeSha: input.session.headTreeSha,
    policy: SEC_REVIEW_STABILITY_POLICY, principal: input.barrier.principal,
    independence: { candidateAuthorNodeId: input.candidateAuthorNodeId,
      integrationPrincipalNodeId: input.integrationPrincipalNodeId },
    producer: {
      identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: input.barrier.authority.executionIdentity,
      providerIdentity: input.barrier.authority.providerIdentity,
      candidateWriteCapability: input.barrier.authority.candidateWriteCapability,
      capabilityReceiptDigest: input.barrier.authority.capabilityReceiptDigest,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY.trustedRevision,
      sourceTransport: input.barrier.authority.sourceTransport,
      sourceRunId: input.operationId,
      sourceRef: `github://${input.session.repository}/pull/${input.session.prNumber}@${input.session.headSha}`,
      sourceDigest: input.barrier.authority.sourceDigest
    },
    snapshot: input.barrier.snapshot, reviewedAt: input.barrier.observedAt, expiresAt: input.expiresAt
  });
}

function createPureHostedEnvelopeFixture(input: {
  request: VerificationSessionHostedRequest<typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA>;
  facts: VerificationSessionHostedFacts;
}): VerificationSessionHostedEnvelope<typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA> {
  const { request, facts } = input;
  const scopeAuthorization = createScopeAuthorization({
    repository: facts.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    proposalDigest: request.expectedScopeProposalDigest, authorizedPaths: facts.authorizedPaths,
    sessionProposalDigest: facts.sessionProposalDigest,
    actionPlanClosureDigest: facts.actionPlanClosure.actionPlanDigest, profile: request.profile,
    environmentDigest: facts.environmentDigest, issuer: facts.scopeIssuer,
    issuedAt: facts.scopeIssuedAt, expiresAt: facts.scopeExpiresAt
  });
  const mainHealth = createMainHealthLedger(facts.mainHealth);
  const session = createVerificationSession({
    sessionId: facts.sessionId, createdAt: facts.createdAt, repository: facts.repository,
    prNumber: request.prNumber, baseSha: request.expectedBaseSha,
    baseTreeSha: request.expectedBaseTreeSha, headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha, manifestPath: request.manifestPath,
    manifestDigest: request.manifestDigest, sessionProposalDigest: facts.sessionProposalDigest,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionPlanClosureDigest: facts.actionPlanClosure.actionPlanDigest, profile: request.profile,
    environmentDigest: facts.environmentDigest, trustRevision: request.expectedBaseSha,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY.policyDigest,
    evidenceRequirementDigest: facts.evidenceRequirementDigest,
    integrationPolicyDigest: facts.integrationPolicyDigest,
    mainHealthRef: { mainSha: mainHealth.mainSha, mainTreeSha: mainHealth.mainTreeSha,
      healthRevision: mainHealth.healthRevision, ledgerReceiptDigest: mainHealth.ledgerDigest }
  });
  const preGateReview = createPureReviewFixture({ stage: 'pre-expensive', session, scope: scopeAuthorization,
    barrier: facts.reviewBarrier, candidateAuthorNodeId: facts.candidate.authorNodeId,
    integrationPrincipalNodeId: facts.integrationPrincipalNodeId, expiresAt: facts.reviewExpiresAt,
    operationId: `sha256:${'f'.repeat(64)}` });
  const withoutDigest = Object.freeze({ schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA,
    requestOperationId: request.requestOperationId, scopeAuthorization, preGateReview, mainHealth, session,
    actionPlanClosure: facts.actionPlanClosure });
  const envelopeDigest = `sha256:${createHash('sha256').update(encodeVerificationActionData(withoutDigest)).digest('hex')}` as const;
  return Object.freeze({ ...withoutDigest, envelopeDigest });
}

async function reducerFixture(options: {
  now?: string;
  mergeAt?: string;
  authorizationExpiresAt?: string;
  consumed?: boolean;
  closeout?: 'completed' | 'protected-pending' | 'blocked' | 'residue';
  localDefaultSha?: string;
  remoteDefaultSha?: string;
  baseToMerge?: GitHubComparisonObservation;
  mergeToDefault?: GitHubComparisonObservation;
} = {}) {
  const mergeAt = options.mergeAt ?? MERGE_AT;
  const repository = 'sec-platform/sec';
  const identity = Object.freeze({
    repository,
    prNumber: 42,
    verificationRunId: '100',
    mergeRunId: '200',
    freshMainHealthRunId: '7',
    verificationWorkflowPath: '.github/workflows/compiler-pr-validation.yml',
    mergeWorkflowPath: '.github/workflows/merge-gate.yml',
    mainHealthSourceRef: `github-check-runs:${repository}@${BASE}`
  });
  const verificationWorkflowRef = `${identity.verificationWorkflowPath}@${BASE}`;
  const mergeWorkflowRef = `${identity.mergeWorkflowPath}@${BASE}`;
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-'));
  try {
  const journalFs = createEphemeralVerificationSessionJournalFs(
    path.join(repositoryRoot, 'runtime-state')
  );
  const transport = new ReducerTransport();
  transport.issueComments = [[botIssueComment()]];
  const github = fakeGitHubClient(transport, async (input) => (await observePrivateClearReviewBarrier(
    input.observedAt ?? VERIFIED_AT
  )));
  const candidate = transport.candidate();
  const barrier = (await github.observeReviewBarrier({ repository: identity.repository, prNumber: identity.prNumber,
    headSha: HEAD, excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']), observedAt: VERIFIED_AT }));
  if (barrier.status !== 'clear') throw new Error('fixture Review must be clear');
  const changedPaths = ['src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const testImpactTransition = changedTransition(changedPaths);
  const initialMainHealthCheck = mainHealthCheck({ workflowRunId: identity.verificationRunId });
  const local = prepareTrustedMainVerificationSession({ executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, repository: identity.repository,
    candidate, manifestPath: V6_MANIFEST_PATH, manifestDigest: V6_MANIFEST_DIGEST,
    changedPaths, testImpactTransition, testImpactSourceProvider: getTestImpactSourceProvider(),
    profile: 'quick', integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: identity.verificationRunId,
    sourceRef: `refs/heads/main@${BASE}`, observedAt: VERIFIED_AT,
    reviewBarrier: barrier, mainHealthChecks: [initialMainHealthCheck],
    dependencyBlobs: actionDependencyBlobs() });
  const facts = reconstructVerificationSessionHostedFacts({ request: local.request,
    repository: identity.repository, candidate, changedPaths, testImpactTransition,
    testImpactSourceProvider: getTestImpactSourceProvider(),
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: identity.verificationRunId, sourceRef: verificationWorkflowRef,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks: [initialMainHealthCheck],
    dependencyBlobs: actionDependencyBlobs() });
  const envelope = createPureHostedEnvelopeFixture({ request: local.request, facts });
  const producer = CodexDevelopmentCreateVerificationEvidenceProducer({
    sourceTransport: 'github-actions', workflowPath: identity.verificationWorkflowPath,
    workflowRef: verificationWorkflowRef, workflowSha: BASE,
    runId: identity.verificationRunId, runAttempt: 1, actorNodeId: 'INTEGRATOR'
  });
  const gates = envelope.actionPlanClosure.actions.map(({ action }, index) => ({
    action,
    result: CodexDevelopmentBuildVerificationGateResult({
      gateId: action.operation.identity, gateRevision: action.operation.revision,
      owner: 'ci-verification-maintainer', requirementKey: `gate:${action.operation.identity}`,
      subjectRevision: HEAD, inputDigest: action.actionKey, applicability: 'required',
      status: 'passed', disposition: 'executed', reasonCode: 'executed-success',
      requiredForClaims: [`gate:${action.operation.identity}`],
      supportedClaims: [`gate:${action.operation.identity}`],
      environment: { runtime: 'bun@1.3.14', os: 'linux', arch: 'x64', filesystem: null,
        capabilities: [], toolchainRevision: action.environment.toolchainRevision,
        providerRevisions: [action.environment.providerRevision] },
      execution: { argv: [`verified:${action.operation.identity}`], startedAt: VERIFIED_AT,
        finishedAt: '2026-08-09T14:03:00.000Z', durationMs: 120_000 + index,
        exitCode: 0, outputDigest: PAGE, failureFingerprint: null },
      evidenceRefs: [], invalidationRules: ['ActionKey changes'], diagnostic: null
    }),
    cleanup: { status: 'not-required' as const, evidenceRefs: [] as string[], diagnostic: null }
  }));
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
    contractRevision: 'ci-verification-v19', sessionRevision: envelope.session.sessionRevision,
    sessionProposalDigest: envelope.session.sessionProposalDigest,
    scopeAuthorizationRevision: envelope.scopeAuthorization.authorizationRevision,
    scopeAuthorizationDigest: envelope.scopeAuthorization.authorizationDigest,
    reviewReceiptDigest: envelope.preGateReview.receiptDigest,
    mainHealthRevision: envelope.mainHealth.healthRevision,
    mainHealthDigest: envelope.mainHealth.ledgerDigest, trustRevision: BASE, profile: 'quick',
    baseSha: BASE, baseTreeSha: BASE, headSha: HEAD, headTreeSha: HEAD,
    manifestPath: V6_MANIFEST_PATH, manifestDigest: V6_MANIFEST_DIGEST, producer,
    actionPlan: envelope.actionPlanClosure, status: 'passed', startedAt: VERIFIED_AT,
    finishedAt: '2026-08-09T14:03:00.000Z', gates, evidenceRefs: [],
    invalidationRules: ['Session, Action, Review, MainHealth, or trust changes']
  });
  const artifact = CodexDevelopmentFinalizeVerificationSessionArtifact({
    scopeAuthorization: envelope.scopeAuthorization, session: envelope.session,
    preGateReview: envelope.preGateReview, mainHealth: envelope.mainHealth, evidence, producer
  });
  const artifactText = `${encodeVerificationActionData(artifact)}\n`;
  const hostedMetadata = {
    artifactId: '1000',
    artifactName: `sec-verification-session-v2-pr-${identity.prNumber}-session-${artifact.session.sessionRevision.slice(7)}-run-${identity.verificationRunId}-attempt-1`,
    archiveDigest: PAGE,
    workflowPath: identity.verificationWorkflowPath,
    workflowRef: verificationWorkflowRef, workflowSha: BASE,
    runId: identity.verificationRunId, runAttempt: 1, eventName: 'repository_dispatch', actorNodeId: 'INTEGRATOR',
    actorPermission: 'maintain' as const, expired: false
  };
  const hostedObservation = createHostedArtifactObservation({ artifact, artifactText,
    observation: hostedMetadata });
  const preMergeBarrier = (await github.observeReviewBarrier({ repository: identity.repository, prNumber: identity.prNumber,
    headSha: HEAD, excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']), observedAt: mergeAt }));
  if (preMergeBarrier.status !== 'clear') throw new Error('fixture pre-merge Review must be clear');
  const preMergeReview = createPureReviewFixture({ stage: 'pre-merge',
    session: artifact.session, scope: artifact.scopeAuthorization, barrier: preMergeBarrier,
    candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR',
    expiresAt: '2026-08-09T14:20:00.000Z', operationId: PAGE });
  const freshMainHealth = createMainHealthLedger(createObservedMainHealthInput({
    repository: identity.repository, mainSha: BASE, mainTreeSha: BASE, trustRevision: BASE,
    observedAt: mergeAt, expiresAt: '2026-08-09T14:20:00.000Z',
    checks: [mainHealthCheck({ workflowRunId: identity.freshMainHealthRunId })]
  }));
  const platform = (await github.observePlatformEnforcement('sec-platform/sec'));
  if (platform.status === 'unknown') throw new Error('fixture platform observation must be known');
  const consumptionOperationId = createVerificationSessionMergeOperationId({
    sessionRevision: artifact.session.sessionRevision, headSha: HEAD,
    actionPlanDigest: artifact.session.actionPlanClosureDigest
  });
  const mergeInput = prepareVerificationSessionMergeInput({ artifact, preMergeReview,
    platform, hostedArtifactOrigin: hostedObservation, hostedArtifactTransport: hostedObservation,
    candidate: { repository: identity.repository, prNumber: identity.prNumber, draft: false,
      headOpenPullRequestCount: 1, currentBaseSha: BASE, currentBaseTreeSha: BASE,
      headSha: HEAD, headTreeSha: HEAD, baseIsAncestor: true, behindBy: 0,
      manifestPath: V6_MANIFEST_PATH, manifestDigest: V6_MANIFEST_DIGEST, changedPaths },
    provenance: { workflowPath: identity.mergeWorkflowPath, workflowRef: mergeWorkflowRef,
      workflowSha: BASE, eventName: 'workflow_run', sourceRunId: identity.mergeRunId, sourceRunAttempt: 1,
      actorNodeId: 'INTEGRATOR', actorPermission: 'maintain' },
    mainHealth: freshMainHealth, consumptionOperationId, issuedAt: mergeAt,
    expiresAt: options.authorizationExpiresAt ?? '2026-08-09T14:10:00.000Z'
  });
  const result = CodexDevelopmentEvaluateMergeGate(mergeInput);
  const authorizationPublicationId = `sha256:${createHash('sha256').update(encodeVerificationActionData({
    consumptionOperationId: result.authorization.consumptionOperationId,
    authorizationReceiptDigest: result.authorization.receiptDigest
  })).digest('hex')}` as const;
  const authorizationMetadata = {
    artifactId: '2000',
    artifactName: `sec-merge-gate-result-v2-pr-${identity.prNumber}-session-${artifact.session.sessionRevision.slice(7)}-run-${identity.mergeRunId}-attempt-1`,
    archiveDigest: PAGE,
    workflowPath: identity.mergeWorkflowPath, workflowRef: mergeWorkflowRef,
    workflowSha: BASE, runId: identity.mergeRunId, runAttempt: 1, eventName: 'workflow_run',
    actorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId,
    actorPermission: 'none' as const, expired: false
  };
  let trustedAuthorization = createTrustedIntegrationAuthorizationArtifact({
    resultJson: encodeVerificationActionData(result), observation: authorizationMetadata
  });
  const preparation = createBranchCloseoutPreparation({ preparedAt: MERGE_AT,
    repository: { root: repositoryRoot, commonDir: path.join(repositoryRoot, '.git'),
      fullName: identity.repository, remote: 'origin', defaultBranch: 'main' },
    branch: 'feat/example', refState: 'present', expectedHeadSha: HEAD, expectedRemoteSha: HEAD,
    expectedLocalSha: HEAD, expectedPrHeadSha: null, pullRequestNumber: 42,
    pullRequestStateAtPreparation: 'open', recovery: { kind: 'bundle', path: 'recovery.bundle',
      sha256: PAGE, verified: true, verifyOutput: 'verified' }, worktreePathsAtPreparation: []
  });
  const counters = { closeoutExecute: 0, closeoutObserve: 0, publications: 0 };
  const external: VerificationSessionRuntimeExternal = {
    now: () => options.now ?? MERGE_AT,
    expiresAt: (now, seconds) => new Date(new Date(now).getTime() + seconds * 1000).toISOString(),
    trustedRuntimeProof: () => {
      const liveDefaultSha = transport.observation.state === 'MERGED'
        ? options.remoteDefaultSha ?? transport.observation.mergeCommitSha!
        : BASE;
      return { currentHeadSha: BASE, currentBranch: transport.observation.state === 'MERGED' ? '' : 'main',
        localDefaultSha: transport.observation.state === 'MERGED'
          ? options.localDefaultSha ?? liveDefaultSha
          : BASE,
        remoteDefaultSha: liveDefaultSha,
        workingTreeClean: true, runtimeEntrypointBlobMatched: true,
        boundaryTargetsMatched: true };
    },
    runLocalActions: () => ({ status: 'passed', resultDigest: artifact.evidence.evidenceDigest as `sha256:${string}` }),
    hostedArtifact: () => ({ artifact, provenance: createTrustedHostedArtifactProvenance({
      artifact, artifactText, observation: hostedMetadata, actorPermission: 'maintain' }) }),
    saveReviewReceipt: () => undefined,
    integrationAuthorizationArtifact: () => ({ kind: 'actions-artifact', artifact: trustedAuthorization }),
    integrationAuthorizationPublication: () => ({
      authorizationId: result.authorization.authorizationId,
      authorizationReceiptDigest: result.authorization.receiptDigest,
      consumptionOperationId: result.authorization.consumptionOperationId as `sha256:${string}`,
      authorizationPublicationId,
      authorizationPublicationDigest: PAGE,
      commentId: 99,
      preparationDigest: preparation.preparationDigest
    }),
    consumedAuthorizationIds: () => options.consumed ? new Set([result.authorization.authorizationId]) : new Set(),
    observeCloseoutPreparation: () => ({ status: 'prepared', preparationDigest: preparation.preparationDigest }),
    observeCloseoutBinding: (authorization, session, merged) => ({ status: 'available',
      binding: createBranchCloseoutOperationBinding({ integrationAuthorization: authorization,
        preparation, newMainSha: merged.mergeCommitSha!,
        newMainTreeSha: merged.mergeCommitTreeSha!, candidateTreeSha: session.headTreeSha }) }),
    observeCloseout: () => {
      counters.closeoutObserve += 1;
      if (options.closeout === 'blocked' || options.closeout === 'residue') {
        return { status: 'blocked', reason: `branch closeout terminal ${options.closeout}` };
      }
      return { status: options.closeout ?? 'completed', receiptDigest: PAGE };
    }
  };
  const markers = integrationAuthorizationMergeMarkers({ sessionRevision: artifact.session.sessionRevision,
    authorizationId: result.authorization.authorizationId,
    authorizationReceiptDigest: result.authorization.receiptDigest,
    consumptionOperationId: result.authorization.consumptionOperationId as `sha256:${string}`,
    authorizationPublicationId, authorizationPublicationDigest: PAGE, commentId: 99 });
  const mergeCommitSha = '9'.repeat(40);
  const mergedDefaultSha = options.remoteDefaultSha ?? mergeCommitSha;
  transport.comparisons.set(`${BASE}...${mergeCommitSha}`,
    options.baseToMerge ?? { status: 'ahead', behindBy: 0 });
  transport.comparisons.set(`${mergeCommitSha}...${mergedDefaultSha}`,
    options.mergeToDefault ?? { status: 'ahead', behindBy: 0 });
  return { repositoryRoot, journalFs, transport, github, artifact, result, external, counters, changedPaths,
    testImpactTransition, markers,
    request: local.request, preparation,
    setAuthorizationResult: (next: MergeGateResult | string) => {
      trustedAuthorization = typeof next === 'string'
        ? { ...trustedAuthorization, resultJson: next }
        : createTrustedIntegrationAuthorizationArtifact({
            resultJson: encodeVerificationActionData(next), observation: authorizationMetadata });
    },
    dispose: () => rmSync(repositoryRoot, { recursive: true, force: true }) };
  } catch (error) {
    settleResources({ primary: { label: 'reducer-fixture-construction', error },
      cleanup: [{ label: 'reducer-fixture-root',
        settle: () => rmSync(repositoryRoot, { recursive: true, force: true }) }] });
    throw error;
  }
}


return { BASE, FakeTransport, HEAD, MERGE_AT, PAGE, ReducerTransport, V6_MANIFEST_PATH, VERIFIED_AT, actionDependencyBlobs, actionsIssueComment, botIssueComment, changedTransition, createPureHostedEnvelopeFixture, defaultReviewWakeupBody, expectTypedProviderSchemaUnsupported, fakeGitHubClient, mainHealthCheck, maintainerIssueComment, observe, observePrivateClearReviewBarrier, observePrivateGhProviderBarrier, observePrivateMergedCandidate, page, reducerFixture, workflowRun, dispose: () => {
  if (privateGhProxySuiteRoot !== '') {
    rmSync(privateGhProxySuiteRoot, { recursive: true, force: true });
    privateGhProxySuiteRoot = '';
  }
} };
}
