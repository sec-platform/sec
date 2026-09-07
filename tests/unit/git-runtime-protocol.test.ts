import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { canonicalGitChildEnvironment, gitEnvironmentValue } from '../../src/external-capabilities/git/environment.ts';
import { gitReadCommandIsObservation } from '../../src/external-capabilities/git-read/runtime/read-command.ts';
import { inGitProtocolRepository as inRepository, gitProtocolSuccess as commandSucceeded } from '../testkit/git-protocol.ts';

test('real Git cannot consume config-count or config-parameters restored through explicit overrides', () => inRepository(async (root, git) => {
  for (const injected of [
    { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'fixture.probe', GIT_CONFIG_VALUE_0: 'not-local' },
    { GIT_CONFIG_PARAMETERS: "'fixture.probe=not-local'" }
  ]) {
    const source = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, XDG_CONFIG_HOME: root };
    // Establish independently that this installed Git recognizes the input.
    assert.equal(commandSucceeded(git(['config', '--get', 'fixture.probe'], { ...source,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : devNull, GIT_CONFIG_NOSYSTEM: '1', ...injected })).trim(), 'not-local');
    const observed = git(['config', '--get', 'fixture.probe'], canonicalGitChildEnvironment(injected, source));
    assert.equal(observed.error, undefined); assert.equal(observed.status, 1); assert.equal(observed.stdout, '');
  }
}));

test('real Git reads the chosen repository config rather than an override-selected foreign config', () => inRepository(async (root, git) => {
  commandSucceeded(git(['config', 'fixture.probe', 'local']));
  const foreign = path.join(root, 'foreign.cfg'); writeFileSync(foreign, '[fixture]\nprobe = foreign\n');
  const env = canonicalGitChildEnvironment({ GIT_CONFIG: foreign }, {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, XDG_CONFIG_HOME: root
  });
  assert.equal(commandSucceeded(git(['config', '--get', 'fixture.probe'], env)).trim(), 'local');
}));

test('real Git keeps literal filename semantics despite a conflicting caller glob policy', () => inRepository(async (root, git) => {
  writeFileSync(path.join(root, 'a[b].txt'), 'literal'); writeFileSync(path.join(root, 'ab.txt'), 'glob');
  commandSucceeded(git(['add', '--', 'a[b].txt', 'ab.txt']));
  const env = canonicalGitChildEnvironment({ GIT_GLOB_PATHSPECS: '1', GIT_ICASE_PATHSPECS: '1' }, {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, XDG_CONFIG_HOME: root
  });
  assert.equal(commandSucceeded(git(['ls-files', '-z', '--', 'a[b].txt'], env)), 'a[b].txt\0');
}));

test('real Git treats admitted dash-prefixed filenames as data for every supported pathspec command', () => inRepository(async (root, git) => {
  writeFileSync(path.join(root, '--textconv'), 'original\n'); writeFileSync(path.join(root, '--cached'), 'cached\n');
  commandSucceeded(git(['add', '--', '--textconv', '--cached']));
  commandSucceeded(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--no-gpg-sign', '--quiet', '-m', 'fixture']));
  const head = commandSucceeded(git(['rev-parse', '--verify', 'HEAD'])).trim();
  writeFileSync(path.join(root, '--textconv'), 'changed\n');
  const commands = [
    ['status', '--short', '--', '--textconv'], ['diff', '--name-only', head, '--', '--textconv'],
    ['diff-files', '--name-only', '--', '--textconv'], ['diff-index', '--name-only', head, '--', '--textconv'],
    ['ls-files', '-z', '--', '--textconv'], ['ls-tree', '--name-only', head, '--', '--textconv'],
    ['diff-files', '--name-only', '--', '--cached']
  ];
  for (const args of commands) {
    assert.equal(gitReadCommandIsObservation(args), true, JSON.stringify(args));
    commandSucceeded(git(args));
  }
  assert.equal(commandSucceeded(git(['ls-files', '-z', '--', '--textconv'])), '--textconv\0');
  assert.equal(readFileSync(path.join(root, '--textconv'), 'utf8'), 'changed\n');
}));

test('real Git grep consumes forbidden-switch spellings as one -e pattern, not an effect option', () => inRepository(async (root, git) => {
  writeFileSync(path.join(root, 'source.txt'), '--textconv\n--recurse-submodules\n--upload-pack=x\n-e\n');
  commandSucceeded(git(['add', '--', 'source.txt']));
  commandSucceeded(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--no-gpg-sign', '--quiet', '-m', 'fixture']));
  const head = commandSucceeded(git(['rev-parse', '--verify', 'HEAD'])).trim();
  for (const pattern of ['--textconv', '--recurse-submodules', '--upload-pack=x', '-e', '--']) {
    const args = ['grep', '-F', '-l', '-z', '-e', pattern, head, '--', '.'];
    assert.equal(gitReadCommandIsObservation(args), true);
    assert.equal(commandSucceeded(git(args)), `${head}:source.txt\0`);
  }
}));

test('native child environment and the Git lookup helper agree on POSIX case and exact Unicode bytes', () => inRepository(async (root) => {
  const source = process.platform === 'win32'
    ? { PATH: '/upper', SystemRoot: process.env.SystemRoot }
    : { Path: '/mixed', PATH: '/upper', path: '/lower' };
  const env = canonicalGitChildEnvironment({ CUSTOM: '界🙂e\u0301 �', HOME: root }, source);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({Path:process.env.Path,PATH:process.env.PATH,path:process.env.path,CUSTOM:process.env.CUSTOM}))'], {
    env, encoding: 'utf8', timeout: 5000, maxBuffer: 4096, windowsHide: true
  });
  const output = JSON.parse(commandSucceeded(child));
  assert.equal(output.CUSTOM, '界🙂e\u0301 �'); assert.equal(output.PATH, gitEnvironmentValue(env, 'PATH'));
  if (process.platform !== 'win32') { assert.equal(output.Path, '/mixed'); assert.equal(output.path, '/lower'); }
}));
