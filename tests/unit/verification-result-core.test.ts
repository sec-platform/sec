import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentAssertVerificationGateResultV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  CodexDevelopmentVerificationEnvironmentIdentityV1,
  mapCiEvidenceV2Status,
  mapEvidenceDisposition,
  mapProductVerificationStatus,
  mapSemanticMutationBlocked,
  VERIFICATION_GATE_RESULT_SCHEMA_V1,
  type VerificationApplicability,
  type VerificationClaimDefinitionV1,
  type VerificationDisposition,
  type VerificationGateEnvironmentV1,
  type VerificationGateResultV1,
  type VerificationReasonCode,
  type VerificationResultStatus
} from '../../platform/shared/verification-result-contract.ts';

const INPUT_DIGEST = `sha256:${'a'.repeat(64)}`;
const SUBJECT_REVISION = 'b'.repeat(40);
const OUTPUT_DIGEST = `sha256:${'c'.repeat(64)}`;

function environment(os = 'linux', arch = 'x64'): VerificationGateEnvironmentV1 {
  return {
    runtime: 'bun@1.3.14',
    os,
    arch,
    filesystem: os === 'windows' ? 'ntfs' : 'ext4',
    capabilities: ['typescript'],
    toolchainRevision: 'ci-verification-v19',
    providerRevisions: []
  };
}

function environmentId(os = 'linux', arch = 'x64'): string {
  return CodexDevelopmentVerificationEnvironmentIdentityV1(os, arch);
}

function execution(exitCode: number) {
  return {
    argv: ['bun', 'test'],
    startedAt: '2026-08-02T00:00:00.000Z',
    finishedAt: '2026-08-02T00:00:01.000Z',
    durationMs: 1000,
    exitCode,
    outputDigest: OUTPUT_DIGEST,
    failureFingerprint: exitCode === 0 ? null : 'failure'
  };
}

interface GateOptions {
  status?: VerificationResultStatus;
  disposition?: VerificationDisposition;
  applicability?: VerificationApplicability;
  reasonCode?: VerificationReasonCode;
  env?: VerificationGateEnvironmentV1 | null;
  claims?: string[];
  supportedClaims?: string[];
  evidenceRefs?: string[];
  gateRevision?: string;
  owner?: string;
  requirementKey?: string;
  subjectRevision?: string;
  inputDigest?: string;
}

function gate(gateId: string, options: GateOptions = {}): VerificationGateResultV1 {
  const status = options.status ?? 'passed';
  const disposition = options.disposition ?? (
    status === 'passed' || status === 'failed' ? 'executed' : 'not-executed'
  );
  const claims = options.claims ?? ['claim'];
  const reasonCode = options.reasonCode ?? ({
    passed: 'executed-success',
    failed: 'executed-failure',
    'not-run': 'not-dispatched',
    unsupported: 'capability-unsupported',
    invalidated: 'selection-unresolved'
  } satisfies Record<VerificationResultStatus, VerificationReasonCode>)[status];
  const applicability = options.applicability ?? (
    status === 'invalidated' ? 'unresolved'
      : reasonCode === 'not-applicable' ? 'not-applicable'
        : 'required'
  );
  const env = options.env === undefined
    ? disposition === 'executed' || disposition === 'reused' ? environment() : null
    : options.env;
  const supportedClaims = options.supportedClaims ?? (status === 'passed' ? claims : []);

  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: options.gateRevision ?? 'gate-rev-1',
    owner: options.owner ?? 'verification-test',
    requirementKey: options.requirementKey ?? 'verification-test',
    subjectRevision: options.subjectRevision ?? SUBJECT_REVISION,
    inputDigest: options.inputDigest ?? INPUT_DIGEST,
    applicability,
    status,
    disposition,
    reasonCode,
    requiredForClaims: claims,
    supportedClaims,
    environment: env,
    execution: disposition === 'executed' ? execution(status === 'failed' ? 1 : 0) : null,
    evidenceRefs: options.evidenceRefs ?? (disposition === 'reused' ? ['evidence-1'] : []),
    invalidationRules: [],
    diagnostic: null
  });
}

function claim(
  claimId: string,
  requiredGateIds: string[],
  owningEnvironments: string[] = [environmentId()]
): VerificationClaimDefinitionV1 {
  return { claimId, requiredGateIds, owningEnvironments };
}

function aggregate(
  claims: VerificationClaimDefinitionV1[],
  gateResults: VerificationGateResultV1[]
) {
  return CodexDevelopmentAggregateVerificationClaimsV1({ claims, gateResults });
}

test('schema and canonical vocabularies remain fixed', () => {
  expect(VERIFICATION_GATE_RESULT_SCHEMA_V1).toBe('sec-verification-gate-result-v1');
  expect(new Set<VerificationResultStatus>([
    'passed', 'failed', 'not-run', 'unsupported', 'invalidated'
  ]).size).toBe(5);
  expect(new Set<VerificationDisposition>(['executed', 'reused', 'not-executed']).size).toBe(3);
  expect(new Set<VerificationApplicability>([
    'required', 'optional', 'not-applicable', 'unresolved'
  ]).size).toBe(4);
});

test('builder and validator accept a complete executed pass', () => {
  const result = gate('gate-1');
  CodexDevelopmentAssertVerificationGateResultV1(result);
  expect(result.schema).toBe(VERIFICATION_GATE_RESULT_SCHEMA_V1);
});

test('validator rejects information-losing status, disposition and applicability combinations', () => {
  expect(() => gate('bad-pass', {
    status: 'passed', disposition: 'not-executed', env: null
  })).toThrow(/passed status cannot pair with not-executed/);
  expect(() => gate('bad-failure', {
    status: 'failed', disposition: 'not-executed', env: null
  })).toThrow(/failed status requires executed disposition/);
  expect(() => gate('bad-unresolved', {
    status: 'not-run', applicability: 'unresolved', reasonCode: 'not-applicable',
    disposition: 'not-executed', env: null
  })).toThrow(/unresolved applicability requires invalidated/);
});

test('reused pass requires Evidence and environment identity', () => {
  expect(() => gate('reused-no-evidence', {
    disposition: 'reused', evidenceRefs: []
  })).toThrow(/requires Evidence and environment identity/);
  expect(() => gate('reused-no-environment', {
    disposition: 'reused', env: null
  })).toThrow(/requires Evidence and environment identity/);

  const reused = gate('reused', {
    disposition: 'reused', env: environment(), evidenceRefs: ['ev-1']
  });
  expect(aggregate([claim('claim', ['reused'])], [reused]).overallStatus).toBe('passed');
});

test('passed required gate must explicitly support every required claim', () => {
  expect(() => gate('missing-support', { claims: ['claim'], supportedClaims: [] }))
    .toThrow(/must support every required claim/);
  expect(() => gate('foreign-support', { claims: ['claim'], supportedClaims: ['other'] }))
    .toThrow(/subset of requiredForClaims/);
});

test('gate arrays and aggregate identities reject duplicates', () => {
  expect(() => gate('duplicate-claims', { claims: ['claim', 'claim'] }))
    .toThrow(/must not contain duplicate values/);
  expect(() => aggregate(
    [claim('claim', ['same-gate'])],
    [gate('same-gate'), gate('same-gate')]
  )).toThrow(/duplicate gate observation/);
  expect(() => aggregate([
    claim('claim', ['gate-1']), claim('claim', ['gate-2'])
  ], [gate('gate-1'), gate('gate-2')])).toThrow(/duplicate claimId/);
});

test('environment identity is structural and collision-free', () => {
  const left = environmentId('linux-musl', 'x64');
  const right = environmentId('linux', 'musl-x64');
  expect(left).not.toBe(right);
  expect(() => aggregate([
    claim('claim', ['portable-gate'], [left, right])
  ], [
    gate('portable-gate', { env: environment('linux-musl', 'x64') }),
    gate('portable-gate', { env: environment('linux', 'musl-x64') })
  ])).not.toThrow();
});

test('same logical gate may retain distinct owning-environment observations', () => {
  const linux = gate('portable-gate', { env: environment('linux', 'x64') });
  const windows = gate('portable-gate', { env: environment('windows', 'x64') });
  const result = aggregate([
    claim('claim', ['portable-gate'], [environmentId('windows', 'x64')])
  ], [linux, windows]);
  expect(result.overallStatus).toBe('passed');
  expect(result.claimResults[0]!.contributingGateIds).toEqual(['portable-gate']);
});

test('mixed proof identities for one logical gate fail closed', () => {
  expect(() => aggregate([
    claim('claim', ['portable-gate'], [environmentId(), environmentId('windows', 'x64')])
  ], [
    gate('portable-gate', { env: environment() }),
    gate('portable-gate', {
      env: environment('windows', 'x64'),
      subjectRevision: 'd'.repeat(40),
      inputDigest: `sha256:${'e'.repeat(64)}`
    })
  ])).toThrow(/mixes proof identities/);
});

test('wrong-environment pass cannot support an owning claim', () => {
  const result = aggregate([
    claim('windows-claim', ['windows-gate'], [environmentId('windows', 'x64')])
  ], [gate('windows-gate', {
    env: environment('linux', 'x64'), claims: ['windows-claim']
  })]);
  expect(result.overallStatus).toBe('not-run');
  expect(result.overallReasonCode).toBe('current-runner-not-owning-environment');
  expect(result.claimResults[0]!.coverageComplete).toBe(false);
});

test('non-owning unsupported observation cannot override owning pass', () => {
  const result = aggregate([
    claim('linux-claim', ['portable-gate'], [environmentId('linux', 'x64')])
  ], [
    gate('portable-gate', {
      env: environment('linux', 'x64'), claims: ['linux-claim']
    }),
    gate('portable-gate', {
      status: 'unsupported', disposition: 'not-executed',
      reasonCode: 'platform-unsupported', env: environment('windows', 'x64'),
      claims: ['linux-claim']
    })
  ]);
  expect(result.overallStatus).toBe('passed');
});

test('failure dominates invalidation within owning observations', () => {
  const result = aggregate([
    claim('portable', ['portable-gate'], [
      environmentId('linux', 'x64'), environmentId('windows', 'x64')
    ])
  ], [
    gate('portable-gate', {
      status: 'failed', reasonCode: 'executed-failure',
      env: environment('linux', 'x64'), claims: ['portable']
    }),
    gate('portable-gate', {
      status: 'invalidated', disposition: 'not-executed',
      reasonCode: 'selection-unresolved', env: environment('windows', 'x64'),
      claims: ['portable']
    })
  ]);
  expect(result.overallStatus).toBe('failed');
});

test('explicit current-runner non-owning result remains not-run', () => {
  const result = aggregate([
    claim('windows-claim', ['windows-gate'], [environmentId('windows', 'x64')])
  ], [gate('windows-gate', {
    status: 'not-run', disposition: 'not-executed',
    reasonCode: 'current-runner-not-owning-environment', env: null,
    claims: ['windows-claim']
  })]);
  expect(result.overallStatus).toBe('not-run');
  expect(result.overallReasonCode).toBe('current-runner-not-owning-environment');
});

test('missing required gate remains not-run instead of passing empty coverage', () => {
  const result = aggregate([claim('claim', ['present', 'missing'])], [gate('present')]);
  expect(result.overallStatus).toBe('not-run');
  expect(result.overallReasonCode).toBe('not-dispatched');
});

test('failed, invalidated, unsupported and not-run preserve strict lattice priority', () => {
  const claims = [
    claim('a-not-run', ['g-not-run']),
    claim('b-unsupported', ['g-unsupported']),
    claim('c-invalidated', ['g-invalidated']),
    claim('d-failed', ['g-failed'])
  ];
  const gates = [
    gate('g-not-run', {
      status: 'not-run', disposition: 'not-executed', reasonCode: 'not-dispatched',
      env: null, claims: ['a-not-run']
    }),
    gate('g-unsupported', {
      status: 'unsupported', disposition: 'not-executed',
      reasonCode: 'capability-unsupported', env: null, claims: ['b-unsupported']
    }),
    gate('g-invalidated', {
      status: 'invalidated', disposition: 'not-executed',
      reasonCode: 'selection-unresolved', env: null, claims: ['c-invalidated']
    }),
    gate('g-failed', { status: 'failed', reasonCode: 'cleanup-failed', claims: ['d-failed'] })
  ];
  expect(aggregate(claims, gates).overallStatus).toBe('failed');
  expect(aggregate(claims.slice(0, 3), gates.slice(0, 3)).overallStatus).toBe('invalidated');
  expect(aggregate(claims.slice(0, 2), gates.slice(0, 2)).overallStatus).toBe('unsupported');
  expect(aggregate(claims.slice(0, 1), gates.slice(0, 1)).overallStatus).toBe('not-run');
});

test('aggregate status and reason are invariant under claim and gate permutations', () => {
  const claims = [
    claim('z-not-run', ['g-not-run']), claim('a-invalidated', ['g-invalidated'])
  ];
  const gates = [
    gate('g-not-run', {
      status: 'not-run', disposition: 'not-executed', reasonCode: 'not-dispatched',
      env: null, claims: ['z-not-run']
    }),
    gate('g-invalidated', {
      status: 'invalidated', disposition: 'not-executed', reasonCode: 'input-invalidated',
      env: null, claims: ['a-invalidated']
    })
  ];
  const forward = aggregate(claims, gates);
  expect(aggregate([...claims].reverse(), [...gates].reverse())).toEqual(forward);
  expect(forward.overallStatus).toBe('invalidated');
  expect(forward.overallReasonCode).toBe('input-invalidated');
});

test('fast failure dominates a runtime prerequisite not-run', () => {
  const result = aggregate([claim('all', ['fast', 'runtime'])], [
    gate('fast', { status: 'failed', claims: ['all'] }),
    gate('runtime', {
      status: 'not-run', disposition: 'not-executed',
      reasonCode: 'fail-fast-prerequisite-failed', env: null, claims: ['all']
    })
  ]);
  expect(result.overallStatus).toBe('failed');
});

test('cleanup failure after successful assertions remains failed', () => {
  const result = aggregate([claim('claim', ['test', 'cleanup'])], [
    gate('test'), gate('cleanup', { status: 'failed', reasonCode: 'cleanup-failed' })
  ]);
  expect(result.overallStatus).toBe('failed');
  expect(result.overallReasonCode).toBe('cleanup-failed');
});

test('custom coverage false invalidates otherwise passed claim', () => {
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('claim', ['gate'])],
    gateResults: [gate('gate')],
    isCoverageComplete: () => false
  });
  expect(result.overallStatus).toBe('invalidated');
  expect(result.overallReasonCode).toBe('selection-unresolved');
});

test('empty claim set fails closed instead of producing a vacuous pass', () => {
  expect(aggregate([], [])).toEqual({
    overallStatus: 'invalidated',
    overallReasonCode: 'selection-unresolved',
    claimResults: []
  });
});

test('legacy mappings never promote skipped, not-run or blocked to passed', () => {
  const productMappings = [
    mapProductVerificationStatus('skipped', { requestedLane: 'fast', lane: 'runtime' }),
    mapProductVerificationStatus('skipped', {
      requestedLane: 'all', lane: 'runtime', fastFailed: true
    }),
    mapProductVerificationStatus('skipped', {
      requestedLane: 'all', lane: 'runtime', currentRunnerOwning: false
    }),
    mapProductVerificationStatus('skipped', {
      requestedLane: 'all', lane: 'runtime', currentRunnerOwning: true
    })
  ];
  for (const mapping of productMappings) expect(mapping.status).not.toBe('passed');
  for (const reason of [
    null, 'unknown', 'not-applicable', 'prerequisite', 'owning environment', 'artifact missing'
  ]) expect(mapCiEvidenceV2Status('not-run', reason).status).not.toBe('passed');
  for (const blockedReason of [
    'capability', 'authorization', 'precondition', 'plan-changed', 'not-reached', 'unknown'
  ] as const) {
    expect(mapSemanticMutationBlocked('blocked', { blockedReason }).status).not.toBe('passed');
  }
});

test('legacy mapping reasons remain explicit and Evidence disposition is orthogonal', () => {
  expect(mapProductVerificationStatus('skipped', {
    requestedLane: 'all', lane: 'runtime', fastFailed: true
  }).reasonCode).toBe('fail-fast-prerequisite-failed');
  expect(mapProductVerificationStatus('skipped', {
    requestedLane: 'all', lane: 'runtime', currentRunnerOwning: false
  }).reasonCode).toBe('current-runner-not-owning-environment');
  expect(mapCiEvidenceV2Status('not-run', 'unknown').reasonCode).toBe('selection-unresolved');
  expect(mapEvidenceDisposition('executed').disposition).toBe('executed');
  expect(mapEvidenceDisposition('reused').disposition).toBe('reused');
  expect(mapEvidenceDisposition('delta').disposition).toBe('not-executed');
});
