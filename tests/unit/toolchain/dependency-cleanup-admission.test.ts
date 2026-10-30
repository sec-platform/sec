import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanDependencyEnvironment } from '../../../src/bootstrap/toolchain/dependency-environment.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

// Exercise the public bootstrap, including its real operation construction.
async function fixture(run:(root:string)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(tmpdir(),'sec-cleanup-admission-'));
 return settleWorkspaceCallback(async()=>{
  await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules/keep'),'keep');await fs.writeFile(path.join(root,'.runtime-deps.stamp.json'),'keep');
  await run(root);
 }, () => fs.rm(root,{recursive:true,force:true}));
}
for (const selection of [{ bunCache: true }, { all: true, force: true }] as const) {
 test(`runtime cache cleanup ${Object.keys(selection)[0]} blocks before any deletion`,async()=>fixture(async(root)=>{
  await assert.rejects(
   cleanDependencyEnvironment(root,selection),
   (error:unknown)=>error instanceof Error
    && 'code' in error
    && error.code==='IMPORT-AUTHORITY-004'
    && error.message.includes('Runtime Cache owner')
  );
  assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
  assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
 }));
}
test('an empty cleanup leaves existing project dependencies intact',async()=>fixture(async(root)=>{
 assert.deepEqual(await cleanDependencyEnvironment(root,{}),[]);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
 assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
}));
