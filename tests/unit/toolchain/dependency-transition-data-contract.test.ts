import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { hasExactObjectKeys } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts';

test('field identity is a set, not a delimiter-joined string',()=>{
 assert.equal(hasExactObjectKeys({'a\0b':1},['a','b']),false);
});
test('field ordering has no effect on exact structural acceptance',()=>{
 for(const v of [{a:1,b:2},{b:2,a:1}])for(const k of [['a','b'],['b','a']])assert.equal(hasExactObjectKeys(v,k),true);
});
for(const value of [null,[],0])test('nonordinary object is not a record',()=>assert.equal(hasExactObjectKeys(value,['a']),false));
