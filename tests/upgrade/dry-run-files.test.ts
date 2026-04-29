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

test('upgrade dry-run records delete file migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-delete-file-plan-');

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
          id: 'mig-delete-obsolete-report',
          kind: 'delete-file',
          entry: 'migrations/delete-obsolete-report.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  const migrationPath = path.join(
    versionRoot,
    'migrations',
    'delete-obsolete-report.json'
  );
  await writeJson(migrationPath, {
    id: 'mig-delete-obsolete-report',
    kind: 'delete-file',
    reason: 'Remove obsolete generated report from previous upgrades.',
    target: 'generated/reports/obsolete.json'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'obsolete.json'), {
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
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run records copy file migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-copy-file-plan-');

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
    source: 'files/generated/reports/schema.json',
    target: 'generated/reports/schema.json'
  });
  await writeJson(path.join(versionRoot, 'files', 'generated', 'reports', 'schema.json'), {
    schema: 'report-v2'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

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
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run records rename file migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-rename-file-plan-');

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
          id: 'mig-rename-report',
          kind: 'rename-file',
          entry: 'migrations/rename-report.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  const migrationPath = path.join(
    versionRoot,
    'migrations',
    'rename-report.json'
  );
  await writeJson(migrationPath, {
    id: 'mig-rename-report',
    kind: 'rename-file',
    reason: 'Move generated report into archive directory.',
    source: 'generated/reports/current.json',
    target: 'generated/reports/archive/current.json'
  });
  await writeJson(path.join(projectRoot, 'generated', 'reports', 'current.json'), {
    status: 'current'
  });

  const { upgradePlan } = await upgradeWorkspace(
    workspaceRoot,
    'private/slot-contract',
    '0.2.0',
    { dryRun: true }
  );

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
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});
