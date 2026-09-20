import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION, SEMANTIC_MUTATION_TERMINAL_RETENTION, type SemanticMutationRecoveryRecord, type SemanticMutationRecoveryState, type SemanticMutationRequestIdentity, type SemanticMutationRequestRecord } from '../../semantics/mutation/transaction.ts';
import { cloneAndDeepFreeze, compareCodeUnits } from '../../compiler/semantic-mutation/canonical.ts';
import {
  assertSemanticMutationRecoveryRecordInvariant,
  isSemanticMutationRecoveryTransitionAllowed,
  isSemanticMutationRetainedTerminalState,
  semanticMutationRecoveryRecordRevision
} from '../../compiler/semantic-mutation/recovery-record.ts';
import {
  assertSemanticMutationTerminalCompletionReceipt,
  readRejectedSemanticMutationTerminal,
  reserveSemanticMutationTerminalSequence,
  type SemanticMutationTerminalWriteTestHooks
} from './mutation-terminal-record.ts';
import {
  assertSemanticMutationRecoveryRecordsDirectory,
  assertSemanticMutationTransactionRoot,
  semanticMutationTransactionRoot,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
import { semanticMutationRequestIdentityDigest } from '../../compiler/semantic-mutation/identity.ts';

type RecoveryRecordDraft = Omit<
  SemanticMutationRecoveryRecord,
  'formatRevision' | 'sequence' | 'previousRecordRevision' | 'terminalSequence' | 'recordRevision'
>;

export interface SemanticMutationRecoveryRecordWriteTestHooks {
  readonly beforeTempOpenAfterFence?: () => Promise<void>;
  readonly afterTempFileClosed?: () => Promise<void>;
  readonly terminal?: SemanticMutationTerminalWriteTestHooks;
}

async function fsyncDirectory(
  directory: string,
  commitFence: SemanticMutationCommitFence
): Promise<void> {
  const transactionRoot = path.dirname(directory);
  await commitFence();
  await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot);
  let handle;
  try {
    handle = await open(directory, 'r');
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot);
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

async function cleanupRecoveryRecordTemp(
  transactionRoot: string,
  requestIdentityDigest: string,
  tempPath: string,
  commitFence: SemanticMutationCommitFence
): Promise<void> {
  try {
    await commitFence();
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot, requestIdentityDigest);
    await rm(tempPath, { force: true });
  } catch {
    // Never replace the primary journal error or delete through an unproven path.
  }
}

function generationName(sequence: number, state: SemanticMutationRecoveryState): string {
  return `${sequence.toString().padStart(6, '0')}-${state}.json`;
}

export async function loadSemanticMutationRecoveryRecords(
  transactionRoot: string,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<readonly SemanticMutationRecoveryRecord[]> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  const directory = await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => /^\d{6}-.+\.json$/u.test(name)).sort();
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: SemanticMutationRecoveryRecord[] = [];
  for (const name of names) {
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot);
    const serialized = await readFile(path.join(directory, name), 'utf8');
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot);
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
  return records;
}

export async function loadLatestSemanticMutationRecoveryRecord(
  transactionRoot: string,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationRecoveryRecord | null> {
  return (await loadSemanticMutationRecoveryRecords(transactionRoot, terminalTestHooks)).at(-1) ?? null;
}

export async function appendSemanticMutationRecoveryRecord(
  transactionRoot: string,
  draft: RecoveryRecordDraft,
  commitFence: SemanticMutationCommitFence,
  testHooks: SemanticMutationRecoveryRecordWriteTestHooks = {}
): Promise<SemanticMutationRecoveryRecord> {
  const directory = await assertSemanticMutationRecoveryRecordsDirectory(
    transactionRoot,
    draft.requestIdentityDigest
  );
  await commitFence();
  await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot, draft.requestIdentityDigest);
  await mkdir(directory, { recursive: true });
  await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot, draft.requestIdentityDigest);
  const previous = await loadLatestSemanticMutationRecoveryRecord(transactionRoot, testHooks.terminal);
  if ((previous === null && draft.state !== 'prepared') ||
    (previous !== null && !isSemanticMutationRecoveryTransitionAllowed(previous.state, draft.state))) {
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
  const finalPath = path.join(directory, generationName(record.sequence, record.state));
  const tempPath = path.join(directory, `.record-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await commitFence();
    await testHooks.beforeTempOpenAfterFence?.();
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot, draft.requestIdentityDigest);
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot, draft.requestIdentityDigest);
      await commitFence();
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await commitFence();
      await handle.sync();
    } finally {
      await handle.close();
    }
    await testHooks.afterTempFileClosed?.();
    await commitFence();
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot, draft.requestIdentityDigest);
    await rename(tempPath, finalPath);
    await assertSemanticMutationRecoveryRecordsDirectory(transactionRoot, draft.requestIdentityDigest);
    await fsyncDirectory(directory, commitFence);
    return record;
  } finally {
    await cleanupRecoveryRecordTemp(
      transactionRoot,
      draft.requestIdentityDigest,
      tempPath,
      commitFence
    );
  }
}

export async function querySemanticMutationRequestRecord(
  workspaceRoot: string,
  identity: SemanticMutationRequestIdentity,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<SemanticMutationRequestRecord | null> {
  const digest = semanticMutationRequestIdentityDigest(identity);
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, digest);
  return (await readRejectedSemanticMutationTerminal(transactionRoot, terminalTestHooks)) ??
    loadLatestSemanticMutationRecoveryRecord(transactionRoot, terminalTestHooks);
}

export async function pruneSemanticMutationTerminalRecords(
  workspaceRoot: string,
  commitFence: SemanticMutationCommitFence,
  terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {}
): Promise<void> {
  const transactionsRoot = path.join(
    path.resolve(workspaceRoot),
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions'
  );
  let identities: string[];
  try {
    terminalTestHooks.observeIo?.({ kind: 'transactions-scan' });
    identities = (await readdir(transactionsRoot)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const terminals: Array<{
    root: string;
    requestIdentityDigest: string;
    terminalSequence: number;
  }> = [];
  for (const identity of identities) {
    const root = path.join(transactionsRoot, identity);
    const [rejected, recovery] = await Promise.all([
      readRejectedSemanticMutationTerminal(root, terminalTestHooks),
      loadLatestSemanticMutationRecoveryRecord(root, terminalTestHooks)
    ]);
    if (recovery?.state === 'recovery-required') continue;
    if (rejected) {
      terminals.push({
        root,
        requestIdentityDigest: rejected.requestIdentityDigest,
        terminalSequence: rejected.terminalSequence
      });
      continue;
    }
    if (!recovery || !isSemanticMutationRetainedTerminalState(recovery.state) ||
      recovery.terminalSequence === undefined) continue;
    terminals.push({
      root,
      requestIdentityDigest: recovery.requestIdentityDigest,
      terminalSequence: recovery.terminalSequence
    });
  }
  const sequenceSet = new Set(terminals.map((entry) => entry.terminalSequence));
  if (sequenceSet.size !== terminals.length) {
    throw new Error('Semantic Mutation terminal records contain duplicate workspace completion sequences');
  }
  terminals.sort((left, right) => right.terminalSequence - left.terminalSequence ||
    compareCodeUnits(left.requestIdentityDigest, right.requestIdentityDigest));
  for (const { root } of terminals.slice(SEMANTIC_MUTATION_TERMINAL_RETENTION)) {
    await commitFence();
    await rm(root, { recursive: true, force: false });
  }
}
