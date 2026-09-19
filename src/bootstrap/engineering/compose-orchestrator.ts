import path from 'node:path';
import {
  composeWorkspaceResult,
  prepareComposeWorkspaceRequest,
  type ComposeWorkspaceOptions,
  type PreparedComposeWorkspaceRequest
} from '../../application/compose-workspace.ts';
import { createWorkspaceWriteCommitFence } from '../../adapters/filesystem/write-lease.ts';
import { composeProject } from '../../adapters/compilation/compose/compose-project.ts';
import { opaqueModuleMaterializationEnvironment } from '../../compiler/target-materialization.ts';
import type { LockFile, PlanFile } from '../../compiler/contract.ts';
import { readLockFile } from '../../adapters/workspace/lock.ts';
import { loadWorkspacePlan } from '../../adapters/workspace/sources/load-plan.ts';
import { executePipelineStage, withPipelineTransaction } from '../../adapters/compilation/pipeline/kernel.ts';
import { requirePipelineSemanticContext } from '../../adapters/compilation/pipeline/semantic-context.ts';
import type { PipelineExecutionContext, PipelineSemanticContext } from '../../adapters/compilation-protocol/types.ts';
import { runWorkspaceSemanticFrontend } from './semantic-orchestrator.ts';

export type { ComposeWorkspaceOptions } from '../../application/compose-workspace.ts';

async function composeWorkspaceCore(
  workspaceRoot: string,
  semanticContext: PipelineSemanticContext,
  context: PipelineExecutionContext,
  request: PreparedComposeWorkspaceRequest
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  return composeWorkspaceResult(semanticContext, request, {
    readPlan: () => loadWorkspacePlan(workspaceRoot),
    readLock: () => readLockFile(workspaceRoot),
    compose: (lock, semantic, prepared) => composeProject(workspaceRoot, lock, semantic, {
      commitFence,
      signal: prepared.signal,
      opaqueModuleMaterializationMode: prepared.materializationMode
    })
  });
}

async function executePreparedCompose(
  workspaceRoot: string,
  request: PreparedComposeWorkspaceRequest,
  context: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  return executePipelineStage(
    workspaceRoot,
    'compose',
    context,
    stageContext => composeWorkspaceCore(
      workspaceRoot,
      requirePipelineSemanticContext(stageContext),
      stageContext,
      request
    ),
    { extractLock: result => result.lock }
  );
}

export async function composeWorkspace(
  workspaceRoot = process.cwd(),
  options?: ComposeWorkspaceOptions,
  context?: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  workspaceRoot = path.resolve(workspaceRoot);
  const request = prepareComposeWorkspaceRequest(
    options,
    opaqueModuleMaterializationEnvironment(process.env)
  );
  if (context) return executePreparedCompose(workspaceRoot, request, context);
  return withPipelineTransaction(
    workspaceRoot,
    'api',
    ['semantic', 'compose'],
    undefined,
    async transaction => {
      await runWorkspaceSemanticFrontend(workspaceRoot, transaction);
      return executePreparedCompose(workspaceRoot, request, transaction);
    }
  );
}
