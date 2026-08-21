import { expect } from 'bun:test';

import {
  compileTestCaseCensusV1,
  observeTestCasesInSourceV1
} from '../../tooling/sec-dev/test-case-census.ts';
import { secTest } from '../testkit/responsibility.ts';

const SEC_TEST_IMPORT = "import { secTest } from '../testkit/responsibility.ts';";

type FixtureCase = Readonly<{
  testId: string;
  title: string;
  obligationId: string;
  failureMeaningCode: string;
}>;

function declaredCase(input: FixtureCase): string {
  return `
secTest({
  testId: ${JSON.stringify(input.testId)},
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: ${JSON.stringify(input.obligationId)},
    owner: 'test-responsibility',
    failureMeaningCode: ${JSON.stringify(input.failureMeaningCode)}
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, ${JSON.stringify(input.title)}, () => {});
`;
}

function declaredSource(input: FixtureCase): string {
  return `${SEC_TEST_IMPORT}\n${declaredCase(input)}`;
}

const FIXTURE: FixtureCase = {
  testId: 'verification.test-census.fixture',
  title: 'declared fixture case',
  obligationId: 'test-case-census-fixture',
  failureMeaningCode: 'test-case-census-incomplete'
};

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
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/contract/fixture-a.test.ts',
    sourceText: declaredSource(FIXTURE)
  }]);

  expect(census.caseCount).toBe(1);
  expect(census.resolvedCount).toBe(1);
  expect(census.unresolvedCount).toBe(0);
  expect(census.resolvedResponsibilities[0]).toMatchObject({
    testId: FIXTURE.testId,
    sourcePath: 'tests/contract/fixture-a.test.ts',
    case: { suitePath: [], title: FIXTURE.title }
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
  expect(observeTestCasesInSourceV1(
    'tests/contract/fake-registration.test.ts',
    `
      const secTest = (...args: unknown[]) => args;
      const test = (...args: unknown[]) => args;
      const describe = (...args: unknown[]) => args;
      secTest({}, 'not a SEC test', () => {});
      test('not a Bun test', () => {});
      describe('not a Bun suite', () => test('still fake', () => {}));
    `
  )).toEqual([]);
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
  const named = declaredCase({
    testId: 'verification.alias.named',
    title: 'owned alias',
    obligationId: 'alias-named',
    failureMeaningCode: 'alias-named-failed'
  }).replaceAll('secTest(', 'ownedCase(');
  const namespace = declaredCase({
    testId: 'verification.alias.namespace',
    title: 'owned namespace',
    obligationId: 'alias-namespace',
    failureMeaningCode: 'alias-namespace-failed'
  }).replaceAll('secTest(', 'owned.secTest(');

  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/contract/alias-fixture.test.ts',
    sourceText: `
      import { test as bunCase } from 'bun:test';
      import * as bun from 'bun:test';
      import { secTest as ownedCase } from '../testkit/responsibility.ts';
      import * as owned from '../testkit/responsibility.ts';
      bunCase('raw alias', () => {});
      bun.it('raw namespace', () => {});
      ${named}
      ${namespace}
    `
  }]);

  expect(census.caseCount).toBe(4);
  expect(census.resolvedResponsibilities.map(({ testId }) => testId)).toEqual([
    'verification.alias.named',
    'verification.alias.namespace'
  ]);
  expect(census.unresolved).toHaveLength(2);
  expect(census.unresolved.every(({ reasonCodes }) => (
    reasonCodes.length === 1 && reasonCodes[0] === 'raw-bun-test-without-responsibility'
  ))).toBe(true);
});

secTest({
  testId: 'verification.test-census.unresolved-reasons',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-unresolved-reasons',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-census-dropped-independent-unresolved-reason'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'legacy and dynamic registrations preserve every unresolved reason', () => {
  const census = compileTestCaseCensusV1([{
    sourcePath: 'tests/unit/dynamic-family.test.ts',
    sourceText: `
      import { describe, it, test } from 'bun:test';
      const cases = [1, 2];
      const name = 'dynamic';
      test('legacy static', () => {});
      it(name, () => {});
      test.each(cases)('case %s', () => {});
      describe.each(cases)('suite %s', () => test('nested', () => {}));
    `
  }]);

  expect(census.caseCount).toBe(4);
  expect(census.unresolved.map(({ reasonCodes }) => reasonCodes)).toEqual(expect.arrayContaining([
    ['raw-bun-test-without-responsibility'],
    ['dynamic-test-title', 'raw-bun-test-without-responsibility'],
    ['parameterized-family-unresolved', 'raw-bun-test-without-responsibility'],
    ['dynamic-suite-family', 'raw-bun-test-without-responsibility']
  ]));
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
      describe('outer', () => describe('inner', () => ${declaredCase(FIXTURE)}));
    `
  );

  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({
    suitePath: ['outer', 'inner'],
    title: FIXTURE.title,
    resolution: 'resolved',
    reasonCodes: []
  });
});

secTest({
  testId: 'verification.test-census.identity-conflicts',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-identity-conflicts',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-census-truncated-on-identity-conflict'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'duplicate locator and stable id conflicts remain visible without truncating the census', () => {
  const sameLocator = compileTestCaseCensusV1([{
    sourcePath: 'tests/contract/duplicate-locator.test.ts',
    sourceText: `${SEC_TEST_IMPORT}
      ${declaredCase({ testId: 'verification.duplicate.first', title: 'same', obligationId: 'duplicate-first', failureMeaningCode: 'duplicate-first-failed' })}
      ${declaredCase({ testId: 'verification.duplicate.second', title: 'same', obligationId: 'duplicate-second', failureMeaningCode: 'duplicate-second-failed' })}`
  }]);
  expect(sameLocator.duplicateLocatorCount).toBe(1);
  expect(sameLocator.unresolved).toHaveLength(2);
  expect(sameLocator.unresolved.every(({ reasonCodes }) => (
    reasonCodes.includes('duplicate-test-locator')
  ))).toBe(true);

  const sameId = compileTestCaseCensusV1([
    {
      sourcePath: 'tests/contract/duplicate-id-a.test.ts',
      sourceText: declaredSource({ testId: 'verification.duplicate.stable-id', title: 'first', obligationId: 'duplicate-id-a', failureMeaningCode: 'duplicate-id-a-failed' })
    },
    {
      sourcePath: 'tests/contract/duplicate-id-b.test.ts',
      sourceText: declaredSource({ testId: 'verification.duplicate.stable-id', title: 'second', obligationId: 'duplicate-id-b', failureMeaningCode: 'duplicate-id-b-failed' })
    }
  ]);
  expect(sameId.duplicateTestIdCount).toBe(1);
  expect(sameId.unresolved).toHaveLength(2);
  expect(sameId.unresolved.every(({ reasonCodes }) => reasonCodes.includes('duplicate-test-id'))).toBe(true);
});

secTest({
  testId: 'verification.test-census.locator-single-writer',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-locator-single-writer',
    owner: 'test-responsibility',
    failureMeaningCode: 'physical-test-locator-double-written'
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
        owner: 'test-responsibility', layer: 'contract', role: 'primary', lifecycle: 'active',
        obligations: [{ kind: 'contract', id: 'x', owner: 'test-responsibility', failureMeaningCode: 'x-failed' }],
        retirementCondition: { kind: 'persistent-invariant' }
      }, 'actual', () => {});
    `
  }]);

  expect(census.resolvedCount).toBe(0);
  expect(census.unresolved[0]?.reasonCodes).toContain('physical-locator-in-responsibility');
});

secTest({
  testId: 'verification.test-census.failure-meaning-edge',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'contract',
    id: 'test-case-census-failure-meaning-edge',
    owner: 'test-responsibility',
    failureMeaningCode: 'failure-meaning-collapsed-across-independent-proofs'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'independent proofs may bind distinct failure meanings to the same obligation identity', () => {
  const census = compileTestCaseCensusV1([
    {
      sourcePath: 'tests/contract/meaning-a.test.ts',
      sourceText: declaredSource({ testId: 'verification.meaning.a', title: 'meaning a', obligationId: 'shared-obligation', failureMeaningCode: 'pure-proof-failed' })
    },
    {
      sourcePath: 'tests/contract/meaning-b.test.ts',
      sourceText: declaredSource({ testId: 'verification.meaning.b', title: 'meaning b', obligationId: 'shared-obligation', failureMeaningCode: 'physical-proof-failed' })
    }
  ]);
  expect(census.resolvedCount).toBe(2);
  expect(census.resolvedResponsibilities.map(({ obligations }) => obligations[0]?.failureMeaningCode))
    .toEqual(['pure-proof-failed', 'physical-proof-failed']);
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
      sourceText: declaredSource({ ...FIXTURE, testId: 'verification.test-census.fixture-b' })
    },
    { sourcePath: 'tests/contract/a.test.ts', sourceText: declaredSource(FIXTURE) }
  ];

  const left = compileTestCaseCensusV1(sources);
  const right = compileTestCaseCensusV1([...sources].reverse());
  expect(JSON.stringify(left)).toBe(JSON.stringify(right));
});
