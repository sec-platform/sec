import path from 'node:path';
import { snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import { failureMessage } from '../../../../contracts/failure-inspection.ts';
import { settleResources as settlePhysicalResources, type ResourceSettlementFailure as PhysicalResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { parseGitLineReply, parseGitObjectIdReply } from '../../../runtime-state/physical/contract/git-worktree-observation.ts';
import { boundedGitReadDeadlineAt, resolveGitReadSessionBudget, type GitReadSessionBudget } from './budget.ts';
import {
  canonicalCommitTreeInput, captureGitDevelopmentCommitContract, compileGitDevelopmentCommitContractDigest, gitCommitEnvironment,
  type GitCommitTreeInput, type GitDevelopmentCommitContract, type GitDevelopmentCommitEffectResult
} from './commit-contract.ts';
import { captureGitReadArguments, gitReadCommandIsObservation } from './read-command.ts';
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
import { PhysicalNoFollowError, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile, type PhysicalDirectoryChain, type RetainedNoFollowChildProcessDirectory, type RetainedNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession, type ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { RetainedCommandTransportError, resolveExecutableLocator, type ByteCommandResult } from '../../../runtime-state/physical/runtime/process.ts';
import type { RetainedCommandAuxiliaryInput } from '../../../runtime-state/physical/runtime/retained-command-boundary.ts';
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
 * Narrow Git effect capability for computing a tree from one immutable index.
 * It intentionally exposes no generic argv, config, ref, or repository-write
 * surface.  The typed index delta is applied only inside the retained,
 * repository-external scratch object directory and the resulting tree is
 * read back through the same retained provider.
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
  writeTree(): Promise<GitScratchIndexTreeResult<string>>;
  commitTree(input: GitCommitTreeInput): Promise<GitScratchIndexTreeResult<string>>;
  observe(args: readonly string[]): Promise<GitScratchIndexTreeResult<ByteCommandResult>>;
  close(): Promise<GitScratchIndexTreeFailureReason | null>;
}>;

export type GitScratchIndexTreeResolution =
  | Readonly<{ readonly status: 'ready'; readonly session: GitScratchIndexTreeSession }>
  | Readonly<{ readonly status: 'unavailable'; readonly reason: GitScratchIndexTreeFailureReason }>;

type GitScratchExecutionOwner = Readonly<{
  /** Conservative root-command capacity, not a reservation or a new grant. */
  remainingRootProcesses(): number;
  /** Native capacity also charges Windows stdin workers and termination helpers. */
  remainingNativeResources(): number;
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
  resource: 'input-bytes' | 'output-bytes' | 'processes'
): number | null {
  return operation?.plan.execution.aggregateBudgets
    .find((candidate) => candidate.resource === resource)?.maximum ?? null;
}

function createHostGitReadSession(input: GitReadHostSessionInput): GitReadSession {
  const startedAt = Date.now();
  const startedMonotonicAt = performance.now();
  const budget = resolveGitReadSessionBudget(input.budget);
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
          ))
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
  let gitExecutable: string | null = null;
  let executableDiscoveryFailure: string | null = null;
  if (!operationAdmissionUnavailable && !admissionCancelled && !admissionDeadlineExpired && workingDirectoryIdentity !== null) {
    try {
      gitExecutable = resolveExecutableLocator('git', {
        pathValue: gitEnvironmentValue(env, 'PATH') ?? '', cwd: workingDirectoryPath
      });
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
        closeGitPhysicalProvider(physical);
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
      const available = Math.min(budget.maxProcesses - spentSinceStart, physical.remaining);
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
      const commandStartedAt = performance.now();
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
        return fail('command-error',
          `phase=git-command:${args[0] ?? '<empty>'} elapsedMs=${Math.max(0, performance.now() - commandStartedAt)} `
          + failureMessage(error));
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
    remainingRootProcesses: remainingRootProcessCapacity,
    remainingNativeResources: () => issuedSession.observeNativeResourceCapacity()?.remaining ?? 0,
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
    const repositoryEnvironment = (): Readonly<Record<string, string>> => Object.freeze(isolatedGitReadEnvironment({
      GIT_INDEX_FILE: scratchIndexCapability?.childPath ?? scratchIndexPath,
      GIT_OBJECT_DIRECTORY: retainedRepositoryObjectsCapability.childPath,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: retainedRepositoryObjectsCapability.childPath
    }, input.gitReadSession.env));
    let closed = false;
    let closing = false;
    let closeResult: Promise<GitScratchIndexTreeFailureReason | null> | null = null;
    let activeSettlement: Promise<void> | null = null;
    let primaryFailure: PhysicalResourceSettlementFailure | undefined;
    let failedIndexRetirement: Readonly<{ capability: RetainedNoFollowOrdinaryFile; error: unknown }> | undefined;
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
      void outcome.then(() => undefined, error => {
        primaryFailure ??= { label: 'git-scratch-operation', error };
        terminalFailure ??= 'session-failed';
      }).finally(() => { activeSettlement = null; settled(); });
      return outcome;
    };
    const releaseScratchIndexForUpdate = (): void => {
      const previous = scratchIndexCapability;
      scratchIndexCapability = null;
      if (previous === null) return;
      try { previous.dispose(); }
      catch (error) {
        failedIndexRetirement = { capability: previous, error };
        terminalFailure ??= 'scratch-index-changed';
        throw error;
      }
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
    const writeTreeInEnvironment = async (
      commandEnvironment: Readonly<Record<string, string>>
    ): Promise<GitScratchIndexTreeResult<string>> => {
      if (terminalFailure !== null) return unavailable(terminalFailure);
      const command = await runWithInput(Object.freeze(['write-tree']), commandEnvironment);
      if (command === null || command.kind !== 'completed' || command.result.code !== 0) {
        return unavailable(terminalFailure ?? 'session-failed');
      }
      const value = parseGitObjectIdReply(command.result.stdout, objectFormat);
      if (value === null) {
        return unavailable('session-failed');
      }
      return Object.freeze({ status: 'ready', value });
    };
    const applyIndexDeltaToEnvironment = async (
      input: GitScratchIndexTreeDelta,
      commandEnvironment: () => Readonly<Record<string, string>>
    ): Promise<GitScratchIndexTreeResult<string>> => {
      if (terminalFailure !== null) return unavailable(terminalFailure);
      try { input = captureGitScratchIndexDelta(input, objectFormat,
        gitReadSession.budget.maxStdinBytes - (gitReadSession.stdinBytes ?? 0)); }
      catch (error) { return unavailable('session-failed', failureMessage(error)); }
      // Every addition hashes one blob; a nonempty delta updates the index
      // once; every result then reads write-tree. Refuse a known impossible
      // request before even the first object write. This is an admission
      // check, not a reservation across other borrowers of the parent budget.
      const requiredRootProcesses = input.additions.length
        + (input.additions.length > 0 || input.removals.length > 0 ? 1 : 0) + 1;
      const inputCommandCount = input.additions.length
        + (input.additions.length > 0 || input.removals.length > 0 ? 1 : 0);
      const requiredNativeResources = requiredRootProcesses
        + (process.platform === 'win32' ? inputCommandCount : 0);
      const remainingRootProcesses = executionOwner.remainingRootProcesses();
      const remainingNativeResources = executionOwner.remainingNativeResources();
      if (!Number.isSafeInteger(remainingRootProcesses)
          || !Number.isSafeInteger(remainingNativeResources)
          || requiredRootProcesses > remainingRootProcesses
          || requiredNativeResources > remainingNativeResources) {
        return unavailable('session-failed', 'Git scratch delta exceeds the remaining process budget.');
      }
      // Mode-zero records delete exactly from the index, even when the
      // working tree still contains that path. Delete first so file/directory
      // replacements have one deterministic final index regardless of the
      // current working tree. All records use one Git index lock/update.
      const zeroObject = '0'.repeat(objectFormat === 'sha1' ? 40 : 64);
      const indexUpdates = input.removals.map(path => formatGitScratchIndexRecord('0', zeroObject, path));
      for (const addition of input.additions) {
        const command = await runWithInput(
          Object.freeze(['hash-object', '-w', '--stdin']),
          commandEnvironment(),
          addition.bytes
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
        const objectId = parseGitObjectIdReply(command.result.stdout, objectFormat);
        if (objectId === null) {
          return unavailable('session-failed', 'Git scratch blob materialization returned an invalid object id.');
        }
        indexUpdates.push(formatGitScratchIndexRecord('100644', objectId, addition.path));
      }
      if (indexUpdates.length > 0) {
        releaseScratchIndexForUpdate();
        const command = await runWithInput(
          Object.freeze(['update-index', '-z', '--index-info']),
          commandEnvironment(),
          Buffer.from(indexUpdates.join(''), 'utf8')
        );
        try {
          scratchIndexCapability = retainScratchIndex();
        } catch (error) {
          return unavailable(
            terminalFailure ?? 'scratch-index-changed',
            failureMessage(error)
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
      return writeTreeInEnvironment(commandEnvironment());
    };
    const applyIndexDelta = async (
      input: GitScratchIndexTreeDelta
    ): Promise<GitScratchIndexTreeResult<string>> => operate(() => applyIndexDeltaToEnvironment(input, environment));
    const materializeIndexDelta = async (
      input: GitScratchIndexTreeDelta
    ): Promise<GitScratchIndexTreeResult<string>> => operate(() => applyIndexDeltaToEnvironment(input, repositoryEnvironment));
    const scratchSession: GitScratchIndexTreeSession = Object.freeze({
      scratchRoot,
      objectFormat,
      applyIndexDelta,
      materializeIndexDelta,
      async writeTree(): Promise<GitScratchIndexTreeResult<string>> {
        return operate(() => writeTreeInEnvironment(environment()));
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
          const prior = primaryFailure ?? (failedIndexRetirement === undefined ? undefined : {
            label: 'git-scratch-index-retirement', error: failedIndexRetirement.error
          });
          settlePhysicalResources({ primary: prior, cleanup: [
            { label: 'git-repository-index', capability: retainedRepositoryIndexCapability },
            { label: 'git-scratch-index', capability: scratchIndexCapability },
            { label: 'git-scratch-object-directory', capability: retainedScratchObjectsCapability },
            { label: 'git-repository-object-directory', capability: retainedRepositoryObjectsCapability }
          ].filter(entry => entry.capability !== null).map(({ label, capability }) => ({
            label, settle: () => capability!.dispose()
          })) });
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
