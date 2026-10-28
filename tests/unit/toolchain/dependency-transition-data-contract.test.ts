import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { hasExactObjectKeys } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts';

test('rejects ordinary records with fewer fields than the expected schema',()=>{
 assert.equal(hasExactObjectKeys({'a\0b':1},['a','b']),false);
});
test('nonordinary object is not a record',()=>assert.equal(hasExactObjectKeys(null,['a']),false));
