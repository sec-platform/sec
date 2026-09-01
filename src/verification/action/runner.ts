/**
 * Minimal local VerificationAction V2 execution coordinator.
 *
 * The coordinator owns physical-start/reuse/join decisions only. It never
 * promotes a journal observation into VerificationResult truth and never
 * invokes trusted CI/dev-runner surfaces.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { watch as watchFileSystem } from 'node:fs/promises';
import path from 'node:path';
import {
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  createBoundedProcessDiagnosticObjectStore,
  type BoundedProcessDiagnosticObjectStore,
  type BoundedProcessDiagnosticPublishedObject,
  type BoundedProcessDiagnosticStream
} from '../../runtime-state/workspace-state/bounded-process-diagnostic-object.ts';
import { createRuntimeStateJournalFileSystem, type RuntimeStateJournalFileSystem } from '../../runtime-state/workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../runtime-state/workspace-state/paths.ts';
import {
  acquireSecRuntimeJournalAuthority,
  type SecRuntimeStatePhysicalAuthority
} from '../../runtime-state/workspace-state/physical-authority.ts';
import { issueSecOperationRequirementBindingContext } from '../../system-architecture/operation/requirement-binding-context.ts';
import {
  assertSecProviderSettlementReceipt,
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecProviderSettlementSet,
  compileSecSemanticOperationPlan,
  issueSecNormalDomainReadbackReceipt,
  issueSecNormalOwnerTerminalJoinReceipt,
  issueSecProviderSettlementReceipt,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecProviderSettlementReceipt
} from '../../system-architecture/operation/semantic.ts';
import {
  createVerificationActionKey,
  createVerificationActionPlan,
  encodeVerificationActionData,
  issueProcessVerificationActionTerminalSettlement,
  issueVerificationActionOwnerTerminalReceipt,
  isVerificationActionRunnable,
  parseVerificationActionKey,
  parseVerificationActionPlan,
  projectVerificationActionTerminal,
  VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY,
  verificationActionDependsOnChangedInputs,
  type VerificationActionDependency,
  type VerificationActionDependencyResolution,
  type VerificationActionDependencyState,
  type VerificationActionExecutionClass,
  type VerificationActionKey,
  type VerificationActionKeyDigest,
  type VerificationActionKeyInput,
  type VerificationActionPlan,
  type VerificationActionTerminal
} from './contract/action.ts';
import {
  parseCiVerificationActionPlanClosure,
  type CiVerificationActionPlanClosure,
  type CiVerificationExecutionEnvironment,
  type CiVerificationNormalizedOperation
} from './contract/ci.ts';
import {
  acquireVerificationActionClaim,
  appendVerificationActionJournalEvent,
  commitVerificationActionRevocationUnderClaim,
  commitVerificationActionTerminalUnderClaim,
  readVerificationActionClaim,
  readVerificationActionJournal,
  releaseVerificationActionClaim,
  renewVerificationActionClaim,
  revokeVerificationActionClaim,
  type VerificationActionClaim,
  type VerificationActionJournalReadback,
  type VerificationActionJournalState
} from './journal.ts';

export type VerificationActionRunDisposition = 'executed' | 'joined' | 'reused' | 'blocked';

export interface VerificationActionRunOutcome {
  readonly actionKey: VerificationActionKeyDigest;
  readonly disposition: VerificationActionRunDisposition;
  readonly state: VerificationActionJournalState | null;
  readonly terminal: VerificationActionTerminal | null;
  readonly physicalExecution: boolean;
  readonly reason: string | null;
  /** Existing terminal-journal note, atomically committed with that terminal. */
  readonly subordinateSettlement: string | null;
}

export const LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA =
  'sec-local-verification-action-dag-result-v2' as const;

export type LocalVerificationActionDagResult = Readonly<{
  schema: typeof LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA;
  actionPlanDigest: VerificationActionKeyDigest;
  executionEnvironmentRevision: string;
  status: 'passed' | 'failed' | 'blocked';
  actionResults: readonly VerificationActionRunOutcome[];
  terminalDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionTestProcessIssuer = Readonly<{
  kind: 'verification-action-test-process-issuer';
}>;

const ISSUED_VERIFICATION_ACTION_TEST_PROCESS_ISSUERS = new WeakSet<object>();

/** Test-only issuer; production imports are rejected by the repository model. */
export function issueVerificationActionTestProcessIssuerForTests():
VerificationActionTestProcessIssuer {
  const issuer = Object.freeze({
    kind: 'verification-action-test-process-issuer' as const
  });
  ISSUED_VERIFICATION_ACTION_TEST_PROCESS_ISSUERS.add(issuer);
  return issuer;
}

export type ExecuteLocalVerificationActionDagInput = Readonly<{
  /** Trusted checkout that owns the durable local Action journal. */
  authorityRoot: string;
  /** Detached exact-candidate worktree used only for physical execution. */
  candidateRoot: string;
  actionPlanClosure: CiVerificationActionPlanClosure;
  executionEnvironment: CiVerificationExecutionEnvironment;
  environment?: NodeJS.ProcessEnv;
  /** Optional caller cancellation; it can only narrow the operation lifetime. */
  signal?: AbortSignal;
  /** Optional absolute caller deadline; it can only narrow the fixed Action budget. */
  deadlineAtUnixMs?: number;
  runner?: VerificationActionRunner;
  recordedAt?: () => string;
  testProcessIssuer?: VerificationActionTestProcessIssuer;
  testProcessProvider?: (
    operation: CiVerificationNormalizedOperation,
    context: VerificationActionProcessExecutionContext
  ) => Promise<ProcessResourceRunResult> | ProcessResourceRunResult;
  /** Explicit physical provider supplied by the outer runtime adapter. */
  executeActionPlan?: (input: Readonly<{
    plan: VerificationActionPlan;
    authorizedClosure: CiVerificationActionPlanClosure;
    repositoryRoot: string;
    environment?: NodeJS.ProcessEnv;
    process: VerificationActionProcessExecutionContext;
  }>) => Promise<ProcessResourceRunResult>;
  inspectRepository: VerificationActionRepositoryInspector;
}>;

export type VerificationActionProcessExecutionContext = Readonly<{
  session: ProcessResourceSession;
  maxStderrBytes: typeof VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStderrBytes;
  maxStdoutBytes: typeof VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStdoutBytes;
}>;

export type VerificationActionRepositoryObservation = Readonly<{
  headSha: string;
  headTreeSha: string;
  trackedClean: boolean;
  gitCommonDirectory: string;
}>;

/**
 * Narrow effect capability granted by the outer VerificationSession adapter.
 * The Action coordinator can request one complete repository observation but
 * cannot choose a process, executable, environment, or arbitrary Git argv.
 */
export type VerificationActionRepositoryInspector = (
  repositoryRoot: string
) => VerificationActionRepositoryObservation;

export type VerificationActionExecutor = (
  context: Readonly<{
    action: VerificationActionKey;
    executionDomain: string;
    /**
     * Registers one bounded producer-owned settlement projection for atomic
     * persistence in the existing terminal journal event. The runner treats
     * the bytes as opaque and never invents a producer-specific schema.
     */
    recordSubordinateSettlement(note: string): void;
  }>
) => Promise<unknown> | unknown;

export interface VerificationActionExecuteInput {
  readonly repositoryRoot: string;
  readonly action: VerificationActionKey;
  readonly executionDomain?: string;
  /** Stable identity of the physical owner; nested calls inherit it. */
  readonly ownerToken?: string;
  readonly plan?: VerificationActionPlan;
  readonly executor: VerificationActionExecutor;
  readonly recordedAt?: () => string;
  readonly leaseDurationMs?: number;
  /** Joiners may only narrow the durable owner's live-claim window. */
  readonly deadlineAtUnixMs?: number;
  readonly signal?: AbortSignal;
}

export type VerificationActionIdentityExecuteInput = Readonly<
  Omit<VerificationActionExecuteInput, 'action' | 'plan'> & {
    /** Canonical producer-owned identity; the runner derives action and plan. */
    readonly actionInput: VerificationActionKeyInput;
    readonly executionClass: VerificationActionExecutionClass;
  }
>;

type InFlight = Promise<VerificationActionRunOutcome>;
type CoordinatedAction = {
  activeCallers: number;
  flight: InFlight | null;
};
type ExecutionContext = Readonly<{
  ownerToken: string;
  ownerKeys: ReadonlySet<string>;
}>;

// One coordination generation covers every call that overlaps from admission
// entry through terminal settlement.  A caller can take longer to acquire its
// own journal authority and validate its plan than the physical executor takes
// to finish; retaining the settled flight until the last overlapping caller
// exits prevents that late-authorized caller from starting a second physical
// attempt for the same semantic ActionKey.
const COORDINATED_ACTIONS = new Map<string, CoordinatedAction>();
const EXECUTION_CONTEXT = new AsyncLocalStorage<ExecutionContext>();
let ownerSequence = 0;

function enterCoordinatedAction(coordinationKey: string): CoordinatedAction {
  let coordination = COORDINATED_ACTIONS.get(coordinationKey);
  if (coordination === undefined) {
    coordination = { activeCallers: 0, flight: null };
    COORDINATED_ACTIONS.set(coordinationKey, coordination);
  }
  coordination.activeCallers += 1;
  return coordination;
}

function leaveCoordinatedAction(
  coordinationKey: string,
  coordination: CoordinatedAction
): void {
  coordination.activeCallers -= 1;
  if (coordination.activeCallers === 0
      && COORDINATED_ACTIONS.get(coordinationKey) === coordination) {
    COORDINATED_ACTIONS.delete(coordinationKey);
  }
}

function canonicalAction(action: unknown): VerificationActionKey {
  return parseVerificationActionKey(encodeVerificationActionData(action));
}

const VERIFICATION_ACTION_JOURNAL_NOTE_MAXIMUM_BYTES = 1024;

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = '';
  let byteLength = 0;
  for (const scalar of value) {
    const scalarBytes = Buffer.byteLength(scalar, 'utf8');
    if (byteLength + scalarBytes > maximumBytes) break;
    result += scalar;
    byteLength += scalarBytes;
  }
  return result;
}

function boundedExecutionFailureNote(
  error: unknown,
  state: 'invalidated' | 'cancelled'
): string {
  const text = error instanceof Error ? error.message : String(error);
  const sanitized = text.replace(/[\u0000-\u001f]/gu, ' ');
  const suffix = state === 'invalidated'
    ? '; physical result durably invalidated before terminal commit'
    : '; executor ended without an owner-issued terminal; action durably cancelled';
  const prefix = `executor threw: ${sanitized}`;
  return `${truncateUtf8(
    prefix,
    VERIFICATION_ACTION_JOURNAL_NOTE_MAXIMUM_BYTES - Buffer.byteLength(suffix, 'utf8')
  )}${suffix}`;
}

class VerificationActionCandidateDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationActionCandidateDriftError';
  }
}

function boundedToken(value: string | undefined, label: string, fallback: () => string): string {
  if (value === undefined) return fallback();
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be bounded text.`);
  }
  return value;
}

function nextOwnerToken(): string {
  ownerSequence += 1;
  return `verification-action-owner-${process.pid}-${ownerSequence}-${randomUUID()}`;
}

function localDagDigest(value: unknown): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function rawDigest(value: string | Uint8Array): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalProcessRunResult(value: unknown): ProcessResourceRunResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('local VerificationAction provider did not return one physical process result.');
  }
  const candidate = value as Partial<ProcessResourceRunResult>;
  const result = candidate.result;
  if (candidate.ordinal !== 1 || result === null || typeof result !== 'object'
      || !Number.isSafeInteger(result.code) || result.code < 0
      || !(result.stdout instanceof Uint8Array) || typeof result.stderr !== 'string') {
    throw new Error('local VerificationAction physical process result is not canonical.');
  }
  return value as ProcessResourceRunResult;
}

function bindLocalDagOperation(input: Readonly<{
  action: VerificationActionKey;
  normalizedOperation: CiVerificationNormalizedOperation;
  executionEnvironment: CiVerificationExecutionEnvironment;
  deadlineAtUnixMs: number;
}>): SecBoundSemanticOperation {
  const processContractDigest = localDagDigest({
    contract: 'verification.local-action-execution',
    normalizedOperationDigest: input.normalizedOperation.semanticDigest
  }) as SecOperationDigest;
  const diagnosticContractDigest = localDagDigest({
    contract: 'verification.local-action-process-diagnostics',
    normalizedOperationDigest: input.normalizedOperation.semanticDigest
  }) as SecOperationDigest;
  const decisionDigest = localDagDigest({ processContractDigest, diagnosticContractDigest });
  const operationPlan = compileSecSemanticOperationPlan({
    operation: 'verification.local-action',
    intentDigest: input.action.actionKey as SecOperationDigest,
    decisionDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    aggregateBudgets: [
      {
        resource: 'duration-ms',
        maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.durationMs
      },
      {
        resource: 'input-bytes',
        maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStdoutBytes
          + VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStderrBytes
      },
      {
        resource: 'output-bytes',
        maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStdoutBytes
          + VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStderrBytes
      },
      {
        resource: 'processes',
        maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.processes
      }
    ],
    requirements: [{
      id: 'verification.local-provider',
      contractDigest: processContractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed', 'process.settlement-failed']
    }, {
      id: 'verification.action-diagnostics',
      contractDigest: diagnosticContractDigest,
      effectKinds: ['filesystem'],
      failureKinds: [
        'diagnostic.corrupt-object',
        'diagnostic.deadline-exhausted',
        'diagnostic.foreign-residue',
        'diagnostic.incomplete-object',
        'diagnostic.physical-replacement',
        'diagnostic.resource-exhausted'
      ]
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: decisionDigest
    })
  });
  const bound = bindSecSemanticOperation(operationPlan, [
    compileSecCapabilityBinding({
      requirementId: 'verification.local-provider',
      contractDigest: processContractDigest,
      providerIdentityDigest: localDagDigest({
        executionEnvironmentRevision: input.executionEnvironment.executionEnvironmentRevision,
        toolchainRevision: input.executionEnvironment.toolchainRevision
      }) as SecOperationDigest
    }),
    compileSecCapabilityBinding({
      requirementId: 'verification.action-diagnostics',
      contractDigest: diagnosticContractDigest,
      providerIdentityDigest: localDagDigest(
        'runtime-state.process-diagnostics'
      ) as SecOperationDigest
    })
  ]);
  return bound;
}

function canonicalCommonDirectory(value: string): string {
  const physical = realpathSync.native(value);
  return process.platform === 'win32' ? physical.toLowerCase() : physical;
}

function resolveDependency(
  fs: RuntimeStateJournalFileSystem,
  dependency: VerificationActionDependency
): VerificationActionDependencyResolution {
  const journal = readVerificationActionJournal(fs, dependency.actionKey);
  // A cheap-preflight dependency is a root gate. Its own producer-owned
  // topology must not require another cheap preflight, independent of lane
  // or cost policy.
  if (dependency.kind === 'cheap-preflight' &&
    journal.action !== null && journal.action.requiredCheapPreflightActionKeys.length > 0) {
    return {
      actionKey: dependency.actionKey,
      state: 'unknown',
      observationDigest: journal.events.at(-1)?.eventDigest ?? null
    };
  }
  let state: VerificationActionDependencyState;
  switch (journal.latestState) {
    case null:
      state = 'unknown';
      break;
    case 'queued':
      state = 'queued';
      break;
    case 'running':
      state = 'running';
      break;
    case 'invalidated':
      state = 'invalidated';
      break;
    case 'cancelled':
      state = 'cancelled';
      break;
    case 'terminal':
    case 'reused':
      switch (journal.terminal?.status) {
        case 'passed':
          state = 'terminal-passed';
          break;
        case 'failed':
          state = 'terminal-failed';
          break;
        case 'not-run':
          state = 'not-run';
          break;
        case 'unsupported':
          state = 'unsupported';
          break;
        case 'invalidated':
          state = 'invalidated';
          break;
        default:
          state = 'unknown';
          break;
      }
      break;
  }
  return {
    actionKey: dependency.actionKey,
    state,
    observationDigest: journal.events.at(-1)?.eventDigest ?? null
  };
}

function resolveDependencyStates(
  fs: RuntimeStateJournalFileSystem,
  plan: VerificationActionPlan
): readonly VerificationActionDependencyResolution[] {
  return Object.freeze(plan.dependencies.map((dependency) => Object.freeze(
    resolveDependency(fs, dependency)
  )));
}

function dependencyClosureUnchanged(
  before: readonly VerificationActionDependencyResolution[],
  after: readonly VerificationActionDependencyResolution[]
): boolean {
  if (before.length !== after.length) return false;
  return before.every((entry, index) => {
    const candidate = after[index];
    return candidate !== undefined && candidate.actionKey === entry.actionKey &&
      candidate.state === entry.state &&
      (candidate.observationDigest ?? null) === (entry.observationDigest ?? null);
  });
}

function outcome(
  actionKey: VerificationActionKeyDigest,
  disposition: VerificationActionRunDisposition,
  state: VerificationActionJournalState | null,
  terminal: VerificationActionTerminal | null,
  physicalExecution: boolean,
  reason: string | null,
  subordinateSettlement: string | null = null
): VerificationActionRunOutcome {
  return Object.freeze({
    actionKey,
    disposition,
    state,
    terminal,
    physicalExecution,
    reason,
    subordinateSettlement
  });
}

function boundedSubordinateSettlement(value: string): string {
  if (value.length === 0 || value.length > 1024
      || Buffer.byteLength(value, 'utf8') > 1024
      || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(
      'VerificationAction subordinate settlement must be non-empty bounded single-line text.'
    );
  }
  return value;
}

function persistedSubordinateSettlement(
  journal: VerificationActionJournalReadback
): string | null {
  for (let index = journal.events.length - 1; index >= 0; index -= 1) {
    const event = journal.events[index]!;
    if (event.terminal !== null) return event.note;
  }
  return null;
}

function joinedTerminalOutcome(
  actionKey: VerificationActionKeyDigest,
  journal: VerificationActionJournalReadback
): VerificationActionRunOutcome | null {
  if ((journal.latestState === 'terminal' || journal.latestState === 'reused')
      && journal.terminal !== null) {
    return outcome(
      actionKey,
      'joined',
      journal.latestState,
      journal.terminal,
      false,
      'joined the authenticated durable Action owner terminal',
      persistedSubordinateSettlement(journal)
    );
  }
  return null;
}

function sameClaimGeneration(
  current: VerificationActionClaim,
  joined: VerificationActionClaim
): boolean {
  return current.actionKey === joined.actionKey
    && current.ownerToken === joined.ownerToken
    && current.acquiredAt === joined.acquiredAt;
}

async function waitForJoinedActionTerminal(input: Readonly<{
  fs: RuntimeStateJournalFileSystem;
  actionKey: VerificationActionKeyDigest;
  claim: VerificationActionClaim;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<VerificationActionRunOutcome> {
  const effectiveDeadlineAtUnixMs = Math.min(
    input.deadlineAtUnixMs,
    Date.parse(input.claim.expiresAt)
  );
  const initial = readVerificationActionJournal(input.fs, input.actionKey);
  const initialTerminal = joinedTerminalOutcome(input.actionKey, initial);
  if (initialTerminal !== null) return initialTerminal;
  const directory = path.dirname(initial.filePath);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (input.signal?.aborted === true) abort();
  else input.signal?.addEventListener('abort', abort, { once: true });
  const remainingMs = Math.max(0, effectiveDeadlineAtUnixMs - Date.now());
  const timer = setTimeout(abort, remainingMs);
  timer.unref();
  const eventSource = watchFileSystem(directory, {
    persistent: false,
    signal: controller.signal
  });
  const events = eventSource[Symbol.asyncIterator]();
  try {
    while (true) {
      const journal = readVerificationActionJournal(input.fs, input.actionKey);
      const terminal = joinedTerminalOutcome(input.actionKey, journal);
      if (terminal !== null) return terminal;
      // Claim publication is the admission linearization point. A contender
      // may authenticate that live claim before the owner appends `queued`;
      // the absent journal is therefore an in-flight pre-publication state,
      // not evidence that a second execution may start or that the join failed.
      if (journal.latestState !== null
          && journal.latestState !== 'queued'
          && journal.latestState !== 'running') {
        return outcome(
          input.actionKey,
          'blocked',
          journal.latestState,
          null,
          false,
          `joined durable Action changed to ${journal.latestState ?? 'absent'} without a terminal`
        );
      }
      const currentClaim = readVerificationActionClaim(input.fs, input.actionKey);
      if (currentClaim === null || !sameClaimGeneration(currentClaim, input.claim)) {
        return outcome(
          input.actionKey,
          'blocked',
          journal.latestState,
          null,
          false,
          'joined durable Action claim generation changed without a terminal'
        );
      }
      if (input.signal?.aborted === true || Date.now() >= effectiveDeadlineAtUnixMs) {
        return outcome(
          input.actionKey,
          'blocked',
          journal.latestState,
          null,
          false,
          input.signal?.aborted === true
            ? 'joined durable Action wait was cancelled'
            : 'joined durable Action wait exhausted its absolute deadline'
        );
      }
      try {
        const event = await events.next();
        if (event.done) {
          return outcome(
            input.actionKey,
            'blocked',
            journal.latestState,
            null,
            false,
            'joined durable Action event source closed before terminal readback'
          );
        }
      } catch (error) {
        if (controller.signal.aborted) continue;
        return outcome(
          input.actionKey,
          'blocked',
          journal.latestState,
          null,
          false,
          `joined durable Action event source failed: ${error instanceof Error ? error.name : typeof error}`
        );
      }
    }
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
    controller.abort();
    await events.return?.();
  }
}





export class VerificationActionRunner {
  readonly #journalFileSystemPromises = new Map<string, Promise<RuntimeStateJournalFileSystem>>();
  readonly #journalFileSystems = new Map<string, RuntimeStateJournalFileSystem>();
  readonly #runtimeAuthorities = new Map<string, SecRuntimeStatePhysicalAuthority>();
  readonly #diagnosticStores = new Map<string, BoundedProcessDiagnosticObjectStore>();

  async #journalFileSystem(repositoryRoot: string): Promise<RuntimeStateJournalFileSystem> {
    const physicalRoot = realpathSync.native(path.resolve(repositoryRoot));
    let pending = this.#journalFileSystemPromises.get(physicalRoot);
    if (pending === undefined) {
      pending = (async () => {
        const authority = await acquireSecRuntimeJournalAuthority({ repositoryRoot: physicalRoot });
        try {
          await authority.assertCurrent();
          const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: physicalRoot });
          const fs = createRuntimeStateJournalFileSystem(
            authority.directory(roots.workspaceStateRoot)
          );
          const diagnostics = createBoundedProcessDiagnosticObjectStore({
            authority,
            repositoryRoot: physicalRoot
          });
          this.#runtimeAuthorities.set(physicalRoot, authority);
          this.#diagnosticStores.set(physicalRoot, diagnostics);
          this.#journalFileSystems.set(physicalRoot, fs);
          return fs;
        } catch (error) {
          await authority.release();
          throw error;
        }
      })().catch((error) => {
        this.#journalFileSystemPromises.delete(physicalRoot);
        this.#journalFileSystems.delete(physicalRoot);
        this.#runtimeAuthorities.delete(physicalRoot);
        this.#diagnosticStores.delete(physicalRoot);
        throw error;
      });
      this.#journalFileSystemPromises.set(physicalRoot, pending);
    }
    return pending;
  }

  #diagnosticStore(repositoryRoot: string): BoundedProcessDiagnosticObjectStore {
    const physicalRoot = realpathSync.native(path.resolve(repositoryRoot));
    const store = this.#diagnosticStores.get(physicalRoot);
    if (store === undefined) {
      throw new Error('VerificationAction diagnostic authority must be acquired before publication.');
    }
    return store;
  }

  async publishBoundProcessDiagnostics(input: Readonly<{
    repositoryRoot: string;
    action: VerificationActionKey;
    operation: SecBoundSemanticOperation;
    processSettlement: SecProviderSettlementReceipt;
    streams: readonly Readonly<{
      stream: BoundedProcessDiagnosticStream;
      bytes: Uint8Array;
    }>[];
    signal?: AbortSignal;
  }>): Promise<readonly BoundedProcessDiagnosticPublishedObject[]> {
    const action = canonicalAction(input.action);
    assertSecProviderSettlementReceipt(input.processSettlement);
    const operationBindsAction = input.operation.plan.identity.intentDigest === action.actionKey
      || action.operation.semanticDigest === input.operation.plan.identity.identityDigest;
    if (!operationBindsAction
        || input.processSettlement.requirementId === 'verification.action-diagnostics'
        || input.processSettlement.operationIdentityDigest
          !== input.operation.plan.identity.identityDigest
        || input.processSettlement.executionPlanDigest
          !== input.operation.plan.execution.executionPlanDigest
        || input.processSettlement.boundAttemptDigest !== input.operation.boundAttemptDigest) {
      throw new Error(
        'VerificationAction diagnostic publication requires the exact owner process settlement.'
      );
    }
    return this.#diagnosticStore(input.repositoryRoot).publish({
      operation: input.operation,
      requirementId: 'verification.action-diagnostics',
      subjectDigest: action.actionKey as SecOperationDigest,
      settlementDigest: input.processSettlement.providerReceiptDigest,
      streams: input.streams,
      signal: input.signal
    });
  }

  async close(): Promise<void> {
    const authorities = [...this.#runtimeAuthorities.values()];
    this.#runtimeAuthorities.clear();
    this.#diagnosticStores.clear();
    this.#journalFileSystems.clear();
    this.#journalFileSystemPromises.clear();
    for (const authority of authorities) await authority.release();
  }

  #retainedJournalFileSystem(repositoryRoot: string): RuntimeStateJournalFileSystem {
    const physicalRoot = realpathSync.native(path.resolve(repositoryRoot));
    const fs = this.#journalFileSystems.get(physicalRoot);
    if (fs === undefined) {
      throw new Error('VerificationAction journal authority must be acquired before synchronous mutation.');
    }
    return fs;
  }

  async execute(input: VerificationActionExecuteInput): Promise<VerificationActionRunOutcome> {
    const action = canonicalAction(input.action);
    // Process-local join is only valid inside one durable workspace journal
    // authority.  Equal semantic ActionKeys in distinct physical repositories
    // require independent durable terminals; cross-workspace reuse belongs to
    // an authenticated content-addressed evidence owner, not this flight map.
    const coordinationKey = `${realpathSync.native(path.resolve(input.repositoryRoot))}\0${action.actionKey}`;
    const coordination = enterCoordinatedAction(coordinationKey);
    try {
      return await this.#executeCoordinated(input, action, coordination, coordinationKey);
    } finally {
      leaveCoordinatedAction(coordinationKey, coordination);
    }
  }

  async #executeCoordinated(
    input: VerificationActionExecuteInput,
    action: VerificationActionKey,
    coordination: CoordinatedAction,
    coordinationKey: string
  ): Promise<VerificationActionRunOutcome> {
    if (input.deadlineAtUnixMs !== undefined
        && (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs < 1)) {
      throw new Error('VerificationAction join deadline must be one positive safe Unix timestamp.');
    }
    const executionDomain = boundedToken(input.executionDomain, 'executionDomain', () => 'process');
    const inheritedContext = EXECUTION_CONTEXT.getStore();
    if (inheritedContext !== undefined && input.ownerToken !== undefined &&
      input.ownerToken !== inheritedContext.ownerToken) {
      throw new Error('ownerToken cannot override the inherited execution owner.');
    }
    const ownerToken = boundedToken(
      inheritedContext?.ownerToken ?? input.ownerToken,
      'ownerToken',
      nextOwnerToken
    );
    const ownerKey = `${ownerToken}\0${coordinationKey}`;
    const ownerKeys = inheritedContext?.ownerKeys;
    if (ownerKeys?.has(ownerKey) && coordination.flight !== null) {
      return outcome(
        action.actionKey,
        'blocked',
        'running',
        null,
        false,
        'reentrant-cycle: same execution owner cannot await its own live action'
      );
    }
    const journalFs = await this.#journalFileSystem(input.repositoryRoot);
    if (input.plan === undefined) {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        'explicit action plan required; scheduler lane and dependency topology are mandatory'
      );
    }
    const plan = parseVerificationActionPlan(encodeVerificationActionData(input.plan));
    if (plan.action.actionKey !== action.actionKey) {
      throw new Error('VerificationAction plan action key does not match execution action.');
    }
    const beforeDependencies = resolveDependencyStates(journalFs, plan);
    const runnable = isVerificationActionRunnable(plan, beforeDependencies);
    if (!runnable.runnable) {
      return outcome(action.actionKey, 'blocked', null, null, false, runnable.reason);
    }

    // Plan authorization is caller-local. A non-runnable caller must not join
    // an already-running action and inherit a terminal projection it lacks.
    const existingFlight = coordination.flight;
    if (existingFlight !== null) {
      const joined = await existingFlight;
      return outcome(
        joined.actionKey,
        'joined',
        joined.state,
        joined.terminal,
        false,
        joined.reason,
        joined.subordinateSettlement
      );
    }

    const claim = acquireVerificationActionClaim({
      fs: journalFs,
      action,
      ownerToken,
      now: input.recordedAt?.() ?? new Date().toISOString(),
      leaseDurationMs: input.leaseDurationMs
    });
    if (claim.disposition === 'terminal') {
      const terminalJournal = readVerificationActionJournal(journalFs, action.actionKey);
      return outcome(action.actionKey, 'reused', 'reused', claim.terminal, false,
        claim.terminal?.status === 'failed' ? 'known terminal failure reused; never projected as PASS' : null,
        persistedSubordinateSettlement(terminalJournal));
    }
    if (claim.disposition === 'joined') {
      if (claim.claim === null) {
        return outcome(
          action.actionKey,
          'blocked',
          'running',
          null,
          false,
          'joined durable Action has no authenticated live claim'
        );
      }
      return waitForJoinedActionTerminal({
        fs: journalFs,
        actionKey: action.actionKey,
        claim: claim.claim,
        deadlineAtUnixMs: Math.min(
          input.deadlineAtUnixMs ?? Date.now() + (input.leaseDurationMs ?? 300_000),
          Date.parse(claim.claim.expiresAt)
        ),
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
    }
    if (claim.disposition === 'blocked' || claim.disposition === 'contended') {
      return outcome(action.actionKey, 'blocked', null, null, false, claim.reason);
    }
    const releaseClaim = () => releaseVerificationActionClaim({
      fs: journalFs,
      actionKey: action.actionKey,
      ownerToken
    });
    const leaseDurationMs = input.leaseDurationMs ?? 300_000;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      try {
        if (!renewVerificationActionClaim({
          fs: journalFs,
          actionKey: action.actionKey,
          ownerToken,
          now: input.recordedAt?.() ?? new Date().toISOString(),
          leaseDurationMs
        })) leaseLost = true;
      } catch { leaseLost = true; }
    }, Math.max(250, Math.floor(leaseDurationMs / 3)));
    heartbeat.unref();
    const stopHeartbeat = () => clearInterval(heartbeat);

    const journal = readVerificationActionJournal(journalFs, action.actionKey);
    if (journal.latestState === 'invalidated' || journal.latestState === 'cancelled') {
      stopHeartbeat();
      releaseClaim();
      return outcome(action.actionKey, 'blocked', journal.latestState, null, false,
        `action is already ${journal.latestState}; delete the disposable V2 journal to execute cleanly`);
    }
    if (journal.latestState === 'terminal' || journal.latestState === 'reused') {
      stopHeartbeat();
      releaseClaim();
      if (journal.terminal === null) throw new Error('VerificationAction terminal state has no terminal fact.');
      return outcome(action.actionKey, 'reused', 'reused', journal.terminal, false,
        journal.terminal.status === 'failed' ? 'known terminal failure reused; never projected as PASS' : null,
        persistedSubordinateSettlement(journal));
    }
    if (journal.latestState === 'queued' || journal.latestState === 'running') {
      stopHeartbeat();
      releaseClaim();
      return outcome(action.actionKey, 'blocked', journal.latestState, null, false,
        `persisted ${journal.latestState} action has no provable terminal; blind re-execution is forbidden`);
    } else {
      try {
        appendVerificationActionJournalEvent({ fs: journalFs, action,
          state: 'queued', recordedAt: input.recordedAt?.(), note: null });
      } catch (error) {
        // The durable queued transition is the cross-process physical-start
        // linearization point.  A contender can observe an empty journal and
        // then lose the queued CAS after another process has published it;
        // that contender must join the durable generation, not turn the
        // expected race into a second start or a provider failure.
        const concurrent = readVerificationActionJournal(journalFs, action.actionKey);
        if (concurrent.latestState === 'queued' || concurrent.latestState === 'running'
            || concurrent.latestState === 'terminal' || concurrent.latestState === 'reused') {
          stopHeartbeat();
          return outcome(
            action.actionKey,
            concurrent.latestState === 'terminal' || concurrent.latestState === 'reused'
              ? 'reused'
              : 'joined',
            concurrent.latestState,
            concurrent.terminal,
            false,
            concurrent.terminal === null
              ? 'another process published the durable physical-start transition'
              : null,
            concurrent.terminal === null
              ? null
              : persistedSubordinateSettlement(concurrent)
          );
        }
        stopHeartbeat();
        releaseClaim();
        throw error;
      }
      appendVerificationActionJournalEvent({ fs: journalFs, action,
        state: 'running', recordedAt: input.recordedAt?.(), note: null });
    }

    // The map is populated before the executor callback can run. The deferred
    // body also preserves the owner context for synchronous and awaited nested
    // dispatches, even when they change executionDomain.
    let resolveFlight!: (value: VerificationActionRunOutcome) => void;
    let rejectFlight!: (error: unknown) => void;
    const flight = new Promise<VerificationActionRunOutcome>((resolve, reject) => {
      resolveFlight = resolve;
      rejectFlight = reject;
    });
    coordination.flight = flight;
    void (async () => {
      await Promise.resolve();
      let terminal: VerificationActionTerminal;
      let note: string | null = null;
      try {
        const currentOwnerKeys = new Set(ownerKeys ?? []);
        currentOwnerKeys.add(ownerKey);
        let subordinateRecorded = false;
        const recordSubordinateSettlement = (value: string): void => {
          if (subordinateRecorded) {
            throw new Error('VerificationAction executor registered more than one subordinate settlement.');
          }
          note = boundedSubordinateSettlement(value);
          subordinateRecorded = true;
        };
        const executorResult = await EXECUTION_CONTEXT.run(
          Object.freeze({ ownerToken, ownerKeys: currentOwnerKeys }),
          () => input.executor({
            action,
            executionDomain,
            recordSubordinateSettlement
          })
        );
        terminal = projectVerificationActionTerminal(executorResult);
        if (terminal.actionKey !== action.actionKey) {
          throw new Error('VerificationAction terminal belongs to a different Action identity.');
        }
      } catch (error) {
        const failureState = error instanceof VerificationActionCandidateDriftError
          ? 'invalidated' as const
          : 'cancelled' as const;
        note = boundedExecutionFailureNote(error, failureState);
        try {
          const committed = commitVerificationActionRevocationUnderClaim({
            fs: journalFs,
            action,
            ownerToken,
            now: input.recordedAt?.() ?? new Date().toISOString(),
            state: failureState,
            recordedAt: input.recordedAt?.(),
            note
          });
          stopHeartbeat();
          if (committed === null) {
            const unresolved = readVerificationActionJournal(journalFs, action.actionKey);
            resolveFlight(outcome(
              action.actionKey,
              'blocked',
              unresolved.latestState,
              null,
              true,
              'physical result unresolved because the executor lost its durable claim before settlement'
            ));
            return;
          }
          resolveFlight(outcome(
            action.actionKey,
            'blocked',
            failureState,
            null,
            true,
            note
          ));
        } catch (settlementError) {
          stopHeartbeat();
          rejectFlight(settlementError);
        }
        return;
      }
      const afterExecution = readVerificationActionJournal(
        journalFs,
        action.actionKey
      );
      if (afterExecution.latestState === 'invalidated' || afterExecution.latestState === 'cancelled') {
        stopHeartbeat();
        releaseClaim();
        resolveFlight(outcome(
          action.actionKey,
          'blocked',
          afterExecution.latestState,
          null,
          true,
          `physical result discarded because action was ${afterExecution.latestState}`
        ));
        return;
      }
      const afterDependencies = resolveDependencyStates(journalFs, plan);
      const afterRunnable = isVerificationActionRunnable(plan, afterDependencies);
      if (!dependencyClosureUnchanged(beforeDependencies, afterDependencies) || !afterRunnable.runnable) {
        appendVerificationActionJournalEvent({
          fs: journalFs,
          action,
          state: 'invalidated',
          recordedAt: input.recordedAt?.(),
          note: `dependency closure changed during physical execution; ${afterRunnable.reason ?? 'terminal commit rejected'}`
        });
        stopHeartbeat();
        releaseClaim();
        resolveFlight(outcome(
          action.actionKey,
          'blocked',
          'invalidated',
          null,
          true,
          'physical result discarded because dependency closure was not stable'
        ));
        return;
      }
      try {
        stopHeartbeat();
        if (leaseLost) {
          resolveFlight(outcome(action.actionKey, 'blocked', 'running', null, true,
            'physical result discarded because the durable claim lease was lost'));
          return;
        }
        const committed = commitVerificationActionTerminalUnderClaim({
          fs: journalFs,
          action,
          ownerToken,
          now: input.recordedAt?.() ?? new Date().toISOString(),
          recordedAt: input.recordedAt?.(),
          terminal,
          note
        });
        if (committed === null) {
          resolveFlight(outcome(action.actionKey, 'blocked', 'running', null, true,
            'physical result discarded because terminal commit did not own the live claim'));
          return;
        }
        resolveFlight(outcome(
          action.actionKey,
          'executed',
          'terminal',
          terminal,
          true,
          null,
          note
        ));
      } catch (error) {
        stopHeartbeat();
        releaseClaim();
        rejectFlight(error);
      }
    })().catch((error) => {
      stopHeartbeat();
      releaseClaim();
      rejectFlight(error);
    });
    return await flight;
  }

  /**
   * Execute a producer-owned identity through the same plan/reuse coordinator
   * as every other local action.  Callers cannot omit the dependency topology
   * or manufacture a second reuse path by constructing a plan separately.
   */
  async executeIdentity(
    input: VerificationActionIdentityExecuteInput
  ): Promise<VerificationActionRunOutcome> {
    const { actionInput, executionClass, ...execution } = input;
    const action = createVerificationActionKey(actionInput);
    const dependencies = Object.freeze([
      ...action.requiredCheapPreflightActionKeys.map((actionKey) => Object.freeze({
        actionKey,
        kind: 'cheap-preflight' as const
      })),
      ...action.upstreamActionKeys.map((actionKey) => Object.freeze({
        actionKey,
        kind: 'upstream' as const
      }))
    ]);
    const plan = createVerificationActionPlan({ action, executionClass, dependencies });
    return this.execute({ ...execution, action, plan });
  }

  invalidate(
    repositoryRoot: string,
    action: VerificationActionKey,
    note = 'action input or upstream closure changed'
  ): VerificationActionJournalReadback {
    const canonical = canonicalAction(action);
    const fs = this.#retainedJournalFileSystem(repositoryRoot);
    const current = readVerificationActionJournal(fs, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    return revokeVerificationActionClaim({ fs, action: canonical,
      state: 'invalidated', note });
  }

  cancel(
    repositoryRoot: string,
    action: VerificationActionKey,
    note = 'action cancelled before terminal projection'
  ): VerificationActionJournalReadback {
    const canonical = canonicalAction(action);
    const fs = this.#retainedJournalFileSystem(repositoryRoot);
    const current = readVerificationActionJournal(fs, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    return revokeVerificationActionClaim({ fs, action: canonical,
      state: 'cancelled', note });
  }

  invalidateIfDependent(input: {
    repositoryRoot: string;
    action: VerificationActionKey;
    changedInputPaths: readonly string[] | null;
    changedUpstreamActionKeys?: readonly VerificationActionKeyDigest[];
    note?: string;
  }): VerificationActionJournalReadback {
    const action = canonicalAction(input.action);
    if (!verificationActionDependsOnChangedInputs(
      action,
      input.changedInputPaths,
      input.changedUpstreamActionKeys ?? []
    )) {
      return readVerificationActionJournal(
        this.#retainedJournalFileSystem(input.repositoryRoot),
        action.actionKey
      );
    }
    return this.invalidate(input.repositoryRoot, action, input.note);
  }
}

export function createVerificationActionRunner(): VerificationActionRunner {
  return new VerificationActionRunner();
}

/**
 * Execute one canonical local quick Action DAG for developer feedback.
 *
 * This seam deliberately returns only local journal terminals. It never emits,
 * finalizes, or projects hosted CI Evidence.
 */
export async function executeLocalVerificationActionDag(
  input: ExecuteLocalVerificationActionDagInput
): Promise<LocalVerificationActionDagResult> {
  if (input.testProcessProvider !== undefined && (
    input.testProcessIssuer === undefined
    || !ISSUED_VERIFICATION_ACTION_TEST_PROCESS_ISSUERS.has(input.testProcessIssuer)
  )) {
    throw new Error('local VerificationAction test process provider requires an owner-issued test issuer.');
  }
  if (input.testProcessProvider === undefined && input.testProcessIssuer !== undefined) {
    throw new Error('local VerificationAction test process issuer is unused.');
  }
  const authorityRoot = realpathSync.native(path.resolve(input.authorityRoot));
  const candidateRoot = path.resolve(input.candidateRoot);
  const closure = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(input.actionPlanClosure)
  );
  const executionEnvironment = input.executionEnvironment;
  if (executionEnvironment.kind !== 'local' || executionEnvironment.runnerImage !== null) {
    throw new Error('local VerificationAction DAG requires one canonical local execution environment.');
  }
  if (closure.actions.length === 0 || closure.actions.length !== closure.normalizedOperations.length) {
    throw new Error('local VerificationAction DAG requires one non-empty canonical Action closure.');
  }
  const firstOperation = closure.normalizedOperations[0]!;
  if (closure.normalizedOperations.some((operation) =>
    operation.phase !== 'quick' ||
    operation.candidate.executionEnvironmentRevision !== executionEnvironment.executionEnvironmentRevision ||
    operation.candidate.profile !== 'quick'
  ) || closure.actions.some((plan) =>
    plan.action.environment.providerRevision !== executionEnvironment.executionEnvironmentRevision ||
    plan.action.environment.toolchainRevision !== executionEnvironment.toolchainRevision
  )) {
    throw new Error('local VerificationAction DAG closure/environment identity mismatch.');
  }
  const authority = input.inspectRepository(authorityRoot);
  const candidate = input.inspectRepository(candidateRoot);
  if (!authority.trackedClean || !candidate.trackedClean ||
      canonicalCommonDirectory(authority.gitCommonDirectory) !==
        canonicalCommonDirectory(candidate.gitCommonDirectory) ||
      candidate.headSha !== firstOperation.candidate.headSha ||
      candidate.headTreeSha !== firstOperation.candidate.headTreeSha ||
      closure.normalizedOperations.some((operation) =>
        operation.candidate.headSha !== candidate.headSha ||
        operation.candidate.headTreeSha !== candidate.headTreeSha
      )) {
    throw new Error('local VerificationAction DAG requires the exact clean candidate head and tree.');
  }

  const ownsRunner = input.runner === undefined;
  const runner = input.runner ?? createVerificationActionRunner();
  try {
  const actionResults: VerificationActionRunOutcome[] = [];
  for (let index = 0; index < closure.actions.length; index += 1) {
    const plan = closure.actions[index]!;
    const normalizedOperation = closure.normalizedOperations[index]!;
    const boundOperation = bindLocalDagOperation({
      action: plan.action,
      normalizedOperation,
      executionEnvironment,
      deadlineAtUnixMs: Math.min(
        input.deadlineAtUnixMs ?? Number.MAX_SAFE_INTEGER,
        Date.now() + VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.durationMs
      )
    });
    const result = await runner.execute({
      repositoryRoot: authorityRoot,
      action: plan.action,
      plan,
      executionDomain: `local-dev-runner:${executionEnvironment.executionEnvironmentRevision}`,
      recordedAt: input.recordedAt,
      deadlineAtUnixMs: boundOperation.plan.attempt.deadlineAtUnixMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      executor: async () => {
        const session = openProcessResourceSession({
          operation: boundOperation,
          requirementBindingContext: issueSecOperationRequirementBindingContext({
            operation: boundOperation,
            requirementId: 'verification.local-provider',
            resourceCeilings: [
              {
                resource: 'duration-ms',
                maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.durationMs
              },
              {
                resource: 'input-bytes',
                maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStdoutBytes
                  + VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStderrBytes
              },
              {
                resource: 'output-bytes',
                maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStdoutBytes
                  + VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStderrBytes
              },
              {
                resource: 'processes',
                maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.processes
              }
            ]
          }),
          signal: input.signal
        });
        const process: VerificationActionProcessExecutionContext = Object.freeze({
          session,
          maxStderrBytes: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStderrBytes,
          maxStdoutBytes: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStdoutBytes
        });
        let physicalResult: ProcessResourceRunResult;
        try {
          physicalResult = canonicalProcessRunResult(
            input.executeActionPlan !== undefined
              ? await input.executeActionPlan({
                plan,
                authorizedClosure: closure,
                repositoryRoot: candidateRoot,
                environment: input.environment,
                process
              })
              : input.testProcessProvider !== undefined
                ? await input.testProcessProvider(normalizedOperation, process)
                : (() => {
                  throw new Error('local VerificationAction DAG physical provider is unavailable');
                })()
          );
        } catch (error) {
          try {
            session.close();
          } catch (closeError) {
            throw new AggregateError(
              [error, closeError],
              'local VerificationAction provider and process settlement both failed'
            );
          }
          throw error;
        }
        const processReceipt = session.close();
        if (processReceipt.processCount !== VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.processes
            || processReceipt.failedProcessCount !== 0
            || processReceipt.boundAttemptDigest !== boundOperation.boundAttemptDigest
            || processReceipt.operationIdentityDigest !== boundOperation.plan.identity.identityDigest) {
          throw new Error('local VerificationAction process receipt does not settle the exact attempt.');
        }
        const providerSettlement = issueSecProviderSettlementReceipt(boundOperation, {
          requirementId: 'verification.local-provider',
          physicalDisposition: 'settled',
          providerSettlementReferenceDigest: localDagDigest({
            processReceipt,
            ordinal: physicalResult.ordinal,
            exitCode: physicalResult.result.code,
            stdoutDigest: rawDigest(physicalResult.result.stdout),
            stderrDigest: rawDigest(physicalResult.result.stderr)
          })
        });
        const diagnosticObjects = await runner.publishBoundProcessDiagnostics({
          repositoryRoot: authorityRoot,
          action: plan.action,
          operation: boundOperation,
          processSettlement: providerSettlement,
          streams: [
            { stream: 'stdout', bytes: physicalResult.result.stdout },
            { stream: 'stderr', bytes: new TextEncoder().encode(physicalResult.result.stderr) }
          ],
          signal: input.signal
        });
        const diagnosticSettlement = issueSecProviderSettlementReceipt(boundOperation, {
          requirementId: 'verification.action-diagnostics',
          physicalDisposition: 'settled',
          providerSettlementReferenceDigest: localDagDigest(
            diagnosticObjects.map(({ receipt, readback }) => ({
              objectDigest: receipt.objectDigest,
              readbackDigest: readback.readbackDigest
            }))
          )
        });
        const providerSettlementSet = compileSecProviderSettlementSet(
          boundOperation,
          [providerSettlement, diagnosticSettlement]
        );
        const candidateAfter = input.inspectRepository(candidateRoot);
        if (!candidateAfter.trackedClean
            || candidateAfter.headSha !== normalizedOperation.candidate.headSha
            || candidateAfter.headTreeSha !== normalizedOperation.candidate.headTreeSha
            || canonicalCommonDirectory(candidateAfter.gitCommonDirectory)
              !== canonicalCommonDirectory(candidate.gitCommonDirectory)) {
          throw new VerificationActionCandidateDriftError(
            'local VerificationAction candidate readback drifted after process settlement.'
          );
        }
        const readback = issueSecNormalDomainReadbackReceipt(
          boundOperation,
          providerSettlementSet,
          {
            readbackContractDigest: localDagDigest({
              contract: 'verification.local-candidate-readback',
              operationDigest: normalizedOperation.semanticDigest
            }),
            readbackReferenceDigest: localDagDigest(candidateAfter),
            currentPhysicalEpochDigest: localDagDigest({
              headSha: candidateAfter.headSha,
              headTreeSha: candidateAfter.headTreeSha,
              gitCommonDirectory: candidateAfter.gitCommonDirectory
            }),
            disposition: 'applied'
          }
        );
        const ownerTerminalJoin = issueSecNormalOwnerTerminalJoinReceipt(
          boundOperation,
          providerSettlementSet,
          readback,
          {
            ownerTerminalContractDigest: localDagDigest({
              contract: 'verification.action-terminal',
              resultSchemaRevision: plan.action.resultSchemaRevision
            }),
            ownerTerminalReferenceDigest: localDagDigest({
              actionKey: plan.action.actionKey,
              operationDigest: normalizedOperation.semanticDigest,
              exitCode: physicalResult.result.code,
              diagnosticObjects: diagnosticObjects.map(({ receipt, readback }) => ({
                objectDigest: receipt.objectDigest,
                readbackDigest: readback.readbackDigest
              })),
              candidate: candidateAfter
            })
          }
        );
        const actionTerminalReceipt = issueVerificationActionOwnerTerminalReceipt({
          action: plan.action,
          operation: boundOperation,
          providerSettlementSet,
          readback,
          ownerTerminalProjection: ownerTerminalJoin
        });
        return issueProcessVerificationActionTerminalSettlement(actionTerminalReceipt, {
          status: physicalResult.result.code === 0 ? 'passed' : 'failed',
          reasonCode: physicalResult.result.code === 0
            ? 'executed-success'
            : 'executed-failure',
          diagnosticObjects
        });
      }
    });
    actionResults.push(result);
  }
  const status = actionResults.some((entry) => entry.disposition === 'blocked' || entry.terminal === null)
    ? 'blocked' as const
    : actionResults.some((entry) => entry.terminal?.status !== 'passed')
      ? 'failed' as const
      : 'passed' as const;
  const withoutDigest = Object.freeze({
    schema: LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA,
    actionPlanDigest: closure.actionPlanDigest as VerificationActionKeyDigest,
    executionEnvironmentRevision: executionEnvironment.executionEnvironmentRevision,
    status,
    actionResults: Object.freeze(actionResults)
  });
  return Object.freeze({ ...withoutDigest, terminalDigest: localDagDigest(withoutDigest) });
  } finally {
    if (ownsRunner) await runner.close();
  }
}
