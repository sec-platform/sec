import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { formatJsonFile, writeJson } from '../../src/workspace/files.ts';
import {
  configRewrite,
  jsonArrayAppend,
  jsonArrayRemove,
  jsonObjectMerge,
  withMigrationWorkspace
} from './migration-fixtures.ts';

test('config-rewrite migration updates nested JSON configuration', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {
      feature: { enabled: false },
      untouched: true
    });

    await apply(['app.config.json'], [
      configRewrite('app.config.json', [
        { path: ['feature', 'enabled'], value: true },
        { path: ['feature', 'mode'], value: 'strict' },
        { path: ['compiler', 'upgrade'], value: '0.2' }
      ])
    ]);

    await expect(fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      formatJsonFile({
        feature: {
          enabled: true,
          mode: 'strict'
        },
        untouched: true,
        compiler: {
          upgrade: '0.2'
        }
      })
    );
  });
});

test('config-rewrite migration rejects missing JSON targets', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await fs.mkdir(workspaceRoot, { recursive: true });

    await expect(
      apply(['app.config.json'], [
        configRewrite('app.config.json', [{ path: ['feature', 'enabled'], value: true }])
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-016'
    });
  });
});

test('json-array-append migration appends unique items to nested arrays', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {
      plugins: ['auth'],
      feature: { flags: [{ id: 'existing' }] }
    });

    await apply(['app.config.json'], [
      jsonArrayAppend('app.config.json', ['plugins'], ['auth', 'tenant']),
      jsonArrayAppend('app.config.json', ['feature', 'flags'], [{ id: 'existing' }, { id: 'new' }]),
      jsonArrayAppend('app.config.json', ['feature', 'owners'], ['platform'])
    ]);

    await expect(fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      formatJsonFile({
        plugins: ['auth', 'tenant'],
        feature: {
          flags: [{ id: 'existing' }, { id: 'new' }],
          owners: ['platform']
        }
      })
    );
  });
});

test('json-array-append migration rejects non-array targets', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), { plugins: 'auth' });

    await expect(
      apply(['app.config.json'], [jsonArrayAppend('app.config.json', ['plugins'], ['tenant'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-012'
    });
  });
});

test('json-array-remove migration removes matching items from nested arrays', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {
      plugins: ['auth', 'tenant', 'legacy'],
      feature: { flags: [{ id: 'old' }, { id: 'keep' }] }
    });

    await apply(['app.config.json'], [
      jsonArrayRemove('app.config.json', ['plugins'], ['tenant', 'missing']),
      jsonArrayRemove('app.config.json', ['feature', 'flags'], [{ id: 'old' }]),
      jsonArrayRemove('app.config.json', ['feature', 'owners'], ['nobody'])
    ]);

    await expect(fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      formatJsonFile({
        plugins: ['auth', 'legacy'],
        feature: {
          flags: [{ id: 'keep' }]
        }
      })
    );
  });
});

test('json-array-remove migration rejects non-array targets', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), { plugins: 'auth' });

    await expect(
      apply(['app.config.json'], [jsonArrayRemove('app.config.json', ['plugins'], ['auth'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-012'
    });
  });
});

test('json-array-remove migration skips missing JSON targets', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await fs.mkdir(workspaceRoot, { recursive: true });

    await apply(['missing.config.json'], [jsonArrayRemove('missing.config.json', ['plugins'], ['auth'])]);

    await expect(fs.access(path.join(workspaceRoot, 'missing.config.json'))).rejects.toThrow();
  });
});

test('json-object-merge migration recursively merges nested objects', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {
      feature: { auth: { enabled: false, mode: 'basic' }, keep: true }
    });

    await apply(['app.config.json'], [
      jsonObjectMerge('app.config.json', ['feature'], {
        auth: { enabled: true, strategy: 'session' },
        audit: { enabled: true }
      })
    ]);

    await expect(fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      formatJsonFile({
        feature: {
          auth: {
            enabled: true,
            mode: 'basic',
            strategy: 'session'
          },
          keep: true,
          audit: {
            enabled: true
          }
        }
      })
    );
  });
});

test('json-object-merge migration rejects non-object targets', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), { feature: { flags: [] } });

    await expect(
      apply(['app.config.json'], [
        jsonObjectMerge('app.config.json', ['feature', 'flags'], { enabled: true })
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-013'
    });
  });
});

test('config-rewrite migration rejects empty update paths', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {});

    await expect(
      apply(['app.config.json'], [configRewrite('app.config.json', [{ path: [], value: true }])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-010'
    });
  });
});
