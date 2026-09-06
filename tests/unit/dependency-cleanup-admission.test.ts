import assert from 'node:assert/strict';
import { test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {cleanDependencyEnvironment} from '../../src/toolchain/dependencies/application/dependency-environment.ts';

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
 await assert.rejects(cleanDependencyEnvironment(root,{all:true},{sharedDepsRoot:shared}),/Custom shared/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
 assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
}));
test('a string false cannot select project deletion',async()=>fixture(async(root,shared)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{project:'false' as never},{sharedDepsRoot:shared}),/boolean/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
}));
test('force does not authorize foreign shared-root retirement',async()=>fixture(async(root,shared)=>{
 await assert.rejects(cleanDependencyEnvironment(root,{all:true,force:true},{sharedDepsRoot:shared}),/Custom shared/);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
}));
test('an empty cleanup does not consume an unused environment provider',async()=>fixture(async root=>{
 assert.deepEqual(await cleanDependencyEnvironment(root,{}, {get sharedDepsRoot(){assert.fail('unused root');},get generatedStateLifecycle(){assert.fail('unused provider');}}),[]);
}));
