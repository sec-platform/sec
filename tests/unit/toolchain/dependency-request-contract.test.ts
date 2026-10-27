import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureRuntimeDependencyInstallRequest } from '../../../src/execution/dependency-install-request.ts';

test('public input is selected without enumerating internal fields',()=>{
 const input=new Proxy({rematerialize:false,get monotonicNowMs(){assert.fail('internal clock'); throw new Error('unreachable');},get generatedStateLifecycle(){assert.fail('lifecycle'); throw new Error('unreachable');}}, {ownKeys(){assert.fail('enumeration');}});
 const r=captureRuntimeDependencyInstallRequest(input);assert.equal(r.rematerialize,false);assert.equal(r.installMode,undefined);assert.equal(Object.hasOwn(r,'monotonicNowMs'),false);assert.ok(Object.isFrozen(r));
});
test('selected public values remain captured when getters and the mutable input later change',()=>{
 const signal=new AbortController().signal;
 const expected={beforeCommit:undefined,deadlineAtUnixMs:5000,installMode:'allow',lockTimeoutMs:100,rematerialize:false,signal};
 const later={beforeCommit:()=>undefined,deadlineAtUnixMs:6000,installMode:'offline-copy-only',lockTimeoutMs:200,rematerialize:true,signal:new AbortController().signal};
 const input={};
 for(const [key,value]of Object.entries(expected)){
  let observed=false;
  Object.defineProperty(input,key,{get(){if(observed)return later[key as keyof typeof later];observed=true;return value;},configurable:true});
 }
 const r=captureRuntimeDependencyInstallRequest(input);
 assert.deepEqual(r,expected);assert.equal(r.signal,signal);assert.equal(Object.isFrozen(input),false);
 Object.defineProperty(input,'deadlineAtUnixMs',{value:42,configurable:true});
 assert.equal(r.deadlineAtUnixMs,5000);
});
