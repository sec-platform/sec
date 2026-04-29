import { verifyProject } from '../compiler/verify/verify-project.ts';
import { readJson } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { resolveWorkspaceLockPath } from '../shared/paths.ts';
import type { VerificationLane, VerificationReport } from '../shared/verification-types.ts';

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: { lane?: VerificationLane; emitTiming?: boolean } = {}
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  const report = await verifyProject(workspaceRoot, lock, options.lane ?? 'all', { emitTiming: options.emitTiming });
  return { lock, report };
}
