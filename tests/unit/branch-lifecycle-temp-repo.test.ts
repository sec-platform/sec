import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  collectBranchLifecycleInventory,
  configureBranchLifecycleClone,
  defaultBranchLifecycleCommandRunner,
  finalizeBranchCloseout,
  finalizeMergedPullRequestCloseout,
  prepareBranchCloseout,
  prepareMergedPullRequestCloseout,
  verifyRecoveryAuthorityLive,
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
  // Real git bundle create/verify and fsync can exceed Bun's 5s default on
  // Windows, so this end-to-end closeout needs an explicit bounded window.
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-lifecycle-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  const linkedWorktree = path.join(root, 'candidate-worktree');
  const recoveryRoot = path.join(root, 'durable-recovery');
  let pullRequestState: 'OPEN' | 'MERGED' = 'OPEN';
  let activeState: 'active' | 'none' = 'active';
  let createdCommentBody: string | null = null;

  try {
    git(root, ['init', '--bare', remote]);
    git(root, ['clone', remote, repository]);
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
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
          isCrossRepository: false,
          url: 'https://github.com/sec-platform/sec/pull/7'
        }];
        return {
          status: 0,
          stdout: Buffer.from(JSON.stringify(payload)),
          stderr: Buffer.alloc(0)
        };
      }
      if (command === 'gh' && args[0] === 'api') {
        const joined = args.join(' ');
        if (joined.includes('/permission')) {
          return {
            status: 0,
            stdout: Buffer.from('admin\n'),
            stderr: Buffer.alloc(0)
          };
        }
        if (joined.includes(' -X POST ')) {
          const body = args[args.indexOf('-f') + 1]!.slice('body='.length);
          createdCommentBody = body;
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify({
              id: 4242,
              body,
              user: { login: 'QzCrane' },
              author_association: 'OWNER'
            })),
            stderr: Buffer.alloc(0)
          };
        }
        if (/\/issues\/comments\/\d+$/u.test(joined) && createdCommentBody !== null) {
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify({
              id: 4242,
              body: createdCommentBody,
              user: { login: 'QzCrane' },
              author_association: 'OWNER'
            })),
            stderr: Buffer.alloc(0)
          };
        }
        if (joined.includes(' /repos/sec-platform/sec ') && joined.includes(' --jq ')) {
          return {
            status: 0,
            stdout: Buffer.from('true\n'),
            stderr: Buffer.alloc(0)
          };
        }
        return {
          status: 0,
          stdout: Buffer.from('[]\n'),
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
    const pruneConfiguration = configureBranchLifecycleClone(ctx);
    expect(pruneConfiguration.fetchPrune).toBe(true);
    expect(pruneConfiguration.remotePrune).toBe(true);
    expect(pruneConfiguration.fetchPruneTags).toBe(true);

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
    expect(receipt.authorization.localAction).toBe('protect-local');
    expect(git(repository, ['ls-remote', '--heads', 'origin', 'feat/exact-closeout'])).toBe('');
    expect(git(repository, ['rev-parse', '--verify', 'refs/heads/feat/exact-closeout'])).toBe(headSha);
    expect(readFileSync(path.join(linkedWorktree, 'feature.txt'), 'utf8')).toContain('user-owned change');
    expect(existsSync(`${prepared.preparation.recovery.path}.receipt.json`)).toBe(true);

    writeFileSync(prepared.preparation.recovery.path, 'tampered recovery', 'utf8');
    const tamperedRecovery = verifyRecoveryAuthorityLive({
      ctx,
      inventory: collectBranchLifecycleInventory(ctx),
      recovery: prepared.preparation.recovery
    });
    expect(tamperedRecovery.status).toBe('failed');
    expect(tamperedRecovery.detail).toContain('digest mismatch');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, {
  timeout: 120_000
});

test('orphan remote closeout completes while the active candidate is preserved', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-orphan-closeout-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  const linkedWorktree = path.join(root, 'candidate-worktree');
  const recoveryRoot = path.join(root, 'durable-recovery');
  let activeState: 'active' | 'none' = 'active';

  try {
    git(root, ['init', '--bare', remote]);
    git(root, ['clone', remote, repository]);
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '-m', 'initial main']);
    git(repository, ['branch', '-M', 'main']);
    git(repository, ['push', '-u', 'origin', 'main']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(repository, ['remote', 'set-head', 'origin', '-a']);

    git(repository, ['branch', 'probe/stale']);
    git(repository, ['push', '-u', 'origin', 'probe/stale']);
    const probeSha = git(repository, ['rev-parse', 'probe/stale']);

    git(repository, ['branch', 'feat/exact-closeout']);
    git(repository, ['worktree', 'add', linkedWorktree, 'feat/exact-closeout']);
    writeFileSync(path.join(linkedWorktree, 'feature.txt'), 'feature\n', 'utf8');
    git(linkedWorktree, ['add', 'feature.txt']);
    git(linkedWorktree, ['commit', '-m', 'feature']);
    git(linkedWorktree, ['push', '-u', 'origin', 'feat/exact-closeout']);
    const candidateSha = git(linkedWorktree, ['rev-parse', 'HEAD']);

    const run: BranchLifecycleCommandRunner = (command, args, options) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        const payload = [{
          number: 7,
          headRefName: 'feat/exact-closeout',
          headRefOid: candidateSha,
          baseRefName: 'main',
          state: 'open',
          isDraft: false,
          isCrossRepository: false,
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
    const pruneConfiguration = configureBranchLifecycleClone(ctx);
    expect(pruneConfiguration.fetchPrune).toBe(true);
    expect(pruneConfiguration.remotePrune).toBe(true);
    expect(pruneConfiguration.fetchPruneTags).toBe(true);

    const prepared = prepareBranchCloseout(ctx, {
      branch: 'probe/stale',
      expectedHeadSha: probeSha
    });
    expect(prepared.preparation.recovery.path.startsWith(recoveryRoot)).toBe(true);
    expect(existsSync(prepared.preparation.recovery.path)).toBe(true);

    const receipt = finalizeBranchCloseout(ctx, {
      prepared,
      disposition: 'completed-spike',
      durableGoal: { kind: 'issue', reference: 'sec-platform/sec#269' }
    });
    expect(receipt.status).toBe('completed');
    expect(receipt.authorization.remoteAction).toBe('delete-cas');
    expect(receipt.authorization.classification).toBe('orphan-unknown');
    expect(git(repository, ['ls-remote', '--heads', 'origin', 'probe/stale'])).toBe('');
    expect(git(repository, ['ls-remote', '--heads', 'origin', 'feat/exact-closeout']))
      .toContain(candidateSha);
    expect(existsSync(`${prepared.preparation.recovery.path}.receipt.json`)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, {
  timeout: 120_000
});

test('post-merge absent head closes out through pull-ref recovery after delete-branch-on-merge', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-post-merge-absent-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  const recoveryRoot = path.join(root, 'durable-recovery');
  let pullRequestState: 'OPEN' | 'MERGED' | 'CLOSED' = 'MERGED';

  try {
    git(root, ['init', '--bare', remote]);
    git(root, ['clone', remote, repository]);
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '-m', 'initial main']);
    git(repository, ['branch', '-M', 'main']);
    git(repository, ['push', '-u', 'origin', 'main']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(repository, ['remote', 'set-head', 'origin', '-a']);

    git(repository, ['switch', '-c', 'feat/post-merged']);
    writeFileSync(path.join(repository, 'feature.txt'), 'feature\n', 'utf8');
    git(repository, ['add', 'feature.txt']);
    git(repository, ['commit', '-m', 'feature']);
    git(repository, ['push', '-u', 'origin', 'feat/post-merged']);
    const headSha = git(repository, ['rev-parse', 'HEAD']);
    git(repository, ['switch', 'main']);
    const mainSha = git(repository, ['rev-parse', 'main']);
    const remoteHeadSha = git(remote, ['rev-parse', 'refs/heads/feat/post-merged']);
    expect(remoteHeadSha).toBe(headSha);
    git(remote, ['update-ref', 'refs/pull/8/head', remoteHeadSha]);

    const run: BranchLifecycleCommandRunner = (command, args, options) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        const payload = [{
          number: 8,
          headRefName: 'feat/post-merged',
          headRefOid: headSha,
          baseRefName: 'main',
          baseRefOid: mainSha,
          state: pullRequestState,
          isDraft: false,
          isCrossRepository: false,
          url: 'https://github.com/sec-platform/sec/pull/8'
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
          activeWorkPackage: { state: 'none', reason: 'matching-default-blob' },
          workspace: { branch: 'main' }
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
    configureBranchLifecycleClone(ctx);

    git(repository, ['merge', '--squash', 'feat/post-merged']);
    git(repository, ['commit', '-m', 'merge feature']);
    git(repository, ['push', 'origin', 'main']);
    git(repository, ['push', 'origin', '--delete', 'feat/post-merged']);
    git(repository, ['branch', '-D', 'feat/post-merged']);

    const prepared = prepareBranchCloseout(ctx, {
      branch: 'feat/post-merged',
      refState: 'absent',
      expectedHeadSha: headSha,
      pullRequestNumber: 8
    });
    expect(prepared.preparation.refState).toBe('absent');
    expect(prepared.preparation.expectedHeadSha).toBe(headSha);
    expect(prepared.preparation.expectedPrHeadSha).toBe(headSha);
    expect(prepared.preparation.expectedLocalSha).toBeNull();
    expect(prepared.preparation.recovery.verified).toBe(true);
    expect(existsSync(prepared.preparation.recovery.path)).toBe(true);
    git(repository, ['bundle', 'verify', prepared.preparation.recovery.path]);

    const receipt = finalizeBranchCloseout(ctx, {
      prepared,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${git(repository, ['rev-parse', 'HEAD'])}` }
    });
    expect(receipt.status).toBe('completed');
    expect(receipt.authorization.remoteAction).toBe('already-absent');
    expect(receipt.authorization.localAction).toBe('already-absent');
    expect(receipt.attempts.some(({ operation, status }) => (
      operation === 'readback' && status === 'success'
    ))).toBe(true);
    expect(existsSync(`${prepared.preparation.recovery.path}.receipt.json`)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, {
  timeout: 120_000
});

test('closed-unmerged absent ref settles by reusing its verified recovery bundle', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-closed-absent-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  const recoveryRoot = path.join(root, 'durable-recovery');
  let pullRequestState: 'OPEN' | 'MERGED' | 'CLOSED' = 'CLOSED';

  try {
    git(root, ['init', '--bare', remote]);
    git(root, ['clone', remote, repository]);
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '-m', 'initial main']);
    git(repository, ['branch', '-M', 'main']);
    git(repository, ['push', '-u', 'origin', 'main']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(repository, ['remote', 'set-head', 'origin', '-a']);

    git(repository, ['switch', '-c', 'fix/drifted-closed']);
    writeFileSync(path.join(repository, 'fix.txt'), 'fix\n', 'utf8');
    git(repository, ['add', 'fix.txt']);
    git(repository, ['commit', '-m', 'fix']);
    git(repository, ['push', '-u', 'origin', 'fix/drifted-closed']);
    const refHeadSha = git(repository, ['rev-parse', 'HEAD']);
    git(repository, ['switch', 'main']);
    const mainSha = git(repository, ['rev-parse', 'main']);
    const recordedPrHeadSha = '8cf47aafadbdeb4d5983f06b50bba83950e0084c';

    const run: BranchLifecycleCommandRunner = (command, args, options) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        const payload = [{
          number: 9,
          headRefName: 'fix/drifted-closed',
          headRefOid: recordedPrHeadSha,
          baseRefName: 'main',
          baseRefOid: mainSha,
          state: pullRequestState,
          isDraft: false,
          isCrossRepository: false,
          url: 'https://github.com/sec-platform/sec/pull/9'
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
          activeWorkPackage: { state: 'none', reason: 'matching-default-blob' },
          workspace: { branch: 'main' }
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
    configureBranchLifecycleClone(ctx);

    // The durable bundle is created by a present-ref preparation without a PR
    // binding (the real protected-pending bundle for fix/issue-280 was created
    // the same way because the PR-recorded head had drifted from the ref).
    const durable = prepareBranchCloseout(ctx, {
      branch: 'fix/drifted-closed',
      expectedHeadSha: refHeadSha
    });
    expect(existsSync(durable.preparation.recovery.path)).toBe(true);

    git(repository, ['push', 'origin', '--delete', 'fix/drifted-closed']);
    git(repository, ['branch', '-D', 'fix/drifted-closed']);

    const prepared = prepareBranchCloseout(ctx, {
      branch: 'fix/drifted-closed',
      refState: 'absent',
      expectedHeadSha: refHeadSha,
      expectedPrHeadSha: recordedPrHeadSha,
      pullRequestNumber: 9
    });
    expect(prepared.preparation.refState).toBe('absent');
    expect(prepared.preparation.expectedPrHeadSha).toBe(recordedPrHeadSha);
    expect(prepared.preparation.recovery.path).toBe(durable.preparation.recovery.path);
    expect(prepared.attempts.some(({ operation }) => operation === 'recovery-create')).toBe(true);

    const receipt = finalizeBranchCloseout(ctx, {
      prepared,
      disposition: 'closed-superseded',
      durableGoal: { kind: 'issue', reference: 'sec-platform/sec#280' }
    });
    expect(receipt.status).toBe('completed');
    expect(receipt.authorization.classification).toBe('closed-superseded');
    expect(receipt.authorization.remoteAction).toBe('already-absent');
    expect(receipt.authorization.localAction).toBe('already-absent');
    expect(existsSync(`${prepared.preparation.recovery.path}.receipt.json`)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, {
  timeout: 120_000
});

test('absent-ref preparation fails closed against a surviving ref or unrecoverable closed PR', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-absent-negative-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  const recoveryRoot = path.join(root, 'durable-recovery');

  try {
    git(root, ['init', '--bare', remote]);
    git(root, ['clone', remote, repository]);
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '-m', 'initial main']);
    git(repository, ['branch', '-M', 'main']);
    git(repository, ['push', '-u', 'origin', 'main']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(repository, ['remote', 'set-head', 'origin', '-a']);

    git(repository, ['branch', 'feat/surviving']);
    writeFileSync(path.join(repository, 'feature.txt'), 'feature\n', 'utf8');
    git(repository, ['add', 'feature.txt']);
    git(repository, ['commit', '-m', 'feature']);
    git(repository, ['push', '-u', 'origin', 'feat/surviving']);
    const survivingSha = git(repository, ['rev-parse', 'HEAD']);
    const mainSha = git(repository, ['rev-parse', 'main']);

    const closedSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    git(repository, ['branch', 'fix/gone-no-bundle']);
    git(repository, ['push', '-u', 'origin', 'fix/gone-no-bundle']);
    git(repository, ['push', 'origin', '--delete', 'fix/gone-no-bundle']);
    git(repository, ['branch', '-D', 'fix/gone-no-bundle']);

    const run: BranchLifecycleCommandRunner = (command, args, options) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        const payload = [
          {
            number: 10,
            headRefName: 'feat/surviving',
            headRefOid: survivingSha,
            baseRefName: 'main',
            baseRefOid: mainSha,
            state: 'CLOSED',
            isDraft: false,
            isCrossRepository: false,
            url: 'https://github.com/sec-platform/sec/pull/10'
          },
          {
            number: 11,
            headRefName: 'fix/gone-no-bundle',
            headRefOid: closedSha,
            baseRefName: 'main',
            baseRefOid: mainSha,
            state: 'CLOSED',
            isDraft: false,
            isCrossRepository: false,
            url: 'https://github.com/sec-platform/sec/pull/11'
          }
        ];
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
          activeWorkPackage: { state: 'none', reason: 'matching-default-blob' },
          workspace: { branch: 'main' }
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
    configureBranchLifecycleClone(ctx);

    expect(() => prepareBranchCloseout(ctx, {
      branch: 'feat/surviving',
      refState: 'absent',
      expectedHeadSha: survivingSha,
      pullRequestNumber: 10
    })).toThrow(/surviving remote branch/);

    expect(() => prepareBranchCloseout(ctx, {
      branch: 'fix/gone-no-bundle',
      refState: 'absent',
      expectedHeadSha: closedSha,
      pullRequestNumber: 11
    })).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, {
  timeout: 120_000
});
