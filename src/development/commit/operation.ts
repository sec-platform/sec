import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import {
  bindGitDevelopmentCommitOperation,
  compareAndSwapAuthorityDevelopmentCommitRef,
  compileGitDevelopmentCommitContractDigest,
  createAuthorityGitReadSession,
  createAuthorityGitScratchIndexTreeSession,
  materializeAuthorityDevelopmentCommitObject,
  settleGitDevelopmentCommitOperation,
  type GitCommitIdentity,
  type GitDevelopmentCommitContract,
  type GitReadSession
} from '../../external-capabilities/git-read/runtime/session.ts';
import { inspectNoFollowDirectoryChain, readNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem } from '../../runtime-state/workspace-state/journal-filesystem.ts';
import { canonicalJson, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  compileSecProviderSettlementSet,
  compileSecSemanticOperationIntent,
  issueSecNormalDomainReadbackReceipt,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecProviderSettlementSet,
  type SecSemanticOperationIntent
} from '../../system-architecture/operation/semantic.ts';
import { runStagedImportCheck } from '../runner/import-organizer.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import {
  requireUpstreamDevelopmentCommitEffectGrant
} from './effect-grant.ts';

const OPERATION = 'development.commit';
const REQUIREMENT = 'repository.commit';
const JOURNAL_SCHEMA = 'sec-development-commit-journal-v1';
const JOURNAL_DIRECTORY = 'sec-development-commit';
const MAXIMUM_JOURNAL_BYTES = 4096;
const DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT = 4;
const DEVELOPMENT_COMMIT_MATERIALIZATION_PROCESS_COUNT = 2;
const DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT = 1;
const DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT =
  DEVELOPMENT_COMMIT_MATERIALIZATION_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT;
const DEVELOPMENT_COMMIT_RETRY_PROCESS_COUNT =
  DEVELOPMENT_COMMIT_REF_EFFECT_PROCESS_COUNT
  + DEVELOPMENT_COMMIT_READBACK_PROCESS_COUNT;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;

export type DevelopmentCommitDisposition = 'applied' | 'not-applied' | 'unknown';

export type DevelopmentCommitRequest = Readonly<{
  readonly repositoryRoot: string;
  readonly message: string;
  readonly author: GitCommitIdentity;
  readonly committer: GitCommitIdentity;
}>;

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

function compileCommitIntent(contract: GitDevelopmentCommitContract): SecSemanticOperationIntent {
  const contractDigest = compileGitDevelopmentCommitContractDigest(contract);
  return compileSecSemanticOperationIntent({
    operation: OPERATION,
    intentDigest: sha256({
      repositoryRoot: contract.repositoryRoot,
      ref: contract.ref,
      preimage: contract.expectedOld,
      target: contract.target,
      tree: contract.tree
    }) as SecOperationDigest,
    decisionDigest: sha256({
      message: contract.message,
      author: contract.author,
      committer: contract.committer,
      signing: contract.signing,
      hooks: contract.hooks
    }) as SecOperationDigest,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'input-bytes', maximum: 64 * 1024 },
      { resource: 'output-bytes', maximum: 256 * 1024 },
      { resource: 'processes', maximum: DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT },
      { resource: 'records', maximum: 32 }
    ],
    requirements: [{
      id: REQUIREMENT,
      contractDigest,
      effectKinds: ['filesystem', 'process'],
      failureKinds: [
        'development.commit.cas-conflict',
        'development.commit.index-drift',
        'development.commit.lost-handle',
        'development.commit.provider-failed'
      ]
    }]
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

async function preflight(request: DevelopmentCommitRequest): Promise<Readonly<{
  readonly repositoryRoot: string;
  readonly commonDirectory: string;
  readonly ref: string;
  readonly preimage: string;
  readonly tree: string;
  readonly target: string;
  readonly preflightReceiptDigest: SecOperationDigest;
  readonly providerIdentityDigest: SecOperationDigest;
}>> {
  const repositoryRoot = path.resolve(request.repositoryRoot);
  if (!path.isAbsolute(request.repositoryRoot) || repositoryRoot !== request.repositoryRoot) {
    throw new Error('Development commit requires one canonical absolute repository root.');
  }
  return withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    if (session.providerIdentity === null) throw new Error('Development commit Git provider identity is absent.');
    const worktreeRoot = path.resolve(await commandText(session, ['rev-parse', '--show-toplevel'], 'resolve worktree'));
    const commonDirectory = path.resolve(await commandText(
      session,
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      'resolve common directory'
    ));
    const indexPath = path.resolve(await commandText(
      session,
      ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
      'resolve index'
    ));
    const ref = await commandText(session, ['symbolic-ref', '--quiet', 'HEAD'], 'resolve HEAD ref');
    const preimage = await commandText(
      session,
      ['rev-parse', '--verify', '--end-of-options', ref],
      'resolve HEAD parent'
    );
    if (worktreeRoot !== repositoryRoot || !REF.test(ref) || !OBJECT_ID.test(preimage)) {
      throw new Error('Development commit repository/ref preflight is not canonical.');
    }
    const beforeIndex = await readFile(indexPath);
    const admission = await runStagedImportCheck(repositoryRoot);
    if (admission.status !== 'canonical') {
      throw new Error(`Development commit precommit admission failed: ${admission.files.join(', ')}`);
    }
    const afterAdmissionIndex = await readFile(indexPath);
    if (!beforeIndex.equals(afterAdmissionIndex)) {
      throw new Error('Development commit index drifted during pure precommit admission.');
    }
    const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-'));
    try {
      await mkdir(path.join(scratchRoot, 'objects'));
      await writeFile(path.join(scratchRoot, 'index'), beforeIndex, { flag: 'wx' });
      const resolution = await createAuthorityGitScratchIndexTreeSession({ gitReadSession: session, scratchRoot });
      if (resolution.status !== 'ready') throw new Error(`Development commit tree freeze unavailable: ${resolution.reason}`);
      try {
        const treeResult = await resolution.session.writeTree();
        if (treeResult.status !== 'ready') throw new Error(`Development commit write-tree failed: ${treeResult.reason}`);
        const commitResult = await resolution.session.commitTree({
          tree: treeResult.value,
          parents: Object.freeze([preimage]),
          message: request.message,
          author: request.author,
          committer: request.committer
        });
        if (commitResult.status !== 'ready') {
          throw new Error(
            `Development commit target freeze failed: ${commitResult.reason}`
            + (commitResult.detail === undefined ? '' : `; ${commitResult.detail}`)
          );
        }
        const afterFreezeIndex = await readFile(indexPath);
        if (!beforeIndex.equals(afterFreezeIndex)) {
          throw new Error('Development commit index drifted after exact tree freeze.');
        }
        const receipt = {
          schema: 'sec-development-commit-preflight-v1',
          repositoryRoot,
          worktreeRoot,
          commonDirectory,
          ref,
          preimage,
          indexDigest: rawSha256(beforeIndex),
          tree: treeResult.value,
          target: commitResult.value,
          admission: 'canonical'
        };
        return Object.freeze({
          repositoryRoot,
          commonDirectory,
          ref,
          preimage,
          tree: treeResult.value,
          target: commitResult.value,
          preflightReceiptDigest: sha256(receipt) as SecOperationDigest,
          providerIdentityDigest: sha256(session.providerIdentity) as SecOperationDigest
        });
      } finally {
        await resolution.session.close();
      }
    } finally {
      await rm(scratchRoot, { recursive: true, force: true });
    }
  });
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
    const reflogPath = path.join(input.commonDirectory, 'logs', ...journal.ref.split('/'));
    let reflogContainsTarget = false;
    try {
      const parent = inspectNoFollowDirectoryChain(
        path.dirname(reflogPath),
        'Development commit reflog parent'
      );
      const bytes = readNoFollowOrdinaryFile(parent.target, path.basename(reflogPath));
      if (bytes === null || bytes.byteLength > 1024 * 1024) throw new Error('invalid reflog');
      const source = Buffer.from(bytes).toString('utf8');
      reflogContainsTarget = source.split(/\r?\n/u).some((line) =>
        line.startsWith(`${journal.preimage} ${journal.target} `));
    } catch {
      return 'unknown';
    }
    if (ref === journal.target && objectMatches && indexMatches && reflogContainsTarget) return 'applied';
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
  effectGrantReceipt: unknown,
  hooks: CommitTestHooks
): Promise<DevelopmentCommitResult> {
  const authorityGrantDigest: SecOperationDigest = requireUpstreamDevelopmentCommitEffectGrant(effectGrantReceipt);
  const frozen = await preflight(request);
  const contract: GitDevelopmentCommitContract = Object.freeze({
    repositoryRoot: frozen.repositoryRoot,
    worktreeRoot: frozen.repositoryRoot,
    ref: frozen.ref,
    expectedOld: frozen.preimage,
    target: frozen.target,
    tree: frozen.tree,
    parents: Object.freeze([frozen.preimage]),
    message: request.message,
    author: request.author,
    committer: request.committer,
    signing: 'disabled',
    hooks: 'disabled',
    preflightReceiptDigest: frozen.preflightReceiptDigest
  });
  const intent = compileCommitIntent(contract);
  const operation = bindGitDevelopmentCommitOperation({
    intent,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest }),
    providerIdentityDigest: frozen.providerIdentityDigest,
    deadlineAtUnixMs: Date.now() + 30_000
  });
  const journalPath = path.join(
    frozen.commonDirectory,
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
  writeJournal(frozen.commonDirectory, journalPath, journal, true);
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
    writeJournal(frozen.commonDirectory, journalPath, journal, false);
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
      commonDirectory: frozen.commonDirectory,
      journal,
      normal: { operation, settlement: providerSettlementSet, contractDigest: compileGitDevelopmentCommitContractDigest(contract) }
    });
  } finally {
    await resolution.session.close?.();
  }
  if (readback === null) throw new Error('Development commit readback receipt is absent.');
  const { disposition } = readback;
  journal = Object.freeze({ ...journal, terminal: disposition });
  writeJournal(frozen.commonDirectory, journalPath, journal, false);
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
  effectGrantReceipt: unknown
): Promise<DevelopmentCommitResult> {
  return execute(request, effectGrantReceipt, Object.freeze({}));
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
  readonly effectGrantReceipt: unknown;
  readonly recovery: DevelopmentCommitRecovery;
}>): Promise<DevelopmentCommitResult> {
  const authorityGrantDigest: SecOperationDigest = requireUpstreamDevelopmentCommitEffectGrant(input.effectGrantReceipt);
  const recoveredProjection = ISSUED_DEVELOPMENT_COMMIT_RECOVERIES.get(input.recovery);
  if (recoveredProjection === undefined) {
    throw new Error('Development commit retry requires an owner-issued recovery capability.');
  }
  const recovered = input.recovery.result;
  assertDevelopmentCommitReadbackReceipt(recoveredProjection.readback);
  if (recovered.disposition !== 'not-applied') {
    throw new Error(`Development commit retry requires not-applied readback, got ${recovered.disposition}.`);
  }
  ISSUED_DEVELOPMENT_COMMIT_RECOVERIES.delete(input.recovery);
  const repositoryRoot = path.resolve(input.request.repositoryRoot);
  const commonDirectory = Object.freeze({
    path: recoveredProjection.commonDirectory,
    providerIdentityDigest: recoveredProjection.providerIdentityDigest
  });
  const previous = readJournal(commonDirectory.path, recovered.journalPath);
  const retryAdmissionDigest = sha256({
    schema: 'sec-development-commit-retry-admission-v1',
    previousOperation: previous.operation,
    previousAttempt: previous.attempt,
    disposition: recovered.disposition,
    ref: previous.ref,
    preimage: previous.preimage,
    target: previous.target,
    tree: previous.tree
  }) as SecOperationDigest;
  const contract: GitDevelopmentCommitContract = Object.freeze({
    repositoryRoot,
    worktreeRoot: repositoryRoot,
    ref: previous.ref,
    expectedOld: previous.preimage,
    target: previous.target,
    tree: previous.tree,
    parents: Object.freeze([previous.preimage]),
    message: input.request.message,
    author: input.request.author,
    committer: input.request.committer,
    signing: 'disabled',
    hooks: 'disabled',
    preflightReceiptDigest: retryAdmissionDigest
  });
  const operation = bindGitDevelopmentCommitOperation({
    intent: compileCommitIntent(contract),
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest }),
    providerIdentityDigest: commonDirectory.providerIdentityDigest,
    deadlineAtUnixMs: Date.now() + 30_000
  });
  const journalPath = path.join(
    commonDirectory.path,
    JOURNAL_DIRECTORY,
    `${previous.attempt.slice('sha256:'.length)}.retry.json`
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
  writeJournal(commonDirectory.path, journalPath, journal, true);
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
  effectGrantReceipt: unknown,
  hooks: CommitTestHooks
): Promise<DevelopmentCommitResult> {
  return execute(request, effectGrantReceipt, hooks);
}
