import { expect, test } from 'bun:test';
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('unknown or forked config transition namespaces are retained and block reuse', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const foreignTransition = path.join(
      commonGitDir,
      'sec-managed-hooks-v3',
      'config-transition-' + 'f'.repeat(64)
    );
    await mkdir(foreignTransition);
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await readdir(path.dirname(foreignTransition))).toContain(path.basename(foreignTransition));
  });
});

test('marker-publication recovery settles both initial and prior-generation cases after source updates', async () => {
  await withRepository(async (repoRoot) => {
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');

    // First exercise the interrupted initial bootstrap, with no prior generation.
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    const interruptedInitialGeneration = configuredManagedHooksPath(repoRoot);
    const initialSource = await readFile(sourcePath, 'utf8');
    const firstUpdatedSource = initialSource.replace('set -eu', 'set -ux');
    expect(firstUpdatedSource).not.toBe(initialSource);
    await writeFile(sourcePath, firstUpdatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const recoveredInitialGeneration = configuredManagedHooksPath(repoRoot);
    expect(recoveredInitialGeneration).not.toBe(interruptedInitialGeneration);
    await expect(lstat(interruptedInitialGeneration)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, recoveredInitialGeneration);

    // Then repeat the same crash cut while a valid prior generation is live.
    const previousGeneration = recoveredInitialGeneration;
    const sourceBeforeReplacement = await readFile(sourcePath, 'utf8');
    const replacementSource = sourceBeforeReplacement.replace('set -ux', 'set -uxx');
    expect(replacementSource).not.toBe(sourceBeforeReplacement);
    await writeFile(sourcePath, replacementSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect((await lstat(previousGeneration)).isDirectory()).toBe(true);

    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    expect(currentGeneration).not.toBe(previousGeneration);
    await expect(lstat(previousGeneration)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, currentGeneration);
  });
});
