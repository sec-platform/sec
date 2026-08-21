import { expect } from 'bun:test';

import {
  compileTestCaseCensusV1,
  observeTestCasesInSourceV1
} from '../../tooling/sec-dev/test-case-census.ts';
import { secTest } from '../testkit/responsibility.ts';

const DECLARED_SOURCE = `
secTest({
  testId: 'verification.test-census.fixture',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-case-census-incomplete'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'declared fixture case', () => {});
`;

secTest({
  testId: 'verification.test-census.co-located-responsibility',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'co-located-responsibility-not-observed'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'co-located responsibility resolves while locator is derived from source', () => {
  const census = compileTestCaseCensusV1([
    { sourcePath: 'tests/contract/fixture-a.test.ts', sourceText: DECLARED_SOURCE }
  ]);

  expect(census.caseCount).toBe(1);
  expect(census.resolvedCount).toBe(1);
  expect(census.unresolvedCount).toBe(0);
  expect(census.resolvedResponsibilities[0]).toMatchObject({
    testId: 'verification.test-census.fixture',
    sourcePath: 'tests/contract/fixture-a.test.ts',
    case: { suitePath: [], title: 'declared fixture case' }
  });
});

secTest({
  testId: 'verification.test-census.legacy-visible',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'legacy-test-silently-missing'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'raw Bun tests and dynamic titles remain visible as unresolved', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/legacy-fixture.test.ts',
    sourceText: `
      const name = 'dynamic';
      test('legacy static', () => {});
      it(name, () => {});
    `
  }]);

  expect(census.caseCount).toBe(2);
  expect(census.resolvedCount).toBe(0);
  expect(census.unresolved.map(({ reasonCode }) => reasonCode)).toEqual([
    'raw-bun-test-without-responsibility',
    'dynamic-test-title'
  ]);
});

secTest({
  testId: 'verification.test-census.suite-path',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'nested-suite-locator-incomplete'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'nested static describe paths are derived without entering semantic identity', () => {
  const observations = observeTestCasesInSourceV1(
    'tests/contract/nested-fixture.test.ts',
    `
      describe('outer', () => {
        describe('inner', () => {
          ${DECLARED_SOURCE}
        });
      });
    `
  );

  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({
    suitePath: ['outer', 'inner'],
    title: 'declared fixture case',
    resolution: 'resolved'
  });
});

secTest({
  testId: 'verification.test-census.dynamic-families',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'dynamic-test-family-silently-collapsed'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'parameterized and dynamic suite families fail closed to unresolved', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/dynamic-family.test.ts',
    sourceText: `
      const cases = [1, 2];
      test.each(cases)('case %s', () => {});
      describe.each(cases)('suite %s', () => {
        test('nested', () => {});
      });
    `
  }]);

  expect(census.caseCount).toBe(2);
  expect(census.unresolved.map(({ reasonCode }) => reasonCode)).toEqual([
    'dynamic-suite-family',
    'parameterized-family-unresolved'
  ]);
});

secTest({
  testId: 'verification.test-census.duplicate-locator',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'duplicate-test-locator-accepted'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'duplicate executable locators are rejected independently of responsibility state', () => {
  expect(() => compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/duplicate.test.ts',
    sourceText: `
      test('same', () => {});
      test('same', () => {});
    `
  }])).toThrow('Duplicate executable test case locator');
});

secTest({
  testId: 'verification.test-census.no-physical-double-write',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'physical-locator-double-written'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'responsibility metadata cannot hand-write source or case locator', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/bad-responsibility.test.ts',
    sourceText: `
      secTest({
        testId: 'verification.bad',
        sourcePath: 'tests/unit/forged.test.ts',
        case: { suitePath: [], title: 'forged' },
        owner: 'test-responsibility',
        layer: 'contract',
        role: 'primary',
        lifecycle: 'active',
        obligations: [{
          kind: 'contract', id: 'x', owner: 'test-responsibility', failureMeaningCode: 'x-failed'
        }],
        retirementCondition: { kind: 'persistent-invariant' }
      }, 'actual', () => {});
    `
  }]);

  expect(census.resolvedCount).toBe(0);
  expect(census.unresolved[0]?.reasonCode).toBe('physical-locator-in-responsibility');
});

secTest({
  testId: 'verification.test-census.deterministic-order',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-case-census-order-dependent'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'source enumeration order does not change the compiled census', () => {
  const sources = [
    { sourcePath: 'tests/contract/b.test.ts', sourceText: DECLARED_SOURCE.replace('fixture', 'fixture-b') },
    { sourcePath: 'tests/contract/a.test.ts', sourceText: DECLARED_SOURCE }
  ];

  const left = compileTestCaseCensusV1(sources);
  const right = compileTestCaseCensusV1([...sources].reverse());
  expect(JSON.stringify(left)).toBe(JSON.stringify(right));
});
