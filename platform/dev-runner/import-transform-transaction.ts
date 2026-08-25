import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { isolatedGitReadEnvironment } from '../git/read-environment.ts';
import { canonicalJson, digest, sha256 } from '../shared/canonical-primitives.ts';
import { CompilerError } from '../shared/errors.ts';
import { ensureDir } from '../shared/fs.ts';
import { resolveWorkspaceLocalStateRoot } from '../shared/workspace-path-contract.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../shared/workspace-write-lease.ts';

export type ImportAuthoringFreezeReceiptV1 = Readonly<{
  schema: 'sec-import-authoring-freeze-receipt-v1';
  authoringBase: string;
  indexDigest: `sha256:${string}`;
  providerRevision: string;
  receiptDigest: `sha256:${string}`;
}>;

const IMPORT_AUTHORING_FREEZE_DIRECTORY = 'import-authoring-freeze';
const IMPORT_AUTHORING_FREEZE_RECEIPT_FILE = 'current.json';

function importAuthoringFreezeReceiptMaterial(input: Readonly<{
  authoringBase: string;
  indexDigest: `sha256:${string}`;
  providerRevision: string;
}>): Omit<ImportAuthoringFreezeReceiptV1, 'receiptDigest'> {
  return Object.freeze({
    schema: 'sec-import-authoring-freeze-receipt-v1' as const,
    authoringBase: input.authoringBase as string,
    indexDigest: input.indexDigest,
    providerRevision: input.providerRevision as string
  });
}

function parseImportAuthoringFreezeReceiptV1(bytes: Buffer): ImportAuthoringFreezeReceiptV1 {
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')) as unknown; } catch { return invalidImportFreezeReceipt(); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalidImportFreezeReceipt();
  const input = value as Record<string, unknown>;
  const expected = ['schema', 'authoringBase', 'indexDigest', 'providerRevision', 'receiptDigest'].sort();
  const actual = Object.keys(input).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
      || input.schema !== 'sec-import-authoring-freeze-receipt-v1'
      || typeof input.authoringBase !== 'string' || !/^[0-9a-f]{40,64}$/u.test(input.authoringBase)
      || typeof input.indexDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.indexDigest)
      || typeof input.providerRevision !== 'string' || input.providerRevision.length === 0
      || typeof input.receiptDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.receiptDigest)) {
    return invalidImportFreezeReceipt();
  }
  const material = importAuthoringFreezeReceiptMaterial({
    authoringBase: input.authoringBase,
    indexDigest: input.indexDigest as `sha256:${string}`,
    providerRevision: input.providerRevision
  });
  if (sha256(material) !== input.receiptDigest) return invalidImportFreezeReceipt();
  return Object.freeze({ ...material, receiptDigest: input.receiptDigest as `sha256:${string}` });
}

function invalidImportFreezeReceipt(): never {
  throw new CompilerError('IMPORT-TRANSFORM-003', 'Import authoring freeze receipt is invalid.');
}

function importAuthoringFreezeRoot(projectRoot: string): string {
  return path.join(resolveWorkspaceLocalStateRoot(projectRoot), IMPORT_AUTHORING_FREEZE_DIRECTORY);
}

function fastGitText(projectRoot: string, args: readonly string[]): string | null {
  const result = spawnSync('git', [...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment({}, process.env),
    windowsHide: true
  });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

async function currentImportAuthoringIdentityV1(
  projectRoot: string,
  providerRevision?: string
): Promise<Readonly<{
  authoringBase: string;
  indexDigest: `sha256:${string}`;
  providerRevision: string;
}> | null> {
  const authoringBase = fastGitText(projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const indexValue = fastGitText(projectRoot, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  if (authoringBase === null || !/^[0-9a-f]{40,64}$/u.test(authoringBase) || indexValue === null) return null;
  try {
    const indexBytes = await fs.readFile(path.resolve(projectRoot, indexValue));
    const resolvedProviderRevision = providerRevision ?? await fs
      .readFile(path.join(projectRoot, 'node_modules', 'typescript', 'package.json'))
      .then((packageBytes) => {
        const packageValue = JSON.parse(packageBytes.toString('utf8')) as { version?: unknown };
        return typeof packageValue.version === 'string' && packageValue.version.length > 0
          ? `typescript@${packageValue.version}`
          : null;
      });
    if (typeof resolvedProviderRevision !== 'string' || resolvedProviderRevision.length === 0) return null;
    return Object.freeze({
      authoringBase,
      indexDigest: `sha256:${createHash('sha256').update(indexBytes).digest('hex')}` as `sha256:${string}`,
      providerRevision: resolvedProviderRevision
    });
  } catch { return null; }
}

async function readImportAuthoringFreezeReceiptV1(
  projectRoot: string
): Promise<ImportAuthoringFreezeReceiptV1 | null> {
  try {
    return parseImportAuthoringFreezeReceiptV1(await fs.readFile(
      path.join(importAuthoringFreezeRoot(projectRoot), IMPORT_AUTHORING_FREEZE_RECEIPT_FILE)
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof CompilerError) return null;
    throw error;
  }
}

export async function currentImportAuthoringFreezeReceiptMatchesV1(
  projectRoot = process.cwd(),
  providerRevision?: string
): Promise<boolean> {
  const [receipt, current] = await Promise.all([
    readImportAuthoringFreezeReceiptV1(projectRoot),
    currentImportAuthoringIdentityV1(projectRoot, providerRevision)
  ]);
  return receipt !== null && current !== null
    && receipt.authoringBase === current.authoringBase
    && receipt.indexDigest === current.indexDigest
    && receipt.providerRevision === current.providerRevision;
}

export async function publishImportAuthoringFreezeReceiptV1(input: Readonly<{
  projectRoot: string;
  authoringBase: string;
  providerRevision: string;
}>): Promise<ImportAuthoringFreezeReceiptV1> {
  const current = await currentImportAuthoringIdentityV1(input.projectRoot, input.providerRevision);
  if (current === null || current.authoringBase !== input.authoringBase
      || current.providerRevision !== input.providerRevision) {
    throw new CompilerError('IMPORT-TRANSFORM-003', 'Import authoring identity changed before receipt publication.');
  }
  const material = importAuthoringFreezeReceiptMaterial(current);
  const receipt = Object.freeze({
    ...material,
    receiptDigest: sha256(material) as `sha256:${string}`
  });
  const root = importAuthoringFreezeRoot(input.projectRoot);
  await ensureDir(root);
  const target = path.join(root, IMPORT_AUTHORING_FREEZE_RECEIPT_FILE);
  const candidate = path.join(root, `.${IMPORT_AUTHORING_FREEZE_RECEIPT_FILE}.${randomUUID()}.candidate`);
  try {
    await writeDurable(candidate, `${JSON.stringify(receipt)}\n`);
    await fs.rename(candidate, target);
    await syncDirectory(root);
  } finally {
    await fs.rm(candidate, { force: true }).catch(() => undefined);
  }
  const readback = await readImportAuthoringFreezeReceiptV1(input.projectRoot);
  if (readback === null || readback.receiptDigest !== receipt.receiptDigest) {
    throw new CompilerError('IMPORT-TRANSFORM-003', 'Import authoring freeze receipt readback differs.');
  }
  return readback;
}

export type ImportTransformWriteV1 = Readonly<{
  relativePath: string;
  expectedBytes: Buffer;
  replacementBytes: Buffer;
}>;

export type ImportTransformTransactionOutcomeV1 =
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

export type ImportTransformTransactionTestHooksV1 = Readonly<{
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

const ImportTransformBindingFormatV2 = 'sec-import-transform-transaction-v2' as const;
const ImportTransformJournalFormatV2 = 'sec-import-transform-journal-entry-v2' as const;

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
  testHooks: ImportTransformTransactionTestHooksV1,
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
  testHooks: ImportTransformTransactionTestHooksV1 = {}
): Promise<void> {
  await testHooks.beforeJournalAppend?.(state);
  const entry: JournalEntryV2 = Object.freeze({
    formatVersion: ImportTransformJournalFormatV2,
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
  testHooks: ImportTransformTransactionTestHooksV1
): Promise<boolean> {
  try {
    await appendJournal(journalPath, transactionId, state, files, published, outstanding,
      publicationReasonCode, recoveryReasonCode, testHooks);
    return true;
  } catch {
    return false;
  }
}

type JournalEntryV2 = Readonly<{
  formatVersion: typeof ImportTransformJournalFormatV2;
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
): Extract<ImportTransformTransactionOutcomeV1, { status: 'recovery-required' }> {
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
  previous: JournalEntryV2 | undefined,
  next: JournalEntryV2,
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
): readonly JournalEntryV2[] {
  const lines = source.split('\n').filter((line) => line.length > 0);
  const result: JournalEntryV2[] = [];
  for (const line of lines) {
    const raw = asRecord(parseRecoveryJson(line, 'Import transform transaction journal entry'),
      'Import transform transaction journal entry');
    exactKeys(raw, ['files', 'formatVersion', 'outstanding', 'publicationReasonCode', 'published',
      'recoveryReasonCode', 'state', 'transactionId'], 'Import transform transaction journal entry');
    if (raw.formatVersion !== ImportTransformJournalFormatV2 || raw.transactionId !== transactionId
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
    const entry: JournalEntryV2 = Object.freeze({
      formatVersion: ImportTransformJournalFormatV2,
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
  if (binding.formatVersion !== ImportTransformBindingFormatV2 || binding.transactionId !== transactionId
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
  testHooks: ImportTransformTransactionTestHooksV1
): Promise<Extract<ImportTransformTransactionOutcomeV1, { status: 'recovery-required' }> | undefined> {
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
  writes: readonly ImportTransformWriteV1[],
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

export async function publishImportTransformTransactionV1(
  workspaceRoot: string,
  writes: readonly ImportTransformWriteV1[],
  testHooks: ImportTransformTransactionTestHooksV1 = {}
): Promise<ImportTransformTransactionOutcomeV1> {
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
        formatVersion: ImportTransformBindingFormatV2,
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
