import { expect, test } from 'bun:test';

import { CodexDevelopmentAggregateVerificationClaims, CodexDevelopmentAssertVerificationGateResult, CodexDevelopmentBuildVerificationGateResult, mapProductVerificationStatus, type VerificationClaimDefinition, type VerificationGateEnvironment, type VerificationGateExecution, type VerificationGateResult } from '../../../src/assurance/verification/result/contract/result.ts';
const INPUT_DIGEST = `sha256:${'a'.repeat(64)}`;
const SUBJECT_REVISION = 'b'.repeat(40);
const OUTPUT_DIGEST = `sha256:${'c'.repeat(64)}`;

function environment(os: string, arch: string, capabilities: string[]): VerificationGateEnvironment {
  return {
    runtime: 'bun@1.3.14',
    os,
    arch,
    filesystem: 'ntfs',
    capabilities,
    toolchainRevision: 'ci-verification-v19',
    providerRevisions: []
  };
}

function execution(exitCode: number): VerificationGateExecution {
  return {
    argv: ['bun', 'test'],
    startedAt: '2026-07-30T10:00:00.000Z',
    finishedAt: '2026-07-30T10:00:05.000Z',
    durationMs: 5000,
    exitCode,
    outputDigest: OUTPUT_DIGEST,
    failureFingerprint: exitCode === 0 ? null : 'failure-fingerprint'
  };
}

// Independent ordinary wire fixtures; the aggregate/reader under test owns admission.
function passedGate(gateId: string, claims: string[], env?: VerificationGateEnvironment): VerificationGateResult {
  return {
    schema: 'sec-verification-gate-result-v1',
    gateId,
    gateRevision: 'gate-rev-1',
    owner: 'test-owner',
    requirementKey: 'test-requirement',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required',
    status: 'passed',
    disposition: 'executed',
    reasonCode: 'executed-success',
    requiredForClaims: [...claims],
    supportedClaims: [...claims],
    environment: env === undefined ? environment('linux', 'x64', ['typescript']) : structuredClone(env),
    execution: execution(0),
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  };
}

function failedGate(gateId: string, claims: string[], reasonCode: 'executed-failure' | 'timeout' | 'cleanup-failed' | 'process-settlement-failed' = 'executed-failure'): VerificationGateResult {
  return {
    schema: 'sec-verification-gate-result-v1',
    gateId,
    gateRevision: 'gate-rev-1',
    owner: 'test-owner',
    requirementKey: 'test-requirement',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required',
    status: 'failed',
    disposition: 'executed',
    reasonCode,
    requiredForClaims: [...claims],
    supportedClaims: [],
    environment: environment('linux', 'x64', ['typescript']),
    execution: execution(1),
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: 'gate failed'
  };
}

function notRunGate(gateId: string, claims: string[], reasonCode: 'not-applicable' | 'fail-fast-prerequisite-failed' | 'current-runner-not-owning-environment' | 'not-dispatched' | 'required-artifact-missing'): VerificationGateResult {
  return {
    schema: 'sec-verification-gate-result-v1',
    gateId,
    gateRevision: 'gate-rev-1',
    owner: 'test-owner',
    requirementKey: 'test-requirement',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: reasonCode === 'not-applicable' ? 'not-applicable' : 'required',
    status: 'not-run',
    disposition: 'not-executed',
    reasonCode,
    requiredForClaims: [...claims],
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  };
}

function unsupportedGate(gateId: string, claims: string[], reasonCode: 'capability-unsupported' | 'platform-unsupported'): VerificationGateResult {
  return {
    schema: 'sec-verification-gate-result-v1',
    gateId,
    gateRevision: 'gate-rev-1',
    owner: 'test-owner',
    requirementKey: 'test-requirement',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode,
    requiredForClaims: [...claims],
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: 'capability not available'
  };
}

function claim(claimId: string, gateIds: string[], owningEnvironments: string[] = ['linux-x64']): VerificationClaimDefinition {
  return { claimId, requiredGateIds: gateIds, owningEnvironments };
}

// ---------------------------------------------------------------------------
// Regression 1: all lane — fast passed + runtime skipped → overall not passed
// ---------------------------------------------------------------------------

test('regression 1: all-lane fast-passed + runtime-skipped → overall not passed', () => {
  const fastGate = passedGate('fast-gate', ['overall']);
  const runtimeGate = notRunGate('runtime-gate', ['overall'], 'fail-fast-prerequisite-failed');
  const result = CodexDevelopmentAggregateVerificationClaims({
    claims: [claim('overall', ['fast-gate', 'runtime-gate'])],
    gateResults: [fastGate, runtimeGate]
  });
  expect(result.overallStatus).toBe('not-run');
  expect(result.claimResults[0]!.status).toBe('not-run');
  expect(result.claimResults[0]!.reasonCode).toBe('fail-fast-prerequisite-failed');
});

// ---------------------------------------------------------------------------
// Regression 2: runtime requested + fast not-applicable + runtime passed
//                → runtime claim passed, fast not pseudo-passed
// ---------------------------------------------------------------------------

test('regression 2: runtime requested + fast not-applicable + runtime passed → runtime claim passed', () => {
  const fastGate = notRunGate('fast-gate', [], 'not-applicable');
  const runtimeGate = passedGate('runtime-gate', ['runtime-claim']);
  const input = {
    claims: [claim('runtime-claim', ['runtime-gate'])],
    gateResults: [fastGate, runtimeGate]
  };
  const result = CodexDevelopmentAggregateVerificationClaims(input);
  expect(result.overallStatus).toBe('passed');
  expect(result.claimResults[0]!.status).toBe('passed');
  // fast-gate is not-applicable so it doesn't contribute to this claim
  expect(result.claimResults[0]!.contributingGateIds).toEqual(['runtime-gate']);
});

// ---------------------------------------------------------------------------
// Regression 3: fast failed → runtime not-run/prerequisite-failed; overall failed
// ---------------------------------------------------------------------------

test('regression 3: fast failed → runtime not-run, overall failed', () => {
  const fastGate = failedGate('fast-gate', ['overall']);
  // Failed observations may retain a supported-claim link without becoming a pass.
  fastGate.supportedClaims = ['overall'];
  const runtimeGate = notRunGate('runtime-gate', ['overall'], 'fail-fast-prerequisite-failed');
  const input = {
    claims: [claim('overall', ['fast-gate', 'runtime-gate'])],
    gateResults: [fastGate, runtimeGate]
  };
  const result = CodexDevelopmentAggregateVerificationClaims(input);
  expect(result.overallStatus).toBe('failed');
  expect(result.claimResults[0]!.status).toBe('failed');
});

test('a non-owning observation cannot authorize a claim owned by another environment', () => {
  const gate = passedGate(
    'linux-gate',
    ['windows-owned-claim'],
    environment('linux', 'x64', ['typescript'])
  );
  const result = CodexDevelopmentAggregateVerificationClaims({
    claims: [claim('windows-owned-claim', ['linux-gate'], ['windows-x64'])],
    gateResults: [gate]
  });
  expect(result.overallStatus).toBe('not-run');
  expect(result.overallReasonCode).toBe('current-runner-not-owning-environment');
  expect(result.claimResults[0]!.status).toBe('not-run');
  expect(result.claimResults[0]!.reasonCode).toBe('current-runner-not-owning-environment');
});

// ---------------------------------------------------------------------------
// Regression 5: an optional provider is unsupported while an independent claim passes.
// ---------------------------------------------------------------------------

test('regression 5: an unsupported optional provider does not invalidate an independent passed claim', () => {
  const typescriptGate = passedGate('ts-gate', ['typescript-claim']);
  const optionalGate = unsupportedGate('optional-gate', ['optional-claim'], 'capability-unsupported');
  const input = {
    claims: [
      claim('typescript-claim', ['ts-gate']),
      claim('optional-claim', ['optional-gate'])
    ],
    gateResults: [typescriptGate, optionalGate]
  };
  const result = CodexDevelopmentAggregateVerificationClaims(input);
  // typescript claim should pass
  const tsResult = result.claimResults.find((c) => c.claimId === 'typescript-claim');
  expect(tsResult!.status).toBe('passed');
  const optionalResult = result.claimResults.find((c) => c.claimId === 'optional-claim');
  expect(optionalResult!.status).toBe('unsupported');
  // overall: not passed because one required claim is unsupported.
  expect(result.overallStatus).toBe('unsupported');
});

// ---------------------------------------------------------------------------
// Builder & validator tests
// ---------------------------------------------------------------------------

test('validator rejects proof-shaped placeholders that do not describe an execution', () => {
  const zeroInput = passedGate('zero-input', ['claim']);
  zeroInput.inputDigest = `sha256:${'0'.repeat(64)}`;
  expect(() => CodexDevelopmentAssertVerificationGateResult(zeroInput))
    .toThrow(/all-zero proof placeholder/);

  const emptyInvocation = passedGate('empty-invocation', ['claim']);
  emptyInvocation.execution!.argv = [];
  expect(() => CodexDevelopmentAssertVerificationGateResult(emptyInvocation))
    .toThrow(/actual invocation/);

  const epochExecution = passedGate('epoch-execution', ['claim']);
  epochExecution.execution!.startedAt = '1970-01-01T00:00:00.000Z';
  expect(() => CodexDevelopmentAssertVerificationGateResult(epochExecution))
    .toThrow(/real forward execution interval/);
});

test('validator rejects passed status with not-executed disposition', () => {
  expect(() => {
    CodexDevelopmentBuildVerificationGateResult({
      gateId: 'bad-gate',
      gateRevision: 'rev-1',
      owner: 'test',
      requirementKey: 'req',
      subjectRevision: SUBJECT_REVISION,
      inputDigest: INPUT_DIGEST,
      applicability: 'required',
      status: 'passed',
      disposition: 'not-executed',
      reasonCode: 'executed-success',
      requiredForClaims: ['claim'],
      supportedClaims: ['claim'],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: null
    });
  }).toThrow(/passed status cannot pair with not-executed/);
});

test('validator rejects failed status with not-executed disposition', () => {
  expect(() => {
    CodexDevelopmentBuildVerificationGateResult({
      gateId: 'bad-gate',
      gateRevision: 'rev-1',
      owner: 'test',
      requirementKey: 'req',
      subjectRevision: SUBJECT_REVISION,
      inputDigest: INPUT_DIGEST,
      applicability: 'required',
      status: 'failed',
      disposition: 'not-executed',
      reasonCode: 'executed-failure',
      requiredForClaims: ['claim'],
      supportedClaims: [],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: null
    });
  }).toThrow(/failed status requires executed or reused disposition/);
});

test('reused results retain their status and require evidence plus environment identity', () => {
  for (const status of ['passed', 'failed'] as const) {
    const original = status === 'passed'
      ? passedGate('reuse-gate', ['claim'])
      : failedGate('reuse-gate', ['claim']);
    const { schema: _schema, ...input } = original;
    const reused = { ...input, disposition: 'reused' as const, execution: null,
      evidenceRefs: ['evidence://original-result'] };
    const result = CodexDevelopmentBuildVerificationGateResult(reused);
    expect(result).toMatchObject({ status, disposition: 'reused', execution: null,
      reasonCode: status === 'passed' ? 'executed-success' : 'executed-failure' });
    // Evidence and environment are disposition guards, independent of pass/fail status.
    expect(() => CodexDevelopmentBuildVerificationGateResult({ ...reused,
      ...(status === 'passed' ? { evidenceRefs: [] } : { environment: null }) }))
      .toThrow(status === 'passed'
        ? /reused disposition requires non-empty evidenceRefs/
        : /reused disposition requires a non-null environment identity/);
    if (status === 'failed') {
      expect(() => CodexDevelopmentAssertVerificationGateResult({ ...result, status: 'passed' }))
        .toThrow(/passed status requires/);
    }
  }
});

test('validator rejects unresolved applicability with non-invalidated status', () => {
  expect(() => {
    CodexDevelopmentBuildVerificationGateResult({
      gateId: 'bad-gate',
      gateRevision: 'rev-1',
      owner: 'test',
      requirementKey: 'req',
      subjectRevision: SUBJECT_REVISION,
      inputDigest: INPUT_DIGEST,
      applicability: 'unresolved',
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'not-applicable',
      requiredForClaims: ['claim'],
      supportedClaims: [],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: null
    });
  }).toThrow(/unresolved applicability requires invalidated status/);
});

// ---------------------------------------------------------------------------
// Legacy mapping helper tests
// ---------------------------------------------------------------------------

test('mapProductVerificationStatus: skipped with fastFailed → not-run/fail-fast', () => {
  const result = mapProductVerificationStatus('skipped', {
    requestedLane: 'all',
    lane: 'runtime',
    fastFailed: true
  });
  expect(result.status).toBe('not-run');
  expect(result.reasonCode).toBe('fail-fast-prerequisite-failed');
});

test('mapProductVerificationStatus: skipped with non-owning runner → not-run/not-owning', () => {
  const result = mapProductVerificationStatus('skipped', {
    requestedLane: 'all',
    lane: 'runtime',
    currentRunnerOwning: false
  });
  expect(result.status).toBe('not-run');
  expect(result.reasonCode).toBe('current-runner-not-owning-environment');
});

test('mapProductVerificationStatus: skipped with lane not requested → not-run/not-applicable', () => {
  const result = mapProductVerificationStatus('skipped', {
    requestedLane: 'fast',
    lane: 'runtime'
  });
  expect(result.status).toBe('not-run');
  expect(result.reasonCode).toBe('not-applicable');
});

test('mapProductVerificationStatus: skipped with insufficient context → invalidated', () => {
  const result = mapProductVerificationStatus('skipped', {
    requestedLane: 'all',
    lane: 'runtime',
    currentRunnerOwning: true
  });
  expect(result.status).toBe('invalidated');
  expect(result.reasonCode).toBe('selection-unresolved');
});

// Aggregate edge cases
// ---------------------------------------------------------------------------

test('aggregate: missing required gate → claim not-run', () => {
  const gate = passedGate('present-gate', ['claim-1']);
  const result = CodexDevelopmentAggregateVerificationClaims({
    claims: [claim('claim-1', ['present-gate', 'missing-gate'])],
    gateResults: [gate]
  });
  expect(result.overallStatus).toBe('not-run');
  expect(result.overallReasonCode).toBe('not-dispatched');
  expect(result.claimResults[0]!.status).toBe('not-run');
  expect(result.claimResults[0]!.reasonCode).toBe('not-dispatched');
});

test('aggregate preserves the decisive overall failure reason', () => {
  const gate = failedGate('decisive-gate', ['decisive-claim'], 'cleanup-failed');
  const input = {
    claims: [claim('decisive-claim', ['passed-gate', 'decisive-gate'])],
    gateResults: [passedGate('passed-gate', ['decisive-claim']), gate]
  };
  const result = CodexDevelopmentAggregateVerificationClaims(input);
  expect(result).toMatchObject({
    overallStatus: 'failed',
    overallReasonCode: 'cleanup-failed',
    claimResults: [{ status: 'failed' }]
  });
});
