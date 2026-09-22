import path from 'node:path';

import {
  SemanticMutationIsolatedCatchTreeFailure,
  SemanticMutationIsolatedStagingTreeFailure
} from '../application/semantic-mutation-isolated-runner.ts';

export type SemanticMutationIsolatedProcessProgressCheckpoint =
  | 'module-entered'
  | 'outcome-publish-started';

export interface SemanticMutationIsolatedProcessExitCodes {
  readonly runnerControlledFailure: number;
  readonly runnerEntryFailure: number;
  readonly runnerCatchTreeFailure: number;
  readonly outcomePublicationFailure: number;
  readonly progressPublicationFailure: number;
  readonly runnerStagingTreeFailure: number;
  readonly runnerEnvironmentBoundaryFailure: number;
  readonly runnerStagingLayoutBoundaryFailure: number;
}

export interface SemanticMutationIsolatedProcessOperations<TOutcome> {
  readonly isolatedEnvironmentKey: string;
  readonly exitCodes: SemanticMutationIsolatedProcessExitCodes;
  isStagingWorkspace(workspaceRoot: string): boolean;
  execute(workspaceRoot: string): Promise<TOutcome | null>;
  publishProgress(
    workspaceRoot: string,
    checkpoint: SemanticMutationIsolatedProcessProgressCheckpoint
  ): Promise<void>;
  publishOutcome(workspaceRoot: string, outcome: TOutcome): Promise<void>;
  isProgressPublicationError(error: unknown): boolean;
}

class SemanticMutationIsolatedEnvironmentBoundaryFailure extends Error {
  constructor() {
    super('Semantic Mutation isolated runner environment boundary is invalid');
    this.name = 'SemanticMutationIsolatedEnvironmentBoundaryFailure';
  }
}

class SemanticMutationIsolatedStagingLayoutBoundaryFailure extends Error {
  constructor() {
    super('Semantic Mutation isolated runner staging layout boundary is invalid');
    this.name = 'SemanticMutationIsolatedStagingLayoutBoundaryFailure';
  }
}

async function executeProcess<TOutcome>(
  operations: SemanticMutationIsolatedProcessOperations<TOutcome>
): Promise<void> {
  const stagingWorkspaceRoot = path.resolve(process.cwd());
  if (process.env[operations.isolatedEnvironmentKey] !== '1') {
    throw new SemanticMutationIsolatedEnvironmentBoundaryFailure();
  }
  if (!operations.isStagingWorkspace(stagingWorkspaceRoot)) {
    throw new SemanticMutationIsolatedStagingLayoutBoundaryFailure();
  }

  const outcome = await operations.execute(stagingWorkspaceRoot);
  if (outcome === null) return;

  await operations.publishProgress(stagingWorkspaceRoot, 'outcome-publish-started');
  let outcomePublished = false;
  try {
    await operations.publishOutcome(stagingWorkspaceRoot, outcome);
    outcomePublished = true;
  } catch {
    console.error('Semantic Mutation isolated verification failed');
    process.exitCode = operations.exitCodes.outcomePublicationFailure;
  }
  if (outcomePublished) {
    console.error('Semantic Mutation isolated verification failed');
    process.exitCode = operations.exitCodes.runnerControlledFailure;
  }
}

/**
 * Own the isolated-verifier process protocol. Concrete verification, filesystem
 * and publication providers are supplied by the bootstrap composition root.
 */
export async function runSemanticMutationIsolatedVerificationProcess<TOutcome>(
  operations: SemanticMutationIsolatedProcessOperations<TOutcome>
): Promise<void> {
  try {
    await operations.publishProgress(process.cwd(), 'module-entered');
    await executeProcess(operations);
  } catch (error) {
    console.error('Semantic Mutation isolated verification failed');
    process.exitCode = operations.isProgressPublicationError(error)
      ? operations.exitCodes.progressPublicationFailure
      : error instanceof SemanticMutationIsolatedEnvironmentBoundaryFailure
        ? operations.exitCodes.runnerEnvironmentBoundaryFailure
        : error instanceof SemanticMutationIsolatedStagingLayoutBoundaryFailure
          ? operations.exitCodes.runnerStagingLayoutBoundaryFailure
          : error instanceof SemanticMutationIsolatedCatchTreeFailure
            ? operations.exitCodes.runnerCatchTreeFailure
            : error instanceof SemanticMutationIsolatedStagingTreeFailure
              ? operations.exitCodes.runnerStagingTreeFailure
              : operations.exitCodes.runnerEntryFailure;
  }
}
