import { expect, test } from 'bun:test';

import {
  composeWorkspace,
  initWorkspace
} from '../../platform/orchestrator.ts';
import {
  assertIsolatedVerificationCapability,
  mintIsolatedVerificationCapability
} from '../../platform/orchestrator/isolated-verification-capability.ts';
import { readLockFile } from '../../platform/shared/lock-utils.ts';
import {
  commitPipelineTransaction,
  readPipelineJournal,
  recordPipelinePassStart,
  REFERENCE_PIPELINE_TRANSACTION_ID,
  startPipelineTransaction
} from '../../platform/shared/pipeline-journal.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const staleRevision = `sha256:${'0'.repeat(64)}`;

test('isolated Verification capability is opaque and bound to one exact workspace root', () => {
  const workspaceRoot = 'D:\\contract-workspaces\\isolated-a';
  const capability = mintIsolatedVerificationCapability(workspaceRoot);

  expect(() => assertIsolatedVerificationCapability(workspaceRoot, capability)).not.toThrow();
  expect(() => assertIsolatedVerificationCapability('D:\\contract-workspaces\\isolated-b', capability))
    .toThrow('exact workspace root');
  for (const forged of [
    {},
    { ...capability },
    { workspaceRoot }
  ]) {
    expect(() => assertIsolatedVerificationCapability(workspaceRoot, forged))
      .toThrow('exact workspace root');
  }
});

test('blocked stage is persisted as blocked instead of a pass execution failure', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });

    await expect(composeWorkspace(workspaceRoot)).rejects.toMatchObject({
      code: 'PIPELINE-BLOCKED-002'
    });

    const lock = await readLockFile(workspaceRoot);
    expect(lock.passStatus).toMatchObject({
      resolve: 'pending',
      compose: 'blocked',
      adapt: 'blocked',
      verify: 'blocked',
      repair: 'blocked',
      lock: 'blocked',
      emit: 'blocked'
    });

    const journal = await readPipelineJournal(workspaceRoot);
    const transaction = journal.transactions.at(-1);
    expect(transaction?.status).toBe('failed');
    expect(transaction?.passRecords).toEqual([
      expect.objectContaining({
        passId: 'build-ir',
        status: 'blocked',
        errorCode: 'PIPELINE-BLOCKED-002'
      })
    ]);
  }, 'engineering-compiler-pipeline-blocked-');
});

test('new transaction marks an abandoned running transaction as interrupted', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const commitFence = async (): Promise<void> => undefined;
    const firstTransactionId = await startPipelineTransaction(workspaceRoot, 'api', ['resolve'], commitFence);
    await recordPipelinePassStart(workspaceRoot, firstTransactionId, 'resolve', commitFence);

    const secondTransactionId = await startPipelineTransaction(workspaceRoot, 'ci', ['resolve'], commitFence);
    let journal = await readPipelineJournal(workspaceRoot);
    const interrupted = journal.transactions.find((entry) => entry.id === firstTransactionId);

    expect(interrupted).toMatchObject({
      status: 'failed',
      errorCode: 'PIPELINE-INTERRUPTED-001'
    });
    expect(interrupted?.passRecords[0]).toMatchObject({
      passId: 'resolve',
      status: 'failed',
      errorCode: 'PIPELINE-INTERRUPTED-001'
    });
    expect(journal.activeTransactionId).toBe(secondTransactionId);

    await commitPipelineTransaction(workspaceRoot, secondTransactionId, commitFence);
    journal = await readPipelineJournal(workspaceRoot);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(secondTransactionId);
  }, 'engineering-compiler-pipeline-interruption-');
});

test('reference transaction identity is stable and names the current journal execution', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const commitFence = async (): Promise<void> => undefined;
    const firstTransactionId = await startPipelineTransaction(workspaceRoot, 'reference', ['resolve'], commitFence);
    await commitPipelineTransaction(workspaceRoot, firstTransactionId, commitFence);

    const secondTransactionId = await startPipelineTransaction(workspaceRoot, 'reference', ['resolve'], commitFence);
    let journal = await readPipelineJournal(workspaceRoot);

    expect(firstTransactionId).toBe(REFERENCE_PIPELINE_TRANSACTION_ID);
    expect(secondTransactionId).toBe(firstTransactionId);
    expect(journal.activeTransactionId).toBe(secondTransactionId);
    expect(journal.lastCommittedTransactionId).toBeUndefined();
    expect(journal.transactions.filter((entry) => entry.id === secondTransactionId)).toEqual([
      expect.objectContaining({
        source: 'reference',
        requestedStages: ['resolve'],
        status: 'running'
      })
    ]);

    await commitPipelineTransaction(workspaceRoot, secondTransactionId, commitFence);
    journal = await readPipelineJournal(workspaceRoot);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(secondTransactionId);
    expect(journal.transactions.filter((entry) => entry.id === secondTransactionId)).toHaveLength(1);
    expect(journal.transactions.find((entry) => entry.id === secondTransactionId)?.status).toBe('succeeded');
  }, 'engineering-compiler-reference-transaction-');
});
