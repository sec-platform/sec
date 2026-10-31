import { expect, test } from 'bun:test';

import { configTransitionNames, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('external config matching the intended after-state cannot authorize the pending provider effect', async () => {
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
});
