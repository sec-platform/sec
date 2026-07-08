import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { getSlowTestSuitesSync } from '../../platform/shared/test-budget-contract.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';

test('locked workspace cold-build suites do not run in the standard parallel PR risk pool', () => {
  const offenders = getSlowTestSuitesSync()
    .filter((suite) => suite.files.some((file) => fs.readFileSync(path.join(compilerRoot, file), 'utf8').includes('prepareLockedWorkspace')))
    .filter((suite) => suite.parallelSafe && suite.resourceClass === 'standard')
    .map((suite) => suite.id);
  expect(offenders).toEqual([]);
});
