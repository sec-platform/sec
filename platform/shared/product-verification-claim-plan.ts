import type { VerificationClaimDefinitionV1 } from './verification-result-contract.ts';
import type { VerificationLane } from './verification-types.ts';

const PRODUCT_OWNING_ENVIRONMENT = `${process.platform}-${process.arch}`;

const PRODUCT_VERIFICATION_BINDING_REGISTRY = Object.freeze({
  gateOrder: Object.freeze(['fast', 'runtime', 'policy'] as const),
  claimOrder: Object.freeze(['fast', 'policy', 'runtime'] as const),
  bindings: Object.freeze({
    fast: Object.freeze({
      gateId: 'product-fast-lane',
      claimId: 'product-fast-verification',
      selectedLanes: Object.freeze(['fast', 'all'] as VerificationLane[])
    }),
    runtime: Object.freeze({
      gateId: 'product-runtime-lane',
      claimId: 'product-runtime-verification',
      selectedLanes: Object.freeze(['runtime', 'all'] as VerificationLane[])
    }),
    policy: Object.freeze({
      gateId: 'product-policy-gate',
      claimId: 'product-policy-verification',
      selectedLanes: Object.freeze(['fast', 'all'] as VerificationLane[])
    })
  })
});

export type ProductVerificationGateKind =
  keyof typeof PRODUCT_VERIFICATION_BINDING_REGISTRY.bindings;

export interface ProductVerificationGateClaimProjectionV1 {
  readonly gateId: string;
  readonly requiredForClaims: string[];
  readonly supportedClaims: string[];
}

/** Project the canonical product gate order without exposing mutable registry state. */
export function projectProductVerificationGateOrder(): ProductVerificationGateKind[] {
  return [...PRODUCT_VERIFICATION_BINDING_REGISTRY.gateOrder];
}

/**
 * Project one gate-to-claim binding from the private product registry.
 * Every call returns fresh arrays so consumers cannot mutate later projections.
 */
export function projectProductVerificationGateClaim(
  gate: ProductVerificationGateKind,
  supportsClaim: boolean
): ProductVerificationGateClaimProjectionV1 {
  const binding = PRODUCT_VERIFICATION_BINDING_REGISTRY.bindings[gate];
  return {
    gateId: binding.gateId,
    requiredForClaims: [binding.claimId],
    supportedClaims: supportsClaim ? [binding.claimId] : []
  };
}

/**
 * Build the selected product verification claim plan from the same registry.
 * Claim order and lane selection preserve the canonical serialized output.
 */
export function buildProductVerificationClaimPlan(
  lane: VerificationLane
): VerificationClaimDefinitionV1[] {
  return PRODUCT_VERIFICATION_BINDING_REGISTRY.claimOrder.flatMap((gate) => {
    const binding = PRODUCT_VERIFICATION_BINDING_REGISTRY.bindings[gate];
    const selectedLanes: readonly VerificationLane[] = binding.selectedLanes;
    return selectedLanes.includes(lane)
      ? [{
          claimId: binding.claimId,
          requiredGateIds: [binding.gateId],
          owningEnvironments: [PRODUCT_OWNING_ENVIRONMENT]
        }]
      : [];
  });
}
