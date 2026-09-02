import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
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
}) as SecOperationDigest;
const GIT_READ_AUTHORITY_PROVIDER_DIGEST = sha256({
  provider: 'external-capabilities.git-read',
  route: 'host-local-git-v1',
  retainedBoundary: 'cwd-and-executable-physical-identity-v1'
}) as SecOperationDigest;

type AuthorityGitReadSessionInput = Omit<
  Parameters<typeof createAuthorityGitReadSession>[0],
  'operation'
> & Readonly<{
  /** A broader caller-owned operation may share its already-frozen process budget. */
  operation?: SecBoundSemanticOperation;
}>;

function issueGitReadAuthorityOperation(
  input: Omit<AuthorityGitReadSessionInput, 'operation'>,
  parentDeadlineAtUnixMs?: number
): SecBoundSemanticOperation {
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
  const plan = compileSecSemanticOperationPlan({
    operation: GIT_READ_AUTHORITY_OPERATION,
    intentDigest: sha256({
      cwd: input.cwd,
      environment: input.environment ?? {},
      budget
    }) as SecOperationDigest,
    decisionDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST,
    deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
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
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
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
  const budget = resolveGitReadSessionBudget(input.budget);
  const boundOperation = issueGitReadAuthorityOperation(
    { ...input, budget },
    input.deadlineAtUnixMs
  );
  const processSession: ProcessResourceSession = openProcessResourceSession({
    operation: boundOperation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({
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
  let phaseFailure: unknown;
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
      if (phase.length === 0 || phase.includes('\0')) {
        throw new Error('Git read operation phase identity is invalid.');
      }
      const now = Date.now();
      const remainingDurationMs = Math.min(
        remainingPositive(budget.deadlineMs, activeDurationMs, 'duration-ms'),
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
      const phaseStartedAt = Date.now();
      active = true;
      try {
        return await withAuthorityGitReadSession({
          ...input,
          budget: phaseBudget,
          deadlineAtUnixMs: now + remainingDurationMs,
          operation: boundOperation,
          processSession
        }, async (session) => {
          try {
            return await callback(session);
          } finally {
            argumentBytes += session.argumentBytes ?? 0;
            stdinBytes += session.stdinBytes ?? 0;
            stdoutBytes += session.stdoutBytes;
            stderrBytes += session.stderrBytes;
            executableBytes += session.executableBytes ?? 0;
            recordCount += session.recordCount;
            rootObservedBytes += session.rootObservedBytes ?? 0;
            reopenRefreshes += session.reopenRefreshes ?? 0;
            settlementAttempts += session.settlementAttempts ?? 0;
          }
        });
      } finally {
        activeDurationMs += Math.max(0, Date.now() - phaseStartedAt);
        active = false;
      }
    })();
    let settlement!: Promise<void>;
    settlement = phaseResult.then(
      () => undefined,
      (error: unknown) => {
        phaseFailure ??= error;
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
  let primaryError: unknown;
  try {
    result = await operation(scope);
  } catch (error) {
    primaryError = error;
  } finally {
    closed = true;
    ISSUED_GIT_READ_OPERATIONS.delete(scope);
    while (activePhaseSettlements.size > 0) {
      await Promise.all([...activePhaseSettlements]);
    }
    primaryError ??= phaseFailure;
    try {
      const receipt = processSession.close();
      assertProcessResourceSessionReceipt(receipt, {
        operationIdentityDigest: boundOperation.plan.identity.identityDigest,
        boundAttemptDigest: boundOperation.boundAttemptDigest,
        requirementId: GIT_READ_AUTHORITY_REQUIREMENT
      });
    } catch (error) {
      primaryError ??= error;
    }
  }
  if (primaryError !== undefined) throw primaryError;
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
  let primaryError: unknown;
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
    primaryError = error;
  }
  try {
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
  } catch (error) {
    primaryError ??= error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (session.failure !== null) {
    throw new GitReadAuthorityError('Git read session failed terminal settlement.', session.failure);
  }
  return result as T;
}
