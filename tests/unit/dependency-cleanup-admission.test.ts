import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanDependencyEnvironment } from '../../src/adapters/toolchain/dependencies/application/dependency-environment.ts';

// Native consumer tests: do not replace Workspace removal or lifecycle owners.
// All possible deletion targets are inside this fixture; the shared target is
// intentionally noncanonical so its owner must reject it without an effect.
async function fixture(run:(root:string,shared:string)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(tmpdir(),'sec-cleanup-admission-'));
 const shared=path.join(root,'foreign-shared');
 try{await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules/keep'),'keep');await fs.writeFile(path.join(root,'.runtime-deps.stamp.json'),'keep');await run(root,shared);}
 finally{await fs.rm(root,{recursive:true,force:true});}
}
test('reject a foreign shared-root plan before removing earlier project targets',async()=>fixture(async(root,shared)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{project:true,shared:true},{sharedDepsRoot:shared}),/Custom shared/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
 assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
}));
test('a string false cannot select project deletion',async()=>fixture(async(root,shared)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{project:'false' as never},{sharedDepsRoot:shared}),/boolean/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
}));
test('force does not authorize foreign shared-root retirement',async()=>fixture(async(root,shared)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{project:true,shared:true,force:true},{sharedDepsRoot:shared}),/Custom shared/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
}));
for (const selection of [{ bunCache: true }, { all: true }] as const) {
 test(`runtime cache cleanup ${Object.keys(selection)[0]} blocks before any deletion`,async()=>fixture(async(root,shared)=>{
  const legacyCache=path.join(shared,'.bun-cache');
  await fs.mkdir(legacyCache,{recursive:true});
  await fs.writeFile(path.join(legacyCache,'keep'),'legacy');
  await assert.rejects(
   cleanDependencyEnvironment(root,selection,{sharedDepsRoot:shared}),
   (error:unknown)=>error instanceof Error
    && 'code' in error
    && error.code==='IMPORT-AUTHORITY-004'
    && error.message.includes('Runtime Cache owner')
  );
  assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
  assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
  assert.equal(await fs.readFile(path.join(legacyCache,'keep'),'utf8'),'legacy');
 }));
}
test('an empty cleanup does not consume an unused environment provider',async()=>fixture(async root=>{
 assert.deepEqual(await cleanDependencyEnvironment(root,{}, {get sharedDepsRoot(): never {assert.fail('unused root'); throw new Error('unreachable');},get generatedStateLifecycle(): never {assert.fail('unused provider'); throw new Error('unreachable');}}),[]);
}));
