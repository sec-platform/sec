import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBunInstall } from '../../../src/adapters/toolchain/dependencies/runtime/compiler-install-process.ts';
import {
  COMPILER_DEPENDENCY_INSTALL_ARGS, compilerInstallConfigSha256
} from '../../../src/adapters/toolchain/dependencies/runtime/compiler-materialization-input.ts';
import { issueRuntimeDependencyTestMaterialization } from '../../../src/adapters/toolchain/dependencies/runtime/materialization-fixture-capability.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

const success = { code: 0, stderr: '', stdout: 'fixture' };
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-install-invocation-'));
  return settleWorkspaceCallback(async () => {
    // Default installs write .process-runtime beside the working directory.
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    await run(workspace);
  }, () => rm(root, { recursive: true, force: true }));
}
const budgetFailure = (error: unknown) => (error as { code: string }).code === 'RUNTIME-DEPS-003';

test('the install entrypoint forwards canonical arguments and its absolute staging root', async () => fixture(async root => {
  const args = Object.freeze(['install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile']);
  // Exact compiler installation policy: no scripts, frozen lock, copyfile
  // backend and independently fixed identity input bytes.
  assert.deepEqual(COMPILER_DEPENDENCY_INSTALL_ARGS, [...args]);
  assert.ok(Object.isFrozen(COMPILER_DEPENDENCY_INSTALL_ARGS));
  // SHA-256 of {"argv":["install","--frozen-lockfile","--ignore-scripts","--backend=copyfile"],"install":null}.
  assert.equal(compilerInstallConfigSha256(null),
    '7adc8f65376e6b966462784612b15f4c749f3c522ba6df29b1182563a5bb2495');
  let count = 0, commitCount = 0;
  const result = await runBunInstall(root, {
    monotonicNowMs: () => 0,
    async beforeCommit() { commitCount++; },
    testMaterialization: issueRuntimeDependencyTestMaterialization(async request => {
      count++;
      assert.deepEqual(request.args, ['install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile']);
      assert.equal(request.cwd, root);
      assert.ok(Object.isFrozen(request.args)); return success;
    })
  }, args);
  assert.equal(count, 1); assert.ok(commitCount > 0);
  assert.deepEqual(result, { packageManager: 'bun', result: success });
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

test('installation refuses prebound-only mode and unissued materialization before clocks', async () => {
  const root = path.resolve('compiler-install-admission');
  await assert.rejects(runBunInstall(root, {
    installMode: 'prebound-only', monotonicNowMs: () => assert.fail('clock')
  }, ['install']), /Prebound-only/);
  await assert.rejects(runBunInstall(root, {
    testMaterialization: {} as never, monotonicNowMs: () => assert.fail('clock')
  }, ['install']), /owner-issued/);
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
  const result = { code: 17, stdout: 'partial', stderr: 'failed' };
  await assert.rejects(runBunInstall(root, {
    testMaterialization: issueRuntimeDependencyTestMaterialization(async () => result)
  }, ['install']), (error: unknown) => {
    const failure = error as { code: string; details: { bunResult: unknown } };
    assert.equal(failure.code, 'RUNTIME-DEPS-001'); assert.deepEqual(failure.details.bunResult, { code: 17, stdout: 'partial', stderr: 'failed' }); return true;
  });
}));
