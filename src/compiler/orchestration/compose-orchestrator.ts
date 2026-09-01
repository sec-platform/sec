import { createWorkspaceWriteCommitFence } from '../../workspace/lease.ts';
import { composeProject } from '../compose/compose-project.ts';
import type {
  LockFile,
  PlanFile
} from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { readLockFile } from '../lock.ts';
import { loadWorkspacePlan } from '../parse/load-plan.ts';
import { executePipelineStage, withPipelineTransaction } from '../pipeline/kernel.ts';
import { requirePipelineSemanticContext } from '../pipeline/semantic-context.ts';
import type { PipelineExecutionContext, PipelineSemanticContext } from '../pipeline/types.ts';
import { runWorkspaceSemanticFrontend } from './semantic-orchestrator.ts';

function readRequiredComposeLock(workspaceRoot: string): LockFile {
  try {
    return readLockFile(workspaceRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new CompilerError('COMPOSE-BLOCKED-001', 'graph.lock.json is missing', {
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

function assertComposeOptions(options?: { lock?: boolean; signal?: AbortSignal }): void {
  if (options?.lock) {
    throw new CompilerError(
      'COMPOSE-LOCK-001',
      'compose --lock is unavailable until a retained permission provider can prove no-follow ownership and readback; OS chmod is not a SEC authority boundary.'
    );
  }
}

async function composeWorkspaceCore(
  workspaceRoot: string,
  semanticContext: PipelineSemanticContext,
  context: PipelineExecutionContext,
  options?: { lock?: boolean; signal?: AbortSignal }
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const plan = loadWorkspacePlan(workspaceRoot);
  const lock = readRequiredComposeLock(workspaceRoot);
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  await composeProject(workspaceRoot, lock, semanticContext, {
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
  // Validate effect capabilities before opening a Pipeline transaction. An
  // unsupported option must be zero-effect, not "fail after semantic writes".
  assertComposeOptions(options);
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
