import { expect, test } from 'bun:test';
import {
  completeWorkspaceCompilationTransaction,
  type WorkspaceCompilationTransactionOperations
} from '../../src/application/compile-workspace.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import type { PipelineStageId } from '../../src/compiler/pipeline/stages.ts';

// The fixture provides stage/lock handles only. It neither compiles a project
// nor claims a valid persisted Lock or physical completion proof.
const lock = Object.freeze({ marker: 'owned-lock' }) as unknown as LockFile;
class Provider implements WorkspaceCompilationTransactionOperations {
  #trace: string[] = [];
  #proofInput: unknown;
  onLease?: () => void;
  onLock?: () => Promise<void>;
  get trace() { return this.#trace; }
  get proofInput() { return this.#proofInput; }
  assertStageLease() { this.#trace.push('lease'); this.onLease?.(); }
  emitStageBoundary(stage: PipelineStageId) { this.#trace.push(`boundary:${stage}`); }
  async resolve(): Promise<never> { throw new Error('unselected resolve'); }
  async semantic(): Promise<never> { throw new Error('unselected semantic'); }
  async compose(): Promise<never> { throw new Error('unselected compose'); }
  async verify(): Promise<never> { throw new Error('unselected verify'); }
  async lock() { this.#trace.push('lock'); await this.onLock?.(); }
  async emit(): Promise<never> { throw new Error('unselected emit'); }
  readLock() { this.#trace.push('read-lock'); return lock; }
  buildCompletionProof(input: unknown) { this.#trace.push('proof'); this.#proofInput = input; return null; }
  revalidateStagedProof(actual: LockFile) { expect(actual).toBe(lock); this.#trace.push('revalidate'); }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('workspace compilation retains prototype stage methods and the original provider private state', async () => {
  const provider = new Provider();
  const result = await completeWorkspaceCompilationTransaction('tx:receiver', ['lock'], provider);
  expect(provider.trace).toEqual(['lease', 'boundary:lock', 'lock', 'read-lock', 'proof', 'revalidate']);
  expect(result.transactionId).toBe('tx:receiver');
  expect(result.completedStages).toEqual(['lock']);
  expect(result.lock).toBe(lock);
  expect(result.completionProof).toBeUndefined();
  expect(provider.proofInput).toEqual({ transactionId: 'tx:receiver', lock, completedStages: ['lock'] });
});

test('only selected stage methods are read once and remain bound across admission callbacks', async () => {
  const provider = new Provider();
  const original = provider.lock;
  let selectedReads = 0, unselectedReads = 0;
  Object.defineProperty(provider, 'lock', { configurable: true, get() { selectedReads++; return original; } });
  Object.defineProperty(provider, 'resolve', { get() { unselectedReads++; throw new Error('unselected getter'); } });
  provider.onLease = () => Object.defineProperty(provider, 'lock', {
    configurable: true, value: async () => { throw new Error('late replacement must not run'); }
  });
  const result = await completeWorkspaceCompilationTransaction('tx:capture', ['lock', 'lock'], provider);
  expect(selectedReads).toBe(1); expect(unselectedReads).toBe(0);
  expect(result.completedStages).toEqual(['lock', 'lock']);
  expect(provider.trace).toEqual(['lease', 'boundary:lock', 'lock', 'lease', 'boundary:lock', 'lock', 'read-lock', 'proof', 'revalidate']);
});

test('a stage failure retains its exact identity and stops completion reads and proof publication', async () => {
  const provider = new Provider();
  const failure = Object.freeze({ stage: 'lock-failed' });
  provider.onLock = async () => { throw failure; };
  await expect(completeWorkspaceCompilationTransaction('tx:failed', ['lock'], provider)).rejects.toBe(failure);
  expect(provider.trace).toEqual(['lease', 'boundary:lock', 'lock']);
  expect(provider.proofInput).toBeUndefined();
});

test('an invalid selected stage remains rejected before lease or journal effects', async () => {
  const provider = new Provider();
  Object.defineProperty(provider, 'lock', { value: 7 });
  await expect(completeWorkspaceCompilationTransaction('tx:invalid', ['lock'], provider))
    .rejects.toThrow('Pipeline lock operation must be callable');
  expect(provider.trace).toEqual([]);
});

test('completion waits for the original selected stage promise', async () => {
  const provider = new Provider();
  const entered = deferred(), held = deferred();
  provider.onLock = async () => { entered.resolve(); await held.promise; };
  const run = completeWorkspaceCompilationTransaction('tx:held', ['lock'], provider);
  try {
    await entered.promise;
    expect(provider.trace).toEqual(['lease', 'boundary:lock', 'lock']);
    expect(provider.proofInput).toBeUndefined();
  } finally { held.resolve(); }
  expect((await run).lock).toBe(lock);
  expect(provider.trace).toEqual(['lease', 'boundary:lock', 'lock', 'read-lock', 'proof', 'revalidate']);
});

test('an empty stage selection does not read stage ports but preserves the existing completion sequence', async () => {
  const provider = new Provider();
  Object.defineProperty(provider, 'lock', { get() { throw new Error('unselected getter'); } });
  const result = await completeWorkspaceCompilationTransaction('tx:empty', [], provider);
  expect(result.completedStages).toEqual([]);
  expect(provider.trace).toEqual(['read-lock', 'proof', 'revalidate']);
});
