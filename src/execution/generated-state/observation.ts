import path from 'node:path';
import { deepFreeze } from '../../contracts/canonical.ts';
import { generatedStateDigest, normalizeGeneratedStateRelativePath, type GeneratedStatePhysicalIdentity } from './contract.ts';
import type {
  GeneratedStateProducerBindingExpectation, GeneratedStateRetirementObservation,
  GeneratedStateRetirementObservationStatus
} from './lifecycle-port.ts';
import type { GeneratedStateRegistrationObservation } from './registration-contract.ts';

export interface GeneratedStateNativeObservationEvidence { readonly kind: 'generated-state-native-observation-evidence'; }
export interface GeneratedStateObservationScope {
  readonly repositoryRoot: string; readonly workspaceRoot: string; readonly relativePath: string;
  readonly ruleId: string; readonly expected?: GeneratedStateProducerBindingExpectation;
}
export interface GeneratedStateObservationFacts {
  readonly ledger: GeneratedStateRegistrationObservation;
  readonly physical: Readonly<{ kind: 'directory' | 'file' | 'link' | 'missing'; identity: GeneratedStatePhysicalIdentity | null }>;
}
const issued = new WeakMap<object, Readonly<{ nativeEvidence: GeneratedStateNativeObservationEvidence;
  scope: GeneratedStateObservationScope; observation: GeneratedStateRetirementObservation }>>();
function sameIdentity(left: GeneratedStatePhysicalIdentity, right: GeneratedStatePhysicalIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}
/** One domain calculation for both issuance and independently verified facts. */
function retirementObservation(scope: GeneratedStateObservationScope, facts: GeneratedStateObservationFacts): GeneratedStateRetirementObservation {
  const relativePath = normalizeGeneratedStateRelativePath(scope.relativePath);
  const { ledger, physical } = facts;
  const registration = ledger.registration ?? ledger.retiredPredecessor;
  let status: GeneratedStateRetirementObservationStatus = physical.kind === 'missing' ? 'absent' : 'mismatch';
  if (registration !== null) {
    const expected = scope.expected;
    const exact = path.resolve(registration.repositoryRoot) === path.resolve(scope.repositoryRoot) &&
      registration.relativePath === relativePath && registration.ruleId === scope.ruleId &&
      (expected?.owner === undefined || expected.owner === registration.owner) &&
      (expected?.producer === undefined || expected.producer === registration.producer) &&
      (expected?.ruleId === undefined || expected.ruleId === registration.ruleId) &&
      (expected?.physical === undefined || sameIdentity(expected.physical, registration.root));
    status = ledger.registration !== null
      ? !exact || physical.identity === null || !sameIdentity(physical.identity, registration.root)
        ? 'mismatch' : registration.phase === 'active' ? 'active' : 'retired-present'
      : exact && physical.kind === 'missing' ? 'retired-domain-settled' : 'mismatch';
  }
  const material = deepFreeze(structuredClone({ schema: 'sec-generated-state-retirement-observation-v1' as const,
    status, relativePath, registrationDigest: registration?.registrationDigest ?? null,
    physical: physical.identity ?? registration?.root ?? null }));
  return Object.freeze({ ...material, observationDigest: generatedStateDigest(material) });
}
export function issueGeneratedStateRetirementObservation(scope: GeneratedStateObservationScope,
  facts: GeneratedStateObservationFacts, nativeEvidence: GeneratedStateNativeObservationEvidence): GeneratedStateRetirementObservation {
  const retainedScope = deepFreeze(structuredClone(scope));
  const observation = retirementObservation(retainedScope, facts);
  issued.set(observation, Object.freeze({ nativeEvidence, scope: retainedScope, observation }));
  return observation;
}
export function inspectIssuedGeneratedStateObservation(observation: GeneratedStateRetirementObservation) {
  const original = issued.get(observation);
  if (original === undefined) throw new Error('Generated-state retirement observation was not issued by its owner.');
  return original;
}
export function assertIssuedObservationMatchesFacts(observation: GeneratedStateRetirementObservation,
  facts: GeneratedStateObservationFacts): void {
  const original = inspectIssuedGeneratedStateObservation(observation);
  const currentMaterial = { schema: observation.schema, status: observation.status,
    relativePath: observation.relativePath, registrationDigest: observation.registrationDigest,
    physical: observation.physical };
  if (generatedStateDigest(currentMaterial) !== original.observation.observationDigest ||
      observation.observationDigest !== original.observation.observationDigest ||
      retirementObservation(original.scope, facts).observationDigest !== original.observation.observationDigest) throw new Error(
    'Generated-state retirement observation differs from verified native facts.');
}
