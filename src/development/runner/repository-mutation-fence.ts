import path from 'node:path';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import { settlePhysicalResourcesAsync, type PhysicalResourceSettlementFailure } from '../../runtime-state/physical/runtime/resource-settlement.ts';
import {
  armWindowsRepositoryChangeObserver,
  settleWindowsRepositoryChangeObserver,
  type WindowsRepositoryChangeObserverSettlement
} from '../../runtime-state/physical/runtime/windows-repository-change-observer.ts';
import { observeOptionalDiagnostic } from '../../system-architecture/foundation/runtime/optional-diagnostic.ts';
import { issueSecOperationRequirementBindingContext } from '../../system-architecture/operation/requirement-binding-context.ts';
import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';
import { compilerRoot } from '../../workspace/runtime/paths.ts';
import { DEV_COMMAND_MAX_DURATION_MS } from './command-input.ts';
import { requireCommandExitCode } from './command-outcome.ts';
import { RepositoryObservationError, resolveRepositoryObservationRoots } from './repository-observation.ts';

export interface RepositoryMutationFenceOptions {
  readonly operation: SecBoundSemanticOperation;
  readonly repositoryRoot?: string;
  readonly report?: (message: string) => void;
  /** Narrows the native observer window when an outer owner has one. */
  readonly observerDeadlineAtUnixMs?: number;
  /** Standalone commands settle root-discovery Git before their own provider runs. */
  readonly retainProcessSession?: boolean;
}

const REPOSITORY_ZERO_WRITE_OBSERVATION_MAX_MS = DEV_COMMAND_MAX_DURATION_MS;

const PROCESS_RESOURCE_CEILINGS = new Set([
  'duration-ms',
  'input-bytes',
  'output-bytes',
  'processes'
]);

function openRepositoryProcessResourceSession(
  operation: SecBoundSemanticOperation
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
    requirementBindingContext: issueSecOperationRequirementBindingContext({
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
  operation: SecBoundSemanticOperation
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
  operation: (processSession?: ProcessResourceSession) => Promise<number>,
  options: RepositoryMutationFenceOptions
): Promise<number> {
  const cwd = process.cwd();
  const startedAt = Date.now();
  const { operation: semanticOperation, repositoryRoot: requestedRoot, report: suppliedReport } = options;
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
  const deadlineAtUnixMs = Math.min(
    effectiveObserverParentDeadline,
    requestedObserverDeadline ?? Number.MAX_SAFE_INTEGER,
    startedAt + REPOSITORY_ZERO_WRITE_OBSERVATION_MAX_MS
  );
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
  let observerResolution: Awaited<ReturnType<typeof armWindowsRepositoryChangeObserver>>;
  try {
    observerResolution = await armWindowsRepositoryChangeObserver({ roots, deadlineAtUnixMs });
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
  if (observerResolution.status !== 'ready') {
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
      + `(${observerResolution.reason}).`
    ));
    return 1;
  }
  let result: number | undefined;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    result = requireCommandExitCode(await operation(processSession), 'Repository-observed command');
  } catch (error) {
    primary = { label: 'repository-observed-command', error };
  }
  let settlement: WindowsRepositoryChangeObserverSettlement | undefined;
  await settlePhysicalResourcesAsync({
    primary,
    cleanup: [
      { label: 'repository-native-change-observer', settle: async () => {
        settlement = await settleWindowsRepositoryChangeObserver(observerResolution.observer);
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
    observeOptionalDiagnostic(() => report(
      `${commandId} mutated or lost continuous observation of repository state; `
      + `observer=${settlement!.status}.`
    ));
    return 1;
  }
  return result!;
}
