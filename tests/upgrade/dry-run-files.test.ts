import path from 'node:path';
import { expect, test } from 'vitest';

import { upgradeWorkspace } from '../../platform/orchestrator.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { expectFileUnchanged } from '../helpers/assertion-helpers.ts';
import { prepareSlotUpgradeDryRunFixture } from '../helpers/test-utils.ts';

test('upgrade dry-run records delete file migration impacts', async () => {
  const { beforePlan, paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
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
      await writeJson(path.join(workspacePaths.projectRoot, 'generated', 'reports', 'obsolete.json'), {
        status: 'obsolete'
      });
    }
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/obsolete.json',
    'src/installed/private/slot-contract.ts'
  ]);
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
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-delete-obsolete-report',
      kind: 'delete-file',
      target: 'generated/reports/obsolete.json',
      reason: 'Remove obsolete generated report from previous upgrades.',
      requiresVerification: false
    }
  ]);
  await expectFileUnchanged(paths.planPath, beforePlan);
});

test('upgrade dry-run records copy file migration impacts', async () => {
  const { beforePlan, paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
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

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/schema.json',
    'src/installed/private/slot-contract.ts'
  ]);
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
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-copy-report-schema',
      kind: 'copy-file',
      target: 'generated/reports/schema.json',
      reason: 'Copy report schema into generated report assets.',
      requiresVerification: false,
      source: 'files/generated/reports/schema.json'
    }
  ]);
  await expectFileUnchanged(paths.planPath, beforePlan);
});

test('upgrade dry-run records rename file migration impacts', async () => {
  const { beforePlan, paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
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
      await writeJson(path.join(workspacePaths.projectRoot, 'generated', 'reports', 'current.json'), {
        status: 'current'
      });
    }
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/archive/current.json',
    'generated/reports/current.json',
    'src/installed/private/slot-contract.ts'
  ]);
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
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-rename-report',
      kind: 'rename-file',
      target: 'generated/reports/archive/current.json',
      reason: 'Move generated report into archive directory.',
      requiresVerification: false,
      source: 'generated/reports/current.json'
    }
  ]);
  await expectFileUnchanged(paths.planPath, beforePlan);
});
