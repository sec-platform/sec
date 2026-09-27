import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('concurrent hook publishers converge without a mixed managed generation', async () => {
  await withRepository(async (repoRoot) => {
    const outcomes = await Promise.allSettled([
      installGitHooks({ repoRoot }),
      installGitHooks({ repoRoot })
    ]);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(String(outcome.reason)).toMatch(/Git hook transition conflict|config/u);
      }
    }
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('config transition resumes after every effect-before-receipt interruption', async () => {
  for (const step of [0, 1, 2]) {
    await withRepository(async (repoRoot) => {
      expect(await installGitHooks({
        repoRoot,
        lifecycle: true,
        crashAfterConfigStep: step
      })).toMatchObject({ status: 'conflict' });
      expect(await configTransitionNames(repoRoot)).toHaveLength(1);
      expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
      expect(await configTransitionNames(repoRoot)).toHaveLength(0);
      await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
    });
  }
}, { timeout: 60000 });

test('config transition intent survives interruption before its first effect', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterConfigIntent: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('generation publication is durably prepared before its first directory effect', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterGenerationPublication: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const managedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    const transition = (await readdir(managedRoot, { withFileTypes: true }))
      .find((entry) => entry.name.startsWith('config-transition-'));
    expect(transition).toBeDefined();
    expect(await readdir(path.join(managedRoot, transition!.name))).toContain('prepared');
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});
