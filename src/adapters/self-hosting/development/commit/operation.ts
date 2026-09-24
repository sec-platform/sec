import path from 'node:path';

import { canonicalJson, sha256 } from '../../../../contracts/canonical.ts';
import {
  consumeOperationRequirementBindingContext,
  type OperationRequirementBindingContext,
  type OperationResourceCeiling
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  compileProviderSettlementSet,
  issueNormalDomainReadbackReceipt,
  type BoundSemanticOperation,
  type OperationDigest,
  type ProviderSettlementSet
} from '../../../../execution/operation/semantic.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../../filesystem/write-lease.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { assertGitHubRepositoryBinding } from '../../../providers/git-read/repository-binding.ts';
import {
  compareAndSwapAuthorityDevelopmentCommitRef,
  compileGitDevelopmentCommitContractDigest,
  createAuthorityGitReadSession,
  materializeAuthorityDevelopmentCommitObject,
  settleGitDevelopmentCommitOperation,
  type GitReadSession
} from '../../../providers/git-read/runtime/session.ts';
import {
  executeGitHubApiOperation,
  GitHubApiProviderError,
  inspectGitHubApiCapability,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { parseWorktreePorcelainZ } from '../../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem } from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import { assertDevelopmentCommitCandidateCurrent } from '../commit-admission/candidate.ts';
import {
  consumeDevelopmentCommitAdmission,
  DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT,
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
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;
const JOURNAL_NAME = /^[0-9a-f]{64}(?:\.retry)?\.json$/u;

export const JOURNAL_RETIREMENT_REQUIREMENT_ID =
  'repository.closed-absent-development-commit-journal-retirement' as const;
export const JOURNAL_RETIREMENT_CONTRACT_DIGEST = sha256({
  domain: 'development.commit.closed-absent-journal-retirement',
  effectKinds: ['filesystem', 'process', 'provider'],
  invariants: [
    'authenticated-closed-unmerged-pr-head',
    'repository-and-ref-consumers-absent',
    'complete-exact-ref-journal-classification-before-cas',
    'owner-issued-plan-and-acknowledgement'
  ]
}) as OperationDigest;
export const JOURNAL_RETIREMENT_PROVIDER_DIGEST = sha256({
  domain: 'development.commit.closed-absent-journal-retirement-provider',
  provider: 'development.commit'
}) as OperationDigest;
export const JOURNAL_RETIREMENT_RESOURCE_CEILINGS = Object.freeze([
  Object.freeze({ resource: 'duration-ms' as const, maximum: 30_000 }),
  Object.freeze({ resource: 'input-bytes' as const, maximum: 65_536 }),
  Object.freeze({ resource: 'output-bytes' as const, maximum: 67_108_864 }),
  Object.freeze({ resource: 'processes' as const, maximum: 64 }),
  Object.freeze({ resource: 'records' as const, maximum: 256 })
]) satisfies readonly OperationResourceCeiling[];
export const JOURNAL_RETIREMENT_REQUEST_CEILING = 8;

type DevelopmentCommitDisposition = 'applied' | 'not-applied' | 'unknown';

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
  readonly operation: OperationDigest;
  readonly attempt: OperationDigest;
  readonly readbackReceiptDigest: OperationDigest;
}>;

type DevelopmentCommitRecovery = Readonly<{
  readonly result: DevelopmentCommitResult;
  readonly readbackReceiptDigest: OperationDigest;
}>;

type DevelopmentCommitRecoveryDetails = Readonly<{
  readonly result: DevelopmentCommitResult;
  readonly readback: DevelopmentCommitReadbackReceipt;
  readonly commonDirectory: string;
  readonly providerIdentityDigest: OperationDigest;
  readonly journalSource: string;
}>;

const ISSUED_DEVELOPMENT_COMMIT_READBACKS = new WeakSet<object>();
const ISSUED_DEVELOPMENT_COMMIT_RECOVERIES = new WeakMap<object, DevelopmentCommitRecoveryDetails>();
const ISSUED_DEVELOPMENT_COMMIT_RESULTS = new WeakMap<object, Readonly<{
  repositoryRoot: string;
  commonDirectory: string;
  journalPath: string;
  journalSource: string;
  readback: DevelopmentCommitReadbackReceipt;
}>>();

type Journal = Readonly<{
  readonly schema: typeof JOURNAL_SCHEMA;
  readonly operation: OperationDigest;
  readonly attempt: OperationDigest;
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

class DevelopmentCommitLostHandleError extends Error {
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

type ObservedJournal = Readonly<{ journal: Journal; journalPath: string; source: string }>;

function observeJournalCensus(commonDirectory: string, ref: string): Readonly<{
  matching: readonly ObservedJournal[];
  writer: ReturnType<typeof journalWriter>;
}> {
  const deadlineAtMonotonicMs = performance.now() + 5_000;
  const common = inspectNoFollowDirectoryChain(commonDirectory, 'Development commit journal common directory').target;
  const directory = inspectNoFollowDirectoryChild(common, JOURNAL_DIRECTORY, 'Development commit journal owner');
  const writer = journalWriter(commonDirectory);
  if (directory === null) return Object.freeze({ matching: Object.freeze([]), writer });
  const entries = scanNoFollowDirectoryDirectMetadata(directory, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: MAXIMUM_JOURNAL_CENSUS_ENTRIES
  });
  if (entries.some(({ kind, relativePath }) => kind !== 'file' || !JOURNAL_NAME.test(relativePath))) {
    throw new Error('Development commit journal census found unrecognized owner residue.');
  }
  let observedBytes = 0;
  const matching: ObservedJournal[] = [];
  for (const entry of entries) {
    const journalPath = path.join(directory.path, entry.relativePath);
    const observed = writer.observeTextRetained(journalPath, {
      deadlineAtMonotonicMs,
      maximumBytes: MAXIMUM_JOURNAL_BYTES
    });
    if (observed === null) throw new Error('Development commit journal disappeared during census.');
    observedBytes += observed.byteLength;
    if (observedBytes > MAXIMUM_JOURNAL_CENSUS_BYTES) {
      throw new Error('Development commit journal census exceeds its aggregate byte ceiling.');
    }
    const journal = parseJournal(observed.text);
    if (journal.ref === ref) matching.push(Object.freeze({ journal, journalPath, source: observed.text }));
  }
  if (matching.length > MAXIMUM_REF_JOURNALS) {
    throw new Error('Development commit journal exact-ref attempt ceiling exceeded.');
  }
  return Object.freeze({ matching: Object.freeze(matching), writer });
}

function createJournalWithinRefAttemptCeiling(commonDirectory: string, journalPath: string, journal: Journal): void {
  const before = observeJournalCensus(commonDirectory, journal.ref);
  if (before.matching.length >= MAXIMUM_REF_JOURNALS) {
    throw new Error('Development commit journal exact-ref attempt ceiling is full.');
  }
  const source = encodeJournal(journal);
  writeJournal(commonDirectory, journalPath, journal, true);
  try {
    observeJournalCensus(commonDirectory, journal.ref);
  } catch (error) {
    journalWriter(commonDirectory).deleteFsyncCas(journalPath, source);
    throw error;
  }
}

function retireEmptyJournalDirectory(commonDirectory: string): void {
  const parent = inspectNoFollowDirectoryChain(commonDirectory, 'Commit journal retirement parent').target;
  const root = inspectNoFollowDirectoryChild(parent, JOURNAL_DIRECTORY, 'Commit journal retirement owner');
  if (root === null) return;
  const deadlineAtMonotonicMs = performance.now() + 5_000;
  if (scanNoFollowDirectoryDirectMetadata(root, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: MAXIMUM_JOURNAL_CENSUS_ENTRIES
  }).length !== 0) return;
  retireNoFollowDirectoryTree({ parent, root, inventory: [], deadlineAtMonotonicMs });
}

export async function readDevelopmentCommitOutcome(input: Readonly<{
  session: GitReadSession;
  commonDirectory: string;
  journal: Journal;
  normal: null | Readonly<{
    operation: BoundSemanticOperation;
    settlement: ProviderSettlementSet;
    contractDigest: OperationDigest;
  }>;
}>): Promise<DevelopmentCommitReadbackReceipt> {
  const disposition = await (async (session: GitReadSession) => {
    const journal = input.journal;
    const ref = await commandText(
      session,
      ['rev-parse', '--verify', '--end-of-options', journal.ref],
      'read back commit ref'
    ).catch(() => '');
    const objectType = await commandText(session, ['cat-file', '-t', journal.target], 'read commit object type')
      .catch(() => '');
    const objectBytes = await commandText(session, ['cat-file', 'commit', journal.target], 'read commit object')
      .catch(() => '');
    const index = await session.run([
      'diff-index', '--cached', '--exit-code', journal.tree, '--'
    ]);
    const indexMatches = index.kind === 'completed' && index.result.code === 0;
    const objectMatches = objectType === 'commit'
      && objectBytes.startsWith(`tree ${journal.tree}\nparent ${journal.preimage}\n`);
    const reflog = await commandText(
      session,
      ['rev-list', '--walk-reflogs', journal.ref],
      'read back commit reflog'
    ).catch(() => null);
    if (reflog === null) return 'unknown';
    const reflogTargets = reflog.length === 0 ? [] : reflog.split(/\r?\n/u);
    const reflogContainsTarget = reflogTargets.includes(journal.target);
    const exactRefTransition = reflogTargets[0] === journal.target
      && reflogTargets[1] === journal.preimage;
    if (ref === journal.target && objectMatches && indexMatches && exactRefTransition) return 'applied';
    const objectAbsent = objectType === '' && objectBytes === '';
    if (ref === journal.preimage && (objectMatches || objectAbsent)
        && indexMatches && !reflogContainsTarget) return 'not-applied';
    return 'unknown';
  })(input.session);
  if (input.normal !== null) {
    issueNormalDomainReadbackReceipt(input.normal.operation, input.normal.settlement, {
      readbackContractDigest: input.normal.contractDigest,
      readbackReferenceDigest: sha256({ ref: input.journal.ref, target: input.journal.target, disposition }) as OperationDigest,
      currentPhysicalEpochDigest: sha256({ preimage: input.journal.preimage, target: input.journal.target, tree: input.journal.tree }) as OperationDigest,
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
    }) as OperationDigest
  });
  ISSUED_DEVELOPMENT_COMMIT_READBACKS.add(receipt);
  return receipt;
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
  return withAcquiredResource({
    operationLabel: 'development-commit',
    resourceLabel: 'development-commit-git-session',
    acquire: () => resolution.session,
    use: async () => {
      const commonDirectory = path.resolve(await commandText(
        resolution.session,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'resolve coordinated commit common directory'
      ));
      if (commonDirectory !== candidateDetails.commonDirectory) {
        throw new Error('Development commit common directory changed before coordinated mutation.');
      }
      return await withWorkspaceWriteLease(commonDirectory, undefined, async (lease) => {
        let providerSettlementSet: ProviderSettlementSet | null = null;
        let readback: DevelopmentCommitReadbackReceipt | null = null;
        {
          await assertDevelopmentCommitCandidateCurrent({
            candidate: frozen,
            request,
            session: resolution.session
          });
          createJournalWithinRefAttemptCeiling(candidateDetails.commonDirectory, journalPath, journal);
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
          await assertWorkspaceWriteLease(commonDirectory, lease);
          const refSettlement = await compareAndSwapAuthorityDevelopmentCommitRef({ gitReadSession: resolution.session, contract });
          providerSettlementSet = compileProviderSettlementSet(operation, [
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
          repositoryRoot: frozen.repositoryRoot,
          commonDirectory: candidateDetails.commonDirectory,
          journalPath,
          journalSource: encodeJournal(journal),
          readback
        }));
        return result;
      });
    },
    release: async (session) => { await session.close?.(); }
  });
}

function assertDevelopmentCommitReadbackReceipt(value: DevelopmentCommitReadbackReceipt): void {
  if (!ISSUED_DEVELOPMENT_COMMIT_READBACKS.has(value)) {
    throw new Error('Development commit retirement requires an exact readback-issued receipt.');
  }
}

/** Acknowledgement is the sole retirement authority for an owner-issued applied result. */
export function acknowledgeDevelopmentCommitResult(result: DevelopmentCommitResult): void {
  const issued = ISSUED_DEVELOPMENT_COMMIT_RESULTS.get(result);
  if (issued === undefined) throw new Error('Development commit retirement requires one owner-issued result.');
  assertDevelopmentCommitReadbackReceipt(issued.readback);
  if (result.disposition !== 'applied' || issued.readback.disposition !== 'applied') {
    throw new Error(`Development commit retirement requires applied readback, got ${result.disposition}.`);
  }
  if (!journalWriter(issued.commonDirectory).deleteFsyncCas(issued.journalPath, issued.journalSource)) {
    throw new Error('Development commit journal changed before exact retirement.');
  }
  ISSUED_DEVELOPMENT_COMMIT_RESULTS.delete(result);
  retireEmptyJournalDirectory(issued.commonDirectory);
}

export async function acknowledgeNotAppliedDevelopmentCommitResult(result: DevelopmentCommitResult): Promise<void> {
  const issued = ISSUED_DEVELOPMENT_COMMIT_RESULTS.get(result);
  if (issued === undefined) throw new Error('Development commit cancellation requires one owner-issued result.');
  assertDevelopmentCommitReadbackReceipt(issued.readback);
  if (result.disposition !== 'not-applied' || issued.readback.disposition !== 'not-applied') {
    throw new Error(`Development commit cancellation requires not-applied readback, got ${result.disposition}.`);
  }
  await withAuthorityGitReadSession({ cwd: issued.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const commonDirectory = path.resolve(await commandText(
      session, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'reobserve cancellation common directory'
    ));
    if (commonDirectory !== issued.commonDirectory) throw new Error('Development commit cancellation common directory changed.');
    const journal = readJournal(commonDirectory, issued.journalPath);
    if (encodeJournal(journal) !== issued.journalSource || journal.ref !== result.ref
        || journal.preimage !== result.preimage || journal.target !== result.target || journal.tree !== result.tree) {
      throw new Error('Development commit cancellation journal generation changed.');
    }
    const readback = await readDevelopmentCommitOutcome({ session, commonDirectory, journal, normal: null });
    if (readback.disposition !== 'not-applied') {
      throw new Error(`Development commit cancellation fresh readback is ${readback.disposition}.`);
    }
    if (!journalWriter(commonDirectory).deleteFsyncCas(issued.journalPath, issued.journalSource)) {
      throw new Error('Development commit cancellation journal changed before exact retirement.');
    }
  });
  ISSUED_DEVELOPMENT_COMMIT_RESULTS.delete(result);
  retireEmptyJournalDirectory(issued.commonDirectory);
}

export type DevelopmentCommitJournalSettlement = Readonly<{ ref: string; observed: number; retired: number }>;

/** Ref retirement requires classifying the entire family before its reflog is lost. */
export async function settleDevelopmentCommitJournalsForRef(input: Readonly<{
  repositoryRoot: string;
  ref: string;
}>): Promise<DevelopmentCommitJournalSettlement> {
  if (!REF.test(input.ref)) throw new Error('Development commit journal settlement ref is invalid.');
  const repositoryRoot = path.resolve(input.repositoryRoot);
  return withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const commonDirectory = path.resolve(await commandText(
      session, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve journal settlement common directory'
    ));
    const { matching, writer } = observeJournalCensus(commonDirectory, input.ref);
    for (const candidate of matching) {
      const readback = await readDevelopmentCommitOutcome({ session, commonDirectory, journal: candidate.journal, normal: null });
      if (readback.disposition !== 'applied') {
        throw new Error(`Development commit journal settlement requires applied readback, got ${readback.disposition}.`);
      }
    }
    for (const candidate of matching) {
      const terminal = candidate.journal.terminal === 'applied'
        ? candidate.journal : Object.freeze({ ...candidate.journal, terminal: 'applied' as const });
      const source = encodeJournal(terminal);
      if (candidate.source !== source && !writer.replaceFsyncCas(candidate.journalPath, candidate.source, source)) {
        throw new Error('Development commit journal changed before settlement terminalization.');
      }
      if (!writer.deleteFsyncCas(candidate.journalPath, source)) {
        throw new Error('Development commit journal changed before settlement retirement.');
      }
    }
    retireEmptyJournalDirectory(commonDirectory);
    return Object.freeze({ ref: input.ref, observed: matching.length, retired: matching.length });
  });
}

declare const JOURNAL_RETIREMENT_PLAN: unique symbol;
export type DevelopmentCommitJournalRetirementPlan = Readonly<{
  readonly [JOURNAL_RETIREMENT_PLAN]: true;
}>;

type PullObservation = Readonly<{ branch: string; headSha: string }>;
type ClosedAbsentRetirementDetails = Readonly<{
  repositoryRoot: string;
  remote: string;
  capability: GitHubApiCapability;
  pullRequestNumber: number;
  repository: string;
  defaultBranch: string | null;
  pull: PullObservation | null;
  ref: string;
  commonDirectory: string;
  initialCount: number;
  remaining: readonly ObservedJournal[];
}>;
const ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS = new WeakMap<object, ClosedAbsentRetirementDetails>();

function assertClosedAbsentRetirementBinding(context: OperationRequirementBindingContext): void {
  const projection = consumeOperationRequirementBindingContext(context);
  if (projection.requirementId !== JOURNAL_RETIREMENT_REQUIREMENT_ID
      || projection.requirementContractDigest !== JOURNAL_RETIREMENT_CONTRACT_DIGEST
      || projection.providerIdentityDigest !== JOURNAL_RETIREMENT_PROVIDER_DIGEST
      || JSON.stringify(projection.resourceCeilings)
        !== JSON.stringify(JOURNAL_RETIREMENT_RESOURCE_CEILINGS)) {
    throw new Error('Closed-absent commit journal retirement physical binding differs.');
  }
}

async function readClosedAbsentPull(input: Readonly<{
  capability: GitHubApiCapability; pullRequestNumber: number; repository: string; defaultBranch: string;
}>): Promise<PullObservation> {
  const value = await executeGitHubApiOperation(input.capability, {
    kind: 'pull', pullRequestNumber: input.pullRequestNumber
  }) as Record<string, unknown>;
  const head = value.head as Record<string, unknown> | undefined;
  const base = value.base as Record<string, unknown> | undefined;
  const headRepository = head?.repo as Record<string, unknown> | undefined;
  const baseRepository = base?.repo as Record<string, unknown> | undefined;
  if (value.number !== input.pullRequestNumber || value.state !== 'closed' || value.merged !== false
      || typeof head?.ref !== 'string' || !REF.test(`refs/heads/${head.ref}`)
      || typeof head.sha !== 'string' || !OBJECT_ID.test(head.sha)
      || head.ref === input.defaultBranch || base?.ref !== input.defaultBranch
      || headRepository?.full_name !== input.repository || baseRepository?.full_name !== input.repository) {
    throw new Error('Commit journal retirement requires one exact repository-local closed unmerged PR.');
  }
  return Object.freeze({ branch: head.ref, headSha: head.sha });
}

async function assertNativeRefAbsent(session: GitReadSession, ref: string, label: string): Promise<void> {
  const observed = await commandText(session, ['for-each-ref', '--format=%(refname)', ref], `observe ${label}`);
  if (observed.split(/\r?\n/u).includes(ref)) {
    throw new Error(`Commit journal retirement still has a ${label} consumer.`);
  }
}

async function assertNoTopicConsumers(input: Readonly<{
  session: GitReadSession; capability: GitHubApiCapability; repository: string;
  branch: string; remote: string; pullRequestNumber: number;
}>): Promise<void> {
  await assertGitHubRepositoryBinding(input.session, input.repository);
  await assertNativeRefAbsent(input.session, `refs/heads/${input.branch}`, 'local ref');
  await assertNativeRefAbsent(input.session, `refs/remotes/${input.remote}/${input.branch}`, 'remote-tracking ref');
  await assertNativeRefAbsent(input.session, `refs/pull/${input.pullRequestNumber}/head`, 'local pull ref');
  const worktreeList = await input.session.run(['worktree', 'list', '--porcelain', '-z']);
  if (worktreeList.kind !== 'completed' || worktreeList.result.code !== 0
      || worktreeList.result.stderr.length !== 0) {
    throw new Error('Commit journal retirement cannot observe the worktree registry.');
  }
  if (parseWorktreePorcelainZ(worktreeList.result.stdout).some((worktree) => worktree.branch === input.branch)) {
    throw new Error('Commit journal retirement still has a worktree consumer.');
  }
  let remoteAbsent = false;
  try { await executeGitHubApiOperation(input.capability, { kind: 'git-ref', branch: input.branch }); }
  catch (error) {
    if (error instanceof GitHubApiProviderError && error.statusCode === 404) remoteAbsent = true;
    else throw error;
  }
  if (!remoteAbsent) throw new Error('Commit journal retirement still has a provider ref consumer.');
}

async function classifyTransportedJournals(input: Readonly<{
  session: GitReadSession; matching: readonly ObservedJournal[]; headSha: string; label: string;
}>): Promise<void> {
  for (const { journal } of input.matching) {
    if (journal.terminal !== 'applied' || journal.object !== journal.target) {
      throw new Error(`${input.label} preserves nonterminal or unknown journal consumers.`);
    }
    const bytes = await commandText(input.session, ['cat-file', 'commit', journal.target], `read ${input.label} journal commit`);
    const headers = bytes.split('\n\n', 1)[0]!.split('\n');
    if (JSON.stringify(headers.filter((line) => line.startsWith('tree ')))
          !== JSON.stringify([`tree ${journal.tree}`])
        || JSON.stringify(headers.filter((line) => line.startsWith('parent ')))
          !== JSON.stringify([`parent ${journal.preimage}`])) {
      throw new Error(`${input.label} journal object binding differs.`);
    }
    const consumed = await input.session.run(['merge-base', '--is-ancestor', journal.target, input.headSha]);
    if (consumed.kind !== 'completed' || consumed.result.code !== 0) {
      throw new Error(`${input.label} did not consume this exact journal target.`);
    }
  }
}

async function assertClosedAbsentTerminal(input: Readonly<{
  session: GitReadSession; capability: GitHubApiCapability; pullRequestNumber: number;
  repository: string; remote: string; defaultBranch: string; pull: PullObservation;
}>): Promise<void> {
  const observed = await readClosedAbsentPull(input);
  if (JSON.stringify(observed) !== JSON.stringify(input.pull)) {
    throw new Error('Closed-absent PR identity changed before commit journal retirement.');
  }
  await assertNoTopicConsumers({ ...input, branch: input.pull.branch });
}

/** The plan is process-local; caller projections never authorize filesystem effects. */
export async function prepareClosedAbsentDevelopmentCommitJournalRetirement(input: Readonly<{
  repositoryRoot: string;
  remote: string;
  ref: string;
  capability: GitHubApiCapability;
  pullRequestNumber: number;
  requirementBindingContext: OperationRequirementBindingContext;
}>): Promise<DevelopmentCommitJournalRetirementPlan> {
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0) {
    throw new Error('Closed-absent commit journal retirement PR number is invalid.');
  }
  if (!REF.test(input.ref)) throw new Error('Closed-absent commit journal retirement ref is invalid.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.remote) || input.remote.includes('..')
      || input.remote.endsWith('.')) {
    throw new Error('Closed-absent commit journal retirement remote is invalid.');
  }
  assertClosedAbsentRetirementBinding(input.requirementBindingContext);
  const binding = inspectGitHubApiCapability(input.capability);
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const observed = await withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
      await assertGitHubRepositoryBinding(session, binding.repository);
      const commonDirectory = path.resolve(await commandText(
        session, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve closed-absent common directory'
      ));
      const census = observeJournalCensus(commonDirectory, input.ref);
      if (census.matching.length === 0) {
        return Object.freeze({ commonDirectory, matching: census.matching, defaultBranch: null, pull: null });
      }
      const repositoryValue = await executeGitHubApiOperation(input.capability, { kind: 'repository' }) as Record<string, unknown>;
      if (repositoryValue.full_name !== binding.repository || typeof repositoryValue.default_branch !== 'string') {
        throw new Error('Closed-absent commit journal repository observation differs.');
      }
      const defaultBranch = repositoryValue.default_branch;
      const pull = await readClosedAbsentPull({
        capability: input.capability, pullRequestNumber: input.pullRequestNumber,
        repository: binding.repository, defaultBranch
      });
      if (`refs/heads/${pull.branch}` !== input.ref) {
        throw new Error('Closed-absent PR head ref differs from requested journal family.');
      }
      await assertClosedAbsentTerminal({
        session, capability: input.capability, pullRequestNumber: input.pullRequestNumber,
        repository: binding.repository, remote: input.remote, defaultBranch, pull
      });
      await classifyTransportedJournals({ session, matching: census.matching, headSha: pull.headSha, label: 'Closed-absent PR' });
      return Object.freeze({ commonDirectory, matching: census.matching, defaultBranch, pull });
    }
  );
  const plan = Object.freeze({}) as DevelopmentCommitJournalRetirementPlan;
  ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.set(plan, Object.freeze({
    repositoryRoot, remote: input.remote, capability: input.capability, pullRequestNumber: input.pullRequestNumber,
    repository: binding.repository, defaultBranch: observed.defaultBranch, pull: observed.pull,
    ref: input.ref, commonDirectory: observed.commonDirectory,
    initialCount: observed.matching.length, remaining: observed.matching
  }));
  return plan;
}

export async function acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(
  plan: DevelopmentCommitJournalRetirementPlan
): Promise<DevelopmentCommitJournalSettlement> {
  const issued = ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.get(plan);
  if (issued === undefined) throw new Error('Closed-absent commit journal retirement requires one owner-issued plan.');
  await withAuthorityGitReadSession({ cwd: issued.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    await assertGitHubRepositoryBinding(session, issued.repository);
    if (issued.pull !== null && issued.defaultBranch !== null) {
      await assertClosedAbsentTerminal({
        session, capability: issued.capability, pullRequestNumber: issued.pullRequestNumber,
        repository: issued.repository, remote: issued.remote, defaultBranch: issued.defaultBranch, pull: issued.pull
      });
    }
    const commonDirectory = path.resolve(await commandText(
      session, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'reobserve closed-absent common directory'
    ));
    if (commonDirectory !== issued.commonDirectory) {
      throw new Error('Closed-absent commit journal common directory changed before retirement.');
    }
    const { matching, writer } = observeJournalCensus(commonDirectory, issued.ref);
    const identity = (values: readonly ObservedJournal[]) => values.map(({ journalPath, source }) => ({ journalPath, source }));
    if (JSON.stringify(identity(matching)) !== JSON.stringify(identity(issued.remaining))) {
      throw new Error('Closed-absent commit journal family changed before retirement.');
    }
    if (matching.length !== 0 && issued.pull === null) {
      throw new Error('Closed-absent commit journal appeared after empty plan.');
    }
    if (issued.pull !== null) {
      await classifyTransportedJournals({ session, matching, headSha: issued.pull.headSha, label: 'Closed-absent PR' });
      await assertClosedAbsentTerminal({
        session, capability: issued.capability, pullRequestNumber: issued.pullRequestNumber,
        repository: issued.repository, remote: issued.remote, defaultBranch: issued.defaultBranch!, pull: issued.pull
      });
    }
    for (const [index, candidate] of matching.entries()) {
      if (!writer.deleteFsyncCas(candidate.journalPath, candidate.source)) {
        throw new Error('Closed-absent commit journal changed before exact retirement.');
      }
      ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.set(plan, Object.freeze({
        ...issued, remaining: Object.freeze(matching.slice(index + 1))
      }));
    }
  });
  ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.delete(plan);
  retireEmptyJournalDirectory(issued.commonDirectory);
  return Object.freeze({ ref: issued.ref, observed: issued.initialCount, retired: issued.initialCount });
}

/** Historical merged transport proves consumer termination, not a lost local CAS. */
export async function retireMergedDevelopmentCommitJournals(input: Readonly<{
  repositoryRoot: string;
  capability: GitHubApiCapability;
  pullRequestNumber: number;
}>): Promise<DevelopmentCommitJournalSettlement> {
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0) {
    throw new Error('Merged commit journal retirement PR number is invalid.');
  }
  const binding = inspectGitHubApiCapability(input.capability);
  const repository = await executeGitHubApiOperation(input.capability, { kind: 'repository' }) as Record<string, unknown>;
  if (repository.full_name !== binding.repository || typeof repository.default_branch !== 'string') {
    throw new Error('Merged commit journal repository observation differs.');
  }
  const readPull = async () => {
    const value = await executeGitHubApiOperation(input.capability, {
      kind: 'pull', pullRequestNumber: input.pullRequestNumber
    }) as Record<string, unknown>;
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
      throw new Error('Commit journal retirement requires one exact repository-local merged PR.');
    }
    return Object.freeze({ branch: head.ref, headSha: head.sha, mergeSha: value.merge_commit_sha });
  };
  const pull = await readPull();
  const ref = `refs/heads/${pull.branch}`;
  return withAuthorityGitReadSession({ cwd: input.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const assertTerminal = async () => {
      if (JSON.stringify(await readPull()) !== JSON.stringify(pull)) {
        throw new Error('Merged PR identity changed before journal retirement.');
      }
      await assertNoTopicConsumers({
        session, capability: input.capability, repository: binding.repository,
        branch: pull.branch, remote: 'origin', pullRequestNumber: input.pullRequestNumber
      });
      const remoteMain = await executeGitHubApiOperation(input.capability, {
        kind: 'git-ref', branch: String(repository.default_branch)
      }) as Record<string, unknown>;
      const mainObject = remoteMain.object as Record<string, unknown> | undefined;
      if (remoteMain.ref !== `refs/heads/${repository.default_branch}` || typeof mainObject?.sha !== 'string'
          || !OBJECT_ID.test(mainObject.sha)) {
        throw new Error('Merged commit journal main identity is unresolved.');
      }
      const reachable = await session.run(['merge-base', '--is-ancestor', pull.mergeSha, mainObject.sha]);
      if (reachable.kind !== 'completed' || reachable.result.code !== 0) {
        throw new Error('Merged commit journal is not reachable from live default ref.');
      }
    };
    await assertTerminal();
    const commonDirectory = path.resolve(await commandText(
      session, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve merged journal common directory'
    ));
    const { matching, writer } = observeJournalCensus(commonDirectory, ref);
    await classifyTransportedJournals({ session, matching, headSha: pull.headSha, label: 'Merged PR' });
    await assertTerminal();
    for (const candidate of matching) {
      if (!writer.deleteFsyncCas(candidate.journalPath, candidate.source)) {
        throw new Error('Merged commit journal changed before exact retirement.');
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
  providerIdentityDigest: OperationDigest;
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
      return withWorkspaceWriteLease(commonDirectory, undefined, async (lease) => {
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
        await assertWorkspaceWriteLease(commonDirectory, lease);
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
          providerIdentityDigest: sha256(session.providerIdentity) as OperationDigest,
          journalSource
        });
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
    repositoryRoot: path.resolve(input.repositoryRoot),
    commonDirectory: details.commonDirectory,
    journalPath: details.result.journalPath,
    journalSource: details.journalSource,
    readback: details.readback
  }));
  return recovery;
}
