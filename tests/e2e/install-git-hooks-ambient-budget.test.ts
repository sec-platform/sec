import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHostGitReadSessionForTests, type GitReadSessionResolution } from '../../src/adapters/providers/git-read/test/session.ts';
import { installGitHooksMain } from '../../src/adapters/self-hosting/development/hooks/install.ts';

import { git, installGitHooks, withCanonicalRemoteRepository, withRepository } from './fixtures/install-git-hooks.ts';
test('Git invocation process and output budgets stop before any config effect', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      gitBudget: { maxProcesses: 1 }
    })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      gitBudget: { maxCommandStdoutBytes: 1 }
    })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withCanonicalRemoteRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      noRemoteFixture: false,
      gitBudget: { deadlineMs: 1 }
    })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('Git read transport rejects an invalid executable fence before any child process', async () => {
  await withRepository(async (repoRoot) => {
    const hostSession = createHostGitReadSessionForTests({ cwd: repoRoot });
    if (hostSession.gitExecutableIdentity === null) {
      throw new Error('The host test provider did not expose a Git executable identity');
    }
    const providerResolution: GitReadSessionResolution = Object.freeze({
      status: 'ready' as const,
      route: 'host-local-git-v1' as const,
      session: Object.freeze({
        ...hostSession,
        verifyExecutable: () => false
      })
    });
    const spawnKinds: Array<'git-read' | 'git-config'> = [];
    const result = await installGitHooks({
      repoRoot,
      lifecycle: true,
      providerResolutionForTest: providerResolution,
      beforeSpawnForTest: (kind) => spawnKinds.push(kind)
    });
    expect(result.status).toBe('conflict');
    expect(result.message).toContain('canonical Git executable identity changed');
    expect(spawnKinds).toEqual([]);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
}, { timeout: 30_000 });

test('same-path provider identity mutation is rejected before the config effect', async () => {
  await withRepository(async (repoRoot) => {
    const hostResolution = createHostGitReadSessionForTests({ cwd: repoRoot });
    if (hostResolution.gitExecutableIdentity === null) {
      throw new Error('The host test provider did not expose a Git executable identity');
    }
    let mutated = false;
    const providerResolution: GitReadSessionResolution = Object.freeze({
      status: 'ready' as const,
      route: 'host-local-git-v1' as const,
      session: Object.freeze({
        ...hostResolution,
        // Keep the exact same executable path while making the retained
        // physical identity fence report its post-bind mutation.
        verifyExecutable: () => !mutated && hostResolution.verifyExecutable()
      })
    });
    expect(providerResolution.session.gitExecutableIdentity?.path)
      .toBe(hostResolution.gitExecutableIdentity.path);
    const spawnKinds: Array<'git-read' | 'git-config'> = [];
    let configSpawnCountAtMutation = -1;
    const result = await installGitHooks({
      repoRoot,
      lifecycle: true,
      providerResolutionForTest: providerResolution,
      beforeSpawnForTest: (kind) => spawnKinds.push(kind),
      configActorBeforeEffect: (stepIndex) => {
        if (stepIndex !== 0) return;
        configSpawnCountAtMutation = spawnKinds.filter((kind) => kind === 'git-config').length;
        mutated = true;
      }
    });
    expect(result.status).toBe('conflict');
    expect(result.message).toContain('canonical Git executable identity changed');
    expect(configSpawnCountAtMutation).toBe(0);
    expect(spawnKinds.filter((kind) => kind === 'git-config')).toHaveLength(configSpawnCountAtMutation);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
}, { timeout: 30_000 });

test('hook installer lifecycle skips CI and Gitless environments while explicit install fails', async () => {
  const gitlessRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-gitless-'));
  try {
    await writeFile(path.join(gitlessRoot, '.git'), 'gitdir: missing\n', 'utf8');
    expect(await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'true' }
    })).toBe(0);
    const gitlessLifecycleResult = await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    });
    // On Windows the provider gate is authoritative even before Git can
    // classify the checkout as Gitless; an unknown/unsupported provider is a
    // typed failure, never a successful lifecycle skip. POSIX keeps the
    // historical Gitless no-op because its host-local provider is independent.
    expect(gitlessLifecycleResult).toBe(process.platform === 'win32' ? 1 : 0);
    expect(await installGitHooksMain({
      argv: [],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(1);
  } finally {
    await rm(gitlessRoot, { recursive: true, force: true });
  }
});
