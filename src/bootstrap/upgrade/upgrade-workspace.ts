import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  LockFile,
  PlanFile,
  UpgradeMigration
} from '../../compiler/contract.ts';
import { writeProvenance } from '../../adapters/compilation/emit/write-provenance.ts';
import { CompilerError } from '../../compiler/errors.ts';
import {
  isEmptyDiagnosticsDetails,
  isPlainObjectDetails,
  migrationManifestDetails,
  normalizeCauseDetails,
  throwUpgradeFailureWithSecondaryFailures,
  upgradeFailureWithSecondaryFailures
} from '../../compiler/upgrade/failure.ts';
import {
  buildUpgradePreflightChecks,
  buildUpgradePreview,
  classifyPreflightFailure,
  collectMigrationImpacts,
  lockStateRevision,
  planningRequestRevision,
} from '../../compiler/upgrade/planning.ts';
import { addGeneratedPaths } from "../../compiler/contract/lock-schema.ts";
import { readLockFile } from "../../adapters/workspace/lock.ts";
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
import { compileWorkspace } from '../engineering/pipeline-orchestrator.ts';
import { loadManifestById } from '../../adapters/workspace/sources/load-manifest.ts';
import { loadWorkspacePlan } from '../../adapters/workspace/sources/load-plan.ts';
import { settlePhysicalResourcesAsync } from '../../adapters/runtime-state/physical/runtime/resource-settlement.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../adapters/runtime-state/physical/runtime/retained-file-read.ts';
import { isCanonicalRegistryVersion } from '../../semantics/identity/block.ts';
import { uniqueSorted } from '../../contracts/canonical.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { readJson, readOptionalJson, removeDir, writeJson } from "../../adapters/filesystem/files.ts";
import { formatJsonFile } from "../../contracts/json-text.ts";
import { publishExistingParentCanonicalWorkspaceFile } from "../../adapters/filesystem/file-publication.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { classifyCanonicalWorkspacePublicationFailure } from '../../adapters/filesystem/file-publication.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath } from "../../adapters/workspace-context.ts";
import { withProjectWriteAuthorization } from '../../adapters/workspace/project-write-authorization.ts';
import { writeYaml } from '../../adapters/workspace/yaml.ts';
import type { UpgradeMigrationEntry } from '../../semantics/upgrade/manifest-types.ts';
import {
  createUpgradeExecutionAttempt,
  createUpgradeExecutionTerminal,
  createUpgradePlan,
  createUpgradePreview,
  parseUpgradeExecutionTerminalJson,
  parseUpgradePlanJson,
  requireUpgradeDigest,
  UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
  upgradeArtifactDigest,
  validateUpgradeDiagnostics,
  type UpgradeDiagnostics,
  type UpgradeExecutionTerminal,
  type UpgradePlan,
  type UpgradePreflightCheck,
  type UpgradePreview
} from '../../semantics/upgrade/upgrade-artifact.ts';

function matchesUpgradeRange(version: string, range: string): boolean {
  const supportedRange = isCanonicalRegistryVersion(range) || /^\d+\.\d+\.x$/u.test(range);
  return supportedRange && Bun.semver.satisfies(version, range);
}

function ensureUpgradeAllowed(currentVersion: string, targetVersion: string, migrations: UpgradeMigration[], from: string[]): void {
  if (currentVersion === targetVersion) {
    throw new CompilerError('UPGRADE-NOOP-001', `Block is already at version "${targetVersion}"`);
  }
  if (from.length === 0) {
    throw new CompilerError('UPGRADE-BLOCKED-001', `Target version "${targetVersion}" does not support automatic upgrade`);
  }
  if (!from.some((range) => matchesUpgradeRange(currentVersion, range))) {
    throw new CompilerError(
      'UPGRADE-BLOCKED-002',
      `Target version "${targetVersion}" does not accept upgrade from "${currentVersion}"`
    );
  }
  for (const migration of migrations) {
    if (!migration.entry) {
      throw new CompilerError(
        'UPGRADE-MIGRATION-001',
        `Migration "${migration.id}" is missing entry`,
        migrationManifestDetails(migration)
      );
    }
  }
}

function withRollbackDiagnostics(error: CompilerError): CompilerError {
  const rollbackDetails = { rollbackStatus: 'restored' };
  if (isEmptyDiagnosticsDetails(error.details)) {
    return new CompilerError(error.code, error.message, rollbackDetails, { cause: error });
  }
  if (isPlainObjectDetails(error.details)) {
    return new CompilerError(error.code, error.message, {
      ...error.details,
      ...rollbackDetails
    }, { cause: error });
  }
  return new CompilerError(error.code, error.message, {
    ...rollbackDetails,
    causeDetails: normalizeCauseDetails(error.details)
  }, { cause: error });
}

async function publishUpgradeFailureArtifacts(
  primary: Error,
  publications: readonly (() => Promise<void>)[],
  message: string
): Promise<never> {
  const secondaryFailures: unknown[] = [];
  for (const publish of publications) {
    try {
      await publish();
    } catch (error) {
      secondaryFailures.push(error);
    }
  }
  throwUpgradeFailureWithSecondaryFailures(primary, secondaryFailures, message);
}

type UpgradePlanningOptions = {
  blockId: string;
  currentBlock: PlanFile['blocks'][number] | undefined;
  lock: LockFile | null;
  plan: PlanFile;
  targetVersion: string;
  workspaceRoot: string;
};

type PlannedWorkspaceUpgrade = {
  currentBlock: PlanFile['blocks'][number];
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  targetManifestRoot: string;
  upgradePreview: UpgradePreview;
};

async function planWorkspaceUpgrade(options: UpgradePlanningOptions): Promise<PlannedWorkspaceUpgrade> {
  const { blockId, currentBlock, lock, plan, targetVersion, workspaceRoot } = options;
  if (!currentBlock?.version) {
    throw new CompilerError('UPGRADE-BLOCKED-003', `Block "${blockId}" is not declared in app.plan.yaml`);
  }

  const currentVersion = currentBlock.version;
  const targetEntry = await loadManifestById(blockId, {
    workspaceRoot,
    version: targetVersion,
    registrySources: plan.registry.sources
  });
  const migrations = targetEntry.manifest.upgrade?.migrations ?? [];
  const acceptedRanges = targetEntry.manifest.upgrade?.from ?? [];
  ensureUpgradeAllowed(currentVersion, targetVersion, migrations, acceptedRanges);

  const targetManifestRoot = path.dirname(targetEntry.manifestPath);
  const migrationEntries = await loadMigrationEntries(targetManifestRoot, blockId, targetVersion, migrations);
  const impacts = uniqueSorted([
    ...targetEntry.manifest.installs.map((install) => install.to),
    ...collectMigrationImpacts(migrationEntries)
  ]);
  const evidence = await collectUpgradePreflightEvidence({
    blockId,
    impacts,
    migrationEntries,
    targetManifestRoot,
    workspaceRoot
  });
  const preflightChecks = buildUpgradePreflightChecks({
    acceptedRanges,
    currentVersion,
    evidence,
    impacts,
    migrationEntries,
    migrations,
    targetVersion
  });
  const compatibility = targetEntry.manifest.compatibility;
  if (!compatibility) {
    throw new CompilerError('UPGRADE-BLOCKED-004', `Block "${blockId}" target compatibility is unresolved`);
  }
  const sourceRevision = upgradeArtifactDigest({
    domain: 'sec.upgrade.source',
    manifest: targetEntry.manifest,
    manifestPath: targetEntry.manifestPath,
    registrySourceId: targetEntry.registrySourceId,
    registryKind: targetEntry.registryKind,
    registryLocation: targetEntry.registryLocation,
    registryPath: targetEntry.registryPath,
    migrationEntries
  });
  const lockRevision = lockStateRevision(lock);

  return {
    currentBlock,
    impacts,
    migrationEntries,
    targetManifestRoot,
    upgradePreview: buildUpgradePreview(
      blockId,
      currentVersion,
      targetVersion,
      upgradeArtifactDigest({
        domain: 'sec.upgrade.planning-input',
        blockId,
        targetVersion,
        workspacePlan: plan,
        sourceRevision,
        lockRevision,
        compatibility
      }),
      sourceRevision,
      lockRevision,
      compatibility,
      preflightChecks,
      impacts,
      migrations,
      migrationEntries
    )
  };
}

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
  });
  return { resultKind: 'preview', plan, lock, upgradePlan: plannedUpgrade.upgradePreview };
}

async function recordUpgradeGeneratedArtifact(
  workspaceRoot: string,
  lock: LockFile,
  artifactPaths: readonly string[],
  commitFence: CommitFence
): Promise<void> {
  addGeneratedPaths(lock, artifactPaths);
  await writeProvenance(workspaceRoot, lock, commitFence);
}

async function writeUpgradeDiagnostics(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  provenance:
    | {
        phase: 'planning';
        workspaceIdentityDigest: string;
        planningRequestRevision: `sha256:${string}`;
      }
    | {
        phase: 'apply' | 'recovery';
        plan: UpgradePlan;
        terminal: UpgradeExecutionTerminal;
      },
  error: CompilerError,
  lock: LockFile | null,
  commitFence: CommitFence
): Promise<void> {
  const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeDiagnostics
  );
  const details = isEmptyDiagnosticsDetails(error.details) ? undefined : error.details;
  const diagnostics: UpgradeDiagnostics = provenance.phase === 'planning'
    ? validateUpgradeDiagnostics({
        formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
        artifactKind: 'upgrade-diagnostics',
        status: 'blocked',
        phase: 'planning',
        workspaceIdentityDigest: provenance.workspaceIdentityDigest,
        planningRequestRevision: provenance.planningRequestRevision,
        blockId,
        targetVersion,
        failedCheck: classifyPreflightFailure(error.code),
        errorCode: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details })
      })
    : validateUpgradeDiagnostics({
        formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
        artifactKind: 'upgrade-diagnostics',
        status: 'blocked',
        phase: provenance.phase,
        workspaceIdentityDigest: provenance.plan.workspaceIdentityDigest,
        operationIdentityDigest: provenance.plan.operationIdentityDigest,
        planRevision: provenance.plan.planRevision,
        attemptRevision: provenance.terminal.attempt.attemptRevision,
        executionTerminalRevision: provenance.terminal.terminalRevision,
        blockId,
        targetVersion,
        failedCheck: classifyPreflightFailure(error.code),
        errorCode: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details })
      });
  await writeJson(upgradeDiagnosticsPath, diagnostics, commitFence);
  if (!lock) {
    return;
  }
  await recordUpgradeGeneratedArtifact(
    workspaceRoot,
    lock,
    provenance.phase === 'planning'
      ? [CI_ARTIFACT_FILES.upgradeDiagnostics]
      : [
          CI_ARTIFACT_FILES.upgradePlan,
          CI_ARTIFACT_FILES.upgradeExecutionTerminal,
          CI_ARTIFACT_FILES.upgradeDiagnostics
        ],
    commitFence
  );
}

type UpgradeApplyContext = PlannedWorkspaceUpgrade & {
  commitFence: CommitFence;
  plan: PlanFile;
  targetVersion: string;
  workspaceWriteLease: WorkspaceWriteLeaseToken;
  workspaceRoot: string;
};

async function applyPlannedWorkspaceUpgrade(context: UpgradeApplyContext): Promise<LockFile> {
  const {
    commitFence,
    impacts,
    migrationEntries,
    plan,
    currentBlock,
    targetManifestRoot,
    targetVersion,
    workspaceWriteLease,
    workspaceRoot
  } = context;

  currentBlock.version = targetVersion;
  await writeYaml(getWorkspacePaths(workspaceRoot).workspaceConfigPath, plan, commitFence);
  await applyMigrationEntries(
    workspaceRoot,
    targetManifestRoot,
    impacts,
    migrationEntries,
    commitFence
  );

  const { lock } = await compileWorkspace(workspaceRoot, {
    source: 'upgrade',
    through: 'lock',
    verificationLane: 'all',
    workspaceWriteLease
  });
  return lock;
}

function readPersistedUpgradePlan(workspaceRoot: string): UpgradePlan {
  const artifactPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
  const bytes = readOptionalRetainedOrdinaryFile(artifactPath, 'Upgrade plan readback');
  if (bytes === null) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade plan readback is absent after publication');
  }
  return parseUpgradePlanJson(decodeExactUtf8(bytes, 'Upgrade plan readback'));
}

function readPersistedUpgradeExecutionTerminal(workspaceRoot: string): UpgradeExecutionTerminal {
  const artifactPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeExecutionTerminal
  );
  const bytes = readOptionalRetainedOrdinaryFile(artifactPath, 'Upgrade execution terminal readback');
  if (bytes === null) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade execution terminal readback is absent after publication');
  }
  return parseUpgradeExecutionTerminalJson(decodeExactUtf8(bytes, 'Upgrade execution terminal readback'));
}

async function buildUpgradeExecutionTerminal(input: {
  workspaceRoot: string;
  plan: UpgradePlan;
  attempt: UpgradeExecutionTerminal['attempt'];
  resultLock: LockFile | null;
  settlement: UpgradeExecutionTerminal['settlement'];
}): Promise<UpgradeExecutionTerminal> {
  const persistedPlan = readPersistedUpgradePlan(input.workspaceRoot);
  let workspacePlan: PlanFile | null = null;
  try {
    workspacePlan = await loadWorkspacePlan(input.workspaceRoot);
  } catch (error) {
    if (input.settlement !== 'recovery-required') throw error;
  }
  const workspaceBlockVersion = workspacePlan?.blocks.find((block) => block.id === input.plan.blockId)?.version ?? null;
  const resolvedBlockVersion = input.resultLock?.resolvedBlocks
    .find((block) => block.id === input.plan.blockId)?.version ?? null;
  return createUpgradeExecutionTerminal({
    workspaceIdentityDigest: input.plan.workspaceIdentityDigest,
    operationIdentityDigest: input.plan.operationIdentityDigest,
    planRevision: input.plan.planRevision,
    attempt: input.attempt,
    receipts: {
      workspacePlanRevision: upgradeArtifactDigest({
        domain: 'sec.upgrade.workspace-plan-readback',
        state: workspacePlan === null ? 'unresolved' : 'observed',
        plan: workspacePlan
      }),
      resultLockRevision: lockStateRevision(input.resultLock),
      planArtifactRevision: persistedPlan.planRevision
    },
    settlement: input.settlement,
    readback: {
      workspaceBlockVersion,
      resolvedBlockVersion
    }
  });
}

async function publishUpgradeExecutionTerminal(
  workspaceRoot: string,
  terminal: UpgradeExecutionTerminal,
  commitFence: CommitFence
): Promise<UpgradeExecutionTerminal> {
  await publishExistingParentCanonicalWorkspaceFile({
    workspaceRoot,
    targetPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
    bytes: Buffer.from(formatJsonFile(terminal), 'utf8'),
    label: 'Upgrade execution terminal',
    commitFence
  });
  const readback = readPersistedUpgradeExecutionTerminal(workspaceRoot);
  if (readback.terminalRevision !== terminal.terminalRevision) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade execution terminal readback differs from publication');
  }
  return readback;
}

function resolveUpgradeExecutionTerminalPublication(
  workspaceRoot: string,
  expected: UpgradeExecutionTerminal
): 'committed' | 'absent' | 'unknown' {
  try {
    const bytes = readOptionalRetainedOrdinaryFile(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      'Upgrade execution terminal commit resolution'
    );
    if (bytes === null) return 'absent';
    const expectedBytes = Buffer.from(formatJsonFile(expected), 'utf8');
    if (!Buffer.from(bytes).equals(expectedBytes)) return 'unknown';
    const parsed = parseUpgradeExecutionTerminalJson(decodeExactUtf8(bytes, 'Upgrade execution terminal commit resolution'));
    return parsed.terminalRevision === expected.terminalRevision ? 'committed' : 'unknown';
  } catch {
    return 'unknown';
  }
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
    });
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
    await writeJson(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
      upgradePlan,
      commitFence
    );
    const persistedPlan = readPersistedUpgradePlan(workspaceRoot);
    if (persistedPlan.planRevision !== upgradePlan.planRevision) {
      throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade plan readback differs from publication');
    }
    const lock = await withProjectWriteAuthorization(
      {
        workspaceRoot,
        operation: 'change.upgrade',
        impactPaths: upgradePlan.impacts,
        beforeCommit: commitFence
      },
      () => applyPlannedWorkspaceUpgrade({
        ...plannedUpgrade,
        commitFence,
        plan,
        targetVersion,
        workspaceWriteLease,
        workspaceRoot
      })
    );
    const expectedTerminal = await buildUpgradeExecutionTerminal({
        workspaceRoot,
        plan: upgradePlan,
        attempt,
        resultLock: lock,
        settlement: 'applied'
      });
    let terminal: UpgradeExecutionTerminal;
    try {
      terminal = await publishUpgradeExecutionTerminal(workspaceRoot, expectedTerminal, commitFence);
      appliedTerminalCommitted = true;
    } catch (publicationFailure) {
      const resolution = resolveUpgradeExecutionTerminalPublication(workspaceRoot, expectedTerminal);
      if (resolution === 'committed') {
        appliedTerminalCommitted = true;
        appliedTerminalDurabilityUncertain = true;
        retainBackupForRecovery = true;
        terminal = expectedTerminal;
        postCommitFailures.push(publicationFailure);
      } else {
        appliedTerminalCommitUnknown = resolution === 'unknown'
          || classifyCanonicalWorkspacePublicationFailure(publicationFailure) !== 'before-effect';
        throw publicationFailure;
      }
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
    let settlement: UpgradeExecutionTerminal['settlement'] = 'rolled-back';
    let rollbackFailure: unknown = appliedTerminalCommitUnknown
      ? new CompilerError(
          'UPGRADE-BLOCKED-005',
          'Upgrade applied terminal publication could not be resolved as committed or absent'
        )
      : null;
    if (appliedTerminalCommitUnknown) {
      settlement = 'recovery-required';
      retainBackupForRecovery = true;
    }
    if (rollbackFailure === null) {
      try {
        await commitFence();
        await restoreWorkspace(backup, lockPath, commitFence);
      } catch (recoveryError) {
        settlement = 'recovery-required';
        rollbackFailure = recoveryError;
        retainBackupForRecovery = true;
      }
    }
    const failure = error instanceof CompilerError
      ? withRollbackDiagnostics(error)
      : new CompilerError(
          'UPGRADE-BLOCKED-005',
          `Upgrade apply failed: ${error instanceof Error ? error.message : String(error)}`,
          { rollbackStatus: settlement === 'rolled-back' ? 'restored' : 'recovery-required' },
          { cause: error }
        );
    const diagnosticFailure = rollbackFailure === null
      ? failure
      : new CompilerError(
          'UPGRADE-BLOCKED-005',
          `Upgrade recovery is required: ${rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure)}`,
          {
            rollbackStatus: 'recovery-required',
            originalErrorCode: failure.code,
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
            cause: new AggregateError(
              [error, rollbackFailure],
              'Upgrade apply and rollback failed',
              { cause: error }
            )
          }
        );
    let terminal: UpgradeExecutionTerminal | null = null;
    const publicationFailures: unknown[] = [];
    if (!appliedTerminalCommitUnknown) {
      try {
        terminal = await publishUpgradeExecutionTerminal(
          workspaceRoot,
          await buildUpgradeExecutionTerminal({
            workspaceRoot,
            plan: upgradePlan,
            attempt,
            resultLock: settlement === 'rolled-back' ? existingLock : null,
            settlement
          }),
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
