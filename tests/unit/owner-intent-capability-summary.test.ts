import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { indexOwnerIntentInputs } from '../../src/adapters/repository/source-program-model/owner-intent-index.ts';

function fact(overrides: Partial<{
  path: string; surface: string; capability: string; observationClass: string; transport: string;
}> = {}) {
  return { path: 'src/a.ts', surface: 'production', capability: 'filesystem',
    observationClass: 'observed', transport: 'native-runtime', ...overrides };
}
function view(capabilities: ReturnType<typeof fact>[]) {
  return indexOwnerIntentInputs({ files: [], declarations: [], entrypoints: [],
    entrypointClosures: [], references: [], capabilities });
}
const paths = new Set(['src/a.ts']);

for (const observationClass of ['observed', 'derived', 'unknown']) {
  for (const transport of ['native-runtime', 'unknown']) {
    test(`summary preserves ${observationClass} observation with ${transport} transport`, () => {
      const result = view([fact({ observationClass, transport })]).capabilitySummaryForPaths(paths);
      assert.deepEqual(result.observedKinds, observationClass === 'unknown' ? [] : ['filesystem']);
      assert.equal(result.hasUnknown, observationClass === 'unknown' || transport === 'unknown');
    });
  }
}

test('one unknown fact cannot be hidden by repeated known facts in the same group', () => {
  const result = view([fact(), fact(), fact({ observationClass: 'unknown' }), fact()])
    .capabilitySummaryForPaths(paths);
  assert.deepEqual(result, { observedKinds: ['filesystem'], hasUnknown: true });
});

test('unrequested paths and non-production facts cannot contribute effects or unknown status', () => {
  const result = view([fact(), fact({ path: 'src/b.ts', capability: 'network', transport: 'unknown' }),
    fact({ surface: 'test', capability: 'process', observationClass: 'unknown' })])
    .capabilitySummaryForPaths(paths);
  assert.deepEqual(result, { observedKinds: ['filesystem'], hasUnknown: false });
});

test('union across requested paths retains every known effect and any unknown fact', () => {
  const result = view([fact(), fact({ path: 'src/b.ts', capability: 'network' }),
    fact({ path: 'src/b.ts', capability: 'process', observationClass: 'unknown' })])
    .capabilitySummaryForPaths(new Set(['src/a.ts', 'src/b.ts']));
  assert.deepEqual(new Set(result.observedKinds), new Set(['filesystem', 'network']));
  assert.equal(result.hasUnknown, true);
});

test('empty and missing path sets have complete empty summaries', () => {
  const index = view([fact({ transport: 'unknown' })]);
  assert.deepEqual(index.capabilitySummaryForPaths(new Set()), { observedKinds: [], hasUnknown: false });
  assert.deepEqual(index.capabilitySummaryForPaths(new Set(['missing'])), { observedKinds: [], hasUnknown: false });
});

test('literal path and kind values do not alias object prototype keys or delimiters', () => {
  const index = view([fact({ path: '__proto__', capability: 'constructor' }),
    fact({ path: 'x\0y', capability: '' }), fact({ path: 'x', capability: 'y\0' })]);
  assert.deepEqual(index.capabilitySummaryForPaths(new Set(['__proto__'])).observedKinds, ['constructor']);
  assert.deepEqual(index.capabilitySummaryForPaths(new Set(['x\0y'])).observedKinds, ['']);
  assert.deepEqual(index.capabilitySummaryForPaths(new Set(['x'])).observedKinds, ['y\0']);
});

test('future known kind names remain data rather than being limited by an enum', () => {
  const capabilities = Array.from({ length: 4096 }, (_, i) => fact({ capability: `kind-${i}` }));
  const result = view(capabilities).capabilitySummaryForPaths(paths);
  assert.equal(result.observedKinds.length, capabilities.length);
  assert.deepEqual(new Set(result.observedKinds), new Set(capabilities.map((item) => item.capability)));
});

test('a failed build is retried from the source, not reused as a partially complete summary', () => {
  let fail = true;
  const input = fact({ capability: 'network' });
  Object.defineProperty(input, 'transport', { get() { if (fail) throw new Error('interrupted'); return 'unknown'; } });
  const index = view([fact(), input]);
  assert.throws(() => index.capabilitySummaryForPaths(paths), /interrupted/);
  fail = false;
  const result = index.capabilitySummaryForPaths(paths);
  assert.deepEqual(new Set(result.observedKinds), new Set(['filesystem', 'network']));
  assert.equal(result.hasUnknown, true);
});

test('repeated shared-path queries do not rescan the capability records', () => {
  let reads = 0;
  const capabilities = Array.from({ length: 10000 }, () => ({
    ...fact(), get capability() { reads += 1; return 'filesystem'; }
  }));
  const index = view(capabilities);
  for (let i = 0; i < 2000; i += 1) {
    assert.deepEqual(index.capabilitySummaryForPaths(paths), { observedKinds: ['filesystem'], hasUnknown: false });
  }
  assert.equal(reads, capabilities.length);
});

test('summary is an immutable detached value and does not freeze its source records', () => {
  const capabilities = [fact()];
  const index = view(capabilities);
  const result = index.capabilitySummaryForPaths(paths);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.observedKinds));
  assert.equal(Object.isFrozen(capabilities), false); assert.equal(Object.isFrozen(capabilities[0]), false);
  assert.equal(Reflect.set(result.observedKinds, 0, 'injected'), false);
  assert.equal(Reflect.set(result, 'hasUnknown', true), false);
  assert.deepEqual(index.capabilitySummaryForPaths(paths), { observedKinds: ['filesystem'], hasUnknown: false });
});

test('a new generation does not reuse an old generation summary', () => {
  assert.equal(view([fact()]).capabilitySummaryForPaths(paths).hasUnknown, false);
  assert.equal(view([fact({ transport: 'unknown' })]).capabilitySummaryForPaths(paths).hasUnknown, true);
});

test('multiset and request permutations agree with independent filter/map/every semantics', () => {
  const pool = [fact(), fact({ observationClass: 'unknown' }), fact({ transport: 'unknown' }),
    fact({ path: 'src/b.ts', capability: 'network' }), fact({ surface: 'test' }),
    fact({ capability: 'process', observationClass: 'derived' })];
  for (let code = 0; code < 6 ** 4; code += 1) {
    const capabilities = Array.from({ length: 4 }, (_, i) => pool[Math.floor(code / 6 ** i) % 6]!);
    const requested = new Set(code % 2 ? ['src/a.ts', 'src/b.ts'] : ['src/b.ts', 'src/a.ts']);
    const selected = capabilities.filter((item) => item.surface === 'production' && requested.has(item.path));
    const expectedKinds = new Set(selected.filter((item) => item.observationClass !== 'unknown').map((item) => item.capability));
    const expectedUnknown = !selected.every((item) => item.observationClass !== 'unknown' && item.transport !== 'unknown');
    const actual = view(capabilities).capabilitySummaryForPaths(requested);
    assert.deepEqual(new Set(actual.observedKinds), expectedKinds, `case ${code}`);
    assert.equal(actual.hasUnknown, expectedUnknown, `case ${code}`);
  }
});
