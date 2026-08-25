import { canonicalEquals, compareCodeUnits, sha256 } from './canonical-primitives.ts';
import {
  compileEnvironmentMaterializationPlanV1,
  parseEnvironmentMaterializationObservationV1,
  parseEnvironmentMaterializationPlanV1,
  parseEnvironmentMaterializationSpecV1,
  type EnvironmentMaterializationObservationV1,
  type EnvironmentMaterializationPlanV1,
  type EnvironmentMaterializationSpecV1
} from './environment-materialization-contract.ts';
import {
  resolveOrdinaryMainHealthLaneV1,
  type MainHealthStatusV1
} from './main-health-contract.ts';
import {
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  isVerificationActionRunnableV2,
  parseVerificationActionKeyV2,
  parseVerificationActionPlanV2,
  type VerificationActionDependencyResolutionV2,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV2,
  type VerificationActionPlanV2,
  type VerificationActionTerminalV2
} from './verification-action-contract.ts';
import type {
  VerificationProviderAvailabilityV1,
  VerificationProviderCapabilityIdV1,
  VerificationProviderCapabilityInputV1,
  VerificationProviderCapabilityV1,
  VerificationProviderIdV1,
  VerificationProviderRoleV1
} from './verification-provider-capability-contract.ts';
import { createVerificationProviderCapabilityV1, VERIFICATION_PROVIDER_CAPABILITY_SCHEMA_V1 } from './verification-provider-capability-contract.ts';

/**
 * Pure composition contract for Issue #398.
 *
 * This module owns no Action, provider, environment, MainHealth, or cleanup
 * effect.  It only accepts already-normalized owner observations and composes
 * them into a deterministic projection.  A consumer that needs to perform an
 * effect must call that owner's operation after this projection; this contract
 * never returns an executable callback, command, path, branch, or transport
 * locator.
 */

export const DEVELOPMENT_CRITICAL_PATH_SCHEMA_V1 =
  'sec-development-critical-path-v1' as const;
export const DEVELOPMENT_CRITICAL_PATH_ACTION_DECISION_SCHEMA_V1 =
  'sec-development-critical-path-action-decision-v1' as const;
export const DEVELOPMENT_CRITICAL_PATH_MAIN_DELTA_SCHEMA_V1 =
  'sec-development-critical-path-main-delta-v1' as const;
export const DEVELOPMENT_CRITICAL_PATH_RETIREMENT_SCHEMA_V1 =
  'sec-development-critical-path-retirement-v1' as const;
export const DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_SCHEMA_V1 =
  'sec-development-critical-path-static-closure-v2' as const;
export const DEVELOPMENT_CRITICAL_PATH_STATIC_ANALYSIS_READBACK_SCHEMA_V3 =
  'sec-development-critical-path-static-analysis-readback-v3' as const;
export const DEVELOPMENT_CRITICAL_PATH_STATIC_GENERATION_SCHEMA_V1 =
  'sec-development-critical-path-static-generation-v1' as const;
export const DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_PRODUCER_REVISION_V1 =
  'sec-development-critical-path-static-analyzer-v3' as const;
export const DEVELOPMENT_CRITICAL_PATH_STATIC_PROOF_SCOPE_V2 =
  'bounded-action-admission' as const;
export const DEVELOPMENT_CRITICAL_PATH_REQUIRED_PROOF_SCOPE_V1 =
  'required-proof' as const;
export const DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1 = Object.freeze([
  'public-contract',
  'authority-owner',
  'imports-consumers',
  'dependency-closure',
  'state-transitions',
  'effect-capabilities',
  'storage-current',
  'resource-budget-timeout',
  'retention-retirement',
  'dynamic-static-publication',
  'documentation-projection',
  'unknown-ledger'
] as const);

export type DevelopmentCriticalPathDigest = `sha256:${string}`;
export type DevelopmentCriticalPathStaticClosureDimensionV1 =
  typeof DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1[number];

/**
 * A dimension may only name an owner that was resolved from the canonical
 * documentation registry.  The path/domain pair is deliberately repeated in
 * the receipt so a consumer never has to trust an id-only lookup or a caller
 * supplied display name.
 */
export type DevelopmentCriticalPathCanonicalOwnerV1 = Readonly<{
  readonly recordId: string;
  readonly path: string;
  readonly domain: string;
  readonly owns: readonly string[];
}>;

/** A producer binding is an exact executable source, not a role label. */
export type DevelopmentCriticalPathStaticProducerV1 = Readonly<{
  readonly identity: string;
  readonly revision: string;
  readonly sourceDigest: DevelopmentCriticalPathDigest;
}>;

/**
 * Immutable repository-level static facts shared by every Action derived from
 * one exact tree.  This is deliberately smaller than an Action admission: it
 * contains no ActionKey, dependency terminal, scheduler lane or Effect grant.
 */
export type DevelopmentCriticalPathStaticGenerationV1 = Readonly<{
  readonly schema: typeof DEVELOPMENT_CRITICAL_PATH_STATIC_GENERATION_SCHEMA_V1;
  readonly repository: Readonly<{
    readonly headSha: string;
    readonly headTreeSha: string;
    readonly objectFormat: 'sha1' | 'sha256';
    readonly trackedPathCount: number;
    readonly trackedByteCount: number;
    readonly inventoryDigest: DevelopmentCriticalPathDigest;
  }>;
  readonly producer: DevelopmentCriticalPathStaticProducerV1;
  readonly ownerRegistryDigest: DevelopmentCriticalPathDigest;
  readonly ownerClosureDigest: DevelopmentCriticalPathDigest;
  readonly manifestDigest: DevelopmentCriticalPathDigest;
  readonly producerClosure: Readonly<{
    readonly paths: readonly string[];
    readonly digest: DevelopmentCriticalPathDigest;
  }>;
  readonly sourceInventoryDigest: DevelopmentCriticalPathDigest;
  readonly moduleGraphDigest: DevelopmentCriticalPathDigest;
  readonly generationDigest: DevelopmentCriticalPathDigest;
}>;

/**
 * Unknown is an actionable, provenance-bound ledger entry.  A bare string is
 * intentionally not representable here: it cannot tell a consumer who must
 * repair the gap, whether an old receipt is invalid, or whether an effect may
 * proceed.
 */
export type DevelopmentCriticalPathStaticUnknownV1 = Readonly<{
  readonly unknownId: DevelopmentCriticalPathDigest;
  readonly subject: string;
  readonly ownerRef: DevelopmentCriticalPathCanonicalOwnerV1;
  readonly producerRef: DevelopmentCriticalPathStaticProducerV1;
  readonly missingEdge: string;
  readonly sourceLocations: readonly string[];
  readonly inputRevision: string;
  readonly requiredAuthority: string;
  readonly blockingEffect: 'none' | 'pre-effect' | 'effect-admission' | 'required-proof';
  readonly freshness: 'fresh' | 'stale' | 'unknown';
  readonly invalidationPredicates: readonly string[];
  readonly recoveryOwner: DevelopmentCriticalPathCanonicalOwnerV1;
  readonly recovery: string;
  readonly minimumResolution: string;
}>;

/**
 * Proof scopes are intentionally disjoint.  `required` can only be produced
 * by an independently bound producer; it cannot be downgraded to bounded
 * admission by changing a string field.
 */
export type DevelopmentCriticalPathStaticProofScopeV1 = Readonly<{
  readonly kind: 'bounded-action-admission';
  readonly scopeDigest: DevelopmentCriticalPathDigest;
}> | Readonly<{
  readonly kind: 'required';
  readonly scopeDigest: DevelopmentCriticalPathDigest;
  readonly producer: DevelopmentCriticalPathStaticProducerV1;
}>;

export type DevelopmentCriticalPathRequiredProofBlockV1 = Readonly<{
  readonly kind: 'required-proof-block';
  readonly status: 'blocked';
  readonly reasonCode: 'required-proof-producer-missing';
  readonly scopeDigest: DevelopmentCriticalPathDigest;
  readonly minimumResolution: 'trusted-producer-receipt';
}>;

export const DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_PROJECTION_SCHEMA_V1 =
  'sec-development-critical-path-non-misleading-projection-v1' as const;
export const DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1 = Object.freeze([
  'observed',
  'inferred',
  'planned',
  'implemented',
  'locally-verified',
  'independently-reviewed',
  'merged',
  'new-main-readback'
] as const);
export const DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_RECEIPT_KINDS_V1 = Object.freeze([
  'observation-receipt',
  'inference-receipt',
  'plan-receipt',
  'implementation-receipt',
  'local-verification-receipt',
  'independent-review-receipt',
  'merge-receipt',
  'new-main-readback-receipt'
] as const);
export type DevelopmentCriticalPathNonMisleadingStageV1 =
  typeof DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1[number];
export type DevelopmentCriticalPathNonMisleadingReceiptKindV1 =
  typeof DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_RECEIPT_KINDS_V1[number];
export type DevelopmentCriticalPathNonMisleadingStageReceiptV1 = Readonly<{
  readonly stage: DevelopmentCriticalPathNonMisleadingStageV1;
  readonly kind: DevelopmentCriticalPathNonMisleadingReceiptKindV1;
  readonly sourceDigest: DevelopmentCriticalPathDigest;
  readonly receiptDigest: DevelopmentCriticalPathDigest;
}>;
export type DevelopmentCriticalPathNonMisleadingGapV1 = Readonly<{
  readonly gapId: DevelopmentCriticalPathDigest;
  readonly stage: DevelopmentCriticalPathNonMisleadingStageV1;
  readonly requiredKind: DevelopmentCriticalPathNonMisleadingReceiptKindV1;
  readonly reasonCode: 'missing-receipt' | 'stage-jump' | 'invalid-receipt';
  readonly requiredAuthority: string;
  readonly blockingEffect: 'completion';
  readonly minimumResolution: string;
}>;
export type DevelopmentCriticalPathNonMisleadingProjectionV1 = Readonly<{
  readonly schema: typeof DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_PROJECTION_SCHEMA_V1;
  readonly strongestStage: DevelopmentCriticalPathNonMisleadingStageV1 | 'none';
  readonly requiredStage: DevelopmentCriticalPathNonMisleadingStageV1;
  readonly receipts: readonly DevelopmentCriticalPathNonMisleadingStageReceiptV1[];
  readonly gaps: readonly DevelopmentCriticalPathNonMisleadingGapV1[];
  readonly completion: 'incomplete' | 'complete';
  readonly projectionDigest: DevelopmentCriticalPathDigest;
}>;

/** Exact canonical owner projection used by the analyzer and parser. */
export type DevelopmentCriticalPathOwnerRegistryV1 = Readonly<{
  readonly digest: DevelopmentCriticalPathDigest;
  readonly ownerClosureDigest: DevelopmentCriticalPathDigest;
  readonly recordsDigest: DevelopmentCriticalPathDigest;
  readonly records: readonly DevelopmentCriticalPathCanonicalOwnerV1[];
}>;

/**
 * Exact base-to-head subject used by the required producer-bound proof.
 *
 * The static dimensions above deliberately remain bounded projections.  This
 * subject is the separate, mechanically reproducible whole-delta producer:
 * its file changes come from Git's machine records and its owner/consumer
 * graph is closed by a deterministic fixed-point calculation.  A path regex
 * can never manufacture one of these records.
 */
export const DEVELOPMENT_CRITICAL_PATH_WHOLE_DELTA_SCHEMA_V1 =
  'sec-development-critical-path-whole-delta-v1' as const;
export const DEVELOPMENT_CRITICAL_PATH_WHOLE_DELTA_PRODUCER_REVISION_V1 =
  'sec-development-critical-path-whole-delta-producer-v1' as const;
export type DevelopmentCriticalPathWholeDeltaScopeV1 =
  | 'bounded-action-admission'
  | 'required-producer-bound';
export type DevelopmentCriticalPathWholeDeltaChangeStatusV1 =
  | 'added'
  | 'changed'
  | 'removed'
  | 'renamed'
  | 'copied';
export type DevelopmentCriticalPathWholeDeltaRevisionFactV1 = Readonly<{
  readonly commitSha: string;
  readonly treeSha: string;
  readonly inventoryDigest: DevelopmentCriticalPathDigest;
}>;
export type DevelopmentCriticalPathWholeDeltaChangeV1 = Readonly<{
  readonly changeDigest: DevelopmentCriticalPathDigest;
  readonly status: DevelopmentCriticalPathWholeDeltaChangeStatusV1;
  readonly path: string;
  readonly previousPath: string | null;
  readonly baseMode: string | null;
  readonly headMode: string | null;
  readonly baseObjectId: string | null;
  readonly headObjectId: string | null;
  readonly baseByteSize: number | null;
  readonly headByteSize: number | null;
}>;
export type DevelopmentCriticalPathWholeDeltaConsumerV1 = Readonly<{
  readonly consumerRef: string;
  readonly sourceLocations: readonly string[];
  readonly inputDigest: DevelopmentCriticalPathDigest;
  readonly required: boolean;
  readonly consumerDigest: DevelopmentCriticalPathDigest;
}>;
export type DevelopmentCriticalPathWholeDeltaOwnerProjectionV1 = Readonly<{
  readonly owner: DevelopmentCriticalPathCanonicalOwnerV1;
  readonly producer: DevelopmentCriticalPathStaticProducerV1;
  readonly consumerRefs: readonly string[];
  readonly required: boolean;
  readonly projectionDigest: DevelopmentCriticalPathDigest;
}>;
export type DevelopmentCriticalPathWholeDeltaEdgeV1 = Readonly<{
  readonly edgeDigest: DevelopmentCriticalPathDigest;
  readonly kind: 'owner' | 'producer' | 'consumer';
  readonly fromRef: string;
  readonly toRef: string;
  readonly required: boolean;
}>;
export type DevelopmentCriticalPathWholeDeltaSccV1 = Readonly<{
  readonly sccDigest: DevelopmentCriticalPathDigest;
  readonly members: readonly string[];
}>;
export type DevelopmentCriticalPathWholeDeltaBlockV1 = Readonly<{
  readonly kind: 'whole-delta-block';
  readonly reasonCode:
    | 'base-fact-missing'
    | 'changed-record-mismatch'
    | 'owner-consumer-edge-missing'
    | 'required-owner-projection-missing'
    | 'required-producer-fixed-point-unclosed'
    | 'presentation-adapter-unavailable';
  readonly requiredAuthority: string;
  readonly blockingEffect: 'none' | 'pre-effect' | 'effect-admission' | 'required-proof';
  readonly missingEdges: readonly string[];
  readonly minimumResolution: string;
  readonly blockDigest: DevelopmentCriticalPathDigest;
}>;
export type DevelopmentCriticalPathWholeDeltaInputV1 = Readonly<{
  readonly scope: DevelopmentCriticalPathWholeDeltaScopeV1;
  readonly base: DevelopmentCriticalPathWholeDeltaRevisionFactV1 | null;
  readonly head: DevelopmentCriticalPathWholeDeltaRevisionFactV1;
  readonly changes: readonly DevelopmentCriticalPathWholeDeltaChangeV1[];
  readonly requiredOwners: readonly DevelopmentCriticalPathCanonicalOwnerV1[];
  readonly ownerProjections: readonly DevelopmentCriticalPathWholeDeltaOwnerProjectionV1[];
  readonly consumers: readonly DevelopmentCriticalPathWholeDeltaConsumerV1[];
  readonly producer: DevelopmentCriticalPathStaticProducerV1;
  readonly unknowns: readonly DevelopmentCriticalPathStaticUnknownV1[];
  readonly nonMisleadingProjection?: DevelopmentCriticalPathNonMisleadingProjectionV1;
}>;
export type DevelopmentCriticalPathWholeDeltaSubjectV1 = Readonly<{
  readonly schema: typeof DEVELOPMENT_CRITICAL_PATH_WHOLE_DELTA_SCHEMA_V1;
  readonly scope: DevelopmentCriticalPathWholeDeltaScopeV1;
  readonly base: DevelopmentCriticalPathWholeDeltaRevisionFactV1 | null;
  readonly head: DevelopmentCriticalPathWholeDeltaRevisionFactV1;
  readonly changes: readonly DevelopmentCriticalPathWholeDeltaChangeV1[];
  readonly requiredOwners: readonly DevelopmentCriticalPathCanonicalOwnerV1[];
  readonly ownerProjections: readonly DevelopmentCriticalPathWholeDeltaOwnerProjectionV1[];
  readonly consumers: readonly DevelopmentCriticalPathWholeDeltaConsumerV1[];
  readonly graphNodes: readonly string[];
  readonly edges: readonly DevelopmentCriticalPathWholeDeltaEdgeV1[];
  readonly sccs: readonly DevelopmentCriticalPathWholeDeltaSccV1[];
  readonly fixedPointDigest: DevelopmentCriticalPathDigest;
  readonly fixedPointClosed: boolean;
  readonly producer: DevelopmentCriticalPathStaticProducerV1;
  readonly unknowns: readonly DevelopmentCriticalPathStaticUnknownV1[];
  readonly nonMisleadingProjection?: DevelopmentCriticalPathNonMisleadingProjectionV1;
  readonly status: 'bounded-closed' | 'required-closed' | 'blocked';
  readonly blocker: DevelopmentCriticalPathWholeDeltaBlockV1 | null;
  readonly subjectDigest: DevelopmentCriticalPathDigest;
}>;

export type DevelopmentCriticalPathStaticAnalysisReadbackV2 = Readonly<{
  schema: typeof DEVELOPMENT_CRITICAL_PATH_STATIC_ANALYSIS_READBACK_SCHEMA_V3;
  /** Machine-enforced claim boundary; never a repository-wide completeness proof. */
  proofScope: DevelopmentCriticalPathStaticProofScopeV1;
  producer: DevelopmentCriticalPathStaticProducerV1;
  staticGeneration: DevelopmentCriticalPathStaticGenerationV1;
  repository: Readonly<{
    headSha: string;
    headTreeSha: string;
    objectFormat: 'sha1' | 'sha256';
    /** The analyzed Git object tree is internally closed; not a worktree-clean observation. */
    trackedClean: true;
    trackedPathCount: number;
    trackedByteCount: number;
    inventoryDigest: DevelopmentCriticalPathDigest;
  }>;
  manifest: Readonly<{
    path: string;
    digest: DevelopmentCriticalPathDigest;
    authorityRefsDigest: DevelopmentCriticalPathDigest;
    ownedPathsDigest: DevelopmentCriticalPathDigest;
    forbiddenPathsDigest: DevelopmentCriticalPathDigest;
  }>;
  ownerRegistry: DevelopmentCriticalPathOwnerRegistryV1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: DevelopmentCriticalPathDigest;
  actionPlanClosureDigest: DevelopmentCriticalPathDigest;
  sourceInventoryDigest: DevelopmentCriticalPathDigest;
  moduleGraphDigest: DevelopmentCriticalPathDigest;
  unresolvedModuleFiles: readonly string[];
  /** Required exact base/head/delta producer subject; missing facts are represented by typed Unknowns. */
  wholeDelta: DevelopmentCriticalPathWholeDeltaSubjectV1;
  dimensions: readonly Readonly<{
    dimension: DevelopmentCriticalPathStaticClosureDimensionV1;
    claim: Readonly<{
      owner: DevelopmentCriticalPathCanonicalOwnerV1;
      producer: DevelopmentCriticalPathStaticProducerV1;
      subjectDigest: DevelopmentCriticalPathDigest;
    }>;
    inputDigest: DevelopmentCriticalPathDigest;
    /**
     * Exhaustion of this producer's declared bounded census only. It is not a
     * repository-wide defect-class or canonical-owner completeness claim.
     */
    coverage: 'bounded-census-complete' | 'unknown';
    /** `candidate-hint` can never by itself justify complete coverage. */
    coverageBasis: 'producer-exact' | 'candidate-hint';
    stopCondition: 'tracked-owner-surface-exhausted' | 'module-graph-unresolved' | 'analyzer-failed';
    defectClasses: readonly string[];
    unknowns: readonly DevelopmentCriticalPathStaticUnknownV1[];
    evidenceDigest: DevelopmentCriticalPathDigest;
  }>[];
  openDefectClasses: readonly string[];
  unknowns: readonly DevelopmentCriticalPathStaticUnknownV1[];
  readbackDigest: DevelopmentCriticalPathDigest;
}>;

export type DevelopmentCriticalPathStaticClosureV1 = Readonly<{
  schema: typeof DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_SCHEMA_V1;
  /** Inherited from the analyzer and included in every receipt digest. */
  proofScope: DevelopmentCriticalPathStaticProofScopeV1;
  producer: DevelopmentCriticalPathStaticProducerV1;
  actionPlan: VerificationActionPlanV2;
  analysisReadback: DevelopmentCriticalPathStaticAnalysisReadbackV2;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: DevelopmentCriticalPathDigest;
  actionPlanClosureDigest: DevelopmentCriticalPathDigest;
  operationSemanticDigest: VerificationActionKeyDigest;
  environmentDigest: DevelopmentCriticalPathDigest;
  analysisStage: 'plan-structural' | 'effect-admission';
  dependencyEvidence: readonly VerificationActionDependencyResolutionV2[];
  subjectDigest: DevelopmentCriticalPathDigest;
  trackedInputDigest: DevelopmentCriticalPathDigest;
  dimensions: readonly Readonly<{
    dimension: DevelopmentCriticalPathStaticClosureDimensionV1;
    inputDigest: DevelopmentCriticalPathDigest;
    /**
     * `bounded-verified-complete` adds exact dependency-terminal evidence to the
     * bounded census; it does not promote V1 into a whole-system proof.
     */
    coverage: 'bounded-census-complete' | 'bounded-verified-complete' | 'unknown';
    coverageBasis: 'producer-exact' | 'candidate-hint';
    stopCondition: 'tracked-owner-surface-exhausted' | 'module-graph-unresolved' | 'analyzer-failed';
    evidenceDigest: DevelopmentCriticalPathDigest;
  }>[];
  openDefectClasses: readonly string[];
  unknowns: readonly DevelopmentCriticalPathStaticUnknownV1[];
  /** Status remains distinct from the proof-scope discriminant. */
  status: 'bounded-closed' | 'required-closed' | 'blocked';
  invalidationDigest: DevelopmentCriticalPathDigest;
  retirement: 'action-terminal-or-binding-drift';
  closureDigest: DevelopmentCriticalPathDigest;
}>;

export type DevelopmentCriticalPathActionDispositionV1 =
  | 'reuse-pass'
  | 'reuse-failure'
  | 'join'
  | 'execute'
  | 'blocked';

export type DevelopmentCriticalPathActionBlockReasonV1 =
  | 'pre-effect-static-closure-blocked'
  | 'action-observation-unknown'
  | 'action-terminal-not-reusable'
  | 'in-flight-not-authenticated'
  | 'action-dependencies-not-passed'
  | 'main-delta-unknown'
  | 'main-health-invalid'
  | 'main-health-ineligible'
  | 'environment-unknown'
  | 'environment-blocked'
  | 'provider-unresolved'
  | 'provider-unavailable'
  | 'provider-degraded'
  | 'retirement-unknown';

export type DevelopmentCriticalPathActionObservationV1 = Readonly<
  | {
      readonly actionKey: VerificationActionKeyDigest;
      readonly state: 'missing';
    }
  | {
      readonly actionKey: VerificationActionKeyDigest;
      readonly state: 'stale';
      readonly observationDigest: DevelopmentCriticalPathDigest;
      readonly reasonCode: string;
    }
  | {
      readonly actionKey: VerificationActionKeyDigest;
      readonly state: 'terminal';
      readonly observationDigest: DevelopmentCriticalPathDigest;
      readonly terminal: VerificationActionTerminalV2;
    }
  | {
      readonly actionKey: VerificationActionKeyDigest;
      readonly state: 'in-flight';
      readonly claimDigest: DevelopmentCriticalPathDigest;
      readonly authenticated: boolean;
    }
  | {
      readonly actionKey: VerificationActionKeyDigest;
      readonly state: 'unknown';
      readonly observationDigest: DevelopmentCriticalPathDigest | null;
      readonly reasonCode: string;
    }
>;

export type DevelopmentCriticalPathActionDecisionV1 = Readonly<{
  schema: typeof DEVELOPMENT_CRITICAL_PATH_ACTION_DECISION_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: DevelopmentCriticalPathDigest;
  disposition: DevelopmentCriticalPathActionDispositionV1;
  terminal: VerificationActionTerminalV2 | null;
  observationDigest: DevelopmentCriticalPathDigest | null;
  reasonCode: string;
  decisionDigest: DevelopmentCriticalPathDigest;
}>;

export type DevelopmentCriticalPathRevisionV1 = string | null;

/**
 * Only stable semantic closure is accepted here.  In particular, this type
 * intentionally has no branch, PR, wall-clock, process, absolute temp path,
 * or transport fields.  A null identity is an unresolved fact and therefore
 * cannot silently become a tree-equivalent reuse.
 */
export type DevelopmentCriticalPathMainIdentityV1 = Readonly<{
  readonly treeSha: string | null;
  readonly policyRevision: DevelopmentCriticalPathRevisionV1;
  readonly toolchainRevision: DevelopmentCriticalPathRevisionV1;
  readonly providerRevision: DevelopmentCriticalPathRevisionV1;
  readonly environmentRevision: DevelopmentCriticalPathRevisionV1;
  readonly closureDigest: DevelopmentCriticalPathDigest | null;
  readonly unknowns: readonly string[];
}>;

export type DevelopmentCriticalPathMainDeltaDispositionV1 =
  | 'tree-equivalent'
  | 'changed'
  | 'blocked';

export type DevelopmentCriticalPathMainDeltaReasonV1 =
  | 'tree-equivalent-closure-equal'
  | 'tree-changed'
  | 'policy-revision-changed'
  | 'toolchain-revision-changed'
  | 'provider-revision-changed'
  | 'environment-revision-changed'
  | 'closure-changed'
  | 'unknown-identity';

export type DevelopmentCriticalPathMainDeltaV1 = Readonly<{
  schema: typeof DEVELOPMENT_CRITICAL_PATH_MAIN_DELTA_SCHEMA_V1;
  disposition: DevelopmentCriticalPathMainDeltaDispositionV1;
  reasonCode: DevelopmentCriticalPathMainDeltaReasonV1;
  mainHealthRequired: boolean;
  main: DevelopmentCriticalPathMainIdentityV1;
  candidate: DevelopmentCriticalPathMainIdentityV1;
  decisionDigest: DevelopmentCriticalPathDigest;
}>;

export type DevelopmentCriticalPathProviderFactV1 = Readonly<{
  /** Whether this composition requires the provider to perform an effect. */
  readonly required: boolean;
  readonly capability: VerificationProviderCapabilityV1 | null;
  readonly unknowns: readonly string[];
}>;

export type DevelopmentCriticalPathEnvironmentFactV1 = Readonly<{
  readonly plan: EnvironmentMaterializationPlanV1 | null;
  /** Exact environment-owner inputs used to recompute and validate `plan`. */
  readonly spec: EnvironmentMaterializationSpecV1 | null;
  readonly observation: EnvironmentMaterializationObservationV1 | null;
  readonly environmentRevision: DevelopmentCriticalPathRevisionV1;
  readonly unknowns: readonly string[];
}>;

export type DevelopmentCriticalPathRetirementOwnerKindV1 =
  | 'generated-state'
  | 'provider'
  | 'worktree'
  | 'ref'
  | 'cache';

export type DevelopmentCriticalPathRetirementOwnerStateV1 =
  | 'settled'
  | 'eligible-residue'
  | 'blocked'
  | 'unknown';

/**
 * A narrow projection of an existing retirement owner's receipt.  The owner
 * remains responsible for the receipt schema and physical effect; the spine
 * only joins stable receipt identities and state.  `owner` is a semantic owner
 * identity, never a path or process locator.
 */
export type DevelopmentCriticalPathRetirementOwnerFactV1 = Readonly<{
  readonly kind: DevelopmentCriticalPathRetirementOwnerKindV1;
  readonly owner: string;
  readonly state: DevelopmentCriticalPathRetirementOwnerStateV1;
  readonly receiptDigest: DevelopmentCriticalPathDigest | null;
  readonly eligibleResidue: readonly string[];
  readonly unknowns: readonly string[];
}>;

export type DevelopmentCriticalPathRetirementDispositionV1 =
  | 'operational-terminal'
  | 'gc-pending'
  | 'blocked';

export type DevelopmentCriticalPathRetirementDecisionV1 = Readonly<{
  schema: typeof DEVELOPMENT_CRITICAL_PATH_RETIREMENT_SCHEMA_V1;
  disposition: DevelopmentCriticalPathRetirementDispositionV1;
  ownerReceipts: readonly DevelopmentCriticalPathDigest[];
  eligibleResidue: readonly string[];
  activeNamespaces: readonly string[];
  blockers: readonly string[];
  unknowns: readonly string[];
  decisionDigest: DevelopmentCriticalPathDigest;
}>;

export type DevelopmentCriticalPathMainHealthFactV1 = Readonly<{
  readonly status: MainHealthStatusV1;
  readonly allowed: boolean;
  readonly observationValidity: 'valid' | 'invalid';
  readonly reasonCode:
    | 'invalid-ledger'
    | 'ledger-expired'
    | 'ledger-identity-drift'
    | 'lane-eligible'
    | 'lane-ineligible';
  readonly healthRevision: DevelopmentCriticalPathDigest | null;
  readonly ledgerDigest: DevelopmentCriticalPathDigest | null;
  readonly unknowns: readonly string[];
}>;

export type DevelopmentCriticalPathMainHealthObservationV1 = Readonly<{
  readonly ledger: unknown;
  readonly now: string;
  readonly expectedRepository: string;
  readonly expectedDefaultBranch: string;
  readonly expectedMainSha: string;
  readonly expectedMainTreeSha: string;
  readonly expectedTrustRevision: string;
}>;

export type DevelopmentCriticalPathProjectionV1 = Readonly<{
  schema: typeof DEVELOPMENT_CRITICAL_PATH_SCHEMA_V1;
  staticClosure: DevelopmentCriticalPathStaticClosureV1;
  action: DevelopmentCriticalPathActionDecisionV1;
  mainDelta: DevelopmentCriticalPathMainDeltaV1;
  retirement: DevelopmentCriticalPathRetirementDecisionV1 | null;
  overallDisposition: DevelopmentCriticalPathActionDispositionV1;
  blockers: readonly string[];
  unknowns: readonly string[];
  semanticDigest: DevelopmentCriticalPathDigest;
}>;

type OrdinaryRecord = Record<string, unknown>;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const KEBAB = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const PROVIDER_AVAILABILITIES = new Set<VerificationProviderAvailabilityV1>([
  'available', 'unavailable', 'degraded', 'unknown'
]);
const ACTION_STATES = new Set(['missing', 'stale', 'terminal', 'in-flight', 'unknown']);
const RETIREMENT_KINDS = new Set<DevelopmentCriticalPathRetirementOwnerKindV1>([
  'generated-state', 'provider', 'worktree', 'ref', 'cache'
]);
const RETIREMENT_STATES = new Set<DevelopmentCriticalPathRetirementOwnerStateV1>([
  'settled', 'eligible-residue', 'blocked', 'unknown'
]);
function fail(label: string, message: string): never {
  throw new Error(`DevelopmentCriticalPath ${label} ${message}`);
}

function record(value: unknown, label: string): OrdinaryRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail(label, 'must be a plain object.');
  }
  return value as OrdinaryRecord;
}

function exactKeys(value: OrdinaryRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const wanted = [...expected].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(label, `must contain exactly: ${wanted.join(', ')}.`);
  }
}

function boundedText(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(label, 'must be bounded canonical text.');
  }
  return value;
}

function optionalRevision(value: unknown, label: string): string | null {
  if (value === null) return null;
  return boundedText(value, label);
}

function digest(value: unknown, label: string): DevelopmentCriticalPathDigest {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(label, 'must be a SHA-256 digest.');
  return value as DevelopmentCriticalPathDigest;
}

function gitSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !GIT_SHA.test(value)) fail(label, 'must be a lowercase Git SHA.');
  return value;
}

function optionalDigest(value: unknown, label: string): DevelopmentCriticalPathDigest | null {
  if (value === null) return null;
  return digest(value, label);
}

function kebab(value: unknown, label: string): string {
  const text = boundedText(value, label, 128);
  if (!KEBAB.test(text)) fail(label, 'must be a bounded kebab-case code.');
  return text;
}

function canonicalTextList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(label, 'must be an array.');
  const values = value.map((entry, index) => boundedText(entry, `${label}[${index}]`, 256));
  const sorted = [...values].sort(compareCodeUnits);
  if (new Set(sorted).size !== sorted.length) fail(label, 'must not contain duplicates.');
  return Object.freeze(sorted);
}

function canonicalDigestList(value: unknown, label: string): readonly DevelopmentCriticalPathDigest[] {
  if (!Array.isArray(value)) fail(label, 'must be an array.');
  const values = value.map((entry, index) => digest(entry, `${label}[${index}]`));
  const sorted = [...values].sort(compareCodeUnits);
  if (new Set(sorted).size !== sorted.length) fail(label, 'must not contain duplicates.');
  return Object.freeze(sorted);
}

function canonicalStaticProducer(
  value: unknown,
  label: string
): DevelopmentCriticalPathStaticProducerV1 {
  const input = record(value, label);
  exactKeys(input, ['identity', 'revision', 'sourceDigest'], label);
  return Object.freeze({
    identity: boundedText(input.identity, `${label}.identity`),
    revision: boundedText(input.revision, `${label}.revision`),
    sourceDigest: digest(input.sourceDigest, `${label}.sourceDigest`)
  });
}

function canonicalOwner(
  value: unknown,
  label: string
): DevelopmentCriticalPathCanonicalOwnerV1 {
  const input = record(value, label);
  exactKeys(input, ['recordId', 'path', 'domain', 'owns'], label);
  const owns = canonicalTextList(input.owns, `${label}.owns`);
  return Object.freeze({
    recordId: boundedText(input.recordId, `${label}.recordId`, 256),
    path: boundedText(input.path, `${label}.path`, 1024),
    domain: boundedText(input.domain, `${label}.domain`, 256),
    owns
  });
}

function canonicalOwnerRegistry(
  value: unknown,
  label: string
): DevelopmentCriticalPathOwnerRegistryV1 {
  const input = record(value, label);
  exactKeys(input, ['digest', 'ownerClosureDigest', 'recordsDigest', 'records'], label);
  const digestValue = digest(input.digest, `${label}.digest`);
  const ownerClosureDigest = digest(input.ownerClosureDigest, `${label}.ownerClosureDigest`);
  const recordsDigest = digest(input.recordsDigest, `${label}.recordsDigest`);
  if (!Array.isArray(input.records)) fail(`${label}.records`, 'must be an array.');
  const records = Object.freeze(input.records.map((entry, index) =>
    canonicalOwner(entry, `${label}.records[${index}]`)
  ));
  const sorted = [...records].sort((left, right) => compareCodeUnits(left.recordId, right.recordId));
  if (sorted.some((entry, index) => entry !== records[index])) {
    fail(`${label}.records`, 'must be in canonical record-id order.');
  }
  if (new Set(records.map(({ recordId }) => recordId)).size !== records.length) {
    fail(`${label}.records`, 'must not contain duplicate record ids.');
  }
  if (recordsDigest !== sha256(records)) {
    fail(`${label}.recordsDigest`, 'must equal the canonical owner-record material digest.');
  }
  return Object.freeze({ digest: digestValue, ownerClosureDigest, recordsDigest, records });
}

const WHOLE_DELTA_GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const WHOLE_DELTA_CHANGE_STATUSES = Object.freeze([
  'added', 'changed', 'removed', 'renamed', 'copied'
] as const);

function wholeDeltaGitObject(value: unknown, label: string): string {
  if (typeof value !== 'string' || !WHOLE_DELTA_GIT_OBJECT.test(value)) {
    fail(label, 'must be one full lowercase SHA-1 or SHA-256 Git object id.');
  }
  return value;
}

function wholeDeltaPath(value: unknown, label: string): string {
  const result = boundedText(value, label, 4096);
  if (result.includes('\\') || result.startsWith('/') || result.startsWith('../')
      || result.includes('/../') || result.includes('/./') || result === '.') {
    fail(label, 'must be one canonical repository-relative POSIX path.');
  }
  return result;
}

function nullableWholeDeltaGitObject(value: unknown, label: string): string | null {
  return value === null ? null : wholeDeltaGitObject(value, label);
}

function nullableWholeDeltaPath(value: unknown, label: string): string | null {
  return value === null ? null : wholeDeltaPath(value, label);
}

function nullableWholeDeltaMode(value: unknown, label: string): string | null {
  if (value === null) return null;
  const result = boundedText(value, label, 32);
  if (!/^\d{6}$/u.test(result)) fail(label, 'must be a canonical Git file mode.');
  return result;
}

function nullableWholeDeltaByteSize(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(label, 'must be a non-negative safe integer or null.');
  }
  return value;
}

function canonicalWholeDeltaRevisionFact(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaRevisionFactV1 | null {
  if (value === null) return null;
  const input = record(value, label);
  exactKeys(input, ['commitSha', 'treeSha', 'inventoryDigest'], label);
  return Object.freeze({
    commitSha: wholeDeltaGitObject(input.commitSha, `${label}.commitSha`),
    treeSha: wholeDeltaGitObject(input.treeSha, `${label}.treeSha`),
    inventoryDigest: digest(input.inventoryDigest, `${label}.inventoryDigest`)
  });
}

function canonicalWholeDeltaChange(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaChangeV1 {
  const input = record(value, label);
  exactKeys(input, [
    'changeDigest', 'status', 'path', 'previousPath', 'baseMode', 'headMode',
    'baseObjectId', 'headObjectId', 'baseByteSize', 'headByteSize'
  ], label);
  if (!WHOLE_DELTA_CHANGE_STATUSES.includes(input.status as DevelopmentCriticalPathWholeDeltaChangeStatusV1)) {
    fail(`${label}.status`, 'must be an exact Git add/change/delete/rename/copy status.');
  }
  const status = input.status as DevelopmentCriticalPathWholeDeltaChangeStatusV1;
  const path = wholeDeltaPath(input.path, `${label}.path`);
  const previousPath = nullableWholeDeltaPath(input.previousPath, `${label}.previousPath`);
  if ((status === 'renamed' || status === 'copied') !== (previousPath !== null)) {
    fail(label, 'rename/copy records must have exactly one previousPath; other statuses must not.');
  }
  if (previousPath !== null && previousPath === path) fail(label, 'previousPath must differ from path.');
  const material = Object.freeze({
    status,
    path,
    previousPath,
    baseMode: nullableWholeDeltaMode(input.baseMode, `${label}.baseMode`),
    headMode: nullableWholeDeltaMode(input.headMode, `${label}.headMode`),
    baseObjectId: nullableWholeDeltaGitObject(input.baseObjectId, `${label}.baseObjectId`),
    headObjectId: nullableWholeDeltaGitObject(input.headObjectId, `${label}.headObjectId`),
    baseByteSize: nullableWholeDeltaByteSize(input.baseByteSize, `${label}.baseByteSize`),
    headByteSize: nullableWholeDeltaByteSize(input.headByteSize, `${label}.headByteSize`)
  });
  const changeDigest = digest(input.changeDigest, `${label}.changeDigest`);
  if (changeDigest !== sha256(material)) fail(`${label}.changeDigest`, 'must equal canonical change material digest.');
  return Object.freeze({ changeDigest, ...material });
}

function canonicalWholeDeltaConsumer(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaConsumerV1 {
  const input = record(value, label);
  exactKeys(input, ['consumerRef', 'sourceLocations', 'inputDigest', 'required', 'consumerDigest'], label);
  const consumerRef = boundedText(input.consumerRef, `${label}.consumerRef`, 2048);
  if (!Array.isArray(input.sourceLocations)) fail(`${label}.sourceLocations`, 'must be an array.');
  const sourceLocations = input.sourceLocations.map((entry, index) =>
    wholeDeltaPath(entry, `${label}.sourceLocations[${index}]`)
  );
  const canonicalLocations = [...sourceLocations].sort(compareCodeUnits);
  if (JSON.stringify(sourceLocations) !== JSON.stringify(canonicalLocations)
      || new Set(sourceLocations).size !== sourceLocations.length) {
    fail(`${label}.sourceLocations`, 'must be sorted and unique.');
  }
  if (typeof input.required !== 'boolean') fail(`${label}.required`, 'must be boolean.');
  const material = Object.freeze({
    consumerRef,
    sourceLocations: Object.freeze(sourceLocations),
    inputDigest: digest(input.inputDigest, `${label}.inputDigest`),
    required: input.required
  });
  const consumerDigest = digest(input.consumerDigest, `${label}.consumerDigest`);
  if (consumerDigest !== sha256(material)) fail(`${label}.consumerDigest`, 'must equal canonical consumer material digest.');
  return Object.freeze({ consumerDigest, ...material });
}

function canonicalWholeDeltaOwnerProjection(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaOwnerProjectionV1 {
  const input = record(value, label);
  exactKeys(input, ['owner', 'producer', 'consumerRefs', 'required', 'projectionDigest'], label);
  const owner = canonicalOwner(input.owner, `${label}.owner`);
  const producer = canonicalStaticProducer(input.producer, `${label}.producer`);
  const consumerRefs = canonicalTextList(input.consumerRefs, `${label}.consumerRefs`);
  if (typeof input.required !== 'boolean') fail(`${label}.required`, 'must be boolean.');
  const material = Object.freeze({ owner, producer, consumerRefs, required: input.required });
  const projectionDigest = digest(input.projectionDigest, `${label}.projectionDigest`);
  if (projectionDigest !== sha256(material)) {
    fail(`${label}.projectionDigest`, 'must equal canonical owner projection material digest.');
  }
  return Object.freeze({ projectionDigest, ...material });
}

function canonicalWholeDeltaEdge(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaEdgeV1 {
  const input = record(value, label);
  exactKeys(input, ['edgeDigest', 'kind', 'fromRef', 'toRef', 'required'], label);
  if (input.kind !== 'owner' && input.kind !== 'producer' && input.kind !== 'consumer') {
    fail(`${label}.kind`, 'must be owner, producer, or consumer.');
  }
  if (typeof input.required !== 'boolean') fail(`${label}.required`, 'must be boolean.');
  const material = Object.freeze({
    kind: input.kind as DevelopmentCriticalPathWholeDeltaEdgeV1['kind'],
    fromRef: boundedText(input.fromRef, `${label}.fromRef`, 2048),
    toRef: boundedText(input.toRef, `${label}.toRef`, 2048),
    required: input.required as boolean
  });
  const edgeDigest = digest(input.edgeDigest, `${label}.edgeDigest`);
  if (edgeDigest !== sha256(material)) fail(`${label}.edgeDigest`, 'must equal canonical edge material digest.');
  return Object.freeze({ edgeDigest, ...material });
}

function canonicalWholeDeltaScc(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaSccV1 {
  const input = record(value, label);
  exactKeys(input, ['sccDigest', 'members'], label);
  const members = canonicalTextList(input.members, `${label}.members`);
  const sccDigest = digest(input.sccDigest, `${label}.sccDigest`);
  if (sccDigest !== sha256(members)) fail(`${label}.sccDigest`, 'must equal canonical SCC member digest.');
  return Object.freeze({ sccDigest, members });
}

function canonicalWholeDeltaBlock(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaBlockV1 | null {
  if (value === null) return null;
  const input = record(value, label);
  exactKeys(input, [
    'kind', 'reasonCode', 'requiredAuthority', 'blockingEffect', 'missingEdges',
    'minimumResolution', 'blockDigest'
  ], label);
  if (input.kind !== 'whole-delta-block') fail(`${label}.kind`, 'is invalid.');
  const reasonCodes = [
    'base-fact-missing', 'changed-record-mismatch', 'owner-consumer-edge-missing', 'required-owner-projection-missing',
    'required-producer-fixed-point-unclosed', 'presentation-adapter-unavailable'
  ] as const;
  if (!reasonCodes.includes(input.reasonCode as typeof reasonCodes[number])) {
    fail(`${label}.reasonCode`, 'is invalid.');
  }
  if (input.blockingEffect !== 'none' && input.blockingEffect !== 'pre-effect'
      && input.blockingEffect !== 'effect-admission' && input.blockingEffect !== 'required-proof') {
    fail(`${label}.blockingEffect`, 'is invalid.');
  }
  const missingEdges = canonicalTextList(input.missingEdges, `${label}.missingEdges`);
  const material = Object.freeze({
    kind: 'whole-delta-block' as const,
    reasonCode: input.reasonCode as DevelopmentCriticalPathWholeDeltaBlockV1['reasonCode'],
    requiredAuthority: boundedText(input.requiredAuthority, `${label}.requiredAuthority`),
    blockingEffect: input.blockingEffect as DevelopmentCriticalPathWholeDeltaBlockV1['blockingEffect'],
    missingEdges,
    minimumResolution: boundedText(input.minimumResolution, `${label}.minimumResolution`)
  });
  const blockDigest = digest(input.blockDigest, `${label}.blockDigest`);
  if (blockDigest !== sha256(material)) fail(`${label}.blockDigest`, 'must equal canonical block material digest.');
  return Object.freeze({ blockDigest, ...material });
}

function wholeDeltaProducerNode(producer: DevelopmentCriticalPathStaticProducerV1): string {
  return `producer:${producer.identity}@${producer.revision}`;
}

function wholeDeltaOwnerNode(owner: DevelopmentCriticalPathCanonicalOwnerV1): string {
  return `owner:${owner.recordId}`;
}

function wholeDeltaSubjectNode(): string {
  return 'subject:whole-delta';
}

function wholeDeltaConsumerNode(consumerRef: string): string {
  return `consumer:${consumerRef}`;
}

function deriveWholeDeltaEdges(
  producer: DevelopmentCriticalPathStaticProducerV1,
  ownerProjections: readonly DevelopmentCriticalPathWholeDeltaOwnerProjectionV1[],
  consumers: readonly DevelopmentCriticalPathWholeDeltaConsumerV1[]
): readonly DevelopmentCriticalPathWholeDeltaEdgeV1[] {
  const materials: Array<Omit<DevelopmentCriticalPathWholeDeltaEdgeV1, 'edgeDigest'>> = [];
  for (const projection of ownerProjections) {
    materials.push({
      kind: 'producer',
      fromRef: wholeDeltaProducerNode(producer),
      toRef: wholeDeltaOwnerNode(projection.owner),
      required: projection.required
    });
    for (const consumerRef of projection.consumerRefs) {
      materials.push({
        kind: 'owner',
        fromRef: wholeDeltaOwnerNode(projection.owner),
        toRef: wholeDeltaConsumerNode(consumerRef),
        required: projection.required
      });
    }
  }
  for (const consumer of consumers) {
    materials.push({
      kind: 'consumer',
      fromRef: wholeDeltaConsumerNode(consumer.consumerRef),
      toRef: wholeDeltaSubjectNode(),
      required: consumer.required
    });
  }
  const edges = materials.map((material) => Object.freeze({
    edgeDigest: sha256(material) as DevelopmentCriticalPathDigest,
    ...material
  }));
  const sorted = edges.sort((left, right) => compareCodeUnits(left.edgeDigest, right.edgeDigest));
  if (new Set(sorted.map(({ edgeDigest }) => edgeDigest)).size !== sorted.length) {
    fail('whole-delta edges', 'derived duplicate edge.');
  }
  return Object.freeze(sorted);
}

function deriveWholeDeltaSccs(
  nodes: readonly string[],
  edges: readonly DevelopmentCriticalPathWholeDeltaEdgeV1[]
): readonly DevelopmentCriticalPathWholeDeltaSccV1[] {
  const sortedNodes = [...nodes].sort(compareCodeUnits);
  const adjacency = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const node of sortedNodes) {
    adjacency.set(node, []);
    reverse.set(node, []);
  }
  for (const edge of edges) {
    if (!adjacency.has(edge.fromRef) || !adjacency.has(edge.toRef)) {
      fail('whole-delta graph', 'edge references an unknown graph node.');
    }
    adjacency.get(edge.fromRef)!.push(edge.toRef);
    reverse.get(edge.toRef)!.push(edge.fromRef);
  }
  for (const values of [...adjacency.values(), ...reverse.values()]) values.sort(compareCodeUnits);
  const visited = new Set<string>();
  const order: string[] = [];
  for (const root of sortedNodes) {
    if (visited.has(root)) continue;
    const stack: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];
    visited.add(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = adjacency.get(frame.node)![frame.next];
      if (next !== undefined) {
        frame.next += 1;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ node: next, next: 0 });
        }
      } else {
        order.push(frame.node);
        stack.pop();
      }
    }
  }
  const components: DevelopmentCriticalPathWholeDeltaSccV1[] = [];
  const assigned = new Set<string>();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const root = order[index]!;
    if (assigned.has(root)) continue;
    const members: string[] = [];
    const stack = [root];
    assigned.add(root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      members.push(node);
      for (const next of reverse.get(node)!) {
        if (!assigned.has(next)) {
          assigned.add(next);
          stack.push(next);
        }
      }
    }
    members.sort(compareCodeUnits);
    components.push(Object.freeze({
      sccDigest: sha256(members) as DevelopmentCriticalPathDigest,
      members: Object.freeze(members)
    }));
  }
  return Object.freeze(components.sort((left, right) => compareCodeUnits(left.sccDigest, right.sccDigest)));
}

function createWholeDeltaBlock(
  reasonCode: DevelopmentCriticalPathWholeDeltaBlockV1['reasonCode'],
  blockingEffect: DevelopmentCriticalPathWholeDeltaBlockV1['blockingEffect'],
  missingEdges: readonly string[],
  minimumResolution: string
): DevelopmentCriticalPathWholeDeltaBlockV1 {
  const material = Object.freeze({
    kind: 'whole-delta-block' as const,
    reasonCode,
    requiredAuthority: 'sec-development-critical-path-whole-delta-producer',
    blockingEffect,
    missingEdges: Object.freeze([...new Set(missingEdges)].sort(compareCodeUnits)),
    minimumResolution: boundedText(minimumResolution, 'whole-delta block.minimumResolution')
  });
  return Object.freeze({
    ...material,
    blockDigest: sha256(material) as DevelopmentCriticalPathDigest
  });
}

function canonicalStaticUnknown(
  value: unknown,
  label: string
): DevelopmentCriticalPathStaticUnknownV1 {
  const input = record(value, label);
  exactKeys(input, [
    'unknownId', 'subject', 'ownerRef', 'producerRef', 'missingEdge', 'sourceLocations',
    'inputRevision', 'requiredAuthority', 'blockingEffect', 'freshness',
    'invalidationPredicates', 'recoveryOwner', 'recovery', 'minimumResolution'
  ], label);
  const blockingEffect = input.blockingEffect;
  if (blockingEffect !== 'none' && blockingEffect !== 'pre-effect'
      && blockingEffect !== 'effect-admission' && blockingEffect !== 'required-proof') {
    fail(`${label}.blockingEffect`, 'must be a known blocking-effect class.');
  }
  const freshness = input.freshness;
  if (freshness !== 'fresh' && freshness !== 'stale' && freshness !== 'unknown') {
    fail(`${label}.freshness`, 'must be fresh, stale, or unknown.');
  }
  if (!Array.isArray(input.sourceLocations)) fail(`${label}.sourceLocations`, 'must be an array.');
  const sourceLocations = input.sourceLocations.map((entry, index) =>
    boundedText(entry, `${label}.sourceLocations[${index}]`, 1024)
  );
  if (JSON.stringify([...sourceLocations].sort(compareCodeUnits)) !== JSON.stringify(sourceLocations)) {
    fail(`${label}.sourceLocations`, 'must be in canonical order.');
  }
  if (new Set(sourceLocations).size !== sourceLocations.length) {
    fail(`${label}.sourceLocations`, 'must not contain duplicates.');
  }
  const invalidationPredicates = canonicalTextList(
    input.invalidationPredicates,
    `${label}.invalidationPredicates`
  );
  const ownerRef = canonicalOwner(input.ownerRef, `${label}.ownerRef`);
  const producerRef = canonicalStaticProducer(input.producerRef, `${label}.producerRef`);
  const recoveryOwner = canonicalOwner(input.recoveryOwner, `${label}.recoveryOwner`);
  const material = Object.freeze({
    subject: boundedText(input.subject, `${label}.subject`),
    ownerRef,
    producerRef,
    missingEdge: boundedText(input.missingEdge, `${label}.missingEdge`),
    sourceLocations: Object.freeze(sourceLocations),
    inputRevision: boundedText(input.inputRevision, `${label}.inputRevision`),
    requiredAuthority: boundedText(input.requiredAuthority, `${label}.requiredAuthority`),
    blockingEffect,
    freshness,
    invalidationPredicates,
    recoveryOwner,
    recovery: boundedText(input.recovery, `${label}.recovery`),
    minimumResolution: boundedText(input.minimumResolution, `${label}.minimumResolution`)
  });
  const unknownId = digest(input.unknownId, `${label}.unknownId`);
  const expectedUnknownId = sha256(material) as DevelopmentCriticalPathDigest;
  if (unknownId !== expectedUnknownId) {
    fail(`${label}.unknownId`, 'must equal the canonical material digest excluding unknownId.');
  }
  return Object.freeze({ unknownId, ...material });
}

function normalizeStaticUnknownList(
  value: unknown,
  label: string
): readonly DevelopmentCriticalPathStaticUnknownV1[] {
  if (!Array.isArray(value)) fail(label, 'must be an array of structured unknowns.');
  const values = value
    .map((entry, index) => canonicalStaticUnknown(entry, `${label}[${index}]`))
    .sort((left, right) => compareCodeUnits(left.unknownId, right.unknownId));
  if (new Set(values.map((entry) => entry.unknownId)).size !== values.length) {
    fail(label, 'must not contain duplicate unknowns.');
  }
  return Object.freeze(values);
}

function canonicalStaticUnknownList(
  value: unknown,
  label: string
): readonly DevelopmentCriticalPathStaticUnknownV1[] {
  const canonical = normalizeStaticUnknownList(value, label);
  if (!Array.isArray(value) || canonical.some((entry, index) => (
    entry.unknownId !== (value[index] as { unknownId?: unknown } | undefined)?.unknownId
  ))) {
    fail(label, 'must be in canonical order.');
  }
  return canonical;
}

/** Build one provenance-bound Unknown for an unresolved whole-delta edge. */
export function createDevelopmentCriticalPathWholeDeltaUnknownV1(input: Readonly<{
  readonly subject: string;
  readonly ownerRef: DevelopmentCriticalPathCanonicalOwnerV1;
  readonly producerRef: DevelopmentCriticalPathStaticProducerV1;
  readonly missingEdge: string;
  readonly sourceLocations: readonly string[];
  readonly blockingEffect: DevelopmentCriticalPathStaticUnknownV1['blockingEffect'];
  readonly minimumResolution: string;
}>): DevelopmentCriticalPathStaticUnknownV1 {
  const ownerRef = canonicalOwner(input.ownerRef, 'whole-delta unknown.ownerRef');
  const producerRef = canonicalStaticProducer(input.producerRef, 'whole-delta unknown.producerRef');
  const sourceLocations = [...input.sourceLocations]
    .map((entry, index) => wholeDeltaPath(entry, `whole-delta unknown.sourceLocations[${index}]`))
    .sort(compareCodeUnits);
  if (new Set(sourceLocations).size !== sourceLocations.length) {
    fail('whole-delta unknown.sourceLocations', 'must not contain duplicate paths.');
  }
  const material = Object.freeze({
    subject: boundedText(input.subject, 'whole-delta unknown.subject'),
    ownerRef,
    producerRef,
    missingEdge: boundedText(input.missingEdge, 'whole-delta unknown.missingEdge'),
    sourceLocations: Object.freeze(sourceLocations),
    inputRevision: producerRef.revision,
    requiredAuthority: 'sec-development-critical-path-whole-delta-producer',
    blockingEffect: input.blockingEffect,
    freshness: 'fresh' as const,
    invalidationPredicates: Object.freeze(['exact-base-head-or-producer-drift']),
    recoveryOwner: ownerRef,
    recovery: 'recompute exact Git whole-delta producer and owner fixed point',
    minimumResolution: boundedText(input.minimumResolution, 'whole-delta unknown.minimumResolution')
  });
  return Object.freeze({
    unknownId: sha256(material) as DevelopmentCriticalPathDigest,
    ...material
  });
}

function canonicalProofScope(
  value: unknown,
  label: string
): DevelopmentCriticalPathStaticProofScopeV1 {
  const input = record(value, label);
  if (input.kind === 'bounded-action-admission') {
    exactKeys(input, ['kind', 'scopeDigest'], label);
    return Object.freeze({
      kind: 'bounded-action-admission',
      scopeDigest: digest(input.scopeDigest, `${label}.scopeDigest`)
    });
  }
  if (input.kind === 'required') {
    exactKeys(input, ['kind', 'scopeDigest', 'producer'], label);
    return Object.freeze({
      kind: 'required',
      scopeDigest: digest(input.scopeDigest, `${label}.scopeDigest`),
      producer: canonicalStaticProducer(input.producer, `${label}.producer`)
    });
  }
  fail(label, 'must be a bounded-action-admission or required proof scope.');
}

/**
 * Unknowns are retained even when they are outside the consumer's admission
 * scope.  A bounded Action only blocks on facts that can invalidate its own
 * pre-effect/effect-admission boundary; a required/whole-delta proof must
 * close every unresolved edge, including successor candidate hints.
 */
function staticUnknownBlocksProofScope(
  unknown: DevelopmentCriticalPathStaticUnknownV1,
  proofScope: DevelopmentCriticalPathStaticProofScopeV1
): boolean {
  if (proofScope.kind === 'required') return true;
  return unknown.blockingEffect === 'pre-effect' || unknown.blockingEffect === 'effect-admission';
}

/**
 * Resolve a broader whole-delta/required proof scope without allowing an
 * unbound caller to manufacture authority.  The missing-producer branch is a
 * first-class typed block so callers can persist and reconcile it rather than
 * silently falling back to bounded admission.
 */
export function createDevelopmentCriticalPathRequiredProofScopeV1(input: Readonly<{
  scopeDigest: DevelopmentCriticalPathDigest;
  producer: DevelopmentCriticalPathStaticProducerV1 | null | undefined;
}>): DevelopmentCriticalPathStaticProofScopeV1 | DevelopmentCriticalPathRequiredProofBlockV1 {
  const scopeDigest = digest(input.scopeDigest, 'required proof scopeDigest');
  if (input.producer === null || input.producer === undefined) {
    return Object.freeze({
      kind: 'required-proof-block',
      status: 'blocked',
      reasonCode: 'required-proof-producer-missing',
      scopeDigest,
      minimumResolution: 'trusted-producer-receipt'
    });
  }
  return Object.freeze({
    kind: 'required' as const,
    scopeDigest,
    producer: canonicalStaticProducer(input.producer, 'required proof producer')
  });
}

const NON_MISLEADING_RECEIPT_KIND_BY_STAGE: Readonly<Record<
  DevelopmentCriticalPathNonMisleadingStageV1,
  DevelopmentCriticalPathNonMisleadingReceiptKindV1
>> = Object.freeze({
  observed: 'observation-receipt',
  inferred: 'inference-receipt',
  planned: 'plan-receipt',
  implemented: 'implementation-receipt',
  'locally-verified': 'local-verification-receipt',
  'independently-reviewed': 'independent-review-receipt',
  merged: 'merge-receipt',
  'new-main-readback': 'new-main-readback-receipt'
});

function nonMisleadingStageIndex(
  stage: DevelopmentCriticalPathNonMisleadingStageV1,
  label: string
): number {
  const index = DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1.indexOf(stage);
  if (index < 0) fail(label, 'is not a canonical non-misleading projection stage.');
  return index;
}

function canonicalNonMisleadingReceipt(
  value: unknown,
  label: string
): DevelopmentCriticalPathNonMisleadingStageReceiptV1 {
  const input = record(value, label);
  exactKeys(input, ['stage', 'kind', 'sourceDigest', 'receiptDigest'], label);
  const stage = input.stage;
  if (!DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1.includes(stage as DevelopmentCriticalPathNonMisleadingStageV1)) {
    fail(`${label}.stage`, 'is not a canonical non-misleading projection stage.');
  }
  const canonicalStage = stage as DevelopmentCriticalPathNonMisleadingStageV1;
  const kind = input.kind;
  if (!DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_RECEIPT_KINDS_V1.includes(
    kind as DevelopmentCriticalPathNonMisleadingReceiptKindV1
  )) {
    fail(`${label}.kind`, 'is not a canonical receipt kind.');
  }
  const canonicalKind = kind as DevelopmentCriticalPathNonMisleadingReceiptKindV1;
  if (NON_MISLEADING_RECEIPT_KIND_BY_STAGE[canonicalStage] !== canonicalKind) {
    fail(label, 'receipt kind does not authorize the declared stage.');
  }
  const sourceDigest = digest(input.sourceDigest, `${label}.sourceDigest`);
  const receiptDigest = digest(input.receiptDigest, `${label}.receiptDigest`);
  const material = Object.freeze({ stage: canonicalStage, kind: canonicalKind, sourceDigest });
  if (sha256(material) !== receiptDigest) {
    fail(`${label}.receiptDigest`, 'must be derived from the stage, kind, and source digest.');
  }
  return Object.freeze({ ...material, receiptDigest });
}

function createNonMisleadingGap(
  stage: DevelopmentCriticalPathNonMisleadingStageV1,
  reasonCode: DevelopmentCriticalPathNonMisleadingGapV1['reasonCode']
): DevelopmentCriticalPathNonMisleadingGapV1 {
  const requiredKind = NON_MISLEADING_RECEIPT_KIND_BY_STAGE[stage];
  const material = Object.freeze({
    stage,
    requiredKind,
    reasonCode,
    requiredAuthority: 'sec-development-critical-path-stage-receipt',
    blockingEffect: 'completion' as const,
    minimumResolution: `authenticated ${requiredKind} with a canonical source digest`
  });
  return Object.freeze({ gapId: sha256(material) as DevelopmentCriticalPathDigest, ...material });
}

/**
 * Pure, monotone lifecycle projection.  A stage is never inferred from a
 * candidate ref, a command exit code, or a human/agent assertion: every step
 * needs the exact receipt kind and a digest-bound source.  The exact-key
 * parser also rejects fields such as `candidate` and `exitCode` at the trust
 * boundary instead of merely ignoring them.
 */
export function compileDevelopmentCriticalPathNonMisleadingProjectionV1(input: Readonly<{
  readonly receipts: readonly unknown[];
  readonly requiredStage?: DevelopmentCriticalPathNonMisleadingStageV1;
}>): DevelopmentCriticalPathNonMisleadingProjectionV1 {
  if (!Array.isArray(input.receipts)) fail('non-misleading projection.receipts', 'must be an array.');
  const requiredStage = input.requiredStage ?? 'new-main-readback';
  nonMisleadingStageIndex(requiredStage, 'non-misleading projection.requiredStage');
  const receipts = input.receipts.map((entry, index) =>
    canonicalNonMisleadingReceipt(entry, `non-misleading projection.receipts[${index}]`)
  );
  const byStage = new Map<DevelopmentCriticalPathNonMisleadingStageV1,
    DevelopmentCriticalPathNonMisleadingStageReceiptV1>();
  for (const receipt of receipts) {
    if (byStage.has(receipt.stage)) fail('non-misleading projection.receipts', 'must contain at most one receipt per stage.');
    byStage.set(receipt.stage, receipt);
  }
  const orderedReceipts = Object.freeze([...receipts].sort((left, right) => {
    const stageDelta = nonMisleadingStageIndex(left.stage, 'receipt.stage')
      - nonMisleadingStageIndex(right.stage, 'receipt.stage');
    return stageDelta !== 0 ? stageDelta : compareCodeUnits(left.receiptDigest, right.receiptDigest);
  }));
  let strongestIndex = -1;
  let stageJump = false;
  for (let index = 0; index < DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1.length; index += 1) {
    const stage = DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1[index];
    if (byStage.has(stage)) {
      if (strongestIndex + 1 !== index) stageJump = true;
      else strongestIndex = index;
    } else if (byStage.size > 0 && strongestIndex >= 0 && index <= nonMisleadingStageIndex(requiredStage, 'requiredStage')) {
      // A later receipt without this exact predecessor is a jump, not a gap
      // that can be silently skipped.
      if ([...byStage.keys()].some((candidate) => nonMisleadingStageIndex(candidate, 'receipt.stage') > index)) {
        stageJump = true;
      }
    }
  }
  const gaps: DevelopmentCriticalPathNonMisleadingGapV1[] = [];
  if (stageJump) {
    const next = DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1[Math.max(0, strongestIndex + 1)];
    if (next !== undefined) gaps.push(createNonMisleadingGap(next, 'stage-jump'));
  }
  const requiredIndex = nonMisleadingStageIndex(requiredStage, 'requiredStage');
  for (let index = Math.max(0, strongestIndex + 1); index <= requiredIndex; index += 1) {
    const stage = DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1[index];
    if (stage !== undefined && !byStage.has(stage)) {
      gaps.push(createNonMisleadingGap(stage, 'missing-receipt'));
    }
  }
  const canonicalGaps = Object.freeze([...gaps].sort((left, right) => compareCodeUnits(left.gapId, right.gapId)));
  const strongestStage = strongestIndex < 0
    ? 'none' as const
    : DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_STAGES_V1[strongestIndex];
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_PROJECTION_SCHEMA_V1,
    strongestStage,
    requiredStage,
    receipts: orderedReceipts,
    gaps: canonicalGaps,
    completion: strongestIndex === requiredIndex && canonicalGaps.length === 0
      ? 'complete' as const
      : 'incomplete' as const
  });
  return Object.freeze({ ...material, projectionDigest: sha256(material) as DevelopmentCriticalPathDigest });
}

export function parseDevelopmentCriticalPathNonMisleadingProjectionV1(
  value: unknown
): DevelopmentCriticalPathNonMisleadingProjectionV1 {
  const input = record(value, 'non-misleading projection');
  exactKeys(input, ['schema', 'strongestStage', 'requiredStage', 'receipts', 'gaps', 'completion', 'projectionDigest'],
    'non-misleading projection');
  if (input.schema !== DEVELOPMENT_CRITICAL_PATH_NON_MISLEADING_PROJECTION_SCHEMA_V1) {
    fail('non-misleading projection.schema', 'is invalid.');
  }
  const canonical = compileDevelopmentCriticalPathNonMisleadingProjectionV1({
    receipts: input.receipts as readonly unknown[],
    requiredStage: input.requiredStage as DevelopmentCriticalPathNonMisleadingStageV1
  });
  if (!canonicalEquals(canonical, input)) {
    fail('non-misleading projection', 'is not the canonical receipt projection.');
  }
  return canonical;
}

function canonicalWholeDeltaSubject(
  value: unknown,
  label: string
): DevelopmentCriticalPathWholeDeltaSubjectV1 {
  const input = record(value, label);
  const expectedKeys = [
    'schema', 'scope', 'base', 'head', 'changes', 'requiredOwners', 'ownerProjections',
    'consumers', 'graphNodes', 'edges', 'sccs', 'fixedPointDigest', 'fixedPointClosed',
    'producer', 'unknowns', 'status', 'blocker', 'subjectDigest'
  ];
  const withProjection = Object.prototype.hasOwnProperty.call(input, 'nonMisleadingProjection');
  exactKeys(input, withProjection ? [...expectedKeys, 'nonMisleadingProjection'] : expectedKeys, label);
  if (input.schema !== DEVELOPMENT_CRITICAL_PATH_WHOLE_DELTA_SCHEMA_V1) {
    fail(`${label}.schema`, 'is invalid.');
  }
  if (input.scope !== 'bounded-action-admission' && input.scope !== 'required-producer-bound') {
    fail(`${label}.scope`, 'is invalid.');
  }
  const base = canonicalWholeDeltaRevisionFact(input.base, `${label}.base`);
  const head = canonicalWholeDeltaRevisionFact(input.head, `${label}.head`);
  if (head === null) fail(`${label}.head`, 'must contain exact current revision facts.');
  if (!Array.isArray(input.changes)) fail(`${label}.changes`, 'must be an array.');
  const changes = Object.freeze(input.changes.map((entry, index) =>
    canonicalWholeDeltaChange(entry, `${label}.changes[${index}]`)
  ));
  if ([...changes].sort((left, right) => compareCodeUnits(left.changeDigest, right.changeDigest))
      .some((entry, index) => entry !== changes[index])) {
    fail(`${label}.changes`, 'must be in canonical digest order.');
  }
  if (!Array.isArray(input.requiredOwners)) fail(`${label}.requiredOwners`, 'must be an array.');
  const requiredOwners = Object.freeze(input.requiredOwners.map((entry, index) =>
    canonicalOwner(entry, `${label}.requiredOwners[${index}]`)
  ));
  if ([...requiredOwners].sort((left, right) => compareCodeUnits(left.recordId, right.recordId))
      .some((entry, index) => entry !== requiredOwners[index])) {
    fail(`${label}.requiredOwners`, 'must be in canonical owner order.');
  }
  if (new Set(requiredOwners.map(({ recordId }) => recordId)).size !== requiredOwners.length) {
    fail(`${label}.requiredOwners`, 'must not contain duplicate owner records.');
  }
  if (!Array.isArray(input.ownerProjections)) fail(`${label}.ownerProjections`, 'must be an array.');
  const ownerProjections = Object.freeze(input.ownerProjections.map((entry, index) =>
    canonicalWholeDeltaOwnerProjection(entry, `${label}.ownerProjections[${index}]`)
  ));
  if ([...ownerProjections].sort((left, right) => compareCodeUnits(left.owner.recordId, right.owner.recordId))
      .some((entry, index) => entry !== ownerProjections[index])) {
    fail(`${label}.ownerProjections`, 'must be in canonical owner order.');
  }
  if (new Set(ownerProjections.map(({ owner }) => owner.recordId)).size !== ownerProjections.length) {
    fail(`${label}.ownerProjections`, 'must not contain duplicate owner projections.');
  }
  if (!Array.isArray(input.consumers)) fail(`${label}.consumers`, 'must be an array.');
  const consumers = Object.freeze(input.consumers.map((entry, index) =>
    canonicalWholeDeltaConsumer(entry, `${label}.consumers[${index}]`)
  ));
  if ([...consumers].sort((left, right) => compareCodeUnits(left.consumerRef, right.consumerRef))
      .some((entry, index) => entry !== consumers[index])) {
    fail(`${label}.consumers`, 'must be in canonical consumer order.');
  }
  if (new Set(consumers.map(({ consumerRef }) => consumerRef)).size !== consumers.length) {
    fail(`${label}.consumers`, 'must not contain duplicate consumer references.');
  }
  const producer = canonicalStaticProducer(input.producer, `${label}.producer`);
  const unknowns = canonicalStaticUnknownList(input.unknowns, `${label}.unknowns`);
  const consumerRefs = new Set(consumers.map(({ consumerRef }) => consumerRef));
  const ownedConsumerRefs = new Set(ownerProjections.flatMap(({ consumerRefs }) => consumerRefs));
  const requiredOwnerRefs = new Set(requiredOwners.map(({ recordId }) => recordId));
  const projectionByOwner = new Map(ownerProjections.map((projection) => [projection.owner.recordId, projection]));
  const missingEdges: string[] = [];
  for (const owner of requiredOwners) {
    const projection = projectionByOwner.get(owner.recordId);
    if (projection === undefined) {
      missingEdges.push(`owner:${owner.recordId}/projection`);
      continue;
    }
    if (!canonicalEquals(projection.owner, owner)) {
      fail(`${label}.ownerProjections`, `projection ${owner.recordId} does not resolve to the required canonical owner.`);
    }
  }
  for (const projection of ownerProjections) {
    if (!canonicalEquals(projection.producer, producer)) {
      fail(`${label}.ownerProjections.${projection.owner.recordId}.producer`,
        'must resolve to the whole-delta producer binding.');
    }
    for (const consumerRef of projection.consumerRefs) {
      if (!consumerRefs.has(consumerRef)) missingEdges.push(
        `owner:${projection.owner.recordId}/consumer:${consumerRef}`
      );
    }
    if (projection.required && projection.consumerRefs.length === 0) {
      missingEdges.push(`owner:${projection.owner.recordId}/consumer:<none>`);
    }
  }
  for (const consumer of consumers) {
    if (consumer.required && !ownedConsumerRefs.has(consumer.consumerRef)) {
      missingEdges.push(`consumer:${consumer.consumerRef}/owner`);
    }
  }
  const edges = deriveWholeDeltaEdges(producer, ownerProjections, consumers);
  if (!Array.isArray(input.edges)) fail(`${label}.edges`, 'must be an array.');
  const observedEdges = Object.freeze(input.edges.map((entry, index) =>
    canonicalWholeDeltaEdge(entry, `${label}.edges[${index}]`)
  ));
  if (!canonicalEquals(observedEdges, edges)) {
    fail(`${label}.edges`, 'must be the producer-derived owner/producer/consumer edge set.');
  }
  const graphNodes = Object.freeze([...new Set([
    wholeDeltaSubjectNode(),
    wholeDeltaProducerNode(producer),
    ...requiredOwners.map(wholeDeltaOwnerNode),
    ...ownerProjections.map(({ owner }) => wholeDeltaOwnerNode(owner)),
    ...consumers.map(({ consumerRef }) => wholeDeltaConsumerNode(consumerRef))
  ])].sort(compareCodeUnits));
  if (!Array.isArray(input.graphNodes)) fail(`${label}.graphNodes`, 'must be an array.');
  const observedNodes = canonicalTextList(input.graphNodes, `${label}.graphNodes`);
  if (!canonicalEquals(observedNodes, graphNodes)) {
    fail(`${label}.graphNodes`, 'must be the producer-derived graph node set.');
  }
  const sccs = deriveWholeDeltaSccs(graphNodes, edges);
  if (!Array.isArray(input.sccs)) fail(`${label}.sccs`, 'must be an array.');
  const observedSccs = Object.freeze(input.sccs.map((entry, index) =>
    canonicalWholeDeltaScc(entry, `${label}.sccs[${index}]`)
  ));
  if (!canonicalEquals(observedSccs, sccs)) {
    fail(`${label}.sccs`, 'must be the producer-derived strongly connected components.');
  }
  const fixedPointMaterial = Object.freeze({
    base,
    head,
    changes,
    requiredOwners,
    ownerProjections,
    consumers,
    producer,
    unknowns,
    graphNodes,
    edges,
    sccs
  });
  const fixedPointDigest = digest(input.fixedPointDigest, `${label}.fixedPointDigest`);
  if (fixedPointDigest !== sha256(fixedPointMaterial)) {
    fail(`${label}.fixedPointDigest`, 'must be the canonical graph fixed-point digest.');
  }
  if (typeof input.fixedPointClosed !== 'boolean') fail(`${label}.fixedPointClosed`, 'must be boolean.');
  const blockingUnknowns = unknowns.filter((unknown) => input.scope === 'required-producer-bound'
    || unknown.blockingEffect === 'pre-effect' || unknown.blockingEffect === 'effect-admission');
  const hasBaseBlock = base === null;
  const fixedPointClosed = !hasBaseBlock && missingEdges.length === 0 && blockingUnknowns.length === 0;
  if (input.fixedPointClosed !== fixedPointClosed) {
    fail(`${label}.fixedPointClosed`, 'does not match exact base/edge/unknown closure.');
  }
  const sortedMissingEdges = [...new Set(missingEdges)].sort(compareCodeUnits);
  const blockerReason: DevelopmentCriticalPathWholeDeltaBlockV1['reasonCode'] | null = hasBaseBlock
    ? 'base-fact-missing'
    : sortedMissingEdges.some((edge) => edge.endsWith('/projection'))
      ? 'required-owner-projection-missing'
      : sortedMissingEdges.length > 0
        ? 'owner-consumer-edge-missing'
        : blockingUnknowns.length > 0
          ? 'required-producer-fixed-point-unclosed'
          : null;
  const expectedBlocker = blockerReason === null
    ? null
    : createWholeDeltaBlock(
        blockerReason,
        input.scope === 'required-producer-bound' ? 'required-proof' : 'none',
        [...sortedMissingEdges, ...blockingUnknowns.map(({ unknownId }) => `unknown:${unknownId}`)],
        blockerReason === 'base-fact-missing'
          ? 'exact base commit/tree/inventory facts from the frozen manifest'
          : blockerReason === 'required-owner-projection-missing'
            ? 'producer-bound projection for every required canonical owner'
            : 'recompute the exact whole-delta graph until its fixed point closes'
      );
  const status = !fixedPointClosed
    ? 'blocked' as const
    : input.scope === 'required-producer-bound'
      ? 'required-closed' as const
      : 'bounded-closed' as const;
  if (input.status !== undefined && input.status !== status) {
    fail(`${label}.status`, 'does not match exact fixed-point closure.');
  }
  if (input.blocker !== undefined && !canonicalEquals(
    canonicalWholeDeltaBlock(input.blocker, `${label}.blocker`),
    expectedBlocker
  )) {
    fail(`${label}.blocker`, 'does not match the producer-derived typed blocker.');
  }
  const nonMisleadingProjection = input.nonMisleadingProjection === undefined
    ? undefined
    : parseDevelopmentCriticalPathNonMisleadingProjectionV1(input.nonMisleadingProjection);
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_WHOLE_DELTA_SCHEMA_V1,
    scope: input.scope,
    base,
    head,
    changes,
    requiredOwners,
    ownerProjections,
    consumers,
    graphNodes,
    edges,
    sccs,
    fixedPointDigest,
    fixedPointClosed,
    producer,
    unknowns,
    ...(nonMisleadingProjection === undefined ? {} : { nonMisleadingProjection }),
    status,
    blocker: expectedBlocker
  });
  const subjectDigest = digest(input.subjectDigest, `${label}.subjectDigest`);
  if (subjectDigest !== sha256(material)) fail(`${label}.subjectDigest`, 'must equal canonical whole-delta subject digest.');
  return Object.freeze({ ...material, subjectDigest });
}

/**
 * Compile exact whole-delta facts into one deterministic owner/consumer graph.
 * Missing required facts become typed blockers and structured Unknowns; no
 * candidate path list or command result can make this return a closed proof.
 */
export function createDevelopmentCriticalPathWholeDeltaSubjectV1(
  input: DevelopmentCriticalPathWholeDeltaInputV1
): DevelopmentCriticalPathWholeDeltaSubjectV1 {
  const scope = input.scope;
  if (scope !== 'bounded-action-admission' && scope !== 'required-producer-bound') {
    fail('whole-delta scope', 'is invalid.');
  }
  const base = canonicalWholeDeltaRevisionFact(input.base, 'whole-delta base');
  const head = canonicalWholeDeltaRevisionFact(input.head, 'whole-delta head');
  if (head === null) fail('whole-delta head', 'must contain exact current revision facts.');
  const changes = Object.freeze([...input.changes]
    .map((entry, index) => canonicalWholeDeltaChange(entry, `whole-delta changes[${index}]`))
    .sort((left, right) => compareCodeUnits(left.changeDigest, right.changeDigest)));
  const requiredOwners = Object.freeze([...input.requiredOwners]
    .map((entry, index) => canonicalOwner(entry, `whole-delta requiredOwners[${index}]`))
    .sort((left, right) => compareCodeUnits(left.recordId, right.recordId)));
  const ownerProjections = Object.freeze([...input.ownerProjections]
    .map((entry, index) => canonicalWholeDeltaOwnerProjection(entry, `whole-delta ownerProjections[${index}]`))
    .sort((left, right) => compareCodeUnits(left.owner.recordId, right.owner.recordId)));
  const consumers = Object.freeze([...input.consumers]
    .map((entry, index) => canonicalWholeDeltaConsumer(entry, `whole-delta consumers[${index}]`))
    .sort((left, right) => compareCodeUnits(left.consumerRef, right.consumerRef)));
  const producer = canonicalStaticProducer(input.producer, 'whole-delta producer');
  const suppliedUnknowns = normalizeStaticUnknownList(input.unknowns, 'whole-delta unknowns');
  const projectionByOwner = new Map(ownerProjections.map((projection) => [projection.owner.recordId, projection]));
  const ownedConsumerRefs = new Set(ownerProjections.flatMap(({ consumerRefs }) => consumerRefs));
  const unknowns = [...suppliedUnknowns];
  const unknownOwner = requiredOwners[0] ?? ownerProjections[0]?.owner;
  for (const owner of requiredOwners) {
    if (projectionByOwner.has(owner.recordId)) continue;
    if (unknownOwner !== undefined) {
      unknowns.push(createDevelopmentCriticalPathWholeDeltaUnknownV1({
        subject: `whole-delta:owner:${owner.recordId}`,
        ownerRef: owner,
        producerRef: producer,
        missingEdge: `required owner projection ${owner.recordId} is absent`,
        sourceLocations: [owner.path],
        blockingEffect: scope === 'required-producer-bound' ? 'required-proof' : 'none',
        minimumResolution: 'publish the exact canonical owner projection from the whole-delta producer'
      }));
    }
  }
  for (const consumer of consumers) {
    if (!consumer.required || ownedConsumerRefs.has(consumer.consumerRef) || unknownOwner === undefined) continue;
    unknowns.push(createDevelopmentCriticalPathWholeDeltaUnknownV1({
      subject: `whole-delta:consumer:${consumer.consumerRef}`,
      ownerRef: unknownOwner,
      producerRef: producer,
      missingEdge: `required consumer ${consumer.consumerRef} has no canonical owner edge`,
      sourceLocations: consumer.sourceLocations,
      blockingEffect: scope === 'required-producer-bound' ? 'required-proof' : 'none',
      minimumResolution: 'bind the consumer to an exact canonical owner projection'
    }));
  }
  const canonicalUnknowns = Object.freeze([...new Map(
    unknowns.map((unknown) => [unknown.unknownId, unknown] as const)
  ).values()].sort((left, right) => compareCodeUnits(left.unknownId, right.unknownId)));
  const edges = deriveWholeDeltaEdges(producer, ownerProjections, consumers);
  const graphNodes = Object.freeze([...new Set([
    wholeDeltaSubjectNode(),
    wholeDeltaProducerNode(producer),
    ...requiredOwners.map(wholeDeltaOwnerNode),
    ...ownerProjections.map(({ owner }) => wholeDeltaOwnerNode(owner)),
    ...consumers.map(({ consumerRef }) => wholeDeltaConsumerNode(consumerRef))
  ])].sort(compareCodeUnits));
  const sccs = deriveWholeDeltaSccs(graphNodes, edges);
  // The fixed point is an exact subject closure, not merely a topology hash.
  // Two revisions can have the same owner/consumer graph while analyzing
  // different Git objects, producers, or Unknown ledgers.  Binding all of the
  // canonical inputs here prevents a required proof for one exact delta from
  // being reused for another structurally identical delta.
  const fixedPointDigest = sha256({
    base,
    head,
    changes,
    requiredOwners,
    ownerProjections,
    consumers,
    producer,
    unknowns: canonicalUnknowns,
    graphNodes,
    edges,
    sccs
  }) as DevelopmentCriticalPathDigest;
  const missingEdges = requiredOwners
    .filter((owner) => !projectionByOwner.has(owner.recordId))
    .map((owner) => `owner:${owner.recordId}/projection`);
  const projectionConsumerRefs = new Set(consumers.map(({ consumerRef }) => consumerRef));
  for (const projection of ownerProjections) {
    for (const consumerRef of projection.consumerRefs) {
      if (!projectionConsumerRefs.has(consumerRef)) {
        missingEdges.push(`owner:${projection.owner.recordId}/consumer:${consumerRef}`);
      }
    }
    if (projection.required && projection.consumerRefs.length === 0) {
      missingEdges.push(`owner:${projection.owner.recordId}/consumer:<none>`);
    }
  }
  for (const consumer of consumers) {
    if (consumer.required && !ownedConsumerRefs.has(consumer.consumerRef)) {
      missingEdges.push(`consumer:${consumer.consumerRef}/owner`);
    }
  }
  const blockingUnknowns = canonicalUnknowns.filter((unknown) => scope === 'required-producer-bound'
    || unknown.blockingEffect === 'pre-effect' || unknown.blockingEffect === 'effect-admission');
  const fixedPointClosed = base !== null && missingEdges.length === 0 && blockingUnknowns.length === 0;
  const blockerReason: DevelopmentCriticalPathWholeDeltaBlockV1['reasonCode'] | null = base === null
    ? 'base-fact-missing'
    : missingEdges.some((edge) => edge.endsWith('/projection'))
      ? 'required-owner-projection-missing'
      : missingEdges.length > 0
        ? 'owner-consumer-edge-missing'
        : blockingUnknowns.length > 0
          ? 'required-producer-fixed-point-unclosed'
          : null;
  const blocker = blockerReason === null
    ? null
    : createWholeDeltaBlock(
        blockerReason,
        scope === 'required-producer-bound' ? 'required-proof' : 'none',
        [...new Set([
          ...missingEdges,
          ...blockingUnknowns.map(({ unknownId }) => `unknown:${unknownId}`)
        ])],
        blockerReason === 'base-fact-missing'
          ? 'exact base commit/tree/inventory facts from the frozen manifest'
          : blockerReason === 'required-owner-projection-missing'
            ? 'publish the exact canonical owner projection from the whole-delta producer'
            : 'recompute the exact whole-delta graph until its fixed point closes'
      );
  const status = fixedPointClosed
    ? scope === 'required-producer-bound' ? 'required-closed' as const : 'bounded-closed' as const
    : 'blocked' as const;
  const nonMisleadingProjection = input.nonMisleadingProjection === undefined
    ? undefined
    : parseDevelopmentCriticalPathNonMisleadingProjectionV1(input.nonMisleadingProjection);
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_WHOLE_DELTA_SCHEMA_V1,
    scope,
    base,
    head,
    changes,
    requiredOwners,
    ownerProjections,
    consumers,
    graphNodes,
    edges,
    sccs,
    fixedPointDigest,
    fixedPointClosed,
    producer,
    unknowns: canonicalUnknowns,
    ...(nonMisleadingProjection === undefined ? {} : { nonMisleadingProjection }),
    status,
    blocker
  });
  return Object.freeze({
    ...material,
    subjectDigest: sha256(material) as DevelopmentCriticalPathDigest
  });
}

export function parseDevelopmentCriticalPathWholeDeltaSubjectV1(
  value: unknown
): DevelopmentCriticalPathWholeDeltaSubjectV1 {
  return canonicalWholeDeltaSubject(value, 'whole-delta subject');
}

function assertCanonicalOwnerBindings(
  ownerRegistry: DevelopmentCriticalPathOwnerRegistryV1,
  dimensions: readonly Readonly<{
    claim: Readonly<{ owner: DevelopmentCriticalPathCanonicalOwnerV1 }>;
  }>[]
): void {
  const byId = new Map(ownerRegistry.records.map((owner) => [owner.recordId, owner] as const));
  for (const [index, dimension] of dimensions.entries()) {
    const claimed = dimension.claim.owner;
    const registered = byId.get(claimed.recordId);
    if (registered === undefined
        || !canonicalEquals(registered, claimed)) {
      fail(`static analyzer dimension[${index}].claim.owner`,
        'must resolve exactly to a canonical docs/authority.json record.');
    }
  }
}

export function createDevelopmentCriticalPathStaticGenerationV1(input: Readonly<{
  repository: DevelopmentCriticalPathStaticGenerationV1['repository'];
  producer: DevelopmentCriticalPathStaticProducerV1;
  ownerRegistryDigest: DevelopmentCriticalPathDigest;
  ownerClosureDigest: DevelopmentCriticalPathDigest;
  manifestDigest: DevelopmentCriticalPathDigest;
  producerClosurePaths: readonly string[];
  producerClosureDigest: DevelopmentCriticalPathDigest;
  sourceInventoryDigest: DevelopmentCriticalPathDigest;
  moduleGraphDigest: DevelopmentCriticalPathDigest;
}>): DevelopmentCriticalPathStaticGenerationV1 {
  const repository = Object.freeze({
    headSha: gitSha(input.repository.headSha, 'static generation repository.headSha'),
    headTreeSha: gitSha(input.repository.headTreeSha, 'static generation repository.headTreeSha'),
    objectFormat: input.repository.objectFormat,
    trackedPathCount: input.repository.trackedPathCount,
    trackedByteCount: input.repository.trackedByteCount,
    inventoryDigest: digest(input.repository.inventoryDigest, 'static generation repository.inventoryDigest')
  });
  if ((repository.objectFormat !== 'sha1' && repository.objectFormat !== 'sha256')
      || !Number.isSafeInteger(repository.trackedPathCount) || repository.trackedPathCount < 0
      || !Number.isSafeInteger(repository.trackedByteCount) || repository.trackedByteCount < 0) {
    fail('static generation repository', 'object format or tracked census count is invalid.');
  }
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_STATIC_GENERATION_SCHEMA_V1,
    repository,
    producer: canonicalStaticProducer(input.producer, 'static generation producer'),
    ownerRegistryDigest: digest(input.ownerRegistryDigest, 'static generation ownerRegistryDigest'),
    ownerClosureDigest: digest(input.ownerClosureDigest, 'static generation ownerClosureDigest'),
    manifestDigest: digest(input.manifestDigest, 'static generation manifestDigest'),
    producerClosure: Object.freeze({
      paths: canonicalTextList(input.producerClosurePaths, 'static generation producerClosure.paths'),
      digest: digest(input.producerClosureDigest, 'static generation producerClosure.digest')
    }),
    sourceInventoryDigest: digest(input.sourceInventoryDigest, 'static generation sourceInventoryDigest'),
    moduleGraphDigest: digest(input.moduleGraphDigest, 'static generation moduleGraphDigest')
  });
  return Object.freeze({
    ...material,
    generationDigest: sha256(material) as DevelopmentCriticalPathDigest
  });
}

export function parseDevelopmentCriticalPathStaticGenerationV1(
  value: unknown
): DevelopmentCriticalPathStaticGenerationV1 {
  const input = record(value, 'static generation');
  exactKeys(input, [
    'schema', 'repository', 'producer', 'ownerRegistryDigest', 'ownerClosureDigest',
    'manifestDigest', 'producerClosure', 'sourceInventoryDigest', 'moduleGraphDigest',
    'generationDigest'
  ], 'static generation');
  const repositoryInput = record(input.repository, 'static generation.repository');
  exactKeys(repositoryInput, [
    'headSha', 'headTreeSha', 'objectFormat', 'trackedPathCount', 'trackedByteCount', 'inventoryDigest'
  ], 'static generation.repository');
  const producerClosureInput = record(input.producerClosure, 'static generation.producerClosure');
  exactKeys(producerClosureInput, ['paths', 'digest'], 'static generation.producerClosure');
  const canonical = createDevelopmentCriticalPathStaticGenerationV1({
    repository: repositoryInput as DevelopmentCriticalPathStaticGenerationV1['repository'],
    producer: input.producer as DevelopmentCriticalPathStaticProducerV1,
    ownerRegistryDigest: input.ownerRegistryDigest as DevelopmentCriticalPathDigest,
    ownerClosureDigest: input.ownerClosureDigest as DevelopmentCriticalPathDigest,
    manifestDigest: input.manifestDigest as DevelopmentCriticalPathDigest,
    producerClosurePaths: producerClosureInput.paths as readonly string[],
    producerClosureDigest: producerClosureInput.digest as DevelopmentCriticalPathDigest,
    sourceInventoryDigest: input.sourceInventoryDigest as DevelopmentCriticalPathDigest,
    moduleGraphDigest: input.moduleGraphDigest as DevelopmentCriticalPathDigest
  });
  if (input.schema !== DEVELOPMENT_CRITICAL_PATH_STATIC_GENERATION_SCHEMA_V1
      || !canonicalEquals(canonical, input)) {
    fail('static generation', 'schema, canonical fields, or generation digest is invalid.');
  }
  return canonical;
}

export function createDevelopmentCriticalPathStaticAnalysisReadbackV2(input: Readonly<{
  producerSourceDigest: DevelopmentCriticalPathDigest;
  repository: DevelopmentCriticalPathStaticAnalysisReadbackV2['repository'];
  manifest: DevelopmentCriticalPathStaticAnalysisReadbackV2['manifest'];
  ownerRegistry: DevelopmentCriticalPathStaticAnalysisReadbackV2['ownerRegistry'];
  proofScope?: DevelopmentCriticalPathStaticProofScopeV1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: DevelopmentCriticalPathDigest;
  actionPlanClosureDigest: DevelopmentCriticalPathDigest;
  producerClosurePaths: readonly string[];
  producerClosureDigest: DevelopmentCriticalPathDigest;
  sourceInventoryDigest: DevelopmentCriticalPathDigest;
  moduleGraphDigest: DevelopmentCriticalPathDigest;
  unresolvedModuleFiles: readonly string[];
  wholeDelta: DevelopmentCriticalPathWholeDeltaSubjectV1;
  dimensionInputs: Readonly<Record<DevelopmentCriticalPathStaticClosureDimensionV1, Readonly<{
    claim: Readonly<{
      owner: DevelopmentCriticalPathCanonicalOwnerV1;
      producer: DevelopmentCriticalPathStaticProducerV1;
      subjectDigest: DevelopmentCriticalPathDigest;
    }>;
    input: unknown;
    coverage: 'bounded-census-complete' | 'unknown';
    coverageBasis: 'producer-exact' | 'candidate-hint';
    stopCondition: 'tracked-owner-surface-exhausted' | 'module-graph-unresolved' | 'analyzer-failed';
    defectClasses: readonly string[];
    unknowns: readonly DevelopmentCriticalPathStaticUnknownV1[];
  }>>>;
}>): DevelopmentCriticalPathStaticAnalysisReadbackV2 {
  const repository = Object.freeze({
    headSha: gitSha(input.repository.headSha, 'static analyzer repository.headSha'),
    headTreeSha: gitSha(input.repository.headTreeSha, 'static analyzer repository.headTreeSha'),
    objectFormat: input.repository.objectFormat,
    trackedClean: input.repository.trackedClean,
    trackedPathCount: input.repository.trackedPathCount,
    trackedByteCount: input.repository.trackedByteCount,
    inventoryDigest: digest(input.repository.inventoryDigest, 'static analyzer repository.inventoryDigest')
  });
  if ((repository.objectFormat !== 'sha1' && repository.objectFormat !== 'sha256')
      || repository.trackedClean !== true
      || !Number.isSafeInteger(repository.trackedPathCount) || repository.trackedPathCount < 0
      || !Number.isSafeInteger(repository.trackedByteCount) || repository.trackedByteCount < 0) {
    fail('static analyzer repository', 'object format, clean state, or tracked census count is invalid.');
  }
  const manifest = Object.freeze({
    path: boundedText(input.manifest.path, 'static analyzer manifest.path', 1024),
    digest: digest(input.manifest.digest, 'static analyzer manifest.digest'),
    authorityRefsDigest: digest(input.manifest.authorityRefsDigest, 'static analyzer manifest.authorityRefsDigest'),
    ownedPathsDigest: digest(input.manifest.ownedPathsDigest, 'static analyzer manifest.ownedPathsDigest'),
    forbiddenPathsDigest: digest(input.manifest.forbiddenPathsDigest, 'static analyzer manifest.forbiddenPathsDigest')
  });
  const ownerRegistry = canonicalOwnerRegistry(input.ownerRegistry, 'static analyzer ownerRegistry');
  const dimensionKeys = Object.keys(input.dimensionInputs).sort(compareCodeUnits);
  const expectedDimensionKeys = [...DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1].sort(compareCodeUnits);
  if (dimensionKeys.length !== expectedDimensionKeys.length
      || dimensionKeys.some((key, index) => key !== expectedDimensionKeys[index])) {
    fail('static analyzer dimensionInputs', 'must contain every canonical dimension exactly once.');
  }
  const unresolvedModuleFiles = canonicalTextList(input.unresolvedModuleFiles, 'static analyzer unresolvedModuleFiles');
  const producer = Object.freeze({
    identity: 'tooling/sec-dev/development-critical-path.ts' as const,
    revision: DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_PRODUCER_REVISION_V1,
    sourceDigest: digest(input.producerSourceDigest, 'static analyzer producer sourceDigest')
  });
  const staticGeneration = createDevelopmentCriticalPathStaticGenerationV1({
    repository: {
      headSha: repository.headSha,
      headTreeSha: repository.headTreeSha,
      objectFormat: repository.objectFormat,
      trackedPathCount: repository.trackedPathCount,
      trackedByteCount: repository.trackedByteCount,
      inventoryDigest: repository.inventoryDigest
    },
    producer,
    ownerRegistryDigest: ownerRegistry.digest,
    ownerClosureDigest: ownerRegistry.ownerClosureDigest,
    manifestDigest: manifest.digest,
    producerClosurePaths: input.producerClosurePaths,
    producerClosureDigest: input.producerClosureDigest,
    sourceInventoryDigest: input.sourceInventoryDigest,
    moduleGraphDigest: input.moduleGraphDigest
  });
  const dimensions = Object.freeze(DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1.map((dimension) => {
    const observation = record(
      input.dimensionInputs[dimension],
      `static analyzer dimensionInputs.${dimension}`
    );
    if ((observation.coverage !== 'bounded-census-complete' && observation.coverage !== 'unknown')
        || (observation.coverageBasis !== 'producer-exact' && observation.coverageBasis !== 'candidate-hint')
        || (observation.stopCondition !== 'tracked-owner-surface-exhausted'
          && observation.stopCondition !== 'module-graph-unresolved'
          && observation.stopCondition !== 'analyzer-failed')) {
      fail(`static analyzer dimensionInputs.${dimension}`, 'coverage or stop condition is invalid.');
    }
    const inputClaim = record(observation.claim, `static analyzer dimensionInputs.${dimension}.claim`);
    const claim = Object.freeze({
      owner: canonicalOwner(inputClaim.owner, `static analyzer dimensionInputs.${dimension}.claim.owner`),
      producer: canonicalStaticProducer(
        inputClaim.producer,
        `static analyzer dimensionInputs.${dimension}.claim.producer`
      ),
      subjectDigest: digest(
        inputClaim.subjectDigest,
        `static analyzer dimensionInputs.${dimension}.claim.subjectDigest`
      )
    });
    const defectClasses = canonicalTextList(
      observation.defectClasses,
      `static analyzer dimensionInputs.${dimension}.defectClasses`
    );
    const dimensionUnknowns = normalizeStaticUnknownList(
      observation.unknowns,
      `static analyzer dimensionInputs.${dimension}.unknowns`
    );
    if (!canonicalEquals(claim.producer, producer)) {
      fail(`static analyzer dimensionInputs.${dimension}.claim.producer`,
        'must match the exact analyzer identity, revision, and source digest.');
    }
    if (observation.coverage === 'bounded-census-complete' && observation.coverageBasis !== 'producer-exact') {
      fail(`static analyzer dimensionInputs.${dimension}`,
        'candidate path hints cannot be promoted to complete census coverage.');
    }
    if (observation.coverage === 'bounded-census-complete' && dimensionUnknowns.length !== 0) {
      fail(`static analyzer dimensionInputs.${dimension}`, 'complete coverage cannot retain unknowns.');
    }
    if (observation.coverage === 'unknown' && dimensionUnknowns.length === 0) {
      fail(`static analyzer dimensionInputs.${dimension}`, 'unknown coverage requires a typed unknown.');
    }
    const inputDigest = sha256(observation.input) as DevelopmentCriticalPathDigest;
    const material = Object.freeze({
      dimension,
      claim,
      inputDigest,
      coverage: observation.coverage,
      coverageBasis: observation.coverageBasis,
      stopCondition: observation.stopCondition,
      defectClasses,
      unknowns: dimensionUnknowns
    });
    return Object.freeze({
      ...material,
      evidenceDigest: sha256(Object.freeze({ producer, ...material })) as DevelopmentCriticalPathDigest
    });
  }));
  const wholeDelta = parseDevelopmentCriticalPathWholeDeltaSubjectV1(input.wholeDelta);
  const openDefectClasses = canonicalTextList(
    [...new Set(dimensions.flatMap(({ defectClasses }) => defectClasses))],
    'static analyzer derived openDefectClasses'
  );
  const unknowns = Object.freeze([...dimensions
    .flatMap(({ unknowns: dimensionUnknowns }) => dimensionUnknowns),
    ...wholeDelta.unknowns]
    .sort((left, right) => compareCodeUnits(left.unknownId, right.unknownId)));
  if (new Set(unknowns.map((entry) => JSON.stringify(entry))).size !== unknowns.length) {
    fail('static analyzer derived unknowns', 'must not contain duplicate unknowns.');
  }
  const proofScope = input.proofScope === undefined
    ? Object.freeze({
        kind: 'bounded-action-admission' as const,
        scopeDigest: digest(input.actionPlanClosureDigest, 'static analyzer proof scope')
      })
    : canonicalProofScope(input.proofScope, 'static analyzer proof scope');
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_STATIC_ANALYSIS_READBACK_SCHEMA_V3,
    proofScope,
    producer,
    staticGeneration,
    repository,
    manifest,
    ownerRegistry,
    actionKey: digest(input.actionKey, 'static analyzer actionKey'),
    actionPlanDigest: digest(input.actionPlanDigest, 'static analyzer actionPlanDigest'),
    actionPlanClosureDigest: digest(input.actionPlanClosureDigest, 'static analyzer actionPlanClosureDigest'),
    sourceInventoryDigest: digest(input.sourceInventoryDigest, 'static analyzer sourceInventoryDigest'),
    moduleGraphDigest: digest(input.moduleGraphDigest, 'static analyzer moduleGraphDigest'),
    unresolvedModuleFiles,
    wholeDelta,
    dimensions,
    openDefectClasses,
    unknowns
  });
  return Object.freeze({ ...material, readbackDigest: sha256(material) as DevelopmentCriticalPathDigest });
}

export function parseDevelopmentCriticalPathStaticAnalysisReadbackV2(
  value: unknown
): DevelopmentCriticalPathStaticAnalysisReadbackV2 {
  const input = record(value, 'static analysis readback');
  const staticReadbackKeys = [
    'schema', 'proofScope', 'producer', 'staticGeneration', 'repository', 'manifest', 'ownerRegistry', 'actionKey',
    'actionPlanDigest', 'actionPlanClosureDigest', 'sourceInventoryDigest',
    'moduleGraphDigest', 'unresolvedModuleFiles', 'dimensions', 'openDefectClasses',
    'unknowns', 'readbackDigest'
  ] as const;
  exactKeys(input, [...staticReadbackKeys, 'wholeDelta'], 'static analysis readback');
  const { readbackDigest, ...material } = input;
  const proofScope = canonicalProofScope(input.proofScope, 'static analysis readback.proofScope');
  if (input.schema !== DEVELOPMENT_CRITICAL_PATH_STATIC_ANALYSIS_READBACK_SCHEMA_V3
      || !canonicalEquals(proofScope, input.proofScope)
      || typeof readbackDigest !== 'string' || sha256(material) !== readbackDigest) {
    fail('static analysis readback', 'schema or digest is invalid.');
  }
  const producer = canonicalStaticProducer(input.producer, 'static analysis readback.producer');
  if (producer.identity !== 'tooling/sec-dev/development-critical-path.ts'
      || producer.revision !== DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_PRODUCER_REVISION_V1) {
    fail('static analysis readback.producer', 'identity or revision is invalid.');
  }
  const repository = record(input.repository, 'static analysis readback.repository');
  exactKeys(repository, [
    'headSha', 'headTreeSha', 'objectFormat', 'trackedClean', 'trackedPathCount',
    'trackedByteCount', 'inventoryDigest'
  ], 'static analysis readback.repository');
  gitSha(repository.headSha, 'static analysis readback.repository.headSha');
  gitSha(repository.headTreeSha, 'static analysis readback.repository.headTreeSha');
  if ((repository.objectFormat !== 'sha1' && repository.objectFormat !== 'sha256')
      || repository.trackedClean !== true
      || !Number.isSafeInteger(repository.trackedPathCount) || Number(repository.trackedPathCount) < 0
      || !Number.isSafeInteger(repository.trackedByteCount) || Number(repository.trackedByteCount) < 0) {
    fail('static analysis readback.repository', 'census identity is invalid.');
  }
  digest(repository.inventoryDigest, 'static analysis readback.repository.inventoryDigest');
  const manifest = record(input.manifest, 'static analysis readback.manifest');
  exactKeys(manifest, [
    'path', 'digest', 'authorityRefsDigest', 'ownedPathsDigest', 'forbiddenPathsDigest'
  ], 'static analysis readback.manifest');
  boundedText(manifest.path, 'static analysis readback.manifest.path', 1024);
  for (const key of ['digest', 'authorityRefsDigest', 'ownedPathsDigest', 'forbiddenPathsDigest'] as const) {
    digest(manifest[key], `static analysis readback.manifest.${key}`);
  }
  const ownerRegistry = canonicalOwnerRegistry(input.ownerRegistry, 'static analysis readback.ownerRegistry');
  const staticGeneration = parseDevelopmentCriticalPathStaticGenerationV1(input.staticGeneration);
  const expectedStaticGeneration = createDevelopmentCriticalPathStaticGenerationV1({
    repository: {
      headSha: repository.headSha as string,
      headTreeSha: repository.headTreeSha as string,
      objectFormat: repository.objectFormat as 'sha1' | 'sha256',
      trackedPathCount: repository.trackedPathCount as number,
      trackedByteCount: repository.trackedByteCount as number,
      inventoryDigest: repository.inventoryDigest as DevelopmentCriticalPathDigest
    },
    producer,
    ownerRegistryDigest: ownerRegistry.digest,
    ownerClosureDigest: ownerRegistry.ownerClosureDigest,
    manifestDigest: manifest.digest as DevelopmentCriticalPathDigest,
    producerClosurePaths: staticGeneration.producerClosure.paths,
    producerClosureDigest: staticGeneration.producerClosure.digest,
    sourceInventoryDigest: input.sourceInventoryDigest as DevelopmentCriticalPathDigest,
    moduleGraphDigest: input.moduleGraphDigest as DevelopmentCriticalPathDigest
  });
  if (!canonicalEquals(staticGeneration, expectedStaticGeneration)) {
    fail('static analysis readback.staticGeneration',
      'must be the exact repository, producer, owner, source, and module generation of this readback.');
  }
  for (const key of [
    'actionKey', 'actionPlanDigest', 'actionPlanClosureDigest', 'sourceInventoryDigest', 'moduleGraphDigest'
  ] as const) digest(input[key], `static analysis readback.${key}`);
  const unresolvedModuleFiles = canonicalTextList(input.unresolvedModuleFiles, 'static analysis readback.unresolvedModuleFiles');
  const openDefectClasses = canonicalTextList(input.openDefectClasses, 'static analysis readback.openDefectClasses');
  const unknowns = canonicalStaticUnknownList(input.unknowns, 'static analysis readback.unknowns');
  const wholeDelta = parseDevelopmentCriticalPathWholeDeltaSubjectV1(input.wholeDelta);
  if ((wholeDelta.scope === 'required-producer-bound') !== (proofScope.kind === 'required')) {
    fail('static analysis readback', 'whole-delta scope and proof scope cannot be downgraded or widened by a caller.');
  }
  if (!canonicalEquals(unresolvedModuleFiles, input.unresolvedModuleFiles)
      || !canonicalEquals(openDefectClasses, input.openDefectClasses)
      || !canonicalEquals(unknowns, input.unknowns)
      || !canonicalEquals(wholeDelta, input.wholeDelta)) {
    fail('static analysis readback', 'canonical text ledgers must be sorted.');
  }
  if (!Array.isArray(input.dimensions)
      || input.dimensions.length !== DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1.length) {
    fail('static analysis readback.dimensions', 'must contain every canonical dimension exactly once.');
  }
  input.dimensions.forEach((entry, index) => {
    const dimension = record(entry, `static analysis readback.dimensions[${index}]`);
    exactKeys(dimension, [
      'dimension', 'claim', 'inputDigest', 'coverage', 'coverageBasis', 'stopCondition',
      'defectClasses', 'unknowns', 'evidenceDigest'
    ], `static analysis readback.dimensions[${index}]`);
    if (dimension.dimension !== DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1[index]
        || (dimension.coverage !== 'bounded-census-complete' && dimension.coverage !== 'unknown')
        || (dimension.coverageBasis !== 'producer-exact' && dimension.coverageBasis !== 'candidate-hint')
        || (dimension.stopCondition !== 'tracked-owner-surface-exhausted'
          && dimension.stopCondition !== 'module-graph-unresolved'
          && dimension.stopCondition !== 'analyzer-failed')) {
      fail(`static analysis readback.dimensions[${index}]`, 'coverage identity is invalid.');
    }
    const claim = record(dimension.claim, `static analysis readback.dimensions[${index}].claim`);
    exactKeys(claim, ['owner', 'producer', 'subjectDigest'],
      `static analysis readback.dimensions[${index}].claim`);
    const canonicalClaimOwner = canonicalOwner(
      claim.owner,
      `static analysis readback.dimensions[${index}].claim.owner`
    );
    const canonicalClaimProducer = canonicalStaticProducer(
      claim.producer,
      `static analysis readback.dimensions[${index}].claim.producer`
    );
    if (!canonicalEquals(canonicalClaimProducer, producer)) {
      fail(`static analysis readback.dimensions[${index}].claim.producer`,
        'must match the exact analyzer producer binding.');
    }
    const registeredOwner = ownerRegistry.records.find(({ recordId }) => recordId === canonicalClaimOwner.recordId);
    if (registeredOwner === undefined
        || !canonicalEquals(registeredOwner, canonicalClaimOwner)) {
      fail(`static analysis readback.dimensions[${index}].claim.owner`,
        'must resolve exactly to a canonical docs/authority.json record.');
    }
    digest(claim.subjectDigest, `static analysis readback.dimensions[${index}].claim.subjectDigest`);
    digest(dimension.inputDigest, `static analysis readback.dimensions[${index}].inputDigest`);
    const defectClasses = canonicalTextList(
      dimension.defectClasses,
      `static analysis readback.dimensions[${index}].defectClasses`
    );
    const dimensionUnknowns = canonicalStaticUnknownList(
      dimension.unknowns,
      `static analysis readback.dimensions[${index}].unknowns`
    );
    if (dimension.coverage === 'bounded-census-complete' && dimension.coverageBasis !== 'producer-exact') {
      fail(`static analysis readback.dimensions[${index}]`,
        'candidate path hints cannot be promoted to census-complete coverage.');
    }
    if (!canonicalEquals(defectClasses, dimension.defectClasses)
        || !canonicalEquals(dimensionUnknowns, dimension.unknowns)
        || (dimension.coverage === 'bounded-census-complete' && dimensionUnknowns.length !== 0)
        || (dimension.coverage === 'unknown' && dimensionUnknowns.length === 0)) {
      fail(`static analysis readback.dimensions[${index}]`, 'dimension ledgers do not match coverage.');
    }
    const expectedEvidence = sha256(Object.freeze({
      producer,
      dimension: dimension.dimension,
      claim,
      inputDigest: dimension.inputDigest,
      coverage: dimension.coverage,
      coverageBasis: dimension.coverageBasis,
      stopCondition: dimension.stopCondition,
      defectClasses,
      unknowns: dimensionUnknowns
    }));
    if (digest(dimension.evidenceDigest, `static analysis readback.dimensions[${index}].evidenceDigest`)
        !== expectedEvidence) {
      fail(`static analysis readback.dimensions[${index}]`, 'evidence digest mismatch.');
    }
  });
  const derivedDefects = canonicalTextList(
    [...new Set(input.dimensions.flatMap((entry) =>
      record(entry, 'static analysis dimension').defectClasses as readonly string[]))],
    'static analysis readback derived openDefectClasses'
  );
  const derivedUnknowns = Object.freeze([...input.dimensions
    .flatMap((entry) => canonicalStaticUnknownList(
      record(entry, 'static analysis dimension').unknowns,
      'static analysis dimension unknowns'
    )),
    ...wholeDelta.unknowns]
    .sort((left, right) => compareCodeUnits(left.unknownId, right.unknownId)));
  if (new Set(derivedUnknowns.map((entry) => JSON.stringify(entry))).size !== derivedUnknowns.length) {
    fail('static analysis readback derived unknowns', 'must not contain duplicates.');
  }
  if (!canonicalEquals(derivedDefects, openDefectClasses)
      || !canonicalEquals(derivedUnknowns, unknowns)) {
    fail('static analysis readback', 'top-level ledgers must be derived from every dimension ledger.');
  }
  return value as DevelopmentCriticalPathStaticAnalysisReadbackV2;
}

/** Compose a physical analyzer readback with the canonical Action plan. */
export function createDevelopmentCriticalPathStaticClosureV1(
  actionPlanValue: VerificationActionPlanV2,
  analysisReadbackValue: DevelopmentCriticalPathStaticAnalysisReadbackV2,
  expectedActionPlanClosureDigest: DevelopmentCriticalPathDigest,
  dependencyEvidenceValue?: readonly VerificationActionDependencyResolutionV2[]
): DevelopmentCriticalPathStaticClosureV1 {
  const actionPlan = canonicalPlan(actionPlanValue, 'static closure actionPlan');
  const action = actionPlan.action;
  const actionPlanDigest = stableActionPlanDigest(actionPlan);
  const analysisReadback = parseDevelopmentCriticalPathStaticAnalysisReadbackV2(analysisReadbackValue);
  if (analysisReadback.actionKey !== action.actionKey || analysisReadback.actionPlanDigest !== actionPlanDigest) {
    fail('static analysis readback', 'does not bind the canonical Action plan.');
  }
  const actionPlanClosureDigest = digest(
    expectedActionPlanClosureDigest,
    'static closure expected actionPlanClosureDigest'
  );
  if (analysisReadback.actionPlanClosureDigest !== actionPlanClosureDigest) {
    fail('static analysis readback', 'does not bind the expected canonical Action plan closure.');
  }
  const trackedInputDigest = analysisReadback.sourceInventoryDigest;
  const environmentDigest = sha256(action.environment) as DevelopmentCriticalPathDigest;
  const analysisStage = dependencyEvidenceValue === undefined
    ? 'plan-structural' as const
    : 'effect-admission' as const;
  const dependencyEvidence = dependencyEvidenceValue === undefined
    ? Object.freeze([] as VerificationActionDependencyResolutionV2[])
    : Object.freeze(dependencyEvidenceValue.map((entry, index) => {
        const expected = actionPlan.dependencies[index];
        if (expected === undefined || entry.actionKey !== expected.actionKey) {
          return Object.freeze({
            actionKey: entry.actionKey,
            state: 'unknown' as const,
            observationDigest: entry.observationDigest ?? null
          });
        }
        return Object.freeze({
          actionKey: entry.actionKey,
          state: entry.state,
          observationDigest: entry.observationDigest ?? null
        });
      }));
  // The closure does not mint a second producer identity.  It carries forward
  // the exact analyzer binding so consumers can mechanically compare source
  // bytes and revision without a compatibility alias.
  const producer = analysisReadback.producer;
  const subject = Object.freeze({
    actionKey: action.actionKey,
    actionPlanDigest,
    actionPlanClosureDigest,
    operationSemanticDigest: action.operation.semanticDigest,
    trackedInputDigest,
    environmentDigest,
    analysisStage,
    dependencyEvidence
  });
  const subjectDigest = sha256(subject) as DevelopmentCriticalPathDigest;
  const openDefectClasses = Object.freeze([...new Set([
    ...analysisReadback.openDefectClasses,
    ...(action.inputClosure.length === 0 ? ['tracked-input-closure-empty'] : []),
    ...(analysisStage === 'effect-admission' && dependencyEvidence.some(({ state }) =>
      state === 'terminal-failed' || state === 'invalidated' || state === 'cancelled')
      ? ['static-analysis-dependency-not-passed'] : [])
  ])].sort(compareCodeUnits));
  const unknownOwner = analysisReadback.dimensions.find(({ dimension }) => dimension === 'unknown-ledger')?.claim.owner
    ?? analysisReadback.ownerRegistry.records[0];
  if (unknownOwner === undefined) {
    fail('static closure unknown ledger', 'cannot bind an unknown without a canonical owner record.');
  }
  const unknownFor = (
    subject: string,
    missingEdge: string,
    source: string,
    blockingEffect: DevelopmentCriticalPathStaticUnknownV1['blockingEffect'],
    minimumResolution: string
  ): DevelopmentCriticalPathStaticUnknownV1 => {
    const material = Object.freeze({
      subject,
      ownerRef: unknownOwner,
      producerRef: producer,
      missingEdge,
      sourceLocations: Object.freeze([source]),
      inputRevision: producer.revision,
      requiredAuthority: 'sec-development-critical-path-static-analysis',
      blockingEffect,
      freshness: 'fresh' as const,
      invalidationPredicates: Object.freeze(['action-terminal-or-binding-drift']),
      recoveryOwner: unknownOwner,
      recovery: 'recompute-exact-static-analysis-readback',
      minimumResolution
    });
    return Object.freeze({ unknownId: sha256(material) as DevelopmentCriticalPathDigest, ...material });
  };
  const dependencyAdmissionUnknowns = analysisStage === 'effect-admission'
    && (dependencyEvidence.length !== actionPlan.dependencies.length
      || dependencyEvidence.some(({ state }) => state !== 'terminal-passed'))
    ? [unknownFor(
        'dependency-evidence',
        'dependency terminal evidence is incomplete or not passed',
        'dependencyEvidence',
        'effect-admission',
        'fresh terminal-passed dependency evidence'
      )]
    : [];
  const dimensionCoverageUnknowns = analysisReadback.dimensions.some(({ coverage }) => coverage === 'unknown')
    ? [unknownFor(
        'static-analysis-dimension-coverage',
        'dimension producer did not establish exact coverage',
        'analysisReadback.dimensions',
        'none',
        'trusted exact producer readback'
      )]
    : [];
  const actionInputUnknowns = action.inputClosure.length === 0
    ? [unknownFor(
        'action-input-closure',
        'action input closure has no exact member',
        'action.inputClosure',
        'pre-effect',
        'at least one producer-bound input digest'
      )]
    : [];
  const unknowns = Object.freeze([
    ...analysisReadback.unknowns,
    ...dimensionCoverageUnknowns,
    ...actionInputUnknowns,
    ...dependencyAdmissionUnknowns
  ].sort((left, right) => compareCodeUnits(left.unknownId, right.unknownId)));
  if (new Set(unknowns.map((entry) => entry.unknownId)).size !== unknowns.length) {
    fail('static closure unknowns', 'must not contain duplicate unknown ids.');
  }
  const blockingUnknowns = unknowns.filter((unknown) =>
    staticUnknownBlocksProofScope(unknown, analysisReadback.proofScope)
  );
  const dimensions = Object.freeze(analysisReadback.dimensions.map((dimension) => Object.freeze({
    ...dimension,
    coverage: analysisStage === 'effect-admission'
      && dependencyEvidence.length === actionPlan.dependencies.length
      && dependencyEvidence.every(({ state }) => state === 'terminal-passed')
      ? (dimension.coverage === 'bounded-census-complete'
          ? 'bounded-verified-complete' as const
          : dimension.coverage)
      : dimension.coverage
  })));
  const invalidationDigest = sha256(Object.freeze({
    actionKey: action.actionKey,
    actionPlanDigest,
    actionPlanClosureDigest,
    operationSemanticDigest: action.operation.semanticDigest,
    trackedInputDigest,
    environmentDigest
  })) as DevelopmentCriticalPathDigest;
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_SCHEMA_V1,
    proofScope: analysisReadback.proofScope,
    producer,
    actionPlan,
    analysisReadback,
    actionKey: action.actionKey,
    actionPlanDigest,
    actionPlanClosureDigest,
    operationSemanticDigest: action.operation.semanticDigest,
    environmentDigest,
    analysisStage,
    dependencyEvidence,
    subjectDigest,
    trackedInputDigest,
    dimensions,
    openDefectClasses,
    unknowns,
    status: openDefectClasses.length === 0 && blockingUnknowns.length === 0
      ? (analysisReadback.proofScope.kind === 'required'
          ? 'required-closed' as const
          : 'bounded-closed' as const)
      : 'blocked' as const,
    invalidationDigest,
    retirement: 'action-terminal-or-binding-drift' as const
  });
  return Object.freeze({ ...material, closureDigest: sha256(material) as DevelopmentCriticalPathDigest });
}

export function parseDevelopmentCriticalPathStaticClosureV1(
  value: unknown
): DevelopmentCriticalPathStaticClosureV1 {
  const input = record(value, 'static closure');
  exactKeys(input, [
    'actionKey', 'actionPlan', 'actionPlanDigest', 'actionPlanClosureDigest', 'analysisReadback', 'analysisStage', 'closureDigest',
    'dependencyEvidence', 'dimensions',
    'environmentDigest', 'invalidationDigest', 'openDefectClasses',
    'operationSemanticDigest', 'producer', 'proofScope', 'retirement', 'schema', 'status',
    'subjectDigest', 'trackedInputDigest', 'unknowns'
  ], 'static closure');
  if (input.schema !== DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_SCHEMA_V1) {
    fail('static closure.schema', 'is invalid.');
  }
  const canonical = createDevelopmentCriticalPathStaticClosureV1(
    input.actionPlan as VerificationActionPlanV2,
    input.analysisReadback as DevelopmentCriticalPathStaticAnalysisReadbackV2,
    input.actionPlanClosureDigest as DevelopmentCriticalPathDigest,
    input.analysisStage === 'effect-admission'
      ? input.dependencyEvidence as readonly VerificationActionDependencyResolutionV2[]
      : undefined
  );
  if (encodeVerificationActionDataV2(input) !== encodeVerificationActionDataV2(canonical)) {
    fail('static closure', 'content is not the producer-derived canonical receipt.');
  }
  return canonical;
}

function canonicalActionKey(value: unknown, label: string): VerificationActionKeyV2 {
  try {
    return parseVerificationActionKeyV2(encodeVerificationActionDataV2(value));
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

function canonicalPlan(value: unknown, label: string): VerificationActionPlanV2 {
  try {
    return parseVerificationActionPlanV2(encodeVerificationActionDataV2(value));
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

function stableActionPlanDigest(plan: VerificationActionPlanV2): DevelopmentCriticalPathDigest {
  return sha256(plan) as DevelopmentCriticalPathDigest;
}

function canonicalTerminal(value: unknown, label: string): VerificationActionTerminalV2 {
  try {
    return createVerificationActionTerminalV2(value);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

function canonicalActionObservation(
  value: unknown,
  expectedActionKey: VerificationActionKeyDigest
): DevelopmentCriticalPathActionObservationV1 {
  const input = record(value, 'action observation');
  const state = input.state;
  if (typeof state !== 'string' || !ACTION_STATES.has(state)) {
    fail('action observation.state', 'is unknown.');
  }
  if (input.actionKey !== expectedActionKey) {
    fail('action observation.actionKey', 'does not match the requested ActionKey.');
  }
  switch (state) {
    case 'missing':
      exactKeys(input, ['actionKey', 'state'], 'missing action observation');
      return Object.freeze({ actionKey: expectedActionKey, state: 'missing' });
    case 'stale':
      exactKeys(input, ['actionKey', 'observationDigest', 'reasonCode', 'state'], 'stale action observation');
      return Object.freeze({
        actionKey: expectedActionKey,
        state: 'stale',
        observationDigest: digest(input.observationDigest, 'stale observationDigest'),
        reasonCode: kebab(input.reasonCode, 'stale reasonCode')
      });
    case 'terminal':
      exactKeys(input, ['actionKey', 'observationDigest', 'state', 'terminal'], 'terminal action observation');
      return Object.freeze({
        actionKey: expectedActionKey,
        state: 'terminal',
        observationDigest: digest(input.observationDigest, 'terminal observationDigest'),
        terminal: canonicalTerminal(input.terminal, 'terminal action observation.terminal')
      });
    case 'in-flight':
      exactKeys(input, ['actionKey', 'authenticated', 'claimDigest', 'state'], 'in-flight action observation');
      if (typeof input.authenticated !== 'boolean') fail('in-flight authenticated', 'must be boolean.');
      return Object.freeze({
        actionKey: expectedActionKey,
        state: 'in-flight',
        claimDigest: digest(input.claimDigest, 'in-flight claimDigest'),
        authenticated: input.authenticated
      });
    case 'unknown':
      exactKeys(input, ['actionKey', 'observationDigest', 'reasonCode', 'state'], 'unknown action observation');
      return Object.freeze({
        actionKey: expectedActionKey,
        state: 'unknown',
        observationDigest: optionalDigest(input.observationDigest, 'unknown observationDigest'),
        reasonCode: kebab(input.reasonCode, 'unknown reasonCode')
      });
  }
  fail('action observation.state', 'is unreachable.');
}

function canonicalDependencyResolutions(
  value: readonly VerificationActionDependencyResolutionV2[],
  plan: VerificationActionPlanV2
): readonly VerificationActionDependencyResolutionV2[] {
  if (!Array.isArray(value)) fail('dependency resolutions', 'must be an array.');
  const expected = new Set(plan.dependencies.map(({ actionKey }) => actionKey));
  const seen = new Set<VerificationActionKeyDigest>();
  const normalized = value.map((entry, index) => {
    const item = record(entry, `dependency resolutions[${index}]`);
    const actionKey = digest(item.actionKey, `dependency resolutions[${index}].actionKey`);
    if (!expected.has(actionKey)) fail(`dependency resolutions[${index}]`, 'contains an undeclared dependency.');
    if (seen.has(actionKey)) fail('dependency resolutions', `contains duplicate ${actionKey}.`);
    seen.add(actionKey);
    const state = item.state;
    const states = new Set([
      'queued', 'running', 'terminal-passed', 'terminal-failed', 'not-run',
      'unsupported', 'invalidated', 'cancelled', 'unknown'
    ]);
    if (typeof state !== 'string' || !states.has(state)) fail(`dependency resolutions[${index}].state`, 'is invalid.');
    return Object.freeze({
      actionKey,
      state: state as VerificationActionDependencyResolutionV2['state'],
      observationDigest: optionalDigest(item.observationDigest ?? null, `dependency resolutions[${index}].observationDigest`)
    });
  });
  if (seen.size !== expected.size) fail('dependency resolutions', 'must cover every declared dependency exactly once.');
  return Object.freeze(normalized.sort((left, right) => compareCodeUnits(left.actionKey, right.actionKey)));
}

function identityUnknowns(identity: DevelopmentCriticalPathMainIdentityV1): readonly string[] {
  const unknowns = [...identity.unknowns];
  if (identity.treeSha === null) unknowns.push('tree-sha');
  if (identity.policyRevision === null) unknowns.push('policy-revision');
  if (identity.toolchainRevision === null) unknowns.push('toolchain-revision');
  if (identity.providerRevision === null) unknowns.push('provider-revision');
  if (identity.environmentRevision === null) unknowns.push('environment-revision');
  if (identity.closureDigest === null) unknowns.push('closure-digest');
  return [...new Set(unknowns)].sort(compareCodeUnits);
}

function canonicalMainIdentity(value: unknown, label: string): DevelopmentCriticalPathMainIdentityV1 {
  const input = record(value, label);
  exactKeys(input, [
    'closureDigest', 'environmentRevision', 'policyRevision', 'providerRevision',
    'toolchainRevision', 'treeSha', 'unknowns'
  ], label);
  const treeSha = input.treeSha === null ? null : boundedText(input.treeSha, `${label}.treeSha`, 40);
  if (treeSha !== null && !GIT_SHA.test(treeSha)) fail(`${label}.treeSha`, 'must be a lowercase Git SHA.');
  const result: DevelopmentCriticalPathMainIdentityV1 = Object.freeze({
    treeSha,
    policyRevision: optionalRevision(input.policyRevision, `${label}.policyRevision`),
    toolchainRevision: optionalRevision(input.toolchainRevision, `${label}.toolchainRevision`),
    providerRevision: optionalRevision(input.providerRevision, `${label}.providerRevision`),
    environmentRevision: optionalRevision(input.environmentRevision, `${label}.environmentRevision`),
    closureDigest: optionalDigest(input.closureDigest, `${label}.closureDigest`),
    unknowns: canonicalTextList(input.unknowns, `${label}.unknowns`)
  });
  return result;
}

function canonicalProviderFact(value: unknown): DevelopmentCriticalPathProviderFactV1 {
  const input = record(value, 'provider fact');
  exactKeys(input, ['capability', 'required', 'unknowns'], 'provider fact');
  if (typeof input.required !== 'boolean') fail('provider fact.required', 'must be boolean.');
  const unknowns = canonicalTextList(input.unknowns, 'provider fact.unknowns');
  let capability: VerificationProviderCapabilityV1 | null = null;
  if (input.capability !== null) {
    const candidate = record(input.capability, 'provider fact.capability');
    exactKeys(candidate, [
      'availability', 'capability', 'observedAt', 'provider', 'reasonCode',
      'receiptRef', 'role', 'schema'
    ], 'provider fact.capability');
    if (candidate.schema !== VERIFICATION_PROVIDER_CAPABILITY_SCHEMA_V1) {
      fail('provider fact.capability.schema', 'is not the canonical provider capability schema.');
    }
    const availability = candidate.availability;
    if (typeof availability !== 'string' || !PROVIDER_AVAILABILITIES.has(availability as VerificationProviderAvailabilityV1)) {
      fail('provider fact.capability.availability', 'is invalid.');
    }
    const capabilityId = boundedText(candidate.capability, 'provider fact.capability.capability', 128) as VerificationProviderCapabilityIdV1;
    const provider = boundedText(candidate.provider, 'provider fact.capability.provider', 128);
    const role = boundedText(candidate.role, 'provider fact.capability.role', 64);
    const reasonCode = candidate.reasonCode === null ? null : kebab(candidate.reasonCode, 'provider fact.capability.reasonCode');
    const receiptRef = optionalDigest(candidate.receiptRef ?? null, 'provider fact.capability.receiptRef');
    const observedAt = boundedText(candidate.observedAt, 'provider fact.capability.observedAt');
    const inputForOwner: VerificationProviderCapabilityInputV1 = {
      capability: capabilityId,
      role: role as VerificationProviderRoleV1,
      provider: provider as VerificationProviderIdV1,
      availability: availability as VerificationProviderAvailabilityV1,
      reasonCode,
      receiptRef,
      observedAt
    };
    try {
      capability = createVerificationProviderCapabilityV1(inputForOwner);
    } catch (error) {
      fail('provider fact.capability', error instanceof Error ? error.message : String(error));
    }
  }
  return Object.freeze({ required: input.required, capability, unknowns });
}

function canonicalEnvironmentFact(value: unknown): DevelopmentCriticalPathEnvironmentFactV1 {
  const input = record(value, 'environment fact');
  exactKeys(input, ['environmentRevision', 'observation', 'plan', 'spec', 'unknowns'], 'environment fact');
  const unknowns = [...canonicalTextList(input.unknowns, 'environment fact.unknowns')];
  const specValue = input.spec;
  const observationValue = input.observation;
  if ((specValue === null) !== (observationValue === null)) {
    fail('environment fact', 'spec and observation must be supplied together.');
  }
  let spec: EnvironmentMaterializationSpecV1 | null = null;
  let observation: EnvironmentMaterializationObservationV1 | null = null;
  let plan: EnvironmentMaterializationPlanV1 | null = null;
  if (specValue !== null && observationValue !== null) {
    try {
      spec = parseEnvironmentMaterializationSpecV1(specValue);
      observation = parseEnvironmentMaterializationObservationV1(observationValue);
      plan = compileEnvironmentMaterializationPlanV1({ spec, observation });
    } catch (error) {
      fail('environment fact owner plan', error instanceof Error ? error.message : String(error));
    }
    if (input.plan !== null) {
      let suppliedPlan: EnvironmentMaterializationPlanV1;
      try {
        suppliedPlan = parseEnvironmentMaterializationPlanV1(input.plan);
      } catch (error) {
        fail('environment fact.plan', error instanceof Error ? error.message : String(error));
      }
      if (suppliedPlan.planDigest !== plan.planDigest) {
        fail('environment fact.plan', 'does not match the canonical environment owner plan.');
      }
    }
  } else {
    if (input.plan !== null) {
      // A structural plan without its owner inputs cannot prove the current
      // environment closure.  Preserve no unverified plan as executable fact.
      try {
        parseEnvironmentMaterializationPlanV1(input.plan);
      } catch (error) {
        fail('environment fact.plan', error instanceof Error ? error.message : String(error));
      }
      unknowns.push('environment-plan-owner-input-missing');
    }
  }
  return Object.freeze({
    plan,
    spec,
    observation,
    environmentRevision: optionalRevision(input.environmentRevision, 'environment fact.environmentRevision'),
    unknowns: Object.freeze([...new Set(unknowns)].sort(compareCodeUnits))
  });
}

function canonicalRetirementOwner(value: unknown, label: string): DevelopmentCriticalPathRetirementOwnerFactV1 {
  const input = record(value, label);
  exactKeys(input, ['eligibleResidue', 'kind', 'owner', 'receiptDigest', 'state', 'unknowns'], label);
  const kind = input.kind;
  if (typeof kind !== 'string' || !RETIREMENT_KINDS.has(kind as DevelopmentCriticalPathRetirementOwnerKindV1)) fail(`${label}.kind`, 'is invalid.');
  const state = input.state;
  if (typeof state !== 'string' || !RETIREMENT_STATES.has(state as DevelopmentCriticalPathRetirementOwnerStateV1)) fail(`${label}.state`, 'is invalid.');
  const owner = boundedText(input.owner, `${label}.owner`, 128);
  const eligibleResidue = canonicalTextList(input.eligibleResidue, `${label}.eligibleResidue`);
  const unknowns = canonicalTextList(input.unknowns, `${label}.unknowns`);
  const receiptDigest = optionalDigest(input.receiptDigest, `${label}.receiptDigest`);
  if ((state === 'settled' || state === 'eligible-residue') && receiptDigest === null) {
    fail(label, 'settled or eligible-residue state requires an owner receipt.');
  }
  if (state === 'settled' && eligibleResidue.length > 0) fail(label, 'settled state cannot carry residue.');
  if (state !== 'eligible-residue' && eligibleResidue.length > 0) fail(label, 'only eligible-residue may carry residue.');
  return Object.freeze({
    kind: kind as DevelopmentCriticalPathRetirementOwnerKindV1,
    owner,
    state: state as DevelopmentCriticalPathRetirementOwnerStateV1,
    receiptDigest,
    eligibleResidue,
    unknowns
  });
}

function canonicalMainHealthFact(value: unknown): DevelopmentCriticalPathMainHealthFactV1 {
  const input = record(value, 'MainHealth observation');
  exactKeys(input, [
    'expectedDefaultBranch', 'expectedMainSha', 'expectedMainTreeSha',
    'expectedRepository', 'expectedTrustRevision', 'ledger', 'now'
  ], 'MainHealth observation');
  const decision = resolveOrdinaryMainHealthLaneV1({
    ledger: input.ledger,
    now: boundedText(input.now, 'MainHealth observation.now'),
    expectedRepository: boundedText(
      input.expectedRepository, 'MainHealth observation.expectedRepository'
    ),
    expectedDefaultBranch: boundedText(
      input.expectedDefaultBranch, 'MainHealth observation.expectedDefaultBranch'
    ),
    expectedMainSha: gitSha(input.expectedMainSha, 'MainHealth observation.expectedMainSha'),
    expectedMainTreeSha: gitSha(
      input.expectedMainTreeSha, 'MainHealth observation.expectedMainTreeSha'
    ),
    expectedTrustRevision: gitSha(
      input.expectedTrustRevision, 'MainHealth observation.expectedTrustRevision'
    )
  });
  const ownerUnknowns = decision.observationValidity === 'valid'
    ? []
    : [`main-health-${decision.reasonCode}`];
  return Object.freeze({
    allowed: decision.allowed,
    ledgerDigest: decision.ledger?.ledgerDigest ?? null,
    healthRevision: decision.ledger?.healthRevision ?? null,
    observationValidity: decision.observationValidity,
    reasonCode: decision.reasonCode,
    status: decision.status,
    unknowns: Object.freeze(ownerUnknowns)
  });
}

function stableMainHealthProjection(input: DevelopmentCriticalPathMainHealthFactV1): object {
  // The owner ledger contains observedAt/expiresAt/producer transport.  Those
  // facts gate the owner lane before this projection; they are intentionally
  // absent from the spine semantic identity.
  return {
    status: input.status,
    allowed: input.allowed,
    observationValidity: input.observationValidity,
    reasonCode: input.reasonCode,
    healthRevision: input.healthRevision,
    unknowns: input.unknowns
  };
}

function stableProviderProjection(input: DevelopmentCriticalPathProviderFactV1): object {
  if (input.capability === null) return { required: input.required, capability: null, unknowns: input.unknowns };
  return {
    required: input.required,
    capability: {
      capability: input.capability.capability,
      provider: input.capability.provider,
      role: input.capability.role,
      availability: input.capability.availability,
      reasonCode: input.capability.reasonCode,
      receiptRef: input.capability.receiptRef
    },
    unknowns: input.unknowns
  };
}

/** Canonicalize one owner observation; this does not create a journal event. */
export function createDevelopmentCriticalPathActionObservationV1(
  input: unknown,
  actionKey: VerificationActionKeyDigest
): DevelopmentCriticalPathActionObservationV1 {
  return canonicalActionObservation(input, digest(actionKey, 'actionKey'));
}

/**
 * Partition one ActionKey into the only five legal scheduling outcomes.
 * Dependency state is consumed through the existing VerificationAction owner.
 */
export function compileDevelopmentCriticalPathActionDecisionV1(input: Readonly<{
  action: unknown;
  plan: unknown;
  observation: unknown;
  dependencies: readonly VerificationActionDependencyResolutionV2[];
}>): DevelopmentCriticalPathActionDecisionV1 {
  const action = canonicalActionKey(input.action, 'action');
  const plan = canonicalPlan(input.plan, 'plan');
  if (plan.action.actionKey !== action.actionKey) fail('plan', 'action key does not match action.');
  const observation = canonicalActionObservation(input.observation, action.actionKey);
  const dependencies = canonicalDependencyResolutions(input.dependencies, plan);
  const runnable = isVerificationActionRunnableV2(plan, dependencies);
  let disposition: DevelopmentCriticalPathActionDispositionV1;
  let terminal: VerificationActionTerminalV2 | null = null;
  let observationDigest: DevelopmentCriticalPathDigest | null = null;
  let reasonCode: string;
  if (!runnable.runnable) {
    disposition = 'blocked';
    reasonCode = 'action-dependencies-not-passed';
  } else if (observation.state === 'terminal') {
    terminal = observation.terminal;
    observationDigest = observation.observationDigest;
    if (terminal.status === 'passed') {
      disposition = 'reuse-pass';
      reasonCode = 'fresh-terminal-pass';
    } else if (terminal.status === 'failed') {
      disposition = 'reuse-failure';
      reasonCode = 'fresh-terminal-failure';
    } else {
      disposition = 'blocked';
      reasonCode = 'terminal-status-not-reusable';
    }
  } else if (observation.state === 'in-flight') {
    if (!observation.authenticated) {
      disposition = 'blocked';
      reasonCode = 'in-flight-not-authenticated';
    } else {
      disposition = 'join';
      observationDigest = observation.claimDigest;
      reasonCode = 'authenticated-in-flight';
    }
  } else if (observation.state === 'missing' || observation.state === 'stale') {
    disposition = 'execute';
    reasonCode = observation.state === 'missing' ? 'action-missing' : 'action-stale';
    observationDigest = observation.state === 'stale' ? observation.observationDigest : null;
  } else {
    disposition = 'blocked';
    reasonCode = 'action-observation-unknown';
    observationDigest = observation.observationDigest;
  }
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_ACTION_DECISION_SCHEMA_V1,
    actionKey: action.actionKey,
    actionPlanDigest: stableActionPlanDigest(plan),
    disposition,
    terminal,
    observationDigest,
    reasonCode
  });
  return Object.freeze({ ...material, decisionDigest: sha256(material) as DevelopmentCriticalPathDigest });
}

/**
 * Compare candidate/main semantic closure.  A matching tree alone is never
 * enough; every declared policy/tool/provider/environment/closure revision
 * must match, and any explicit or implicit unknown fails closed.
 */
export function compileDevelopmentCriticalPathMainDeltaV1(input: Readonly<{
  main: unknown;
  candidate: unknown;
}>): DevelopmentCriticalPathMainDeltaV1 {
  const main = canonicalMainIdentity(input.main, 'main identity');
  const candidate = canonicalMainIdentity(input.candidate, 'candidate identity');
  const unknowns = [...new Set([
    ...identityUnknowns(main).map((value) => `main:${value}`),
    ...identityUnknowns(candidate).map((value) => `candidate:${value}`)
  ])].sort(compareCodeUnits);
  let disposition: DevelopmentCriticalPathMainDeltaDispositionV1;
  let reasonCode: DevelopmentCriticalPathMainDeltaReasonV1;
  if (unknowns.length > 0) {
    disposition = 'blocked';
    reasonCode = 'unknown-identity';
  } else if (main.treeSha === candidate.treeSha && main.policyRevision === candidate.policyRevision &&
      main.toolchainRevision === candidate.toolchainRevision && main.providerRevision === candidate.providerRevision &&
      main.environmentRevision === candidate.environmentRevision && main.closureDigest === candidate.closureDigest) {
    disposition = 'tree-equivalent';
    reasonCode = 'tree-equivalent-closure-equal';
  } else if (main.treeSha !== candidate.treeSha) {
    disposition = 'changed';
    reasonCode = 'tree-changed';
  } else if (main.policyRevision !== candidate.policyRevision) {
    disposition = 'changed';
    reasonCode = 'policy-revision-changed';
  } else if (main.toolchainRevision !== candidate.toolchainRevision) {
    disposition = 'changed';
    reasonCode = 'toolchain-revision-changed';
  } else if (main.providerRevision !== candidate.providerRevision) {
    disposition = 'changed';
    reasonCode = 'provider-revision-changed';
  } else if (main.environmentRevision !== candidate.environmentRevision) {
    disposition = 'changed';
    reasonCode = 'environment-revision-changed';
  } else {
    disposition = 'changed';
    reasonCode = 'closure-changed';
  }
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_MAIN_DELTA_SCHEMA_V1,
    disposition,
    reasonCode,
    mainHealthRequired: disposition !== 'tree-equivalent',
    main,
    candidate
  });
  return Object.freeze({ ...material, decisionDigest: sha256(material) as DevelopmentCriticalPathDigest });
}

/** Compose operational terminal versus exact eligible GC pending. */
export function compileDevelopmentCriticalPathRetirementV1(input: Readonly<{
  owners: readonly unknown[];
  activeNamespaces: readonly string[];
  unknowns: readonly string[];
}>): DevelopmentCriticalPathRetirementDecisionV1 {
  if (!Array.isArray(input.owners) || input.owners.length === 0) fail('retirement owners', 'must contain at least one owner fact.');
  const owners = input.owners.map((entry, index) => canonicalRetirementOwner(entry, `retirement owners[${index}]`));
  const ownerIds = owners.map((entry) => `${entry.kind}\0${entry.owner}`);
  if (new Set(ownerIds).size !== ownerIds.length) fail('retirement owners', 'must not contain duplicate owner identities.');
  owners.sort((left, right) => compareCodeUnits(`${left.kind}\0${left.owner}`, `${right.kind}\0${right.owner}`));
  const activeNamespaces = canonicalTextList(input.activeNamespaces, 'retirement activeNamespaces');
  const unknowns = canonicalTextList(input.unknowns, 'retirement unknowns');
  const ownerUnknowns = owners.flatMap((owner) => owner.unknowns.map((unknown) => `${owner.kind}:${owner.owner}:${unknown}`));
  const allUnknowns = [...new Set([...unknowns, ...ownerUnknowns])].sort(compareCodeUnits);
  const blockers: string[] = [];
  if (allUnknowns.length > 0) blockers.push('retirement-unknown');
  if (activeNamespaces.length > 0) blockers.push('active-namespace-remains');
  if (owners.some((owner) => owner.state === 'blocked')) blockers.push('owner-blocked');
  if (owners.some((owner) => owner.state === 'unknown')) blockers.push('owner-unknown');
  const eligibleResidue = owners.flatMap((owner) => owner.eligibleResidue.map((entry) => `${owner.kind}:${owner.owner}:${entry}`)).sort(compareCodeUnits);
  let disposition: DevelopmentCriticalPathRetirementDispositionV1;
  if (blockers.length > 0) {
    disposition = 'blocked';
  } else if (eligibleResidue.length > 0) {
    disposition = 'gc-pending';
  } else {
    disposition = 'operational-terminal';
  }
  const ownerReceipts = owners
    .map((owner) => owner.receiptDigest)
    .filter((value): value is DevelopmentCriticalPathDigest => value !== null)
    .sort(compareCodeUnits);
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_RETIREMENT_SCHEMA_V1,
    disposition,
    ownerReceipts: Object.freeze(ownerReceipts),
    eligibleResidue: Object.freeze(eligibleResidue),
    activeNamespaces,
    blockers: Object.freeze([...new Set(blockers)].sort(compareCodeUnits)),
    unknowns: Object.freeze(allUnknowns)
  });
  return Object.freeze({ ...material, decisionDigest: sha256(material) as DevelopmentCriticalPathDigest });
}

function blockedProjectionReason(
  staticClosure: DevelopmentCriticalPathStaticClosureV1,
  action: DevelopmentCriticalPathActionDecisionV1,
  mainDelta: DevelopmentCriticalPathMainDeltaV1,
  mainHealth: DevelopmentCriticalPathMainHealthFactV1,
  environment: DevelopmentCriticalPathEnvironmentFactV1,
  provider: DevelopmentCriticalPathProviderFactV1,
  retirement: DevelopmentCriticalPathRetirementDecisionV1 | null
): {
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly blockingUnknowns: readonly string[];
} {
  const blockers: string[] = [];
  const blockingUnknowns: string[] = [];
  const unknowns: string[] = [
    ...staticClosure.unknowns.map((value) =>
      `static-closure:${value.subject}:${value.missingEdge}`),
    ...mainHealth.unknowns.map((value) => `main-health:${value}`)
  ];
  for (const unknown of staticClosure.unknowns) {
    const summary = `static-closure:${unknown.subject}:${unknown.missingEdge}`;
    if (staticUnknownBlocksProofScope(unknown, staticClosure.proofScope)) {
      blockingUnknowns.push(summary);
    }
  }
  blockingUnknowns.push(...mainHealth.unknowns.map((value) => `main-health:${value}`));
  if (staticClosure.status === 'blocked') blockers.push('pre-effect-static-closure-blocked');
  if (staticClosure.openDefectClasses.length > 0) {
    const staticDefects = staticClosure.openDefectClasses.map((value) => `static-defect:${value}`);
    unknowns.push(...staticDefects);
    blockingUnknowns.push(...staticDefects);
  }
  if (mainDelta.disposition === 'blocked') blockers.push('main-delta-unknown');
  if (mainHealth.observationValidity !== 'valid' || mainHealth.ledgerDigest === null) blockers.push('main-health-invalid');
  else if (!mainHealth.allowed) blockers.push('main-health-ineligible');
  // Environment materialization and provider capability are execution-only
  // prerequisites. A fresh terminal already binds the environment that
  // produced it, and an authenticated in-flight claim is owned by the
  // provider that started it. Requiring today's provider for reuse/join would
  // turn offline operation into needless reacquisition and violate
  // RequiredClosure ∩ MissingOrStale.
  if (action.disposition === 'execute') {
    const executionUnknowns = [
      ...environment.unknowns.map((value) => `environment:${value}`),
      ...provider.unknowns.map((value) => `provider:${value}`)
    ];
    unknowns.push(...executionUnknowns);
    blockingUnknowns.push(...executionUnknowns);
    if (environment.environmentRevision === null) {
      unknowns.push('environment:environment-revision');
      blockingUnknowns.push('environment:environment-revision');
    }
    if (environment.plan === null) blockers.push('environment-blocked');
    else if (environment.plan.disposition === 'blocked') blockers.push('environment-blocked');
    // Every physical Action start crosses a provider boundary. `required` is
    // retained as a consumer projection but cannot be used to bypass the
    // canonical provider capability on an execute disposition.
    if (provider.capability === null) blockers.push('provider-unresolved');
    else if (provider.capability.availability === 'unavailable') blockers.push('provider-unavailable');
    else if (provider.capability.availability === 'degraded') blockers.push('provider-degraded');
    else if (provider.capability.availability === 'unknown') blockers.push('provider-unresolved');
  }
  if (retirement?.disposition === 'blocked') {
    blockers.push(...retirement.blockers);
    blockingUnknowns.push(...retirement.unknowns.map((value) => `retirement:${value}`));
  }
  if (retirement?.unknowns.length) unknowns.push(...retirement.unknowns.map((value) => `retirement:${value}`));
  return Object.freeze({
    blockers: Object.freeze([...new Set(blockers)].sort(compareCodeUnits)),
    unknowns: Object.freeze([...new Set(unknowns)].sort(compareCodeUnits)),
    blockingUnknowns: Object.freeze([...new Set(blockingUnknowns)].sort(compareCodeUnits))
  });
}

/**
 * Full pure projection used by tooling.  The owner lane decision is consumed
 * as a fact; its timestamp/transport fields never enter this digest.
 */
export function compileDevelopmentCriticalPathV1(input: Readonly<{
  staticClosure: unknown;
  action: unknown;
  plan: unknown;
  observation: unknown;
  dependencies: readonly VerificationActionDependencyResolutionV2[];
  mainDelta: DevelopmentCriticalPathMainDeltaV1;
  mainHealth: unknown;
  environment: unknown;
  provider: unknown;
  retirement?: Readonly<{
    owners: readonly unknown[];
    activeNamespaces: readonly string[];
    unknowns: readonly string[];
  }>;
}>): DevelopmentCriticalPathProjectionV1 {
  const staticClosure = parseDevelopmentCriticalPathStaticClosureV1(input.staticClosure);
  const action = compileDevelopmentCriticalPathActionDecisionV1({
    action: input.action,
    plan: input.plan,
    observation: input.observation,
    dependencies: input.dependencies
  });
  if (staticClosure.actionKey !== action.actionKey) {
    fail('staticClosure.actionKey', 'does not bind the composed Action.');
  }
  if (staticClosure.actionPlanDigest !== action.actionPlanDigest) {
    fail('staticClosure.actionPlanDigest', 'does not bind the composed Action plan.');
  }
  const mainDelta = input.mainDelta;
  if (mainDelta.schema !== DEVELOPMENT_CRITICAL_PATH_MAIN_DELTA_SCHEMA_V1) fail('mainDelta', 'schema is invalid.');
  const mainHealth = canonicalMainHealthFact(input.mainHealth);
  const environment = canonicalEnvironmentFact(input.environment);
  const provider = canonicalProviderFact(input.provider);
  const retirement = input.retirement === undefined ? null : compileDevelopmentCriticalPathRetirementV1(input.retirement);
  const closure = blockedProjectionReason(
    staticClosure, action, mainDelta, mainHealth, environment, provider, retirement
  );
  let overallDisposition = action.disposition;
  if (closure.blockers.length > 0 || closure.blockingUnknowns.length > 0) overallDisposition = 'blocked';
  const material = Object.freeze({
    schema: DEVELOPMENT_CRITICAL_PATH_SCHEMA_V1,
    staticClosure,
    action,
    mainDelta,
    retirement,
    overallDisposition,
    blockers: closure.blockers,
    unknowns: closure.unknowns
  });
  return Object.freeze({ ...material, semanticDigest: sha256({
    schema: material.schema,
    staticClosure: material.staticClosure,
    action: material.action,
    mainDelta: material.mainDelta,
    retirement: material.retirement,
    overallDisposition: material.overallDisposition,
    blockers: material.blockers,
    unknowns: material.unknowns,
    mainHealth: stableMainHealthProjection(mainHealth),
    environment: {
      environmentRevision: environment.environmentRevision,
      plan: environment.plan === null ? null : {
        specDigest: environment.plan.specDigest,
        disposition: environment.plan.disposition,
        phase: environment.plan.phase ?? null,
        reason: environment.plan.reason,
        missingComponents: environment.plan.missingComponents ?? [],
        planDigest: environment.plan.planDigest
      },
      unknowns: environment.unknowns
    },
    provider: stableProviderProjection(provider)
  }) as DevelopmentCriticalPathDigest });
}

/** Typed assertion used by consumers before treating a projection as stable. */
export function assertDevelopmentCriticalPathProjectionV1(
  value: DevelopmentCriticalPathProjectionV1
): DevelopmentCriticalPathProjectionV1 {
  if (value.schema !== DEVELOPMENT_CRITICAL_PATH_SCHEMA_V1) fail('projection', 'schema is invalid.');
  if (!DIGEST.test(value.semanticDigest)) fail('projection.semanticDigest', 'is invalid.');
  return value;
}
