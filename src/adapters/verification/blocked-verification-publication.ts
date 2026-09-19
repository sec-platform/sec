import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationLane } from '../../assurance/verification/contract/types.ts';
import { buildBlockedVerificationReport } from '../../assurance/verification/contract/blocked-report.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { formatCompilerFailure } from '../../compiler/errors.ts';
import { addGeneratedPaths } from '../../compiler/contract/lock-schema.ts';
import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { runPolicyGate } from './run-policy-gate.ts';
import { createSkippedRuntimeLane } from './run-runtime-verification.ts';
import { publishVerificationArtifactSet } from './verification-artifact-publication.ts';
import { productVerificationObservationBindings } from './verify-project.ts';

/** Publish one blocked report through the existing canonical artifact writer.
 * Its original policy/coverage observations, Lock state and fence are retained. */
export async function writeBlockedVerificationSnapshot(
  workspaceRoot: string,
  lock: LockFile,
  lane: Exclude<VerificationLane, 'runtime'>,
  failure: unknown,
  beforeCommit: () => Promise<void>
): Promise<void> {
  const policyReport = await runPolicyGate(workspaceRoot);
  const runtime = createSkippedRuntimeLane();
  const message = formatCompilerFailure(failure);
  const report = buildBlockedVerificationReport({
    lane, policyReport, runtime, message,
    observations: productVerificationObservationBindings(lock, lane, 'service')
  });
  const coverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtime, report.fast);

  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
  lock.passStatus.verify = 'failed';

  await publishVerificationArtifactSet({
    workspaceRoot,
    lock,
    artifacts: {
      verificationReport: report,
      runtimeReport: runtime,
      policyReport,
      acceptanceCoverage: coverage
    },
    commitFence: beforeCommit
  });
}
