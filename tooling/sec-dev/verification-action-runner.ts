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
import { executeVerifiedCiActionPlanV1 } from '../../platform/dev-runner/verification-action-executor.ts';
import {
  parseCiVerificationActionPlanClosureV1,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationExecutionEnvironmentV2,
  type CiVerificationNormalizedOperationV2
} from '../../platform/shared/verification-action-ci-contract.ts';
import {
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  isVerificationActionRunnableV2,
  parseVerificationActionKeyV2,
  parseVerificationActionPlanV2,
  verificationActionDependsOnChangedInputsV2,
  type VerificationActionDependencyResolutionV2,
  type VerificationActionDependencyStateV2,
  type VerificationActionDependencyV2,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV2,
  type VerificationActionPlanV2,
  type VerificationActionTerminalV2
} from '../../platform/shared/verification-action-contract.ts';
import { acquireSecRuntimeJournalAuthorityV1 } from './runtime-state-authority.ts';
import {
  createRuntimeStateJournalFileSystemV1,
  type RuntimeStateJournalFileSystemV1
} from './runtime-state-journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from './runtime-state-paths.ts';
import {
  acquireVerificationActionClaimV1,
  appendVerificationActionJournalEventV2,
  commitVerificationActionTerminalUnderClaimV1,
  readVerificationActionJournalV2,
  releaseVerificationActionClaimV1,
  renewVerificationActionClaimV1,
  revokeVerificationActionClaimV1,
  type VerificationActionJournalReadbackV2,
  type VerificationActionJournalStateV2
} from './verification-action-journal.ts';

export type VerificationActionRunDispositionV2 = 'executed' | 'joined' | 'reused' | 'blocked';

export interface VerificationActionRunOutcomeV2 {
  readonly actionKey: VerificationActionKeyDigest;
  readonly disposition: VerificationActionRunDispositionV2;
  readonly state: VerificationActionJournalStateV2 | null;
  readonly terminal: VerificationActionTerminalV2 | null;
  readonly physicalExecution: boolean;
  readonly reason: string | null;
}

export const LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA_V2 =
  'sec-local-verification-action-dag-result-v2' as const;

export type LocalVerificationActionDagResultV2 = Readonly<{
  schema: typeof LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA_V2;
  actionPlanDigest: VerificationActionKeyDigest;
  executionEnvironmentRevision: string;
  status: 'passed' | 'failed' | 'blocked';
  actionResults: readonly VerificationActionRunOutcomeV2[];
  terminalDigest: VerificationActionKeyDigest;
}>;

export type ExecuteLocalVerificationActionDagInputV2 = Readonly<{
  /** Trusted checkout that owns the durable local Action journal. */
  authorityRoot: string;
  /** Detached exact-candidate worktree used only for physical execution. */
  candidateRoot: string;
  actionPlanClosure: CiVerificationActionPlanClosureV1;
  executionEnvironment: CiVerificationExecutionEnvironmentV2;
  environment?: NodeJS.ProcessEnv;
  runner?: VerificationActionRunnerV2;
  recordedAt?: () => string;
  executeNormalizedOperation?: (
    operation: CiVerificationNormalizedOperationV2
  ) => Promise<number> | number;
  inspectRepository: VerificationActionRepositoryInspectorV2;
}>;

export type VerificationActionRepositoryObservationV2 = Readonly<{
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
export type VerificationActionRepositoryInspectorV2 = (
  repositoryRoot: string
) => VerificationActionRepositoryObservationV2;

export type VerificationActionExecutorV2 = (
  context: Readonly<{
    action: VerificationActionKeyV2;
    executionDomain: string;
  }>
) => Promise<VerificationActionTerminalV2> | VerificationActionTerminalV2;

export interface VerificationActionExecuteInputV2 {
  readonly repositoryRoot: string;
  readonly action: VerificationActionKeyV2;
  readonly executionDomain?: string;
  /** Stable identity of the physical owner; nested calls inherit it. */
  readonly ownerToken?: string;
  readonly plan?: VerificationActionPlanV2;
  readonly executor: VerificationActionExecutorV2;
  readonly recordedAt?: () => string;
  readonly leaseDurationMs?: number;
}

type InFlight = Promise<VerificationActionRunOutcomeV2>;
type ExecutionContext = Readonly<{
  ownerToken: string;
  ownerKeys: ReadonlySet<string>;
}>;

// A live flight is process-wide by semantic ActionKey. Execution domain is
// executor metadata, not a second physical identity.
const IN_FLIGHT_ACTIONS = new Map<VerificationActionKeyDigest, InFlight>();
const EXECUTION_CONTEXT = new AsyncLocalStorage<ExecutionContext>();
let ownerSequence = 0;

function canonicalAction(action: unknown): VerificationActionKeyV2 {
  return parseVerificationActionKeyV2(encodeVerificationActionDataV2(action));
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
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function resolveDependency(
  fs: RuntimeStateJournalFileSystemV1,
  dependency: VerificationActionDependencyV2
): VerificationActionDependencyResolutionV2 {
  const journal = readVerificationActionJournalV2(fs, dependency.actionKey);
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
  let state: VerificationActionDependencyStateV2;
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
  fs: RuntimeStateJournalFileSystemV1,
  plan: VerificationActionPlanV2
): readonly VerificationActionDependencyResolutionV2[] {
  return Object.freeze(plan.dependencies.map((dependency) => Object.freeze(
    resolveDependency(fs, dependency)
  )));
}

function dependencyClosureUnchanged(
  before: readonly VerificationActionDependencyResolutionV2[],
  after: readonly VerificationActionDependencyResolutionV2[]
): boolean {
  if (before.length !== after.length) return false;
  return before.every((entry, index) => {
    const candidate = after[index];
    return candidate !== undefined && candidate.actionKey === entry.actionKey &&
      candidate.state === entry.state &&
      (candidate.observationDigest ?? null) === (entry.observationDigest ?? null);
  });
}

function failedTerminal(): VerificationActionTerminalV2 {
  return createVerificationActionTerminalV2({
    status: 'failed',
    reasonCode: 'executed-failure',
    resultDigest: null
  });
}

function outcome(
  actionKey: VerificationActionKeyDigest,
  disposition: VerificationActionRunDispositionV2,
  state: VerificationActionJournalStateV2 | null,
  terminal: VerificationActionTerminalV2 | null,
  physicalExecution: boolean,
  reason: string | null
): VerificationActionRunOutcomeV2 {
  return Object.freeze({
    actionKey,
    disposition,
    state,
    terminal,
    physicalExecution,
    reason
  });
}





export class VerificationActionRunnerV2 {
  readonly #journalFileSystemPromises = new Map<string, Promise<RuntimeStateJournalFileSystemV1>>();
  readonly #journalFileSystems = new Map<string, RuntimeStateJournalFileSystemV1>();

  async #journalFileSystem(repositoryRoot: string): Promise<RuntimeStateJournalFileSystemV1> {
    const physicalRoot = realpathSync.native(path.resolve(repositoryRoot));
    let pending = this.#journalFileSystemPromises.get(physicalRoot);
    if (pending === undefined) {
      pending = (async () => {
        const authority = await acquireSecRuntimeJournalAuthorityV1({ repositoryRoot: physicalRoot });
        await authority.assertCurrent();
        const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot: physicalRoot });
        const fs = createRuntimeStateJournalFileSystemV1(
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

  #retainedJournalFileSystem(repositoryRoot: string): RuntimeStateJournalFileSystemV1 {
    const physicalRoot = realpathSync.native(path.resolve(repositoryRoot));
    const fs = this.#journalFileSystems.get(physicalRoot);
    if (fs === undefined) {
      throw new Error('VerificationAction journal authority must be acquired before synchronous mutation.');
    }
    return fs;
  }

  async execute(input: VerificationActionExecuteInputV2): Promise<VerificationActionRunOutcomeV2> {
    const action = canonicalAction(input.action);
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
    if (ownerKeys?.has(ownerKey) && IN_FLIGHT_ACTIONS.has(action.actionKey)) {
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
    const plan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(input.plan));
    if (plan.action.actionKey !== action.actionKey) {
      throw new Error('VerificationAction plan action key does not match execution action.');
    }
    const beforeDependencies = resolveDependencyStates(journalFs, plan);
    const runnable = isVerificationActionRunnableV2(plan, beforeDependencies);
    if (!runnable.runnable) {
      return outcome(action.actionKey, 'blocked', null, null, false, runnable.reason);
    }

    // Plan authorization is caller-local. A non-runnable caller must not join
    // an already-running action and inherit a terminal projection it lacks.
    const existingFlight = IN_FLIGHT_ACTIONS.get(action.actionKey);
    if (existingFlight !== undefined) {
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

    const claim = acquireVerificationActionClaimV1({
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
    const releaseClaim = () => releaseVerificationActionClaimV1({
      fs: journalFs,
      actionKey: action.actionKey,
      ownerToken
    });
    const leaseDurationMs = input.leaseDurationMs ?? 300_000;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      try {
        if (!renewVerificationActionClaimV1({
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

    const journal = readVerificationActionJournalV2(journalFs, action.actionKey);
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
      appendVerificationActionJournalEventV2({ fs: journalFs, action,
        state: 'queued', recordedAt: input.recordedAt?.(), note: null });
      appendVerificationActionJournalEventV2({ fs: journalFs, action,
        state: 'running', recordedAt: input.recordedAt?.(), note: null });
    }

    // The map is populated before the executor callback can run. The deferred
    // body also preserves the owner context for synchronous and awaited nested
    // dispatches, even when they change executionDomain.
    let resolveFlight!: (value: VerificationActionRunOutcomeV2) => void;
    let rejectFlight!: (error: unknown) => void;
    const flight = new Promise<VerificationActionRunOutcomeV2>((resolve, reject) => {
      resolveFlight = resolve;
      rejectFlight = reject;
    });
    IN_FLIGHT_ACTIONS.set(action.actionKey, flight);
    void (async () => {
      await Promise.resolve();
      let terminal: VerificationActionTerminalV2;
      let note: string | null = null;
      try {
        const currentOwnerKeys = new Set(ownerKeys ?? []);
        currentOwnerKeys.add(ownerKey);
        const executorResult = await EXECUTION_CONTEXT.run(
          Object.freeze({ ownerToken, ownerKeys: currentOwnerKeys }),
          () => input.executor({ action, executionDomain })
        );
        terminal = createVerificationActionTerminalV2(executorResult);
      } catch (error) {
        terminal = failedTerminal();
        note = boundedError(error);
      }
      const afterExecution = readVerificationActionJournalV2(
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
      const afterRunnable = isVerificationActionRunnableV2(plan, afterDependencies);
      if (!dependencyClosureUnchanged(beforeDependencies, afterDependencies) || !afterRunnable.runnable) {
        appendVerificationActionJournalEventV2({
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
        const committed = commitVerificationActionTerminalUnderClaimV1({
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
    try {
      return await flight;
    } finally {
      if (IN_FLIGHT_ACTIONS.get(action.actionKey) === flight) {
        IN_FLIGHT_ACTIONS.delete(action.actionKey);
      }
    }
  }

  invalidate(
    repositoryRoot: string,
    action: VerificationActionKeyV2,
    note = 'action input or upstream closure changed'
  ): VerificationActionJournalReadbackV2 {
    const canonical = canonicalAction(action);
    const fs = this.#retainedJournalFileSystem(repositoryRoot);
    const current = readVerificationActionJournalV2(fs, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    return revokeVerificationActionClaimV1({ fs, action: canonical,
      state: 'invalidated', note });
  }

  cancel(
    repositoryRoot: string,
    action: VerificationActionKeyV2,
    note = 'action cancelled before terminal projection'
  ): VerificationActionJournalReadbackV2 {
    const canonical = canonicalAction(action);
    const fs = this.#retainedJournalFileSystem(repositoryRoot);
    const current = readVerificationActionJournalV2(fs, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    return revokeVerificationActionClaimV1({ fs, action: canonical,
      state: 'cancelled', note });
  }

  invalidateIfDependent(input: {
    repositoryRoot: string;
    action: VerificationActionKeyV2;
    changedInputPaths: readonly string[] | null;
    changedUpstreamActionKeys?: readonly VerificationActionKeyDigest[];
    note?: string;
  }): VerificationActionJournalReadbackV2 {
    const action = canonicalAction(input.action);
    if (!verificationActionDependsOnChangedInputsV2(
      action,
      input.changedInputPaths,
      input.changedUpstreamActionKeys ?? []
    )) {
      return readVerificationActionJournalV2(
        this.#retainedJournalFileSystem(input.repositoryRoot),
        action.actionKey
      );
    }
    return this.invalidate(input.repositoryRoot, action, input.note);
  }
}

export function createVerificationActionRunnerV2(): VerificationActionRunnerV2 {
  return new VerificationActionRunnerV2();
}

/**
 * Execute one canonical local quick Action DAG for developer feedback.
 *
 * This seam deliberately returns only local journal terminals. It never emits,
 * finalizes, or projects hosted CI Evidence.
 */
export async function executeLocalVerificationActionDagV2(
  input: ExecuteLocalVerificationActionDagInputV2
): Promise<LocalVerificationActionDagResultV2> {
  const authorityRoot = realpathSync.native(path.resolve(input.authorityRoot));
  const candidateRoot = path.resolve(input.candidateRoot);
  const closure = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(input.actionPlanClosure)
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
  const canonicalCommonDirectory = (value: string): string => (
    process.platform === 'win32' ? realpathSync.native(value).toLowerCase() : realpathSync.native(value)
  );
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

  const runner = input.runner ?? createVerificationActionRunnerV2();
  const actionResults: VerificationActionRunOutcomeV2[] = [];
  for (let index = 0; index < closure.actions.length; index += 1) {
    const plan = closure.actions[index]!;
    const normalizedOperation = closure.normalizedOperations[index]!;
    const result = await runner.execute({
      repositoryRoot: authorityRoot,
      action: plan.action,
      plan,
      executionDomain: `local-dev-runner:${executionEnvironment.executionEnvironmentRevision}`,
      recordedAt: input.recordedAt,
      executor: async () => {
        const exitCode = await executeVerifiedCiActionPlanV1({
          plan,
          authorizedClosure: closure,
          repositoryRoot: candidateRoot,
          environment: input.environment,
          executeNormalizedOperation: input.executeNormalizedOperation
        });
        const status = exitCode === 0 ? 'passed' as const : 'failed' as const;
        return createVerificationActionTerminalV2({
          status,
          reasonCode: status === 'passed' ? 'executed-success' : 'executed-failure',
          resultDigest: localDagDigest({
            actionKey: plan.action.actionKey,
            normalizedOperationDigest: normalizedOperation.semanticDigest,
            exitCode,
            executionEnvironmentRevision: executionEnvironment.executionEnvironmentRevision
          })
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
    schema: LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA_V2,
    actionPlanDigest: closure.actionPlanDigest as VerificationActionKeyDigest,
    executionEnvironmentRevision: executionEnvironment.executionEnvironmentRevision,
    status,
    actionResults: Object.freeze(actionResults)
  });
  return Object.freeze({ ...withoutDigest, terminalDigest: localDagDigest(withoutDigest) });
}
