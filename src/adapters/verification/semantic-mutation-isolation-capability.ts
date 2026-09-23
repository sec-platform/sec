import { forwardSemanticMutationIsolatedRuntimePlanBinding } from './semantic-mutation-isolated-runtime-binding.ts';

const SEMANTIC_MUTATION_ISOLATION_CAPABILITY_EVIDENCE_REVISION =
  'semantic-mutation-isolation-capability-evidence-v1' as const;

export type SemanticMutationIsolationCapabilityEvidence = Readonly<{
  formatRevision: typeof SEMANTIC_MUTATION_ISOLATION_CAPABILITY_EVIDENCE_REVISION;
  status: 'available' | 'unavailable' | 'unproven';
}>;

export type SemanticMutationIsolationCapabilityProbe = () => unknown | Promise<unknown>;

const provenAvailableEvidence = new WeakSet<object>();

function evidence(
  status: SemanticMutationIsolationCapabilityEvidence['status'],
  proven: boolean
): SemanticMutationIsolationCapabilityEvidence {
  const value = Object.freeze({
    formatRevision: SEMANTIC_MUTATION_ISOLATION_CAPABILITY_EVIDENCE_REVISION,
    status
  });
  if (proven) provenAvailableEvidence.add(value);
  return value;
}

/**
 * Converts a trusted, freshly executed platform probe into process-local
 * capability evidence. The evidence is deliberately opaque: cloning,
 * serializing, or structurally forging it drops the process-local proof.
 */
export async function probeSemanticMutationIsolationCapability(
  probe?: SemanticMutationIsolationCapabilityProbe
): Promise<SemanticMutationIsolationCapabilityEvidence> {
  if (typeof probe !== 'function') return evidence('unproven', false);
  try {
    const result = await probe();
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
      Reflect.ownKeys(result).length !== 1 || !Object.hasOwn(result, 'status')) {
      return evidence('unproven', false);
    }
    const status = (result as { readonly status?: unknown }).status;
    if (status === 'available') {
      const proven = evidence('available', true);
      forwardSemanticMutationIsolatedRuntimePlanBinding(result, proven);
      return proven;
    }
    if (status === 'unavailable') return evidence('unavailable', false);
    return evidence('unproven', false);
  } catch {
    return evidence('unproven', false);
  }
}

export function hasProvenSemanticMutationIsolationCapability(
  value: unknown
): value is SemanticMutationIsolationCapabilityEvidence & { readonly status: 'available' } {
  return Boolean(value) && typeof value === 'object' &&
    (value as { readonly formatRevision?: unknown }).formatRevision ===
      SEMANTIC_MUTATION_ISOLATION_CAPABILITY_EVIDENCE_REVISION &&
    (value as { readonly status?: unknown }).status === 'available' &&
    provenAvailableEvidence.has(value as object);
}
