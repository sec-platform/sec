import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { prepareSemanticQuery } from '../../../src/application/semantic-query.ts';
import { createRuntime } from '../../../src/bootstrap/create-runtime.ts';
import { createAuthorWorkspace } from '../../../src/workspace/author-candidate.ts';
import {
  assertAuthorSourceCaptureBudget,
  DEFAULT_AUTHOR_SOURCE_CAPTURE_BUDGET,
  requireAuthorSourceCaptureBudget
} from '../../../src/workspace/author-source-capture-budget.ts';

const limits = Object.freeze({
  maximumNodes: 128,
  maximumEntries: 128,
  maximumTextBytes: 2048,
  maximumDepth: 16
});

function input() {
  return {
    engineeringIRInput: {
      app: { id: 'budget-preview', name: 'Budget Preview' },
      resolvedBlocks: [],
      manifests: [],
      acceptanceIds: [],
      policyDeclarations: []
    }
  };
}

test('source budget must be a complete, fixed set of positive finite ceilings', () => {
  assert.deepEqual(requireAuthorSourceCaptureBudget(), DEFAULT_AUTHOR_SOURCE_CAPTURE_BUDGET);
  for (const invalid of [
    null, { ...limits, maximumNodes: 0 }, { ...limits, maximumEntries: Infinity },
    { ...limits, maximumDepth: 1.5 }, { maximumNodes: 4 },
    { ...limits, extra: 1 }
  ]) {
    assert.throws(() => requireAuthorSourceCaptureBudget(invalid as never), TypeError);
  }
  let calls = 0;
  const dynamic = Object.defineProperty({ ...limits }, 'maximumNodes', {
    enumerable: true, get() { calls++; throw new Error('budget getter should not run'); }
  });
  assert.throws(() => requireAuthorSourceCaptureBudget(dynamic), TypeError);
  assert.equal(calls, 0);
});

test('source input admission rejects sparse entry explosions before cloning', () => {
  const payload = input();
  const overlong = Object.assign(payload.engineeringIRInput, {
    candidateRecords: new Array<unknown>(1_000_000)
  });
  assert.throws(() => prepareSemanticQuery({ purpose: 'analyze', input: { engineeringIRInput: overlong } }, limits),
    { code: 'AUTHOR-SOURCE-RESOURCE-001' });
});

test('source input enforces node, text-byte and depth budgets independently', () => {
  const budget = limits;
  assert.throws(() => assertAuthorSourceCaptureBudget({ records: Array.from({ length: 100 }, (_, i) => i) },
    { ...budget, maximumNodes: 30 }), { code: 'AUTHOR-SOURCE-RESOURCE-001' });
  assert.throws(() => assertAuthorSourceCaptureBudget({ text: '𝄞'.repeat(100) },
    { ...budget, maximumTextBytes: 300 }), { code: 'AUTHOR-SOURCE-RESOURCE-001' });
  const deep: { next?: unknown } = {};
  let cursor = deep;
  for (let i = 0; i < 32; i++) {
    const nested = {};
    cursor.next = nested;
    cursor = nested;
  }
  assert.throws(() => assertAuthorSourceCaptureBudget(deep, budget),
    { code: 'AUTHOR-SOURCE-RESOURCE-001' });
  const extraArray = [1] as Array<number> & { [key: string]: unknown };
  for (let i = 0; i < 20; i++) extraArray['extra' + i] = i;
  assert.throws(() => assertAuthorSourceCaptureBudget(extraArray,
    { ...budget, maximumEntries: 20 }), { code: 'AUTHOR-SOURCE-RESOURCE-001' });
});

test('source capture never executes own getters or Proxy traps', () => {
  let getters = 0;
  const payload = input();
  const malicious = Object.defineProperty(payload.engineeringIRInput, 'injected', {
    enumerable: true, get() { getters++; throw new Error('should not run'); }
  });
  assert.throws(() => prepareSemanticQuery({ purpose: 'analyze', input: {
    engineeringIRInput: malicious
  } }, limits), { code: 'SEMANTIC-INPUT-001' });
  assert.equal(getters, 0);

  let traps = 0;
  const proxy = new Proxy(input(), {
    ownKeys() { traps++; throw new Error('should not run'); },
    getPrototypeOf() { traps++; throw new Error('should not run'); }
  });
  assert.throws(() => prepareSemanticQuery({ purpose: 'analyze', input: proxy }, limits),
    { code: 'SEMANTIC-INPUT-001' });
  assert.equal(traps, 0);
});

test('source budgets preserve shared nodes, cycle termination and editable drafts', () => {
  const shared = { name: 'shared' };
  const inputWithAliases = { first: shared, second: shared };
  assert.doesNotThrow(() => assertAuthorSourceCaptureBudget(inputWithAliases, limits));
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.doesNotThrow(() => assertAuthorSourceCaptureBudget(cyclic, limits));
  const workspace = createAuthorWorkspace({ unresolved: '' }, limits);
  assert.deepEqual(workspace.read(workspace.fork(workspace.initial, { unresolved: 'fixed' })),
    { unresolved: 'fixed' });
  assert.throws(() => createAuthorWorkspace({ nested: new Map([['key', 1]]) }, limits),
    { code: 'AUTHOR-CANDIDATE-001' });
});

test('runtime enforces the same budget for direct inputs and workspace candidates', async () => {
  const runtime = createRuntime({ sourceCaptureBudget: limits });
  try {
    const valid = input();
    const analyzed = await runtime.handle({ purpose: 'analyze', input: valid });
    assert.equal(analyzed.purpose, 'analyze');
    const workspace = runtime.workspace(valid);
    assert.equal((await runtime.handle({ purpose: 'analyze', candidate: workspace.initial })).purpose,
      'analyze');
    const unsafe = { ...valid, records: new Array(10_000) };
    await assert.rejects(runtime.handle({ purpose: 'analyze', input: unsafe }),
      { code: 'AUTHOR-SOURCE-RESOURCE-001' });
    assert.throws(() => runtime.workspace(unsafe), { code: 'AUTHOR-SOURCE-RESOURCE-001' });
  } finally {
    await runtime.close();
  }
});
