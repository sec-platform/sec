import { link, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION,
  type SemanticMutationRejectedTerminalRecordV1
} from '../../shared/semantic-mutation-transaction-types.ts';
import type { SemanticMutationResultV2 } from '../../shared/semantic-mutation-types.ts';
import {
  canonicalDiagnostics,
  cloneAndDeepFreeze,
  digestString,
  exactOwnKeys,
  isPlainObject,
  nonEmptyString,
  sha256
} from './canonical.ts';
import { semanticMutationResultRevision } from './semantic-mutation-result.ts';
import {
  assertSemanticMutationTerminalOrderDirectory,
  assertSemanticMutationTransactionRoot,
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

interface SemanticMutationTerminalCompletionV1 {
  readonly formatRevision: typeof TERMINAL_COMPLETION_REVISION;
  readonly terminalSequence: number;
  readonly requestIdentityDigest: string;
  readonly state: RetainedTerminalState;
  readonly completionRevision: string;
}

interface SemanticMutationTerminalSequenceHeadV1 {
  readonly formatRevision: typeof TERMINAL_SEQUENCE_HEAD_REVISION;
  readonly highestReservedSequence: number;
  readonly headRevision: string;
}

type TerminalCompletionReadReason = 'legacy-bootstrap' | 'exact' | 'head-catch-up';

export type SemanticMutationTerminalIoObservation =
  | { readonly kind: 'terminal-order-scan'; readonly reason: 'legacy-bootstrap' }
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
  value: Omit<SemanticMutationRejectedTerminalRecordV1, 'recordRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-rejected-terminal-record-v1', ...value });
}

function completionRevision(
  value: Omit<SemanticMutationTerminalCompletionV1, 'completionRevision'>
): string {
  return sha256({ domain: TERMINAL_COMPLETION_REVISION, ...value });
}

function sequenceHeadRevision(
  value: Omit<SemanticMutationTerminalSequenceHeadV1, 'headRevision'>
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

function isRetainedTerminalState(value: unknown): value is RetainedTerminalState {
  return value === 'rejected' || value === 'verified' || value === 'rolled-back';
}

function assertCompletionInvariant(
  completion: SemanticMutationTerminalCompletionV1,
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

function assertSequenceHeadInvariant(head: SemanticMutationTerminalSequenceHeadV1): void {
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
): Promise<SemanticMutationTerminalCompletionV1 | null> {
  if (!Number.isSafeInteger(terminalSequence) || terminalSequence <= 0 ||
    terminalSequence > MAX_TERMINAL_SEQUENCE) {
    throw new Error('Semantic Mutation terminal completion sequence is invalid');
  }
  const directory = await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  const name = completionFileName(terminalSequence);
  let serialized: string;
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
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
  const completion = JSON.parse(serialized) as SemanticMutationTerminalCompletionV1;
  assertCompletionInvariant(completion, name);
  testHooks.observeIo?.({ kind: 'completion-probe', reason, terminalSequence, status: 'valid' });
  return completion;
}

async function auditLegacySemanticMutationTerminalCompletions(
  transactionRoot: string,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<readonly SemanticMutationTerminalCompletionV1[]> {
  const directory = await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  if (path.basename(directory) !== TERMINAL_ORDER_DIRECTORY) {
    throw new Error('Semantic Mutation terminal order directory binding is invalid');
  }
  let names: string[];
  try {
    testHooks.observeIo?.({ kind: 'terminal-order-scan', reason: 'legacy-bootstrap' });
    names = (await readdir(directory)).filter((name) => !name.startsWith('.')).sort();
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const sequences = new Set<number>();
  const completions: SemanticMutationTerminalCompletionV1[] = [];
  for (const name of names) {
    if (!/^\d{12}\.json$/u.test(name)) {
      throw new Error('Semantic Mutation terminal order directory contains an unknown durable entry');
    }
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
    const serialized = await readFile(path.join(directory, name), 'utf8');
    await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
    const completion = JSON.parse(serialized) as SemanticMutationTerminalCompletionV1;
    assertCompletionInvariant(completion, name);
    if (sequences.has(completion.terminalSequence)) {
      throw new Error('Semantic Mutation terminal completion sequences must be unique');
    }
    sequences.add(completion.terminalSequence);
    completions.push(completion);
    testHooks.observeIo?.({
      kind: 'completion-probe',
      reason: 'legacy-bootstrap',
      terminalSequence: completion.terminalSequence,
      status: 'valid'
    });
  }
  return completions;
}

async function readSemanticMutationTerminalSequenceHead(
  transactionRoot: string,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationTerminalSequenceHeadV1 | null> {
  const directory = await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
  let serialized: string;
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot);
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
  const head = JSON.parse(serialized) as SemanticMutationTerminalSequenceHeadV1;
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
  const directory = await assertSemanticMutationTerminalOrderDirectory(
    transactionRoot,
    requestIdentityDigest
  );
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
  const directory = await assertSemanticMutationTerminalOrderDirectory(
    transactionRoot,
    requestIdentityDigest
  );
  await commitFence();
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
  await mkdir(directory, { recursive: true });
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
  const head = await readSemanticMutationTerminalSequenceHead(transactionRoot, testHooks);
  let highest = head?.highestReservedSequence ?? (await auditLegacySemanticMutationTerminalCompletions(
    transactionRoot,
    testHooks
  )).reduce((current, completion) => Math.max(current, completion.terminalSequence), 0);

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
  result: Extract<SemanticMutationResultV2, { readonly status: 'rejected' }>
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
    JSON.stringify(result.diagnostics) !== JSON.stringify(canonicalDiagnostics(result.diagnostics))) {
    throw new Error('Rejected Semantic Mutation result violates the frozen terminal schema');
  }
  const { resultRevision: supplied, ...withoutRevision } = result;
  if (supplied !== semanticMutationResultRevision(withoutRevision)) {
    throw new Error('Rejected Semantic Mutation result revision is invalid');
  }
}

export function assertSemanticMutationRejectedTerminalRecordInvariant(
  record: SemanticMutationRejectedTerminalRecordV1
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
): Promise<SemanticMutationRejectedTerminalRecordV1 | null> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  let parsed: SemanticMutationRejectedTerminalRecordV1;
  try {
    const serialized = await readFile(path.join(transactionRoot, TERMINAL_NAME), 'utf8');
    await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
    parsed = JSON.parse(serialized) as SemanticMutationRejectedTerminalRecordV1;
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
  result: Extract<SemanticMutationResultV2, { readonly status: 'rejected' }>,
  commitFence: SemanticMutationCommitFence,
  testHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationRejectedTerminalRecordV1> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  await commitFence();
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  await mkdir(transactionRoot, { recursive: true });
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  const existing = await readRejectedSemanticMutationTerminal(transactionRoot, testHooks);
  if (existing) {
    if (existing.requestIdentityDigest !== requestIdentityDigest ||
      existing.requestRevision !== requestRevision || existing.planRevision !== planRevision ||
      JSON.stringify(existing.result) !== JSON.stringify(result)) {
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
