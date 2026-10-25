import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { rawSha256 } from '../../../contracts/canonical.ts';
import {
  compileTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramModelIncremental,
  releaseTypeScriptSourceProgramWorkspace
} from './typescript.ts';
import { moduleMembership } from './test/typescript-model-input.ts';

function input(source: string) {
  const contentDigest = rawSha256(source);
  return {
    sourceRevision: contentDigest,
    files: [{ path: 'src/example.ts', source, contentDigest }],
    moduleMembership
  };
}

// A missing operand is an unresolved source fact, not a valid empty dependency
// set and not an exception from the compiler API's non-null node classifier.
for (const source of [
  'void import();',
  'const { value } = await import();',
  'export function run() { return require(); }'
]) {
  test(`incomplete loader input remains explicit and does not poison the next generation: ${source}`, () => {
    try {
      const first = compileTypeScriptSourceProgramModelIncremental(input(source), null);
      assert.ok(first.model.unknowns.some(({ code }) => code === 'dynamic-module-unresolved'));
      assert.equal(first.model.references.some(({ kind }) => kind === 'import'), false);
      const next = compileTypeScriptSourceProgramModelIncremental(input('export const ready = 1;'), first.state);
      assert.deepEqual(next.model.unknowns, []);
      assert.deepEqual(next.model.declarations.map(({ name }) => name), ['ready']);
    } finally {
      releaseTypeScriptSourceProgramWorkspace();
    }
  });
}

test('unrelated zero-argument calls remain ordinary semantic calls', () => {
  try {
    const model = compileTypeScriptSourceProgramModel(input('export function ready() { return 1; } ready();'));
    assert.deepEqual(model.unknowns, []);
    assert.ok(model.references.some(({ kind, name }) => kind === 'call' && name === 'ready'));
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});
