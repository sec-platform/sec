import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { currentProjectWriteAuthorization, projectProjectWriteAuthorization, withProjectWriteAuthorization,
  type ProjectWriteAuthorization } from '../../src/workspace/runtime/project-write-authorization.ts';
const root = path.join(tmpdir(), 'sec-authority-contract');
const input = () => ({ workspaceRoot: root, operation: 'upgrade.apply', impactPaths: ['src/a.ts'] });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { resolve, promise }; }

test('the same accepted path data controls validation, digest and live projection', async () => {
  const values = input(); let iterations = 0;
  values.impactPaths[Symbol.iterator] = function* () { yield ++iterations < 3 ? 'src/a.ts' : '../escape'; };
  await withProjectWriteAuthorization(values, async authorization => {
    assert.deepEqual(projectProjectWriteAuthorization(root, authorization).impactPaths, ['src/a.ts']);
  });
  assert.equal(iterations, 0);
});

test('an operation lookalike cannot be coerced into semantic identity', async () => {
  const operation = { toString() { assert.fail('operation coercion'); } };
  await assert.rejects(withProjectWriteAuthorization({ ...input(), operation: operation as never }, async () => assert.fail('execute')));
});

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
  for (const reason of [undefined, null, false, 0, new Error('admission')]) {
    await assert.rejects(withProjectWriteAuthorization({ ...input(), beforeCommit() { throw reason; } },
      async () => assert.fail('not admitted')), error => error === reason);
    assert.equal(currentProjectWriteAuthorization(), null);
  }
});

test('scope decisions do not drift while an admission fence is suspended', async () => {
  const held = deferred(), begun = deferred(); const values = input();
  const pending = withProjectWriteAuthorization({ ...values, async beforeCommit() { begun.resolve(); await held.promise; } }, async authorization => {
    assert.deepEqual(projectProjectWriteAuthorization(root, authorization).impactPaths, ['src/a.ts']);
  });
  await begun.promise; values.impactPaths[0] = 'src/b.ts'; held.resolve(); await pending;
});

test('the captured admission method preserves a private provider receiver', async () => {
  class Input {
    workspaceRoot = root; operation = 'upgrade.apply'; impactPaths = ['src/a.ts'];
    #calls = 0; async beforeCommit() { this.#calls++; } get calls() { return this.#calls; }
  }
  const values = new Input(); await withProjectWriteAuthorization(values, async () => {});
  assert.equal(values.calls, 1);
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

test('invalid callbacks are rejected before the admission fence executes', async () => {
  await assert.rejects(withProjectWriteAuthorization({ ...input(), beforeCommit: () => assert.fail('fence ran') }, null as never), TypeError);
  await assert.rejects(withProjectWriteAuthorization({ ...input(), beforeCommit: 7 as never }, async () => assert.fail('execute')), TypeError);
});
