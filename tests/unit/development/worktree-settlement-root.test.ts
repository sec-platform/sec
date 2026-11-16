import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runSettlement } from '../../../src/adapters/self-hosting/development/tooling/workspace/worktree-settlement.ts';

test('worktree settlement reports an unavailable authority for a missing root', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-settlement-missing-root-'));
  const repositoryRoot = path.join(parent, 'missing');
  await settleWorkspaceCallback(async () => {
    const receipt = await runSettlement(repositoryRoot);

    expect(receipt.status).toBe('unsafe');
    expect(receipt.totalFiles).toBe(0);
    expect(receipt.summary).toContain('Git read authority was unavailable');
    expect(receipt.summary).toMatch(/reason=git-executable-identity-unavailable/u);
  }, async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });
});

test('worktree settlement carries parent cancellation into its one GitRead operation', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-settlement-cancelled-'));
  await settleWorkspaceCallback(async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by focused test'));

    const receipt = await runSettlement(repositoryRoot, { signal: controller.signal });

    expect(receipt.status).toBe('unsafe');
    expect(receipt.gitVersion).toBe('<unavailable>');
    expect(receipt.summary).toContain('reason=git-session-cancelled');
  }, async () => {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  });
});
