import { expect, test } from 'bun:test';

import { CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES, CODEX_CLEAN_REVIEW_CONGRATULATIONS, CODEX_CLEAN_REVIEW_VERDICT_PREFIX, REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, REVIEW_STABILITY_POLICY, assertMergeTrailerLines, assertReviewStabilityReceiptCurrent, createReviewSnapshotDigest, createReviewStabilityPolicy, createReviewStabilityReceipt, isCodexCleanReviewAboutBlock, isCodexCleanReviewVerdict, parseReviewStabilityPolicy, parseReviewStabilityReceipt, renderIndependentReviewTrailer, type ReviewSnapshot, type ReviewStabilityReceiptInput } from '../../src/adapters/verification/platform/review/contract/stability.ts';

test('Codex clean Review verdict owns one stable semantic prefix and closed presentation grammar', () => {
  expect(isCodexCleanReviewVerdict(CODEX_CLEAN_REVIEW_VERDICT_PREFIX)).toBe(true);
  for (const congratulation of CODEX_CLEAN_REVIEW_CONGRATULATIONS) {
    expect(isCodexCleanReviewVerdict(
      `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} ${congratulation}`
    )).toBe(true);
  }

  for (const [label, value] of [
    ['null', null],
    ['wrong heading', '### 💡 Codex Review'],
    ['prefix drift', `Prefix ${CODEX_CLEAN_REVIEW_VERDICT_PREFIX}`],
    ['missing separator', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX}Bravo.`],
    ['double separator', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX}  Bravo.`],
    ['trailing space', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} Bravo. `],
    ['finding after congratulation', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} Delightful! Finding: P1 unsafe behavior`],
    ['newline suffix', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} Bravo.\nFinding`],
    ['NUL suffix', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} Bravo.\u0000`],
    ['finding text', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} Finding: P1 unsafe behavior`],
    ['free-form reassurance', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} No unsafe behavior here.`],
    ['overlong congratulation', `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} ${'x'.repeat(201)}`]
  ] as const) expect(isCodexCleanReviewVerdict(value), label).toBe(false);

  const canonicalAbout = CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES.join('\n\n');
  expect(isCodexCleanReviewAboutBlock(canonicalAbout)).toBe(true);
  expect(isCodexCleanReviewAboutBlock(
    canonicalAbout.replace('</details>', '### P1 finding\n</details>')
  )).toBe(false);
  expect(isCodexCleanReviewAboutBlock(
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
  overrides: Partial<Omit<ReviewSnapshot, 'snapshotDigest'>> = {}
): ReviewSnapshot {
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
  return Object.freeze({ ...value, snapshotDigest: createReviewSnapshotDigest(value) });
}

function input(
  overrides: Partial<ReviewStabilityReceiptInput> = {}
): ReviewStabilityReceiptInput {
  return {
    stage: 'pre-merge',
    repository: 'sec-platform/sec',
    prNumber: 11,
    sessionRevision: D_A,
    scopeAuthorizationRevision: D_B,
    scopeAuthorizationReceiptDigest: D_C,
    headSha: SHA_A,
    headTreeSha: TREE_A,
    policy: REVIEW_STABILITY_POLICY,
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
      identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: 'github-review-observer:sec-platform/sec:11:exact-head',
      providerIdentity: 'github',
      candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
      trustedRevision: REVIEW_STABILITY_POLICY.trustedRevision,
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

function receipt(overrides: Partial<ReviewStabilityReceiptInput> = {}) {
  return createReviewStabilityReceipt(input(overrides));
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
  expect(parseReviewStabilityReceipt(JSON.stringify(current))).toEqual(current);
  expect(() => assertReviewStabilityReceiptCurrent(current, live(current))).not.toThrow();
  expect(() => assertReviewStabilityReceiptCurrent(current, {
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
  expect(() => assertReviewStabilityReceiptCurrent(current, live(current))).not.toThrow();
});

test('human reviewer node IDs remain opaque while rejecting unsafe bounds', () => {
  const paddedNodeId = 'MDQ6VXNlcjU4MzIzMQ==';
  const current = receipt({
    principal: { kind: 'human', nodeId: paddedNodeId, approvalState: 'APPROVED' }
  });
  expect(current.principal).toEqual({
    kind: 'human', nodeId: paddedNodeId, approvalState: 'APPROVED'
  });

  for (const [label, nodeId] of [
    ['empty', ''],
    ['space', 'USER reviewer'],
    ['newline', 'USER\nreviewer'],
    ['overlong', 'x'.repeat(257)],
    ['non-ASCII', '用户']
  ] as const) {
    expect(() => receipt({
      principal: { kind: 'human', nodeId, approvalState: 'APPROVED' }
    }), label).toThrow('bounded GitHub node ID');
  }
});

test('Review policy digest binds every canonical App identity field', () => {
  const cases = [
    ['actor node', { ...TRUSTED_APP, actorNodeId: 'BOT_other' }],
    ['app ID', { ...TRUSTED_APP, appId: TRUSTED_APP.appId + 1 }],
    ['app node', { ...TRUSTED_APP, appNodeId: 'A_other' }],
    ['app slug', { ...TRUSTED_APP, appSlug: 'other-app' }]
  ] as const;
  for (const [label, trustedApp] of cases) {
    const changed = createReviewStabilityPolicy({
      policyId: REVIEW_STABILITY_POLICY.policyId,
      trustedRevision: REVIEW_STABILITY_POLICY.trustedRevision,
      trustedApps: [trustedApp],
      allowIndependentHumanApproval: REVIEW_STABILITY_POLICY.allowIndependentHumanApproval
    });
    expect(changed.policyDigest, label).not.toBe(REVIEW_STABILITY_POLICY.policyDigest);
  }
});

test('Review policy rejects missing, extra, type-drifted, or non-canonical App identity fields', () => {
  const missing: readonly [string, Record<string, unknown>][] = [
    ['missing actor node', { appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug }],
    ['missing app ID', { actorNodeId: TRUSTED_APP.actorNodeId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug }],
    ['missing app node', { actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appSlug: TRUSTED_APP.appSlug }],
    ['missing app slug', { actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId }]
  ];
  const invalid: readonly [string, Record<string, unknown>][] = [
    ['extra field', { ...TRUSTED_APP, extra: true }],
    ['empty actor node', { ...TRUSTED_APP, actorNodeId: '' }],
    ['overlong actor node', { ...TRUSTED_APP, actorNodeId: 'x'.repeat(257) }],
    ['invalid actor node', { ...TRUSTED_APP, actorNodeId: 'BOT invalid' }],
    ['string app ID', { ...TRUSTED_APP, appId: '1144995' }],
    ['zero app ID', { ...TRUSTED_APP, appId: 0 }],
    ['fractional app ID', { ...TRUSTED_APP, appId: 1.5 }],
    ['empty app node', { ...TRUSTED_APP, appNodeId: '' }],
    ['overlong app node', { ...TRUSTED_APP, appNodeId: 'x'.repeat(257) }],
    ['invalid app node', { ...TRUSTED_APP, appNodeId: 'A invalid' }],
    ['empty app slug', { ...TRUSTED_APP, appSlug: '' }],
    ['overlong app slug', { ...TRUSTED_APP, appSlug: 'x'.repeat(101) }],
    ['uppercase app slug', { ...TRUSTED_APP, appSlug: 'ChatGPT-Codex-Connector' }],
    ['underscore app slug', { ...TRUSTED_APP, appSlug: 'chatgpt_codex_connector' }]
  ];
  for (const [label, trustedApp] of [...missing, ...invalid]) {
    expect(() => createReviewStabilityPolicy({
      policyId: 'invalid-policy', trustedRevision: 'trust-v1',
      trustedApps: [trustedApp] as never,
      allowIndependentHumanApproval: true
    }), label).toThrow();
  }
});

test('Review receipt rejects missing, wrong, case-drifted, type-drifted, or extra App identity', () => {
  const missing: readonly [string, Record<string, unknown>][] = [
    ['missing actor node', { kind: 'github-app', appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug, reviewState: 'COMMENTED' }],
    ['missing app ID', { kind: 'github-app', actorNodeId: TRUSTED_APP.actorNodeId, appNodeId: TRUSTED_APP.appNodeId, appSlug: TRUSTED_APP.appSlug, reviewState: 'COMMENTED' }],
    ['missing app node', { kind: 'github-app', actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appSlug: TRUSTED_APP.appSlug, reviewState: 'COMMENTED' }],
    ['missing app slug', { kind: 'github-app', actorNodeId: TRUSTED_APP.actorNodeId, appId: TRUSTED_APP.appId, appNodeId: TRUSTED_APP.appNodeId, reviewState: 'COMMENTED' }]
  ];
  const wrong: readonly [string, Record<string, unknown>][] = [
    ['wrong actor node', { kind: 'github-app', ...TRUSTED_APP, actorNodeId: 'BOT_other', reviewState: 'COMMENTED' }],
    ['case-drifted actor node', { kind: 'github-app', ...TRUSTED_APP, actorNodeId: TRUSTED_APP.actorNodeId.toLowerCase(), reviewState: 'COMMENTED' }],
    ['wrong app ID', { kind: 'github-app', ...TRUSTED_APP, appId: TRUSTED_APP.appId + 1, reviewState: 'COMMENTED' }],
    ['string app ID', { kind: 'github-app', ...TRUSTED_APP, appId: String(TRUSTED_APP.appId), reviewState: 'COMMENTED' }],
    ['wrong app node', { kind: 'github-app', ...TRUSTED_APP, appNodeId: 'A_other', reviewState: 'COMMENTED' }],
    ['case-drifted app node', { kind: 'github-app', ...TRUSTED_APP, appNodeId: TRUSTED_APP.appNodeId.toLowerCase(), reviewState: 'COMMENTED' }],
    ['wrong app slug', { kind: 'github-app', ...TRUSTED_APP, appSlug: 'other-app', reviewState: 'COMMENTED' }],
    ['case-drifted app slug', { kind: 'github-app', ...TRUSTED_APP, appSlug: TRUSTED_APP.appSlug.toUpperCase(), reviewState: 'COMMENTED' }],
    ['extra field', { kind: 'github-app', ...TRUSTED_APP, reviewState: 'COMMENTED', extra: true }]
  ];
  for (const [label, principal] of [...missing, ...wrong]) {
    expect(() => receipt({ principal: principal as never }), label).toThrow();
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
    expect(() => assertReviewStabilityReceiptCurrent(current, {
      ...live(current),
      ...override
    } as never), label).toThrow('drift');
  }
});

test('Review semantic revision changes for every decision field', () => {
  const current = receipt();
  const alternatePolicy = createReviewStabilityPolicy({
    policyId: 'alternate-policy',
    trustedRevision: REVIEW_STABILITY_POLICY.trustedRevision,
    trustedApps: [TRUSTED_APP],
    allowIndependentHumanApproval: true
  });
  const cases: readonly [string, ReviewStabilityReceiptInput][] = [
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
    expect(createReviewStabilityReceipt(candidate).reviewRevision, label)
      .not.toBe(current.reviewRevision);
  }
});

test('Review receipt provenance changes receipt digest but not semantic revision', () => {
  const current = receipt();
  const cases: readonly [string, Partial<ReviewStabilityReceiptInput>][] = [
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
  const left = createReviewStabilityPolicy({
    policyId: 'ordered-policy', trustedRevision: 'trust-v1',
    trustedApps: [appB, appA],
    allowIndependentHumanApproval: true
  });
  const right = createReviewStabilityPolicy({
    policyId: 'ordered-policy', trustedRevision: 'trust-v1',
    trustedApps: [appA, appB],
    allowIndependentHumanApproval: true
  });
  expect(left.policyDigest).toBe(right.policyDigest);
  expect(() => createReviewStabilityPolicy({
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
  const invalid: readonly [string, Partial<ReviewStabilityReceiptInput>][] = [
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
  const invalidReceipts: readonly [string, Record<string, unknown>][] = [
    ['schema drift', { ...current, schema: 'unknown' }],
    ['extra receipt field', { ...current, extra: true }],
    ['receipt digest tampering', { ...current, receiptDigest: D_A }]
  ];
  for (const [label, candidate] of invalidReceipts) {
    expect(() => parseReviewStabilityReceipt(JSON.stringify(candidate)), label).toThrow();
  }
  const policy = REVIEW_STABILITY_POLICY;
  for (const [label, candidate] of [
    ['extra policy field', { ...policy, extra: true }],
    ['policy schema drift', { ...policy, schema: 'unknown' }]
  ] as const) {
    expect(() => parseReviewStabilityPolicy(JSON.stringify(candidate)), label).toThrow();
  }
});

test('Review constructor rejects equal issue/expiry times', () => {
  expect(() => receipt({ expiresAt: '2026-08-09T00:00:00.000Z' })).toThrow('after reviewedAt');
});

test('an Independent-* trailer derives only from a validated receipt', () => {
  const current = receipt();
  const canonical = renderIndependentReviewTrailer(current);
  expect(canonical).toMatch(
    /^Independent-Exact-Head-Review: receipt=sha256:[0-9a-f]{64} revision=sha256:[0-9a-f]{64} threads=[0-9]+ unresolved=0$/u
  );
  expect(canonical).not.toContain('P0=');
  expect(() => assertMergeTrailerLines([canonical], current)).not.toThrow();

  // PR #345 shape: the implementation-session self-review trailer with
  // free-text P0/P1/P2 counts never matches a validated receipt trailer.
  for (const [label, lines] of [
    ['free-text P-count trailer', ['Independent-Exact-Head-Review: P0=0 P1=0 P2=0']],
    ['free-text review trailer', ['Independent-Exact-Head-Review: review=passed confidence=high']],
    ['unbound additional trailer', [canonical, 'Independent-Review: something-else']]
  ] as const) {
    expect(() => assertMergeTrailerLines(lines, current), label)
      .toThrow('unbound Independent-* trailer');
  }
});
