import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { assembleRepositoryModuleGraph as assemble, resolveRepositoryModuleImportCandidates as candidates } from '../../src/adapters/repository/source-program-model/module-graph.ts';

const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
const observation = (typeOnly: boolean, from = 'src/a.ts', specifier = './b.ts') => ({ from, specifier, typeOnly, kind: 'static' as const });

test('runtime import cannot be erased by a following type-only import', () => {
  const graph = assemble({ files, imports: [observation(false), observation(true)] });
  assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), ['src/b.ts']);
  assert.equal(graph.references.length, 1);
  assert.equal(graph.references[0]!.typeOnly, false);
});

test('type-only and value imports commute and retain one dependency edge', () => {
  for (const imports of [[observation(true), observation(false)], [observation(false), observation(true)]]) {
    const graph = assemble({ files, imports });
    assert.deepEqual(graph.directDependencies('src/a.ts'), ['src/b.ts']);
    assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), ['src/b.ts']);
    assert.deepEqual(graph.directConsumers('src/b.ts'), ['src/a.ts']);
  }
});

test('all short import sequences agree with an independent boolean-union oracle', () => {
  for (let length = 1; length <= 8; length += 1) {
    for (let mask = 0; mask < 2 ** length; mask += 1) {
      const imports = Array.from({ length }, (_, bit) => observation((mask & (1 << bit)) !== 0));
      const expected = imports.every((item) => item.typeOnly) ? [] : ['src/b.ts'];
      const graph = assemble({ files, imports });
      assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), expected, `length=${length}, mask=${mask}`);
    }
  }
});

test('separate import kinds retain their own observation while runtime adjacency is unique', () => {
  const graph = assemble({ files, imports: [observation(true), { ...observation(false), kind: 'dynamic' }, { ...observation(false), kind: 'require' }] });
  assert.equal(graph.references.length, 3);
  assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), ['src/b.ts']);
  assert.deepEqual(graph.directConsumers('src/b.ts'), ['src/a.ts']);
});

test('pure type dependencies are retained without being promoted to runtime', () => {
  const graph = assemble({ files, imports: [observation(true), observation(true)] });
  assert.deepEqual(graph.directDependencies('src/a.ts'), ['src/b.ts']);
  assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), []);
});

test('candidate reverse edges remain present for a missing target', () => {
  const graph = assemble({ files: ['src/a.ts'], imports: [observation(false, 'src/a.ts', './missing')] });
  assert.deepEqual(graph.unresolvedFiles, ['src/a.ts']);
  for (const target of candidates('src/a.ts', './missing')) assert.deepEqual(graph.directConsumers(target), ['src/a.ts']);
  assert.deepEqual(graph.directDependencies('src/a.ts'), []);
});

test('hot targets deduplicate consumers across several import kinds', () => {
  const consumers = Array.from({ length: 2000 }, (_, index) => `src/c${index}.ts`);
  const graph = assemble({ files: [...consumers, 'src/shared.ts'], imports: consumers.flatMap((from) => [
    observation(true, from, './shared.ts'), observation(false, from, './shared.ts'),
    { ...observation(false, from, './shared.ts'), kind: 'dynamic' }
  ]) });
  assert.deepEqual(graph.directConsumers('src/shared.ts'), [...consumers].sort((a, b) => a.localeCompare(b, 'en-US')));
});

test('queries return detached frozen arrays, not a mutable cached adjacency', () => {
  const input = { files: [...files], imports: [observation(false)] };
  const graph = assemble(input);
  input.imports.push(observation(false, 'src/a.ts', './c.ts'));
  for (const getter of [graph.directDependencies, graph.directRuntimeDependencies]) {
    const first = getter('src/a.ts'); const second = getter('src/a.ts');
    assert.deepEqual(first, ['src/b.ts']); assert.notEqual(first, second);
    assert.ok(Object.isFrozen(first)); assert.equal(Reflect.set(first, 0, 'injected'), false);
  }
});

test('production-to-test edges remain rejected even when duplicated as type-only imports', () => {
  assert.throws(() => assemble({ files: ['src/a.ts', 'tests/x.test.ts'], imports: [
    observation(false, 'src/a.ts', '../tests/x.test.ts'), observation(true, 'src/a.ts', '../tests/x.test.ts')
  ] }), /production repository module imports test-only/);
});

test('foreign import sources and retired namespaces retain admission failures', () => {
  assert.throws(() => assemble({ files, imports: [observation(false, 'src/foreign.ts')] }), /outside its exact file census/);
  assert.throws(() => assemble({ files: ['src/modules/retired.ts'], imports: [] }), /retired repository root/);
});


test('lexical candidate order preserves the declared resolver priority', () => {
  assert.deepEqual(candidates('src/a.ts', './target'), [
    'src/target.ts', 'src/target.tsx', 'src/target.mts', 'src/target.cts',
    'src/target.js', 'src/target.jsx', 'src/target.mjs', 'src/target.cjs',
    'src/target/index.ts', 'src/target/index.tsx',
    'src/target/index.mts', 'src/target/index.cts'
  ]);
  assert.deepEqual(candidates('src/a.ts', './target.js'), [
    'src/target.js', 'src/target.ts', 'src/target.tsx', 'src/target.mts', 'src/target.cts'
  ]);
  assert.deepEqual(candidates('src/a.ts', './target.ts'), ['src/target.ts']);
});

test('every candidate subset selects its first admitted target regardless of census ordering', () => {
  const precedence = [
    'src/target.ts', 'src/target.tsx', 'src/target.mts', 'src/target.cts',
    'src/target.js', 'src/target.jsx', 'src/target.mjs', 'src/target.cjs',
    'src/target/index.ts', 'src/target/index.tsx',
    'src/target/index.mts', 'src/target/index.cts'
  ];
  const reference = observation(false, 'src/a.ts', './target');
  for (let mask = 0; mask < 2 ** precedence.length; mask += 1) {
    const admitted = precedence.filter((_, index) => (mask & (1 << index)) !== 0);
    const expected = admitted.slice(0, 1);
    for (const ordered of [admitted, [...admitted].reverse()]) {
      const graph = assemble({ files: ['src/a.ts', ...ordered], imports: [reference] });
      assert.deepEqual(graph.directDependencies('src/a.ts'), expected, `subset=${mask}`);
      assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), expected, `subset=${mask}`);
      assert.equal(graph.references[0]!.resolvedTarget, expected[0] ?? null);
      assert.deepEqual(graph.unresolvedFiles, expected.length === 0 ? ['src/a.ts'] : []);
      // All alternatives remain negative-dependency observations: adding or
      // removing an earlier candidate must invalidate the same consumer.
      for (const target of precedence) assert.deepEqual(graph.directConsumers(target), ['src/a.ts']);
    }
  }
});
