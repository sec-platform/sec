import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  currentProjectWriteAuthorization, projectProjectWriteAuthorization, withProjectWriteAuthorization,
  type ProjectWriteAuthorization
} from '../../../src/adapters/workspace/project-write-authorization.ts';
const root = path.join(tmpdir(), 'sec-authority-contract');
const input = () => ({ workspaceRoot: root, operation: 'upgrade.apply', impactPaths: ['src/a.ts'] });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { resolve, promise }; }

test('no authorization is visible during admission and nested preparation is refused', async () => {
  let calls = 0;
  await withProjectWriteAuthorization({ ...input(), async beforeCommit() {
    assert.equal(currentProjectWriteAuthorization(), null);
    await assert.rejects(withProjectWriteAuthorization(input(), async () => assert.fail('nested')), /already active/);
  } }, async authorization => {
    calls++;
    assert.equal(currentProjectWriteAuthorization(), authorization);
    await assert.rejects(withProjectWriteAuthorization(input(), async () => assert.fail('nested')), /already active/);
  });
  assert.equal(calls, 1);
  assert.equal(currentProjectWriteAuthorization(), null);
});

test('a failed admission grants no authority and preserves the original reason', async () => {
  const reason = new Error('admission');
  await assert.rejects(withProjectWriteAuthorization({ ...input(), beforeCommit() { throw reason; } },
    async () => assert.fail('not admitted')), error => error === reason);
  assert.equal(currentProjectWriteAuthorization(), null);
});

test('expired inherited async contexts never expose a current write authorization', async () => {
  const held = deferred(); let tail!: Promise<void>; let issued!: ProjectWriteAuthorization;
  await withProjectWriteAuthorization(input(), async authorization => {
    issued = authorization;
    tail = held.promise.then(() => {
      assert.equal(currentProjectWriteAuthorization(), null);
      assert.throws(() => projectProjectWriteAuthorization(root, authorization), /expired/);
    });
  });
  held.resolve(); await tail;
  assert.throws(() => projectProjectWriteAuthorization(root, issued), /expired/);
});

test('independent concurrent operations cannot read one another authorization', async () => {
  const begun = deferred(), release = deferred(); let first!: ProjectWriteAuthorization;
  const a = withProjectWriteAuthorization(input(), async authorization => { first = authorization; begun.resolve(); await release.promise; });
  await begun.promise;
  try {
    await withProjectWriteAuthorization(input(), async authorization => {
      assert.notEqual(authorization, first);
      assert.throws(() => projectProjectWriteAuthorization(root, first), /expired/);
    });
  } finally { release.resolve(); await a; }
});
