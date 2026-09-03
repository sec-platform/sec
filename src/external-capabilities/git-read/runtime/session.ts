import path from 'node:path';

import { PhysicalNoFollowError, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryChain, type RetainedNoFollowChildProcessDirectory, type RetainedNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession, type ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { RetainedCommandTransportError, resolveExecutableLocator, type ByteCommandResult } from '../../../runtime-state/physical/runtime/process.ts';
import type { RetainedCommandAuxiliaryInput } from '../../../runtime-state/physical/runtime/retained-command-boundary.ts';
import { rawSha256, sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../../system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecProviderSettlementReceipt,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecProviderSettlementReceipt,
  type SecSemanticOperationAttemptContext,
  type SecSemanticOperationIntent
} from '../../../system-architecture/operation/semantic.ts';
import { canonicalGitChildEnvironment, gitEnvironmentValue } from '../../git/environment.ts';
import {
  assertGitPhysicalProviderCurrentInternal,
  closeGitPhysicalProvider,
  openGitPhysicalProvider,
  runGitPhysicalCommandInternal,
  type GitPhysicalProviderCapability
} from '../../git/physical-provider.ts';

/**
 * Build the single canonical SEC environment for trusted local Git
 * observations. Repository selection is supplied by cwd/argv, never inherited
 * from ambient Git redirection, replacement-object, config-injection,
 * credential-prompt, SSH-command or repository-discovery state.
 *
 * Repository-local config remains observable. User-global and system config
 * are excluded by default so HOME/XDG state cannot silently change a trusted
 * observation. Explicit overrides may bind a narrower subject/environment, but
 * mandatory no-prompt/no-replace/no-global-config guards are reasserted after
 * overrides and therefore cannot be weakened by a caller, including through
 * case-variant environment names on Windows.
 */
export function isolatedGitReadEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return { ...canonicalGitChildEnvironment(overrides, source) };
}

/** Historical child-process callers use the same mechanics as Git reads. */
export function isolatedGitChildEnvironment(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return isolatedGitReadEnvironment({}, source);
}

/** Exact identity of one Git tree entry returned by the Git read owner. */
export type GitBlobIdentity = Readonly<{
  blobSha: string;
  mode: '100644' | '100755';
  type: 'blob';
}>;

/** Exact Git blob identity plus the bytes read from that same object. */
export type GitBlobBytes = GitBlobIdentity & Readonly<{
  bytes: Uint8Array;
}>;

export type GitReadSessionBudget = Readonly<{
  deadlineMs: number;
  maxProcesses: number;
  maxTotalArgumentBytes: number;
  maxStdinBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxRecords: number;
  maxRootObservedBytes: number;
  maxReopenRefreshes: number;
  maxSettlementAttempts: number;
  maxCommandStdoutBytes: number;
  maxCommandStderrBytes: number;
  /** Aggregate bytes retained while binding/rechecking the Git executable. */
  maxExecutableBytes: number;
}>;

/** One installed-Git route; every host retains and fences the executable and cwd. */
export type GitReadProviderRoute = 'host-local-git-v1';

export type GitReadHostProviderResolutionReason =
  | 'git-executable-unavailable'
  | 'git-executable-identity-unavailable'
  | 'git-operation-admission-unavailable'
  | 'git-retained-provider-unavailable'
  | 'git-session-cancelled'
  | 'git-session-failed'
  | 'git-session-deadline-exhausted'
  | 'git-session-process-budget-exhausted'
  | 'git-session-stdout-budget-exhausted'
  | 'git-session-stderr-budget-exhausted'
  | 'git-session-record-budget-exhausted'
  | 'git-session-root-observation-budget-exhausted'
  | 'git-session-executable-budget-exhausted'
  | 'git-session-argument-budget-exhausted'
  | 'git-session-stdin-budget-exhausted'
  | 'git-session-operation-not-permitted';

export type GitReadProviderFailure = Readonly<{
  readonly kind: 'unresolved-git-read-provider';
  readonly route: 'host-local-git-v1';
  readonly status: 'unavailable';
  readonly reason: GitReadHostProviderResolutionReason;
  readonly detailDigest: `sha256:${string}`;
}>;

export type GitReadProviderResolutionFailure = GitReadProviderFailure;

export type GitReadSessionResolution =
  | Readonly<{
    readonly status: 'ready';
    readonly route: GitReadProviderRoute;
    readonly session: GitReadSession;
  }>
  | GitReadProviderResolutionFailure;

export type GitReadSessionFailure = Readonly<{
  kind: 'unresolved-git-read-session';
  reason:
    | 'cancelled'
    | 'deadline-exhausted'
    | 'process-budget-exhausted'
    | 'stdout-budget-exhausted'
    | 'stderr-budget-exhausted'
    | 'record-budget-exhausted'
    | 'root-observation-budget-exhausted'
    | 'executable-budget-exhausted'
    | 'argument-budget-exhausted'
    | 'stdin-budget-exhausted'
    | 'operation-admission-unavailable'
    | 'retained-provider-unavailable'
    | 'operation-not-permitted'
    | 'command-error';
  detail: string;
  /** Bounded digest for correlating a provider/transport failure. */
  detailDigest?: `sha256:${string}`;
  /** Provider admission failure, when the session was blocked before transport. */
  provider?: GitReadProviderResolutionFailure;
}>;

export type GitReadSessionCommand = Readonly<{
  kind: 'completed';
  result: ByteCommandResult;
}> | GitReadSessionFailure;

export type GitReadSessionRunOptions = Readonly<{
  readonly input?: Uint8Array;
}>;

export type GitReadSessionReceipt = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest | null;
  readonly boundAttemptDigest: SecOperationDigest | null;
  readonly requirementId: string | null;
  readonly providerIdentityDigest: SecOperationDigest | null;
  readonly processSessionOwnership: 'owned' | 'borrowed';
  readonly processCount: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly failureDetailDigest: `sha256:${string}` | null;
  readonly receiptDigest: SecOperationDigest;
}>;

const ISSUED_GIT_READ_SESSION_RECEIPTS = new WeakSet<object>();

export function assertGitReadSessionReceipt(
  receipt: GitReadSessionReceipt,
  expected?: Readonly<{
    operationIdentityDigest: SecOperationDigest;
    boundAttemptDigest: SecOperationDigest;
    requirementId: string;
  }>
): void {
  if (receipt === null || typeof receipt !== 'object'
      || !ISSUED_GIT_READ_SESSION_RECEIPTS.has(receipt)) {
    throw new Error('Git read terminal settlement requires an owner-issued receipt.');
  }
  if (expected !== undefined
      && (receipt.operationIdentityDigest !== expected.operationIdentityDigest
        || receipt.boundAttemptDigest !== expected.boundAttemptDigest
        || receipt.requirementId !== expected.requirementId)) {
    throw new Error('Git read terminal receipt does not match its bound process operation.');
  }
}

/**
 * Physical provider identity for the executable used by one read session.
 * The resolved path is retained only as a locator; the final path, native
 * stat identity and raw executable digest are the authority that guards the
 * plan's start/end fence.
 */
export type GitExecutableIdentity = Readonly<{
  path: string;
  realPath: string;
  device: string;
  inode: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  digest: `sha256:${string}`;
  /** No-follow physical closure for the executable's lexical parent. */
  ancestorChain: readonly Readonly<{
    path: string;
    finalPath: string;
    device: string;
    inode: string;
    objectId: string;
  }>[];
}>;

export type GitReadProviderIdentity = Readonly<{
  readonly route: 'host-local-git-v1';
  readonly executable: GitExecutableIdentity;
}>;

export type GitReadSession = Readonly<{
  readonly cwd: string;
  readonly gitExecutable: string;
  readonly gitExecutableIdentity: GitExecutableIdentity | null;
  readonly providerRoute: GitReadProviderRoute;
  readonly providerIdentity: GitReadProviderIdentity | null;
  readonly env: Readonly<Record<string, string>>;
  readonly budget: GitReadSessionBudget;
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly processCount: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly argumentBytes?: number;
  readonly stdinBytes?: number;
  readonly executableBytes?: number;
  readonly recordCount: number;
  readonly rootObservedBytes?: number;
  readonly reopenRefreshes?: number;
  readonly settlementAttempts?: number;
  readonly failure: GitReadSessionFailure | null;
  /** No-follow cwd identity retained for the lifetime of this read session. */
  readonly workingDirectoryIdentity?: PhysicalDirectoryChain | null;
  /** Re-read and compare the executable's physical identity/digest. */
  verifyExecutable: () => boolean;
  /** Re-read and compare the cwd no-follow identity. */
  verifyWorkingDirectory?: () => boolean;
  run: (args: readonly string[], options?: GitReadSessionRunOptions) => Promise<GitReadSessionCommand>;
  consumeRecords: (count: number) => GitReadSessionFailure | null;
  /** Close retained provider capabilities and complete terminal readback. */
  close?: () => Promise<GitReadSessionReceipt>;
}>;

export type GitScratchIndexTreeFailureReason =
  | 'production-session-required'
  | 'retained-provider-unavailable'
  | 'invalid-scratch-layout'
  | 'repository-index-changed'
  | 'repository-object-directory-changed'
  | 'scratch-index-changed'
  | 'scratch-object-directory-changed'
  | 'scratch-identity-changed'
  | 'session-failed'
  | 'closed';

export type GitScratchIndexTreeResult<T> = Readonly<
  { status: 'ready'; value: T } |
  { status: 'unavailable'; reason: GitScratchIndexTreeFailureReason; detail?: string }
>;

/**
 * Narrow Git effect capability for computing a tree from one immutable index.
 * It intentionally exposes no generic argv, config, ref, or repository-write
 * surface.  The typed index delta is applied only inside the retained,
 * repository-external scratch object directory and the resulting tree is
 * read back through the same retained provider.
 */
export type GitScratchIndexTreeDelta = Readonly<{
  readonly additions: readonly Readonly<{
    readonly path: string;
    readonly bytes: Uint8Array;
  }>[];
  readonly removals: readonly string[];
}>;

export type GitScratchIndexTreeSession = Readonly<{
  readonly scratchRoot: string;
  readonly objectFormat: 'sha1' | 'sha256';
  applyIndexDelta(input: GitScratchIndexTreeDelta): Promise<GitScratchIndexTreeResult<string>>;
  writeTree(): Promise<GitScratchIndexTreeResult<string>>;
  commitTree(input: GitCommitTreeInput): Promise<GitScratchIndexTreeResult<string>>;
  observe(args: readonly string[]): Promise<GitScratchIndexTreeResult<ByteCommandResult>>;
  close(): Promise<GitScratchIndexTreeFailureReason | null>;
}>;

export type GitScratchIndexTreeResolution =
  | Readonly<{ readonly status: 'ready'; readonly session: GitScratchIndexTreeSession }>
  | Readonly<{ readonly status: 'unavailable'; readonly reason: GitScratchIndexTreeFailureReason }>;

type GitScratchExecutionOwner = Readonly<{
  run(
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[],
    input?: Uint8Array
  ): Promise<GitReadSessionCommand>;
}>;

const GIT_SCRATCH_EXECUTION_OWNERS = new WeakMap<object, GitScratchExecutionOwner>();

export type GitCommitIdentity = Readonly<{
  readonly name: string;
  readonly email: string;
  /** Git internal date: `<unix-seconds> <+|->HHMM`. */
  readonly date: string;
}>;

export type GitCommitTreeInput = Readonly<{
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly author: GitCommitIdentity;
  readonly committer: GitCommitIdentity;
}>;

export type GitDevelopmentCommitContract = GitCommitTreeInput & Readonly<{
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly ref: string;
  readonly expectedOld: string;
  readonly target: string;
  readonly signing: 'disabled';
  readonly hooks: 'disabled';
  readonly preflightReceiptDigest: SecOperationDigest;
}>;

export type GitDevelopmentCommitEffectResult = Readonly<
  | { readonly status: 'completed'; readonly object: string }
  | { readonly status: 'cas-conflict'; readonly object: string }
  | { readonly status: 'unavailable'; readonly reason: 'operation-not-authorized' | 'invalid-contract' | 'provider-failed' | 'index-drift' | 'target-mismatch'; readonly detail?: string }
>;

type GitDevelopmentCommitExecutionOwner = Readonly<{
  readonly operation: SecBoundSemanticOperation;
  readonly providerIdentityDigest: SecOperationDigest;
  run(
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    input?: Uint8Array
  ): Promise<GitReadSessionCommand>;
}>;

const GIT_DEVELOPMENT_COMMIT_EXECUTION_OWNERS = new WeakMap<object, GitDevelopmentCommitExecutionOwner>();

const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const GIT_COMMIT_REF_PATTERN = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;
const GIT_INTERNAL_DATE_PATTERN = /^(?:0|[1-9][0-9]*) [+-][0-9]{4}$/u;

function canonicalCommitIdentity(identity: GitCommitIdentity): GitCommitIdentity | null {
  if (identity.name.length === 0 || identity.name.length > 256
      || identity.email.length < 3 || identity.email.length > 320
      || /[\0\r\n<>]/u.test(identity.name)
      || /[\0\r\n<>]/u.test(identity.email)
      || !GIT_INTERNAL_DATE_PATTERN.test(identity.date)) return null;
  const [, zone] = identity.date.split(' ');
  const hours = Number(zone?.slice(1, 3));
  const minutes = Number(zone?.slice(3, 5));
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes)
      || hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return Object.freeze({ name: identity.name, email: identity.email, date: identity.date });
}

function canonicalCommitTreeInput(input: GitCommitTreeInput): GitCommitTreeInput | null {
  const author = canonicalCommitIdentity(input.author);
  const committer = canonicalCommitIdentity(input.committer);
  if (!GIT_OBJECT_ID_PATTERN.test(input.tree)
      || input.parents.length !== 1
      || !GIT_OBJECT_ID_PATTERN.test(input.parents[0] ?? '')
      || input.message.length === 0
      || Buffer.byteLength(input.message, 'utf8') > 64 * 1024
      || input.message.includes('\0')
      || author === null || committer === null) return null;
  return Object.freeze({
    tree: input.tree,
    parents: Object.freeze([...input.parents]),
    message: input.message,
    author,
    committer
  });
}

function commitEnvironment(
  input: GitCommitTreeInput,
  base: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  // `base` is already issuer-isolated and may intentionally carry retained
  // scratch selectors. Re-running ambient isolation would delete those exact
  // GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY capabilities before commit-tree.
  return Object.freeze({
    ...base,
    GIT_AUTHOR_NAME: input.author.name,
    GIT_AUTHOR_EMAIL: input.author.email,
    GIT_AUTHOR_DATE: input.author.date,
    GIT_COMMITTER_NAME: input.committer.name,
    GIT_COMMITTER_EMAIL: input.committer.email,
    GIT_COMMITTER_DATE: input.committer.date
  });
}

export function compileGitDevelopmentCommitContractDigest(
  input: GitDevelopmentCommitContract
): SecOperationDigest {
  const treeInput = canonicalCommitTreeInput(input);
  if (treeInput === null
      || !path.isAbsolute(input.repositoryRoot)
      || path.resolve(input.repositoryRoot) !== input.repositoryRoot
      || !path.isAbsolute(input.worktreeRoot)
      || path.resolve(input.worktreeRoot) !== input.worktreeRoot
      || !GIT_COMMIT_REF_PATTERN.test(input.ref)
      || input.expectedOld !== input.parents[0]
      || !GIT_OBJECT_ID_PATTERN.test(input.target)
      || input.signing !== 'disabled'
      || input.hooks !== 'disabled'
      || !/^sha256:[0-9a-f]{64}$/u.test(input.preflightReceiptDigest)) {
    throw new Error('Git development commit contract is not canonical.');
  }
  return sha256({
    schema: 'sec-development-commit-git-contract-v1',
    repositoryRoot: input.repositoryRoot,
    worktreeRoot: input.worktreeRoot,
    ref: input.ref,
    expectedOld: input.expectedOld,
    target: input.target,
    ...treeInput,
    signing: input.signing,
    hooks: input.hooks,
    preflightReceiptDigest: input.preflightReceiptDigest
  }) as SecOperationDigest;
}

function authorizedDevelopmentCommitOwner(
  session: GitReadSession,
  contract: GitDevelopmentCommitContract
): GitDevelopmentCommitExecutionOwner | null {
  const owner = GIT_DEVELOPMENT_COMMIT_EXECUTION_OWNERS.get(session);
  if (owner === undefined || !isProductionGitReadSession(session)) return null;
  let contractDigest: SecOperationDigest;
  try {
    contractDigest = compileGitDevelopmentCommitContractDigest(contract);
  } catch {
    return null;
  }
  const requirements = owner.operation.plan.execution.requirements;
  if (requirements.length !== 1) return null;
  const requirement = requirements[0]!;
  if (requirement.contractDigest !== contractDigest
      || JSON.stringify(requirement.effectKinds) !== JSON.stringify(['filesystem', 'process'])) return null;
  const binding = owner.operation.bindings[0];
  if (binding === undefined
      || binding.requirementId !== requirement.id
      || binding.contractDigest !== contractDigest
      || binding.providerIdentityDigest !== owner.providerIdentityDigest) return null;
  return owner;
}

/**
 * A session's origin is deliberately not a public data property.  The
 * factory result is structurally convenient for read-only helpers, but an
 * object copied, spread, or constructed by a caller must not become a
 * production authority.  These registries are the runtime issuer boundary;
 * the test registry is intentionally never accepted by production gates.
 */
const PRODUCTION_GIT_READ_SESSIONS = new WeakSet<object>();
const TEST_GIT_READ_SESSIONS = new WeakSet<object>();

export function isProductionGitReadSession(session: GitReadSession): boolean {
  return typeof session === 'object'
    && session !== null
    && PRODUCTION_GIT_READ_SESSIONS.has(session);
}

export function isTestGitReadSession(session: GitReadSession): boolean {
  return typeof session === 'object'
    && session !== null
    && TEST_GIT_READ_SESSIONS.has(session);
}

export function assertProductionGitReadSession(session: GitReadSession): void {
  if (!isProductionGitReadSession(session)) {
    throw new Error(
      'Git read session lacks a production issuer capability; test or structural sessions are not authority.'
    );
  }
}

/**
 * Canonical bounded envelope for a production Git read operation. Callers
 * must select an envelope explicitly; operation owners may narrow it but may
 * not rely on an implicit fresh session or widen the provider ceiling.
 */
export const GIT_READ_DEFAULT_OPERATION_BUDGET: GitReadSessionBudget = Object.freeze({
  deadlineMs: 5_000,
  maxProcesses: 32,
  maxTotalArgumentBytes: 16 * 1024 * 1024,
  maxStdinBytes: 16 * 1024 * 1024,
  maxStdoutBytes: 64 * 1024 * 1024,
  maxStderrBytes: 2 * 1024 * 1024,
  maxRecords: 250_000,
  maxRootObservedBytes: 256 * 1024 * 1024,
  maxReopenRefreshes: 10_000,
  maxSettlementAttempts: 32,
  maxCommandStdoutBytes: 32 * 1024 * 1024,
  maxCommandStderrBytes: 512 * 1024,
  maxExecutableBytes: 64 * 1024 * 1024
});

/** Exact-tree observations may read the complete tracked source graph once. */
export const GIT_READ_EXACT_TREE_OPERATION_BUDGET: GitReadSessionBudget = Object.freeze({
  ...GIT_READ_DEFAULT_OPERATION_BUDGET,
  deadlineMs: 120_000
});

/**
 * Absolute ceilings for every GitRead transport. Operation-specific callers
 * may narrow these values, but a caller cannot silently widen the canonical
 * envelope or use a fresh session to reset an aggregate owner budget.
 */
const CANONICAL_GIT_READ_BUDGET_CEILING: GitReadSessionBudget = Object.freeze({
  deadlineMs: 120_000,
  maxProcesses: 128,
  maxTotalArgumentBytes: 16 * 1024 * 1024,
  maxStdinBytes: 64 * 1024 * 1024,
  maxStdoutBytes: 64 * 1024 * 1024,
  maxStderrBytes: 2 * 1024 * 1024,
  maxRecords: 250_000,
  maxRootObservedBytes: 256 * 1024 * 1024,
  maxReopenRefreshes: 10_000,
  maxSettlementAttempts: 10_000,
  maxCommandStdoutBytes: 32 * 1024 * 1024,
  maxCommandStderrBytes: 512 * 1024,
  maxExecutableBytes: 64 * 1024 * 1024
});

export class GitReadBudgetError extends Error {
  readonly kind = 'git-read-budget-error' as const;

  constructor(
    readonly reason: 'unknown-field' | 'invalid-value' | 'canonical-ceiling-exceeded',
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'GitReadBudgetErrorV1';
  }
}

function gitReadCommandArgumentBytes(args: readonly string[]): number | null {
  if (!Array.isArray(args)) return null;
  let bytes = 0;
  for (const argument of args) {
    if (typeof argument !== 'string' || argument.includes('\0')) return null;
    bytes += Buffer.byteLength(argument, 'utf8') + 1;
    if (!Number.isSafeInteger(bytes)) return null;
  }
  return bytes;
}

const GIT_READ_ONLY_COMMANDS = new Set([
  'cat-file',
  'branch',
  'check-attr',
  'config',
  'diff',
  'diff-files',
  'diff-index',
  'for-each-ref',
  'grep',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'merge-base',
  'remote',
  'rev-list',
  'rev-parse',
  'show',
  'status',
  'symbolic-ref',
  'var',
  'worktree'
]);

const GIT_READ_FORBIDDEN_HELPER_ARGUMENTS = new Set([
  '--ext-diff',
  '--textconv',
  '--filters',
  '--use-bitmap-index',
  '--exec',
  '--recurse-submodules',
  '--submodule'
]);

function gitReadArgumentsInvokeHelper(args: readonly string[]): boolean {
  return args.some((argument) => (
    GIT_READ_FORBIDDEN_HELPER_ARGUMENTS.has(argument)
    || argument.startsWith('--filter=')
    || argument.startsWith('--upload-pack=')
    || argument.startsWith('--receive-pack=')
  ));
}

const GIT_READ_SAFE_CONFIG_OVERRIDES = new Set([
  'core.attributesFile=',
  'core.fsmonitor=false',
  'core.quotepath=false',
  'core.untrackedCache=false'
]);

function gitReadCommandName(args: readonly string[]): string | null {
  if (args.length === 1 && args[0] === '--version') return '--version';
  let index = 0;
  while (index < args.length) {
    const argument = args[index]!;
    if (argument === '-c') {
      const value = args[index + 1];
      if (value === undefined || !GIT_READ_SAFE_CONFIG_OVERRIDES.has(value)) return null;
      index += 2;
      continue;
    }
    if (argument === '--git-dir' || argument === '--work-tree') {
      if (args[index + 1] === undefined) return null;
      index += 2;
      continue;
    }
    if (argument === '--no-pager' || argument === '--literal-pathspecs') {
      index += 1;
      continue;
    }
    return argument.startsWith('-') ? null : argument;
  }
  return null;
}

/**
 * GitRead is an observation capability, not a generic Git process wrapper.
 * Reject mutation grammar before any retained executable is invoked. Commands
 * with read and write modes are narrowed to their observation-only form here;
 * a semantic mutation owner must use a separately issued effect capability.
 */
function gitReadCommandIsObservation(args: readonly string[]): boolean {
  const command = gitReadCommandName(args);
  if (command === '--version') return true;
  if (command === null || !GIT_READ_ONLY_COMMANDS.has(command)) return false;
  const commandIndex = args.indexOf(command);
  const commandArgs = args.slice(commandIndex + 1);
  if (gitReadArgumentsInvokeHelper(commandArgs)) return false;
  if (command === 'branch') return commandArgs.length === 1 && commandArgs[0] === '--show-current';
  if (command === 'cat-file') {
    return (commandArgs.length === 1 && commandArgs[0] === '--batch')
      || (commandArgs.length === 2
        && ['-e', '-s', '-t', 'blob', 'commit'].includes(commandArgs[0]!));
  }
  if (command === 'grep') {
    let patternCount = 0;
    let revisionCount = 0;
    let separatorIndex = -1;
    for (let index = 0; index < commandArgs.length; index += 1) {
      const argument = commandArgs[index]!;
      if (argument === '--') {
        if (separatorIndex !== -1) return false;
        separatorIndex = index;
        continue;
      }
      if (separatorIndex !== -1) {
        if (argument !== '.') return false;
        continue;
      }
      if (argument === '-e') {
        const pattern = commandArgs[index + 1];
        if (pattern === undefined || pattern.length === 0 || pattern.includes('\0')) return false;
        patternCount += 1;
        index += 1;
        continue;
      }
      if (argument === '-l' || argument === '-F' || argument === '-z') continue;
      if (argument.startsWith('-')) return false;
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(argument)) return false;
      revisionCount += 1;
    }
    return patternCount > 0
      && revisionCount === 1
      && separatorIndex >= 0
      && separatorIndex === commandArgs.length - 2
      && commandArgs.at(-1) === '.';
  }
  if (command === 'check-attr') {
    return commandArgs.length === 6
      && commandArgs[0] === '-z'
      && commandArgs[1] === '--stdin'
      && commandArgs[2] === '--source'
      && !commandArgs[3]!.startsWith('-')
      && commandArgs[4] === 'text'
      && commandArgs[5] === 'eol';
  }
  if (command === 'config') {
    return commandArgs.length === 2
      && commandArgs[0] === '--get'
      && !commandArgs[1]!.startsWith('-');
  }
  if (command === 'remote') {
    return commandArgs.length >= 2
      && commandArgs[0] === 'get-url'
      && commandArgs.slice(1, -1).every((argument) => argument === '--all' || argument === '--push')
      && !commandArgs.at(-1)!.startsWith('-');
  }
  if (command === 'worktree') {
    return commandArgs[0] === 'list'
      && commandArgs.slice(1).every((argument) => (
        argument === '--porcelain' || argument === '-z' || argument === '-v'
      ));
  }
  if (command === 'symbolic-ref') {
    const positional = commandArgs.filter((argument) => !argument.startsWith('-'));
    return positional.length === 1
      && commandArgs.every((argument) => (
        !argument.startsWith('-')
        || argument === '--short'
        || argument === '--quiet'
        || argument === '-q'
      ));
  }
  if (command === 'status') {
    return commandArgs.every((argument) => (
      argument === '--short'
      || argument === '--branch'
      || argument === '--porcelain'
      || argument === '--porcelain=v1'
      || argument === '--porcelain=v2'
      || argument === '-z'
      || argument === '--untracked-files=all'
      || argument === '--untracked-files=no'
      || argument === '--ignored=no'
      || argument === '--ignored=matching'
      || argument === '--'
      || !argument.startsWith('-')
    ));
  }
  if (command === 'var') {
    return commandArgs.length === 1
      && (commandArgs[0] === 'GIT_AUTHOR_IDENT' || commandArgs[0] === 'GIT_COMMITTER_IDENT');
  }
  if (command === 'show') {
    return commandArgs.length === 1 && !commandArgs[0]!.startsWith('-');
  }
  if (command === 'merge-base') {
    return (commandArgs.length === 2 && commandArgs.every((argument) => !argument.startsWith('-')))
      || (commandArgs.length === 3
        && commandArgs[0] === '--is-ancestor'
        && commandArgs.slice(1).every((argument) => !argument.startsWith('-')));
  }
  if (command === 'for-each-ref') {
    return commandArgs.length === 2
      && commandArgs[0]!.startsWith('--format=')
      && !commandArgs[1]!.startsWith('-');
  }
  if (command === 'diff' || command === 'diff-files' || command === 'diff-index') {
    const allowed = new Set([
      '--no-ext-diff', '--no-textconv', '--binary', '--full-index', '--no-renames',
      '--name-status', '--name-only', '--exit-code', '-z', '--find-renames',
      '--find-copies', '--cached', '--'
    ]);
    return commandArgs.every((argument) => (
      allowed.has(argument)
      || argument.startsWith('--diff-filter=')
      || !argument.startsWith('-')
    )) && (command !== 'diff-files' || !commandArgs.includes('--cached'));
  }
  if (command === 'ls-files') {
    const allowed = new Set([
      '-z', '--stage', '--unmerged', '--cached', '--others', '--exclude-standard', '--ignored',
      '--deleted', '--'
    ]);
    return commandArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  if (command === 'ls-tree') {
    const allowed = new Set(['-r', '-z', '-l', '--full-tree', '--name-only', '--']);
    return commandArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  if (command === 'ls-remote') {
    const positional = commandArgs[0] === '--exit-code' ? commandArgs.slice(1) : commandArgs;
    return positional.length === 2
      && positional.every((argument) => argument.length > 0 && !argument.startsWith('-'))
      && positional[1]!.startsWith('refs/heads/');
  }
  if (command === 'rev-parse') {
    const allowed = new Set([
      '--verify', '--quiet', '-q', '--end-of-options', '--show-toplevel', '--git-common-dir',
      '--absolute-git-dir', '--is-inside-work-tree', '--path-format=absolute', '--git-path',
      '--show-object-format'
    ]);
    return commandArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  if (command === 'rev-list') {
    // These flags only constrain/shape the commit walk; they do not mutate
    // repository state.  The freeze/replan reader relies on the ancestry
    // path walk, so keep the allowlist explicit instead of treating every
    // rev-list option as a read capability.
    const allowed = new Set([
      '--parents', '--walk-reflogs', '-n', '1', '--count', '--not',
      '--first-parent', '--ancestry-path', '--reverse'
    ]);
    return commandArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  return false;
}

export function resolveGitReadSessionBudget(
  input: Partial<GitReadSessionBudget> | undefined
): GitReadSessionBudget {
  const requested = input ?? {};
  for (const [label, value] of Object.entries(requested)) {
    if (!(label in CANONICAL_GIT_READ_BUDGET_CEILING)) {
      throw new GitReadBudgetError(
        'unknown-field',
        label,
        `Git read session budget field ${label} is not canonical.`
      );
    }
    validBudgetNumber(label, value as number);
    const ceiling = CANONICAL_GIT_READ_BUDGET_CEILING[
      label as keyof GitReadSessionBudget
    ];
    if ((value as number) > ceiling) {
      throw new GitReadBudgetError(
        'canonical-ceiling-exceeded',
        label,
        `Git read session ${label} exceeds its canonical ceiling.`
      );
    }
  }
  const budget = Object.freeze({
    ...GIT_READ_DEFAULT_OPERATION_BUDGET,
    ...requested
  });
  for (const [label, value] of Object.entries(budget)) validBudgetNumber(label, value);
  return budget;
}

function validBudgetNumber(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GitReadBudgetError(
      'invalid-value',
      label,
      `Git read session ${label} must be a positive safe integer.`
    );
  }
  return value;
}

function boundedGitReadDeadlineAt(
  startedAt: number,
  budget: GitReadSessionBudget,
  parentDeadlineAt: number | undefined
): number {
  if (parentDeadlineAt !== undefined
      && (!Number.isSafeInteger(parentDeadlineAt) || parentDeadlineAt < 0)) {
    throw new GitReadBudgetError(
      'invalid-value',
      'deadlineAtUnixMs',
      'Git read parent deadline must be a non-negative safe integer.'
    );
  }
  return Math.min(
    parentDeadlineAt ?? startedAt + budget.deadlineMs,
    startedAt + budget.deadlineMs
  );
}

type GitExecutableInspection = Readonly<{
  identity: GitExecutableIdentity;
  bytes: number;
}>;

type GitExecutableInspectionResult =
  | GitExecutableInspection
  | Readonly<{ kind: 'unavailable'; reason: 'deadline' | 'budget' | 'identity' }>;

function executableAncestor(
  identity: PhysicalDirectoryChain['target']
): Readonly<{
  path: string;
  finalPath: string;
  device: string;
  inode: string;
  objectId: string;
}> {
  return Object.freeze({
    path: identity.path,
    finalPath: identity.finalPath,
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

/**
 * Bind Git to one retained no-follow parent/ordinary leaf read.  The old
 * realpath -> stat -> readFile sequence was path-based TOCTOU and followed
 * symlinks/reparse points.  Metadata is preflighted before the bounded retained
 * read, and the returned leaf bytes/identity plus every parent identity form
 * one observation domain for the session's start/end fence.
 */
function inspectGitExecutable(
  executable: string,
  input: Readonly<{ deadlineAtMs: number; maxBytes: number }>
): GitExecutableInspectionResult {
  if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
  try {
    const executablePath = path.resolve(executable);
    const parentPath = path.dirname(executablePath);
    const leafName = path.basename(executablePath);
    const parent = inspectNoFollowDirectoryChain(parentPath, 'Git executable parent');
    if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
    // Read metadata for this lexical parent first so a custom executable-byte
    // budget rejects a large leaf before the retained byte reader allocates.
    const metadata = scanNoFollowDirectoryTreeMetadata(parent.target, {
      deadlineAtMs: input.deadlineAtMs,
      maximumEntries: 10_000
    }).find((entry) => entry.relativePath === leafName);
    if (metadata === undefined || metadata.kind !== 'file') {
      return { kind: 'unavailable', reason: 'identity' };
    }
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > input.maxBytes) {
      return { kind: 'unavailable', reason: 'budget' };
    }
    const entry = inspectNoFollowOrdinaryFileEntry(parent.target, leafName);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
      return { kind: 'unavailable', reason: 'identity' };
    }
    if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
    if (entry.bytes.byteLength > input.maxBytes || entry.bytes.byteLength !== metadata.size) {
      return { kind: 'unavailable', reason: 'budget' };
    }
    const identity = Object.freeze({
      path: executablePath,
      // This is a retained no-follow locator, not a realpath authority.  Keep
      // the historical field for callers while binding the physical identity
      // to the leaf and parent-chain values below.
      realPath: path.join(parent.target.finalPath, leafName),
      device: entry.device,
      inode: entry.inode,
      size: entry.size,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
      digest: rawSha256(entry.bytes),
      ancestorChain: Object.freeze(parent.ancestors.map(executableAncestor))
    });
    return Object.freeze({ identity, bytes: entry.bytes.byteLength });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError
        && error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') {
      return { kind: 'unavailable', reason: 'identity' };
    }
    if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
    return { kind: 'unavailable', reason: 'identity' };
  }
}

function sameGitExecutableIdentity(
  left: GitExecutableIdentity | null,
  right: GitExecutableIdentity | null
): boolean {
  return left !== null && right !== null
    && left.path === right.path
    && left.realPath === right.realPath
    && left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs
    && left.digest === right.digest
    && JSON.stringify(left.ancestorChain) === JSON.stringify(right.ancestorChain);
}

function physicalDirectoryChainObservedBytes(chain: PhysicalDirectoryChain): number {
  return Buffer.byteLength(JSON.stringify(chain), 'utf8');
}

/**
 * Create one invocation-scoped Git read budget. The session deliberately
 * exposes no unbounded Promise fan-out: every command consumes one process,
 * the remaining absolute deadline, and the remaining aggregate byte budget.
 */
type GitReadHostSessionCommonInput = Readonly<{
  cwd: string;
  environment?: Readonly<Record<string, string | undefined>>;
  budget?: Partial<GitReadSessionBudget>;
  source?: NodeJS.ProcessEnv;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>;

type GitReadHostSessionInput =
  | (GitReadHostSessionCommonInput & Readonly<{
      origin: 'production';
      /** The process Effect and its aggregate budgets must be bound before provider admission. */
      operation: SecBoundSemanticOperation;
      /** Optional caller-owned parent process ledger; Git borrows but never closes it. */
      processSession?: ProcessResourceSession;
    }>)
  | (GitReadHostSessionCommonInput & Readonly<{
      origin: 'test';
      operation?: never;
    }>);

const TEST_GIT_READ_PROCESS_REQUIREMENT = 'git-read.test-host-process';
const TEST_GIT_READ_PROCESS_CONTRACT = sha256({
  operation: 'external-capabilities.git-read.test-host-observe',
  provider: 'test-host-local-git',
  effect: 'process'
}) as SecOperationDigest;
const TEST_GIT_READ_PROCESS_PROVIDER = sha256({
  provider: 'external-capabilities.git-read.test-host-process'
}) as SecOperationDigest;

function issueTestGitReadProcessOperation(
  input: GitReadHostSessionCommonInput,
  budget: GitReadSessionBudget
): SecBoundSemanticOperation {
  const startedAt = Date.now();
  const deadlineAtUnixMs = Math.min(
    input.deadlineAtUnixMs ?? startedAt + budget.deadlineMs,
    startedAt + budget.deadlineMs
  );
  const durationMs = deadlineAtUnixMs - startedAt;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new Error('Test Git read process operation deadline is exhausted.');
  }
  const plan = compileSecSemanticOperationPlan({
    operation: 'external-capabilities.git-read.test-host-observe',
    intentDigest: sha256({ cwd: input.cwd, budget }) as SecOperationDigest,
    decisionDigest: TEST_GIT_READ_PROCESS_CONTRACT,
    deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: TEST_GIT_READ_PROCESS_CONTRACT
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: budget.maxStdinBytes },
      {
        resource: 'output-bytes',
        maximum: budget.maxStdoutBytes + budget.maxStderrBytes
      },
      { resource: 'processes', maximum: budget.maxProcesses }
    ],
    requirements: [{
      id: TEST_GIT_READ_PROCESS_REQUIREMENT,
      contractDigest: TEST_GIT_READ_PROCESS_CONTRACT,
      effectKinds: ['process'],
      failureKinds: [
        'process.cancelled',
        'process.deadline-exhausted',
        'process.identity-drift',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: TEST_GIT_READ_PROCESS_REQUIREMENT,
    contractDigest: TEST_GIT_READ_PROCESS_CONTRACT,
    providerIdentityDigest: TEST_GIT_READ_PROCESS_PROVIDER
  })]);
}

function semanticOperationBudget(
  operation: SecBoundSemanticOperation | undefined,
  resource: 'input-bytes' | 'output-bytes' | 'processes'
): number | null {
  return operation?.plan.execution.aggregateBudgets
    .find((candidate) => candidate.resource === resource)?.maximum ?? null;
}

function createHostGitReadSession(input: GitReadHostSessionInput): GitReadSession {
  const budget = resolveGitReadSessionBudget(input.budget);
  let processResourceSession: ProcessResourceSession | null = null;
  let processOperation: SecBoundSemanticOperation | null = null;
  let processRequirementId: string | null = null;
  let ownsProcessResourceSession = true;
  let operationAdmissionFailure: string | null = null;
  try {
    processOperation = input.origin === 'production'
      ? input.operation
      : issueTestGitReadProcessOperation(input, budget);
    const processRequirements = processOperation.plan.execution.requirements.filter(
      ({ effectKinds }) => effectKinds.includes('process')
    );
    if (processRequirements.length !== 1) {
      throw new Error('Git read process admission requires exactly one process requirement.');
    }
    processRequirementId = processRequirements[0]!.id;
    if (input.origin === 'production' && input.processSession !== undefined) {
      input.processSession.cooperativeDeadlineAtUnixMs();
      if (input.processSession.operationIdentityDigest
            !== processOperation.plan.identity.identityDigest
          || input.processSession.boundAttemptDigest !== processOperation.boundAttemptDigest
          || input.processSession.requirementId !== processRequirementId) {
        throw new Error('Git read rejected a borrowed process session binding transplant.');
      }
      processResourceSession = input.processSession;
      ownsProcessResourceSession = false;
    } else {
      processResourceSession = openProcessResourceSession({
        operation: processOperation,
        requirementBindingContext: issueSecOperationRequirementBindingContext({
          operation: processOperation,
          requirementId: processRequirementId,
          resourceCeilings: processOperation.plan.execution.aggregateBudgets.filter(({ resource }) => (
            resource === 'duration-ms'
            || resource === 'input-bytes'
            || resource === 'output-bytes'
            || resource === 'processes'
          ))
        }),
        signal: input.signal
      });
    }
  } catch (error) {
    operationAdmissionFailure = error instanceof Error ? error.message : String(error);
  }
  const startedAt = Date.now();
  const startedMonotonicAt = performance.now();
  const operationAdmissionUnavailable = processResourceSession === null;
  const processOutputBudget = semanticOperationBudget(
    processOperation ?? undefined,
    'output-bytes'
  );
  const processInputBudget = semanticOperationBudget(
    processOperation ?? undefined,
    'input-bytes'
  );
  const processCountBudget = semanticOperationBudget(
    processOperation ?? undefined,
    'processes'
  );
  const processCountAtStart = processResourceSession?.processCount ?? 0;
  const processInputBytesAtStart = processResourceSession?.inputBytes ?? 0;
  const processOutputBytesAtStart = processResourceSession?.outputBytes ?? 0;
  const deadlineAt = boundedGitReadDeadlineAt(
    startedAt,
    budget,
    Math.min(
      input.deadlineAtUnixMs ?? Number.MAX_SAFE_INTEGER,
      processResourceSession?.deadlineAtUnixMs ?? Number.MAX_SAFE_INTEGER
    )
  );
  const deadlineMonotonicAt = startedMonotonicAt + Math.max(0, deadlineAt - startedAt);
  const env = Object.freeze(isolatedGitReadEnvironment(input.environment ?? {}, input.source));
  let admissionCancelled = input.signal?.aborted === true;
  let admissionDeadlineExpired = Date.now() >= deadlineAt
    || performance.now() >= deadlineMonotonicAt;
  let workingDirectoryIdentity: PhysicalDirectoryChain | null = null;
  let workingDirectoryObservationFailure: string | null = null;
  if (!operationAdmissionUnavailable && !admissionCancelled && !admissionDeadlineExpired) {
    try {
      workingDirectoryIdentity = inspectNoFollowDirectoryChain(
        path.resolve(input.cwd),
        'Git read working directory'
      );
    } catch (error) {
      workingDirectoryObservationFailure = error instanceof Error ? error.message : String(error);
    }
  }
  // The no-follow cwd inspection is synchronous, so it cannot be cancelled
  // midway.  It must nevertheless be followed by an absolute-deadline gate:
  // an expired cwd observation may not continue into PATH discovery or
  // executable inspection.
  if (!admissionCancelled && !admissionDeadlineExpired && (
    Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt
  )) {
    admissionDeadlineExpired = true;
  }
  admissionCancelled ||= input.signal?.aborted === true;
  // Do not even perform executable/PATH discovery when the cwd observation
  // cannot be proved. This keeps an unsafe or unavailable cwd from becoming a
  // transport authority through a later child-process check.
  const gitExecutable = operationAdmissionUnavailable || admissionCancelled
      || admissionDeadlineExpired || workingDirectoryIdentity === null
    ? null
    : resolveExecutableLocator(
      'git',
      {
        pathValue: gitEnvironmentValue(env, 'PATH') ?? '',
        cwd: path.resolve(input.cwd)
      }
    );
  if (!admissionCancelled && !admissionDeadlineExpired && (
    Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt
  )) {
    admissionDeadlineExpired = true;
  }
  admissionCancelled ||= input.signal?.aborted === true;
  const initialExecutableObservation = operationAdmissionUnavailable || admissionCancelled
      || admissionDeadlineExpired || gitExecutable === null
    ? null
    : inspectGitExecutable(gitExecutable, {
      deadlineAtMs: deadlineMonotonicAt,
      maxBytes: budget.maxExecutableBytes
    });
  if (!admissionCancelled && !admissionDeadlineExpired && (
    Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt
  )) {
    admissionDeadlineExpired = true;
  }
  admissionCancelled ||= input.signal?.aborted === true;
  const gitExecutableIdentity = initialExecutableObservation !== null
      && 'identity' in initialExecutableObservation
    ? initialExecutableObservation.identity
    : null;
  let gitPhysicalProvider: GitPhysicalProviderCapability | null = null;
  let retainedAdmissionFailure: string | null = null;
  if (!operationAdmissionUnavailable
      && !admissionCancelled
      && !admissionDeadlineExpired
      && workingDirectoryIdentity !== null
      && physicalDirectoryChainObservedBytes(workingDirectoryIdentity) <= budget.maxRootObservedBytes
      && gitExecutable !== null
      && gitExecutableIdentity !== null
      && processOperation !== null
      && processResourceSession !== null) {
    const resolution = openGitPhysicalProvider({
      cwd: workingDirectoryIdentity.target.path,
      executablePath: gitExecutable,
      operation: processOperation,
      processSession: processResourceSession,
      environment: env,
      environmentSource: {},
      maximumExecutableBytes: budget.maxExecutableBytes
    });
    if (resolution.status === 'ready') {
      const physical = resolution.capability.identity.executablePhysical;
      if (physical.device === gitExecutableIdentity.device
          && physical.inode === gitExecutableIdentity.inode
          && resolution.capability.identity.executableSize === gitExecutableIdentity.size
          && resolution.capability.identity.executableDigest === gitExecutableIdentity.digest) {
        gitPhysicalProvider = resolution.capability;
      } else {
        try { closeGitPhysicalProvider(resolution.capability); } catch { /* preserve identity drift */ }
        retainedAdmissionFailure = 'Git executable identity changed before shared provider retention.';
      }
    } else {
      retainedAdmissionFailure = `Git physical provider admission failed: ${resolution.reason}.`;
    }
  }
  // Retention is synchronous as well.  A slow capability admission must not
  // turn an operation whose absolute deadline elapsed during that admission
  // into a ready session, and it must not leave a retained child boundary
  // behind while the provider is being rejected.
  admissionCancelled ||= input.signal?.aborted === true;
  if (!admissionCancelled && !admissionDeadlineExpired && (
    Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt
  )) {
    admissionDeadlineExpired = true;
  }
  if ((admissionCancelled || admissionDeadlineExpired)
      && gitPhysicalProvider !== null) {
    let disposalFailure: unknown;
    try {
      closeGitPhysicalProvider(gitPhysicalProvider);
    } catch (error) {
      disposalFailure = error;
    }
    gitPhysicalProvider = null;
    if (disposalFailure !== undefined && retainedAdmissionFailure === null) {
      retainedAdmissionFailure = disposalFailure instanceof Error
        ? disposalFailure.message
        : String(disposalFailure);
    }
  }
  let activeProcesses = 0;
  let closed = false;
  let closing = false;
  let closePromise: Promise<GitReadSessionReceipt> | null = null;
  let closeReceipt: GitReadSessionReceipt | null = null;
  const activeRunSettlements = new Set<Promise<void>>();
  const registerActiveRun = (): (() => void) => {
    let settled = false;
    let settle!: () => void;
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });
    activeRunSettlements.add(completion);
    return () => {
      if (settled) return;
      settled = true;
      activeRunSettlements.delete(completion);
      settle();
    };
  };
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let argumentBytes = 0;
  let stdinBytes = 0;
  let recordCount = 0;
  let settlementAttempts = 0;
  let rootObservedBytes = workingDirectoryIdentity === null
    ? 0
    : physicalDirectoryChainObservedBytes(workingDirectoryIdentity);
  let executableBytes = initialExecutableObservation !== null
      && 'bytes' in initialExecutableObservation
    ? initialExecutableObservation.bytes
    : 0;
  let failure: GitReadSessionFailure | null = null;
  if (admissionCancelled) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'cancelled',
      detail: 'Git read session was cancelled during provider admission.'
    });
  } else if (admissionDeadlineExpired) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'deadline-exhausted',
      detail: 'Git read session deadline elapsed before provider admission.'
    });
  } else if (operationAdmissionUnavailable) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'operation-admission-unavailable',
      detail: 'Git read requires one owner-issued process Effect operation.'
        + (operationAdmissionFailure === null ? '' : ` ${operationAdmissionFailure}`)
    });
  } else if (workingDirectoryIdentity === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'command-error',
      detail: 'The trusted Git working-directory physical identity could not be observed.'
        + (workingDirectoryObservationFailure === null ? '' : ` ${workingDirectoryObservationFailure}`)
    });
  } else if (rootObservedBytes > budget.maxRootObservedBytes) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'root-observation-budget-exhausted',
      detail: 'The trusted Git working-directory observation exceeded the root-observation byte budget.'
    });
  } else if (gitExecutable === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'command-error',
      detail: 'The trusted Git executable could not be resolved.'
    });
  } else if (gitExecutableIdentity === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'command-error',
      detail: initialExecutableObservation !== null
          && 'reason' in initialExecutableObservation
          && initialExecutableObservation.reason === 'budget'
        ? 'The trusted Git executable exceeded the executable-byte budget.'
        : initialExecutableObservation !== null
          && 'reason' in initialExecutableObservation
          && initialExecutableObservation.reason === 'deadline'
          ? 'The trusted Git executable observation exceeded the read-session deadline.'
          : 'The trusted Git executable physical identity could not be observed.'
    });
  } else if (gitPhysicalProvider === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'retained-provider-unavailable',
      detail: `The ${process.platform} Git executable and working directory could not be retained.`
        + (retainedAdmissionFailure === null ? '' : ` ${retainedAdmissionFailure}`)
    });
  }

  const fail = (
    reason: GitReadSessionFailure['reason'],
    detail: string
  ): GitReadSessionFailure => {
    failure ??= Object.freeze({
      kind: 'unresolved-git-read-session',
      reason,
      detail,
      detailDigest: rawSha256(JSON.stringify({
        route: 'host-local-git-v1',
        reason,
        detail
      })),
    });
    return failure;
  };

  const verifyExecutable = (): boolean => {
    if (failure !== null || closed) return false;
    if (input.signal?.aborted === true) {
      fail('cancelled', 'Git read session was cancelled during executable verification.');
      return false;
    }
    if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
      fail('deadline-exhausted', 'Git read session deadline elapsed during executable verification.');
      return false;
    }
    try {
      if (gitPhysicalProvider === null) throw new Error('Git physical provider is unavailable.');
      // Executable bytes are a capability-admission resource, not a
      // per-command transport resource. The provider retains the exact leaf
      // for this whole session (writer/delete exclusion on Windows; sealed
      // executable image plus lexical witness on Linux), so its one content
      // proof remains current while this handle/metadata/lexical fence holds.
      assertGitPhysicalProviderCurrentInternal(gitPhysicalProvider);
    } catch (error) {
      fail('command-error', `The retained Git executable changed. ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
      fail('deadline-exhausted', 'Git read session deadline elapsed after executable verification.');
      return false;
    }
    return true;
  };

  let authorizedScratchInvocation: Readonly<{
    readonly args: readonly string[];
    readonly auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[];
    readonly environment: Readonly<Record<string, string>>;
    readonly input?: Uint8Array;
  }> | null = null;
  const session: GitReadSession = {
    cwd: input.cwd,
    gitExecutable: gitExecutable ?? '',
    gitExecutableIdentity,
    providerRoute: 'host-local-git-v1',
    providerIdentity: gitExecutableIdentity === null
      ? null
      : Object.freeze({
          route: 'host-local-git-v1' as const,
          executable: gitExecutableIdentity
        }),
    env,
    budget,
    startedAt,
    deadlineAt,
    get processCount() {
      return Math.max(0, (processResourceSession?.processCount ?? processCountAtStart)
        - processCountAtStart);
    },
    get stdoutBytes() { return stdoutBytes; },
    get stderrBytes() { return stderrBytes; },
    get argumentBytes() { return argumentBytes; },
    get stdinBytes() { return stdinBytes; },
    get executableBytes() { return executableBytes; },
    get recordCount() { return recordCount; },
    get rootObservedBytes() { return rootObservedBytes; },
    reopenRefreshes: 0,
    get settlementAttempts() { return settlementAttempts; },
    get failure() { return failure; },
    workingDirectoryIdentity,
    verifyWorkingDirectory(): boolean {
      if (failure !== null || closed || workingDirectoryIdentity === null) return false;
      if (input.signal?.aborted === true) {
        fail('cancelled', 'Git read session was cancelled during cwd verification.');
        return false;
      }
      if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
        fail('deadline-exhausted', 'Git read session deadline elapsed during cwd verification.');
        return false;
      }
      try {
        if (gitPhysicalProvider === null) throw new Error('Git physical provider is unavailable.');
        assertGitPhysicalProviderCurrentInternal(gitPhysicalProvider);
        const current = inspectNoFollowDirectoryChain(
          path.resolve(input.cwd),
          'Git read working directory verification'
        );
        const observedBytes = physicalDirectoryChainObservedBytes(current);
        if (rootObservedBytes + observedBytes > budget.maxRootObservedBytes) {
          fail(
            'root-observation-budget-exhausted',
            'Git working-directory verification exceeded the root-observation byte budget.'
          );
          return false;
        }
        rootObservedBytes += observedBytes;
        if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
          fail('deadline-exhausted', 'Git read session deadline elapsed after cwd verification.');
          return false;
        }
        const stable = JSON.stringify(current) === JSON.stringify(workingDirectoryIdentity);
        if (!stable) fail('command-error', 'The trusted Git working-directory physical identity changed.');
        return stable;
      } catch (error) {
        if (Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt) {
          fail('deadline-exhausted', 'Git read session deadline elapsed while re-observing the working directory.');
        } else {
          fail(
            'command-error',
            'The trusted Git working-directory physical identity could not be re-observed.'
              + (error instanceof Error ? ` ${error.message}` : ` ${String(error)}`)
          );
        }
        return false;
      }
    },
    verifyExecutable,
    async run(args: readonly string[], options: GitReadSessionRunOptions = {}): Promise<GitReadSessionCommand> {
      if (failure !== null) return failure;
      if (input.signal?.aborted === true) {
        return fail('cancelled', 'Git read session was cancelled before child execution.');
      }
      if (closed || closing) return fail(
        'command-error',
        closed ? 'Git read session is closed.' : 'Git read session is closing.'
      );
      const scratchInvocation = authorizedScratchInvocation?.args === args
        ? authorizedScratchInvocation
        : null;
      if (scratchInvocation === null && !gitReadCommandIsObservation(args)) {
        return fail(
          'operation-not-permitted',
          'Git session rejected command grammar outside its observation capability.'
        );
      }
      const remainingWallMs = deadlineAt - Date.now();
      const remainingMonotonicMs = deadlineMonotonicAt - performance.now();
      const remainingMs = Math.min(remainingWallMs, remainingMonotonicMs);
      if (remainingMs < 1) return fail('deadline-exhausted', 'Git read session deadline elapsed.');
      // The executable fence belongs to this transport owner. Consumers may
      // add a later observation fence, but cannot be the only thing preventing
      // a replaced helper from serving this child process.
      if (!(session.verifyWorkingDirectory?.() ?? true)) return failure ?? fail(
        'command-error',
        'The trusted Git working-directory physical identity could not be verified before child execution.'
      );
      if (!verifyExecutable()) return failure ?? fail(
        'command-error',
        'The trusted Git executable physical identity could not be verified before child execution.'
      );
      if (Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt) {
        return fail('deadline-exhausted', 'Git read session deadline elapsed before child execution.');
      }
      const effectiveProcessLimit = Math.min(
        budget.maxProcesses,
        processCountBudget ?? budget.maxProcesses
      );
      if (session.processCount >= effectiveProcessLimit) {
        return fail('process-budget-exhausted', `Git read session exceeded ${effectiveProcessLimit} processes.`);
      }
      if (activeProcesses !== 0) {
        return fail('process-budget-exhausted', 'Git read session does not permit unbounded concurrent processes.');
      }
      const commandArgumentBytes = gitReadCommandArgumentBytes(args);
      if (commandArgumentBytes === null) {
        return fail('command-error', 'Git read session command arguments are invalid.');
      }
      if (argumentBytes + commandArgumentBytes > budget.maxTotalArgumentBytes) {
        return fail('argument-budget-exhausted', 'Git read session argument-byte budget exhausted.');
      }
      if (options.input !== undefined && !(options.input instanceof Uint8Array)) {
        return fail('command-error', 'Git read session stdin must be one Uint8Array.');
      }
      const suppliedInput = scratchInvocation?.input ?? options.input;
      const commandInput = suppliedInput === undefined ? null : Buffer.from(suppliedInput);
      if (commandInput !== null && stdinBytes + commandInput.byteLength > budget.maxStdinBytes) {
        return fail('stdin-budget-exhausted', 'Git read session stdin-byte budget exhausted.');
      }
      if (commandInput !== null
          && commandInput.byteLength > (processInputBudget ?? 0) - (processResourceSession?.inputBytes ?? 0)) {
        return fail('stdin-budget-exhausted', 'Git operation input-byte budget exhausted.');
      }
      const remainingStdout = budget.maxStdoutBytes - stdoutBytes;
      const remainingStderr = budget.maxStderrBytes - stderrBytes;
      if (remainingStdout < 1) return fail('stdout-budget-exhausted', 'Git read session stdout budget exhausted.');
      if (remainingStderr < 1) return fail('stderr-budget-exhausted', 'Git read session stderr budget exhausted.');
      argumentBytes += commandArgumentBytes;
      stdinBytes += commandInput?.byteLength ?? 0;
      activeProcesses += 1;
      const settleRun = registerActiveRun();
      let admittedStdoutLimit = 0;
      let admittedStderrLimit = 0;
      try {
        const commandEnvironment = scratchInvocation?.environment ?? env;
        if (gitPhysicalProvider === null) {
          return fail(
            'retained-provider-unavailable',
            'Git child execution requires one retained executable and working-directory boundary.'
          );
        }
        const desiredStdoutBytes = Math.min(budget.maxCommandStdoutBytes, remainingStdout);
        const desiredStderrBytes = Math.min(budget.maxCommandStderrBytes, remainingStderr);
        const processOutputRemaining = Math.max(
          0,
          (processOutputBudget ?? 0) - (processResourceSession?.outputBytes ?? 0)
        );
        if (processOutputRemaining < 1) {
          return fail('stdout-budget-exhausted', 'Git operation output-byte budget exhausted.');
        }
        const commandStderrBytes = Math.min(desiredStderrBytes, processOutputRemaining);
        const commandStdoutBytes = Math.min(
          desiredStdoutBytes,
          Math.max(0, processOutputRemaining - commandStderrBytes)
        );
        admittedStdoutLimit = commandStdoutBytes;
        admittedStderrLimit = commandStderrBytes;
        const commandOptions = {
          env: commandEnvironment,
          envMode: 'replace' as const,
          ...(commandInput === null ? {} : {
            input: commandInput,
            maxStdinBytes: commandInput.byteLength
          }),
          timeoutMs: Math.max(1, Math.floor(remainingMs)),
          maxStdoutBytes: commandStdoutBytes,
          maxStderrBytes: commandStderrBytes
        };
        if (processResourceSession === null) {
          return fail('operation-admission-unavailable', 'Git process session is unavailable.');
        }
        const result = (await runGitPhysicalCommandInternal(gitPhysicalProvider, args, {
          env: commandOptions.env,
          envMode: commandOptions.envMode,
          ...(commandInput === null ? {} : {
            input: commandInput,
            maxStdinBytes: commandInput.byteLength
          }),
          maxStdoutBytes: commandStdoutBytes,
          maxStderrBytes: commandStderrBytes
        }, scratchInvocation?.auxiliaryInputs)).result;
        stdoutBytes += result.stdout.byteLength;
        stderrBytes += Buffer.byteLength(result.stderr, 'utf8');
        // Always close the child boundary with the same executable fence,
        // including when the child returned oversized output. A budget
        // failure must not bypass the helper-replacement check.
        if (!(session.verifyWorkingDirectory?.() ?? true)) return failure ?? fail(
          'command-error',
          'The trusted Git working-directory physical identity could not be verified after child execution.'
        );
        if (!verifyExecutable()) return failure ?? fail(
          'command-error',
          'The trusted Git executable physical identity could not be verified after child execution.'
        );
        if (stdoutBytes > budget.maxStdoutBytes) {
          return fail('stdout-budget-exhausted', 'Git read session stdout budget exceeded.');
        }
        if (stderrBytes > budget.maxStderrBytes) {
          return fail('stderr-budget-exhausted', 'Git read session stderr budget exceeded.');
        }
        if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
          return fail('deadline-exhausted', 'Git read session deadline elapsed after command completion.');
        }
        return { kind: 'completed', result };
      } catch (error) {
        // Even a transport error is an effect boundary: perform the same
        // post-child helper fence before preserving the transport failure.
        if (!(session.verifyWorkingDirectory?.() ?? true)) return failure ?? fail(
          'command-error',
          'The trusted Git working-directory physical identity could not be verified after child failure.'
        );
        if (!verifyExecutable()) return failure ?? fail(
          'command-error',
          'The trusted Git executable physical identity could not be verified after child failure.'
        );
        if (error instanceof RetainedCommandTransportError) {
          if (error.outcome.stdout.bytes > admittedStdoutLimit) {
            return fail('stdout-budget-exhausted', 'Git command exceeded its admitted stdout-byte budget.');
          }
          if (error.outcome.stderr.bytes > admittedStderrLimit) {
            return fail('stderr-budget-exhausted', 'Git command exceeded its admitted stderr-byte budget.');
          }
          if (error.outcome.status === 'timed-out') {
            return fail('deadline-exhausted', 'Git command exhausted the operation deadline.');
          }
        }
        return fail('command-error', error instanceof Error ? error.message : String(error));
      } finally {
        activeProcesses -= 1;
        settleRun();
      }
    },
    consumeRecords(count: number): GitReadSessionFailure | null {
      if (failure !== null) return failure;
      if (input.signal?.aborted === true) {
        return fail('cancelled', 'Git read session was cancelled before record consumption.');
      }
      if (closed || closing) return fail(
        'command-error',
        closed ? 'Git read session is closed.' : 'Git read session is closing.'
      );
      if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
        return fail('deadline-exhausted', 'Git read session deadline elapsed while consuming records.');
      }
      if (!Number.isSafeInteger(count) || count < 0) {
        return fail('record-budget-exhausted', 'Git read session record count is invalid.');
      }
      if (recordCount + count > budget.maxRecords) {
        return fail('record-budget-exhausted', `Git read session exceeded ${budget.maxRecords} records.`);
      }
      recordCount += count;
      if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
        return fail('deadline-exhausted', 'Git read session deadline elapsed after consuming records.');
      }
      return null;
    },
    async close(): Promise<GitReadSessionReceipt> {
      if (closed) {
        if (closeReceipt === null) throw new Error('Git read session closed without a terminal receipt.');
        return closeReceipt;
      }
      if (closePromise !== null) return closePromise;
      // Closing is a state transition, not an observation failure.  Mark the
      // session as closing so no new child can enter, then await every child
      // already admitted.  This removes the old race where close returned
      // early with retained capabilities still live and the caller could not
      // retry because it had already treated the wrapper as closed.
      closing = true;
      closePromise = (async () => {
        while (activeRunSettlements.size > 0) {
          await Promise.all([...activeRunSettlements]);
        }
        settlementAttempts += 1;
        if (settlementAttempts > budget.maxSettlementAttempts) {
          fail(
            'command-error',
            'Git retained provider close exceeded the settlement-attempt budget.'
          );
        }
        let closeFailure: unknown;
        try {
          if (gitPhysicalProvider !== null) closeGitPhysicalProvider(gitPhysicalProvider);
        } catch (error) {
          closeFailure = error;
        }
        try {
          if (processResourceSession !== null && ownsProcessResourceSession) {
            if (processOperation === null || processRequirementId === null) {
              throw new Error('Git process settlement lacks its bound semantic operation.');
            }
            const receipt = processResourceSession.close();
            assertProcessResourceSessionReceipt(receipt, {
              operationIdentityDigest: processOperation.plan.identity.identityDigest,
              boundAttemptDigest: processOperation.boundAttemptDigest,
              requirementId: processRequirementId
            });
          } else if (processResourceSession !== null) {
            processResourceSession.cooperativeDeadlineAtUnixMs();
          }
        } catch (error) {
          closeFailure ??= error;
        }
        gitPhysicalProvider = null;
        if (closeFailure !== undefined) {
          fail('command-error', `Git retained provider settlement failed. ${closeFailure instanceof Error ? closeFailure.message : String(closeFailure)}`);
        }
        const finalProcessCount = processResourceSession?.processCount ?? processCountAtStart;
        const finalInputBytes = processResourceSession?.inputBytes ?? processInputBytesAtStart;
        const finalOutputBytes = processResourceSession?.outputBytes ?? processOutputBytesAtStart;
        const providerIdentityDigest = issuedSession.providerIdentity === null
          ? null
          : sha256(issuedSession.providerIdentity) as SecOperationDigest;
        const withoutDigest = Object.freeze({
          operationIdentityDigest: processOperation?.plan.identity.identityDigest ?? null,
          boundAttemptDigest: processOperation?.boundAttemptDigest ?? null,
          requirementId: processRequirementId,
          providerIdentityDigest,
          processSessionOwnership: ownsProcessResourceSession ? 'owned' as const : 'borrowed' as const,
          processCount: finalProcessCount - processCountAtStart,
          inputBytes: finalInputBytes - processInputBytesAtStart,
          outputBytes: finalOutputBytes - processOutputBytesAtStart,
          failureDetailDigest: failure === null
            ? null
            : rawSha256(JSON.stringify(failure))
        });
        closeReceipt = Object.freeze({
          ...withoutDigest,
          receiptDigest: sha256({
            domain: 'external-capabilities.git-read.session-receipt',
            receipt: withoutDigest
          }) as SecOperationDigest
        });
        ISSUED_GIT_READ_SESSION_RECEIPTS.add(closeReceipt);
        if (ownsProcessResourceSession) processResourceSession = null;
        closed = true;
        return closeReceipt;
      })();
      return closePromise;
    }
  };
  const issuedSession = Object.freeze(session);
  if (input.origin === 'production'
      && failure === null
      && processResourceSession !== null
      && gitPhysicalProvider !== null
      && issuedSession.providerIdentity !== null) {
    PRODUCTION_GIT_READ_SESSIONS.add(issuedSession);
  } else if (input.origin === 'test') {
    TEST_GIT_READ_SESSIONS.add(issuedSession);
  }
  GIT_SCRATCH_EXECUTION_OWNERS.set(issuedSession, Object.freeze({
    async run(
      args: readonly string[],
      environment: Readonly<Record<string, string>>,
      auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[],
      input?: Uint8Array
    ): Promise<GitReadSessionCommand> {
      if (authorizedScratchInvocation !== null) {
        throw new Error('Git scratch computation does not permit concurrent or nested invocation.');
      }
      authorizedScratchInvocation = Object.freeze({
        args,
        auxiliaryInputs,
        environment,
        ...(input === undefined ? {} : { input })
      });
      try {
        return await issuedSession.run(args, input === undefined ? {} : { input });
      } finally {
        authorizedScratchInvocation = null;
      }
    }
  }));
  if (input.origin === 'production' && issuedSession.providerIdentity !== null) {
    const scratchOwner = GIT_SCRATCH_EXECUTION_OWNERS.get(issuedSession)!;
    GIT_DEVELOPMENT_COMMIT_EXECUTION_OWNERS.set(issuedSession, Object.freeze({
      operation: input.operation,
      providerIdentityDigest: sha256(issuedSession.providerIdentity) as SecOperationDigest,
      run(args, environment, commandInput) {
        if (gitPhysicalProvider === null) {
          throw new Error('Git retained executable/cwd provider is unavailable for development commit.');
        }
        return scratchOwner.run(args, environment, [], commandInput);
      }
    }));
  }
  if (failure !== null) {
    let admissionSettlementFailure: unknown;
    settlementAttempts += 1;
    try {
      if (gitPhysicalProvider !== null) closeGitPhysicalProvider(gitPhysicalProvider);
    } catch (error) {
      admissionSettlementFailure = error;
    }
    try {
      processResourceSession?.close();
    } catch (error) {
      admissionSettlementFailure ??= error;
    }
    gitPhysicalProvider = null;
    processResourceSession = null;
    if (admissionSettlementFailure !== undefined) {
      // Preserve the terminal admission class while binding settlement failure
      // into the bounded detail presented by the provider projection.
      const primary = failure;
      failure = Object.freeze({
        ...primary,
        detail: `${primary.detail} Provider admission settlement also failed: ${
          admissionSettlementFailure instanceof Error
            ? admissionSettlementFailure.message
            : String(admissionSettlementFailure)
        }`
      });
    }
  }
  return issuedSession;
}

function projectHostProviderFailure(
  session: GitReadSession
): GitReadProviderFailure {
  const typedFailureReason: GitReadHostProviderResolutionReason | null = session.failure === null
    ? null
    : session.failure.reason === 'cancelled'
      ? 'git-session-cancelled'
      : session.failure.reason === 'operation-admission-unavailable'
        ? 'git-operation-admission-unavailable'
        : session.failure.reason === 'retained-provider-unavailable'
          ? 'git-retained-provider-unavailable'
          : session.failure.reason === 'deadline-exhausted'
      ? 'git-session-deadline-exhausted'
      : session.failure.reason === 'process-budget-exhausted'
        ? 'git-session-process-budget-exhausted'
        : session.failure.reason === 'stdout-budget-exhausted'
          ? 'git-session-stdout-budget-exhausted'
          : session.failure.reason === 'stderr-budget-exhausted'
            ? 'git-session-stderr-budget-exhausted'
            : session.failure.reason === 'record-budget-exhausted'
              ? 'git-session-record-budget-exhausted'
              : session.failure.reason === 'root-observation-budget-exhausted'
                ? 'git-session-root-observation-budget-exhausted'
                : session.failure.reason === 'executable-budget-exhausted'
                  ? 'git-session-executable-budget-exhausted'
                  : session.failure.reason === 'argument-budget-exhausted'
                    ? 'git-session-argument-budget-exhausted'
                    : session.failure.reason === 'stdin-budget-exhausted'
                      ? 'git-session-stdin-budget-exhausted'
                      : session.failure.reason === 'operation-not-permitted'
                        ? 'git-session-operation-not-permitted'
                        : null;
  const reason: GitReadHostProviderResolutionReason = typedFailureReason
    ?? (session.workingDirectoryIdentity === null
      ? 'git-executable-identity-unavailable'
      : session.gitExecutable.length === 0
        ? 'git-executable-unavailable'
        : session.gitExecutableIdentity === null || session.providerIdentity === null
          ? 'git-executable-identity-unavailable'
          : 'git-session-failed');
  return Object.freeze({
    kind: 'unresolved-git-read-provider',
    route: 'host-local-git-v1',
    status: 'unavailable',
    reason,
    // Keep the provider result typed and bounded while preserving enough
    // evidence to correlate the failure. The raw executable path and failure
    // detail remain local to the session and are never promoted to authority.
    detailDigest: rawSha256(JSON.stringify({
      route: 'host-local-git-v1',
      reason,
      executablePresent: session.gitExecutable.length > 0,
      executableIdentityPresent: session.gitExecutableIdentity !== null,
      providerIdentityPresent: session.providerIdentity !== null,
      sessionFailure: session.failure
        ? { reason: session.failure.reason, detail: session.failure.detail }
        : null
    }))
  });
}

/**
 * Authority-sensitive Git admission. The host route resolves Git only from
 * the canonical child environment and binds its executable and cwd physical
 * identities. Execution is admitted only when the host physical owner can
 * issue a retained executable/cwd boundary; an unsupported host returns a
 * typed provider failure and never falls back to an unretained PATH child.
 */
export function createAuthorityGitReadSession(input: Readonly<{
  cwd: string;
  environment?: Readonly<Record<string, string | undefined>>;
  /** Owner-issued operation that binds the process Effect and aggregate resources. */
  operation: SecBoundSemanticOperation;
  /**
   * Caller-owned parent process ledger. The Git provider verifies the exact
   * operation/attempt/requirement binding and borrows it without closing it.
   */
  processSession?: ProcessResourceSession;
  /** Production callers must name their operation envelope; no implicit local budget is authority. */
  budget: Partial<GitReadSessionBudget>;
  source?: NodeJS.ProcessEnv;
  /** Optional parent absolute wall deadline; never broadens the local budget. */
  deadlineAtUnixMs?: number;
  /** Parent cancellation signal shared by admission, every child and close settlement. */
  signal?: AbortSignal;
}>): GitReadSessionResolution {
  const session = createHostGitReadSession({ ...input, origin: 'production' });
  if (session.gitExecutable.length === 0
      || session.gitExecutableIdentity === null
      || session.providerIdentity === null
      || session.failure !== null) {
    return projectHostProviderFailure(session);
  }
  return Object.freeze({
    status: 'ready' as const,
    route: 'host-local-git-v1' as const,
    session
  });
}

function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Issues the one Git effect needed to compute a tree from an already-created,
 * immutable index snapshot. The scratch root is caller-materialized but must
 * be repository-external and contain exactly the retained `index` file and
 * `objects` directory. The returned object has no generic command surface.
 */
export async function createAuthorityGitScratchIndexTreeSession(input: Readonly<{
  readonly gitReadSession: GitReadSession;
  readonly scratchRoot: string;
}>): Promise<GitScratchIndexTreeResolution> {
  if (!isProductionGitReadSession(input.gitReadSession)) {
    return Object.freeze({ status: 'unavailable', reason: 'production-session-required' });
  }
  const executionOwner = GIT_SCRATCH_EXECUTION_OWNERS.get(input.gitReadSession);
  if (executionOwner === undefined) {
    return Object.freeze({ status: 'unavailable', reason: 'retained-provider-unavailable' });
  }
  const scratchRoot = path.resolve(input.scratchRoot);
  if (!path.isAbsolute(input.scratchRoot) || scratchRoot !== input.scratchRoot) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-scratch-layout' });
  }
  const identity = await input.gitReadSession.run([
    'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-path', 'objects',
    '--git-path', 'index', '--show-object-format'
  ]);
  if (identity.kind !== 'completed' || identity.result.code !== 0) {
    return Object.freeze({ status: 'unavailable', reason: 'session-failed' });
  }
  const lines = Buffer.from(identity.result.stdout).toString('utf8').trim().split(/\r?\n/u);
  const [repositoryRoot, repositoryObjects, repositoryIndex, objectFormat] = lines;
  if (lines.length !== 4 || repositoryRoot === undefined || repositoryObjects === undefined
      || repositoryIndex === undefined || (objectFormat !== 'sha1' && objectFormat !== 'sha256')) {
    return Object.freeze({ status: 'unavailable', reason: 'session-failed' });
  }
  const canonicalRepositoryRoot = path.resolve(repositoryRoot);
  const canonicalRepositoryObjects = path.resolve(repositoryObjects);
  const canonicalRepositoryIndex = path.resolve(repositoryIndex);
  if (pathIsInside(canonicalRepositoryRoot, scratchRoot)
      || pathIsInside(scratchRoot, canonicalRepositoryRoot)
      || pathIsInside(canonicalRepositoryObjects, scratchRoot)
      || pathIsInside(scratchRoot, canonicalRepositoryObjects)) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-scratch-layout' });
  }

  let repositoryObjectsCapability: RetainedNoFollowChildProcessDirectory | null = null;
  let scratchObjectsCapability: RetainedNoFollowChildProcessDirectory | null = null;
  let scratchIndexCapability: RetainedNoFollowOrdinaryFile | null = null;
  let repositoryIndexCapability: RetainedNoFollowOrdinaryFile | null = null;
  try {
    const scratchChain = inspectNoFollowDirectoryChain(scratchRoot, 'Git scratch root');
    const scratchIndexEntry = inspectNoFollowOrdinaryFileEntry(scratchChain.target, 'index');
    if (scratchIndexEntry === null || scratchIndexEntry.kind !== 'file') {
      throw new Error('Git scratch index is absent or not an ordinary file.');
    }
    const scratchObjectsChain = inspectNoFollowDirectoryChain(
      path.join(scratchRoot, 'objects'),
      'Git scratch object directory'
    );
    const repositoryObjectsChain = inspectNoFollowDirectoryChain(
      canonicalRepositoryObjects,
      'Git repository object directory'
    );
    const repositoryIndexParent = inspectNoFollowDirectoryChain(
      path.dirname(canonicalRepositoryIndex),
      'Git repository index parent'
    );
    const repositoryIndexEntry = inspectNoFollowOrdinaryFileEntry(
      repositoryIndexParent.target,
      path.basename(canonicalRepositoryIndex)
    );
    if (repositoryIndexEntry === null || repositoryIndexEntry.kind !== 'file') {
      throw new Error('Git repository index is absent or not an ordinary file.');
    }
    const retainedRepositoryObjectsCapability = retainNoFollowDirectoryForChildProcess(
      repositoryObjectsChain,
      5,
      'Git repository object directory'
    );
    repositoryObjectsCapability = retainedRepositoryObjectsCapability;
    const retainedScratchObjectsCapability = retainNoFollowDirectoryForChildProcess(
      scratchObjectsChain,
      6,
      'Git scratch object directory'
    );
    scratchObjectsCapability = retainedScratchObjectsCapability;
    const scratchIndexPath = path.join(scratchRoot, scratchIndexEntry.relativePath);
    const retainScratchIndex = (): RetainedNoFollowOrdinaryFile => {
      const currentEntry = inspectNoFollowOrdinaryFileEntry(scratchChain.target, 'index');
      if (currentEntry === null || currentEntry.kind !== 'file') {
        throw new Error('Git scratch index is absent or not an ordinary file.');
      }
      return retainNoFollowOrdinaryFile(
        scratchChain,
        currentEntry.relativePath,
        { device: currentEntry.device, inode: currentEntry.inode },
        'Git scratch index',
        7
      );
    };
    scratchIndexCapability = retainScratchIndex();
    const retainedRepositoryIndexCapability = retainNoFollowOrdinaryFile(
      repositoryIndexParent,
      path.basename(canonicalRepositoryIndex),
      { device: repositoryIndexEntry.device, inode: repositoryIndexEntry.inode },
      'Git repository index fence',
      8
    );
    repositoryIndexCapability = retainedRepositoryIndexCapability;
    const auxiliaryInputs = (): readonly RetainedCommandAuxiliaryInput[] => Object.freeze([
      Object.freeze({ kind: 'directory' as const, capability: retainedRepositoryObjectsCapability }),
      Object.freeze({ kind: 'directory' as const, capability: retainedScratchObjectsCapability }),
      ...(scratchIndexCapability === null ? [] : [Object.freeze({
        kind: 'ordinary-file' as const,
        capability: scratchIndexCapability
      })])
    ]);
    const environment = (): Readonly<Record<string, string>> => Object.freeze(isolatedGitReadEnvironment({
      GIT_INDEX_FILE: scratchIndexCapability?.childPath ?? scratchIndexPath,
      GIT_OBJECT_DIRECTORY: retainedScratchObjectsCapability.childPath,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: retainedRepositoryObjectsCapability.childPath
    }, input.gitReadSession.env));
    let closed = false;
    let terminalFailure: GitScratchIndexTreeFailureReason | null = null;
    const unavailable = <T>(
      reason: GitScratchIndexTreeFailureReason,
      detail?: string
    ): GitScratchIndexTreeResult<T> => {
      terminalFailure ??= reason;
      return Object.freeze({
        status: 'unavailable',
        reason: terminalFailure,
        ...(detail === undefined ? {} : { detail })
      });
    };
    const assertCurrent = (): boolean => {
      if (closed) {
        terminalFailure ??= 'closed';
        return false;
      }
      const observations = Object.freeze([
        Object.freeze({
          capability: retainedRepositoryObjectsCapability,
          failure: 'repository-object-directory-changed' as const
        }),
        Object.freeze({
          capability: retainedScratchObjectsCapability,
          failure: 'scratch-object-directory-changed' as const
        }),
        ...(scratchIndexCapability === null ? [] : [Object.freeze({
          capability: scratchIndexCapability,
          failure: 'scratch-index-changed' as const
        })]),
        Object.freeze({
          capability: retainedRepositoryIndexCapability,
          failure: 'repository-index-changed' as const
        })
      ]);
      for (const observation of observations) {
        try {
          observation.capability.assertCurrent();
        } catch {
          terminalFailure ??= observation.failure;
          return false;
        }
      }
      return true;
    };
    const runWithInput = async (
      args: readonly string[],
      commandEnvironment: Readonly<Record<string, string>>,
      commandInput?: Uint8Array
    ): Promise<GitReadSessionCommand | null> => {
      if (!assertCurrent()) return null;
      const result = await executionOwner.run(args, commandEnvironment, auxiliaryInputs(), commandInput);
      if (!assertCurrent()) return null;
      return result;
    };
    const run = (args: readonly string[]): Promise<GitReadSessionCommand | null> =>
      runWithInput(args, environment());
    const applyIndexDelta = async (
      input: GitScratchIndexTreeDelta
    ): Promise<GitScratchIndexTreeResult<string>> => {
      if (terminalFailure !== null) return unavailable(terminalFailure);
      if (!Array.isArray(input.additions) || !Array.isArray(input.removals)) {
        return unavailable('session-failed', 'Git scratch index delta must contain additions and removals arrays.');
      }
      const seenPaths = new Set<string>();
      const validatePath = (value: unknown): value is string => {
        if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
            || value.includes('\\') || value.startsWith('/') || value.startsWith('../')
            || value.includes('/../') || value === '..' || value.startsWith('./')
            || value.includes('/./')) return false;
        if (seenPaths.has(value)) return false;
        seenPaths.add(value);
        return true;
      };
      for (const addition of input.additions) {
        if (addition === null || typeof addition !== 'object'
            || !validatePath(addition.path) || !(addition.bytes instanceof Uint8Array)) {
          return unavailable('session-failed', 'Git scratch index delta contains an invalid addition.');
        }
      }
      for (const removal of input.removals) {
        if (!validatePath(removal)) {
          return unavailable('session-failed', 'Git scratch index delta contains an invalid removal.');
        }
      }
      const indexUpdates: string[] = [];
      for (const addition of input.additions) {
        const command = await runWithInput(
          Object.freeze(['hash-object', '-w', '--stdin']),
          environment(),
          Buffer.from(addition.bytes)
        );
        if (command === null || command.kind !== 'completed' || command.result.code !== 0) {
          return unavailable(
            terminalFailure ?? 'session-failed',
            command === null
              ? 'Git scratch blob materialization returned no result.'
              : command.kind === 'completed'
                ? command.result.stderr.trim() || `Git scratch blob materialization exited ${command.result.code}.`
                : command.detail
          );
        }
        const objectId = Buffer.from(command.result.stdout).toString('utf8').trim();
        const expectedLength = objectFormat === 'sha1' ? 40 : 64;
        if (!new RegExp(`^[0-9a-f]{${expectedLength}}$`, 'u').test(objectId)) {
          return unavailable('session-failed', 'Git scratch blob materialization returned an invalid object id.');
        }
        indexUpdates.push(`100644 ${objectId}\t${addition.path}\0`);
      }
      if (indexUpdates.length > 0) {
        const previousScratchIndex = scratchIndexCapability;
        scratchIndexCapability = null;
        try { previousScratchIndex?.dispose(); } catch { /* preserve the command result */ }
        const command = await runWithInput(
          Object.freeze(['update-index', '-z', '--index-info']),
          environment(),
          Buffer.from(indexUpdates.join(''), 'utf8')
        );
        try {
          scratchIndexCapability = retainScratchIndex();
        } catch (error) {
          return unavailable(
            terminalFailure ?? 'scratch-index-changed',
            error instanceof Error ? error.message : String(error)
          );
        }
        if (command === null || command.kind !== 'completed' || command.result.code !== 0) {
          return unavailable(
            terminalFailure ?? 'session-failed',
            command === null
              ? 'Git scratch index update returned no result.'
              : command.kind === 'completed'
                ? command.result.stderr.trim() || `Git scratch index update exited ${command.result.code}.`
                : command.detail
          );
        }
      }
      if (input.removals.length > 0) {
        const previousScratchIndex = scratchIndexCapability;
        scratchIndexCapability = null;
        try { previousScratchIndex?.dispose(); } catch { /* preserve the command result */ }
        const command = await runWithInput(
          Object.freeze(['update-index', '--remove', '-z', '--stdin']),
          environment(),
          Buffer.from(`${input.removals.join('\0')}\0`, 'utf8')
        );
        try {
          scratchIndexCapability = retainScratchIndex();
        } catch (error) {
          return unavailable(
            terminalFailure ?? 'scratch-index-changed',
            error instanceof Error ? error.message : String(error)
          );
        }
        if (command === null || command.kind !== 'completed' || command.result.code !== 0) {
          return unavailable(
            terminalFailure ?? 'session-failed',
            command === null
              ? 'Git scratch index removal returned no result.'
              : command.kind === 'completed'
                ? command.result.stderr.trim() || `Git scratch index removal exited ${command.result.code}.`
                : command.detail
          );
        }
      }
      return scratchSession.writeTree();
    };
    const scratchSession: GitScratchIndexTreeSession = Object.freeze({
      scratchRoot,
      objectFormat,
      applyIndexDelta,
      async writeTree(): Promise<GitScratchIndexTreeResult<string>> {
        if (terminalFailure !== null) return unavailable(terminalFailure);
        const command = await run(Object.freeze(['write-tree']));
        if (command === null || command.kind !== 'completed' || command.result.code !== 0) {
          return unavailable(terminalFailure ?? 'session-failed');
        }
        const value = Buffer.from(command.result.stdout).toString('utf8').trim();
        const expectedLength = objectFormat === 'sha1' ? 40 : 64;
        if (!new RegExp(`^[0-9a-f]{${expectedLength}}$`, 'u').test(value)) {
          return unavailable('session-failed');
        }
        return Object.freeze({ status: 'ready', value });
      },
      async commitTree(commitInput: GitCommitTreeInput): Promise<GitScratchIndexTreeResult<string>> {
        if (terminalFailure !== null) return unavailable(terminalFailure);
        const canonical = canonicalCommitTreeInput(commitInput);
        if (canonical === null) return unavailable('session-failed');
        const args = Object.freeze([
          'commit-tree', canonical.tree,
          ...canonical.parents.flatMap((parent) => ['-p', parent])
        ]);
        const command = await runWithInput(
          args,
          commitEnvironment(canonical, environment()),
          Buffer.from(canonical.message, 'utf8')
        );
        if (command === null || command.kind !== 'completed' || command.result.code !== 0) {
          const detail = command === null
            ? `provider=null; session=${input.gitReadSession.failure?.reason ?? 'none'}`
            : command.kind === 'completed'
              ? `exit=${command.result.code}; stderr=${command.result.stderr.trim() || '<empty>'}; session=${input.gitReadSession.failure?.reason ?? 'none'}`
              : `provider=${command.reason}; detail=${command.detail}; session=${input.gitReadSession.failure?.reason ?? 'none'}`;
          return unavailable(terminalFailure ?? 'session-failed', detail);
        }
        const value = Buffer.from(command.result.stdout).toString('utf8').trim();
        const expectedLength = objectFormat === 'sha1' ? 40 : 64;
        if (!new RegExp(`^[0-9a-f]{${expectedLength}}$`, 'u').test(value)) {
          return unavailable('session-failed');
        }
        return Object.freeze({ status: 'ready', value });
      },
      async observe(args: readonly string[]): Promise<GitScratchIndexTreeResult<ByteCommandResult>> {
        if (terminalFailure !== null) return unavailable(terminalFailure);
        if (!gitReadCommandIsObservation(args)) {
          return unavailable('session-failed');
        }
        const result = await run(Object.freeze([...args]));
        if (result === null) return unavailable(terminalFailure ?? 'session-failed');
        if (result.kind !== 'completed') {
          return unavailable('session-failed');
        }
        return Object.freeze({ status: 'ready', value: result.result });
      },
      async close(): Promise<GitScratchIndexTreeFailureReason | null> {
        if (closed) return terminalFailure;
        assertCurrent();
        const failures: unknown[] = [];
        for (const capability of [
          retainedRepositoryIndexCapability,
          scratchIndexCapability,
          retainedScratchObjectsCapability,
          retainedRepositoryObjectsCapability
        ]) {
          try { capability?.dispose(); } catch (error) { failures.push(error); }
        }
        closed = true;
        if (failures.length > 0) {
          terminalFailure ??= 'scratch-identity-changed';
        }
        return terminalFailure;
      }
    });
    return Object.freeze({ status: 'ready', session: scratchSession });
  } catch (error) {
    for (const capability of [
      repositoryIndexCapability,
      scratchIndexCapability,
      scratchObjectsCapability,
      repositoryObjectsCapability
    ]) {
      try { capability?.dispose(); } catch { /* preserve the primary admission error */ }
    }
    return Object.freeze({
      status: 'unavailable',
      reason: error instanceof PhysicalNoFollowError
        ? 'retained-provider-unavailable'
        : 'invalid-scratch-layout'
    });
  }
}

/**
 * Materializes exactly one precomputed development commit object. The caller
 * cannot select argv, enable signing/hooks, or change the retained provider.
 * Ref mutation is deliberately a separate CAS step so the domain owner can
 * durably record the object before the only externally-visible transition.
 */
export async function materializeAuthorityDevelopmentCommitObject(input: Readonly<{
  readonly gitReadSession: GitReadSession;
  readonly contract: GitDevelopmentCommitContract;
}>): Promise<GitDevelopmentCommitEffectResult> {
  const owner = authorizedDevelopmentCommitOwner(input.gitReadSession, input.contract);
  if (owner === null) {
    return Object.freeze({ status: 'unavailable', reason: 'operation-not-authorized' });
  }
  if (path.resolve(input.gitReadSession.cwd) !== input.contract.worktreeRoot) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-contract' });
  }
  const environment = commitEnvironment(input.contract, input.gitReadSession.env);
  const tree = await owner.run(Object.freeze(['write-tree']), environment);
  if (tree.kind !== 'completed' || tree.result.code !== 0) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'provider-failed',
      detail: tree.kind === 'completed'
        ? `write-tree exit=${tree.result.code}; stderr=${tree.result.stderr.trim() || '<empty>'}`
        : `write-tree provider=${tree.reason}; detail=${tree.detail}`
    });
  }
  const observedTree = Buffer.from(tree.result.stdout).toString('utf8').trim();
  if (observedTree !== input.contract.tree) {
    return Object.freeze({ status: 'unavailable', reason: 'index-drift' });
  }
  const commit = await owner.run(
    Object.freeze([
      'commit-tree', input.contract.tree,
      ...input.contract.parents.flatMap((parent) => ['-p', parent])
    ]),
    environment,
    Buffer.from(input.contract.message, 'utf8')
  );
  if (commit.kind !== 'completed' || commit.result.code !== 0) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'provider-failed',
      detail: commit.kind === 'completed'
        ? `commit-tree exit=${commit.result.code}; stderr=${commit.result.stderr.trim() || '<empty>'}`
        : `commit-tree provider=${commit.reason}; detail=${commit.detail}`
    });
  }
  const object = Buffer.from(commit.result.stdout).toString('utf8').trim();
  if (object !== input.contract.target) {
    return Object.freeze({ status: 'unavailable', reason: 'target-mismatch' });
  }
  return Object.freeze({ status: 'completed', object });
}

/** Git owns its provider binding and settlement, but never the grant or attempt lineage. */
export function bindGitDevelopmentCommitOperation(input: Readonly<{
  intent: SecSemanticOperationIntent;
  attempt: SecSemanticOperationAttemptContext;
  providerIdentityDigest: SecOperationDigest;
  deadlineAtUnixMs: number;
}>): SecBoundSemanticOperation {
  const plan = compileSecSemanticOperationPlan({
    operation: input.intent.identity.operation,
    intentDigest: input.intent.identity.intentDigest,
    decisionDigest: input.intent.identity.decisionDigest,
    aggregateBudgets: input.intent.execution.aggregateBudgets,
    requirements: input.intent.execution.requirements,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: input.attempt
  });
  return bindSecSemanticOperation(plan, plan.execution.requirements.map((requirement) =>
    compileSecCapabilityBinding({
      requirementId: requirement.id,
      contractDigest: requirement.contractDigest,
      providerIdentityDigest: input.providerIdentityDigest
    })));
}

export function settleGitDevelopmentCommitOperation(
  operation: SecBoundSemanticOperation,
  result: GitDevelopmentCommitEffectResult
): SecProviderSettlementReceipt {
  return issueSecProviderSettlementReceipt(operation, {
    requirementId: 'repository.commit',
    physicalDisposition: result.status === 'completed' ? 'settled' : 'unknown',
    providerSettlementReferenceDigest: sha256(result) as SecOperationDigest
  });
}

/** Exact `update-ref <new> <old>` CAS for the already-materialized object. */
export async function compareAndSwapAuthorityDevelopmentCommitRef(input: Readonly<{
  readonly gitReadSession: GitReadSession;
  readonly contract: GitDevelopmentCommitContract;
}>): Promise<GitDevelopmentCommitEffectResult> {
  const owner = authorizedDevelopmentCommitOwner(input.gitReadSession, input.contract);
  if (owner === null) {
    return Object.freeze({ status: 'unavailable', reason: 'operation-not-authorized' });
  }
  if (path.resolve(input.gitReadSession.cwd) !== input.contract.worktreeRoot) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-contract' });
  }
  const update = await owner.run(Object.freeze([
    'update-ref', '--create-reflog', '-m', 'development.commit',
    input.contract.ref, input.contract.target, input.contract.expectedOld
  ]), input.gitReadSession.env);
  if (update.kind !== 'completed') {
    return Object.freeze({
      status: 'unavailable',
      reason: 'provider-failed',
      detail: `update-ref provider=${update.reason}; detail=${update.detail}`
    });
  }
  return update.result.code === 0
    ? Object.freeze({ status: 'completed', object: input.contract.target })
    : Object.freeze({ status: 'cas-conflict', object: input.contract.target });
}

/**
 * Explicit test-only host route.  Production affected-plan callers must use
 * createAuthorityGitReadSession; this factory exists solely for unit tests
 * that exercise the host transport on a Windows development machine without
 * pretending that PATH Git is the Windows authority provider.
 */
export function createHostGitReadSessionForTests(input: Readonly<{
  cwd: string;
  environment?: Readonly<Record<string, string | undefined>>;
  budget?: Partial<GitReadSessionBudget>;
  source?: NodeJS.ProcessEnv;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>): GitReadSession {
  return createHostGitReadSession({ ...input, origin: 'test' });
}
