import path from 'node:path';
import {
  GENERATED_STATE_DISPOSAL_RECEIPT_SCHEMA, generatedStateDigest,
  generatedStateLegacyRetirementRuleForPath,
  generatedStateRuleForPath,
  normalizeGeneratedStateRelativePath,
  type GeneratedStateCleanupProfile, type GeneratedStateRegistration
} from '../../execution/generated-state/contract.ts';
import { issueGeneratedStatePublication } from '../../execution/generated-state/registration-session.ts';
import { generatedStateOwnerRetirementRef } from '../../execution/generated-state/registration-transition.ts';
import { issueGeneratedStateTerminalReceipt } from '../../execution/generated-state/terminal-receipt.ts';
import type { GeneratedStateCleanupDependencies } from './cleanup.ts';
import { settleGeneratedState } from './cleanup.ts';
import { withMigratedGeneratedStateMutation } from './registration.ts';

export async function prepareGeneratedStateDisposal(input: Readonly<{
  repositoryRoot: string; workspaceRoot: string; relativePath: string; outcome: string;
  profile: GeneratedStateCleanupProfile; expectedRegistrationDigest: `sha256:${string}` | null;
  acceptExistingRetirement?: boolean;
}>, dependencies: GeneratedStateCleanupDependencies, retire: (path: string, outcome: string) => Promise<GeneratedStateRegistration>) {
  const repositoryRoot = path.resolve(input.repositoryRoot), workspaceRoot = path.resolve(input.workspaceRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = generatedStateRuleForPath(relativePath) ?? generatedStateLegacyRetirementRuleForPath(relativePath);
  const outcome = input.outcome.trim();
  if (rule === null || !rule.cleanupProfiles.includes(input.profile)) throw new Error('Generated-state disposal profile is not owned by its registration rule.');
  if (outcome.length === 0) throw new Error('Disposal owner outcome is empty.');
  const initial = await withMigratedGeneratedStateMutation({ workspaceRoot, environment: dependencies.environment, backend: dependencies.mutation,
    use: async (_session, resource) => dependencies.mutation.readRegistrationCensus(resource).observations.get(relativePath) });
  let registration = initial?.registration ?? initial?.retiredPredecessor;
  if (registration === undefined || registration === null || path.resolve(registration.repositoryRoot) !== repositoryRoot ||
      registration.relativePath !== relativePath || registration.ruleId !== rule.id || registration.owner !== rule.owner || registration.producer !== rule.producer) {
    throw new Error('Disposal registration is missing, foreign or stale.');
  }
  const predecessor = registration.phase === 'active' ? registration : initial?.previousRegistration;
  if (predecessor === undefined || predecessor === null || predecessor.phase !== 'active' ||
      predecessor.root.objectId !== registration.root.objectId || predecessor.root.device !== registration.root.device ||
      predecessor.root.inode !== registration.root.inode) throw new Error('Disposal active retirement predecessor is missing or foreign.');
  let retirementRef = generatedStateOwnerRetirementRef(predecessor, outcome);
  if (initial?.registration?.phase === 'active') {
    if (input.expectedRegistrationDigest !== registration.registrationDigest) throw new Error('Disposal is not bound to this producer active registration.');
    registration = await retire(relativePath, outcome);
  } else {
    if (registration.phase !== 'retired' || registration.retirementRef === null ||
        (!input.acceptExistingRetirement && registration.retirementRef !== retirementRef)) throw new Error('Disposal recovery differs from the owner retirement.');
    retirementRef = registration.retirementRef;
  }
  const physical = dependencies.physical.observeRoot(relativePath);
  if (physical.identity !== null && (physical.identity.objectId !== registration.root.objectId ||
      physical.identity.device !== registration.root.device || physical.identity.inode !== registration.root.inode)) throw new Error('Disposal physical identity changed.');
  return Object.freeze({ repositoryRoot, workspaceRoot, relativePath, rule, registration, retirementRef });
}

export async function disposeGeneratedStateRegistration(input: Parameters<typeof prepareGeneratedStateDisposal>[0],
  dependencies: GeneratedStateCleanupDependencies, retire: Parameters<typeof prepareGeneratedStateDisposal>[2],
  settleRetired: (path: string) => Promise<boolean>) {
  const prepared = await prepareGeneratedStateDisposal(input, dependencies, retire);
  const { repositoryRoot, workspaceRoot, relativePath, registration, retirementRef, rule } = prepared;
  if (rule.physicalForms.some(form => form.worktreeRetirement.mode === 'domain-retire')) await settleRetired(relativePath);
  const key = Object.freeze({ relativePath, profile: input.profile, registrationDigest: registration.registrationDigest,
    retirementRef, physical: registration.root });
  const observationResource = dependencies.registrations.openObservation({ workspaceRoot, environment: dependencies.environment });
  if (observationResource === null) throw new Error('Disposal readback workspace resource is unavailable.');
  const capture = () => {
    const readback = dependencies.journals.captureDisposalEvidence(observationResource, key);
    return issueGeneratedStateTerminalReceipt(readback.receipt, readback.evidence);
  };
  if (dependencies.physical.observeRoot(relativePath).kind === 'missing' &&
      dependencies.journals.readDisposalReceipt(observationResource, key) !== null) return capture();
  const settlement = await settleGeneratedState({ repositoryRoot, workspaceRoot, profile: input.profile, relativePaths: [relativePath] }, dependencies);
  if ((settlement.terminal !== 'completed' && settlement.terminal !== 'no-op') || settlement.blockers.length > 0 ||
      dependencies.physical.observeRoot(relativePath).kind !== 'missing') throw new Error('Generated-state disposal did not reach one terminal physical absence.');
  const material = Object.freeze({ schema: GENERATED_STATE_DISPOSAL_RECEIPT_SCHEMA, relativePath, profile: input.profile,
    registrationDigest: registration.registrationDigest, retirementRef, physical: registration.root,
    beforeInventoryDigest: settlement.beforeInventoryDigest, afterInventoryDigest: settlement.afterInventoryDigest,
    settlementDigest: settlement.settlementDigest, terminal: 'disposed' as const });
  const receipt = Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
  await withMigratedGeneratedStateMutation({ workspaceRoot, environment: dependencies.environment, backend: dependencies.mutation,
    use: async (session, resource) => { dependencies.journals.publishDisposalReceipt(resource,
      issueGeneratedStatePublication(session, { kind: 'disposal-receipt', receipt })); } });
  return capture();
}
