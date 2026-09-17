import type { LockFile } from '../../compiler/contract.ts';
import { revalidateStagedVerificationProof, type StagedVerificationProof } from './staged-verification-proof.ts';
import { assertStagedVerificationLiveContext } from './verify-project.ts';
import { readCanonicalVerificationArtifactSet } from './canonical-artifacts.ts';

export async function revalidateStagedVerificationProofAfterPipeline(
  workspaceRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<void> {
  const artifacts = await readCanonicalVerificationArtifactSet(workspaceRoot);
  await revalidateStagedVerificationProof(workspaceRoot, lock, proof);
  await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
}
