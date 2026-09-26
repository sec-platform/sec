import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createSha256Hasher } from '../../../../contracts/digest.ts';
import { CompilerError } from '../../../../compiler/errors.ts';
import { canonicalJson, rawSha256Hex } from '../../../../contracts/canonical.ts';
import { resolveWorkspaceLocalStateRoot } from '../../../../workspace/contract/local-state.ts';
import { ensureDir } from "../../../filesystem/files.ts";
import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../../filesystem/write-lease.ts';

export type ImportTransformWrite = Readonly<{
  relativePath: string;
  expectedBytes: Buffer;
  replacementBytes: Buffer;
}>;

export type ImportTransformTransactionOutcome =
  | Readonly<{
    schema: 'sec-import-transform-transaction-outcome-v1';
    status: 'accepted';
    files: readonly string[];
    transactionId: string;
    journalPath: string;
  }>
  | Readonly<{
    schema: 'sec-import-transform-transaction-outcome-v1';
    status: 'rolled-back';
    files: readonly string[];
    transactionId: string;
    journalPath: string;
    reasonCode: 'preimage-conflict' | 'publication-failed' | 'readback-failed';
  }>
  | Readonly<{
    schema: 'sec-import-transform-transaction-outcome-v1';
    status: 'recovery-required';
    files: readonly string[];
    transactionId: string;
    journalPath: string;
    reasonCode: 'journal-failed' | 'rollback-conflict' | 'rollback-failed';
  }>;

export type ImportTransformTransactionTestHooks = Readonly<{
  beforePublish?: (relativePath: string, index: number) => void | Promise<void>;
  beforeCandidateSync?: (temporaryPath: string) => void | Promise<void>;
  afterCandidateRename?: (targetPath: string) => void | Promise<void>;
  beforeJournalAppend?: (state: 'prepared' | 'publishing' | 'accepted' | 'rolling-back' | 'rolled-back' | 'recovery-required') => void | Promise<void>;
  afterPublish?: (relativePath: string, index: number) => void | Promise<void>;
  beforeRollback?: (relativePath: string, index: number) => void | Promise<void>;
}>;

type PreparedWrite = Readonly<{
  relativePath: string;
  absolutePath: string;
  preimageCandidatePath: string;
  replacementCandidatePath: string;
  expectedBytes: Buffer;
  replacementBytes: Buffer;
  expectedDigest: string;
  replacementDigest: string;
  mode: number;
}>;

type TransactionReason =
  | 'preimage-conflict'
  | 'publication-failed'
  | 'readback-failed'
  | 'journal-failed'
  | 'rollback-conflict'
  | 'rollback-failed';

type PublicationReason = Extract<TransactionReason,
  'preimage-conflict' | 'publication-failed' | 'readback-failed'>;
type RecoveryReason = Extract<TransactionReason,
  'journal-failed' | 'rollback-conflict' | 'rollback-failed'>;
type JournalState = 'prepared' | 'publishing' | 'accepted' | 'rolling-back' | 'rolled-back' | 'recovery-required';
const PublicationReasons = ['preimage-conflict', 'publication-failed', 'readback-failed'] as const;
const RecoveryReasons = ['journal-failed', 'rollback-conflict', 'rollback-failed'] as const;

function isPublicationReason(value: unknown): value is PublicationReason {
  return typeof value === 'string' && PublicationReasons.includes(value as PublicationReason);
}

function isRecoveryReason(value: unknown): value is RecoveryReason {
  return typeof value === 'string' && RecoveryReasons.includes(value as RecoveryReason);
}

// v3 is the sole writer/normal-reader grammar. v2 is read-only legacy input.
const ImportTransformBindingFormat = 'sec-import-transform-transaction-v2' as const;
const ImportTransformJournalFormat = 'sec-import-transform-journal-entry-v2' as const;
const ImportTransformCompactJournalFormat = 'sec-import-transform-journal-entry-v3' as const;
const ImportTransformTerminalReceiptFormat = 'sec-import-transform-terminal-receipt-v1' as const;
const IMPORT_TRANSFORM_JOURNAL_MAX_BYTES = 16 * 1024 * 1024;
// The former v2 writer copied the complete write set into every progress edge,
// so a valid terminal journal could exceed the compact v3 ceiling.  This
// larger limit belongs exclusively to the one-way legacy settlement reader;
// no current writer or unfinished recovery path may consume it.
const IMPORT_TRANSFORM_LEGACY_TERMINAL_MAX_BYTES = 64 * 1024 * 1024;
const IMPORT_TRANSFORM_JOURNAL_MAX_RECORDS = 100_000;

class ImportTransformTransactionFailure extends Error {
  constructor(readonly reasonCode: TransactionReason, message: string) {
    super(message);
    this.name = 'ImportTransformTransactionFailure';
  }
}

function containedFile(workspaceRoot: string, relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.length === 0 || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new CompilerError('IMPORT-TRANSFORM-003', `Import transform path escapes the workspace: ${relativePath}`, {
      relativePath
    });
  }
  const absolutePath = path.resolve(workspaceRoot, ...normalized.split('/'));
  const relative = path.relative(path.resolve(workspaceRoot), absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CompilerError('IMPORT-TRANSFORM-003', `Import transform path escapes the workspace: ${relativePath}`, {
      relativePath
    });
  }
  return absolutePath;
}

function samePhysicalPath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function assertOrdinaryContainedTargetChain(workspaceRoot: string, absolutePath: string): Promise<void> {
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, absolutePath);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new ImportTransformTransactionFailure('preimage-conflict', 'Import transform target escaped its workspace root.');
  }
  const rootMetadata = await fs.lstat(root);
  const rootRealPath = await fs.realpath(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || !samePhysicalPath(rootRealPath, root)) {
    throw new ImportTransformTransactionFailure('preimage-conflict', 'Import transform workspace root is not one ordinary directory.');
  }
  let current = root;
  const segments = relative.split(path.sep);
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const metadata = await fs.lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || !samePhysicalPath(await fs.realpath(current), current)) {
      throw new ImportTransformTransactionFailure('preimage-conflict',
        `Import transform target has a symlink/reparse ancestor: ${relative}`);
    }
  }
  const metadata = await fs.lstat(absolutePath);
  const targetRealPath = await fs.realpath(absolutePath);
  const contained = path.relative(rootRealPath, targetRealPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || contained === '..'
    || contained.startsWith(`..${path.sep}`) || path.isAbsolute(contained)) {
    throw new ImportTransformTransactionFailure('preimage-conflict',
      `Import transform target is not an ordinary contained file: ${relative}`);
  }
}

function importTransformCandidatePath(
  absolutePath: string,
  transactionId: string,
  image: 'preimage' | 'replacement'
): string {
  return `${absolutePath}.imports-transform-${transactionId}.${image}.candidate`;
}

async function readOptionalOrdinaryCandidate(
  workspaceRoot: string,
  candidatePath: string
): Promise<Readonly<{ bytes: Buffer; mode: number }> | null> {
  const parentProbe = path.join(path.dirname(candidatePath), path.basename(candidatePath));
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, parentProbe);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new ImportTransformTransactionFailure('preimage-conflict',
      'Import transform candidate escaped its workspace root.');
  }
  const rootMetadata = await fs.lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
    || !samePhysicalPath(await fs.realpath(root), root)) {
    throw new ImportTransformTransactionFailure('preimage-conflict',
      'Import transform candidate workspace root is not one ordinary directory.');
  }
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    const metadata = await fs.lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || !samePhysicalPath(await fs.realpath(current), current)) {
      throw new ImportTransformTransactionFailure('preimage-conflict',
        `Import transform candidate has a symlink/reparse ancestor: ${relative}`);
    }
  }
  try {
    const metadata = await fs.lstat(candidatePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()
      || !samePhysicalPath(await fs.realpath(candidatePath), candidatePath)) {
      throw new ImportTransformTransactionFailure('preimage-conflict',
        `Import transform candidate is not one ordinary file: ${relative}`);
    }
    return Object.freeze({ bytes: await fs.readFile(candidatePath), mode: metadata.mode & 0o777 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function reconcileCandidateArtifact(
  workspaceRoot: string,
  candidatePath: string,
  expectedBytes: Buffer,
  mode: number
): Promise<void> {
  const observed = await readOptionalOrdinaryCandidate(workspaceRoot, candidatePath);
  if (observed === null) return;
  if (observed.mode !== mode || !observed.bytes.equals(expectedBytes)) {
    throw new ImportTransformTransactionFailure('preimage-conflict',
      `Import transform candidate residue differs from its transaction binding: ${candidatePath}`);
  }
  await fs.unlink(candidatePath);
  await syncDirectory(path.dirname(candidatePath));
}

async function writeDurable(filePath: string, bytes: Buffer | string): Promise<void> {
  const handle = await fs.open(filePath, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filePath));
}

/**
 * A file fsync does not make the directory entry durable.  Refuse to report a
 * successful transaction on filesystems that cannot provide that guarantee.
 */
async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directoryPath, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Bun and Node do not expose directory fsync on Windows. This is a
    // platform capability boundary only; every other directory-sync failure,
    // and all file fsync / rename / readback failures, remain fail-closed.
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function replaceDurable(
  workspaceRoot: string,
  filePath: string,
  expectedCurrentBytes: Buffer,
  bytes: Buffer,
  mode: number,
  candidatePath: string,
  assertLease: () => Promise<void>,
  testHooks: ImportTransformTransactionTestHooks,
  onPhysicalRename: () => void = () => undefined
): Promise<void> {
  // The physical rename boundary rechecks containment, preimage bytes/mode,
  // and the canonical supported-writer lease instead of trusting an earlier
  // observation. Forward publication, rollback, and recovery share this owner.
  await assertExpectedCurrentTarget(workspaceRoot, filePath, expectedCurrentBytes, mode);
  await assertLease();
  await reconcileCandidateArtifact(workspaceRoot, candidatePath, bytes, mode);
  try {
    const handle = await fs.open(candidatePath, 'wx', mode);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(mode);
      await testHooks.beforeCandidateSync?.(candidatePath);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(path.dirname(candidatePath));
    await assertLease();
    await assertExpectedCurrentTarget(workspaceRoot, filePath, expectedCurrentBytes, mode);
    // CAS is defined inside the canonical workspace-writer lease. Every
    // supported SEC writer is serialized by that lease; a hostile process with
    // direct directory-write authority is outside this developer-tool contract.
    await fs.rename(candidatePath, filePath);
    onPhysicalRename();
    await testHooks.afterCandidateRename?.(filePath);
    await syncDirectory(path.dirname(filePath));
  } finally {
    await reconcileCandidateArtifact(workspaceRoot, candidatePath, bytes, mode);
  }
}

async function assertExpectedCurrentTarget(
  workspaceRoot: string,
  filePath: string,
  expectedBytes: Buffer,
  mode: number
): Promise<void> {
  await assertOrdinaryContainedTargetChain(workspaceRoot, filePath);
  const metadata = await fs.lstat(filePath);
  const current = await fs.readFile(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== mode
    || !current.equals(expectedBytes)) {
    throw new ImportTransformTransactionFailure('preimage-conflict',
      `Import transform target drifted before durable rename: ${filePath}`);
  }
}

type LegacyJournalEntry = Readonly<{
  formatVersion: typeof ImportTransformJournalFormat;
  transactionId: string;
  state: JournalState;
  files: readonly Readonly<{
    relativePath: string;
    expectedDigest: string;
    replacementDigest: string;
  }>[];
  published: readonly string[];
  outstanding: readonly string[];
  publicationReasonCode: PublicationReason | null;
  recoveryReasonCode: RecoveryReason | null;
}>;

type RecoveredTransaction = Readonly<{
  transactionId: string;
  journalPath: string;
  files: readonly PreparedWrite[];
  journalFormat: 'legacy' | 'compact';
  bindingDigest: string;
  compactJournalTail: CompactJournalEntry | null;
  journalWasMissing: boolean;
  state: JournalState;
  published: readonly string[];
  outstanding: readonly string[];
  publicationReasonCode: PublicationReason | null;
  recoveryReasonCode: RecoveryReason | null;
}>;

type ImportTransformTerminalReceipt = Readonly<{
  formatVersion: typeof ImportTransformTerminalReceiptFormat;
  transactionId: string;
  bindingDigest: string;
  journalFormat: typeof ImportTransformJournalFormat;
  journalDigest: string;
  journalBytes: number;
  state: 'accepted' | 'rolled-back';
  publishedCount: number;
  publicationReasonCode: PublicationReason | null;
}>;

function recoveryRequiredOutcome(
  transactionId: string,
  journalPath: string,
  reasonCode: RecoveryReason,
  files: readonly string[] = []
): Extract<ImportTransformTransactionOutcome, { status: 'recovery-required' }> {
  return Object.freeze({
    schema: 'sec-import-transform-transaction-outcome-v1' as const,
    status: 'recovery-required' as const,
    files: Object.freeze([...files]), transactionId, journalPath, reasonCode
  });
}

function exactPrefix(
  raw: unknown,
  files: readonly PreparedWrite[],
  label: string
): readonly string[] {
  if (!Array.isArray(raw) || raw.length > files.length) recoveryFailure(`${label} is invalid.`);
  const result: string[] = [];
  for (const [index, value] of raw.entries()) {
    if (typeof value !== 'string' || value !== files[index]?.relativePath) recoveryFailure(`${label} is invalid.`);
    result.push(value);
  }
  return Object.freeze(result);
}

function prefixExtendsByAtMostOne(previous: readonly string[], next: readonly string[]): boolean {
  return next.length >= previous.length && next.length <= previous.length + 1
    && previous.every((value, index) => next[index] === value);
}

function prefixDoesNotGrow(previous: readonly string[], next: readonly string[]): boolean {
  return next.length <= previous.length
    && next.every((value, index) => previous[index] === value);
}

function validateLegacyJournalTransition(
  previous: LegacyJournalEntry | undefined,
  next: LegacyJournalEntry,
  files: readonly PreparedWrite[]
): void {
  const forward = next.state === 'prepared' || next.state === 'publishing' || next.state === 'accepted';
  if (forward) {
    if (next.outstanding.length !== 0 || next.publicationReasonCode !== null || next.recoveryReasonCode !== null) {
      recoveryFailure('Import transform forward journal entry carries recovery state.');
    }
  } else if (next.state === 'rolling-back' || next.state === 'rolled-back') {
    if (next.publicationReasonCode === null || next.recoveryReasonCode !== null) {
      recoveryFailure('Import transform rollback journal reason is invalid.');
    }
  } else if (next.publicationReasonCode === null || next.recoveryReasonCode === null) {
    recoveryFailure('Import transform recovery-required journal reasons are incomplete.');
  }
  if (next.state === 'prepared' && (next.published.length !== 0 || next.outstanding.length !== 0)) {
    recoveryFailure('Import transform prepared journal entry must be empty.');
  }
  if (next.state === 'accepted' && (next.published.length !== files.length || next.outstanding.length !== 0)) {
    recoveryFailure('Import transform accepted journal entry is incomplete.');
  }
  if (next.state === 'rolled-back' && next.outstanding.length !== 0) {
    recoveryFailure('Import transform rolled-back journal entry retains outstanding files.');
  }
  if (next.outstanding.length > next.published.length
    || next.outstanding.some((value, index) => value !== next.published[index])) {
    recoveryFailure('Import transform outstanding set is not an exact published prefix.');
  }
  if (previous === undefined) {
    if (next.state !== 'prepared') recoveryFailure('Import transform journal must begin prepared.');
    return;
  }
  const allowed = previous.state === 'prepared'
    ? next.state === 'publishing' || next.state === 'rolling-back' || next.state === 'recovery-required'
    : previous.state === 'publishing'
      ? next.state === 'publishing' || next.state === 'accepted' || next.state === 'rolling-back'
        || next.state === 'recovery-required'
      : previous.state === 'rolling-back'
        ? next.state === 'rolling-back' || next.state === 'rolled-back' || next.state === 'recovery-required'
        : false;
  if (!allowed) recoveryFailure('Import transform journal state sequence is invalid.');
  if (previous.state === 'prepared' || previous.state === 'publishing') {
    if (next.state === 'publishing' || next.state === 'accepted') {
      if (!prefixExtendsByAtMostOne(previous.published, next.published)) {
        recoveryFailure('Import transform published progress is not one monotonic edge.');
      }
    } else if (!prefixExtendsByAtMostOne(previous.published, next.published)
      || !next.outstanding.every((value, index) => next.published[index] === value)) {
      recoveryFailure('Import transform rollback did not bind the observed published prefix.');
    }
  } else {
    if (next.published.length !== previous.published.length
      || next.published.some((value, index) => value !== previous.published[index])) {
      recoveryFailure('Import transform rollback changed its original published prefix.');
    }
    if (!prefixDoesNotGrow(previous.outstanding, next.outstanding)) {
      recoveryFailure('Import transform outstanding rollback progress is invalid.');
    }
    if (next.publicationReasonCode !== previous.publicationReasonCode) {
      recoveryFailure('Import transform publication reason drifted during recovery.');
    }
  }
}

function parseLegacyJournalEntries(
  source: string,
  transactionId: string,
  files: readonly PreparedWrite[]
): readonly LegacyJournalEntry[] {
  const lines = journalLines(source, 'Import transform legacy journal',
    IMPORT_TRANSFORM_LEGACY_TERMINAL_MAX_BYTES);
  const result: LegacyJournalEntry[] = [];
  for (const line of lines) {
    const raw = asRecord(parseRecoveryJson(line, 'Import transform transaction journal entry'),
      'Import transform transaction journal entry');
    exactKeys(raw, ['files', 'formatVersion', 'outstanding', 'publicationReasonCode', 'published',
      'recoveryReasonCode', 'state', 'transactionId'], 'Import transform transaction journal entry');
    if (raw.formatVersion !== ImportTransformJournalFormat || raw.transactionId !== transactionId
      || typeof raw.state !== 'string' || !['prepared', 'publishing', 'accepted', 'rolling-back',
        'rolled-back', 'recovery-required'].includes(raw.state) || !Array.isArray(raw.files)) {
      recoveryFailure('Import transform transaction journal entry identity is invalid.');
    }
    if (raw.files.length !== files.length || raw.files.some((value, index) => {
      const recorded = asRecord(value, 'Import transform transaction journal file');
      exactKeys(recorded, ['expectedDigest', 'relativePath', 'replacementDigest'],
        'Import transform transaction journal file');
      return recorded.relativePath !== files[index]?.relativePath
        || recorded.expectedDigest !== files[index]?.expectedDigest
        || recorded.replacementDigest !== files[index]?.replacementDigest;
    })) recoveryFailure('Import transform transaction journal file set drifted.');
    const publicationReasonCode = raw.publicationReasonCode === null ? null
      : isPublicationReason(raw.publicationReasonCode) ? raw.publicationReasonCode
        : recoveryFailure('Import transform publication reason is invalid.');
    const recoveryReasonCode = raw.recoveryReasonCode === null ? null
      : isRecoveryReason(raw.recoveryReasonCode) ? raw.recoveryReasonCode
        : recoveryFailure('Import transform recovery reason is invalid.');
    const entry: LegacyJournalEntry = Object.freeze({
      formatVersion: ImportTransformJournalFormat,
      transactionId,
      state: raw.state as JournalState,
      files: Object.freeze(files.map((file) => Object.freeze({ relativePath: file.relativePath,
        expectedDigest: file.expectedDigest, replacementDigest: file.replacementDigest }))),
      published: exactPrefix(raw.published, files, 'Import transform published prefix'),
      outstanding: exactPrefix(raw.outstanding, files, 'Import transform outstanding prefix'),
      publicationReasonCode,
      recoveryReasonCode
    });
    validateLegacyJournalTransition(result.at(-1), entry, files);
    result.push(entry);
  }
  return Object.freeze(result);
}

/** v3 keeps the immutable plan in binding.json; each journal record is O(1). */
type CompactJournalEntry = Readonly<{
  formatVersion: typeof ImportTransformCompactJournalFormat;
  transactionId: string;
  bindingDigest: string;
  state: JournalState;
  publishedCount: number;
  outstandingCount: number;
  publicationReasonCode: PublicationReason | null;
  recoveryReasonCode: RecoveryReason | null;
}>;

function validateCompactJournalTransition(
  previous: CompactJournalEntry | undefined,
  next: CompactJournalEntry,
  fileCount: number
): void {
  const { state, publishedCount, outstandingCount } = next;
  if (next.formatVersion !== ImportTransformCompactJournalFormat || next.transactionId.length === 0
    || next.bindingDigest.length === 0 || !Number.isInteger(publishedCount)
    || !Number.isInteger(outstandingCount) || publishedCount < 0 || publishedCount > fileCount
    || outstandingCount < 0 || outstandingCount > publishedCount) {
    recoveryFailure('Import transform compact journal progress is invalid.');
  }
  const forward = state === 'prepared' || state === 'publishing' || state === 'accepted';
  const rollback = state === 'rolling-back' || state === 'rolled-back';
  if ((next.publicationReasonCode !== null && !isPublicationReason(next.publicationReasonCode))
    || (next.recoveryReasonCode !== null && !isRecoveryReason(next.recoveryReasonCode))
    || (forward
    ? outstandingCount !== 0 || next.publicationReasonCode !== null || next.recoveryReasonCode !== null
    : rollback
      ? next.publicationReasonCode === null || next.recoveryReasonCode !== null
      : next.publicationReasonCode === null || next.recoveryReasonCode === null)) {
    recoveryFailure('Import transform compact journal reasons/progress are invalid.');
  }
  if ((state === 'prepared' && (publishedCount !== 0 || outstandingCount !== 0))
    || (state === 'accepted' && (publishedCount !== fileCount || outstandingCount !== 0))
    || (state === 'rolled-back' && outstandingCount !== 0)) {
    recoveryFailure('Import transform compact terminal/progress counts are invalid.');
  }
  if (previous === undefined) {
    if (state !== 'prepared') {
      recoveryFailure('Import transform compact journal must begin prepared.');
    }
    return;
  }
  if (next.bindingDigest !== previous.bindingDigest) {
    recoveryFailure('Import transform compact journal plan binding drifted.');
  }
  const allowed = previous.state === 'prepared'
    ? state === 'publishing' || state === 'rolling-back' || state === 'recovery-required'
    : previous.state === 'publishing'
      ? state === 'publishing' || state === 'accepted' || state === 'rolling-back' || state === 'recovery-required'
      : previous.state === 'rolling-back'
        ? state === 'rolling-back' || state === 'rolled-back' || state === 'recovery-required'
        : false;
  if (!allowed) recoveryFailure('Import transform compact journal state sequence is invalid.');
  if (previous.state === 'rolling-back') {
    if (publishedCount !== previous.publishedCount || outstandingCount > previous.outstandingCount
      || next.publicationReasonCode !== previous.publicationReasonCode) {
      recoveryFailure('Import transform compact rollback progress is invalid.');
    }
  } else {
    if (publishedCount < previous.publishedCount || publishedCount > previous.publishedCount + 1) {
      recoveryFailure('Import transform compact published progress is not one monotonic edge.');
    }
  }
}

/** Append without reading prior records; recovery validates the chain once. */
async function appendCompactJournal(
  journalPath: string,
  transactionId: string,
  bindingDigest: string,
  previous: CompactJournalEntry | undefined,
  state: JournalState,
  publishedCount: number,
  outstandingCount: number,
  publicationReasonCode: PublicationReason | null,
  recoveryReasonCode: RecoveryReason | null,
  fileCount: number,
  testHooks: ImportTransformTransactionTestHooks,
  create: boolean = false
): Promise<CompactJournalEntry> {
  const entry: CompactJournalEntry = Object.freeze({
    formatVersion: ImportTransformCompactJournalFormat,
    transactionId,
    bindingDigest,
    state,
    publishedCount,
    outstandingCount,
    publicationReasonCode,
    recoveryReasonCode
  });
  validateCompactJournalTransition(previous, entry, fileCount);
  await testHooks.beforeJournalAppend?.(state);
  const encoded = `${JSON.stringify(canonicalJson(entry))}\n`;
  let existingBytes = 0;
  try {
    const metadata = await fs.lstat(journalPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      recoveryFailure('Import transform journal is not an ordinary file.');
    }
    existingBytes = metadata.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
  }
  if (existingBytes + Buffer.byteLength(encoded, 'utf8') > IMPORT_TRANSFORM_JOURNAL_MAX_BYTES) {
    recoveryFailure('Import transform journal exceeds the bounded byte limit.');
  }
  const handle = await fs.open(journalPath, create ? 'wx' : 'a');
  try {
    const opened = await handle.stat();
    if (opened.size !== existingBytes
      || opened.size + Buffer.byteLength(encoded, 'utf8') > IMPORT_TRANSFORM_JOURNAL_MAX_BYTES) {
      recoveryFailure('Import transform journal changed before append.');
    }
    await handle.writeFile(encoded, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (create) await syncDirectory(path.dirname(journalPath));
  return entry;
}

function parseCompactJournal(
  source: string,
  transactionId: string,
  fileCount: number,
  bindingDigest: string
): CompactJournalEntry {
  let previous: CompactJournalEntry | undefined;
  for (const line of journalLines(source, 'Import transform journal')) {
    const raw = asRecord(parseRecoveryJson(line, 'Import transform compact journal entry'),
      'Import transform compact journal entry');
    exactKeys(raw, ['bindingDigest', 'formatVersion', 'outstandingCount', 'publicationReasonCode',
      'publishedCount', 'recoveryReasonCode', 'state', 'transactionId'],
    'Import transform compact journal entry');
    if (raw.formatVersion !== ImportTransformCompactJournalFormat || raw.transactionId !== transactionId
      || typeof raw.state !== 'string' || !['prepared', 'publishing', 'accepted', 'rolling-back',
        'rolled-back', 'recovery-required'].includes(raw.state)
      || typeof raw.bindingDigest !== 'string' || raw.bindingDigest !== bindingDigest
      || typeof raw.publishedCount !== 'number'
      || typeof raw.outstandingCount !== 'number') {
      recoveryFailure('Import transform compact journal entry identity is invalid.');
    }
    const publicationReasonCode = raw.publicationReasonCode === null ? null
      : isPublicationReason(raw.publicationReasonCode) ? raw.publicationReasonCode
        : recoveryFailure('Import transform publication reason is invalid.');
    const recoveryReasonCode = raw.recoveryReasonCode === null ? null
      : isRecoveryReason(raw.recoveryReasonCode) ? raw.recoveryReasonCode
        : recoveryFailure('Import transform recovery reason is invalid.');
    const entry: CompactJournalEntry = Object.freeze({
      formatVersion: ImportTransformCompactJournalFormat,
      transactionId,
      bindingDigest: raw.bindingDigest,
      state: raw.state as JournalState,
      publishedCount: raw.publishedCount,
      outstandingCount: raw.outstandingCount,
      publicationReasonCode,
      recoveryReasonCode,
    });
    validateCompactJournalTransition(previous, entry, fileCount);
    previous = entry;
  }
  if (previous === undefined) recoveryFailure('Import transform transaction journal is empty.');
  return previous;
}

function recoveryFailure(message: string): never {
  throw new ImportTransformTransactionFailure('journal-failed', message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) recoveryFailure(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    recoveryFailure(`${label} has an unexpected shape.`);
  }
}

function skipJsonWhitespace(source: string, index: number): number {
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  return index;
}

function parseJsonStringToken(
  source: string,
  start: number,
  label: string
): readonly [value: string, nextIndex: number] {
  let index = start + 1;
  while (index < source.length) {
    const character = source[index]!;
    if (character === '"') {
      try {
        return Object.freeze([JSON.parse(source.slice(start, index + 1)) as string, index + 1]);
      } catch {
        break;
      }
    }
    if (character === '\\') {
      index += source[index + 1] === 'u' ? 6 : 2;
      continue;
    }
    if (character.charCodeAt(0) < 0x20) break;
    index += 1;
  }
  recoveryFailure(label + ' contains an invalid JSON string.');
}

function scanJsonValue(source: string, start: number, label: string): number {
  const index = skipJsonWhitespace(source, start);
  const character = source[index];
  if (character === '"') return parseJsonStringToken(source, index, label)[1];
  if (character === '[') {
    let next = skipJsonWhitespace(source, index + 1);
    if (source[next] === ']') return next + 1;
    while (true) {
      next = scanJsonValue(source, next, label);
      next = skipJsonWhitespace(source, next);
      if (source[next] === ']') return next + 1;
      if (source[next] !== ',') recoveryFailure(label + ' contains an invalid JSON array.');
      next = skipJsonWhitespace(source, next + 1);
    }
  }
  if (character === '{') {
    const keys = new Set<string>();
    let next = skipJsonWhitespace(source, index + 1);
    if (source[next] === '}') return next + 1;
    while (true) {
      if (source[next] !== '"') recoveryFailure(label + ' contains an invalid JSON object key.');
      const [key, afterKey] = parseJsonStringToken(source, next, label);
      if (keys.has(key)) recoveryFailure(label + ' contains a duplicate object key.');
      keys.add(key);
      next = skipJsonWhitespace(source, afterKey);
      if (source[next] !== ':') recoveryFailure(label + ' contains an invalid JSON object.');
      next = scanJsonValue(source, next + 1, label);
      next = skipJsonWhitespace(source, next);
      if (source[next] === '}') return next + 1;
      if (source[next] !== ',') recoveryFailure(label + ' contains an invalid JSON object.');
      next = skipJsonWhitespace(source, next + 1);
    }
  }
  const literal = source.slice(index);
  const match = literal.match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u);
  if (match === null) recoveryFailure(label + ' contains an invalid JSON value.');
  return index + match[0].length;
}

function parseRecoveryJson(source: string, label: string): unknown {
  try {
    const end = skipJsonWhitespace(source, scanJsonValue(source, 0, label));
    if (end !== source.length) recoveryFailure(label + ' contains trailing JSON data.');
    return JSON.parse(source) as unknown;
  } catch (error) {
    if (error instanceof ImportTransformTransactionFailure) throw error;
    recoveryFailure(label + ' is not valid JSON.');
  }
}

function decodeRecoveryUtf8(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    recoveryFailure(label + ' is not valid UTF-8.');
  }
}

function journalLines(
  source: string,
  label: string,
  maximumBytes: number = IMPORT_TRANSFORM_JOURNAL_MAX_BYTES
): readonly string[] {
  if (Buffer.byteLength(source, 'utf8') > maximumBytes) {
    recoveryFailure(label + ' exceeds the bounded journal byte limit.');
  }
  const lines = source.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.some((line) => line.length === 0)
    || lines.length > IMPORT_TRANSFORM_JOURNAL_MAX_RECORDS) {
    recoveryFailure(label + ' exceeds the bounded journal record limit or contains an empty record.');
  }
  return Object.freeze(lines);
}

async function repairJournalTail(
  journalPath: string,
  offset: number,
  assertLease: () => Promise<void>,
  expectedIdentity: Readonly<{ readonly dev: number; readonly ino: number; readonly size: number }>
): Promise<void> {
  await assertLease();
  const handle = await fs.open(journalPath, 'r+');
  try {
    const before = await handle.stat();
    const current = await fs.lstat(journalPath);
    if (before.dev !== expectedIdentity.dev || before.ino !== expectedIdentity.ino
      || current.dev !== expectedIdentity.dev || current.ino !== expectedIdentity.ino
      || before.size !== expectedIdentity.size || current.size !== expectedIdentity.size
      || before.size < offset || current.size < offset) {
      recoveryFailure('Import transform journal tail physical identity drifted.');
    }
    await assertLease();
    await handle.truncate(offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(journalPath));
}

async function readRegularTransactionArtifact(
  filePath: string,
  label: string,
  maximumBytes?: number
): Promise<Buffer> {
  const metadata = await fs.lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) recoveryFailure(label + ' is not an ordinary file.');
  if (maximumBytes !== undefined && metadata.size > maximumBytes) {
    recoveryFailure(label + ' exceeds its bounded byte limit.');
  }
  const bytes = await fs.readFile(filePath);
  if (maximumBytes !== undefined && bytes.byteLength > maximumBytes) {
    recoveryFailure(label + ' exceeds its bounded byte limit.');
  }
  return bytes;
}

async function digestRegularTransactionArtifact(
  filePath: string,
  label: string,
  maximumBytes: number
): Promise<Readonly<{ digest: string; bytes: number }>> {
  const metadata = await fs.lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) recoveryFailure(label + ' is not an ordinary file.');
  if (metadata.size > maximumBytes) recoveryFailure(label + ' exceeds its bounded byte limit.');
  const handle = await fs.open(filePath, 'r');
  const hash = createSha256Hasher();
  let offset = 0;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino
      || opened.size !== metadata.size) {
      recoveryFailure(label + ' changed before retained digest readback.');
    }
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (offset < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
      if (bytesRead === 0) recoveryFailure(label + ' ended before its retained byte count.');
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    const current = await fs.lstat(filePath);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || current.dev !== opened.dev || current.ino !== opened.ino || current.size !== opened.size) {
      recoveryFailure(label + ' changed during retained digest readback.');
    }
  } finally {
    await handle.close();
  }
  return Object.freeze({ digest: hash.finish().slice('sha256:'.length), bytes: offset });
}

function parseTerminalReceipt(
  source: string,
  transactionId: string,
  bindingDigest: string,
  fileCount: number
): ImportTransformTerminalReceipt {
  const raw = asRecord(parseRecoveryJson(source, 'Import transform terminal receipt'),
    'Import transform terminal receipt');
  exactKeys(raw, ['bindingDigest', 'formatVersion', 'journalBytes', 'journalDigest', 'journalFormat',
    'publicationReasonCode', 'publishedCount', 'state', 'transactionId'], 'Import transform terminal receipt');
  if (raw.formatVersion !== ImportTransformTerminalReceiptFormat || raw.transactionId !== transactionId
    || raw.bindingDigest !== bindingDigest || raw.journalFormat !== ImportTransformJournalFormat
    || typeof raw.journalDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(raw.journalDigest)
    || typeof raw.journalBytes !== 'number' || !Number.isSafeInteger(raw.journalBytes)
    || raw.journalBytes <= 0 || raw.journalBytes > IMPORT_TRANSFORM_LEGACY_TERMINAL_MAX_BYTES
    || typeof raw.publishedCount !== 'number' || !Number.isSafeInteger(raw.publishedCount)
    || raw.publishedCount < 0 || raw.publishedCount > fileCount
    || (raw.state !== 'accepted' && raw.state !== 'rolled-back')) {
    recoveryFailure('Import transform terminal receipt identity is invalid.');
  }
  const publicationReasonCode = raw.publicationReasonCode === null ? null
    : isPublicationReason(raw.publicationReasonCode) ? raw.publicationReasonCode
      : recoveryFailure('Import transform terminal receipt publication reason is invalid.');
  if ((raw.state === 'accepted' && (raw.publishedCount !== fileCount || publicationReasonCode !== null))
    || (raw.state === 'rolled-back' && publicationReasonCode === null)) {
    recoveryFailure('Import transform terminal receipt state is invalid.');
  }
  return Object.freeze({
    formatVersion: ImportTransformTerminalReceiptFormat,
    transactionId,
    bindingDigest,
    journalFormat: ImportTransformJournalFormat,
    journalDigest: raw.journalDigest,
    journalBytes: raw.journalBytes,
    state: raw.state,
    publishedCount: raw.publishedCount,
    publicationReasonCode
  });
}

async function readOptionalTerminalReceipt(
  receiptPath: string,
  transactionId: string,
  bindingDigest: string,
  fileCount: number
): Promise<ImportTransformTerminalReceipt | null> {
  try {
    const bytes = await readRegularTransactionArtifact(receiptPath, 'Import transform terminal receipt', 4096);
    return parseTerminalReceipt(decodeRecoveryUtf8(bytes, 'Import transform terminal receipt'),
      transactionId, bindingDigest, fileCount);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeLegacyTerminalReceipt(
  receiptPath: string,
  transactionId: string,
  bindingDigest: string,
  journalBytes: Buffer,
  terminal: LegacyJournalEntry,
  assertLease: () => Promise<void>
): Promise<void> {
  if (terminal.state !== 'accepted' && terminal.state !== 'rolled-back') {
    recoveryFailure('Only a terminal legacy journal can issue a compact settlement receipt.');
  }
  await assertLease();
  const receipt: ImportTransformTerminalReceipt = Object.freeze({
    formatVersion: ImportTransformTerminalReceiptFormat,
    transactionId,
    bindingDigest,
    journalFormat: ImportTransformJournalFormat,
    journalDigest: rawSha256Hex(journalBytes),
    journalBytes: journalBytes.byteLength,
    state: terminal.state,
    publishedCount: terminal.published.length,
    publicationReasonCode: terminal.publicationReasonCode
  });
  await writeDurable(receiptPath, `${JSON.stringify(canonicalJson(receipt))}\n`);
}

async function readUnfinishedTransaction(
  workspaceRoot: string,
  transactionRoot: string,
  transactionId: string,
  assertLease: () => Promise<void>
): Promise<RecoveredTransaction> {
  const journalPath = path.join(transactionRoot, 'journal.jsonl');
  const bindingPath = path.join(transactionRoot, 'binding.json');
  await assertLease();
  await assertOrdinaryContainedTargetChain(workspaceRoot, bindingPath);
  const bindingBytes = await readRegularTransactionArtifact(bindingPath, 'Import transform transaction binding',
    IMPORT_TRANSFORM_JOURNAL_MAX_BYTES);
  const binding = asRecord(parseRecoveryJson(decodeRecoveryUtf8(bindingBytes, 'Import transform transaction binding'),
    'Import transform transaction binding'), 'Import transform transaction binding');
  exactKeys(binding, ['formatVersion', 'transactionId', 'workspaceRoot', 'writes'], 'Import transform transaction binding');
  if (binding.formatVersion !== ImportTransformBindingFormat || binding.transactionId !== transactionId
    || typeof binding.workspaceRoot !== 'string' || path.resolve(binding.workspaceRoot) !== workspaceRoot
    || !Array.isArray(binding.writes) || binding.writes.length === 0
    || binding.writes.length > IMPORT_TRANSFORM_JOURNAL_MAX_RECORDS) {
    recoveryFailure('Import transform transaction binding identity is invalid.');
  }
  const bindingDigest = rawSha256Hex(bindingBytes);
  const seen = new Set<string>();
  const files: PreparedWrite[] = [];
  for (const rawWrite of binding.writes) {
    const write = asRecord(rawWrite, 'Import transform transaction binding write');
    exactKeys(write, ['expectedDigest', 'mode', 'preimageCandidateRelativePath', 'relativePath',
      'replacementCandidateRelativePath', 'replacementDigest'],
      'Import transform transaction binding write');
    if (typeof write.relativePath !== 'string' || write.relativePath !== write.relativePath.replaceAll('\\', '/')
      || seen.has(write.relativePath) || typeof write.expectedDigest !== 'string' || typeof write.replacementDigest !== 'string'
      || typeof write.preimageCandidateRelativePath !== 'string'
      || typeof write.replacementCandidateRelativePath !== 'string'
      || typeof write.mode !== 'number' || !Number.isInteger(write.mode) || write.mode < 0 || write.mode > 0o777) {
      recoveryFailure('Import transform transaction binding write is invalid.');
    }
    seen.add(write.relativePath);
    const absolutePath = containedFile(workspaceRoot, write.relativePath);
    const preimageCandidatePath = importTransformCandidatePath(absolutePath, transactionId, 'preimage');
    const replacementCandidatePath = importTransformCandidatePath(absolutePath, transactionId, 'replacement');
    const candidateRelative = (candidatePath: string) => path.relative(workspaceRoot, candidatePath).replaceAll('\\', '/');
    if (write.preimageCandidateRelativePath !== candidateRelative(preimageCandidatePath)
      || write.replacementCandidateRelativePath !== candidateRelative(replacementCandidatePath)) {
      recoveryFailure('Import transform transaction candidate binding is invalid.');
    }
    const stem = rawSha256Hex(write.relativePath);
    const preimagePath = path.join(transactionRoot, `${stem}.preimage`);
    const replacementPath = path.join(transactionRoot, `${stem}.replacement`);
    await assertOrdinaryContainedTargetChain(workspaceRoot, preimagePath);
    await assertOrdinaryContainedTargetChain(workspaceRoot, replacementPath);
    const expectedBytes = await readRegularTransactionArtifact(preimagePath,
      'Import transform transaction preimage');
    const replacementBytes = await readRegularTransactionArtifact(replacementPath,
      'Import transform transaction replacement');
    if (rawSha256Hex(expectedBytes) !== write.expectedDigest || rawSha256Hex(replacementBytes) !== write.replacementDigest) {
      recoveryFailure('Import transform transaction artifact digest is invalid.');
    }
    files.push(Object.freeze({
      relativePath: write.relativePath, absolutePath, preimageCandidatePath, replacementCandidatePath,
      expectedBytes, replacementBytes,
      expectedDigest: write.expectedDigest, replacementDigest: write.replacementDigest, mode: write.mode
    }));
  }
  const terminalReceiptPath = path.join(transactionRoot, 'terminal-receipt.json');
  const allowedArtifacts = new Set<string>(['binding.json', 'journal.jsonl', 'terminal-receipt.json']);
  for (const file of files) {
    const stem = rawSha256Hex(file.relativePath);
    allowedArtifacts.add(stem + '.preimage');
    allowedArtifacts.add(stem + '.replacement');
  }
  let transactionArtifacts: Dirent[];
  try {
    transactionArtifacts = await fs.readdir(transactionRoot, { withFileTypes: true }) as Dirent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      recoveryFailure('Import transform transaction root is missing.');
    }
    throw error;
  }
  for (const artifact of transactionArtifacts) {
    if (!artifact.isFile() || artifact.isSymbolicLink() || !allowedArtifacts.has(artifact.name)) {
      recoveryFailure('Import transform transaction contains unknown or non-regular residue.');
    }
  }
  const terminalReceipt = await readOptionalTerminalReceipt(terminalReceiptPath,
    transactionId, bindingDigest, files.length);
  if (terminalReceipt !== null) {
    const journalIdentity = await digestRegularTransactionArtifact(journalPath,
      'Import transform legacy terminal journal', IMPORT_TRANSFORM_LEGACY_TERMINAL_MAX_BYTES);
    if (journalIdentity.digest !== terminalReceipt.journalDigest
      || journalIdentity.bytes !== terminalReceipt.journalBytes) {
      recoveryFailure('Import transform legacy terminal journal drifted from its settlement receipt.');
    }
    return Object.freeze({
      transactionId,
      journalPath,
      files: Object.freeze(files),
      journalFormat: 'legacy' as const,
      bindingDigest,
      compactJournalTail: null,
      journalWasMissing: false,
      state: terminalReceipt.state,
      published: Object.freeze(files.slice(0, terminalReceipt.publishedCount).map((file) => file.relativePath)),
      outstanding: Object.freeze([]),
      publicationReasonCode: terminalReceipt.publicationReasonCode,
      recoveryReasonCode: null
    });
  }
  let journalBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let journalWasMissing = false;
  let journalIdentity: { readonly dev: number; readonly ino: number; readonly size: number } | undefined;
  try {
    await assertOrdinaryContainedTargetChain(workspaceRoot, journalPath);
    const metadata = await fs.lstat(journalPath);
    journalIdentity = { dev: metadata.dev, ino: metadata.ino, size: metadata.size };
    journalBytes = await readRegularTransactionArtifact(journalPath, 'Import transform transaction journal',
      IMPORT_TRANSFORM_LEGACY_TERMINAL_MAX_BYTES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') journalWasMissing = true;
    else throw error;
  }
  const journalSource = decodeRecoveryUtf8(journalBytes, 'Import transform transaction journal');
  const journalRepairOffset = journalBytes.length > 0 && journalBytes[journalBytes.length - 1] !== 0x0a
    ? journalBytes.lastIndexOf(0x0a) + 1 : null;
  const completeJournalSource = journalRepairOffset === null ? journalSource
    : journalBytes.subarray(0, journalRepairOffset).toString('utf8');
  const firstLine = completeJournalSource.split('\n').find((line) => line.length > 0);
  if (firstLine === undefined) {
    // A missing/empty/torn-only journal has no legacy grammar to relax; the only
    // safe interpretation is pre-publication, followed by an explicit compact
    // prepared record before any recovery decision.
    if (journalRepairOffset !== null) {
      if (journalIdentity === undefined) recoveryFailure('Import transform journal tail has no physical identity.');
      await repairJournalTail(journalPath, journalRepairOffset, assertLease, journalIdentity);
    }
    return Object.freeze({ transactionId, journalPath, files: Object.freeze(files), journalFormat: 'compact' as const,
      bindingDigest, compactJournalTail: null, journalWasMissing,
      state: 'prepared' as const, published: Object.freeze([]), outstanding: Object.freeze([]),
      publicationReasonCode: null, recoveryReasonCode: null });
  }
  const firstEntry = asRecord(parseRecoveryJson(firstLine, 'Import transform transaction journal'),
    'Import transform transaction journal');
  const journalFormat = firstEntry.formatVersion === ImportTransformCompactJournalFormat ? 'compact' as const
    : firstEntry.formatVersion === ImportTransformJournalFormat ? 'legacy' as const
      : recoveryFailure('Import transform transaction journal format is unsupported.');
  if (journalFormat === 'compact' && journalBytes.byteLength > IMPORT_TRANSFORM_JOURNAL_MAX_BYTES) {
    recoveryFailure('Import transform compact journal exceeds its bounded byte limit.');
  }
  if (journalFormat === 'legacy') {
    // The legacy journal grammar is bounded and read-only; new writers emit only the compact grammar.
    if (journalRepairOffset !== null) recoveryFailure('Import transform legacy journal has a partial final line.');
    const journal = parseLegacyJournalEntries(completeJournalSource, transactionId, files);
    const last = journal.at(-1);
    if (last === undefined) recoveryFailure('Import transform transaction journal is empty.');
    if (last.state === 'accepted' || last.state === 'rolled-back') {
      await writeLegacyTerminalReceipt(terminalReceiptPath, transactionId, bindingDigest,
        journalBytes, last, assertLease);
      const readback = await readOptionalTerminalReceipt(terminalReceiptPath,
        transactionId, bindingDigest, files.length);
      if (readback === null || readback.journalDigest !== rawSha256Hex(journalBytes)
        || readback.journalBytes !== journalBytes.byteLength || readback.state !== last.state) {
        recoveryFailure('Import transform terminal receipt readback failed.');
      }
    }
    return Object.freeze({ transactionId, journalPath, files: Object.freeze(files), journalFormat, bindingDigest,
      compactJournalTail: null, journalWasMissing,
      state: last.state, published: last.published, outstanding: last.outstanding,
      publicationReasonCode: last.publicationReasonCode, recoveryReasonCode: last.recoveryReasonCode });
  }
  const last = parseCompactJournal(completeJournalSource, transactionId, files.length, bindingDigest);
  if (journalRepairOffset !== null) {
    if (journalIdentity === undefined) recoveryFailure('Import transform journal tail has no physical identity.');
    await repairJournalTail(journalPath, journalRepairOffset, assertLease, journalIdentity);
  }
  const published = Object.freeze(files.slice(0, last.publishedCount).map((file) => file.relativePath));
  const outstanding = Object.freeze(files.slice(0, last.outstandingCount).map((file) => file.relativePath));
  return Object.freeze({ transactionId, journalPath, files: Object.freeze(files), journalFormat, bindingDigest,
    compactJournalTail: last, journalWasMissing,
    state: last.state, published, outstanding,
    publicationReasonCode: last.publicationReasonCode, recoveryReasonCode: last.recoveryReasonCode });
}

async function currentTransactionFileState(file: PreparedWrite): Promise<'preimage' | 'replacement' | 'other'> {
  const metadata = await fs.lstat(file.absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== file.mode) return 'other';
  const bytes = await fs.readFile(file.absolutePath);
  if (bytes.equals(file.expectedBytes)) return 'preimage';
  if (bytes.equals(file.replacementBytes)) return 'replacement';
  return 'other';
}

async function observeReplacementPrefix(files: readonly PreparedWrite[]): Promise<readonly PreparedWrite[]> {
  const replacements: PreparedWrite[] = [];
  let observedPreimage = false;
  for (const file of files) {
    const state = await currentTransactionFileState(file);
    if (state === 'replacement') {
      if (observedPreimage) throw new ImportTransformTransactionFailure('preimage-conflict',
        'Import transform physical replacement set is not an exact prefix.');
      replacements.push(file);
    } else if (state === 'preimage') observedPreimage = true;
    else throw new ImportTransformTransactionFailure('preimage-conflict',
      `Import transform physical target drifted: ${file.relativePath}`);
  }
  return Object.freeze(replacements);
}

async function observePublishedPrefixAfterFailure(
  files: readonly PreparedWrite[],
  journalPublishedCount: number,
  strictUnpublished: boolean = false
): Promise<readonly PreparedWrite[]> {
  const result: PreparedWrite[] = [];
  for (let index = 0; index < journalPublishedCount; index += 1) {
    const file = files[index]!;
    if ((await currentTransactionFileState(file)) !== 'replacement') {
      throw new ImportTransformTransactionFailure('preimage-conflict',
        `Import transform already-published target drifted: ${file.relativePath}`);
    }
    result.push(file);
  }
  const possibleUnjournaled = files[journalPublishedCount];
  if (possibleUnjournaled !== undefined) {
    const state = await currentTransactionFileState(possibleUnjournaled);
    if (state === 'replacement') result.push(possibleUnjournaled);
    else if (strictUnpublished && state === 'other') {
      throw new ImportTransformTransactionFailure('preimage-conflict',
        `Import transform unpublished target drifted: ${possibleUnjournaled.relativePath}`);
    } else if (state === 'other'
      && (await fs.readFile(possibleUnjournaled.absolutePath)).equals(possibleUnjournaled.replacementBytes)) {
      throw new ImportTransformTransactionFailure('preimage-conflict',
        `Import transform unjournaled replacement metadata drifted: ${possibleUnjournaled.relativePath}`);
    }
  }
  if (strictUnpublished) {
    for (let index = journalPublishedCount + 1; index < files.length; index += 1) {
      const file = files[index]!;
      if ((await currentTransactionFileState(file)) !== 'preimage') {
        throw new ImportTransformTransactionFailure('preimage-conflict',
          `Import transform unpublished target drifted: ${file.relativePath}`);
      }
    }
  }
  return Object.freeze(result);
}

async function reconcileUnfinishedImportTransactions(
  workspaceRoot: string,
  assertLease: () => Promise<void>,
  testHooks: ImportTransformTransactionTestHooks
): Promise<Extract<ImportTransformTransactionOutcome, { status: 'recovery-required' }> | undefined> {
  const transactionsRoot = path.join(resolveWorkspaceLocalStateRoot(workspaceRoot), 'import-transform-transactions');
  let entries: Dirent[];
  try { entries = await fs.readdir(transactionsRoot, { withFileTypes: true }) as Dirent[]; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return recoveryRequiredOutcome('unreadable', transactionsRoot, 'journal-failed');
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return recoveryRequiredOutcome(entry.name, path.join(transactionsRoot, entry.name), 'journal-failed');
    }
    const transactionRoot = path.join(transactionsRoot, entry.name);
    let transaction: RecoveredTransaction;
    try {
      transaction = await readUnfinishedTransaction(workspaceRoot, transactionRoot, entry.name,
        assertLease);
    } catch (error) {
      return recoveryRequiredOutcome(entry.name, path.join(transactionRoot, 'journal.jsonl'), 'journal-failed');
    }
    // A terminal journal is immutable evidence, not an active lease on the
    // transformed target. It is still read and shape-checked before it is
    // ignored; an orphan marker or missing journal can never bypass recovery.
    if (transaction.state === 'accepted' || transaction.state === 'rolled-back') {
      continue;
    }
    // The legacy journal grammar is a read-only migration/recovery input. There is no legacy
    // append path: an unfinished transaction blocks until a dedicated
    // migration owner rewrites it under its own lease.
    if (transaction.journalFormat === 'legacy') {
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'journal-failed',
        transaction.outstanding);
    }
    let compactJournalTail = transaction.compactJournalTail;
    try {
      if (transaction.journalFormat === 'compact' && transaction.compactJournalTail === null) {
        compactJournalTail = await appendCompactJournal(transaction.journalPath, transaction.transactionId,
          transaction.bindingDigest, undefined, 'prepared', 0, 0, null, null, transaction.files.length,
          testHooks, transaction.journalWasMissing);
      }
    } catch {
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'journal-failed');
    }
    const appendProgress = async (
      state: Extract<JournalState, 'rolling-back' | 'rolled-back' | 'recovery-required'>,
      published: readonly string[],
      outstanding: readonly PreparedWrite[] | readonly string[],
      publicationReasonCode: PublicationReason,
      recoveryReasonCode: RecoveryReason | null
    ): Promise<boolean> => {
      const outstandingPaths = outstanding.length === 0 || typeof outstanding[0] === 'string'
        ? outstanding as readonly string[] : (outstanding as readonly PreparedWrite[]).map((file) => file.relativePath);
      return appendCompactJournal(transaction.journalPath, transaction.transactionId,
        transaction.bindingDigest, compactJournalTail ?? undefined, state, published.length, outstandingPaths.length,
        publicationReasonCode, recoveryReasonCode, transaction.files.length, testHooks).then((next) => {
          compactJournalTail = next;
          return true;
        }, () => false);
    };
    try {
      for (const file of transaction.files) {
        await assertLease();
        await reconcileCandidateArtifact(workspaceRoot, file.preimageCandidatePath, file.expectedBytes, file.mode);
        await reconcileCandidateArtifact(workspaceRoot, file.replacementCandidatePath, file.replacementBytes, file.mode);
      }
    } catch {
      let physicalOutstanding = transaction.journalFormat === 'compact' && transaction.state === 'publishing'
        ? transaction.published : transaction.outstanding;
      try {
        const replacements = transaction.journalFormat === 'compact' && transaction.state === 'publishing'
          ? await observePublishedPrefixAfterFailure(transaction.files, transaction.published.length, true)
          : await observeReplacementPrefix(transaction.files);
        physicalOutstanding = Object.freeze(replacements
          .map((file) => file.relativePath));
      } catch {
        // Preserve the last durable exact set when target state is itself ambiguous.
      }
      if (transaction.state === 'prepared' || transaction.state === 'publishing'
        || transaction.state === 'rolling-back') {
        const publicationReason = transaction.publicationReasonCode ?? 'publication-failed';
        const published = transaction.state === 'rolling-back' ? transaction.published : physicalOutstanding;
        await appendProgress('recovery-required', published, physicalOutstanding,
          publicationReason, 'rollback-conflict');
      }
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'rollback-conflict',
        physicalOutstanding);
    }
    if (transaction.state === 'recovery-required') {
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath,
        transaction.recoveryReasonCode ?? 'journal-failed', transaction.outstanding);
    }
    let replacements: readonly PreparedWrite[] = transaction.journalFormat === 'compact' && transaction.state === 'publishing'
      ? transaction.files.slice(0, transaction.published.length) : [];
    let outstanding: PreparedWrite[] = [];
    const publicationReason = transaction.publicationReasonCode ?? 'publication-failed';
    try {
      for (const file of transaction.files) {
        await assertLease();
        await assertOrdinaryContainedTargetChain(workspaceRoot, file.absolutePath);
      }
      replacements = transaction.journalFormat === 'compact' && transaction.state === 'publishing'
        ? await observePublishedPrefixAfterFailure(transaction.files, transaction.published.length, true)
        : await observeReplacementPrefix(transaction.files);
      const published = transaction.state === 'rolling-back' ? transaction.published
        : replacements.map((file) => file.relativePath);
      outstanding = [...replacements];
      let journalFailed = !(await appendProgress('rolling-back', published,
        outstanding, publicationReason, null));
      for (const file of [...outstanding].reverse()) {
        await assertLease();
        await assertOrdinaryContainedTargetChain(workspaceRoot, file.absolutePath);
        if ((await currentTransactionFileState(file)) !== 'replacement') {
          throw new ImportTransformTransactionFailure('preimage-conflict',
            `Import transform recovery replacement drifted: ${file.relativePath}`);
        }
        await replaceDurable(workspaceRoot, file.absolutePath, file.replacementBytes, file.expectedBytes, file.mode,
          file.preimageCandidatePath, assertLease, testHooks);
        await assertOrdinaryContainedTargetChain(workspaceRoot, file.absolutePath);
        if ((await currentTransactionFileState(file)) !== 'preimage') {
          throw new ImportTransformTransactionFailure('rollback-failed',
            `Import transform recovery rollback readback failed: ${file.relativePath}`);
        }
        outstanding.pop();
        if (!journalFailed && !(await appendProgress('rolling-back', published,
          outstanding, publicationReason, null))) {
          journalFailed = true;
        }
      }
      if (journalFailed) {
        await appendProgress('recovery-required', published,
          outstanding, publicationReason, 'journal-failed');
        return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'journal-failed',
          outstanding.map((entry) => entry.relativePath));
      }
      if (!(await appendProgress('rolled-back', published, [], publicationReason, null))) {
        await appendProgress('recovery-required', published, [], publicationReason, 'journal-failed');
        return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'journal-failed');
      }
    } catch (error) {
      const reasonCode = error instanceof ImportTransformTransactionFailure && error.reasonCode === 'preimage-conflict'
        ? 'rollback-conflict' as const : 'rollback-failed' as const;
      const published = transaction.state === 'rolling-back' ? transaction.published
        : replacements.map((file) => file.relativePath);
      const recoveryOutstanding = outstanding.length > 0 ? outstanding : [...replacements];
      await appendProgress('recovery-required', published,
        recoveryOutstanding, publicationReason, reasonCode);
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, reasonCode,
        recoveryOutstanding.map((file) => file.relativePath));
    }
  }
  return undefined;
}

async function prepareWrites(
  workspaceRoot: string,
  writes: readonly ImportTransformWrite[],
  transactionId: string
): Promise<readonly PreparedWrite[]> {
  const seen = new Set<string>();
  const prepared: PreparedWrite[] = [];
  for (const write of writes) {
    const relativePath = write.relativePath.replaceAll('\\', '/');
    if (seen.has(relativePath)) {
      throw new CompilerError('IMPORT-TRANSFORM-003', `Duplicate import transform target: ${relativePath}`, {
        relativePath
      });
    }
    seen.add(relativePath);
    const absolutePath = containedFile(workspaceRoot, relativePath);
    await assertOrdinaryContainedTargetChain(workspaceRoot, absolutePath);
    const metadata = await fs.lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new CompilerError('IMPORT-TRANSFORM-002', `Transform target is not a regular file: ${absolutePath}`, {
        filePath: absolutePath
      });
    }
    const preimageCandidatePath = importTransformCandidatePath(absolutePath, transactionId, 'preimage');
    const replacementCandidatePath = importTransformCandidatePath(absolutePath, transactionId, 'replacement');
    prepared.push(Object.freeze({
      relativePath,
      absolutePath,
      preimageCandidatePath,
      replacementCandidatePath,
      expectedBytes: Buffer.from(write.expectedBytes),
      replacementBytes: Buffer.from(write.replacementBytes),
      expectedDigest: rawSha256Hex(write.expectedBytes),
      replacementDigest: rawSha256Hex(write.replacementBytes),
      mode: metadata.mode & 0o777
    }));
  }
  return Object.freeze(prepared);
}

async function assertPreimages(
  workspaceRoot: string,
  files: readonly PreparedWrite[]
): Promise<void> {
  for (const file of files) {
    await assertOrdinaryContainedTargetChain(workspaceRoot, file.absolutePath);
    const metadata = await fs.lstat(file.absolutePath);
    const current = await fs.readFile(file.absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== file.mode
      || !current.equals(file.expectedBytes)) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Import transform preimage changed before publication: ${file.relativePath}`
      );
    }
  }
}

async function assertFinalWriteSet(workspaceRoot: string, files: readonly PreparedWrite[]): Promise<void> {
  const rootRealPath = await fs.realpath(workspaceRoot);
  for (const file of files) {
    await assertOrdinaryContainedTargetChain(workspaceRoot, file.absolutePath);
    const metadata = await fs.lstat(file.absolutePath);
    const targetRealPath = await fs.realpath(file.absolutePath);
    const relativeToRoot = path.relative(rootRealPath, targetRealPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()
      || relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeToRoot) || (metadata.mode & 0o777) !== file.mode
      || !(await fs.readFile(file.absolutePath)).equals(file.replacementBytes)) {
      throw new ImportTransformTransactionFailure(
        'readback-failed',
        `Import transform final write-set readback failed for ${file.relativePath}`
      );
    }
  }
}

export async function publishImportTransformTransaction(
  workspaceRoot: string,
  writes: readonly ImportTransformWrite[],
  testHooks: ImportTransformTransactionTestHooks = {}
): Promise<ImportTransformTransactionOutcome> {
  if (writes.length === 0) {
    throw new CompilerError('IMPORT-TRANSFORM-003', 'Import transform transaction requires a non-empty write set');
  }
  if (writes.length * 2 + 4 > IMPORT_TRANSFORM_JOURNAL_MAX_RECORDS) {
    throw new CompilerError('IMPORT-TRANSFORM-003', 'Import transform transaction exceeds the bounded record limit', {
      writeCount: writes.length,
      maximumRecords: IMPORT_TRANSFORM_JOURNAL_MAX_RECORDS
    });
  }
  const root = path.resolve(workspaceRoot);
  const transactionId = randomUUID();
  const transactionRoot = path.join(resolveWorkspaceLocalStateRoot(root), 'import-transform-transactions', transactionId);
  const journalPath = path.join(transactionRoot, 'journal.jsonl');
  const published: PreparedWrite[] = [];
  let bindingDigest = '';
  let compactJournalTail: CompactJournalEntry | undefined;
  let inFlightPublication: PreparedWrite | null = null;
  let inFlightPublicationRenamed = false;

  return withWorkspaceWriteLease(root, undefined, async (lease) => {
    await assertWorkspaceWriteLease(root, lease);
    const unfinished = await reconcileUnfinishedImportTransactions(root,
      () => assertWorkspaceWriteLease(root, lease), testHooks);
    if (unfinished !== undefined) return unfinished;
    // No new preimage observation or transaction directory creation occurs
    // until every durable unfinished publication is reconciled under this lease.
    const prepared = await prepareWrites(root, writes, transactionId);
    const appendCompactProgress = async (
      state: JournalState,
      publishedCount: number,
      outstandingCount: number,
      publicationReasonCode: PublicationReason | null = null,
      recoveryReasonCode: RecoveryReason | null = null,
      create: boolean = false
    ): Promise<void> => {
      compactJournalTail = await appendCompactJournal(journalPath, transactionId, bindingDigest,
        compactJournalTail, state, publishedCount, outstandingCount, publicationReasonCode,
        recoveryReasonCode, prepared.length, testHooks, create);
    };
    try {
      await ensureDir(transactionRoot);
      await syncDirectory(root);
      await syncDirectory(path.dirname(path.dirname(transactionRoot)));
      await syncDirectory(path.dirname(transactionRoot));
      await syncDirectory(transactionRoot);
      for (const file of prepared) {
        const stem = rawSha256Hex(file.relativePath);
        await writeDurable(path.join(transactionRoot, `${stem}.preimage`), file.expectedBytes);
        await writeDurable(path.join(transactionRoot, `${stem}.replacement`), file.replacementBytes);
      }
      const bindingBytes = `${JSON.stringify(canonicalJson({
        formatVersion: ImportTransformBindingFormat,
        transactionId,
        workspaceRoot: root,
        writes: prepared.map((file) => ({
          relativePath: file.relativePath,
          preimageCandidateRelativePath: path.relative(root, file.preimageCandidatePath).replaceAll('\\', '/'),
          replacementCandidateRelativePath: path.relative(root, file.replacementCandidatePath).replaceAll('\\', '/'),
          expectedDigest: file.expectedDigest,
          replacementDigest: file.replacementDigest,
          mode: file.mode
        }))
      }))}\n`;
      bindingDigest = rawSha256Hex(bindingBytes);
      await writeDurable(path.join(transactionRoot, 'binding.json'), bindingBytes);
      await appendCompactProgress('prepared', 0, 0, null, null, true);
    } catch {
      // A partially durable transaction root is deliberately retained. Its next
      // lease-holder reconciles or fail-closes it rather than leaking a raw I/O error.
      return recoveryRequiredOutcome(transactionId, journalPath, 'journal-failed');
    }

    try {
      // Capture the complete preimage once. Each candidate rename below
      // rechecks its own target under the lease, so repeating this full scan
      // for every file would add O(n²) filesystem work without strengthening
      // the supported-writer guarantee.
      await assertPreimages(root, prepared);
      await appendCompactProgress('publishing', 0, 0);
      for (const [index, file] of prepared.entries()) {
        await assertWorkspaceWriteLease(root, lease);
        await testHooks.beforePublish?.(file.relativePath, index);
        inFlightPublication = file;
        inFlightPublicationRenamed = false;
        try {
          await replaceDurable(root, file.absolutePath, file.expectedBytes, file.replacementBytes, file.mode,
            file.replacementCandidatePath, () => assertWorkspaceWriteLease(root, lease), testHooks,
            () => { inFlightPublicationRenamed = true; });
        } catch (error) {
          if (error instanceof ImportTransformTransactionFailure) throw error;
          throw new ImportTransformTransactionFailure(
            'publication-failed',
            `Import transform publication failed for ${file.relativePath}: ${String(error)}`
          );
        }
        published.push(file);
        await testHooks.afterPublish?.(file.relativePath, index);
        await assertOrdinaryContainedTargetChain(root, file.absolutePath);
        if (!(await fs.readFile(file.absolutePath)).equals(file.replacementBytes)) {
          throw new ImportTransformTransactionFailure(
            'readback-failed',
            `Import transform readback failed for ${file.relativePath}`
          );
        }
        await appendCompactProgress('publishing', published.length, 0);
        inFlightPublication = null;
        inFlightPublicationRenamed = false;
      }
      await assertWorkspaceWriteLease(root, lease);
      await assertFinalWriteSet(root, prepared);
      await appendCompactProgress('accepted', published.length, 0);
      return Object.freeze({
        schema: 'sec-import-transform-transaction-outcome-v1' as const,
        status: 'accepted' as const,
        files: Object.freeze(prepared.map((file) => file.relativePath)),
        transactionId,
        journalPath
      });
    } catch (error) {
      const failure = error instanceof ImportTransformTransactionFailure
        ? error
        : new ImportTransformTransactionFailure('publication-failed', String(error));
      const publicationReason: 'preimage-conflict' | 'publication-failed' | 'readback-failed' =
        failure.reasonCode === 'preimage-conflict' || failure.reasonCode === 'readback-failed'
          ? failure.reasonCode
          : 'publication-failed';
      const appendProgress = (
        state: Extract<JournalState, 'rolling-back' | 'rolled-back' | 'recovery-required'>,
        publishedCount: number,
        outstandingCount: number,
        recoveryReasonCode: RecoveryReason | null
      ): Promise<boolean> => appendCompactProgress(state, publishedCount, outstandingCount,
        publicationReason, recoveryReasonCode)
        .then(() => true, () => false);
      const durablePublishedCount = compactJournalTail?.publishedCount ?? 0;
      let observedPublished: readonly PreparedWrite[];
      try {
        for (const file of prepared) {
          await assertWorkspaceWriteLease(root, lease);
          await assertOrdinaryContainedTargetChain(root, file.absolutePath);
        }
        observedPublished = await observePublishedPrefixAfterFailure(prepared, durablePublishedCount);
        if (inFlightPublicationRenamed && inFlightPublication !== null
          && observedPublished.length === durablePublishedCount) {
          throw new ImportTransformTransactionFailure(
            'preimage-conflict',
            `Import transform post-rename target became ambiguous: ${inFlightPublication.relativePath}`
          );
        }
      } catch {
        const possiblyPublished = [
          ...prepared.slice(0, durablePublishedCount),
          ...(inFlightPublicationRenamed && inFlightPublication !== null ? [inFlightPublication] : [])
        ].map((file) => file.relativePath);
        await appendProgress('recovery-required', possiblyPublished.length, possiblyPublished.length,
          'rollback-conflict');
        return recoveryRequiredOutcome(transactionId, journalPath, 'rollback-conflict', possiblyPublished);
      }
      const outstanding = [...observedPublished];
      let journalFailed = !(await appendProgress('rolling-back', observedPublished.length, outstanding.length, null));
      let recoveryReason: 'rollback-conflict' | 'rollback-failed' | undefined;
      for (const [index, file] of [...observedPublished].reverse().entries()) {
        try {
          await assertWorkspaceWriteLease(root, lease);
          await testHooks.beforeRollback?.(file.relativePath, index);
          await assertOrdinaryContainedTargetChain(root, file.absolutePath);
          const metadata = await fs.lstat(file.absolutePath);
          const current = await fs.readFile(file.absolutePath);
          if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== file.mode
            || !current.equals(file.replacementBytes)) {
            recoveryReason = 'rollback-conflict';
            break;
          }
          await replaceDurable(
            root,
            file.absolutePath,
            file.replacementBytes,
            file.expectedBytes,
            file.mode,
            file.preimageCandidatePath,
            () => assertWorkspaceWriteLease(root, lease),
            testHooks
          );
          await assertOrdinaryContainedTargetChain(root, file.absolutePath);
          if (!(await fs.readFile(file.absolutePath)).equals(file.expectedBytes)) {
            recoveryReason = 'rollback-failed';
            break;
          }
          outstanding.pop();
          if (!journalFailed && !(await appendProgress('rolling-back', observedPublished.length,
            outstanding.length, null))) {
            journalFailed = true;
          }
        } catch (rollbackError) {
          recoveryReason = rollbackError instanceof ImportTransformTransactionFailure
            && rollbackError.reasonCode === 'preimage-conflict' ? 'rollback-conflict' : 'rollback-failed';
          break;
        }
      }
      if (recoveryReason !== undefined) {
        await appendProgress('recovery-required', observedPublished.length, outstanding.length, recoveryReason);
        return Object.freeze({
          schema: 'sec-import-transform-transaction-outcome-v1' as const,
          status: 'recovery-required' as const,
          files: Object.freeze(outstanding.map((file) => file.relativePath)),
          transactionId,
          journalPath,
          reasonCode: recoveryReason
        });
      }
      if (journalFailed) {
        await appendProgress('recovery-required', observedPublished.length, outstanding.length, 'journal-failed');
        return recoveryRequiredOutcome(transactionId, journalPath, 'journal-failed',
          outstanding.map((entry) => entry.relativePath));
      }
      if (!(await appendProgress('rolled-back', observedPublished.length, 0, null))) {
        await appendProgress('recovery-required', observedPublished.length, 0, 'journal-failed');
        return Object.freeze({
          schema: 'sec-import-transform-transaction-outcome-v1' as const,
          status: 'recovery-required' as const,
          files: Object.freeze([]),
          transactionId,
          journalPath,
          reasonCode: 'journal-failed' as const
        });
      }
      return Object.freeze({
        schema: 'sec-import-transform-transaction-outcome-v1' as const,
        status: 'rolled-back' as const,
        files: Object.freeze([]),
        transactionId,
        journalPath,
        reasonCode: publicationReason
      });
    }
  });
}
