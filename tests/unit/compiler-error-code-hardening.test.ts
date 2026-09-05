import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { CompilerError, getErrorCode } from '../../src/compiler/errors.ts';

for (const [label, input] of [
  ['undefined', undefined], ['null', null], ['boolean', true], ['number', 3],
  ['string', 'ENOENT'], ['symbol', Symbol('x')], ['bigint', 1n],
  ['function', () => {}], ['ordinary error', new Error('x')], ['record', {}],
  ['non-string code', { code: 3 }]
] as const) {
  test(`error-code extraction returns undefined for ${label}`, () => {
    assert.equal(getErrorCode(input), undefined);
  });
}

test('preserves native and domain error codes', () => {
  const native = Object.assign(new Error('missing'), { code: 'ENOENT' });
  assert.equal(getErrorCode(native), 'ENOENT');
  assert.equal(getErrorCode(new CompilerError('DOMAIN-001', 'failure')), 'DOMAIN-001');
  assert.equal(getErrorCode({ code: '' }), '');
});

test('preserves inherited codes and captures a successful accessor only once', () => {
  let reads = 0;
  const input = Object.create({ get code() { reads += 1; return 'INHERITED'; } });
  assert.equal(getErrorCode(input), 'INHERITED');
  assert.equal(reads, 1);
});

test('a throwing code getter does not replace the original error', () => {
  const original = new Error('original');
  Object.defineProperty(original, 'code', { get() { throw new Error('secondary'); } });
  assert.equal(getErrorCode(original), undefined);
});

test('a revoked proxy is an unknown code, not a new exception', () => {
  const { proxy, revoke } = Proxy.revocable({ code: 'HIDDEN' }, {}); revoke();
  assert.equal(getErrorCode(proxy), undefined);
});

test('a failing property-read trap is contained', () => {
  const input = new Proxy({}, { get() { throw new Error('secondary'); } });
  assert.equal(getErrorCode(input), undefined);
});

test('does not require a separate property-presence trap to classify a readable code', () => {
  let reads = 0;
  const input = new Proxy({}, {
    has() { throw new Error('presence is not an error-code read'); },
    get(_target, key) { reads += 1; return key === 'code' ? 'READABLE' : undefined; }
  });
  assert.equal(getErrorCode(input), 'READABLE');
  assert.equal(reads, 1);
});

test('non-string code objects are neither coerced nor inspected', () => {
  const value = { toString() { throw new Error('must not run'); } };
  assert.equal(getErrorCode({ code: value }), undefined);
});
