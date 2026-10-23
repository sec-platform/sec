import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { inspect } from 'node:util';
import { PhysicalNoFollowError } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow-contract.ts';
import { boundedFailureCode } from '../../../src/contracts/failure-inspection.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

const allowedCodes = new Set([
  'IMPORT-AUTHORITY-002', 'RUNTIME-DEPS-001', 'RUNTIME-DEPS-003',
  'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'ENOENT', 'ENOSPC', 'EACCES'
]);
const sentinel = 'private-dependency-stage-secret-7da130';

test('bounded projection retains independently expected SEC, physical and native categories', () => {
  const inputs = [
    [new CodedFailure('IMPORT-AUTHORITY-002', sentinel), 'IMPORT-AUTHORITY-002'],
    [new CodedFailure('RUNTIME-DEPS-001', sentinel, { environment: sentinel }), 'RUNTIME-DEPS-001'],
    [new CodedFailure('RUNTIME-DEPS-003', sentinel), 'RUNTIME-DEPS-003'],
    [new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', sentinel,
      { cause: new Error(sentinel) }), 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'],
    [Object.assign(new Error(sentinel), { code: 'ENOSPC', path: sentinel }), 'ENOSPC'],
    [Object.assign(new Error(sentinel), { code: 'EACCES' }), 'EACCES']
  ] as const;
  for (const [error, expected] of inputs) assert.equal(boundedFailureCode(error, allowedCodes), expected);

  let native: unknown;
  try { lstatSync(new URL(`./${sentinel}/missing`, import.meta.url)); } catch (error) { native = error; }
  assert.equal(boundedFailureCode(native, allowedCodes), 'ENOENT');
});

test('unknown, non-error and unapproved lookalike codes never become free-form output', () => {
  for (const error of [undefined, null, false, 0, 7n, Symbol(sentinel), sentinel,
    new Error(sentinel), { code: 3 }, { code: Symbol(sentinel) },
    { code: `RUNTIME-DEPS-${sentinel}` }, { code: `PHYSICAL_NO_FOLLOW_${sentinel}` },
    { code: `EACCES${sentinel}` }, { code: 'EUNRECOGNIZED' },
    Object.assign(() => undefined, { code: 'ENOENT' }), Object.create({ code: 'ENOENT' })]) {
    assert.equal(boundedFailureCode(error, allowedCodes), 'UNKNOWN');
  }
  assert.equal(boundedFailureCode(Object.assign(Object.create(null), { code: 'ENOENT' }), allowedCodes), 'ENOENT');
});

test('neither own or inherited getters, conversion, inspection nor Proxy traps execute', () => {
  let calls = 0;
  const malicious = () => { calls++; throw new Error(sentinel); };
  const error = Object.create(Object.defineProperty({}, 'code', { get: malicious }));
  for (const field of ['message', 'details', 'cause', 'name', 'stack', 'path']) {
    Object.defineProperty(error, field, { get: malicious });
  }
  error.toString = malicious;
  error[inspect.custom] = malicious;
  assert.equal(boundedFailureCode(error, allowedCodes), 'UNKNOWN');
  Object.defineProperty(error, 'code', { get: malicious });
  assert.equal(boundedFailureCode(error, allowedCodes), 'UNKNOWN');
  const proxy = new Proxy({}, { get: malicious, getPrototypeOf: malicious,
    getOwnPropertyDescriptor: malicious, ownKeys: malicious });
  assert.equal(boundedFailureCode(proxy, allowedCodes), 'UNKNOWN');
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(boundedFailureCode(revoked.proxy, allowedCodes), 'UNKNOWN');
  assert.equal(calls, 0);
});
