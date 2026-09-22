import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatedStateDigest } from '../../src/adapters/runtime-state/generated-state/contract.ts';
import { runtimeDependencyOperationControls } from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { assertRuntimeDependencySourceGenerationIssued, runtimeDependencySourceGeneration } from '../../src/adapters/toolchain/dependencies/runtime/source-generation.ts';

// In repository execution these retain the real source compiler and physical
// owner. The standalone local replay substitutes only the declared physical,
// generation-digest and transition-identity boundaries; it is not native IO evidence.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-source-invocation-'));
  for (const name of ['a','b']) { mkdirSync(path.join(root, name)); writeFileSync(path.join(root,name,'value'), name); }
  return { root, options: runtimeDependencyOperationControls({ lockTimeoutMs: 20_000 }) };
}
function input(f: ReturnType<typeof fixture>) { return { ownerRoot: f.root, sourcePath: path.join(f.root,'a'), binding: { selected:'a' }, options:f.options }; }

test('in-flight key, physical scan and issued result use the same captured input', async () => {
  const f=fixture(); try {
    const request=input(f), same=input(f), expectedDigest=generatedStateDigest(request.binding);
    const first=runtimeDependencySourceGeneration(request);
    request.sourcePath=path.join(f.root,'b'); request.binding.selected='b';
    const second=runtimeDependencySourceGeneration(same);
    const [a,b]=await Promise.all([first,second]);
    assert.equal(a,b); assert.equal(a.sourcePath,same.sourcePath); assert.equal(a.bindingDigest,expectedDigest);
    assertRuntimeDependencySourceGenerationIssued(a);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('clock callbacks cannot retarget the already-selected source or binding', async () => {
  const f=fixture(); try {
    const request={...input(f), options: {lockTimeoutMs:20_000, monotonicNowMs:()=>{
      request.ownerRoot=path.join(f.root,'b'); request.sourcePath=path.join(f.root,'b'); request.binding.selected='b'; return performance.now();
    }}};
    const expectedDigest=generatedStateDigest(request.binding);
    const result=await runtimeDependencySourceGeneration(request);
    assert.equal(result.ownerRoot,f.root); assert.equal(result.sourcePath,path.join(f.root,'a')); assert.equal(result.bindingDigest,expectedDigest);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('relative paths bind before callbacks or the deferred scan can change cwd', async () => {
  const f=fixture(), original=process.cwd(); try {
    process.chdir(f.root);
    const pending=runtimeDependencySourceGeneration({...input(f),ownerRoot:'.',sourcePath:'a'});
    process.chdir(tmpdir());
    const result=await pending;assert.equal(result.ownerRoot,f.root);assert.equal(result.sourcePath,path.join(f.root,'a'));
  }finally{process.chdir(original);rmSync(f.root,{recursive:true,force:true});}
});

test('read-only source observation neither enumerates input nor propagates install capabilities', async () => {
  const f=fixture();try{
    const options=new Proxy({...f.options,get generatedStateLifecycle(){assert.fail('unused lifecycle'); throw new Error('unreachable');},get beforeCommit(){assert.fail('write fence'); throw new Error('unreachable');}},
      {ownKeys(){assert.fail('options enumerated');}});
    const request=new Proxy({...input(f),options,get unrelated(){assert.fail('unrelated input'); throw new Error('unreachable');}}, {ownKeys(){assert.fail('input enumerated');}});
    assert.equal((await runtimeDependencySourceGeneration(request)).sourcePath,path.join(f.root,'a'));
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('required input fields are sampled once before scan scheduling', async () => {
  const f=fixture();try{
    const counts: Record<string,number>={}, values=input(f), request={} as typeof values;
    for(const key of Object.keys(values) as (keyof typeof values)[])Object.defineProperty(request,key,{enumerable:true,get(){counts[key]=(counts[key]??0)+1;return values[key];}});
    await runtimeDependencySourceGeneration(request);
    assert.deepEqual(counts,{ownerRoot:1,sourcePath:1,binding:1,options:1});
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

for(const requested of [null, false, {maximumBytes:null},{maximumEntries:null},{maximumBytes:-1},{maximumEntries:0}]){
  test(`invalid selected bounds cannot become default capacity: ${JSON.stringify(requested)}`,async()=>{
    const f=fixture();try{await assert.rejects(runtimeDependencySourceGeneration(input(f),requested as never));}
    finally{rmSync(f.root,{recursive:true,force:true});}
  });
}

test('the same source with different bounds cannot join a wider in-flight observation', async () => {
  const f=fixture();try{
    const request=input(f);const first=runtimeDependencySourceGeneration(request,{maximumEntries:10});
    const second=runtimeDependencySourceGeneration(request,{maximumEntries:1});
    const rejected=assert.rejects(second,/in-flight/);await first;await rejected;
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('failed observation is retired and can be recomputed after source recovery', async () => {
  const f=fixture();try{
    const request={...input(f),sourcePath:path.join(f.root,'later')};
    await assert.rejects(runtimeDependencySourceGeneration(request));mkdirSync(request.sourcePath);
    const result=await runtimeDependencySourceGeneration(request);assert.equal(result.sourcePath,request.sourcePath);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('completed observations are not reused after source content changes', async () => {
  const f=fixture();try{
    const request=input(f), a=await runtimeDependencySourceGeneration(request);
    writeFileSync(path.join(request.sourcePath,'value'),'different');
    const b=await runtimeDependencySourceGeneration(request);assert.notEqual(a,b);assert.notEqual(a.treeDigest,b.treeDigest);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
