import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { withCompilerInstallResources, CompilerInstallSettlementFailure } from '../../src/toolchain/dependencies/runtime/install-resource-scope.ts';

for (const count of [0, 1, 2, 3]) {
  test(`partial acquisition releases exactly the ${count} already acquired resources`, async () => {
    const names = ['executable', 'working-directory', 'process-session'] as const;
    const events: string[] = [];
    const primary = Object.freeze({ acquisition: count });
    await assert.rejects(withCompilerInstallResources(async (retain) => {
      for (const name of names.slice(0, count)) retain(name, () => { events.push(name); });
      throw primary;
    }), (reason) => reason === primary);
    assert.deepEqual(events, names.slice(0, count).reverse());
  });
}

for (const primary of [undefined, null, false, 0, 'execution failure']) {
  test(`cleanup preserves ${String(primary)} as a present execution failure`, async () => {
    const closeFailure = new Error('close'), disposeFailure = new Error('dispose');
    const order: string[] = [];
    await assert.rejects(withCompilerInstallResources(async (retain) => {
      retain('executable', () => { order.push('exe'); throw disposeFailure; });
      retain('working-directory', () => { order.push('cwd'); });
      retain('process-session', () => { order.push('session'); throw closeFailure; });
      throw primary;
    }), (error: unknown) => {
      assert.ok(error instanceof CompilerInstallSettlementFailure);
      assert.equal(error.primaryFailed, true); assert.equal(error.cause, primary);
      assert.deepEqual(error.resourceFailures.map(f => f.reason), [closeFailure, disposeFailure]);
      assert.deepEqual(error.resourceFailures.map(f => f.resource), ['process-session', 'executable']);
      assert.ok(Object.isFrozen(error.resourceFailures));
      assert.ok(error.resourceFailures.every(Object.isFrozen));
      return true;
    });
    assert.deepEqual(order, ['session', 'cwd', 'exe']);
  });
}

test('successful execution with failed settlement is not returned as success', async () => {
  await assert.rejects(withCompilerInstallResources(async (retain) => {
    retain('executable', () => { throw undefined; }); return 7;
  }), (error: unknown) => {
    assert.ok(error instanceof CompilerInstallSettlementFailure);
    assert.equal(error.primaryFailed, false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.equal(error.resourceFailures.length, 1); assert.equal(error.resourceFailures[0]?.reason, undefined);
    return true;
  });
});

test('successful cleanup preserves the exact result and invokes the action once', async () => {
  const result = { value: 7 }; let calls = 0;
  assert.equal(await withCompilerInstallResources(async (retain) => {
    calls++; retain('executable', () => {}); return result;
  }), result);
  assert.equal(calls, 1);
});

test('asynchronous cleanup is settled in reverse order before returning', async () => {
  const order: string[] = [];
  await assert.rejects(withCompilerInstallResources(async (retain) => {
    retain('executable', async () => { order.push('last'); });
    retain('working-directory', async () => { await Promise.resolve(); order.push('first'); throw 'asynchronous'; });
    return 7;
  }), (error: unknown) => {
    assert.ok(error instanceof CompilerInstallSettlementFailure);
    assert.equal(error.resourceFailures[0]?.reason, 'asynchronous'); return true;
  });
  assert.deepEqual(order, ['first', 'last']);
});

test('a retired scope refuses late registration instead of silently leaking the release', async () => {
  let retained: Parameters<Parameters<typeof withCompilerInstallResources>[0]>[0] | undefined;
  await withCompilerInstallResources(async (retain) => { retained = retain; });
  assert.throws(() => retained!('executable', () => {}), /closed/);
});

test('settlement does not stringify hostile thrown values', async () => {
  const value = { toString() { assert.fail('coerced'); } };
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  await assert.rejects(withCompilerInstallResources(async (retain) => {
    retain('executable', () => { throw proxy; }); throw value;
  }), (error: unknown) => {
    assert.ok(error instanceof CompilerInstallSettlementFailure);
    assert.equal(error.cause, value); assert.equal(error.resourceFailures[0]?.reason, proxy); return true;
  });
});
