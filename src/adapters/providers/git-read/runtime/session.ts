import { lstatSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';
import { snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import { failureMessage } from '../../../../contracts/failure-inspection.ts';
import { settleResources as settlePhysicalResources, type ResourceSettlementFailure as PhysicalResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { parseGitLineReply, parseGitObjectIdReply } from '../../../runtime-state/physical/contract/git-worktree-observation.ts';
import { GIT_INDEX_PLANNING_BUDGET_CEILING, boundedGitReadDeadlineAt, resolveGitReadSessionBudget, type GitReadSessionBudget } from './budget.ts';
import {
  canonicalCommitTreeInput, captureGitDevelopmentCommitContract, compileGitDevelopmentCommitContractDigest, gitCommitEnvironment,
  type GitCommitTreeInput, type GitDevelopmentCommitContract, type GitDevelopmentCommitEffectResult
} from './commit-contract.ts';
import { captureGitReadArguments, gitReadCommandIsObservation } from './read-command.ts';
import {
  applyGitIndexObjectDelta, assertGitIndexObjectInfoBatch, assertGitIndexTreeGeneration,
  decodeGitIndexGeneration, encodeGitIndexGeneration, type GitIndexGeneration
} from './scratch-index-generation.ts';
import { captureGitScratchIndexDelta, formatGitScratchIndexRecord, type GitScratchIndexTreeDelta } from './scratch-input.ts';
export { GIT_READ_DEFAULT_OPERATION_BUDGET, GIT_READ_EXACT_TREE_OPERATION_BUDGET, resolveGitReadSessionBudget } from './budget.ts';
export type { GitReadSessionBudget } from './budget.ts';
export { compileGitDevelopmentCommitContractDigest } from './commit-contract.ts';
export type { GitCommitIdentity, GitDevelopmentCommitContract, GitDevelopmentCommitEffectResult } from './commit-contract.ts';
;

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest,
  type ProviderSettlementReceipt,
  type SemanticOperationAttemptContext,
  type SemanticOperationIntent
} from '../../../../execution/operation/semantic.ts';
import { PhysicalNoFollowError, assertSameNoFollowDirectoryIdentity, createExclusiveNoFollowDirectory, createExclusiveNoFollowRandomDirectory, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, retainNoFollowDirectoryForChildProcess, retainNoFollowFileTransaction, retainNoFollowOrdinaryFile, retainedNoFollowOrdinaryFileMtimeForInternal, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity, type RetainedNoFollowChildProcessDirectory, type RetainedNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession, type ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, RetainedCommandTransportError, resolveExecutableLocator, type ByteCommandResult } from '../../../runtime-state/physical/runtime/process.ts';
import type { RetainedCommandAuxiliaryInput } from '../../../runtime-state/physical/runtime/retained-command-boundary.ts';
import { canonicalGitChildEnvironment, gitEnvironmentValue } from '../../git/environment.ts';
import {
  assertGitPhysicalProviderBindingInternal,
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

type GitReadProviderFailure = Readonly<{
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

type GitReadSessionRunOptions = Readonly<{
  readonly input?: Uint8Array;
}>;

export type GitReadSessionReceipt = Readonly<{
  readonly operationIdentityDigest: OperationDigest | null;
  readonly boundAttemptDigest: OperationDigest | null;
  readonly requirementId: string | null;
  readonly providerIdentityDigest: OperationDigest | null;
  readonly processSessionOwnership: 'owned' | 'borrowed';
  readonly processCount: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly failureDetailDigest: `sha256:${string}` | null;
  readonly receiptDigest: OperationDigest;
}>;

const ISSUED_GIT_READ_SESSION_RECEIPTS = new WeakSet<object>();

export function assertGitReadSessionReceipt(
  receipt: GitReadSessionReceipt,
  expected?: Readonly<{
    operationIdentityDigest: OperationDigest;
    boundAttemptDigest: OperationDigest;
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
type GitExecutableIdentity = Readonly<{
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

type GitReadProviderIdentity = Readonly<{
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
  /** Conservative live native capacity; never an Effect grant or terminal receipt field. */
  observeNativeResourceCapacity(): Readonly<{
    remaining: number;
    admitted: number;
    root: number;
    stdinWorker: number;
    helper: number;
  }> | null;
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

type GitScratchIndexTreeResult<T> = Readonly<
  { status: 'ready'; value: T } |
  { status: 'unavailable'; reason: GitScratchIndexTreeFailureReason; detail?: string }
>;

/**
 * Narrow Git effect capability for computing a tree from one immutable
 * retained index generation. The input index stays read-only; native Git owns
 * an extension-free disposable index leaf under the retained scratch parent.
 * SEC validates the exact resulting entries and native object types through
 * fixed hash-object/update-index/write-tree
 * effects. It intentionally exposes no generic argv, config, ref, or
 * repository-write surface.
 */
export type GitScratchIndexTreeSession = Readonly<{
  readonly scratchRoot: string;
  readonly objectFormat: 'sha1' | 'sha256';
  applyIndexDelta(input: GitScratchIndexTreeDelta): Promise<GitScratchIndexTreeResult<string>>;
  /**
   * Materialize the typed delta into the retained repository object store and
   * return the resulting tree.  This is the only production path that may
   * persist the precomputed Git objects needed by a later index CAS; callers
   * cannot select a repository, argv, or object directory.
   */
  materializeIndexDelta(input: GitScratchIndexTreeDelta): Promise<GitScratchIndexTreeResult<string>>;
  /** Exact binary index generation corresponding to the current logical scratch state. */
  indexBytes(): GitScratchIndexTreeResult<Uint8Array>;
  writeTree(): Promise<GitScratchIndexTreeResult<string>>;
  commitTree(input: GitCommitTreeInput): Promise<GitScratchIndexTreeResult<string>>;
  observe(args: readonly string[]): Promise<GitScratchIndexTreeResult<ByteCommandResult>>;
  close(): Promise<GitScratchIndexTreeFailureReason | null>;
}>;

export type GitScratchIndexTreeResolution =
  | Readonly<{ readonly status: 'ready'; readonly session: GitScratchIndexTreeSession }>
  | Readonly<{ readonly status: 'unavailable'; readonly reason: GitScratchIndexTreeFailureReason }>;

type GitScratchExecutionOwner = Readonly<{
  readonly operation: BoundSemanticOperation | null;
  readonly signal: AbortSignal;
  readonly deadlineAtMonotonicMs: number;
  /** Conservative root-command capacity, not a reservation or a new grant. */
  remainingRootProcesses(): number;
  /** Native capacity also charges Windows stdin workers and termination helpers. */
  remainingNativeResources(): number;
  remainingInputBytes(): number;
  remainingOutputBytes(): number;
  remainingRecords(): number;
  remainingObservedBytes(): number;
  chargeObservedBytes(bytes: number): void;
  run(
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[],
    input?: Uint8Array
  ): Promise<GitReadSessionCommand>;
}>;

const GIT_SCRATCH_EXECUTION_OWNERS = new WeakMap<object, GitScratchExecutionOwner>();

type GitDevelopmentCommitExecutionOwner = Readonly<{
  readonly operation: BoundSemanticOperation;
  readonly providerIdentityDigest: OperationDigest;
  run(
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    input?: Uint8Array
  ): Promise<GitReadSessionCommand>;
}>;

const GIT_DEVELOPMENT_COMMIT_EXECUTION_OWNERS = new WeakMap<object, GitDevelopmentCommitExecutionOwner>();

function authorizedDevelopmentCommitOwner(
  session: GitReadSession,
  contract: GitDevelopmentCommitContract
): GitDevelopmentCommitExecutionOwner | null {
  const owner = GIT_DEVELOPMENT_COMMIT_EXECUTION_OWNERS.get(session);
  if (owner === undefined || !isProductionGitReadSession(session)) return null;
  let contractDigest: OperationDigest;
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
const GIT_READ_PHYSICAL_PROVIDER_TRANSFERS = new WeakMap<object, () => GitPhysicalProviderCapability>();

/** @internal Transfer an admitted session's existing physical resource to its operation owner. */
export function retainGitReadPhysicalProviderInternal(session: GitReadSession): GitPhysicalProviderCapability {
  const transfer = GIT_READ_PHYSICAL_PROVIDER_TRANSFERS.get(session);
  if (transfer === undefined || !isProductionGitReadSession(session)) {
    throw new Error('Git physical ownership transfer requires one live production owner.');
  }
  const provider = transfer();
  GIT_READ_PHYSICAL_PROVIDER_TRANSFERS.delete(session);
  return provider;
}

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

type GitExecutableInspection = Readonly<{
  identity: GitExecutableIdentity;
  bytes: number;
}>;

type GitExecutableInspectionResult =
  | GitExecutableInspection
  | Readonly<{ kind: 'unavailable'; reason: 'deadline' | 'budget' | 'identity'; settlementFailure?: PhysicalResourceSettlementFailure }>;

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
  let retained: RetainedNoFollowOrdinaryFile | undefined;
  let primary: PhysicalResourceSettlementFailure | undefined;
  let observation: GitExecutableInspectionResult = { kind: 'unavailable', reason: 'identity' };
  try {
    const executablePath = path.resolve(executable), leafName = path.basename(executablePath);
    const parent = inspectNoFollowDirectoryChain(path.dirname(executablePath), 'Git executable parent');
    if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
    retained = retainNoFollowOrdinaryFile(parent, leafName, undefined, 'Git executable observation');
    // The same retained file supplies size, bytes and identity. A tiny caller
    // budget is checked before hashing; siblings and descendants are unrelated.
    if (!Number.isSafeInteger(retained.size) || retained.size < 0 || retained.size > input.maxBytes) {
      observation = { kind: 'unavailable', reason: 'budget' };
    } else if (performance.now() > input.deadlineAtMs) {
      observation = { kind: 'unavailable', reason: 'deadline' };
    } else {
      const digest = retained.digest();
      retained.assertCurrent();
      if (performance.now() > input.deadlineAtMs) observation = { kind: 'unavailable', reason: 'deadline' };
      else if (digest.size !== retained.size || digest.size > input.maxBytes) observation = { kind: 'unavailable', reason: 'budget' };
      else observation = Object.freeze({ identity: Object.freeze({
        path: executablePath, realPath: path.join(parent.target.finalPath, leafName),
        device: retained.physical.device, inode: retained.physical.inode, size: digest.size,
        mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0, digest: digest.byteDigest,
        ancestorChain: Object.freeze(parent.ancestors.map(executableAncestor))
      }), bytes: digest.size });
    }
  } catch (error) { primary = { label: 'git-executable-observation', error }; }
  try {
    settlePhysicalResources({ primary, cleanup: retained === undefined ? [] : [{
      label: 'git-executable-observation-release', settle: () => retained!.dispose()
    }] });
  } catch (error) {
    if (primary === undefined || !Object.is(primary.error, error)) {
      // The enclosing admission also settles its owned process session, then
      // propagates this original cleanup failure instead of publishing a ready
      // provider or losing the raw cause in an identity-unavailable string.
      return { kind: 'unavailable', reason: 'identity', settlementFailure: {
        label: 'git-executable-observation-settlement', error
      } };
    }
    return { kind: 'unavailable', reason: performance.now() > input.deadlineAtMs ? 'deadline' : 'identity' };
  }
  return observation;
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
      operation: BoundSemanticOperation;
      /** Optional caller-owned parent process ledger; Git borrows but never closes it. */
      processSession?: ProcessResourceSession;
      /** Internal operation-owned resource; borrowing never conveys close authority. */
      physicalProvider?: GitPhysicalProviderCapability;
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
}) as OperationDigest;
const TEST_GIT_READ_PROCESS_PROVIDER = sha256({
  provider: 'external-capabilities.git-read.test-host-process'
}) as OperationDigest;

function issueTestGitReadProcessOperation(
  input: GitReadHostSessionCommonInput,
  budget: GitReadSessionBudget
): BoundSemanticOperation {
  const startedAt = Date.now();
  const deadlineAtUnixMs = Math.min(
    input.deadlineAtUnixMs ?? startedAt + budget.deadlineMs,
    startedAt + budget.deadlineMs
  );
  const durationMs = deadlineAtUnixMs - startedAt;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new Error('Test Git read process operation deadline is exhausted.');
  }
  const plan = compileSemanticOperationPlan({
    operation: 'external-capabilities.git-read.test-host-observe',
    intentDigest: sha256({ cwd: input.cwd, budget }) as OperationDigest,
    decisionDigest: TEST_GIT_READ_PROCESS_CONTRACT,
    deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
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
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: TEST_GIT_READ_PROCESS_REQUIREMENT,
    contractDigest: TEST_GIT_READ_PROCESS_CONTRACT,
    providerIdentityDigest: TEST_GIT_READ_PROCESS_PROVIDER
  })]);
}

function semanticOperationBudget(
  operation: BoundSemanticOperation | undefined,
  resource: 'input-bytes' | 'output-bytes' | 'processes' | 'records'
): number | null {
  return operation?.plan.execution.aggregateBudgets
    .find((candidate) => candidate.resource === resource)?.maximum ?? null;
}

function createHostGitReadSession(input: GitReadHostSessionInput): GitReadSession {
  const startedAt = Date.now();
  const startedMonotonicAt = performance.now();
  const budget = resolveGitReadSessionBudget(input.budget);
  const nativeProcessLimit = budget.maxProcesses;
  const workingDirectoryPath = path.resolve(input.cwd);
  const requestedDeadlineAt = boundedGitReadDeadlineAt(startedAt, budget, input.deadlineAtUnixMs);
  const env = Object.freeze(isolatedGitReadEnvironment(input.environment ?? {}, input.source));
  let processResourceSession: ProcessResourceSession | null = null;
  let processOperation: BoundSemanticOperation | null = null;
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
        requirementBindingContext: issueOperationRequirementBindingContext({
          operation: processOperation,
          requirementId: processRequirementId,
          resourceCeilings: processOperation.plan.execution.aggregateBudgets.filter(({ resource }) => (
            resource === 'duration-ms'
            || resource === 'input-bytes'
            || resource === 'output-bytes'
            || resource === 'processes'
          )).map(ceiling => ceiling.resource === 'processes'
            ? { ...ceiling, maximum: Math.min(ceiling.maximum, nativeProcessLimit) } : ceiling)
        }),
        signal: input.signal
      });
    }
  } catch (error) {
    operationAdmissionFailure = failureMessage(error);
  }
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
  // Phase owners supply their cumulative local remainder. A physical process
  // parent exposes no independent record-used counter; honor its declared
  // ceiling without claiming to observe consumption by other consumers.
  const recordLimit = Math.min(budget.maxRecords,
    semanticOperationBudget(processOperation ?? undefined, 'records') ?? budget.maxRecords);
  const processCountAtStart = processResourceSession?.processCount ?? 0;
  const nativeCapacityAtStart = processResourceSession?.observeNativeResourceCapacity().remaining ?? 0;
  const processInputBytesAtStart = processResourceSession?.inputBytes ?? 0;
  const processOutputBytesAtStart = processResourceSession?.outputBytes ?? 0;
  const deadlineAt = Math.min(requestedDeadlineAt,
    processResourceSession?.deadlineAtUnixMs ?? Number.MAX_SAFE_INTEGER);
  const deadlineMonotonicAt = startedMonotonicAt + Math.max(0, deadlineAt - startedAt);
  let admissionCancelled = input.signal?.aborted === true;
  let admissionDeadlineExpired = Date.now() >= deadlineAt
    || performance.now() >= deadlineMonotonicAt;
  let workingDirectoryIdentity: PhysicalDirectoryChain | null = null;
  let workingDirectoryObservationFailure: string | null = null;
  if (!operationAdmissionUnavailable && !admissionCancelled && !admissionDeadlineExpired) {
    try {
      workingDirectoryIdentity = inspectNoFollowDirectoryChain(
        workingDirectoryPath,
        'Git read working directory'
      );
    } catch (error) {
      workingDirectoryObservationFailure = failureMessage(error);
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
  const borrowedPhysicalProvider = input.origin === 'production' ? input.physicalProvider : undefined;
  let ownsGitPhysicalProvider = borrowedPhysicalProvider === undefined;
  let gitPhysicalProvider: GitPhysicalProviderCapability | null = null;
  let retainedAdmissionFailure: string | null = null;
  let gitExecutable: string | null = null;
  let executableDiscoveryFailure: string | null = null;
  if (!operationAdmissionUnavailable && !admissionCancelled && !admissionDeadlineExpired && workingDirectoryIdentity !== null) {
    try {
      if (borrowedPhysicalProvider !== undefined) {
        if (processOperation === null || processResourceSession === null) {
          throw new Error('Borrowed Git provider requires its live process operation.');
        }
        assertGitPhysicalProviderBindingInternal(borrowedPhysicalProvider, {
          operation: processOperation, processSession: processResourceSession,
          cwd: workingDirectoryPath, environment: env
        });
        gitPhysicalProvider = borrowedPhysicalProvider;
        gitExecutable = borrowedPhysicalProvider.identity.executablePath;
      } else {
        gitExecutable = resolveExecutableLocator('git', {
          pathValue: gitEnvironmentValue(env, 'PATH') ?? '', cwd: workingDirectoryPath
        });
      }
    } catch (error) { executableDiscoveryFailure = failureMessage(error); }
  }

  if (!admissionCancelled && !admissionDeadlineExpired && (
    Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt
  )) {
    admissionDeadlineExpired = true;
  }
  admissionCancelled ||= input.signal?.aborted === true;
  const initialExecutableObservation = operationAdmissionUnavailable || admissionCancelled
      || admissionDeadlineExpired || gitExecutable === null
    ? null
    : borrowedPhysicalProvider === undefined
      ? inspectGitExecutable(gitExecutable, {
          deadlineAtMs: deadlineMonotonicAt,
          maxBytes: budget.maxExecutableBytes
        })
      : (() => {
          try {
            const retained = borrowedPhysicalProvider.identity;
            const parent = inspectNoFollowDirectoryChain(path.dirname(gitExecutable), 'Borrowed Git executable parent');
            assertGitPhysicalProviderCurrentInternal(borrowedPhysicalProvider);
            return Object.freeze({ identity: Object.freeze({
              path: gitExecutable, realPath: path.join(parent.target.finalPath, path.basename(gitExecutable)),
              device: retained.executablePhysical.device, inode: retained.executablePhysical.inode,
              size: retained.executableSize, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
              digest: retained.executableDigest,
              ancestorChain: Object.freeze(parent.ancestors.map(executableAncestor))
            }), bytes: 0 });
          } catch {
            return { kind: 'unavailable', reason: 'identity' } as const;
          }
        })();
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
  if (borrowedPhysicalProvider === undefined && !operationAdmissionUnavailable
      && !admissionCancelled
      && !admissionDeadlineExpired
      && workingDirectoryIdentity !== null
      && physicalDirectoryChainObservedBytes(workingDirectoryIdentity) <= budget.maxRootObservedBytes
      && gitExecutable !== null
      && gitExecutableIdentity !== null
      && processOperation !== null
      && processResourceSession !== null) {
    try {
      const resolution = openGitPhysicalProvider({
        cwd: workingDirectoryIdentity.target.path,
        executablePath: gitExecutable, operation: processOperation,
        processSession: processResourceSession, environment: env, environmentSource: {},
        maximumExecutableBytes: budget.maxExecutableBytes
      });
      if (resolution.status === 'ready') {
        gitPhysicalProvider = resolution.capability;
        const physical = resolution.capability.identity.executablePhysical;
        if (physical.device !== gitExecutableIdentity.device || physical.inode !== gitExecutableIdentity.inode
            || resolution.capability.identity.executableSize !== gitExecutableIdentity.size
            || resolution.capability.identity.executableDigest !== gitExecutableIdentity.digest) {
          retainedAdmissionFailure = 'Git executable identity changed before shared provider retention.';
        }
      } else {
        retainedAdmissionFailure = `Git physical provider admission failed: ${resolution.reason}.`;
      }
    } catch (error) { retainedAdmissionFailure = failureMessage(error); }
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
        + (executableDiscoveryFailure === null ? '' : ` ${executableDiscoveryFailure}`)
    });
  } else if (gitExecutableIdentity === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: initialExecutableObservation !== null && 'reason' in initialExecutableObservation
          && initialExecutableObservation.reason === 'budget'
        ? 'executable-budget-exhausted' : 'command-error',
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
  } else if (gitPhysicalProvider === null || retainedAdmissionFailure !== null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'retained-provider-unavailable',
      detail: `The ${process.platform} Git executable and working directory could not be retained.`
        + (retainedAdmissionFailure === null ? '' : ` ${retainedAdmissionFailure}`)
    });
  }

  const settleOwnedResources = (checkBorrowed: boolean, primary?: PhysicalResourceSettlementFailure): void => {
    const physical = gitPhysicalProvider, processes = processResourceSession;
    settlePhysicalResources({ primary, cleanup: [
      ...(physical === null ? [] : [{ label: 'git-physical-provider', settle() {
        if (ownsGitPhysicalProvider) closeGitPhysicalProvider(physical);
        else if (checkBorrowed) assertGitPhysicalProviderCurrentInternal(physical);
        gitPhysicalProvider = null;
      } }]),
      ...(processes === null ? [] : [{ label: ownsProcessResourceSession ? 'git-owned-process-session' : 'git-borrowed-process-observation', settle() {
        if (ownsProcessResourceSession) {
          if (processOperation === null || processRequirementId === null) {
            throw new Error('Git process settlement lacks its bound semantic operation.');
          }
          const receipt = processes.close();
          assertProcessResourceSessionReceipt(receipt, {
            operationIdentityDigest: processOperation.plan.identity.identityDigest,
            boundAttemptDigest: processOperation.boundAttemptDigest, requirementId: processRequirementId
          });
        } else if (checkBorrowed) {
          // Borrowing never transfers the parent's close authority, including
          // failed admission and expired/cancelled terminal observations.
          processes.cooperativeDeadlineAtUnixMs();
        }
      } }])
    ] });
  };

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
      fail('command-error', `The retained Git executable changed. ${failureMessage(error)}`);
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
    cwd: workingDirectoryPath,
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
      if (closeReceipt !== null) return closeReceipt.processCount;
      return Math.max(0, (processResourceSession?.processCount ?? processCountAtStart)
        - processCountAtStart);
    },
    observeNativeResourceCapacity() {
      if (failure !== null || closed || closing || processResourceSession === null) return null;
      const physical = processResourceSession.observeNativeResourceCapacity();
      const spentSinceStart = nativeCapacityAtStart - physical.remaining;
      const available = Math.min(nativeProcessLimit - spentSinceStart, physical.remaining);
      return Object.freeze({
        remaining: Number.isSafeInteger(available) ? Math.max(0, available) : 0,
        admitted: physical.admitted,
        root: physical.root,
        stdinWorker: physical.stdinWorker,
        helper: physical.helper
      });
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
          workingDirectoryPath,
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
              + ` ${failureMessage(error)}`
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
      let capturedArgs: ReturnType<typeof captureGitReadArguments>;
      try { capturedArgs = captureGitReadArguments(args, budget.maxTotalArgumentBytes - argumentBytes); }
      catch { return fail('command-error', 'Git read session arguments could not be captured.'); }
      if (capturedArgs.status !== 'ready') {
        return fail(capturedArgs.status === 'exhausted' ? 'argument-budget-exhausted' : 'command-error',
          'Git read session command arguments are invalid or exceed the remaining byte budget.');
      }
      args = capturedArgs.args;
      if (scratchInvocation === null && !gitReadCommandIsObservation(args)) {
        return fail(
          'operation-not-permitted',
          'Git session rejected command grammar outside its observation capability.'
        );
      }
      const commandArgumentBytes = capturedArgs.bytes;
      let commandInput: Uint8Array | null;
      try {
        const suppliedInput = scratchInvocation === null ? options.input : scratchInvocation.input;
        const inputRemaining = Math.min(budget.maxStdinBytes - stdinBytes,
          (processInputBudget ?? 0) - (processResourceSession?.inputBytes ?? 0));
        commandInput = suppliedInput === undefined ? null : snapshotByteView(
          suppliedInput, 'Git read session stdin', Math.max(0, inputRemaining));
      } catch (error) {
        let exceeded = false;
        try { exceeded = error instanceof RangeError; } catch { /* Caller errors need not be inspectable objects. */ }
        return fail(exceeded ? 'stdin-budget-exhausted' : 'command-error',
          'Git read session stdin is invalid or exceeds the remaining input budget.');
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
      const requiredNativeResources = 1 + (process.platform === 'win32' && commandInput !== null ? 1 : 0);
      if ((session.observeNativeResourceCapacity()?.remaining ?? 0) < requiredNativeResources) {
        return fail('process-budget-exhausted', 'Git read session exceeded its local native process budget.');
      }
      const remainingStdout = budget.maxStdoutBytes - stdoutBytes;
      const remainingStderr = budget.maxStderrBytes - stderrBytes;
      if (remainingStdout < 1) return fail(
        'stdout-budget-exhausted',
        `Git read session stdout budget exhausted: consumed=${stdoutBytes} limit=${budget.maxStdoutBytes}.`
      );
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
          return fail(
            'stdout-budget-exhausted',
            `Git operation output-byte budget exhausted: consumed=${processResourceSession?.outputBytes ?? 0}`
              + ` limit=${processOutputBudget ?? 0}.`
          );
        }
        const commandStderrBytes = Math.min(desiredStderrBytes, processOutputRemaining);
        const commandStdoutBytes = Math.min(
          desiredStdoutBytes,
          Math.max(0, processOutputRemaining - commandStderrBytes)
        );
        admittedStdoutLimit = commandStdoutBytes;
        admittedStderrLimit = commandStderrBytes;
        if (processResourceSession === null) {
          return fail('operation-admission-unavailable', 'Git process session is unavailable.');
        }
        const result = (await runGitPhysicalCommandInternal(gitPhysicalProvider, args, {
          env: commandEnvironment,
          envMode: 'replace',
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
          return fail(
            'stdout-budget-exhausted',
            `Git read session stdout budget exceeded: consumed=${stdoutBytes} limit=${budget.maxStdoutBytes}.`
          );
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
        let transport: RetainedCommandTransportError | undefined;
        try { if (error instanceof RetainedCommandTransportError) transport = error; } catch { /* Keep the original failure. */ }
        if (transport !== undefined) {
          if (transport.outcome.stdout.bytes > admittedStdoutLimit) {
            return fail(
              'stdout-budget-exhausted',
              `Git command exceeded its admitted stdout-byte budget: observed=${transport.outcome.stdout.bytes}`
                + ` admitted=${admittedStdoutLimit} consumedBefore=${stdoutBytes}`
                + ` sessionLimit=${budget.maxStdoutBytes}.`
            );
          }
          if (transport.outcome.stderr.bytes > admittedStderrLimit) {
            return fail('stderr-budget-exhausted', 'Git command exceeded its admitted stderr-byte budget.');
          }
          if (transport.outcome.status === 'timed-out') {
            return fail('deadline-exhausted', 'Git command exhausted the operation deadline.');
          }
        }
        return fail('command-error', failureMessage(error));
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
      if (recordCount + count > recordLimit) {
        return fail('record-budget-exhausted', `Git read session exceeded ${recordLimit} records.`);
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
        try { settleOwnedResources(true); }
        catch (error) {
          fail('command-error', `Git retained provider settlement failed. ${failureMessage(error)}`);
          // No receipt is issued for a failed physical settlement. The cached
          // rejection also prevents blind double-release on repeated close.
          throw error;
        }
        const finalProcessCount = processResourceSession?.processCount ?? processCountAtStart;
        const finalInputBytes = processResourceSession?.inputBytes ?? processInputBytesAtStart;
        const finalOutputBytes = processResourceSession?.outputBytes ?? processOutputBytesAtStart;
        const providerIdentityDigest = issuedSession.providerIdentity === null
          ? null
          : sha256(issuedSession.providerIdentity) as OperationDigest;
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
          }) as OperationDigest
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
    if (ownsGitPhysicalProvider) GIT_READ_PHYSICAL_PROVIDER_TRANSFERS.set(issuedSession, () => {
      if (ownsProcessResourceSession || closed || closing || activeProcesses !== 0
          || failure !== null || gitPhysicalProvider === null) {
        throw new Error('Git physical ownership transfer requires an idle live session.');
      }
      assertGitPhysicalProviderCurrentInternal(gitPhysicalProvider);
      ownsGitPhysicalProvider = false;
      return gitPhysicalProvider;
    });
  } else if (input.origin === 'test') {
    TEST_GIT_READ_SESSIONS.add(issuedSession);
  }
  const remainingRootProcessCapacity = (): number => {
    if (failure !== null || closed || closing || processResourceSession === null || processCountBudget === null) return 0;
    // A local session may borrow a narrower/already-used parent ledger. Its
    // own delta counter alone cannot prove the complete batch is affordable.
    const available = Math.min(budget.maxProcesses - issuedSession.processCount,
      processCountBudget - processResourceSession.processCount);
    return Number.isSafeInteger(available) ? Math.max(0, available) : 0;
  };
  GIT_SCRATCH_EXECUTION_OWNERS.set(issuedSession, Object.freeze({
    operation: processOperation,
    signal: processResourceSession?.signal ?? AbortSignal.abort(new Error('Git process session is unavailable.')),
    deadlineAtMonotonicMs: processResourceSession?.deadlineAtMonotonicMs ?? deadlineMonotonicAt,
    remainingRootProcesses: remainingRootProcessCapacity,
    remainingNativeResources: () => issuedSession.observeNativeResourceCapacity()?.remaining ?? 0,
    remainingRecords: () => Math.max(0, recordLimit - recordCount),
    remainingObservedBytes: () => Math.max(0, budget.maxRootObservedBytes - rootObservedBytes),
    chargeObservedBytes(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || rootObservedBytes + bytes > budget.maxRootObservedBytes) {
        throw new Error('Git scratch readback exceeds the existing physical observation byte budget.');
      }
      rootObservedBytes += bytes;
    },
    remainingInputBytes: () => Math.max(0, Math.min(budget.maxStdinBytes - stdinBytes,
      (processInputBudget ?? 0) - (processResourceSession?.inputBytes ?? 0))),
    remainingOutputBytes: () => {
      const remaining = Math.max(0, (processOutputBudget ?? 0) - (processResourceSession?.outputBytes ?? 0));
      return Math.max(0, Math.min(budget.maxStdoutBytes - stdoutBytes,
        remaining - Math.min(budget.maxCommandStderrBytes, remaining)));
    },
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
      providerIdentityDigest: sha256(issuedSession.providerIdentity) as OperationDigest,
      run(args, environment, commandInput) {
        if (gitPhysicalProvider === null) {
          throw new Error('Git retained executable/cwd provider is unavailable for development commit.');
        }
        return scratchOwner.run(args, environment, [], commandInput);
      }
    }));
  }
  if (failure !== null) {
    settlementAttempts += 1;
    const inspectionSettlement = initialExecutableObservation !== null && 'settlementFailure' in initialExecutableObservation
      ? initialExecutableObservation.settlementFailure : undefined;
    const primary = inspectionSettlement ?? { label: 'git-provider-admission', error: failure };
    try { settleOwnedResources(false, primary); }
    catch (error) {
      // Ordinary unavailability stays a typed provider result. Cleanup failure
      // from either admission layer always propagates with its original causes.
      if (inspectionSettlement !== undefined || !Object.is(error, failure)) throw error;
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
  operation: BoundSemanticOperation;
  /**
   * Caller-owned parent process ledger. The Git provider verifies the exact
   * operation/attempt/requirement binding and borrows it without closing it.
   */
  processSession?: ProcessResourceSession;
  /** Internal operation-owned physical provider; exact binding is checked before borrowing. */
  physicalProvider?: GitPhysicalProviderCapability;
  /** Internal finite freeze entry; a raw envelope or numeric override is never accepted. */
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

export class GitIsolatedWorktreeObservationError extends Error {
  readonly code = 'git-isolated-worktree-observation-unavailable' as const;
  constructor(readonly reason: string, cause?: unknown) {
    super(`Git isolated worktree observation is unavailable: ${reason}.`, { cause });
    this.name = 'GitIsolatedWorktreeObservationError';
  }
}

const ISOLATED_WORKTREE_CLEANUP_UNKNOWN = new WeakSet<object>();
class GitIsolatedWorktreeCleanupUnknownError extends Error {
  constructor(readonly generation: PhysicalDirectoryIdentity | undefined, cause: unknown) {
    super('Git isolated worktree resources or generation have unresolved settlement.', { cause });
    this.name = 'GitIsolatedWorktreeCleanupUnknownError';
    ISOLATED_WORKTREE_CLEANUP_UNKNOWN.add(this);
  }
}

export function isGitIsolatedWorktreeCleanupUnknown(error: unknown): boolean {
  return error !== null && typeof error === 'object' && ISOLATED_WORKTREE_CLEANUP_UNKNOWN.has(error);
}

/** This capability observes the real worktree and actual admitted index. It
 * never substitutes the private HEAD/index as the original repository identity. */
export type GitIsolatedWorktreeObservation = Readonly<{
  readonly workingTreeRoot: string;
  readonly headSha: string;
  /** Content observations cannot select a repository or override the owner policy. */
  read(args: readonly string[]): Promise<ByteCommandResult>;
  status(): Promise<ByteCommandResult>;
  close(): Promise<void>;
}>;

/** Fixed no-helper cleanliness policy. Configuration outside this supported
 * domain is unavailable, not silently treated as a clean ordinary checkout. */
const ISOLATED_STATUS_CONFIG = Object.freeze([
  ['core.filemode', ['true']], ['core.symlinks', ['true']],
  ['core.ignorecase', ['false']], ['core.ignorestat', ['false']],
  ['core.trustctime', ['true']], ['core.checkstat', ['default']],
  ['core.autocrlf', ['false']], ['core.eol', ['native', 'lf']],
  ['core.excludesfile', []], ['core.sparsecheckout', ['false']],
  ['index.sparse', ['false']]
] as const);

/** An original production Git session supplies the executable, ledger, time
 * bounds and real repository identity. The enclosing private generation owns
 * the parent; callers receive no configurable Git directory or environment. */
export async function createAuthorityGitIsolatedWorktreeObservation(input: Readonly<{
  gitReadSession: GitReadSession;
  parent: PhysicalDirectoryIdentity;
  expectedHead: string;
}>): Promise<GitIsolatedWorktreeObservation> {
  const { gitReadSession, parent, expectedHead } = input;
  const owner = GIT_SCRATCH_EXECUTION_OWNERS.get(gitReadSession);
  const unavailable = (reason: string, cause?: unknown): never => {
    throw new GitIsolatedWorktreeObservationError(reason, cause);
  };
  if (!isProductionGitReadSession(gitReadSession) || owner === undefined) {
    return unavailable('original-production-session-required');
  }
  if (owner.operation?.plan.identity.operation !== 'external-capabilities.git-bundle.checkout'
      || owner.operation.plan.execution.requirements.length !== 1
      || !owner.operation.plan.execution.requirements[0]!.effectKinds.includes('filesystem')) {
    return unavailable('original-checkout-filesystem-effect-required');
  }
  if (process.platform !== 'linux') return unavailable('unsupported-worktree-observation-platform');
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(expectedHead)) return unavailable('invalid-exact-head');
  // Do not accidentally strip a caller's existing semantic redirection and
  // reinterpret a nested scratch/config session as the original repository.
  if (['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES'].some(key => gitEnvironmentValue(gitReadSession.env, key) !== undefined)) {
    return unavailable('nested-repository-selection');
  }
  const cwd = gitReadSession.cwd;
  const gate = (): void => {
    if (owner.signal.aborted || Date.now() >= gitReadSession.deadlineAt
        || performance.now() >= owner.deadlineAtMonotonicMs
        || !gitReadSession.verifyExecutable() || gitReadSession.verifyWorkingDirectory?.() !== true) {
      unavailable('original-session-not-current');
    }
  };
  const checkedRead = async (args: readonly string[]): Promise<ByteCommandResult> => {
    gate();
    const result = await gitReadSession.run(args);
    gate();
    if (result.kind !== 'completed') return unavailable('metadata-read-unsettled');
    return result.result;
  };
  const assertHead = async (): Promise<void> => {
    const result = await checkedRead(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']);
    if (result.code !== 0 || Buffer.from(result.stdout).toString('utf8') !== `${expectedHead}\n`) {
      unavailable('real-head-changed');
    }
  };
  const configValues = new Map<string, string | null>();
  const observeConfig = async (initial: boolean): Promise<void> => {
    gate();
    // One fixed-key query keeps repeated observations inside the original
    // process budget. It cannot request credentials or arbitrary config data.
    const pattern = `^(${ISOLATED_STATUS_CONFIG.map(([name]) => name.replaceAll('.', '[.]')).join('|')})$`;
    const observed = await owner.run(['config', '--null', '--get-regexp', pattern], gitReadSession.env, []);
    gate();
    if (observed.kind !== 'completed') return unavailable('config-observation-unsettled');
    const result = observed.result;
    const values = new Map<string, string>();
    if (result.code === 0) {
      const fields = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout).split('\0');
      if (fields.pop() !== '') return unavailable('config-observation-truncated');
      for (const field of fields) {
        const separator = field.indexOf('\n');
        if (separator < 1) return unavailable('config-observation-malformed');
        const key = field.slice(0, separator).toLowerCase();
        if (!ISOLATED_STATUS_CONFIG.some(([name]) => name === key)) return unavailable('config-query-outside-policy');
        values.set(key, field.slice(separator + 1).trim().toLowerCase());
      }
    } else if (result.code !== 1 || result.stdout.length !== 0) return unavailable('config-observation-failed');
    for (const [name, accepted] of ISOLATED_STATUS_CONFIG) {
      const value = values.get(name) ?? null;
      if (value !== null && !(accepted as readonly string[]).includes(value)) return unavailable(`unsupported-${name}`);
      if (initial) configValues.set(name, value);
      else if (configValues.get(name) !== value) return unavailable('clean-policy-changed');
    }
  };
  await assertHead();
  await observeConfig(true);
  const identity = await checkedRead(['rev-parse', '--path-format=absolute', '--show-toplevel',
    '--git-path', 'objects', '--git-path', 'index', '--git-path', 'info', '--show-object-format']);
  const lines = identity.code === 0 ? parseGitLineReply(identity.stdout, 5) : null;
  if (lines === null || lines.length !== 5 || lines[0] !== cwd
      || (lines[4] !== 'sha1' && lines[4] !== 'sha256')
      || lines.slice(0, 4).some(value => !path.isAbsolute(value))) return unavailable('unsupported-repository-identity');
  const objectsPath = path.resolve(lines[1]!);
  const indexPath = path.resolve(lines[2]!);
  const infoPath = path.resolve(lines[3]!);
  const objectFormat = lines[4];
  if (expectedHead.length !== (objectFormat === 'sha1' ? 40 : 64)
      || pathIsInside(cwd, parent.path) || pathIsInside(parent.path, cwd)
      || pathIsInside(objectsPath, parent.path) || pathIsInside(parent.path, objectsPath)) {
    return unavailable('observation-parent-not-disjoint');
  }
  const headTree = await checkedRead(['ls-tree', '-r', '-z', '--full-tree', expectedHead]);
  if (headTree.code !== 0) return unavailable('head-tree-unavailable');
  const treeText = new TextDecoder('utf-8', { fatal: true }).decode(headTree.stdout);
  if (treeText !== '' && !treeText.endsWith('\0')) return unavailable('head-tree-truncated');
  const headAttributes = new Map<string, Readonly<{ objectId: string; mode: number }>>();
  for (const entry of treeText === '' ? [] : treeText.slice(0, -1).split('\0')) {
    const parsed = /^(100644|100755|120000) blob ((?:[0-9a-f]{40}|[0-9a-f]{64}))\t([^\0]+)$/u.exec(entry);
    if (parsed === null) return unavailable('unsupported-head-entry');
    const name = parsed[3]!;
    if (name === '.gitattributes' || name.endsWith('/.gitattributes')) {
      if (parsed[1] === '120000') return unavailable('attribute-link-unsupported');
      headAttributes.set(name, Object.freeze({ objectId: parsed[2]!, mode: parseInt(parsed[1]!, 8) }));
    }
  }
  let generation: PhysicalDirectoryIdentity | undefined;
  const retained: Array<RetainedNoFollowOrdinaryFile | RetainedNoFollowChildProcessDirectory> = [];
  let privateRoot: RetainedNoFollowChildProcessDirectory | undefined;
  let repositoryIndex: RetainedNoFollowOrdinaryFile | undefined;
  let repositoryObjects: RetainedNoFollowChildProcessDirectory | undefined;
  let privateIndex: RetainedNoFollowOrdinaryFile | undefined;
  let originalExclude: RetainedNoFollowOrdinaryFile | undefined;
  let closed = false;
  let closing = false;
  let terminal: unknown;
  let failed = false;
  let active: Promise<ByteCommandResult> | null = null;
  let closeResult: Promise<void> | null = null;
  const absentAttributes: PhysicalDirectoryIdentity[] = [];
  const info = inspectNoFollowDirectoryChain(infoPath, 'Git original info directory');
  const assertNoInfoAttributes = (): void => {
    assertSameNoFollowDirectoryIdentity(info.target);
    if (inspectNoFollowOrdinaryFileEntry(info.target, 'attributes', { maximumBytes: 0 }) !== null) {
      unavailable('repository-info-attributes-unsupported');
    }
  };
  const readRetained = (file: RetainedNoFollowOrdinaryFile): Buffer => {
    gate();
    if (file.size > owner.remainingObservedBytes()) return unavailable('metadata-byte-budget');
    owner.chargeObservedBytes(file.size);
    const bytes = Buffer.from(file.readBytes());
    file.assertCurrent();
    return bytes;
  };
  let generationRetired = false;
  const release = (): void => {
    settlePhysicalResources({ cleanup: retained.slice().reverse().map((capability, index) => ({
      label: `isolated-status-retained:${index}`, settle: () => capability.dispose()
    })) });
  };
  const retire = (): void => {
    if (generation === undefined) { generationRetired = true; return; }
    const inventory = scanNoFollowDirectoryTreeMetadata(generation, {
      deadlineAtMs: owner.deadlineAtMonotonicMs, maximumEntries: 8,
      maximumBytes: GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes + 128 * 1024,
      signal: owner.signal
    });
    retireNoFollowDirectoryTree({ parent, root: generation, inventory,
      deadlineAtMonotonicMs: owner.deadlineAtMonotonicMs });
    generationRetired = true;
  };
  try {
    assertNoInfoAttributes();
    repositoryIndex = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(indexPath)),
      path.basename(indexPath), undefined, 'Git real index generation', 8);
    retained.push(repositoryIndex);
    if (repositoryIndex.size > GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes) return unavailable('index-byte-budget');
    let index: GitIndexGeneration;
    try { index = decodeGitIndexGeneration(readRetained(repositoryIndex), objectFormat); }
    catch (error) { return unavailable('unsupported-real-index', error); }
    if (index.entries.some(entry => entry.mode === 0o160000 || entry.assumeValid || entry.extendedFlags !== 0)) {
      return unavailable('unsupported-real-index-flags-or-gitlinks');
    }
    if (gitReadSession.consumeRecords(index.entries.length) !== null) return unavailable('index-record-budget');
    const names = Object.freeze(index.entries.map(entry =>
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(entry.pathHex, 'hex'))));
    const possibleAttributes = new Set<string>(['.gitattributes', ...headAttributes.keys()]);
    const indexAttributes = new Map<string, Readonly<{ objectId: string; mode: number }>>();
    for (let entryIndex = 0; entryIndex < names.length; entryIndex += 1) {
      const name = names[entryIndex]!;
      const entry = index.entries[entryIndex]!;
      if (name === '.gitattributes' || name.endsWith('/.gitattributes')) {
        indexAttributes.set(name, entry);
      }
      const parts = name.split('/');
      for (let end = 1; end < parts.length; end += 1) {
        possibleAttributes.add(`${parts.slice(0, end).join('/')}/.gitattributes`);
      }
    }
    if (indexAttributes.size !== headAttributes.size || [...headAttributes].some(([name, expected]) => {
      const observed = indexAttributes.get(name);
      return observed?.objectId !== expected.objectId || observed.mode !== expected.mode;
    })) return unavailable('staged-attribute-change-unsupported');
    // Both attribute checks and status use the same immutable HEAD attribute
    // view. Prove that it represents the real admitted attributes; never use
    // --cached for one child and mutable worktree attributes for the next.
    for (const name of possibleAttributes) {
      gate();
      const parent = inspectNoFollowDirectoryChain(path.dirname(path.join(cwd, name)), 'Git attribute parent');
      const expected = headAttributes.get(name);
      const observed = inspectNoFollowOrdinaryFileEntry(parent.target, '.gitattributes', {
        maximumBytes: Math.min(GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes, owner.remainingObservedBytes())
      });
      if (expected === undefined) {
        if (observed !== null) return unavailable('untracked-attribute-source-unsupported');
        absentAttributes.push(parent.target);
        continue;
      }
      if (observed === null) return unavailable('worktree-attribute-source-missing');
      const attribute = retainNoFollowOrdinaryFile(parent, '.gitattributes', undefined, 'Git admitted attribute source');
      retained.push(attribute);
      const bytes = readRetained(attribute);
      const original = await checkedRead(['cat-file', 'blob', expected.objectId]);
      if (original.code !== 0 || !bytes.equals(original.stdout)) return unavailable('worktree-attribute-change-unsupported');
      attribute.assertCurrent();
    }
    // Copying an index must not make its stat cache appear newer than the real
    // file and suppress racy-clean checks. In this supported flags-free domain,
    // zero cached stat data forces native comparison without changing entries.
    const privateBytes = encodeGitIndexGeneration({ ...index, entries: Object.freeze(index.entries.map(entry => {
      const stat = Buffer.alloc(40); stat.writeUInt32BE(entry.mode, 24);
      return Object.freeze({ ...entry, statHex: stat.toString('hex') });
    })) });
    let excludeBytes: Buffer | null = null;
    const exclude = inspectNoFollowOrdinaryFileEntry(info.target, 'exclude', { maximumBytes: 128 * 1024 });
    if (exclude !== null) {
      originalExclude = retainNoFollowOrdinaryFile(info, 'exclude', undefined, 'Git real exclusions', 11);
      retained.push(originalExclude);
      excludeBytes = readRetained(originalExclude);
    }
    repositoryObjects = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(objectsPath),
      6, 'Git real object directory');
    retained.push(repositoryObjects);
    generation = createExclusiveNoFollowRandomDirectory(parent, 'git-observe-');
    const fixedInfo = createExclusiveNoFollowDirectory(generation, 'info');
    createExclusiveNoFollowDirectory(generation, 'refs');
    createExclusiveNoFollowDirectory(generation, 'objects');
    const publish = (target: PhysicalDirectoryIdentity, name: string, bytes: Uint8Array): void => {
      publishExclusiveDurableCanonicalFile({ parent: target, name, bytes,
        validate: observed => { if (!Buffer.from(observed).equals(bytes)) unavailable('private-metadata-publication'); } });
    };
    const config = `[core]\nrepositoryformatversion=${objectFormat === 'sha256' ? 1 : 0}\nbare=false\nfilemode=true\nsymlinks=true\nignorecase=false\nignorestat=false\ntrustctime=true\nautocrlf=false\neol=lf\nfsmonitor=false\nuntrackedcache=false\nsplitindex=false\nsparsecheckout=false\nattributesfile=${devNull}\nhookspath=${devNull}\n`
      + (objectFormat === 'sha256' ? '[extensions]\nobjectformat=sha256\n' : '');
    publish(generation, 'config', Buffer.from(config));
    publish(generation, 'HEAD', Buffer.from(`${expectedHead}\n`));
    publish(generation, 'index', privateBytes);
    if (excludeBytes !== null) publish(fixedInfo, 'exclude', excludeBytes);
    const control = assertSameNoFollowDirectoryIdentity(generation);
    privateRoot = retainNoFollowDirectoryForChildProcess(control, 5, 'Git isolated control directory');
    retained.push(privateRoot);
    privateIndex = retainNoFollowOrdinaryFile(control, 'index', undefined, 'Git isolated real-index projection', 7);
    retained.push(privateIndex);
    const fixedConfig = retainNoFollowOrdinaryFile(control, 'config', undefined, 'Git isolated fixed config', 9);
    const fixedHead = retainNoFollowOrdinaryFile(control, 'HEAD', undefined, 'Git isolated fixed HEAD', 10);
    retained.push(fixedConfig, fixedHead);
    const environment = Object.freeze(isolatedGitReadEnvironment({
      GIT_DIR: privateRoot.childPath,
      GIT_WORK_TREE: `/proc/self/fd/${RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR}`,
      GIT_INDEX_FILE: privateIndex.childPath,
      GIT_ATTR_SOURCE: expectedHead,
      GIT_OBJECT_DIRECTORY: repositoryObjects.childPath,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined
    }, gitReadSession.env));
    const auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[] = Object.freeze([
      { kind: 'directory' as const, capability: privateRoot },
      { kind: 'directory' as const, capability: repositoryObjects },
      { kind: 'ordinary-file' as const, capability: privateIndex },
      { kind: 'ordinary-file' as const, capability: repositoryIndex },
      { kind: 'ordinary-file' as const, capability: fixedConfig },
      { kind: 'ordinary-file' as const, capability: fixedHead },
      ...(originalExclude === undefined ? [] : [{ kind: 'ordinary-file' as const, capability: originalExclude }])
    ].map(value => Object.freeze(value)));
    const metadataBytes = privateBytes.byteLength + Buffer.byteLength(config, 'utf8')
      + expectedHead.length + 1 + (excludeBytes?.byteLength ?? 0);
    const metadataSnapshot = (): string => {
      gate();
      if (metadataBytes > owner.remainingObservedBytes()) return unavailable('metadata-byte-budget');
      owner.chargeObservedBytes(metadataBytes);
      assertSameNoFollowDirectoryIdentity(generation!);
      const rootStat = lstatSync(generation!.path, { bigint: true });
      if (!rootStat.isDirectory() || String(rootStat.dev) !== generation!.device
          || String(rootStat.ino) !== generation!.inode) return unavailable('private-metadata-root-changed');
      const entries = scanNoFollowDirectoryTreeInventory(generation!, {
        deadlineAtMs: owner.deadlineAtMonotonicMs, maximumEntries: 8,
        maximumBytes: metadataBytes, includePermissionMode: true, signal: owner.signal
      });
      assertSameNoFollowDirectoryIdentity(generation!);
      return sha256({ rootMode: String(rootStat.mode & 0o7777n), entries });
    };
    const metadataDigest = metadataSnapshot();
    const current = (): void => {
      gate();
      assertNoInfoAttributes();
      for (const capability of retained) capability.assertCurrent();
      for (const parent of absentAttributes) {
        assertSameNoFollowDirectoryIdentity(parent);
        if (inspectNoFollowOrdinaryFileEntry(parent, '.gitattributes', { maximumBytes: 0 }) !== null) {
          unavailable('attribute-source-membership-changed');
        }
      }
      if (originalExclude === undefined
          && inspectNoFollowOrdinaryFileEntry(info.target, 'exclude', { maximumBytes: 0 }) !== null) {
        unavailable('exclusions-changed');
      }
      if (metadataSnapshot() !== metadataDigest) unavailable('private-metadata-changed');
    };
    const isolatedRead = async (args: readonly string[]): Promise<ByteCommandResult> => {
      current();
      // A fixed command-line selection also makes an older Git fail closed;
      // it cannot silently ignore an unrecognized GIT_ATTR_SOURCE variable.
      const command = await owner.run([`--attr-source=${expectedHead}`, ...args], environment, auxiliaryInputs);
      current();
      if (command.kind !== 'completed') return unavailable('isolated-read-failed');
      return command.result;
    };
    const assertNoFilterConversions = async (): Promise<void> => {
      let offset = 0;
      while (offset < names.length) {
        let size = 0;
        const selected: string[] = [];
        while (offset < names.length) {
          const name = names[offset]!;
          const bytes = Buffer.byteLength(name, 'utf8') + 1;
          if (bytes > 12 * 1024) return unavailable('attribute-path-budget');
          if (selected.length > 0 && size + bytes > 12 * 1024) break;
          selected.push(name); size += bytes; offset += 1;
        }
        // Requested-attribute output aliases state words and literal driver
        // names (for example filter=unspecified). --all reveals membership;
        // reject every present filter attribute, including explicit -filter,
        // rather than mistake a named conversion for the absent state.
        const result = await isolatedRead(['check-attr', '--all', '-z', '--', ...selected]);
        const fields = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout).split('\0');
        if (result.code !== 0 || fields.pop() !== '' || fields.length % 3 !== 0) {
          return unavailable('attribute-observation-malformed');
        }
        const requested = new Set(selected);
        for (let index = 0; index < fields.length; index += 3) {
          if (!requested.has(fields[index]!) || fields[index + 1]!.length === 0) {
            return unavailable('attribute-observation-outside-request');
          }
          if (fields[index + 1] === 'filter') return unavailable('filter-conversion-unsupported');
        }
      }
    };
    const read = (args: readonly string[]): Promise<ByteCommandResult> => {
      const captured = captureGitReadArguments(args, 128 * 1024);
      if (captured.status !== 'ready' || !gitReadCommandIsObservation(captured.args, {
        fixedRoot: true, commands: ['status', 'diff', 'show']
      })) return Promise.reject(new GitIsolatedWorktreeObservationError('content-command-not-permitted'));
      if (closed || closing || active !== null || failed) return Promise.reject(
        new GitIsolatedWorktreeObservationError('observation-not-idle'));
      const running = (async () => {
        current();
        await assertHead();
        await observeConfig(false);
        await assertNoFilterConversions();
        const result = await isolatedRead(captured.args);
        await assertNoFilterConversions();
        await observeConfig(false);
        await assertHead();
        current();
        return result;
      })();
      const tracked = running.catch(error => { failed = true; terminal = error; throw error; })
        .finally(() => { active = null; });
      active = tracked;
      return tracked;
    };
    const close = (): Promise<void> => {
      if (closeResult !== null) return closeResult;
      closing = true;
      closeResult = (async () => {
        if (active !== null) { try { await active; } catch { /* preserve the recorded primary */ } }
        const primary: PhysicalResourceSettlementFailure | undefined = failed
          ? { label: 'isolated-status-operation', error: terminal } : undefined;
        let released = false;
        try {
          settlePhysicalResources({ primary, cleanup: [
            { label: 'isolated-status-final-readback', settle: current },
            { label: 'isolated-status-resources', settle: () => { release(); released = true; } },
            { label: 'isolated-status-generation', settle: () => {
              if (!released) unavailable('retained-resources-unsettled');
              retire();
            } }
          ] });
        } catch (error) {
          if (!released || !generationRetired) throw new GitIsolatedWorktreeCleanupUnknownError(generation, error);
          throw error;
        } finally { closed = true; }
      })();
      return closeResult;
    };
    current();
    return Object.freeze({ workingTreeRoot: cwd, headSha: expectedHead, read,
      status: () => read(['status', '--porcelain=v2', '-z', '--untracked-files=all']), close });
  } catch (error) {
    let released = false;
    try {
      settlePhysicalResources({ primary: { label: 'isolated-status-acquisition', error }, cleanup: [
        { label: 'isolated-status-acquisition-resources', settle: () => { release(); released = true; } },
        { label: 'isolated-status-acquisition-generation', settle: () => {
          if (!released) unavailable('retained-resources-unsettled');
          retire();
        } }
      ] });
    } catch (failure) {
      if (!released || !generationRetired) throw new GitIsolatedWorktreeCleanupUnknownError(generation, failure);
      throw failure;
    }
    return unavailable('acquisition-unsettled');
  }
}

/**
 * Issues the narrow Git effects needed to compute a tree from an
 * already-created, immutable index snapshot. The scratch root is
 * caller-materialized but must be repository-external and contain exactly the
 * retained `index` file and `objects` directory. Scratch computation remains
 * isolated; the returned capability's explicit `materializeIndexDelta` method
 * is the only route that may persist the same typed delta into the retained
 * repository object store. The returned object has no generic command
 * surface.
 */
export async function createAuthorityGitScratchIndexTreeSession(input: Readonly<{
  readonly gitReadSession: GitReadSession;
  readonly scratchRoot: string;
}>): Promise<GitScratchIndexTreeResolution> {
  const { gitReadSession, scratchRoot: requestedScratchRoot } = input;
  input = Object.freeze({ gitReadSession, scratchRoot: requestedScratchRoot });
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
  const lines = parseGitLineReply(identity.result.stdout, 4);
  if (lines === null) return Object.freeze({ status: 'unavailable', reason: 'session-failed' });
  const [repositoryRoot, repositoryObjects, repositoryIndex, objectFormat] = lines;
  if (lines.length !== 4 || repositoryRoot === undefined || repositoryObjects === undefined
      || repositoryIndex === undefined || (objectFormat !== 'sha1' && objectFormat !== 'sha256')
      || ![repositoryRoot, repositoryObjects, repositoryIndex].every(value => path.isAbsolute(value))) {
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
  let scratchParentCapability: RetainedNoFollowChildProcessDirectory | null = null;
  let repositoryIndexCapability: RetainedNoFollowOrdinaryFile | null = null;
  try {
    const scratchChain = inspectNoFollowDirectoryChain(scratchRoot, 'Git scratch root');
    const retainedScratchParentCapability = retainNoFollowDirectoryForChildProcess(scratchChain, 9, 'Git writable scratch parent');
    scratchParentCapability = retainedScratchParentCapability;
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
    const retainedScratchIndexCapability = retainNoFollowOrdinaryFile(scratchChain, 'index', undefined, 'Git scratch index', 7);
    scratchIndexCapability = retainedScratchIndexCapability;
    if (retainedScratchIndexCapability.size > GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes
        || retainedScratchIndexCapability.size > executionOwner.remainingObservedBytes()) {
      throw new Error('Git scratch source index exceeds its finite input inventory.');
    }
    executionOwner.chargeObservedBytes(retainedScratchIndexCapability.size);
    const retainedScratchIndexBytes = retainedScratchIndexCapability.readBytes();
    let currentIndexGeneration = decodeGitIndexGeneration(retainedScratchIndexBytes, objectFormat);
    let currentIndexBytes: Buffer = Buffer.from(retainedScratchIndexBytes);
    const retainedRepositoryIndexCapability = retainNoFollowOrdinaryFile(
      repositoryIndexParent,
      path.basename(canonicalRepositoryIndex),
      undefined,
      'Git repository index fence',
      8
    );
    repositoryIndexCapability = retainedRepositoryIndexCapability;
    if (retainedRepositoryIndexCapability.size > GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes
        || retainedRepositoryIndexCapability.size > executionOwner.remainingObservedBytes()) {
      throw new Error('Repository index provenance exceeds its finite input inventory.');
    }
    executionOwner.chargeObservedBytes(retainedRepositoryIndexCapability.size);
    const repositoryIndexBytes = retainedRepositoryIndexCapability.readBytes();
    const repositoryIndexGeneration = Buffer.from(repositoryIndexBytes).equals(retainedScratchIndexBytes)
      ? currentIndexGeneration : decodeGitIndexGeneration(repositoryIndexBytes, objectFormat);
    const repositoryEntries = new Map(repositoryIndexGeneration.entries.map(entry => [entry.pathHex, entry]));
    const repositoryIndexMtime = retainedNoFollowOrdinaryFileMtimeForInternal(retainedRepositoryIndexCapability);
    const auxiliaryInputs = (): readonly RetainedCommandAuxiliaryInput[] => Object.freeze([
      Object.freeze({ kind: 'directory' as const, capability: retainedRepositoryObjectsCapability }),
      Object.freeze({ kind: 'directory' as const, capability: retainedScratchObjectsCapability }),
      Object.freeze({ kind: 'directory' as const, capability: retainedScratchParentCapability }),
      Object.freeze({
        kind: 'ordinary-file' as const,
        capability: retainedScratchIndexCapability
      })
    ]);
    const environment = (): Readonly<Record<string, string>> => Object.freeze(isolatedGitReadEnvironment({
      GIT_INDEX_FILE: retainedScratchIndexCapability.childPath,
      GIT_INDEX_VERSION: '3',
      GIT_OBJECT_DIRECTORY: retainedScratchObjectsCapability.childPath,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: retainedRepositoryObjectsCapability.childPath
    }, Object.fromEntries(Object.entries(input.gitReadSession.env).filter(([key]) => !/^GIT_TEST_/iu.test(key)))));
    const repositoryEnvironment = (): Readonly<Record<string, string>> => Object.freeze(isolatedGitReadEnvironment({
      GIT_INDEX_FILE: retainedScratchIndexCapability.childPath,
      GIT_INDEX_VERSION: '3',
      GIT_OBJECT_DIRECTORY: retainedRepositoryObjectsCapability.childPath,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: retainedRepositoryObjectsCapability.childPath
    }, Object.fromEntries(Object.entries(input.gitReadSession.env).filter(([key]) => !/^GIT_TEST_/iu.test(key)))));
    let closed = false;
    let closing = false;
    let closeResult: Promise<GitScratchIndexTreeFailureReason | null> | null = null;
    let activeSettlement: Promise<void> | null = null;
    let primaryFailure: PhysicalResourceSettlementFailure | undefined;
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
    const operate = <T>(operation: () => Promise<GitScratchIndexTreeResult<T>>): Promise<GitScratchIndexTreeResult<T>> => {
      if (closed || closing) return Promise.resolve(unavailable('closed'));
      if (activeSettlement !== null) return Promise.resolve(unavailable('session-failed', 'Git scratch operations are non-reentrant.'));
      let settled!: () => void;
      activeSettlement = new Promise<void>(resolve => { settled = resolve; });
      // Invoke synchronously so data snapshots precede caller mutation after
      // invocation, while ownership already rejects nested/admitted work.
      let result: Promise<GitScratchIndexTreeResult<T>>;
      try { result = Promise.resolve(operation()); }
      catch (error) { result = Promise.reject(error); }
      const outcome = result.then(value => terminalFailure === null ? value : unavailable<T>(terminalFailure));
      return outcome.catch(error => {
        primaryFailure ??= { label: 'git-scratch-operation', error };
        terminalFailure ??= 'session-failed';
        throw error;
      }).finally(() => { activeSettlement = null; settled(); });
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
        Object.freeze({
          capability: retainedScratchIndexCapability,
          failure: 'scratch-index-changed' as const
        }),
        Object.freeze({
          capability: retainedScratchParentCapability,
          failure: 'scratch-identity-changed' as const
        }),
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
      if (!gitReadSession.verifyExecutable() || gitReadSession.verifyWorkingDirectory?.() !== true) {
        terminalFailure ??= 'session-failed';
        return false;
      }
      return true;
    };
    const runWithInput = async (
      args: readonly string[],
      commandEnvironment: Readonly<Record<string, string>>,
      commandInput?: Uint8Array
    ): Promise<GitReadSessionCommand | null> => {
      if (!assertCurrent()) return null;
      const fixed = ['--no-lazy-fetch', '--no-replace-objects', '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false',
        '-c', 'core.untrackedCache=false', '-c', 'core.splitIndex=false', '-c', 'core.sparseCheckout=false',
        '-c', 'index.sparse=false', '-c', 'core.ignoreStat=false', '-c', 'core.ignoreCase=false',
        '-c', 'index.version=3', '-c', 'index.skipHash=false', '-c', 'index.recordEndOfIndexEntries=false', '-c', 'index.recordOffsetTable=false'];
      const result = await executionOwner.run([...fixed, ...args], commandEnvironment, auxiliaryInputs(), commandInput);
      if (!assertCurrent()) return null;
      return result;
    };
    const run = (args: readonly string[]): Promise<GitReadSessionCommand | null> =>
      runWithInput(args, environment());
    const sameEntries = (actual: GitIndexGeneration, expected: GitIndexGeneration): void => {
      if (actual.objectFormat !== expected.objectFormat || actual.entries.length !== expected.entries.length
          || actual.resolveUndoHex !== expected.resolveUndoHex
          || actual.entries.some((entry, index) => {
            const before = expected.entries[index]!;
            return entry.pathHex !== before.pathHex || entry.mode !== before.mode || entry.objectId !== before.objectId
              || entry.assumeValid !== before.assumeValid || entry.extendedFlags !== before.extendedFlags;
          })) throw new Error('Native private index differs from its exact expected entry transformation.');
      assertGitIndexTreeGeneration(actual);
    };
    let privateIndexSequence = 0;
    const readPrivateIndex = (name: string): Readonly<{ bytes: Buffer; generation: GitIndexGeneration; mtime: bigint }> => {
      retainedScratchParentCapability.assertCurrent();
      if (inspectNoFollowOrdinaryFileEntry(scratchChain.target, `${name}.lock`, { maximumBytes: 0 }) !== null) {
        throw new Error('Native private index has an unsettled lock.');
      }
      const retained = retainNoFollowOrdinaryFile(scratchChain, name, undefined, 'Native private index readback');
      let primary: PhysicalResourceSettlementFailure | undefined;
      let result: Readonly<{ bytes: Buffer; generation: GitIndexGeneration; mtime: bigint }> | undefined;
      try {
        if (retained.size > GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes || retained.size > executionOwner.remainingObservedBytes()) {
          throw new Error('Native private index exceeds its bounded readback inventory.');
        }
        executionOwner.chargeObservedBytes(retained.size);
        const bytes = Buffer.from(retained.readBytes());
        const mtime = retainedNoFollowOrdinaryFileMtimeForInternal(retained);
        result = { bytes, generation: decodeGitIndexGeneration(bytes, objectFormat), mtime };
      } catch (error) { primary = { label: 'native-private-index-readback', error }; }
      settlePhysicalResources({ primary, cleanup: [{ label: 'native-private-index-readback', settle: () => retained.dispose() }] });
      return result!;
    };
    const nativeTree = async (
      requested: GitScratchIndexTreeDelta | undefined,
      commandEnvironment: Readonly<Record<string, string>>,
      materialization = false
    ): Promise<GitScratchIndexTreeResult<string>> => {
      if (terminalFailure !== null) return unavailable(terminalFailure);
      try {
        if (!assertCurrent()) return unavailable(terminalFailure ?? 'session-failed');
        assertGitIndexTreeGeneration(currentIndexGeneration);
        const delta = requested === undefined ? { additions: [], removals: [] }
          : captureGitScratchIndexDelta(requested, objectFormat, executionOwner.remainingInputBytes());
        const materializedEntries = materialization ? new Map(currentIndexGeneration.entries.map(entry => [entry.pathHex, entry])) : undefined;
        if (materialization && (delta.removals.length !== 0 || delta.additions.some(addition =>
          materializedEntries!.get(Buffer.from(addition.path).toString('hex'))?.mode !== 0o100644))) {
          throw new Error('Repository materialization must preserve the retained NEXT entry set.');
        }
        // This is only the exact entry transform used for admission/readback,
        // not a tree algorithm or an executable symbolic object identity.
        const placeholder = '1'.repeat(objectFormat === 'sha1' ? 40 : 64);
        const projected = materialization ? currentIndexGeneration : applyGitIndexObjectDelta(currentIndexGeneration, {
          additions: delta.additions.map(item => ({ path: item.path, objectId: placeholder })), removals: delta.removals
        });
        // write-index can smudge racy cached mtimes through worktree clean
        // filters. A disposable zero-mtime copy cannot enter that path. The
        // native output is checked before publication restores only genuinely
        // unchanged, non-racy stat caches from the retained repository input.
        const privateGeneration: GitIndexGeneration = Object.freeze({ ...currentIndexGeneration,
          entries: Object.freeze(currentIndexGeneration.entries.map(entry => Object.freeze({ ...entry,
            statHex: `${entry.statHex.slice(0, 16)}${'0'.repeat(16)}${entry.statHex.slice(32)}` }))) });
        const cleanIndex = encodeGitIndexGeneration(privateGeneration);
        const projectedIndexBytes = encodeGitIndexGeneration(projected).byteLength;
        let treeNames = 0, directoryBound = 1;
        for (const entry of projected.entries) {
          treeNames += entry.pathHex.length / 2;
          for (let offset = 0; offset < entry.pathHex.length; offset += 2) {
            if (entry.pathHex.slice(offset, offset + 2) === '2f') directoryBound++;
          }
        }
        // Native TREE cache records use name/NUL/count/space/count/LF/OID.
        // Repeated directory prefixes only make this prospective bound smaller
        // in reality; there is deliberately no second hand-written tree DAG.
        const digits = String(projected.entries.length).length;
        const nextIndexMaximum = projectedIndexBytes + 8 + treeNames
          + directoryBound * (placeholder.length / 2 + 2 * digits + 3);
        const oidWidth = placeholder.length, metadataRecordBytes = oidWidth + 29;
        const metadataBatchSize = projected.entries.length === 0 ? 1 : Math.min(projected.entries.length,
          Math.floor(gitReadSession.budget.maxCommandStdoutBytes / metadataRecordBytes));
        if (metadataBatchSize < 1) return unavailable('session-failed', 'Native index metadata does not fit one command.');
        const metadataBatches = Math.ceil(projected.entries.length / metadataBatchSize);
        const hashCount = delta.additions.length, updates = !materialization && hashCount + delta.removals.length > 0 ? 1 : 0;
        const updateBytes = delta.additions.reduce((sum, item) => sum + Buffer.byteLength(formatGitScratchIndexRecord('100644', placeholder, item.path)), 0)
          + delta.removals.reduce((sum, item) => sum + Buffer.byteLength(formatGitScratchIndexRecord('0', placeholder, item)), 0);
        const inputBytes = projected.entries.length * (oidWidth + 1) + (updates ? updateBytes : 0)
          + delta.additions.reduce((sum, item) => sum + item.bytes.byteLength, 0);
        const roots = hashCount + updates + metadataBatches + 1;
        const stdinCommands = hashCount + updates + metadataBatches;
        const outputBytes = projected.entries.length * metadataRecordBytes + (hashCount + 1) * (oidWidth + 1);
        if (roots > executionOwner.remainingRootProcesses()
            || roots + (process.platform === 'win32' ? stdinCommands : 0) > executionOwner.remainingNativeResources()
            || inputBytes > executionOwner.remainingInputBytes() || outputBytes > executionOwner.remainingOutputBytes()
            || projected.entries.length + hashCount + 1 > executionOwner.remainingRecords()
            || nextIndexMaximum > GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes
            || cleanIndex.byteLength + (updates ? projectedIndexBytes : 0) + nextIndexMaximum > executionOwner.remainingObservedBytes()
            || oidWidth + 1 > gitReadSession.budget.maxCommandStdoutBytes) {
          return unavailable('session-failed', 'Native scratch primitive exceeds its remaining aggregate resources.');
        }
        if (!assertCurrent()) return unavailable(terminalFailure ?? 'session-failed');
        const name = `native-index-${++privateIndexSequence}`;
        const transaction = retainNoFollowFileTransaction(scratchRoot, 'Native private Git index');
        let preparationFailure: PhysicalResourceSettlementFailure | undefined;
        try {
          if (transaction.rootIdentity.device !== scratchChain.target.device || transaction.rootIdentity.inode !== scratchChain.target.inode) {
            throw new Error('Native private index parent changed.');
          }
          await transaction.createExclusive(name, cleanIndex, 'Native private Git index');
        } catch (error) { preparationFailure = { label: 'native-private-index-create', error }; }
        settlePhysicalResources({ primary: preparationFailure, cleanup: [{ label: 'native-private-index-create', settle: () => transaction.dispose() }] });
        const computationInput = readPrivateIndex(name);
        sameEntries(computationInput.generation, currentIndexGeneration);
        const targetEnvironment = Object.freeze({ ...commandEnvironment,
          GIT_INDEX_FILE: `${retainedScratchParentCapability.childPath}${path.sep}${name}` });
        const additions: Array<{ path: string; objectId: string }> = [];
        for (const addition of delta.additions) {
          const result = await runWithInput(['hash-object', '-w', '--stdin'], targetEnvironment, addition.bytes);
          if (result === null || result.kind !== 'completed' || result.result.code !== 0) return unavailable('session-failed', 'Native scratch blob write failed.');
          const objectId = parseGitObjectIdReply(result.result.stdout, objectFormat);
          if (objectId === null || gitReadSession.consumeRecords(1) !== null) return unavailable('session-failed', 'Native scratch blob reply is invalid.');
          if (materialization && objectId !== materializedEntries!.get(Buffer.from(addition.path).toString('hex'))!.objectId) {
            throw new Error('Repository materialization blob differs from its retained NEXT object identity.');
          }
          additions.push({ path: addition.path, objectId });
        }
        const expected = materialization ? currentIndexGeneration
          : applyGitIndexObjectDelta(currentIndexGeneration, { additions, removals: delta.removals });
        if (updates > 0) {
          const zero = '0'.repeat(oidWidth);
          const records = [...delta.removals.map(item => formatGitScratchIndexRecord('0', zero, item)),
            ...additions.map(item => formatGitScratchIndexRecord('100644', item.objectId, item.path))];
          const result = await runWithInput(['update-index', '-z', '--index-info'], targetEnvironment, Buffer.from(records.join(''), 'utf8'));
          if (result === null || result.kind !== 'completed' || result.result.code !== 0) return unavailable('session-failed', 'Native private index update failed.');
          sameEntries(readPrivateIndex(name).generation, expected);
        }
        for (let offset = 0; offset < expected.entries.length; offset += metadataBatchSize) {
          const entries = expected.entries.slice(offset, offset + metadataBatchSize);
          const result = await runWithInput(['cat-file', '--batch-check'], targetEnvironment,
            Buffer.from(`${entries.map(entry => entry.objectId).join('\n')}\n`, 'ascii'));
          if (result === null || result.kind !== 'completed' || result.result.code !== 0) return unavailable('session-failed', 'Native index object metadata failed.');
          assertGitIndexObjectInfoBatch(entries, result.result.stdout);
          if (gitReadSession.consumeRecords(entries.length) !== null) return unavailable('session-failed', 'Native index metadata records exhausted.');
        }
        const result = await runWithInput(['write-tree'], targetEnvironment);
        if (result === null || result.kind !== 'completed' || result.result.code !== 0) return unavailable('session-failed', 'Native private write-tree failed.');
        const tree = parseGitObjectIdReply(result.result.stdout, objectFormat);
        if (tree === null || gitReadSession.consumeRecords(1) !== null) return unavailable('session-failed', 'Native write-tree reply is invalid.');
        const observed = readPrivateIndex(name);
        sameEntries(observed.generation, expected);
        // Native index bytes are a verified intermediate. Publication uses
        // the existing codec, preserving only stat caches whose actual source
        // is the retained real index. Whole-second comparison overapproximates
        // Git's optional-nanosecond racy test on every supported build.
        const timestamps = [repositoryIndexMtime, computationInput.mtime, observed.mtime];
        const publication: GitIndexGeneration = Object.freeze({ ...observed.generation,
          entries: Object.freeze(observed.generation.entries.map(entry => {
            const original = repositoryEntries.get(entry.pathHex);
            if (original === undefined || original.mode !== entry.mode || original.objectId !== entry.objectId
                || original.assumeValid !== entry.assumeValid || original.extendedFlags !== entry.extendedFlags) return entry;
            const modifiedSeconds = BigInt(`0x${original.statHex.slice(16, 24)}`);
            if (timestamps.some(timestamp => timestamp <= 0n || modifiedSeconds >= timestamp / 1_000_000_000n)) return entry;
            return Object.freeze({ ...entry, statHex: original.statHex });
          })) });
        const publicationBytes = encodeGitIndexGeneration(publication);
        currentIndexGeneration = publication;
        currentIndexBytes = publicationBytes;
        return Object.freeze({ status: 'ready', value: tree });
      } catch (error) { return unavailable('session-failed', failureMessage(error)); }
    };
    const applyIndexDelta = (delta: GitScratchIndexTreeDelta) => operate(() => nativeTree(delta, environment()));
    const materializeIndexDelta = (delta: GitScratchIndexTreeDelta) => operate(() => nativeTree(delta, repositoryEnvironment(), true));
    const scratchSession: GitScratchIndexTreeSession = Object.freeze({
      scratchRoot,
      objectFormat,
      applyIndexDelta,
      materializeIndexDelta,
      indexBytes(): GitScratchIndexTreeResult<Uint8Array> {
        if (closed || closing) return unavailable('closed');
        if (terminalFailure !== null) return unavailable(terminalFailure);
        if (!assertCurrent()) return unavailable(terminalFailure ?? 'scratch-index-changed');
        return Object.freeze({ status: 'ready', value: Buffer.from(currentIndexBytes) });
      },
      async writeTree(): Promise<GitScratchIndexTreeResult<string>> {
        return operate(() => nativeTree(undefined, environment()));
      },
      async commitTree(commitInput: GitCommitTreeInput): Promise<GitScratchIndexTreeResult<string>> {
        return operate(async () => {
        if (terminalFailure !== null) return unavailable(terminalFailure);
        const canonical = canonicalCommitTreeInput(commitInput);
        if (canonical === null) return unavailable('session-failed');
        const args = Object.freeze([
          'commit-tree', canonical.tree,
          ...canonical.parents.flatMap((parent) => ['-p', parent])
        ]);
        const command = await runWithInput(
          args,
          gitCommitEnvironment(canonical, environment()),
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
        const value = parseGitObjectIdReply(command.result.stdout, objectFormat);
        if (value === null) {
          return unavailable('session-failed');
        }
        return Object.freeze({ status: 'ready', value });
        });
      },
      async observe(args: readonly string[]): Promise<GitScratchIndexTreeResult<ByteCommandResult>> {
        return operate(async () => {
        if (terminalFailure !== null) return unavailable(terminalFailure);
        let captured: ReturnType<typeof captureGitReadArguments>;
        try { captured = captureGitReadArguments(args, input.gitReadSession.budget.maxTotalArgumentBytes); }
        catch { return unavailable('session-failed', 'Scratch observation arguments could not be captured.'); }
        if (captured.status !== 'ready' || !gitReadCommandIsObservation(captured.args)) {
          return unavailable('session-failed');
        }
        const result = await run(captured.args);
        if (result === null) return unavailable(terminalFailure ?? 'session-failed');
        if (result.kind !== 'completed') {
          return unavailable('session-failed');
        }
        return Object.freeze({ status: 'ready', value: result.result });
        });
      },
      async close(): Promise<GitScratchIndexTreeFailureReason | null> {
        if (closeResult !== null) return closeResult;
        closing = true;
        closeResult = (async () => {
          // Closing denies new operations but lets the admitted one finish. No
          // retained index/object directory is released beneath an active child.
          if (activeSettlement !== null) await activeSettlement;
          assertCurrent();
          const prior = primaryFailure;
          settlePhysicalResources({ primary: prior, cleanup: [
            { label: 'git-repository-index', capability: retainedRepositoryIndexCapability },
            { label: 'git-scratch-index', capability: retainedScratchIndexCapability },
            { label: 'git-scratch-parent', capability: retainedScratchParentCapability },
            { label: 'git-scratch-object-directory', capability: retainedScratchObjectsCapability },
            { label: 'git-repository-object-directory', capability: retainedRepositoryObjectsCapability }
          ].filter(entry => entry.capability !== null).map(({ label, capability }) => ({
            label, settle: () => capability!.dispose()
          })) });
          if (!gitReadSession.verifyExecutable() || gitReadSession.verifyWorkingDirectory?.() !== true) {
            terminalFailure ??= 'session-failed';
          }
          closed = true;
          return terminalFailure;
        })();
        return closeResult;
      }
    });
    return Object.freeze({ status: 'ready', session: scratchSession });
  } catch (error) {
    try {
      settlePhysicalResources({ primary: { label: 'git-scratch-admission', error }, cleanup: [
        { label: 'git-repository-index', capability: repositoryIndexCapability },
        { label: 'git-scratch-index', capability: scratchIndexCapability },
        { label: 'git-scratch-parent', capability: scratchParentCapability },
        { label: 'git-scratch-object-directory', capability: scratchObjectsCapability },
        { label: 'git-repository-object-directory', capability: repositoryObjectsCapability }
      ].filter(entry => entry.capability !== null).map(({ label, capability }) => ({ label, settle: () => capability!.dispose() })) });
    } catch (settlementError) {
      if (!Object.is(settlementError, error)) throw settlementError;
    }
    let physicalFailure = false;
    try { physicalFailure = error instanceof PhysicalNoFollowError; } catch { /* Classification must not replace the original failure. */ }
    return Object.freeze({ status: 'unavailable', reason: physicalFailure ? 'retained-provider-unavailable' : 'invalid-scratch-layout' });
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
  const session = input.gitReadSession;
  const contract = captureGitDevelopmentCommitContract(input.contract);
  if (contract === null) return Object.freeze({ status: 'unavailable', reason: 'invalid-contract' });
  const owner = authorizedDevelopmentCommitOwner(session, contract);
  if (owner === null) {
    return Object.freeze({ status: 'unavailable', reason: 'operation-not-authorized' });
  }
  if (path.resolve(session.cwd) !== contract.worktreeRoot) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-contract' });
  }
  const environment = gitCommitEnvironment(contract, session.env);
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
  const observedTree = parseGitObjectIdReply(tree.result.stdout, contract.tree.length === 40 ? 'sha1' : 'sha256');
  if (observedTree !== contract.tree) {
    return Object.freeze({ status: 'unavailable', reason: 'index-drift' });
  }
  const commit = await owner.run(
    Object.freeze([
      'commit-tree', contract.tree,
      ...contract.parents.flatMap((parent) => ['-p', parent])
    ]),
    environment,
    Buffer.from(contract.message, 'utf8')
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
  const object = parseGitObjectIdReply(commit.result.stdout, contract.target.length === 40 ? 'sha1' : 'sha256');
  if (object !== contract.target) {
    return Object.freeze({ status: 'unavailable', reason: 'target-mismatch' });
  }
  return Object.freeze({ status: 'completed', object });
}

/** Git owns its provider binding and settlement, but never the grant or attempt lineage. */
export function bindGitDevelopmentCommitOperation(input: Readonly<{
  intent: SemanticOperationIntent;
  attempt: SemanticOperationAttemptContext;
  providerIdentityDigest: OperationDigest;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  const plan = compileSemanticOperationPlan({
    operation: input.intent.identity.operation,
    intentDigest: input.intent.identity.intentDigest,
    decisionDigest: input.intent.identity.decisionDigest,
    aggregateBudgets: input.intent.execution.aggregateBudgets,
    requirements: input.intent.execution.requirements,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: input.attempt
  });
  return bindSemanticOperation(plan, plan.execution.requirements.map((requirement) =>
    compileCapabilityBinding({
      requirementId: requirement.id,
      contractDigest: requirement.contractDigest,
      providerIdentityDigest: input.providerIdentityDigest
    })));
}

export function settleGitDevelopmentCommitOperation(
  operation: BoundSemanticOperation,
  result: GitDevelopmentCommitEffectResult
): ProviderSettlementReceipt {
  return issueProviderSettlementReceipt(operation, {
    requirementId: 'repository.commit',
    physicalDisposition: result.status === 'completed' ? 'settled' : 'unknown',
    providerSettlementReferenceDigest: sha256(result) as OperationDigest
  });
}

/** Exact `update-ref <new> <old>` CAS for the already-materialized object. */
export async function compareAndSwapAuthorityDevelopmentCommitRef(input: Readonly<{
  readonly gitReadSession: GitReadSession;
  readonly contract: GitDevelopmentCommitContract;
}>): Promise<GitDevelopmentCommitEffectResult> {
  const session = input.gitReadSession;
  const contract = captureGitDevelopmentCommitContract(input.contract);
  if (contract === null) return Object.freeze({ status: 'unavailable', reason: 'invalid-contract' });
  const owner = authorizedDevelopmentCommitOwner(session, contract);
  if (owner === null) {
    return Object.freeze({ status: 'unavailable', reason: 'operation-not-authorized' });
  }
  if (path.resolve(session.cwd) !== contract.worktreeRoot) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-contract' });
  }
  const update = await owner.run(Object.freeze([
    'update-ref', '--create-reflog', '-m', 'development.commit',
    contract.ref, contract.target, contract.expectedOld
  ]), session.env);
  if (update.kind !== 'completed') {
    return Object.freeze({
      status: 'unavailable',
      reason: 'provider-failed',
      detail: `update-ref provider=${update.reason}; detail=${update.detail}`
    });
  }
  return update.result.code === 0
    ? Object.freeze({ status: 'completed', object: contract.target })
    : Object.freeze({ status: 'cas-conflict', object: contract.target });
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
