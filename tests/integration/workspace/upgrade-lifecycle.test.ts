import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWorkspaceWriteLeaseManager } from '../../../src/adapters/filesystem/write-lease.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  PhysicalNoFollowError,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory
} from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { calculateCanonicalProjectFileHash } from '../../../src/adapters/workspace/project-file-hash.ts';
import { readOptionalProvenanceFile } from '../../../src/adapters/workspace/provenance-reader.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { runUpgradeWorkspaceWithLease } from '../../../src/bootstrap/upgrade/upgrade-workspace.ts';
import {
  parseUpgradeExecutionTerminalJson,
  parseUpgradePlanJson
} from '../../../src/semantics/upgrade/upgrade-artifact.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { prepareBlockUpgradeDryRunFixture, writeBlockUpgradeFixture } from '../../helpers/block-upgrade-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';
import { expectUpgradeDryRunFailureWithoutDiagnostics } from './upgrade-dry-run-fixtures.ts';

test('upgrade success provenance binds the committed applied terminal bytes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);
    const paths = getWorkspacePaths(workspaceRoot);
    const migratedTarget = path.join(paths.workspaceRoot, 'src', 'installed', 'private', 'customer-normalizer.ts');
    const originalTarget = await fs.readFile(migratedTarget, 'utf8');

    const result = await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0');

    expect(result.plan.blocks).toContainEqual({ id: 'private/block-upgrade', version: '0.2.0' });
    expect(result.lock.resolvedBlocks).toContainEqual(expect.objectContaining({
      id: 'private/block-upgrade',
      version: '0.2.0'
    }));
    expect(result.lock.resolvedBlocks).toContainEqual(expect.objectContaining({
      id: 'private/tenant-context'
    }));
    expect(result.lock.resolvedCapabilities).toContain('tenant/context');
    expect(result.upgradePlan).toMatchObject({
      blockId: 'private/block-upgrade',
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      migrationKindCounts: { 'file-replace': 1 }
    });
    expect(result.upgradePlan.migrationOperations).toContainEqual(expect.objectContaining({
      id: 'mig-customer-normalizer-file',
      kind: 'file-replace',
      role: 'file',
      source: 'files/src/installed/private/customer-normalizer.ts',
      target: 'src/installed/private/customer-normalizer.ts'
    }));
    const migratedSource = await fs.readFile(migratedTarget, 'utf8');
    expect(migratedSource).not.toBe(originalTarget);
    expect(migratedSource).toContain('normalized: true');

    const persistedPlan = parseUpgradePlanJson(await fs.readFile(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
      'utf8'
    ));
    expect(persistedPlan).toEqual(result.upgradePlan);
    const persistedTerminal = parseUpgradeExecutionTerminalJson(await fs.readFile(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      'utf8'
    ));
    expect(persistedTerminal).toMatchObject({
      settlement: 'applied',
      workspaceIdentityDigest: persistedPlan.workspaceIdentityDigest,
      operationIdentityDigest: persistedPlan.operationIdentityDigest,
      planRevision: persistedPlan.planRevision,
      readback: {
        workspaceBlockVersion: '0.2.0',
        resolvedBlockVersion: '0.2.0'
      }
    });
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
}, 180000);

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

  const configPath = getWorkspacePaths(workspaceRoot).workspaceConfigPath;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const configBefore = await fs.readFile(configPath);
  const lockBefore = await fs.readFile(lockPath);
  await expect(fs.lstat(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics)))
    .rejects.toMatchObject({ code: 'ENOENT' });

  await expectUpgradeDryRunFailureWithoutDiagnostics(
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
    }
  );
  expect(await fs.readFile(configPath)).toEqual(configBefore);
  expect(await fs.readFile(lockPath)).toEqual(lockBefore);
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

  const configPath = getWorkspacePaths(workspaceRoot).workspaceConfigPath;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const configBefore = await fs.readFile(configPath);
  const lockBefore = await fs.readFile(lockPath);
  await expect(fs.lstat(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics)))
    .rejects.toMatchObject({ code: 'ENOENT' });

  await expectUpgradeDryRunFailureWithoutDiagnostics(
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
    }
  );
  expect(await fs.readFile(configPath)).toEqual(configBefore);
  expect(await fs.readFile(lockPath)).toEqual(lockBefore);
});
