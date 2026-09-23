import { expect, test } from 'bun:test';

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
  const result = compileSemanticInput({ engineeringIRInput: source, generatorDeclarations: [] });

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
  const first = compileSemanticInput({ engineeringIRInput: source, generatorDeclarations: [] });
  expect(source).toEqual(before);

  source.app.name = 'edited-after-capture';
  expect(first.snapshot.ir.entities.find((entity) => entity.kind === 'app')?.label).toBe(before.app.name);
  expect(Object.isFrozen(first.snapshot.ir)).toBe(true);
  expect(Object.isFrozen(first.generatorPlan)).toBe(true);
  expect(Object.isFrozen(first.semanticViews)).toBe(true);
});

test('independent requests do not replace or contaminate an earlier result', () => {
  const firstInput = input('first');
  const first = compileSemanticInput({ engineeringIRInput: firstInput, generatorDeclarations: [] });
  const second = compileSemanticInput({ engineeringIRInput: input('second'), generatorDeclarations: [] });
  const repeated = compileSemanticInput({ engineeringIRInput: firstInput, generatorDeclarations: [] });

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

  expect(() => compileSemanticInput({ engineeringIRInput: source, generatorDeclarations: [] }))
    .toThrow('Manifest input references unresolved block "missing/block"');
});
