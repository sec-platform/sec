import path from 'node:path';
import { createWorkspaceWriteCommitFence } from '../../adapters/filesystem/write-lease.ts';
import { composeProject } from '../../adapters/compilation/compose/compose-project.ts';
import {
  opaqueModuleMaterializationEnvironment,
  resolveOpaqueModuleMaterializationMode,
  type OpaqueModuleMaterializationMode
} from '../../compiler/target-materialization.ts';
import type {
  LockFile,
  PlanFile
} from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { readLockFile } from "../../adapters/workspace/lock.ts";
import { loadWorkspacePlan } from '../../adapters/workspace/sources/load-plan.ts';
import { executePipelineStage, withPipelineTransaction } from '../../adapters/compilation/pipeline/kernel.ts';
import { requirePipelineSemanticContext } from '../../adapters/compilation/pipeline/semantic-context.ts';
import type { PipelineExecutionContext, PipelineSemanticContext } from '../../adapters/compilation-protocol/types.ts';
import { runWorkspaceSemanticFrontend } from './semantic-orchestrator.ts';

export type ComposeWorkspaceOptions = Readonly<{
  lock?: boolean;
  signal?: AbortSignal;
  opaqueModuleMaterializationMode?: OpaqueModuleMaterializationMode;
}>;

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

function captureComposeOptions(options?: ComposeWorkspaceOptions): ComposeWorkspaceOptions {
  const signal = options?.signal;
  signal?.throwIfAborted();
  const lock = options?.lock;
  if (lock) {
    throw new CompilerError(
      'COMPOSE-LOCK-001',
      'compose --lock is unavailable until a retained permission provider can prove no-follow ownership and readback; OS chmod is not a SEC authority boundary.'
    );
  }
  return Object.freeze({ lock, signal, opaqueModuleMaterializationMode: options?.opaqueModuleMaterializationMode });
}

function resolveComposeMaterializationMode(
  options?: ComposeWorkspaceOptions
): OpaqueModuleMaterializationMode {
  return resolveOpaqueModuleMaterializationMode(
    options?.opaqueModuleMaterializationMode,
    opaqueModuleMaterializationEnvironment(process.env)
  );
}

async function composeWorkspaceCore(
  workspaceRoot: string,
  semanticContext: PipelineSemanticContext,
  context: PipelineExecutionContext,
  materializationMode: OpaqueModuleMaterializationMode,
  options?: ComposeWorkspaceOptions
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const plan = loadWorkspacePlan(workspaceRoot);
  const lock = readRequiredComposeLock(workspaceRoot);
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  await composeProject(workspaceRoot, lock, semanticContext, {
    commitFence,
    signal: options?.signal,
    opaqueModuleMaterializationMode: materializationMode
  });
  return { plan, lock };
}

export async function composeWorkspace(
  workspaceRoot = process.cwd(),
  options?: ComposeWorkspaceOptions,
  context?: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  workspaceRoot = path.resolve(workspaceRoot);
  // Validate and resolve all ambient inputs before opening a Pipeline
  // transaction. Unsupported or conflicting inputs must remain zero-effect.
  options = captureComposeOptions(options);
  const materializationMode = resolveComposeMaterializationMode(options);
  if (!context) {
    return withPipelineTransaction(
      workspaceRoot,
      'api',
      ['semantic', 'compose'],
      undefined,
      async (transaction) => {
        await runWorkspaceSemanticFrontend(workspaceRoot, transaction);
        return composeWorkspace(
          workspaceRoot,
          { ...options, opaqueModuleMaterializationMode: materializationMode },
          transaction
        );
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
      materializationMode,
      options
    ),
    { extractLock: (result) => result.lock }
  );
}
