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
  type VerificationClaimDefinitionV1,
  type VerificationGateEnvironmentV1,
  type VerificationGateExecutionV1,
  type VerificationGateResultV1
} from '../../platform/shared/verification-result-contract.ts';

const INPUT_DIGEST = `sha256:${'a'.repeat(64)}`;
const SUBJECT_REVISION = 'b'.repeat(40);
const OUTPUT_DIGEST = `sha256:${'c'.repeat(64)}`;

function environment(os: string, arch: string, capabilities: string[]): VerificationGateEnvironmentV1 {
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

function execution(exitCode: number): VerificationGateExecutionV1 {
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

function passedGate(gateId: string, claims: string[], env?: VerificationGateEnvironmentV1): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
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
    requiredForClaims: claims,
    supportedClaims: claims,
    environment: env ?? environment('linux', 'x64', ['typescript']),
    execution: execution(0),
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

function failedGate(gateId: string, claims: string[], reasonCode: 'executed-failure' | 'timeout' | 'cleanup-failed' | 'process-settlement-failed' = 'executed-failure'): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
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
    requiredForClaims: claims,
    supportedClaims: [],
    environment: environment('linux', 'x64', ['typescript']),
    execution: execution(1),
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: 'gate failed'
  });
}

function notRunGate(gateId: string, claims: string[], reasonCode: 'not-applicable' | 'fail-fast-prerequisite-failed' | 'current-runner-not-owning-environment' | 'not-dispatched' | 'required-artifact-missing'): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
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
    requiredForClaims: claims,
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

function unsupportedGate(gateId: string, claims: string[], reasonCode: 'capability-unsupported' | 'platform-unsupported'): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
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
    requiredForClaims: claims,
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: 'capability not available'
  });
}

function invalidatedGate(gateId: string, claims: string[], reasonCode: 'selection-unresolved' | 'input-invalidated' | 'evidence-stale' | 'superseded-revision' | 'cancelled'): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: 'gate-rev-1',
    owner: 'test-owner',
    requirementKey: 'test-requirement',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'unresolved',
    status: 'invalidated',
    disposition: 'not-executed',
    reasonCode,
    requiredForClaims: claims,
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: 'result invalidated'
  });
}

function reusedPassedGate(gateId: string, claims: string[], evidenceRefs: string[]): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: 'gate-rev-1',
    owner: 'test-owner',
    requirementKey: 'test-requirement',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required',
    status: 'passed',
    disposition: 'reused',
    reasonCode: 'executed-success',
    requiredForClaims: claims,
    supportedClaims: claims,
    environment: null,
    execution: null,
    evidenceRefs,
    invalidationRules: [],
    diagnostic: null
  });
}

function claim(claimId: string, gateIds: string[], owningEnvironments: string[] = ['linux-x64']): VerificationClaimDefinitionV1 {
  return { claimId, requiredGateIds: gateIds, owningEnvironments };
}

// ---------------------------------------------------------------------------
// Regression 1: all lane — fast passed + runtime skipped → overall not passed
// ---------------------------------------------------------------------------

test('regression 1: all-lane fast-passed + runtime-skipped → overall not passed', () => {
  const fastGate = passedGate('fast-gate', ['overall']);
  const runtimeGate = notRunGate('runtime-gate', ['overall'], 'fail-fast-prerequisite-failed');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('overall', ['fast-gate', 'runtime-gate'])],
    gateResults: [fastGate, runtimeGate]
  });
  expect(result.overallStatus).not.toBe('passed');
  expect(result.overallStatus).toBe('not-run');
  expect(result.claimResults[0]!.status).toBe('not-run');
  expect(result.claimResults[0]!.reasonCode).toBe('fail-fast-prerequisite-failed');
});

// ---------------------------------------------------------------------------
// Regression 2: runtime requested + fast not-applicable + runtime passed
//                → runtime claim passed, fast not pseudo-passed
// ---------------------------------------------------------------------------

test('regression 2: runtime requested + fast not-applicable + runtime passed → runtime claim passed', () => {
  const fastGate = notRunGate('fast-gate', ['runtime-claim'], 'not-applicable');
  const runtimeGate = passedGate('runtime-gate', ['runtime-claim']);
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('runtime-claim', ['runtime-gate'])],
    gateResults: [fastGate, runtimeGate]
  });
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
  const runtimeGate = notRunGate('runtime-gate', ['overall'], 'fail-fast-prerequisite-failed');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('overall', ['fast-gate', 'runtime-gate'])],
    gateResults: [fastGate, runtimeGate]
  });
  expect(result.overallStatus).toBe('failed');
  expect(result.claimResults[0]!.status).toBe('failed');
});

// ---------------------------------------------------------------------------
// Regression 4: Windows required gate on Linux not-run, missing Windows result
//                → claim not-run
// ---------------------------------------------------------------------------

test('regression 4: Windows required gate on Linux not-run → claim not-run', () => {
  // Linux runner executes its gate, but the Windows owning gate is not-run
  // because the current runner is not the owning environment.
  const linuxGate = passedGate('linux-gate', ['windows-claim'], environment('linux', 'x64', ['typescript']));
  const windowsGate = notRunGate('windows-gate', ['windows-claim'], 'current-runner-not-owning-environment');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('windows-claim', ['windows-gate'], ['windows-x64'])],
    gateResults: [linuxGate, windowsGate]
  });
  expect(result.overallStatus).toBe('not-run');
  expect(result.claimResults[0]!.status).toBe('not-run');
  expect(result.claimResults[0]!.reasonCode).toBe('current-runner-not-owning-environment');
});

// ---------------------------------------------------------------------------
// Regression 5: optional Browser unsupported → non-browser claim passed,
//                browser claim unsupported
// ---------------------------------------------------------------------------

test('regression 5: optional Browser unsupported → non-browser claim passed, browser unsupported', () => {
  const typescriptGate = passedGate('ts-gate', ['typescript-claim']);
  const browserGate = unsupportedGate('browser-gate', ['browser-claim'], 'capability-unsupported');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [
      claim('typescript-claim', ['ts-gate']),
      claim('browser-claim', ['browser-gate'])
    ],
    gateResults: [typescriptGate, browserGate]
  });
  // typescript claim should pass
  const tsResult = result.claimResults.find((c) => c.claimId === 'typescript-claim');
  expect(tsResult!.status).toBe('passed');
  // browser claim should be unsupported
  const browserResult = result.claimResults.find((c) => c.claimId === 'browser-claim');
  expect(browserResult!.status).toBe('unsupported');
  // overall: not passed (browser claim is unsupported)
  expect(result.overallStatus).toBe('unsupported');
});

// ---------------------------------------------------------------------------
// Regression 6: empty affected source closure → invalidated/non-zero
// ---------------------------------------------------------------------------

test('regression 6: empty affected source closure → invalidated, not passed', () => {
  // Simulate: source changed but no tests selected, and selection is unresolved.
  // The gate for this claim is invalidated with selection-unresolved.
  const affectedGate = invalidatedGate('affected-gate', ['affected-closure'], 'selection-unresolved');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('affected-closure', ['affected-gate'])],
    gateResults: [affectedGate]
  });
  expect(result.overallStatus).toBe('invalidated');
  expect(result.claimResults[0]!.status).toBe('invalidated');
  expect(result.claimResults[0]!.reasonCode).toBe('selection-unresolved');
  expect(result.overallStatus).not.toBe('passed');
});

// ---------------------------------------------------------------------------
// Regression 7: stale reused evidence → invalidated, not passed
// ---------------------------------------------------------------------------

test('regression 7: stale reused evidence → invalidated, not passed', () => {
  // A gate that was reused but the evidence is now stale.
  const staleGate = invalidatedGate('stale-gate', ['reuse-claim'], 'evidence-stale');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('reuse-claim', ['stale-gate'])],
    gateResults: [staleGate]
  });
  expect(result.overallStatus).toBe('invalidated');
  expect(result.claimResults[0]!.status).toBe('invalidated');
  expect(result.claimResults[0]!.reasonCode).toBe('evidence-stale');
});

// ---------------------------------------------------------------------------
// Regression 8: cleanup failure after assertions pass → failed
// ---------------------------------------------------------------------------

test('regression 8: cleanup failure after assertions pass → failed', () => {
  // The test gate passed, but the cleanup gate failed.
  const testGate = passedGate('test-gate', ['cleanup-claim']);
  const cleanupGate = failedGate('cleanup-gate', ['cleanup-claim'], 'cleanup-failed');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('cleanup-claim', ['test-gate', 'cleanup-gate'])],
    gateResults: [testGate, cleanupGate]
  });
  expect(result.overallStatus).toBe('failed');
  expect(result.claimResults[0]!.status).toBe('failed');
});

// ---------------------------------------------------------------------------
// Regression 9: not-applicable requires applicability revision;
//                without proof → invalidated
// ---------------------------------------------------------------------------

test('regression 9: not-applicable without applicability proof → invalidated', () => {
  // A gate claims not-applicable but has unresolved applicability.
  // The validator enforces: unresolved applicability → invalidated status.
  const gate = invalidatedGate('na-gate', ['na-claim'], 'selection-unresolved');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('na-claim', ['na-gate'])],
    gateResults: [gate]
  });
  expect(result.overallStatus).toBe('invalidated');
  expect(result.claimResults[0]!.status).toBe('invalidated');
});

// ---------------------------------------------------------------------------
// Regression 10: V2 evidence adapter cannot increase claims
// ---------------------------------------------------------------------------

test('regression 10: V2 evidence adapter maps without increasing claims', () => {
  // V2 evidence has status passed/failed/not-run. Mapping to unified model
  // must not introduce new supportedClaims.
  const passedMapping = mapCiEvidenceV2Status('passed', null);
  expect(passedMapping.status).toBe('passed');
  expect(passedMapping.disposition).toBe('executed');

  const failedMapping = mapCiEvidenceV2Status('failed', null);
  expect(failedMapping.status).toBe('failed');
  expect(failedMapping.disposition).toBe('executed');

  const notRunMapping = mapCiEvidenceV2Status('not-run', 'not-applicable for this platform');
  expect(notRunMapping.status).toBe('not-run');
  expect(notRunMapping.disposition).toBe('not-executed');
  expect(notRunMapping.reasonCode).toBe('not-applicable');

  // Lossy not-run reason → invalidated, never promoted to passed
  const lossyMapping = mapCiEvidenceV2Status('not-run', 'some unknown reason');
  expect(lossyMapping.status).toBe('invalidated');
  expect(lossyMapping.reasonCode).toBe('selection-unresolved');
});

// ---------------------------------------------------------------------------
// Builder & validator tests
// ---------------------------------------------------------------------------

test('builder produces valid gate result and validator accepts it', () => {
  const gate = passedGate('test-gate', ['test-claim']);
  // Should not throw
  CodexDevelopmentAssertVerificationGateResultV1(gate);
  expect(gate.schema).toBe(VERIFICATION_GATE_RESULT_SCHEMA_V1);
});

test('validator rejects passed status with not-executed disposition', () => {
  expect(() => {
    CodexDevelopmentBuildVerificationGateResultV1({
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
    CodexDevelopmentBuildVerificationGateResultV1({
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
  }).toThrow(/failed status requires executed disposition/);
});

test('validator rejects reused disposition without evidenceRefs', () => {
  expect(() => {
    CodexDevelopmentBuildVerificationGateResultV1({
      gateId: 'bad-gate',
      gateRevision: 'rev-1',
      owner: 'test',
      requirementKey: 'req',
      subjectRevision: SUBJECT_REVISION,
      inputDigest: INPUT_DIGEST,
      applicability: 'required',
      status: 'passed',
      disposition: 'reused',
      reasonCode: 'executed-success',
      requiredForClaims: ['claim'],
      supportedClaims: ['claim'],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: null
    });
  }).toThrow(/reused disposition requires non-empty evidenceRefs/);
});

test('validator rejects unresolved applicability with non-invalidated status', () => {
  expect(() => {
    CodexDevelopmentBuildVerificationGateResultV1({
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

test('reused passed gate is valid and aggregates as passed', () => {
  const gate = reusedPassedGate('reused-gate', ['reuse-claim'], ['evidence-1', 'evidence-2']);
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('reuse-claim', ['reused-gate'])],
    gateResults: [gate]
  });
  expect(result.overallStatus).toBe('passed');
  expect(result.claimResults[0]!.status).toBe('passed');
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

test('mapSemanticMutationBlocked: blocked with capability → unsupported', () => {
  const result = mapSemanticMutationBlocked('blocked', { blockedReason: 'capability' });
  expect(result.status).toBe('unsupported');
  expect(result.reasonCode).toBe('capability-unsupported');
});

test('mapSemanticMutationBlocked: blocked with not-reached → not-run', () => {
  const result = mapSemanticMutationBlocked('blocked', { blockedReason: 'not-reached' });
  expect(result.status).toBe('not-run');
  expect(result.reasonCode).toBe('fail-fast-prerequisite-failed');
});

test('mapSemanticMutationBlocked: blocked with unknown → invalidated (lossy)', () => {
  const result = mapSemanticMutationBlocked('blocked', { blockedReason: 'unknown' });
  expect(result.status).toBe('invalidated');
  expect(result.reasonCode).toBe('selection-unresolved');
});

test('mapEvidenceDisposition: delta → not-executed (not a completion status)', () => {
  const result = mapEvidenceDisposition('delta');
  expect(result.disposition).toBe('not-executed');
  expect(result.note).toContain('refining gate');
});

test('mapEvidenceDisposition: reused → reused disposition', () => {
  const result = mapEvidenceDisposition('reused');
  expect(result.disposition).toBe('reused');
});

// ---------------------------------------------------------------------------
// Aggregate edge cases
// ---------------------------------------------------------------------------

test('aggregate: missing required gate → claim not-run', () => {
  const gate = passedGate('present-gate', ['claim-1']);
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('claim-1', ['present-gate', 'missing-gate'])],
    gateResults: [gate]
  });
  expect(result.overallStatus).toBe('not-run');
  expect(result.claimResults[0]!.status).toBe('not-run');
  expect(result.claimResults[0]!.reasonCode).toBe('not-dispatched');
});

test('aggregate: all claims passed → overall passed', () => {
  const gate1 = passedGate('gate-1', ['claim-1']);
  const gate2 = passedGate('gate-2', ['claim-2']);
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('claim-1', ['gate-1']), claim('claim-2', ['gate-2'])],
    gateResults: [gate1, gate2]
  });
  expect(result.overallStatus).toBe('passed');
});

test('aggregate: custom coverage check returning false → invalidated', () => {
  const gate = passedGate('gate-1', ['claim-1']);
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('claim-1', ['gate-1'])],
    gateResults: [gate],
    isCoverageComplete: () => false
  });
  expect(result.overallStatus).toBe('invalidated');
  expect(result.claimResults[0]!.status).toBe('invalidated');
  expect(result.claimResults[0]!.reasonCode).toBe('selection-unresolved');
});
