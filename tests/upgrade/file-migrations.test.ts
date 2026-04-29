import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import {
  upgradeWorkspace
} from '../../platform/orchestrator.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { createWorkspace, writeSlotUpgradeFixture } from '../helpers/test-utils.ts';

test('delete directory migrations remove project directories recursively', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-directory-apply-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
    status: 'obsolete'
  });

  await applyMigrationEntries(
    projectRoot,
    projectRoot,
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

  await expect(
    fs.readFile(
      path.join(projectRoot, 'generated', 'reports', 'obsolete', 'daily.json'),
      'utf8'
    )
  ).rejects.toThrow();
});

test('upgrade rejects delete directory migrations when target is not a directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-directory-file-target-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-delete-obsolete-report-dir',
          kind: 'delete-directory',
          entry: 'migrations/delete-obsolete-report-dir.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'delete-obsolete-report-dir.json'), {
    id: 'mig-delete-obsolete-report-dir',
    kind: 'delete-directory',
    reason: 'Remove obsolete generated report directory from previous upgrades.',
    target: 'generated/reports/obsolete'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete'), {
    status: 'not-a-directory'
  });

  await expect(
    upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })
  ).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-026'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain(
    '"failedCheck": "migration-file-operations"'
  );
});

test('copy file migrations copy manifest files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-file-apply-');
  const { privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );

  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'schema.json'), {
    schema: 'report-v2'
  });

  await applyMigrationEntries(
    projectRoot,
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

  await expect(
    fs.readFile(path.join(projectRoot, 'generated', 'reports', 'schema.json'), 'utf8')
  ).resolves.toContain('"schema": "report-v2"');
});

test('upgrade rejects copy file migrations when manifest source is not a file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-file-directory-source-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-schema',
          kind: 'copy-file',
          entry: 'migrations/copy-report-schema.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-schema.json'), {
    id: 'mig-copy-report-schema',
    kind: 'copy-file',
    reason: 'Copy report schema into generated report assets.',
    source: 'files/generated/reports/schema',
    target: 'generated/reports/schema.json'
  });
  await fs.mkdir(path.join(versionRoot, 'files', 'generated', 'reports', 'schema'), {
    recursive: true
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-024'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('copy directory migrations recursively copy manifest directories', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-apply-');
  const { privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );

  await fs.mkdir(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'nested'), {
    recursive: true
  });
  await fs.writeFile(
    path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.md'),
    '# Daily report\n',
    'utf8'
  );
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'nested', 'weekly.json'), {
    report: 'weekly'
  });

  await applyMigrationEntries(
    projectRoot,
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

  await expect(fs.readFile(path.join(projectRoot, 'generated', 'reports', 'templates', 'daily.md'), 'utf8')).resolves.toBe(
    '# Daily report\n'
  );
  await expect(
    fs.readFile(path.join(projectRoot, 'generated', 'reports', 'templates', 'nested', 'weekly.json'), 'utf8')
  ).resolves.toContain('"report": "weekly"');
});

test('upgrade rejects copy directory migrations when manifest source is missing', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-missing-source-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          entry: 'migrations/copy-report-templates.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-templates.json'), {
    id: 'mig-copy-report-templates',
    kind: 'copy-directory',
    reason: 'Copy report templates into generated report assets.',
    source: 'files/generated/reports/missing-templates',
    target: 'generated/reports/templates'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-008'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade rejects copy directory migrations when manifest source is not a directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-file-source-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-copy-report-templates',
          kind: 'copy-directory',
          entry: 'migrations/copy-report-templates.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'copy-report-templates.json'), {
    id: 'mig-copy-report-templates',
    kind: 'copy-directory',
    reason: 'Copy report templates into generated report assets.',
    source: 'files/generated/reports/templates.json',
    target: 'generated/reports/templates'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates.json'), {
    report: 'not-a-directory'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-023'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade rejects missing delete file targets before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-file-missing-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-delete-missing-report',
          kind: 'delete-file',
          entry: 'migrations/delete-missing-report.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'delete-missing-report.json'), {
    id: 'mig-delete-missing-report',
    kind: 'delete-file',
    reason: 'Remove obsolete generated report from previous upgrades.',
    target: 'generated/reports/missing.json'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-016'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade rejects occupied rename file targets before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-rename-file-occupied-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-rename-report-occupied',
          kind: 'rename-file',
          entry: 'migrations/rename-report-occupied.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'rename-report-occupied.json'), {
    id: 'mig-rename-report-occupied',
    kind: 'rename-file',
    reason: 'Move generated report into archive directory.',
    source: 'generated/reports/current.json',
    target: 'generated/reports/archive/current.json'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'current.json'), {
    status: 'current'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'archive', 'current.json'), {
    status: 'occupied'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-020'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});
