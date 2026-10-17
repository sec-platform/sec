import { expect, test } from 'bun:test';

import { createLogger } from '../../src/adapters/diagnostics/json-logger.ts';

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
