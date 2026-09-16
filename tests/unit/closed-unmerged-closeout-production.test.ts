import { expect, test } from 'bun:test';

import { parseClosedUnmergedCloseoutArguments } from '../../src/control/branch-lifecycle/closed-unmerged-closeout-cli.ts';
import {
  observeProductionClosedUnmergedPullRequest
} from '../../src/control/branch-lifecycle/closed-unmerged-closeout-production.ts';
import type { GitHubApiPrincipal } from '../../src/external-capabilities/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/external-capabilities/github-api/test/operation-session.ts';

const REPOSITORY = 'sec-platform/sec';
const TOKEN = 'test-token-0123456789';
const PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token', login: 'maintainer', nodeId: 'MDQ6VXNlcjE=',
  userId: 900001, permission: 'maintain'
});
function capability(effect: 'branch-closeout-write', transport: GitHubApiTransport) {
  return issueGitHubApiTestCapability({ repository: REPOSITORY, token: TOKEN,
    principal: PRINCIPAL, effect, transport });
}

test('production CLI admits only the closed-superseded review-bound operation', () => {
  expect(parseClosedUnmergedCloseoutArguments([
    '--repository', REPOSITORY, '--pr', '593', '--disposition', 'closed-superseded',
    '--review-comment', '1234', '--preparation', '.sec/recovery/preparation.json'
  ])).toMatchObject({ repository: REPOSITORY, pullRequestNumber: 593,
    disposition: 'closed-superseded', reviewCommentId: 1234 });
  expect(() => parseClosedUnmergedCloseoutArguments([
    '--repository', REPOSITORY, '--pr', '593', '--disposition', 'evidence-close', '--review-comment', '1234'
  ])).toThrow('--disposition must be closed-superseded');
});

test('exact PR observation is one fixed repository-bound native request', async () => {
  const targets: string[] = [];
  const api = capability('branch-closeout-write', async (target) => {
    targets.push(String(target));
    return Response.json({ number: 593, state: 'closed', merged_at: null, draft: false,
      html_url: `https://github.com/${REPOSITORY}/pull/593`,
      head: { ref: 'topic', sha: '1'.repeat(40), repo: { full_name: REPOSITORY } },
      base: { ref: 'main', sha: '2'.repeat(40), repo: { full_name: REPOSITORY } } });
  });
  await withGitHubApiTestSession({ capability: api, operation: async () => {
    expect(await observeProductionClosedUnmergedPullRequest({ capability: api, pullRequestNumber: 593 }))
      .toMatchObject({ number: 593, state: 'closed', headBranch: 'topic', baseBranch: 'main' });
  } });
  expect(targets).toEqual([`https://api.github.com/repos/${REPOSITORY}/pulls/593`]);
  await expect(observeProductionClosedUnmergedPullRequest({ capability: api, pullRequestNumber: 593 }))
    .rejects.toThrow('active exact operation session');
});

test('exact PR observation rejects a response bound to another repository', async () => {
  const api = capability('branch-closeout-write', async (target) => {
    expect(String(target)).toBe(`https://api.github.com/repos/${REPOSITORY}/pulls/593`);
    return Response.json({ number: 593, state: 'closed', merged_at: null, draft: false,
      html_url: 'https://github.com/other/repository/pull/593',
      head: { ref: 'topic', sha: '1'.repeat(40), repo: { full_name: 'other/repository' } },
      base: { ref: 'main', sha: '2'.repeat(40), repo: { full_name: 'other/repository' } } });
  });
  await withGitHubApiTestSession({ capability: api, operation: async () => {
    await expect(observeProductionClosedUnmergedPullRequest({ capability: api, pullRequestNumber: 593 }))
      .rejects.toThrow('repository identity differs');
  } });
});
