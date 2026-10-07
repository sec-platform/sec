import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { inspect } from 'node:util';
import { PhysicalNoFollowError } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow-contract.ts';
import { formatFailure } from '../../src/contracts/failure-format.ts';
import { boundedFailureCode } from '../../src/contracts/failure-inspection.ts';
import { CodedFailure } from '../../src/contracts/failure.ts';

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
    new Error(sentinel), {}, [], { code: 3 }, { code: Symbol(sentinel) },
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

test('distinct failure categories survive ordinary message, JSON and failure formatting without raw values', () => {
  const primary = new CodedFailure('RUNTIME-DEPS-001', sentinel, { path: sentinel, environment: sentinel });
  const cleanup = new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', sentinel,
    { cause: new Error(sentinel) });
  Object.defineProperty(primary, 'cause', { get() { assert.fail('raw cause inspected'); } });
  const materializationCode = boundedFailureCode(primary, allowedCodes);
  const cleanupCode = boundedFailureCode(cleanup, allowedCodes);
  const projected = new CodedFailure('IMPORT-AUTHORITY-004',
    `Compiler dependency generation staging residue is preserved for recovery; materialization=${materializationCode}; cleanup=${cleanupCode}`,
    { materializationCode, cleanupCode, recoveryRequired: true });
  assert.deepEqual(projected.details, {
    materializationCode: 'RUNTIME-DEPS-001', cleanupCode: 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', recoveryRequired: true
  });
  assert.equal(Object.hasOwn(projected, 'cause'), false);
  for (const output of [projected.message, String(projected), JSON.stringify(projected), formatFailure(projected)]) {
    assert.ok(output.includes('RUNTIME-DEPS-001'));
    assert.ok(output.includes('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'));
    assert.equal(output.includes(sentinel), false);
  }
});

test('Bun uncaught output preserves categories without traversing raw native causes', () => {
  const inspectionUrl = new URL('../../src/contracts/failure-inspection.ts', import.meta.url).href;
  const failureUrl = new URL('../../src/contracts/failure.ts', import.meta.url).href;
  const script = `
    import { boundedFailureCode } from ${JSON.stringify(inspectionUrl)};
    import { CodedFailure } from ${JSON.stringify(failureUrl)};
    const secret = process.env.SEC_TEST_FAILURE_SENTINEL;
    const primary = new CodedFailure('RUNTIME-DEPS-001', secret, { path: secret, environment: secret });
    const cleanup = Object.assign(new Error(secret, { cause: new Error(secret) }), { code: 'EACCES' });
    Object.defineProperty(primary, 'cause', { get() { throw new Error(secret); } });
    const allowed = new Set(['RUNTIME-DEPS-001', 'EACCES']);
    const materializationCode = boundedFailureCode(primary, allowed);
    const cleanupCode = boundedFailureCode(cleanup, allowed);
    throw new CodedFailure('IMPORT-AUTHORITY-004',
      'Compiler dependency generation staging residue is preserved for recovery; materialization=' + materializationCode + '; cleanup=' + cleanupCode,
      { materializationCode, cleanupCode, recoveryRequired: true });
  `;
  const result = Bun.spawnSync([process.execPath, '-e', script], {
    env: { ...process.env, SEC_TEST_FAILURE_SENTINEL: sentinel }, stdout: 'pipe', stderr: 'pipe'
  });
  assert.notEqual(result.exitCode, 0);
  const output = Buffer.concat([result.stdout, result.stderr]).toString();
  assert.ok(output.includes('materialization=RUNTIME-DEPS-001; cleanup=EACCES'));
  assert.ok(output.includes('IMPORT-AUTHORITY-004'));
  assert.equal(output.includes(sentinel), false);
});
