import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { delimiter } from 'node:path';

import { expect, test } from 'bun:test';

import { installGitHooks, installGitHooksMain } from '../../scripts/install-git-hooks.ts';

// Real repository, linked-worktree, and managed-hook lifecycle acceptance belongs to the slow lane.

const managedHookNames = ['pre-commit', 'pre-push', 'post-checkout', 'post-merge', 'post-rewrite'] as const;
const depsEnsureCommand = 'bun ./platform/dev-runner.ts deps:ensure';
const hooksReconcileCommand = 'bun ./scripts/install-git-hooks.ts --lifecycle';
const importsFreezeCommand = 'bun ./platform/dev-runner.ts imports:freeze';

function runtimeBoundCommand(command: string): string {
  const executable = process.platform === 'win32' ? process.execPath.replaceAll('\\', '/') : process.execPath;
  const quoted = `'${executable.replaceAll("'", `'"'"'`)}'`;
  return `${quoted}${command.slice('bun'.length)}`;
}

function managedHookSource(hook: typeof managedHookNames[number]): string {
  return hook === 'pre-commit' || hook === 'pre-push'
    ? `#!/usr/bin/env sh\nset -eu\n\n${importsFreezeCommand}\n`
    : [
      '#!/usr/bin/env sh',
      'set -eu',
      '',
      'export SEC_GIT_HOOK_ACTIVE=1',
      '',
      'if [ -f ./scripts/install-git-hooks.ts ]; then',
      `  ${hooksReconcileCommand}`,
      'fi',
      'if [ -f ./platform/dev-runner.ts ]; then',
      `  ${depsEnsureCommand}`,
      'fi',
      ''
    ].join('\n');
}

function git(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function configuredManagedHooksPath(repoRoot: string): string {
  const worktreeConfigPath = path.resolve(git(
    repoRoot,
    ['rev-parse', '--path-format=absolute', '--git-path', 'config.worktree']
  ));
  const configured = path.resolve(git(
    repoRoot,
    ['config', '--file', worktreeConfigPath, '--path', '--get', 'core.hooksPath']
  ));
  const commonGitDir = path.resolve(git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  expect(path.dirname(configured)).toBe(path.join(commonGitDir, 'sec-managed-hooks-v3'));
  expect(path.basename(configured)).toMatch(/^generation-[0-9a-f]{64}(?:-[0-9a-f-]{36})?$/u);
  return configured;
}

function configuredBootstrapHooksPath(repoRoot: string): string {
  const configured = path.resolve(git(repoRoot, ['config', '--local', '--path', '--get', 'core.hooksPath']));
  const commonGitDir = path.resolve(git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  expect(path.dirname(configured)).toBe(path.join(commonGitDir, 'sec-managed-hooks-v3'));
  return configured;
}

async function expectManagedHooksMirror(repoRoot: string, configured: string): Promise<void> {
  for (const hook of managedHookNames) {
    const source = await readFile(path.join(repoRoot, '.githooks', hook), 'utf8');
    const injected = hook === 'pre-commit' || hook === 'pre-push'
      ? source.replace(importsFreezeCommand, `${depsEnsureCommand}\n${importsFreezeCommand}`)
      : source;
    const expected = injected
      .replaceAll(depsEnsureCommand, runtimeBoundCommand(depsEnsureCommand))
      .replaceAll(hooksReconcileCommand, runtimeBoundCommand(hooksReconcileCommand))
      .replaceAll(importsFreezeCommand, runtimeBoundCommand(importsFreezeCommand));
    const installed = await readFile(path.join(configured, hook), 'utf8');
    expect(installed).toBe(expected);
    expect(installed).not.toMatch(/(?:^|\n)bun \.\/platform\/dev-runner\.ts/u);
    if (hook === 'pre-commit' || hook === 'pre-push') {
      expect(source).not.toContain(depsEnsureCommand);
      expect(installed.indexOf(runtimeBoundCommand(depsEnsureCommand)))
        .toBeLessThan(installed.indexOf(runtimeBoundCommand(importsFreezeCommand)));
    }
  }
}

async function withRepository(run: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-install-'));
  try {
    git(repoRoot, ['init', '--quiet']);
    await mkdir(path.join(repoRoot, '.githooks'));
    await Promise.all(managedHookNames.map(async (hook) => {
      const hookPath = path.join(repoRoot, '.githooks', hook);
      await writeFile(hookPath, managedHookSource(hook), 'utf8');
      await chmod(hookPath, 0o755);
    }));
    git(repoRoot, ['add', '.githooks']);
    for (const hook of managedHookNames) {
      git(repoRoot, ['update-index', '--chmod=+x', `.githooks/${hook}`]);
    }
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

test('hook installer configures unset authority idempotently', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    expect(path.resolve(git(repoRoot, ['config', '--get', 'core.hooksPath']))).toBe(configured);
    expect(configuredBootstrapHooksPath(repoRoot)).toBe(configured);
    expect(git(repoRoot, ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig'])).toBe('true');
    await expectManagedHooksMirror(repoRoot, configured);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(configured);
  });
});

test('hook installer repairs mutated installed bytes instead of trusting its marker', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    await writeFile(path.join(configured, 'pre-commit'), '#!/usr/bin/env sh\nexit 42\n', 'utf8');
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const repaired = configuredManagedHooksPath(repoRoot);
    expect(repaired).not.toBe(configured);
    await expectManagedHooksMirror(repoRoot, repaired);
  });
});

test('hook installer replaces a stale missing managed path', async () => {
  await withRepository(async (repoRoot) => {
    const staleHooks = path.join(repoRoot, 'missing-hooks');
    git(repoRoot, ['config', '--local', 'core.hooksPath', staleHooks]);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    expect(path.resolve(git(repoRoot, ['config', '--get', 'core.hooksPath']))).toBe(configured);
    expect(configuredBootstrapHooksPath(repoRoot)).toBe(configured);
    await expectManagedHooksMirror(repoRoot, configured);
  });
});

test('hook installer migrates the legacy tracked hooks path', async () => {
  await withRepository(async (repoRoot) => {
    git(repoRoot, ['config', '--local', 'core.hooksPath', '.githooks']);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    expect(configuredManagedHooksPath(repoRoot)).not.toBe(path.join(repoRoot, '.githooks'));
  });
});

test('managed hooks execute the installed Bun identity without inheriting its PATH entry', async () => {
  await withRepository(async (repoRoot) => {
    const runnerRoot = path.join(repoRoot, 'platform');
    await mkdir(runnerRoot);
    await writeFile(path.join(runnerRoot, 'dev-runner.ts'), [
      "const marker = process.env.SEC_HOOK_RUNTIME_MARKER;",
      "if (!marker) throw new Error('missing hook marker');",
      "const command = process.argv[2]?.replace(':', '-') ?? 'missing';",
      "await Bun.write(`${marker}.${command}`, process.execPath);",
      ''
    ].join('\n'), 'utf8');
    git(repoRoot, ['add', 'platform/dev-runner.ts']);
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
    expect(await readFile(`${marker}.deps-ensure`, 'utf8')).toBe(process.execPath);
    expect(await readFile(`${marker}.imports-freeze`, 'utf8')).toBe(process.execPath);
  });
});

test('hook installer migrates an otherwise valid v1 generation to v3 authority', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    const commonGitDir = path.resolve(git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    const legacyGeneration = path.join(
      commonGitDir,
      'sec-managed-hooks-v1',
      `generation-${'a'.repeat(64)}`
    );
    await mkdir(legacyGeneration, { recursive: true });
    await Promise.all(managedHookNames.map(async (hook) => {
      const legacyHook = path.join(legacyGeneration, hook);
      await writeFile(legacyHook, await readFile(path.join(currentGeneration, hook)));
      await chmod(legacyHook, 0o755);
    }));
    git(repoRoot, ['config', '--local', 'core.hooksPath', legacyGeneration]);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(currentGeneration);
    expect(path.resolve(git(repoRoot, ['config', '--get', 'core.hooksPath']))).not.toBe(legacyGeneration);
    await expectManagedHooksMirror(repoRoot, currentGeneration);
  });
});

test('hook installer preserves an effective worktree authority in explicit and lifecycle modes', async () => {
  await withRepository(async (repoRoot) => {
    const customHooks = path.join(repoRoot, 'custom-hooks');
    await mkdir(customHooks);
    git(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
    git(repoRoot, ['config', '--worktree', 'core.hooksPath', customHooks]);

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('Existing Git hook authority is preserved');
    expect(git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(customHooks);

    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(customHooks);
  });
});

test('hook installer audits default hooks and preserves a non-sample authority', async () => {
  await withRepository(async (repoRoot) => {
    const defaultHook = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
    await writeFile(defaultHook, '#!/usr/bin/env sh\nexit 0\n', 'utf8');

    await expect(installGitHooks({ repoRoot })).rejects.toThrow(defaultHook);
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('hook installer requires the tracked managed hook before configuring authority', async () => {
  await withRepository(async (repoRoot) => {
    git(repoRoot, ['rm', '--cached', '--quiet', '.githooks/pre-commit']);
    await rm(path.join(repoRoot, '.githooks', 'pre-commit'));

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('index-identical managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withRepository(async (repoRoot) => {
    git(repoRoot, ['update-index', '--chmod=-x', '.githooks/pre-commit']);

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('index-identical managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withRepository(async (repoRoot) => {
    await writeFile(path.join(repoRoot, '.githooks', 'pre-commit'), '#!/usr/bin/env sh\nexit 42\n', 'utf8');

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('index-identical managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('hook installer lifecycle skips CI and Gitless environments while explicit install fails', async () => {
  const gitlessRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-gitless-'));
  try {
    await writeFile(path.join(gitlessRoot, '.git'), 'gitdir: missing\n', 'utf8');
    expect(await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'true' }
    })).toBe(0);
    expect(await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(0);
    expect(await installGitHooksMain({
      argv: [],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(1);
  } finally {
    await rm(gitlessRoot, { recursive: true, force: true });
  }
});

test('hook installer keeps primary bootstrap and linked worktree generations independent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-linked-'));
  const repoRoot = path.join(root, 'main');
  const linkedRoot = path.join(root, 'linked');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    await mkdir(path.join(repoRoot, '.githooks'));
    await writeFile(path.join(repoRoot, '.gitattributes'), '/.githooks/* text eol=lf\n', 'utf8');
    await writeFile(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
    await Promise.all(managedHookNames.map(async (hook) => {
      const hookPath = path.join(repoRoot, '.githooks', hook);
      await writeFile(hookPath, managedHookSource(hook), 'utf8');
      await chmod(hookPath, 0o755);
    }));
    git(repoRoot, ['add', '.gitattributes', 'README.md', '.githooks']);
    for (const hook of managedHookNames) {
      git(repoRoot, ['update-index', '--chmod=+x', `.githooks/${hook}`]);
    }
    git(repoRoot, ['commit', '--quiet', '-m', 'initial']);
    const staleHooks = path.join(root, 'missing-shared-hooks');
    git(repoRoot, ['config', '--local', 'core.hooksPath', staleHooks]);
    git(repoRoot, ['worktree', 'add', '--quiet', '-b', 'linked-fixture', linkedRoot]);
    const linkedPostMerge = path.join(linkedRoot, '.githooks', 'post-merge');
    await writeFile(linkedPostMerge, `${managedHookSource('post-merge')}# linked-branch-hook\n`, 'utf8');
    await chmod(linkedPostMerge, 0o755);
    git(linkedRoot, ['add', '.githooks/post-merge']);
    git(linkedRoot, ['update-index', '--chmod=+x', '.githooks/post-merge']);

    expect(await installGitHooks({ repoRoot: linkedRoot })).toMatchObject({ status: 'installed' });

    const linkedGeneration = configuredManagedHooksPath(linkedRoot);
    const bootstrapGeneration = configuredBootstrapHooksPath(repoRoot);
    expect(linkedGeneration).not.toBe(bootstrapGeneration);
    expect(path.resolve(git(linkedRoot, ['config', '--get', 'core.hooksPath']))).toBe(linkedGeneration);
    expect(path.resolve(git(repoRoot, ['config', '--get', 'core.hooksPath']))).toBe(bootstrapGeneration);
    expect(() => git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toThrow();
    await expectManagedHooksMirror(linkedRoot, linkedGeneration);
    await expectManagedHooksMirror(repoRoot, bootstrapGeneration);
    expect(await readFile(path.join(linkedGeneration, 'post-merge'), 'utf8')).toContain('# linked-branch-hook');
    expect(await readFile(path.join(bootstrapGeneration, 'post-merge'), 'utf8')).not.toContain('# linked-branch-hook');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('repository-common hook generation runs when an older worktree creates the first checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-first-checkout-'));
  const repoRoot = path.join(root, 'main');
  const olderRoot = path.join(root, 'older');
  const linkedRoot = path.join(root, 'linked');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    await writeFile(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['commit', '--quiet', '-m', 'older checkout without managed hooks']);
    const olderHead = git(repoRoot, ['rev-parse', 'HEAD']);

    await mkdir(path.join(repoRoot, '.githooks'));
    await mkdir(path.join(repoRoot, 'scripts'));
    await writeFile(
      path.join(repoRoot, 'scripts', 'install-git-hooks.ts'),
      await readFile(path.resolve(import.meta.dir, '../../scripts/install-git-hooks.ts'))
    );
    await writeFile(path.join(repoRoot, '.gitattributes'), '/.githooks/* text eol=lf\n', 'utf8');
    await Promise.all(managedHookNames.map(async (hook) => {
      const hookPath = path.join(repoRoot, '.githooks', hook);
      await writeFile(
        hookPath,
        hook === 'post-checkout'
          ? `${managedHookSource(hook)}printf first-checkout > .dependency-bootstrap-marker\n`
          : managedHookSource(hook),
        'utf8'
      );
      await chmod(hookPath, 0o755);
    }));
    git(repoRoot, ['add', '.gitattributes', 'README.md', '.githooks', 'scripts/install-git-hooks.ts']);
    for (const hook of managedHookNames) {
      git(repoRoot, ['update-index', '--chmod=+x', `.githooks/${hook}`]);
    }
    git(repoRoot, ['commit', '--quiet', '-m', 'install managed hooks']);
    const managedHead = git(repoRoot, ['rev-parse', 'HEAD']);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    git(repoRoot, ['worktree', 'add', '--quiet', '--detach', olderRoot, olderHead]);
    await rm(path.join(olderRoot, '.dependency-bootstrap-marker'), { force: true });
    expect(() => git(olderRoot, ['ls-files', '--error-unmatch', '.githooks/post-checkout'])).toThrow();

    git(olderRoot, ['worktree', 'add', '--quiet', '-b', 'linked-first-checkout', linkedRoot, managedHead]);

    expect(await readFile(path.join(linkedRoot, '.dependency-bootstrap-marker'), 'utf8')).toBe('first-checkout');
    expect(path.resolve(git(linkedRoot, ['config', '--local', '--get', 'core.hooksPath']))).toBe(configured);
    const linkedGeneration = configuredManagedHooksPath(linkedRoot);
    expect(linkedGeneration).not.toBe(configured);
    expect(path.resolve(git(linkedRoot, ['config', '--get', 'core.hooksPath']))).toBe(linkedGeneration);
    await expectManagedHooksMirror(linkedRoot, linkedGeneration);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
