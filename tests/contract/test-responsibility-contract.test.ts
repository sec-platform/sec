import { expect } from 'bun:test';

import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import {
  normalizeTestResponsibilityDeclarations,
  type TestResponsibilityDeclaration
} from '../../platform/shared/test-responsibility-contract.ts';
import { secTest } from '../testkit/responsibility.ts';

function declaration(
  overrides: Partial<TestResponsibilityDeclaration> = {}
): TestResponsibilityDeclaration {
  return {
    testId: 'verification.test-responsibility.contract',
    sourcePath: 'tests/contract/test-responsibility-contract.test.ts',
    case: { suitePath: [], title: 'synthetic test responsibility fixture' },
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

secTest({
  testId: 'verification.test-responsibility.selection-round-trip',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'selection-round-trip',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-responsibility-selection-unprotected'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'canonical test responsibility sources select focused proof through existing impact owner', () => {
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

secTest({
  testId: 'verification.test-responsibility.determinism',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'normalization-determinism',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-responsibility-normalization-order-dependent'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'test responsibility normalization is order-independent for non-semantic collections', () => {
  const first = declaration({
    testId: 'verification.proof-economy.first',
    case: { suitePath: [], title: 'first synthetic proof' },
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
    case: { suitePath: [], title: 'second synthetic proof' },
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
  expect(Object.isFrozen(left[0]?.case)).toBe(true);
});

secTest({
  testId: 'verification.test-responsibility.stable-identity',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'stable-test-identity',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-identity-coupled-to-physical-locator'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'stable test identity and current physical case locator are separate', () => {
  const before = normalizeTestResponsibilityDeclarations([
    declaration({
      testId: 'verification.proof.stable-id',
      case: { suitePath: ['suite-a'], title: 'current title' }
    })
  ])[0]!;
  const after = normalizeTestResponsibilityDeclarations([
    declaration({
      testId: 'verification.proof.stable-id',
      sourcePath: 'tests/contract/verification-result.test.ts',
      case: { suitePath: ['suite-b'], title: 'renamed title' }
    })
  ])[0]!;

  expect(before.testId).toBe(after.testId);
  expect(before.sourcePath).not.toBe(after.sourcePath);
  expect(before.case).not.toEqual(after.case);
});

secTest({
  testId: 'verification.test-responsibility.duplicate-locator',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'unique-test-locator',
    owner: 'test-responsibility',
    failureMeaningCode: 'multiple-test-identities-claim-one-locator'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'two stable ids cannot claim the same executable case locator', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({ testId: 'verification.proof.first' }),
    declaration({ testId: 'verification.proof.second' })
  ])).toThrow('test case locator contains duplicate values');
});

secTest({
  testId: 'verification.test-responsibility.obligation-integrity',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'obligation-integrity',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-proof-obligation-unbound'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'every registered proof binds a canonical obligation and failure meaning', () => {
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

secTest({
  testId: 'verification.test-responsibility.calibration-role',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'calibration-role-boundary',
    owner: 'test-responsibility',
    failureMeaningCode: 'calibration-role-owns-product-proof'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'calibration role is reserved for verifier-calibration obligations', () => {
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

secTest({
  testId: 'verification.test-responsibility.mutation-layer',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'mutation-layer-boundary',
    owner: 'test-responsibility',
    failureMeaningCode: 'mutation-calibration-promoted-to-product-proof'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'mutation layer is calibration or diagnostic evidence, never primary proof', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({ layer: 'mutation' })
  ])).toThrow('mutation layer is calibration/diagnostic evidence, not primary proof');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      layer: 'mutation',
      role: 'calibration',
      obligations: [{
        kind: 'verifier-calibration',
        id: 'mutation-detection-power',
        owner: 'verification-governance',
        failureMeaningCode: 'mutation-calibration-failed'
      }]
    })
  ])).not.toThrow();
});

secTest({
  testId: 'verification.test-responsibility.diagnostic-lifecycle',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'diagnostic-lifecycle-boundary',
    owner: 'test-responsibility',
    failureMeaningCode: 'diagnostic-proof-leaked-into-required-lifecycle'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'diagnostic proofs cannot masquerade as ordinary required proof', () => {
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

secTest({
  testId: 'verification.test-responsibility.replacement-lifecycle',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'replacement-lifecycle',
    owner: 'test-responsibility',
    failureMeaningCode: 'replacement-target-not-active'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'replacement proof has one direction and can only target active proof', () => {
  const retiring = declaration({
    testId: 'verification.proof.retiring',
    case: { suitePath: [], title: 'retiring synthetic proof' },
    lifecycle: 'retiring',
    retirementCondition: {
      kind: 'replacement-proof',
      replacementTestIds: ['verification.proof.replacement'],
      coverageRef: 'evidence:replacement'
    }
  });
  const replacement = declaration({
    testId: 'verification.proof.replacement',
    sourcePath: 'tests/contract/verification-result.test.ts',
    case: { suitePath: [], title: 'replacement synthetic proof' }
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

secTest({
  testId: 'verification.test-responsibility.replacement-coverage',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'replacement-obligation-coverage',
    owner: 'test-responsibility',
    failureMeaningCode: 'replacement-drops-proof-obligation'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'replacement proof must preserve every canonical obligation identity', () => {
  const retiring = declaration({
    testId: 'verification.proof.retiring',
    case: { suitePath: [], title: 'retiring coverage proof' },
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
    sourcePath: 'tests/contract/verification-result.test.ts',
    case: { suitePath: [], title: 'incomplete replacement proof' }
  });

  expect(() => normalizeTestResponsibilityDeclarations([retiring, incomplete]))
    .toThrow('replacement proof does not cover obligations');

  const complete = declaration({
    ...incomplete,
    case: { suitePath: [], title: 'complete replacement proof' },
    obligations: retiring.obligations.map((obligation) => ({
      ...obligation,
      failureMeaningCode: `${obligation.failureMeaningCode}-replacement`
    }))
  });
  expect(() => normalizeTestResponsibilityDeclarations([retiring, complete])).not.toThrow();
});

secTest({
  testId: 'verification.test-responsibility.calibration-replacement',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'calibration-replacement-boundary',
    owner: 'test-responsibility',
    failureMeaningCode: 'calibration-replaces-product-obligation'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'calibration proof cannot replace an ordinary product or contract obligation', () => {
  const retiring = declaration({
    testId: 'verification.proof.retiring',
    case: { suitePath: [], title: 'ordinary retiring proof' },
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
    case: { suitePath: [], title: 'calibration replacement proof' },
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

secTest({
  testId: 'verification.test-responsibility.replacement-reference',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'replacement-reference-integrity',
    owner: 'test-responsibility',
    failureMeaningCode: 'replacement-reference-self-or-unknown'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'replacement retirement cannot silently point to self or an unknown proof', () => {
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

secTest({
  testId: 'verification.test-responsibility.owner-retirement',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'owner-retirement-coverage',
    owner: 'test-responsibility',
    failureMeaningCode: 'owner-retirement-drops-foreign-obligation'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'owner retirement cannot silently discard obligations owned elsewhere', () => {
  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      retirementCondition: {
        kind: 'owner-retirement',
        owner: 'compiler-target-ir'
      }
    })
  ])).toThrow('owner-retirement must cover every obligation owner');

  expect(() => normalizeTestResponsibilityDeclarations([
    declaration({
      obligations: [{
        kind: 'verification-requirement',
        id: 'implementation-resolution-contract',
        owner: 'compiler-target-ir',
        failureMeaningCode: 'implementation-resolution-unproven'
      }],
      retirementCondition: {
        kind: 'owner-retirement',
        owner: 'compiler-target-ir'
      }
    })
  ])).not.toThrow();
});

secTest({
  testId: 'verification.test-responsibility.retiring-lifecycle',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'retiring-lifecycle-authority',
    owner: 'test-responsibility',
    failureMeaningCode: 'retiring-proof-without-actionable-owner'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'retiring lifecycle requires an actionable retirement owner', () => {
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
      sourcePath: 'tests/contract/verification-result.test.ts',
      case: { suitePath: [], title: 'other synthetic proof' }
    })
  ])).toThrow('replacement-proof requires retiring lifecycle');
});
