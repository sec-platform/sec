import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bindPipelineSemanticContext, createPipelineSemanticContext, requirePipelineSemanticContext } from '../../src/adapters/compilation/pipeline/semantic-context.ts';

function input() {
  const ir = { inputRevision: 'input', semanticRevision: 'semantic' };
  const snapshot = { ir };
  const plan = { ...ir }, views = { ...ir };
  return { ir, snapshot, plan, views };
}
function create(i = input()) {
  return createPipelineSemanticContext('tx:test', i.snapshot as never, i.plan as never, i.views as never);
}
function context(semantic?: ReturnType<typeof create>) {
  return { transactionId: 'tx:test', source: 'api' as const, workspaceWriteLease: {} as never, ...(semantic ? { semantic } : {}) };
}
const code = (expected: string) => (error: unknown) => (error as { code: string }).code === expected;

test('creation and consumption keep the exact domain identities without cloning or freezing them', () => {
  const i = input(), link = create(i), c = context(link);
  assert.equal(requirePipelineSemanticContext(c), link);
  assert.equal(link.snapshot, i.snapshot); assert.equal(link.generatorPlan, i.plan); assert.equal(link.semanticViews, i.views);
  assert.ok(Object.isFrozen(link)); assert.equal(Object.isFrozen(i.ir), false);
});

for (const owner of ['ir', 'plan', 'views'] as const) for (const field of ['inputRevision', 'semanticRevision'] as const) {
  test(`a changed ${owner}.${field} invalidates a previously created link`, () => {
    const i = input(), link = create(i); i[owner][field] = 'changed';
    assert.throws(() => requirePipelineSemanticContext(context(link)), code('PIPELINE-SEMANTIC-003'));
  });
}

test('replacing the IR with matching revision strings still changes the captured IR identity', () => {
  const i = input(), link = create(i); i.snapshot.ir = { ...i.ir };
  assert.throws(() => requirePipelineSemanticContext(context(link)), code('PIPELINE-SEMANTIC-003'));
});

test('moving all derivative revision strings together does not retarget the original link', () => {
  const i = input(), link = create(i);
  for (const item of [i.ir, i.plan, i.views]) item.inputRevision = 'next';
  assert.throws(() => requirePipelineSemanticContext(context(link)), code('PIPELINE-SEMANTIC-003'));
});

for (const value of [undefined, null, '', 0, false]) {
  test(`matching invalid revision ${String(value)} is not accepted as semantic identity`, () => {
    const i = input(); for (const item of [i.ir, i.plan, i.views]) Object.assign(item, { inputRevision: value });
    assert.throws(() => create(i), code('PIPELINE-SEMANTIC-003'));
  });
}

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

test('a derivative getter cannot execute a context rebind during readback', () => {
  const i = input(), link = create(i), c = context(link); let calls = 0;
  Object.defineProperty(i.plan, 'inputRevision', { get() { calls++; c.semantic = create(); return 'input'; } });
  assert.throws(() => requirePipelineSemanticContext(c), code('PIPELINE-SEMANTIC-003'));
  assert.equal(calls, 0); assert.equal(c.semantic, link);
});

test('a reentrant derivative getter is rejected before it can install a nested link', () => {
  const i = input(), c = context(), inner = create(); let calls = 0;
  Object.defineProperty(i.plan, 'inputRevision', { get() { calls++; Object.assign(c, { semantic: inner }); return 'input'; } });
  assert.throws(() => bindPipelineSemanticContext(c, i.snapshot as never, i.plan as never, i.views as never), code('PIPELINE-SEMANTIC-003'));
  assert.equal(calls, 0); assert.equal(c.semantic, undefined);
});

for (const [owner, field] of [['snapshot', 'ir'], ['ir', 'inputRevision'], ['ir', 'semanticRevision'],
  ['plan', 'inputRevision'], ['plan', 'semanticRevision'], ['views', 'inputRevision'], ['views', 'semanticRevision']] as const) {
  test(`${owner}.${field} accessors are never invoked to construct semantic identity`, () => {
    const i = input(); let calls = 0;
    Object.defineProperty(i[owner], field, { get() { calls++; return 'forged'; } });
    assert.throws(() => create(i), code('PIPELINE-SEMANTIC-003'));
    assert.equal(calls, 0);
  });
}
