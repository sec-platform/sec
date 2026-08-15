import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CLOSEOUT_CLI_E2E_ENABLED = process.env.SEC_VERIFICATION_SESSION_CLOSEOUT_CLI_E2E === '1';
const closeoutCliE2eTest = CLOSEOUT_CLI_E2E_ENABLED ? test : test.skip;

test('local-main durable receipt keeps directory sync fail-closed except for the canonical Windows capability boundary', async () => {
  const source = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts')).text();
  const writeDurable = source.slice(source.indexOf('function writeDurable'),
    source.indexOf('function createEphemeralVerificationSessionJournalFs'));
  expect(writeDurable).toContain('fsyncSync(handle)');
  expect(writeDurable).toContain('renameSync(temporary, target)');
  expect(writeDurable).toContain("process.platform !== 'win32'");
  expect(writeDurable).toContain("['EINVAL', 'EPERM', 'EACCES', 'EBADF']");
  expect(writeDurable).toContain('throw error;');
});

test('provider response shape is rejected and local-main receipt has no post-effect path write', async () => {
  const githubSource = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts')).text();
  expect(githubSource).toContain('class GitHubProviderResponseShapeError');
  expect(githubSource).toContain('if (!Array.isArray(pages))');
  expect(githubSource).toContain('if (pages.length === 0)');
  expect(githubSource).toContain('pagination returned no successful pages.');
  expect(githubSource).toContain('const seenCursors = new Set<string>();');
  expect(githubSource).toContain("'github-graphql-review-pagination-incomplete'");
  expect(githubSource).toContain("'github-graphql-review-pagination-cursor'");
  expect(githubSource).toContain("'github-provider-response-shape-unsupported'");
  expect(githubSource).toContain("schema: 'sec-provider-response-shape-v2'");
  expect(githubSource).toContain('nestedThreadCommentResponses');
  expect(githubSource).toContain('throw error;');
  const sessionSource = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts')).text();
  const localMainCommand = sessionSource.slice(sessionSource.indexOf("if (command === 'local-main-closeout')"),
    sessionSource.indexOf("if (command === 'project')"));
  expect(localMainCommand).toContain("schema: 'sec-local-main-closeout-receipt-v3'");
  expect(localMainCommand).not.toContain("required(args, '--output')");
  expect(localMainCommand).not.toContain('writeDurable(');
  expect(sessionSource).toContain("'local-main-closeout': new Set(['--repository', '--pr', '--protected-root', '--expected-local-head'])");
});

test('successful GraphQL inventory drift is provenance-bound rather than digesting diagnostics', async () => {
  const githubSource = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts')).text();
  expect(githubSource).toContain('readonly classification: string');
  expect(githubSource).toContain('readonly source: unknown');
  expect(githubSource).toContain('function providerResponseShapeDigest(error: GitHubProviderResponseShapeError)');
  expect(githubSource).toContain('boundarySource: providerResponseShapeSource(source)');
  expect(githubSource).toContain('causeClassification: error.classification');
  expect(githubSource).toContain('function providerResponseShapeSource(source: unknown)');
  expect(githubSource).toContain('source === undefined ? ABSENT_PROVIDER_RESPONSE_SOURCE : source');
  expect(githubSource).toContain('this.source = providerResponseShapeSource(source)');
  expect(githubSource).toContain('causeSource: error.source');
  expect(githubSource).not.toContain("schema: 'sec-provider-response-shape-v1', source");
  // These fixtures represent a terminal page that still asks for another page,
  // and a two-page sequence whose cursor does not advance. The private adapter
  // hashes the exact page payload plus a stable classification for each.
  const terminalStillOpen = [{ data: { repository: { pullRequest: {
    reviewRequests: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } }
  } } } }];
  const repeatedCursor = [{ data: { repository: { pullRequest: {
    reviewRequests: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'c1' } }
  } } } }, { data: { repository: { pullRequest: {
    reviewRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: 'c1' } }
  } } } }];
  expect(createHash('sha256').update(JSON.stringify(terminalStillOpen)).digest('hex'))
    .not.toBe(createHash('sha256').update(JSON.stringify(repeatedCursor)).digest('hex'));
});

test('provider projections do not become effect permits and prepare-hosted re-reads a live barrier', async () => {
  const sessionSource = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts')).text();
  expect(sessionSource).not.toContain('assertGitHubVerificationProviderEffectV1');
  expect(sessionSource).not.toContain('assertGitHubProviderEffectAuthorityV1');
  expect(sessionSource).toContain('github.ensureVerificationSessionWakeup');
  expect(sessionSource).toContain('publishHostedIntegrationAuthorizationOperationV1');
  const prepareCommand = sessionSource.slice(sessionSource.indexOf("if (command === 'prepare-hosted')"),
    sessionSource.indexOf("if (command === 'artifact-status')"));
  expect(prepareCommand).toContain('github.observeReviewBarrier');
  expect(prepareCommand).not.toContain('preGateReview');
});

test('provider ledger is a deny-only, in-epoch circuit breaker at physical GitHub effects', async () => {
  const source = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts')).text();
  const guard = 'assertUnavailableProviderCircuitBreakerNotAuthorityV1';
  const helper = source.slice(source.indexOf(`function ${guard}(`), source.indexOf('function githubEvent('));
  expect(helper).toContain('loadVerificationProviderCapabilityLedgerV1(input.ctx.repositoryRoot)');
  expect(helper).toContain('input.now < epoch.observedAt || input.now >= epoch.expiresAt');
  expect(helper).toContain("capability.availability !== 'unavailable'");
  expect(helper).toContain('assertProviderRetryGuardV1');
  expect(helper).not.toContain('assertProviderCapabilityUsableV1');

  const expectGuardImmediatelyBefore = (section: string, effectIndex: number): void => {
    const guardIndex = section.lastIndexOf(guard, effectIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(effectIndex);
  };
  const review = source.slice(source.indexOf('function ensureHostedReviewRequestV1('),
    source.indexOf('export function assertHostedSquashMergeCompletionV1('));
  expect(review.indexOf("if (observed.status === 'reused')")).toBeLessThan(review.indexOf(guard));
  expectGuardImmediatelyBefore(review, review.indexOf("'POST'"));
  const authorization = source.slice(source.indexOf('function publishHostedIntegrationAuthorizationOperationV1('),
    source.indexOf('function ensureHostedReviewRequestV1('));
  expect(authorization.indexOf("status: 'reused'")).toBeLessThan(authorization.indexOf(guard));
  expectGuardImmediatelyBefore(authorization, authorization.indexOf("'POST'"));
  const effectStart = source.slice(source.indexOf('function publishHostedCloseoutEffectStartV1('),
    source.indexOf('function closeoutAttempt('));
  expect(effectStart.indexOf('if (existing !== null)')).toBeLessThan(effectStart.indexOf(guard));
  expectGuardImmediatelyBefore(effectStart, effectStart.indexOf("'POST'"));
  const terminal = source.slice(source.indexOf('function publishHostedCloseoutTerminalV1('),
    source.indexOf('function closeoutPublicationCompositeDigest('));
  expect(terminal.indexOf('if (existing !== null)')).toBeLessThan(terminal.indexOf(guard));
  expectGuardImmediatelyBefore(terminal, terminal.indexOf("'POST'"));

  const prepare = source.slice(source.indexOf("if (command === 'prepare')"),
    source.indexOf("if (command === 'freeze')"));
  expect((prepare.match(new RegExp(guard, 'gu')) ?? [])).toHaveLength(1);
  expectGuardImmediatelyBefore(prepare,
    prepare.indexOf('github.ensureVerificationSessionWakeup(repository, prepared.request)'));
  const resume = source.slice(source.indexOf("if (command === 'resume')"),
    source.indexOf("if (command === 'prepare-integration-hosted')"));
  expect((resume.match(new RegExp(guard, 'gu')) ?? [])).toHaveLength(2);
  const redispatch = 'github.ensureVerificationSessionWakeup(repository, request)';
  const firstRedispatch = resume.indexOf(redispatch);
  expectGuardImmediatelyBefore(resume, firstRedispatch);
  expectGuardImmediatelyBefore(resume, resume.indexOf(redispatch, firstRedispatch + 1));
  const integration = source.slice(source.indexOf("if (command === 'integrate-hosted')"),
    source.indexOf("if (command === 'closeout-mutate-hosted')"));
  expectGuardImmediatelyBefore(integration, integration.indexOf('executeHostedSquashMerge({'));
  const closeout = source.slice(source.indexOf('function finalizeHostedBranchCloseoutV1('),
    source.indexOf('function publishHostedCloseoutTerminalV1('));
  expectGuardImmediatelyBefore(closeout, closeout.lastIndexOf('deleteHostedRemoteRefCas('));
  expect(closeout).toContain('authorizeHostedCloseoutEffectUnderLeaseV1');
  expect(closeout).toContain('await assertWorkspaceWriteLease(preparation.repository.root, input.lease);');
  expect(closeout).not.toContain("capability: 'github-writer',\n        now: input.now()\n      });\n      const localAttempt");
  expect(closeout).not.toContain("capability: 'github-writer',\n        now: input.now()\n      });\n      const pruneAttempt");

  const reviewRequest = source.slice(source.indexOf("if (reviewBarrier.status === 'waiting')"),
    source.indexOf("if (reviewBarrier.status !== 'clear')"));
  expect(reviewRequest).toContain('const providerEpochNow = now();');
  expect(reviewRequest).toContain('providerEpochNow >= providerEpoch.observedAt');
  expect(reviewRequest).toContain('providerEpochNow < providerEpoch.expiresAt');
  expect(reviewRequest).toContain("reviewer.availability === 'unavailable'");
  expect(reviewRequest).toContain('if (reviewProviderUnavailable)');
  expect(reviewRequest).toContain("capability: 'codex-review'");
});

import {
  CodexDevelopmentCreateVerificationEvidenceProducerV4,
  CodexDevelopmentFinalizeVerificationEvidenceV4,
  CodexDevelopmentFinalizeVerificationSessionArtifactV2
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentCreateTestImpactTransitionObservationV1,
  CodexDevelopmentTestImpactTransitionDigestV1,
  type CodexDevelopmentTestImpactTransitionObservationV1
} from '../../platform/shared/ci-git-changed-files.ts';
import { createIntegrationAuthorizationV1 } from '../../platform/shared/integration-authorization-contract.ts';
import {
  createMainHealthLedgerV1,
  createMainHealthRepairWorkPackagePathV1,
  resolveMainHealthLaneV1
} from '../../platform/shared/main-health-contract.ts';
import {
  createReviewSnapshotDigestV1,
  createReviewStabilityReceiptV1,
  renderIndependentReviewTrailerV1,
  REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT_V1,
  SEC_REVIEW_STABILITY_POLICY_V1
} from '../../platform/shared/review-stability-contract.ts';
import { createScopeAuthorizationV1, type ScopeAuthorizationV1 } from '../../platform/shared/scope-authorization-contract.ts';
import {
  ciVerificationActionParentDispatchPlanPayloadDigestV2,
  createCiVerificationActionParentDispatchPlanV2,
  createCiVerificationActionProposalV2,
  createCiVerificationActionProviderEnvelopeV2,
  createCiVerificationLocalExecutionEnvironmentV2
} from '../../platform/shared/verification-action-ci-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import { CodexDevelopmentBuildVerificationGateResultV1 } from '../../platform/shared/verification-result-contract.ts';

import {
  CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1,
  CI_MAIN_HEALTH_POLICY_V1,
  CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2,
  CI_VERIFICATION_SESSION_ARTIFACT_PREFIX,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE,
  CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
  createCiMainHealthRequestOperationIdV1
} from '../../platform/shared/ci-verification-revision.ts';
import { TCB_CLOSURE_LOCK } from '../../platform/shared/tcb-closure-lock.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3 } from '../../platform/shared/tcb-trust-root-contract.ts';
import { createVerificationSessionV2, type VerificationSessionV2 } from '../../platform/shared/verification-session-contract.ts';
import {
  authorizeBranchCloseout,
  BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME_V1,
  createBranchCloseoutOperationBindingV1,
  createBranchCloseoutPreparation,
  createBranchCloseoutRecoveryArtifactV1,
  parseBranchCloseoutRecoveryArtifactV1
} from '../../scripts/codex/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME_V1,
  createBranchCloseoutEffectStartPublicationV1,
  createHostedWorkflowCommentProvenanceV1,
  renderBranchCloseoutEffectStartPublicationComment
} from '../../scripts/codex/branch-closeout-receipt.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA_V1,
  parsePreparedBranchCloseoutEnvelope,
  prepareBranchCloseout,
  rehydratePreparedBranchCloseoutEnvelopeV1,
  rehydratePreparedBranchCloseoutRecoveryArtifactV1
} from '../../scripts/codex/branch-closeout.ts';
import { branchLifecycleDigest } from '../../scripts/codex/branch-lifecycle-audit.ts';
import {
  BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
  type BranchLifecycleInventory
} from '../../scripts/codex/branch-lifecycle-types.ts';
import type { IntegrationAuthorizationOperationPublicationV1 } from '../../scripts/codex/integration-authorization-publication.ts';
import {
  createIntegrationAuthorizationOperationPublicationV1,
  HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1,
  renderIntegrationAuthorizationOperationPublicationComment
} from '../../scripts/codex/integration-authorization-publication.ts';
import { createObservedMainHealthInputV1 } from '../../scripts/codex/main-health-observation.ts';
import {
  CodexDevelopmentEvaluateMergeGateV2,
  type CodexDevelopmentMergeGateResultV2
} from '../../scripts/codex/merge-gate.ts';
import { executeLocalVerificationActionDagV2 } from '../../scripts/codex/verification-action-runner.ts';
import {
  assertGitHubReviewAuthorityObservationV1,
  classifyGitHubGraphQLSchemaFailureV1,
  createVerificationSessionGitHubClientV1,
  evaluateGitHubRepositoryActionsArtifactInventoryV1,
  evaluateHostedReviewRequestObservationV1,
  evaluatePlatformEnforcementObservationV1,
  evaluateVerificationSessionChangedPathsV1,
  evaluateVerificationSessionReviewObservationV1,
  evaluateVerificationSessionWorkflowJoinV1,
  isGitHubProviderSchemaUnsupportedError,
  parseGitHubOpenPullRequestCensusV1,
  parseGitHubPullRequestFileInventoryV1,
  parseGitHubReviewPagesV1,
  parseGitHubReviewThreadPagesV1,
  PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
  SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1,
  VERIFICATION_SESSION_REVIEW_REQUEST_COMMENT_MARKER_V1,
  VERIFICATION_SESSION_REVIEW_REQUEST_COMMENT_SCHEMA_V1,
  type GitHubActionsArtifactObservationV1,
  type GitHubAppReviewCommentObservationV1,
  type GitHubCandidateObservationV1,
  type GitHubCheckObservationV1,
  type GitHubCommitResolutionObservationV1,
  type GitHubComparisonObservationV1,
  type GitHubIssueCommentObservationV1,
  type GitHubPageV1,
  type GitHubReviewBarrierObservationV1,
  type GitHubReviewObservationV1,
  type GitHubReviewRequestObservationV1,
  type GitHubReviewThreadObservationV1,
  type GitHubWorkflowJobObservationV1,
  type GitHubWorkflowRunObservationV1,
  type SessionDigest,
  type VerificationSessionGitHubClientV1,
  type VerificationSessionReviewObservationTransactionV1,
  type VerificationSessionWorkflowObservationTransactionV1
} from '../../scripts/codex/verification-session-github.ts';
import {
  assertTrustedExactRevisionRuntimeV1,
  assertTrustedMainRuntimeV1,
  assertTrustedMergedRequestRuntimeReachabilityV1,
  assertTrustedRuntimeV1,
  classifyVerificationSessionArtifactReuseV1,
  compilePostMainIssueDispositionHealthReadbackV1,
  createHostedArtifactObservationV2,
  createTrustedHostedArtifactProvenanceV1,
  createTrustedIntegrationAuthorizationArtifactV1,
  createVerificationSessionMergeOperationIdV1,
  integrationAuthorizationMergeMarkersV1,
  prepareLocalQuickVerificationActionPlanV2,
  prepareTrustedMainVerificationSessionV1,
  prepareVerificationSessionHostedV1,
  prepareVerificationSessionMergeInputV2,
  reconstructVerificationSessionHostedFactsV1,
  resumeVerificationSessionV2,
  SEC_VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY_V1,
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1,
  VERIFICATION_SESSION_HOSTED_EVENT_V2,
  VERIFICATION_SESSION_HOSTED_REQUEST_SCHEMA_V1,
  type VerificationSessionHostedEnvelopeV1,
  type VerificationSessionHostedFactsV1,
  type VerificationSessionHostedRequestV1,
  type VerificationSessionRuntimeExternal
} from '../../scripts/codex/verification-session-runtime.ts';
import {
  assertHostedCompilerDispatchPayloadV1,
  assertHostedCompilerInternalProvenanceV2,
  assertHostedSquashMergeCompletionV1,
  classifyDurableVerificationSessionProjectionV1,
  parseHostedSynchronousSquashMergeResponseV1,
  planHostedIntegrationEffectsV1,
  routeHostedIntegrationV1,
  routePreparedWorktreeCleanupAttemptV1,
  verificationSessionCli
} from '../../scripts/codex/verification-session.ts';

const HEAD = '2222222222222222222222222222222222222222';
const BASE = '1111111111111111111111111111111111111111';
const BOT = 'BOT_kgDOC98s_g';
const PAGE = `sha256:${'a'.repeat(64)}` as const;
const JOIN_SESSION = `sha256:${'6'.repeat(64)}` as const;
const JOIN_ACTION = `sha256:${'7'.repeat(64)}` as const;

function changedTransition(
  changedPaths: readonly string[],
  baseSha = BASE,
  headSha = HEAD
): CodexDevelopmentTestImpactTransitionObservationV1 {
  return CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha,
    headSha,
    records: changedPaths.map((changedPath) => ({ status: 'changed' as const, path: changedPath })),
    readPathBlob: () => null
  });
}

const JOIN_REQUEST: VerificationSessionHostedRequestV1 = Object.freeze({
  schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA, prNumber: 42,
  expectedBaseSha: BASE, expectedBaseTreeSha: HEAD, expectedHeadSha: HEAD,
  expectedHeadTreeSha: HEAD, manifestPath: 'docs/work-packages/verification-action-trusted-cutover-v6.md',
  manifestDigest: `sha256:${'1'.repeat(64)}`, profile: 'quick',
  expectedScopeProposalDigest: `sha256:${'2'.repeat(64)}`,
  expectedActionPlanDigest: JOIN_ACTION, expectedSessionRevision: JOIN_SESSION,
  reviewPolicyDigest: `sha256:${'3'.repeat(64)}`,
  requestOperationId: `sha256:${'4'.repeat(64)}`
});

test('private gh wakeup dispatcher type-locks canonical stdin as bounded Bun bytes', () => {
  const githubSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts'), 'utf8');
  const runner = githubSource.slice(githubSource.indexOf('function runVerificationSessionGh('),
    githubSource.indexOf('/** Concrete provider transport;'));
  const dispatchStart = githubSource.lastIndexOf('  dispatchVerificationSession(');
  const dispatch = githubSource.slice(dispatchStart,
    githubSource.indexOf('\n  }', dispatchStart) + 4);
  expect(runner).toContain('input?: Buffer');
  expect(runner).toContain("encoding: 'buffer'");
  expect(runner).toContain('input,');
  expect(dispatch).toContain('const body = Buffer.from(');
  expect(dispatch).toContain("})}\\n`, 'utf8')");

  const body = Buffer.from(`${encodeVerificationActionDataV2({
    event_type: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    client_payload: { payload: JOIN_REQUEST }
  })}\n`, 'utf8');
  const probe = spawnSync(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
    encoding: 'buffer', input: body, windowsHide: true, maxBuffer: 1024 * 1024
  });
  expect(probe.status).toBe(0);
  expect(probe.stdout).toEqual(body);
});

test('hosted integration router separates first effect, merged recovery, and blocking', () => {
  const session = { repository: 'sec-platform/sec', prNumber: 42,
    sessionRevision: JOIN_SESSION, baseSha: BASE, baseTreeSha: BASE,
    headSha: HEAD, headTreeSha: HEAD } as VerificationSessionV2;
  const candidate: GitHubCandidateObservationV1 = {
    repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
    isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE,
    baseTreeSha: BASE, headBranch: 'feat/example', headSha: HEAD, headTreeSha: HEAD,
    title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
    mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null
  };
  const open = routeHostedIntegrationV1({ repository: 'sec-platform/sec', session, candidate,
    priorEffectStarted: false, authorizationPublicationCount: 0 });
  expect(open).toMatchObject({ lane: 'open-first-effect',
    reason: 'exact-open-candidate-without-prior-effect' });
  expect(planHostedIntegrationEffectsV1(open)).toEqual({
    prepareRecoveryArtifact: true,
    createAuthorizationPublication: true,
    executePhysicalMerge: true,
    consumeOriginalAuthorizationPublication: false,
    consumeOriginalRecoveryArtifact: false
  });

  for (const rerunSelection of ['all', 'failed'] as const) {
    const blocked = routeHostedIntegrationV1({ repository: 'sec-platform/sec', session, candidate,
      priorEffectStarted: true, authorizationPublicationCount: 0 });
    expect({ rerunSelection, lane: blocked.lane, reason: blocked.reason }).toEqual({
      rerunSelection, lane: 'blocked', reason: 'open-prior-effect-started'
    });
  }
  expect(routeHostedIntegrationV1({ repository: 'sec-platform/sec', session, candidate,
    priorEffectStarted: false, authorizationPublicationCount: 1 })).toMatchObject({
      lane: 'blocked', reason: 'open-prior-effect-started'
    });

  const mergedCandidate = { ...candidate, state: 'MERGED' as const,
    baseSha: '8'.repeat(40), baseTreeSha: '7'.repeat(40),
    mergeCommitSha: '9'.repeat(40), mergeCommitTreeSha: HEAD,
    mergeCommitMessage: 'marker-bound merge' };
  const merged = routeHostedIntegrationV1({ repository: 'sec-platform/sec', session,
    candidate: mergedCandidate, priorEffectStarted: true, authorizationPublicationCount: 1 });
  expect(merged).toMatchObject({ lane: 'merged-recovery', mergeCommitSha: '9'.repeat(40),
    mergeCommitTreeSha: HEAD });
  const mergedEffects = planHostedIntegrationEffectsV1(merged);
  expect(mergedEffects).toEqual({
    prepareRecoveryArtifact: false,
    createAuthorizationPublication: false,
    executePhysicalMerge: false,
    consumeOriginalAuthorizationPublication: true,
    consumeOriginalRecoveryArtifact: true
  });
  let prepareCount = 0;
  let authorizationCount = 0;
  let mergeCount = 0;
  if (mergedEffects.prepareRecoveryArtifact) prepareCount += 1;
  if (mergedEffects.createAuthorizationPublication) authorizationCount += 1;
  if (mergedEffects.executePhysicalMerge) mergeCount += 1;
  expect({ prepareCount, authorizationCount, mergeCount })
    .toEqual({ prepareCount: 0, authorizationCount: 0, mergeCount: 0 });

  expect(routeHostedIntegrationV1({ repository: 'sec-platform/sec', session,
    candidate: { ...candidate, state: 'CLOSED' as const }, priorEffectStarted: false,
    authorizationPublicationCount: 0 })).toMatchObject({
      lane: 'blocked', reason: 'pull-request-closed-without-exact-merge'
    });
  expect(routeHostedIntegrationV1({ repository: 'sec-platform/sec', session,
    candidate: { ...mergedCandidate, mergeCommitTreeSha: BASE }, priorEffectStarted: true,
    authorizationPublicationCount: 1 })).toMatchObject({
      lane: 'blocked', reason: 'merged-readback-incomplete-or-tree-mismatch'
    });
});

test('hosted comment publisher policy is the canonical shared Actions identity', () => {
  expect(SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1).toBe(CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1);
});

test('hosted Review request producer and consumer bind the exact repository without spread-only fields', () => {
  const input = {
    repository: 'sec-platform/sec',
    sessionRevision: `sha256:${'1'.repeat(64)}` as SessionDigest,
    operationId: `sha256:${'2'.repeat(64)}` as SessionDigest,
    prNumber: 42,
    headSha: HEAD,
    sourceRunId: '900',
    sourceRunAttempt: 1,
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`
  } as const;
  const transport = new FakeTransport();
  transport.issueComments = [[]];
  const produced = evaluateHostedReviewRequestObservationV1(transport, input);
  expect(produced).toMatchObject({ status: 'absent', commentId: null });

  const legacySameOperation = legacyHostedReviewRequestComment(input, false);
  const legacySpreadSameOperation = legacyHostedReviewRequestComment(input, true);
  const legacyOtherOperation = legacyHostedReviewRequestComment({
    ...input,
    operationId: `sha256:${'3'.repeat(64)}` as SessionDigest
  }, false);
  transport.issueComments = [[
    actionsIssueComment(legacySameOperation, '101'),
    actionsIssueComment(legacySpreadSameOperation, '102'),
    actionsIssueComment(legacyOtherOperation, '103')
  ]];
  expect(evaluateHostedReviewRequestObservationV1(transport, input)).toMatchObject({
    status: 'absent',
    commentId: null
  });

  transport.issueComments = [[
    actionsIssueComment(legacySameOperation, '101'),
    actionsIssueComment(legacySpreadSameOperation, '102'),
    actionsIssueComment(legacyOtherOperation, '103'),
    actionsIssueComment(produced.body, '104')
  ]];
  expect(evaluateHostedReviewRequestObservationV1(transport, input)).toMatchObject({
    status: 'reused',
    commentId: '104'
  });

  transport.issueComments = [[]];
  const foreign = evaluateHostedReviewRequestObservationV1(transport, {
    ...input,
    repository: 'foreign/repository'
  });
  transport.issueComments = [[actionsIssueComment(foreign.body)]];
  expect(() => evaluateHostedReviewRequestObservationV1(transport, input))
    .toThrow('conflicting semantic bytes');

  for (const drifted of [
    { ...input, prNumber: input.prNumber + 1 },
    { ...input, headSha: BASE },
    { ...input, sourceRunId: '901' },
    { ...input, sourceRunAttempt: 2 },
    { ...input, workflowRef: `.github/workflows/compiler-pr-validation.yml@${HEAD}` }
  ]) {
    transport.issueComments = [[]];
    const drift = evaluateHostedReviewRequestObservationV1(transport, drifted);
    transport.issueComments = [[actionsIssueComment(drift.body)]];
    expect(() => evaluateHostedReviewRequestObservationV1(transport, input))
      .toThrow('conflicting semantic bytes');
  }

  const encoded = produced.body.match(/```json\n(?<payload>.+)\n```$/u)?.groups?.payload;
  if (encoded === undefined) throw new Error('production Review request body did not contain canonical JSON');
  const extraFieldBody = produced.body.replace(encoded, encodeVerificationActionDataV2({
    ...(JSON.parse(encoded) as Record<string, unknown>),
    extraField: 'forbidden'
  }));
  transport.issueComments = [[actionsIssueComment(extraFieldBody)]];
  expect(() => evaluateHostedReviewRequestObservationV1(transport, input))
    .toThrow('payload keys/schema are invalid');
});

test('provider recovery artifact binds exact envelope and bundle bytes', () => {
  const artifact = createBranchCloseoutRecoveryArtifactV1({
    repository: 'sec-platform/sec',
    pullRequestNumber: 42,
    sessionRevision: JOIN_SESSION,
    headSha: HEAD,
    headTreeSha: HEAD,
    preparedEnvelopeBytes: '{"schema":"prepared-fixture"}\n',
    recoveryBundleBytes: Buffer.from('exact recovery bundle bytes')
  });
  expect(parseBranchCloseoutRecoveryArtifactV1(JSON.stringify(artifact))).toEqual(artifact);
  expect(artifact.preparedEnvelopeByteLength).toBe(30);
  expect(artifact.recoveryBundleByteLength).toBe(27);

  expect(() => parseBranchCloseoutRecoveryArtifactV1({ ...artifact,
    recoveryBundleBase64: Buffer.from('substituted recovery bundle').toString('base64') }))
    .toThrow('recovery bundle digest mismatch');
  expect(() => parseBranchCloseoutRecoveryArtifactV1({ ...artifact, callerPath: 'untrusted.json' }))
    .toThrow('fields are not exact');
  expect(() => parseBranchCloseoutRecoveryArtifactV1({ ...artifact,
    preparedEnvelopeBase64: `${artifact.preparedEnvelopeBase64}=\n` }))
    .toThrow('canonical base64');
});

function workflowRun(overrides: Partial<GitHubWorkflowRunObservationV1> = {}): GitHubWorkflowRunObservationV1 {
  return { id: '10', name: 'compiler-pr-validation',
    displayTitle: `verify session PR #42 session ${JOIN_SESSION}`,
    workflowPath: '.github/workflows/compiler-pr-validation.yml', event: 'repository_dispatch',
    status: 'in_progress', conclusion: null, headSha: BASE, runAttempt: 1,
    updatedAt: '2026-08-09T14:00:00.000Z', ...overrides };
}

function page<T>(nodes: readonly T[], hasNextPage = false, endCursor: string | null = null): GitHubPageV1<T> {
  return { nodes, hasNextPage, endCursor, pageDigest: PAGE };
}

class FakeTransport implements VerificationSessionReviewObservationTransactionV1,
  VerificationSessionWorkflowObservationTransactionV1 {
  reviews: GitHubReviewObservationV1[][] = [[]];
  threads: GitHubReviewThreadObservationV1[][] = [[]];
  requests: GitHubReviewRequestObservationV1[][] = [[]];
  comments: GitHubAppReviewCommentObservationV1[][] = [[]];
  issueComments: GitHubIssueCommentObservationV1[][] = [[]];
  workflowRuns: GitHubWorkflowRunObservationV1[][] = [[]];
  resolutions = new Map<string, GitHubCommitResolutionObservationV1>();
  reviewRequests = 0;
  dispatches = 0;
  rulesetError: Error & { statusCode?: number } | null = null;

  candidate(): GitHubCandidateObservationV1 {
    return {
      repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
      isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE,
      baseTreeSha: BASE, headBranch: 'feat/example', headSha: HEAD, headTreeSha: HEAD,
      title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
      mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null
    };
  }
  private at<T>(pages: T[][], after: string | null, digestCharacter: string): GitHubPageV1<T> {
    const index = after === null ? 0 : Number(after);
    const next = index + 1 < pages.length ? String(index + 1) : null;
    return { ...page(pages[index] ?? [], next !== null, next),
      pageDigest: `sha256:${digestCharacter.repeat(64).slice(0, 64)}` as SessionDigest };
  }
  reviewPage(_r: string, _p: number, after: string | null): GitHubPageV1<GitHubReviewObservationV1> { return this.at(this.reviews, after, 'a'); }
  threadPage(_r: string, _p: number, after: string | null): GitHubPageV1<GitHubReviewThreadObservationV1> { return this.at(this.threads, after, 'b'); }
  reviewRequestPage(_r: string, _p: number, after: string | null): GitHubPageV1<GitHubReviewRequestObservationV1> { return this.at(this.requests, after, 'c'); }
  appCommentPage(_r: string, _p: number, after: string | null): GitHubPageV1<GitHubAppReviewCommentObservationV1> { return this.at(this.comments, after, 'd'); }
  issueCommentPage(_r: string, _p: number, after: string | null): GitHubPageV1<GitHubIssueCommentObservationV1> { return this.at(this.issueComments, after, 'e'); }
  resolveCommitOid(repository: string, locator: string): GitHubCommitResolutionObservationV1 {
    const configured = this.resolutions.get(locator);
    if (configured !== undefined) return configured;
    const commitSha = HEAD.startsWith(locator) ? HEAD : locator.padEnd(40, locator.at(-1) ?? '0').slice(0, 40);
    return { repository, locator, status: 'resolved', commitSha, treeSha: commitSha,
      responseDigest: `sha256:${'f'.repeat(64)}` };
  }
  collaboratorPermission(): 'admin' { return 'admin'; }
  principalByNodeId(_repository: string, nodeId: string) {
    return { login: nodeId === BOT ? 'codex-review-bot' : 'integrator', nodeId,
      permission: 'maintain' as const };
  }
  checkPage(): GitHubPageV1<GitHubCheckObservationV1> { return page([]); }
  workflowRunPage(_r: string, _h: string, after: string | null): GitHubPageV1<GitHubWorkflowRunObservationV1> {
    return this.at(this.workflowRuns, after, '7');
  }
  repositoryRulesets(): unknown {
    if (this.rulesetError) throw this.rulesetError;
    return [{ id: 1, enforcement: 'active' }];
  }
  comparison(_repository: string, _baseSha: string, _headSha: string): GitHubComparisonObservationV1 {
    return { status: 'ahead', behindBy: 0 };
  }
  ensureVerificationSessionWakeup(): void { this.dispatches += 1; }
}

class ReducerTransport extends FakeTransport {
  observation = super.candidate();
  mergedTreeSha = HEAD;
  comparisons = new Map<string, GitHubComparisonObservationV1>();

  override candidate(): GitHubCandidateObservationV1 { return { ...this.observation }; }

  override comparison(_repository: string, baseSha: string, headSha: string): GitHubComparisonObservationV1 {
    return this.comparisons.get(`${baseSha}...${headSha}`) ?? { status: 'ahead', behindBy: 0 };
  }

  adoptMerged(markers: readonly string[], reviewReceipt: ReturnType<typeof createReviewStabilityReceiptV1>,
    sessionRevision: `sha256:${string}`): void {
    this.observation = {
      ...this.observation,
      state: 'MERGED',
      mergeCommitSha: '9'.repeat(40),
      mergeCommitTreeSha: this.mergedTreeSha,
      mergeCommitMessage: `Verified integration ${sessionRevision.slice(7, 19)}\n\n${markers.join('\n')}\n${
        renderIndependentReviewTrailerV1(reviewReceipt)}`
    };
  }
}

function botComment(body = `Codex Review: Didn't find any major issues. Bravo.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``): GitHubAppReviewCommentObservationV1 {
  return { id: 'C1', authorNodeId: BOT, appId: 1144995, body, createdAt: '2026-08-09T14:00:00.000Z' };
}

function botIssueComment(body = `Codex Review: Didn't find any major issues. Bravo.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
  overrides: Partial<GitHubIssueCommentObservationV1> = {}): GitHubIssueCommentObservationV1 {
  return { id: '101', body, authorLogin: 'codex-review[bot]', authorId: 101,
    authorNodeId: BOT, authorType: 'Bot',
    performedViaGitHubApp: { id: 1144995, nodeId: 'A_kwHOAOQ6Gs4AEXij',
      slug: 'chatgpt-codex-connector' },
    createdAt: '2026-08-09T14:00:00.000Z', ...overrides };
}

function legacyHostedReviewRequestComment(input: Readonly<{
  repository: string;
  sessionRevision: SessionDigest;
  operationId: SessionDigest;
  prNumber: number;
  headSha: string;
  sourceRunId: string;
  sourceRunAttempt: number;
  workflowRef: string;
}>, includeSpreadRepository: boolean): string {
  const requestDigest = `sha256:${createHash('sha256').update(encodeVerificationActionDataV2({
    sessionRevision: input.sessionRevision,
    operationId: input.operationId,
    prNumber: input.prNumber,
    headSha: input.headSha
  })).digest('hex')}` as SessionDigest;
  const payload = {
    schema: VERIFICATION_SESSION_REVIEW_REQUEST_COMMENT_SCHEMA_V1,
    ...(includeSpreadRepository ? { repository: input.repository } : {}),
    sessionRevision: input.sessionRevision,
    operationId: input.operationId,
    requestDigest,
    prNumber: input.prNumber,
    headSha: input.headSha,
    sourceRunId: input.sourceRunId,
    sourceRunAttempt: input.sourceRunAttempt,
    workflowRef: input.workflowRef
  };
  const publication = {
    ...payload,
    publicationDigest: `sha256:${createHash('sha256')
      .update(encodeVerificationActionDataV2(payload)).digest('hex')}` as SessionDigest
  };
  return `@codex review\n\n${VERIFICATION_SESSION_REVIEW_REQUEST_COMMENT_MARKER_V1}\n` +
    `\`\`\`json\n${encodeVerificationActionDataV2(publication)}\n\`\`\``;
}

function actionsIssueComment(body: string, id = '101'): GitHubIssueCommentObservationV1 {
  return botIssueComment(body, {
    id,
    authorLogin: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.login,
    authorId: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.id,
    authorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.nodeId,
    authorType: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.type,
    performedViaGitHubApp: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app
  });
}

function observe(transport: FakeTransport) {
  return evaluateVerificationSessionReviewObservationV1(transport, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
    observedAt: '2026-08-09T14:01:00.000Z'
  });
}

function expectTypedProviderSchemaUnsupported(observation: GitHubReviewBarrierObservationV1): void {
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
  privateGhProxySuiteRoot = mkdtempSync(path.join(tmpdir(), 'sec-private-gh-proxy-'));
  const source = path.join(privateGhProxySuiteRoot, 'gh-proxy.ts');
  const output = path.join(privateGhProxySuiteRoot, process.platform === 'win32' ? 'gh.exe' : 'gh');
  writeFileSync(source, `
import { pathToFileURL } from 'node:url';
const runner = process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER;
if (!runner) throw new Error('SEC_VERIFICATION_SESSION_TEST_GH_RUNNER is required');
await import(pathToFileURL(runner).href);
`, 'utf8');
  const compiled = spawnSync(process.execPath, [
    'build', '--compile', source, '--outfile', output
  ], { encoding: 'utf8', windowsHide: true });
  if (compiled.status !== 0) {
    throw new Error(`cannot compile private gh proxy: ${compiled.stderr || compiled.stdout}`);
  }
  return privateGhProxySuiteRoot;
}

function observePrivateGhProviderBarrier(
  mode: 'clear' | 'candidate' | 'permission' | 'trusted-app' | 'review-post-normalization'
    | 'thread-post-normalization' | 'request-post-normalization' | 'issue-post-normalization',
  malformedSource: string,
  observedAt = '2026-08-09T14:01:00.000Z'
) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-provider-shape-gh-'));
  const runner = path.join(root, 'gh-provider-shape.mjs');
  const candidate = {
    number: 42, state: 'OPEN', isDraft: false, isCrossRepository: false,
    author: { id: 'AUTHOR' }, baseRefName: 'main', baseRefOid: BASE,
    headRefName: 'feature/provider-shape', headRefOid: HEAD,
    title: 'Safe provider shape candidate', body: '', mergeCommit: null
  };
  const reviewAuthor = mode === 'trusted-app'
    ? { __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/chatgpt-codex-connector' }
    : { __typename: 'User', id: 'REVIEWER', login: 'reviewer', resourcePath: '/reviewer' };
  writeFileSync(runner, `
const args = process.argv.slice(2);
const mode = ${JSON.stringify(mode)};
const malformedSource = ${JSON.stringify(malformedSource)};
const candidate = ${JSON.stringify(candidate)};
const base = ${JSON.stringify(BASE)};
const head = ${JSON.stringify(HEAD)};
const reviewAuthor = ${JSON.stringify(reviewAuthor)};
const out = (value) => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0); };
const endpoint = args[0] === 'api' ? args[1] : '';
if (args[0] === 'pr' && args[1] === 'view') out(candidate);
if (endpoint.includes('/git/commits/')) {
  if (endpoint.endsWith('/' + base)) out(mode === 'candidate' ? malformedSource : base + '\\n');
  if (endpoint.endsWith('/' + head)) out(head + '\\n');
}
if (endpoint === 'graphql') {
  const query = args.find((argument) => argument.startsWith('query=')) || '';
  const page = (connection) => [{ data: { repository: { pullRequest: connection } } }];
  const terminal = { hasNextPage: false, endCursor: null };
  if (query.includes('closingIssuesReferences(first:100')) {
    out({ data: { repository: { pullRequest: { number: candidate.number,
      title: candidate.title, body: candidate.body, state: candidate.state,
      mergeCommit: candidate.mergeCommit,
      closingIssuesReferences: { totalCount: 0, nodes: [], pageInfo: terminal } } } } });
  }
  if (query.includes('reviews(first')) {
    out(page({ reviews: { nodes: [{ id: 'R1',
      state: mode === 'review-post-normalization' ? malformedSource : 'APPROVED',
      submittedAt: '2026-08-09T14:00:00.000Z', commit: { oid: head }, author: reviewAuthor
    }], pageInfo: terminal } }));
  }
  if (query.includes('reviewThreads(first')) {
    const nodes = mode === 'thread-post-normalization' ? [{ id: 'T1', isResolved: malformedSource,
      isOutdated: false, path: 'src/example.ts', comments: { nodes: [], pageInfo: terminal } }] : [];
    out(page({ reviewThreads: { nodes, pageInfo: terminal } }));
  }
  if (query.includes('reviewRequests(first')) {
    const nodes = mode === 'request-post-normalization'
      ? [{ requestedReviewer: { id: 'USER_request', login: malformedSource } }]
      : [];
    out(page({ reviewRequests: { nodes, pageInfo: terminal } }));
  }
}
if (endpoint === '/apps/chatgpt-codex-connector') {
  out(mode === 'trusted-app' ? malformedSource : { id: 1144995, node_id: 'A_kwHOAOQ6Gs4AEXij', slug: 'chatgpt-codex-connector' });
}
if (endpoint.endsWith('/permission')) out(mode === 'permission' ? malformedSource : 'maintain\\n');
if (endpoint.endsWith('/issues/42/comments?per_page=100')) {
  const nodes = mode === 'issue-post-normalization' ? [
    { id: 101, body: malformedSource, created_at: '2026-08-09T14:00:00.000Z', user: { login: 'reviewer', id: 7, node_id: 'USER_reviewer', type: 'User' }, performed_via_github_app: null },
    { id: 101, body: 'duplicate', created_at: '2026-08-09T14:00:01.000Z', user: { login: 'reviewer', id: 7, node_id: 'USER_reviewer', type: 'User' }, performed_via_github_app: null }
  ] : [];
  out([nodes]);
}
process.stderr.write('unsupported private provider fixture command: ' + args.join(' '));
process.exit(1);
`, 'utf8');
  const proxyRoot = privateGhProxyRoot();
  const previousPath = process.env.PATH;
  const previousRunner = process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER;
  process.env.PATH = `${proxyRoot}${path.delimiter}${previousPath ?? ''}`;
  process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER = runner;
  try {
    return createVerificationSessionGitHubClientV1(root).observeReviewBarrier({
      repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
      excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
      observedAt
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousRunner === undefined) delete process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER;
    else process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER = previousRunner;
    rmSync(root, { recursive: true, force: true });
  }
}

const privateClearReviewBarriers = new Map<string,
  Extract<GitHubReviewBarrierObservationV1, { status: 'clear' }>>();

function observePrivateClearReviewBarrier(observedAt: string): Extract<GitHubReviewBarrierObservationV1, { status: 'clear' }> {
  const cached = privateClearReviewBarriers.get(observedAt);
  if (cached !== undefined) return cached;
  const barrier = observePrivateGhProviderBarrier('clear', '', observedAt);
  if (barrier.status !== 'clear') throw new Error('production private adapter fixture Review must be clear');
  privateClearReviewBarriers.set(observedAt, barrier);
  return barrier;
}

function fakeGitHubClient(
  transport: FakeTransport,
  observePrivateBarrier?: (input: Parameters<VerificationSessionGitHubClientV1['observeReviewBarrier']>[0]) => GitHubReviewBarrierObservationV1
): VerificationSessionGitHubClientV1 {
  const client: Pick<VerificationSessionGitHubClientV1,
    'observeCandidate' | 'observeReviewBarrier' | 'observePrincipalByNodeId'
    | 'observePlatformEnforcement' | 'observeComparison' | 'ensureVerificationSessionWakeup'> = {
    observeCandidate: () => transport.candidate(),
    observeReviewBarrier: (input) => observePrivateBarrier?.(input)
      ?? evaluateVerificationSessionReviewObservationV1(transport, input),
    observePrincipalByNodeId: (repository, nodeId) => transport.principalByNodeId(repository, nodeId),
    observePlatformEnforcement: (repository) => evaluatePlatformEnforcementObservationV1({
      repository,
      readRulesets: () => transport.repositoryRulesets()
    }),
    observeComparison: (repository, baseSha, headSha) => transport.comparison(repository, baseSha, headSha),
    ensureVerificationSessionWakeup: () => transport.ensureVerificationSessionWakeup()
  };
  return client as unknown as VerificationSessionGitHubClientV1;
}

function mainHealthCheck(overrides: Partial<GitHubCheckObservationV1> = {}): GitHubCheckObservationV1 {
  const eventName = overrides.eventName ?? CI_MAIN_HEALTH_POLICY_V1.producer.eventNames[0];
  const workflowRunDisplayTitle = CI_MAIN_HEALTH_POLICY_V1.producer.runTitleFormats.repositoryDispatch
    .replace('<exact-main-sha>', BASE)
    .replace('<request-operation-id>', createCiMainHealthRequestOperationIdV1(BASE));
  return {
    id: 7, name: CI_MAIN_HEALTH_POLICY_V1.context, status: 'completed', conclusion: 'success',
    headSha: BASE, detailsUrl: 'https://github.example/actions/runs/7', appId: CI_MAIN_HEALTH_POLICY_V1.app.id,
    appNodeId: CI_MAIN_HEALTH_POLICY_V1.app.nodeId, appSlug: CI_MAIN_HEALTH_POLICY_V1.app.slug,
    workflowPath: CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath,
    workflowRef: `${CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath}@${BASE}`,
    eventName,
    workflowRunId: '7',
    workflowRunDisplayTitle,
    ...overrides
  };
}

const V6_MANIFEST_PATH = 'docs/work-packages/verification-action-trusted-cutover-v6.md';
const V6_MANIFEST_DIGEST = 'sha256:decaeacc27a8cc249f524736e16a3bfc407fff72adc7932233ce0dff5c57d16f' as const;
const VERIFIED_AT = '2026-08-09T14:01:00.000Z';
const MERGE_AT = '2026-08-09T14:05:00.000Z';

function actionDependencyBlobs(driftPath?: (typeof CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2)[number]) {
  return CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2.map((dependencyPath) => ({
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
  session: VerificationSessionV2;
  scope: ScopeAuthorizationV1;
  barrier: Extract<GitHubReviewBarrierObservationV1, { status: 'clear' }>;
  candidateAuthorNodeId: string;
  integrationPrincipalNodeId: string;
  expiresAt: string;
  operationId: `sha256:${string}`;
}) {
  return createReviewStabilityReceiptV1({
    stage: input.stage, repository: input.session.repository, prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision,
    scopeAuthorizationRevision: input.scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: input.scope.authorizationDigest,
    headSha: input.session.headSha, headTreeSha: input.session.headTreeSha,
    policy: SEC_REVIEW_STABILITY_POLICY_V1, principal: input.barrier.principal,
    independence: { candidateAuthorNodeId: input.candidateAuthorNodeId,
      integrationPrincipalNodeId: input.integrationPrincipalNodeId },
    producer: {
      identity: 'scripts/codex/verification-session-github.ts',
      executionIdentity: input.barrier.authority.executionIdentity,
      providerIdentity: input.barrier.authority.providerIdentity,
      candidateWriteCapability: input.barrier.authority.candidateWriteCapability,
      capabilityReceiptDigest: input.barrier.authority.capabilityReceiptDigest,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
      sourceTransport: input.barrier.authority.sourceTransport,
      sourceRunId: input.operationId,
      sourceRef: `github://${input.session.repository}/pull/${input.session.prNumber}@${input.session.headSha}`,
      sourceDigest: input.barrier.authority.sourceDigest
    },
    snapshot: input.barrier.snapshot, reviewedAt: input.barrier.observedAt, expiresAt: input.expiresAt
  });
}

function createPureHostedEnvelopeFixture(input: {
  request: VerificationSessionHostedRequestV1;
  facts: VerificationSessionHostedFactsV1;
}): VerificationSessionHostedEnvelopeV1 {
  const { request, facts } = input;
  const scopeAuthorization = createScopeAuthorizationV1({
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
  const mainHealth = createMainHealthLedgerV1(facts.mainHealth);
  const session = createVerificationSessionV2({
    sessionId: facts.sessionId, createdAt: facts.createdAt, repository: facts.repository,
    prNumber: request.prNumber, baseSha: request.expectedBaseSha,
    baseTreeSha: request.expectedBaseTreeSha, headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha, manifestPath: request.manifestPath,
    manifestDigest: request.manifestDigest, sessionProposalDigest: facts.sessionProposalDigest,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionPlanClosureDigest: facts.actionPlanClosure.actionPlanDigest, profile: request.profile,
    environmentDigest: facts.environmentDigest, trustRevision: request.expectedBaseSha,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY_V1.policyDigest,
    evidenceRequirementDigest: facts.evidenceRequirementDigest,
    integrationPolicyDigest: facts.integrationPolicyDigest,
    mainHealthRef: { mainSha: mainHealth.mainSha, mainTreeSha: mainHealth.mainTreeSha,
      healthRevision: mainHealth.healthRevision, ledgerReceiptDigest: mainHealth.ledgerDigest }
  });
  const preGateReview = createPureReviewFixture({ stage: 'pre-expensive', session, scope: scopeAuthorization,
    barrier: facts.reviewBarrier, candidateAuthorNodeId: facts.candidate.authorNodeId,
    integrationPrincipalNodeId: facts.integrationPrincipalNodeId, expiresAt: facts.reviewExpiresAt,
    operationId: `sha256:${'f'.repeat(64)}` });
  const withoutDigest = Object.freeze({ schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1,
    requestOperationId: request.requestOperationId, scopeAuthorization, preGateReview, mainHealth, session,
    actionPlanClosure: facts.actionPlanClosure });
  const envelopeDigest = `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(withoutDigest)).digest('hex')}` as const;
  return Object.freeze({ ...withoutDigest, envelopeDigest });
}

function reducerFixture(options: {
  now?: string;
  mergeAt?: string;
  authorizationExpiresAt?: string;
  consumed?: boolean;
  closeout?: 'completed' | 'protected-pending' | 'blocked' | 'residue';
  localDefaultSha?: string;
  remoteDefaultSha?: string;
  baseToMerge?: GitHubComparisonObservationV1;
  mergeToDefault?: GitHubComparisonObservationV1;
} = {}) {
  const mergeAt = options.mergeAt ?? MERGE_AT;
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-'));
  const transport = new ReducerTransport();
  transport.issueComments = [[botIssueComment()]];
  const github = fakeGitHubClient(transport, (input) => observePrivateClearReviewBarrier(
    input.observedAt ?? VERIFIED_AT
  ));
  const barrier = github.observeReviewBarrier({ repository: 'sec-platform/sec', prNumber: 42,
    headSha: HEAD, excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']), observedAt: VERIFIED_AT });
  if (barrier.status !== 'clear') throw new Error('fixture Review must be clear');
  const changedPaths = ['scripts/codex/verification-session.ts'];
  const testImpactTransition = changedTransition(changedPaths);
  const local = prepareTrustedMainVerificationSessionV1({ repository: 'sec-platform/sec',
    candidate: transport.candidate(), manifestPath: V6_MANIFEST_PATH, manifestDigest: V6_MANIFEST_DIGEST,
    changedPaths, testImpactTransition, profile: 'quick', integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '100',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: VERIFIED_AT,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs() });
  const facts = reconstructVerificationSessionHostedFactsV1({ request: local.request,
    repository: 'sec-platform/sec', candidate: transport.candidate(), changedPaths, testImpactTransition,
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: '100', sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs() });
  const envelope = createPureHostedEnvelopeFixture({ request: local.request, facts });
  const producer = CodexDevelopmentCreateVerificationEvidenceProducerV4({
    sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
    runId: '100', runAttempt: 1, actorNodeId: 'INTEGRATOR'
  });
  const gates = envelope.actionPlanClosure.actions.map(({ action }, index) => ({
    action,
    result: CodexDevelopmentBuildVerificationGateResultV1({
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
  const artifact = CodexDevelopmentFinalizeVerificationSessionArtifactV2({
    scopeAuthorization: envelope.scopeAuthorization, session: envelope.session,
    preGateReview: envelope.preGateReview, mainHealth: envelope.mainHealth, evidence, producer
  });
  const artifactText = `${encodeVerificationActionDataV2(artifact)}\n`;
  const hostedMetadata = {
    artifactId: '1000',
    artifactName: `sec-verification-session-v2-pr-42-session-${artifact.session.sessionRevision.slice(7)}-run-100-attempt-1`,
    archiveDigest: PAGE,
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
    runId: '100', runAttempt: 1, eventName: 'repository_dispatch', actorNodeId: 'INTEGRATOR',
    actorPermission: 'maintain' as const, expired: false
  };
  const hostedObservation = createHostedArtifactObservationV2({ artifact, artifactText,
    observation: hostedMetadata });
  const preMergeBarrier = github.observeReviewBarrier({ repository: 'sec-platform/sec', prNumber: 42,
    headSha: HEAD, excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']), observedAt: mergeAt });
  if (preMergeBarrier.status !== 'clear') throw new Error('fixture pre-merge Review must be clear');
  const preMergeReview = createPureReviewFixture({ stage: 'pre-merge',
    session: artifact.session, scope: artifact.scopeAuthorization, barrier: preMergeBarrier,
    candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR',
    expiresAt: '2026-08-09T14:20:00.000Z', operationId: PAGE });
  const mergeWorkflowRef = `.github/workflows/sec-merge-gate.yml@${BASE}`;
  const freshMainHealth = createMainHealthLedgerV1(createObservedMainHealthInputV1({
    repository: 'sec-platform/sec', mainSha: BASE, mainTreeSha: BASE, trustRevision: BASE,
    observedAt: mergeAt, expiresAt: '2026-08-09T14:20:00.000Z', sourceRunId: '200',
    sourceRef: mergeWorkflowRef, checks: [mainHealthCheck()]
  }));
  const platform = github.observePlatformEnforcement('sec-platform/sec');
  if (platform.status === 'unknown') throw new Error('fixture platform observation must be known');
  const consumptionOperationId = createVerificationSessionMergeOperationIdV1({
    sessionRevision: artifact.session.sessionRevision, headSha: HEAD,
    actionPlanDigest: artifact.session.actionPlanClosureDigest
  });
  const mergeInput = prepareVerificationSessionMergeInputV2({ artifact, preMergeReview,
    platform, hostedArtifactOrigin: hostedObservation, hostedArtifactTransport: hostedObservation,
    candidate: { repository: 'sec-platform/sec', prNumber: 42, draft: false,
      headOpenPullRequestCount: 1, currentBaseSha: BASE, currentBaseTreeSha: BASE,
      headSha: HEAD, headTreeSha: HEAD, baseIsAncestor: true, behindBy: 0,
      manifestPath: V6_MANIFEST_PATH, manifestDigest: V6_MANIFEST_DIGEST, changedPaths },
    provenance: { workflowPath: '.github/workflows/sec-merge-gate.yml', workflowRef: mergeWorkflowRef,
      workflowSha: BASE, eventName: 'workflow_run', sourceRunId: '200', sourceRunAttempt: 1,
      actorNodeId: 'INTEGRATOR', actorPermission: 'maintain' },
    mainHealth: freshMainHealth, consumptionOperationId, issuedAt: mergeAt,
    expiresAt: options.authorizationExpiresAt ?? '2026-08-09T14:10:00.000Z'
  });
  const result = CodexDevelopmentEvaluateMergeGateV2(mergeInput);
  const authorizationPublicationId = `sha256:${createHash('sha256').update(encodeVerificationActionDataV2({
    consumptionOperationId: result.authorization.consumptionOperationId,
    authorizationReceiptDigest: result.authorization.receiptDigest
  })).digest('hex')}` as const;
  const authorizationMetadata = {
    artifactId: '2000',
    artifactName: `sec-merge-gate-result-v2-pr-42-session-${artifact.session.sessionRevision.slice(7)}-run-200-attempt-1`,
    archiveDigest: PAGE,
    workflowPath: '.github/workflows/sec-merge-gate.yml', workflowRef: mergeWorkflowRef,
    workflowSha: BASE, runId: '200', runAttempt: 1, eventName: 'workflow_run',
    actorNodeId: 'INTEGRATOR', actorPermission: 'maintain' as const, expired: false
  };
  let trustedAuthorization = createTrustedIntegrationAuthorizationArtifactV1({
    resultJson: encodeVerificationActionDataV2(result), observation: authorizationMetadata
  });
  const preparation = createBranchCloseoutPreparation({ preparedAt: MERGE_AT,
    repository: { root: repositoryRoot, commonDir: path.join(repositoryRoot, '.git'),
      fullName: 'sec-platform/sec', remote: 'origin', defaultBranch: 'main' },
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
        workingTreeClean: true, tcbClosureMatched: true, runtimeEntrypointBlobMatched: true,
        boundaryTargetsMatched: true };
    },
    runLocalActions: () => ({ status: 'passed', resultDigest: artifact.evidence.evidenceDigest as `sha256:${string}` }),
    hostedArtifact: () => ({ artifact, provenance: createTrustedHostedArtifactProvenanceV1({
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
      binding: createBranchCloseoutOperationBindingV1({ integrationAuthorization: authorization,
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
  const markers = integrationAuthorizationMergeMarkersV1({ sessionRevision: artifact.session.sessionRevision,
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
  return { repositoryRoot, transport, github, artifact, result, external, counters, changedPaths,
    testImpactTransition, markers,
    request: local.request, preparation,
    setAuthorizationResult: (next: CodexDevelopmentMergeGateResultV2 | string) => {
      trustedAuthorization = typeof next === 'string'
        ? { ...trustedAuthorization, resultJson: next }
        : createTrustedIntegrationAuthorizationArtifactV1({
            resultJson: encodeVerificationActionDataV2(next), observation: authorizationMetadata });
    },
    dispose: () => rmSync(repositoryRoot, { recursive: true, force: true }) };
}

function runReducer(fixture: ReturnType<typeof reducerFixture>) {
  return resumeVerificationSessionV2({ repositoryRoot: fixture.repositoryRoot,
    session: fixture.artifact.session, scopeAuthorization: fixture.artifact.scopeAuthorization,
    changedPaths: fixture.changedPaths, testImpactTransition: fixture.testImpactTransition,
    integrationPrincipalNodeId: 'INTEGRATOR',
    github: fixture.github, external: fixture.external });
}

function durablePublication(fixture: ReturnType<typeof reducerFixture>): Readonly<{
  commentId: number;
  publication: IntegrationAuthorizationOperationPublicationV1;
}> {
  const remote = fixture.external.integrationAuthorizationPublication();
  if (remote === null) throw new Error('fixture authorization publication is unavailable');
  const publication = {
    schema: 'sec-integration-authorization-operation-publication-v1',
    repository: 'sec-platform/sec',
    pullRequestNumber: 42,
    sessionRevision: fixture.artifact.session.sessionRevision,
    authorizationId: remote.authorizationId,
    authorizationPublicationId: remote.authorizationPublicationId,
    authorizationReceiptDigest: remote.authorizationReceiptDigest,
    consumptionOperationId: remote.consumptionOperationId,
    result: fixture.result,
    closeoutPreparation: { preparation: fixture.preparation },
    recoveryArtifact: {},
    provenance: {},
    publicationDigest: remote.authorizationPublicationDigest
  } as unknown as IntegrationAuthorizationOperationPublicationV1;
  return Object.freeze({ commentId: remote.commentId, publication });
}

function substituteAuthorizationLiveIdentity(
  fixture: ReturnType<typeof reducerFixture>,
  identity: { repository?: string; prNumber?: number }
): CodexDevelopmentMergeGateResultV2 {
  const previous = fixture.result.authorization;
  const { schema: _schema, authorizationId: _authorizationId, receiptDigest: _receiptDigest,
    ...authorizationInput } = previous;
  const authorization = createIntegrationAuthorizationV1({ ...authorizationInput, ...identity });
  const renamePr = (name: string) => identity.prNumber === undefined
    ? name
    : name.replace('-pr-42-', `-pr-${identity.prNumber}-`);
  const withoutDigest = Object.freeze({
    schema: fixture.result.schema,
    status: fixture.result.status,
    authorization,
    reviewReceipt: fixture.result.reviewReceipt,
    mainHealth: fixture.result.mainHealth,
    platformObservation: fixture.result.platformObservation,
    hostedArtifactOrigin: Object.freeze({ ...fixture.result.hostedArtifactOrigin,
      artifactName: renamePr(fixture.result.hostedArtifactOrigin.artifactName) }),
    hostedArtifactTransport: Object.freeze({ ...fixture.result.hostedArtifactTransport,
      artifactName: renamePr(fixture.result.hostedArtifactTransport.artifactName) }),
    provenance: fixture.result.provenance,
    terminalStatusContext: fixture.result.terminalStatusContext
  });
  const resultDigest = `sha256:${createHash('sha256').update(
    encodeVerificationActionDataV2(withoutDigest)
  ).digest('hex')}` as const;
  return Object.freeze({ ...withoutDigest, resultDigest });
}

test('trusted app review binds stable app/node and exact reviewed head', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const result = observe(transport);
  expect(result.status).toBe('clear');
  if (result.status !== 'clear') throw new Error('expected clear review');
  expect(result.principal).toEqual({ kind: 'github-app', actorNodeId: BOT, appId: 1144995,
    appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' });
  expect(result.snapshot.reviewedHeadSha).toBe(HEAD);
  expect(result.authority.sourceTransport).toBe('github-rest');
  expect(result.snapshot.reviewPageDigests).toContain(result.authority.sourceDigest);
});

test('REST clean verdict accepts only provider-resolved exact 10/full locator and rejects prefix ambiguity', () => {
  for (const locator of ['2'.repeat(7), '2'.repeat(39), 'a'.repeat(10), 'a'.repeat(40)]) {
    const transport = new FakeTransport();
    transport.issueComments = [[botIssueComment(
      `Codex Review: Didn't find any major issues. Bravo.\n\n**Reviewed commit:** \`${locator}\``
    )]];
    expect(observe(transport)).toMatchObject({ status: 'waiting',
      reason: 'exact-head-independent-review-missing' });
  }
  const ambiguous = new FakeTransport();
  ambiguous.issueComments = [[botIssueComment()]];
  ambiguous.resolutions.set(HEAD.slice(0, 10), { repository: 'sec-platform/sec',
    locator: HEAD.slice(0, 10), status: 'ambiguous', commitSha: null, treeSha: null,
    responseDigest: `sha256:${'9'.repeat(64)}` });
  expect(observe(ambiguous)).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });

  const wrongTree = new FakeTransport();
  wrongTree.issueComments = [[botIssueComment()]];
  wrongTree.resolutions.set(HEAD.slice(0, 10), { repository: 'sec-platform/sec',
    locator: HEAD.slice(0, 10), status: 'resolved', commitSha: HEAD, treeSha: BASE,
    responseDigest: `sha256:${'8'.repeat(64)}` });
  expect(observe(wrongTree)).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });

  const suggestion = new FakeTransport();
  suggestion.issueComments = [[botIssueComment(
    `### 💡 Codex Review\n\nHere are some automated review suggestions.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``
  )]];
  expect(observe(suggestion)).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });

  const wrongAppNode = new FakeTransport();
  wrongAppNode.issueComments = [[botIssueComment(undefined, {
    performedViaGitHubApp: { id: 1144995, nodeId: 'A_wrong', slug: 'chatgpt-codex-connector' }
  })]];
  expect(observe(wrongAppNode)).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });
});

test('second-page unresolved thread fails closed', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  transport.threads = [[], [{ id: 'T2', isResolved: false, isOutdated: false, path: 'x.ts', authorNodeIds: ['R'] }]];
  expect(observe(transport)).toMatchObject({ status: 'blocked', reason: 'unresolved-review-thread' });
});

test('an unresolved outdated thread remains blocking', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  transport.threads = [[{ id: 'T-outdated', isResolved: false, isOutdated: true,
    path: 'old.ts', authorNodeIds: ['REVIEWER'] }]];
  expect(observe(transport)).toMatchObject({ status: 'blocked', reason: 'unresolved-review-thread' });
});

test('current exact-head REQUEST_CHANGES blocks even with a trusted app comment', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  transport.reviews = [[{
    id: 'R1', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
    appId: null, appNodeId: null, appSlug: null,
    commitSha: HEAD, state: 'CHANGES_REQUESTED', submittedAt: '2026-08-09T14:00:00.000Z'
  }]];
  expect(observe(transport)).toMatchObject({ status: 'blocked', reason: 'request-changes-current' });
});

test('old-head REQUEST_CHANGES survives a new-head COMMENTED review and clean app verdict', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  transport.reviews = [[
    { id: 'R1', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null,
      commitSha: BASE, state: 'CHANGES_REQUESTED', submittedAt: '2026-08-09T13:58:00.000Z' },
    { id: 'R2', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null,
      commitSha: HEAD, state: 'COMMENTED', submittedAt: '2026-08-09T13:59:00.000Z' }
  ]];
  expect(observe(transport)).toMatchObject({ status: 'blocked', reason: 'request-changes-current' });

  transport.reviews[0]!.push({ id: 'R3', authorNodeId: 'REVIEWER', authorLogin: 'reviewer',
    authorType: 'User', appId: null,
    appNodeId: null, appSlug: null,
    commitSha: HEAD, state: 'APPROVED', submittedAt: '2026-08-09T14:00:30.000Z' });
  expect(observe(transport).status).toBe('clear');
});

test('formal trusted App COMMENTED suggestion cannot clear without an explicit clean REST verdict', () => {
  const transport = new FakeTransport();
  transport.reviews = [[{ id: 'R-app', authorNodeId: BOT, authorLogin: 'codex-review[bot]',
    authorType: 'Bot',
    appId: 1144995, appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector',
    commitSha: HEAD, state: 'COMMENTED', submittedAt: '2026-08-09T14:00:00.000Z' }]];
  expect(observe(transport)).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });
});

test('formal trusted App APPROVED binds GraphQL authority and excluded principals never clear', () => {
  const approved = new FakeTransport();
  approved.reviews = [[{ id: 'R-app', authorNodeId: BOT, authorLogin: 'codex-review[bot]',
    authorType: 'Bot',
    appId: 1144995, appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector',
    commitSha: HEAD, state: 'APPROVED', submittedAt: '2026-08-09T14:00:00.000Z' }]];
  const clear = observe(approved);
  expect(clear.status).toBe('clear');
  if (clear.status !== 'clear') throw new Error('expected formal App approval');
  expect(clear.authority.sourceTransport).toBe('github-graphql');
  expect(() => assertGitHubReviewAuthorityObservationV1(clear)).toThrow(
    'Review receipt authority must be a live observation produced by the private GitHub adapter.'
  );

  const excluded = evaluateVerificationSessionReviewObservationV1(approved, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set([BOT]), observedAt: '2026-08-09T14:01:00.000Z'
  });
  expect(excluded.status).toBe('waiting');
});

test('production Review authority adapter cannot have its private transport reflectively replaced', () => {
  const client = createVerificationSessionGitHubClientV1(process.cwd());
  expect(Reflect.set(client as object, 'transport', new FakeTransport())).toBe(false);
  expect(Object.getOwnPropertyNames(client)).not.toContain('transport');
});

test('private gh producer and post-normalization boundaries bind distinct raw pages only into typed digests', () => {
  const observeFailure = (mode: 'candidate' | 'permission' | 'trusted-app' | 'review-post-normalization'
    | 'thread-post-normalization' | 'request-post-normalization' | 'issue-post-normalization', first: string, second: string) => {
    const left = observePrivateGhProviderBarrier(mode, first);
    const right = observePrivateGhProviderBarrier(mode, second);
    expect(left).toMatchObject({ status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
      reasonCode: 'github-provider-response-shape-unsupported' });
    expect(right).toMatchObject({ status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
      reasonCode: 'github-provider-response-shape-unsupported' });
    if (left.status !== PROVIDER_SCHEMA_UNSUPPORTED_STATUS
      || right.status !== PROVIDER_SCHEMA_UNSUPPORTED_STATUS) throw new Error('expected typed provider shape failure');
    expect(left.responseDigest).not.toBe(right.responseDigest);
    expect(JSON.stringify(left)).not.toContain(first);
    expect(JSON.stringify(right)).not.toContain(second);
  };

  observeFailure('candidate', 'not-a-candidate-tree-one\\n', 'not-a-candidate-tree-two\\n');
  observeFailure('permission', 'unsupported-permission-one\\n', 'unsupported-permission-two\\n');
  observeFailure('trusted-app',
    '{"id":1144994,"node_id":"A_kwHOAOQ6Gs4AEXij","slug":"chatgpt-codex-connector"}',
    '{"id":1144993,"node_id":"A_kwHOAOQ6Gs4AEXij","slug":"chatgpt-codex-connector"}'
  );
  observeFailure('review-post-normalization', 'UNSUPPORTED_STATE_ONE', 'UNSUPPORTED_STATE_TWO');
  observeFailure('thread-post-normalization', 'not-a-boolean-one', 'not-a-boolean-two');
  observeFailure('request-post-normalization', 'a'.repeat(257), 'b'.repeat(258));
  observeFailure('issue-post-normalization', 'duplicate-comment-body-one', 'duplicate-comment-body-two');
});

test('V9 final Review semantics filter marker quotes, resolve formal App identity, and retain decisive opinions', () => {
  const reviewRequestMarker = '<!-- sec-verification-session-review-request-v1 -->';
  const quotedMarker = new FakeTransport();
  quotedMarker.issueComments = [[
    botIssueComment(`Quoted for discussion: ${reviewRequestMarker}`, {
      id: '100', authorLogin: 'reviewer', authorId: 501, authorNodeId: 'REVIEWER',
      authorType: 'User', performedViaGitHubApp: null
    }),
    botIssueComment()
  ]];
  expect(observe(quotedMarker).status).toBe('clear');

  const malformedTrustedMarker = new FakeTransport();
  malformedTrustedMarker.issueComments = [[botIssueComment(reviewRequestMarker, {
    authorLogin: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.login,
    authorId: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.id,
    authorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.nodeId,
    authorType: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.type,
    performedViaGitHubApp: {
      id: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.id,
      nodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.nodeId,
      slug: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.slug
    }
  })]];
  expectTypedProviderSchemaUnsupported(observe(malformedTrustedMarker));

  const graphQlPage = (author: Record<string, unknown>) => [{ data: { repository: { pullRequest: {
    reviews: {
      nodes: [{ id: 'R-provider-app', state: 'APPROVED',
        submittedAt: '2026-08-09T14:00:00.000Z', commit: { oid: HEAD }, author }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  } } } }];
  let appResolutions = 0;
  const parsedApp = parseGitHubReviewPagesV1({
    source: graphQlPage({ __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/chatgpt-codex-connector' }),
    resolveApp: (slug) => {
      appResolutions += 1;
      expect(slug).toBe('chatgpt-codex-connector');
      return { id: 1144995, node_id: 'A_kwHOAOQ6Gs4AEXij', slug };
    }
  });
  expect(appResolutions).toBe(1);
  expect(parsedApp.nodes[0]).toMatchObject({ authorNodeId: BOT, authorType: 'Bot',
    appId: 1144995, appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector' });
  const resolvedWithDifferentRawBytes = parseGitHubReviewPagesV1({
    source: graphQlPage({ __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/chatgpt-codex-connector' }),
    resolveApp: (slug) => ({ id: 1144995, node_id: 'A_kwHOAOQ6Gs4AEXij', slug,
      providerObservation: 'different-raw-response' })
  });
  expect(resolvedWithDifferentRawBytes.pageDigest).not.toBe(parsedApp.pageDigest);
  const formalApp = new FakeTransport();
  formalApp.reviews = [[...parsedApp.nodes]];
  const formalAuthority = observe(formalApp);
  expect(formalAuthority).toMatchObject({ status: 'clear',
    authority: { sourceTransport: 'github-graphql' } });

  expect(() => parseGitHubReviewPagesV1({
    source: graphQlPage({ __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/not-the-trusted-app' }),
    resolveApp: () => ({ id: 1144995, node_id: 'A_kwHOAOQ6Gs4AEXij',
      slug: 'chatgpt-codex-connector' })
  })).toThrow(/actor path is ambiguous or drifted/i);
  expect(() => parseGitHubReviewPagesV1({
    source: graphQlPage({ __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/chatgpt-codex-connector' }),
    resolveApp: () => ({ id: 1144995, node_id: 'A_drifted', slug: 'chatgpt-codex-connector' })
  })).toThrow(/resolver identity drifted/i);
  let nonBotResolutions = 0;
  const nonBot = parseGitHubReviewPagesV1({
    source: graphQlPage({ __typename: 'User', id: BOT, login: 'not-an-app',
      resourcePath: '/apps/chatgpt-codex-connector' }),
    resolveApp: () => {
      nonBotResolutions += 1;
      return {};
    }
  });
  expect(nonBotResolutions).toBe(0);
  expect(nonBot.nodes[0]).toMatchObject({ authorType: 'User', appId: null,
    appNodeId: null, appSlug: null });

  const approvalThenComment = new FakeTransport();
  approvalThenComment.reviews = [[
    { id: 'R-approved', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'APPROVED',
      submittedAt: '2026-08-09T14:00:00.000Z' },
    { id: 'R-commented', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'COMMENTED',
      submittedAt: '2026-08-09T14:00:30.000Z' }
  ]];
  expect(observe(approvalThenComment).status).toBe('clear');

  const changesThenComment = new FakeTransport();
  changesThenComment.issueComments = [[botIssueComment()]];
  changesThenComment.reviews = [[
    { id: 'R-changes', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'CHANGES_REQUESTED',
      submittedAt: '2026-08-09T14:00:00.000Z' },
    { id: 'R-followup', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'COMMENTED',
      submittedAt: '2026-08-09T14:00:30.000Z' }
  ]];
  expect(observe(changesThenComment)).toMatchObject({ status: 'blocked',
    reason: 'request-changes-current' });

  const dismissedApprovalDoesNotEraseEarlierChanges = new FakeTransport();
  dismissedApprovalDoesNotEraseEarlierChanges.issueComments = [[botIssueComment()]];
  dismissedApprovalDoesNotEraseEarlierChanges.reviews = [[
    { id: 'R-active-changes', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'CHANGES_REQUESTED',
      submittedAt: '2026-08-09T14:00:00.000Z' },
    { id: 'R-dismissed-approval', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
      appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'DISMISSED',
      submittedAt: '2026-08-09T14:00:30.000Z' }
  ]];
  expect(observe(dismissedApprovalDoesNotEraseEarlierChanges)).toMatchObject({ status: 'blocked',
    reason: 'request-changes-current' });
});

test('review observation rejects unknown state and detects provider head drift', () => {
  const malformed = new FakeTransport();
  malformed.reviews = [[{ id: 'R-bad', authorNodeId: 'REVIEWER', authorLogin: 'reviewer',
    authorType: 'User',
    appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'PENDING' as never,
    submittedAt: '2026-08-09T14:00:00.000Z' }]];
  expectTypedProviderSchemaUnsupported(observe(malformed));

  class DriftingTransport extends FakeTransport {
    reads = 0;
    override candidate(): GitHubCandidateObservationV1 {
      const candidate = super.candidate();
      this.reads += 1;
      return this.reads === 1 ? candidate : { ...candidate, headSha: '3'.repeat(40) };
    }
  }
  const drift = new DriftingTransport();
  drift.issueComments = [[botIssueComment()]];
  expect(observe(drift)).toMatchObject({ status: 'blocked', reason: 'review-observation-head-drift' });
});

test('same-principal same-timestamp conflicting reviews fail closed instead of opaque-id ordering', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  transport.reviews = [[
    { id: 'opaque-a', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User', appId: null,
      appNodeId: null, appSlug: null, commitSha: BASE, state: 'CHANGES_REQUESTED',
      submittedAt: '2026-08-09T14:00:00.000Z' },
    { id: 'opaque-z', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User', appId: null,
      appNodeId: null, appSlug: null, commitSha: HEAD, state: 'APPROVED',
      submittedAt: '2026-08-09T14:00:00.000Z' }
  ]];
  expectTypedProviderSchemaUnsupported(observe(transport));
});

test('V8 GitHub observation regressions normalize timestamps, thread authors, reads, renames, titles, and shim resolution', () => {
  const review = new FakeTransport();
  review.reviews = [[{
    id: 'R-rfc3339', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
    appId: null, appNodeId: null, appSlug: null, commitSha: HEAD,
    state: 'APPROVED', submittedAt: '2026-08-09T14:00:00Z'
  }]];
  expect(observe(review).status).toBe('clear');

  const repeatedAuthor = new FakeTransport();
  repeatedAuthor.issueComments = [[botIssueComment(undefined, {
    createdAt: '2026-08-09T14:00:00Z'
  })]];
  repeatedAuthor.threads = [[{
    id: 'T-repeated-author', isResolved: true, isOutdated: false, path: 'renamed.ts',
    authorNodeIds: ['REVIEWER', 'REVIEWER']
  }]];
  expect(observe(repeatedAuthor).status).toBe('clear');

  const workflow = new FakeTransport();
  workflow.workflowRuns = [[workflowRun({ updatedAt: '2026-08-09T14:00:00.1Z' })]];
  expect(evaluateVerificationSessionWorkflowJoinV1(workflow, {
    repository: 'sec-platform/sec', prNumber: 42, sessionRevision: JOIN_SESSION,
    actionPlanDigest: JOIN_ACTION, baseSha: BASE, now: '2026-08-09T14:05:00Z'
  })).toMatchObject({ status: 'joined', reason: 'active-run' });

  const githubSource = readFileSync(
    path.resolve(import.meta.dir, '../../scripts/codex/verification-session-github.ts'),
    'utf8'
  );
  const changedPathsSource = githubSource.slice(
    githubSource.lastIndexOf('pullRequestFileInventory('),
    githubSource.lastIndexOf('blobText(repository:')
  );
  const blobTextSource = githubSource.slice(
    githubSource.lastIndexOf('blobText(repository:'),
    githubSource.lastIndexOf('comparison(repository:')
  );
  expect(changedPathsSource).toContain("'api', '--method', 'GET'");
  expect(changedPathsSource).toContain('parseGitHubPullRequestFileInventoryV1');
  expect(githubSource).toContain('entry.previous_filename');
  expect(blobTextSource).toContain("'api', '--method', 'GET'");
  expect(githubSource).toContain("client_payload: { payload: request }");
  expect(githubSource).toContain("'api', '--method', 'POST'");
  expect(githubSource).toContain("'--input', '-'");
  expect(githubSource).not.toContain('client_payload=${JSON.stringify(request)}');
  expect(githubSource).not.toContain('client_payload=${JSON.stringify({ payload: request })}');
  expect(resolveCloseoutCliGh.toString()).not.toContain('which');

  const shimRoot = mkdtempSync(path.join(tmpdir(), 'sec-node-native-gh-resolution-'));
  try {
    const executable = path.join(shimRoot, process.platform === 'win32' ? 'gh.exe' : 'gh');
    writeFileSync(executable, 'test shim', 'utf8');
    if (process.platform !== 'win32') chmodSync(executable, 0o755);
    const environment: NodeJS.ProcessEnv = {
      [process.platform === 'win32' ? 'Path' : 'PATH']: shimRoot
    };
    const resolution = resolveCloseoutCliGh(environment);
    expect(resolution.status).toBe(0);
    expect(path.resolve(resolution.stdout.trim())).toBe(path.resolve(executable));
  } finally {
    rmSync(shimRoot, { recursive: true, force: true });
  }
});

test('V8 final Review P2 regressions preserve dotted paths and bind complete nested thread pagination', () => {
  const changedPaths = (paths: readonly string[]) => {
    const metadata = JSON.stringify({ number: 42, changed_files: paths.length,
      state: 'open', draft: false, base: { sha: BASE }, head: { sha: HEAD } });
    const inventory = parseGitHubPullRequestFileInventoryV1({ repository: 'sec-platform/sec', prNumber: 42,
      beforeSource: metadata,
      pagesSource: JSON.stringify([paths.map((filename) => ({ filename, status: 'modified' }))]),
      afterSource: metadata });
    return evaluateVerificationSessionChangedPathsV1(
      { pullRequestFileInventory: () => inventory },
      { repository: 'sec-platform/sec', prNumber: 42, state: 'OPEN', draft: false,
        baseSha: BASE, headSha: HEAD }
    ).paths;
  };
  expect(changedPaths(['docs/v1..v2.md', 'src/review...fixture.ts']))
    .toEqual(['docs/v1..v2.md', 'src/review...fixture.ts']);
  for (const traversal of ['..', '../escape.ts', 'src/../escape.ts', 'src/a/../../escape.ts']) {
    expect(() => changedPaths([traversal]), traversal).toThrow(/changed-path observation is invalid/i);
  }

  const firstCommentPage = Array.from({ length: 100 }, () => ({ author: { id: 'REVIEWER' } }));
  const outerPages = [{
    data: { repository: { pullRequest: { reviewThreads: {
      nodes: [{
        id: 'T-101', isResolved: true, isOutdated: false, path: 'docs/v1..v2.md',
        comments: { nodes: firstCommentPage,
          pageInfo: { hasNextPage: true, endCursor: 'COMMENT-100' } }
      }],
      pageInfo: { hasNextPage: true, endCursor: 'THREAD-1' }
    } } } }
  }, {
    data: { repository: { pullRequest: { reviewThreads: {
      nodes: [{
        id: 'T-outer-2', isResolved: true, isOutdated: false, path: 'src/outer.ts',
        comments: { nodes: [{ author: { id: 'REVIEWER' } }],
          pageInfo: { hasNextPage: false, endCursor: 'COMMENT-1' } }
      }],
      pageInfo: { hasNextPage: false, endCursor: 'THREAD-2' }
    } } } }
  }];
  const parse = (lastAuthor: string, nextCursor: string | null = 'COMMENT-101') =>
    parseGitHubReviewThreadPagesV1({
      source: outerPages,
      readCommentPage: (threadId, after) => {
        expect({ threadId, after }).toEqual({ threadId: 'T-101', after: 'COMMENT-100' });
        return { data: { node: { id: threadId, comments: {
          nodes: [{ author: { id: lastAuthor } }],
          pageInfo: { hasNextPage: nextCursor === 'COMMENT-100', endCursor: nextCursor }
        } } } };
      }
    });
  const complete = parse('REVIEWER');
  expect(complete.nodes).toHaveLength(2);
  expect(complete.nodes[0]?.authorNodeIds).toHaveLength(101);
  expect(new Set(complete.nodes[0]?.authorNodeIds)).toEqual(new Set(['REVIEWER']));
  expect(parse('OTHER').pageDigest).not.toBe(complete.pageDigest);
  expect(() => parse('REVIEWER', 'COMMENT-100')).toThrow(/comment pagination did not advance/i);
  expect(() => parseGitHubReviewThreadPagesV1({
    source: [outerPages[0]],
    readCommentPage: () => { throw new Error('must not read an inner page before outer completeness'); }
  })).toThrow(/thread pagination is incomplete/i);
});

test('V9 PR file inventory binds changed_files and fails closed at cap, incompleteness, or drift', () => {
  const metadata = (changedFiles: number, baseSha = BASE, headSha = HEAD,
    state: 'open' | 'closed' = 'open', draft = false) => JSON.stringify({
    number: 42,
    changed_files: changedFiles,
    state,
    draft,
    base: { sha: baseSha },
    head: { sha: headSha }
  });
  const parse = (input: Partial<Parameters<typeof parseGitHubPullRequestFileInventoryV1>[0]> = {}) =>
    parseGitHubPullRequestFileInventoryV1({
      repository: 'sec-platform/sec',
      prNumber: 42,
      beforeSource: metadata(1),
      pagesSource: JSON.stringify([[
        { filename: 'src/new-name.ts', previous_filename: 'src/old-name.ts', status: 'renamed' }
      ]]),
      afterSource: metadata(1),
      ...input
    });

  const complete = parse();
  expect(complete.paths).toEqual(['src/new-name.ts', 'src/old-name.ts']);
  expect(complete).toMatchObject({ schema: 'sec-github-pr-files-inventory-v1',
    repository: 'sec-platform/sec', prNumber: 42, state: 'OPEN', draft: false,
    baseSha: BASE, headSha: HEAD, recordCount: 1, changedFiles: 1 });
  expect(complete.pageDigests).toHaveLength(1);
  expect(complete.inventoryDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  const expected = { repository: 'sec-platform/sec', prNumber: 42, state: 'OPEN' as const,
    draft: false as const, baseSha: BASE, headSha: HEAD };
  expect(evaluateVerificationSessionChangedPathsV1(
    { pullRequestFileInventory: () => complete }, expected
  )).toEqual(complete);

  const expectIdentityMismatchBeforeEffect = (
    inventory: ReturnType<typeof parseGitHubPullRequestFileInventoryV1>
  ) => {
    let authorizationReached = false;
    let physicalMergeReached = false;
    expect(() => {
      const observed = evaluateVerificationSessionChangedPathsV1(
        { pullRequestFileInventory: () => inventory }, expected
      );
      authorizationReached = observed.paths.length > 0;
      physicalMergeReached = authorizationReached;
    }).toThrow(/differs from the expected open candidate identity/i);
    expect(authorizationReached).toBe(false);
    expect(physicalMergeReached).toBe(false);
  };
  for (const inventory of [
    parse({ beforeSource: metadata(1, '3'.repeat(40), HEAD),
      afterSource: metadata(1, '3'.repeat(40), HEAD) }),
    parse({ beforeSource: metadata(1, BASE, '4'.repeat(40)),
      afterSource: metadata(1, BASE, '4'.repeat(40)) }),
    parse({ beforeSource: metadata(1, BASE, HEAD, 'closed'),
      afterSource: metadata(1, BASE, HEAD, 'closed') }),
    parse({ beforeSource: metadata(1, BASE, HEAD, 'open', true),
      afterSource: metadata(1, BASE, HEAD, 'open', true) })
  ]) expectIdentityMismatchBeforeEffect(inventory);

  const sessionSource = readFileSync(path.join(process.cwd(), 'scripts/codex/verification-session.ts'), 'utf8');
  const freshIntegrationSource = sessionSource.slice(
    sessionSource.indexOf('function evaluateFreshHostedIntegration(input:'),
    sessionSource.indexOf('type HostedIntegrationAuthorizationPublicationResultV1')
  );
  expect(freshIntegrationSource.indexOf('github.observeChangedPaths({')).toBeGreaterThan(-1);
  expect(freshIntegrationSource.indexOf('github.observeChangedPaths({'))
    .toBeLessThan(freshIntegrationSource.indexOf('prepareVerificationSessionMergeInputV2'));
  const integrateHostedSource = sessionSource.slice(
    sessionSource.indexOf("if (command === 'integrate-hosted')"),
    sessionSource.indexOf("if (command === 'closeout-mutate-hosted')")
  );
  const freshEvaluationIndex = integrateHostedSource.indexOf('evaluateFreshHostedIntegration({');
  const authorizationPublicationIndex = integrateHostedSource
    .indexOf('publishHostedIntegrationAuthorizationOperationV1');
  const postPublicationInventoryIndex = integrateHostedSource
    .indexOf("const changedPaths = route.lane === 'merged-recovery'");
  const physicalMergeIndex = integrateHostedSource.indexOf('executeHostedSquashMerge({');
  for (const boundary of [freshEvaluationIndex, authorizationPublicationIndex,
    postPublicationInventoryIndex, physicalMergeIndex]) expect(boundary).toBeGreaterThan(-1);
  expect(freshEvaluationIndex).toBeLessThan(authorizationPublicationIndex);
  expect(authorizationPublicationIndex).toBeLessThan(postPublicationInventoryIndex);
  expect(postPublicationInventoryIndex).toBeLessThan(physicalMergeIndex);

  expect(() => parse({
    pagesSource: JSON.stringify([[
      { filename: 'src/new-name.ts', status: 'renamed' }
    ]])
  })).toThrow(/renamed record has no previous_filename/i);
  expect(() => parse({
    pagesSource: JSON.stringify([[
      { filename: 'src/new-name.ts', previous_filename: 'src/new-name.ts', status: 'renamed' }
    ]])
  })).toThrow(/does not change its filename/i);
  expect(() => parse({
    pagesSource: JSON.stringify([[
      { filename: 'src/file.ts', status: 'mystery' }
    ]])
  })).toThrow(/status is unknown/i);
  expect(() => parse({
    pagesSource: JSON.stringify([[
      { filename: 'src/file.ts', previous_filename: 'src/old.ts', status: 'modified' }
    ]])
  })).toThrow(/non-renamed record unexpectedly has previous_filename/i);

  expect(() => parse({
    beforeSource: metadata(3001),
    afterSource: metadata(3001)
  })).toThrow(/3000-file completeness boundary/i);
  expect(() => parse({
    beforeSource: metadata(2),
    afterSource: metadata(2)
  })).toThrow(/record count differs.*changed_files/i);
  expect(() => parse({
    afterSource: metadata(1, BASE, 'f'.repeat(40))
  })).toThrow(/identity\/count drifted/i);
  expect(() => parse({
    afterSource: metadata(2)
  })).toThrow(/identity\/count drifted/i);
});

test('V9 GitHub observation exhausts stable same-head census and pairs copied paths', () => {
  const pull = (id: number, number: number, headSha = BASE, state = 'open') => ({
    id, number, state, head: { sha: headSha }
  });
  const leading = Array.from({ length: 100 }, (_, index) => pull(index + 1, index + 1));
  const finalPage = [pull(101, 101, HEAD), pull(102, 102, HEAD)];
  const census = (input: Partial<Parameters<typeof parseGitHubOpenPullRequestCensusV1>[0]> = {}) =>
    parseGitHubOpenPullRequestCensusV1({
      repository: 'sec-platform/sec',
      headSha: HEAD,
      firstPagesSource: JSON.stringify([leading, finalPage]),
      secondPagesSource: JSON.stringify([leading, finalPage]),
      ...input
    });
  expect(census()).toBe(2);
  for (const pages of [
    [leading, [pull(1, 103)]],
    [leading, [pull(103, 1)]],
    [leading, [{ id: 103, number: 103, state: 'closed', head: { sha: BASE } }]],
    [leading.slice(0, 99), finalPage]
  ]) expect(() => census({ firstPagesSource: JSON.stringify(pages) })).toThrow();
  const middle = Array.from({ length: 100 }, (_, index) => pull(index + 101, index + 101));
  const terminal = [pull(201, 201, HEAD), pull(202, 202, HEAD)];
  const shiftedMiddle = [...middle.slice(0, 99), terminal[0]!];
  expect(() => census({
    firstPagesSource: JSON.stringify([leading, middle, terminal]),
    secondPagesSource: JSON.stringify([leading, shiftedMiddle, [terminal[1]!]])
  })).toThrow(/changed between complete exhaustive passes/i);

  const metadata = JSON.stringify({ number: 42, changed_files: 1, state: 'open', draft: false,
    base: { sha: BASE }, head: { sha: HEAD } });
  const files = (record: Record<string, unknown>) => parseGitHubPullRequestFileInventoryV1({
    repository: 'sec-platform/sec', prNumber: 42, beforeSource: metadata,
    pagesSource: JSON.stringify([[record]]), afterSource: metadata
  });
  expect(files({ filename: 'src/copy.ts', previous_filename: 'src/source.ts', status: 'copied' }).paths)
    .toEqual(['src/copy.ts', 'src/source.ts']);
  expect(() => files({ filename: 'src/copy.ts', status: 'copied' }))
    .toThrow(/copied record has no previous_filename/i);
  expect(() => files({ filename: 'src/copy.ts', previous_filename: 'src/copy.ts', status: 'copied' }))
    .toThrow(/copied record does not change its filename/i);
  expect(() => files({ filename: 'src/file.ts', previous_filename: 'src/old.ts', status: 'modified' }))
    .toThrow(/non-renamed record unexpectedly has previous_filename/i);

  const source = readFileSync(path.join(process.cwd(), 'scripts/codex/verification-session-github.ts'), 'utf8');
  const censusSource = source.slice(source.lastIndexOf('openPullRequestCountForHead('),
    source.lastIndexOf('principal(repository:'));
  expect(censusSource).toContain("'api', '--method', 'GET', `/repos/${repository}/pulls`");
  expect(censusSource).toContain("'-f', 'state=open', '-f', 'sort=created', '-f', 'direction=asc'");
  expect(censusSource).toContain("readCensus('same-head PR first exhaustive census')");
  expect(censusSource).toContain("readCensus('same-head PR second exhaustive census')");
  expect(censusSource).toContain('parseGitHubOpenPullRequestCensusV1');
  expect(censusSource).not.toContain("'pr', 'list'");
  expect(censusSource).not.toContain("'--limit', '1000'");
});

test('V9 repository artifact census hydrates only live canonical Session-family summaries', () => {
  const sessionName = (runId: number, runAttempt: number, sessionByte: string) =>
    `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-pr-42-session-${sessionByte.repeat(64)}` +
      `-run-${runId}-attempt-${runAttempt}`;
  const summary = (id: number, name: string, expired = false,
    archiveDigest: SessionDigest | null = null) => ({ id, name, expired, digest: archiveDigest });
  const liveSession = summary(1001, sessionName(7001, 2, 'a'), false,
    `sha256:${'1'.repeat(64)}`);
  const expiredSession = summary(1002, sessionName(7002, 3, 'b'), true,
    `sha256:${'2'.repeat(64)}`);
  const unrelated = Array.from({ length: 100 }, (_, index) =>
    summary(index + 1, index === 99 ? 'coverage_report' : `diagnostic_report_${index}`));
  const source = [
    { total_count: 103, artifacts: unrelated },
    { total_count: 103, artifacts: [liveSession, expiredSession,
      summary(1003, 'release Notes — opaque')] }
  ];
  const hydrationCalls: string[] = [];
  const hydrated = evaluateGitHubRepositoryActionsArtifactInventoryV1({
    repository: 'sec-platform/sec',
    source,
    observeArtifact: (entry) => {
      hydrationCalls.push(entry.artifactId);
      return { artifactId: entry.artifactId, artifactName: entry.artifactName,
        archiveDigest: entry.archiveDigest, workflowPath: '.github/workflows/compiler-pr-validation.yml',
        workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
        runId: entry.expectedRunId!, runAttempt: entry.sessionRunAttempt!,
        eventName: 'repository_dispatch', actorNodeId: BOT, actorPermission: 'write', expired: false };
    }
  });
  expect(hydrated.inventory).toMatchObject({ repository: 'sec-platform/sec', totalCount: 103,
    perPage: 100, paginationComplete: true, sessionArtifactIds: ['1001', '1002'] });
  expect(hydrated.inventory.pageDigests).toHaveLength(2);
  expect(hydrated.inventory.inventoryDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(hydrationCalls).toEqual(['1001']);
  expect(hydrated.artifacts).toHaveLength(1);
  expect(hydrated.artifacts[0]).toMatchObject({ artifactId: '1001', runId: '7001', runAttempt: 2 });

  const thousandUnrelated = Array.from({ length: 10 }, (_, pageIndex) => ({
    total_count: 1000,
    artifacts: Array.from({ length: 100 }, (_, recordIndex) => {
      const id = pageIndex * 100 + recordIndex + 1;
      return summary(id, id === 1000 ? 'coverage_report' : `opaque_${id}`);
    })
  }));
  let unrelatedHydrationCalls = 0;
  const unrelatedOnly = evaluateGitHubRepositoryActionsArtifactInventoryV1({
    repository: 'sec-platform/sec', source: thousandUnrelated,
    observeArtifact: () => { unrelatedHydrationCalls += 1; throw new Error('must not hydrate unrelated'); }
  });
  expect(unrelatedOnly.artifacts).toEqual([]);
  expect(unrelatedHydrationCalls).toBe(0);

  const expectPreHydrationFailure = (mutate: (pages: any[]) => void, message: RegExp) => {
    const pages = structuredClone(source);
    mutate(pages);
    let calls = 0;
    expect(() => evaluateGitHubRepositoryActionsArtifactInventoryV1({
      repository: 'sec-platform/sec', source: pages,
      observeArtifact: () => { calls += 1; throw new Error('hydration must not start'); }
    })).toThrow(message);
    expect(calls).toBe(0);
  };
  expectPreHydrationFailure((pages) => { pages[1].artifacts[1].id = 1001; }, /duplicate id/i);
  expectPreHydrationFailure((pages) => { pages[1].total_count = 104; }, /total_count drifted/i);
  expectPreHydrationFailure((pages) => { pages[1].artifacts[2].digest = 'sha256:bad'; }, /digest is malformed/i);
  expectPreHydrationFailure((pages) => {
    pages[1].artifacts[1].name = `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-confusable`;
  }, /malformed Session-family name/i);

  expect(() => evaluateGitHubRepositoryActionsArtifactInventoryV1({
    repository: 'sec-platform/sec', source,
    observeArtifact: (entry) => ({ artifactId: entry.artifactId, artifactName: entry.artifactName,
      archiveDigest: null, workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
      runId: entry.expectedRunId!, runAttempt: entry.sessionRunAttempt!,
      eventName: 'repository_dispatch', actorNodeId: BOT, actorPermission: 'write', expired: false })
  })).toThrow(/hydration differs from its selected summary identity/i);

  const githubSource = readFileSync(path.join(process.cwd(),
    'scripts/codex/verification-session-github.ts'), 'utf8');
  const repositoryInventorySource = githubSource.slice(
    githubSource.lastIndexOf('actionsArtifacts(repository:'),
    githubSource.lastIndexOf('downloadArtifactText(repository:')
  );
  expect(repositoryInventorySource).toContain('evaluateGitHubRepositoryActionsArtifactInventoryV1');
  expect(repositoryInventorySource).not.toContain('.flatMap(');
});

test('Review adapter checks every configured trusted app instead of a first-entry shortcut', () => {
  const source = readFileSync(path.join(process.cwd(), 'scripts/codex/verification-session-github.ts'), 'utf8');
  const barrierSource = source.slice(source.indexOf('private observeReviewBarrierUnchecked(input:'),
    source.indexOf('observeChecks(repository:'));
  expect(barrierSource).not.toContain('trustedApps[0]');
  expect(barrierSource).toContain('for (const trustedApp of SEC_REVIEW_STABILITY_POLICY_V1.trustedApps)');
});

test('platform 403 is recorded as unavailable and never as no-bypass proof', () => {
  const transport = new FakeTransport();
  const error = new Error('upgrade plan') as Error & { statusCode?: number };
  error.statusCode = 403;
  transport.rulesetError = error;
  const observation = evaluatePlatformEnforcementObservationV1({
    repository: 'sec-platform/sec', readRulesets: () => transport.repositoryRulesets()
  });
  expect(observation.status).toBe('platform-enforcement-unavailable');
  expect(observation.reason).toContain('unavailable');
  expect(observation.rulesetDigest as SessionDigest).toMatch(/^sha256:/);
});

test('MainHealth preserves exact states while repair remains semantic routing without physical authority', () => {
  const common = { repository: 'sec-platform/sec', mainSha: BASE, mainTreeSha: BASE, trustRevision: BASE,
    observedAt: '2026-08-09T14:00:00.000Z', expiresAt: '2026-08-09T14:10:00.000Z', sourceRunId: '7',
    sourceRef: `${CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath}@${BASE}` };
  expect(createObservedMainHealthInputV1({ ...common, checks: [mainHealthCheck()] })).toMatchObject({
    status: 'healthy', allowedLanes: ['ordinary'], owner: null, repairWorkPackage: null
  });
  expect(createObservedMainHealthInputV1({ ...common,
    checks: [mainHealthCheck({ eventName: 'repository_dispatch' })] })).toMatchObject({
    status: 'healthy', allowedLanes: ['ordinary'], owner: null, repairWorkPackage: null
  });
  const degradedInput = createObservedMainHealthInputV1({
    ...common,
    checks: [mainHealthCheck({ conclusion: 'failure' })]
  });
  expect(degradedInput).toMatchObject({
    status: 'degraded', allowedLanes: CI_MAIN_HEALTH_POLICY_V1.degraded.allowedLanes,
    owner: CI_MAIN_HEALTH_POLICY_V1.degraded.owner
  });
  expect(degradedInput.repairWorkPackage).toBe(createMainHealthRepairWorkPackagePathV1({
    repository: common.repository,
    defaultBranch: 'main',
    mainSha: common.mainSha,
    mainTreeSha: common.mainTreeSha,
    owner: CI_MAIN_HEALTH_POLICY_V1.degraded.owner,
    failureFingerprints: degradedInput.failureFingerprints
  }));
  const degradedLedger = createMainHealthLedgerV1(degradedInput);
  expect(resolveMainHealthLaneV1({
    ledger: degradedLedger, lane: 'repair', now: '2026-08-09T14:01:00.000Z',
    expectedRepository: common.repository, expectedDefaultBranch: 'main',
    expectedMainSha: common.mainSha, expectedMainTreeSha: common.mainTreeSha,
    expectedTrustRevision: common.trustRevision
  })).toMatchObject({ status: 'degraded', allowed: true });
  expect(resolveMainHealthLaneV1({
    ledger: degradedLedger, lane: 'ordinary', now: '2026-08-09T14:01:00.000Z',
    expectedRepository: common.repository, expectedDefaultBranch: 'main',
    expectedMainSha: common.mainSha, expectedMainTreeSha: common.mainTreeSha,
    expectedTrustRevision: common.trustRevision
  })).toMatchObject({ status: 'locked', allowed: false });
  expect(CI_MAIN_HEALTH_POLICY_V1.degraded).toMatchObject({
    repairIdentityPolicy: 'exact-main-tree-failure-v1',
    allowedLanes: ['repair']
  });
  const productionRepairConsumers = [
    'scripts/codex/verification-session-runtime.ts',
    'scripts/codex/verification-session.ts',
    'platform/shared/ci-evidence-contract.ts',
    'scripts/codex/merge-gate.ts'
  ].map((sourcePath) => readFileSync(path.join(process.cwd(), sourcePath), 'utf8')).join('\n');
  expect(productionRepairConsumers).not.toContain("lane: 'repair'");
  expect(productionRepairConsumers).not.toContain('--lane repair');
  expect(productionRepairConsumers).not.toContain("kind: 'repair'");
  for (const checks of [[], [mainHealthCheck({ status: 'in_progress', conclusion: null })],
    [mainHealthCheck(), mainHealthCheck({ id: 8 })], [mainHealthCheck({ appId: 1 })]]) {
    expect(createObservedMainHealthInputV1({ ...common, checks })).toMatchObject({ status: 'locked', allowedLanes: [] });
  }
  const ledger = createMainHealthLedgerV1(createObservedMainHealthInputV1({ ...common,
    checks: [mainHealthCheck()] }));
  for (const expected of [
    { expectedRepository: 'attacker/fork', expectedDefaultBranch: 'main' },
    { expectedRepository: 'sec-platform/sec', expectedDefaultBranch: 'release' }
  ]) {
    expect(resolveMainHealthLaneV1({ ledger, lane: 'ordinary', now: '2026-08-09T14:01:00.000Z',
      ...expected, expectedMainSha: BASE, expectedMainTreeSha: BASE,
      expectedTrustRevision: BASE })).toMatchObject({ status: 'locked', allowed: false });
  }
});

test('MainHealth accepts one exact dispatch and locks duplicate or foreign producers', () => {
  const common = { repository: 'sec-platform/sec', mainSha: BASE, mainTreeSha: BASE, trustRevision: BASE,
    observedAt: '2026-08-09T14:00:00.000Z', expiresAt: '2026-08-09T14:10:00.000Z', sourceRunId: '7',
    sourceRef: `${CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath}@${BASE}` };
  const dispatched = mainHealthCheck({ id: 8 });
  const exact = createObservedMainHealthInputV1({ ...common, checks: [dispatched] });
  expect(exact).toMatchObject({
    status: 'healthy', allowedLanes: ['ordinary'], failureFingerprints: []
  });
  expect(createObservedMainHealthInputV1({
    ...common,
    checks: [mainHealthCheck({ id: 99, appId: 1 }), dispatched]
  })).toEqual(exact);

  const unrelatedActivation = mainHealthCheck({
    id: 10,
    eventName: 'repository_dispatch',
    conclusion: 'skipped',
    workflowRunId: '31683485879',
    workflowRunDisplayTitle: 'activate prepare PR #376'
  });
  expect(createObservedMainHealthInputV1({
    ...common,
    checks: [dispatched, unrelatedActivation]
  })).toEqual(exact);
  expect(createObservedMainHealthInputV1({
    ...common,
    checks: [unrelatedActivation]
  })).toMatchObject({ status: 'locked', allowedLanes: [] });
  const wrongOperationDispatch = mainHealthCheck({
    id: 12,
    eventName: 'repository_dispatch',
    conclusion: 'skipped',
    workflowRunDisplayTitle: CI_MAIN_HEALTH_POLICY_V1.producer.runTitleFormats.repositoryDispatch
      .replace('<exact-main-sha>', BASE)
      .replace('<request-operation-id>', `sha256:${'a'.repeat(64)}`)
  });
  expect(createObservedMainHealthInputV1({
    ...common,
    checks: [dispatched, wrongOperationDispatch]
  })).toEqual(exact);
  expect(createObservedMainHealthInputV1({
    ...common,
    checks: [wrongOperationDispatch]
  })).toMatchObject({ status: 'locked', allowedLanes: [] });
  const failedDispatch = mainHealthCheck({ id: 8, conclusion: 'failure' });
  const singleFailure = createObservedMainHealthInputV1({ ...common, checks: [failedDispatch] });
  expect(singleFailure).toMatchObject({
    status: 'degraded', allowedLanes: CI_MAIN_HEALTH_POLICY_V1.degraded.allowedLanes,
    failureFingerprints: [expect.stringMatching(/^sha256:/)],
    repairWorkPackage: expect.stringContaining('default-branch-health-repair-')
  });

  for (const checks of [
    [dispatched, mainHealthCheck({ id: 9 })],
    [dispatched, mainHealthCheck({ id: 9, conclusion: 'failure' })],
    [mainHealthCheck({ status: 'in_progress', conclusion: null })],
    [mainHealthCheck({ conclusion: 'forged-terminal' })],
    [mainHealthCheck({ status: 'forged-status', conclusion: 'failure' })],
    [mainHealthCheck({ eventName: 'push' })]
  ]) {
    expect(createObservedMainHealthInputV1({ ...common, checks })).toMatchObject({
      status: 'locked', allowedLanes: [], failureFingerprints: [expect.stringMatching(/^sha256:/)]
    });
  }
});

test('IssueDisposition post-main readback consumes the canonical exact MainHealth decision', () => {
  const common = {
    repository: 'sec-platform/sec', newMainSha: BASE, newMainTreeSha: HEAD,
    observedAt: '2026-08-09T14:00:00.000Z', sourceRunId: '200',
    sourceRef: `.github/workflows/sec-merge-gate.yml@${BASE}`
  };
  const dispatched = mainHealthCheck({ id: 8 });
  const single = compilePostMainIssueDispositionHealthReadbackV1({ ...common, checks: [dispatched] });
  expect(single).toMatchObject({
    repository: common.repository, mainSha: common.newMainSha, mainTreeSha: common.newMainTreeSha,
    trustRevision: common.newMainSha, status: 'healthy', allowedLanes: ['ordinary']
  });
  for (const checks of [
    [mainHealthCheck({ appId: 1 })],
    [mainHealthCheck({ appNodeId: 'forged-app-node' })],
    [mainHealthCheck({ workflowPath: '.github/workflows/forged.yml' })],
    [mainHealthCheck({ workflowRef: `${CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath}@${HEAD}` })],
    [mainHealthCheck({ eventName: 'workflow_run' })],
    [mainHealthCheck({
      eventName: 'repository_dispatch',
      workflowRunDisplayTitle: CI_MAIN_HEALTH_POLICY_V1.producer.runTitleFormats.repositoryDispatch
        .replace('<exact-main-sha>', BASE)
        .replace('<request-operation-id>', `sha256:${'a'.repeat(64)}`)
    })],
    [dispatched, mainHealthCheck({ id: 9 })],
    [mainHealthCheck({ conclusion: 'forged-terminal' })],
    [mainHealthCheck({ status: 'forged-status', conclusion: 'success' })],
    [mainHealthCheck({ eventName: 'push' })]
  ]) {
    expect(() => compilePostMainIssueDispositionHealthReadbackV1({ ...common, checks }))
      .toThrow('canonical fresh healthy ordinary-only MainHealth');
  }
});

test('trusted-main proposal and hosted sole issuer reconstruct the same stable Session revision', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const barrier = observe(transport);
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const candidate = transport.candidate();
  const changedPaths = ['scripts/codex/verification-session.ts'];
  const testImpactTransition = changedTransition(changedPaths);
  const manifestDigest = `sha256:${'b'.repeat(64)}` as const;
  const local = prepareTrustedMainVerificationSessionV1({ repository: candidate.repository, candidate,
    manifestPath: 'docs/work-packages/example.md', manifestDigest, changedPaths, testImpactTransition, profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '1',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: barrier.observedAt, reviewBarrier: barrier,
    mainHealthChecks: [mainHealthCheck()], dependencyBlobs: actionDependencyBlobs() });
  const facts = reconstructVerificationSessionHostedFactsV1({ request: local.request,
    repository: candidate.repository, candidate, changedPaths, testImpactTransition,
    integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '2',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, observedAt: barrier.observedAt,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs() });
  const pureHosted = createPureHostedEnvelopeFixture({ request: local.request, facts });
  expect(pureHosted.session.sessionRevision).toBe(local.sessionRevision);
  expect(pureHosted.scopeAuthorization.authorizationRevision).toBe(local.scopeAuthorizationRevision);
  expect(pureHosted.actionPlanClosure.actionPlanDigest).toBe(local.actionPlanClosure.actionPlanDigest);
  expect(() => prepareVerificationSessionHostedV1({ request: local.request,
    facts: JSON.parse(JSON.stringify(facts)) })).toThrow('live observation produced by the private GitHub adapter');
  const dependencyPaths = new Set<string>(CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2);
  for (const action of pureHosted.actionPlanClosure.actions) {
    expect(action.action.inputClosure.filter(({ path: inputPath }) =>
      dependencyPaths.has(inputPath))).toHaveLength(4);
  }
  expect(() => prepareTrustedMainVerificationSessionV1({ repository: candidate.repository, candidate,
    manifestPath: 'docs/work-packages/example.md', manifestDigest, changedPaths, testImpactTransition, profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '1',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: barrier.observedAt, reviewBarrier: barrier,
    mainHealthChecks: [mainHealthCheck()], dependencyBlobs: actionDependencyBlobs('bun.lock') }))
    .toThrow(/bun\.lock drifted from the trusted base/i);
  expect(() => reconstructVerificationSessionHostedFactsV1({ request: local.request,
    repository: candidate.repository, candidate, changedPaths, testImpactTransition,
    integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '2',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, observedAt: barrier.observedAt,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs('package.json') }))
    .toThrow(/package\.json drifted from the trusted base/i);
});

test('VerificationSession binds the exact deletion transition through Scope, Action, Session, and hosted reconstruction', () => {
  const baseSha = '9ed0291a0b51b4f3f6769ab317c4cc1a2753cb4b';
  const headSha = 'b'.repeat(40);
  const retiredPath =
    'docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json';
  const changedPaths = [retiredPath, 'scripts/codex/verification-session.ts'];
  const records = [
    { status: 'changed' as const, path: 'scripts/codex/verification-session.ts' },
    { status: 'removed' as const, path: retiredPath }
  ];
  const readPathBlob = (revision: string, repositoryPath: string) => (
    revision === baseSha && repositoryPath === retiredPath
      ? { mode: '100644' as const, blobSha: '3fbfa041119f70429b5f6cc4440816b50ab3a0ef' }
      : null
  );
  const testImpactTransition = CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha, headSha, records, readPathBlob
  });
  const reordered = CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha, headSha, records: [...records].reverse(), readPathBlob
  });
  expect(CodexDevelopmentTestImpactTransitionDigestV1(reordered))
    .toBe(CodexDevelopmentTestImpactTransitionDigestV1(testImpactTransition));

  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const github = fakeGitHubClient(transport, (input) => observePrivateClearReviewBarrier(
    input.observedAt ?? VERIFIED_AT
  ));
  const candidate = Object.freeze({
    ...transport.candidate(),
    baseSha,
    baseTreeSha: 'c'.repeat(40),
    headSha,
    headTreeSha: 'd'.repeat(40)
  });
  const barrier = github.observeReviewBarrier({
    repository: candidate.repository,
    prNumber: candidate.number,
    headSha,
    excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
    observedAt: VERIFIED_AT
  });
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const mainHealthChecks = [mainHealthCheck({
    headSha: baseSha,
    workflowRef: `${CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath}@${baseSha}`
  })];
  const manifestDigest = `sha256:${'e'.repeat(64)}` as const;
  const prepared = prepareTrustedMainVerificationSessionV1({
    repository: candidate.repository, candidate,
    manifestPath: 'docs/work-packages/example.md', manifestDigest,
    changedPaths, testImpactTransition, profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: 'deletion-prepare', sourceRef: `refs/heads/main@${baseSha}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks,
    dependencyBlobs: actionDependencyBlobs()
  });
  const facts = reconstructVerificationSessionHostedFactsV1({
    request: prepared.request, repository: candidate.repository, candidate, changedPaths,
    testImpactTransition: reordered, integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: 'deletion-hosted',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${baseSha}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks,
    dependencyBlobs: actionDependencyBlobs()
  });
  expect(facts.testImpactTransitionDigest).toBe(prepared.testImpactTransitionDigest);
  expect(facts.sessionProposalDigest).toBe(prepared.sessionProposalDigest);
  expect(facts.actionPlanClosure.actionPlanDigest).toBe(prepared.actionPlanClosure.actionPlanDigest);
  const localQuick = prepareLocalQuickVerificationActionPlanV2({
    candidate,
    manifestPath: 'docs/work-packages/example.md',
    manifestDigest,
    changedPaths,
    testImpactTransition,
    expectedTestImpactTransitionDigest: prepared.testImpactTransitionDigest,
    scopeAuthorizationRevision: prepared.scopeAuthorizationRevision,
    executionEnvironment: createCiVerificationLocalExecutionEnvironmentV2({
      os: process.platform, arch: process.arch, bunVersion: Bun.version
    }),
    dependencyBlobs: actionDependencyBlobs()
  });
  expect(localQuick.actions.length).toBeGreaterThan(0);
  expect(() => reconstructVerificationSessionHostedFactsV1({
    request: prepared.request, repository: candidate.repository, candidate, changedPaths,
    testImpactTransition: { ...testImpactTransition, headSha: 'f'.repeat(40) },
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: 'deletion-hosted',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${baseSha}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks,
    dependencyBlobs: actionDependencyBlobs()
  })).toThrow(/exact candidate selection input/i);
});

test('same paths with a different Git transition change the complete VerificationSession identity chain', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const barrier = observe(transport);
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const candidate = transport.candidate();
  const changedPaths = ['scripts/codex/verification-session.ts'];
  const prepare = (status: 'added' | 'changed') => prepareTrustedMainVerificationSessionV1({
    repository: candidate.repository, candidate,
    manifestPath: 'docs/work-packages/example.md', manifestDigest: `sha256:${'e'.repeat(64)}`,
    changedPaths,
    testImpactTransition: CodexDevelopmentCreateTestImpactTransitionObservationV1({
      baseSha: candidate.baseSha, headSha: candidate.headSha,
      records: [{ status, path: changedPaths[0]! }], readPathBlob: () => null
    }),
    profile: 'quick', integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: `transition-${status}`,
    sourceRef: `refs/heads/main@${candidate.baseSha}`, observedAt: VERIFIED_AT,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs()
  });
  const added = prepare('added');
  const changed = prepare('changed');
  expect(added.testImpactTransitionDigest).not.toBe(changed.testImpactTransitionDigest);
  expect(added.scopeAuthorizationRevision).not.toBe(changed.scopeAuthorizationRevision);
  expect(added.actionPlanClosure.actionPlanDigest).not.toBe(changed.actionPlanClosure.actionPlanDigest);
  expect(added.sessionRevision).not.toBe(changed.sessionRevision);
  expect(added.request.requestOperationId).not.toBe(changed.request.requestOperationId);
});

test('Session local quick DAG keeps durable journals in authority root and executes exact detached candidate', async () => {
  const authorityRoot = mkdtempSync(path.join(tmpdir(), 'sec-session-authority-'));
  const runGit = (cwd: string, args: readonly string[]): string => {
    const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  try {
    runGit(authorityRoot, ['init', '-b', 'main']);
    runGit(authorityRoot, ['config', 'user.name', 'Session Test']);
    runGit(authorityRoot, ['config', 'user.email', 'session-test@example.invalid']);
    writeFileSync(path.join(authorityRoot, 'tracked.txt'), 'base\n', 'utf8');
    writeFileSync(path.join(authorityRoot, '.gitignore'), '.tmp/\n', 'utf8');
    runGit(authorityRoot, ['add', 'tracked.txt', '.gitignore']);
    runGit(authorityRoot, ['commit', '-m', 'base']);
    const baseSha = runGit(authorityRoot, ['rev-parse', 'HEAD']);
    const baseTreeSha = runGit(authorityRoot, ['rev-parse', 'HEAD^{tree}']);
    writeFileSync(path.join(authorityRoot, 'tracked.txt'), 'exact candidate\n', 'utf8');
    runGit(authorityRoot, ['add', 'tracked.txt']);
    runGit(authorityRoot, ['commit', '-m', 'exact candidate']);
    const headSha = runGit(authorityRoot, ['rev-parse', 'HEAD']);
    const headTreeSha = runGit(authorityRoot, ['rev-parse', 'HEAD^{tree}']);
    const candidateRoot = path.join(authorityRoot, '.tmp', 'codex',
      'verification-session-candidates', headSha);
    mkdirSync(path.dirname(candidateRoot), { recursive: true });
    runGit(authorityRoot, ['worktree', 'add', '--detach', candidateRoot, headSha]);
    const candidate = Object.freeze({ ...new FakeTransport().candidate(),
      baseSha, baseTreeSha, headSha, headTreeSha });
    const executionEnvironment = createCiVerificationLocalExecutionEnvironmentV2({
      os: process.platform, arch: process.arch, bunVersion: Bun.version
    });
    const testImpactTransition = changedTransition(
      ['scripts/codex/verification-session.ts'],
      baseSha,
      headSha
    );
    const testImpactTransitionDigest = CodexDevelopmentTestImpactTransitionDigestV1(testImpactTransition);
    const closure = prepareLocalQuickVerificationActionPlanV2({ candidate,
      manifestPath: 'docs/work-packages/verification-action-trusted-cutover-v6.md',
      manifestDigest: `sha256:${'9'.repeat(64)}`, changedPaths: ['scripts/codex/verification-session.ts'],
      testImpactTransition,
      expectedTestImpactTransitionDigest: testImpactTransitionDigest,
      scopeAuthorizationRevision: `sha256:${'8'.repeat(64)}`, executionEnvironment,
      dependencyBlobs: actionDependencyBlobs() });
    expect(() => prepareLocalQuickVerificationActionPlanV2({ candidate,
      manifestPath: 'docs/work-packages/verification-action-trusted-cutover-v6.md',
      manifestDigest: `sha256:${'9'.repeat(64)}`, changedPaths: ['scripts/codex/verification-session.ts'],
      testImpactTransition,
      expectedTestImpactTransitionDigest: testImpactTransitionDigest,
      scopeAuthorizationRevision: `sha256:${'8'.repeat(64)}`, executionEnvironment,
      dependencyBlobs: actionDependencyBlobs('.bun-version') }))
      .toThrow(/\.bun-version drifted from the trusted base/i);
    const result = await executeLocalVerificationActionDagV2({ authorityRoot, candidateRoot,
      actionPlanClosure: closure, executionEnvironment, executeNormalizedOperation: () => 0 });
    expect(result.status).toBe('passed');
    expect(result.actionPlanDigest).toBe(closure.actionPlanDigest);
    expect(result.actionResults.every((entry) => entry.terminal?.status === 'passed')).toBe(true);
    expect(existsSync(path.join(authorityRoot, '.tmp', 'codex', 'verification-actions', 'v2'))).toBe(true);
    expect(existsSync(path.join(candidateRoot, '.tmp', 'codex', 'verification-actions', 'v2'))).toBe(false);
    expect(runGit(candidateRoot, ['rev-parse', 'HEAD'])).toBe(headSha);
    expect(runGit(candidateRoot, ['rev-parse', 'HEAD^{tree}'])).toBe(headTreeSha);
    expect(runGit(candidateRoot, ['status', '--porcelain=v1', '--untracked-files=no'])).toBe('');
  } finally {
    rmSync(authorityRoot, { recursive: true, force: true });
  }
});

test('local quick detached scratch cleanup is owned by the physical closeout engine', async () => {
  const source = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts')).text();
  const cleanup = source.slice(source.indexOf('async function removeLocalCandidateWorktreeV1('),
    source.indexOf('async function executePreparedLocalQuickDagV2('));
  expect(cleanup).toContain('prepareDetachedScratchWorktreePhysicalCloseoutV1({');
  expect(cleanup).toContain('executeDetachedScratchWorktreePhysicalCloseoutV1({');
  expect(cleanup.indexOf('prepareDetachedScratchWorktreePhysicalCloseoutV1({'))
    .toBeLessThan(cleanup.indexOf('executeDetachedScratchWorktreePhysicalCloseoutV1({'));
  expect(cleanup).toContain("receipt.terminal !== 'completed'");
  expect(cleanup).toContain('receipt.readback.registryPresent || receipt.readback.physicalPresent');
  expect(cleanup).toContain('!receipt.readback.authorizationValid');
  expect(cleanup).toContain("return 'retained-physical-closeout-blocked';");
  expect(cleanup).toContain('unlinkSync(input.lease.markerPath);');
  expect(cleanup).not.toContain("'worktree', 'remove'");
  expect(cleanup).not.toContain('prepareTrustedWorktreePhysicalCloseoutV1');
  expect(cleanup).not.toContain('assertTrustedCompletedWorktreePhysicalCloseoutV1');

  const localQuick = source.slice(source.indexOf('async function executePreparedLocalQuickDagV2('),
    source.indexOf('function branchCloseoutStore()'));
  expect(localQuick).toContain('const scratchCloseout = await removeLocalCandidateWorktreeV1');
  expect(localQuick).toContain("worktreeDisposition: scratchCloseout");
});

test('closeout projection artifact family is attempt-bound to its producing integration run', async () => {
  const githubSource = await Bun.file(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts')).text();
  const classifier = githubSource.slice(
    githubSource.indexOf('const SESSION_ATTEMPT_BOUND_ARTIFACT_NAME_PATTERNS_V1'),
    githubSource.indexOf('type GitHubRepositoryActionsArtifactSummaryV1')
  );
  expect(classifier).toContain(
    '/^sec-closeout-projections-v1-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u'
  );
  expect(classifier).toContain("'sec-closeout-projections-v1-'");
  expect(classifier).not.toContain('sec-integration-projection-v1-');
  expect(classifier).toContain('identity[1] !== runId');
  expect(classifier).toContain('const producingRunAttempt = Number(identity[2]);');

  const workflowSource = await Bun.file(path.resolve(import.meta.dir,
    '../../.github/workflows/sec-merge-gate.yml')).text();
  expect(workflowSource).toContain(
    'name: sec-closeout-projections-v1-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}'
  );
  expect(workflowSource).not.toContain('sec-integration-projection-v1-run-');
});

test('trusted-main preparation rejects candidate/dirty/boundary runtime proof', () => {
  const proof = { currentHeadSha: BASE, currentBranch: 'main', localDefaultSha: BASE, remoteDefaultSha: BASE,
    workingTreeClean: true, tcbClosureMatched: true, runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
  expect(() => assertTrustedMainRuntimeV1({ ...proof, workingTreeClean: false }, BASE)).toThrow();
  expect(() => assertTrustedMainRuntimeV1({ ...proof, currentBranch: 'feature' }, BASE)).toThrow();
  expect(() => assertTrustedMainRuntimeV1({ ...proof, boundaryTargetsMatched: false }, BASE)).toThrow();
});

test('hosted exact-revision runtime permits only a detached exact trusted-main checkout', () => {
  const session = { baseSha: BASE, trustRevision: BASE } as VerificationSessionV2;
  const detachedExact = { currentHeadSha: BASE, currentBranch: '', localDefaultSha: BASE, remoteDefaultSha: BASE,
    workingTreeClean: true, tcbClosureMatched: true, runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
  expect(() => assertTrustedExactRevisionRuntimeV1(detachedExact, BASE)).not.toThrow();
  expect(() => assertTrustedRuntimeV1(detachedExact, session)).not.toThrow();
  expect(() => assertTrustedMainRuntimeV1(detachedExact, BASE)).toThrow();
  expect(() => assertTrustedExactRevisionRuntimeV1({ ...detachedExact, currentHeadSha: HEAD }, BASE)).toThrow();
  expect(() => assertTrustedExactRevisionRuntimeV1({ ...detachedExact, workingTreeClean: false }, BASE)).toThrow();
  expect(() => assertTrustedExactRevisionRuntimeV1({ ...detachedExact, currentBranch: 'feature/foreign' }, BASE)).toThrow();

  const cliSource = readFileSync(path.resolve(import.meta.dir, '../../scripts/codex/verification-session.ts'), 'utf8');
  const hostedIntegration = cliSource.slice(cliSource.indexOf('function assertHostedIntegrationIdentity('),
    cliSource.indexOf('function ', cliSource.indexOf('function assertHostedIntegrationIdentity(') + 1));
  const hostedObserve = cliSource.slice(cliSource.indexOf('function assertHostedCompilerIdentity('),
    cliSource.indexOf('function ', cliSource.indexOf('function assertHostedCompilerIdentity(') + 1));
  expect(hostedIntegration).toContain('assertTrustedExactRevisionRuntimeV1(proof, baseSha);');
  expect(hostedObserve).toContain('assertTrustedExactRevisionRuntimeV1(inspectTrustedRuntimeV1({ repositoryRoot }),');
});

test('physical merge cannot be reached with an unbound authorization', () => {
  const githubSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts'), 'utf8');
  const cliSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  expect(githubSource).not.toContain('VerifiedIntegrationExecutionV1');
  expect(githubSource).not.toContain('executeVerifiedIntegration');
  expect(githubSource).not.toContain("'pr', 'merge'");
  expect(cliSource).not.toContain("'pr', 'merge'");
  expect(cliSource).not.toContain('/merge-async');
  expect(cliSource).toContain('function executeHostedSquashMerge(');
  expect(cliSource).not.toContain('export function executeHostedSquashMerge');
});

test('synchronous hosted merge rejects queued effects and requires exact physical readback', () => {
  const markers = [
    'Integration-Authorization: auth-1',
    `Integration-Authorization-Receipt: sha256:${'a'.repeat(64)}`,
    `Integration-Authorization-Operation: sha256:${'c'.repeat(64)}`,
    `Integration-Authorization-Publication: sha256:${'d'.repeat(64)}`,
    `Integration-Authorization-Publication-Digest: sha256:${'e'.repeat(64)}`,
    'Integration-Authorization-Comment: 123',
    `Verification-Session: sha256:${'b'.repeat(64)}`
  ];
  const expectedTitle = 'Verified integration deadbeef0000';
  const reviewSnapshotBase = { paginationComplete: true as const, reviewedHeadSha: HEAD,
    reviewPageDigests: [PAGE], threadPageDigests: [PAGE], reviewCount: 1, threadCount: 0,
    unresolvedBlockingThreadCount: 0 as const, requestChangesPrincipalIds: [] as readonly [] };
  const reviewSnapshot = { ...reviewSnapshotBase,
    snapshotDigest: createReviewSnapshotDigestV1(reviewSnapshotBase) };
  const reviewReceipt = createReviewStabilityReceiptV1({ stage: 'pre-merge', repository: 'sec-platform/sec',
    prNumber: 42, sessionRevision: PAGE, scopeAuthorizationRevision: PAGE,
    scopeAuthorizationReceiptDigest: PAGE, headSha: HEAD, headTreeSha: HEAD,
    policy: SEC_REVIEW_STABILITY_POLICY_V1,
    principal: { kind: 'github-app', actorNodeId: BOT, appId: 1144995,
      appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' },
    independence: { candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR' },
    producer: { identity: 'scripts/codex/verification-session-github.ts',
      executionIdentity: `github-review-observer:sec-platform/sec:42:${HEAD}`,
      providerIdentity: 'github', candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT_V1,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
      sourceTransport: 'github-graphql', sourceRunId: 'run-1', sourceRef: 'pull/42',
      sourceDigest: reviewSnapshot.snapshotDigest }, snapshot: reviewSnapshot,
    reviewedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z' });
  const closure = { markers, reviewReceipt, expectedTitle } as const;
  const mergeCommitSha = '9'.repeat(40);
  const provider = parseHostedSynchronousSquashMergeResponseV1(JSON.stringify({
    sha: mergeCommitSha, merged: true, message: 'Pull Request successfully merged'
  }));
  expect(provider).toEqual({ sha: mergeCommitSha, merged: true,
    message: 'Pull Request successfully merged' });
  for (const response of [
    '',
    JSON.stringify({ sha: mergeCommitSha, merged: false, message: 'Merge queue required' }),
    JSON.stringify({ sha: 'not-a-sha', merged: true, message: 'merged' }),
    JSON.stringify({ sha: mergeCommitSha, merged: true })
  ]) expect(() => parseHostedSynchronousSquashMergeResponseV1(response)).toThrow();

  const queued: GitHubCandidateObservationV1 = {
    repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
    isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE,
    baseTreeSha: BASE, headBranch: 'feat/example', headSha: HEAD, headTreeSha: HEAD,
    title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
    mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null
  };
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: queued,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha }))
    .toThrow(/merge-queue enqueue is not integration success/);
  const merged = { ...queued, state: 'MERGED' as const,
    mergeCommitSha, mergeCommitTreeSha: HEAD,
    mergeCommitMessage: `${expectedTitle}\n\n${markers.join('\n')}\n${renderIndependentReviewTrailerV1(reviewReceipt)}` };
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: merged,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).not.toThrow();
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: merged,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: null })).not.toThrow();
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: queued,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: null })).toThrow(/not physically complete/i);
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: merged,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: '8'.repeat(40) })).toThrow(/provider response does not match/i);
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: { ...merged, headSha: BASE },
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/mismatched head or merge tree/i);
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: { ...merged, mergeCommitTreeSha: BASE },
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/mismatched head or merge tree/i);
  expect(() => assertHostedSquashMergeCompletionV1({ candidate: { ...merged, mergeCommitMessage: 'other' },
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/authorization markers/i);

  const source = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const executor = source.slice(source.indexOf('function executeHostedSquashMerge('),
    source.indexOf('const USAGE ='));
  expect(source).not.toContain("'pr', 'merge'");
  expect(source).not.toContain('/merge-async');
  expect((executor.match(/'--method', 'PUT'/gu) ?? [])).toHaveLength(1);
  expect((executor.match(/\/pulls\/\$\{input\.prNumber\}\/merge/gu) ?? [])).toHaveLength(1);
  expect(executor).toContain("'--input', '-'");
  expect(executor).toContain('sha: input.headSha');
  expect(executor).toContain("merge_method: 'squash'");
  expect(executor).toContain('const commitTitle = `Verified integration');
  expect(executor).toContain('commit_title: commitTitle');
  expect(executor).toContain('Issue-Disposition-Plan:');
  expect(executor).toContain('parseGitHubClosingKeywordOccurrencesV1');
  expect(executor).toContain("commit_message: markers.join('\\n')");
  expect(executor).toContain('renderIndependentReviewTrailerV1(input.publication.result.reviewReceipt)');
  expect(executor).toContain('if (result.status !== 0)');
  const integration = source.slice(source.indexOf("if (command === 'integrate-hosted')"),
    source.indexOf("if (command === 'closeout-mutate-hosted')"));
  const mergeEffect = integration.indexOf('executeHostedSquashMerge({');
  const mergeEffectCount = integration.match(/executeHostedSquashMerge\(\{/gu) ?? [];
  const exactCandidateGuard = integration.indexOf('candidate drifted immediately before physical merge');
  const freshReducerGuard = integration.indexOf('integrate-hosted effect guard changed before merge');
  const exactReadback = integration.indexOf('github.observeCandidate(repository, artifact.session.prNumber)',
    mergeEffect);
  const completionReadback = integration.indexOf('assertHostedSquashMergeCompletionV1({', mergeEffect);
  const completedReduction = integration.indexOf('result = reduce();', completionReadback);
  const projectionWrite = integration.indexOf('writeDurable(', completedReduction);
  expect(mergeEffectCount).toHaveLength(1);
  expect(exactCandidateGuard).toBeGreaterThan(0);
  expect(freshReducerGuard).toBeGreaterThan(exactCandidateGuard);
  expect(mergeEffect).toBeGreaterThan(freshReducerGuard);
  expect(mergeEffect).toBeGreaterThan(0);
  expect(exactReadback).toBeGreaterThan(mergeEffect);
  expect(completionReadback).toBeGreaterThan(mergeEffect);
  expect(completionReadback).toBeGreaterThan(exactReadback);
  expect(integration).toContain('providerMergeCommitSha: providerResponse?.sha ?? null');
  expect(integration).toContain('AMBIGUOUS_SIDE_EFFECT: synchronous hosted merge attempt requires recovery');
  expect(completedReduction).toBeGreaterThan(completionReadback);
  expect(projectionWrite).toBeGreaterThan(completedReduction);
});

test('hosted IssueDisposition is pre-merge guarded and post-readback observation is effect-free', async () => {
  const [sessionSource, githubSource] = await Promise.all([
    Bun.file(new URL('../../scripts/codex/verification-session.ts', import.meta.url)).text(),
    Bun.file(new URL('../../scripts/codex/verification-session-github.ts', import.meta.url)).text()
  ]);
  const integrateStart = sessionSource.indexOf("if (command === 'integrate-hosted')");
  const closeoutStart = sessionSource.indexOf("if (command === 'closeout-mutate-hosted')");
  const integrate = sessionSource.slice(integrateStart, closeoutStart);
  const closeout = sessionSource.slice(closeoutStart);
  const issueDisposition = sessionSource.slice(
    sessionSource.indexOf('function observeHostedTrackingIssueDispositionV1('),
    sessionSource.indexOf('function observeExactRemoteCloseoutBranch(')
  );
  const mergeEffect = integrate.indexOf('executeHostedSquashMerge({');
  const writerCircuitBreaker = integrate.indexOf("capability: 'github-writer'");
  expect(integrateStart).toBeGreaterThan(-1);
  expect(closeoutStart).toBeGreaterThan(integrateStart);
  expect(mergeEffect).toBeGreaterThan(-1);
  expect(integrate.indexOf('github.observePullRequestClosingFacts(')).toBeLessThan(
    mergeEffect
  );
  const issueReconciliationGuard = integrate.indexOf("if (issueReconciliation.status !== 'no-op')");
  const mainHealthJoin = integrate.indexOf('await joinExactPostMergeMainHealthV1');
  const physicalCloseout = integrate.indexOf('consumeSameHostWorktreeCloseoutV1');
  const finalizer = integrate.indexOf('await finalizeSameInvocationCloseoutV1');
  expect(integrate.indexOf('assertHostedSquashMergeCompletionV1')).toBeLessThan(issueReconciliationGuard);
  expect(issueReconciliationGuard).toBeGreaterThan(-1);
  expect(issueReconciliationGuard).toBeLessThan(mainHealthJoin);
  expect(issueReconciliationGuard).toBeLessThan(physicalCloseout);
  expect(issueReconciliationGuard).toBeLessThan(finalizer);
  expect(integrate.indexOf('stopCloseoutForIssueReconciliation(merged)'))
    .toBeLessThan(mainHealthJoin);
  expect(integrate.match(/capability: 'github-writer'/gu) ?? []).toHaveLength(1);
  expect(writerCircuitBreaker).toBeGreaterThan(-1);
  expect(writerCircuitBreaker).toBeLessThan(mergeEffect);
  expect(integrate.slice(mergeEffect)).not.toContain("capability: 'github-writer'");
  expect(sessionSource).toContain('function observePostMergeIssueReconciliationV1');
  expect(sessionSource).toContain("status: 'legacy-no-effect'");
  expect(sessionSource).toContain(": 'manual-action-required'");
  expect(sessionSource).toContain("? 'blocked'");
  expect(integrate).toContain("status: 'BLOCKED'");
  expect(integrate).toContain('unexpected GitHub Issue closure requires reconciliation before closeout.');
  expect(closeout.indexOf('observeHostedTrackingIssueDispositionV1({')).toBeLessThan(
    closeout.indexOf('observeBranchCloseoutOperationPublicationV1(')
  );
  expect(closeout.slice(0, closeout.indexOf('observeBranchCloseoutOperationPublicationV1(')))
    .not.toContain("capability: 'github-writer'");
  expect(issueDisposition).toContain('compilePostMainIssueDispositionHealthReadbackV1({');
  expect(issueDisposition).toContain('checks: github.observeChecks(repository, candidate.mergeCommitSha)');
  expect(issueDisposition).toContain('mainHealth.ledgerDigest');
  expect(issueDisposition).not.toContain('.filter((check)');
  expect(issueDisposition).not.toContain('mainHealthChecks.length');
  expect(sessionSource).not.toContain("status: 'satisfied' as const");
  expect(sessionSource).not.toContain('remainingWorkCount: 0');
  expect(sessionSource).toContain('status: disposition.kind, receipt: disposition');
  expect(sessionSource).toContain("return Object.freeze({ status: 'legacy-no-effect', reason: 'issue-disposition-markers-absent' });");
  expect(sessionSource.indexOf('const closingFacts = github.observePullRequestClosingFacts(')).toBeLessThan(
    sessionSource.indexOf("throw new Error('IssueDisposition merge markers differ from the exact live plan.')")
  );
  expect(githubSource).toContain("'number,state,isDraft,isCrossRepository,author,baseRefName,baseRefOid,headRefName,headRefOid,title,body,mergeCommit'");
  expect(githubSource).toContain("const args = ['api', 'graphql', '-f', `query=${query}`]");
  expect(githubSource).not.toContain('sec-github-graphql-');
});

test('public prepare owns one exact detached worktree and completes local DAG before hosted wake-up', () => {
  const source = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const prepare = source.slice(source.indexOf("if (command === 'prepare')"),
    source.indexOf("if (command === 'freeze')"));
  expect(source).toContain("'.tmp', 'codex', 'verification-session-candidates'");
  expect(source).toContain("['worktree', 'add', '--detach', candidateRoot, input.candidate.headSha]");
  const scratchCleanup = source.slice(source.indexOf('async function removeLocalCandidateWorktreeV1('),
    source.indexOf('async function executePreparedLocalQuickDagV2('));
  expect(scratchCleanup).toContain('prepareDetachedScratchWorktreePhysicalCloseoutV1({');
  expect(scratchCleanup).toContain('executeDetachedScratchWorktreePhysicalCloseoutV1({');
  expect(scratchCleanup.indexOf('prepareDetachedScratchWorktreePhysicalCloseoutV1({'))
    .toBeLessThan(scratchCleanup.indexOf('executeDetachedScratchWorktreePhysicalCloseoutV1({'));
  expect(scratchCleanup).toContain("return 'retained-physical-closeout-blocked';");
  expect(scratchCleanup).not.toContain("'worktree', 'remove'");
  expect(source).not.toContain("['worktree', 'prune'");
  expect(prepare).not.toContain("args.get('--candidate-root')");
  const schemaUnsupported = prepare.indexOf(
    "if (prepared.reviewBarrier.status === 'provider-schema-unsupported')"
  );
  const hostedSelection = prepare.indexOf('selectTrustedHostedSessionArtifactV1({');
  const localQuick = prepare.indexOf('await executePreparedLocalQuickDagV2');
  const hostedWakeup = prepare.indexOf('github.ensureVerificationSessionWakeup');
  for (const boundary of [schemaUnsupported, hostedSelection, localQuick, hostedWakeup]) {
    expect(boundary).toBeGreaterThan(-1);
  }
  expect(schemaUnsupported).toBeLessThan(hostedSelection);
  expect(schemaUnsupported).toBeLessThan(localQuick);
  expect(schemaUnsupported).toBeLessThan(hostedWakeup);
  expect(prepare).toContain('responseDigest: prepared.reviewBarrier.responseDigest');
  expect(prepare).toContain('observedAt: prepared.reviewBarrier.observedAt');
  expect(prepare).toContain("const reviewBarrierAllowsExecution = prepared.reviewBarrier.status === 'clear'");
  expect(prepare).toContain("|| prepared.reviewBarrier.status === 'waiting';");
  expect(prepare).toContain('const dispatchSignalSent = reviewBarrierAllowsExecution');
  expect(prepare.indexOf('await executePreparedLocalQuickDagV2'))
    .toBeLessThan(prepare.indexOf('github.ensureVerificationSessionWakeup'));
  expect(prepare).toContain("localVerification.result.status === 'passed'");
  expect(prepare).toContain("'LOCAL_VERIFICATION_FAILED'");
  expect(prepare).toContain("'LOCAL_VERIFICATION_BLOCKED'");
});

test('OPEN candidate execution rejects remote-main drift even after authorization', () => {
  const session = { baseSha: BASE, trustRevision: BASE } as VerificationSessionV2;
  const proof = { currentHeadSha: BASE, currentBranch: 'main', localDefaultSha: BASE,
    remoteDefaultSha: 'f'.repeat(40), workingTreeClean: true, tcbClosureMatched: true,
    runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
  expect(() => assertTrustedRuntimeV1(proof, session, false))
    .toThrow(/trusted default revision TCB/);
  expect(() => assertTrustedRuntimeV1({ ...proof, remoteDefaultSha: BASE }, session, false)).not.toThrow();
});

test('public resume parses only downloaded artifacts and excludes caller artifact/authorization bytes', async () => {
  const source = readFileSync(path.resolve(import.meta.dir, '../../scripts/codex/verification-session.ts'), 'utf8');
  const usage = source.slice(source.indexOf('const USAGE'), source.indexOf('export async function verificationSessionCli'));
  expect(usage).toContain('resume --request <request.json>');
  expect(usage).toContain('prepare-integration-hosted --repository <owner/name> --output <projection.json>');
  expect(usage).toContain('integrate-hosted --repository <owner/name> --output <projection.json>');
  expect(usage).toContain('closeout-mutate-hosted --repository <owner/name> --output <projection.json>');
  expect(usage).toContain('closeout-publish-hosted --repository <owner/name> --output <projection.json>');
  expect(usage).toContain('artifact-status --artifact <artifact.json>');
  expect(usage).toContain('(--evidence <evidence.json> | --previous-artifact <artifact.json>)');
  expect(usage).not.toContain('resume --artifact');
  expect(usage).not.toContain('--authorization <');
  const resume = source.slice(source.indexOf("if (command === 'resume')"), source.indexOf("if (command === 'integrate-hosted')"));
  expect(source).toContain("github.downloadArtifactText(repository, metadata,\n    'verification-session-artifact.json')");
  expect(resume).toContain('selectTrustedHostedSessionArtifactV1');
  expect(resume).toContain('observeDurableVerificationSessionProjection');
  expect(resume.indexOf('observeDurableVerificationSessionProjection'))
    .toBeLessThan(resume.indexOf('selectTrustedHostedSessionArtifactV1'));
  expect(source).not.toContain('selectTrustedMergeGateResultArtifactV1');
  expect(source).not.toContain("'merge-gate-result.json'");
  expect(source).not.toContain('sec-merge-gate-result-v2-pr-');
  expect(resume).not.toContain('sec-integration-authorization-v1-pr-');
  expect(resume).not.toContain("required(args, '--artifact')");
  expect(resume).not.toContain("args.get('--authorization')");
  expect(verificationSessionCli.length).toBe(1);
  expect(source).not.toContain('VerificationSessionCliInternalDependenciesV1');
  expect(source).not.toContain('verificationSessionCli(\n  argv: string[],');
  const githubSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts'), 'utf8');
  const authorizationPublicationSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/integration-authorization-publication.ts'), 'utf8');
  const closeoutSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/branch-closeout.ts'), 'utf8');
  const receiptSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/branch-closeout-receipt.ts'), 'utf8');
  const commandSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/branch-lifecycle-command.ts'), 'utf8');
  expect(githubSource).not.toContain('export interface VerificationSessionGitHubTransport');
  expect(githubSource).not.toContain('export class VerificationSessionGitHubAdapter');
  expect(githubSource).not.toContain('export class GhVerificationSessionTransport');
  expect(githubSource).not.toContain('runner: BranchLifecycleCommandRunner');
  const githubClientSurface = githubSource.slice(
    githubSource.indexOf('export type VerificationSessionGitHubClientV1'),
    githubSource.indexOf('export function createVerificationSessionGitHubClientV1')
  );
  expect(githubClientSurface).toContain("| 'observeHostedReviewRequest'");
  expect(githubClientSurface).toContain("| 'ensureVerificationSessionWakeup'");
  for (const rawPort of ['publishHostedReviewRequestComment', 'readHostedReviewRequestComment',
    'dispatchVerificationSession', 'mergeExactHead', 'createIssueComment', 'environment', 'runner']) {
    expect(githubClientSurface).not.toContain(rawPort);
  }
  expect(authorizationPublicationSource)
    .not.toContain('export function publishAndReadBackIntegrationAuthorizationOperationV1');
  expect(authorizationPublicationSource)
    .not.toContain('export interface IntegrationAuthorizationOperationPublicationResultV1');
  expect(authorizationPublicationSource).not.toContain('runBranchCommand(');
  expect(source).toContain('function publishHostedIntegrationAuthorizationOperationV1(');
  expect(source).not.toContain('export function publishHostedIntegrationAuthorizationOperationV1');
  expect(closeoutSource).not.toContain('FinalizeIntegratedBranchCloseoutInput');
  expect(closeoutSource).not.toContain('finalizeIntegratedBranchCloseout');
  expect(closeoutSource).not.toContain('effectStartAuthority');
  expect(receiptSource).not.toContain('export function publishAndReadBack');
  expect(receiptSource).not.toContain('export function consumeBranchCloseoutEffectStartPermitV1');
  expect(commandSource).not.toContain('export type BranchLifecycleCommandRunner');
  expect(commandSource).not.toContain('export const defaultBranchLifecycleCommandRunner');
  expect(commandSource).not.toContain('WeakMap');
  expect(commandSource).not.toContain('spawnSync');
  expect(source).toContain('function ensureHostedReviewRequestV1(');
  expect(githubSource).not.toContain('publishHostedReviewRequestComment');
  expect(source).toContain('function finalizeHostedBranchCloseoutV1');
  await expect(verificationSessionCli(['resume', '--request', 'request.json',
    '--artifact', 'forged.json'])).rejects.toThrow(/Unknown argument for resume: --artifact/);
  await expect(verificationSessionCli(['resume', '--request', 'request.json',
    '--authorization', 'forged.json'])).rejects.toThrow(/Unknown argument for resume: --authorization/);
  await expect(verificationSessionCli(['integrate-hosted', '--repository', 'sec-platform/sec',
    '--output', 'projection.json', '--authorization', 'forged.json']))
    .rejects.toThrow(/Unknown argument for integrate-hosted: --authorization/);
  for (const command of ['prepare-integration-hosted', 'integrate-hosted',
    'closeout-mutate-hosted', 'closeout-publish-hosted']) {
    await expect(verificationSessionCli([command, '--repository', 'sec-platform/sec',
      '--output', 'projection.json', '--artifact', 'caller.json']))
      .rejects.toThrow(new RegExp(`Unknown argument for ${command}: --artifact`));
  }
  await expect(verificationSessionCli(['finalize-hosted', '--envelope', 'envelope.json', '--output',
    'artifact.json', '--evidence', 'evidence.json', '--previous-artifact', 'prior.json']))
    .rejects.toThrow(/exactly one of --evidence or --previous-artifact/);
});

test('crash replay adopts a merged authorization marker before any new merge claim', () => {
  const source = readFileSync(path.resolve(import.meta.dir, '../../scripts/codex/verification-session-runtime.ts'), 'utf8');
  const adoption = source.indexOf('const matchingMergedConsumption = liveMerged');
  const ready = source.indexOf("status: 'READY_TO_INTEGRATE'", adoption);
  expect(adoption).toBeGreaterThan(0);
  expect(adoption).toBeLessThan(ready);
  expect(source).not.toContain('executeVerifiedIntegration');
  expect(source).toContain('now: liveMerged ? authorization.issuedAt : input.external.now()');
  expect(source).toContain("candidate.state !== 'MERGED'");
});

test('pure runtime excludes the physical TCB inspector and the session CLI privately owns its boundary', () => {
  const runtimeSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-runtime.ts'), 'utf8');
  const sessionSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const registrySource = readFileSync(path.resolve(import.meta.dir,
    '../../platform/shared/ci-trust-root-registry.json'), 'utf8');

  for (const physicalDependency of [
    'platform/shared/tcb-closure-lock.ts',
    'platform/shared/tcb-trust-root-contract.ts',
    'branch-lifecycle-command.ts',
    'TCB_CLOSURE_LOCK',
    'SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3',
    'createBranchLifecycleContext',
    'runBranchCommand',
    'inspectTrustedRuntimeV1',
    'requireCommand'
  ]) {
    expect(runtimeSource).not.toContain(physicalDependency);
  }
  expect(sessionSource).toContain("import { TCB_CLOSURE_LOCK } from '../../platform/shared/tcb-closure-lock.ts';");
  expect(sessionSource).toContain(
    "import { SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3 } from '../../platform/shared/tcb-trust-root-contract.ts';"
  );
  expect(sessionSource.match(/function inspectTrustedRuntimeV1\(/gu)).toHaveLength(1);
  expect(sessionSource.match(/inspectTrustedRuntimeV1\(\{/gu)).toHaveLength(5);
  expect(sessionSource).not.toContain('export function inspectTrustedRuntimeV1');
  expect(sessionSource).toContain("const entrypointPath = 'scripts/codex/verification-session-runtime.ts';");
  expect(registrySource.match(
    /scripts\/codex\/verification-session\.ts -> platform\/shared\/tcb-closure-lock\.ts/gu
  )).toHaveLength(1);
});

test('closeout blocks blocked/residue and requires canonical publication readback composite', () => {
  const source = readFileSync(path.resolve(import.meta.dir, '../../scripts/codex/verification-session.ts'), 'utf8');
  expect(source).toContain("terminal.receipt.status === 'blocked' || terminal.receipt.status === 'residue'");
  expect(source).toContain('function publishHostedCloseoutTerminalV1');
  expect(source).toContain('observeBranchCloseoutOperationPublicationV1(input.ctx.repositoryRoot');
  expect(source).toContain('publicationDigest: publication.publication.publicationDigest');
  expect(source).toContain('commentId: publication.commentId');
});

test('hosted effect commands preserve provider artifact, remote receipt, and phase ordering', () => {
  const source = readFileSync(path.resolve(import.meta.dir, '../../scripts/codex/verification-session.ts'), 'utf8');
  const status = source.slice(source.indexOf("if (command === 'status')"),
    source.indexOf("if (command === 'observe-hosted')"));
  expect(status).toContain('observeDurableVerificationSessionProjection');
  expect(status).not.toContain("status: current.length === 1 ? 'READY_TO_INTEGRATE'");
  const preparation = source.slice(source.indexOf("if (command === 'prepare-integration-hosted')"),
    source.indexOf("if (command === 'integrate-hosted')"));
  expect(preparation).toContain("route.lane === 'merged-recovery'");
  expect(preparation).toContain('loadMarkerBoundMergedAuthorizationRecoveryV1');
  expect(preparation.indexOf("route.lane === 'merged-recovery'"))
    .toBeLessThan(preparation.indexOf('prepareMergedPullRequestCloseout'));
  expect(preparation).not.toContain('only materializes recovery for an exact OPEN candidate');
  const integration = source.slice(source.indexOf("if (command === 'integrate-hosted')"),
    source.indexOf("if (command === 'closeout-mutate-hosted')"));
  const recoveryReadback = integration.indexOf('loadProviderBranchCloseoutRecoveryArtifact');
  const authorizationReceipt = integration.indexOf('publishHostedIntegrationAuthorizationOperationV1');
  const mergeEffect = integration.indexOf('executeHostedSquashMerge');
  expect(recoveryReadback).toBeGreaterThan(0);
  expect(authorizationReceipt).toBeGreaterThan(recoveryReadback);
  expect(mergeEffect).toBeGreaterThan(authorizationReceipt);
  // A merged-recovery blocker above this branch durably projects the required
  // maintainer action. The OPEN merge lane itself must still have no local
  // durable claim between its fresh effect guard and the provider merge.
  const readyToIntegrate = integration.indexOf("if (result.status === 'READY_TO_INTEGRATE')");
  expect(readyToIntegrate).toBeGreaterThan(authorizationReceipt);
  const claimedEffectBoundary = integration.slice(readyToIntegrate, mergeEffect);
  expect(claimedEffectBoundary).not.toContain('writeDurable(');
  expect(claimedEffectBoundary).not.toContain('claimVerificationSessionOperationV1');
  expect(integration).toContain('!effects.executePhysicalMerge || !ownsUnambiguousMergeStart');
  expect(integration).toContain('loadMarkerBoundMergedAuthorizationRecoveryV1');
  expect(integration).not.toContain('finalizeIntegratedBranchCloseout');
  expect(integration).not.toContain('publishAndReadBackIntegratedBranchCloseoutReceipt');

  const mutation = source.slice(source.indexOf("if (command === 'closeout-mutate-hosted')"),
    source.indexOf("if (command === 'closeout-publish-hosted')"));
  expect(mutation.indexOf('observeBranchCloseoutOperationPublicationV1'))
    .toBeLessThan(mutation.indexOf('observeBranchCloseoutEffectStartPublicationV1'));
  expect(mutation.indexOf('observeBranchCloseoutEffectStartPublicationV1'))
    .toBeLessThan(mutation.indexOf('observeExactRemoteCloseoutBranch'));
  expect(mutation.indexOf('priorAttemptStarted'))
    .toBeLessThan(mutation.indexOf('finalizeHostedBranchCloseoutV1'));
  const preMarkerLease = mutation.indexOf('await withWorkspaceWriteLease(');
  const preMarkerAuthorization = mutation.indexOf('const preMarkerGuard = await authorizeHostedCloseoutEffectUnderLeaseV1');
  const effectStartReadback = mutation.indexOf('publishHostedCloseoutEffectStartV1');
  const closeoutEffect = mutation.indexOf('finalizeHostedBranchCloseoutV1');
  expect(preMarkerLease).toBeGreaterThan(0);
  expect(preMarkerAuthorization).toBeGreaterThan(preMarkerLease);
  expect(effectStartReadback).toBeGreaterThan(preMarkerAuthorization);
  expect(mutation).toContain('worktreeCleanupTokens');
  expect(mutation).toContain('foreignWorktreeObservationDigests');
  expect(mutation).not.toContain('worktree-cleanup-authorizations');
  expect(source).not.toContain('loadTrustedCompletedWorktreePhysicalCloseoutV1');
  expect(effectStartReadback).toBeGreaterThan(0);
  expect(effectStartReadback).toBeLessThan(closeoutEffect);
  const effectStartBoundary = mutation.slice(effectStartReadback, closeoutEffect);
  expect(effectStartBoundary).not.toContain('writeDurable(');
  expect(effectStartBoundary).not.toContain('branchCloseoutStore(');
  expect(effectStartBoundary).not.toContain('claimVerificationSessionOperationV1');
  expect(mutation).toContain("effectStart = Object.freeze({ disposition: 'existing'");
  expect(mutation).toContain("publishedStart.disposition !== 'published'");
  expect(mutation).toContain('markerDisposition: effectStart.disposition');
  expect(mutation).not.toContain('effectStartDisposition');
  expect(mutation).not.toContain('publishAndReadBackIntegratedBranchCloseoutReceipt');

  const publication = source.slice(source.indexOf("if (command === 'closeout-publish-hosted')"),
    source.indexOf('throw new Error(USAGE)', source.indexOf("if (command === 'closeout-publish-hosted')")));
  expect(publication.indexOf('observeBranchCloseoutOperationPublicationV1'))
    .toBeLessThan(publication.indexOf('priorAttemptStarted'));
  expect(publication.indexOf('priorAttemptStarted'))
    .toBeLessThan(publication.indexOf('publishHostedCloseoutTerminalV1'));
  expect(publication.indexOf('observeBranchCloseoutEffectStartPublicationV1'))
    .toBeLessThan(publication.indexOf('operationReceiptFilePath'));
  expect(publication).toContain("effectStart: Object.freeze({ disposition: 'existing'");
  expect(publication).toContain('publishHostedCloseoutTerminalV1({');
});

test('expired hosted authority permits only independently revalidated Action Evidence reuse', () => {
  const artifact = {
    scopeAuthorization: { expiresAt: '2026-08-09T00:10:00.000Z' },
    preGateReview: { expiresAt: '2026-08-09T00:15:00.000Z' },
    mainHealth: { expiresAt: '2026-08-09T00:10:00.000Z' },
    evidence: { status: 'passed' }
  };
  expect(classifyVerificationSessionArtifactReuseV1(artifact as never, '2026-08-09T00:11:00.000Z')).toMatchObject({
    status: 'fresh-authority-required', actionEvidenceCandidate: true
  });
  expect(classifyVerificationSessionArtifactReuseV1({ ...artifact, evidence: { status: 'failed' } } as never,
    '2026-08-09T00:16:00.000Z')).toMatchObject({
      status: 'fresh-authority-required', actionEvidenceCandidate: true
    });
  for (const status of ['not-run', 'unsupported', 'invalidated'] as const) {
    expect(classifyVerificationSessionArtifactReuseV1({ ...artifact, evidence: { status } } as never,
      '2026-08-09T00:16:00.000Z')).toMatchObject({ status: 'not-reusable', actionEvidenceCandidate: false });
  }
  const cli = readFileSync(path.resolve(import.meta.dir, '../../scripts/codex/verification-session.ts'), 'utf8');
  const refreshPath = cli.slice(cli.indexOf("if (command === 'finalize-hosted')"),
    cli.indexOf("if (command === 'resume')"));
  expect(refreshPath).toContain('refreshVerificationSessionHostedArtifactV2');
  expect(refreshPath).not.toContain('runLocalActions');
  expect(refreshPath).not.toContain('executeVerifiedIntegration');
});

test('actual reducer recovers a crash after remote merge without a second merge or publication', () => {
  const fixture = reducerFixture();
  try {
    expect(runReducer(fixture)).toMatchObject({ status: 'READY_TO_INTEGRATE',
      operationId: fixture.result.authorization.consumptionOperationId });
    // Models process loss after the remote merge but before any local journal
    // transition. The reducer adopts the exact remote marker and never owns a
    // raw merge capability that could repeat the effect.
    fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
      fixture.artifact.session.sessionRevision);
    expect(runReducer(fixture)).toMatchObject({ status: 'COMPLETED', completedStage: 'closeout-terminal' });
    const observed = fixture.counters.closeoutObserve;
    expect(runReducer(fixture)).toMatchObject({ status: 'COMPLETED' });
    expect(fixture.counters.closeoutObserve).toBeGreaterThanOrEqual(observed);
  } finally {
    fixture.dispose();
  }
});

test('durable comment and merge markers reconstruct terminal status without an Actions artifact', () => {
  const fixture = reducerFixture();
  try {
    const publication = durablePublication(fixture);
    const exactOpen = classifyDurableVerificationSessionProjectionV1({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: []
    });
    expect(exactOpen).toBeNull();
    expect(classifyDurableVerificationSessionProjectionV1({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: [publication]
    })).toMatchObject({ status: 'BLOCKED_AMBIGUOUS_SIDE_EFFECT' });

    fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
      fixture.artifact.session.sessionRevision);
    const ready = classifyDurableVerificationSessionProjectionV1({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: [publication]
    });
    expect(ready).toMatchObject({ status: 'READY_TO_CLOSEOUT', candidateState: 'MERGED' });
    const closeoutOperationId = ready?.closeoutOperationId;
    if (typeof closeoutOperationId !== 'string') throw new Error('closeout operation id missing');
    expect(classifyDurableVerificationSessionProjectionV1({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: [publication],
      closeout: { closeoutOperationId: closeoutOperationId as `sha256:${string}`,
        commentId: 700, status: 'completed' }
    })).toMatchObject({ status: 'COMPLETED', closeoutCommentId: 700 });
  } finally {
    fixture.dispose();
  }
});

test('durable remote projection blocks closed PR and OPEN candidate identity drift', () => {
  for (const candidate of [
    { ...new ReducerTransport().candidate(), state: 'CLOSED' as const },
    { ...new ReducerTransport().candidate(), baseSha: 'f'.repeat(40) },
    { ...new ReducerTransport().candidate(), baseTreeSha: 'f'.repeat(40) },
    { ...new ReducerTransport().candidate(), headSha: 'e'.repeat(40) },
    { ...new ReducerTransport().candidate(), headTreeSha: 'e'.repeat(40) }
  ]) {
    expect(classifyDurableVerificationSessionProjectionV1({ repository: 'sec-platform/sec',
      request: JOIN_REQUEST, candidate, publications: [] })).toMatchObject({ status: 'BLOCKED' });
  }
});

test('MERGED recovery permits advanced main only when the marker commit remains reachable', () => {
  const advancedMain = '8'.repeat(40);
  const reachable = reducerFixture({ remoteDefaultSha: advancedMain,
    mergeToDefault: { status: 'ahead', behindBy: 0 } });
  try {
    reachable.transport.adoptMerged(reachable.markers, reachable.result.reviewReceipt,
      reachable.artifact.session.sessionRevision);
    expect(runReducer(reachable)).toMatchObject({ status: 'COMPLETED' });
  } finally {
    reachable.dispose();
  }

  for (const comparison of [
    { status: 'diverged', behindBy: 1 },
    { status: 'behind', behindBy: 1 }
  ] satisfies GitHubComparisonObservationV1[]) {
    const blocked = reducerFixture({ remoteDefaultSha: advancedMain, mergeToDefault: comparison });
    try {
      blocked.transport.adoptMerged(blocked.markers, blocked.result.reviewReceipt,
        blocked.artifact.session.sessionRevision);
      expect(() => runReducer(blocked)).toThrow(/ancestor|reachability/i);
    } finally {
      blocked.dispose();
    }
  }
  const invalidBase = reducerFixture({ baseToMerge: { status: 'diverged', behindBy: 1 } });
  try {
    invalidBase.transport.adoptMerged(invalidBase.markers, invalidBase.result.reviewReceipt,
      invalidBase.artifact.session.sessionRevision);
    expect(() => runReducer(invalidBase)).toThrow(/old base ancestry/i);
  } finally {
    invalidBase.dispose();
  }
});

test('MERGED reachability permits detached old-base only with synchronized post-merge default', () => {
  const advancedMain = '8'.repeat(40);
  const fixture = reducerFixture({ remoteDefaultSha: advancedMain,
    mergeToDefault: { status: 'ahead', behindBy: 0 } });
  try {
    fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
      fixture.artifact.session.sessionRevision);
    const candidate = fixture.transport.candidate();
    const proof = { currentHeadSha: BASE, currentBranch: '', localDefaultSha: advancedMain,
      remoteDefaultSha: advancedMain, workingTreeClean: true, tcbClosureMatched: true,
      runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
    const input = { proof, repository: fixture.artifact.session.repository,
      prNumber: fixture.artifact.session.prNumber, baseSha: fixture.artifact.session.baseSha,
      headSha: fixture.artifact.session.headSha, headTreeSha: fixture.artifact.session.headTreeSha,
      candidate, github: fixture.github };
    expect(() => assertTrustedMergedRequestRuntimeReachabilityV1(input)).not.toThrow();
    expect(() => assertTrustedMergedRequestRuntimeReachabilityV1({ ...input,
      proof: { ...proof, localDefaultSha: BASE } })).toThrow(/synchronized local\/live default/i);
    expect(() => assertTrustedMergedRequestRuntimeReachabilityV1({ ...input,
      proof: { ...proof, localDefaultSha: 'f'.repeat(40) } })).toThrow(/synchronized local\/live default/i);
    expect(() => assertTrustedMergedRequestRuntimeReachabilityV1({ ...input,
      proof: { ...proof, currentBranch: 'feature/foreign' } })).toThrow(/old-base trusted TCB/i);
    expect(() => assertTrustedMergedRequestRuntimeReachabilityV1({ ...input,
      proof: { ...proof, currentHeadSha: HEAD } })).toThrow(/old-base trusted TCB/i);
  } finally {
    fixture.dispose();
  }
});

test('actual reducer rejects OPEN base/head drift before any merge claim or effect', () => {
  for (const [field, value] of [
    ['baseSha', 'f'.repeat(40)],
    ['headSha', 'e'.repeat(40)]
  ] as const) {
    const fixture = reducerFixture();
    try {
      fixture.transport.observation = { ...fixture.transport.observation, [field]: value };
      expect(() => runReducer(fixture)).toThrow(/live .* drifted/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer rejects expired or already-consumed authorization before merge', () => {
  for (const fixture of [
    reducerFixture({ authorizationExpiresAt: '2026-08-09T14:06:00.000Z', now: '2026-08-09T14:07:00.000Z' }),
    reducerFixture({ consumed: true })
  ]) {
    try {
      expect(() => runReducer(fixture)).toThrow(/expired|already consumed/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer binds IntegrationAuthorization to trusted live repository and PR', () => {
  for (const identity of [
    { repository: 'attacker/fork' },
    { prNumber: 99 }
  ]) {
    const fixture = reducerFixture();
    try {
      fixture.setAuthorizationResult(substituteAuthorizationLiveIdentity(fixture, identity));
      expect(() => runReducer(fixture)).toThrow(/repository|prNumber/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer rejects downloaded merge-result digest or provenance substitution', () => {
  for (const mutate of [
    (value: Record<string, any>) => { value.resultDigest = `sha256:${'f'.repeat(64)}`; },
    (value: Record<string, any>) => { value.provenance.sourceRunId = 'forged-run'; }
  ]) {
    const fixture = reducerFixture();
    try {
      const value = JSON.parse(encodeVerificationActionDataV2(fixture.result)) as Record<string, any>;
      mutate(value);
      fixture.setAuthorizationResult(JSON.stringify(value));
      expect(() => runReducer(fixture)).toThrow(/digest|provenance|issuer/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer blocks merged-tree mismatch and blocked/residue closeout terminals', () => {
  const mismatch = reducerFixture();
  try {
    mismatch.transport.mergedTreeSha = 'd'.repeat(40);
    expect(runReducer(mismatch)).toMatchObject({ status: 'READY_TO_INTEGRATE' });
    mismatch.transport.adoptMerged(mismatch.markers, mismatch.result.reviewReceipt,
      mismatch.artifact.session.sessionRevision);
    expect(() => runReducer(mismatch)).toThrow(/marker-bound candidate\/tree identity/i);
  } finally {
    mismatch.dispose();
  }
  for (const terminal of ['blocked', 'residue'] as const) {
    const fixture = reducerFixture({ closeout: terminal });
    try {
      expect(runReducer(fixture)).toMatchObject({ status: 'READY_TO_INTEGRATE' });
      fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
        fixture.artifact.session.sessionRevision);
      expect(runReducer(fixture)).toMatchObject({ status: 'BLOCKED', reason: `branch closeout terminal ${terminal}` });
    } finally {
      fixture.dispose();
    }
  }
});

test('reducer emits one stable integration intent and never executes a physical merge', () => {
  const fixture = reducerFixture();
  try {
    const first = runReducer(fixture);
    const replay = runReducer(fixture);
    expect(first).toMatchObject({ status: 'READY_TO_INTEGRATE',
      operationId: fixture.result.authorization.consumptionOperationId });
    expect(replay).toMatchObject({ status: 'READY_TO_INTEGRATE', operationId: first.operationId });
  } finally {
    fixture.dispose();
  }
});

test('incomplete GitHub pagination fails closed before Review can clear', () => {
  class IncompletePaginationTransport extends FakeTransport {
    override reviewPage(): GitHubPageV1<GitHubReviewObservationV1> {
      return page([], true, null);
    }
  }
  const transport = new IncompletePaginationTransport();
  transport.issueComments = [[botIssueComment()]];
  expectTypedProviderSchemaUnsupported(observe(transport));
});

test('remote Session workflow join covers active and artifact-publication states without redispatch', () => {
  const joined = (transport: FakeTransport, now = '2026-08-09T14:05:00.000Z') =>
    evaluateVerificationSessionWorkflowJoinV1(transport, {
      repository: 'sec-platform/sec', prNumber: 42, sessionRevision: JOIN_SESSION,
      actionPlanDigest: JOIN_ACTION, baseSha: BASE, now
    });
  for (const status of ['queued', 'in_progress', 'waiting'] as const) {
    const transport = new FakeTransport();
    transport.workflowRuns = [[workflowRun({ status })]];
    expect(joined(transport)).toMatchObject({ status: 'joined', reason: 'active-run' });
  }
  const completed = new FakeTransport();
  completed.workflowRuns = [[workflowRun({ status: 'completed', conclusion: 'success' })]];
  expect(joined(completed)).toMatchObject({ status: 'joined', reason: 'artifact-publication-window' });

  for (const conclusion of ['failure', 'cancelled'] as const) {
    const terminal = new FakeTransport();
    terminal.workflowRuns = [[workflowRun({ status: 'completed', conclusion })]];
    expect(joined(terminal)).toMatchObject({ status: 'redispatch-eligible', reason: 'terminal-run' });
  }
  expect(joined(completed, '2026-08-09T14:11:00.001Z')).toMatchObject({
    status: 'redispatch-eligible', reason: 'artifact-publication-window-expired'
  });
});

test('hosted compiler distinguishes exact external Session and proposal-only internal Action dispatches', () => {
  expect(VERIFICATION_SESSION_HOSTED_REQUEST_SCHEMA_V1).toBe(CI_VERIFICATION_SESSION_REQUEST_SCHEMA);
  expect(VERIFICATION_SESSION_HOSTED_EVENT_V2).toBe(CI_VERIFICATION_SESSION_DISPATCH_TYPE);
  const runtimeSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-runtime.ts'), 'utf8');
  const githubAdapterSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts'), 'utf8');
  expect(runtimeSource).not.toContain("'sec-verification-session-hosted-request-v1'");
  expect(runtimeSource).not.toContain("'sec-verify-session-v2'");
  expect(githubAdapterSource).toContain('event_type: CI_VERIFICATION_SESSION_DISPATCH_TYPE');
  expect(githubAdapterSource).not.toContain("event_type: 'sec-verify-session-v2'");

  expect(assertHostedCompilerDispatchPayloadV1({ action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    clientPayload: { payload: JOIN_REQUEST }, request: JOIN_REQUEST })).toEqual({ kind: 'external-session' });
  const proposedActionKey = `sha256:${'8'.repeat(64)}` as const;
  const proposal = createCiVerificationActionProposalV2({
    sessionRequest: { ...JOIN_REQUEST }, proposedActionKey
  });
  const parentPlan = createCiVerificationActionParentDispatchPlanV2({
    repositoryId: '123', repository: 'sec-platform/sec', parentRunId: '100', parentRunAttempt: 1,
    parentJobId: '150',
    parentWorkflowRef: 'sec-platform/sec/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
    parentWorkflowSha: BASE,
    parentActor: { login: 'integrator', id: 101, nodeId: 'INTEGRATOR', type: 'User', permission: 'maintain' },
    proposals: [proposal]
  });
  const envelope = createCiVerificationActionProviderEnvelopeV2({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '500', parentDispatchPlanArchiveDigest: PAGE });
  expect(assertHostedCompilerDispatchPayloadV1({ action: 'sec-produce-verification-action-v2',
    clientPayload: { payload: envelope }, request: JOIN_REQUEST }))
    .toEqual({ kind: 'internal-action', envelope });

  for (const [label, action, clientPayload] of [
    ['forged action', 'sec-produce-verification-action-v3', { payload: envelope }],
    ['raw internal payload', 'sec-produce-verification-action-v2', envelope],
    ['wrong wrapper schema', 'sec-produce-verification-action-v2',
      { payload: { ...envelope, schema: 'forged' } }],
    ['extra outer wrapper key', 'sec-produce-verification-action-v2',
      { payload: envelope, authority: true }],
    ['missing proposal locator', 'sec-produce-verification-action-v2',
      { payload: { ...envelope,
        proposal: { schema: proposal.schema, sessionRequest: JOIN_REQUEST } } }],
    ['invalid proposal locator', 'sec-produce-verification-action-v2',
      { payload: { ...envelope,
        proposal: { ...proposal, proposedActionKey: 'sha256:not-a-digest' } } }],
    ['substituted Session request', 'sec-produce-verification-action-v2',
      { payload: { ...envelope,
        proposal: { ...proposal, sessionRequest: { ...JOIN_REQUEST, prNumber: 99 } } } }]
  ] as const) {
    expect(() => assertHostedCompilerDispatchPayloadV1({ action, clientPayload,
      request: JOIN_REQUEST }), label).toThrow();
  }
  expect(() => assertHostedCompilerDispatchPayloadV1({ action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    clientPayload: JOIN_REQUEST, request: JOIN_REQUEST })).toThrow();
  expect(() => assertHostedCompilerDispatchPayloadV1({ action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    clientPayload: { payload: { ...JOIN_REQUEST, proposedActionKey } }, request: JOIN_REQUEST }))
    .toThrow('external Session payload differs');
});

test('internal Action child binds Actions bot/App and exact parent run/artifact/member provenance', () => {
  const proposedActionKey = `sha256:${'8'.repeat(64)}` as const;
  const proposal = createCiVerificationActionProposalV2({ sessionRequest: { ...JOIN_REQUEST },
    proposedActionKey });
  const parentActor = { login: 'integrator', id: 101, nodeId: 'INTEGRATOR',
    type: 'User' as const, permission: 'maintain' as const };
  const parentPlan = createCiVerificationActionParentDispatchPlanV2({
    repositoryId: '123', repository: 'sec-platform/sec', parentRunId: '100', parentRunAttempt: 1,
    parentJobId: '150',
    parentWorkflowRef: 'sec-platform/sec/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
    parentWorkflowSha: BASE, parentActor, proposals: [proposal]
  });
  const envelope = createCiVerificationActionProviderEnvelopeV2({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '500', parentDispatchPlanArchiveDigest: PAGE });
  const parentPlanSource = `${encodeVerificationActionDataV2(parentPlan)}\n`;
  expect(ciVerificationActionParentDispatchPlanPayloadDigestV2(parentPlan))
    .toBe(envelope.parentDispatchPlanPayloadDigest);
  const artifact: GitHubActionsArtifactObservationV1 = {
    artifactId: '500', artifactName: envelope.parentDispatchPlanArtifactName,
    archiveDigest: PAGE, workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
    runId: '100', runAttempt: 1, eventName: 'repository_dispatch',
    actorNodeId: 'INTEGRATOR', actorPermission: 'maintain', expired: false
  };
  const bot = CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot;
  const app = CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app;
  const botRecord = { login: bot.login, id: bot.id, node_id: bot.nodeId, type: bot.type };
  const currentRun = { id: 200, run_attempt: 1, workflow_id: 300, check_suite_id: 400,
    event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
    head_sha: BASE, head_branch: 'main', name: 'compiler-pr-validation',
    display_title: `produce Action ${proposedActionKey}`, actor: botRecord,
    repository: { id: 123, full_name: 'sec-platform/sec' } };
  const currentWorkflow = { id: 300, path: '.github/workflows/compiler-pr-validation.yml',
    state: 'active' };
  const currentCheckSuite = { id: 400, head_sha: BASE,
    repository: { id: 123, full_name: 'sec-platform/sec' },
    app: { id: app.id, node_id: app.nodeId, slug: app.slug } };
  const parentRun = { id: 100, run_attempt: 1, event: 'repository_dispatch',
    path: '.github/workflows/compiler-pr-validation.yml', head_sha: BASE, head_branch: 'main',
    name: 'compiler-pr-validation',
    display_title: `verify session PR #42 session ${JOIN_SESSION}`,
    actor: { login: parentActor.login, id: parentActor.id, node_id: parentActor.nodeId,
      type: parentActor.type }, repository: { id: 123, full_name: 'sec-platform/sec' } };
  const parentPrincipal = { login: parentActor.login, nodeId: parentActor.nodeId,
    permission: parentActor.permission };
  const parentJob: GitHubWorkflowJobObservationV1 = {
    id: '150', runId: '100', runAttempt: 1, name: parentPlan.parentJobName,
    status: 'in_progress', conclusion: null, headSha: BASE,
    startedAt: '2026-08-09T14:00:00.000Z', completedAt: null,
    steps: [{ name: parentPlan.parentPlanStepName, number: 3, status: 'completed',
      conclusion: 'success', startedAt: '2026-08-09T14:00:01.000Z',
      completedAt: '2026-08-09T14:00:02.000Z' }]
  };
  const input = { repository: 'sec-platform/sec', repositoryId: '123', request: JOIN_REQUEST,
    envelope, parentPlanSource, parentArtifact: artifact, parentArtifactInventory: [artifact],
    parentJobs: [parentJob], currentRun, currentWorkflow, currentCheckSuite, eventSender: botRecord,
    parentRun, parentPrincipal };
  expect(assertHostedCompilerInternalProvenanceV2(input)).toMatchObject({
    parentActorNodeId: 'INTEGRATOR',
    parentPlan: { parentDispatchPlanDigest: parentPlan.parentDispatchPlanDigest }
  });

  for (const [label, delta] of [
    ['human child sender', { eventSender: parentRun.actor }],
    ['human child run actor', { currentRun: { ...currentRun, actor: parentRun.actor } }],
    ['rerun child attempt', { currentRun: { ...currentRun, run_attempt: 2 } }],
    ['wrong child workflow id', { currentWorkflow: { ...currentWorkflow, id: 301 } }],
    ['disabled child workflow', { currentWorkflow: { ...currentWorkflow, state: 'disabled_manually' } }],
    ['wrong child App', { currentCheckSuite: { ...currentCheckSuite,
      app: { ...currentCheckSuite.app, node_id: 'wrong-app' } } }],
    ['substituted archive', { parentArtifact: { ...artifact, archiveDigest: `sha256:${'f'.repeat(64)}` as const } }],
    ['duplicate parent artifact', { parentArtifactInventory: [artifact, { ...artifact, artifactId: '501' }] }],
    ['missing parent job', { parentJobs: [] }],
    ['duplicate parent job id', { parentJobs: [parentJob, parentJob] }],
    ['wrong parent job', { parentJobs: [{ ...parentJob, name: 'forged-job' }] }],
    ['pending plan step', { parentJobs: [{ ...parentJob, steps: [{ ...parentJob.steps[0]!,
      status: 'in_progress' as const, conclusion: null }] }] }],
    ['failed plan step', { parentJobs: [{ ...parentJob, steps: [{ ...parentJob.steps[0]!,
      conclusion: 'failure' }] }] }],
    ['duplicate plan step', { parentJobs: [{ ...parentJob,
      steps: [parentJob.steps[0]!, { ...parentJob.steps[0]!, number: 4 }] }] }],
    ['internal parent run', { parentRun: { ...parentRun,
      display_title: `produce Action ${proposedActionKey}` } }],
    ['membership drift', { parentPrincipal: { ...parentPrincipal, permission: 'write' as const } }],
    ['noncanonical parent bytes', { parentPlanSource: `${parentPlanSource} ` }]
  ] as const) {
    expect(() => assertHostedCompilerInternalProvenanceV2({ ...input, ...delta }), label).toThrow();
  }
});

test('two independent local coordinators join one provider run and send only one wake-up signal', () => {
  const transport = new FakeTransport();
  const coordinate = () => {
    const join = evaluateVerificationSessionWorkflowJoinV1(transport, { repository: 'sec-platform/sec',
      prNumber: 42, sessionRevision: JOIN_SESSION, actionPlanDigest: JOIN_ACTION,
      baseSha: BASE, now: '2026-08-09T14:05:00.000Z' });
    if (join.status === 'redispatch-eligible') {
      transport.ensureVerificationSessionWakeup();
      transport.workflowRuns = [[workflowRun()]];
    }
    return join;
  };
  expect(coordinate().status).toBe('redispatch-eligible');
  expect(coordinate().status).toBe('joined');
  expect(transport.dispatches).toBe(1);
});

test('Session workflow join uses complete pages and rejects duplicate/conflicting inventory', () => {
  const adapterInput = { repository: 'sec-platform/sec', prNumber: 42,
    sessionRevision: JOIN_SESSION, actionPlanDigest: JOIN_ACTION, baseSha: BASE,
    now: '2026-08-09T14:05:00.000Z' } as const;
  const paged = new FakeTransport();
  paged.workflowRuns = [[], [workflowRun({ id: '9' })]];
  expect(evaluateVerificationSessionWorkflowJoinV1(paged, adapterInput))
    .toMatchObject({ status: 'joined', runIds: ['9:1'] });

  const duplicate = new FakeTransport();
  duplicate.workflowRuns = [[workflowRun()], [workflowRun({ status: 'waiting' })]];
  expect(() => evaluateVerificationSessionWorkflowJoinV1(duplicate, adapterInput))
    .toThrow(/duplicate run\/attempt/i);

  const conflict = new FakeTransport();
  conflict.workflowRuns = [[workflowRun({ displayTitle:
    `verify session PR #42 session ${JOIN_SESSION} action sha256:${'8'.repeat(64)}` })]];
  expect(() => evaluateVerificationSessionWorkflowJoinV1(conflict, adapterInput))
    .toThrow(/conflicting run identity/i);

  class IncompleteWorkflowPaginationTransport extends FakeTransport {
    override workflowRunPage(): GitHubPageV1<GitHubWorkflowRunObservationV1> {
      return page([], true, null);
    }
  }
  expect(() => evaluateVerificationSessionWorkflowJoinV1(
    new IncompleteWorkflowPaginationTransport(), adapterInput
  )).toThrow(/pagination.*did not advance/i);
});

type CloseoutCliHarnessState = Record<string, any> & {
  activeWorkPackageSelected: boolean;
};

function readCloseoutCliHarnessState(statePath: string): CloseoutCliHarnessState {
  return JSON.parse(readFileSync(statePath, 'utf8')) as CloseoutCliHarnessState;
}

function writeCloseoutCliHarnessState(statePath: string, state: CloseoutCliHarnessState): void {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function compileCloseoutCliProviderShims(root: string): string {
  const shimRoot = path.join(root, 'provider-shims');
  mkdirSync(shimRoot, { recursive: true });
  const gitProgram = path.join(shimRoot, 'git-shim.ts');
  const ghProgram = path.join(shimRoot, 'gh-shim.ts');
  writeFileSync(gitProgram, `
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const statePath = process.env.SEC_CLOSEOUT_TEST_STATE;
if (!statePath) throw new Error('SEC_CLOSEOUT_TEST_STATE is required');
const read = () => JSON.parse(readFileSync(statePath, 'utf8'));
const save = (value) => writeFileSync(statePath, JSON.stringify(value, null, 2) + '\\n', 'utf8');
const state = read();
const args = process.argv.slice(2);
const out = (value = '') => { process.stdout.write(String(value)); process.exit(0); };
const fail = (value) => { process.stderr.write(String(value)); process.exit(1); };
const branchRef = 'refs/heads/' + state.branch;
if (args[0] === 'init' && args[1] === '--bare' && args[2] === '.') out('');
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') out(state.repositoryRoot);
if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') out(state.commonDir);
if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
  state.headReadValues = [...(state.headReadValues || []), state.baseSha];
  save(state);
  out(state.baseSha);
}
if (args[0] === 'rev-parse' && args[1] === 'refs/remotes/origin/main') out(state.localDefaultSha);
if (args[0] === 'rev-parse' && args[1] === '--verify') out(state.headSha);
if (args[0] === 'rev-parse' && args[1] === state.headSha + '^{tree}') out(state.headTreeSha);
if (args[0] === 'rev-parse' && typeof args[1] === 'string' && args[1].includes(':')) {
  const file = args[1].slice(args[1].indexOf(':') + 1);
  out(state.tcbBlobs[file] || state.runtimeBlob);
}
if (args[0] === 'hash-object') {
  const file = args[args.length - 1];
  out(state.tcbBlobs[file] || state.runtimeBlob);
}
if (args[0] === 'branch' && args[1] === '--show-current') out('main');
if (args[0] === 'status') out('');
if (args[0] === '-C' && args.includes('status')) out('');
if (args[0] === 'remote' && args[1] === 'get-url') out('https://github.com/' + state.repository + '.git');
if (args[0] === 'symbolic-ref') out('origin/main');
if (args[0] === 'for-each-ref') {
  let value = 'main\\0' + state.baseSha + '\\0\\n';
  if (state.localPresent) value += state.branch + '\\0' + state.headSha + '\\0\\n';
  out(value);
}
if (args[0] === 'ls-remote') fail('plain ls-remote is forbidden');
if (args[0] === '-c'
  && args[1] === 'http.extraHeader='
  && args[2] === '-c'
  && args[3] === 'http.https://github.com/.extraheader='
  && args[4] === '-c'
  && args[5] === 'credential.helper='
  && args[6] === '-c'
  && args[7] === 'credential.helper=!gh auth git-credential'
  && args[8] === 'ls-remote') {
  const inventoryExpected = ['-c', 'http.extraHeader=', '-c',
    'http.https://github.com/.extraheader=', '-c', 'credential.helper=', '-c',
    'credential.helper=!gh auth git-credential', 'ls-remote', '--heads', 'origin'];
  if (JSON.stringify(args) === JSON.stringify(inventoryExpected)) {
    let value = state.liveDefaultSha + '\\trefs/heads/main\\n';
    if (state.remotePresent) value += state.headSha + '\\t' + branchRef + '\\n';
    out(value);
  }
  const requested = args[args.length - 1];
  const expected = ['-c', 'http.extraHeader=', '-c', 'http.https://github.com/.extraheader=',
    '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'ls-remote', '--exit-code', 'origin', requested];
  if (JSON.stringify(args) !== JSON.stringify(expected)) fail('non-canonical remote default readback');
  if (requested === 'refs/heads/main') {
    state.liveDefaultReadCount = Number(state.liveDefaultReadCount || 0) + 1;
    if (state.raceAfterRefOnlyFetch === true && Number(state.refOnlyFetchCount || 0) > 0) {
      state.liveDefaultSha = state.racedDefaultSha;
    }
    save(state);
    out(state.liveDefaultSha + '\\trefs/heads/main\\n');
  }
  if (requested === branchRef) {
    state.credentialBoundBranchReadCount = Number(state.credentialBoundBranchReadCount || 0) + 1;
    save(state);
    if (state.remotePresent) out(state.headSha + '\\t' + branchRef + '\\n');
    process.exit(2);
  }
  fail('unexpected credential-bound remote ref');
}
if (args[0] === 'worktree' && args[1] === 'list') {
  out('worktree ' + state.repositoryRoot + '\\0HEAD ' + state.baseSha + '\\0branch refs/heads/main\\0\\0');
}
if (args[0] === 'config') out('true');
if (args[0] === 'fetch') out('');
if (args[0] === '-c'
  && args[1] === 'http.extraHeader='
  && args[2] === '-c'
  && args[3] === 'http.https://github.com/.extraheader='
  && args[4] === '-c'
  && args[5] === 'credential.helper='
  && args[6] === '-c'
  && args[7] === 'credential.helper=!gh auth git-credential'
  && args[8] === 'fetch') {
  const expected = ['-c', 'http.extraHeader=', '-c', 'http.https://github.com/.extraheader=',
    '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
    '+refs/heads/main:refs/remotes/origin/main'];
  if (JSON.stringify(args) !== JSON.stringify(expected)) fail('non-canonical ref-only fetch');
  state.refOnlyFetchCount = Number(state.refOnlyFetchCount || 0) + 1;
  save(state);
  if (state.refOnlyFetchFailure === true) fail('simulated ref-only fetch failure');
  state.localDefaultSha = state.liveDefaultSha;
  save(state);
  out('');
}
if (args[0] === 'bundle' && args[1] === 'create') {
  mkdirSync(path.dirname(args[2]), { recursive: true });
  writeFileSync(args[2], Buffer.from('canonical V6 recovery bundle bytes'));
  out('');
}
if (args[0] === 'bundle' && args[1] === 'verify') out('verified V6 recovery bundle');
if (args[0] === 'cat-file' && args[1] === '-e') {
  if (String(args[2]).includes('scripts/codex/branch-closeout-receipt.ts')) fail('missing enforcement marker');
  out('');
}
if (args[0] === 'update-ref' && args[1] === '-d') {
  if (args[2] === branchRef) {
    state.localPresent = false;
    state.localDeleteCount += 1;
    save(state);
  }
  out('');
}
if (args[0] === '-c'
  && args[1] === 'http.extraHeader='
  && args[2] === '-c'
  && args[3] === 'http.https://github.com/.extraheader='
  && args[4] === '-c'
  && args[5] === 'credential.helper='
  && args[6] === '-c'
  && args[7] === 'credential.helper=!gh auth git-credential'
  && args[8] === 'push'
  && args.includes(':' + branchRef)) {
  state.remoteDeleteCount += 1;
  state.remotePresent = false;
  const crash = state.crashAfterDelete === true && state.crashInjected !== true;
  if (crash) {
    state.crashInjected = true;
    state.crashShimPid = process.pid;
  }
  save(state);
  if (crash) {
    if (typeof state.crashReleasePath !== 'string' || state.crashReleasePath.length === 0) {
      fail('crashReleasePath is required for the closeout crash barrier');
    }
    while (!existsSync(state.crashReleasePath)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    process.exit(0);
  }
  out('deleted ' + branchRef);
}
if (args[0] === 'remote' && args[1] === 'prune') {
  state.pruneCount += 1;
  save(state);
  out('');
}
fail('unsupported test git command: ' + args.join(' '));
`, 'utf8');
  writeFileSync(ghProgram, `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const statePath = process.env.SEC_CLOSEOUT_TEST_STATE;
if (!statePath) throw new Error('SEC_CLOSEOUT_TEST_STATE is required');
const read = () => JSON.parse(readFileSync(statePath, 'utf8'));
const save = (value) => writeFileSync(statePath, JSON.stringify(value, null, 2) + '\\n', 'utf8');
const state = read();
const args = process.argv.slice(2);
const out = (value) => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0); };
const fail = (value) => { process.stderr.write(String(value)); process.exit(1); };
const endpoint = args.find((arg) => typeof arg === 'string'
  && (arg.startsWith('/repos/') || arg.startsWith('/users/'))) || '';
const run = (id) => state.runs[String(id)];
const actionsComment = (id, body, appMode = 'canonical') => ({
  id,
  body,
  created_at: '2026-08-09T14:05:00.000Z',
  author_association: 'MEMBER',
  user: { login: state.publisher.bot.login, id: state.publisher.bot.id,
    node_id: state.publisher.bot.nodeId, type: state.publisher.bot.type },
  performed_via_github_app: appMode === 'null' ? null : {
    id: appMode === 'wrong' ? state.publisher.app.id + 1 : state.publisher.app.id,
    node_id: state.publisher.app.nodeId,
    slug: state.publisher.app.slug
  }
});
if (args[0] === 'api' && args[1] === 'graphql') {
  const idArgument = args.find((arg) => typeof arg === 'string' && arg.startsWith('id='));
  const nodeId = idArgument?.slice(3) || '';
  const principal = Object.entries(state.principals)
    .find(([, value]) => value.nodeId === nodeId);
  if (!principal) fail('unknown principal node: ' + nodeId);
  out({ data: { node: { id: nodeId, login: principal[0] } } });
}
if (args[0] === 'run' && args[1] === 'download') {
  const name = args[args.indexOf('--name') + 1];
  const directory = args[args.indexOf('--dir') + 1];
  const files = state.artifactFiles[name];
  if (!files) fail('artifact not found: ' + name);
  mkdirSync(directory, { recursive: true });
  for (const [fileName, source] of Object.entries(files)) {
    writeFileSync(path.join(directory, fileName), String(source), 'utf8');
  }
  out('');
}
if (args[0] === 'pr' && args[1] === 'view') {
  out({ number: 42, state: 'MERGED', isDraft: false, isCrossRepository: false,
    author: { id: 'AUTHOR' }, baseRefName: 'main', baseRefOid: state.baseSha,
    headRefName: state.branch, headRefOid: state.headSha,
    title: 'Legacy marker-bound closeout candidate', body: '',
    mergeCommit: { oid: state.mergeCommitSha } });
}
if (args[0] === 'pr' && args[1] === 'list') {
  out([{ number: 42, headRefName: state.branch, headRefOid: state.headSha,
    baseRefName: 'main', baseRefOid: state.baseSha, state: state.inventoryPrState,
    isDraft: false, isCrossRepository: false, url: 'https://github.example/pull/42' }]);
}
if (endpoint.includes('/contents/scripts/codex/branch-closeout-receipt.ts')) fail('HTTP 404 Not Found');
if (endpoint === '/repos/' + state.repository && args.includes('.delete_branch_on_merge')) out('true');
if (endpoint === '/repos/' + state.repository) {
  out({ id: Number(state.repositoryId), full_name: state.repository,
    default_branch: 'main', delete_branch_on_merge: true });
}
if (endpoint.startsWith('/repos/' + state.repository + '/collaborators/')) {
  const login = endpoint.split('/').at(-2);
  const principal = state.principals[login];
  if (!principal) fail('unknown collaborator: ' + login);
  state.principalPermissionLookups.push(login);
  save(state);
  out(principal.permission);
}
if (endpoint.startsWith('/users/')) {
  const login = endpoint.split('/').at(-1);
  const principal = state.principals[login];
  if (!principal) fail('unknown user: ' + login);
  state.principalUserLookups.push(login);
  save(state);
  out({ login, node_id: principal.nodeId });
}
if (endpoint === '/repos/' + state.repository + '/git/commits/' + state.baseSha) out(state.baseTreeSha);
if (endpoint === '/repos/' + state.repository + '/git/commits/' + state.headSha) out(state.headTreeSha);
if (endpoint === '/repos/' + state.repository + '/git/commits/' + state.mergeCommitSha) {
  out({ tree: { sha: state.headTreeSha }, message: state.mergeMessage });
}
if (endpoint.startsWith('/repos/' + state.repository + '/compare/')) out({
  status: state.liveDefaultSha === state.mergeCommitSha ? 'identical' : 'ahead',
  ahead_by: state.liveDefaultSha === state.mergeCommitSha ? 0 : 1,
  behind_by: 0,
  base_commit: { sha: state.mergeCommitSha },
  merge_base_commit: { sha: state.mergeCommitSha }
});
if (endpoint.includes('/actions/runs?head_sha=')) {
  const currentRun = run(200);
  out([{ workflow_runs: [{ id: 200, name: 'sec-merge-gate',
    display_title: 'integrate compiler session run 100 attempt 1',
    path: '.github/workflows/sec-merge-gate.yml', event: 'workflow_run',
    status: 'in_progress', conclusion: null, head_sha: state.baseSha,
    run_attempt: currentRun.run_attempt, updated_at: '2026-08-09T14:05:00.000Z' }] }]);
}
const endpointParts = endpoint.split('/');
const jobInventoryPrefix = '/repos/' + state.repository + '/actions/runs/';
const jobInventorySuffix = '/jobs?per_page=100';
const jobInventoryIdentity = endpoint.startsWith(jobInventoryPrefix)
  && endpoint.endsWith(jobInventorySuffix)
  ? endpoint.slice(jobInventoryPrefix.length, -jobInventorySuffix.length).split('/attempts/')
  : [];
if (args[0] === 'api' && args.length === 4 && args[2] === '--paginate'
  && args[3] === '--slurp' && jobInventoryIdentity.length === 2
  && /^[1-9][0-9]*$/.test(jobInventoryIdentity[0])
  && /^[1-9][0-9]*$/.test(jobInventoryIdentity[1])) {
  const [jobRunId, jobRunAttempt] = jobInventoryIdentity;
  const phaseNames = state.phaseStepNames;
  const current = state.currentPhase;
  const currentRunAttempt = Number(run(jobRunId).run_attempt);
  const isCurrentAttempt = Number(jobRunAttempt) === currentRunAttempt;
  const order = ['recoveryPreparation', 'integration', 'closeoutMutation', 'closeoutPublication'];
  const currentIndex = order.indexOf(current);
  const steps = order.map((phase, index) => !isCurrentAttempt
    ? index < currentIndex
      ? { name: phaseNames[phase], number: index + 1, status: 'completed', conclusion: 'success',
          started_at: '2026-08-09T14:00:00.000Z', completed_at: '2026-08-09T14:04:00.000Z' }
      : { name: phaseNames[phase], number: index + 1, status: 'completed', conclusion: 'skipped',
          started_at: null, completed_at: '2026-08-09T14:04:00.000Z' }
    : index < currentIndex
    ? { name: phaseNames[phase], number: index + 1, status: 'completed', conclusion: 'success',
        started_at: '2026-08-09T14:00:00.000Z', completed_at: '2026-08-09T14:04:00.000Z' }
    : index === currentIndex
      ? { name: phaseNames[phase], number: index + 1, status: 'in_progress', conclusion: null,
          started_at: '2026-08-09T14:05:00.000Z', completed_at: null }
      : { name: phaseNames[phase], number: index + 1, status: 'queued', conclusion: null,
          started_at: null, completed_at: null });
  out([{ jobs: [{ id: 300 + Number(jobRunAttempt), run_id: Number(jobRunId), run_attempt: Number(jobRunAttempt),
    name: 'integrate', status: isCurrentAttempt ? 'in_progress' : 'completed',
    conclusion: isCurrentAttempt ? null : 'success', head_sha: state.baseSha,
    started_at: '2026-08-09T14:00:00.000Z', completed_at: null, steps }] }]);
}
const runArtifactInventoryPrefix = '/repos/' + state.repository + '/actions/runs/';
const runArtifactInventorySuffix = '/artifacts?per_page=100';
const runArtifactInventoryId = endpoint.startsWith(runArtifactInventoryPrefix)
  && endpoint.endsWith(runArtifactInventorySuffix)
  ? endpoint.slice(runArtifactInventoryPrefix.length, -runArtifactInventorySuffix.length)
  : '';
if (args[0] === 'api' && args.length === 4 && args[2] === '--paginate'
  && args[3] === '--slurp' && /^[1-9][0-9]*$/.test(runArtifactInventoryId)) {
  const artifacts = state.artifactsByRun[runArtifactInventoryId] || [];
  out([{ total_count: artifacts.length, artifacts }]);
}
const exactRunAttemptPattern = new RegExp('^/repos/' + state.repository.replace('/', '\\/')
  + '/actions/runs/([1-9][0-9]*)/attempts/([1-9][0-9]*)$');
const exactRunAttempt = exactRunAttemptPattern.exec(endpoint);
if (exactRunAttempt) {
  const historical = run(exactRunAttempt[1]);
  const requestedAttempt = Number(exactRunAttempt[2]);
  if (!historical || requestedAttempt > Number(historical.run_attempt)) {
    fail('historical workflow run attempt not found');
  }
  out({ ...historical, run_attempt: state.historicalAttemptMismatch === true
    && exactRunAttempt[1] === '200' ? requestedAttempt + 1 : requestedAttempt });
}
if (endpoint.includes('/actions/artifacts/')) out(state.artifactDetails[endpointParts.at(-1)]);
if (endpoint.includes('/actions/runs/') && !endpoint.includes('?')
  && !endpoint.includes('/attempts/') && !endpoint.endsWith('/artifacts')) {
  out(run(endpointParts.at(-1)));
}
const commentsEndpoint = '/repos/' + state.repository + '/issues/42/comments';
if (args.includes('-X') && args.includes('POST') && endpoint === commentsEndpoint) {
  const bodyArg = args.find((arg) => typeof arg === 'string' && arg.startsWith('body='));
  if (!bodyArg) fail('missing comment body');
  const created = actionsComment(state.nextCommentId++, bodyArg.slice(5), state.nextPostAppMode || 'canonical');
  state.commentPostCount = Number(state.commentPostCount || 0) + 1;
  state.comments.push(created);
  const lost = state.nextPostDisposition === 'lost';
  state.nextPostDisposition = 'success';
  state.nextPostAppMode = 'canonical';
  save(state);
  if (lost) fail('simulated lost POST response');
  out(created);
}
if (endpoint === commentsEndpoint + '?per_page=100') out([state.comments]);
if (endpoint.includes('/issues/comments/')) {
  const comment = state.comments.find((entry) => entry.id === Number(endpointParts.at(-1)));
  if (!comment) fail('HTTP 404 comment missing');
  out(comment);
}
fail('unsupported test gh command: ' + args.join(' '));
`, 'utf8');
  if (process.platform === 'win32') {
    for (const [source, output] of [[gitProgram, 'git.exe'], [ghProgram, 'gh.exe']] as const) {
      const compiled = spawnSync(process.execPath, ['build', '--compile', source,
        '--outfile', path.join(shimRoot, output)], { encoding: 'utf8', windowsHide: true });
      if (compiled.status !== 0) {
        throw new Error(`cannot compile ${output}: ${compiled.stderr || compiled.stdout}`);
      }
    }
  } else {
    for (const [name, source] of [['git', gitProgram], ['gh', ghProgram]] as const) {
      const executable = path.join(shimRoot, name);
      writeFileSync(executable,
        `#!/usr/bin/env sh\nexec "${process.execPath}" "${source}" "$@"\n`, 'utf8');
      chmodSync(executable, 0o755);
    }
  }
  return shimRoot;
}

function closeoutHarnessActionsComment(
  id: number,
  body: string,
  appMode: 'canonical' | 'null' | 'wrong' = 'canonical'
): Record<string, unknown> {
  const policy = CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1;
  return {
    id,
    body,
    created_at: '2026-08-09T14:05:00.000Z',
    author_association: 'MEMBER',
    user: { login: policy.bot.login, id: policy.bot.id,
      node_id: policy.bot.nodeId, type: policy.bot.type },
    performed_via_github_app: appMode === 'null' ? null : {
      id: appMode === 'wrong' ? policy.app.id + 1 : policy.app.id,
      node_id: policy.app.nodeId,
      slug: policy.app.slug
    }
  };
}

function withCloseoutHarnessCommands<T>(
  shimRoot: string,
  statePath: string,
  recoveryRoot: string,
  run: () => T
): T {
  const previous = {
    path: process.env.PATH,
    state: process.env.SEC_CLOSEOUT_TEST_STATE,
    recovery: process.env.SEC_BRANCH_RECOVERY_ROOT
  };
  process.env.PATH = `${shimRoot}${path.delimiter}${previous.path ?? ''}`;
  process.env.SEC_CLOSEOUT_TEST_STATE = statePath;
  process.env.SEC_BRANCH_RECOVERY_ROOT = recoveryRoot;
  try {
    return run();
  } finally {
    if (previous.path === undefined) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.state === undefined) delete process.env.SEC_CLOSEOUT_TEST_STATE;
    else process.env.SEC_CLOSEOUT_TEST_STATE = previous.state;
    if (previous.recovery === undefined) delete process.env.SEC_BRANCH_RECOVERY_ROOT;
    else process.env.SEC_BRANCH_RECOVERY_ROOT = previous.recovery;
  }
}

function createCloseoutCliScenario(input: {
  harnessRoot: string;
  recoveryHarnessRoot: string;
  shimRoot: string;
  name: string;
  fixture: ReturnType<typeof reducerFixture>;
  seed?: 'none' | 'null-app' | 'wrong-app' | 'duplicate' | 'old';
  tamper?: 'original' | 'artifact' | 'stable-digest';
  postDisposition?: 'success' | 'lost';
  crashAfterDelete?: boolean;
  currentRunAttempt?: number;
  includeStableArtifact?: boolean;
  historicalAttemptMismatch?: boolean;
  triggeringPrincipal?: Readonly<{
    login: string;
    nodeId: string;
    permission: 'admin' | 'maintain' | 'write';
  }>;
}) {
  const root = path.join(input.harnessRoot, input.name);
  const commonDir = path.join(root, '.git');
  const providerRecoveryRoot = path.join(input.recoveryHarnessRoot, input.name, 'provider');
  const recoveryRoot = path.join(input.recoveryHarnessRoot, input.name, 'rehydrated');
  mkdirSync(path.join(root, 'scripts', 'codex'), { recursive: true });
  mkdirSync(path.join(root, 'docs', 'governance'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'governance', 'external-capability-ledger.yaml'),
    readFileSync(path.resolve(import.meta.dir,
      '../../docs/governance/external-capability-ledger.yaml')));
  mkdirSync(commonDir, { recursive: true });
  const statePath = path.join(root, 'provider-state.json');
  const tcbBlobs: Record<string, string> = { ...TCB_CLOSURE_LOCK.moduleBlobs };
  for (const edge of SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3.reviewedBoundaryEdges) {
    const target = edge.split(' -> ')[1];
    if (target !== undefined && tcbBlobs[target] === undefined) tcbBlobs[target] = 'd'.repeat(40);
  }
  const currentRunAttempt = input.currentRunAttempt ?? 1;
  const triggeringPrincipal = input.triggeringPrincipal ?? {
    login: 'integrator', nodeId: 'INTEGRATOR', permission: 'maintain' as const
  };
  const baseState: CloseoutCliHarnessState = {
    repositoryRoot: root,
    commonDir,
    recoveryRoot,
    repository: 'sec-platform/sec',
    repositoryId: '123',
    branch: 'feat/example',
    baseSha: BASE,
    baseTreeSha: BASE,
    headSha: HEAD,
    headTreeSha: HEAD,
    mergeCommitSha: '9'.repeat(40),
    liveDefaultSha: BASE,
    localDefaultSha: BASE,
    racedDefaultSha: '8'.repeat(40),
    liveDefaultReadCount: 0,
    refOnlyFetchCount: 0,
    credentialBoundBranchReadCount: 0,
    refOnlyFetchFailure: false,
    raceAfterRefOnlyFetch: false,
    headReadValues: [],
    mergeMessage: '',
    localPresent: true,
    remotePresent: true,
    activeWorkPackageSelected: true,
    inventoryPrState: 'OPEN',
    remoteDeleteCount: 0,
    mergeRequestCount: 0,
    commentPostCount: 0,
    localDeleteCount: 0,
    pruneCount: 0,
    crashAfterDelete: input.crashAfterDelete === true,
    crashInjected: false,
    crashReleasePath: path.join(root, 'crash-shim.release'),
    crashShimPid: null,
    tcbBlobs,
    runtimeBlob: tcbBlobs['scripts/codex/verification-session-runtime.ts'] ?? 'e'.repeat(40),
    publisher: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1,
    phaseStepNames: HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1,
    currentPhase: 'closeoutMutation',
    nextCommentId: 1000,
    nextPostDisposition: input.postDisposition ?? 'success',
    nextPostAppMode: 'canonical',
    historicalAttemptMismatch: input.historicalAttemptMismatch === true,
    principals: {
      integrator: { nodeId: 'INTEGRATOR', permission: 'maintain' },
      [triggeringPrincipal.login]: {
        nodeId: triggeringPrincipal.nodeId,
        permission: triggeringPrincipal.permission
      }
    },
    principalUserLookups: [],
    principalPermissionLookups: [],
    comments: [],
    artifactsByRun: {},
    artifactDetails: {},
    artifactFiles: {},
    runs: {
      100: { id: 100, run_attempt: 1, event: 'repository_dispatch',
        path: '.github/workflows/compiler-pr-validation.yml', head_sha: BASE,
        actor: { login: 'integrator', node_id: 'INTEGRATOR' }, repository: { id: 123 } },
      199: { id: 199, run_attempt: 1, event: 'workflow_run',
        path: '.github/workflows/sec-merge-gate.yml', head_sha: BASE,
        actor: { login: 'integrator', node_id: 'INTEGRATOR' },
        triggering_actor: { login: 'integrator', node_id: 'INTEGRATOR' }, repository: { id: 123 } },
      200: { id: 200, run_attempt: currentRunAttempt, event: 'workflow_run',
        path: '.github/workflows/sec-merge-gate.yml', head_sha: BASE,
        actor: { login: 'integrator', node_id: 'INTEGRATOR' }, triggering_actor: {
          login: triggeringPrincipal.login, node_id: triggeringPrincipal.nodeId
        }, repository: { id: 123 } }
    }
  };
  writeCloseoutCliHarnessState(statePath, baseState);
  writeFileSync(path.join(root, 'scripts', 'codex', 'document-control-plane.ts'), `
import { readFileSync } from 'node:fs';
const state = JSON.parse(readFileSync(process.env.SEC_CLOSEOUT_TEST_STATE, 'utf8'));
process.stdout.write(JSON.stringify(state.activeWorkPackageSelected
  ? { activeWorkPackage: { state: 'active', manifest: '${V6_MANIFEST_PATH}' },
      workspace: { branch: state.branch } }
  : { activeWorkPackage: { state: 'none', manifest: null }, workspace: { branch: null } }));
`, 'utf8');
  const prepared = withCloseoutHarnessCommands(input.shimRoot, statePath, providerRecoveryRoot, () => (
    prepareBranchCloseout({ repositoryRoot: root }, {
      branch: 'feat/example', expectedHeadSha: HEAD, pullRequestNumber: 42
    })
  ));
  const recoveryBundleBytes = readFileSync(prepared.preparation.recovery.path);
  const state = readCloseoutCliHarnessState(statePath);
  state.inventoryPrState = 'MERGED';
  state.activeWorkPackageSelected = false;
  state.liveDefaultSha = state.mergeCommitSha;
  state.localDefaultSha = state.mergeCommitSha;
  writeCloseoutCliHarnessState(statePath, state);
  const rehydratedPrepared = withCloseoutHarnessCommands(input.shimRoot, statePath, recoveryRoot,
    () => rehydratePreparedBranchCloseoutRecoveryArtifactV1({
      scope: { repositoryRoot: root },
      remote: prepared,
      recoveryBundleBytes
    }));
  const recoveryArtifact = createBranchCloseoutRecoveryArtifactV1({
    repository: 'sec-platform/sec',
    pullRequestNumber: 42,
    sessionRevision: input.fixture.artifact.session.sessionRevision,
    headSha: HEAD,
    headTreeSha: HEAD,
    preparedEnvelopeBytes: `${JSON.stringify(prepared, null, 2)}\n`,
    recoveryBundleBytes
  });
  const rehydratedRecoveryArtifact = createBranchCloseoutRecoveryArtifactV1({
    repository: 'sec-platform/sec',
    pullRequestNumber: 42,
    sessionRevision: input.fixture.artifact.session.sessionRevision,
    headSha: HEAD,
    headTreeSha: HEAD,
    preparedEnvelopeBytes: `${JSON.stringify(rehydratedPrepared, null, 2)}\n`,
    recoveryBundleBytes
  });
  const providerRecoveryArtifact = input.tamper === 'artifact'
    ? rehydratedRecoveryArtifact
    : recoveryArtifact;
  const recoveryName = `sec-branch-closeout-recovery-v1-pr-42-session-`
    + `${input.fixture.artifact.session.sessionRevision.slice(7)}-run-200-attempt-1`;
  const recoveryObservation = Object.freeze({
    artifactId: '3000',
    artifactName: recoveryName,
    artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME_V1,
    artifactDigest: recoveryArtifact.artifactDigest,
    runId: '200',
    runAttempt: 1
  });
  const canonicalCommentProvenance = (runId: string) => createHostedWorkflowCommentProvenanceV1({
    repositoryId: '123',
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    workflowRef: `.github/workflows/sec-merge-gate.yml@${BASE}`,
    workflowSha: BASE,
    runId,
    runAttempt: 1,
    eventName: 'workflow_run',
    sourceRunId: '100',
    sourceRunAttempt: 1,
    actorLogin: 'integrator',
    actorNodeId: 'INTEGRATOR',
    actorPermission: 'maintain',
    app: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app
  });
  const provenance = canonicalCommentProvenance('200');
  const authorizationPublication = createIntegrationAuthorizationOperationPublicationV1({
    result: input.fixture.result,
    closeoutPreparation: prepared,
    recoveryArtifact: recoveryObservation,
    provenance
  });
  const authorizationCommentId = 90;
  const binding = createBranchCloseoutOperationBindingV1({
    integrationAuthorization: input.fixture.result.authorization,
    preparation: prepared.preparation,
    newMainSha: '9'.repeat(40),
    newMainTreeSha: HEAD,
    candidateTreeSha: HEAD
  });
  const effectStartInput = {
    binding,
    authorizationPublication: {
      authorizationPublicationId: authorizationPublication.authorizationPublicationId,
      publicationDigest: authorizationPublication.publicationDigest,
      commentId: authorizationCommentId
    },
    recoveryArtifact: {
      artifactId: recoveryObservation.artifactId,
      artifactName: recoveryObservation.artifactName,
      artifactDigest: recoveryObservation.artifactDigest,
      runId: recoveryObservation.runId,
      runAttempt: recoveryObservation.runAttempt
    }
  } as const;
  const effectStart = createBranchCloseoutEffectStartPublicationV1({
    ...effectStartInput,
    phase: { runId: '200', runAttempt: 1, jobId: '300', jobName: 'integrate',
      phase: 'closeoutMutation', stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME_V1,
      stepNumber: 3, workflowSha: BASE },
    provenance
  });
  const oldProvenance = canonicalCommentProvenance('199');
  const oldEffectStart = createBranchCloseoutEffectStartPublicationV1({
    ...effectStartInput,
    phase: { runId: '199', runAttempt: 1, jobId: '299', jobName: 'integrate',
      phase: 'closeoutMutation', stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME_V1,
      stepNumber: 3, workflowSha: BASE },
    provenance: oldProvenance
  });
  let authorizationBody = renderIntegrationAuthorizationOperationPublicationComment(
    authorizationPublication);
  if (input.tamper === 'original') {
    authorizationBody = authorizationBody.replace(prepared.envelopeDigest,
      rehydratedPrepared.envelopeDigest);
  } else if (input.tamper === 'stable-digest') {
    authorizationBody = authorizationBody.replace(prepared.preparation.preparationDigest,
      `sha256:${'f'.repeat(64)}`);
  }
  state.comments = [closeoutHarnessActionsComment(authorizationCommentId, authorizationBody)];
  const seed = input.seed ?? 'none';
  if (seed !== 'none') {
    const publication = seed === 'old' ? oldEffectStart : effectStart;
    const body = renderBranchCloseoutEffectStartPublicationComment(publication);
    const appMode = seed === 'null-app' ? 'null' : seed === 'wrong-app' ? 'wrong' : 'canonical';
    state.comments.push(closeoutHarnessActionsComment(91, body, appMode));
    if (seed === 'duplicate') state.comments.push(closeoutHarnessActionsComment(92, body));
  }
  const markers = integrationAuthorizationMergeMarkersV1({
    sessionRevision: input.fixture.artifact.session.sessionRevision,
    authorizationId: authorizationPublication.authorizationId,
    authorizationReceiptDigest: authorizationPublication.authorizationReceiptDigest,
    consumptionOperationId: authorizationPublication.consumptionOperationId,
    authorizationPublicationId: authorizationPublication.authorizationPublicationId,
    authorizationPublicationDigest: authorizationPublication.publicationDigest,
    commentId: authorizationCommentId
  });
  state.mergeMessage = `Verified integration ${input.fixture.artifact.session.sessionRevision.slice(7, 19)}`
    + `\n\n${markers.join('\n')}\n${renderIndependentReviewTrailerV1(input.fixture.result.reviewReceipt)}`;
  const sessionArtifactName = `sec-verification-session-v2-pr-42-session-`
    + `${input.fixture.artifact.session.sessionRevision.slice(7)}-run-100-attempt-1`;
  const sessionArtifactRecord = { id: 1000, name: sessionArtifactName, expired: false,
    digest: PAGE, workflow_run: { id: 100 } };
  const recoveryArtifactRecord = { id: 3000, name: recoveryName, expired: false,
    digest: PAGE, workflow_run: { id: 200 } };
  const stableArtifactName = `sec-verification-action-start-v2-${'c'.repeat(64)}`;
  const stableArtifactRecord = { id: 3001, name: stableArtifactName, expired: false,
    digest: PAGE, workflow_run: { id: 200 } };
  const recoveryRunArtifacts = input.includeStableArtifact === true
    ? [stableArtifactRecord, recoveryArtifactRecord]
    : [recoveryArtifactRecord];
  state.artifactsByRun = { 100: [sessionArtifactRecord], 200: recoveryRunArtifacts };
  state.artifactDetails = { 1000: sessionArtifactRecord, 3000: recoveryArtifactRecord,
    ...(input.includeStableArtifact === true ? { 3001: stableArtifactRecord } : {}) };
  state.artifactFiles = {
    [sessionArtifactName]: {
      'verification-session-artifact.json': `${encodeVerificationActionDataV2(input.fixture.artifact)}\n`
    },
    [recoveryName]: {
      [BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME_V1]:
        `${encodeVerificationActionDataV2(providerRecoveryArtifact)}\n`
    }
  };
  writeCloseoutCliHarnessState(statePath, state);
  const eventPath = path.join(root, 'event.json');
  writeFileSync(eventPath, `${JSON.stringify({ action: 'completed', repository: {
    id: 123, full_name: 'sec-platform/sec' }, workflow_run: {
    id: 100, run_attempt: 1, status: 'completed', conclusion: 'success',
    event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
    head_sha: BASE } }, null, 2)}\n`, 'utf8');
  return { root, statePath, recoveryRoot, eventPath, binding, effectStart,
    crashReleasePath: baseState.crashReleasePath as string,
    providerPrepared: prepared, rehydratedPrepared };
}

function runCloseoutCliProcess(
  shimRoot: string,
  scenario: ReturnType<typeof createCloseoutCliScenario>,
  command: 'integrate-hosted' | 'closeout-mutate-hosted' | 'closeout-publish-hosted'
) {
  const state = readCloseoutCliHarnessState(scenario.statePath);
  state.invocationCount = Number(state.invocationCount ?? 0) + 1;
  writeCloseoutCliHarnessState(scenario.statePath, state);
  const output = path.join(scenario.root, `${command}-${state.invocationCount}.json`);
  const environment = closeoutCliProcessEnvironment(shimRoot, scenario);
  const ghResolution = resolveCloseoutCliGh(environment);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    path.resolve(import.meta.dir, '../../scripts/codex/verification-session.ts'),
    command,
    '--repository', 'sec-platform/sec',
    '--output', output,
    '--json'
  ], {
    cwd: scenario.root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
    env: environment
  });
  return { result, output, ghResolution, elapsedMs: Date.now() - startedAt };
}

function startCloseoutCliProcess(
  shimRoot: string,
  scenario: ReturnType<typeof createCloseoutCliScenario>,
  command: 'closeout-mutate-hosted' | 'closeout-publish-hosted'
) {
  const state = readCloseoutCliHarnessState(scenario.statePath);
  state.invocationCount = Number(state.invocationCount ?? 0) + 1;
  writeCloseoutCliHarnessState(scenario.statePath, state);
  const output = path.join(scenario.root, `${command}-${state.invocationCount}.json`);
  const environment = closeoutCliProcessEnvironment(shimRoot, scenario);
  const ghResolution = resolveCloseoutCliGh(environment);
  const child = spawn(process.execPath, [
    path.resolve(import.meta.dir, '../../scripts/codex/verification-session.ts'),
    command,
    '--repository', 'sec-platform/sec',
    '--output', output,
    '--json'
  ], {
    cwd: scenario.root,
    windowsHide: true,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const lifecycle = {
    exit: false,
    close: false,
    stdoutEof: false,
    stderrEof: false,
    stdout: '',
    stderr: ''
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { lifecycle.stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { lifecycle.stderr += chunk; });
  const stdoutEof = new Promise<void>((resolve, reject) => {
    child.stdout.once('end', () => { lifecycle.stdoutEof = true; resolve(); });
    child.stdout.once('error', reject);
  });
  const stderrEof = new Promise<void>((resolve, reject) => {
    child.stderr.once('end', () => { lifecycle.stderrEof = true; resolve(); });
    child.stderr.once('error', reject);
  });
  const exit = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        lifecycle.exit = true;
        resolve(Object.freeze({ code, signal }));
      });
    });
  const close = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
    (resolve) => {
      child.once('close', (code, signal) => {
        lifecycle.close = true;
        resolve(Object.freeze({ code, signal }));
      });
    });
  return { child, output, ghResolution, lifecycle, exit, close, stdoutEof, stderrEof };
}

async function boundedCloseoutWait<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 30_000
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(
          `Timed out after ${timeoutMs}ms while waiting for ${label}`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function waitForCloseoutCliState(
  statePath: string,
  predicate: (state: CloseoutCliHarnessState) => boolean,
  label: string,
  timeoutMs = 30_000
): Promise<CloseoutCliHarnessState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: CloseoutCliHarnessState | null = null;
  let lastReadError: unknown = null;
  while (Date.now() < deadline) {
    try {
      lastState = readCloseoutCliHarnessState(statePath);
      lastReadError = null;
      if (predicate(lastState)) return lastState;
    } catch (error) {
      lastReadError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out while waiting for ${label}: ${JSON.stringify({
    lastState,
    lastReadError: lastReadError instanceof Error ? lastReadError.message : lastReadError
  })}`);
}

async function waitForCloseoutCliBarrier(
  statePath: string,
  crashed: ReturnType<typeof startCloseoutCliProcess>,
  timeoutMs = 90_000
): Promise<CloseoutCliHarnessState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: CloseoutCliHarnessState | null = null;
  let lastReadError: unknown = null;
  const throwEarlyExit = async (): Promise<never> => {
    const exit = await crashed.exit;
    await boundedCloseoutWait(Promise.all([
      crashed.close,
      crashed.stdoutEof,
      crashed.stderrEof
    ]), 'early closeout CLI close and stdio EOF');
    throw new Error(`Closeout CLI exited before the durable delete barrier: ${JSON.stringify({
      code: exit.code,
      signal: exit.signal,
      stdout: crashed.lifecycle.stdout,
      stderr: crashed.lifecycle.stderr,
      ghResolution: crashed.ghResolution
    })}`);
  };
  while (Date.now() < deadline) {
    try {
      lastState = readCloseoutCliHarnessState(statePath);
      lastReadError = null;
      if (lastState.remoteDeleteCount === 1
        && Number.isInteger(lastState.crashShimPid)
        && lastState.crashShimPid > 0) {
        return lastState;
      }
    } catch (error) {
      lastReadError = error;
    }
    if (crashed.lifecycle.exit) return throwEarlyExit();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (crashed.lifecycle.exit) return throwEarlyExit();
  throw new Error(`Timed out while the closeout CLI remained live before the durable delete barrier: ${JSON.stringify({
    pid: crashed.child.pid ?? null,
    lifecycle: crashed.lifecycle,
    lastState,
    lastReadError: lastReadError instanceof Error ? lastReadError.message : lastReadError
  })}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

function closeoutCliProcessEnvironment(
  shimRoot: string,
  scenario: ReturnType<typeof createCloseoutCliScenario>
): NodeJS.ProcessEnv {
  const state = readCloseoutCliHarnessState(scenario.statePath);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SEC_CLOSEOUT_TEST_STATE: scenario.statePath,
    SEC_BRANCH_RECOVERY_ROOT: scenario.recoveryRoot,
    GITHUB_EVENT_PATH: scenario.eventPath,
    GITHUB_REPOSITORY: 'sec-platform/sec',
    GITHUB_REPOSITORY_ID: '123',
    GITHUB_SHA: BASE,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF:
      'sec-platform/sec/.github/workflows/sec-merge-gate.yml@refs/heads/main',
    GITHUB_WORKFLOW_SHA: BASE,
    GITHUB_RUN_ID: '200',
    GITHUB_RUN_ATTEMPT: String(state.runs['200'].run_attempt),
    GITHUB_ACTOR: String(state.runs['200'].actor.login),
    GITHUB_TRIGGERING_ACTOR: String(state.runs['200'].triggering_actor.login),
    GITHUB_JOB: 'integrate',
    PRE_MERGE_MAIN_SHA: BASE,
    PLANNED_CURRENT_MAIN_SHA: String(state.liveDefaultSha)
  };
  const inheritedPath = Object.entries(process.env)
    .find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'path') delete environment[key];
  }
  environment[process.platform === 'win32' ? 'Path' : 'PATH'] =
    `${shimRoot}${path.delimiter}${inheritedPath}`;
  return environment;
}

function resolveCloseoutCliGh(environment: NodeJS.ProcessEnv) {
  const pathValue = Object.entries(environment)
    .find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const extensions = process.platform === 'win32'
    ? (Object.entries(environment).find(([key]) => key.toLowerCase() === 'pathext')?.[1]
        ?? '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(Boolean)
    : [''];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const unquoted = directory.startsWith('"') && directory.endsWith('"')
      ? directory.slice(1, -1)
      : directory;
    for (const extension of extensions) {
      const candidate = path.resolve(unquoted, `gh${extension.toLowerCase()}`);
      if (existsSync(candidate)) {
        return Object.freeze({ status: 0, signal: null, error: null,
          stdout: `${candidate}\n`, stderr: '' });
      }
    }
  }
  return Object.freeze({ status: 1, signal: null, error: 'gh was not found on PATH',
    stdout: '', stderr: '' });
}

function assertCloseoutCliProviderShim(
  shimRoot: string,
  scenario: ReturnType<typeof createCloseoutCliScenario>
): void {
  const executable = path.join(shimRoot, process.platform === 'win32' ? 'gh.exe' : 'gh');
  if (!existsSync(executable)) throw new Error(`Closeout CLI gh shim is absent: ${executable}`);
  const environment = closeoutCliProcessEnvironment(shimRoot, scenario);
  const resolution = resolveCloseoutCliGh(environment);
  const firstResolved = resolution.stdout.split(/\r?\n/u).find(Boolean) ?? '';
  const normalize = (value: string) => path.resolve(value).replaceAll('\\', '/').toLowerCase();
  if (resolution.status !== 0 || normalize(firstResolved) !== normalize(executable)) {
    throw new Error(`Closeout CLI gh resolution did not select the shim first:\n${JSON.stringify({
      executable, resolution
    }, null, 2)}`);
  }
  const direct = spawnSync(executable, [
    'api', '/repos/sec-platform/sec/actions/runs/100/artifacts?per_page=100',
    '--paginate', '--slurp'
  ], { encoding: 'utf8', windowsHide: true, env: environment });
  let pages: unknown = null;
  try {
    pages = JSON.parse(direct.stdout);
  } catch {
    // The diagnostic below retains the exact non-JSON output.
  }
  if (direct.status !== 0 || !Array.isArray(pages)
    || !Array.isArray((pages[0] as { artifacts?: unknown } | undefined)?.artifacts)
    || (pages[0] as { artifacts: Array<{ id?: unknown }> }).artifacts[0]?.id !== 1000) {
    throw new Error(`Closeout CLI gh shim artifact preflight failed:\n${JSON.stringify({
      executable, status: direct.status, signal: direct.signal,
      error: direct.error?.message ?? null, stdout: direct.stdout, stderr: direct.stderr,
      resolution
    }, null, 2)}`);
  }
}

function assertCloseoutCliProcessSucceeded(
  label: string,
  execution: ReturnType<typeof runCloseoutCliProcess>
): void {
  if (execution.result.status === 0) return;
  throw new Error(`Closeout CLI subprocess failed:\n${JSON.stringify({
    label,
    status: execution.result.status,
    signal: execution.result.signal,
    error: execution.result.error instanceof Error
      ? execution.result.error.message
      : execution.result.error ?? null,
    stdout: execution.result.stdout,
    stderr: execution.result.stderr,
    ghResolution: execution.ghResolution,
    elapsedMs: execution.elapsedMs
  }, null, 2)}`);
}

let sharedCloseoutCliShimSuiteRoot = '';
let sharedCloseoutCliShimRoot = '';

beforeAll(() => {
  if (!CLOSEOUT_CLI_E2E_ENABLED) return;
  sharedCloseoutCliShimSuiteRoot = mkdtempSync(
    path.join(tmpdir(), 'sec-verification-session-v6-shims-')
  );
  sharedCloseoutCliShimRoot = compileCloseoutCliProviderShims(sharedCloseoutCliShimSuiteRoot);
});

afterAll(() => {
  if (sharedCloseoutCliShimSuiteRoot !== '') {
    rmSync(sharedCloseoutCliShimSuiteRoot, { recursive: true, force: true });
  }
  if (privateGhProxySuiteRoot !== '') {
    rmSync(privateGhProxySuiteRoot, { recursive: true, force: true });
  }
});

function withCloseoutCliPartition<T>(run: (input: Readonly<{
  harnessRoot: string;
  recoveryHarnessRoot: string;
  shimRoot: string;
  fixture: ReturnType<typeof reducerFixture>;
}>) => T): T {
  const harnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-cli-'));
  const recoveryHarnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-recovery-'));
  const fixture = reducerFixture();
  try {
    return run({ harnessRoot, recoveryHarnessRoot, shimRoot: sharedCloseoutCliShimRoot, fixture });
  } finally {
    fixture.dispose();
    rmSync(harnessRoot, { recursive: true, force: true });
    rmSync(recoveryHarnessRoot, { recursive: true, force: true });
  }
}

async function withCloseoutCliPartitionSettled<T>(run: (input: Readonly<{
  harnessRoot: string;
  recoveryHarnessRoot: string;
  shimRoot: string;
  fixture: ReturnType<typeof reducerFixture>;
}>) => Promise<T>): Promise<T> {
  const harnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-cli-'));
  const recoveryHarnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-recovery-'));
  const fixture = reducerFixture();
  try {
    return await run({ harnessRoot, recoveryHarnessRoot, shimRoot: sharedCloseoutCliShimRoot,
      fixture });
  } finally {
    fixture.dispose();
    rmSync(harnessRoot, { recursive: true, force: true });
    rmSync(recoveryHarnessRoot, { recursive: true, force: true });
  }
}

test('prepared cleanup route never calls a local consumer for foreign observations', async () => {
  const calls: string[] = [];
  const foreign = await routePreparedWorktreeCleanupAttemptV1({
    foreignWorktreeObservationDigests: [PAGE],
    targetCount: 1,
    consumeLocalPreparedTargets: async () => {
      calls.push('physical');
      return ['unreachable'];
    }
  });
  expect(foreign).toEqual([]);
  expect(calls).toEqual([]);

  const noTarget = await routePreparedWorktreeCleanupAttemptV1({
    foreignWorktreeObservationDigests: [],
    targetCount: 0,
    consumeLocalPreparedTargets: async () => {
      calls.push('empty-target');
      return ['unreachable'];
    }
  });
  expect(noTarget).toEqual([]);
  expect(calls).toEqual([]);
});

test('prepared cleanup route invokes the local sequence once for the exact target count', async () => {
  const calls: string[] = [];
  const tokens = await routePreparedWorktreeCleanupAttemptV1({
    foreignWorktreeObservationDigests: [],
    targetCount: 2,
    consumeLocalPreparedTargets: async () => {
      calls.push('prepare', 'execute', 'assert');
      return ['opaque-one', 'opaque-two'];
    }
  });
  expect(calls).toEqual(['prepare', 'execute', 'assert']);
  expect(tokens).toEqual(['opaque-one', 'opaque-two']);
  await expect(routePreparedWorktreeCleanupAttemptV1({
    foreignWorktreeObservationDigests: [],
    targetCount: 2,
    consumeLocalPreparedTargets: async () => ['one']
  })).rejects.toThrow('same-host-worktree-closeout-required');
});

test('trusted remote default reader uses one explicit credential-bound single-ref command', () => {
  const source = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const helperStart = source.indexOf('function synchronizeTrustedRemoteDefaultRefV1(');
  const helperEnd = source.indexOf('\nconst WORK_PACKAGE_DIRECTORY', helperStart);
  const helper = source.slice(helperStart, helperEnd);
  const observerStart = source.indexOf('function observeTrustedRemoteExactRefV1(');
  const readerStart = source.indexOf('function readTrustedRemoteDefaultRefV1(');
  const readerEnd = source.indexOf('/** Live production proof.', readerStart);
  const reader = source.slice(observerStart, readerEnd);
  const inspector = source.slice(source.indexOf('function inspectTrustedRuntimeV1('), helperStart);
  expect(helperStart).toBeGreaterThan(0);
  expect(observerStart).toBeGreaterThan(0);
  expect(readerStart).toBeGreaterThan(0);
  expect(source.match(/function observeTrustedRemoteExactRefV1\(/gu)).toHaveLength(1);
  expect(source.match(/function readTrustedRemoteDefaultRefV1\(/gu)).toHaveLength(1);
  expect(reader).not.toContain('export function');
  expect(reader).toContain('...createBranchLifecycleGitHubCredentialArgsV1()');
  expect(reader).toContain("assertGitBranchName(input.remoteRef.slice(headPrefix.length)");
  expect(reader).toContain("assertGitBranchName(observedRef.slice(headPrefix.length)");
  expect(reader).not.toContain('[A-Za-z0-9._\\/-]');
  expect(reader).toContain("'ls-remote', '--exit-code', input.remote, input.remoteRef");
  expect(inspector).toContain('readTrustedRemoteDefaultRefV1({');
  expect(inspector).not.toContain("['ls-remote'");
  expect(helper).toContain('readTrustedRemoteDefaultRefV1({ ctx: input.ctx, identity, label })');
  expect(source.match(/'ls-remote', '--exit-code'/gu)).toHaveLength(1);
  const closeout = source.slice(source.indexOf('function observeExactRemoteCloseoutBranch('),
    source.indexOf('/**\n * The post-merge MainHealth dispatch/join', source.indexOf('function observeExactRemoteCloseoutBranch(')));
  expect(closeout).toContain('observeTrustedRemoteExactRefV1({');
  expect(closeout).not.toContain("['ls-remote'");
});

closeoutCliE2eTest('trusted remote default ref synchronization closes ordinary merge and merged recovery safely', () => {
  const source = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const helperStart = source.indexOf('function synchronizeTrustedRemoteDefaultRefV1(');
  const helperEnd = source.indexOf('\nconst WORK_PACKAGE_DIRECTORY', helperStart);
  const helper = source.slice(helperStart, helperEnd);
  const observerStart = source.indexOf('function observeTrustedRemoteExactRefV1(');
  const readerStart = source.indexOf('function readTrustedRemoteDefaultRefV1(');
  const readerEnd = source.indexOf('/** Live production proof.', readerStart);
  const reader = source.slice(observerStart, readerEnd);
  const inspector = source.slice(source.indexOf('function inspectTrustedRuntimeV1('), helperStart);
  expect(helperStart).toBeGreaterThan(0);
  expect(observerStart).toBeGreaterThan(0);
  expect(readerStart).toBeGreaterThan(0);
  expect(source.match(/function synchronizeTrustedRemoteDefaultRefV1\(/gu)).toHaveLength(1);
  expect(source.match(/function observeTrustedRemoteExactRefV1\(/gu)).toHaveLength(1);
  expect(source.match(/function readTrustedRemoteDefaultRefV1\(/gu)).toHaveLength(1);
  expect(helper).not.toContain('export function');
  expect(reader).not.toContain('export function');
  expect(reader).toContain('...createBranchLifecycleGitHubCredentialArgsV1()');
  expect(reader).toContain("assertGitBranchName(input.remoteRef.slice(headPrefix.length)");
  expect(reader).toContain("assertGitBranchName(observedRef.slice(headPrefix.length)");
  expect(reader).not.toContain('[A-Za-z0-9._\\/-]');
  expect(reader).toContain("'ls-remote', '--exit-code', input.remote, input.remoteRef");
  expect(inspector).toContain("readTrustedRemoteDefaultRefV1({");
  expect(inspector).not.toContain("['ls-remote'");
  expect(helper).toContain("readTrustedRemoteDefaultRefV1({ ctx: input.ctx, identity, label })");
  expect(helper).toContain("'fetch', '--no-tags', '--no-recurse-submodules', identity.remote");
  expect(helper).toContain('`+${identity.remoteRef}:${identity.localRef}`');
  expect(helper).toContain('liveBefore !== liveAfter || localAfter !== liveAfter');
  expect(helper).toContain('headAfter !== headBefore');
  expect(helper).not.toContain("'checkout'");
  expect(helper).not.toContain("'pull'");

  const integration = source.slice(source.indexOf("if (command === 'integrate-hosted')"),
    source.indexOf("if (command === 'closeout-mutate-hosted')"));
  const recoverySync = integration.indexOf("if (candidate.state === 'MERGED')");
  const firstReducer = integration.indexOf('let result = reduce(');
  const physicalMerge = integration.indexOf('executeHostedSquashMerge({');
  const mergeReadback = integration.indexOf('assertHostedSquashMergeCompletionV1({', physicalMerge);
  const ordinarySync = integration.indexOf('synchronizeTrustedRemoteDefaultRefV1({ ctx });',
    mergeReadback);
  const postMergeReducer = integration.indexOf('result = reduce();', mergeReadback);
  expect(recoverySync).toBeGreaterThan(0);
  expect(recoverySync).toBeLessThan(firstReducer);
  expect(ordinarySync).toBeGreaterThan(mergeReadback);
  expect(ordinarySync).toBeLessThan(postMergeReducer);
  expect((integration.match(/synchronizeTrustedRemoteDefaultRefV1\(\{ ctx \}\);/gu) ?? []))
    .toHaveLength(2);

  withCloseoutCliPartition(({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const runRecovery = (name: string, configure?: (state: CloseoutCliHarnessState) => void) => {
      const scenario = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
        name, fixture });
      const state = readCloseoutCliHarnessState(scenario.statePath);
      state.currentPhase = 'closeoutMutation';
      state.localDefaultSha = BASE;
      state.liveDefaultReadCount = 0;
      state.refOnlyFetchCount = 0;
      state.headReadValues = [];
      configure?.(state);
      writeCloseoutCliHarnessState(scenario.statePath, state);
      return { scenario, result: runCloseoutCliProcess(shimRoot, scenario, 'integrate-hosted') };
    };

    const exact = runRecovery('ref-sync-exact');
    assertCloseoutCliProcessSucceeded('integrate-hosted merged recovery ref synchronization',
      exact.result);
    expect(JSON.parse(readFileSync(exact.result.output, 'utf8'))).toMatchObject({
      lane: 'merged-recovery'
    });
    expect(readCloseoutCliHarnessState(exact.scenario.statePath)).toMatchObject({
      localDefaultSha: '9'.repeat(40),
      liveDefaultSha: '9'.repeat(40),
      refOnlyFetchCount: 1,
      mergeRequestCount: 0,
      commentPostCount: 0,
      remoteDeleteCount: 0
    });
    expect(new Set(readCloseoutCliHarnessState(exact.scenario.statePath).headReadValues))
      .toEqual(new Set([BASE]));

    const failed = runRecovery('ref-sync-fetch-failure', (state) => {
      state.refOnlyFetchFailure = true;
    });
    expect(failed.result.result.status).not.toBe(0);
    expect(readCloseoutCliHarnessState(failed.scenario.statePath)).toMatchObject({
      localDefaultSha: BASE,
      refOnlyFetchCount: 1,
      mergeRequestCount: 0,
      commentPostCount: 0,
      remoteDeleteCount: 0
    });

    const raced = runRecovery('ref-sync-race', (state) => {
      state.raceAfterRefOnlyFetch = true;
    });
    expect(raced.result.result.status).not.toBe(0);
    expect(raced.result.result.stderr).toMatch(/changed during synchronized ref-only fetch/i);
    expect(readCloseoutCliHarnessState(raced.scenario.statePath)).toMatchObject({
      localDefaultSha: '9'.repeat(40),
      liveDefaultSha: '8'.repeat(40),
      refOnlyFetchCount: 1,
      mergeRequestCount: 0,
      commentPostCount: 0,
      remoteDeleteCount: 0
    });
    expect(new Set(readCloseoutCliHarnessState(raced.scenario.statePath).headReadValues))
      .toEqual(new Set([BASE]));
  });
}, 180_000);

closeoutCliE2eTest('public Session closeout CLI partition A exact delete, publish, and reuse', () => {
  withCloseoutCliPartition(({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const exact = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
      name: 'exact', fixture });
    expect(encodeVerificationActionDataV2(exact.providerPrepared))
      .not.toBe(encodeVerificationActionDataV2(exact.rehydratedPrepared));
    expect(exact.providerPrepared.preparation.recovery.path)
      .not.toBe(exact.rehydratedPrepared.preparation.recovery.path);
    expect(exact.providerPrepared.preparation.preparationDigest)
      .toBe(exact.rehydratedPrepared.preparation.preparationDigest);
    expect(encodeVerificationActionDataV2(exact.providerPrepared.before))
      .toBe(encodeVerificationActionDataV2(exact.rehydratedPrepared.before));
    expect(exact.providerPrepared.before.pullRequests.find(({ number }) => number === 42))
      .toMatchObject({ state: 'open', headSha: HEAD });
    expect(exact.rehydratedPrepared.before.pullRequests.find(({ number }) => number === 42))
      .toMatchObject({ state: 'open', headSha: HEAD });
    expect(readCloseoutCliHarnessState(exact.statePath)).toMatchObject({
      inventoryPrState: 'MERGED', activeWorkPackageSelected: false
    });
    assertCloseoutCliProviderShim(shimRoot, exact);
    const first = runCloseoutCliProcess(shimRoot, exact, 'closeout-mutate-hosted');
    assertCloseoutCliProcessSucceeded('closeout-mutate-hosted', first);
    const firstMutationState = readCloseoutCliHarnessState(exact.statePath);
    expect(firstMutationState).toMatchObject({ remoteDeleteCount: 1, remotePresent: false });
    expect(firstMutationState.credentialBoundBranchReadCount).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(first.output, 'utf8'))).toMatchObject({
      disposition: 'executed', closeoutOperationId: exact.binding.closeoutOperationId
    });
    let exactState = readCloseoutCliHarnessState(exact.statePath);
    exactState.currentPhase = 'closeoutPublication';
    writeCloseoutCliHarnessState(exact.statePath, exactState);
    const published = runCloseoutCliProcess(shimRoot, exact, 'closeout-publish-hosted');
    assertCloseoutCliProcessSucceeded('closeout-publish-hosted', published);
    exactState = readCloseoutCliHarnessState(exact.statePath);
    expect(exactState.remoteDeleteCount).toBe(1);
    exactState.currentPhase = 'closeoutMutation';
    writeCloseoutCliHarnessState(exact.statePath, exactState);
    const reusedMutation = runCloseoutCliProcess(shimRoot, exact, 'closeout-mutate-hosted');
    assertCloseoutCliProcessSucceeded('closeout-mutate-hosted', reusedMutation);
    expect(JSON.parse(readFileSync(reusedMutation.output, 'utf8')))
      .toMatchObject({ disposition: 'reused-terminal' });
    exactState = readCloseoutCliHarnessState(exact.statePath);
    exactState.currentPhase = 'closeoutPublication';
    writeCloseoutCliHarnessState(exact.statePath, exactState);
    const reusedPublication = runCloseoutCliProcess(shimRoot, exact, 'closeout-publish-hosted');
    assertCloseoutCliProcessSucceeded('closeout-publish-hosted', reusedPublication);
    expect(JSON.parse(readFileSync(reusedPublication.output, 'utf8')))
      .toMatchObject({ disposition: 'reused' });
    expect(readCloseoutCliHarnessState(exact.statePath).remoteDeleteCount).toBe(1);
  });
}, 180_000);

closeoutCliE2eTest('public Session closeout CLI partition B crash recovery performs zero second delete', async () => {
  await withCloseoutCliPartitionSettled(async ({ harnessRoot, recoveryHarnessRoot, shimRoot,
    fixture }) => {
    const crash = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
      name: 'crash', fixture, crashAfterDelete: true });
    const crashed = startCloseoutCliProcess(shimRoot, crash, 'closeout-mutate-hosted');
    let killCount = 0;
    let released = false;
    try {
      const barrierState = await waitForCloseoutCliBarrier(crash.statePath, crashed);
      const crashShimPid = barrierState.crashShimPid as number;
      expect(barrierState).toMatchObject({ remoteDeleteCount: 1, remotePresent: false,
        crashInjected: true, crashShimPid });
      expect(barrierState.credentialBoundBranchReadCount).toBeGreaterThan(0);
      expect(Number.isInteger(crashed.child.pid) && (crashed.child.pid ?? 0) > 0).toBe(true);
      expect(isProcessAlive(crashShimPid)).toBe(true);

      killCount += 1;
      expect(crashed.child.kill('SIGKILL')).toBe(true);
      const exit = await boundedCloseoutWait(crashed.exit, 'owned closeout CLI exit');
      expect(exit.code).not.toBe(0);
      expect(crashed.lifecycle.exit).toBe(true);

      writeFileSync(crash.crashReleasePath, 'release\n', 'utf8');
      released = true;
      await boundedCloseoutWait(Promise.all([
        crashed.close,
        crashed.stdoutEof,
        crashed.stderrEof
      ]), 'owned closeout CLI close and stdio EOF');
      expect(killCount).toBe(1);
      expect(crashed.lifecycle).toMatchObject({
        exit: true,
        close: true,
        stdoutEof: true,
        stderrEof: true
      });
      await waitForCloseoutCliState(crash.statePath,
        () => !isProcessAlive(crashShimPid), 'crash shim termination');
      expect(isProcessAlive(crashShimPid)).toBe(false);

      let crashState = readCloseoutCliHarnessState(crash.statePath);
      crashState.crashAfterDelete = false;
      writeCloseoutCliHarnessState(crash.statePath, crashState);
      const recovered = runCloseoutCliProcess(shimRoot, crash, 'closeout-mutate-hosted');
      assertCloseoutCliProcessSucceeded('closeout-mutate-hosted', recovered);
      expect(JSON.parse(readFileSync(recovered.output, 'utf8')))
        .toMatchObject({ disposition: 'recovered-after-effect-start' });
      crashState = readCloseoutCliHarnessState(crash.statePath);
      expect(crashState.remoteDeleteCount).toBe(1);
      expect(crashState.credentialBoundBranchReadCount)
        .toBeGreaterThan(barrierState.credentialBoundBranchReadCount);
      expect(isProcessAlive(crashShimPid)).toBe(false);
      expect(killCount).toBe(1);
      expect(crashed.lifecycle).toMatchObject({
        exit: true,
        close: true,
        stdoutEof: true,
        stderrEof: true
      });
    } finally {
      if (!released) {
        writeFileSync(crash.crashReleasePath, 'release\n', 'utf8');
      }
      if (!crashed.lifecycle.exit && killCount === 0) {
        killCount += 1;
        crashed.child.kill('SIGKILL');
      }
      await Promise.allSettled([
        boundedCloseoutWait(crashed.exit, 'owned closeout CLI cleanup exit'),
        boundedCloseoutWait(crashed.close, 'owned closeout CLI cleanup close'),
        boundedCloseoutWait(crashed.stdoutEof, 'owned closeout CLI cleanup stdout EOF'),
        boundedCloseoutWait(crashed.stderrEof, 'owned closeout CLI cleanup stderr EOF')
      ]);
    }
  });
}, 120_000);

closeoutCliE2eTest('public Session closeout CLI partition C rejects invalid existing markers without delete', () => {
  withCloseoutCliPartition(({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    for (const seed of ['null-app', 'wrong-app', 'duplicate', 'old'] as const) {
      const blocked = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
        name: seed, fixture, seed });
      const result = runCloseoutCliProcess(shimRoot, blocked, 'closeout-mutate-hosted');
      expect(result.result.status).not.toBe(0);
      expect(readCloseoutCliHarnessState(blocked.statePath)).toMatchObject({
        remoteDeleteCount: 0, remotePresent: true
      });
    }
  });
}, 180_000);

closeoutCliE2eTest('public Session closeout CLI partition D rejects authority tamper without delete', () => {
  withCloseoutCliPartition(({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    for (const tamper of ['original', 'artifact', 'stable-digest'] as const) {
      const blocked = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
        name: `tampered-${tamper}`, fixture, tamper });
      const result = runCloseoutCliProcess(shimRoot, blocked, 'closeout-mutate-hosted');
      expect(result.result.status).not.toBe(0);
      expect(readCloseoutCliHarnessState(blocked.statePath)).toMatchObject({
        remoteDeleteCount: 0, remotePresent: true
      });
    }
  });
}, 180_000);

closeoutCliE2eTest('public Session closeout CLI partition E lost marker POST and replay perform zero delete', () => {
  withCloseoutCliPartition(({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const lost = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
      name: 'lost', fixture, postDisposition: 'lost' });
    const uncertain = runCloseoutCliProcess(shimRoot, lost, 'closeout-mutate-hosted');
    expect(uncertain.result.status).not.toBe(0);
    expect(readCloseoutCliHarnessState(lost.statePath)).toMatchObject({
      remoteDeleteCount: 0, remotePresent: true
    });
    const replay = runCloseoutCliProcess(shimRoot, lost, 'closeout-mutate-hosted');
    expect(replay.result.status).not.toBe(0);
    const lostState = readCloseoutCliHarnessState(lost.statePath);
    expect(lostState).toMatchObject({ remoteDeleteCount: 0, remotePresent: true });
    expect(lostState.comments).toHaveLength(2);
  });
}, 120_000);

closeoutCliE2eTest('V9 integration reruns retain producing attempts and authorize fresh integration after pre-gate expiry', () => {
  const sessionSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const identitySource = sessionSource.slice(
    sessionSource.indexOf('function assertHostedIntegrationIdentity('),
    sessionSource.indexOf('function assertAuthorizationPublicationMatchesSessionV2(')
  );
  expect(identitySource).toContain("environment.GITHUB_TRIGGERING_ACTOR ?? ''");
  expect(identitySource).toContain('currentRun.triggering_actor?.node_id');
  expect(identitySource.match(/github\.observePrincipal\(repository,/gu)).toHaveLength(2);
  expect(identitySource).toContain('actorLogin, actorNodeId, actorPermission: actor.permission');
  const freshIntegrationSource = sessionSource.slice(
    sessionSource.indexOf('function evaluateFreshHostedIntegration('),
    sessionSource.indexOf('type HostedIntegrationAuthorizationPublicationResultV1')
  );
  expect(freshIntegrationSource).toContain('artifactReuse.actionEvidenceCandidate');
  expect(freshIntegrationSource).toContain("artifact.evidence.status !== 'passed'");
  expect(freshIntegrationSource).not.toContain("status !== 'whole-artifact-current'");

  const stalePreGateAt = '2026-08-09T14:07:00.000Z';
  const stalePreGate = reducerFixture({ mergeAt: stalePreGateAt });
  try {
    expect(classifyVerificationSessionArtifactReuseV1(stalePreGate.artifact, stalePreGateAt))
      .toMatchObject({ status: 'fresh-authority-required', actionEvidenceCandidate: true });
    expect(stalePreGate.result.authorization).toMatchObject({
      sessionRevision: stalePreGate.artifact.session.sessionRevision,
      baseSha: BASE,
      headSha: HEAD,
      issuedAt: stalePreGateAt
    });
    expect(stalePreGate.result.authorization.reviewReceiptDigest)
      .not.toBe(stalePreGate.artifact.preGateReview.receiptDigest);
    expect(stalePreGate.result.authorization.mainHealthReceiptDigest)
      .not.toBe(stalePreGate.artifact.mainHealth.ledgerDigest);
  } finally {
    stalePreGate.dispose();
  }

  const receiptSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/branch-closeout-receipt.ts'), 'utf8');
  const provenanceLiveSource = receiptSource.slice(
    receiptSource.indexOf('export function assertHostedCommentProvenanceLive('),
    receiptSource.indexOf('function effectStartPublicationsInComments(')
  );
  expect(provenanceLiveSource).toContain(
    '/actions/runs/${provenance.runId}/attempts/${provenance.runAttempt}'
  );
  expect(provenanceLiveSource).toContain(
    '/actions/runs/${provenance.sourceRunId}/attempts/${provenance.sourceRunAttempt}'
  );
  expect(provenanceLiveSource).not.toContain(
    '/actions/runs/${provenance.runId}`'
  );
  expect(provenanceLiveSource).not.toContain(
    '/actions/runs/${provenance.sourceRunId}`'
  );

  const githubSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts'), 'utf8');
  const artifactSource = githubSource.slice(
    githubSource.indexOf('actionsArtifact(repository:'),
    githubSource.indexOf('actionsArtifactsForRun(repository:')
  );
  expect(githubSource).toContain("kind: 'artifact-name'");
  expect(githubSource).toContain("kind: 'workflow-run'");
  expect(githubSource).toContain('CI_VERIFICATION_SESSION_ARTIFACT_PREFIX');
  expect(githubSource).toContain('VERIFICATION_SESSION_ARTIFACT_NAME_PATTERN_V1');
  expect(githubSource).not.toContain("'sec-verification-session-v2-'");
  for (const family of [
    'sec-verification-action-parent-dispatch-plan-v2-',
    'sec-verification-action-resolution-v2-',
    'sec-verification-action-prepared-v2-',
    'sec-verification-action-raw-v2-',
    'sec-merge-gate-result-v2-',
    'sec-branch-closeout-recovery-v1-',
    'sec-closeout-projections-v1-'
  ]) expect(githubSource).toContain(family);
  expect(githubSource).not.toContain('sec-integration-projection-v1-');
  expect(githubSource).toContain(
    '/^sec-closeout-projections-v1-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u'
  );
  expect(artifactSource).toContain('classifyActionsArtifactAttemptAuthorityV1(');
  expect(artifactSource).toContain('Number(run.run_attempt)');
  expect(artifactSource).toContain('runAttempt: attemptAuthority.runAttempt');

  withCloseoutCliPartition(({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const samePrincipal = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
      name: 'rerun-same-principal', fixture, currentRunAttempt: 2,
      includeStableArtifact: true });
    const sameResult = runCloseoutCliProcess(shimRoot, samePrincipal, 'closeout-mutate-hosted');
    assertCloseoutCliProcessSucceeded('closeout-mutate-hosted same-principal rerun', sameResult);
    expect(readCloseoutCliHarnessState(samePrincipal.statePath)).toMatchObject({
      remoteDeleteCount: 1,
      principalUserLookups: ['integrator', 'integrator'],
      artifactsByRun: { 200: [
        { name: `sec-verification-action-start-v2-${'c'.repeat(64)}` },
        { name: expect.stringContaining('sec-branch-closeout-recovery-v1-') }
      ] }
    });

    const delegatedMaintainer = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot,
      shimRoot, name: 'rerun-delegated-maintainer', fixture, currentRunAttempt: 2,
      triggeringPrincipal: { login: 'release-manager', nodeId: 'RELEASE_MANAGER',
        permission: 'maintain' } });
    const delegatedResult = runCloseoutCliProcess(shimRoot, delegatedMaintainer,
      'closeout-mutate-hosted');
    assertCloseoutCliProcessSucceeded('closeout-mutate-hosted delegated rerun', delegatedResult);
    expect(readCloseoutCliHarnessState(delegatedMaintainer.statePath)).toMatchObject({
      remoteDeleteCount: 1,
      principalUserLookups: ['integrator', 'release-manager']
    });

    const writeOnly = createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
      name: 'rerun-write-only', fixture, currentRunAttempt: 2,
      triggeringPrincipal: { login: 'write-only', nodeId: 'WRITE_ONLY', permission: 'write' } });
    const blocked = runCloseoutCliProcess(shimRoot, writeOnly, 'closeout-mutate-hosted');
    expect(blocked.result.status).not.toBe(0);
    expect(blocked.result.stderr).toContain(
      'integrate-hosted triggering actor stable identity/live permission mismatch.');
    expect(readCloseoutCliHarnessState(writeOnly.statePath)).toMatchObject({
      remoteDeleteCount: 0,
      principalUserLookups: ['integrator', 'write-only']
    });

    const historicalAttemptMismatch = createCloseoutCliScenario({ harnessRoot,
      recoveryHarnessRoot, shimRoot, name: 'rerun-historical-attempt-mismatch', fixture,
      currentRunAttempt: 2, historicalAttemptMismatch: true });
    const mismatched = runCloseoutCliProcess(shimRoot, historicalAttemptMismatch,
      'closeout-mutate-hosted');
    expect(mismatched.result.status).not.toBe(0);
    expect(mismatched.result.stderr).toContain('hosted comment workflow run provenance drifted');
    expect(readCloseoutCliHarnessState(historicalAttemptMismatch.statePath))
      .toMatchObject({ remoteDeleteCount: 0 });
  });
}, 180_000);

test('rehydrated prepared envelope preserves remote history and composes with closeout authorization', () => {
  const inventory = (root: string, state: 'open' | 'merged'): BranchLifecycleInventory => ({
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: state === 'open' ? VERIFIED_AT : MERGE_AT,
    repository: { root, commonDir: path.join(root, '.git'), fullName: 'sec-platform/sec',
      remote: 'origin', remoteUrl: 'https://github.com/sec-platform/sec.git', defaultBranch: 'main' },
    main: { localSha: state === 'open' ? BASE : '9'.repeat(40),
      remoteSha: state === 'open' ? BASE : '9'.repeat(40) },
    localBranches: [{ branch: 'main', sha: state === 'open' ? BASE : '9'.repeat(40) },
      { branch: 'feat/example', sha: HEAD }],
    remoteBranches: [{ branch: 'main', sha: state === 'open' ? BASE : '9'.repeat(40) },
      { branch: 'feat/example', sha: HEAD }],
    worktrees: [],
    pullRequests: [{ number: 42, headBranch: 'feat/example', headSha: HEAD,
      baseBranch: 'main', baseSha: BASE, state, isDraft: false, isCrossRepository: false,
      url: 'https://github.example/pull/42' }],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: false, reason: null },
    pruneConfiguration: { observation: 'resolved', fetchPrune: true, remotePrune: true,
      fetchPruneTags: true, reason: null },
    unknowns: []
  });
  const hostAbsolute = (...segments: string[]) =>
    path.resolve(path.parse(process.cwd()).root, ...segments);
  const remoteRoot = hostAbsolute('provider', 'sec');
  const localRoot = hostAbsolute('runner', 'sec');
  const remoteRecoveryPath = hostAbsolute('provider-recovery', 'branch.bundle');
  const localRecoveryPath = hostAbsolute('runner-recovery', 'branch.bundle');
  const remoteWorktreePath = hostAbsolute('provider', 'worktree');
  const remoteBefore = inventory(remoteRoot, 'open');
  const localBefore = inventory(localRoot, 'merged');
  const preparation = (root: string, recoveryPath: string, worktrees: string[]) =>
    createBranchCloseoutPreparation({
      preparedAt: VERIFIED_AT,
      repository: { root, commonDir: path.join(root, '.git'), fullName: 'sec-platform/sec',
        remote: 'origin', defaultBranch: 'main' },
      branch: 'feat/example', refState: 'present', expectedHeadSha: HEAD,
      expectedRemoteSha: HEAD, expectedLocalSha: HEAD, expectedPrHeadSha: null,
      pullRequestNumber: 42, pullRequestStateAtPreparation: 'open',
      recovery: { kind: 'bundle', path: recoveryPath, sha256: PAGE,
        verified: true, verifyOutput: 'verified' },
      worktreePathsAtPreparation: worktrees
    });
  const remotePreparation = preparation(remoteRoot, remoteRecoveryPath, [remoteWorktreePath]);
  const localPreparation = preparation(localRoot, localRecoveryPath, []);
  expect(localPreparation.preparationDigest).toBe(remotePreparation.preparationDigest);
  const envelope = (
    prepared: typeof remotePreparation,
    before: BranchLifecycleInventory,
    attempts: readonly Readonly<{ operation: 'recovery-verify'; status: 'success'; detail: string }>[]
  ) => {
    const payload = { schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA_V1,
      preparation: prepared, before, attempts: [...attempts] };
    return parsePreparedBranchCloseoutEnvelope(`${JSON.stringify({ ...payload,
      envelopeDigest: branchLifecycleDigest(payload) }, null, 2)}\n`);
  };
  const remote = envelope(remotePreparation, remoteBefore,
    [{ operation: 'recovery-verify', status: 'success', detail: 'provider verified' }]);
  const local = envelope(localPreparation, localBefore,
    [{ operation: 'recovery-verify', status: 'success', detail: 'runner verified' }]);
  const rehydrated = rehydratePreparedBranchCloseoutEnvelopeV1({ remote, local });
  expect(rehydrated.before).toEqual(remoteBefore);
  expect(rehydrated.before).not.toEqual(localBefore);
  expect(rehydrated.preparation.repository.root).toBe(localRoot);
  expect(rehydrated.preparation.recovery.path).toBe(localRecoveryPath);
  expect(rehydrated.preparation.worktreePathsAtPreparation).toEqual([]);
  expect(rehydrated.foreignWorktreeObservations).toHaveLength(1);
  expect(JSON.stringify(rehydrated.foreignWorktreeObservations)).not.toContain(remoteWorktreePath);
  expect(rehydrated.attempts).toEqual(local.attempts);
  expect(rehydrated.preparation.preparationDigest).toBe(remotePreparation.preparationDigest);
  const authorization = authorizeBranchCloseout({
    preparation: rehydrated.preparation,
    request: { capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1, disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${'9'.repeat(40)}` } },
    before: rehydrated.before,
    current: localBefore,
    foreignWorktreeObservationDigests: rehydrated.foreignWorktreeObservations
      .map(({ observationDigest }) => observationDigest)
  });
  expect(authorization.blockers).toContain('external-maintainer-disposition-required');
  expect(authorization.remoteAction).toBe('blocked');
  expect(authorization.localAction).toBe('blocked');
});

test('foreign closeout observations remain fail-closed across host recovery', () => {
  const source = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const contract = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/branch-closeout-contract.ts'), 'utf8');
  expect(contract).toContain("blockers.push('external-maintainer-disposition-required')");
  expect(contract).not.toContain('ForeignWorktreeTerminalObservationV1');
  expect(contract).not.toContain('new WeakMap');
  expect(source).not.toContain('providerVerifiedForeignWorktreeDispositionV1');
  expect(source).not.toContain('bindForeignWorktreeObservationsToProviderHostV1');
  expect(source).not.toContain('worktree-cleanup-authorizations');

  const mutation = source.slice(source.indexOf("if (command === 'closeout-mutate-hosted')"),
    source.indexOf("if (command === 'closeout-publish-hosted')"));
  const preMarker = mutation.slice(mutation.indexOf('const preMarkerGuard'),
    mutation.indexOf('const publication = createBranchCloseoutEffectStartPublicationV1'));
  expect(preMarker).toContain('foreignWorktreeObservationDigests');
  const finalizer = source.slice(source.indexOf('function finalizeHostedBranchCloseoutV1('),
    source.indexOf('function publishHostedCloseoutTerminalV1('));
  expect(finalizer).toContain('foreignWorktreeObservationDigests');
});

test('authenticated hosted closeout consumes physical tokens only for local immutable targets', () => {
  const source = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  const helper = source.slice(source.indexOf('async function consumeSameHostWorktreeCloseoutV1('),
    source.indexOf('async function finalizeHostedBranchCloseoutV1('));
  expect(helper).toContain('same-host-worktree-closeout-required: no immutable locally registered target is available.');
  expect(helper).toContain('preparation.worktreePathsAtPreparation');
  expect(helper.indexOf('await prepareTrustedWorktreePhysicalCloseoutV1('))
    .toBeLessThan(helper.indexOf('await executeWorktreePhysicalCloseoutV1('));
  expect(helper.indexOf('await executeWorktreePhysicalCloseoutV1('))
    .toBeLessThan(helper.indexOf('assertTrustedCompletedWorktreePhysicalCloseoutV1('));
  expect(helper).toContain('authorizationPath: trusted.authorization.authorizationPath');
  expect(helper).toContain('tokens.length !== targets.length || tokens.length === 0');
  expect(helper).not.toContain('loadTrustedCompletedWorktreePhysicalCloseoutV1');
  expect(helper).not.toContain('readFileSync(');

  const mutation = source.slice(source.indexOf("if (command === 'closeout-mutate-hosted'"),
    source.indexOf("if (command === 'closeout-publish-hosted')"));
  expect(source).not.toContain('closeout-mutate-same-host');
  expect(mutation).not.toContain('sameHost');
  expect(mutation).toContain('closeout.recovery.prepared.foreignWorktreeObservations');
  expect(mutation).toContain('worktreeCleanupTokens = await routePreparedWorktreeCleanupAttemptV1');
  expect(mutation).toContain('targetCount: new Set(closeout.recovery.prepared.preparation.worktreePathsAtPreparation).size');
  expect(mutation).toContain('consumeLocalPreparedTargets: () => consumeSameHostWorktreeCloseoutV1');
  expect(mutation.indexOf('if (existing !== null)'))
    .toBeLessThan(mutation.indexOf('worktreeCleanupTokens = await routePreparedWorktreeCleanupAttemptV1'));
  expect(mutation).toContain('foreignWorktreeObservationDigests');
  expect(source.match(/prepareTrustedWorktreePhysicalCloseoutV1\(/gu)).toHaveLength(1);
});

test('GitHub GraphQL schema drift is classified as typed provider-schema-unsupported (#347 section C)', () => {
  const observed = "gh: Field 'id' doesn't exist on type 'Actor'";
  const failure = classifyGitHubGraphQLSchemaFailureV1(observed);
  expect(failure).not.toBeNull();
  expect(failure!.status).toBe(PROVIDER_SCHEMA_UNSUPPORTED_STATUS);
  expect(failure!.reasonCode).toBe('github-graphql-schema-unsupported');
  expect(failure!.responseDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(isGitHubProviderSchemaUnsupportedError(Object.assign(
    new Error('x'),
    { code: PROVIDER_SCHEMA_UNSUPPORTED_STATUS, reasonCode: 'r', responseDigest: failure!.responseDigest }
  ))).toBe(false);
  expect(classifyGitHubGraphQLSchemaFailureV1('HTTP 403: Resource not accessible')).toBeNull();
});

test('review thread comment queries never select Actor.id and carry the Node fragment (#347 section C)', async () => {
  const source = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session-github.ts'), 'utf8');
  expect(source).not.toContain('nodes{author{id}}');
  expect(source).toContain('author{__typename ... on Node{id}}');
  expect(source).not.toContain('author{id}pageInfo');
});

test('the implementation session cannot issue an independent Review receipt (#347 section B)', async () => {
  const { SEC_REVIEW_STABILITY_POLICY_V1, createReviewStabilityReceiptV1 } =
    await import('../../platform/shared/review-stability-contract.ts');
  const sha = 'a'.repeat(40);
  const digest = (value: string) => `sha256:${value}` as const;
  const principal = {
    kind: 'github-app' as const,
    actorNodeId: 'BOT_kgDOC98s_g',
    appId: 1144995,
    appNodeId: 'A_kwHOAOQ6Gs4AEXij',
    appSlug: 'chatgpt-codex-connector',
    reviewState: 'APPROVED' as const
  };
  const snapshotValue = {
    paginationComplete: true as const,
    reviewedHeadSha: sha,
    reviewPageDigests: [digest('a'.repeat(64))],
    threadPageDigests: [],
    reviewCount: 1,
    threadCount: 0,
    unresolvedBlockingThreadCount: 0 as const,
    requestChangesPrincipalIds: [] as readonly []
  };
  const snapshot = Object.freeze({
    ...snapshotValue,
    snapshotDigest: createReviewSnapshotDigestV1(snapshotValue)
  });
  const baseInput = {
    stage: 'pre-merge' as const,
    repository: 'sec-platform/sec',
    prNumber: 345,
    sessionRevision: digest('c'.repeat(64)),
    scopeAuthorizationRevision: digest('d'.repeat(64)),
    scopeAuthorizationReceiptDigest: digest('e'.repeat(64)),
    headSha: sha,
    headTreeSha: '3'.repeat(40),
    policy: SEC_REVIEW_STABILITY_POLICY_V1,
    principal,
    independence: { candidateAuthorNodeId: 'USER_author', integrationPrincipalNodeId: 'USER_integrator' },
    snapshot,
    reviewedAt: '2026-08-09T00:00:00.000Z',
    expiresAt: '2026-08-09T01:00:00.000Z'
  };
  expect(() => createReviewStabilityReceiptV1({
      ...baseInput,
      producer: {
        identity: 'scripts/codex/verification-session-github.ts',
        executionIdentity: SEC_VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY_V1,
        providerIdentity: 'github',
        candidateWriteCapability: 'read-only',
        capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT_V1,
        trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
        sourceTransport: 'github-graphql',
        sourceRunId: 'run-1',
        sourceRef: 'pull/345',
        sourceDigest: snapshot.snapshotDigest
      }
    }))
    .toThrow('canonical independent read-only observer execution');
});
