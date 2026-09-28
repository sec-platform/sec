import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import type { GitHubApiPrincipal } from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import {
  assertClosedSupersessionEvidence,
  assertReviewedRefSupersessionEvidence,
  observeClosedSupersessionEvidence,
  observeReviewedRefSupersessionEvidence,
  summarizeClosedSupersessionPaths
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts';
import { observeClosedSupersessionFromReadCapability } from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout-production.ts';

const REPOSITORY = 'sec-platform/sec';
const PULL_REQUEST_NUMBER = 73;
const COMMENT_ID = 4107;
const REVIEW_MARKER = '<!-- sec-branch-supersession-review -->\n';
const TOKEN = 'test-token-branch-supersession-review';
const ADOPTING_MAINTAINER = 'adopting-maintainer';
const PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token',
  login: 'session-maintainer',
  nodeId: 'MDQ6VXNlcjQxMDc=',
  userId: 4107,
  permission: 'maintain'
});

type RepositoryFixture = Readonly<{
  root: string;
  headSha: string;
  headTreeSha: string;
  currentMainSha: string;
  currentMainTreeSha: string;
}>;

type ReviewPath = Readonly<{
  path: string;
  disposition: 'retained' | 'superseded';
  reason: string;
}>;

type DivergedReviewFixture = Readonly<{
  root: string;
  mergeBaseSha: string;
  mergeBaseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  currentMainSha: string;
  currentMainTreeSha: string;
}>;

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function createDivergedReviewFixture(): DivergedReviewFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-reviewed-ref-supersession-'));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'SEC Test']);
  git(root, ['config', 'user.email', 'sec-test@example.invalid']);
  git(root, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);

  writeFileSync(path.join(root, 'base.txt'), 'shared base\n', 'utf8');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '--quiet', '-m', 'shared base']);
  const mergeBaseSha = git(root, ['rev-parse', 'HEAD']);
  const mergeBaseTreeSha = git(root, ['rev-parse', `${mergeBaseSha}^{tree}`]);

  git(root, ['checkout', '--quiet', '-b', 'reviewed-orphan']);
  writeFileSync(path.join(root, 'retained.txt'), 'orphan behavior\n', 'utf8');
  writeFileSync(path.join(root, 'superseded.txt'), 'obsolete implementation\n', 'utf8');
  git(root, ['add', 'retained.txt', 'superseded.txt']);
  git(root, ['commit', '--quiet', '-m', 'orphan delta']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  const headTreeSha = git(root, ['rev-parse', `${headSha}^{tree}`]);

  git(root, ['checkout', '--quiet', 'main']);
  writeFileSync(path.join(root, 'retained.txt'), 'current replacement\n', 'utf8');
  writeFileSync(path.join(root, 'main-only.txt'), 'unrelated later main work\n', 'utf8');
  git(root, ['add', 'retained.txt', 'main-only.txt']);
  git(root, ['commit', '--quiet', '-m', 'current main evolution']);
  const currentMainSha = git(root, ['rev-parse', 'HEAD']);
  const currentMainTreeSha = git(root, ['rev-parse', `${currentMainSha}^{tree}`]);

  return Object.freeze({
    root,
    mergeBaseSha,
    mergeBaseTreeSha,
    headSha,
    headTreeSha,
    currentMainSha,
    currentMainTreeSha
  });
}

function createRepositoryFixture(): RepositoryFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-supersession-review-'));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'SEC Test']);
  git(root, ['config', 'user.email', 'sec-test@example.invalid']);
  git(root, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);

  writeFileSync(path.join(root, 'retained.txt'), 'closed branch behavior\n', 'utf8');
  writeFileSync(path.join(root, 'superseded.txt'), 'old obligation\n', 'utf8');
  git(root, ['add', 'retained.txt', 'superseded.txt']);
  git(root, ['commit', '--quiet', '-m', 'closed branch head']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  const headTreeSha = git(root, ['rev-parse', `${headSha}^{tree}`]);

  writeFileSync(path.join(root, 'retained.txt'), 'current main keeps the behavior\n', 'utf8');
  unlinkSync(path.join(root, 'superseded.txt'));
  git(root, ['add', 'retained.txt', 'superseded.txt']);
  git(root, ['commit', '--quiet', '-m', 'current main replacement']);
  const currentMainSha = git(root, ['rev-parse', 'HEAD']);
  const currentMainTreeSha = git(root, ['rev-parse', `${currentMainSha}^{tree}`]);

  return Object.freeze({ root, headSha, headTreeSha, currentMainSha, currentMainTreeSha });
}

function reviewSource(fixture: RepositoryFixture, override: Readonly<{
  pullRequestNumber?: number;
  headTreeSha?: string;
  currentMainTreeSha?: string;
  paths?: readonly ReviewPath[];
}> = {}): string {
  return REVIEW_MARKER + JSON.stringify({
    kind: 'branch-supersession-review',
    repository: REPOSITORY,
    pullRequestNumber: override.pullRequestNumber ?? PULL_REQUEST_NUMBER,
    headSha: fixture.headSha,
    headTreeSha: override.headTreeSha ?? fixture.headTreeSha,
    currentMainSha: fixture.currentMainSha,
    currentMainTreeSha: override.currentMainTreeSha ?? fixture.currentMainTreeSha,
    reviewer: 'independent-exact-reviewer',
    verdict: 'approved',
    paths: override.paths ?? [
      { path: 'retained.txt', disposition: 'retained', reason: 'Current main preserves the reviewed behavior.' },
      { path: 'superseded.txt', disposition: 'superseded', reason: 'Current main replaces the old obligation.' }
    ],
    unknowns: []
  });
}

async function observe(input: Readonly<{
  fixture: RepositoryFixture;
  source: string;
  permission?: 'admin' | 'maintain' | 'write' | 'read';
  commentPullRequestNumber?: number;
}>) {
  const transport: GitHubApiTransport = async (target) => {
    const url = String(target);
    if (url.endsWith(`/issues/comments/${COMMENT_ID}`)) {
      return Response.json({
        id: COMMENT_ID,
        body: input.source,
        issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${input.commentPullRequestNumber ?? PULL_REQUEST_NUMBER}`,
        user: { login: ADOPTING_MAINTAINER }
      });
    }
    if (url.endsWith(`/collaborators/${ADOPTING_MAINTAINER}/permission`)) {
      return Response.json({ permission: input.permission ?? 'maintain' });
    }
    throw new Error(`Unexpected GitHub test transport request: ${url}`);
  };
  const capability = issueGitHubApiTestCapability({
    repository: REPOSITORY,
    token: TOKEN,
    principal: PRINCIPAL,
    effect: 'branch-closeout-write',
    transport
  });
  return await withGitHubApiTestSession({
    capability,
    operation: async () => await observeClosedSupersessionEvidence({
      repositoryRoot: input.fixture.root,
      capability,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      commentId: COMMENT_ID
    })
  });
}

test('maintainer-adopted review binds the complete exact Git delta before issuing evidence', async () => {
  const fixture = createRepositoryFixture();
  try {
    const evidence = await observe({ fixture, source: reviewSource(fixture) });

    expect(evidence).toMatchObject({
      author: ADOPTING_MAINTAINER,
      commentId: COMMENT_ID,
      reference: `https://github.com/${REPOSITORY}/pull/${PULL_REQUEST_NUMBER}#issuecomment-${COMMENT_ID}`,
      review: {
        repository: REPOSITORY,
        pullRequestNumber: PULL_REQUEST_NUMBER,
        headSha: fixture.headSha,
        headTreeSha: fixture.headTreeSha,
        currentMainSha: fixture.currentMainSha,
        currentMainTreeSha: fixture.currentMainTreeSha,
        reviewer: 'independent-exact-reviewer',
        paths: [
          { path: 'retained.txt', disposition: 'retained' },
          { path: 'superseded.txt', disposition: 'superseded' }
        ],
        unknowns: []
      }
    });
    expect(evidence.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() => assertClosedSupersessionEvidence(evidence)).not.toThrow();

    const clonedEvidence = Object.freeze({ ...evidence });
    expect(() => assertClosedSupersessionEvidence(clonedEvidence))
      .toThrow();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('review issuance rejects incomplete, duplicate, or wrong-tree Git coverage', async () => {
  const fixture = createRepositoryFixture();
  try {
    await expect(observe({
      fixture,
      source: reviewSource(fixture, {
        paths: [{
          path: 'retained.txt',
          disposition: 'retained',
          reason: 'Current main preserves the reviewed behavior.'
        }]
      })
    })).rejects.toThrow();

    const duplicate: ReviewPath = {
      path: 'retained.txt',
      disposition: 'retained',
      reason: 'Current main preserves the reviewed behavior.'
    };
    await expect(observe({
      fixture,
      source: reviewSource(fixture, { paths: [duplicate, duplicate] })
    })).rejects.toThrow();

    await expect(observe({
      fixture,
      source: reviewSource(fixture, { currentMainTreeSha: fixture.headTreeSha })
    })).rejects.toThrow();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('version 2 review binds the complete Git path set by stable digest', async () => {
  const fixture = createRepositoryFixture();
  try {
    const pathSet = summarizeClosedSupersessionPaths(['superseded.txt', 'retained.txt']);
    expect(pathSet).toEqual(summarizeClosedSupersessionPaths(['retained.txt', 'superseded.txt']));
    expect(() => summarizeClosedSupersessionPaths(['retained.txt', 'retained.txt']))
      .toThrow('duplicates');
    const source = REVIEW_MARKER + JSON.stringify({
      kind: 'branch-supersession-review', version: 2,
      repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: fixture.headSha, headTreeSha: fixture.headTreeSha,
      currentMainSha: fixture.currentMainSha, currentMainTreeSha: fixture.currentMainTreeSha,
      reviewer: 'independent-exact-reviewer', verdict: 'approved',
      pathSet, assessment: 'Current main retains the reviewed behavior and supersedes the old obligation.',
      unknowns: []
    });
    const evidence = await observe({ fixture, source });
    expect(evidence.review).toMatchObject({ version: 2, pathSet });
    expect(() => assertClosedSupersessionEvidence(evidence)).not.toThrow();
    await expect(observe({ fixture, source: source.replace(pathSet.digest,
      `sha256:${'0'.repeat(64)}`) })).rejects.toThrow('path set differs');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('read capability observes a closed PR and maintainer v2 comment before issuing evidence', async () => {
  const fixture = createRepositoryFixture();
  try {
    const pathSet = summarizeClosedSupersessionPaths(['retained.txt', 'superseded.txt']);
    const source = REVIEW_MARKER + JSON.stringify({
      kind: 'branch-supersession-review', version: 2,
      repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: fixture.headSha, headTreeSha: fixture.headTreeSha,
      currentMainSha: fixture.currentMainSha, currentMainTreeSha: fixture.currentMainTreeSha,
      reviewer: 'independent-exact-reviewer', verdict: 'approved',
      pathSet, assessment: 'The current main retains the intended behavior and supersedes the old obligation.',
      unknowns: []
    });
    const observeRead = async (input: Readonly<{
      source?: string;
      commentPullRequestNumber?: number;
      permission?: string;
      pullState?: string;
    }> = {}) => {
      const transport: GitHubApiTransport = async (target) => {
        const url = String(target);
        if (url.endsWith(`/pulls/${PULL_REQUEST_NUMBER}`)) {
          return Response.json({ number: PULL_REQUEST_NUMBER, state: input.pullState ?? 'closed',
            merged_at: null, draft: false,
            html_url: `https://github.com/${REPOSITORY}/pull/${PULL_REQUEST_NUMBER}`,
            head: { ref: 'closed-topic', sha: fixture.headSha, repo: { full_name: REPOSITORY } },
            base: { ref: 'main', sha: fixture.headSha, repo: { full_name: REPOSITORY } } });
        }
        if (url.endsWith(`/issues/comments/${COMMENT_ID}`)) {
          return Response.json({ id: COMMENT_ID, body: input.source ?? source,
            issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${input.commentPullRequestNumber ?? PULL_REQUEST_NUMBER}`,
            user: { login: ADOPTING_MAINTAINER } });
        }
        if (url.endsWith(`/collaborators/${ADOPTING_MAINTAINER}/permission`)) {
          return Response.json({ permission: input.permission ?? 'maintain' });
        }
        throw new Error(`Unexpected GitHub read request: ${url}`);
      };
      const capability = issueGitHubApiTestCapability({ repository: REPOSITORY,
        token: TOKEN, principal: PRINCIPAL, effect: 'read', transport });
      return withGitHubApiTestSession({ capability,
        operation: () => observeClosedSupersessionFromReadCapability({
          repositoryRoot: fixture.root, capability,
          pullRequestNumber: PULL_REQUEST_NUMBER, commentId: COMMENT_ID
        }) });
    };
    const evidence = await observeRead();
    expect(evidence.review).toMatchObject({ version: 2, pathSet });
    expect(() => assertClosedSupersessionEvidence(evidence)).not.toThrow();
    expect(() => assertClosedSupersessionEvidence({ ...evidence })).toThrow();
    await expect(observeRead({ commentPullRequestNumber: PULL_REQUEST_NUMBER + 1 }))
      .rejects.toThrow('comment identity differs');
    await expect(observeRead({ permission: 'write' }))
      .rejects.toThrow('not been adopted');
    await expect(observeRead({ pullState: 'open' }))
      .rejects.toThrow('exact closed pull request');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('review issuance requires maintainer adoption and exact comment-to-PR identity', async () => {
  const fixture = createRepositoryFixture();
  try {
    const source = reviewSource(fixture);
    await expect(observe({ fixture, source, permission: 'admin' }))
      .resolves.toMatchObject({ author: ADOPTING_MAINTAINER });
    await expect(observe({ fixture, source, permission: 'write' }))
      .rejects.toThrow();
    await expect(observe({
      fixture,
      source,
      commentPullRequestNumber: PULL_REQUEST_NUMBER + 1
    })).rejects.toThrow();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('review issuance rejects a local repository bound to another GitHub origin', async () => {
  const fixture = createRepositoryFixture();
  try {
    git(fixture.root, ['remote', 'set-url', 'origin', 'https://github.com/other/repository.git']);
    await expect(observe({ fixture, source: reviewSource(fixture) })).rejects.toThrow();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});


test('reviewed ref v3 evidence binds the orphan source delta, not unrelated later main changes', async () => {
  const fixture = createDivergedReviewFixture();
  const issueNumber = 313;
  const commentId = COMMENT_ID + 1;
  const branch = 'fix/reviewed-orphan';
  const sourcePathSet = summarizeClosedSupersessionPaths(['retained.txt', 'superseded.txt']);
  const source = REVIEW_MARKER + JSON.stringify({
    kind: 'branch-supersession-review', version: 3,
    repository: REPOSITORY, issueNumber, branch,
    headSha: fixture.headSha, headTreeSha: fixture.headTreeSha,
    currentMainSha: fixture.currentMainSha, currentMainTreeSha: fixture.currentMainTreeSha,
    mergeBaseSha: fixture.mergeBaseSha, mergeBaseTreeSha: fixture.mergeBaseTreeSha,
    reviewer: 'maintainer-reviewed-orphan-delta', verdict: 'approved',
    sourcePathSet,
    assessment: 'Current main retains or supersedes every path in the orphan source delta.',
    unknowns: []
  });
  const capability = issueGitHubApiTestCapability({
    repository: REPOSITORY,
    token: TOKEN,
    principal: PRINCIPAL,
    effect: 'branch-closeout-write',
    transport: async (target) => {
      const url = String(target);
      if (url.endsWith(`/issues/comments/${commentId}`)) {
        return Response.json({
          id: commentId,
          body: source,
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${issueNumber}`,
          user: { login: ADOPTING_MAINTAINER }
        });
      }
      if (url.endsWith(`/collaborators/${ADOPTING_MAINTAINER}/permission`)) {
        return Response.json({ permission: 'maintain' });
      }
      throw new Error(`Unexpected GitHub test transport request: ${url}`);
    }
  });
  try {
    const evidence = await withGitHubApiTestSession({
      capability,
      operation: () => observeReviewedRefSupersessionEvidence({
        repositoryRoot: fixture.root,
        capability,
        issueNumber,
        commentId,
        branch,
        expectedHeadSha: fixture.headSha,
        expectedMainSha: fixture.currentMainSha
      })
    });
    expect(evidence.review).toMatchObject({
      version: 3,
      issueNumber,
      branch,
      headSha: fixture.headSha,
      currentMainSha: fixture.currentMainSha,
      mergeBaseSha: fixture.mergeBaseSha,
      sourcePathSet
    });
    expect(sourcePathSet.count).toBe(2);
    expect(() => assertReviewedRefSupersessionEvidence(evidence)).not.toThrow();
    expect(() => assertReviewedRefSupersessionEvidence({ ...evidence })).toThrow();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('reviewed ref v3 evidence rejects target, main, merge-base, permission or source-delta drift', async () => {
  const fixture = createDivergedReviewFixture();
  const issueNumber = 313;
  const branch = 'fix/reviewed-orphan';
  const make = (input: Readonly<{
    issue?: number;
    permission?: string;
    reviewBranch?: string;
    reviewMain?: string;
    mergeBase?: string;
    digest?: string;
  }> = {}) => {
    const commentId = COMMENT_ID + 2;
    const sourcePathSet = summarizeClosedSupersessionPaths(['retained.txt', 'superseded.txt']);
    const source = REVIEW_MARKER + JSON.stringify({
      kind: 'branch-supersession-review', version: 3,
      repository: REPOSITORY, issueNumber: input.issue ?? issueNumber,
      branch: input.reviewBranch ?? branch,
      headSha: fixture.headSha, headTreeSha: fixture.headTreeSha,
      currentMainSha: input.reviewMain ?? fixture.currentMainSha,
      currentMainTreeSha: fixture.currentMainTreeSha,
      mergeBaseSha: input.mergeBase ?? fixture.mergeBaseSha,
      mergeBaseTreeSha: fixture.mergeBaseTreeSha,
      reviewer: 'maintainer-reviewed-orphan-delta', verdict: 'approved',
      sourcePathSet: { ...sourcePathSet, digest: input.digest ?? sourcePathSet.digest },
      assessment: 'Complete orphan source delta reviewed.',
      unknowns: []
    });
    const capability = issueGitHubApiTestCapability({
      repository: REPOSITORY, token: TOKEN, principal: PRINCIPAL,
      effect: 'branch-closeout-write',
      transport: async (target) => {
        const url = String(target);
        if (url.endsWith(`/issues/comments/${commentId}`)) {
          return Response.json({
            id: commentId,
            body: source,
            issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${issueNumber}`,
            user: { login: ADOPTING_MAINTAINER }
          });
        }
        if (url.endsWith(`/collaborators/${ADOPTING_MAINTAINER}/permission`)) {
          return Response.json({ permission: input.permission ?? 'maintain' });
        }
        throw new Error(`Unexpected GitHub test transport request: ${url}`);
      }
    });
    return withGitHubApiTestSession({
      capability,
      operation: () => observeReviewedRefSupersessionEvidence({
        repositoryRoot: fixture.root,
        capability,
        issueNumber,
        commentId,
        branch,
        expectedHeadSha: fixture.headSha,
        expectedMainSha: fixture.currentMainSha
      })
    });
  };
  try {
    await expect(make({ issue: 312 })).rejects.toThrow();
    await expect(make({ permission: 'write' })).rejects.toThrow();
    await expect(make({ reviewBranch: 'fix/other' })).rejects.toThrow();
    await expect(make({ reviewMain: 'f'.repeat(40) })).rejects.toThrow();
    await expect(make({ mergeBase: fixture.headSha })).rejects.toThrow('merge-base differs');
    await expect(make({ digest: `sha256:${'0'.repeat(64)}` })).rejects.toThrow(
      'source path set differs'
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
