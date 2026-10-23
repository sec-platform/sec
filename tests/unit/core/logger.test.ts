import { expect, test } from 'bun:test';

import { createLogger } from '../../../src/adapters/diagnostics/json-logger.ts';

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
