import { expect, test } from 'bun:test';
import path from 'node:path';

import { writeJson } from '../../platform/shared/fs.ts';
import { prepareSlotUpgradeDryRunFixture } from '../helpers/slot-upgrade-fixtures.ts';
import { expectUpgradeDryRunFailureWithDiagnostics } from './upgrade-diagnostics-fixtures.ts';
import { runPlannedSlotUpgradeDryRun } from './upgrade-dry-run-fixtures.ts';

test('upgrade dry-run records create directory migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-create-directory-plan-',
    migration: {
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
    }
  });

  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'create-directory': 1
  });
  expect(upgradePlan.migrationSummaries).toHaveLength(1);
});

test('upgrade dry-run rejects create directory migrations when target is a file', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-create-directory-file-target-',
    migration: {
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
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.projectRoot, 'generated', 'reports', 'snapshots'), {
        occupied: true
      });
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    paths.upgradeDiagnosticsPath,
    { code: 'UPGRADE-MIGRATION-028' },
    { failedCheck: 'migration-file-operations' }
  );
});

test('upgrade dry-run records delete directory migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-delete-directory-plan-',
    migration: {
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
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.projectRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
        status: 'obsolete'
      });
    }
  });

  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'delete-directory': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-delete-obsolete-report-dir:target:directory']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toHaveLength(1);
});

test('upgrade dry-run records copy directory migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-copy-directory-plan-',
    migration: {
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
    setup: async ({ versionRoot }) => {
      await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
        report: 'daily'
      });
    }
  });

  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'copy-directory': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-copy-report-templates:manifest-source:directory']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toHaveLength(1);
});

test('upgrade dry-run rejects copy directory migrations when target is a file', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-copy-directory-file-target-',
    migration: {
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
    setup: async ({ paths: workspacePaths, versionRoot }) => {
      await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
        report: 'daily'
      });
      await writeJson(path.join(workspacePaths.projectRoot, 'generated', 'reports', 'templates'), {
        occupied: true
      });
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    paths.upgradeDiagnosticsPath,
    { code: 'UPGRADE-MIGRATION-027' },
    { failedCheck: 'migration-file-operations' }
  );
});
