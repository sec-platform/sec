import type {
  GitHubApiPrincipal
} from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import {
  observeClosedSupersessionEvidence,
  type ClosedSupersessionEvidence
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts';

const REVIEW_MARKER = '<!-- sec-branch-supersession-review -->\n';
const TOKEN = 'test-token-closed-supersession-evidence';
const ADOPTING_MAINTAINER = 'closed-supersession-maintainer';
const PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token',
  login: 'test-session-maintainer',
  nodeId: 'MDQ6VXNlcjU5Mw==',
  userId: 593,
  permission: 'maintain'
});

export async function observeTestClosedSupersessionEvidence(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  commentId: number;
  headSha: string;
  headTreeSha: string;
  currentMainSha: string;
  currentMainTreeSha: string;
  paths: readonly Readonly<{
    path: string;
    disposition: 'retained' | 'superseded';
    reason: string;
  }>[];
}>): Promise<ClosedSupersessionEvidence> {
  const body = REVIEW_MARKER + JSON.stringify({
    kind: 'branch-supersession-review',
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    currentMainSha: input.currentMainSha,
    currentMainTreeSha: input.currentMainTreeSha,
    reviewer: 'independent-exact-reviewer',
    verdict: 'approved',
    paths: input.paths,
    unknowns: []
  });
  const transport: GitHubApiTransport = async (target) => {
    const url = String(target);
    if (url.endsWith(`/issues/comments/${input.commentId}`)) {
      return Response.json({
        id: input.commentId,
        body,
        issue_url:
          `https://api.github.com/repos/${input.repository}/issues/${input.pullRequestNumber}`,
        user: { login: ADOPTING_MAINTAINER }
      });
    }
    if (url.endsWith(`/collaborators/${ADOPTING_MAINTAINER}/permission`)) {
      return Response.json({ permission: 'maintain' });
    }
    throw new Error(`Unexpected GitHub test transport request: ${url}`);
  };
  const capability = issueGitHubApiTestCapability({
    repository: input.repository,
    token: TOKEN,
    principal: PRINCIPAL,
    effect: 'branch-closeout-write',
    transport
  });
  return await withGitHubApiTestSession({
    capability,
    operation: async () => await observeClosedSupersessionEvidence({
      repositoryRoot: input.repositoryRoot,
      capability,
      pullRequestNumber: input.pullRequestNumber,
      commentId: input.commentId
    })
  });
}
