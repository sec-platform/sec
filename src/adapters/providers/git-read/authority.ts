import path from 'node:path';
import { sha256 } from '../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources, settleResourcesAsync as settlePhysicalResourcesAsync, type ResourceSettlementFailure as PhysicalResourceSettlementFailure } from '../../../execution/resource-settlement.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  assertGitReadSessionReceipt,
  createAuthorityGitReadSession,
  isProductionGitReadSession,
  resolveGitReadSessionBudget,
  type GitReadProviderResolutionFailure,
  type GitReadSession,
  type GitReadSessionBudget,
  type GitReadSessionFailure
} from './runtime/session.ts';

const GIT_READ_AUTHORITY_OPERATION = 'external-capabilities.git-read.observe';
const GIT_READ_AUTHORITY_REQUIREMENT = 'git-read.host-process';
const GIT_READ_AUTHORITY_CONTRACT_DIGEST = sha256({
  operation: GIT_READ_AUTHORITY_OPERATION,
  provider: 'host-local-git-v1',
  commandPolicy: 'canonical-read-only-git-command-set',
  retainedBoundary: 'cwd-and-executable-physical-identity-v1'
}) as OperationDigest;
const GIT_READ_AUTHORITY_PROVIDER_DIGEST = sha256({
  provider: 'external-capabilities.git-read',
  route: 'host-local-git-v1',
  retainedBoundary: 'cwd-and-executable-physical-identity-v1'
}) as OperationDigest;

type AuthorityGitReadSessionInput = Omit<
  Parameters<typeof createAuthorityGitReadSession>[0],
  'operation'
> & Readonly<{
  /** A broader caller-owned operation may share its already-frozen process budget. */
  operation?: BoundSemanticOperation;
}>;

/** Compile the canonical read-only Git operation for an enclosing observer.
 * This opens no provider or process. Production session, requirement binding
 * and native observer admission are still required before any actual effect.
 */
export function issueGitReadAuthorityOperation(
  input: Omit<AuthorityGitReadSessionInput, 'operation'>,
  parentDeadlineAtUnixMs?: number
): BoundSemanticOperation {
  const budget = resolveGitReadSessionBudget(input.budget);
  const startedAtUnixMs = Date.now();
  const deadlineAtUnixMs = parentDeadlineAtUnixMs ?? startedAtUnixMs + budget.deadlineMs;
  const operationDurationMs = deadlineAtUnixMs - startedAtUnixMs;
  if (!Number.isSafeInteger(operationDurationMs) || operationDurationMs < 1) {
    throw operationFailure(
      'deadline-exhausted',
      'Git read authority operation deadline is exhausted or invalid.'
    );
  }
  const plan = compileSemanticOperationPlan({
    operation: GIT_READ_AUTHORITY_OPERATION,
    intentDigest: sha256({
      cwd: input.cwd,
      environment: input.environment ?? {},
      budget
    }) as OperationDigest,
    decisionDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST,
    deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: operationDurationMs },
      { resource: 'input-bytes', maximum: budget.maxStdinBytes },
      {
        resource: 'output-bytes',
        maximum: budget.maxStdoutBytes + budget.maxStderrBytes
      },
      { resource: 'processes', maximum: budget.maxProcesses },
      { resource: 'records', maximum: budget.maxRecords }
    ],
    requirements: [{
      id: GIT_READ_AUTHORITY_REQUIREMENT,
      contractDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST,
      effectKinds: ['process', 'provider'],
      failureKinds: [
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.drift',
        'provider.execution-failed',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: GIT_READ_AUTHORITY_REQUIREMENT,
    contractDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST,
    providerIdentityDigest: GIT_READ_AUTHORITY_PROVIDER_DIGEST
  })]);
}

export class GitReadAuthorityError extends Error {
  constructor(
    message: string,
    readonly failure: GitReadProviderResolutionFailure | GitReadSessionFailure
  ) {
    super(message);
    this.name = 'GitReadAuthorityError';
  }
}

function operationFailure(
  reason: GitReadSessionFailure['reason'],
  detail: string
): GitReadAuthorityError {
  return new GitReadAuthorityError(detail, Object.freeze({
    kind: 'unresolved-git-read-session' as const,
    reason,
    detail
  }));
}

export type AuthorityGitReadOperation = Readonly<{
  runPhase: <T>(
    phase: string,
    operation: (session: GitReadSession) => Promise<T>
  ) => Promise<T>;
}>;

type AuthorityGitReadOperationInput = Omit<
  AuthorityGitReadSessionInput,
  'budget' | 'deadlineAtUnixMs' | 'operation' | 'processSession'
> & Readonly<{
  budget: GitReadSessionBudget;
  deadlineAtUnixMs: number;
}>;

const ISSUED_GIT_READ_OPERATIONS = new WeakSet<object>();

function remainingPositive(maximum: number, consumed: number, label: string): number {
  const remaining = maximum - consumed;
  if (!Number.isSafeInteger(remaining) || remaining < 1) {
    throw operationFailure(
      label === 'process' ? 'process-budget-exhausted'
        : label === 'record' ? 'record-budget-exhausted'
          : label === 'stdout-byte' ? 'stdout-budget-exhausted'
            : label === 'stderr-byte' ? 'stderr-budget-exhausted'
              : label === 'argument-byte' ? 'argument-budget-exhausted'
                : label === 'stdin-byte' ? 'stdin-budget-exhausted'
                  : label === 'root-observation-byte' ? 'root-observation-budget-exhausted'
                    : label === 'executable-byte' ? 'executable-budget-exhausted'
                      : label === 'duration-ms' ? 'deadline-exhausted'
                        : 'operation-not-permitted',
      `Git read operation ${label} aggregate budget is exhausted.`
    );
  }
  return remaining;
}

/**
 * One semantic Git observation may need short retained-provider phases around
 * a long-running caller operation. This owner-issued scope fixes the parent
 * deadline once and shares every aggregate counter across those phases; a
 * phase can retain fresh physical handles but cannot reset authority or budget.
 */
export async function withAuthorityGitReadOperation<T>(
  input: AuthorityGitReadOperationInput,
  operation: (scope: AuthorityGitReadOperation) => Promise<T>
): Promise<T> {
  const cwd = process.cwd();
  if (typeof operation !== 'function') throw new TypeError('Git read operation callback must be callable');
  // One private invocation owns the same provider selection, environment and
  // deadline in every phase. Caller edits cannot renew it between phases.
  const { budget: requestedBudget, deadlineAtUnixMs, environment, ...providerInput } = input;
  const budget = resolveGitReadSessionBudget(requestedBudget);
  input = Object.freeze({ ...providerInput, cwd: path.resolve(cwd, providerInput.cwd),
    ...(environment === undefined ? {} : { environment: Object.freeze({ ...environment }) }),
    deadlineAtUnixMs, budget });
  const boundOperation = issueGitReadAuthorityOperation(input, deadlineAtUnixMs);
  const processSession: ProcessResourceSession = openProcessResourceSession({
    operation: boundOperation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation: boundOperation,
      requirementId: GIT_READ_AUTHORITY_REQUIREMENT,
      resourceCeilings: boundOperation.plan.execution.aggregateBudgets.filter(({ resource }) => (
        resource === 'duration-ms'
        || resource === 'input-bytes'
        || resource === 'output-bytes'
        || resource === 'processes'
      ))
    }),
    signal: input.signal
  });
  let active = false;
  const activePhaseSettlements = new Set<Promise<void>>();
  let phaseFailure: PhysicalResourceSettlementFailure | undefined;
  let closed = false;
  let argumentBytes = 0;
  let stdinBytes = 0;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let executableBytes = 0;
  let recordCount = 0;
  let rootObservedBytes = 0;
  let reopenRefreshes = 0;
  let settlementAttempts = 0;
  let activeDurationMs = 0;
  let scope!: AuthorityGitReadOperation;
  const runPhase = <Value>(
    phase: string,
    callback: (session: GitReadSession) => Promise<Value>
  ): Promise<Value> => {
    const phaseResult = (async (): Promise<Value> => {
      if (!ISSUED_GIT_READ_OPERATIONS.has(scope) || closed || active) {
        throw new Error('Git read operation phase requires one live non-reentrant owner-issued scope.');
      }
      // A phase already failed terminal settlement. Catching it in user code
      // cannot reopen a healthy resource ledger for another phase.
      if (phaseFailure !== undefined) throw phaseFailure.error;
      if (typeof phase !== 'string' || phase.length === 0 || phase.includes('\0') || typeof callback !== 'function') {
        throw new Error('Git read operation phase identity is invalid.');
      }
      const now = Date.now();
      const remainingDurationMs = Math.min(
        remainingPositive(budget.deadlineMs, Math.ceil(activeDurationMs), 'duration-ms'),
        input.deadlineAtUnixMs - now
      );
      if (!Number.isSafeInteger(remainingDurationMs) || remainingDurationMs < 1) {
        throw operationFailure(
          'deadline-exhausted',
          `Git read operation ${phase} phase missed its parent deadline.`
        );
      }
      const phaseBudget: GitReadSessionBudget = Object.freeze({
        deadlineMs: remainingDurationMs,
        maxProcesses: remainingPositive(budget.maxProcesses, processSession.processCount, 'process'),
        maxTotalArgumentBytes: remainingPositive(
          budget.maxTotalArgumentBytes,
          argumentBytes,
          'argument-byte'
        ),
        maxStdinBytes: remainingPositive(budget.maxStdinBytes, stdinBytes, 'stdin-byte'),
        maxStdoutBytes: remainingPositive(budget.maxStdoutBytes, stdoutBytes, 'stdout-byte'),
        maxStderrBytes: remainingPositive(budget.maxStderrBytes, stderrBytes, 'stderr-byte'),
        maxRecords: remainingPositive(budget.maxRecords, recordCount, 'record'),
        maxRootObservedBytes: remainingPositive(
          budget.maxRootObservedBytes,
          rootObservedBytes,
          'root-observation-byte'
        ),
        maxReopenRefreshes: remainingPositive(
          budget.maxReopenRefreshes,
          reopenRefreshes,
          'reopen-refresh'
        ),
        maxSettlementAttempts: remainingPositive(
          budget.maxSettlementAttempts,
          settlementAttempts,
          'settlement-attempt'
        ),
        maxCommandStdoutBytes: Math.min(
          budget.maxCommandStdoutBytes,
          remainingPositive(budget.maxStdoutBytes, stdoutBytes, 'stdout-byte')
        ),
        maxCommandStderrBytes: Math.min(
          budget.maxCommandStderrBytes,
          remainingPositive(budget.maxStderrBytes, stderrBytes, 'stderr-byte')
        ),
        maxExecutableBytes: remainingPositive(
          budget.maxExecutableBytes,
          executableBytes,
          'executable-byte'
        )
      });
      const phaseStartedAt = performance.now();
      active = true;
      try {
        let observedSession: GitReadSession | undefined;
        let value: Value | undefined;
        let primary: PhysicalResourceSettlementFailure | undefined;
        try {
          value = await withAuthorityGitReadSession({
            ...input,
            budget: phaseBudget,
            deadlineAtUnixMs: now + remainingDurationMs,
            operation: boundOperation,
            processSession
          }, async session => {
            observedSession = session;
            return callback(session);
          });
        } catch (error) {
          primary = { label: 'git-read-phase-operation', error };
        }
        // The provider closes and joins admitted commands before these getters
        // are sampled. Accounting in the callback's finally loses close costs
        // and output produced by commands whose settlement is still in flight.
        settlePhysicalResources({ primary, cleanup: [{
          label: 'git-read-phase-final-usage', settle: () => {
            if (observedSession === undefined) return;
            const session = observedSession;
            const selected = [
              [argumentBytes, session.argumentBytes ?? 0, budget.maxTotalArgumentBytes, 'argument-byte'],
              [stdinBytes, session.stdinBytes ?? 0, budget.maxStdinBytes, 'stdin-byte'],
              [stdoutBytes, session.stdoutBytes, budget.maxStdoutBytes, 'stdout-byte'],
              [stderrBytes, session.stderrBytes, budget.maxStderrBytes, 'stderr-byte'],
              [executableBytes, session.executableBytes ?? 0, budget.maxExecutableBytes, 'executable-byte'],
              [recordCount, session.recordCount, budget.maxRecords, 'record'],
              [rootObservedBytes, session.rootObservedBytes ?? 0, budget.maxRootObservedBytes, 'root-observation-byte'],
              [reopenRefreshes, session.reopenRefreshes ?? 0, budget.maxReopenRefreshes, 'reopen-refresh'],
              [settlementAttempts, session.settlementAttempts ?? 0, budget.maxSettlementAttempts, 'settlement-attempt']
            ] as const;
            const totals = selected.map(([consumed, observed, maximum, label]) => {
              const total = consumed + observed;
              if (!Number.isSafeInteger(observed) || observed < 0 ||
                  !Number.isSafeInteger(total) || total > maximum) {
                throw operationFailure('operation-not-permitted',
                  `Git read phase returned invalid or excess ${label} usage.`);
              }
              return total;
            });
            // Publish the complete validated observation, not a partial update
            // if a later counter is invalid. No counters or budgets are renewed.
            [argumentBytes, stdinBytes, stdoutBytes, stderrBytes, executableBytes,
              recordCount, rootObservedBytes, reopenRefreshes, settlementAttempts] = totals as
                [number, number, number, number, number, number, number, number, number];
          }
        }] });
        return value as Value;
      } finally {
        // Wall-clock correction cannot refund elapsed active provider time.
        activeDurationMs += Math.max(0, performance.now() - phaseStartedAt);
        active = false;
      }
    })();
    let settlement!: Promise<void>;
    settlement = phaseResult.then(
      () => undefined,
      (error: unknown) => {
        phaseFailure ??= Object.freeze({ label: `git-read-phase:${phase}`, error });
      }
    ).finally(() => {
      activePhaseSettlements.delete(settlement);
    });
    activePhaseSettlements.add(settlement);
    return phaseResult;
  };
  scope = Object.freeze({ runPhase });
  ISSUED_GIT_READ_OPERATIONS.add(scope);
  let result: T | undefined;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    result = await operation(scope);
  } catch (error) {
    primary = { label: 'git-read-operation', error };
  } finally {
    closed = true;
    ISSUED_GIT_READ_OPERATIONS.delete(scope);
  }
  await settlePhysicalResourcesAsync({
    primary,
    cleanup: [
      { label: 'git-read-active-phases', settle: async () => {
        // These promises record rejection and resolve. Join each already-started
        // phase before closing the shared process owner; never abandon a worker.
        while (activePhaseSettlements.size > 0) await Promise.all([...activePhaseSettlements]);
        // The same propagated value is one failure carried across two wrappers,
        // not a second cleanup fault. First-phase failure policy remains intact.
        if (phaseFailure !== undefined && (primary === undefined || !Object.is(primary.error, phaseFailure.error))) {
          throw phaseFailure.error;
        }
      } },
      { label: 'git-read-process-session', settle: () => {
        const receipt = processSession.close();
        assertProcessResourceSessionReceipt(receipt, {
          operationIdentityDigest: boundOperation.plan.identity.identityDigest,
          boundAttemptDigest: boundOperation.boundAttemptDigest,
          requirementId: GIT_READ_AUTHORITY_REQUIREMENT
        });
      } }
    ]
  });
  return result as T;
}

/**
 * One authority-owned session lifetime. A result cannot leave this boundary
 * until terminal provider settlement has completed and the session remains
 * failure-free.
 */
export async function withAuthorityGitReadSession<T>(
  input: AuthorityGitReadSessionInput,
  operation: (session: GitReadSession) => Promise<T>
): Promise<T> {
  if (typeof operation !== 'function') throw new TypeError('Git read session callback must be callable');
  const { operation: suppliedOperation, ...sessionInput } = input;
  const boundOperation = suppliedOperation ?? issueGitReadAuthorityOperation(sessionInput);
  const resolution = createAuthorityGitReadSession({
    ...sessionInput,
    operation: boundOperation
  });
  if (resolution.status !== 'ready') {
    throw new GitReadAuthorityError('Git read provider is unavailable.', resolution);
  }
  const session = resolution.session;
  let result: T | undefined;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    if (!isProductionGitReadSession(session)) {
      throw new GitReadAuthorityError(
        'Git read provider returned a session without a production issuer capability.',
        Object.freeze({
          kind: 'unresolved-git-read-session' as const,
          reason: 'operation-not-permitted' as const,
          detail: 'Only the canonical production GitRead issuer may cross this authority boundary.'
        })
      );
    }
    result = await operation(session);
  } catch (error) {
    primary = { label: 'git-read-session-operation', error };
  }
  await settlePhysicalResourcesAsync({
    primary,
    cleanup: [
      { label: 'git-read-provider-close-and-receipt', settle: async () => {
        const receipt = await session.close?.();
        const processRequirements = boundOperation.plan.execution.requirements.filter(
          ({ effectKinds }) => effectKinds.includes('process')
        );
        if (receipt === undefined || processRequirements.length !== 1) {
          throw new Error('Git read authority did not receive one terminal provider receipt.');
        }
        assertGitReadSessionReceipt(receipt, {
          operationIdentityDigest: boundOperation.plan.identity.identityDigest,
          boundAttemptDigest: boundOperation.boundAttemptDigest,
          requirementId: processRequirements[0]!.id
        });
      } },
      { label: 'git-read-provider-terminal-failure', settle: () => {
        const failure = session.failure;
        if (failure !== null) throw new GitReadAuthorityError('Git read session failed terminal settlement.', failure);
      } }
    ]
  });
  return result as T;
}
