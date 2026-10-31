import assert from 'node:assert/strict';
import { afterAll } from 'bun:test';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import { withRetainedBunTestCommands, type RetainedBunTestWorkspaceRun } from './process-resource.ts';

export type GitProtocolCommand = (
  args: readonly string[], env?: NodeJS.ProcessEnv, input?: string | Uint8Array
) => SpawnSyncReturns<string>;

// Reuse only the immutable installed-Git initialization. A case receives a
// physically independent .git, index, refs, object store and worktree. PATH
// belongs to the Git executable selection and is part of the seed identity.
const gitProtocolTemplates = new Map<string, string>();

function initializedGitProtocolTemplate(
  objectFormat: 'sha1' | 'sha256',
  environment: Readonly<NodeJS.ProcessEnv>
): string {
  const key = JSON.stringify([objectFormat, environment.PATH ?? null, environment.SystemRoot ?? null]);
  const retained = gitProtocolTemplates.get(key);
  if (retained !== undefined) return retained;
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-protocol-base-'));
  try {
    const result = spawnSync('git', ['init', '--quiet', `--object-format=${objectFormat}`], {
      cwd: root,
      // The seed never borrows the first case's mutable HOME or Git index.
      env: { ...environment, HOME: root, XDG_CONFIG_HOME: root },
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    gitProtocolSuccess(result);
    gitProtocolTemplates.set(key, root);
    return root;
  } catch (primary) {
    try { rmSync(root, { recursive: true, force: true }); }
    catch (cleanup) {
      throw new AggregateError([primary, cleanup], 'Git protocol template setup and cleanup both failed');
    }
    throw primary;
  }
}

afterAll(() => {
  const failures: unknown[] = [];
  for (const [key, root] of gitProtocolTemplates) {
    try {
      rmSync(root, { recursive: true, force: true });
      gitProtocolTemplates.delete(key);
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Git protocol template cleanup failed');
  }
});

/** Ordinary installed-Git protocol fixture, not a SEC retained provider or an
 * authority issuer. Setup is independent of every environment/parser under test.
 * Only bounded local subprocesses and this fixture's own directory are used. */
export async function inGitProtocolRepository(
  run: (root: string, git: GitProtocolCommand, environment: Readonly<NodeJS.ProcessEnv>, command: RetainedBunTestWorkspaceRun) => Promise<void>,
  objectFormat: 'sha1' | 'sha256' = 'sha1'
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-protocol-'));
  const fixtureEnv: NodeJS.ProcessEnv = Object.freeze({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    HOME: root, XDG_CONFIG_HOME: root, LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : devNull,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_AUTHOR_DATE: '@1000000000 +0000',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test', GIT_COMMITTER_DATE: '@1000000000 +0000' });
  const git: GitProtocolCommand = (args, env = fixtureEnv, input) => spawnSync('git', [...args], {
    cwd: root, env, input, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true
  });
  return withRetainedBunTestCommands(root, async (command) => {
    const template = initializedGitProtocolTemplate(objectFormat, fixtureEnv);
    cpSync(path.join(template, '.git'), path.join(root, '.git'), {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    await run(root, git, fixtureEnv, command);
  }, async () => { rmSync(root, { recursive: true, force: true }); });
}

export function gitProtocolSuccess(result: SpawnSyncReturns<string>): string {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}
