import { expect, test } from 'bun:test';
import {
  completeWorkspaceCompilationTransaction,
  type WorkspaceCompilationTransactionOperations
} from '../../../src/application/compile-workspace.ts';
import type { LockFile, PlanFile } from '../../../src/compiler/contract.ts';
import type { PipelineSemanticContext } from '../../../src/compiler/pipeline/semantic-context.ts';
import type { PipelineStageId } from '../../../src/compiler/pipeline/stages.ts';

// The fixture provides stage/lock handles only. It neither compiles a project
// nor claims a valid persisted Lock or physical completion proof.
const lock = Object.freeze({ marker: 'owned-lock' }) as unknown as LockFile;
const resolvedPlan = { schemaVersion: '1', app: { id: 'x', name: 'resolved' }, blocks: [], targets: [], acceptance: [] } as unknown as PlanFile;
const composedPlan = { schemaVersion: '1', app: { id: 'x', name: 'composed' }, blocks: [], targets: [], acceptance: [] } as unknown as PlanFile;
const semantic = Object.freeze({ inputRevision: 'sha256:a', semanticRevision: 'sha256:b' }) as PipelineSemanticContext;

class Provider implements WorkspaceCompilationTransactionOperations {
  #trace: string[] = [];
  #proofInput: unknown;
  onLock?: () => Promise<void>;
  get trace() { return this.#trace; }
  get proofInput() { return this.#proofInput; }
  assertStageLease() { this.#trace.push('lease'); }
  emitStageBoundary(stage: PipelineStageId) { this.#trace.push(`boundary:${stage}`); }
  async resolve() { this.#trace.push('resolve'); return { plan: resolvedPlan }; }
  async semantic() { this.#trace.push('semantic'); return semantic; }
  async compose() { this.#trace.push('compose'); return { plan: composedPlan }; }
  async verify(): Promise<never> { throw new Error('unselected verify'); }
  async lock() { this.#trace.push('lock'); await this.onLock?.(); }
  async emit(): Promise<never> { throw new Error('unselected emit'); }
  readLock() { this.#trace.push('read-lock'); return lock; }
  buildCompletionProof(input: unknown) { this.#trace.push('proof'); this.#proofInput = input; return null; }
  revalidateStagedProof(actual: LockFile) { expect(actual).toEqual(lock); this.#trace.push('revalidate'); }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('workspace compilation projects admitted stage results only after successful completion', async () => {
  const provider = new Provider();
  const stages = ['resolve', 'semantic', 'compose', 'lock'] as const;
  const result = await completeWorkspaceCompilationTransaction('tx:completed', stages, provider);
  expect(provider.trace).toEqual([
    'lease', 'boundary:resolve', 'resolve',
    'lease', 'boundary:semantic', 'semantic',
    'lease', 'boundary:compose', 'compose',
    'lease', 'boundary:lock', 'lock', 'read-lock', 'proof', 'revalidate'
  ]);
  expect(result.transactionId).toBe('tx:completed');
  expect(result.completedStages).toEqual(['resolve', 'semantic', 'compose', 'lock']);
  expect(Object.isFrozen(result.completedStages)).toBe(true);
  expect(result.semanticContext).toEqual({ inputRevision: 'sha256:a', semanticRevision: 'sha256:b' });
  expect(result.plan).toEqual({ schemaVersion: '1', app: { id: 'x', name: 'composed' }, blocks: [], targets: [], acceptance: [] });
  expect(result.lock).toEqual(lock);
  expect(result.completionProof).toBeUndefined();
  expect(provider.proofInput).toEqual({ transactionId: 'tx:completed', lock,
    completedStages: ['resolve', 'semantic', 'compose', 'lock'], semanticContext: semantic, plan: composedPlan });
});

test('a stage failure retains its exact identity and stops completion reads and proof publication', async () => {
  const provider = new Provider();
  const failure = Object.freeze({ stage: 'lock-failed' });
  provider.onLock = async () => { throw failure; };
  await expect(completeWorkspaceCompilationTransaction('tx:failed', ['resolve', 'semantic', 'lock', 'emit'], provider)).rejects.toBe(failure);
  expect(provider.trace).toEqual(['lease', 'boundary:resolve', 'resolve',
    'lease', 'boundary:semantic', 'semantic', 'lease', 'boundary:lock', 'lock']);
  expect(provider.proofInput).toBeUndefined();
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
  expect((await run).lock).toEqual(lock);
  expect(provider.trace).toEqual(['lease', 'boundary:lock', 'lock', 'read-lock', 'proof', 'revalidate']);
});
