import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bindPipelineCompileRequest, selectPipelineStageRange } from '../../../src/application/pipeline-request.ts';
import { PIPELINE_STAGE_IDS } from '../../../src/compiler/pipeline/stages.ts';

function code(expected: string) { return (error: unknown) => (error as {code?: string})?.code === expected; }

test('every admitted range retains the ordered semantic prelude and every reversed range is rejected', () => {
  const bounds = [undefined, ...PIPELINE_STAGE_IDS];
  for (const from of bounds) for (const through of bounds) {
    const first = from === undefined ? 0 : PIPELINE_STAGE_IDS.indexOf(from);
    const last = through === undefined ? PIPELINE_STAGE_IDS.length - 1 : PIPELINE_STAGE_IDS.indexOf(through);
    if (first > last) {
      assert.throws(() => selectPipelineStageRange(from, through), code('PIPELINE-USAGE-001'));
      continue;
    }
    const selection = selectPipelineStageRange(from, through);
    const expected = PIPELINE_STAGE_IDS.slice(first, last + 1);
    if (first > PIPELINE_STAGE_IDS.indexOf('semantic')) expected.unshift('semantic');
    assert.deepEqual(selection.stages, expected);
    assert.equal(selection.from, from); assert.equal(selection.through, through);
    assert.ok(Object.isFrozen(selection)); assert.ok(Object.isFrozen(selection.stages));
  }
});

test('admitted requests preserve their source and lane, with reference verification defaulting to all', () => {
  assert.equal(bindPipelineCompileRequest({ source: 'reference' }).verificationLane, 'all');
  for (const lane of ['fast', 'runtime', 'all'] as const) {
    const result = bindPipelineCompileRequest({ source: 'cli', from: 'compose', through: 'verify', verificationLane: lane });
    assert.deepEqual(result, {
      from: 'compose', through: 'verify', stages: ['semantic', 'compose', 'verify'],
      source: 'cli', verificationLane: lane
    });
    assert.equal(Reflect.set(result.stages, 0, 'resolve'), false);
  }
});

test('range errors never execute user coercion hooks', () => {
  const value = { toString() { assert.fail('coercion'); }, [Symbol.toPrimitive]() { assert.fail('coercion'); } };
  assert.throws(() => selectPipelineStageRange(value, undefined), code('PIPELINE-USAGE-001'));
  assert.throws(() => selectPipelineStageRange(new String('verify'), undefined), code('PIPELINE-USAGE-001'));
});
