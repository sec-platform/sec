import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SemanticMutationRejectedTerminalRecord } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationResult } from '../../semantics/mutation/types.ts';
import { canonicalEquals, cloneAndDeepFreeze, digestString, exactOwnKeys, isPlainObject, sha256 } from '../../compiler/semantic-mutation/canonical.ts';
import {
  assertSemanticMutationRejectedTerminalRecordInvariant,
  buildSemanticMutationRejectedTerminalRecord
} from '../../compiler/semantic-mutation/rejected-terminal.ts';
import {
  assertSemanticMutationTerminalOrderDirectory,
  assertSemanticMutationTransactionRoot,
  semanticMutationJournalRoot,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
import {
  inspectNoFollowOrdinaryFileEntry,
  replaceDurableCanonicalFile,
  retainNoFollowFileTransaction,
  scanNoFollowDirectoryDirectMetadata,
  type RetainedNoFollowFileTransaction
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryLeaf,
  retainOptionalDirectory
} from '../runtime-state/physical/runtime/retained-file-read.ts';
import {
  createSemanticMutationTerminalOrderDirectory,
  createSemanticMutationTransactionDirectory
} from './transaction-directories.ts';

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
  const retainedDirectory = retainOptionalDirectory(
    directory,
    'Semantic Mutation terminal completion directory'
  );
  if (retainedDirectory === null) {
    testHooks.observeIo?.({
      kind: 'completion-probe',
      reason,
      terminalSequence,
      status: 'missing'
    });
    return null;
  }
  const bytes = readOptionalRetainedOrdinaryLeaf(retainedDirectory, name);
  if (bytes === null) {
    testHooks.observeIo?.({
      kind: 'completion-probe',
      reason,
      terminalSequence,
      status: 'missing'
    });
    return null;
  }
  const completion = JSON.parse(
    decodeExactUtf8(bytes, 'Semantic Mutation terminal completion')
  ) as SemanticMutationTerminalCompletion;
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
  testHooks.observeIo?.({ kind: 'terminal-order-scan', reason: 'initial-empty-check' });
  const retainedDirectory = retainOptionalDirectory(
    directory,
    'Semantic Mutation terminal order directory'
  );
  if (retainedDirectory === null) return;
  const visible = scanNoFollowDirectoryDirectMetadata(retainedDirectory, {
    deadlineAtMs: performance.now() + 5000,
    maximumEntries: 64
  }).filter(({ relativePath }) => !relativePath.startsWith('.'));
  if (visible.length > 0) {
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
  const retainedDirectory = retainOptionalDirectory(
    directory,
    'Semantic Mutation terminal sequence directory'
  );
  if (retainedDirectory === null) {
    testHooks.observeIo?.({ kind: 'sequence-head-read', status: 'missing' });
    return null;
  }
  const bytes = readOptionalRetainedOrdinaryLeaf(retainedDirectory, TERMINAL_SEQUENCE_HEAD_NAME);
  if (bytes === null) {
    testHooks.observeIo?.({ kind: 'sequence-head-read', status: 'missing' });
    return null;
  }
  const head = JSON.parse(
    decodeExactUtf8(bytes, 'Semantic Mutation terminal sequence head')
  ) as SemanticMutationTerminalSequenceHead;
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
  await commitFence();
  await assertSemanticMutationTerminalOrderDirectory(transactionRoot, requestIdentityDigest);
  const retainedDirectory = retainOptionalDirectory(
    directory,
    'Semantic Mutation terminal sequence publication directory'
  );
  if (retainedDirectory === null) {
    throw new Error('Semantic Mutation terminal sequence directory disappeared before publication');
  }
  const current = inspectNoFollowOrdinaryFileEntry(
    retainedDirectory,
    TERMINAL_SEQUENCE_HEAD_NAME
  );
  await commitFence();
  replaceDurableCanonicalFile({
    parent: retainedDirectory,
    name: TERMINAL_SEQUENCE_HEAD_NAME,
    bytes: Buffer.from(`${JSON.stringify(head, null, 2)}\n`, 'utf8'),
    expectedExisting: current === null
      ? null
      : { device: current.device, inode: current.inode },
    validate: (bytes) => {
      const parsed = JSON.parse(
        decodeExactUtf8(bytes, 'Semantic Mutation terminal sequence head publication')
      ) as SemanticMutationTerminalSequenceHead;
      assertSequenceHeadInvariant(parsed);
      if (!canonicalEquals(parsed, head)) {
        throw new Error('Semantic Mutation terminal sequence head publication differs');
      }
    }
  });
  testHooks.observeIo?.({ kind: 'sequence-head-write', highestReservedSequence });
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
  await createSemanticMutationTerminalOrderDirectory(
    transactionRoot,
    requestIdentityDigest,
    commitFence
  );
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
  const finalName = completionFileName(terminalSequence);
  const temporaryName = `.completion-${process.pid}-${randomUUID()}.tmp`;
  const transaction = retainNoFollowFileTransaction(
    directory,
    'Semantic Mutation terminal completion publication'
  );
  try {
    await commitFence();
    await testHooks.beforeCompletionTempOpenAfterFence?.();
    transaction.assertCurrent();
    await transaction.createExclusive(
      temporaryName,
      Buffer.from(`${JSON.stringify(completion, null, 2)}\n`, 'utf8'),
      'Semantic Mutation terminal completion candidate',
      0o600
    );
    await testHooks.afterCompletionTempFileClosed?.();
    await commitFence();
    transaction.assertCurrent();
    const candidate = transaction.observe(
      temporaryName,
      'Semantic Mutation terminal completion candidate readback'
    );
    if (candidate === null) {
      throw new Error('Semantic Mutation terminal completion candidate disappeared before publication');
    }
    await transaction.renameNoReplace(
      temporaryName,
      finalName,
      candidate,
      'Semantic Mutation terminal completion publication'
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
    try {
      const residue = transaction.observe(
        temporaryName,
        'Semantic Mutation terminal completion candidate cleanup'
      );
      if (residue !== null) {
        await transaction.removeExact(
          temporaryName,
          residue,
          'Semantic Mutation terminal completion candidate cleanup'
        );
      }
    } finally {
      transaction.dispose();
    }
  }
}

export async function readRejectedSemanticMutationTerminal(
  transactionRoot: string,
  testHooks: SemanticMutationTerminalWriteTestHooks = {},
  retainedTransaction?: RetainedNoFollowFileTransaction
): Promise<SemanticMutationRejectedTerminalRecord | null> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  let bytes: Uint8Array | null;
  if (retainedTransaction !== undefined) {
    if (retainedTransaction.rootPath !== path.resolve(transactionRoot)) {
      throw new Error('Rejected Semantic Mutation terminal retained root differs from the transaction root');
    }
    retainedTransaction.assertCurrent();
    bytes = retainedTransaction.observe(
      TERMINAL_NAME,
      'Rejected Semantic Mutation terminal'
    )?.bytes ?? null;
  } else {
    const retainedRoot = retainOptionalDirectory(
      transactionRoot,
      'Rejected Semantic Mutation terminal root'
    );
    bytes = retainedRoot === null
      ? null
      : readOptionalRetainedOrdinaryLeaf(retainedRoot, TERMINAL_NAME);
  }
  if (bytes === null) return null;
  const parsed = JSON.parse(
    decodeExactUtf8(bytes, 'Rejected Semantic Mutation terminal')
  ) as SemanticMutationRejectedTerminalRecord;
  assertSemanticMutationRejectedTerminalRecordInvariant(parsed);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, parsed.requestIdentityDigest);
  await assertSemanticMutationTerminalCompletionReceipt(
    transactionRoot,
    parsed.requestIdentityDigest,
    'rejected',
    parsed.terminalSequence,
    testHooks
  );
  retainedTransaction?.assertCurrent();
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
  await createSemanticMutationTransactionDirectory(
    workspaceRoot,
    transactionRoot,
    commitFence
  );
  await assertSemanticMutationTransactionRoot(
    workspaceRoot,
    transactionRoot,
    requestIdentityDigest
  );
  const transaction = retainNoFollowFileTransaction(
    transactionRoot,
    'Rejected Semantic Mutation terminal publication'
  );
  const temporaryName = `.terminal-${randomUUID()}.tmp`;
  try {
    const existing = await readRejectedSemanticMutationTerminal(
      transactionRoot,
      testHooks,
      transaction
    );
    if (existing) {
      if (existing.requestIdentityDigest !== requestIdentityDigest ||
        existing.requestRevision !== requestRevision || existing.planRevision !== planRevision ||
        !canonicalEquals(existing.result, result)) {
        throw new Error('Rejected Semantic Mutation terminal identity is already bound to different evidence');
      }
      return existing;
    }
    const terminalSequence = await reserveSemanticMutationTerminalSequence(
      transactionRoot,
      requestIdentityDigest,
      'rejected',
      commitFence,
      testHooks
    );
    const record = buildSemanticMutationRejectedTerminalRecord({
      requestIdentityDigest,
      requestRevision,
      planRevision,
      terminalSequence,
      result
    });
    await commitFence();
    await testHooks.beforeRejectedTempOpenAfterFence?.();
    transaction.assertCurrent();
    await transaction.createExclusive(
      temporaryName,
      Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'),
      'Rejected Semantic Mutation terminal candidate',
      0o600
    );
    await testHooks.afterRejectedTempFileClosed?.();
    await commitFence();
    transaction.assertCurrent();
    const candidate = transaction.observe(
      temporaryName,
      'Rejected Semantic Mutation terminal candidate readback'
    );
    if (candidate === null) {
      throw new Error('Rejected Semantic Mutation terminal candidate disappeared before publication');
    }
    await transaction.renameNoReplace(
      temporaryName,
      TERMINAL_NAME,
      candidate,
      'Rejected Semantic Mutation terminal publication'
    );
    return record;
  } finally {
    try {
      const residue = transaction.observe(
        temporaryName,
        'Rejected Semantic Mutation terminal candidate cleanup'
      );
      if (residue !== null) {
        await transaction.removeExact(
          temporaryName,
          residue,
          'Rejected Semantic Mutation terminal candidate cleanup'
        );
      }
    } finally {
      transaction.dispose();
    }
  }
}
