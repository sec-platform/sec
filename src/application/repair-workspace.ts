import type { VerificationReport } from '../assurance/verification/contract/types.ts';
import { assertPassStatus } from '../compiler/contract/lock-schema.ts';
import type { LockFile } from '../compiler/contract.ts';
import { CompilerError } from '../compiler/errors.ts';
import type { RepairPlan } from '../semantics/repair/types.ts';
import { publishRepairPlanResult } from './repair-plan-publication.ts';

export type RepairWorkspaceRequest = Readonly<{ mode: 'preview' | 'publish' }>;

export interface RepairWorkspaceOperations {
  readLock(): LockFile;
  readVerification(): VerificationReport | null;
  buildPlan(report: VerificationReport): RepairPlan;
  publish(plan: RepairPlan, lock: LockFile): void | PromiseLike<void>;
  recordFailure(lock: LockFile): void | PromiseLike<void>;
}

export function prepareRepairWorkspaceRequest(options: Readonly<{ dryRun?: boolean }> = {}): RepairWorkspaceRequest {
  const dryRun = options.dryRun;
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    throw new TypeError('Repair dryRun option must be boolean');
  }
  return Object.freeze({ mode: dryRun ? 'preview' : 'publish' });
}

/** Coordinate repair planning and optional publication. Preview owns no write
 * effect; publication delegates physical persistence and settlement. */
export async function repairWorkspaceResult(
  request: RepairWorkspaceRequest,
  operations: RepairWorkspaceOperations
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  const { readLock, readVerification, buildPlan, publish, recordFailure } = operations;
  if ([readLock, readVerification, buildPlan, publish, recordFailure]
      .some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace repair operations must be callable');
  }
  const lock = readLock.call(operations);
  assertPassStatus(
    lock,
    'verify',
    'pending',
    new CompilerError('REPAIR-BLOCKED-002', 'verify must run before repair'),
    'differs'
  );
  const report = readVerification.call(operations);
  if (report === null) {
    throw new CompilerError('REPAIR-BLOCKED-002', 'verification-report.json is missing');
  }
  const repairPlan = buildPlan.call(operations, report);
  if (request.mode === 'preview') return { lock, repairPlan };
  return publishRepairPlanResult({ lock, repairPlan }, { publish, recordFailure });
}
