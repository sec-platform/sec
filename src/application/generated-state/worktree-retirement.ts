import path from 'node:path';
import { createGeneratedStateCleanupOperationSession, generatedStateCleanupOperationState } from '../../execution/generated-state/cleanup-budget.ts';
import {
  createGeneratedStateWorktreeRetirement,
  GENERATED_STATE_REGISTRY, generatedStateDigest, generatedStateDomainProviderMaterialDigest,
  normalizeGeneratedStateRelativePath, retireGeneratedStateRegistration,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateRegistration,
  type GeneratedStateRule,
  type GeneratedStateWorktreeRetirement
} from '../../execution/generated-state/contract.ts';
import { GeneratedStateWorktreeRetirementBlockedError } from '../../execution/generated-state/errors.ts';
import { createGeneratedStateWorktreeRetirementIntent, type GeneratedStateWorktreeRetirementIntent } from '../../execution/generated-state/journal-port.ts';
import type { GeneratedStateWorktreeRetirementProvider } from '../../execution/generated-state/lifecycle-port.ts';
import { executeGeneratedStateProviderEffect, issueGeneratedStateProviderSettlement } from '../../execution/generated-state/provider-effect.ts';
import { issueGeneratedStatePublication } from '../../execution/generated-state/registration-session.ts';
import { generatedStateOwnerRetirementRef } from '../../execution/generated-state/registration-transition.ts';
import { issueGeneratedStateTreeEffect, withGeneratedStateOperation } from '../../execution/generated-state/tree-effect.ts';
import { assertGeneratedStateWorktreeRetirementEffectStart, type GeneratedStateWorktreeRetirementInput } from '../../execution/generated-state/worktree-admission.ts';
import type { GeneratedStateCleanupDependencies } from './cleanup.ts';
import { withMigratedGeneratedStateMutation } from './registration.ts';

type Entry = GeneratedStateWorktreeRetirementIntent['entries'][number];
export interface GeneratedStateWorktreeRetirementDependencies extends GeneratedStateCleanupDependencies {
  readonly providers: readonly GeneratedStateWorktreeRetirementProvider[];
  readonly afterWorktreeRetirementRelocation?: (relativePath: string) => void | Promise<void>;
  readonly afterWorktreeRetirementProviderEffect?: (relativePath: string) => void | Promise<void>;
}
function same(left: GeneratedStatePhysicalIdentity, right: GeneratedStatePhysicalIdentity) {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}
function owners(relativePath: string): readonly GeneratedStateRule[] {
  return GENERATED_STATE_REGISTRY.rules.filter(({ selector }) => selector.kind === 'exact'
    ? relativePath === selector.path || relativePath.startsWith(`${selector.path}/`)
    : relativePath.startsWith(`${selector.parent}/`) && relativePath.slice(selector.parent.length + 1).split('/')[0]!.startsWith(selector.prefix));
}
function below(relativePath: string): readonly GeneratedStateRule[] {
  return GENERATED_STATE_REGISTRY.rules.filter(({ selector }) => {
    const anchor = selector.kind === 'exact' ? selector.path : selector.parent;
    return anchor === relativePath || anchor.startsWith(`${relativePath}/`);
  });
}

export async function settleGeneratedStateForWorktreeRetirement(input: GeneratedStateWorktreeRetirementInput,
  dependencies: GeneratedStateWorktreeRetirementDependencies): Promise<GeneratedStateWorktreeRetirement | null> {
  const repositoryRoot = path.resolve(input.repositoryRoot), workspaceRoot = path.resolve(input.workspaceRoot);
  const budget = generatedStateCleanupOperationState(dependencies.cleanupOperation ?? createGeneratedStateCleanupOperationSession({
    deadlineAtMonotonicMs: performance.now() + 30_000, maximumEntries: 100_000, maximumBytes: 2 * 1024 * 1024 * 1024 }));
  const mutation = <Value>(use: Parameters<typeof withMigratedGeneratedStateMutation<Value>>[0]['use']) =>
    withMigratedGeneratedStateMutation({ workspaceRoot, environment: dependencies.environment, backend: dependencies.mutation, use });
  return withGeneratedStateOperation({ workspaceRoot, backend: dependencies.effects, use: async (operation, physicalResource) => {
    const workspace = dependencies.physical.observeWorkspace();
    const worktrees = await dependencies.git.observeWorktrees(), tree = await dependencies.git.observeWorktreeTree();
    const records = worktrees.state === 'observed' ? worktrees.worktrees : [];
    const record = records.find(candidate => path.resolve(candidate.path).toLocaleLowerCase('en-US') === workspaceRoot.toLocaleLowerCase('en-US'));
    if (record === undefined || record === records[0] || record.bare || record.detached || record.locked || record.prunable ||
        record.branch !== input.expectedBranch || record.headSha !== input.expectedHeadSha || tree.state !== 'observed' || tree.treeSha !== input.expectedTreeSha) {
      throw new Error('Worktree retirement admission no longer matches one ordinary linked worktree.');
    }
    const namespace = await dependencies.effects.operationNamespace(physicalResource);
    const status = await dependencies.git.observeWorktreeStatus();
    if (status.state !== 'observed') throw new Error('Worktree retirement status is unavailable.');
    const retained = status.records.flatMap(record => {
      const generated = (record.index === '!' && record.worktree === '!') || (record.index === '?' && record.worktree === '?');
      if (!generated) return [{ record, excludedOwnerAnchor: null as string | null }];
      if (record.path === namespace.relativePath || record.path.startsWith(`${namespace.relativePath}/`)) return [];
      if (!namespace.relativePath.startsWith(`${record.path}/`)) return [{ record, excludedOwnerAnchor: null as string | null }];
      const root = dependencies.physical.observeRoot(record.path).directory;
      if (root === null) throw new Error('Worktree lease ancestor is no longer an ordinary root.');
      const leaseChild = namespace.relativePath.slice(record.path.length + 1).split('/')[0]!;
      return [...new Set(dependencies.physical.observeTree(root, budget).map(entry => entry.relativePath.split('/')[0]!))]
        .filter(top => top !== leaseChild).sort().map(top => ({ record: { ...record, path: `${record.path}/${top}` }, excludedOwnerAnchor: record.path }));
    });
    const ignoredRoots = retained.map(({ record, excludedOwnerAnchor }) => ({ relativePath: normalizeGeneratedStateRelativePath(record.path), excludedOwnerAnchor }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    if (ignoredRoots.some((root, index) => ignoredRoots.some((other, otherIndex) => otherIndex !== index && root.relativePath.startsWith(`${other.relativePath}/`)))) {
      throw new GeneratedStateWorktreeRetirementBlockedError('Worktree ignored roots overlap.');
    }
    if (retained.some(({ record }) => record.index !== '!' || record.worktree !== '!') ||
        ignoredRoots.some(root => namespace.relativePath.startsWith(`${root.relativePath}/`))) return null;
    const observationResource = dependencies.registrations.openObservation({ workspaceRoot, environment: dependencies.environment });
    if (observationResource === null) throw new Error('Worktree readonly resource is unavailable.');
    const beforeState = dependencies.journals.readWorktreeRetirementState(observationResource);
    if (beforeState.activeIntent === null && ignoredRoots.length === 0) return beforeState.latestReceipt === null ? null :
      assertGeneratedStateWorktreeRetirementEffectStart({ ...input, receipt: beforeState.latestReceipt }, dependencies.physical);
    await mutation(async () => undefined);
    const state = await mutation(async (_session, resource) => dependencies.journals.readWorktreeRetirementState(resource));
    if (state.activeIntent?.intentDigest !== beforeState.activeIntent?.intentDigest) throw new Error('Worktree active intent changed during admission.');
    let intent = state.activeIntent;
    if (intent === null) {
      const census = dependencies.registrations.readRegistrationCensus(observationResource);
      const entries: Entry[] = [];
      for (const { relativePath, excludedOwnerAnchor } of ignoredRoots) {
        const observed = dependencies.physical.observeRoot(relativePath);
        const eligible = (rules: readonly GeneratedStateRule[]) => rules.filter(({ selector }) =>
          (selector.kind === 'exact' ? selector.path : selector.parent) !== excludedOwnerAnchor);
        const directOwners = eligible(owners(relativePath)), descendants = eligible(below(relativePath));
        if (observed.identity === null || (directOwners.length === 0 && observed.directory === null) ||
            (directOwners.length === 0 && descendants.length === 0)) throw new GeneratedStateWorktreeRetirementBlockedError(`Worktree retirement found unknown ignored root: ${relativePath}.`);
        const inventory = directOwners.length > 0 ? [] : dependencies.physical.observeTree(observed.directory!, budget);
        const covered = new Set([...directOwners, ...descendants].map(rule => rule.id));
        for (const entry of inventory) {
          const childPath = `${relativePath}/${entry.relativePath}`, childOwners = eligible(owners(childPath)), childDescendants = eligible(below(childPath));
          if (childOwners.length === 0 && childDescendants.length === 0) throw new GeneratedStateWorktreeRetirementBlockedError(`Worktree retirement found unknown content: ${childPath}.`);
          [...childOwners, ...childDescendants].forEach(rule => covered.add(rule.id));
        }
        const form = directOwners.length === 1 ? directOwners[0]!.physicalForms.find(form => form.kind === observed.kind) : null;
        if (directOwners.length > 0 && form == null) throw new GeneratedStateWorktreeRetirementBlockedError('Unregistered worktree physical form.');
        const retirement = form?.worktreeRetirement;
        if (retirement?.mode === 'domain-retire') {
          const registration = census.observations.get(relativePath)?.registration;
          if (registration == null || registration.ruleId !== directOwners[0]!.id || !same(registration.root, observed.identity)) throw new Error('Worktree domain lacks exact registration.');
          const providers = dependencies.providers.filter(provider => provider.id === retirement.providerId);
          if (providers.length !== 1) throw new GeneratedStateWorktreeRetirementBlockedError('Worktree domain provider is unavailable or ambiguous.');
          const provider = providers[0]!, plan = await provider.plan({ repositoryRoot, workspaceRoot, relativePath, source: observed.identity, registration });
          if (plan.digest !== generatedStateDomainProviderMaterialDigest(provider.id, 'plan', plan.bytes)) throw new Error('Worktree provider plan digest differs.');
          entries.push({ action: 'domain-retire', relativePath, source: observed.identity, registration, providerId: provider.id,
            providerPlanBytes: plan.bytes, providerPlanDigest: plan.digest, ruleIds: [...covered].sort(),
            inventoryDigest: generatedStateDigest({ relativePath, source: observed.identity, providerId: provider.id, providerPlanDigest: plan.digest }) });
        } else {
          if (observed.kind !== 'directory' || observed.directory === null) throw new GeneratedStateWorktreeRetirementBlockedError('Worktree preservation requires ordinary directories.');
          entries.push({ action: 'preserve', relativePath, source: observed.identity, ruleIds: [...covered].sort(),
            destinationName: `g-${generatedStateDigest({ relativePath, source: observed.identity }).slice(7)}`,
            inventoryDigest: generatedStateDigest({ relativePath, source: observed.identity, inventory }) });
        }
      }
      const inventoryDigest = generatedStateDigest(entries), statusDigest = generatedStateDigest({ records: retained });
      const worktree = { branch: input.expectedBranch, headSha: input.expectedHeadSha, treeSha: input.expectedTreeSha };
      const identity = { device: workspace.device, inode: workspace.inode, objectId: workspace.objectId };
      const operationId = generatedStateDigest({ schema: 'sec-generated-state-worktree-retirement-operation-v1',
        repositoryRoot, workspacePath: workspaceRoot, workspace: identity, worktree, statusDigest, inventoryDigest, registryDigest: GENERATED_STATE_REGISTRY.registryDigest });
      const retention = entries.some(entry => entry.action === 'preserve') ? await dependencies.effects.createWorktreeRetention(physicalResource,
        issueGeneratedStateTreeEffect(operation, { kind: 'worktree-retention-create', operationId })) : null;
      const candidate = createGeneratedStateWorktreeRetirementIntent({ operationId, repositoryRoot, workspacePath: workspaceRoot,
        workspace: identity, worktree, statusDigest, inventoryDigest,
        retentionRoot: retention === null ? null : { path: retention.path, device: retention.device, inode: retention.inode, objectId: retention.objectId }, entries });
      intent = await mutation(async (session, resource) => dependencies.journals.publishWorktreeRetirementIntent(resource,
        issueGeneratedStatePublication(session, { kind: 'worktree-intent', intent: candidate })));
    }
    const active = intent;
    if (active.repositoryRoot !== repositoryRoot || active.workspacePath !== workspaceRoot || !same(active.workspace, workspace) ||
        active.worktree.branch !== input.expectedBranch || active.worktree.headSha !== input.expectedHeadSha || active.worktree.treeSha !== input.expectedTreeSha) throw new Error('Worktree intent belongs to another admission.');
    const retention = active.retentionRoot === null ? null : dependencies.physical.observeExactDirectory(active.retentionRoot.path);
    if (active.retentionRoot !== null && (retention === null || retention.device !== workspace.device || !same(retention, active.retentionRoot))) throw new Error('Worktree retention root changed.');
    if (retention !== null) {
      const known = new Set(active.entries.filter(entry => entry.action === 'preserve').map(entry => entry.destinationName));
      if (dependencies.physical.observeTree(retention, budget).some(entry => !known.has(entry.relativePath.split('/')[0]!))) throw new Error('Worktree retention contains unknown content.');
    }
    const completed: Array<GeneratedStateWorktreeRetirement['entries'][number]> = [];
    const providerResults: Array<Awaited<ReturnType<typeof executeGeneratedStateProviderEffect>>> = [];
    for (const entry of [...active.entries].sort((a, b) => Number(b.action === 'domain-retire') - Number(a.action === 'domain-retire'))) {
      await dependencies.effects.assertOperationCurrent(physicalResource);
      if (entry.action === 'domain-retire') {
        const providers = dependencies.providers.filter(provider => provider.id === entry.providerId);
        if (providers.length !== 1) throw new GeneratedStateWorktreeRetirementBlockedError('Worktree domain provider is unavailable or ambiguous.');
        const registration = await mutation(async (session, resource): Promise<GeneratedStateRegistration> => {
          let observation = dependencies.mutation.readRegistrationCensus(resource).observations.get(entry.relativePath);
          let current = observation?.registration ?? observation?.retiredPredecessor;
          if (entry.registration.phase === 'active' && current?.phase === 'active' && current.registrationDigest === entry.registration.registrationDigest) {
            if (observation?.tip == null) throw new Error('Worktree domain predecessor is missing.');
            const retired = retireGeneratedStateRegistration(current, generatedStateOwnerRetirementRef(current, `worktree-retirement:${active.operationId}`), { clock: dependencies.clock });
            dependencies.mutation.publishRegistration(resource, issueGeneratedStatePublication(session, { kind: 'registration', registration: retired,
              previousRecordDigest: observation.tip.recordDigest, event: 'registered' }));
            observation = dependencies.mutation.readRegistrationCensus(resource).observations.get(entry.relativePath);
            current = observation?.registration ?? observation?.retiredPredecessor;
          }
          if (current?.phase !== 'retired' || !same(current.root, entry.source) || !same(current.workspace, active.workspace) ||
              (entry.registration.phase === 'active' ? current.retirementRef !== generatedStateOwnerRetirementRef(entry.registration, `worktree-retirement:${active.operationId}`) ||
                observation?.previousRegistration?.registrationDigest !== entry.registration.registrationDigest : current.registrationDigest !== entry.registration.registrationDigest)) throw new Error('Worktree domain retirement predecessor changed.');
          return current;
        });
        const providerReceipt = await executeGeneratedStateProviderEffect(operation, providers[0]!, { operationId: active.operationId, repositoryRoot,
          workspaceRoot, relativePath: entry.relativePath, source: entry.source, registration, planBytes: entry.providerPlanBytes, planDigest: entry.providerPlanDigest });
        providerResults.push(providerReceipt);
        await dependencies.afterWorktreeRetirementProviderEffect?.(entry.relativePath);
        await mutation(async (session, resource) => {
          const terminal = dependencies.mutation.readRegistrationCensus(resource).observations.get(entry.relativePath);
          if (terminal?.tip == null || (terminal.registration ?? terminal.retiredPredecessor)?.registrationDigest !== registration.registrationDigest) throw new Error('Worktree domain terminal predecessor changed.');
          if (terminal.registration !== null) dependencies.mutation.publishRegistration(resource, issueGeneratedStatePublication(session,
            { kind: 'registration', registration, previousRecordDigest: terminal.tip.recordDigest, event: 'disposed' }));
        });
        completed.push({ relativePath: entry.relativePath, source: entry.source, inventoryDigest: entry.inventoryDigest, ruleIds: entry.ruleIds,
          action: 'domain-retired', providerId: entry.providerId, providerPlanDigest: entry.providerPlanDigest,
          providerReceiptBytes: providerReceipt.bytes, providerReceiptDigest: providerReceipt.digest });
      } else {
        if (retention === null) throw new Error('Worktree preserve intent lacks retention root.');
        const source = dependencies.physical.observeRoot(entry.relativePath), destination = dependencies.physical.observeExactDirectory(path.join(retention.path, entry.destinationName));
        let retainedRoot;
        if (source.kind === 'directory' && source.identity !== null && same(source.identity, entry.source) && destination === null) {
          retainedRoot = await dependencies.effects.relocateWorktreePreservation(physicalResource,
            issueGeneratedStateTreeEffect(operation, { kind: 'worktree-relocate', relativePath: entry.relativePath, intentDigest: active.intentDigest }));
          await dependencies.afterWorktreeRetirementRelocation?.(entry.relativePath);
        } else if (source.kind === 'missing' && destination !== null && same(destination, entry.source)) retainedRoot = destination;
        else throw new Error('Worktree preservation cannot resume its exact physical root.');
        completed.push({ ...entry, action: 'preserved', retained: { device: retainedRoot.device, inode: retainedRoot.inode, objectId: retainedRoot.objectId } });
      }
    }
    const receipt = createGeneratedStateWorktreeRetirement({ operationId: active.operationId, repositoryRoot, workspacePath: workspaceRoot,
      workspace: active.workspace, worktree: active.worktree, statusDigest: active.statusDigest, inventoryDigest: active.inventoryDigest,
      retentionRoot: active.retentionRoot, entries: completed, blockers: [] });
    const readback = await mutation(async (session, resource) => dependencies.journals.completeWorktreeRetirement(resource,
      issueGeneratedStatePublication(session, { kind: 'worktree-complete', intentDigest: active.intentDigest, receipt,
        effectEvidence: issueGeneratedStateProviderSettlement(operation, receipt, providerResults) })));
    return assertGeneratedStateWorktreeRetirementEffectStart({ ...input, receipt: readback }, dependencies.physical);
  } });
}
