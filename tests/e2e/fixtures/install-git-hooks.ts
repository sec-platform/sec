import { expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHostGitReadSessionForTests, type GitReadSessionResolution } from '../../../src/adapters/providers/git-read/test/session.ts';
import { installGitHooksForTest as installGitHooksImplementation } from '../../../src/adapters/self-hosting/development/hooks/install.ts';


// Real repository, linked-worktree, and managed-hook lifecycle acceptance belongs to the slow lane.

export const managedHookNames = ['pre-commit', 'pre-push', 'post-checkout', 'post-merge', 'post-rewrite'] as const;
export const workspaceTransitionCommand = 'bun run dev -- workspace-transition';
const importsApplyStagedCommand = 'bun run imports:apply --staged';
const importsFreezeCommand = 'bun run imports:freeze';

export async function installGitHooks(options: {
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
  // The production authority resolver intentionally remains unknown on the
  // current Windows host until its retained root closure is proven.  These
  // isolated test repositories opt into the explicit host-only test seam.
  const fixtureProvider = options.providerResolutionForTest
    ?? (process.platform === 'win32' ? hostProviderResolutionForTest(options.repoRoot) : undefined);
  try {
    return await installGitHooksImplementation({
      ...options,
      providerResolutionForTest: fixtureProvider
    });
  } finally {
    if (fixtureProvider?.status === 'ready') await fixtureProvider.session.close?.();
  }
}



export function hostProviderResolutionForTest(repoRoot: string): GitReadSessionResolution {
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

export function installGitHooksInIsolatedProcess(repoRoot: string, lifecycle = false): { status: string } {
  const installerUrl = new URL('../../../src/adapters/self-hosting/development/hooks/install.ts', import.meta.url).href;
  const providerUrl = new URL('../../../src/adapters/providers/git-read/test/session.ts', import.meta.url).href;
  const script = `
    const { installGitHooksForTest } = await import(${JSON.stringify(installerUrl)});
    const { createHostGitReadSessionForTests } = await import(${JSON.stringify(providerUrl)});
    const root = process.env.SEC_HOOK_FIXTURE_ROOT;
    if (!root) throw new Error('Hook fixture root is missing');
    const session = createHostGitReadSessionForTests({ cwd: root, budget: { deadlineMs: 120000 } });
    if (session.failure !== null || session.gitExecutableIdentity === null) {
      throw new Error('Hook fixture Git provider is unavailable');
    }
    const result = await installGitHooksForTest({
      repoRoot: root, lifecycle: process.env.SEC_HOOK_FIXTURE_LIFECYCLE === '1',
      providerResolutionForTest: { status: 'ready', route: 'host-local-git-v1', session }
    });
    console.log(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, SEC_HOOK_FIXTURE_ROOT: repoRoot,
      SEC_HOOK_FIXTURE_LIFECYCLE: lifecycle ? '1' : '0' }
  });
  if (result.status !== 0) {
    throw new Error(`Isolated hook install failed: ${result.error?.message ?? result.stderr}`);
  }
  return JSON.parse(result.stdout.trim()) as { status: string };
}

export async function configTransitionNames(repoRoot: string): Promise<string[]> {
  const commonGitDir = path.resolve(git(repoRoot, [
    'rev-parse', '--path-format=absolute', '--git-common-dir'
  ]));
  const managedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
  return (await readdir(managedRoot, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith('config-transition-'))
    .map((entry) => entry.name)
    .sort();
}

export function runtimeBoundCommand(command: string): string {
  const executable = process.platform === 'win32' ? process.execPath.replaceAll('\\', '/') : process.execPath;
  const quoted = `'${executable.replaceAll("'", `'"'"'`)}'`;
  return `${quoted}${command.slice('bun'.length)}`;
}

export function managedHookSource(hook: typeof managedHookNames[number]): string {
  return readFileSync(path.resolve(import.meta.dir, '../../../.githooks', hook), 'utf8');
}

export function git(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

export function configuredManagedHooksPath(repoRoot: string): string {
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

export function configuredBootstrapHooksPath(repoRoot: string): string {
  const configured = path.resolve(git(repoRoot, ['config', '--local', '--path', '--get', 'core.hooksPath']));
  const commonGitDir = path.resolve(git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  expect(path.dirname(configured)).toBe(path.join(commonGitDir, 'sec-managed-hooks-v3'));
  return configured;
}

export async function expectManagedHooksMirror(repoRoot: string, configured: string): Promise<void> {
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

export async function withRepository(
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

export async function withCanonicalRemoteRepository(
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

export async function tryCreateLink(
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
