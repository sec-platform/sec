import fs from 'node:fs/promises';
import type {
  LockFile,
  PlanFile
} from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import {
  throwUpgradeFailureWithSecondaryFailures,
  upgradeFailureWithSecondaryFailures
} from '../../compiler/upgrade/failure.ts';
import { publishUpgradeFailureArtifacts } from '../../application/upgrade-failure-publication.ts';
import {
  buildUpgradeExecutionTerminal,
  executePlannedWorkspaceUpgrade,
  publishAppliedUpgradeTerminal,
  resolveUpgradeRollback,
  type AppliedUpgradeTerminalPublicationOperations,
  type UpgradeExecutionTerminalReadbackOperations
} from '../../application/upgrade-apply.ts';
import {
  planWorkspaceUpgrade,
  type PlannedWorkspaceUpgrade,
  type UpgradePlanningUseCaseOperations
} from '../../application/upgrade-planning.ts';
import { planningRequestRevision } from '../../compiler/upgrade/planning.ts';
import { readLockFile } from "../../adapters/workspace/lock.ts";
import { matchesUpgradeVersionRange } from '../../adapters/upgrade/version-range.ts';
import {
  restoreWorkspace,
  retireUpgradeBackup,
  snapshotWorkspace,
  type UpgradeWorkspaceSnapshot
} from '../../adapters/upgrade/workspace-snapshot.ts';
import {
  applyMigrationEntries,
  collectUpgradePreflightEvidence,
  loadMigrationEntries
} from '../../adapters/upgrade/migration-runtime.ts';
export { applyMigrationEntries } from '../../adapters/upgrade/migration-runtime.ts';
import { requirePersistedUpgradePlan } from '../../adapters/upgrade/artifact-readback.ts';
import {
  publishUpgradeExecutionTerminal,
  publishUpgradePlan,
  resolveUpgradeExecutionTerminalPublication,
  writeUpgradeDiagnostics
} from '../../adapters/upgrade/artifact-publication.ts';
import { compileWorkspace } from '../engineering/pipeline-orchestrator.ts';
import { loadManifestById } from '../../adapters/workspace/sources/load-manifest.ts';
import { loadWorkspacePlan } from '../../adapters/workspace/sources/load-plan.ts';
import { settlePhysicalResourcesAsync } from '../../adapters/runtime-state/physical/runtime/resource-settlement.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { readOptionalJson, removeDir } from "../../adapters/filesystem/files.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { classifyCanonicalWorkspacePublicationFailure } from '../../adapters/filesystem/file-publication.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath } from "../../adapters/workspace-context.ts";
import { withProjectWriteAuthorization } from '../../adapters/workspace/project-write-authorization.ts';
import { writeYaml } from '../../adapters/workspace/yaml.ts';
import {
  createUpgradeExecutionAttempt,
  createUpgradePlan,
  requireUpgradeDigest,
  type UpgradeExecutionTerminal,
  type UpgradePlan,
  type UpgradePreview
} from '../../semantics/upgrade/upgrade-artifact.ts';

const UPGRADE_PLANNING_OPERATIONS: UpgradePlanningUseCaseOperations = Object.freeze({
  loadTargetManifest: ({ blockId, targetVersion, workspaceRoot, registrySources }) =>
    loadManifestById(blockId, {
      workspaceRoot,
      version: targetVersion,
      registrySources
    }),
  loadMigrationEntries,
  collectPreflightEvidence: collectUpgradePreflightEvidence,
  matchesVersionRange: matchesUpgradeVersionRange
});

/**
 * Computes an Upgrade preview from retained workspace inputs without acquiring
 * write authority or publishing diagnostics, plans, provenance, or Lock state.
 */
export async function planUpgradeWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string
): Promise<{
  resultKind: 'preview';
  plan: PlanFile;
  lock: LockFile;
  upgradePlan: UpgradePreview;
}> {
  workspaceRoot = getWorkspacePaths(workspaceRoot).workspaceRoot;
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  const plannedUpgrade = await planWorkspaceUpgrade({
    blockId,
    currentBlock,
    lock,
    plan,
    targetVersion,
    workspaceRoot
  }, UPGRADE_PLANNING_OPERATIONS);
  return { resultKind: 'preview', plan, lock, upgradePlan: plannedUpgrade.upgradePreview };
}

export async function runUpgradeWorkspaceWithLease(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  workspaceWriteLease: WorkspaceWriteLeaseToken
): Promise<{
  resultKind: 'applied';
  plan: PlanFile;
  lock: LockFile;
  upgradePlan: UpgradePlan;
  upgradeExecutionTerminal: UpgradeExecutionTerminal;
}> {
  const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
  await commitFence();
  workspaceRoot = getWorkspacePaths(workspaceRoot).workspaceRoot;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const plan = await loadWorkspacePlan(workspaceRoot);
  const terminalReadbackOperations: UpgradeExecutionTerminalReadbackOperations = Object.freeze({
    readPersistedPlan: () => requirePersistedUpgradePlan(workspaceRoot),
    readWorkspacePlan: () => loadWorkspacePlan(workspaceRoot)
  });
  const appliedTerminalPublicationOperations:
    AppliedUpgradeTerminalPublicationOperations = Object.freeze({
      publish: terminal => publishUpgradeExecutionTerminal(workspaceRoot, terminal, commitFence),
      resolvePublication: terminal =>
        resolveUpgradeExecutionTerminalPublication(workspaceRoot, terminal),
      isBeforeEffectFailure: error =>
        classifyCanonicalWorkspacePublicationFailure(error) === 'before-effect'
    });
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  const existingLock = await readOptionalJson<LockFile>(readableLockPath);
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  const requestRevision = planningRequestRevision({
    workspaceIdentityDigest: workspaceWriteLease.workspaceIdentityDigest,
    blockId,
    targetVersion,
    plan,
    lock: existingLock
  });
  let plannedUpgrade: PlannedWorkspaceUpgrade;
  try {
    plannedUpgrade = await planWorkspaceUpgrade({
      blockId,
      currentBlock,
      lock: existingLock,
      plan,
      targetVersion,
      workspaceRoot
    }, UPGRADE_PLANNING_OPERATIONS);
  } catch (error) {
    if (error instanceof CompilerError) {
      await publishUpgradeFailureArtifacts(
        error,
        [
          () => removeDir(
            resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
            commitFence
          ),
          () => removeDir(
            resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
            commitFence
          ),
          () => writeUpgradeDiagnostics(
            workspaceRoot,
            blockId,
            targetVersion,
            {
              phase: 'planning',
              workspaceIdentityDigest: workspaceWriteLease.workspaceIdentityDigest,
              planningRequestRevision: requestRevision
            },
            error,
            existingLock,
            commitFence
          )
        ],
        'Upgrade planning failed and failure artifact publication did not complete'
      );
    }
    throw error;
  }

  const { artifactKind: ignoredPreviewKind, ...previewMaterial } = plannedUpgrade.upgradePreview;
  const upgradePlan = createUpgradePlan({
    workspaceIdentityDigest: requireUpgradeDigest(
      workspaceWriteLease.workspaceIdentityDigest,
      'Workspace write lease identity'
    ),
    ...previewMaterial
  });
  const attempt = createUpgradeExecutionAttempt({
    leaseGeneration: workspaceWriteLease.generation,
    leaseId: workspaceWriteLease.leaseId,
    ownerFileIdentityDigest: workspaceWriteLease.ownerFileIdentityDigest
  });

  const backup = await snapshotWorkspace(workspaceRoot, lockPath, commitFence);
  let pendingApplyFailure: Error | null = null;
  let retainBackupForRecovery = false;
  let appliedTerminalCommitted = false;
  let appliedTerminalCommitUnknown = false;
  let appliedTerminalDurabilityUncertain = false;
  const postCommitFailures: unknown[] = [];

  try {
    await removeDir(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      commitFence
    );
    await removeDir(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics),
      commitFence
    );
    await publishUpgradePlan(workspaceRoot, upgradePlan, commitFence);
    const lock = await withProjectWriteAuthorization(
      {
        workspaceRoot,
        operation: 'change.upgrade',
        impactPaths: upgradePlan.impacts,
        beforeCommit: commitFence
      },
      () => executePlannedWorkspaceUpgrade(
        {
          currentBlock: plannedUpgrade.currentBlock,
          plan,
          targetVersion
        },
        {
          publishWorkspacePlan: () =>
            writeYaml(getWorkspacePaths(workspaceRoot).workspaceConfigPath, plan, commitFence),
          applyMigrations: () => applyMigrationEntries(
            workspaceRoot,
            plannedUpgrade.targetManifestRoot,
            plannedUpgrade.impacts,
            plannedUpgrade.migrationEntries,
            commitFence
          ),
          compileLock: async () => {
            const { lock } = await compileWorkspace(workspaceRoot, {
              source: 'upgrade',
              through: 'lock',
              verificationLane: 'all',
              workspaceWriteLease
            });
            return lock;
          }
        }
      )
    );
    const expectedTerminal = await buildUpgradeExecutionTerminal({
        plan: upgradePlan,
        attempt,
        resultLock: lock,
        settlement: 'applied'
      }, terminalReadbackOperations);
    const terminalPublication = await publishAppliedUpgradeTerminal(
      expectedTerminal,
      appliedTerminalPublicationOperations
    );
    if (terminalPublication.status === 'not-committed') {
      appliedTerminalCommitUnknown = terminalPublication.commitUnknown;
      throw terminalPublication.publicationFailure;
    }
    appliedTerminalCommitted = true;
    const terminal = terminalPublication.terminal;
    if (terminalPublication.durability === 'uncertain') {
      appliedTerminalDurabilityUncertain = true;
      retainBackupForRecovery = true;
      postCommitFailures.push(terminalPublication.publicationFailure);
    }
    if (terminal.settlement !== 'applied') {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade execution did not settle as applied');
    }
    if (appliedTerminalDurabilityUncertain) {
      const publicationFailure = postCommitFailures[0];
      throw publicationFailure instanceof Error
        ? publicationFailure
        : new Error(String(publicationFailure));
    }
    await recordUpgradeGeneratedArtifact(
      workspaceRoot,
      lock,
      [CI_ARTIFACT_FILES.upgradePlan, CI_ARTIFACT_FILES.upgradeExecutionTerminal],
      commitFence
    );
    if (postCommitFailures.length > 0) {
      const primary = postCommitFailures[0] instanceof Error
        ? postCommitFailures[0]
        : new Error(String(postCommitFailures[0]));
      throwUpgradeFailureWithSecondaryFailures(
        primary,
        postCommitFailures.slice(1),
        'Upgrade applied terminal committed with later publication failures'
      );
    }
    return {
      resultKind: 'applied',
      plan,
      lock,
      upgradePlan,
      upgradeExecutionTerminal: terminal
    };
  } catch (error) {
    if (appliedTerminalCommitted) {
      const primary = error instanceof Error ? error : new Error(String(error));
      const postCommitFailure = appliedTerminalDurabilityUncertain
        ? new CompilerError(
            'UPGRADE-BLOCKED-005',
            `Upgrade applied terminal is externally visible but its durability did not settle: ${primary.message}`,
            {
              rollbackStatus: 'recovery-required',
              recoverySnapshot: {
                path: backup.backup.path,
                device: backup.backup.device,
                inode: backup.backup.inode,
                parentPath: backup.temporaryParent.path,
                parentDevice: backup.temporaryParent.device,
                parentInode: backup.temporaryParent.inode,
                status: 'retained-locator-only'
              }
            },
            { cause: primary }
          )
        : primary;
      pendingApplyFailure = upgradeFailureWithSecondaryFailures(
        postCommitFailure,
        postCommitFailures.filter((failure) => failure !== error),
        'Upgrade applied terminal committed but post-commit work failed'
      );
      throw pendingApplyFailure;
    }
    const rollback = await resolveUpgradeRollback(
      {
        applyFailure: error,
        appliedTerminalCommitUnknown,
        recoverySnapshot: {
          path: backup.backup.path,
          device: backup.backup.device,
          inode: backup.backup.inode,
          parentPath: backup.temporaryParent.path,
          parentDevice: backup.temporaryParent.device,
          parentInode: backup.temporaryParent.inode,
          status: 'retained-locator-only'
        }
      },
      {
        restore: async () => {
          await commitFence();
          await restoreWorkspace(backup, lockPath, commitFence);
        }
      }
    );
    const settlement = rollback.settlement;
    if (rollback.retainBackupForRecovery) retainBackupForRecovery = true;
    const diagnosticFailure = rollback.diagnosticFailure;
    let terminal: UpgradeExecutionTerminal | null = null;
    const publicationFailures: unknown[] = [];
    if (!appliedTerminalCommitUnknown) {
      try {
        terminal = await publishUpgradeExecutionTerminal(
          workspaceRoot,
          await buildUpgradeExecutionTerminal({
            plan: upgradePlan,
            attempt,
            resultLock: settlement === 'rolled-back' ? existingLock : null,
            settlement
          }, terminalReadbackOperations),
          commitFence
        );
      } catch (publicationFailure) {
        publicationFailures.push(publicationFailure);
      }
    }
    if (terminal !== null) {
      try {
        await writeUpgradeDiagnostics(
          workspaceRoot,
          blockId,
          targetVersion,
          { phase: settlement === 'rolled-back' ? 'apply' : 'recovery', plan: upgradePlan, terminal },
          diagnosticFailure,
          settlement === 'rolled-back' ? null : existingLock,
          commitFence
        );
      } catch (publicationFailure) {
        publicationFailures.push(publicationFailure);
      }
    }
    pendingApplyFailure = upgradeFailureWithSecondaryFailures(
      diagnosticFailure,
      publicationFailures,
      'Upgrade apply failed and failure artifact publication did not complete'
    );
    throw pendingApplyFailure;
  } finally {
    if (!retainBackupForRecovery) {
      await settlePhysicalResourcesAsync({
        ...(pendingApplyFailure === null ? {} : {
          primary: { label: 'upgrade-apply', error: pendingApplyFailure }
        }),
        cleanup: [{
          label: `upgrade-backup:${backup.backup.path}`,
          settle: () => retireUpgradeBackup(backup)
        }]
      });
    }
  }
}
