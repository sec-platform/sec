import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'bun:test';

import {
  upgradeWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { prepareSlotUpgradeDryRunFixture } from '../helpers/slot-upgrade-fixtures.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';

test('upgrade rejects text append migrations when target is a directory', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
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
    setup: async ({ paths: workspacePaths }) => {
      await fs.mkdir(path.join(workspacePaths.projectRoot, 'docs', 'upgrade-notes.md'), { recursive: true });
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-017'
  });
  await expect(fs.readFile(paths.upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
});

test('literal text replace migrations update all matching text', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-replace-apply-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const targetPath = path.join(projectRoot, 'docs', 'upgrade-notes.md');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, 'status: pending\nnext: pending\n', 'utf8');

  await applyMigrationEntries(projectRoot, projectRoot, ['docs/upgrade-notes.md'], [
    {
      id: 'mig-upgrade-notes-literal',
      kind: 'text-replace',
      reason: 'Replace upgrade notes marker literally.',
      target: 'docs/upgrade-notes.md',
      search: 'pending',
      replacement: 'applied'
    }
  ]);

  await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('status: applied\nnext: applied\n');
});

test('upgrade rejects malformed literal text replace migration entries before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
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
  });

  await expect(
    upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })
  ).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-upgrade-notes-literal',
      migrationKind: 'text-replace',
      entry: 'migrations/upgrade-notes-literal.json'
    }
  });

  const diagnostics = await readJson<{
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  }>(paths.upgradeDiagnosticsPath);
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-011',
    details: {
      migrationId: 'mig-upgrade-notes-literal',
      migrationKind: 'text-replace',
      entry: 'migrations/upgrade-notes-literal.json'
    }
  });
});

test('upgrade rejects literal text replace migrations when search text is missing', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
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
    setup: async ({ paths: workspacePaths }) => {
      await fs.mkdir(path.join(workspacePaths.projectRoot, 'docs'), { recursive: true });
      await fs.writeFile(path.join(workspacePaths.projectRoot, 'docs', 'upgrade-notes.md'), 'status: already-applied\n', 'utf8');
    }
  });

  await expect(
    upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })
  ).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-015'
  });
  await expect(fs.readFile(paths.upgradeDiagnosticsPath, 'utf8')).resolves.toContain(
    '"failedCheck": "migration-text-patterns"'
  );
});

test('upgrade rejects malformed text replace regex migration entries before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-malformed-text-regex-',
    migration: {
      id: 'mig-upgrade-notes-regex',
      kind: 'text-replace-regex',
      entry: 'migrations/upgrade-notes-regex.json',
      requiresVerification: false,
      body: {
        id: 'mig-upgrade-notes-regex',
        kind: 'text-replace-regex',
        reason: 'Replace upgrade notes marker.',
        target: 'docs/upgrade-notes.md',
        pattern: 'status: pending'
      }
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(paths.upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});

test('upgrade rejects invalid text replace regex patterns before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-invalid-text-regex-',
    migration: {
      id: 'mig-upgrade-notes-regex',
      kind: 'text-replace-regex',
      entry: 'migrations/upgrade-notes-regex.json',
      requiresVerification: false,
      body: {
        id: 'mig-upgrade-notes-regex',
        kind: 'text-replace-regex',
        reason: 'Replace upgrade notes marker.',
        target: 'docs/upgrade-notes.md',
        pattern: 'status: (pending',
        replacement: 'status: applied'
      }
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-014'
  });
  await expect(fs.readFile(paths.upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-text-patterns"');
});

test('upgrade rejects malformed text append migration entries before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
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
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(paths.upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});
