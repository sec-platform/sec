import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { readOptionalJson, writeJson } from './fs.ts';
import { getWorkspacePaths } from './paths.ts';
import {
  PIPELINE_JOURNAL_FORMAT_VERSION,
  type PassId,
  type PipelineEvent,
  type PipelineEventHandler,
  type PipelineJournal,
  type PipelinePassRecord,
  type PipelineSource,
  type PipelineStageId,
  type PipelineTransactionRecord
} from './pipeline-types.ts';

const MAX_RETAINED_TRANSACTIONS = 50;
const PIPELINE_JOURNAL_FILE = 'pipeline-journal.json';
let journalMutationQueue: Promise<void> = Promise.resolve();

function pipelineJournalPath(workspaceRoot: string): string {
  return path.join(getWorkspacePaths(workspaceRoot).localStateRoot, PIPELINE_JOURNAL_FILE);
}

function emptyJournal(): PipelineJournal {
  return {
    formatVersion: PIPELINE_JOURNAL_FORMAT_VERSION,
    transactions: []
  };
}

async function emitEvent(handler: PipelineEventHandler | undefined, event: PipelineEvent): Promise<void> {
  if (!handler) return;
  try {
    await handler(event);
  } catch {
    // Pipeline observers are intentionally non-authoritative and cannot fail compilation.
  }
}

async function readJournal(workspaceRoot: string): Promise<PipelineJournal> {
  const journal = await readOptionalJson<PipelineJournal>(pipelineJournalPath(workspaceRoot));
  if (!journal || journal.formatVersion !== PIPELINE_JOURNAL_FORMAT_VERSION) {
    return emptyJournal();
  }
  return journal;
}

async function mutateJournal(
  workspaceRoot: string,
  mutate: (journal: PipelineJournal) => void | Promise<void>
): Promise<void> {
  const run = async (): Promise<void> => {
    const journal = await readJournal(workspaceRoot);
    await mutate(journal);
    journal.transactions = journal.transactions.slice(-MAX_RETAINED_TRANSACTIONS);
    await writeJson(pipelineJournalPath(workspaceRoot), journal);
  };
  const current = journalMutationQueue.then(run, run);
  journalMutationQueue = current.catch(() => undefined);
  await current;
}

function findTransaction(journal: PipelineJournal, transactionId: string): PipelineTransactionRecord {
  const transaction = journal.transactions.find((entry) => entry.id === transactionId);
  if (!transaction) {
    throw new Error(`Pipeline transaction "${transactionId}" is missing from the local journal`);
  }
  return transaction;
}

function findRunningPass(transaction: PipelineTransactionRecord, passId: PassId): PipelinePassRecord {
  const record = [...transaction.passRecords]
    .reverse()
    .find((entry) => entry.passId === passId && entry.status === 'running');
  if (!record) {
    throw new Error(`Pipeline pass "${passId}" has no running record in transaction "${transaction.id}"`);
  }
  return record;
}

function interruptActiveTransaction(journal: PipelineJournal, completedAt: string): void {
  if (!journal.activeTransactionId) return;
  const active = journal.transactions.find((entry) => entry.id === journal.activeTransactionId);
  if (!active || active.status !== 'running') {
    delete journal.activeTransactionId;
    return;
  }

  active.status = 'failed';
  active.completedAt = completedAt;
  active.errorCode = 'PIPELINE-INTERRUPTED-001';
  active.message = 'Previous pipeline transaction did not complete before a new transaction started';
  for (const pass of active.passRecords) {
    if (pass.status !== 'running') continue;
    pass.status = 'failed';
    pass.completedAt = completedAt;
    pass.errorCode = 'PIPELINE-INTERRUPTED-001';
    pass.message = 'Pass execution was interrupted before completion';
  }
  delete journal.activeTransactionId;
}

export async function startPipelineTransaction(
  workspaceRoot: string,
  source: PipelineSource,
  requestedStages: readonly PipelineStageId[],
  onEvent?: PipelineEventHandler
): Promise<string> {
  const transactionId = `tx:${randomUUID()}`;
  const startedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    interruptActiveTransaction(journal, startedAt);
    journal.transactions.push({
      id: transactionId,
      source,
      requestedStages: [...requestedStages],
      status: 'running',
      startedAt,
      passRecords: []
    });
    journal.activeTransactionId = transactionId;
  });
  await emitEvent(onEvent, {
    type: 'transaction-start',
    transactionId,
    message: `Pipeline transaction ${transactionId} started`
  });
  return transactionId;
}

export async function recordPipelinePassStart(
  workspaceRoot: string,
  transactionId: string,
  passId: PassId,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const startedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const transaction = findTransaction(journal, transactionId);
    transaction.passRecords.push({
      passId,
      status: 'running',
      startedAt
    });
  });
  await emitEvent(onEvent, {
    type: 'pass-start',
    transactionId,
    passId,
    message: `Pass ${passId} started`
  });
}

export async function recordPipelinePassBlocked(
  workspaceRoot: string,
  transactionId: string,
  passId: PassId,
  errorCode: string,
  message: string,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const timestamp = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const transaction = findTransaction(journal, transactionId);
    transaction.passRecords.push({
      passId,
      status: 'blocked',
      startedAt: timestamp,
      completedAt: timestamp,
      errorCode,
      message
    });
  });
  await emitEvent(onEvent, {
    type: 'pass-blocked',
    transactionId,
    passId,
    message: `Pass ${passId} blocked: ${message}`
  });
}

export async function recordPipelinePassSuccess(
  workspaceRoot: string,
  transactionId: string,
  passId: PassId,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const completedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const record = findRunningPass(findTransaction(journal, transactionId), passId);
    record.status = 'succeeded';
    record.completedAt = completedAt;
  });
  await emitEvent(onEvent, {
    type: 'pass-success',
    transactionId,
    passId,
    message: `Pass ${passId} succeeded`
  });
}

export async function recordPipelinePassFailure(
  workspaceRoot: string,
  transactionId: string,
  passId: PassId,
  errorCode: string,
  message: string,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const completedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const record = findRunningPass(findTransaction(journal, transactionId), passId);
    record.status = 'failed';
    record.completedAt = completedAt;
    record.errorCode = errorCode;
    record.message = message;
  });
  await emitEvent(onEvent, {
    type: 'pass-failure',
    transactionId,
    passId,
    message: `Pass ${passId} failed: ${message}`
  });
}

export async function commitPipelineTransaction(
  workspaceRoot: string,
  transactionId: string,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const completedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const transaction = findTransaction(journal, transactionId);
    transaction.status = 'succeeded';
    transaction.completedAt = completedAt;
    journal.lastCommittedTransactionId = transactionId;
    if (journal.activeTransactionId === transactionId) delete journal.activeTransactionId;
  });
  await emitEvent(onEvent, {
    type: 'transaction-success',
    transactionId,
    message: `Pipeline transaction ${transactionId} succeeded`
  });
}

export async function failPipelineTransaction(
  workspaceRoot: string,
  transactionId: string,
  errorCode: string,
  message: string,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const completedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const transaction = findTransaction(journal, transactionId);
    transaction.status = 'failed';
    transaction.completedAt = completedAt;
    transaction.errorCode = errorCode;
    transaction.message = message;
    if (journal.activeTransactionId === transactionId) delete journal.activeTransactionId;
  });
  await emitEvent(onEvent, {
    type: 'transaction-failure',
    transactionId,
    message: `Pipeline transaction ${transactionId} failed: ${message}`
  });
}

export async function readPipelineJournal(workspaceRoot: string): Promise<PipelineJournal> {
  return readJournal(workspaceRoot);
}
