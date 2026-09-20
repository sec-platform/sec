import type { AcceptanceCoverageReport } from '../../acceptance/coverage.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../contract/types.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { rawSha256 } from '../../../contracts/canonical.ts';
import type { PolicyReport } from '../../../semantics/policies/types.ts';
import type { SemanticMutationVerificationExecutionRef } from '../../../semantics/mutation/types.ts';

export const STAGED_VERIFICATION_PROOF_FORMAT_REVISION = 'staged-verification-proof-v1' as const;
export const STAGED_VERIFICATION_PROOF_SOURCE_FORMAT_REVISION = 'staged-verification-proof-source-v1' as const;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
export const STAGED_VERIFICATION_PROOF_BINDING_KEYS = Object.freeze([
  'inputRevision',
  'semanticRevision',
  'planRevision',
  'stagedSourceDigest',
  'requiredVerificationDigest',
  'verificationExecutionRevision',
  'verificationReportDigest'
] as const);
const SORTED_PROOF_BINDING_KEYS = Object.freeze([...STAGED_VERIFICATION_PROOF_BINDING_KEYS].sort());

export interface StagedVerificationArtifactSet {
  readonly verificationReport: VerificationReport;
  readonly runtimeReport: RuntimeVerificationLaneReport;
  readonly policyReport: PolicyReport;
  readonly acceptanceCoverage: AcceptanceCoverageReport;
}

export interface StagedVerificationRawArtifactDigests {
  readonly verificationReport: string;
  readonly runtimeReport: string;
  readonly policyReport: string;
  readonly acceptanceCoverage: string;
}

export interface StagedVerificationProofSource {
  readonly formatRevision: typeof STAGED_VERIFICATION_PROOF_SOURCE_FORMAT_REVISION;
}

export interface StagedVerificationProofBinding {
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly planRevision: string;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly verificationExecutionRevision: string;
  readonly verificationReportDigest: string;
}

export interface StagedVerificationProof extends StagedVerificationProofBinding {
  readonly formatRevision: typeof STAGED_VERIFICATION_PROOF_FORMAT_REVISION;
  readonly projectInputDigest: `sha256:${string}`;
  readonly verificationArtifactDigest: `sha256:${string}`;
  readonly rawArtifactSetDigest: `sha256:${string}`;
  readonly artifactSetDigest: `sha256:${string}`;
}

export function assertStagedVerificationDigest(value: string, label: string): void {
  if (!DIGEST_PATTERN.test(value)) throw new Error(`${label} must be one SHA-256 digest`);
}

export function stagedVerificationRawArtifactSetDigest(
  digests: StagedVerificationRawArtifactDigests
): `sha256:${string}` {
  return rawSha256(JSON.stringify({
    verificationReport: digests.verificationReport,
    runtimeReport: digests.runtimeReport,
    policyReport: digests.policyReport,
    acceptanceCoverage: digests.acceptanceCoverage
  }));
}

export function assertStagedVerificationProofBindingShape(binding: StagedVerificationProofBinding): void {
  const keys = Object.keys(binding).sort();
  if (keys.length !== SORTED_PROOF_BINDING_KEYS.length ||
    !keys.every((key, index) => key === SORTED_PROOF_BINDING_KEYS[index])) {
    throw new Error('Staged Verification proof binding must use the exact canonical fields');
  }
  for (const [value, label] of [
    [binding.inputRevision, 'Staged Verification input revision'],
    [binding.semanticRevision, 'Staged Verification semantic revision'],
    [binding.planRevision, 'Staged Verification plan revision'],
    [binding.stagedSourceDigest, 'Staged Verification source digest'],
    [binding.requiredVerificationDigest, 'Staged Verification requirement digest'],
    [binding.verificationExecutionRevision, 'Staged Verification execution revision'],
    [binding.verificationReportDigest, 'Staged Verification report digest']
  ] as const) assertStagedVerificationDigest(value, label);
}

export function stagedVerificationProofBindingMatches(
  proof: StagedVerificationProof,
  binding: StagedVerificationProofBinding
): boolean {
  const keys = Object.keys(binding).sort();
  if (keys.length !== SORTED_PROOF_BINDING_KEYS.length ||
    !keys.every((key, index) => key === SORTED_PROOF_BINDING_KEYS[index])) return false;
  return STAGED_VERIFICATION_PROOF_BINDING_KEYS.every((key) => binding[key] === proof[key]);
}

export function assertStagedVerificationLiveLockBinding(lock: LockFile, proof: StagedVerificationProof): void {
  if (!lock.semanticViews ||
    lock.semanticViews.inputRevision !== proof.inputRevision ||
    lock.semanticViews.semanticRevision !== proof.semanticRevision ||
    (lock.semanticLoweringTasks ?? []).some((task) =>
      task.inputRevision !== proof.inputRevision || task.semanticRevision !== proof.semanticRevision)) {
    throw new Error('Live rebuild revisions do not match the staged Verification proof');
  }
}

export function buildStagedVerificationProofBinding(
  execution: SemanticMutationVerificationExecutionRef & { readonly status: 'passed' },
  verificationReportDigest: string
): StagedVerificationProofBinding {
  const binding = Object.freeze({
    inputRevision: execution.attempted.inputRevision,
    semanticRevision: execution.attempted.semanticRevision,
    planRevision: execution.planRevision,
    stagedSourceDigest: execution.stagedSourceDigest,
    requiredVerificationDigest: execution.requiredVerificationDigest,
    verificationExecutionRevision: execution.verificationExecutionRevision,
    verificationReportDigest
  });
  assertStagedVerificationProofBindingShape(binding);
  return binding;
}
