/**
 * Minimal local VerificationAction V2 execution coordinator.
 *
 * The coordinator owns physical-start/reuse/join decisions only. It never
 * promotes a journal observation into VerificationResult truth and never
 * invokes trusted CI/dev-runner surfaces.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import {
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import { createRuntimeStateJournalFileSystem, type RuntimeStateJournalFileSystem } from '../../runtime-state/workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeJournalAuthority } from '../../runtime-state/workspace-state/physical-authority.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecDomainOutcomeReceipt,
  issueSecOperationSettlementEnvelope,
  issueSecProviderSettlementReceipt,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import {
  createVerificationActionKey,
  createVerificationActionPlan,
  encodeVerificationActionData,
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
  commitVerificationActionTerminalUnderClaim,
  readVerificationActionJournal,
  releaseVerificationActionClaim,
  renewVerificationActionClaim,
  revokeVerificationActionClaim,
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
const COORDINATED_ACTIONS = new Map<VerificationActionKeyDigest, CoordinatedAction>();
const EXECUTION_CONTEXT = new AsyncLocalStorage<ExecutionContext>();
let ownerSequence = 0;

function enterCoordinatedAction(actionKey: VerificationActionKeyDigest): CoordinatedAction {
  let coordination = COORDINATED_ACTIONS.get(actionKey);
  if (coordination === undefined) {
    coordination = { activeCallers: 0, flight: null };
    COORDINATED_ACTIONS.set(actionKey, coordination);
  }
  coordination.activeCallers += 1;
  return coordination;
}

function leaveCoordinatedAction(
  actionKey: VerificationActionKeyDigest,
  coordination: CoordinatedAction
): void {
  coordination.activeCallers -= 1;
  if (coordination.activeCallers === 0 && COORDINATED_ACTIONS.get(actionKey) === coordination) {
    COORDINATED_ACTIONS.delete(actionKey);
  }
}

function canonicalAction(action: unknown): VerificationActionKey {
  return parseVerificationActionKey(encodeVerificationActionData(action));
}

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const sanitized = text.replace(/[\u0000-\u001f]/gu, ' ');
  return `executor threw: ${sanitized}`.slice(0, 1024);
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
  return `verification-action-owner-${ownerSequence}`;
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
  const contractDigest = localDagDigest({
    contract: 'verification.local-action-execution',
    normalizedOperationDigest: input.normalizedOperation.semanticDigest
  }) as SecOperationDigest;
  const operationPlan = compileSecSemanticOperationPlan({
    operation: 'verification.local-action',
    intentDigest: input.action.actionKey as SecOperationDigest,
    decisionDigest: input.normalizedOperation.semanticDigest as SecOperationDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    aggregateBudgets: [
      {
        resource: 'duration-ms',
        maximum: VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.durationMs
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
      contractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed', 'process.settlement-failed']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    })
  });
  const bound = bindSecSemanticOperation(operationPlan, [compileSecCapabilityBinding({
    requirementId: 'verification.local-provider',
    contractDigest,
    providerIdentityDigest: localDagDigest({
      executionEnvironmentRevision: input.executionEnvironment.executionEnvironmentRevision,
      toolchainRevision: input.executionEnvironment.toolchainRevision
    }) as SecOperationDigest
  })]);
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
  reason: string | null
): VerificationActionRunOutcome {
  return Object.freeze({
    actionKey,
    disposition,
    state,
    terminal,
    physicalExecution,
    reason
  });
}





export class VerificationActionRunner {
  readonly #journalFileSystemPromises = new Map<string, Promise<RuntimeStateJournalFileSystem>>();
  readonly #journalFileSystems = new Map<string, RuntimeStateJournalFileSystem>();

  async #journalFileSystem(repositoryRoot: string): Promise<RuntimeStateJournalFileSystem> {
    const physicalRoot = realpathSync.native(path.resolve(repositoryRoot));
    let pending = this.#journalFileSystemPromises.get(physicalRoot);
    if (pending === undefined) {
      pending = (async () => {
        const authority = await acquireSecRuntimeJournalAuthority({ repositoryRoot: physicalRoot });
        await authority.assertCurrent();
        const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: physicalRoot });
        const fs = createRuntimeStateJournalFileSystem(
          authority.directory(roots.workspaceStateRoot)
        );
        this.#journalFileSystems.set(physicalRoot, fs);
        return fs;
      })().catch((error) => {
        this.#journalFileSystemPromises.delete(physicalRoot);
        this.#journalFileSystems.delete(physicalRoot);
        throw error;
      });
      this.#journalFileSystemPromises.set(physicalRoot, pending);
    }
    return pending;
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
    const coordination = enterCoordinatedAction(action.actionKey);
    try {
      return await this.#executeCoordinated(input, action, coordination);
    } finally {
      leaveCoordinatedAction(action.actionKey, coordination);
    }
  }

  async #executeCoordinated(
    input: VerificationActionExecuteInput,
    action: VerificationActionKey,
    coordination: CoordinatedAction
  ): Promise<VerificationActionRunOutcome> {
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
    const ownerKey = `${ownerToken}\0${action.actionKey}`;
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
        joined.reason
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
      return outcome(action.actionKey, 'reused', 'reused', claim.terminal, false,
        claim.terminal?.status === 'failed' ? 'known terminal failure reused; never projected as PASS' : null);
    }
    if (claim.disposition === 'joined') {
      return outcome(action.actionKey, 'joined', 'running', null, false, claim.reason);
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
        journal.terminal.status === 'failed' ? 'known terminal failure reused; never projected as PASS' : null);
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
              : null
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
        const executorResult = await EXECUTION_CONTEXT.run(
          Object.freeze({ ownerToken, ownerKeys: currentOwnerKeys }),
          () => input.executor({ action, executionDomain })
        );
        terminal = projectVerificationActionTerminal(executorResult);
      } catch (error) {
        note = boundedError(error);
        stopHeartbeat();
        releaseClaim();
        resolveFlight(outcome(
          action.actionKey,
          'blocked',
          'running',
          null,
          true,
          `${note}; no owner-issued terminal was committed`
        ));
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
        resolveFlight(outcome(action.actionKey, 'executed', 'terminal', terminal, true, note));
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

  const runner = input.runner ?? createVerificationActionRunner();
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
      executor: async () => {
        const session = openProcessResourceSession({
          operation: boundOperation,
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
          terminalClass: physicalResult.result.code === 0 ? 'completed' : 'failed',
          providerSettlement: {
            processReceipt,
            ordinal: physicalResult.ordinal,
            exitCode: physicalResult.result.code,
            stdoutDigest: rawDigest(physicalResult.result.stdout),
            stderrDigest: rawDigest(physicalResult.result.stderr)
          }
        });
        const candidateAfter = input.inspectRepository(candidateRoot);
        if (!candidateAfter.trackedClean
            || candidateAfter.headSha !== normalizedOperation.candidate.headSha
            || candidateAfter.headTreeSha !== normalizedOperation.candidate.headTreeSha
            || canonicalCommonDirectory(candidateAfter.gitCommonDirectory)
              !== canonicalCommonDirectory(candidate.gitCommonDirectory)) {
          throw new Error('local VerificationAction candidate readback drifted after process settlement.');
        }
        const domainOutcome = issueSecDomainOutcomeReceipt(providerSettlement, {
          terminalClass: providerSettlement.providerTerminalClass,
          effectReadback: candidateAfter,
          domainOutcome: {
            operationDigest: normalizedOperation.semanticDigest,
            status: physicalResult.result.code === 0 ? 'passed' : 'failed'
          }
        });
        return issueSecOperationSettlementEnvelope(
          boundOperation,
          providerSettlement,
          domainOutcome
        );
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
}
