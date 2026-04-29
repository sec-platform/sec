import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import type { UpgradeMigrationEntry } from '../../platform/shared/types.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

function fileReplace(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-file-replace',
    kind: 'file-replace',
    reason: 'test file replacement',
    source,
    target
  };
}

function copyFile(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-copy-file',
    kind: 'copy-file',
    reason: 'test file copy',
    source,
    target
  };
}

function copyDirectory(target: string, source = 'files/runtime'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-copy-directory',
    kind: 'copy-directory',
    reason: 'test directory copy',
    source,
    target
  };
}

function configRewrite(target: string, updates: Array<{ path: string[]; value?: unknown; operation?: 'set' | 'delete' }>): UpgradeMigrationEntry {
  return {
    id: 'mig-test-config-rewrite',
    kind: 'config-rewrite',
    reason: 'test config rewrite',
    target,
    updates
  };
}

function jsonArrayAppend(target: string, pathSegments: string[], items: unknown[]): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-array-append',
    kind: 'json-array-append',
    reason: 'test JSON array append',
    target,
    path: pathSegments,
    items
  };
}

function jsonArrayRemove(target: string, pathSegments: string[], items: unknown[]): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-array-remove',
    kind: 'json-array-remove',
    reason: 'test JSON array remove',
    target,
    path: pathSegments,
    items
  };
}

function jsonObjectMerge(target: string, pathSegments: string[], value: Record<string, unknown>): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-object-merge',
    kind: 'json-object-merge',
    reason: 'test JSON object merge',
    target,
    path: pathSegments,
    value
  };
}

function textAppend(target: string, content: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-text-append',
    kind: 'text-append',
    reason: 'test text append',
    target,
    content
  };
}

function createDirectory(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-create-directory',
    kind: 'create-directory',
    reason: 'test directory creation',
    target
  };
}

function deleteFile(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-delete-file',
    kind: 'delete-file',
    reason: 'test file deletion',
    target
  };
}

function renameFile(source: string, target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-rename-file',
    kind: 'rename-file',
    reason: 'test file rename',
    source,
    target
  };
}

function renameDirectory(source: string, target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-rename-directory',
    kind: 'rename-directory',
    reason: 'test directory rename',
    source,
    target
  };
}

function textReplaceRegex(target: string, pattern: string, replacement: string, flags?: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-text-replace-regex',
    kind: 'text-replace-regex',
    reason: 'test regex text replacement',
    target,
    pattern,
    replacement,
    ...(flags ? { flags } : {})
  };
}

function slotContractUpdate(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-slot-contract-update',
    kind: 'slot-contract-update',
    reason: 'test slot contract update',
    target,
    slotId: 'customer_normalizer',
    inputType: 'CustomerInputV2',
    outputType: 'CustomerRecordInput',
    writableZones: [target]
  };
}

test('config-rewrite migration updates nested JSON configuration', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'app.config.json'),
      `${JSON.stringify({ feature: { enabled: false }, untouched: true }, null, 2)}\n`,
      'utf8'
    );

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
    await fs.writeFile(
      path.join(projectRoot, 'app.config.json'),
      `${JSON.stringify({ plugins: ['auth'], feature: { flags: [{ id: 'existing' }] } }, null, 2)}\n`,
      'utf8'
    );

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
    await fs.writeFile(path.join(projectRoot, 'app.config.json'), `${JSON.stringify({ plugins: 'auth' }, null, 2)}\n`, 'utf8');

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
    await fs.writeFile(
      path.join(projectRoot, 'app.config.json'),
      `${JSON.stringify({ plugins: ['auth', 'tenant', 'legacy'], feature: { flags: [{ id: 'old' }, { id: 'keep' }] } }, null, 2)}\n`,
      'utf8'
    );

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
    await fs.writeFile(path.join(projectRoot, 'app.config.json'), `${JSON.stringify({ plugins: 'auth' }, null, 2)}\n`, 'utf8');

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
    await fs.writeFile(
      path.join(projectRoot, 'app.config.json'),
      `${JSON.stringify({ feature: { auth: { enabled: false, mode: 'basic' }, keep: true } }, null, 2)}\n`,
      'utf8'
    );

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
    await fs.writeFile(path.join(projectRoot, 'app.config.json'), `${JSON.stringify({ feature: { flags: [] } }, null, 2)}\n`, 'utf8');

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
