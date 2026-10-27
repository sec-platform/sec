import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { parsePipelineCompileOptions } from '../../../src/entry/cli/pipeline-command-input.ts';

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

test('returned values are detached from caller mutation and cannot change invocation source', () => {
  const input = { lane: 'all', from: 'resolve', json: true, source: 'api' };
  const result = parsePipelineCompileOptions(input);
  input.from = 'emit'; input.json = false;
  assert.equal(result.invocation.from, 'resolve');
  assert.equal(result.invocation.source, 'cli');
  assert.deepEqual(result.output, { json: true, compact: false });
});
