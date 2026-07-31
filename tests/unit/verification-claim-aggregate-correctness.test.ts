import { expect, test } from 'bun:test';

import { buildRuntimeClaimGate } from '../../platform/compiler/verify/run-runtime-verification.ts';
import { buildClaimSummary } from '../../platform/compiler/verify/verify-project.ts';
import type { PolicyReport } from '../../platform/shared/policy-types.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  type VerificationClaimDefinitionV1,
  type VerificationGateEnvironmentV1,
  type VerificationGateResultV1
} from '../../platform/shared/verification-result-contract.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from '../../platform/shared/verification-types.ts';

const INPUT_DIGEST = `sha256:${'a'.repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${'b'.repeat(64)}`;
const SUBJECT_REVISION = 'c'.repeat(40);

function environment(os: string, arch = 'x64'): VerificationGateEnvironmentV1 {
  return {
    runtime: 'bun@1.3.14',
    os,
    arch,
    filesystem: null,
    capabilities: [],
    toolchainRevision: 'ci-verification-v19',
    providerRevisions: []
  };
}

function passedGate(
  gateId: string,
  claimId: string,
  env: VerificationGateEnvironmentV1 | null = environment('linux')
): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: 'gate-v1',
    owner: 'verification-test',
    requirementKey: 'verification-test',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required',
    status: 'passed',
    disposition: env === null ? 'reused' : 'executed',
    reasonCode: 'executed-success',
    requiredForClaims: [claimId],
    supportedClaims: [claimId],
    environment: env,
    execution: env === null
      ? null
      : {
          argv: ['bun', 'test'],
          startedAt: '2026-07-31T00:00:00.000Z',
          finishedAt: '2026-07-31T00:00:01.000Z',
          durationMs: 1000,
          exitCode: 0,
          outputDigest: OUTPUT_DIGEST,
          failureFingerprint: null
        },
    evidenceRefs: env === null ? ['legacy-evidence-without-environment'] : [],
    invalidationRules: [],
    diagnostic: null
  });
}

function notRunGate(gateId: string, claimId: string): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: 'gate-v1',
    owner: 'verification-test',
    requirementKey: 'verification-test',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required',
    status: 'not-run',
    disposition: 'not-executed',
    reasonCode: 'not-dispatched',
    requiredForClaims: [claimId],
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

function invalidatedGate(gateId: string, claimId: string): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: 'gate-v1',
    owner: 'verification-test',
    requirementKey: 'verification-test',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'unresolved',
    status: 'invalidated',
    disposition: 'not-executed',
    reasonCode: 'selection-unresolved',
    requiredForClaims: [claimId],
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

function claim(
  claimId: string,
  gateId: string,
  owningEnvironments = ['linux-x64']
): VerificationClaimDefinitionV1 {
  return {
    claimId,
    requiredGateIds: [gateId],
    owningEnvironments
  };
}

function passedFastLane(): FastVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed' },
    unit: { status: 'passed', passed: ['fast-unit'] },
    acceptance: { status: 'passed', passed: ['fast-acceptance'], failed: [] },
    policy: { status: 'skipped', violations: [] },
    logs: { stdout: '', stderr: '' }
  };
}

function passedRuntimeLane(
  unitFiles: string[],
  acceptanceFiles: string[]
): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: {
      status: 'passed',
      passed: ['next build'],
      failed: [],
      command: 'bun run build'
    },
    unit: {
      status: 'passed',
      passed: unitFiles,
      failed: [],
      command: 'bun run test:runtime:unit'
    },
    acceptance: {
      status: 'passed',
      passed: acceptanceFiles,
      failed: [],
      command: 'bun run test:runtime:acceptance'
    },
    logs: { stdout: '', stderr: '' }
  };
}

function noPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

test('non-owning passed gate cannot support a Windows-owned claim', () => {
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('windows-claim', 'platform-gate', ['windows-x64'])],
    gateResults: [passedGate('platform-gate', 'windows-claim', environment('linux'))]
  });

  expect(result.overallStatus).not.toBe('passed');
  expect(result.claimResults[0]?.reasonCode).toBe('current-runner-not-owning-environment');
});

test('owning passed gate supports its claim', () => {
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('windows-claim', 'platform-gate', ['windows-x64'])],
    gateResults: [passedGate('platform-gate', 'windows-claim', environment('windows'))]
  });

  expect(result.overallStatus).toBe('passed');
});

test('overall status lattice is independent of claim order', () => {
  const claims = [
    claim('not-run-claim', 'not-run-gate'),
    claim('invalidated-claim', 'invalidated-gate')
  ];
  const gates = [
    notRunGate('not-run-gate', 'not-run-claim'),
    invalidatedGate('invalidated-gate', 'invalidated-claim')
  ];

  const forward = CodexDevelopmentAggregateVerificationClaimsV1({ claims, gateResults: gates });
  const reverse = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [...claims].reverse(),
    gateResults: [...gates].reverse()
  });

  expect(forward.overallStatus).toBe('invalidated');
  expect(reverse.overallStatus).toBe('invalidated');
  expect(forward.overallReasonCode).toBe(reverse.overallReasonCode);
});

test('proved policy not-applicable does not block fast and runtime claims', () => {
  const summary = buildClaimSummary(
    'all',
    passedFastLane(),
    passedRuntimeLane(['runtime-unit'], ['runtime-acceptance']),
    'full',
    noPolicyReport()
  );

  expect(summary.overall.overallStatus).toBe('passed');
  expect(summary.overall.claimResults.map((entry) => entry.claimId))
    .not.toContain('product-policy-verification');
});

test('full runtime with zero unit tests is invalidated', () => {
  const gate = buildRuntimeClaimGate(
    passedRuntimeLane([], ['runtime-acceptance']),
    'all',
    'full'
  );

  expect(gate.status).toBe('invalidated');
  expect(gate.reasonCode).toBe('selection-unresolved');
});

test('full runtime with zero acceptance tests is invalidated', () => {
  const gate = buildRuntimeClaimGate(
    passedRuntimeLane(['runtime-unit'], []),
    'all',
    'full'
  );

  expect(gate.status).toBe('invalidated');
  expect(gate.reasonCode).toBe('selection-unresolved');
});

test('duplicate gate ids fail closed instead of last-write-wins', () => {
  expect(() => CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('claim-a', 'duplicate-gate')],
    gateResults: [
      passedGate('duplicate-gate', 'claim-a'),
      passedGate('duplicate-gate', 'claim-a')
    ]
  })).toThrow(/duplicate.*gate/i);
});

test('legacy reused evidence without environment identity cannot support a platform claim', () => {
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('linux-claim', 'reused-gate')],
    gateResults: [passedGate('reused-gate', 'linux-claim', null)]
  });

  expect(result.overallStatus).toBe('invalidated');
  expect(result.overallReasonCode).toBe('selection-unresolved');
});
