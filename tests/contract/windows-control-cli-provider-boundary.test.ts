import { expect, test } from 'bun:test';

import { resolveWindowsControlCliSession } from '../../src/external-capabilities/windows-control-cli/runtime/session.ts';

function request() {
  return Object.freeze({
    workingDirectoryPathHint: String.raw`C:\SEC\repository`,
    deadlineAtUnixMs: Date.now() + 30_000,
    maxCommandsPerSession: 16,
    maxTotalArgumentBytes: 64 * 1024,
    maxTotalOutputBytes: 1024 * 1024,
    maxRootObservedBytes: 1024 * 1024,
    maxExecutableObservedBytes: 64 * 1024 * 1024,
    maxRecords: 1024,
    maxReopenRefreshes: 64,
    maxSettlementAttempts: 16
  });
}

test('production admission accepts only narrowing request constraints and has no Linux fallback', () => {
  const resolution = resolveWindowsControlCliSession(request());
  if (process.platform === 'linux') {
    expect(resolution).toEqual({
      status: 'unsupported',
      reason: 'unsupported-platform',
      detailDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    });
  } else if (process.platform === 'win32' && process.arch === 'x64') {
    expect(resolution).toMatchObject({
      status: 'unknown',
      reason: 'installed-executable-capability-unproven',
      detailDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    });
  } else {
    expect(resolution.status).toBe('unsupported');
  }
  expect(resolveWindowsControlCliSession({
    ...request(),
    deadlineAtUnixMs: Date.now() - 1
  })).toMatchObject({ status: 'unavailable', reason: 'session-request-invalid' });
});

test('resolution and terminal receipt surfaces contain no semantic or effect authority fields', () => {
  const forbiddenFields = new Set([
    'credential',
    'token',
    'principal',
    'permission',
    'rest',
    'effect',
    'repository',
    'workSelection',
    'mainHealth'
  ]);
  const keys = Object.keys(resolveWindowsControlCliSession(request()));
  expect(keys.some((key) => forbiddenFields.has(key))).toBe(false);
});
