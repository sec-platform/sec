import { expect, test } from 'bun:test';
import exampleInput from '../../../examples/semantic-query/input.json' with { type: 'json' };

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
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

test('invalid captured input retains the existing compiler error instead of returning partial results', () => {
  const source = input();
  source.manifests = [{
    blockId: 'missing/block',
    manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
  }];

  expect(() => compileSemanticInput({ engineeringIRInput: source }))
    .toThrow(expect.objectContaining({ code: 'IR-IDENTITY-002' }));
});

test('captured requests isolate canonical outputs while manifests and roots select generation', () => {
  const source = { engineeringIRInput: structuredClone(exampleInput.engineeringIRInput) as BuildEngineeringIRInput };
  source.engineeringIRInput.manifests[0]!.manifest.generators![0]!.target =
    'src\\installed/item/item-semantic-contract.ts';
  const before = structuredClone(source);
  const complete = compileSemanticInput(source);
  expect(source).toEqual(before);
  expect(complete).not.toBeInstanceOf(Promise);
  for (const value of [complete, complete.snapshot.ir, complete.generatorPlan, complete.semanticViews]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  expect(complete.snapshot.ir.appId).toBe('app:item-app');
  expect(complete.semanticViews.views.find(view => view.viewKind === 'architecture')!.nodes
    .filter(node => node.entityKind === 'app').map(node => node.entityId)).toEqual(['app:item-app']);

  source.engineeringIRInput.app.name = 'edited-after-capture';
  expect(complete.snapshot.ir.entities.find(entity => entity.kind === 'app')?.label).toBe('item-app');
  source.engineeringIRInput.app.name = before.engineeringIRInput.app.name;
  const independent = compileSemanticInput({ engineeringIRInput: input('independent') });
  expect(independent.snapshot.ir.appId).toBe('app:independent');
  expect(independent.snapshot.ir.entities.filter(entity => entity.kind === 'app').map(entity => entity.id))
    .toEqual(['app:independent']);
  expect(independent.snapshot.ir.inputRevision).not.toBe(complete.snapshot.ir.inputRevision);
  expect(independent.generatorPlan.tasks).toEqual([]);
  expect(independent.semanticViews.views.map(view => view.viewKind)).toEqual(['architecture']);
  expect(independent.semanticViews.views[0]!.nodes.filter(node => node.entityKind === 'app')
    .map(node => node.entityId)).toEqual(['app:independent']);
  const { snapshot, generatorPlan: plan } = complete;
  const generatorId = 'generator:item/basic:item-status-runtime-contract';
  const artifactId = 'artifact:src/installed/item/item-semantic-contract.ts';

  expect(plan.tasks.map(task => task.id)).toEqual([generatorId]);
  expect(snapshot.ir.entities.find((entity) => entity.id === generatorId)?.kind).toBe('generator');
  expect(snapshot.ir.entities.find((entity) => entity.id === artifactId)?.kind).toBe('artifact');
  expect(snapshot.ir.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ subject: generatorId, predicate: 'CONSUMES', object: { kind: 'entity', entityId: 'state:item:item-status' } }),
    expect.objectContaining({ subject: 'state:item:item-status', predicate: 'LOWERS_TO', object: { kind: 'entity', entityId: artifactId } }),
    expect.objectContaining({ subject: generatorId, predicate: 'GENERATES', object: { kind: 'entity', entityId: artifactId } }),
    expect.objectContaining({ subject: artifactId, predicate: 'VERIFIED_BY', object: { kind: 'entity', entityId: 'acceptance:item_can_transition' } }),
    expect.objectContaining({ subject: artifactId, predicate: 'VERIFIED_BY', object: { kind: 'value', value: { selector: 'typecheck' } } })
  ]));
  expect(plan).toMatchObject({
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    tasks: [{
      id: generatorId,
      generatorEntityId: generatorId,
      artifactEntityId: artifactId,
      target: 'src/installed/item/item-semantic-contract.ts',
      stateValues: ['closed', 'open'],
      verifiedByEntityIds: ['acceptance:item_can_transition']
    }]
  });
  expect(plan.tasks[0]?.transitions).toEqual([
    { from: 'closed', to: 'open', by: 'transitionItemStatus', operationEntityId: 'operation:item:transitionItemStatus' },
    { from: 'open', to: 'closed', by: 'transitionItemStatus', operationEntityId: 'operation:item:transitionItemStatus' }
  ]);

  if (false) {
    const raw = buildEngineeringIR(source.engineeringIRInput);
    // @ts-expect-error Generator plans require the branded validated snapshot boundary.
    buildSemanticGeneratorPlan(raw, []);
  }
  expect(compileSemanticInput(source, [generatorId])).toEqual(complete);
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
