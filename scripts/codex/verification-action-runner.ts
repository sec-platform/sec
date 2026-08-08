/**
 * Minimal local VerificationAction V2 execution coordinator.
 *
 * The coordinator owns physical-start/reuse/join decisions only. It never
 * promotes a journal observation into VerificationResult truth and never
 * invokes trusted CI/dev-runner surfaces.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
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
} from './verification-action-contract.ts';
import {
  appendVerificationActionJournalEventV2,
  readVerificationActionJournalV2,
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

function resolveDependency(
  repositoryRoot: string,
  dependency: VerificationActionDependencyV2
): VerificationActionDependencyResolutionV2 {
  const journal = readVerificationActionJournalV2(repositoryRoot, dependency.actionKey);
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
  repositoryRoot: string,
  plan: VerificationActionPlanV2
): readonly VerificationActionDependencyResolutionV2[] {
  return Object.freeze(plan.dependencies.map((dependency) => Object.freeze(
    resolveDependency(repositoryRoot, dependency)
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
    const beforeDependencies = resolveDependencyStates(input.repositoryRoot, plan);
    const runnable = isVerificationActionRunnableV2(plan, beforeDependencies);
    if (!runnable.runnable) {
      return outcome(action.actionKey, 'blocked', null, null, false, runnable.reason);
    }

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

    const journal = readVerificationActionJournalV2(input.repositoryRoot, action.actionKey);
    if (journal.latestState === 'terminal' || journal.latestState === 'reused') {
      if (journal.terminal === null) {
        throw new Error('VerificationAction journal terminal state has no terminal fact.');
      }
      if (journal.latestState === 'terminal') {
        appendVerificationActionJournalEventV2({
          repositoryRoot: input.repositoryRoot,
          action,
          state: 'reused',
          recordedAt: input.recordedAt?.(),
          terminal: journal.terminal,
          note: 'fresh terminal action reused without physical execution'
        });
      }
      return outcome(
        action.actionKey,
        'reused',
        'reused',
        journal.terminal,
        false,
        journal.terminal.status === 'failed'
          ? 'known terminal failure reused; never projected as PASS'
          : null
      );
    }
    if (journal.latestState === 'invalidated' || journal.latestState === 'cancelled') {
      return outcome(
        action.actionKey,
        'blocked',
        journal.latestState,
        null,
        false,
        `action is already ${journal.latestState}; delete the disposable V2 journal to execute cleanly`
      );
    }
    if (journal.latestState === 'queued' || journal.latestState === 'running') {
      appendVerificationActionJournalEventV2({
        repositoryRoot: input.repositoryRoot,
        action,
        state: 'invalidated',
        recordedAt: input.recordedAt?.(),
        note: `persisted ${journal.latestState} action has no live execution owner; fail closed`
      });
      return outcome(
        action.actionKey,
        'blocked',
        'invalidated',
        null,
        false,
        `persisted ${journal.latestState} action had no live execution owner`
      );
    }

    appendVerificationActionJournalEventV2({
      repositoryRoot: input.repositoryRoot,
      action,
      state: 'queued',
      recordedAt: input.recordedAt?.(),
      note: null
    });
    appendVerificationActionJournalEventV2({
      repositoryRoot: input.repositoryRoot,
      action,
      state: 'running',
      recordedAt: input.recordedAt?.(),
      note: null
    });

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
        input.repositoryRoot,
        action.actionKey
      );
      if (afterExecution.latestState === 'invalidated' || afterExecution.latestState === 'cancelled') {
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
      const afterDependencies = resolveDependencyStates(input.repositoryRoot, plan);
      const afterRunnable = isVerificationActionRunnableV2(plan, afterDependencies);
      if (!dependencyClosureUnchanged(beforeDependencies, afterDependencies) || !afterRunnable.runnable) {
        appendVerificationActionJournalEventV2({
          repositoryRoot: input.repositoryRoot,
          action,
          state: 'invalidated',
          recordedAt: input.recordedAt?.(),
          note: `dependency closure changed during physical execution; ${afterRunnable.reason ?? 'terminal commit rejected'}`
        });
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
        appendVerificationActionJournalEventV2({
          repositoryRoot: input.repositoryRoot,
          action,
          state: 'terminal',
          recordedAt: input.recordedAt?.(),
          terminal,
          note
        });
        resolveFlight(outcome(action.actionKey, 'executed', 'terminal', terminal, true, note));
      } catch (error) {
        rejectFlight(error);
      }
    })().catch((error) => rejectFlight(error));
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
    const current = readVerificationActionJournalV2(repositoryRoot, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    appendVerificationActionJournalEventV2({
      repositoryRoot,
      action: canonical,
      state: 'invalidated',
      terminal: null,
      note
    });
    return readVerificationActionJournalV2(repositoryRoot, canonical.actionKey);
  }

  cancel(
    repositoryRoot: string,
    action: VerificationActionKeyV2,
    note = 'action cancelled before terminal projection'
  ): VerificationActionJournalReadbackV2 {
    const canonical = canonicalAction(action);
    const current = readVerificationActionJournalV2(repositoryRoot, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    appendVerificationActionJournalEventV2({
      repositoryRoot,
      action: canonical,
      state: 'cancelled',
      terminal: null,
      note
    });
    return readVerificationActionJournalV2(repositoryRoot, canonical.actionKey);
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
      return readVerificationActionJournalV2(input.repositoryRoot, action.actionKey);
    }
    return this.invalidate(input.repositoryRoot, action, input.note);
  }
}

export function createVerificationActionRunnerV2(): VerificationActionRunnerV2 {
  return new VerificationActionRunnerV2();
}
