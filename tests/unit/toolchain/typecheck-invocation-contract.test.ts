import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureTypecheckInvocation } from '../../../src/adapters/verification/typecheck-invocation.ts';

for (const isolated of [undefined, false, true]) test(`typecheck captures explicit/default mode ${String(isolated)}`, () => {
  const value = captureTypecheckInvocation('project', { isolated });
  assert.equal(value.isolated, isolated === true); assert.ok(Object.isFrozen(value));
  assert.equal(value.projectRoot, path.resolve('project')); assert.equal(value.dependencyProjectRoot, value.projectRoot);
});
test('typecheck selection survives later cwd changes and caller mutation', () => {
  const cwd = process.cwd(), other = mkdtempSync(path.join(tmpdir(), 'sec-typecheck-bind-'));
  try {
    const input = { isolated: true, dependencyProjectRoot: 'dependencies' };
    const captured = captureTypecheckInvocation('project', input);
    process.chdir(other);
    input.isolated = false; input.dependencyProjectRoot = 'other';
    assert.equal(captured.isolated, true);
    assert.equal(captured.projectRoot, path.resolve(cwd, 'project'));
    assert.equal(captured.dependencyProjectRoot, path.resolve(cwd, 'dependencies'));
    assert.equal(captured.diagnosticRoot, cwd);
  } finally { process.chdir(cwd); rmSync(other, { recursive: true, force: true }); }
});
