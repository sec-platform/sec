import path from 'node:path';
import { cloneAndDeepFreeze, compareCodeUnits } from '../../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequestIdentityDigest } from '../../compiler/semantic-mutation/identity.ts';
import {
  assertSemanticMutationRecoveryRecordInvariant,
  isSemanticMutationRecoveryTransitionAllowed,
  isSemanticMutationRetainedTerminalState,
  semanticMutationRecoveryRecordRevision
} from '../../compiler/semantic-mutation/recovery-record.ts';
import { SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION, SEMANTIC_MUTATION_TERMINAL_RETENTION, type SemanticMutationRecoveryRecord, type SemanticMutationRecoveryState, type SemanticMutationRequestIdentity, type SemanticMutationRequestRecord } from '../../semantics/mutation/transaction.ts';
import { semanticMutationTransactionsRoot } from '../../workspace/contract/semantic-mutation/state-layout.ts';
import {
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowOrdinaryFileEntry,
  PhysicalNoFollowError,
  retainNoFollowFileTransaction,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowFileTransaction
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { retainOptionalDirectory } from '../runtime-state/physical/runtime/retained-file-read.ts';
import {
  assertSemanticMutationTerminalCompletionReceipt,
  readRejectedSemanticMutationTerminal,
  reserveSemanticMutationTerminalSequence,
  type SemanticMutationTerminalWriteTestHooks
} from './mutation-terminal-record.ts';
import { createSemanticMutationRecoveryRecordsDirectory } from './transaction-directories.ts';
import { inspectSemanticMutationStateLayoutStatus } from './state-layout-migration.ts';
import {
  assertSemanticMutationRecoveryRecordsDirectory,
  assertSemanticMutationTransactionRoot,
  semanticMutationLegacyTransactionRoot,
  semanticMutationTransactionRoot,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';

const SEMANTIC_MUTATION_TERMINAL_RETIREMENT_MAXIMUM_ENTRIES = 100_000;
const SEMANTIC_MUTATION_TERMINAL_RETIREMENT_DEADLINE_MS = 30_000;

type RecoveryRecordDraft = Omit<
  SemanticMutationRecoveryRecord,
  'formatRevision' | 'sequence' | 'previousRecordRevision' | 'terminalSequence' | 'recordRevision'
>;

export interface SemanticMutationRecoveryRecordWriteTestHooks {
  readonly beforeTempOpenAfterFence?: () => Promise<void>;
  readonly afterTempFileClosed?: () => Promise<void>;
  readonly terminal?: SemanticMutationTerminalWriteTestHooks;
}

function generationName(sequence: number, state: SemanticMutationRecoveryState): string {
  return `${sequence.toString().padStart(6, '0')}-${state}.json`;
}

function samePhysicalDirectoryIdentity(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.path === right.path
    && left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

function assertRetainedTransactionRoot(
  transactionRoot: string,
  retained: RetainedNoFollowFileTransaction
): void {
  if (retained.rootPath !== path.resolve(transactionRoot)) {
    throw new Error('Semantic Mutation retained transaction root differs from the requested root');
  }
  retained.assertCurrent();
}

export type SemanticMutationTransactionCensusEntry = Readonly<{
  relativePath: string;
  kind: 'directory';
  device: string;
  inode: string;
}>;

export function scanSemanticMutationTransactionCensus(
  transactionsParent: PhysicalDirectoryIdentity
): readonly SemanticMutationTransactionCensusEntry[] {
  return Object.freeze(scanNoFollowDirectoryDirectMetadata(transactionsParent, {
    deadlineAtMs: performance.now() + SEMANTIC_MUTATION_TERMINAL_RETIREMENT_DEADLINE_MS,
    maximumEntries: SEMANTIC_MUTATION_TERMINAL_RETIREMENT_MAXIMUM_ENTRIES
  }).map((entry) => {
    if (entry.kind !== 'directory' || !/^[0-9a-f]{64}$/u.test(entry.relativePath)) {
      throw new Error(
        'Semantic Mutation transactions root contains an invalid or non-directory transaction entry'
      );
    }
    return Object.freeze({
      relativePath: entry.relativePath,
      kind: 'directory' as const,
      device: entry.device,
      inode: entry.inode
    });
  }).sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
}

export function assertSameSemanticMutationTransactionCensus(
  expected: readonly SemanticMutationTransactionCensusEntry[],
  current: readonly SemanticMutationTransactionCensusEntry[]
): void {
  if (JSON.stringify(expected) !== JSON.stringify(current)) {
    throw new Error('Semantic Mutation transaction census changed before terminal retirement');
  }
}

export async function loadSemanticMutationRecoveryRecords(
  transactionRoot: string,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {},
  retainedTransaction?: RetainedNoFollowFileTransaction
): Promise<readonly SemanticMutationRecoveryRecord[]> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  const directory = await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot);
  let recordsDirectory: PhysicalDirectoryIdentity | null = null;
  if (retainedTransaction === undefined) {
    recordsDirectory = retainOptionalDirectory(
      directory,
      'Semantic Mutation recovery records directory'
    );
  } else {
    assertRetainedTransactionRoot(transactionRoot, retainedTransaction);
    const presence = inspectExactNoFollowDirectoryPresence(
      directory,
      'Semantic Mutation recovery records directory'
    );
    if (presence.state === 'present') {
      const retainedRootAncestor = presence.directory.ancestors.find(
        ({ path: ancestorPath }) => ancestorPath === retainedTransaction.rootPath
      );
      if (retainedRootAncestor === undefined
          || !samePhysicalDirectoryIdentity(
            retainedRootAncestor,
            retainedTransaction.rootIdentity
          )) {
        throw new Error('Semantic Mutation recovery records directory escaped the retained transaction root');
      }
      recordsDirectory = presence.directory.target;
    }
  }
  if (recordsDirectory === null) {
    retainedTransaction?.assertCurrent();
    return [];
  }
  const generationEntries = scanNoFollowDirectoryDirectMetadata(recordsDirectory, {
    deadlineAtMs: performance.now() + 5000,
    maximumEntries: 64
  })
    .filter(({ relativePath }) => /^\d{6}-.+\.json$/u.test(relativePath))
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  const records: SemanticMutationRecoveryRecord[] = [];
  for (const generation of generationEntries) {
    if (generation.kind !== 'file') {
      throw new Error('Semantic Mutation recovery generation is not an ordinary file');
    }
    const observed = retainedTransaction === undefined
      ? inspectNoFollowOrdinaryFileEntry(recordsDirectory, generation.relativePath)
      : (() => {
          const retained = retainedTransaction.observe(
            `records/${generation.relativePath}`,
            `Semantic Mutation recovery generation ${generation.relativePath}`
          );
          return retained === null ? null : {
            kind: 'file' as const,
            device: retained.identity.device,
            inode: retained.identity.inode,
            bytes: retained.bytes
          };
        })();
    if (observed === null || observed.kind !== 'file'
        || observed.device !== generation.device || observed.inode !== generation.inode) {
      throw new Error('Semantic Mutation recovery generation changed after retained enumeration');
    }
    const name = generation.relativePath;
    const serialized = Buffer.from(observed.bytes!).toString('utf8');
    const parsed = JSON.parse(serialized) as SemanticMutationRecoveryRecord;
    assertSemanticMutationRecoveryRecordInvariant(parsed, records.at(-1));
    await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, parsed.requestIdentityDigest);
    if (parsed.terminalSequence !== undefined &&
      (parsed.state === 'verified' || parsed.state === 'rolled-back')) {
      await assertSemanticMutationTerminalCompletionReceipt(
        transactionRoot,
        parsed.requestIdentityDigest,
        parsed.state,
        parsed.terminalSequence,
        terminalTestHooks
      );
    }
    if (name !== generationName(parsed.sequence, parsed.state)) {
      throw new Error('Semantic Mutation recovery generation filename does not match record state');
    }
    records.push(cloneAndDeepFreeze(parsed));
  }
  retainedTransaction?.assertCurrent();
  return records;
}

export async function loadLatestSemanticMutationRecoveryRecord(
  transactionRoot: string,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {},
  retainedTransaction?: RetainedNoFollowFileTransaction
): Promise<SemanticMutationRecoveryRecord | null> {
  return (await loadSemanticMutationRecoveryRecords(
    transactionRoot,
    terminalTestHooks,
    retainedTransaction
  )).at(-1) ?? null;
}

export async function appendSemanticMutationRecoveryRecord(
  transactionRoot: string,
  draft: RecoveryRecordDraft,
  commitFence: SemanticMutationCommitFence,
  testHooks: SemanticMutationRecoveryRecordWriteTestHooks = {}
): Promise<SemanticMutationRecoveryRecord> {
  await createSemanticMutationRecoveryRecordsDirectory(
    transactionRoot,
    draft.requestIdentityDigest,
    commitFence
  );
  const transaction = retainNoFollowFileTransaction(
    transactionRoot,
    'Semantic Mutation recovery record publication'
  );
  const previous = await loadLatestSemanticMutationRecoveryRecord(
    transactionRoot,
    testHooks.terminal,
    transaction
  );
  if ((previous === null && draft.state !== 'prepared') ||
    (previous !== null && !isSemanticMutationRecoveryTransitionAllowed(previous.state, draft.state))) {
    transaction.dispose();
    throw new Error('Semantic Mutation recovery state transition is not allowed');
  }
  const terminalSequence = isSemanticMutationRetainedTerminalState(draft.state)
    ? await reserveSemanticMutationTerminalSequence(
         transactionRoot,
         draft.requestIdentityDigest,
         draft.state as 'verified' | 'rolled-back',
         commitFence,
         testHooks.terminal
       )
    : undefined;
  const withoutRevision = {
    formatRevision: SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION,
    sequence: (previous?.sequence ?? 0) + 1,
    previousRecordRevision: previous?.recordRevision ?? '',
    ...structuredClone(draft),
    ...(terminalSequence === undefined ? {} : { terminalSequence })
  } as Omit<SemanticMutationRecoveryRecord, 'recordRevision'>;
  const record = cloneAndDeepFreeze({
    ...withoutRevision,
    recordRevision: semanticMutationRecoveryRecordRevision(withoutRevision)
  }) as SemanticMutationRecoveryRecord;
  assertSemanticMutationRecoveryRecordInvariant(record, previous ?? undefined);
  const finalName = `records/${generationName(record.sequence, record.state)}`;
  const temporaryName = `records/.record-${process.pid}-${crypto.randomUUID()}.tmp`;
  try {
    await commitFence();
    await testHooks.beforeTempOpenAfterFence?.();
    transaction.assertCurrent();
    await transaction.createExclusive(
      temporaryName,
      Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'),
      'Semantic Mutation recovery record candidate',
      0o600
    );
    await testHooks.afterTempFileClosed?.();
    await commitFence();
    transaction.assertCurrent();
    const candidate = transaction.observe(
      temporaryName,
      'Semantic Mutation recovery record candidate readback'
    );
    if (candidate === null) {
      throw new Error('Semantic Mutation recovery record candidate disappeared before publication');
    }
    await transaction.renameNoReplace(
      temporaryName,
      finalName,
      candidate,
      'Semantic Mutation recovery record publication'
    );
    return record;
  } finally {
    try {
      const residue = transaction.observe(
        temporaryName,
        'Semantic Mutation recovery record candidate cleanup'
      );
      if (residue !== null) {
        await transaction.removeExact(
          temporaryName,
          residue,
          'Semantic Mutation recovery record candidate cleanup'
        );
      }
    } finally {
      transaction.dispose();
    }
  }
}

export async function querySemanticMutationRequestRecord(
  workspaceRoot: string,
  identity: SemanticMutationRequestIdentity,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationRequestRecord | null> {
  const status = inspectSemanticMutationStateLayoutStatus(workspaceRoot);
  if (status === 'ambiguous') {
    throw new Error('Semantic Mutation request query found both current and legacy state roots');
  }
  if (status === 'absent') return null;
  const digest = semanticMutationRequestIdentityDigest(identity);
  const transactionRoot = status === 'legacy'
    ? semanticMutationLegacyTransactionRoot(workspaceRoot, digest)
    : semanticMutationTransactionRoot(workspaceRoot, digest);
  return (await readRejectedSemanticMutationTerminal(transactionRoot, terminalTestHooks)) ??
    loadLatestSemanticMutationRecoveryRecord(transactionRoot, terminalTestHooks);
}

async function pruneSemanticMutationTerminalRecordsAtRoot(
  transactionsRoot: string,
  commitFence: SemanticMutationCommitFence,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks
): Promise<boolean> {
  const transactionsParent = retainOptionalDirectory(
    transactionsRoot,
    'Semantic Mutation transactions root'
  );
  if (transactionsParent === null) return false;
  terminalTestHooks.observeIo?.({ kind: 'transactions-scan' });
  const initialCensus = scanSemanticMutationTransactionCensus(transactionsParent);
  const identities = initialCensus.map(({ relativePath }) => relativePath);
  const terminals: Array<{
    root: string;
    rootIdentity: PhysicalDirectoryIdentity;
    parentIdentity: PhysicalDirectoryIdentity;
    inventory: ReturnType<typeof scanNoFollowDirectoryTreeMetadata>;
    requestIdentityDigest: string;
    terminalSequence: number;
  }> = [];
  for (const identity of identities) {
    const root = path.join(transactionsRoot, identity);
    let retained: RetainedNoFollowFileTransaction;
    try {
      retained = retainNoFollowFileTransaction(
        root,
        `Semantic Mutation terminal prune ${identity}`
      );
    } catch (error) {
      if (error instanceof PhysicalNoFollowError
          && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') continue;
      throw error;
    }
    try {
      const rejected = await readRejectedSemanticMutationTerminal(
        root,
        terminalTestHooks,
        retained
      );
      const recovery = await loadLatestSemanticMutationRecoveryRecord(
        root,
        terminalTestHooks,
        retained
      );
      if (recovery?.state === 'recovery-required') continue;
      const terminal = rejected !== null
        ? {
            requestIdentityDigest: rejected.requestIdentityDigest,
            terminalSequence: rejected.terminalSequence
          }
        : recovery !== null
          && isSemanticMutationRetainedTerminalState(recovery.state)
          && recovery.terminalSequence !== undefined
            ? {
                requestIdentityDigest: recovery.requestIdentityDigest,
                terminalSequence: recovery.terminalSequence
              }
            : null;
      if (terminal === null) continue;
      retained.assertCurrent();
      const inventory = scanNoFollowDirectoryTreeMetadata(retained.rootIdentity, {
        deadlineAtMs: performance.now() + SEMANTIC_MUTATION_TERMINAL_RETIREMENT_DEADLINE_MS,
        maximumEntries: SEMANTIC_MUTATION_TERMINAL_RETIREMENT_MAXIMUM_ENTRIES
      });
      retained.assertCurrent();
      if (path.dirname(retained.rootIdentity.path) !== transactionsParent.path) {
        throw new Error('Semantic Mutation terminal prune root is no longer a direct transaction child');
      }
      terminals.push({
        root,
        rootIdentity: retained.rootIdentity,
        parentIdentity: transactionsParent,
        inventory,
        ...terminal
      });
    } finally {
      retained.dispose();
    }
  }
  const sequenceSet = new Set(terminals.map((entry) => entry.terminalSequence));
  if (sequenceSet.size !== terminals.length) {
    throw new Error('Semantic Mutation terminal records contain duplicate workspace completion sequences');
  }
  terminals.sort((left, right) => right.terminalSequence - left.terminalSequence ||
    compareCodeUnits(left.requestIdentityDigest, right.requestIdentityDigest));
  assertSameSemanticMutationTransactionCensus(
    initialCensus,
    scanSemanticMutationTransactionCensus(transactionsParent)
  );
  for (const terminal of terminals.slice(SEMANTIC_MUTATION_TERMINAL_RETENTION)) {
    await commitFence();
    retireNoFollowDirectoryTree({
      deadlineAtMonotonicMs:
        performance.now() + SEMANTIC_MUTATION_TERMINAL_RETIREMENT_DEADLINE_MS,
      inventory: terminal.inventory,
      parent: terminal.parentIdentity,
      root: terminal.rootIdentity
    });
  }
  return true;
}

export async function pruneSemanticMutationTerminalRecords(
  workspaceRoot: string,
  commitFence: SemanticMutationCommitFence,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<void> {
  const root = path.resolve(workspaceRoot);
  const status = inspectSemanticMutationStateLayoutStatus(root);
  if (status === 'ambiguous') {
    throw new Error('Semantic Mutation terminal prune found both current and legacy state roots');
  }
  if (status === 'absent') return;
  const transactionsRoot = semanticMutationTransactionsRoot(
    root,
    status === 'legacy' ? 'legacy' : 'current'
  );
  await pruneSemanticMutationTerminalRecordsAtRoot(
    transactionsRoot,
    commitFence,
    terminalTestHooks
  );
}
