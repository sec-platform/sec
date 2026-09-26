import { expect, test } from 'bun:test';

import {
  executeGitHubApiOperation,
  type GitHubApiCapability,
  type GitHubApiPrincipal
} from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import {
  renderCodeScanningProjection
} from '../../src/adapters/verification/platform/code-scanning/projection.ts';

const TOKEN = 'test-token-0123456789';
const PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token',
  login: 'maintainer',
  nodeId: 'MDQ6VXNlcjE=',
  userId: 900001,
  permission: 'maintain'
});

function capability(
  effect: 'read' | 'issue-comment-write',
  transport: GitHubApiTransport
): GitHubApiCapability {
  return issueGitHubApiTestCapability({
    repository: 'sec-platform/sec',
    token: TOKEN,
    principal: PRINCIPAL,
    effect,
    transport
  });
}

test('code scanning alerts compile to one fixed PR-scoped CodeQL endpoint', async () => {
  const urls: string[] = [];
  const api = capability('read', async (target) => {
    urls.push(String(target));
    return Response.json([]);
  });
  await withGitHubApiTestSession({
    capability: api,
    operation: () => executeGitHubApiOperation(api, {
      kind: 'code-scanning-alerts',
      pullRequestNumber: 636,
      page: 2
    })
  });
  expect(urls).toEqual([
    'https://api.github.com/repos/sec-platform/sec/code-scanning/alerts?state=open&tool_name=CodeQL&pr=636&per_page=100&page=2'
  ]);
});

test('code scanning projection updates only one exact issue comment by PATCH', async () => {
  const observed: Array<{ target: string; method: string; body: unknown }> = [];
  const api = capability('issue-comment-write', async (target, init) => {
    observed.push({
      target: String(target),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? null : JSON.parse(String(init.body))
    });
    return Response.json({ id: 91, body: 'replacement' });
  });
  expect(await withGitHubApiTestSession({
    capability: api,
    operation: () => executeGitHubApiOperation(api, {
      kind: 'update-issue-comment',
      commentId: 91,
      body: 'replacement'
    })
  })).toEqual({ id: 91, body: 'replacement' });
  expect(observed).toEqual([{
    target: 'https://api.github.com/repos/sec-platform/sec/issues/comments/91',
    method: 'PATCH',
    body: { body: 'replacement' }
  }]);
});

test('projection is deterministic, exact-head bound, sorted, and explicitly non-authoritative', () => {
  const findings = [
    {
      number: 8,
      ruleId: 'js/example-low',
      securitySeverity: 'low',
      severity: 'warning',
      message: 'Low finding',
      path: 'src/z.ts',
      startLine: 20,
      endLine: 20,
      commitSha: '2'.repeat(40),
      htmlUrl: 'https://github.com/sec-platform/sec/security/code-scanning/8'
    },
    {
      number: 7,
      ruleId: 'js/user-controlled-bypass',
      securitySeverity: 'high',
      severity: 'error',
      message: 'This security check depends on user-controlled data.',
      path: 'src/a.ts',
      startLine: 10,
      endLine: 10,
      commitSha: '2'.repeat(40),
      htmlUrl: 'https://github.com/sec-platform/sec/security/code-scanning/7'
    }
  ] as const;
  const first = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: '1'.repeat(40),
    findings
  });
  const second = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: '1'.repeat(40),
    findings: [...findings].reverse()
  });
  expect(second).toEqual(first);
  expect(first.body).toContain('Exact PR head:');
  expect(first.body).toContain('1 high, 1 low');
  expect(first.body.indexOf('js/user-controlled-bypass')).toBeLessThan(
    first.body.indexOf('js/example-low')
  );
  expect(first.body).toContain('projection only');
  expect(first.body).toContain(first.projectionDigest);
});

test('projection fails closed instead of silently truncating a large finding set', () => {
  const findings = Array.from({ length: 101 }, (_, index) => ({
    number: index + 1,
    ruleId: 'js/test-' + index,
    securitySeverity: 'high',
    severity: 'error',
    message: 'finding ' + index,
    path: 'src/file-' + index + '.ts',
    startLine: 1,
    endLine: 1,
    commitSha: '2'.repeat(40),
    htmlUrl: 'https://github.com/sec-platform/sec/security/code-scanning/' + (index + 1)
  }));
  expect(() => renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: '1'.repeat(40),
    findings
  })).toThrow('exceeds 100 open findings');
});
