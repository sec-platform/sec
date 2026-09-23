import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import {
  isVerificationLane,
  shouldExecuteRuntimeVerification,
  VERIFICATION_LANE_PROFILES,
  VERIFICATION_LANES,
  verificationLaneProfile
} from '../../src/assurance/verification/contract/lanes.ts';
import { registerWorkspaceCommands } from '../../src/bootstrap/cli/register-workspace-commands.ts';
import { parsePipelineCompileOptions } from '../../src/entry/cli/pipeline-command-input.ts';
import { registerPipelineCommands } from '../../src/entry/cli/register-pipeline-commands.ts';
import { parseVerifyCommandInput } from '../../src/entry/cli/workspace-command-input.ts';

for (const [lane, runFast, runtimeMode, scope] of [
  ['fast', true, 'service', 'partial'], ['runtime', false, 'service', 'partial'], ['all', true, 'full', 'complete']
] as const) {
  test(`${lane} keeps its actual fast/runtime execution and completion scope`, () => {
    const profile = verificationLaneProfile(lane);
    assert.deepEqual(profile, { runFast, runtimeMode, scope });
    assert.equal(shouldExecuteRuntimeVerification(profile, true), true);
    assert.equal(shouldExecuteRuntimeVerification(profile, false), !runFast);
    assert.ok(Object.isFrozen(profile));
    assert.equal(profile, VERIFICATION_LANE_PROFILES[lane]);
  });
  test(`${lane} is decoded identically by both CLI entrypoints`, () => {
    for (const flags of [{}, { json: true }, { json: true, compact: true }]) {
      const workspace = parseVerifyCommandInput({ ...flags, lane });
      const pipeline = parsePipelineCompileOptions({ ...flags, lane });
      assert.equal(workspace.request.lane, pipeline.invocation.verificationLane);
      assert.deepEqual(workspace.output, pipeline.output);
      assert.equal(workspace.request.emitTiming, !workspace.output.json);
      assert.ok(Object.isFrozen(workspace)); assert.ok(Object.isFrozen(workspace.request));
    }
  });
}

const inertPipelineOperations = {
  compile: async () => { throw new Error('pipeline compile operation must not run'); },
  inspect: async () => { throw new Error('pipeline inspect operation must not run'); }
} as const;

test('unknown, prototype and non-string lanes never become an execution recipe', () => {
  for (const value of [undefined, null, 0, {}, [], 'FAST', '', 'toString', '__proto__', new String('all')]) {
    assert.equal(isVerificationLane(value), false);
    assert.throws(() => verificationLaneProfile(value), RangeError);
    assert.throws(() => parseVerifyCommandInput({ lane: value }),
      (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001');
    assert.throws(() => parsePipelineCompileOptions({ lane: value }),
      (error: unknown) => (error as { code: string }).code === 'PIPELINE-USAGE-002');
  }
  assert.ok(Object.isFrozen(VERIFICATION_LANES));
  assert.ok(Object.isFrozen(VERIFICATION_LANE_PROFILES));
});

test('selection rejects without invoking coercion or conversion callbacks', () => {
  const value = { toString() { assert.fail('toString'); }, valueOf() { assert.fail('valueOf'); },
    [Symbol.toPrimitive]() { assert.fail('conversion'); } };
  assert.throws(() => verificationLaneProfile(value), RangeError);
  assert.throws(() => parseVerifyCommandInput({ lane: value }));
});

test('standalone and pipeline defaults remain independently registered', () => {
  const root = new Command().name('sec');
  registerWorkspaceCommands(root); registerPipelineCommands(root, inertPipelineOperations);
  const option = (name: string) => root.commands.find((c) => c.name() === name)!.options.find((o) => o.long === '--lane')!;
  assert.equal(option('verify').defaultValue, 'fast');
  assert.equal(option('compile').defaultValue, 'all');
  assert.equal(option('verify').flags, option('compile').flags);
  assert.equal(option('verify').description, option('compile').description);
});

test('verify captures only owned fields once and fixes execution and output values', () => {
  const reads: Record<string, number> = {};
  const raw = { lane: 'runtime', json: true, compact: false };
  const input = new Proxy(raw, { ownKeys() { assert.fail('unowned input enumerated'); },
    get(target, key) { reads[String(key)] = (reads[String(key)] ?? 0) + 1; return Reflect.get(target, key); } });
  const captured = parseVerifyCommandInput(input);
  raw.lane = 'all'; raw.json = false; raw.compact = true;
  assert.deepEqual(reads, { json: 1, compact: 1, lane: 1 });
  assert.deepEqual(captured, { output: { json: true, compact: false }, request: { lane: 'runtime', emitTiming: false } });
});

test('inherited lane cannot silently enter the standalone own-input boundary', () => {
  assert.throws(() => parseVerifyCommandInput(Object.create({ lane: 'all' })));
});

test('real verify and compile actions reject lanes before loading their execution domain', async () => {
  for (const name of ['verify', 'compile']) {
    const root = new Command().name('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
    registerWorkspaceCommands(root); registerPipelineCommands(root, inertPipelineOperations);
    const command = root.commands.find((c) => c.name() === name)!;
    command.setOptionValue('lane', 'unknown');
    await assert.rejects(root.parseAsync([name], { from: 'user' }), (error: unknown) =>
      (error as { code: string }).code === (name === 'verify' ? 'CLI-USAGE-001' : 'PIPELINE-USAGE-002'));
  }
});
