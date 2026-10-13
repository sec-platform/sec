import { generatedStateDomainProviderMaterialDigest, type GeneratedStateWorktreeRetirement } from './contract.ts';
import type {
  GeneratedStateWorktreeRetirementEffectAuthority, GeneratedStateWorktreeRetirementEffectInput,
  GeneratedStateWorktreeRetirementProvider
} from './lifecycle-port.ts';
import type { GeneratedStateNativeOperationResource, GeneratedStateOperationSession } from './tree-effect.ts';
import { generatedStateOperationResource } from './tree-effect.ts';
export interface GeneratedStateProviderSettlementEvidence { readonly kind: 'generated-state-provider-settlement-evidence'; }
type ProviderReceipt = Readonly<{ bytes: string; digest: `sha256:${string}` }>;
const providerReceipts = new WeakMap<object, Readonly<{ resource: GeneratedStateNativeOperationResource;
  providerId: string; input: GeneratedStateWorktreeRetirementEffectInput }>>();
const settlements = new WeakMap<object, Readonly<{ resource: GeneratedStateNativeOperationResource;
  session: GeneratedStateOperationSession; receiptDigest: `sha256:${string}` }>>();

const effects = new WeakMap<object, { resource: GeneratedStateNativeOperationResource;
  session: GeneratedStateOperationSession; providerId: string; input: GeneratedStateWorktreeRetirementEffectInput; consumed: boolean }>();

/** Admission retains the original operation. The provider's native boundary
 * must verify this resource and the durable exact intent before its Effect. */
export async function executeGeneratedStateProviderEffect(session: GeneratedStateOperationSession,
  provider: GeneratedStateWorktreeRetirementProvider, input: GeneratedStateWorktreeRetirementEffectInput) {
  const resource = generatedStateOperationResource(session);
  if (input.registration.phase !== 'retired' || input.planDigest !==
      generatedStateDomainProviderMaterialDigest(provider.id, 'plan', input.planBytes)) throw new Error('Invalid domain retirement admission.');
  const authority = Object.freeze({ schema: 'sec-generated-state-worktree-retirement-effect-authority-v1' as const });
  effects.set(authority, { resource, session, providerId: provider.id,
    input: Object.freeze(structuredClone(input)), consumed: false });
  try {
    const receipt = await provider.retire(authority);
    if (effects.get(authority)?.consumed !== true || receipt.digest !==
        generatedStateDomainProviderMaterialDigest(provider.id, 'receipt', receipt.bytes)) throw new Error('Domain provider has no exact consumed Effect and receipt.');
    const originalReceipt = Object.freeze({ ...receipt });
    providerReceipts.set(originalReceipt, Object.freeze({ resource, providerId: provider.id, input: effects.get(authority)!.input }));
    return originalReceipt;
  } finally { effects.delete(authority); }
}
export function issueGeneratedStateProviderSettlement(session: GeneratedStateOperationSession,
  receipt: GeneratedStateWorktreeRetirement, originals: readonly ProviderReceipt[]): GeneratedStateProviderSettlementEvidence {
  const resource = generatedStateOperationResource(session);
  const domain = receipt.entries.filter(entry => entry.action === 'domain-retired');
  if (originals.length !== domain.length) throw new Error('Worktree settlement omits an original provider result.');
  const used = new Set<object>();
  for (const entry of domain) {
    const original = originals.find(candidate => {
      const proof = providerReceipts.get(candidate);
      return proof?.resource === resource && proof.input.operationId === receipt.operationId &&
        proof.input.relativePath === entry.relativePath && proof.providerId === entry.providerId &&
        proof.input.planDigest === entry.providerPlanDigest && candidate.bytes === entry.providerReceiptBytes && candidate.digest === entry.providerReceiptDigest;
    });
    if (original === undefined || used.has(original)) throw new Error('Worktree settlement provider bytes were not issued by this live operation.');
    used.add(original);
  }
  const evidence = Object.freeze({ kind: 'generated-state-provider-settlement-evidence' as const });
  settlements.set(evidence, Object.freeze({ resource, session, receiptDigest: receipt.receiptDigest }));
  return evidence;
}
export function consumeGeneratedStateProviderSettlement(evidence: GeneratedStateProviderSettlementEvidence,
  receiptDigest: `sha256:${string}`): GeneratedStateNativeOperationResource {
  const original = settlements.get(evidence);
  if (original === undefined || original.receiptDigest !== receiptDigest || generatedStateOperationResource(original.session) !== original.resource) throw new Error('Worktree provider settlement evidence is forged, stale or changed.');
  settlements.delete(evidence); return original.resource;
}

export function consumeGeneratedStateWorktreeRetirementEffectAuthority(authority: GeneratedStateWorktreeRetirementEffectAuthority,
  providerId: string): Readonly<{ resource: GeneratedStateNativeOperationResource; input: GeneratedStateWorktreeRetirementEffectInput }> {
  const state = effects.get(authority);
  if (state === undefined || state.consumed || state.providerId !== providerId ||
      generatedStateOperationResource(state.session) !== state.resource) throw new Error('Domain retirement Effect authority is forged, stale, replayed or settled.');
  state.consumed = true;
  return Object.freeze({ resource: state.resource, input: state.input });
}
