import { expect, test } from 'bun:test';
import exampleInput from '../../../examples/semantic-query/input.json' with { type: 'json' };

import type { BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { buildSemanticViewSet } from '../../../src/compiler/projection/build-semantic-view-set.ts';
import { compileSemanticInput } from '../../../src/compiler/semantic-compiler.ts';
import { buildSemanticGeneratorPlan } from '../../../src/compiler/semantic-plan.ts';

function input(id = 'captured-app'): BuildEngineeringIRInput {
  return {
    app: { id, name: id },
    resolvedBlocks: [],
    manifests: [],
    acceptanceIds: ['keeps-input'],
    policyDeclarations: []
  };
}

test('compilation preserves canonical results across caller mutation and independent requests', () => {
  const firstInput = input('first');
  const before = structuredClone(firstInput);
  const first = compileSemanticInput({ engineeringIRInput: firstInput });
  expect(firstInput).toEqual(before);

  const snapshot = buildValidatedEngineeringIR(before);
  expect(first).toEqual({
    snapshot,
    generatorPlan: buildSemanticGeneratorPlan(snapshot, []),
    semanticViews: buildSemanticViewSet(snapshot)
  });
  // A pipeline-to-pipeline equality checks wiring but could accept a
  // shared omission. This externally specified input must issue one concrete
  // app identity, no generator tasks, and exactly one architecture view.
  expect(first.snapshot.ir.appId).toBe('app:first');
  expect(first.snapshot.ir.entities.filter(entity => entity.kind === 'app').map(entity => entity.id))
    .toEqual(['app:first']);
  expect(first.generatorPlan.tasks).toEqual([]);
  expect(first.semanticViews.views.map(view => view.viewKind)).toEqual(['architecture']);
  expect(first.semanticViews.views[0]!.nodes.filter(node => node.entityKind === 'app').map(node => node.entityId))
    .toEqual(['app:first']);
  expect(first).not.toBeInstanceOf(Promise);
  expect(Object.isFrozen(first)).toBe(true);

  const second = compileSemanticInput({ engineeringIRInput: input('second') });
  const repeated = compileSemanticInput({ engineeringIRInput: firstInput });
  expect(first.snapshot.ir.appId).not.toBe(second.snapshot.ir.appId);
  expect(first.snapshot.ir.inputRevision).not.toBe(second.snapshot.ir.inputRevision);
  expect(repeated).toEqual(first);

  firstInput.app.name = 'edited-after-capture';
  expect(first.snapshot.ir.entities.find((entity) => entity.kind === 'app')?.label).toBe(before.app.name);
  expect(Object.isFrozen(first.snapshot.ir)).toBe(true);
  expect(Object.isFrozen(first.generatorPlan)).toBe(true);
  expect(Object.isFrozen(first.semanticViews)).toBe(true);
});

test('invalid captured input retains the existing compiler error instead of returning partial results', () => {
  const source = input();
  source.manifests = [{
    blockId: 'missing/block',
    manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
  }];

  expect(() => compileSemanticInput({ engineeringIRInput: source }))
    .toThrow(expect.objectContaining({ code: 'IR-IDENTITY-002' }));
});

test('captured manifests supply all generators and roots alone select generation', () => {
  const source = { engineeringIRInput: structuredClone(exampleInput.engineeringIRInput) as BuildEngineeringIRInput };
  const complete = compileSemanticInput(source);
  const generatorId = 'generator:item/basic:item-status-runtime-contract';

  expect(complete.generatorPlan.tasks.map(task => task.id)).toEqual([generatorId]);
  expect(complete.generatorPlan.tasks[0]?.target).toBe('src/installed/item/item-semantic-contract.ts');
  expect(compileSemanticInput(source, [generatorId]).generatorPlan).toEqual(complete.generatorPlan);
  const empty = compileSemanticInput(source, []);
  expect(empty.generatorPlan.tasks).toEqual([]);
  expect(empty.snapshot).toEqual(complete.snapshot);
  expect(empty.semanticViews).toEqual(complete.semanticViews);

  for (const extra of [{ generatorDeclarations: [] }, { unsupported: true }]) {
    expect(() => compileSemanticInput({ ...source, ...extra })).toThrow(expect.objectContaining({ code: 'SEMANTIC-INPUT-001' }));
  }
  for (const key of ['hidden', Symbol('unsupported')]) {
    const unsupported = Object.defineProperty({ ...source }, key, { value: [] });
    expect(() => compileSemanticInput(unsupported)).toThrow(expect.objectContaining({ code: 'SEMANTIC-INPUT-001' }));
  }
  expect(() => compileSemanticInput({ ...source, engineeringIRInput: undefined! }))
    .toThrow(expect.objectContaining({ code: 'SEMANTIC-INPUT-001' }));
});
