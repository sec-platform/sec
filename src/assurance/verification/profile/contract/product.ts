import { sha256 } from '../../../../contracts/canonical.ts';
import type { PolicyReport } from '../../../../semantics/policies/types.ts';
import type { AcceptanceCoverageReport } from '../../../acceptance/coverage.ts';
import { validatePolicyReport } from "../../../policies/report.ts";
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport, VerificationClaimSummary, VerificationLane, VerificationStatus, VerificationStepReport } from '../../contract/types.ts';
import { aggregateVerificationClaims, BuildVerificationGateResult, verificationEnvironmentIdentity, mapProductVerificationStatus, type ProductVerificationMappingContext, type VerificationApplicability, type VerificationClaimDefinition, type VerificationGateEnvironment, type VerificationGateExecution, type VerificationGateResult, type VerificationReasonCode, type VerificationResultStatus } from '../../result/contract/result.ts';

const PRODUCT_VERIFICATION_PROFILE_REVISION = 'product-verification-v1' as const;
const PRODUCT_VERIFICATION_OWNER = 'product-verify-project' as const;
const PRODUCT_VERIFICATION_REQUIREMENT_KEY = 'product-verification' as const;

export const PRODUCT_FAST_GATE_ID = 'product-fast-lane' as const;
export const PRODUCT_RUNTIME_GATE_ID = 'product-runtime-lane' as const;
export const PRODUCT_POLICY_GATE_ID = 'product-policy-gate' as const;
const PRODUCT_FAST_CLAIM_ID = 'product-fast-verification' as const;
const PRODUCT_RUNTIME_CLAIM_ID = 'product-runtime-verification' as const;
export const PRODUCT_POLICY_CLAIM_ID = 'product-policy-verification' as const;

export type ProductVerificationRuntimeMode = 'service' | 'full';

export interface ProductVerificationGateObservation {
  readonly subjectRevision: string;
  readonly inputDigest: string;
  readonly environment: VerificationGateEnvironment | null;
  readonly execution: VerificationGateExecution | null;
  readonly evidenceRefs: readonly string[];
}

export interface ProductVerificationObservations {
  readonly fast: ProductVerificationGateObservation;
  readonly runtime: ProductVerificationGateObservation;
  readonly policy: ProductVerificationGateObservation;
}

export function buildProductVerificationObservationBindings(
  subjectRevision: string,
  lane: VerificationLane,
  runtimeMode: ProductVerificationRuntimeMode
): ProductVerificationObservations {
  const observation = (gateId: string): ProductVerificationGateObservation => ({
    subjectRevision,
    inputDigest: sha256({
      gateId,
      lane,
      profileRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      runtimeMode,
      subjectRevision
    }),
    environment: null,
    execution: null,
    evidenceRefs: []
  });
  return {
    fast: observation(PRODUCT_FAST_GATE_ID),
    runtime: observation(PRODUCT_RUNTIME_GATE_ID),
    policy: observation(PRODUCT_POLICY_GATE_ID)
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
  observation: ProductVerificationGateObservation
): VerificationGateResult {
  const mapping = mapProductVerificationStatus(legacyStatus, context);
  const executed = mapping.disposition === 'executed';
  return BuildVerificationGateResult({
    gateId,
    gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
    owner: PRODUCT_VERIFICATION_OWNER,
    requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
    subjectRevision: observation.subjectRevision,
    inputDigest: observation.inputDigest,
    applicability: applicabilityForMapping(mapping.status, mapping.reasonCode),
    status: mapping.status,
    disposition: mapping.disposition,
    reasonCode: mapping.reasonCode,
    requiredForClaims: [claimId],
    supportedClaims: mapping.status === 'passed' ? [claimId] : [],
    environment: executed ? observation.environment : null,
    execution: executed ? observation.execution : null,
    evidenceRefs: [...observation.evidenceRefs],
    invalidationRules: [],
    diagnostic: null
  });
}

function buildInvalidGate(
  gateId: string,
  claimId: string,
  diagnostic: string,
  invalidationRule: string,
  observation: ProductVerificationGateObservation
): VerificationGateResult {
  return BuildVerificationGateResult({
    gateId,
    gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
    owner: PRODUCT_VERIFICATION_OWNER,
    requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
    subjectRevision: observation.subjectRevision,
    inputDigest: observation.inputDigest,
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
    return validatePolicyReport(report);
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

function notApplicableRuntimeStep(step: VerificationStepReport): boolean {
  return step.status === 'skipped' &&
    step.command === null &&
    step.passed.length === 0 &&
    step.failed.length === 0;
}

function completeRuntimeStep(step: VerificationStepReport): boolean {
  return executedPassedStep(step) || notApplicableRuntimeStep(step);
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
    coverage.uncoveredBlocks.length === 0;
}

export function buildExpectedProductFastGate(
  fast: FastVerificationLaneReport,
  requestedLane: VerificationLane,
  observation: ProductVerificationGateObservation
): VerificationGateResult {
  if (fast.status === 'passed' && !fastPassIsWriterConsistent(fast)) {
    return buildInvalidGate(
      PRODUCT_FAST_GATE_ID,
      PRODUCT_FAST_CLAIM_ID,
      'Fast lane passed while a required subordinate step contradicted the writer profile.',
      'fast-step-shape-change',
      observation
    );
  }
  return buildMappedGate(
    PRODUCT_FAST_GATE_ID,
    fast.status,
    { requestedLane, lane: 'fast' },
    PRODUCT_FAST_CLAIM_ID,
    observation
  );
}

export function buildExpectedProductRuntimeGate(
  runtime: RuntimeVerificationLaneReport,
  requestedLane: VerificationLane,
  runtimeMode: ProductVerificationRuntimeMode,
  fastFailed: boolean,
  acceptanceCoverage: AcceptanceCoverageReport | null,
  observation: ProductVerificationGateObservation
): VerificationGateResult {
  if (runtimeMode === 'service' && runtime.status === 'passed') {
    return BuildVerificationGateResult({
      gateId: PRODUCT_RUNTIME_GATE_ID,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: observation.subjectRevision,
      inputDigest: observation.inputDigest,
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
      !completeRuntimeStep(runtime.build)
      || !executedPassedStep(runtime.unit)
      || !completeRuntimeStep(runtime.acceptance)
    ) {
      return buildInvalidGate(
        PRODUCT_RUNTIME_GATE_ID,
        PRODUCT_RUNTIME_CLAIM_ID,
        'Full runtime pass requires an executed unit inventory and canonical executed-or-not-applicable build and acceptance inventories.',
        'runtime-test-inventory-or-applicability-change',
        observation
      );
    }
    if (!completeAcceptanceCoverage(runtime, acceptanceCoverage)) {
      return buildInvalidGate(
        PRODUCT_RUNTIME_GATE_ID,
        PRODUCT_RUNTIME_CLAIM_ID,
        'Full runtime execution did not close all semantic acceptance coverage.',
        'runtime-acceptance-coverage-change',
        observation
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
    observation
  );
}

export function buildExpectedProductPolicyGate(
  input: PolicyReport,
  observation: ProductVerificationGateObservation
): VerificationGateResult {
  const report = canonicalPolicyReport(input);
  if (report === null) {
    return buildInvalidGate(
      PRODUCT_POLICY_GATE_ID,
      PRODUCT_POLICY_CLAIM_ID,
      'Policy report does not satisfy the canonical Policy artifact authority.',
      'policy-declaration-or-violation-change',
      observation
    );
  }
  if (report.status === 'skipped') {
    return BuildVerificationGateResult({
      gateId: PRODUCT_POLICY_GATE_ID,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: observation.subjectRevision,
      inputDigest: observation.inputDigest,
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
    return BuildVerificationGateResult({
      gateId: PRODUCT_POLICY_GATE_ID,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: observation.subjectRevision,
      inputDigest: observation.inputDigest,
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
  return BuildVerificationGateResult({
    gateId: PRODUCT_POLICY_GATE_ID,
    gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
    owner: PRODUCT_VERIFICATION_OWNER,
    requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
    subjectRevision: observation.subjectRevision,
    inputDigest: observation.inputDigest,
    applicability: 'required',
    status: passed ? 'passed' : 'failed',
    disposition: 'executed',
    reasonCode: passed ? 'executed-success' : 'executed-failure',
    requiredForClaims: [PRODUCT_POLICY_CLAIM_ID],
    supportedClaims: passed ? [PRODUCT_POLICY_CLAIM_ID] : [],
    environment: observation.environment,
    execution: observation.execution,
    evidenceRefs: [...observation.evidenceRefs],
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

function productVerificationClaimDefinitions(
  lane: VerificationLane,
  includePolicyClaim = true
): VerificationClaimDefinition[] {
  const owningEnvironments = [verificationEnvironmentIdentity(
    process.platform,
    process.arch
  )];
  const claims: VerificationClaimDefinition[] = [];
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
  acceptanceCoverage: AcceptanceCoverageReport | null,
  observations: ProductVerificationObservations
): VerificationClaimSummary {
  const canonicalPolicy = canonicalPolicyReport(policyReport);
  const gates = [
    buildExpectedProductFastGate(fast, lane, observations.fast),
    buildExpectedProductRuntimeGate(
      runtime,
      lane,
      runtimeMode,
      fast.status === 'failed',
      acceptanceCoverage,
      observations.runtime
    ),
    buildExpectedProductPolicyGate(policyReport, observations.policy)
  ];
  const includePolicyClaim = canonicalPolicy === null || canonicalPolicy.status !== 'skipped';
  return {
    gates,
    overall: aggregateVerificationClaims({
      claims: productVerificationClaimDefinitions(lane, includePolicyClaim),
      gateResults: gates
    })
  };
}

export function buildBlockedProductVerificationClaimSummary(
  lane: VerificationLane,
  observations: ProductVerificationObservations
): VerificationClaimSummary {
  const gate = (
    gateId: string,
    claimId: string,
    observation: ProductVerificationGateObservation
  ): VerificationGateResult =>
    BuildVerificationGateResult({
      gateId,
      gateRevision: PRODUCT_VERIFICATION_PROFILE_REVISION,
      owner: PRODUCT_VERIFICATION_OWNER,
      requirementKey: PRODUCT_VERIFICATION_REQUIREMENT_KEY,
      subjectRevision: observation.subjectRevision,
      inputDigest: observation.inputDigest,
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
    gate(PRODUCT_FAST_GATE_ID, PRODUCT_FAST_CLAIM_ID, observations.fast),
    gate(PRODUCT_RUNTIME_GATE_ID, PRODUCT_RUNTIME_CLAIM_ID, observations.runtime),
    gate(PRODUCT_POLICY_GATE_ID, PRODUCT_POLICY_CLAIM_ID, observations.policy)
  ];
  return {
    gates,
    overall: aggregateVerificationClaims({
      claims: productVerificationClaimDefinitions(lane, true),
      gateResults: gates
    })
  };
}
