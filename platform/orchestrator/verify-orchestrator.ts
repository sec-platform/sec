import { verifyProject } from '../compiler/verify/verify-project.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import type { VerificationLane, VerificationReport } from '../shared/verification-types.ts';

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: { lane?: VerificationLane; emitTiming?: boolean } = {}
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = await readLockFile(workspaceRoot);
  const report = await verifyProject(workspaceRoot, lock, options.lane ?? 'all', { emitTiming: options.emitTiming });
  return { lock, report };
}
