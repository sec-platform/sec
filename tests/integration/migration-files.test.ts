import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { formatJsonFile, writeJson } from '../../platform/shared/fs.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { createWorkspace } from '../testkit/workspace.ts';
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
  slotContractUpdate,
  textAppend
} from './migration-fixtures.ts';

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

test('file-replace migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'src', 'target.ts'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const version = "0.1.1";\n', 'utf8');

    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('copy-file migration copies manifest source to impacted project target', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const copied = true;\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, ['src/copied.ts'], [copyFile('src/copied.ts')]);

    await expect(fs.readFile(path.join(projectRoot, 'src', 'copied.ts'), 'utf8')).resolves.toBe('export const copied = true;\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('copy-file migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'src', 'copied.ts'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const copied = true;\n', 'utf8');

    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['src/copied.ts'], [copyFile('src/copied.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('copy-directory migration copies manifest directory to impacted project target', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files', 'runtime', 'nested'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'runtime', 'route.ts'), 'export const runtime = true;\n', 'utf8');
    await fs.writeFile(path.join(manifestRoot, 'files', 'runtime', 'nested', 'view.tsx'), 'export default function View() { return null; }\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, ['app/runtime'], [copyDirectory('app/runtime')]);

    await expect(fs.readFile(path.join(projectRoot, 'app', 'runtime', 'route.ts'), 'utf8')).resolves.toBe('export const runtime = true;\n');
    await expect(fs.readFile(path.join(projectRoot, 'app', 'runtime', 'nested', 'view.tsx'), 'utf8')).resolves.toBe('export default function View() { return null; }\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('copy-directory migration rejects file targets before copying', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files', 'runtime'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'app'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'runtime', 'route.ts'), 'export const runtime = true;\n', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'app', 'runtime'), 'occupied\n', 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app/runtime'], [copyDirectory('app/runtime')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-027'
    });
    await expect(fs.readFile(path.join(projectRoot, 'app', 'runtime'), 'utf8')).resolves.toBe('occupied\n');
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
    await writeJson(path.join(projectRoot, 'app.config.json'), {
      feature: { enabled: true, deprecated: true },
      staleRoot: 'remove',
      keep: true
    });

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

test('config-rewrite migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
        configRewrite('app.config.json', [{ path: ['feature', 'enabled'], value: true }])
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-array-append migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [jsonArrayAppend('app.config.json', ['plugins'], ['tenant'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-array-remove migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [jsonArrayRemove('app.config.json', ['plugins'], ['auth'])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
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
      formatJsonFile({ compiler: { upgrade: { enabled: true } } })
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('json-object-merge migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'app.config.json'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
        jsonObjectMerge('app.config.json', ['compiler'], { upgrade: { enabled: true } })
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('create-directory migration creates nested target directories', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports/snapshots';
    await applyMigrationEntries(projectRoot, manifestRoot, [target], [createDirectory(target)]);

    const snapshotsDir = path.join(projectRoot, 'generated', 'reports', 'snapshots');
    const stats = await fs.stat(snapshotsDir);
    expect(stats.isDirectory()).toBe(true);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('create-directory migration keeps existing directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    const target = 'generated/reports/snapshots';
    await fs.mkdir(path.join(projectRoot, target), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await applyMigrationEntries(projectRoot, manifestRoot, [target], [createDirectory(target)]);

    const stats = await fs.stat(path.join(projectRoot, target));
    expect(stats.isDirectory()).toBe(true);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('create-directory migration rejects file targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    const target = 'generated/reports/snapshots';
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, target), 'occupied\n', 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, [target], [createDirectory(target)])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-028'
    });
    await expect(fs.readFile(path.join(projectRoot, target), 'utf8')).resolves.toBe('occupied\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('delete-file migration removes existing file targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports/old.json';
    const targetPath = path.join(projectRoot, 'generated', 'reports', 'old.json');
    await fs.writeFile(targetPath, '{}\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, [target], [deleteFile(target)]);

    await expect(fs.access(targetPath)).rejects.toThrow();
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('delete-file migration rejects missing targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports/missing.json';
    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, [target], [deleteFile(target)])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-016'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('delete-file migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const target = 'generated/reports';
    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, [target], [deleteFile(target)])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rename-file migration moves file targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/old.json';
    const target = 'generated/reports/archive/old.json';
    const sourcePath = path.join(projectRoot, 'generated', 'reports', 'old.json');
    const targetPath = path.join(projectRoot, 'generated', 'reports', 'archive', 'old.json');
    await fs.writeFile(sourcePath, '{"status":"old"}\n', 'utf8');

    await applyMigrationEntries(
      projectRoot,
      manifestRoot,
      [source, target],
      [renameFile(source, target)]
    );

    await expect(fs.access(sourcePath)).rejects.toThrow();
    await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('{"status":"old"}\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rename-file migration rejects missing sources', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/missing.json';
    const target = 'generated/reports/archive/missing.json';
    await expect(
      applyMigrationEntries(
        projectRoot,
        manifestRoot,
        [source, target],
        [renameFile(source, target)]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-018'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rename-file migration rejects directory sources', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports';
    const target = 'generated/archive';
    await expect(
      applyMigrationEntries(
        projectRoot,
        manifestRoot,
        [source, target],
        [renameFile(source, target)]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-019'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rename-file migration rejects occupied targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'generated', 'archive'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/old.json';
    const target = 'generated/archive/old.json';
    await fs.writeFile(path.join(projectRoot, 'generated', 'reports', 'old.json'), 'old\n', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'generated', 'archive', 'old.json'), 'existing\n', 'utf8');

    await expect(
      applyMigrationEntries(
        projectRoot,
        manifestRoot,
        [source, target],
        [renameFile(source, target)]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-020'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rename-directory migration moves directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    const source = 'generated/reports/current';
    const target = 'generated/reports/archive/current';
    const sourcePath = path.join(projectRoot, 'generated', 'reports', 'current');
    const targetPath = path.join(projectRoot, 'generated', 'reports', 'archive', 'current');
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(sourcePath, 'summary.json'), '{"status":"old"}\n', 'utf8');

    await applyMigrationEntries(
      projectRoot,
      manifestRoot,
      [source, target],
      [renameDirectory(source, target)]
    );

    await expect(fs.access(sourcePath)).rejects.toThrow();
    await expect(fs.readFile(path.join(targetPath, 'summary.json'), 'utf8')).resolves.toBe('{"status":"old"}\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rename-directory migration rejects file sources', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    const source = 'generated/reports/current.json';
    const target = 'generated/reports/archive/current';
    await fs.writeFile(path.join(projectRoot, source), '{}\n', 'utf8');

    await expect(
      applyMigrationEntries(
        projectRoot,
        manifestRoot,
        [source, target],
        [renameDirectory(source, target)]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-019'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rename-directory migration rejects occupied targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    const source = 'generated/reports/current';
    const target = 'generated/reports/archive/current';
    await fs.mkdir(path.join(projectRoot, source), { recursive: true });
    await fs.mkdir(path.join(projectRoot, target), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(
        projectRoot,
        manifestRoot,
        [source, target],
        [renameDirectory(source, target)]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-020'
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

test('text-append migration rejects directory targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'docs', 'upgrade-notes.md'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['docs/upgrade-notes.md'], [
        textAppend('docs/upgrade-notes.md', '- first note\n')
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('slot-contract-update migration verifies custom slot target without changing files', async () => {
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

test('slot-contract-update migration rejects directory custom slot targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(
        projectRoot,
        manifestRoot,
        ['custom/customer_normalizer.ts'],
        [slotContractUpdate('custom/customer_normalizer.ts')]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
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
