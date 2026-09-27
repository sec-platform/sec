import { expect, test } from 'bun:test';
import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, managedHookNames, tryCreateLink, withRepository } from './fixtures/install-git-hooks.ts';
test('hook installer never treats same-size same-mtime source mutation as current tracked bytes', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const original = await readFile(sourcePath, 'utf8');
    const originalStat = await stat(sourcePath);
    const originalMtime = new Date(Math.round(originalStat.mtimeMs));
    const mutated = original.replace('set -eu', 'set -ux');
    expect(mutated).not.toBe(original);
    expect(Buffer.byteLength(mutated)).toBe(Buffer.byteLength(original));
    await writeFile(sourcePath, mutated, 'utf8');
    await chmod(sourcePath, 0o755);
    await utimes(sourcePath, originalStat.atime, originalMtime);
    const restoredMetadata = await stat(sourcePath);
    expect(restoredMetadata.size).toBe(originalStat.size);
    expect(Math.round(restoredMetadata.mtimeMs)).toBe(originalMtime.getTime());

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);

    await writeFile(sourcePath, mutated, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);
    await utimes(sourcePath, originalStat.atime, originalMtime);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const reboundGeneration = configuredManagedHooksPath(repoRoot);
    expect(reboundGeneration).not.toBe(previousGeneration);
    await expectManagedHooksMirror(repoRoot, reboundGeneration);
  });
});

test('generation publication stops on common namespace replacement and preserves the replacement', async () => {
  await withRepository(async (repoRoot) => {
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const commonRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    const retainedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3-publication-retained');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    const probe = path.join(commonGitDir, 'sec-hooks-link-probe');
    if (!await tryCreateLink(commonRoot, probe, linkType)) return;
    await rm(probe, { recursive: true, force: true });
    let replaced = false;
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      beforeGenerationPublication: (commonRootPath) => {
        if (replaced) return;
        replaced = true;
        renameSync(commonRootPath, retainedRoot);
        symlinkSync(retainedRoot, commonRootPath, linkType);
      }
    })).toMatchObject({ status: 'conflict' });
    expect((await lstat(commonRoot)).isSymbolicLink()).toBe(true);
    expect(await readdir(retainedRoot)).not.toHaveLength(0);
  });
});

test('generation cleanup stops on validation-to-delete replacement and preserves the replacement', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const commonRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    const digest = /^generation-([0-9a-f]{64})/u.exec(path.basename(previousGeneration))?.[1];
    expect(digest).toBeDefined();
    const duplicateGeneration = path.join(
      commonRoot,
      `generation-${digest}-11111111-1111-1111-1111-111111111111`
    );
    await mkdir(duplicateGeneration);
    for (const hook of managedHookNames) {
      await writeFile(
        path.join(duplicateGeneration, hook),
        await readFile(path.join(previousGeneration, hook))
      );
      await chmod(path.join(duplicateGeneration, hook), 0o755);
    }
    // Force the normal transition path while keeping the exact source digest;
    // the duplicate is therefore an owned, byte-identical stale generation.
    git(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'false']);
    const replacedBytes = '#!/usr/bin/env sh\nexit 42\n';
    let replaced = false;
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      beforeGenerationCleanup: (generationPath) => {
        if (replaced || path.resolve(generationPath) !== path.resolve(duplicateGeneration)) return;
        replaced = true;
        const retained = path.join(repoRoot, 'retained-old-pre-commit');
        renameSync(path.join(generationPath, 'pre-commit'), retained);
        const replacement = path.join(generationPath, '.replacement-pre-commit');
        writeFileSync(replacement, replacedBytes, 'utf8');
        renameSync(replacement, path.join(generationPath, 'pre-commit'));
      }
    })).toMatchObject({ status: 'conflict' });
    expect(await readFile(path.join(duplicateGeneration, 'pre-commit'), 'utf8')).toBe(replacedBytes);
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
  });
});
