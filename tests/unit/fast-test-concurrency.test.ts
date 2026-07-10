import { expect, test } from 'bun:test';

import {
  DEFAULT_FAST_TEST_MAX_CONCURRENCY,
  applyDefaultFastTestConcurrency
} from '../../platform/dev-runner/test-concurrency-policy.ts';

test('concurrent tests receive the default concurrency budget', () => {
  const args = applyDefaultFastTestConcurrency('bun', [
    'test',
    '--concurrent',
    'tests/unit/example.test.ts'
  ]);

  expect(args).toEqual([
    'test',
    '--concurrent',
    '--max-concurrency',
    String(DEFAULT_FAST_TEST_MAX_CONCURRENCY),
    'tests/unit/example.test.ts'
  ]);
});

test('explicit concurrency budget is preserved', () => {
  const args = applyDefaultFastTestConcurrency('bun', [
    'test',
    '--concurrent',
    '--max-concurrency=2',
    'tests/unit/example.test.ts'
  ]);

  expect(args).toEqual([
    'test',
    '--concurrent',
    '--max-concurrency=2',
    'tests/unit/example.test.ts'
  ]);
});
