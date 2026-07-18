import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentBuildEvidenceCompositionPlanV1,
  CodexDevelopmentEvidenceCompositionRawDigestV1,
  CodexDevelopmentSyntheticEvidenceCompositionPolicyV1,
  CodexDevelopmentSyntheticEvidencePolicyIdV1,
  CodexDevelopmentSyntheticReusableEvidenceSourceV1,
  CodexDevelopmentSyntheticVerificationInventoryV1,
  CodexDevelopmentVerificationScopeV1,
  CodexDevelopmentVerificationSelectionDigestV1,
  type CodexDevelopmentEvidenceCompositionPolicyV1
} from '../../platform/shared/ci-evidence-reuse-contract.ts';

const WORK_PACKAGE_ID = 'ci-v7-evidence-composition-bootstrap-v1';
const RUNTIME = 'bun@1.3.6';
const CURRENT_HEAD = '3'.repeat(40);
const CURRENT_TREE = '4'.repeat(40);

function policy(): CodexDevelopmentEvidenceCompositionPolicyV1 {
  return CodexDevelopmentSyntheticEvidenceCompositionPolicyV1();
}

function gitBlob(ref: string, file: string) {
  for (const blob of policy().reusedEvidence[0]!.gitBlobs) {
    if (ref === CURRENT_HEAD && blob.currentPath === file) {
      return { blobSha: blob.currentBlobSha, mode: blob.currentMode, type: blob.currentType };
    }
    if (ref === '1'.repeat(40) && blob.testedPath === file) {
      return { blobSha: blob.testedBlobSha, mode: blob.testedMode, type: blob.testedType };
    }
  }
  return null;
}

function build(overrides: Partial<Parameters<typeof CodexDevelopmentBuildEvidenceCompositionPlanV1>[0]> = {}) {
  return CodexDevelopmentBuildEvidenceCompositionPlanV1({
    policyId: CodexDevelopmentSyntheticEvidencePolicyIdV1,
    workPackageId: WORK_PACKAGE_ID,
    ciRevision: 'ci-verification-v7',
    profile: 'quick',
    inventory: CodexDevelopmentSyntheticVerificationInventoryV1(),
    runtime: RUNTIME,
    currentHead: CURRENT_HEAD,
    currentTree: CURRENT_TREE,
    executionEnvironment: { PATH: 'C:\\fixture-bin' },
    gitBlob,
    readEvidence: () => ({
      blobSha: policy().reusedEvidence[0]!.evidenceBlobSha,
      mode: policy().reusedEvidence[0]!.evidenceMode,
      type: policy().reusedEvidence[0]!.evidenceType,
      bytes: new TextEncoder().encode(CodexDevelopmentSyntheticReusableEvidenceSourceV1)
    }),
    gitTree: (ref) => ref === '1'.repeat(40)
      ? '2'.repeat(40)
      : ref === CURRENT_HEAD ? CURRENT_TREE : null,
    resolvePolicy: () => policy(),
    ...overrides
  });
}

test('registered synthetic policy partitions every original title scope before execution', () => {
  const plan = build();

  expect(plan.uncoveredScopes).toEqual([]);
  expect(plan.coverageLedger.map((entry) => entry.disposition)).toEqual([
    'executed',
    'executed',
    'reused',
    'delta'
  ]);
  expect(plan.coverageLedger.at(-1)).toMatchObject({
    disposition: 'delta',
    evidenceIdentity: 'synthetic-reused-pass-v1',
    gateId: 'synthetic-delta'
  });
  expect(plan.gates.map((gate) => gate.disposition)).toEqual(['executed', 'delta']);
  expect(plan.gates[0]?.coveredScopeIds).toHaveLength(2);
  expect(plan.gates.flatMap((gate) => gate.argv)).not.toContain('synthetic-reused');
  expect(plan.reusedEvidence).toHaveLength(1);
  expect(plan.reusedEvidence[0]).toMatchObject({
    policyId: CodexDevelopmentSyntheticEvidencePolicyIdV1,
    evidenceIdentity: 'synthetic-reused-pass-v1',
    evidencePath: 'tests/fixtures/ci-evidence-reuse/synthetic-pass.json',
    evidenceDigest: policy().reusedEvidence[0]!.evidenceDigest,
    evidenceBlobSha: policy().reusedEvidence[0]!.evidenceBlobSha,
    evidenceMode: '100644',
    evidenceType: 'blob',
    environmentBinding: 'legacy-unbound-v1',
    scopeBinding: 'base-policy-exact-v1',
    expandable: false,
    testedHead: '1'.repeat(40),
    testedTree: '2'.repeat(40)
  });
});

test('synthetic immutable PASS fixture binds its exact pretty raw bytes', () => {
  const source = readFileSync('tests/fixtures/ci-evidence-reuse/synthetic-pass.json', 'utf8');
  expect(source).toBe(CodexDevelopmentSyntheticReusableEvidenceSourceV1);
  expect(CodexDevelopmentEvidenceCompositionRawDigestV1(source)).toBe(
    policy().reusedEvidence[0]!.evidenceDigest
  );
  expect(() => build()).not.toThrow();
});

test('new, missing, duplicate, unordered, and drifted selector scopes fail closed', () => {
  const original = CodexDevelopmentSyntheticVerificationInventoryV1();
  const scope = original.scopes[0]!;
  for (const scopes of [
    original.scopes.slice(1).map((entry, order) => ({ ...entry, order })),
    [...original.scopes, { ...scope, order: original.scopes.length }],
    [...original.scopes, { ...scope, order: original.scopes.length, scopeId: 'fast-test:new-selector-scope' }],
    [...original.scopes].reverse(),
    original.scopes.map((entry, index) => index === 0
      ? { ...entry, inventoryDigest: `sha256:${'0'.repeat(64)}` }
      : entry)
  ]) {
    const inventory = {
      ...original,
      scopes,
      fullSelectionDigest: CodexDevelopmentVerificationSelectionDigestV1('quick', original.fullChangedFiles, scopes)
    };
    expect(() => build({ inventory })).toThrow();
  }
});

test('unknown or cross-Work-Package policy and profile/revision drift fail closed', () => {
  expect(() => build({
    policyId: 'pr-added-policy',
    resolvePolicy: (policyId) => {
      throw new Error(`Unknown base-registered evidence composition policy: ${policyId}.`);
    }
  })).toThrow('Unknown base-registered');
  expect(() => build({ workPackageId: 'other-work-package' })).toThrow('different Work Package');
  expect(() => build({ profile: 'full' })).toThrow('supports Quick only');
  expect(() => build({ ciRevision: 'ci-verification-v8' })).toThrow('CI revision mismatch');
});

test('immutable evidence digest, identity, runtime, argv, tree, and blob drift fail closed', () => {
  for (const source of [
    `${CodexDevelopmentSyntheticReusableEvidenceSourceV1} `,
    CodexDevelopmentSyntheticReusableEvidenceSourceV1.replace('"status": "PASS"', '"status": "FAIL"'),
    CodexDevelopmentSyntheticReusableEvidenceSourceV1.replace('"schemaVersion": "1"', '"schemaVersion": "2"')
  ]) {
    expect(() => build({
      readEvidence: () => ({
        blobSha: '0'.repeat(40),
        mode: '100644',
        type: 'blob',
        bytes: new TextEncoder().encode(source)
      })
    })).toThrow();
  }
  expect(() => build({
    gitTree: (ref) => ref === CURRENT_HEAD ? CURRENT_TREE : '9'.repeat(40)
  })).toThrow('tested tree mismatch');
  expect(() => build({
    gitBlob: () => ({ blobSha: '9'.repeat(40), mode: '100644', type: 'blob' })
  })).toThrow('refinement Git blob is not exact at current head');

  for (const mutate of [
    (value: CodexDevelopmentEvidenceCompositionPolicyV1) => { value.reusedEvidence[0]!.runtime = 'bun@9.9.9'; },
    (value: CodexDevelopmentEvidenceCompositionPolicyV1) => { value.reusedEvidence[0]!.argv = ['bun', 'test', 'other.test.ts']; },
    (value: CodexDevelopmentEvidenceCompositionPolicyV1) => { value.reusedEvidence[0]!.inventory[0]!.gitBlobIds = []; }
  ]) {
    const changed = policy();
    mutate(changed);
    expect(() => build({ resolvePolicy: () => changed })).toThrow();
  }
});

test('delta accepts reviewed tested/current relocation only when the same baseline and gate close it', () => {
  const plan = build();
  const delta = plan.coverageLedger.find((entry) => entry.disposition === 'delta');
  expect(delta?.evidenceIdentity).toBe('synthetic-reused-pass-v1');
  expect(delta?.gateId).toBe('synthetic-delta');
  expect(plan.gates.find((gate) => gate.gateId === 'synthetic-delta')?.env).toEqual({
    SEC_RUN_SYNTHETIC_SENTINEL: '1'
  });
  expect(plan.gates.find((gate) => gate.gateId === 'synthetic-delta')?.envDigest).toMatch(/^sha256:/u);

  const changed = policy();
  const assignment = changed.assignments.find((entry) => entry.disposition === 'delta')!;
  assignment.gateId = null;
  expect(() => build({ resolvePolicy: () => changed })).toThrow('both baseline evidence and one delta gate');
});

test('one delta sibling cannot close a changed blob still referenced by a reused scope', () => {
  const changed = policy();
  const binding = changed.reusedEvidence[0]!;
  binding.gitBlobs.find((blob) => blob.id === 'synthetic-common-input')!.testedPath =
    'tests/fixtures/ci-evidence-reuse/synthetic-common-historical.txt';

  expect(() => build({ resolvePolicy: () => changed })).toThrow(
    'Every scope referencing changed Git blob synthetic-common-input must be closed by a delta gate'
  );
});

test('current runtime mismatch fails the complete plan before executable gates are returned', () => {
  expect(() => build({ runtime: 'bun@9.9.9' })).toThrow('runtime');
});

test('policy refinements cannot replace a canonical non-refinable parent', () => {
  const inventory = CodexDevelopmentSyntheticVerificationInventoryV1();
  inventory.scopes[0] = { ...inventory.scopes[0]!, refinement: 'forbidden' };
  inventory.fullSelectionDigest = CodexDevelopmentVerificationSelectionDigestV1(
    inventory.profile,
    inventory.fullChangedFiles,
    inventory.scopes,
    inventory.fullChangedInputDigest
  );
  const changed = policy();
  changed.parentSelectionDigest = inventory.fullSelectionDigest;

  expect(() => build({ inventory, resolvePolicy: () => changed })).toThrow(
    'cannot refine canonical scope'
  );
});

test('policy refinement blob closure is additive and every extra blob is exact at current head', () => {
  const missingParentBlob = policy();
  missingParentBlob.refinements[0]!.scopes = missingParentBlob.refinements[0]!.scopes.map((scope) => ({
    ...scope,
    requiredGitBlobs: []
  }));
  expect(() => build({ resolvePolicy: () => missingParentBlob })).toThrow(
    'omits or changes parent Git blobs'
  );

  const extra = {
    path: 'tests/fixtures/ci-evidence-reuse/synthetic-extra.txt',
    blobSha: '5'.repeat(40),
    mode: '100644' as const,
    type: 'blob' as const
  };
  const policyWithExtra = policy();
  const original = policyWithExtra.refinements[0]!.scopes[0]!;
  const scopeWithExtra = CodexDevelopmentVerificationScopeV1(
    original.scopeId,
    original.runtime,
    original.argv,
    { fixture: 'reviewed-exact-current-head-extra' },
    [...original.requiredGitBlobs, extra],
    original.order,
    original.env,
    original.refinement
  );
  policyWithExtra.refinements[0]!.scopes[0] = scopeWithExtra;
  policyWithExtra.assignments.find((entry) => entry.scopeId === scopeWithExtra.scopeId)!.inventoryDigest =
    scopeWithExtra.inventoryDigest;
  const refinedScopes = policyWithExtra.refinements.flatMap((refinement) => refinement.scopes);
  policyWithExtra.fullSelectionDigest = CodexDevelopmentVerificationSelectionDigestV1(
    'quick',
    CodexDevelopmentSyntheticVerificationInventoryV1().fullChangedFiles,
    refinedScopes
  );

  expect(() => build({ resolvePolicy: () => policyWithExtra })).toThrow(
    'refinement Git blob is not exact at current head'
  );
  expect(() => build({
    resolvePolicy: () => policyWithExtra,
    gitBlob: (ref, file) => ref === CURRENT_HEAD && file === extra.path
      ? { blobSha: extra.blobSha, mode: extra.mode, type: extra.type }
      : gitBlob(ref, file)
  })).not.toThrow();
});

test('policy gates cannot reorder or non-contiguously cover refined selector scopes', () => {
  const reordered = policy();
  reordered.gates = [
    { ...reordered.gates[1]!, order: 0 },
    { ...reordered.gates[0]!, order: 1 }
  ];
  expect(() => build({ resolvePolicy: () => reordered })).toThrow('canonical selector order');

  const nonContiguous = policy();
  const executedScope = nonContiguous.assignments[2]!;
  executedScope.disposition = 'executed';
  executedScope.evidenceIdentity = null;
  executedScope.gateId = 'synthetic-focused';
  nonContiguous.assignments[1]!.gateId = 'synthetic-gap';
  nonContiguous.gates = [
    { ...nonContiguous.gates[0]!, coveredScopeIds: [
      nonContiguous.assignments[0]!.scopeId,
      executedScope.scopeId
    ] },
    {
      ...nonContiguous.gates[0]!,
      order: 1,
      gateId: 'synthetic-gap',
      coveredScopeIds: [nonContiguous.assignments[1]!.scopeId]
    },
    { ...nonContiguous.gates[1]!, order: 2 }
  ];
  nonContiguous.reusedEvidence[0]!.inventory = nonContiguous.reusedEvidence[0]!.inventory.slice(1);

  expect(() => build({ resolvePolicy: () => nonContiguous })).toThrow('not one contiguous selector block');
});
