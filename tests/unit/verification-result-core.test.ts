import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentAssertVerificationAggregateResultV1,
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
  type VerificationGateResultV1,
  type VerificationResultStatus
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
  const fastGate = notRunGate('fast-gate', [], 'not-applicable');
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
  const linuxGate = passedGate('linux-gate', [], environment('linux', 'x64', ['typescript']));
  const windowsGate = notRunGate('windows-gate', ['windows-claim'], 'current-runner-not-owning-environment');
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('windows-claim', ['windows-gate'], ['windows-x64'])],
    gateResults: [linuxGate, windowsGate]
  });
  expect(result.overallStatus).toBe('not-run');
  expect(result.claimResults[0]!.status).toBe('not-run');
  expect(result.claimResults[0]!.reasonCode).toBe('current-runner-not-owning-environment');
});

test('Issue #215 deferred: a non-empty wrong-OS owner is not matched in this slice', () => {
  const gate = passedGate(
    'linux-gate',
    ['windows-owned-claim'],
    environment('linux', 'x64', ['typescript'])
  );
  const result = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [claim('windows-owned-claim', ['linux-gate'], ['windows-x64'])],
    gateResults: [gate]
  });
  expect(result.overallStatus).toBe('passed');
  expect(result.claimResults[0]!.status).toBe('passed');
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

test('Issue #215 deferred: reused passed gate with null environment remains accepted', () => {
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

function gateForStatus(
  status: VerificationResultStatus,
  gateId: string,
  claimId: string
): VerificationGateResultV1 {
  switch (status) {
    case 'passed':
      return passedGate(gateId, [claimId]);
    case 'failed':
      return failedGate(gateId, [claimId]);
    case 'not-run':
      return notRunGate(gateId, [claimId], 'not-dispatched');
    case 'unsupported':
      return unsupportedGate(gateId, [claimId], 'capability-unsupported');
    case 'invalidated':
      return invalidatedGate(gateId, [claimId], 'selection-unresolved');
  }
}

test('aggregate assertion accepts the current writer projection across the status cross-product', () => {
  const statuses: VerificationResultStatus[] = [
    'passed', 'failed', 'not-run', 'unsupported', 'invalidated'
  ];
  for (const firstStatus of statuses) {
    for (const secondStatus of statuses) {
      const gates = [
        gateForStatus(firstStatus, 'gate-first', 'claim-first'),
        gateForStatus(secondStatus, 'gate-second', 'claim-second')
      ];
      const input = {
        claims: [
          claim('claim-first', ['gate-first']),
          claim('claim-second', ['gate-second'])
        ],
        gateResults: gates
      };
      const result = CodexDevelopmentAggregateVerificationClaimsV1(input);
      expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(result, input)).not.toThrow();
    }
  }

  const emptyInput = {
    claims: [],
    gateResults: []
  };
  const emptyResult = CodexDevelopmentAggregateVerificationClaimsV1(emptyInput);
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    emptyResult,
    emptyInput
  )).not.toThrow();

  const missingGateInput = {
    claims: [claim('claim-missing', ['missing-gate'])],
    gateResults: []
  };
  const missingGateResult = CodexDevelopmentAggregateVerificationClaimsV1(missingGateInput);
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    missingGateResult,
    missingGateInput
  )).not.toThrow();

  const presentGate = passedGate('coverage-gate', ['coverage-claim']);
  const incompleteCoverageInput = {
    claims: [claim('coverage-claim', ['coverage-gate'])],
    gateResults: [presentGate],
    isCoverageComplete: () => false
  };
  const incompleteCoverageResult = CodexDevelopmentAggregateVerificationClaimsV1(
    incompleteCoverageInput
  );
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    incompleteCoverageResult,
    incompleteCoverageInput
  )).not.toThrow();

  const failedSupportingGate = failedGate('failed-supporting-gate', ['failed-claim']);
  failedSupportingGate.supportedClaims = ['failed-claim'];
  const failedSupportingInput = {
    claims: [claim('failed-claim', ['failed-supporting-gate'])],
    gateResults: [failedSupportingGate]
  };
  const failedSupportingResult = CodexDevelopmentAggregateVerificationClaimsV1(
    failedSupportingInput
  );
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    failedSupportingResult,
    failedSupportingInput
  )).not.toThrow();
});

test('aggregate assertion rejects claim-plan omission even when the forged projection is internally canonical', () => {
  const passedClaim = claim('selected-passed-claim', ['selected-passed-gate']);
  const failedClaim = claim('selected-failed-claim', ['selected-failed-gate']);
  const passed = passedGate('selected-passed-gate', ['selected-passed-claim']);
  const failed = failedGate('selected-failed-gate', ['selected-failed-claim']);
  const trustedClaims = [passedClaim, failedClaim];

  const omittedNonPassedClaim = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [passedClaim],
    gateResults: [passed, failed]
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    omittedNonPassedClaim,
    { claims: trustedClaims, gateResults: [passed, failed] }
  )).toThrow(/does not exactly match the canonical aggregate writer output/);

  const omittedClaimAndGate = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [passedClaim],
    gateResults: [passed]
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    omittedClaimAndGate,
    { claims: trustedClaims, gateResults: [passed] }
  )).toThrow(/does not exactly match the canonical aggregate writer output/);

  const forgedEmptyGreen = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [],
    gateResults: []
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    forgedEmptyGreen,
    { claims: trustedClaims, gateResults: [] }
  )).toThrow(/does not exactly match the canonical aggregate writer output/);
});

test('aggregate assertion rejects overall passed paired with every non-passed claim status', () => {
  const statuses: Array<Exclude<VerificationResultStatus, 'passed'>> = [
    'failed', 'invalidated', 'unsupported', 'not-run'
  ];
  for (const status of statuses) {
    const gate = gateForStatus(status, `gate-${status}`, `claim-${status}`);
    const input = {
      claims: [claim(`claim-${status}`, [`gate-${status}`])],
      gateResults: [gate]
    };
    const result = CodexDevelopmentAggregateVerificationClaimsV1(input);
    result.overallStatus = 'passed';
    result.overallReasonCode = 'executed-success';
    expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(result, input)).toThrow(
      /does not exactly match the canonical aggregate writer output/
    );
  }
});

test('aggregate assertion rejects invalid reasons for every status at claim and overall levels', () => {
  const cases = [
    ['passed', 'executed-failure'],
    ['failed', 'executed-success'],
    ['not-run', 'capability-unsupported'],
    ['unsupported', 'selection-unresolved'],
    ['invalidated', 'not-dispatched']
  ] as const;

  for (const [status, invalidReason] of cases) {
    const gate = gateForStatus(status, `reason-gate-${status}`, `reason-claim-${status}`);
    const input = {
      claims: [claim(`reason-claim-${status}`, [`reason-gate-${status}`])],
      gateResults: [gate]
    };
    const current = CodexDevelopmentAggregateVerificationClaimsV1(input);

    const invalidClaimReason = structuredClone(current);
    invalidClaimReason.claimResults[0]!.reasonCode = invalidReason;
    expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
      invalidClaimReason,
      input
    )).toThrow();

    const invalidOverallReason = structuredClone(current);
    invalidOverallReason.overallReasonCode = invalidReason;
    expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
      invalidOverallReason,
      input
    )).toThrow();
  }
});

test('aggregate assertion rejects a valid same-status but wrong decisive overall reason', () => {
  const gate = failedGate('decisive-gate', ['decisive-claim'], 'cleanup-failed');
  const input = {
    claims: [claim('decisive-claim', ['decisive-gate'])],
    gateResults: [gate]
  };
  const result = CodexDevelopmentAggregateVerificationClaimsV1(input);
  expect(result).toMatchObject({
    overallStatus: 'failed',
    overallReasonCode: 'executed-failure'
  });
  result.overallReasonCode = 'timeout';
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(result, input)).toThrow(
    /does not exactly match the canonical aggregate writer output/
  );
});
