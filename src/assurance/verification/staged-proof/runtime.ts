import { cloneAndDeepFreeze, deepFreeze, rawSha256 } from '../../../contracts/canonical.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import {
  assertCanonicalVerificationArtifactSet,
  type CanonicalVerificationArtifactSet
} from '../artifact/contract/artifact.ts';
import {
  STAGED_VERIFICATION_PROOF_FORMAT_REVISION as PROOF_FORMAT_REVISION,
  STAGED_VERIFICATION_PROOF_SOURCE_FORMAT_REVISION as SOURCE_FORMAT_REVISION,
  assertStagedVerificationDigest,
  assertStagedVerificationLiveLockBinding,
  assertStagedVerificationProofBindingShape,
  stagedVerificationProofBindingMatches,
  stagedVerificationRawArtifactSetDigest,
  type StagedVerificationArtifactSet,
  type StagedVerificationProof,
  type StagedVerificationProofBinding,
  type StagedVerificationProofSource,
  type StagedVerificationRawArtifactDigests
} from './contract.ts';

export interface StagedVerificationProofRuntimeOperations {
  projectInputDigest(root: string): Promise<`sha256:${string}`>;
}

interface SourceState {
  readonly artifacts: CanonicalVerificationArtifactSet;
  readonly evidenceDigest: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly projectInputDigest: `sha256:${string}`;
  readonly rawArtifactSetDigest: `sha256:${string}`;
  readonly stagingProjectRoot: string;
  consumed: boolean;
}

interface ProofState {
  readonly artifacts: CanonicalVerificationArtifactSet;
  consumed: boolean;
  consuming: boolean;
}

function frozenArtifacts(
  artifacts: StagedVerificationArtifactSet
): CanonicalVerificationArtifactSet {
  const clone = structuredClone({
    verificationReport: artifacts.verificationReport,
    runtimeReport: artifacts.runtimeReport,
    policyReport: artifacts.policyReport,
    acceptanceCoverage: artifacts.acceptanceCoverage
  });
  assertCanonicalVerificationArtifactSet(clone);
  const frozen = deepFreeze(clone);
  if (frozen.verificationReport.summary.status !== 'passed' ||
      frozen.verificationReport.summary.requestedLane !== 'all' ||
      frozen.verificationReport.fast.status !== 'passed' ||
      frozen.verificationReport.runtime.status !== 'passed') {
    throw new Error(
      'Staged Verification proof requires one complete passing all-lane report'
    );
  }
  return frozen;
}

/**
 * Own the in-process lifetime and one-shot semantics of staged Verification
 * proof sources and proofs. Physical project-input observation is injected.
 */
export function createStagedVerificationProofRuntime(
  operations: StagedVerificationProofRuntimeOperations
) {
  if (typeof operations.projectInputDigest !== 'function') {
    throw new TypeError(
      'Staged Verification proof project-input digest operation must be callable'
    );
  }

  const issuedSources = new WeakMap<StagedVerificationProofSource, SourceState>();
  const issuedProofs = new WeakMap<StagedVerificationProof, ProofState>();

  async function issueSource(input: {
    readonly stagingProjectRoot: string;
    readonly inputRevision: string;
    readonly semanticRevision: string;
    readonly evidenceDigest: string;
    readonly rawArtifactDigests: StagedVerificationRawArtifactDigests;
    readonly artifacts: StagedVerificationArtifactSet;
  }): Promise<StagedVerificationProofSource> {
    assertStagedVerificationDigest(
      input.inputRevision,
      'Staged Verification input revision'
    );
    assertStagedVerificationDigest(
      input.semanticRevision,
      'Staged Verification semantic revision'
    );
    assertStagedVerificationDigest(
      input.evidenceDigest,
      'Staged Verification evidence digest'
    );
    for (const [value, label] of [
      [input.rawArtifactDigests.verificationReport, 'verificationReport'],
      [input.rawArtifactDigests.runtimeReport, 'runtimeReport'],
      [input.rawArtifactDigests.policyReport, 'policyReport'],
      [input.rawArtifactDigests.acceptanceCoverage, 'acceptanceCoverage']
    ] as const) {
      assertStagedVerificationDigest(
        value,
        `Staged Verification raw ${label} digest`
      );
    }

    const artifacts = frozenArtifacts(input.artifacts);
    const source = Object.freeze({ formatRevision: SOURCE_FORMAT_REVISION });
    issuedSources.set(source, {
      artifacts,
      evidenceDigest: input.evidenceDigest,
      inputRevision: input.inputRevision,
      semanticRevision: input.semanticRevision,
      projectInputDigest: await operations.projectInputDigest.call(
        operations,
        input.stagingProjectRoot
      ),
      rawArtifactSetDigest:
        stagedVerificationRawArtifactSetDigest(input.rawArtifactDigests),
      stagingProjectRoot: input.stagingProjectRoot,
      consumed: false
    });
    return source;
  }

  async function registerProof(input: {
    readonly binding: StagedVerificationProofBinding;
    readonly projectInputDigest: `sha256:${string}`;
    readonly rawArtifactSetDigest: `sha256:${string}`;
    readonly artifacts: StagedVerificationArtifactSet;
  }): Promise<StagedVerificationProof> {
    assertStagedVerificationProofBindingShape(input.binding);
    const artifacts = frozenArtifacts(input.artifacts);
    const proof = Object.freeze({
      formatRevision: PROOF_FORMAT_REVISION,
      ...input.binding,
      projectInputDigest: input.projectInputDigest,
      verificationArtifactDigest:
        rawSha256(JSON.stringify(artifacts.verificationReport)),
      rawArtifactSetDigest: input.rawArtifactSetDigest,
      artifactSetDigest: rawSha256(JSON.stringify(artifacts))
    });
    issuedProofs.set(proof, {
      artifacts,
      consumed: false,
      consuming: false
    });
    return proof;
  }

  async function issueProof(input: {
    readonly source: StagedVerificationProofSource;
    readonly evidenceDigest: string;
    readonly binding: StagedVerificationProofBinding;
  }): Promise<StagedVerificationProof> {
    const source = issuedSources.get(input.source);
    assertStagedVerificationProofBindingShape(input.binding);
    if (!source ||
        source.consumed ||
        input.source.formatRevision !== SOURCE_FORMAT_REVISION ||
        input.evidenceDigest !== source.evidenceDigest ||
        input.binding.inputRevision !== source.inputRevision ||
        input.binding.semanticRevision !== source.semanticRevision) {
      throw new Error(
        'Staged Verification proof source is unavailable or does not match its report'
      );
    }

    source.consumed = true;
    if (await operations.projectInputDigest.call(
      operations,
      source.stagingProjectRoot
    ) !== source.projectInputDigest) {
      throw new Error(
        'Staged Verification project inputs changed after isolated completion'
      );
    }

    return registerProof({
      binding: input.binding,
      projectInputDigest: source.projectInputDigest,
      rawArtifactSetDigest: source.rawArtifactSetDigest,
      artifacts: source.artifacts
    });
  }

  function assertBinding(
    proof: StagedVerificationProof,
    binding: StagedVerificationProofBinding
  ): void {
    const state = issuedProofs.get(proof);
    if (!state || !stagedVerificationProofBindingMatches(proof, binding)) {
      throw new Error(
        'Staged Verification proof does not match the committed execution'
      );
    }
  }

  async function consumeProof(
    liveProjectRoot: string,
    lock: LockFile,
    proof: StagedVerificationProof
  ): Promise<CanonicalVerificationArtifactSet> {
    const state = issuedProofs.get(proof);
    if (!state ||
        state.consumed ||
        state.consuming ||
        proof.formatRevision !== PROOF_FORMAT_REVISION) {
      throw new Error(
        'Staged Verification proof is unavailable or already consumed'
      );
    }

    state.consuming = true;
    try {
      assertStagedVerificationLiveLockBinding(lock, proof);
      if (await operations.projectInputDigest.call(
            operations,
            liveProjectRoot
          ) !== proof.projectInputDigest ||
          rawSha256(JSON.stringify(state.artifacts)) !== proof.artifactSetDigest ||
          rawSha256(JSON.stringify(state.artifacts.verificationReport)) !==
            proof.verificationArtifactDigest) {
        throw new Error(
          'Live rebuild inputs do not match the staged Verification proof'
        );
      }
      state.consumed = true;
      return cloneAndDeepFreeze(state.artifacts);
    } finally {
      state.consuming = false;
    }
  }

  async function revalidateProof(
    liveProjectRoot: string,
    lock: LockFile,
    proof: StagedVerificationProof
  ): Promise<void> {
    const state = issuedProofs.get(proof);
    if (!state?.consumed) {
      throw new Error('Staged Verification proof was not consumed');
    }
    assertStagedVerificationLiveLockBinding(lock, proof);
    if (await operations.projectInputDigest.call(
      operations,
      liveProjectRoot
    ) !== proof.projectInputDigest) {
      throw new Error(
        'Live rebuild inputs changed after staged Verification proof consumption'
      );
    }
  }

  return Object.freeze({
    issueSource,
    issueProof,
    assertBinding,
    consumeProof,
    revalidateProof
  });
}
