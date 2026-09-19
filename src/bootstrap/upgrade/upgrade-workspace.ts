import type {
  LockFile,
  PlanFile
} from '../../compiler/contract.ts';
import {
  bindPlannedUpgradeExecution,
  executePlannedWorkspaceUpgrade,
  executeUpgradeApplyLifecycle,
  type UpgradeAppliedWorkspaceResult
} from '../../application/upgrade-apply.ts';
import {
  planUpgradeWorkspaceFromWorkspace,
  prepareUpgradeApplyPlanning,
  type UpgradePlanningUseCaseOperations
} from '../../application/upgrade-planning.ts';
import { readLockFile } from "../../adapters/workspace/lock.ts";
import { matchesUpgradeVersionRange } from '../../adapters/upgrade/version-range.ts';
import {
  restoreWorkspace,
  retireUpgradeBackup,
  snapshotWorkspace
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
  recordUpgradeGeneratedArtifact,
  resolveUpgradeExecutionTerminalPublication,
  writeUpgradeDiagnostics
} from '../../adapters/upgrade/artifact-publication.ts';
import { compileWorkspace } from '../engineering/pipeline-orchestrator.ts';
import { loadManifestById } from '../../adapters/workspace/sources/load-manifest.ts';
import { loadWorkspacePlan } from '../../adapters/workspace/sources/load-plan.ts';
import { settleResourcesAsync } from '../../execution/resource-settlement.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { readOptionalJson, removeDir } from "../../adapters/filesystem/files.ts";
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { classifyCanonicalWorkspacePublicationFailure } from '../../adapters/filesystem/file-publication.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath } from "../../adapters/workspace-context.ts";
import { withProjectWriteAuthorization } from '../../adapters/workspace/project-write-authorization.ts';
import { writeYaml } from '../../adapters/workspace/yaml.ts';
import type { UpgradePreview } from '../../semantics/upgrade/upgrade-artifact.ts';

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

const UPGRADE_PREVIEW_READ_OPERATIONS = Object.freeze({
  loadWorkspacePlan,
  readLockFile
});

/**
 * Bootstrap binds concrete workspace readers and planning providers only.
 * Application owns the preview request sequencing.
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
  return planUpgradeWorkspaceFromWorkspace(
    workspaceRoot,
    blockId,
    targetVersion,
    UPGRADE_PLANNING_OPERATIONS,
    UPGRADE_PREVIEW_READ_OPERATIONS
  );
}

export async function runUpgradeWorkspaceWithLease(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  workspaceWriteLease: WorkspaceWriteLeaseToken
): Promise<UpgradeAppliedWorkspaceResult> {
  const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
  await commitFence();
  workspaceRoot = getWorkspacePaths(workspaceRoot).workspaceRoot;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const { plan, existingLock, plannedUpgrade } = await prepareUpgradeApplyPlanning(
    {
      workspaceRoot,
      blockId,
      targetVersion,
      workspaceIdentityDigest: workspaceWriteLease.workspaceIdentityDigest
    },
    UPGRADE_PLANNING_OPERATIONS,
    {
      loadWorkspacePlan,
      readLockFile,
      readOptionalLock: async root =>
        readOptionalJson<LockFile>(await resolveWorkspaceLockPath(root)),
      clearPlan: () => removeDir(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
        commitFence
      ),
      clearExecutionTerminal: () => removeDir(
        resolveWorkspaceArtifactPath(
          workspaceRoot,
          CI_ARTIFACT_FILES.upgradeExecutionTerminal
        ),
        commitFence
      ),
      publishDiagnostics: (failure, context) => writeUpgradeDiagnostics(
        workspaceRoot,
        context.blockId,
        context.targetVersion,
        {
          phase: 'planning',
          workspaceIdentityDigest: context.workspaceIdentityDigest,
          planningRequestRevision: context.planningRequestRevision
        },
        failure,
        context.existingLock,
        commitFence
      )
    }
  );

  const { upgradePlan, attempt } = bindPlannedUpgradeExecution(
    plannedUpgrade,
    {
      workspaceIdentityDigest: workspaceWriteLease.workspaceIdentityDigest,
      leaseGeneration: workspaceWriteLease.generation,
      leaseId: workspaceWriteLease.leaseId,
      ownerFileIdentityDigest: workspaceWriteLease.ownerFileIdentityDigest
    }
  );

  return executeUpgradeApplyLifecycle(
    {
      plan,
      existingLock,
      upgradePlan,
      attempt
    },
    {
      snapshot: () => snapshotWorkspace(workspaceRoot, lockPath, commitFence),
      recoverySnapshot: backup => ({
        path: backup.backup.path,
        device: backup.backup.device,
        inode: backup.backup.inode,
        parentPath: backup.temporaryParent.path,
        parentDevice: backup.temporaryParent.device,
        parentInode: backup.temporaryParent.inode,
        status: 'retained-locator-only'
      }),
      clearExecutionTerminal: () => removeDir(
        resolveWorkspaceArtifactPath(
          workspaceRoot,
          CI_ARTIFACT_FILES.upgradeExecutionTerminal
        ),
        commitFence
      ),
      clearDiagnostics: () => removeDir(
        resolveWorkspaceArtifactPath(
          workspaceRoot,
          CI_ARTIFACT_FILES.upgradeDiagnostics
        ),
        commitFence
      ),
      publishPlan: planToPublish =>
        publishUpgradePlan(workspaceRoot, planToPublish, commitFence),
      apply: () => withProjectWriteAuthorization(
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
            publishWorkspacePlan: () => writeYaml(
              getWorkspacePaths(workspaceRoot).workspaceConfigPath,
              plan,
              commitFence
            ),
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
      ),
      terminalReadback: {
        readPersistedPlan: () => requirePersistedUpgradePlan(workspaceRoot),
        readWorkspacePlan: () => loadWorkspacePlan(workspaceRoot)
      },
      terminalPublication: {
        publish: terminal =>
          publishUpgradeExecutionTerminal(workspaceRoot, terminal, commitFence),
        resolvePublication: terminal =>
          resolveUpgradeExecutionTerminalPublication(workspaceRoot, terminal),
        isBeforeEffectFailure: error =>
          classifyCanonicalWorkspacePublicationFailure(error) === 'before-effect'
      },
      recordGeneratedArtifacts: lock => recordUpgradeGeneratedArtifact(
        workspaceRoot,
        lock,
        [
          CI_ARTIFACT_FILES.upgradePlan,
          CI_ARTIFACT_FILES.upgradeExecutionTerminal
        ],
        commitFence
      ),
      restore: async backup => {
        await commitFence();
        await restoreWorkspace(backup, lockPath, commitFence);
      },
      publishExecutionTerminal: terminal =>
        publishUpgradeExecutionTerminal(workspaceRoot, terminal, commitFence),
      publishDiagnostics: ({ phase, terminal, failure, resultLock }) =>
        writeUpgradeDiagnostics(
          workspaceRoot,
          blockId,
          targetVersion,
          { phase, plan: upgradePlan, terminal },
          failure,
          resultLock,
          commitFence
        ),
      retireBackup: (backup, primaryFailure) => settleResourcesAsync({
        ...(primaryFailure === null ? {} : {
          primary: { label: 'upgrade-apply', error: primaryFailure }
        }),
        cleanup: [{
          label: `upgrade-backup:${backup.backup.path}`,
          settle: () => retireUpgradeBackup(backup)
        }]
      })
    }
  );
}
