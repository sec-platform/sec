import { expect, test } from 'bun:test';
import {
  parseMergedPullRequestHeads,
  parseRepositoryProviderObservation,
  planMergedLocalBranchResidueCloseout
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-local-residue-closeout.ts';

// This contract is pure: historical PR records and refs are explicit inputs.
// Native Git Effects and crash recovery remain in the original slow suite.
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

test('prefixes never authorize a drifted PR, duplicate identity, or wrong base', () => {
  for (const mergedPullRequests of [
    [merged('fix/example', '6'.repeat(40))],
    [merged(), { ...merged(), number: 43, url: 'https://github.com/sec-platform/sec/pull/43' }],
    [{ ...merged(), baseBranch: 'release' }]
  ]) {
    expect(planMergedLocalBranchResidueCloseout({
      defaultBranch: 'main',
      localRefs: { main: MAIN, 'fix/example': HEAD },
      remoteRefs: { main: MAIN },
      worktreeBranches: ['main'],
      worktreeRoots: ['D:\\Project\\sec'],
      mergedPullRequests
    })).toMatchObject({ eligible: [], unresolvedBranches: ['fix/example'] });
  }
});

test('merged PR parsing rejects bounded-query saturation', () => {
  const saturated = Array.from({ length: 1_000 }, (_, index) => ({
    number: index + 1,
    headRefName: `fix/example-${index}`,
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: `https://github.com/sec-platform/sec/pull/${index + 1}`
  }));
  expect(() => parseMergedPullRequestHeads(
    JSON.stringify(saturated),
    'sec-platform/sec'
  )).toThrow(/bounded 1000-item limit/u);
});

test('missing provider merge commits remain unknown only for their exact local ref', () => {
  const records = [
    { number: 42, headRefName: 'fix/example', headRefOid: HEAD,
      baseRefName: 'main', state: 'MERGED', mergeCommit: { oid: MERGE },
      url: 'https://github.com/sec-platform/sec/pull/42' },
    { number: 43, headRefName: 'fix/unknown', headRefOid: HEAD,
      baseRefName: 'main', state: 'MERGED', mergeCommit: null,
      url: 'https://github.com/sec-platform/sec/pull/43' }
  ];
  const observed = parseMergedPullRequestHeads(JSON.stringify(records), 'sec-platform/sec');
  expect(observed[0]).toEqual(merged());
  expect(observed).toHaveLength(2);
  expect(observed[1]?.mergeCommitSha).toBeNull();
  const plan = (mergedPullRequests: typeof observed) => planMergedLocalBranchResidueCloseout({
    defaultBranch: 'main',
    localRefs: {
      main: MAIN,
      'fix/example': HEAD,
      'fix/current': MAIN,
      'fix/remote-survives': '4'.repeat(40),
      'fix/unknown': HEAD,
      'fix/unmatched': '5'.repeat(40)
    },
    remoteRefs: { main: MAIN, 'fix/remote-survives': '4'.repeat(40) },
    worktreeBranches: ['main', 'fix/current'],
    worktreeRoots: ['D:\\Project\\sec'],
    mergedPullRequests
  });
  expect(plan(observed)).toEqual({
    eligible: [{
      branch: 'fix/example',
      headSha: HEAD,
      pullRequestNumber: 42,
      mergeCommitSha: MERGE,
      pullRequestUrl: 'https://github.com/sec-platform/sec/pull/42'
    }],
    protectedBranches: ['fix/current'],
    unresolvedBranches: ['fix/remote-survives', 'fix/unknown', 'fix/unmatched']
  });
  const conflicting = parseMergedPullRequestHeads(JSON.stringify([
    ...records,
    { ...records[1], number: 44, headRefName: 'fix/example',
      url: 'https://github.com/sec-platform/sec/pull/44' }
  ]), 'sec-platform/sec');
  expect(plan(conflicting)).toMatchObject({
    eligible: [], unresolvedBranches: ['fix/example', 'fix/remote-survives', 'fix/unknown', 'fix/unmatched']
  });
  expect(() => parseMergedPullRequestHeads(JSON.stringify([
    { ...records[1], mergeCommit: {} }
  ]), 'sec-platform/sec')).toThrow(/merge SHA/u);
});

test('binds repository provider identity and exact PR repository URLs', () => {
  expect(parseRepositoryProviderObservation(JSON.stringify({
    nameWithOwner: 'sec-platform/sec',
    defaultBranchRef: { name: 'main' }
  }), 'sec-platform/sec')).toEqual({
    repository: 'sec-platform/sec',
    defaultBranch: 'main'
  });
  expect(() => parseRepositoryProviderObservation(JSON.stringify({
    nameWithOwner: 'other/repository',
    defaultBranchRef: { name: 'main' }
  }), 'sec-platform/sec')).toThrow(/identity differs/u);
  expect(() => parseMergedPullRequestHeads(JSON.stringify([{
    number: 42,
    headRefName: 'fix/example',
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: 'https://github.com/other/repository/pull/42'
  }]), 'sec-platform/sec')).toThrow(/URL differs/u);
});
