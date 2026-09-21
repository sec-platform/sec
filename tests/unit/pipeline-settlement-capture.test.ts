import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PipelineSettlementFailure, settlePipelineFailure } from '../../src/application/pipeline-failure.ts';

test('all settlement actions and diagnostic labels are fixed before the first callback', async () => {
  const order: string[] = [], primary = new Error('primary'), secondary = new Error('secondary');
  const second = { operation: 'second', async run() { assert.equal(this, second); order.push('second'); throw secondary; } };
  const steps = [{ operation: 'first', async run() {
    order.push('first'); second.operation = 'replaced'; second.run = async () => assert.fail('replacement');
    steps.push({ operation: 'injected', run: async () => assert.fail('injected') });
  } }, second];
  await assert.rejects(settlePipelineFailure(primary, steps), (error: unknown) => {
    assert.ok(error instanceof PipelineSettlementFailure); assert.equal(error.cause, primary);
    assert.equal(error.settlementFailures[0]?.operation, 'second');
    assert.equal(error.settlementFailures[0]?.reason, secondary); return true;
  });
  assert.deepEqual(order, ['first', 'second']);
});

test('a captured settlement method keeps its provider receiver and private state', async () => {
  class Provider {
    operation = 'private';
    #calls = 0;
    async run() { this.#calls++; }
    get calls() { return this.#calls; }
  }
  const provider = new Provider(), primary = new Error('primary');
  await assert.rejects(settlePipelineFailure(primary, [provider]), error => error === primary);
  assert.equal(provider.calls, 1);
});

for (const invalid of [null, [], { operation: '', run: () => {} }, { operation: 'bad', run: 7 }]) {
  test(`invalid settlement item ${JSON.stringify(invalid)} preserves the original error before effects`, async () => {
    const primary = Object.freeze({ value: 'original' }); let calls = 0;
    await assert.rejects(settlePipelineFailure(primary, [{ operation: 'valid', async run() { calls++; } }, invalid] as never), (error: unknown) => {
      assert.ok(error instanceof PipelineSettlementFailure); assert.equal(error.cause, primary);
      assert.equal(error.settlementFailures[0]?.operation, 'settlement-plan'); return true;
    });
    assert.equal(calls, 0);
  });
}

test('a throwing settlement getter stays secondary and cannot replace the original rejection', async () => {
  const primary = undefined, secondary = Object.freeze({ getter: 'failed' });
  await assert.rejects(settlePipelineFailure(primary, [{ get operation(): never { throw secondary; }, async run() {} }]), (error: unknown) => {
    assert.ok(error instanceof PipelineSettlementFailure); assert.equal(error.cause, primary);
    assert.equal(error.settlementFailures[0]?.reason, secondary); return true;
  });
});

test('sparse settlement lists cannot silently omit a planned effect', async () => {
  const primary = new Error('primary');
  await assert.rejects(settlePipelineFailure(primary, new Array(1)), (error: unknown) => error instanceof PipelineSettlementFailure && error.cause === primary);
});
