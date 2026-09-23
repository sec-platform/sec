import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  ResourceCompositeSettlementError,
  withAcquiredResource,
  type AcquiredResourceScope
} from '../../src/execution/resource-settlement.ts';

async function rejectsWith(promise: Promise<unknown>, expected: unknown): Promise<void> {
  let failed = false;
  try { await promise; } catch (actual) { failed = true; assert.equal(actual, expected); }
  assert.equal(failed, true);
}

for (const reason of [undefined, null, false, 0, Object.freeze({ failure: true })]) {
  test(`acquisition failure (${typeof reason}) never uses or releases an unowned resource`, async () => {
    const events: string[] = [];
    await rejectsWith(withAcquiredResource({
      operationLabel: 'use', resourceLabel: 'resource',
      acquire(): number { events.push('acquire'); throw reason; },
      use() { events.push('use'); },
      release() { events.push('release'); }
    }), reason);
    assert.deepEqual(events, ['acquire']);
  });

  test(`body failure (${typeof reason}) survives one successful release`, async () => {
    const resource = {}, events: string[] = [];
    await rejectsWith(withAcquiredResource({
      operationLabel: 'use', resourceLabel: 'resource',
      acquire: () => resource,
      use(actual) { assert.equal(actual, resource); events.push('use'); throw reason; },
      release(actual) { assert.equal(actual, resource); events.push('release'); }
    }), reason);
    assert.deepEqual(events, ['use', 'release']);
  });

  test(`release failure (${typeof reason}) never becomes normal result delivery`, async () => {
    await rejectsWith(withAcquiredResource({
      operationLabel: 'use', resourceLabel: 'resource',
      acquire: () => null,
      use: () => 'not-delivered',
      release() { throw reason; }
    }), reason);
  });
}

for (const value of [undefined, null, false, 0]) {
  test(`successful false-like resource/result (${typeof value}) still owns a release obligation`, async () => {
    const released: unknown[] = [];
    const actual = await withAcquiredResource({
      operationLabel: 'use', resourceLabel: 'resource',
      acquire: () => value,
      use(resource) { assert.equal(resource, value); return value; },
      release(resource) { released.push(resource); }
    });
    assert.equal(actual, value);
    assert.deepEqual(released, [value]);
  });
}

test('body and release errors retain labels, occurrence order and exact payloads', async () => {
  const primary = undefined, cleanup = Object.freeze({ cleanup: true });
  await assert.rejects(withAcquiredResource({
    operationLabel: 'body', resourceLabel: 'owned-handle',
    acquire: () => ({}),
    use() { throw primary; },
    release() { throw cleanup; }
  }), error => {
    assert.ok(error instanceof ResourceCompositeSettlementError);
    assert.deepEqual(error.failures, [
      { label: 'body', error: primary }, { label: 'owned-handle', error: cleanup }
    ]);
    assert.deepEqual(error.errors, [primary, cleanup]);
    return true;
  });
});

test('release and operation are selected before acquisition can mutate the scope', async () => {
  const events: string[] = [];
  const input: AcquiredResourceScope<number, number> = {
    operationLabel: 'body', resourceLabel: 'resource',
    acquire() {
      input.use = () => { events.push('replacement-use'); return 0; };
      input.release = () => { events.push('replacement-release'); };
      return 3;
    },
    use(resource) { events.push('use'); return resource + 1; },
    release() { events.push('release'); }
  };
  assert.equal(await withAcquiredResource(input), 4);
  assert.deepEqual(events, ['use', 'release']);
});

test('class-private provider state keeps the original method receiver', async () => {
  class Provider implements AcquiredResourceScope<number, number> {
    readonly operationLabel = 'body'; readonly resourceLabel = 'resource';
    #value = 9; released = false;
    acquire() { return this.#value; }
    use(value: number) { return value + this.#value; }
    release(value: number) { assert.equal(value, this.#value); this.released = true; }
  }
  const provider = new Provider();
  assert.equal(await withAcquiredResource(provider), 18);
  assert.equal(provider.released, true);
});

test('an invalid release is rejected before acquiring a resource', async () => {
  let acquired = false;
  await assert.rejects(withAcquiredResource({
    operationLabel: 'body', resourceLabel: 'resource',
    acquire() { acquired = true; return 1; }, use: value => value,
    release: null as unknown as () => void
  }), TypeError);
  assert.equal(acquired, false);
});

test('normal value delivery waits for asynchronous release acknowledgement', async () => {
  let acknowledge!: () => void, notifyRelease!: () => void;
  const ack = new Promise<void>(resolve => { acknowledge = resolve; });
  const enteredRelease = new Promise<void>(resolve => { notifyRelease = resolve; });
  let delivered = false;
  const result = withAcquiredResource({
    operationLabel: 'body', resourceLabel: 'resource',
    acquire: () => 1, use: () => 2,
    release() { notifyRelease(); return ack; }
  }).then(value => { delivered = true; return value; });
  await enteredRelease;
  assert.equal(delivered, false);
  acknowledge();
  assert.equal(await result, 2);
  assert.equal(delivered, true);
});

test('nested resources close inside-out and still close the parent after child failure', async () => {
  const events: string[] = [], failure = Object.freeze({ child: true });
  await rejectsWith(withAcquiredResource({
    operationLabel: 'parent-body', resourceLabel: 'parent',
    acquire() { events.push('parent-acquire'); return 1; },
    use: () => withAcquiredResource({
      operationLabel: 'child-body', resourceLabel: 'child',
      acquire() { events.push('child-acquire'); return 2; },
      use() { events.push('child-use'); throw failure; },
      release() { events.push('child-release'); }
    }),
    release() { events.push('parent-release'); }
  }), failure);
  assert.deepEqual(events, ['parent-acquire', 'child-acquire', 'child-use', 'child-release', 'parent-release']);
});
