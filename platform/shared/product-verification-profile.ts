import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import { validatePolicyReportV1 } from './policy-report-authority.ts';
import type { PolicyReport } from './policy-types.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  CodexDevelopmentVerificationEnvironmentIdentityV1,
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
  VerificationStatus,
  VerificationStepReport
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
  const executed = mapping.disposition === 'executed';
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
    environment: executed ? productEnvironment() : null,
    execution: executed
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

function buildInvalidGate(
  gateId: string,
  claimId: string,
  diagnostic: string,
  invalidationRule: string
): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
    owner: PRODUCT_VERIFICATION_OWNER,
    requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
    subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
    inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
    applicability: 'unresolved',
    status: 'invalidated',
    disposition: 'not-executed',
    reasonCode: 'selection-unresolved',
    requiredForClaims: [claimId],
    supportedClaims: [],
    environment: null,
    execution: null,
    evidenceRefs: [],
    invalidationRules: [invalidationRule],
    diagnostic
  });
}

function canonicalPolicyReport(report: PolicyReport): PolicyReport | null {
  try {
    return validatePolicyReportV1(report);
  } catch {
    return null;
  }
}

function policyReportSupportsSemanticPass(report: PolicyReport): boolean {
  return report.evaluation?.assurance === 'semantic'
    && report.evaluation.unsupportedSemanticPredicates.length === 0;
}

function nonblankInventory(values: readonly string[]): boolean {
  return values.length > 0 && values.every((entry) => entry.trim().length > 0);
}

function executedPassedStep(step: VerificationStepReport): boolean {
  return step.status === 'passed' &&
    nonblankInventory(step.passed) &&
    step.failed.length === 0 &&
    typeof step.command === 'string' &&
    step.command.trim().length > 0;
}

function fastPassIsWriterConsistent(fast: FastVerificationLaneReport): boolean {
  return fast.build.status === 'passed' &&
    fast.unit.status === 'passed' &&
    fast.acceptance.status === 'passed' &&
    fast.acceptance.failed.length === 0 &&
    fast.policy.status !== 'failed';
}

function completeAcceptanceCoverage(
  runtime: RuntimeVerificationLaneReport,
  coverage: AcceptanceCoverageReport | null
): boolean {
  return coverage !== null &&
    coverage.status === runtime.status &&
    coverage.acceptancePassed.length > 0 &&
    coverage.uncoveredBlocks.length === 0 &&
    coverage.uncoveredSlots.length === 0;
}

export function buildExpectedProductFastGate(
  fast: FastVerificationLaneReport,
  requestedLane: VerificationLane
): VerificationGateResultV1 {
  if (fast.status === 'passed' && !fastPassIsWriterConsistent(fast)) {
    return buildInvalidGate(
      PRODUCT_FAST_GATE_ID,
      PRODUCT_FAST_CLAIM_ID,
      'Fast lane passed while a required subordinate step contradicted the writer profile.',
      'fast-step-shape-change'
    );
  }
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
  fastFailed: boolean,
  acceptanceCoverage: AcceptanceCoverageReport | null = null
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
      diagnostic: 'Service-mode runtime does not own full runtime proof.'
    });
  }
  if (runtimeMode === 'full' && runtime.status === 'passed') {
    if (
      !executedPassedStep(runtime.build)
      || !executedPassedStep(runtime.unit)
      || !executedPassedStep(runtime.acceptance)
    ) {
      return buildInvalidGate(
        PRODUCT_RUNTIME_GATE_ID,
        PRODUCT_RUNTIME_CLAIM_ID,
        'Full runtime pass requires nonempty executed build, unit and acceptance inventories.',
        'runtime-test-inventory-or-applicability-change'
      );
    }
    if (!completeAcceptanceCoverage(runtime, acceptanceCoverage)) {
      return buildInvalidGate(
        PRODUCT_RUNTIME_GATE_ID,
        PRODUCT_RUNTIME_CLAIM_ID,
        'Full runtime execution did not close all semantic acceptance coverage.',
        'runtime-acceptance-coverage-change'
      );
    }
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

export function buildExpectedProductPolicyGate(input: PolicyReport): VerificationGateResultV1 {
  const report = canonicalPolicyReport(input);
  if (report === null) {
    return buildInvalidGate(
      PRODUCT_POLICY_GATE_ID,
      PRODUCT_POLICY_CLAIM_ID,
      'Policy report does not satisfy the canonical Policy artifact authority.',
      'policy-declaration-or-violation-change'
    );
  }
  if (report.status === 'skipped') {
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
      diagnostic: 'No applicable Policy target exists for the current resolved project.'
    });
  }
  if (report.status === 'passed' && !policyReportSupportsSemanticPass(report)) {
    return CodexDevelopmentBuildVerificationGateResultV1({
      gateId: PRODUCT_POLICY_GATE_ID,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
      inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
      applicability: 'required',
      status: 'unsupported',
      disposition: 'not-executed',
      reasonCode: 'capability-unsupported',
      requiredForClaims: [PRODUCT_POLICY_CLAIM_ID],
      supportedClaims: [],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: ['policy-semantic-evaluator-or-ir-predicate-change'],
      diagnostic: 'Policy source-structure checks passed, but canonical semantic policy proof is unavailable because required Engineering IR predicates are unsupported.'
    });
  }
  const passed = report.status === 'passed';
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId: PRODUCT_POLICY_GATE_ID,
    gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
    owner: PRODUCT_VERIFICATION_OWNER,
    requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
    subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
    inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
    applicability: 'required',
    status: passed ? 'passed' : 'failed',
    disposition: 'executed',
    reasonCode: passed ? 'executed-success' : 'executed-failure',
    requiredForClaims: [PRODUCT_POLICY_CLAIM_ID],
    supportedClaims: passed ? [PRODUCT_POLICY_CLAIM_ID] : [],
    environment: productEnvironment(),
    execution: productExecution(passed ? 0 : 1, passed ? null : 'policy-violation'),
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
  lane: VerificationLane,
  includePolicyClaim = true
): VerificationClaimDefinitionV1[] {
  const owningEnvironments = [CodexDevelopmentVerificationEnvironmentIdentityV1(
    process.platform,
    process.arch
  )];
  const claims: VerificationClaimDefinitionV1[] = [];
  if (lane === 'fast' || lane === 'all') {
    claims.push({
      claimId: PRODUCT_FAST_CLAIM_ID,
      requiredGateIds: [PRODUCT_FAST_GATE_ID],
      owningEnvironments
    });
    if (includePolicyClaim) {
      claims.push({
        claimId: PRODUCT_POLICY_CLAIM_ID,
        requiredGateIds: [PRODUCT_POLICY_GATE_ID],
        owningEnvironments
      });
    }
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
  policyReport: PolicyReport,
  acceptanceCoverage: AcceptanceCoverageReport | null = null
): VerificationClaimSummary {
  const canonicalPolicy = canonicalPolicyReport(policyReport);
  const gates = [
    buildExpectedProductFastGate(fast, lane),
    buildExpectedProductRuntimeGate(
      runtime,
      lane,
      runtimeMode,
      fast.status === 'failed',
      acceptanceCoverage
    ),
    buildExpectedProductPolicyGate(policyReport)
  ];
  const includePolicyClaim = canonicalPolicy === null || canonicalPolicy.status !== 'skipped';
  return {
    gates,
    overall: CodexDevelopmentAggregateVerificationClaimsV1({
      claims: productVerificationClaimDefinitions(lane, includePolicyClaim),
      gateResults: gates
    })
  };
}

export function buildBlockedProductVerificationClaimSummary(
  lane: VerificationLane
): VerificationClaimSummary {
  const gate = (gateId: string, claimId: string): VerificationGateResultV1 =>
    CodexDevelopmentBuildVerificationGateResultV1({
      gateId,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: PRODUCT_VERIFICATION_SUBJECT_REVISION,
      inputDigest: PRODUCT_VERIFICATION_INPUT_DIGEST,
      applicability: 'required',
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'fail-fast-prerequisite-failed',
      requiredForClaims: [claimId],
      supportedClaims: [],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: 'Verification blocked by prerequisite drift failure.'
    });
  const gates = [
    gate(PRODUCT_FAST_GATE_ID, PRODUCT_FAST_CLAIM_ID),
    gate(PRODUCT_RUNTIME_GATE_ID, PRODUCT_RUNTIME_CLAIM_ID),
    gate(PRODUCT_POLICY_GATE_ID, PRODUCT_POLICY_CLAIM_ID)
  ];
  return {
    gates,
    overall: CodexDevelopmentAggregateVerificationClaimsV1({
      claims: productVerificationClaimDefinitions(lane, true),
      gateResults: gates
    })
  };
}
