import { expect, test } from 'bun:test';

import { PhysicalNoFollowError } from './physical-no-follow-contract.ts';

test('physical no-follow error remains a pure typed failure value', () => {
  const nativeFailure = Object.freeze({
    namespace: 'win32' as const,
    code: 5,
    failureClass: 'access-denied' as const
  });
  const error = new PhysicalNoFollowError(
    'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
    'unsafe',
    { nativeFailure }
  );
  expect(error.name).toBe('PhysicalNoFollowError');
  expect(error.code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
  expect(error.nativeFailure).toBe(nativeFailure);
});
