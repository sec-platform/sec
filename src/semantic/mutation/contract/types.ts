import type { FactDelta, FactDeltaEndpointContext } from '../../engineering-ir/contract/delta-types.ts';
import type { SemanticEntityId, SemanticEntityKind } from '../../engineering-ir/contract/entity-types.ts';
import type { FactAssertionId, SemanticFactObject, SemanticPredicate } from '../../engineering-ir/contract/fact-types.ts';
import type { LoadedSemanticContract } from '../../contracts/contract/types.ts';
import type { SemanticImpactPropagation } from '../../impact/contract/types.ts';

export const SEMANTIC_MUTATION_CONTRACT_VERSION = '2' as const;
export const SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION =
  'semantic-mutation-operations-v1' as const;
export const SEMANTIC_MUTATION_EXPECTATION_REVISION =
  'semantic-mutation-expectation-v1' as const;
export const SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION =
  'semantic-mutation-verification-policy-v1' as const;
export const SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION =
  'semantic-mutation-source-adapters-v1' as const;
export const SEMANTIC_CONTRACT_YAML_ADAPTER_ID = 'semantic-contract-yaml' as const;
export const SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION = 'semantic-contract-yaml-v1' as const;
export const SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION =
  'semantic-mutation-source-path-evidence-v1' as const;
export const SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION =
  'semantic-mutation-source-edit-plan-v1' as const;
export const SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION =
  'semantic-mutation-rollback-manifest-v2' as const;

export type SemanticMutationContractVersion = typeof SEMANTIC_MUTATION_CONTRACT_VERSION;
export type SemanticMutationOperationRegistryRevision =
  typeof SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION;
export type SemanticMutationExpectationRevision =
  typeof SEMANTIC_MUTATION_EXPECTATION_REVISION;
export type SemanticMutationVerificationPolicyRevision =
  typeof SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION;
export type SemanticMutationSourceAdapterRegistryRevision =
  typeof SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION;
export type SemanticContractYamlAdapterId = typeof SEMANTIC_CONTRACT_YAML_ADAPTER_ID;
export type SemanticContractYamlAdapterRevision = typeof SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION;
export type SemanticMutationSourcePathEvidenceRevision =
  typeof SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION;
export type SemanticMutationSourceEditPlanRevision =
  typeof SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION;
export type SemanticMutationRollbackManifestRevision =
  typeof SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION;

export interface SemanticMutationBase {
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
}

export interface SemanticContractRef {
  readonly namespace: string;
  readonly contractId: string;
}

export interface AddStateTransitionOperation {
  readonly operationId: string;
  readonly kind: 'add-state-transition';
  readonly contract: SemanticContractRef;
  readonly stateId: string;
  readonly from: string;
  readonly to: string;
  readonly by: string;
}

export type SemanticMutationOperation = AddStateTransitionOperation;

export interface SemanticFactSelector {
  readonly subject: SemanticEntityId;
  readonly predicate: SemanticPredicate;
  readonly object: SemanticFactObject;
}

export type SemanticMutationCondition =
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
      readonly fact: SemanticFactSelector;
      readonly exists: boolean;
    }
  | {
      readonly conditionId: string;
      readonly kind: 'assertion';
      readonly fact: SemanticFactSelector;
      readonly assertionId: FactAssertionId;
      readonly exists: boolean;
      readonly canonicalAssertionDigest?: string;
    };

export interface ExpectedFactAssertion {
  readonly assertionId: FactAssertionId;
  readonly assertionClaimDigest: string;
}

export interface ExpectedSemanticFact {
  readonly fact: SemanticFactSelector;
  readonly assertions: readonly ExpectedFactAssertion[];
}

export type ExpectedFactAssertionChange =
  | {
      readonly fact: SemanticFactSelector;
      readonly assertionId: FactAssertionId;
      readonly kind: 'added' | 'removed';
      readonly assertionClaimDigest: string;
    }
  | {
      readonly fact: SemanticFactSelector;
      readonly assertionId: FactAssertionId;
      readonly kind: 'updated';
      readonly changedFields: readonly ('confidence' | 'evidence')[];
      readonly beforeAssertionClaimDigest: string;
      readonly afterAssertionClaimDigest: string;
    };

export interface SemanticMutationExpectation {
  readonly revision: SemanticMutationExpectationRevision;
  readonly matchMode: 'exact';
  readonly addedFacts: readonly ExpectedSemanticFact[];
  readonly removedFacts: readonly ExpectedSemanticFact[];
  readonly assertionChanges: readonly ExpectedFactAssertionChange[];
  readonly entityChanges: 'none';
}

export type VerificationRequirement =
  | { readonly kind: 'acceptance'; readonly acceptanceEntityId: SemanticEntityId }
  | { readonly kind: 'selector'; readonly selector: string }
  | { readonly kind: 'pass'; readonly passId: string };

export interface SemanticMutationRequest {
  readonly contractVersion: SemanticMutationContractVersion;
  readonly requestId: string;
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly base: SemanticMutationBase;
  readonly preconditions: readonly SemanticMutationCondition[];
  readonly operations: readonly SemanticMutationOperation[];
  readonly expectation: SemanticMutationExpectation;
  readonly postconditions: readonly SemanticMutationCondition[];
  readonly additionalVerification: readonly VerificationRequirement[];
}

export interface NormalizedSemanticMutationRequest extends SemanticMutationRequest {
  readonly requestRevision: string;
}

export interface SemanticMutationAuthorizationContext {
  readonly authorizationRevision: string;
  readonly taskId?: string;
  readonly envelopeRevision?: string;
  readonly allowedOperationKinds: readonly SemanticMutationOperation['kind'][];
  readonly allowedTargetEntityIds: readonly SemanticEntityId[];
  readonly allowedSourceOwnerIds: readonly string[];
  readonly allowedPathPrefixes: readonly string[];
  readonly requiredPreconditions: readonly SemanticMutationCondition[];
  readonly requiredPostconditions: readonly SemanticMutationCondition[];
  readonly minimumVerification: readonly VerificationRequirement[];
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

export interface SemanticMutationDiagnostic {
  readonly origin: SemanticMutationDiagnosticOrigin;
  readonly code: string;
  readonly stage: SemanticMutationDiagnosticStage;
  readonly message: string;
  readonly operationId?: string;
  readonly conditionId?: string;
  readonly relativePath?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SemanticMutationSourceChange {
  readonly ownerId: string;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly relativePath: string;
  readonly beforeByteDigest: string;
  readonly stagedByteDigest: string;
  readonly invalidationFromStage: 'resolve';
}

export type SemanticMutationSourceKind =
  | 'workspace-authoring'
  | 'workspace-registry'
  | 'compiler-registry';

/** Trusted loader output. Proposal/request callers never supply source candidates. */
export interface SemanticMutationLoadedSourceCandidate {
  readonly sourceKind: SemanticMutationSourceKind;
  readonly loadedContract: LoadedSemanticContract;
  readonly sourceRevision: string;
}

export interface SemanticMutationSourcePathEvidence {
  readonly formatRevision: SemanticMutationSourcePathEvidenceRevision;
  readonly relativePath: string;
  readonly workspaceIdentityDigest: string;
  readonly transactionDirectoryIdentityDigest: string;
  readonly parentIdentityDigest: string;
  readonly targetIdentityDigest: string;
  readonly pathEvidenceRevision: string;
}

export type SemanticMutationSourceLineEnding = 'lf' | 'crlf' | 'none';

export interface SemanticMutationWindowsFileAttributes {
  readonly readOnly: boolean;
  readonly hidden: boolean;
  readonly system: boolean;
  readonly archive: boolean;
}

export interface SemanticMutationRollbackManifest {
  readonly formatRevision: SemanticMutationRollbackManifestRevision;
  readonly ownerId: string;
  readonly adapterId: SemanticContractYamlAdapterId;
  readonly adapterRevision: SemanticContractYamlAdapterRevision;
  readonly relativePath: string;
  readonly beforeByteDigest: string;
  readonly stagedByteDigest: string;
  readonly beforeByteLength: number;
  readonly stagedByteLength: number;
  readonly fileMode: number;
  readonly windowsFileAttributes: SemanticMutationWindowsFileAttributes | null;
  readonly encoding: 'utf-8';
  readonly utf8Bom: boolean;
  readonly lineEnding: SemanticMutationSourceLineEnding;
  readonly finalNewline: boolean;
  readonly pathEvidenceRevision: string;
  readonly rollbackManifestDigest: string;
}

export interface SemanticMutationSourceEditPlan {
  readonly formatRevision: SemanticMutationSourceEditPlanRevision;
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly preflightRevision: string;
  readonly operationRegistryRevision: SemanticMutationOperationRegistryRevision;
  readonly sourceAdapterRegistryRevision: SemanticMutationSourceAdapterRegistryRevision;
  readonly sourceResolutionRevision: string;
  readonly sourceRevision: string;
  readonly sourceKind: 'workspace-authoring';
  readonly ownerId: string;
  readonly adapterId: SemanticContractYamlAdapterId;
  readonly adapterRevision: SemanticContractYamlAdapterRevision;
  readonly namespace: string;
  readonly contractId: string;
  readonly relativePath: string;
  readonly pathEvidence: SemanticMutationSourcePathEvidence;
  readonly operations: readonly SemanticMutationOperation[];
  readonly beforeByteDigest: string;
  readonly stagedByteDigest: string;
  readonly rollbackManifestDigest: string;
  readonly editPlanRevision: string;
}

export type SemanticMutationSourceEditPlanningRejectedAt =
  | 'source-resolution'
  | 'path'
  | 'transform'
  | 'cas';

export type SemanticMutationSourceEditPlanningResult =
  | {
      readonly status: 'planned';
      readonly plan: SemanticMutationSourceEditPlan;
      readonly rollbackManifest: SemanticMutationRollbackManifest;
    }
  | {
      readonly status: 'rejected';
      readonly rejectedAt: SemanticMutationSourceEditPlanningRejectedAt;
      readonly preflightRevision: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    };

export type SemanticMutationPreparationRejectedAt =
  | 'source-resolution'
  | 'path'
  | 'transform'
  | 'cas'
  | 'staged-rebuild';

export type SemanticMutationPreparation =
  | {
      readonly status: 'prepared';
      readonly preflightRevision: string;
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly staged: FactDeltaEndpointContext;
      readonly rollbackManifestDigest: string;
    }
  | {
      readonly status: 'rejected';
      readonly preflightRevision: string;
      readonly rejectedAt: SemanticMutationPreparationRejectedAt;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    };

export interface SemanticMutationVerificationCapability {
  readonly requirement: VerificationRequirement;
  readonly status: 'runnable' | 'non-runnable';
  readonly isolated: boolean;
}

export interface SemanticMutationVerificationPlanningContext {
  readonly policyRevision: SemanticMutationVerificationPolicyRevision;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly impactRevision: string;
  readonly requiredVerificationDigest: string;
  readonly uncertaintyStatus: 'covered' | 'blocked';
  readonly capabilities: readonly SemanticMutationVerificationCapability[];
  readonly planningRevision: string;
}

export interface SemanticMutationPreflightInput {
  readonly request: SemanticMutationRequest;
  readonly base: FactDeltaEndpointContext;
  readonly authorization: SemanticMutationAuthorizationContext;
}

export interface SemanticMutationInput extends SemanticMutationPreflightInput {
  readonly preparation: SemanticMutationPreparation;
  /** Present only after a real Impact-bound capability observation exists. */
  readonly verificationPlanning?: SemanticMutationVerificationPlanningContext;
}

export type SemanticMutationPreflight =
  | {
      readonly contractVersion: SemanticMutationContractVersion;
      readonly status: 'rejected';
      readonly rejectedAt: 'request';
      readonly requestId?: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
      readonly diagnosticRevision: string;
    }
  | {
      readonly contractVersion: SemanticMutationContractVersion;
      readonly status: 'ready' | 'rejected';
      readonly rejectedAt: '' | 'base' | 'precondition' | 'source-resolution' | 'transform';
      readonly requestId: string;
      readonly requestRevision: string;
      readonly authorizationRevision: string;
      readonly base: SemanticMutationBase;
      readonly operationRegistryRevision: SemanticMutationOperationRegistryRevision;
      readonly expectationRevision: SemanticMutationExpectationRevision;
      readonly preflightRevision: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    };

export type SemanticMutationRisk = 'low' | 'medium' | 'high' | 'critical';

export interface SemanticMutationPlanBase {
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
  readonly base: SemanticMutationBase;
  readonly planRevision: string;
}

export type SemanticMutationEarlyRejectionStage =
  | 'base'
  | 'precondition'
  | SemanticMutationPreparationRejectedAt;

export type SemanticMutationPlan =
  | {
      readonly contractVersion: SemanticMutationContractVersion;
      readonly status: 'rejected';
      readonly rejectedAt: 'request';
      readonly requestId?: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
      readonly diagnosticRevision: string;
    }
  | (SemanticMutationPlanBase & {
      readonly status: 'ready';
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly staged: SemanticMutationBase;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly risk: SemanticMutationRisk;
      readonly requiredVerification: readonly VerificationRequirement[];
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly [];
    })
  | (SemanticMutationPlanBase & {
      readonly status: 'rejected';
      readonly rejectedAt: SemanticMutationEarlyRejectionStage;
      readonly sourceChanges: readonly [];
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    })
  | (SemanticMutationPlanBase & {
      readonly status: 'rejected';
      readonly rejectedAt: 'fact-delta';
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly staged: SemanticMutationBase;
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    })
  | (SemanticMutationPlanBase & {
      readonly status: 'rejected';
      readonly rejectedAt: 'expectation' | 'impact';
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly staged: SemanticMutationBase;
      readonly actualDelta: FactDelta;
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    })
  | (SemanticMutationPlanBase & {
      readonly status: 'rejected';
      readonly rejectedAt: 'impact-verification';
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly staged: SemanticMutationBase;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly risk: SemanticMutationRisk;
      readonly requiredVerification: readonly VerificationRequirement[];
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    });

export type SemanticMutationTerminalStatus =
  | 'accepted'
  | 'rejected'
  | 'rolled-back'
  | 'recovery-required';

export interface SemanticMutationVerificationExecutionRef {
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly reportRevision: string;
  readonly planRevision: string;
  readonly attempted: SemanticMutationBase;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly verificationExecutionRevision: string;
}

export interface SemanticMutationResultBase {
  readonly contractVersion: SemanticMutationContractVersion;
  readonly requestId: string;
  readonly requestRevision: string;
  readonly planRevision: string;
  readonly base: SemanticMutationBase;
  readonly resultRevision: string;
}

export type SemanticMutationResult =
  | (SemanticMutationResultBase & {
      readonly status: 'accepted';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBase;
      readonly accepted: SemanticMutationBase;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly verification: SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
      readonly diagnostics: readonly [];
    })
  | (SemanticMutationResultBase & {
      readonly status: 'rejected';
      readonly transactionId?: string;
      readonly attempted?: SemanticMutationBase;
      readonly actualDelta?: FactDelta;
      readonly impact?: SemanticImpactPropagation;
      readonly sourceChanges: readonly SemanticMutationSourceChange[];
      readonly verification?: SemanticMutationVerificationExecutionRef;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    })
  | (SemanticMutationResultBase & {
      readonly status: 'rolled-back';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBase;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly verification: SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    })
  | (SemanticMutationResultBase & {
      readonly status: 'recovery-required';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBase;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChange];
      readonly verification: SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
      readonly recoveryState:
        | 'rollback-failed'
        | 'restore-validation-failed'
        | 'rebuild-failed'
        | 'concurrent-write';
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    });

export type SemanticMutationResultDraftV2 =
  SemanticMutationResult extends infer Result
    ? Result extends SemanticMutationResult
      ? Omit<Result, 'resultRevision'>
      : never
    : never;
