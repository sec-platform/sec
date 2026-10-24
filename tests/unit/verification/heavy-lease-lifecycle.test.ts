import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runObservedCommand } from '../../../src/adapters/runtime-state/physical/runtime/observed-process-stdin.ts';
import { createRawTestExecutableFixture } from '../../testkit/raw-process.ts';
import {
  HeavyVerificationGateBusyError, onceHeavyVerificationGateRelease, waitForHeavyVerificationGateLease,
  withAcquiredHeavyVerificationGateLease
} from '../../../src/adapters/verification/platform/gate/state/heavy-lease-lifecycle.ts';

for (const reason of [undefined, null, false, 0]) test(`operation ${String(reason)} and release failure both survive`, async () => {
  const release = new Error('release');
  await assert.rejects(withAcquiredHeavyVerificationGateLease({ release() { throw release; } }, () => { throw reason; }), e => {
    assert.ok(e instanceof AggregateError); assert.deepEqual(e.errors, [reason, release]); assert.equal(e.cause, reason); return true;
  });
});

test('concurrent and later release calls share the same rejected outcome', async () => {
  const reason = new Error('failed'); let calls = 0;
  const release = onceHeavyVerificationGateRelease(async () => { calls++; await Promise.resolve(); throw reason; });
  const first = release(), second = release();
  await Promise.all([assert.rejects(first, e => e === reason), assert.rejects(second, e => e === reason)]);
  await assert.rejects(release(), e => e === reason); assert.equal(calls, 1);
});

test('typed contention retries despite changed wording and a forward wall-clock jump', async () => {
  // The hostile clock must span the owner's awaited acquisition and deadline
  // checks. An observed child prevents contaminating other tests; its test-only
  // executable fixture also preserves non-retained POSIX test reachability.
  const owner = new URL('../../../src/adapters/verification/platform/gate/state/heavy-lease-lifecycle.ts', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { HeavyVerificationGateBusyError, waitForHeavyVerificationGateLease,
      withAcquiredHeavyVerificationGateLease } from ${JSON.stringify(owner)};
    const original = Date.now;
    let count = 0, released = 0;
    let wallTime = original();
    const lease = Object.freeze({ release() { released++; } });
    const callbackResult = Object.freeze({ completed: true });
    // This valid forward jump exceeds the wait budget, but must not turn
    // typed contention into a deadline failure. Ordinary clock reads are legal.
    Date.now = () => wallTime;
    let sameResult = false;
    try {
      const result = await waitForHeavyVerificationGateLease(async () => {
        count++;
        if (count === 1) {
          wallTime += 60_000;
          throw new HeavyVerificationGateBusyError('active', 'different words');
        }
        return lease;
      }, 1000);
      sameResult = await withAcquiredHeavyVerificationGateLease(result, () => callbackResult) === callbackResult;
    } finally { Date.now = original; }
    assert.deepEqual({ count, released, sameResult },
      { count: 2, released: 1, sameResult: true });
    process.stdout.write(JSON.stringify({ count, released, sameResult }));
  `;
  const executable = createRawTestExecutableFixture();
  const output: Record<'stdout' | 'stderr', Buffer[]> = { stdout: [], stderr: [] };
  try {
    const result = await runObservedCommand(executable.command, ['--no-env-file', '--eval', script], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxObservedOutputBytes: 4096,
      onOutput(stream, chunk) { output[stream].push(Buffer.from(chunk)); }
    });
    assert.equal(result.status, 'exited');
    assert.equal(result.started, true);
    assert.equal(result.exitCode, 0, Buffer.concat(output.stderr).toString('utf8'));
    assert.equal(result.termination.childCloseObserved, true);
    assert.equal(result.termination.streamsDrained, true);
    assert.equal(result.termination.treeClosed, true);
    assert.equal(result.stdout.observerTruncated, false);
    assert.equal(result.stderr.observerTruncated, false);
    assert.deepEqual(JSON.parse(Buffer.concat(output.stdout).toString('utf8')), {
      count: 2, released: 1, sameResult: true
    });
  } finally { executable.dispose(); }

});

test('a matching error message is not retry authority', async () => {
  let count = 0; const reason = new Error('already active');
  await assert.rejects(waitForHeavyVerificationGateLease(async () => { count++; throw reason; }, 1000), e => e === reason);
  assert.equal(count, 1);
});

test('zero wait attempts acquisition once and preserves contention', async () => {
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
