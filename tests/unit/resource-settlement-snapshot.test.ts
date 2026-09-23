import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ResourceCompositeSettlementError as PhysicalResourceCompositeSettlementError, settleResources as settlePhysicalResources, settleResourcesAsync as settlePhysicalResourcesAsync } from '../../src/execution/resource-settlement.ts';

for (const asynchronous of [false, true]) {
  const execute = asynchronous ? settlePhysicalResourcesAsync : settlePhysicalResources;
  test(`${asynchronous ? 'async' : 'sync'} cleanup cannot remove, append, replace or rename later actions`, async () => {
    const events: string[] = [], failure = new Error('second');
    const second = { label: 'second', settle() { events.push('second'); throw failure; } };
    const cleanup = [{ label: 'first', settle() {
      cleanup.length = 0; cleanup.push({ label: 'extra', settle() { assert.fail('not admitted'); } });
      second.label = 'renamed'; second.settle = () => assert.fail('replaced'); events.push('first');
    } }, second];
    await assert.rejects(async () => execute({ cleanup }), error => {
      assert.ok(error instanceof PhysicalResourceCompositeSettlementError);
      assert.deepEqual(error.failures, [{ label: 'second', error: failure }]); return true;
    });
    assert.deepEqual(events, ['first', 'second']);
  });

  test(`${asynchronous ? 'async' : 'sync'} primary error is captured even when its source is later mutated`, async () => {
    const primary = { label: 'run', error: null as unknown };
    await assert.rejects(async () => execute({ primary, cleanup: [{ label: 'cleanup', settle() {
      primary.label = 'other'; primary.error = new Error('replacement');
    } }] }), error => error === null);
  });

  test(`${asynchronous ? 'async' : 'sync'} class-private cleanup state keeps the real provider receiver`, async () => {
    class Resource { #closed = false; label = 'class'; settle() { this.#closed = true; } get closed() { return this.#closed; } }
    const resource = new Resource(); await execute({ cleanup: [resource] }); assert.equal(resource.closed, true);
  });
}

test('async capture happens before suspension, while actual cleanup order stays sequential', async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(r => { release = r; }), begun = new Promise<void>(r => { entered = r; });
  const events: string[] = [];
  const second = { label: 'second', settle() { events.push('second'); } };
  const pending = settlePhysicalResourcesAsync({ cleanup: [{ label: 'first', async settle() { entered(); await held; events.push('first'); } }, second] });
  try {
    await begun; second.settle = () => assert.fail('late replacement'); second.label = 'changed';
    assert.deepEqual(events, []);
  } finally { release(); }
  const terminal = await pending;
  assert.deepEqual(events, ['first', 'second']); assert.deepEqual(terminal.attemptedLabels, ['first', 'second']);
});

test('composite failure fields and AggregateError values describe one captured sequence', () => {
  const primary = new Error('primary'), secondary = new Error('secondary');
  const source = [{ label: 'primary', error: primary }, { label: 'secondary', error: secondary }];
  const failure = new PhysicalResourceCompositeSettlementError(source);
  source.reverse(); source[0]!.label = 'changed'; source[0]!.error = new Error('replacement');
  assert.deepEqual(failure.errors, [primary, secondary]);
  assert.deepEqual(failure.failures, [{ label: 'primary', error: primary }, { label: 'secondary', error: secondary }]);
  assert.ok(Object.isFrozen(failure.failures[0])); assert.equal(Object.isFrozen(primary), false);
});

test('an unreadable selected cleanup does not erase the primary or abandon known peers', async () => {
  const primary = new Error('run'), access = new Error('get method'), events: string[] = [];
  await assert.rejects(settlePhysicalResourcesAsync({ primary: { label: 'run', error: primary }, cleanup: [
    { label: 'broken', get settle(): () => void { throw access; } },
    { label: 'valid', settle() { events.push('closed'); } }
  ] }), error => {
    assert.ok(error instanceof PhysicalResourceCompositeSettlementError);
    assert.deepEqual(error.errors, [primary, access]); return true;
  });
  assert.deepEqual(events, ['closed']);
});

for (const asynchronous of [false, true]) {
  const execute = asynchronous ? settlePhysicalResourcesAsync : settlePhysicalResources;
  const mode = asynchronous ? 'async' : 'sync';

  test(`${mode} captures cleanup membership before reading any action metadata`, async () => {
    const events: string[] = [];
    const later = { label: 'later', settle() { events.push('later'); } };
    const cleanup = [{ get label() {
      cleanup.length = 0;
      cleanup.push({ label: 'injected', settle() { assert.fail('unadmitted cleanup'); } });
      return 'first';
    }, settle() { events.push('first'); } }, later];
    await execute({ cleanup });
    assert.deepEqual(events, ['first', 'later']);
  });

  test(`${mode} cleanup selection ignores an overridden array iterator`, async () => {
    const events: string[] = [];
    const cleanup = [{ label: 'owned', settle() { events.push('owned'); } }];
    Object.defineProperty(cleanup, Symbol.iterator, { get() {
      assert.fail('cleanup membership must not execute a caller iterator');
    } });
    await execute({ cleanup });
    assert.deepEqual(events, ['owned']);
  });

  for (const variant of ['hole', 'accessor', 'inherited'] as const) {
    test(`${mode} reports a ${variant} slot without abandoning captured peers or the primary`, async () => {
      const events: string[] = [];
      const cleanup = [
        { label: 'invalid', settle() { assert.fail('invalid slot was admitted'); } },
        { label: 'owned', settle() { events.push('owned'); } }
      ];
      if (variant === 'accessor') Object.defineProperty(cleanup, '0', { get() {
        assert.fail('array-slot accessors must not execute');
      } });
      else {
        Reflect.deleteProperty(cleanup, '0');
        if (variant === 'inherited') {
          const prototype = Object.create(Array.prototype);
          Object.defineProperty(prototype, '0', { value: {
            label: 'foreign', settle() { assert.fail('inherited cleanup was admitted'); }
          } });
          Object.setPrototypeOf(cleanup, prototype);
        }
      }
      await assert.rejects(async () => execute({ primary: { label: 'operation', error: undefined }, cleanup }), error => {
        assert.ok(error instanceof PhysicalResourceCompositeSettlementError);
        assert.deepEqual(error.failures.map(failure => failure.label), ['operation', 'cleanup[0]']);
        assert.equal(error.errors[0], undefined);
        assert.ok(error.errors[1] instanceof TypeError);
        return true;
      });
      assert.deepEqual(events, ['owned']);
    });
  }
}
