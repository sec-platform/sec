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
  for (const source of [
    'tooling/sec-dev/test-case-census.ts',
    'tests/testkit/responsibility.ts'
  ]) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toContain('module-graph');
    expect(selection.fast).toEqual(expect.arrayContaining([
      'tests/contract/test-case-census.test.ts',
      'tests/contract/test-responsibility-impact.test.ts'
    ]));
  }
});
