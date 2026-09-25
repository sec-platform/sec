import { expect, test } from 'bun:test';

import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION } from '../../../src/assurance/verification/contract/types.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../../src/assurance/verification/semantic-mutation/execution-ref.ts';
import { CompilerError } from '../../../src/compiler/errors.ts';
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildFactDelta } from '../../../src/compiler/ir/build-fact-delta.ts';
import { factAssertionId } from '../../../src/compiler/ir/ir-fact-store.ts';
import { rawSha256Hex, semanticRevisionPayload } from '../../../src/compiler/ir/ir-revision.ts';
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { buildImpactPropagation } from '../../../src/compiler/semantic-impact/build-impact-propagation.ts';
import {
  canonicalVerificationUnion,
  nestedDiagnostic,
  sha256
} from '../../../src/compiler/semantic-mutation/canonical.ts';
import {
  semanticMutationAssertionDigest,
  semanticMutationEntityDigest
} from '../../../src/compiler/semantic-mutation/match-conditions.ts';
import { expectationFromFactDelta } from '../../../src/compiler/semantic-mutation/match-expectation.ts';
import { normalizeSemanticMutationRequest, semanticMutationAuthorizationRevision } from '../../../src/compiler/semantic-mutation/normalize-request.ts';
import {
  assertSemanticMutationPlanInvariant, planSemanticMutation, planSemanticMutationWithAsyncProducerSeamForTest,
  planSemanticMutationWithProducerSeamForTest,
  semanticMutationPlanRevision,
  type SemanticMutationPlanProducerSeamForTest
} from '../../../src/compiler/semantic-mutation/plan.ts';
import { preflightSemanticMutation } from '../../../src/compiler/semantic-mutation/preflight.ts';
import { assertSemanticMutationResultInvariant, buildSemanticMutationResult, semanticMutationResultRevision } from '../../../src/compiler/semantic-mutation/result.ts';
import {
  buildSemanticMutationVerificationPlanningContext, evaluateSemanticMutationVerificationPlanning,
  semanticMutationRequiredVerificationDigest
} from '../../../src/compiler/semantic-mutation/verification-policy.ts';
import type { LoadedSemanticContract } from '../../../src/semantics/definitions/types.ts';
import type { FactDeltaEndpointContext } from '../../../src/semantics/engineering-ir/delta-types.ts';
import { type SemanticMutationAuthorizationContext, type SemanticMutationInput, type SemanticMutationPlan, type SemanticMutationRequest, type VerificationRequirement } from '../../../src/semantics/mutation/types.ts';
import { semanticMutationVerificationReportFixture } from '../../helpers/semantic-mutation/verification-report.ts';

function contract(withTransition: boolean): LoadedSemanticContract {
  return {
    blockId: 'item/basic',
    contractPath: 'model/item.yaml',
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
      manifestPath: 'model/block.manifest.yaml',
      registrySourceId: 'workspace',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: 'source/model'
    }],
    manifests: [],
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
  const semanticRevision = `sha256:${rawSha256Hex(semanticRevisionPayload(
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

function authorization(): SemanticMutationAuthorizationContext {
  const draft: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'> = {
    taskId: 'task:mutation',
    envelopeRevision: 'envelope:v2',
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: ['state:item:item-status'],
    allowedSourceOwnerIds: ['owner:item-core'],
    allowedPathPrefixes: ['model/'],
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
  const request: SemanticMutationRequest = {
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
  const impactVerification: VerificationRequirement[] = impact.verification.map((entry) => entry.kind === 'acceptance'
    ? { kind: 'acceptance', acceptanceEntityId: entry.acceptanceEntityId }
    : { kind: 'selector', selector: entry.selector });
  const requiredVerification = canonicalVerificationUnion(
    impactVerification,
    [{ kind: 'pass', passId: 'verify' }]
  );
  const verificationPlanning = buildSemanticMutationVerificationPlanningContext({
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
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
      relativePath: 'model/item.yaml',
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
  const requestWithConditions: SemanticMutationRequest = {
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
  const staleAssertion: SemanticMutationRequest = {
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

  const conflicting: SemanticMutationRequest = {
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
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
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
      adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
      adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
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

test('planner stops later producers at every frozen failure boundary', () => {
  const value = fixture();
  const input: SemanticMutationInput = {
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: value.preparation,
    verificationPlanning: value.verificationPlanning
  };
  const run = (
    candidate: SemanticMutationInput,
    failAt?: 'fact-delta' | 'impact'
  ) => {
    const calls = { factDelta: 0, impact: 0, verification: 0 };
    const producers: SemanticMutationPlanProducerSeamForTest = {
      buildFactDelta(...args) {
        calls.factDelta += 1;
        if (failAt === 'fact-delta') {
          throw new CompilerError('FACT-DELTA-001', 'Injected trusted Fact Delta failure');
        }
        return buildFactDelta(...args);
      },
      buildImpactPropagation(...args) {
        calls.impact += 1;
        if (failAt === 'impact') {
          throw new CompilerError('IMPACT-001', 'Injected trusted Impact failure');
        }
        return buildImpactPropagation(...args);
      },
      evaluateVerificationPlanning(...args) {
        calls.verification += 1;
        return evaluateSemanticMutationVerificationPlanning(...args);
      }
    };
    return {
      plan: planSemanticMutationWithProducerSeamForTest(candidate, producers),
      calls
    };
  };

  const preconditionRequest = {
    ...value.request,
    preconditions: [{
      conditionId: 'condition:missing-entity',
      kind: 'entity' as const,
      entityId: 'state:item:missing',
      exists: true
    }]
  };
  const precondition = run({ ...input, request: preconditionRequest });
  expect(precondition.plan).toMatchObject({ status: 'rejected', rejectedAt: 'precondition' });
  expect(precondition.calls).toEqual({ factDelta: 0, impact: 0, verification: 0 });

  for (const rejectedAt of ['transform', 'staged-rebuild'] as const) {
    const preparation = {
      status: 'rejected' as const,
      preflightRevision: value.preflight.preflightRevision,
      rejectedAt,
      diagnostics: [{
        origin: 'semantic-mutation' as const,
        code: rejectedAt === 'transform' ? 'SEMANTIC-MUTATION-006' as const : 'SEMANTIC-MUTATION-008' as const,
        stage: rejectedAt,
        message: 'Injected preparation failure'
      }]
    };
    const rejected = run({ ...input, preparation });
    expect(rejected.plan).toMatchObject({ status: 'rejected', rejectedAt });
    expect(rejected.calls).toEqual({ factDelta: 0, impact: 0, verification: 0 });
  }

  const factDelta = run(input, 'fact-delta');
  expect(factDelta.plan).toMatchObject({ status: 'rejected', rejectedAt: 'fact-delta' });
  expect(factDelta.calls).toEqual({ factDelta: 1, impact: 0, verification: 0 });

  const missingExpectationRequest = {
    ...value.request,
    expectation: { ...value.request.expectation, addedFacts: value.request.expectation.addedFacts.slice(1) }
  };
  const missingExpectationPreflight = preflightSemanticMutation({
    request: missingExpectationRequest,
    base: value.base,
    authorization: value.auth
  });
  if (missingExpectationPreflight.status !== 'ready') throw new Error(JSON.stringify(missingExpectationPreflight));
  const expectation = run({
    ...input,
    request: missingExpectationRequest,
    preparation: {
      ...value.preparation,
      preflightRevision: missingExpectationPreflight.preflightRevision
    }
  });
  expect(expectation.plan).toMatchObject({ status: 'rejected', rejectedAt: 'expectation' });
  expect(expectation.calls).toEqual({ factDelta: 1, impact: 0, verification: 0 });

  const impact = run(input, 'impact');
  expect(impact.plan).toMatchObject({ status: 'rejected', rejectedAt: 'impact' });
  expect(impact.calls).toEqual({ factDelta: 1, impact: 1, verification: 0 });

  const blockedPlanning = buildSemanticMutationVerificationPlanningContext({
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    impactRevision: value.impact.impactRevision,
    uncertaintyStatus: 'blocked',
    capabilities: value.requiredVerification.map((requirement) => ({
      requirement,
      status: 'runnable' as const,
      isolated: true
    }))
  }, value.requiredVerification);
  const verification = run({ ...input, verificationPlanning: blockedPlanning });
  expect(verification.plan).toMatchObject({ status: 'rejected', rejectedAt: 'impact-verification' });
  expect(verification.calls).toEqual({ factDelta: 1, impact: 1, verification: 1 });

  const ready = run(input);
  expect(ready.plan.status).toBe('ready');
  expect(ready.calls).toEqual({ factDelta: 1, impact: 1, verification: 1 });
});

test('async Verification finalization executes Fact Delta, Impact, and the requirement-union producer once', async () => {
  const value = fixture();
  const calls = { factDelta: 0, impact: 0, verificationPlanning: 0, verificationEvaluation: 0 };
  const plan = await planSemanticMutationWithAsyncProducerSeamForTest({
    request: value.request,
    base: value.base,
    authorization: value.auth,
    preparation: value.preparation,
    verificationPlanning: value.verificationPlanning
  }, {
    buildFactDelta(...args) {
      calls.factDelta += 1;
      return buildFactDelta(...args);
    },
    buildImpactPropagation(...args) {
      calls.impact += 1;
      return buildImpactPropagation(...args);
    },
    evaluateVerificationPlanning(...args) {
      calls.verificationEvaluation += 1;
      return evaluateSemanticMutationVerificationPlanning(...args);
    }
  }, {
    async produce({ impact, requirements }) {
      calls.verificationPlanning += 1;
      expect(impact.impactRevision).toBe(value.impact.impactRevision);
      expect(requirements).toEqual(value.requiredVerification);
      await Promise.resolve();
      return value.verificationPlanning;
    }
  });

  expect(plan.status).toBe('ready');
  expect(calls).toEqual({
    factDelta: 1,
    impact: 1,
    verificationPlanning: 1,
    verificationEvaluation: 1
  });
});

test('nested producer diagnostics preserve only trusted FACT/Impact failures and redact unknown errors', () => {
  const absolutePath = String.raw`C:\private\workspace\source.yaml`;
  const secret = 'token=do-not-publish';
  const trusted = nestedDiagnostic(
    new CompilerError('FACT-DELTA-001', `${absolutePath} ${secret}`, { absolutePath, secret }),
    'fact-delta',
    'fact-delta'
  );
  expect(trusted).toMatchObject({
    origin: 'fact-delta',
    code: 'FACT-DELTA-001',
    stage: 'fact-delta',
    message: 'Fact Delta endpoint binding failed',
    details: { redactedDetailRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }
  });
  expect(JSON.stringify(trusted)).not.toContain(absolutePath);
  expect(JSON.stringify(trusted)).not.toContain(secret);

  const diagnostics = [
    nestedDiagnostic(new Error(`${absolutePath} ${secret}`), 'fact-delta', 'fact-delta'),
    nestedDiagnostic(
      new CompilerError('VERIFY-BUILD-001', `${absolutePath} ${secret}`, { absolutePath, secret }),
      'impact',
      'impact'
    )
  ];
  expect(diagnostics).toEqual([
    {
      origin: 'fact-delta',
      code: 'COMPILER-UNKNOWN',
      stage: 'fact-delta',
      message: 'Unknown producer failure'
    },
    {
      origin: 'impact',
      code: 'IMPACT-UNKNOWN',
      stage: 'impact',
      message: 'Unknown producer failure'
    }
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain(absolutePath);
  expect(JSON.stringify(diagnostics)).not.toContain(secret);
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
  expect(() => assertSemanticMutationPlanInvariant(missingStaged as unknown as SemanticMutationPlan))
    .toThrow('invariants');

  const emptyAdapter = structuredClone(plan) as unknown as Record<string, unknown>;
  emptyAdapter.verificationAdapterId = '';
  const { planRevision: _adapterRevision, ...adapterDraft } = emptyAdapter;
  emptyAdapter.planRevision = semanticMutationPlanRevision(adapterDraft as never);
  expect(() => assertSemanticMutationPlanInvariant(emptyAdapter as unknown as SemanticMutationPlan))
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
  const verificationReport = semanticMutationVerificationReportFixture({
    adapterId: plan.verificationAdapterId,
    adapterRevision: plan.verificationAdapterRevision,
    planRevision: plan.planRevision,
    attempted: plan.staged,
    stagedSourceDigest: plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest: semanticMutationRequiredVerificationDigest(plan.requiredVerification),
    status: 'passed',
    requirements: plan.requiredVerification
  });
  const verification = buildSemanticMutationVerificationExecutionRef(verificationReport);
  const forgedExtraInput = {
    ...verificationReport,
    forgedExtra: 'must-not-enter-execution-evidence',
  };
  expect(() => buildSemanticMutationVerificationExecutionRef(forgedExtraInput as never))
    .toThrow('non-canonical schema');
  expectDeepFrozen(verification);
  const {
    verificationExecutionRevision: _verificationExecutionRevision,
    ...forgedExecutionWithoutRevision
  } = verification;
  const forgedExecutionDraft = {
    ...forgedExecutionWithoutRevision,
    forgedExtra: 'self-consistent-but-forbidden'
  };
  const forgedExecution = {
    ...forgedExecutionDraft,
    verificationExecutionRevision: sha256({
      domain: 'semantic-mutation-verification-execution-v1',
      ...forgedExecutionDraft
    })
  };
  const forgedExecutionResult = buildSemanticMutationResult(plan, {
    status: 'accepted',
    transactionId: 'tx:forged-execution',
    attempted: plan.staged,
    accepted: plan.staged,
    verification: forgedExecution as never
  });
  expect(forgedExecutionResult.status).toBe('rejected');
  expect(forgedExecutionResult.diagnostics.some((diagnostic) =>
    diagnostic.code === 'SEMANTIC-MUTATION-010')).toBe(true);
  expect(Object.hasOwn(forgedExecutionResult, 'verification')).toBe(false);
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

  for (const variant of ['plan', 'source', 'attempted', 'requirements', 'report-revision', 'execution-revision'] as const) {
    const forged = structuredClone(accepted) as unknown as Record<string, unknown>;
    const execution = forged.verification as Record<string, unknown>;
    const { verificationExecutionRevision: _executionRevision, ...executionDraft } = execution;
    if (variant === 'plan') executionDraft.planRevision = sha256('wrong-plan');
    if (variant === 'source') executionDraft.stagedSourceDigest = sha256('wrong-source');
    if (variant === 'requirements') executionDraft.requiredVerificationDigest = sha256('wrong-requirements');
    if (variant === 'report-revision') executionDraft.reportRevision = 'forged-non-sha-report';
    if (variant === 'attempted') {
      const wrongAttempted = {
        ...(forged.attempted as FactDeltaEndpointContext),
        transactionId: 'tx:wrong-attempted'
      };
      forged.attempted = wrongAttempted;
      executionDraft.attempted = wrongAttempted;
    }
    const forgedExecution = {
      ...executionDraft,
      verificationExecutionRevision: sha256({
        domain: 'semantic-mutation-verification-execution-v1',
        ...executionDraft
      })
    };
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
  rejectedWrongVerification.verification = buildSemanticMutationVerificationExecutionRef(
    semanticMutationVerificationReportFixture({
    adapterId: plan.verificationAdapterId,
    adapterRevision: plan.verificationAdapterRevision,
    planRevision: sha256('wrong-rejected-plan'),
    attempted: plan.staged,
    stagedSourceDigest: plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest: semanticMutationRequiredVerificationDigest(plan.requiredVerification),
    status: 'failed',
    requirements: plan.requiredVerification
  }));
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
  forgedRollback.verification = {
    ...blockedVerification,
    verificationExecutionRevision: sha256({
      domain: 'semantic-mutation-verification-execution-v1',
      ...blockedVerification
    })
  };
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
