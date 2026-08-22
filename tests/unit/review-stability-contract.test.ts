import { expect, test } from 'bun:test';

import {
  CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES_V1,
  CODEX_CLEAN_REVIEW_CONGRATULATIONS_V1,
  CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1,
  REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT_V1,
  REVIEW_STABILITY_POLICY_SCHEMA_V1,
  REVIEW_STABILITY_RECEIPT_SCHEMA_V1,
  SEC_REVIEW_STABILITY_POLICY_V1,
  assertMergeTrailerLinesV1,
  assertReviewStabilityReceiptCurrentV1,
  createReviewSnapshotDigestV1,
  createReviewStabilityPolicyV1,
  createReviewStabilityReceiptV1,
  isCodexCleanReviewAboutBlockV1,
  isCodexCleanReviewVerdictV1,
  parseReviewStabilityPolicyV1,
  parseReviewStabilityReceiptV1,
  renderIndependentReviewTrailerV1,
  type ReviewSnapshotV1,
  type ReviewStabilityReceiptInputV1
} from '../../platform/shared/review-stability-contract.ts';

test('Codex clean Review verdict owns one stable semantic prefix and closed presentation grammar', () => {
  expect(isCodexCleanReviewVerdictV1(CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1)).toBe(true);
  for (const congratulation of CODEX_CLEAN_REVIEW_CONGRATULATIONS_V1) {
    expect(isCodexCleanReviewVerdictV1(
      `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} ${congratulation}`
    )).toBe(true);
  }

  for (const value of [
    null,
    '### 💡 Codex Review',
    `Prefix ${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1}`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1}Bravo.`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1}  Bravo.`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} Bravo. `,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} Delightful! Finding: P1 unsafe behavior`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} Bravo.\nFinding`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} Bravo.\u0000`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} Finding: P1 unsafe behavior`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} I found a P1 unsafe behavior.`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} No unsafe behavior here.`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} **P1 finding**.`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} hidden second line.`,
    `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX_V1} ${'x'.repeat(201)}`
  ]) expect(isCodexCleanReviewVerdictV1(value)).toBe(false);

  const canonicalAbout = CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES_V1.join('\n\n');
  expect(isCodexCleanReviewAboutBlockV1(canonicalAbout)).toBe(true);
  expect(isCodexCleanReviewAboutBlockV1(
    canonicalAbout.replace('</details>', '### P1 finding\n</details>')
  )).toBe(false);
  expect(isCodexCleanReviewAboutBlockV1(
    canonicalAbout.replace('Reviews are triggered when you', 'Provider help text.')
  )).toBe(false);
});

const SHA_A = '1'.repeat(40);
const SHA_B = '2'.repeat(40);
const TREE_A = '3'.repeat(40);
const TREE_B = '4'.repeat(40);
const D_A = `sha256:${'a'.repeat(64)}` as const;
const D_B = `sha256:${'b'.repeat(64)}` as const;
const D_C = `sha256:${'c'.repeat(64)}` as const;
const TRUSTED_APP = Object.freeze({
  actorNodeId: 'BOT_kgDOC98s_g',
  appId: 1144995,
  appNodeId: 'A_kwHOAOQ6Gs4AEXij',
  appSlug: 'chatgpt-codex-connector'
});

function snapshot(
  overrides: Partial<Omit<ReviewSnapshotV1, 'snapshotDigest'>> = {}
): ReviewSnapshotV1 {
  const value = {
    paginationComplete: true as const,
    reviewedHeadSha: SHA_A,
    reviewPageDigests: [D_A] as readonly typeof D_A[],
    threadPageDigests: [D_B] as readonly typeof D_B[],
    reviewCount: 1,
    threadCount: 0,
    unresolvedBlockingThreadCount: 0 as const,
    requestChangesPrincipalIds: [] as readonly [],
    ...overrides
  };
  return Object.freeze({ ...value, snapshotDigest: createReviewSnapshotDigestV1(value) });
}

function input(
  overrides: Partial<ReviewStabilityReceiptInputV1> = {}
): ReviewStabilityReceiptInputV1 {
  return {
    stage: 'pre-merge',
    repository: 'sec-platform/sec',
    prNumber: 11,
    sessionRevision: D_A,
    scopeAuthorizationRevision: D_B,
    scopeAuthorizationReceiptDigest: D_C,
    headSha: SHA_A,
    headTreeSha: TREE_A,
    policy: SEC_REVIEW_STABILITY_POLICY_V1,
    principal: {
      kind: 'github-app',
      ...TRUSTED_APP,
      reviewState: 'COMMENTED'
    },
    independence: {
      candidateAuthorNodeId: 'USER_author',
      integrationPrincipalNodeId: 'USER_integrator'
    },
    producer: {
      identity: 'scripts/codex/verification-session-github.ts',
      executionIdentity: 'github-review-observer:sec-platform/sec:11:exact-head',
      providerIdentity: 'github',
      candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT_V1,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
      sourceTransport: 'github-graphql',
      sourceRunId: 'comment-1',
      sourceRef: 'pull/11',
      sourceDigest: D_A
    },
    snapshot: snapshot(),
    reviewedAt: '2026-08-09T00:00:00.000Z',
    expiresAt: '2026-08-09T01:00:00.000Z',
    ...overrides
  };
}

function receipt(overrides: Partial<ReviewStabilityReceiptInputV1> = {}) {
  return createReviewStabilityReceiptV1(input(overrides));
}

function live(current = receipt()) {
  return {
    stage: current.stage,
    sessionRevision: current.sessionRevision,
    scopeAuthorizationRevision: current.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: current.scopeAuthorizationReceiptDigest,
    headSha: current.headSha,
    headTreeSha: current.headTreeSha,
    expectedPolicyDigest: current.policy.policyDigest,
    snapshotDigest: current.snapshot.snapshotDigest,
    expectedReviewRevision: current.reviewRevision,
    now: current.expiresAt
  };
}

test('registered stable App receipt round-trips and exact expiry boundary remains current', () => {
  const current = receipt();
  expect(current.policy.trustedApps).toEqual([TRUSTED_APP]);
  expect(current.principal).toEqual({ kind: 'github-app', ...TRUSTED_APP, reviewState: 'COMMENTED' });
  expect(current.schema).toBe(REVIEW_STABILITY_RECEIPT_SCHEMA_V1);
  expect(parseReviewStabilityReceiptV1(JSON.stringify(current))).toEqual(current);
  expect(() => assertReviewStabilityReceiptCurrentV1(current, live(current))).not.toThrow();
  expect(() => assertReviewStabilityReceiptCurrentV1(current, {
    ...live(current),
    now: '2026-08-09T01:00:00.001Z'
  })).toThrow('expired');
});

test('independent human APPROVED policy remains authorized', () => {
  const current = receipt({
    principal: { kind: 'human', nodeId: 'USER_reviewer', approvalState: 'APPROVED' }
  });
  expect(current.principal).toEqual({
    kind: 'human', nodeId: 'USER_reviewer', approvalState: 'APPROVED'
  });
  expect(() => assertReviewStabilityReceiptCurrentV1(current, live(current))).not.toThrow();
});

test('human reviewer node IDs remain opaque while rejecting unsafe bounds', () => {
  const paddedNodeId = 'MDQ6VXNlcjU4MzIzMQ==';
  const current = receipt({
    principal: { kind: 'human', nodeId: paddedNodeId, approvalState: 'APPROVED' }
  });
  expect(current.principal).toEqual({
    kind: 'human', nodeId: paddedNodeId, approvalState: 'APPROVED'
  });

  for (const nodeId of ['', 'USER reviewer', 'USER\nreviewer', 'x'.repeat(257), '用户']) {
    expect(() => receipt({
      principal: { kind: 'human', nodeId, approvalState: 'APPROVED' }
    })).toThrow('bounded GitHub node ID');
  }
});

test('Review policy digest binds every canonical App identity field', () => {
  const cases = [
    { ...TRUSTED_APP, actorNodeId: 'BOT_other' },
    { ...TRUSTED_APP, appId: TRUSTED_APP.appId + 1 },
    { ...TRUSTED_APP, appNodeId: 'A_other' },
    { ...TRUSTED_APP, appSlug: 'other-app' }
  ];
  for (const trustedApp of cases) {
    const changed = createReviewStabilityPolicyV1({
      policyId: SEC_REVIEW_STABILITY_POLICY_V1.policyId,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
      trustedApps: [trustedApp],
      allowIndependentHumanApproval: SEC_REVIEW_STABILITY_POLICY_V1.allowIndependentHumanApproval
    });
    expect(changed.policyDigest).not.toBe(SEC_REVIEW_STABILITY_POLICY_V1.policyDigest);
  }
});

test('Review policy rejects missing, extra, type-drifted, or non-canonical App identity fields', () => {
  const missing: readonly Record<string, unknown>[] = [
    { appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug },
    { actorNodeId: TRUSTED_APP.actorNodeId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug },
    { actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appSlug: TRUSTED_APP.appSlug },
    { actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId }
  ];
  const invalid: readonly Record<string, unknown>[] = [
    { ...TRUSTED_APP, extra: true },
    { ...TRUSTED_APP, actorNodeId: '' },
    { ...TRUSTED_APP, actorNodeId: 'x'.repeat(257) },
    { ...TRUSTED_APP, actorNodeId: 'BOT invalid' },
    { ...TRUSTED_APP, appId: '1144995' },
    { ...TRUSTED_APP, appId: 0 },
    { ...TRUSTED_APP, appId: 1.5 },
    { ...TRUSTED_APP, appNodeId: '' },
    { ...TRUSTED_APP, appNodeId: 'x'.repeat(257) },
    { ...TRUSTED_APP, appNodeId: 'A invalid' },
    { ...TRUSTED_APP, appSlug: '' },
    { ...TRUSTED_APP, appSlug: 'x'.repeat(101) },
    { ...TRUSTED_APP, appSlug: 'ChatGPT-Codex-Connector' },
    { ...TRUSTED_APP, appSlug: 'chatgpt_codex_connector' }
  ];
  for (const trustedApp of [...missing, ...invalid]) {
    expect(() => createReviewStabilityPolicyV1({
      policyId: 'invalid-policy', trustedRevision: 'trust-v1',
      trustedApps: [trustedApp] as never,
      allowIndependentHumanApproval: true
    })).toThrow();
  }
});

test('Review receipt rejects missing, wrong, case-drifted, type-drifted, or extra App identity', () => {
  const missing: readonly Record<string, unknown>[] = [
    { kind: 'github-app', appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug, reviewState: 'COMMENTED' },
    { kind: 'github-app', actorNodeId: TRUSTED_APP.actorNodeId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug, reviewState: 'COMMENTED' },
    { kind: 'github-app', actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appSlug: TRUSTED_APP.appSlug, reviewState: 'COMMENTED' },
    { kind: 'github-app', actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId, reviewState: 'COMMENTED' }
  ];
  const wrong: readonly Record<string, unknown>[] = [
    { kind: 'github-app', ...TRUSTED_APP, actorNodeId: 'BOT_other', reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, actorNodeId: TRUSTED_APP.actorNodeId.toLowerCase(), reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, appId: TRUSTED_APP.appId + 1, reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, appId: String(TRUSTED_APP.appId), reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, appNodeId: 'A_other', reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, appNodeId: TRUSTED_APP.appNodeId.toLowerCase(), reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, appSlug: 'other-app', reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, appSlug: TRUSTED_APP.appSlug.toUpperCase(), reviewState: 'COMMENTED' },
    { kind: 'github-app', ...TRUSTED_APP, reviewState: 'COMMENTED', extra: true }
  ];
  for (const principal of [...missing, ...wrong]) {
    expect(() => receipt({ principal: principal as never })).toThrow();
  }
});

test('every live result-changing Review binding drifts fail closed', () => {
  const current = receipt();
  const cases: readonly [string, Record<string, unknown>][] = [
    ['stage', { stage: 'pre-expensive' }],
    ['sessionRevision', { sessionRevision: D_C }],
    ['scopeAuthorizationRevision', { scopeAuthorizationRevision: D_C }],
    ['scopeAuthorizationReceiptDigest', { scopeAuthorizationReceiptDigest: D_A }],
    ['headSha', { headSha: SHA_B }],
    ['headTreeSha', { headTreeSha: TREE_B }],
    ['policy', { expectedPolicyDigest: D_A }],
    ['review snapshot', { snapshotDigest: D_C }],
    ['reviewRevision', { expectedReviewRevision: D_C }]
  ];
  for (const [label, override] of cases) {
    expect(() => assertReviewStabilityReceiptCurrentV1(current, {
      ...live(current),
      ...override
    } as never), label).toThrow('drift');
  }
});

test('Review semantic revision changes for every decision field', () => {
  const current = receipt();
  const alternatePolicy = createReviewStabilityPolicyV1({
    policyId: 'alternate-policy',
    trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
    trustedApps: [TRUSTED_APP],
    allowIndependentHumanApproval: true
  });
  const cases: readonly [string, ReviewStabilityReceiptInputV1][] = [
    ['stage', input({ stage: 'pre-expensive' })],
    ['repository', input({ repository: 'sec-platform/other' })],
    ['prNumber', input({ prNumber: 12 })],
    ['sessionRevision', input({ sessionRevision: D_C })],
    ['scopeAuthorizationRevision', input({ scopeAuthorizationRevision: D_C })],
    ['headSha', input({ headSha: SHA_B, snapshot: snapshot({ reviewedHeadSha: SHA_B }) })],
    ['headTreeSha', input({ headTreeSha: TREE_B })],
    ['policy', input({ policy: alternatePolicy })],
    ['principal', input({ principal: { kind: 'github-app', ...TRUSTED_APP, reviewState: 'APPROVED' } })],
    ['candidate author identity', input({ independence: { candidateAuthorNodeId: 'USER_other', integrationPrincipalNodeId: 'USER_integrator' } })],
    ['integration identity', input({ independence: { candidateAuthorNodeId: 'USER_author', integrationPrincipalNodeId: 'USER_other' } })],
    ['snapshot', input({ snapshot: snapshot({ reviewPageDigests: [D_C] }) })]
  ];
  for (const [label, candidate] of cases) {
    expect(createReviewStabilityReceiptV1(candidate).reviewRevision, label)
      .not.toBe(current.reviewRevision);
  }
});

test('Review receipt provenance changes receipt digest but not semantic revision', () => {
  const current = receipt();
  const cases: readonly [string, Partial<ReviewStabilityReceiptInputV1>][] = [
    ['scope receipt', { scopeAuthorizationReceiptDigest: D_A }],
    ['source transport', { producer: { ...input().producer, sourceTransport: 'github-rest' } }],
    ['source run', { producer: { ...input().producer, sourceRunId: 'comment-2' } }],
    ['source ref', { producer: { ...input().producer, sourceRef: 'pull/11/review/2' } }],
    ['source digest', { producer: { ...input().producer, sourceDigest: D_C } }],
    ['observation time', { reviewedAt: '2026-08-09T00:10:00.000Z', expiresAt: '2026-08-09T01:10:00.000Z' }]
  ];
  for (const [label, override] of cases) {
    const candidate = receipt(override);
    expect(candidate.reviewRevision, label).toBe(current.reviewRevision);
    expect(candidate.receiptDigest, label).not.toBe(current.receiptDigest);
  }
});

test('Review policy canonicalizes App set ordering and rejects duplicates', () => {
  const appA = Object.freeze({ actorNodeId: 'BOT_a', appId: 1, appNodeId: 'A_a', appSlug: 'app-a' });
  const appB = Object.freeze({ actorNodeId: 'BOT_b', appId: 2, appNodeId: 'A_b', appSlug: 'app-b' });
  const left = createReviewStabilityPolicyV1({
    policyId: 'ordered-policy', trustedRevision: 'trust-v1',
    trustedApps: [appB, appA],
    allowIndependentHumanApproval: true
  });
  const right = createReviewStabilityPolicyV1({
    policyId: 'ordered-policy', trustedRevision: 'trust-v1',
    trustedApps: [appA, appB],
    allowIndependentHumanApproval: true
  });
  expect(left.policyDigest).toBe(right.policyDigest);
  expect(() => createReviewStabilityPolicyV1({
    policyId: 'duplicate-policy', trustedRevision: 'trust-v1',
    trustedApps: [appA, appA],
    allowIndependentHumanApproval: true
  })).toThrow('unique');
});

test('Review rejects duplicate pagination observations and incomplete/blocking snapshots', () => {
  expect(() => receipt({ snapshot: snapshot({ reviewPageDigests: [D_A, D_A] }) }))
    .toThrow('duplicate');
  const invalidSnapshots: readonly [string, Record<string, unknown>][] = [
    ['pagination', { paginationComplete: false }],
    ['blocking threads', { unresolvedBlockingThreadCount: 1 }],
    ['request changes', { requestChangesPrincipalIds: ['USER_reviewer'] }],
    ['head marker', { reviewedHeadSha: SHA_B }],
    ['snapshot digest', { snapshotDigest: D_C }]
  ];
  for (const [label, override] of invalidSnapshots) {
    const current = snapshot() as unknown as Record<string, unknown>;
    expect(() => receipt({ snapshot: { ...current, ...override } as never }), label).toThrow();
  }
});

test('Review rejects untrusted or non-independent principals and invalid producer provenance', () => {
  const invalid: readonly [string, Partial<ReviewStabilityReceiptInputV1>][] = [
    ['app actor node', { principal: { kind: 'github-app', ...TRUSTED_APP, actorNodeId: 'BOT_other', reviewState: 'COMMENTED' } }],
    ['app id', { principal: { kind: 'github-app', ...TRUSTED_APP, appId: 1, reviewState: 'COMMENTED' } }],
    ['app node', { principal: { kind: 'github-app', ...TRUSTED_APP, appNodeId: 'A_other', reviewState: 'COMMENTED' } }],
    ['app slug', { principal: { kind: 'github-app', ...TRUSTED_APP, appSlug: 'other-app', reviewState: 'COMMENTED' } }],
    ['candidate author', { independence: { candidateAuthorNodeId: 'BOT_kgDOC98s_g', integrationPrincipalNodeId: 'USER_integrator' } }],
    ['integrator', { independence: { candidateAuthorNodeId: 'USER_author', integrationPrincipalNodeId: 'BOT_kgDOC98s_g' } }],
    ['producer trust', { producer: { ...input().producer, trustedRevision: 'other-trust' } }],
    ['producer transport', { producer: { ...input().producer, sourceTransport: 'unknown' as never } }],
    ['producer source digest', { producer: { ...input().producer, sourceDigest: 'bad' as never } }]
  ];
  for (const [label, override] of invalid) {
    expect(() => receipt(override), label).toThrow();
  }
});

test('Review parsers reject schema drift, extra fields, and digest tampering', () => {
  const current = receipt();
  const invalidReceipts = [
    { ...current, schema: 'unknown' },
    { ...current, extra: true },
    { ...current, receiptDigest: D_A }
  ];
  for (const candidate of invalidReceipts) {
    expect(() => parseReviewStabilityReceiptV1(JSON.stringify(candidate))).toThrow();
  }
  const policy = SEC_REVIEW_STABILITY_POLICY_V1;
  expect(policy.schema).toBe(REVIEW_STABILITY_POLICY_SCHEMA_V1);
  expect(() => parseReviewStabilityPolicyV1(JSON.stringify({ ...policy, extra: true }))).toThrow();
  expect(() => parseReviewStabilityPolicyV1(JSON.stringify({ ...policy, schema: 'unknown' }))).toThrow();
});

test('Review constructor rejects equal issue/expiry times', () => {
  expect(() => receipt({ expiresAt: '2026-08-09T00:00:00.000Z' })).toThrow('after reviewedAt');
});

test('an Independent-* trailer derives only from a validated receipt (#345 negative regression)', () => {
  const current = receipt();
  const canonical = renderIndependentReviewTrailerV1(current);
  expect(canonical).toMatch(
    /^Independent-Exact-Head-Review: receipt=sha256:[0-9a-f]{64} revision=sha256:[0-9a-f]{64} threads=[0-9]+ unresolved=0$/u
  );
  expect(canonical).not.toContain('P0=');
  expect(() => assertMergeTrailerLinesV1([canonical], current)).not.toThrow();

  // PR #345 shape: the implementation-session self-review trailer with
  // free-text P0/P1/P2 counts never matches a validated receipt trailer.
  expect(() => assertMergeTrailerLinesV1([
    'Independent-Exact-Head-Review: P0=0 P1=0 P2=0'
  ], current)).toThrow('unbound Independent-* trailer');
  expect(() => assertMergeTrailerLinesV1([
    'Independent-Exact-Head-Review: review=passed confidence=high'
  ], current)).toThrow('unbound Independent-* trailer');
  expect(() => assertMergeTrailerLinesV1([
    canonical,
    'Independent-Review: something-else'
  ], current)).toThrow('unbound Independent-* trailer');
});
