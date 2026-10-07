import { productVerificationSubjectRevision } from '../../../assurance/verification/project/report.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { assertPassStatus } from "../../../compiler/contract/lock-schema.ts";
import { CompilerError } from '../../../compiler/errors.ts';
import type { CommitFence } from "../../../contracts/commit-fence.ts";
import { writeProvenance } from '../../artifacts/provenance.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../verification/platform/artifact/runtime/authority.ts';

export async function lockProject(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<LockFile> {
  const publicationLock = structuredClone(lock);
  assertPassStatus(publicationLock, 'verify', 'succeeded', new CompilerError('LOCK-BLOCKED-001', 'verify must succeed before lock'));

  const artifacts = readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Lock Verification artifact set'
  );
  if (artifacts === null) {
    throw new CompilerError('LOCK-BLOCKED-002', 'lock requires the canonical Verification artifact set to exist');
  }
  const report = artifacts.verificationReport;
  const subjectRevision = productVerificationSubjectRevision(publicationLock);
  if (report.summary.claimSummary.gates.some(gate => gate.subjectRevision !== subjectRevision)) {
    throw new CompilerError('LOCK-BLOCKED-002', 'Verification belongs to a different Lock subject');
  }
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    throw new CompilerError('LOCK-BLOCKED-002', 'lock requires a passing verify --lane all result');
  }

  publicationLock.passStatus.lock = 'succeeded';
  await writeProvenance(workspaceRoot, publicationLock, commitFence, artifacts);
  // The workspace coordinator consumes these successful output fields on its
  // original Lock; physical publication and this return use the captured input.
  lock.passStatus.lock = 'succeeded';
  lock.generatedPaths = [...publicationLock.generatedPaths];
  return publicationLock;
}
