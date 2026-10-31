import { expect, test } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs/promises';

import { writeJson } from '../../../src/adapters/filesystem/files.ts';
import { collectUpgradePreflightEvidence } from '../../../src/adapters/upgrade/migration-runtime.ts';
import { copyDirectory, createDirectory, withMigrationWorkspace } from './migration-fixtures.ts';

test('migration preflight and application both reject create-directory file targets', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot, apply }) => {
    const target = 'generated/reports/snapshots';
    await writeJson(path.join(workspaceRoot, target), { occupied: true });
    const targetBytesBefore = await fs.readFile(path.join(workspaceRoot, target));
    const [preflight] = await Promise.allSettled([collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-create-snapshots-dir', kind: 'create-directory',
        reason: 'Create snapshot directory for generated reports.', target }]
    })]);
    const [application] = await Promise.allSettled([apply([target], [createDirectory(target)])]);
    expect(preflight).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-028' } });
    expect(application).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-028' } });
    expect(await fs.readFile(path.join(workspaceRoot, target))).toEqual(targetBytesBefore);
  });
}, 10_000);

test('migration preflight and application both reject copy-directory file targets', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot, apply }) => {
    const source = 'files/generated/reports/templates';
    const target = 'generated/reports/templates';
    await writeJson(path.join(manifestRoot, source, 'daily.json'), { report: 'daily' });
    await writeJson(path.join(workspaceRoot, target), { occupied: true });
    const targetBytesBefore = await fs.readFile(path.join(workspaceRoot, target));
    const [preflight] = await Promise.allSettled([collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-copy-report-templates', kind: 'copy-directory',
        reason: 'Copy report templates into generated report assets.', source, target }]
    })]);
    const [application] = await Promise.allSettled([apply([target], [copyDirectory(target, source)])]);
    expect(preflight).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-027' } });
    expect(application).toMatchObject({ status: 'rejected', reason: { code: 'UPGRADE-MIGRATION-027' } });
    expect(await fs.readFile(path.join(workspaceRoot, target))).toEqual(targetBytesBefore);
  });
}, 10_000);

test('migration preflight rejects delete directory targets that are not directories', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    const target = 'generated/reports/obsolete';
    await writeJson(path.join(workspaceRoot, target), { status: 'not-a-directory' });
    await expect(collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-delete-obsolete-report-dir', kind: 'delete-directory',
        reason: 'Remove obsolete generated report directory from previous upgrades.', target }]
    })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-026' });
  });
});

test('migration preflight rejects missing copy directory sources', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    const target = 'generated/reports/templates';
    await expect(collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-copy-report-templates', kind: 'copy-directory',
        reason: 'Copy report templates into generated report assets.',
        source: 'files/generated/reports/missing-templates', target }]
    })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-008' });
  });
});

test('migration preflight rejects copy directory sources that are not directories', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    const source = 'files/generated/reports/templates.json';
    const target = 'generated/reports/templates';
    await writeJson(path.join(manifestRoot, source), { report: 'not-a-directory' });
    await expect(collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-copy-report-templates', kind: 'copy-directory',
        reason: 'Copy report templates into generated report assets.', source, target }]
    })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-023' });
  });
});
