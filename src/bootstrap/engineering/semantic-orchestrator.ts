import path from 'node:path';
import { publishSemanticCompilation } from '../../application/semantic-publication.ts';
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
      const bundle = await buildWorkspaceSemanticBundle(workspaceRoot);
      const published = await publishSemanticCompilation(bundle.sourceLock, bundle, {
        bind: ({ snapshot, generatorPlan, semanticViews }) =>
          bindPipelineSemanticContext(stageContext, snapshot, generatorPlan, semanticViews),
        persist: lock => saveLock(workspaceRoot, lock, commitFence)
      });
      publishedLock = published.lock;
      return published.context;
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
