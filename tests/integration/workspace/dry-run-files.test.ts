import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { withBlockUpgradeDryRunFixture } from '../../helpers/block-upgrade-fixtures.ts';
import { runPlannedBlockUpgradeDryRun } from './upgrade-dry-run-fixtures.ts';

test('upgrade dry-run records delete copy and rename file migration impacts', async () => {
  const upgradePlan = await runPlannedBlockUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-file-plans-',
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
    }
  });

  expect(upgradePlan.impacts).toEqual(expect.arrayContaining([
    'generated/reports/obsolete.json', 'generated/reports/schema.json',
    'generated/reports/current.json', 'generated/reports/archive/current.json'
  ]));
  expect(upgradePlan.migrationKindCounts).toEqual({
    'delete-file': 1, 'copy-file': 1, 'rename-file': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'migration-file-operations',
      status: 'passed',
      evidence: [
        'mig-copy-report-schema:manifest-source:file',
        'mig-delete-obsolete-report:target:file',
        'mig-rename-report:source:file',
        'mig-rename-report:target:available'
      ]
    })
  ]));
  expect(upgradePlan.migrationSummaries.map(({ id, kind }) => ({ id, kind }))).toEqual([
    { id: 'mig-delete-obsolete-report', kind: 'delete-file' },
    { id: 'mig-copy-report-schema', kind: 'copy-file' },
    { id: 'mig-rename-report', kind: 'rename-file' }
  ]);
});

test('upgrade rejects copy file migrations when manifest source is not a file', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-copy-file-directory-source-',
      migration: {
        id: 'mig-copy-report-schema',
        kind: 'copy-file',
        entry: 'migrations/copy-report-schema.json',
        requiresVerification: false,
        body: {
          id: 'mig-copy-report-schema',
          kind: 'copy-file',
          reason: 'Copy report schema into generated report assets.',
          source: 'files/generated/reports/schema',
          target: 'generated/reports/schema.json'
        }
      },
      setup: async ({ versionRoot }) => {
        await fs.mkdir(path.join(versionRoot, 'files', 'generated', 'reports', 'schema'), {
          recursive: true
        });
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-024'
      });
    }
  );
});

test('upgrade rejects missing delete file targets before planning', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-delete-file-missing-',
      migration: {
        id: 'mig-delete-missing-report',
        kind: 'delete-file',
        entry: 'migrations/delete-missing-report.json',
        requiresVerification: false,
        body: {
          id: 'mig-delete-missing-report',
          kind: 'delete-file',
          reason: 'Remove obsolete generated report from previous upgrades.',
          target: 'generated/reports/missing.json'
        }
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-016'
      });
    }
  );
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
