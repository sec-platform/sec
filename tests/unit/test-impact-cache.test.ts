import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  __resetTestImpactCachesForTesting,
  flushPersistentTestImpactCache,
  hasTestImpactForFile,
  selectTestsForSources,
  TEST_IMPACT_CACHE_IDENTITY_V1
} from '../../platform/shared/test-impact-contract.ts';

const CACHE_FILE = path.join(compilerRoot, '.tmp', 'test-impact-cache.json');

// Envelope shape mirrored from test-impact-contract.ts for test-side verification.
type TestImpactCacheEnvelope = {
  schema: string;
  parserRuntimeIdentity: string;
  parserOptionsDigest: string;
  contractRevision: string;
  entries: Record<string, {
    sourceDigest: string;
    imports: Array<{ kind: 'static' | 'dynamic'; specifier: string }>;
    mtimeMs: number;
    size: number;
  }>;
};

function removeCacheFile(): void {
  try { fs.rmSync(CACHE_FILE, { force: true }); } catch { /* absent */ }
}

function readCacheEnvelope(): TestImpactCacheEnvelope {
  return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as TestImpactCacheEnvelope;
}

function computeDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Serial because these tests manipulate the shared .tmp/test-impact-cache.json
// file and reset process-internal caches. Concurrent manipulation would race.
describe('test-impact persistent cache (Issue #206 cache identity)', () => {
  test.serial('persists typed module imports in an envelope keyed on sourceDigest', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    selectTestsForSources(['platform/shared/collections.ts']);
    flushPersistentTestImpactCache();

    expect(fs.existsSync(CACHE_FILE)).toBe(true);
    const envelope = readCacheEnvelope();
    expect(envelope.schema).toBe(TEST_IMPACT_CACHE_IDENTITY_V1.schema);
    expect(envelope.parserRuntimeIdentity).toBe(TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity);
    expect(envelope.parserOptionsDigest).toBe(TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest);
    expect(envelope.contractRevision).toBe(TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision);
    expect(Object.keys(envelope.entries).length).toBeGreaterThan(0);
    for (const entry of Object.values(envelope.entries)) {
      expect(entry.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(Array.isArray(entry.imports)).toBe(true);
      expect(entry.imports.every((item) => (
        (item.kind === 'static' || item.kind === 'dynamic') && typeof item.specifier === 'string'
      ))).toBe(true);
      expect(typeof entry.mtimeMs).toBe('number');
      expect(typeof entry.size).toBe('number');
    }
  });

  test.serial('cache is loaded on simulated process restart with digest identity', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const sourceFile = 'platform/shared/collections.ts';
    const first = selectTestsForSources([sourceFile]);
    flushPersistentTestImpactCache();

    // Simulate a new process: clear all in-memory caches. The persisted cache
    // file remains on disk and should be loaded lazily on next access.
    __resetTestImpactCachesForTesting();

    const second = selectTestsForSources([sourceFile]);
    expect(second.fast).toEqual(first.fast);
    expect(second.slow).toEqual(first.slow);
    expect(second.owners).toEqual(first.owners);
  });

  test.serial('same mtime + different bytes re-transpiles via sourceDigest', () => {
    // Old mtime-based cache would treat a same-mtime entry as a hit even if
    // the file content changed. The new digest-based cache must detect the
    // content change via sourceDigest mismatch and re-transpile.
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const realTestFile = 'tests/unit/runtime-dependency-spec.test.ts';
    const realPath = path.join(compilerRoot, realTestFile);
    const realStat = fs.statSync(realPath);
    const realBytes = fs.readFileSync(realPath);
    const realDigest = computeDigest(new Uint8Array(realBytes));

    // Write a fake envelope with CORRECT mtime/size but WRONG sourceDigest.
    const fakeEnvelope: TestImpactCacheEnvelope = {
      schema: TEST_IMPACT_CACHE_IDENTITY_V1.schema,
      parserRuntimeIdentity: TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity,
      parserOptionsDigest: TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest,
      contractRevision: TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision,
      entries: {
        [realTestFile]: {
          sourceDigest: `sha256:${'0'.repeat(64)}`,
          imports: [{ kind: 'static', specifier: './fake-import' }],
          mtimeMs: realStat.mtimeMs,
          size: realStat.size
        }
      }
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fakeEnvelope), 'utf8');

    selectTestsForSources(['platform/shared/collections.ts']);
    flushPersistentTestImpactCache();

    const envelope = readCacheEnvelope();
    const entry = envelope.entries[realTestFile];
    expect(entry).toBeDefined();
    expect(entry.sourceDigest).toBe(realDigest);
    expect(entry.imports.map((item) => item.specifier)).not.toContain('./fake-import');
  });

  test.serial('envelope schema revision mismatch discards entire cache', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const realTestFile = 'tests/unit/runtime-dependency-spec.test.ts';
    const fakeEnvelope: TestImpactCacheEnvelope = {
      schema: 'sec-test-impact-cache-LEGACY',
      parserRuntimeIdentity: TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity,
      parserOptionsDigest: TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest,
      contractRevision: TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision,
      entries: {
        [realTestFile]: {
          sourceDigest: `sha256:${'0'.repeat(64)}`,
          imports: [{ kind: 'static', specifier: './legacy-import' }],
          mtimeMs: 0,
          size: 0
        }
      }
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fakeEnvelope), 'utf8');

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => { warnings.push(String(message)); };

    try {
      selectTestsForSources(['platform/shared/collections.ts']);
      flushPersistentTestImpactCache();

      // The legacy envelope must be discarded; the new envelope has the
      // current schema and the real test file's real compiler-observed imports.
      const envelope = readCacheEnvelope();
      expect(envelope.schema).toBe(TEST_IMPACT_CACHE_IDENTITY_V1.schema);
      const entry = envelope.entries[realTestFile];
      expect(entry).toBeDefined();
      expect(entry.imports.map((item) => item.specifier)).not.toContain('./legacy-import');
      expect(warnings.some((w) => w.includes('revision mismatch'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test.serial('envelope parser/contract revision mismatch discards entire cache', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const fakeEnvelope: TestImpactCacheEnvelope = {
      schema: TEST_IMPACT_CACHE_IDENTITY_V1.schema,
      parserRuntimeIdentity: 'bun-transpiler-tsx-LEGACY',
      parserOptionsDigest: TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest,
      contractRevision: TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision,
      entries: {}
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fakeEnvelope), 'utf8');

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => { warnings.push(String(message)); };

    try {
      selectTestsForSources(['platform/shared/collections.ts']);
      expect(warnings.some((w) => w.includes('revision mismatch'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test.serial('corrupt JSON cache is rejected and rebuilt with a warning', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, '{not valid json', 'utf8');

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => { warnings.push(String(message)); };

    try {
      selectTestsForSources(['platform/shared/collections.ts']);
      flushPersistentTestImpactCache();

      expect(warnings.some((w) => w.includes('corrupt'))).toBe(true);
      // After rebuild the cache file must be valid JSON with the current envelope.
      const envelope = readCacheEnvelope();
      expect(envelope.schema).toBe(TEST_IMPACT_CACHE_IDENTITY_V1.schema);
    } finally {
      console.warn = originalWarn;
    }
  });

  test.serial('unknown-shape cache (non-object) is rejected and rebuilt', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, '[]', 'utf8'); // array, not object

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => { warnings.push(String(message)); };

    try {
      selectTestsForSources(['platform/shared/collections.ts']);
      flushPersistentTestImpactCache();

      expect(warnings.some((w) => w.includes('unknown shape'))).toBe(true);
      const envelope = readCacheEnvelope();
      expect(envelope.schema).toBe(TEST_IMPACT_CACHE_IDENTITY_V1.schema);
    } finally {
      console.warn = originalWarn;
    }
  });

  test.serial('cache on and off produce byte-equivalent selection', () => {
    const sourceFile = 'platform/shared/collections.ts';

    // Cache off: reset all caches, remove cache file.
    __resetTestImpactCachesForTesting();
    removeCacheFile();
    const withoutCache = selectTestsForSources([sourceFile]);

    // Cache on: populate cache, flush, then clear in-memory (keep on-disk).
    flushPersistentTestImpactCache();
    __resetTestImpactCachesForTesting();
    const withCache = selectTestsForSources([sourceFile]);

    expect(withCache.fast).toEqual(withoutCache.fast);
    expect(withCache.slow).toEqual(withoutCache.slow);
    expect(withCache.owners).toEqual(withoutCache.owners);
  });

  test.serial('invalid cache entry is skipped without discarding siblings', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const goodTestFile = 'tests/unit/runtime-dependency-spec.test.ts';
    const goodPath = path.join(compilerRoot, goodTestFile);
    const goodStat = fs.statSync(goodPath);
    const goodBytes = fs.readFileSync(goodPath);
    const goodDigest = computeDigest(new Uint8Array(goodBytes));

    // Envelope with one valid entry and one invalid entry (missing sourceDigest).
    const fakeEnvelope = {
      schema: TEST_IMPACT_CACHE_IDENTITY_V1.schema,
      parserRuntimeIdentity: TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity,
      parserOptionsDigest: TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest,
      contractRevision: TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision,
      entries: {
        [goodTestFile]: {
          sourceDigest: goodDigest,
          imports: [],
          mtimeMs: goodStat.mtimeMs,
          size: goodStat.size
        },
        'tests/unit/bad-entry.test.ts': {
          // missing sourceDigest — invalid
          imports: [],
          mtimeMs: 0,
          size: 0
        }
      }
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fakeEnvelope), 'utf8');

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => { warnings.push(String(message)); };

    try {
      selectTestsForSources(['platform/shared/collections.ts']);
      // The valid entry should be loaded; the invalid one skipped with a warning.
      expect(warnings.some((w) => w.includes('bad-entry'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('hasTestImpactForFile (reverse-import-map backed)', () => {
  test('returns true for files matching fallback rules', () => {
    expect(hasTestImpactForFile('platform/shared/test-impact-contract.ts')).toBe(true);
  });

  test('returns true for source files referenced by tests (module-graph)', () => {
    expect(hasTestImpactForFile('platform/shared/collections.ts')).toBe(true);
  });

  test('returns false for unrecognized non-source paths', () => {
    expect(hasTestImpactForFile('fixtures/nonexistent-test-impact-file.txt')).toBe(false);
  });
});
