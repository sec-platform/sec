import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { SecRepositoryModuleRelocationPlanEntry } from '../../system-architecture/repository-modules/contract.ts';
import { canonicalJson, digest } from '../../system-architecture/foundation/runtime/canonical.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { ensureDir } from '../../workspace/files.ts';
import { resolveWorkspaceLocalStateRoot } from '../../workspace/contract/local-state.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../workspace/lease.ts';

export type ImportTransformWrite = Readonly<{
  relativePath: string;
  expectedBytes: Buffer;
  replacementBytes: Buffer;
}>;

export type ImportTransformPhysicalIdentity = Readonly<{
  readonly device: string;
  readonly inode: string;
}>;

export type ImportTransformRelocationTarget =
  | Readonly<{ state: 'absent' }>
  | Readonly<{
    state: 'existing';
    expectedBytes: Buffer;
    expectedMode: number;
    expectedIdentity: ImportTransformPhysicalIdentity;
  }>;

/**
 * A relocation is accepted only when its graph entry is fully resolved. The
 * source bytes are an explicit preimage; the target precondition is either
 * absence or an exact physical/file identity. This keeps semantic planning
 * separate from the one physical transaction owner below.
 */
export type ImportTransformRelocation = Readonly<{
  readonly entry: SecRepositoryModuleRelocationPlanEntry;
  readonly expectedSourceBytes: Buffer;
  readonly target: ImportTransformRelocationTarget;
}>;

export type RepositoryRelocationTransactionOutcome =
  | Readonly<{
    schema: 'sec-repository-relocation-outcome-v1';
    status: 'accepted';
    files: readonly string[];
    transactionId: string;
    journalPath: string;
  }>
  | Readonly<{
    schema: 'sec-repository-relocation-outcome-v1';
    status: 'unresolved';
    files: readonly string[];
    unresolvedReferences: readonly string[];
  }>
  | Readonly<{
    schema: 'sec-repository-relocation-outcome-v1';
    status: 'rolled-back';
    files: readonly string[];
    transactionId: string;
    journalPath: string;
    reasonCode: 'preimage-conflict' | 'publication-failed' | 'readback-failed';
  }>
  | Readonly<{
    schema: 'sec-repository-relocation-outcome-v1';
    status: 'recovery-required';
    files: readonly string[];
    transactionId: string;
    journalPath: string;
    reasonCode: 'journal-failed' | 'rollback-conflict' | 'rollback-failed';
  }>;

export type RepositoryRelocationTransactionTestHooks = Readonly<{
  beforeTargetPublish?: (targetPath: string, index: number) => void | Promise<void>;
  afterTargetPublish?: (targetPath: string, index: number) => void | Promise<void>;
  beforeSourceDelete?: (sourcePath: string, index: number) => void | Promise<void>;
  afterSourceDelete?: (sourcePath: string, index: number) => void | Promise<void>;
  beforeJournalAppend?: (
    state: 'prepared' | 'publishing' | 'accepted' | 'rolling-back' | 'rolled-back' | 'recovery-required'
  ) => void | Promise<void>;
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

const ImportTransformBindingFormat = 'sec-import-transform-transaction-v2' as const;
const ImportTransformJournalFormat = 'sec-import-transform-journal-entry-v2' as const;

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

async function appendJournal(
  journalPath: string,
  transactionId: string,
  state: JournalState,
  files: readonly PreparedWrite[],
  published: readonly string[],
  outstanding: readonly string[],
  publicationReasonCode: PublicationReason | null,
  recoveryReasonCode: RecoveryReason | null,
  testHooks: ImportTransformTransactionTestHooks = {}
): Promise<void> {
  await testHooks.beforeJournalAppend?.(state);
  const entry: JournalEntry = Object.freeze({
    formatVersion: ImportTransformJournalFormat,
    transactionId,
    state,
    files: Object.freeze(files.map((file) => Object.freeze({
      relativePath: file.relativePath,
      expectedDigest: file.expectedDigest,
      replacementDigest: file.replacementDigest
    }))),
    published: Object.freeze([...published]),
    outstanding: Object.freeze([...outstanding]),
    publicationReasonCode,
    recoveryReasonCode
  });
  const existing = await fs.readFile(journalPath, 'utf8');
  const serialized = `${JSON.stringify(canonicalJson(entry))}\n`;
  parseJournalEntries(`${existing}${serialized}`, transactionId, files);
  const handle = await fs.open(journalPath, 'a');
  try {
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendRecoveryJournalBestEffort(
  journalPath: string,
  transactionId: string,
  state: 'rolling-back' | 'rolled-back' | 'recovery-required',
  files: readonly PreparedWrite[],
  published: readonly string[],
  outstanding: readonly string[],
  publicationReasonCode: PublicationReason,
  recoveryReasonCode: RecoveryReason | null,
  testHooks: ImportTransformTransactionTestHooks
): Promise<boolean> {
  try {
    await appendJournal(journalPath, transactionId, state, files, published, outstanding,
      publicationReasonCode, recoveryReasonCode, testHooks);
    return true;
  } catch {
    return false;
  }
}

type JournalEntry = Readonly<{
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
  state: JournalState;
  published: readonly string[];
  outstanding: readonly string[];
  publicationReasonCode: PublicationReason | null;
  recoveryReasonCode: RecoveryReason | null;
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

function validateJournalTransition(
  previous: JournalEntry | undefined,
  next: JournalEntry,
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

function parseJournalEntries(
  source: string,
  transactionId: string,
  files: readonly PreparedWrite[]
): readonly JournalEntry[] {
  const lines = source.split('\n').filter((line) => line.length > 0);
  const result: JournalEntry[] = [];
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
      : ['preimage-conflict', 'publication-failed', 'readback-failed'].includes(String(raw.publicationReasonCode))
        ? raw.publicationReasonCode as PublicationReason : recoveryFailure('Import transform publication reason is invalid.');
    const recoveryReasonCode = raw.recoveryReasonCode === null ? null
      : ['journal-failed', 'rollback-conflict', 'rollback-failed'].includes(String(raw.recoveryReasonCode))
        ? raw.recoveryReasonCode as RecoveryReason : recoveryFailure('Import transform recovery reason is invalid.');
    const entry: JournalEntry = Object.freeze({
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
    validateJournalTransition(result.at(-1), entry, files);
    result.push(entry);
  }
  return Object.freeze(result);
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

function parseRecoveryJson(source: string, label: string): unknown {
  try { return JSON.parse(source) as unknown; } catch { return recoveryFailure(`${label} is not valid JSON.`); }
}

async function readRegularTransactionArtifact(filePath: string, label: string): Promise<Buffer> {
  const metadata = await fs.lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) recoveryFailure(`${label} is not an ordinary file.`);
  return fs.readFile(filePath);
}

async function readUnfinishedTransaction(
  workspaceRoot: string,
  transactionRoot: string,
  transactionId: string
): Promise<RecoveredTransaction> {
  const journalPath = path.join(transactionRoot, 'journal.jsonl');
  const bindingPath = path.join(transactionRoot, 'binding.json');
  await assertOrdinaryContainedTargetChain(workspaceRoot, bindingPath);
  await assertOrdinaryContainedTargetChain(workspaceRoot, journalPath);
  const binding = asRecord(parseRecoveryJson((await readRegularTransactionArtifact(bindingPath,
    'Import transform transaction binding')).toString('utf8'),
    'Import transform transaction binding'), 'Import transform transaction binding');
  exactKeys(binding, ['formatVersion', 'transactionId', 'workspaceRoot', 'writes'], 'Import transform transaction binding');
  if (binding.formatVersion !== ImportTransformBindingFormat || binding.transactionId !== transactionId
    || typeof binding.workspaceRoot !== 'string' || path.resolve(binding.workspaceRoot) !== workspaceRoot
    || !Array.isArray(binding.writes) || binding.writes.length === 0) {
    recoveryFailure('Import transform transaction binding identity is invalid.');
  }
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
    const stem = digest(write.relativePath);
    const preimagePath = path.join(transactionRoot, `${stem}.preimage`);
    const replacementPath = path.join(transactionRoot, `${stem}.replacement`);
    await assertOrdinaryContainedTargetChain(workspaceRoot, preimagePath);
    await assertOrdinaryContainedTargetChain(workspaceRoot, replacementPath);
    const expectedBytes = await readRegularTransactionArtifact(preimagePath,
      'Import transform transaction preimage');
    const replacementBytes = await readRegularTransactionArtifact(replacementPath,
      'Import transform transaction replacement');
    if (digest(expectedBytes) !== write.expectedDigest || digest(replacementBytes) !== write.replacementDigest) {
      recoveryFailure('Import transform transaction artifact digest is invalid.');
    }
    files.push(Object.freeze({
      relativePath: write.relativePath, absolutePath, preimageCandidatePath, replacementCandidatePath,
      expectedBytes, replacementBytes,
      expectedDigest: write.expectedDigest, replacementDigest: write.replacementDigest, mode: write.mode
    }));
  }
  const journal = parseJournalEntries((await readRegularTransactionArtifact(journalPath,
    'Import transform transaction journal')).toString('utf8'), transactionId, files);
  const last = journal.at(-1);
  if (last === undefined) recoveryFailure('Import transform transaction journal is empty.');
  return Object.freeze({ transactionId, journalPath, files: Object.freeze(files), state: last.state,
    published: last.published, outstanding: last.outstanding,
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
  journalPublishedCount: number
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
    else if (state === 'other'
      && (await fs.readFile(possibleUnjournaled.absolutePath)).equals(possibleUnjournaled.replacementBytes)) {
      throw new ImportTransformTransactionFailure('preimage-conflict',
        `Import transform unjournaled replacement metadata drifted: ${possibleUnjournaled.relativePath}`);
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
      transaction = await readUnfinishedTransaction(workspaceRoot, transactionRoot, entry.name);
    } catch (error) {
      return recoveryRequiredOutcome(entry.name, path.join(transactionRoot, 'journal.jsonl'), 'journal-failed');
    }
    try {
      for (const file of transaction.files) {
        await assertLease();
        await reconcileCandidateArtifact(workspaceRoot, file.preimageCandidatePath, file.expectedBytes, file.mode);
        await reconcileCandidateArtifact(workspaceRoot, file.replacementCandidatePath, file.replacementBytes, file.mode);
      }
    } catch {
      let physicalOutstanding = transaction.outstanding;
      try {
        physicalOutstanding = Object.freeze((await observeReplacementPrefix(transaction.files))
          .map((file) => file.relativePath));
      } catch {
        // Preserve the last durable exact set when target state is itself ambiguous.
      }
      if (transaction.state === 'prepared' || transaction.state === 'publishing'
        || transaction.state === 'rolling-back') {
        const publicationReason = transaction.publicationReasonCode ?? 'publication-failed';
        const published = transaction.state === 'rolling-back' ? transaction.published : physicalOutstanding;
        await appendRecoveryJournalBestEffort(transaction.journalPath, transaction.transactionId,
          'recovery-required', transaction.files, published, physicalOutstanding,
          publicationReason, 'rollback-conflict', testHooks);
      }
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'rollback-conflict',
        physicalOutstanding);
    }
    if (transaction.state === 'accepted' || transaction.state === 'rolled-back') continue;
    if (transaction.state === 'recovery-required') {
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath,
        transaction.recoveryReasonCode ?? 'journal-failed', transaction.outstanding);
    }
    let replacements: readonly PreparedWrite[] = [];
    let outstanding: PreparedWrite[] = [];
    const publicationReason = transaction.publicationReasonCode ?? 'publication-failed';
    try {
      for (const file of transaction.files) {
        await assertLease();
        await assertOrdinaryContainedTargetChain(workspaceRoot, file.absolutePath);
      }
      replacements = await observeReplacementPrefix(transaction.files);
      const published = transaction.state === 'rolling-back' ? transaction.published
        : replacements.map((file) => file.relativePath);
      outstanding = [...replacements];
      let journalFailed = !(await appendRecoveryJournalBestEffort(transaction.journalPath, transaction.transactionId,
        'rolling-back', transaction.files, published, outstanding.map((file) => file.relativePath),
        publicationReason, null, testHooks));
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
        if (!journalFailed && !(await appendRecoveryJournalBestEffort(transaction.journalPath, transaction.transactionId,
          'rolling-back', transaction.files, published, outstanding.map((entry) => entry.relativePath),
          publicationReason, null, testHooks))) {
          journalFailed = true;
        }
      }
      if (journalFailed) {
        await appendRecoveryJournalBestEffort(transaction.journalPath, transaction.transactionId,
          'recovery-required', transaction.files, published, outstanding.map((entry) => entry.relativePath),
          publicationReason, 'journal-failed', testHooks);
        return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'journal-failed',
          outstanding.map((entry) => entry.relativePath));
      }
      if (!(await appendRecoveryJournalBestEffort(transaction.journalPath, transaction.transactionId, 'rolled-back',
        transaction.files, published, [], publicationReason, null, testHooks))) {
        await appendRecoveryJournalBestEffort(transaction.journalPath, transaction.transactionId, 'recovery-required',
          transaction.files, published, [], publicationReason, 'journal-failed', testHooks);
        return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, 'journal-failed');
      }
    } catch (error) {
      const reasonCode = error instanceof ImportTransformTransactionFailure && error.reasonCode === 'preimage-conflict'
        ? 'rollback-conflict' as const : 'rollback-failed' as const;
      const published = transaction.state === 'rolling-back' ? transaction.published
        : replacements.map((file) => file.relativePath);
      await appendRecoveryJournalBestEffort(transaction.journalPath, transaction.transactionId, 'recovery-required',
        transaction.files, published, outstanding.map((file) => file.relativePath), publicationReason,
        reasonCode, testHooks);
      return recoveryRequiredOutcome(transaction.transactionId, transaction.journalPath, reasonCode,
        outstanding.map((file) => file.relativePath));
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
      expectedDigest: digest(write.expectedBytes),
      replacementDigest: digest(write.replacementBytes),
      mode: metadata.mode & 0o777
    }));
  }
  return Object.freeze(prepared);
}

async function assertPreimages(
  workspaceRoot: string,
  files: readonly PreparedWrite[],
  published: ReadonlySet<string>
): Promise<void> {
  for (const file of files) {
    if (published.has(file.relativePath)) continue;
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
  const root = path.resolve(workspaceRoot);
  const transactionId = randomUUID();
  const transactionRoot = path.join(resolveWorkspaceLocalStateRoot(root), 'import-transform-transactions', transactionId);
  const journalPath = path.join(transactionRoot, 'journal.jsonl');
  const published: PreparedWrite[] = [];
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
    try {
      await ensureDir(transactionRoot);
      await syncDirectory(root);
      await syncDirectory(path.dirname(path.dirname(transactionRoot)));
      await syncDirectory(path.dirname(transactionRoot));
      await syncDirectory(transactionRoot);
      for (const file of prepared) {
        const stem = digest(file.relativePath);
        await writeDurable(path.join(transactionRoot, `${stem}.preimage`), file.expectedBytes);
        await writeDurable(path.join(transactionRoot, `${stem}.replacement`), file.replacementBytes);
      }
      await writeDurable(path.join(transactionRoot, 'binding.json'), `${JSON.stringify(canonicalJson({
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
      }))}\n`);
      await writeDurable(journalPath, '');
      await appendJournal(journalPath, transactionId, 'prepared', prepared, [], [], null, null, testHooks);
    } catch {
      // A partially durable transaction root is deliberately retained. Its next
      // lease-holder reconciles or fail-closes it rather than leaking a raw I/O error.
      return recoveryRequiredOutcome(transactionId, journalPath, 'journal-failed');
    }

    try {
      await assertPreimages(root, prepared, new Set());
      await appendJournal(journalPath, transactionId, 'publishing', prepared, [], [], null, null, testHooks);
      for (const [index, file] of prepared.entries()) {
        await assertWorkspaceWriteLease(root, lease);
        await testHooks.beforePublish?.(file.relativePath, index);
        await assertPreimages(root, prepared, new Set(published.map((entry) => entry.relativePath)));
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
        inFlightPublication = null;
        inFlightPublicationRenamed = false;
        await testHooks.afterPublish?.(file.relativePath, index);
        await assertOrdinaryContainedTargetChain(root, file.absolutePath);
        if (!(await fs.readFile(file.absolutePath)).equals(file.replacementBytes)) {
          throw new ImportTransformTransactionFailure(
            'readback-failed',
            `Import transform readback failed for ${file.relativePath}`
          );
        }
        await appendJournal(journalPath, transactionId, 'publishing', prepared,
          published.map((entry) => entry.relativePath), [], null, null, testHooks);
      }
      await assertWorkspaceWriteLease(root, lease);
      await assertFinalWriteSet(root, prepared);
      await appendJournal(journalPath, transactionId, 'accepted', prepared,
        published.map((file) => file.relativePath), [], null, null, testHooks);
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
      let observedPublished: readonly PreparedWrite[];
      try {
        for (const file of prepared) {
          await assertWorkspaceWriteLease(root, lease);
          await assertOrdinaryContainedTargetChain(root, file.absolutePath);
        }
        observedPublished = await observePublishedPrefixAfterFailure(prepared, published.length);
        if (inFlightPublicationRenamed && inFlightPublication !== null
          && observedPublished.length === published.length) {
          throw new ImportTransformTransactionFailure(
            'preimage-conflict',
            `Import transform post-rename target became ambiguous: ${inFlightPublication.relativePath}`
          );
        }
      } catch {
        const possiblyPublished = [
          ...published,
          ...(inFlightPublicationRenamed && inFlightPublication !== null ? [inFlightPublication] : [])
        ].map((file) => file.relativePath);
        await appendRecoveryJournalBestEffort(journalPath, transactionId, 'recovery-required', prepared,
          possiblyPublished, possiblyPublished, publicationReason, 'rollback-conflict', testHooks);
        return recoveryRequiredOutcome(transactionId, journalPath, 'rollback-conflict', possiblyPublished);
      }
      const outstanding = [...observedPublished];
      const publishedPaths = observedPublished.map((file) => file.relativePath);
      let journalFailed = !(await appendRecoveryJournalBestEffort(
        journalPath,
        transactionId,
        'rolling-back',
        prepared,
        publishedPaths,
        outstanding.map((file) => file.relativePath),
        publicationReason,
        null,
        testHooks
      ));
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
          if (!journalFailed && !(await appendRecoveryJournalBestEffort(
            journalPath, transactionId, 'rolling-back', prepared,
            publishedPaths, outstanding.map((entry) => entry.relativePath), publicationReason, null, testHooks
          ))) {
            journalFailed = true;
          }
        } catch (rollbackError) {
          recoveryReason = rollbackError instanceof ImportTransformTransactionFailure
            && rollbackError.reasonCode === 'preimage-conflict' ? 'rollback-conflict' : 'rollback-failed';
          break;
        }
      }
      if (recoveryReason !== undefined) {
        await appendRecoveryJournalBestEffort(
          journalPath,
          transactionId,
          'recovery-required',
          prepared,
          publishedPaths,
          outstanding.map((file) => file.relativePath),
          publicationReason,
          recoveryReason,
          testHooks
        );
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
        await appendRecoveryJournalBestEffort(journalPath, transactionId, 'recovery-required', prepared,
          publishedPaths, outstanding.map((entry) => entry.relativePath), publicationReason,
          'journal-failed', testHooks);
        return recoveryRequiredOutcome(transactionId, journalPath, 'journal-failed',
          outstanding.map((entry) => entry.relativePath));
      }
      if (!(await appendRecoveryJournalBestEffort(
        journalPath, transactionId, 'rolled-back', prepared, publishedPaths, [], publicationReason, null, testHooks
      ))) {
        await appendRecoveryJournalBestEffort(
          journalPath, transactionId, 'recovery-required', prepared, publishedPaths, [], publicationReason,
          'journal-failed', testHooks
        );
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

type RelocationFileSnapshot = Readonly<{
  readonly bytes: Buffer;
  readonly mode: number;
  readonly identity: ImportTransformPhysicalIdentity;
}>;

type PreparedRelocation = Readonly<{
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceAbsolutePath: string;
  readonly targetAbsolutePath: string;
  readonly sourceArtifactPath: string;
  readonly targetCandidatePath: string;
  readonly expectedSourceBytes: Buffer;
  readonly expectedSourceDigest: string;
  readonly sourceMode: number;
  readonly sourceIdentity: ImportTransformPhysicalIdentity;
  readonly targetState: ImportTransformRelocationTarget['state'];
  readonly expectedTargetBytes: Buffer | null;
  readonly expectedTargetDigest: string | null;
  readonly expectedTargetMode: number | null;
  readonly expectedTargetIdentity: ImportTransformPhysicalIdentity | null;
}>;

type RelocationProgress = Readonly<{
  readonly path: string;
  readonly identity: ImportTransformPhysicalIdentity;
}>;

type RelocationJournalState =
  | 'prepared'
  | 'publishing'
  | 'accepted'
  | 'rolling-back'
  | 'rolled-back'
  | 'recovery-required';

type RelocationJournalEntry = Readonly<{
  readonly formatVersion: typeof RepositoryRelocationJournalFormat;
  readonly transactionId: string;
  readonly state: RelocationJournalState;
  readonly entries: readonly Readonly<{
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly sourceDigest: string;
    readonly sourceMode: number;
    readonly sourceDevice: string;
    readonly sourceInode: string;
    readonly targetState: 'absent' | 'existing';
    readonly targetDigest: string | null;
    readonly targetMode: number | null;
    readonly targetDevice: string | null;
    readonly targetInode: string | null;
  }>[];
  readonly targetPublished: readonly RelocationProgress[];
  readonly sourceDeleted: readonly RelocationProgress[];
  readonly publicationReasonCode: 'preimage-conflict' | 'publication-failed' | 'readback-failed' | null;
  readonly recoveryReasonCode: 'journal-failed' | 'rollback-conflict' | 'rollback-failed' | null;
}>;

type RecoveredRelocationTransaction = Readonly<{
  readonly transactionId: string;
  readonly transactionRoot: string;
  readonly journalPath: string;
  readonly entries: readonly PreparedRelocation[];
  readonly state: RelocationJournalState;
  readonly targetPublished: readonly RelocationProgress[];
  readonly sourceDeleted: readonly RelocationProgress[];
  readonly publicationReasonCode: RelocationJournalEntry['publicationReasonCode'];
  readonly recoveryReasonCode: RelocationJournalEntry['recoveryReasonCode'];
}>;

const RepositoryRelocationBindingFormat = 'sec-repository-relocation-transaction-v1' as const;
const RepositoryRelocationJournalFormat = 'sec-repository-relocation-journal-entry-v1' as const;

function relocationIdentity(metadata: { readonly dev: number; readonly ino: number }): ImportTransformPhysicalIdentity {
  return Object.freeze({ device: String(metadata.dev), inode: String(metadata.ino) });
}

function sameRelocationIdentity(
  left: ImportTransformPhysicalIdentity,
  right: ImportTransformPhysicalIdentity
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function relocationPathIsCanonical(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return normalized === value
    && normalized.length > 0
    && !path.posix.isAbsolute(normalized)
    && !normalized.split('/').includes('..')
    && !normalized.split('/').includes('.')
    && !normalized.includes('//');
}

async function assertRelocationParentChain(
  workspaceRoot: string,
  absolutePath: string
): Promise<void> {
  const root = path.resolve(workspaceRoot);
  const parent = path.dirname(absolutePath);
  const relative = path.relative(root, parent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw new ImportTransformTransactionFailure(
      'preimage-conflict',
      `Repository relocation parent escaped the workspace: ${absolutePath}`
    );
  }
  const rootMetadata = await fs.lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
    || !samePhysicalPath(await fs.realpath(root), root)) {
    throw new ImportTransformTransactionFailure(
      'preimage-conflict',
      'Repository relocation workspace root is not one ordinary directory.'
    );
  }
  let current = root;
  if (relative !== '') {
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      const metadata = await fs.lstat(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()
        || !samePhysicalPath(await fs.realpath(current), current)) {
        throw new ImportTransformTransactionFailure(
          'preimage-conflict',
          `Repository relocation parent has a symlink/reparse ancestor: ${absolutePath}`
        );
      }
    }
  }
}

async function readRelocationSnapshot(
  workspaceRoot: string,
  absolutePath: string
): Promise<RelocationFileSnapshot | null> {
  await assertRelocationParentChain(workspaceRoot, absolutePath);
  let metadata;
  try {
    metadata = await fs.lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || !samePhysicalPath(await fs.realpath(absolutePath), absolutePath)) {
    throw new ImportTransformTransactionFailure(
      'preimage-conflict',
      `Repository relocation path is not one ordinary file: ${absolutePath}`
    );
  }
  const bytes = await fs.readFile(absolutePath);
  const after = await fs.lstat(absolutePath);
  const identity = relocationIdentity(metadata);
  if (!sameRelocationIdentity(identity, relocationIdentity(after))
    || (metadata.mode & 0o777) !== (after.mode & 0o777)
    || metadata.size !== after.size) {
    throw new ImportTransformTransactionFailure(
      'preimage-conflict',
      `Repository relocation file changed while it was read: ${absolutePath}`
    );
  }
  return Object.freeze({ bytes, mode: metadata.mode & 0o777, identity });
}

function assertRelocationSnapshot(
  snapshot: RelocationFileSnapshot | null,
  expectedBytes: Buffer,
  expectedMode: number,
  expectedIdentity: ImportTransformPhysicalIdentity,
  label: string
): asserts snapshot is RelocationFileSnapshot {
  if (snapshot === null || snapshot.mode !== expectedMode
    || !sameRelocationIdentity(snapshot.identity, expectedIdentity)
    || !snapshot.bytes.equals(expectedBytes)) {
    throw new ImportTransformTransactionFailure('preimage-conflict', `${label} drifted.`);
  }
}

async function assertRelocationTargetPrecondition(
  workspaceRoot: string,
  entry: PreparedRelocation
): Promise<RelocationFileSnapshot | null> {
  const observed = await readRelocationSnapshot(workspaceRoot, entry.targetAbsolutePath);
  if (entry.targetState === 'absent') {
    if (observed !== null) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation target is no longer absent: ${entry.targetPath}`
      );
    }
    return null;
  }
  if (observed === null || entry.expectedTargetBytes === null
    || entry.expectedTargetMode === null || entry.expectedTargetIdentity === null) {
    throw new ImportTransformTransactionFailure(
      'preimage-conflict',
      `Repository relocation existing target disappeared: ${entry.targetPath}`
    );
  }
  assertRelocationSnapshot(observed, entry.expectedTargetBytes, entry.expectedTargetMode,
    entry.expectedTargetIdentity, `Repository relocation target ${entry.targetPath}`);
  return observed;
}

async function prepareRelocations(
  workspaceRoot: string,
  relocations: readonly ImportTransformRelocation[],
  transactionRoot: string
): Promise<readonly PreparedRelocation[]> {
  const sourcePaths = new Set<string>();
  const targetPaths = new Set<string>();
  const allPaths = new Set<string>();
  const prepared: PreparedRelocation[] = [];
  for (const relocation of relocations) {
    const sourcePath = relocation.entry.sourcePath;
    const targetPath = relocation.entry.targetPath;
    if (relocation.entry.sourceKind !== 'typescript'
      || relocation.entry.unresolvedReferences.length > 0
      || !relocationPathIsCanonical(sourcePath)
      || !relocationPathIsCanonical(targetPath)
      || sourcePath === targetPath) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation entry is not a resolved TypeScript move: ${sourcePath} -> ${targetPath}`
      );
    }
    if (sourcePaths.has(sourcePath) || targetPaths.has(targetPath)
      || allPaths.has(sourcePath) || allPaths.has(targetPath)) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation plan has an overlapping path: ${sourcePath} -> ${targetPath}`
      );
    }
    sourcePaths.add(sourcePath);
    targetPaths.add(targetPath);
    allPaths.add(sourcePath);
    allPaths.add(targetPath);
    const sourceAbsolutePath = containedFile(workspaceRoot, sourcePath);
    const targetAbsolutePath = containedFile(workspaceRoot, targetPath);
    await assertRelocationParentChain(workspaceRoot, sourceAbsolutePath);
    await assertRelocationParentChain(workspaceRoot, targetAbsolutePath);
    const source = await readRelocationSnapshot(workspaceRoot, sourceAbsolutePath);
    if (source === null || !source.bytes.equals(relocation.expectedSourceBytes)) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation source preimage does not match: ${sourcePath}`
      );
    }
    const target = relocation.target;
    if (target.state === 'existing'
      && (!Number.isInteger(target.expectedMode) || target.expectedMode < 0 || target.expectedMode > 0o777
        || target.expectedIdentity.device.length === 0 || target.expectedIdentity.inode.length === 0)) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation target identity is invalid: ${targetPath}`
      );
    }
    const targetEntry: PreparedRelocation = Object.freeze({
      sourcePath,
      targetPath,
      sourceAbsolutePath,
      targetAbsolutePath,
      sourceArtifactPath: path.join(transactionRoot, `${digest(sourcePath)}.source`),
      targetCandidatePath: path.join(transactionRoot, `${digest(sourcePath)}.target.candidate`),
      expectedSourceBytes: Buffer.from(relocation.expectedSourceBytes),
      expectedSourceDigest: digest(relocation.expectedSourceBytes),
      sourceMode: source.mode,
      sourceIdentity: source.identity,
      targetState: target.state,
      expectedTargetBytes: target.state === 'existing' ? Buffer.from(target.expectedBytes) : null,
      expectedTargetDigest: target.state === 'existing' ? digest(target.expectedBytes) : null,
      expectedTargetMode: target.state === 'existing' ? target.expectedMode : null,
      expectedTargetIdentity: target.state === 'existing' ? target.expectedIdentity : null
    });
    await assertRelocationTargetPrecondition(workspaceRoot, targetEntry);
    prepared.push(targetEntry);
  }
  return Object.freeze(prepared);
}

function relocationBindingEntry(entry: PreparedRelocation): Record<string, unknown> {
  return {
    sourcePath: entry.sourcePath,
    targetPath: entry.targetPath,
    sourceArtifactRelativePath: path.relative(path.dirname(path.dirname(entry.sourceArtifactPath)), entry.sourceArtifactPath)
      .replaceAll('\\', '/'),
    targetCandidateRelativePath: path.relative(path.dirname(path.dirname(entry.targetCandidatePath)), entry.targetCandidatePath)
      .replaceAll('\\', '/'),
    sourceDigest: entry.expectedSourceDigest,
    sourceMode: entry.sourceMode,
    sourceDevice: entry.sourceIdentity.device,
    sourceInode: entry.sourceIdentity.inode,
    targetState: entry.targetState,
    targetDigest: entry.expectedTargetDigest,
    targetMode: entry.expectedTargetMode,
    targetDevice: entry.expectedTargetIdentity?.device ?? null,
    targetInode: entry.expectedTargetIdentity?.inode ?? null
  };
}

function relocationJournalEntries(entries: readonly PreparedRelocation[]): readonly Record<string, unknown>[] {
  return Object.freeze(entries.map((entry) => ({
    sourcePath: entry.sourcePath,
    targetPath: entry.targetPath,
    sourceDigest: entry.expectedSourceDigest,
    sourceMode: entry.sourceMode,
    sourceDevice: entry.sourceIdentity.device,
    sourceInode: entry.sourceIdentity.inode,
    targetState: entry.targetState,
    targetDigest: entry.expectedTargetDigest,
    targetMode: entry.expectedTargetMode,
    targetDevice: entry.expectedTargetIdentity?.device ?? null,
    targetInode: entry.expectedTargetIdentity?.inode ?? null
  })));
}

function relocationProgress(
  values: readonly RelocationProgress[],
  label: string
): readonly Record<string, unknown>[] {
  return Object.freeze(values.map((value) => ({
    path: value.path,
    identity: { device: value.identity.device, inode: value.identity.inode }
  })));
}

function parseRelocationProgress(
  value: unknown,
  entries: readonly PreparedRelocation[],
  field: 'target' | 'source'
): readonly RelocationProgress[] {
  if (!Array.isArray(value) || value.length > entries.length) {
    recoveryFailure(`Repository relocation ${field} progress is invalid.`);
  }
  const result: RelocationProgress[] = [];
  for (const [index, raw] of value.entries()) {
    const record = asRecord(raw, `Repository relocation ${field} progress`);
    exactKeys(record, ['identity', 'path'], `Repository relocation ${field} progress`);
    const identity = asRecord(record.identity, `Repository relocation ${field} identity`);
    exactKeys(identity, ['device', 'inode'], `Repository relocation ${field} identity`);
    if (typeof record.path !== 'string' || typeof identity.device !== 'string'
      || typeof identity.inode !== 'string') {
      recoveryFailure(`Repository relocation ${field} progress is malformed.`);
    }
    const expected = field === 'target' ? entries[index]?.targetPath : entries[index]?.sourcePath;
    if (record.path !== expected || identity.device.length === 0 || identity.inode.length === 0) {
      recoveryFailure(`Repository relocation ${field} progress is not an exact prefix.`);
    }
    result.push(Object.freeze({
      path: record.path,
      identity: Object.freeze({ device: identity.device, inode: identity.inode })
    }));
  }
  return Object.freeze(result);
}

function validateRelocationJournalProgress(
  state: RelocationJournalState,
  targetPublished: readonly RelocationProgress[],
  sourceDeleted: readonly RelocationProgress[],
  entries: readonly PreparedRelocation[]
): void {
  if (sourceDeleted.length > targetPublished.length) {
    recoveryFailure('Repository relocation source progress exceeds target progress.');
  }
  if (sourceDeleted.some((_value, index) => entries[index] === undefined
    || targetPublished[index] === undefined)) {
    recoveryFailure('Repository relocation source progress exceeds target progress.');
  }
  for (let index = 0; index < targetPublished.length; index += 1) {
    if (targetPublished[index]?.path !== entries[index]?.targetPath) {
      recoveryFailure('Repository relocation target progress is not an exact prefix.');
    }
  }
  for (let index = 0; index < sourceDeleted.length; index += 1) {
    if (sourceDeleted[index]?.path !== entries[index]?.sourcePath) {
      recoveryFailure('Repository relocation source progress is not an exact prefix.');
    }
  }
  if (state === 'prepared' && (targetPublished.length !== 0 || sourceDeleted.length !== 0)) {
    recoveryFailure('Repository relocation prepared journal must be empty.');
  }
  if (state === 'accepted'
    && (targetPublished.length !== entries.length || sourceDeleted.length !== entries.length)) {
    recoveryFailure('Repository relocation accepted journal is incomplete.');
  }
  if (state === 'rolled-back' && sourceDeleted.length !== 0) {
    recoveryFailure('Repository relocation rolled-back journal retains deleted sources.');
  }
}

function validateRelocationJournalTransition(
  previous: RelocationJournalEntry | undefined,
  next: RelocationJournalEntry,
  entries: readonly PreparedRelocation[]
): void {
  const forward = next.state === 'prepared' || next.state === 'publishing' || next.state === 'accepted';
  if (forward) {
    if (next.publicationReasonCode !== null || next.recoveryReasonCode !== null) {
      recoveryFailure('Repository relocation forward journal carries failure state.');
    }
  } else if (next.state === 'rolling-back' || next.state === 'rolled-back') {
    if (next.publicationReasonCode === null || next.recoveryReasonCode !== null) {
      recoveryFailure('Repository relocation rollback journal reason is invalid.');
    }
  } else if (next.publicationReasonCode === null || next.recoveryReasonCode === null) {
    recoveryFailure('Repository relocation recovery reason is incomplete.');
  }
  validateRelocationJournalProgress(next.state, next.targetPublished, next.sourceDeleted, entries);
  if (previous === undefined) {
    if (next.state !== 'prepared') recoveryFailure('Repository relocation journal must begin prepared.');
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
  if (!allowed) recoveryFailure('Repository relocation journal state sequence is invalid.');
  if (next.targetPublished.length < previous.targetPublished.length
    || previous.targetPublished.some((value, index) => next.targetPublished[index]?.path !== value.path
      || !sameRelocationIdentity(next.targetPublished[index]!.identity, value.identity))) {
    recoveryFailure('Repository relocation target progress is not monotonic.');
  }
  if (!(next.state === 'rolled-back' && previous.state === 'rolling-back')
    && (next.sourceDeleted.length < previous.sourceDeleted.length
      || previous.sourceDeleted.some((value, index) => next.sourceDeleted[index]?.path !== value.path
        || !sameRelocationIdentity(next.sourceDeleted[index]!.identity, value.identity)))) {
    recoveryFailure('Repository relocation source progress is not monotonic.');
  }
  if (next.publicationReasonCode !== previous.publicationReasonCode
    && previous.publicationReasonCode !== null) {
    recoveryFailure('Repository relocation publication reason drifted.');
  }
}

function parseRelocationJournalEntries(
  source: string,
  transactionId: string,
  entries: readonly PreparedRelocation[]
): readonly RelocationJournalEntry[] {
  const result: RelocationJournalEntry[] = [];
  for (const line of source.split('\n').filter((value) => value.length > 0)) {
    const raw = asRecord(parseRecoveryJson(line, 'Repository relocation journal entry'),
      'Repository relocation journal entry');
    exactKeys(raw, ['entries', 'formatVersion', 'publicationReasonCode', 'recoveryReasonCode',
      'sourceDeleted', 'state', 'targetPublished', 'transactionId'], 'Repository relocation journal entry');
    if (raw.formatVersion !== RepositoryRelocationJournalFormat || raw.transactionId !== transactionId
      || typeof raw.state !== 'string' || !['prepared', 'publishing', 'accepted', 'rolling-back',
        'rolled-back', 'recovery-required'].includes(raw.state) || !Array.isArray(raw.entries)) {
      recoveryFailure('Repository relocation journal identity is invalid.');
    }
    if (raw.entries.length !== entries.length || raw.entries.some((value, index) => {
      const recorded = asRecord(value, 'Repository relocation journal entry record');
      exactKeys(recorded, ['sourceDevice', 'sourceDigest', 'sourceInode', 'sourceMode', 'sourcePath',
        'targetDevice', 'targetDigest', 'targetInode', 'targetMode', 'targetPath', 'targetState'],
      'Repository relocation journal entry record');
      const expected = entries[index]!;
      return recorded.sourcePath !== expected.sourcePath || recorded.targetPath !== expected.targetPath
        || recorded.sourceDigest !== expected.expectedSourceDigest || recorded.sourceMode !== expected.sourceMode
        || recorded.sourceDevice !== expected.sourceIdentity.device || recorded.sourceInode !== expected.sourceIdentity.inode
        || recorded.targetState !== expected.targetState || recorded.targetDigest !== expected.expectedTargetDigest
        || recorded.targetMode !== expected.expectedTargetMode
        || recorded.targetDevice !== (expected.expectedTargetIdentity?.device ?? null)
        || recorded.targetInode !== (expected.expectedTargetIdentity?.inode ?? null);
    })) recoveryFailure('Repository relocation journal entry set drifted.');
    const publicationReasonCode = raw.publicationReasonCode === null ? null
      : ['preimage-conflict', 'publication-failed', 'readback-failed'].includes(String(raw.publicationReasonCode))
        ? raw.publicationReasonCode as RelocationJournalEntry['publicationReasonCode']
        : recoveryFailure('Repository relocation publication reason is invalid.');
    const recoveryReasonCode = raw.recoveryReasonCode === null ? null
      : ['journal-failed', 'rollback-conflict', 'rollback-failed'].includes(String(raw.recoveryReasonCode))
        ? raw.recoveryReasonCode as RelocationJournalEntry['recoveryReasonCode']
        : recoveryFailure('Repository relocation recovery reason is invalid.');
    const entry: RelocationJournalEntry = Object.freeze({
      formatVersion: RepositoryRelocationJournalFormat,
      transactionId,
      state: raw.state as RelocationJournalState,
      entries: Object.freeze(entries.map((prepared) => Object.freeze({
        sourcePath: prepared.sourcePath,
        targetPath: prepared.targetPath,
        sourceDigest: prepared.expectedSourceDigest,
        sourceMode: prepared.sourceMode,
        sourceDevice: prepared.sourceIdentity.device,
        sourceInode: prepared.sourceIdentity.inode,
        targetState: prepared.targetState,
        targetDigest: prepared.expectedTargetDigest,
        targetMode: prepared.expectedTargetMode,
        targetDevice: prepared.expectedTargetIdentity?.device ?? null,
        targetInode: prepared.expectedTargetIdentity?.inode ?? null
      }))),
      targetPublished: parseRelocationProgress(raw.targetPublished, entries, 'target'),
      sourceDeleted: parseRelocationProgress(raw.sourceDeleted, entries, 'source'),
      publicationReasonCode,
      recoveryReasonCode
    });
    validateRelocationJournalTransition(result.at(-1), entry, entries);
    result.push(entry);
  }
  return Object.freeze(result);
}

async function appendRelocationJournal(
  journalPath: string,
  transactionId: string,
  state: RelocationJournalState,
  entries: readonly PreparedRelocation[],
  targetPublished: readonly RelocationProgress[],
  sourceDeleted: readonly RelocationProgress[],
  publicationReasonCode: RelocationJournalEntry['publicationReasonCode'],
  recoveryReasonCode: RelocationJournalEntry['recoveryReasonCode'],
  testHooks: RepositoryRelocationTransactionTestHooks
): Promise<void> {
  await testHooks.beforeJournalAppend?.(state);
  const entry: RelocationJournalEntry = Object.freeze({
    formatVersion: RepositoryRelocationJournalFormat,
    transactionId,
    state,
    entries: Object.freeze(relocationJournalEntries(entries) as RelocationJournalEntry['entries']),
    targetPublished: Object.freeze([...targetPublished]),
    sourceDeleted: Object.freeze([...sourceDeleted]),
    publicationReasonCode,
    recoveryReasonCode
  });
  const existing = await fs.readFile(journalPath, 'utf8');
  const serialized = `${JSON.stringify(canonicalJson({
    ...entry,
    targetPublished: relocationProgress(targetPublished, 'target'),
    sourceDeleted: relocationProgress(sourceDeleted, 'source')
  }))}\n`;
  parseRelocationJournalEntries(`${existing}${serialized}`, transactionId, entries);
  const handle = await fs.open(journalPath, 'a');
  try {
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeRelocationCandidate(
  entry: PreparedRelocation
): Promise<void> {
  const handle = await fs.open(entry.targetCandidatePath, 'wx', entry.sourceMode);
  try {
    await handle.writeFile(entry.expectedSourceBytes);
    await handle.chmod(entry.sourceMode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(entry.targetCandidatePath));
}

async function publishRelocationTarget(
  workspaceRoot: string,
  entry: PreparedRelocation,
  assertLease: () => Promise<void>,
  index: number,
  testHooks: RepositoryRelocationTransactionTestHooks
): Promise<RelocationProgress> {
  const existing = await assertRelocationTargetPrecondition(workspaceRoot, entry);
  if (entry.targetState === 'existing') {
    return Object.freeze({ path: entry.targetPath, identity: existing!.identity });
  }
  await testHooks.beforeTargetPublish?.(entry.targetPath, index);
  await assertLease();
  if (await readRelocationSnapshot(workspaceRoot, entry.targetAbsolutePath) !== null) {
    throw new ImportTransformTransactionFailure(
      'preimage-conflict',
      `Repository relocation target was created before no-replace publication: ${entry.targetPath}`
    );
  }
  await writeRelocationCandidate(entry);
  try {
    // A hard link is the portable no-replace publication primitive available
    // to this owner. It atomically fails when a foreign writer creates target.
    await fs.link(entry.targetCandidatePath, entry.targetAbsolutePath);
    const target = await readRelocationSnapshot(workspaceRoot, entry.targetAbsolutePath);
    if (target === null || !target.bytes.equals(entry.expectedSourceBytes)
      || target.mode !== entry.sourceMode) {
      throw new ImportTransformTransactionFailure(
        'publication-failed',
        `Repository relocation target readback failed: ${entry.targetPath}`
      );
    }
    const candidate = await readRelocationSnapshot(workspaceRoot, entry.targetCandidatePath);
    if (candidate === null || !sameRelocationIdentity(candidate.identity, target.identity)) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation target identity did not come from its candidate: ${entry.targetPath}`
      );
    }
    await syncDirectory(path.dirname(entry.targetAbsolutePath));
    await fs.unlink(entry.targetCandidatePath);
    await syncDirectory(path.dirname(entry.targetCandidatePath));
    return Object.freeze({ path: entry.targetPath, identity: target.identity });
  } finally {
    const candidate = await readRelocationSnapshot(workspaceRoot, entry.targetCandidatePath);
    if (candidate !== null && candidate.bytes.equals(entry.expectedSourceBytes)
      && candidate.mode === entry.sourceMode) {
      await fs.unlink(entry.targetCandidatePath);
      await syncDirectory(path.dirname(entry.targetCandidatePath));
    }
  }
}

async function deleteRelocationSource(
  workspaceRoot: string,
  entry: PreparedRelocation,
  assertLease: () => Promise<void>,
  index: number,
  testHooks: RepositoryRelocationTransactionTestHooks
): Promise<RelocationProgress> {
  await assertLease();
  const source = await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath);
  assertRelocationSnapshot(source, entry.expectedSourceBytes, entry.sourceMode, entry.sourceIdentity,
    `Repository relocation source ${entry.sourcePath}`);
  await testHooks.beforeSourceDelete?.(entry.sourcePath, index);
  await assertLease();
  const rechecked = await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath);
  assertRelocationSnapshot(rechecked, entry.expectedSourceBytes, entry.sourceMode, entry.sourceIdentity,
    `Repository relocation source ${entry.sourcePath}`);
  await fs.unlink(entry.sourceAbsolutePath);
  await syncDirectory(path.dirname(entry.sourceAbsolutePath));
  return Object.freeze({ path: entry.sourcePath, identity: entry.sourceIdentity });
}

async function assertRelocationFinalReadback(
  workspaceRoot: string,
  entry: PreparedRelocation,
  targetPublished: RelocationProgress
): Promise<void> {
  const target = await readRelocationSnapshot(workspaceRoot, entry.targetAbsolutePath);
  const expectedBytes = entry.targetState === 'existing' ? entry.expectedTargetBytes! : entry.expectedSourceBytes;
  const expectedMode = entry.targetState === 'existing' ? entry.expectedTargetMode! : entry.sourceMode;
  assertRelocationSnapshot(target, expectedBytes, expectedMode, targetPublished.identity,
    `Repository relocation final target ${entry.targetPath}`);
  if (await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath) !== null) {
    throw new ImportTransformTransactionFailure(
      'readback-failed',
      `Repository relocation source still exists after publication: ${entry.sourcePath}`
    );
  }
}

async function restoreRelocationSource(
  workspaceRoot: string,
  entry: PreparedRelocation
): Promise<void> {
  const existing = await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath);
  if (existing !== null) {
    assertRelocationSnapshot(existing, entry.expectedSourceBytes, entry.sourceMode, entry.sourceIdentity,
      `Repository relocation rollback source ${entry.sourcePath}`);
    return;
  }
  const handle = await fs.open(entry.sourceAbsolutePath, 'wx', entry.sourceMode);
  try {
    await handle.writeFile(entry.expectedSourceBytes);
    await handle.chmod(entry.sourceMode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(entry.sourceAbsolutePath));
  const restored = await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath);
  if (restored === null || !restored.bytes.equals(entry.expectedSourceBytes)
    || restored.mode !== entry.sourceMode) {
    throw new ImportTransformTransactionFailure(
      'rollback-failed',
      `Repository relocation rollback source readback failed: ${entry.sourcePath}`
    );
  }
}

async function rollbackRelocations(
  workspaceRoot: string,
  entries: readonly PreparedRelocation[],
  targetPublished: readonly RelocationProgress[],
  sourceDeleted: readonly RelocationProgress[],
  assertLease: () => Promise<void>
): Promise<void> {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const deleted = sourceDeleted[index];
    const published = targetPublished[index];
    if (deleted !== undefined) {
      const source = await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath);
      if (source !== null && !sameRelocationIdentity(source.identity, deleted.identity)) {
        throw new ImportTransformTransactionFailure(
          'preimage-conflict',
          `Repository relocation rollback source was replaced: ${entry.sourcePath}`
        );
      }
      await assertLease();
      await restoreRelocationSource(workspaceRoot, entry);
    } else if (await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath) === null) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation source disappeared before its deletion was journaled: ${entry.sourcePath}`
      );
    }
    if (published !== undefined && entry.targetState === 'absent') {
      const target = await readRelocationSnapshot(workspaceRoot, entry.targetAbsolutePath);
      assertRelocationSnapshot(target, entry.expectedSourceBytes, entry.sourceMode, published.identity,
        `Repository relocation rollback target ${entry.targetPath}`);
      await assertLease();
      await fs.unlink(entry.targetAbsolutePath);
      await syncDirectory(path.dirname(entry.targetAbsolutePath));
    } else if (entry.targetState === 'existing') {
      await assertRelocationTargetPrecondition(workspaceRoot, entry);
    } else if (published !== undefined) {
      throw new ImportTransformTransactionFailure(
        'preimage-conflict',
        `Repository relocation rollback target disappeared: ${entry.targetPath}`
      );
    }
    const candidate = await readRelocationSnapshot(workspaceRoot, entry.targetCandidatePath);
    if (candidate !== null && candidate.bytes.equals(entry.expectedSourceBytes)
      && candidate.mode === entry.sourceMode) {
      await fs.unlink(entry.targetCandidatePath);
      await syncDirectory(path.dirname(entry.targetCandidatePath));
    }
  }
}

async function readUnfinishedRelocationTransaction(
  workspaceRoot: string,
  transactionRoot: string,
  transactionId: string
): Promise<RecoveredRelocationTransaction> {
  const bindingPath = path.join(transactionRoot, 'binding.json');
  const journalPath = path.join(transactionRoot, 'journal.jsonl');
  const binding = asRecord(parseRecoveryJson((await readRegularTransactionArtifact(bindingPath,
    'Repository relocation binding')).toString('utf8'), 'Repository relocation binding'),
  'Repository relocation binding');
  exactKeys(binding, ['entries', 'formatVersion', 'transactionId', 'workspaceRoot'], 'Repository relocation binding');
  if (binding.formatVersion !== RepositoryRelocationBindingFormat || binding.transactionId !== transactionId
    || binding.workspaceRoot !== workspaceRoot || !Array.isArray(binding.entries)
    || binding.entries.length === 0) recoveryFailure('Repository relocation binding identity is invalid.');
  const entries: PreparedRelocation[] = [];
  for (const raw of binding.entries) {
    const record = asRecord(raw, 'Repository relocation binding entry');
    exactKeys(record, ['sourceArtifactRelativePath', 'sourceDevice', 'sourceDigest', 'sourceInode',
      'sourceMode', 'sourcePath', 'targetCandidateRelativePath', 'targetDevice', 'targetDigest',
      'targetInode', 'targetMode', 'targetPath', 'targetState'], 'Repository relocation binding entry');
    if (typeof record.sourcePath !== 'string' || typeof record.targetPath !== 'string'
      || typeof record.sourceDigest !== 'string' || typeof record.sourceMode !== 'number'
      || typeof record.sourceDevice !== 'string' || typeof record.sourceInode !== 'string'
      || !['absent', 'existing'].includes(String(record.targetState))
      || (record.targetDigest !== null && typeof record.targetDigest !== 'string')
      || (record.targetMode !== null && typeof record.targetMode !== 'number')
      || (record.targetDevice !== null && typeof record.targetDevice !== 'string')
      || (record.targetInode !== null && typeof record.targetInode !== 'string')
      || typeof record.sourceArtifactRelativePath !== 'string'
      || typeof record.targetCandidateRelativePath !== 'string') {
      recoveryFailure('Repository relocation binding entry is malformed.');
    }
    const targetState: 'absent' | 'existing' = record.targetState === 'existing'
      ? 'existing' : record.targetState === 'absent' ? 'absent'
        : recoveryFailure('Repository relocation binding target state is invalid.');
    const sourceAbsolutePath = containedFile(workspaceRoot, record.sourcePath);
    const targetAbsolutePath = containedFile(workspaceRoot, record.targetPath);
    const sourceArtifactPath = path.join(transactionRoot, path.basename(record.sourceArtifactRelativePath));
    const targetCandidatePath = path.join(transactionRoot, path.basename(record.targetCandidateRelativePath));
    if (record.sourceArtifactRelativePath !== path.relative(workspaceRoot, sourceArtifactPath).replaceAll('\\', '/')
      || record.targetCandidateRelativePath !== path.relative(workspaceRoot, targetCandidatePath).replaceAll('\\', '/')) {
      recoveryFailure('Repository relocation binding artifact path escaped its transaction root.');
    }
    const expectedSourceBytes = await readRegularTransactionArtifact(sourceArtifactPath,
      'Repository relocation source artifact');
    if (digest(expectedSourceBytes) !== record.sourceDigest) recoveryFailure('Repository relocation source artifact digest drifted.');
    let expectedTargetBytes: Buffer | null = null;
    if (targetState === 'existing') {
      // Existing targets are never overwritten, so their expected bytes are
      // retained in the source artifact only when the digest is equal. A
      // target readback remains the final authority during recovery.
      const observedTarget = await readRelocationSnapshot(workspaceRoot, targetAbsolutePath);
      if (observedTarget === null || record.targetDigest === null
        || digest(observedTarget.bytes) !== record.targetDigest) {
        recoveryFailure('Repository relocation existing target preimage is unavailable.');
      }
      expectedTargetBytes = Buffer.from(observedTarget.bytes);
    }
    entries.push(Object.freeze({
      sourcePath: record.sourcePath,
      targetPath: record.targetPath,
      sourceAbsolutePath,
      targetAbsolutePath,
      sourceArtifactPath,
      targetCandidatePath,
      expectedSourceBytes,
      expectedSourceDigest: record.sourceDigest,
      sourceMode: record.sourceMode,
      sourceIdentity: Object.freeze({ device: record.sourceDevice, inode: record.sourceInode }),
      targetState,
      expectedTargetBytes,
      expectedTargetDigest: record.targetDigest,
      expectedTargetMode: record.targetMode,
      expectedTargetIdentity: record.targetDevice !== null && record.targetInode !== null
        ? Object.freeze({ device: record.targetDevice, inode: record.targetInode }) : null
    }));
  }
  const journal = parseRelocationJournalEntries((await readRegularTransactionArtifact(journalPath,
    'Repository relocation journal')).toString('utf8'), transactionId, entries);
  const last = journal.at(-1);
  if (last === undefined) recoveryFailure('Repository relocation journal is empty.');
  return Object.freeze({
    transactionId,
    transactionRoot,
    journalPath,
    entries: Object.freeze(entries),
    state: last.state,
    targetPublished: last.targetPublished,
    sourceDeleted: last.sourceDeleted,
    publicationReasonCode: last.publicationReasonCode,
    recoveryReasonCode: last.recoveryReasonCode
  });
}

async function appendRelocationRecoveryJournalBestEffort(
  transaction: RecoveredRelocationTransaction,
  state: 'rolling-back' | 'rolled-back' | 'recovery-required',
  targetPublished: readonly RelocationProgress[],
  sourceDeleted: readonly RelocationProgress[],
  publicationReasonCode: NonNullable<RelocationJournalEntry['publicationReasonCode']>,
  recoveryReasonCode: RelocationJournalEntry['recoveryReasonCode'],
  testHooks: RepositoryRelocationTransactionTestHooks
): Promise<boolean> {
  try {
    await appendRelocationJournal(transaction.journalPath, transaction.transactionId, state,
      transaction.entries, targetPublished, sourceDeleted, publicationReasonCode, recoveryReasonCode, testHooks);
    return true;
  } catch {
    return false;
  }
}

async function reconcileUnfinishedRelocationTransactions(
  workspaceRoot: string,
  assertLease: () => Promise<void>,
  testHooks: RepositoryRelocationTransactionTestHooks
): Promise<Extract<RepositoryRelocationTransactionOutcome, { status: 'recovery-required' }> | undefined> {
  const transactionsRoot = path.join(resolveWorkspaceLocalStateRoot(workspaceRoot),
    'repository-relocation-transactions');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(transactionsRoot, { withFileTypes: true }) as Dirent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
      status: 'recovery-required' as const, files: Object.freeze([]), transactionId: 'unreadable',
      journalPath: transactionsRoot, reasonCode: 'journal-failed' as const });
  }
  for (const directory of entries) {
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
        status: 'recovery-required' as const, files: Object.freeze([directory.name]),
        transactionId: directory.name, journalPath: path.join(transactionsRoot, directory.name, 'journal.jsonl'),
        reasonCode: 'journal-failed' as const });
    }
    const transactionRoot = path.join(transactionsRoot, directory.name);
    let transaction: RecoveredRelocationTransaction;
    try {
      transaction = await readUnfinishedRelocationTransaction(workspaceRoot, transactionRoot, directory.name);
    } catch {
      return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
        status: 'recovery-required' as const, files: Object.freeze([]), transactionId: directory.name,
        journalPath: path.join(transactionRoot, 'journal.jsonl'), reasonCode: 'journal-failed' as const });
    }
    if (transaction.state === 'accepted' || transaction.state === 'rolled-back') continue;
    const publicationReason = transaction.publicationReasonCode ?? 'publication-failed';
    try {
      await assertLease();
      // A target/source state not represented by the durable prefix is
      // ambiguous; never guess whether an unjournaled effect was ours.
      for (let index = 0; index < transaction.entries.length; index += 1) {
        const entry = transaction.entries[index]!;
        const published = transaction.targetPublished[index];
        const deleted = transaction.sourceDeleted[index];
        if (published === undefined) {
          await assertRelocationTargetPrecondition(workspaceRoot, entry);
        } else {
          const target = await readRelocationSnapshot(workspaceRoot, entry.targetAbsolutePath);
          const expectedBytes = entry.targetState === 'existing'
            ? entry.expectedTargetBytes! : entry.expectedSourceBytes;
          const expectedMode = entry.targetState === 'existing'
            ? entry.expectedTargetMode! : entry.sourceMode;
          assertRelocationSnapshot(target, expectedBytes, expectedMode, published.identity,
            `Repository relocation recovery target ${entry.targetPath}`);
        }
        if (deleted === undefined && await readRelocationSnapshot(workspaceRoot, entry.sourceAbsolutePath) === null) {
          throw new ImportTransformTransactionFailure('preimage-conflict',
            `Repository relocation recovery source state is ambiguous: ${entry.sourcePath}`);
        }
      }
      await appendRelocationRecoveryJournalBestEffort(transaction, 'rolling-back',
        transaction.targetPublished, transaction.sourceDeleted, publicationReason, null, testHooks);
      await rollbackRelocations(workspaceRoot, transaction.entries, transaction.targetPublished,
        transaction.sourceDeleted, assertLease);
      const rolledBack = await appendRelocationRecoveryJournalBestEffort(transaction, 'rolled-back',
        transaction.targetPublished, [], publicationReason, null, testHooks);
      if (!rolledBack) throw new ImportTransformTransactionFailure('journal-failed',
        'Repository relocation rollback terminal journal could not be written.');
    } catch (error) {
      const reasonCode = error instanceof ImportTransformTransactionFailure
        && error.reasonCode === 'preimage-conflict' ? 'rollback-conflict' as const : 'rollback-failed' as const;
      await appendRelocationRecoveryJournalBestEffort(transaction, 'recovery-required',
        transaction.targetPublished, transaction.sourceDeleted, publicationReason, reasonCode, testHooks);
      return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
        status: 'recovery-required' as const,
        files: Object.freeze(transaction.entries.map((entry) => entry.sourcePath)),
        transactionId: transaction.transactionId,
        journalPath: transaction.journalPath,
        reasonCode });
    }
  }
  return undefined;
}

function unresolvedRelocationReferences(
  relocations: readonly ImportTransformRelocation[]
): readonly string[] {
  const result = new Set<string>();
  for (const relocation of relocations) {
    if (relocation.entry.sourceKind !== 'typescript') {
      result.add(`${relocation.entry.sourcePath}:non-typescript-source-or-target`);
    }
    for (const reference of relocation.entry.unresolvedReferences) {
      result.add(`${reference.from}:${reference.kind}:${reference.specifier}:${reference.reason}`);
    }
  }
  return Object.freeze([...result].sort((left, right) => left.localeCompare(right, 'en-US')));
}

/**
 * Publish a resolved repository-module relocation through the same workspace
 * lease and physical transaction owner used by import transforms. Unknown or
 * non-TypeScript graph edges stop before any directory, journal, candidate,
 * target, or source effect is created.
 */
export async function publishRepositoryModuleRelocationTransaction(
  workspaceRoot: string,
  relocations: readonly ImportTransformRelocation[],
  testHooks: RepositoryRelocationTransactionTestHooks = {}
): Promise<RepositoryRelocationTransactionOutcome> {
  if (relocations.length === 0) {
    throw new CompilerError('IMPORT-TRANSFORM-003',
      'Repository relocation transaction requires a non-empty plan');
  }
  const unresolvedReferences = unresolvedRelocationReferences(relocations);
  if (unresolvedReferences.length > 0) {
    return Object.freeze({
      schema: 'sec-repository-relocation-outcome-v1' as const,
      status: 'unresolved' as const,
      files: Object.freeze(relocations.map(({ entry }) => entry.sourcePath)),
      unresolvedReferences
    });
  }
  const root = path.resolve(workspaceRoot);
  const transactionId = randomUUID();
  const transactionRoot = path.join(resolveWorkspaceLocalStateRoot(root),
    'repository-relocation-transactions', transactionId);
  const journalPath = path.join(transactionRoot, 'journal.jsonl');
  let prepared: readonly PreparedRelocation[] = [];
  const targetPublished: RelocationProgress[] = [];
  const sourceDeleted: RelocationProgress[] = [];
  return withWorkspaceWriteLease(root, undefined, async (lease) => {
    await assertWorkspaceWriteLease(root, lease);
    const unfinished = await reconcileUnfinishedRelocationTransactions(root,
      () => assertWorkspaceWriteLease(root, lease), testHooks);
    if (unfinished !== undefined) return unfinished;
    prepared = await prepareRelocations(root, relocations, transactionRoot);
    try {
      await ensureDir(transactionRoot);
      await syncDirectory(root);
      await syncDirectory(path.dirname(path.dirname(transactionRoot)));
      await syncDirectory(path.dirname(transactionRoot));
      await syncDirectory(transactionRoot);
      for (const entry of prepared) {
        await writeDurable(entry.sourceArtifactPath, entry.expectedSourceBytes);
      }
      const binding = {
        formatVersion: RepositoryRelocationBindingFormat,
        transactionId,
        workspaceRoot: root,
        entries: prepared.map(relocationBindingEntry)
      };
      await writeDurable(path.join(transactionRoot, 'binding.json'),
        `${JSON.stringify(canonicalJson(binding))}\n`);
      await writeDurable(journalPath, '');
      await appendRelocationJournal(journalPath, transactionId, 'prepared', prepared, [], [], null, null, testHooks);
    } catch {
      return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
        status: 'recovery-required' as const, files: Object.freeze([]), transactionId, journalPath,
        reasonCode: 'journal-failed' as const });
    }
    try {
      await appendRelocationJournal(journalPath, transactionId, 'publishing', prepared, [], [], null, null, testHooks);
      for (const [index, entry] of prepared.entries()) {
        await assertWorkspaceWriteLease(root, lease);
        const published = await publishRelocationTarget(root, entry,
          () => assertWorkspaceWriteLease(root, lease), index, testHooks);
        targetPublished.push(published);
        await testHooks.afterTargetPublish?.(entry.targetPath, index);
        await appendRelocationJournal(journalPath, transactionId, 'publishing', prepared,
          targetPublished, sourceDeleted, null, null, testHooks);
        const deleted = await deleteRelocationSource(root, entry,
          () => assertWorkspaceWriteLease(root, lease), index, testHooks);
        sourceDeleted.push(deleted);
        await testHooks.afterSourceDelete?.(entry.sourcePath, index);
        await appendRelocationJournal(journalPath, transactionId, 'publishing', prepared,
          targetPublished, sourceDeleted, null, null, testHooks);
        await assertRelocationFinalReadback(root, entry, published);
      }
      await assertWorkspaceWriteLease(root, lease);
      for (let index = 0; index < prepared.length; index += 1) {
        await assertRelocationFinalReadback(root, prepared[index]!, targetPublished[index]!);
      }
      await appendRelocationJournal(journalPath, transactionId, 'accepted', prepared,
        targetPublished, sourceDeleted, null, null, testHooks);
      return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
        status: 'accepted' as const,
        files: Object.freeze(prepared.map(({ targetPath }) => targetPath)), transactionId, journalPath });
    } catch (error) {
      const failure = error instanceof ImportTransformTransactionFailure
        ? error : new ImportTransformTransactionFailure('publication-failed', String(error));
      const publicationReason = failure.reasonCode === 'preimage-conflict'
        || failure.reasonCode === 'readback-failed' ? failure.reasonCode : 'publication-failed';
      try {
        await appendRelocationJournal(journalPath, transactionId, 'rolling-back', prepared,
          targetPublished, sourceDeleted, publicationReason, null, testHooks);
        await rollbackRelocations(root, prepared, targetPublished, sourceDeleted,
          () => assertWorkspaceWriteLease(root, lease));
        await appendRelocationJournal(journalPath, transactionId, 'rolled-back', prepared,
          targetPublished, [], publicationReason, null, testHooks);
        return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
          status: 'rolled-back' as const, files: Object.freeze([]), transactionId, journalPath,
          reasonCode: publicationReason });
      } catch (rollbackError) {
        const recoveryReason = rollbackError instanceof ImportTransformTransactionFailure
          && rollbackError.reasonCode === 'preimage-conflict' ? 'rollback-conflict' as const : 'rollback-failed' as const;
        await appendRelocationJournal(journalPath, transactionId, 'recovery-required', prepared,
          targetPublished, sourceDeleted, publicationReason, recoveryReason, testHooks).catch(() => undefined);
        return Object.freeze({ schema: 'sec-repository-relocation-outcome-v1' as const,
          status: 'recovery-required' as const,
          files: Object.freeze(prepared.map(({ sourcePath }) => sourcePath)), transactionId, journalPath,
          reasonCode: recoveryReason });
      }
    }
  });
}
