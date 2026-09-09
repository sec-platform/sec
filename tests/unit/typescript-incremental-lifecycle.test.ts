import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { prepareTypeScriptIncrementalState, type PrepareTypeScriptIncrementalStateInput } from '../../src/toolchain/typescript/incremental-state.ts';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';

// Repository execution requires the real physical owner. Local adapter replay
// of this file is only control-flow evidence and cannot certify retained IO.
const binding=`sha256:${'a'.repeat(64)}` as const;
type Mutable<T> = {-readonly [Key in keyof T]: T[Key]};
async function fixture(run:(input:Mutable<PrepareTypeScriptIncrementalStateInput>,root:string)=>Promise<void>) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sec-ts-incremental-lifecycle-'));
  await settleWorkspaceCallback(async()=>{
    const seed=path.join(root,'seed'),actions=path.join(root,'actions');
    await fs.mkdir(seed);await fs.mkdir(actions);
    await run({actionPrivateParent:{...inspectNoFollowDirectoryChain(actions).target},
      stableSeedParent:{...inspectNoFollowDirectoryChain(seed).target},seedBindingDigest:binding,
      deadlineAtUnixMs:Date.now()+30000,stableSeedFile:path.join(seed,'seed.json')},root);
  },()=>fs.rm(root,{recursive:true,force:true}));
}

test('a live incremental attempt keeps its original seed binding through publication',()=>fixture(async input=>{
  const session=await prepareTypeScriptIncrementalState(input);
  await settleWorkspaceCallback(async()=>{
    input.seedBindingDigest=`sha256:${'b'.repeat(64)}`;
    await fs.writeFile(session.executionBuildInfoFile,'output');
    assert.deepEqual(await session.publish(),{status:'published'});
    assert.equal(JSON.parse(await fs.readFile(input.stableSeedFile,'utf8')).bindingDigest,binding);
  },async()=>{await session.dispose();});
}));

test('a mutable parent observation cannot redirect publication to another physical directory',()=>fixture(async(input,root)=>{
  const seedFile=input.stableSeedFile,session=await prepareTypeScriptIncrementalState(input);
  await settleWorkspaceCallback(async()=>{
    const foreign=path.join(root,'foreign');await fs.mkdir(foreign);
    Object.assign(input.stableSeedParent,inspectNoFollowDirectoryChain(foreign).target);
    await fs.writeFile(session.executionBuildInfoFile,'output');
    assert.deepEqual(await session.publish(),{status:'published'});
    assert.equal(JSON.parse(await fs.readFile(seedFile,'utf8')).bindingDigest,binding);
    assert.deepEqual(await fs.readdir(foreign),[]);
  },async()=>{await session.dispose();});
}));

test('a caller edit cannot shorten the captured deadline of an already admitted attempt',()=>fixture(async input=>{
  const session=await prepareTypeScriptIncrementalState(input);
  input.deadlineAtUnixMs=0;
  await settleWorkspaceCallback(async()=>{
    await fs.writeFile(session.executionBuildInfoFile,'output');
    assert.deepEqual(await session.publish(),{status:'published'});
  },async()=>{await session.dispose();});
}));

test('replacement of the signal field does not detach an attempt from its original cancellation',()=>fixture(async input=>{
  const controller=new AbortController();input.signal=controller.signal;
  const session=await prepareTypeScriptIncrementalState(input);
  input.signal=new AbortController().signal;controller.abort();
  await fs.writeFile(session.executionBuildInfoFile,'output');
  assert.deepEqual(await session.publish(),{status:'cache-unavailable'});
  const closing=session.dispose();
  await assert.rejects(closing);assert.equal(session.dispose(),closing);
  assert.throws(()=>session.auxiliaryDirectory.assertCurrent());
}));

test('cancelled cleanup closes the owned directory handle but does not invent retirement authority',()=>fixture(async input=>{
  const controller=new AbortController();input.signal=controller.signal;
  const session=await prepareTypeScriptIncrementalState(input);controller.abort();
  await assert.rejects(session.dispose());
  assert.throws(()=>session.auxiliaryDirectory.assertCurrent());
  assert.equal((await fs.stat(path.dirname(session.executionBuildInfoFile))).isDirectory(),true);
  assert.deepEqual(await session.publish(),{status:'cache-unavailable'});
}));

test('cleanup keeps the original action parent even if the caller mutates its identity record',()=>fixture(async(input,root)=>{
  const session=await prepareTypeScriptIncrementalState(input);
  const foreign=path.join(root,'other-actions');await fs.mkdir(foreign);
  Object.assign(input.actionPrivateParent,inspectNoFollowDirectoryChain(foreign).target);
  assert.equal((await session.dispose()).tree.status,'physically-absent');
  assert.deepEqual(await fs.readdir(foreign),[]);
}));

test('native aborted state cannot be masked by a shadow public getter',()=>fixture(async input=>{
  const controller=new AbortController();controller.abort();
  Object.defineProperty(controller.signal,'aborted',{get(){assert.fail('shadow state getter');}});
  input.signal=controller.signal;
  await assert.rejects(prepareTypeScriptIncrementalState(input),/cancelled/);
  assert.deepEqual(await fs.readdir(input.actionPrivateParent.path),[]);
}));

test('false structural signals reject before creating any private resources',()=>fixture(async input=>{
  for(const signal of [null,{},false,{aborted:false}]) {
    await assert.rejects(prepareTypeScriptIncrementalState({...input,signal:signal as never}),TypeError);
  }
  assert.deepEqual(await fs.readdir(input.actionPrivateParent.path),[]);
}));

test('seed-binding objects cannot acquire identity through conversion side effects',()=>fixture(async input=>{
  let converted=false;
  await assert.rejects(prepareTypeScriptIncrementalState({...input,seedBindingDigest:{toString(){converted=true;return binding;}} as never}));
  assert.equal(converted,false);assert.deepEqual(await fs.readdir(input.actionPrivateParent.path),[]);
}));

test('declared input fields are read once, unrelated getters are not traversed',()=>fixture(async input=>{
  const counts=new Map<string,number>(),request:Record<string,unknown>={};
  for(const [key,value] of Object.entries(input))Object.defineProperty(request,key,{get(){counts.set(key,(counts.get(key)??0)+1);return value;}});
  Object.defineProperty(request,'unrelated',{enumerable:true,get(){assert.fail('unrelated option read');}});
  const session=await prepareTypeScriptIncrementalState(request as unknown as PrepareTypeScriptIncrementalStateInput);
  await session.dispose();
  assert.ok([...counts.values()].every(value=>value===1));
}));

test('healthy cleanup is shared and publish cannot start after cleanup is selected',()=>fixture(async input=>{
  const session=await prepareTypeScriptIncrementalState(input);
  const first=session.dispose(),second=session.dispose();assert.equal(first,second);
  assert.deepEqual(await session.publish(),{status:'cache-unavailable'});
  assert.equal((await first).tree.status,'physically-absent');
  assert.equal(await session.dispose(),await first);
}));
