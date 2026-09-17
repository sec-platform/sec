import type { EngineeringIR } from '../../semantics/engineering-ir/root-types.ts';
import { createWorkspaceWriteCommitFence } from '../../workspace/lease.ts';
import type { LockFile } from '../contract.ts';
import { buildEngineeringIR } from '../ir/build-engineering-ir.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../ir/load-workspace-engineering-ir-input.ts';
import { saveLock } from '../lock.ts';
import { executePipelineStage } from '../pipeline/kernel.ts';
import { bindPipelineSemanticContext } from '../pipeline/semantic-context.ts';
import type {
  PipelineExecutionContext,
  PipelineSemanticContext
} from '../pipeline/types.ts';
import { buildWorkspaceSemanticBundle } from '../semantic-frontend.ts';

export async function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  const { engineeringIRInput } = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  return buildEngineeringIR(engineeringIRInput);
}

export async function runWorkspaceSemanticFrontend(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<PipelineSemanticContext> {
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
