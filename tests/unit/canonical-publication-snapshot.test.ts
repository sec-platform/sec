import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import {
  publishCanonicalWorkspaceFile, publishExistingParentCanonicalWorkspaceFile,
  publishExpectedCanonicalWorkspaceFile, publishExclusiveCanonicalWorkspaceFile,
  deleteExpectedCanonicalWorkspaceFile,
  type CanonicalWorkspaceFilePublicationInput
} from '../../src/workspace/runtime/file-publication.ts';

async function fixture(run: (root: string, target: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-publication-snapshot-'));
  const target = path.join(root, 'data', 'value.txt'); mkdirSync(path.dirname(target));
  try { await run(root, target); } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const publish of [publishCanonicalWorkspaceFile, publishExistingParentCanonicalWorkspaceFile,
  publishExclusiveCanonicalWorkspaceFile]) {
  test(`${publish.name} binds bytes, paths and the original commit receiver before suspension`, async () => fixture(async (root, target) => {
    const input = { workspaceRoot: root, targetPath: target, bytes: Buffer.from('wanted'), label: 'publication',
      calls: 0, async commitFence() {
        assert.equal(this, input); this.calls++;
        input.targetPath = path.join(root, 'wrong.txt'); input.workspaceRoot = tmpdir();
        input.bytes.fill(0); input.label = 'mutated';
        input.commitFence = () => { assert.fail('replacement fence invoked'); };
      } };
    await publish(input);
    assert.equal(readFileSync(target, 'utf8'), 'wanted');
    assert.equal(existsSync(path.join(root, 'wrong.txt')), false); assert.equal(input.calls, 2);
  }));
}

test('a changed expected-byte buffer cannot authorize a changed existing file', async () => fixture(async (root, target) => {
  writeFileSync(target, 'old');
  const expected = Buffer.from('old');
  await assert.rejects(publishExpectedCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target,
    label: 'conditional', bytes: Buffer.from('new'), expectedBytes: expected,
    async commitFence() { writeFileSync(target, 'bad'); expected.set(Buffer.from('bad')); }
  }), /preimage changed/);
  assert.equal(readFileSync(target, 'utf8'), 'bad');
}));

test('conditional publication snapshots both the desired bytes and its preimage', async () => fixture(async (root, target) => {
  writeFileSync(target, 'old');
  const expectedBytes = Buffer.from('old'), bytes = Buffer.from('new');
  await publishExpectedCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target,
    label: 'conditional', bytes, expectedBytes, async commitFence() { expectedBytes.fill(0); bytes.fill(0); }
  });
  assert.equal(readFileSync(target, 'utf8'), 'new');
}));

test('rollback consumes only a captured preimage, not unused publication bytes', async () => fixture(async (root, target) => {
  writeFileSync(target, 'old'); const expectedBytes = Buffer.from('old');
  await deleteExpectedCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target, label: 'rollback',
    expectedBytes, get bytes(): Uint8Array { assert.fail('unused new bytes were read'); },
    async commitFence() { expectedBytes.fill(0); }
  });
  assert.equal(existsSync(target), false);
}));

test('rollback cannot be retargeted to delete a replacement preimage', async () => fixture(async (root, target) => {
  writeFileSync(target, 'old'); const expectedBytes = Buffer.from('old');
  await assert.rejects(deleteExpectedCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target,
    label: 'rollback', bytes: Buffer.alloc(0), expectedBytes,
    async commitFence() { writeFileSync(target, 'new'); expectedBytes.set(Buffer.from('new')); }
  }), /rollback preimage changed/);
  assert.equal(readFileSync(target, 'utf8'), 'new');
}));

test('native view slots define the captured range even when public view properties are shadowed', async () => fixture(async (root, target) => {
  const bytes = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
  for (const key of ['buffer', 'byteOffset', 'byteLength', 'length']) Object.defineProperty(bytes, key, {
    get() { assert.fail(`untrusted ${key}`); }
  });
  await publishExistingParentCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target, bytes, label: 'view' });
  assert.deepEqual([...readFileSync(target)], [2, 3]);
}));

test('shared publication buffers are refused before commit admission', async () => fixture(async (root, target) => {
  let effects = 0;
  await assert.rejects(publishCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target,
    label: 'shared', bytes: new Uint8Array(new SharedArrayBuffer(4)), async commitFence() { effects++; }
  }), /shared memory/);
  assert.equal(effects, 0); assert.equal(existsSync(target), false);
}));

test('an invalid fence is refused without creating publication parents', async () => fixture(async (root) => {
  const target = path.join(root, 'missing', 'value.txt');
  await assert.rejects(publishCanonicalWorkspaceFile({ workspaceRoot: root, targetPath: target,
    label: 'bad fence', bytes: Buffer.from('x'), commitFence: 'invalid'
  } as unknown as CanonicalWorkspaceFilePublicationInput), TypeError);
  assert.equal(existsSync(path.dirname(target)), false);
}));

test('relative paths keep the invocation cwd even if an input getter changes it', async () => fixture(async (root, target) => {
  const cwd = process.cwd();
  try {
    process.chdir(root);
    await publishExistingParentCanonicalWorkspaceFile({
      get workspaceRoot() { process.chdir(tmpdir()); return '.'; }, targetPath: 'data/value.txt',
      bytes: Buffer.from('fixed'), label: 'relative'
    });
    assert.equal(readFileSync(target, 'utf8'), 'fixed');
  } finally { process.chdir(cwd); }
}));

test('the publication fence retains class-private instance state', async () => fixture(async (root, target) => {
  class Input {
    #calls = 0;
    workspaceRoot = root; targetPath = target; bytes = Buffer.from('data'); label = 'private';
    async commitFence() { this.#calls++; }
    get calls() { return this.#calls; }
  }
  const input = new Input(); await publishExistingParentCanonicalWorkspaceFile(input);
  assert.equal(input.calls, 2); assert.equal(readFileSync(target, 'utf8'), 'data');
}));
