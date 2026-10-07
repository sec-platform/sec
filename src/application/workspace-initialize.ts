import { LOCK_FILE_FORMAT_VERSION, type LockFile, type PlanFile } from '../compiler/contract.ts';
import { PASS_INITIAL_STATES } from '../compiler/contract/pass-status.ts';
import type { PreparedWorkspaceCreate, WorkspaceCreateTemplate } from './workspace-create.ts';

export interface WorkspaceInitializationOperations {
  publish(template: WorkspaceCreateTemplate, plan: PlanFile, lock: LockFile): void | PromiseLike<void>;
}

/** Select the initial controls once; the concrete publisher owns the complete
 * staged collection, durable intent, interruption recovery and readback. */
export async function initializePreparedWorkspace(
  prepared: PreparedWorkspaceCreate,
  operations: WorkspaceInitializationOperations
): Promise<void> {
  const { template, plan, initialGeneratedPaths } = prepared;
  const { publish } = operations;
  if (typeof publish !== 'function') throw new TypeError('Workspace publisher must be callable');
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
  await publish.call(operations, template, plan, initialLock);
}
