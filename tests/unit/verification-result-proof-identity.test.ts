import { expect, test } from 'bun:test';

import { aggregateVerificationClaims, BuildVerificationGateResult, verificationEnvironmentIdentity, type VerificationGateResult, type VerificationResultStatus } from '../../src/assurance/verification/result/contract/result.ts';

const CLAIM_ID = 'claim:product';
const GATE_ID = 'gate:product';
const DIGEST = `sha256:${'1'.repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${'2'.repeat(64)}`;

function gate(input: {
  os: string;
  status: VerificationResultStatus;
  gateRevision?: string;
  invalidationRules?: string[];
  requiredForClaims?: string[];
  supportedClaims?: string[];
  reasonCode?: 'executed-failure' | 'selection-unresolved' | 'input-invalidated' | 'not-dispatched';
}): VerificationGateResult {
  const passed = input.status === 'passed';
  const failed = input.status === 'failed';
  const invalidated = input.status === 'invalidated';
  const executed = passed || failed;
  return BuildVerificationGateResult({
    gateId: GATE_ID,
    gateRevision: input.gateRevision ?? 'gate-v1',
    owner: 'verification-owner',
    requirementKey: 'product-verification',
    subjectRevision: 'subject-v1',
    inputDigest: DIGEST,
    applicability: invalidated ? 'unresolved' : 'required',
    status: input.status,
    disposition: executed ? 'executed' : 'not-executed',
    reasonCode: input.reasonCode ?? (
      passed
        ? 'executed-success'
        : failed
          ? 'executed-failure'
          : 'selection-unresolved'
    ),
    requiredForClaims: input.requiredForClaims ?? [CLAIM_ID],
    supportedClaims: input.supportedClaims ?? (passed ? [CLAIM_ID] : []),
    environment: executed ? {
      runtime: 'bun',
      os: input.os,
      arch: 'x64',
      filesystem: null,
      capabilities: [],
      toolchainRevision: 'toolchain-v1',
      providerRevisions: []
    } : invalidated ? {
      runtime: 'bun',
      os: input.os,
      arch: 'x64',
      filesystem: null,
      capabilities: [],
      toolchainRevision: 'toolchain-v1',
      providerRevisions: []
    } : null,
    execution: executed ? {
      argv: ['verify'],
      startedAt: '2026-08-03T00:00:00.000Z',
      finishedAt: '2026-08-03T00:00:00.001Z',
      durationMs: 1,
      exitCode: failed ? 1 : 0,
      outputDigest: OUTPUT_DIGEST,
      failureFingerprint: failed ? 'failure' : null
    } : null,
    evidenceRefs: [],
    invalidationRules: input.invalidationRules ?? [],
    diagnostic: null
  });
}

function aggregate(
  owningEnvironments: string[],
  gateResults: VerificationGateResult[]
) {
  return aggregateVerificationClaims({
    claims: [{
      claimId: CLAIM_ID,
      requiredGateIds: [GATE_ID],
      owningEnvironments
    }],
    gateResults
  });
}

test('a real owning failure outranks a malformed owning observation', () => {
  const linux = verificationEnvironmentIdentity('linux', 'x64');
  const win32 = verificationEnvironmentIdentity('win32', 'x64');
  const malformed = gate({
    os: 'win32',
    status: 'invalidated',
    gateRevision: 'gate-broken',
    reasonCode: 'selection-unresolved'
  });

  const result = aggregate([linux, win32], [
    gate({ os: 'linux', status: 'failed' }),
    malformed
  ]);
  expect(result.overallStatus).toBe('failed');
  expect(result.overallReasonCode).toBe('executed-failure');
});

test('non-owning proof identity cannot invalidate the owning observation', () => {
  const linux = verificationEnvironmentIdentity('linux', 'x64');
  const result = aggregate([linux], [
    gate({ os: 'linux', status: 'passed', gateRevision: 'gate-v1' }),
    gate({ os: 'darwin', status: 'passed', gateRevision: 'gate-v2' })
  ]);
  expect(result.overallStatus).toBe('passed');
});

test('a non-owning failure observation does not change an owning pass', () => {
  const linux = verificationEnvironmentIdentity('linux', 'x64');
  const result = aggregate([linux], [
    gate({ os: 'linux', status: 'passed', gateRevision: 'gate-v1' }),
    gate({ os: 'darwin', status: 'failed', gateRevision: 'gate-v2' })
  ]);
  expect(result.overallStatus).toBe('passed');
});

test('owning observations with mixed proof revisions invalidate a pass', () => {
  const linux = verificationEnvironmentIdentity('linux', 'x64');
  const win32 = verificationEnvironmentIdentity('win32', 'x64');
  const result = aggregate([linux, win32], [
    gate({ os: 'linux', status: 'passed', gateRevision: 'gate-v1' }),
    gate({ os: 'win32', status: 'passed', gateRevision: 'gate-v2' })
  ]);
  expect(result.overallStatus).toBe('invalidated');
  expect(result.overallReasonCode).toBe('selection-unresolved');
});

test('invalidation rules participate in the owning logical proof identity', () => {
  const linux = verificationEnvironmentIdentity('linux', 'x64');
  const win32 = verificationEnvironmentIdentity('win32', 'x64');
  const result = aggregate([linux, win32], [
    gate({ os: 'linux', status: 'passed', invalidationRules: ['source-change'] }),
    gate({ os: 'win32', status: 'passed', invalidationRules: ['toolchain-change'] })
  ]);
  expect(result.overallStatus).toBe('invalidated');
});

test('[not-run, invalidated] is order-independent and later invalidated wins', () => {
  const win32 = verificationEnvironmentIdentity('win32', 'x64');
  const notRun = gate({
    os: 'win32',
    status: 'not-run',
    reasonCode: 'not-dispatched'
  });
  const invalidated = gate({
    os: 'win32',
    status: 'invalidated',
    reasonCode: 'input-invalidated'
  });

  const notRunFirst = aggregate([win32], [notRun, invalidated]);
  const invalidatedFirst = aggregate([win32], [invalidated, notRun]);
  expect(notRunFirst.overallStatus).toBe('invalidated');
  expect(invalidatedFirst.overallStatus).toBe('invalidated');
  expect(notRunFirst.overallReasonCode).toBe('input-invalidated');
  expect(invalidatedFirst.overallReasonCode).toBe('input-invalidated');
});

test('duplicate gate observations fail closed', () => {
  const linux = verificationEnvironmentIdentity('linux', 'x64');
  expect(() => aggregate([linux], [
    gate({ os: 'linux', status: 'passed' }),
    gate({ os: 'linux', status: 'failed' })
  ])).toThrow(/duplicate gate observation/);
});

test('zero observations for a required gate never produce passed', () => {
  const linux = verificationEnvironmentIdentity('linux', 'x64');
  const result = aggregate([linux], []);
  expect(result.overallStatus).toBe('not-run');
  expect(result.overallReasonCode).toBe('not-dispatched');
});
