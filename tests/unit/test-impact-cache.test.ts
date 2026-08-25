import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  __resetTestImpactCachesForTesting,
  bindTestImpactCachePhysicalCapabilityV1,
  flushPersistentTestImpactCache,
  hasTestImpactForFile,
  selectTestsForSources,
  TEST_IMPACT_CACHE_IDENTITY_V1,
  TEST_IMPACT_CACHE_MAX_BYTES_V1,
  TEST_IMPACT_CACHE_MAX_ENTRIES_V1
} from '../../platform/shared/test-impact-contract.ts';

import { compilerRoot } from '../../platform/shared/paths.ts';

const CACHE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-test-impact-cache-'));
const CACHE_FILE = path.join(CACHE_ROOT, 'current.json');
const fixtureCacheCapability = Object.freeze({
  read: (cacheFile: string): Uint8Array | null => {
    try { return fs.readFileSync(cacheFile); } catch { return null; }
  },
  replace: (cacheFile: string, bytes: Uint8Array): void => {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, Buffer.from(bytes));
    const readback = fs.readFileSync(cacheFile);
    if (!readback.equals(Buffer.from(bytes))) throw new Error('fixture cache readback mismatch');
  },
  assertCurrent: (): void => undefined
});
__resetTestImpactCachesForTesting({
  cacheFile: CACHE_FILE,
  physicalCapability: fixtureCacheCapability
});

afterAll(() => {
  __resetTestImpactCachesForTesting({ cacheFile: null, physicalCapability: null });
  fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
});

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

// Serial because these tests manipulate one isolated cache projection and
// reset process-internal caches. Concurrent manipulation would race.
describe('test-impact persistent cache (Issue #206 cache identity)', () => {
  test.serial('production binder publishes through the canonical Runtime Cache physical owner', async () => {
    const runtimeCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-test-impact-runtime-cache-'));
    try {
      __resetTestImpactCachesForTesting({ cacheFile: null, physicalCapability: null });
      const binding = await bindTestImpactCachePhysicalCapabilityV1({
        repositoryRoot: compilerRoot,
        environment: { ...process.env, SEC_CACHE_HOME: runtimeCacheRoot }
      });
      expect(binding.cacheFile.startsWith(path.resolve(runtimeCacheRoot))).toBe(true);
      expect(binding.repositoryKey).toMatch(/^sha256:[0-9a-f]{64}$/u);

      selectTestsForSources(['platform/shared/collections.ts']);
      flushPersistentTestImpactCache();
      expect(fs.existsSync(binding.cacheFile)).toBe(true);
      expect(JSON.parse(fs.readFileSync(binding.cacheFile, 'utf8'))).toMatchObject({
        schema: TEST_IMPACT_CACHE_IDENTITY_V1.schema
      });
    } finally {
      __resetTestImpactCachesForTesting({
        cacheFile: CACHE_FILE,
        physicalCapability: fixtureCacheCapability
      });
      fs.rmSync(runtimeCacheRoot, { recursive: true, force: true });
    }
  });

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

  test.serial('failed durable publication retains dirty state for the next exact retry', () => {
    let replaceAttempts = 0;
    let published: Uint8Array | null = null;
    const retryingCapability = Object.freeze({
      read: (): Uint8Array | null => published,
      replace: (_cacheFile: string, bytes: Uint8Array): void => {
        replaceAttempts += 1;
        if (replaceAttempts === 1) throw new Error('injected durable publication failure');
        published = new Uint8Array(bytes);
      },
      assertCurrent: (): void => undefined
    });
    __resetTestImpactCachesForTesting({
      cacheFile: CACHE_FILE,
      physicalCapability: retryingCapability
    });
    try {
      expect(() => selectTestsForSources(['platform/shared/collections.ts']))
        .toThrow('injected durable publication failure');
      expect(replaceAttempts).toBe(1);
      flushPersistentTestImpactCache();
      expect(replaceAttempts).toBe(2);
      expect(published).not.toBeNull();
    } finally {
      __resetTestImpactCachesForTesting({
        cacheFile: CACHE_FILE,
        physicalCapability: fixtureCacheCapability
      });
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

  test.serial('prunes entries outside the current module inventory and never leaves tmp fallback files', () => {
    __resetTestImpactCachesForTesting();
    removeCacheFile();

    const currentFile = 'tests/unit/runtime-dependency-spec.test.ts';
    const currentPath = path.join(compilerRoot, currentFile);
    const currentStat = fs.statSync(currentPath);
    const currentDigest = computeDigest(new Uint8Array(fs.readFileSync(currentPath)));
    const staleFile = 'tests/unit/removed-from-current-inventory.test.ts';
    const fakeEnvelope: TestImpactCacheEnvelope = {
      schema: TEST_IMPACT_CACHE_IDENTITY_V1.schema,
      parserRuntimeIdentity: TEST_IMPACT_CACHE_IDENTITY_V1.parserRuntimeIdentity,
      parserOptionsDigest: TEST_IMPACT_CACHE_IDENTITY_V1.parserOptionsDigest,
      contractRevision: TEST_IMPACT_CACHE_IDENTITY_V1.contractRevision,
      entries: {
        [currentFile]: {
          sourceDigest: currentDigest,
          imports: [],
          mtimeMs: currentStat.mtimeMs,
          size: currentStat.size
        },
        [staleFile]: {
          sourceDigest: `sha256:${'1'.repeat(64)}`,
          imports: [],
          mtimeMs: 0,
          size: 0
        }
      }
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fakeEnvelope), 'utf8');

    selectTestsForSources(['platform/shared/collections.ts']);
    flushPersistentTestImpactCache();

    const bytes = fs.readFileSync(CACHE_FILE);
    const envelope = readCacheEnvelope();
    expect(envelope.entries[staleFile]).toBeUndefined();
    expect(Object.keys(envelope.entries).length).toBeLessThanOrEqual(TEST_IMPACT_CACHE_MAX_ENTRIES_V1);
    expect(bytes.byteLength).toBeLessThanOrEqual(TEST_IMPACT_CACHE_MAX_BYTES_V1);
    expect(fs.readdirSync(CACHE_ROOT).some((entry) => entry.includes('.tmp'))).toBe(false);
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
