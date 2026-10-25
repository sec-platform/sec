import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { sealPipelineExecutionContext } from '../../../src/adapters/compilation/pipeline/execution-context.ts';
import { requirePipelineSource } from '../../../src/compiler/pipeline/source.ts';
import { capturePipelineRequestedStages } from '../../../src/compiler/pipeline/stages.ts';

const context = () => ({ transactionId: 'tx:one', source: 'api' as const, workspaceWriteLease: {} as never });

test('external identity is sealed on the original object without freezing semantic state', () => {
  const c = context(); assert.equal(sealPipelineExecutionContext(c), c);
  for (const key of ['transactionId', 'source', 'workspaceWriteLease', 'onEvent']) {
    assert.equal(Reflect.set(c, key, 'changed'), false);
    assert.equal(Reflect.deleteProperty(c, key), false);
  }
  assert.equal(Reflect.set(c, 'semantic', { revision: 1 }), true);
  assert.equal(sealPipelineExecutionContext(c), c);
});

test('already frozen contexts without observers remain usable', () => {
  const c = Object.freeze(context()); assert.equal(sealPipelineExecutionContext(c), c);
});

test('an accessor is rejected without executing user code', () => {
  const c = context(); Object.defineProperty(c, 'source', { get() { assert.fail('getter'); } });
  assert.throws(() => sealPipelineExecutionContext(c), /must be data/);
  assert.equal(Reflect.set(c, 'transactionId', 'still mutable'), true);
});

for (const source of [null, false, '', 'other', '__proto__']) test(`invalid source ${String(source)} is refused`, () => {
  assert.throws(() => requirePipelineSource(source));
});

test('requested stages preserve valid ordering and detach the caller array', () => {
  const values: Array<'resolve' | 'compose'> = ['resolve', 'compose'];
  Object.defineProperty(values, Symbol.iterator, { value: () => ['bad'].values() });
  const captured = capturePipelineRequestedStages(values);
  values.reverse();
  assert.deepEqual(captured, ['resolve', 'compose']);
  assert.ok(Object.isFrozen(captured));
  assert.deepEqual(capturePipelineRequestedStages([]), []);
  Object.defineProperty(values, 0, { get() { assert.fail('slot getter'); } });
  assert.throws(() => capturePipelineRequestedStages(values), { code: 'PIPELINE-USAGE-001' });
});

for (const values of [new Array(1), ['compose', 'compose'], ['__proto__'], ['unknown']]) test('invalid stage list is rejected', () => {
  assert.throws(() => capturePipelineRequestedStages(values as never));
});
