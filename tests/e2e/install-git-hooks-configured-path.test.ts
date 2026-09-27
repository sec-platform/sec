import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path, { delimiter } from 'node:path';
import { DEV_RUNNER_ENTRYPOINT_PATH } from '../../src/adapters/self-hosting/development/runner/contract.ts';

import { git, installGitHooks, tryCreateLink, withRepository } from './fixtures/install-git-hooks.ts';
test('hook installer preserves an explicit missing non-managed hooks path', async () => {
  await withRepository(async (repoRoot) => {
    const staleHooks = path.join(repoRoot, 'missing-hooks');
    git(repoRoot, ['config', '--local', 'core.hooksPath', staleHooks]);
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--local', '--get', 'core.hooksPath'])).toBe(staleHooks);
  });
});

test('hook installer preserves an explicit missing worktree hooks path', async () => {
  await withRepository(async (repoRoot) => {
    const worktreeConfigPath = path.resolve(git(
      repoRoot,
      ['rev-parse', '--path-format=absolute', '--git-path', 'config.worktree']
    ));
    const staleHooks = path.join(repoRoot, 'missing-worktree-hooks');
    git(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
    git(repoRoot, ['config', '--worktree', 'core.hooksPath', staleHooks]);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--file', worktreeConfigPath, '--get', 'core.hooksPath']))
      .toBe(staleHooks);
  });
});

test('hook installer preserves an explicit broken symlink hooks path', async () => {
  await withRepository(async (repoRoot) => {
    const staleHooks = path.join(repoRoot, 'broken-hooks');
    const missingTarget = path.join(repoRoot, 'missing-hooks-target');
    if (!await tryCreateLink(
      missingTarget,
      staleHooks,
      process.platform === 'win32' ? 'junction' : 'dir'
    )) return;
    git(repoRoot, ['config', '--local', 'core.hooksPath', staleHooks]);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect((await lstat(staleHooks)).isSymbolicLink()).toBe(true);
    expect(git(repoRoot, ['config', '--local', '--get', 'core.hooksPath'])).toBe(staleHooks);
  });
});

test('managed hooks execute the installed Bun identity without inheriting its PATH entry', async () => {
  await withRepository(async (repoRoot) => {
    const runnerRoot = path.join(repoRoot, 'src', 'development', 'runner');
    await mkdir(runnerRoot, { recursive: true });
    await copyFile(
      path.resolve(import.meta.dir, '../helpers/hook-runtime-runner.ts'),
      path.join(runnerRoot, 'cli.ts')
    );
    await writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({
      scripts: {
        'imports:check': `bun ./${DEV_RUNNER_ENTRYPOINT_PATH} imports:check`
      }
    }), 'utf8');
    git(repoRoot, ['add', 'package.json', DEV_RUNNER_ENTRYPOINT_PATH]);
    git(repoRoot, ['commit', '--quiet', '-m', 'add hook runtime fixture']);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const marker = path.join(repoRoot, 'hook-runtime-marker');
    await writeFile(path.join(repoRoot, 'candidate.txt'), 'candidate\n', 'utf8');
    git(repoRoot, ['add', 'candidate.txt']);

    const pathKey = Object.keys(process.env).find((key) => key.toLocaleLowerCase('en-US') === 'path') ?? 'PATH';
    const runtimeDirectory = path.dirname(process.execPath);
    const hookPath = (process.env[pathKey] ?? '').split(delimiter)
      .filter((entry) => entry.length > 0 && path.resolve(entry) !== runtimeDirectory)
      .join(delimiter);
    const committed = spawnSync('git', ['commit', '--quiet', '-m', 'run managed hooks'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        [pathKey]: hookPath,
        SEC_HOOK_RUNTIME_MARKER: marker
      },
      windowsHide: true
    });
    expect(committed.status).toBe(0);
    expect(await readFile(`${marker}.imports-check`, 'utf8')).toBe(process.execPath);
    await expect(readFile(`${marker}.deps-ensure`, 'utf8')).rejects.toThrow();
  });
});
