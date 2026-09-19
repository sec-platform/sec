import type { LockFile, PlanFile } from '../compiler/contract.ts';
import { compileUpgradeExecutionTerminal } from '../compiler/upgrade/execution-terminal.ts';
import type {
  UpgradeExecutionTerminal,
  UpgradePlan
} from '../semantics/upgrade/upgrade-artifact.ts';

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
