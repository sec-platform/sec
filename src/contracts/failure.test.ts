import { expect, test } from 'bun:test';

import { CodedFailure } from './failure.ts';

test('CodedFailure preserves one typed runtime identity and native cause', () => {
  const cause = new Error('physical failure');
  const error = new CodedFailure(
    'FOUNDATION-TEST-001',
    'foundation failure',
    { phase: 'readback' },
    { cause }
  );

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(CodedFailure);
  expect(error).toMatchObject({
    name: 'CodedFailure',
    code: 'FOUNDATION-TEST-001',
    message: 'foundation failure',
    details: { phase: 'readback' },
    cause
  });
});
