import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  __resetTestImpactCachesForTesting,
  flushPersistentTestImpactCache,
  hasTestImpactForFile,
  selectTestsForSources
} from '../../platform/shared/test-impact-contract.ts';

const CACHE_FILE = path.join(compilerRoot, '.tmp', 'test-impact-cache.json');

// Serial because these tests manipulate the shared .tmp/test-impact-cache.json
// file and reset process-internal caches. Concurrent manipulation would race.
describe('test-impact persistent cache', () => {
  test.serial('persists specifiers to .tmp/test-impact-cache.json keyed on mtime', () => {
    __resetTestImpactCachesForTesting();
    try { fs.rmSync(CACHE_FILE, { force: true }); } catch { /* absent */ }

    // Trigger cache population by selecting tests for a real source file that
    // is imported by tests (auto-reference mode).
    selectTestsForSources(['platform/shared/collections.ts']);
    flushPersistentTestImpactCache();

    expect(fs.existsSync(CACHE_FILE)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<
      string, { mtimeMs: number; specifiers: string[] }
    >;
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
    for (const entry of Object.values(parsed)) {
      expect(typeof entry.mtimeMs).toBe('number');
      expect(Array.isArray(entry.specifiers)).toBe(true);
    }
  });

  test.serial('cache is loaded on simulated process restart', () => {
    __resetTestImpactCachesForTesting();
    try { fs.rmSync(CACHE_FILE, { force: true }); } catch { /* absent */ }

    const sourceFile = 'platform/shared/collections.ts';
    const first = selectTestsForSources([sourceFile]);
    flushPersistentTestImpactCache();

    // Simulate a new process: clear all in-memory caches. The persisted cache
    // file remains on disk and should be loaded lazily on next access.
    __resetTestImpactCachesForTesting();

    const second = selectTestsForSources([sourceFile]);
    // Results must be identical — the persisted cache provided the same
    // specifier data without re-transpiling.
    expect(second.fast).toEqual(first.fast);
    expect(second.slow).toEqual(first.slow);
    expect(second.owners).toEqual(first.owners);
  });

  test.serial('stale mtime entries are re-transpiled', () => {
    __resetTestImpactCachesForTesting();
    try { fs.rmSync(CACHE_FILE, { force: true }); } catch { /* absent */ }

    // Write a fake cache entry with a stale mtime for a real test file.
    const realTestFile = 'tests/unit/project-runtime-stamp.test.ts';
    const realStat = fs.statSync(path.join(compilerRoot, realTestFile));
    const fakeCache = {
      [realTestFile]: { mtimeMs: realStat.mtimeMs - 1_000_000, specifiers: ['./fake-import'] }
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fakeCache), 'utf8');

    // Trigger a read of all test files via selectTestsForSources. The stale
    // entry for realTestFile should be detected (mtime mismatch) and
    // re-transpiled with the real specifiers.
    selectTestsForSources(['platform/shared/collections.ts']);
    flushPersistentTestImpactCache();

    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<
      string, { mtimeMs: number; specifiers: string[] }
    >;
    const entry = parsed[realTestFile];
    expect(entry).toBeDefined();
    expect(entry.mtimeMs).toBe(realStat.mtimeMs);
    expect(entry.specifiers).not.toContain('./fake-import');
  });
});

describe('hasTestImpactForFile (reverse-import-map backed)', () => {
  test('returns true for files matching fallback rules', () => {
    // platform/shared/test-impact-contract.ts has an explicit fallback rule
    // in testImpactFallbackRules (owner: 'test-impact').
    expect(hasTestImpactForFile('platform/shared/test-impact-contract.ts')).toBe(true);
  });

  test('returns true for source files referenced by tests (auto-reference)', () => {
    // platform/shared/collections.ts is imported by many tests; with no
    // ownership declaration matching, auto-reference mode scans the
    // reverse-import-map and finds referencing tests.
    expect(hasTestImpactForFile('platform/shared/collections.ts')).toBe(true);
  });

  test('returns false for unrecognized non-source paths', () => {
    // A .txt file under fixtures/ is not a test impact source (null kind),
    // matches no ownership declaration prefix, no fallback rule, and no test
    // imports it.
    expect(hasTestImpactForFile('fixtures/nonexistent-test-impact-file.txt')).toBe(false);
  });
});
