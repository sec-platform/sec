import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { getErrorCode as compilerCode, CompilerError, inspectFailureValue as compilerInspect } from '../../src/compiler/errors.ts';
import { failureMessage, getErrorCode, inspectFailureValue } from '../../src/contracts/failure-inspection.ts';

test('compiler consumers retain the exact shared inspection functions', () => {
  assert.equal(compilerCode, getErrorCode);
  assert.equal(compilerInspect, inspectFailureValue);
});

for (const reason of [undefined, null, false, 0, 7n, Symbol('failure'), 'text']) {
  test(`primitive ${String(reason)} has a diagnostic without losing its value`, () => {
    assert.equal(failureMessage(reason), String(reason));
    assert.equal(getErrorCode(reason), undefined);
  });
}

test('ordinary and typed errors retain message and code across the shared inspection boundary', () => {
  const ordinary = new Error('ordinary'), typed = new CompilerError('OWNER-001', 'typed', { path: 'a' });
  assert.equal(failureMessage(ordinary), 'ordinary'); assert.equal(failureMessage(typed), 'typed');
  assert.equal(getErrorCode(typed), 'OWNER-001');
});

test('diagnostic projection invokes neither object conversion, custom inspect nor unrelated getters', () => {
  let calls = 0;
  const value = { toString() { calls++; throw new Error('conversion'); },
    get content() { calls++; throw new Error('getter'); }, [inspect.custom]() { calls++; throw new Error('inspect'); } };
  assert.equal(typeof failureMessage(value), 'string'); assert.equal(typeof inspectFailureValue(value), 'string');
  assert.equal(calls, 0);
});

test('revoked proxy and broken Error.message remain describable', () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.equal(typeof failureMessage(proxy), 'string'); assert.equal(getErrorCode(proxy), undefined);
  const error = new Error('hidden');
  Object.defineProperty(error, 'message', { get() { throw new Error('getter failed'); } });
  assert.equal(typeof failureMessage(error), 'string');
});

test('error codes read once, reject nonstrings, and do not throw through the projection', () => {
  let reads = 0;
  assert.equal(getErrorCode({ get code() { reads++; return 'E-CODE'; } }), 'E-CODE'); assert.equal(reads, 1);
  for (const code of [null, 0, {}, Symbol('code')]) assert.equal(getErrorCode({ code }), undefined);
  assert.equal(getErrorCode({ get code() { throw undefined; } }), undefined);
});
