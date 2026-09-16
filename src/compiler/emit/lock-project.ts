import { readOptionalCanonicalVerificationArtifactSet } from '../../verification/artifact/runtime/authority.ts';
import type { CommitFence } from '../../workspace/files.ts';
import type { LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { assertPassStatus, saveLock } from '../lock.ts';
import { writeProvenance } from './write-provenance.ts';

export async function lockProject(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<LockFile> {
  assertPassStatus(lock, 'verify', 'succeeded', new CompilerError('LOCK-BLOCKED-001', 'verify must succeed before lock'));

  const artifacts = readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Lock Verification artifact set'
  );
  if (artifacts === null) {
    throw new CompilerError('LOCK-BLOCKED-002', 'lock requires the canonical Verification artifact set to exist');
  }
  const report = artifacts.verificationReport;
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    throw new CompilerError('LOCK-BLOCKED-002', 'lock requires a passing verify --lane all result');
  }

  lock.passStatus.lock = 'succeeded';
  await writeProvenance(workspaceRoot, lock, commitFence);
  await saveLock(workspaceRoot, lock, commitFence);
  return lock;
}
