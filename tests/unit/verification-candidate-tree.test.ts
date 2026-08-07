import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import {
  collectOpenPullRequestEntries,
  parseOpenPullRequestList
} from '../../scripts/codex/verification-session.ts';

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

test('registry projection discovers open-PR manifest entries from pull refs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-registry-openpr-'));
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
    const baseSha = git(repository, ['rev-parse', 'main']);
    const remote = path.join(root, 'remote.git');

    git(repository, ['switch', '-c', 'feat/session']);
    mkdirSync(path.join(repository, 'docs/work-packages'), { recursive: true });
    writeFileSync(
      path.join(repository, 'docs/work-packages/candidate-v1.md'),
      '---\nschema: codex-development-work-package-v1\nid: candidate-v1\nbase: 0000000000000000000000000000000000000000\n---\n',
      'utf8'
    );
    git(repository, ['add', 'docs/work-packages/candidate-v1.md']);
    git(repository, ['commit', '-m', 'candidate manifest']);
    const headSha = git(repository, ['rev-parse', 'HEAD']);
    git(repository, ['push', '-u', 'origin', 'feat/session']);
    git(remote, ['update-ref', 'refs/pull/11/head', headSha]);
    git(repository, ['switch', 'main']);

    const parsed = parseOpenPullRequestList(JSON.stringify([{
      number: 11,
      headRefName: 'feat/session',
      headRefOid: headSha,
      baseRefOid: baseSha,
      body: 'Work-Package: docs/work-packages/candidate-v1.md'
    }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.number).toBe(11);

    const ctx = {
      repositoryRoot: repository,
      run: defaultBranchLifecycleCommandRunner
    } as BranchLifecycleContext;
    const entries = collectOpenPullRequestEntries(ctx, parsed);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe('open-pr');
    expect(entries[0]!.prNumber).toBe(11);
    expect(entries[0]!.headSha).toBe(headSha);
    expect(entries[0]!.baseSha).toBe(baseSha);
    expect(entries[0]!.headTreeSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(entries[0]!.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('open PR entry without a Work-Package locator fails closed', () => {
  expect(() => parseOpenPullRequestList(JSON.stringify([{
    number: 12,
    headRefName: 'feat/no-locator',
    headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    baseRefOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    body: 'no locator here'
  }]))).not.toThrow();
  const parsed = parseOpenPullRequestList(JSON.stringify([{
    number: 12,
    headRefName: 'feat/no-locator',
    headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    baseRefOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    body: 'no locator here'
  }]));
  expect(() => collectOpenPullRequestEntries({
    repositoryRoot: 'unused',
    run: defaultBranchLifecycleCommandRunner
  } as BranchLifecycleContext, parsed)).toThrow('exactly one Work-Package locator');
});
