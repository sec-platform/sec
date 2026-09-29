import { expect, test } from 'bun:test';

import {
  createProofObligation,
  createVerificationClaim,
  createVerificationMethodSelection,
  createVerificationSpecificationBinding
} from '../../src/assurance/verification/contract/specification.ts';
import {
  assertVerificationEvidenceUse,
  createVerificationEvidenceUse,
  type VerificationEvidenceUseInput
} from '../../src/assurance/verification/evidence-use/contract/use.ts';
import {
  readVerificationDataRecord,
  snapshotVerificationData,
  verificationDataEqual
} from '../../src/assurance/verification/contract/data.ts';

function digest(hex: string): `sha256:${string}` {
  return `sha256:${hex.repeat(64)}`;
}

const Q = digest('1');
const I = digest('2');

function specification(subjectRevision = 'subject-r1') {
  const claim = createVerificationClaim({
    claimRef: 'claim:compiler/type-soundness',
    claimRevision: 'claim-r1',
    source: { kind: 'requirement', ref: 'requirement:type-soundness', revision: 'req-r1' },
    ownerRef: 'owner:verification',
    subjectRef: 'subject:candidate',
    subjectRevision,
    propositionDigest: digest('3'),
    applicabilityScopeDigest: digest('4'),
    assumptionsDigest: digest('5'),
    requiredAssuranceDigest: digest('6'),
    lifecycleAndInvalidationDigest: digest('7')
  });
  const proofObligation = createProofObligation({
    obligationRef: 'obligation:typecheck',
    obligationRevision: 'obligation-r1',
    claimRef: claim.claimRef,
    claimRevision: claim.claimRevision,
    claimDigest: claim.claimDigest,
    ownerRef: 'owner:verification',
    requiredObservationOrPredicateDigest: digest('8'),
    applicabilityScopeDigest: digest('9'),
    requiredIndependenceDigest: digest('a'),
    admissibleMethodFamilies: ['typecheck'],
    environmentAndCapabilityConstraintsDigest: digest('b'),
    coverageAndFailureSpaceDigest: digest('c'),
    lifecycleAndInvalidationDigest: digest('d')
  });
  const methodSelection = createVerificationMethodSelection({
    selectionRef: 'selection:typecheck',
    selectionRevision: 'selection-r1',
    proofObligationRef: proofObligation.obligationRef,
    proofObligationRevision: proofObligation.obligationRevision,
    proofObligationDigest: proofObligation.obligationDigest,
    methodFamily: 'typecheck',
    methodContractRef: 'method:typecheck',
    methodContractRevision: 'method-r1',
    environmentAndCapabilityRequirementsDigest: digest('e'),
    oracleCheckerOrReferenceRefs: ['checker:tsgo'],
    executionRequired: true,
    evidenceQualificationDigest: digest('f'),
    lifecycleAndInvalidationDigest: digest('1')
  });
  return createVerificationSpecificationBinding({ claim, proofObligation, methodSelection });
}

function input(overrides: Partial<VerificationEvidenceUseInput> = {}): VerificationEvidenceUseInput {
  return {
    specification: specification(),
    evidenceRef: 'evidence:gate/typecheck/result',
    producerResultRef: 'verification-action-terminal:sha256:' + 'a'.repeat(64),
    methodConclusion: 'supports',
    qualification: {
      status: 'qualified',
      reason: 'exact-match',
      qualificationEvidenceRefs: [Q],
      invalidationRefs: []
    },
    ...overrides
  };
}

test('qualified Evidence Use binds exact consumer identity without rewriting producer evidence', () => {
  const use = createVerificationEvidenceUse(input());
  const spec = specification();
  expect(use).toMatchObject({
    schema: 'verification-evidence-use',
    claimRef: spec.claim.claimRef,
    proofObligationRef: spec.proofObligation.obligationRef,
    methodSelectionRef: spec.methodSelection.selectionRef,
    methodConclusion: 'supports',
    qualification: {
      status: 'qualified',
      reason: 'exact-match',
      qualificationEvidenceRefs: [Q],
      invalidationRefs: []
    }
  });
  expect(() => assertVerificationEvidenceUse(use)).not.toThrow();
});

test('historical contradicting Evidence can become stale without rewriting its conclusion', () => {
  const use = createVerificationEvidenceUse(input({
    methodConclusion: 'contradicts',
    qualification: {
      status: 'invalidated',
      reason: 'freshness-stale',
      qualificationEvidenceRefs: [Q],
      invalidationRefs: [I]
    }
  }));
  expect(use.methodConclusion).toBe('contradicts');
  expect(use.qualification.status).toBe('invalidated');
});

test('Evidence Use cannot materialize a conclusion that was never produced', () => {
  expect(() => createVerificationEvidenceUse({
    ...input(),
    methodConclusion: 'not-produced'
  } as unknown as VerificationEvidenceUseInput)).toThrow(
    'cannot exist for MethodConclusion=not-produced'
  );
});

test('qualified use requires current qualification evidence and no active invalidation', () => {
  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'qualified',
      reason: 'exact-match',
      qualificationEvidenceRefs: [],
      invalidationRefs: []
    }
  }))).toThrow('requires qualification evidence');

  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'qualified',
      reason: 'exact-match',
      qualificationEvidenceRefs: [Q],
      invalidationRefs: [I]
    }
  }))).toThrow('cannot retain an active invalidation');
});

test('invalidated use requires an explicit invalidation reference', () => {
  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'invalidated',
      reason: 'invalidation-active',
      qualificationEvidenceRefs: [Q],
      invalidationRefs: []
    }
  }))).toThrow('requires an invalidation reference');
});

test('qualification reason is status-specific and cannot turn unknown into qualified', () => {
  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'unknown',
      reason: 'exact-match',
      qualificationEvidenceRefs: [],
      invalidationRefs: []
    }
  }))).toThrow('qualification reason is invalid');
});

test('exact specification and producer references participate in Evidence Use identity', () => {
  const base = createVerificationEvidenceUse(input());
  for (const changed of [
    input({ specification: specification('subject-r2') }),
    input({ producerResultRef: 'verification-action-terminal:sha256:' + 'b'.repeat(64) }),
    input({ evidenceRef: 'evidence:gate/typecheck/other' })
  ]) {
    expect(createVerificationEvidenceUse(changed).useDigest).not.toBe(base.useDigest);
  }
});

test('persisted use rejects unknown reverse-consumer or verdict fields', () => {
  const use = createVerificationEvidenceUse(input());
  expect(() => assertVerificationEvidenceUse({
    ...use,
    verdictRef: 'verdict:forbidden-reverse-edge'
  })).toThrow('fields are invalid');
});

test('qualification evidence and invalidation sets are canonical value inputs', () => {
  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'unqualified',
      reason: 'coverage-insufficient',
      qualificationEvidenceRefs: [I, Q],
      invalidationRefs: []
    }
  }))).toThrow('unique and canonically ordered');

  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'unqualified',
      reason: 'coverage-insufficient',
      qualificationEvidenceRefs: [Q, Q],
      invalidationRefs: []
    }
  }))).toThrow('unique and canonically ordered');
});

test('contract parsing rejects Proxy values without invoking candidate traps', () => {
  const use = createVerificationEvidenceUse(input());
  let trapCalls = 0;
  const proxy = new Proxy(use, {
    get() { trapCalls += 1; throw new Error('candidate get trap'); },
    ownKeys() { trapCalls += 1; throw new Error('candidate ownKeys trap'); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('candidate descriptor trap'); },
    getPrototypeOf() { trapCalls += 1; throw new Error('candidate prototype trap'); }
  });
  expect(() => assertVerificationEvidenceUse(proxy)).toThrow('must not contain Proxy values');
  expect(trapCalls).toBe(0);
});

test('contract parsing rejects accessors without invoking them', () => {
  const use = createVerificationEvidenceUse(input());
  let getterCalls = 0;
  const candidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(use)) {
    Object.defineProperty(candidate, key, {
      enumerable: true,
      configurable: true,
      ...(key === 'evidenceRef'
        ? { get: () => { getterCalls += 1; return value; } }
        : { value, writable: true })
    });
  }
  expect(() => assertVerificationEvidenceUse(candidate)).toThrow('ordinary own data field');
  expect(getterCalls).toBe(0);
});

test('qualification ref arrays reject sparse, accessor and extra-field shapes', () => {
  const sparse = new Array(1);
  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'unqualified',
      reason: 'coverage-insufficient',
      qualificationEvidenceRefs: sparse as string[],
      invalidationRefs: []
    }
  }))).toThrow('dense');

  let getterCalls = 0;
  const accessor: string[] = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    configurable: true,
    get: () => { getterCalls += 1; return Q; }
  });
  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'unqualified',
      reason: 'coverage-insufficient',
      qualificationEvidenceRefs: accessor,
      invalidationRefs: []
    }
  }))).toThrow('ordinary own data field');
  expect(getterCalls).toBe(0);

  const extra = [Q] as string[] & { extra?: string };
  extra.extra = 'forbidden';
  expect(() => createVerificationEvidenceUse(input({
    qualification: {
      status: 'unqualified',
      reason: 'coverage-insufficient',
      qualificationEvidenceRefs: extra,
      invalidationRefs: []
    }
  }))).toThrow('dense and contain no extra own fields');
});

test('factory rejects Proxy inputs before nested authority inspection', () => {
  let trapCalls = 0;
  const proxy = new Proxy(input(), {
    get() { trapCalls += 1; throw new Error('candidate get trap'); },
    ownKeys() { trapCalls += 1; throw new Error('candidate ownKeys trap'); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('candidate descriptor trap'); },
    getPrototypeOf() { trapCalls += 1; throw new Error('candidate prototype trap'); }
  });
  expect(() => createVerificationEvidenceUse(
    proxy as unknown as VerificationEvidenceUseInput
  )).toThrow('Proxy values');
  expect(trapCalls).toBe(0);
});


test('verification data preserves hostile own property names without prototype mutation', () => {
  const candidate = Object.fromEntries([
    ['__proto__', { marker: '__proto__' }],
    ['constructor', { marker: 'constructor' }],
    ['prototype', { marker: 'prototype' }]
  ]);
  const shallow = readVerificationDataRecord(candidate);
  const deep = snapshotVerificationData(candidate);
  expect(Object.getPrototypeOf(shallow)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(deep as object)).toBe(Object.prototype);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    expect(Object.prototype.hasOwnProperty.call(shallow, key)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(deep as object, key)).toBe(true);
  }
  expect((shallow['__proto__'] as { marker: string }).marker).toBe('__proto__');
  expect(verificationDataEqual(candidate, deep)).toBe(true);
  expect(({} as Record<string, unknown>).marker).toBeUndefined();
});
