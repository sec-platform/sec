import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readGitHubToken } from '../../src/adapters/providers/github-api/credential.ts';

const GH_EXECUTABLE_NAME = process.platform === 'win32' ? 'gh.exe' : 'gh';

if (import.meta.main && path.basename(process.execPath).toLowerCase() === GH_EXECUTABLE_NAME) {
  const observedKeys = [
    'PATH', 'GH_HOST', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'HOME', 'XDG_CONFIG_HOME',
    'GITHUB_ACTIONS', 'GITHUB_SERVER_URL', 'GITHUB_API_URL'
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
    const token = await readGitHubToken({
      cwd: root,
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
        HOME: null,
        XDG_CONFIG_HOME: null,
        GITHUB_ACTIONS: null,
        GITHUB_SERVER_URL: null,
        GITHUB_API_URL: null
      }
    });
    token.fill(0);
    expect([...token].every((byte) => byte === 0)).toBe(true);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
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
    process.env.GH_TOKEN = 'ghs_actions-token-0123456789';
    process.env.GITHUB_TOKEN = 'must-not-forward';
    process.env.GH_HOST = 'evil.example';
    process.env.GH_CONFIG_DIR = path.join(root, 'redirected-gh');
    process.env.HOME = path.join(root, 'redirected-home');
    process.env.XDG_CONFIG_HOME = path.join(root, 'redirected-xdg');
    const token = await readGitHubToken({
      cwd: root,
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
        GITHUB_ACTIONS: null,
        GITHUB_SERVER_URL: null,
        GITHUB_API_URL: null
      }
    });
    token.fill(0);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test.serial('rejects an expired deadline before executable discovery', async () => {
  const root = await fixture();
  await expect(readGitHubToken({
    cwd: root,
    hostname: 'github.com',
    deadlineAtUnixMs: Date.now() - 1
  })).rejects.toEqual(expect.objectContaining({
    code: 'github-credential-unavailable',
    reason: 'deadline'
  }));
});
