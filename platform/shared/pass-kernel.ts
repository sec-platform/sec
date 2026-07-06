import { PASS_SEQUENCE } from './constants.ts';
import type { LockFile, PassExecutionState, PassState, PassStatus } from './lock-types.ts';
import { saveLock } from './lock-utils.ts';

export type PassId = keyof PassStatus;

export interface PassFailureDiagnostic {
  code: string;
  message: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function transactionId(pass: PassId): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `pass:${pass}:${Date.now().toString(36)}:${random}`;
}

function passIndex(pass: PassId): number {
  const index = (PASS_SEQUENCE as readonly string[]).indexOf(pass);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function downstreamPasses(pass: PassId): PassId[] {
  const index = passIndex(pass);
  return PASS_SEQUENCE.slice(index + 1) as PassId[];
}

function ensureLedger(lock: LockFile): NonNullable<LockFile['passExecutions']> {
  lock.passExecutions ??= {};
  return lock.passExecutions;
}

function diagnosticId(pass: PassId, diagnostic: PassFailureDiagnostic): string {
  return `${pass}:${diagnostic.code}:${diagnostic.message}`;
}

function retainedMetadata(current: PassExecutionState | undefined): Partial<PassExecutionState> {
  return {
    ...(current?.startedAt ? { startedAt: current.startedAt } : {}),
    ...(current?.inputRevision ? { inputRevision: current.inputRevision } : {}),
    ...(current?.outputRevision ? { outputRevision: current.outputRevision } : {})
  };
}

export function invalidateDownstreamPasses(lock: LockFile, pass: PassId): void {
  const ledger = ensureLedger(lock);
  for (const downstream of downstreamPasses(pass)) {
    lock.passStatus[downstream] = downstream === 'repair' ? 'skipped' : 'pending';
    ledger[downstream] = {
      status: lock.passStatus[downstream],
      diagnosticIds: []
    };
  }
}

export function beginPass(lock: LockFile, pass: PassId): PassExecutionState {
  invalidateDownstreamPasses(lock, pass);
  const startedAt = nowIso();
  const state: PassExecutionState = {
    status: 'running',
    transactionId: transactionId(pass),
    startedAt,
    diagnosticIds: []
  };
  lock.passStatus[pass] = 'running';
  ensureLedger(lock)[pass] = state;
  return state;
}

export function completePass(
  lock: LockFile,
  pass: PassId,
  options: { outputRevision?: string } = {}
): PassExecutionState {
  const current = ensureLedger(lock)[pass];
  const state: PassExecutionState = {
    status: 'succeeded',
    transactionId: current?.transactionId ?? transactionId(pass),
    ...retainedMetadata(current),
    completedAt: nowIso(),
    diagnosticIds: [],
    ...(options.outputRevision ? { outputRevision: options.outputRevision } : {})
  };
  lock.passStatus[pass] = 'succeeded';
  ensureLedger(lock)[pass] = state;
  return state;
}

export function failPass(
  lock: LockFile,
  pass: PassId,
  diagnostic: PassFailureDiagnostic
): PassExecutionState {
  const current = ensureLedger(lock)[pass];
  const state: PassExecutionState = {
    status: 'failed',
    transactionId: current?.transactionId ?? transactionId(pass),
    ...retainedMetadata(current),
    completedAt: nowIso(),
    diagnosticIds: [diagnosticId(pass, diagnostic)]
  };
  lock.passStatus[pass] = 'failed';
  ensureLedger(lock)[pass] = state;
  return state;
}

export async function runPassWithLock<T>(
  workspaceRoot: string,
  lock: LockFile,
  pass: PassId,
  run: () => Promise<T>
): Promise<T> {
  beginPass(lock, pass);
  await saveLock(workspaceRoot, lock);
  try {
    const result = await run();
    completePass(lock, pass);
    await saveLock(workspaceRoot, lock);
    return result;
  } catch (error) {
    failPass(lock, pass, {
      code: error instanceof Error && 'code' in error ? String((error as { code?: string }).code ?? 'UNEXPECTED') : 'UNEXPECTED',
      message: error instanceof Error ? error.message : String(error)
    });
    await saveLock(workspaceRoot, lock);
    throw error;
  }
}

export function passState(lock: LockFile, pass: PassId): PassState {
  return lock.passExecutions?.[pass]?.status ?? lock.passStatus[pass];
}
