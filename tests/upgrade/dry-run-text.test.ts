import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'bun:test';

import { runPlannedSlotUpgradeDryRun } from './upgrade-dry-run-fixtures.ts';

test('upgrade dry-run records text append migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
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

  expect(upgradePlan.impacts).toEqual([] as any);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'text-append': 1
  });
  expect(upgradePlan.migrationSummaries).toEqual([] as any);
});

test('upgrade dry-run records literal text replace migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
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

  expect(upgradePlan.impacts).toEqual([] as any);
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
  expect(upgradePlan.migrationSummaries).toEqual([] as any);
});

test('upgrade dry-run records text replace regex migration impacts', async () => {
  const upgradePlan = await runPlannedSlotUpgradeDryRun({
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

  expect(upgradePlan.impacts).toEqual([] as any);
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
  expect(upgradePlan.migrationSummaries).toEqual([] as any);
});
