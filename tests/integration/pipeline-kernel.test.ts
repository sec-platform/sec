import { expect, test } from 'bun:test';

import {
  compileWorkspace,
  composeWorkspace,
  initWorkspace
} from '../../platform/orchestrator.ts';
import { readLockFile } from '../../platform/shared/lock-utils.ts';
import {
  commitPipelineTransaction,
  readPipelineJournal,
  recordPipelinePassStart,
  startPipelineTransaction
} from '../../platform/shared/pipeline-journal.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('compile coordinator runs resolve and compose in one committed transaction', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });

    const result = await compileWorkspace(workspaceRoot, {
      source: 'ci',
      through: 'compose'
    });

    expect(result.completedStages).toEqual(['resolve', 'semantic', 'compose']);
    expect(result.semanticContext).toMatchObject({
      transactionId: result.transactionId,
      inputRevision: result.semanticContext?.snapshot.ir.inputRevision,
      semanticRevision: result.semanticContext?.snapshot.ir.semanticRevision
    });
    expect(result.lock.passStatus).toMatchObject({
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      'build-ir': 'succeeded',
      compose: 'succeeded',
      adapt: 'pending',
      verify: 'pending',
      repair: 'skipped',
      lock: 'pending',
      emit: 'pending'
    });

    const journal = await readPipelineJournal(workspaceRoot);
    const transaction = journal.transactions.find((entry) => entry.id === result.transactionId);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(result.transactionId);
    expect(transaction).toMatchObject({
      source: 'ci',
      requestedStages: ['resolve', 'semantic', 'compose'],
      status: 'succeeded'
    });
    expect(transaction?.passRecords.map((entry) => [entry.passId, entry.status])).toEqual([
      ['resolve', 'succeeded'],
      ['build-ir', 'succeeded'],
      ['compose', 'succeeded']
    ]);
  }, 'engineering-compiler-pipeline-coordinator-');
}, 120000);

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
        passId: 'compose',
        status: 'blocked',
        errorCode: 'PIPELINE-BLOCKED-002'
      })
    ]);
  }, 'engineering-compiler-pipeline-blocked-');
});

test('new transaction marks an abandoned running transaction as interrupted', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const firstTransactionId = await startPipelineTransaction(workspaceRoot, 'api', ['resolve']);
    await recordPipelinePassStart(workspaceRoot, firstTransactionId, 'resolve');

    const secondTransactionId = await startPipelineTransaction(workspaceRoot, 'ci', ['resolve']);
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

    await commitPipelineTransaction(workspaceRoot, secondTransactionId);
    journal = await readPipelineJournal(workspaceRoot);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(secondTransactionId);
  }, 'engineering-compiler-pipeline-interruption-');
});
