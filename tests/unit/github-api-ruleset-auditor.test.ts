import { expect, test } from 'bun:test';

import {
  inspectGitHubActionsRulesetAuditorCredentialIdentity,
  inspectGitHubActionsVerificationCredentialIdentity
} from '../../src/adapters/providers/github-api/credential.ts';
import {
  currentGitHubApiCapability,
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiRulesetReadSession,
  type GitHubApiCapability,
  type GitHubApiOperation
} from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession
} from '../../src/adapters/providers/github-api/test/operation-session.ts';

const REPOSITORY = 'sec-platform/sec';
const SHA = 'a'.repeat(40);
const TOKEN = 'synthetic-ruleset-auditor-token';
const HOSTED = Object.freeze({
  GITHUB_ACTIONS: 'true',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: SHA,
  GITHUB_WORKFLOW_SHA: SHA,
  GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/merge-gate.yml@refs/heads/main`,
  GITHUB_EVENT_NAME: 'workflow_run',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '1',
  SEC_GITHUB_RULESET_AUDITOR_TOKEN: TOKEN
});

test('auditor selection is explicit while local and verification credential selection remain separate', () => {
  expect(inspectGitHubActionsRulesetAuditorCredentialIdentity({}, REPOSITORY)).toBeNull();
  expect(inspectGitHubActionsRulesetAuditorCredentialIdentity({ GH_TOKEN: TOKEN }, REPOSITORY)).toBeNull();
  expect(inspectGitHubActionsRulesetAuditorCredentialIdentity(HOSTED, REPOSITORY)).toMatchObject({ runId: '42' });
  expect(inspectGitHubActionsRulesetAuditorCredentialIdentity({ ...HOSTED,
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`,
    GITHUB_EVENT_NAME: 'repository_dispatch'
  }, REPOSITORY)).toMatchObject({ runId: '42' });
  expect(inspectGitHubActionsVerificationCredentialIdentity(HOSTED, REPOSITORY)).toBeNull();
  expect(inspectGitHubActionsVerificationCredentialIdentity({ ...HOSTED, GH_TOKEN: TOKEN }, REPOSITORY))
    .toMatchObject({ runId: '42' });
  for (const change of [
    { SEC_GITHUB_RULESET_AUDITOR_TOKEN: undefined },
    { SEC_GITHUB_RULESET_AUDITOR_TOKEN: 'whitespace is forbidden' },
    { sec_github_ruleset_auditor_token: TOKEN },
    { GITHUB_SHA: 'b'.repeat(40) },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/untrusted' },
    { GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/untrusted.yml@refs/heads/main` },
    { GITHUB_REPOSITORY: 'other/repository' },
    { GITHUB_RUN_ATTEMPT: '0' }
  ]) {
    expect(() => inspectGitHubActionsRulesetAuditorCredentialIdentity({ ...HOSTED, ...change }, REPOSITORY))
      .toThrow('GitHub credential provider is unavailable');
  }
  expect(() => inspectGitHubActionsRulesetAuditorCredentialIdentity({
    SEC_GITHUB_RULESET_AUDITOR_TOKEN: TOKEN
  }, REPOSITORY)).toThrow('admission');
  for (const source of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REPOSITORY: REPOSITORY },
    { GITHUB_SHA: SHA }, { GITHUB_API_URL: 'https://api.github.com' }]) {
    expect(() => inspectGitHubActionsRulesetAuditorCredentialIdentity(source, REPOSITORY)).toThrow('admission');
  }
});

test('ruleset-read admits only fixed GET observations and rejects unrelated effects before transport', async () => {
  const requests: Array<{ url: string; method: string | undefined }> = [];
  const capability = issueGitHubApiTestCapability({
    repository: REPOSITORY,
    token: TOKEN,
    principal: { transport: 'github-rest-token', login: 'maintainer', nodeId: 'user-1', userId: 900001,
      permission: 'maintain' },
    effect: 'ruleset-read',
    transport: async (target, init) => {
      requests.push({ url: String(target), method: init?.method });
      return Response.json([]);
    }
  });
  const forbidden: readonly GitHubApiOperation[] = [
    { kind: 'current-user' },
    { kind: 'repository' },
    { kind: 'collaborator-permission', login: 'someone-else' },
    { kind: 'workflow-run', runId: '99' },
    { kind: 'issue-comment', commentId: 1 },
    { kind: 'pull', pullRequestNumber: 1 },
    { kind: 'verification-blob', ref: SHA, path: 'README.md' },
    { kind: 'verification-dispatch', request: {} },
    { kind: 'create-commit-status', sha: SHA,
      status: { state: 'success', context: 'sec/integration-authorization', description: 'not authorized', targetUrl: 'https://github.com/sec-platform/sec' } },
    { kind: 'merge-pull', pullRequestNumber: 1, headSha: SHA, title: 'not authorized', message: 'not authorized' },
    { kind: 'delete-repository-runner', runnerId: 1 }
  ];
  await withGitHubApiTestSession({ capability, operation: async () => {
    expect(currentGitHubApiCapability(REPOSITORY, 'ruleset-read')).toBe(capability);
    expect(() => currentGitHubApiCapability(REPOSITORY, 'verification-read')).toThrow('live owner-issued capability');
    await executeGitHubApiOperation(capability, { kind: 'effective-branch-rules', branch: 'main', page: 1 });
    await executeGitHubApiOperation(capability, { kind: 'ruleset', rulesetId: 7 });
    for (const operation of forbidden) {
      await expect(executeGitHubApiOperation(capability, operation)).rejects.toThrow('ruleset-read permits only');
    }
    await expect(executeGitHubApiOperation({ ...capability }, { kind: 'repository' }))
      .rejects.toThrow('forged');
  } });
  expect(requests).toEqual([
    { url: 'https://api.github.com/repos/sec-platform/sec/rules/branches/main?per_page=100&page=1', method: 'GET' },
    { url: 'https://api.github.com/repos/sec-platform/sec/rulesets/7?includes_parents=true', method: 'GET' }
  ]);
  await expect(executeGitHubApiOperation(capability, { kind: 'repository' })).rejects.toThrow('active exact operation session');
});

function hostedTransport(input: Readonly<{
  requests: Array<{ path: string; authorization: string | null }>;
  permission?: string;
  roleName?: string;
  runOverride?: Readonly<Record<string, unknown>>;
  repositoryOverride?: Readonly<Record<string, unknown>>;
}>): typeof fetch {
  return (async (target: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(target));
    expect(url.origin).toBe('https://api.github.com');
    expect(init?.method).toBe('GET');
    input.requests.push({ path: url.pathname, authorization: new Headers(init?.headers).get('Authorization') });
    if (url.pathname === '/user') return Response.json({ login: 'maintainer', node_id: 'user-1', id: 900001 });
    if (url.pathname.endsWith('/collaborators/maintainer/permission')) {
      return Response.json({ permission: input.permission ?? 'write', role_name: input.roleName ?? 'maintain' });
    }
    if (url.pathname === `/repos/${REPOSITORY}`) {
      return Response.json({ full_name: REPOSITORY, default_branch: 'main', ...input.repositoryOverride });
    }
    if (url.pathname.endsWith('/actions/runs/42')) return Response.json({
      id: 42, run_attempt: 1, path: '.github/workflows/merge-gate.yml', event: 'workflow_run',
      status: 'in_progress', head_sha: SHA, head_branch: 'main',
      repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY }, ...input.runOverride
    });
    if (url.pathname.endsWith('/rules/branches/main')) return Response.json([]);
    throw new Error(`Unexpected fixed test endpoint: ${url.pathname}`);
  }) as typeof fetch;
}

async function withHostedAuditor<T>(input: Readonly<{
  transport: typeof fetch;
  environment?: Readonly<NodeJS.ProcessEnv>;
  operation: () => Promise<T>;
}>): Promise<T> {
  const values = { ...HOSTED, GH_TOKEN: 'unselected-standard-token', ...input.environment };
  const keys = Object.keys(values);
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = input.transport;
    return await input.operation();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test.serial('hosted auditor authenticates its real principal and live run before opening read-only scope', async () => {
  for (const role of [
    { permission: 'write', roleName: 'maintain', expected: 'maintain' },
    { permission: 'admin', roleName: 'admin', expected: 'admin' }
  ]) {
    const requests: Array<{ path: string; authorization: string | null }> = [];
    let saved: GitHubApiCapability | undefined;
    await withHostedAuditor({ transport: hostedTransport({ requests, ...role }), operation: async () => {
      await withGitHubApiRulesetReadSession({ repositoryRoot: process.cwd(), repository: REPOSITORY,
        operation: async (capability) => {
          saved = capability;
          expect(inspectGitHubApiCapability(capability)).toMatchObject({ effect: 'ruleset-read', origin: 'production',
            principal: { transport: 'github-rest-token', login: 'maintainer', userId: 900001, permission: role.expected } });
          await executeGitHubApiOperation(capability, { kind: 'effective-branch-rules', branch: 'main', page: 1 });
        }
      });
    } });
    expect(requests.map((request) => request.path)).toEqual([
      '/user', `/repos/${REPOSITORY}/collaborators/maintainer/permission`, `/repos/${REPOSITORY}`,
      `/repos/${REPOSITORY}/actions/runs/42`, `/repos/${REPOSITORY}/rules/branches/main`
    ]);
    expect(requests.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
    await expect(executeGitHubApiOperation(saved!, { kind: 'repository' })).rejects.toThrow('active exact operation session');
  }
});

test.serial('invalid hosted auditor context never falls back to local credentials or reaches the network', async () => {
  for (const environment of [
    { SEC_GITHUB_RULESET_AUDITOR_TOKEN: undefined },
    { GITHUB_REF: 'refs/heads/untrusted' },
    { GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/other.yml@refs/heads/main` }
  ]) {
    const requests: Array<{ path: string; authorization: string | null }> = [];
    await expect(withHostedAuditor({ environment, transport: hostedTransport({ requests }), operation: async () =>
      withGitHubApiRulesetReadSession({ repositoryRoot: process.cwd(), repository: REPOSITORY,
        operation: async () => { throw new Error('Callback must not run'); } })
    })).rejects.toThrow('GitHub credential provider is unavailable');
    expect(requests).toHaveLength(0);
  }
});

test.serial('auditor principal and live-run drift prevent capability delivery', async () => {
  for (const change of [
    { permission: 'write', roleName: 'write' },
    { permission: 'write', roleName: 'custom-maintainer' },
    { permission: 'maintain', roleName: 'custom-maintainer' },
    { permission: 'read', roleName: 'maintain' },
    { permission: 'write', roleName: 'admin' },
    { runOverride: { head_sha: 'b'.repeat(40) } },
    { runOverride: { status: 'completed' } },
    { runOverride: { path: '.github/workflows/untrusted.yml' } },
    { repositoryOverride: { full_name: 'other/repository' } }
  ]) {
    const requests: Array<{ path: string; authorization: string | null }> = [];
    let entered = false;
    await expect(withHostedAuditor({ transport: hostedTransport({ requests, ...change }), operation: async () =>
      withGitHubApiRulesetReadSession({ repositoryRoot: process.cwd(), repository: REPOSITORY,
        operation: async () => { entered = true; } })
    })).rejects.toThrow();
    expect(entered).toBe(false);
    expect(requests.some((request) => request.path.includes('/rules/'))).toBe(false);
  }
});
