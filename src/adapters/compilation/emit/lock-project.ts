import type { LockFile } from '../../../compiler/contract.ts';
import { assertPassStatus } from "../../../compiler/contract/lock-schema.ts";
import type { CommitFence } from "../../../contracts/commit-fence.ts";
import { CodedFailure } from '../../../contracts/failure.ts';
import { writeProvenance } from '../../artifacts/provenance.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../verification/platform/artifact/runtime/authority.ts';
import { saveLock } from "../../workspace/lock.ts";

export async function lockProject(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<LockFile> {
  assertPassStatus(lock, 'verify', 'succeeded', new CodedFailure('LOCK-BLOCKED-001', 'verify must succeed before lock'));

  const artifacts = readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Lock Verification artifact set'
  );
  if (artifacts === null) {
    throw new CodedFailure('LOCK-BLOCKED-002', 'lock requires the canonical Verification artifact set to exist');
  }
  const report = artifacts.verificationReport;
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    throw new CodedFailure('LOCK-BLOCKED-002', 'lock requires a passing verify --lane all result');
  }

  lock.passStatus.lock = 'succeeded';
  await writeProvenance(workspaceRoot, lock, commitFence);
  await saveLock(workspaceRoot, lock, commitFence);
  return lock;
}
