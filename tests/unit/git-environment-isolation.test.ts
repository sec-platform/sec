import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';

import { canonicalGitChildEnvironment as environment, gitEnvironmentValue } from '../../src/external-capabilities/git/environment.ts';

function keysNamed(env: Readonly<Record<string, string>>, name: string): string[] {
  return Object.keys(env).filter((key) => key.toUpperCase() === name.toUpperCase());
}

test('mandatory Git isolation cannot be disabled through mixed-case overrides', () => {
  const env = environment({ git_terminal_prompt: '1', Git_No_Replace_Objects: '0', Git_Config_Global: 'evil' }, {});
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.GIT_LITERAL_PATHSPECS, '1');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GH_PROMPT_DISABLED, '1');
  assert.equal(env.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'NUL' : devNull);
  assert.deepEqual(keysNamed(env, 'GIT_CONFIG_GLOBAL'), ['GIT_CONFIG_GLOBAL']);
});

for (const name of ['GIT_TRACE', 'GIT_TRACE_SETUP', 'GIT_TRACE_CURL', 'GIT_TRACE_PACK_ACCESS', 'GIT_TRACE_REFS', 'GIT_TRACE_FSMONITOR', 'GIT_TRACE_SHALLOW', 'GIT_TRACE2', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF', 'GIT_TRACE2_CONFIG_PARAMS']) {
  test(`Git diagnostic sink ${name} is rejected from both ambient and override sources`, () => {
    assert.equal(gitEnvironmentValue(environment({ [name.toLowerCase()]: '/unadmitted' }, { [name]: '/ambient' }), name), undefined);
  });
}

test('ambient repository and indexed configuration injection are removed', () => {
  const env = environment({}, { GIT_DIR: 'other', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'x', GIT_CONFIG_VALUE_0: 'y', GIT_SSH_COMMAND: 'other' });
  for (const name of ['GIT_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_SSH_COMMAND']) assert.equal(env[name], undefined);
});

test('explicit owner-supplied repository and index overrides retain their contract', () => {
  const env = environment({ GIT_DIR: 'admitted', GIT_INDEX_FILE: 'admitted-index' }, { GIT_DIR: 'ambient' });
  assert.equal(env.GIT_DIR, 'admitted');
  assert.equal(env.GIT_INDEX_FILE, 'admitted-index');
});

test('blocked ambient values are not read before being discarded', () => {
  const source = Object.defineProperty({}, 'GIT_TRACE_SETUP', { enumerable: true, get() { throw new Error('must not read'); } });
  assert.equal(environment({}, source).GIT_TRACE_SETUP, undefined);
});

test('blocked override values are not read before being discarded', () => {
  const overrides = Object.defineProperty({}, 'GIT_TERMINAL_PROMPT', { enumerable: true, get() { throw new Error('must not read'); } });
  assert.equal(environment(overrides, {}).GIT_TERMINAL_PROMPT, '0');
});

test('case-insensitive environment lookup does not read unrelated getters', () => {
  const env = Object.defineProperty({ PATH: 'chosen' }, 'unrelated', { enumerable: true, get() { throw new Error('must not read'); } });
  assert.equal(gitEnvironmentValue(env, 'path'), 'chosen');
});

test('environment resolution does not mutate its source or overrides', () => {
  const source = Object.freeze({ Path: 'old', GIT_DIR: 'ambient' });
  const overrides = Object.freeze({ PATH: 'new' });
  environment(overrides, source);
  assert.deepEqual(source, { Path: 'old', GIT_DIR: 'ambient' });
  assert.deepEqual(overrides, { PATH: 'new' });
});

test('ordinary empty-string environment values remain distinct from deletion', () => {
  const env = environment({ PATH: '' }, { Path: 'old' });
  assert.equal(gitEnvironmentValue(env, 'PATH'), '');
  assert.deepEqual(keysNamed(env, 'PATH'), ['PATH']);
});

test('unrelated similarly named environment variables remain unchanged', () => {
  assert.equal(environment({}, { GIT_TRACER: 'application-owned' }).GIT_TRACER, 'application-owned');
});

test('real read-only Git invocation cannot write through an inherited trace destination', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-env-'));
  const trace = path.join(root, 'unadmitted-trace.log');
  try {
    execFileSync('git', ['init', '--quiet', root], { env: environment({}, process.env), stdio: 'pipe' });
    const env = environment({}, { ...process.env, GIT_TRACE_SETUP: trace });
    execFileSync('git', ['-C', root, 'status', '--porcelain'], { env, stdio: 'pipe' });
    assert.equal(existsSync(trace), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const nonStringEnvironmentValues: readonly unknown[] = [
  0, 1, true, false, null, 1n, {}, [], () => 'coerced', Symbol('coerced'), new String('boxed')
];
for (const [index, value] of nonStringEnvironmentValues.entries()) {
  test(`retained environment value ${index} cannot acquire a new meaning through child-process coercion`, () => {
    assert.throws(() => environment({}, { CUSTOM: value } as NodeJS.ProcessEnv), TypeError);
    assert.throws(() => environment({ CUSTOM: value } as Record<string, string | undefined>, {}), TypeError);
  });
}

test('environment rejection does not invoke a caller-controlled string conversion', () => {
  let conversions = 0;
  const value = { toString() { conversions += 1; return 'coerced'; } };
  assert.throws(() => environment({ CUSTOM: value } as unknown as Record<string, string>, {}), TypeError);
  assert.equal(conversions, 0);
});

test('a retained value is captured once before validating and publishing it', () => {
  let reads = 0;
  const input = Object.defineProperty({}, 'CUSTOM', {
    enumerable: true,
    get() { reads += 1; return reads === 1 ? 'first' : 'changed'; }
  });
  assert.equal(environment(input, {}).CUSTOM, 'first');
  assert.equal(reads, 1);
});
