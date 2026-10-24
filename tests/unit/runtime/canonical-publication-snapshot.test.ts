import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  classifyCanonicalWorkspacePublicationFailure,
  deleteExpectedCanonicalWorkspaceFile,
  publishExistingParentCanonicalWorkspaceFile
} from '../../../src/adapters/filesystem/file-publication.ts';

async function fixture(run: (root: string, target: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-publication-snapshot-'));
  const target = path.join(root, 'data', 'value.txt'); mkdirSync(path.dirname(target));
  try { await run(root, target); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('rollback refuses a replacement file at the final deletion fence', async () => fixture(async (root, target) => {
  writeFileSync(target, 'old'); const expectedBytes = Buffer.from('old');
  await assert.rejects(deleteExpectedCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target,
    label: 'rollback', bytes: Buffer.alloc(0), expectedBytes,
    async commitFence() { writeFileSync(target, 'new'); }
  }), /rollback preimage changed/);
  assert.equal(readFileSync(target, 'utf8'), 'new');
}));

test('existing-parent publication classifies a missing parent as before-effect', async () => fixture(async (root) => {
  const target = path.join(root, 'missing', 'value.txt');
  let failure: unknown;
  try {
    await publishExistingParentCanonicalWorkspaceFile({
      workspaceRoot: root,
      targetPath: target,
      bytes: Buffer.from('x'),
      label: 'missing parent'
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.equal(classifyCanonicalWorkspacePublicationFailure(failure), 'before-effect');
  assert.equal(existsSync(target), false);
  assert.equal(classifyCanonicalWorkspacePublicationFailure(new Error('foreign')), 'unknown');
}));

test('existing-parent publication keeps the final fence failure before-effect', async () => fixture(async (root, target) => {
  const expected = new Error('final fence rejected');
  let calls = 0;
  let failure: unknown;
  try {
    await publishExistingParentCanonicalWorkspaceFile({
      workspaceRoot: root,
      targetPath: target,
      bytes: Buffer.from('x'),
      label: 'final fence',
      async commitFence() {
        calls += 1;
        if (calls === 2) throw expected;
      }
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure, expected);
  assert.equal(classifyCanonicalWorkspacePublicationFailure(failure), 'before-effect');
  assert.equal(existsSync(target), false);
}));
