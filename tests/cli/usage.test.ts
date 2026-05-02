import { test } from 'bun:test';

import { expectCliText, expectCliUsageError } from '../helpers/cli-helpers.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

test('CLI prints help for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    for (const args of [[], ['unknown'], ['unknown', '--flag']]) {
      await expectCliText(workspaceRoot, args, [
        'Usage: platform',
        'init',
        'resolve',
        'compose',
        'verify'
      ]);
    }
  });
});

test('CLI reports argument usage errors', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliUsageError(workspaceRoot, 'init', ['--unknown'], '');
    await expectCliUsageError(workspaceRoot, 'add', [], '');
    await expectCliUsageError(workspaceRoot, 'repair', ['--extra'], '');
    await expectCliUsageError(workspaceRoot, 'upgrade', [], '');
    await expectCliUsageError(workspaceRoot, 'verify', ['--lane', 'slow'], '');
    await expectCliUsageError(workspaceRoot, 'resolve', ['--extra'], '');
    await expectCliUsageError(workspaceRoot, 'compose', ['--extra'], '');
    await expectCliUsageError(workspaceRoot, 'adapt', ['--extra'], '');
    await expectCliUsageError(workspaceRoot, 'lock', ['--json'], '');
    await expectCliUsageError(workspaceRoot, 'explain', ['--extra'], '');
    await expectCliUsageError(workspaceRoot, 'doctor', ['--extra'], '');
    await expectCliUsageError(workspaceRoot, 'workbench', [], '');
    await expectCliUsageError(workspaceRoot, 'workbench', ['mutations'], '');
    await expectCliUsageError(workspaceRoot, 'workbench', ['mutations', 'apply', '--extra'], '');
  });
});
