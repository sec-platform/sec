import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentAssertVerificationGateResultV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  mapCiEvidenceV2Status,
  mapEvidenceDisposition,
  mapProductVerificationStatus,
  mapSemanticMutationBlocked,
  VERIFICATION_GATE_RESULT_SCHEMA_V1,
  type VerificationApplicability,
  type VerificationDisposition,
  type VerificationGateEnvironmentV1,
  type VerificationGateExecutionV1,
  type VerificationGateResultV1,
  type VerificationReasonCode,
  type VerificationResultStatus
} from '../../platform/shared/verification-result-contract.ts';

const INPUT_DIGEST = `sha256:${'a'.repeat(64)}`;
const SUBJECT_REVISION = 'b'.repeat(40);

// ---------------------------------------------------------------------------
// Schema constant contract
// ---------------------------------------------------------------------------

test('schema constant is sec-verification-gate-result-v1', () => {
  expect(VERIFICATION_GATE_RESULT_SCHEMA_V1).toBe('sec-verification-gate-result-v1');
});

// ---------------------------------------------------------------------------
// Type exhaustiveness contracts (compile-time + runtime)
// ---------------------------------------------------------------------------

test('VerificationResultStatus has exactly 5 values', () => {
  const statuses: VerificationResultStatus[] = ['passed', 'failed', 'not-run', 'unsupported', 'invalidated'];
  expect(statuses).toHaveLength(5);
  expect(new Set(statuses).size).toBe(5);
});

test('VerificationDisposition has exactly 3 values', () => {
  const dispositions: VerificationDisposition[] = ['executed', 'reused', 'not-executed'];
  expect(dispositions).toHaveLength(3);
});

test('VerificationApplicability has exactly 4 values', () => {
  const applicabilities: VerificationApplicability[] = ['required', 'optional', 'not-applicable', 'unresolved'];
  expect(applicabilities).toHaveLength(4);
});

test('VerificationReasonCode has exactly 17 values', () => {
  const codes: VerificationReasonCode[] = [
    'executed-success', 'executed-failure', 'not-applicable', 'fail-fast-prerequisite-failed',
    'current-runner-not-owning-environment', 'not-dispatched', 'required-artifact-missing',
    'capability-unsupported', 'platform-unsupported', 'selection-unresolved', 'input-invalidated',
    'evidence-stale', 'superseded-revision', 'cancelled', 'timeout', 'cleanup-failed',
    'process-settlement-failed'
  ];
  expect(codes).toHaveLength(17);
  expect(new Set(codes).size).toBe(17);
});

// ---------------------------------------------------------------------------
// Validator negative cases
// ---------------------------------------------------------------------------

function minimalValidInput() {
  return {
    gateId: 'gate-1',
    gateRevision: 'rev-1',
    owner: 'owner-1',
    requirementKey: 'req-1',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required' as VerificationApplicability,
    status: 'passed' as VerificationResultStatus,
    disposition: 'executed' as VerificationDisposition,
    reasonCode: 'executed-success' as VerificationReasonCode,
    requiredForClaims: ['claim-1'],
    supportedClaims: ['claim-1'],
    environment: {
      runtime: 'bun@1.3.14',
      os: 'linux',
      arch: 'x64',
      filesystem: 'ext4',
      capabilities: ['typescript'],
      toolchainRevision: 'ci-verification-v19',
      providerRevisions: []
    } as VerificationGateEnvironmentV1,
    execution: {
      argv: ['bun', 'test'],
      startedAt: '2026-07-30T10:00:00.000Z',
      finishedAt: '2026-07-30T10:00:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      outputDigest: `sha256:${'c'.repeat(64)}`,
      failureFingerprint: null
    } as VerificationGateExecutionV1,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  };
}

test('validator rejects unknown schema', () => {
  const input = minimalValidInput();
  const bad = { schema: 'wrong-schema', ...input } as unknown as VerificationGateResultV1;
  expect(() => CodexDevelopmentAssertVerificationGateResultV1(bad)).toThrow(/schema must be/);
});

test('validator rejects missing required field', () => {
  const input = minimalValidInput();
  const { gateId, ...withoutGateId } = input;
  expect(() => CodexDevelopmentAssertVerificationGateResultV1({ schema: VERIFICATION_GATE_RESULT_SCHEMA_V1, ...withoutGateId })).toThrow(/unknown or missing fields/);
});

test('validator rejects invalid digest format', () => {
  const input = minimalValidInput();
  const bad = { schema: VERIFICATION_GATE_RESULT_SCHEMA_V1, ...input, inputDigest: 'not-a-digest' } as unknown as VerificationGateResultV1;
  expect(() => CodexDevelopmentAssertVerificationGateResultV1(bad)).toThrow(/inputDigest must be a sha256 digest/);
});

test('validator rejects unsupported status with wrong reasonCode', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA_V1,
    ...input,
    applicability: 'required',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'executed-success',
    environment: null,
    execution: null
  } as unknown as VerificationGateResultV1;
  expect(() => CodexDevelopmentAssertVerificationGateResultV1(bad)).toThrow(/unsupported status requires/);
});

test('validator rejects not-applicable applicability with passed status', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA_V1,
    ...input,
    applicability: 'not-applicable',
    status: 'passed'
  } as unknown as VerificationGateResultV1;
  expect(() => CodexDevelopmentAssertVerificationGateResultV1(bad)).toThrow(/not-applicable applicability requires not-run status/);
});

test('validator rejects executed disposition with null environment', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA_V1,
    ...input,
    environment: null
  } as unknown as VerificationGateResultV1;
  expect(() => CodexDevelopmentAssertVerificationGateResultV1(bad)).toThrow(/executed disposition requires non-null environment/);
});

test('validator rejects not-executed disposition with non-null execution', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA_V1,
    ...input,
    status: 'not-run',
    disposition: 'not-executed',
    reasonCode: 'not-applicable',
    applicability: 'not-applicable',
    environment: null,
    execution: input.execution
  } as unknown as VerificationGateResultV1;
  expect(() => CodexDevelopmentAssertVerificationGateResultV1(bad)).toThrow(/not-executed disposition must have null execution/);
});

// ---------------------------------------------------------------------------
// Builder contract
// ---------------------------------------------------------------------------

test('builder adds schema and validates', () => {
  const gate = CodexDevelopmentBuildVerificationGateResultV1(minimalValidInput());
  expect(gate.schema).toBe(VERIFICATION_GATE_RESULT_SCHEMA_V1);
  expect(gate.gateId).toBe('gate-1');
});

test('builder rejects invalid input', () => {
  const input = minimalValidInput();
  expect(() => CodexDevelopmentBuildVerificationGateResultV1({ ...input, status: 'invalid-status' as VerificationResultStatus })).toThrow();
});

// ---------------------------------------------------------------------------
// Aggregate contract
// ---------------------------------------------------------------------------

test('aggregate returns empty claimResults for empty claims', () => {
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [],
    gateResults: []
  });
  expect(result.overallStatus).toBe('passed');
  expect(result.claimResults).toEqual([]);
});

test('aggregate result has correct shape', () => {
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [{ claimId: 'c1', requiredGateIds: ['g1'], owningEnvironments: ['linux'] }],
    gateResults: []
  });
  expect(result).toHaveProperty('overallStatus');
  expect(result).toHaveProperty('overallReasonCode');
  expect(result).toHaveProperty('claimResults');
  expect(Array.isArray(result.claimResults)).toBe(true);
  expect(result.claimResults).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Legacy mapping contract
// ---------------------------------------------------------------------------

test('mapProductVerificationStatus never promotes skipped to passed', () => {
  const contexts = [
    { requestedLane: 'fast' as const, lane: 'runtime' as const },
    { requestedLane: 'all' as const, lane: 'runtime' as const, fastFailed: true },
    { requestedLane: 'all' as const, lane: 'runtime' as const, currentRunnerOwning: false },
    { requestedLane: 'all' as const, lane: 'runtime' as const, currentRunnerOwning: true }
  ];
  for (const ctx of contexts) {
    const result = mapProductVerificationStatus('skipped', ctx);
    expect(result.status).not.toBe('passed');
  }
});

test('mapCiEvidenceV2Status never promotes not-run to passed', () => {
  const reasons = [null, 'unknown reason', 'not-applicable', 'prerequisite failed', 'owning environment', 'artifact missing'];
  for (const reason of reasons) {
    const result = mapCiEvidenceV2Status('not-run', reason);
    expect(result.status).not.toBe('passed');
  }
});

test('mapSemanticMutationBlocked never promotes blocked to passed', () => {
  const reasons: Array<'capability' | 'authorization' | 'precondition' | 'plan-changed' | 'not-reached' | 'unknown'> =
    ['capability', 'authorization', 'precondition', 'plan-changed', 'not-reached', 'unknown'];
  for (const reason of reasons) {
    const result = mapSemanticMutationBlocked('blocked', { blockedReason: reason });
    expect(result.status).not.toBe('passed');
  }
});

test('mapEvidenceDisposition maps all 3 dispositions', () => {
  expect(mapEvidenceDisposition('executed').disposition).toBe('executed');
  expect(mapEvidenceDisposition('reused').disposition).toBe('reused');
  expect(mapEvidenceDisposition('delta').disposition).toBe('not-executed');
});
