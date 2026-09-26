import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { rawSha256Hex } from '../../../contracts/canonical.ts';
import type { PipelineSource } from '../../../compiler/pipeline/source.ts';

import type { PassId } from '../../../compiler/contract/pass-status.ts';
import {
  type PipelineExecutionBoundary
} from '../../../compiler/pipeline/execution-boundaries.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from '../../../compiler/pipeline/stages.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { formatJsonFile } from "../../../contracts/json-text.ts";
import {
  PIPELINE_ADAPT_RETIREMENT_SCHEMA,
  PIPELINE_JOURNAL_FORMAT_VERSION,
  type PipelineAdaptRetirementRecord,
  type PipelineJournal,
  type PipelinePassRecord,
  type PipelinePassStatus,
  type PipelineTransactionRecord,
  type PipelineTransactionStatus
} from '../../compilation-protocol/journal-types.ts';
import type {
  PipelineEvent,
  PipelineEventHandler
} from '../../compilation-protocol/types.ts';
import { publishExistingParentCanonicalWorkspaceFile } from "../../filesystem/file-publication.ts";
import {
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  type NoFollowDirectoryTreeEntry,
  type PhysicalDirectoryIdentity
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryFile,
  retainOptionalDirectory
} from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { getWorkspacePaths } from "../../workspace-context.ts";
import { PASS_SEQUENCE } from './defaults.ts';

const MAX_RETAINED_TRANSACTIONS = 50;
const PIPELINE_JOURNAL_FILE = 'pipeline-journal.json';
const LEGACY_PIPELINE_JOURNAL_FORMAT_VERSION = '1' as const;
const RETIRED_ADAPT_STAGE = 'adapt' as const;
const PIPELINE_RETIREMENT_EVIDENCE_FILE_PREFIX = 'pipeline-journal-adapt-retirement-';
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
const LEGACY_PIPELINE_STAGES = new Set<string>([...PIPELINE_STAGE_IDS, RETIRED_ADAPT_STAGE]);
const LEGACY_PIPELINE_PASSES = new Set<string>([...PASS_SEQUENCE, RETIRED_ADAPT_STAGE]);
const JOURNAL_KEYS = new Set([
  'formatVersion', 'activeTransactionId', 'lastCommittedTransactionId', 'transactions', 'retirements'
]);
const LEGACY_JOURNAL_KEYS = new Set([
  'formatVersion', 'activeTransactionId', 'lastCommittedTransactionId', 'transactions'
]);
const TRANSACTION_KEYS = new Set([
  'id', 'source', 'requestedStages', 'status', 'startedAt', 'completedAt', 'passRecords', 'errorCode', 'message'
]);
const PASS_RECORD_KEYS = new Set(['passId', 'status', 'startedAt', 'completedAt', 'errorCode', 'message']);
const RETIREMENT_KEYS = new Set(['schema', 'retiredStage', 'legacyJournalBytesDigest', 'evidenceFile']);
const RETIREMENT_RECEIPT_KEYS = new Set(['schema', 'retiredStage', 'source', 'target']);
const RETIREMENT_RECEIPT_SOURCE_KEYS = new Set([
  'parentPhysical', 'filePhysical', 'bytesDigest', 'bytesBase64'
]);
const RETIREMENT_RECEIPT_TARGET_KEYS = new Set(['formatVersion', 'bytesDigest']);
const PHYSICAL_IDENTITY_KEYS = new Set(['device', 'inode']);

type LegacyPipelineStageId = PipelineStageId | typeof RETIRED_ADAPT_STAGE;
type LegacyPipelinePassId = PassId | typeof RETIRED_ADAPT_STAGE;
type ParsedPipelinePassRecord<TPassId extends string> =
  Omit<PipelinePassRecord, 'passId'> & Readonly<{ passId: TPassId }>;
type ParsedPipelineTransaction<TStageId extends string, TPassId extends string> =
  Omit<PipelineTransactionRecord, 'requestedStages' | 'passRecords'> & Readonly<{
    requestedStages: TStageId[];
    passRecords: ParsedPipelinePassRecord<TPassId>[];
  }>;
type LegacyPipelineJournal = Readonly<{
  formatVersion: typeof LEGACY_PIPELINE_JOURNAL_FORMAT_VERSION;
  lastCommittedTransactionId?: string;
  transactions: ParsedPipelineTransaction<LegacyPipelineStageId, LegacyPipelinePassId>[];
}>;
type ObservedPipelineJournalFile = Readonly<{
  parent: PhysicalDirectoryIdentity;
  entry: NoFollowDirectoryTreeEntry & Readonly<{ bytes: Uint8Array }>;
}>;

function rawBytesDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${rawSha256Hex(bytes)}`;
}

function physicalIdentity(value: Readonly<{ device: string; inode: string }>): Readonly<{
  device: string;
  inode: string;
}> {
  return Object.freeze({ device: value.device, inode: value.inode });
}

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

function validatePassRecord<TPassId extends string>(
  value: unknown,
  transactionId: string,
  allowedPasses: ReadonlySet<string>
): ParsedPipelinePassRecord<TPassId> {
  const label = `Pipeline journal transaction "${transactionId}" pass record`;
  if (!isRecord(value)) throw new Error(`${label} is malformed`);
  exactKeys(value, PASS_RECORD_KEYS, label);
  if (!boundedText(value.passId) || !allowedPasses.has(value.passId)) {
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
    passId: value.passId as TPassId,
    status,
    startedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(message === undefined ? {} : { message })
  };
}

function validateTransaction<TStageId extends string, TPassId extends string>(
  value: unknown,
  allowedStages: ReadonlySet<string>,
  allowedPasses: ReadonlySet<string>
): ParsedPipelineTransaction<TStageId, TPassId> {
  if (!isRecord(value)) throw new Error('Pipeline journal contains a malformed transaction record');
  exactKeys(value, TRANSACTION_KEYS, 'Pipeline journal transaction');
  if (!boundedText(value.id) || typeof value.source !== 'string' || !PIPELINE_SOURCES.has(value.source as PipelineSource) ||
      typeof value.status !== 'string' || !PIPELINE_TRANSACTION_STATUSES.has(value.status as PipelineTransactionStatus) ||
      !Array.isArray(value.requestedStages) || !Array.isArray(value.passRecords)) {
    throw new Error('Pipeline journal contains a malformed transaction record');
  }
  const requestedStages = value.requestedStages as unknown[];
  if (requestedStages.some((stage) => typeof stage !== 'string' || !allowedStages.has(stage)) ||
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
  const passRecords = value.passRecords.map((pass) =>
    validatePassRecord<TPassId>(pass, value.id as string, allowedPasses));
  return {
    id: value.id,
    source: value.source as PipelineSource,
    requestedStages: requestedStages as TStageId[],
    status,
    startedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    passRecords,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(message === undefined ? {} : { message })
  };
}

function canonicalDigest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be one canonical SHA-256 digest`);
  }
  return value as `sha256:${string}`;
}

function validateRetirementRecord(value: unknown): PipelineAdaptRetirementRecord {
  if (!isRecord(value)) throw new Error('Pipeline journal retirement record is malformed');
  exactKeys(value, RETIREMENT_KEYS, 'Pipeline journal retirement record');
  const legacyJournalBytesDigest = canonicalDigest(
    value.legacyJournalBytesDigest,
    'Pipeline journal retirement legacyJournalBytesDigest'
  );
  const expectedEvidenceFile = `${PIPELINE_RETIREMENT_EVIDENCE_FILE_PREFIX}${legacyJournalBytesDigest.slice('sha256:'.length)}.json`;
  if (
    value.schema !== PIPELINE_ADAPT_RETIREMENT_SCHEMA
    || value.retiredStage !== RETIRED_ADAPT_STAGE
    || value.evidenceFile !== expectedEvidenceFile
  ) {
    throw new Error('Pipeline journal retirement record is not canonical');
  }
  return Object.freeze({
    schema: PIPELINE_ADAPT_RETIREMENT_SCHEMA,
    retiredStage: RETIRED_ADAPT_STAGE,
    legacyJournalBytesDigest,
    evidenceFile: expectedEvidenceFile
  });
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
  const transactions = value.transactions.map((transaction) =>
    validateTransaction<PipelineStageId, PassId>(transaction, PIPELINE_STAGES, PIPELINE_PASSES));
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

  if (
    value.retirements !== undefined
    && (!Array.isArray(value.retirements) || value.retirements.length > MAX_RETAINED_TRANSACTIONS)
  ) {
    throw new Error(`Pipeline journal retirements are malformed at ${journalPath}`);
  }
  const retirements = value.retirements === undefined
    ? undefined
    : value.retirements.map(validateRetirementRecord);
  if (retirements !== undefined && new Set(
    retirements.map((retirement) => retirement.legacyJournalBytesDigest)
  ).size !== retirements.length) {
    throw new Error(`Pipeline journal repeats a retirement source digest at ${journalPath}`);
  }

  return {
    formatVersion: PIPELINE_JOURNAL_FORMAT_VERSION,
    ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
    ...(lastCommittedTransactionId === undefined ? {} : { lastCommittedTransactionId }),
    transactions,
    ...(retirements === undefined ? {} : { retirements })
  };
}

function validateLegacyAdaptJournal(value: unknown, journalPath: string): LegacyPipelineJournal {
  if (!isRecord(value)) {
    throw new Error(`Legacy Pipeline journal is malformed at ${journalPath}`);
  }
  exactKeys(value, LEGACY_JOURNAL_KEYS, 'Legacy Pipeline journal');
  if (
    value.formatVersion !== LEGACY_PIPELINE_JOURNAL_FORMAT_VERSION
    || value.activeTransactionId !== undefined
    || !Array.isArray(value.transactions)
    || value.transactions.length === 0
    || value.transactions.length > MAX_RETAINED_TRANSACTIONS
  ) {
    throw new Error(`Legacy Pipeline journal is not one terminal Adapt retirement source at ${journalPath}`);
  }
  const transactions = value.transactions.map((transaction) =>
    validateTransaction<LegacyPipelineStageId, LegacyPipelinePassId>(
      transaction,
      LEGACY_PIPELINE_STAGES,
      LEGACY_PIPELINE_PASSES
    ));
  if (
    transactions.some((transaction) => transaction.status === 'running')
    || transactions.some((transaction) => transaction.passRecords.some((record) => record.status === 'running'))
  ) {
    throw new Error(`Legacy Pipeline journal has nonterminal state at ${journalPath}`);
  }
  const sawRetiredStage = transactions.some((transaction) =>
    transaction.requestedStages.includes(RETIRED_ADAPT_STAGE));
  const sawRetiredPass = transactions.some((transaction) =>
    transaction.passRecords.some((record) => record.passId === RETIRED_ADAPT_STAGE));
  if (!sawRetiredStage && !sawRetiredPass) {
    throw new Error(`Legacy Pipeline journal does not contain the retired Adapt stage at ${journalPath}`);
  }
  if (transactions.some((transaction) =>
    transaction.passRecords.some((record) => record.passId === RETIRED_ADAPT_STAGE)
    && !transaction.requestedStages.includes(RETIRED_ADAPT_STAGE))) {
    throw new Error(`Legacy Pipeline journal contains an unbound retired Adapt pass at ${journalPath}`);
  }
  const ids = transactions.map((transaction) => transaction.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Legacy Pipeline journal repeats a transaction id at ${journalPath}`);
  }
  const lastCommittedTransactionId = value.lastCommittedTransactionId;
  if (lastCommittedTransactionId !== undefined && !boundedText(lastCommittedTransactionId)) {
    throw new Error(`Legacy Pipeline journal last committed transaction id is invalid at ${journalPath}`);
  }
  const latestSucceeded = [...transactions].reverse().find((transaction) => transaction.status === 'succeeded')?.id;
  if (lastCommittedTransactionId !== latestSucceeded) {
    throw new Error(`Legacy Pipeline journal last committed transaction is inconsistent at ${journalPath}`);
  }
  return Object.freeze({
    formatVersion: LEGACY_PIPELINE_JOURNAL_FORMAT_VERSION,
    ...(lastCommittedTransactionId === undefined ? {} : { lastCommittedTransactionId }),
    transactions
  });
}

function exactPhysicalIdentity(value: unknown, label: string): Readonly<{ device: string; inode: string }> {
  if (!isRecord(value)) throw new Error(`${label} is malformed`);
  exactKeys(value, PHYSICAL_IDENTITY_KEYS, label);
  if (!boundedText(value.device) || !boundedText(value.inode)) throw new Error(`${label} is malformed`);
  return Object.freeze({ device: value.device, inode: value.inode });
}

function validateRetirementReceipt(
  value: unknown,
  expected?: Readonly<{
    sourceParent: Readonly<{ device: string; inode: string }>;
    sourceFile: Readonly<{ device: string; inode: string }>;
    sourceBytesDigest: `sha256:${string}`;
    sourceBytes: Uint8Array;
    targetBytesDigest: `sha256:${string}`;
  }>
): Readonly<{
  sourceBytesDigest: `sha256:${string}`;
  sourceBytes: Uint8Array;
}> {
  if (!isRecord(value)) throw new Error('Pipeline journal Adapt retirement receipt is malformed');
  exactKeys(value, RETIREMENT_RECEIPT_KEYS, 'Pipeline journal Adapt retirement receipt');
  if (value.schema !== PIPELINE_ADAPT_RETIREMENT_SCHEMA || value.retiredStage !== RETIRED_ADAPT_STAGE) {
    throw new Error('Pipeline journal Adapt retirement receipt has invalid identity');
  }
  if (!isRecord(value.source)) throw new Error('Pipeline journal Adapt retirement receipt source is malformed');
  exactKeys(value.source, RETIREMENT_RECEIPT_SOURCE_KEYS, 'Pipeline journal Adapt retirement receipt source');
  const parentPhysical = exactPhysicalIdentity(
    value.source.parentPhysical,
    'Pipeline journal Adapt retirement receipt source parentPhysical'
  );
  const filePhysical = exactPhysicalIdentity(
    value.source.filePhysical,
    'Pipeline journal Adapt retirement receipt source filePhysical'
  );
  const sourceBytesDigest = canonicalDigest(
    value.source.bytesDigest,
    'Pipeline journal Adapt retirement receipt source bytesDigest'
  );
  if (typeof value.source.bytesBase64 !== 'string') {
    throw new Error('Pipeline journal Adapt retirement receipt source bytes are malformed');
  }
  const sourceBytes = Buffer.from(value.source.bytesBase64, 'base64');
  if (sourceBytes.toString('base64') !== value.source.bytesBase64) {
    throw new Error('Pipeline journal Adapt retirement receipt source bytes are not canonical base64');
  }
  if (!isRecord(value.target)) throw new Error('Pipeline journal Adapt retirement receipt target is malformed');
  exactKeys(value.target, RETIREMENT_RECEIPT_TARGET_KEYS, 'Pipeline journal Adapt retirement receipt target');
  const targetBytesDigest = canonicalDigest(
    value.target.bytesDigest,
    'Pipeline journal Adapt retirement receipt target bytesDigest'
  );
  if (
    value.target.formatVersion !== PIPELINE_JOURNAL_FORMAT_VERSION
    || rawBytesDigest(sourceBytes) !== sourceBytesDigest
    || (expected !== undefined && (
      parentPhysical.device !== expected.sourceParent.device
      || parentPhysical.inode !== expected.sourceParent.inode
      || filePhysical.device !== expected.sourceFile.device
      || filePhysical.inode !== expected.sourceFile.inode
      || sourceBytesDigest !== expected.sourceBytesDigest
      || !sourceBytes.equals(Buffer.from(expected.sourceBytes))
      || targetBytesDigest !== expected.targetBytesDigest
    ))
  ) {
    throw new Error('Pipeline journal Adapt retirement receipt does not bind the exact migration');
  }
  return Object.freeze({ sourceBytesDigest, sourceBytes });
}

function validateRetirementEvidence(workspaceRoot: string, journal: PipelineJournal): void {
  for (const retirement of journal.retirements ?? []) {
    const evidencePath = path.join(getWorkspacePaths(workspaceRoot).secRoot, retirement.evidenceFile);
    const evidenceBytes = readOptionalRetainedOrdinaryFile(
      evidencePath,
      'Pipeline journal Adapt retirement evidence'
    );
    if (evidenceBytes === null) {
      throw new Error(`Pipeline journal Adapt retirement evidence is missing at ${evidencePath}`);
    }
    const receipt = validateRetirementReceipt(parseExactJson(
      decodeExactUtf8(evidenceBytes, 'Pipeline journal Adapt retirement evidence'),
      'Pipeline journal Adapt retirement evidence'
    ));
    if (receipt.sourceBytesDigest !== retirement.legacyJournalBytesDigest) {
      throw new Error(`Pipeline journal Adapt retirement evidence does not match ${evidencePath}`);
    }
  }
}

function observePipelineJournalFile(workspaceRoot: string): ObservedPipelineJournalFile | null {
  const secRoot = getWorkspacePaths(workspaceRoot).secRoot;
  const parent = retainOptionalDirectory(secRoot, 'Pipeline journal migration parent');
  if (parent === null) return null;
  const entry = inspectNoFollowOrdinaryFileEntry(parent, PIPELINE_JOURNAL_FILE);
  if (entry === null) return null;
  if (entry.kind !== 'file' || entry.bytes === null) {
    throw new Error('Pipeline journal migration source is not one retained ordinary file');
  }
  return Object.freeze({ parent, entry: { ...entry, bytes: entry.bytes } });
}

function assertSameObservedJournal(
  expected: ObservedPipelineJournalFile,
  current: ObservedPipelineJournalFile | null
): void {
  if (
    current === null
    || current.parent.device !== expected.parent.device
    || current.parent.inode !== expected.parent.inode
    || current.entry.device !== expected.entry.device
    || current.entry.inode !== expected.entry.inode
    || !Buffer.from(current.entry.bytes).equals(Buffer.from(expected.entry.bytes))
  ) {
    throw new Error('Legacy Pipeline journal changed during Adapt retirement migration');
  }
}

function migrateLegacyJournalProjection(
  legacy: LegacyPipelineJournal,
  retirement: PipelineAdaptRetirementRecord,
  journalPath: string
): PipelineJournal {
  const transactions: PipelineTransactionRecord[] = legacy.transactions.map((transaction) => ({
    ...transaction,
    requestedStages: transaction.requestedStages.filter(
      (stage): stage is PipelineStageId => stage !== RETIRED_ADAPT_STAGE
    ),
    passRecords: transaction.passRecords.filter(
      (record): record is ParsedPipelinePassRecord<PassId> => record.passId !== RETIRED_ADAPT_STAGE
    )
  }));
  if (transactions.some((transaction) => transaction.requestedStages.length === 0)) {
    throw new Error(`Legacy Pipeline journal contains an Adapt-only transaction at ${journalPath}`);
  }
  return validateJournal({
    formatVersion: PIPELINE_JOURNAL_FORMAT_VERSION,
    ...(legacy.lastCommittedTransactionId === undefined
      ? {}
      : { lastCommittedTransactionId: legacy.lastCommittedTransactionId }),
    transactions,
    retirements: [retirement]
  }, journalPath);
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

function parsePipelineJournalBytes(bytes: Uint8Array, journalPath: string): unknown {
  try {
    return parseExactJson(decodeExactUtf8(bytes, 'Pipeline journal'), 'Pipeline journal');
  } catch (error) {
    throw new Error(
      `Pipeline journal cannot be read as exact JSON at ${journalPath}; explicit recovery is required`,
      { cause: error }
    );
  }
}

async function migrateLegacyAdaptJournalForReference(
  workspaceRoot: string,
  commitFence: PipelineCommitFence
): Promise<void> {
  const journalPath = pipelineJournalPath(workspaceRoot);
  const observed = observePipelineJournalFile(workspaceRoot);
  if (observed === null) return;
  const raw = parsePipelineJournalBytes(observed.entry.bytes, journalPath);
  if (isRecord(raw) && raw.formatVersion === PIPELINE_JOURNAL_FORMAT_VERSION) {
    validateRetirementEvidence(workspaceRoot, validateJournal(raw, journalPath));
    return;
  }

  const legacy = validateLegacyAdaptJournal(raw, journalPath);
  const sourceBytesDigest = rawBytesDigest(observed.entry.bytes);
  const evidenceFile = `${PIPELINE_RETIREMENT_EVIDENCE_FILE_PREFIX}${sourceBytesDigest.slice('sha256:'.length)}.json`;
  const retirement = validateRetirementRecord({
    schema: PIPELINE_ADAPT_RETIREMENT_SCHEMA,
    retiredStage: RETIRED_ADAPT_STAGE,
    legacyJournalBytesDigest: sourceBytesDigest,
    evidenceFile
  });
  const migrated = migrateLegacyJournalProjection(legacy, retirement, journalPath);
  const migratedBytes = Buffer.from(formatJsonFile(migrated), 'utf8');
  const targetBytesDigest = rawBytesDigest(migratedBytes);
  const receiptValue = {
    schema: PIPELINE_ADAPT_RETIREMENT_SCHEMA,
    retiredStage: RETIRED_ADAPT_STAGE,
    source: {
      parentPhysical: physicalIdentity(observed.parent),
      filePhysical: physicalIdentity(observed.entry),
      bytesDigest: sourceBytesDigest,
      bytesBase64: Buffer.from(observed.entry.bytes).toString('base64')
    },
    target: {
      formatVersion: PIPELINE_JOURNAL_FORMAT_VERSION,
      bytesDigest: targetBytesDigest
    }
  } as const;
  validateRetirementReceipt(receiptValue, {
    sourceParent: observed.parent,
    sourceFile: observed.entry,
    sourceBytesDigest,
    sourceBytes: observed.entry.bytes,
    targetBytesDigest
  });
  const receiptBytes = Buffer.from(formatJsonFile(receiptValue), 'utf8');

  await commitFence();
  assertSameObservedJournal(observed, observePipelineJournalFile(workspaceRoot));
  publishExclusiveDurableCanonicalFile({
    parent: observed.parent,
    name: evidenceFile,
    bytes: receiptBytes,
    validate: (readback) => {
      if (!Buffer.from(readback).equals(receiptBytes)) {
        throw new Error('Pipeline journal Adapt retirement evidence readback differs');
      }
      validateRetirementReceipt(
        parseExactJson(decodeExactUtf8(readback, 'Pipeline journal Adapt retirement evidence')),
        {
          sourceParent: observed.parent,
          sourceFile: observed.entry,
          sourceBytesDigest,
          sourceBytes: observed.entry.bytes,
          targetBytesDigest
        }
      );
    }
  });

  await commitFence();
  assertSameObservedJournal(observed, observePipelineJournalFile(workspaceRoot));
  replaceDurableCanonicalFile({
    parent: observed.parent,
    name: PIPELINE_JOURNAL_FILE,
    bytes: migratedBytes,
    expectedExisting: physicalIdentity(observed.entry),
    validate: (readback) => {
      if (!Buffer.from(readback).equals(migratedBytes)) {
        throw new Error('Migrated Pipeline journal readback differs');
      }
      validateJournal(parsePipelineJournalBytes(readback, journalPath), journalPath);
    }
  });

  const readback = observePipelineJournalFile(workspaceRoot);
  if (readback === null || !Buffer.from(readback.entry.bytes).equals(migratedBytes)) {
    throw new Error('Migrated Pipeline journal is not the exact published target');
  }
  validateRetirementEvidence(
    workspaceRoot,
    validateJournal(parsePipelineJournalBytes(readback.entry.bytes, journalPath), journalPath)
  );
  const receiptReadback = inspectNoFollowOrdinaryFileEntry(readback.parent, evidenceFile);
  if (
    receiptReadback === null
    || receiptReadback.kind !== 'file'
    || receiptReadback.bytes === null
    || !Buffer.from(receiptReadback.bytes).equals(receiptBytes)
  ) {
    throw new Error('Pipeline journal Adapt retirement evidence is not immutable after migration');
  }
}

function readJournal(workspaceRoot: string): PipelineJournal {
  const journalPath = pipelineJournalPath(workspaceRoot);
  const bytes = readOptionalRetainedOrdinaryFile(journalPath, 'Pipeline journal');
  if (bytes === null) return emptyJournal();
  const raw = parsePipelineJournalBytes(bytes, journalPath);
  if (isRecord(raw) && raw.formatVersion === LEGACY_PIPELINE_JOURNAL_FORMAT_VERSION) {
    throw new Error(`Pipeline journal at ${journalPath} requires owner-issued Adapt retirement migration`);
  }
  const journal = validateJournal(raw, journalPath);
  validateRetirementEvidence(workspaceRoot, journal);
  return journal;
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
  if (source === 'reference') {
    await migrateLegacyAdaptJournalForReference(workspaceRoot, commitFence);
  }
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
