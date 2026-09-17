import { assertGitBranchName } from '../../../contracts/git-reference.ts';

export type ActiveWorkPackageObservationState = 'active' | 'none' | 'invalid' | 'unresolved';

declare const ACTIVE_WORK_PACKAGE_OWNER_OBSERVATION_BRAND: unique symbol;

/**
 * Runtime-issued observation of the Task owner's active Work Package state.
 * Object literals and presentation projections cannot satisfy this boundary.
 */
export type ActiveWorkPackageOwnerObservation = Readonly<{
  readonly repository: string;
  readonly defaultBranch: string;
  readonly defaultSha: string | null;
  readonly observedAt: string;
  readonly state: ActiveWorkPackageObservationState;
  readonly branch: string | null;
  readonly manifest: string | null;
  readonly reason: string | null;
  readonly [ACTIVE_WORK_PACKAGE_OWNER_OBSERVATION_BRAND]: true;
}>;

export type ActiveWorkPackageOwnerObservationInput = Readonly<{
  repository: string;
  defaultBranch: string;
  defaultSha: string | null;
  observedAt: string;
  state: ActiveWorkPackageObservationState;
  branch: string | null;
  manifest: string | null;
  reason: string | null;
}>;

const issuedActiveWorkPackageOwnerObservations = new WeakSet<object>();

function canonicalText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('\0')) {
    throw new Error(`${label} must be one non-empty trimmed string.`);
  }
  return value;
}

function assertGitSha(value: string, label: string): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
  }
}

/**
 * Capability-gated issuer used only by the documentation owner after its live
 * resolver has produced one exact active-work observation.
 */
export function issueActiveWorkPackageOwnerObservation(
  input: ActiveWorkPackageOwnerObservationInput
): ActiveWorkPackageOwnerObservation {
  const keys = Object.keys(input).sort();
  const expectedKeys = [
    'branch',
    'defaultBranch',
    'defaultSha',
    'manifest',
    'observedAt',
    'reason',
    'repository',
    'state'
  ];
  if (keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('active-work observation keys are invalid.');
  }
  const repository = canonicalText(input.repository, 'active-work observation repository');
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error('active-work observation repository must be one owner/name identity.');
  }
  const defaultBranch = canonicalText(input.defaultBranch, 'active-work observation default branch');
  assertGitBranchName(defaultBranch, 'active-work observation default branch');
  if (input.defaultSha !== null) {
    assertGitSha(input.defaultSha, 'active-work observation default SHA');
  }
  const observedAt = canonicalText(input.observedAt, 'active-work observation observedAt');
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error('active-work observation observedAt must be one ISO timestamp.');
  }
  if (input.state !== 'active' && input.state !== 'none'
      && input.state !== 'invalid' && input.state !== 'unresolved') {
    throw new Error('active-work observation state is invalid.');
  }
  if (input.state === 'active') {
    if (input.defaultSha === null || input.branch === null
        || input.manifest === null || input.reason !== null) {
      throw new Error('active-work observation active shape is invalid.');
    }
    assertGitBranchName(input.branch, 'active-work observation candidate branch');
    if (input.branch === defaultBranch) {
      throw new Error('active-work observation candidate branch cannot be the default branch.');
    }
    canonicalText(input.manifest, 'active-work observation manifest');
  } else {
    if (input.branch !== null || input.manifest !== null || input.reason === null) {
      throw new Error('active-work observation terminal shape is invalid.');
    }
    canonicalText(input.reason, 'active-work observation reason');
    if ((input.state === 'none' || input.state === 'invalid') && input.defaultSha === null) {
      throw new Error(`${input.state} active-work observation requires one exact default SHA.`);
    }
  }
  const observation = Object.freeze({ ...input }) as ActiveWorkPackageOwnerObservation;
  issuedActiveWorkPackageOwnerObservations.add(observation);
  return observation;
}

export function requireActiveWorkPackageOwnerObservation(
  observation: ActiveWorkPackageOwnerObservation
): ActiveWorkPackageOwnerObservation {
  if (!issuedActiveWorkPackageOwnerObservations.has(observation)) {
    throw new Error('active-work-owner-observation-not-issued');
  }
  return observation;
}
