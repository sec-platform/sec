import { expect, test } from 'bun:test';

import {
  assertSemanticMutationPlanInvariant,
  assertSemanticMutationResultInvariant,
  buildEngineeringIR,
  buildFactDelta,
  buildImpactPropagation,
  buildSemanticMutationResult,
  buildSemanticMutationVerificationExecutionRef,
  buildSemanticMutationVerificationPlanningContext,
  buildValidatedEngineeringIR,
  normalizeSemanticMutationRequest,
  planSemanticMutation,
  preflightSemanticMutation,
  validateEngineeringIR,
  type BuildEngineeringIRInput,
  type SemanticMutationAuthorizationContextV2,
  type SemanticMutationPlanV2,
  type SemanticMutationRequestV2,
  type VerificationRequirementV1
} from '../../platform/compiler/index.ts';
import { factAssertionId } from '../../platform/compiler/ir/ir-fact-store.ts';
import { digest, semanticRevisionPayload } from '../../platform/compiler/ir/ir-revision.ts';
import {
  canonicalVerificationUnion,
  sha256
} from '../../platform/compiler/semantic-mutation/canonical.ts';
import {
  semanticMutationAssertionDigest,
  semanticMutationEntityDigest
} from '../../platform/compiler/semantic-mutation/match-conditions.ts';
import { expectationFromFactDelta } from '../../platform/compiler/semantic-mutation/match-expectation.ts';
import { semanticMutationAuthorizationRevision } from '../../platform/compiler/semantic-mutation/normalize-request.ts';
import { semanticMutationPlanRevision } from '../../platform/compiler/semantic-mutation/plan-semantic-mutation.ts';
import { semanticMutationResultRevision } from '../../platform/compiler/semantic-mutation/semantic-mutation-result.ts';
import { semanticMutationRequiredVerificationDigest } from '../../platform/compiler/semantic-mutation/verification-policy.ts';
import type { FactDeltaEndpointContext } from '../../platform/shared/engineering-ir-types.ts';
import type { LoadedSemanticContract } from '../../platform/shared/semantic-contract-types.ts';

function contract(withTransition: boolean): LoadedSemanticContract {
  return {
    blockId: 'item/basic',
    contractPath: 'source/model/item.yaml',
    contract: {
      formatVersion: '1',
      id: 'item-core',
      namespace: 'item',
      entities: [{ id: 'Item', fields: [{ id: 'status', type: 'ItemStatus', mutable: true }] }],
      states: [{
        id: 'item-status',
        entity: 'Item',
        field: 'status',
        owner: 'ItemStateMachine',
        values: ['closed', 'open'],
        transitions: withTransition ? [{ from: 'open', to: 'closed', by: 'closeItem' }] : []
      }],
      responsibilities: [{
        id: 'ItemStateMachine',
        role: 'Own item status',
        owns: ['Item.status'],
        implements: ['closeItem'],
        dependsOn: []
      }],
      operations: [{
        id: 'closeItem',
        responsibility: 'ItemStateMachine',
        inputs: ['Item'],
        output: 'Item',
        reads: ['Item.status'],
        writes: [],
        mutates: ['Item.status'],
        requiresPolicies: [],
        requiresPermissions: [],
        performsEffects: [],
        emits: [],
        invokes: [],
        awaits: []
      }],
      events: [],
      policies: [],
      permissions: [],
      effects: [],
      scenarios: []
    }
  };
}

function buildInput(withTransition: boolean, appName = 'Mutation App'): BuildEngineeringIRInput {
  return {
    app: { id: 'mutation-app', name: appName },
    resolvedBlocks: [{
      id: 'item/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'source/model/block.manifest.yaml',
      registrySourceId: 'workspace',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: 'source/model'
    }],
    manifests: [],
    slotTasks: [],
    acceptanceIds: [],
    policyDeclarations: [],
    semanticContracts: [contract(withTransition)]
  };
}

function endpoint(
  snapshot: ReturnType<typeof buildValidatedEngineeringIR>,
  transactionId: string
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

function snapshotWithExtraTransitionAssertion() {
  const source = buildInput(true);
  const ir = structuredClone(buildEngineeringIR(source));
  const transition = ir.facts.find((fact) => fact.predicate === 'TRANSITIONS_TO')!;
  const provenance = [{ kind: 'ai' as const, sourceId: 'mutation-extra-assertion' }];
  transition.assertions.push({
    id: factAssertionId(transition.id, 'inferred', provenance),
    authority: 'inferred',
    confidence: 0.5,
    provenance,
    evidence: [],
    validFromRevision: ir.semanticRevision
  });
  transition.assertions.sort((left, right) => left.id.localeCompare(right.id));
  const semanticRevision = `sha256:${digest(semanticRevisionPayload(
    ir.graphId,
    ir.appId,
    ir.entities,
    ir.facts,
    ir.scenarios
  ))}`;
  ir.semanticRevision = semanticRevision;
  for (const fact of ir.facts) {
    for (const assertion of fact.assertions) assertion.validFromRevision = semanticRevision;
  }
  return validateEngineeringIR(ir, source);
}

function snapshotWithExtraTransitionFact() {
  const source = buildInput(true);
  source.semanticContracts![0]!.contract.states[0]!.transitions.push({
    from: 'closed',
    to: 'open',
    by: 'closeItem'
  });
  return buildValidatedEngineeringIR(source);
}

function authorization(): SemanticMutationAuthorizationContextV2 {
  const draft: Omit<SemanticMutationAuthorizationContextV2, 'authorizationRevision'> = {
    taskId: 'task:mutation',
    envelopeRevision: 'envelope:v2',
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: ['state:item:item-status'],
    allowedSourceOwnerIds: ['owner:item-core'],
    allowedPathPrefixes: ['source/model/'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  };
  return { ...draft, authorizationRevision: semanticMutationAuthorizationRevision(draft) };
}

function fixture() {
  const before = buildValidatedEngineeringIR(buildInput(false));
  const after = buildValidatedEngineeringIR(buildInput(true));
  const base = endpoint(before, 'tx:base');
  const staged = endpoint(after, 'tx:staged');
  const delta = buildFactDelta(base, staged);
  const request: SemanticMutationRequestV2 = {
    contractVersion: '2',
    requestId: 'request:add-transition',
    graphId: before.ir.graphId,
    appId: before.ir.appId,
    base: {
      transactionId: base.transactionId,
      inputRevision: base.inputRevision,
      semanticRevision: base.semanticRevision
    },
    preconditions: [],
    operations: [{
      operationId: 'operation:add-transition',
      kind: 'add-state-transition',
      contract: { namespace: 'item', contractId: 'item-core' },
      stateId: 'item-status',
      from: 'open',
      to: 'closed',
      by: 'closeItem'
    }],
    expectation: expectationFromFactDelta(delta, before, after),
    postconditions: [],
    additionalVerification: []
  };
  const auth = authorization();
  const preflight = preflightSemanticMutation({ request, base, authorization: auth });
  if (preflight.status !== 'ready') {
    throw new Error(`Expected ready preflight: ${JSON.stringify(preflight)}`);
  }
  const impact = buildImpactPropagation({ delta, from: base, to: staged });
  const impactVerification: VerificationRequirementV1[] = impact.verification.map((entry) => entry.kind === 'acceptance'
    ? { kind: 'acceptance', acceptanceEntityId: entry.acceptanceEntityId }
    : { kind: 'selector', selector: entry.selector });
  const requiredVerification = canonicalVerificationUnion(
    impactVerification,
    [{ kind: 'pass', passId: 'verify' }]
  );
  const verificationPlanning = buildSemanticMutationVerificationPlanningContext({
    adapterId: 'verification:local',
    adapterRevision: 'verification:local:v1',
    impactRevision: impact.impactRevision,
    uncertaintyStatus: 'covered',
    capabilities: requiredVerification.map((requirement) => ({
      requirement,
      status: 'runnable',
      isolated: true
    }))
  }, requiredVerification);
  const preparation = {
    status: 'prepared' as const,
    preflightRevision: preflight.preflightRevision,
    sourceChanges: [{
      ownerId: 'owner:item-core',
      adapterId: 'semantic-contract-yaml',
      adapterRevision: 'semantic-contract-yaml-v1',
      relativePath: 'source/model/item.yaml',
      beforeByteDigest: sha256('before'),
      stagedByteDigest: sha256('after'),
      invalidationFromStage: 'resolve' as const
    }] as const,
    staged,
    rollbackManifestDigest: sha256('rollback')
  };
  return { before, after, base, staged, delta, request, auth, preflight, impact, requiredVerification, verificationPlanning, preparation };
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value as Record<string, unknown>)) expectDeepFrozen(nested);
}

test('request normalization is strict, deterministic, non-mutating, and deeply frozen', () => {
  const { request } = fixture();
  const json = JSON.stringify(request);
  const first = normalizeSemanticMutationRequest(request);
  const second = normalizeSemanticMutationRequest(structuredClone(request));

  expect(first.requestRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(JSON.stringify(request)).toBe(json);
  expectDeepFrozen(first);
  expect(() => normalizeSemanticMutationRequest({ ...request, risk: 'low' })).toThrow('unknown fields');
  expect(() => normalizeSemanticMutationRequest({ ...request, requestId: ' whitespace ' })).toThrow('trimmed non-empty');
  expect(() => normalizeSemanticMutationRequest({
    ...request,
    additionalVerification: [{ kind: 'selector', selector: '!skip' }]
  })).toThrow('cannot be negative');
});

test('preflight binds base, authorization, conditions, registry authority, and revision', () => {
  const value = fixture();
  const repeated = preflightSemanticMutation({ request: value.request, base: value.base, authorization: value.auth });
  expect(repeated).toEqual(value.preflight);
  expect(value.preflight.preflightRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expectDeepFrozen(value.preflight);

  const stale = preflightSemanticMutation({
    request: value.request,
    base: { ...value.base, transactionId: 'tx:stale' },
    authorization: value.auth
  });
  expect(stale).toMatchObject({ status: 'rejected', rejectedAt: 'base' });
  expect(stale.diagnostics[0]?.code).toBe('SEMANTIC-MUTATION-002');

  const unauthorizedDraft = { ...value.auth, allowedTargetEntityIds: [] };
  const unauthorized = {
    ...unauthorizedDraft,
    authorizationRevision: semanticMutationAuthorizationRevision(unauthorizedDraft)
  };
  const denied = preflightSemanticMutation({ request: value.request, base: value.base, authorization: unauthorized });
  expect(denied).toMatchObject({ status: 'rejected', rejectedAt: 'source-resolution' });
  expect(denied.diagnostics[0]?.code).toBe('SEMANTIC-MUTATION-004');
});

test('preflight freezes entity, fact, and assertion condition variants plus operation conflicts', () => {
  const value = fixture();
  const entity = value.before.ir.entities.find((entry) => entry.id === 'state:item:item-status')!;
  const fact = value.before.ir.facts.find((entry) => entry.subject === entity.id && entry.predicate === 'GUARANTEES')!;
  const assertion = fact.assertions[0]!;
  const requestWithConditions: SemanticMutationRequestV2 = {
    ...value.request,
    preconditions: [
      {
        conditionId: 'condition:a-entity',
        kind: 'entity',
        entityId: entity.id,
        exists: true,
        entityKind: 'state',
        canonicalEntityDigest: semanticMutationEntityDigest(entity)
      },
      {
        conditionId: 'condition:b-fact',
        kind: 'fact',
        fact: { subject: fact.subject, predicate: fact.predicate, object: fact.object },
        exists: true
      },
      {
        conditionId: 'condition:c-assertion',
        kind: 'assertion',
        fact: { subject: fact.subject, predicate: fact.predicate, object: fact.object },
        assertionId: assertion.id,
        exists: true,
        canonicalAssertionDigest: semanticMutationAssertionDigest(assertion)
      }
    ]
  };
  expect(preflightSemanticMutation({
    request: requestWithConditions,
    base: value.base,
    authorization: value.auth
  }).status).toBe('ready');

  const assertionCondition = requestWithConditions.preconditions[2];
  if (assertionCondition?.kind !== 'assertion') throw new Error('Missing assertion condition');
  const staleAssertion: SemanticMutationRequestV2 = {
    ...requestWithConditions,
    preconditions: [
      ...requestWithConditions.preconditions.slice(0, 2),
      { ...assertionCondition, canonicalAssertionDigest: sha256('stale-assertion') }
    ]
  };
  const conditionRejected = preflightSemanticMutation({
    request: staleAssertion,
    base: value.base,
    authorization: value.auth
  });
  expect(conditionRejected).toMatchObject({ status: 'rejected', rejectedAt: 'precondition' });
  expect(conditionRejected.diagnostics[0]?.code).toBe('SEMANTIC-MUTATION-003');

  const conflicting: SemanticMutationRequestV2 = {
    ...value.request,
    operations: [
      { ...value.request.operations[0]!, operationId: 'operation:a' },
      { ...value.request.operations[0]!, operationId: 'operation:b' }
    ]
  };
  const conflictRejected = preflightSemanticMutation({ request: conflicting, base: value.base, authorization: value.auth });
  expect(conflictRejected).toMatchObject({ status: 'rejected', rejectedAt: 'transform' });
  expect(conflictRejected.diagnostics[0]?.code).toBe('SEMANTIC-MUTATION-006');

  const missingBy = {
    ...value.request,
    operations: [{ ...value.request.operations[0]!, by: 'missingOperation' }]
  };
  const byRejected = preflightSemanticMutation({ request: missingBy, base: value.base, authorization: value.auth });
  expect(byRejected).toMatchObject({ status: 'rejected', rejectedAt: 'source-resolution' });
  expect(byRejected.diagnostics[0]?.code).toBe('SEMANTIC-MUTATION-004');
});

test('planner accepts only the exact registry effect and conservative isolated verification union', () => {
  const value = fixture();
  const input = {
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: value.preparation,
    verificationPlanning: value.verificationPlanning
  };
  const beforeJson = JSON.stringify(input);
  const plan = planSemanticMutation(input);
  const repeated = planSemanticMutation(structuredClone(input));

  expect(plan.status).toBe('ready');
  if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
  expect(plan.risk).toBe('high');
  expect(plan.actualDelta.added).toHaveLength(2);
  expect(plan.actualDelta.removed).toEqual([]);
  expect(plan.actualDelta.changed).toEqual([]);
  expect(plan.requiredVerification).toEqual(value.requiredVerification);
  expect(plan.sourceChanges[0].invalidationFromStage).toBe('resolve');
  expect(plan.planRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(JSON.stringify(repeated)).toBe(JSON.stringify(plan));
  expect(JSON.stringify(input)).toBe(beforeJson);
  expectDeepFrozen(plan);
  expect(() => assertSemanticMutationPlanInvariant(plan)).not.toThrow();

  const blockedPlanning = buildSemanticMutationVerificationPlanningContext({
    adapterId: 'verification:local',
    adapterRevision: 'verification:local:v1',
    impactRevision: value.impact.impactRevision,
    uncertaintyStatus: 'blocked',
    capabilities: value.requiredVerification.map((requirement) => ({ requirement, status: 'runnable', isolated: true }))
  }, value.requiredVerification);
  const blocked = planSemanticMutation({ ...input, verificationPlanning: blockedPlanning });
  expect(blocked).toMatchObject({ status: 'rejected', rejectedAt: 'impact-verification', risk: 'high' });
  expect(blocked.diagnostics.some((entry) => entry.code === 'SEMANTIC-MUTATION-010')).toBe(true);

  for (const capabilities of [
    [],
    value.requiredVerification.map((requirement) => ({ requirement, status: 'non-runnable' as const, isolated: true })),
    value.requiredVerification.map((requirement) => ({ requirement, status: 'runnable' as const, isolated: false }))
  ]) {
    const invalidPlanning = buildSemanticMutationVerificationPlanningContext({
      adapterId: 'verification:local',
      adapterRevision: 'verification:local:v1',
      impactRevision: value.impact.impactRevision,
      uncertaintyStatus: 'covered',
      capabilities
    }, value.requiredVerification);
    const rejected = planSemanticMutation({ ...input, verificationPlanning: invalidPlanning });
    expect(rejected).toMatchObject({ status: 'rejected', rejectedAt: 'impact-verification' });
    expect(rejected.diagnostics.some((entry) => entry.code === 'SEMANTIC-MUTATION-010')).toBe(true);
  }

  const stalePreparation = planSemanticMutation({
    ...input,
    preparation: { ...value.preparation, preflightRevision: sha256('stale') }
  });
  expect(stalePreparation).toMatchObject({ status: 'rejected', rejectedAt: 'cas' });

  const pathRejected = planSemanticMutation({
    ...input,
    preparation: {
      status: 'rejected',
      preflightRevision: value.preflight.preflightRevision,
      rejectedAt: 'path',
      diagnostics: [{
        origin: 'semantic-mutation',
        code: 'SEMANTIC-MUTATION-005',
        stage: 'path',
        message: 'Resolved authoring path was rejected'
      }]
    }
  });
  expect(pathRejected).toMatchObject({ status: 'rejected', rejectedAt: 'path', sourceChanges: [] });
  expect('staged' in pathRejected).toBe(false);
});

test('expectation and operation allowlist reject missing, extra, and entity drift', () => {
  const value = fixture();
  const missingExpectation = {
    ...value.request,
    expectation: { ...value.request.expectation, addedFacts: value.request.expectation.addedFacts.slice(1) }
  };
  const normalized = normalizeSemanticMutationRequest(missingExpectation);
  expect(normalized.expectation.addedFacts).toHaveLength(1);
  const preflight = preflightSemanticMutation({ request: missingExpectation, base: value.base, authorization: value.auth });
  if (preflight.status !== 'ready') throw new Error(JSON.stringify(preflight));
  const rejected = planSemanticMutation({
    request: missingExpectation,
    base: value.base,
    authorization: value.auth,
    preparation: { ...value.preparation, preflightRevision: preflight.preflightRevision },
    verificationPlanning: value.verificationPlanning
  });
  expect(rejected).toMatchObject({ status: 'rejected', rejectedAt: 'expectation' });
  expect(rejected.diagnostics.some((entry) => entry.code === 'SEMANTIC-MUTATION-009')).toBe(true);
  expect('impact' in rejected).toBe(false);

  const driftAfter = buildValidatedEngineeringIR(buildInput(true, 'Mutation App Drift'));
  const driftStaged = endpoint(driftAfter, 'tx:staged-drift');
  const driftPlan = planSemanticMutation({
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: { ...value.preparation, staged: driftStaged },
    verificationPlanning: value.verificationPlanning
  });
  expect(driftPlan).toMatchObject({ status: 'rejected', rejectedAt: 'expectation' });
  expect(driftPlan.diagnostics.some((entry) => entry.message.includes('Entity drift'))).toBe(true);

  const extraAssertionStaged = endpoint(snapshotWithExtraTransitionAssertion(), 'tx:staged-extra-assertion');
  const extraAssertionPlan = planSemanticMutation({
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: { ...value.preparation, staged: extraAssertionStaged },
    verificationPlanning: value.verificationPlanning
  });
  expect(extraAssertionPlan).toMatchObject({ status: 'rejected', rejectedAt: 'expectation' });
  expect(extraAssertionPlan.diagnostics.some((entry) => entry.code === 'SEMANTIC-MUTATION-009')).toBe(true);

  const extraFactPlan = planSemanticMutation({
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: {
      ...value.preparation,
      staged: endpoint(snapshotWithExtraTransitionFact(), 'tx:staged-extra-fact')
    },
    verificationPlanning: value.verificationPlanning
  });
  expect(extraFactPlan).toMatchObject({ status: 'rejected', rejectedAt: 'expectation' });
  expect(extraFactPlan.diagnostics.some((entry) => entry.code === 'SEMANTIC-MUTATION-009')).toBe(true);

  const factDeltaRejected = planSemanticMutation({
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: {
      ...value.preparation,
      staged: { ...value.staged, semanticRevision: sha256('stale-staged') }
    },
    verificationPlanning: value.verificationPlanning
  });
  expect(factDeltaRejected).toMatchObject({ status: 'rejected', rejectedAt: 'fact-delta' });
  expect(factDeltaRejected.diagnostics[0]?.code).toBe('FACT-DELTA-001');
});

test('plan invariant rejects digest-correct wrong-stage shapes and empty Verification bindings', () => {
  const value = fixture();
  const plan = planSemanticMutation({
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: value.preparation,
    verificationPlanning: value.verificationPlanning
  });
  if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));

  const missingStaged = structuredClone(plan) as unknown as Record<string, unknown>;
  delete missingStaged.staged;
  const { planRevision: _missingRevision, ...missingDraft } = missingStaged;
  missingStaged.planRevision = semanticMutationPlanRevision(missingDraft as never);
  expect(() => assertSemanticMutationPlanInvariant(missingStaged as unknown as SemanticMutationPlanV2))
    .toThrow('invariants');

  const emptyAdapter = structuredClone(plan) as unknown as Record<string, unknown>;
  emptyAdapter.verificationAdapterId = '';
  const { planRevision: _adapterRevision, ...adapterDraft } = emptyAdapter;
  emptyAdapter.planRevision = semanticMutationPlanRevision(adapterDraft as never);
  expect(() => assertSemanticMutationPlanInvariant(emptyAdapter as unknown as SemanticMutationPlanV2))
    .toThrow('verification planning');

  const unknownStatus = structuredClone(plan) as unknown as Record<string, unknown>;
  unknownStatus.status = 'partial-success';
  unknownStatus.rejectedAt = 'impact-verification';
  unknownStatus.diagnostics = [{
    origin: 'semantic-mutation',
    code: 'SEMANTIC-MUTATION-010',
    stage: 'impact-verification',
    message: 'Unknown planning status must never become a public variant'
  }];
  delete unknownStatus.planRevision;
  unknownStatus.planRevision = semanticMutationPlanRevision(unknownStatus as never);
  expect(() => assertSemanticMutationPlanInvariant(unknownStatus as never)).toThrow('status');
});

test('result builder binds passed verification to exact plan, endpoint, source digest, and full union', () => {
  const value = fixture();
  const plan = planSemanticMutation({
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: value.preparation,
    verificationPlanning: value.verificationPlanning
  });
  if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
  const verification = buildSemanticMutationVerificationExecutionRef({
    adapterId: plan.verificationAdapterId,
    adapterRevision: plan.verificationAdapterRevision,
    reportRevision: sha256('verification-report'),
    planRevision: plan.planRevision,
    attempted: plan.staged,
    stagedSourceDigest: plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest: semanticMutationRequiredVerificationDigest(plan.requiredVerification),
    status: 'passed'
  });
  const accepted = buildSemanticMutationResult(plan, {
    status: 'accepted',
    transactionId: 'tx:live',
    attempted: plan.staged,
    accepted: plan.staged,
    verification: { ...verification, status: 'passed' }
  });
  expect(accepted.status).toBe('accepted');
  expect(accepted.resultRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expectDeepFrozen(accepted);
  expect(() => assertSemanticMutationResultInvariant(accepted, plan)).not.toThrow();

  for (const variant of ['plan', 'source', 'attempted', 'requirements', 'execution-revision'] as const) {
    const forged = structuredClone(accepted) as unknown as Record<string, unknown>;
    const execution = forged.verification as Record<string, unknown>;
    const { verificationExecutionRevision: _executionRevision, ...executionDraft } = execution;
    if (variant === 'plan') executionDraft.planRevision = sha256('wrong-plan');
    if (variant === 'source') executionDraft.stagedSourceDigest = sha256('wrong-source');
    if (variant === 'requirements') executionDraft.requiredVerificationDigest = sha256('wrong-requirements');
    if (variant === 'attempted') {
      const wrongAttempted = {
        ...(forged.attempted as FactDeltaEndpointContext),
        transactionId: 'tx:wrong-attempted'
      };
      forged.attempted = wrongAttempted;
      executionDraft.attempted = wrongAttempted;
    }
    const forgedExecution = buildSemanticMutationVerificationExecutionRef(executionDraft as never);
    forged.verification = variant === 'execution-revision'
      ? { ...forgedExecution, verificationExecutionRevision: sha256('wrong-execution-revision') }
      : forgedExecution;
    delete forged.resultRevision;
    forged.resultRevision = semanticMutationResultRevision(forged as never);
    expect(() => assertSemanticMutationResultInvariant(forged as never, plan)).toThrow('bind');
  }

  const publishRejected = buildSemanticMutationResult(plan, {
    status: 'rejected',
    diagnostics: [{
      origin: 'semantic-mutation',
      code: 'SEMANTIC-MUTATION-007',
      stage: 'cas',
      message: 'Live source changed before publish'
    }]
  });
  expect(publishRejected.status).toBe('rejected');
  expect(publishRejected.diagnostics.map((entry) => entry.code)).toEqual(['SEMANTIC-MUTATION-007']);

  const rejectedWrongVerification = structuredClone(publishRejected) as unknown as Record<string, unknown>;
  rejectedWrongVerification.attempted = plan.staged;
  rejectedWrongVerification.verification = buildSemanticMutationVerificationExecutionRef({
    adapterId: plan.verificationAdapterId,
    adapterRevision: plan.verificationAdapterRevision,
    reportRevision: sha256('verification-report'),
    planRevision: sha256('wrong-rejected-plan'),
    attempted: plan.staged,
    stagedSourceDigest: plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest: semanticMutationRequiredVerificationDigest(plan.requiredVerification),
    status: 'failed'
  });
  delete rejectedWrongVerification.resultRevision;
  rejectedWrongVerification.resultRevision = semanticMutationResultRevision(rejectedWrongVerification as never);
  expect(() => assertSemanticMutationResultInvariant(rejectedWrongVerification as never, plan))
    .toThrow('boundaries');

  const baseRejectedPlan = planSemanticMutation({
    request: {
      ...value.request,
      base: { ...value.request.base, transactionId: 'tx:not-current-base' }
    },
    base: value.base,
    authorization: value.auth,
    preparation: value.preparation,
    verificationPlanning: value.verificationPlanning
  });
  if (baseRejectedPlan.status !== 'rejected' || baseRejectedPlan.rejectedAt !== 'base') {
    throw new Error(JSON.stringify(baseRejectedPlan));
  }
  const baseRejectedResult = buildSemanticMutationResult(baseRejectedPlan);
  const rejectedWithLaterEvidence = structuredClone(baseRejectedResult) as unknown as Record<string, unknown>;
  rejectedWithLaterEvidence.actualDelta = plan.actualDelta;
  rejectedWithLaterEvidence.impact = plan.impact;
  delete rejectedWithLaterEvidence.resultRevision;
  rejectedWithLaterEvidence.resultRevision = semanticMutationResultRevision(rejectedWithLaterEvidence as never);
  expect(() => assertSemanticMutationResultInvariant(rejectedWithLaterEvidence as never, baseRejectedPlan))
    .toThrow('boundaries');

  const wrongAcceptedEndpoint = structuredClone(accepted) as unknown as Record<string, unknown>;
  wrongAcceptedEndpoint.accepted = {
    ...(wrongAcceptedEndpoint.accepted as FactDeltaEndpointContext),
    semanticRevision: sha256('wrong-accepted-semantic-revision')
  };
  delete wrongAcceptedEndpoint.resultRevision;
  wrongAcceptedEndpoint.resultRevision = semanticMutationResultRevision(wrongAcceptedEndpoint as never);
  expect(() => assertSemanticMutationResultInvariant(wrongAcceptedEndpoint as never, plan))
    .toThrow('terminal invariants');

  const stale = buildSemanticMutationResult(plan, {
    status: 'accepted',
    transactionId: 'tx:live',
    attempted: plan.staged,
    accepted: plan.staged,
    verification: { ...verification, planRevision: sha256('wrong'), status: 'passed' }
  });
  expect(stale.status).toBe('rejected');
  expect(stale.diagnostics.some((entry) => entry.code === 'SEMANTIC-MUTATION-010')).toBe(true);

  const rolledBack = buildSemanticMutationResult(plan, {
    status: 'rolled-back',
    transactionId: 'tx:live',
    attempted: plan.staged,
    verification: { ...verification, status: 'passed' },
    diagnostics: [{
      origin: 'semantic-mutation',
      code: 'SEMANTIC-MUTATION-011',
      stage: 'publish',
      message: 'Publish failed and exact base bytes were restored'
    }]
  });
  expect(rolledBack.status).toBe('rolled-back');
  const failedVerification = { ...verification, status: 'failed' as const };
  const failedRollback = buildSemanticMutationResult(plan, {
    status: 'rolled-back',
    transactionId: 'tx:live',
    attempted: plan.staged,
    verification: failedVerification,
    diagnostics: [{
      origin: 'semantic-mutation',
      code: 'SEMANTIC-MUTATION-011',
      stage: 'publish',
      message: 'Publish failed and exact base bytes were restored'
    }]
  } as never);
  expect(failedRollback.status).toBe('rejected');

  const forgedRollback = structuredClone(rolledBack) as unknown as Record<string, unknown>;
  const {
    verificationExecutionRevision: _verificationRevision,
    ...blockedVerification
  } = forgedRollback.verification as Record<string, unknown>;
  blockedVerification.status = 'blocked';
  forgedRollback.verification = buildSemanticMutationVerificationExecutionRef(blockedVerification as never);
  const { resultRevision: _resultRevision, ...forgedResultDraft } = forgedRollback;
  forgedRollback.resultRevision = semanticMutationResultRevision(forgedResultDraft as never);
  expect(() => assertSemanticMutationResultInvariant(forgedRollback as unknown as typeof rolledBack, plan))
    .toThrow('passed Verification');

  const unknownResultStatus = structuredClone(rolledBack) as unknown as Record<string, unknown>;
  unknownResultStatus.status = 'partial-success';
  delete unknownResultStatus.resultRevision;
  unknownResultStatus.resultRevision = semanticMutationResultRevision(unknownResultStatus as never);
  expect(() => assertSemanticMutationResultInvariant(unknownResultStatus as never, plan)).toThrow('status');
  expect(() => buildSemanticMutationResult(plan, {
    status: 'recovery-required',
    transactionId: 'tx:live',
    attempted: plan.staged,
    verification: { ...verification, status: 'passed' },
    recoveryState: 'rollback-failed',
    diagnostics: [{
      origin: 'semantic-mutation',
      code: 'SEMANTIC-MUTATION-011',
      stage: 'publish',
      message: 'Publish failed'
    }]
  })).toThrow('SEMANTIC-MUTATION-012');
});
