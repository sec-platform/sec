import { assertNativeAbortSignal, throwIfNativeAborted } from '../contracts/native-abort.ts';
import type { LockFile, PlanFile } from '../compiler/contract.ts';
import { CompilerError } from '../compiler/errors.ts';
import type { PipelineSemanticContext } from '../compiler/pipeline/semantic-context.ts';
import {
  resolveOpaqueModuleMaterializationMode,
  type OpaqueModuleMaterializationEnvironment,
  type OpaqueModuleMaterializationMode
} from '../compiler/target-materialization.ts';

export type ComposeWorkspaceOptions = Readonly<{
  lock?: boolean;
  signal?: AbortSignal;
  opaqueModuleMaterializationMode?: OpaqueModuleMaterializationMode;
}>;

export type PreparedComposeWorkspaceRequest = Readonly<{
  signal?: AbortSignal;
  materializationMode: OpaqueModuleMaterializationMode;
}>;

export interface ComposeWorkspaceOperations {
  readPlan(): PlanFile;
  readLock(): LockFile;
  compose(
    lock: LockFile,
    semanticContext: PipelineSemanticContext,
    request: PreparedComposeWorkspaceRequest
  ): void | PromiseLike<void>;
}

/** Capture one compose request before any transaction, callback or effect. */
export function prepareComposeWorkspaceRequest(
  options: ComposeWorkspaceOptions | undefined,
  environment: OpaqueModuleMaterializationEnvironment
): PreparedComposeWorkspaceRequest {
  const signal = options?.signal;
  if (signal !== undefined) assertNativeAbortSignal(signal);
  throwIfNativeAborted(signal);
  if (options?.lock) {
    throw new CompilerError(
      'COMPOSE-LOCK-001',
      'compose --lock is unavailable until a retained permission provider can prove no-follow ownership and readback; OS chmod is not a SEC authority boundary.'
    );
  }
  return Object.freeze({
    ...(signal === undefined ? {} : { signal }),
    materializationMode: resolveOpaqueModuleMaterializationMode(
      options?.opaqueModuleMaterializationMode,
      environment
    )
  });
}

/** Coordinate the already admitted compose use case. Physical readers,
 * target effects, commit fences and semantic linkage admission stay injected. */
export async function composeWorkspaceResult(
  semanticContext: PipelineSemanticContext,
  request: PreparedComposeWorkspaceRequest,
  operations: ComposeWorkspaceOperations
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const { readPlan, readLock, compose } = operations;
  if ([readPlan, readLock, compose].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace compose operations must be callable');
  }
  throwIfNativeAborted(request.signal);
  const plan = readPlan.call(operations);
  const lock = readLock.call(operations);
  await compose.call(operations, lock, semanticContext, request);
  throwIfNativeAborted(request.signal);
  return { plan, lock };
}
