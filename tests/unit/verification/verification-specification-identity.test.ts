import { expect, test } from 'bun:test';

import {
  createProofObligation,
  createVerificationClaim,
  createVerificationMethodSelection,
  createVerificationSpecificationBinding
} from '../../../src/assurance/verification/contract/specification.ts';
import { createVerificationTestResponsibility, parseVerificationTestResponsibility } from '../../../src/assurance/verification/contract/test-responsibility.ts';

const D = (char: string) => `sha256:${char.repeat(64)}` as const;

type ClaimInput = Parameters<typeof createVerificationClaim>[0];
type SelectionInput = Parameters<typeof createVerificationMethodSelection>[0];

function claim(overrides: Partial<ClaimInput> = {}) {
  return createVerificationClaim({
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
  });
}

function obligation(c: ReturnType<typeof createVerificationClaim>) {
  return createProofObligation({
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
    lifecycleAndInvalidationDigest: D('b')
  });
}

function selection(
  o: ReturnType<typeof createProofObligation>,
  overrides: Partial<SelectionInput> = {}
) {
  return createVerificationMethodSelection({
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
  });
}

function responsibility() {
  const c = claim();
  const o = obligation(c);
  const s = selection(o);
  return createVerificationTestResponsibility({
    testRef: 'test:compiler/type-soundness', testRevision: 'test-r1', ownerRef: 'owner:verification',
    bindings: [{ specification: createVerificationSpecificationBinding({ claim: c, proofObligation: o, methodSelection: s }),
      failureMeaning: 'The required type soundness does not hold', observationBoundary: 'compiler typecheck result',
      oracleAndIndependenceRefs: ['checker:tsgo', 'reference:ts-language-semantics'] }],
    environmentAndResourceRequirementsDigest: D('6'), impactAndLifecycleDigest: D('7'), retirementConditionsDigest: D('8')
  });
}

test('persisted test responsibility retains the exact claim, obligation and selected method identities', () => {
  const value = responsibility();
  // Independent SHA-256 vectors over the literal canonical JSON inputs above,
  // not values derived from the constructors or the responsibility parser.
  expect(value.bindings[0]!.specification).toMatchObject({
    schema: 'verification-specification-binding',
    claim: { claimRef: 'claim:compiler/type-soundness',
      claimDigest: 'sha256:675f382e4d791cb416e526565a3d8df84e9350544cef75270beb6ee639984ef2' },
    proofObligation: { obligationRef: 'obligation:typecheck',
      obligationDigest: 'sha256:39b57f80ec2e0d56ee816849b94b38dfc65f137368a080b4b6edbcae38dd51b5' },
    methodSelection: { selectionRef: 'selection:typecheck',
      selectionDigest: 'sha256:14dfb3a2e4774deb15237b0fbc108509beef18541eb9a93395ead96e351a05ef' },
    bindingDigest: 'sha256:00dd2460da8217d0d0faf89c4661e6f240faeb4c9ef2d1280e120d9671c9f128'
  });
  expect(parseVerificationTestResponsibility(JSON.parse(JSON.stringify(value)))).toEqual(value);
  const original = value.bindings[0]!.specification.claim.claimDigest;
  for (const changed of [claim({ subjectRevision: 'candidate-r2' }), claim({ propositionDigest: D('f') }),
    claim({ source: { kind: 'requirement', ref: 'requirement:type-soundness', revision: 'req-r4' } })]) {
    expect(changed.claimDigest).not.toBe(original);
  }
});

test('responsibility admission rejects disconnected, noncanonical or executable specification data', () => {
  const value = responsibility();
  const member = value.bindings[0]!;
  const spec = member.specification;
  const reject = (specification: unknown, message: string) => {
    expect(() => parseVerificationTestResponsibility({ ...value,
      bindings: [{ ...member, specification }] })).toThrow(message);
  };
  reject({ ...spec, claim: claim({ propositionDigest: D('f') }) }, 'does not bind the exact Verification Claim');
  reject({ ...spec, methodSelection: selection(spec.proofObligation, { proofObligationDigest: D('f') }) },
    'does not bind the exact Proof Obligation');
  reject({ ...spec, methodSelection: selection(spec.proofObligation, { methodFamily: 'runtime-fuzz' }) },
    'not admitted by the obligation');

  for (const admissibleMethodFamilies of [['typecheck', 'static-analysis'], ['typecheck', 'typecheck']]) {
    reject({ ...spec, proofObligation: { ...spec.proofObligation, admissibleMethodFamilies } },
      'unique and canonically ordered');
  }
  for (const oracleCheckerOrReferenceRefs of [['reference:z', 'checker:a'], ['checker:a', 'checker:a']]) {
    reject({ ...spec, methodSelection: { ...spec.methodSelection, oracleCheckerOrReferenceRefs } },
      'unique and canonically ordered');
  }
  reject({ ...spec, claim: { ...spec.claim, propositionDigest: D('0') } }, 'non-placeholder');
  reject({ ...spec, claim: { ...spec.claim, hiddenLatestRef: 'forbidden' } }, 'fields are invalid');

  let trapCalls = 0;
  const proxy = new Proxy(spec, {
    get() { trapCalls += 1; throw new Error('get trap'); },
    ownKeys() { trapCalls += 1; throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('descriptor trap'); },
    getPrototypeOf() { trapCalls += 1; throw new Error('prototype trap'); }
  });
  reject(proxy, 'Proxy values');
  expect(trapCalls).toBe(0);
});
