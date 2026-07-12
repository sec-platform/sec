import { adaptProject, composeProject, loadWorkspacePlan } from '../compiler/index.ts';
import { CompilerError } from '../shared/errors.ts';
import { pathExists } from '../shared/fs.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { resolveWorkspaceLockPath } from '../shared/paths.ts';
import { executePipelineStage, withPipelineTransaction } from '../shared/pipeline-kernel.ts';
import { requirePipelineSemanticContext } from '../shared/pipeline-semantic-context.ts';
import type { PipelineExecutionContext, PipelineSemanticContext } from '../shared/pipeline-types.ts';
import type { LockFile, PlanFile } from '../shared/types.ts';
import { runWorkspaceSemanticFrontend } from './semantic-orchestrator.ts';

async function composeWorkspaceCore(
  workspaceRoot: string,
  semanticContext: PipelineSemanticContext,
  options?: { lock?: boolean }
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  if (!(await pathExists(readableLockPath))) {
    throw new CompilerError('COMPOSE-BLOCKED-001', 'graph.lock.json is missing');
  }
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  await composeProject(workspaceRoot, lock, semanticContext, { lockFiles: !!options?.lock });
  return { plan, lock };
}

export async function composeWorkspace(
  workspaceRoot = process.cwd(),
  options?: { lock?: boolean },
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
    () => composeWorkspaceCore(workspaceRoot, requirePipelineSemanticContext(context), options),
    { extractLock: (result) => result.lock }
  );
}

async function adaptWorkspaceCore(workspaceRoot: string): Promise<{ plan: PlanFile; lock: LockFile }> {
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  await adaptProject(workspaceRoot, plan, lock);
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
    () => adaptWorkspaceCore(workspaceRoot),
    { extractLock: (result) => result.lock }
  );
}
