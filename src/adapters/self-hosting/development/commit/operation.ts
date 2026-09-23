import path from 'node:path';

import { canonicalJson, sha256 } from '../../../../contracts/canonical.ts';
import {
  compileSecProviderSettlementSet,
  issueSecNormalDomainReadbackReceipt,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecProviderSettlementSet
} from '../../../../execution/operation/semantic.ts';
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
  inspectNoFollowDirectoryChain
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem } from '../../../runtime-state/workspace-state/journal-filesystem.ts';
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
const DEVELOPMENT_COMMIT_PROVIDER_ADMISSION_PROCESS_COUNT = 1;
const DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT = 5;
const DEVELOPMENT_COMMIT_MATERIALIZATION_PROCESS_COUNT = 2;
const DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT = 1;
const DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT =
  DEVELOPMENT_COMMIT_PROVIDER_ADMISSION_PROCESS_COUNT + 2
  + DEVELOPMENT_COMMIT_MATERIALIZATION_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;

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
  readonly operation: SecOperationDigest;
  readonly attempt: SecOperationDigest;
  readonly readbackReceiptDigest: SecOperationDigest;
}>;

type DevelopmentCommitRecovery = Readonly<{
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
async function recoverDevelopmentCommit(input: Readonly<{
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
