import path from 'node:path';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import { observeOptionalDiagnostic } from '../../../../execution/optional-diagnostic.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync, type ResourceSettlementFailure as PhysicalResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  armPreparedWindowsRepositoryChangeObserver,
  armWindowsRepositoryChangeObserver,
  disposePreparedWindowsRepositoryChangeObserver,
  prepareWindowsRepositoryChangeObserver,
  settlePreparedWindowsRepositoryChangeObserver,
  settleWindowsRepositoryChangeObserver,
  type PreparedWindowsRepositoryChangeObserver,
  type WindowsRepositoryChangeObserverSettlement
} from '../../../runtime-state/physical/runtime/windows-repository-change-observer.ts';
import { compilerRoot } from "../../../workspace-context.ts";
import { requireCommandExitCode } from './command-outcome.ts';
import { DEV_COMMAND_MAX_DURATION_MS } from './contract.ts';
import { RepositoryObservationError, resolveRepositoryObservationRoots } from './repository-observation.ts';
import {
  assertIssuedFastTestBatchExecutionAdmission,
  assertIssuedTestSuiteExecutionAdmission,
  bindFastTestBatchExecutionAdmission,
  type FastTestBatchExecutionAdmission,
  type TestSuiteExecutionAdmission
} from './test-execution-policy.ts';

export type RepositoryMutationFenceExecutionContext = Readonly<{
  testSuiteAdmission: TestSuiteExecutionAdmission;
  testSuiteObserver: PreparedWindowsRepositoryChangeObserver;
}>;

export interface RepositoryMutationFenceOptions {
  readonly operation: BoundSemanticOperation;
  readonly repositoryRoot?: string;
  readonly report?: (message: string) => void;
  /** Narrows the native observer window when an outer owner has one. */
  readonly observerDeadlineAtUnixMs?: number;
  /** Standalone commands settle root-discovery Git before their own provider runs. */
  readonly retainProcessSession?: boolean;
  /** Exact suite admission whose observer is bound by the child operation. */
  readonly testSuiteAdmission?: TestSuiteExecutionAdmission;
  /** Exact fast invocation DAG whose operation owns one continuous observer. */
  readonly fastTestBatchAdmission?: FastTestBatchExecutionAdmission;
}

export type RepositoryObserverFailureDiagnostic = Readonly<{
  schema: 'sec-repository-observer-failure-diagnostic-v1';
  status: Exclude<WindowsRepositoryChangeObserverSettlement['status'], 'zero-events'>;
  rootIdentityDigest: `sha256:${string}`;
  eventCount?: number;
  observationDigest?: `sha256:${string}`;
  firstEvent?: Readonly<{
    action: string;
    path: string;
    root: string | null;
    rootIndex: number;
  }>;
}>;

/** Bounded diagnostic projection only; it cannot authorize or excuse a write. */
export function projectRepositoryObserverFailureDiagnostic(
  settlement: Exclude<WindowsRepositoryChangeObserverSettlement, { status: 'zero-events' }>,
  roots: readonly string[]
): RepositoryObserverFailureDiagnostic {
  if (settlement.status !== 'events') {
    return Object.freeze({
      schema: 'sec-repository-observer-failure-diagnostic-v1',
      status: settlement.status,
      rootIdentityDigest: settlement.rootIdentityDigest
    });
  }
  const first = settlement.events[0];
  return Object.freeze({
    schema: 'sec-repository-observer-failure-diagnostic-v1',
    status: settlement.status,
    rootIdentityDigest: settlement.rootIdentityDigest,
    eventCount: settlement.events.length,
    observationDigest: settlement.observationDigest,
    ...(first === undefined ? {} : {
      firstEvent: Object.freeze({
        action: first.action,
        path: first.path,
        root: roots[first.rootIndex] ?? null,
        rootIndex: first.rootIndex
      })
    })
  });
}

const REPOSITORY_ZERO_WRITE_OBSERVATION_MAX_MS = DEV_COMMAND_MAX_DURATION_MS;

const PROCESS_RESOURCE_CEILINGS = new Set([
  'duration-ms',
  'input-bytes',
  'output-bytes',
  'processes'
]);

function openRepositoryProcessResourceSession(
  operation: BoundSemanticOperation
): ProcessResourceSession {
  const processRequirements = operation.plan.execution.requirements.filter(({ effectKinds }) => (
    effectKinds.includes('process')
  ));
  if (processRequirements.length !== 1) {
    throw new Error('Repository zero-write fence requires one process Effect requirement.');
  }
  const requirement = processRequirements[0]!;
  return openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: requirement.id,
      resourceCeilings: operation.plan.execution.aggregateBudgets.filter(({ resource }) => (
        PROCESS_RESOURCE_CEILINGS.has(resource)
      ))
    })
  });
}

function closeRepositoryProcessResourceSession(
  processSession: ProcessResourceSession,
  operation: BoundSemanticOperation
): void {
  const receipt = processSession.close();
  assertProcessResourceSessionReceipt(receipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: processSession.requirementId
  });
}

/**
 * Strict zero-write admission remains closed until the Runtime State physical
 * owner supplies one opaque native recursive change-observer capability.
 * Final-state Git equality cannot detect write-and-restore ABA and must not be
 * promoted into this authority boundary.
 */
export async function runRepositoryZeroWriteOperation(
  commandId: string,
  operation: (
    processSession?: ProcessResourceSession,
    executionContext?: RepositoryMutationFenceExecutionContext
  ) => Promise<number>,
  options: RepositoryMutationFenceOptions
): Promise<number> {
  const cwd = process.cwd();
  const startedAt = Date.now();
  const { operation: semanticOperation, repositoryRoot: requestedRoot, report: suppliedReport } = options;
  const testSuiteAdmission = options.testSuiteAdmission;
  const fastTestBatchAdmission = options.fastTestBatchAdmission;
  if (testSuiteAdmission !== undefined && fastTestBatchAdmission !== undefined) {
    throw new Error('Repository observation accepts one test execution admission.');
  }
  if (testSuiteAdmission !== undefined) assertIssuedTestSuiteExecutionAdmission(testSuiteAdmission);
  if (fastTestBatchAdmission !== undefined) {
    assertIssuedFastTestBatchExecutionAdmission(fastTestBatchAdmission);
  }
  if (typeof operation !== 'function' || (suppliedReport !== undefined && typeof suppliedReport !== 'function')) {
    throw new TypeError('Repository observation operation and reporter must be callable');
  }
  const repositoryRoot = path.resolve(cwd, requestedRoot === undefined ? compilerRoot : requestedRoot);
  const parentDeadline = semanticOperation.plan.attempt.deadlineAtUnixMs;
  if (!Number.isSafeInteger(parentDeadline)) throw new TypeError('Repository observation requires a finite parent deadline');
  // Root discovery consumes this window; arming cannot open a fresh deadline.
  const requestedObserverDeadline = options.observerDeadlineAtUnixMs;
  if (requestedObserverDeadline !== undefined
      && (!Number.isSafeInteger(requestedObserverDeadline) || requestedObserverDeadline <= startedAt)) {
    throw new TypeError('Repository observation deadline must be a future absolute timestamp.');
  }
  // A retained process session is part of the semantic operation, so its
  // parent deadline remains authoritative. Standalone commands settle that
  // short root-discovery ledger before the callback; their command owner may
  // supply the already-canonical managed-command deadline for native
  // observation without extending any retained process capability.
  const effectiveObserverParentDeadline = options.retainProcessSession === false
    && requestedObserverDeadline !== undefined
    ? requestedObserverDeadline
    : parentDeadline;
  const executionDeadlineAtUnixMs = testSuiteAdmission?.logicalDeadlineAtUnixMs
    ?? fastTestBatchAdmission?.logicalDeadlineAtUnixMs;
  const deadlineAtUnixMs = executionDeadlineAtUnixMs === undefined
    ? Math.min(
        effectiveObserverParentDeadline,
        requestedObserverDeadline ?? Number.MAX_SAFE_INTEGER,
        startedAt + REPOSITORY_ZERO_WRITE_OBSERVATION_MAX_MS
      )
    : executionDeadlineAtUnixMs;
  const report = suppliedReport === undefined ? console.error : (message: string) => Reflect.apply(suppliedReport, options, [message]);
  if (deadlineAtUnixMs <= startedAt) {
    observeOptionalDiagnostic(() => report(`${commandId} strict-zero-write-unproven: observation deadline exhausted.`));
    return 1;
  }
  let processSession: ProcessResourceSession | undefined;
  try {
    processSession = openRepositoryProcessResourceSession(semanticOperation);
  } catch (error) {
    observeOptionalDiagnostic(() => report(
      `${commandId} strict-zero-write-unproven: process resource admission is unavailable `
      + `(${error instanceof Error ? error.message : String(error)}).`
    ));
    return 1;
  }
  let roots: readonly string[];
  try {
    roots = await resolveRepositoryObservationRoots(repositoryRoot, semanticOperation, processSession);
  } catch (error) {
    await settlePhysicalResourcesAsync({
      primary: { label: 'repository-observation-root-discovery', error },
      cleanup: [{
        label: 'repository-process-resource-session',
        settle: () => closeRepositoryProcessResourceSession(processSession!, semanticOperation)
      }]
    });
    throw new Error('Unreachable repository root discovery settlement state.');
  }
  if (options.retainProcessSession === false) {
    closeRepositoryProcessResourceSession(processSession, semanticOperation);
    processSession = undefined;
  }
  let preparedObserver: PreparedWindowsRepositoryChangeObserver | undefined;
  let observerResolution: Awaited<ReturnType<typeof armWindowsRepositoryChangeObserver>> | undefined;
  try {
    if (testSuiteAdmission === undefined && fastTestBatchAdmission === undefined) {
      observerResolution = await armWindowsRepositoryChangeObserver({ roots, deadlineAtUnixMs });
    } else {
      preparedObserver = prepareWindowsRepositoryChangeObserver({ roots });
    }
  } catch (error) {
    await settlePhysicalResourcesAsync({
      primary: { label: 'repository-native-change-observer-admission', error },
      cleanup: [
        ...(processSession === undefined ? [] : [{
          label: 'repository-process-resource-session',
          settle: () => closeRepositoryProcessResourceSession(processSession!, semanticOperation)
        }])
      ]
    });
    throw new Error('Unreachable repository native observer settlement state.');
  }
  if (testSuiteAdmission === undefined && fastTestBatchAdmission === undefined
      && observerResolution!.status !== 'ready') {
    if (processSession !== undefined) {
      await settlePhysicalResourcesAsync({
        cleanup: [{
          label: 'repository-process-resource-session',
          settle: () => closeRepositoryProcessResourceSession(processSession!, semanticOperation)
        }]
      });
    }
    observeOptionalDiagnostic(() => report(
      `${commandId} strict-zero-write-unproven: native repository observation is unavailable `
      + `(${observerResolution!.status === 'unavailable' ? observerResolution!.reason : 'invalid-input'}).`
    ));
    return 1;
  }
  const readyObserver = observerResolution?.status === 'ready'
    ? observerResolution.observer
    : undefined;
  if (fastTestBatchAdmission !== undefined) {
    let batchObserverResolution: Awaited<ReturnType<typeof armPreparedWindowsRepositoryChangeObserver>>;
    try {
      const batchOperation = bindFastTestBatchExecutionAdmission(
        fastTestBatchAdmission,
        preparedObserver!.providerBinding
      );
      const remainingDurationMs = fastTestBatchAdmission.logicalDeadlineAtUnixMs - Date.now();
      if (!Number.isSafeInteger(remainingDurationMs) || remainingDurationMs < 1) {
        throw new Error('Fast test batch deadline exhausted before observer arm.');
      }
      batchObserverResolution = await armPreparedWindowsRepositoryChangeObserver({
        prepared: preparedObserver!,
        operation: batchOperation,
        requirementBindingContext: issueOperationRequirementBindingContext({
          operation: batchOperation,
          requirementId: preparedObserver!.providerBinding.requirementId,
          resourceCeilings: [{ resource: 'duration-ms', maximum: remainingDurationMs }],
          absoluteDeadlineAtUnixMs: fastTestBatchAdmission.logicalDeadlineAtUnixMs
        })
      });
    } catch (error) {
      await settlePhysicalResourcesAsync({
        primary: { label: 'fast-test-batch-observer-admission', error },
        cleanup: [
          { label: 'fast-test-batch-prepared-observer', settle: async () => {
            await settlePreparedWindowsRepositoryChangeObserver(preparedObserver!);
            disposePreparedWindowsRepositoryChangeObserver(preparedObserver!);
          } },
          ...(processSession === undefined ? [] : [{
            label: 'repository-process-resource-session',
            settle: () => closeRepositoryProcessResourceSession(processSession!, semanticOperation)
          }])
        ]
      });
      throw new Error('Unreachable fast test batch observer admission settlement state.');
    }
    if (batchObserverResolution.status !== 'ready') {
      await settlePhysicalResourcesAsync({ cleanup: [
        { label: 'fast-test-batch-prepared-observer', settle: async () => {
          await settlePreparedWindowsRepositoryChangeObserver(preparedObserver!);
          disposePreparedWindowsRepositoryChangeObserver(preparedObserver!);
        } },
        ...(processSession === undefined ? [] : [{
          label: 'repository-process-resource-session',
          settle: () => closeRepositoryProcessResourceSession(processSession!, semanticOperation)
        }])
      ] });
      observeOptionalDiagnostic(() => report(
        `${commandId} strict-zero-write-unproven: fast test batch observer is unavailable (${batchObserverResolution.reason}).`
      ));
      return 1;
    }
  }
  let result: number | undefined;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    result = requireCommandExitCode(await operation(
      processSession,
      preparedObserver === undefined || testSuiteAdmission === undefined ? undefined : Object.freeze({
        testSuiteAdmission: testSuiteAdmission!,
        testSuiteObserver: preparedObserver
      })
    ), 'Repository-observed command');
  } catch (error) {
    primary = { label: 'repository-observed-command', error };
  }
  let settlement: WindowsRepositoryChangeObserverSettlement | undefined;
  await settlePhysicalResourcesAsync({
    primary,
    cleanup: [
      { label: 'repository-native-change-observer', settle: async () => {
        if (preparedObserver !== undefined) {
          settlement = await settlePreparedWindowsRepositoryChangeObserver(preparedObserver);
          disposePreparedWindowsRepositoryChangeObserver(preparedObserver);
        } else {
          if (readyObserver === undefined) {
            throw new Error('Repository observer was not armed.');
          }
          settlement = await settleWindowsRepositoryChangeObserver(readyObserver);
        }
        // A failed command does not erase a second loss-of-observation result.
        // Keep the native settlement as cause; display text is not the evidence.
        if (primary !== undefined && settlement.status !== 'zero-events') {
          throw new RepositoryObservationError('physical-unresolved',
            'Repository change observation did not establish zero writes', settlement);
        }
      } },
      ...(processSession === undefined ? [] : [{ label: 'repository-process-resource-session', settle: () => {
        closeRepositoryProcessResourceSession(processSession!, semanticOperation);
      } }])
    ]
  });
  if (settlement!.status !== 'zero-events') {
    const diagnostic = projectRepositoryObserverFailureDiagnostic(settlement!, roots);
    observeOptionalDiagnostic(() => report(
      `${commandId} mutated or lost continuous observation of repository state; `
      + `observer=${settlement!.status}; diagnostic=${JSON.stringify(diagnostic)}.`
    ));
    return 1;
  }
  return result!;
}

/** One canonical boundary for ordinary read-only runner stages. The short Git
 * root-discovery ledger settles before the stage; the native observer retains
 * the existing generic five-minute ceiling and cannot be widened by callers. */
export async function runStandaloneRepositoryZeroWriteOperation(
  commandId: string,
  operation: () => Promise<number>
): Promise<number> {
  const { compileRepositoryObservationOperation } = await import('./repository-observation.ts');
  return runRepositoryZeroWriteOperation(commandId, operation, {
    operation: compileRepositoryObservationOperation(),
    observerDeadlineAtUnixMs: Date.now() + DEV_COMMAND_MAX_DURATION_MS,
    retainProcessSession: false
  });
}
