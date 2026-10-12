import path from 'node:path';
import type { VerificationArtifactPublicationArtifacts } from '../../../assurance/verification/artifact/publication.ts';
import { CI_ARTIFACT_FILES } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { finalizeProvenanceArtifacts } from '../../../assurance/verification/provenance/build-provenance.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { cloneAndDeepFreeze, digest } from '../../../contracts/canonical.ts';
import { type CommitFence } from '../../../contracts/commit-fence.ts';
import { formatJsonFile } from '../../../contracts/json-text.ts';
import { validateRepairPlan, type RepairPlan } from '../../../semantics/repair/types.ts';
import { buildProvenanceFromVerificationPublication } from '../../artifacts/provenance.ts';
import { publishExistingParentCanonicalWorkspaceFile } from '../../filesystem/file-publication.ts';
import { writeJson } from '../../filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace-context.ts';
import { writeGeneratedArtifactWithLock } from '../../workspace/lock.ts';
import { readOptionalCurrentVerificationPublication } from '../platform/artifact/runtime/authority.ts';

export async function writeRepairPlan(
  workspaceRoot: string,
  plan: RepairPlan,
  lock: LockFile,
  commitFence?: CommitFence,
  verification?: VerificationArtifactPublicationArtifacts
): Promise<void> {
  workspaceRoot = path.resolve(workspaceRoot);
  if (commitFence !== undefined && typeof commitFence !== 'function') {
    throw new TypeError('Repair publication commit fence must be callable');
  }
  const publicationLock = structuredClone(lock);
  const publicationPlan = validateRepairPlan(plan);
  const repairPlanHash = digest(formatJsonFile(publicationPlan));
  const artifacts = cloneAndDeepFreeze(verification ?? readOptionalCurrentVerificationPublication(
    workspaceRoot, publicationLock, 'Repair provenance Verification publication'
  ));
  const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  await writeGeneratedArtifactWithLock(
    lockPath,
    publicationLock,
    [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.provenance],
    async () => {
      // Validate and prepare the same current tuple before either artifact is
      // written. Partial-lane diagnostics must never reread the all-lane owner.
      const preparedProvenance = await buildProvenanceFromVerificationPublication(
        workspaceRoot, publicationLock, artifacts
      );
      // The repair-plan leaf is about to change. Bind its prepared canonical
      // bytes rather than retaining an absent or previous generation's hash.
      const provenance = finalizeProvenanceArtifacts(preparedProvenance.artifacts.map(artifact =>
        artifact.path === CI_ARTIFACT_FILES.repairPlan
          ? { ...artifact, hash: repairPlanHash }
          : artifact
      ));
      await writeJson(repairPlanPath, publicationPlan, commitFence);
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
  // Preserve the original writer's generated-path result after one final Lock
  // publication. Caller aliases cannot change the captured publication subject.
  lock.generatedPaths = [...publicationLock.generatedPaths];
}
