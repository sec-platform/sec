import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildErrorProtocol } from '../../../src/application/error-protocol.ts';

test('unknown thrown values always have a string diagnostic code and message', () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const throwingCode = { get code() { throw new Error('code'); } };
  for (const value of [null, 'failure', () => undefined, revoked.proxy, throwingCode]) {
    const result = buildErrorProtocol(value);
    assert.equal(result.code, 'UNEXPECTED'); assert.equal(result.message, 'Unexpected failure');
    assert.equal(result.recoverable, false); assert.equal(result.issueType, 'kernel');
  }
});

test('message text cannot manufacture usage authority and non-string messages remain bounded', () => {
  assert.equal(buildErrorProtocol({ message: 'Usage: sec verify' }).issueType, 'kernel');
  const message = { toString() { assert.fail('coercion'); } };
  assert.equal(buildErrorProtocol({ code: 'CLI-USAGE-001', message }).message, 'Unexpected failure');
});

test('throwing input getters cannot mask the original known failure code', () => {
  const value = buildErrorProtocol({ code: 'VERIFY-BLOCKED-001',
    get message() { throw new Error('message'); }, get details() { throw new Error('details'); } });
  assert.equal(value.code, 'VERIFY-BLOCKED-001'); assert.equal(value.issueType, 'composition');
  assert.equal(value.message, 'Unexpected failure'); assert.equal(value.details, undefined);
});

test('owned error fields are sampled only once and unrelated fields are not enumerated', () => {
  const reads: Record<string, number> = {};
  const detail = { cause: 'original' };
  const input = new Proxy({ code: 'REPAIR-BLOCKED-001', message: 'repair', details: detail }, {
    ownKeys() { assert.fail('whole failure enumerated'); },
    get(target, key) { reads[String(key)] = (reads[String(key)] ?? 0) + 1; return Reflect.get(target, key); }
  });
  const value = buildErrorProtocol(input);
  assert.deepEqual(reads, { code: 1, message: 1, details: 1 });
  assert.equal(value.details, detail);
});
