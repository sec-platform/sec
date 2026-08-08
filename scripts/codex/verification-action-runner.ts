/**
 * Minimal local VerificationAction execution coordinator.
 *
 * The coordinator owns physical-start/reuse/join decisions only. It never
 * promotes a journal observation into VerificationResult truth and never
 * invokes the trusted CI/dev-runner surfaces.
 */

import {
  createVerificationActionPlanV1,
  createVerificationActionTerminalV1,
  isVerificationActionRunnableV1,
  parseVerificationActionKeyV1,
  verificationActionDependsOnChangedInputsV1,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV1,
  type VerificationActionPlanV1,
  type VerificationActionTerminalV1
} from './verification-action-contract.ts';
import {
  appendVerificationActionJournalEventV1,
  readVerificationActionJournalV1,
  type VerificationActionJournalReadbackV1,
  type VerificationActionJournalStateV1
} from './verification-action-journal.ts';

export type VerificationActionRunDispositionV1 = 'executed' | 'joined' | 'reused' | 'blocked';

export interface VerificationActionRunOutcomeV1 {
  readonly actionKey: VerificationActionKeyDigest;
  readonly disposition: VerificationActionRunDispositionV1;
  readonly state: VerificationActionJournalStateV1 | null;
  readonly terminal: VerificationActionTerminalV1 | null;
  readonly physicalExecution: boolean;
  readonly reason: string | null;
}

export type VerificationActionExecutorV1 = (
  context: Readonly<{
    action: VerificationActionKeyV1;
    executionDomain: string;
  }>
) => Promise<VerificationActionTerminalV1> | VerificationActionTerminalV1;

export interface VerificationActionExecuteInputV1 {
  readonly repositoryRoot: string;
  readonly action: VerificationActionKeyV1;
  readonly executionDomain?: string;
  readonly plan?: VerificationActionPlanV1;
  readonly executor: VerificationActionExecutorV1;
  readonly recordedAt?: () => string;
}

type InFlight = Promise<VerificationActionRunOutcomeV1>;

// A live execution domain is process-wide. Keeping this registry outside the
// class prevents two coordinator instances in one process from double-spawning
// the same semantic ActionKey.
const IN_FLIGHT_ACTIONS = new Map<string, InFlight>();

function canonicalAction(action: VerificationActionKeyV1): VerificationActionKeyV1 {
  return parseVerificationActionKeyV1(JSON.stringify(action));
}

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const sanitized = text.replace(/[\u0000-\u001f]/gu, ' ');
  return `executor threw: ${sanitized}`.slice(0, 1024);
}

function failedTerminal(): VerificationActionTerminalV1 {
  return createVerificationActionTerminalV1({
    status: 'failed',
    reasonCode: 'executed-failure',
    resultDigest: null
  });
}

function outcome(
  actionKey: VerificationActionKeyDigest,
  disposition: VerificationActionRunDispositionV1,
  state: VerificationActionJournalStateV1 | null,
  terminal: VerificationActionTerminalV1 | null,
  physicalExecution: boolean,
  reason: string | null
): VerificationActionRunOutcomeV1 {
  return Object.freeze({
    actionKey,
    disposition,
    state,
    terminal,
    physicalExecution,
    reason
  });
}

export class VerificationActionRunnerV1 {
  private flightKey(
    executionDomain: string,
    actionKey: VerificationActionKeyDigest
  ): string {
    return `${executionDomain}\0${actionKey}`;
  }

  async execute(input: VerificationActionExecuteInputV1): Promise<VerificationActionRunOutcomeV1> {
    const action = canonicalAction(input.action);
    const executionDomain = input.executionDomain ?? 'process';
    const key = this.flightKey(executionDomain, action.actionKey);
    if (input.plan === undefined) {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        'explicit action plan required; expensive execution must declare a terminal cheap-preflight dependency'
      );
    }
    const plan = createVerificationActionPlanV1(input.plan);
    if (plan.action.actionKey !== action.actionKey) {
      throw new Error('VerificationAction plan action key does not match execution action.');
    }
    const runnable = isVerificationActionRunnableV1(plan);
    if (!runnable.runnable) {
      return outcome(action.actionKey, 'blocked', null, null, false, runnable.reason);
    }

    // Plan authorization is caller-local. A non-runnable caller must not join
    // an already-running action and thereby inherit a terminal projection it
    // was not authorized to request.
    const existingFlight = IN_FLIGHT_ACTIONS.get(key);
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

    const journal = readVerificationActionJournalV1(input.repositoryRoot, action.actionKey);
    if (journal.latestState === 'terminal' || journal.latestState === 'reused') {
      if (journal.terminal === null) {
        throw new Error('VerificationAction journal terminal state has no terminal fact.');
      }
      if (journal.latestState === 'terminal') {
        appendVerificationActionJournalEventV1({
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
        `action is already ${journal.latestState}; delete the disposable journal to execute cleanly`
      );
    }
    if (journal.latestState === 'queued' || journal.latestState === 'running') {
      appendVerificationActionJournalEventV1({
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

    appendVerificationActionJournalEventV1({
      repositoryRoot: input.repositoryRoot,
      action,
      state: 'queued',
      recordedAt: input.recordedAt?.(),
      note: null
    });
    appendVerificationActionJournalEventV1({
      repositoryRoot: input.repositoryRoot,
      action,
      state: 'running',
      recordedAt: input.recordedAt?.(),
      note: null
    });

    // Yield once before invoking the executor so the process-wide registry is
    // populated before any reentrant executor callback can request this key.
    const flight = (async (): Promise<VerificationActionRunOutcomeV1> => {
      await Promise.resolve();
      let terminal: VerificationActionTerminalV1;
      let note: string | null = null;
      try {
        terminal = createVerificationActionTerminalV1(await input.executor({
          action,
          executionDomain
        }));
      } catch (error) {
        terminal = failedTerminal();
        note = boundedError(error);
      }
      const afterExecution = readVerificationActionJournalV1(
        input.repositoryRoot,
        action.actionKey
      );
      if (afterExecution.latestState === 'invalidated' || afterExecution.latestState === 'cancelled') {
        return outcome(
          action.actionKey,
          'blocked',
          afterExecution.latestState,
          null,
          true,
          `physical result discarded because action was ${afterExecution.latestState}`
        );
      }
      appendVerificationActionJournalEventV1({
        repositoryRoot: input.repositoryRoot,
        action,
        state: 'terminal',
        recordedAt: input.recordedAt?.(),
        terminal,
        note
      });
      return outcome(action.actionKey, 'executed', 'terminal', terminal, true, note);
    })();
    IN_FLIGHT_ACTIONS.set(key, flight);
    try {
      return await flight;
    } finally {
      IN_FLIGHT_ACTIONS.delete(key);
    }
  }

  invalidate(
    repositoryRoot: string,
    action: VerificationActionKeyV1,
    note = 'action input or upstream closure changed'
  ): VerificationActionJournalReadbackV1 {
    const canonical = canonicalAction(action);
    const current = readVerificationActionJournalV1(repositoryRoot, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    appendVerificationActionJournalEventV1({
      repositoryRoot,
      action: canonical,
      state: 'invalidated',
      terminal: null,
      note
    });
    return readVerificationActionJournalV1(repositoryRoot, canonical.actionKey);
  }

  cancel(
    repositoryRoot: string,
    action: VerificationActionKeyV1,
    note = 'action cancelled before terminal projection'
  ): VerificationActionJournalReadbackV1 {
    const canonical = canonicalAction(action);
    const current = readVerificationActionJournalV1(repositoryRoot, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    appendVerificationActionJournalEventV1({
      repositoryRoot,
      action: canonical,
      state: 'cancelled',
      terminal: null,
      note
    });
    return readVerificationActionJournalV1(repositoryRoot, canonical.actionKey);
  }

  invalidateIfDependent(input: {
    repositoryRoot: string;
    action: VerificationActionKeyV1;
    changedInputPaths: readonly string[] | null;
    changedUpstreamActionKeys?: readonly VerificationActionKeyDigest[];
    note?: string;
  }): VerificationActionJournalReadbackV1 {
    const action = canonicalAction(input.action);
    if (!verificationActionDependsOnChangedInputsV1(
      action,
      input.changedInputPaths,
      input.changedUpstreamActionKeys ?? []
    )) {
      return readVerificationActionJournalV1(input.repositoryRoot, action.actionKey);
    }
    return this.invalidate(input.repositoryRoot, action, input.note);
  }
}

export function createVerificationActionRunnerV1(): VerificationActionRunnerV1 {
  return new VerificationActionRunnerV1();
}
