import { verifyProject } from '../compiler/index.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import type { PipelineExecutionContext } from '../shared/pipeline-types.ts';
import type { VerificationLane, VerificationReport } from '../shared/verification-types.ts';

async function verifyWorkspaceCore(
  workspaceRoot: string,
  options: { lane?: VerificationLane; emitTiming?: boolean }
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = await readLockFile(workspaceRoot);
  const report = await verifyProject(workspaceRoot, lock, options.lane ?? 'all', {
    emitTiming: options.emitTiming
  });
  return { lock, report };
}

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: { lane?: VerificationLane; emitTiming?: boolean } = {},
  context?: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  return executePipelineStage(
    workspaceRoot,
    'verify',
    context,
    () => verifyWorkspaceCore(workspaceRoot, options),
    {
      extractLock: (result) => result.lock,
      preserveOwnedPassStates: true
    }
  );
}
