import { expect, test } from 'bun:test';

import { resolveTestOwnership, selectTestsForSources } from '../../src/verification/test-impact/runtime/impact.ts';

test('compiler pipeline changes select their real transitive consumers', () => {
  const source = 'src/compiler/pipeline/kernel.ts';
  const selection = selectTestsForSources([source]);

  expect(selection.owners).toEqual(['compiler']);
  expect(selection.fast).toContain('tests/integration/pipeline-kernel.test.ts');
  expect(resolveTestOwnership([source])).toEqual([{
    source,
    owner: 'compiler',
    identity: { kind: 'module', id: 'compiler' }
  }]);
});

test('upgrade changes select upgrade behavior without a central path table', () => {
  const selection = selectTestsForSources(['src/change-management/upgrade/upgrade-workspace.ts']);

  expect(selection.owners).toEqual(['change-management.upgrade']);
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/upgrade-summary.test.ts'
  ]));
  expect(selection.slow).toContain('tests/e2e/upgrade.test.ts');
});
