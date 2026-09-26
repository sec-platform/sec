import path from 'node:path';

import { expect, test } from 'bun:test';

import { runRuntimeUnitProcess } from '../../src/adapters/verification/runtime-unit-process.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('runtime unit process executes through retained bounded process authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runRuntimeUnitProcess({
      workspaceRoot,
      command: path.resolve(process.execPath),
      args: ['--version'],
      environment: { ...process.env },
      isolated: false
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^1\./u);
    expect(result.stderr).toBe('');
  }, 'runtime-unit-process-');
});
