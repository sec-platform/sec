import type { FactAssertionUpdateField, FactDelta, FactDeltaEndpointContext } from '../engineering-ir/delta-types.ts';
import type { SemanticEntityId } from '../engineering-ir/entity-types.ts';
import type { FactAssertionId, SemanticFactId, SemanticPredicate } from '../engineering-ir/fact-types.ts';
import type { ENGINEERING_IR_FORMAT_VERSION } from '../engineering-ir/root-types.ts';

export const IMPACT_CONTRACT_VERSION = '1' as const;
export const IMPACT_SCOPE = 'fact-delta+validated-graph' as const;
export const IMPACT_PROPAGATION_RULE_REVISION = 'impact-propagation-rules-v1' as const;

type ImpactContractVersion = typeof IMPACT_CONTRACT_VERSION;
type ImpactScope = typeof IMPACT_SCOPE;
type ImpactPropagationRuleRevision = typeof IMPACT_PROPAGATION_RULE_REVISION;
export type ImpactBasis = 'from' | 'to';
type ImpactLevel = 'direct' | 'transitive';

export interface ImpactPropagationInput {
  readonly delta: FactDelta;
  readonly from: FactDeltaEndpointContext;
  readonly to: FactDeltaEndpointContext;
}

export type ImpactSeed =
  | {
      readonly id: string;
      readonly kind: 'entity-added' | 'entity-removed';
      readonly basis: ImpactBasis;
      readonly entityId: SemanticEntityId;
      readonly anchorEntityId: SemanticEntityId;
    }
  | {
      readonly id: string;
      readonly kind: 'entity-updated';
      readonly basis: ImpactBasis;
      readonly entityId: SemanticEntityId;
      readonly anchorEntityId: SemanticEntityId;
      readonly changedFields: readonly ('label' | 'attributes')[];
    }
  | {
      readonly id: string;
      readonly kind: 'fact-added' | 'fact-removed';
      readonly basis: ImpactBasis;
      readonly factId: SemanticFactId;
      readonly anchorEntityId: SemanticEntityId;
    }
  | {
      readonly id: string;
      readonly kind: 'assertion-added' | 'assertion-removed';
      readonly basis: ImpactBasis;
      readonly factId: SemanticFactId;
      readonly assertionId: FactAssertionId;
      readonly anchorEntityId: SemanticEntityId;
    }
  | {
      readonly id: string;
      readonly kind: 'assertion-updated';
      readonly basis: ImpactBasis;
      readonly factId: SemanticFactId;
      readonly assertionId: FactAssertionId;
      readonly anchorEntityId: SemanticEntityId;
      readonly changedFields: readonly FactAssertionUpdateField[];
    };

export interface ImpactPathStep {
  readonly factId: SemanticFactId;
  readonly predicate: SemanticPredicate;
  readonly ruleVariantId: string;
  readonly direction: 'subject-to-object' | 'object-to-subject';
  readonly fromEntityId: SemanticEntityId;
  readonly toEntityId: SemanticEntityId;
}

export interface ImpactOccurrence {
  readonly basis: ImpactBasis;
  readonly entityId: SemanticEntityId;
  readonly level: ImpactLevel;
  readonly distance: number;
  readonly seedIds: readonly string[];
  readonly canonicalPath: readonly ImpactPathStep[];
}

type ImpactUncertaintyReason =
  | 'unregistered-active-predicate'
  | 'non-definite-authority'
  | 'value-object-boundary'
  | 'verification-mapping-missing'
  | 'verification-mapping-non-runnable';

export interface ImpactUncertainty {
  readonly basis: ImpactBasis;
  readonly classification: 'unknown' | 'dynamic';
  readonly reasonCode: ImpactUncertaintyReason;
  readonly boundaryEntityId?: SemanticEntityId;
  readonly factId?: SemanticFactId;
  readonly predicate?: SemanticPredicate;
  readonly seedIds: readonly string[];
  readonly canonicalPath: readonly ImpactPathStep[];
}

export interface VerificationReason {
  readonly basis: ImpactBasis;
  readonly sourceEntityId: SemanticEntityId;
  readonly sourceLevel: 'seed' | ImpactLevel;
  readonly sourceSeedIds: readonly string[];
  readonly factId?: SemanticFactId;
}

export type VerificationRecommendation =
  | {
      readonly kind: 'acceptance';
      readonly acceptanceEntityId: SemanticEntityId;
      readonly reasons: readonly VerificationReason[];
    }
  | {
      readonly kind: 'selector';
      readonly selector: string;
      readonly reasons: readonly VerificationReason[];
    };

export interface SemanticImpactPropagation {
  readonly contractVersion: ImpactContractVersion;
  readonly scope: ImpactScope;
  readonly formatVersion: typeof ENGINEERING_IR_FORMAT_VERSION;
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly deltaRevision: string;
  readonly fromSemanticRevision: string;
  readonly toSemanticRevision: string;
  readonly fromFactSetDigest: string;
  readonly toFactSetDigest: string;
  readonly propagationRuleRevision: ImpactPropagationRuleRevision;
  readonly seeds: readonly ImpactSeed[];
  readonly direct: readonly ImpactOccurrence[];
  readonly transitive: readonly ImpactOccurrence[];
  readonly uncertainties: readonly ImpactUncertainty[];
  readonly verification: readonly VerificationRecommendation[];
  readonly impactRevision: string;
}
