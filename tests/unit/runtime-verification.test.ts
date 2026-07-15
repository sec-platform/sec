import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  buildIsolatedRuntimeEnvironment,
  bunRunInvocation,
  isolatedPlaywrightBrowsersPath,
  normalizeRuntimeVerificationLog,
  resolveHostPlaywrightBrowsersPathForTests
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

test('host Playwright cache follows the physical dependency bridge without copying', () => {
  const worktreeRoot = path.resolve('external-worktree');
  const dependencyHost = path.resolve('dependency-host');
  const canonicalCache = path.join(dependencyHost, 'canonical-playwright-cache');
  const cacheCandidate = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const resolvePhysicalPath = (value: string): string => {
    if (value === path.join(worktreeRoot, 'node_modules')) {
      return path.join(dependencyHost, 'node_modules');
    }
    if (value === cacheCandidate) return canonicalCache;
    throw new Error('physical path is unavailable');
  };

  expect(resolveHostPlaywrightBrowsersPathForTests(
    worktreeRoot,
    resolvePhysicalPath
  )).toBe(canonicalCache);
});

test('host Playwright cache unwraps a shared-deps node_modules target exactly once', () => {
  const worktreeRoot = path.resolve('shared-deps-worktree');
  const dependencyHost = path.resolve('shared-deps-host');
  const cache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const resolvePhysicalPath = (value: string): string => {
    if (value === path.join(worktreeRoot, 'node_modules')) {
      return path.join(dependencyHost, '.shared-deps', 'node_modules');
    }
    if (value === cache) return cache;
    throw new Error('physical path is unavailable');
  };

  expect(resolveHostPlaywrightBrowsersPathForTests(
    worktreeRoot,
    resolvePhysicalPath
  )).toBe(cache);
});

test('host Playwright cache falls back locally when the bridge or host cache is unavailable', () => {
  const worktreeRoot = path.resolve('fallback-worktree');
  const localCache = path.join(worktreeRoot, '.shared-deps', '.playwright-browsers');
  expect(resolveHostPlaywrightBrowsersPathForTests(worktreeRoot, () => {
    throw new Error('bridge is unavailable');
  })).toBe(localCache);

  let calls = 0;
  expect(resolveHostPlaywrightBrowsersPathForTests(worktreeRoot, () => {
    calls += 1;
    if (calls === 1) return path.join(path.resolve('dependency-host'), 'node_modules');
    throw new Error('host cache is unavailable');
  })).toBe(localCache);
});

test('staged Playwright cache remains inside the isolated process root', () => {
  const stagingRoot = path.resolve('isolated-staging-contract');
  expect(isolatedPlaywrightBrowsersPath(stagingRoot)).toBe(
    path.join(stagingRoot, '.isolated-process', 'playwright-browsers')
  );
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
