import type { PolicyReport } from '../../../semantics/policies/types.ts';
import type { AcceptanceCoverageReport } from '../../acceptance/coverage.ts';
import { validatePolicyReport } from '../../policies/report.ts';
import { validateAcceptanceCoverageReport } from '../acceptance/validation.ts';
import type {
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../contract/types.ts';
import {
  CodexDevelopmentSnapshotVerificationData
} from '../result/contract/result.ts';
import {
  assertVerificationArtifactSet,
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

  assertVerificationArtifactSet(artifacts as VerificationArtifactSet);
  return artifacts;
}
