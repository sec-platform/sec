import { expect } from 'bun:test';

import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import { secTest } from '../testkit/responsibility.ts';

secTest({
  testId: 'verification.test-responsibility.census-impact',
  owner: 'test-responsibility',
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  obligations: [{
    kind: 'verification-requirement',
    id: 'test-responsibility-census-self-protection',
    owner: 'test-responsibility',
    failureMeaningCode: 'test-responsibility-census-change-not-selected'
  }],
  retirementCondition: { kind: 'persistent-invariant' }
}, 'responsibility census and wrapper changes are protected by the existing module graph', () => {
  const censusSelection = selectTestsForSources(['tooling/sec-dev/test-case-census.ts']);
  expect(censusSelection.owners).toContain('module-graph');
  expect(censusSelection.fast).toContain('tests/contract/test-case-census.test.ts');

  const wrapperSelection = selectTestsForSources(['tests/testkit/responsibility.ts']);
  expect(wrapperSelection.owners).toContain('module-graph');
  expect(wrapperSelection.fast).toEqual(expect.arrayContaining([
    'tests/contract/test-case-census.test.ts',
    'tests/contract/test-responsibility-contract.test.ts',
    'tests/contract/test-responsibility-impact.test.ts'
  ]));
});
