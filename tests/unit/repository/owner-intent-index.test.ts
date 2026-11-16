import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { indexOwnerIntentInputs as index } from '../../../src/adapters/repository/source-program-model/owner-intent-index.ts';

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

test('declaration views retain same-name separation, private declarations and ambiguity', () => {
  const input = fixture(); input.declarations.push({ ...input.declarations[0]!, observationId: 'overload' });
  const view = index(input);
  assert.equal(view.declarationsForCapability('A', 'run').length, 2);
  assert.equal(view.declarationsForCapability('B', 'run').length, 0);
  assert.equal(view.declarationsForPath('src/b.ts')[0], input.declarations[1]);
});

test('matching exported declarations with no module owner are not assigned an owner', () => {
  const input = fixture(); input.declarations[0]!.moduleId = null;
  assert.equal(index(input).declarationsForCapability('A', 'run').length, 0);
});

test('entrypoint targets and handler owners retain their exact observation', () => {
  const input = fixture();
  const view = index(input);
  assert.equal(view.entrypointsForTarget('src/a.ts').length, 1);
  assert.equal(view.entrypointsForOwner('A').length, 1);
  assert.equal(view.entrypointsForTarget('src/b.ts').length, 0);
  assert.equal(view.entrypointsForOwner('B').length, 0);
  assert.equal(view.firstClosureForEntrypoint('entry'), input.entrypointClosures[0]);
});

test('resolved declaration identity never falls back to a matching target path', () => {
  const input = fixture();
  input.declarations.push({ ...input.declarations[0]!, observationId: 'other-export', name: 'other' });
  input.references[0]!.targetObservationId = 'other-export';
  assert.equal(index(input).consumerPaths(new Set(['a']), new Set(['src/a.ts'])).size, 0);
  input.references[0]!.targetObservationId = 'a';
  assert.deepEqual([...index(input).consumerPaths(new Set(['a']), new Set(['src/a.ts']))], ['src/b.ts']);
});

test('unresolved declaration reference can match its known target path', () => {
  const input = fixture(); input.references[0]!.targetObservationId = null;
  assert.deepEqual([...index(input).consumerPaths(new Set(), new Set(['src/a.ts']))], ['src/b.ts']);
  input.references[0]!.targetPath = 'other';
  assert.equal(index(input).consumerPaths(new Set(), new Set(['src/a.ts'])).size, 0);
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
  const input = fixture(); input.references = [input.references[0]!, input.references[0]!,
    { ...input.references[0]!, path: 'src/a.ts' }];
  const actual = index(input).consumerPaths(new Set(['a']), new Set(['src/a.ts']));
  assert.deepEqual(actual, new Set(['src/a.ts', 'src/b.ts']));
});

function fact(overrides: Partial<{
  path: string; surface: string; capability: string; observationClass: string; transport: string;
}> = {}) {
  return { path: 'src/a.ts', surface: 'production', capability: 'filesystem',
    observationClass: 'observed', transport: 'native-runtime', ...overrides };
}
function view(capabilities: ReturnType<typeof fact>[]) {
  return index({ files: [], declarations: [], entrypoints: [],
    entrypointClosures: [], references: [], capabilities });
}
test('capability summaries preserve selected kind union and distinguish each unknown source', () => {
  const known = fact();
  const capabilities = [known, known,
    fact({ capability: 'process', observationClass: 'derived' }),
    fact({ path: 'src/b.ts', capability: 'network' }),
    fact({ path: 'src/outside.ts', capability: 'excluded-path', observationClass: 'unknown', transport: 'unknown' }),
    fact({ surface: 'test', capability: 'excluded-surface', observationClass: 'unknown', transport: 'unknown' })];
  // Keep both unknown mechanisms independently observable. Combining them
  // would allow either dropped uncertainty source to hide behind the other.
  for (const [records, hasUnknown] of [
    [capabilities, false],
    [[...capabilities, fact({ capability: 'unresolved', observationClass: 'unknown' })], true],
    [capabilities.map(entry => entry.capability === 'network' ? { ...entry, transport: 'unknown' } : entry), true]
  ] as const) {
    const result = view([...records]).capabilitySummaryForPaths(new Set(['src/a.ts', 'src/b.ts']));
    assert.deepEqual(new Set(result.observedKinds), new Set(['filesystem', 'network', 'process']));
    assert.equal(result.observedKinds.length, 3);
    assert.equal(result.hasUnknown, hasUnknown);
  }
});
