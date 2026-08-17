import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('CLI command registration does not eagerly import heavy command domains', async () => {
  const commandRegistration = await readCompilerFile('platform/cli/register-commands.ts');
  const pipelineRegistration = await readCompilerFile('platform/cli/register-pipeline-commands.ts');

  expect(commandRegistration).toContain("from './lazy-command-domains.ts'");
  expect(commandRegistration).not.toContain("from '../../scripts/codex/text-byte-census.ts'");
  expect(commandRegistration).not.toContain("from '../../scripts/codex/worktree-settlement.ts'");
  expect(commandRegistration).not.toContain("from '../compiler/index.ts'");
  expect(commandRegistration).not.toContain("from '../orchestrator.ts'");

  expect(pipelineRegistration).toContain("from './lazy-command-domains.ts'");
  expect(pipelineRegistration).not.toContain("from '../orchestrator.ts'");
});

test('ordinary engineering scripts import exact orchestrator owners instead of the broad facade', async () => {
  const fastWorkspace = await readCompilerFile('scripts/ci-workspace-fast.ts');
  const referenceCompile = await readCompilerFile('scripts/compile-reference-workspace.ts');

  expect(fastWorkspace).not.toContain("from '../platform/orchestrator.ts'");
  expect(fastWorkspace).toContain("from '../platform/orchestrator/block-orchestrator.ts'");
  expect(fastWorkspace).toContain("from '../platform/orchestrator/compose-orchestrator.ts'");
  expect(fastWorkspace).toContain("from '../platform/orchestrator/verify-orchestrator.ts'");
  expect(fastWorkspace).toContain("from '../platform/orchestrator/workspace-orchestrator.ts'");

  expect(referenceCompile).not.toContain("from '../platform/orchestrator.ts'");
  expect(referenceCompile).toContain("from '../platform/orchestrator/pipeline-orchestrator.ts'");
});

test('CLI lazy command domains load on first use and memoize each runtime module', async () => {
  const source = await readCompilerFile('platform/cli/lazy-command-domains.ts');

  for (const dynamicImport of [
    "import('../compiler/index.ts')",
    "import('../orchestrator.ts')",
    "import('../../scripts/codex/text-byte-census.ts')",
    "import('../../scripts/codex/worktree-settlement.ts')"
  ]) {
    expect(source).toContain(dynamicImport);
  }
  for (const promiseOwner of [
    'compilerModulePromise ??=',
    'orchestratorModulePromise ??=',
    'textByteCensusModulePromise ??=',
    'worktreeSettlementModulePromise ??='
  ]) {
    expect(source).toContain(promiseOwner);
  }
  expect(source).toContain("lazyFunction(loadOrchestratorDomain, 'compileWorkspace')");
});
