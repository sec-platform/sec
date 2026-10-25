import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { assertRuntimeDependencySourceGenerationIssued, runtimeDependencySourceGeneration } from '../../../src/adapters/toolchain/dependencies/runtime/source-generation.ts';
import { generatedStateDigest } from "../../../src/execution/generated-state/contract.ts";
import { settleResources } from '../../../src/execution/resource-settlement.ts';

// In repository execution these retain the real source compiler and physical
// owner. The standalone local replay substitutes only the declared physical,
// generation-digest and transition-identity boundaries; it is not native IO evidence.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-source-invocation-'));
  try {
    for (const name of ['a','b']) { mkdirSync(path.join(root, name)); writeFileSync(path.join(root,name,'value'), name); }
    return { root, options: runtimeDependencyOperationControls({ lockTimeoutMs: 20_000 }) };
  } catch (error) {
    settleResources({ primary: { label: 'source-generation-fixture-construction', error },
      cleanup: [{ label: 'source-generation-fixture-root',
        settle: () => rmSync(root, { recursive: true, force: true }) }] });
    throw error;
  }
}
function input(f: ReturnType<typeof fixture>) { return { ownerRoot: f.root, sourcePath: path.join(f.root,'a'), binding: { selected:'a' }, options:f.options }; }

test('read-only observation captures one input for its physical scan and same-context in-flight join', async () => {
  const f=fixture(); try {
    const options=new Proxy({...f.options,get generatedStateLifecycle(){assert.fail('unused lifecycle'); throw new Error('unreachable');},get beforeCommit(){assert.fail('write fence'); throw new Error('unreachable');}},
      {ownKeys(){assert.fail('options enumerated');}});
    const values={...input(f),options};
    const replacements={ownerRoot:path.join(f.root,'b'),sourcePath:path.join(f.root,'b'),binding:{selected:'b'},
      options:{lockTimeoutMs:20_000,monotonicNowMs:()=>assert.fail('replacement controls')}};
    const selected=new Set<PropertyKey>();
    const request=new Proxy({...values,get unrelated(){assert.fail('unrelated input'); throw new Error('unreachable');}}, {
      ownKeys(){assert.fail('input enumerated');},
      get(target,key,receiver){
        if(Object.hasOwn(replacements,key)){
          if(selected.has(key))return Reflect.get(replacements,key);
          selected.add(key);
        }
        return Reflect.get(target,key,receiver);
      }
    });
    const same=input(f), expectedDigest=generatedStateDigest({selected:'a'});
    const first=runtimeDependencySourceGeneration(request);
    request.sourcePath=path.join(f.root,'b'); values.binding.selected='b';
    const second=runtimeDependencySourceGeneration(same);
    const [a,b]=await Promise.all([first,second]);
    assert.equal(a,b); assert.equal(a.ownerRoot,f.root); assert.equal(a.sourcePath,same.sourcePath); assert.equal(a.bindingDigest,expectedDigest);
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

test.serial('relative paths bind before callbacks or the deferred scan can change cwd', async () => {
  const f=fixture(), original=process.cwd(); try {
    process.chdir(f.root);
    const pending=runtimeDependencySourceGeneration({...input(f),ownerRoot:'.',sourcePath:'a'});
    process.chdir(tmpdir());
    const result=await pending;assert.equal(result.ownerRoot,f.root);assert.equal(result.sourcePath,path.join(f.root,'a'));
  }finally{process.chdir(original);rmSync(f.root,{recursive:true,force:true});}
});

for(const requested of [null, false, {maximumBytes:null},{maximumEntries:null},{maximumBytes:-1},{maximumEntries:0}]){
  test(`invalid selected bounds cannot become default capacity: ${JSON.stringify(requested)}`,async()=>{
    const ownerRoot=path.resolve('source-generation-admission');
    await assert.rejects(runtimeDependencySourceGeneration({ownerRoot,sourcePath:path.join(ownerRoot,'a'),
      binding:{selected:'a'},options:{monotonicNowMs:()=>assert.fail('invalid bounds reached controls')}
    },requested as never), {code:'RUNTIME-DEPS-003'});
  });
}

test('the same source with different bounds cannot join a wider in-flight observation', async () => {
  const f=fixture();try{
    const request=input(f);const first=runtimeDependencySourceGeneration(request,{maximumEntries:10});
    const capacity=assert.rejects(runtimeDependencySourceGeneration(request,{maximumEntries:1}),
      {code:'RUNTIME-DEPS-003',message:/in-flight/});
    const deadline=assert.rejects(runtimeDependencySourceGeneration({...request,
      options:{...request.options,lockTimeoutMs:10_000}},{maximumEntries:10}),
      {code:'RUNTIME-DEPS-003',message:/in-flight/});
    const result=await first;await Promise.all([capacity,deadline]);
    assert.equal(result.sourcePath,request.sourcePath);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('failed observation is retired and can be recomputed after source recovery', async () => {
  const f=fixture();try{
    const request={...input(f),sourcePath:path.join(f.root,'later')};
    await assert.rejects(runtimeDependencySourceGeneration(request));mkdirSync(request.sourcePath);
    const result=await runtimeDependencySourceGeneration(request);assert.equal(result.sourcePath,request.sourcePath);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
