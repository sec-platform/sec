import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  CodexDevelopmentVerificationEnvironmentIdentityV1,
  type VerificationGateResultV1,
  type VerificationResultStatus
} from '../../platform/shared/verification-result-contract.ts';

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
}): VerificationGateResultV1 {
  const passed = input.status === 'passed';
  const failed = input.status === 'failed';
  const invalidated = input.status === 'invalidated';
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId: GATE_ID,
    gateRevision: input.gateRevision ?? 'gate-v1',
    owner: 'verification-owner',
    requirementKey: 'product-verification',
    subjectRevision: 'subject-v1',
    inputDigest: DIGEST,
    applicability: invalidated ? 'unresolved' : 'required',
    status: input.status,
    disposition: failed || passed ? 'executed' : 'not-executed',
    reasonCode: passed
      ? 'executed-success'
      : failed
        ? 'executed-failure'
        : 'selection-unresolved',
    requiredForClaims: input.requiredForClaims ?? [CLAIM_ID],
    supportedClaims: passed ? [CLAIM_ID] : [],
    environment: failed || passed ? {
      runtime: 'bun',
      os: input.os,
      arch: 'x64',
      filesystem: null,
      capabilities: [],
      toolchainRevision: 'toolchain-v1',
      providerRevisions: []
    } : null,
    execution: failed || passed ? {
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
  gateResults: VerificationGateResultV1[]
) {
  return CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [{
      claimId: CLAIM_ID,
      requiredGateIds: [GATE_ID],
      owningEnvironments
    }],
    gateResults
  });
}

test('a real owning failure outranks a malformed owning observation', () => {
  const linux = CodexDevelopmentVerificationEnvironmentIdentityV1('linux', 'x64');
  const win32 = CodexDevelopmentVerificationEnvironmentIdentityV1('win32', 'x64');
  const malformed = gate({
    os: 'win32',
    status: 'invalidated',
    requiredForClaims: []
  });

  const result = aggregate([linux, win32], [
    gate({ os: 'linux', status: 'failed' }),
    malformed
  ]);
  expect(result.overallStatus).toBe('failed');
  expect(result.overallReasonCode).toBe('executed-failure');
});

test('non-owning proof identity cannot invalidate the owning observation', () => {
  const linux = CodexDevelopmentVerificationEnvironmentIdentityV1('linux', 'x64');
  const result = aggregate([linux], [
    gate({ os: 'linux', status: 'passed', gateRevision: 'gate-v1' }),
    gate({ os: 'darwin', status: 'passed', gateRevision: 'gate-v2' })
  ]);
  expect(result.overallStatus).toBe('passed');
});

test('owning observations with mixed proof revisions invalidate a pass', () => {
  const linux = CodexDevelopmentVerificationEnvironmentIdentityV1('linux', 'x64');
  const win32 = CodexDevelopmentVerificationEnvironmentIdentityV1('win32', 'x64');
  const result = aggregate([linux, win32], [
    gate({ os: 'linux', status: 'passed', gateRevision: 'gate-v1' }),
    gate({ os: 'win32', status: 'passed', gateRevision: 'gate-v2' })
  ]);
  expect(result.overallStatus).toBe('invalidated');
  expect(result.overallReasonCode).toBe('selection-unresolved');
});

test('invalidation rules participate in the owning logical proof identity', () => {
  const linux = CodexDevelopmentVerificationEnvironmentIdentityV1('linux', 'x64');
  const win32 = CodexDevelopmentVerificationEnvironmentIdentityV1('win32', 'x64');
  const result = aggregate([linux, win32], [
    gate({ os: 'linux', status: 'passed', invalidationRules: ['source-change'] }),
    gate({ os: 'win32', status: 'passed', invalidationRules: ['toolchain-change'] })
  ]);
  expect(result.overallStatus).toBe('invalidated');
});
