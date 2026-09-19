import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { requirePipelineSource, sealPipelineExecutionContext } from '../../src/adapters/compilation/pipeline/execution-context.ts';
import { capturePipelineRequestedStages } from '../../src/compiler/pipeline/stages.ts';
import { capturePipelineStageExecutionOptions } from '../../src/application/pipeline-stage-lifecycle.ts';

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
  const values = ['resolve', 'compose'] as const; const captured = capturePipelineRequestedStages(values);
  assert.deepEqual(captured, values); assert.notEqual(captured, values); assert.ok(Object.isFrozen(captured));
  assert.deepEqual(capturePipelineRequestedStages([]), []);
});

for (const values of [new Array(1), ['compose', 'compose'], ['__proto__'], ['unknown']]) test('invalid stage list is rejected', () => {
  assert.throws(() => capturePipelineRequestedStages(values as never));
});

test('stage capture ignores a custom iterator and refuses accessor slots', () => {
  const values = ['resolve']; values[Symbol.iterator] = () => ['bad'].values();
  assert.deepEqual(capturePipelineRequestedStages(values as never), ['resolve']);
  Object.defineProperty(values, 0, { get() { assert.fail('slot getter'); } });
  assert.throws(() => capturePipelineRequestedStages(values as never));
});

test('the kernel option binder preserves class private state and captures the method before replacement', async () => {
  const expected = { passStatus: {} };
  class Options {
    #lock = expected;
    preserveOwnedPassStates = false;
    extractLock(result: number) { assert.equal(result, 7); return this.#lock as never; }
  }
  const input = new Options();
  const effective = capturePipelineStageExecutionOptions(input);
  input.extractLock = () => assert.fail('replaced extractor');
  input.preserveOwnedPassStates = true;
  assert.equal(await effective.extractLock!(7), expected);
  assert.equal(effective.preserveOwnedPassStates, false);
});

test('invalid execution option shapes fail before any extractor invocation', () => {
  assert.throws(() => capturePipelineStageExecutionOptions({ extractLock: 7 as never }), TypeError);
  assert.throws(() => capturePipelineStageExecutionOptions({ preserveOwnedPassStates: 'false' as never }), TypeError);
});
