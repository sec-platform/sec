import { afterAll, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHostGitReadSessionForTests, type GitReadSessionResolution } from '../../../../src/adapters/providers/git-read/test/session.ts';
import { installGitHooksForTest as installGitHooksImplementation } from '../../../../src/adapters/self-hosting/development/hooks/install.ts';
import { settleWorkspaceCallback, settleWorkspaceCleanups } from '../../../testkit/workspace-cleanup.ts';


// Real repository, linked-worktree, and managed-hook lifecycle acceptance belongs to the slow lane.

export const managedHookNames = ['pre-commit', 'pre-push', 'post-checkout', 'post-merge', 'post-rewrite'] as const;
export const workspaceTransitionCommand = 'bun run workspace:transition --';
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
  // Every isolated repository uses the explicit host-only test seam. Production
  // admission is exercised separately; no platform may fall back to an ambient
  // executable in installGitHooksForTest. Keep this borrowed session alive until
  // the complete installation/recovery attempt has settled.
  const fixtureProvider = options.providerResolutionForTest
    ?? hostProviderResolutionForTest(options.repoRoot);
  return settleWorkspaceCallback(
    () => installGitHooksImplementation({ ...options, providerResolutionForTest: fixtureProvider }),
    async () => {
      if (fixtureProvider?.status === 'ready') await fixtureProvider.session.close?.();
    }
  );
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
  const installerUrl = new URL('../../../../src/adapters/self-hosting/development/hooks/install.ts', import.meta.url).href;
  const providerUrl = new URL('../../../../src/adapters/providers/git-read/test/session.ts', import.meta.url).href;
  const settlementUrl = new URL('../../../testkit/workspace-cleanup.ts', import.meta.url).href;
  const script = `
    const { installGitHooksForTest } = await import(${JSON.stringify(installerUrl)});
    const { createHostGitReadSessionForTests } = await import(${JSON.stringify(providerUrl)});
    const { settleWorkspaceCallback } = await import(${JSON.stringify(settlementUrl)});
    const root = process.env.SEC_HOOK_FIXTURE_ROOT;
    if (!root) throw new Error('Hook fixture root is missing');
    const session = createHostGitReadSessionForTests({ cwd: root, budget: { deadlineMs: 120000 } });
    if (session.failure !== null || session.gitExecutableIdentity === null) {
      throw new Error('Hook fixture Git provider is unavailable');
    }
    const result = await settleWorkspaceCallback(
      () => installGitHooksForTest({
        repoRoot: root, lifecycle: process.env.SEC_HOOK_FIXTURE_LIFECYCLE === '1',
        providerResolutionForTest: { status: 'ready', route: 'host-local-git-v1', session }
      }),
      async () => { await session.close?.(); }
    );
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
  return readFileSync(path.resolve(import.meta.dir, '../../../../.githooks', hook), 'utf8');
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
  // Read both native locations in one Git invocation. Separate worktree
  // config readback and each case's physical index and refs remain independent.
  const gitPaths = git(repoRoot, [
    'rev-parse', '--path-format=absolute', '--git-path', 'config.worktree', '--git-common-dir'
  ]).split(/\r?\n/u);
  if (gitPaths.length !== 2 || gitPaths.some(value => value.length === 0)) {
    throw new Error('Expected one config.worktree and one common Git directory');
  }
  const worktreeConfigPath = path.resolve(gitPaths[0]!);
  const commonGitDir = path.resolve(gitPaths[1]!);
  const configured = path.resolve(git(
    repoRoot,
    ['config', '--file', worktreeConfigPath, '--path', '--get', 'core.hooksPath']
  ));
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

/** The two native Git Hook fixture forms have the same tracked source and
 * executable-bit requirements. Prepare once per physical repository without
 * changing either its Git history or its independent test lifetime. */
async function prepareManagedHookSource(repoRoot: string, commitMessage: string): Promise<void> {
  git(repoRoot, ['config', 'user.email', 'tests@example.com']);
  git(repoRoot, ['config', 'user.name', 'SEC Tests']);
  await mkdir(path.join(repoRoot, '.githooks'));
  // All native hook writers finish before Git publication or fixture
  // retirement, including a failed chmod/write in a concurrent peer.
  const writes = await Promise.allSettled(managedHookNames.map(async hook => {
    const hookPath = path.join(repoRoot, '.githooks', hook);
    await writeFile(hookPath, managedHookSource(hook), 'utf8');
    await chmod(hookPath, 0o755);
  }));
  const failures = writes.flatMap(value => value.status === 'rejected' ? [value.reason] : []);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Managed hook source preparation failed');
  }
  // Native Git stages the executable bit for every hook in one bounded command.
  // chmod above retains the actual worktree permission independently.
  git(repoRoot, ['add', '--chmod=+x', '.githooks']);
  git(repoRoot, ['commit', '--quiet', '-m', commitMessage]);
}

// Immutable native Git source preparation is shared within a test process.
// Every test still owns a separate physical copy of .git, the index, refs,
// reflogs and worktree. Non-default git-init inputs retain their own setup.
async function preparedTemplateRoot(
  prefix: string,
  prepare: (root: string) => Promise<void>
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await prepare(root);
    return root;
  } catch (primary) {
    return settleWorkspaceCallback(async () => { throw primary; },
      () => rm(root, { recursive: true, force: true }));
  }
}

let defaultSourceTemplate: Promise<string> | undefined;
let canonicalRemoteTemplate: Promise<string> | undefined;

function defaultManagedRepositoryTemplate(): Promise<string> {
  return defaultSourceTemplate ??= preparedTemplateRoot('sec-hooks-base-', async root => {
    git(root, ['init', '--quiet', '-b', 'main']);
    await prepareManagedHookSource(root, 'managed hook fixture');
  });
}

function canonicalRemoteRepositoryTemplate(): Promise<string> {
  return canonicalRemoteTemplate ??= preparedTemplateRoot('sec-hooks-remote-base-', async root => {
    const repository = path.join(root, 'repo');
    const remote = path.join(root, 'origin.git');
    await mkdir(repository);
    git(repository, ['init', '--quiet', '-b', 'main']);
    await prepareManagedHookSource(repository, 'canonical remote fixture');
    git(repository, ['init', '--bare', '--quiet', remote]);
    git(repository, ['remote', 'add', 'origin', remote]);
    git(repository, ['push', '--quiet', '--set-upstream', 'origin', 'main']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(repository, ['fetch', '--quiet', 'origin']);
    git(repository, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  });
}

afterAll(async () => {
  const pending = [defaultSourceTemplate, canonicalRemoteTemplate].filter(
    (promise): promise is Promise<string> => promise !== undefined
  );
  const settled = await Promise.allSettled(pending);
  await settleWorkspaceCleanups(settled.flatMap(result =>
    result.status === 'fulfilled'
      ? [() => rm(result.value, { recursive: true, force: true })]
      : []
  ));
});

export async function withRepository(
  run: (repoRoot: string) => Promise<void>,
  initArgs: readonly string[] = []
): Promise<void> {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-'));
  const repoRoot = path.join(ownerRoot, 'r');
  return settleWorkspaceCallback(async () => {
    if (initArgs.length === 0) {
      await cp(await defaultManagedRepositoryTemplate(), repoRoot, { recursive: true });
    } else {
      await mkdir(repoRoot);
      git(repoRoot, ['init', '--quiet', '-b', 'main', ...initArgs]);
      await prepareManagedHookSource(repoRoot, 'managed hook fixture');
    }
    await run(repoRoot);
  }, () => rm(ownerRoot, { recursive: true, force: true }));
}

export async function withCanonicalRemoteRepository(
  run: (repoRoot: string, remoteRoot: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-remote-'));
  const repoRoot = path.join(root, 'repo');
  const remoteRoot = path.join(root, 'origin.git');
  return settleWorkspaceCallback(async () => {
    const source = await canonicalRemoteRepositoryTemplate();
    await cp(path.join(source, 'repo'), repoRoot, { recursive: true });
    await cp(path.join(source, 'origin.git'), remoteRoot, { recursive: true });
    // Git's remote URL contains an absolute original path. Rebind it to
    // this case's own copied bare origin before any consumer can inspect it.
    git(repoRoot, ['remote', 'set-url', 'origin', remoteRoot]);
    await run(repoRoot, remoteRoot);
  }, () => rm(root, { recursive: true, force: true }));
}
