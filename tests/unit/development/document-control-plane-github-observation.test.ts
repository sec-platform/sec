import { describe, expect, test } from 'bun:test';

import {
  buildGitHubDefaultBranchOpenPullRequestsArgs,
  parseGitHubRepositoryIdentityFromRemoteUrl
} from '../../../src/adapters/self-hosting/control/documentation/document-control-plane-github-observation.ts';

const REPOSITORY = 'sec-platform/sec';

describe('Document Control Plane GitHub request identity', () => {
  test('bounds active Work Selection to pull requests targeting the canonical default branch', () => {
    expect(buildGitHubDefaultBranchOpenPullRequestsArgs(REPOSITORY, 'main')).toEqual([
      'pr', 'list', '--repo', REPOSITORY, '--base', 'main', '--state', 'open',
      '--limit', '2', '--json',
      'number,headRefName,headRefOid,baseRefName,baseRefOid,body'
    ]);
    expect(() => buildGitHubDefaultBranchOpenPullRequestsArgs(REPOSITORY, '-unsafe'))
      .toThrow('must be one bounded option-safe Git branch name');
  });

  test('parses GitHub repository identity without treating a local remote as GitHub', () => {
    expect(parseGitHubRepositoryIdentityFromRemoteUrl(
      'https://github.com/sec-platform/sec.git'
    )).toBe(REPOSITORY);
    expect(parseGitHubRepositoryIdentityFromRemoteUrl(
      'git@github.com:sec-platform/sec.git'
    )).toBe(REPOSITORY);
    expect(parseGitHubRepositoryIdentityFromRemoteUrl(
      'ssh://git@github.com/sec-platform/sec.git'
    )).toBe(REPOSITORY);
    for (const invalid of [
      'D:/fixtures/sec.git',
      'https://attacker.invalid/github.com/sec-platform/sec.git',
      'https://github.com/sec-platform/sec/extra'
    ]) {
      expect(parseGitHubRepositoryIdentityFromRemoteUrl(invalid)).toBeNull();
    }
  });
});
