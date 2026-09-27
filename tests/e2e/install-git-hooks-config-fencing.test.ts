import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredManagedHooksPath, git, hostProviderResolutionForTest, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('ambient Git environment mutation after provider binding is typed before config effect', async () => {
  await withRepository(async (repoRoot) => {
    const originalPath = process.env.PATH;
    try {
      expect(await installGitHooks({
        repoRoot,
        lifecycle: true,
        configActorBeforeEffect: (stepIndex) => {
          if (stepIndex === 0) process.env.PATH = (originalPath ?? '') + path.delimiter + repoRoot;
        }
      })).toMatchObject({ status: 'conflict' });
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
  });
});

test('foreign Git config lock in the final-read to provider-lock window is preserved', async () => {
  await withRepository(async (repoRoot) => {
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const lockPath = path.join(commonGitDir, 'config.lock');
    const foreignBytes = 'foreign provider lock\n';
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      configActorBeforeEffect: (stepIndex) => {
        if (stepIndex === 0) writeFileSync(lockPath, foreignBytes, 'utf8');
      }
    })).toMatchObject({ status: 'conflict' });
    expect(await readFile(lockPath, 'utf8')).toBe(foreignBytes);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
  });
});

test('hook installer ignores ambient Git repository, replacement, lock, and config poisoning', async () => {
  await withRepository(async (repoRoot) => {
    const poisoned: Record<string, string> = {
      GIT_DIR: path.join(repoRoot, 'foreign.git'),
      GIT_WORK_TREE: path.join(repoRoot, 'foreign-worktree'),
      GIT_INDEX_FILE: path.join(repoRoot, 'foreign-index'),
      GIT_COMMON_DIR: path.join(repoRoot, 'foreign-common'),
      GIT_OBJECT_DIRECTORY: path.join(repoRoot, 'foreign-objects'),
      GIT_CONFIG_GLOBAL: path.join(repoRoot, 'foreign-global'),
      GIT_CONFIG_SYSTEM: path.join(repoRoot, 'foreign-system'),
      GIT_CONFIG_NOSYSTEM: '0',
      GIT_NO_REPLACE_OBJECTS: '0',
      GIT_OPTIONAL_LOCKS: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: path.join(repoRoot, 'foreign-hooks')
    };
    const providerResolution = process.platform === 'win32'
      ? hostProviderResolutionForTest(repoRoot)
      : undefined;
    let poisonedAtSpawn = false;
    const previous = new Map<string, string | undefined>(
      Object.keys(poisoned).map((key) => [key, process.env[key]])
    );
    try {
      expect(await installGitHooks({
        repoRoot,
        providerResolutionForTest: providerResolution,
        beforeSpawnForTest: () => {
          if (poisonedAtSpawn) return;
          poisonedAtSpawn = true;
          Object.assign(process.env, poisoned);
        }
      })).toMatchObject({ status: 'installed' });
      expect(poisonedAtSpawn).toBe(true);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    expect(configuredManagedHooksPath(repoRoot)).toBe(path.resolve(git(
      repoRoot,
      ['config', '--get', 'core.hooksPath']
    )));
  });
});
