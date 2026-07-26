import { expect, test } from 'bun:test';

import { runCliInProcess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI overview reports missing required artifacts with refresh guidance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCliInProcess(workspaceRoot, ['overview']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('run the refresh chain, then bun run sec -- explain');
  });
});
