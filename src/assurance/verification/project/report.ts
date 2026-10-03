import type { LockFile } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { sha256 } from '../../../contracts/canonical.ts';
import type { PolicyReport } from '../../../semantics/policies/types.ts';
import type { AcceptanceCoverageReport } from '../../acceptance/coverage.ts';
import {
  verificationLaneProfile,
  type VerificationRuntimeMode
} from '../contract/lanes.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationLane,
  VerificationReport,
  VerificationStepReport
} from '../contract/types.ts';
import {
  buildExpectedProductVerificationClaimSummary,
  buildProductVerificationObservationBindings,
  inferProductVerificationRuntimeMode,
  PRODUCT_FAST_GATE_ID,
  PRODUCT_POLICY_GATE_ID,
  PRODUCT_RUNTIME_GATE_ID,
  type ProductVerificationObservations
} from '../profile/contract/product.ts';

export function productVerificationSubjectRevision(lock: LockFile): string {
  return sha256({
    domain: 'product-verification-subject',
    formatVersion: lock.formatVersion,
    app: lock.app,
    resolvedBlocks: lock.resolvedBlocks,
    resolvedCapabilities: lock.resolvedCapabilities,
    installPlan: lock.installPlan,
    semanticLoweringTasks: lock.semanticLoweringTasks,
    semanticViews: lock.semanticViews,
    acceptancePlan: lock.acceptancePlan
  });
}

export function productVerificationObservationBindings(
  lock: LockFile,
  lane: VerificationLane,
  runtimeMode: VerificationRuntimeMode
): ProductVerificationObservations {
  return buildProductVerificationObservationBindings(
    productVerificationSubjectRevision(lock),
    lane,
    runtimeMode
  );
}

/** Applicability of owner-validated retained data to this Lock. This does not
 * authenticate a producer or observe physical source bytes outside the subject. */
export function assertProductVerificationArtifactSubject(
  lock: LockFile,
  artifacts: Readonly<{ verificationReport: VerificationReport }>
): void {
  const report = artifacts.verificationReport;
  verificationLaneProfile(report.summary.requestedLane);
  const expected = productVerificationObservationBindings(lock, report.summary.requestedLane,
    inferProductVerificationRuntimeMode(report.runtime, report.summary.requestedLane));
  const byGate = new Map<string, ProductVerificationObservations['fast']>([
    [PRODUCT_FAST_GATE_ID, expected.fast],
    [PRODUCT_RUNTIME_GATE_ID, expected.runtime],
    [PRODUCT_POLICY_GATE_ID, expected.policy]
  ]);
  const gates = report.summary.claimSummary?.gates;
  if (!Array.isArray(gates) || gates.length !== byGate.size
      || new Set(gates.map(gate => gate?.gateId)).size !== byGate.size
      || gates.some(gate => {
    if (gate === null || typeof gate !== 'object') return true;
    const binding = byGate.get(gate.gateId);
    return binding === undefined || gate.subjectRevision !== binding.subjectRevision
      || gate.inputDigest !== binding.inputDigest;
  })) {
    throw new CompilerError('VERIFY-SUBJECT-002',
      'Verification artifacts do not bind the current Lock semantic subject');
  }
}

export function createSkippedPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  };
}

export function createSkippedFastLane(): FastVerificationLaneReport {
  return {
    status: 'skipped',
    build: { status: 'skipped' },
    unit: { status: 'skipped', passed: [] },
    acceptance: { status: 'skipped', passed: [], failed: [] },
    policy: { status: 'skipped', violations: [] },
    policyReport: createSkippedPolicyReport(),
    logs: { stdout: '', stderr: '' }
  };
}

function skippedStep(): VerificationStepReport {
  return { status: 'skipped', passed: [], failed: [], command: null };
}

export function createSkippedRuntimeLane(): RuntimeVerificationLaneReport {
  return {
    status: 'skipped',
    build: skippedStep(),
    unit: skippedStep(),
    acceptance: skippedStep(),
    logs: { stdout: '', stderr: '' }
  };
}

function buildProductVerificationSummary(input: Readonly<{
  lane: VerificationLane;
  fast: FastVerificationLaneReport;
  runtime: RuntimeVerificationLaneReport;
  runtimeMode: VerificationRuntimeMode;
  policyReport: PolicyReport;
  acceptanceCoverage: AcceptanceCoverageReport;
  observations: ProductVerificationObservations;
}>): VerificationReport['summary'] {
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    input.lane,
    input.fast,
    input.runtime,
    input.runtimeMode,
    input.policyReport,
    input.acceptanceCoverage,
    input.observations
  );
  const status: 'passed' | 'failed' =
    claimSummary.overall.overallStatus === 'passed' ? 'passed' : 'failed';
  const failedLanes: Array<'fast' | 'runtime'> = [];
  if (verificationLaneProfile(input.lane).runFast && input.fast.status === 'failed') {
    failedLanes.push('fast');
  }
  if (input.runtime.status === 'failed') failedLanes.push('runtime');
  return {
    status,
    requestedLane: input.lane,
    failedLanes,
    claimSummary
  };
}

export function buildProductVerificationReport(input: Readonly<{
  lane: VerificationLane;
  fast: FastVerificationLaneReport;
  runtime: RuntimeVerificationLaneReport;
  runtimeMode: VerificationRuntimeMode;
  policyReport: PolicyReport;
  acceptanceCoverage: AcceptanceCoverageReport;
  observations: ProductVerificationObservations;
}>): VerificationReport {
  const summary = buildProductVerificationSummary(input);
  return {
    build: input.fast.build,
    unit: input.fast.unit,
    acceptance: input.fast.acceptance,
    policy: input.fast.policy,
    fast: input.fast,
    runtime: input.runtime,
    summary,
    logs: {
      stdout: [input.fast.logs.stdout, input.runtime.logs.stdout]
        .filter(Boolean)
        .join('\n'),
      stderr: [input.fast.logs.stderr, input.runtime.logs.stderr]
        .filter(Boolean)
        .join('\n')
    }
  };
}
