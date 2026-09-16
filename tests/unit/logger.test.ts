import { expect, test } from 'bun:test';

import {
  buildJsonLogRecord,
  createLogger,
  resolveLogLevel
} from '../../src/system-architecture/foundation/logger.ts';

test('log-level admission accepts only the exact canonical vocabulary', () => {
  expect(resolveLogLevel(undefined)).toBe('info');
  expect(resolveLogLevel(undefined, 'warn')).toBe('warn');
  expect(resolveLogLevel('debug')).toBe('debug');
  expect(resolveLogLevel('info')).toBe('info');
  expect(resolveLogLevel('warn')).toBe('warn');
  expect(resolveLogLevel('error')).toBe('error');

  expect(() => resolveLogLevel('verbose')).toThrow(/LOG_LEVEL must be one of/);
  expect(() => resolveLogLevel(' INFO ')).toThrow(/LOG_LEVEL must be one of/);
});

test('JSON log records preserve canonical fields against metadata collisions', () => {
  const record = buildJsonLogRecord('warn', 'canonical-message', {
    level: 999,
    time: 0,
    msg: 'forged-message',
    traceId: 'trace-1'
  }, 1234);

  expect(record).toEqual({
    traceId: 'trace-1',
    level: 30,
    time: 1234,
    msg: 'canonical-message'
  });
  expect(Object.getPrototypeOf(record)).toBeNull();
  expect(Object.isFrozen(record)).toBe(true);
});

test('non-record log data remains explicit and invalid timestamps fail closed', () => {
  expect(buildJsonLogRecord('info', 'value', ['a'], 1)).toEqual({
    data: ['a'],
    level: 20,
    time: 1,
    msg: 'value'
  });
  expect(() => buildJsonLogRecord('info', 'invalid', undefined, -1))
    .toThrow(/non-negative safe Unix millisecond integer/);
});

test.serial('logger threshold emits exactly the admitted JSONL records', () => {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;

  try {
    const logger = createLogger({ level: 'warn' });
    logger.debug('debug-hidden');
    logger.info('info-hidden');
    logger.warn('warn-visible', { operation: 'compose' });
    logger.error('error-visible', 'failure');
  } finally {
    process.stdout.write = originalWrite;
  }

  expect(chunks).toHaveLength(2);
  const records = chunks.map((chunk) => JSON.parse(chunk) as Record<string, unknown>);
  expect(records[0]).toMatchObject({
    level: 30,
    msg: 'warn-visible',
    operation: 'compose'
  });
  expect(records[1]).toMatchObject({
    level: 40,
    msg: 'error-visible',
    data: 'failure'
  });
});
