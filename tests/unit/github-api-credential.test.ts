import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withGitHubCredentialStore } from '../../src/adapters/providers/github-api/credential-store.ts';
import { resolveLinuxEffectiveUserHome } from '../../src/adapters/runtime-state/physical/runtime/linux-user-home.ts';

import {
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
