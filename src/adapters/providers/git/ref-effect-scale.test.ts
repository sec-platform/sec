import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { withWorkspaceWriteLease } from '../../filesystem/write-lease.ts';
import { assertGitLocalRefDeleteBatchReceipt, deleteExactLocalGitRefs } from './ref-effect.ts';
import { closeProvider, fixture, git, openProvider } from './test/ref-effect-fixture.ts';

test('GitRefEffect exact local observation ignores unrelated refs beyond the old stdout cap', async () => {
  const root = fixture();
  try {
    const sha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['branch', 'target']);
    const noise = Array.from({ length: 700 }, (_, index) => [
      `create refs/heads/noise-${String(index).padStart(4, '0')}-${'x'.repeat(55)} ${sha}`,
      `create refs/heads/absent/child-${String(index).padStart(4, '0')}-${'x'.repeat(55)} ${sha}`
    ]).flat().join('\n') + '\n';
    const created = spawnSync('git', ['update-ref', '--stdin'], {
      cwd: root, input: noise, encoding: 'utf8', windowsHide: true
    });
    expect(created.status).toBe(0);
    const wholeInventory = spawnSync('git', [
      'for-each-ref', '--format=%(refname)%00%(symref)%00%(objectname)%00', 'refs/heads/'
    ], { cwd: root, encoding: 'buffer', windowsHide: true });
    expect(wholeInventory.status).toBe(0);
    expect(wholeInventory.stdout.byteLength).toBeGreaterThan(128 * 1024);
    const absent = spawnSync('git', ['for-each-ref', '--stdin', '--format=%(refname)'], {
      cwd: root, input: 'refs/[h]eads/absent\n', encoding: 'utf8', windowsHide: true
    });
    expect(absent.status).toBe(0);
    expect(absent.stdout).toBe('');
    const exact = spawnSync('git', ['for-each-ref', '--stdin', '--format=%(refname)'], {
      cwd: root, input: 'refs/[h]eads/target\n', encoding: 'utf8', windowsHide: true
    });
    expect(exact.status).toBe(0);
    expect(exact.stdout).toBe('refs/heads/target\n');
    const opened = openProvider(root);
    try {
      const receipt = await withWorkspaceWriteLease(path.join(root, '.git'), undefined, (coordinatedLease) => (
        deleteExactLocalGitRefs({ provider: opened.provider, coordinatedLease,
          entries: [{ ref: 'refs/heads/target', expectedOldSha: sha }] })
      ));
      assertGitLocalRefDeleteBatchReceipt(receipt);
      expect(receipt.entries.map((entry) => entry.ref)).toEqual(['refs/heads/target']);
      expect(git(root, ['show-ref', '--verify', 'refs/heads/noise-0000-' + 'x'.repeat(55)])).toContain(sha);
      expect(spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/target'], { cwd: root }).status).toBe(1);
    } finally { closeProvider(opened); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
