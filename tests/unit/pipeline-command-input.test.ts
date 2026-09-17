import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { CompilerError } from '../../src/compiler/errors.ts';
import { PIPELINE_EXECUTION_BOUNDARIES, PIPELINE_STAGE_IDS, PIPELINE_VERIFY_STAGE_IDS } from '../../src/adapters/compilation-protocol/types.ts';
import { parsePipelineCompileOptions, parsePipelineOutputOptions } from '../../src/bootstrap/cli/pipeline-command-input.ts';

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof CompilerError && error.code === expected;
}

test('captures the default CLI invocation without inventing absent stage bounds', () => {
  assert.deepEqual(parsePipelineCompileOptions({ lane: 'all' }), {
    output: { json: false, compact: false },
    invocation: { source: 'cli', verificationLane: 'all' }
  });
});

for (const lane of ['fast', 'runtime', 'all']) {
  test(`captures the exact ${lane} lane with both stage bounds`, () => {
    const result = parsePipelineCompileOptions({ lane, from: 'semantic', through: 'verify', json: true, compact: true });
    assert.deepEqual(result.invocation, { source: 'cli', from: 'semantic', through: 'verify', verificationLane: lane });
    assert.deepEqual(result.output, { json: true, compact: true });
  });
}

for (const stage of PIPELINE_STAGE_IDS) {
  test(`accepts registry-owned stage ${stage} without coercing it`, () => {
    assert.equal(parsePipelineCompileOptions({ lane: 'all', from: stage }).invocation.from, stage);
    assert.equal(parsePipelineCompileOptions({ lane: 'all', through: stage }).invocation.through, stage);
  });
}

for (const value of ['', null, false, 0, 1, {}, [], new String('verify'), Symbol('verify')]) {
  test(`rejects invalid stage value ${typeof value}:${String(value)}`, () => {
    assert.throws(() => parsePipelineCompileOptions({ lane: 'all', from: value }), code('PIPELINE-USAGE-001'));
    assert.throws(() => parsePipelineCompileOptions({ lane: 'all', through: value }), code('PIPELINE-USAGE-001'));
  });
}

for (const value of [undefined, null, '', 'ALL', ' fast', 0, true, {}, [], new String('all')]) {
  test(`rejects invalid lane value ${typeof value}:${String(value)}`, () => {
    assert.throws(() => parsePipelineCompileOptions({ lane: value }), code('PIPELINE-USAGE-002'));
  });
}

for (const value of [null, 0, 1, 'false', 'true', '', {}, [], new Boolean(false)]) {
  test(`rejects non-boolean output flags ${typeof value}:${String(value)}`, () => {
    assert.throws(() => parsePipelineOutputOptions({ json: value }), code('PIPELINE-USAGE-003'));
    assert.throws(() => parsePipelineOutputOptions({ json: true, compact: value }), code('PIPELINE-USAGE-003'));
    assert.throws(() => parsePipelineCompileOptions({ lane: 'all', json: value }), code('PIPELINE-USAGE-003'));
  });
}

test('compact output requires JSON in both commands', () => {
  assert.throws(() => parsePipelineOutputOptions({ compact: true }), /--compact requires --json/);
  assert.throws(() => parsePipelineCompileOptions({ lane: 'all', compact: true }), /--compact requires --json/);
  assert.deepEqual(parsePipelineOutputOptions({ json: false, compact: false }), { json: false, compact: false });
  assert.deepEqual(parsePipelineOutputOptions({ json: true, compact: false }), { json: true, compact: false });
});

test('rejects values without invoking conversion hooks', () => {
  let calls = 0;
  const value = { toString() { calls += 1; return 'all'; }, [Symbol.toPrimitive]() { calls += 1; return 'all'; } };
  assert.throws(() => parsePipelineCompileOptions({ lane: value }), code('PIPELINE-USAGE-002'));
  assert.throws(() => parsePipelineCompileOptions({ lane: 'all', from: value }), code('PIPELINE-USAGE-001'));
  assert.throws(() => parsePipelineOutputOptions({ json: value }), code('PIPELINE-USAGE-003'));
  assert.equal(calls, 0);
});

test('captures only the command fields once, ignoring unrelated getters', () => {
  const reads: Record<string, number> = {};
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ json: true, compact: false, lane: 'all', from: 'resolve', through: 'emit' })) {
    Object.defineProperty(input, key, { get() { reads[key] = (reads[key] ?? 0) + 1; return reads[key] === 1 ? value : undefined; } });
  }
  Object.defineProperty(input, 'unrelated', { enumerable: true, get() { throw new Error('not command input'); } });
  const result = parsePipelineCompileOptions(input);
  assert.equal(result.invocation.from, 'resolve');
  assert.equal(result.invocation.through, 'emit');
  assert.deepEqual(reads, { json: 1, compact: 1, from: 1, through: 1, lane: 1 });
});

test('inspection does not access compilation fields', () => {
  const input = Object.defineProperty({ json: true }, 'lane', { get() { throw new Error('not inspect input'); } });
  assert.deepEqual(parsePipelineOutputOptions(input), { json: true, compact: false });
});

test('returned values are frozen, detached from caller mutation and cannot change invocation source', () => {
  const input = { lane: 'all', from: 'resolve', json: true, source: 'api' };
  const result = parsePipelineCompileOptions(input);
  input.from = 'emit'; input.json = false;
  assert.equal(result.invocation.from, 'resolve');
  assert.equal(result.invocation.source, 'cli');
  assert.equal(result.output.json, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.invocation));
  assert.ok(Object.isFrozen(result.output));
});

test('stage vocabulary cannot diverge from its already-derived verification prefix', () => {
  assert.ok(Object.isFrozen(PIPELINE_STAGE_IDS));
  assert.ok(Object.isFrozen(PIPELINE_EXECUTION_BOUNDARIES));
  assert.ok(Object.isFrozen(PIPELINE_VERIFY_STAGE_IDS));
  const stages = [...PIPELINE_STAGE_IDS];
  assert.equal(Reflect.set(PIPELINE_STAGE_IDS, 0, 'injected'), false);
  assert.deepEqual(PIPELINE_STAGE_IDS, stages);
  assert.deepEqual(PIPELINE_VERIFY_STAGE_IDS, PIPELINE_STAGE_IDS.slice(0, PIPELINE_STAGE_IDS.indexOf('verify') + 1));
});
