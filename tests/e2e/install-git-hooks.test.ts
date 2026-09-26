import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { delimiter } from 'node:path';

import { expect, test } from 'bun:test';

import {
  createHostGitReadSessionForTests,
  type GitReadSessionResolution
} from '../../src/adapters/providers/git-read/test/session.ts';
import { acquirePhysicalMutationLease } from '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  installGitHooksForTest as installGitHooksImplementation,
  installGitHooksMain,
  installGitHooks as installGitHooksProduction
} from '../../src/adapters/self-hosting/development/hooks/install.ts';
import { DEV_RUNNER_ENTRYPOINT_PATH } from '../../src/adapters/self-hosting/development/runner/contract.ts';

// Real repository, linked-worktree, and managed-hook lifecycle acceptance belongs to the slow lane.

const managedHookNames = ['pre-commit', 'pre-push', 'post-checkout', 'post-merge', 'post-rewrite'] as const;
const workspaceTransitionCommand = 'bun run workspace:transition --';
const importsApplyStagedCommand = 'bun run imports:apply --staged';
const importsFreezeCommand = 'bun run imports:freeze';

function installGitHooks(options: {
  readonly repoRoot: string;
  readonly lifecycle?: boolean;
  readonly noRemoteFixture?: boolean;
  readonly providerResolutionForTest?: GitReadSessionResolution;
  readonly beforeSpawnForTest?: (kind: 'git-read' | 'git-config') => void;
  readonly gitBudget?: {
    readonly deadlineMs?: number;
    readonly maxProcesses?: number;
    readonly maxStdoutBytes?: number;
    readonly maxStderrBytes?: number;
    readonly maxRecords?: number;
    readonly maxCommandStdoutBytes?: number;
    readonly maxCommandStderrBytes?: number;
  };
  readonly crashAfterConfigStep?: number;
  readonly configActorBeforeEffect?: (stepIndex: number, repoRoot: string) => void;
  readonly configActorAfterStep?: (stepIndex: number, repoRoot: string) => void;
  readonly beforeGenerationPublication?: (commonRootPath: string) => void;
  readonly beforeGenerationCleanup?: (generationPath: string) => void;
  readonly bootstrapAuthorityActorBeforeConfigEffect?: (repoRoot: string) => void;
  readonly crashAfterMarkerPublication?: boolean;
  readonly crashAfterConfigIntent?: boolean;
  readonly crashAfterConfigPrepared?: boolean;
  readonly crashAfterGenerationPublication?: boolean;
  readonly crashAfterGenerationRetirementDelete?: boolean;
  readonly crashAfterOperationLeaseAcquisition?: boolean;
  readonly leaseOwnerHost?: string;
  readonly leaseOwnerPid?: number;
}): ReturnType<typeof installGitHooksImplementation> {
  return installGitHooksImplementation({
    ...options,
    // The production authority resolver intentionally remains unknown on the
    // current Windows host until its retained root closure is proven.  These
    // isolated test repositories opt into the explicit host-only test seam;
    // this never reaches the production CLI.
    providerResolutionForTest: options.providerResolutionForTest
      ?? (process.platform === 'win32' ? hostProviderResolutionForTest(options.repoRoot) : undefined)
  });
}

function hostProviderResolutionForTest(repoRoot: string): GitReadSessionResolution {
  const session = createHostGitReadSessionForTests({
    cwd: repoRoot,
    // The explicit host seam is only a fixture adapter on Windows.  Give its
    // retained identity fence enough lifetime for the slow filesystem
    // lifecycle assertions; production authority keeps its own bounded
    // provider deadline.
    budget: { deadlineMs: 120_000 }
  });
  if (session.failure !== null || session.gitExecutableIdentity === null) {
    throw new Error('The explicit host Git test provider could not bind a local executable');
  }
  return Object.freeze({
    status: 'ready' as const,
    route: 'host-local-git-v1' as const,
    session
  });
}

async function configTransitionNames(repoRoot: string): Promise<string[]> {
  const commonGitDir = path.resolve(git(repoRoot, [
    'rev-parse', '--path-format=absolute', '--git-common-dir'
  ]));
  const managedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
  return (await readdir(managedRoot, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith('config-transition-'))
    .map((entry) => entry.name)
    .sort();
}

function runtimeBoundCommand(command: string): string {
  const executable = process.platform === 'win32' ? process.execPath.replaceAll('\\', '/') : process.execPath;
  const quoted = `'${executable.replaceAll("'", `'"'"'`)}'`;
  return `${quoted}${command.slice('bun'.length)}`;
}

function managedHookSource(hook: typeof managedHookNames[number]): string {
  return readFileSync(path.resolve(import.meta.dir, '../../.githooks', hook), 'utf8');
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
    const expected = source
      .replaceAll(workspaceTransitionCommand, runtimeBoundCommand(workspaceTransitionCommand))
      .replaceAll(importsApplyStagedCommand, runtimeBoundCommand(importsApplyStagedCommand))
      .replaceAll(importsFreezeCommand, runtimeBoundCommand(importsFreezeCommand));
    const installed = await readFile(path.join(configured, hook), 'utf8');
    expect(installed).toBe(expected);
    expect(installed).not.toMatch(/(?:^|\n)bun \.\/platform\/dev-runner\.ts/u);
    if (hook === 'pre-commit' || hook === 'pre-push') {
      expect(source).not.toContain(workspaceTransitionCommand);
      expect(installed).not.toContain(runtimeBoundCommand(workspaceTransitionCommand));
    }
  }
}

async function withRepository(
  run: (repoRoot: string) => Promise<void>,
  initArgs: readonly string[] = []
): Promise<void> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-install-'));
  try {
    git(repoRoot, ['init', '--quiet', '-b', 'main', ...initArgs]);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
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
    git(repoRoot, ['commit', '--quiet', '-m', 'managed hook fixture']);
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

async function withCanonicalRemoteRepository(
  run: (repoRoot: string, remoteRoot: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-remote-'));
  const repoRoot = path.join(root, 'repo');
  const remoteRoot = path.join(root, 'origin.git');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet', '-b', 'main']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
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
    git(repoRoot, ['commit', '--quiet', '-m', 'canonical remote fixture']);
    git(repoRoot, ['init', '--bare', '--quiet', remoteRoot]);
    git(repoRoot, ['remote', 'add', 'origin', remoteRoot]);
    git(repoRoot, ['push', '--quiet', '--set-upstream', 'origin', 'main']);
    git(remoteRoot, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(repoRoot, ['fetch', '--quiet', 'origin']);
    git(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    await run(repoRoot, remoteRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function tryCreateLink(
  target: string,
  linkPath: string,
  type: 'file' | 'dir' | 'junction'
): Promise<boolean> {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && ['EACCES', 'EPERM', 'ENOTSUP'].includes(code ?? '')) return false;
    throw error;
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

test('hook installer validates the Git SHA-256 blob formula', async () => {
  await withRepository(async (repoRoot) => {
    expect(git(repoRoot, ['rev-parse', '--show-object-format'])).toBe('sha256');
    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  }, ['--object-format=sha256']);
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

test('hook installer never replaces an occupied managed generation root', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    await rm(previousGeneration, { recursive: true, force: true });
    await mkdir(previousGeneration);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(previousGeneration)).isDirectory()).toBe(true);
    const marker = (await readFile(path.join(path.dirname(previousGeneration), '.last-install'), 'utf8'))
      .split('\n');
    expect(marker[2]).toBe(path.basename(previousGeneration));
  });
});

test('hook installer never replaces an occupied managed hook entry', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const occupiedHook = path.join(previousGeneration, 'pre-commit');
    await rm(occupiedHook, { force: true });
    await mkdir(occupiedHook);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(occupiedHook)).isDirectory()).toBe(true);
  });
});

test('hook installer retires a rename-replaced entry only through exact managed lineage evidence', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const occupiedHook = path.join(previousGeneration, 'pre-commit');
    const replacement = path.join(repoRoot, 'replacement-pre-commit');
    const replacementBytes = '#!/usr/bin/env sh\nexit 42\n';
    await writeFile(replacement, replacementBytes, 'utf8');
    await rm(occupiedHook, { force: true });
    await rename(replacement, occupiedHook);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const reboundGeneration = configuredManagedHooksPath(repoRoot);
    expect(reboundGeneration).not.toBe(previousGeneration);
    await expectManagedHooksMirror(repoRoot, reboundGeneration);
    await expect(lstat(previousGeneration)).rejects.toThrow();
  });
});

test('hook installer rejects a symlinked managed generation root without replacing it', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const foreignGeneration = path.join(repoRoot, 'foreign-generation');
    await mkdir(foreignGeneration);
    await rm(previousGeneration, { recursive: true, force: true });
    if (!await tryCreateLink(
      foreignGeneration,
      previousGeneration,
      process.platform === 'win32' ? 'junction' : 'dir'
    )) return;

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(previousGeneration)).isSymbolicLink()).toBe(true);
  });
});

test('hook installer rejects a symlinked managed hook without replacing it', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const occupiedHook = path.join(previousGeneration, 'pre-commit');
    const foreignHook = path.join(repoRoot, 'foreign-pre-commit');
    await writeFile(foreignHook, '#!/usr/bin/env sh\nexit 42\n', 'utf8');
    await rm(occupiedHook, { force: true });
    if (!await tryCreateLink(foreignHook, occupiedHook, 'file')) return;

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(occupiedHook)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignHook, 'utf8')).toBe('#!/usr/bin/env sh\nexit 42\n');
  });
});

test('hook installer rejects repository and common-Git ancestor links before any config effect', async () => {
  let alias: string | null = null;
  try {
    await withRepository(async (repoRoot) => {
      alias = `${repoRoot}-ancestor-alias`;
      if (await tryCreateLink(repoRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')) {
        expect(await installGitHooks({ repoRoot: alias, lifecycle: true }))
          .toMatchObject({ status: 'conflict' });
        expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
      }

      expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
      const commonGitDir = path.resolve(git(repoRoot, [
        'rev-parse', '--path-format=absolute', '--git-common-dir'
      ]));
      const retainedCommonDir = path.join(repoRoot, '.git-retained-for-link-test');
      await rename(commonGitDir, retainedCommonDir);
      if (!await tryCreateLink(
        retainedCommonDir,
        commonGitDir,
        process.platform === 'win32' ? 'junction' : 'dir'
      )) {
        await rename(retainedCommonDir, commonGitDir);
        return;
      }
      expect(await installGitHooks({ repoRoot, lifecycle: true }))
        .toMatchObject({ status: 'conflict' });
      expect((await lstat(commonGitDir)).isSymbolicLink()).toBe(true);
    });
  } finally {
    if (alias !== null) await rm(alias, { recursive: true, force: true });
  }
});

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

test('authorized damaged prior generation gets a bounded transient capacity slot', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const firstGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    expect(currentGeneration).not.toBe(firstGeneration);

    const generationBytes = new Map<string, Buffer>();
    for (const hook of managedHookNames) {
      generationBytes.set(hook, await readFile(path.join(currentGeneration, hook)));
    }
    const duplicateGenerations: string[] = [];
    const digest = /^generation-([0-9a-f]{64})/u.exec(path.basename(currentGeneration))?.[1];
    expect(digest).toBeDefined();
    for (let index = 1; index <= 7; index += 1) {
      const duplicate = path.join(
        path.dirname(currentGeneration),
        `generation-${digest}-00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
      );
      duplicateGenerations.push(duplicate);
      await mkdir(duplicate);
      for (const hook of managedHookNames) {
        await writeFile(path.join(duplicate, hook), generationBytes.get(hook)!);
        await chmod(path.join(duplicate, hook), 0o755);
      }
    }

    const damagedBytes = '#!/usr/bin/env sh\nexit 42\n';
    await writeFile(path.join(currentGeneration, 'pre-commit'), damagedBytes, 'utf8');
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const repairedGeneration = configuredManagedHooksPath(repoRoot);
    expect(repairedGeneration).not.toBe(currentGeneration);
    await expectManagedHooksMirror(repoRoot, repairedGeneration);
    await expect(lstat(currentGeneration)).rejects.toThrow();
    for (const duplicate of duplicateGenerations) {
      await expect(lstat(duplicate)).rejects.toThrow();
    }
  });
});

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

test('hook installer requires executable managed sources on POSIX', async () => {
  if (process.platform === 'win32') return;
  await withRepository(async (repoRoot) => {
    await chmod(path.join(repoRoot, '.githooks', 'pre-commit'), 0o644);
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

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

test('a prepared publication with a changed source is retained and blocks guessed retirement', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterGenerationPublication: true
    })).toMatchObject({ status: 'conflict' });
    const managedRoot = path.join(
      path.resolve(git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])),
      'sec-managed-hooks-v3'
    );
    const published = (await readdir(managedRoot, { withFileTypes: true }))
      .find((entry) => entry.name.startsWith('generation-'));
    expect(published).toBeDefined();
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(await readdir(managedRoot)).toContain(published!.name);
  });
});

test('managed fast path settles a completed transition after marker publication interruption', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
  });
});

test('managed fast-path recovery acknowledges a dead operation owner only after transition settlement', async () => {
  await withRepository(async (repoRoot) => {
    const deadPid = 2_147_483_647;
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerPid: deadPid
    })).toMatchObject({ status: 'conflict' });

    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const managedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    const managedRootIdentity = inspectNoFollowDirectoryChain(
      managedRoot,
      'Managed hook fast-path recovery fixture'
    ).target;
    const issuedLeaseEntries = (await readdir(managedRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile());
    expect(issuedLeaseEntries).toHaveLength(1);
    const leaseName = issuedLeaseEntries[0]!.name;
    const leasePath = path.join(managedRoot, leaseName);

    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    const transitionNames = await configTransitionNames(repoRoot);
    expect(transitionNames).toHaveLength(1);
    await expect(lstat(leasePath)).rejects.toThrow();

    const abandoned = acquirePhysicalMutationLease(managedRootIdentity, leaseName, {
      ownerPid: deadPid
    });
    expect(abandoned).not.toBeNull();
    const abandonedBytes = await readFile(leasePath);
    const unexpectedTransitionFile = path.join(
      managedRoot,
      transitionNames[0]!,
      'unexpected-recovery-fixture'
    );
    await writeFile(unexpectedTransitionFile, 'preserve predecessor lease\n', 'utf8');

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await readFile(leasePath)).toEqual(abandonedBytes);
    expect(await configTransitionNames(repoRoot)).toEqual(transitionNames);

    await rm(unexpectedTransitionFile);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expect(lstat(leasePath)).rejects.toThrow();
  });
});

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

test('a completed prior transition settles before a valid source update starts a new operation', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    expect(currentGeneration).not.toBe(previousGeneration);
    await expect(lstat(previousGeneration)).rejects.toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, currentGeneration);
  });
});

test('durable prior generation inventory settles after marker crash and source update', async () => {
  await withRepository(async (repoRoot) => {
    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(await lstat(previousGeneration)).not.toBeNull();

    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    expect(currentGeneration).not.toBe(previousGeneration);
    await expect(lstat(previousGeneration)).rejects.toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, currentGeneration);
  });
});

test('prior retirement recovers after delete before its durable retired receipt', async () => {
  await withRepository(async (repoRoot) => {
    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterGenerationRetirementDelete: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    await expect(lstat(previousGeneration)).rejects.toThrow();

    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('operation lease reclaims an exact dead owner and preserves live or foreign owners', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerPid: 2_147_483_647
    })).toMatchObject({ status: 'conflict' });
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
  });

  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerPid: process.pid
    })).toMatchObject({ status: 'conflict' });
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
  });

  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerHost: 'foreign-host-for-sec-test',
      leaseOwnerPid: process.pid
    })).toMatchObject({ status: 'conflict' });
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
  });
});

test('external config actor divergence is preserved and typed between effect and readback', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      configActorAfterStep: (stepIndex, actorRoot) => {
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

test('Git invocation process and output budgets stop before any config effect', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      gitBudget: { maxProcesses: 1 }
    })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      gitBudget: { maxCommandStdoutBytes: 1 }
    })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withCanonicalRemoteRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      noRemoteFixture: false,
      gitBudget: { deadlineMs: 1 }
    })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('same-path provider identity mutation is rejected before the config effect', async () => {
  await withRepository(async (repoRoot) => {
    const hostResolution = createHostGitReadSessionForTests({ cwd: repoRoot });
    if (hostResolution.gitExecutableIdentity === null) {
      throw new Error('The host test provider did not expose a Git executable identity');
    }
    let mutated = false;
    const providerResolution: GitReadSessionResolution = Object.freeze({
      status: 'ready' as const,
      route: 'host-local-git-v1' as const,
      session: Object.freeze({
        ...hostResolution,
        // Keep the exact same executable path while making the retained
        // physical identity fence report its post-bind mutation.
        verifyExecutable: () => !mutated && hostResolution.verifyExecutable()
      })
    });
    expect(providerResolution.session.gitExecutableIdentity?.path)
      .toBe(hostResolution.gitExecutableIdentity.path);
    const spawnKinds: Array<'git-read' | 'git-config'> = [];
    let configSpawnCountAtMutation = -1;
    const result = await installGitHooks({
      repoRoot,
      lifecycle: true,
      providerResolutionForTest: providerResolution,
      beforeSpawnForTest: (kind) => spawnKinds.push(kind),
      configActorBeforeEffect: (stepIndex) => {
        if (stepIndex !== 0) return;
        configSpawnCountAtMutation = spawnKinds.filter((kind) => kind === 'git-config').length;
        mutated = true;
      }
    });
    expect(result.status).toBe('conflict');
    expect(result.message).toContain('canonical Git executable identity changed');
    expect(configSpawnCountAtMutation).toBe(0);
    expect(spawnKinds.filter((kind) => kind === 'git-config')).toHaveLength(configSpawnCountAtMutation);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
}, { timeout: 30_000 });

test('hook installer lifecycle skips CI and Gitless environments while explicit install fails', async () => {
  const gitlessRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-gitless-'));
  try {
    await writeFile(path.join(gitlessRoot, '.git'), 'gitdir: missing\n', 'utf8');
    expect(await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'true' }
    })).toBe(0);
    const gitlessLifecycleResult = await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    });
    // On Windows the provider gate is authoritative even before Git can
    // classify the checkout as Gitless; an unknown/unsupported provider is a
    // typed failure, never a successful lifecycle skip. POSIX keeps the
    // historical Gitless no-op because its host-local provider is independent.
    expect(gitlessLifecycleResult).toBe(process.platform === 'win32' ? 1 : 0);
    expect(await installGitHooksMain({
      argv: [],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(1);
  } finally {
    await rm(gitlessRoot, { recursive: true, force: true });
  }
});

test('production hook installer CLI rejects the no-remote fixture authority flag', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooksMain({
      argv: ['--test-no-remote-fixture'],
      cwd: repoRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(1);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('hook installer keeps primary bootstrap and linked worktree generations independent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-linked-'));
  const repoRoot = path.join(root, 'main');
  const linkedRoot = path.join(root, 'linked');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet', '-b', 'main']);
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

test('hook installer refuses a non-default primary as linked bootstrap', async () => {
  await withRepository(async (repoRoot) => {
    git(repoRoot, ['branch', '--move', 'candidate-primary']);
    git(repoRoot, ['remote', 'add', 'origin', path.join(repoRoot, 'origin.git')]);
    git(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    const linkedRoot = path.join(path.dirname(repoRoot), 'linked-non-default');
    git(repoRoot, ['worktree', 'add', '--quiet', '-b', 'linked-non-default', linkedRoot]);

    expect(await installGitHooks({ repoRoot: linkedRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--local', '--get', 'core.hooksPath'])).toThrow();
    expect(() => git(linkedRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('primary bootstrap rejects staged managed-hook bytes that are not the remote-bound HEAD tree', async () => {
  await withCanonicalRemoteRepository(async (repoRoot) => {
    await writeFile(
      path.join(repoRoot, '.githooks', 'pre-commit'),
      '#!/usr/bin/env sh\nset -ux\n\n bun ./src/adapters/self-hosting/development/runner/cli.ts imports:freeze\n',
      'utf8'
    );
    await chmod(path.join(repoRoot, '.githooks', 'pre-commit'), 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('primary bootstrap rejects invalid local tracking authority and accepts main descendants', async () => {
  await withCanonicalRemoteRepository(async (repoRoot) => {
    try {
      git(repoRoot, [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/HEAD'
      ]);
    } catch {
      git(repoRoot, [
        'update-ref',
        '--no-deref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/HEAD'
      ]);
    }
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withCanonicalRemoteRepository(async (repoRoot) => {
    const initial = git(repoRoot, ['rev-parse', 'HEAD']);
    await writeFile(path.join(repoRoot, 'REMOTE.md'), 'new remote head\n', 'utf8');
    git(repoRoot, ['add', 'REMOTE.md']);
    git(repoRoot, ['commit', '--quiet', '-m', 'advance remote fixture']);
    git(repoRoot, ['push', '--quiet', 'origin', 'main']);
    git(repoRoot, ['update-ref', 'refs/heads/main', initial]);
    git(repoRoot, ['reset', '--quiet', '--hard', initial]);
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', initial]);
    git(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'installed' });
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });

  await withCanonicalRemoteRepository(async (repoRoot) => {
    await writeFile(path.join(repoRoot, 'LOCAL.md'), 'local ahead\n', 'utf8');
    git(repoRoot, ['add', 'LOCAL.md']);
    git(repoRoot, ['commit', '--quiet', '-m', 'local ahead fixture']);
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'installed' });
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('primary bootstrap pins its admitted local lineage while remote state advances independently', async () => {
  await withCanonicalRemoteRepository(async (repoRoot) => {
    const initial = git(repoRoot, ['rev-parse', 'HEAD']);
    let advanced = false;
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      noRemoteFixture: false,
      bootstrapAuthorityActorBeforeConfigEffect: (actorRoot) => {
        if (advanced) return;
        advanced = true;
        writeFileSync(path.join(actorRoot, 'REMOTE-DRIFT.md'), 'remote drift\n', 'utf8');
        git(actorRoot, ['add', 'REMOTE-DRIFT.md']);
        git(actorRoot, ['commit', '--quiet', '-m', 'remote authority drift']);
        git(actorRoot, ['push', '--quiet', 'origin', 'main']);
        git(actorRoot, ['reset', '--quiet', '--hard', initial]);
        git(actorRoot, ['update-ref', 'refs/remotes/origin/main', initial]);
        git(actorRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
      }
    })).toMatchObject({ status: 'installed' });
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('repository-common hook generation runs when an older worktree creates the first checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-first-checkout-'));
  const repoRoot = path.join(root, 'main');
  const olderRoot = path.join(root, 'older');
  const linkedRoot = path.join(root, 'linked');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet', '-b', 'main']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    await writeFile(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
    // Both revisions supply the package entry invoked by the managed hook.
    // The fixture observes dispatch; package metadata is verified separately.
    await writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({
      scripts: { dev: '"$npm_execpath" -e "process.exit(0)"' }
    }));
    git(repoRoot, ['add', 'README.md', 'package.json']);
    git(repoRoot, ['commit', '--quiet', '-m', 'older checkout without managed hooks']);
    const olderHead = git(repoRoot, ['rev-parse', 'HEAD']);

    await mkdir(path.join(repoRoot, '.githooks'));
    await writeFile(path.join(repoRoot, '.gitattributes'), '/.githooks/* text eol=lf\n', 'utf8');
    await Promise.all(managedHookNames.map(async (hook) => {
      const hookPath = path.join(repoRoot, '.githooks', hook);
      await writeFile(
        hookPath,
        hook === 'post-checkout'
          // A command after exec is unreachable; observe dispatch before it.
          ? managedHookSource(hook).replace('exec bun',
            'printf first-checkout > .dependency-bootstrap-marker\nexec bun')
          : managedHookSource(hook),
        'utf8'
      );
      await chmod(hookPath, 0o755);
    }));
    git(repoRoot, [
      'add',
      '.gitattributes',
      'README.md',
      '.githooks'
    ]);
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
    expect(await installGitHooks({ repoRoot: linkedRoot })).toMatchObject({ status: 'installed' });
    expect(path.resolve(git(linkedRoot, ['config', '--local', '--get', 'core.hooksPath']))).toBe(configured);
    const linkedGeneration = configuredManagedHooksPath(linkedRoot);
    expect(linkedGeneration).not.toBe(configured);
    expect(path.resolve(git(linkedRoot, ['config', '--get', 'core.hooksPath']))).toBe(linkedGeneration);
    await expectManagedHooksMirror(linkedRoot, linkedGeneration);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
