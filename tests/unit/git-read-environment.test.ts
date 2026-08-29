import { devNull } from 'node:os';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  createHostGitReadSessionForTests,
  isolatedGitChildEnvironment,
  isolatedGitReadEnvironment
} from '../../src/external-capabilities/git-read/test/session.ts';

/**
 * Mirror of the implementation's empty config sink: Windows cannot open
 * `os.devNull` (`\\.\nul`) as a Git configuration file, so it binds the `NUL`
 * device name; POSIX uses `/dev/null`.
 */
const GIT_NULL_CONFIG_GLOBAL_SINK = process.platform === 'win32' ? 'NUL' : devNull;

const AMBIENT_AUTHORITY = {
  PATH: '/bin',
  HOME: '/home/test',
  GH_PROMPT_DISABLED: '0',
  GIT_DIR: '/tmp/redirected.git',
  GIT_WORK_TREE: '/tmp/redirected-worktree',
  GIT_INDEX_FILE: '/tmp/index',
  GIT_OBJECT_DIRECTORY: '/tmp/objects',
  GIT_CONFIG: '/tmp/config-only',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/tmp/hooks',
  GIT_CONFIG_GLOBAL: '/tmp/global',
  GIT_CONFIG_SYSTEM: '/tmp/system',
  GIT_CONFIG_PARAMETERS: "'core.hooksPath=/tmp/hooks'",
  GIT_ASKPASS: '/tmp/askpass',
  GIT_SSH_COMMAND: 'ssh -F /tmp/config',
  GIT_TERMINAL_PROMPT: '1',
  SSH_ASKPASS: '/tmp/ssh-askpass'
} as NodeJS.ProcessEnv;

const SCRUBBED_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_ASKPASS',
  'GIT_SSH_COMMAND',
  'SSH_ASKPASS'
] as const;

function environmentKeys(env: NodeJS.ProcessEnv, key: string): string[] {
  const canonicalKey = key.toUpperCase();
  return Object.keys(env).filter((name) => name.toUpperCase() === canonicalKey);
}

function expectIsolated(env: NodeJS.ProcessEnv): void {
  expect(env.PATH).toBe('/bin');
  expect(env.HOME).toBe('/home/test');
  for (const key of SCRUBBED_KEYS) expect(env[key]).toBeUndefined();
  expect(env.GH_PROMPT_DISABLED).toBe('1');
  expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1');
  expect(env.GIT_NO_LAZY_FETCH).toBe('1');
  expect(env.GIT_OPTIONAL_LOCKS).toBe('0');
  expect(env.GIT_LITERAL_PATHSPECS).toBe('1');
  expect(env.GIT_CONFIG_GLOBAL).toBe(GIT_NULL_CONFIG_GLOBAL_SINK);
  expect(env.GIT_CONFIG_GLOBAL).not.toBe(AMBIENT_AUTHORITY.GIT_CONFIG_GLOBAL);
  expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
}

test('Git read environment scrubs ambient repository, config and credential authority', () => {
  expectIsolated(isolatedGitReadEnvironment({}, AMBIENT_AUTHORITY));
});

test('Git child environment is the same mechanical isolation owner', () => {
  expectIsolated(isolatedGitChildEnvironment(AMBIENT_AUTHORITY));
});

test('Git read environment permits subject/locale overrides but cannot weaken mandatory isolation', () => {
  const env = isolatedGitReadEnvironment({
    GIT_DIR: '/tmp/explicit.git',
    GIT_CONFIG_GLOBAL: '/tmp/attempted-global',
    GIT_CONFIG_NOSYSTEM: '0',
    GIT_TERMINAL_PROMPT: '1',
    GIT_NO_REPLACE_OBJECTS: '0',
    GIT_ASKPASS: '/tmp/attempted-askpass',
    LANG: 'C',
    LC_ALL: 'C'
  }, {
    PATH: '/bin',
    GIT_DIR: '/tmp/ambient.git'
  });

  expect(env.GIT_DIR).toBe('/tmp/explicit.git');
  expect(env.LANG).toBe('C');
  expect(env.LC_ALL).toBe('C');
  expect(env.GIT_CONFIG_GLOBAL).toBe(GIT_NULL_CONFIG_GLOBAL_SINK);
  expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
  expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1');
  expect(env.GIT_ASKPASS).toBeUndefined();
});

test('Git read isolation removes case-variant mandatory overrides before child execution', () => {
  const env = isolatedGitReadEnvironment({
    git_config_global: '/tmp/lowercase-global',
    Git_Config_NoSystem: '0',
    git_terminal_prompt: '1',
    Git_No_Replace_Objects: '0',
    git_askpass: '/tmp/lowercase-askpass',
    ssh_askpass: '/tmp/lowercase-ssh-askpass',
    LANG: 'C'
  }, { PATH: '/bin' });

  expect(env.LANG).toBe('C');
  expect(environmentKeys(env, 'GIT_CONFIG_GLOBAL')).toEqual(['GIT_CONFIG_GLOBAL']);
  expect(environmentKeys(env, 'GIT_CONFIG_NOSYSTEM')).toEqual(['GIT_CONFIG_NOSYSTEM']);
  expect(environmentKeys(env, 'GIT_TERMINAL_PROMPT')).toEqual(['GIT_TERMINAL_PROMPT']);
  expect(environmentKeys(env, 'GIT_NO_REPLACE_OBJECTS')).toEqual(['GIT_NO_REPLACE_OBJECTS']);
  expect(environmentKeys(env, 'GIT_ASKPASS')).toEqual([]);
  expect(environmentKeys(env, 'SSH_ASKPASS')).toEqual([]);
  expect(env.GIT_CONFIG_GLOBAL).toBe(GIT_NULL_CONFIG_GLOBAL_SINK);
  expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
  expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1');
});

test('the explicit host test route rejects aggregate argument overflow before starting Git', async () => {
  const session = createHostGitReadSessionForTests({
    cwd: process.cwd(),
    budget: {
      maxProcesses: 1,
      maxTotalArgumentBytes: 1
    }
  });
  const result = await session.run(['status']);
  expect(result).toMatchObject({
    kind: 'unresolved-git-read-session',
    reason: 'argument-budget-exhausted'
  });
  expect(session.processCount).toBe(0);
});

test('a terminal host-session failure cannot be consumed as additional records', async () => {
  const session = createHostGitReadSessionForTests({
    cwd: process.cwd(),
    budget: { maxTotalArgumentBytes: 1 }
  });
  const commandFailure = await session.run(['status']);
  const recordsBefore = session.recordCount;
  const recordFailure = session.consumeRecords(1);
  expect(commandFailure.kind).toBe('unresolved-git-read-session');
  expect(recordFailure).toBe(session.failure);
  expect(session.recordCount).toBe(recordsBefore);
});

test('the host provider resolves Git from its canonical child PATH', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-read-empty-path-'));
  try {
    const session = createHostGitReadSessionForTests({
      cwd: root,
      source: { PATH: '' }
    });
    expect(session.gitExecutable).toBe('');
    expect(session.failure).toMatchObject({
      kind: 'unresolved-git-read-session',
      reason: 'command-error'
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the host provider accounts for its physical root observation budget', () => {
  const session = createHostGitReadSessionForTests({
    cwd: process.cwd(),
    budget: { maxRootObservedBytes: 1 }
  });
  expect(session.rootObservedBytes).toBeGreaterThan(1);
  expect(session.failure).toMatchObject({
    kind: 'unresolved-git-read-session',
    reason: 'root-observation-budget-exhausted'
  });
});

test('the host transport fences the retained executable and cwd before and after a child', async () => {
  const session = createHostGitReadSessionForTests({
    cwd: process.cwd(),
    budget: { maxProcesses: 2 }
  });
  expect(session.failure).toBeNull();
  const result = await session.run(['--version']);
  expect(result.kind).toBe('completed');
  expect(session.processCount).toBe(1);
  expect(session.failure).toBeNull();
});

test('the retained cwd prevents replacement while the Git session is live', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-read-cwd-'));
  const moved = `${root}-moved`;
  let session: ReturnType<typeof createHostGitReadSessionForTests> | undefined;
  try {
    session = createHostGitReadSessionForTests({ cwd: root });
    expect(session.failure).toBeNull();
    expect(() => renameSync(root, moved)).toThrow();
    const result = await session.run(['--version']);
    expect(result.kind).toBe('completed');
    expect(session.processCount).toBe(1);
  } finally {
    await session?.close?.();
    rmSync(root, { recursive: true, force: true });
    rmSync(moved, { recursive: true, force: true });
  }
});

test('a caller parent deadline cannot be extended by a host test session', async () => {
  const session = createHostGitReadSessionForTests({
    cwd: process.cwd(),
    deadlineAtUnixMs: Date.now() - 1
  });
  const result = await session.run(['status']);
  expect(result).toMatchObject({
    kind: 'unresolved-git-read-session',
    reason: 'deadline-exhausted'
  });
  expect(session.processCount).toBe(0);
});

test('budget fields above the canonical envelope are rejected before transport', () => {
  expect(() => createHostGitReadSessionForTests({
    cwd: process.cwd(),
    budget: { maxProcesses: 129 }
  })).toThrow(/canonical ceiling/u);
});

test('invalid parent deadlines are rejected before host transport admission', () => {
  expect(() => createHostGitReadSessionForTests({
    cwd: process.cwd(),
    deadlineAtUnixMs: Number.NaN
  })).toThrow(/non-negative safe integer/u);
});
