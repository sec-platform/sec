import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildErrorProtocol } from '../../src/bootstrap/engineering/error-protocol.ts';

test('unknown thrown values always have a string diagnostic code and message', () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [null, undefined, false, 0, 'failure', 1n, Symbol('failure'), () => undefined, revoked.proxy]) {
    const result = buildErrorProtocol(value);
    assert.equal(result.code, 'UNEXPECTED'); assert.equal(result.message, 'Unexpected failure');
    assert.equal(result.recoverable, false); assert.equal(result.issueType, 'kernel');
  }
});

test('non-string codes are not interpreted through coercion or user startsWith methods', () => {
  for (const code of [null, false, 0, {}, [], new String('CLI-USAGE-001'), Symbol('failure')]) {
    assert.equal(buildErrorProtocol({ code }).code, 'UNEXPECTED');
  }
  const code = { startsWith() { assert.fail('custom classification'); }, [Symbol.toPrimitive]() { assert.fail('coercion'); } };
  assert.equal(buildErrorProtocol({ code }).code, 'UNEXPECTED');
});

test('message text cannot manufacture usage authority and non-string messages remain bounded', () => {
  assert.equal(buildErrorProtocol({ message: 'Usage: sec verify' }).issueType, 'kernel');
  const message = { toString() { assert.fail('coercion'); } };
  assert.equal(buildErrorProtocol({ code: 'CLI-USAGE-001', message }).message, 'Unexpected failure');
});

test('throwing input getters cannot mask the original known failure code', () => {
  assert.doesNotThrow(() => buildErrorProtocol({ get code() { throw new Error('code'); } }));
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

test('one caller cannot poison later action and artifact projections', () => {
  for (const code of ['VERIFY-BLOCKED-001', 'VERIFY-POLICY-001', 'REPAIR-BLOCKED-002', 'UPGRADE-MIGRATION-001', 'UNEXPECTED', 'OTHER']) {
    const original = buildErrorProtocol({ code, message: 'original' });
    const expected = { ...original, suggestedActions: [...original.suggestedActions], artifactPaths: [...original.artifactPaths] };
    original.suggestedActions.splice(0, original.suggestedActions.length, 'poisoned');
    original.artifactPaths.push('foreign-path');
    assert.deepEqual(buildErrorProtocol({ code, message: 'original' }), expected);
  }
});

test('unsupported detail representations are preserved for the presentation boundary', () => {
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  for (const details of [cycle, 1n, Symbol('detail'), () => undefined]) {
    const result = buildErrorProtocol({ code: 'REPAIR-BLOCKED-001', message: 'repair', details });
    assert.equal(result.details, details);
  }
});

test('existing specific-prefix priority remains distinct from broad fallback rules', () => {
  assert.deepEqual(buildErrorProtocol({ code: 'UPGRADE-NOOP-001' }).suggestedActions, ['choose-different-upgrade-target']);
  assert.deepEqual(buildErrorProtocol({ code: 'REPAIR-BLOCKED-002' }).suggestedActions, ['run-platform-verify', 'retry-platform-repair-dry-run']);
  assert.equal(buildErrorProtocol({ code: 'PIPELINE-USAGE-001' }).issueType, 'usage');
  assert.equal(buildErrorProtocol({ code: 'PIPELINE-INTERNAL-001' }).issueType, 'kernel');
});
