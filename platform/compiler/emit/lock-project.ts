import fs from 'node:fs/promises';
import { CompilerError } from '../../shared/errors.ts';
import { readJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { writeProvenance } from './write-provenance.ts';

export async function lockProject(workspaceRoot: string, lock: LockFile): Promise<LockFile> {
  const { lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);

  if (lock.passStatus.verify !== 'succeeded') {
    throw new CompilerError('LOCK-BLOCKED-001', 'verify must succeed before lock');
  }

  const report = await readJson<VerificationReport>(verificationReportPath);
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    throw new CompilerError('LOCK-BLOCKED-002', 'lock requires a passing verify --lane all result');
  }

  lock.passStatus.lock = 'succeeded';
  await writeProvenance(workspaceRoot, lock);
  lock.passStatus.emit = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}
