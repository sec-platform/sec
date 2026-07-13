import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  buildIsolatedRuntimeEnvironment,
  bunRunInvocation,
  normalizeRuntimeVerificationLog
} from '../../platform/compiler/verify/run-runtime-verification.ts';

test('runtime verification logs normalize elapsed durations', () => {
  expect(
    normalizeRuntimeVerificationLog('Ran 1 test across 1 file. [85.00ms]\n')
  ).toBe('Ran 1 test across 1 file. [duration]\n');
  expect(normalizeRuntimeVerificationLog('completed [1.2s]\n')).toBe('completed [duration]\n');
});

test('isolated runtime uses fixed Bun argv without auto-install', () => {
  const stagingRoot = path.resolve('isolated-staging-contract');
  const fixedConfigPath = path.join(stagingRoot, '.isolated-process', 'runtime', 'bunfig.toml');
  expect(() => bunRunInvocation('build', true)).toThrow('requires a fixed config path');
  expect(bunRunInvocation('build', true, fixedConfigPath)).toEqual({
    command: process.execPath,
    args: ['--no-env-file', `--config=${fixedConfigPath}`, '--no-install', 'run', 'build']
  });
  expect(path.relative(stagingRoot, fixedConfigPath).startsWith('..')).toBe(false);
});

test('isolated runtime environment excludes live fallbacks and contains writable homes', () => {
  const stagingRoot = path.resolve('isolated-staging-contract');
  const environment = buildIsolatedRuntimeEnvironment(stagingRoot);
  expect(environment.PATH).toBe('');
  expect(environment.NODE_OPTIONS).toBeUndefined();
  expect(environment.BUN_OPTIONS).toBeUndefined();
  expect(environment.HTTP_PROXY).toBeUndefined();
  expect(environment.OPENAI_API_KEY).toBeUndefined();
  expect(Object.values({
    HOME: environment.HOME,
    USERPROFILE: environment.USERPROFILE,
    APPDATA: environment.APPDATA,
    LOCALAPPDATA: environment.LOCALAPPDATA,
    TEMP: environment.TEMP,
    TMP: environment.TMP,
    TMPDIR: environment.TMPDIR,
    PLAYWRIGHT_BROWSERS_PATH: environment.PLAYWRIGHT_BROWSERS_PATH
  }).every((value) => typeof value === 'string' &&
    !path.relative(stagingRoot, value).startsWith('..') && !path.isAbsolute(path.relative(stagingRoot, value)))).toBe(true);
});
