import { sha256 } from '../../../contracts/canonical.ts';
import { assertGitBranchName } from '../../../contracts/git-reference.ts';
import type { SecOperationDigest } from '../../../execution/operation/semantic.ts';
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
    super('Git local ref delete is unavailable: Git cannot atomically compare the ref preimage and exclude a concurrent worktree binding.');
    this.name = 'GitLocalRefDeleteAtomicityUnavailableError';
  }
}

export const GIT_LOCAL_REF_DELETE_ATOMICITY = 'unavailable' as const;

const ATTEMPTED_GIT_REF_DELETE_PROVIDERS = new WeakSet<object>();
const ISSUED_GIT_REF_DELETE_RECEIPTS = new WeakSet<object>();

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

export function assertGitRefDeleteReceipt(receipt: GitRefDeleteReceipt): void {
  if (receipt === null || typeof receipt !== 'object'
      || !ISSUED_GIT_REF_DELETE_RECEIPTS.has(receipt)) {
    throw new Error('Git ref delete settlement requires one owner-issued terminal receipt.');
  }
}
