import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('repository maintenance keeps contract plan admission orchestration and effects physically separate', async () => {
  const [contract, plan, admission, orchestrator, effect] = await Promise.all([
    readCompilerFile('src/adapters/self-hosting/control/repository-maintenance/contract.ts'),
    readCompilerFile('src/adapters/self-hosting/control/repository-maintenance/plan.ts'),
    readCompilerFile('src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts'),
    readCompilerFile('src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts'),
    readCompilerFile('src/adapters/self-hosting/control/repository-maintenance/effect.ts')
  ]);

  expect(contract).not.toMatch(/providers\/github-api|node:fs|node:child_process|workflow_dispatch/u);
  expect(plan).not.toMatch(/providers\/|node:fs|node:child_process|retireExact|runClosed/u);
  expect(admission).toContain('workflow_dispatch');
  expect(admission).not.toMatch(/withGitHubApi|retireExact|runClosed/u);
  expect(orchestrator).toContain("from './plan.ts'");
  expect(orchestrator).toContain("from './effect.ts'");
  expect(orchestrator).not.toMatch(/providers\/github-api|retireExactRemoteRefs|runClosedUnmergedCloseoutCli/u);
  expect(effect).toContain('withGitHubApiBranchCloseoutWriteSession');
  expect(effect).toContain('retireExactRemoteRefs');
});
