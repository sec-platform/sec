import { expect, test } from 'bun:test';

import { buildCiContract } from '../../platform/shared/ci-contract.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('GitHub validation workflows cover CI gates with read-only responsibilities', async () => {
  const prWorkflow = await readCompilerFile('.github/workflows/compiler-pr-validation.yml');
  const releaseWorkflow = await readCompilerFile('.github/workflows/compiler-release-validation.yml');
  const legacyWorkflow = await readCompilerFile('.github/workflows/compiler-validation.yml');
  const contract = buildCiContract();
  const slowSuiteCommands = contract.fullLaneCommands.filter((command) => command.startsWith('bun run test:slow -- --suite '));
  const materializedReleaseCommands = contract.fullLaneCommands.filter(
    (command) => !slowSuiteCommands.includes(command)
  );

  expect(contract.prQuickLaneCommands.filter((command) => !prWorkflow.includes(command))).toEqual([]);
  expect(contract.prRiskLaneCommands.filter((command) => !prWorkflow.includes(command))).toEqual([]);
  expect(materializedReleaseCommands.filter((command) => !releaseWorkflow.includes(command))).toEqual([]);

  expect(prWorkflow).toContain('contents: read');
  expect(prWorkflow).toContain('github.event.pull_request.base.sha');
  expect(prWorkflow).toContain('bun run imports:check');
  expect(prWorkflow).not.toContain('contents: write');
  expect(prWorkflow).not.toContain('imports:organize');

  expect(slowSuiteCommands.length).toBeGreaterThan(0);
  expect(releaseWorkflow).toContain('contents: read');
  expect(releaseWorkflow).toContain('bun run imports:check');
  expect(releaseWorkflow).toContain('compiler-release-slow-matrix');
  expect(releaseWorkflow).toContain('slowTestSuiteIds');
  expect(releaseWorkflow).toContain('suite: ${{ fromJSON(needs.compiler-release-slow-matrix.outputs.suites) }}');
  expect(releaseWorkflow).toContain('bun run test:slow -- --suite ${{ matrix.suite }}');
  expect(releaseWorkflow).not.toContain('contents: write');
  expect(releaseWorkflow).not.toContain('imports:organize');

  expect(legacyWorkflow).toContain('compiler-validation-legacy');
  expect(legacyWorkflow).toContain('Retired. Use compiler-pr-validation or compiler-release-validation.');
  expect(legacyWorkflow).not.toContain('compiler-pr-quick');
  expect(legacyWorkflow).not.toContain('compiler-release-preflight');
});
