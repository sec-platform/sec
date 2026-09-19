import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PASS_INITIAL_STATES } from '../../src/compiler/contract/pass-status.ts';
import { PIPELINE_EXECUTION_BOUNDARIES, pipelineStageBoundary } from '../../src/compiler/pipeline/execution-boundaries.ts';
import { PIPELINE_STAGE_DEFINITIONS, getPipelineStageDefinition } from '../../src/compiler/pipeline/stage-definitions.ts';
import { pipelineStageBlockers, pipelineStageStatePatch } from '../../src/adapters/compilation/pipeline/stage-state.ts';
import { PIPELINE_STAGE_IDS } from '../../src/compiler/pipeline/stages.ts';
import { PIPELINE_EXECUTION_BOUNDARIES as publicBoundaries } from '../../src/adapters/compilation-protocol/types.ts';

for (const definition of Object.values(PIPELINE_STAGE_DEFINITIONS)) {
  test(`${definition.id} transition patches preserve current start, block, success and failure behavior`, () => {
    const started = pipelineStageStatePatch(definition, { kind: 'started' });
    for (const pass of definition.ownedPasses) assert.equal(started[pass], 'running');
    for (const pass of definition.invalidates) assert.equal(started[pass], PASS_INITIAL_STATES[pass]);
    const blocked = pipelineStageStatePatch(definition, { kind: 'blocked' });
    for (const pass of [...definition.ownedPasses, ...definition.invalidates]) assert.equal(blocked[pass], 'blocked');
    const success = pipelineStageStatePatch(definition, { kind: 'succeeded' });
    assert.deepEqual(Object.keys(success), definition.ownedPasses);
    for (const pass of definition.ownedPasses) assert.equal(success[pass], 'succeeded');
    for (const originPass of [...definition.ownedPasses, 'repair'] as const) {
      const failed = pipelineStageStatePatch(definition, { kind: 'failed', originPass });
      const index = definition.ownedPasses.indexOf(definition.ownedPasses.includes(originPass) ? originPass : definition.primaryPass);
      definition.ownedPasses.forEach((pass, i) => assert.equal(failed[pass], i < index ? 'succeeded' : i === index ? 'failed' : 'blocked'));
      for (const pass of definition.invalidates) assert.equal(failed[pass], 'blocked');
      assert.ok(Object.isFrozen(failed));
    }
  });
}

test('preparation failure cannot fabricate successful internal passes that never executed', () => {
  const patch = pipelineStageStatePatch(getPipelineStageDefinition('resolve'), { kind: 'preparation-failed' });
  assert.equal(patch.parse, 'blocked'); assert.equal(patch.align, 'blocked'); assert.equal(patch.resolve, 'failed');
  assert.ok(!Object.values(patch).includes('succeeded'));
});

test('a state projection does not mutate current lock state or registry relations', () => {
  const current = { ...PASS_INITIAL_STATES }, before = structuredClone(current);
  const patch = pipelineStageStatePatch(getPipelineStageDefinition('compose'), { kind: 'started' });
  assert.deepEqual(current, before); assert.equal(Reflect.set(patch, 'compose', 'succeeded'), false);
  assert.equal(patch.repair, 'skipped');
});

test('blocker collection reads the actual state once and preserves absent legacy state', () => {
  let reads = 0;
  const status = { ...PASS_INITIAL_STATES, get compose() { reads++; return reads === 1 ? 'failed' as const : 'succeeded' as const; } };
  assert.deepEqual(pipelineStageBlockers(status, ['compose']), [{ passId: 'compose', state: 'failed' }]);
  assert.equal(reads, 1);
  const { 'build-ir': _omitted, ...legacy } = PASS_INITIAL_STATES;
  assert.deepEqual(pipelineStageBlockers(legacy, ['build-ir']), [{ passId: 'build-ir', state: undefined }]);
});

test('the public boundary list and stage dispatch consume one identity projection', () => {
  assert.equal(publicBoundaries, PIPELINE_EXECUTION_BOUNDARIES);
  assert.ok(Object.isFrozen(publicBoundaries));
  for (const stage of PIPELINE_STAGE_IDS) assert.equal(publicBoundaries.filter(value => value === pipelineStageBoundary(stage)).length, 1);
  assert.deepEqual(publicBoundaries, ['pipeline-bootstrap', 'pipeline-lease-bind', 'pipeline-lease-bound',
    'pipeline-transaction-bootstrap', 'pipeline-transaction', 'pipeline-resolve', 'pipeline-semantic',
    'pipeline-compose', 'pipeline-verify', 'pipeline-lock', 'pipeline-emit', 'verify-preflight',
    'verify-fast', 'verify-runtime', 'verify-artifact-publish']);
});

for (const stage of ['adapt', 'constructor', '', false]) {
  test(`invalid stage boundary ${String(stage)} cannot produce an event identity`, () => {
    assert.throws(() => pipelineStageBoundary(stage as never), /Unknown pipeline stage/);
  });
}


test('unknown transition cannot silently become a blocked-state patch', () => {
  assert.throws(() => pipelineStageStatePatch(getPipelineStageDefinition('compose'), { kind: 'unexpected' } as never), TypeError);
});
