import { expect, test } from 'bun:test';

import { PASS_STATUS_PENDING } from '../../platform/shared/constants.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import {
  beginPass,
  completePass,
  failPass,
  invalidateDownstreamPasses,
  passState
} from '../../platform/shared/pass-kernel.ts';

function buildLock(): LockFile {
  return {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: { ...PASS_STATUS_PENDING }
  };
}

test('beginPass records a transaction and invalidates downstream passes', () => {
  const lock = buildLock();
  lock.passStatus.compose = 'succeeded';
  lock.passStatus.adapt = 'succeeded';
  lock.passStatus.verify = 'succeeded';
  lock.passStatus.lock = 'succeeded';
  lock.passStatus.emit = 'succeeded';

  const execution = beginPass(lock, 'compose');

  expect(lock.passStatus.compose).toBe('running');
  expect(execution.transactionId).toStartWith('pass:compose:');
  expect(lock.passExecutions?.compose?.status).toBe('running');
  expect(lock.passStatus.adapt).toBe('pending');
  expect(lock.passStatus.verify).toBe('pending');
  expect(lock.passStatus.repair).toBe('skipped');
  expect(lock.passStatus.lock).toBe('pending');
  expect(lock.passStatus.emit).toBe('pending');
});

test('completePass preserves transaction identity and records completion metadata', () => {
  const lock = buildLock();
  const started = beginPass(lock, 'adapt');
  const completed = completePass(lock, 'adapt', { outputRevision: 'sha256:test' });

  expect(lock.passStatus.adapt).toBe('succeeded');
  expect(completed.transactionId).toBe(started.transactionId);
  expect(completed.completedAt).toBeDefined();
  expect(completed.outputRevision).toBe('sha256:test');
  expect(passState(lock, 'adapt')).toBe('succeeded');
});

test('failPass records a stable diagnostic id and failed status', () => {
  const lock = buildLock();
  const started = beginPass(lock, 'verify');
  const failed = failPass(lock, 'verify', {
    code: 'VERIFY-FAILED-001',
    message: 'runtime tests failed'
  });

  expect(lock.passStatus.verify).toBe('failed');
  expect(failed.transactionId).toBe(started.transactionId);
  expect(failed.diagnosticIds).toEqual(['verify:VERIFY-FAILED-001:runtime tests failed']);
  expect(passState(lock, 'verify')).toBe('failed');
});

test('invalidateDownstreamPasses can be used without an existing execution ledger', () => {
  const lock = buildLock();
  lock.passStatus.verify = 'succeeded';
  lock.passStatus.lock = 'succeeded';
  lock.passStatus.emit = 'succeeded';

  invalidateDownstreamPasses(lock, 'adapt');

  expect(lock.passStatus.verify).toBe('pending');
  expect(lock.passStatus.repair).toBe('skipped');
  expect(lock.passStatus.lock).toBe('pending');
  expect(lock.passStatus.emit).toBe('pending');
  expect(lock.passExecutions?.verify?.status).toBe('pending');
});
