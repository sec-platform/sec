import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertVerificationEvidenceV3,
  CodexDevelopmentFinalizeVerificationEvidenceV3,
  CodexDevelopmentVerificationDigest,
  type CodexDevelopmentVerificationEvidenceV3,
  type CodexDevelopmentVerificationGateEvidenceV3
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentBuildEvidenceCompositionPlanV1,
  CodexDevelopmentSyntheticEvidenceCompositionPolicyV1,
  CodexDevelopmentSyntheticEvidencePolicyIdV1,
  CodexDevelopmentSyntheticReusableEvidenceSourceV1,
  CodexDevelopmentSyntheticVerificationInventoryV1
} from '../../platform/shared/ci-evidence-reuse-contract.ts';
import { CodexDevelopmentBuildVerificationInputV3 } from '../../platform/shared/ci-verification-plan.ts';

const HEAD = '3'.repeat(40);
const TREE = '4'.repeat(40);
const BASE = '5'.repeat(40);
const MANIFEST_DIGEST = `sha256:${'6'.repeat(64)}`;

function composition() {
  const policy = CodexDevelopmentSyntheticEvidenceCompositionPolicyV1();
  return CodexDevelopmentBuildEvidenceCompositionPlanV1({
    policyId: CodexDevelopmentSyntheticEvidencePolicyIdV1,
    workPackageId: 'ci-v7-evidence-composition-bootstrap-v1',
    ciRevision: 'ci-verification-v7',
    profile: 'quick',
    inventory: CodexDevelopmentSyntheticVerificationInventoryV1(),
    runtime: 'bun@1.3.6',
    currentHead: HEAD,
    currentTree: TREE,
    executionEnvironment: { PATH: 'C:\\fixture-bin' },
    resolvePolicy: () => policy,
    readEvidence: () => ({
      blobSha: policy.reusedEvidence[0]!.evidenceBlobSha,
      mode: policy.reusedEvidence[0]!.evidenceMode,
      type: policy.reusedEvidence[0]!.evidenceType,
      bytes: new TextEncoder().encode(CodexDevelopmentSyntheticReusableEvidenceSourceV1)
    }),
    gitTree: (ref) => ref === HEAD ? TREE : '2'.repeat(40),
    gitBlob: (ref, file) => {
      for (const blob of policy.reusedEvidence[0]!.gitBlobs) {
        if (ref === HEAD && blob.currentPath === file) {
          return { blobSha: blob.currentBlobSha, mode: blob.currentMode, type: blob.currentType };
        }
        if (ref === '1'.repeat(40) && blob.testedPath === file) {
          return { blobSha: blob.testedBlobSha, mode: blob.testedMode, type: blob.testedType };
        }
      }
      return null;
    }
  });
}

function passedGate(
  gate: ReturnType<typeof composition>['gates'][number],
  index: number
): CodexDevelopmentVerificationGateEvidenceV3 {
  return {
    id: gate.gateId,
    runtime: gate.runtime,
    argv: [...gate.argv],
    envAllowlistRevision: gate.envAllowlistRevision,
    envDigest: gate.envDigest,
    disposition: gate.disposition,
    coveredScopeIds: [...gate.coveredScopeIds].sort(),
    status: 'passed',
    exitCode: 0,
    startedAt: `2026-07-18T00:00:00.00${index}Z`,
    finishedAt: `2026-07-18T00:00:00.01${index}Z`,
    durationMs: 10,
    failureTail: null,
    rawOutputDigest: `sha256:${String(index).repeat(64)}`,
    notRunReason: null
  };
}

function evidence(): CodexDevelopmentVerificationEvidenceV3 {
  const plan = composition();
  return CodexDevelopmentFinalizeVerificationEvidenceV3({
    contractRevision: 'ci-verification-v7',
    kind: 'verification',
    profile: 'quick',
    policyId: plan.policyId,
    workPackageId: 'ci-v7-evidence-composition-bootstrap-v1',
    headSha: HEAD,
    treeSha: TREE,
    prBaseSha: BASE,
    affectedBaseSha: BASE,
    manifestPath: 'docs/work-packages/ci-v7-evidence-composition-bootstrap-v1.md',
    manifestDigest: MANIFEST_DIGEST,
    inputDigest: CodexDevelopmentVerificationDigest(CodexDevelopmentBuildVerificationInputV3({
      headSha: HEAD,
      treeSha: TREE,
      prBaseSha: BASE,
      affectedBaseSha: BASE,
      manifestPath: 'docs/work-packages/ci-v7-evidence-composition-bootstrap-v1.md',
      manifestDigest: MANIFEST_DIGEST,
      workPackageId: 'ci-v7-evidence-composition-bootstrap-v1',
      plan
    })),
    argv: ['bun', 'scripts/ci-verification.ts', '--profile', 'quick', '--expected-head', HEAD],
    status: 'passed',
    startedAt: '2026-07-18T00:00:00.000Z',
    finishedAt: '2026-07-18T00:00:01.000Z',
    durationMs: 1_000,
    fullChangedFiles: [...plan.fullChangedFiles],
    fullChangedInputDigest: plan.fullChangedInputDigest,
    fullSelectionDigest: plan.fullSelectionDigest,
    refinedSelectionDigest: plan.refinedSelectionDigest,
    cleanState: { before: true, after: true },
    failure: null,
    gates: plan.gates.map(passedGate),
    coverageLedger: plan.coverageLedger.map((entry) => ({ ...entry })),
    reusedEvidence: plan.reusedEvidence.map((entry) => ({ ...entry })),
    uncoveredScopes: [],
    invalidation: {
      expiresAt: '2026-10-16T00:00:00.000Z',
      rules: ['exact policy, selector, evidence, Git blobs, runtime, argv, env, head, tree, or base changes']
    }
  });
}

function refinalize(
  original: CodexDevelopmentVerificationEvidenceV3,
  patch: Partial<Omit<CodexDevelopmentVerificationEvidenceV3, 'schema' | 'evidenceDigest'>>
): CodexDevelopmentVerificationEvidenceV3 {
  const { schema: _schema, evidenceDigest: _digest, ...draft } = original;
  return CodexDevelopmentFinalizeVerificationEvidenceV3({ ...draft, ...patch });
}

test('Evidence V3 records complete selection, exact coverage ledger, reuse, and executable delta', () => {
  const value = evidence();
  const plan = composition();
  expect(() => CodexDevelopmentAssertVerificationEvidenceV3(
    value,
    {
      profile: 'quick',
      policyId: CodexDevelopmentSyntheticEvidencePolicyIdV1,
      workPackageId: 'ci-v7-evidence-composition-bootstrap-v1',
      headSha: HEAD,
      treeSha: TREE,
      prBaseSha: BASE,
      affectedBaseSha: BASE,
      manifestDigest: MANIFEST_DIGEST,
      plan
    },
    new Date('2026-07-18T00:00:00.000Z')
  )).not.toThrow();
  expect(value.schema).toBe('codex-development-verification-evidence-v3');
  expect(value.fullChangedFiles).toHaveLength(2);
  expect(value.coverageLedger.map((entry) => entry.disposition)).toEqual([
    'executed', 'executed', 'reused', 'delta'
  ]);
  expect(value.gates).toHaveLength(2);
  expect(value.reusedEvidence).toHaveLength(1);
  expect(value.uncoveredScopes).toEqual([]);
});

test('Evidence V3 PASS rejects uncovered, not-run delta, missing coverage, or env drift', () => {
  const original = evidence();
  const plan = composition();
  const delta = original.gates.find((gate) => gate.disposition === 'delta')!;
  const notRunDelta: CodexDevelopmentVerificationGateEvidenceV3 = {
    ...delta,
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'sentinel was not reached'
  };
  for (const changed of [
    refinalize(original, { uncoveredScopes: ['test-title:uncovered'] }),
    refinalize(original, { gates: original.gates.map((gate) => gate.id === delta.id ? notRunDelta : gate) }),
    refinalize(original, { coverageLedger: original.coverageLedger.slice(0, -1) }),
    refinalize(original, {
      gates: original.gates.map((gate) => gate.id === delta.id
        ? { ...gate, envDigest: `sha256:${'f'.repeat(64)}` }
        : gate)
    })
  ]) {
    expect(() => CodexDevelopmentAssertVerificationEvidenceV3(
      changed,
      { plan },
      new Date('2026-07-18T00:00:00.000Z')
    )).toThrow();
  }
});

test('Evidence V3 rejects gate disposition drift, duplicate reuse, and incomplete exact identity', () => {
  const original = evidence();
  const plan = composition();
  const firstGate = original.gates[0]!;
  const cases = [
    refinalize(original, {
      gates: original.gates.map((gate) => gate.id === firstGate.id
        ? { ...gate, disposition: gate.disposition === 'executed' ? 'delta' : 'executed' }
        : gate)
    }),
    refinalize(original, { reusedEvidence: [...original.reusedEvidence, original.reusedEvidence[0]!] }),
    refinalize(original, { headSha: null })
  ];
  for (const changed of cases) {
    expect(() => CodexDevelopmentAssertVerificationEvidenceV3(
      changed,
      { plan },
      new Date('2026-07-18T00:00:00.000Z')
    )).toThrow();
  }
});
