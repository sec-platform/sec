import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runSettlement } from '../../src/adapters/self-hosting/development/tooling/workspace/worktree-settlement.ts';

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
}

test('worktree settlement reads Git configuration from the requested repository root', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-settlement-root-'));
  try {
    git(repositoryRoot, ['init', '--quiet']);
    git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
    git(repositoryRoot, ['config', 'core.autocrlf', 'input']);
    git(repositoryRoot, ['config', 'core.eol', 'lf']);
    await fs.writeFile(path.join(repositoryRoot, '.gitattributes'), '*.ts text eol=lf\n');
    await fs.writeFile(path.join(repositoryRoot, 'fixture.ts'), 'export const fixture = true;\n');
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'fixture']);

    const receipt = await runSettlement(repositoryRoot);

    expect(receipt.repositoryRoot).toBe(path.resolve(repositoryRoot));
    expect(receipt.coreAutocrlf).toBe('input');
    expect(receipt.coreEol).toBe('lf');
    expect(receipt.status).toBe('settled');
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('worktree settlement preserves a typed authority block before any Git child', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-settlement-missing-root-'));
  const repositoryRoot = path.join(parent, 'missing');
  try {
    const receipt = await runSettlement(repositoryRoot);

    expect(receipt.status).toBe('unsafe');
    expect(receipt.totalFiles).toBe(0);
    expect(receipt.summary).toContain('Git read authority was unavailable');
    expect(receipt.summary).toMatch(/reason=git-executable-identity-unavailable/u);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('worktree settlement carries parent cancellation into its one GitRead operation', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-settlement-cancelled-'));
  try {
    git(repositoryRoot, ['init', '--quiet']);
    const controller = new AbortController();
    controller.abort(new Error('cancelled by focused test'));

    const receipt = await runSettlement(repositoryRoot, { signal: controller.signal });

    expect(receipt.status).toBe('unsafe');
    expect(receipt.gitVersion).toBe('<unavailable>');
    expect(receipt.summary).toContain('reason=git-session-cancelled');
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});
