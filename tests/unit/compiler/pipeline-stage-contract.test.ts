import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PASS_SEQUENCE, PASS_STATUS_PENDING } from '../../../src/adapters/compilation/pipeline/defaults.ts';
import { LOCK_PASS_STATES, PASS_INITIAL_STATES } from '../../../src/compiler/contract/pass-status.ts';
import { PIPELINE_EXECUTION_BOUNDARIES, pipelineStageBoundary } from '../../../src/compiler/pipeline/execution-boundaries.ts';
import { getPipelineStageDefinition, PIPELINE_STAGE_DEFINITIONS } from '../../../src/compiler/pipeline/stage-definitions.ts';
import { PIPELINE_STAGE_IDS, PIPELINE_VERIFY_STAGE_IDS } from '../../../src/compiler/pipeline/stages.ts';

test('the built-in pipeline publishes the exact stage, pass and event policy consumed by execution', () => {
  const stages = ['resolve', 'semantic', 'compose', 'verify', 'lock', 'emit'] as const;
  assert.deepEqual(PIPELINE_STAGE_IDS, stages);
  assert.deepEqual(PIPELINE_VERIFY_STAGE_IDS, ['resolve', 'semantic', 'compose', 'verify']);
  assert.deepEqual(PIPELINE_STAGE_DEFINITIONS, {
    resolve: { id: 'resolve', primaryPass: 'resolve', ownedPasses: ['parse', 'align', 'resolve'], requires: [],
      invalidates: ['build-ir', 'compose', 'verify', 'repair', 'lock', 'emit'] },
    semantic: { id: 'semantic', primaryPass: 'build-ir', ownedPasses: ['build-ir'], requires: ['resolve'],
      invalidates: ['compose', 'verify', 'repair', 'lock', 'emit'] },
    compose: { id: 'compose', primaryPass: 'compose', ownedPasses: ['compose'], requires: ['build-ir'],
      invalidates: ['verify', 'repair', 'lock', 'emit'] },
    verify: { id: 'verify', primaryPass: 'verify', ownedPasses: ['verify'], requires: ['compose'],
      invalidates: ['repair', 'lock', 'emit'] },
    lock: { id: 'lock', primaryPass: 'lock', ownedPasses: ['lock'], requires: ['verify'], invalidates: ['emit'] },
    emit: { id: 'emit', primaryPass: 'emit', ownedPasses: ['emit'], requires: ['lock'], invalidates: [] }
  });
  assert.deepEqual(PASS_SEQUENCE, ['parse', 'align', 'resolve', 'build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']);
  const pending = { parse: 'pending', align: 'pending', resolve: 'pending', 'build-ir': 'pending',
    compose: 'pending', verify: 'pending', repair: 'skipped', lock: 'pending', emit: 'pending' };
  assert.deepEqual(PASS_INITIAL_STATES, pending);
  assert.deepEqual(PASS_STATUS_PENDING, pending);
  assert.deepEqual(LOCK_PASS_STATES, ['pending', 'running', 'succeeded', 'failed', 'blocked', 'skipped']);
  assert.deepEqual(stages.map(pipelineStageBoundary), [
    'pipeline-resolve', 'pipeline-semantic', 'pipeline-compose', 'pipeline-verify', 'pipeline-lock', 'pipeline-emit'
  ]);
  assert.deepEqual(PIPELINE_EXECUTION_BOUNDARIES, ['pipeline-bootstrap', 'pipeline-lease-bind', 'pipeline-lease-bound',
    'pipeline-transaction-bootstrap', 'pipeline-transaction', 'pipeline-resolve', 'pipeline-semantic',
    'pipeline-compose', 'pipeline-verify', 'pipeline-lock', 'pipeline-emit', 'verify-preflight',
    'verify-fast', 'verify-runtime', 'verify-artifact-publish']);

  // These shared outputs feed later execution and persisted-data validation.
  const definition = getPipelineStageDefinition('compose');
  assert.equal(Reflect.set(definition, 'primaryPass', 'repair'), false);
  assert.throws(() => (definition.requires as string[]).push('repair'), TypeError);
  assert.equal(Reflect.deleteProperty(PIPELINE_STAGE_DEFINITIONS, 'verify'), false);
  assert.throws(() => (PIPELINE_STAGE_IDS as string[]).reverse(), TypeError);
  assert.equal(Reflect.set(LOCK_PASS_STATES, 0, 'forged'), false);
  assert.equal(Reflect.set(PASS_SEQUENCE, 0, 'forged'), false);
  assert.deepEqual(getPipelineStageDefinition('compose').requires, ['build-ir']);
});
