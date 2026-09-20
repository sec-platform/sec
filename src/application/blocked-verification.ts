import type { AcceptanceCoverageReport } from '../assurance/acceptance/coverage.ts';
import { CI_ARTIFACT_FILES } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildBlockedVerificationReport } from '../assurance/verification/contract/blocked-report.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationLane,
  VerificationReport
} from '../assurance/verification/contract/types.ts';
import {
  createSkippedRuntimeLane,
  productVerificationObservationBindings
} from '../assurance/verification/project/report.ts';
import type { LockFile } from '../compiler/contract.ts';
import { addGeneratedPaths } from '../compiler/contract/lock-schema.ts';
import { formatCompilerFailure } from '../compiler/errors.ts';
import type { PolicyReport } from '../semantics/policies/types.ts';

export type BlockedVerificationArtifactSet = Readonly<{
  verificationReport: VerificationReport;
  runtimeReport: RuntimeVerificationLaneReport;
  policyReport: PolicyReport;
  acceptanceCoverage: AcceptanceCoverageReport;
}>;

export interface BlockedVerificationOperations {
  runPolicy(): Promise<PolicyReport>;
  buildCoverage(
    runtime: RuntimeVerificationLaneReport,
    fast: FastVerificationLaneReport
  ): Promise<AcceptanceCoverageReport>;
  publish(lock: LockFile, artifacts: BlockedVerificationArtifactSet): Promise<unknown>;
}

/**
 * Own prerequisite-failure Verification settlement. Physical Policy execution,
 * coverage input capture and artifact publication are injected; Application
 * owns report construction order, Lock terminal state and publication payload.
 */
export async function executeBlockedVerificationSnapshot(
  lock: LockFile,
  lane: Exclude<VerificationLane, 'runtime'>,
  failure: unknown,
  operations: BlockedVerificationOperations
): Promise<void> {
  if (typeof operations.runPolicy !== 'function' ||
      typeof operations.buildCoverage !== 'function' ||
      typeof operations.publish !== 'function') {
    throw new TypeError('Blocked Verification operations must be callable');
  }

  const policyReport = await operations.runPolicy.call(operations);
  const runtime = createSkippedRuntimeLane();
  const report = buildBlockedVerificationReport({
    lane,
    policyReport,
    runtime,
    message: formatCompilerFailure(failure),
    observations: productVerificationObservationBindings(lock, lane, 'service')
  });
  const acceptanceCoverage = await operations.buildCoverage.call(
    operations,
    runtime,
    report.fast
  );

  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
  lock.passStatus.verify = 'failed';

  await operations.publish.call(operations, lock, {
    verificationReport: report,
    runtimeReport: runtime,
    policyReport,
    acceptanceCoverage
  });
}
