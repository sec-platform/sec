import { expect, test } from 'bun:test';

import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
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

test('canonical test responsibility sources select focused proof through existing impact owner', () => {
  for (const source of [
    'docs/test-responsibility.md',
    'platform/shared/test-responsibility-contract.ts'
  ]) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toContain('test-responsibility');
    expect(selection.fast).toEqual(expect.arrayContaining([
      'tests/contract/test-impact.test.ts',
      'tests/contract/test-responsibility-contract.test.ts'
    ]));
  }
});

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

test('calibration role is reserved for verifier-calibration obligations', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({ role: 'calibration' })
  ])).toThrow('calibration proof may only own verifier-calibration obligations');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      obligations: [{
        kind: 'verifier-calibration',
        id: 'selector-detection-power',
        owner: 'verification-governance',
        failureMeaningCode: 'selector-calibration-failed'
      }]
    })
  ])).toThrow('verifier-calibration obligation requires calibration role');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      role: 'calibration',
      obligations: [{
        kind: 'verifier-calibration',
        id: 'selector-detection-power',
        owner: 'verification-governance',
        failureMeaningCode: 'selector-calibration-failed'
      }]
    })
  ])).not.toThrow();
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

test('replacement proof has one direction and can only target active proof', () => {
  const retiring = declaration({
    testId: 'verification.proof.retiring',
    lifecycle: 'retiring',
    retirementCondition: {
      kind: 'replacement-proof',
      replacementTestIds: ['verification.proof.replacement'],
      coverageRef: 'evidence:replacement'
    }
  });
  const replacement = declaration({
    testId: 'verification.proof.replacement',
    sourcePath: 'tests/contract/verification-result.test.ts'
  });

  const normalized = normalizeTestResponsibilityDeclarations([retiring, replacement]);
  expect(normalized.find((entry) => entry.testId === retiring.testId)?.retirementCondition)
    .toEqual({
      kind: 'replacement-proof',
      replacementTestIds: ['verification.proof.replacement'],
      coverageRef: 'evidence:replacement'
    });

  expect(() => normalizeTestResponsibilityDeclarations([
    retiring,
    {
      ...replacement,
      lifecycle: 'retiring',
      retirementCondition: {
        kind: 'owner-retirement',
        owner: 'verification-governance'
      }
    }
  ])).toThrow('replacement verification.proof.replacement must be active');
});

test('replacement proof must preserve every canonical obligation identity', () => {
  const retiring = declaration({
    testId: 'verification.proof.retiring',
    lifecycle: 'retiring',
    obligations: [
      {
        kind: 'contract',
        id: 'test-responsibility',
        owner: 'verification-governance',
        failureMeaningCode: 'test-responsibility-invalid'
      },
      {
        kind: 'verification-requirement',
        id: 'proof-retirement-safe',
        owner: 'verification-governance',
        failureMeaningCode: 'proof-retirement-unresolved'
      }
    ],
    retirementCondition: {
      kind: 'replacement-proof',
      replacementTestIds: ['verification.proof.replacement'],
      coverageRef: 'evidence:replacement'
    }
  });
  const incomplete = declaration({
    testId: 'verification.proof.replacement',
    sourcePath: 'tests/contract/verification-result.test.ts'
  });

  expect(() => normalizeTestResponsibilityDeclarations([retiring, incomplete]))
    .toThrow('replacement proof does not cover obligations');

  const complete = declaration({
    ...incomplete,
    obligations: retiring.obligations.map((obligation) => ({
      ...obligation,
      failureMeaningCode: `${obligation.failureMeaningCode}-replacement`
    }))
  });
  expect(() => normalizeTestResponsibilityDeclarations([retiring, complete])).not.toThrow();
});

test('calibration proof cannot replace an ordinary product or contract obligation', () => {
  const retiring = declaration({
    testId: 'verification.proof.retiring',
    lifecycle: 'retiring',
    retirementCondition: {
      kind: 'replacement-proof',
      replacementTestIds: ['verification.proof.calibration'],
      coverageRef: 'evidence:replacement'
    }
  });
  const calibration = declaration({
    testId: 'verification.proof.calibration',
    sourcePath: 'tests/contract/verification-result.test.ts',
    role: 'calibration',
    obligations: [{
      kind: 'verifier-calibration',
      id: 'selector-detection-power',
      owner: 'verification-governance',
      failureMeaningCode: 'selector-calibration-failed'
    }]
  });

  expect(() => normalizeTestResponsibilityDeclarations([retiring, calibration]))
    .toThrow('replacement proof does not cover obligations');
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
