import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { assertNativeAbortSignal, isNativeAborted, linkNativeAbortSignals, throwIfNativeAborted } from '../../src/system-architecture/foundation/runtime/native-abort.ts';

for (const reason of [null, false, 0, 'cancelled', Object.freeze({ source: 'parent' })]) {
  test(`native state and exact cancellation reason survive shadowed signal properties (${String(reason)})`, () => {
    const controller = new AbortController();
    const signal = controller.signal;
    Object.defineProperties(signal, {
      aborted: { value: false }, reason: { value: 'forged' },
      throwIfAborted: { value: () => assert.fail('shadow method') }
    });
    controller.abort(reason);
    assert.equal(isNativeAborted(signal), true);
    assert.throws(() => throwIfNativeAborted(signal), error => error === reason);
    assert.throws(() => throwIfNativeAborted(linkNativeAbortSignals(signal)), error => error === reason);
  });
}

test('undefined is no cancellation source, null or structural lookalikes are invalid', () => {
  assert.equal(isNativeAborted(undefined), false);
  throwIfNativeAborted(undefined);
  for (const value of [null, {}, { aborted: false, throwIfAborted() {} }, 0, 'signal']) {
    assert.throws(() => assertNativeAbortSignal(value), TypeError);
    assert.throws(() => linkNativeAbortSignals(value as never), TypeError);
  }
});

test('synthetic events do not cancel a native dependent signal', () => {
  const controller = new AbortController();
  const signal = linkNativeAbortSignals(controller.signal);
  controller.signal.dispatchEvent(new Event('abort'));
  assert.equal(isNativeAborted(signal), false);
  controller.abort('real');
  assert.throws(() => throwIfNativeAborted(signal), error => error === 'real');
});

test('public source listeners cannot hide cancellation from private dependents', () => {
  const controller = new AbortController();
  controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  const dependent = linkNativeAbortSignals(controller.signal);
  controller.abort('real');
  assert.equal(isNativeAborted(dependent), true);
});

test('all parent sources remain effective and unrelated links are independent', () => {
  const one = new AbortController(), two = new AbortController();
  const linked = linkNativeAbortSignals(undefined, one.signal, two.signal);
  const unrelated = linkNativeAbortSignals();
  two.abort('second');
  assert.throws(() => throwIfNativeAborted(linked), error => error === 'second');
  assert.equal(isNativeAborted(unrelated), false);
});

for (const key of ['aborted', 'reason']) {
  test(`live overridden ${key} state is rejected without invoking it`, () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, key, { get() { assert.fail('source accessor ran'); } });
    assert.throws(() => linkNativeAbortSignals(controller.signal), TypeError);
  });
}
