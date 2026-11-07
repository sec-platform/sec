import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { devNull } from 'node:os';
import { canonicalGitChildEnvironment, gitEnvironmentValue } from '../../../src/adapters/providers/git/environment.ts';

// Independent forbidden-input vectors, not derived from the production sets.
const configInputs = ['GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_100', 'GIT_CONFIG_VALUE_100', 'GIT_CONFIG_SYSTEM'];
const helperInputs = ['GIT_EXEC_PATH', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_PROXY_COMMAND',
  'GIT_ASKPASS', 'GIT_ASKPASS_REQUIRE', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'GIT_EXTERNAL_DIFF',
  'GIT_DIFF_OPTS', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_PAGER', 'PAGER', 'GIT_FS_MONITOR'];
const traceInputs = ['GIT_TRACE', 'GIT_TRACE_SETUP', 'GIT_TRACE_CURL', 'GIT_TRACE_PACK_ACCESS',
  'GIT_TRACE_REFS', 'GIT_TRACE_FSMONITOR', 'GIT_TRACE_SHALLOW', 'GIT_TRACE2', 'GIT_TRACE2_EVENT',
  'GIT_TRACE2_PERF', 'GIT_TRACE2_CONFIG_PARAMS'];
const guardedTraceInputs = ['GIT_TRACE', 'GIT_TRACE_PACKET', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF'];

test('both input layers reject configuration, helper and trace selectors before reading their values', () => {
  const configSpellings = configInputs.flatMap(name => [name, name.toLowerCase()]);
  const layers = [
    { inherited: true, names: [...configSpellings, ...helperInputs, ...guardedTraceInputs, ...traceInputs] },
    { inherited: false, names: [...configSpellings, ...helperInputs, ...guardedTraceInputs,
      ...traceInputs.map(name => name.toLowerCase())] }
  ];
  for (const { inherited, names } of layers) {
    const values: Record<string, string> = {};
    for (const name of new Set(names)) {
      Object.defineProperty(values, name, { enumerable: true, get() { assert.fail(`read excluded ${name}`); } });
    }
    // A retained value after the rejected names also catches premature loop exit.
    values.CUSTOM = 'retained'; values.GIT_TRACER = 'application-owned';
    Object.freeze(values);
    const env = inherited ? canonicalGitChildEnvironment({}, values)
      : canonicalGitChildEnvironment(values, { CUSTOM: 'ambient' });
    for (const name of names) assert.equal(Object.hasOwn(env, name), false);
    assert.equal(env.CUSTOM, 'retained'); assert.equal(env.GIT_TRACER, 'application-owned');
  }
});

test('subject bindings remain explicit and survive the next physical-provider projection', () => {
  const selectors = { GIT_DIR: '/chosen/repo', GIT_WORK_TREE: '/chosen/work', GIT_INDEX_FILE: '/chosen/index',
    GIT_OBJECT_DIRECTORY: '/chosen/objects', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/chosen/alternate', LANG: 'C', LC_ALL: 'C' };
  const inherited = canonicalGitChildEnvironment({}, selectors);
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
    assert.equal(inherited[name], undefined);
  }
  const first = canonicalGitChildEnvironment(selectors, { GIT_DIR: '/ambient/repo' });
  for (const [name, value] of Object.entries(selectors)) assert.equal(first[name], value);
  assert.deepEqual(canonicalGitChildEnvironment(first, {}), first);
});

test('mandatory literal paths, disabled prompts and local-config boundaries cannot be weakened', () => {
  const env = canonicalGitChildEnvironment({ GIT_LITERAL_PATHSPECS: '0', GIT_GLOB_PATHSPECS: '1',
    GIT_NOGLOB_PATHSPECS: '1', GIT_ICASE_PATHSPECS: '1', GIT_NO_REPLACE_OBJECTS: '0',
    GIT_NO_LAZY_FETCH: '0', GIT_OPTIONAL_LOCKS: '1', GIT_CONFIG_GLOBAL: '/other', GIT_CONFIG_NOSYSTEM: '0',
    get GIT_TERMINAL_PROMPT() { assert.fail('read excluded prompt override'); return '1'; }, git_terminal_prompt: '1',
    Git_No_Replace_Objects: '0', Git_Config_Global: 'evil' }, {});
  assert.equal(env.GIT_LITERAL_PATHSPECS, '1');
  for (const key of ['GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS']) assert.equal(env[key], undefined);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0'); assert.equal(env.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(env.GIT_NO_LAZY_FETCH, '1'); assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'NUL' : devNull);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GH_PROMPT_DISABLED, '1');
  assert.deepEqual(Object.keys(env).filter(name => name.toUpperCase() === 'GIT_CONFIG_GLOBAL'), ['GIT_CONFIG_GLOBAL']);
});

test('native case identity is preserved rather than imposed globally', () => {
  const source = { Path: '/mixed', PATH: '/upper', path: '/lower' };
  if (process.platform === 'win32') {
    assert.throws(() => canonicalGitChildEnvironment({}, source), /conflicting case variants/);
    assert.equal(gitEnvironmentValue(source, 'PATH'), '/upper');
  } else {
    const env = canonicalGitChildEnvironment({}, source);
    assert.equal(env.Path, '/mixed'); assert.equal(env.PATH, '/upper'); assert.equal(env.path, '/lower');
    assert.equal(gitEnvironmentValue(env, 'PATH'), '/upper'); assert.equal(gitEnvironmentValue(env, 'Path'), '/mixed');
    assert.equal(gitEnvironmentValue({ Path: '/mixed' }, 'PATH'), undefined);
  }
});

test('override deletion follows native identity and never mutates either caller record', () => {
  const source = Object.freeze({ LANG: 'base', Path: '/mixed' });
  const overrides = Object.freeze({ LANG: undefined, PATH: '/chosen' });
  const env = canonicalGitChildEnvironment(overrides, source);
  assert.equal(env.LANG, undefined); assert.equal(env.PATH, '/chosen');
  assert.equal(env.Path, process.platform === 'win32' ? undefined : '/mixed');
  assert.deepEqual(source, { LANG: 'base', Path: '/mixed' });
  assert.deepEqual(overrides, { LANG: undefined, PATH: '/chosen' });
});

test('equal Windows spellings coalesce while their byte-distinct POSIX names remain separate', () => {
  const env = canonicalGitChildEnvironment({ PATH: '/same', Path: '/same' }, {});
  const keys = Object.keys(env).filter(key => key.toUpperCase() === 'PATH').sort();
  assert.deepEqual(keys, process.platform === 'win32' ? ['PATH'] : ['PATH', 'Path']);
});

test('environment records and native names reject malformed values before child-process coercion', () => {
  for (const value of [null, [], 'record', 7, false]) {
    assert.throws(() => canonicalGitChildEnvironment({}, value as never), TypeError);
  }
  assert.throws(() => canonicalGitChildEnvironment(null as never, {}), TypeError);
  for (const name of ['', 'a=b', 'a\0b', '\ud800', '\udc00']) {
    let read = false;
    const values = Object.defineProperty({}, name, { enumerable: true, get() { read = true; return 'x'; } });
    assert.throws(() => canonicalGitChildEnvironment(values, {}), TypeError); assert.equal(read, false);
  }
  let conversions = 0;
  const hostile = { toString() { conversions++; return 'coerced'; } };
  for (const value of [0, hostile, 'a\0b', '\ud800', '\udc00']) {
    assert.throws(() => canonicalGitChildEnvironment({ CUSTOM: value as never }, {}), TypeError);
  }
  assert.equal(conversions, 0);
});

test('ordinary Unicode, spaces and empty values are retained exactly without normalization', () => {
  const env = canonicalGitChildEnvironment({ CUSTOM: '界🙂e\u0301 �', EMPTY: '', 'NAME WITH SPACE': 'value', PATH: '' }, { Path: 'old' });
  assert.equal(env.CUSTOM, '界🙂e\u0301 �'); assert.equal(env.EMPTY, ''); assert.equal(env['NAME WITH SPACE'], 'value');
  assert.equal(gitEnvironmentValue(env, 'PATH'), '');
  assert.deepEqual(Object.keys(env).filter(name => name.toUpperCase() === 'PATH').sort(),
    process.platform === 'win32' ? ['PATH'] : ['PATH', 'Path']);
  assert.equal(env.Path, process.platform === 'win32' ? undefined : 'old');
});

test('only own named data is selected and accepted getters are evaluated once', () => {
  let reads = 0;
  const source = Object.assign(Object.create({ HIDDEN: 'inherited' }), { VISIBLE: 'visible' });
  const override = Object.defineProperty({}, 'ONCE', { enumerable: true, get() { reads++; return reads === 1 ? 'captured' : 'changed'; } });
  const env = canonicalGitChildEnvironment(override, source);
  assert.equal(reads, 1); assert.equal(env.ONCE, 'captured'); assert.equal(env.HIDDEN, undefined);
  assert.equal(Object.getPrototypeOf(env), null); assert.ok(Object.isFrozen(env));
  assert.equal(gitEnvironmentValue(Object.create({ PATH: '/prototype' }), 'PATH'), undefined);
  const lookup = Object.defineProperty({ PATH: 'chosen' }, 'unrelated', { enumerable: true,
    get() { assert.fail('unrelated getter'); } });
  assert.equal(gitEnvironmentValue(lookup, 'PATH'), 'chosen');
  assert.equal(gitEnvironmentValue(lookup, 'path'), process.platform === 'win32' ? 'chosen' : undefined);
});
