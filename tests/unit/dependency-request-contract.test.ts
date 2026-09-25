import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureRuntimeDependencyInstallRequest, isRuntimeDependencyInstallMode, RUNTIME_DEPENDENCY_INSTALL_MODES } from '../../src/adapters/toolchain/dependencies/contract/install-request.ts';

for(const mode of RUNTIME_DEPENDENCY_INSTALL_MODES)test(`request retains supported ${mode} without interpretation`,()=>{
 const result=captureRuntimeDependencyInstallRequest({installMode:mode});assert.equal(result.installMode,mode);assert.ok(isRuntimeDependencyInstallMode(mode));
});
for(const mode of [null,false,0,'', 'offline',{},[]])test(`request rejects invalid mode ${JSON.stringify(mode)}`,()=>{
 assert.equal(isRuntimeDependencyInstallMode(mode),false);assert.throws(()=>captureRuntimeDependencyInstallRequest({installMode:mode as never}));
});
for(const field of ['rematerialize'] as const)for(const v of [null,'false',0,1,{}])test(`${field} refuses nonboolean ${JSON.stringify(v)}`,()=>{
 assert.throws(()=>captureRuntimeDependencyInstallRequest({[field]:v} as never));
});
test('public input is selected without enumerating internal fields',()=>{
 const input=new Proxy({rematerialize:false,get monotonicNowMs(){assert.fail('internal clock'); throw new Error('unreachable');},get generatedStateLifecycle(){assert.fail('lifecycle'); throw new Error('unreachable');},get runtimeStateEnvironment(){assert.fail('runtime state environment'); throw new Error('unreachable');}}, {ownKeys(){assert.fail('enumeration');}});
 const r=captureRuntimeDependencyInstallRequest(input);assert.equal(r.rematerialize,false);assert.equal(Object.hasOwn(r,'monotonicNowMs'),false);assert.ok(Object.isFrozen(r));
});
test('each selected public getter is read once and the input remains independently mutable',()=>{
 const reads=new Map<string,number>();const input={};
 for(const [key,value]of Object.entries({beforeCommit:undefined,deadlineAtUnixMs:5000,installMode:'allow',lockTimeoutMs:100,rematerialize:false,signal:undefined}))Object.defineProperty(input,key,{get(){reads.set(key,(reads.get(key)??0)+1);return value;},configurable:true});
 const r=captureRuntimeDependencyInstallRequest(input);assert.equal(reads.size,6);assert.ok([...reads.values()].every(n=>n===1));assert.equal(Object.isFrozen(input),false);
});
test('captured class method keeps private state after method replacement',async()=>{
 class Input{#calls=0;async beforeCommit(){this.#calls++;}get calls(){return this.#calls;}}
 const input=new Input(),r=captureRuntimeDependencyInstallRequest(input);input.beforeCommit=()=>assert.fail('replacement');await r.beforeCommit!();assert.equal(input.calls,1);
});
test('native signal identity and numerical bounds are passed to their original owner unchanged',()=>{
 const signal=new AbortController().signal;const r=captureRuntimeDependencyInstallRequest({signal,deadlineAtUnixMs:1234,lockTimeoutMs:77});assert.equal(r.signal,signal);assert.equal(r.deadlineAtUnixMs,1234);assert.equal(r.lockTimeoutMs,77);
});
for(const v of [null,false,3,'callback'])test(`invalid commit method ${JSON.stringify(v)} is rejected`,()=>assert.throws(()=>captureRuntimeDependencyInstallRequest({beforeCommit:v as never})));
