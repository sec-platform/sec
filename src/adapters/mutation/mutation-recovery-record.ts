import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION, SEMANTIC_MUTATION_RECOVERY_TRANSITIONS, SEMANTIC_MUTATION_TERMINAL_RETENTION, type SemanticMutationRecoveryRecord, type SemanticMutationRecoveryState, type SemanticMutationRequestIdentity, type SemanticMutationRequestRecord } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationDiagnostic } from '../../semantics/mutation/types.ts';
import {
  canonicalDiagnostics,
  canonicalEquals,
  cloneAndDeepFreeze,
  compareCodeUnits,
  digestString,
  exactOwnKeys,
  isPlainObject,
  nonEmptyString,
  sha256
} from '../../compiler/semantic-mutation/canonical.ts';
import {
  assertSemanticMutationTerminalCompletionReceipt,
  readRejectedSemanticMutationTerminal,
  reserveSemanticMutationTerminalSequence,
  type SemanticMutationTerminalWriteTestHooks
} from './mutation-terminal-record.ts';
import {
  normalizeSemanticMutationAuthorization,
  normalizeSemanticMutationRequest
} from '../../compiler/semantic-mutation/normalize-request.ts';
import { assertSemanticMutationPlanInvariant } from '../../compiler/semantic-mutation/plan-semantic-mutation.ts';
import { assertSemanticMutationResultInvariant } from './semantic-mutation-result.ts';
import {
  assertSemanticMutationRecoveryRecordsDirectory,
  assertSemanticMutationTransactionRoot,
  semanticMutationRequestIdentityDigest,
  semanticMutationTransactionRoot,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
import { semanticMutationRequiredVerificationDigest } from '../../compiler/semantic-mutation/verification-policy.ts';

const RETAINED_TERMINAL_STATES = new Set<SemanticMutationRecoveryState>([
  'verified',
  'rolled-back'
]);

type RecoveryRecordDraft = Omit<
  SemanticMutationRecoveryRecord,
  'formatRevision' | 'sequence' | 'previousRecordRevision' | 'terminalSequence' | 'recordRevision'
>;

export interface SemanticMutationRecoveryRecordWriteTestHooks {
  readonly beforeTempOpenAfterFence?: () => Promise<void>;
  readonly afterTempFileClosed?: () => Promise<void>;
  readonly terminal?: SemanticMutationTerminalWriteTestHooks;
}

function recordRevision(
  value: Omit<SemanticMutationRecoveryRecord, 'recordRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-recovery-record-v1', ...value });
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

function isRecoveryState(value: unknown): value is SemanticMutationRecoveryState {
  return value === 'prepared' || value === 'authoring-committed' || value === 'verified' ||
    value === 'rolled-back' || value === 'recovery-required';
}

function exactBase(value: unknown): boolean {
  return isPlainObject(value) && exactOwnKeys(value, [
    'transactionId', 'inputRevision', 'semanticRevision'
  ]) && nonEmptyString(value.transactionId) && nonEmptyString(value.inputRevision) &&
    nonEmptyString(value.semanticRevision);
}

function legalRecoveryTransition(
  previous: SemanticMutationRecoveryState,
  next: SemanticMutationRecoveryState
): boolean {
  return (SEMANTIC_MUTATION_RECOVERY_TRANSITIONS[previous] as readonly SemanticMutationRecoveryState[])
    .includes(next);
}

function assertVerificationBinding(record: SemanticMutationRecoveryRecord): void {
  const verification = record.verification;
  if (!isPlainObject(verification) || !exactOwnKeys(verification, [
    'adapterId', 'adapterRevision', 'reportRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'status', 'verificationExecutionRevision'
  ])) {
    throw new Error('Semantic Mutation recovery Verification violates the frozen execution schema');
  }
  const plan = record.plan;
  if (plan.status !== 'ready') {
    throw new Error('Semantic Mutation recovery record requires a ready canonical plan');
  }
  const { verificationExecutionRevision, ...withoutRevision } = verification;
  if (!nonEmptyString(verification.adapterId) || !nonEmptyString(verification.adapterRevision) ||
    !digestString(verification.reportRevision) || verification.status !== 'passed' ||
    verification.adapterId !== plan.verificationAdapterId ||
    verification.adapterRevision !== plan.verificationAdapterRevision ||
    verification.planRevision !== plan.planRevision ||
    !canonicalEquals(verification.attempted, plan.staged) ||
    verification.stagedSourceDigest !== plan.sourceChanges[0].stagedByteDigest ||
    verification.requiredVerificationDigest !==
      semanticMutationRequiredVerificationDigest(plan.requiredVerification) ||
    verificationExecutionRevision !== sha256({
      domain: 'semantic-mutation-verification-execution-v1',
      ...withoutRevision
    }) || record.verificationExecutionRevision !== verificationExecutionRevision ||
    record.verificationReportRevision !== verification.reportRevision) {
    throw new Error('Semantic Mutation recovery Verification is not bound to its plan/source/report');
  }
}

function assertRecoveryCrossBindings(record: SemanticMutationRecoveryRecord): void {
  assertSemanticMutationPlanInvariant(record.plan);
  if (record.plan.status !== 'ready') {
    throw new Error('Semantic Mutation recovery record cannot bind a rejected plan');
  }
  const request = normalizeSemanticMutationRequest(record.request);
  const authorization = normalizeSemanticMutationAuthorization(record.authorization);
  const identity = {
    graphId: request.graphId,
    appId: request.appId,
    requestId: request.requestId
  } as const;
  const sourceChange = record.plan.sourceChanges[0];
  if (!exactBase(record.base) || !exactBase(record.staged) ||
    request.requestRevision !== record.requestRevision ||
    authorization.authorizationRevision !== record.authorizationRevision ||
    record.requestIdentityDigest !== semanticMutationRequestIdentityDigest(identity) ||
    record.requestRevision !== record.plan.requestRevision ||
    record.authorizationRevision !== record.plan.authorizationRevision ||
    record.expectedPlanRevision !== record.plan.planRevision ||
    record.planRevision !== record.plan.planRevision ||
    !canonicalEquals(record.base, record.plan.base) ||
    !canonicalEquals(record.staged, record.plan.staged) ||
    !canonicalEquals(request.base, record.base) ||
    record.rollbackManifestDigest !== record.plan.rollbackManifestDigest ||
    record.relativePath !== sourceChange.relativePath ||
    record.beforeByteDigest !== sourceChange.beforeByteDigest ||
    record.committedByteDigest !== sourceChange.stagedByteDigest) {
    throw new Error('Semantic Mutation recovery identity/revision/source bindings are inconsistent');
  }
  assertVerificationBinding(record);
  if (record.result !== undefined) {
    assertSemanticMutationResultInvariant(record.result, record.plan);
    if (record.result.transactionId !== record.transactionId ||
      !canonicalEquals(record.result.diagnostics, record.diagnostics)) {
      throw new Error('Semantic Mutation recovery result does not bind its transaction/diagnostics');
    }
  }
}

export function assertSemanticMutationRecoveryRecordInvariant(
  record: SemanticMutationRecoveryRecord,
  previous?: SemanticMutationRecoveryRecord
): void {
  if (!isPlainObject(record) || !exactOwnKeys(record, [
    'formatRevision', 'sequence', 'previousRecordRevision', 'state', 'transactionId',
    'requestIdentityDigest', 'requestRevision', 'authorizationRevision', 'expectedPlanRevision',
    'planRevision', 'editPlanRevision', 'rollbackManifestDigest', 'relativePath',
    'beforeByteDigest', 'committedByteDigest', 'base', 'staged',
    'verificationExecutionRevision', 'verificationReportRevision', 'request', 'authorization',
    'plan', 'verification', 'diagnostics', 'recordRevision'
  ], ['result', 'recoveryState', 'terminalSequence'])) {
    throw new Error('Semantic Mutation recovery record violates the frozen v1 schema');
  }
  const { recordRevision: revision, ...withoutRevision } = record;
  const validSequence = Number.isSafeInteger(record.sequence) && record.sequence > 0 &&
    (previous === undefined
      ? record.sequence === 1 && record.previousRecordRevision === '' && record.state === 'prepared'
      : record.sequence === previous.sequence + 1 &&
        record.previousRecordRevision === previous.recordRevision &&
        legalRecoveryTransition(previous.state, record.state));
  const retainedTerminal = RETAINED_TERMINAL_STATES.has(record.state);
  const validTerminalSequence = retainedTerminal
    ? Number.isSafeInteger(record.terminalSequence) && (record.terminalSequence ?? 0) > 0
    : record.terminalSequence === undefined;
  if (record.formatRevision !== SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION ||
    !validSequence || !isRecoveryState(record.state) || !nonEmptyString(record.transactionId) ||
    !digestString(record.requestIdentityDigest) || !digestString(record.requestRevision) ||
    !digestString(record.authorizationRevision) || !digestString(record.expectedPlanRevision) ||
    !digestString(record.planRevision) || !digestString(record.editPlanRevision) ||
    !digestString(record.rollbackManifestDigest) || !nonEmptyString(record.relativePath) ||
    !digestString(record.beforeByteDigest) || !digestString(record.committedByteDigest) ||
    !digestString(record.verificationExecutionRevision) ||
    !digestString(record.verificationReportRevision) || !Array.isArray(record.diagnostics) ||
    !canonicalEquals(record.diagnostics, canonicalDiagnostics(record.diagnostics)) ||
    !validTerminalSequence ||
    !digestString(revision) || revision !== recordRevision(withoutRevision)) {
    throw new Error('Semantic Mutation recovery record revision chain or content is invalid');
  }
  const active = record.state === 'prepared' || record.state === 'authoring-committed';
  if (active && (record.result !== undefined || record.recoveryState !== undefined)) {
    throw new Error('Active Semantic Mutation recovery record cannot contain terminal evidence');
  }
  if (record.state === 'verified' && record.result?.status !== 'accepted') {
    throw new Error('Verified recovery record requires an accepted terminal result');
  }
  if (record.state === 'rolled-back' && record.result?.status !== 'rolled-back') {
    throw new Error('Rolled-back recovery record requires a rolled-back terminal result');
  }
  if (record.state === 'recovery-required' &&
    (record.result?.status !== 'recovery-required' || record.recoveryState === undefined ||
      record.recoveryState !== record.result.recoveryState)) {
    throw new Error('Recovery-required record requires matching terminal evidence');
  }
  if (record.state !== 'recovery-required' && record.recoveryState !== undefined) {
    throw new Error('Only recovery-required records may contain a recovery failure state');
  }
  assertRecoveryCrossBindings(record);
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
    (previous !== null && !legalRecoveryTransition(previous.state, draft.state))) {
    throw new Error('Semantic Mutation recovery state transition is not allowed');
  }
  const terminalSequence = RETAINED_TERMINAL_STATES.has(draft.state)
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
    recordRevision: recordRevision(withoutRevision)
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
    if (!recovery || !RETAINED_TERMINAL_STATES.has(recovery.state) ||
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

export function semanticMutationRecoveryRecordRevision(
  value: Omit<SemanticMutationRecoveryRecord, 'recordRevision'>
): string {
  return recordRevision(value);
}

export { recoveryDiagnostic } from '../../compiler/semantic-mutation/recovery-diagnostic.ts';
