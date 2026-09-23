import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureDevCommandInput,
  type DevCommandOptions
} from '../../src/adapters/self-hosting/development/runner/command-input.ts';
import { DEV_COMMAND_MAX_DURATION_MS, DEV_COMMAND_MAX_STDIN_BYTES } from '../../src/adapters/self-hosting/development/runner/contract.ts';

const capture = (options?: DevCommandOptions, args: string[] = [], env: NodeJS.ProcessEnv = {}) =>
  captureDevCommandInput(args, env, options, process.cwd());

test('ordinary command decisions preserve defaults without retaining caller containers', () => {
  const args = ['test', 'a b.ts'], env = { SEC_DEV_COMMAND_TEST: 'one' }, input = Uint8Array.of(1, 2, 3);
  const before = Date.now(), result = capture({ input, observe: true }, args, env), after = Date.now();
  assert.deepEqual(result.args, args); assert.equal(result.observed, true);
  assert.equal(result.inputBytes, 3); assert.equal(result.timeoutMs, DEV_COMMAND_MAX_DURATION_MS);
  assert.ok(result.deadlineAtUnixMs >= before + DEV_COMMAND_MAX_DURATION_MS);
  assert.ok(result.deadlineAtUnixMs <= after + DEV_COMMAND_MAX_DURATION_MS);
  args[0] = 'changed'; env.SEC_DEV_COMMAND_TEST = 'two'; input.fill(0);
  assert.deepEqual(result.args, ['test', 'a b.ts']); assert.equal(result.environment.SEC_DEV_COMMAND_TEST, 'one');
  assert.deepEqual([...result.input!], [1, 2, 3]);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.args)); assert.ok(Object.isFrozen(result.environment));
});

test('an earlier parent deadline narrows the command without a fresh duration window', () => {
  const parent = Date.now() + 1000;
  const result = capture({ timeoutMs: 20_000, deadlineAtUnixMs: parent });
  assert.equal(result.deadlineAtUnixMs, parent); assert.ok(result.timeoutMs <= 1000 && result.timeoutMs >= 2);
  assert.throws(() => capture({ deadlineAtUnixMs: Date.now() - 1 }), /exhausted/);
});

test('explicit invalid mode, timing, path or signal values cannot select defaults', () => {
  for (const options of [null, [], false, { observe: 'true' }, { observe: null }, { timeoutMs: null },
    { timeoutMs: 1 }, { timeoutMs: DEV_COMMAND_MAX_DURATION_MS + 1 }, { deadlineAtUnixMs: null },
    { workingDirectory: false }, { workingDirectory: 'a\0b' }, { signal: null }, { signal: {} }]) {
    assert.throws(() => capture(options as never));
  }
});

test('a native abort signal is captured by identity, including an already-aborted one', () => {
  const controller = new AbortController(); controller.abort(null);
  assert.equal(capture({ signal: controller.signal }).signal, controller.signal);
});

test('each declared option is read once and unrelated getters are not enumerated', () => {
  const reads: string[] = [];
  const source = { observe: true, timeoutMs: 1000, input: Uint8Array.of(1) };
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) Object.defineProperty(options, key, { get() { reads.push(key); return value; } });
  Object.defineProperty(options, 'unrelated', { get() { assert.fail('unused getter'); } });
  capture(new Proxy(options, { ownKeys() { assert.fail('wide enumeration'); } }) as unknown as DevCommandOptions);
  assert.deepEqual(reads.sort(), ['input', 'observe', 'timeoutMs']);
});

test('actual typed-array view is copied once, not its shadow fields or iterator', () => {
  const input = Uint8Array.of(0, 2, 3, 0).subarray(1, 3);
  Object.defineProperties(input, { byteLength: { value: 0 }, buffer: { get() { assert.fail('buffer getter'); } },
    [Symbol.iterator]: { value() { assert.fail('iterator'); } } });
  const result = capture({ input }); assert.equal(result.inputBytes, 2); assert.deepEqual([...result.input!], [2, 3]);
  assert.throws(() => capture({ input: new Uint8Array(new SharedArrayBuffer(1)) }), /shared/);
  assert.throws(() => capture({ input: new Uint8Array(DEV_COMMAND_MAX_STDIN_BYTES + 1) }), /stdin/);
});

test('argument and auxiliary arrays use their own values rather than custom iteration', () => {
  const args = ['original']; args[Symbol.iterator] = () => { throw new Error('iterator'); };
  assert.deepEqual(capture(undefined, args).args, ['original']);
  const invalid = [new Array(1), ['x', null], Object.defineProperty([], '0', { get() { assert.fail('getter'); }, configurable: true })];
  for (const value of invalid) assert.throws(() => capture(undefined, value as never));
  assert.throws(() => capture(undefined, ['x\0y']));
  assert.throws(() => capture({ auxiliaryOrdinaryFilePaths: ['x', './x'] }), /unique/);
});

test('environment overrides may delete inherited entries but cannot coerce invalid values', () => {
  const key = 'SEC_DEV_COMMAND_CAPTURE_TEST', previous = process.env[key];
  try {
    process.env[key] = 'inherited';
    assert.equal(capture(undefined, [], { [key]: undefined }).environment[key], undefined);
    for (const env of [null, [], { 'bad=key': 'x' }, { key: 1 }, { key: false }, { key: null }, { key: 'a\0b' }]) {
      assert.throws(() => capture(undefined, [], env as never));
    }
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});

test('path origin is fixed before option getters can change process cwd', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'command-input-')), previous = process.cwd();
  mkdirSync(path.join(root, 'other'));
  try {
    process.chdir(root);
    const result = capture({ get observe() { process.chdir(path.join(root, 'other')); return false; },
      workingDirectory: 'work', auxiliaryOrdinaryFilePaths: ['input.ts'] });
    assert.equal(result.workingDirectory, path.join(root, 'work'));
    assert.deepEqual(result.auxiliaryOrdinaryFilePaths, [path.join(root, 'input.ts')]);
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});

test('oversized stdin is rejected before the snapshot copies its bytes', () => {
  const source = new Uint8Array(DEV_COMMAND_MAX_STDIN_BYTES + 1), original = Buffer.from;
  let copied = false;
  Buffer.from = ((...args: Parameters<typeof Buffer.from>) => {
    if (ArrayBuffer.isView(args[0]) && args[0].byteLength === source.byteLength) copied = true;
    return Reflect.apply(original, Buffer, args);
  }) as typeof Buffer.from;
  try { assert.throws(() => capture({ input: source }), /stdin/); assert.equal(copied, false); }
  finally { Buffer.from = original; }
});
