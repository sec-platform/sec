import { composeProject } from '../compiler/compose/compose-project.ts';
import { loadWorkspacePlan } from '../compiler/index.ts';
import { adaptProject } from '../compiler/synthesize/adapt-project.ts';
import { CompilerError } from '../shared/errors.ts';
import { pathExists } from '../shared/fs.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { resolveWorkspaceLockPath } from '../shared/paths.ts';
import { executePipelineStage, withPipelineTransaction } from '../shared/pipeline-kernel.ts';
import { requirePipelineSemanticContext } from '../shared/pipeline-semantic-context.ts';
import type { PipelineExecutionContext, PipelineSemanticContext } from '../shared/pipeline-types.ts';
import type { LockFile, PlanFile } from '../shared/types.ts';
import { createWorkspaceWriteCommitFence } from '../shared/workspace-write-lease.ts';
import { runWorkspaceSemanticFrontend } from './semantic-orchestrator.ts';

async function composeWorkspaceCore(
  workspaceRoot: string,
  semanticContext: PipelineSemanticContext,
  context: PipelineExecutionContext,
  options?: { lock?: boolean; signal?: AbortSignal }
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  if (!(await pathExists(readableLockPath))) {
    throw new CompilerError('COMPOSE-BLOCKED-001', 'graph.lock.json is missing');
  }
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  await composeProject(workspaceRoot, lock, semanticContext, {
    lockFiles: !!options?.lock,
    commitFence,
    signal: options?.signal
  });
  return { plan, lock };
}

export async function composeWorkspace(
  workspaceRoot = process.cwd(),
  options?: { lock?: boolean; signal?: AbortSignal },
  context?: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  if (!context) {
    return withPipelineTransaction(
      workspaceRoot,
      'api',
      ['semantic', 'compose'],
      undefined,
      async (transaction) => {
        await runWorkspaceSemanticFrontend(workspaceRoot, transaction);
        return composeWorkspace(workspaceRoot, options, transaction);
      }
    );
  }
  return executePipelineStage(
    workspaceRoot,
    'compose',
    context,
    (stageContext) => composeWorkspaceCore(
      workspaceRoot,
      requirePipelineSemanticContext(stageContext),
      stageContext,
      options
    ),
    { extractLock: (result) => result.lock }
  );
}

async function adaptWorkspaceCore(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  await adaptProject(workspaceRoot, plan, lock, commitFence);
  return { plan, lock };
}

export async function adaptWorkspace(
  workspaceRoot = process.cwd(),
  context?: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  return executePipelineStage(
    workspaceRoot,
    'adapt',
    context,
    (stageContext) => adaptWorkspaceCore(workspaceRoot, stageContext),
    { extractLock: (result) => result.lock }
  );
}
