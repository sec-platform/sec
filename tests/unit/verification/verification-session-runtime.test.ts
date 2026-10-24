import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync, realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeHostedSessionCompilerCommand, resumeHostedVerificationSession } from '../../../src/bootstrap/development/closeout/verification-session-hosted.ts';
import { worktreePhysicalCloseoutOperations } from '../../../src/bootstrap/runtime-state/worktree-closeout.ts';
import type { BranchLifecycleInventory } from '../../../src/execution/verification/branch-closeout.ts';
import type { VerificationSessionHostedRequest } from "../../../src/execution/verification/hosted.ts";
import type { IntegrationAuthorizationOperationPublication, MergeGateResult } from '../../../src/execution/verification/integration.ts';
import type { GitHubActionsArtifactObservation, GitHubCandidateObservation, GitHubComparisonObservation, GitHubWorkflowRunObservation, SessionDigest, VerificationSession } from '../../../src/execution/verification/session.ts';
import { BASE, BOT, createVerificationSessionFixtureSupport, HEAD, JOIN_SESSION, PAGE } from '../../helpers/closeout-cli/session-fixture.ts';


const PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS = 30_000;
const VERIFICATION_ACTION_TEST_PROCESS_ISSUER =
  issueVerificationActionTestProcessIssuerForTests();

import { currentDocumentationVerificationBaseline } from '../../../src/adapters/self-hosting/control/documentation/active.ts';
import { createIntegrationAuthorization } from '../../../src/adapters/self-hosting/control/integration/authorization.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationActionParentDispatchPlanPayloadDigest, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, createCiVerificationLocalExecutionEnvironment } from '../../../src/adapters/verification/platform/action/contract/ci.ts';
import { bindDocumentationVerificationGateInput } from '../../../src/adapters/verification/platform/ci/contract/plan.ts';
import { createReviewSnapshotDigest, createReviewStabilityReceipt, renderIndependentReviewTrailer, REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, SEC_REVIEW_STABILITY_POLICY } from '../../../src/adapters/verification/platform/review/contract/stability.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation, CodexDevelopmentTestImpactTransitionDigest } from '../../../src/adapters/verification/platform/test-impact/runtime/transition.ts';

import type { GitHubWorkflowJobObservation } from '../../../src/adapters/providers/github-api/contract.ts';
import {
  authorizeBranchCloseout, createBranchCloseoutPreparation,
  createBranchCloseoutRecoveryArtifact,
  parseBranchCloseoutRecoveryArtifact
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
  parsePreparedBranchCloseoutEnvelope,
  rehydratePreparedBranchCloseoutEnvelope
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { createBranchLifecycleGitChildEnvironment } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';

import { CI_MAIN_HEALTH_POLICY } from '../../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../src/adapters/verification/platform/action/contract/provider.ts';
import {
  executeLocalVerificationActionDag,
  issueVerificationActionTestProcessIssuerForTests
} from '../../../src/adapters/verification/platform/action/runner.ts';
import { CI_VERIFICATION_SESSION_ARTIFACT_PREFIX, CI_VERIFICATION_SESSION_DISPATCH_TYPE } from '../../../src/adapters/verification/platform/ci/contract/revision.ts';
import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from "../../../src/adapters/verification/platform/ci/contract/session-request.ts";

import { parseVerificationSessionHostedRequest } from "../../../src/adapters/verification/platform/ci/contract/session-request.ts";
import { assertGitHubReviewAuthorityObservation, classifyGitHubGraphQLSchemaFailure, createReviewProviderRevalidationCommentBody, evaluateGitHubRepositoryActionsArtifactInventory, evaluateHostedReviewLocatorObservation, evaluateMaintainerReviewWakeupObservation, evaluatePlatformEnforcementObservation, evaluateReviewProviderAvailabilityObservation, evaluateVerificationSessionChangedPaths, evaluateVerificationSessionReviewObservation, evaluateVerificationSessionWorkflowJoin, isGitHubProviderSchemaUnsupportedError, parseGitHubOpenPullRequestCensus, parseGitHubPullRequestFileInventory, parseGitHubReviewPages, parseGitHubReviewThreadPages, PROVIDER_SCHEMA_UNSUPPORTED_STATUS, shouldPublishMaintainerReviewWakeup, VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER, VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER, type GitHubIssueCommentObservation, type GitHubPage, type GitHubReviewObservation } from '../../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { assertTrustedExactRevisionRuntime, assertTrustedMainRuntime, assertTrustedMergedRequestRuntimeReachability, assertTrustedRuntime, classifyVerificationSessionArtifactReuse, compilePostMainIssueDispositionHealthReadback, createVerificationSessionLocalPreparationRequest, prepareLocalQuickVerificationActionPlan, prepareTrustedMainVerificationSession, prepareVerificationSessionHosted, reconstructVerificationSessionHostedFacts, SEC_VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY } from '../../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import {
  assertHostedCompilerDispatchPayload,
  assertHostedCompilerInternalProvenance,
  assertHostedSquashMergeCompletion,
  classifyDurableVerificationSessionProjection,
  parseHostedSynchronousSquashMergeResponse,
  planHostedIntegrationEffects,
  routeHostedIntegration,
  verificationSessionCli,
  verificationSessionExecutionPlacement
} from '../../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import { routePreparedWorktreeCleanupAttempt } from '../../../src/application/verification-session-hosted.ts';
import { parseHostedVerificationCommand } from '../../../src/entry/verification-session-hosted-cli.ts';
import { settleResources } from '../../../src/execution/resource-settlement.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../../helpers/test-impact-provider.ts';
import { runRetainedBunTestProcess } from '../../testkit/process-resource.ts';

const JOIN_ACTION = `sha256:${'7'.repeat(64)}` as const;
let testImpactFixture: Awaited<ReturnType<typeof acquireExactRepositoryTestImpactProviderFixture>> | undefined;
let TEST_IMPACT_SOURCE_PROVIDER: ReturnType<typeof bindDocumentationVerificationGateInput>;

const sessionFixture = createVerificationSessionFixtureSupport(() => TEST_IMPACT_SOURCE_PROVIDER);
const { changedTransition, workflowRun, page, FakeTransport, ReducerTransport, botIssueComment, actionsIssueComment, maintainerIssueComment, defaultReviewWakeupBody, observe, expectTypedProviderSchemaUnsupported, observePrivateClearReviewBarrier, observePrivateGhProviderBarrier, observePrivateMergedCandidate, fakeGitHubClient, mainHealthCheck, VERIFIED_AT, MERGE_AT, actionDependencyBlobs, createPureHostedEnvelopeFixture, reducerFixture } = sessionFixture;
type FakeTransport = InstanceType<typeof FakeTransport>;

const JOIN_REQUEST: VerificationSessionHostedRequest<typeof import("../../../src/adapters/verification/platform/ci/contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA> = Object.freeze({
  schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA, prNumber: 42,
  expectedBaseSha: BASE, expectedBaseTreeSha: HEAD, expectedHeadSha: HEAD,
  expectedHeadTreeSha: HEAD, manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v6.md',
  manifestDigest: `sha256:${'1'.repeat(64)}`, profile: 'quick',
  expectedScopeProposalDigest: `sha256:${'2'.repeat(64)}`,
  expectedActionPlanDigest: JOIN_ACTION, expectedSessionRevision: JOIN_SESSION,
  reviewPolicyDigest: `sha256:${'3'.repeat(64)}`,
  requestOperationId: `sha256:${'4'.repeat(64)}`
});

test('hosted integration router separates first effect, merged recovery, and blocking', () => {
  const session = { repository: 'sec-platform/sec', prNumber: 42,
    sessionRevision: JOIN_SESSION, baseSha: BASE, baseTreeSha: BASE,
    headSha: HEAD, headTreeSha: HEAD } as VerificationSession;
  const candidate: GitHubCandidateObservation = {
    repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
    isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE,
    baseTreeSha: BASE, headBranch: 'feat/example', headSha: HEAD, headTreeSha: HEAD,
    title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
    mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null,
    mergeCommitParentShas: null
  };
  const open = routeHostedIntegration({ repository: 'sec-platform/sec', session, candidate,
    priorEffectStarted: false, authorizationPublicationCount: 0 });
  expect(open).toMatchObject({ lane: 'open-first-effect',
    reason: 'exact-open-candidate-without-prior-effect' });
  expect(planHostedIntegrationEffects(open)).toEqual({
    prepareRecoveryArtifact: true,
    createAuthorizationPublication: true,
    executePhysicalMerge: true,
    consumeOriginalAuthorizationPublication: false,
    consumeOriginalRecoveryArtifact: false
  });

  expect(routeHostedIntegration({ repository: 'sec-platform/sec', session, candidate,
    priorEffectStarted: true, authorizationPublicationCount: 0 })).toMatchObject({
      lane: 'blocked', reason: 'open-prior-effect-started'
    });
  expect(routeHostedIntegration({ repository: 'sec-platform/sec', session, candidate,
    priorEffectStarted: false, authorizationPublicationCount: 1 })).toMatchObject({
      lane: 'blocked', reason: 'open-prior-effect-started'
    });

  const mergedCandidate = { ...candidate, state: 'MERGED' as const,
    baseSha: '8'.repeat(40), baseTreeSha: '7'.repeat(40),
    mergeCommitSha: '9'.repeat(40), mergeCommitTreeSha: HEAD,
    mergeCommitMessage: 'marker-bound merge',
    mergeCommitParentShas: Object.freeze(['8'.repeat(40)]) };
  const merged = routeHostedIntegration({ repository: 'sec-platform/sec', session,
    candidate: mergedCandidate, priorEffectStarted: true, authorizationPublicationCount: 1 });
  expect(merged).toMatchObject({ lane: 'merged-recovery', mergeCommitSha: '9'.repeat(40),
    mergeCommitTreeSha: HEAD });
  const mergedEffects = planHostedIntegrationEffects(merged);
  expect(mergedEffects).toEqual({
    prepareRecoveryArtifact: false,
    createAuthorizationPublication: false,
    executePhysicalMerge: false,
    consumeOriginalAuthorizationPublication: true,
    consumeOriginalRecoveryArtifact: true
  });

  expect(routeHostedIntegration({ repository: 'sec-platform/sec', session,
    candidate: { ...candidate, state: 'CLOSED' as const }, priorEffectStarted: false,
    authorizationPublicationCount: 0 })).toMatchObject({
      lane: 'blocked', reason: 'pull-request-closed-without-exact-merge'
    });
  expect(routeHostedIntegration({ repository: 'sec-platform/sec', session,
    candidate: { ...mergedCandidate, mergeCommitTreeSha: BASE }, priorEffectStarted: true,
    authorizationPublicationCount: 1 })).toMatchObject({
      lane: 'blocked', reason: 'merged-readback-incomplete-or-tree-mismatch'
    });
});

test('hosted Review locator is exact, non-triggering, and reuses only its matching locator', async () => {
  const input = {
    repository: 'sec-platform/sec',
    sessionRevision: `sha256:${'1'.repeat(64)}` as SessionDigest,
    operationId: `sha256:${'2'.repeat(64)}` as SessionDigest,
    prNumber: 42,
    headSha: HEAD,
    headTreeSha: HEAD,
    sourceRunId: '900',
    sourceRunAttempt: 1,
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`
  } as const;
  const transport = new FakeTransport();
  transport.issueComments = [[]];
  const produced = (await evaluateHostedReviewLocatorObservation(transport, input));
  expect(produced).toMatchObject({ status: 'absent', commentId: null });
  expect(produced.body).toContain(VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER);
  expect(produced.body).not.toContain('@codex review');

  transport.issueComments = [[actionsIssueComment(produced.body, '104')]];
  expect((await evaluateHostedReviewLocatorObservation(transport, input))).toMatchObject({
    status: 'reused',
    commentId: '104'
  });

  transport.issueComments = [[]];
  const foreign = (await evaluateHostedReviewLocatorObservation(transport, {
    ...input,
    repository: 'foreign/repository'
  }));
  transport.issueComments = [[actionsIssueComment(foreign.body)]];
  await expect((async () => (await evaluateHostedReviewLocatorObservation(transport, input)))()).rejects
    .toThrow('conflicting semantic bytes');

  for (const drifted of [
    { ...input, prNumber: input.prNumber + 1 },
    { ...input, headSha: BASE },
    { ...input, headTreeSha: BASE },
    { ...input, sourceRunId: '901' },
    { ...input, sourceRunAttempt: 2 },
    { ...input, workflowRef: `.github/workflows/compiler-pr-validation.yml@${HEAD}` }
  ]) {
    transport.issueComments = [[]];
    const drift = (await evaluateHostedReviewLocatorObservation(transport, drifted));
    transport.issueComments = [[actionsIssueComment(drift.body)]];
    await expect((async () => (await evaluateHostedReviewLocatorObservation(transport, input)))()).rejects
      .toThrow('conflicting semantic bytes');
  }

  const encoded = produced.body.match(/```json\n(?<payload>.+)\n```$/u)?.groups?.payload;
  if (encoded === undefined) throw new Error('production Review locator body did not contain canonical JSON');
  const extraFieldBody = produced.body.replace(encoded, encodeVerificationActionData({
    ...(JSON.parse(encoded) as Record<string, unknown>),
    extraField: 'forbidden'
  }));
  transport.issueComments = [[actionsIssueComment(extraFieldBody)]];
  await expect((async () => (await evaluateHostedReviewLocatorObservation(transport, input)))()).rejects
    .toThrow('payload keys/schema are invalid');
});

test('Review provider quota creates one repository-scoped deny-only availability epoch', async () => {
  const transport = new FakeTransport();
  const quota = 'You have reached your Codex usage limits for code reviews. Upgrade or add credits to continue.';
  transport.repositoryIssueComments = [[botIssueComment(quota, {
    id: '301',
    createdAt: '2026-08-09T13:50:00.000Z'
  })]];
  const unavailable = (await evaluateReviewProviderAvailabilityObservation(transport, {
    repository: 'sec-platform/sec',
    observedAt: '2026-08-09T14:01:00.000Z'
  }));
  expect(unavailable).toMatchObject({
    status: 'unavailable',
    reasonCode: 'provider-quota-unavailable',
    sourceCommentId: '301',
    sourceObservedAt: '2026-08-09T13:50:00.000Z'
  });
  if (unavailable.status !== 'unavailable') throw new Error('expected quota unavailable');
  expect(unavailable.receiptRef).toMatch(/^sha256:[0-9a-f]{64}$/u);

  transport.repositoryIssueComments = [[botIssueComment(quota, {
    id: '303',
    createdAt: '2026-08-08T13:59:00.000Z'
  })]];
  expect((await evaluateReviewProviderAvailabilityObservation(transport, {
    repository: 'sec-platform/sec',
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({ status: 'unavailable', sourceCommentId: '303' });

  transport.repositoryIssueComments = [[botIssueComment(quota, {
    id: '304',
    authorNodeId: 'FOREIGN_BOT',
    performedViaGitHubApp: { id: 999, nodeId: 'FOREIGN_APP', slug: 'foreign-app' }
  })]];
  expect((await evaluateReviewProviderAvailabilityObservation(transport, {
    repository: 'sec-platform/sec',
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({ status: 'no-current-negative' });

  transport.collaboratorPermissions.set('maintainer', 'maintain');
  const target = {
    repository: 'sec-platform/sec',
    prNumber: 42,
    headSha: HEAD,
    headTreeSha: HEAD
  } as const;
  const revalidation = createReviewProviderRevalidationCommentBody({
    ...target,
    publisherNodeId: 'MAINTAINER_NODE'
  });
  transport.repositoryIssueComments = [[
    maintainerIssueComment(revalidation.body, '305', {
      createdAt: '2026-08-09T14:00:00.000Z'
    }),
    botIssueComment(quota, {
      id: '306',
      createdAt: '2026-08-09T13:50:00.000Z'
    })
  ]];
  expect((await evaluateReviewProviderAvailabilityObservation(transport, {
    ...target,
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({
    status: 'no-current-negative',
    revalidationCommentId: '305',
    revalidationObservedAt: '2026-08-09T14:00:00.000Z',
    revalidationDigest: revalidation.revalidationDigest
  });
  expect((await evaluateReviewProviderAvailabilityObservation(transport, {
    repository: 'sec-platform/sec',
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({ status: 'unavailable', sourceCommentId: '306' });

  transport.repositoryIssueComments = [[
    maintainerIssueComment((await defaultReviewWakeupBody()), '308', {
      createdAt: '2026-08-09T14:00:30.000Z'
    }),
    maintainerIssueComment(revalidation.body, '305', {
      createdAt: '2026-08-09T14:00:00.000Z'
    })
  ]];
  expect((await evaluateReviewProviderAvailabilityObservation(transport, {
    ...target,
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({
    status: 'unavailable',
    reasonCode: 'provider-revalidation-consumed',
    sourceCommentId: '308'
  });

  transport.repositoryIssueComments = [[
    maintainerIssueComment('<!-- retired: codex review trigger transport noise -->', '308', {
      createdAt: '2026-08-09T14:00:30.000Z'
    }),
    maintainerIssueComment(revalidation.body, '305', {
      createdAt: '2026-08-09T14:00:00.000Z'
    })
  ]];
  expect((await evaluateReviewProviderAvailabilityObservation(transport, {
    ...target,
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({
    status: 'unavailable',
    reasonCode: 'provider-revalidation-consumed',
    sourceCommentId: '308'
  });

  transport.repositoryIssueComments = [[
    botIssueComment(quota, {
      id: '307',
      createdAt: '2026-08-09T14:00:30.000Z'
    }),
    maintainerIssueComment(revalidation.body, '305', {
      createdAt: '2026-08-09T14:00:00.000Z'
    })
  ]];
  expect((await evaluateReviewProviderAvailabilityObservation(transport, {
    ...target,
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({ status: 'unavailable', sourceCommentId: '307' });
});

test('maintainer Review wake-up is exact, user-authored, and at-most-once per session operation', async () => {
  expect(shouldPublishMaintainerReviewWakeup({ reviewBarrierStatus: 'waiting',
    localVerificationStatus: 'passed', hostedArtifactPresent: false })).toBe(true);
  for (const state of [
    { reviewBarrierStatus: 'clear' as const, localVerificationStatus: 'passed' as const,
      hostedArtifactPresent: false },
    { reviewBarrierStatus: 'blocked' as const, localVerificationStatus: 'passed' as const,
      hostedArtifactPresent: false },
    { reviewBarrierStatus: PROVIDER_SCHEMA_UNSUPPORTED_STATUS, localVerificationStatus: 'passed' as const,
      hostedArtifactPresent: false },
    { reviewBarrierStatus: 'waiting' as const, localVerificationStatus: 'failed' as const,
      hostedArtifactPresent: false },
    { reviewBarrierStatus: 'waiting' as const, localVerificationStatus: 'blocked' as const,
      hostedArtifactPresent: false },
    { reviewBarrierStatus: 'waiting' as const, localVerificationStatus: null,
      hostedArtifactPresent: false },
    { reviewBarrierStatus: 'waiting' as const, localVerificationStatus: 'passed' as const,
      hostedArtifactPresent: true }
  ]) expect(shouldPublishMaintainerReviewWakeup(state)).toBe(false);

  const input = {
    repository: 'sec-platform/sec',
    sessionRevision: `sha256:${'1'.repeat(64)}` as SessionDigest,
    operationId: `sha256:${'2'.repeat(64)}` as SessionDigest,
    requestOperationId: `sha256:${'3'.repeat(64)}` as SessionDigest,
    prNumber: 42,
    headSha: HEAD,
    headTreeSha: HEAD,
    publisherLogin: 'maintainer',
    publisherNodeId: 'MAINTAINER_NODE'
  } as const;
  const transport = new FakeTransport();
  transport.collaboratorPermissions.set('outsider', 'read');
  transport.collaboratorPermissions.set('renamed-maintainer', 'admin');
  type WakeupObservationTransaction = Parameters<
    typeof evaluateMaintainerReviewWakeupObservation
  >[0];
  const acceptWakeupObservationTransaction = (_transaction: WakeupObservationTransaction): void => undefined;
  if (false) {
    // @ts-expect-error collaboratorPermission is an authority-bearing required capability.
    acceptWakeupObservationTransaction({
      issueCommentPage: transport.issueCommentPage.bind(transport)
    });
  }
  transport.issueComments = [[]];
  const produced = (await evaluateMaintainerReviewWakeupObservation(transport, input));
  expect(produced).toMatchObject({ status: 'absent', commentId: null });
  expect(produced.body.startsWith('@codex review\n\n')).toBe(true);
  expect(produced.body).toContain(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER);

  transport.issueComments = [[botIssueComment(produced.body, {
    id: '200', authorLogin: 'outsider', authorId: 502, authorNodeId: 'OUTSIDER',
    authorType: 'User', performedViaGitHubApp: null
  })]];
  expect((await evaluateMaintainerReviewWakeupObservation(transport, input))).toMatchObject({
    status: 'absent', commentId: null
  });

  transport.issueComments = [[botIssueComment(
    `@codex review\n\n${VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER}\n{not-json}`,
    { id: '204', authorLogin: 'outsider', authorId: 502, authorNodeId: 'OUTSIDER',
      authorType: 'User', performedViaGitHubApp: null }
  )]];
  expect((await evaluateMaintainerReviewWakeupObservation(transport, input))).toMatchObject({
    status: 'absent', commentId: null
  });

  transport.issueComments = [[maintainerIssueComment(produced.body)]];
  expect((await evaluateMaintainerReviewWakeupObservation(transport, input))).toMatchObject({
    status: 'reused', commentId: '201', wakeupDigest: produced.wakeupDigest
  });

  transport.issueComments = [[maintainerIssueComment(produced.body, '205', {
    authorLogin: 'renamed-maintainer'
  })]];
  expect((await evaluateMaintainerReviewWakeupObservation(transport, input))).toMatchObject({
    status: 'reused', commentId: '205', wakeupDigest: produced.wakeupDigest
  });

  transport.issueComments = [[]];
  const otherMaintainer = (await evaluateMaintainerReviewWakeupObservation(transport, {
    ...input,
    publisherLogin: 'other-maintainer',
    publisherNodeId: 'OTHER_MAINTAINER_NODE'
  }));
  transport.issueComments = [[botIssueComment(otherMaintainer.body, {
    id: '203', authorLogin: 'other-maintainer', authorId: 503,
    authorNodeId: 'OTHER_MAINTAINER_NODE', authorType: 'User', performedViaGitHubApp: null
  })]];
  expect((await evaluateMaintainerReviewWakeupObservation(transport, input))).toMatchObject({
    status: 'reused', commentId: '203', wakeupDigest: otherMaintainer.wakeupDigest
  });

  transport.issueComments = [[maintainerIssueComment(produced.body, '201'),
    maintainerIssueComment(produced.body, '202')]];
  await expect((async () => (await evaluateMaintainerReviewWakeupObservation(transport, input)))()).rejects
    .toThrow('duplicate maintainer Review wake-up comments');

  transport.issueComments = [[]];
  const drifted = (await evaluateMaintainerReviewWakeupObservation(transport, {
    ...input,
    headTreeSha: BASE
  }));
  transport.issueComments = [[maintainerIssueComment(drifted.body)]];
  await expect((async () => (await evaluateMaintainerReviewWakeupObservation(transport, input)))()).rejects
    .toThrow('conflicting semantic bytes');

  transport.issueComments = [[maintainerIssueComment(produced.body, '201', {
    authorType: 'Bot',
    performedViaGitHubApp: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app
  })]];
  expect((await evaluateMaintainerReviewWakeupObservation(transport, input))).toMatchObject({
    status: 'absent', commentId: null
  });

  transport.issueComments = [[maintainerIssueComment(
    `@codex review\n\n${VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER}\n{not-json}`
  )]];
  await expect((async () => (await evaluateMaintainerReviewWakeupObservation(transport, input)))()).rejects
    .toThrow('maintainer Review wake-up comment shape is invalid');
});

test('trusted Codex Review authority requires one earlier exact maintainer wake-up', async () => {
  const unbound = new FakeTransport();
  unbound.issueComments = [[botIssueComment()]];
  expect((await observe(unbound, false))).toMatchObject({
    status: 'blocked',
    reason: 'review-provider-unbound-activation'
  });

  const wakeupInput = {
    repository: 'sec-platform/sec',
    sessionRevision: `sha256:${'1'.repeat(64)}` as SessionDigest,
    operationId: `sha256:${'2'.repeat(64)}` as SessionDigest,
    requestOperationId: `sha256:${'3'.repeat(64)}` as SessionDigest,
    prNumber: 42,
    headSha: HEAD,
    headTreeSha: HEAD,
    publisherLogin: 'maintainer',
    publisherNodeId: 'MAINTAINER_NODE'
  } as const;
  const wakeupSource = new FakeTransport();
  const wakeup = (await evaluateMaintainerReviewWakeupObservation(wakeupSource, wakeupInput));

  const bound = new FakeTransport();
  bound.issueComments = [[
    botIssueComment(undefined, { id: '301', createdAt: '2026-08-09T14:00:00.000Z' }),
    maintainerIssueComment(wakeup.body, '300', { createdAt: '2026-08-09T13:59:00.000Z' })
  ]];
  expect((await observe(bound))).toMatchObject({
    status: 'clear',
    principal: { kind: 'github-app', actorNodeId: BOT }
  });

  const lateWakeup = new FakeTransport();
  lateWakeup.issueComments = [[
    maintainerIssueComment(wakeup.body, '302', { createdAt: '2026-08-09T14:00:30.000Z' }),
    botIssueComment(undefined, { id: '301', createdAt: '2026-08-09T14:00:00.000Z' })
  ]];
  expect((await observe(lateWakeup, false))).toMatchObject({
    status: 'blocked',
    reason: 'review-provider-unbound-activation'
  });
});

test('repository-wide Codex quota negative is trusted, bounded, stable, and fail-closed', async () => {
  const observedAt = '2026-08-09T14:01:00.000Z';
  const quotaBody = 'You have reached your Codex usage limits for code reviews. Upgrade or add credits.';
  const recentQuota = botIssueComment(quotaBody, {
    id: '401',
    createdAt: '2026-08-09T14:00:00.000Z'
  });

  const unavailable = new FakeTransport();
  unavailable.repositoryIssueComments = [[recentQuota]];
  expect((await evaluateReviewProviderAvailabilityObservation(unavailable, {
    repository: 'sec-platform/sec',
    observedAt
  }))).toMatchObject({
    status: 'unavailable',
    reasonCode: 'provider-quota-unavailable',
    sourceCommentId: '401',
    sourceObservedAt: '2026-08-09T14:00:00.000Z'
  });

  const tombstoned = new FakeTransport();
  tombstoned.repositoryIssueComments = [[botIssueComment(
    '<!-- retired: codex code-review quota transport noise -->',
    { id: '406', createdAt: '2026-08-09T14:00:00.000Z' }
  )]];
  expect((await evaluateReviewProviderAvailabilityObservation(tombstoned, {
    repository: 'sec-platform/sec',
    observedAt
  }))).toMatchObject({
    status: 'unavailable',
    reasonCode: 'provider-quota-unavailable',
    sourceCommentId: '406',
    sourceObservedAt: '2026-08-09T14:00:00.000Z'
  });

  const humanDiagnostic = new FakeTransport();
  humanDiagnostic.repositoryIssueComments = [[maintainerIssueComment(quotaBody, '402', {
    createdAt: '2026-08-09T14:00:00.000Z'
  })]];
  expect((await evaluateReviewProviderAvailabilityObservation(humanDiagnostic, {
    repository: 'sec-platform/sec',
    observedAt
  })).status).toBe('no-current-negative');

  const historicalNegative = new FakeTransport();
  historicalNegative.repositoryIssueComments = [[botIssueComment(quotaBody, {
    id: '403',
    createdAt: '2026-08-08T13:59:00.000Z'
  })]];
  expect((await evaluateReviewProviderAvailabilityObservation(historicalNegative, {
    repository: 'sec-platform/sec',
    observedAt
  }))).toMatchObject({ status: 'unavailable', sourceCommentId: '403' });

  const outOfOrder = new FakeTransport();
  outOfOrder.repositoryIssueComments = [[
    botIssueComment('first', { id: '404', createdAt: '2026-08-09T13:00:00.000Z' }),
    botIssueComment('second', { id: '405', createdAt: '2026-08-09T13:30:00.000Z' })
  ]];
  expect((await evaluateReviewProviderAvailabilityObservation(outOfOrder, {
    repository: 'sec-platform/sec',
    observedAt
  }))).toMatchObject({
    status: 'unresolved',
    reason: 'provider-comment-ordering-invalid'
  });

  const exhausted = new FakeTransport();
  exhausted.repositoryIssueComments = Array.from({ length: 65 }, (_, index) => [
    botIssueComment('ordinary Codex provider prose', {
      id: String(600 + index), createdAt: '2026-08-09T13:59:00.000Z'
    })
  ]);
  expect((await evaluateReviewProviderAvailabilityObservation(exhausted, {
    repository: 'sec-platform/sec',
    observedAt
  }))).toMatchObject({
    status: 'unresolved',
    reason: 'pagination-budget-exhausted'
  });

  let firstPageReads = 0;
  const drifting = {
    repositoryIssueCommentPage(
      _repository: string,
      _after: string | null
    ): GitHubPage<GitHubIssueCommentObservation> {
      firstPageReads += 1;
      return {
        nodes: [],
        hasNextPage: false,
        endCursor: null,
        pageDigest: `sha256:${(firstPageReads === 1 ? 'a' : 'b').repeat(64)}` as SessionDigest
      };
    }
  };
  expect((await evaluateReviewProviderAvailabilityObservation(drifting, {
    repository: 'sec-platform/sec',
    observedAt
  }))).toMatchObject({
    status: 'unresolved',
    reason: 'provider-comment-page-drift'
  });

  const visited: Array<string | null> = [];
  let secondPageReads = 0;
  const secondPageDrift = {
    repositoryIssueCommentPage(
      _repository: string,
      after: string | null
    ): GitHubPage<GitHubIssueCommentObservation> {
      visited.push(after);
      if (after === null) {
        return {
          nodes: [botIssueComment('ordinary Codex summary', {
            id: '500',
            createdAt: '2026-08-09T14:00:30.000Z'
          })],
          hasNextPage: true,
          endCursor: '2',
          pageDigest: `sha256:${'c'.repeat(64)}` as SessionDigest
        };
      }
      if (after !== '2') throw new Error(`unexpected test cursor: ${after}`);
      secondPageReads += 1;
      return {
        nodes: [],
        hasNextPage: false,
        endCursor: null,
        pageDigest: `sha256:${(secondPageReads === 1 ? 'd' : 'e').repeat(64)}` as SessionDigest
      };
    }
  };
  expect((await evaluateReviewProviderAvailabilityObservation(secondPageDrift, {
    repository: 'sec-platform/sec',
    observedAt
  }))).toMatchObject({
    status: 'unresolved',
    reason: 'provider-comment-page-drift'
  });
  expect(visited).toEqual([null, '2', null, '2']);
});

test('provider recovery artifact binds exact envelope and bundle bytes', () => {
  const artifact = createBranchCloseoutRecoveryArtifact({
    repository: 'sec-platform/sec',
    pullRequestNumber: 42,
    sessionRevision: JOIN_SESSION,
    headSha: HEAD,
    headTreeSha: HEAD,
    preparedEnvelopeBytes: '{"schema":"prepared-fixture"}\n',
    recoveryBundleBytes: Buffer.from('exact recovery bundle bytes')
  });
  expect(parseBranchCloseoutRecoveryArtifact(JSON.stringify(artifact))).toEqual(artifact);
  expect(artifact.preparedEnvelopeByteLength).toBe(30);
  expect(artifact.recoveryBundleByteLength).toBe(27);

  expect(() => parseBranchCloseoutRecoveryArtifact({ ...artifact,
    recoveryBundleBase64: Buffer.from('substituted recovery bundle').toString('base64') }))
    .toThrow('recovery bundle digest mismatch');
  expect(() => parseBranchCloseoutRecoveryArtifact({ ...artifact, callerPath: 'untrusted.json' }))
    .toThrow('fields are not exact');
  expect(() => parseBranchCloseoutRecoveryArtifact({ ...artifact,
    preparedEnvelopeBase64: `${artifact.preparedEnvelopeBase64}=\n` }))
    .toThrow('canonical base64');
});

async function runReducer(fixture: Awaited<ReturnType<typeof reducerFixture>>) {
  return (await resumeHostedVerificationSession({ repositoryRoot: fixture.repositoryRoot,
    session: fixture.artifact.session, scopeAuthorization: fixture.artifact.scopeAuthorization,
    changedPaths: fixture.changedPaths, testImpactTransition: fixture.testImpactTransition,
    integrationPrincipalNodeId: 'INTEGRATOR',
    github: fixture.github, external: fixture.external, journalFs: fixture.journalFs }));
}

function durablePublication(fixture: Awaited<ReturnType<typeof reducerFixture>>): Readonly<{
  commentId: number;
  publication: IntegrationAuthorizationOperationPublication;
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
  } as unknown as IntegrationAuthorizationOperationPublication;
  return Object.freeze({ commentId: remote.commentId, publication });
}

function substituteAuthorizationLiveIdentity(
  fixture: Awaited<ReturnType<typeof reducerFixture>>,
  identity: { repository?: string; prNumber?: number }
): MergeGateResult {
  const previous = fixture.result.authorization;
  const { schema: _schema, authorizationId: _authorizationId, receiptDigest: _receiptDigest,
    ...authorizationInput } = previous;
  const authorization = createIntegrationAuthorization({ ...authorizationInput, ...identity });
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
    encodeVerificationActionData(withoutDigest)
  ).digest('hex')}` as const;
  return Object.freeze({ ...withoutDigest, resultDigest });
}

test('REST clean verdict accepts stable prefix variants only with provider-resolved exact 10/full locator', async () => {
  const providerAbout = new FakeTransport();
  providerAbout.issueComments = [[botIssueComment(
    `Codex Review: Didn't find any major issues. What shall we build next?\n\n` +
    `**Reviewed commit:** \`${HEAD.slice(0, 10)}\`\n\n` +
    '<details> <summary>ℹ️ About Codex in GitHub</summary>\n<br/>\n\n' +
    '[Your team has set up Codex to review pull requests in this repo]' +
    '(https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you\n' +
    '- Open a pull request for review\n- Mark a draft as ready\n- Comment "@codex review".\n\n' +
    'If Codex has suggestions, it will comment; otherwise it will react with 👍.\n\n' +
    'Codex can also answer questions or update the PR. Try commenting ' +
    '"@codex address that feedback".\n</details>'
  )]];
  const authority = await observe(providerAbout);
  expect(authority.status).toBe('clear');
  if (authority.status !== 'clear') throw new Error('expected clear review');
  expect(authority.principal).toEqual({ kind: 'github-app', actorNodeId: BOT, appId: 1144995,
    appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' });
  expect(authority.snapshot.reviewedHeadSha).toBe(HEAD);
  expect(authority.authority.sourceTransport).toBe('github-rest');
  expect(authority.snapshot.reviewPageDigests).toContain(authority.authority.sourceDigest);

  for (const body of [
    `Codex Review: Didn't find any major issues. Swish!\n\n` +
      `**Reviewed commit:** \`${HEAD.slice(0, 10)}\`\n\n### P1 finding`,
    `Codex Review: Didn't find any major issues. Finding: P1 unsafe behavior\n\n` +
      `**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    `Codex Review: Didn't find any major issues. Swish!\n\nUnexpected finding text\n\n` +
      `**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    `Codex Review: Didn't find any major issues. Swish!\n\n` +
      `**Reviewed commit:** \`${HEAD.slice(0, 10)}\`\n\n` +
      '<details> <summary>ℹ️ About Codex in GitHub</summary>\n' +
      '### P1 finding\n</details>'
  ]) {
    const contradictory = new FakeTransport();
    contradictory.issueComments = [[botIssueComment(body)]];
    expect((await observe(contradictory))).toMatchObject({ status: 'waiting',
      reason: 'exact-head-independent-review-missing' });
  }

  for (const locator of ['2'.repeat(7), '2'.repeat(39), 'a'.repeat(10), 'a'.repeat(40)]) {
    const transport = new FakeTransport();
    transport.issueComments = [[botIssueComment(
      `Codex Review: Didn't find any major issues. Bravo.\n\n**Reviewed commit:** \`${locator}\``
    )]];
    expect((await observe(transport))).toMatchObject({ status: 'waiting',
      reason: 'exact-head-independent-review-missing' });
  }
  const ambiguous = new FakeTransport();
  ambiguous.issueComments = [[botIssueComment()]];
  ambiguous.resolutions.set(HEAD.slice(0, 10), { repository: 'sec-platform/sec',
    locator: HEAD.slice(0, 10), status: 'ambiguous', commitSha: null, treeSha: null,
    responseDigest: `sha256:${'9'.repeat(64)}` });
  expect((await observe(ambiguous))).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });

  const wrongTree = new FakeTransport();
  wrongTree.issueComments = [[botIssueComment()]];
  wrongTree.resolutions.set(HEAD.slice(0, 10), { repository: 'sec-platform/sec',
    locator: HEAD.slice(0, 10), status: 'resolved', commitSha: HEAD, treeSha: BASE,
    responseDigest: `sha256:${'8'.repeat(64)}` });
  expect((await observe(wrongTree))).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });

  const suggestion = new FakeTransport();
  suggestion.issueComments = [[botIssueComment(
    `### 💡 Codex Review\n\nHere are some automated review suggestions.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``
  )]];
  expect((await observe(suggestion))).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });

  const wrongAppNode = new FakeTransport();
  wrongAppNode.issueComments = [[botIssueComment(undefined, {
    performedViaGitHubApp: { id: 1144995, nodeId: 'A_wrong', slug: 'chatgpt-codex-connector' }
  })]];
  expect((await observe(wrongAppNode))).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });
});

test('second-page unresolved threads remain blocking when fresh or outdated', async () => {
  for (const isOutdated of [false, true]) {
    const transport = new FakeTransport();
    transport.issueComments = [[botIssueComment()]];
    transport.threads = [[], [{ id: 'T2', isResolved: false, isOutdated,
      path: 'old.ts', authorNodeIds: ['REVIEWER'] }]];
    expect((await observe(transport))).toMatchObject({ status: 'blocked', reason: 'unresolved-review-thread' });
  }
});

test('old-head REQUEST_CHANGES survives a new-head COMMENTED review and clean app verdict', async () => {
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
  expect((await observe(transport))).toMatchObject({ status: 'blocked', reason: 'request-changes-current' });

  transport.reviews[0]!.push({ id: 'R3', authorNodeId: 'REVIEWER', authorLogin: 'reviewer',
    authorType: 'User', appId: null,
    appNodeId: null, appSlug: null,
    commitSha: HEAD, state: 'APPROVED', submittedAt: '2026-08-09T14:00:30.000Z' });
  expect((await observe(transport)).status).toBe('clear');
});

test('formal trusted App COMMENTED suggestion cannot clear without an explicit clean REST verdict', async () => {
  const transport = new FakeTransport();
  transport.reviews = [[{ id: 'R-app', authorNodeId: BOT, authorLogin: 'codex-review[bot]',
    authorType: 'Bot',
    appId: 1144995, appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector',
    commitSha: HEAD, state: 'COMMENTED', submittedAt: '2026-08-09T14:00:00.000Z' }]];
  expect((await observe(transport))).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });
});

test('trusted Codex App activity is not Review authority without a prior exact-head SEC wake-up', async () => {
  const transport = new FakeTransport();
  transport.reviews = [[{ id: 'R-app', authorNodeId: BOT, authorLogin: 'codex-review[bot]',
    authorType: 'Bot',
    appId: 1144995, appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector',
    commitSha: HEAD, state: 'APPROVED', submittedAt: '2026-08-09T14:00:00.000Z' }]];
  const unbound = (await evaluateVerificationSessionReviewObservation(transport, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
    observedAt: '2026-08-09T14:01:00.000Z'
  }));
  expect(unbound).toMatchObject({ status: 'blocked', reason: 'review-provider-unbound-activation' });

  transport.issueComments = [[maintainerIssueComment((await defaultReviewWakeupBody()), '98', {
    createdAt: '2026-08-09T13:59:59.000Z'
  })]];
  expect((await evaluateVerificationSessionReviewObservation(transport, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
    observedAt: '2026-08-09T14:01:00.000Z'
  })).status).toBe('clear');

  transport.issueComments = [[maintainerIssueComment((await defaultReviewWakeupBody()), '97', {
    createdAt: '2026-08-09T14:00:01.000Z'
  })]];
  expect((await evaluateVerificationSessionReviewObservation(transport, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
    observedAt: '2026-08-09T14:01:00.000Z'
  }))).toMatchObject({ status: 'blocked', reason: 'review-provider-unbound-activation' });
});

test('private GitHub candidate projects immutable parents from the existing merge commit response', async () => {
  const parentShas = Object.freeze([BASE, '8'.repeat(40)]);
  const candidate = (await observePrivateMergedCandidate(parentShas));
  expect(candidate.mergeCommitParentShas).toEqual(parentShas);
  expect(Object.isFrozen(candidate.mergeCommitParentShas)).toBe(true);
  expect(Object.isFrozen(candidate)).toBe(true);
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

const privateGhProviderBoundaryCases = [
  ['candidate', 'not-a-candidate-tree-one\\n', 'not-a-candidate-tree-two\\n'],
  ['permission', 'unsupported-permission-one\\n', 'unsupported-permission-two\\n'],
  [
    'trusted-app',
    '{"id":1144994,"node_id":"A_kwHOAOQ6Gs4AEXij","slug":"chatgpt-codex-connector"}',
    '{"id":1144993,"node_id":"A_kwHOAOQ6Gs4AEXij","slug":"chatgpt-codex-connector"}'
  ],
  ['review-post-normalization', 'UNSUPPORTED_STATE_ONE', 'UNSUPPORTED_STATE_TWO'],
  ['thread-post-normalization', 'not-a-boolean-one', 'not-a-boolean-two'],
  ['request-post-normalization', 'a'.repeat(257), 'b'.repeat(258)],
  ['issue-post-normalization', 'duplicate-comment-body-one', 'duplicate-comment-body-two']
] as const;

for (const [mode, first, second] of privateGhProviderBoundaryCases) {
  test(`private HTTP ${mode} boundary binds distinct raw pages only into typed digests`, async () => {
    const left = (await observePrivateGhProviderBarrier(mode, first));
    const right = (await observePrivateGhProviderBarrier(mode, second));
    expect(left).toMatchObject({ status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
      reasonCode: 'github-provider-response-shape-unsupported' });
    expect(right).toMatchObject({ status: PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
      reasonCode: 'github-provider-response-shape-unsupported' });
    if (left.status !== PROVIDER_SCHEMA_UNSUPPORTED_STATUS
      || right.status !== PROVIDER_SCHEMA_UNSUPPORTED_STATUS) throw new Error('expected typed provider shape failure');
    expect(left.responseDigest).not.toBe(right.responseDigest);
    expect(JSON.stringify(left)).not.toContain(JSON.stringify(first).slice(1, -1));
    expect(JSON.stringify(right)).not.toContain(JSON.stringify(second).slice(1, -1));
  }, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);
}

test('V9 final Review semantics filter marker quotes, resolve formal App identity, and retain decisive opinions', async () => {
  const reviewRequestMarker = '<!-- sec-verification-session-review-request-v1 -->';
  const quotedMarker = new FakeTransport();
  quotedMarker.issueComments = [[
    botIssueComment(`Quoted for discussion: ${reviewRequestMarker}`, {
      id: '100', authorLogin: 'reviewer', authorId: 501, authorNodeId: 'REVIEWER',
      authorType: 'User', performedViaGitHubApp: null
    }),
    botIssueComment()
  ]];
  expect((await observe(quotedMarker)).status).toBe('clear');

  const retiredTrustedMarker = new FakeTransport();
  retiredTrustedMarker.issueComments = [[botIssueComment(reviewRequestMarker, {
    authorLogin: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login,
    authorId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.id,
    authorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId,
    authorType: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.type,
    performedViaGitHubApp: {
      id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id,
      nodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.nodeId,
      slug: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.slug
    }
  })]];
  expect((await observe(retiredTrustedMarker))).toMatchObject({ status: 'waiting',
    reason: 'exact-head-independent-review-missing' });

  const graphQlPage = (author: Record<string, unknown>) => [{ data: { repository: { pullRequest: {
    reviews: {
      nodes: [{ id: 'R-provider-app', state: 'APPROVED',
        submittedAt: '2026-08-09T14:00:00.000Z', commit: { oid: HEAD }, author }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  } } } }];
  let appResolutions = 0;
  const parsedApp = parseGitHubReviewPages({
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
  const resolvedWithDifferentRawBytes = parseGitHubReviewPages({
    source: graphQlPage({ __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/chatgpt-codex-connector' }),
    resolveApp: (slug) => ({ id: 1144995, node_id: 'A_kwHOAOQ6Gs4AEXij', slug,
      providerObservation: 'different-raw-response' })
  });
  expect(resolvedWithDifferentRawBytes.pageDigest).not.toBe(parsedApp.pageDigest);
  const formalApp = new FakeTransport();
  formalApp.reviews = [[...parsedApp.nodes]];
  const formalAuthority = (await observe(formalApp));
  expect(formalAuthority).toMatchObject({ status: 'clear',
    authority: { sourceTransport: 'github-graphql' } });
  if (formalAuthority.status !== 'clear') throw new Error('expected formal App approval');
  expect(() => assertGitHubReviewAuthorityObservation(formalAuthority)).toThrow(
    'Review receipt authority must be a live observation produced by the private GitHub adapter.'
  );
  const excluded = await evaluateVerificationSessionReviewObservation(formalApp, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set([BOT]), observedAt: '2026-08-09T14:01:00.000Z'
  });
  expect(excluded.status).toBe('waiting');

  expect(() => parseGitHubReviewPages({
    source: graphQlPage({ __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/not-the-trusted-app' }),
    resolveApp: () => ({ id: 1144995, node_id: 'A_kwHOAOQ6Gs4AEXij',
      slug: 'chatgpt-codex-connector' })
  })).toThrow(/actor path is ambiguous or drifted/i);
  expect(() => parseGitHubReviewPages({
    source: graphQlPage({ __typename: 'Bot', id: BOT, login: 'codex-review[bot]',
      resourcePath: '/apps/chatgpt-codex-connector' }),
    resolveApp: () => ({ id: 1144995, node_id: 'A_drifted', slug: 'chatgpt-codex-connector' })
  })).toThrow(/resolver identity drifted/i);
  let nonBotResolutions = 0;
  const nonBot = parseGitHubReviewPages({
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
  expect((await observe(approvalThenComment)).status).toBe('clear');

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
  expect((await observe(changesThenComment))).toMatchObject({ status: 'blocked',
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
  expect((await observe(dismissedApprovalDoesNotEraseEarlierChanges))).toMatchObject({ status: 'blocked',
    reason: 'request-changes-current' });
});

test('review observation rejects unknown state and detects provider head drift', async () => {
  const malformed = new FakeTransport();
  malformed.reviews = [[{ id: 'R-bad', authorNodeId: 'REVIEWER', authorLogin: 'reviewer',
    authorType: 'User',
    appId: null, appNodeId: null, appSlug: null, commitSha: HEAD, state: 'PENDING' as never,
    submittedAt: '2026-08-09T14:00:00.000Z' }]];
  expectTypedProviderSchemaUnsupported((await observe(malformed)));

  class DriftingTransport extends FakeTransport {
    reads = 0;
    override candidate(): GitHubCandidateObservation {
      const candidate = super.candidate();
      this.reads += 1;
      return this.reads === 1 ? candidate : { ...candidate, headSha: '3'.repeat(40) };
    }
  }
  const drift = new DriftingTransport();
  drift.issueComments = [[botIssueComment()]];
  expect((await observe(drift))).toMatchObject({ status: 'blocked', reason: 'review-observation-head-drift' });
});

test('candidate merge-parent observation rejects partial or malformed identity without imposing squash policy', async () => {
  class CandidateTransport extends FakeTransport {
    constructor(readonly observation: GitHubCandidateObservation) { super(); }
    override candidate(): GitHubCandidateObservation { return this.observation; }
  }
  const open = new FakeTransport().candidate();
  const merged = Object.freeze({
    ...open,
    state: 'MERGED' as const,
    mergeCommitSha: '9'.repeat(40),
    mergeCommitTreeSha: HEAD,
    mergeCommitMessage: 'provider-observed merge',
    mergeCommitParentShas: Object.freeze([BASE, '8'.repeat(40)])
  });
  expect(await observe(new CandidateTransport(merged))).toMatchObject({
    status: 'waiting', reason: 'exact-head-independent-review-missing'
  });

  for (const mergeCommitParentShas of [
    null,
    Object.freeze([BASE, BASE]),
    Object.freeze(['A'.repeat(40)])
  ] as const) {
    expectTypedProviderSchemaUnsupported((await observe(new CandidateTransport({
      ...merged,
      mergeCommitParentShas
    }))));
  }
});

test('same-principal same-timestamp conflicting reviews fail closed instead of opaque-id ordering', async () => {
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
  expectTypedProviderSchemaUnsupported((await observe(transport)));
});

test('GitHub observation accepts valid timestamps and repeated thread authors', async () => {
  const review = new FakeTransport();
  review.reviews = [[{
    id: 'R-rfc3339', authorNodeId: 'REVIEWER', authorLogin: 'reviewer', authorType: 'User',
    appId: null, appNodeId: null, appSlug: null, commitSha: HEAD,
    state: 'APPROVED', submittedAt: '2026-08-09T14:00:00Z'
  }]];
  expect((await observe(review)).status).toBe('clear');

  const repeatedAuthor = new FakeTransport();
  repeatedAuthor.issueComments = [[botIssueComment(undefined, {
    createdAt: '2026-08-09T14:00:00Z'
  })]];
  repeatedAuthor.threads = [[{
    id: 'T-repeated-author', isResolved: true, isOutdated: false, path: 'renamed.ts',
    authorNodeIds: ['REVIEWER', 'REVIEWER']
  }]];
  expect((await observe(repeatedAuthor)).status).toBe('clear');

  const workflow = new FakeTransport();
  workflow.workflowRuns = [[workflowRun({ updatedAt: '2026-08-09T14:00:00.1Z' })]];
  expect((await evaluateVerificationSessionWorkflowJoin(workflow, {
    repository: 'sec-platform/sec', prNumber: 42, sessionRevision: JOIN_SESSION,
    actionPlanDigest: JOIN_ACTION, baseSha: BASE, now: '2026-08-09T14:05:00Z'
  }))).toMatchObject({ status: 'joined', reason: 'active-run' });

});

test('V8 final Review P2 regressions preserve dotted paths and bind complete nested thread pagination', async () => {
  const changedPaths = async (paths: readonly string[]) => {
    const metadata = JSON.stringify({ number: 42, changed_files: paths.length,
      state: 'open', draft: false, base: { sha: BASE }, head: { sha: HEAD } });
    const inventory = parseGitHubPullRequestFileInventory({ repository: 'sec-platform/sec', prNumber: 42,
      beforeSource: metadata,
      pagesSource: JSON.stringify([paths.map((filename) => ({ filename, status: 'modified' }))]),
      afterSource: metadata });
    return (await evaluateVerificationSessionChangedPaths(
      { pullRequestFileInventory: () => inventory },
      { repository: 'sec-platform/sec', prNumber: 42, state: 'OPEN', draft: false,
        baseSha: BASE, headSha: HEAD }
    )).paths;
  };
  expect((await changedPaths(['docs/v1..v2.md', 'src/review...fixture.ts'])))
    .toEqual(['docs/v1..v2.md', 'src/review...fixture.ts']);
  for (const traversal of ['..', '../escape.ts', 'src/../escape.ts', 'src/a/../../escape.ts']) {
    await expect(changedPaths([traversal]), traversal).rejects.toThrow(/changed-path observation is invalid/i);
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
    parseGitHubReviewThreadPages({
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
  expect(() => parseGitHubReviewThreadPages({
    source: [outerPages[0]],
    readCommentPage: () => { throw new Error('must not read an inner page before outer completeness'); }
  })).toThrow(/thread pagination is incomplete/i);
});

test('V9 PR file inventory binds changed_files and fails closed at cap, incompleteness, or drift', async () => {
  const metadata = (changedFiles: number, baseSha = BASE, headSha = HEAD,
    state: 'open' | 'closed' = 'open', draft = false) => JSON.stringify({
    number: 42,
    changed_files: changedFiles,
    state,
    draft,
    base: { sha: baseSha },
    head: { sha: headSha }
  });
  const parse = (input: Partial<Parameters<typeof parseGitHubPullRequestFileInventory>[0]> = {}) =>
    parseGitHubPullRequestFileInventory({
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
  expect((await evaluateVerificationSessionChangedPaths(
    { pullRequestFileInventory: () => complete }, expected
  ))).toEqual(complete);

  const expectIdentityMismatch = async (
    inventory: ReturnType<typeof parseGitHubPullRequestFileInventory>
  ) => {
    await expect(evaluateVerificationSessionChangedPaths(
      { pullRequestFileInventory: () => inventory }, expected
    )).rejects.toThrow(/differs from the expected open candidate identity/i);
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
  ]) await expectIdentityMismatch(inventory);

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
  const census = (input: Partial<Parameters<typeof parseGitHubOpenPullRequestCensus>[0]> = {}) =>
    parseGitHubOpenPullRequestCensus({
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
  const files = (record: Record<string, unknown>) => parseGitHubPullRequestFileInventory({
    repository: 'sec-platform/sec', prNumber: 42, beforeSource: metadata,
    pagesSource: JSON.stringify([[record]]), afterSource: metadata
  });
  expect(files({ filename: 'src/copy.ts', previous_filename: 'src/source.ts', status: 'copied' }).paths)
    .toEqual(['src/copy.ts', 'src/source.ts']);
  expect(() => files({ filename: 'src/copy.ts', status: 'copied' }))
    .toThrow(/copied record has no previous_filename/i);
  expect(() => files({ filename: 'src/copy.ts', previous_filename: 'src/copy.ts', status: 'copied' }))
    .toThrow(/copied record does not change its filename/i);
});

test('V9 repository artifact census hydrates only live canonical Session-family summaries', async () => {
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
  const hydrated = (await evaluateGitHubRepositoryActionsArtifactInventory({
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
  }));
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
  const unrelatedOnly = (await evaluateGitHubRepositoryActionsArtifactInventory({
    repository: 'sec-platform/sec', source: thousandUnrelated,
    observeArtifact: () => { unrelatedHydrationCalls += 1; throw new Error('must not hydrate unrelated'); }
  }));
  expect(unrelatedOnly.artifacts).toEqual([]);
  expect(unrelatedHydrationCalls).toBe(0);

  const expectPreHydrationFailure = async (mutate: (pages: any[]) => void, message: RegExp) => {
    const pages = structuredClone(source);
    mutate(pages);
    let calls = 0;
    await expect((async () => (await evaluateGitHubRepositoryActionsArtifactInventory({
      repository: 'sec-platform/sec', source: pages,
      observeArtifact: () => { calls += 1; throw new Error('hydration must not start'); }
    })))()).rejects.toThrow(message);
    expect(calls).toBe(0);
  };
  await expectPreHydrationFailure((pages) => { pages[1].artifacts[1].id = 1001; }, /duplicate id/i);
  await expectPreHydrationFailure((pages) => { pages[1].total_count = 104; }, /total_count drifted/i);
  await expectPreHydrationFailure((pages) => { pages[1].artifacts[2].digest = 'sha256:bad'; }, /digest is malformed/i);
  await expectPreHydrationFailure((pages) => {
    pages[1].artifacts[1].name = `${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-confusable`;
  }, /malformed Session-family name/i);

  await expect((async () => (await evaluateGitHubRepositoryActionsArtifactInventory({
    repository: 'sec-platform/sec', source,
    observeArtifact: (entry) => ({ artifactId: entry.artifactId, artifactName: entry.artifactName,
      archiveDigest: null, workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
      runId: entry.expectedRunId!, runAttempt: entry.sessionRunAttempt!,
      eventName: 'repository_dispatch', actorNodeId: BOT, actorPermission: 'write', expired: false })
  })))()).rejects.toThrow(/hydration differs from its selected summary identity/i);
});

test('readable but noncanonical rulesets never become platform enforcement authority', async () => {
  const observation = await evaluatePlatformEnforcementObservation({
    repository: 'sec-platform/sec',
    readRulesets: () => ({
      defaultBranch: 'main',
      effectiveRules: [{
        type: 'required_status_checks',
        ruleset_id: 18533093,
        parameters: {
          required_status_checks: [{ context: 'CodeQL', integration_id: 57789 }],
          strict_required_status_checks_policy: false
        }
      }],
      detailedRulesets: [{
        id: 18533093,
        name: 'main-code-scanning',
        target: 'branch',
        source_type: 'Repository',
        source: 'sec-platform/sec',
        enforcement: 'active',
        bypass_actors: [],
        conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
        rules: [{ type: 'required_code_scanning', parameters: {} }]
      }]
    })
  });
  expect(observation).toMatchObject({
    status: 'unknown',
    reason: expect.stringContaining('Canonical MainAuthority ruleset proof failed')
  });
  expect(observation.rulesetDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('platform 403 is recorded as unavailable and never as no-bypass proof', async () => {
  const transport = new FakeTransport();
  const error = new Error('upgrade plan') as Error & { statusCode?: number };
  error.statusCode = 403;
  transport.rulesetError = error;
  const observation = (await evaluatePlatformEnforcementObservation({
    repository: 'sec-platform/sec', readRulesets: () => transport.repositoryRulesets()
  }));
  expect(observation.status).toBe('platform-enforcement-unavailable');
  expect(observation.reason).toContain('unavailable');
  expect(observation.rulesetDigest as SessionDigest).toMatch(/^sha256:/);
});

test('IssueDisposition post-main readback consumes the canonical exact MainHealth decision', () => {
  const common = {
    repository: 'sec-platform/sec', newMainSha: BASE, newMainTreeSha: HEAD,
    observedAt: '2026-08-09T14:00:00.000Z'
  };
  const dispatched = mainHealthCheck({ id: 8 });
  const single = compilePostMainIssueDispositionHealthReadback({ ...common, checks: [dispatched] });
  expect(single).toMatchObject({
    repository: common.repository, mainSha: common.newMainSha, mainTreeSha: common.newMainTreeSha,
    trustRevision: common.newMainSha, status: 'healthy', allowedLanes: ['ordinary'],
    producer: { sourceRunId: '7', sourceRef: `github-check-runs:${common.repository}@${BASE}` }
  });
  for (const checks of [
    [mainHealthCheck({ appId: 1 })],
    [mainHealthCheck({ appNodeId: 'forged-app-node' })],
    [mainHealthCheck({ workflowPath: '.github/workflows/forged.yml' })],
    [mainHealthCheck({ workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${HEAD}` })],
    [mainHealthCheck({ eventName: 'workflow_run' })],
    [mainHealthCheck({
      eventName: 'repository_dispatch',
      workflowRunDisplayTitle: CI_MAIN_HEALTH_POLICY.producer.runTitleFormats.repositoryDispatch
        .replace('<exact-main-sha>', BASE)
        .replace('<request-operation-id>', `sha256:${'a'.repeat(64)}`)
    })],
    [dispatched, mainHealthCheck({ id: 9 })],
    [mainHealthCheck({ conclusion: 'forged-terminal' })],
    [mainHealthCheck({ status: 'forged-status', conclusion: 'success' })],
    [mainHealthCheck({ eventName: 'push' })]
  ]) {
    expect(() => compilePostMainIssueDispositionHealthReadback({ ...common, checks }))
      .toThrow('canonical fresh healthy ordinary-only MainHealth');
  }
});









test('trusted-main preparation rejects candidate/dirty/boundary runtime proof', () => {
  const proof = { currentHeadSha: BASE, currentBranch: 'main', localDefaultSha: BASE, remoteDefaultSha: BASE,
    workingTreeClean: true, runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
  expect(() => assertTrustedMainRuntime({ ...proof, workingTreeClean: false }, BASE)).toThrow();
  expect(() => assertTrustedMainRuntime({ ...proof, currentBranch: 'feature' }, BASE)).toThrow();
  expect(() => assertTrustedMainRuntime({ ...proof, boundaryTargetsMatched: false }, BASE)).toThrow();
});

test('hosted exact-revision runtime permits only a detached exact trusted-main checkout', () => {
  const session = { baseSha: BASE, trustRevision: BASE } as VerificationSession;
  const detachedExact = { currentHeadSha: BASE, currentBranch: '', localDefaultSha: BASE, remoteDefaultSha: BASE,
    workingTreeClean: true, runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
  expect(() => assertTrustedExactRevisionRuntime(detachedExact, BASE)).not.toThrow();
  expect(() => assertTrustedRuntime(detachedExact, session)).not.toThrow();
  expect(() => assertTrustedMainRuntime(detachedExact, BASE)).toThrow();
  expect(() => assertTrustedExactRevisionRuntime({ ...detachedExact, currentHeadSha: HEAD }, BASE)).toThrow();
  expect(() => assertTrustedExactRevisionRuntime({ ...detachedExact, workingTreeClean: false }, BASE)).toThrow();
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
    snapshotDigest: createReviewSnapshotDigest(reviewSnapshotBase) };
  const reviewReceipt = createReviewStabilityReceipt({ stage: 'pre-merge', repository: 'sec-platform/sec',
    prNumber: 42, sessionRevision: PAGE, scopeAuthorizationRevision: PAGE,
    scopeAuthorizationReceiptDigest: PAGE, headSha: HEAD, headTreeSha: HEAD,
    policy: SEC_REVIEW_STABILITY_POLICY,
    principal: { kind: 'github-app', actorNodeId: BOT, appId: 1144995,
      appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' },
    independence: { candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR' },
    producer: { identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: `github-review-observer:sec-platform/sec:42:${HEAD}`,
      providerIdentity: 'github', candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY.trustedRevision,
      sourceTransport: 'github-graphql', sourceRunId: 'run-1', sourceRef: 'pull/42',
      sourceDigest: reviewSnapshot.snapshotDigest }, snapshot: reviewSnapshot,
    reviewedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z' });
  const closure = { markers, reviewReceipt, expectedTitle, expectedBaseSha: BASE } as const;
  const mergeCommitSha = '9'.repeat(40);
  const provider = parseHostedSynchronousSquashMergeResponse(JSON.stringify({
    sha: mergeCommitSha, merged: true, message: 'Pull Request successfully merged'
  }));
  expect(provider).toEqual({ sha: mergeCommitSha, merged: true,
    message: 'Pull Request successfully merged' });
  for (const response of [
    '',
    JSON.stringify({ sha: mergeCommitSha, merged: false, message: 'Merge queue required' }),
    JSON.stringify({ sha: 'not-a-sha', merged: true, message: 'merged' }),
    JSON.stringify({ sha: mergeCommitSha, merged: true })
  ]) expect(() => parseHostedSynchronousSquashMergeResponse(response)).toThrow();

  const queued: GitHubCandidateObservation = {
    repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
    isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE,
    baseTreeSha: BASE, headBranch: 'feat/example', headSha: HEAD, headTreeSha: HEAD,
    title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
    mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null,
    mergeCommitParentShas: null
  };
  expect(() => assertHostedSquashMergeCompletion({ candidate: queued,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha }))
    .toThrow(/merge-queue enqueue is not integration success/);
  const merged = { ...queued, state: 'MERGED' as const,
    mergeCommitSha, mergeCommitTreeSha: HEAD,
    mergeCommitParentShas: Object.freeze([BASE]),
    mergeCommitMessage: `${expectedTitle}\n\n${markers.join('\n')}\n${renderIndependentReviewTrailer(reviewReceipt)}` };
  expect(() => assertHostedSquashMergeCompletion({ candidate: merged,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).not.toThrow();
  expect(() => assertHostedSquashMergeCompletion({ candidate: merged,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: null })).not.toThrow();
  for (const mergeCommitParentShas of [
    null,
    Object.freeze([]),
    Object.freeze([BASE, '8'.repeat(40)]),
    Object.freeze(['8'.repeat(40)])
  ] as const) {
    expect(() => assertHostedSquashMergeCompletion({
      candidate: { ...merged, mergeCommitParentShas },
      expectedHeadSha: HEAD,
      expectedHeadTreeSha: HEAD,
      ...closure,
      providerMergeCommitSha: provider.sha
    })).toThrow(/squash merge parent does not equal the verified base/i);
  }
  expect(() => assertHostedSquashMergeCompletion({
    candidate: { ...merged, baseSha: '8'.repeat(40),
      mergeCommitParentShas: Object.freeze(['8'.repeat(40)]) },
    expectedHeadSha: HEAD,
    expectedHeadTreeSha: HEAD,
    ...closure,
    providerMergeCommitSha: provider.sha
  })).toThrow(/squash merge parent does not equal the verified base/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: queued,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: null })).toThrow(/not physically complete/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: merged,
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: '8'.repeat(40) })).toThrow(/provider response does not match/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: { ...merged, headSha: BASE },
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/mismatched head or merge tree/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: { ...merged, mergeCommitTreeSha: BASE },
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/mismatched head or merge tree/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: { ...merged, mergeCommitMessage: 'other' },
    expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/authorization markers/i);
});

test('OPEN candidate execution rejects remote-main drift even after authorization', () => {
  const session = { baseSha: BASE, trustRevision: BASE } as VerificationSession;
  const proof = { currentHeadSha: BASE, currentBranch: 'main', localDefaultSha: BASE,
    remoteDefaultSha: 'f'.repeat(40), workingTreeClean: true,
    runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
  expect(() => assertTrustedRuntime(proof, session, false))
    .toThrow(/trusted default revision TCB/);
  expect(() => assertTrustedRuntime({ ...proof, remoteDefaultSha: BASE }, session, false)).not.toThrow();
});

test('VerificationSession preparation never infers a hosted execution environment', () => {
  expect(() => prepareTrustedMainVerificationSession({} as never))
    .toThrow('VerificationSession preparation requires an explicit execution environment.');
});

test('VerificationSession rejects unknown or altered hosted profiles before preparing identities', () => {
  for (const executionEnvironment of [
    { ...CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT,
      executionEnvironmentRevision: 'unqualified-native-runtime' },
    { ...CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT,
      toolchainRevision: 'bun@0.0.0' }
  ]) {
    const input = { executionEnvironment } as never;
    expect(() => prepareTrustedMainVerificationSession(input))
      .toThrow(/hosted execution environment/);
  }
});

test('VerificationSession placement defaults local and rejects implicit hosted selection', async () => {
  expect(verificationSessionExecutionPlacement(undefined)).toBe('local');
  expect(verificationSessionExecutionPlacement('local')).toBe('local');
  expect(verificationSessionExecutionPlacement('hosted')).toBe('hosted');
  expect(() => verificationSessionExecutionPlacement('automatic')).toThrow(/local or hosted/);
  await expect(verificationSessionCli(['prepare', '--pr', '1', '--request-output', 'not-written.json',
    '--execution', 'automatic'], worktreePhysicalCloseoutOperations)).rejects.toThrow(/local or hosted/);
  await expect(verificationSessionCli(['prepare', '--pr', '1', '--request-output', 'not-written.json',
    '--execution', 'hosted', '--test-author-comment', '1'], worktreePhysicalCloseoutOperations)).rejects.toThrow(/requires local preparation/);
});

test('local preparation request cannot enter any hosted consumer or runtime state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-local-request-placement-'));
  const localRequest = createVerificationSessionLocalPreparationRequest(JOIN_REQUEST);
  try {
    expect(localRequest.executionPlacement).toBe('local');
    expect(localRequest.authorityStage).toBe('preparation-only');
    expect(localRequest.request).toEqual(JOIN_REQUEST);
    expect(() => parseVerificationSessionHostedRequest(JSON.stringify(localRequest)))
      .toThrow('Local preparation-only request cannot be consumed by a hosted operation.');
    // The old wire format remains an explicit hosted-only recovery format.
    expect(parseVerificationSessionHostedRequest(JSON.stringify(JOIN_REQUEST))).toEqual(JOIN_REQUEST);
    const requestPath = path.join(root, 'local-request.json');
    writeFileSync(requestPath, JSON.stringify(localRequest));
    const cliPath = path.resolve('src/bootstrap/development/closeout/verification-session-cli.ts');
    for (const command of ['status', 'resume', 'observe-hosted', 'prepare-hosted']) {
      const state = path.join(root, `${command}-state`);
      const cache = path.join(root, `${command}-cache`);
      const result = spawnSync(process.execPath, [cliPath, command, '--request', requestPath,
        ...(['status', 'resume'].includes(command) ? ['--execution', 'hosted'] : [])], {
        cwd: root,
        env: { ...process.env, SEC_STATE_HOME: state, SEC_CACHE_HOME: cache },
        encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Local preparation-only request cannot be consumed by a hosted operation.');
      expect(existsSync(state)).toBe(false);
      expect(existsSync(cache)).toBe(false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI rejects caller-provided authority artifacts', async () => {
  await expect(verificationSessionCli(['resume', '--request', 'request.json',
    '--artifact', 'forged.json'], worktreePhysicalCloseoutOperations)).rejects.toThrow(/Unknown argument for resume: --artifact/);
  await expect(verificationSessionCli(['resume', '--request', 'request.json',
    '--authorization', 'forged.json'], worktreePhysicalCloseoutOperations)).rejects.toThrow(/Unknown argument for resume: --authorization/);
  expect(() => parseHostedVerificationCommand(['integrate-hosted', '--repository', 'sec-platform/sec',
    '--output', 'projection.json', '--authorization', 'forged.json']))
    .toThrow(/Unknown argument for integrate-hosted: --authorization/);
  for (const command of ['prepare-integration-hosted', 'integrate-hosted',
    'closeout-mutate-hosted', 'closeout-publish-hosted']) {
    expect(() => parseHostedVerificationCommand([command, '--repository', 'sec-platform/sec',
      '--output', 'projection.json', '--artifact', 'caller.json']))
      .toThrow(new RegExp(`Unknown argument for ${command}: --artifact`));
  }
  await expect(executeHostedSessionCompilerCommand(['finalize-hosted', '--envelope', 'envelope.json', '--output',
    'artifact.json', '--evidence', 'evidence.json', '--previous-artifact', 'prior.json']))
    .rejects.toThrow(/exactly one of --evidence or --previous-artifact/);
});

test('expired hosted authority permits only independently revalidated Action Evidence reuse', () => {
  const artifact = {
    scopeAuthorization: { expiresAt: '2026-08-09T00:10:00.000Z' },
    preGateReview: { expiresAt: '2026-08-09T00:15:00.000Z' },
    mainHealth: { expiresAt: '2026-08-09T00:10:00.000Z' },
    evidence: { status: 'passed' }
  };
  expect(classifyVerificationSessionArtifactReuse(artifact as never, '2026-08-09T00:11:00.000Z')).toMatchObject({
    status: 'fresh-authority-required', actionEvidenceCandidate: true
  });
  expect(classifyVerificationSessionArtifactReuse({ ...artifact, evidence: { status: 'failed' } } as never,
    '2026-08-09T00:16:00.000Z')).toMatchObject({
      status: 'fresh-authority-required', actionEvidenceCandidate: true
    });
  for (const status of ['not-run', 'unsupported', 'invalidated'] as const) {
    expect(classifyVerificationSessionArtifactReuse({ ...artifact, evidence: { status } } as never,
      '2026-08-09T00:16:00.000Z')).toMatchObject({ status: 'not-reusable', actionEvidenceCandidate: false });
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
    expect(classifyDurableVerificationSessionProjection({ repository: 'sec-platform/sec',
      request: JOIN_REQUEST, candidate, publications: [] })).toMatchObject({ status: 'BLOCKED' });
  }
});

















test('incomplete GitHub pagination fails closed before Review can clear', async () => {
  class IncompletePaginationTransport extends FakeTransport {
    override reviewPage(): GitHubPage<GitHubReviewObservation> {
      return page([], true, null);
    }
  }
  const transport = new IncompletePaginationTransport();
  transport.issueComments = [[botIssueComment()]];
  expectTypedProviderSchemaUnsupported((await observe(transport)));
});

test('remote Session workflow join covers active and artifact-publication states without redispatch', async () => {
  const joined = async (transport: FakeTransport, now = '2026-08-09T14:05:00.000Z') =>
    (await evaluateVerificationSessionWorkflowJoin(transport, {
      repository: 'sec-platform/sec', prNumber: 42, sessionRevision: JOIN_SESSION,
      actionPlanDigest: JOIN_ACTION, baseSha: BASE, now
    }));
  for (const status of ['queued', 'in_progress', 'waiting'] as const) {
    const transport = new FakeTransport();
    transport.workflowRuns = [[workflowRun({ status })]];
    expect((await joined(transport))).toMatchObject({ status: 'joined', reason: 'active-run' });
  }
  const completed = new FakeTransport();
  completed.workflowRuns = [[workflowRun({ status: 'completed', conclusion: 'success' })]];
  expect((await joined(completed))).toMatchObject({ status: 'joined', reason: 'artifact-publication-window' });

  for (const conclusion of ['failure', 'cancelled'] as const) {
    const terminal = new FakeTransport();
    terminal.workflowRuns = [[workflowRun({ status: 'completed', conclusion })]];
    expect((await joined(terminal))).toMatchObject({ status: 'redispatch-eligible', reason: 'terminal-run' });
  }
  expect((await joined(completed, '2026-08-09T14:11:00.001Z'))).toMatchObject({
    status: 'redispatch-eligible', reason: 'artifact-publication-window-expired'
  });
});

test('hosted compiler distinguishes exact external Session and proposal-only internal Action dispatches', () => {
  expect(assertHostedCompilerDispatchPayload({ action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    clientPayload: { payload: JOIN_REQUEST }, request: JOIN_REQUEST })).toEqual({ kind: 'external-session' });
  const proposedActionKey = `sha256:${'8'.repeat(64)}` as const;
  const proposal = createCiVerificationActionProposal({
    sessionRequest: { ...JOIN_REQUEST }, proposedActionKey
  });
  const parentPlan = createCiVerificationActionParentDispatchPlan({
    repositoryId: '123', repository: 'sec-platform/sec', parentRunId: '100', parentRunAttempt: 1,
    parentJobId: '150',
    parentWorkflowRef: 'sec-platform/sec/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
    parentWorkflowSha: BASE,
    parentActor: { login: 'integrator', id: 101, nodeId: 'INTEGRATOR', type: 'User', permission: 'maintain' },
    proposals: [proposal]
  });
  const envelope = createCiVerificationActionProviderEnvelope({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '500', parentDispatchPlanArchiveDigest: PAGE });
  expect(assertHostedCompilerDispatchPayload({ action: 'sec-produce-verification-action-v2',
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
    expect(() => assertHostedCompilerDispatchPayload({ action, clientPayload,
      request: JOIN_REQUEST }), label).toThrow();
  }
  expect(() => assertHostedCompilerDispatchPayload({ action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    clientPayload: JOIN_REQUEST, request: JOIN_REQUEST })).toThrow();
  expect(() => assertHostedCompilerDispatchPayload({ action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    clientPayload: { payload: { ...JOIN_REQUEST, proposedActionKey } }, request: JOIN_REQUEST }))
    .toThrow('external Session payload differs');
});

test('internal Action child binds Actions bot/App and exact parent run/artifact/member provenance', () => {
  const proposedActionKey = `sha256:${'8'.repeat(64)}` as const;
  const proposal = createCiVerificationActionProposal({ sessionRequest: { ...JOIN_REQUEST },
    proposedActionKey });
  const parentActor = { login: 'integrator', id: 101, nodeId: 'INTEGRATOR',
    type: 'User' as const, permission: 'maintain' as const };
  const parentPlan = createCiVerificationActionParentDispatchPlan({
    repositoryId: '123', repository: 'sec-platform/sec', parentRunId: '100', parentRunAttempt: 1,
    parentJobId: '150',
    parentWorkflowRef: 'sec-platform/sec/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
    parentWorkflowSha: BASE, parentActor, proposals: [proposal]
  });
  const envelope = createCiVerificationActionProviderEnvelope({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '500', parentDispatchPlanArchiveDigest: PAGE });
  const parentPlanSource = `${encodeVerificationActionData(parentPlan)}\n`;
  expect(ciVerificationActionParentDispatchPlanPayloadDigest(parentPlan))
    .toBe(envelope.parentDispatchPlanPayloadDigest);
  const artifact: GitHubActionsArtifactObservation = {
    artifactId: '500', artifactName: envelope.parentDispatchPlanArtifactName,
    archiveDigest: PAGE, workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
    runId: '100', runAttempt: 1, eventName: 'repository_dispatch',
    actorNodeId: 'INTEGRATOR', actorPermission: 'maintain', expired: false
  };
  const bot = CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot;
  const app = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  const botRecord = { login: bot.login, id: bot.id, node_id: bot.nodeId, type: bot.type };
  const currentRun = { id: 200, run_attempt: 1, workflow_id: 300, check_suite_id: 400,
    event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
    head_sha: BASE, head_branch: 'main', name: `produce Action ${proposedActionKey}`,
    display_title: `produce Action ${proposedActionKey}`, actor: botRecord,
    repository: { id: 123, full_name: 'sec-platform/sec' } };
  const currentWorkflow = { id: 300, path: '.github/workflows/compiler-pr-validation.yml',
    state: 'active' };
  const currentCheckSuite = { id: 400, head_sha: BASE,
    repository: { id: 123, full_name: 'sec-platform/sec' },
    app: { id: app.id, node_id: app.nodeId, slug: app.slug } };
  const parentRun = { id: 100, run_attempt: 1, event: 'repository_dispatch',
    path: '.github/workflows/compiler-pr-validation.yml', head_sha: BASE, head_branch: 'main',
    name: `verify session PR #42 session ${JOIN_SESSION}`,
    display_title: `verify session PR #42 session ${JOIN_SESSION}`,
    actor: { login: parentActor.login, id: parentActor.id, node_id: parentActor.nodeId,
      type: parentActor.type }, repository: { id: 123, full_name: 'sec-platform/sec' } };
  const parentPrincipal = { login: parentActor.login, nodeId: parentActor.nodeId,
    permission: parentActor.permission };
  const parentJob: GitHubWorkflowJobObservation = {
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
  expect(assertHostedCompilerInternalProvenance(input)).toMatchObject({
    parentActorNodeId: 'INTEGRATOR',
    parentPlan: { parentDispatchPlanDigest: parentPlan.parentDispatchPlanDigest }
  });

  for (const [label, delta] of [
    ['human child sender', { eventSender: parentRun.actor }],
    ['human child run actor', { currentRun: { ...currentRun, actor: parentRun.actor } }],
    ['rerun child attempt', { currentRun: { ...currentRun, run_attempt: 2 } }],
    ['wrong child workflow path', { currentRun: { ...currentRun, path: '.github/workflows/foreign.yml' } }],
    ['wrong child display title', { currentRun: { ...currentRun, display_title: 'foreign Action' } }],
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
    ['wrong parent workflow path', { parentRun: { ...parentRun,
      path: '.github/workflows/foreign.yml' } }],
    ['membership drift', { parentPrincipal: { ...parentPrincipal, permission: 'write' as const } }],
    ['noncanonical parent bytes', { parentPlanSource: `${parentPlanSource} ` }]
  ] as const) {
    expect(() => assertHostedCompilerInternalProvenance({ ...input, ...delta }), label).toThrow();
  }
});

test('an empty Session workflow inventory is eligible for redispatch', async () => {
  const transport = new FakeTransport();
  expect((await evaluateVerificationSessionWorkflowJoin(transport, {
    repository: 'sec-platform/sec', prNumber: 42, sessionRevision: JOIN_SESSION,
    actionPlanDigest: JOIN_ACTION, baseSha: BASE, now: '2026-08-09T14:05:00.000Z'
  })).status).toBe('redispatch-eligible');
});

test('Session workflow join uses complete pages and rejects duplicate/conflicting inventory', async () => {
  const adapterInput = { repository: 'sec-platform/sec', prNumber: 42,
    sessionRevision: JOIN_SESSION, actionPlanDigest: JOIN_ACTION, baseSha: BASE,
    now: '2026-08-09T14:05:00.000Z' } as const;
  const paged = new FakeTransport();
  paged.workflowRuns = [[], [workflowRun({ id: '9' })]];
  expect((await evaluateVerificationSessionWorkflowJoin(paged, adapterInput)))
    .toMatchObject({ status: 'joined', runIds: ['9:1'] });

  const providerPresentationName = new FakeTransport();
  providerPresentationName.workflowRuns = [[workflowRun({ name: 'mutable provider presentation' })]];
  expect((await evaluateVerificationSessionWorkflowJoin(providerPresentationName, adapterInput)))
    .toMatchObject({ status: 'joined', runIds: ['10:1'] });

  const duplicate = new FakeTransport();
  duplicate.workflowRuns = [[workflowRun()], [workflowRun({ status: 'waiting' })]];
  await expect((async () => (await evaluateVerificationSessionWorkflowJoin(duplicate, adapterInput)))()).rejects
    .toThrow(/duplicate run\/attempt/i);

  const conflict = new FakeTransport();
  conflict.workflowRuns = [[workflowRun({ displayTitle:
    `verify session PR #42 session ${JOIN_SESSION} action sha256:${'8'.repeat(64)}` })]];
  await expect((async () => (await evaluateVerificationSessionWorkflowJoin(conflict, adapterInput)))()).rejects
    .toThrow(/conflicting run identity/i);

  const wrongWorkflow = new FakeTransport();
  wrongWorkflow.workflowRuns = [[workflowRun({ workflowPath: '.github/workflows/foreign.yml' })]];
  await expect((async () => (await evaluateVerificationSessionWorkflowJoin(wrongWorkflow, adapterInput)))()).rejects
    .toThrow(/conflicting run identity/i);

  class IncompleteWorkflowPaginationTransport extends FakeTransport {
    override workflowRunPage(): GitHubPage<GitHubWorkflowRunObservation> {
      return page([], true, null);
    }
  }
  await expect((async () => (await evaluateVerificationSessionWorkflowJoin(
    new IncompleteWorkflowPaginationTransport(), adapterInput
  )))()).rejects.toThrow(/pagination.*did not advance/i);
});

afterAll(() => {
  settleResources({ cleanup: [
    { label: 'exact-test-impact-fixture', settle: () => testImpactFixture?.dispose() },
    { label: 'private-credential-shim-root', settle: () => sessionFixture.dispose() }
  ] });
});

test('prepared cleanup route never calls a local consumer for foreign observations', async () => {
  const calls: string[] = [];
  const foreign = await routePreparedWorktreeCleanupAttempt({
    foreignWorktreeObservationDigests: [PAGE],
    targetCount: 1,
    consumeLocalPreparedTargets: async () => {
      calls.push('physical');
      return ['unreachable'];
    }
  });
  expect(foreign).toEqual([]);
  expect(calls).toEqual([]);

  const noTarget = await routePreparedWorktreeCleanupAttempt({
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
  const tokens = await routePreparedWorktreeCleanupAttempt({
    foreignWorktreeObservationDigests: [],
    targetCount: 2,
    consumeLocalPreparedTargets: async () => {
      calls.push('prepare', 'execute', 'assert');
      return ['opaque-one', 'opaque-two'];
    }
  });
  expect(calls).toEqual(['prepare', 'execute', 'assert']);
  expect(tokens).toEqual(['opaque-one', 'opaque-two']);
  await expect(routePreparedWorktreeCleanupAttempt({
    foreignWorktreeObservationDigests: [],
    targetCount: 2,
    consumeLocalPreparedTargets: async () => ['one']
  })).rejects.toThrow('same-host-worktree-closeout-required');
});

















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
    const payload = { schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
      preparation: prepared, before, attempts: [...attempts], foreignWorktreeObservations: [] };
    return parsePreparedBranchCloseoutEnvelope(`${JSON.stringify({ ...payload,
      envelopeDigest: branchLifecycleDigest(payload) }, null, 2)}\n`);
  };
  const remote = envelope(remotePreparation, remoteBefore,
    [{ operation: 'recovery-verify', status: 'success', detail: 'provider verified' }]);
  const local = envelope(localPreparation, localBefore,
    [{ operation: 'recovery-verify', status: 'success', detail: 'runner verified' }]);
  const rehydrated = rehydratePreparedBranchCloseoutEnvelope({ remote, local });
  expect(rehydrated.before).toEqual(remoteBefore);
  expect(rehydrated.before).not.toEqual(localBefore);
  expect(rehydrated.preparation.repository.root).toBe(localRoot);
  expect(rehydrated.preparation.recovery.path).toBe(localRecoveryPath);
  expect(rehydrated.preparation.worktreePathsAtPreparation).toEqual([]);
  expect(rehydrated.foreignWorktreeObservations).toHaveLength(1);
  expect(JSON.stringify(rehydrated.foreignWorktreeObservations)).not.toContain(JSON.stringify(remoteWorktreePath).slice(1, -1));
  expect(rehydrated.attempts).toEqual(local.attempts);
  expect(rehydrated.preparation.preparationDigest).toBe(remotePreparation.preparationDigest);
  const authorization = authorizeBranchCloseout({
    preparation: rehydrated.preparation,
    request: { capability: BRANCH_REF_CLOSEOUT_CAPABILITY, disposition: 'merged',
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

test('GitHub GraphQL schema drift is classified as typed provider-schema-unsupported', () => {
  const observed = "gh: Field 'id' doesn't exist on type 'Actor'";
  const failure = classifyGitHubGraphQLSchemaFailure(observed);
  expect(failure).not.toBeNull();
  expect(failure!.status).toBe(PROVIDER_SCHEMA_UNSUPPORTED_STATUS);
  expect(failure!.reasonCode).toBe('github-graphql-schema-unsupported');
  expect(failure!.responseDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(isGitHubProviderSchemaUnsupportedError(Object.assign(
    new Error('x'),
    { code: PROVIDER_SCHEMA_UNSUPPORTED_STATUS, reasonCode: 'r', responseDigest: failure!.responseDigest }
  ))).toBe(false);
  expect(classifyGitHubGraphQLSchemaFailure('HTTP 403: Resource not accessible')).toBeNull();
});

test('the implementation session cannot issue an independent Review receipt', async () => {
  const { SEC_REVIEW_STABILITY_POLICY: SEC_REVIEW_STABILITY_POLICY_V1, createReviewStabilityReceipt: createReviewStabilityReceiptV1 } =
    await import('../../../src/adapters/verification/platform/review/contract/stability.ts');
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
    snapshotDigest: createReviewSnapshotDigest(snapshotValue)
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
        identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
        executionIdentity: SEC_VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY,
        providerIdentity: 'github',
        candidateWriteCapability: 'read-only',
        capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
        trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
        sourceTransport: 'github-graphql',
        sourceRunId: 'run-1',
        sourceRef: 'pull/345',
        sourceDigest: snapshot.snapshotDigest
      }
    }))
    .toThrow('canonical independent read-only observer execution');
});


// Only these registrations consume the exact repository TestImpact provider.
// Keep its canonical setup/settlement budget outside each 30s case body.
describe('qualified exact-repository Session consumers', () => {
  beforeAll(async () => {
    testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture();
    TEST_IMPACT_SOURCE_PROVIDER = bindDocumentationVerificationGateInput(
      testImpactFixture.provider, currentDocumentationVerificationBaseline());
  }, DEFAULT_TEST_TIMEOUT_MS);

  test('trusted-main proposal and hosted sole issuer reconstruct the same stable Session revision', async () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const barrier = (await observe(transport));
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const candidate = transport.candidate();
  const changedPaths = ['src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const testImpactTransition = changedTransition(changedPaths);
  const manifestDigest = `sha256:${'b'.repeat(64)}` as const;
  const local = prepareTrustedMainVerificationSession({ executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER, profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: 'local-preparation',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: barrier.observedAt, reviewBarrier: barrier,
    mainHealthChecks: [mainHealthCheck()], dependencyBlobs: actionDependencyBlobs() });
  const facts = reconstructVerificationSessionHostedFacts({ request: local.request,
    repository: candidate.repository, candidate, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '901',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, observedAt: barrier.observedAt,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs() });
  expect(local.facts?.scopeIssuer.sourceRunId).toBe('local-preparation');
  expect(facts.scopeIssuer.sourceRunId).toBe('901');
  for (const health of [local.facts?.mainHealth, facts.mainHealth]) {
    expect(health?.producer).toMatchObject({
      sourceRunId: '7', sourceRef: `github-check-runs:${candidate.repository}@${BASE}`
    });
  }
  const pureHosted = createPureHostedEnvelopeFixture({ request: local.request, facts });
  expect(pureHosted.session.sessionRevision).toBe(local.sessionRevision);
  expect(pureHosted.scopeAuthorization.authorizationRevision).toBe(local.scopeAuthorizationRevision);
  expect(pureHosted.actionPlanClosure.actionPlanDigest).toBe(local.actionPlanClosure.actionPlanDigest);
  expect(() => prepareVerificationSessionHosted({ request: local.request,
    facts: JSON.parse(JSON.stringify(facts)) })).toThrow('live observation produced by the private GitHub adapter');
  const dependencyPaths = new Set<string>(CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS);
  for (const action of pureHosted.actionPlanClosure.actions) {
    expect(action.action.inputClosure.filter(({ path: inputPath }) =>
      dependencyPaths.has(inputPath))).toHaveLength(4);
  }
  expect(() => prepareTrustedMainVerificationSession({ executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER, profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: 'local-preparation',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: barrier.observedAt, reviewBarrier: barrier,
    mainHealthChecks: [mainHealthCheck()], dependencyBlobs: actionDependencyBlobs('bun.lock') }))
    .toThrow(/bun\.lock drifted from the trusted base/i);
  expect(() => reconstructVerificationSessionHostedFacts({ request: local.request,
    repository: candidate.repository, candidate, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '901',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, observedAt: barrier.observedAt,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs('package.json') }))
    .toThrow(/package\.json drifted from the trusted base/i);
});

  test('VerificationSession preserves the selected environment through Scope, Action, Session, and hosted reconstruction', async () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const barrier = await observe(transport);
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const candidate = transport.candidate();
  const changedPaths = ['src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const testImpactTransition = changedTransition(changedPaths);
  const common = {
    repository: candidate.repository, candidate, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: 'environment-preparation', sourceRef: `refs/heads/main@${BASE}`,
    observedAt: barrier.observedAt, reviewBarrier: barrier,
    mainHealthChecks: [mainHealthCheck()], dependencyBlobs: actionDependencyBlobs()
  };
  const environments = [
    CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
    CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT,
    createCiVerificationLocalExecutionEnvironment({ os: 'linux', arch: 'x64', bunVersion: '1.4.0' })
  ];
  const preparations = environments.map((executionEnvironment) => {
    const prepared = prepareTrustedMainVerificationSession({
      ...common, executionEnvironment,
      manifestPath: 'config/repository/work-packages/example.md',
      manifestDigest: `sha256:${'b'.repeat(64)}`, profile: 'quick'
    });
    if (prepared.facts === null) throw new Error('expected clear-review preparation facts');
    expect(prepared.actionPlanClosure.actions.length).toBeGreaterThan(0);
    for (const { action } of prepared.actionPlanClosure.actions) {
      expect(action.environment.providerRevision).toBe(executionEnvironment.executionEnvironmentRevision);
      expect(action.environment.toolchainRevision).toBe(executionEnvironment.toolchainRevision);
    }
    expect(prepared.request.expectedSessionRevision).toBe(prepared.sessionRevision);
    expect(prepared.request.expectedActionPlanDigest).toBe(prepared.actionPlanClosure.actionPlanDigest);
    if (executionEnvironment.kind === 'hosted') {
      const reconstructed = reconstructVerificationSessionHostedFacts({
        ...common, request: prepared.request
      });
      expect(reconstructed.environmentDigest).toBe(prepared.facts.environmentDigest);
      expect(reconstructed.actionPlanClosure.actionPlanDigest).toBe(prepared.actionPlanClosure.actionPlanDigest);
      expect(() => reconstructVerificationSessionHostedFacts({
        ...common, request: { ...prepared.request, expectedScopeProposalDigest: `sha256:${'f'.repeat(64)}` }
      })).toThrow('Scope proposal digest must select exactly one closed hosted environment');
    } else {
      expect(() => reconstructVerificationSessionHostedFacts({
        ...common, request: prepared.request
      })).toThrow('Scope proposal digest must select exactly one closed hosted environment');
    }
    return prepared;
  });
  // Changing only the selected environment must invalidate every dependent identity.
  for (const identities of [
    preparations.map((value) => value.facts?.environmentDigest),
    preparations.map((value) => value.scopeAuthorizationRevision),
    preparations.map((value) => value.actionPlanClosure.actionPlanDigest),
    preparations.map((value) => value.sessionRevision),
    preparations.map((value) => value.request.requestOperationId)
  ]) expect(new Set(identities).size).toBe(environments.length);
  for (const [index, { action }] of preparations[0]!.actionPlanClosure.actions.entries()) {
    expect(new Set(preparations.map((value) =>
      value.actionPlanClosure.actions[index]!.action.actionKey)).size).toBe(environments.length);
    expect(preparations.every((value) =>
      value.actionPlanClosure.actions[index]!.action.operation.identity === action.operation.identity)).toBe(true);
  }
});

  test('VerificationSession binds the exact deletion transition through Scope, Action, Session, and hosted reconstruction', async () => {
  const baseSha = '9ed0291a0b51b4f3f6769ab317c4cc1a2753cb4b';
  const headSha = 'b'.repeat(40);
  const retiredPath = 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
  const unownedRetiredPath =
    'docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json';
  const changedPaths = [retiredPath, 'src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const records = [
    { status: 'changed' as const, path: 'src/adapters/verification/platform/ci/runtime/verification-session.ts' },
    { status: 'removed' as const, path: retiredPath }
  ];
  const readPathBlob = (revision: string, repositoryPath: string) => (
    revision === baseSha && repositoryPath === retiredPath
      ? { mode: '100644' as const, blobSha: '3fbfa041119f70429b5f6cc4440816b50ab3a0ef' }
      : null
  );
  const testImpactTransition = CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha, headSha, records, readPathBlob
  });
  const reordered = CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha, headSha, records: [...records].reverse(), readPathBlob
  });
  expect(CodexDevelopmentTestImpactTransitionDigest(reordered))
    .toBe(CodexDevelopmentTestImpactTransitionDigest(testImpactTransition));

  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const candidate = Object.freeze({
    ...transport.candidate(),
    baseSha,
    baseTreeSha: 'c'.repeat(40),
    headSha,
    headTreeSha: 'd'.repeat(40)
  });
  const barrier = await observe(transport);
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const mainHealthChecks = [mainHealthCheck({
    headSha: baseSha,
    workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${baseSha}`
  })];
  const manifestDigest = `sha256:${'e'.repeat(64)}` as const;
  const unownedTransition = CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: [{ status: 'removed', path: unownedRetiredPath }],
    readPathBlob: (revision, repositoryPath) => (
      revision === baseSha && repositoryPath === unownedRetiredPath
        ? { mode: '100644', blobSha: '4'.repeat(40) }
        : null
    )
  });
  expect(() => prepareTrustedMainVerificationSession({ executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
    repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest,
    changedPaths: [unownedRetiredPath], testImpactTransition: unownedTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: 'unowned-deletion-prepare', sourceRef: `refs/heads/main@${baseSha}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks,
    dependencyBlobs: actionDependencyBlobs()
  })).toThrow(/verification plan is unresolved/i);
  const prepared = prepareTrustedMainVerificationSession({ executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
    repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest,
    changedPaths, testImpactTransition, testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: 'deletion-prepare', sourceRef: `refs/heads/main@${baseSha}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks,
    dependencyBlobs: actionDependencyBlobs()
  });
  const facts = reconstructVerificationSessionHostedFacts({
    request: prepared.request, repository: candidate.repository, candidate, changedPaths,
    testImpactTransition: reordered, testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: 'deletion-hosted',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${baseSha}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks,
    dependencyBlobs: actionDependencyBlobs()
  });
  expect(facts.testImpactTransitionDigest).toBe(prepared.testImpactTransitionDigest);
  expect(facts.sessionProposalDigest).toBe(prepared.sessionProposalDigest);
  expect(facts.actionPlanClosure.actionPlanDigest).toBe(prepared.actionPlanClosure.actionPlanDigest);
  const localQuick = prepareLocalQuickVerificationActionPlan({
    candidate,
    manifestPath: 'config/repository/work-packages/example.md',
    manifestDigest,
    changedPaths,
    testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    expectedTestImpactTransitionDigest: prepared.testImpactTransitionDigest,
    scopeAuthorizationRevision: prepared.scopeAuthorizationRevision,
    executionEnvironment: createCiVerificationLocalExecutionEnvironment({
      os: process.platform, arch: process.arch, bunVersion: Bun.version
    }),
    dependencyBlobs: actionDependencyBlobs()
  });
  expect(localQuick.actions.length).toBeGreaterThan(0);
  expect(() => reconstructVerificationSessionHostedFacts({
    request: prepared.request, repository: candidate.repository, candidate, changedPaths,
    testImpactTransition: { ...testImpactTransition, headSha: 'f'.repeat(40) },
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: 'deletion-hosted',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${baseSha}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks,
    dependencyBlobs: actionDependencyBlobs()
  })).toThrow(/exact candidate selection input/i);
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('same paths with a different Git transition change the complete VerificationSession identity chain', async () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const barrier = (await observe(transport));
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const candidate = transport.candidate();
  const changedPaths = ['src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const prepare = (status: 'added' | 'changed') => prepareTrustedMainVerificationSession({ executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
    repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest: `sha256:${'e'.repeat(64)}`,
    changedPaths,
    testImpactTransition: CodexDevelopmentCreateTestImpactTransitionObservation({
      baseSha: candidate.baseSha, headSha: candidate.headSha,
      records: [{ status, path: changedPaths[0]! }], readPathBlob: () => null
    }),
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    profile: 'quick', integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '7',
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

  test('Session local quick DAG keeps durable journals in external Runtime State and executes exact detached candidate', async () => {
  const authorityRoot = mkdtempSync(path.join(tmpdir(), 'sec-session-authority-'));
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), 'sec-session-runtime-'));
  const runtimeStateRoot = path.join(runtimeRoot, 'state');
  const runtimeCacheRoot = path.join(runtimeRoot, 'cache');
  const priorStateHome = process.env.SEC_STATE_HOME;
  const priorCacheHome = process.env.SEC_CACHE_HOME;
  process.env.SEC_STATE_HOME = runtimeStateRoot;
  process.env.SEC_CACHE_HOME = runtimeCacheRoot;
  const runGit = (cwd: string, args: readonly string[]): string => {
    const result = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      env: createBranchLifecycleGitChildEnvironment(process.env),
      windowsHide: true
    });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const inspectRepository = (repositoryRoot: string) => ({
    headSha: runGit(repositoryRoot, ['rev-parse', 'HEAD']),
    headTreeSha: runGit(repositoryRoot, ['rev-parse', 'HEAD^{tree}']),
    trackedClean:
      runGit(repositoryRoot, ['diff', '--name-only', '--ignore-cr-at-eol']) === ''
      && runGit(repositoryRoot, ['diff', '--cached', '--name-only', '--ignore-cr-at-eol']) === ''
      && runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard']) === '',
    gitCommonDirectory: realpathSync.native(runGit(repositoryRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]))
  });
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
    const executionEnvironment = createCiVerificationLocalExecutionEnvironment({
      os: process.platform, arch: process.arch, bunVersion: Bun.version
    });
    const testImpactTransition = changedTransition(
      ['src/adapters/verification/platform/ci/runtime/verification-session.ts'],
      baseSha,
      headSha
    );
    const testImpactTransitionDigest = CodexDevelopmentTestImpactTransitionDigest(testImpactTransition);
    const closure = prepareLocalQuickVerificationActionPlan({ candidate,
      manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v6.md',
      manifestDigest: `sha256:${'9'.repeat(64)}`, changedPaths: ['src/adapters/verification/platform/ci/runtime/verification-session.ts'],
      testImpactTransition,
      testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
      expectedTestImpactTransitionDigest: testImpactTransitionDigest,
      scopeAuthorizationRevision: `sha256:${'8'.repeat(64)}`, executionEnvironment,
      dependencyBlobs: actionDependencyBlobs() });
    expect(() => prepareLocalQuickVerificationActionPlan({ candidate,
      manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v6.md',
      manifestDigest: `sha256:${'9'.repeat(64)}`, changedPaths: ['src/adapters/verification/platform/ci/runtime/verification-session.ts'],
      testImpactTransition,
      testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
      expectedTestImpactTransitionDigest: testImpactTransitionDigest,
      scopeAuthorizationRevision: `sha256:${'8'.repeat(64)}`, executionEnvironment,
      dependencyBlobs: actionDependencyBlobs('.bun-version') }))
      .toThrow(/\.bun-version drifted from the trusted base/i);
    const result = await executeLocalVerificationActionDag({ authorityRoot, candidateRoot,
      actionPlanClosure: closure, executionEnvironment,
      inspectRepository,
      testProcessIssuer: VERIFICATION_ACTION_TEST_PROCESS_ISSUER,
      testProcessProvider: (_operation, process) =>
        runRetainedBunTestProcess(process, candidateRoot) });
    expect(result.status).toBe('passed');
    expect(result.actionPlanDigest).toBe(closure.actionPlanDigest);
    expect(result.actionResults.every((entry) => entry.terminal?.status === 'passed')).toBe(true);
    expect(existsSync(path.join(runtimeStateRoot, 'workspaces', 'v1'))).toBe(true);
    expect(existsSync(path.join(authorityRoot, '.tmp', 'codex', 'verification-actions', 'v2'))).toBe(false);
    expect(existsSync(path.join(candidateRoot, '.tmp', 'codex', 'verification-actions', 'v2'))).toBe(false);
    expect(runGit(candidateRoot, ['rev-parse', 'HEAD'])).toBe(headSha);
    expect(runGit(candidateRoot, ['rev-parse', 'HEAD^{tree}'])).toBe(headTreeSha);
    expect(runGit(candidateRoot, ['status', '--porcelain=v1', '--untracked-files=no'])).toBe('');
  } finally {
    if (priorStateHome === undefined) delete process.env.SEC_STATE_HOME;
    else process.env.SEC_STATE_HOME = priorStateHome;
    if (priorCacheHome === undefined) delete process.env.SEC_CACHE_HOME;
    else process.env.SEC_CACHE_HOME = priorCacheHome;
    rmSync(authorityRoot, { recursive: true, force: true });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('actual reducer recovers a crash after remote merge without a second merge or publication', async () => {
  const fixture = (await reducerFixture());
  try {
    expect((await runReducer(fixture))).toMatchObject({ status: 'READY_TO_INTEGRATE',
      operationId: fixture.result.authorization.consumptionOperationId });
    // Models process loss after the remote merge but before any local journal
    // transition. The reducer adopts the exact remote marker and never owns a
    // raw merge capability that could repeat the effect.
    fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
      fixture.artifact.session.sessionRevision);
    expect((await runReducer(fixture))).toMatchObject({ status: 'COMPLETED', completedStage: 'closeout-terminal' });
    const observed = fixture.counters.closeoutObserve;
    expect((await runReducer(fixture))).toMatchObject({ status: 'COMPLETED' });
    expect(fixture.counters.closeoutObserve).toBeGreaterThanOrEqual(observed);
  } finally {
    fixture.dispose();
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('durable comment and merge markers reconstruct terminal status without an Actions artifact', async () => {
  const fixture = (await reducerFixture());
  try {
    const publication = durablePublication(fixture);
    const exactOpen = classifyDurableVerificationSessionProjection({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: []
    });
    expect(exactOpen).toBeNull();
    expect(classifyDurableVerificationSessionProjection({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: [publication]
    })).toMatchObject({ status: 'BLOCKED_AMBIGUOUS_SIDE_EFFECT' });

    fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
      fixture.artifact.session.sessionRevision);
    const ready = classifyDurableVerificationSessionProjection({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: [publication]
    });
    expect(ready).toMatchObject({ status: 'READY_TO_CLOSEOUT', candidateState: 'MERGED' });
    const closeoutOperationId = ready?.closeoutOperationId;
    if (typeof closeoutOperationId !== 'string') throw new Error('closeout operation id missing');
    expect(classifyDurableVerificationSessionProjection({
      repository: 'sec-platform/sec', request: fixture.request,
      candidate: fixture.transport.candidate(), publications: [publication],
      closeout: { closeoutOperationId: closeoutOperationId as `sha256:${string}`,
        commentId: 700, status: 'completed' }
    })).toMatchObject({ status: 'COMPLETED', closeoutCommentId: 700 });
  } finally {
    fixture.dispose();
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('MERGED recovery permits advanced main only when the marker commit remains reachable', async () => {
  const advancedMain = '8'.repeat(40);
  const reachable = (await reducerFixture({ remoteDefaultSha: advancedMain,
    mergeToDefault: { status: 'ahead', behindBy: 0 } }));
  try {
    reachable.transport.adoptMerged(reachable.markers, reachable.result.reviewReceipt,
      reachable.artifact.session.sessionRevision);
    expect((await runReducer(reachable))).toMatchObject({ status: 'COMPLETED' });
  } finally {
    reachable.dispose();
  }

  for (const comparison of [
    { status: 'diverged', behindBy: 1 },
    { status: 'behind', behindBy: 1 }
  ] satisfies GitHubComparisonObservation[]) {
    const blocked = (await reducerFixture({ remoteDefaultSha: advancedMain, mergeToDefault: comparison }));
    try {
      blocked.transport.adoptMerged(blocked.markers, blocked.result.reviewReceipt,
        blocked.artifact.session.sessionRevision);
      await expect((async () => (await runReducer(blocked)))()).rejects.toThrow(/ancestor|reachability/i);
    } finally {
      blocked.dispose();
    }
  }
  const invalidBase = (await reducerFixture({ baseToMerge: { status: 'diverged', behindBy: 1 } }));
  try {
    invalidBase.transport.adoptMerged(invalidBase.markers, invalidBase.result.reviewReceipt,
      invalidBase.artifact.session.sessionRevision);
    await expect((async () => (await runReducer(invalidBase)))()).rejects.toThrow(/old base ancestry/i);
  } finally {
    invalidBase.dispose();
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('MERGED reachability permits detached old-base only with synchronized post-merge default', async () => {
  const advancedMain = '8'.repeat(40);
  const fixture = (await reducerFixture({ remoteDefaultSha: advancedMain,
    mergeToDefault: { status: 'ahead', behindBy: 0 } }));
  try {
    fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
      fixture.artifact.session.sessionRevision);
    const candidate = fixture.transport.candidate();
    const proof = { currentHeadSha: BASE, currentBranch: '', localDefaultSha: advancedMain,
      remoteDefaultSha: advancedMain, workingTreeClean: true,
      runtimeEntrypointBlobMatched: true, boundaryTargetsMatched: true };
    const input = { proof, repository: fixture.artifact.session.repository,
      prNumber: fixture.artifact.session.prNumber, baseSha: fixture.artifact.session.baseSha,
      headSha: fixture.artifact.session.headSha, headTreeSha: fixture.artifact.session.headTreeSha,
      candidate, github: fixture.github };
    await expect(assertTrustedMergedRequestRuntimeReachability(input)).resolves.toBeUndefined();
    await expect((async () => (await assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, localDefaultSha: BASE } })))()).rejects.toThrow(/synchronized local\/live default/i);
    await expect((async () => (await assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, localDefaultSha: 'f'.repeat(40) } })))()).rejects.toThrow(/synchronized local\/live default/i);
    await expect((async () => (await assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, currentBranch: 'feature/foreign' } })))()).rejects.toThrow(/old-base trusted TCB/i);
    await expect((async () => (await assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, currentHeadSha: HEAD } })))()).rejects.toThrow(/old-base trusted TCB/i);
  } finally {
    fixture.dispose();
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('actual reducer rejects OPEN base/head drift before any merge claim or effect', async () => {
  for (const [field, value] of [
    ['baseSha', 'f'.repeat(40)],
    ['headSha', 'e'.repeat(40)]
  ] as const) {
    const fixture = (await reducerFixture());
    try {
      fixture.transport.observation = { ...fixture.transport.observation, [field]: value };
      await expect((async () => (await runReducer(fixture)))()).rejects.toThrow(/live .* drifted/i);
    } finally {
      fixture.dispose();
    }
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('actual reducer rejects expired or already-consumed authorization before merge', async () => {
  for (const fixture of [
    (await reducerFixture({ authorizationExpiresAt: '2026-08-09T14:06:00.000Z', now: '2026-08-09T14:07:00.000Z' })),
    (await reducerFixture({ consumed: true }))
  ]) {
    try {
      await expect((async () => (await runReducer(fixture)))()).rejects.toThrow(/expired|already consumed/i);
    } finally {
      fixture.dispose();
    }
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('actual reducer binds IntegrationAuthorization to trusted live repository and PR', async () => {
  for (const identity of [
    { repository: 'attacker/fork' },
    { prNumber: 99 }
  ]) {
    const fixture = (await reducerFixture());
    try {
      fixture.setAuthorizationResult(substituteAuthorizationLiveIdentity(fixture, identity));
      await expect((async () => (await runReducer(fixture)))()).rejects.toThrow(/repository|prNumber/i);
    } finally {
      fixture.dispose();
    }
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('actual reducer rejects downloaded merge-result digest or provenance substitution', async () => {
  for (const mutate of [
    (value: Record<string, any>) => { value.resultDigest = `sha256:${'f'.repeat(64)}`; },
    (value: Record<string, any>) => { value.provenance.sourceRunId = 'forged-run'; }
  ]) {
    const fixture = (await reducerFixture());
    try {
      const value = JSON.parse(encodeVerificationActionData(fixture.result)) as Record<string, any>;
      mutate(value);
      fixture.setAuthorizationResult(JSON.stringify(value));
      await expect((async () => (await runReducer(fixture)))()).rejects.toThrow(/digest|provenance|issuer/i);
    } finally {
      fixture.dispose();
    }
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('actual reducer blocks merged-tree mismatch and blocked/residue closeout terminals', async () => {
  const mismatch = (await reducerFixture());
  try {
    mismatch.transport.mergedTreeSha = 'd'.repeat(40);
    expect((await runReducer(mismatch))).toMatchObject({ status: 'READY_TO_INTEGRATE' });
    mismatch.transport.adoptMerged(mismatch.markers, mismatch.result.reviewReceipt,
      mismatch.artifact.session.sessionRevision);
    await expect((async () => (await runReducer(mismatch)))()).rejects.toThrow(/marker-bound candidate\/tree identity/i);
  } finally {
    mismatch.dispose();
  }
  for (const terminal of ['blocked', 'residue'] as const) {
    const fixture = (await reducerFixture({ closeout: terminal }));
    try {
      expect((await runReducer(fixture))).toMatchObject({ status: 'READY_TO_INTEGRATE' });
      fixture.transport.adoptMerged(fixture.markers, fixture.result.reviewReceipt,
        fixture.artifact.session.sessionRevision);
      expect((await runReducer(fixture))).toMatchObject({ status: 'BLOCKED', reason: `branch closeout terminal ${terminal}` });
    } finally {
      fixture.dispose();
    }
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('reducer emits one stable integration intent and never executes a physical merge', async () => {
  const fixture = (await reducerFixture());
  try {
    const first = (await runReducer(fixture));
    const replay = (await runReducer(fixture));
    expect(first).toMatchObject({ status: 'READY_TO_INTEGRATE',
      operationId: fixture.result.authorization.consumptionOperationId });
    expect(replay).toMatchObject({ status: 'READY_TO_INTEGRATE', operationId: first.operationId });
  } finally {
    fixture.dispose();
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

  test('V9 expired pre-gate authority requires a fresh integration while retaining exact Action Evidence', async () => {
  const stalePreGateAt = '2026-08-09T14:07:00.000Z';
  const stalePreGate = (await reducerFixture({ mergeAt: stalePreGateAt }));
  try {
    expect(classifyVerificationSessionArtifactReuse(stalePreGate.artifact, stalePreGateAt))
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
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

});
