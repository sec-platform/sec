import { expect, test } from 'bun:test';

import { FailureError } from './failure.ts';

test('FailureError preserves one typed runtime identity and native cause', () => {
  const cause = new Error('physical failure');
  const error = new FailureError(
    'FOUNDATION-TEST-001',
    'foundation failure',
    { phase: 'readback' },
    { cause }
  );

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(FailureError);
  expect(error).toMatchObject({
    name: 'SecError',
    code: 'FOUNDATION-TEST-001',
    message: 'foundation failure',
    details: { phase: 'readback' },
    cause
  });
});
