import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { writeJson } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { applyMigrationEntries } from '../helpers/apply-migration-entries.ts';
import { withBlockUpgradeDryRunFixture } from '../helpers/block-upgrade-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

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

    await expect(fs.readFile(path.join(workspaceRoot, 'generated', 'reports', 'obsolete', 'daily.json'), 'utf8')).rejects.toThrow();
  }, 'engineering-compiler-upgrade-delete-directory-apply-');
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

test('copy file migrations copy manifest files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
    const versionRoot = path.join(privateRegistryRoot, 'private.block-upgrade', 'versions', '0.2.0');

    await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'schema.json'), {
      schema: 'report-v2'
    });

    await applyMigrationEntries(
      workspaceRoot,
      versionRoot,
      ['generated/reports/schema.json'],
      [
        {
          id: 'mig-copy-report-schema',
          kind: 'copy-file',
          reason: 'Copy report schema into generated report assets.',
          source: 'files/generated/reports/schema.json',
          target: 'generated/reports/schema.json'
        }
      ]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'generated', 'reports', 'schema.json'), 'utf8')).resolves.toContain(
      '"schema": "report-v2"'
    );
  }, 'engineering-compiler-upgrade-copy-file-apply-');
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

test('copy directory migrations recursively copy manifest directories', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
    const versionRoot = path.join(privateRegistryRoot, 'private.block-upgrade', 'versions', '0.2.0');

    await fs.mkdir(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'nested'), {
      recursive: true
    });
    await fs.writeFile(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.md'), '# Daily report\n', 'utf8');
    await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'nested', 'weekly.json'), {
      report: 'weekly'
    });

    await applyMigrationEntries(
      workspaceRoot,
      versionRoot,
      ['generated/reports/templates'],
      [
        {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          reason: 'Copy report templates into generated report assets.',
          source: 'files/generated/reports/templates',
          target: 'generated/reports/templates'
        }
      ]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'generated', 'reports', 'templates', 'daily.md'), 'utf8')).resolves.toBe(
      '# Daily report\n'
    );
    await expect(
      fs.readFile(path.join(workspaceRoot, 'generated', 'reports', 'templates', 'nested', 'weekly.json'), 'utf8')
    ).resolves.toContain('"report": "weekly"');
  }, 'engineering-compiler-upgrade-copy-directory-apply-');
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
