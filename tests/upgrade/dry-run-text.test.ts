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

test('upgrade dry-run records text append migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-append-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes',
          kind: 'text-append',
          entry: 'migrations/upgrade-notes.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes.json'), {
    id: 'mig-upgrade-notes',
    kind: 'text-append',
    reason: 'Append upgrade notes.',
    target: 'docs/upgrade-notes.md',
    content: '- text append migration applied.\n'
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual(['docs/upgrade-notes.md', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'text-append': 1
  });
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-upgrade-notes',
      kind: 'text-append',
      target: 'docs/upgrade-notes.md',
      reason: 'Append upgrade notes.',
      requiresVerification: false
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run records literal text replace migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-replace-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          entry: 'migrations/upgrade-notes-literal.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: true
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-literal.json'), {
    id: 'mig-upgrade-notes-literal',
    kind: 'text-replace',
    reason: 'Replace upgrade notes marker literally.',
    target: 'docs/upgrade-notes.md',
    search: 'status: pending',
    replacement: 'status: applied'
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual(['docs/upgrade-notes.md', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'text-replace': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-text-patterns',
        status: 'passed',
        evidence: ['mig-upgrade-notes-literal:literal:15']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-upgrade-notes-literal',
      kind: 'text-replace',
      target: 'docs/upgrade-notes.md',
      reason: 'Replace upgrade notes marker literally.',
      requiresVerification: true
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});

test('upgrade dry-run records text replace regex migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-regex-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(planPath, 'utf8');
  await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-upgrade-notes-regex',
          kind: 'text-replace-regex',
          entry: 'migrations/upgrade-notes-regex.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: true
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-regex.json'), {
    id: 'mig-upgrade-notes-regex',
    kind: 'text-replace-regex',
    reason: 'Replace upgrade notes marker.',
    target: 'docs/upgrade-notes.md',
    pattern: 'status: pending',
    replacement: 'status: applied'
  });

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.impacts).toEqual(['docs/upgrade-notes.md', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'text-replace-regex': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'migration-text-patterns',
        status: 'passed',
        evidence: ['mig-upgrade-notes-regex:flags:g']
      })
    ])
  );
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-upgrade-notes-regex',
      kind: 'text-replace-regex',
      target: 'docs/upgrade-notes.md',
      reason: 'Replace upgrade notes marker.',
      requiresVerification: true
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
});
