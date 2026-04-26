import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyMigrationEntries } from '../platform/upgrade/upgrade-workspace.ts';
import type { UpgradeMigrationEntry } from '../platform/shared/types.ts';

async function createWorkspace(prefix = 'engineering-compiler-upgrade-migration-'): Promise<string> {
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  return fs.mkdtemp(path.join(workspaceParent, prefix));
}

function fileReplace(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-file-replace',
    kind: 'file-replace',
    reason: 'test file replacement',
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

test('file-replace migration copies manifest source to impacted project target', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const version = "0.1.1";\n', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'src', 'target.ts'), 'export const version = "0.1.0";\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts')]);

    await expect(fs.readFile(path.join(projectRoot, 'src', 'target.ts'), 'utf8')).resolves.toBe('export const version = "0.1.1";\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

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

test('config-rewrite migration deletes nested JSON configuration keys', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'app.config.json'),
      `${JSON.stringify({ feature: { enabled: true, deprecated: true }, staleRoot: 'remove', keep: true }, null, 2)}\n`,
      'utf8'
    );

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      configRewrite('app.config.json', [
        { path: ['feature', 'deprecated'], operation: 'delete' },
        { path: ['feature', 'mode'], value: 'strict' },
        { path: ['staleRoot'], operation: 'delete' }
      ])
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          feature: {
            enabled: true,
            mode: 'strict'
          },
          keep: true
        },
        null,
        2
      )}\n`
    );
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

test('json-object-merge migration creates missing JSON targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      jsonObjectMerge('app.config.json', ['compiler'], { upgrade: { enabled: true } })
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify({ compiler: { upgrade: { enabled: true } } }, null, 2)}\n`
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

test('text-append migration appends content to existing text files', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), '- existing note\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, ['docs/upgrade-notes.md'], [
      textAppend('docs/upgrade-notes.md', '- appended note\n')
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'utf8')).resolves.toBe(
      '- existing note\n- appended note\n'
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('text-append migration creates missing text targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await applyMigrationEntries(projectRoot, manifestRoot, ['docs/upgrade-notes.md'], [
      textAppend('docs/upgrade-notes.md', '- first note\n')
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'utf8')).resolves.toBe('- first note\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('text-replace-regex migration replaces all matching text by default', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'src', 'version.ts'),
      "export const VERSION = '0.1.0';\nexport const OTHER_VERSION = '0.1.0';\n",
      'utf8'
    );

    await applyMigrationEntries(projectRoot, manifestRoot, ['src/version.ts'], [
      textReplaceRegex('src/version.ts', "VERSION = '0\\.1\\.0'", "VERSION = '0.2.0'")
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'src', 'version.ts'), 'utf8')).resolves.toBe(
      "export const VERSION = '0.2.0';\nexport const OTHER_VERSION = '0.2.0';\n"
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('text-replace-regex migration rejects non-matching text', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['src/version.ts'], [
        textReplaceRegex('src/version.ts', "VERSION = '0\\.2\\.0'", "VERSION = '0.3.0'")
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-015'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('text-replace-regex migration rejects invalid regex patterns', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['src/version.ts'], [
        textReplaceRegex('src/version.ts', '[', "VERSION = '0.2.0'")
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-014'
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

test('slot-contract-update migration records contract impact without changing files', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'custom'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'export const marker = true;\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, ['custom/customer_normalizer.ts'], [slotContractUpdate('custom/customer_normalizer.ts')]);

    await expect(fs.readFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'utf8')).resolves.toBe('export const marker = true;\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('file-replace migration rejects targets outside upgrade impacts', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'new source\n', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'src', 'target.ts'), 'old source\n', 'utf8');

    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['src/other.ts'], [fileReplace('src/target.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-007'
    });
    await expect(fs.readFile(path.join(projectRoot, 'src', 'target.ts'), 'utf8')).resolves.toBe('old source\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('file-replace migration rejects paths escaping project or manifest roots', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['../outside.ts'], [fileReplace('../outside.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-004'
    });
    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts', '../source.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-005'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
