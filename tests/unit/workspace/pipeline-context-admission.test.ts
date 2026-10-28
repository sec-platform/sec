import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { requirePipelineSource } from '../../../src/compiler/pipeline/source.ts';

for (const source of [null, false, '', 'other', '__proto__']) test(`invalid source ${String(source)} is refused`, () => {
  assert.throws(() => requirePipelineSource(source));
});
