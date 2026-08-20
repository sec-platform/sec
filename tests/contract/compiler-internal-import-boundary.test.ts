import { expect, test } from 'bun:test';

import { readRepositoryModuleGraphV1 } from '../../platform/shared/test-impact-contract.ts';

test('orchestrator and upgrade modules do not consume the compiler super-barrel', () => {
  const violations = readRepositoryModuleGraphV1().references
    .filter(({ from, resolvedTarget }) => (
      (from.startsWith('platform/orchestrator/') || from.startsWith('platform/upgrade/'))
      && resolvedTarget === 'platform/compiler/index.ts'
    ))
    .map(({ from, kind, specifier }) => `${from}:${kind}->${specifier}`);

  expect(violations).toEqual([]);
});
