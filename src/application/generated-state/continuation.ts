import path from 'node:path';
import {
  GeneratedStateCleanupOperationExhaustedError,
  generatedStateCleanupOperationState,
  type GeneratedStateCleanupOperationSession
} from '../../execution/generated-state/cleanup-budget.ts';
import {
  GENERATED_STATE_CLEANUP_CONTINUATION_SCHEMA, generatedStateDigest, normalizeGeneratedStateRelativePath,
  type GeneratedStateCleanupContinuationReceipt, type GeneratedStateCleanupProfile,
  type GeneratedStatePhysicalIdentity
} from '../../execution/generated-state/contract.ts';
import { issueGeneratedStateTerminalReceipt } from '../../execution/generated-state/terminal-receipt.ts';
import { settleGeneratedState, type GeneratedStateCleanupDependencies } from './cleanup.ts';
import { inspectGeneratedState } from './inventory.ts';

export async function continueGeneratedStateCleanup(input: Readonly<{
  repositoryRoot: string; workspaceRoot: string; profile: GeneratedStateCleanupProfile;
  relativePaths: readonly string[]; operation: GeneratedStateCleanupOperationSession;
}>, dependencies: GeneratedStateCleanupDependencies): Promise<GeneratedStateCleanupContinuationReceipt> {
  generatedStateCleanupOperationState(input.operation);
  const repositoryRoot = path.resolve(input.repositoryRoot), workspaceRoot = path.resolve(input.workspaceRoot);
  const requested = Object.freeze([...new Set(input.relativePaths.map(normalizeGeneratedStateRelativePath))].sort());
  if (requested.length === 0) throw new Error('Cleanup continuation requires at least one selected root.');
  let settlementDigest: `sha256:${string}`;
  try {
    settlementDigest = (await settleGeneratedState({ repositoryRoot, workspaceRoot, profile: input.profile, relativePaths: requested },
      { ...dependencies, cleanupOperation: input.operation })).settlementDigest;
  } catch (error) {
    if (!(error instanceof GeneratedStateCleanupOperationExhaustedError)) throw error;
    settlementDigest = generatedStateDigest({ domain: 'generated-state-cleanup-operation-exhausted', repositoryRoot, requested });
  }
  const after = await inspectGeneratedState({ repositoryRoot, workspaceRoot, relativePaths: requested }, dependencies);
  const resource = dependencies.registrations.openObservation({ workspaceRoot, environment: dependencies.environment });
  if (resource === null) throw new Error('Continuation has no native readonly workspace resource.');
  const census = dependencies.registrations.readRegistrationCensus(resource);
  const completed: string[] = [], quarantined: Array<Readonly<{ relativePath: string;
    registrationDigest: `sha256:${string}`; physical: GeneratedStatePhysicalIdentity }>> = [], blockers: string[] = [];
  for (const relativePath of requested) {
    const entry = after.entries.find(candidate => candidate.relativePath === relativePath);
    const ledger = census.observations.get(relativePath);
    const intent = dependencies.journals.readCleanupIntent(resource, relativePath);
    if (entry?.kind === 'missing' && entry.registrationState === 'missing' && intent === null) { completed.push(relativePath); continue; }
    const registration = ledger?.registration;
    if (entry?.kind !== 'missing' || registration?.phase !== 'retired' || intent === null ||
        intent.registrationDigest !== registration.registrationDigest || intent.root.objectId !== registration.root.objectId ||
        intent.root.device !== registration.root.device || intent.root.inode !== registration.root.inode) {
      blockers.push(`${relativePath}:cleanup-continuation-intent-invalid`); continue;
    }
    const tombstone = dependencies.physical.observeExactDirectory(path.join(workspaceRoot, '.tmp', 'generated-state-quarantine', intent.tombstoneName));
    if (tombstone === null || tombstone.objectId !== registration.root.objectId || tombstone.device !== registration.root.device ||
        tombstone.inode !== registration.root.inode) { blockers.push(`${relativePath}:cleanup-continuation-quarantine-invalid`); continue; }
    quarantined.push(Object.freeze({ relativePath, registrationDigest: registration.registrationDigest, physical: registration.root }));
  }
  await dependencies.registrations.assertObservationCurrent(resource);
  const terminal = blockers.length > 0 ? 'blocked' as const : quarantined.length > 0 ? 'continuation-required' as const : 'completed' as const;
  const material = Object.freeze({ schema: GENERATED_STATE_CLEANUP_CONTINUATION_SCHEMA, repositoryRoot, requested,
    completed: Object.freeze(completed.sort()), quarantined: Object.freeze(quarantined.sort((a, b) => a.relativePath.localeCompare(b.relativePath))),
    blockers: Object.freeze(blockers.sort()), settlementDigest, terminal });
  const receipt = Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
  return issueGeneratedStateTerminalReceipt(receipt, dependencies.journals.captureContinuationEvidence(resource, receipt));
}
