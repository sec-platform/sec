import { expect, test } from 'bun:test';

import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';

test('pipeline test impact ownership selects kernel vertical coverage', () => {
  const selection = selectTestsForSources([
    'platform/shared/pipeline-kernel.ts'
  ]);

  expect(selection.owners).toContain('pipeline-kernel');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/pipeline-pass-registry.test.ts',
    'tests/integration/pipeline-kernel.test.ts'
  ]));
  expect(selection.slow).toEqual(expect.arrayContaining([
    'tests/e2e/pipeline.test.ts',
    'tests/e2e/end-to-end.test.ts'
  ]));
});

test('pipeline test impact ownership selects Workbench coordinator coverage', () => {
  const selection = selectTestsForSources([
    'platform/orchestrator/workbench-compile-handler.ts'
  ]);

  expect(selection.owners).toContain('workbench-pipeline');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/workbench-server.test.ts',
    'tests/integration/workbench-pipeline.test.ts'
  ]));
});

test('pipeline test impact ownership selects Upgrade transaction coverage', () => {
  const selection = selectTestsForSources([
    'platform/upgrade/upgrade-workspace.ts'
  ]);

  expect(selection.owners).toContain('upgrade-pipeline');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/integration/upgrade-pipeline-kernel.test.ts',
    'tests/unit/upgrade-summary.test.ts'
  ]));
  expect(selection.slow).toEqual(expect.arrayContaining([
    'tests/e2e/upgrade.test.ts',
    'tests/e2e/dry-run-plan.test.ts'
  ]));
});
