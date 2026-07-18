import { createHash } from 'node:crypto';

import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import {
  assertCanonicalVerificationArtifactSet,
  type CanonicalVerificationArtifactSet
} from '../../shared/verification-artifact-contract.ts';
import type {
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../../shared/verification-types.ts';
import { stagedVerificationProjectInputDigest } from './semantic-mutation-staged-project-input.ts';

const PROOF_FORMAT_REVISION = 'staged-verification-proof-v1' as const;
const SOURCE_FORMAT_REVISION = 'staged-verification-proof-source-v1' as const;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PROOF_BINDING_KEYS = Object.freeze([
  'inputRevision',
  'semanticRevision',
  'planRevision',
  'stagedSourceDigest',
  'requiredVerificationDigest',
  'verificationExecutionRevision',
  'verificationReportDigest'
] as const);
const SORTED_PROOF_BINDING_KEYS = Object.freeze([...PROOF_BINDING_KEYS].sort());

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
  readonly formatRevision: typeof SOURCE_FORMAT_REVISION;
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
  readonly formatRevision: typeof PROOF_FORMAT_REVISION;
  readonly projectInputDigest: `sha256:${string}`;
  readonly verificationArtifactDigest: `sha256:${string}`;
  readonly rawArtifactSetDigest: `sha256:${string}`;
  readonly artifactSetDigest: `sha256:${string}`;
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
  readonly testOnly: boolean;
  consumed: boolean;
  consuming: boolean;
}

const issuedSources = new WeakMap<StagedVerificationProofSource, SourceState>();
const issuedProofs = new WeakMap<StagedVerificationProof, ProofState>();

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function frozenArtifacts(artifacts: StagedVerificationArtifactSet): CanonicalVerificationArtifactSet {
  const frozen = deepFreeze(structuredClone({
    verificationReport: artifacts.verificationReport,
    runtimeReport: artifacts.runtimeReport,
    policyReport: artifacts.policyReport,
    acceptanceCoverage: artifacts.acceptanceCoverage
  }));
  assertCanonicalVerificationArtifactSet(frozen);
  if (frozen.verificationReport.summary.status !== 'passed' ||
    frozen.verificationReport.summary.requestedLane !== 'all' ||
    frozen.verificationReport.fast.status !== 'passed' ||
    frozen.verificationReport.runtime.status !== 'passed') {
    throw new Error('Staged Verification proof requires one complete passing all-lane report');
  }
  return frozen;
}

function assertDigest(value: string, label: string): void {
  if (!DIGEST_PATTERN.test(value)) throw new Error(`${label} must be one SHA-256 digest`);
}

function rawArtifactSetDigest(
  digests: StagedVerificationRawArtifactDigests
): `sha256:${string}` {
  return sha256(JSON.stringify({
    verificationReport: digests.verificationReport,
    runtimeReport: digests.runtimeReport,
    policyReport: digests.policyReport,
    acceptanceCoverage: digests.acceptanceCoverage
  }));
}

function assertBinding(binding: StagedVerificationProofBinding): void {
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
  ] as const) assertDigest(value, label);
}

function proofBindingMatches(
  proof: StagedVerificationProof,
  binding: StagedVerificationProofBinding
): boolean {
  const keys = Object.keys(binding).sort();
  if (keys.length !== SORTED_PROOF_BINDING_KEYS.length ||
    !keys.every((key, index) => key === SORTED_PROOF_BINDING_KEYS[index])) {
    return false;
  }
  return PROOF_BINDING_KEYS.every((key) => binding[key] === proof[key]);
}

function assertLiveLockBinding(lock: LockFile, proof: StagedVerificationProof): void {
  if (!lock.semanticViews ||
    lock.semanticViews.inputRevision !== proof.inputRevision ||
    lock.semanticViews.semanticRevision !== proof.semanticRevision ||
    (lock.semanticLoweringTasks ?? []).some((task) =>
      task.inputRevision !== proof.inputRevision || task.semanticRevision !== proof.semanticRevision)) {
    throw new Error('Live rebuild revisions do not match the staged Verification proof');
  }
}

export async function issueStagedVerificationProofSource(input: {
  readonly stagingProjectRoot: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly evidenceDigest: string;
  readonly rawArtifactDigests: StagedVerificationRawArtifactDigests;
  readonly artifacts: StagedVerificationArtifactSet;
}): Promise<StagedVerificationProofSource> {
  assertDigest(input.inputRevision, 'Staged Verification input revision');
  assertDigest(input.semanticRevision, 'Staged Verification semantic revision');
  assertDigest(input.evidenceDigest, 'Staged Verification evidence digest');
  for (const [value, label] of [
    [input.rawArtifactDigests.verificationReport, 'verificationReport'],
    [input.rawArtifactDigests.runtimeReport, 'runtimeReport'],
    [input.rawArtifactDigests.policyReport, 'policyReport'],
    [input.rawArtifactDigests.acceptanceCoverage, 'acceptanceCoverage']
  ] as const) {
    assertDigest(value, `Staged Verification raw ${label} digest`);
  }
  const artifacts = frozenArtifacts(input.artifacts);
  const source = Object.freeze({ formatRevision: SOURCE_FORMAT_REVISION });
  issuedSources.set(source, {
    artifacts,
    evidenceDigest: input.evidenceDigest,
    inputRevision: input.inputRevision,
    semanticRevision: input.semanticRevision,
    projectInputDigest: await stagedVerificationProjectInputDigest(input.stagingProjectRoot),
    rawArtifactSetDigest: rawArtifactSetDigest(input.rawArtifactDigests),
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
  readonly testOnly: boolean;
}): Promise<StagedVerificationProof> {
  assertBinding(input.binding);
  const artifacts = frozenArtifacts(input.artifacts);
  const proof = Object.freeze({
    formatRevision: PROOF_FORMAT_REVISION,
    ...input.binding,
    projectInputDigest: input.projectInputDigest,
    verificationArtifactDigest: sha256(JSON.stringify(artifacts.verificationReport)),
    rawArtifactSetDigest: input.rawArtifactSetDigest,
    artifactSetDigest: sha256(JSON.stringify(artifacts))
  });
  issuedProofs.set(proof, {
    artifacts,
    consumed: false,
    consuming: false,
    testOnly: input.testOnly
  });
  return proof;
}

export async function issueStagedVerificationProof(input: {
  readonly source: StagedVerificationProofSource;
  readonly evidenceDigest: string;
  readonly binding: StagedVerificationProofBinding;
}): Promise<StagedVerificationProof> {
  const source = issuedSources.get(input.source);
  assertBinding(input.binding);
  if (!source || source.consumed || input.source.formatRevision !== SOURCE_FORMAT_REVISION ||
    input.evidenceDigest !== source.evidenceDigest ||
    input.binding.inputRevision !== source.inputRevision ||
    input.binding.semanticRevision !== source.semanticRevision) {
    throw new Error('Staged Verification proof source is unavailable or does not match its report');
  }
  source.consumed = true;
  if (await stagedVerificationProjectInputDigest(source.stagingProjectRoot) !==
    source.projectInputDigest) {
    throw new Error('Staged Verification project inputs changed after isolated completion');
  }
  return registerProof({
    binding: input.binding,
    projectInputDigest: source.projectInputDigest,
    rawArtifactSetDigest: source.rawArtifactSetDigest,
    artifacts: source.artifacts,
    testOnly: false
  });
}

export async function issueStagedVerificationProofForTests(input: {
  readonly stagingProjectRoot: string;
  readonly binding: StagedVerificationProofBinding;
  readonly rawArtifactDigests: StagedVerificationRawArtifactDigests;
  readonly artifacts: StagedVerificationArtifactSet;
}): Promise<StagedVerificationProof> {
  return registerProof({
    binding: input.binding,
    projectInputDigest: await stagedVerificationProjectInputDigest(input.stagingProjectRoot),
    rawArtifactSetDigest: rawArtifactSetDigest(input.rawArtifactDigests),
    artifacts: input.artifacts,
    testOnly: true
  });
}

export function assertStagedVerificationProofBinding(
  proof: StagedVerificationProof,
  binding: StagedVerificationProofBinding
): void {
  const state = issuedProofs.get(proof);
  if (!state || state.testOnly || !proofBindingMatches(proof, binding)) {
    throw new Error('Staged Verification proof does not match the committed execution');
  }
}

async function consumeProof(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof,
  allowTestOnly: boolean
): Promise<CanonicalVerificationArtifactSet> {
  const state = issuedProofs.get(proof);
  if (!state || state.consumed || state.consuming || (!allowTestOnly && state.testOnly) ||
    proof.formatRevision !== PROOF_FORMAT_REVISION) {
    throw new Error('Staged Verification proof is unavailable or already consumed');
  }
  state.consuming = true;
  try {
    assertLiveLockBinding(lock, proof);
    if (await stagedVerificationProjectInputDigest(liveProjectRoot) !== proof.projectInputDigest ||
      sha256(JSON.stringify(state.artifacts)) !== proof.artifactSetDigest ||
      sha256(JSON.stringify(state.artifacts.verificationReport)) !== proof.verificationArtifactDigest) {
      throw new Error('Live rebuild inputs do not match the staged Verification proof');
    }
    state.consumed = true;
    return deepFreeze(structuredClone(state.artifacts));
  } finally {
    state.consuming = false;
  }
}

export async function consumeStagedVerificationProof(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<CanonicalVerificationArtifactSet> {
  return consumeProof(liveProjectRoot, lock, proof, false);
}

export async function consumeStagedVerificationProofForTests(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<CanonicalVerificationArtifactSet> {
  return consumeProof(liveProjectRoot, lock, proof, true);
}

async function revalidateProof(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof,
  allowTestOnly: boolean
): Promise<void> {
  const state = issuedProofs.get(proof);
  if (!state?.consumed || (!allowTestOnly && state.testOnly)) {
    throw new Error('Staged Verification proof was not consumed');
  }
  assertLiveLockBinding(lock, proof);
  if (await stagedVerificationProjectInputDigest(liveProjectRoot) !== proof.projectInputDigest) {
    throw new Error('Live rebuild inputs changed after staged Verification proof consumption');
  }
}

export async function revalidateStagedVerificationProof(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<void> {
  return revalidateProof(liveProjectRoot, lock, proof, false);
}

export async function revalidateStagedVerificationProofForTests(
  liveProjectRoot: string,
  lock: LockFile,
  proof: StagedVerificationProof
): Promise<void> {
  return revalidateProof(liveProjectRoot, lock, proof, true);
}
