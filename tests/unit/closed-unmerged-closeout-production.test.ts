import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { GitHubApiPrincipal } from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { parseClosedUnmergedCloseoutArguments } from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout-cli.ts';
import {
  executeProductionClosedUnmergedCloseout,
  observeProductionClosedUnmergedOpenPullRequests,
  observeProductionClosedUnmergedPullRequest
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout-production.ts';

const REPOSITORY = 'sec-platform/sec';
test('native closeout CLI needs no review comment while reviewed lane retains exact review identity', () => {
  const base = ['--repository', REPOSITORY, '--pr', '593', '--disposition', 'closed-superseded'];
  expect(parseClosedUnmergedCloseoutArguments(base).reviewCommentId).toBeNull();
  expect(parseClosedUnmergedCloseoutArguments([...base, '--review-comment', '5931']).reviewCommentId).toBe(5931);
});
const TOKEN = 'test-token-0123456789';

function openPull(number: number, baseRef = 'main', headRepository = REPOSITORY) {
  return { number, state: 'open', draft: false,
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    head: { ref: 'topic', sha: '1'.repeat(40), repo: { full_name: headRepository } },
    base: { ref: baseRef, sha: '2'.repeat(40), repo: { full_name: REPOSITORY } } };
}

test('complete authenticated open PR census includes second-page base consumers and fork provenance', async () => {
  const targets: string[] = [];
  const api = capability('branch-closeout-write', async target => {
    const url = new URL(String(target)); targets.push(url.search);
    return Response.json(url.searchParams.get('page') === '1'
      ? Array.from({ length: 100 }, (_, index) => openPull(index + 1))
      : [openPull(101, 'target', 'foreign/repository')]);
  });
  await withGitHubApiTestSession({ capability: api, operation: async () => {
    const observations = await observeProductionClosedUnmergedOpenPullRequests(api);
    expect(observations).toHaveLength(101);
    expect(observations[100]).toMatchObject({ baseBranch: 'target', isCrossRepository: true });
  } });
  expect(targets).toEqual(['?state=open&per_page=100&page=1', '?state=open&per_page=100&page=2']);
});

for (const fault of ['full-bound', 'repository', 'duplicate'] as const) {
  test(`open PR census rejects ${fault} without issuing an empty complete result`, async () => {
    const api = capability('branch-closeout-write', async target => {
      const page = Number(new URL(String(target)).searchParams.get('page'));
      const values = fault === 'full-bound'
        ? Array.from({ length: 100 }, (_, index) => openPull((page - 1) * 100 + index + 1))
        : fault === 'duplicate'
          ? [openPull(1), openPull(1)] : [openPull(1)];
      if (fault === 'repository') values[0]!.base.repo.full_name = 'foreign/repository';
      return Response.json(values);
    });
    await withGitHubApiTestSession({ capability: api, operation: async () => {
      await expect(observeProductionClosedUnmergedOpenPullRequests(api)).rejects.toThrow(
        fault === 'full-bound' ? 'bounded complete pagination' : fault === 'repository' ? 'repository identity' : 'duplicate pagination');
    } });
  });
}

test('each authenticated census refresh observes consumers created after an earlier empty read', async () => {
  let reads = 0;
  const api = capability('branch-closeout-write', async () => Response.json(
    ++reads === 1 ? [] : [openPull(1, 'target')]));
  await withGitHubApiTestSession({ capability: api, operation: async () => {
    expect(await observeProductionClosedUnmergedOpenPullRequests(api)).toEqual([]);
    expect(await observeProductionClosedUnmergedOpenPullRequests(api)).toMatchObject([{ baseBranch: 'target' }]);
  } });
  expect(reads).toBe(2);
});
const PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token', login: 'maintainer', nodeId: 'MDQ6VXNlcjE=',
  userId: 900001, permission: 'maintain'
});
function capability(effect: 'branch-closeout-write', transport: GitHubApiTransport) {
  return issueGitHubApiTestCapability({ repository: REPOSITORY, token: TOKEN,
    principal: PRINCIPAL, effect, transport });
}

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

test('production completed lookup ignores foreign malformed markers but blocks principal malformed or duplicate markers', async () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'sec-closed-production-'));
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: repositoryRoot, windowsHide: true });
  expect(initialized.status).toBe(0);
  const originalFetch = globalThis.fetch;
  let commentAuthorNodeId = 'FOREIGN_NODE';
  let commentBodies = ['<!-- sec-closed-unmerged-terminal -->\n{not-json'];
  let observedHeadRef = 'refs/heads/topic';
  let observedHeadObjectType = 'commit';
  globalThis.fetch = (async (target) => {
    const url = new URL(String(target));
    if (url.pathname === '/user') return Response.json({ login: PRINCIPAL.login, node_id: PRINCIPAL.nodeId, id: PRINCIPAL.userId });
    if (url.pathname.endsWith(`/collaborators/${PRINCIPAL.login}/permission`)) return Response.json({ permission: 'maintain' });
    if (url.pathname.endsWith('/pulls/593')) {
      return Response.json({ number: 593, state: 'closed', merged_at: null, draft: false,
        html_url: `https://github.com/${REPOSITORY}/pull/593`,
        head: { ref: 'topic', sha: '1'.repeat(40), repo: { full_name: REPOSITORY } },
        base: { ref: 'main', sha: '2'.repeat(40), repo: { full_name: REPOSITORY } } });
    }
    if (url.pathname.endsWith('/git/ref/heads/topic')) {
      return Response.json({ ref: observedHeadRef,
        object: { type: observedHeadObjectType, sha: '1'.repeat(40) } });
    }
    if (url.pathname.endsWith('/issues/593/comments')) {
      return Response.json(commentBodies.map((body, index) => ({ id: index + 1, body,
        user: { node_id: commentAuthorNodeId } })));
    }
    throw new Error(`unexpected GitHub test request: ${url.pathname}`);
  }) as typeof fetch;
  const runLookup = () => executeProductionClosedUnmergedCloseout({ repositoryRoot, repository: REPOSITORY,
    compileOperation: async (context) => {
      await context.observePullRequest(593);
      await context.observeHeadRef('topic');
      const value = await context.observeCompletedPreparation(593, `sha256:${'3'.repeat(64)}`);
      throw new Error(value === null ? 'foreign-malformed-ignored' : 'unexpected-completed-preparation');
    } });
  try {
    await expect(runLookup()).rejects.toThrow('foreign-malformed-ignored');
    commentAuthorNodeId = PRINCIPAL.nodeId;
    await expect(runLookup()).rejects.toThrow('terminal marker has invalid JSON');
    const duplicate = `<!-- sec-closed-unmerged-terminal -->\n${JSON.stringify({
      operationId: `sha256:${'4'.repeat(64)}`,
      evidenceDigest: `sha256:${'3'.repeat(64)}`,
      prepared: {}
    })}`;
    commentBodies = [duplicate, duplicate];
    await expect(runLookup()).rejects.toThrow('ambiguous for the exact evidence');
    commentBodies = [duplicate];
    await expect(runLookup()).rejects.toThrow('Prepared branch closeout envelope schema mismatch');
    observedHeadRef = 'refs/heads/wrong-topic';
    await expect(runLookup()).rejects.toThrow('exact head ref response is invalid');
    observedHeadRef = 'refs/heads/topic';
    observedHeadObjectType = 'tag';
    await expect(runLookup()).rejects.toThrow('exact head ref response is invalid');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}, 20_000);
