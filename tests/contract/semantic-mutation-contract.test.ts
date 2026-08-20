import { expect, test } from 'bun:test';

import {
  buildFactDelta,
  normalizeSemanticMutationRequest,
  planSemanticMutation,
  preflightSemanticMutation,
  type SemanticMutationAuthorizationContextV2,
  type SemanticMutationInputV2,
  type SemanticMutationPlanV2,
  type SemanticMutationRequestV2
} from '../../platform/compiler/index.ts';
import { sha256 } from '../../platform/compiler/semantic-mutation/canonical.ts';
import { SEMANTIC_MUTATION_OPERATION_DESCRIPTORS } from '../../platform/compiler/semantic-mutation/operation-registry.ts';
import { semanticMutationPlanRevision } from '../../platform/compiler/semantic-mutation/plan-semantic-mutation.ts';
import { buildSemanticMutationVerificationExecutionRef, semanticMutationResultRevision } from '../../platform/compiler/semantic-mutation/semantic-mutation-result.ts';
import { semanticMutationRequiredVerificationDigest } from '../../platform/compiler/semantic-mutation/verification-policy.ts';
import type { CiArtifactManifest } from '../../platform/shared/ci-artifact-types.ts';
import type {
  EngineeringIR,
  FactDeltaEndpointContext,
  ValidatedEngineeringIRSnapshot
} from '../../platform/shared/engineering-ir-types.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import type { ReviewSummary } from '../../platform/shared/review-types.ts';
import {
  SEMANTIC_MUTATION_CONTRACT_VERSION,
  SEMANTIC_MUTATION_EXPECTATION_REVISION,
  SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
  SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION
} from '../../platform/shared/semantic-mutation-types.ts';
import type { SemanticViewSet } from '../../platform/shared/semantic-view-types.ts';
import {
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
  type VerificationReport
} from '../../platform/shared/verification-types.ts';
import { semanticMutationVerificationReportFixture } from '../helpers/semantic-mutation-verification-report.ts';

function request(): SemanticMutationRequestV2 {
  return {
    contractVersion: '2',
    requestId: 'request:contract-vector',
    graphId: 'engineering-ir:contract-vector',
    appId: 'app:contract-vector',
    base: {
      transactionId: 'tx:base',
      inputRevision: sha256('input'),
      semanticRevision: sha256('semantic')
    },
    preconditions: [],
    operations: [{
      operationId: 'operation:one',
      kind: 'add-state-transition',
      contract: { namespace: 'vector', contractId: 'vector-core' },
      stateId: 'status',
      from: 'open',
      to: 'closed',
      by: 'close'
    }],
    expectation: {
      revision: 'semantic-mutation-expectation-v1',
      matchMode: 'exact',
      addedFacts: [],
      removedFacts: [],
      assertionChanges: [],
      entityChanges: 'none'
    },
    postconditions: [],
    additionalVerification: []
  };
}

test('Semantic Mutation v2 public constants, request shape, and independent digest vector stay frozen', () => {
  expect(SEMANTIC_MUTATION_CONTRACT_VERSION).toBe('2');
  expect(SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION).toBe('semantic-mutation-operations-v1');
  expect(SEMANTIC_MUTATION_EXPECTATION_REVISION).toBe('semantic-mutation-expectation-v1');
  expect(SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION).toBe('semantic-mutation-verification-policy-v1');
  expect(SEMANTIC_MUTATION_OPERATION_DESCRIPTORS).toEqual({
    'add-state-transition': {
      kind: 'add-state-transition',
      riskFloor: 'high',
      minimumVerification: [{ kind: 'pass', passId: 'verify' }],
      invalidationFromStage: 'resolve',
      maxSourceChanges: 1,
      implicitCascade: 'none'
    }
  });
  expect(Object.isFrozen(SEMANTIC_MUTATION_OPERATION_DESCRIPTORS)).toBe(true);
  expect(Object.isFrozen(SEMANTIC_MUTATION_OPERATION_DESCRIPTORS['add-state-transition'])).toBe(true);
  expect(sha256({
    domain: 'semantic-mutation-frozen-digest-regression-v1',
    zeta: 1,
    alpha: 2
  })).toBe('sha256:333a024149bce48bf2d92332e11ddcaecea611e2debb7804372956892d7568ce');
  expect(sha256({
    domain: 'semantic-mutation-frozen-digest-regression-v1',
    alpha: 2,
    zeta: 1
  })).toBe('sha256:f201719a21aecf5e4228ca94463efd06a483dc82b883c038961c55f6655a3c71');

  const raw = request();
  const normalized = normalizeSemanticMutationRequest(raw);
  expect(Object.keys(normalized)).toEqual([
    'contractVersion',
    'requestId',
    'graphId',
    'appId',
    'base',
    'preconditions',
    'operations',
    'expectation',
    'postconditions',
    'additionalVerification',
    'requestRevision'
  ]);
  const expectedRevision = sha256({
    domain: 'semantic-mutation-request-v2',
    ...raw,
    operationRegistryRevision: 'semantic-mutation-operations-v1',
    expectationRevision: 'semantic-mutation-expectation-v1'
  });
  expect(normalized.requestRevision).toBe(expectedRevision);
  expect(JSON.stringify(normalizeSemanticMutationRequest(raw))).toBe(JSON.stringify(normalized));
});

test('request schema rejects caller authority, unknown fields, wrong versions, and non-canonical identity order', () => {
  const raw = request();
  expect(() => normalizeSemanticMutationRequest({ ...raw, contractVersion: '1' })).toThrow('contractVersion');
  expect(() => normalizeSemanticMutationRequest({ ...raw, relativePath: 'source/model/vector.yaml' })).toThrow('unknown fields');
  expect(() => normalizeSemanticMutationRequest({ ...raw, factDelta: {} })).toThrow('unknown fields');
  expect(() => normalizeSemanticMutationRequest({ ...raw, risk: 'low' })).toThrow('unknown fields');
  expect(() => normalizeSemanticMutationRequest({ ...raw, rollbackManifestDigest: sha256('rollback') })).toThrow('unknown fields');
  expect(() => normalizeSemanticMutationRequest({
    ...raw,
    operations: [
      { ...raw.operations[0]!, operationId: 'operation:z' },
      { ...raw.operations[0]!, operationId: 'operation:a', from: 'closed', to: 'open' }
    ]
  })).toThrow('canonical order');
});

test('runtime trusted-input guard rejects malformed endpoint shells without leaking TypeError', () => {
  const raw = request();
  const authorization = {
    authorizationRevision: sha256('not-reached'),
    allowedOperationKinds: ['add-state-transition'] as const,
    allowedTargetEntityIds: ['state:vector:status'],
    allowedSourceOwnerIds: ['owner:vector'],
    allowedPathPrefixes: ['source/model/'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  };
  const malformed = {
    transactionId: raw.base.transactionId,
    inputRevision: raw.base.inputRevision,
    semanticRevision: raw.base.semanticRevision,
    snapshot: {
      ir: {
        graphId: raw.graphId,
        appId: raw.appId,
        inputRevision: raw.base.inputRevision,
        semanticRevision: raw.base.semanticRevision
      }
    }
  };
  expect(() => preflightSemanticMutation({
    request: raw,
    base: malformed as never,
    authorization
  })).not.toThrow();
  expect(preflightSemanticMutation({
    request: raw,
    base: malformed as never,
    authorization
  })).toMatchObject({ status: 'rejected', rejectedAt: 'request' });
});

test('independent plan, required-verification, execution, and result digest vectors stay frozen', () => {
  const base = {
    transactionId: 'tx:base',
    inputRevision: sha256('input'),
    semanticRevision: sha256('semantic')
  };
  const diagnostics = [{
    origin: 'semantic-mutation' as const,
    code: 'SEMANTIC-MUTATION-002',
    stage: 'base' as const,
    message: 'Base binding failed'
  }];
  const planDraft = {
    contractVersion: '2' as const,
    requestId: 'request:contract-vector',
    requestRevision: sha256('request'),
    authorizationRevision: sha256('authorization'),
    operationRegistryRevision: 'semantic-mutation-operations-v1' as const,
    expectationRevision: 'semantic-mutation-expectation-v1' as const,
    verificationPolicyRevision: 'semantic-mutation-verification-policy-v1' as const,
    verificationAdapterId: '',
    verificationAdapterRevision: '',
    verificationPlanningRevision: '',
    base,
    status: 'rejected' as const,
    rejectedAt: 'base' as const,
    sourceChanges: [] as const,
    diagnostics
  };
  const expectedPlanRevision = sha256({
    domain: 'semantic-mutation-plan-v2',
    contractVersion: '2',
    status: 'rejected',
    rejectedAt: 'base',
    requestId: planDraft.requestId,
    requestRevision: planDraft.requestRevision,
    authorizationRevision: planDraft.authorizationRevision,
    base,
    operationRegistryRevision: 'semantic-mutation-operations-v1',
    expectationRevision: 'semantic-mutation-expectation-v1',
    verificationPolicyRevision: 'semantic-mutation-verification-policy-v1',
    verificationAdapterId: '',
    verificationAdapterRevision: '',
    verificationPlanningRevision: '',
    sourceChanges: [],
    staged: null,
    actualDeltaRevision: '',
    impactRevision: '',
    risk: '',
    requiredVerification: [],
    rollbackManifestDigest: '',
    diagnostics
  });
  expect(semanticMutationPlanRevision(planDraft)).toBe(expectedPlanRevision);

  const requirements = [{ kind: 'pass' as const, passId: 'verify' }];
  const requiredVerificationDigest = sha256({
    domain: 'semantic-mutation-required-verification-v1',
    requirements
  });
  expect(semanticMutationRequiredVerificationDigest(requirements)).toBe(requiredVerificationDigest);
  const executionInput = {
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    reportRevision: sha256('report'),
    planRevision: expectedPlanRevision,
    attempted: {
      transactionId: 'tx:staged',
      inputRevision: sha256('staged-input'),
      semanticRevision: sha256('staged-semantic')
    },
    stagedSourceDigest: sha256('staged-source'),
    requiredVerificationDigest,
    status: 'passed' as const
  };
  const execution = buildSemanticMutationVerificationExecutionRef(
    semanticMutationVerificationReportFixture({ ...executionInput, requirements })
  );
  const { verificationExecutionRevision: _executionRevision, ...executionWithoutRevision } = execution;
  expect(execution.verificationExecutionRevision).toBe(sha256({
    domain: 'semantic-mutation-verification-execution-v1',
    ...executionWithoutRevision
  }));

  const resultDraft = {
    contractVersion: '2' as const,
    requestId: planDraft.requestId,
    requestRevision: planDraft.requestRevision,
    planRevision: expectedPlanRevision,
    base,
    status: 'rejected' as const,
    sourceChanges: [],
    diagnostics
  };
  expect(semanticMutationResultRevision(resultDraft)).toBe(sha256({
    domain: 'semantic-mutation-result-v2',
    ...resultDraft
  }));
});

test('compile-time boundaries keep proposal, trusted context, IR, Lock, Projection, artifacts, and reports distinct', () => {
  const proposal = request();
  const rawIR = {} as EngineeringIR;
  const endpoint = {} as FactDeltaEndpointContext;
  const authorization = {} as SemanticMutationAuthorizationContextV2;
  const lock = {} as LockFile;
  const views = {} as SemanticViewSet;
  const artifact = {} as CiArtifactManifest;
  const review = {} as ReviewSummary;
  const verification = {} as VerificationReport;
  const plan = {} as SemanticMutationPlanV2;
  const snapshot = {} as ValidatedEngineeringIRSnapshot;
  const trustedInput = {} as SemanticMutationInputV2;
  if (false) {
    // @ts-expect-error Raw EngineeringIR cannot replace the branded FactDelta endpoint.
    preflightSemanticMutation({ request: proposal, base: rawIR, authorization });
    // @ts-expect-error Proposal cannot replace trusted authorization.
    preflightSemanticMutation({ request: proposal, base: endpoint, authorization: proposal });
    // @ts-expect-error Lock state cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: lock });
    // @ts-expect-error Projection cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: views });
    // @ts-expect-error Artifact manifest cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: artifact });
    // @ts-expect-error Review summary cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: review });
    // @ts-expect-error Verification report cannot replace Verification planning context.
    planSemanticMutation({ ...trustedInput, verificationPlanning: verification });
    // @ts-expect-error A mutation plan is not a validated IR endpoint.
    buildFactDelta({ ...endpoint, snapshot: plan }, endpoint);
    // @ts-expect-error A raw snapshot-like value cannot be supplied as canonical Fact Delta.
    buildFactDelta({ ...endpoint, snapshot: rawIR }, { ...endpoint, snapshot });
  }
  expect(true).toBe(true);
});
