import path from 'node:path';

import { listFilesRecursive } from '../../adapters/filesystem/discovery.ts';
import { pathExists } from "../../adapters/filesystem/files.ts";
import { ISOLATED_VERIFICATION_ENV_KEY } from '../../adapters/runtime-state/physical/runtime/process.ts';
import { assertIsolatedStagingTree } from '../../adapters/verification/assert-isolated-staging-tree.ts';
import {
  publishSemanticMutationIsolatedChildOutcome
} from '../../adapters/verification/isolation/isolated-verification-child-outcome.ts';
import {
  publishSemanticMutationIsolatedProgressCheckpoint,
  SemanticMutationIsolatedProgressPublicationError
} from '../../adapters/verification/isolation/isolated-verification-child-progress.ts';
import {
  withSemanticMutationIsolatedPhaseTelemetry
} from '../../adapters/verification/isolation/isolated-verification-phase-telemetry.ts';
import { readProjectBaseline } from '../../adapters/workspace/project-baseline.ts';
import { runSemanticMutationIsolatedVerifyAll } from '../../application/semantic-mutation-isolated-runner.ts';
import {
  buildSemanticMutationIsolatedChildOutcome,
  type SemanticMutationIsolatedChildOutcome
} from '../../assurance/verification/semantic-mutation/isolated-child-outcome.ts';
import {
  SEMANTIC_MUTATION_ISOLATED_EXIT_CODES
} from '../../assurance/verification/semantic-mutation/isolated-progress.ts';
import type { PipelineExecutionBoundary } from '../../compiler/pipeline/execution-boundaries.ts';
import {
  runSemanticMutationIsolatedVerificationProcess
} from '../../entry/semantic-mutation-isolated-verification-runner.ts';
import { mintIsolatedVerificationCapability } from '../../execution/isolated-verification-capability.ts';
import { isSemanticMutationStagingWorkspace } from '../../workspace/contract/semantic-mutation-staging.ts';
import { compileWorkspace } from './pipeline-orchestrator.ts';

async function executeSemanticMutationIsolatedVerification(
  stagingWorkspaceRoot: string
): Promise<SemanticMutationIsolatedChildOutcome | null> {
  const result = await runSemanticMutationIsolatedVerifyAll<PipelineExecutionBoundary>({
    initialVerifyBoundary: 'pipeline-bootstrap',
    transactionBoundary: 'pipeline-transaction',
    publishProgress: checkpoint =>
      publishSemanticMutationIsolatedProgressCheckpoint(stagingWorkspaceRoot, checkpoint),
    assertStagingTree: () => assertIsolatedStagingTree(stagingWorkspaceRoot),
    inspectUnsupportedStagedSources: async () => {
      const prismaTemplatePresent = await pathExists(
        path.join(stagingWorkspaceRoot, 'source', 'schema', 'db.prisma.template')
      );
      const opaqueModulesRoot = path.join(stagingWorkspaceRoot, 'source', 'code', 'opaque');
      const linkedOpaqueModulePresent = (await pathExists(opaqueModulesRoot)) &&
        (await listFilesRecursive(opaqueModulesRoot))
          .some(file => path.basename(file) === 'module.yaml');
      return { prismaTemplatePresent, linkedOpaqueModulePresent };
    },
    compileVerifyAll: async observer => {
      const isolatedVerificationCapability =
        mintIsolatedVerificationCapability(stagingWorkspaceRoot);
      return withSemanticMutationIsolatedPhaseTelemetry(
        stagingWorkspaceRoot,
        'compile-workspace',
        async () => await compileWorkspace(stagingWorkspaceRoot, {
          source: 'api',
          from: 'resolve',
          through: 'verify',
          isolatedVerificationCapability,
          onEvent: event => {
            if (event.type === 'execution-boundary' && event.boundary) {
              observer.onExecutionBoundary(event.boundary);
            } else if (event.type === 'transaction-start') {
              observer.onTransactionStart();
            }
          },
          verificationLane: 'all'
        })
      );
    },
    hasProjectBaseline: async () => Boolean(await readProjectBaseline(stagingWorkspaceRoot)),
    isProgressPublicationError: error =>
      error instanceof SemanticMutationIsolatedProgressPublicationError
  });

  if (result === null) return null;
  return buildSemanticMutationIsolatedChildOutcome(
    result.failureStage,
    result.failureStage === 'verify-all' ? result.failureBoundary : undefined
  );
}

await runSemanticMutationIsolatedVerificationProcess({
  isolatedEnvironmentKey: ISOLATED_VERIFICATION_ENV_KEY,
  exitCodes: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES,
  isStagingWorkspace: isSemanticMutationStagingWorkspace,
  execute: executeSemanticMutationIsolatedVerification,
  publishProgress: publishSemanticMutationIsolatedProgressCheckpoint,
  publishOutcome: publishSemanticMutationIsolatedChildOutcome,
  isProgressPublicationError: error =>
    error instanceof SemanticMutationIsolatedProgressPublicationError
});
