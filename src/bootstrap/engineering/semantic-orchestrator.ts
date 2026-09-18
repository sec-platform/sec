import path from 'node:path';
import type { EngineeringIR } from '../../semantics/engineering-ir/root-types.ts';
import { createWorkspaceWriteCommitFence } from '../../adapters/filesystem/write-lease.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { buildEngineeringIR } from '../../compiler/ir/build-engineering-ir.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../adapters/workspace/engineering-input.ts';
import { saveLock } from "../../adapters/workspace/lock.ts";
import { executePipelineStage } from '../../adapters/compilation/pipeline/kernel.ts';
import { bindPipelineSemanticContext } from '../../adapters/compilation/pipeline/semantic-context.ts';
import type {
  PipelineExecutionContext,
  PipelineSemanticContext
} from '../../adapters/compilation-protocol/types.ts';
import { buildWorkspaceSemanticBundle } from '../../adapters/workspace/semantic-bundle.ts';

export async function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  const { engineeringIRInput } = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  return buildEngineeringIR(engineeringIRInput);
}

export async function runWorkspaceSemanticFrontend(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<PipelineSemanticContext> {
  workspaceRoot = path.resolve(workspaceRoot);
  let publishedLock: LockFile | undefined;
  return executePipelineStage(
    workspaceRoot,
    'semantic',
    context,
    async (stageContext) => {
      const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, stageContext.workspaceWriteLease);
      const {
        snapshot,
        generatorPlan,
        semanticViews,
        sourceLock: lock
      } = await buildWorkspaceSemanticBundle(workspaceRoot);

      // Mutate exactly the Lock object that participated in semantic-input
      // derivation. Reopening live Lock here would mix two physical revisions
      // before #296 can bind the whole read set into one Workspace Observation.
      delete lock.semanticLoweringTasks;
      delete lock.semanticViews;

      const semanticContext = bindPipelineSemanticContext(stageContext, snapshot, generatorPlan, semanticViews);
      lock.semanticLoweringTasks = generatorPlan.tasks.map((task) => ({
        ...structuredClone(task),
        status: 'pending'
      }));
      lock.semanticViews = structuredClone(semanticViews);
      await saveLock(workspaceRoot, lock, commitFence);
      publishedLock = lock;
      return semanticContext;
    },
    {
      extractLock: () => {
        if (!publishedLock) {
          throw new Error('Semantic stage completed without one published Lock');
        }
        return publishedLock;
      }
    }
  );
}
