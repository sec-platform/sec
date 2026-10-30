import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  runtimeDependencyOperationContext as contextOf,
  runtimeDependencyOperationEffectFence as fence,
  runtimeDependencyOperationOptions as normalize,
  runtimeDependencyOperationRemainingMs as remaining,
  waitForRuntimeDependencyOperation as wait
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

const deadlineError = (error: unknown): boolean => error instanceof CodedFailure && error.code === 'RUNTIME-DEPS-003';

for (const canceled of ['parent', 'child'] as const) {
  test(`derived operations preserve cancellation from the ${canceled}`, () => {
    const parent = new AbortController();
    const child = new AbortController();
    const first = normalize({ signal: parent.signal, lockTimeoutMs: 100, monotonicNowMs: () => 0 });
    const second = normalize({ ...first, signal: child.signal });
    const reason = new Error(canceled);
    (canceled === 'parent' ? parent : child).abort(reason);
    assert.throws(() => remaining(second, 'derived'), (error: unknown) => error === reason);
    assert.ok(second.signal);
    assert.equal(second.signal.aborted, true);
    assert.strictEqual(second.signal.reason, reason);
    assert.strictEqual(second.signal, contextOf(second).signal);
    if (canceled === 'child') assert.equal(parent.signal.aborted, false);
    else {
      Object.defineProperty(parent.signal, 'aborted', { value: false });
      assert.throws(() => normalize({ ...first, signal: child.signal }), error => error === reason);
    }
  });
}

test('omitting a copied signal cannot detach the public options from the parent', () => {
  const parent = new AbortController();
  const first = normalize({ signal: parent.signal, monotonicNowMs: () => 0 });
  const second = normalize({ ...first, signal: undefined });
  assert.strictEqual(second.signal, parent.signal);
  assert.strictEqual(second.signal, contextOf(second).signal);
});

for (const canceled of [0, 1, 2]) {
  test(`a nested operation retains cancellation source ${canceled}`, () => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    let options = normalize({ signal: controllers[0]!.signal, monotonicNowMs: () => 0 });
    options = normalize({ ...options, signal: controllers[1]!.signal });
    options = normalize({ ...options, signal: controllers[2]!.signal });
    const reason = { canceled };
    controllers[canceled]!.abort(reason);
    assert.throws(() => remaining(options, 'nested'), (error: unknown) => error === reason);
  });
}

test('normalizing a derived signal retains its operation and cancellation bindings', () => {
  const first = normalize({ signal: new AbortController().signal, monotonicNowMs: () => 0 });
  const second = normalize({ ...first, signal: new AbortController().signal });
  const third = normalize(second);
  assert.strictEqual(third.signal, second.signal);
  assert.strictEqual(contextOf(third).operationId, contextOf(first).operationId);
});

test('parent cancellation stops an already-started wait with the exact null reason', async () => {
  const parent = new AbortController();
  const first = normalize({ signal: parent.signal, lockTimeoutMs: 1000, monotonicNowMs: () => 0 });
  const child = normalize({ ...first, signal: new AbortController().signal });
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  const pending = wait(child, 1, () => { started(); return new Promise<void>(() => {}); }, 'child wait');
  const settled = pending.then(() => ({ rejected: false }), error => ({ rejected: true, error }));
  await admitted;
  parent.abort(null);
  const result = await settled;
  assert.deepEqual(result, { rejected: true, error: null });
});

test('cancellation during an effect fence prevents effect admission', async () => {
  const parent = new AbortController();
  const reason = new Error('fence canceled');
  const first = normalize({ signal: parent.signal, monotonicNowMs: () => 0 });
  const child = normalize({ ...first, signal: new AbortController().signal, beforeCommit: async () => { parent.abort(reason); } });
  await assert.rejects(fence(child, 'publish'), (error: unknown) => error === reason);
});

for (const mutation of ['none', 'poll', 'signal'] as const) {
  test(`a captured monotonic deadline survives a forward wall-clock jump (${mutation})`, () => {
    const original = Date.now;
    let wall = 1000;
    let monotonic = 0;
    Date.now = () => wall;
    try {
      const first = normalize({ deadlineAtUnixMs: mutation === 'none' ? 601000 : 1100,
        lockTimeoutMs: 100, monotonicNowMs: () => monotonic });
      assert.equal(contextOf(first).initialBudgetMs, 100);
      assert.equal(contextOf(first).deadlineAtUnixMs, 1100);
      assert.equal(first.deadlineAtUnixMs, 1100);
      wall = 5000;
      monotonic = 10;
      const changes = mutation === 'poll' ? { pollIntervalMs: 2 }
        : mutation === 'signal' ? { signal: new AbortController().signal } : {};
      const second = normalize({ ...first, ...changes });
      assert.equal(contextOf(second).deadlineAtMonotonicMs, 100);
      assert.equal(second.deadlineAtUnixMs, 1100);
      assert.equal(remaining(second, 'captured'), 90);
    } finally { Date.now = original; }
  });
}

test('a backward wall-clock jump cannot shorten or extend an existing monotonic operation', () => {
  const original = Date.now;
  let wall = 1000;
  let monotonic = 0;
  Date.now = () => wall;
  try {
    const first = normalize({ lockTimeoutMs: 100, monotonicNowMs: () => monotonic });
    wall = 0;
    monotonic = 10;
    const second = normalize(first);
    assert.equal(contextOf(second).deadlineAtMonotonicMs, 100);
    assert.equal(remaining(second, 'captured'), 90);
  } finally { Date.now = original; }
});

test('new lock and absolute deadlines may narrow but never extend an existing operation', async () => {
  const original = Date.now;
  let wall = 1000;
  let monotonic = 0;
  let fenceCalls = 0;
  let rebound!: ReturnType<typeof normalize>;
  Date.now = () => wall;
  try {
    const first = normalize({ lockTimeoutMs: 100, monotonicNowMs: () => monotonic,
      async beforeCommit() { fenceCalls++; } });
    wall = 1010;
    monotonic = 10;
    const lockNarrowed = normalize({ ...first, lockTimeoutMs: 20 });
    const deadlineNarrowed = normalize({ ...first, deadlineAtUnixMs: 1060 });
    assert.equal(contextOf(lockNarrowed).deadlineAtMonotonicMs, 30);
    assert.equal(contextOf(deadlineNarrowed).deadlineAtMonotonicMs, 60);
    const widenedDeadline = normalize({ ...deadlineNarrowed, deadlineAtUnixMs: 5000 });
    const retainedContext = contextOf(widenedDeadline);
    assert.equal(retainedContext.deadlineAtMonotonicMs, 60);
    assert.equal(widenedDeadline.deadlineAtUnixMs, retainedContext.deadlineAtUnixMs);
    assert.strictEqual(contextOf(first).telemetryKey, contextOf(lockNarrowed).telemetryKey);
    assert.strictEqual(contextOf(first).operationId, contextOf(deadlineNarrowed).operationId);
    assert.equal(remaining(first, 'parent'), 90);
    monotonic = 25;
    rebound = normalize({ ...lockNarrowed, lockTimeoutMs: 1000, pollIntervalMs: 1 });
    assert.equal(contextOf(rebound).deadlineAtMonotonicMs, 30);
    assert.strictEqual(contextOf(rebound).operationId, contextOf(first).operationId);
    assert.equal(remaining(rebound, 'rebound'), 5);
  } finally { Date.now = original; }
  await fence(rebound, 'inherited fence');
  assert.equal(fenceCalls, 1);
  monotonic = 31;
  assert.throws(() => remaining(rebound, 'expired'), deadlineError);
});

test('fresh or newly narrowed exhausted absolute deadlines still fail closed', () => {
  const original = Date.now;
  Date.now = () => 1000;
  try {
    assert.throws(() => normalize({ deadlineAtUnixMs: 999, monotonicNowMs: () => 0 }), deadlineError);
    const first = normalize({ deadlineAtUnixMs: 1100, monotonicNowMs: () => 0 });
    assert.throws(() => normalize({ ...first, deadlineAtUnixMs: 999 }), deadlineError);
    assert.throws(() => normalize({ ...first, deadlineAtUnixMs: NaN }), deadlineError);
  } finally { Date.now = original; }
});

test('a newly supplied wall deadline is honored after a forward clock correction', () => {
  const original = Date.now;
  let wall = 1000;
  let monotonic = 0;
  Date.now = () => wall;
  try {
    const first = normalize({ deadlineAtUnixMs: 1100, lockTimeoutMs: 100, monotonicNowMs: () => monotonic });
    wall = 5000;
    monotonic = 10;
    // Numerically later than the old wall timestamp, but tighter than the
    // parent's remaining 90 monotonic milliseconds: this is a new constraint.
    const second = normalize({ ...first, deadlineAtUnixMs: 5050 });
    assert.equal(contextOf(second).deadlineAtMonotonicMs, 60);
    assert.equal(remaining(second, 'new parent'), 50);
    wall = 9000;
    const third = normalize(second);
    assert.equal(contextOf(third).deadlineAtMonotonicMs, 60);
  } finally { Date.now = original; }
});

test('normalized option types describe resolved fields without forwarding caller extensions', () => {
  const normalized = normalize({
    marker: 'retained' as const,
    signal: undefined,
    lockTimeoutMs: undefined,
    pollIntervalMs: undefined,
    deadlineAtUnixMs: undefined,
    monotonicNowMs: () => 0
  });
  const deadline: number = normalized.deadlineAtUnixMs;
  const lockTimeout: number = normalized.lockTimeoutMs;
  const pollInterval: number = normalized.pollIntervalMs;
  const signal: AbortSignal | undefined = normalized.signal;
  // @ts-expect-error Undeclared extensions are not execution inputs.
  const marker = normalized.marker;
  assert.equal(deadline, contextOf(normalized).deadlineAtUnixMs);
  assert.equal(lockTimeout, contextOf(normalized).initialBudgetMs);
  assert.equal(pollInterval, contextOf(normalized).pollIntervalMs);
  assert.strictEqual(signal, contextOf(normalized).signal);
  assert.equal(marker, undefined);
  assert.equal('marker' in normalized, false);
});
