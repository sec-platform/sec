import { expect, test } from 'bun:test';
import exampleInput from '../../examples/semantic-query/input.json' with { type: 'json' };

import type { BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { buildSemanticViewSet } from '../../src/compiler/projection/build-semantic-view-set.ts';
import { compileSemanticInput } from '../../src/compiler/semantic-compiler.ts';
import { buildSemanticGeneratorPlan } from '../../src/compiler/semantic-plan.ts';

function input(id = 'captured-app'): BuildEngineeringIRInput {
  return {
    app: { id, name: id },
    resolvedBlocks: [],
    manifests: [],
    acceptanceIds: ['keeps-input'],
    policyDeclarations: []
  };
}

test('captured compilation preserves the existing validation, plan and view results', () => {
  const source = input();
  const snapshot = buildValidatedEngineeringIR(source);
  const result = compileSemanticInput({ engineeringIRInput: source });

  expect(result).toEqual({
    snapshot,
    generatorPlan: buildSemanticGeneratorPlan(snapshot, []),
    semanticViews: buildSemanticViewSet(snapshot)
  });
  expect(result).not.toBeInstanceOf(Promise);
  expect(Object.isFrozen(result)).toBe(true);
});

test('compilation neither mutates its input nor shares a mutable result with the caller', () => {
  const source = input();
  const before = structuredClone(source);
  const first = compileSemanticInput({ engineeringIRInput: source });
  expect(source).toEqual(before);

  source.app.name = 'edited-after-capture';
  expect(first.snapshot.ir.entities.find((entity) => entity.kind === 'app')?.label).toBe(before.app.name);
  expect(Object.isFrozen(first.snapshot.ir)).toBe(true);
  expect(Object.isFrozen(first.generatorPlan)).toBe(true);
  expect(Object.isFrozen(first.semanticViews)).toBe(true);
});

test('independent requests do not replace or contaminate an earlier result', () => {
  const firstInput = input('first');
  const first = compileSemanticInput({ engineeringIRInput: firstInput });
  const second = compileSemanticInput({ engineeringIRInput: input('second') });
  const repeated = compileSemanticInput({ engineeringIRInput: firstInput });

  expect(first.snapshot.ir.appId).not.toBe(second.snapshot.ir.appId);
  expect(first.snapshot.ir.inputRevision).not.toBe(second.snapshot.ir.inputRevision);
  expect(repeated).toEqual(first);
  expect(repeated).not.toBe(first);
});

test('invalid captured input retains the existing compiler error instead of returning partial results', () => {
  const source = input();
  source.manifests = [{
    blockId: 'missing/block',
    manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
  }];

  expect(() => compileSemanticInput({ engineeringIRInput: source }))
    .toThrow('Manifest input references unresolved block "missing/block"');
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
    expect(() => compileSemanticInput({ ...source, ...extra })).toThrow('only its own engineeringIRInput field');
  }
  for (const key of ['hidden', Symbol('unsupported')]) {
    const unsupported = Object.defineProperty({ ...source }, key, { value: [] });
    expect(() => compileSemanticInput(unsupported)).toThrow('only its own engineeringIRInput field');
  }
  expect(() => compileSemanticInput({ ...source, engineeringIRInput: undefined! }))
    .toThrow('only its own engineeringIRInput field');
});
