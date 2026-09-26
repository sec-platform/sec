import { expect, test } from 'bun:test';

import {
  assertIntegrationAuthorizationUsable,
  createIntegrationAuthorization,
  parseIntegrationAuthorization,
  type IntegrationAuthorizationInput,
  type IntegrationAuthorizationLiveState
} from '../../src/adapters/self-hosting/control/integration/authorization.ts';

const SHA_A = '1'.repeat(40);
const SHA_B = '2'.repeat(40);
const TREE_A = '3'.repeat(40);
const TREE_B = '4'.repeat(40);
const D_A = `sha256:${'a'.repeat(64)}` as const;
const D_B = `sha256:${'b'.repeat(64)}` as const;
const D_C = `sha256:${'c'.repeat(64)}` as const;

function issuer() {
  return {
    principalId: 'A0_node',
    producerIdentity: 'integration-runtime',
    trustedRevision: SHA_A,
    sourceTransport: 'trusted-integration-runtime' as const,
    sourceRunId: 'run-1',
    sourceRef: 'pull/11',
    sourceDigest: D_A
  };
}

function input(
  overrides: Partial<IntegrationAuthorizationInput> = {}
): IntegrationAuthorizationInput {
  return {
    consumptionOperationId: 'merge-pr-11',
    repository: 'sec-platform/sec',
    prNumber: 11,
    sessionRevision: D_A,
    baseSha: SHA_A,
    baseTreeSha: TREE_A,
    headSha: SHA_B,
    headTreeSha: TREE_B,
    manifestDigest: D_A,
    scopeAuthorizationRevision: D_B,
    scopeAuthorizationReceiptDigest: D_C,
    actionClosureDigest: D_A,
    evidenceDigest: D_B,
    reviewRevision: D_C,
    reviewReceiptDigest: D_A,
    reviewReportRevision: D_B,
    reviewReportDigest: D_C,
    mainHealthRevision: D_B,
    mainHealthReceiptDigest: D_C,
    trustRevision: SHA_A,
    rulesetDigest: D_A,
    issuedAt: '2026-08-09T00:00:00.000Z',
    expiresAt: '2026-08-09T01:00:00.000Z',
    issuer: issuer(),
    ...overrides
  };
}

function authorization(overrides: Partial<IntegrationAuthorizationInput> = {}) {
  return createIntegrationAuthorization(input(overrides));
}

function live(current = authorization()): IntegrationAuthorizationLiveState {
  return {
    now: current.expiresAt,
    consumedAuthorizationIds: new Set<string>(),
    consumptionOperationId: current.consumptionOperationId,
    repository: current.repository,
    prNumber: current.prNumber,
    sessionRevision: current.sessionRevision,
    baseSha: current.baseSha,
    baseTreeSha: current.baseTreeSha,
    headSha: current.headSha,
    headTreeSha: current.headTreeSha,
    manifestDigest: current.manifestDigest,
    scopeAuthorizationRevision: current.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: current.scopeAuthorizationReceiptDigest,
    actionClosureDigest: current.actionClosureDigest,
    evidenceDigest: current.evidenceDigest,
    reviewRevision: current.reviewRevision,
    reviewReceiptDigest: current.reviewReceiptDigest,
    reviewReportRevision: current.reviewReportRevision,
    reviewReportDigest: current.reviewReportDigest,
    mainHealthRevision: current.mainHealthRevision,
    mainHealthReceiptDigest: current.mainHealthReceiptDigest,
    trustRevision: current.trustRevision,
    rulesetDigest: current.rulesetDigest
  };
}

test('IntegrationAuthorization round-trips and exact expiry boundary is usable once', () => {
  const current = authorization();
  expect(parseIntegrationAuthorization(JSON.stringify(current))).toEqual(current);
  expect(() => assertIntegrationAuthorizationUsable(current, live(current))).not.toThrow();
  expect(() => assertIntegrationAuthorizationUsable(current, {
    ...live(current),
    now: '2026-08-09T01:00:00.001Z'
  })).toThrow('expired');
});

test('every live IntegrationAuthorization binding drifts fail closed', () => {
  const current = authorization();
  const cases: readonly [string, Partial<IntegrationAuthorizationLiveState>][] = [
    ['consumption operation', { consumptionOperationId: 'merge-pr-12' }],
    ['repository', { repository: 'sec-platform/other' }],
    ['prNumber', { prNumber: 12 }],
    ['sessionRevision', { sessionRevision: D_C }],
    ['baseSha', { baseSha: SHA_B }],
    ['baseTreeSha', { baseTreeSha: TREE_B }],
    ['headSha', { headSha: SHA_A }],
    ['headTreeSha', { headTreeSha: TREE_A }],
    ['manifestDigest', { manifestDigest: D_B }],
    ['scopeAuthorizationRevision', { scopeAuthorizationRevision: D_C }],
    ['scopeAuthorizationReceiptDigest', { scopeAuthorizationReceiptDigest: D_A }],
    ['actionClosureDigest', { actionClosureDigest: D_B }],
    ['evidenceDigest', { evidenceDigest: D_C }],
    ['reviewRevision', { reviewRevision: D_A }],
    ['reviewReceiptDigest', { reviewReceiptDigest: D_B }],
    ['reviewReportRevision', { reviewReportRevision: D_A }],
    ['reviewReportDigest', { reviewReportDigest: D_A }],
    ['mainHealthRevision', { mainHealthRevision: D_C }],
    ['mainHealthReceiptDigest', { mainHealthReceiptDigest: D_A }],
    ['trustRevision', { trustRevision: SHA_B }],
    ['rulesetDigest', { rulesetDigest: D_C }]
  ];
  for (const [label, override] of cases) {
    expect(() => assertIntegrationAuthorizationUsable(current, {
      ...live(current),
      ...override
    }), label).toThrow('drift');
  }
});

test('consumed authorization rejects regardless of Set insertion order or duplicates', () => {
  const current = authorization();
  for (const consumed of [
    new Set([current.authorizationId]),
    new Set(['other', current.authorizationId]),
    new Set([current.authorizationId, 'other', current.authorizationId])
  ]) {
    expect(() => assertIntegrationAuthorizationUsable(current, {
      ...live(current),
      consumedAuthorizationIds: consumed
    })).toThrow('already consumed');
  }
});

test('authorizationId changes for every stable decision field', () => {
  const current = authorization();
  const cases: readonly [string, IntegrationAuthorizationInput][] = [
    ['operation', input({ consumptionOperationId: 'merge-pr-12' })],
    ['repository', input({ repository: 'sec-platform/other' })],
    ['prNumber', input({ prNumber: 12 })],
    ['sessionRevision', input({ sessionRevision: D_C })],
    ['baseSha', input({ baseSha: SHA_B })],
    ['baseTreeSha', input({ baseTreeSha: TREE_B })],
    ['headSha', input({ headSha: SHA_A })],
    ['headTreeSha', input({ headTreeSha: TREE_A })],
    ['manifestDigest', input({ manifestDigest: D_B })],
    ['scopeAuthorizationRevision', input({ scopeAuthorizationRevision: D_C })],
    ['actionClosureDigest', input({ actionClosureDigest: D_B })],
    ['evidenceDigest', input({ evidenceDigest: D_C })],
    ['reviewRevision', input({ reviewRevision: D_A })],
    ['reviewReportRevision', input({ reviewReportRevision: D_A })],
    ['mainHealthRevision', input({ mainHealthRevision: D_C })],
    ['trustRevision', input({
      trustRevision: SHA_B,
      issuer: { ...issuer(), trustedRevision: SHA_B }
    })],
    ['rulesetDigest', input({ rulesetDigest: D_C })],
    ['issuer principal', input({ issuer: { ...issuer(), principalId: 'A0_other' } })],
    ['issuer producer', input({ issuer: { ...issuer(), producerIdentity: 'other-runtime' } })]
  ];
  for (const [label, candidate] of cases) {
    expect(createIntegrationAuthorization(candidate).authorizationId, label)
      .not.toBe(current.authorizationId);
  }
});

test('receipt-only provenance changes receipt digest but not authorizationId', () => {
  const current = authorization();
  const cases: readonly [string, Partial<IntegrationAuthorizationInput>][] = [
    ['scope receipt', { scopeAuthorizationReceiptDigest: D_A }],
    ['review receipt', { reviewReceiptDigest: D_B }],
    ['review report', { reviewReportDigest: D_A }],
    ['MainHealth receipt', { mainHealthReceiptDigest: D_A }],
    ['source transport', { issuer: { ...issuer(), sourceTransport: 'github-actions' } }],
    ['source run', { issuer: { ...issuer(), sourceRunId: 'run-2' } }],
    ['source ref', { issuer: { ...issuer(), sourceRef: 'pull/11/run/2' } }],
    ['source digest', { issuer: { ...issuer(), sourceDigest: D_C } }],
    ['issue time', {
      issuedAt: '2026-08-09T00:10:00.000Z',
      expiresAt: '2026-08-09T01:10:00.000Z'
    }]
  ];
  for (const [label, override] of cases) {
    const candidate = authorization(override);
    expect(candidate.authorizationId, label).toBe(current.authorizationId);
    expect(candidate.receiptDigest, label).not.toBe(current.receiptDigest);
  }
});

test('IntegrationAuthorization rejects invalid issuer provenance and time bounds', () => {
  const invalid: readonly [string, IntegrationAuthorizationInput][] = [
    ['issuer trust mismatch', input({ issuer: { ...issuer(), trustedRevision: SHA_B } })],
    ['issuer transport', input({ issuer: { ...issuer(), sourceTransport: 'unknown' as never } })],
    ['issuer source digest', input({ issuer: { ...issuer(), sourceDigest: 'bad' as never } })],
    ['empty producer identity', input({ issuer: { ...issuer(), producerIdentity: '' } })]
  ];
  for (const [label, candidate] of invalid) {
    expect(() => createIntegrationAuthorization(candidate), label).toThrow();
  }
  expect(() => authorization({ expiresAt: '2026-08-09T00:00:00.000Z' }))
    .toThrow('after issuedAt');
});

test('IntegrationAuthorization parser rejects schema, unknown fields, issuer shape, and tampering', () => {
  const current = authorization();
  const invalid = [
    { ...current, schema: 'unknown' },
    { ...current, extra: true },
    { ...current, authorizationId: D_C },
    { ...current, receiptDigest: D_C },
    { ...current, issuer: { ...current.issuer, extra: true } }
  ];
  for (const candidate of invalid) {
    expect(() => parseIntegrationAuthorization(JSON.stringify(candidate))).toThrow();
  }
});
