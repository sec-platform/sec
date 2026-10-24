import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { CodedFailure } from '../../../src/contracts/failure.ts';
import { parsePipelineCompileOptions, parsePipelineOutputOptions } from '../../../src/entry/cli/pipeline-command-input.ts';

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof CodedFailure && error.code === expected;
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

test('compile forwards invalid stage admission for both bounds', () => {
  assert.throws(() => parsePipelineCompileOptions({ lane: 'all', from: '' }), code('PIPELINE-USAGE-001'));
  assert.throws(() => parsePipelineCompileOptions({ lane: 'all', through: '' }), code('PIPELINE-USAGE-001'));
});

test('rejects an invalid textual lane', () => {
  assert.throws(() => parsePipelineCompileOptions({ lane: 'ALL' }), code('PIPELINE-USAGE-002'));
});

test('compile rejects compact output without JSON', () => {
  assert.throws(() => parsePipelineCompileOptions({ lane: 'all', compact: true }), /--compact requires --json/);
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
