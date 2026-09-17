import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bindPipelineCompileRequest, PIPELINE_DEFAULT_VERIFICATION_LANE, selectPipelineStageRange } from '../../src/adapters/compilation/pipeline/invocation.ts';
import { PIPELINE_STAGE_IDS } from '../../src/adapters/compilation-protocol/stages.ts';
import { parsePipelineCompileOptions, PIPELINE_COMPILE_DEFAULT_LANE } from '../../src/bootstrap/cli/pipeline-command-input.ts';

function code(expected: string) { return (error: unknown) => (error as {code?: string})?.code === expected; }

test('every admitted range retains the ordered semantic prelude and every reversed range is rejected', () => {
  const bounds = [undefined, ...PIPELINE_STAGE_IDS];
  for (const from of bounds) for (const through of bounds) {
    const first = from === undefined ? 0 : PIPELINE_STAGE_IDS.indexOf(from);
    const last = through === undefined ? PIPELINE_STAGE_IDS.length - 1 : PIPELINE_STAGE_IDS.indexOf(through);
    if (first > last) {
      assert.throws(() => selectPipelineStageRange(from, through), code('PIPELINE-USAGE-001'));
      assert.throws(() => parsePipelineCompileOptions({ from, through, lane: 'all' }), code('PIPELINE-USAGE-001'));
      continue;
    }
    const selection = selectPipelineStageRange(from, through);
    const expected = PIPELINE_STAGE_IDS.slice(first, last + 1);
    if (first > PIPELINE_STAGE_IDS.indexOf('semantic')) expected.unshift('semantic');
    assert.deepEqual(selection.stages, expected);
    assert.deepEqual(bindPipelineCompileRequest({ from, through }).stages, expected);
    assert.equal(selection.from, from); assert.equal(selection.through, through);
    assert.equal(new Set(selection.stages).size, selection.stages.length);
    assert.ok(Object.isFrozen(selection)); assert.ok(Object.isFrozen(selection.stages));
  }
});

for (const value of [null, '', false, 0, {}, [], new String('verify'), Symbol('stage')]) {
  test(`API stage admission rejects ${typeof value} instead of silently selecting defaults`, () => {
    assert.throws(() => bindPipelineCompileRequest({ from: value as never }), code('PIPELINE-USAGE-001'));
    assert.throws(() => bindPipelineCompileRequest({ through: value as never }), code('PIPELINE-USAGE-001'));
  });
}

test('requests capture owned fields once and never enumerate capabilities or unrelated options', () => {
  const counts = new Map<string, number>();
  const values = { from: 'compose', through: 'verify', source: 'ci', verificationLane: 'runtime' };
  const input = new Proxy(Object.fromEntries([]), { ownKeys() { assert.fail('request enumerated'); } });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(input, key, {
    get() { counts.set(key, (counts.get(key) ?? 0) + 1); return value; }
  });
  for (const key of ['onEvent', 'workspaceWriteLease', 'isolatedVerificationCapability', 'stagedVerificationProof', 'unrelated']) {
    Object.defineProperty(input, key, { get() { assert.fail('request read capability '+key); } });
  }
  const result = bindPipelineCompileRequest(input);
  assert.equal(result.source, 'ci'); assert.equal(result.verificationLane, 'runtime');
  assert.deepEqual(result.stages, ['semantic', 'compose', 'verify']);
  assert.deepEqual([...counts.values()], [1, 1, 1, 1]);
  assert.equal('workspaceWriteLease' in result, false);
});

test('ranges without verification do not read a verification-only getter', () => {
  const result = bindPipelineCompileRequest({ through: 'compose', get verificationLane(): never { assert.fail('unused lane'); throw new Error('unreachable'); } });
  assert.deepEqual(result.stages, ['resolve', 'semantic', 'compose']);
});

test('range rejection precedes reading later request fields', () => {
  assert.throws(() => bindPipelineCompileRequest({ from: 'emit', through: 'resolve',
    get verificationLane(): never { assert.fail('lane read before range admission'); throw new Error('unreachable'); },
    get source(): never { assert.fail('source read before range admission'); throw new Error('unreachable'); } }), code('PIPELINE-USAGE-001'));
});

test('only selected API verification requests default an absent lane and reject explicit invalid values', () => {
  assert.equal(bindPipelineCompileRequest({}).verificationLane, PIPELINE_DEFAULT_VERIFICATION_LANE);
  assert.equal(PIPELINE_COMPILE_DEFAULT_LANE, PIPELINE_DEFAULT_VERIFICATION_LANE);
  for (const value of [null, '', false, 0, 'ALL', {}, []]) {
    assert.throws(() => bindPipelineCompileRequest({ verificationLane: value as never }), code('PIPELINE-USAGE-002'));
  }
  for (const lane of ['fast', 'runtime', 'all'] as const) {
    assert.equal(bindPipelineCompileRequest({ verificationLane: lane }).verificationLane, lane);
  }
});

test('the bound request is detached from all subsequent caller mutation', () => {
  const input = { from: 'compose' as const, through: 'verify' as const, source: 'api' as const, verificationLane: 'fast' as const };
  const result = bindPipelineCompileRequest(input);
  Object.assign(input, { from: 'resolve', through: 'emit', source: 'ci', verificationLane: 'all' });
  assert.deepEqual(result, { from: 'compose', through: 'verify', stages: ['semantic', 'compose', 'verify'], source: 'api', verificationLane: 'fast' });
  assert.ok(Object.isFrozen(result));
  assert.equal(Reflect.set(result.stages, 0, 'resolve'), false);
});

test('range errors never execute user coercion hooks', () => {
  const value = { toString() { assert.fail('coercion'); }, [Symbol.toPrimitive]() { assert.fail('coercion'); } };
  assert.throws(() => selectPipelineStageRange(value, undefined), code('PIPELINE-USAGE-001'));
});
