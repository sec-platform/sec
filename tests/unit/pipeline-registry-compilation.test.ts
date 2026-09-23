import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PASS_SEQUENCE, PASS_STATUS_PENDING } from '../../src/adapters/compilation/pipeline/defaults.ts';
import { LOCK_PASS_STATES, PASS_INITIAL_STATES, type PassStatus } from '../../src/compiler/contract/pass-status.ts';
import { PASS_DEFINITIONS, PIPELINE_STAGE_DEFINITIONS, compilePipelineStageDefinitions } from '../../src/compiler/pipeline/stage-definitions.ts';
import { PIPELINE_STAGE_OWNERSHIP } from '../../src/compiler/pipeline/stages.ts';

const inputs = () => ({ passes: structuredClone(PASS_DEFINITIONS), ownership: structuredClone(PIPELINE_STAGE_OWNERSHIP) });

test('pass initialization, sequence and identity have a single immutable source', () => {
  assert.equal(PASS_STATUS_PENDING, PASS_INITIAL_STATES);
  assert.deepEqual(PASS_SEQUENCE, Object.keys(PASS_INITIAL_STATES));
  assert.deepEqual(PASS_SEQUENCE, ['parse', 'align', 'resolve', 'build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']);
  for (const pass of PASS_SEQUENCE) assert.equal(PASS_STATUS_PENDING[pass], pass === 'repair' ? 'skipped' : 'pending');
  assert.equal(Reflect.set(LOCK_PASS_STATES, 0, 'forged'), false);
  assert.equal(Reflect.set(PASS_SEQUENCE, 0, 'forged'), false);
});

test('retained locks may omit build-ir but all other existing passes stay required', () => {
  const { 'build-ir': _, ...oldStatus } = PASS_STATUS_PENDING;
  const compatible: PassStatus = oldStatus;
  assert.equal(compatible['build-ir'], undefined);
  assert.equal(compatible.repair, 'skipped');
});

test('registry compiler produces the exact current relation table without mutating inputs', () => {
  const { passes, ownership } = inputs(); const before = structuredClone({ passes, ownership });
  assert.deepEqual(compilePipelineStageDefinitions(passes, ownership), PIPELINE_STAGE_DEFINITIONS);
  assert.deepEqual({ passes, ownership }, before);
  const compiled = compilePipelineStageDefinitions(passes, ownership);
  (passes.compose.requires as string[])[0] = 'emit';
  assert.deepEqual(compiled.compose.requires, ['build-ir']);
  assert.ok(Object.isFrozen(compiled.compose.requires));
});

for (const relation of ['requires', 'invalidates'] as const) {
  for (const problem of ['unknown', 'duplicate', 'hole'] as const) {
    test(`registry compiler rejects ${problem} ${relation} edges`, () => {
      const { passes, ownership } = inputs();
      Object.assign(passes.compose, { [relation]: problem === 'hole' ? new Array(1) : problem === 'duplicate' ? ['verify', 'verify'] : ['unknown'] });
      assert.throws(() => compilePipelineStageDefinitions(passes, ownership), /relation|endpoint/);
    });
  }
}

test('registry compiler rejects pass identity drift and duplicate ownership', () => {
  let { passes, ownership } = inputs(); Object.assign(passes.compose, { id: 'emit' });
  assert.throws(() => compilePipelineStageDefinitions(passes, ownership), /identity mismatch/);
  ({ passes, ownership } = inputs()); Object.assign(ownership.emit, { primaryPass: 'compose' });
  assert.throws(() => compilePipelineStageDefinitions(passes, ownership), /duplicate stage ownership/);
});

test('internal invalidation cannot leave a producer marked completed for a later consumer', () => {
  const { passes, ownership } = inputs();
  Object.assign(passes.align, { invalidates: [...passes.align.invalidates, 'parse'] });
  Object.assign(passes.resolve, { requires: ['parse', 'align'] });
  assert.throws(() => compilePipelineStageDefinitions(passes, ownership), /before its producer/);
});

test('a composite stage cannot claim success while its last pass invalidated an earlier owned result', () => {
  const { passes, ownership } = inputs();
  Object.assign(passes.resolve, { invalidates: [...passes.resolve.invalidates, 'parse'] });
  assert.throws(() => compilePipelineStageDefinitions(passes, ownership), /leaves an owned pass invalidated/);
});

test('repair invalidation cycles do not become fabricated prerequisite cycles', () => {
  assert.ok(PASS_DEFINITIONS.verify.invalidates.includes('repair'));
  assert.ok(PASS_DEFINITIONS.repair.invalidates.includes('verify'));
  assert.deepEqual(compilePipelineStageDefinitions(PASS_DEFINITIONS, PIPELINE_STAGE_OWNERSHIP), PIPELINE_STAGE_DEFINITIONS);
});


test('a compiled Record cannot silently omit declared stages or invent pass identities', () => {
  const { emit: _stage, ...partialStages } = PIPELINE_STAGE_OWNERSHIP;
  assert.throws(() => compilePipelineStageDefinitions(PASS_DEFINITIONS, partialStages as never), /identity set/);
  const { emit: _pass, ...partialPasses } = PASS_DEFINITIONS;
  assert.throws(() => compilePipelineStageDefinitions(partialPasses as never, PIPELINE_STAGE_OWNERSHIP), /identity set/);
  const extra = { ...PASS_DEFINITIONS, extra: {id: 'extra',requires:[],invalidates:[]} };
  assert.throws(() => compilePipelineStageDefinitions(extra as never, PIPELINE_STAGE_OWNERSHIP), /identity set/);
});
