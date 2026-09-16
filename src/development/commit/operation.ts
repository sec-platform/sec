import path from 'node:path';

import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { assertGitHubRepositoryBinding } from '../../external-capabilities/git-read/repository-binding.ts';
import {
  compareAndSwapAuthorityDevelopmentCommitRef,
  compileGitDevelopmentCommitContractDigest,
  createAuthorityGitReadSession,
  materializeAuthorityDevelopmentCommitObject,
  settleGitDevelopmentCommitOperation,
  type GitReadSession
} from '../../external-capabilities/git-read/runtime/session.ts';
import { executeGitHubApiOperation, GitHubApiProviderError, inspectGitHubApiCapability, withGitHubApiReadSession, type GitHubApiCapability } from '../../external-capabilities/github-api/operation-session.ts';
import { parseWorktreePorcelainZ } from '../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem } from '../../runtime-state/workspace-state/journal-filesystem.ts';
import { canonicalJson, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  compileSecProviderSettlementSet,
  issueSecNormalDomainReadbackReceipt,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecProviderSettlementSet
} from '../../system-architecture/operation/semantic.ts';
import { assertDevelopmentCommitCandidateCurrent } from '../commit-admission/candidate.ts';
import {
  consumeDevelopmentCommitAdmission,
  type DevelopmentCommitAdmission,
  type DevelopmentCommitRequest
} from '../commit-admission/operation.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';

const JOURNAL_SCHEMA = 'sec-development-commit-journal-v1';
const JOURNAL_DIRECTORY = 'sec-development-commit';
const MAXIMUM_JOURNAL_BYTES = 4096;
const MAXIMUM_JOURNAL_CENSUS_ENTRIES = 256;
const MAXIMUM_JOURNAL_CENSUS_BYTES = MAXIMUM_JOURNAL_CENSUS_ENTRIES * MAXIMUM_JOURNAL_BYTES;
const MAXIMUM_REF_JOURNALS = 12;
const DEVELOPMENT_COMMIT_PROVIDER_ADMISSION_PROCESS_COUNT = 1;
const DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT = 5;
const DEVELOPMENT_COMMIT_MATERIALIZATION_PROCESS_COUNT = 2;
const DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT = 1;
const DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT =
  DEVELOPMENT_COMMIT_PROVIDER_ADMISSION_PROCESS_COUNT + 2
  + DEVELOPMENT_COMMIT_MATERIALIZATION_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT;
const DEVELOPMENT_COMMIT_RETRY_PROCESS_COUNT =
  DEVELOPMENT_COMMIT_PROVIDER_ADMISSION_PROCESS_COUNT + 2
  + DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;
const JOURNAL_NAME = /^[0-9a-f]{64}(?:\.retry)?\.json$/u;

export type DevelopmentCommitDisposition = 'applied' | 'not-applied' | 'unknown';

export type { DevelopmentCommitRequest } from '../commit-admission/operation.ts';

export type DevelopmentCommitResult = Readonly<{
  readonly schema: 'sec-development-commit-result-v1';
  readonly disposition: DevelopmentCommitDisposition;
  readonly ref: string;
  readonly preimage: string;
  readonly target: string;
  readonly tree: string;
  readonly journalPath: string;
}>;

export type DevelopmentCommitReadbackReceipt = Readonly<{
  readonly disposition: DevelopmentCommitDisposition;
  readonly operation: SecOperationDigest;
  readonly attempt: SecOperationDigest;
  readonly readbackReceiptDigest: SecOperationDigest;
}>;

export type DevelopmentCommitRecovery = Readonly<{
  readonly result: DevelopmentCommitResult;
  readonly readbackReceiptDigest: SecOperationDigest;
}>;

type DevelopmentCommitRecoveryDetails = Readonly<{
  readonly result: DevelopmentCommitResult;
  readonly readback: DevelopmentCommitReadbackReceipt;
  readonly commonDirectory: string;
  readonly providerIdentityDigest: SecOperationDigest;
  readonly journalSource: string;
}>;

const ISSUED_DEVELOPMENT_COMMIT_READBACKS = new WeakSet<object>();
const ISSUED_DEVELOPMENT_COMMIT_RECOVERIES = new WeakMap<object, DevelopmentCommitRecoveryDetails>();
const ISSUED_DEVELOPMENT_COMMIT_RESULTS = new WeakMap<object, Readonly<{
  readonly commonDirectory: string;
  readonly journalPath: string;
  readonly journalSource: string;
  readonly predecessorJournals: readonly Readonly<{
    readonly journalPath: string;
    readonly journalSource: string;
  }>[];
  readonly readback: DevelopmentCommitReadbackReceipt;
}>>();

type Journal = Readonly<{
  readonly schema: typeof JOURNAL_SCHEMA;
  readonly operation: SecOperationDigest;
  readonly attempt: SecOperationDigest;
  readonly ref: string;
  readonly preimage: string;
  readonly target: string;
  readonly object: string | null;
  readonly tree: string;
  readonly terminal: DevelopmentCommitDisposition | null;
}>;

type CommitTestHooks = Readonly<{
  readonly afterObjectJournaled?: (journalPath: string) => void | Promise<void>;
  readonly afterRefUpdateBeforeReadback?: (journalPath: string) => void | Promise<void>;
}>;

export class DevelopmentCommitLostHandleError extends Error {
  constructor(
    readonly repositoryRoot: string,
    readonly journalPath: string,
    cause: unknown
  ) {
    super('Development commit lost its live provider handle; recover from the journal reference.');
    this.name = 'DevelopmentCommitLostHandleError';
    this.cause = cause;
  }
}

function commandText(session: GitReadSession, args: readonly string[], label: string): Promise<string> {
  return session.run(args).then((command) => {
    if (command.kind !== 'completed' || command.result.code !== 0) {
      throw new Error(`Development commit could not ${label}.`);
    }
    return Buffer.from(command.result.stdout).toString('utf8').trim();
  });
}

async function observeCommandText(
  session: GitReadSession,
  args: readonly string[]
): Promise<Readonly<{
  readonly status: 'observed';
  readonly text: string;
}> | Readonly<{
  readonly status: 'rejected' | 'unresolved';
}>> {
  const command = await session.run(args);
  if (command.kind !== 'completed') return Object.freeze({ status: 'unresolved' as const });
  if (command.result.code !== 0) return Object.freeze({ status: 'rejected' as const });
  return Object.freeze({
    status: 'observed' as const,
    text: Buffer.from(command.result.stdout).toString('utf8').trim()
  });
}

async function observeMissingGitObject(
  session: GitReadSession,
  objectId: string
): Promise<'missing' | 'unknown'> {
  const command = await session.run(
    ['cat-file', '--batch'],
    { input: Buffer.from(`${objectId}\n`, 'ascii') }
  );
  if (command.kind !== 'completed' || command.result.code !== 0 || command.result.stderr.length !== 0) {
    return 'unknown';
  }
  const expected = Buffer.from(`${objectId} missing\n`, 'ascii');
  if (!Buffer.from(command.result.stdout).equals(expected)) return 'unknown';
  if (session.consumeRecords(1) !== null) return 'unknown';
  return 'missing';
}

function encodeJournal(journal: Journal): string {
  const source = `${JSON.stringify(canonicalJson(journal))}\n`;
  if (Buffer.byteLength(source, 'utf8') > MAXIMUM_JOURNAL_BYTES) {
    throw new Error('Development commit journal exceeds its byte ceiling.');
  }
  return source;
}

function parseJournal(source: string): Journal {
  if (Buffer.byteLength(source, 'utf8') > MAXIMUM_JOURNAL_BYTES || !source.endsWith('\n')) {
    throw new Error('Development commit journal is not bounded canonical JSON.');
  }
  const value = JSON.parse(source.slice(0, -1)) as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expected = ['attempt', 'object', 'operation', 'preimage', 'ref', 'schema', 'target', 'terminal', 'tree'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)
      || value.schema !== JOURNAL_SCHEMA
      || typeof value.operation !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.operation)
      || typeof value.attempt !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.attempt)
      || typeof value.ref !== 'string' || !REF.test(value.ref)
      || typeof value.preimage !== 'string' || !OBJECT_ID.test(value.preimage)
      || typeof value.target !== 'string' || !OBJECT_ID.test(value.target)
      || (value.object !== null && (typeof value.object !== 'string' || !OBJECT_ID.test(value.object)))
      || typeof value.tree !== 'string' || !OBJECT_ID.test(value.tree)
      || ![null, 'applied', 'not-applied', 'unknown'].includes(value.terminal as never)) {
    throw new Error('Development commit journal violates its exact schema.');
  }
  const journal = Object.freeze(value as Journal);
  if (encodeJournal(journal) !== source) {
    throw new Error('Development commit journal bytes are noncanonical.');
  }
  return journal;
}

function journalWriter(commonDirectory: string) {
  return createRuntimeStateJournalFileSystem(
    inspectNoFollowDirectoryChain(commonDirectory, 'Development commit common directory').target
  );
}

function writeJournal(
  commonDirectory: string,
  journalPath: string,
  journal: Journal,
  create: boolean
): void {
  const writer = journalWriter(commonDirectory);
  const source = encodeJournal(journal);
  if (create) {
    if (!writer.createExclusiveFsync(journalPath, source)) {
      throw new Error('Development commit attempt journal identity is contended.');
    }
  } else {
    writer.replaceFsync(journalPath, source);
  }
}

function readJournal(commonDirectory: string, journalPath: string): Journal {
  const source = journalWriter(commonDirectory).readTextRetained(journalPath, {
    deadlineAtMonotonicMs: performance.now() + 5_000,
    maximumBytes: MAXIMUM_JOURNAL_BYTES
  });
  if (source === null) throw new Error('Development commit journal is absent.');
  return parseJournal(source);
}

export async function readDevelopmentCommitOutcome(input: Readonly<{
  session: GitReadSession;
  commonDirectory: string;
  journal: Journal;
  normal: null | Readonly<{
    operation: SecBoundSemanticOperation;
    settlement: SecProviderSettlementSet;
    contractDigest: SecOperationDigest;
  }>;
}>): Promise<DevelopmentCommitReadbackReceipt> {
  const disposition = await (async (session: GitReadSession) => {
    const journal = input.journal;
    const refObservation = await observeCommandText(
      session,
      ['rev-parse', '--verify', '--end-of-options', journal.ref]
    );
    const objectTypeObservation = await observeCommandText(
      session,
      ['cat-file', '-t', journal.target]
    );
    const objectAbsence = objectTypeObservation.status === 'rejected'
      ? await observeMissingGitObject(session, journal.target)
      : objectTypeObservation.status === 'unresolved' ? 'unknown' as const : 'present' as const;
    const objectObservation = objectTypeObservation.status === 'observed'
        && objectTypeObservation.text === 'commit'
      ? await observeCommandText(session, ['cat-file', 'commit', journal.target])
      : null;
    const index = await session.run([
      'diff-index', '--cached', '--exit-code', journal.tree, '--'
    ]);
    const indexMatches = index.kind === 'completed' && index.result.code === 0;
    const objectBytes = objectObservation?.status === 'observed' ? objectObservation.text : '';
    const objectHeaders = objectBytes.split('\n\n', 1)[0]?.split(/\r?\n/u) ?? [];
    const objectMatches = objectTypeObservation.status === 'observed'
      && objectTypeObservation.text === 'commit'
      && objectObservation?.status === 'observed'
      && objectHeaders.filter((line) => line.startsWith('tree ')).length === 1
      && objectHeaders.includes(`tree ${journal.tree}`)
      && JSON.stringify(objectHeaders.filter((line) => line.startsWith('parent ')))
        === JSON.stringify([`parent ${journal.preimage}`]);
    const reflogObservation = await observeCommandText(
      session,
      ['rev-list', '--walk-reflogs', journal.ref]
    );
    if (refObservation.status !== 'observed'
        || objectTypeObservation.status === 'unresolved'
        || objectAbsence === 'unknown'
        || objectObservation?.status === 'unresolved'
        || reflogObservation.status !== 'observed') return 'unknown';
    const ref = refObservation.text;
    const reflog = reflogObservation.text;
    const reflogTargets = reflog.length === 0 ? [] : reflog.split(/\r?\n/u);
    const reflogContainsTarget = reflogTargets.includes(journal.target);
    const exactRefTransition = reflogTargets.some((target, index) => (
      target === journal.target && reflogTargets[index + 1] === journal.preimage
    ));
    if (objectMatches && exactRefTransition) return 'applied';
    const objectAbsent = objectAbsence === 'missing';
    if (ref === journal.preimage && (objectMatches || objectAbsent)
        && indexMatches && !reflogContainsTarget) return 'not-applied';
    return 'unknown';
  })(input.session);
  if (input.normal !== null) {
    issueSecNormalDomainReadbackReceipt(input.normal.operation, input.normal.settlement, {
      readbackContractDigest: input.normal.contractDigest,
      readbackReferenceDigest: sha256({ ref: input.journal.ref, target: input.journal.target, disposition }) as SecOperationDigest,
      currentPhysicalEpochDigest: sha256({ preimage: input.journal.preimage, target: input.journal.target, tree: input.journal.tree }) as SecOperationDigest,
      disposition
    });
  }
  const receipt = Object.freeze({
    disposition,
    operation: input.journal.operation,
    attempt: input.journal.attempt,
    readbackReceiptDigest: sha256({
      domain: 'sec.development-commit.readback',
      operation: input.journal.operation,
      attempt: input.journal.attempt,
      ref: input.journal.ref,
      preimage: input.journal.preimage,
      target: input.journal.target,
      tree: input.journal.tree,
      disposition
    }) as SecOperationDigest
  });
  ISSUED_DEVELOPMENT_COMMIT_READBACKS.add(receipt);
  return receipt;
}

export function assertDevelopmentCommitReadbackReceipt(value: DevelopmentCommitReadbackReceipt): void {
  if (!ISSUED_DEVELOPMENT_COMMIT_READBACKS.has(value)) throw new Error('Development commit recovery requires an exact readback-issued receipt.');
}

async function execute(
  request: DevelopmentCommitRequest,
  admission: DevelopmentCommitAdmission,
  hooks: CommitTestHooks
): Promise<DevelopmentCommitResult> {
  const admitted = consumeDevelopmentCommitAdmission({
    admission,
    request
  });
  const { candidate: frozen, candidateDetails, contract, operation } = admitted;
  const journalPath = path.join(
    candidateDetails.commonDirectory,
    JOURNAL_DIRECTORY,
    `${operation.plan.attempt.attemptNonceDigest.slice('sha256:'.length)}.json`
  );
  let journal: Journal = Object.freeze({
    schema: JOURNAL_SCHEMA,
    operation: operation.plan.identity.identityDigest,
    attempt: operation.boundAttemptDigest,
    ref: frozen.ref,
    preimage: frozen.preimage,
    target: frozen.target,
    object: null,
    tree: frozen.tree,
    terminal: null
  });
  const resolution = createAuthorityGitReadSession({
    cwd: frozen.repositoryRoot,
    operation,
    budget: {
      ...GIT_READ_OPERATION_BUDGET,
      maxProcesses: DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT,
      maxStdinBytes: 64 * 1024,
      maxStdoutBytes: 12 * 1024,
      maxStderrBytes: 192 * 1024,
      maxCommandStdoutBytes: 4 * 1024,
      maxCommandStderrBytes: 64 * 1024
    }
  });
  if (resolution.status !== 'ready') throw new Error(`Development commit provider unavailable: ${resolution.reason}`);
  let providerSettlementSet: SecProviderSettlementSet | null = null;
  let readback: DevelopmentCommitReadbackReceipt | null = null;
  try {
    await assertDevelopmentCommitCandidateCurrent({
      candidate: frozen,
      request,
      session: resolution.session
    });
    writeJournal(candidateDetails.commonDirectory, journalPath, journal, true);
    const object = await materializeAuthorityDevelopmentCommitObject({
      gitReadSession: resolution.session,
      contract
    });
    if (object.status !== 'completed') {
      if (object.status === 'cas-conflict') {
        throw new Error(
          `Development commit object materialization returned an invalid CAS conflict for ${object.object}`
        );
      }
      throw new Error(
        `Development commit object materialization failed: ${object.reason}`
        + (object.detail === undefined ? '' : `; ${object.detail}`)
      );
    }
    journal = Object.freeze({ ...journal, object: object.object });
    writeJournal(candidateDetails.commonDirectory, journalPath, journal, false);
    await hooks.afterObjectJournaled?.(journalPath);
    const refSettlement = await compareAndSwapAuthorityDevelopmentCommitRef({ gitReadSession: resolution.session, contract });
    providerSettlementSet = compileSecProviderSettlementSet(operation, [
      settleGitDevelopmentCommitOperation(operation, refSettlement)
    ]);
    try {
      await hooks.afterRefUpdateBeforeReadback?.(journalPath);
    } catch (error) {
      throw new DevelopmentCommitLostHandleError(frozen.repositoryRoot, journalPath, error);
    }
    if (providerSettlementSet === null) throw new Error('Development commit provider settlement is absent.');
    readback = await readDevelopmentCommitOutcome({
      session: resolution.session,
      commonDirectory: candidateDetails.commonDirectory,
      journal,
      normal: { operation, settlement: providerSettlementSet, contractDigest: compileGitDevelopmentCommitContractDigest(contract) }
    });
  } finally {
    await resolution.session.close?.();
  }
  if (readback === null) throw new Error('Development commit readback receipt is absent.');
  const { disposition } = readback;
  journal = Object.freeze({ ...journal, terminal: disposition });
  writeJournal(candidateDetails.commonDirectory, journalPath, journal, false);
  const result = Object.freeze({
    schema: 'sec-development-commit-result-v1',
    disposition,
    ref: journal.ref,
    preimage: journal.preimage,
    target: journal.target,
    tree: journal.tree,
    journalPath
  });
  ISSUED_DEVELOPMENT_COMMIT_RESULTS.set(result, Object.freeze({
    commonDirectory: candidateDetails.commonDirectory,
    journalPath,
    journalSource: encodeJournal(journal),
    predecessorJournals: Object.freeze([]),
    readback
  }));
  return result;
}

/**
 * Acknowledges delivery of one owner-issued applied result and retires only
 * the exact journal generation that produced it. Non-applied results retain
 * their recovery input, and copied result projections have no authority.
 */
export function acknowledgeDevelopmentCommitResult(result: DevelopmentCommitResult): void {
  const issued = ISSUED_DEVELOPMENT_COMMIT_RESULTS.get(result);
  if (issued === undefined) {
    throw new Error('Development commit retirement requires one owner-issued undelivered result.');
  }
  assertDevelopmentCommitReadbackReceipt(issued.readback);
  if (result.disposition !== 'applied' || issued.readback.disposition !== 'applied') {
    throw new Error(`Development commit retirement requires applied readback, got ${result.disposition}.`);
  }
  for (const [index, predecessor] of issued.predecessorJournals.entries()) {
    if (!journalWriter(issued.commonDirectory).deleteFsyncCas(
      predecessor.journalPath,
      predecessor.journalSource
    )) {
      throw new Error('Development commit predecessor journal changed before exact terminal retirement.');
    }
    ISSUED_DEVELOPMENT_COMMIT_RESULTS.set(result, Object.freeze({
      ...issued,
      predecessorJournals: Object.freeze(issued.predecessorJournals.slice(index + 1))
    }));
  }
  if (!journalWriter(issued.commonDirectory).deleteFsyncCas(issued.journalPath, issued.journalSource)) {
    throw new Error('Development commit journal changed before exact terminal retirement.');
  }
  ISSUED_DEVELOPMENT_COMMIT_RESULTS.delete(result);
  retireEmptyJournalDirectory(issued.commonDirectory);
}

function retireEmptyJournalDirectory(commonDirectory: string): void {
  const parent = inspectNoFollowDirectoryChain(commonDirectory, 'Commit journal retirement parent').target;
  const root = inspectNoFollowDirectoryChild(parent, JOURNAL_DIRECTORY, 'Commit journal retirement owner');
  if (root === null) return;
  const deadlineAtMonotonicMs = performance.now() + 5_000;
  if (scanNoFollowDirectoryDirectMetadata(root, {
    deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: MAXIMUM_JOURNAL_CENSUS_ENTRIES
  }).length !== 0) return;
  retireNoFollowDirectoryTree({ parent, root, inventory: [], deadlineAtMonotonicMs });
}

export type DevelopmentCommitJournalSettlement = Readonly<{
  readonly ref: string;
  readonly observed: number;
  readonly retired: number;
}>;

type ObservedDevelopmentCommitJournal = Readonly<{
  readonly journal: Journal;
  readonly journalPath: string;
  readonly source: string;
}>;

function observeJournalCensus(commonDirectory: string, ref: string): Readonly<{
  readonly matching: readonly ObservedDevelopmentCommitJournal[];
  readonly writer: ReturnType<typeof journalWriter>;
}> {
  const deadlineAtMonotonicMs = performance.now() + 5_000;
  const common = inspectNoFollowDirectoryChain(
    commonDirectory,
    'Development commit journal settlement common directory'
  ).target;
  const directory = inspectNoFollowDirectoryChild(
    common,
    JOURNAL_DIRECTORY,
    'Development commit journal settlement owner directory'
  );
  const writer = journalWriter(commonDirectory);
  if (directory === null) return Object.freeze({ matching: Object.freeze([]), writer });
  const entries = scanNoFollowDirectoryDirectMetadata(directory, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: MAXIMUM_JOURNAL_CENSUS_ENTRIES
  });
  if (entries.some(({ kind, relativePath }) => kind !== 'file' || !JOURNAL_NAME.test(relativePath))) {
    throw new Error('Development commit journal settlement found unrecognized owner residue.');
  }
  let observedBytes = 0;
  const matching: ObservedDevelopmentCommitJournal[] = [];
  for (const entry of entries) {
    const journalPath = path.join(directory.path, entry.relativePath);
    const observed = writer.observeTextRetained(journalPath, {
      deadlineAtMonotonicMs,
      maximumBytes: MAXIMUM_JOURNAL_BYTES
    });
    if (observed === null) {
      throw new Error('Development commit journal disappeared during settlement census.');
    }
    observedBytes += observed.byteLength;
    if (observedBytes > MAXIMUM_JOURNAL_CENSUS_BYTES) {
      throw new Error('Development commit journal settlement exceeds its aggregate byte ceiling.');
    }
    const journal = parseJournal(observed.text);
    if (journal.ref !== ref) continue;
    matching.push(Object.freeze({ journal, journalPath, source: observed.text }));
  }
  if (matching.length > MAXIMUM_REF_JOURNALS) {
    throw new Error('Development commit journal settlement exceeds its exact-ref attempt ceiling.');
  }
  return Object.freeze({ matching: Object.freeze(matching), writer });
}

/**
 * Settles every recovery journal owned by one exact branch ref before that ref
 * loses its native reflog. All matching journals are independently classified
 * before the first retirement; one attempt that the native ref/object/reflog
 * observation cannot now prove applied preserves the complete set and blocks
 * branch deletion. A stale terminal projection never overrules newer native
 * proof for the same Effect identity.
 */
export async function settleDevelopmentCommitJournalsForRef(input: Readonly<{
  readonly repositoryRoot: string;
  readonly ref: string;
}>): Promise<DevelopmentCommitJournalSettlement> {
  if (!REF.test(input.ref)) throw new Error('Development commit journal settlement ref is invalid.');
  const repositoryRoot = path.resolve(input.repositoryRoot);
  return withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
      const commonDirectory = path.resolve(await commandText(
        session,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'resolve journal settlement common directory'
      ));
      const { matching, writer } = observeJournalCensus(commonDirectory, input.ref);
      const classified = [] as Array<Readonly<{
        journal: Journal;
        journalPath: string;
        source: string;
        readback: DevelopmentCommitReadbackReceipt;
      }>>;
      for (const candidate of matching) {
        const readback = await readDevelopmentCommitOutcome({
          session,
          commonDirectory,
          journal: candidate.journal,
          normal: null
        });
        if (readback.disposition !== 'applied') {
          throw new Error(`Development commit journal settlement requires applied readback, got ${readback.disposition}.`);
        }
        classified.push(Object.freeze({ ...candidate, readback }));
      }
      for (const candidate of classified) {
        const terminalJournal = candidate.journal.terminal === 'applied'
          ? candidate.journal
          : Object.freeze({ ...candidate.journal, terminal: 'applied' as const });
        const terminalSource = encodeJournal(terminalJournal);
        if (candidate.source !== terminalSource
            && !writer.replaceFsyncCas(candidate.journalPath, candidate.source, terminalSource)) {
          throw new Error('Development commit journal changed before settlement terminalization.');
        }
        const result = Object.freeze({
          schema: 'sec-development-commit-result-v1' as const,
          disposition: 'applied' as const,
          ref: terminalJournal.ref,
          preimage: terminalJournal.preimage,
          target: terminalJournal.target,
          tree: terminalJournal.tree,
          journalPath: candidate.journalPath
        });
        ISSUED_DEVELOPMENT_COMMIT_RESULTS.set(result, Object.freeze({
          commonDirectory,
          journalPath: candidate.journalPath,
          journalSource: terminalSource,
          predecessorJournals: Object.freeze([]),
          readback: candidate.readback
        }));
        acknowledgeDevelopmentCommitResult(result);
      }
      return Object.freeze({
        ref: input.ref,
        observed: matching.length,
        retired: classified.length
      });
    }
  );
}

/**
 * Historical retirement after a PR transport has consumed the commit family
 * and both topic refs are gone. This proves consumer termination, not a lost
 * local CAS transition. No caller-supplied receipt or terminal flag suffices.
 */
export async function retireMergedDevelopmentCommitJournals(input: Readonly<{
  repositoryRoot: string;
  capability: GitHubApiCapability;
  pullRequestNumber: number;
}>): Promise<DevelopmentCommitJournalSettlement> {
  const binding = inspectGitHubApiCapability(input.capability);
  const repository = await executeGitHubApiOperation(input.capability, { kind: 'repository' }) as Record<string, unknown>;
  if (repository.full_name !== binding.repository || typeof repository.default_branch !== 'string') {
    throw new Error('Merged commit retirement repository observation differs.');
  }
  const readPull = async () => {
    const value = await executeGitHubApiOperation(input.capability, { kind: 'pull', pullRequestNumber: input.pullRequestNumber }) as Record<string, unknown>;
    const head = value.head as Record<string, unknown> | undefined;
    const base = value.base as Record<string, unknown> | undefined;
    const headRepository = head?.repo as Record<string, unknown> | undefined;
    const baseRepository = base?.repo as Record<string, unknown> | undefined;
    if (value.number !== input.pullRequestNumber || value.merged !== true || value.state !== 'closed'
        || typeof head?.ref !== 'string' || !REF.test(`refs/heads/${head.ref}`)
        || typeof head.sha !== 'string' || !OBJECT_ID.test(head.sha)
        || head.ref === repository.default_branch || base?.ref !== repository.default_branch
        || headRepository?.full_name !== binding.repository || baseRepository?.full_name !== binding.repository
        || typeof value.merge_commit_sha !== 'string' || !OBJECT_ID.test(value.merge_commit_sha)) {
      throw new Error('Commit retirement requires one exact repository-local merged PR.');
    }
    return Object.freeze({ branch: head.ref, headSha: head.sha, mergeSha: value.merge_commit_sha });
  };
  const pull = await readPull();
  const ref = `refs/heads/${pull.branch}`;
  return withAuthorityGitReadSession({ cwd: input.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const assertTerminal = async () => {
      await assertGitHubRepositoryBinding(session, binding.repository);
      if (JSON.stringify(await readPull()) !== JSON.stringify(pull)) throw new Error('Merged PR identity changed before retirement.');
      const local = await commandText(session,
        ['for-each-ref', '--format=%(refname)', ref], 'observe retired local topic ref');
      if (local.split(/\r?\n/u).includes(ref)) throw new Error('Merged commit retirement still has a local ref consumer.');
      const worktreeList = await session.run(['worktree', 'list', '--porcelain', '-z']);
      if (worktreeList.kind !== 'completed' || worktreeList.result.code !== 0
          || worktreeList.result.stderr.length !== 0) {
        throw new Error('Merged commit retirement cannot observe the worktree registry.');
      }
      if (parseWorktreePorcelainZ(worktreeList.result.stdout)
        .some((worktree) => worktree.branch === pull.branch)) {
        throw new Error('Merged commit retirement still has a worktree consumer.');
      }
      let remoteAbsent = false;
      try { await executeGitHubApiOperation(input.capability, { kind: 'git-ref', branch: pull.branch }); }
      catch (error) {
        if (error instanceof GitHubApiProviderError && error.statusCode === 404) remoteAbsent = true;
        else throw error;
      }
      if (!remoteAbsent) throw new Error('Merged commit retirement still has a remote ref consumer.');
      const remoteMain = await executeGitHubApiOperation(input.capability, { kind: 'git-ref', branch: String(repository.default_branch) }) as Record<string, unknown>;
      const mainObject = remoteMain.object as Record<string, unknown> | undefined;
      if (remoteMain.ref !== `refs/heads/${repository.default_branch}` || typeof mainObject?.sha !== 'string'
          || !OBJECT_ID.test(mainObject.sha)) throw new Error('Merged commit retirement main identity is unresolved.');
      const reachable = await session.run(['merge-base', '--is-ancestor', pull.mergeSha, mainObject.sha]);
      if (reachable.kind !== 'completed' || reachable.result.code !== 0) {
        throw new Error('Merged commit retirement is not reachable from live default ref.');
      }
    };
    await assertTerminal();
    const commonDirectory = path.resolve(await commandText(session,
      ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve merged journal common directory'));
    const { matching, writer } = observeJournalCensus(commonDirectory, ref);
    for (const { journal } of matching) {
      if (journal.terminal !== 'applied' || journal.object !== journal.target) {
        throw new Error('Merged commit retirement preserves nonterminal or unknown journal consumers.');
      }
      const bytes = await commandText(session, ['cat-file', 'commit', journal.target], 'read merged journal commit');
      const headers = bytes.split('\n\n', 1)[0]!.split('\n');
      if (JSON.stringify(headers.filter((line) => line.startsWith('tree '))) !== JSON.stringify([`tree ${journal.tree}`])
          || JSON.stringify(headers.filter((line) => line.startsWith('parent '))) !== JSON.stringify([`parent ${journal.preimage}`])) {
        throw new Error('Merged commit retirement journal object binding differs.');
      }
      const consumed = await session.run(['merge-base', '--is-ancestor', journal.target, pull.headSha]);
      if (consumed.kind !== 'completed' || consumed.result.code !== 0) {
        throw new Error('Merged PR did not consume this exact journal target.');
      }
    }
    await assertTerminal();
    // Classify the entire family before the first deletion; CAS preserves any
    // journal generation that changed after observation.
    for (const candidate of matching) {
      if (!writer.deleteFsyncCas(candidate.journalPath, candidate.source)) {
        throw new Error('Merged commit journal changed before retirement.');
      }
    }
    retireEmptyJournalDirectory(commonDirectory);
    return Object.freeze({ ref, observed: matching.length, retired: matching.length });
  });
}

/** Canonical development.commit producer and public domain entrypoint. */
export function runDevelopmentCommit(
  request: DevelopmentCommitRequest,
  admission: DevelopmentCommitAdmission
): Promise<DevelopmentCommitResult> {
  return execute(request, admission, Object.freeze({}));
}

async function recoverDevelopmentCommitWithReadback(input: Readonly<{
  readonly repositoryRoot: string;
  readonly journalPath: string;
}>): Promise<Readonly<{
  result: DevelopmentCommitResult;
  readback: DevelopmentCommitReadbackReceipt;
  commonDirectory: string;
  providerIdentityDigest: SecOperationDigest;
  journalSource: string;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  return withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
      const commonDirectory = path.resolve(await commandText(
      session,
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      'resolve recovery common directory'
      ));
      const relative = path.relative(path.join(commonDirectory, JOURNAL_DIRECTORY), path.resolve(input.journalPath));
      if (relative.length === 0 || path.isAbsolute(relative) || relative === '..'
          || relative.startsWith(`..${path.sep}`)) {
        throw new Error('Development commit recovery journal escapes its exact owner root.');
      }
      let journal = readJournal(commonDirectory, path.resolve(input.journalPath));
      const readback = await readDevelopmentCommitOutcome({ session, commonDirectory, journal, normal: null });
      journal = Object.freeze({
        ...journal,
        terminal: readback.disposition === 'applied'
          ? 'applied' as const
          : journal.terminal !== null && journal.terminal !== readback.disposition
            ? 'unknown' as const
            : readback.disposition
      });
      writeJournal(commonDirectory, path.resolve(input.journalPath), journal, false);
      const journalSource = encodeJournal(journal);
      const result = Object.freeze({
        schema: 'sec-development-commit-result-v1' as const,
        disposition: journal.terminal!, ref: journal.ref, preimage: journal.preimage,
        target: journal.target, tree: journal.tree, journalPath: path.resolve(input.journalPath)
      });
      return Object.freeze({
        result,
        readback,
        commonDirectory,
        providerIdentityDigest: sha256(session.providerIdentity) as SecOperationDigest,
        journalSource
      });
    }
  );
}

/** Independent lost-handle projection; journal bytes never authorize replay. */
export async function recoverDevelopmentCommit(input: Readonly<{
  readonly repositoryRoot: string;
  readonly journalPath: string;
}>): Promise<DevelopmentCommitRecovery> {
  const details = await recoverDevelopmentCommitWithReadback(input);
  const recovery = Object.freeze({
    result: details.result,
    readbackReceiptDigest: details.readback.readbackReceiptDigest
  });
  ISSUED_DEVELOPMENT_COMMIT_RECOVERIES.set(recovery, details);
  ISSUED_DEVELOPMENT_COMMIT_RESULTS.set(details.result, Object.freeze({
    commonDirectory: details.commonDirectory,
    journalPath: details.result.journalPath,
    journalSource: details.journalSource,
    predecessorJournals: Object.freeze([]),
    readback: details.readback
  }));
  return recovery;
}

/** CLI recovery consumer; journal reference is observation-only. */
export async function runDevelopmentCommitRecoveryCommand(args: readonly string[]): Promise<number> {
  if (args.length === 3 && args[0] === '--retire-merged-pr' && /^[1-9][0-9]*$/u.test(args[2]!)) {
    const result = await withGitHubApiReadSession({ repositoryRoot: path.resolve(process.cwd()), repository: args[1]!,
      operation: (capability) => retireMergedDevelopmentCommitJournals({ repositoryRoot: path.resolve(process.cwd()),
        capability, pullRequestNumber: Number(args[2]) }) });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (args.length !== 1 || !path.isAbsolute(args[0]!)) {
    throw new Error('development commit recovery requires one absolute journal path.');
  }
  const recovery = await recoverDevelopmentCommit({
    repositoryRoot: path.resolve(process.cwd()),
    journalPath: path.resolve(args[0]!)
  });
  console.log(JSON.stringify(recovery.result, null, 2));
  if (recovery.result.disposition === 'applied') acknowledgeDevelopmentCommitResult(recovery.result);
  return recovery.result.disposition === 'unknown' ? 1 : 0;
}

/** A successor attempt exists only after independent not-applied readback. */
export async function retryDevelopmentCommit(input: Readonly<{
  readonly request: DevelopmentCommitRequest;
  readonly admission: DevelopmentCommitAdmission;
  readonly recovery: DevelopmentCommitRecovery;
}>): Promise<DevelopmentCommitResult> {
  const admitted = consumeDevelopmentCommitAdmission({
    admission: input.admission,
    request: input.request
  });
  const recoveredProjection = ISSUED_DEVELOPMENT_COMMIT_RECOVERIES.get(input.recovery);
  if (recoveredProjection === undefined) {
    throw new Error('Development commit retry requires an owner-issued recovery capability.');
  }
  const recovered = input.recovery.result;
  assertDevelopmentCommitReadbackReceipt(recoveredProjection.readback);
  if (recovered.disposition !== 'not-applied') {
    throw new Error(`Development commit retry requires not-applied readback, got ${recovered.disposition}.`);
  }
  const { candidate, candidateDetails, contract, operation } = admitted;
  const repositoryRoot = candidate.repositoryRoot;
  const commonDirectory = Object.freeze({
    path: recoveredProjection.commonDirectory,
    providerIdentityDigest: recoveredProjection.providerIdentityDigest
  });
  const previous = readJournal(commonDirectory.path, recovered.journalPath);
  if (commonDirectory.path !== candidateDetails.commonDirectory
      || commonDirectory.providerIdentityDigest !== candidateDetails.providerIdentityDigest
      || encodeJournal(previous) !== recoveredProjection.journalSource
      || previous.ref !== candidate.ref
      || previous.preimage !== candidate.preimage
      || previous.target !== candidate.target
      || previous.tree !== candidate.tree) {
    throw new Error('Development commit retry admission does not bind the recovered attempt.');
  }
  const journalPath = path.join(
    commonDirectory.path,
    JOURNAL_DIRECTORY,
    `${operation.plan.attempt.attemptNonceDigest.slice('sha256:'.length)}.retry.json`
  );
  let journal: Journal = Object.freeze({
    schema: JOURNAL_SCHEMA,
    operation: operation.plan.identity.identityDigest,
    attempt: operation.boundAttemptDigest,
    ref: previous.ref,
    preimage: previous.preimage,
    target: previous.target,
    object: previous.target,
    tree: previous.tree,
    terminal: null
  });
  const resolution = createAuthorityGitReadSession({
    cwd: repositoryRoot,
    operation,
    budget: {
      ...GIT_READ_OPERATION_BUDGET,
      maxProcesses: DEVELOPMENT_COMMIT_RETRY_PROCESS_COUNT,
      maxStdinBytes: 1,
      maxStdoutBytes: 4 * 1024,
      maxStderrBytes: 64 * 1024,
      maxCommandStdoutBytes: 4 * 1024,
      maxCommandStderrBytes: 64 * 1024
    }
  });
  if (resolution.status !== 'ready') throw new Error(`Development commit retry provider unavailable: ${resolution.reason}`);
  let retrySettlement: SecProviderSettlementSet | null = null;
  let retryReadback: DevelopmentCommitReadbackReceipt | null = null;
  try {
    await assertDevelopmentCommitCandidateCurrent({
      candidate,
      request: input.request,
      session: resolution.session
    });
    ISSUED_DEVELOPMENT_COMMIT_RECOVERIES.delete(input.recovery);
    writeJournal(commonDirectory.path, journalPath, journal, true);
    const refSettlement = await compareAndSwapAuthorityDevelopmentCommitRef({ gitReadSession: resolution.session, contract });
    retrySettlement = compileSecProviderSettlementSet(operation, [
      settleGitDevelopmentCommitOperation(operation, refSettlement)
    ]);
    retryReadback = await readDevelopmentCommitOutcome({
      session: resolution.session,
      commonDirectory: commonDirectory.path,
      journal,
      normal: { operation, settlement: retrySettlement, contractDigest: compileGitDevelopmentCommitContractDigest(contract) }
    });
  } finally {
    await resolution.session.close?.();
  }
  if (retryReadback === null) throw new Error('Development commit retry readback receipt is absent.');
  const { disposition } = retryReadback;
  journal = Object.freeze({ ...journal, terminal: disposition });
  writeJournal(commonDirectory.path, journalPath, journal, false);
  const predecessorJournals = disposition === 'applied'
    ? observeJournalCensus(commonDirectory.path, journal.ref).matching
      .filter(({ journal: observed, journalPath: observedPath }) => (
        observedPath !== journalPath
        && observed.preimage === journal.preimage
        && observed.target === journal.target
        && observed.tree === journal.tree
      ))
      .sort((left, right) => left.journalPath.localeCompare(right.journalPath))
      .map(({ journalPath: predecessorPath, source }) => Object.freeze({
        journalPath: predecessorPath,
        journalSource: source
      }))
    : Object.freeze([]);
  const result = Object.freeze({
    schema: 'sec-development-commit-result-v1',
    disposition,
    ref: journal.ref,
    preimage: journal.preimage,
    target: journal.target,
    tree: journal.tree,
    journalPath
  });
  ISSUED_DEVELOPMENT_COMMIT_RESULTS.set(result, Object.freeze({
    commonDirectory: commonDirectory.path,
    journalPath,
    journalSource: encodeJournal(journal),
    predecessorJournals: Object.freeze(predecessorJournals),
    readback: retryReadback
  }));
  return result;
}

/** Test-only timing seam; it cannot bypass admission, authorization or readback. */
export function runDevelopmentCommitForTests(
  request: DevelopmentCommitRequest,
  admission: DevelopmentCommitAdmission,
  hooks: CommitTestHooks
): Promise<DevelopmentCommitResult> {
  return execute(request, admission, hooks);
}
