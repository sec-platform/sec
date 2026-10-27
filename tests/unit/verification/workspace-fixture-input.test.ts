import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { deriveTestWorkspaceRunNamespace } from '../../../src/adapters/self-hosting/development/runner/env-manager.ts';
import { captureWorkspacePipelineOptions } from '../../testkit/template-preparation.ts';
import { workspaceTemporaryPrefix } from '../../testkit/workspace-cleanup.ts';

test('a workspace name is an allocation label, never a caller-selected parent path', () => {
  for (const prefix of ['', '.', '..', '../escape-', '..\\escape-', 'C:drive-', 'x\0y']) {
    assert.throws(() => workspaceTemporaryPrefix('/parent', prefix), TypeError);
  }
  for (const label of ['simple-', 'with space-', '中文-']) {
    const prefix = workspaceTemporaryPrefix('/parent', label);
    assert.equal(prefix, path.resolve('/parent', label));
    assert.equal(path.dirname(prefix), path.resolve('/parent'));
    assert.equal(path.basename(prefix), label);
  }
});

test.skipIf(process.platform !== 'win32')('nested Gate workspace cwd stays within CreateProcessW limit', () => {
  const outer = deriveTestWorkspaceRunNamespace({ processId: 1, processNonce: 'outer', runSequence: 1 });
  const inner = deriveTestWorkspaceRunNamespace({ parentNamespace: outer, processId: 2,
    processNonce: 'inner', runSequence: 1 });
  const checkout = path.win32.join('C:\\', 'r'.repeat(70));
  const root = path.join(checkout, '.tmp', 'test-workspaces', outer, inner);
  const label = 'engineering-compiler-semantic-projection-consumers-';
  const projectedCwd = workspaceTemporaryPrefix(root, label);
  assert.ok(projectedCwd.length + 6 < 260);
  const oldRoot = path.join(checkout, '.tmp', 'test-workspaces',
    `fast-${'a'.repeat(64)}`, `fast-${'b'.repeat(64)}`);
  const oldCwd = workspaceTemporaryPrefix(oldRoot, label);
  assert.ok(oldCwd.length + 6 >= 260);
});

test('pipeline selection owns a single block list rather than re-reading it after init', () => {
  assert.deepEqual(captureWorkspacePipelineOptions({}).blockIds, []);
  const input = { prefix: 'original-', blockIds: ['block/a'] };
  const captured = captureWorkspacePipelineOptions(input);
  input.blockIds.push('block/b'); input.prefix = 'replaced-';
  assert.equal(captured.prefix, 'original-'); assert.deepEqual(captured.blockIds, ['block/a']);
});
