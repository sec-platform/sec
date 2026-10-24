import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { LOG_LEVELS, buildJsonLogRecord, resolveLogLevel } from '../../../src/contracts/logging.ts';

const invalidLevel = (error: unknown): boolean =>
  error instanceof CodedFailure && error.code === 'LOGGING-CONFIG-001';

test('ambient log-level text rejects unsupported spellings', () => {
  for (const value of ['', 'INFO', ' INFO ', 'toString', '__proto__', 'verbose']) {
    assert.throws(() => resolveLogLevel(value), invalidLevel);
  }
});

test('canonical levels and defaults retain existing meanings', () => {
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
