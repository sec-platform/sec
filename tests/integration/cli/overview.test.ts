import { expect, test } from 'bun:test';

import { runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('CLI overview reports missing required artifacts with refresh guidance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCliInProcess(workspaceRoot, ['overview']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/\bLock file\b.*\bmissing\b/i);
    expect(result.stderr).toMatch(/\brefresh\b/i);
    expect(result.stderr).toContain('bun run sec -- explain');
  });
});
