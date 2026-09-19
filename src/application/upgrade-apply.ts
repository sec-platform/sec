import type { LockFile, PlanFile } from '../compiler/contract.ts';
import { CompilerError } from '../compiler/errors.ts';
import {
  upgradeFailureWithSecondaryFailures,
  withRollbackDiagnostics
} from '../compiler/upgrade/failure.ts';
import { compileUpgradeExecutionTerminal } from '../compiler/upgrade/execution-terminal.ts';
import {
  createUpgradeExecutionAttempt,
  createUpgradePlan,
  requireUpgradeDigest,
  type UpgradeExecutionTerminal,
  type UpgradePlan
} from '../semantics/upgrade/upgrade-artifact.ts';
import type { PlannedWorkspaceUpgrade } from './upgrade-planning.ts';

export interface PlannedUpgradeApplyInput {
  readonly currentBlock: PlanFile['blocks'][number];
  readonly plan: PlanFile;
  readonly targetVersion: string;
}

export interface PlannedUpgradeApplyOperations {
  publishWorkspacePlan(plan: PlanFile): Promise<void>;
  applyMigrations(): Promise<void>;
  compileLock(): Promise<LockFile>;
}

/**
 * Apply one already-planned Upgrade. This use case owns ordering and the plan
 * state transition; physical publication/migration/compiler providers are
 * supplied by bootstrap.
 */
export async function executePlannedWorkspaceUpgrade(
  input: PlannedUpgradeApplyInput,
  operations: PlannedUpgradeApplyOperations
): Promise<LockFile> {
  input.currentBlock.version = input.targetVersion;
  await operations.publishWorkspacePlan(input.plan);
  await operations.applyMigrations();
  return operations.compileLock();
}


export interface UpgradeExecutionTerminalReadbackOperations {
  readPersistedPlan(): UpgradePlan;
  readWorkspacePlan(): Promise<PlanFile>;
}

export async function buildUpgradeExecutionTerminal(
  input: Readonly<{
    plan: UpgradePlan;
    attempt: UpgradeExecutionTerminal['attempt'];
    resultLock: LockFile | null;
    settlement: UpgradeExecutionTerminal['settlement'];
  }>,
  operations: UpgradeExecutionTerminalReadbackOperations
): Promise<UpgradeExecutionTerminal> {
  if (typeof operations.readPersistedPlan !== 'function' ||
      typeof operations.readWorkspacePlan !== 'function') {
    throw new TypeError('Upgrade terminal readback operations must be callable');
  }
  const persistedPlan = operations.readPersistedPlan.call(operations);
  let workspacePlan: PlanFile | null = null;
  try {
    workspacePlan = await operations.readWorkspacePlan.call(operations);
  } catch (error) {
    if (input.settlement !== 'recovery-required') throw error;
  }
  return compileUpgradeExecutionTerminal({
    plan: input.plan,
    attempt: input.attempt,
    resultLock: input.resultLock,
    settlement: input.settlement,
    persistedPlanRevision: persistedPlan.planRevision,
    workspacePlan
  });
}


export type AppliedUpgradeTerminalPublicationOutcome =
  | Readonly<{
      status: 'committed';
      durability: 'settled';
      terminal: UpgradeExecutionTerminal;
    }>
  | Readonly<{
      status: 'committed';
      durability: 'uncertain';
      terminal: UpgradeExecutionTerminal;
      publicationFailure: unknown;
    }>
  | Readonly<{
      status: 'not-committed';
      commitUnknown: boolean;
      publicationFailure: unknown;
    }>;

export interface AppliedUpgradeTerminalPublicationOperations {
  publish(terminal: UpgradeExecutionTerminal): Promise<UpgradeExecutionTerminal>;
  resolvePublication(
    expected: UpgradeExecutionTerminal
  ): 'committed' | 'absent' | 'unknown';
  isBeforeEffectFailure(error: unknown): boolean;
}

/**
 * Resolve publication of an applied Upgrade terminal without guessing whether
 * a failed physical write took effect. A matching readback is committed but
 * durability-uncertain; absent + proven-before-effect is safely not committed;
 * every other failure retains an unknown-commit recovery obligation.
 */
export async function publishAppliedUpgradeTerminal(
  expected: UpgradeExecutionTerminal,
  operations: AppliedUpgradeTerminalPublicationOperations
): Promise<AppliedUpgradeTerminalPublicationOutcome> {
  if (typeof operations.publish !== 'function' ||
      typeof operations.resolvePublication !== 'function' ||
      typeof operations.isBeforeEffectFailure !== 'function') {
    throw new TypeError('Applied Upgrade terminal publication operations must be callable');
  }
  try {
    return Object.freeze({
      status: 'committed' as const,
      durability: 'settled' as const,
      terminal: await operations.publish.call(operations, expected)
    });
  } catch (publicationFailure) {
    const resolution = operations.resolvePublication.call(operations, expected);
    if (resolution === 'committed') {
      return Object.freeze({
        status: 'committed' as const,
        durability: 'uncertain' as const,
        terminal: expected,
        publicationFailure
      });
    }
    return Object.freeze({
      status: 'not-committed' as const,
      commitUnknown:
        resolution === 'unknown' ||
        !operations.isBeforeEffectFailure.call(operations, publicationFailure),
      publicationFailure
    });
  }
}


export type UpgradeRecoverySnapshotLocator = Readonly<{
  path: string;
  device: string;
  inode: string;
  parentPath: string;
  parentDevice: string;
  parentInode: string;
  status: 'retained-locator-only';
}>;

export type UpgradeRollbackResolution = Readonly<{
  settlement: UpgradeExecutionTerminal['settlement'];
  retainBackupForRecovery: boolean;
  diagnosticFailure: CompilerError;
}>;

export interface UpgradeRollbackOperations {
  restore(): Promise<void>;
}

/**
 * Resolve an Upgrade apply failure before any failure-terminal publication.
 * Physical snapshot restoration is injected; application owns whether restore
 * is admissible, when the outcome becomes recovery-required, and the canonical
 * diagnostic that carries the retained recovery locator.
 */
export async function resolveUpgradeRollback(
  input: Readonly<{
    applyFailure: unknown;
    appliedTerminalCommitUnknown: boolean;
    recoverySnapshot: UpgradeRecoverySnapshotLocator;
  }>,
  operations: UpgradeRollbackOperations
): Promise<UpgradeRollbackResolution> {
  if (typeof operations.restore !== 'function') {
    throw new TypeError('Upgrade rollback operation must be callable');
  }

  let settlement: UpgradeExecutionTerminal['settlement'] = 'rolled-back';
  let rollbackFailure: unknown = input.appliedTerminalCommitUnknown
    ? new CompilerError(
        'UPGRADE-BLOCKED-005',
        'Upgrade applied terminal publication could not be resolved as committed or absent'
      )
    : null;
  let retainBackupForRecovery = input.appliedTerminalCommitUnknown;

  if (rollbackFailure === null) {
    try {
      await operations.restore.call(operations);
    } catch (recoveryError) {
      settlement = 'recovery-required';
      rollbackFailure = recoveryError;
      retainBackupForRecovery = true;
    }
  } else {
    settlement = 'recovery-required';
  }

  const failure = input.applyFailure instanceof CompilerError
    ? withRollbackDiagnostics(input.applyFailure)
    : new CompilerError(
        'UPGRADE-BLOCKED-005',
        `Upgrade apply failed: ${
          input.applyFailure instanceof Error
            ? input.applyFailure.message
            : String(input.applyFailure)
        }`,
        {
          rollbackStatus:
            settlement === 'rolled-back' ? 'restored' : 'recovery-required'
        },
        { cause: input.applyFailure }
      );

  const diagnosticFailure = rollbackFailure === null
    ? failure
    : new CompilerError(
        'UPGRADE-BLOCKED-005',
        `Upgrade recovery is required: ${
          rollbackFailure instanceof Error
            ? rollbackFailure.message
            : String(rollbackFailure)
        }`,
        {
          rollbackStatus: 'recovery-required',
          originalErrorCode: failure.code,
          recoverySnapshot: input.recoverySnapshot
        },
        {
          cause: new AggregateError(
            [input.applyFailure, rollbackFailure],
            'Upgrade apply and rollback failed',
            { cause: input.applyFailure }
          )
        }
      );

  return Object.freeze({
    settlement,
    retainBackupForRecovery,
    diagnosticFailure
  });
}


/**
 * Once an applied terminal is externally committed, later failures are
 * post-commit failures and rollback is no longer admissible. If publication
 * durability is uncertain, retain the recovery locator in the primary error.
 */
export function buildUpgradeCommittedFailure(input: Readonly<{
  failure: unknown;
  durabilityUncertain: boolean;
  recoverySnapshot: UpgradeRecoverySnapshotLocator;
  postCommitFailures: readonly unknown[];
}>): Error {
  const primary = input.failure instanceof Error
    ? input.failure
    : new Error(String(input.failure));
  const postCommitFailure = input.durabilityUncertain
    ? new CompilerError(
        'UPGRADE-BLOCKED-005',
        `Upgrade applied terminal is externally visible but its durability did not settle: ${primary.message}`,
        {
          rollbackStatus: 'recovery-required',
          recoverySnapshot: input.recoverySnapshot
        },
        { cause: primary }
      )
    : primary;
  return upgradeFailureWithSecondaryFailures(
    postCommitFailure,
    input.postCommitFailures.filter(failure => failure !== input.failure),
    'Upgrade applied terminal committed but post-commit work failed'
  );
}


export type UpgradeExecutionLeaseIdentity = Readonly<{
  workspaceIdentityDigest: string;
  leaseGeneration: number;
  leaseId: string;
  ownerFileIdentityDigest: string;
}>;

export function bindPlannedUpgradeExecution(
  planned: PlannedWorkspaceUpgrade,
  lease: UpgradeExecutionLeaseIdentity
): Readonly<{
  upgradePlan: UpgradePlan;
  attempt: UpgradeExecutionTerminal['attempt'];
}> {
  const { artifactKind: ignoredArtifactKind, ...previewMaterial } =
    planned.upgradePreview;
  const upgradePlan = createUpgradePlan({
    workspaceIdentityDigest: requireUpgradeDigest(
      lease.workspaceIdentityDigest,
      'Workspace write lease identity'
    ),
    ...previewMaterial
  });
  const attempt = createUpgradeExecutionAttempt({
    leaseGeneration: lease.leaseGeneration,
    leaseId: lease.leaseId,
    ownerFileIdentityDigest: lease.ownerFileIdentityDigest
  });
  return Object.freeze({ upgradePlan, attempt });
}
