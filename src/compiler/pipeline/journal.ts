import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { readOptionalRetainedJson } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { formatJsonFile, publishExistingParentCanonicalWorkspaceFile } from '../../workspace/files.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import { PASS_SEQUENCE } from './defaults.ts';
import {
  PIPELINE_JOURNAL_FORMAT_VERSION,
  PIPELINE_STAGE_IDS,
  type PassId,
  type PipelineEvent,
  type PipelineEventHandler,
  type PipelineExecutionBoundary,
  type PipelineJournal,
  type PipelinePassRecord,
  type PipelinePassStatus,
  type PipelineSource,
  type PipelineStageId,
  type PipelineTransactionRecord,
  type PipelineTransactionStatus
} from './types.ts';

const MAX_RETAINED_TRANSACTIONS = 50;
const PIPELINE_JOURNAL_FILE = 'pipeline-journal.json';
export const REFERENCE_PIPELINE_TRANSACTION_ID = 'tx:reference-workspace';
const journalMutationQueues = new Map<string, Promise<void>>();
type PipelineCommitFence = () => Promise<void>;

const PIPELINE_SOURCES = new Set<PipelineSource>([
  'api', 'cli', 'reference', 'upgrade', 'repair', 'ci'
]);
const PIPELINE_TRANSACTION_STATUSES = new Set<PipelineTransactionStatus>(['running', 'succeeded', 'failed']);
const PIPELINE_PASS_STATUSES = new Set<PipelinePassStatus>(['running', 'succeeded', 'failed', 'blocked', 'skipped']);
const PIPELINE_STAGES = new Set<string>(PIPELINE_STAGE_IDS);
const PIPELINE_PASSES = new Set<string>(PASS_SEQUENCE);
const JOURNAL_KEYS = new Set(['formatVersion', 'activeTransactionId', 'lastCommittedTransactionId', 'transactions']);
const TRANSACTION_KEYS = new Set([
  'id', 'source', 'requestedStages', 'status', 'startedAt', 'completedAt', 'passRecords', 'errorCode', 'message'
]);
const PASS_RECORD_KEYS = new Set(['passId', 'status', 'startedAt', 'completedAt', 'errorCode', 'message']);

function pipelineJournalPath(workspaceRoot: string): string {
  return path.join(getWorkspacePaths(workspaceRoot).secRoot, PIPELINE_JOURNAL_FILE);
}

function emptyJournal(): PipelineJournal {
  return { formatVersion: PIPELINE_JOURNAL_FORMAT_VERSION, transactions: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field "${key}"`);
  }
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error(`${label} must be one canonical UTC timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be one canonical UTC timestamp`);
  }
  return value;
}

function optionalBoundedText(value: unknown, label: string, maximum = 4096): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validatePassRecord(value: unknown, transactionId: string): PipelinePassRecord {
  const label = `Pipeline journal transaction "${transactionId}" pass record`;
  if (!isRecord(value)) throw new Error(`${label} is malformed`);
  exactKeys(value, PASS_RECORD_KEYS, label);
  if (!boundedText(value.passId) || !PIPELINE_PASSES.has(value.passId)) {
    throw new Error(`${label} has an invalid pass identity`);
  }
  if (typeof value.status !== 'string' || !PIPELINE_PASS_STATUSES.has(value.status as PipelinePassStatus)) {
    throw new Error(`${label} has an invalid status`);
  }
  const status = value.status as PipelinePassStatus;
  const startedAt = canonicalTimestamp(value.startedAt, `${label}.startedAt`);
  const completedAt = value.completedAt === undefined
    ? undefined
    : canonicalTimestamp(value.completedAt, `${label}.completedAt`);
  const errorCode = optionalBoundedText(value.errorCode, `${label}.errorCode`);
  const message = optionalBoundedText(value.message, `${label}.message`, 16_384);
  if (status === 'running' && (completedAt !== undefined || errorCode !== undefined || message !== undefined)) {
    throw new Error(`${label} running state cannot contain terminal fields`);
  }
  if (status !== 'running' && completedAt === undefined) {
    throw new Error(`${label} terminal state requires completedAt`);
  }
  return {
    passId: value.passId as PassId,
    status,
    startedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(message === undefined ? {} : { message })
  };
}

function validateTransaction(value: unknown): PipelineTransactionRecord {
  if (!isRecord(value)) throw new Error('Pipeline journal contains a malformed transaction record');
  exactKeys(value, TRANSACTION_KEYS, 'Pipeline journal transaction');
  if (!boundedText(value.id) || typeof value.source !== 'string' || !PIPELINE_SOURCES.has(value.source as PipelineSource) ||
      typeof value.status !== 'string' || !PIPELINE_TRANSACTION_STATUSES.has(value.status as PipelineTransactionStatus) ||
      !Array.isArray(value.requestedStages) || !Array.isArray(value.passRecords)) {
    throw new Error('Pipeline journal contains a malformed transaction record');
  }
  const requestedStages = value.requestedStages as unknown[];
  if (requestedStages.some((stage) => typeof stage !== 'string' || !PIPELINE_STAGES.has(stage)) ||
      new Set(requestedStages).size !== requestedStages.length) {
    throw new Error(`Pipeline journal transaction "${value.id}" has invalid requested stages`);
  }
  const status = value.status as PipelineTransactionStatus;
  const startedAt = canonicalTimestamp(value.startedAt, `Pipeline journal transaction "${value.id}" startedAt`);
  const completedAt = value.completedAt === undefined
    ? undefined
    : canonicalTimestamp(value.completedAt, `Pipeline journal transaction "${value.id}" completedAt`);
  const errorCode = optionalBoundedText(value.errorCode, `Pipeline journal transaction "${value.id}" errorCode`);
  const message = optionalBoundedText(value.message, `Pipeline journal transaction "${value.id}" message`, 16_384);
  if (status === 'running' && (completedAt !== undefined || errorCode !== undefined || message !== undefined)) {
    throw new Error(`Pipeline journal transaction "${value.id}" running state cannot contain terminal fields`);
  }
  if (status !== 'running' && completedAt === undefined) {
    throw new Error(`Pipeline journal transaction "${value.id}" terminal state requires completedAt`);
  }
  if (value.passRecords.length > 128) {
    throw new Error(`Pipeline journal transaction "${value.id}" exceeds the pass-record bound`);
  }
  const passRecords = value.passRecords.map((pass) => validatePassRecord(pass, value.id as string));
  return {
    id: value.id,
    source: value.source as PipelineSource,
    requestedStages: requestedStages as PipelineStageId[],
    status,
    startedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    passRecords,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(message === undefined ? {} : { message })
  };
}

function validateJournal(value: unknown, journalPath: string): PipelineJournal {
  if (!isRecord(value)) {
    throw new Error(`Pipeline journal is stale or malformed at ${journalPath}; explicit recovery is required`);
  }
  exactKeys(value, JOURNAL_KEYS, 'Pipeline journal');
  if (value.formatVersion !== PIPELINE_JOURNAL_FORMAT_VERSION ||
      !Array.isArray(value.transactions) || value.transactions.length > MAX_RETAINED_TRANSACTIONS) {
    throw new Error(`Pipeline journal is stale or malformed at ${journalPath}; explicit recovery is required`);
  }
  const transactions = value.transactions.map(validateTransaction);
  const transactionById = new Map<string, PipelineTransactionRecord>();
  for (const transaction of transactions) {
    if (transactionById.has(transaction.id)) {
      throw new Error(`Pipeline journal repeats transaction id "${transaction.id}" at ${journalPath}`);
    }
    transactionById.set(transaction.id, transaction);
  }

  const activeTransactionId = value.activeTransactionId;
  if (activeTransactionId !== undefined && !boundedText(activeTransactionId)) {
    throw new Error(`Pipeline journal active transaction id is invalid at ${journalPath}`);
  }
  const running = transactions.filter((transaction) => transaction.status === 'running');
  if (running.length > 1 ||
      (running.length === 0 && activeTransactionId !== undefined) ||
      (running.length === 1 && activeTransactionId !== running[0]!.id)) {
    throw new Error(`Pipeline journal active transaction is inconsistent at ${journalPath}`);
  }

  const lastCommittedTransactionId = value.lastCommittedTransactionId;
  if (lastCommittedTransactionId !== undefined && !boundedText(lastCommittedTransactionId)) {
    throw new Error(`Pipeline journal last committed transaction id is invalid at ${journalPath}`);
  }
  const latestSucceeded = [...transactions].reverse().find((transaction) => transaction.status === 'succeeded')?.id;
  if (lastCommittedTransactionId !== latestSucceeded) {
    throw new Error(`Pipeline journal last committed transaction is inconsistent at ${journalPath}`);
  }

  return {
    formatVersion: PIPELINE_JOURNAL_FORMAT_VERSION,
    ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
    ...(lastCommittedTransactionId === undefined ? {} : { lastCommittedTransactionId }),
    transactions
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

export async function emitPipelineExecutionBoundary(
  handler: PipelineEventHandler | undefined,
  transactionId: string,
  boundary: PipelineExecutionBoundary
): Promise<void> {
  await emitEvent(handler, {
    type: 'execution-boundary',
    transactionId,
    boundary,
    message: `Pipeline execution entered ${boundary}`
  });
}

function readJournal(workspaceRoot: string): PipelineJournal {
  const journalPath = pipelineJournalPath(workspaceRoot);
  let raw: unknown;
  try {
    raw = readOptionalRetainedJson<unknown>(journalPath, 'Pipeline journal');
  } catch (error) {
    throw new Error(
      `Pipeline journal cannot be read as retained JSON at ${journalPath}; explicit recovery is required`,
      { cause: error }
    );
  }
  return raw === null ? emptyJournal() : validateJournal(raw, journalPath);
}

function rebindLastCommittedTransaction(journal: PipelineJournal): void {
  const latest = [...journal.transactions].reverse().find((transaction) => transaction.status === 'succeeded');
  if (latest) journal.lastCommittedTransactionId = latest.id;
  else delete journal.lastCommittedTransactionId;
}

function retainJournalTransactions(journal: PipelineJournal): void {
  if (journal.transactions.length <= MAX_RETAINED_TRANSACTIONS) return;
  const committed = journal.lastCommittedTransactionId
    ? journal.transactions.find((transaction) => transaction.id === journal.lastCommittedTransactionId)
    : undefined;
  const tail = journal.transactions.slice(-MAX_RETAINED_TRANSACTIONS);
  if (!committed || tail.some((transaction) => transaction.id === committed.id)) {
    journal.transactions = tail;
    return;
  }
  journal.transactions = [committed, ...journal.transactions.slice(-(MAX_RETAINED_TRANSACTIONS - 1))];
}

async function publishJournal(
  workspaceRoot: string,
  journalPath: string,
  journal: PipelineJournal,
  commitFence: PipelineCommitFence
): Promise<void> {
  await publishExistingParentCanonicalWorkspaceFile({
    workspaceRoot,
    targetPath: journalPath,
    bytes: Buffer.from(formatJsonFile(validateJournal(journal, journalPath)), 'utf8'),
    label: 'Pipeline journal',
    commitFence
  });
}

async function mutateJournal(
  workspaceRoot: string,
  mutate: (journal: PipelineJournal) => void | Promise<void>,
  commitFence: PipelineCommitFence
): Promise<void> {
  const journalPath = pipelineJournalPath(workspaceRoot);
  const run = async (): Promise<void> => {
    const journal = readJournal(workspaceRoot);
    await mutate(journal);
    retainJournalTransactions(journal);
    await publishJournal(workspaceRoot, journalPath, journal, commitFence);
  };
  const previous = journalMutationQueues.get(journalPath) ?? Promise.resolve();
  const current = previous.then(run, run);
  const tail = current.catch(() => undefined);
  journalMutationQueues.set(journalPath, tail);
  try {
    await current;
  } finally {
    if (journalMutationQueues.get(journalPath) === tail) journalMutationQueues.delete(journalPath);
  }
}

function findTransaction(journal: PipelineJournal, transactionId: string): PipelineTransactionRecord {
  const transaction = journal.transactions.find((entry) => entry.id === transactionId);
  if (!transaction) throw new Error(`Pipeline transaction "${transactionId}" is missing from the local journal`);
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
  commitFence: PipelineCommitFence,
  onEvent?: PipelineEventHandler
): Promise<string> {
  const transactionId = source === 'reference'
    ? REFERENCE_PIPELINE_TRANSACTION_ID
    : `tx:${randomUUID()}`;
  const startedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    interruptActiveTransaction(journal, startedAt);
    if (source === 'reference') {
      journal.transactions = journal.transactions.filter((entry) => entry.id !== transactionId);
      rebindLastCommittedTransaction(journal);
    }
    journal.transactions.push({
      id: transactionId,
      source,
      requestedStages: [...requestedStages],
      status: 'running',
      startedAt,
      passRecords: []
    });
    journal.activeTransactionId = transactionId;
  }, commitFence);
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
  commitFence: PipelineCommitFence,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const startedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const transaction = findTransaction(journal, transactionId);
    transaction.passRecords.push({ passId, status: 'running', startedAt });
  }, commitFence);
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
  commitFence: PipelineCommitFence,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const timestamp = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    findTransaction(journal, transactionId).passRecords.push({
      passId,
      status: 'blocked',
      startedAt: timestamp,
      completedAt: timestamp,
      errorCode,
      message
    });
  }, commitFence);
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
  commitFence: PipelineCommitFence,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const completedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const record = findRunningPass(findTransaction(journal, transactionId), passId);
    record.status = 'succeeded';
    record.completedAt = completedAt;
  }, commitFence);
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
  commitFence: PipelineCommitFence,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const completedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const record = findRunningPass(findTransaction(journal, transactionId), passId);
    record.status = 'failed';
    record.completedAt = completedAt;
    record.errorCode = errorCode;
    record.message = message;
  }, commitFence);
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
  commitFence: PipelineCommitFence,
  onEvent?: PipelineEventHandler
): Promise<void> {
  const completedAt = new Date().toISOString();
  await mutateJournal(workspaceRoot, (journal) => {
    const transaction = findTransaction(journal, transactionId);
    transaction.status = 'succeeded';
    transaction.completedAt = completedAt;
    journal.lastCommittedTransactionId = transactionId;
    if (journal.activeTransactionId === transactionId) delete journal.activeTransactionId;
  }, commitFence);
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
  commitFence: PipelineCommitFence,
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
  }, commitFence);
  await emitEvent(onEvent, {
    type: 'transaction-failure',
    transactionId,
    message: `Pipeline transaction ${transactionId} failed: ${message}`
  });
}

export function readPipelineJournal(workspaceRoot: string): PipelineJournal {
  return readJournal(workspaceRoot);
}
