import { expect, test } from 'bun:test';
import { parseVerificationSessionCommand, planHostedIntegrationEffects, routeHostedIntegration } from '../../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
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

test('command parsing rejects nonprimitive command names without coercion', () => {
  let coercions = 0;
  const pretendCommand = {
    [Symbol.toPrimitive]() { coercions += 1; return 'prepare'; },
    toString() { coercions += 1; return 'prepare'; },
    valueOf() { coercions += 1; return 'prepare'; }
  };
  for (const command of [undefined, null, false, 0, Symbol('prepare'), ['prepare'], new String('prepare'), pretendCommand]) {
    expect(() => parseVerificationSessionCommand([command])).toThrow(/Unknown command/);
  }
  expect(coercions).toBe(0);
});

test('command parsing never invokes caller methods or admits nonprimitive flag values', () => {
  let callerMethodCalls = 0;
  const pretendText = {
    startsWith() { callerMethodCalls += 1; return false; },
    toString() { callerMethodCalls += 1; return 'request.json'; }
  };
  expect(() => parseVerificationSessionCommand(['resume', pretendText])).toThrow(/must be a string/);
  for (const value of [undefined, null, false, 42, Symbol('request.json'), ['request.json'], new String('request.json'), pretendText]) {
    expect(() => parseVerificationSessionCommand(['resume', '--request', value])).toThrow(/Missing value/);
  }
  expect(callerMethodCalls).toBe(0);
  expect(parseVerificationSessionCommand(['resume', '--request', 'request.json']).args.get('--request')).toBe('request.json');
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
