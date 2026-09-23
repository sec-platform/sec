import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { assertGitBranchName } from '../../../contracts/git-reference.ts';
import type { SecOperationDigest } from '../../../execution/operation/semantic.ts';
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../filesystem/write-lease.ts';
import { parseWorktreePorcelainZ } from '../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  assertGitPhysicalResourceAdmissionInternal,
  isGitPhysicalProviderCapability,
  runGitPhysicalCommandInternal,
  type GitPhysicalProviderCapability
} from './physical-provider.ts';

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const LOCAL_REF_PREFIX = 'refs/heads/';
const REMOTE_REF_PREFIX = 'refs/remotes/';
const PROCESS_COUNT = 3;
const SMALL_STDOUT_BYTES = 4 * 1024;
const STDERR_BYTES = 64 * 1024;
const OUTPUT_ADMISSION_BYTES = PROCESS_COUNT * (STDERR_BYTES + SMALL_STDOUT_BYTES);
const LOCAL_PROCESS_COUNT = process.platform === 'win32' ? 7 : 6;
const LOCAL_REF_STDOUT_BYTES = 128 * 1024;
const LOCAL_WORKTREE_STDOUT_BYTES = 128 * 1024;
const LOCAL_OUTPUT_ADMISSION_BYTES = 6 * STDERR_BYTES + 2 * LOCAL_REF_STDOUT_BYTES
  + 2 * LOCAL_WORKTREE_STDOUT_BYTES + 2 * SMALL_STDOUT_BYTES;

export type GitRefDeleteReceipt = Readonly<{
  readonly schema: 'sec-git-ref-delete-receipt';
  readonly providerIdentityDigest: SecOperationDigest;
  readonly operationIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly requirementId: string;
  readonly disposition: 'deleted' | 'already-absent';
  readonly ref: string;
  readonly expectedOldSha: string;
  readonly updateOrdinal: number | null;
  readonly readbackOrdinal: number;
  readonly receiptDigest: SecOperationDigest;
}>;

export class GitRefDeleteOutcomeUnknownError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GitRefDeleteOutcomeUnknownError';
    this.cause = cause;
  }
}

export class GitLocalRefDeleteAtomicityUnavailableError extends Error {
  constructor() {
    super('Git local ref delete requires a live coordinated common-directory maintenance lease.');
    this.name = 'GitLocalRefDeleteAtomicityUnavailableError';
  }
}

export class GitLocalRefDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitLocalRefDeleteBlockedError';
  }
}

export type GitLocalRefDeleteBatchReceipt = Readonly<{
  readonly schema: 'sec-git-local-ref-delete-batch-receipt';
  readonly providerIdentityDigest: SecOperationDigest;
  readonly operationIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly requirementId: string;
  readonly commonDirIdentityDigest: string;
  readonly leaseGeneration: number;
  readonly entries: readonly Readonly<{ ref: string; expectedOldSha: string }>[];
  readonly updateOrdinal: number;
  readonly refReadbackOrdinal: number;
  readonly worktreeReadbackOrdinal: number;
  readonly receiptDigest: SecOperationDigest;
}>;

const ATTEMPTED_GIT_REF_DELETE_PROVIDERS = new WeakSet<object>();
const ISSUED_GIT_REF_DELETE_RECEIPTS = new WeakSet<object>();
const ISSUED_GIT_LOCAL_REF_DELETE_BATCH_RECEIPTS = new WeakSet<object>();

function refKind(ref: string): 'local' | 'remote' | null {
  if (ref.startsWith(LOCAL_REF_PREFIX) && ref.length > LOCAL_REF_PREFIX.length) {
    assertGitBranchName(ref.slice(LOCAL_REF_PREFIX.length), 'Git ref delete local branch');
    return 'local';
  }
  if (!ref.startsWith(REMOTE_REF_PREFIX)) return null;
  const remainder = ref.slice(REMOTE_REF_PREFIX.length);
  const separator = remainder.indexOf('/');
  if (separator <= 0 || separator >= remainder.length - 1) return null;
  assertGitBranchName(remainder.slice(0, separator), 'Git ref delete remote');
  const topic = remainder.slice(separator + 1);
  if (topic !== 'HEAD') assertGitBranchName(topic, 'Git ref delete remote-tracking branch');
  return 'remote';
}

function commandOptions(provider: GitPhysicalProviderCapability, stdoutBytes = SMALL_STDOUT_BYTES) {
  return Object.freeze({
    env: provider.environment,
    envMode: 'replace' as const,
    maxStdoutBytes: stdoutBytes,
    maxStderrBytes: STDERR_BYTES
  });
}

function childError(stderr: string): string {
  const selected = stderr.trim();
  return selected.length === 0 ? '<empty>' : selected;
}

function strictText(source: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    throw new Error(`${label} contains invalid UTF-8.`);
  }
}

async function observeLocalRefSet(
  provider: GitPhysicalProviderCapability,
  refs: readonly string[]
) {
  const command = await runGitPhysicalCommandInternal(provider,
    ['for-each-ref', '--format=%(refname)%00%(symref)%00%(objectname)%00', 'refs/heads/'],
    commandOptions(provider, LOCAL_REF_STDOUT_BYTES));
  if (command.result.code !== 0 || command.result.stderr.length !== 0) {
    throw new Error(`Git local ref inventory is unavailable: ${childError(command.result.stderr)}`);
  }
  return Object.freeze({
    ordinal: command.ordinal,
    observations: new Map(refs.map((ref) => [ref, parseExactRefObservation(command.result.stdout, ref)] as const))
  });
}

async function observeWorktreeBindings(provider: GitPhysicalProviderCapability) {
  const command = await runGitPhysicalCommandInternal(provider,
    ['worktree', 'list', '--porcelain', '-z'],
    commandOptions(provider, LOCAL_WORKTREE_STDOUT_BYTES));
  if (command.result.code !== 0 || command.result.stderr.length !== 0) {
    throw new Error(`Git worktree registry is unavailable: ${childError(command.result.stderr)}`);
  }
  const records = parseWorktreePorcelainZ(command.result.stdout);
  if (records.length === 0 || new Set(records.map((record) => path.resolve(record.path))).size !== records.length) {
    throw new Error('Git worktree registry is empty or contains duplicate paths.');
  }
  return Object.freeze({ ordinal: command.ordinal, records });
}

async function observedGitCommonDir(provider: GitPhysicalProviderCapability): Promise<string> {
  const command = await runGitPhysicalCommandInternal(provider,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'], commandOptions(provider));
  if (command.result.code !== 0 || command.result.stderr.length !== 0) {
    throw new Error(`Git common directory is unavailable: ${childError(command.result.stderr)}`);
  }
  const output = strictText(command.result.stdout, 'Git common directory');
  if (!output.endsWith('\n') || output.slice(0, -1).includes('\n')
      || output.includes('\0') || !path.isAbsolute(output.slice(0, -1))) {
    throw new Error('Git common directory does not have one absolute machine path.');
  }
  return path.resolve(output.slice(0, -1));
}

type RefObservation = Readonly<{
  readonly sha: string;
  readonly symbolicTarget: string | null;
}> | null;

function parseExactRefObservation(source: Uint8Array, target: string): RefObservation {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    throw new Error('Git ref observation contains invalid UTF-8.');
  }
  if (text.length === 0) return null;
  if (!text.endsWith('\n')) throw new Error('Git ref observation is not LF-terminated.');
  const records = text.slice(0, -1).split('\n');
  let exact: Exclude<RefObservation, null> | null = null;
  for (const record of records) {
    const fields = record.split('\0');
    if (fields.length !== 4 || fields[3] !== '') {
      throw new Error('Git ref observation violates its exact machine framing.');
    }
    const [ref, symbolicTarget, sha] = fields as [string, string, string, string];
    if (!OBJECT_ID.test(sha)) throw new Error('Git ref observation contains a noncanonical object identity.');
    if (ref !== target) continue;
    if (exact !== null) throw new Error('Git ref observation contains a duplicate exact target.');
    exact = Object.freeze({ sha, symbolicTarget: symbolicTarget.length === 0 ? null : symbolicTarget });
  }
  return exact;
}

async function observeExactRef(provider: GitPhysicalProviderCapability, ref: string) {
  const result = await runGitPhysicalCommandInternal(
    provider,
    ['for-each-ref', '--count=2', '--format=%(refname)%00%(symref)%00%(objectname)%00', ref],
    commandOptions(provider)
  );
  if (result.result.code !== 0) {
    throw new GitRefDeleteOutcomeUnknownError(
      `Git ref delete could not obtain an exact native ref observation: ${childError(result.result.stderr)}`
    );
  }
  return Object.freeze({ command: result, observation: parseExactRefObservation(result.result.stdout, ref) });
}

function issueReceipt(input: Readonly<{
  provider: GitPhysicalProviderCapability;
  disposition: 'deleted' | 'already-absent';
  ref: string;
  expectedOldSha: string;
  updateOrdinal: number | null;
  readbackOrdinal: number;
}>): GitRefDeleteReceipt {
  const withoutDigest = Object.freeze({
    schema: 'sec-git-ref-delete-receipt' as const,
    providerIdentityDigest: input.provider.identity.identityDigest,
    operationIdentityDigest: input.provider.operationIdentityDigest,
    boundAttemptDigest: input.provider.boundAttemptDigest,
    requirementId: input.provider.requirementId,
    disposition: input.disposition,
    ref: input.ref,
    expectedOldSha: input.expectedOldSha,
    updateOrdinal: input.updateOrdinal,
    readbackOrdinal: input.readbackOrdinal
  });
  const receipt = Object.freeze({
    ...withoutDigest,
    receiptDigest: sha256({
      domain: 'external-capabilities.git.ref-delete-receipt',
      receipt: withoutDigest
    }) as SecOperationDigest
  });
  ISSUED_GIT_REF_DELETE_RECEIPTS.add(receipt);
  return receipt;
}

/**
 * Delete one already-authorized remote-tracking ref by exact preimage.
 * Local branch deletion is fail-closed because Git cannot atomically compare
 * the ref preimage and exclude a concurrent worktree binding.
 */
export async function deleteExactGitRef(input: Readonly<{
  readonly provider: GitPhysicalProviderCapability;
  readonly ref: string;
  readonly expectedOldSha: string;
}>): Promise<GitRefDeleteReceipt> {
  if (!isGitPhysicalProviderCapability(input.provider)) {
    throw new Error('Git ref delete requires one live owner-issued physical provider capability.');
  }
  const kind = refKind(input.ref);
  if (kind === null || !OBJECT_ID.test(input.expectedOldSha)) {
    throw new Error('Git ref delete requires one exact local or remote-tracking ref and lowercase object preimage.');
  }
  if (kind === 'local') {
    throw new GitLocalRefDeleteAtomicityUnavailableError();
  }
  if (ATTEMPTED_GIT_REF_DELETE_PROVIDERS.has(input.provider)) {
    throw new Error('Git ref delete provider capability has already attempted its one Effect.');
  }
  assertGitPhysicalResourceAdmissionInternal(input.provider, {
    processes: PROCESS_COUNT,
    inputBytes: 0,
    outputBytes: OUTPUT_ADMISSION_BYTES
  });
  ATTEMPTED_GIT_REF_DELETE_PROVIDERS.add(input.provider);

  const before = await observeExactRef(input.provider, input.ref);
  if (before.observation !== null && before.observation.symbolicTarget !== null) {
    throw new Error('Git ref delete refuses a symbolic ref target.');
  }
  if (before.observation !== null && before.observation.sha !== input.expectedOldSha) {
    throw new Error('Git ref delete exact preimage does not match the current ref.');
  }

  if (before.observation === null) {
    // An absent ref can appear after admission, so the receipt binds an
    // independent final ref observation rather than the admission snapshot.
    let finalAbsence: Awaited<ReturnType<typeof observeExactRef>>;
    try {
      finalAbsence = await observeExactRef(input.provider, input.ref);
    } catch (error) {
      throw new GitRefDeleteOutcomeUnknownError(
        'Git ref delete could not establish final absence; this provider capability must not be replayed.',
        error
      );
    }
    if (finalAbsence.observation !== null) {
      throw new GitRefDeleteOutcomeUnknownError(
        'Git ref appeared before the already-absent receipt; this provider capability must not be replayed.'
      );
    }
    return issueReceipt({
      provider: input.provider,
      disposition: 'already-absent',
      ref: input.ref,
      expectedOldSha: input.expectedOldSha,
      updateOrdinal: null,
      readbackOrdinal: finalAbsence.command.ordinal
    });
  }

  let update: Awaited<ReturnType<typeof runGitPhysicalCommandInternal>>;
  let readback: Awaited<ReturnType<typeof observeExactRef>>;
  try {
    update = await runGitPhysicalCommandInternal(
      input.provider,
      ['update-ref', '--no-deref', '-d', input.ref, input.expectedOldSha],
      commandOptions(input.provider)
    );
    readback = await observeExactRef(input.provider, input.ref);
  } catch (error) {
    throw new GitRefDeleteOutcomeUnknownError(
      'Git ref delete lost an exact native settlement; this provider capability must not be replayed.',
      error
    );
  }
  if (update.result.code !== 0 || update.result.stdout.byteLength !== 0
      || readback.observation !== null) {
    throw new GitRefDeleteOutcomeUnknownError(
      'Git ref delete native Effect or independent absence readback is ambiguous; this provider capability must not be replayed.'
    );
  }

  return issueReceipt({
    provider: input.provider,
    disposition: 'deleted',
    ref: input.ref,
    expectedOldSha: input.expectedOldSha,
    updateOrdinal: update.ordinal,
    readbackOrdinal: readback.command.ordinal
  });
}

/**
 * Delete one or more already-authorized local refs under the cooperative
 * common-directory maintenance lease. Git makes the ref transaction atomic;
 * the lease coordinates participating SEC writers, not arbitrary native Git.
 */
function encodeExactLocalGitRefDeleteBatchTranscript(
  entries: readonly Readonly<{ ref: string; expectedOldSha: string }>[]
): Readonly<{ entries: readonly Readonly<{ ref: string; expectedOldSha: string }>[]; transcript: Uint8Array }> {
  const sorted = [...entries].sort((left, right) => left.ref.localeCompare(right.ref));
  if (sorted.length === 0 || new Set(sorted.map((entry) => entry.ref)).size !== sorted.length) {
    throw new Error('Git local ref delete requires a nonempty set of distinct refs.');
  }
  for (const entry of sorted) {
    if (refKind(entry.ref) !== 'local' || !OBJECT_ID.test(entry.expectedOldSha)) {
      throw new Error('Git local ref delete requires exact local branch refs and lowercase object preimages.');
    }
  }
  return { entries: sorted, transcript: new TextEncoder().encode([
    'start', ...sorted.map((entry) => `delete ${entry.ref} ${entry.expectedOldSha}`),
    'prepare', 'commit', ''
  ].join('\n')) };
}

/** Product ceiling for one atomic local-ref transaction, declared by this capability in sec.module.json. */
export const MAXIMUM_LOCAL_REF_DELETE_INPUT_BYTES = 1024 * 1024;

/** Exact native stdin budget for the same validated transcript used by the Effect owner. */
export function measureExactLocalGitRefDeleteBatchInputBytes(
  entries: readonly Readonly<{ ref: string; expectedOldSha: string }>[]
): number {
  return encodeExactLocalGitRefDeleteBatchTranscript(entries).transcript.byteLength;
}

export async function deleteExactLocalGitRefs(input: Readonly<{
  readonly provider: GitPhysicalProviderCapability;
  readonly coordinatedLease: WorkspaceWriteLeaseToken;
  readonly entries: readonly Readonly<{ ref: string; expectedOldSha: string }>[];
}>): Promise<GitLocalRefDeleteBatchReceipt> {
  if (!isGitPhysicalProviderCapability(input.provider)) {
    throw new Error('Git local ref delete requires one live owner-issued physical provider capability.');
  }
  if (input.coordinatedLease === null || typeof input.coordinatedLease !== 'object') {
    throw new GitLocalRefDeleteAtomicityUnavailableError();
  }
  const { entries, transcript } = encodeExactLocalGitRefDeleteBatchTranscript(input.entries);
  if (transcript.byteLength > MAXIMUM_LOCAL_REF_DELETE_INPUT_BYTES) {
    throw new Error('Git local ref batch delete exceeds the bounded product input budget.');
  }
  if (ATTEMPTED_GIT_REF_DELETE_PROVIDERS.has(input.provider)) {
    throw new Error('Git ref delete provider capability has already attempted its one Effect.');
  }
  assertGitPhysicalResourceAdmissionInternal(input.provider, {
    processes: LOCAL_PROCESS_COUNT,
    inputBytes: transcript.byteLength,
    outputBytes: LOCAL_OUTPUT_ADMISSION_BYTES
  });
  ATTEMPTED_GIT_REF_DELETE_PROVIDERS.add(input.provider);

  const commonDir = await observedGitCommonDir(input.provider);
  await assertWorkspaceWriteLease(commonDir, input.coordinatedLease);
  const refs = entries.map((entry) => entry.ref);
  const beforeWorktrees = await observeWorktreeBindings(input.provider);
  const beforeRefs = await observeLocalRefSet(input.provider, refs);
  for (const entry of entries) {
    if (beforeWorktrees.records.some((record) => record.branch === entry.ref.slice(LOCAL_REF_PREFIX.length))) {
      throw new GitLocalRefDeleteBlockedError(`Git worktree binds local branch ${entry.ref}.`);
    }
    const observation = beforeRefs.observations.get(entry.ref);
    if (observation === null || observation === undefined || observation.symbolicTarget !== null
        || observation.sha !== entry.expectedOldSha) {
      throw new GitLocalRefDeleteBlockedError(`Git local ref preimage changed or is unavailable: ${entry.ref}.`);
    }
  }
  await assertWorkspaceWriteLease(commonDir, input.coordinatedLease);

  let update: Awaited<ReturnType<typeof runGitPhysicalCommandInternal>>;
  let afterRefs: Awaited<ReturnType<typeof observeLocalRefSet>>;
  let afterWorktrees: Awaited<ReturnType<typeof observeWorktreeBindings>>;
  try {
    update = await runGitPhysicalCommandInternal(input.provider,
      ['update-ref', '--no-deref', '--stdin'], {
        ...commandOptions(input.provider), input: transcript, maxStdinBytes: transcript.byteLength
      });
    await assertWorkspaceWriteLease(commonDir, input.coordinatedLease);
    afterRefs = await observeLocalRefSet(input.provider, refs);
    afterWorktrees = await observeWorktreeBindings(input.provider);
    await assertWorkspaceWriteLease(commonDir, input.coordinatedLease);
  } catch (error) {
    throw new GitRefDeleteOutcomeUnknownError(
      'Git local ref batch delete lost native settlement; this provider capability must not be replayed.', error
    );
  }
  if (update.result.code !== 0 || update.result.stderr.length !== 0
      || entries.some((entry) => afterRefs.observations.get(entry.ref) !== null)
      || entries.some((entry) => afterWorktrees.records.some((record) => (
        record.branch === entry.ref.slice(LOCAL_REF_PREFIX.length)
      )))) {
    throw new GitRefDeleteOutcomeUnknownError(
      'Git local ref batch Effect or independent ref/worktree readback is ambiguous; this provider capability must not be replayed.'
    );
  }
  const withoutDigest = Object.freeze({
    schema: 'sec-git-local-ref-delete-batch-receipt' as const,
    providerIdentityDigest: input.provider.identity.identityDigest,
    operationIdentityDigest: input.provider.operationIdentityDigest,
    boundAttemptDigest: input.provider.boundAttemptDigest,
    requirementId: input.provider.requirementId,
    commonDirIdentityDigest: input.coordinatedLease.workspaceIdentityDigest,
    leaseGeneration: input.coordinatedLease.generation,
    entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
    updateOrdinal: update.ordinal,
    refReadbackOrdinal: afterRefs.ordinal,
    worktreeReadbackOrdinal: afterWorktrees.ordinal
  });
  const receipt = Object.freeze({
    ...withoutDigest,
    receiptDigest: sha256({ domain: 'external-capabilities.git.local-ref-delete-batch-receipt', receipt: withoutDigest }) as SecOperationDigest
  });
  ISSUED_GIT_LOCAL_REF_DELETE_BATCH_RECEIPTS.add(receipt);
  return receipt;
}

export function assertGitLocalRefDeleteBatchReceipt(receipt: GitLocalRefDeleteBatchReceipt): void {
  if (receipt === null || typeof receipt !== 'object'
      || !ISSUED_GIT_LOCAL_REF_DELETE_BATCH_RECEIPTS.has(receipt)) {
    throw new Error('Git local ref batch delete settlement requires one owner-issued terminal receipt.');
  }
}

export function assertGitRefDeleteReceipt(receipt: GitRefDeleteReceipt): void {
  if (receipt === null || typeof receipt !== 'object'
      || !ISSUED_GIT_REF_DELETE_RECEIPTS.has(receipt)) {
    throw new Error('Git ref delete settlement requires one owner-issued terminal receipt.');
  }
}
