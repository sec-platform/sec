import type { AcceptanceCoverageReport } from '../../acceptance/coverage.ts';
import { validateAcceptanceCoverageReport } from '../acceptance/validation.ts';
import type {
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../contract/types.ts';
import {
  CodexDevelopmentSnapshotVerificationData,
  CodexDevelopmentVerificationDataEqual
} from '../result/contract/result.ts';
import type { PolicyReport } from '../../../semantics/policies/types.ts';
import { validatePolicyReport } from '../../policies/report.ts';
import {
  assertCanonicalVerificationArtifactSet,
  type VerificationArtifactSet
} from './contract/artifact.ts';

export interface VerificationArtifactPublicationArtifacts {
  readonly verificationReport: VerificationReport;
  readonly runtimeReport: RuntimeVerificationLaneReport;
  readonly policyReport: PolicyReport;
  readonly acceptanceCoverage: AcceptanceCoverageReport;
}

/**
 * Capture and validate one immutable Verification publication context before
 * any physical file effect. Full-lane publications must satisfy the canonical
 * artifact-set proof contract; partial-lane snapshots must still close over
 * one internally consistent report context.
 */
export function snapshotVerificationPublicationArtifacts(
  input: VerificationArtifactPublicationArtifacts
): VerificationArtifactPublicationArtifacts {
  const snapshot = CodexDevelopmentSnapshotVerificationData(
    input,
    'Verification artifact publication input'
  ) as unknown as VerificationArtifactPublicationArtifacts;
  const policyReport = structuredClone(validatePolicyReport(snapshot.policyReport));
  const acceptanceCoverage = structuredClone(
    validateAcceptanceCoverageReport(snapshot.acceptanceCoverage)
  );
  const artifacts: VerificationArtifactPublicationArtifacts = {
    verificationReport: snapshot.verificationReport,
    runtimeReport: snapshot.runtimeReport,
    policyReport,
    acceptanceCoverage
  };

  if (snapshot.verificationReport.summary.requestedLane === 'all') {
    assertCanonicalVerificationArtifactSet(artifacts as VerificationArtifactSet);
    return artifacts;
  }

  const fastPolicyReport = validatePolicyReport(
    snapshot.verificationReport.fast.policyReport
  );
  if (!CodexDevelopmentVerificationDataEqual(
        snapshot.verificationReport.runtime,
        snapshot.runtimeReport
      ) ||
      !CodexDevelopmentVerificationDataEqual(fastPolicyReport, policyReport) ||
      !CodexDevelopmentVerificationDataEqual(snapshot.verificationReport.policy, {
        status: policyReport.status,
        violations: policyReport.violations
      }) ||
      acceptanceCoverage.status !== snapshot.runtimeReport.status) {
    throw new Error(
      'Partial-lane Verification artifacts do not close over one report context'
    );
  }
  return artifacts;
}
