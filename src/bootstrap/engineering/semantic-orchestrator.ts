import path from 'node:path';
import { buildWorkspaceEngineeringIRResult } from '../../application/workspace-engineering-ir.ts';
import { publishSemanticCompilation } from '../../application/semantic-publication.ts';
import type { EngineeringIR } from '../../semantics/engineering-ir/root-types.ts';
import { createWorkspaceWriteCommitFence } from '../../adapters/filesystem/write-lease.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../adapters/workspace/engineering-input.ts';
import { saveLock } from "../../adapters/workspace/lock.ts";
import { executePipelineStage } from '../../adapters/compilation/pipeline/kernel.ts';
import { bindPipelineSemanticContext } from '../../adapters/compilation/pipeline/semantic-context.ts';
import type {
  PipelineExecutionContext,
  PipelineSemanticContext
} from '../../adapters/compilation-protocol/types.ts';
import { buildWorkspaceSemanticBundle } from '../../adapters/workspace/semantic-bundle.ts';

export function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  workspaceRoot = path.resolve(workspaceRoot);
  return buildWorkspaceEngineeringIRResult({
    readInput: () => loadWorkspaceEngineeringIRBuildInput(workspaceRoot)
  });
}

export async function runWorkspaceSemanticFrontend(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<PipelineSemanticContext> {
  workspaceRoot = path.resolve(workspaceRoot);
  const result = await executePipelineStage(
    workspaceRoot,
    'semantic',
    context,
    async stageContext => {
      const commitFence = createWorkspaceWriteCommitFence(
        workspaceRoot,
        stageContext.workspaceWriteLease
      );
      const bundle = await buildWorkspaceSemanticBundle(workspaceRoot);
      const published = await publishSemanticCompilation(bundle.sourceLock, bundle, {
        bind: ({ snapshot, generatorPlan, semanticViews }) =>
          bindPipelineSemanticContext(stageContext, snapshot, generatorPlan, semanticViews),
        persist: lock => saveLock(workspaceRoot, lock, commitFence)
      });
      return Object.freeze({
        context: published.context,
        lock: published.lock
      });
    },
    { extractLock: stageResult => stageResult.lock }
  );
  return result.context;
}
