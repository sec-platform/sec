import type { ValidatedVerificationArtifactSet } from '../../../assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { productVerificationSubjectRevision } from '../../../assurance/verification/project/report.ts';
import { finalizeProvenanceArtifacts } from '../../../assurance/verification/provenance/build-provenance.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { digest } from '../../../contracts/canonical.ts';
import { type CommitFence } from '../../../contracts/commit-fence.ts';
import { formatJsonFile } from '../../../contracts/json-text.ts';
import { validateRepairPlan, type RepairPlan } from '../../../semantics/repair/types.ts';
import { buildProvenance } from '../../artifacts/provenance.ts';
import { publishExistingParentCanonicalWorkspaceFile } from '../../filesystem/file-publication.ts';
import { writeJson } from '../../filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace-context.ts';
import { writeGeneratedArtifactWithLock } from '../../workspace/lock.ts';
import { readOptionalVerificationArtifactSet } from '../platform/artifact/runtime/authority.ts';

export async function writeRepairPlan(
  workspaceRoot: string,
  plan: RepairPlan,
  lock: LockFile,
  commitFence?: CommitFence,
  verification?: ValidatedVerificationArtifactSet
): Promise<void> {
  const publicationLock = structuredClone(lock);
  const validatedPlan = validateRepairPlan(plan);
  // Absence remains valid for the standalone writer. The repair application
  // supplies its already-admitted subject-bound diagnostic/completion tuple.
  const artifacts = verification === undefined
    ? readOptionalVerificationArtifactSet(workspaceRoot, 'Repair publication Verification artifact set')
    : verification;
  if (artifacts !== null) {
    const subjectRevision = productVerificationSubjectRevision(publicationLock);
    if (artifacts.verificationReport.summary.claimSummary.gates.some(gate => gate.subjectRevision !== subjectRevision)) {
      throw new CompilerError('REPAIR-BLOCKED-002', 'Verification belongs to a different repair subject');
    }
  }
  const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  await writeGeneratedArtifactWithLock(
    lockPath,
    publicationLock,
    [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.provenance],
    async () => {
      const prepared = await buildProvenance(workspaceRoot, publicationLock, artifacts);
      // Preparation precedes the new plan bytes, so bind that exact new leaf.
      const provenance = finalizeProvenanceArtifacts(prepared.artifacts.map(artifact =>
        artifact.path === CI_ARTIFACT_FILES.repairPlan
          ? { ...artifact, hash: digest(formatJsonFile(validatedPlan)) }
          : artifact
      ));
      await writeJson(repairPlanPath, validatedPlan, commitFence);
      await publishExistingParentCanonicalWorkspaceFile({
        workspaceRoot,
        targetPath: provenancePath,
        bytes: Buffer.from(formatJsonFile(provenance), 'utf8'),
        label: 'Repair provenance projection',
        commitFence
      });
    },
    commitFence
  );
  lock.generatedPaths = [...publicationLock.generatedPaths];
}
