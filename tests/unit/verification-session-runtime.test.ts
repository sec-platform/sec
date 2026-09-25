import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';


const CLOSEOUT_CLI_E2E_ENABLED = process.env.SEC_VERIFICATION_SESSION_CLOSEOUT_CLI_E2E === '1';
const closeoutCliE2eTest = CLOSEOUT_CLI_E2E_ENABLED ? test : test.skip;
const PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS = 30_000;
const VERIFICATION_ACTION_TEST_PROCESS_ISSUER =
  issueVerificationActionTestProcessIssuerForTests();

import { DOCUMENTATION_BASELINE_PATH, parseDocumentationVerificationBaseline } from '../../src/adapters/self-hosting/control/documentation/active.ts';
import { createIntegrationAuthorization } from '../../src/adapters/self-hosting/control/integration/authorization.ts';
import {
  createMainHealthLedger,
  createMainHealthRepairWorkPackagePath,
  resolveOrdinaryMainHealthLane,
  resolveRepairMainHealthLane
} from '../../src/adapters/self-hosting/control/main-health/contract.ts';
import { createScopeAuthorization, type ScopeAuthorization } from '../../src/adapters/self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { ciVerificationActionParentDispatchPlanPayloadDigest, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, createCiVerificationLocalExecutionEnvironment } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { createVerificationEvidenceProducer, finalizeVerificationEvidence, finalizeVerificationSessionArtifact } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { bindDocumentationVerificationGateInput } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { createReviewSnapshotDigest, createReviewStabilityReceipt, renderIndependentReviewTrailer, REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, REVIEW_STABILITY_POLICY } from '../../src/adapters/verification/platform/review/contract/stability.ts';
import { CreateTestImpactTransitionObservation, TestImpactTransitionDigest, type TestImpactTransitionObservation } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { BuildVerificationGateResult } from '../../src/assurance/verification/result/contract/result.ts';

import type {
  GitHubCheckObservation, GitHubWorkflowJobObservation,
  GitHubWorkflowRunObservation
} from '../../src/adapters/providers/github-api/contract.ts';
import {
  authorizeBranchCloseout,
  BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
  createBranchCloseoutOperationBinding,
  createBranchCloseoutPreparation,
  createBranchCloseoutRecoveryArtifact,
  parseBranchCloseoutRecoveryArtifact
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
  createBranchCloseoutEffectStartPublication,
  createHostedWorkflowCommentProvenance,
  renderBranchCloseoutEffectStartPublicationComment
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
  parsePreparedBranchCloseoutEnvelope,
  prepareBranchCloseout,
  rehydratePreparedBranchCloseoutEnvelope,
  rehydratePreparedBranchCloseoutRecoveryArtifact
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { createBranchLifecycleGitChildEnvironment } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import {
  BRANCH_REF_CLOSEOUT_CAPABILITY,
  type BranchLifecycleInventory
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import type { IntegrationAuthorizationOperationPublication } from '../../src/adapters/self-hosting/control/integration/integration-authorization-publication.ts';
import {
  createIntegrationAuthorizationOperationPublication,
  HOSTED_INTEGRATION_PHASE_STEP_NAMES,
  renderIntegrationAuthorizationOperationPublicationComment
} from '../../src/adapters/self-hosting/control/integration/integration-authorization-publication.ts';
import {
  EvaluateMergeGate,
  type MergeGateResult
} from '../../src/adapters/self-hosting/control/integration/merge-gate.ts';
import { createObservedMainHealthInput } from '../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import {
  executeLocalVerificationActionDag,
  issueVerificationActionTestProcessIssuerForTests
} from '../../src/adapters/verification/platform/action/runner.ts';
import { CI_VERIFICATION_SESSION_ARTIFACT_PREFIX, CI_VERIFICATION_SESSION_DISPATCH_TYPE, CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import type { VerificationSessionHostedRequest } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import {
  assertGitHubReviewAuthorityObservation,
  classifyGitHubGraphQLSchemaFailure,
  createVerificationSessionGitHubClient,
  evaluateGitHubRepositoryActionsArtifactInventory,
  evaluateHostedReviewLocatorObservation,
  evaluateMaintainerReviewWakeupObservation,
  evaluatePlatformEnforcementObservation,
  evaluateVerificationSessionChangedPaths,
  evaluateVerificationSessionReviewObservation,
  evaluateVerificationSessionWorkflowJoin,
  isGitHubProviderSchemaUnsupportedError,
  parseGitHubOpenPullRequestCensus,
  parseGitHubPullRequestFileInventory,
  parseGitHubReviewPages,
  parseGitHubReviewThreadPages,
  PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
  shouldPublishMaintainerReviewWakeup,
  VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER,
  VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER,
  type GitHubActionsArtifactObservation,
  type GitHubAppReviewCommentObservation,
  type GitHubCandidateObservation,
  type GitHubCommitResolutionObservation,
  type GitHubComparisonObservation,
  type GitHubIssueCommentObservation,
  type GitHubPage,
  type GitHubReviewBarrierObservation,
  type GitHubReviewObservation,
  type GitHubReviewRequestObservation,
  type GitHubReviewThreadObservation,
  type SessionDigest,
  type VerificationSessionGitHubClient,
  type VerificationSessionReviewObservationTransaction,
  type VerificationSessionWorkflowObservationTransaction
} from '../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import {
  createEphemeralVerificationSessionJournalFs
} from '../../src/adapters/verification/platform/ci/runtime/verification-session-journal.ts';
import {
  assertTrustedExactRevisionRuntime,
  assertTrustedMainRuntime,
  assertTrustedMergedRequestRuntimeReachability,
  assertTrustedRuntime,
  classifyVerificationSessionArtifactReuse,
  compilePostMainIssueDispositionHealthReadback,
  createHostedArtifactObservation,
  createTrustedHostedArtifactProvenance,
  createTrustedIntegrationAuthorizationArtifact,
  createVerificationSessionMergeOperationId,
  integrationAuthorizationMergeMarkers,
  prepareLocalQuickVerificationActionPlan,
  prepareTrustedMainVerificationSession,
  prepareVerificationSessionHosted,
  prepareVerificationSessionMergeInput,
  reconstructVerificationSessionHostedFacts,
  resumeVerificationSession,
  VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY,
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA,
  type VerificationSessionHostedEnvelope,
  type VerificationSessionHostedFacts,
  type VerificationSessionRuntimeExternal
} from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import {
  assertHostedCompilerDispatchPayload,
  assertHostedCompilerInternalProvenance,
  assertHostedSquashMergeCompletion,
  classifyDurableVerificationSessionProjection,
  parseHostedSynchronousSquashMergeResponse,
  planHostedIntegrationEffects,
  routeHostedIntegration,
  routePreparedWorktreeCleanupAttempt,
  verificationSessionCli
} from '../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import { createVerificationSession, type VerificationSession } from '../../src/adapters/verification/platform/session/contract/session.ts';
import { compileTcbClosureIdentity } from '../../src/adapters/verification/platform/trust/compiler.ts';
import { TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';
import { runRetainedBunTestProcess } from '../testkit/process-resource.ts';

const HEAD = '2222222222222222222222222222222222222222';
const BASE = '1111111111111111111111111111111111111111';
const BOT = 'BOT_kgDOC98s_g';
const PAGE = `sha256:${'a'.repeat(64)}` as const;
const JOIN_SESSION = `sha256:${'6'.repeat(64)}` as const;
const JOIN_ACTION = `sha256:${'7'.repeat(64)}` as const;
let testImpactFixture: Awaited<ReturnType<typeof acquireExactRepositoryTestImpactProviderFixture>> | undefined;
let testImpactSourceProviderPromise: Promise<ReturnType<typeof bindDocumentationVerificationGateInput>> | undefined;
function testImpactSourceProvider(): Promise<ReturnType<typeof bindDocumentationVerificationGateInput>> {
  return testImpactSourceProviderPromise ??= (async () => {
    const fixture = await acquireExactRepositoryTestImpactProviderFixture();
    testImpactFixture = fixture;
    const exactDocumentationBaseline = spawnSync('git', [
      'show', `${fixture.fixtureCommitSha}:${DOCUMENTATION_BASELINE_PATH}`
    ], { cwd: fixture.repositoryRoot, encoding: 'utf8', windowsHide: true });
    if (exactDocumentationBaseline.status !== 0) {
      throw new Error(`Exact TestImpact fixture documentation baseline is unavailable: ${exactDocumentationBaseline.stderr}`);
    }
    return bindDocumentationVerificationGateInput(
      fixture.provider,
      parseDocumentationVerificationBaseline(exactDocumentationBaseline.stdout)
    );
  })();
}

function changedTransition(
  changedPaths: readonly string[],
  baseSha = BASE,
  headSha = HEAD
): TestImpactTransitionObservation {
  return CreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: changedPaths.map((changedPath) => ({ status: 'changed' as const, path: changedPath })),
    readPathBlob: () => null
  });
}

const JOIN_REQUEST: VerificationSessionHostedRequest = Object.freeze({
  schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA, prNumber: 42,
  expectedBaseSha: BASE, expectedBaseTreeSha: HEAD, expectedHeadSha: HEAD,
  expectedHeadTreeSha: HEAD, manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v6.md',
  manifestDigest: `sha256:${'1'.repeat(64)}`, profile: 'quick',
  expectedScopeProposalDigest: `sha256:${'2'.repeat(64)}`,
  expectedActionPlanDigest: JOIN_ACTION, expectedSessionRevision: JOIN_SESSION,
  reviewPolicyDigest: `sha256:${'3'.repeat(64)}`,
  requestOperationId: `sha256:${'4'.repeat(64)}`
});

test('canonical Session dispatch is preserved as bounded child-process bytes', () => {
  const body = Buffer.from(`${encodeVerificationActionData({
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

  for (const rerunSelection of ['all', 'failed'] as const) {
    const blocked = routeHostedIntegration({ repository: 'sec-platform/sec', session, candidate,
      priorEffectStarted: true, authorizationPublicationCount: 0 });
    expect({ rerunSelection, lane: blocked.lane, reason: blocked.reason }).toEqual({
      rerunSelection, lane: 'blocked', reason: 'open-prior-effect-started'
    });
  }
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
  let prepareCount = 0;
  let authorizationCount = 0;
  let mergeCount = 0;
  if (mergedEffects.prepareRecoveryArtifact) prepareCount += 1;
  if (mergedEffects.createAuthorizationPublication) authorizationCount += 1;
  if (mergedEffects.executePhysicalMerge) mergeCount += 1;
  expect({ prepareCount, authorizationCount, mergeCount })
    .toEqual({ prepareCount: 0, authorizationCount: 0, mergeCount: 0 });

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

test('hosted Review locator is exact, non-triggering, and reuses only its matching locator', () => {
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
  const produced = evaluateHostedReviewLocatorObservation(transport, input);
  expect(produced).toMatchObject({ status: 'absent', commentId: null });
  expect(produced.body).toContain(VERIFICATION_SESSION_REVIEW_LOCATOR_COMMENT_MARKER);
  expect(produced.body).not.toContain('@codex review');

  transport.issueComments = [[actionsIssueComment(produced.body, '104')]];
  expect(evaluateHostedReviewLocatorObservation(transport, input)).toMatchObject({
    status: 'reused',
    commentId: '104'
  });

  transport.issueComments = [[]];
  const foreign = evaluateHostedReviewLocatorObservation(transport, {
    ...input,
    repository: 'foreign/repository'
  });
  transport.issueComments = [[actionsIssueComment(foreign.body)]];
  expect(() => evaluateHostedReviewLocatorObservation(transport, input))
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
    const drift = evaluateHostedReviewLocatorObservation(transport, drifted);
    transport.issueComments = [[actionsIssueComment(drift.body)]];
    expect(() => evaluateHostedReviewLocatorObservation(transport, input))
      .toThrow('conflicting semantic bytes');
  }

  const encoded = produced.body.match(/```json\n(?<payload>.+)\n```$/u)?.groups?.payload;
  if (encoded === undefined) throw new Error('production Review locator body did not contain canonical JSON');
  const extraFieldBody = produced.body.replace(encoded, encodeVerificationActionData({
    ...(JSON.parse(encoded) as Record<string, unknown>),
    extraField: 'forbidden'
  }));
  transport.issueComments = [[actionsIssueComment(extraFieldBody)]];
  expect(() => evaluateHostedReviewLocatorObservation(transport, input))
    .toThrow('payload keys/schema are invalid');
});

test('maintainer Review wake-up is exact, user-authored, and at-most-once per session operation', () => {
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
  const produced = evaluateMaintainerReviewWakeupObservation(transport, input);
  expect(produced).toMatchObject({ status: 'absent', commentId: null });
  expect(produced.body.startsWith('@codex review\n\n')).toBe(true);
  expect(produced.body).toContain(VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER);

  transport.issueComments = [[botIssueComment(produced.body, {
    id: '200', authorLogin: 'outsider', authorId: 502, authorNodeId: 'OUTSIDER',
    authorType: 'User', performedViaGitHubApp: null
  })]];
  expect(evaluateMaintainerReviewWakeupObservation(transport, input)).toMatchObject({
    status: 'absent', commentId: null
  });

  transport.issueComments = [[botIssueComment(
    `@codex review\n\n${VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER}\n{not-json}`,
    { id: '204', authorLogin: 'outsider', authorId: 502, authorNodeId: 'OUTSIDER',
      authorType: 'User', performedViaGitHubApp: null }
  )]];
  expect(evaluateMaintainerReviewWakeupObservation(transport, input)).toMatchObject({
    status: 'absent', commentId: null
  });

  transport.issueComments = [[maintainerIssueComment(produced.body)]];
  expect(evaluateMaintainerReviewWakeupObservation(transport, input)).toMatchObject({
    status: 'reused', commentId: '201', wakeupDigest: produced.wakeupDigest
  });

  transport.issueComments = [[maintainerIssueComment(produced.body, '205', {
    authorLogin: 'renamed-maintainer'
  })]];
  expect(evaluateMaintainerReviewWakeupObservation(transport, input)).toMatchObject({
    status: 'reused', commentId: '205', wakeupDigest: produced.wakeupDigest
  });

  transport.issueComments = [[]];
  const otherMaintainer = evaluateMaintainerReviewWakeupObservation(transport, {
    ...input,
    publisherLogin: 'other-maintainer',
    publisherNodeId: 'OTHER_MAINTAINER_NODE'
  });
  transport.issueComments = [[botIssueComment(otherMaintainer.body, {
    id: '203', authorLogin: 'other-maintainer', authorId: 503,
    authorNodeId: 'OTHER_MAINTAINER_NODE', authorType: 'User', performedViaGitHubApp: null
  })]];
  expect(evaluateMaintainerReviewWakeupObservation(transport, input)).toMatchObject({
    status: 'reused', commentId: '203', wakeupDigest: otherMaintainer.wakeupDigest
  });

  transport.issueComments = [[maintainerIssueComment(produced.body, '201'),
    maintainerIssueComment(produced.body, '202')]];
  expect(() => evaluateMaintainerReviewWakeupObservation(transport, input))
    .toThrow('duplicate maintainer Review wake-up comments');

  transport.issueComments = [[]];
  const drifted = evaluateMaintainerReviewWakeupObservation(transport, {
    ...input,
    headTreeSha: BASE
  });
  transport.issueComments = [[maintainerIssueComment(drifted.body)]];
  expect(() => evaluateMaintainerReviewWakeupObservation(transport, input))
    .toThrow('conflicting semantic bytes');

  transport.issueComments = [[maintainerIssueComment(produced.body, '201', {
    authorType: 'Bot',
    performedViaGitHubApp: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app
  })]];
  expect(evaluateMaintainerReviewWakeupObservation(transport, input)).toMatchObject({
    status: 'absent', commentId: null
  });

  transport.issueComments = [[maintainerIssueComment(
    `@codex review\n\n${VERIFICATION_SESSION_REVIEW_WAKEUP_COMMENT_MARKER}\n{not-json}`
  )]];
  expect(() => evaluateMaintainerReviewWakeupObservation(transport, input))
    .toThrow('maintainer Review wake-up comment shape is invalid');
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
    return [{ id: 1, enforcement: 'active' }];
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

function observe(transport: FakeTransport) {
  return evaluateVerificationSessionReviewObservation(transport, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']),
    observedAt: '2026-08-09T14:01:00.000Z'
  });
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
  privateGhProxySuiteRoot = mkdtempSync(path.join(tmpdir(), 'sec-private-gh-proxy-'));
  const output = path.join(privateGhProxySuiteRoot, process.platform === 'win32' ? 'gh.exe' : 'gh');
  const sourceText = `
import { pathToFileURL } from 'node:url';
const runner = process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER;
if (!runner) throw new Error('SEC_VERIFICATION_SESSION_TEST_GH_RUNNER is required');
await import(pathToFileURL(runner).href);
`;
  if (process.platform === 'win32') {
    const source = path.join(privateGhProxySuiteRoot, 'gh-proxy.ts');
    writeFileSync(source, sourceText, 'utf8');
    const compiled = spawnSync(process.execPath, [
      'build', '--compile', source, '--outfile', output
    ], { encoding: 'utf8', windowsHide: true });
    if (compiled.status !== 0) {
      throw new Error(`cannot compile private gh proxy: ${compiled.stderr || compiled.stdout}`);
    }
  } else {
    writeFileSync(output, `#!/usr/bin/env bun\n${sourceText}`, { encoding: 'utf8', mode: 0o700 });
    chmodSync(output, 0o700);
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
    return createVerificationSessionGitHubClient(root).observeReviewBarrier({
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

function observePrivateMergedCandidate(parentShas: readonly string[]): GitHubCandidateObservation {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-merged-candidate-gh-'));
  const runner = path.join(root, 'gh-merged-candidate.mjs');
  const mergeCommitSha = '9'.repeat(40);
  writeFileSync(runner, `
const args = process.argv.slice(2);
const base = ${JSON.stringify(BASE)};
const head = ${JSON.stringify(HEAD)};
const mergeCommitSha = ${JSON.stringify(mergeCommitSha)};
const parentShas = ${JSON.stringify(parentShas)};
const out = (value) => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0); };
const endpoint = args[0] === 'api' ? args[1] : '';
if (args[0] === 'pr' && args[1] === 'view') out({
  number: 42, state: 'MERGED', isDraft: false, isCrossRepository: false,
  author: { id: 'AUTHOR' }, baseRefName: 'main', baseRefOid: base,
  headRefName: 'feature/provider-shape', headRefOid: head,
  title: 'Merged candidate', body: '', mergeCommit: { oid: mergeCommitSha }
});
if (endpoint.endsWith('/' + base)) out(base + '\\n');
if (endpoint.endsWith('/' + head)) out(head + '\\n');
if (endpoint.endsWith('/' + mergeCommitSha)) out({ sha: mergeCommitSha,
  tree: { sha: head }, message: 'provider-observed merge',
  parents: parentShas.map((sha) => ({ sha })) });
process.stderr.write('unsupported private merged candidate command: ' + args.join(' '));
process.exit(1);
`, 'utf8');
  const proxyRoot = privateGhProxyRoot();
  const previousPath = process.env.PATH;
  const previousRunner = process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER;
  process.env.PATH = `${proxyRoot}${path.delimiter}${previousPath ?? ''}`;
  process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER = runner;
  try {
    return createVerificationSessionGitHubClient(root).observeCandidate('sec-platform/sec', 42);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousRunner === undefined) delete process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER;
    else process.env.SEC_VERIFICATION_SESSION_TEST_GH_RUNNER = previousRunner;
    rmSync(root, { recursive: true, force: true });
  }
}

const privateClearReviewBarriers = new Map<string,
  Extract<GitHubReviewBarrierObservation, { status: 'clear' }>>();

function observePrivateClearReviewBarrier(observedAt: string): Extract<GitHubReviewBarrierObservation, { status: 'clear' }> {
  const cached = privateClearReviewBarriers.get(observedAt);
  if (cached !== undefined) return cached;
  const barrier = observePrivateGhProviderBarrier('clear', '', observedAt);
  if (barrier.status !== 'clear') throw new Error('production private adapter fixture Review must be clear');
  privateClearReviewBarriers.set(observedAt, barrier);
  return barrier;
}

function fakeGitHubClient(
  transport: FakeTransport,
  observePrivateBarrier?: (input: Parameters<VerificationSessionGitHubClient['observeReviewBarrier']>[0]) => GitHubReviewBarrierObservation
): VerificationSessionGitHubClient {
  const client: Pick<VerificationSessionGitHubClient,
    'observeCandidate' | 'observeReviewBarrier' | 'observePrincipalByNodeId'
    | 'observePlatformEnforcement' | 'observeComparison' | 'ensureVerificationSessionWakeup'> = {
    observeCandidate: () => transport.candidate(),
    observeReviewBarrier: (input) => observePrivateBarrier?.(input)
      ?? evaluateVerificationSessionReviewObservation(transport, input),
    observePrincipalByNodeId: (repository, nodeId) => transport.principalByNodeId(repository, nodeId),
    observePlatformEnforcement: (repository) => evaluatePlatformEnforcementObservation({
      repository,
      readRulesets: () => transport.repositoryRulesets()
    }),
    observeComparison: (repository, baseSha, headSha) => transport.comparison(repository, baseSha, headSha),
    ensureVerificationSessionWakeup: () => transport.ensureVerificationSessionWakeup()
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
    policy: REVIEW_STABILITY_POLICY, principal: input.barrier.principal,
    independence: { candidateAuthorNodeId: input.candidateAuthorNodeId,
      integrationPrincipalNodeId: input.integrationPrincipalNodeId },
    producer: {
      identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: input.barrier.authority.executionIdentity,
      providerIdentity: input.barrier.authority.providerIdentity,
      candidateWriteCapability: input.barrier.authority.candidateWriteCapability,
      capabilityReceiptDigest: input.barrier.authority.capabilityReceiptDigest,
      trustedRevision: REVIEW_STABILITY_POLICY.trustedRevision,
      sourceTransport: input.barrier.authority.sourceTransport,
      sourceRunId: input.operationId,
      sourceRef: `github://${input.session.repository}/pull/${input.session.prNumber}@${input.session.headSha}`,
      sourceDigest: input.barrier.authority.sourceDigest
    },
    snapshot: input.barrier.snapshot, reviewedAt: input.barrier.observedAt, expiresAt: input.expiresAt
  });
}

function createPureHostedEnvelopeFixture(input: {
  request: VerificationSessionHostedRequest;
  facts: VerificationSessionHostedFacts;
}): VerificationSessionHostedEnvelope {
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
    reviewPolicyDigest: REVIEW_STABILITY_POLICY.policyDigest,
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
  const TEST_IMPACT_SOURCE_PROVIDER = await testImpactSourceProvider();
  const mergeAt = options.mergeAt ?? MERGE_AT;
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-'));
  const journalFs = createEphemeralVerificationSessionJournalFs(
    path.join(repositoryRoot, 'runtime-state')
  );
  const transport = new ReducerTransport();
  transport.issueComments = [[botIssueComment()]];
  const github = fakeGitHubClient(transport, (input) => observePrivateClearReviewBarrier(
    input.observedAt ?? VERIFIED_AT
  ));
  const barrier = github.observeReviewBarrier({ repository: 'sec-platform/sec', prNumber: 42,
    headSha: HEAD, excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']), observedAt: VERIFIED_AT });
  if (barrier.status !== 'clear') throw new Error('fixture Review must be clear');
  const changedPaths = ['src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const testImpactTransition = changedTransition(changedPaths);
  const sessionMainHealthCheck = mainHealthCheck({ id: 100, workflowRunId: '100',
    detailsUrl: 'https://github.example/actions/runs/100' });
  const local = prepareTrustedMainVerificationSession({ repository: 'sec-platform/sec',
    candidate: transport.candidate(), manifestPath: V6_MANIFEST_PATH, manifestDigest: V6_MANIFEST_DIGEST,
    changedPaths, testImpactTransition, testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    profile: 'quick', integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '100',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: VERIFIED_AT,
    reviewBarrier: barrier, mainHealthChecks: [sessionMainHealthCheck],
    dependencyBlobs: actionDependencyBlobs() });
  const facts = reconstructVerificationSessionHostedFacts({ request: local.request,
    repository: 'sec-platform/sec', candidate: transport.candidate(), changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR',
    sourceRunId: '100', sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
    observedAt: VERIFIED_AT, reviewBarrier: barrier, mainHealthChecks: [sessionMainHealthCheck],
    dependencyBlobs: actionDependencyBlobs() });
  const envelope = createPureHostedEnvelopeFixture({ request: local.request, facts });
  const producer = createVerificationEvidenceProducer({
    sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
    runId: '100', runAttempt: 1, actorNodeId: 'INTEGRATOR'
  });
  const gates = envelope.actionPlanClosure.actions.map(({ action }, index) => ({
    action,
    result: BuildVerificationGateResult({
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
  const evidence = finalizeVerificationEvidence({
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
  const artifact = finalizeVerificationSessionArtifact({
    scopeAuthorization: envelope.scopeAuthorization, session: envelope.session,
    preGateReview: envelope.preGateReview, mainHealth: envelope.mainHealth, evidence, producer
  });
  const artifactText = `${encodeVerificationActionData(artifact)}\n`;
  const hostedMetadata = {
    artifactId: '1000',
    artifactName: `sec-verification-session-v2-pr-42-session-${artifact.session.sessionRevision.slice(7)}-run-100-attempt-1`,
    archiveDigest: PAGE,
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
    runId: '100', runAttempt: 1, eventName: 'repository_dispatch', actorNodeId: 'INTEGRATOR',
    actorPermission: 'maintain' as const, expired: false
  };
  const hostedObservation = createHostedArtifactObservation({ artifact, artifactText,
    observation: hostedMetadata });
  const preMergeBarrier = github.observeReviewBarrier({ repository: 'sec-platform/sec', prNumber: 42,
    headSha: HEAD, excludedPrincipalNodeIds: new Set(['AUTHOR', 'INTEGRATOR']), observedAt: mergeAt });
  if (preMergeBarrier.status !== 'clear') throw new Error('fixture pre-merge Review must be clear');
  const preMergeReview = createPureReviewFixture({ stage: 'pre-merge',
    session: artifact.session, scope: artifact.scopeAuthorization, barrier: preMergeBarrier,
    candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR',
    expiresAt: '2026-08-09T14:20:00.000Z', operationId: PAGE });
  const mergeWorkflowRef = `.github/workflows/merge-gate.yml@${BASE}`;
  const freshMainHealthSourceRef = `github-check-runs:sec-platform/sec@${BASE}`;
  const freshMainHealth = createMainHealthLedger(createObservedMainHealthInput({
    repository: 'sec-platform/sec', mainSha: BASE, mainTreeSha: BASE, trustRevision: BASE,
    observedAt: mergeAt, expiresAt: '2026-08-09T14:20:00.000Z', sourceRunId: '200',
    sourceRef: freshMainHealthSourceRef, checks: [mainHealthCheck({ id: 200, workflowRunId: '200',
      detailsUrl: 'https://github.example/actions/runs/200' })]
  }));
  const platform = github.observePlatformEnforcement('sec-platform/sec');
  if (platform.status === 'unknown') throw new Error('fixture platform observation must be known');
  const consumptionOperationId = createVerificationSessionMergeOperationId({
    sessionRevision: artifact.session.sessionRevision, headSha: HEAD,
    actionPlanDigest: artifact.session.actionPlanClosureDigest
  });
  const mergeInput = prepareVerificationSessionMergeInput({ artifact, preMergeReview,
    platform, hostedArtifactOrigin: hostedObservation, hostedArtifactTransport: hostedObservation,
    candidate: { repository: 'sec-platform/sec', prNumber: 42, draft: false,
      headOpenPullRequestCount: 1, currentBaseSha: BASE, currentBaseTreeSha: BASE,
      headSha: HEAD, headTreeSha: HEAD, baseIsAncestor: true, behindBy: 0,
      manifestPath: V6_MANIFEST_PATH, manifestDigest: V6_MANIFEST_DIGEST, changedPaths },
    provenance: { workflowPath: '.github/workflows/merge-gate.yml', workflowRef: mergeWorkflowRef,
      workflowSha: BASE, eventName: 'workflow_run', sourceRunId: '200', sourceRunAttempt: 1,
      actorNodeId: 'INTEGRATOR', actorPermission: 'maintain' },
    mainHealth: freshMainHealth, consumptionOperationId, issuedAt: mergeAt,
    expiresAt: options.authorizationExpiresAt ?? '2026-08-09T14:10:00.000Z'
  });
  const result = EvaluateMergeGate(mergeInput);
  const authorizationPublicationId = `sha256:${createHash('sha256').update(encodeVerificationActionData({
    consumptionOperationId: result.authorization.consumptionOperationId,
    authorizationReceiptDigest: result.authorization.receiptDigest
  })).digest('hex')}` as const;
  const authorizationMetadata = {
    artifactId: '2000',
    artifactName: `sec-merge-gate-result-v2-pr-42-session-${artifact.session.sessionRevision.slice(7)}-run-200-attempt-1`,
    archiveDigest: PAGE,
    workflowPath: '.github/workflows/merge-gate.yml', workflowRef: mergeWorkflowRef,
    workflowSha: BASE, runId: '200', runAttempt: 1, eventName: 'workflow_run',
    actorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId,
    actorPermission: 'none' as const, expired: false
  };
  let trustedAuthorization = createTrustedIntegrationAuthorizationArtifact({
    resultJson: encodeVerificationActionData(result), observation: authorizationMetadata
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
}

function runReducer(fixture: Awaited<ReturnType<typeof reducerFixture>>) {
  return resumeVerificationSession({ repositoryRoot: fixture.repositoryRoot,
    session: fixture.artifact.session, scopeAuthorization: fixture.artifact.scopeAuthorization,
    changedPaths: fixture.changedPaths, testImpactTransition: fixture.testImpactTransition,
    integrationPrincipalNodeId: 'INTEGRATOR',
    github: fixture.github, external: fixture.external, journalFs: fixture.journalFs });
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

test('trusted app review binds stable app/node and exact reviewed head', () => {
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment(
    `Codex Review: Didn't find any major issues. Delightful!\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``
  )]];
  const result = observe(transport);
  expect(result.status).toBe('clear');
  if (result.status !== 'clear') throw new Error('expected clear review');
  expect(result.principal).toEqual({ kind: 'github-app', actorNodeId: BOT, appId: 1144995,
    appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' });
  expect(result.snapshot.reviewedHeadSha).toBe(HEAD);
  expect(result.authority.sourceTransport).toBe('github-rest');
  expect(result.snapshot.reviewPageDigests).toContain(result.authority.sourceDigest);
});

test('REST clean verdict accepts stable prefix variants only with provider-resolved exact 10/full locator', () => {
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
  expect(observe(providerAbout).status).toBe('clear');

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
    expect(observe(contradictory)).toMatchObject({ status: 'waiting',
      reason: 'exact-head-independent-review-missing' });
  }

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
  expect(() => assertGitHubReviewAuthorityObservation(clear)).toThrow(
    'Review receipt authority must be a live observation produced by the private GitHub adapter.'
  );

  const excluded = evaluateVerificationSessionReviewObservation(approved, {
    repository: 'sec-platform/sec', prNumber: 42, headSha: HEAD,
    excludedPrincipalNodeIds: new Set([BOT]), observedAt: '2026-08-09T14:01:00.000Z'
  });
  expect(excluded.status).toBe('waiting');
});

test('production Review authority adapter cannot have its private transport reflectively replaced', () => {
  const client = createVerificationSessionGitHubClient(process.cwd());
  expect(Reflect.set(client as object, 'transport', new FakeTransport())).toBe(false);
  expect(Object.getOwnPropertyNames(client)).not.toContain('transport');
});

test('private GitHub candidate projects immutable parents from the existing merge commit response', () => {
  const parentShas = Object.freeze([BASE, '8'.repeat(40)]);
  const candidate = observePrivateMergedCandidate(parentShas);
  expect(candidate.mergeCommitParentShas).toEqual(parentShas);
  expect(Object.isFrozen(candidate.mergeCommitParentShas)).toBe(true);
  expect(Object.isFrozen(candidate)).toBe(true);
});

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
  test(`private gh ${mode} boundary binds distinct raw pages only into typed digests`, () => {
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
  });
}

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
  expect(observe(retiredTrustedMarker)).toMatchObject({ status: 'waiting',
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
  const formalAuthority = observe(formalApp);
  expect(formalAuthority).toMatchObject({ status: 'clear',
    authority: { sourceTransport: 'github-graphql' } });

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
    override candidate(): GitHubCandidateObservation {
      const candidate = super.candidate();
      this.reads += 1;
      return this.reads === 1 ? candidate : { ...candidate, headSha: '3'.repeat(40) };
    }
  }
  const drift = new DriftingTransport();
  drift.issueComments = [[botIssueComment()]];
  expect(observe(drift)).toMatchObject({ status: 'blocked', reason: 'review-observation-head-drift' });
});

test('candidate merge-parent observation rejects partial or malformed identity without imposing squash policy', () => {
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
  expect(() => observe(new CandidateTransport(merged))).not.toThrow();

  for (const mergeCommitParentShas of [
    null,
    Object.freeze([BASE, BASE]),
    Object.freeze(['A'.repeat(40)])
  ] as const) {
    expectTypedProviderSchemaUnsupported(observe(new CandidateTransport({
      ...merged,
      mergeCommitParentShas
    })));
  }
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
  expect(evaluateVerificationSessionWorkflowJoin(workflow, {
    repository: 'sec-platform/sec', prNumber: 42, sessionRevision: JOIN_SESSION,
    actionPlanDigest: JOIN_ACTION, baseSha: BASE, now: '2026-08-09T14:05:00Z'
  })).toMatchObject({ status: 'joined', reason: 'active-run' });
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
    const inventory = parseGitHubPullRequestFileInventory({ repository: 'sec-platform/sec', prNumber: 42,
      beforeSource: metadata,
      pagesSource: JSON.stringify([paths.map((filename) => ({ filename, status: 'modified' }))]),
      afterSource: metadata });
    return evaluateVerificationSessionChangedPaths(
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
  expect(evaluateVerificationSessionChangedPaths(
    { pullRequestFileInventory: () => complete }, expected
  )).toEqual(complete);

  const expectIdentityMismatchBeforeEffect = (
    inventory: ReturnType<typeof parseGitHubPullRequestFileInventory>
  ) => {
    let authorizationReached = false;
    let physicalMergeReached = false;
    expect(() => {
      const observed = evaluateVerificationSessionChangedPaths(
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
  expect(() => files({ filename: 'src/file.ts', previous_filename: 'src/old.ts', status: 'modified' }))
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
  const hydrated = evaluateGitHubRepositoryActionsArtifactInventory({
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
  const unrelatedOnly = evaluateGitHubRepositoryActionsArtifactInventory({
    repository: 'sec-platform/sec', source: thousandUnrelated,
    observeArtifact: () => { unrelatedHydrationCalls += 1; throw new Error('must not hydrate unrelated'); }
  });
  expect(unrelatedOnly.artifacts).toEqual([]);
  expect(unrelatedHydrationCalls).toBe(0);

  const expectPreHydrationFailure = (mutate: (pages: any[]) => void, message: RegExp) => {
    const pages = structuredClone(source);
    mutate(pages);
    let calls = 0;
    expect(() => evaluateGitHubRepositoryActionsArtifactInventory({
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

  expect(() => evaluateGitHubRepositoryActionsArtifactInventory({
    repository: 'sec-platform/sec', source,
    observeArtifact: (entry) => ({ artifactId: entry.artifactId, artifactName: entry.artifactName,
      archiveDigest: null, workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE,
      runId: entry.expectedRunId!, runAttempt: entry.sessionRunAttempt!,
      eventName: 'repository_dispatch', actorNodeId: BOT, actorPermission: 'write', expired: false })
  })).toThrow(/hydration differs from its selected summary identity/i);
});

test('platform 403 is recorded as unavailable and never as no-bypass proof', () => {
  const transport = new FakeTransport();
  const error = new Error('upgrade plan') as Error & { statusCode?: number };
  error.statusCode = 403;
  transport.rulesetError = error;
  const observation = evaluatePlatformEnforcementObservation({
    repository: 'sec-platform/sec', readRulesets: () => transport.repositoryRulesets()
  });
  expect(observation.status).toBe('platform-enforcement-unavailable');
  expect(observation.reason).toContain('unavailable');
  expect(observation.rulesetDigest as SessionDigest).toMatch(/^sha256:/);
});

test('MainHealth preserves exact states while repair remains semantic routing without physical authority', () => {
  const common = { repository: 'sec-platform/sec', mainSha: BASE, mainTreeSha: BASE, trustRevision: BASE,
    observedAt: '2026-08-09T14:00:00.000Z', expiresAt: '2026-08-09T14:10:00.000Z', sourceRunId: '7',
    sourceRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${BASE}` };
  expect(createObservedMainHealthInput({ ...common, checks: [mainHealthCheck()] })).toMatchObject({
    status: 'healthy', allowedLanes: ['ordinary'], owner: null, repairWorkPackage: null
  });
  expect(createObservedMainHealthInput({ ...common,
    checks: [mainHealthCheck({ eventName: 'repository_dispatch' })] })).toMatchObject({
    status: 'healthy', allowedLanes: ['ordinary'], owner: null, repairWorkPackage: null
  });
  const degradedInput = createObservedMainHealthInput({
    ...common,
    checks: [mainHealthCheck({ conclusion: 'failure' })]
  });
  expect(degradedInput).toMatchObject({
    status: 'degraded', allowedLanes: CI_MAIN_HEALTH_POLICY.degraded.allowedLanes,
    owner: CI_MAIN_HEALTH_POLICY.degraded.owner
  });
  expect(degradedInput.repairWorkPackage).toBe(createMainHealthRepairWorkPackagePath({
    repository: common.repository,
    defaultBranch: 'main',
    mainSha: common.mainSha,
    mainTreeSha: common.mainTreeSha,
    owner: CI_MAIN_HEALTH_POLICY.degraded.owner,
    failureFingerprints: degradedInput.failureFingerprints
  }));
  const degradedLedger = createMainHealthLedger(degradedInput);
  expect(resolveRepairMainHealthLane({
    ledger: degradedLedger, now: '2026-08-09T14:01:00.000Z',
    expectedRepository: common.repository, expectedDefaultBranch: 'main',
    expectedMainSha: common.mainSha, expectedMainTreeSha: common.mainTreeSha,
    expectedTrustRevision: common.trustRevision
  })).toMatchObject({ status: 'degraded', allowed: true });
  expect(resolveOrdinaryMainHealthLane({
    ledger: degradedLedger, now: '2026-08-09T14:01:00.000Z',
    expectedRepository: common.repository, expectedDefaultBranch: 'main',
    expectedMainSha: common.mainSha, expectedMainTreeSha: common.mainTreeSha,
    expectedTrustRevision: common.trustRevision
  })).toMatchObject({ status: 'locked', allowed: false });
  expect(CI_MAIN_HEALTH_POLICY.degraded).toMatchObject({
    repairIdentityPolicy: 'exact-main-tree-failure-v1',
    allowedLanes: ['repair']
  });
  for (const checks of [[], [mainHealthCheck({ status: 'in_progress', conclusion: null })],
    [mainHealthCheck(), mainHealthCheck({ id: 8 })], [mainHealthCheck({ appId: 1 })]]) {
    expect(createObservedMainHealthInput({ ...common, checks })).toMatchObject({ status: 'locked', allowedLanes: [] });
  }
  const ledger = createMainHealthLedger(createObservedMainHealthInput({ ...common,
    checks: [mainHealthCheck()] }));
  for (const expected of [
    { expectedRepository: 'attacker/fork', expectedDefaultBranch: 'main' },
    { expectedRepository: 'sec-platform/sec', expectedDefaultBranch: 'release' }
  ]) {
    expect(resolveOrdinaryMainHealthLane({ ledger, now: '2026-08-09T14:01:00.000Z',
      ...expected, expectedMainSha: BASE, expectedMainTreeSha: BASE,
      expectedTrustRevision: BASE })).toMatchObject({ status: 'locked', allowed: false });
  }
});

test('MainHealth accepts one exact dispatch and locks duplicate or foreign producers', () => {
  const common = { repository: 'sec-platform/sec', mainSha: BASE, mainTreeSha: BASE, trustRevision: BASE,
    observedAt: '2026-08-09T14:00:00.000Z', expiresAt: '2026-08-09T14:10:00.000Z', sourceRunId: '7',
    sourceRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${BASE}` };
  const dispatched = mainHealthCheck({ id: 8 });
  const exact = createObservedMainHealthInput({ ...common, checks: [dispatched] });
  expect(exact).toMatchObject({
    status: 'healthy', allowedLanes: ['ordinary'], failureFingerprints: []
  });
  expect(createObservedMainHealthInput({
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
  expect(createObservedMainHealthInput({
    ...common,
    checks: [dispatched, unrelatedActivation]
  })).toEqual(exact);
  expect(createObservedMainHealthInput({
    ...common,
    checks: [unrelatedActivation]
  })).toMatchObject({ status: 'locked', allowedLanes: [] });
  const wrongOperationDispatch = mainHealthCheck({
    id: 12,
    eventName: 'repository_dispatch',
    conclusion: 'skipped',
    workflowRunDisplayTitle: CI_MAIN_HEALTH_POLICY.producer.runTitleFormats.repositoryDispatch
      .replace('<exact-main-sha>', BASE)
      .replace('<request-operation-id>', `sha256:${'a'.repeat(64)}`)
  });
  expect(createObservedMainHealthInput({
    ...common,
    checks: [dispatched, wrongOperationDispatch]
  })).toEqual(exact);
  expect(createObservedMainHealthInput({
    ...common,
    checks: [wrongOperationDispatch]
  })).toMatchObject({ status: 'locked', allowedLanes: [] });
  const failedDispatch = mainHealthCheck({ id: 8, conclusion: 'failure' });
  const singleFailure = createObservedMainHealthInput({ ...common, checks: [failedDispatch] });
  expect(singleFailure).toMatchObject({
    status: 'degraded', allowedLanes: CI_MAIN_HEALTH_POLICY.degraded.allowedLanes,
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
    expect(createObservedMainHealthInput({ ...common, checks })).toMatchObject({
      status: 'locked', allowedLanes: [], failureFingerprints: [expect.stringMatching(/^sha256:/)]
    });
  }
});

test('IssueDisposition post-main readback consumes the canonical exact MainHealth decision', () => {
  const common = {
    repository: 'sec-platform/sec', newMainSha: BASE, newMainTreeSha: HEAD,
    observedAt: '2026-08-09T14:00:00.000Z', sourceRunId: '200',
    sourceRef: `.github/workflows/merge-gate.yml@${BASE}`
  };
  const dispatched = mainHealthCheck({ id: 8 });
  const single = compilePostMainIssueDispositionHealthReadback({ ...common, checks: [dispatched] });
  expect(single).toMatchObject({
    repository: common.repository, mainSha: common.newMainSha, mainTreeSha: common.newMainTreeSha,
    trustRevision: common.newMainSha, status: 'healthy', allowedLanes: ['ordinary']
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

test('trusted-main proposal and hosted sole issuer reconstruct the same stable Session revision', async () => {
  const TEST_IMPACT_SOURCE_PROVIDER = await testImpactSourceProvider();
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const barrier = observe(transport);
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const candidate = transport.candidate();
  const changedPaths = ['src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const testImpactTransition = changedTransition(changedPaths);
  const manifestDigest = `sha256:${'b'.repeat(64)}` as const;
  const local = prepareTrustedMainVerificationSession({ repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER, profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '1',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: barrier.observedAt, reviewBarrier: barrier,
    mainHealthChecks: [mainHealthCheck()], dependencyBlobs: actionDependencyBlobs() });
  const facts = reconstructVerificationSessionHostedFacts({ request: local.request,
    repository: candidate.repository, candidate, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '2',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, observedAt: barrier.observedAt,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs() });
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
  expect(() => prepareTrustedMainVerificationSession({ repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER, profile: 'quick',
    integrationPrincipalNodeId: 'INTEGRATOR', producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '1',
    sourceRef: `refs/heads/main@${BASE}`, observedAt: barrier.observedAt, reviewBarrier: barrier,
    mainHealthChecks: [mainHealthCheck()], dependencyBlobs: actionDependencyBlobs('bun.lock') }))
    .toThrow(/bun\.lock drifted from the trusted base/i);
  expect(() => reconstructVerificationSessionHostedFacts({ request: local.request,
    repository: candidate.repository, candidate, changedPaths, testImpactTransition,
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
    integrationPrincipalNodeId: 'INTEGRATOR',
    producerPrincipalNodeId: 'INTEGRATOR', sourceRunId: '2',
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, observedAt: barrier.observedAt,
    reviewBarrier: barrier, mainHealthChecks: [mainHealthCheck()],
    dependencyBlobs: actionDependencyBlobs('package.json') }))
    .toThrow(/package\.json drifted from the trusted base/i);
});

test('VerificationSession binds the exact deletion transition through Scope, Action, Session, and hosted reconstruction', async () => {
  const TEST_IMPACT_SOURCE_PROVIDER = await testImpactSourceProvider();
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
  const testImpactTransition = CreateTestImpactTransitionObservation({
    baseSha, headSha, records, readPathBlob
  });
  const reordered = CreateTestImpactTransitionObservation({
    baseSha, headSha, records: [...records].reverse(), readPathBlob
  });
  expect(TestImpactTransitionDigest(reordered))
    .toBe(TestImpactTransitionDigest(testImpactTransition));

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
    workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${baseSha}`
  })];
  const manifestDigest = `sha256:${'e'.repeat(64)}` as const;
  const unownedTransition = CreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: [{ status: 'removed', path: unownedRetiredPath }],
    readPathBlob: (revision, repositoryPath) => (
      revision === baseSha && repositoryPath === unownedRetiredPath
        ? { mode: '100644', blobSha: '4'.repeat(40) }
        : null
    )
  });
  expect(() => prepareTrustedMainVerificationSession({
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
  const prepared = prepareTrustedMainVerificationSession({
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
});

test('same paths with a different Git transition change the complete VerificationSession identity chain', async () => {
  const TEST_IMPACT_SOURCE_PROVIDER = await testImpactSourceProvider();
  const transport = new FakeTransport();
  transport.issueComments = [[botIssueComment()]];
  const barrier = observe(transport);
  if (barrier.status !== 'clear') throw new Error('expected clear review');
  const candidate = transport.candidate();
  const changedPaths = ['src/adapters/verification/platform/ci/runtime/verification-session.ts'];
  const prepare = (status: 'added' | 'changed') => prepareTrustedMainVerificationSession({
    repository: candidate.repository, candidate,
    manifestPath: 'config/repository/work-packages/example.md', manifestDigest: `sha256:${'e'.repeat(64)}`,
    changedPaths,
    testImpactTransition: CreateTestImpactTransitionObservation({
      baseSha: candidate.baseSha, headSha: candidate.headSha,
      records: [{ status, path: changedPaths[0]! }], readPathBlob: () => null
    }),
    testImpactSourceProvider: TEST_IMPACT_SOURCE_PROVIDER,
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

test('Session local quick DAG keeps durable journals in external Runtime State and executes exact detached candidate', async () => {
  const TEST_IMPACT_SOURCE_PROVIDER = await testImpactSourceProvider();
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
    const testImpactTransitionDigest = TestImpactTransitionDigest(testImpactTransition);
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
    expect(existsSync(path.join(runtimeStateRoot, 'workspaces', 'records'))).toBe(true);
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
    policy: REVIEW_STABILITY_POLICY,
    principal: { kind: 'github-app', actorNodeId: BOT, appId: 1144995,
      appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' },
    independence: { candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR' },
    producer: { identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: `github-review-observer:sec-platform/sec:42:${HEAD}`,
      providerIdentity: 'github', candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
      trustedRevision: REVIEW_STABILITY_POLICY.trustedRevision,
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

test('CLI rejects caller-provided authority artifacts', async () => {
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

test('actual reducer recovers a crash after remote merge without a second merge or publication', async () => {
  const fixture = await reducerFixture();
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

test('durable comment and merge markers reconstruct terminal status without an Actions artifact', async () => {
  const fixture = await reducerFixture();
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

test('MERGED recovery permits advanced main only when the marker commit remains reachable', async () => {
  const advancedMain = '8'.repeat(40);
  const reachable = await reducerFixture({ remoteDefaultSha: advancedMain,
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
  ] satisfies GitHubComparisonObservation[]) {
    const blocked = await reducerFixture({ remoteDefaultSha: advancedMain, mergeToDefault: comparison });
    try {
      blocked.transport.adoptMerged(blocked.markers, blocked.result.reviewReceipt,
        blocked.artifact.session.sessionRevision);
      expect(() => runReducer(blocked)).toThrow(/ancestor|reachability/i);
    } finally {
      blocked.dispose();
    }
  }
  const invalidBase = await reducerFixture({ baseToMerge: { status: 'diverged', behindBy: 1 } });
  try {
    invalidBase.transport.adoptMerged(invalidBase.markers, invalidBase.result.reviewReceipt,
      invalidBase.artifact.session.sessionRevision);
    expect(() => runReducer(invalidBase)).toThrow(/old base ancestry/i);
  } finally {
    invalidBase.dispose();
  }
});

test('MERGED reachability permits detached old-base only with synchronized post-merge default', async () => {
  const advancedMain = '8'.repeat(40);
  const fixture = await reducerFixture({ remoteDefaultSha: advancedMain,
    mergeToDefault: { status: 'ahead', behindBy: 0 } });
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
    expect(() => assertTrustedMergedRequestRuntimeReachability(input)).not.toThrow();
    expect(() => assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, localDefaultSha: BASE } })).toThrow(/synchronized local\/live default/i);
    expect(() => assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, localDefaultSha: 'f'.repeat(40) } })).toThrow(/synchronized local\/live default/i);
    expect(() => assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, currentBranch: 'feature/foreign' } })).toThrow(/old-base trusted TCB/i);
    expect(() => assertTrustedMergedRequestRuntimeReachability({ ...input,
      proof: { ...proof, currentHeadSha: HEAD } })).toThrow(/old-base trusted TCB/i);
  } finally {
    fixture.dispose();
  }
});

test('actual reducer rejects OPEN base/head drift before any merge claim or effect', async () => {
  for (const [field, value] of [
    ['baseSha', 'f'.repeat(40)],
    ['headSha', 'e'.repeat(40)]
  ] as const) {
    const fixture = await reducerFixture();
    try {
      fixture.transport.observation = { ...fixture.transport.observation, [field]: value };
      expect(() => runReducer(fixture)).toThrow(/live .* drifted/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer rejects expired or already-consumed authorization before merge', async () => {
  for (const options of [
    { authorizationExpiresAt: '2026-08-09T14:06:00.000Z', now: '2026-08-09T14:07:00.000Z' },
    { consumed: true }
  ]) {
    const fixture = await reducerFixture(options);
    try {
      expect(() => runReducer(fixture)).toThrow(/expired|already consumed/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer binds IntegrationAuthorization to trusted live repository and PR', async () => {
  for (const identity of [
    { repository: 'attacker/fork' },
    { prNumber: 99 }
  ]) {
    const fixture = await reducerFixture();
    try {
      fixture.setAuthorizationResult(substituteAuthorizationLiveIdentity(fixture, identity));
      expect(() => runReducer(fixture)).toThrow(/repository|prNumber/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer rejects downloaded merge-result digest or provenance substitution', async () => {
  for (const mutate of [
    (value: Record<string, any>) => { value.resultDigest = `sha256:${'f'.repeat(64)}`; },
    (value: Record<string, any>) => { value.provenance.sourceRunId = 'forged-run'; }
  ]) {
    const fixture = await reducerFixture();
    try {
      const value = JSON.parse(encodeVerificationActionData(fixture.result)) as Record<string, any>;
      mutate(value);
      fixture.setAuthorizationResult(JSON.stringify(value));
      expect(() => runReducer(fixture)).toThrow(/digest|provenance|issuer/i);
    } finally {
      fixture.dispose();
    }
  }
});

test('actual reducer blocks merged-tree mismatch and blocked/residue closeout terminals', async () => {
  const mismatch = await reducerFixture();
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
    const fixture = await reducerFixture({ closeout: terminal });
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

test('reducer emits one stable integration intent and never executes a physical merge', async () => {
  const fixture = await reducerFixture();
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
    override reviewPage(): GitHubPage<GitHubReviewObservation> {
      return page([], true, null);
    }
  }
  const transport = new IncompletePaginationTransport();
  transport.issueComments = [[botIssueComment()]];
  expectTypedProviderSchemaUnsupported(observe(transport));
});

test('remote Session workflow join covers active and artifact-publication states without redispatch', () => {
  const joined = (transport: FakeTransport, now = '2026-08-09T14:05:00.000Z') =>
    evaluateVerificationSessionWorkflowJoin(transport, {
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

test('two independent local coordinators join one provider run and send only one wake-up signal', () => {
  const transport = new FakeTransport();
  const coordinate = () => {
    const join = evaluateVerificationSessionWorkflowJoin(transport, { repository: 'sec-platform/sec',
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
  expect(evaluateVerificationSessionWorkflowJoin(paged, adapterInput))
    .toMatchObject({ status: 'joined', runIds: ['9:1'] });

  const providerPresentationName = new FakeTransport();
  providerPresentationName.workflowRuns = [[workflowRun({ name: 'mutable provider presentation' })]];
  expect(evaluateVerificationSessionWorkflowJoin(providerPresentationName, adapterInput))
    .toMatchObject({ status: 'joined', runIds: ['10:1'] });

  const duplicate = new FakeTransport();
  duplicate.workflowRuns = [[workflowRun()], [workflowRun({ status: 'waiting' })]];
  expect(() => evaluateVerificationSessionWorkflowJoin(duplicate, adapterInput))
    .toThrow(/duplicate run\/attempt/i);

  const conflict = new FakeTransport();
  conflict.workflowRuns = [[workflowRun({ displayTitle:
    `verify session PR #42 session ${JOIN_SESSION} action sha256:${'8'.repeat(64)}` })]];
  expect(() => evaluateVerificationSessionWorkflowJoin(conflict, adapterInput))
    .toThrow(/conflicting run identity/i);

  const wrongWorkflow = new FakeTransport();
  wrongWorkflow.workflowRuns = [[workflowRun({ workflowPath: '.github/workflows/foreign.yml' })]];
  expect(() => evaluateVerificationSessionWorkflowJoin(wrongWorkflow, adapterInput))
    .toThrow(/conflicting run identity/i);

  class IncompleteWorkflowPaginationTransport extends FakeTransport {
    override workflowRunPage(): GitHubPage<GitHubWorkflowRunObservation> {
      return page([], true, null);
    }
  }
  expect(() => evaluateVerificationSessionWorkflowJoin(
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
if (args[0] === 'rev-parse' && args[1] === '--path-format=absolute'
  && args[2] === '--git-common-dir') out(state.commonDir + '\\n');
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
  if (JSON.stringify(args) === JSON.stringify([
    'for-each-ref', '--format=%(refname)%00%(symref)%00%(objectname)%00', 'refs/heads/'
  ])) {
    let value = 'refs/heads/main\\0\\0' + state.baseSha + '\\0\\n';
    if (state.localPresent) value += branchRef + '\\0\\0' + state.headSha + '\\0\\n';
    out(value);
  }
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
  if (String(args[2]).includes('src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts')) fail('missing enforcement marker');
  out('');
}
if (JSON.stringify(args) === JSON.stringify(['update-ref', '--no-deref', '--stdin'])) {
  const transcript = readFileSync(0, 'utf8');
  const expected = ['start', 'delete ' + branchRef + ' ' + state.headSha, 'prepare', 'commit', ''].join('\\n');
  if (transcript !== expected || state.localPresent !== true) fail('non-canonical local ref CAS transaction');
  state.localPresent = false;
  state.localDeleteCount += 1;
  save(state);
  out('start: ok\\nprepare: ok\\ncommit: ok\\n');
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
if (endpoint.includes('/contents/src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts')) fail('HTTP 404 Not Found');
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
  out([{ workflow_runs: [{ id: 200,
    name: 'integrate compiler session run 100 attempt 1',
    display_title: 'integrate compiler session run 100 attempt 1',
    path: '.github/workflows/merge-gate.yml', event: 'workflow_run',
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
  const policy = CI_GITHUB_ACTIONS_IDENTITY_POLICY;
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

async function withCloseoutHarnessCommands<T>(
  shimRoot: string,
  statePath: string,
  recoveryRoot: string,
  run: () => T | Promise<T>
): Promise<Awaited<T>> {
  const previous = {
    path: process.env.PATH,
    state: process.env.SEC_CLOSEOUT_TEST_STATE,
    recovery: process.env.SEC_BRANCH_RECOVERY_ROOT
  };
  process.env.PATH = `${shimRoot}${path.delimiter}${previous.path ?? ''}`;
  process.env.SEC_CLOSEOUT_TEST_STATE = statePath;
  process.env.SEC_BRANCH_RECOVERY_ROOT = recoveryRoot;
  try {
    return await run();
  } finally {
    if (previous.path === undefined) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.state === undefined) delete process.env.SEC_CLOSEOUT_TEST_STATE;
    else process.env.SEC_CLOSEOUT_TEST_STATE = previous.state;
    if (previous.recovery === undefined) delete process.env.SEC_BRANCH_RECOVERY_ROOT;
    else process.env.SEC_BRANCH_RECOVERY_ROOT = previous.recovery;
  }
}

let closeoutTcbClosureIdentity: ReturnType<typeof compileTcbClosureIdentity> | null = null;

function closeoutTcbModuleBlobs(): Readonly<Record<string, string>> {
  closeoutTcbClosureIdentity ??= compileTcbClosureIdentity();
  return closeoutTcbClosureIdentity.moduleBlobs;
}

async function createCloseoutCliScenario(input: {
  harnessRoot: string;
  recoveryHarnessRoot: string;
  shimRoot: string;
  name: string;
  fixture: Awaited<ReturnType<typeof reducerFixture>>;
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
  mkdirSync(path.join(root, 'config', 'external-capabilities'), { recursive: true });
  writeFileSync(path.join(root, 'config', 'external-capabilities', 'ledger.yaml'),
    readFileSync(path.resolve(import.meta.dir,
      '../../config/external-capabilities/ledger.yaml')));
  mkdirSync(commonDir, { recursive: true });
  const statePath = path.join(root, 'provider-state.json');
  const tcbBlobs: Record<string, string> = { ...closeoutTcbModuleBlobs() };
  for (const edge of TRUSTED_BOOTSTRAP_REGISTRY.reviewedBoundaryEdges) {
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
    runtimeBlob: tcbBlobs['src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts'] ?? 'e'.repeat(40),
    publisher: CI_GITHUB_ACTIONS_IDENTITY_POLICY,
    phaseStepNames: HOSTED_INTEGRATION_PHASE_STEP_NAMES,
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
      100: { id: 100, run_attempt: 1, status: 'completed', conclusion: 'success',
        workflow_id: 307443415, event: 'repository_dispatch',
        path: '.github/workflows/compiler-pr-validation.yml', head_sha: BASE,
        actor: { login: 'integrator', node_id: 'INTEGRATOR' },
        triggering_actor: { login: 'integrator', node_id: 'INTEGRATOR' },
        repository: { id: 123 } },
      199: { id: 199, run_attempt: 1, event: 'workflow_run',
        path: '.github/workflows/merge-gate.yml', head_sha: BASE,
        actor: { login: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login,
          id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.id,
          node_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId,
          type: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.type },
        triggering_actor: { login: 'integrator', node_id: 'INTEGRATOR' }, repository: { id: 123 } },
      200: { id: 200, run_attempt: currentRunAttempt, event: 'workflow_run',
        path: '.github/workflows/merge-gate.yml', head_sha: BASE,
        actor: { login: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login,
          id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.id,
          node_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId,
          type: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.type }, triggering_actor: {
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
  const prepared = await withCloseoutHarnessCommands(input.shimRoot, statePath, providerRecoveryRoot, () => (
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
  const rehydratedPrepared = await withCloseoutHarnessCommands(input.shimRoot, statePath, recoveryRoot,
    () => rehydratePreparedBranchCloseoutRecoveryArtifact({
      scope: { repositoryRoot: root },
      remote: prepared,
      recoveryBundleBytes
    }));
  const recoveryArtifact = createBranchCloseoutRecoveryArtifact({
    repository: 'sec-platform/sec',
    pullRequestNumber: 42,
    sessionRevision: input.fixture.artifact.session.sessionRevision,
    headSha: HEAD,
    headTreeSha: HEAD,
    preparedEnvelopeBytes: `${JSON.stringify(prepared, null, 2)}\n`,
    recoveryBundleBytes
  });
  const rehydratedRecoveryArtifact = createBranchCloseoutRecoveryArtifact({
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
    artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
    artifactDigest: recoveryArtifact.artifactDigest,
    runId: '200',
    runAttempt: 1
  });
  const canonicalCommentProvenance = (runId: string) => createHostedWorkflowCommentProvenance({
    repositoryId: '123',
    workflowPath: '.github/workflows/merge-gate.yml',
    workflowRef: `.github/workflows/merge-gate.yml@${BASE}`,
    workflowSha: BASE,
    runId,
    runAttempt: 1,
    eventName: 'workflow_run',
    sourceRunId: '100',
    sourceRunAttempt: 1,
    actorLogin: 'integrator',
    actorNodeId: 'INTEGRATOR',
    actorPermission: 'maintain',
    app: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app
  });
  const provenance = canonicalCommentProvenance('200');
  const authorizationPublication = createIntegrationAuthorizationOperationPublication({
    result: input.fixture.result,
    closeoutPreparation: prepared,
    recoveryArtifact: recoveryObservation,
    provenance
  });
  const authorizationCommentId = 90;
  const binding = createBranchCloseoutOperationBinding({
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
  const effectStart = createBranchCloseoutEffectStartPublication({
    ...effectStartInput,
    phase: { runId: '200', runAttempt: 1, jobId: '300', jobName: 'integrate',
      phase: 'closeoutMutation', stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
      stepNumber: 3, workflowSha: BASE },
    provenance
  });
  const oldProvenance = canonicalCommentProvenance('199');
  const oldEffectStart = createBranchCloseoutEffectStartPublication({
    ...effectStartInput,
    phase: { runId: '199', runAttempt: 1, jobId: '299', jobName: 'integrate',
      phase: 'closeoutMutation', stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
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
  const markers = integrationAuthorizationMergeMarkers({
    sessionRevision: input.fixture.artifact.session.sessionRevision,
    authorizationId: authorizationPublication.authorizationId,
    authorizationReceiptDigest: authorizationPublication.authorizationReceiptDigest,
    consumptionOperationId: authorizationPublication.consumptionOperationId,
    authorizationPublicationId: authorizationPublication.authorizationPublicationId,
    authorizationPublicationDigest: authorizationPublication.publicationDigest,
    commentId: authorizationCommentId
  });
  state.mergeMessage = `Verified integration ${input.fixture.artifact.session.sessionRevision.slice(7, 19)}`
    + `\n\n${markers.join('\n')}\n${renderIndependentReviewTrailer(input.fixture.result.reviewReceipt)}`;
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
      'verification-session-artifact.json': `${encodeVerificationActionData(input.fixture.artifact)}\n`
    },
    [recoveryName]: {
      [BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME]:
        `${encodeVerificationActionData(providerRecoveryArtifact)}\n`
    }
  };
  writeCloseoutCliHarnessState(statePath, state);
  const eventPath = path.join(root, 'event.json');
  writeFileSync(eventPath, `${JSON.stringify({
    action: 'completed',
    repository: { id: 123, full_name: 'sec-platform/sec' },
    sender: { login: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login },
    workflow_run: { id: 100, run_attempt: 1 }
  }, null, 2)}\n`, 'utf8');
  return { root, statePath, recoveryRoot, eventPath, binding, effectStart,
    crashReleasePath: baseState.crashReleasePath as string,
    providerPrepared: prepared, rehydratedPrepared };
}

function runCloseoutCliProcess(
  shimRoot: string,
  scenario: Awaited<ReturnType<typeof createCloseoutCliScenario>>,
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
    path.resolve(import.meta.dir, '../../src/adapters/verification/platform/ci/runtime/verification-session.ts'),
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
  scenario: Awaited<ReturnType<typeof createCloseoutCliScenario>>,
  command: 'closeout-mutate-hosted' | 'closeout-publish-hosted'
) {
  const state = readCloseoutCliHarnessState(scenario.statePath);
  state.invocationCount = Number(state.invocationCount ?? 0) + 1;
  writeCloseoutCliHarnessState(scenario.statePath, state);
  const output = path.join(scenario.root, `${command}-${state.invocationCount}.json`);
  const environment = closeoutCliProcessEnvironment(shimRoot, scenario);
  const ghResolution = resolveCloseoutCliGh(environment);
  const child = spawn(process.execPath, [
    path.resolve(import.meta.dir, '../../src/adapters/verification/platform/ci/runtime/verification-session.ts'),
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
  scenario: Awaited<ReturnType<typeof createCloseoutCliScenario>>
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
      'sec-platform/sec/.github/workflows/merge-gate.yml@refs/heads/main',
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
  scenario: Awaited<ReturnType<typeof createCloseoutCliScenario>>
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
  testImpactFixture?.dispose();
  if (sharedCloseoutCliShimSuiteRoot !== '') {
    rmSync(sharedCloseoutCliShimSuiteRoot, { recursive: true, force: true });
  }
  if (privateGhProxySuiteRoot !== '') {
    rmSync(privateGhProxySuiteRoot, { recursive: true, force: true });
  }
});

async function withCloseoutCliPartition<T>(run: (input: Readonly<{
  harnessRoot: string;
  recoveryHarnessRoot: string;
  shimRoot: string;
  fixture: Awaited<ReturnType<typeof reducerFixture>>;
}>) => T | Promise<T>): Promise<Awaited<T>> {
  const harnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-cli-'));
  const recoveryHarnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-recovery-'));
  const fixture = await reducerFixture();
  try {
    return await run({ harnessRoot, recoveryHarnessRoot, shimRoot: sharedCloseoutCliShimRoot, fixture });
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
  fixture: Awaited<ReturnType<typeof reducerFixture>>;
}>) => Promise<T>): Promise<T> {
  const harnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-cli-'));
  const recoveryHarnessRoot = mkdtempSync(path.join(tmpdir(), 'sec-verification-session-v6-recovery-'));
  const fixture = await reducerFixture();
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

closeoutCliE2eTest('trusted remote default ref synchronization closes ordinary merge and merged recovery safely', async () => {
  await withCloseoutCliPartition(async ({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const runRecovery = async (name: string, configure?: (state: CloseoutCliHarnessState) => void) => {
      const scenario = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
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

    const exact = await runRecovery('ref-sync-exact');
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

    const failed = await runRecovery('ref-sync-fetch-failure', (state) => {
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

    const raced = await runRecovery('ref-sync-race', (state) => {
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

closeoutCliE2eTest('public Session closeout CLI partition A exact delete, publish, and reuse', async () => {
  await withCloseoutCliPartition(async ({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const exact = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
      name: 'exact', fixture });
    expect(encodeVerificationActionData(exact.providerPrepared))
      .not.toBe(encodeVerificationActionData(exact.rehydratedPrepared));
    expect(exact.providerPrepared.preparation.recovery.path)
      .not.toBe(exact.rehydratedPrepared.preparation.recovery.path);
    expect(exact.providerPrepared.preparation.preparationDigest)
      .toBe(exact.rehydratedPrepared.preparation.preparationDigest);
    expect(encodeVerificationActionData(exact.providerPrepared.before))
      .toBe(encodeVerificationActionData(exact.rehydratedPrepared.before));
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
    const crash = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
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

closeoutCliE2eTest('public Session closeout CLI partition C rejects invalid existing markers without delete', async () => {
  await withCloseoutCliPartition(async ({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    for (const seed of ['null-app', 'wrong-app', 'duplicate', 'old'] as const) {
      const blocked = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
        name: seed, fixture, seed });
      const result = runCloseoutCliProcess(shimRoot, blocked, 'closeout-mutate-hosted');
      expect(result.result.status).not.toBe(0);
      expect(readCloseoutCliHarnessState(blocked.statePath)).toMatchObject({
        remoteDeleteCount: 0, remotePresent: true
      });
    }
  });
}, 180_000);

closeoutCliE2eTest('public Session closeout CLI partition D rejects authority tamper without delete', async () => {
  await withCloseoutCliPartition(async ({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    for (const tamper of ['original', 'artifact', 'stable-digest'] as const) {
      const blocked = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
        name: `tampered-${tamper}`, fixture, tamper });
      const result = runCloseoutCliProcess(shimRoot, blocked, 'closeout-mutate-hosted');
      expect(result.result.status).not.toBe(0);
      expect(readCloseoutCliHarnessState(blocked.statePath)).toMatchObject({
        remoteDeleteCount: 0, remotePresent: true
      });
    }
  });
}, 180_000);

closeoutCliE2eTest('public Session closeout CLI partition E lost marker POST and replay perform zero delete', async () => {
  await withCloseoutCliPartition(async ({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const lost = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
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

closeoutCliE2eTest('V9 integration reruns retain producing attempts and authorize fresh integration after pre-gate expiry', async () => {
  const stalePreGateAt = '2026-08-09T14:07:00.000Z';
  const stalePreGate = await reducerFixture({ mergeAt: stalePreGateAt });
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

  await withCloseoutCliPartition(async ({ harnessRoot, recoveryHarnessRoot, shimRoot, fixture }) => {
    const samePrincipal = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
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

    const delegatedMaintainer = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot,
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

    const writeOnly = await createCloseoutCliScenario({ harnessRoot, recoveryHarnessRoot, shimRoot,
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

    const historicalAttemptMismatch = await createCloseoutCliScenario({ harnessRoot,
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
  expect(JSON.stringify(rehydrated.foreignWorktreeObservations)).not.toContain(remoteWorktreePath);
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
  const { REVIEW_STABILITY_POLICY: loadedReviewStabilityPolicy, createReviewStabilityReceipt: loadedCreateReviewStabilityReceipt } =
    await import('../../src/adapters/verification/platform/review/contract/stability.ts');
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
    policy: loadedReviewStabilityPolicy,
    principal,
    independence: { candidateAuthorNodeId: 'USER_author', integrationPrincipalNodeId: 'USER_integrator' },
    snapshot,
    reviewedAt: '2026-08-09T00:00:00.000Z',
    expiresAt: '2026-08-09T01:00:00.000Z'
  };
  expect(() => loadedCreateReviewStabilityReceipt({
      ...baseInput,
      producer: {
        identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
        executionIdentity: VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY,
        providerIdentity: 'github',
        candidateWriteCapability: 'read-only',
        capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
        trustedRevision: loadedReviewStabilityPolicy.trustedRevision,
        sourceTransport: 'github-graphql',
        sourceRunId: 'run-1',
        sourceRef: 'pull/345',
        sourceDigest: snapshot.snapshotDigest
      }
    }))
    .toThrow('canonical independent read-only observer execution');
});
