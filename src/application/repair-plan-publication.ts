import type { LockFile } from '../compiler/contract.ts';
import { CompilerError } from '../compiler/errors.ts';
import type { RepairPlan } from '../semantics/repair/types.ts';

export interface RepairPlanPublicationOperations {
  publish(plan: RepairPlan, lock: LockFile): void | PromiseLike<void>;
  recordFailure(lock: LockFile): void | PromiseLike<void>;
}

/** Record the current repair decision, not an invented source repair. The
 * caller retains the physical lease and each publisher's commit fence. */
export async function publishRepairPlanResult(
  input: Readonly<{ lock: LockFile; repairPlan: RepairPlan }>,
  operations: RepairPlanPublicationOperations
) {
  const { lock, repairPlan } = input;
  const { publish, recordFailure } = operations;
  if (typeof publish !== 'function' || typeof recordFailure !== 'function') {
    throw new TypeError('Repair plan publishers must be callable');
  }
  const blocked = repairPlan.status === 'blocked' ? new CompilerError(
    'REPAIR-BLOCKED-001',
    repairPlan.blockers?.[0]?.reason ?? 'Repair is blocked for current verification failure',
    { blockers: repairPlan.blockers ?? [] }
  ) : undefined;
  lock.passStatus.repair = blocked ? 'failed' : 'skipped';
  try {
    await publish.call(operations, repairPlan, lock);
  } catch (primary) {
    lock.passStatus.repair = 'failed';
    try {
      await recordFailure.call(operations, lock);
    } catch (secondary) {
      // A rejected write may already have effects. Preserve both failures;
      // this neither declares rollback nor grants an unfenced retry.
      throw new AggregateError([primary, secondary],
        'Repair plan publication and failure-state persistence both failed', { cause: primary });
    }
    throw primary;
  }
  // An already-published blocked decision is not a publication failure and
  // must not cause a second, redundant write of the same failed lock state.
  if (blocked) throw blocked;
  return { lock, repairPlan };
}
