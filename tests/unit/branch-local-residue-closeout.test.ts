import { expect, test } from 'bun:test';

import {
  parseMergedPullRequestHeadsV1,
  planMergedLocalBranchResidueCloseoutV1
} from '../../scripts/codex/branch-local-residue-closeout.ts';

const MAIN = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const MERGE = '3'.repeat(40);

function merged(branch = 'fix/example', headSha = HEAD) {
  return {
    number: 42,
    headBranch: branch,
    headSha,
    baseBranch: 'main',
    mergeCommitSha: MERGE,
    state: 'MERGED' as const,
    url: 'https://github.com/sec-platform/sec/pull/42'
  };
}

test('plans only exact merged local-only refs and protects worktree-owned branches', () => {
  const plan = planMergedLocalBranchResidueCloseoutV1({
    defaultBranch: 'main',
    localRefs: {
      main: MAIN,
      'fix/example': HEAD,
      'fix/current': MAIN,
      'fix/remote-survives': '4'.repeat(40),
      'fix/unknown': '5'.repeat(40)
    },
    remoteRefs: {
      main: MAIN,
      'fix/remote-survives': '4'.repeat(40)
    },
    worktreeBranches: ['main', 'fix/current'],
    mergedPullRequests: [merged()]
  });

  expect(plan).toEqual({
    eligible: [{
      branch: 'fix/example',
      headSha: HEAD,
      pullRequestNumber: 42,
      mergeCommitSha: MERGE,
      pullRequestUrl: 'https://github.com/sec-platform/sec/pull/42'
    }],
    protectedBranches: ['fix/current'],
    unresolvedBranches: ['fix/remote-survives', 'fix/unknown']
  });
});

test('prefixes never authorize a drifted PR, duplicate identity, or wrong base', () => {
  for (const mergedPullRequests of [
    [merged('fix/example', '6'.repeat(40))],
    [merged(), { ...merged(), number: 43, url: 'https://github.com/sec-platform/sec/pull/43' }],
    [{ ...merged(), baseBranch: 'release' }]
  ]) {
    expect(planMergedLocalBranchResidueCloseoutV1({
      defaultBranch: 'main',
      localRefs: { main: MAIN, 'fix/example': HEAD },
      remoteRefs: { main: MAIN },
      worktreeBranches: ['main'],
      mergedPullRequests
    })).toMatchObject({ eligible: [], unresolvedBranches: ['fix/example'] });
  }
});

test('parses canonical merged PR facts and rejects bounded-query saturation', () => {
  expect(parseMergedPullRequestHeadsV1(JSON.stringify([{
    number: 42,
    headRefName: 'fix/example',
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: 'https://github.com/sec-platform/sec/pull/42'
  }]))).toEqual([merged()]);

  const saturated = Array.from({ length: 1_000 }, (_, index) => ({
    number: index + 1,
    headRefName: `fix/example-${index}`,
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: `https://github.com/sec-platform/sec/pull/${index + 1}`
  }));
  expect(() => parseMergedPullRequestHeadsV1(JSON.stringify(saturated))).toThrow(/bounded 1000-item limit/u);
});
