import {
  buildEngineeringIR,
  buildWorkspaceSemanticBundle,
  loadWorkspaceEngineeringIRBuildInput
} from '../compiler/index.ts';
import type { EngineeringIR } from '../shared/engineering-ir-types.ts';
import { readLockFile, saveLock } from '../shared/lock-utils.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import { bindPipelineSemanticContext } from '../shared/pipeline-semantic-context.ts';
import type {
  PipelineExecutionContext,
  PipelineSemanticContext
} from '../shared/pipeline-types.ts';
import { createWorkspaceWriteCommitFence } from '../shared/workspace-write-lease.ts';

export async function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  const { engineeringIRInput } = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  return buildEngineeringIR(engineeringIRInput);
}

export async function runWorkspaceSemanticFrontend(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<PipelineSemanticContext> {
  return executePipelineStage(
    workspaceRoot,
    'semantic',
    context,
    async (stageContext) => {
      const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, stageContext.workspaceWriteLease);
      const staleLock = await readLockFile(workspaceRoot);
      delete staleLock.semanticLoweringTasks;
      delete staleLock.semanticViews;
      await saveLock(workspaceRoot, staleLock, commitFence);

      const { snapshot, generatorPlan, semanticViews } = await buildWorkspaceSemanticBundle(workspaceRoot);
      const semanticContext = bindPipelineSemanticContext(stageContext, snapshot, generatorPlan, semanticViews);
      const lock = await readLockFile(workspaceRoot);
      lock.semanticLoweringTasks = generatorPlan.tasks.map((task) => ({
        ...structuredClone(task),
        status: 'pending'
      }));
      lock.semanticViews = structuredClone(semanticViews);
      await saveLock(workspaceRoot, lock, commitFence);
      return semanticContext;
    },
    { extractLock: () => readLockFile(workspaceRoot) }
  );
}
