import { expect, spyOn, test } from 'bun:test';

import {
  semanticMutationStagedRebuildDiagnostic,
  semanticMutationStagingCopyOptions
} from '../../../src/adapters/mutation/derive-staged-mutation.ts';

test.serial('staging copy owns finite aggregate limits and one frozen monotonic deadline', async () => {
  let fenceCalls = 0, now = 1000, deadline = Number.NaN;
  let expireDuringFence = false;
  const clock = spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const options = semanticMutationStagingCopyOptions(async () => {
      await Promise.resolve();
      fenceCalls += 1;
      if (expireDuringFence) now = deadline;
    });
    for (const limit of [options.maximumEntries, options.maximumBytes]) {
      expect(Number.isSafeInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
    expect(Number.isFinite(options.deadlineAtMs)).toBe(true);
    expect(options.deadlineAtMs).toBeGreaterThan(now);
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.excludeRelativePaths)).toBe(true);
    deadline = options.deadlineAtMs;
    await options.assertCurrent();
    now = (now + deadline) / 2;
    await options.assertCurrent();
    expect(fenceCalls).toBe(2);
    expect(options.deadlineAtMs).toBe(deadline);
    expect(options.preserveFilePermissionMode).toBe(true);
    expect(options.excludeRelativePaths).toEqual([
      '.git',
      'node_modules',
      '.shared-deps',
      '.sec/semantic-mutation',
      '.sec/workspace-write-lease'
    ]);

    // The declared absolute bound must govern both sides of an awaited fence,
    // without fixing a private policy duration or renewing it on each call.
    expireDuringFence = true;
    await expect(options.assertCurrent()).rejects.toMatchObject({ code: 'SEMANTIC_MUTATION_STAGING_DEADLINE' });
    expect(fenceCalls).toBe(3);
    now = deadline + 1;
    await expect(options.assertCurrent()).rejects.toMatchObject({ code: 'SEMANTIC_MUTATION_STAGING_DEADLINE' });
    expect(fenceCalls).toBe(3);
    expect(options.deadlineAtMs).toBe(deadline);
  } finally { clock.mockRestore(); }
});

test('staging budget does not replace or swallow a failed authority fence', async () => {
  const failure = new Error('authority fence rejected');
  const options = semanticMutationStagingCopyOptions(async () => { throw failure; });
  await expect(options.assertCurrent()).rejects.toBe(failure);
});

test('staged failure diagnostics admit only a bounded own data error code', () => {
  expect(semanticMutationStagedRebuildDiagnostic(Object.assign(
    new Error('/private/workspace/secret.yaml'), { code: 'EACCES' }
  ))).toMatchObject({ details: { errorCode: 'EACCES' } });
  for (const error of [
    null,
    undefined,
    'EACCES',
    1,
    Object.create({ code: 'EACCES' }),
    { code: '/private/workspace/secret.yaml' },
    { code: 'A'.repeat(65) },
    { code: { toString: () => 'EACCES' } }
  ]) {
    const diagnostic = semanticMutationStagedRebuildDiagnostic(error);
    expect(diagnostic).toMatchObject({ details: { errorCode: 'UNKNOWN' } });
    expect(JSON.stringify(diagnostic)).not.toContain('/private/workspace');
  }
});

test('staged failure diagnostics never invoke error accessors or proxy traps', () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, 'code', {
    get() { calls += 1; throw new Error('accessor must not execute'); }
  });
  const proxy = new Proxy({}, {
    get() { calls += 1; throw new Error('get trap must not execute'); },
    getOwnPropertyDescriptor() {
      calls += 1;
      throw new Error('descriptor trap must not execute');
    }
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const error of [accessor, proxy, revoked.proxy]) {
    expect(semanticMutationStagedRebuildDiagnostic(error))
      .toMatchObject({ details: { errorCode: 'UNKNOWN' } });
  }
  expect(calls).toBe(0);
});
