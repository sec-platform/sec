import type { ValidatedVerificationArtifactSet } from '../assurance/verification/artifact/contract/artifact.ts';
import type { VerificationReport } from '../assurance/verification/contract/types.ts';
import { productVerificationSubjectRevision } from '../assurance/verification/project/report.ts';
import type { LockFile } from '../compiler/contract.ts';
import { CompilerError } from '../compiler/errors.ts';
import { cloneAndDeepFreeze } from '../contracts/canonical.ts';
import type { RepairPlan } from '../semantics/repair/types.ts';
import { publishRepairPlanResult } from './repair-plan-publication.ts';

export type RepairWorkspaceRequest = Readonly<{ mode: 'preview' | 'publish' }>;

export interface RepairWorkspaceOperations {
  readLock(): LockFile;
  readVerification(): ValidatedVerificationArtifactSet | null;
  buildPlan(report: VerificationReport): RepairPlan;
  publish?(plan: RepairPlan, lock: LockFile, artifacts: ValidatedVerificationArtifactSet): void | PromiseLike<void>;
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
  const lock = structuredClone(readLock.call(operations));
  if (lock.passStatus.verify !== 'failed' && lock.passStatus.verify !== 'succeeded') {
    throw new CompilerError('REPAIR-BLOCKED-002', 'verify must complete before repair');
  }
  const artifacts = cloneAndDeepFreeze(readVerification.call(operations));
  if (artifacts === null) {
    throw new CompilerError('REPAIR-BLOCKED-002', 'Verification artifact set is missing');
  }
  const report = artifacts.verificationReport;
  const subjectRevision = productVerificationSubjectRevision(lock);
  if (report.summary.claimSummary.gates.some(gate =>
    gate.subjectRevision !== subjectRevision
  )) {
    throw new CompilerError('REPAIR-BLOCKED-002', 'Verification belongs to a different repair subject');
  }
  const expectedVerify = report.summary.status === 'failed' ? 'failed' : 'succeeded';
  if (lock.passStatus.verify !== expectedVerify ||
      (report.summary.status === 'passed' && report.summary.requestedLane !== 'all')) {
    throw new CompilerError('REPAIR-BLOCKED-002', 'Repair requires a matching terminal verification result');
  }
  const repairPlan = buildPlan.call(operations, report);
  if (request.mode === 'preview') return { lock, repairPlan };
  if (typeof publish !== 'function' || typeof recordFailure !== 'function') {
    throw new TypeError('Workspace repair publication operations must be callable');
  }
  return publishRepairPlanResult({ lock, repairPlan }, {
    publish: (plan, currentLock) => publish.call(operations, plan, currentLock, artifacts),
    recordFailure: currentLock => recordFailure.call(operations, currentLock)
  });
}
