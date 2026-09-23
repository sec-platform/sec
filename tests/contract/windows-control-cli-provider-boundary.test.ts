import { expect, test } from 'bun:test';

import { resolveWindowsControlCliSession } from '../../src/adapters/providers/windows-control-cli/runtime/session.ts';

function request() {
  return Object.freeze({
    workingDirectoryPathHint: process.platform === 'win32' ? process.cwd() : 'C:\\sec-control-fixture',
    deadlineAtUnixMs: Date.now() + 30_000,
    maxRootObservedBytes: 128 * 1024 * 1024,
    maxExecutableObservedBytes: 128 * 1024 * 1024,
    maxRecords: 1024,
    maxCloseSettlementAttempts: 1
  });
}

test('production admission accepts only narrowing request constraints and has no Linux fallback', async () => {
  const resolution = resolveWindowsControlCliSession(request());
  if (process.platform !== 'win32') {
    expect(resolution).toEqual({
      status: 'unsupported',
      reason: 'unsupported-platform',
      detailDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    });
  } else if (process.platform === 'win32' && process.arch === 'x64') {
    if (resolution.status === 'ready') {
      expect(resolution.session.providerRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(resolution.session.observation.rootObservedBytes).toBeGreaterThan(0);
      expect((await resolution.session.close()).status).toBe('completed');
    } else {
      expect(resolution).toMatchObject({
        status: expect.stringMatching(/^(unknown|unavailable)$/u),
        reason: expect.stringMatching(/^(installed-|retained-|working-directory|session-)/u),
        detailDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      });
    }
  } else {
    expect(resolution.status).toBe('unsupported');
  }
  expect(resolveWindowsControlCliSession({
    ...request(),
    deadlineAtUnixMs: Date.now() - 1
  })).toMatchObject({ status: 'unavailable', reason: 'session-request-invalid' });
  const narrowed = resolveWindowsControlCliSession({
    ...request(),
    maxRootObservedBytes: 64 * 1024
  });
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    expect(narrowed.status).toBe('unsupported');
  } else if (narrowed.status === 'ready') {
    expect(narrowed.session.budget.maxRootObservedBytes).toBeLessThanOrEqual(64 * 1024);
    expect(narrowed.session.observation.rootObservedBytes).toBeLessThanOrEqual(64 * 1024);
    expect((await narrowed.session.close()).status).toBe('completed');
  } else {
    // An uninstalled provider or a different admission failure cannot establish
    // that the byte budget was the reason. Either way no session is granted.
    expect(narrowed.status).toMatch(/^(unknown|unavailable)$/u);
    expect(narrowed.reason).not.toBe('session-request-invalid');
  }
  const controller = new AbortController();
  controller.abort();
  const aborted = resolveWindowsControlCliSession({ ...request(), signal: controller.signal });
  if (process.platform === 'win32' && process.arch === 'x64') {
    expect(aborted).toMatchObject({ status: 'unavailable', reason: 'session-aborted' });
  } else {
    expect(aborted.status).toBe('unsupported');
  }

});

test('invalid Windows locators are rejected before provider-platform resolution', () => {
  for (const workingDirectoryPathHint of ['/tmp/sec', 'relative', 'C:\\sec\0invalid']) {
    expect(resolveWindowsControlCliSession({ ...request(), workingDirectoryPathHint }))
      .toMatchObject({ status: 'unavailable', reason: 'session-request-invalid' });
  }
});

test('resolution and terminal receipt surfaces contain no semantic or effect authority fields', async () => {
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
  const resolution = resolveWindowsControlCliSession(request());
  const keys = Object.keys(resolution);
  expect(keys.some((key) => forbiddenFields.has(key))).toBe(false);
  if (resolution.status === 'ready') {
    const receipt = await resolution.session.close();
    expect(Object.keys(receipt).some((key) => forbiddenFields.has(key))).toBe(false);
  }
});

test('ready physical session exports no raw Git or GitHub command capability', async () => {
  if (process.platform !== 'win32' || process.arch !== 'x64') return;
  const resolution = resolveWindowsControlCliSession(request());
  if (resolution.status !== 'ready') return;
  expect(Object.hasOwn(resolution.session, 'run')).toBe(false);
  expect(Object.keys(resolution.session)).not.toContain('command');
  const retiredCommandFields = [
    'counter',
    'commandCount',
    'argumentCount',
    'argumentBytes',
    'stdoutBytes',
    'stderrBytes',
    'totalOutputBytes',
    'reopenRefreshes',
    'settlementAttempts',
    'maxCommandsPerSession',
    'maxTotalArgumentBytes',
    'maxTotalOutputBytes',
    'maxReopenRefreshes',
    'maxSettlementAttempts'
  ];
  expect(retiredCommandFields.some((field) => Object.hasOwn(resolution.session, field))).toBe(false);
  expect(retiredCommandFields.some((field) => Object.hasOwn(resolution.session.budget, field))).toBe(false);
  expect(retiredCommandFields.some((field) => Object.hasOwn(resolution.session.observation, field))).toBe(false);
  const close = await resolution.session.close();
  expect(close.status).toBe('completed');
  expect(close.lifecycle).toBe('disposed');
  expect(retiredCommandFields.some((field) => Object.hasOwn(close, field))).toBe(false);
  expect(retiredCommandFields.some((field) => Object.hasOwn(close.observation, field))).toBe(false);
  expect(await resolution.session.close()).toEqual(close);
});
