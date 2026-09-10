import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createWorkspaceWithDeferredCleanup, removeWorkspaceDirectoryWithRetry, settleWorkspaceCallback, settleWorkspaceCleanups, type WorkspaceDirectoryRemoveOptions } from '../testkit/workspace-cleanup.ts';
function errnoFailure(code: string): Error & {
  code: string;
} {
  return Object.assign(new Error(code), { code });
}
function cleanupHarness(options: {
  readonly failures?: readonly unknown[];
  readonly platform?: NodeJS.Platform;
} = {}) {
  const directory = 'C:\\workspace\\owned';
  const deferredCleanupDirs = new Set([directory]);
  const failures = [...(options.failures ?? [])];
  const removeOptions: WorkspaceDirectoryRemoveOptions[] = [];
  const delays: number[] = [];
  return {
    directory,
    deferredCleanupDirs,
    removeOptions,
    delays,
    request: {
      directory,
      deferredCleanupDirs,
      seam: {
        platform: options.platform ?? 'win32',
        removeDirectory: async (requestedDirectory: string, requestedOptions: WorkspaceDirectoryRemoveOptions) => {
          assert.equal(requestedDirectory, directory);
          removeOptions.push(requestedOptions);
          if (failures.length > 0) throw failures.shift();
        },
        sleep: async (delayMs: number) => {
          delays.push(delayMs);
        }
      }
    }
  };
}
describe('testkit workspace cleanup', () => {
  test('registers a workspace for deferred cleanup immediately after creation', async () => {
    const deferredCleanupDirs = new Set<string>();
    const directory = 'C:\\workspace\\created';
    const result = await createWorkspaceWithDeferredCleanup('C:\\workspace\\prefix-', deferredCleanupDirs, async (prefix) => {
      assert.equal(prefix, 'C:\\workspace\\prefix-');
      assert.equal(deferredCleanupDirs.size, 0);
      return directory;
    });
    assert.equal(result, directory);
    assert.deepEqual(deferredCleanupDirs, new Set([directory]));
  });
  test('retries EBUSY and EPERM without delegating retries to node rm', async () => {
    const harness = cleanupHarness({
      failures: [errnoFailure('EBUSY'), errnoFailure('EPERM')],
      platform: 'linux'
    });
    await removeWorkspaceDirectoryWithRetry(harness.request);
    assert.deepEqual(harness.delays, [50, 100]);
    assert.deepEqual(harness.removeOptions, [
      { recursive: true, force: true },
      { recursive: true, force: true },
      { recursive: true, force: true }
    ]);
    assert.equal(harness.deferredCleanupDirs.size, 0);
  });
  test('retries EACCES only on win32', async () => {
    const windowsHarness = cleanupHarness({ failures: [errnoFailure('EACCES')], platform: 'win32' });
    await removeWorkspaceDirectoryWithRetry(windowsHarness.request);
    assert.deepEqual(windowsHarness.delays, [50]);
    assert.equal(windowsHarness.removeOptions.length, 2);
    assert.equal(windowsHarness.deferredCleanupDirs.size, 0);
    const posixFailure = errnoFailure('EACCES');
    const posixHarness = cleanupHarness({ failures: [posixFailure], platform: 'linux' });
    await assert.rejects(removeWorkspaceDirectoryWithRetry(posixHarness.request), error => error === posixFailure);
    assert.deepEqual(posixHarness.delays, []);
    assert.equal(posixHarness.removeOptions.length, 1);
    assert.equal(posixHarness.deferredCleanupDirs.has(posixHarness.directory), true);
  });
  test('performs at most six rm calls and retains terminal failures for deferred cleanup', async () => {
    const failures = Array.from({ length: 6 }, () => errnoFailure('EBUSY'));
    const terminalFailure = failures.at(-1)!;
    const harness = cleanupHarness({ failures });
    await assert.rejects(removeWorkspaceDirectoryWithRetry(harness.request), error => error === terminalFailure);
    assert.equal(harness.removeOptions.length, 6);
    assert.deepEqual(harness.delays, [50, 100, 200, 400, 800]);
    assert.equal(harness.deferredCleanupDirs.has(harness.directory), true);
  });
  test('does not retry an unrelated cleanup failure', async () => {
    const failure = errnoFailure('ENOENT');
    const harness = cleanupHarness({ failures: [failure] });
    await assert.rejects(removeWorkspaceDirectoryWithRetry(harness.request), error => error === failure);
    assert.equal(harness.removeOptions.length, 1);
    assert.deepEqual(harness.delays, []);
    assert.equal(harness.deferredCleanupDirs.has(harness.directory), true);
  });
  test('preserves the original callback failure and cleanup failure together', async () => {
    const primary = new Error('primary');
    const cleanupFailure = new Error('cleanup');
    let cleanupCalls = 0;
    await assert.rejects(settleWorkspaceCallback(async () => {
      throw primary;
    }, async () => {
      cleanupCalls += 1;
      throw cleanupFailure;
    }), error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanupFailure]);
      assert.equal(error.cause, primary);
      return true;
    });
    assert.equal(cleanupCalls, 1);
    assert.equal(Object.hasOwn(primary, 'cause'), false);
  });
  test('retains forensic authority without cleanup after an opted-in callback failure', async () => {
    const directory = 'C:\\workspace\\retained';
    const deferredCleanupDirs = new Set([directory]);
    const primary = new Error('primary');
    let cleanupCalls = 0;
    await assert.rejects(settleWorkspaceCallback(async () => {
      throw primary;
    }, async () => {
      cleanupCalls += 1;
    }, {
      retainOnCallbackFailure: true,
      directory,
      deferredCleanupDirs
    }), error => error === primary);
    assert.equal(cleanupCalls, 0);
    assert.equal(deferredCleanupDirs.has(directory), false);
  });
  test('fails with the original cleanup error when the callback succeeds', async () => {
    const cleanupFailure = new Error('cleanup');
    await assert.rejects(settleWorkspaceCallback(async () => 'result', async () => {
      throw cleanupFailure;
    }), error => error === cleanupFailure);
  });
  test('returns the callback result after successful cleanup', async () => {
    let cleanupCalls = 0;
    const result = await settleWorkspaceCallback(async () => ({ status: 'ok' as const }), async () => {
      cleanupCalls += 1;
    });
    assert.deepEqual(result, { status: 'ok' });
    assert.equal(cleanupCalls, 1);
  });
});

test('arbitrary primary and cleanup failures retain exact values without coercion', async () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  for (const primary of [undefined, null, false, 0, proxy]) {
    const cleanup = Object.freeze({ failed: 'cleanup' });
    await assert.rejects(settleWorkspaceCallback(async () => { throw primary; }, async () => { throw cleanup; }), error => {
      assert.ok(error instanceof AggregateError); assert.equal(error.errors[0], primary);
      assert.equal(error.errors[1], cleanup); assert.equal(error.cause, primary); return true;
    });
  }
});

test('callback mutation cannot enable forensic retention after admission', async () => {
  const options = { retainOnCallbackFailure: false, directory: 'workspace', deferredCleanupDirs: new Set(['workspace']) };
  const reason = new Error('test'); let cleaned = false;
  await assert.rejects(settleWorkspaceCallback(async () => {
    options.retainOnCallbackFailure = true; throw reason;
  }, async () => { cleaned = true; }, options as { retainOnCallbackFailure: false }), error => error === reason);
  assert.equal(cleaned, true);
});

test('cleanup method selection and platform stay fixed through retry callbacks', async () => {
  class Seam {
    #calls = 0;
    platform: NodeJS.Platform = 'win32';
    async removeDirectory() { if (++this.#calls === 1) throw errnoFailure('EACCES'); }
    async sleep() { this.platform = 'linux'; this.removeDirectory = async () => assert.fail('replacement'); }
    get calls() { return this.#calls; }
  }
  const seam = new Seam(), directories = new Set(['directory']);
  await removeWorkspaceDirectoryWithRetry({ directory: 'directory', deferredCleanupDirs: directories, seam });
  assert.equal(seam.calls, 2); assert.equal(directories.size, 0);
});

test('error classification does not throw a secondary accessor or proxy error', async () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  for (const reason of [proxy, { get code() { throw new Error('getter'); } }, undefined]) {
    const f = cleanupHarness({ failures: [reason] });
    // assert.rejects transports the caught value through another Promise;
    // a revoked Proxy cannot safely be returned through thenable assimilation.
    let rejected = false;
    try { await removeWorkspaceDirectoryWithRetry(f.request); }
    catch (error) { rejected = true; assert.equal(error, reason); }
    assert.equal(rejected, true);
    assert.equal(f.removeOptions.length, 1); assert.deepEqual(f.delays, []);
    assert.ok(f.deferredCleanupDirs.has(f.directory));
  }
});

test('failed retry wait preserves the outstanding removal error', async () => {
  const removal = errnoFailure('EBUSY'), sleep = new Error('timer'); const f = cleanupHarness({ failures: [removal] });
  f.request.seam.sleep = async () => { throw sleep; };
  await assert.rejects(removeWorkspaceDirectoryWithRetry(f.request), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [removal, sleep]); return true;
  });
  assert.ok(f.deferredCleanupDirs.has(f.directory));
});

test('independent cleanups all run and settle before enclosing cleanup or failure', async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const primary = new Error('first'), later = new Error('later'), events: string[] = [];
  let returned = false;
  const pending = settleWorkspaceCallback(() => settleWorkspaceCleanups([
    async () => { events.push('first'); throw primary; },
    async () => { entered(); await held; events.push('second'); throw later; },
    async () => { events.push('third'); }
  ]), async () => { events.push('parent'); }).finally(() => { returned = true; });
  const result = assert.rejects(pending, error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, later]); return true;
  });
  try { await started; await new Promise(r => setTimeout(r, 0)); assert.equal(returned, false); assert.equal(events.includes('parent'), false); }
  finally { release(); }
  await result; assert.equal(events.at(-1), 'parent'); assert.ok(events.includes('third'));
});

test('one cleanup rejection stays exact and invalid attempt sets start nothing', async () => {
  await assert.rejects(settleWorkspaceCleanups([async () => { throw undefined; }]), error => error === undefined);
  await assert.rejects(settleWorkspaceCleanups([async () => assert.fail('started'), null as never]), TypeError);
  await settleWorkspaceCleanups([]);
});
