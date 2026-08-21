import { expect, test } from 'bun:test';

import {
  normalizeTestResponsibilityDeclarations,
  type TestResponsibilityDeclaration
} from '../../platform/shared/test-responsibility-contract.ts';

function declaration(
  overrides: Partial<TestResponsibilityDeclaration> = {}
): TestResponsibilityDeclaration {
  return {
    testId: 'verification.test-responsibility.contract',
    sourcePath: 'tests/contract/test-responsibility-contract.test.ts',
    owner: 'verification-governance',
    layer: 'contract',
    role: 'primary',
    lifecycle: 'active',
    obligations: [{
      kind: 'contract',
      id: 'test-responsibility',
      owner: 'verification-governance',
      failureMeaningCode: 'test-responsibility-invalid'
    }],
    retirementCondition: { kind: 'persistent-invariant' },
    ...overrides
  };
}

test('test responsibility normalization is order-independent for non-semantic collections', () => {
  const first = declaration({
    testId: 'verification.proof-economy.first',
    obligations: [
      {
        kind: 'verification-requirement',
        id: 'proof-retirement-safe',
        owner: 'verification-governance',
        failureMeaningCode: 'proof-retirement-unresolved'
      },
      {
        kind: 'contract',
        id: 'test-responsibility',
        owner: 'verification-governance',
        failureMeaningCode: 'test-responsibility-invalid'
      }
    ],
    regressionRefs: ['issue-499', 'issue-327'],
    independence: [
      { dimension: 'oracle', witnessRef: 'contract:test-responsibility' },
      { dimension: 'failure-class', witnessRef: 'issue-499' }
    ]
  });
  const second = declaration({
    testId: 'verification.proof-economy.second',
    sourcePath: 'tests/contract/verification-result.test.ts',
    role: 'supporting',
    obligations: [{
      kind: 'verification-requirement',
      id: 'proof-retirement-safe',
      owner: 'verification-governance',
      failureMeaningCode: 'proof-retirement-unresolved'
    }]
  });

  const left = normalizeTestResponsibilityDeclarations([first, second]);
  const right = normalizeTestResponsibilityDeclarations([
    second,
    {
      ...first,
      obligations: [...first.obligations].reverse(),
      regressionRefs: [...(first.regressionRefs ?? [])].reverse(),
      independence: [...(first.independence ?? [])].reverse()
    }
  ]);

  expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  expect(Object.isFrozen(left)).toBe(true);
  expect(Object.isFrozen(left[0])).toBe(true);
});

test('every registered proof binds a canonical obligation and failure meaning', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({ obligations: [] })
  ])).toThrow('must bind at least one proof obligation');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      obligations: [{
        kind: 'contract',
        id: 'platform/shared/internal-helper.ts',
        owner: 'verification-governance',
        failureMeaningCode: 'implementation-detail-frozen'
      }]
    })
  ])).toThrow('obligation.id must be a bounded stable machine id');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      obligations: [{
        kind: 'contract',
        id: 'test-responsibility',
        owner: 'verification-governance',
        failureMeaningCode: ''
      }]
    })
  ])).toThrow('obligation.failureMeaningCode must be a bounded stable machine id');
});

test('diagnostic proofs cannot masquerade as ordinary required proof', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({ role: 'diagnostic', lifecycle: 'active' })
  ])).toThrow('diagnostic role and lifecycle must agree');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      role: 'diagnostic',
      lifecycle: 'diagnostic',
      retirementCondition: { kind: 'persistent-invariant' }
    })
  ])).toThrow('diagnostic proof requires diagnostic-completion retirement');

  const normalized = normalizeTestResponsibilityDeclarations([
    declaration({
      role: 'diagnostic',
      lifecycle: 'diagnostic',
      obligations: [{
        kind: 'verifier-calibration',
        id: 'bounded-diagnostic-probe',
        owner: 'verification-governance',
        failureMeaningCode: 'diagnostic-observation-failed'
      }],
      retirementCondition: {
        kind: 'diagnostic-completion',
        workRef: 'issue-499'
      }
    })
  ]);
  expect(normalized[0]?.role).toBe('diagnostic');
});

test('replacement proof is the single canonical supersedence relation and is acyclic', () => {
  const first = declaration({
    testId: 'verification.proof.first',
    lifecycle: 'retiring',
    retirementCondition: {
      kind: 'replacement-proof',
      replacementTestIds: ['verification.proof.second'],
      coverageRef: 'evidence:replacement-first'
    }
  });
  const second = declaration({
    testId: 'verification.proof.second',
    sourcePath: 'tests/contract/verification-result.test.ts',
    lifecycle: 'retiring',
    retirementCondition: {
      kind: 'replacement-proof',
      replacementTestIds: ['verification.proof.first'],
      coverageRef: 'evidence:replacement-second'
    }
  });

  expect(() => normalizeTestResponsibilityDeclarations([first, second]))
    .toThrow('test replacement cycle');
});

test('replacement retirement cannot silently point to self or an unknown proof', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      lifecycle: 'retiring',
      retirementCondition: {
        kind: 'replacement-proof',
        replacementTestIds: ['verification.test-responsibility.contract'],
        coverageRef: 'evidence:replacement'
      }
    })
  ])).toThrow('cannot replace itself');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      lifecycle: 'retiring',
      retirementCondition: {
        kind: 'replacement-proof',
        replacementTestIds: ['verification.unknown-proof'],
        coverageRef: 'evidence:replacement'
      }
    })
  ])).toThrow('unknown replacement test');
});

test('retiring lifecycle requires an actionable retirement owner', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({ lifecycle: 'retiring' })
  ])).toThrow('retiring proof requires replacement-proof or owner-retirement');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      lifecycle: 'active',
      retirementCondition: {
        kind: 'replacement-proof',
        replacementTestIds: ['verification.other-proof'],
        coverageRef: 'evidence:replacement'
      }
    }),
    declaration({
      testId: 'verification.other-proof',
      sourcePath: 'tests/contract/verification-result.test.ts'
    })
  ])).toThrow('replacement-proof requires retiring lifecycle');
});
