import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withGitHubCredentialStore } from '../../src/adapters/providers/github-api/credential-store.ts';
import { resolveLinuxEffectiveUserHome } from '../../src/adapters/runtime-state/physical/runtime/linux-user-home.ts';

import {
  inspectGitHubActionsRepositoryMaintenanceCredentialIdentity,
  readGitHubToken
} from '../../src/adapters/providers/github-api/credential.ts';

const GH_EXECUTABLE_NAME = process.platform === 'win32' ? 'gh.exe' : 'gh';

// Retained Linux execution uses a sealed memfd rather than the locator's name.
if (import.meta.main && process.argv.slice(-4).join('\0') === 'auth\0token\0--hostname\0github.com') {
  const observedKeys = [
    'PATH', 'GH_HOST', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'HOME', 'XDG_CONFIG_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy',
    'GITHUB_ACTIONS', 'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GITHUB_REPOSITORY',
    'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_SHA', 'GITHUB_WORKFLOW_SHA', 'GITHUB_WORKFLOW_REF'
  ];
  await Bun.write('observed.json', JSON.stringify({
    args: process.argv.slice(-4),
    environment: Object.fromEntries(observedKeys.map((key) => [key, process.env[key] ?? null]))
  }));
  process.stdout.write('  ghp_test-token\r\n');
  process.exit(0);
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-github-credential-'));
  roots.push(root);
  const executable = path.join(root, GH_EXECUTABLE_NAME);
  const build = Bun.spawn([
    process.execPath, 'build', '--compile', import.meta.filename, '--outfile', executable
  ], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (await build.exited !== 0) {
    throw new Error(`GitHub credential fixture build failed: ${await new Response(build.stderr).text()}`);
  }
  return root;
}

test.serial('acquires one token through the retained fixed command and scrubs ambient selectors', async () => {
  const root = await fixture();
  const original = { ...process.env };
  // This checks propagation into the retained credential child. Native lookup
  // provenance and startup-poison resistance have their own independent probe.
  const accountHome = process.platform === 'linux' ? await resolveLinuxEffectiveUserHome() : null;
  try {
    process.env.PATH = root;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_SERVER_URL;
    delete process.env.GITHUB_API_URL;
    process.env.GH_HOST = 'evil.example';
    process.env.GH_TOKEN = 'ambient-secret';
    process.env.GITHUB_TOKEN = 'ambient-secret-2';
    process.env.GH_CONFIG_DIR = path.join(root, 'redirected-gh');
    process.env.HOME = path.join(root, 'redirected-home');
    process.env.XDG_CONFIG_HOME = path.join(root, 'redirected-xdg');
    process.env.HTTP_PROXY = 'http://untrusted.invalid:8080';
    process.env.HTTPS_PROXY = 'http://untrusted.invalid:8080';
    process.env.ALL_PROXY = 'http://untrusted.invalid:8080';
    process.env.NO_PROXY = '*';
    process.env.http_proxy = 'http://untrusted.invalid:8080';
    process.env.https_proxy = 'http://untrusted.invalid:8080';
    const token = await readGitHubToken({
      cwd: root,
      repository: 'sec-platform/sec',
      hostname: 'github.com',
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(Buffer.from(token).toString('ascii')).toBe('ghp_test-token');
    expect(JSON.parse(await readFile(path.join(root, 'observed.json'), 'utf8'))).toEqual({
      args: ['auth', 'token', '--hostname', 'github.com'],
      environment: {
        PATH: null,
        GH_HOST: null,
        GH_TOKEN: null,
        GITHUB_TOKEN: null,
        GH_CONFIG_DIR: null,
        HOME: accountHome,
        XDG_CONFIG_HOME: null,
        HTTP_PROXY: null,
        HTTPS_PROXY: null,
        ALL_PROXY: null,
        NO_PROXY: null,
        http_proxy: null,
        https_proxy: null,
        GITHUB_ACTIONS: null,
        GITHUB_SERVER_URL: null,
        GITHUB_API_URL: null,
        GITHUB_REPOSITORY: null,
        GITHUB_EVENT_NAME: null,
        GITHUB_REF: null,
        GITHUB_SHA: null,
        GITHUB_WORKFLOW_SHA: null,
        GITHUB_WORKFLOW_REF: null
      }
    });
    token.fill(0);
    expect([...token].every((byte) => byte === 0)).toBe(true);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test.serial('retired comment dispatch selectors cannot downgrade native batch plan authority', () => {
  const source: NodeJS.ProcessEnv = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
    GITHUB_REPOSITORY: 'sec-platform/sec',
    GITHUB_EVENT_NAME: 'repository_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    GITHUB_WORKFLOW_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    GITHUB_WORKFLOW_REF:
      'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main',
    GITHUB_ACTOR: 'maintainer',
    SEC_MAINTENANCE_ISSUE_NUMBER: '313',
    SEC_MAINTENANCE_COMMENT_ID: '42',
    SEC_MAINTENANCE_COMMENT_AUTHOR: 'maintainer',
    GH_TOKEN: 'ghs_actions-token-0123456789'
  };
  expect(inspectGitHubActionsRepositoryMaintenanceCredentialIdentity(source, 'sec-platform/sec')).toBeNull();
  for (const association of ['MEMBER', 'COLLABORATOR', 'NONE', 'unknown', undefined]) {
    expect(inspectGitHubActionsRepositoryMaintenanceCredentialIdentity({ ...source,
      SEC_MAINTENANCE_AUTHOR_ASSOCIATION: association }, 'sec-platform/sec')).toBeNull();
  }
});

test.serial('forwards only the explicit GitHub Actions token to the fixed credential command', async () => {
  const root = await fixture();
  const original = { ...process.env };
  try {
    process.env.PATH = root;
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    process.env.GITHUB_API_URL = 'https://api.github.com';
    process.env.GITHUB_REPOSITORY = 'sec-platform/sec';
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    process.env.GITHUB_RUN_ID = '100';
    process.env.GITHUB_RUN_ATTEMPT = '1';
    process.env.SEC_MAINTENANCE_REQUEST_JSON = JSON.stringify({
      schema: 'sec-repository-maintenance-request-v2', repository: 'sec-platform/sec',
      expectedMainSha: 'a'.repeat(40), operations: [{ kind: 'exact-ref-retirement', retirement: {
        classification: 'transport-only', branches: ['transport/old'], expectedHeadSha: 'b'.repeat(40)
      } }]
    });
    process.env.GITHUB_REF = 'refs/heads/main';
    process.env.GITHUB_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.GITHUB_WORKFLOW_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.GITHUB_WORKFLOW_REF =
      'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main';
    process.env.GITHUB_ACTOR = 'maintainer';
    process.env.GH_TOKEN = 'ghs_actions-token-0123456789';
    process.env.GITHUB_TOKEN = 'must-not-forward';
    process.env.GH_HOST = 'evil.example';
    process.env.GH_CONFIG_DIR = path.join(root, 'redirected-gh');
    process.env.HOME = path.join(root, 'redirected-home');
    process.env.XDG_CONFIG_HOME = path.join(root, 'redirected-xdg');
    const token = await readGitHubToken({
      cwd: root,
      repository: 'sec-platform/sec',
      hostname: 'github.com',
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(Buffer.from(token).toString('ascii')).toBe('ghp_test-token');
    expect(JSON.parse(await readFile(path.join(root, 'observed.json'), 'utf8'))).toEqual({
      args: ['auth', 'token', '--hostname', 'github.com'],
      environment: {
        PATH: null,
        GH_HOST: null,
        GH_TOKEN: 'ghs_actions-token-0123456789',
        GITHUB_TOKEN: null,
        GH_CONFIG_DIR: null,
        HOME: null,
        XDG_CONFIG_HOME: null,
        HTTP_PROXY: null,
        HTTPS_PROXY: null,
        ALL_PROXY: null,
        NO_PROXY: null,
        http_proxy: null,
        https_proxy: null,
        GITHUB_ACTIONS: null,
        GITHUB_SERVER_URL: null,
        GITHUB_API_URL: null,
        GITHUB_REPOSITORY: null,
        GITHUB_EVENT_NAME: null,
        GITHUB_REF: null,
        GITHUB_SHA: null,
        GITHUB_WORKFLOW_SHA: null,
        GITHUB_WORKFLOW_REF: null
      }
    });
    token.fill(0);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test.serial('rejects an expired deadline before executable discovery', async () => {
  await expect(readGitHubToken({
    cwd: import.meta.dir,
    repository: 'sec-platform/sec',
    hostname: 'github.com',
    deadlineAtUnixMs: Date.now() - 1
  })).rejects.toEqual(expect.objectContaining({
    code: 'github-credential-unavailable',
    reason: 'deadline'
  }));
});

test.skipIf(process.platform !== 'linux').serial('reads through an explicitly bound external store, not ambient selectors', async () => {
  const root = await fixture();
  const store = await mkdtemp(path.join('/tmp', 'sec-gh-private-store-'));
  roots.push(store);
  const original = { ...process.env };
  try {
    process.env.PATH = root;
    delete process.env.GITHUB_ACTIONS;
    process.env.GH_CONFIG_DIR = path.join(root, 'untrusted-config');
    process.env.HOME = path.join(root, 'untrusted-home');
    process.env.GH_TOKEN = 'must-not-forward';
    await withGitHubCredentialStore({ directoryPath: store, repositoryRoot: root }, async () => {
      const token = await readGitHubToken({
        cwd: root, repository: 'sec-platform/sec', hostname: 'github.com',
        deadlineAtUnixMs: Date.now() + 10_000
      });
      expect(Buffer.from(token).toString('ascii')).toBe('ghp_test-token');
      token.fill(0);
    });
    const observed = JSON.parse(await readFile(path.join(store, 'observed.json'), 'utf8'));
    expect(observed.environment.GH_CONFIG_DIR).toBe('/proc/self/fd/4');
    expect(observed.environment.HOME).toBeNull();
    expect(observed.environment.GH_TOKEN).toBeNull();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test.serial('native maintenance batch credential selectors bind an exact plan but do not themselves issue authority', () => {
  const request = { schema: 'sec-repository-maintenance-request-v2', repository: 'sec-platform/sec',
    expectedMainSha: 'a'.repeat(40), operations: [{ kind: 'exact-ref-retirement', retirement: {
      classification: 'transport-only', branches: ['transport/old'], expectedHeadSha: 'b'.repeat(40)
    } }] };
  const source: NodeJS.ProcessEnv = {
    GITHUB_ACTIONS: 'true', GITHUB_SERVER_URL: 'https://github.com', GITHUB_API_URL: 'https://api.github.com',
    GITHUB_REPOSITORY: request.repository, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: request.expectedMainSha, GITHUB_WORKFLOW_SHA: request.expectedMainSha,
    GITHUB_WORKFLOW_REF: 'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main',
    GITHUB_ACTOR: 'maintainer', GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1',
    SEC_MAINTENANCE_REQUEST_JSON: JSON.stringify(request), GH_TOKEN: 'ghs_actions-token-0123456789'
  };
  expect(inspectGitHubActionsRepositoryMaintenanceCredentialIdentity(source, request.repository)).toMatchObject({
    repository: request.repository, actor: 'maintainer', runId: '100', runAttempt: 1,
    requestDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    executionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), resumeReceiptDigest: null
  });
  for (const changed of [
    { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_ACTOR: 'github-actions[bot]' }, { SEC_MAINTENANCE_REQUEST_JSON: '{' },
    { SEC_MAINTENANCE_REQUEST_JSON: JSON.stringify({ ...request, expectedMainSha: 'b'.repeat(40) }) }
  ]) expect(inspectGitHubActionsRepositoryMaintenanceCredentialIdentity({ ...source, ...changed }, request.repository)).toBeNull();
});


test.serial('an Actions token with a retired dispatch selector fails instead of falling back to stored auth', async () => {
  const original = { ...process.env };
  try {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_EVENT_NAME = 'repository_dispatch';
    process.env.GH_TOKEN = 'ghs_actions-token-0123456789';
    await expect(readGitHubToken({ cwd: import.meta.dir, repository: 'sec-platform/sec', hostname: 'github.com',
      deadlineAtUnixMs: Date.now() + 10_000 })).rejects.toMatchObject({
        code: 'github-credential-unavailable', reason: 'admission'
      });
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
