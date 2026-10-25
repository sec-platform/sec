import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deriveTestWorkspaceRunNamespace } from '../../../src/adapters/self-hosting/development/runner/env-manager.ts';
import { captureWorkspacePipelineOptions, workspaceTemplatePipeline, type WorkspaceTemplateKind } from '../../testkit/template-preparation.ts';
import { settleWorkspaceCallback, workspaceTemporaryPrefix } from '../../testkit/workspace-cleanup.ts';

test('a workspace name is an allocation label, never a caller-selected parent path', () => {
  for (const prefix of ['', '.', '..', '../escape-', '/absolute-', 'nested/prefix-', '..\\escape-', 'C:drive-', 'x\0y']) {
    assert.throws(() => workspaceTemporaryPrefix('/parent', prefix), TypeError);
  }
  assert.equal(workspaceTemporaryPrefix('/parent', 'test-'), path.resolve('/parent/test-'));
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

test('native mkdtemp allocations remain inside the selected parent for valid labels', async () => {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'workspace-prefix-'));
  await settleWorkspaceCallback(async () => {
    for (const label of ['simple-', 'with space-', '中文-']) {
      const directory = await fs.mkdtemp(workspaceTemporaryPrefix(parent, label));
      assert.equal(path.dirname(directory), parent); assert.ok(path.basename(directory).startsWith(label));
    }
  }, async () => { await fs.rm(parent, { recursive: true, force: true }); });
});

test('pipeline selection owns a single block list rather than re-reading it after init', () => {
  assert.deepEqual(captureWorkspacePipelineOptions({}).blockIds, []);
  const input = { prefix: 'original-', blockIds: ['block/a'] };
  const captured = captureWorkspacePipelineOptions(input);
  input.blockIds.push('block/b'); input.prefix = 'replaced-';
  assert.equal(captured.prefix, 'original-'); assert.deepEqual(captured.blockIds, ['block/a']);
  assert.ok(Object.isFrozen(captured.blockIds));
});

test('template identity selects the declared pipeline and rejects inherited or path-shaped keys', () => {
  const expected = [
    ['resolved-default', 'resolve', 'all'], ['composed-default', 'compose', 'all'],
    ['verified-fast-default', 'verify', 'fast'],
    ['locked-all-default', 'lock', 'all'], ['explained-all-default', 'emit', 'all']
  ];
  assert.equal(workspaceTemplatePipeline('empty-default'), null);
  for (const [kind, through, verificationLane] of expected) {
    assert.deepEqual(workspaceTemplatePipeline(kind as WorkspaceTemplateKind), { through, verificationLane });
  }
  for (const kind of ['constructor', '__proto__', '../outside', '/absolute', null, 7, {}]) {
    assert.throws(() => workspaceTemplatePipeline(kind as never), TypeError);
  }
  for (const prefix of [null, false, 0, {}]) {
    assert.throws(() => captureWorkspacePipelineOptions({ prefix: prefix as never }), TypeError);
  }
});
