import type {
  PhysicalGenerationRetirementReceipt,
  RetainedNoFollowCapabilityRole,
  RetainedNoFollowProvenDirectoryGeneration,
  RetainedNoFollowSealedDirectoryGeneration
} from './physical-no-follow-contract.ts';
import { physicalError } from './physical-no-follow-shared.ts';

/** Process-local capability issuance authority. Structural values alone never grant Effect authority. */
const retainedNoFollowCapabilityRoles = new WeakMap<object, RetainedNoFollowCapabilityRole>();

export function issueRetainedNoFollowCapability<T extends object>(
  capability: T,
  role: RetainedNoFollowCapabilityRole
): T {
  retainedNoFollowCapabilityRoles.set(capability, role);
  return capability;
}

/**
 * Runtime admission for the process owner.  The structural child-process
 * view deliberately does not carry authority by itself; only an object
 * issued by this physical owner, with the requested role, is admissible.
 * Callers cannot manufacture a valid entry in the private WeakMap.
 */
export function assertRetainedNoFollowCapability(
  capability: unknown,
  role: RetainedNoFollowCapabilityRole,
  label = 'retained no-follow capability'
): void {
  if (capability === null || typeof capability !== 'object'
      || retainedNoFollowCapabilityRoles.get(capability) !== role) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} was not issued by the physical no-follow owner for role ${role}.`
    );
  }
}
const issuedRetainedNoFollowSealedDirectoryGenerations = new WeakSet<object>();
const issuedRetainedNoFollowProvenDirectoryGenerations = new WeakSet<object>();
const issuedPhysicalGenerationRetirementReceipts = new WeakSet<object>();

export function assertPhysicalGenerationRetirementReceipt(
  receipt: PhysicalGenerationRetirementReceipt
): void {
  if (!issuedPhysicalGenerationRetirementReceipts.has(receipt)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Physical generation retirement receipt was not issued by Runtime Physical.'
    );
  }
}

export function assertRetainedNoFollowSealedDirectoryGeneration(
  capability: RetainedNoFollowSealedDirectoryGeneration,
  label = 'sealed directory generation'
): void {
  assertRetainedNoFollowCapability(capability, 'working-directory', label);
  if (!issuedRetainedNoFollowSealedDirectoryGenerations.has(capability)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} was not issued by the physical sealed-generation owner.`
    );
  }
}

export function assertRetainedNoFollowProvenDirectoryGeneration(
  capability: RetainedNoFollowProvenDirectoryGeneration,
  label = 'proven directory generation'
): void {
  assertRetainedNoFollowCapability(capability, 'working-directory', label);
  if (!issuedRetainedNoFollowProvenDirectoryGenerations.has(capability)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} was not issued by the physical proven-generation owner.`
    );
  }
}

export function assertRetainedNoFollowReadOnlyDirectoryGeneration(
  capability: RetainedNoFollowSealedDirectoryGeneration | RetainedNoFollowProvenDirectoryGeneration,
  label = 'read-only directory generation'
): void {
  assertRetainedNoFollowCapability(capability, 'working-directory', label);
  if (!issuedRetainedNoFollowSealedDirectoryGenerations.has(capability)
      && !issuedRetainedNoFollowProvenDirectoryGenerations.has(capability)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} was not issued by a physical read-only generation owner.`
    );
  }
}


export function registerRetainedNoFollowSealedDirectoryGeneration(
  capability: RetainedNoFollowSealedDirectoryGeneration
): void {
  issuedRetainedNoFollowSealedDirectoryGenerations.add(capability);
}

export function registerRetainedNoFollowProvenDirectoryGeneration(
  capability: RetainedNoFollowProvenDirectoryGeneration
): void {
  issuedRetainedNoFollowProvenDirectoryGenerations.add(capability);
}

export function registerPhysicalGenerationRetirementReceipt(
  receipt: PhysicalGenerationRetirementReceipt
): void {
  issuedPhysicalGenerationRetirementReceipts.add(receipt);
}
