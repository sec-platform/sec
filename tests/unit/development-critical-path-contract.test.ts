import { expect, test } from 'bun:test';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  compileDevelopmentCriticalPathActionDecisionV1,
  compileDevelopmentCriticalPathMainDeltaV1,
  compileDevelopmentCriticalPathNonMisleadingProjectionV1,
  compileDevelopmentCriticalPathRetirementV1,
  compileDevelopmentCriticalPathV1,
  createDevelopmentCriticalPathRequiredProofScopeV1,
  createDevelopmentCriticalPathStaticAnalysisReadbackV2,
  createDevelopmentCriticalPathStaticClosureV1,
  createDevelopmentCriticalPathWholeDeltaSubjectV1,
  createDevelopmentCriticalPathWholeDeltaUnknownV1,
  DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1,
  DEVELOPMENT_CRITICAL_PATH_STATIC_PROOF_SCOPE_V2,
  parseDevelopmentCriticalPathNonMisleadingProjectionV1,
  parseDevelopmentCriticalPathStaticAnalysisReadbackV2,
  parseDevelopmentCriticalPathStaticClosureV1,
  parseDevelopmentCriticalPathWholeDeltaSubjectV1,
  type DevelopmentCriticalPathDigest,
  type DevelopmentCriticalPathStaticProofScopeV1,
  type DevelopmentCriticalPathStaticUnknownV1
} from '../../platform/shared/development-critical-path-contract.ts';
import {
  compileEnvironmentMaterializationPlanV1,
  createEnvironmentMaterializationSpecV1,
  type EnvironmentMaterializationObservationV1,
  type EnvironmentMaterializationPlanV1
} from '../../platform/shared/environment-materialization-contract.ts';
import { createMainHealthLedgerV1 } from '../../platform/shared/main-health-contract.ts';
import {
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1,
  type VerificationActionKeyInputV2
} from '../../platform/shared/verification-action-contract.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;
const TREE_A = 'a'.repeat(40);
const TREE_B = 'b'.repeat(40);
const MAIN_SHA = 'c'.repeat(40);
const TRUST_SHA = 'd'.repeat(40);
const STATIC_PRODUCER = Object.freeze({
  identity: 'tooling/sec-dev/development-critical-path.ts',
  revision: 'sec-development-critical-path-static-analyzer-v3',
  sourceDigest: DIGEST_A
});
const STATIC_OWNER_RECORDS = Object.freeze([...DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1]
  .map((dimension) => Object.freeze({
    recordId: `test-owner-${dimension}`,
    path: `docs/test/${dimension}.md`,
    domain: `test-${dimension}`,
    owns: [`test.${dimension}`]
  }))
  .sort((left, right) => left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0));

function staticOwner(dimension: typeof DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1[number]) {
  const owner = STATIC_OWNER_RECORDS.find(({ recordId }) => recordId === `test-owner-${dimension}`);
  if (owner === undefined) throw new Error(`missing test owner ${dimension}`);
  return owner;
}

function boundedWholeDelta() {
  return createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'bounded-action-admission',
    base: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    head: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    changes: [],
    requiredOwners: [],
    ownerProjections: [],
    consumers: [],
    producer: STATIC_PRODUCER,
    unknowns: []
  });
}

function staticUnknown(
  blockingEffect: DevelopmentCriticalPathStaticUnknownV1['blockingEffect']
): DevelopmentCriticalPathStaticUnknownV1 {
  const material = {
    subject: 'test-static-successor',
    ownerRef: staticOwner('public-contract'),
    producerRef: STATIC_PRODUCER,
    missingEdge: 'test-successor-edge',
    sourceLocations: ['tests/unit/development-critical-path-contract.test.ts'],
    inputRevision: 'test-input-v1',
    requiredAuthority: 'test-authority',
    blockingEffect,
    freshness: 'fresh' as const,
    invalidationPredicates: ['test-input-drift'],
    recoveryOwner: staticOwner('public-contract'),
    recovery: 'recompute-test-receipt',
    minimumResolution: 'test-minimum-resolution'
  } as const;
  return Object.freeze({
    unknownId: sha256(material) as DevelopmentCriticalPathDigest,
    ...material
  });
}

function actionInput(overrides: Partial<VerificationActionKeyInputV2> = {}): VerificationActionKeyInputV2 {
  return {
    actionKind: 'critical-path-unit',
    producer: { identity: 'critical-path-test', revision: 'v1' },
    operation: {
      identity: 'unit',
      revision: 'v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      declaredEnvironment: []
    },
    inputClosure: [{ path: 'platform/shared/development-critical-path-contract.ts', digest: DIGEST_B }],
    environment: {
      toolchainRevision: 'bun-test',
      providerRevision: 'local',
      contractRevision: 'critical-path-v1',
      executionBudget: VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1
    },
    requiredCheapPreflightActionKeys: [],
    upstreamActionKeys: [],
    resultSchemaRevision: 'verification-result-v1',
    ...overrides,
    staticProofRequirement: overrides.staticProofRequirement ?? 'bounded-action-admission'
  };
}

function action() {
  return createVerificationActionKeyV2(actionInput());
}

function planFor(value = action()) {
  return createVerificationActionPlanV2({
    action: value,
    executionClass: 'cheap-preflight',
    dependencies: []
  });
}

function observation(
  value = action(),
  state: 'missing' | 'stale' | 'terminal' | 'in-flight' | 'unknown' = 'missing'
) {
  if (state === 'missing') return { actionKey: value.actionKey, state } as const;
  if (state === 'stale') return {
    actionKey: value.actionKey,
    state,
    observationDigest: DIGEST_C,
    reasonCode: 'input-changed'
  } as const;
  if (state === 'terminal') return {
    actionKey: value.actionKey,
    state,
    observationDigest: DIGEST_C,
    terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A }
  } as const;
  if (state === 'in-flight') return {
    actionKey: value.actionKey,
    state,
    claimDigest: DIGEST_C,
    authenticated: true
  } as const;
  return {
    actionKey: value.actionKey,
    state,
    observationDigest: null,
    reasonCode: 'provider-unknown'
  } as const;
}

function identity(overrides: Partial<{
  treeSha: string | null;
  policyRevision: string | null;
  toolchainRevision: string | null;
  providerRevision: string | null;
  environmentRevision: string | null;
  closureDigest: DevelopmentCriticalPathDigest | null;
  unknowns: readonly string[];
}> = {}) {
  return {
    treeSha: TREE_A,
    policyRevision: 'policy-v1',
    toolchainRevision: 'tool-v1',
    providerRevision: 'provider-v1',
    environmentRevision: 'environment-v1',
    closureDigest: DIGEST_A,
    unknowns: [],
    ...overrides
  };
}

function environmentFact(
  overrides: Partial<EnvironmentMaterializationObservationV1> = {}
) {
  const spec = createEnvironmentMaterializationSpecV1({
    imageName: 'sec-test-runtime',
    acceptedImageDigest: DIGEST_A,
    sourcePolicyRevision: 'policy-v1',
    providerRequirement: 'local-image',
    components: [{ id: 'bun', version: '1.3.14', sourceDigest: DIGEST_B }]
  });
  const observation: EnvironmentMaterializationObservationV1 = {
    localTag: 'matching',
    localImageDigest: DIGEST_A,
    offlineArtifact: 'matching',
    immutableBuildInputs: 'available',
    providerCapability: 'available',
    ...overrides
  };
  const plan = compileEnvironmentMaterializationPlanV1({ spec, observation });
  return { spec, observation, plan, environmentRevision: 'environment-v1', unknowns: [] };
}

function staticClosure(value = action()) {
  const plan = planFor(value);
  const analysis = createDevelopmentCriticalPathStaticAnalysisReadbackV2({
    producerSourceDigest: DIGEST_A,
    repository: {
      headSha: MAIN_SHA, headTreeSha: TREE_A, objectFormat: 'sha1', trackedClean: true,
      trackedPathCount: 1, trackedByteCount: 1, inventoryDigest: DIGEST_A
    },
    manifest: {
      path: 'docs/work-packages/test.md', digest: DIGEST_A, authorityRefsDigest: DIGEST_A,
      ownedPathsDigest: DIGEST_A, forbiddenPathsDigest: DIGEST_A
    },
    ownerRegistry: {
      digest: DIGEST_A,
      ownerClosureDigest: DIGEST_A,
      recordsDigest: sha256(STATIC_OWNER_RECORDS) as `sha256:${string}`,
      records: STATIC_OWNER_RECORDS
    },
    actionKey: plan.action.actionKey,
    actionPlanDigest: sha256(plan) as `sha256:${string}`,
    actionPlanClosureDigest: DIGEST_A,
    producerClosurePaths: ['tooling/sec-dev/development-critical-path.ts'],
    producerClosureDigest: DIGEST_A,
    sourceInventoryDigest: DIGEST_A,
    moduleGraphDigest: DIGEST_A,
    unresolvedModuleFiles: [],
    wholeDelta: boundedWholeDelta(),
    dimensionInputs: Object.fromEntries(
      DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1.map((dimension) => [dimension, {
        claim: {
          owner: staticOwner(dimension),
          producer: STATIC_PRODUCER,
          subjectDigest: DIGEST_A
        },
        input: { dimension },
        coverage: 'bounded-census-complete',
        coverageBasis: 'producer-exact',
        stopCondition: 'tracked-owner-surface-exhausted',
        defectClasses: [],
        unknowns: []
      }])
    ) as unknown as Parameters<typeof createDevelopmentCriticalPathStaticAnalysisReadbackV2>[0]['dimensionInputs']
  });
  return createDevelopmentCriticalPathStaticClosureV1(plan, analysis, DIGEST_A);
}

test('one static generation is shared across Action-specific admissions and binds its owner inputs', () => {
  const first = staticClosure(createVerificationActionKeyV2(actionInput({ actionKind: 'generation-a' })));
  const second = staticClosure(createVerificationActionKeyV2(actionInput({ actionKind: 'generation-b' })));
  expect(first.analysisReadback.actionKey).not.toBe(second.analysisReadback.actionKey);
  expect(first.analysisReadback.staticGeneration.generationDigest)
    .toBe(second.analysisReadback.staticGeneration.generationDigest);

  const readback = first.analysisReadback;
  const generationMaterial = {
    ...readback.staticGeneration,
    ownerRegistryDigest: DIGEST_B
  };
  const { generationDigest: _oldGenerationDigest, ...unsignedGeneration } = generationMaterial;
  const forgedGeneration = {
    ...unsignedGeneration,
    generationDigest: sha256(unsignedGeneration)
  };
  const { readbackDigest: _oldReadbackDigest, ...unsignedReadback } = readback;
  const forgedReadback = {
    ...unsignedReadback,
    staticGeneration: forgedGeneration,
    readbackDigest: sha256({ ...unsignedReadback, staticGeneration: forgedGeneration })
  };
  expect(() => parseDevelopmentCriticalPathStaticAnalysisReadbackV2(forgedReadback))
    .toThrow(/must be the exact repository, producer, owner, source, and module generation/u);
});

function staticReadbackWithUnknown(
  proofScope: DevelopmentCriticalPathStaticProofScopeV1,
  blockingEffect: DevelopmentCriticalPathStaticUnknownV1['blockingEffect']
) {
  const closed = staticClosure();
  const unknown = staticUnknown(blockingEffect);
  const dimensions = closed.analysisReadback.dimensions.map((dimension, index) => {
    if (index !== 0) return dimension;
    const material = {
      dimension: dimension.dimension,
      claim: dimension.claim,
      inputDigest: dimension.inputDigest,
      coverage: 'unknown' as const,
      coverageBasis: 'candidate-hint' as const,
      stopCondition: dimension.stopCondition,
      defectClasses: dimension.defectClasses,
      unknowns: [unknown]
    };
    return Object.freeze({
      ...material,
      evidenceDigest: sha256(Object.freeze({
        producer: closed.analysisReadback.producer,
        ...material
      })) as DevelopmentCriticalPathDigest
    });
  });
  const { readbackDigest: _readbackDigest, ...readbackMaterial } = closed.analysisReadback;
  const priorWholeDelta = closed.analysisReadback.wholeDelta;
  const wholeDelta = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: proofScope.kind === 'required'
      ? 'required-producer-bound'
      : 'bounded-action-admission',
    base: priorWholeDelta.base,
    head: priorWholeDelta.head,
    changes: priorWholeDelta.changes,
    requiredOwners: priorWholeDelta.requiredOwners,
    ownerProjections: priorWholeDelta.ownerProjections,
    consumers: priorWholeDelta.consumers,
    producer: priorWholeDelta.producer,
    unknowns: priorWholeDelta.unknowns,
    ...(priorWholeDelta.nonMisleadingProjection === undefined
      ? {}
      : { nonMisleadingProjection: priorWholeDelta.nonMisleadingProjection })
  });
  const material = {
    ...readbackMaterial,
    proofScope,
    wholeDelta,
    dimensions,
    unknowns: [unknown]
  };
  return Object.freeze({
    ...material,
    readbackDigest: sha256(material) as DevelopmentCriticalPathDigest
  });
}

function mainHealthObservation(overrides: Readonly<Record<string, unknown>> = {}) {
  const ledger = createMainHealthLedgerV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN_SHA,
    mainTreeSha: TREE_A,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: '2026-08-25T00:00:00.000Z',
    allowedLanes: ['ordinary'],
    trustRevision: TRUST_SHA,
    observedAt: '2026-08-24T00:00:00.000Z',
    producer: {
      identity: 'critical-path-test',
      trustRevision: TRUST_SHA,
      sourceTransport: 'trusted-local-readback',
      sourceRunId: 'critical-path-test-run',
      sourceRef: 'refs/heads/main',
      sourceDigest: DIGEST_A
    }
  });
  return {
    ledger,
    now: '2026-08-24T01:00:00.000Z',
    expectedRepository: 'sec-platform/sec',
    expectedDefaultBranch: 'main',
    expectedMainSha: MAIN_SHA,
    expectedMainTreeSha: TREE_A,
    expectedTrustRevision: TRUST_SHA,
    ...overrides
  };
}

function compositionInput(value = action()) {
  const facts = environmentFact();
  return {
    staticClosure: staticClosure(value),
    action: value,
    plan: planFor(value),
    observation: observation(value, 'missing'),
    dependencies: [],
    mainDelta: compileDevelopmentCriticalPathMainDeltaV1({
      main: identity(),
      candidate: identity()
    }),
    mainHealth: mainHealthObservation(),
    environment: facts,
    provider: { required: false, capability: null, unknowns: [] }
  };
}

test('pre-effect static closure binds the bounded admission scope and blocks declared unknowns', () => {
  const closed = staticClosure();
  expect(closed.proofScope.kind).toBe(DEVELOPMENT_CRITICAL_PATH_STATIC_PROOF_SCOPE_V2);
  expect(closed.analysisReadback.proofScope.kind).toBe(DEVELOPMENT_CRITICAL_PATH_STATIC_PROOF_SCOPE_V2);
  expect(closed.producer.revision).toBe('sec-development-critical-path-static-analyzer-v3');
  expect(closed.dimensions.map(({ dimension }) => dimension))
    .toEqual([...DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1]);
  expect(closed.dimensions.every(({ coverage, stopCondition }) =>
    coverage === 'bounded-census-complete' && stopCondition === 'tracked-owner-surface-exhausted')).toBe(true);
  expect(() => parseDevelopmentCriticalPathStaticClosureV1({
    ...closed,
    dimensions: closed.dimensions.slice(1)
  })).toThrow(/producer-derived canonical receipt/);
  expect(() => parseDevelopmentCriticalPathStaticClosureV1({
    ...closed,
    proofScope: 'repository-wide-complete'
  })).toThrow(/producer-derived canonical receipt/);

  const unresolvedAction = createVerificationActionKeyV2(actionInput({ inputClosure: [] }));
  const blockedClosure = staticClosure(unresolvedAction);
  expect(blockedClosure.status).toBe('blocked');
  expect(blockedClosure.openDefectClasses).toContain('tracked-input-closure-empty');

  const projection = compileDevelopmentCriticalPathV1({
    ...compositionInput(unresolvedAction),
    staticClosure: blockedClosure
  });
  expect(projection.overallDisposition).toBe('blocked');
  expect(projection.blockers).toContain('pre-effect-static-closure-blocked');
  expect(projection.unknowns).toContain('static-closure:action-input-closure:action input closure has no exact member');
});

test('required proof scope cannot be downgraded when its producer is absent', () => {
  const blocked = createDevelopmentCriticalPathRequiredProofScopeV1({
    scopeDigest: DIGEST_A,
    producer: null
  });
  expect(blocked).toEqual({
    kind: 'required-proof-block',
    status: 'blocked',
    reasonCode: 'required-proof-producer-missing',
    scopeDigest: DIGEST_A,
    minimumResolution: 'trusted-producer-receipt'
  });
  const required = createDevelopmentCriticalPathRequiredProofScopeV1({
    scopeDigest: DIGEST_A,
    producer: STATIC_PRODUCER
  });
  expect(required).toMatchObject({ kind: 'required', scopeDigest: DIGEST_A });
});

test('non-misleading projection advances only through exact stage receipts', () => {
  const sourceDigest = DIGEST_A;
  const receipt = (stage: 'observed' | 'inferred' | 'planned') => {
    const kind = stage === 'observed'
      ? 'observation-receipt'
      : stage === 'inferred' ? 'inference-receipt' : 'plan-receipt';
    const material = { stage, kind, sourceDigest } as const;
    return { ...material, receiptDigest: sha256(material) as DevelopmentCriticalPathDigest };
  };
  const incomplete = compileDevelopmentCriticalPathNonMisleadingProjectionV1({
    receipts: [receipt('observed')]
  });
  expect(incomplete.strongestStage).toBe('observed');
  expect(incomplete.completion).toBe('incomplete');
  expect(incomplete.gaps.some(({ stage }) => stage === 'inferred')).toBe(true);
  expect(() => compileDevelopmentCriticalPathNonMisleadingProjectionV1({
    receipts: [{ ...receipt('observed'), candidate: true }]
  })).toThrow(/exactly/u);
  expect(() => compileDevelopmentCriticalPathNonMisleadingProjectionV1({
    receipts: [{ stage: 'implemented', kind: 'command-exit', sourceDigest, receiptDigest: DIGEST_A }]
  })).toThrow(/canonical receipt kind/u);
  const complete = compileDevelopmentCriticalPathNonMisleadingProjectionV1({
    receipts: [receipt('observed'), receipt('inferred'), receipt('planned')],
    requiredStage: 'planned'
  });
  expect(parseDevelopmentCriticalPathNonMisleadingProjectionV1(complete).completion).toBe('complete');
});

test('critical-path composition rejects a closure from another Action or a tampered plan binding', () => {
  const first = action();
  const second = createVerificationActionKeyV2(actionInput({
    operation: {
      identity: 'second-unit',
      revision: 'v1',
      semanticDigest: DIGEST_C,
      workingDirectory: '.',
      declaredEnvironment: []
    }
  }));
  expect(() => compileDevelopmentCriticalPathV1({
    ...compositionInput(second),
    staticClosure: staticClosure(first)
  })).toThrow(/staticClosure\.actionKey.*does not bind the composed Action/);

  expect(() => compileDevelopmentCriticalPathV1({
    ...compositionInput(first),
    staticClosure: { ...staticClosure(first), actionPlanDigest: DIGEST_C }
  })).toThrow(/producer-derived canonical receipt/);
});

test('candidate path hints cannot be promoted to census-complete coverage', () => {
  const closed = staticClosure();
  const material = {
    ...closed.analysisReadback,
    dimensions: closed.analysisReadback.dimensions.map((dimension, index) => index === 0
      ? { ...dimension, coverageBasis: 'candidate-hint' as const }
      : dimension)
  } as Record<string, unknown>;
  delete material.readbackDigest;
  expect(() => createDevelopmentCriticalPathStaticClosureV1(closed.actionPlan, {
    ...material,
    readbackDigest: sha256(material)
  } as never, DIGEST_A)).toThrow(/candidate path hints cannot be promoted/u);
});

test('bounded admission retains nonblocking successor unknowns while required proof blocks on them', () => {
  const boundedScope: DevelopmentCriticalPathStaticProofScopeV1 = {
    kind: 'bounded-action-admission',
    scopeDigest: DIGEST_A
  };
  const requiredScope: DevelopmentCriticalPathStaticProofScopeV1 = {
    kind: 'required',
    scopeDigest: DIGEST_A,
    producer: STATIC_PRODUCER
  };
  const bounded = createDevelopmentCriticalPathStaticClosureV1(
    staticClosure().actionPlan,
    staticReadbackWithUnknown(boundedScope, 'none'),
    DIGEST_A
  );
  expect(bounded.status).toBe('bounded-closed');
  expect(bounded.unknowns.length).toBeGreaterThanOrEqual(1);
  const required = createDevelopmentCriticalPathStaticClosureV1(
    staticClosure().actionPlan,
    staticReadbackWithUnknown(requiredScope, 'none'),
    DIGEST_A
  );
  expect(required.status).toBe('blocked');
  expect(required.unknowns.length).toBeGreaterThanOrEqual(1);
});

test('pre-effect and effect-admission unknowns always block bounded physical start', () => {
  const boundedScope: DevelopmentCriticalPathStaticProofScopeV1 = {
    kind: 'bounded-action-admission',
    scopeDigest: DIGEST_A
  };
  for (const blockingEffect of ['pre-effect', 'effect-admission'] as const) {
    const closure = createDevelopmentCriticalPathStaticClosureV1(
      staticClosure().actionPlan,
      staticReadbackWithUnknown(boundedScope, blockingEffect),
      DIGEST_A
    );
    expect(closure.status).toBe('blocked');
  }
});

test('bounded projection does not block terminal reuse on a nonblocking successor unknown', () => {
  const boundedScope: DevelopmentCriticalPathStaticProofScopeV1 = {
    kind: 'bounded-action-admission',
    scopeDigest: DIGEST_A
  };
  const value = action();
  const boundedClosure = createDevelopmentCriticalPathStaticClosureV1(
    planFor(value),
    staticReadbackWithUnknown(boundedScope, 'none'),
    DIGEST_A
  );
  const projection = compileDevelopmentCriticalPathV1({
    ...compositionInput(value),
    staticClosure: boundedClosure,
    observation: observation(value, 'terminal')
  });
  expect(projection.overallDisposition).toBe('reuse-pass');
  expect(projection.unknowns.some((unknown) => unknown.startsWith('static-closure:'))).toBe(true);
});

  test('static analyzer readback rejects a forged producer and per-dimension evidence even with a recomputed envelope digest', () => {
  const closed = staticClosure();
  const readback = closed.analysisReadback;
  const forgedProducerMaterial = {
    ...readback,
    producer: { ...readback.producer, identity: 'caller/static-plan.ts' }
  } as Record<string, unknown>;
  delete forgedProducerMaterial.readbackDigest;
  expect(() => createDevelopmentCriticalPathStaticClosureV1(closed.actionPlan, {
    ...forgedProducerMaterial,
    readbackDigest: sha256(forgedProducerMaterial)
  } as never, DIGEST_A)).toThrow(/producer.*identity or revision is invalid/);

  const forgedDimensionMaterial = {
    ...readback,
    dimensions: readback.dimensions.map((dimension, index) => index === 0
      ? { ...dimension, inputDigest: DIGEST_C }
      : dimension)
  } as Record<string, unknown>;
  delete forgedDimensionMaterial.readbackDigest;
  expect(() => createDevelopmentCriticalPathStaticClosureV1(closed.actionPlan, {
    ...forgedDimensionMaterial,
    readbackDigest: sha256(forgedDimensionMaterial)
  } as never, DIGEST_A)).toThrow(/evidence digest mismatch/);

  const forgedLedgerMaterial = {
    ...readback,
    unknowns: ['caller-cleared-or-added-unknown']
  } as Record<string, unknown>;
  delete forgedLedgerMaterial.readbackDigest;
  expect(() => createDevelopmentCriticalPathStaticClosureV1(closed.actionPlan, {
    ...forgedLedgerMaterial,
    readbackDigest: sha256(forgedLedgerMaterial)
  } as never, DIGEST_A)).toThrow(/unknowns\[0\].*plain object/);
});

test('MainHealth must resolve a canonical ledger against the exact main identity', () => {
  expect(() => compileDevelopmentCriticalPathV1({
    ...compositionInput(),
    mainHealth: {
      status: 'healthy', allowed: true, observationValidity: 'valid',
      ledgerDigest: DIGEST_A, unknowns: []
    }
  })).toThrow(/MainHealth observation/);
  const drifted = compileDevelopmentCriticalPathV1({
    ...compositionInput(),
    mainHealth: mainHealthObservation({ expectedMainTreeSha: TREE_B })
  });

  expect(drifted.overallDisposition).toBe('blocked');
  expect(drifted.blockers).toContain('main-health-invalid');
  expect(drifted.unknowns).toContain('main-health:main-health-ledger-identity-drift');
});

test('static analyzer readback rejects a dimension without a bounded owner claim', () => {
  const value = action();
  const plan = planFor(value);
  const dimensions = Object.fromEntries(
    DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1.map((dimension) => [dimension, {
      input: { dimension },
      coverage: 'bounded-census-complete',
      coverageBasis: 'producer-exact',
      stopCondition: 'tracked-owner-surface-exhausted',
      defectClasses: [],
      unknowns: []
    }])
  );
  expect(() => createDevelopmentCriticalPathStaticAnalysisReadbackV2({
    producerSourceDigest: DIGEST_A,
    repository: {
      headSha: MAIN_SHA, headTreeSha: TREE_A, objectFormat: 'sha1', trackedClean: true,
      trackedPathCount: 1, trackedByteCount: 1, inventoryDigest: DIGEST_A
    },
    manifest: {
      path: 'docs/work-packages/test.md', digest: DIGEST_A, authorityRefsDigest: DIGEST_A,
      ownedPathsDigest: DIGEST_A, forbiddenPathsDigest: DIGEST_A
    },
    ownerRegistry: {
      digest: DIGEST_A,
      ownerClosureDigest: DIGEST_A,
      recordsDigest: sha256(STATIC_OWNER_RECORDS) as `sha256:${string}`,
      records: STATIC_OWNER_RECORDS
    },
    actionKey: plan.action.actionKey,
    actionPlanDigest: sha256(plan) as `sha256:${string}`,
    actionPlanClosureDigest: DIGEST_A,
    producerClosurePaths: ['tooling/sec-dev/development-critical-path.ts'],
    producerClosureDigest: DIGEST_A,
    sourceInventoryDigest: DIGEST_A,
    moduleGraphDigest: DIGEST_A,
    unresolvedModuleFiles: [],
    wholeDelta: boundedWholeDelta(),
    dimensionInputs: dimensions as never
  })).toThrow(/claim.*plain object/);
});

test('whole-delta producer closes exact owner/consumer fixed point and keeps required scope typed', () => {
  const owner = staticOwner('unknown-ledger');
  const changeMaterial = {
    status: 'added' as const,
    path: 'tooling/example.ts',
    previousPath: null,
    baseMode: null,
    headMode: '100644',
    baseObjectId: null,
    headObjectId: 'e'.repeat(40),
    baseByteSize: null,
    headByteSize: 12
  };
  const change = Object.freeze({
    changeDigest: sha256(changeMaterial) as DevelopmentCriticalPathDigest,
    ...changeMaterial
  });
  const ownerConsumerMaterial = {
    consumerRef: 'owner-claim:unknown-ledger',
    sourceLocations: ['docs/test/unknown-ledger.md'],
    inputDigest: DIGEST_A,
    required: true
  };
  const ownerConsumer = Object.freeze({
    consumerDigest: sha256(ownerConsumerMaterial) as DevelopmentCriticalPathDigest,
    ...ownerConsumerMaterial
  });
  const deltaConsumerMaterial = {
    consumerRef: 'delta:added:tooling/example.ts',
    sourceLocations: ['tooling/example.ts'],
    inputDigest: change.changeDigest,
    required: true
  };
  const deltaConsumer = Object.freeze({
    consumerDigest: sha256(deltaConsumerMaterial) as DevelopmentCriticalPathDigest,
    ...deltaConsumerMaterial
  });
  const projectionMaterial = {
    owner,
    producer: STATIC_PRODUCER,
    consumerRefs: [ownerConsumer.consumerRef, deltaConsumer.consumerRef]
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    required: true
  };
  const projection = Object.freeze({
    projectionDigest: sha256(projectionMaterial) as DevelopmentCriticalPathDigest,
    ...projectionMaterial
  });
  const closed = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'required-producer-bound',
    base: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    head: { commitSha: TRUST_SHA, treeSha: TREE_B, inventoryDigest: DIGEST_B },
    changes: [change],
    requiredOwners: [owner],
    ownerProjections: [projection],
    consumers: [ownerConsumer, deltaConsumer],
    producer: STATIC_PRODUCER,
    unknowns: []
  });
  expect(closed.status).toBe('required-closed');
  expect(closed.fixedPointClosed).toBe(true);
  expect(closed.edges.map(({ kind }) => kind).sort())
    .toEqual(['consumer', 'consumer', 'owner', 'owner', 'producer']);
  expect(closed.sccs.length).toBeGreaterThan(0);
  expect(parseDevelopmentCriticalPathWholeDeltaSubjectV1(closed)).toEqual(closed);

  const sameTopologyDifferentExactDelta = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'required-producer-bound',
    base: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    head: { commitSha: TRUST_SHA, treeSha: 'c'.repeat(40), inventoryDigest: DIGEST_C },
    changes: [Object.freeze({
      ...change,
      headObjectId: 'f'.repeat(40),
      changeDigest: sha256({
        ...changeMaterial,
        headObjectId: 'f'.repeat(40)
      }) as DevelopmentCriticalPathDigest
    })],
    requiredOwners: [owner],
    ownerProjections: [projection],
    consumers: [ownerConsumer, deltaConsumer],
    producer: STATIC_PRODUCER,
    unknowns: []
  });
  expect(sameTopologyDifferentExactDelta.graphNodes).toEqual(closed.graphNodes);
  expect(sameTopologyDifferentExactDelta.fixedPointDigest).not.toBe(closed.fixedPointDigest);

  const blocked = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'required-producer-bound',
    base: null,
    head: { commitSha: TRUST_SHA, treeSha: TREE_B, inventoryDigest: DIGEST_B },
    changes: [change],
    requiredOwners: [owner],
    ownerProjections: [],
    consumers: [ownerConsumer, deltaConsumer],
    producer: STATIC_PRODUCER,
    unknowns: [createDevelopmentCriticalPathWholeDeltaUnknownV1({
      subject: 'development-critical-path:whole-delta',
      ownerRef: owner,
      producerRef: STATIC_PRODUCER,
      missingEdge: 'base revision fact unavailable',
      sourceLocations: [owner.path],
      blockingEffect: 'required-proof',
      minimumResolution: 'exact base revision fact'
    })]
  });
  expect(blocked.status).toBe('blocked');
  expect(blocked.blocker?.reasonCode).toBe('base-fact-missing');
  expect(blocked.fixedPointClosed).toBe(false);
});

test('whole-delta builder canonicalizes legal Unknown input before parser enforcement', () => {
  const owner = staticOwner('unknown-ledger');
  const unknowns = ['zeta missing edge', 'alpha missing edge'].map((missingEdge) =>
    createDevelopmentCriticalPathWholeDeltaUnknownV1({
      subject: `whole-delta:${missingEdge}`,
      ownerRef: owner,
      producerRef: STATIC_PRODUCER,
      missingEdge,
      sourceLocations: [owner.path],
      blockingEffect: 'none',
      minimumResolution: 'publish the missing canonical owner edge'
    }));
  const nonCanonical = [...unknowns].sort((left, right) =>
    left.unknownId < right.unknownId ? 1 : left.unknownId > right.unknownId ? -1 : 0);
  const built = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'bounded-action-admission',
    base: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    head: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    changes: [],
    requiredOwners: [],
    ownerProjections: [],
    consumers: [],
    producer: STATIC_PRODUCER,
    unknowns: nonCanonical
  });

  expect(built.unknowns.map(({ unknownId }) => unknownId)).toEqual(
    [...unknowns].map(({ unknownId }) => unknownId).sort()
  );
  expect(parseDevelopmentCriticalPathWholeDeltaSubjectV1(built)).toEqual(built);
});

test('bounded whole-delta accepts exact nonrequired inputs without inventing owner edges', () => {
  const consumerMaterial = {
    consumerRef: 'action-input:package.json',
    sourceLocations: ['package.json'],
    inputDigest: DIGEST_A,
    required: false
  };
  const consumer = Object.freeze({
    consumerDigest: sha256(consumerMaterial) as DevelopmentCriticalPathDigest,
    ...consumerMaterial
  });
  const bounded = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'bounded-action-admission',
    base: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    head: { commitSha: MAIN_SHA, treeSha: TREE_A, inventoryDigest: DIGEST_A },
    changes: [],
    requiredOwners: [],
    ownerProjections: [],
    consumers: [consumer],
    producer: STATIC_PRODUCER,
    unknowns: []
  });

  expect(bounded.status).toBe('bounded-closed');
  expect(bounded.blocker).toBeNull();
});

test('critical-path action partition reuses, joins, executes and blocks deterministically', () => {
  const value = action();
  const plan = planFor(value);
  const pass = compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: observation(value, 'terminal'),
    dependencies: []
  });
  expect(pass.disposition).toBe('reuse-pass');

  const failure = compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: {
      actionKey: value.actionKey,
      state: 'terminal',
      observationDigest: DIGEST_C,
      terminal: { status: 'failed', reasonCode: 'executed-failure', resultDigest: null }
    },
    dependencies: []
  });
  expect(failure.disposition).toBe('reuse-failure');

  expect(compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: observation(value, 'in-flight'),
    dependencies: []
  }).disposition).toBe('join');
  expect(compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: observation(value, 'missing'),
    dependencies: []
  }).disposition).toBe('execute');
  expect(compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: observation(value, 'unknown'),
    dependencies: []
  }).disposition).toBe('blocked');
});

test('critical-path rejects unbound and unauthenticated action state', () => {
  const value = action();
  const plan = planFor(value);
  expect(() => compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: { ...observation(value, 'missing'), actionKey: DIGEST_B },
    dependencies: []
  })).toThrow(/does not match/);
  expect(compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: { ...observation(value, 'in-flight'), authenticated: false },
    dependencies: []
  }).reasonCode).toBe('in-flight-not-authenticated');
});

test('terminal reuse is blocked when the action prerequisite closure is not runnable', () => {
  const value = createVerificationActionKeyV2(actionInput({ upstreamActionKeys: [DIGEST_C] }));
  const plan = createVerificationActionPlanV2({
    action: value,
    executionClass: 'cheap-preflight',
    dependencies: [{ actionKey: DIGEST_C, kind: 'upstream' }]
  });
  const decision = compileDevelopmentCriticalPathActionDecisionV1({
    action: value,
    plan,
    observation: {
      actionKey: value.actionKey,
      state: 'terminal',
      observationDigest: DIGEST_B,
      terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A }
    },
    dependencies: [{ actionKey: DIGEST_C, state: 'unknown', observationDigest: null }]
  });
  expect(decision.disposition).toBe('blocked');
  expect(decision.reasonCode).toBe('action-dependencies-not-passed');
  expect(decision.terminal).toBeNull();
});

test('main delta permits only exact tree and closure equivalence and fails closed on unknown', () => {
  const equivalent = compileDevelopmentCriticalPathMainDeltaV1({
    main: identity({ unknowns: [ ] }),
    candidate: identity({ unknowns: [ ] })
  });
  expect(equivalent.disposition).toBe('tree-equivalent');
  expect(equivalent.mainHealthRequired).toBe(false);

  const changed = compileDevelopmentCriticalPathMainDeltaV1({
    main: identity(),
    candidate: identity({ toolchainRevision: 'tool-v2' })
  });
  expect(changed.disposition).toBe('changed');
  expect(changed.reasonCode).toBe('toolchain-revision-changed');
  expect(changed.mainHealthRequired).toBe(true);

  const unknown = compileDevelopmentCriticalPathMainDeltaV1({
    main: identity(),
    candidate: identity({ treeSha: TREE_B, closureDigest: null })
  });
  expect(unknown.disposition).toBe('blocked');
  expect(unknown.reasonCode).toBe('unknown-identity');

  expect(() => compileDevelopmentCriticalPathMainDeltaV1({
    main: { ...identity(), branch: 'feature/unsafe' },
    candidate: identity()
  })).toThrow(/exactly/);
});

test('environment owner plan accepts every current reason without a duplicate reason list', () => {
  const cases: readonly [EnvironmentMaterializationPlanV1['reason'], EnvironmentMaterializationObservationV1][] = [
    ['exact-offline-artifact', {
      localTag: 'absent', localImageDigest: null, offlineArtifact: 'matching',
      immutableBuildInputs: 'unresolved', providerCapability: 'unavailable', remoteAcquisition: 'unavailable'
    }],
    ['offline-artifact-digest-conflict', {
      localTag: 'absent', localImageDigest: null, offlineArtifact: 'mismatched',
      immutableBuildInputs: 'available', providerCapability: 'available'
    }],
    ['remote-acquisition-unavailable', {
      localTag: 'absent', localImageDigest: null, offlineArtifact: 'absent',
      immutableBuildInputs: 'available', providerCapability: 'available', remoteAcquisition: 'unavailable'
    }],
    ['remote-acquisition-unresolved', {
      localTag: 'absent', localImageDigest: null, offlineArtifact: 'absent',
      immutableBuildInputs: 'available', providerCapability: 'available', remoteAcquisition: 'unresolved'
    }]
  ];
  for (const [reason, observation] of cases) {
    const ownerFact = environmentFact(observation);
    expect(ownerFact.plan.reason, reason).toBe(reason);
    const projection = compileDevelopmentCriticalPathV1({
      ...compositionInput(),
      environment: ownerFact
    });
    expect(projection.semanticDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  }
});

test('forged provider capability cannot authorize the pure spine', () => {
  expect(() => compileDevelopmentCriticalPathV1({
    ...compositionInput(),
    provider: {
      required: true,
      unknowns: [],
      capability: {
        schema: 'forged-provider-schema',
        capability: 'forged-capability',
        role: 'forged-role',
        provider: 'forged-provider',
        availability: 'available',
        reasonCode: null,
        receiptRef: null,
        observedAt: '2026-08-24T00:00:00.000Z'
      }
    }
  })).toThrow(/canonical provider capability schema|capability/);
  expect(() => compileDevelopmentCriticalPathV1({
    ...compositionInput(),
    provider: {
      required: true,
      unknowns: [],
      capability: {
        schema: 'sec-verification-provider-capability-v1',
        capability: 'github-writer',
        role: 'reviewer',
        provider: 'github-api',
        availability: 'available',
        reasonCode: null,
        receiptRef: null,
        observedAt: '2026-08-24T00:00:00.000Z'
      }
    }
  })).toThrow(/role/);
});

test('a structural environment plan without owner inputs fails closed', () => {
  const facts = environmentFact();
  const projection = compileDevelopmentCriticalPathV1({
    ...compositionInput(),
    environment: {
      environmentRevision: facts.environmentRevision,
      plan: facts.plan,
      spec: null,
      observation: null,
      unknowns: []
    }
  });
  expect(projection.overallDisposition).toBe('blocked');
  expect(projection.unknowns).toContain('environment:environment-plan-owner-input-missing');
});

test('only an Action that will execute requires current environment and provider resources', () => {
  const value = action();
  const unavailableResources = {
    environment: {
      environmentRevision: null,
      plan: null,
      spec: null,
      observation: null,
      unknowns: ['offline-environment-unobserved']
    },
    provider: {
      required: true,
      capability: null,
      unknowns: ['provider-offline']
    }
  } as const;
  const reusable = compileDevelopmentCriticalPathV1({
    ...compositionInput(value),
    ...unavailableResources,
    observation: observation(value, 'terminal')
  });
  expect(reusable.action.disposition).toBe('reuse-pass');
  expect(reusable.overallDisposition).toBe('reuse-pass');
  expect(reusable.blockers).not.toContain('environment-blocked');
  expect(reusable.blockers).not.toContain('provider-unresolved');
  expect(reusable.unknowns).toEqual([]);

  const joined = compileDevelopmentCriticalPathV1({
    ...compositionInput(value),
    ...unavailableResources,
    observation: observation(value, 'in-flight')
  });
  expect(joined.action.disposition).toBe('join');
  expect(joined.overallDisposition).toBe('join');

  const execute = compileDevelopmentCriticalPathV1({
    ...compositionInput(value),
    ...unavailableResources
  });
  expect(execute.action.disposition).toBe('execute');
  expect(execute.overallDisposition).toBe('blocked');
  expect(execute.blockers).toContain('environment-blocked');
  expect(execute.blockers).toContain('provider-unresolved');
  expect(execute.unknowns).toContain('environment:offline-environment-unobserved');
  expect(execute.unknowns).toContain('provider:provider-offline');
});

test('retirement composition distinguishes terminal, GC pending and unknown', () => {
  const settled = {
    kind: 'worktree', owner: 'worktree-owner', state: 'settled',
    receiptDigest: DIGEST_A, eligibleResidue: [], unknowns: []
  } as const;
  const terminal = compileDevelopmentCriticalPathRetirementV1({
    owners: [settled], activeNamespaces: [], unknowns: []
  });
  expect(terminal.disposition).toBe('operational-terminal');

  const pending = compileDevelopmentCriticalPathRetirementV1({
    owners: [{ ...settled, state: 'eligible-residue', eligibleResidue: ['cache-generation'] }],
    activeNamespaces: [], unknowns: []
  });
  expect(pending.disposition).toBe('gc-pending');
  expect(pending.eligibleResidue).toEqual(['worktree:worktree-owner:cache-generation']);

  const blocked = compileDevelopmentCriticalPathRetirementV1({
    owners: [{ ...settled, state: 'unknown' as const, receiptDigest: null }],
    activeNamespaces: [], unknowns: []
  });
  expect(blocked.disposition).toBe('blocked');
  expect(blocked.blockers).toContain('owner-unknown');
  expect(() => compileDevelopmentCriticalPathRetirementV1({
    owners: [settled, settled], activeNamespaces: [], unknowns: []
  })).toThrow(/duplicate owner/);
});
