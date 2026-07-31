import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
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

// Envelope shape mirrored from test-impact-contract.ts for test-side verification.
type TestImpactCacheEnvelope = {
  schema: string;
  parserRuntimeIdentity: string;
  parserOptionsDigest: string;
  contractRevision: string;
  entries: Record<string, {
    sourceDigest: string;
    specifiers: string[];
    mtimeMs: number;
    size: number;
  }>;
};

const EXPECTED_SCHEMA = 'sec-test-impact-cache-v2';
const EXPECTED_PARSER_RUNTIME = 'bun-transpiler-tsx-v1';
const EXPECTED_PARSER_OPTIONS_DIGEST = `sha256:${createHash('sha256')
  .update(JSON.stringify({ loader: 'tsx' })).digest('hex')}`;
const EXPECTED_CONTRACT_REVISION = 'test-impact-contract-v1';

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
  test.serial('persists specifiers in an envelope keyed on sourceDigest', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    selectTestsForSources(['platform/shared/collections.ts']);
    flushPersistentTestImpactCache();

    expect(fs.existsSync(CACHE_FILE)).toBe(true);
    const envelope = readCacheEnvelope();
    expect(envelope.schema).toBe(EXPECTED_SCHEMA);
    expect(envelope.parserRuntimeIdentity).toBe(EXPECTED_PARSER_RUNTIME);
    expect(envelope.parserOptionsDigest).toBe(EXPECTED_PARSER_OPTIONS_DIGEST);
    expect(envelope.contractRevision).toBe(EXPECTED_CONTRACT_REVISION);
    expect(Object.keys(envelope.entries).length).toBeGreaterThan(0);
    for (const entry of Object.values(envelope.entries)) {
      expect(entry.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(Array.isArray(entry.specifiers)).toBe(true);
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

    const realTestFile = 'tests/unit/project-runtime-stamp.test.ts';
    const realPath = path.join(compilerRoot, realTestFile);
    const realStat = fs.statSync(realPath);
    const realBytes = fs.readFileSync(realPath);
    const realDigest = computeDigest(new Uint8Array(realBytes));

    // Write a fake envelope with CORRECT mtime/size but WRONG sourceDigest.
    const fakeEnvelope: TestImpactCacheEnvelope = {
      schema: EXPECTED_SCHEMA,
      parserRuntimeIdentity: EXPECTED_PARSER_RUNTIME,
      parserOptionsDigest: EXPECTED_PARSER_OPTIONS_DIGEST,
      contractRevision: EXPECTED_CONTRACT_REVISION,
      entries: {
        [realTestFile]: {
          sourceDigest: `sha256:${'0'.repeat(64)}`,
          specifiers: ['./fake-import'],
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
    expect(entry.specifiers).not.toContain('./fake-import');
  });

  test.serial('envelope schema revision mismatch discards entire cache', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const realTestFile = 'tests/unit/project-runtime-stamp.test.ts';
    const fakeEnvelope: TestImpactCacheEnvelope = {
      schema: 'sec-test-impact-cache-LEGACY',
      parserRuntimeIdentity: EXPECTED_PARSER_RUNTIME,
      parserOptionsDigest: EXPECTED_PARSER_OPTIONS_DIGEST,
      contractRevision: EXPECTED_CONTRACT_REVISION,
      entries: {
        [realTestFile]: {
          sourceDigest: `sha256:${'0'.repeat(64)}`,
          specifiers: ['./legacy-import'],
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
      // current schema and the real test file's real specifiers.
      const envelope = readCacheEnvelope();
      expect(envelope.schema).toBe(EXPECTED_SCHEMA);
      const entry = envelope.entries[realTestFile];
      expect(entry).toBeDefined();
      expect(entry.specifiers).not.toContain('./legacy-import');
      expect(warnings.some((w) => w.includes('revision mismatch'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test.serial('envelope parser/contract revision mismatch discards entire cache', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const fakeEnvelope: TestImpactCacheEnvelope = {
      schema: EXPECTED_SCHEMA,
      parserRuntimeIdentity: 'bun-transpiler-tsx-LEGACY',
      parserOptionsDigest: EXPECTED_PARSER_OPTIONS_DIGEST,
      contractRevision: EXPECTED_CONTRACT_REVISION,
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
      expect(envelope.schema).toBe(EXPECTED_SCHEMA);
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
      expect(envelope.schema).toBe(EXPECTED_SCHEMA);
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

    const goodTestFile = 'tests/unit/project-runtime-stamp.test.ts';
    const goodPath = path.join(compilerRoot, goodTestFile);
    const goodStat = fs.statSync(goodPath);
    const goodBytes = fs.readFileSync(goodPath);
    const goodDigest = computeDigest(new Uint8Array(goodBytes));

    // Envelope with one valid entry and one invalid entry (missing sourceDigest).
    const fakeEnvelope = {
      schema: EXPECTED_SCHEMA,
      parserRuntimeIdentity: EXPECTED_PARSER_RUNTIME,
      parserOptionsDigest: EXPECTED_PARSER_OPTIONS_DIGEST,
      contractRevision: EXPECTED_CONTRACT_REVISION,
      entries: {
        [goodTestFile]: {
          sourceDigest: goodDigest,
          specifiers: [],
          mtimeMs: goodStat.mtimeMs,
          size: goodStat.size
        },
        'tests/unit/bad-entry.test.ts': {
          // missing sourceDigest — invalid
          specifiers: [],
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

  test('returns true for source files referenced by tests (auto-reference)', () => {
    expect(hasTestImpactForFile('platform/shared/collections.ts')).toBe(true);
  });

  test('returns false for unrecognized non-source paths', () => {
    expect(hasTestImpactForFile('fixtures/nonexistent-test-impact-file.txt')).toBe(false);
  });
});
