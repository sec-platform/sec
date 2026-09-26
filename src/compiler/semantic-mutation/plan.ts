import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import { SEMANTIC_MUTATION_CONTRACT_VERSION, SEMANTIC_MUTATION_EXPECTATION_REVISION, SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION, SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION, type SemanticMutationBase, type SemanticMutationDiagnostic, type SemanticMutationInput, type SemanticMutationPlan, type SemanticMutationRisk, type SemanticMutationSourceChange, type SemanticMutationVerificationPlanningContext, type VerificationRequirement } from '../../semantics/mutation/types.ts';
import { buildFactDelta } from '../ir/build-fact-delta.ts';
import { buildImpactPropagation } from '../semantic-impact/build-impact-propagation.ts';
import {
  canonicalDiagnostics,
  canonicalEquals,
  canonicalVerificationUnion,
  cloneAndDeepFreeze,
  diagnosticRevision,
  digestString,
  exactOwnKeys,
  isPlainObject,
  mutationDiagnostic,
  nestedDiagnostic,
  nonEmptyString,
  sha256
} from './canonical.ts';
import {
  matchSemanticMutationConditions,
  mergeSemanticMutationConditions
} from './match-conditions.ts';
import { matchSemanticMutationExpectation } from './match-expectation.ts';
import {
  normalizeSemanticMutationAuthorization,
  normalizeSemanticMutationRequest
} from './normalize-request.ts';
import {
  ADD_STATE_TRANSITION_MINIMUM_VERIFICATION,
  validateSemanticMutationOperations
} from './operation-registry.ts';
import { preflightSemanticMutation } from './preflight.ts';
import { evaluateSemanticMutationVerificationPlanning } from './verification-policy.ts';

type NonRequestPlanDraft = Exclude<SemanticMutationPlan, { readonly rejectedAt: 'request' }>;

export interface SemanticMutationPlanProducerSeamForTest {
  readonly buildFactDelta: typeof buildFactDelta;
  readonly buildImpactPropagation: typeof buildImpactPropagation;
  readonly evaluateVerificationPlanning: typeof evaluateSemanticMutationVerificationPlanning;
}

export interface SemanticMutationVerificationPlanningProducer {
  readonly produce: (input: {
    readonly staged: FactDeltaEndpointContext;
    readonly impact: ReturnType<typeof buildImpactPropagation>;
    readonly requirements: readonly VerificationRequirement[];
  }) => SemanticMutationVerificationPlanningContext |
    Promise<SemanticMutationVerificationPlanningContext>;
}

type SemanticMutationMaybeAsyncPlan = SemanticMutationPlan | Promise<SemanticMutationPlan>;

const DEFAULT_PLAN_PRODUCERS: SemanticMutationPlanProducerSeamForTest = {
  buildFactDelta,
  buildImpactPropagation,
  evaluateVerificationPlanning: evaluateSemanticMutationVerificationPlanning
};

function endpointBase(endpoint: FactDeltaEndpointContext): SemanticMutationBase {
  return {
    transactionId: endpoint.transactionId,
    inputRevision: endpoint.inputRevision,
    semanticRevision: endpoint.semanticRevision
  };
}

function impactRequirements(impact: ReturnType<typeof buildImpactPropagation>): VerificationRequirement[] {
  return impact.verification.map((recommendation) => recommendation.kind === 'acceptance'
    ? { kind: 'acceptance', acceptanceEntityId: recommendation.acceptanceEntityId }
    : { kind: 'selector', selector: recommendation.selector });
}

function planPayload(draft: Omit<NonRequestPlanDraft, 'planRevision'>): Record<string, unknown> {
  const value = draft as Omit<NonRequestPlanDraft, 'planRevision'> & {
    readonly rejectedAt?: string;
    readonly actualDelta?: { readonly deltaRevision: string };
    readonly impact?: { readonly impactRevision: string };
    readonly risk?: SemanticMutationRisk;
    readonly requiredVerification?: readonly VerificationRequirement[];
    readonly rollbackManifestDigest?: string;
    readonly staged?: SemanticMutationBase;
  };
  const hasSource = 'sourceChanges' in draft && draft.sourceChanges.length > 0;
  const hasStaged = 'staged' in draft;
  const hasDelta = 'actualDelta' in draft;
  const hasImpact = 'impact' in draft;
  const hasRisk = 'risk' in draft;
  const hasVerification = 'requiredVerification' in draft;
  const hasRollback = 'rollbackManifestDigest' in draft;
  return {
    domain: 'semantic-mutation-plan-v2',
    contractVersion: draft.contractVersion,
    status: draft.status,
    rejectedAt: draft.status === 'rejected' ? value.rejectedAt ?? '' : '',
    requestId: draft.requestId,
    requestRevision: draft.requestRevision,
    authorizationRevision: draft.authorizationRevision,
    base: draft.base,
    operationRegistryRevision: draft.operationRegistryRevision,
    expectationRevision: draft.expectationRevision,
    verificationPolicyRevision: draft.verificationPolicyRevision,
    verificationAdapterId: draft.verificationAdapterId,
    verificationAdapterRevision: draft.verificationAdapterRevision,
    verificationPlanningRevision: draft.verificationPlanningRevision,
    sourceChanges: hasSource ? draft.sourceChanges : [],
    staged: hasStaged ? value.staged : null,
    actualDeltaRevision: hasDelta ? value.actualDelta?.deltaRevision ?? '' : '',
    impactRevision: hasImpact ? value.impact?.impactRevision ?? '' : '',
    risk: hasRisk ? value.risk ?? '' : '',
    requiredVerification: hasVerification ? value.requiredVerification ?? [] : [],
    rollbackManifestDigest: hasRollback ? value.rollbackManifestDigest ?? '' : '',
    diagnostics: draft.diagnostics
  };
}

function finalizePlan(draft: Omit<NonRequestPlanDraft, 'planRevision'>): NonRequestPlanDraft {
  return cloneAndDeepFreeze({ ...draft, planRevision: sha256(planPayload(draft)) }) as NonRequestPlanDraft;
}

function baseFields(
  preflight: Exclude<ReturnType<typeof preflightSemanticMutation>, { readonly rejectedAt: 'request' }>,
  verification: SemanticMutationInput['verificationPlanning'] | undefined
) {
  return {
    contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
    requestId: preflight.requestId,
    requestRevision: preflight.requestRevision,
    authorizationRevision: preflight.authorizationRevision,
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    expectationRevision: SEMANTIC_MUTATION_EXPECTATION_REVISION,
    verificationPolicyRevision: SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION,
    verificationAdapterId: verification?.adapterId ?? '',
    verificationAdapterRevision: verification?.adapterRevision ?? '',
    verificationPlanningRevision: verification?.planningRevision ?? '',
    base: preflight.base
  } as const;
}

function earlyRejection(
  preflight: Exclude<ReturnType<typeof preflightSemanticMutation>, { readonly rejectedAt: 'request' }>,
  stage: Exclude<SemanticMutationPlan, { status: 'ready' } | { rejectedAt: 'request' } | { rejectedAt: 'fact-delta' | 'expectation' | 'impact' | 'impact-verification' }>['rejectedAt'],
  diagnostics: readonly SemanticMutationDiagnostic[]
): SemanticMutationPlan {
  return finalizePlan({
    ...baseFields(preflight, undefined),
    status: 'rejected',
    rejectedAt: stage,
    sourceChanges: [],
    diagnostics: canonicalDiagnostics(diagnostics)
  } as Omit<NonRequestPlanDraft, 'planRevision'>);
}

function validSourceChange(value: unknown): value is SemanticMutationSourceChange {
  return isPlainObject(value) && exactOwnKeys(value, [
    'ownerId',
    'adapterId',
    'adapterRevision',
    'relativePath',
    'beforeByteDigest',
    'stagedByteDigest',
    'invalidationFromStage'
  ]) && value.invalidationFromStage === 'resolve' &&
    ['ownerId', 'adapterId', 'adapterRevision', 'relativePath', 'beforeByteDigest', 'stagedByteDigest']
      .every((key) => typeof value[key] === 'string' && (value[key] as string).trim().length > 0) &&
    digestString(value.beforeByteDigest) && digestString(value.stagedByteDigest);
}

function validEndpoint(value: unknown): value is FactDeltaEndpointContext {
  return isPlainObject(value) && exactOwnKeys(value, ['transactionId', 'inputRevision', 'semanticRevision', 'snapshot']) &&
    typeof value.transactionId === 'string' && value.transactionId.trim().length > 0 &&
    typeof value.inputRevision === 'string' && value.inputRevision.trim().length > 0 &&
    typeof value.semanticRevision === 'string' && value.semanticRevision.trim().length > 0 &&
    isPlainObject(value.snapshot) && isPlainObject(value.snapshot.ir);
}

function planSemanticMutationWithProducers(
  input: SemanticMutationInput,
  producers: SemanticMutationPlanProducerSeamForTest,
  verificationPlanningProducer?: SemanticMutationVerificationPlanningProducer
): SemanticMutationMaybeAsyncPlan {
  if (!isPlainObject(input) || !exactOwnKeys(
    input,
    ['request', 'base', 'authorization', 'preparation'],
    ['verificationPlanning']
  )) {
    return preflightSemanticMutation(input as never) as Extract<SemanticMutationPlan, { readonly rejectedAt: 'request' }>;
  }
  const preflight = preflightSemanticMutation({
    request: input.request,
    base: input.base,
    authorization: input.authorization
  });
  if (preflight.rejectedAt === 'request') return preflight;
  if (preflight.status === 'rejected') {
    return earlyRejection(preflight, preflight.rejectedAt as Parameters<typeof earlyRejection>[1], preflight.diagnostics);
  }

  const request = normalizeSemanticMutationRequest(input.request);
  const authorization = normalizeSemanticMutationAuthorization(input.authorization);
  if (!isPlainObject(input.preparation) || input.preparation.preflightRevision !== preflight.preflightRevision) {
    return earlyRejection(preflight, 'cas', [mutationDiagnostic(
      'SEMANTIC-MUTATION-007',
      'cas',
      'Preparation must exactly bind the current ready preflight revision'
    )]);
  }
  if (input.preparation.status === 'rejected') {
    const rejectedAt = input.preparation.rejectedAt;
    if (!exactOwnKeys(input.preparation, ['status', 'preflightRevision', 'rejectedAt', 'diagnostics']) ||
      !Array.isArray(input.preparation.diagnostics) || input.preparation.diagnostics.length === 0 ||
      input.preparation.diagnostics.some((diagnostic) => diagnostic.stage !== rejectedAt)) {
      return earlyRejection(preflight, 'transform', [mutationDiagnostic(
        'SEMANTIC-MUTATION-006',
        'transform',
        'Rejected preparation violates its stage or non-empty diagnostic invariant'
      )]);
    }
    try {
      return earlyRejection(preflight, rejectedAt, input.preparation.diagnostics);
    } catch {
      return earlyRejection(preflight, 'transform', [mutationDiagnostic(
        'SEMANTIC-MUTATION-006',
        'transform',
        'Preparation diagnostics are not canonical, serializable, and safe for public evidence'
      )]);
    }
  }
  if (!exactOwnKeys(input.preparation, ['status', 'preflightRevision', 'sourceChanges', 'staged', 'rollbackManifestDigest']) ||
    !Array.isArray(input.preparation.sourceChanges) || input.preparation.sourceChanges.length !== 1 ||
    !validSourceChange(input.preparation.sourceChanges[0]) ||
    !validEndpoint(input.preparation.staged) ||
    !digestString(input.preparation.rollbackManifestDigest)) {
    return earlyRejection(preflight, 'transform', [mutationDiagnostic(
      'SEMANTIC-MUTATION-006',
      'transform',
      'Prepared evidence violates the single-source-change or rollback manifest invariant'
    )]);
  }
  const sourceChange = input.preparation.sourceChanges[0];
  if (!authorization.allowedSourceOwnerIds.includes(sourceChange.ownerId)) {
    return earlyRejection(preflight, 'source-resolution', [mutationDiagnostic(
      'SEMANTIC-MUTATION-004',
      'source-resolution',
      'Prepared source owner is outside trusted authorization',
      { details: { ownerId: sourceChange.ownerId } }
    )]);
  }

  const stageFields = {
    ...baseFields(preflight, undefined),
    sourceChanges: [structuredClone(sourceChange)] as [SemanticMutationSourceChange],
    staged: endpointBase(input.preparation.staged),
    rollbackManifestDigest: input.preparation.rollbackManifestDigest
  };
  let actualDelta;
  try {
    actualDelta = producers.buildFactDelta(input.base, input.preparation.staged);
  } catch (error) {
    return finalizePlan({
      ...stageFields,
      status: 'rejected',
      rejectedAt: 'fact-delta',
      diagnostics: canonicalDiagnostics([nestedDiagnostic(error, 'fact-delta', 'fact-delta')])
    } as Omit<NonRequestPlanDraft, 'planRevision'>);
  }

  const operationResult = validateSemanticMutationOperations(input.base.snapshot, request.operations, authorization);
  let expectationDiagnostics = matchSemanticMutationExpectation(
    input.base.snapshot,
    input.preparation.staged.snapshot,
    actualDelta,
    request.expectation,
    operationResult.operations
  );
  try {
    const postconditions = mergeSemanticMutationConditions(
      authorization.requiredPostconditions,
      request.postconditions
    );
    expectationDiagnostics = [
      ...expectationDiagnostics,
      ...matchSemanticMutationConditions(input.preparation.staged.snapshot, postconditions, {
        code: 'SEMANTIC-MUTATION-009',
        stage: 'expectation'
      })
    ];
  } catch {
    expectationDiagnostics.push(mutationDiagnostic(
      'SEMANTIC-MUTATION-001',
      'request',
      'Conflicting postcondition identity'
    ));
  }
  if (expectationDiagnostics.length > 0) {
    return finalizePlan({
      ...stageFields,
      status: 'rejected',
      rejectedAt: 'expectation',
      actualDelta,
      diagnostics: canonicalDiagnostics(expectationDiagnostics)
    } as Omit<NonRequestPlanDraft, 'planRevision'>);
  }

  let impact;
  try {
    impact = producers.buildImpactPropagation({
      delta: actualDelta,
      from: input.base,
      to: input.preparation.staged
    });
  } catch (error) {
    return finalizePlan({
      ...stageFields,
      status: 'rejected',
      rejectedAt: 'impact',
      actualDelta,
      diagnostics: canonicalDiagnostics([nestedDiagnostic(error, 'impact', 'impact')])
    } as Omit<NonRequestPlanDraft, 'planRevision'>);
  }

  const requiredVerification = canonicalVerificationUnion(
    impactRequirements(impact),
    ADD_STATE_TRANSITION_MINIMUM_VERIFICATION,
    authorization.minimumVerification,
    request.additionalVerification
  );
  const risk: SemanticMutationRisk = 'high';
  const finalizeVerificationPlanning = (
    verificationPlanning: SemanticMutationVerificationPlanningContext | undefined,
    producerFailed = false
  ): SemanticMutationPlan => {
    let verificationDiagnostics: readonly SemanticMutationDiagnostic[];
    if (producerFailed || verificationPlanning === undefined) {
      verificationDiagnostics = [mutationDiagnostic(
        'SEMANTIC-MUTATION-010',
        'impact-verification',
        'Verification capability planning failed'
      )];
    } else {
      try {
        verificationDiagnostics = producers.evaluateVerificationPlanning(
          verificationPlanning,
          impact,
          requiredVerification
        );
      } catch {
        verificationDiagnostics = [mutationDiagnostic(
          'SEMANTIC-MUTATION-010',
          'impact-verification',
          'Verification capability planning failed'
        )];
      }
    }
    const finalFields = {
      ...stageFields,
      ...baseFields(preflight, verificationPlanning),
      actualDelta,
      impact,
      risk,
      requiredVerification
    };
    if (verificationDiagnostics.length > 0) {
      return finalizePlan({
        ...finalFields,
        status: 'rejected',
        rejectedAt: 'impact-verification',
        diagnostics: canonicalDiagnostics(verificationDiagnostics)
      } as Omit<NonRequestPlanDraft, 'planRevision'>);
    }
    return finalizePlan({
      ...finalFields,
      status: 'ready',
      diagnostics: []
    } as Omit<NonRequestPlanDraft, 'planRevision'>);
  };

  try {
    const producedPlanning = verificationPlanningProducer?.produce({
      staged: input.preparation.staged,
      impact,
      requirements: requiredVerification
    });
    if (producedPlanning instanceof Promise) {
      return producedPlanning.then(
        (verificationPlanning) => finalizeVerificationPlanning(verificationPlanning),
        () => finalizeVerificationPlanning(input.verificationPlanning, true)
      );
    }
    return finalizeVerificationPlanning(producedPlanning ?? input.verificationPlanning);
  } catch {
    return finalizeVerificationPlanning(input.verificationPlanning, true);
  }
}

export function planSemanticMutation(input: SemanticMutationInput): SemanticMutationPlan {
  const plan = planSemanticMutationWithProducers(input, DEFAULT_PLAN_PRODUCERS);
  if (plan instanceof Promise) {
    throw new Error('Synchronous Semantic Mutation planning unexpectedly returned an async plan');
  }
  return plan;
}

/** Internal compiler composition seam; intentionally absent from the public Compiler facade. */
export async function planSemanticMutationWithVerificationPlanningProducer(
  input: SemanticMutationInput,
  producer: SemanticMutationVerificationPlanningProducer
): Promise<SemanticMutationPlan> {
  return planSemanticMutationWithProducers(input, DEFAULT_PLAN_PRODUCERS, producer);
}

/** Local-module-only deterministic failure seam. It is intentionally not re-exported by the Compiler facade. */
export function planSemanticMutationWithProducerSeamForTest(
  input: SemanticMutationInput,
  producers: SemanticMutationPlanProducerSeamForTest
): SemanticMutationPlan {
  const plan = planSemanticMutationWithProducers(input, producers);
  if (plan instanceof Promise) {
    throw new Error('Synchronous Semantic Mutation producer seam unexpectedly returned an async plan');
  }
  return plan;
}

/** Local-module-only async finalization seam. It is intentionally absent from the Compiler facade. */
export async function planSemanticMutationWithAsyncProducerSeamForTest(
  input: SemanticMutationInput,
  producers: SemanticMutationPlanProducerSeamForTest,
  verificationPlanningProducer: SemanticMutationVerificationPlanningProducer
): Promise<SemanticMutationPlan> {
  return planSemanticMutationWithProducers(input, producers, verificationPlanningProducer);
}

export function semanticMutationPlanRevision(
  draft: Omit<NonRequestPlanDraft, 'planRevision'>
): string {
  return sha256(planPayload(draft));
}

export function assertSemanticMutationPlanInvariant(plan: SemanticMutationPlan): void {
  if (plan.status === 'rejected' && plan.rejectedAt === 'request') {
    if (!exactOwnKeys(plan as unknown as Record<string, unknown>, [
      'contractVersion', 'status', 'rejectedAt', 'diagnostics', 'diagnosticRevision'
    ], ['requestId']) ||
      plan.contractVersion !== SEMANTIC_MUTATION_CONTRACT_VERSION ||
      plan.diagnostics.length === 0 ||
      !canonicalEquals(plan.diagnostics, canonicalDiagnostics(plan.diagnostics)) ||
      plan.diagnosticRevision !== diagnosticRevision(plan.diagnostics)) {
      throw new Error('Minimal request rejection violates diagnostic invariants');
    }
    return;
  }
  const commonKeys = [
    'contractVersion',
    'requestId',
    'requestRevision',
    'authorizationRevision',
    'operationRegistryRevision',
    'expectationRevision',
    'verificationPolicyRevision',
    'verificationAdapterId',
    'verificationAdapterRevision',
    'verificationPlanningRevision',
    'base',
    'planRevision',
    'status',
    'diagnostics'
  ];
  const exactKeys = (variant: readonly string[]): boolean => exactOwnKeys(
    plan as unknown as Record<string, unknown>,
    [...commonKeys, ...variant]
  );
  const baseIsValid = plan.contractVersion === SEMANTIC_MUTATION_CONTRACT_VERSION &&
    exactOwnKeys(plan.base as unknown as Record<string, unknown>, [
      'transactionId', 'inputRevision', 'semanticRevision'
    ]) &&
    nonEmptyString(plan.requestId) && digestString(plan.requestRevision) &&
    digestString(plan.authorizationRevision) &&
    plan.operationRegistryRevision === SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION &&
    plan.expectationRevision === SEMANTIC_MUTATION_EXPECTATION_REVISION &&
    plan.verificationPolicyRevision === SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION &&
    nonEmptyString(plan.base.transactionId) && nonEmptyString(plan.base.inputRevision) &&
    nonEmptyString(plan.base.semanticRevision) &&
    canonicalEquals(plan.diagnostics, canonicalDiagnostics(plan.diagnostics));
  if (!baseIsValid) throw new Error('Semantic mutation plan base or canonical diagnostics are invalid');
  if (plan.status !== 'ready' && plan.status !== 'rejected') {
    throw new Error('Semantic mutation plan status is not a frozen terminal planning status');
  }
  const { planRevision, ...draft } = plan;
  if (planRevision !== semanticMutationPlanRevision(draft as Omit<NonRequestPlanDraft, 'planRevision'>)) {
    throw new Error('Semantic mutation planRevision does not match canonical plan content');
  }
  const assertSourceStage = (): void => {
    if (plan.sourceChanges.length !== 1 || !validSourceChange(plan.sourceChanges[0]) ||
      !('staged' in plan) || !nonEmptyString(plan.staged.transactionId) ||
      !nonEmptyString(plan.staged.inputRevision) || !nonEmptyString(plan.staged.semanticRevision) ||
      !('rollbackManifestDigest' in plan) || !digestString(plan.rollbackManifestDigest)) {
      throw new Error('Staged semantic mutation plan violates source/staged/rollback invariants');
    }
  };
  const assertDeltaBinding = (): void => {
    if (!('actualDelta' in plan) || !('staged' in plan) ||
      plan.actualDelta.from.transactionId !== plan.base.transactionId ||
      plan.actualDelta.from.inputRevision !== plan.base.inputRevision ||
      plan.actualDelta.from.semanticRevision !== plan.base.semanticRevision ||
      plan.actualDelta.to.transactionId !== plan.staged.transactionId ||
      plan.actualDelta.to.inputRevision !== plan.staged.inputRevision ||
      plan.actualDelta.to.semanticRevision !== plan.staged.semanticRevision) {
      throw new Error('Semantic mutation Fact Delta does not bind plan endpoints');
    }
  };
  const assertImpactBinding = (): void => {
    if (!('impact' in plan) || !('actualDelta' in plan) || !('staged' in plan) ||
      plan.impact.deltaRevision !== plan.actualDelta.deltaRevision ||
      plan.impact.fromSemanticRevision !== plan.base.semanticRevision ||
      plan.impact.toSemanticRevision !== plan.staged.semanticRevision) {
      throw new Error('Semantic mutation Impact does not bind the canonical Fact Delta/endpoints');
    }
  };
  const assertVerification = (): void => {
    if (!nonEmptyString(plan.verificationAdapterId) || !nonEmptyString(plan.verificationAdapterRevision) ||
      !digestString(plan.verificationPlanningRevision) || !('requiredVerification' in plan) ||
      plan.requiredVerification.length === 0 ||
      !canonicalEquals(plan.requiredVerification, canonicalVerificationUnion(plan.requiredVerification))) {
      throw new Error('Semantic mutation verification planning fields are incomplete or non-canonical');
    }
  };
  if (plan.status === 'ready') {
    if (!exactKeys(['sourceChanges', 'staged', 'actualDelta', 'impact', 'risk', 'requiredVerification', 'rollbackManifestDigest']) ||
      plan.diagnostics.length !== 0 || plan.risk !== 'high') {
      throw new Error('Ready semantic mutation plan violates v1 evidence invariants');
    }
    assertSourceStage();
    assertDeltaBinding();
    assertImpactBinding();
    assertVerification();
    return;
  }
  if (plan.diagnostics.length === 0) {
    throw new Error('Rejected semantic mutation plan requires non-empty diagnostics');
  }
  const diagnosticStageOrder = [
    'request', 'base', 'precondition', 'source-resolution', 'path', 'transform', 'cas',
    'staged-rebuild', 'fact-delta', 'expectation', 'impact', 'impact-verification',
    'publish', 'rollback'
  ];
  const earliestDiagnosticStage = [...plan.diagnostics]
    .sort((left, right) => diagnosticStageOrder.indexOf(left.stage) - diagnosticStageOrder.indexOf(right.stage))[0]?.stage;
  if (earliestDiagnosticStage !== plan.rejectedAt) {
    throw new Error('Rejected semantic mutation diagnostics do not match rejectedAt precedence');
  }
  if (['base', 'precondition', 'source-resolution', 'path', 'transform', 'cas', 'staged-rebuild'].includes(plan.rejectedAt)) {
    if (!exactKeys(['rejectedAt', 'sourceChanges']) || plan.sourceChanges.length !== 0 ||
      plan.verificationAdapterId !== '' || plan.verificationAdapterRevision !== '' ||
      plan.verificationPlanningRevision !== '') {
      throw new Error('Early rejected semantic mutation plan leaks partial later-stage evidence');
    }
    return;
  }
  assertSourceStage();
  if (plan.rejectedAt === 'fact-delta') {
    if (!exactKeys(['rejectedAt', 'sourceChanges', 'staged', 'rollbackManifestDigest']) ||
      plan.verificationAdapterId !== '' || plan.verificationAdapterRevision !== '' ||
      plan.verificationPlanningRevision !== '') {
      throw new Error('Fact Delta rejection violates staged evidence boundaries');
    }
    return;
  }
  if (plan.rejectedAt === 'expectation' || plan.rejectedAt === 'impact') {
    if (!exactKeys(['rejectedAt', 'sourceChanges', 'staged', 'actualDelta', 'rollbackManifestDigest']) ||
      plan.verificationAdapterId !== '' || plan.verificationAdapterRevision !== '' ||
      plan.verificationPlanningRevision !== '') {
      throw new Error(`${plan.rejectedAt} rejection violates producer evidence boundaries`);
    }
    assertDeltaBinding();
    return;
  }
  if (plan.rejectedAt !== 'impact-verification' || !exactKeys([
    'rejectedAt', 'sourceChanges', 'staged', 'actualDelta', 'impact', 'risk',
    'requiredVerification', 'rollbackManifestDigest'
  ]) || plan.risk !== 'high') {
    throw new Error('Impact/Verification rejection violates complete evidence invariants');
  }
  assertDeltaBinding();
  assertImpactBinding();
  assertVerification();
}
