import { readOptionalCanonicalVerificationArtifactSet } from '../../verification/platform/artifact/runtime/authority.ts';
import type { CommitFence } from "../../../contracts/commit-fence.ts";
import type { LockFile } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { assertPassStatus } from "../../../compiler/contract/lock-schema.ts";
import { saveLock } from "../../workspace/lock.ts";
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
