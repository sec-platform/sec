import type { PolicyReport } from './policy-types.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  mapProductVerificationStatus,
  type ProductVerificationMappingContext,
  type VerificationApplicability,
  type VerificationClaimDefinitionV1,
  type VerificationGateEnvironmentV1,
  type VerificationGateExecutionV1,
  type VerificationGateResultV1,
  type VerificationReasonCode,
  type VerificationResultStatus
} from './verification-result-contract.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationClaimSummary,
  VerificationLane,
  VerificationStatus
} from './verification-types.ts';

export const PRODUCT_VERIFICATION_PROFILE_REVISION = 'product-verification-v1' as const;
export const PRODUCT_VERIFICATION_OWNER = 'product-verify-project' as const;
export const PRODUCT_VERIFICATION_REQUIREMENT_KEY = 'product-verification' as const;
export const PRODUCT_VERIFICATION_SUBJECT_REVISION = '0000000000000000000000000000000000000000' as const;
export const PRODUCT_VERIFICATION_INPUT_DIGEST = `sha256:${'0'.repeat(64)}` as const;
export const PRODUCT_VERIFICATION_OUTPUT_DIGEST = `sha256:${'0'.repeat(64)}` as const;

export const PRODUCT_FAST_GATE_ID = 'product-fast-lane' as const;
export const PRODUCT_RUNTIME_GATE_ID = 'product-runtime-lane' as const;
export const PRODUCT_POLICY_GATE_ID = 'product-policy-gate' as const;
export const PRODUCT_FAST_CLAIM_ID = 'product-fast-verification' as const;
export const PRODUCT_RUNTIME_CLAIM_ID = 'product-runtime-verification' as const;
export const PRODUCT_POLICY_CLAIM_ID = 'product-policy-verification' as const;

export const PRODUCT_VERIFICATION_GATE_IDS = Object.freeze([
  PRODUCT_FAST_GATE_ID,
  PRODUCT_RUNTIME_GATE_ID,
  PRODUCT_POLICY_GATE_ID
] as const);

export const PRODUCT_VERIFICATION_CLAIM_IDS = Object.freeze([
  PRODUCT_FAST_CLAIM_ID,
  PRODUCT_POLICY_CLAIM_ID,
  PRODUCT_RUNTIME_CLAIM_ID
] as const);

export type ProductVerificationRuntimeMode = 'service' | 'full';

function productEnvironment(): VerificationGateEnvironmentV1 {
  return {
    runtime: 'bun',
    os: process.platform,
    arch: process.arch,
    filesystem: null,
    capabilities: [],
    toolchainRevision: 'ci-verification-v19',
    providerRevisions: []
  };
}

function productExecution(
  exitCode: number,
  failureFingerprint: string | null
): VerificationGateExecutionV1 {
  return {
    argv: [],
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:00:00.000Z',
    durationMs: 0,
    exitCode,
    outputDigest: PRODUCT_VERIFICATION_OUTPUT_DIGEST,
    failureFingerprint
  };
}

function applicabilityForMapping(
  status: VerificationResultStatus,
  reasonCode: VerificationReasonCode
): VerificationApplicability {
  if (reasonCode === 'not-applicable') return 'not-applicable';
  if (status === 'invalidated') return 'unresolved';
  return 'required';
}

function buildMappedGate(
  gateId: string,
  legacyStatus: VerificationStatus,
  context: ProductVerificationMappingContext,
  claimId: string,
  failureFingerprint: string
): VerificationGateResultV1 {
  const mapping = mapProductVerificationStatus(legacyStatus, context);
  const isExecuted = mapping.disposition === 'executed';
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
    owner: PRODUCT_VERIFICATION_OWNER,
    requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
    subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
    inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
    applicability: applicabilityForMapping(mapping.status, mapping.reasonCode),
    status: mapping.status,
    disposition: mapping.disposition,
    reasonCode: mapping.reasonCode,
    requiredForClaims: [claimId],
    supportedClaims: mapping.status === 'passed' ? [claimId] : [],
    environment: isExecuted ? productEnvironment() : null,
    execution: isExecuted
      ? productExecution(
          mapping.status === 'failed' ? 1 : 0,
          mapping.status === 'failed' ? failureFingerprint : null
        )
      : null,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

export function buildExpectedProductFastGate(
  fast: FastVerificationLaneReport,
  requestedLane: VerificationLane
): VerificationGateResultV1 {
  return buildMappedGate(
    PRODUCT_FAST_GATE_ID,
    fast.status,
    { requestedLane, lane: 'fast' },
    PRODUCT_FAST_CLAIM_ID,
    'product-failure'
  );
}

export function buildExpectedProductRuntimeGate(
  runtime: RuntimeVerificationLaneReport,
  requestedLane: VerificationLane,
  runtimeMode: ProductVerificationRuntimeMode,
  fastFailed: boolean
): VerificationGateResultV1 {
  if (runtimeMode === 'service' && runtime.status === 'passed') {
    return CodexDevelopmentBuildVerificationGateResultV1({
      gateId: PRODUCT_RUNTIME_GATE_ID,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
      inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
      applicability: 'required',
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'current-runner-not-owning-environment',
      requiredForClaims: [PRODUCT_RUNTIME_CLAIM_ID],
      supportedClaims: [],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: 'Service-mode runtime passed without acceptance execution.'
    });
  }

  return buildMappedGate(
    PRODUCT_RUNTIME_GATE_ID,
    runtime.status,
    {
      requestedLane,
      lane: 'runtime',
      fastFailed,
      currentRunnerOwning: runtime.status === 'skipped' && !fastFailed ? false : undefined
    },
    PRODUCT_RUNTIME_CLAIM_ID,
    'runtime-failure'
  );
}

export function buildExpectedProductPolicyGate(
  policyReport: PolicyReport
): VerificationGateResultV1 {
  if (policyReport.status === 'skipped') {
    return CodexDevelopmentBuildVerificationGateResultV1({
      gateId: PRODUCT_POLICY_GATE_ID,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
      inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
      applicability: 'not-applicable',
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'not-applicable',
      requiredForClaims: [PRODUCT_POLICY_CLAIM_ID],
      supportedClaims: [],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: 'No policies declared; policy gate is not-applicable.'
    });
  }

  const isPassed = policyReport.status === 'passed';
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId: PRODUCT_POLICY_GATE_ID,
    gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
    owner: PRODUCT_VERIFICATION_OWNER,
    requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
    subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
    inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
    applicability: 'required',
    status: isPassed ? 'passed' : 'failed',
    disposition: 'executed',
    reasonCode: isPassed ? 'executed-success' : 'executed-failure',
    requiredForClaims: [PRODUCT_POLICY_CLAIM_ID],
    supportedClaims: isPassed ? [PRODUCT_POLICY_CLAIM_ID] : [],
    environment: productEnvironment(),
    execution: productExecution(isPassed ? 0 : 1, isPassed ? null : 'policy-violation'),
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

export function inferProductVerificationRuntimeMode(
  _runtime: RuntimeVerificationLaneReport,
  requestedLane: VerificationLane = 'all'
): ProductVerificationRuntimeMode {
  return requestedLane === 'all' ? 'full' : 'service';
}

export function productVerificationClaimDefinitions(
  lane: VerificationLane
): VerificationClaimDefinitionV1[] {
  const owningEnvironments = [`${process.platform}-${process.arch}`];
  const claims: VerificationClaimDefinitionV1[] = [];
  if (lane === 'fast' || lane === 'all') {
    claims.push({
      claimId: PRODUCT_FAST_CLAIM_ID,
      requiredGateIds: [PRODUCT_FAST_GATE_ID],
      owningEnvironments
    });
    claims.push({
      claimId: PRODUCT_POLICY_CLAIM_ID,
      requiredGateIds: [PRODUCT_POLICY_GATE_ID],
      owningEnvironments
    });
  }
  if (lane === 'runtime' || lane === 'all') {
    claims.push({
      claimId: PRODUCT_RUNTIME_CLAIM_ID,
      requiredGateIds: [PRODUCT_RUNTIME_GATE_ID],
      owningEnvironments
    });
  }
  return claims;
}

export function buildExpectedProductVerificationClaimSummary(
  lane: VerificationLane,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  runtimeMode: ProductVerificationRuntimeMode,
  policyReport: PolicyReport
): VerificationClaimSummary {
  const gates = [
    buildExpectedProductFastGate(fast, lane),
    buildExpectedProductRuntimeGate(runtime, lane, runtimeMode, fast.status === 'failed'),
    buildExpectedProductPolicyGate(policyReport)
  ];
  const overall = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: productVerificationClaimDefinitions(lane),
    gateResults: gates
  });
  return { overall, gates };
}
