import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { withBlockUpgradeDryRunFixture } from '../../helpers/block-upgrade-fixtures.ts';
import { runPlannedBlockUpgradeDryRun } from './upgrade-dry-run-fixtures.ts';

test('upgrade dry-run records append and literal replace text migration impacts', async () => {
  const upgradePlan = await runPlannedBlockUpgradeDryRun({
    prefix: 'engineering-compiler-upgrade-text-plans-',
    migrations: [
      {
        id: 'mig-upgrade-notes',
        kind: 'text-append',
        entry: 'migrations/upgrade-notes.json',
        requiresVerification: false,
        body: {
          id: 'mig-upgrade-notes',
          kind: 'text-append',
          reason: 'Append upgrade notes.',
          target: 'docs/appended-notes.md',
          content: '- text append migration applied.\n'
        }
      },
      {
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
      }
    ],
    setup: async ({ paths: workspacePaths }) => {
      await fs.mkdir(path.join(workspacePaths.workspaceRoot, 'docs'), { recursive: true });
      await fs.writeFile(path.join(workspacePaths.workspaceRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
    }
  });

  expect(upgradePlan.impacts).toEqual(expect.arrayContaining([
    'docs/appended-notes.md', 'docs/upgrade-notes.md'
  ]));
  expect(upgradePlan.migrationKindCounts).toEqual({ 'text-append': 1, 'text-replace': 1 });
  expect(upgradePlan.preflightChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'migration-text-patterns', status: 'passed',
      evidence: ['mig-upgrade-notes-literal:literal:15']
    })
  ]));
  expect(upgradePlan.migrationSummaries.map(({ id, kind, requiresVerification }) => ({ id, kind, requiresVerification })))
    .toEqual([
      { id: 'mig-upgrade-notes', kind: 'text-append', requiresVerification: false },
      { id: 'mig-upgrade-notes-literal', kind: 'text-replace', requiresVerification: true }
    ]);
});

test('upgrade rejects text append migrations when target is a directory', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-text-append-directory-target-',
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
      },
      setup: async ({ paths }) => {
        await fs.mkdir(path.join(paths.workspaceRoot, 'docs', 'upgrade-notes.md'), { recursive: true });
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-017'
      });
    }
  );
});

test('upgrade rejects malformed literal text replace migration entries before planning', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-malformed-text-replace-',
      migration: {
        id: 'mig-upgrade-notes-literal',
        kind: 'text-replace',
        entry: 'migrations/upgrade-notes-literal.json',
        requiresVerification: false,
        body: {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          reason: 'Replace upgrade notes marker literally.',
          target: 'docs/upgrade-notes.md',
          replacement: 'status: applied'
        }
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-011',
        details: {
          failedCheck: 'migration-entries',
          migrationId: 'mig-upgrade-notes-literal',
          migrationKind: 'text-replace',
          entry: 'migrations/upgrade-notes-literal.json'
        }
      });
    }
  );
});

test('upgrade rejects literal text replace migrations when search text is missing', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-text-replace-missing-',
      migration: {
        id: 'mig-upgrade-notes-literal',
        kind: 'text-replace',
        entry: 'migrations/upgrade-notes-literal.json',
        requiresVerification: false,
        body: {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          reason: 'Replace upgrade notes marker literally.',
          target: 'docs/upgrade-notes.md',
          search: 'status: pending',
          replacement: 'status: applied'
        }
      },
      setup: async ({ paths }) => {
        await fs.mkdir(path.join(paths.workspaceRoot, 'docs'), { recursive: true });
        await fs.writeFile(path.join(paths.workspaceRoot, 'docs', 'upgrade-notes.md'), 'status: already-applied\n', 'utf8');
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-015'
      });
    }
  );
});

test('upgrade rejects malformed text append migration entries before planning', async () => {
  await withBlockUpgradeDryRunFixture(
    {
      prefix: 'engineering-compiler-upgrade-malformed-text-append-',
      migration: {
        id: 'mig-upgrade-notes',
        kind: 'text-append',
        entry: 'migrations/upgrade-notes.json',
        requiresVerification: false,
        body: {
          id: 'mig-upgrade-notes',
          kind: 'text-append',
          reason: 'Append upgrade notes.',
          target: 'docs/upgrade-notes.md'
        }
      }
    },
    async ({ workspaceRoot }) => {
      await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true })).rejects.toMatchObject({
        code: 'UPGRADE-MIGRATION-011'
      });
    }
  );
});
