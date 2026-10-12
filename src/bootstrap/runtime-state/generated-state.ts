import type { WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { createGeneratedStateJournalMutationBackend } from '../../adapters/runtime-state/generated-state/journals.ts';
import { createGeneratedStateGitObservationBackend, createGeneratedStatePhysicalObservationBackend, createGeneratedStateTreeEffectBackend } from '../../adapters/runtime-state/generated-state/physical-effects.ts';
import { createGeneratedStateRegistrationMutationBackend, createGeneratedStateRegistrationObservationBackend } from '../../adapters/runtime-state/generated-state/registration-store.ts';
import { settleGeneratedState } from '../../application/generated-state/cleanup.ts';
import { continueGeneratedStateCleanup } from '../../application/generated-state/continuation.ts';
import { inspectGeneratedState, planGeneratedStateCleanup } from '../../application/generated-state/inventory.ts';
import { runGeneratedStateOperation } from '../../application/generated-state/operation.ts';
import { createGeneratedStateProducerLifecycle } from '../../application/generated-state/producer-lifecycle.ts';
import { createGeneratedStateProducerRegistration } from '../../application/generated-state/producer.ts';
import { ensureGeneratedStateRegistrationLedger } from '../../application/generated-state/registration.ts';
import { settleGeneratedStateForWorktreeRetirement } from '../../application/generated-state/worktree-retirement.ts';
import type { GeneratedStateCleanupOperationSession } from '../../execution/generated-state/cleanup-budget.ts';
import type { GeneratedStateWorktreeRetirementProvider } from '../../execution/generated-state/lifecycle-port.ts';
import type { GeneratedStateDomainOwnerOperation } from '../../execution/generated-state/operation-port.ts';
import { assertGeneratedStateWorktreeRetirementEffectStart } from '../../execution/generated-state/worktree-admission.ts';

/** Bootstrap selects the one native persistence backend for this composition.
 * Requests carry decisions; the backend and execution issuers stay here. */
export function createGeneratedStateRegistrationBootstrap(input: Readonly<{
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  reentrantToken?: WorkspaceWriteLeaseToken;
  cleanupOperation?: GeneratedStateCleanupOperationSession;
  worktreeRetirementProviders?: readonly GeneratedStateWorktreeRetirementProvider[];
  runGit?: import('../../adapters/runtime-state/generated-state/physical-effects.ts').GeneratedStateNativeGitObservationOptions['runGit'];
  afterWorktreeRetirementRelocation?: (relativePath: string) => void | Promise<void>;
  afterWorktreeRetirementProviderEffect?: (relativePath: string) => void | Promise<void>;
  beforeCleanupEffect?: (relativePath: string) => void | Promise<void>;
  afterQuarantineEffect?: (relativePath: string) => void | Promise<void>;
}>) {
  input = Object.freeze({ ...input, environment: Object.freeze({ ...(input.environment ?? process.env) }),
    worktreeRetirementProviders: Object.freeze([...(input.worktreeRetirementProviders ?? [])]) });
  const backend = createGeneratedStateRegistrationMutationBackend();
  const journals = createGeneratedStateJournalMutationBackend();
  const effects = createGeneratedStateTreeEffectBackend(input);
  const inventory = { physical: createGeneratedStatePhysicalObservationBackend(input.workspaceRoot),
    registrations: createGeneratedStateRegistrationObservationBackend(), environment: input.environment };
  const dependencies = (repositoryRoot: string) => ({ ...inventory, cleanupOperation: input.cleanupOperation,
    beforeCleanupEffect: input.beforeCleanupEffect, afterQuarantineEffect: input.afterQuarantineEffect,
    git: createGeneratedStateGitObservationBackend({ repositoryRoot, workspaceRoot: input.workspaceRoot, runGit: input.runGit }), mutation: backend, journals, effects });
  return Object.freeze({
    continueCleanup: (request: Parameters<typeof continueGeneratedStateCleanup>[0], hooks: Pick<Parameters<typeof settleGeneratedState>[1],
      'beforeCleanupEffect' | 'afterQuarantineEffect' | 'clock'> = {}) =>
      continueGeneratedStateCleanup(request, { ...dependencies(request.repositoryRoot), ...hooks }),
    runOperation: (parsed: Parameters<typeof runGeneratedStateOperation>[0], repositoryRoot: string,
      owners: readonly GeneratedStateDomainOwnerOperation[]) => runGeneratedStateOperation(parsed, repositoryRoot, owners, dependencies(repositoryRoot)),
    ensureLedger: () => ensureGeneratedStateRegistrationLedger({ ...input, backend }),
    createProducerRegistration: (repositoryRoot: string, clock?: () => Date) =>
      createGeneratedStateProducerRegistration({ ...input, repositoryRoot, clock, backend, observations: inventory.registrations }),
    createProducerHooks: (repositoryRoot: string, clock?: () => Date) => createGeneratedStateProducerLifecycle(
      { repositoryRoot, workspaceRoot: input.workspaceRoot }, { ...dependencies(repositoryRoot), clock,
        providers: input.worktreeRetirementProviders ?? [] }),
    settleForWorktreeRetirement: (request: Parameters<typeof settleGeneratedStateForWorktreeRetirement>[0]) =>
      settleGeneratedStateForWorktreeRetirement(request, { ...dependencies(request.repositoryRoot),
        providers: input.worktreeRetirementProviders ?? [], afterWorktreeRetirementRelocation: input.afterWorktreeRetirementRelocation,
        afterWorktreeRetirementProviderEffect: input.afterWorktreeRetirementProviderEffect }),
    assertWorktreeRetirementEffectStart: (request: Parameters<typeof assertGeneratedStateWorktreeRetirementEffectStart>[0]) =>
      assertGeneratedStateWorktreeRetirementEffectStart(request, inventory.physical),
    inspect: (repositoryRoot: string, relativePaths?: readonly string[]) => inspectGeneratedState({ repositoryRoot,
      workspaceRoot: input.workspaceRoot, relativePaths }, { ...inventory,
      git: createGeneratedStateGitObservationBackend({ repositoryRoot, workspaceRoot: input.workspaceRoot, runGit: input.runGit }) }),
    planCleanup: planGeneratedStateCleanup,
    settle: (request: Parameters<typeof settleGeneratedState>[0], hooks: Pick<Parameters<typeof settleGeneratedState>[1],
      'cleanupOperation' | 'beforeCleanupEffect' | 'afterQuarantineEffect' | 'clock'> = {}) =>
      settleGeneratedState({ ...request, workspaceRoot: input.workspaceRoot }, { ...inventory,
        cleanupOperation: input.cleanupOperation, beforeCleanupEffect: input.beforeCleanupEffect,
        afterQuarantineEffect: input.afterQuarantineEffect, ...hooks,
        git: createGeneratedStateGitObservationBackend({ repositoryRoot: request.repositoryRoot, workspaceRoot: input.workspaceRoot, runGit: input.runGit }),
        mutation: backend, journals, effects })
  });
}
