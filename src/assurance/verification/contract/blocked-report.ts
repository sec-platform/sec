import type { PolicyReport } from '../../../semantics/policies/types.ts';
import {
  buildBlockedProductVerificationClaimSummary,
  type ProductVerificationObservations
} from '../profile/contract/product.ts';
import type { VerificationLane, VerificationReport } from './types.ts';

/** Describe a prerequisite failure using already-observed policy and the
 * caller's skipped runtime lane. This does not execute gates, publish artifacts,
 * or turn skipped checks into success. Physical settlement remains with callers. */
export function buildBlockedVerificationReport(input: Readonly<{
  lane: Exclude<VerificationLane, 'runtime'>;
  policyReport: PolicyReport;
  runtime: VerificationReport['runtime'];
  message: string;
  observations: ProductVerificationObservations;
}>): VerificationReport {
  const { lane, policyReport, runtime, message, observations } = input;
  const fast: VerificationReport['fast'] = {
    status: 'failed',
    build: { status: 'skipped' },
    unit: { status: 'skipped', passed: [] },
    acceptance: { status: 'skipped', passed: [], failed: [] },
    policy: { status: policyReport.status, violations: policyReport.violations },
    policyReport,
    logs: { stdout: `policy:${policyReport.status}`, stderr: message }
  };
  const claimSummary = buildBlockedProductVerificationClaimSummary(
    lane,
    observations
  );
  return {
    build: fast.build,
    unit: fast.unit,
    acceptance: fast.acceptance,
    policy: fast.policy,
    fast,
    runtime,
    summary: {
      status: 'failed',
      requestedLane: lane,
      failedLanes: ['fast'],
      claimSummary
    },
    logs: { stdout: fast.logs.stdout, stderr: message }
  };
}
