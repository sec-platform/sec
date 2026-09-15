import { expect, test } from 'bun:test';

import {
  createMainHealthLedger,
  createMainHealthRepairWorkPackagePath,
  createMainHealthRevision,
  parseMainHealthLedger,
  resolveOrdinaryMainHealthLane,
  resolveRepairMainHealthLane,
  type MainHealthLedgerInput,
  type MainHealthSemanticInput
} from '../../src/control/main-health/contract.ts';

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

function healthyInput(overrides: Partial<MainHealthLedgerInput> = {}): MainHealthLedgerInput {
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

function degradedInput(overrides: Partial<MainHealthLedgerInput> = {}): MainHealthLedgerInput {
  const value: MainHealthLedgerInput = healthyInput({
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
      : createMainHealthRepairWorkPackagePath({
          repository: value.repository,
          defaultBranch: value.defaultBranch,
          mainSha: value.mainSha,
          mainTreeSha: value.mainTreeSha,
          owner: value.owner!,
          failureFingerprints: value.failureFingerprints
        })
  };
}

function lockedInput(overrides: Partial<MainHealthLedgerInput> = {}): MainHealthLedgerInput {
  return healthyInput({ status: 'locked', allowedLanes: [], ...overrides });
}

function semantic(input: MainHealthLedgerInput): MainHealthSemanticInput {
  const { producer: _producer, observedAt: _observedAt, expiresAt: _expiresAt, ...value } = input;
  return value;
}

test('healthy live exact-main ledger round-trips and exact expiry is allowed', () => {
  const ledger = createMainHealthLedger(healthyInput());
  expect(parseMainHealthLedger(JSON.stringify(ledger))).toEqual(ledger);
  const exact = resolveOrdinaryMainHealthLane({
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
  expect(resolveOrdinaryMainHealthLane({
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
  const ledger = createMainHealthLedger(healthyInput());
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
    const result = resolveOrdinaryMainHealthLane(candidate);
    expect(result).toMatchObject({ status: 'locked', allowed: false });
    expect(result.observationValidity).toBe('invalid');
    expect(result.reasonCode).toBe('ledger-identity-drift');
  }
  expect(resolveRepairMainHealthLane(base)).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'valid', reasonCode: 'lane-ineligible'
  });
  for (const unknown of [null, { schema: 'unknown' }, { ...ledger, extra: true }]) {
    expect(resolveOrdinaryMainHealthLane({ ...base, ledger: unknown })).toMatchObject({
      status: 'locked', allowed: false,
      observationValidity: 'invalid', reasonCode: 'invalid-ledger'
    });
  }
});

test('valid degraded lane denial is distinct from expired or identity-drifted observation', () => {
  const ledger = createMainHealthLedger(degradedInput());
  const input = {
    ledger,
    now: '2026-08-09T00:30:00.000Z',
    expectedRepository: ledger.repository,
    expectedDefaultBranch: ledger.defaultBranch,
    expectedMainSha: ledger.mainSha,
    expectedMainTreeSha: ledger.mainTreeSha,
    expectedTrustRevision: ledger.trustRevision
  };
  expect(resolveOrdinaryMainHealthLane(input)).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'valid', reasonCode: 'lane-ineligible'
  });
  expect(resolveOrdinaryMainHealthLane({
    ...input, now: '2026-08-09T01:00:00.001Z'
  })).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'invalid', reasonCode: 'ledger-expired'
  });
  expect(resolveOrdinaryMainHealthLane({
    ...input, expectedMainSha: SHA_B
  })).toMatchObject({
    status: 'locked', allowed: false,
    observationValidity: 'invalid', reasonCode: 'ledger-identity-drift'
  });
});

test('MainHealth revision changes for every health decision field', () => {
  const base = createMainHealthLedger(healthyInput());
  const cases: readonly [string, MainHealthLedgerInput][] = [
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
    expect(createMainHealthLedger(candidate).healthRevision, label).not.toBe(base.healthRevision);
  }
});

test('MainHealth observation provenance changes receipt digest but not health revision', () => {
  const base = createMainHealthLedger(healthyInput());
  const cases: readonly [string, Partial<MainHealthLedgerInput>][] = [
    ['producer identity', { producer: { ...producer(), identity: 'other-runtime' } }],
    ['source run', { producer: { ...producer(), sourceRunId: 'run-2' } }],
    ['source ref', { producer: { ...producer(), sourceRef: 'refs/heads/main@2' } }],
    ['source digest', { producer: { ...producer(), sourceDigest: D_B } }],
    ['observation time', {
      observedAt: '2026-08-09T00:10:00.000Z',
      expiresAt: '2026-08-09T01:10:00.000Z'
    }]
  ];
  for (const [label, override] of cases) {
    const candidate = createMainHealthLedger(healthyInput(override));
    expect(candidate.healthRevision, label).toBe(base.healthRevision);
    expect(candidate.ledgerDigest, label).not.toBe(base.ledgerDigest);
  }
  expect(() => createMainHealthLedger(healthyInput({
    producer: { ...producer(), sourceTransport: 'trusted-local-readback' as never }
  }))).toThrow('producer.sourceTransport is invalid');
});

test('MainHealth canonicalizes set ordering and rejects duplicate/unknown members', () => {
  const left = createMainHealthLedger(degradedInput({ failureFingerprints: [D_B, D_A] }));
  const right = createMainHealthLedger(degradedInput({ failureFingerprints: [D_A, D_B] }));
  expect(left.healthRevision).toBe(right.healthRevision);
  const laneLeft = createMainHealthLedger(healthyInput({ allowedLanes: ['repair', 'ordinary'] }));
  const laneRight = createMainHealthLedger(healthyInput({ allowedLanes: ['ordinary', 'repair'] }));
  expect(laneLeft.healthRevision).toBe(laneRight.healthRevision);
  expect(() => createMainHealthLedger(lockedInput({ failureFingerprints: [D_A, D_A] })))
    .toThrow('unique');
  expect(() => createMainHealthLedger(healthyInput({ allowedLanes: ['ordinary', 'ordinary'] })))
    .toThrow('unique');
  expect(() => createMainHealthLedger(healthyInput({ allowedLanes: ['unknown' as never] })))
    .toThrow('invalid');
});

test('public MainHealth revision helper rejects states the ledger builder rejects', () => {
  const invalid: readonly [string, MainHealthSemanticInput][] = [
    ['unknown status', { ...semantic(healthyInput()), status: 'unknown' as never }],
    ['duplicate fingerprints', { ...semantic(lockedInput()), failureFingerprints: [D_A, D_A] }],
    ['unknown lane', { ...semantic(healthyInput()), allowedLanes: ['unknown' as never] }],
    ['incoherent healthy state', { ...semantic(healthyInput()), failureFingerprints: [D_A] }],
    ['incoherent degraded state', { ...semantic(degradedInput()), owner: null }],
    ['incoherent locked state', { ...semantic(lockedInput()), allowedLanes: ['repair'] }]
  ];
  for (const [label, candidate] of invalid) {
    expect(() => createMainHealthRevision(candidate), label).toThrow();
  }
});

test('MainHealth rejects invalid producer provenance and status invariants', () => {
  const invalid: readonly [string, MainHealthLedgerInput][] = [
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
    expect(() => createMainHealthLedger(candidate), label).toThrow();
  }
  expect(() => createMainHealthLedger(healthyInput({
    expiresAt: '2026-08-09T00:00:00.000Z'
  }))).toThrow('after observedAt');
});

test('MainHealth parser rejects schema drift, extra fields, and digest tampering', () => {
  const ledger = createMainHealthLedger(healthyInput());
  for (const candidate of [
    { ...ledger, schema: 'unknown' },
    { ...ledger, extra: true },
    { ...ledger, healthRevision: D_C },
    { ...ledger, ledgerDigest: D_C }
  ]) {
    expect(() => parseMainHealthLedger(JSON.stringify(candidate))).toThrow();
  }
});
