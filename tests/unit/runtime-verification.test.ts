import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  buildIsolatedRuntimeEnvironment,
  bunRunInvocation,
  isolatedPlaywrightBrowsersPath,
  normalizeRuntimeVerificationLog,
  resolveIsolatedRuntimeDependencySourcesForTests
} from '../../platform/compiler/verify/run-runtime-verification.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';

function metadata(
  identity: string,
  options: { readonly directory?: boolean; readonly symbolicLink?: boolean } = {}
) {
  return Object.freeze({
    identity,
    isDirectory: options.directory ?? true,
    isSymbolicLink: options.symbolicLink ?? false
  });
}

function pathProbe(input: {
  readonly realpaths: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, ReturnType<typeof metadata>>>;
}) {
  return {
    lstat(value: string) {
      const result = input.metadata[value];
      if (!result) throw new Error('metadata is unavailable');
      return result;
    },
    realpath(value: string) {
      const result = input.realpaths[value];
      if (!result) throw new Error('physical path is unavailable');
      return result;
    }
  };
}

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

test('isolated dependency sources freeze one external physical bridge host', () => {
  const worktreeRoot = path.resolve('external-worktree');
  const dependencyHost = path.resolve('dependency-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const nodeModules = path.join(dependencyHost, 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const result = resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: { [bridge]: nodeModules, [browserCache]: browserCache },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [nodeModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }));

  expect(result).toEqual({ nodeModules, browserCache });
  expect(Object.isFrozen(result)).toBe(true);
});

test('isolated dependency sources unwrap a shared-deps node_modules target exactly once', () => {
  const worktreeRoot = path.resolve('shared-deps-worktree');
  const dependencyHost = path.resolve('shared-deps-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const nodeModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: { [bridge]: nodeModules, [browserCache]: browserCache },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [nodeModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({ nodeModules, browserCache });
});

test('isolated dependency sources reject an aliased cache and fall back as one local pair', () => {
  const worktreeRoot = path.resolve('fallback-worktree');
  const dependencyHost = path.resolve('aliased-dependency-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const nodeModules = path.join(dependencyHost, 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const aliasedCache = path.join(path.resolve('elsewhere'), '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: { [bridge]: nodeModules, [browserCache]: aliasedCache },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [nodeModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({
    nodeModules: path.join(worktreeRoot, '.shared-deps', 'node_modules'),
    browserCache: path.join(worktreeRoot, '.shared-deps', '.playwright-browsers')
  });
});

test('writable and staged Playwright caches remain rooted in their original owners', () => {
  const stagingRoot = path.resolve('isolated-staging-contract');
  expect(isolatedPlaywrightBrowsersPath()).toBe(
    path.join(compilerRoot, '.shared-deps', '.playwright-browsers')
  );
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
