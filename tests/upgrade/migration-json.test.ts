import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import { writeJson } from '../../platform/shared/fs.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { createWorkspace } from '../helpers/test-utils.ts';
import {
  configRewrite,
  jsonArrayAppend,
  jsonArrayRemove,
  jsonObjectMerge
} from './migration-fixtures.ts';

test('config-rewrite migration updates nested JSON configuration', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(projectRoot, 'app.config.json'), {
      feature: { enabled: false },
      untouched: true
    });

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      configRewrite('app.config.json', [
        { path: ['feature', 'enabled'], value: true },
        { path: ['feature', 'mode'], value: 'strict' },
        { path: ['compiler', 'upgrade'], value: '0.2' }
      ])
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          feature: {
            enabled: true,
            mode: 'strict'
          },
          untouched: true,
          compiler: {
            upgrade: '0.2'
          }
        },
        null,
        2
      )}\n`
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('config-rewrite migration rejects missing JSON targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
        configRewrite('app.config.json', [{ path: ['feature', 'enabled'], value: true }])
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-016'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-array-append migration appends unique items to nested arrays', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(projectRoot, 'app.config.json'), {
      plugins: ['auth'],
      feature: { flags: [{ id: 'existing' }] }
    });

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      jsonArrayAppend('app.config.json', ['plugins'], ['auth', 'tenant']),
      jsonArrayAppend('app.config.json', ['feature', 'flags'], [{ id: 'existing' }, { id: 'new' }]),
      jsonArrayAppend('app.config.json', ['feature', 'owners'], ['platform'])
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          plugins: ['auth', 'tenant'],
          feature: {
            flags: [{ id: 'existing' }, { id: 'new' }],
            owners: ['platform']
          }
        },
        null,
        2
      )}\n`
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-array-append migration rejects non-array targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(projectRoot, 'app.config.json'), { plugins: 'auth' });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [jsonArrayAppend('app.config.json', ['plugins'], ['tenant'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-012'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-array-remove migration removes matching items from nested arrays', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(projectRoot, 'app.config.json'), {
      plugins: ['auth', 'tenant', 'legacy'],
      feature: { flags: [{ id: 'old' }, { id: 'keep' }] }
    });

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      jsonArrayRemove('app.config.json', ['plugins'], ['tenant', 'missing']),
      jsonArrayRemove('app.config.json', ['feature', 'flags'], [{ id: 'old' }]),
      jsonArrayRemove('app.config.json', ['feature', 'owners'], ['nobody'])
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          plugins: ['auth', 'legacy'],
          feature: {
            flags: [{ id: 'keep' }]
          }
        },
        null,
        2
      )}\n`
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-array-remove migration rejects non-array targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(projectRoot, 'app.config.json'), { plugins: 'auth' });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [jsonArrayRemove('app.config.json', ['plugins'], ['auth'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-012'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-array-remove migration skips missing JSON targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await applyMigrationEntries(projectRoot, manifestRoot, ['missing.config.json'], [jsonArrayRemove('missing.config.json', ['plugins'], ['auth'])]);

    await expect(fs.access(path.join(projectRoot, 'missing.config.json'))).rejects.toThrow();
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-object-merge migration recursively merges nested objects', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(projectRoot, 'app.config.json'), {
      feature: { auth: { enabled: false, mode: 'basic' }, keep: true }
    });

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      jsonObjectMerge('app.config.json', ['feature'], {
        auth: { enabled: true, strategy: 'session' },
        audit: { enabled: true }
      })
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
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
        },
        null,
        2
      )}\n`
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-object-merge migration rejects non-object targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(projectRoot, 'app.config.json'), { feature: { flags: [] } });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [jsonObjectMerge('app.config.json', ['feature', 'flags'], { enabled: true })])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-013'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('config-rewrite migration rejects empty update paths', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'app.config.json'), '{}\n', 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [configRewrite('app.config.json', [{ path: [], value: true }])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-010'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
