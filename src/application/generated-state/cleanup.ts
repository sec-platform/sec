import path from 'node:path';
import {
  assertGeneratedStateCleanupOperation, createGeneratedStateCleanupOperationSession,
  GeneratedStateCleanupOperationExhaustedError,
  generatedStateCleanupOperationState,
  type GeneratedStateCleanupOperationSession
} from '../../execution/generated-state/cleanup-budget.ts';
import {
  createGeneratedStateSettlement, generatedStateDigest, type GeneratedStateCleanupProfile,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateSettlement
} from '../../execution/generated-state/contract.ts';
import type { GeneratedStateCleanupIntent, GeneratedStateJournalMutationBackend } from '../../execution/generated-state/journal-port.ts';
import type { GeneratedStateRegistrationMutationBackend } from '../../execution/generated-state/registration-port.ts';
import { issueGeneratedStatePublication } from '../../execution/generated-state/registration-session.ts';
import {
  issueGeneratedStateTreeEffect,
  withGeneratedStateOperation,
  type GeneratedStateTreeEffectBackend
} from '../../execution/generated-state/tree-effect.ts';
import { inspectGeneratedState, planGeneratedStateCleanup, type GeneratedStateInventoryDependencies } from './inventory.ts';
import { withMigratedGeneratedStateMutation } from './registration.ts';

export interface GeneratedStateCleanupDependencies extends GeneratedStateInventoryDependencies {
  readonly mutation: GeneratedStateRegistrationMutationBackend;
  readonly journals: GeneratedStateJournalMutationBackend;
  readonly effects: GeneratedStateTreeEffectBackend;
  readonly cleanupOperation?: GeneratedStateCleanupOperationSession;
  readonly beforeCleanupEffect?: (relativePath: string) => void | Promise<void>;
  readonly afterQuarantineEffect?: (relativePath: string) => void | Promise<void>;
}
function sameIdentity(left: GeneratedStatePhysicalIdentity, right: GeneratedStatePhysicalIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

export async function settleGeneratedState(input: Readonly<{
  repositoryRoot: string; workspaceRoot?: string; profile: GeneratedStateCleanupProfile | 'inspect-only';
  relativePaths?: readonly string[];
}>, dependencies: GeneratedStateCleanupDependencies): Promise<GeneratedStateSettlement> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const inspectInput = { repositoryRoot, workspaceRoot, relativePaths: input.relativePaths };
  if (input.profile === 'inspect-only') {
    const before = await inspectGeneratedState(inspectInput, dependencies);
    return createGeneratedStateSettlement({ repositoryRoot, beforeInventoryDigest: before.inventoryDigest,
      afterInventoryDigest: before.inventoryDigest, profile: input.profile, selected: Object.freeze([]),
      protected: Object.freeze(before.entries.filter(entry => entry.kind !== 'missing').map(entry => entry.relativePath).sort()),
      attempts: Object.freeze([]), terminal: 'no-op', blockers: Object.freeze([]) }, { clock: dependencies.clock });
  }
  const profile = input.profile;
  const budget = generatedStateCleanupOperationState(dependencies.cleanupOperation ?? createGeneratedStateCleanupOperationSession({
    deadlineAtMonotonicMs: performance.now() + 30_000, maximumEntries: 100_000, maximumBytes: 2 * 1024 * 1024 * 1024
  }));
  assertGeneratedStateCleanupOperation(budget, 'Generated-state cleanup admission');
  const mutation = <Value>(use: Parameters<typeof withMigratedGeneratedStateMutation<Value>>[0]['use']) =>
    withMigratedGeneratedStateMutation({ workspaceRoot, environment: dependencies.environment, backend: dependencies.mutation, use });
  return withGeneratedStateOperation({ workspaceRoot, backend: dependencies.effects, use: async (operation, physicalResource) => {
    await mutation(async () => undefined);
    const before = await inspectGeneratedState(inspectInput, dependencies);
    const plan = planGeneratedStateCleanup({ inventory: before, profile });
    const attempts: Array<GeneratedStateSettlement['attempts'][number]> = [];
    const blockers: string[] = [];
    const residue = (relativePath: string, blocker: string, error: unknown) => {
      blockers.push(`${relativePath}:${blocker}`);
      attempts.push(Object.freeze({ relativePath, action: 'residue',
        detailRef: generatedStateDigest(error instanceof Error ? error.message : String(error)) }));
    };
    const terminalize = async (relativePath: string, intent: GeneratedStateCleanupIntent): Promise<void> => {
      await mutation(async (session, resource) => {
        if (dependencies.physical.observeRoot(relativePath).kind !== 'missing') throw new Error(
          'Generated-state cleanup source is present before terminal publication.');
        const observation = dependencies.mutation.readRegistrationCensus(resource).observations.get(relativePath);
        const registration = observation?.registration ?? observation?.retiredPredecessor;
        if (registration?.registrationDigest !== intent.registrationDigest || observation?.tip === null || observation?.tip === undefined) {
          throw new Error('Cleanup registration disappeared or changed before terminal publication.');
        }
        if (observation.registration !== null) dependencies.mutation.publishRegistration(resource,
          issueGeneratedStatePublication(session, { kind: 'registration', registration,
            previousRecordDigest: observation.tip.recordDigest, event: 'disposed' }));
        dependencies.journals.completeCleanupIntent(resource, issueGeneratedStatePublication(session,
          { kind: 'cleanup-complete', relativePath, intentDigest: intent.intentDigest, registrationDigest: intent.registrationDigest }));
      });
    };
    // Recovery inspects the original durable pointer before touching a
    // quarantined object; historical disposed state never proves absence.
    for (const entry of before.entries.filter(entry => entry.kind === 'missing')) {
      const recovery = await mutation(async (_session, resource) => {
        const observation = dependencies.mutation.readRegistrationCensus(resource).observations.get(entry.relativePath);
        return { observation, intent: dependencies.journals.readCleanupIntent(resource, entry.relativePath) };
      });
      const registration = recovery.observation?.registration ?? recovery.observation?.retiredPredecessor;
      if (registration === undefined || registration === null ||
          (recovery.observation?.registration === null && recovery.intent === null)) continue;
      const intent = recovery.intent;
      if (intent === null || intent.profile !== profile || intent.registrationDigest !== registration.registrationDigest ||
          !sameIdentity(registration.root, intent.root)) {
        residue(entry.relativePath, 'retired-absent-root-without-valid-intent', 'retired-absent-root-without-valid-intent'); continue;
      }
      try {
        await dependencies.effects.deleteQuarantine(physicalResource, issueGeneratedStateTreeEffect(operation,
          { kind: 'quarantine-delete', relativePath: entry.relativePath, intentDigest: intent.intentDigest }), budget);
        await terminalize(entry.relativePath, intent);
        attempts.push(Object.freeze({ relativePath: entry.relativePath, action: 'deleted',
          detailRef: generatedStateDigest({ intentDigest: intent.intentDigest, effect: 'interrupted-cleanup-physical-absence-readback' }) }));
      } catch (error) { residue(entry.relativePath, 'interrupted-cleanup-residue', error); }
    }
    for (const relativePath of plan.selected) {
      const entry = before.entries.find(entry => entry.relativePath === relativePath)!;
      await dependencies.beforeCleanupEffect?.(relativePath);
      const current = dependencies.physical.observeRoot(relativePath);
      if (current.kind !== 'directory' || current.directory === null || current.identity === null ||
          entry.physicalIdentity === null || !sameIdentity(entry.physicalIdentity, current.identity)) {
        blockers.push(`${relativePath}:changed-after-inventory-or-unsupported-kind`);
        attempts.push(Object.freeze({ relativePath, action: 'protected', detailRef: generatedStateDigest('changed-after-inventory-or-unsupported-kind') }));
        continue;
      }
      const material = Object.freeze({ schema: 'sec-generated-state-cleanup-intent-v2' as const,
        beforeInventoryDigest: before.inventoryDigest, profile, registrationDigest: entry.registrationDigest!, relativePath,
        root: entry.physicalIdentity, tombstoneName: `q-${entry.registrationDigest!.slice(7, 55)}` });
      const intent = Object.freeze({ ...material, intentDigest: generatedStateDigest(material) });
      // The short publication lease ends before any callback or tree Effect.
      await mutation(async (session, resource) => { dependencies.journals.publishCleanupIntent(resource,
        issueGeneratedStatePublication(session, { kind: 'cleanup-intent', intent })); });
      try {
        await dependencies.effects.relocateQuarantine(physicalResource, issueGeneratedStateTreeEffect(operation,
          { kind: 'quarantine-relocate', relativePath, intentDigest: intent.intentDigest }));
        attempts.push(Object.freeze({ relativePath, action: 'quarantined', detailRef: intent.intentDigest }));
        await dependencies.afterQuarantineEffect?.(relativePath);
        await dependencies.effects.deleteQuarantine(physicalResource, issueGeneratedStateTreeEffect(operation,
          { kind: 'quarantine-delete', relativePath, intentDigest: intent.intentDigest }), budget);
        await terminalize(relativePath, intent);
        attempts.push(Object.freeze({ relativePath, action: 'deleted',
          detailRef: generatedStateDigest({ intentDigest: intent.intentDigest, effect: 'physical-absence-readback' }) }));
      } catch (error) { residue(relativePath, 'cleanup-residue', error); }
    }
    try {
      const entries = await dependencies.effects.finalizeQuarantine(physicalResource,
        issueGeneratedStateTreeEffect(operation, { kind: 'quarantine-finalize' }), budget);
      if (entries !== 0) residue('.tmp/generated-state-quarantine', 'physical-residue',
        { effect: 'quarantine-nonempty-readback', entryCount: entries });
    } catch (error) {
      if (!(error instanceof GeneratedStateCleanupOperationExhaustedError)) throw error;
      residue('.tmp/generated-state-quarantine', 'cleanup-operation-exhausted', error);
    }
    const after = await inspectGeneratedState(inspectInput, dependencies);
    const settlement = createGeneratedStateSettlement({ repositoryRoot, beforeInventoryDigest: before.inventoryDigest,
      afterInventoryDigest: after.inventoryDigest, profile, selected: plan.selected, protected: plan.protected,
      attempts: Object.freeze(attempts), terminal: blockers.length > 0 ? 'partial-residue' :
        plan.selected.length === 0 && attempts.length === 0 ? 'no-op' : 'completed', blockers: Object.freeze(blockers) },
    { clock: dependencies.clock });
    await mutation(async (session, resource) => { dependencies.journals.publishCleanupSettlement(resource,
      issueGeneratedStatePublication(session, { kind: 'cleanup-settlement', settlement })); });
    return settlement;
  } });
}
