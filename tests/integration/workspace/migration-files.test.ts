import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import { withTempWorkspace } from '../../testkit/workspace.ts';
import {
  applyMigrationEntries,
  copyDirectory,
  copyFile,
  createDirectory,
  deleteFile,
  fileReplace,
  renameDirectory,
  renameFile
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

test('create-directory migration creates nested targets and preserves existing directories', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(manifestRoot, { recursive: true });
    const existingTarget = 'generated/reports/existing';
    await fs.mkdir(path.join(workspaceRoot, existingTarget), { recursive: true });
    const retainedFile = path.join(workspaceRoot, existingTarget, 'retained.txt');
    await fs.writeFile(retainedFile, 'existing content\n', 'utf8');

    const nestedTarget = 'new-generated/reports/snapshots';
    await applyMigrationEntries(workspaceRoot, manifestRoot, [nestedTarget], [createDirectory(nestedTarget)]);
    expect((await fs.stat(path.join(workspaceRoot, nestedTarget))).isDirectory()).toBe(true);

    await applyMigrationEntries(workspaceRoot, manifestRoot, [existingTarget], [createDirectory(existingTarget)]);
    expect((await fs.stat(path.join(workspaceRoot, existingTarget))).isDirectory()).toBe(true);
    await expect(fs.readFile(retainedFile, 'utf8')).resolves.toBe('existing content\n');
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

    await expect(fs.lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
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

    await expect(fs.lstat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
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
    await expect(fs.readFile(path.join(workspaceRoot, source), 'utf8')).resolves.toBe('old\n');
    await expect(fs.readFile(path.join(workspaceRoot, target), 'utf8')).resolves.toBe('existing\n');
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

    await expect(fs.lstat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
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

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')('file migration refuses a workspace parent alias instead of writing outside the workspace', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const manifestRoot = path.join(tempRoot, 'manifest');
    const outside = path.join(tempRoot, 'outside');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const escaped = true;\n', 'utf8');
    await fs.symlink(outside, path.join(workspaceRoot, 'src'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['src/copied.ts'], [copyFile('src/copied.ts')])
    ).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
    await expect(fs.lstat(path.join(outside, 'copied.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('delete directory migrations remove project directories recursively', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeJson(path.join(workspaceRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
      status: 'obsolete'
    });

    await applyMigrationEntries(
      workspaceRoot,
      workspaceRoot,
      ['generated/reports/obsolete'],
      [
        {
          id: 'mig-delete-obsolete-report-dir',
          kind: 'delete-directory',
          reason: 'Remove obsolete generated report directory from previous upgrades.',
          target: 'generated/reports/obsolete'
        }
      ]
    );

    await expect(fs.lstat(path.join(workspaceRoot, 'generated', 'reports', 'obsolete')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }, 'engineering-compiler-upgrade-delete-directory-apply-');
});
