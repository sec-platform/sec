import { LOCK_FILE_FORMAT_VERSION, type LockFile, type PlanFile } from '../compiler/contract.ts';
import { PASS_INITIAL_STATES } from '../compiler/contract/pass-status.ts';
import type { PreparedWorkspaceCreate, WorkspaceCreateTemplate } from './workspace-create.ts';

export interface WorkspaceInitializationOperations {
  assertEmpty(): void | PromiseLike<void>;
  materialize(template: WorkspaceCreateTemplate): void | PromiseLike<void>;
  writePlan(plan: PlanFile): void | PromiseLike<void>;
  writeLock(lock: LockFile): void | PromiseLike<void>;
  writePendingVerification(): void | PromiseLike<void>;
}

/** Initialize the already-selected author plan under the caller's write lease.
 * Effects remain serial and fenced by their implementations. Rejection stops
 * subsequent writes; partial creation is not advertised as rolled back. */
export async function initializePreparedWorkspace(
  prepared: PreparedWorkspaceCreate,
  operations: WorkspaceInitializationOperations
): Promise<void> {
  const { template, plan, initialGeneratedPaths } = prepared;
  const { assertEmpty, materialize, writePlan, writeLock, writePendingVerification } = operations;
  if ([assertEmpty, materialize, writePlan, writeLock, writePendingVerification]
      .some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace initialization operations must be callable');
  }
  await assertEmpty.call(operations);
  await materialize.call(operations, template);
  await writePlan.call(operations, plan);
  const initialLock: LockFile = {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    app: { id: plan.app.id, name: plan.app.name, stack: plan.app.stack, mode: plan.app.mode },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    generatedPaths: [...initialGeneratedPaths],
    acceptancePlan: plan.acceptance.map(entry => entry.id),
    passStatus: { ...PASS_INITIAL_STATES }
  };
  await writeLock.call(operations, initialLock);
  await writePendingVerification.call(operations);
}
