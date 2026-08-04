import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  defaultBranchLifecycleCommandRunner,
  finalizeMergedPullRequestCloseout,
  prepareMergedPullRequestCloseout,
  type BranchLifecycleCommandRunner
} from '../../scripts/codex/branch-lifecycle.ts';

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

test('temporary repository closeout deletes the remote exact ref and protects dirty worktree state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-lifecycle-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  const linkedWorktree = path.join(root, 'candidate-worktree');
  const recoveryRoot = path.join(root, 'durable-recovery');
  let pullRequestState: 'OPEN' | 'MERGED' = 'OPEN';
  let activeState: 'active' | 'none' = 'active';

  try {
    git(root, ['init', '--bare', remote]);
    git(root, ['clone', remote, repository]);
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
    git(repository, ['config', 'fetch.prune', 'true']);
    git(repository, ['config', 'fetch.pruneTags', 'true']);
    git(repository, ['config', 'remote.origin.prune', 'true']);

    writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '-m', 'initial main']);
    git(repository, ['branch', '-M', 'main']);
    git(repository, ['push', '-u', 'origin', 'main']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(repository, ['remote', 'set-head', 'origin', '-a']);

    git(repository, ['branch', 'feat/exact-closeout']);
    git(repository, ['worktree', 'add', linkedWorktree, 'feat/exact-closeout']);
    writeFileSync(path.join(linkedWorktree, 'feature.txt'), 'feature\n', 'utf8');
    git(linkedWorktree, ['add', 'feature.txt']);
    git(linkedWorktree, ['commit', '-m', 'feature']);
    git(linkedWorktree, ['push', '-u', 'origin', 'feat/exact-closeout']);
    const headSha = git(linkedWorktree, ['rev-parse', 'HEAD']);

    writeFileSync(path.join(linkedWorktree, 'feature.txt'), 'feature\nuser-owned change\n', 'utf8');

    const run: BranchLifecycleCommandRunner = (command, args, options) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        const payload = [{
          number: 7,
          headRefName: 'feat/exact-closeout',
          headRefOid: headSha,
          baseRefName: 'main',
          state: pullRequestState,
          isDraft: false,
          url: 'https://github.com/sec-platform/sec/pull/7'
        }];
        return {
          status: 0,
          stdout: Buffer.from(JSON.stringify(payload)),
          stderr: Buffer.alloc(0)
        };
      }
      if (command === 'gh' && args[0] === 'api') {
        return {
          status: 0,
          stdout: Buffer.from('true\n'),
          stderr: Buffer.alloc(0)
        };
      }
      if (command === 'bun') {
        const payload = {
          activeWorkPackage: activeState === 'active'
            ? {
                state: 'active',
                manifest: 'docs/work-packages/example-v1.md',
                manifestDigest: `sha256:${'a'.repeat(64)}`
              }
            : { state: 'none', reason: 'matching-default-blob' },
          workspace: {
            branch: activeState === 'active' ? 'feat/exact-closeout' : 'main'
          }
        };
        return {
          status: 0,
          stdout: Buffer.from(JSON.stringify(payload)),
          stderr: Buffer.alloc(0)
        };
      }
      return defaultBranchLifecycleCommandRunner(command, args, options);
    };

    const ctx = {
      repositoryRoot: repository,
      run,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      recoveryRoot
    };
    const prepared = prepareMergedPullRequestCloseout(ctx, {
      number: 7,
      headBranch: 'feat/exact-closeout',
      headSha
    });
    expect(prepared.preparation.recovery.path.startsWith(recoveryRoot)).toBe(true);
    expect(existsSync(prepared.preparation.recovery.path)).toBe(true);
    git(repository, ['bundle', 'verify', prepared.preparation.recovery.path]);

    git(repository, ['merge', '--squash', 'feat/exact-closeout']);
    git(repository, ['commit', '-m', 'merge feature']);
    git(repository, ['push', 'origin', 'main']);
    const newMainSha = git(repository, ['rev-parse', 'HEAD']);
    pullRequestState = 'MERGED';
    activeState = 'none';

    const receipt = finalizeMergedPullRequestCloseout(ctx, prepared, newMainSha);
    expect(receipt.status).toBe('protected-pending');
    expect(receipt.authorization.remoteAction).toBe('delete-cas');
    expect(receipt.authorization.localAction).toBe('protect-worktree');
    expect(git(repository, ['ls-remote', '--heads', 'origin', 'feat/exact-closeout'])).toBe('');
    expect(git(repository, ['rev-parse', '--verify', 'refs/heads/feat/exact-closeout'])).toBe(headSha);
    expect(readFileSync(path.join(linkedWorktree, 'feature.txt'), 'utf8')).toContain('user-owned change');
    expect(existsSync(`${prepared.preparation.recovery.path}.receipt.json`)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
