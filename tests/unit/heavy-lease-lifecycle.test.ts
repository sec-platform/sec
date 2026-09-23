import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  HeavyVerificationGateBusyError, onceHeavyVerificationGateRelease, waitForHeavyVerificationGateLease,
  withAcquiredHeavyVerificationGateLease
} from '../../src/adapters/verification/platform/gate/state/heavy-lease-lifecycle.ts';

for (const reason of [undefined, null, false, 0]) test(`operation ${String(reason)} and release failure both survive`, async () => {
  const release = new Error('release');
  await assert.rejects(withAcquiredHeavyVerificationGateLease({ release() { throw release; } }, () => { throw reason; }), e => {
    assert.ok(e instanceof AggregateError); assert.deepEqual(e.errors, [reason, release]); assert.equal(e.cause, reason); return true;
  });
});

test('release method identity and private receiver survive callback mutation', async () => {
  class Lease { #calls = 0; release() { this.#calls++; } get calls() { return this.#calls; } }
  const lease = new Lease(); const result = {};
  assert.equal(await withAcquiredHeavyVerificationGateLease(lease, () => { lease.release = () => assert.fail('replacement'); return result; }), result);
  assert.equal(lease.calls, 1);
});

test('concurrent and later release calls share the same rejected outcome', async () => {
  const reason = new Error('failed'); let calls = 0;
  const release = onceHeavyVerificationGateRelease(async () => { calls++; await Promise.resolve(); throw reason; });
  const first = release(), second = release(); assert.equal(first, second);
  await Promise.all([assert.rejects(first, e => e === reason), assert.rejects(second, e => e === reason)]);
  await assert.rejects(release(), e => e === reason); assert.equal(calls, 1);
});

test('typed contention retries despite changed wording and ignores wall-clock jumps', async () => {
  const original = Date.now; let count = 0;
  try {
    Date.now = () => count % 2 ? 0 : Number.MAX_SAFE_INTEGER;
    const result = await waitForHeavyVerificationGateLease(async () => {
      count++; if (count === 1) throw new HeavyVerificationGateBusyError('active', 'different words');
      return { release() {} };
    }, 1000);
    assert.equal(count, 2); assert.equal(typeof result.release, 'function');
  } finally { Date.now = original; }
});

test('a matching error message is not retry authority', async () => {
  let count = 0; const reason = new Error('already active');
  await assert.rejects(waitForHeavyVerificationGateLease(async () => { count++; throw reason; }, 1000), e => e === reason);
  assert.equal(count, 1);
});

test('zero wait tries once and does not start a retry timer', async () => {
  let count = 0; const reason = new HeavyVerificationGateBusyError('initializing', 'wait');
  await assert.rejects(waitForHeavyVerificationGateLease(async () => { count++; throw reason; }, 0), e => e === reason);
  assert.equal(count, 1);
});

test('a lease acquired after the deadline is released before rejection', async () => {
  let released = false;
  await assert.rejects(waitForHeavyVerificationGateLease(async () => {
    await new Promise(r => setTimeout(r, 15)); return { release() { released = true; } };
  }, 1), /deadline/);
  assert.equal(released, true);
});
