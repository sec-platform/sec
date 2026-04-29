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

test('upgrade records missing migration entry diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-missing-migration-entry-');

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
          id: 'mig-missing-entry-file',
          kind: 'text-append',
          entry: 'migrations/missing-entry-file.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-002',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-missing-entry-file',
      migrationKind: 'text-append',
      entry: 'migrations/missing-entry-file.json'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-002',
    details: {
      migrationId: 'mig-missing-entry-file',
      migrationKind: 'text-append',
      entry: 'migrations/missing-entry-file.json'
    }
  });
});

test('upgrade rejects migration entry paths that escape the manifest root', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-migration-entry-escape-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
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
          id: 'mig-escaping-entry-file',
          kind: 'text-append',
          entry: '../escape.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-005',
    details: {
      failedCheck: 'migration-file-operations',
      migrationId: 'mig-escaping-entry-file',
      role: 'manifest-source'
    }
  });
});

test('upgrade records mismatched migration entry metadata diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-mismatched-migration-entry-');

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
          id: 'mig-expected-entry',
          kind: 'text-append',
          entry: 'migrations/mismatched-entry.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'mismatched-entry.json'), {
    id: 'mig-actual-entry',
    kind: 'text-replace',
    reason: 'Use mismatched metadata.',
    target: 'generated/reports/notes.md',
    search: 'pending',
    replacement: 'applied'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-003',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-expected-entry',
      migrationKind: 'text-append',
      entry: 'migrations/mismatched-entry.json',
      entryId: 'mig-actual-entry',
      entryKind: 'text-replace'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-003',
    details: {
      migrationId: 'mig-expected-entry',
      migrationKind: 'text-append',
      entry: 'migrations/mismatched-entry.json',
      entryId: 'mig-actual-entry',
      entryKind: 'text-replace'
    }
  });
});

test('upgrade rejects duplicate migration ids before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-duplicate-migration-id-');

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
          id: 'mig-duplicate-report',
          kind: 'text-append',
          entry: 'migrations/append-report-a.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        },
        {
          id: 'mig-duplicate-report',
          kind: 'text-append',
          entry: 'migrations/append-report-b.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'append-report-a.json'), {
    id: 'mig-duplicate-report',
    kind: 'text-append',
    reason: 'Append first report note.',
    target: 'generated/reports/notes.md',
    content: '- first note\n'
  });
  await writeJson(path.join(versionRoot, 'migrations', 'append-report-b.json'), {
    id: 'mig-duplicate-report',
    kind: 'text-append',
    reason: 'Append second report note.',
    target: 'generated/reports/notes.md',
    content: '- second note\n'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-029',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-duplicate-report',
      entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-029',
    details: {
      migrationId: 'mig-duplicate-report',
      entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
    }
  });
});

test('upgrade records migration target path escape diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-target-escape-');

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
          id: 'mig-target-escape',
          kind: 'text-append',
          entry: 'migrations/target-escape.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'target-escape.json'), {
    id: 'mig-target-escape',
    kind: 'text-append',
    reason: 'Attempt to write outside the generated project.',
    target: '../outside-project.md',
    content: '- should be rejected.\n'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-004',
    details: {
      failedCheck: 'migration-targets',
      migrationId: 'mig-target-escape',
      path: '../outside-project.md',
      role: 'target',
      root: 'project'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    details: {
      failedCheck: 'migration-targets',
      migrationId: 'mig-target-escape',
      path: '../outside-project.md',
      role: 'target',
      root: 'project'
    }
  });
});

test('upgrade records migration manifest source escape diagnostics before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-source-escape-');

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
          id: 'mig-source-escape',
          kind: 'file-replace',
          entry: 'migrations/source-escape.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'source-escape.json'), {
    id: 'mig-source-escape',
    kind: 'file-replace',
    reason: 'Attempt to read outside the target manifest root.',
    source: '../outside-source.ts',
    target: 'src/installed/private/slot-contract.ts'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-005',
    details: {
      failedCheck: 'migration-file-operations',
      migrationId: 'mig-source-escape',
      path: '../outside-source.ts',
      role: 'manifest-source',
      root: 'manifest'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-file-operations',
    errorCode: 'UPGRADE-MIGRATION-005',
    details: {
      failedCheck: 'migration-file-operations',
      migrationId: 'mig-source-escape',
      path: '../outside-source.ts',
      role: 'manifest-source',
      root: 'manifest'
    }
  });
});

test('upgrade rejects empty config rewrite paths before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-empty-config-path-');

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
          id: 'mig-empty-config-path',
          kind: 'config-rewrite',
          entry: 'migrations/empty-config-path.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'empty-config-path.json'), {
    id: 'mig-empty-config-path',
    kind: 'config-rewrite',
    reason: 'Reject config rewrites without a concrete target path.',
    target: 'package.json',
    updates: [
      {
        path: [],
        value: 'invalid'
      }
    ]
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-010',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-empty-config-path',
      migrationKind: 'config-rewrite',
      entry: 'migrations/empty-config-path.json'
    }
  });

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    failedCheck: string;
    errorCode: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-010',
    details: {
      migrationId: 'mig-empty-config-path',
      migrationKind: 'config-rewrite',
      entry: 'migrations/empty-config-path.json'
    }
  });
});

test('upgrade rejects JSON array structure mismatches before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-json-structure-');

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
          id: 'mig-json-array-append',
          kind: 'json-array-append',
          entry: 'migrations/json-array-append.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(projectRoot, 'upgrade.metadata.json'), {
    upgradedBlocks: 'auth/basic-session@0.1.0'
  });
  await writeJson(path.join(versionRoot, 'migrations', 'json-array-append.json'), {
    id: 'mig-json-array-append',
    kind: 'json-array-append',
    reason: 'Append upgrade metadata.',
    target: 'upgrade.metadata.json',
    path: ['upgradedBlocks'],
    items: ['private/slot-contract@0.2.0']
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-012'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-json-structure"');
});

test('upgrade rejects JSON array parent structure mismatches before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-json-parent-structure-');

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
          id: 'mig-json-array-append-nested',
          kind: 'json-array-append',
          entry: 'migrations/json-array-append-nested.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: false
        }
      ]
    }
  });
  await writeJson(path.join(projectRoot, 'upgrade.metadata.json'), {
    upgrade: 'legacy-scalar'
  });
  await writeJson(path.join(versionRoot, 'migrations', 'json-array-append-nested.json'), {
    id: 'mig-json-array-append-nested',
    kind: 'json-array-append',
    reason: 'Append nested upgrade metadata.',
    target: 'upgrade.metadata.json',
    path: ['upgrade', 'blocks'],
    items: ['private/slot-contract@0.2.0']
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-012'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-json-structure"');
});

test('upgrade rejects slot contract mismatches before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-slot-contract-mismatch-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0', 'migrations', 'customer-normalizer-contract.json'), {
    id: 'mig-customer-normalizer-contract',
    kind: 'slot-contract-update',
    reason: 'Update customer normalizer input contract to v2.',
    target: 'custom/customer_normalizer.ts',
    slotId: 'customer_normalizer',
    inputType: 'CustomerInputV3',
    outputType: 'CustomerRecordInput',
    writableZones: ['custom/customer_normalizer.ts']
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-021'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-slot-contracts"');
});

test('upgrade rejects malformed migration entries before planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-malformed-migration-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { privateRegistryRoot, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(path.join(privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0', 'migrations', 'customer-normalizer-contract.json'), {
    id: 'mig-customer-normalizer-contract',
    kind: 'slot-contract-update',
    reason: 'Update customer normalizer input contract to v2.',
    target: 'custom/customer_normalizer.ts'
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true })).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-011'
  });
  await expect(fs.readFile(upgradeDiagnosticsPath, 'utf8')).resolves.toContain('"failedCheck": "migration-entries"');
});
