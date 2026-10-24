import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from '../../../src/adapters/filesystem/files.ts';
import { collectUpgradePreflightEvidence } from '../../../src/adapters/upgrade/migration-runtime.ts';
import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { withBlockUpgradeDryRunFixture } from '../../helpers/block-upgrade-fixtures.ts';
import { withMigrationWorkspace } from './migration-fixtures.ts';
import { runPlannedBlockUpgradeDryRun } from './upgrade-dry-run-fixtures.ts';

test('upgrade dry-run records file directory and text migration impacts', async () => {
  const upgradePlan = await runPlannedBlockUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-migration-plans-',
    migrations: [
      {
        id: 'mig-delete-obsolete-report',
        kind: 'delete-file',
        entry: 'migrations/delete-obsolete-report.json',
        requiresVerification: false,
        body: {
          id: 'mig-delete-obsolete-report',
          kind: 'delete-file',
          reason: 'Remove obsolete generated report from previous upgrades.',
          target: 'generated/reports/obsolete.json'
        }
      },
      {
        id: 'mig-copy-report-schema',
        kind: 'copy-file',
        entry: 'migrations/copy-report-schema.json',
        requiresVerification: false,
        body: {
          id: 'mig-copy-report-schema',
          kind: 'copy-file',
          reason: 'Copy report schema into generated report assets.',
          source: 'files/generated/reports/schema.json',
          target: 'generated/reports/schema.json'
        }
      },
      {
        id: 'mig-rename-report',
        kind: 'rename-file',
        entry: 'migrations/rename-report.json',
        requiresVerification: false,
        body: {
          id: 'mig-rename-report',
          kind: 'rename-file',
          reason: 'Move generated report into archive directory.',
          source: 'generated/reports/current.json',
          target: 'generated/reports/archive/current.json'
        }
      },
      {
        id: 'mig-create-snapshots-dir',
        kind: 'create-directory',
        entry: 'migrations/create-snapshots-dir.json',
        requiresVerification: false,
        body: {
          id: 'mig-create-snapshots-dir',
          kind: 'create-directory',
          reason: 'Create snapshot directory for generated reports.',
          target: 'generated/reports/snapshots'
        }
      },
      {
        id: 'mig-delete-obsolete-report-dir',
        kind: 'delete-directory',
        entry: 'migrations/delete-obsolete-report-dir.json',
        requiresVerification: false,
        body: {
          id: 'mig-delete-obsolete-report-dir',
          kind: 'delete-directory',
          reason: 'Remove obsolete generated report directory from previous upgrades.',
          target: 'generated/reports/obsolete'
        }
      },
      {
        id: 'mig-copy-report-templates',
        kind: 'copy-directory',
        entry: 'migrations/copy-report-templates.json',
        requiresVerification: false,
        body: {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          reason: 'Copy report templates into generated report assets.',
          source: 'files/generated/reports/templates',
          target: 'generated/reports/templates'
        }
      },
      {
        id: 'mig-upgrade-notes',
        kind: 'text-append',
        entry: 'migrations/upgrade-notes.json',
        requiresVerification: false,
        body: {
          id: 'mig-upgrade-notes',
          kind: 'text-append',
          reason: 'Append upgrade notes.',
          target: 'docs/appended-notes.md',
          content: '- text append migration applied.\n'
        }
      },
      {
        id: 'mig-upgrade-notes-literal',
        kind: 'text-replace',
        entry: 'migrations/upgrade-notes-literal.json',
        requiresVerification: true,
        body: {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          reason: 'Replace upgrade notes marker literally.',
          target: 'docs/upgrade-notes.md',
          search: 'status: pending',
          replacement: 'status: applied'
        }
      }
    ],
    setup: async ({ paths: workspacePaths, versionRoot }) => {
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'obsolete.json'), {
        status: 'obsolete'
      });
      await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'schema.json'), {
        schema: 'report-v2'
      });
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'current.json'), {
        status: 'current'
      });
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
        status: 'obsolete'
      });
      await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
        report: 'daily'
      });
      await fs.mkdir(path.join(workspacePaths.workspaceRoot, 'docs'), { recursive: true });
      await fs.writeFile(path.join(workspacePaths.workspaceRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
    }
  });

  expect(upgradePlan.impacts).toEqual(expect.arrayContaining([
    'generated/reports/obsolete.json', 'generated/reports/schema.json',
    'generated/reports/current.json', 'generated/reports/archive/current.json',
    'generated/reports/snapshots', 'generated/reports/obsolete', 'generated/reports/templates',
    'docs/appended-notes.md', 'docs/upgrade-notes.md'
  ]));
  expect(upgradePlan.migrationKindCounts).toEqual({
    'delete-file': 1, 'copy-file': 1, 'rename-file': 1,
    'create-directory': 1, 'delete-directory': 1, 'copy-directory': 1,
    'text-append': 1, 'text-replace': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'migration-file-operations', status: 'passed',
      evidence: [
        'mig-copy-report-schema:manifest-source:file',
        'mig-copy-report-templates:manifest-source:directory',
        'mig-delete-obsolete-report-dir:target:directory',
        'mig-delete-obsolete-report:target:file',
        'mig-rename-report:source:file',
        'mig-rename-report:target:available',
        'mig-upgrade-notes:target:missing'
      ]
    }),
    expect.objectContaining({
      id: 'migration-text-patterns', status: 'passed',
      evidence: ['mig-upgrade-notes-literal:literal:15']
    })
  ]));
  expect(upgradePlan.migrationSummaries.map(({ id, kind, requiresVerification }) => ({ id, kind, requiresVerification })))
    .toEqual([
      { id: 'mig-delete-obsolete-report', kind: 'delete-file', requiresVerification: false },
      { id: 'mig-copy-report-schema', kind: 'copy-file', requiresVerification: false },
      { id: 'mig-rename-report', kind: 'rename-file', requiresVerification: false },
      { id: 'mig-create-snapshots-dir', kind: 'create-directory', requiresVerification: false },
      { id: 'mig-delete-obsolete-report-dir', kind: 'delete-directory', requiresVerification: false },
      { id: 'mig-copy-report-templates', kind: 'copy-directory', requiresVerification: false },
      { id: 'mig-upgrade-notes', kind: 'text-append', requiresVerification: false },
      { id: 'mig-upgrade-notes-literal', kind: 'text-replace', requiresVerification: true }
    ]);
});

test('migration preflight rejects a copy file source that is not a file', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    const source = 'files/generated/reports/schema';
    const target = 'generated/reports/schema.json';
    await fs.mkdir(path.join(manifestRoot, source), { recursive: true });
    await expect(collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-copy-report-schema', kind: 'copy-file',
        reason: 'Copy report schema into generated report assets.', source, target }]
    })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-024' });
  });
});

test('migration preflight rejects missing delete file targets', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    const target = 'generated/reports/missing.json';
    await expect(collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-delete-missing-report', kind: 'delete-file',
        reason: 'Remove obsolete generated report from previous upgrades.', target }]
    })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-016' });
  });
});

test('upgrade rejects occupied rename file targets before planning', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-rename-file-occupied-',
      migration: {
        id: 'mig-rename-report-occupied',
        kind: 'rename-file',
        entry: 'migrations/rename-report-occupied.json',
        requiresVerification: false,
        body: {
          id: 'mig-rename-report-occupied',
          kind: 'rename-file',
          reason: 'Move generated report into archive directory.',
          source: 'generated/reports/current.json',
          target: 'generated/reports/archive/current.json'
        }
      },
      setup: async ({ paths }) => {
        await writeJson(path.join(paths.workspaceRoot, 'generated', 'reports', 'current.json'), {
          status: 'current'
        });
        await writeJson(path.join(paths.workspaceRoot, 'generated', 'reports', 'archive', 'current.json'), {
          status: 'occupied'
        });
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-020'
      });
    }
  );
});
