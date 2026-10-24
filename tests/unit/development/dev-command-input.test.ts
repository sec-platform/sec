import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  captureDevCommandInput,
  type DevCommandOptions
} from '../../../src/adapters/self-hosting/development/runner/command-input.ts';
import { DEV_COMMAND_MAX_DURATION_MS, DEV_COMMAND_MAX_STDIN_BYTES } from '../../../src/adapters/self-hosting/development/runner/contract.ts';

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
});

test.serial('an earlier parent deadline narrows the command without a fresh duration window', () => {
  const now = Date.now, capturedAt = 1_000_000;
  Date.now = () => capturedAt;
  try {
    const parent = capturedAt + 1000;
    const result = capture({ timeoutMs: 20_000, deadlineAtUnixMs: parent });
    assert.equal(result.deadlineAtUnixMs, parent); assert.equal(result.timeoutMs, 1000);
    assert.throws(() => capture({ deadlineAtUnixMs: capturedAt - 1 }), /exhausted/);
  } finally { Date.now = now; }
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
