import type { StagedVerificationProof } from '../../assurance/verification/staged-proof/contract.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { readCanonicalVerificationArtifactSet } from './canonical-artifacts.ts';
import { revalidateStagedVerificationProof } from './staged-verification-proof.ts';
import { assertStagedVerificationLiveContext } from './verify-project.ts';

export async function revalidateStagedVerificationProofAfterPipeline(
  workspaceRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<void> {
  const artifacts = await readCanonicalVerificationArtifactSet(workspaceRoot);
  await revalidateStagedVerificationProof(workspaceRoot, lock, proof);
  await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
}
