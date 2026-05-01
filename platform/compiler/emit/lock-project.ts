import { CompilerError } from '../../shared/errors.ts';
import { readJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { assertPassStatus, saveLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { writeProvenance } from './write-provenance.ts';

export async function lockProject(workspaceRoot: string, lock: LockFile): Promise<LockFile> {
  const { verificationReportPath } = getWorkspacePaths(workspaceRoot);

  assertPassStatus(lock, 'verify', 'succeeded', new CompilerError('LOCK-BLOCKED-001', 'verify must succeed before lock'));

  const report = await readJson<VerificationReport>(verificationReportPath);
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    throw new CompilerError('LOCK-BLOCKED-002', 'lock requires a passing verify --lane all result');
  }

  lock.passStatus.lock = 'succeeded';
  await writeProvenance(workspaceRoot, lock);
  lock.passStatus.emit = 'succeeded';
  await saveLock(workspaceRoot, lock);
  return lock;
}
