import { PIPELINE_VERIFY_STAGE_IDS } from '../compiler/pipeline/stages.ts';

export type SemanticMutationIsolatedRunnerFailureStage =
  | 'preflight'
  | 'verify-all'
  | 'postcondition';

export type SemanticMutationIsolatedRunnerProgressCheckpoint =
  | 'catch-armed'
  | 'verify-all'
  | 'postcondition'
  | 'failure-caught'
  | 'catch-tree-validated';

export interface SemanticMutationIsolatedUnsupportedStagedSources {
  readonly prismaTemplatePresent: boolean;
  readonly linkedOpaqueModulePresent: boolean;
}

export interface SemanticMutationIsolatedCompileReceipt {
  readonly completedStages: readonly string[];
  readonly semanticContext?: unknown;
  readonly verificationReport?: Readonly<{
    summary: Readonly<{
      status: string;
      requestedLane: string;
    }>;
  }>;
}

export interface SemanticMutationIsolatedCompileObserver<TBoundary extends string> {
  onExecutionBoundary(boundary: TBoundary): void;
  onTransactionStart(): void;
}

export interface SemanticMutationIsolatedRunnerOperations<TBoundary extends string> {
  readonly initialVerifyBoundary: TBoundary;
  readonly transactionBoundary: TBoundary;
  publishProgress(checkpoint: SemanticMutationIsolatedRunnerProgressCheckpoint): Promise<void>;
  assertStagingTree(): Promise<void>;
  inspectUnsupportedStagedSources(): Promise<SemanticMutationIsolatedUnsupportedStagedSources>;
  compileVerifyAll(
    observer: SemanticMutationIsolatedCompileObserver<TBoundary>
  ): Promise<SemanticMutationIsolatedCompileReceipt>;
  hasProjectBaseline(): Promise<boolean>;
  isProgressPublicationError(error: unknown): boolean;
}

export type SemanticMutationIsolatedRunnerResult<TBoundary extends string> =
  | Readonly<{
      readonly failureStage: 'preflight' | 'postcondition';
    }>
  | Readonly<{
      readonly failureStage: 'verify-all';
      readonly failureBoundary: TBoundary;
    }>;

export class SemanticMutationIsolatedCatchTreeFailure extends Error {
  constructor() {
    super('Semantic Mutation isolated catch tree validation failed');
    this.name = 'SemanticMutationIsolatedCatchTreeFailure';
  }
}

export class SemanticMutationIsolatedStagingTreeFailure extends Error {
  constructor() {
    super('Semantic Mutation isolated staging tree validation failed');
    this.name = 'SemanticMutationIsolatedStagingTreeFailure';
  }
}

function sameVerifyStages(actual: readonly string[]): boolean {
  return actual.length === PIPELINE_VERIFY_STAGE_IDS.length &&
    actual.every((stage, index) => stage === PIPELINE_VERIFY_STAGE_IDS[index]);
}

/**
 * Execute the isolated Semantic Mutation verify-all use case against injected
 * physical operations. Application owns sequencing and outcome classification;
 * bootstrap selects concrete providers and entry owns process protocol.
 */
export async function runSemanticMutationIsolatedVerifyAll<TBoundary extends string>(
  operations: SemanticMutationIsolatedRunnerOperations<TBoundary>
): Promise<SemanticMutationIsolatedRunnerResult<TBoundary> | null> {
  try {
    await operations.assertStagingTree();
  } catch {
    throw new SemanticMutationIsolatedStagingTreeFailure();
  }

  let failureStage: SemanticMutationIsolatedRunnerFailureStage = 'preflight';
  let failureBoundary = operations.initialVerifyBoundary;
  try {
    await operations.publishProgress('catch-armed');

    const unsupported = await operations.inspectUnsupportedStagedSources();
    if (unsupported.prismaTemplatePresent) {
      throw new Error(
        'Semantic Mutation isolated runner cannot execute Prisma without a staged toolchain'
      );
    }
    if (unsupported.linkedOpaqueModulePresent) {
      throw new Error('Semantic Mutation isolated runner cannot install linked opaque modules');
    }

    failureStage = 'verify-all';
    await operations.publishProgress('verify-all');
    const compiled = await operations.compileVerifyAll({
      onExecutionBoundary: boundary => {
        failureBoundary = boundary;
      },
      onTransactionStart: () => {
        failureBoundary = operations.transactionBoundary;
      }
    });

    failureStage = 'postcondition';
    await operations.publishProgress('postcondition');
    const hasBaseline = await operations.hasProjectBaseline();
    if (!hasBaseline ||
      !sameVerifyStages(compiled.completedStages) ||
      !compiled.semanticContext ||
      compiled.verificationReport?.summary.status !== 'passed' ||
      compiled.verificationReport.summary.requestedLane !== 'all') {
      throw new Error('Semantic Mutation isolated runner did not complete verify-all');
    }
    return null;
  } catch (error) {
    if (operations.isProgressPublicationError(error)) throw error;

    await operations.publishProgress('failure-caught');
    try {
      await operations.assertStagingTree();
    } catch {
      throw new SemanticMutationIsolatedCatchTreeFailure();
    }
    await operations.publishProgress('catch-tree-validated');

    return failureStage === 'verify-all'
      ? Object.freeze({ failureStage, failureBoundary })
      : Object.freeze({ failureStage });
  }
}
