import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION, type SemanticMutationRejectedTerminalRecord } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationResult } from '../../semantics/mutation/types.ts';
import {
  canonicalDiagnostics,
  canonicalEquals,
  cloneAndDeepFreeze,
  digestString,
  exactOwnKeys,
  isPlainObject,
  nonEmptyString,
  sha256
} from '../../compiler/semantic-mutation/canonical.ts';
import { semanticMutationResultRevision } from '../../compiler/semantic-mutation/result.ts';
import {
  assertSemanticMutationTerminalOrderDirectory,
  assertSemanticMutationTransactionRoot,
  semanticMutationJournalRoot,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
import { replaceSemanticMutationFileAtomically } from './windows-file-attributes.ts';

const TERMINAL_NAME = 'terminal-rejected.json';
const TERMINAL_COMPLETION_REVISION = 'semantic-mutation-terminal-completion-v1' as const;
const TERMINAL_ORDER_DIRECTORY = 'terminal-order';
const TERMINAL_SEQUENCE_HEAD_NAME = '.sequence-head.json';
const TERMINAL_SEQUENCE_HEAD_REVISION = 'semantic-mutation-terminal-sequence-head-v1' as const;
const MAX_TERMINAL_SEQUENCE = 999_999_999_999;


type RetainedTerminalState = 'rejected' | 'verified' | 'rolled-back';

interface SemanticMutationTerminalCompletion {
  readonly formatRevision: typeof TERMINAL_COMPLETION_REVISION;
  readonly terminalSequence: number;
  readonly requestIdentityDigest: string;
  readonly state: RetainedTerminalState;
  readonly completionRevision: string;
}

interface SemanticMutationTerminalSequenceHead {
  readonly formatRevision: typeof TERMINAL_SEQUENCE_HEAD_REVISION;
  readonly highestReservedSequence: number;
  readonly headRevision: string;
}

type TerminalCompletionReadReason = 'exact' | 'head-catch-up';

export type SemanticMutationTerminalIoObservation =
  | { readonly kind: 'terminal-order-scan'; readonly reason: 'initial-empty-check' }
  | {
      readonly kind: 'completion-probe';
      readonly reason: TerminalCompletionReadReason;
      readonly terminalSequence: number;
      readonly status: 'missing' | 'valid';
    }
  | {
      readonly kind: 'sequence-head-read';
      readonly status: 'missing' | 'valid';
      readonly highestReservedSequence?: number;
    }
  | { readonly kind: 'sequence-head-write'; readonly highestReservedSequence: number }
  | { readonly kind: 'completion-publish'; readonly terminalSequence: number }
  | { readonly kind: 'transactions-scan' };

export interface SemanticMutationTerminalWriteTestHooks {
  readonly beforeCompletionTempOpenAfterFence?: () => Promise<void>;
  readonly afterCompletionTempFileClosed?: () => Promise<void>;
  readonly beforeRejectedTempOpenAfterFence?: () => Promise<void>;
  readonly afterRejectedTempFileClosed?: () => Promise<void>;
  readonly observeIo?: (event: SemanticMutationTerminalIoObservation) => void;
  readonly afterCompletionPublishedBeforeHeadWrite?: (terminalSequence: number) => Promise<void>;
}

function recordRevision(
  value: Omit<SemanticMutationRejectedTerminalRecord, 'recordRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-rejected-terminal-record-v1', ...value });
}

function completionRevision(
  value: Omit<SemanticMutationTerminalCompletion, 'completionRevision'>
): string {
  return sha256({ domain: TERMINAL_COMPLETION_REVISION, ...value });
}

function sequenceHeadRevision(
  value: Omit<SemanticMutationTerminalSequenceHead, 'headRevision'>
): string {
  return sha256({ domain: TERMINAL_SEQUENCE_HEAD_REVISION, ...value });
}

async function fsyncDirectory(
  directory: string,
  commitFence: SemanticMutationCommitFence,
  assertDirectory: () => Promise<void>
): Promise<void> {
  await commitFence();
  await assertDirectory();
  let handle;
  try {
    handle = await open(directory, 'r');
    await assertDirectory();
    await commitFence();
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function cleanupTerminalTemp(
  temporary: string,
  commitFence: SemanticMutationCommitFence,
  assertDirectory: () => Promise<void>
): Promise<void> {
  try {
    await commitFence();
    await assertDirectory();
    await rm(temporary, { force: true });
  } catch {
    // Preserve the primary error and never delete through an unproven path.
  }
}

function completionFileName(sequence: number): string {
  return `${sequence.toString().padStart(12, '0')}.json`;
}

function terminalOrderDirectory(transactionRoot: string): string {
  return path.join(
    semanticMutationJournalRoot(semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot)),
    TERMINAL_ORDER_DIRECTORY
  );
}

function isRetainedTerminalState(value: unknown): value is RetainedTerminalState {
  return value === 'rejected' || value === 'verified' || value === 'rolled-back';
}

function assertCompletionInvariant(
  completion: SemanticMutationTerminalCompletion,
  expectedFileName: string
): void {
  if (!isPlainObject(completion) || !exactOwnKeys(completion, [
    'formatRevision', 'terminalSequence', 'requestIdentityDigest', 'state', 'completionRevision'
  ])) {
    throw new Error('Semantic Mutation terminal completion violates the frozen v1 schema');
  }
  const { completionRevision: supplied, ...withoutRevision } = completion;
  if (completion.formatRevision !== TERMINAL_COMPLETION_REVISION ||
    !Number.isSafeInteger(completion.terminalSequence) || completion.terminalSequence <= 0 ||
    completion.terminalSequence > MAX_TERMINAL_SEQUENCE ||
    completionFileName(completion.terminalSequence) !== expectedFileName ||
    !digestString(completion.requestIdentityDigest) || !isRetainedTerminalState(completion.state) ||
    supplied !== completionRevision(withoutRevision)) {
    throw new Error('Semantic Mutation terminal completion content is invalid');
  }
}

function assertSequenceHeadInvariant(head: SemanticMutationTerminalSequenceHead): void {
  if (!isPlainObject(head) || !exactOwnKeys(head, [
    'formatRevision', 'highestReservedSequence', 'headRevision'
  ])) {
    throw new Error('Semantic Mutation terminal sequence head violates the internal v1 schema');
  }
  const { headRevision: supplied, ...withoutRevision } = head;
  if (head.formatRevision !== TERMINAL_SEQUENCE_HEAD_REVISION ||
    !Number.isSafeInteger(head.highestReservedSequence) || head.highestReservedSequence < 0 ||
    head.highestReservedSequence > MAX_TERMINAL_SEQUENCE ||
    supplied !== sequenceHeadRevision(withoutRevision)) {
    throw new Error('Semantic Mutation terminal sequence head content is invalid');
  }
}

async function readSemanticMutationTerminalCompletionBySequence(
  transactionRoot: string,
  terminalSequence: number,
  reason: TerminalCompletionReadReason,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationTerminalCompletion | null> {
  if (!Number.isSafeInteger(terminalSequence) || terminalSequence <= 0 ||
    terminalSequence > MAX_TERMINAL_SEQUENCE) {
    throw new Error('Semantic Mutation terminal completion sequence is invalid');
  }
  const directory = await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  const name = completionFileName(terminalSequence);
  let serialized: string;
  try {
    serialized = await readFile(path.join(directory, name), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
      testHooks.observeIo?.({
        kind: 'completion-probe',
        reason,
        terminalSequence,
        status: 'missing'
      });
      return null;
    }
    throw error;
  }
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  const completion = JSON.parse(serialized) as SemanticMutationTerminalCompletion;
  assertCompletionInvariant(completion, name);
  testHooks.observeIo?.({ kind: 'completion-probe', reason, terminalSequence, status: 'valid' });
  return completion;
}

async function assertInitialSemanticMutationTerminalOrderEmpty(
  transactionRoot: string,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<void> {
  const directory = await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  if (path.basename(directory) !== TERMINAL_ORDER_DIRECTORY) {
    throw new Error('Semantic Mutation terminal order directory binding is invalid');
  }
  let names: string[];
  try {
    testHooks.observeIo?.({ kind: 'terminal-order-scan', reason: 'initial-empty-check' });
    names = (await readdir(directory)).filter((name) => !name.startsWith('.')).sort();
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (names.length > 0) {
    throw new Error(
      'Semantic Mutation terminal order has durable receipts without its authority head; explicit retirement is required'
    );
  }
}

async function readSemanticMutationTerminalSequenceHead(
  transactionRoot: string,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationTerminalSequenceHead | null> {
  const directory = await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  let serialized: string;
  try {
    serialized = await readFile(path.join(directory, TERMINAL_SEQUENCE_HEAD_NAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      testHooks.observeIo?.({ kind: 'sequence-head-read', status: 'missing' });
      return null;
    }
    throw error;
  }
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  const head = JSON.parse(serialized) as SemanticMutationTerminalSequenceHead;
  assertSequenceHeadInvariant(head);
  testHooks.observeIo?.({
    kind: 'sequence-head-read',
    status: 'valid',
    highestReservedSequence: head.highestReservedSequence
  });
  return head;
}

async function writeSemanticMutationTerminalSequenceHead(
  transactionRoot: string,
  requestIdentityDigest: string,
  highestReservedSequence: number,
  commitFence: SemanticMutationCommitFence,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<void> {
  const directory = terminalOrderDirectory(transactionRoot);
  const withoutRevision = {
    formatRevision: TERMINAL_SEQUENCE_HEAD_REVISION,
    highestReservedSequence
  } as const;
  const head = {
    ...withoutRevision,
    headRevision: sequenceHeadRevision(withoutRevision)
  };
  assertSequenceHeadInvariant(head);
  const temporary = path.join(directory, `.sequence-head-${process.pid}-${randomUUID()}.tmp`);
  try {
    await commitFence();
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
      await commitFence();
      await handle.writeFile(`${JSON.stringify(head, null, 2)}\n`, 'utf8');
      await commitFence();
      await handle.sync();
    } finally {
      await handle.close();
    }
    await commitFence();
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
    await replaceSemanticMutationFileAtomically(
      temporary,
      path.join(directory, TERMINAL_SEQUENCE_HEAD_NAME)
    );
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
    await fsyncDirectory(
      directory,
      commitFence,
      async () => {
        await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
      }
    );
    testHooks.observeIo?.({ kind: 'sequence-head-write', highestReservedSequence });
  } finally {
    await cleanupTerminalTemp(
      temporary,
      commitFence,
      async () => {
        await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
      }
    );
  }
}

export async function assertSemanticMutationTerminalCompletionReceipt(
  transactionRoot: string,
  requestIdentityDigest: string,
  state: RetainedTerminalState,
  terminalSequence: number,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<void> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  const completion = await readSemanticMutationTerminalCompletionBySequence(
    transactionRoot,
    terminalSequence,
    'exact',
    testHooks
  );
  if (!completion || completion.requestIdentityDigest !== requestIdentityDigest || completion.state !== state) {
    throw new Error('Semantic Mutation terminal record is not bound to its durable completion receipt');
  }
}

/**
 * Allocate a workspace-global completion sequence. Callers are serialized by the
 * workspace writer lease. The append-only receipt makes ordering survive crashes;
 * a crash before the terminal record is written leaves a harmless sequence gap.
 */
export async function reserveSemanticMutationTerminalSequence(
  transactionRoot: string,
  requestIdentityDigest: string,
  state: RetainedTerminalState,
  commitFence: SemanticMutationCommitFence,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<number> {
  if (!digestString(requestIdentityDigest) || !isRetainedTerminalState(state)) {
    throw new Error('Semantic Mutation terminal completion identity or state is invalid');
  }
  const directory = terminalOrderDirectory(transactionRoot);
  await commitFence();
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
  await mkdir(directory, { recursive: true });
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
  const head = await readSemanticMutationTerminalSequenceHead(transactionRoot, testHooks);
  if (head === null) {
    await assertInitialSemanticMutationTerminalOrderEmpty(transactionRoot, testHooks);
  }
  let highest = head?.highestReservedSequence ?? 0;

  // A crash may durably publish a receipt and stop before advancing the
  // internal head. Catch up exact receipts one at a time; never rescan steady
  // state and never reuse the orphaned terminal sequence.
  let terminalSequence: number;
  while (true) {
    terminalSequence = highest + 1;
    if (!Number.isSafeInteger(terminalSequence) || terminalSequence > MAX_TERMINAL_SEQUENCE) {
      throw new Error('Semantic Mutation terminal completion sequence is exhausted');
    }
    const interrupted = await readSemanticMutationTerminalCompletionBySequence(
      transactionRoot,
      terminalSequence,
      'head-catch-up',
      testHooks
    );
    if (!interrupted) break;
    await writeSemanticMutationTerminalSequenceHead(
      transactionRoot,
      requestIdentityDigest,
      terminalSequence,
      commitFence,
      testHooks
    );
    highest = terminalSequence;
  }
  const withoutRevision = {
    formatRevision: TERMINAL_COMPLETION_REVISION,
    terminalSequence,
    requestIdentityDigest,
    state
  } as const;
  const completion = {
    ...withoutRevision,
    completionRevision: completionRevision(withoutRevision)
  };
  const finalPath = path.join(directory, completionFileName(terminalSequence));
  const temporary = path.join(directory, `.completion-${process.pid}-${randomUUID()}.tmp`);
  try {
    await commitFence();
    await testHooks.beforeCompletionTempOpenAfterFence?.();
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
      await commitFence();
      await handle.writeFile(`${JSON.stringify(completion, null, 2)}\n`, 'utf8');
      await commitFence();
      await handle.sync();
    } finally {
      await handle.close();
    }
    await testHooks.afterCompletionTempFileClosed?.();
    await commitFence();
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
    await link(temporary, finalPath);
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
    await fsyncDirectory(
      directory,
      commitFence,
      async () => {
        await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
      }
    );
    testHooks.observeIo?.({ kind: 'completion-publish', terminalSequence });
    await testHooks.afterCompletionPublishedBeforeHeadWrite?.(terminalSequence);
    await writeSemanticMutationTerminalSequenceHead(
      transactionRoot,
      requestIdentityDigest,
      terminalSequence,
      commitFence,
      testHooks
    );
    return terminalSequence;
  } finally {
    await cleanupTerminalTemp(
      temporary,
      commitFence,
      async () => {
        await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
      }
    );
  }
}

function exactBase(value: unknown): boolean {
  return isPlainObject(value) && exactOwnKeys(value, [
    'transactionId', 'inputRevision', 'semanticRevision'
  ]) && nonEmptyString(value.transactionId) && nonEmptyString(value.inputRevision) &&
    nonEmptyString(value.semanticRevision);
}

function assertRejectedResultInvariant(
  result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>
): void {
  if (!isPlainObject(result) || !exactOwnKeys(result, [
    'contractVersion', 'requestId', 'requestRevision', 'planRevision', 'base',
    'resultRevision', 'status', 'sourceChanges', 'diagnostics'
  ], ['transactionId', 'attempted', 'actualDelta', 'impact', 'verification']) ||
    result.contractVersion !== '2' || result.status !== 'rejected' ||
    !nonEmptyString(result.requestId) || !digestString(result.requestRevision) ||
    !digestString(result.planRevision) || !exactBase(result.base) ||
    (result.transactionId !== undefined && !nonEmptyString(result.transactionId)) ||
    (result.attempted !== undefined && !exactBase(result.attempted)) ||
    !Array.isArray(result.sourceChanges) || !Array.isArray(result.diagnostics) ||
    result.diagnostics.length === 0 ||
    !canonicalEquals(result.diagnostics, canonicalDiagnostics(result.diagnostics))) {
    throw new Error('Rejected Semantic Mutation result violates the frozen terminal schema');
  }
  const { resultRevision: supplied, ...withoutRevision } = result;
  if (supplied !== semanticMutationResultRevision(withoutRevision)) {
    throw new Error('Rejected Semantic Mutation result revision is invalid');
  }
}

export function assertSemanticMutationRejectedTerminalRecordInvariant(
  record: SemanticMutationRejectedTerminalRecord
): void {
  if (!isPlainObject(record) || !exactOwnKeys(record, [
    'formatRevision', 'requestIdentityDigest', 'requestRevision', 'planRevision',
    'terminalSequence', 'result', 'recordRevision'
  ])) {
    throw new Error('Rejected Semantic Mutation terminal record violates the frozen v1 schema');
  }
  assertRejectedResultInvariant(record.result);
  const { recordRevision: supplied, ...withoutRevision } = record;
  if (record.formatRevision !== SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION ||
    !digestString(record.requestIdentityDigest) || !digestString(record.requestRevision) ||
    !digestString(record.planRevision) || !Number.isSafeInteger(record.terminalSequence) ||
    record.terminalSequence <= 0 || record.requestRevision !== record.result.requestRevision ||
    record.planRevision !== record.result.planRevision || supplied !== recordRevision(withoutRevision)) {
    throw new Error('Rejected Semantic Mutation terminal record is invalid');
  }
}

export async function readRejectedSemanticMutationTerminal(
  transactionRoot: string,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationRejectedTerminalRecord | null> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  let parsed: SemanticMutationRejectedTerminalRecord;
  try {
    const serialized = await readFile(path.join(transactionRoot, TERMINAL_NAME), 'utf8');
    await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
    parsed = JSON.parse(serialized) as SemanticMutationRejectedTerminalRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  assertSemanticMutationRejectedTerminalRecordInvariant(parsed);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, parsed.requestIdentityDigest);
  await assertSemanticMutationTerminalCompletionReceipt(
    transactionRoot,
    parsed.requestIdentityDigest,
    'rejected',
    parsed.terminalSequence,
    testHooks
  );
  return cloneAndDeepFreeze(parsed);
}

export async function writeRejectedSemanticMutationTerminal(
  transactionRoot: string,
  requestIdentityDigest: string,
  requestRevision: string,
  planRevision: string,
  result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>,
  commitFence: SemanticMutationCommitFence,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationRejectedTerminalRecord> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await commitFence();
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  await mkdir(transactionRoot, { recursive: true });
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  const existing = await readRejectedSemanticMutationTerminal(transactionRoot, testHooks);
  if (existing) {
    if (existing.requestIdentityDigest !== requestIdentityDigest ||
      existing.requestRevision !== requestRevision || existing.planRevision !== planRevision ||
      !canonicalEquals(existing.result, result)) {
      throw new Error('Rejected Semantic Mutation terminal identity is already bound to different evidence');
    }
    return existing;
  }
  assertRejectedResultInvariant(result);
  if (!digestString(requestIdentityDigest) || requestRevision !== result.requestRevision ||
    planRevision !== result.planRevision) {
    throw new Error('Rejected Semantic Mutation terminal input is not cross-bound to its result');
  }
  const terminalSequence = await reserveSemanticMutationTerminalSequence(
    transactionRoot,
    requestIdentityDigest,
    'rejected',
    commitFence,
    testHooks
  );
  const withoutRevision = {
    formatRevision: SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION,
    requestIdentityDigest,
    requestRevision,
    planRevision,
    terminalSequence,
    result
  } as const;
  const record = cloneAndDeepFreeze({
    ...withoutRevision,
    recordRevision: recordRevision(withoutRevision)
  });
  assertSemanticMutationRejectedTerminalRecordInvariant(record);
  const temporary = path.join(transactionRoot, `.terminal-${randomUUID()}.tmp`);
  try {
    await commitFence();
    await testHooks.beforeRejectedTempOpenAfterFence?.();
    await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
      await commitFence();
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await commitFence();
      await handle.sync();
    } finally {
      await handle.close();
    }
    await testHooks.afterRejectedTempFileClosed?.();
    await commitFence();
    await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
    await rename(temporary, path.join(transactionRoot, TERMINAL_NAME));
    await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
    await fsyncDirectory(
      transactionRoot,
      commitFence,
      async () => {
        await assertSemanticMutationTransactionRoot(
          workspaceRoot,
          transactionRoot,
          requestIdentityDigest
        );
      }
    );
    return record;
  } finally {
    await cleanupTerminalTemp(
      temporary,
      commitFence,
      async () => {
        await assertSemanticMutationTransactionRoot(
          workspaceRoot,
          transactionRoot,
          requestIdentityDigest
        );
      }
    );
  }
}
