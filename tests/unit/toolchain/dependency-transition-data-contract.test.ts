import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { hasExactObjectKeys } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts';

test('exact transition record keys accept true schemas but reject packed or non-record input', () => {
  const packed = { 'a\0b': 1 };
  // A pure reject-all implementation must not satisfy the negative examples.
  assert.equal(hasExactObjectKeys({ a: 1, b: 2 }, ['a', 'b']), true);
  assert.equal(hasExactObjectKeys(packed, ['a\0b']), true);
  assert.equal(hasExactObjectKeys(packed, ['a', 'b']), false);
  assert.equal(hasExactObjectKeys(null, ['a']), false);
  assert.equal(hasExactObjectKeys([], []), false);
});
