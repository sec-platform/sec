import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import { settleWorkspaceCallback } from './workspace-cleanup.ts';

export type GitProtocolCommand = (
  args: readonly string[], env?: NodeJS.ProcessEnv, input?: string | Uint8Array
) => SpawnSyncReturns<string>;

/** Ordinary installed-Git protocol fixture, not a SEC retained provider or an
 * authority issuer. Setup is independent of every environment/parser under test.
 * Only bounded local subprocesses and this fixture's own directory are used. */
export async function inGitProtocolRepository(
  run: (root: string, git: GitProtocolCommand, environment: Readonly<NodeJS.ProcessEnv>) => Promise<void>,
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
  return settleWorkspaceCallback(async () => {
    gitProtocolSuccess(git(['init', '--quiet', `--object-format=${objectFormat}`]));
    await run(root, git, fixtureEnv);
  }, async () => { rmSync(root, { recursive: true, force: true }); });
}

export function gitProtocolSuccess(result: SpawnSyncReturns<string>): string {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}
