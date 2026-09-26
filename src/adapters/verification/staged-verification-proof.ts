import type { CanonicalVerificationArtifactSet } from '../../assurance/verification/artifact/contract/artifact.ts';
import type {
  StagedVerificationArtifactSet,
  StagedVerificationProof,
  StagedVerificationProofBinding,
  StagedVerificationProofSource,
  StagedVerificationRawArtifactDigests
} from '../../assurance/verification/staged-proof/contract.ts';
import {
  createStagedVerificationProofRuntime
} from '../../assurance/verification/staged-proof/runtime.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { stagedVerificationProjectInputDigest } from './semantic-mutation/staged-project-input.ts';

const runtime = createStagedVerificationProofRuntime({
  projectInputDigest: stagedVerificationProjectInputDigest
});

export function issueStagedVerificationProofSource(input: {
  readonly stagingProjectRoot: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly evidenceDigest: string;
  readonly rawArtifactDigests: StagedVerificationRawArtifactDigests;
  readonly artifacts: StagedVerificationArtifactSet;
}): Promise<StagedVerificationProofSource> {
  return runtime.issueSource(input);
}

export function issueStagedVerificationProof(input: {
  readonly source: StagedVerificationProofSource;
  readonly evidenceDigest: string;
  readonly binding: StagedVerificationProofBinding;
}): Promise<StagedVerificationProof> {
  return runtime.issueProof(input);
}

export function assertStagedVerificationProofBinding(
  proof: StagedVerificationProof,
  binding: StagedVerificationProofBinding
): void {
  runtime.assertBinding(proof, binding);
}

export function consumeStagedVerificationProof(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<CanonicalVerificationArtifactSet> {
  return runtime.consumeProof(liveProjectRoot, lock, proof);
}

export function revalidateStagedVerificationProof(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<void> {
  return runtime.revalidateProof(liveProjectRoot, lock, proof);
}
