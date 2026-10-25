import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBunInstall } from '../../../src/adapters/toolchain/dependencies/runtime/compiler-install-process.ts';
import { issueRuntimeDependencyTestMaterialization } from '../../../src/adapters/toolchain/dependencies/runtime/materialization-fixture-capability.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

const success = { code: 0, stderr: '', stdout: 'fixture' };
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-install-invocation-'));
  return settleWorkspaceCallback(() => run(root), () => rm(root, { recursive: true, force: true }));
}
const budgetFailure = (error: unknown) => (error as { code: string }).code === 'RUNTIME-DEPS-003';

test('the install entrypoint captures argv, cwd and capabilities before clock and fence callbacks', async () => fixture(async root => {
  const initial = process.cwd();
  const args = ['install', '--frozen-lockfile'];
  let count = 0;
  let commitCount = 0;
  const options = {
    monotonicNowMs: () => {
      args[0] = 'clock-replaced';
      options.beforeCommit = async () => assert.fail('clock-replaced fence ran');
      return 0;
    },
    async beforeCommit() {
      assert.equal(this, options);
      commitCount++; args[1] = 'fence-replaced'; process.chdir(tmpdir());
      options.testMaterialization = issueRuntimeDependencyTestMaterialization(async () => assert.fail('replacement ran'));
      options.beforeCommit = async () => assert.fail('replacement fence ran');
    },
    testMaterialization: issueRuntimeDependencyTestMaterialization(async request => {
      count++; assert.deepEqual(request.args, ['install', '--frozen-lockfile']);
      assert.equal(request.cwd, root);
      assert.ok(Object.isFrozen(request.args)); return success;
    })
  };
  try {
    process.chdir(root);
    const result = await runBunInstall('.', options, args, 'cache');
    assert.equal(count, 1); assert.ok(commitCount > 0);
    assert.deepEqual(result, { packageManager: 'bun', result: success });
  } finally { process.chdir(initial); }
}));

test('time spent materializing is charged to the original budget rather than a fresh fallback', async () => fixture(async root => {
  let now = 0;
  await assert.rejects(runBunInstall(root, {
    lockTimeoutMs: 100, monotonicNowMs: () => now,
    testMaterialization: issueRuntimeDependencyTestMaterialization(async () => { now = 101; return success; })
  }, ['install']), budgetFailure);
}));

test('the materializer receives the remaining budget after the input fence', async () => fixture(async root => {
  let now = 0;
  await runBunInstall(root, {
    lockTimeoutMs: 100, monotonicNowMs: () => now,
    testMaterialization: issueRuntimeDependencyTestMaterialization(async request => {
      assert.equal(request.timeoutMs, 75); return success;
    })
  }, ['install'], undefined, undefined, async () => { now = 25; });
}));

test('input fence exhaustion prevents any materialization', async () => fixture(async root => {
  let now = 0;
  await assert.rejects(runBunInstall(root, {
    lockTimeoutMs: 100, monotonicNowMs: () => now,
    testMaterialization: issueRuntimeDependencyTestMaterialization(async () => assert.fail('effect after deadline'))
  }, ['install'], undefined, undefined, async () => { now = 101; }), budgetFailure);
}));

for (const place of ['commit', 'input'] as const) {
  test(`a never-settling ${place} fence remains cancellable`, async () => fixture(async root => {
    const controller = new AbortController(), reason = Object.freeze({ place });
    const never = () => { controller.abort(reason); return new Promise<void>(() => {}); };
    await assert.rejects(runBunInstall(root, {
      signal: controller.signal,
      ...(place === 'commit' ? { beforeCommit: never } : {}),
      testMaterialization: issueRuntimeDependencyTestMaterialization(async () => assert.fail('cancelled effect'))
    }, ['install'], undefined, undefined, place === 'input' ? never : undefined), error => error === reason);
  }));
}

test('all invalid argv classes are refused before any fence', async () => {
  const root = path.resolve('compiler-install-admission');
  for (const [index, args] of ([[undefined], [7], ['nul\0arg'], new Array(1)] as unknown[]).entries()) {
    await assert.rejects(
      runBunInstall(root, {
        monotonicNowMs: () => assert.fail('premature controls'),
        beforeCommit: async () => assert.fail('premature effect')
      }, args as string[]),
      budgetFailure,
      `invalid argv case ${index}: ${JSON.stringify(args)}`
    );
  }
});

test('an argument accessor is never invoked during input admission', async () => {
  const args: string[] = [];
  Object.defineProperty(args, 0, { get() { assert.fail('argv getter'); } });
  await assert.rejects(runBunInstall(path.resolve('compiler-install-admission'), {
    monotonicNowMs: () => assert.fail('premature controls'),
    beforeCommit: async () => assert.fail('premature effect')
  }, args), budgetFailure);
});

test('offline command spelling remains intact and uses the captured absolute configuration path', async () => fixture(async root => {
  await runBunInstall(root, {
    installMode: 'offline-copy-only', monotonicNowMs: () => 0,
    testMaterialization: issueRuntimeDependencyTestMaterialization(async request => {
      assert.deepEqual(request.args, ['--no-env-file', `--config=${path.join(root, '.isolated-process', 'dependency-install', 'bunfig.toml')}`, 'install']);
      return success;
    })
  }, ['install']);
}));

test('nonzero fixture result is an execution failure with its output retained', async () => fixture(async root => {
  await fixture(async successRoot => {
    // The retired smoke test admitted a normal success with the real default
    // clock. Keep that distinct input and its bounded request in this owner.
    let successfulCalls = 0;
    let commitCalls = 0;
    const completed = await runBunInstall(successRoot, {
      lockTimeoutMs: 5_000,
      beforeCommit: async () => { commitCalls++; },
      testMaterialization: issueRuntimeDependencyTestMaterialization(async request => {
        successfulCalls++;
        assert.deepEqual(request.args, ['install', '--frozen-lockfile']);
        assert.equal(request.cwd, successRoot);
        assert.ok(request.timeoutMs > 0 && request.timeoutMs <= 5_000);
        return { code: 0, stdout: 'materialized', stderr: '' };
      })
    }, ['install', '--frozen-lockfile']);
    assert.deepEqual(completed, {
      packageManager: 'bun', result: { code: 0, stdout: 'materialized', stderr: '' }
    });
    assert.equal(successfulCalls, 1);
    assert.ok(commitCalls > 0);
  });

  const result = { code: 17, stdout: 'partial', stderr: 'failed' };
  await assert.rejects(runBunInstall(root, {
    testMaterialization: issueRuntimeDependencyTestMaterialization(async () => result)
  }, ['install']), (error: unknown) => {
    const failure = error as { code: string; details: { bunResult: unknown } };
    assert.equal(failure.code, 'RUNTIME-DEPS-001'); assert.deepEqual(failure.details.bunResult, { code: 17, stdout: 'partial', stderr: 'failed' }); return true;
  });
}));
