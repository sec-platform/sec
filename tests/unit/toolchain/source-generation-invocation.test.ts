import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { assertRuntimeDependencySourceGenerationIssued, runtimeDependencySourceGeneration } from '../../../src/adapters/toolchain/dependencies/runtime/source-generation.ts';
import { generatedStateDigest } from "../../../src/execution/generated-state/contract.ts";
import { settleResources, withAcquiredResource } from '../../../src/execution/resource-settlement.ts';

// In repository execution these retain the real source compiler and physical
// owner. The standalone local replay substitutes only the declared physical,
// generation-digest and transition-identity boundaries; it is not native IO evidence.
function fixture(sourceNames: readonly string[] = ['a']) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-source-invocation-'));
  try {
    for (const name of sourceNames) { mkdirSync(path.join(root, name)); writeFileSync(path.join(root,name,'value'), name); }
    return { root, options: runtimeDependencyOperationControls({ lockTimeoutMs: 20_000 }) };
  } catch (error) {
    settleResources({ primary: { label: 'source-generation-fixture-construction', error },
      cleanup: [{ label: 'source-generation-fixture-root',
        settle: () => rmSync(root, { recursive: true, force: true }) }] });
    throw error;
  }
}
function usingFixture(use: (f: ReturnType<typeof fixture>) => Promise<void>, sourceNames?: readonly string[]): Promise<void> {
  return withAcquiredResource({
    operationLabel: 'source-generation-observation',
    resourceLabel: 'source-generation-fixture-root',
    acquire: () => fixture(sourceNames),
    use,
    release: f => rmSync(f.root, { recursive: true, force: true })
  });
}
function input(f: ReturnType<typeof fixture>) { return { ownerRoot: f.root, sourcePath: path.join(f.root,'a'), binding: { selected:'a' }, options:f.options }; }

test('read-only observation shares the same-context scan and returns its selected source proof', async () => {
  return usingFixture(async f => {
    const request=input(f), expectedDigest=generatedStateDigest({selected:'a'});
    const first=runtimeDependencySourceGeneration(request);
    const second=runtimeDependencySourceGeneration(input(f));
    const [a,b]=await Promise.all([first,second]);
    assert.equal(a,b); assert.equal(a.ownerRoot,f.root); assert.equal(a.sourcePath,request.sourcePath); assert.equal(a.bindingDigest,expectedDigest);
    assertRuntimeDependencySourceGenerationIssued(a);
  });
});

test('the same source with a narrower operation deadline cannot join a wider in-flight observation', async () => {
  return usingFixture(async f => {
    const request=input(f);const first=runtimeDependencySourceGeneration(request);
    const deadline=assert.rejects(runtimeDependencySourceGeneration({...request,
      options:{...request.options,lockTimeoutMs:10_000}}),
      {code:'RUNTIME-DEPS-003',message:/in-flight/});
    const result=await first;await deadline;
    assert.equal(result.sourcePath,request.sourcePath);
  }, ['a']);
});

test('failed observation is retired and can be recomputed after source recovery', async () => {
  return usingFixture(async f => {
    const request={...input(f),sourcePath:path.join(f.root,'later')};
    await assert.rejects(runtimeDependencySourceGeneration(request));mkdirSync(request.sourcePath);
    const result=await runtimeDependencySourceGeneration(request);assert.equal(result.sourcePath,request.sourcePath);
  }, []);
});
