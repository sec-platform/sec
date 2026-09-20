import type { AcceptanceCoverageReport } from '../../acceptance/coverage.ts';
import { sha256 } from '../../../contracts/canonical.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import type { PolicyReport } from '../../../semantics/policies/types.ts';
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

export function buildProductVerificationSummary(input: Readonly<{
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
