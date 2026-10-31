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
test('runtime cache cleanup modes share one pre-effect admission and preserve project dependencies', async () => fixture(async root => {
  // Both selectors hit the same Runtime Cache ownership gate, so they can
  // share unchanged physical inputs while retaining separate failure checks.
  for (const selection of [{ bunCache: true }, { all: true, force: true }] as const) {
    const mode = Object.keys(selection)[0];
    await assert.rejects(
      cleanDependencyEnvironment(root, selection),
      (error: unknown) => error instanceof Error
        && 'code' in error
        && error.code === 'IMPORT-AUTHORITY-004'
        && error.message.includes('Runtime Cache owner'),
      `${mode} must be rejected before deleting project dependencies`
    );
    assert.equal(await fs.readFile(path.join(root, 'node_modules/keep'), 'utf8'), 'keep', mode);
    assert.equal(await fs.readFile(path.join(root, '.runtime-deps.stamp.json'), 'utf8'), 'keep', mode);
  }
}));
test('an empty cleanup leaves existing project dependencies intact',async()=>fixture(async(root)=>{
 assert.deepEqual(await cleanDependencyEnvironment(root,{}),[]);
 assert.equal(await fs.readFile(path.join(root,'node_modules/keep'),'utf8'),'keep');
 assert.equal(await fs.readFile(path.join(root,'.runtime-deps.stamp.json'),'utf8'),'keep');
}));
