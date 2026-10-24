import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import {
  isVerificationLane,
  shouldExecuteRuntimeVerification,
  VERIFICATION_LANE_PROFILES,
  VERIFICATION_LANES,
  verificationLaneProfile
} from '../../../src/assurance/verification/contract/lanes.ts';
import { registerWorkspaceCommands } from '../../../src/bootstrap/cli/register-workspace-commands.ts';
import { parsePipelineCompileOptions } from '../../../src/entry/cli/pipeline-command-input.ts';
import { registerPipelineCommands } from '../../../src/entry/cli/register-pipeline-commands.ts';
import { parseVerifyCommandInput } from '../../../src/entry/cli/workspace-command-input.ts';

for (const [lane, runFast, runtimeMode, scope] of [
  ['fast', true, 'service', 'partial'], ['runtime', false, 'service', 'partial'], ['all', true, 'full', 'complete']
] as const) {
  test(`${lane} keeps its actual fast/runtime execution and completion scope`, () => {
    const profile = verificationLaneProfile(lane);
    assert.deepEqual(profile, { runFast, runtimeMode, scope });
    assert.equal(shouldExecuteRuntimeVerification(profile, true), true);
    assert.equal(shouldExecuteRuntimeVerification(profile, false), !runFast);
    assert.ok(Object.isFrozen(profile));
  });
}

test('standalone captures each lane and the independent output and timing choices', () => {
  for (const [lane, flags, expectedOutput] of [
    ['fast', {}, { json: false, compact: false }],
    ['runtime', { json: true }, { json: true, compact: false }],
    ['all', { json: true, compact: true }, { json: true, compact: true }]
  ] as const) {
    const workspace = parseVerifyCommandInput({ ...flags, lane });
    assert.equal(workspace.request.lane, lane);
    assert.deepEqual(workspace.output, expectedOutput);
    assert.equal(workspace.request.emitTiming, !expectedOutput.json);
    assert.ok(Object.isFrozen(workspace)); assert.ok(Object.isFrozen(workspace.request));
  }
  const mutable: Record<string, unknown> = { lane: 'runtime', json: true, compact: false };
  const captured = parseVerifyCommandInput(mutable);
  mutable.lane = 'all'; mutable.json = false; mutable.compact = true;
  assert.deepEqual(captured, {
    output: { json: true, compact: false },
    request: { lane: 'runtime', emitTiming: false }
  });
});

const inertPipelineOperations = {
  compile: async () => { throw new Error('pipeline compile operation must not run'); },
  inspect: async () => { throw new Error('pipeline inspect operation must not run'); }
} as const;

test('unknown, prototype and non-string lanes never become an execution recipe', () => {
  for (const value of [undefined, null, 0, {}, [], 'ALL', '', 'toString', '__proto__', new String('all')]) {
    assert.equal(isVerificationLane(value), false);
    assert.throws(() => verificationLaneProfile(value), RangeError);
    // Commander supplies text here; arbitrary values remain a domain obligation.
    if (typeof value !== 'string') continue;
    assert.throws(() => parseVerifyCommandInput({ lane: value }),
      (error: unknown) => error instanceof CodedFailure && error.code === 'CLI-USAGE-001');
    assert.throws(() => parsePipelineCompileOptions({ lane: value }),
      (error: unknown) => error instanceof CodedFailure && error.code === 'PIPELINE-USAGE-002');
  }
  assert.ok(Object.isFrozen(VERIFICATION_LANES));
  assert.ok(Object.isFrozen(VERIFICATION_LANE_PROFILES));
});

test('selection rejects without invoking coercion or conversion callbacks', () => {
  let conversions = 0;
  const value = { toString() { conversions++; return 'all'; }, valueOf() { conversions++; return 'all'; },
    [Symbol.toPrimitive]() { conversions++; return 'all'; } };
  assert.throws(() => verificationLaneProfile(value), RangeError);
  assert.throws(() => parseVerifyCommandInput({ lane: value }),
    (error: unknown) => error instanceof CodedFailure && error.code === 'CLI-USAGE-001');
  assert.equal(conversions, 0);
});

test('standalone and pipeline defaults remain independently registered', () => {
  const root = new Command().name('sec');
  registerWorkspaceCommands(root); registerPipelineCommands(root, inertPipelineOperations);
  const option = (name: string) => root.commands.find((c) => c.name() === name)!.options.find((o) => o.long === '--lane')!;
  assert.equal(option('verify').defaultValue, 'fast');
  assert.equal(option('compile').defaultValue, 'all');
  assert.equal(option('verify').required, true);
  assert.equal(option('compile').required, true);
});

test('inherited lane cannot silently enter the standalone own-input boundary', () => {
  assert.throws(() => parseVerifyCommandInput(Object.create({ lane: 'all' })),
    (error: unknown) => error instanceof CodedFailure && error.code === 'CLI-USAGE-001');
});

