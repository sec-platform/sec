import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { runUpgradeWorkspaceWithLease } from '../../src/change-management/upgrade/upgrade-workspace.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  PhysicalNoFollowError,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory
} from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { settlePhysicalResourcesAsync } from '../../src/runtime-state/physical/runtime/resource-settlement.ts';
import { readOptionalProvenanceFile } from '../../src/semantic/provenance/authority.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { writeJson } from '../../src/workspace/files.ts';
import { createWorkspaceWriteLeaseManager } from '../../src/workspace/lease.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { calculateCanonicalProjectFileHash } from '../../src/workspace/runtime/project-file-hash.ts';
import { prepareBlockUpgradeDryRunFixture, writeBlockUpgradeFixture } from '../helpers/block-upgrade-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { expectUpgradeDryRunFailure, expectUpgradeDryRunFailureWithDiagnostics } from './upgrade-diagnostics-fixtures.ts';

test('upgrade success provenance binds the committed applied terminal bytes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);
    await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0');
    const terminalPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.upgradeExecutionTerminal
    );
    const provenance = readOptionalProvenanceFile(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance),
      'Upgrade success provenance'
    );
    const terminalArtifacts = provenance?.artifacts.filter(
      ({ path: artifactPath }) => artifactPath === CI_ARTIFACT_FILES.upgradeExecutionTerminal
    ) ?? [];
    expect(terminalArtifacts).toHaveLength(1);
    expect(terminalArtifacts[0]?.hash).toBe(calculateCanonicalProjectFileHash(terminalPath));
  }, 'engineering-compiler-upgrade-terminal-provenance-');
});

test('upgrade preserves planning failure when provenance publication rejects a foreign parent', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-secondary-publication-',
    migration: {
      id: 'mig-missing-entry-file',
      kind: 'text-append',
      entry: 'migrations/missing-entry-file.json',
      requiresVerification: false
    }
  });
  const provenancePath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.provenance
  );
  const provenanceParent = path.dirname(provenancePath);
  const foreignParent = path.join(workspaceRoot, 'foreign-provenance');
  await fs.rm(provenanceParent, { recursive: true, force: true });
  await fs.mkdir(foreignParent, { recursive: true });
  await fs.symlink(
    foreignParent,
    provenanceParent,
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  let failure: unknown;
  try {
    await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0');
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AggregateError);
  const aggregate = failure as AggregateError;
  expect(aggregate.errors).toHaveLength(2);
  expect(aggregate.cause).toBe(aggregate.errors[0]);
  expect(aggregate.errors[0]).toMatchObject({ code: 'UPGRADE-MIGRATION-002' });
  expect(aggregate.errors[1]).toBeInstanceOf(PhysicalNoFollowError);
  expect((aggregate.errors[1] as PhysicalNoFollowError).code)
    .toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
});

test('upgrade retains its recovery snapshot when the write lease is lost before rollback', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);
    const migratedTarget = path.join(
      workspaceRoot,
      'src',
      'installed',
      'private',
      'customer-normalizer.ts'
    );
    const originalTarget = await fs.readFile(migratedTarget, 'utf8');
    await fs.rm(path.join(
      getWorkspacePaths(workspaceRoot).privateRegistryRoot,
      'private.block-upgrade',
      'files',
      'src',
      'installed',
      'private',
      'block-upgrade.ts'
    ));
    const manager = createWorkspaceWriteLeaseManager();
    const lease = await manager.acquire(workspaceRoot);
    const execution = runUpgradeWorkspaceWithLease(
      workspaceRoot,
      'private/block-upgrade',
      '0.2.0',
      lease.token
    ).then(
      (value) => ({ value } as const),
      (error: unknown) => ({ error } as const)
    );
    let leaseReleased = false;
    let observationFailure: unknown = null;
    let releaseFailure: unknown = null;
    let executionOutcome: Awaited<typeof execution>;
    try {
      const observationDeadline = Date.now() + 10_000;
      while (await fs.readFile(migratedTarget, 'utf8') === originalTarget) {
        if (Date.now() >= observationDeadline) {
          throw new Error('Upgrade migration was not observed before the lease-loss deadline.');
        }
        await Bun.sleep(5);
      }
      await lease.release();
      leaseReleased = true;
    } catch (error) {
      observationFailure = error;
    }
    if (!leaseReleased) {
      try {
        await lease.release();
        leaseReleased = true;
      } catch (error) {
        releaseFailure = error;
      }
    }
    executionOutcome = await execution;
    const failure = 'error' in executionOutcome ? executionOutcome.error : undefined;
    const aggregate = failure instanceof AggregateError ? failure : null;
    const primary = aggregate?.cause as (Error & {
      readonly details?: { readonly recoverySnapshot?: {
        readonly path?: unknown;
        readonly device?: unknown;
        readonly inode?: unknown;
        readonly parentPath?: unknown;
        readonly parentDevice?: unknown;
        readonly parentInode?: unknown;
        readonly status?: unknown;
      } };
    }) | undefined;
    const snapshotPath = primary?.details?.recoverySnapshot?.path;
    const snapshotDetails = primary?.details?.recoverySnapshot;
    let assertionFailure: unknown = observationFailure ?? releaseFailure;
    if (assertionFailure === null) {
      try {
        expect(failure).toBeInstanceOf(AggregateError);
        expect(primary?.details).toMatchObject({
          rollbackStatus: 'recovery-required',
          recoverySnapshot: { status: 'retained-locator-only' }
        });
        expect(primary?.cause).toBeInstanceOf(AggregateError);
        expect((primary?.cause as AggregateError).errors[1])
          .toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-002' });
        expect(await fs.readFile(migratedTarget, 'utf8')).not.toBe(originalTarget);
        if (typeof snapshotPath !== 'string' || typeof snapshotDetails?.parentPath !== 'string') {
          throw new Error('Expected retained recovery snapshot and parent locators.');
        }
      } catch (error) {
        assertionFailure = error;
      }
    }
    await settlePhysicalResourcesAsync({
      ...(assertionFailure === null ? {} : {
        primary: { label: 'upgrade-recovery-test', error: assertionFailure }
      }),
      cleanup: typeof snapshotPath === 'string' && typeof snapshotDetails?.parentPath === 'string'
        ? [{
            label: 'upgrade-recovery-test-snapshot',
            settle: () => {
              const temporaryParent = inspectNoFollowDirectoryChain(
                snapshotDetails.parentPath as string,
                'Upgrade recovery test temporary parent'
              ).target;
              if (temporaryParent.device !== snapshotDetails.parentDevice
                  || temporaryParent.inode !== snapshotDetails.parentInode) {
                throw new Error('Upgrade recovery test temporary parent identity changed.');
              }
              const snapshot = inspectNoFollowDirectoryLeaf(
                temporaryParent,
                path.basename(snapshotPath),
                'Upgrade recovery test snapshot'
              );
              if (snapshot === null || snapshot.device !== snapshotDetails.device
                  || snapshot.inode !== snapshotDetails.inode) {
                throw new Error('Upgrade recovery test snapshot identity changed.');
              }
              const inventory = scanNoFollowDirectoryTreeInventory(snapshot, {
                deadlineAtMs: performance.now() + 30_000,
                maximumEntries: 100_000,
                maximumBytes: 1024 * 1024 * 1024,
                includePermissionMode: true
              });
              retireNoFollowDirectoryTree({
                deadlineAtMonotonicMs: performance.now() + 30_000,
                inventory,
                parent: temporaryParent,
                root: snapshot,
                restoreOwnerPermissions: true
              });
            }
          }]
        : []
    });
  }, 'engineering-compiler-upgrade-fence-recovery-');
});

test('upgrade rollback restores nested preserved-name entries and file permission modes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);
    const paths = getWorkspacePaths(workspaceRoot);
    const nestedPath = path.join(workspaceRoot, 'src', 'coverage', 'retained.txt');
    const rootFilePath = path.join(workspaceRoot, 'rollback-root.txt');
    const graphLockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const graphLockPreimage = await fs.readFile(graphLockPath);
    await fs.mkdir(path.dirname(nestedPath), { recursive: true });
    await fs.writeFile(nestedPath, 'nested preimage\n');
    await fs.writeFile(rootFilePath, 'root preimage\n');
    if (process.platform === 'linux') {
      await fs.chmod(nestedPath, 0o640);
      await fs.chmod(rootFilePath, 0o750);
    }
    const nestedMode = (await fs.lstat(nestedPath)).mode & 0o7777;
    const rootMode = (await fs.lstat(rootFilePath)).mode & 0o7777;
    await fs.rm(path.join(
      paths.privateRegistryRoot,
      'private.block-upgrade',
      'files',
      'src',
      'installed',
      'private',
      'block-upgrade.ts'
    ));

    await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0'))
      .rejects.toMatchObject({ details: { rollbackStatus: 'restored' } });
    await expect(fs.readFile(nestedPath, 'utf8')).resolves.toBe('nested preimage\n');
    await expect(fs.readFile(rootFilePath, 'utf8')).resolves.toBe('root preimage\n');
    expect(await fs.readFile(graphLockPath)).toEqual(graphLockPreimage);
    if (process.platform === 'linux') {
      expect((await fs.lstat(nestedPath)).mode & 0o7777).toBe(nestedMode);
      expect((await fs.lstat(rootFilePath)).mode & 0o7777).toBe(rootMode);
    }
  }, 'engineering-compiler-upgrade-nested-rollback-');
});

test('upgrade records missing migration entry diagnostics before planning', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
    prefix: 'engineering-compiler-upgrade-missing-migration-entry-',
    migration: {
      id: 'mig-missing-entry-file',
      kind: 'text-append',
      entry: 'migrations/missing-entry-file.json',
      requiresVerification: false
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-002',
      details: {
        failedCheck: 'migration-entries',
        migrationId: 'mig-missing-entry-file',
        migrationKind: 'text-append',
        entry: 'migrations/missing-entry-file.json'
      }
    },
    {
      failedCheck: 'migration-entries',
      errorCode: 'UPGRADE-MIGRATION-002',
      details: {
        migrationId: 'mig-missing-entry-file',
        migrationKind: 'text-append',
        entry: 'migrations/missing-entry-file.json'
      }
    }
  );
});

test('upgrade rejects migration entry paths that escape the manifest root', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-003',
      details: {
        failedCheck: 'migration-entries',
        migrationId: 'mig-expected-entry',
        migrationKind: 'text-append',
        entry: 'migrations/mismatched-entry.json',
        entryId: 'mig-actual-entry',
        entryKind: 'text-replace'
      }
    },
    {
      failedCheck: 'migration-entries',
      errorCode: 'UPGRADE-MIGRATION-003',
      details: {
        migrationId: 'mig-expected-entry',
        migrationKind: 'text-append',
        entry: 'migrations/mismatched-entry.json',
        entryId: 'mig-actual-entry',
        entryKind: 'text-replace'
      }
    }
  );
});

test('upgrade rejects duplicate migration ids before planning', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-029',
      details: {
        failedCheck: 'migration-entries',
        migrationId: 'mig-duplicate-report',
        entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
      }
    },
    {
      failedCheck: 'migration-entries',
      errorCode: 'UPGRADE-MIGRATION-029',
      details: {
        migrationId: 'mig-duplicate-report',
        entries: ['migrations/append-report-a.json', 'migrations/append-report-b.json']
      }
    }
  );
});

test('upgrade records migration target path escape diagnostics before planning', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-004',
      details: {
        failedCheck: 'migration-targets',
        migrationId: 'mig-target-escape',
        path: '../outside-project.md',
        role: 'target',
        root: 'project'
      }
    },
    {
      failedCheck: 'migration-targets',
      errorCode: 'UPGRADE-MIGRATION-004',
      details: {
        failedCheck: 'migration-targets',
        migrationId: 'mig-target-escape',
        path: '../outside-project.md',
        role: 'target',
        root: 'project'
      }
    }
  );
});

test('upgrade records migration manifest source escape diagnostics before planning', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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
        target: 'src/installed/private/block-upgrade.ts'
      }
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-005',
      details: {
        failedCheck: 'migration-file-operations',
        migrationId: 'mig-source-escape',
        path: '../outside-source.ts',
        role: 'manifest-source',
        root: 'manifest'
      }
    },
    {
      failedCheck: 'migration-file-operations',
      errorCode: 'UPGRADE-MIGRATION-005',
      details: {
        failedCheck: 'migration-file-operations',
        migrationId: 'mig-source-escape',
        path: '../outside-source.ts',
        role: 'manifest-source',
        root: 'manifest'
      }
    }
  );
});

test('upgrade rejects empty config rewrite paths before planning', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-010',
      details: {
        failedCheck: 'migration-entries',
        migrationId: 'mig-empty-config-path',
        migrationKind: 'config-rewrite',
        entry: 'migrations/empty-config-path.json'
      }
    },
    {
      failedCheck: 'migration-entries',
      errorCode: 'UPGRADE-MIGRATION-010',
      details: {
        migrationId: 'mig-empty-config-path',
        migrationKind: 'config-rewrite',
        entry: 'migrations/empty-config-path.json'
      }
    }
  );
});

test('upgrade rejects JSON array structure mismatches before planning', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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
        items: ['private/block-upgrade@0.2.0']
      }
    },
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.workspaceRoot, 'upgrade.metadata.json'), {
        upgradedBlocks: 'auth/basic-session@0.1.0'
      });
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-012'
    },
    {
      failedCheck: 'migration-json-structure'
    }
  );
});

test('upgrade rejects JSON array parent structure mismatches before planning', async () => {
  const { workspaceRoot } = await prepareBlockUpgradeDryRunFixture({
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
        items: ['private/block-upgrade@0.2.0']
      }
    },
    setup: async ({ paths: workspacePaths }) => {
      await writeJson(path.join(workspacePaths.workspaceRoot, 'upgrade.metadata.json'), {
        upgrade: 'legacy-scalar'
      });
    }
  });

  await expectUpgradeDryRunFailureWithDiagnostics(
    workspaceRoot,
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
    {
      code: 'UPGRADE-MIGRATION-012'
    },
    {
      failedCheck: 'migration-json-structure'
    }
  );
});
