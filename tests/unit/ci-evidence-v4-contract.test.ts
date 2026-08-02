import { expect, test } from 'bun:test';

import {
  CODEX_DEVELOPMENT_VERIFICATION_EVIDENCE_SCHEMA_V4,
  CodexDevelopmentAssertVerificationEvidenceV4,
  CodexDevelopmentFinalizeVerificationEvidenceV4,
  type CodexDevelopmentVerificationEvidenceScopeSourceV4,
  type CodexDevelopmentVerificationEvidenceV4,
  type CodexDevelopmentVerificationEvidenceV4Draft
} from '../../platform/shared/ci-evidence-v4-contract.ts';
import {
  CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1
} from '../../platform/shared/ci-execution-environment.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../platform/shared/ci-verification-revision.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  type VerificationClaimDefinitionV1,
  type VerificationDisposition,
  type VerificationResultStatus
} from '../../platform/shared/verification-result-contract.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const SHA_D = 'd'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;
const DIGEST_B = `sha256:${'2'.repeat(64)}`;
const DIGEST_C = `sha256:${'3'.repeat(64)}`;

function claim(
  claimId = 'claim',
  gateId = 'gate',
  environment = 'linux-x64'
): VerificationClaimDefinitionV1 {
  return { claimId, requiredGateIds: [gateId], owningEnvironments: [environment] };
}

function result(
  status: VerificationResultStatus = 'passed',
  disposition?: VerificationDisposition,
  claimId = 'claim',
  gateId = 'gate'
) {
  const resolvedDisposition = disposition ?? (
    status === 'passed' || status === 'failed' ? 'executed' : 'not-executed'
  );
  const reasons = {
    passed: 'executed-success',
    failed: 'executed-failure',
    'not-run': 'not-dispatched',
    unsupported: 'capability-unsupported',
    invalidated: 'selection-unresolved'
  } as const;
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: 'gate-v1',
    owner: 'ci-verifier',
    requirementKey: claimId,
    subjectRevision: SHA_A,
    inputDigest: DIGEST_A,
    applicability: status === 'invalidated' ? 'unresolved' : 'required',
    status,
    disposition: resolvedDisposition,
    reasonCode: reasons[status],
    requiredForClaims: [claimId],
    supportedClaims: status === 'passed' ? [claimId] : [],
    environment: resolvedDisposition === 'executed' || resolvedDisposition === 'reused'
      ? {
          runtime: 'bun@1.3.14',
          os: 'linux',
          arch: 'x64',
          filesystem: 'ext4',
          capabilities: ['typescript'],
          toolchainRevision: 'ci-verification-v19',
          providerRevisions: []
        }
      : null,
    execution: resolvedDisposition === 'executed'
      ? {
          argv: ['bun', 'test'],
          startedAt: '2026-08-02T00:00:00.000Z',
          finishedAt: '2026-08-02T00:00:01.000Z',
          durationMs: 1000,
          exitCode: status === 'failed' ? 1 : 0,
          outputDigest: DIGEST_B,
          failureFingerprint: status === 'failed' ? 'failure' : null
        }
      : null,
    evidenceRefs: resolvedDisposition === 'reused' ? ['evidence://prior'] : [],
    invalidationRules: [],
    diagnostic: null
  });
}

function sourceFor(
  status: VerificationResultStatus,
  disposition: VerificationDisposition
): CodexDevelopmentVerificationEvidenceScopeSourceV4 {
  if (disposition === 'reused') return 'reused';
  if (disposition === 'executed') return 'executed';
  if (status === 'not-run') return 'not-run';
  if (status === 'unsupported') return 'unsupported';
  return 'invalidated';
}

function draft(
  status: VerificationResultStatus = 'passed',
  disposition?: VerificationDisposition
): CodexDevelopmentVerificationEvidenceV4Draft {
  const gateResult = result(status, disposition);
  const claimDefinition = claim();
  const gates = [{
    id: 'gate',
    argv: gateResult.disposition === 'executed' ? gateResult.execution!.argv : [],
    rawOutput: gateResult.disposition === 'executed' ? 'test-output' : null,
    environmentBinding: gateResult.disposition === 'executed'
      ? {
          allowlistRevision: CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
          digest: DIGEST_C
        }
      : null,
    result: gateResult
  }];
  return {
    schema: CODEX_DEVELOPMENT_VERIFICATION_EVIDENCE_SCHEMA_V4,
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    kind: 'verification',
    profile: 'quick',
    source: 'local',
    identity: {
      headSha: SHA_A,
      treeSha: SHA_B,
      prBaseSha: SHA_C,
      affectedBaseSha: SHA_D,
      manifestPath: 'docs/work-packages/example-v1.md',
      manifestDigest: DIGEST_A,
      inputDigest: DIGEST_B
    },
    startedAt: '2026-08-02T00:00:00.000Z',
    finishedAt: '2026-08-02T00:00:02.000Z',
    durationMs: 2000,
    changedFiles: ['platform/example.ts'],
    selectionResolved: true,
    cleanState: { before: true, after: true },
    failure: status === 'failed' ? { stage: 'gate', tail: 'failed' } : null,
    gates,
    claims: [claimDefinition],
    aggregate: CodexDevelopmentAggregateVerificationClaimsV1({
      claims: [claimDefinition],
      gateResults: [gateResult]
    }),
    scopeLedger: [{
      scopeId: 'scope',
      source: sourceFor(status, gateResult.disposition),
      gateId: 'gate',
      evidenceRef: gateResult.disposition === 'reused' ? 'evidence://prior' : null,
      reasonCode: gateResult.reasonCode
    }],
    invalidation: {
      expiresAt: '2026-08-03T00:00:00.000Z',
      rules: ['head-change']
    }
  };
}

function finalized(
  status: VerificationResultStatus = 'passed',
  disposition?: VerificationDisposition
): CodexDevelopmentVerificationEvidenceV4 {
  return CodexDevelopmentFinalizeVerificationEvidenceV4(draft(status, disposition));
}

function copy(value: CodexDevelopmentVerificationEvidenceV4): CodexDevelopmentVerificationEvidenceV4 {
  return structuredClone(value);
}

function assertAtNoon(value: unknown): void {
  CodexDevelopmentAssertVerificationEvidenceV4(
    value,
    {},
    new Date('2026-08-02T12:00:00.000Z')
  );
}

test('V4 round-trips every canonical status without three-state compression', () => {
  for (const status of ['passed', 'failed', 'not-run', 'unsupported', 'invalidated'] as const) {
    const evidence = finalized(status);
    expect(evidence.gates[0]!.result.status).toBe(status);
    expect(evidence.aggregate.overallStatus).toBe(status);
    assertAtNoon(evidence);
  }
});

test('reused PASS retains original environment and Evidence without fresh transport', () => {
  const evidence = finalized('passed', 'reused');
  expect(evidence.gates[0]!.environmentBinding).toBeNull();
  expect(evidence.gates[0]!.rawOutput).toBeNull();
  expect(evidence.gates[0]!.result.environment).not.toBeNull();
  expect(evidence.scopeLedger[0]).toMatchObject({
    source: 'reused',
    evidenceRef: 'evidence://prior'
  });
});

test('empty claims gates and scopes cannot manufacture a vacuous passed closure', () => {
  const empty: CodexDevelopmentVerificationEvidenceV4Draft = {
    ...draft(),
    gates: [],
    claims: [],
    aggregate: CodexDevelopmentAggregateVerificationClaimsV1({ claims: [], gateResults: [] }),
    scopeLedger: []
  };
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(empty))
    .toThrow(/incomplete or inconsistent proof/);
});

test('claim to gate and gate to claim references must close', () => {
  const unknownGate = draft();
  unknownGate.claims[0]!.requiredGateIds = ['missing'];
  unknownGate.aggregate = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: unknownGate.claims,
    gateResults: unknownGate.gates.map((entry) => entry.result)
  });
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(unknownGate))
    .toThrow(/references unknown gate/);

  const unknownClaim = draft();
  unknownClaim.gates[0]!.result.supportedClaims = ['missing'];
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(unknownClaim))
    .toThrow(/supports unknown claim/);
});

test('scope source reason and gate disposition must agree exactly', () => {
  const contradiction = draft();
  contradiction.scopeLedger[0]!.source = 'reused';
  contradiction.scopeLedger[0]!.evidenceRef = 'evidence://prior';
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(contradiction))
    .toThrow(/contradicts gate/);

  const wrongReason = draft();
  wrongReason.scopeLedger[0]!.reasonCode = 'forged';
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(wrongReason))
    .toThrow(/contradicts gate/);
});

test('every gate has exactly one scope and every scope gate resolves', () => {
  const missing = draft();
  missing.scopeLedger = [];
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(missing))
    .toThrow(/requires exactly one scope entry/);

  const duplicate = draft();
  duplicate.scopeLedger.push({ ...duplicate.scopeLedger[0]!, scopeId: 'scope-z' });
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(duplicate))
    .toThrow(/requires exactly one scope entry/);

  const unknown = draft();
  unknown.scopeLedger[0]!.gateId = 'missing';
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(unknown))
    .toThrow(/references unknown gate/);
});

test('aggregate cannot be forged independently of canonical gates and claims', () => {
  const evidence = copy(finalized());
  evidence.aggregate.overallStatus = 'invalidated';
  expect(() => assertAtNoon(evidence)).toThrow(/aggregate does not match/);
});

test('wrong owning environment remains not-run not passed', () => {
  const value = draft();
  value.claims[0]!.owningEnvironments = ['windows-x64'];
  value.aggregate = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: value.claims,
    gateResults: value.gates.map((entry) => entry.result)
  });
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4(value);
  expect(evidence.aggregate.overallStatus).toBe('not-run');
  expect(evidence.aggregate.overallReasonCode).toBe('current-runner-not-owning-environment');
});

test('passed closure requires clean state resolved selection and complete claims', () => {
  for (const mutate of [
    (value: CodexDevelopmentVerificationEvidenceV4) => { value.selectionResolved = false; },
    (value: CodexDevelopmentVerificationEvidenceV4) => { value.cleanState.after = false; },
    (value: CodexDevelopmentVerificationEvidenceV4) => {
      value.aggregate.claimResults[0]!.coverageComplete = false;
    }
  ]) {
    const evidence = copy(finalized());
    mutate(evidence);
    expect(() => assertAtNoon(evidence)).toThrow();
  }
});

test('not-run delta unsupported and invalidated scopes cannot hide under overall passed', () => {
  for (const source of ['not-run', 'delta', 'unsupported', 'invalidated'] as const) {
    const evidence = copy(finalized());
    evidence.scopeLedger[0] = {
      scopeId: 'scope',
      source,
      gateId: source === 'delta' ? null : 'gate',
      evidenceRef: null,
      reasonCode: source
    };
    expect(() => assertAtNoon(evidence)).toThrow();
  }
});

test('executed and non-executed transport cannot be interchanged', () => {
  const missingOutput = copy(finalized());
  missingOutput.gates[0]!.rawOutput = null;
  expect(() => assertAtNoon(missingOutput)).toThrow(/requires environment binding and raw output/);

  const argvDrift = copy(finalized());
  argvDrift.gates[0]!.argv = ['forged'];
  expect(() => assertAtNoon(argvDrift)).toThrow(/argv must match/);

  const invalidated = copy(finalized('invalidated'));
  invalidated.gates[0]!.rawOutput = 'forged';
  expect(() => assertAtNoon(invalidated)).toThrow(/must not carry execution transport/);
});

test('gate claim and scope ordering is canonical', () => {
  const value = draft();
  const secondClaim = claim('a-claim', 'a-gate');
  const secondResult = result('passed', 'executed', 'a-claim', 'a-gate');
  value.claims.push(secondClaim);
  value.gates.push({
    id: 'a-gate',
    argv: secondResult.execution!.argv,
    rawOutput: 'output',
    environmentBinding: {
      allowlistRevision: CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
      digest: DIGEST_C
    },
    result: secondResult
  });
  value.scopeLedger.push({
    scopeId: 'a-scope',
    source: 'executed',
    gateId: 'a-gate',
    evidenceRef: null,
    reasonCode: 'executed-success'
  });
  value.aggregate = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: value.claims,
    gateResults: value.gates.map((entry) => entry.result)
  });
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(value))
    .toThrow(/canonical lexical order/);
});

test('identity digest expiry timestamps and bounds fail closed', () => {
  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(
    finalized(),
    { headSha: 'f'.repeat(40) },
    new Date('2026-08-02T12:00:00.000Z')
  )).toThrow(/headSha mismatch/);

  const changed = copy(finalized());
  changed.changedFiles = ['changed'];
  expect(() => assertAtNoon(changed)).toThrow(/digest mismatch/);

  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(
    finalized(),
    {},
    new Date('2026-08-04T00:00:00.000Z')
  )).toThrow(/expired/);

  const badDuration = draft();
  badDuration.durationMs = 1999;
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(badDuration))
    .toThrow(/duration does not match/);

  const oversized = draft();
  oversized.gates[0]!.rawOutput = 'x'.repeat(1048577);
  expect(() => CodexDevelopmentFinalizeVerificationEvidenceV4(oversized))
    .toThrow(/bounded valid text/);
});
