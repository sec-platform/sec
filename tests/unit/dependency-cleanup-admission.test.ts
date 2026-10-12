import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { removeDependencyProjectProjection } from '../../src/adapters/toolchain/dependencies/runtime/environment-projection.ts';
import { getDependencyEnvironmentStatus, type DependencyEnvironmentStatus } from '../../src/adapters/toolchain/dependencies/runtime/environment-status.ts';
import { compilerRoot } from '../../src/adapters/workspace-context.ts';
import { cleanDependencyEnvironment, type DependencyEnvironmentOperation } from '../../src/application/dependency-environment.ts';
import { createDependencyOperation } from '../../src/bootstrap/toolchain/dependency-operation.ts';

// Native consumer tests: do not replace Workspace removal or lifecycle owners.
// All possible deletion targets are inside this fixture; the shared target is
// intentionally noncanonical so its owner must reject it without an effect.
async function fixture(run:(root:string,shared:string,operation:DependencyEnvironmentOperation<DependencyEnvironmentStatus>)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(tmpdir(),'sec-cleanup-admission-'));
 const shared=path.join(root,'foreign-shared');
 try{
  await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules/keep'),'keep');await fs.writeFile(path.join(root,'.runtime-deps.stamp.json'),'keep');
  const native = createDependencyOperation({ workspaceRoot: root });
  const operation = Object.freeze({ ...native, compilerRoot, canonicalSharedRoot: path.join(compilerRoot, '.shared-deps'),
   getStatus: (workspaceRoot:string,sharedDepsRoot:string) => getDependencyEnvironmentStatus(workspaceRoot, { sharedDepsRoot }),
   removeProjectProjection: removeDependencyProjectProjection });
  await run(root,shared,operation);
 }
 finally{await fs.rm(root,{recursive:true,force:true});}
}
test('reject a foreign shared-root plan before removing earlier project targets',async()=>fixture(async(root,shared,operation)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{project:true,shared:true},operation,shared),/Custom shared/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
 assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
}));
test('a string false cannot select project deletion',async()=>fixture(async(root,shared,operation)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{project:'false' as never},operation,shared),/boolean/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
}));
test('force does not authorize foreign shared-root retirement',async()=>fixture(async(root,shared,operation)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{project:true,shared:true,force:true},operation,shared),/Custom shared/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
}));
for (const selection of [{ bunCache: true }, { all: true }] as const) {
 test(`runtime cache cleanup ${Object.keys(selection)[0]} blocks before any deletion`,async()=>fixture(async(root,shared,operation)=>{
  const legacyCache=path.join(shared,'.bun-cache');
  await fs.mkdir(legacyCache,{recursive:true});
  await fs.writeFile(path.join(legacyCache,'keep'),'legacy');
  await assert.rejects(
   cleanDependencyEnvironment(root,selection,operation,shared),
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
test('an empty cleanup does not consume an unused environment provider',async()=>fixture(async(root,shared,operation)=>{
 const unused = new Proxy(operation, { get(_target, key): never { assert.fail(`unused operation field ${String(key)}`); } });
 assert.deepEqual(await cleanDependencyEnvironment(root,{},unused,shared),[]);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
 assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
}));
