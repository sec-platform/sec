import {
  buildEngineeringIR,
  buildSemanticViewSet,
  buildSemanticGeneratorPlan,
  buildValidatedEngineeringIR,
  loadWorkspaceEngineeringIRBuildInput,
  type BuildEngineeringIRInput
} from '../compiler/index.ts';
import type {
  EngineeringIR,
  ValidatedEngineeringIRSnapshot
} from '../shared/engineering-ir-types.ts';
import { readLockFile, saveLock } from '../shared/lock-utils.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import { bindPipelineSemanticContext } from '../shared/pipeline-semantic-context.ts';
import type {
  PipelineExecutionContext,
  PipelineSemanticContext
} from '../shared/pipeline-types.ts';
import type { SemanticGeneratorDeclaration } from '../shared/semantic-generator-types.ts';

interface WorkspaceSemanticBuildInput {
  engineeringIRInput: BuildEngineeringIRInput;
  generatorDeclarations: SemanticGeneratorDeclaration[];
}

async function loadWorkspaceEngineeringIRInput(
  workspaceRoot: string
): Promise<WorkspaceSemanticBuildInput> {
  return loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
}

export async function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  const input = await loadWorkspaceEngineeringIRInput(workspaceRoot);
  return buildEngineeringIR(input.engineeringIRInput);
}

async function buildWorkspaceValidatedEngineeringIR(
  workspaceRoot: string
): Promise<{
  snapshot: ValidatedEngineeringIRSnapshot;
  generatorDeclarations: SemanticGeneratorDeclaration[];
}> {
  const input = await loadWorkspaceEngineeringIRInput(workspaceRoot);
  return {
    snapshot: buildValidatedEngineeringIR(input.engineeringIRInput),
    generatorDeclarations: input.generatorDeclarations
  };
}

export async function runWorkspaceSemanticFrontend(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<PipelineSemanticContext> {
  return executePipelineStage(
    workspaceRoot,
    'semantic',
    context,
    async () => {
      const staleLock = await readLockFile(workspaceRoot);
      delete staleLock.semanticLoweringTasks;
      delete staleLock.semanticViews;
      await saveLock(workspaceRoot, staleLock);

      const { snapshot, generatorDeclarations } = await buildWorkspaceValidatedEngineeringIR(workspaceRoot);
      const generatorPlan = buildSemanticGeneratorPlan(snapshot, generatorDeclarations);
      const semanticViews = buildSemanticViewSet(snapshot);
      const semanticContext = bindPipelineSemanticContext(context, snapshot, generatorPlan, semanticViews);
      const lock = await readLockFile(workspaceRoot);
      lock.semanticLoweringTasks = generatorPlan.tasks.map((task) => ({
        ...structuredClone(task),
        status: 'pending'
      }));
      lock.semanticViews = structuredClone(semanticViews);
      await saveLock(workspaceRoot, lock);
      return semanticContext;
    },
    { extractLock: () => readLockFile(workspaceRoot) }
  );
}
