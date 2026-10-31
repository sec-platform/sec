import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { sealPipelineExecutionContext } from '../../../src/adapters/compilation/pipeline/execution-context.ts';
import { bindPipelineSemanticContext, requirePipelineSemanticContext } from '../../../src/adapters/compilation/pipeline/semantic-context.ts';

test('sealed transaction identity retains one semantic binding', () => {
  const ir = Object.freeze({ inputRevision: 'input', semanticRevision: 'semantic' });
  const snapshot = Object.freeze({ ir });
  const plan = Object.freeze({ ...ir }), views = Object.freeze({ ...ir });
  const c = { transactionId: 'tx:test', source: 'api' as const, workspaceWriteLease: {} as never };
  assert.equal(sealPipelineExecutionContext(c), c);
  for (const key of ['transactionId', 'source', 'workspaceWriteLease', 'onEvent']) {
    assert.equal(Reflect.set(c, key, 'changed'), false);
    assert.equal(Reflect.deleteProperty(c, key), false);
  }
  const link = bindPipelineSemanticContext(c, snapshot as never, plan as never, views as never);
  assert.equal(requirePipelineSemanticContext(c), link);
  assert.deepEqual(link, {
    transactionId: 'tx:test', inputRevision: 'input', semanticRevision: 'semantic',
    snapshot, generatorPlan: plan, semanticViews: views
  });
  assert.ok(Object.isFrozen(link));
  assert.equal(sealPipelineExecutionContext(c), c);
  assert.equal(Reflect.set(c, 'semantic', { ...link }), false);
  assert.equal(Reflect.deleteProperty(c, 'semantic'), false);
  assert.throws(() => bindPipelineSemanticContext(c, snapshot as never, plan as never, views as never), {
    code: 'PIPELINE-SEMANTIC-001'
  });
});
