import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { LOG_LEVELS, buildJsonLogRecord, resolveLogLevel, type LogLevel } from '../../../src/contracts/logging.ts';

const invalidLevel = (error: unknown): boolean =>
  error instanceof CodedFailure && error.code === 'LOGGING-CONFIG-001';

test('JSON serialization cannot invoke a metadata hook to replace canonical log fields', () => {
  let calls = 0;
  const record = buildJsonLogRecord('warn', 'original', {
    toJSON() { calls++; return { level: 10, time: 0, msg: 'forged' }; },
    level: 10, time: 0, msg: 'forged', operation: 'probe'
  }, 123);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), {
    operation: 'probe', level: 30, time: 123, msg: 'original'
  });
  assert.equal(calls, 0);
  assert.equal(Object.hasOwn(record, 'toJSON'), false);
});

test('reserved log metadata getters are ignored before any property read', () => {
  let calls = 0;
  const metadata = Object.create(null) as Record<string, unknown>;
  for (const key of ['level', 'time', 'msg', 'toJSON']) {
    Object.defineProperty(metadata, key, { enumerable: true, get() { calls++; throw new Error(key); } });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(buildJsonLogRecord('info', 'safe', metadata, 0))),
    { level: 20, time: 0, msg: 'safe' });
  assert.equal(calls, 0);
});

test('prototype-looking metadata stays data on a frozen null-prototype record', () => {
  const metadata = JSON.parse('{"__proto__":{"polluted":true},"constructor":"value"}');
  const record = buildJsonLogRecord('error', 'record', metadata, 1);
  assert.equal(Object.getPrototypeOf(record), null);
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(record.__proto__, { polluted: true });
  assert.equal(record.constructor, 'value');
  assert.equal(Object.hasOwn({}, 'polluted'), false);
  assert.equal(JSON.parse(JSON.stringify(record)).level, 40);
});

test('shared log-level validation rejects invalid values at contract entries', () => {
  for (const value of ['', 'INFO', ' INFO ', 'toString', '__proto__', 'verbose', null, 1, {}, []]) {
    // Deliberately emulate untyped JavaScript at the shared domain boundary.
    const untyped = value as LogLevel;
    assert.throws(() => resolveLogLevel(undefined, untyped), invalidLevel);
  }
  assert.throws(() => buildJsonLogRecord('INFO' as LogLevel, 'bad', {}, 1), invalidLevel);
});

test('canonical levels and defaults retain existing meanings', () => {
  assert.equal(Object.isFrozen(LOG_LEVELS), true);
  assert.equal(Reflect.set(LOG_LEVELS, '0', 'trace'), false);
  assert.deepEqual(LOG_LEVELS, ['debug', 'info', 'warn', 'error']);
  assert.equal(resolveLogLevel(undefined), 'info');
  assert.equal(resolveLogLevel(undefined, 'warn'), 'warn');
  assert.equal(resolveLogLevel(undefined, 'debug'), 'debug');
  for (const [level, priority] of [['debug', 10], ['info', 20], ['warn', 30], ['error', 40]] as const) {
    assert.equal(resolveLogLevel(level), level);
    assert.equal(buildJsonLogRecord(level, 'x', undefined, 0).level, priority);
  }
});


test('log records preserve primitive metadata and reject invalid timestamps', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildJsonLogRecord('info', 'value', ['a'], 1))),
    { data: ['a'], level: 20, time: 1, msg: 'value' });
  for (const value of [null, 0, false, '', [1, 2]]) {
    assert.deepEqual(buildJsonLogRecord('info', 'x', value, 0).data, value);
  }
  assert.equal(Object.hasOwn(buildJsonLogRecord('info', 'x', undefined, 0), 'data'), false);
  for (const time of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildJsonLogRecord('info', 'x', {}, time),
      (error: unknown) => error instanceof CodedFailure && error.code === 'LOGGING-RECORD-001');
  }
});

const invalidMessages: ReadonlyArray<readonly [string, unknown]> = [
  ['undefined', undefined], ['null', null], ['number', 1], ['boolean', false],
  ['bigint', 1n], ['symbol', Symbol('message')], ['function', () => {}],
  ['array', []], ['record', {}], ['boxed string', new String('not primitive')]
];
test('all non-string message classes reject without replacing the canonical msg field', () => {
  for (const [name, message] of invalidMessages) {
    assert.throws(() => buildJsonLogRecord('info', message as never, undefined, 0), (error: unknown) => {
      assert.equal((error as { code: string }).code, 'LOGGING-RECORD-001');
      return true;
    }, `message class: ${name}`);
  }
});

test('a revoked proxy message is rejected without reading proxy properties', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.throws(() => buildJsonLogRecord('warn', proxy as never, undefined, 0), (error: unknown) => {
    assert.equal((error as { code: string }).code, 'LOGGING-RECORD-001');
    return true;
  });
});

test('all primitive string message classes preserve exact bytes and reserved-field priority', () => {
  for (const message of ['', 'normal', 'line\nbreak', '\u0000', '中文 😀', '\ud800']) {
    const record = buildJsonLogRecord('info', message, { tag: 'kept', msg: 'forged' }, 123);
    assert.deepEqual(JSON.parse(JSON.stringify(record)), { tag: 'kept', level: 20, time: 123, msg: message }, `message: ${JSON.stringify(message)}`);
  }
});
