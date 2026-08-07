import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  defaultBranchLifecycleCommandRunner,
  type BranchLifecycleContext
} from '../../scripts/codex/branch-lifecycle-command.ts';
import {
  checkCandidateTreeParity,
  resolveTreeSha
} from '../../scripts/codex/verification-candidate-tree.ts';

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

test('candidate tree parity matches merged tree only when trees are identical', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-candidate-tree-'));
  try {
    git(root, ['init', 'remote.git', '--bare']);
    git(root, ['clone', 'remote.git', 'repository']);
    const repository = path.join(root, 'repository');
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '-m', 'initial main']);
    git(repository, ['branch', '-M', 'main']);
    git(repository, ['push', '-u', 'origin', 'main']);

    const candidateTree = resolveTreeSha({
      repositoryRoot: repository,
      run: defaultBranchLifecycleCommandRunner
    } as BranchLifecycleContext, 'main');
    expect(candidateTree).toMatch(/^[0-9a-f]{40}$/u);

    const matched = checkCandidateTreeParity({
      checkedAt: '2026-08-07T00:00:00.000Z',
      repository: 'sec-platform/sec',
      sessionId: 'sess-tree',
      prNumber: 10,
      candidateTreeSha: candidateTree,
      mergedTreeSha: candidateTree
    });
    expect(matched.parity).toBe('matched');

    writeFileSync(path.join(repository, 'feature.txt'), 'feature\n', 'utf8');
    git(repository, ['add', 'feature.txt']);
    git(repository, ['commit', '-m', 'feature']);
    const driftedTree = resolveTreeSha({
      repositoryRoot: repository,
      run: defaultBranchLifecycleCommandRunner
    } as BranchLifecycleContext, 'HEAD');
    expect(driftedTree).not.toBe(candidateTree);

    const drift = checkCandidateTreeParity({
      checkedAt: '2026-08-07T00:00:00.000Z',
      repository: 'sec-platform/sec',
      sessionId: 'sess-tree',
      prNumber: 10,
      candidateTreeSha: candidateTree,
      mergedTreeSha: driftedTree
    });
    expect(drift.parity).toBe('drift');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
