import { expect } from 'bun:test';

import {
  compileTestCaseCensusV1,
  observeTestCasesInSourceV1
} from '../../tooling/sec-dev/test-case-census.ts';
import { secTest } from '../testkit/responsibility.ts';

const SEC_TEST_IMPORT = "import { secTest } from '../testkit/responsibility.ts';";
const BUN_TEST_IMPORT = "import { describe, it, test } from 'bun:test';";
const DECLARED_CASE = `
secTest({
  testId: 'verification.test-census.fixture',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-fixture',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-case-census-incomplete'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'declared fixture case', () => {});
`;
const DECLARED_SOURCE = `${SEC_TEST_IMPORT}\n${DECLARED_CASE}`;

secTest({
  testId: 'verification.test-census.co-located-responsibility',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-co-located-responsibility',
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
  testId: 'verification.test-census.import-provenance',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-import-provenance',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-registration-inferred-from-lexical-name'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'only canonical Bun and responsibility imports create test registrations', () => {
  const observations = observeTestCasesInSourceV1(
    'tests/contract/fake-registration.test.ts',
    `
      const secTest = (...args: unknown[]) => args;
      const test = (...args: unknown[]) => args;
      const describe = (...args: unknown[]) => args;
      secTest({}, 'not a SEC test', () => {});
      test('not a Bun test', () => {});
      describe('not a Bun suite', () => test('still fake', () => {}));
    `
  );
  expect(observations).toEqual([]);
});

secTest({
  testId: 'verification.test-census.import-aliases',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-import-aliases',
    owner: 'test-responsibility',
    failureMeaningCode: 'canonical-test-import-alias-unobserved'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'named aliases and namespace imports preserve provider provenance', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/contract/alias-fixture.test.ts',
    sourceText: `
      import { test as bunCase } from 'bun:test';
      import * as bun from 'bun:test';
      import { secTest as ownedCase } from '../testkit/responsibility.ts';
      import * as owned from '../testkit/responsibility.ts';

      bunCase('raw alias', () => {});
      bun.it('raw namespace', () => {});
      ownedCase({
        testId: 'verification.alias.named',
        owner: 'test-responsibility',
        layer: 'contract', role: 'primary', lifecycle: 'active',
        obligations: [{ kind: 'contract', id: 'alias-named', owner: 'test-responsibility', failureMeaningCode: 'alias-named-failed' }],
        retirementCondition: { kind: 'persistent-invariant' }
      }, 'owned alias', () => {});
      owned.secTest({
        testId: 'verification.alias.namespace',
        owner: 'test-responsibility',
        layer: 'contract', role: 'primary', lifecycle: 'active',
        obligations: [{ kind: 'contract', id: 'alias-namespace', owner: 'test-responsibility', failureMeaningCode: 'alias-namespace-failed' }],
        retirementCondition: { kind: 'persistent-invariant' }
      }, 'owned namespace', () => {});
    `
  }]);

  expect(census.caseCount).toBe(4);
  expect(census.resolvedCount).toBe(2);
  expect(census.unresolvedCount).toBe(2);
  expect(census.resolvedResponsibilities.map(({ testId }) => testId)).toEqual([
    'verification.alias.named',
    'verification.alias.namespace'
  ]);
  expect(census.unresolved.map(({ reasonCode }) => reasonCode))
    .toEqual(['raw-bun-test-without-responsibility', 'raw-bun-test-without-responsibility']);
});

secTest({
  testId: 'verification.test-census.legacy-visible',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-legacy-visible',
    owner: 'test-responsibility',
    failureMeaningCode: 'legacy-test-silently-missing'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'raw Bun tests and dynamic titles remain visible as unresolved', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/legacy-fixture.test.ts',
    sourceText: `
      import { it, test } from 'bun:test';
      const name = 'dynamic';
      test('legacy static', () => {});
      it(name, () => {});
    `
  }]);

  expect(census.caseCount).toBe(2);
  expect(census.resolvedCount).toBe(0);
  expect(census.unresolved.map(({ reasonCode }) => reasonCode).sort()).toEqual([
    'dynamic-test-title',
    'raw-bun-test-without-responsibility'
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
    id: 'test-case-census-suite-path',
    owner: 'test-responsibility',
    failureMeaningCode: 'nested-suite-locator-incomplete'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'nested static describe paths are derived without entering semantic identity', () => {
  const observations = observeTestCasesInSourceV1(
    'tests/contract/nested-fixture.test.ts',
    `
      import { describe } from 'bun:test';
      ${SEC_TEST_IMPORT}
      describe('outer', () => {
        describe('inner', () => {
          ${DECLARED_CASE}
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
    id: 'test-case-census-dynamic-families',
    owner: 'test-responsibility',
    failureMeaningCode: 'dynamic-test-family-silently-collapsed'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'parameterized and dynamic suite families fail closed to unresolved', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/dynamic-family.test.ts',
    sourceText: `
      import { describe, test } from 'bun:test';
      const cases = [1, 2];
      test.each(cases)('case %s', () => {});
      describe.each(cases)('suite %s', () => {
        test('nested', () => {});
      });
    `
  }]);

  expect(census.caseCount).toBe(2);
  expect(census.unresolved.map(({ reasonCode }) => reasonCode).sort()).toEqual([
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
    id: 'test-case-census-duplicate-locator',
    owner: 'test-responsibility',
    failureMeaningCode: 'duplicate-test-locator-accepted'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'duplicate executable locators stay visible and fail closed to unresolved', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/duplicate.test.ts',
    sourceText: `
      import { test } from 'bun:test';
      test('same', () => {});
      test('same', () => {});
    `
  }]);
  expect(census.caseCount).toBe(2);
  expect(census.duplicateLocatorCount).toBe(1);
  expect(census.resolvedCount).toBe(0);
  expect(census.unresolved).toHaveLength(2);
  expect(census.unresolved.every(({ reasonCode }) => reasonCode === 'duplicate-test-locator')).toBe(true);
});

secTest({
  testId: 'verification.test-census.no-physical-double-write',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-no-physical-double-write',
    owner: 'test-responsibility',
    failureMeaningCode: 'physical-locator-double-written'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'responsibility metadata cannot hand-write source or case locator', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/bad-responsibility.test.ts',
    sourceText: `
      ${SEC_TEST_IMPORT}
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
  testId: 'verification.test-census.obligation-meaning',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-obligation-meaning',
    owner: 'test-responsibility',
    failureMeaningCode: 'obligation-failure-meaning-became-multi-writer'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'one proof obligation identity has one canonical failure meaning', () => {
  const first = DECLARED_SOURCE.replace(
    "testId: 'verification.test-census.fixture'",
    "testId: 'verification.test-census.meaning-a'"
  ).replace(
    "id: 'test-case-census-fixture'",
    "id: 'shared-obligation'"
  ).replace(
    "failureMeaningCode: 'test-case-census-incomplete'",
    "failureMeaningCode: 'meaning-a'"
  );
  const second = DECLARED_SOURCE.replace(
    "testId: 'verification.test-census.fixture'",
    "testId: 'verification.test-census.meaning-b'"
  ).replace(
    "id: 'test-case-census-fixture'",
    "id: 'shared-obligation'"
  ).replace(
    "failureMeaningCode: 'test-case-census-incomplete'",
    "failureMeaningCode: 'meaning-b'"
  );

  expect(() => compileTestCaseCensusV1([
    { sourcePath: 'tests/contract/meaning-a.test.ts', sourceText: first },
    { sourcePath: 'tests/contract/meaning-b.test.ts', sourceText: second }
  ])).toThrow('conflicting failure meanings');
});

secTest({
  testId: 'verification.test-census.deterministic-order',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-deterministic-order',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-case-census-order-dependent'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'source enumeration order does not change the compiled census', () => {
  const sources = [
    {
      sourcePath: 'tests/contract/b.test.ts',
      sourceText: DECLARED_SOURCE.replace(
        "testId: 'verification.test-census.fixture'",
        "testId: 'verification.test-census.fixture-b'"
      )
    },
    { sourcePath: 'tests/contract/a.test.ts', sourceText: DECLARED_SOURCE }
  ];

  const left = compileTestCaseCensusV1(sources);
  const right = compileTestCaseCensusV1([...sources].reverse());
  expect(JSON.stringify(left)).toBe(JSON.stringify(right));
});
