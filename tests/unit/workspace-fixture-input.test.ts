import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { workspaceTemporaryPrefix, captureWorkspaceRetention } from '../testkit/workspace-cleanup.ts';
import { captureWorkspacePipelineOptions, workspaceTemplatePipeline, type WorkspaceTemplateKind } from '../testkit/template-preparation.ts';

test('a workspace name is an allocation label, never a caller-selected parent path', () => {
  for (const prefix of ['', '.', '..', '../escape-', '/absolute-', 'nested/prefix-', '..\\escape-', 'C:drive-', 'x\0y']) {
    assert.throws(() => workspaceTemporaryPrefix('/parent', prefix), TypeError);
  }
  assert.equal(workspaceTemporaryPrefix('/parent', 'test-'), path.resolve('/parent/test-'));
});

test('native mkdtemp allocations remain inside the selected parent for valid labels', async () => {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'workspace-prefix-'));
  try {
    for (const label of ['simple-', 'with space-', '中文-']) {
      const directory = await fs.mkdtemp(workspaceTemporaryPrefix(parent, label));
      assert.equal(path.dirname(directory), parent); assert.ok(path.basename(directory).startsWith(label));
    }
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});

test('retention is one strict decision and is not a truthy flag', () => {
  assert.equal(captureWorkspaceRetention({}), false);
  assert.equal(captureWorkspaceRetention({ retainOnCallbackFailure: true }), true);
  assert.equal(captureWorkspaceRetention({ retainOnCallbackFailure: false }), false);
  for (const value of [null, 0, 1, 'false', {}]) assert.throws(() => captureWorkspaceRetention({ retainOnCallbackFailure: value as never }), TypeError);
});

test('pipeline selection owns a single block list rather than re-reading it after init', () => {
  const input = { prefix: 'original-', blockIds: ['block/a'] };
  const captured = captureWorkspacePipelineOptions(input);
  input.blockIds.push('block/b'); input.prefix = 'replaced-';
  assert.equal(captured.prefix, 'original-'); assert.deepEqual(captured.blockIds, ['block/a']);
  assert.ok(Object.isFrozen(captured.blockIds));
});

test('pipeline options sample known fields once and ignore unrelated capability getters', () => {
  let count = 0;
  const input = { get blockIds() { count++; return ['block/a']; }, get extra() { assert.fail('unrelated'); } };
  assert.deepEqual(captureWorkspacePipelineOptions(input).blockIds, ['block/a']); assert.equal(count, 1);
});

test('invalid block-list shapes do not become a default template request', () => {
  for (const blockIds of [null, false, 'block/a', [7], new Array(1)]) {
    assert.throws(() => captureWorkspacePipelineOptions({ blockIds: blockIds as never }), TypeError);
  }
  assert.deepEqual(captureWorkspacePipelineOptions({}).blockIds, []);
});

test('template identity selects the declared pipeline and rejects inherited or path-shaped keys', () => {
  const expected = [
    ['resolved-default', 'resolve', 'all'], ['composed-default', 'compose', 'all'],
    ['verified-fast-default', 'verify', 'fast'], ['locked-default', 'lock', 'all'],
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
