import { expect, test } from 'bun:test';
import path from 'node:path';

import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { prepareBlockUpgradeDryRunFixture, withBlockUpgradeDryRunFixture } from '../../helpers/block-upgrade-fixtures.ts';
import { expectUpgradeDryRunFailureWithoutDiagnostics, runPlannedBlockUpgradeDryRun } from './upgrade-dry-run-fixtures.ts';

test('upgrade dry-run records create delete and copy directory migration impacts', async () => {
  const upgradePlan = await runPlannedBlockUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-directory-plans-',
    migrations: [
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
      }
    ],
    setup: async ({ paths: workspacePaths, versionRoot }) => {
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
        status: 'obsolete'
      });
      await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
        report: 'daily'
      });
    }
  });

  expect(upgradePlan.impacts).toEqual(expect.arrayContaining([
    'generated/reports/snapshots', 'generated/reports/obsolete', 'generated/reports/templates'
  ]));
  expect(upgradePlan.migrationKindCounts).toEqual({
    'create-directory': 1, 'delete-directory': 1, 'copy-directory': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'migration-file-operations', status: 'passed',
      evidence: [
        'mig-copy-report-templates:manifest-source:directory',
        'mig-delete-obsolete-report-dir:target:directory'
      ]
    })
  ]));
  expect(upgradePlan.migrationSummaries.map(({ id, kind }) => ({ id, kind }))).toEqual([
    { id: 'mig-create-snapshots-dir', kind: 'create-directory' },
    { id: 'mig-delete-obsolete-report-dir', kind: 'delete-directory' },
    { id: 'mig-copy-report-templates', kind: 'copy-directory' }
  ]);
});

test('upgrade dry-run rejects create directory migrations when target is a file', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'snapshots'), {
        occupied: true
      });
    }
  });

  await expectUpgradeDryRunFailureWithoutDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    { code: 'UPGRADE-MIGRATION-028' }
  );
});

test('upgrade dry-run rejects copy directory migrations when target is a file', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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
      await writeJson(path.join(workspacePaths.workspaceRoot, 'generated', 'reports', 'templates'), {
        occupied: true
      });
    }
  });

  await expectUpgradeDryRunFailureWithoutDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    { code: 'UPGRADE-MIGRATION-027' }
  );
});

test('upgrade rejects delete directory migrations when target is not a directory', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-delete-directory-file-target-',
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
      setup: async ({ paths }) => {
        await writeJson(path.join(paths.workspaceRoot, 'generated', 'reports', 'obsolete'), {
          status: 'not-a-directory'
        });
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-026'
      });
    }
  );
});

test('upgrade rejects copy directory migrations when manifest source is missing', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-copy-directory-missing-source-',
      migration: {
        id: 'mig-copy-report-templates',
        kind: 'copy-directory',
        entry: 'migrations/copy-report-templates.json',
        requiresVerification: false,
        body: {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          reason: 'Copy report templates into generated report assets.',
          source: 'files/generated/reports/missing-templates',
          target: 'generated/reports/templates'
        }
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-008'
      });
    }
  );
});

test('upgrade rejects copy directory migrations when manifest source is not a directory', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-copy-directory-file-source-',
      migration: {
        id: 'mig-copy-report-templates',
        kind: 'copy-directory',
        entry: 'migrations/copy-report-templates.json',
        requiresVerification: false,
        body: {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          reason: 'Copy report templates into generated report assets.',
          source: 'files/generated/reports/templates.json',
          target: 'generated/reports/templates'
        }
      },
      setup: async ({ versionRoot }) => {
        await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates.json'), {
          report: 'not-a-directory'
        });
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-023'
      });
    }
  );
});
