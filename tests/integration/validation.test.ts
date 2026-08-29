import { test } from 'bun:test';
import path from 'node:path';

import { writeJson } from '../../src/workspace/files.ts';
import { prepareSlotUpgradeDryRunFixture } from '../helpers/slot-upgrade-fixtures.ts';
import {
  expectUpgradeDryRunFailure,
  expectUpgradeDryRunFailureWithDiagnostics
} from './upgrade-diagnostics-fixtures.ts';

test('upgrade records missing migration entry diagnostics before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-missing-migration-entry-',
    migration: {
      id: 'mig-missing-entry-file',
      kind: 'text-append',
      entry: 'migrations/missing-entry-file.json',
      requiresVerification: false
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-002',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-missing-entry-file',
      migrationKind: 'text-append',
      entry: 'migrations/missing-entry-file.json'
    }
  }, {
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
  const { workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-migration-entry-escape-',
    migration: {
      id: 'mig-escaping-entry-file',
      kind: 'text-append',
      entry: '../escape.json',
      requiresVerification: false
    }
  });

  await expectUpgradeDryRunFailure(workspaceRoot, {
    code: 'UPGRADE-MIGRATION-005',
    details: {
      failedCheck: 'migration-file-operations',
      migrationId: 'mig-escaping-entry-file',
      role: 'manifest-source'
    }
  });
});

test('upgrade records mismatched migration entry metadata diagnostics before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-mismatched-migration-entry-',
    migration: {
      id: 'mig-expected-entry',
      kind: 'text-append',
      entry: 'migrations/mismatched-entry.json',
      requiresVerification: false,
      body: {
        id: 'mig-actual-entry',
        kind: 'text-replace',
        reason: 'Use mismatched metadata.',
        target: 'generated/reports/notes.md',
        search: 'pending',
        replacement: 'applied'
      }
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-003',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-expected-entry',
      migrationKind: 'text-append',
      entry: 'migrations/mismatched-entry.json',
      entryId: 'mig-actual-entry',
      entryKind: 'text-replace'
    }
  }, {
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
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-duplicate-migration-id-',
    migrations: [
      {
        id: 'mig-duplicate-report',
        kind: 'text-append',
        entry: 'migrations/append-report-a.json',
        requiresVerification: false,
        body: {
          id: 'mig-duplicate-report',
          kind: 'text-append',
          reason: 'Append first report note.',
          target: 'generated/reports/notes.md',
          content: '- first note\n'
        }
      },
      {
        id: 'mig-duplicate-report',
        kind: 'text-append',
        entry: 'migrations/append-report-b.json',
        requiresVerification: false,
        body: {
          id: 'mig-duplicate-report',
          kind: 'text-append',
          reason: 'Append second report note.',
          target: 'generated/reports/notes.md',
          content: '- second note\n'
        }
      }
    ]
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-029',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-duplicate-report',
      entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
    }
  }, {
    failedCheck: 'migration-entries',
    errorCode: 'UPGRADE-MIGRATION-029',
    details: {
      migrationId: 'mig-duplicate-report',
      entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
    }
  });
});

test('upgrade records migration target path escape diagnostics before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-target-escape-',
    migration: {
      id: 'mig-target-escape',
      kind: 'text-append',
      entry: 'migrations/target-escape.json',
      requiresVerification: false,
      body: {
        id: 'mig-target-escape',
        kind: 'text-append',
        reason: 'Attempt to write outside the generated project.',
        target: '../outside-project.md',
        content: '- should be rejected.\n'
      }
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-004',
    details: {
      failedCheck: 'migration-targets',
      migrationId: 'mig-target-escape',
      path: '../outside-project.md',
      role: 'target',
      root: 'project'
    }
  }, {
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
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-source-escape-',
    migration: {
      id: 'mig-source-escape',
      kind: 'file-replace',
      entry: 'migrations/source-escape.json',
      requiresVerification: false,
      body: {
        id: 'mig-source-escape',
        kind: 'file-replace',
        reason: 'Attempt to read outside the target manifest root.',
        source: '../outside-source.ts',
        target: 'src/installed/private/slot-contract.ts'
      }
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-005',
    details: {
      failedCheck: 'migration-file-operations',
      migrationId: 'mig-source-escape',
      path: '../outside-source.ts',
      role: 'manifest-source',
      root: 'manifest'
    }
  }, {
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
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-empty-config-path-',
    migration: {
      id: 'mig-empty-config-path',
      kind: 'config-rewrite',
      entry: 'migrations/empty-config-path.json',
      requiresVerification: false,
      body: {
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
      }
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-010',
    details: {
      failedCheck: 'migration-entries',
      migrationId: 'mig-empty-config-path',
      migrationKind: 'config-rewrite',
      entry: 'migrations/empty-config-path.json'
    }
  }, {
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
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-json-structure-',
    migration: {
      id: 'mig-json-array-append',
      kind: 'json-array-append',
      entry: 'migrations/json-array-append.json',
      requiresVerification: false,
      body: {
        id: 'mig-json-array-append',
        kind: 'json-array-append',
        reason: 'Append upgrade metadata.',
        target: 'upgrade.metadata.json',
        path: ['upgradedBlocks'],
        items: ['private/slot-contract@0.2.0']
      }
    },
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.projectRoot, 'upgrade.metadata.json'), {
        upgradedBlocks: 'auth/basic-session@0.1.0'
      });
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-012'
  }, {
    failedCheck: 'migration-json-structure'
  });
});

test('upgrade rejects JSON array parent structure mismatches before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-json-parent-structure-',
    migration: {
      id: 'mig-json-array-append-nested',
      kind: 'json-array-append',
      entry: 'migrations/json-array-append-nested.json',
      requiresVerification: false,
      body: {
        id: 'mig-json-array-append-nested',
        kind: 'json-array-append',
        reason: 'Append nested upgrade metadata.',
        target: 'upgrade.metadata.json',
        path: ['upgrade', 'blocks'],
        items: ['private/slot-contract@0.2.0']
      }
    },
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.projectRoot, 'upgrade.metadata.json'), {
        upgrade: 'legacy-scalar'
      });
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-012'
  }, {
    failedCheck: 'migration-json-structure'
  });
});

test('upgrade rejects slot contract mismatches before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-slot-contract-mismatch-',
    migration: {
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      entry: 'migrations/customer-normalizer-contract.json',
      requiresVerification: true,
      body: {
        id: 'mig-customer-normalizer-contract',
        kind: 'slot-contract-update',
        reason: 'Update customer normalizer input contract to v2.',
        target: 'custom/customer_normalizer.ts',
        slotId: 'customer_normalizer',
        inputType: 'CustomerInputV3',
        outputType: 'CustomerRecordInput',
        writableZones: ['custom/customer_normalizer.ts']
      }
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-021'
  }, {
    failedCheck: 'migration-slot-contracts'
  });
});

test('upgrade rejects malformed migration entries before planning', async () => {
  const { paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-malformed-migration-',
    migration: {
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      entry: 'migrations/customer-normalizer-contract.json',
      requiresVerification: true,
      body: {
        id: 'mig-customer-normalizer-contract',
        kind: 'slot-contract-update',
        reason: 'Update customer normalizer input contract to v2.',
        target: 'custom/customer_normalizer.ts'
      }
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(workspaceRoot, paths.upgradeDiagnosticsPath, {
    code: 'UPGRADE-MIGRATION-011'
  }, {
    failedCheck: 'migration-entries'
  });
});
