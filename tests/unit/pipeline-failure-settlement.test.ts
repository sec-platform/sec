import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CompilerError } from '../../src/compiler/errors.ts';
import { describePipelineFailure, PipelineSettlementFailure, settlePipelineFailure } from '../../src/application/pipeline-failure.ts';

for (const reason of [undefined, null, false, 0, 'failure', Symbol('reason')]) {
  test(`settled failure preserves ${String(reason)} without converting it to success`, async () => {
    let calls = 0;
    await assert.rejects(settlePipelineFailure(reason, [{ operation: 'journal', run: async () => { calls++; } }]), value => value === reason);
    assert.equal(calls, 1);
  });
}

test('all failure settlement steps are attempted once and both original and secondary failures survive', async () => {
  const primary = Object.freeze({ primary: true }), first = new Error('lock'), second = new Error('journal');
  const calls: string[] = [];
  await assert.rejects(settlePipelineFailure(primary, [
    { operation: 'lock', run: async () => { calls.push('lock'); throw first; } },
    { operation: 'journal', run: async () => { calls.push('journal'); throw second; } }
  ]), value => {
    assert.ok(value instanceof PipelineSettlementFailure); assert.equal(value.cause, primary);
    assert.deepEqual(value.settlementFailures, [{ operation: 'lock', reason: first }, { operation: 'journal', reason: second }]);
    assert.ok(Object.isFrozen(value.settlementFailures)); return true;
  });
  assert.deepEqual(calls, ['lock', 'journal']);
});

test('a refused commit fence is never bypassed by the settlement helper', async () => {
  let writes = 0;
  const fence = async () => { throw new Error('lease invalid'); };
  await assert.rejects(settlePipelineFailure(new Error('operation'), [
    { operation: 'lock', run: async () => { await fence(); writes++; } },
    { operation: 'journal', run: async () => { await fence(); writes++; } }
  ]), PipelineSettlementFailure);
  assert.equal(writes, 0);
});

test('failure descriptions retain known compiler codes and ordinary messages', () => {
  assert.deepEqual(describePipelineFailure(new CompilerError('TEST-001', 'message')), { code: 'TEST-001', message: 'message' });
  assert.deepEqual(describePipelineFailure(new Error('message')), { code: 'UNEXPECTED', message: 'message' });
  assert.deepEqual(describePipelineFailure(undefined), { code: 'UNEXPECTED', message: 'undefined' });
});

test('revoked proxies and hostile accessors do not prevent failure settlement', async () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  const hostile = Object.defineProperties(new CompilerError('ORIGINAL', 'message'), {
    code: { get() { throw new Error('code getter'); } }, message: { get() { throw new Error('message getter'); } }
  });
  for (const reason of [proxy, hostile]) {
    assert.equal(typeof describePipelineFailure(reason).message, 'string');
    await assert.rejects(settlePipelineFailure(reason, [{ operation: 'journal', run: async () => { throw reason; } }]), value => {
      assert.ok(value instanceof PipelineSettlementFailure); assert.equal(value.cause, reason);
      assert.equal(value.settlementFailures[0]?.reason, reason); return true;
    });
  }
});

test('object conversion hooks are not executed while describing an unknown failure', () => {
  const hostile = { toString() { assert.fail('conversion'); }, [Symbol.toPrimitive]() { assert.fail('conversion'); } };
  assert.equal(describePipelineFailure(hostile).code, 'UNEXPECTED');
});
