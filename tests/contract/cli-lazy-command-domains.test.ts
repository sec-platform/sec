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

test('CLI lazy command domains memoize exact leaf owners rather than delayed broad barrels', async () => {
  const source = await readCompilerFile('platform/cli/lazy-command-domains.ts');

  expect(source).not.toContain("import('../compiler/index.ts')");
  expect(source).not.toContain("import('../orchestrator.ts')");
  expect(source).toContain('memoizedModule');
  expect(source).toContain('pending ??= load()');
  expect(source).toContain('Reflect.apply(fn, undefined, args)');

  for (const dynamicImport of [
    "import('../compiler/emit/ci-artifacts.ts')",
    "import('../compiler/parse/load-manifest.ts')",
    "import('../compiler/parse/load-plan.ts')",
    "import('../orchestrator/block-orchestrator.ts')",
    "import('../orchestrator/compose-orchestrator.ts')",
    "import('../orchestrator/emit-orchestrator.ts')",
    "import('../orchestrator/pipeline-orchestrator.ts')",
    "import('../orchestrator/repair-orchestrator.ts')",
    "import('../orchestrator/upgrade-orchestrator.ts')",
    "import('../orchestrator/verify-orchestrator.ts')",
    "import('../orchestrator/workbench-orchestrator.ts')",
    "import('../orchestrator/workbench-server-v2.ts')",
    "import('../orchestrator/workspace-orchestrator.ts')"
  ]) {
    expect(source).toContain(dynamicImport);
  }

  for (const facadeBinding of [
    "lazyFunction(loadBlockOrchestrator, 'addBlock')",
    "lazyFunction(loadBlockOrchestrator, 'resolveWorkspace')",
    "lazyFunction(loadComposeOrchestrator, 'adaptWorkspace')",
    "lazyFunction(loadComposeOrchestrator, 'composeWorkspace')",
    "lazyFunction(loadEmitOrchestrator, 'explainWorkspace')",
    "lazyFunction(loadPipelineOrchestrator, 'compileWorkspace')",
    "lazyFunction(loadWorkspaceOrchestrator, 'initWorkspace')"
  ]) {
    expect(source).toContain(facadeBinding);
  }
});

test('Codex tooling paths remain temporary compatibility loaders until #481 consumer cutover', async () => {
  const source = await readCompilerFile('platform/cli/lazy-command-domains.ts');
  expect(source).toContain("import('../../scripts/codex/text-byte-census.ts')");
  expect(source).toContain("import('../../scripts/codex/worktree-settlement.ts')");
  expect(source).toContain('PR #481');
});
