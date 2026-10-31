import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { parsePipelineCompileOptions } from '../../../src/entry/cli/pipeline-command-input.ts';

test('captures the default CLI invocation without inventing absent stage bounds', () => {
  assert.deepEqual(parsePipelineCompileOptions({ lane: 'all' }), {
    output: { json: false, compact: false },
    invocation: { source: 'cli', verificationLane: 'all' }
  });
});

test('returned values are detached from caller mutation and cannot change invocation source', () => {
  const input = { lane: 'runtime', from: 'resolve', through: 'verify', json: true, compact: true, source: 'api' };
  const result = parsePipelineCompileOptions(input);
  input.from = 'emit'; input.through = 'emit'; input.lane = 'fast';
  input.json = false; input.compact = false;
  assert.deepEqual(result.invocation, { source: 'cli', from: 'resolve', through: 'verify', verificationLane: 'runtime' });
  assert.deepEqual(result.output, { json: true, compact: true });
});
