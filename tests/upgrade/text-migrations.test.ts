import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { createWorkspace, writeSlotUpgradeFixture } from '../helpers/test-utils.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';

test('upgrade rejects text append migrations when target is a directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-append-directory-target-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
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
  await fs.mkdir(path.join(projectRoot, 'docs', 'upgrade-notes.md'), { recursive: true });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-017'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-file-operations"');
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
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-text-replace-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
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
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-literal.json'), {
    id: 'mig-upgrade-notes-literal',
    kind: 'text-replace',
    reason: 'Replace upgrade notes marker literally.',
    target: 'docs/upgrade-notes.md',
    replacement: 'status: applied'
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

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
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
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-text-replace-missing-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, projectRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'status: already-applied\n', 'utf8');
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
          requiresVerification: false
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

  await expect(
    upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })
  ).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-015'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain(
    '"failedCheck": "migration-text-patterns"'
  );
});

test('upgrade rejects malformed text replace regex migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-text-regex-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
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
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-regex.json'), {
    id: 'mig-upgrade-notes-regex',
    kind: 'text-replace-regex',
    reason: 'Replace upgrade notes marker.',
    target: 'docs/upgrade-notes.md',
    pattern: 'status: pending'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});

test('upgrade rejects invalid text replace regex patterns before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-invalid-text-regex-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
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
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-regex.json'), {
    id: 'mig-upgrade-notes-regex',
    kind: 'text-replace-regex',
    reason: 'Replace upgrade notes marker.',
    target: 'docs/upgrade-notes.md',
    pattern: 'status: (pending',
    replacement: 'status: applied'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-014'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-text-patterns"');
});

test('upgrade rejects malformed text append migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-text-append-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
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
    target: 'docs/upgrade-notes.md'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});
