import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/adapters/diagnostics/json-logger.ts';
import { FailureError } from '../../src/contracts/failure.ts';
import { LOG_LEVELS, buildJsonLogRecord, resolveLogLevel, type LogLevel } from '../../src/contracts/logging.ts';

const invalidLevel = (error: unknown): boolean =>
  error instanceof FailureError && error.code === 'LOGGING-CONFIG-001';

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

test('every externally callable log-level boundary rejects values outside its exact domain', () => {
  for (const value of ['', 'INFO', 'toString', '__proto__', 'verbose', null, 1, {}, []]) {
    // Deliberately emulate untyped JavaScript at each typed public boundary.
    const untyped = value as LogLevel;
    assert.throws(() => resolveLogLevel(undefined, untyped), invalidLevel);
    assert.throws(() => createLogger({ level: untyped }), invalidLevel);
    assert.throws(() => buildJsonLogRecord(untyped, 'bad', {}, 1), invalidLevel);
  }
});

test('canonical levels and defaults retain existing meanings', () => {
  assert.equal(resolveLogLevel(undefined), 'info');
  assert.equal(resolveLogLevel(undefined, 'debug'), 'debug');
  for (const [index, level] of LOG_LEVELS.entries()) {
    assert.equal(resolveLogLevel(level), level);
    assert.equal(buildJsonLogRecord(level, 'x', undefined, 0).level, (index + 1) * 10);
    assert.equal(Object.isFrozen(createLogger({ level })), true);
  }
});

test('exported log-level vocabulary cannot drift after its lookup set is built', () => {
  assert.equal(Object.isFrozen(LOG_LEVELS), true);
  assert.equal(Reflect.set(LOG_LEVELS, '0', 'trace'), false);
  assert.equal(LOG_LEVELS[0], 'debug');
});

test('log records preserve primitive metadata and reject invalid timestamps', () => {
  for (const value of [null, 0, false, '', [1, 2]]) {
    assert.deepEqual(buildJsonLogRecord('info', 'x', value, 0).data, value);
  }
  assert.equal(Object.hasOwn(buildJsonLogRecord('info', 'x', undefined, 0), 'data'), false);
  for (const time of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildJsonLogRecord('info', 'x', {}, time),
      (error: unknown) => error instanceof FailureError && error.code === 'LOGGING-RECORD-001');
  }
});
