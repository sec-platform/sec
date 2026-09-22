import path from 'node:path';

import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  compareAndSwapAuthorityDevelopmentCommitRef,
  compileGitDevelopmentCommitContractDigest,
  createAuthorityGitReadSession,
  materializeAuthorityDevelopmentCommitObject,
  settleGitDevelopmentCommitOperation,
  type GitReadSession
} from '../../../providers/git-read/runtime/session.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { parseWorktreePorcelainZ } from '../../../runtime-state/physical/contract/git-worktree-observation.ts';
import { assertGitHubRepositoryBinding } from '../../../providers/git-read/repository-binding.ts';
import {
  executeGitHubApiOperation,
  GitHubApiProviderError,
  inspectGitHubApiCapability,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { createRuntimeStateJournalFileSystem } from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import { canonicalJson, sha256 } from '../../../../contracts/canonical.ts';
import {
  consumeSecOperationRequirementBindingContext,
  type SecOperationRequirementBindingContext,
  type SecOperationResourceCeiling
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  compileSecProviderSettlementSet,
  issueSecNormalDomainReadbackReceipt,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecProviderSettlementSet
} from '../../../../execution/operation/semantic.ts';
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

export const CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID =
  'repository.closed-absent-development-commit-journal-retirement' as const;
export const CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST = sha256({
  domain: 'development.commit.closed-absent-journal-retirement',
  effectKinds: ['filesystem', 'process', 'provider'],
  invariants: [
    'authenticated-closed-unmerged-pr-head',
    'repository-and-ref-consumers-absent',
    'complete-exact-ref-journal-classification-before-cas',
    'owner-issued-plan-and-acknowledgement'
  ]
}) as SecOperationDigest;
export const CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PROVIDER_IDENTITY_DIGEST = sha256({
  domain: 'development.commit.closed-absent-journal-retirement-provider',
  provider: 'development.commit'
}) as SecOperationDigest;
export const CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS = Object.freeze([
  Object.freeze({ resource: 'duration-ms' as const, maximum: 30_000 }),
  Object.freeze({ resource: 'input-bytes' as const, maximum: 65_536 }),
  Object.freeze({ resource: 'output-bytes' as const, maximum: 67_108_864 }),
  Object.freeze({ resource: 'processes' as const, maximum: 64 }),
  Object.freeze({ resource: 'records' as const, maximum: 256 })
]) satisfies readonly SecOperationResourceCeiling[];
export const CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUEST_CEILING = 8;

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
}>;

const ISSUED_DEVELOPMENT_COMMIT_READBACKS = new WeakSet<object>();
const ISSUED_DEVELOPMENT_COMMIT_RECOVERIES = new WeakMap<object, DevelopmentCommitRecoveryDetails>();

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
    ).catch(() => '');
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
  return Object.freeze({
    schema: 'sec-development-commit-result-v1',
    disposition,
    ref: journal.ref,
    preimage: journal.preimage,
    target: journal.target,
    tree: journal.tree,
    journalPath
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
        terminal: journal.terminal !== null && journal.terminal !== readback.disposition
          ? 'unknown' as const
          : readback.disposition
      });
      writeJournal(commonDirectory, path.resolve(input.journalPath), journal, false);
      const result = Object.freeze({
        schema: 'sec-development-commit-result-v1' as const,
        disposition: journal.terminal!, ref: journal.ref, preimage: journal.preimage,
        target: journal.target, tree: journal.tree, journalPath: path.resolve(input.journalPath)
      });
      return Object.freeze({
        result,
        readback,
        commonDirectory,
        providerIdentityDigest: sha256(session.providerIdentity) as SecOperationDigest
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
  return recovery;
}

/** CLI recovery consumer; journal reference is observation-only. */
export async function runDevelopmentCommitRecoveryCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || !path.isAbsolute(args[0]!)) {
    throw new Error('development commit recovery requires one absolute journal path.');
  }
  const recovery = await recoverDevelopmentCommit({
    repositoryRoot: path.resolve(process.cwd()),
    journalPath: path.resolve(args[0]!)
  });
  console.log(JSON.stringify(recovery.result, null, 2));
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
  return Object.freeze({
    schema: 'sec-development-commit-result-v1',
    disposition,
    ref: journal.ref,
    preimage: journal.preimage,
    target: journal.target,
    tree: journal.tree,
    journalPath
  });
}

/** Test-only timing seam; it cannot bypass admission, authorization or readback. */
export function runDevelopmentCommitForTests(
  request: DevelopmentCommitRequest,
  admission: DevelopmentCommitAdmission,
  hooks: CommitTestHooks
): Promise<DevelopmentCommitResult> {
  return execute(request, admission, hooks);
}


export type DevelopmentCommitJournalSettlement = Readonly<{
  readonly ref: string;
  readonly observed: number;
  readonly retired: number;
}>;

declare const CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PLAN: unique symbol;
export type DevelopmentCommitJournalRetirementPlan = Readonly<{
  readonly [CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PLAN]: true;
}>;

type ObservedDevelopmentCommitJournal = Readonly<{
  readonly journal: Journal;
  readonly journalPath: string;
  readonly source: string;
}>;

type ClosedAbsentPullObservation = Readonly<{
  readonly branch: string;
  readonly headSha: string;
}>;

type ClosedAbsentRetirementDetails = Readonly<{
  readonly repositoryRoot: string;
  readonly capability: GitHubApiCapability;
  readonly pullRequestNumber: number;
  readonly repository: string;
  readonly defaultBranch: string | null;
  readonly pull: ClosedAbsentPullObservation | null;
  readonly ref: string;
  readonly commonDirectory: string;
  readonly matching: readonly ObservedDevelopmentCommitJournal[];
  readonly writer: ReturnType<typeof journalWriter>;
}>;

const ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS = new WeakMap<
  object,
  ClosedAbsentRetirementDetails
>();

function observeDevelopmentCommitJournalCensus(
  commonDirectory: string,
  ref: string
): Readonly<{
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

function retireEmptyDevelopmentCommitJournalDirectory(commonDirectory: string): void {
  const parent = inspectNoFollowDirectoryChain(
    commonDirectory,
    'Commit journal retirement parent'
  ).target;
  const root = inspectNoFollowDirectoryChild(
    parent,
    JOURNAL_DIRECTORY,
    'Commit journal retirement owner'
  );
  if (root === null) return;
  const deadlineAtMonotonicMs = performance.now() + 5_000;
  if (scanNoFollowDirectoryDirectMetadata(root, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: MAXIMUM_JOURNAL_CENSUS_ENTRIES
  }).length !== 0) return;
  retireNoFollowDirectoryTree({ parent, root, inventory: [], deadlineAtMonotonicMs });
}


/**
 * Settles every recovery journal owned by one exact branch ref before that ref
 * loses its native reflog. Every matching attempt is independently classified
 * before the first retirement; one unproved attempt preserves the complete set.
 */
export async function settleDevelopmentCommitJournalsForRef(input: Readonly<{
  readonly repositoryRoot: string;
  readonly ref: string;
}>): Promise<DevelopmentCommitJournalSettlement> {
  if (!REF.test(input.ref)) {
    throw new Error('Development commit journal settlement ref is invalid.');
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  return withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
    async (session) => {
      const commonDirectory = path.resolve(await commandText(
        session,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'resolve journal settlement common directory'
      ));
      const { matching, writer } =
        observeDevelopmentCommitJournalCensus(commonDirectory, input.ref);
      const classified: Array<Readonly<{
        journal: Journal;
        journalPath: string;
        source: string;
        readback: DevelopmentCommitReadbackReceipt;
      }>> = [];
      for (const candidate of matching) {
        const readback = await readDevelopmentCommitOutcome({
          session,
          commonDirectory,
          journal: candidate.journal,
          normal: null
        });
        if (readback.disposition !== 'applied') {
          throw new Error(
            `Development commit journal settlement requires applied readback, got ${readback.disposition}.`
          );
        }
        classified.push(Object.freeze({ ...candidate, readback }));
      }
      for (const candidate of classified) {
        const terminalJournal = candidate.journal.terminal === 'applied'
          ? candidate.journal
          : Object.freeze({ ...candidate.journal, terminal: 'applied' as const });
        const terminalSource = encodeJournal(terminalJournal);
        if (candidate.source !== terminalSource
            && !writer.replaceFsyncCas(
              candidate.journalPath,
              candidate.source,
              terminalSource
            )) {
          throw new Error(
            'Development commit journal changed before settlement terminalization.'
          );
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
          repositoryRoot,
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

function assertClosedAbsentRetirementBinding(
  context: SecOperationRequirementBindingContext
): void {
  const projection = consumeSecOperationRequirementBindingContext(context);
  if (projection.requirementId
        !== CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID
      || projection.requirementContractDigest
        !== CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST
      || projection.providerIdentityDigest
        !== CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PROVIDER_IDENTITY_DIGEST
      || JSON.stringify(projection.resourceCeilings)
        !== JSON.stringify(CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS)) {
    throw new Error('Closed-absent commit journal retirement physical binding differs.');
  }
}

async function readClosedAbsentPull(input: Readonly<{
  capability: GitHubApiCapability;
  pullRequestNumber: number;
  repository: string;
  defaultBranch: string;
}>): Promise<ClosedAbsentPullObservation> {
  const value = await executeGitHubApiOperation(input.capability, {
    kind: 'pull',
    pullRequestNumber: input.pullRequestNumber
  }) as Record<string, unknown>;
  const head = value.head as Record<string, unknown> | undefined;
  const base = value.base as Record<string, unknown> | undefined;
  const headRepository = head?.repo as Record<string, unknown> | undefined;
  const baseRepository = base?.repo as Record<string, unknown> | undefined;
  if (value.number !== input.pullRequestNumber || value.state !== 'closed' || value.merged !== false
      || typeof head?.ref !== 'string' || !REF.test(`refs/heads/${head.ref}`)
      || typeof head.sha !== 'string' || !OBJECT_ID.test(head.sha)
      || head.ref === input.defaultBranch || base?.ref !== input.defaultBranch
      || headRepository?.full_name !== input.repository
      || baseRepository?.full_name !== input.repository) {
    throw new Error('Commit journal retirement requires one exact repository-local closed unmerged PR.');
  }
  return Object.freeze({ branch: head.ref, headSha: head.sha });
}

async function assertNativeRefAbsent(
  session: GitReadSession,
  ref: string,
  label: string
): Promise<void> {
  const observed = await commandText(
    session,
    ['for-each-ref', '--format=%(refname)', ref],
    `observe ${label}`
  );
  if (observed.split(/\r?\n/u).includes(ref)) {
    throw new Error(`Closed-absent commit journal retirement still has a ${label} consumer.`);
  }
}

async function assertClosedAbsentTerminal(input: Readonly<{
  session: GitReadSession;
  capability: GitHubApiCapability;
  pullRequestNumber: number;
  repository: string;
  defaultBranch: string;
  pull: ClosedAbsentPullObservation;
}>): Promise<void> {
  await assertGitHubRepositoryBinding(input.session, input.repository);
  const observedPull = await readClosedAbsentPull(input);
  if (JSON.stringify(observedPull) !== JSON.stringify(input.pull)) {
    throw new Error('Closed-absent PR identity changed before commit journal retirement.');
  }
  const ref = `refs/heads/${input.pull.branch}`;
  await assertNativeRefAbsent(input.session, ref, 'local ref');
  await assertNativeRefAbsent(
    input.session,
    `refs/remotes/origin/${input.pull.branch}`,
    'remote-tracking ref'
  );
  await assertNativeRefAbsent(
    input.session,
    `refs/pull/${input.pullRequestNumber}/head`,
    'local pull ref'
  );
  const worktreeList = await input.session.run(['worktree', 'list', '--porcelain', '-z']);
  if (worktreeList.kind !== 'completed' || worktreeList.result.code !== 0
      || worktreeList.result.stderr.length !== 0) {
    throw new Error('Closed-absent commit journal retirement cannot observe the worktree registry.');
  }
  if (parseWorktreePorcelainZ(worktreeList.result.stdout)
    .some((worktree) => worktree.branch === input.pull.branch)) {
    throw new Error('Closed-absent commit journal retirement still has a worktree consumer.');
  }
  let remoteAbsent = false;
  try {
    await executeGitHubApiOperation(input.capability, {
      kind: 'git-ref',
      branch: input.pull.branch
    });
  } catch (error) {
    if (error instanceof GitHubApiProviderError && error.statusCode === 404) remoteAbsent = true;
    else throw error;
  }
  if (!remoteAbsent) {
    throw new Error('Closed-absent commit journal retirement still has a provider ref consumer.');
  }
}

async function classifyTransportedJournals(input: Readonly<{
  session: GitReadSession;
  matching: readonly ObservedDevelopmentCommitJournal[];
  headSha: string;
  label: string;
}>): Promise<void> {
  for (const { journal } of input.matching) {
    if (journal.terminal !== 'applied' || journal.object !== journal.target) {
      throw new Error(`${input.label} preserves nonterminal or unknown journal consumers.`);
    }
    const bytes = await commandText(
      input.session,
      ['cat-file', 'commit', journal.target],
      `read ${input.label} journal commit`
    );
    const headers = bytes.split('\n\n', 1)[0]!.split('\n');
    if (JSON.stringify(headers.filter((line) => line.startsWith('tree ')))
          !== JSON.stringify([`tree ${journal.tree}`])
        || JSON.stringify(headers.filter((line) => line.startsWith('parent ')))
          !== JSON.stringify([`parent ${journal.preimage}`])) {
      throw new Error(`${input.label} journal object binding differs.`);
    }
    const consumed = await input.session.run([
      'merge-base', '--is-ancestor', journal.target, input.headSha
    ]);
    if (consumed.kind !== 'completed' || consumed.result.code !== 0) {
      throw new Error(`${input.label} did not consume this exact journal target.`);
    }
  }
}

/**
 * Issues a process-local retirement plan after rebuilding a closed-unmerged
 * PR's exact journal transport. The control owner remains responsible for
 * closed-unmerged completion and verified recovery-bundle authority.
 */
export async function prepareClosedAbsentDevelopmentCommitJournalRetirement(input: Readonly<{
  repositoryRoot: string;
  ref: string;
  capability: GitHubApiCapability;
  pullRequestNumber: number;
  requirementBindingContext: SecOperationRequirementBindingContext;
}>): Promise<DevelopmentCommitJournalRetirementPlan> {
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0) {
    throw new Error('Closed-absent commit journal retirement PR number is invalid.');
  }
  if (!REF.test(input.ref)) {
    throw new Error('Closed-absent commit journal retirement ref is invalid.');
  }
  assertClosedAbsentRetirementBinding(input.requirementBindingContext);
  const binding = inspectGitHubApiCapability(input.capability);
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const observed = await withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
    async (session) => {
      await assertGitHubRepositoryBinding(session, binding.repository);
      const commonDirectory = path.resolve(await commandText(
        session,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'resolve closed-absent journal common directory'
      ));
      const census = observeDevelopmentCommitJournalCensus(commonDirectory, input.ref);
      if (census.matching.length === 0) {
        return Object.freeze({
          commonDirectory,
          ...census,
          defaultBranch: null,
          pull: null
        });
      }
      const repositoryValue = await executeGitHubApiOperation(
        input.capability,
        { kind: 'repository' }
      ) as Record<string, unknown>;
      if (repositoryValue.full_name !== binding.repository
          || typeof repositoryValue.default_branch !== 'string') {
        throw new Error('Closed-absent commit journal retirement repository observation differs.');
      }
      const defaultBranch = repositoryValue.default_branch;
      const pull = await readClosedAbsentPull({
        capability: input.capability,
        pullRequestNumber: input.pullRequestNumber,
        repository: binding.repository,
        defaultBranch
      });
      if (`refs/heads/${pull.branch}` !== input.ref) {
        throw new Error('Closed-absent PR head ref differs from the requested journal family.');
      }
      await assertClosedAbsentTerminal({
        session,
        capability: input.capability,
        pullRequestNumber: input.pullRequestNumber,
        repository: binding.repository,
        defaultBranch,
        pull
      });
      await classifyTransportedJournals({
        session,
        matching: census.matching,
        headSha: pull.headSha,
        label: 'Closed-absent PR'
      });
      return Object.freeze({ commonDirectory, ...census, defaultBranch, pull });
    }
  );
  const plan = Object.freeze({}) as unknown as DevelopmentCommitJournalRetirementPlan;
  ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.set(plan, Object.freeze({
    repositoryRoot,
    capability: input.capability,
    pullRequestNumber: input.pullRequestNumber,
    repository: binding.repository,
    defaultBranch: observed.defaultBranch,
    pull: observed.pull,
    ref: input.ref,
    commonDirectory: observed.commonDirectory,
    matching: observed.matching,
    writer: observed.writer
  }));
  return plan;
}

export async function acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(
  plan: DevelopmentCommitJournalRetirementPlan
): Promise<DevelopmentCommitJournalSettlement> {
  const issued = ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.get(plan);
  if (issued === undefined) {
    throw new Error('Closed-absent commit journal retirement requires one owner-issued plan.');
  }
  await withAuthorityGitReadSession(
    { cwd: issued.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
    async (session) => {
      if (issued.pull === null || issued.defaultBranch === null) {
        await assertGitHubRepositoryBinding(session, issued.repository);
      } else {
        await assertClosedAbsentTerminal({
          session,
          capability: issued.capability,
          pullRequestNumber: issued.pullRequestNumber,
          repository: issued.repository,
          defaultBranch: issued.defaultBranch,
          pull: issued.pull
        });
      }
      const commonDirectory = path.resolve(await commandText(
        session,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'reobserve closed-absent journal common directory'
      ));
      if (commonDirectory !== issued.commonDirectory) {
        throw new Error('Closed-absent commit journal common directory changed before retirement.');
      }
      const current = observeDevelopmentCommitJournalCensus(commonDirectory, issued.ref).matching;
      const expectedIdentity = issued.matching.map(({ journalPath, source }) => ({ journalPath, source }));
      const currentIdentity = current.map(({ journalPath, source }) => ({ journalPath, source }));
      if (JSON.stringify(currentIdentity) !== JSON.stringify(expectedIdentity)) {
        throw new Error('Closed-absent commit journal family changed before retirement.');
      }
      await classifyTransportedJournals({
        session,
        matching: current,
        headSha: issued.pull?.headSha ?? '',
        label: 'Closed-absent PR'
      });
      if (issued.pull === null || issued.defaultBranch === null) {
        if (current.length !== 0) {
          throw new Error('Closed-absent commit journal appeared after an empty retirement plan.');
        }
        await assertGitHubRepositoryBinding(session, issued.repository);
      } else {
        await assertClosedAbsentTerminal({
          session,
          capability: issued.capability,
          pullRequestNumber: issued.pullRequestNumber,
          repository: issued.repository,
          defaultBranch: issued.defaultBranch,
          pull: issued.pull
        });
      }
      for (const [index, candidate] of issued.matching.entries()) {
        if (!issued.writer.deleteFsyncCas(candidate.journalPath, candidate.source)) {
          throw new Error('Closed-absent commit journal changed before exact retirement.');
        }
        ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.set(plan, Object.freeze({
          ...issued,
          matching: Object.freeze(issued.matching.slice(index + 1))
        }));
      }
    }
  );
  ISSUED_CLOSED_ABSENT_RETIREMENT_PLANS.delete(plan);
  retireEmptyDevelopmentCommitJournalDirectory(issued.commonDirectory);
  return Object.freeze({
    ref: issued.ref,
    observed: issued.matching.length,
    retired: issued.matching.length
  });
}
