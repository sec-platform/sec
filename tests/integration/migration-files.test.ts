import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { formatJsonFile } from "../../src/contracts/json-text.ts";
import { writeJson } from "../../src/adapters/filesystem/files.ts";
import { applyMigrationEntries } from '../helpers/apply-migration-entries.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import {
  configRewrite,
  copyDirectory,
  copyFile,
  createDirectory,
  deleteFile,
  fileReplace,
  jsonArrayAppend,
  jsonArrayRemove,
  jsonObjectMerge,
  renameDirectory,
  renameFile,
  textAppend
} from './migration-fixtures.ts';

test('file-replace migration copies manifest source to impacted project target', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const version = "0.1.1";\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'src', 'target.ts'), 'export const version = "0.1.0";\n', 'utf8');

    await applyMigrationEntries(workspaceRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts')]);

    await expect(fs.readFile(path.join(workspaceRoot, 'src', 'target.ts'), 'utf8')).resolves.toBe('export const version = "0.1.1";\n');
  });
});

test('file-replace migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'src', 'target.ts'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const version = "0.1.1";\n', 'utf8');

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('copy-file migration copies manifest source to impacted project target', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const copied = true;\n', 'utf8');

    await applyMigrationEntries(workspaceRoot, manifestRoot, ['src/copied.ts'], [copyFile('src/copied.ts')]);

    await expect(fs.readFile(path.join(workspaceRoot, 'src', 'copied.ts'), 'utf8')).resolves.toBe('export const copied = true;\n');
  });
});

test('copy-file migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'src', 'copied.ts'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const copied = true;\n', 'utf8');

    await expect(applyMigrationEntries(workspaceRoot, manifestRoot, ['src/copied.ts'], [copyFile('src/copied.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('copy-directory migration copies manifest directory to impacted project target', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files', 'runtime', 'nested'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'runtime', 'route.ts'), 'export const runtime = true;\n', 'utf8');
    await fs.writeFile(
      path.join(manifestRoot, 'files', 'runtime', 'nested', 'worker.ts'),
      'export function run() { return true; }\n',
      'utf8'
    );

    await applyMigrationEntries(workspaceRoot, manifestRoot, ['modules/runtime'], [copyDirectory('modules/runtime')]);

    await expect(fs.readFile(path.join(workspaceRoot, 'modules', 'runtime', 'route.ts'), 'utf8')).resolves.toBe(
      'export const runtime = true;\n'
    );
    await expect(fs.readFile(path.join(workspaceRoot, 'modules', 'runtime', 'nested', 'worker.ts'), 'utf8')).resolves.toBe(
      'export function run() { return true; }\n'
    );
  });
});

test('copy-directory migration rejects file targets before copying', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files', 'runtime'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'modules'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'runtime', 'route.ts'), 'export const runtime = true;\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'modules', 'runtime'), 'occupied\n', 'utf8');

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['modules/runtime'], [copyDirectory('modules/runtime')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-027'
    });
    await expect(fs.readFile(path.join(workspaceRoot, 'modules', 'runtime'), 'utf8')).resolves.toBe('occupied\n');
  });
});

test('config-rewrite migration deletes nested JSON configuration keys', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await writeJson(path.join(workspaceRoot, 'app.config.json'), {
      feature: { enabled: true, deprecated: true },
      staleRoot: 'remove',
      keep: true
    });

    await applyMigrationEntries(
      workspaceRoot,
      manifestRoot,
      ['app.config.json'],
      [
        configRewrite('app.config.json', [
          { path: ['feature', 'deprecated'], operation: 'delete' },
          { path: ['feature', 'mode'], value: 'strict' },
          { path: ['staleRoot'], operation: 'delete' }
        ])
      ]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8')).resolves.toBe(
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
  });
});

test('config-rewrite migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(
        workspaceRoot,
        manifestRoot,
        ['app.config.json'],
        [configRewrite('app.config.json', [{ path: ['feature', 'enabled'], value: true }])]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('json-array-append migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['app.config.json'], [jsonArrayAppend('app.config.json', ['plugins'], ['tenant'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('json-array-remove migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['app.config.json'], [jsonArrayRemove('app.config.json', ['plugins'], ['auth'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('json-object-merge migration creates missing JSON targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await applyMigrationEntries(
      workspaceRoot,
      manifestRoot,
      ['app.config.json'],
      [jsonObjectMerge('app.config.json', ['compiler'], { upgrade: { enabled: true } })]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      formatJsonFile({ compiler: { upgrade: { enabled: true } } })
    );
  });
});

test('json-object-merge migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(
        workspaceRoot,
        manifestRoot,
        ['app.config.json'],
        [jsonObjectMerge('app.config.json', ['compiler'], { upgrade: { enabled: true } })]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('create-directory migration creates nested target directories', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports/snapshots';
    await applyMigrationEntries(workspaceRoot, manifestRoot, [target], [createDirectory(target)]);

    const snapshotsDir = path.join(workspaceRoot, 'generated', 'reports', 'snapshots');
    const stats = await fs.stat(snapshotsDir);
    expect(stats.isDirectory()).toBe(true);
  });
});

test('create-directory migration keeps existing directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    const target = 'generated/reports/snapshots';
    await fs.mkdir(path.join(workspaceRoot, target), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await applyMigrationEntries(workspaceRoot, manifestRoot, [target], [createDirectory(target)]);

    const stats = await fs.stat(path.join(workspaceRoot, target));
    expect(stats.isDirectory()).toBe(true);
  });
});

test('create-directory migration rejects file targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    const target = 'generated/reports/snapshots';
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, target), 'occupied\n', 'utf8');

    await expect(applyMigrationEntries(workspaceRoot, manifestRoot, [target], [createDirectory(target)])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-028'
    });
    await expect(fs.readFile(path.join(workspaceRoot, target), 'utf8')).resolves.toBe('occupied\n');
  });
});

test('delete-file migration removes existing file targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports/old.json';
    const targetPath = path.join(workspaceRoot, 'generated', 'reports', 'old.json');
    await fs.writeFile(targetPath, '{}\n', 'utf8');

    await applyMigrationEntries(workspaceRoot, manifestRoot, [target], [deleteFile(target)]);

    await expect(fs.access(targetPath)).rejects.toThrow();
  });
});

test('delete-file migration rejects missing targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports/missing.json';
    await expect(applyMigrationEntries(workspaceRoot, manifestRoot, [target], [deleteFile(target)])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-016'
    });
  });
});

test('delete-file migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports';
    await expect(applyMigrationEntries(workspaceRoot, manifestRoot, [target], [deleteFile(target)])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('rename-file migration moves file targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/old.json';
    const target = 'generated/reports/archive/old.json';
    const sourcePath = path.join(workspaceRoot, 'generated', 'reports', 'old.json');
    const targetPath = path.join(workspaceRoot, 'generated', 'reports', 'archive', 'old.json');
    await fs.writeFile(sourcePath, '{"status":"old"}\n', 'utf8');

    await applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameFile(source, target)]);

    await expect(fs.access(sourcePath)).rejects.toThrow();
    await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('{"status":"old"}\n');
  });
});

test('rename-file migration rejects missing sources', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/missing.json';
    const target = 'generated/reports/archive/missing.json';
    await expect(applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameFile(source, target)])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-018'
    });
  });
});

test('rename-file migration rejects directory sources', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports';
    const target = 'generated/archive';
    await expect(applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameFile(source, target)])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-019'
    });
  });
});

test('rename-file migration rejects occupied targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'archive'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/old.json';
    const target = 'generated/archive/old.json';
    await fs.writeFile(path.join(workspaceRoot, 'generated', 'reports', 'old.json'), 'old\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'generated', 'archive', 'old.json'), 'existing\n', 'utf8');

    await expect(applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameFile(source, target)])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-020'
    });
  });
});

test('rename-directory migration moves directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    const source = 'generated/reports/current';
    const target = 'generated/reports/archive/current';
    const sourcePath = path.join(workspaceRoot, 'generated', 'reports', 'current');
    const targetPath = path.join(workspaceRoot, 'generated', 'reports', 'archive', 'current');
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(sourcePath, 'summary.json'), '{"status":"old"}\n', 'utf8');

    await applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameDirectory(source, target)]);

    await expect(fs.access(sourcePath)).rejects.toThrow();
    await expect(fs.readFile(path.join(targetPath, 'summary.json'), 'utf8')).resolves.toBe('{"status":"old"}\n');
  });
});

test('rename-directory migration rejects file sources', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/current.json';
    const target = 'generated/reports/archive/current';
    await fs.writeFile(path.join(workspaceRoot, source), '{}\n', 'utf8');

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameDirectory(source, target)])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-019'
    });
  });
});

test('rename-directory migration rejects occupied targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    const source = 'generated/reports/current';
    const target = 'generated/reports/archive/current';
    await fs.mkdir(path.join(workspaceRoot, source), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, target), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameDirectory(source, target)])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-020'
    });
  });
});

test('text-append migration appends content to existing text files', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'upgrade-notes.md'), '- existing note\n', 'utf8');

    await applyMigrationEntries(
      workspaceRoot,
      manifestRoot,
      ['docs/upgrade-notes.md'],
      [textAppend('docs/upgrade-notes.md', '- appended note\n')]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'docs', 'upgrade-notes.md'), 'utf8')).resolves.toBe(
      '- existing note\n- appended note\n'
    );
  });
});

test('text-append migration creates missing text targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await applyMigrationEntries(
      workspaceRoot,
      manifestRoot,
      ['docs/upgrade-notes.md'],
      [textAppend('docs/upgrade-notes.md', '- first note\n')]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'docs', 'upgrade-notes.md'), 'utf8')).resolves.toBe('- first note\n');
  });
});

test('text-append migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'docs', 'upgrade-notes.md'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['docs/upgrade-notes.md'], [textAppend('docs/upgrade-notes.md', '- first note\n')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('file-replace migration rejects targets outside upgrade impacts', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'new source\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'src', 'target.ts'), 'old source\n', 'utf8');

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['src/other.ts'], [fileReplace('src/target.ts')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-007'
    });
    await expect(fs.readFile(path.join(workspaceRoot, 'src', 'target.ts'), 'utf8')).resolves.toBe('old source\n');
  });
});

test('file-replace migration rejects paths escaping project or manifest roots', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['../outside.ts'], [fileReplace('../outside.ts')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-004'
    });
    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts', '../source.ts')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-005'
    });
  });
});
