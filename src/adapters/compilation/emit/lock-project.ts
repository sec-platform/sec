import type { LockFile } from '../../../compiler/contract.ts';
import type { CommitFence } from "../../../contracts/commit-fence.ts";
import { CodedFailure } from '../../../contracts/failure.ts';
import { writeProvenanceFromVerification } from '../../artifacts/provenance.ts';
import { readOptionalCurrentVerificationArtifactSet } from '../../verification/platform/artifact/runtime/authority.ts';

export async function lockProject(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<LockFile> {
  // Own one input for this operation before any suspension. Callers may still
  // change their Lock object, but cannot retarget the checked publication.
  const publicationLock = structuredClone(lock);
  const artifacts = readOptionalCurrentVerificationArtifactSet(
    workspaceRoot,
    publicationLock,
    'Lock Verification artifact set'
  );
  if (artifacts === null) {
    throw new CodedFailure('LOCK-BLOCKED-002', 'lock requires the canonical Verification artifact set to exist');
  }
  const report = artifacts.verificationReport;
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    throw new CodedFailure('LOCK-BLOCKED-002', 'lock requires a passing verify --lane all result');
  }

  publicationLock.passStatus.lock = 'succeeded';
  // Provenance publication also durably publishes the generated-path Lock.
  await writeProvenanceFromVerification(workspaceRoot, publicationLock, artifacts, commitFence);
  return publicationLock;
}
