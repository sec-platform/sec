import { expect, test } from 'bun:test';
import { chmod, lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredBootstrapHooksPath, configuredManagedHooksPath, git, installGitHooks, installGitHooksInIsolatedProcess, managedHookSource, withRepository } from './fixtures/install-git-hooks.ts';
test('unknown managed generations remain retained and bounded capacity blocks new cleanup', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const commonRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    const unknownGenerations = Array.from({ length: 8 }, (_, index) => path.join(
      commonRoot,
      `generation-${String(index + 1).padStart(64, '0')}`
    ));
    await mkdir(unknownGenerations[0]!);
    git(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'false']);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'installed' });
    expect((await lstat(unknownGenerations[0]!)).isDirectory()).toBe(true);

    for (const generation of unknownGenerations.slice(1)) await mkdir(generation);
    git(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'false']);
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    for (const generation of unknownGenerations) {
      expect((await lstat(generation)).isDirectory()).toBe(true);
    }
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
  });
});

test('linked hook installation reserves only a missing generation when bootstrap already exists', async () => {
  await withRepository(async (repoRoot) => {
    const linkedRoot = path.join(path.dirname(repoRoot), 'l');
    try {
      await writeFile(path.join(repoRoot, '.gitattributes'), '/.githooks/* text eol=lf\n', 'utf8');
      git(repoRoot, ['add', '.gitattributes']);
      git(repoRoot, ['commit', '--quiet', '-m', 'keep hook fixture LF']);
      git(repoRoot, ['worktree', 'add', '--quiet', '-b', 'linked-capacity', linkedRoot]);
      const linkedPostMerge = path.join(linkedRoot, '.githooks', 'post-merge');
      await writeFile(linkedPostMerge, `${managedHookSource('post-merge')}# linked-capacity\n`, 'utf8');
      await chmod(linkedPostMerge, 0o755);
      git(linkedRoot, ['add', '.githooks/post-merge']);
      git(linkedRoot, ['update-index', '--chmod=+x', '.githooks/post-merge']);
      expect(installGitHooksInIsolatedProcess(repoRoot)).toMatchObject({ status: 'installed' });
      const bootstrapGeneration = configuredBootstrapHooksPath(repoRoot);
      const commonRoot = path.join(path.resolve(git(repoRoot, [
        'rev-parse', '--path-format=absolute', '--git-common-dir'
      ])), 'sec-managed-hooks-v3');
      const unrelated = Array.from({ length: 6 }, (_, index) => path.join(
        commonRoot, `generation-${String(index + 1).padStart(64, '0')}`
      ));
      for (const generation of unrelated) await mkdir(generation);

      expect(installGitHooksInIsolatedProcess(linkedRoot, true))
        .toMatchObject({ status: 'installed' });
      expect(configuredBootstrapHooksPath(repoRoot)).toBe(bootstrapGeneration);
      expect(configuredManagedHooksPath(linkedRoot)).not.toBe(bootstrapGeneration);
      for (const generation of unrelated) {
        expect((await lstat(generation)).isDirectory()).toBe(true);
      }
      expect((await readdir(commonRoot)).filter((name) => name.startsWith('generation-')))
        .toHaveLength(8);
    } finally {
      git(repoRoot, ['worktree', 'remove', '--force', linkedRoot]);
    }
  });
}, { timeout: 30_000 });
