import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ConfigCache } from '../../platform/shared/config-cache.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('project-runtime contract', () => {
  test('ConfigCache returns cached result when file has not changed', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const filePath = path.join(tempRoot, 'config.json');
      await fs.writeFile(filePath, '{"value":1}\n', 'utf8');

      const cache = new ConfigCache();
      let parseCalls = 0;
      const parser = (text: string): { value: number } => {
        parseCalls += 1;
        return JSON.parse(text) as { value: number };
      };

      const first = await cache.getOrRead(filePath, parser);
      expect(first).toEqual({ value: 1 });
      expect(parseCalls).toBe(1);

      // Second async call with unchanged file returns cached result without
      // re-reading or re-parsing.
      const second = await cache.getOrRead(filePath, parser);
      expect(second).toEqual({ value: 1 });
      expect(parseCalls).toBe(1);

      // Sync variant shares the same cache entry.
      const third = cache.getOrReadSync(filePath, parser);
      expect(third).toEqual({ value: 1 });
      expect(parseCalls).toBe(1);
    }, 'engineering-compiler-config-cache-hit-');
  });

  test('ConfigCache invalidates when file mtime changes', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const filePath = path.join(tempRoot, 'config.json');
      await fs.writeFile(filePath, '{"value":1}\n', 'utf8');

      const cache = new ConfigCache();
      let parseCalls = 0;
      const parser = (text: string): { value: number } => {
        parseCalls += 1;
        return JSON.parse(text) as { value: number };
      };

      await cache.getOrRead(filePath, parser);
      expect(parseCalls).toBe(1);

      // Rewrite with different-sized content so both mtime and size change,
      // deterministically invalidating the cache entry.
      await fs.writeFile(filePath, '{"value":42}\n', 'utf8');

      const result = await cache.getOrRead(filePath, parser);
      expect(result).toEqual({ value: 42 });
      expect(parseCalls).toBe(2);
    }, 'engineering-compiler-config-cache-invalidate-');
  });

  test('compiler deps stamp file path is canonical', async () => {
    const source = await readCompilerFile('platform/shared/project-runtime.ts');

    // The stamp file lives at the canonical path under .tmp/ and is keyed on
    // package.json + bun.lock stat identity plus the runtime identity
    // (architecture, bunVersion, platform) so that runtime environment changes
    // invalidate the stamp even when package.json/bun.lock are unchanged.
    expect(source).toContain("'.tmp', 'compiler-deps.stamp.json'");
    expect(source).toContain('readCompilerDepsStamp');
    expect(source).toContain('writeCompilerDepsStamp');
    expect(source).toContain('packageJsonMtimeMs');
    expect(source).toContain('bunLockMtimeMs');
    expect(source).toContain('cachedIdentity');
    expect(source).toContain('compilerDepsRuntimeIdentity');
    expect(source).toContain('isCompilerDependencyIdentity');
  });

  test('ConfigCache module is exported from the canonical shared path', async () => {
    const source = await readCompilerFile('platform/shared/config-cache.ts');

    expect(source).toContain('export class ConfigCache');
    expect(source).toContain('getOrRead');
    expect(source).toContain('getOrReadSync');
    expect(source).toContain('getDefaultConfigCache');
  });
});
