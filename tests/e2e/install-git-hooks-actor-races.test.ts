import { expect, test } from 'bun:test';

import { configTransitionNames, configuredManagedHooksPath, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('external config actor preimage race is preserved and typed before any effect overwrite', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      configActorBeforeEffect: (stepIndex, actorRoot) => {
        if (stepIndex === 0) {
          git(actorRoot, ['config', '--local', 'extensions.worktreeConfig', 'false']);
        }
      }
    })).toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig']))
      .toBe('false');
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
  });
});

test('external same-content config replacement and ABA are preserved before provider effect', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      configActorBeforeEffect: (stepIndex, actorRoot) => {
        if (stepIndex === 0) {
          git(actorRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
        }
      }
    })).toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig']))
      .toBe('true');
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
  });

  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      configActorBeforeEffect: (stepIndex, actorRoot) => {
        if (stepIndex === 0) {
          git(actorRoot, ['config', '--local', 'extensions.worktreeConfig', 'false']);
          git(actorRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
        }
      }
    })).toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig']))
      .toBe('true');
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
  });
});

test('config transition recovery is idempotent after a durable receipt is recovered', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterConfigStep: 1
    })).toMatchObject({ status: 'conflict' });
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(configured);
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
  });
});
