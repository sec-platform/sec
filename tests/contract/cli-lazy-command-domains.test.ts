import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('CLI command registration does not eagerly import heavy command domains', async () => {
  const source = await readCompilerFile('platform/cli/register-commands.ts');

  expect(source).toContain("from './lazy-command-domains.ts'");
  expect(source).not.toContain("from '../../scripts/codex/text-byte-census.ts'");
  expect(source).not.toContain("from '../../scripts/codex/worktree-settlement.ts'");
  expect(source).not.toContain("from '../compiler/index.ts'");
  expect(source).not.toContain("from '../orchestrator.ts'");
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
});
