import { expect, test } from 'bun:test';

import {
  createMainHealthLedger
} from '../../src/control/main-health/contract.ts';
import { compileMainHealthRepairDecision } from '../../src/control/main-health/repair.ts';
import { sha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const FAILURE = sha256('main-health failure') as `sha256:${string}`;
const SOURCE = sha256('provider source') as `sha256:${string}`;
const OBSERVED_AT = '2026-08-12T00:00:00.000Z';
const REPAIR_PACKAGE = 'config/repository/work-packages/default-branch-health-repair-1111111111111111111111111111111111111111-37c4a9268c1d0f6608b43e5786b2533a8446da71471ef4cc2c4812b757e9f8a9.md';

function ledger(overrides: Partial<Parameters<typeof createMainHealthLedger>[0]> = {}) {
  const value = {
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN,
    mainTreeSha: TREE,
    status: 'degraded',
    failureFingerprints: [FAILURE],
    owner: 'ci-verification-maintainer',
    repairWorkPackage: null,
    expiresAt: '2026-08-12T00:05:00.000Z',
    allowedLanes: ['repair'],
    trustRevision: MAIN,
    observedAt: OBSERVED_AT,
    producer: {
      identity: 'main-health-producer',
      trustRevision: MAIN,
      sourceTransport: 'github-api',
      sourceRunId: 'run-1',
      sourceRef: `github-check-runs:sec-platform/sec@${MAIN}`,
      sourceDigest: SOURCE
    },
    ...overrides
  } satisfies Parameters<typeof createMainHealthLedger>[0];
  return createMainHealthLedger({
    ...value,
    repairWorkPackage: Object.hasOwn(overrides, 'repairWorkPackage')
      ? overrides.repairWorkPackage ?? null
      : REPAIR_PACKAGE
  });
}

function decide(value: unknown, overrides: Partial<{
  now: string;
  expectedRepository: string;
  expectedMainSha: string;
}> = {}) {
  return compileMainHealthRepairDecision({
    observation: { kind: 'available', ledger: value },
    now: overrides.now ?? OBSERVED_AT,
    expectedRepository: overrides.expectedRepository ?? 'sec-platform/sec',
    expectedDefaultBranch: 'main',
    expectedMainSha: overrides.expectedMainSha ?? MAIN,
    expectedMainTreeSha: TREE,
    expectedTrustRevision: MAIN
  });
}

test('degraded exact-main repair decision binds the whole routing identity', () => {
  const result = decide(ledger());
  expect(result.status).toBe('repair-ready');
  expect(result.routingState).toBe('repair-only');
  expect(result.reasonCode).toBe('repair-ready');
  expect(result.binding).toMatchObject({
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: TREE,
    owner: 'ci-verification-maintainer',
    failureFingerprints: [FAILURE]
  });
  expect(result.binding?.manifestPath).toBe(REPAIR_PACKAGE);
  expect(result.binding?.packageId).toBe(result.binding?.manifestPath
    .slice('config/repository/work-packages/'.length, -'.md'.length));
  expect(result.binding?.healthRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(result.decisionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.binding)).toBe(true);
});

test('hosted provider absence, transport failure, and invalidity remain distinct locked states', () => {
  for (const [kind, reasonCode] of [
    ['provider-missing', 'repair-provider-missing'],
    ['provider-unavailable', 'repair-provider-unavailable'],
    ['provider-invalid', 'repair-provider-invalid']
  ] as const) {
    const result = compileMainHealthRepairDecision({
      observation: { kind, observationRef: SOURCE },
      now: OBSERVED_AT,
      expectedRepository: 'sec-platform/sec',
      expectedDefaultBranch: 'main',
      expectedMainSha: MAIN,
      expectedMainTreeSha: TREE,
      expectedTrustRevision: MAIN
    });
    expect(result).toMatchObject({ status: 'blocked', routingState: 'locked', reasonCode });
    expect(result.binding).toBeNull();
  }
});

test('repair routing distinguishes ineligible, expired, drifted, malformed, and invalid identities', () => {
  const healthy = createMainHealthLedger({
    ...ledger(),
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    allowedLanes: ['ordinary']
  });
  expect(decide(healthy)).toMatchObject({
    status: 'blocked', routingState: 'ordinary-only', reasonCode: 'repair-lane-ineligible'
  });
  expect(decide(ledger(), { now: '2026-08-12T00:05:00.001Z' }))
    .toMatchObject({ status: 'blocked', routingState: 'locked', reasonCode: 'repair-ledger-expired' });
  expect(decide(ledger(), { expectedMainSha: '3'.repeat(40) }))
    .toMatchObject({ status: 'blocked', reasonCode: 'repair-ledger-identity-drift' });
  expect(decide({ malformed: true }))
    .toMatchObject({ status: 'blocked', routingState: 'locked', reasonCode: 'repair-ledger-invalid' });
  expect(decide({ ...ledger(), repairWorkPackage: 'not/a/manifest' }))
    .toMatchObject({ status: 'blocked', routingState: 'locked', reasonCode: 'repair-ledger-invalid' });
});
