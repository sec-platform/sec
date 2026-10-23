import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';

import { createLogger } from '../../../src/adapters/diagnostics/json-logger.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import type { LogLevel } from '../../../src/contracts/logging.ts';

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

  // JSONL consumers observe line framing, not stdout.write call boundaries.
  const output = chunks.join('');
  expect(output.endsWith('\n')).toBe(true);
  const records = output.slice(0, -1).split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(records).toHaveLength(2);
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

test('a filtered-out message is still lazy and does not read its metadata', () => {
  let reads = 0;
  const data = { get value() { reads += 1; throw new Error('must not read'); } };
  const logger = createLogger({ level: 'error' });
  assert.doesNotThrow(() => logger.debug({} as never, data));
  assert.equal(reads, 0);
});

test('logger validates configuration and rejects messages before hooks or metadata access', () => {
  assert.throws(() => createLogger({ level: 'INFO' as LogLevel }),
    (error: unknown) => error instanceof CodedFailure && error.code === 'LOGGING-CONFIG-001');
  let hooks = 0;
  let metadataReads = 0;
  const message = {
    toJSON() { hooks += 1; return 'forged'; },
    toString() { hooks += 1; return 'forged'; },
    [Symbol.toPrimitive]() { hooks += 1; return 'forged'; }
  };
  const data = { get value() { metadataReads += 1; return 'metadata'; } };
  const logger = createLogger({ level: 'debug' });
  assert.throws(() => logger.error(message as never, data),
    (error: unknown) => (error as { code: string }).code === 'LOGGING-RECORD-001');
  assert.equal(hooks, 0);
  assert.equal(metadataReads, 0);
});
