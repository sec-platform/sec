import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { PIPELINE_STAGE_IDS, PIPELINE_VERIFY_STAGE_IDS, PIPELINE_STAGE_OWNERSHIP } from '../../src/compiler/pipeline/stages.ts';
import { getPipelineStageDefinition, PASS_DEFINITIONS, PIPELINE_STAGE_DEFINITIONS } from '../../src/compiler/pipeline/pass-registry.ts';

test('the resolving stage produces its internal prerequisites, not external blockers', () => {
  assert.deepEqual(getPipelineStageDefinition('resolve'), {
    id: 'resolve', primaryPass: 'resolve', ownedPasses: ['parse', 'align', 'resolve'], requires: [],
    invalidates: ['build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']
  });
});

for (const [stage, pass] of [['semantic', 'build-ir'], ['compose', 'compose'], ['verify', 'verify'], ['lock', 'lock'], ['emit', 'emit']] as const) {
  test(`${stage} derives its external relations from its owned pass`, () => {
    const definition = getPipelineStageDefinition(stage);
    assert.equal(definition.primaryPass, pass);
    assert.deepEqual(definition.ownedPasses, [pass]);
    assert.deepEqual(definition.requires, PASS_DEFINITIONS[pass].requires);
    assert.deepEqual(definition.invalidates, PASS_DEFINITIONS[pass].invalidates);
  });
}

test('repair invalidation is not mistaken for a prerequisite or inserted as a pipeline stage', () => {
  assert.deepEqual(PASS_DEFINITIONS.repair.requires, []);
  assert.deepEqual(PASS_DEFINITIONS.repair.invalidates, ['verify', 'lock', 'emit']);
  assert.ok(PASS_DEFINITIONS.verify.invalidates.includes('repair'));
  assert.ok(!Object.values(PIPELINE_STAGE_DEFINITIONS).some((stage) => stage.ownedPasses.includes('repair')));
});

test('stage identity, order and verification prefix are projections of ownership', () => {
  assert.deepEqual(PIPELINE_STAGE_IDS, Object.keys(PIPELINE_STAGE_OWNERSHIP));
  assert.deepEqual(PIPELINE_VERIFY_STAGE_IDS, ['resolve', 'semantic', 'compose', 'verify']);
  assert.deepEqual(PIPELINE_STAGE_IDS, ['resolve', 'semantic', 'compose', 'verify', 'lock', 'emit']);
  assert.deepEqual(Object.keys(PIPELINE_STAGE_DEFINITIONS), PIPELINE_STAGE_IDS);
});

test('registry queries cannot hand callers a writable policy or nested relation', () => {
  const definition = getPipelineStageDefinition('compose');
  assert.equal(Reflect.set(definition, 'primaryPass', 'repair'), false);
  assert.throws(() => (definition.requires as string[]).push('repair'), TypeError);
  assert.throws(() => (PASS_DEFINITIONS.compose.invalidates as string[]).pop(), TypeError);
  assert.equal(Reflect.deleteProperty(PIPELINE_STAGE_DEFINITIONS, 'verify'), false);
  assert.equal(Reflect.set(PIPELINE_STAGE_OWNERSHIP.compose, 'primaryPass', 'emit'), false);
  assert.throws(() => (PIPELINE_STAGE_IDS as string[]).reverse(), TypeError);
  assert.equal(getPipelineStageDefinition('compose'), definition);
  assert.deepEqual(definition.requires, ['build-ir']);
});

test('each pass has one identity and each staged pass one stage owner', () => {
  for (const [id, definition] of Object.entries(PASS_DEFINITIONS)) {
    assert.equal(definition.id, id);
    for (const target of [...definition.requires, ...definition.invalidates]) {
      assert.ok(Object.hasOwn(PASS_DEFINITIONS, target));
    }
  }
  const seen = new Set<string>();
  for (const definition of Object.values(PIPELINE_STAGE_DEFINITIONS)) {
    for (const pass of definition.ownedPasses) { assert.ok(!seen.has(pass)); seen.add(pass); }
    assert.ok(definition.ownedPasses.includes(definition.primaryPass));
    for (const external of [...definition.requires, ...definition.invalidates]) {
      assert.ok(!definition.ownedPasses.includes(external));
    }
  }
});

for (const stage of ['missing', 'constructor', '__proto__', 'toString']) {
  test(`unknown stage ${stage} cannot resolve to a prototype object`, () => {
    assert.throws(() => getPipelineStageDefinition(stage as never), /Unknown pipeline stage/);
  });
}
