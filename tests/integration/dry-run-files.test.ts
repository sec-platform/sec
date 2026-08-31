import { expect, test } from 'bun:test';
import path from 'node:path';

import { writeJson } from '../../src/workspace/files.ts';
import { runPlannedSlotUpgradeDryRun } from './upgrade-dry-run-fixtures.ts';

test('upgrade dry-run records delete file migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-delete-file-plan-',
    migration: {
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
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'obsolete.json'), {
        status: 'obsolete'
      });
    }
  });

  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'delete-file': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-delete-obsolete-report:target:file']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toHaveLength(1);
});

test('upgrade dry-run records copy file migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-copy-file-plan-',
    migration: {
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
    setup: async ({ versionRoot }) => {
      await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'schema.json'), {
        schema: 'report-v2'
      });
    }
  });

  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'copy-file': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-copy-report-schema:manifest-source:file']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toHaveLength(1);
});

test('upgrade dry-run records rename file migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-rename-file-plan-',
    migration: {
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
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'current.json'), {
        status: 'current'
      });
    }
  });

  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'rename-file': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: [
          'mig-rename-report:source:file',
          'mig-rename-report:target:available'
        ]
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toHaveLength(1);
});
