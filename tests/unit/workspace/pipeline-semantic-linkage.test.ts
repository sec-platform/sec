import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bindPipelineSemanticContext, requirePipelineSemanticContext } from '../../../src/adapters/compilation/pipeline/semantic-context.ts';
import { createPipelineSemanticContext } from '../../../src/compiler/pipeline/semantic-context.ts';

function input() {
  const ir = Object.freeze({ inputRevision: 'input', semanticRevision: 'semantic' });
  const snapshot = Object.freeze({ ir });
  const plan = Object.freeze({ ...ir }), views = Object.freeze({ ...ir });
  return { ir, snapshot, plan, views };
}
function create(i = input()) {
  return createPipelineSemanticContext('tx:test', i.snapshot as never, i.plan as never, i.views as never);
}
function context(semantic?: ReturnType<typeof create>) {
  return { transactionId: 'tx:test', source: 'api' as const, workspaceWriteLease: {} as never, ...(semantic ? { semantic } : {}) };
}
const code = (expected: string) => (error: unknown) => (error as { code: string }).code === expected;

test('creation and consumption retain the exact issued domain identities', () => {
  const i = input(), link = create(i), c = context(link);
  assert.equal(requirePipelineSemanticContext(c), link);
  assert.equal(link.snapshot, i.snapshot); assert.equal(link.generatorPlan, i.plan); assert.equal(link.semanticViews, i.views);
  assert.ok(Object.isFrozen(link));
});

test('binding is single assignment while unrelated transaction state remains mutable', () => {
  const i = input(), c = context();
  const link = bindPipelineSemanticContext(c, i.snapshot as never, i.plan as never, i.views as never);
  assert.equal(requirePipelineSemanticContext(c), link);
  assert.equal(Reflect.set(c, 'semantic', create()), false);
  assert.equal(Reflect.deleteProperty(c, 'semantic'), false);
  assert.equal(Reflect.set(c, 'unrelated', 7), true);
  assert.throws(() => bindPipelineSemanticContext(c, i.snapshot as never, i.plan as never, i.views as never), code('PIPELINE-SEMANTIC-001'));
});

test('a shape clone is not a linkage created by the semantic context owner', () => {
  const link = create();
  assert.throws(() => requirePipelineSemanticContext(context({ ...link })), code('PIPELINE-SEMANTIC-002'));
});

test('wrong transaction and accessor-provided context links are refused', () => {
  const link = create(), c = context(link); c.transactionId = 'other';
  assert.throws(() => requirePipelineSemanticContext(c), code('PIPELINE-SEMANTIC-002'));
  const accessor = context();
  Object.defineProperty(accessor, 'semantic', { get() { assert.fail('untrusted context getter'); } });
  assert.throws(() => requirePipelineSemanticContext(accessor), code('PIPELINE-SEMANTIC-002'));
});
