import { expect, test } from 'bun:test';

import {
  MAIN_HEALTH_LEDGER_SCHEMA_V1,
  createMainHealthLedgerV1,
  createMainHealthRepairWorkPackagePathV1,
  createMainHealthRevisionV1,
  parseMainHealthLedgerV1,
  resolveOrdinaryMainHealthLaneV1,
  resolveRepairMainHealthLaneV1,
  type MainHealthLedgerInputV1,
  type MainHealthSemanticInputV1
} from '../../platform/shared/main-health-contract.ts';

const SHA_A = '1'.repeat(40);
const SHA_B = '2'.repeat(40);
const TREE_A = '3'.repeat(40);
const TREE_B = '4'.repeat(40);
const D_A = `sha256:${'a'.repeat(64)}` as const;
const D_B = `sha256:${'b'.repeat(64)}` as const;
const D_C = `sha256:${'c'.repeat(64)}` as const;

function producer() {
  return {
    identity: 'main-health-runtime',
    trustRevision: SHA_A,
    sourceTransport: 'github-api' as const,
    sourceRunId: 'run-1',
    sourceRef: 'refs/heads/main',
    sourceDigest: D_A
  };
}

function healthyInput(overrides: Partial<MainHealthLedgerInputV1> = {}): MainHealthLedgerInputV1 {
  return {
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: SHA_A,
    mainTreeSha: TREE_A,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: '2026-08-09T01:00:00.000Z',
    allowedLanes: ['ordinary'],
    trustRevision: SHA_A,
    observedAt: '2026-08-09T00:00:00.000Z',
    producer: producer(),
    ...overrides
  };
}

function degradedInput(overrides: Partial<MainHealthLedgerInputV1> = {}): MainHealthLedgerInputV1 {
  const value: MainHealthLedgerInputV1 = healthyInput({
    status: 'degraded',
    failureFingerprints: [D_A],
    owner: 'verification-repair-owner',
    repairWorkPackage: null,
    allowedLanes: ['repair'],
    ...overrides
  });
  return {
    ...value,
    repairWorkPackage: Object.hasOwn(overrides, 'repairWorkPackage')
      ? overrides.repairWorkPackage ?? null
      : createMainHealthRepairWorkPackagePathV1({
          repository: value.repository,
          defaultBranch: value.defaultBranch,
          mainSha: value.mainSha,
          mainTreeSha: value.mainTreeSha,
          owner: value.owner!,
          failureFingerprints: value.failureFingerprints
        })
  };
}

function lockedInput(overrides: Partial<MainHealthLedgerInputV1> = {}): MainHealthLedgerInputV1 {
  return healthyInput({ status: 'locked', allowedLanes: [], ...overrides });
}

function semantic(input: MainHealthLedgerInputV1): MainHealthSemanticInputV1 {
  const { producer: _producer, observedAt: _observedAt, expiresAt: _expiresAt, ...value } = input;
  return value;
}

test('healthy live exact-main ledger round-trips and exact expiry is allowed', () => {
  const ledger = createMainHealthLedgerV1(healthyInput());
  expect(ledger.schema).toBe(MAIN_HEALTH_LEDGER_SCHEMA_V1);
  expect(parseMainHealthLedgerV1(JSON.stringify(ledger))).toEqual(ledger);
  const exact = resolveOrdinaryMainHealthLaneV1({
    ledger,
    now: ledger.expiresAt,
    expectedRepository: ledger.repository,
    expectedDefaultBranch: ledger.defaultBranch,
    expectedMainSha: ledger.mainSha,
    expectedMainTreeSha: ledger.mainTreeSha,
    expectedTrustRevision: ledger.trustRevision
  });
  expect(exact).toMatchObject({
    status: 'healthy', allowed: true,
    observationValidity: 'valid', reasonCode: 'lane-eligible'
  });
  expect(resolveOrdinaryMainHealthLaneV1({
    ledger, now: '2026-08-09T01:00:00.001Z',
    expectedRepository: ledger.repository, expectedDefaultBranch: ledger.defaultBranch,
    expectedMainSha: ledger.mainSha, expectedMainTreeSha: ledger.mainTreeSha,
    expectedTrustRevision: ledger.trustRevision
  })).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'invalid', reasonCode: 'ledger-expired'
  });
});

test('MainHealth live main/tree/trust/lane drift locks fail closed', () => {
  const ledger = createMainHealthLedgerV1(healthyInput());
  const base = {
    ledger,
    now: '2026-08-09T00:30:00.000Z',
    expectedRepository: 'sec-platform/sec',
    expectedDefaultBranch: 'main',
    expectedMainSha: SHA_A,
    expectedMainTreeSha: TREE_A,
    expectedTrustRevision: SHA_A
  };
  const cases = [
    { ...base, expectedRepository: 'sec-platform/other' },
    { ...base, expectedDefaultBranch: 'trunk' },
    { ...base, expectedMainSha: SHA_B },
    { ...base, expectedMainTreeSha: TREE_B },
    { ...base, expectedTrustRevision: SHA_B }
  ];
  for (const candidate of cases) {
    const result = resolveOrdinaryMainHealthLaneV1(candidate);
    expect(result).toMatchObject({ status: 'locked', allowed: false });
    expect(result.observationValidity).toBe('invalid');
    expect(result.reasonCode).toBe('ledger-identity-drift');
  }
  expect(resolveRepairMainHealthLaneV1(base)).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'valid', reasonCode: 'lane-ineligible'
  });
  for (const unknown of [null, { schema: 'unknown' }, { ...ledger, extra: true }]) {
    expect(resolveOrdinaryMainHealthLaneV1({ ...base, ledger: unknown })).toMatchObject({
      status: 'locked', allowed: false,
      observationValidity: 'invalid', reasonCode: 'invalid-ledger'
    });
  }
});

test('valid degraded lane denial is distinct from expired or identity-drifted observation', () => {
  const ledger = createMainHealthLedgerV1(degradedInput());
  const input = {
    ledger,
    now: '2026-08-09T00:30:00.000Z',
    expectedRepository: ledger.repository,
    expectedDefaultBranch: ledger.defaultBranch,
    expectedMainSha: ledger.mainSha,
    expectedMainTreeSha: ledger.mainTreeSha,
    expectedTrustRevision: ledger.trustRevision
  };
  expect(resolveOrdinaryMainHealthLaneV1(input)).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'valid', reasonCode: 'lane-ineligible'
  });
  expect(resolveOrdinaryMainHealthLaneV1({
    ...input, now: '2026-08-09T01:00:00.001Z'
  })).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'invalid', reasonCode: 'ledger-expired'
  });
  expect(resolveOrdinaryMainHealthLaneV1({
    ...input, expectedMainSha: SHA_B
  })).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'invalid', reasonCode: 'ledger-identity-drift'
  });
});

test('MainHealth revision changes for every health decision field', () => {
  const base = createMainHealthLedgerV1(healthyInput());
  const cases: readonly [string, MainHealthLedgerInputV1][] = [
    ['repository', healthyInput({ repository: 'sec-platform/other' })],
    ['defaultBranch', healthyInput({ defaultBranch: 'trunk' })],
    ['mainSha', healthyInput({ mainSha: SHA_B })],
    ['mainTreeSha', healthyInput({ mainTreeSha: TREE_B })],
    ['status', lockedInput()],
    ['failure fingerprint', degradedInput({ failureFingerprints: [D_B] })],
    ['owner', degradedInput({ owner: 'other-owner' })],
    ['allowed lanes', healthyInput({ allowedLanes: ['ordinary', 'repair'] })],
    ['trustRevision', healthyInput({
      trustRevision: SHA_B,
      producer: { ...producer(), trustRevision: SHA_B }
    })]
  ];
  for (const [label, candidate] of cases) {
    expect(createMainHealthLedgerV1(candidate).healthRevision, label).not.toBe(base.healthRevision);
  }
});

test('MainHealth observation provenance changes receipt digest but not health revision', () => {
  const base = createMainHealthLedgerV1(healthyInput());
  const cases: readonly [string, Partial<MainHealthLedgerInputV1>][] = [
    ['producer identity', { producer: { ...producer(), identity: 'other-runtime' } }],
    ['source transport', { producer: { ...producer(), sourceTransport: 'trusted-local-readback' } }],
    ['source run', { producer: { ...producer(), sourceRunId: 'run-2' } }],
    ['source ref', { producer: { ...producer(), sourceRef: 'refs/heads/main@2' } }],
    ['source digest', { producer: { ...producer(), sourceDigest: D_B } }],
    ['observation time', {
      observedAt: '2026-08-09T00:10:00.000Z',
      expiresAt: '2026-08-09T01:10:00.000Z'
    }]
  ];
  for (const [label, override] of cases) {
    const candidate = createMainHealthLedgerV1(healthyInput(override));
    expect(candidate.healthRevision, label).toBe(base.healthRevision);
    expect(candidate.ledgerDigest, label).not.toBe(base.ledgerDigest);
  }
});

test('MainHealth canonicalizes set ordering and rejects duplicate/unknown members', () => {
  const left = createMainHealthLedgerV1(degradedInput({ failureFingerprints: [D_B, D_A] }));
  const right = createMainHealthLedgerV1(degradedInput({ failureFingerprints: [D_A, D_B] }));
  expect(left.healthRevision).toBe(right.healthRevision);
  const laneLeft = createMainHealthLedgerV1(healthyInput({ allowedLanes: ['repair', 'ordinary'] }));
  const laneRight = createMainHealthLedgerV1(healthyInput({ allowedLanes: ['ordinary', 'repair'] }));
  expect(laneLeft.healthRevision).toBe(laneRight.healthRevision);
  expect(() => createMainHealthLedgerV1(lockedInput({ failureFingerprints: [D_A, D_A] })))
    .toThrow('unique');
  expect(() => createMainHealthLedgerV1(healthyInput({ allowedLanes: ['ordinary', 'ordinary'] })))
    .toThrow('unique');
  expect(() => createMainHealthLedgerV1(healthyInput({ allowedLanes: ['unknown' as never] })))
    .toThrow('invalid');
});

test('public MainHealth revision helper rejects states the ledger builder rejects', () => {
  const invalid: readonly [string, MainHealthSemanticInputV1][] = [
    ['unknown status', { ...semantic(healthyInput()), status: 'unknown' as never }],
    ['duplicate fingerprints', { ...semantic(lockedInput()), failureFingerprints: [D_A, D_A] }],
    ['unknown lane', { ...semantic(healthyInput()), allowedLanes: ['unknown' as never] }],
    ['incoherent healthy state', { ...semantic(healthyInput()), failureFingerprints: [D_A] }],
    ['incoherent degraded state', { ...semantic(degradedInput()), owner: null }],
    ['incoherent locked state', { ...semantic(lockedInput()), allowedLanes: ['repair'] }]
  ];
  for (const [label, candidate] of invalid) {
    expect(() => createMainHealthRevisionV1(candidate), label).toThrow();
  }
});

test('MainHealth rejects invalid producer provenance and status invariants', () => {
  const invalid: readonly [string, MainHealthLedgerInputV1][] = [
    ['producer trust mismatch', healthyInput({ producer: { ...producer(), trustRevision: SHA_B } })],
    ['producer transport', healthyInput({ producer: { ...producer(), sourceTransport: 'unknown' as never } })],
    ['producer source digest', healthyInput({ producer: { ...producer(), sourceDigest: 'bad' as never } })],
    ['healthy failure', healthyInput({ failureFingerprints: [D_A] })],
    ['degraded ordinary lane', degradedInput({ allowedLanes: ['ordinary'] })],
    ['degraded missing repair', degradedInput({ repairWorkPackage: null })],
    ['degraded noncanonical repair', degradedInput({ repairWorkPackage: 'docs/work-packages/repair-v1.md' })],
    ['locked lane', lockedInput({ allowedLanes: ['repair'] })]
  ];
  for (const [label, candidate] of invalid) {
    expect(() => createMainHealthLedgerV1(candidate), label).toThrow();
  }
  expect(() => createMainHealthLedgerV1(healthyInput({
    expiresAt: '2026-08-09T00:00:00.000Z'
  }))).toThrow('after observedAt');
});

test('MainHealth parser rejects schema drift, extra fields, and digest tampering', () => {
  const ledger = createMainHealthLedgerV1(healthyInput());
  for (const candidate of [
    { ...ledger, schema: 'unknown' },
    { ...ledger, extra: true },
    { ...ledger, healthRevision: D_C },
    { ...ledger, ledgerDigest: D_C }
  ]) {
    expect(() => parseMainHealthLedgerV1(JSON.stringify(candidate))).toThrow();
  }
});
