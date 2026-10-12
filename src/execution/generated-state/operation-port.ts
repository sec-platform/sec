import type { GeneratedStateCleanupProfile, GeneratedStateInventory } from './contract.ts';
export type GeneratedStateDomainOwnerPlan = Readonly<{ schema: string; owner: string; inventoryDigest: `sha256:${string}`;
  selected: readonly Readonly<{ relativePath: string }>[]; planDigest: `sha256:${string}` }>;
export type GeneratedStateDomainOwnerReceipt = Readonly<{ schema: string; owner: string; planDigest: `sha256:${string}`;
  receiptDigest: `sha256:${string}`; terminal: 'completed' | 'partial-residue' }>;
export interface GeneratedStateDomainOwnerOperation {
  readonly owner: string;
  plan(input: Readonly<{ repositoryRoot: string; workspaceRoot: string; inventory: GeneratedStateInventory;
    profile: GeneratedStateCleanupProfile }>): GeneratedStateDomainOwnerPlan;
  settle(plan: GeneratedStateDomainOwnerPlan): Promise<GeneratedStateDomainOwnerReceipt>;
}
