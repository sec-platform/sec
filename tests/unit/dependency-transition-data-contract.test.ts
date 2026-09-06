import assert from 'node:assert/strict';
import { test } from 'bun:test';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {hasExactObjectKeys,isCanonicalGeneratedStatePhysicalIdentity,transitionSlotFromPhysical,sourceGenerationWithPath} from '../../src/toolchain/dependencies/runtime/dependency-transition/contract.ts';

test('field identity is a set, not a delimiter-joined string',()=>{
 assert.equal(hasExactObjectKeys({'a\0b':1},['a','b']),false);
 assert.equal(hasExactObjectKeys({a:1,b:2},['a','b']),true);
 assert.equal(hasExactObjectKeys({'a\0b':1},['a\0b']),true);
 assert.equal(hasExactObjectKeys({a:1},['a','a']),false);
});
test('field ordering has no effect on exact structural acceptance',()=>{
 for(const v of [{a:1,b:2},{b:2,a:1}])for(const k of [['a','b'],['b','a']])assert.equal(hasExactObjectKeys(v,k),true);
});
test('hidden and symbol state cannot pass a persisted JSON contract',()=>{
 const hidden=Object.defineProperty({a:1},'extra',{value:2});assert.equal(hasExactObjectKeys(hidden,['a']),false);
 assert.equal(hasExactObjectKeys({a:1,[Symbol('extra')]:2},['a']),false);
 assert.equal(hasExactObjectKeys(Object.defineProperty({},'a',{value:1}),['a']),false);
});
test('accessors are rejected without executing code',()=>{
 const value={get a(){assert.fail('accessor');}};assert.equal(hasExactObjectKeys(value,['a']),false);
 const physical={get device(){assert.fail('device');},inode:'i',objectId:'o'};assert.equal(isCanonicalGeneratedStatePhysicalIdentity(physical),false);
});
for(const value of [null,undefined,[],0,'object',Object.create(null),Object.create({a:1})])test('nonordinary object is not a record',()=>assert.equal(hasExactObjectKeys(value,['a']),false));
test('revoked or failing proxies produce false rather than replacing validation failure',()=>{
 const {proxy,revoke}=Proxy.revocable({},{});revoke();assert.equal(hasExactObjectKeys(proxy,[]),false);
 assert.equal(hasExactObjectKeys(new Proxy({},{ownKeys(){throw Error('trap');}}),[]),false);
});
test('slot construction owns the physical identity rather than sharing caller state',()=>{
 const physical={device:'d',inode:'before',objectId:'o'};
 const slot=transitionSlotFromPhysical({path:path.join(tmpdir(),'slot'),kind:'directory',physical});physical.inode='after';
 assert.equal(slot.physical!.inode,'before');assert.ok(Object.isFrozen(slot.physical));assert.equal(Object.isFrozen(physical),false);
});
test('slot paths bind to the pre-getter working directory',()=>{
 const cwd=process.cwd(),origin=path.resolve('slot');try{
  const value={get path(){process.chdir(tmpdir());return 'slot';},kind:'directory' as const,physical:{device:'d',inode:'i',objectId:'o'}};
  assert.equal(transitionSlotFromPhysical(value).path,origin);
 }finally{process.chdir(cwd);}
});
test('path projection separates physical values without changing the source epoch',()=>{
 const source={schema:'sec-runtime-dependency-source-generation-v1',ownerRoot:tmpdir(),ownerRootPhysical:{device:'d',inode:'owner',objectId:'o'},sourcePath:path.join(tmpdir(),'a'),physical:{device:'d',inode:'source',objectId:'s'},bindingDigest:'sha256:a',treeDigest:'sha256:b',treeEntryCount:0,epoch:'sha256:c'};
 const projected=sourceGenerationWithPath(source as never,path.join(tmpdir(),'b'));
 source.physical.inode='changed';source.ownerRootPhysical.inode='changed';
 assert.equal(projected.physical.inode,'source');assert.equal(projected.ownerRootPhysical.inode,'owner');assert.equal(projected.epoch,source.epoch);assert.ok(Object.isFrozen(projected.physical));
});
