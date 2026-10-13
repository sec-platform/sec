import {
  generatedStateDigest, parseGeneratedStateRegistration,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateRegistration
} from './contract.ts';
import { GeneratedStateProducerBindingBlockedError } from './errors.ts';
import type {
  GeneratedStatePublicationRequest, GeneratedStateRegistrationObservation,
  GeneratedStateRegistrationResponsibilities
} from './registration-port.ts';

/** The issuer and native publisher consume this same graph with their own facts. */
export function assertGeneratedStateRegistrationTransitionAdmission(
  request: Extract<GeneratedStatePublicationRequest, { kind: 'registration' }>,
  current: GeneratedStateRegistrationObservation | undefined,
  workspace: GeneratedStatePhysicalIdentity,
  physical: Readonly<{ kind: 'directory' | 'file' | 'link' | 'missing'; identity: GeneratedStatePhysicalIdentity | null }>
): void {
  const registration = parseGeneratedStateRegistration(request.registration);
  const same = (a: GeneratedStatePhysicalIdentity, b: GeneratedStatePhysicalIdentity) =>
    a.device === b.device && a.inode === b.inode && a.objectId === b.objectId;
  if ((current?.tip?.recordDigest ?? null) !== request.previousRecordDigest || !same(registration.workspace, workspace)) {
    throw new GeneratedStateProducerBindingBlockedError('Registration publication admission predecessor or workspace is stale.');
  }
  if (request.event === 'disposed') {
    if (physical.kind !== 'missing' || registration.phase !== 'retired' ||
        current?.registration?.registrationDigest !== registration.registrationDigest) {
      throw new GeneratedStateProducerBindingBlockedError('Disposal cannot be published before exact source physical absence readback.');
    }
    return;
  }
  const absentRetirement = request.admission === 'absent-retirement' && physical.kind === 'missing' &&
    current?.registration?.phase === 'active' && registration.phase === 'retired' &&
    same(current.registration.root, registration.root);
  if (!absentRetirement && (physical.identity === null || !same(physical.identity, registration.root))) throw new GeneratedStateProducerBindingBlockedError(
    'Registration publication admission has no matching physical root.');
  if (current?.registration === null || current === undefined) {
    if (registration.phase !== 'active' || (current?.retiredPredecessor !== null &&
        current?.retiredPredecessor !== undefined && same(current.retiredPredecessor.root, registration.root))) {
      throw new GeneratedStateProducerBindingBlockedError('Registration birth cannot adopt the disposed predecessor physical identity.');
    }
  } else {
    const predecessor = current.registration;
    if (!same(predecessor.root, registration.root) || predecessor.ruleId !== registration.ruleId ||
        predecessor.owner !== registration.owner || predecessor.producer !== registration.producer ||
        !((predecessor.phase === 'active' && registration.phase === 'retired' &&
           predecessor.registrationId === registration.registrationId && predecessor.operationId === registration.operationId) ||
          (predecessor.phase === 'retired' && registration.phase === 'active' && registration.operationId.startsWith('restore:sha256:')))) {
      throw new GeneratedStateProducerBindingBlockedError('Registration transition is outside the admitted predecessor lifecycle.');
    }
  }
}

export function generatedStateOwnerRetirementRef(registration: GeneratedStateRegistration, outcome: string): `sha256:${string}` {
  return generatedStateDigest({ schema: 'sec-generated-state-owner-retirement-v1', registrationId: registration.registrationId,
    registrationDigest: registration.registrationDigest, relativePath: registration.relativePath, owner: registration.owner,
    producer: registration.producer, operationId: registration.operationId, outcome });
}

/** Durable in-flight responsibilities fence later producers across the short
 * coordination lease. The intent is evidence of responsibility, never a
 * permission to delete or to reactivate its exact physical source. */
export function assertGeneratedStateRegistrationResponsibilityAdmission(
  request: Extract<GeneratedStatePublicationRequest, { kind: 'registration' }>,
  observation: GeneratedStateRegistrationObservation | undefined,
  responsibility: GeneratedStateRegistrationResponsibilities
): void {
  const registration = request.registration;
  const cleanup = responsibility.cleanupIntent;
  if (cleanup !== null && !(request.event === 'disposed' && registration.phase === 'retired' &&
      responsibility.cleanupTombstoneState === 'absent' &&
      registration.registrationDigest === cleanup.registrationDigest &&
      observation?.registration?.registrationDigest === cleanup.registrationDigest)) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration conflicts with an active cleanup responsibility.');
  }
  const worktree = responsibility.worktreeIntent;
  if (worktree === null) return;
  const entry = worktree.entries.find(entry => entry.action === 'domain-retire' && entry.relativePath === registration.relativePath);
  if (entry?.action !== 'domain-retire') throw new GeneratedStateProducerBindingBlockedError(
    'Generated-state registration conflicts with an active worktree retirement responsibility.');
  const planned = entry.registration;
  const ref = planned.phase === 'active' ? generatedStateOwnerRetirementRef(planned, `worktree-retirement:${worktree.operationId}`) : planned.retirementRef;
  if (registration.phase !== 'retired' || registration.retirementRef !== ref ||
      registration.root.objectId !== entry.source.objectId || registration.root.device !== entry.source.device ||
      registration.root.inode !== entry.source.inode ||
      !((request.event === 'registered' && planned.phase === 'active' &&
          observation?.registration?.registrationDigest === planned.registrationDigest) ||
        (request.event === 'disposed' && observation?.registration?.registrationDigest === registration.registrationDigest))) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration cannot replace a source owned by worktree retirement.');
  }
}
