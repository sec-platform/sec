import path from 'node:path';

import { ISOLATED_VERIFICATION_ENV_KEY } from '../../runtime-state/physical/runtime/process.ts';
import { isSemanticMutationStagingWorkspace } from '../../semantic/mutation/runtime/staging-boundary.ts';
import { pathExists } from '../../workspace/files.ts';
import { listFilesRecursive } from '../../workspace/runtime/discovery.ts';
import { readProjectBaseline } from '../../workspace/runtime/project-baseline.ts';
import {
  PIPELINE_VERIFY_STAGE_IDS,
  type PipelineExecutionBoundary
} from '../pipeline/types.ts';
import {
  buildSemanticMutationIsolatedChildOutcome,
  publishSemanticMutationIsolatedChildOutcome,
  type SemanticMutationIsolatedChildFailureStage,
  type SemanticMutationIsolatedChildOutcome
} from '../semantic-mutation/isolated-verification-child-outcome.ts';
import {
  publishSemanticMutationIsolatedProgressCheckpoint,
  SEMANTIC_MUTATION_ISOLATED_EXIT_CODES,
  SemanticMutationIsolatedProgressPublicationError
} from '../semantic-mutation/isolated-verification-child-progress.ts';
import {
  withSemanticMutationIsolatedPhaseTelemetry
} from '../semantic-mutation/isolated-verification-phase-telemetry.ts';
import { assertIsolatedStagingTree } from '../verify/assert-isolated-staging-tree.ts';
import { mintIsolatedVerificationCapability } from './isolated-verification-capability.ts';
import { compileWorkspace } from './pipeline-orchestrator.ts';

class SemanticMutationIsolatedCatchTreeFailure extends Error {
  constructor() {
    super('Semantic Mutation isolated catch tree validation failed');
    this.name = 'SemanticMutationIsolatedCatchTreeFailure';
  }
}

class SemanticMutationIsolatedStagingTreeFailure extends Error {
  constructor() {
    super('Semantic Mutation isolated staging tree validation failed');
    this.name = 'SemanticMutationIsolatedStagingTreeFailure';
  }
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

function sameStages(actual: readonly string[]): boolean {
  return actual.length === PIPELINE_VERIFY_STAGE_IDS.length &&
    actual.every((stage, index) => stage === PIPELINE_VERIFY_STAGE_IDS[index]);
}

async function main(): Promise<SemanticMutationIsolatedChildOutcome | null> {
  const stagingWorkspaceRoot = path.resolve(process.cwd());
  if (process.env[ISOLATED_VERIFICATION_ENV_KEY] !== '1') {
    throw new SemanticMutationIsolatedEnvironmentBoundaryFailure();
  }
  if (!isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)) {
    throw new SemanticMutationIsolatedStagingLayoutBoundaryFailure();
  }
  try {
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
  } catch {
    throw new SemanticMutationIsolatedStagingTreeFailure();
  }
  let failureStage: SemanticMutationIsolatedChildFailureStage = 'preflight';
  let failureBoundary: PipelineExecutionBoundary | undefined;
  try {
    await publishSemanticMutationIsolatedProgressCheckpoint(stagingWorkspaceRoot, 'catch-armed');
    if (await pathExists(path.join(stagingWorkspaceRoot, 'source', 'schema', 'db.prisma.template'))) {
      throw new Error('Semantic Mutation isolated runner cannot execute Prisma without a staged toolchain');
    }
    const opaqueModulesRoot = path.join(stagingWorkspaceRoot, 'source', 'code', 'opaque');
    if ((await pathExists(opaqueModulesRoot)) &&
      (await listFilesRecursive(opaqueModulesRoot)).some((file) => path.basename(file) === 'module.yaml')) {
      throw new Error('Semantic Mutation isolated runner cannot install linked opaque modules');
    }
    const isolatedVerificationCapability = mintIsolatedVerificationCapability(stagingWorkspaceRoot);
    failureStage = 'verify-all';
    failureBoundary = 'pipeline-bootstrap';
    await publishSemanticMutationIsolatedProgressCheckpoint(stagingWorkspaceRoot, 'verify-all');
    const compiled = await withSemanticMutationIsolatedPhaseTelemetry(
      stagingWorkspaceRoot,
      'compile-workspace',
      async () => await compileWorkspace(stagingWorkspaceRoot, {
        source: 'api',
        from: 'resolve',
        through: 'verify',
        isolatedVerificationCapability,
        onEvent: (event) => {
          if (event.type === 'execution-boundary' && event.boundary) {
            failureBoundary = event.boundary;
          } else if (event.type === 'transaction-start') {
            failureBoundary = 'pipeline-transaction';
          }
        },
        verificationLane: 'all'
      })
    );
    failureStage = 'postcondition';
    await publishSemanticMutationIsolatedProgressCheckpoint(stagingWorkspaceRoot, 'postcondition');
    const baseline = await readProjectBaseline(stagingWorkspaceRoot);
    if (!baseline || !sameStages(compiled.completedStages) ||
      !compiled.semanticContext ||
      compiled.verificationReport?.summary.status !== 'passed' ||
      compiled.verificationReport.summary.requestedLane !== 'all') {
      throw new Error('Semantic Mutation isolated runner did not complete verify-all');
    }
    return null;
  } catch (error) {
    if (error instanceof SemanticMutationIsolatedProgressPublicationError) throw error;
    await publishSemanticMutationIsolatedProgressCheckpoint(stagingWorkspaceRoot, 'failure-caught');
    try {
      await assertIsolatedStagingTree(stagingWorkspaceRoot);
    } catch {
      throw new SemanticMutationIsolatedCatchTreeFailure();
    }
    await publishSemanticMutationIsolatedProgressCheckpoint(stagingWorkspaceRoot, 'catch-tree-validated');
    return buildSemanticMutationIsolatedChildOutcome(
      failureStage,
      failureStage === 'verify-all' ? failureBoundary : undefined
    );
  }
}

try {
  await publishSemanticMutationIsolatedProgressCheckpoint(process.cwd(), 'module-entered');
  const outcome = await main();
  if (outcome !== null) {
    await publishSemanticMutationIsolatedProgressCheckpoint(process.cwd(), 'outcome-publish-started');
    let outcomePublished = false;
    try {
      await publishSemanticMutationIsolatedChildOutcome(process.cwd(), outcome);
      outcomePublished = true;
    } catch {
      console.error('Semantic Mutation isolated verification failed');
      process.exitCode = SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.outcomePublicationFailure;
    }
    if (outcomePublished) {
      console.error('Semantic Mutation isolated verification failed');
      process.exitCode = SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure;
    }
  }
} catch (error) {
  console.error('Semantic Mutation isolated verification failed');
  process.exitCode = error instanceof SemanticMutationIsolatedProgressPublicationError
    ? SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure
    : error instanceof SemanticMutationIsolatedEnvironmentBoundaryFailure
      ? SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEnvironmentBoundaryFailure
      : error instanceof SemanticMutationIsolatedStagingLayoutBoundaryFailure
        ? SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingLayoutBoundaryFailure
    : error instanceof SemanticMutationIsolatedCatchTreeFailure
      ? SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerCatchTreeFailure
      : error instanceof SemanticMutationIsolatedStagingTreeFailure
        ? SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingTreeFailure
        : SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEntryFailure;
}
