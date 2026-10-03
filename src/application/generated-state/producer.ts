import path from 'node:path';
import {
  createGeneratedStateRegistration, generatedStateDigest,
  generatedStateLegacyRetirementRuleForPath,
  generatedStateRuleForPath,
  normalizeGeneratedStateRelativePath,
  retireGeneratedStateRegistration, type GeneratedStatePhysicalIdentity, type GeneratedStateRegistration,
  type GeneratedStateRule
} from '../../execution/generated-state/contract.ts';
import { GeneratedStateProducerBindingBlockedError } from '../../execution/generated-state/errors.ts';
import type {
  GeneratedStateAbsentRegistrationExpectation,
  GeneratedStateAbsentRegistrationSettlementReceipt,
  GeneratedStateProducerBindingExpectation
} from '../../execution/generated-state/lifecycle-port.ts';
import type { GeneratedStateRegistrationMutationBackend, GeneratedStateRegistrationObservation, GeneratedStateRegistrationObservationBackend } from '../../execution/generated-state/registration-port.ts';
import { issueGeneratedStatePublication } from '../../execution/generated-state/registration-session.ts';
import { withMigratedGeneratedStateMutation } from './registration.ts';

function sameIdentity(left: GeneratedStatePhysicalIdentity, right: GeneratedStatePhysicalIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function producerRule(relativePath: string, expected?: GeneratedStateProducerBindingExpectation): GeneratedStateRule {
  const current = generatedStateRuleForPath(relativePath);
  const legacy = generatedStateLegacyRetirementRuleForPath(relativePath);
  const rule = expected?.ruleId !== undefined && legacy?.id === expected.ruleId ? legacy : current;
  if (rule === null || rule.registration !== 'required-at-birth') throw new GeneratedStateProducerBindingBlockedError(
    `Generated-state producer path is not registered by active policy: ${relativePath}.`);
  if ((expected?.owner !== undefined && expected.owner !== rule.owner) ||
      (expected?.producer !== undefined && expected.producer !== rule.producer) ||
      (expected?.ruleId !== undefined && expected.ruleId !== rule.id)) throw new GeneratedStateProducerBindingBlockedError(
    `Generated-state producer binding owner, producer or rule differs from the registry: ${relativePath}.`);
  return rule;
}

export function createGeneratedStateProducerRegistration(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  environment?: NodeJS.ProcessEnv;
  clock?: () => Date;
  backend: GeneratedStateRegistrationMutationBackend;
  observations: GeneratedStateRegistrationObservationBackend;
}>) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const backend = input.backend;
  const bindings = new Map<string, GeneratedStateRegistration>();
  const mutation = <Value>(use: Parameters<typeof withMigratedGeneratedStateMutation<Value>>[0]['use']) =>
    withMigratedGeneratedStateMutation({ workspaceRoot, environment: input.environment, backend, use });
  const observation = (census: ReturnType<typeof backend.readRegistrationCensus>, relativePath: string): GeneratedStateRegistrationObservation =>
    census.observations.get(relativePath) ?? { tip: null, registration: null, retiredPredecessor: null, previousRegistration: null };

  const bind = async (value: string, expected?: GeneratedStateProducerBindingExpectation): Promise<GeneratedStateRegistration> => {
    const relativePath = normalizeGeneratedStateRelativePath(value);
    const rule = producerRule(relativePath, expected);
    const observationResource = input.observations.openObservation({ workspaceRoot, environment: input.environment });
    if (observationResource === null || input.observations.readRegistrationCensus(observationResource).observations.get(relativePath)?.registration?.phase !== 'active') {
      throw new GeneratedStateProducerBindingBlockedError(`Generated-state producer binding requires an active registration: ${relativePath}.`);
    }
    const registration = await mutation(async (_session, resource) => {
      const workspace = backend.observeWorkspace(resource);
      const observed = backend.observeRoot(resource, relativePath);
      if (observed.identity === null || !rule.physicalForms.some(form => form.kind === observed.kind) ||
          (expected?.physical !== undefined && !sameIdentity(expected.physical, observed.identity))) throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state producer binding found no matching supported physical root: ${relativePath}.`);
      const before = observation(backend.readRegistrationCensus(resource), relativePath);
      const current = before.registration;
      if (current === null || current.phase !== 'active') throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state producer binding requires an active registration: ${relativePath}.`);
      if (path.resolve(current.repositoryRoot) !== repositoryRoot || current.relativePath !== relativePath ||
          current.ruleId !== rule.id || current.owner !== rule.owner || current.producer !== rule.producer ||
          !sameIdentity(current.workspace, workspace) || !sameIdentity(current.root, observed.identity)) throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state producer binding registration is foreign or physically stale: ${relativePath}.`);
      const readback = observation(backend.readRegistrationCensus(resource), relativePath);
      if (readback.tip?.recordDigest !== before.tip?.recordDigest ||
          readback.registration?.registrationDigest !== current.registrationDigest) throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state producer binding ledger tip changed during physical admission: ${relativePath}.`);
      return current;
    });
    bindings.set(relativePath, registration); return registration;
  };
  return Object.freeze({
    bind,
    settleAbsent: async (value: string, expected: GeneratedStateAbsentRegistrationExpectation,
      outcome: string): Promise<GeneratedStateAbsentRegistrationSettlementReceipt> => {
      const relativePath = normalizeGeneratedStateRelativePath(value);
      const rule = producerRule(relativePath, expected);
      const trimmed = outcome.trim();
      if (trimmed.length === 0) throw new GeneratedStateProducerBindingBlockedError('Generated-state absent registration settlement outcome is empty.');
      return mutation(async (session, resource) => {
        const physical = backend.observeRoot(resource, relativePath);
        const before = observation(backend.readRegistrationCensus(resource), relativePath);
        const registration = before.registration;
        if (physical.kind !== 'missing' || physical.identity !== null || registration === null ||
            registration.phase !== 'active' || before.tip === null ||
            path.resolve(registration.repositoryRoot) !== repositoryRoot || registration.relativePath !== relativePath ||
            registration.ruleId !== rule.id || registration.owner !== expected.owner || registration.producer !== expected.producer ||
            !sameIdentity(registration.workspace, backend.observeWorkspace(resource)) || !sameIdentity(registration.root, expected.physical)) {
          throw new GeneratedStateProducerBindingBlockedError(`Generated-state absent registration settlement preimage is present, missing, foreign or stale: ${relativePath}.`);
        }
        const retirementRef = generatedStateDigest({ schema: 'sec-generated-state-owner-retirement-v1',
          registrationId: registration.registrationId, registrationDigest: registration.registrationDigest,
          relativePath, owner: registration.owner, producer: registration.producer, operationId: registration.operationId, outcome: trimmed });
        const retired = retireGeneratedStateRegistration(registration, retirementRef, { clock: input.clock });
        backend.publishRegistration(resource, issueGeneratedStatePublication(session, { kind: 'registration', registration: retired,
          previousRecordDigest: before.tip.recordDigest, event: 'registered', admission: 'absent-retirement' }));
        const retiredObservation = observation(backend.readRegistrationCensus(resource), relativePath);
        if (retiredObservation.registration?.registrationDigest !== retired.registrationDigest || retiredObservation.tip === null) {
          throw new GeneratedStateProducerBindingBlockedError('Generated-state absent registration retirement readback differs.');
        }
        backend.publishRegistration(resource, issueGeneratedStatePublication(session, { kind: 'registration', registration: retired,
          previousRecordDigest: retiredObservation.tip.recordDigest, event: 'disposed' }));
        const terminal = observation(backend.readRegistrationCensus(resource), relativePath);
        if (terminal.registration !== null || terminal.retiredPredecessor?.registrationDigest !== retired.registrationDigest ||
            terminal.retiredPredecessor.retirementRef !== retirementRef || backend.observeRoot(resource, relativePath).kind !== 'missing') {
          throw new GeneratedStateProducerBindingBlockedError('Generated-state absent registration terminal readback differs.');
        }
        const material = Object.freeze({ schema: 'sec-generated-state-absent-registration-settlement-v1' as const,
          relativePath, registrationDigest: registration.registrationDigest, retirementRef, physical: registration.root,
          outcome: trimmed, terminal: 'disposed' as const });
        return Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
      });
    },
    born: async (value: string, operationId: string): Promise<void> => {
      const relativePath = normalizeGeneratedStateRelativePath(value);
      const rule = producerRule(relativePath);
      const registration = await mutation(async (session, resource) => {
        const observed = backend.observeRoot(resource, relativePath);
        if (observed.identity === null || !rule.physicalForms.some(form => form.kind === observed.kind)) throw new Error(
          'Generated-state birth requires one registered physical form with exact identity.');
        const current = observation(backend.readRegistrationCensus(resource), relativePath);
        if (current.registration !== null) throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state birth cannot adopt or replace an existing physical registration; use bind: ${relativePath}.`);
        if (current.retiredPredecessor !== null && sameIdentity(current.retiredPredecessor.root, observed.identity)) throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state birth cannot re-sign the disposed predecessor physical identity: ${relativePath}.`);
        const value = createGeneratedStateRegistration({ repositoryRoot, workspace: backend.observeWorkspace(resource),
          rule, relativePath, root: observed.identity, operationId }, { clock: input.clock });
        backend.publishRegistration(resource, issueGeneratedStatePublication(session, { kind: 'registration',
          registration: value, previousRecordDigest: current.tip?.recordDigest ?? null, event: 'registered' }));
        return value;
      });
      bindings.set(relativePath, registration);
    },
    retired: async (value: string, outcome: string): Promise<GeneratedStateRegistration> => {
      const relativePath = normalizeGeneratedStateRelativePath(value);
      const expected = bindings.get(relativePath);
      if (expected === undefined) throw new GeneratedStateProducerBindingBlockedError('Generated-state retirement requires birth or bind in the same producer session.');
      const retired = await mutation(async (session, resource) => {
        const before = observation(backend.readRegistrationCensus(resource), relativePath);
        const current = before.registration;
        if (current === null || current.registrationDigest !== expected.registrationDigest || before.tip === null) throw new GeneratedStateProducerBindingBlockedError(
          'Generated-state retirement is not bound to the producer session registration.');
        const trimmed = outcome.trim(); if (trimmed.length === 0) throw new Error('Generated-state retirement outcome is empty.');
        const ref = generatedStateDigest({ schema: 'sec-generated-state-owner-retirement-v1', registrationId: current.registrationId,
          registrationDigest: current.registrationDigest, relativePath, owner: current.owner, producer: current.producer,
          operationId: current.operationId, outcome: trimmed });
        if (current.phase === 'retired') {
          if (current.retirementRef === ref) return current;
          throw new Error('Generated-state registration was retired by a different authority.');
        }
        const value = retireGeneratedStateRegistration(current, ref, { clock: input.clock });
        backend.publishRegistration(resource, issueGeneratedStatePublication(session, { kind: 'registration', registration: value,
          previousRecordDigest: before.tip.recordDigest, event: 'registered' }));
        return value;
      });
      bindings.set(relativePath, retired); return retired;
    },
    restore: async (value: string, expectedRegistrationDigest: `sha256:${string}`, expectedPhysical: GeneratedStatePhysicalIdentity,
      outcome: string): Promise<GeneratedStateRegistration> => {
      const relativePath = normalizeGeneratedStateRelativePath(value); const rule = producerRule(relativePath);
      const restored = await mutation(async (session, resource) => {
        const before = observation(backend.readRegistrationCensus(resource), relativePath); const current = before.registration;
        if (current === null || current.phase !== 'retired' || current.registrationDigest !== expectedRegistrationDigest || before.tip === null) {
          throw new GeneratedStateProducerBindingBlockedError(`Generated-state restore predecessor is missing, active, foreign, or stale: ${relativePath}.`);
        }
        const observed = backend.observeRoot(resource, relativePath);
        if (observed.identity === null || !sameIdentity(observed.identity, expectedPhysical) || !sameIdentity(observed.identity, current.root) ||
            !rule.physicalForms.some(form => form.kind === observed.kind)) throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state restore physical preimage differs from its retired predecessor: ${relativePath}.`);
        const trimmed = outcome.trim(); if (trimmed.length === 0) throw new GeneratedStateProducerBindingBlockedError('Generated-state restore outcome is empty.');
        const operationId = generatedStateDigest({ schema: 'sec-generated-state-restore-v1', predecessorRegistrationDigest: current.registrationDigest,
          predecessorRetirementRef: current.retirementRef, relativePath, physical: expectedPhysical, outcome: trimmed });
        const value = createGeneratedStateRegistration({ repositoryRoot, workspace: backend.observeWorkspace(resource), rule,
          relativePath, root: observed.identity, operationId: `restore:${operationId}` }, { clock: input.clock });
        backend.publishRegistration(resource, issueGeneratedStatePublication(session, { kind: 'registration', registration: value,
          previousRecordDigest: before.tip.recordDigest, event: 'registered' }));
        return value;
      });
      bindings.set(relativePath, restored); return restored;
    }
  });
}
