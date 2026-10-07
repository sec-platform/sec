import type { VerificationReport } from '../assurance/verification/contract/types.ts';
import type { LockFile } from '../compiler/contract.ts';
import { CodedFailure } from '../contracts/failure.ts';
import type { RepairPlan } from '../semantics/repair/types.ts';
import { publishRepairPlanResult } from './repair-plan-publication.ts';

export type RepairWorkspaceRequest = Readonly<{ mode: 'preview' | 'publish' }>;

export interface RepairWorkspaceOperations {
  readLock(): LockFile;
  readVerification(lock: LockFile): VerificationReport | null;
  buildPlan(report: VerificationReport): RepairPlan;
  publish?(plan: RepairPlan, lock: LockFile): void | PromiseLike<void>;
  recordFailure?(lock: LockFile): void | PromiseLike<void>;
}

export function prepareRepairWorkspaceRequest(options: Readonly<{ dryRun?: boolean }> = {}): RepairWorkspaceRequest {
  const dryRun = options.dryRun;
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    throw new TypeError('Repair dryRun option must be boolean');
  }
  return Object.freeze({ mode: dryRun ? 'preview' : 'publish' });
}

export interface RepairWorkspaceAdmissionOperations<T> {
  preview(): Promise<T>;
  publish(): Promise<T>;
}

/** Route Repair without granting write authority to preview requests. */
export function executeRepairWorkspaceAdmission<T>(
  request: RepairWorkspaceRequest,
  operations: RepairWorkspaceAdmissionOperations<T>
): Promise<T> {
  if (typeof operations.preview !== 'function' ||
      typeof operations.publish !== 'function') {
    throw new TypeError('Workspace repair admission operations must be callable');
  }
  return request.mode === 'preview'
    ? operations.preview.call(operations)
    : operations.publish.call(operations);
}

/** Coordinate repair planning and optional publication. Preview owns no write
 * effect; publication delegates physical persistence and settlement. */
export async function repairWorkspaceResult(
  request: RepairWorkspaceRequest,
  operations: RepairWorkspaceOperations
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  const { readLock, readVerification, buildPlan, publish, recordFailure } = operations;
  if ([readLock, readVerification, buildPlan]
      .some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace repair read/plan operations must be callable');
  }
  const lock = readLock.call(operations);
  // The concrete reader binds the canonical result to this exact Lock. A
  // pending/succeeded display flag neither supplies nor vetoes that result.
  const report = readVerification.call(operations, lock);
  if (report === null) {
    throw new CodedFailure('REPAIR-BLOCKED-002', 'verification-report.json is missing');
  }
  const repairPlan = buildPlan.call(operations, report);
  if (request.mode === 'preview') return { lock, repairPlan };
  if (typeof publish !== 'function' || typeof recordFailure !== 'function') {
    throw new TypeError('Workspace repair publication operations must be callable');
  }
  // Preserve the captured provider receiver when forwarding publication ports.
  return publishRepairPlanResult({ lock, repairPlan }, {
    publish: (plan, currentLock) => publish.call(operations, plan, currentLock),
    recordFailure: currentLock => recordFailure.call(operations, currentLock)
  });
}
