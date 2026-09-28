import { expect, test } from 'bun:test';

import {
  assertVerificationSpecificationBinding,
  createProofObligation,
  createVerificationClaim,
  createVerificationMethodSelection,
  createVerificationSpecificationBinding
} from '../../src/assurance/verification/contract/specification.ts';

const D = (char: string) => `sha256:${char.repeat(64)}` as const;

type ClaimInput = Parameters<typeof createVerificationClaim>[0];
type ObligationInput = Parameters<typeof createProofObligation>[0];
type SelectionInput = Parameters<typeof createVerificationMethodSelection>[0];

function claimInput(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claimRef: 'claim:compiler/type-soundness',
    claimRevision: 'claim-r1',
    source: {
      kind: 'requirement',
      ref: 'requirement:type-soundness',
      revision: 'req-r3'
    },
    ownerRef: 'owner:verification',
    subjectRef: 'subject:candidate',
    subjectRevision: 'candidate-r1',
    propositionDigest: D('1'),
    applicabilityScopeDigest: D('2'),
    assumptionsDigest: D('3'),
    requiredAssuranceDigest: D('4'),
    lifecycleAndInvalidationDigest: D('5'),
    ...overrides
  };
}

function claim(overrides: Partial<ClaimInput> = {}) {
  return createVerificationClaim(claimInput(overrides));
}

function obligationInput(
  c = claim(),
  overrides: Partial<ObligationInput> = {}
): ObligationInput {
  return {
    obligationRef: 'obligation:typecheck',
    obligationRevision: 'obligation-r2',
    claimRef: c.claimRef,
    claimRevision: c.claimRevision,
    claimDigest: c.claimDigest,
    ownerRef: 'owner:verification',
    requiredObservationOrPredicateDigest: D('6'),
    applicabilityScopeDigest: D('7'),
    requiredIndependenceDigest: D('8'),
    admissibleMethodFamilies: ['static-analysis', 'typecheck'],
    environmentAndCapabilityConstraintsDigest: D('9'),
    coverageAndFailureSpaceDigest: D('a'),
    lifecycleAndInvalidationDigest: D('b'),
    ...overrides
  };
}

function obligation(c = claim(), overrides: Partial<ObligationInput> = {}) {
  return createProofObligation(obligationInput(c, overrides));
}

function selectionInput(
  o = obligation(),
  overrides: Partial<SelectionInput> = {}
): SelectionInput {
  return {
    selectionRef: 'selection:typecheck',
    selectionRevision: 'selection-r4',
    proofObligationRef: o.obligationRef,
    proofObligationRevision: o.obligationRevision,
    proofObligationDigest: o.obligationDigest,
    methodFamily: 'typecheck',
    methodContractRef: 'method:typecheck',
    methodContractRevision: 'method-r7',
    environmentAndCapabilityRequirementsDigest: D('c'),
    oracleCheckerOrReferenceRefs: ['checker:tsgo', 'reference:ts-language-semantics'],
    executionRequired: true,
    evidenceQualificationDigest: D('d'),
    lifecycleAndInvalidationDigest: D('e'),
    ...overrides
  };
}

function selection(o = obligation(), overrides: Partial<SelectionInput> = {}) {
  return createVerificationMethodSelection(selectionInput(o, overrides));
}

test('canonical specification binding proves selection to obligation to claim', () => {
  const c = claim();
  const o = obligation(c);
  const s = selection(o);
  const binding = createVerificationSpecificationBinding({
    claim: c,
    proofObligation: o,
    methodSelection: s
  });
  expect(binding).toMatchObject({
    schema: 'verification-specification-binding',
    claim: { claimRef: c.claimRef, claimDigest: c.claimDigest },
    proofObligation: { obligationRef: o.obligationRef, obligationDigest: o.obligationDigest },
    methodSelection: { selectionRef: s.selectionRef, selectionDigest: s.selectionDigest }
  });
  expect(() => assertVerificationSpecificationBinding(binding)).not.toThrow();
  expect(() => assertVerificationSpecificationBinding({ ...binding })).toThrow();
});

test('claim identity changes with exact source subject or semantic content', () => {
  const base = claim();
  expect(claim({ subjectRevision: 'candidate-r2' }).claimDigest).not.toBe(base.claimDigest);
  expect(claim({ propositionDigest: D('f') }).claimDigest).not.toBe(base.claimDigest);
  expect(claim({
    source: { kind: 'requirement', ref: 'requirement:type-soundness', revision: 'req-r4' }
  }).claimDigest).not.toBe(base.claimDigest);
});

test('obligation must bind the exact claim digest, not only ref and revision', () => {
  const c = claim();
  const o = obligation(c);
  const otherClaim = claim({ propositionDigest: D('f') });
  expect(() => createVerificationSpecificationBinding({
    claim: otherClaim,
    proofObligation: o,
    methodSelection: selection(o)
  })).toThrow('does not bind the exact Verification Claim');
});

test('selection must bind the exact obligation digest and admitted method family', () => {
  const c = claim();
  const o = obligation(c);
  const wrongDigest = selection(o, { proofObligationDigest: D('f') });
  expect(() => createVerificationSpecificationBinding({
    claim: c,
    proofObligation: o,
    methodSelection: wrongDigest
  })).toThrow('does not bind the exact Proof Obligation');

  const inadmissible = selection(o, { methodFamily: 'runtime-fuzz' });
  expect(() => createVerificationSpecificationBinding({
    claim: c,
    proofObligation: o,
    methodSelection: inadmissible
  })).toThrow('not admitted by the obligation');
});

test('set-like method families and oracle references are unique and canonically ordered', () => {
  const c = claim();
  expect(() => obligation(c, {
    admissibleMethodFamilies: ['typecheck', 'static-analysis']
  })).toThrow('unique and canonically ordered');

  const o = obligation(c);
  expect(() => selection(o, {
    oracleCheckerOrReferenceRefs: ['reference:z', 'checker:a']
  })).toThrow('unique and canonically ordered');
});

test('placeholder digests and untrusted extra fields are rejected', () => {
  expect(() => claim({ propositionDigest: D('0') })).toThrow('non-placeholder');
  expect(() => createVerificationClaim({
    ...claimInput(),
    hiddenLatestRef: 'forbidden'
  } as never)).toThrow('fields are invalid');
});

test('binding input rejects Proxy/accessor wrappers without invoking them', () => {
  const c = claim();
  const o = obligation(c);
  const s = selection(o);
  let trapCalls = 0;
  const proxy = new Proxy({ claim: c, proofObligation: o, methodSelection: s }, {
    get() { trapCalls += 1; throw new Error('get trap'); },
    ownKeys() { trapCalls += 1; throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('descriptor trap'); },
    getPrototypeOf() { trapCalls += 1; throw new Error('prototype trap'); }
  });
  expect(() => createVerificationSpecificationBinding(proxy)).toThrow('Proxy values');
  expect(trapCalls).toBe(0);
});
