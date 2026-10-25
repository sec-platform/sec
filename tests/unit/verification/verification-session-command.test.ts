import { expect, test } from 'bun:test';
import { assertHostedSquashMergeCompletion, classifyDurableVerificationSessionProjection, parseHostedSynchronousSquashMergeResponse, parseVerificationSessionCommand, planHostedIntegrationEffects, routeHostedIntegration, verificationSessionCli, verificationSessionExecutionPlacement } from '../../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA, parseVerificationSessionHostedRequest } from '../../../src/adapters/verification/platform/ci/contract/session-request.ts';
import { createReviewSnapshotDigest, createReviewStabilityReceipt, renderIndependentReviewTrailer, REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, SEC_REVIEW_STABILITY_POLICY } from '../../../src/adapters/verification/platform/review/contract/stability.ts';
import { executeHostedSessionCompilerCommand } from '../../../src/bootstrap/development/closeout/verification-session-hosted.ts';
import { worktreePhysicalCloseoutOperations } from '../../../src/bootstrap/runtime-state/worktree-closeout.ts';
import { parseHostedVerificationCommand } from '../../../src/entry/verification-session-hosted-cli.ts';
import type { GitHubCandidateObservation, VerificationSession } from '../../../src/execution/verification/session.ts';

test('command parsing preserves each supported operation and its arguments', () => {
  const invocations = [
    ['project', '--default-ref', 'main'],
    ['prepare', '--pr', '42', '--request-output', 'request.json', '--execution', 'hosted'],
    ['revalidate-review-provider', '--pr', '42'],
    ['observe-hosted', '--request', 'request.json', '--output', 'facts.json'],
    ['prepare-hosted', '--request', 'request.json', '--facts', 'facts.json', '--output', 'envelope.json'],
    ['artifact-status', '--artifact', 'artifact.json'],
    ['finalize-hosted', '--envelope', 'envelope.json', '--evidence', 'evidence.json', '--output', 'artifact.json'],
    ['local-main-closeout', '--repository', 'sec-platform/sec', '--pr', '42', '--protected-root', '/repo', '--expected-local-head', 'a'.repeat(40)],
    ['resume', '--request', 'request.json', '--execution', 'hosted'],
    ['freeze', '--artifact', 'artifact.json', '--session-output', 'session.json', '--scope-output', 'scope.json'],
    ['status', '--request', 'request.json', '--execution', 'local'],
    ['status-offline', '--session-file', 'session.json']
  ];
  for (const invocation of invocations) {
    const parsed = parseVerificationSessionCommand([...invocation, '--json']);
    expect(parsed.command === invocation[0]).toBe(true);
    expect(parsed.repository).toBe('sec-platform/sec');
    expect([...parsed.args]).toEqual(invocation.slice(1).reduce<[string, string][]>((pairs, value, index, values) => {
      if (index % 2 === 0) pairs.push([value, values[index + 1]!]);
      return pairs;
    }, []));
  }
});

test('command parsing rejects missing, inherited, and unsupported command names', () => {
  expect(() => parseVerificationSessionCommand([])).toThrow(/Unknown command/);
  for (const command of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty', '', 'Prepare', ' prepare', 'prepare ', 'integrate-hosted']) {
    expect(() => parseVerificationSessionCommand([command])).toThrow(/Unknown command/);
  }
});

// The production entry supplies process.argv strings. Missing values and bad
// argument text remain reachable; object conversion hooks do not cross argv.
test('command parsing rejects missing flag values and unsupported argument text', () => {
  expect(() => parseVerificationSessionCommand(['resume', '--request']))
    .toThrow(/Missing value for --request/);
  expect(() => parseVerificationSessionCommand(['resume', '--request', '--json']))
    .toThrow(/Missing value for --request/);
  expect(() => parseVerificationSessionCommand(['resume', 'request.json']))
    .toThrow(/Unknown argument: request\.json/);
});

const BASE_SHA = '1'.repeat(40);
const HEAD_SHA = '2'.repeat(40);
const JOIN_SESSION_DIGEST = `sha256:${'6'.repeat(64)}` as const;

test('hosted integration router separates first effect, merged recovery, and blocking', () => {
  const session = { repository: 'sec-platform/sec', prNumber: 42,
    sessionRevision: JOIN_SESSION_DIGEST, baseSha: BASE_SHA, baseTreeSha: BASE_SHA,
    headSha: HEAD_SHA, headTreeSha: HEAD_SHA } as VerificationSession;
  const candidate: GitHubCandidateObservation = {
    repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
    isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE_SHA,
    baseTreeSha: BASE_SHA, headBranch: 'feat/example', headSha: HEAD_SHA, headTreeSha: HEAD_SHA,
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
    mergeCommitSha: '9'.repeat(40), mergeCommitTreeSha: HEAD_SHA,
    mergeCommitMessage: 'marker-bound merge',
    mergeCommitParentShas: Object.freeze(['8'.repeat(40)]) };
  const merged = routeHostedIntegration({ repository: 'sec-platform/sec', session,
    candidate: mergedCandidate, priorEffectStarted: true, authorizationPublicationCount: 1 });
  expect(merged).toMatchObject({ lane: 'merged-recovery', mergeCommitSha: '9'.repeat(40),
    mergeCommitTreeSha: HEAD_SHA });
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
    candidate: { ...mergedCandidate, mergeCommitTreeSha: BASE_SHA }, priorEffectStarted: true,
    authorizationPublicationCount: 1 })).toMatchObject({
      lane: 'blocked', reason: 'merged-readback-incomplete-or-tree-mismatch'
    });
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

// Stable fixture inputs; no slow Session graph or GitHub source transport required.
const FAST_PAGE_DIGEST = `sha256:${'a'.repeat(64)}` as const;
const FAST_BOT_NODE_ID = 'BOT_kgDOC98s_g';

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
  const reviewSnapshotBase = { paginationComplete: true as const, reviewedHeadSha: HEAD_SHA,
    reviewPageDigests: [FAST_PAGE_DIGEST], threadPageDigests: [FAST_PAGE_DIGEST], reviewCount: 1, threadCount: 0,
    unresolvedBlockingThreadCount: 0 as const, requestChangesPrincipalIds: [] as readonly [] };
  const reviewSnapshot = { ...reviewSnapshotBase,
    snapshotDigest: createReviewSnapshotDigest(reviewSnapshotBase) };
  const reviewReceipt = createReviewStabilityReceipt({ stage: 'pre-merge', repository: 'sec-platform/sec',
    prNumber: 42, sessionRevision: FAST_PAGE_DIGEST, scopeAuthorizationRevision: FAST_PAGE_DIGEST,
    scopeAuthorizationReceiptDigest: FAST_PAGE_DIGEST, headSha: HEAD_SHA, headTreeSha: HEAD_SHA,
    policy: SEC_REVIEW_STABILITY_POLICY,
    principal: { kind: 'github-app', actorNodeId: FAST_BOT_NODE_ID, appId: 1144995,
      appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' },
    independence: { candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR' },
    producer: { identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: `github-review-observer:sec-platform/sec:42:${HEAD_SHA}`,
      providerIdentity: 'github', candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY.trustedRevision,
      sourceTransport: 'github-graphql', sourceRunId: 'run-1', sourceRef: 'pull/42',
      sourceDigest: reviewSnapshot.snapshotDigest }, snapshot: reviewSnapshot,
    reviewedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z' });
  const closure = { markers, reviewReceipt, expectedTitle, expectedBaseSha: BASE_SHA } as const;
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
    isCrossRepository: false, authorNodeId: 'AUTHOR', baseBranch: 'main', baseSha: BASE_SHA,
    baseTreeSha: BASE_SHA, headBranch: 'feat/example', headSha: HEAD_SHA, headTreeSha: HEAD_SHA,
    title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
    mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null,
    mergeCommitParentShas: null
  };
  expect(() => assertHostedSquashMergeCompletion({ candidate: queued,
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: provider.sha }))
    .toThrow(/merge-queue enqueue is not integration success/);
  const merged = { ...queued, state: 'MERGED' as const,
    mergeCommitSha, mergeCommitTreeSha: HEAD_SHA,
    mergeCommitParentShas: Object.freeze([BASE_SHA]),
    mergeCommitMessage: `${expectedTitle}\n\n${markers.join('\n')}\n${renderIndependentReviewTrailer(reviewReceipt)}` };
  expect(() => assertHostedSquashMergeCompletion({ candidate: merged,
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: provider.sha })).not.toThrow();
  expect(() => assertHostedSquashMergeCompletion({ candidate: merged,
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: null })).not.toThrow();
  for (const mergeCommitParentShas of [
    null,
    Object.freeze([]),
    Object.freeze([BASE_SHA, '8'.repeat(40)]),
    Object.freeze(['8'.repeat(40)])
  ] as const) {
    expect(() => assertHostedSquashMergeCompletion({
      candidate: { ...merged, mergeCommitParentShas },
      expectedHeadSha: HEAD_SHA,
      expectedHeadTreeSha: HEAD_SHA,
      ...closure,
      providerMergeCommitSha: provider.sha
    })).toThrow(/squash merge parent does not equal the verified base/i);
  }
  expect(() => assertHostedSquashMergeCompletion({
    candidate: { ...merged, baseSha: '8'.repeat(40),
      mergeCommitParentShas: Object.freeze(['8'.repeat(40)]) },
    expectedHeadSha: HEAD_SHA,
    expectedHeadTreeSha: HEAD_SHA,
    ...closure,
    providerMergeCommitSha: provider.sha
  })).toThrow(/squash merge parent does not equal the verified base/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: queued,
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: null })).toThrow(/not physically complete/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: merged,
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: '8'.repeat(40) })).toThrow(/provider response does not match/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: { ...merged, headSha: BASE_SHA },
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/mismatched head or merge tree/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: { ...merged, mergeCommitTreeSha: BASE_SHA },
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/mismatched head or merge tree/i);
  expect(() => assertHostedSquashMergeCompletion({ candidate: { ...merged, mergeCommitMessage: 'other' },
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA, ...closure,
    providerMergeCommitSha: provider.sha })).toThrow(/authorization markers/i);
});

test('durable remote projection blocks closed PR and OPEN candidate identity drift', () => {
  // The original slow case supplied the HEAD tree as its expected BASE tree,
  // so even its unchanged OPEN input was blocked. Require a valid baseline.
  const candidate: GitHubCandidateObservation = {
    repository: 'sec-platform/sec', number: 42, state: 'OPEN', isDraft: false,
    isCrossRepository: false, authorNodeId: 'AUTHOR',
    baseBranch: 'main', baseSha: BASE_SHA, baseTreeSha: BASE_SHA,
    headBranch: 'feat/example', headSha: HEAD_SHA, headTreeSha: HEAD_SHA,
    title: 'Safe candidate', body: 'Issue-Disposition: progress-only',
    mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null,
    mergeCommitParentShas: null
  };
  const request = parseVerificationSessionHostedRequest(JSON.stringify({
    schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA, prNumber: 42,
    expectedBaseSha: BASE_SHA, expectedBaseTreeSha: BASE_SHA,
    expectedHeadSha: HEAD_SHA, expectedHeadTreeSha: HEAD_SHA,
    manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v6.md',
    manifestDigest: `sha256:${'1'.repeat(64)}`, profile: 'quick',
    expectedScopeProposalDigest: `sha256:${'2'.repeat(64)}`,
    expectedActionPlanDigest: `sha256:${'7'.repeat(64)}`,
    expectedSessionRevision: JOIN_SESSION_DIGEST,
    reviewPolicyDigest: `sha256:${'3'.repeat(64)}`,
    requestOperationId: `sha256:${'4'.repeat(64)}`
  }));
  const classify = (observed: GitHubCandidateObservation) =>
    classifyDurableVerificationSessionProjection({
      repository: 'sec-platform/sec', request, candidate: observed, publications: []
    });
  expect(classify(candidate)).toBeNull();
  for (const changed of [
    { state: 'CLOSED' as const },
    { baseSha: 'f'.repeat(40) },
    { baseTreeSha: 'f'.repeat(40) },
    { headSha: 'e'.repeat(40) },
    { headTreeSha: 'e'.repeat(40) }
  ]) {
    expect(classify({ ...candidate, ...changed })).toMatchObject({ status: 'BLOCKED' });
  }
});
