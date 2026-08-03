import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertVerificationEvidenceV4,
  CodexDevelopmentFinalizeVerificationEvidenceV4,
  type CodexDevelopmentVerificationEvidenceV4,
  type CodexDevelopmentVerificationEvidenceV4Draft
} from '../../platform/shared/ci-evidence-v4-contract.ts';
import {
  CodexDevelopmentVerificationDigest
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1
} from '../../platform/shared/ci-execution-environment.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../platform/shared/ci-verification-revision.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  CodexDevelopmentVerificationEnvironmentIdentityV1,
  type VerificationGateResultV1
} from '../../platform/shared/verification-result-contract.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASE = '3'.repeat(40);
const INPUT = `sha256:${'4'.repeat(64)}`;
const OUTPUT = `sha256:${'5'.repeat(64)}`;
const ENV_DIGEST = `sha256:${'6'.repeat(64)}`;
const MANIFEST_DIGEST = `sha256:${'7'.repeat(64)}`;
const STARTED = '2026-08-02T00:00:00.000Z';
const FINISHED = '2026-08-02T00:00:01.000Z';
const EXPIRES = '2026-09-01T00:00:00.000Z';

function gate(
  os: string,
  arch: string,
  observationStatus: 'passed' | 'failed' = 'passed',
  overrides: Partial<VerificationGateResultV1> = {}
): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId: 'portable-gate',
    gateRevision: 'portable-gate-v1',
    owner: 'verification-owner',
    requirementKey: 'portable-verification',
    subjectRevision: HEAD,
    inputDigest: INPUT,
    applicability: 'required',
    status: observationStatus,
    disposition: 'executed',
    reasonCode: observationStatus === 'passed' ? 'executed-success' : 'executed-failure',
    requiredForClaims: ['portable-claim'],
    supportedClaims: observationStatus === 'passed' ? ['portable-claim'] : [],
    environment: {
      runtime: 'bun@1.3.14',
      os,
      arch,
      filesystem: os === 'windows' ? 'ntfs' : 'ext4',
      capabilities: ['typescript'],
      toolchainRevision: 'ci-verification-v19',
      providerRevisions: []
    },
    execution: {
      argv: ['bun', 'test'],
      startedAt: STARTED,
      finishedAt: FINISHED,
      durationMs: 1000,
      exitCode: observationStatus === 'passed' ? 0 : 1,
      outputDigest: OUTPUT,
      failureFingerprint: observationStatus === 'passed' ? null : 'failure'
    },
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null,
    ...overrides
  });
}

function baseDraft(): CodexDevelopmentVerificationEvidenceV4Draft {
  const gates = [
    {
      observationId: 'observation-linux',
      argv: ['bun', 'test'],
      rawOutput: 'linux output',
      environmentBinding: {
        allowlistRevision: CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
        digest: ENV_DIGEST
      },
      result: gate('linux', 'x64')
    },
    {
      observationId: 'observation-windows',
      argv: ['bun', 'test'],
      rawOutput: 'windows output',
      environmentBinding: {
        allowlistRevision: CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
        digest: ENV_DIGEST
      },
      result: gate('windows', 'x64')
    }
  ];
  const claims = [{
    claimId: 'portable-claim',
    requiredGateIds: ['portable-gate'],
    owningEnvironments: [
      CodexDevelopmentVerificationEnvironmentIdentityV1('linux', 'x64'),
      CodexDevelopmentVerificationEnvironmentIdentityV1('windows', 'x64')
    ].sort()
  }];
  return {
    schema: 'codex-development-verification-evidence-v4',
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    kind: 'verification',
    profile: 'quick',
    source: 'local',
    identity: {
      headSha: HEAD,
      treeSha: TREE,
      prBaseSha: BASE,
      affectedBaseSha: BASE,
      manifestPath: 'docs/work-packages/example.md',
      manifestDigest: MANIFEST_DIGEST,
      inputDigest: INPUT
    },
    startedAt: STARTED,
    finishedAt: FINISHED,
    durationMs: 1000,
    changedFiles: ['platform/shared/example.ts'],
    selectionResolved: true,
    cleanState: { before: true, after: true },
    failure: null,
    gates,
    claims,
    aggregate: CodexDevelopmentAggregateVerificationClaimsV1({
      claims,
      gateResults: gates.map((entry) => entry.result)
    }),
    scopeLedger: [
      {
        scopeId: 'scope-linux',
        source: 'executed',
        observationId: 'observation-linux',
        evidenceRef: null,
        reasonCode: 'executed-success'
      },
      {
        scopeId: 'scope-windows',
        source: 'executed',
        observationId: 'observation-windows',
        evidenceRef: null,
        reasonCode: 'executed-success'
      }
    ],
    invalidation: {
      expiresAt: EXPIRES,
      rules: ['candidate-identity-change', 'environment-change']
    }
  };
}

function draftOf(
  evidence: CodexDevelopmentVerificationEvidenceV4
): CodexDevelopmentVerificationEvidenceV4Draft {
  const { evidenceDigest: _digest, ...draft } = structuredClone(evidence);
  return draft;
}

function expectRejected(
  evidence: CodexDevelopmentVerificationEvidenceV4,
  mutate: (draft: CodexDevelopmentVerificationEvidenceV4Draft) => void,
  pattern: RegExp
): void {
  expect(() => {
    const draft = draftOf(evidence);
    mutate(draft);
    CodexDevelopmentFinalizeVerificationEvidenceV4(draft);
  }).toThrow(pattern);
}

test('V4 preserves multiple physical observations for one logical gate', () => {
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4(baseDraft());
  expect(evidence.aggregate.overallStatus).toBe('passed');
  expect(evidence.gates.map((entry) => entry.result.gateId))
    .toEqual(['portable-gate', 'portable-gate']);
  expect(evidence.gates.map((entry) => entry.observationId))
    .toEqual(['observation-linux', 'observation-windows']);
  expect(evidence.evidenceDigest).toBe(CodexDevelopmentVerificationDigest(draftOf(evidence)));
});

test('observation identity, scope and claim closures fail closed', () => {
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4(baseDraft());

  expectRejected(evidence, (draft) => {
    draft.gates[1]!.observationId = draft.gates[0]!.observationId;
  }, /observation IDs must be unique/);

  expectRejected(evidence, (draft) => {
    draft.scopeLedger[0]!.observationId = 'missing-observation';
  }, /references unknown observation/);

  expectRejected(evidence, (draft) => {
    draft.scopeLedger.pop();
  }, /requires exactly one scope entry/);

  expectRejected(evidence, (draft) => {
    draft.claims[0]!.requiredGateIds = ['missing-gate'];
  }, /references unknown gate/);
});

test('mixed logical proof identities cannot be hidden behind observation IDs', () => {
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4(baseDraft());
  expectRejected(evidence, (draft) => {
    draft.gates[1]!.result.subjectRevision = '8'.repeat(40);
    draft.aggregate = CodexDevelopmentAggregateVerificationClaimsV1({
      claims: draft.claims,
      gateResults: draft.gates.map((entry) => entry.result)
    });
  }, /mixes proof identities/);
});

test('scope source must agree with physical observation truth', () => {
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4(baseDraft());

  expectRejected(evidence, (draft) => {
    draft.scopeLedger[0]!.source = 'reused';
    draft.scopeLedger[0]!.evidenceRef = 'evidence-linux';
  }, /contradicts observation/);

  expectRejected(evidence, (draft) => {
    draft.scopeLedger[0]!.reasonCode = 'selection-unresolved';
  }, /contradicts observation/);
});

test('passed evidence cannot contain delta, unresolved selection or dirty state', () => {
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4(baseDraft());

  expectRejected(evidence, (draft) => {
    draft.scopeLedger = [
      {
        scopeId: 'scope-delta',
        source: 'delta',
        observationId: null,
        evidenceRef: null,
        reasonCode: 'input-invalidated'
      },
      ...draft.scopeLedger
    ];
  }, /incomplete or inconsistent proof/);

  expectRejected(evidence, (draft) => {
    draft.selectionResolved = false;
  }, /incomplete or inconsistent proof/);

  expectRejected(evidence, (draft) => {
    draft.cleanState.after = false;
  }, /incomplete or inconsistent proof/);
});

test('timestamps, expiry, expected identity and digest are independently checked', () => {
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4(baseDraft());

  expectRejected(evidence, (draft) => {
    draft.durationMs = 999;
  }, /duration does not match timestamps/);

  expectRejected(evidence, (draft) => {
    draft.invalidation.expiresAt = STARTED;
  }, /expired/);

  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(evidence, {
    headSha: '9'.repeat(40)
  }, new Date(STARTED))).toThrow(/headSha mismatch/);

  const digestDrift = structuredClone(evidence);
  digestDrift.evidenceDigest = `sha256:${'0'.repeat(64)}`;
  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(
    digestDrift,
    {},
    new Date(STARTED)
  )).toThrow(/digest mismatch/);
});
