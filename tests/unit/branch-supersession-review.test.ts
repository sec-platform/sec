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
  observeClosedSupersessionEvidence,
  summarizeClosedSupersessionPaths
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts';

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
  changedPaths: readonly string[];
}>;

type ReviewPath = Readonly<{
  path: string;
  disposition: 'retained' | 'superseded';
  reason: string;
}>;

function git(repositoryRoot: string, args: readonly string[], input?: string): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    input
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function createRepositoryFixture(additionalPaths = 0): RepositoryFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-supersession-review-'));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'SEC Test']);
  git(root, ['config', 'user.email', 'sec-test@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);

  writeFileSync(path.join(root, 'retained.txt'), 'closed branch behavior\n', 'utf8');
  writeFileSync(path.join(root, 'superseded.txt'), 'old obligation\n', 'utf8');
  git(root, ['add', 'retained.txt', 'superseded.txt']);
  git(root, ['commit', '--quiet', '-m', 'closed branch head']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  const headTreeSha = git(root, ['rev-parse', `${headSha}^{tree}`]);

  writeFileSync(path.join(root, 'retained.txt'), 'current main keeps the behavior\n', 'utf8');
  unlinkSync(path.join(root, 'superseded.txt'));
  const changedPaths = ['retained.txt', 'superseded.txt'];
  for (let index = 0; index < additionalPaths; index += 1) {
    const pathname = `bulk/${String(index).padStart(4, '0')}.txt`;
    changedPaths.push(pathname);
  }
  git(root, ['add', 'retained.txt', 'superseded.txt']);
  if (additionalPaths > 0) {
    const blob = git(root, ['hash-object', '-w', '--stdin'], 'replacement\n');
    git(root, ['update-index', '--index-info'], changedPaths.slice(2)
      .map((pathname) => `100644 ${blob}\t${pathname}\n`).join(''));
  }
  git(root, ['commit', '--quiet', '-m', 'current main replacement']);
  const currentMainSha = git(root, ['rev-parse', 'HEAD']);
  const currentMainTreeSha = git(root, ['rev-parse', `${currentMainSha}^{tree}`]);

  return Object.freeze({ root, headSha, headTreeSha, currentMainSha, currentMainTreeSha, changedPaths });
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

function reviewSource(fixture: RepositoryFixture, override: Readonly<{
  pathSet?: Readonly<{ count: number; digest: `sha256:${string}` }>;
  assessment?: string;
  unknowns?: readonly string[];
}> = {}): string {
  return REVIEW_MARKER + JSON.stringify({
    kind: 'branch-supersession-review',
    version: 2,
    repository: REPOSITORY,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    headSha: fixture.headSha,
    headTreeSha: fixture.headTreeSha,
    currentMainSha: fixture.currentMainSha,
    currentMainTreeSha: fixture.currentMainTreeSha,
    reviewer: 'independent-exact-reviewer',
    verdict: 'approved',
    pathSet: override.pathSet ?? summarizeClosedSupersessionPaths(fixture.changedPaths),
    assessment: override.assessment ?? 'The current main preserves retained behavior and replaces obsolete obligations across the complete exact diff.',
    unknowns: override.unknowns ?? []
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

test('versioned compact review binds all 2475 native Git paths without listing them in the comment', async () => {
  const fixture = createRepositoryFixture(2473);
  try {
    const source = reviewSource(fixture);
    expect(fixture.changedPaths).toHaveLength(2475);
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThan(60_000);
    const evidence = await observe({ fixture, source });
    expect(evidence.review).toMatchObject({
      version: 2,
      headSha: fixture.headSha,
      headTreeSha: fixture.headTreeSha,
      currentMainSha: fixture.currentMainSha,
      currentMainTreeSha: fixture.currentMainTreeSha,
      pathSet: summarizeClosedSupersessionPaths(fixture.changedPaths),
      unknowns: []
    });
    expect(() => assertClosedSupersessionEvidence(evidence)).not.toThrow();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('versioned review refuses incomplete path identity, unknowns, or absent semantic assessment', async () => {
  const fixture = createRepositoryFixture();
  try {
    const actual = summarizeClosedSupersessionPaths(fixture.changedPaths);
    await expect(observe({ fixture, source: reviewSource(fixture, {
      pathSet: { ...actual, count: actual.count - 1 }
    }) })).rejects.toThrow();
    await expect(observe({ fixture, source: reviewSource(fixture, {
      pathSet: { ...actual, digest: `sha256:${'0'.repeat(64)}` }
    }) })).rejects.toThrow();
    await expect(observe({ fixture, source: reviewSource(fixture, {
      unknowns: ['one unresolved obligation']
    }) })).rejects.toThrow();
    await expect(observe({ fixture, source: reviewSource(fixture, {
      assessment: ''
    }) })).rejects.toThrow();
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
