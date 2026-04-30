import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import { upgradeWorkspace } from '../../platform/orchestrator.ts';
import { expectFileUnchanged, prepareSlotUpgradeDryRunFixture } from '../helpers/test-utils.ts';

test('upgrade dry-run records text append migration impacts', async () => {
  const { beforePlan, paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-text-append-plan-',
    migration: {
      id: 'mig-upgrade-notes',
      kind: 'text-append',
      entry: 'migrations/upgrade-notes.json',
      requiresVerification: false,
      body: {
        id: 'mig-upgrade-notes',
        kind: 'text-append',
        reason: 'Append upgrade notes.',
        target: 'docs/upgrade-notes.md',
        content: '- text append migration applied.\n'
      }
    }
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
  await expectFileUnchanged(paths.planPath, beforePlan);
});

test('upgrade dry-run records literal text replace migration impacts', async () => {
  const { beforePlan, paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-text-replace-plan-',
    migration: {
      id: 'mig-upgrade-notes-literal',
      kind: 'text-replace',
      entry: 'migrations/upgrade-notes-literal.json',
      requiresVerification: true,
      body: {
        id: 'mig-upgrade-notes-literal',
        kind: 'text-replace',
        reason: 'Replace upgrade notes marker literally.',
        target: 'docs/upgrade-notes.md',
        search: 'status: pending',
        replacement: 'status: applied'
      }
    },
    setup: async ({ paths: workspacePaths }) => {
      await fs.mkdir(path.join(workspacePaths.projectRoot, 'docs'), { recursive: true });
      await fs.writeFile(path.join(workspacePaths.projectRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
    }
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
  await expectFileUnchanged(paths.planPath, beforePlan);
});

test('upgrade dry-run records text replace regex migration impacts', async () => {
  const { beforePlan, paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-text-regex-plan-',
    migration: {
      id: 'mig-upgrade-notes-regex',
      kind: 'text-replace-regex',
      entry: 'migrations/upgrade-notes-regex.json',
      requiresVerification: true,
      body: {
        id: 'mig-upgrade-notes-regex',
        kind: 'text-replace-regex',
        reason: 'Replace upgrade notes marker.',
        target: 'docs/upgrade-notes.md',
        pattern: 'status: pending',
        replacement: 'status: applied'
      }
    },
    setup: async ({ paths: workspacePaths }) => {
      await fs.mkdir(path.join(workspacePaths.projectRoot, 'docs'), { recursive: true });
      await fs.writeFile(path.join(workspacePaths.projectRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
    }
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
  await expectFileUnchanged(paths.planPath, beforePlan);
});
