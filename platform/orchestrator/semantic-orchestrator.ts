import { buildEngineeringIR } from '../compiler/ir/build-engineering-ir.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../compiler/ir/load-workspace-engineering-ir-input.ts';
import { buildWorkspaceSemanticBundle } from '../compiler/semantic-frontend.ts';
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
      // 合并为单次读-改-写：读取 lock 一次，在内存中清理字段、构建 semantic bundle、
      // 回填字段后一次性写入，避免原来 clear → save → read → fill → save 的两次磁盘往返。
      const lock = await readLockFile(workspaceRoot);
      delete lock.semanticLoweringTasks;
      delete lock.semanticViews;

      const { snapshot, generatorPlan, semanticViews } = await buildWorkspaceSemanticBundle(workspaceRoot);
      const semanticContext = bindPipelineSemanticContext(stageContext, snapshot, generatorPlan, semanticViews);
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
