import { expect, test } from 'bun:test';
import { chmod, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, runtimeBoundCommand, withRepository, workspaceTransitionCommand } from './fixtures/install-git-hooks.ts';
test('hook marker remains bound to raw index bytes when deployment bytes normalize', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    const markerPath = path.join(path.dirname(configured), '.last-install');
    const previousMarker = await readFile(markerPath, 'utf8');
    const sourcePath = path.join(repoRoot, '.githooks', 'post-merge');
    const original = await readFile(sourcePath, 'utf8');
    const normalized = original.replace(
      workspaceTransitionCommand,
      runtimeBoundCommand(workspaceTransitionCommand)
    );
    expect(normalized).not.toBe(original);
    await writeFile(sourcePath, normalized, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/post-merge']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/post-merge']);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const rebound = configuredManagedHooksPath(repoRoot);
    expect(rebound).not.toBe(configured);
    expect(await readFile(markerPath, 'utf8')).not.toBe(previousMarker);
    await expectManagedHooksMirror(repoRoot, rebound);
  });
});

test('same-digest generation with transform-shaped bytes is repaired as an exact prior', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const transformedSource = await readFile(path.join(repoRoot, '.githooks', 'post-merge'));
    await writeFile(path.join(previousGeneration, 'post-merge'), transformedSource);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const repairedGeneration = configuredManagedHooksPath(repoRoot);
    expect(repairedGeneration).not.toBe(previousGeneration);
    await expectManagedHooksMirror(repoRoot, repairedGeneration);
    await expect(lstat(previousGeneration)).rejects.toThrow();
  });
});

test('marker and configured hooksPath mismatch is retained and typed', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    const markerPath = path.join(path.dirname(configured), '.last-install');
    const marker = (await readFile(markerPath, 'utf8')).split('\n');
    const digest = marker[0];
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    marker[2] = `generation-${digest}-00000000-0000-0000-0000-000000000001`;
    await writeFile(markerPath, marker.join('\n'), 'utf8');

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(configured);
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    expect((await readFile(markerPath, 'utf8')).split('\n')[2]).toBe(marker[2]);
  });
});
