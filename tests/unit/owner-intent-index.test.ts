import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { indexOwnerIntentInputs as index } from '../../src/adapters/repository/source-program-model/owner-intent-index.ts';

function fixture() {
  return {
    files: [{ path: 'src/a.ts', surface: 'production' }, { path: 'src/b.ts', surface: 'production' }, { path: 'tests/c.ts', surface: 'test' }],
    declarations: [
      { observationId: 'a', path: 'src/a.ts', moduleId: 'A' as string | null, name: 'run', exported: true },
      { observationId: 'b', path: 'src/b.ts', moduleId: 'B' as string | null, name: 'run', exported: false }
    ],
    entrypoints: [{ observationId: 'entry', targetPaths: ['src/a.ts'], name: 'run' }],
    entrypointClosures: [{ entrypointObservationId: 'entry', handlerModuleIds: ['A'], reachablePaths: ['src/b.ts'], marker: 'first' }],
    capabilities: [{ path: 'src/a.ts', surface: 'production', capability: 'filesystem', observationClass: 'unknown', transport: 'unknown' }],
    references: [
      { path: 'src/b.ts', observationClass: 'observed', targetObservationId: 'a' as string | null, targetPath: 'src/a.ts' as string | null }
    ]
  };
}

test('construction does not read any fact collection before a view is requested', () => {
  const input = new Proxy(fixture(), { get() { throw new Error('eager model read'); } });
  assert.doesNotThrow(() => index(input));
});

test('unused view families remain completely unobserved', () => {
  const input = fixture();
  for (const key of ['declarations', 'files', 'capabilities', 'references'] as const) {
    Object.defineProperty(input, key, { get() { throw new Error(`unused ${key}`); } });
  }
  const view = index(input);
  assert.equal(view.entrypointsForOwner('A').length, 1);
});

test('declaration views retain same-name separation, private declarations and ambiguity', () => {
  const input = fixture(); input.declarations.push(input.declarations[0]!);
  const view = index(input);
  assert.equal(view.declarationsForCapability('A', 'run').length, 2);
  assert.equal(view.declarationsForCapability('B', 'run').length, 0);
  assert.equal(view.declarationsForPath('src/b.ts')[0], input.declarations[1]);
});

test('matching exported declarations with no module owner are not assigned an owner', () => {
  const input = fixture(); input.declarations[0]!.moduleId = null;
  assert.equal(index(input).declarationsForCapability('A', 'run').length, 0);
});

test('shared declaration view is prepared exactly once for both access paths', () => {
  const input = fixture(); const entries = input.declarations; let reads = 0;
  Object.defineProperty(input, 'declarations', { get() { reads += 1; return entries; } });
  const view = index(input);
  for (let i = 0; i < 100; i += 1) { view.declarationsForCapability('A', 'run'); view.declarationsForPath('src/a.ts'); }
  assert.equal(reads, 1);
});

test('index construction failure never publishes a partial declaration view', () => {
  const input = fixture(); let fail = true;
  const good = input.declarations[1]!;
  input.declarations[1] = { ...good, exported: true, get name() { if (fail) throw new Error('interrupted'); return 'run'; } };
  const view = index(input);
  assert.throws(() => view.declarationsForCapability('A', 'run'), /interrupted/);
  fail = false;
  assert.equal(view.declarationsForCapability('A', 'run').length, 1);
  assert.equal(view.declarationsForPath('src/b.ts').length, 1);
});

test('duplicate target and handler labels do not duplicate one entrypoint observation', () => {
  const input = fixture();
  input.entrypoints[0]!.targetPaths.push('src/a.ts');
  input.entrypointClosures[0]!.handlerModuleIds.push('A');
  const view = index(input);
  assert.equal(view.entrypointsForTarget('src/a.ts').length, 1);
  assert.equal(view.entrypointsForOwner('A').length, 1);
});

test('separate duplicate entrypoint observations are not silently deduplicated', () => {
  const input = fixture(); input.entrypoints.push(input.entrypoints[0]!);
  const view = index(input);
  assert.equal(view.entrypointsForTarget('src/a.ts').length, 2);
  assert.equal(view.entrypointsForOwner('A').length, 2);
});

test('first and last closure consumers preserve their distinct legacy semantics', () => {
  const input = fixture(); input.entrypointClosures.push({ ...input.entrypointClosures[0]!, handlerModuleIds: ['B'], marker: 'last' });
  const view = index(input);
  assert.equal(view.entrypointsForOwner('A').length, 0);
  assert.equal(view.entrypointsForOwner('B')[0]!.closure.marker, 'last');
  assert.equal(view.firstClosureForEntrypoint('entry')!.marker, 'first');
});

test('entrypoint with no closure is still target-addressable but not assigned to a handler', () => {
  const input = fixture(); input.entrypointClosures = [];
  const view = index(input);
  assert.equal(view.entrypointsForTarget('src/a.ts').length, 1);
  assert.equal(view.entrypointsForOwner('A').length, 0);
});

test('unknown capability observations are retained for the existing effect guard', () => {
  const input = fixture(); input.capabilities.push({ ...input.capabilities[0]!, surface: 'test' });
  const summary = index(input).capabilitySummaryForPaths(new Set(['src/a.ts']));
  assert.deepEqual(summary, { observedKinds: [], hasUnknown: true });
});

test('empty capability and consumer demands do not build or read their indexes', () => {
  const input = fixture();
  for (const key of ['capabilities', 'references', 'files'] as const) {
    Object.defineProperty(input, key, { get() { throw new Error(`unused ${key}`); } });
  }
  const view = index(input);
  assert.deepEqual(view.capabilitySummaryForPaths(new Set()), { observedKinds: [], hasUnknown: false });
  assert.equal(view.consumerPaths(new Set(), new Set()).size, 0);
});

test('resolved declaration identity never falls back to a matching target path', () => {
  const input = fixture(); input.references[0]!.targetObservationId = 'different';
  assert.equal(index(input).consumerPaths(new Set(['a']), new Set(['src/a.ts'])).size, 0);
});

test('unresolved declaration reference can match its known target path', () => {
  const input = fixture(); input.references[0]!.targetObservationId = null;
  assert.deepEqual([...index(input).consumerPaths(new Set(), new Set(['src/a.ts']))], ['src/b.ts']);
});

test('unknown observations and non-production sources do not become consumers', () => {
  const input = fixture();
  input.references = [
    { ...input.references[0]!, observationClass: 'unknown' },
    { ...input.references[0]!, path: 'tests/c.ts' },
    { ...input.references[0]!, path: 'missing.ts' }
  ];
  assert.equal(index(input).consumerPaths(new Set(['a']), new Set(['src/a.ts'])).size, 0);
});

test('duplicate reference locations do not repeat source membership lookups downstream', () => {
  const input = fixture(); input.references = Array(1000).fill(input.references[0]);
  const actual = index(input).consumerPaths(new Set(['a']), new Set(['src/a.ts']));
  assert.deepEqual([...actual], ['src/b.ts']);
});

test('published buckets are frozen but input declarations and input arrays are not', () => {
  const input = fixture(); const view = index(input);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.declarationsForPath('src/a.ts')));
  assert.ok(Object.isFrozen(view.entrypointsForOwner('A')));
  assert.ok(Object.isFrozen(view.entrypointsForTarget('src/a.ts')));
  assert.equal(Object.isFrozen(input.declarations), false);
  assert.equal(Object.isFrozen(input.declarations[0]), false);
});

test('returned capability summaries and consumer sets cannot mutate stored indexes', () => {
  const view = index(fixture());
  const summary = view.capabilitySummaryForPaths(new Set(['src/a.ts']));
  assert.equal(Reflect.set(summary, 'hasUnknown', false), false);
  assert.equal(Reflect.set(summary.observedKinds, 0, 'injected'), false);
  (view.consumerPaths(new Set(['a']), new Set()) as Set<string>).clear();
  assert.equal(view.capabilitySummaryForPaths(new Set(['src/a.ts'])).hasUnknown, true);
  assert.equal(view.consumerPaths(new Set(['a']), new Set()).size, 1);
});

test('a new generation gets fresh independent indexes, even with the same addresses', () => {
  const input = fixture(); const first = index(input);
  assert.equal(first.declarationsForCapability('A', 'run').length, 1);
  const second = index({ ...input, declarations: [] });
  assert.equal(second.declarationsForCapability('A', 'run').length, 0);
  assert.equal(first.declarationsForCapability('A', 'run').length, 1);
});

test('independent direct-relation oracle agrees for all small target-choice combinations', () => {
  for (let mask = 0; mask < 256; mask += 1) {
    const input = fixture();
    input.references = Array.from({ length: 4 }, (_, i) => ({
      path: i % 2 ? 'src/b.ts' : 'src/a.ts', observationClass: mask & (1 << i) ? 'unknown' : 'observed',
      targetObservationId: mask & (1 << (i + 4)) ? null : (i % 2 ? 'a' : 'other'),
      targetPath: i < 2 ? 'src/a.ts' : 'other'
    }));
    const ids = new Set(['a']); const paths = new Set(['src/a.ts']);
    const expected = new Set(input.references.filter((r) => r.observationClass !== 'unknown'
      && (r.targetObservationId === null ? r.targetPath !== null && paths.has(r.targetPath) : ids.has(r.targetObservationId))).map((r) => r.path));
    assert.deepEqual(index(input).consumerPaths(ids, paths), expected);
  }
});
