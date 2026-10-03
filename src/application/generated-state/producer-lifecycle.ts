import { assertGeneratedStateCleanupOperation, generatedStateCleanupOperationState } from '../../execution/generated-state/cleanup-budget.ts';
import type { GeneratedStateProducerHookSet, GeneratedStateProducerQuarantineHook, GeneratedStateWorktreeRetirementProvider } from '../../execution/generated-state/lifecycle-port.ts';
import type { GeneratedStateCleanupDependencies } from './cleanup.ts';
import { continueGeneratedStateCleanup } from './continuation.ts';
import { disposeGeneratedStateRegistration, prepareGeneratedStateDisposal } from './disposal.ts';
import { settleRetiredGeneratedStateDomain } from './domain-retirement.ts';
import { inspectGeneratedState } from './inventory.ts';
import { createGeneratedStateProducerRegistration } from './producer.ts';
import { observeGeneratedStateRetirement } from './retirement-observation.ts';

export function createGeneratedStateProducerLifecycle(scope: Readonly<{ repositoryRoot: string; workspaceRoot: string }>,
  owned: GeneratedStateCleanupDependencies & Readonly<{ providers: readonly GeneratedStateWorktreeRetirementProvider[] }>):
  Readonly<GeneratedStateProducerHookSet & Partial<GeneratedStateProducerQuarantineHook>> {
  const producer = createGeneratedStateProducerRegistration({ ...scope, environment: owned.environment,
    clock: owned.clock, backend: owned.mutation, observations: owned.registrations });
  const bindings = new Map<string, `sha256:${string}`>();
  const retire = async (relativePath: string, outcome: string) => {
    const registration = await producer.retired(relativePath, outcome); bindings.set(registration.relativePath, registration.registrationDigest); return registration;
  };
  const settleRetired: GeneratedStateProducerHookSet['settleRetired'] = (relativePath, expected) =>
    settleRetiredGeneratedStateDomain({ ...scope, relativePath, expected }, owned);
  const hooks: GeneratedStateProducerHookSet = Object.freeze({
    born: async (relativePath, operationId) => { await producer.born(relativePath, operationId);
      const registration = await producer.bind(relativePath); bindings.set(registration.relativePath, registration.registrationDigest); },
    bind: async (relativePath, expected) => { const registration = await producer.bind(relativePath, expected);
      bindings.set(registration.relativePath, registration.registrationDigest); return registration; },
    restore: async (relativePath, digest, physical, outcome) => { const registration = await producer.restore(relativePath, digest, physical, outcome);
      bindings.set(registration.relativePath, registration.registrationDigest); return registration; },
    retired: retire, settleAbsent: producer.settleAbsent, settleRetired,
    inspect: relativePaths => inspectGeneratedState({ ...scope, relativePaths }, owned),
    observeRetirement: (relativePath, expected) => observeGeneratedStateRetirement({ ...scope, relativePath, expected,
      environment: owned.environment }, owned.registrations),
    disposed: (relativePath, request) => disposeGeneratedStateRegistration({ ...scope, relativePath, ...request,
      expectedRegistrationDigest: bindings.get(relativePath) ?? null }, owned, retire, path => settleRetired(path))
  });
  if (owned.cleanupOperation === undefined) return hooks;
  const cleanupOperation = owned.cleanupOperation;
  return Object.freeze({ ...hooks, quarantine: async (relativePath, request) => {
    assertGeneratedStateCleanupOperation(generatedStateCleanupOperationState(cleanupOperation), 'Generated-state producer quarantine');
    await prepareGeneratedStateDisposal({ ...scope, relativePath, ...request, acceptExistingRetirement: true,
      expectedRegistrationDigest: bindings.get(relativePath) ?? null }, owned, retire);
    return continueGeneratedStateCleanup({ ...scope, profile: request.profile, relativePaths: [relativePath], operation: cleanupOperation }, owned);
  } });
}
