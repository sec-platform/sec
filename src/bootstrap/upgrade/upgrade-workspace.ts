import type {
  LockFile,
  PlanFile
} from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { publishUpgradePlanningFailure } from '../../application/upgrade-failure-publication.ts';
import {
  bindPlannedUpgradeExecution,
  executePlannedWorkspaceUpgrade,
  executeUpgradeApplyLifecycle,
  type UpgradeAppliedWorkspaceResult
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
import { settlePhysicalResourcesAsync } from '../../adapters/runtime-state/physical/runtime/resource-settlement.ts';
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
): Promise<UpgradeAppliedWorkspaceResult> {
  const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
  await commitFence();
  workspaceRoot = getWorkspacePaths(workspaceRoot).workspaceRoot;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const plan = await loadWorkspacePlan(workspaceRoot);
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
    return publishUpgradePlanningFailure(error, [
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
        error as CompilerError,
        existingLock,
        commitFence
      )
    ]);
  }

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
      retireBackup: (backup, primaryFailure) => settlePhysicalResourcesAsync({
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
