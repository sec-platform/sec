import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import {
  upgradeWorkspace
} from '../../platform/orchestrator.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';
import { createWorkspace, writeSlotUpgradeFixture } from '../helpers/test-utils.ts';

test('upgrade dry-run records create directory migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-create-directory-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-create-snapshots-dir',
          kind: 'create-directory',
          entry: 'migrations/create-snapshots-dir.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  const migrationPath = path.join(versionRoot, 'migrations', 'create-snapshots-dir.json');
  await writeJson(migrationPath, {
    id: 'mig-create-snapshots-dir',
    kind: 'create-directory',
    reason: 'Create snapshot directory for generated reports.',
    target: 'generated/reports/snapshots'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/snapshots',
    'src/installed/private/slot-contract.ts'
  ]);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'create-directory': 1
  });
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-create-snapshots-dir',
      kind: 'create-directory',
      target: 'generated/reports/snapshots',
      reason: 'Create snapshot directory for generated reports.',
      requiresVerification: false
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run rejects create directory migrations when target is a file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-create-directory-file-target-');

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
          id: 'mig-create-snapshots-dir',
          kind: 'create-directory',
          entry: 'migrations/create-snapshots-dir.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'create-snapshots-dir.json'), {
    id: 'mig-create-snapshots-dir',
    kind: 'create-directory',
    reason: 'Create snapshot directory for generated reports.',
    target: 'generated/reports/snapshots'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'snapshots'), {
    occupied: true
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-028'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('upgrade dry-run records delete directory migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-directory-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
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
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete', 'daily.json'), {
    status: 'obsolete'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/obsolete',
    'src/installed/private/slot-contract.ts'
  ]);
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
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-delete-obsolete-report-dir',
      kind: 'delete-directory',
      target: 'generated/reports/obsolete',
      reason: 'Remove obsolete generated report directory from previous upgrades.',
      requiresVerification: false
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run records copy directory migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(
    privateRegistryRoot,
    'private.slot-contract',
    'versions',
    '0.2.0'
  );
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
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
    source: 'files/generated/reports/templates',
    target: 'generated/reports/templates'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
    report: 'daily'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual([
    'generated/reports/templates',
    'src/installed/private/slot-contract.ts'
  ]);
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
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-copy-report-templates',
      kind: 'copy-directory',
      target: 'generated/reports/templates',
      reason: 'Copy report templates into generated report assets.',
      requiresVerification: false,
      source: 'files/generated/reports/templates'
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run rejects copy directory migrations when target is a file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-directory-file-target-');

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
    source: 'files/generated/reports/templates',
    target: 'generated/reports/templates'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'templates', 'daily.json'), {
    report: 'daily'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'templates'), {
    occupied: true
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-027'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});
