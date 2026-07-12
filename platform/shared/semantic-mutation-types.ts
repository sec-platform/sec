import type {
  FactAssertionId,
  FactDelta,
  FactDeltaEndpointContext,
  SemanticEntityId,
  SemanticEntityKind,
  SemanticFactObject,
  SemanticPredicate
} from './engineering-ir-types.ts';
import type { SemanticImpactPropagation } from './semantic-impact-types.ts';

export const SEMANTIC_MUTATION_CONTRACT_VERSION = '2' as const;
export const SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION =
  'semantic-mutation-operations-v1' as const;
export const SEMANTIC_MUTATION_EXPECTATION_REVISION =
  'semantic-mutation-expectation-v1' as const;
export const SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION =
  'semantic-mutation-verification-policy-v1' as const;

export type SemanticMutationContractVersion = typeof SEMANTIC_MUTATION_CONTRACT_VERSION;
export type SemanticMutationOperationRegistryRevision =
  typeof SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION;
export type SemanticMutationExpectationRevision =
  typeof SEMANTIC_MUTATION_EXPECTATION_REVISION;
export type SemanticMutationVerificationPolicyRevision =
  typeof SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION;

export interface SemanticMutationBaseV2 {
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
}

export interface SemanticContractRefV1 {
  readonly namespace: string;
  readonly contractId: string;
}

export interface AddStateTransitionOperationV1 {
  readonly operationId: string;
  readonly kind: 'add-state-transition';
  readonly contract: SemanticContractRefV1;
  readonly stateId: string;
  readonly from: string;
  readonly to: string;
  readonly by: string;
}

export type SemanticMutationOperationV1 = AddStateTransitionOperationV1;

export interface SemanticFactSelectorV1 {
  readonly subject: SemanticEntityId;
  readonly predicate: SemanticPredicate;
  readonly object: SemanticFactObject;
}

export type SemanticMutationConditionV1 =
  | {
      readonly conditionId: string;
      readonly kind: 'entity';
      readonly entityId: SemanticEntityId;
      readonly exists: boolean;
      readonly entityKind?: SemanticEntityKind;
      readonly canonicalEntityDigest?: string;
    }
  | {
      readonly conditionId: string;
      readonly kind: 'fact';
      readonly fact: SemanticFactSelectorV1;
      readonly exists: boolean;
    }
  | {
      readonly conditionId: string;
      readonly kind: 'assertion';
      readonly fact: SemanticFactSelectorV1;
      readonly assertionId: FactAssertionId;
      readonly exists: boolean;
      readonly canonicalAssertionDigest?: string;
    };

export interface ExpectedFactAssertionV1 {
  readonly assertionId: FactAssertionId;
  readonly assertionClaimDigest: string;
}

export interface ExpectedSemanticFactV1 {
  readonly fact: SemanticFactSelectorV1;
  readonly assertions: readonly ExpectedFactAssertionV1[];
}

export type ExpectedFactAssertionChangeV1 =
  | {
      readonly fact: SemanticFactSelectorV1;
      readonly assertionId: FactAssertionId;
      readonly kind: 'added' | 'removed';
      readonly assertionClaimDigest: string;
    }
  | {
      readonly fact: SemanticFactSelectorV1;
      readonly assertionId: FactAssertionId;
      readonly kind: 'updated';
      readonly changedFields: readonly ('confidence' | 'evidence')[];
      readonly beforeAssertionClaimDigest: string;
      readonly afterAssertionClaimDigest: string;
    };

export interface SemanticMutationExpectationV1 {
  readonly revision: SemanticMutationExpectationRevision;
  readonly matchMode: 'exact';
  readonly addedFacts: readonly ExpectedSemanticFactV1[];
  readonly removedFacts: readonly ExpectedSemanticFactV1[];
  readonly assertionChanges: readonly ExpectedFactAssertionChangeV1[];
  readonly entityChanges: 'none';
}

export type VerificationRequirementV1 =
  | { readonly kind: 'acceptance'; readonly acceptanceEntityId: SemanticEntityId }
  | { readonly kind: 'selector'; readonly selector: string }
  | { readonly kind: 'pass'; readonly passId: string };

export interface SemanticMutationRequestV2 {
  readonly contractVersion: SemanticMutationContractVersion;
  readonly requestId: string;
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly base: SemanticMutationBaseV2;
  readonly preconditions: readonly SemanticMutationConditionV1[];
  readonly operations: readonly SemanticMutationOperationV1[];
  readonly expectation: SemanticMutationExpectationV1;
  readonly postconditions: readonly SemanticMutationConditionV1[];
  readonly additionalVerification: readonly VerificationRequirementV1[];
}

export interface NormalizedSemanticMutationRequestV2 extends SemanticMutationRequestV2 {
  readonly requestRevision: string;
}

export interface SemanticMutationAuthorizationContextV2 {
  readonly authorizationRevision: string;
  readonly taskId?: string;
  readonly envelopeRevision?: string;
  readonly allowedOperationKinds: readonly SemanticMutationOperationV1['kind'][];
  readonly allowedTargetEntityIds: readonly SemanticEntityId[];
  readonly allowedSourceOwnerIds: readonly string[];
  readonly allowedPathPrefixes: readonly string[];
  readonly requiredPreconditions: readonly SemanticMutationConditionV1[];
  readonly requiredPostconditions: readonly SemanticMutationConditionV1[];
  readonly minimumVerification: readonly VerificationRequirementV1[];
}

export type SemanticMutationDiagnosticOrigin =
  | 'semantic-mutation'
  | 'fact-delta'
  | 'impact'
  | 'compiler'
  | 'verification';

export type SemanticMutationDiagnosticStage =
  | 'request'
  | 'base'
  | 'precondition'
  | 'source-resolution'
  | 'path'
  | 'transform'
  | 'cas'
  | 'staged-rebuild'
  | 'fact-delta'
  | 'expectation'
  | 'impact'
  | 'impact-verification'
  | 'publish'
  | 'rollback';

export interface SemanticMutationDiagnosticV2 {
  readonly origin: SemanticMutationDiagnosticOrigin;
  readonly code: string;
  readonly stage: SemanticMutationDiagnosticStage;
  readonly message: string;
  readonly operationId?: string;
  readonly conditionId?: string;
  readonly relativePath?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SemanticMutationSourceChangeV2 {
  readonly ownerId: string;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly relativePath: string;
  readonly beforeByteDigest: string;
  readonly stagedByteDigest: string;
  readonly invalidationFromStage: 'resolve';
}

export type SemanticMutationPreparationRejectedAt =
  | 'source-resolution'
  | 'path'
  | 'transform'
  | 'cas'
  | 'staged-rebuild';

export type SemanticMutationPreparationV2 =
  | {
      readonly status: 'prepared';
      readonly preflightRevision: string;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: FactDeltaEndpointContext;
      readonly rollbackManifestDigest: string;
    }
  | {
      readonly status: 'rejected';
      readonly preflightRevision: string;
      readonly rejectedAt: SemanticMutationPreparationRejectedAt;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    };

export interface SemanticMutationVerificationCapabilityV1 {
  readonly requirement: VerificationRequirementV1;
  readonly status: 'runnable' | 'non-runnable';
  readonly isolated: boolean;
}

export interface SemanticMutationVerificationPlanningContextV1 {
  readonly policyRevision: SemanticMutationVerificationPolicyRevision;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly impactRevision: string;
  readonly requiredVerificationDigest: string;
  readonly uncertaintyStatus: 'covered' | 'blocked';
  readonly capabilities: readonly SemanticMutationVerificationCapabilityV1[];
  readonly planningRevision: string;
}

export interface SemanticMutationPreflightInputV2 {
  readonly request: SemanticMutationRequestV2;
  readonly base: FactDeltaEndpointContext;
  readonly authorization: SemanticMutationAuthorizationContextV2;
}

export interface SemanticMutationInputV2 extends SemanticMutationPreflightInputV2 {
  readonly preparation: SemanticMutationPreparationV2;
  readonly verificationPlanning: SemanticMutationVerificationPlanningContextV1;
}

export type SemanticMutationPreflightV2 =
  | {
      readonly contractVersion: SemanticMutationContractVersion;
      readonly status: 'rejected';
      readonly rejectedAt: 'request';
      readonly requestId?: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
      readonly diagnosticRevision: string;
    }
  | {
      readonly contractVersion: SemanticMutationContractVersion;
      readonly status: 'ready' | 'rejected';
      readonly rejectedAt: '' | 'base' | 'precondition' | 'source-resolution' | 'transform';
      readonly requestId: string;
      readonly requestRevision: string;
      readonly authorizationRevision: string;
      readonly base: SemanticMutationBaseV2;
      readonly operationRegistryRevision: SemanticMutationOperationRegistryRevision;
      readonly expectationRevision: SemanticMutationExpectationRevision;
      readonly preflightRevision: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    };

export type SemanticMutationRisk = 'low' | 'medium' | 'high' | 'critical';

export interface SemanticMutationPlanBaseV2 {
  readonly contractVersion: SemanticMutationContractVersion;
  readonly requestId: string;
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly operationRegistryRevision: SemanticMutationOperationRegistryRevision;
  readonly expectationRevision: SemanticMutationExpectationRevision;
  readonly verificationPolicyRevision: SemanticMutationVerificationPolicyRevision;
  readonly verificationAdapterId: string;
  readonly verificationAdapterRevision: string;
  readonly verificationPlanningRevision: string;
  readonly base: SemanticMutationBaseV2;
  readonly planRevision: string;
}

export type SemanticMutationEarlyRejectionStage =
  | 'base'
  | 'precondition'
  | SemanticMutationPreparationRejectedAt;

export type SemanticMutationPlanV2 =
  | {
      readonly contractVersion: SemanticMutationContractVersion;
      readonly status: 'rejected';
      readonly rejectedAt: 'request';
      readonly requestId?: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
      readonly diagnosticRevision: string;
    }
  | (SemanticMutationPlanBaseV2 & {
      readonly status: 'ready';
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly risk: SemanticMutationRisk;
      readonly requiredVerification: readonly VerificationRequirementV1[];
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly [];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: 'rejected';
      readonly rejectedAt: SemanticMutationEarlyRejectionStage;
      readonly sourceChanges: readonly [];
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: 'rejected';
      readonly rejectedAt: 'fact-delta';
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: 'rejected';
      readonly rejectedAt: 'expectation' | 'impact';
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: 'rejected';
      readonly rejectedAt: 'impact-verification';
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly risk: SemanticMutationRisk;
      readonly requiredVerification: readonly VerificationRequirementV1[];
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    });

export type SemanticMutationTerminalStatus =
  | 'accepted'
  | 'rejected'
  | 'rolled-back'
  | 'recovery-required';

export interface SemanticMutationVerificationExecutionRefV2 {
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly reportRevision: string;
  readonly planRevision: string;
  readonly attempted: SemanticMutationBaseV2;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly verificationExecutionRevision: string;
}

export interface SemanticMutationResultBaseV2 {
  readonly contractVersion: SemanticMutationContractVersion;
  readonly requestId: string;
  readonly requestRevision: string;
  readonly planRevision: string;
  readonly base: SemanticMutationBaseV2;
  readonly resultRevision: string;
}

export type SemanticMutationResultV2 =
  | (SemanticMutationResultBaseV2 & {
      readonly status: 'accepted';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBaseV2;
      readonly accepted: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly verification: SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' };
      readonly diagnostics: readonly [];
    })
  | (SemanticMutationResultBaseV2 & {
      readonly status: 'rejected';
      readonly transactionId?: string;
      readonly attempted?: SemanticMutationBaseV2;
      readonly actualDelta?: FactDelta;
      readonly impact?: SemanticImpactPropagation;
      readonly sourceChanges: readonly SemanticMutationSourceChangeV2[];
      readonly verification?: SemanticMutationVerificationExecutionRefV2;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationResultBaseV2 & {
      readonly status: 'rolled-back';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly verification: SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' };
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationResultBaseV2 & {
      readonly status: 'recovery-required';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly verification: SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' };
      readonly recoveryState:
        | 'rollback-failed'
        | 'restore-validation-failed'
        | 'rebuild-failed'
        | 'concurrent-write';
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    });

export type SemanticMutationResultDraftV2 =
  SemanticMutationResultV2 extends infer Result
    ? Result extends SemanticMutationResultV2
      ? Omit<Result, 'resultRevision'>
      : never
    : never;
