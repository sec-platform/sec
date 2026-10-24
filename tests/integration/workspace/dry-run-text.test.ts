import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from '../../../src/adapters/filesystem/files.ts';
import { collectUpgradePreflightEvidence, loadMigrationEntries } from '../../../src/adapters/upgrade/migration-runtime.ts';
import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { withBlockUpgradeDryRunFixture } from '../../helpers/block-upgrade-fixtures.ts';
import { withMigrationWorkspace } from './migration-fixtures.ts';

test('migration preflight rejects text append targets that are directories', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    const target = 'docs/upgrade-notes.md';
    await fs.mkdir(path.join(workspaceRoot, target), { recursive: true });
    await expect(collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-upgrade-notes', kind: 'text-append',
        reason: 'Append upgrade notes.', target, content: '- text append migration applied.\n' }]
    })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-017' });
  });
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

test('migration preflight rejects literal text replacement without a search match', async () => {
  await withMigrationWorkspace(async ({ workspaceRoot, manifestRoot }) => {
    const target = 'docs/upgrade-notes.md';
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, target), 'status: already-applied\n', 'utf8');
    await expect(collectUpgradePreflightEvidence({
      workspaceRoot, targetManifestRoot: manifestRoot,
      blockId: 'private/block-upgrade', targetVersion: '0.2.0', impacts: [target],
      migrationEntries: [{ id: 'mig-upgrade-notes-literal', kind: 'text-replace',
        reason: 'Replace upgrade notes marker literally.', target,
        search: 'status: pending', replacement: 'status: applied' }]
    })).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-015' });
  });
});

test('migration entry loading rejects text append entries without content', async () => {
  await withMigrationWorkspace(async ({ manifestRoot }) => {
    await writeJson(path.join(manifestRoot, 'migrations/upgrade-notes.json'), {
      id: 'mig-upgrade-notes', kind: 'text-append', reason: 'Append upgrade notes.', target: 'docs/upgrade-notes.md'
    });
    await expect(loadMigrationEntries(manifestRoot, 'private/block-upgrade', '0.2.0', [{
      id: 'mig-upgrade-notes', kind: 'text-append', entry: 'migrations/upgrade-notes.json',
      fromVersion: '0.1.0', toVersion: '0.2.0', requiresVerification: false
    }])).rejects.toMatchObject({ code: 'UPGRADE-MIGRATION-011' });
  });
});
