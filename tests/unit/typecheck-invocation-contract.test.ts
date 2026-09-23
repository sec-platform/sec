import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureTypecheckInvocation } from '../../src/adapters/verification/typecheck-invocation.ts';

for (const isolated of [undefined, false, true]) test(`typecheck captures explicit/default mode ${String(isolated)}`, () => {
  const value = captureTypecheckInvocation('project', { isolated });
  assert.equal(value.isolated, isolated === true); assert.ok(Object.isFrozen(value));
  assert.equal(value.projectRoot, path.resolve('project')); assert.equal(value.dependencyProjectRoot, value.projectRoot);
});
for (const isolated of [null, 0, 1, '', 'false', {}]) test('non-boolean isolation is rejected rather than coerced', () => {
  assert.throws(() => captureTypecheckInvocation('project', { isolated } as never), TypeError);
});

test('each owned selection is read once without enumerating unrelated input', () => {
  let modes = 0, roots = 0;
  const input = new Proxy({ get isolated() { modes++; return true; }, get dependencyProjectRoot() { roots++; return 'dependencies'; },
    get unowned() { assert.fail('unowned input'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('enumerated options'); } });
  const captured = captureTypecheckInvocation('project', input);
  assert.equal(modes, 1); assert.equal(roots, 1); assert.equal(captured.isolated, true);
  assert.equal(captured.dependencyProjectRoot, path.resolve('dependencies'));
});

test('path and diagnostic origin precede callback-driven working directory changes', () => {
  const cwd = process.cwd(), other = mkdtempSync(path.join(tmpdir(), 'sec-typecheck-bind-'));
  try {
    const input = { get isolated() { process.chdir(other); return true; }, dependencyProjectRoot: 'dependencies' };
    const captured = captureTypecheckInvocation('project', input);
    assert.equal(captured.projectRoot, path.resolve(cwd, 'project'));
    assert.equal(captured.dependencyProjectRoot, path.resolve(cwd, 'dependencies'));
    assert.equal(captured.diagnosticRoot, cwd);
  } finally { process.chdir(cwd); rmSync(other, { recursive: true, force: true }); }
});

test('caller mutations cannot change an admitted host selection', () => {
  const raw = { isolated: true, dependencyProjectRoot: 'dependencies' };
  const captured = captureTypecheckInvocation('project', raw);
  raw.isolated = false; raw.dependencyProjectRoot = 'other';
  assert.equal(captured.isolated, true); assert.equal(captured.dependencyProjectRoot, path.resolve('dependencies'));
});
