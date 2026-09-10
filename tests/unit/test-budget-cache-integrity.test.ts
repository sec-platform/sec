import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { deepFreeze, sha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import {
  compileTestBudgetProjection, isKnownSlowTestSuiteId, slowTestSuiteIds,
  slowTestSuiteIdsForFile, TestBudgetProjectionCache, type TestBudgetProjection
} from '../../src/verification/test-impact/contract/budget.ts';

type Source = Parameters<typeof compileTestBudgetProjection>[0];
const digest = (value: string) => `sha256:${value.repeat(64)}` as const;
const files = ['tests/unit/plain.test.ts', 'tests/e2e/graph.test.ts'];
function source(testFiles: readonly string[] = files): Source {
  // Pure projection data only; never presented as an issued effect capability.
  return { workspaceSnapshotIdentityDigest: digest('a'), testObservationDigest: digest('b'),
    projectionDigest: digest('c'), testFiles } as Source;
}
function poison(cache: TestBudgetProjectionCache, key: string, value: unknown): void {
  // Preserve the existing slow-test-selection regression's cache-content fault
  // model. This is deliberate corruption, not proof of external write access or
  // an assertion that a particular private field layout is a public contract.
  (cache as unknown as { projections: Map<string, unknown> }).projections.set(key, value);
}
function selfConsistentForgery(first: TestBudgetProjection, patch: Partial<TestBudgetProjection>): TestBudgetProjection {
  const { projectionDigest: _previousDigest, ...unsigned } = { ...first, ...patch };
  // The production digest is deliberately available to the corruptor. It is
  // attack construction, never the oracle for correct scheduling or authority.
  return deepFreeze({ ...unsigned, projectionDigest: sha256(unsigned) }) as TestBudgetProjection;
}

test('cache corruption cannot erase a nonempty fast or slow partition even with a recomputed digest', () => {
  for (const patch of [{ fastTestFiles: [] }, { slowTestFiles: [], slowSuites: [] },
    { fastTestFiles: [], slowTestFiles: [], slowSuites: [] }]) {
    const cache = new TestBudgetProjectionCache(), input = source(), first = cache.project(input);
    const forged = selfConsistentForgery(first, patch);
    poison(cache, first.generationKey, forged);
    const result = cache.project(input);
    assert.notEqual(result, forged);
    assert.deepEqual(result.fastTestFiles, ['tests/unit/plain.test.ts']);
    assert.deepEqual(result.slowTestFiles, ['tests/e2e/graph.test.ts']);
    assert.deepEqual(result.slowSuites.map(suite => suite.id), ['e2e-graph']);
  }
});

test('self-hashed cache data cannot omit a required suite or replace its owner, limits or flags', () => {
  const cache = new TestBudgetProjectionCache(), input = source(), first = cache.project(input);
  const original = first.slowSuites[0]!;
  const variants: Partial<TestBudgetProjection>[] = [
    { slowSuites: [] },
    { slowSuites: [{ ...original, owner: 'unrelated', logicalRunTimeoutMs: 1,
      parallelSafe: false, resourceClass: 'runtime-heavy', prRiskBaseline: true }] },
    { slowSuites: [{ ...original, files: ['tests/e2e/other.test.ts'] }] }
  ];
  for (const patch of variants) {
    const forged = selfConsistentForgery(first, patch);
    poison(cache, first.generationKey, forged);
    const result = cache.project(input);
    assert.notEqual(result, forged); assert.deepEqual(result, first);
  }
});

test('a malformed cache value is rebuilt without evaluating its accessor or conversion hooks', () => {
  const cache = new TestBudgetProjectionCache(), input = source(), first = cache.project(input);
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  const unreadable = new Proxy({}, { get() { assert.fail('read corrupt entry'); },
    ownKeys() { assert.fail('enumerate corrupt entry'); } });
  for (const value of [null, false, 7, 'cached', proxy, unreadable,
    Object.freeze({ get generationKey() { assert.fail('corrupt getter'); throw new Error('unreachable'); } })]) {
    poison(cache, first.generationKey, value);
    assert.deepEqual(cache.project(input), first);
  }
});

test('a structurally exact JSON copy does not prove derivation by the budget compiler', () => {
  const cache = new TestBudgetProjectionCache(), input = source(), first = cache.project(input);
  const cloned = deepFreeze(JSON.parse(JSON.stringify(first))) as TestBudgetProjection;
  poison(cache, first.generationKey, cloned);
  const result = cache.project(input);
  assert.notEqual(result, cloned); assert.deepEqual(result, first);
  assert.equal(cache.project(input), result);
});

test('authentic compiler output remains reusable only for the same selected membership and generation', () => {
  const cache = new TestBudgetProjectionCache(), input = source(), first = cache.project(input);
  const otherMembership = compileTestBudgetProjection(source(['tests/unit/other.test.ts']));
  poison(cache, first.generationKey, otherMembership);
  assert.deepEqual(cache.project(input), first);
  const otherGeneration = compileTestBudgetProjection({ ...input, projectionDigest: digest('d') });
  poison(cache, first.generationKey, otherGeneration);
  assert.deepEqual(cache.project(input), first);
  const sameInput = compileTestBudgetProjection(input);
  poison(cache, first.generationKey, sameInput);
  assert.equal(cache.project(input), sameInput);
});

test('every source field is observed once on a cache miss and once on a cache hit', () => {
  const cache = new TestBudgetProjectionCache();
  for (let attempt = 0; attempt < 2; attempt++) {
    const reads: string[] = [], input = source();
    const selected = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value]));
    for (const key of Object.keys(selected)) {
      const value = selected[key];
      Object.defineProperty(selected, key, { enumerable: true, get() { reads.push(key); return value; } });
    }
    cache.project(selected as Source);
    assert.deepEqual(reads.sort(), ['projectionDigest', 'testFiles', 'testObservationDigest', 'workspaceSnapshotIdentityDigest']);
  }
});

test('the miss uses its captured generation, not a second getter observation while compiling', () => {
  const cache = new TestBudgetProjectionCache();
  let reads = 0;
  const input = { ...source(), get projectionDigest() { return ++reads === 1 ? digest('c') : digest('d'); } };
  const result = cache.project(input);
  assert.equal(reads, 1); assert.equal(result.generation.sourceProjectionDigest, digest('c'));
  assert.equal(cache.project(source()), result);
});

test('equivalent aliases, duplicate names and unselected support files preserve one cache identity', () => {
  const cache = new TestBudgetProjectionCache(), first = cache.project(source());
  const aliases = ['./tests/unit/plain.test.ts', 'tests\\unit\\plain.test.ts',
    '.\\tests\\e2e\\graph.test.ts', 'tests/testkit/helper.ts'];
  assert.equal(cache.project(source(aliases)), first);
  assert.deepEqual(first.testFiles, ['tests/e2e/graph.test.ts', 'tests/unit/plain.test.ts']);
});

test('a failed miss cannot replace the last valid result for that generation', () => {
  const cache = new TestBudgetProjectionCache(), input = source(), first = cache.project(input);
  assert.throws(() => cache.project(source(['tests/e2e/no-suite.test.ts'])), /explicit suite owner/);
  assert.equal(cache.project(input), first);
});

test('each of the three generation dimensions invalidates reuse independently', () => {
  const input = source();
  for (const key of ['workspaceSnapshotIdentityDigest', 'testObservationDigest', 'projectionDigest'] as const) {
    const cache = new TestBudgetProjectionCache(), first = cache.project(input);
    const changed = cache.project({ ...input, [key]: digest('d') });
    assert.notEqual(changed, first); assert.notEqual(changed.generationKey, first.generationKey);
    assert.deepEqual(changed.testFiles, first.testFiles);
  }
});

test('published results remain deeply immutable and later caller edits cause recompilation', () => {
  const selected = [...files], input = source(selected), cache = new TestBudgetProjectionCache();
  const result = cache.project(input);
  assert.throws(() => (result.fastTestFiles as string[]).push('tests/unit/extra.test.ts'), TypeError);
  assert.throws(() => (result.slowSuites[0]!.files as string[]).splice(0), TypeError);
  selected.push('tests/unit/extra.test.ts');
  const changed = cache.project(input);
  assert.notEqual(changed, result);
  assert.deepEqual(changed.fastTestFiles, ['tests/unit/extra.test.ts', 'tests/unit/plain.test.ts']);
  assert.deepEqual(result.fastTestFiles, ['tests/unit/plain.test.ts']);
});

test('suite lookup preserves immutable ordered results, path aliases, unknown names and paired-file membership', () => {
  const ids = slowTestSuiteIds();
  assert.ok(Object.isFrozen(ids)); assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(isKnownSlowTestSuiteId(id), true);
  for (const id of ['constructor', '__proto__', 'missing']) assert.equal(isKnownSlowTestSuiteId(id), false);
  for (const path of ['tests/e2e/graph.test.ts', './tests/e2e/graph.test.ts', 'tests\\e2e\\graph.test.ts']) {
    const matches = slowTestSuiteIdsForFile(path);
    assert.deepEqual(matches, ['e2e-graph']); assert.ok(Object.isFrozen(matches));
  }
  for (const path of ['tests/e2e/import-organizer-staged.test.ts', 'tests/e2e/import-organizer-worktree-isolation.test.ts']) {
    assert.deepEqual(slowTestSuiteIdsForFile(path), ['e2e-import-organizer-staged']);
  }
  assert.deepEqual(slowTestSuiteIdsForFile('tests/unit/plain.test.ts'), []);
});
