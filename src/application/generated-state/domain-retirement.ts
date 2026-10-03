import path from 'node:path';
import {
  generatedStateDigest,
  generatedStateDomainProviderMaterialDigest,
  generatedStateRuleForPath,
  normalizeGeneratedStateRelativePath,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateRegistration
} from '../../execution/generated-state/contract.ts';
import type { GeneratedStateProducerBindingExpectation, GeneratedStateWorktreeRetirementProvider } from '../../execution/generated-state/lifecycle-port.ts';
import { executeGeneratedStateProviderEffect } from '../../execution/generated-state/provider-effect.ts';
import { issueGeneratedStatePublication } from '../../execution/generated-state/registration-session.ts';
import { withGeneratedStateOperation } from '../../execution/generated-state/tree-effect.ts';
import type { GeneratedStateCleanupDependencies } from './cleanup.ts';
import { inspectGeneratedState } from './inventory.ts';
import { withMigratedGeneratedStateMutation } from './registration.ts';

function sameIdentity(left: GeneratedStatePhysicalIdentity, right: GeneratedStatePhysicalIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

export async function settleRetiredGeneratedStateDomain(input: Readonly<{
  repositoryRoot: string; workspaceRoot: string; relativePath: string; expected?: GeneratedStateProducerBindingExpectation;
}>, dependencies: GeneratedStateCleanupDependencies & Readonly<{ providers: readonly GeneratedStateWorktreeRetirementProvider[] }>): Promise<boolean> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = generatedStateRuleForPath(relativePath);
  if (rule === null) throw new Error('Domain retirement has no current owner rule.');
  const mutation = <Value>(use: Parameters<typeof withMigratedGeneratedStateMutation<Value>>[0]['use']) =>
    withMigratedGeneratedStateMutation({ workspaceRoot, environment: dependencies.environment, backend: dependencies.mutation, use });
  return withGeneratedStateOperation({ workspaceRoot, backend: dependencies.effects, use: async operation => {
    const initial = await mutation(async (_session, resource) => dependencies.mutation.readRegistrationCensus(resource).observations.get(relativePath));
    const registration = initial?.registration;
    if (registration === undefined || registration === null) return initial?.retiredPredecessor !== null &&
      initial?.retiredPredecessor !== undefined && dependencies.physical.observeRoot(relativePath).kind === 'missing';
    if (registration.phase !== 'retired') return false;
    const expected = input.expected;
    if (path.resolve(registration.repositoryRoot) !== repositoryRoot || registration.relativePath !== relativePath ||
        registration.ruleId !== rule.id || (expected?.owner !== undefined && expected.owner !== registration.owner) ||
        (expected?.producer !== undefined && expected.producer !== registration.producer) ||
        (expected?.ruleId !== undefined && expected.ruleId !== registration.ruleId) ||
        (expected?.physical !== undefined && !sameIdentity(expected.physical, registration.root))) throw new Error('Retired domain registration is foreign.');
    const observed = dependencies.physical.observeRoot(relativePath);
    let intent = await mutation(async (_session, resource) => dependencies.journals.readCleanupIntent(resource, relativePath));
    if (observed.kind !== 'missing') {
      if (observed.identity === null || !sameIdentity(observed.identity, registration.root)) throw new Error('Retired domain physical preimage changed.');
      const form = rule.physicalForms.find(candidate => candidate.kind === observed.kind);
      if (form?.worktreeRetirement.mode !== 'domain-retire') return false;
      const providers = dependencies.providers.filter(provider => provider.id === form.worktreeRetirement.providerId);
      if (providers.length !== 1) throw new Error('Retired domain provider is unavailable or ambiguous.');
      const provider = providers[0]!;
      const plan = await provider.plan({ repositoryRoot, workspaceRoot, relativePath, source: observed.identity, registration });
      if (plan.digest !== generatedStateDomainProviderMaterialDigest(provider.id, 'plan', plan.bytes)) throw new Error('Retired domain provider plan digest differs.');
      if (intent === null) {
        const inventory = await inspectGeneratedState({ repositoryRoot, workspaceRoot, relativePaths: [relativePath] }, dependencies);
        const profile = rule.cleanupProfiles[0];
        if (profile === undefined) throw new Error('Retired domain has no owner cleanup profile.');
        const material = Object.freeze({ schema: 'sec-generated-state-cleanup-intent-v2' as const,
          beforeInventoryDigest: inventory.inventoryDigest, profile, registrationDigest: registration.registrationDigest,
          relativePath, root: registration.root, tombstoneName: `q-${registration.registrationDigest.slice(7, 55)}` });
        const candidate = Object.freeze({ ...material, intentDigest: generatedStateDigest(material) });
        intent = await mutation(async (session, resource) => dependencies.journals.publishCleanupIntent(resource,
          issueGeneratedStatePublication(session, { kind: 'cleanup-intent', intent: candidate })));
      }
      if (intent.registrationDigest !== registration.registrationDigest || !sameIdentity(intent.root, registration.root)) throw new Error('Retired domain intent is stale.');
      await executeGeneratedStateProviderEffect(operation, provider, Object.freeze({
        operationId: generatedStateDigest({ schema: 'sec-generated-state-domain-disposal-operation-v1',
          registrationDigest: registration.registrationDigest, ledgerRecordDigest: initial?.tip?.recordDigest, planDigest: plan.digest }),
        repositoryRoot, workspaceRoot, relativePath, source: observed.identity, registration, planBytes: plan.bytes, planDigest: plan.digest }));
    }
    if (dependencies.physical.observeRoot(relativePath).kind !== 'missing') throw new Error('Retired domain provider left the source present.');
    await mutation(async (session, resource) => {
      const terminal = dependencies.mutation.readRegistrationCensus(resource).observations.get(relativePath);
      if (terminal?.registration?.registrationDigest !== registration.registrationDigest || terminal.tip === null) throw new Error('Retired domain terminal predecessor changed.');
      dependencies.mutation.publishRegistration(resource, issueGeneratedStatePublication(session, { kind: 'registration',
        registration: registration as GeneratedStateRegistration, previousRecordDigest: terminal.tip.recordDigest, event: 'disposed' }));
      if (intent !== null) dependencies.journals.completeCleanupIntent(resource, issueGeneratedStatePublication(session,
        { kind: 'cleanup-complete', relativePath, intentDigest: intent.intentDigest, registrationDigest: registration.registrationDigest }));
      const readback = dependencies.mutation.readRegistrationCensus(resource).observations.get(relativePath);
      if (readback?.registration !== null || readback.retiredPredecessor?.registrationDigest !== registration.registrationDigest) throw new Error('Retired domain disposed readback differs.');
    });
    return true;
  } });
}
