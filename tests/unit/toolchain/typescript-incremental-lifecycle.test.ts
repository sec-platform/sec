import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectNoFollowDirectoryChain } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { prepareTypeScriptIncrementalState, type PrepareTypeScriptIncrementalStateInput } from '../../../src/adapters/toolchain/typescript/incremental-state.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

// Repository execution requires the real physical owner. Local adapter replay
// of this file is only control-flow evidence and cannot certify retained IO.
const binding=`sha256:${'a'.repeat(64)}` as const;
async function fixture(run:(input:PrepareTypeScriptIncrementalStateInput)=>Promise<void>) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sec-ts-incremental-lifecycle-'));
  await settleWorkspaceCallback(async()=>{
    const seed=path.join(root,'seed'),actions=path.join(root,'actions');
    await fs.mkdir(seed);await fs.mkdir(actions);
    await run({actionPrivateParent:inspectNoFollowDirectoryChain(actions).target,
      stableSeedParent:inspectNoFollowDirectoryChain(seed).target,seedBindingDigest:binding,
      deadlineAtUnixMs:Date.now()+30000,stableSeedFile:path.join(seed,'seed.json')});
  },()=>fs.rm(root,{recursive:true,force:true}));
}

test('cancellation preserves private residue when retirement cannot be admitted',()=>fixture(async input=>{
  const controller=new AbortController();
  const session=await prepareTypeScriptIncrementalState({...input,signal:controller.signal});
  controller.abort();
  await fs.writeFile(session.executionBuildInfoFile,'output');
  assert.deepEqual(await session.publish(),{status:'cache-unavailable'});
  const closing=session.dispose();
  await assert.rejects(closing);await assert.rejects(session.dispose());
  assert.throws(()=>session.auxiliaryDirectory.assertCurrent());
  assert.equal((await fs.stat(path.dirname(session.executionBuildInfoFile))).isDirectory(),true);
  assert.deepEqual(await session.publish(),{status:'cache-unavailable'});
}));

test('native aborted state cannot be masked by a shadow public getter',()=>fixture(async input=>{
  const controller=new AbortController();controller.abort();
  Object.defineProperty(controller.signal,'aborted',{get(){assert.fail('shadow state getter');}});
  await assert.rejects(prepareTypeScriptIncrementalState({...input,signal:controller.signal}),/cancelled/);
  assert.deepEqual(await fs.readdir(input.actionPrivateParent.path),[]);
  await assert.rejects(fs.stat(input.stableSeedFile),{code:'ENOENT'});
}));

test('healthy cleanup is shared and publish cannot start after cleanup is selected',()=>fixture(async input=>{
  const session=await prepareTypeScriptIncrementalState(input);
  const first=session.dispose(),second=session.dispose();
  assert.deepEqual(await session.publish(),{status:'cache-unavailable'});
  const [firstReceipt,secondReceipt]=await Promise.all([first,second]);
  assert.equal(firstReceipt.tree.status,'physically-absent');
  assert.deepEqual(secondReceipt,firstReceipt);
  assert.deepEqual(await session.dispose(),firstReceipt);
}));
