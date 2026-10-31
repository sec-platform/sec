import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectUpgradePreflightEvidence, loadMigrationEntries } from '../../../src/adapters/upgrade/migration-runtime.ts';
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
  renameFile,
  withMigrationWorkspace
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


test('create-directory migration creates nested targets and preserves existing directories', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manifestRoot = path.join(workspaceRoot, 'manifest');
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


test('delete-file migration removes existing file targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });

    const target = 'generated/reports/old.json';
    const targetPath = path.join(workspaceRoot, 'generated', 'reports', 'old.json');
    await fs.writeFile(targetPath, '{}\n', 'utf8');

    await applyMigrationEntries(workspaceRoot, manifestRoot, [target], [deleteFile(target)]);

    await expect(fs.lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});


test('rename-file migration moves file targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'generated', 'reports'), { recursive: true });

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


test('rename-directory migration moves directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    const source = 'generated/reports/current';
    const target = 'generated/reports/archive/current';
    const sourcePath = path.join(workspaceRoot, 'generated', 'reports', 'current');
    const targetPath = path.join(workspaceRoot, 'generated', 'reports', 'archive', 'current');
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.writeFile(path.join(sourcePath, 'summary.json'), '{"status":"old"}\n', 'utf8');

    await applyMigrationEntries(workspaceRoot, manifestRoot, [source, target], [renameDirectory(source, target)]);

    await expect(fs.lstat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(targetPath, 'summary.json'), 'utf8')).resolves.toBe('{"status":"old"}\n');
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

test('migration entry loading rejects manifest escapes, metadata mismatches and duplicate identities', async () => {
  await withMigrationWorkspace(async ({ manifestRoot }) => {
    await fs.mkdir(manifestRoot, { recursive: true });
    await expect(loadMigrationEntries(manifestRoot, 'private/block-upgrade', '0.2.0', [{
      id: 'mig-escaping-entry-file', kind: 'text-append', entry: '../escape.json',
      fromVersion: '0.1.0', toVersion: '0.2.0', requiresVerification: false
    }])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-005', details: {
        failedCheck: 'migration-file-operations', migrationId: 'mig-escaping-entry-file',
        role: 'manifest-source'
      }
    });

    await writeJson(path.join(manifestRoot, 'migrations/mismatched-entry.json'), {
      id: 'mig-actual-entry', kind: 'text-replace', reason: 'Use mismatched metadata.',
      target: 'generated/reports/notes.md', search: 'pending', replacement: 'applied'
    });
    await expect(loadMigrationEntries(manifestRoot, 'private/block-upgrade', '0.2.0', [{
      id: 'mig-expected-entry', kind: 'text-append', entry: 'migrations/mismatched-entry.json',
      fromVersion: '0.1.0', toVersion: '0.2.0', requiresVerification: false
    }])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-003', details: {
        failedCheck: 'migration-entries', migrationId: 'mig-expected-entry',
        migrationKind: 'text-append', entry: 'migrations/mismatched-entry.json',
        entryId: 'mig-actual-entry', entryKind: 'text-replace'
      }
    });

    await expect(loadMigrationEntries(manifestRoot, 'private/block-upgrade', '0.2.0', [
      { id: 'mig-duplicate-report', kind: 'text-append', entry: 'migrations/append-report-a.json',
        fromVersion: '0.1.0', toVersion: '0.2.0', requiresVerification: false },
      { id: 'mig-duplicate-report', kind: 'text-append', entry: 'migrations/append-report-b.json',
        fromVersion: '0.1.0', toVersion: '0.2.0', requiresVerification: false }
    ])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-029', details: {
        failedCheck: 'migration-entries', migrationId: 'mig-duplicate-report',
        entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
      }
    });
  });
}, 15_000);

test('migration preflight rejects project target and manifest source escapes without writes', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    await fs.mkdir(manifestRoot, { recursive: true });
    const target = 'src/installed/private/block-upgrade.ts';
    const targetPath = path.join(workspaceRoot, target);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const before = Buffer.from('original target\n');
    await fs.writeFile(targetPath, before);
    for (const scenario of [
      {
        id: 'mig-target-escape', target: '../outside.ts', source: 'files/source.ts',
        code: 'UPGRADE-MIGRATION-004', failedCheck: 'migration-targets',
        rejectedPath: '../outside.ts', role: 'target', root: 'project'
      },
      {
        id: 'mig-source-escape', target, source: '../outside-source.ts',
        code: 'UPGRADE-MIGRATION-005', failedCheck: 'migration-file-operations',
        rejectedPath: '../outside-source.ts', role: 'manifest-source', root: 'manifest'
      }
    ]) {
      await expect(collectUpgradePreflightEvidence({
        workspaceRoot, targetManifestRoot: manifestRoot,
        blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [scenario.target],
        migrationEntries: [{ id: scenario.id, kind: 'file-replace',
          reason: 'Reject a migration path outside its admitted root.',
          source: scenario.source, target: scenario.target }]
      })).rejects.toMatchObject({
        code: scenario.code, details: {
          failedCheck: scenario.failedCheck, migrationId: scenario.id,
          path: scenario.rejectedPath, role: scenario.role, root: scenario.root
        }
      });
      expect(await fs.readFile(targetPath)).toEqual(before);
    }
  });
});
