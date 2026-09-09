import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureProjectPathInventory } from '../../src/workspace/contract/project-path-inventory.ts';

test('explicit producer coalescing and strict scope uniqueness remain different decisions', () => {
  assert.deepEqual(captureProjectPathInventory(['b.ts', 'a.ts', 'b.ts'], 'coalesce', 'paths'), ['a.ts', 'b.ts']);
  assert.throws(() => captureProjectPathInventory(['a.ts', 'a.ts'], 'reject', 'scope'), /repeats/);
  assert.deepEqual(captureProjectPathInventory([], 'reject', 'scope'), []);
});

test('a changed iterator or map implementation cannot substitute a validated scope', () => {
  const paths = ['src/a.ts'];
  paths[Symbol.iterator] = () => ['../substituted'].values();
  paths.map = () => { assert.fail('caller map'); };
  assert.deepEqual(captureProjectPathInventory(paths, 'reject', 'scope'), ['src/a.ts']);
});

test('the result is sorted, immutable and detached from future caller mutation', () => {
  const paths = ['src/b.ts', 'src/a.ts'];
  const result = captureProjectPathInventory(paths, 'reject', 'scope');
  paths[0] = 'changed';
  assert.deepEqual(result, ['src/a.ts', 'src/b.ts']);
  assert.ok(Object.isFrozen(result));
});

for (const values of [new Array(1), [null], [7], [''], ['../escape'], ['src/../a'], ['src\\a'], ['aux.txt']]) {
  test(`invalid path inventory ${JSON.stringify(values)} cannot be normalized into a grant`, () => {
    assert.throws(() => captureProjectPathInventory(values as never, 'coalesce', 'paths'));
  });
}

for (const paths of [['Src/a.ts', 'src/a.ts'], ['Straße/a', 'STRASSE/a'], ['x/é', 'x/e\u0301']]) {
  test(`distinct portable spellings cannot silently alias ${JSON.stringify(paths)}`, () => {
    assert.throws(() => captureProjectPathInventory(paths, 'coalesce', 'paths'));
  });
}

test('slot accessors and non-string coercions are rejected without execution', () => {
  const paths: string[] = [];
  Object.defineProperty(paths, 0, { get() { assert.fail('slot accessor'); } });
  assert.throws(() => captureProjectPathInventory(paths, 'reject', 'scope'));
  assert.throws(() => captureProjectPathInventory([{ toString() { assert.fail('coercion'); } }] as never, 'reject', 'scope'));
});
