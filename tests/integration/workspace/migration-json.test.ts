import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectUpgradePreflightEvidence, loadMigrationEntries } from '../../../src/adapters/upgrade/migration-runtime.ts';
import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import {
  configRewrite,
  jsonArrayAppend,
  jsonArrayRemove,
  jsonObjectMerge,
  fileReplace,
  deleteFile,
  withMigrationWorkspace
} from './migration-fixtures.ts';

test('file and JSON migrations refuse directory targets without mutating them', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot, manifestRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, 'app.config.json'));

    for (const entry of [
      configRewrite('app.config.json', [{ path: ['feature', 'enabled'], value: true }]),
      jsonArrayAppend('app.config.json', ['plugins'], ['tenant'])
    ]) {
      await expect(apply(['app.config.json'], [entry])).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-017'
      });
    }

    const replacementTarget = 'src/target.ts';
    const deletionTarget = 'generated/reports';
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, replacementTarget), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, deletionTarget), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'),
      'export const version = "0.1.1";\n', 'utf8');

    const [replacement] = await Promise.allSettled([
      apply([replacementTarget], [fileReplace(replacementTarget)])
    ]);
    const [deletion] = await Promise.allSettled([
      apply([deletionTarget], [deleteFile(deletionTarget)])
    ]);
    expect(replacement).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-017' } });
    expect(deletion).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-017' } });
    expect((await fs.stat(path.join(workspaceRoot, replacementTarget))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(workspaceRoot, deletionTarget))).isDirectory()).toBe(true);
  });
}, 15_000);

test('config-rewrite migration updates and deletes nested and root JSON configuration', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {
      feature: { enabled: false, deprecated: true },
      staleRoot: 'remove',
      untouched: true
    });

    await apply(['app.config.json'], [
      configRewrite('app.config.json', [
        { path: ['feature', 'enabled'], value: true },
        { path: ['feature', 'mode'], value: 'strict' },
        { path: ['compiler', 'upgrade'], value: '0.2' },
        { path: ['feature', 'deprecated'], operation: 'delete' },
        { path: ['staleRoot'], operation: 'delete' }
      ])
    ]);

    expect(JSON.parse(await fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8'))).toEqual({
      feature: {
        enabled: true,
        mode: 'strict'
      },
      untouched: true,
      compiler: {
        upgrade: '0.2'
      }
    });
  });
});

test('JSON missing targets preserve config-rewrite failure and array-remove no-op', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await expect(
      apply(['app.config.json'], [
        configRewrite('app.config.json', [{ path: ['feature', 'enabled'], value: true }])
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-016'
    });

    await apply(['missing.config.json'], [
      jsonArrayRemove('missing.config.json', ['plugins'], ['auth'])
    ]);
    await expect(fs.lstat(path.join(workspaceRoot, 'missing.config.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
}, 10_000);

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

    expect(JSON.parse(await fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8'))).toEqual({
      plugins: ['auth', 'tenant'],
      feature: {
        flags: [{ id: 'existing' }, { id: 'new' }],
        owners: ['platform']
      }
    });
  });
});

test('JSON array mutations and object merge reject non-container targets unchanged', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    const target = 'app.config.json';
    const filePath = path.join(workspaceRoot, target);
    await writeJson(filePath, { plugins: 'auth' });
    const before = await fs.readFile(filePath);

    // Both distinct operation consumers retain an independent error witness,
    // but share the identical immutable scalar input and isolated root.
    const [append] = await Promise.allSettled([
      apply([target], [jsonArrayAppend(target, ['plugins'], ['tenant'])])
    ]);
    const [remove] = await Promise.allSettled([
      apply([target], [jsonArrayRemove(target, ['plugins'], ['auth'])])
    ]);
    expect(append).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-012' } });
    expect(remove).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-012' } });
    expect(await fs.readFile(filePath)).toEqual(before);

    const mergeTarget = 'feature.config.json';
    const mergeFile = path.join(workspaceRoot, mergeTarget);
    await writeJson(mergeFile, { feature: { flags: [] } });
    const beforeMerge = await fs.readFile(mergeFile);
    await expect(apply([mergeTarget], [
      jsonObjectMerge(mergeTarget, ['feature', 'flags'], { enabled: true })
    ])).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-013' });
    expect(await fs.readFile(mergeFile)).toEqual(beforeMerge);
  });
}, 15_000);

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

    expect(JSON.parse(await fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8'))).toEqual({
      plugins: ['auth', 'legacy'],
      feature: {
        flags: [{ id: 'keep' }]
      }
    });
  });
});


test('json-object-merge migration creates missing targets and recursively merges nested objects', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await apply(['new.config.json'], [
      jsonObjectMerge('new.config.json', ['compiler'], { upgrade: { enabled: true } })
    ]);
    expect(JSON.parse(await fs.readFile(path.join(workspaceRoot, 'new.config.json'), 'utf8'))).toEqual(
      { compiler: { upgrade: { enabled: true } } }
    );

    await writeJson(path.join(workspaceRoot, 'app.config.json'), {
      feature: { auth: { enabled: false, mode: 'basic' }, keep: true }
    });

    await apply(['app.config.json'], [
      jsonObjectMerge('app.config.json', ['feature'], {
        auth: { enabled: true, strategy: 'session' },
        audit: { enabled: true }
      })
    ]);

    expect(JSON.parse(await fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8'))).toEqual({
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
    });
  });
});


test('JSON object merge treats inherited Object.prototype names as absent own JSON data', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {});

    await apply(['app.config.json'], [
      jsonObjectMerge('app.config.json', ['toString'], { enabled: true })
    ]);

    const parsed = JSON.parse(
      await fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(Object.hasOwn(parsed, 'toString')).toBe(true);
    expect(parsed['toString']).toEqual({ enabled: true });
  });
});

test('migration entry loading rejects invalid JSON mutations before planning', async () => {
  await withMigrationWorkspace(async ({ manifestRoot }) => {
    for (const scenario of [
      {
        entry: configRewrite('package.json', [{ path: [], value: 'invalid' }]),
        id: 'mig-empty-config-path', file: 'empty-config-path.json', code: 'UPGRADE-MIGRATION-010'
      },
      ...['__proto__', 'constructor', 'prototype'].map(key => ({
        entry: configRewrite('app.config.json', [{ path: [key, 'polluted'], value: true }]),
        id: `mig-reserved-config-${key}`, file: `reserved-config-${key}.json`, code: 'UPGRADE-MIGRATION-030'
      })),
      {
        entry: jsonObjectMerge('app.config.json', ['feature'],
          JSON.parse('{"nested":{"constructor":{"prototype":{"polluted":true}}}}') as Record<string, unknown>),
        id: 'mig-reserved-merge-value', file: 'reserved-merge-value.json', code: 'UPGRADE-MIGRATION-030'
      }
    ]) {
      const entryPath = `migrations/${scenario.file}`;
      await writeJson(path.join(manifestRoot, entryPath), { ...scenario.entry, id: scenario.id });
      await expect(loadMigrationEntries(manifestRoot, 'private/block-upgrade', '0.2.0', [{
        id: scenario.id, kind: scenario.entry.kind, entry: entryPath,
        fromVersion: '0.1.0', toVersion: '0.2.0', requiresVerification: false
      }])).rejects.toMatchObject({
        code: scenario.code, details: {
          failedCheck: 'migration-entries', migrationId: scenario.id,
          migrationKind: scenario.entry.kind, entry: entryPath
        }
      });
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    }
  });
});

test('migration preflight rejects scalar JSON array targets and parents without writes', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    for (const scenario of [
      { id: 'mig-json-array-append', path: ['upgradedBlocks'],
      document: { upgradedBlocks: 'auth/basic-session@0.1.0' } },
      { id: 'mig-json-array-append-nested', path: ['upgrade', 'blocks'],
      document: { upgrade: 'legacy-scalar' } }
    ]) {
      const target = `upgrade.${scenario.id}.metadata.json`;
      const before = Buffer.from(JSON.stringify(scenario.document));
      await fs.writeFile(path.join(workspaceRoot, target), before);
      await expect(collectUpgradePreflightEvidence({
        workspaceRoot, targetManifestRoot: manifestRoot,
        blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
        migrationEntries: [{ id: scenario.id, kind: 'json-array-append',
          reason: 'Append upgrade metadata.', target, path: scenario.path,
          items: ['private/block-upgrade@0.2.0'] }]
      })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-012' });
      expect(await fs.readFile(path.join(workspaceRoot, target))).toEqual(before);
    }
  });
});
