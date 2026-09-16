import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyOperationOptions as install } from '../../src/toolchain/dependencies/runtime/operation-context.ts';
import {
  awaitRuntimeDependencyOperation,
  runtimeDependencyOperationControls as bind,
  runtimeDependencyOperationContext as context,
  runtimeDependencyOperationDeadlineAt as deadline,
  runtimeDependencyOperationRemainingMs as remaining,
  waitForRuntimeDependencyOperation
} from '../../src/toolchain/dependencies/runtime/operation-controls.ts';
import { measureRuntimeDependencyOperationPhase, readRuntimeDependencyOperationTelemetry } from '../../src/toolchain/dependencies/runtime/operation-telemetry.ts';

const rejected = (error: unknown) => (error as { code?: string }).code === 'RUNTIME-DEPS-003';
function parent() { return bind({ lockTimeoutMs: 100, monotonicNowMs: () => 0 }); }
function symbolOf(value: object) { return Object.getOwnPropertySymbols(value)[0]!; }

for (const change of ['extended-deadline', 'removed-cancellation', 'changed-clock', 'changed-identity'] as const) {
  test(`shape-compatible ledger forgery is rejected: ${change}`, async () => {
    const original = parent();
    const fake = { ...context(original) };
    if (change === 'extended-deadline') fake.deadlineAtMonotonicMs += 1_000_000;
    if (change === 'removed-cancellation') fake.signal = undefined;
    if (change === 'changed-clock') fake.monotonicNowMs = () => assert.fail('forged clock called');
    if (change === 'changed-identity') fake.operationId = 'borrowed-identity';
    const candidate = { ...original, [symbolOf(original)]: Object.freeze(fake) };
    for (const consume of [bind, install, context, (x: typeof candidate) => remaining(x, 'remaining'),
      (x: typeof candidate) => deadline(x, 'deadline'), readRuntimeDependencyOperationTelemetry,
      (x: typeof candidate) => measureRuntimeDependencyOperationPhase(x, 'install', () => assert.fail('action ran'))]) {
      assert.throws(() => consume(candidate), rejected);
    }
    await assert.rejects(waitForRuntimeDependencyOperation(candidate, 1, async () => assert.fail('sleep ran'), 'wait'), rejected);
    await assert.rejects(awaitRuntimeDependencyOperation(fake, 'forged context', () => assert.fail('provider ran')), rejected);
  });
}

test('a binding accessor is rejected before a compatibility options spread invokes it', () => {
  const original = parent();
  const candidate = { lockTimeoutMs: 100, monotonicNowMs: () => assert.fail('clock ran') };
  Object.defineProperty(candidate, symbolOf(original), { enumerable: true, get() { assert.fail('forged accessor invoked'); } });
  assert.throws(() => bind(candidate), rejected);
  assert.throws(() => install(candidate), rejected);
  assert.throws(() => context(candidate), rejected);
});

test('a present but non-enumerable binding cannot be silently dropped into a new operation', () => {
  const original = parent();
  const candidate = { lockTimeoutMs: 100, monotonicNowMs: () => assert.fail('new ledger created') };
  Object.defineProperty(candidate, symbolOf(original), { enumerable: false, value: context(original) });
  for (const consume of [bind, install, context]) assert.throws(() => consume(candidate), rejected);
});

test('proxy substitution cannot select a different genuine ledger than its own descriptor', () => {
  const first = parent(), second = parent();
  const mutable = { ...first };
  const candidate = new Proxy(mutable, { get(target, key, receiver) {
    return typeof key === 'symbol' ? context(second) : Reflect.get(target, key, receiver);
  } });
  assert.throws(() => context(candidate), rejected);
  assert.throws(() => bind(candidate), rejected);
});

test('genuine spread copies retain identity, elapsed budget, telemetry and cancellation', () => {
  let now = 0;
  const abort = new AbortController();
  const original = install({ lockTimeoutMs: 100, signal: abort.signal, monotonicNowMs: () => now });
  now = 30;
  const copy = bind({ ...original });
  assert.equal(context(copy), context(original));
  assert.equal(remaining(copy, 'budget'), 70);
  measureRuntimeDependencyOperationPhase(copy, 'identity', () => { now = 35; });
  assert.deepEqual(readRuntimeDependencyOperationTelemetry(copy), readRuntimeDependencyOperationTelemetry(original));
  const reason = Object.freeze({ cancel: 'parent' }); abort.abort(reason);
  assert.throws(() => remaining(copy, 'budget'), (error) => error === reason);
});

for (const bad of [null, false, 0, 'signal', {}, { aborted: false, throwIfAborted() {} }]) {
  test(`a non-native cancellation value cannot bind: ${typeof bad}`, () => {
    assert.throws(() => bind({ signal: bad as never, monotonicNowMs: () => assert.fail('clock reached') }), rejected);
  });
}

test('signal validation never invokes a duck signal getter or method', () => {
  const signal = { get aborted() { assert.fail('fake aborted getter'); throw new Error('unreachable'); }, throwIfAborted() { assert.fail('fake method'); } };
  assert.throws(() => bind({ signal: signal as never }), rejected);
});

for (const field of ['lockTimeoutMs', 'pollIntervalMs', 'monotonicNowMs'] as const) {
  test(`null is not a missing ${field} default`, () => {
    assert.throws(() => bind({ [field]: null } as never), rejected);
  });
}

for (const bad of [0, 'clock', {}, true]) {
  test(`invalid raw clock is rejected as an input failure: ${typeof bad}`, () => {
    assert.throws(() => bind({ monotonicNowMs: bad as never }), rejected);
  });
}

test('caller mutation cannot alter the issued ledger and its owner checks', () => {
  const original = parent();
  const ledger = context(original);
  assert.equal(Reflect.set(ledger, 'deadlineAtMonotonicMs', 100_000), false);
  assert.equal(Reflect.set(original, 'lockTimeoutMs', 100_000), false);
  const narrowed = bind({ ...original, lockTimeoutMs: 7 });
  assert.equal(remaining(narrowed, 'budget'), 7);
  assert.equal(context(narrowed).operationId, ledger.operationId);
  assert.equal(context(narrowed).telemetryKey, ledger.telemetryKey);
});

for (const phase of ['bind', 'budget', 'provider'] as const) {
  test(`a native signal cannot suppress cancellation by shadowing its method at ${phase}`, async () => {
    const abort = new AbortController();
    Object.defineProperty(abort.signal, 'throwIfAborted', { value() { assert.fail('public method invoked'); } });
    const reason = Object.freeze({ cancelled: phase });
    const original = phase === 'bind' ? undefined : bind({ lockTimeoutMs: 100, signal: abort.signal });
    abort.abort(reason);
    if (phase === 'bind') {
      assert.throws(() => bind({ signal: abort.signal }), (error) => error === reason);
    } else if (phase === 'budget') {
      assert.throws(() => remaining(original!, 'budget'), (error) => error === reason);
    } else {
      await assert.rejects(awaitRuntimeDependencyOperation(context(original!), 'effect', () => assert.fail('provider reached')),
        (error) => error === reason);
    }
  });
}


for (const mutate of ['delete', 'replace'] as const) {
  test(`a whole-input getter cannot ${mutate} its parent during the install snapshot`, () => {
    const original = parent(), other = parent();
    const key = symbolOf(original);
    const candidate: Record<string | symbol, unknown> = { ...original };
    Object.defineProperty(candidate, 'unowned', { enumerable: true, get() {
      if (mutate === 'delete') delete candidate[key];
      else candidate[key] = context(other);
      return 'captured';
    } });
    // Force ordinary property enumeration rather than a runtime's optimized
    // spread path, which may already have captured the symbol before the getter.
    assert.throws(() => install(new Proxy(candidate, {})), rejected);
    assert.equal(context(candidate), context(original));
  });
  test(`a control getter cannot ${mutate} the retained binding before ledger admission`, () => {
    const original = parent(), other = parent();
    const key = symbolOf(original);
    const candidate: Record<string | symbol, unknown> = { ...original };
    Object.defineProperty(candidate, 'lockTimeoutMs', { enumerable: true, get() {
      if (mutate === 'delete') delete candidate[key];
      else candidate[key] = context(other);
      return 100;
    } });
    assert.throws(() => bind(candidate), rejected);
  });
}
