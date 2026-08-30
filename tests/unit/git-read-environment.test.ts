import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { runGitRead } from '../../src/development/tooling/git/git-read.ts';
import {
  assertProductionGitReadSession,
  createAuthorityGitReadSession,
  createHostGitReadSessionForTests,
  isProductionGitReadSession,
  isTestGitReadSession,
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

test('Git read grammar admits exact observations and terminally rejects mutation or helper execution', async () => {
  const cases = [
    { args: ['status', '--porcelain=v1', '-z', '--untracked-files=all'], permitted: true },
    { args: ['rev-parse', '--verify', 'HEAD^{commit}'], permitted: true },
    { args: ['write-tree'], permitted: false },
    { args: ['hash-object', '-w', '--stdin'], permitted: false },
    { args: ['update-index', '-z', '--index-info'], permitted: false },
    { args: ['config', 'user.name', 'unauthorized-writer'], permitted: false },
    { args: ['branch', 'unauthorized-writer'], permitted: false },
    { args: ['symbolic-ref', '--delete', 'HEAD'], permitted: false },
    { args: ['-c', 'core.hooksPath=unauthorized', 'status'], permitted: false },
    { args: ['diff', '--ext-diff'], permitted: false },
    { args: ['diff', '--textconv'], permitted: false },
    { args: ['cat-file', '--filters', 'HEAD:package.json'], permitted: false },
    { args: ['rev-list', '--use-bitmap-index', '--filter=blob:none', 'HEAD'], permitted: false },
    { args: ['show', '--format=%(trailers:only,unfold,key=SEC,separator=%x00)', 'HEAD'], permitted: false }
  ] as const;
  for (const testCase of cases) {
    const session = createHostGitReadSessionForTests({ cwd: process.cwd() });
    try {
      const result = await session.run(testCase.args);
      if (testCase.permitted) {
        expect(result.kind).toBe('completed');
        expect(session.processCount).toBe(1);
      } else {
        if (result.kind === 'completed') throw new Error('Forbidden Git grammar unexpectedly executed.');
        expect(result).toMatchObject({
          kind: 'unresolved-git-read-session',
          reason: 'operation-not-permitted'
        });
        expect(session.processCount).toBe(0);
        expect(session.failure).toBe(result);
      }
    } finally {
      await session.close?.();
    }
  }
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

test('test sessions cannot cross the production GitRead issuer boundary', async () => {
  const testSession = createHostGitReadSessionForTests({ cwd: process.cwd() });
  expect(isTestGitReadSession(testSession)).toBe(true);
  expect(isProductionGitReadSession(testSession)).toBe(false);
  expect(() => assertProductionGitReadSession(testSession)).toThrow(/production issuer/u);
  const structuralClone = { ...testSession };
  expect(isProductionGitReadSession(structuralClone)).toBe(false);
  expect(() => assertProductionGitReadSession(structuralClone)).toThrow(/production issuer/u);
  await testSession.close?.();

  const resolution = createAuthorityGitReadSession({ cwd: process.cwd() });
  expect(resolution.status).toBe('ready');
  if (resolution.status === 'ready') {
    expect(isProductionGitReadSession(resolution.session)).toBe(true);
    expect(isTestGitReadSession(resolution.session)).toBe(false);
    expect(() => assertProductionGitReadSession(resolution.session)).not.toThrow();
    await resolution.session.close?.();
  }
});

test('semantic GitRead helpers reject a test transport before any child starts', async () => {
  const session = createHostGitReadSessionForTests({ cwd: process.cwd() });
  try {
    const result = await runGitRead(session, ['--version']);
    expect(result.status).toBeNull();
    expect(result.error?.message).toMatch(/production-issued/u);
    expect(session.processCount).toBe(0);
  } finally {
    await session.close?.();
  }
});

test('provider admission preserves an expired parent deadline as a typed reason', () => {
  const resolution = createAuthorityGitReadSession({
    cwd: process.cwd(),
    deadlineAtUnixMs: Date.now() - 1
  });
  expect(resolution).toMatchObject({
    kind: 'unresolved-git-read-provider',
    status: 'unavailable',
    reason: 'git-session-deadline-exhausted'
  });
});

test('close waits for an admitted child before disposing the GitRead session', async () => {
  const session = createHostGitReadSessionForTests({ cwd: process.cwd() });
  const command = session.run([
    '--no-pager',
    '-c', 'core.quotepath=false',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=no'
  ]);
  const close = session.close?.();
  expect(close).toBeInstanceOf(Promise);
  await close;
  const result = await command;
  expect(result.kind).toBe('completed');
  expect(session.failure).toBeNull();

  const afterClose = await session.run(['--version']);
  expect(afterClose).toMatchObject({
    kind: 'unresolved-git-read-session',
    reason: 'command-error'
  });
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
  const status = await session.run([
    '--no-pager',
    '-c', 'core.quotepath=false',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=no'
  ]);
  expect(status.kind).toBe('completed');
  expect(session.processCount).toBe(2);
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
