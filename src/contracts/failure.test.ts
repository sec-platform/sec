import { expect, test } from 'bun:test';

import { SecError } from './failure.ts';

test('SecError preserves one typed runtime identity and native cause', () => {
  const cause = new Error('physical failure');
  const error = new SecError(
    'FOUNDATION-TEST-001',
    'foundation failure',
    { phase: 'readback' },
    { cause }
  );

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(SecError);
  expect(error).toMatchObject({
    name: 'SecError',
    code: 'FOUNDATION-TEST-001',
    message: 'foundation failure',
    details: { phase: 'readback' },
    cause
  });
});
