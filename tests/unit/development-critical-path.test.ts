import { expect, test } from 'bun:test';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  createDevelopmentCriticalPathStaticAnalysisReadbackV2,
  createDevelopmentCriticalPathStaticClosureV1,
  createDevelopmentCriticalPathWholeDeltaSubjectV1,
  DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1
} from '../../platform/shared/development-critical-path-contract.ts';
import {
  compileEnvironmentMaterializationPlanV1,
  createEnvironmentMaterializationSpecV1
} from '../../platform/shared/environment-materialization-contract.ts';
import { createMainHealthLedgerV1 } from '../../platform/shared/main-health-contract.ts';
import {
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1,
  type VerificationActionKeyInputV2
} from '../../platform/shared/verification-action-contract.ts';
import {
  analyzeDevelopmentCriticalPathStaticClosureV2,
  classifyDevelopmentCriticalPathAuthoringDispositionV1,
  classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1,
  composeDevelopmentCriticalPathV1,
  observeDevelopmentCriticalPathActionV1,
  type DevelopmentCriticalPathInFlightEvidenceV1
} from '../../tooling/sec-dev/development-critical-path.ts';
import type { VerificationActionJournalReadbackV2 } from '../../tooling/sec-dev/verification-action-journal.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const TREE_A = 'a'.repeat(40);
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

test('dirty authoring is classified by producer overlap instead of a repository-wide clean boolean', () => {
  expect(classifyDevelopmentCriticalPathAuthoringDispositionV1({
    changedPaths: [],
    producerClosurePaths: ['tooling/sec-dev/development-critical-path.ts']
  })).toMatchObject({ authoringState: 'clean', disposition: 'exact-object-analysis-ready' });
  expect(classifyDevelopmentCriticalPathAuthoringDispositionV1({
    changedPaths: ['docs/draft.md', 'source/unrelated.ts'],
    producerClosurePaths: ['tooling/sec-dev/development-critical-path.ts']
  })).toMatchObject({
    changedProducerPaths: [],
    authoringState: 'dirty-unrelated',
    disposition: 'exact-object-analysis-ready'
  });
  expect(classifyDevelopmentCriticalPathAuthoringDispositionV1({
    changedPaths: ['docs/draft.md', 'tooling/sec-dev/development-critical-path.ts'],
    producerClosurePaths: ['tooling/sec-dev/development-critical-path.ts']
  })).toMatchObject({
    changedProducerPaths: ['tooling/sec-dev/development-critical-path.ts'],
    authoringState: 'dirty-producer-closure',
    disposition: 'authoring-analysis-only'
  });
});

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

test('manifest owned paths distinguish exact authorized deletion from unexplained absence', () => {
  const removed = Object.freeze({
    changeDigest: DIGEST_A,
    status: 'removed' as const,
    path: 'retired-owner.ts',
    previousPath: null,
    baseMode: '100644',
    headMode: null,
    baseObjectId: 'a'.repeat(40),
    headObjectId: null,
    baseByteSize: 1,
    headByteSize: null
  });
  const renamed = Object.freeze({
    ...removed,
    status: 'renamed' as const,
    path: 'canonical-owner.ts',
    previousPath: 'retired-renamed-owner.ts',
    headMode: '100644',
    headObjectId: 'b'.repeat(40),
    headByteSize: 1
  });
  expect(classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1({
    ownedPath: 'live-owner.ts',
    headObjectId: 'b'.repeat(40),
    baseObjectId: null,
    changes: []
  })).toBe('present');
  expect(classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1({
    ownedPath: 'retired-owner.ts',
    headObjectId: null,
    baseObjectId: 'a'.repeat(40),
    changes: [removed]
  })).toBe('authorized-deletion');
  expect(classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1({
    ownedPath: 'scope-only-owner.ts',
    headObjectId: null,
    baseObjectId: null,
    changes: []
  })).toBe('authorized-absence');
  expect(classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1({
    ownedPath: 'retired-renamed-owner.ts',
    headObjectId: null,
    baseObjectId: 'a'.repeat(40),
    changes: [renamed]
  })).toBe('authorized-deletion');
  expect(classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1({
    ownedPath: 'unexplained-owner.ts',
    headObjectId: null,
    baseObjectId: undefined,
    changes: [removed]
  })).toBe('missing-unproven');
});

function actionInput(overrides: Partial<VerificationActionKeyInputV2> = {}): VerificationActionKeyInputV2 {
  return {
    actionKind: 'critical-path-tooling',
    producer: { identity: 'critical-path-tooling-test', revision: 'v1' },
    operation: {
      identity: 'unit',
      revision: 'v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      declaredEnvironment: []
    },
    inputClosure: [{ path: 'tooling/sec-dev/development-critical-path.ts', digest: DIGEST_B }],
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

function makeJournal(
  action: ReturnType<typeof createVerificationActionKeyV2>,
  latestState: VerificationActionJournalReadbackV2['latestState'],
  terminal: VerificationActionJournalReadbackV2['terminal'] = null
): VerificationActionJournalReadbackV2 {
  return {
    filePath: 'journal',
    schemaState: 'current',
    action,
    latestState,
    terminal,
    events: latestState === null ? [] : [{ eventDigest: DIGEST_B }] as never
  };
}

function planFor(action: ReturnType<typeof createVerificationActionKeyV2>) {
  return createVerificationActionPlanV2({
    action,
    executionClass: 'cheap-preflight',
    dependencies: []
  });
}

function staticClosureFor(action: ReturnType<typeof createVerificationActionKeyV2>) {
  const plan = planFor(action);
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

function stableFacts() {
  const spec = createEnvironmentMaterializationSpecV1({
    imageName: 'sec-test-runtime',
    acceptedImageDigest: DIGEST_A,
    sourcePolicyRevision: 'policy-v1',
    providerRequirement: 'local-image',
    components: [{ id: 'bun', version: '1.3.14', sourceDigest: DIGEST_B }]
  });
  const observation = {
    localTag: 'matching' as const,
    localImageDigest: DIGEST_A,
    offlineArtifact: 'matching' as const,
    immutableBuildInputs: 'available' as const,
    providerCapability: 'available' as const
  };
  const plan = compileEnvironmentMaterializationPlanV1({ spec, observation });
  const action = createVerificationActionKeyV2(actionInput());
  const mainHealthLedger = createMainHealthLedgerV1({
    repository: 'sec-platform/sec', defaultBranch: 'main', mainSha: MAIN_SHA,
    mainTreeSha: TREE_A, status: 'healthy', failureFingerprints: [], owner: null,
    repairWorkPackage: null, expiresAt: '2026-08-25T00:00:00.000Z',
    allowedLanes: ['ordinary'], trustRevision: TRUST_SHA,
    observedAt: '2026-08-24T00:00:00.000Z',
    producer: {
      identity: 'critical-path-tooling-test', trustRevision: TRUST_SHA,
      sourceTransport: 'trusted-local-readback', sourceRunId: 'tooling-test-run',
      sourceRef: 'refs/heads/main', sourceDigest: DIGEST_A
    }
  });
  return {
    staticClosure: staticClosureFor(action),
    main: {
      treeSha: TREE_A,
      policyRevision: 'policy-v1',
      toolchainRevision: 'tool-v1',
      providerRevision: 'provider-v1',
      environmentRevision: 'environment-v1',
      closureDigest: DIGEST_A,
      unknowns: []
    },
    candidate: {
      treeSha: TREE_A,
      policyRevision: 'policy-v1',
      toolchainRevision: 'tool-v1',
      providerRevision: 'provider-v1',
      environmentRevision: 'environment-v1',
      closureDigest: DIGEST_A,
      unknowns: []
    },
    mainHealth: {
      ledger: mainHealthLedger, now: '2026-08-24T01:00:00.000Z',
      expectedRepository: 'sec-platform/sec', expectedDefaultBranch: 'main',
      expectedMainSha: MAIN_SHA, expectedMainTreeSha: TREE_A,
      expectedTrustRevision: TRUST_SHA
    },
    environment: {
      environmentRevision: 'environment-v1',
      unknowns: [],
      spec,
      observation,
      plan
    },
    provider: { required: false, capability: null, unknowns: [] },
    retirement: {
      owners: [{
        kind: 'worktree' as const,
        owner: 'worktree-owner',
        state: 'settled' as const,
        receiptDigest: DIGEST_A,
        eligibleResidue: [],
        unknowns: []
      }],
      activeNamespaces: [],
      unknowns: []
    }
  };
}

test('tooling maps journal terminal, invalidated and authenticated in-flight facts', () => {
  const action = createVerificationActionKeyV2(actionInput());
  const terminal = observeDevelopmentCriticalPathActionV1({
    action,
    journal: makeJournal(action, 'terminal', {
      status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A
    }),
    inFlight: null
  });
  expect(terminal.state).toBe('terminal');

  const invalidated = observeDevelopmentCriticalPathActionV1({
    action,
    journal: makeJournal(action, 'invalidated'),
    inFlight: null
  });
  expect(invalidated.state).toBe('stale');

  const evidence: DevelopmentCriticalPathInFlightEvidenceV1 = {
    actionKey: action.actionKey,
    claimDigest: DIGEST_A,
    authenticated: true
  };
  const inFlight = observeDevelopmentCriticalPathActionV1({
    action,
    journal: makeJournal(action, 'running'),
    inFlight: evidence
  });
  expect(inFlight.state).toBe('in-flight');

  const unknown = observeDevelopmentCriticalPathActionV1({
    action,
    journal: makeJournal(action, 'running'),
    inFlight: null
  });
  expect(unknown.state).toBe('unknown');
});

test('tooling composes a terminal action without wall-clock or transport identity', () => {
  const action = createVerificationActionKeyV2(actionInput());
  const facts = stableFacts();
  const projection = composeDevelopmentCriticalPathV1({
    action,
    plan: planFor(action),
    journal: makeJournal(action, 'terminal', {
      status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A
    }),
    inFlight: null,
    dependencies: [],
    ...facts
  });
  expect(projection.overallDisposition).toBe('reuse-pass');
  expect(projection.semanticDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

  const second = composeDevelopmentCriticalPathV1({
    action,
    plan: planFor(action),
    journal: makeJournal(action, 'terminal', {
      status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A
    }),
    inFlight: null,
    dependencies: [],
    ...facts,
    // These fields are intentionally not accepted by the pure owner facts; the
    // journal's wall clock and file transport are not part of the projection.
  });
  expect(second.semanticDigest).toBe(projection.semanticDigest);
});

test('static analyzer rejects ordinary virtual-input digest maps', () => {
  const action = createVerificationActionKeyV2(actionInput({
    inputClosure: [{ path: 'virtual/synthetic-input', digest: DIGEST_A }]
  }));
  const plan = planFor(action);
  expect(() => analyzeDevelopmentCriticalPathStaticClosureV2({
    repositoryRoot: 'synthetic-root-never-observed',
    plan,
    actionPlanClosureDigest: DIGEST_A,
    expectedHeadSha: MAIN_SHA,
    expectedHeadTreeSha: TREE_A,
    virtualInputs: { 'virtual/synthetic-input': DIGEST_A } as never
  })).toThrow(/ordinary virtual input digest maps are unbound/u);
});
