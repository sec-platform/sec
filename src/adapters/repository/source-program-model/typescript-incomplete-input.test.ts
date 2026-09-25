import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { rawSha256 } from '../../../contracts/canonical.ts';
import {
  compileTypeScriptModel,
  compileTypeScriptModelIncremental,
  releaseTypeScriptWorkspace
} from './typescript.ts';

const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]),
  graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]),
  moduleForPath: () => null
});

function input(source: string) {
  return {
    sourceRevision: rawSha256(source),
    files: [{ path: 'src/example.ts', source, contentDigest: rawSha256(source) }],
    moduleMembership
  };
}

// A missing operand is an unresolved source fact, not a valid empty dependency
// set and not an exception from the compiler API's non-null node classifier.
for (const source of [
  'void import();',
  'const value = import();',
  'const value = await import();',
  'const { value } = await import();',
  'require();',
  'export function run() { return import(); }',
  'export function run() { return require(); }'
]) {
  test(`incomplete loader input remains explicit and does not poison the next generation: ${source}`, () => {
    try {
      const model = compileTypeScriptModel(input(source));
      assert.ok(model.unknowns.some(({ code }) => code === 'dynamic-module-unresolved'));
      assert.equal(model.references.some(({ kind }) => kind === 'import'), false);
      const first = compileTypeScriptModelIncremental(input(source), null);
      assert.ok(first.model.unknowns.some(({ code }) => code === 'dynamic-module-unresolved'));
      const next = compileTypeScriptModelIncremental(input('export const ready = 1;'), first.state);
      assert.deepEqual(next.model.unknowns, []);
      assert.deepEqual(next.model.declarations.map(({ name }) => name), ['ready']);
    } finally {
      releaseTypeScriptWorkspace();
    }
  });
}

test('unrelated zero-argument calls remain ordinary semantic calls', () => {
  try {
    const model = compileTypeScriptModel(input('export function ready() { return 1; } ready();'));
    assert.deepEqual(model.unknowns, []);
    assert.ok(model.references.some(({ kind, name }) => kind === 'call' && name === 'ready'));
  } finally {
    releaseTypeScriptWorkspace();
  }
});
