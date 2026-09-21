import type { LockFile, PlanFile } from '../contract.ts';
import {
  createUpgradeExecutionTerminal,
  upgradeArtifactDigest,
  type UpgradeExecutionTerminal,
  type UpgradePlan
} from '../../semantics/upgrade/upgrade-artifact.ts';
import { lockStateRevision } from './planning.ts';

export interface UpgradeExecutionTerminalObservation {
  readonly plan: UpgradePlan;
  readonly attempt: UpgradeExecutionTerminal['attempt'];
  readonly resultLock: LockFile | null;
  readonly settlement: UpgradeExecutionTerminal['settlement'];
  readonly persistedPlanRevision: UpgradePlan['planRevision'];
  readonly workspacePlan: PlanFile | null;
}

/** Compile one terminal strictly from already observed upgrade state. */
export function compileUpgradeExecutionTerminal(
  input: UpgradeExecutionTerminalObservation
): UpgradeExecutionTerminal {
  const workspaceBlockVersion = input.workspacePlan?.blocks
    .find((block) => block.id === input.plan.blockId)?.version ?? null;
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
        state: input.workspacePlan === null ? 'unresolved' : 'observed',
        plan: input.workspacePlan
      }),
      resultLockRevision: lockStateRevision(input.resultLock),
      planArtifactRevision: input.persistedPlanRevision
    },
    settlement: input.settlement,
    readback: {
      workspaceBlockVersion,
      resolvedBlockVersion
    }
  });
}
