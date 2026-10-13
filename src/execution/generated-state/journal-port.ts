import type {
  GeneratedStateCleanupContinuationReceipt,
  GeneratedStateCleanupProfile,
  GeneratedStateDisposalReceipt,
  GeneratedStatePhysicalIdentity,
  GeneratedStateRegistration,
  GeneratedStateSettlement,
  GeneratedStateWorktreeRetirement
} from './contract.ts';
import { generatedStateDigest } from './contract.ts';
import type { GeneratedStateProviderSettlementEvidence } from './provider-effect.ts';
import type { GeneratedStateNativeMutationResource, GeneratedStateNativeResource, GeneratedStatePublicationAuthority } from './registration-contract.ts';
import type { GeneratedStateNativeTerminalEvidence } from './terminal-receipt.ts';

export interface GeneratedStateCleanupIntent {
  readonly schema: 'sec-generated-state-cleanup-intent-v2';
  readonly beforeInventoryDigest: `sha256:${string}`;
  readonly profile: GeneratedStateCleanupProfile;
  readonly registrationDigest: `sha256:${string}`;
  readonly relativePath: string;
  readonly root: GeneratedStatePhysicalIdentity;
  readonly tombstoneName: string;
  readonly intentDigest: `sha256:${string}`;
}

export interface GeneratedStateWorktreeRetirementIntent {
  readonly schema: 'sec-generated-state-worktree-retirement-intent-v1';
  readonly operationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspacePath: string;
  readonly workspace: GeneratedStatePhysicalIdentity;
  readonly worktree: { readonly branch: string; readonly headSha: string; readonly treeSha: string };
  readonly statusDigest: `sha256:${string}`;
  readonly inventoryDigest: `sha256:${string}`;
  readonly retentionRoot: ({ readonly path: string } & GeneratedStatePhysicalIdentity) | null;
  readonly entries: readonly (
    | Readonly<{
        action: 'preserve';
        relativePath: string;
        destinationName: string;
        source: GeneratedStatePhysicalIdentity;
        inventoryDigest: `sha256:${string}`;
        ruleIds: readonly string[];
      }>
    | Readonly<{
        action: 'domain-retire';
        relativePath: string;
        source: GeneratedStatePhysicalIdentity;
        inventoryDigest: `sha256:${string}`;
        ruleIds: readonly string[];
        registration: GeneratedStateRegistration;
        providerId: string;
        providerPlanBytes: string;
        providerPlanDigest: `sha256:${string}`;
      }>
  )[];
  readonly intentDigest: `sha256:${string}`;
}
export function createGeneratedStateWorktreeRetirementIntent(input: Omit<GeneratedStateWorktreeRetirementIntent, 'schema' | 'intentDigest'>): GeneratedStateWorktreeRetirementIntent {
  const material = Object.freeze({ schema: 'sec-generated-state-worktree-retirement-intent-v1' as const, ...input,
    entries: Object.freeze([...input.entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) });
  return Object.freeze({ ...material, intentDigest: generatedStateDigest(material) });
}
export interface GeneratedStateDisposalReceiptKey {
  readonly relativePath: string; readonly profile: GeneratedStateCleanupProfile;
  readonly registrationDigest: `sha256:${string}`; readonly retirementRef: `sha256:${string}`;
  readonly physical: GeneratedStatePhysicalIdentity;
}
export type GeneratedStateJournalPublicationRequest =
  | Readonly<{ kind: 'cleanup-intent'; intent: GeneratedStateCleanupIntent }>
  | Readonly<{ kind: 'cleanup-complete'; relativePath: string; intentDigest: `sha256:${string}`; registrationDigest: `sha256:${string}` }>
  | Readonly<{ kind: 'disposal-receipt'; receipt: GeneratedStateDisposalReceipt }>
  | Readonly<{ kind: 'worktree-intent'; intent: GeneratedStateWorktreeRetirementIntent }>
  | Readonly<{ kind: 'worktree-complete'; intentDigest: `sha256:${string}`; receipt: GeneratedStateWorktreeRetirement;
      effectEvidence: GeneratedStateProviderSettlementEvidence }>
  | Readonly<{ kind: 'cleanup-settlement'; settlement: GeneratedStateSettlement }>;
export interface GeneratedStateJournalMutationBackend {
  captureContinuationEvidence(resource: GeneratedStateNativeResource, receipt: GeneratedStateCleanupContinuationReceipt): GeneratedStateNativeTerminalEvidence;
  captureDisposalEvidence(resource: GeneratedStateNativeResource, key: GeneratedStateDisposalReceiptKey):
    Readonly<{ receipt: GeneratedStateDisposalReceipt; evidence: GeneratedStateNativeTerminalEvidence }>;
  readCleanupIntent(resource: GeneratedStateNativeResource, relativePath: string): GeneratedStateCleanupIntent | null;
  publishCleanupIntent(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): GeneratedStateCleanupIntent;
  completeCleanupIntent(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): void;
  readDisposalReceipt(resource: GeneratedStateNativeResource, key: GeneratedStateDisposalReceiptKey): GeneratedStateDisposalReceipt | null;
  publishDisposalReceipt(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): GeneratedStateDisposalReceipt;
  readWorktreeRetirementState(resource: GeneratedStateNativeResource): Readonly<{
    activeIntent: GeneratedStateWorktreeRetirementIntent | null; latestReceipt: GeneratedStateWorktreeRetirement | null;
  }>;
  publishWorktreeRetirementIntent(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): GeneratedStateWorktreeRetirementIntent;
  completeWorktreeRetirement(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): Promise<GeneratedStateWorktreeRetirement>;
  publishCleanupSettlement(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): GeneratedStateSettlement;
}
