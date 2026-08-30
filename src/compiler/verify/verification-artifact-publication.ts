import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import { validateAcceptanceCoverageReport } from '../../verification/acceptance/runtime/coverage-authority.ts';
import { assertCanonicalVerificationArtifactSet, type VerificationArtifactSet } from '../../verification/artifact/contract/artifact.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../../verification/contract/types.ts';
import { CodexDevelopmentSnapshotVerificationData, CodexDevelopmentVerificationDataEqual } from '../../verification/result/contract/result.ts';
import { formatJsonFile, publishCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import type { LockFile } from '../contract.ts';
import { saveLock } from '../lock.ts';
import type { PolicyReport } from '../policies/contract/types.ts';
import { validatePolicyReport } from '../policies/runtime/report-authority.ts';

export interface VerificationArtifactPublicationArtifacts {
  readonly verificationReport: VerificationReport;
  readonly runtimeReport: RuntimeVerificationLaneReport;
  readonly policyReport: PolicyReport;
  readonly acceptanceCoverage: AcceptanceCoverageReport;
}

export interface VerificationArtifactPublicationInput {
  readonly workspaceRoot: string;
  readonly lock: LockFile;
  readonly artifacts: VerificationArtifactPublicationArtifacts;
  readonly commitFence?: CommitFence;
}

function snapshotPublicationArtifacts(
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

  const fastPolicyReport = validatePolicyReport(snapshot.verificationReport.fast.policyReport);
  if (!CodexDevelopmentVerificationDataEqual(snapshot.verificationReport.runtime, snapshot.runtimeReport) ||
      !CodexDevelopmentVerificationDataEqual(fastPolicyReport, policyReport) ||
      !CodexDevelopmentVerificationDataEqual(snapshot.verificationReport.policy, {
        status: policyReport.status,
        violations: policyReport.violations
      }) ||
      acceptanceCoverage.status !== snapshot.runtimeReport.status) {
    throw new Error('Partial-lane Verification artifacts do not close over one report context');
  }
  return artifacts;
}

async function publishJson(
  workspaceRoot: string,
  targetPath: string,
  value: unknown,
  label: string,
  commitFence?: CommitFence
): Promise<void> {
  await publishCanonicalWorkspaceFile({
    workspaceRoot,
    targetPath,
    bytes: Buffer.from(formatJsonFile(value), 'utf8'),
    label,
    commitFence
  });
}

/**
 * Publishes one already-computed Verification artifact set in a fixed,
 * dependency-first order. `requestedLane=all` must satisfy the complete
 * canonical Verification Artifact Set contract; partial lanes remain explicit
 * diagnostic snapshots and are never mislabeled as completion proof.
 *
 * This is deliberately not advertised as an atomic multi-file transaction:
 * #300/#472 still own rollback/recovery across files. The conservative order
 * makes graph.lock.json the final effect, so a partial failure cannot expose a
 * newly-succeeded Verify pass before every proof/diagnostic artifact has been
 * durably written and read back.
 */
export async function publishVerificationArtifactSet(
  input: VerificationArtifactPublicationInput
): Promise<VerificationArtifactPublicationArtifacts> {
  const artifacts = snapshotPublicationArtifacts(input.artifacts);
  const lock = structuredClone(input.lock);
  const paths = getWorkspacePaths(input.workspaceRoot);

  await input.commitFence?.();
  await publishJson(
    input.workspaceRoot,
    paths.runtimeReportPath,
    artifacts.runtimeReport,
    'Verification Runtime report',
    input.commitFence
  );
  await publishJson(
    input.workspaceRoot,
    paths.policyReportPath,
    artifacts.policyReport,
    'Verification Policy report',
    input.commitFence
  );
  await publishJson(
    input.workspaceRoot,
    paths.acceptanceCoveragePath,
    artifacts.acceptanceCoverage,
    'Verification Acceptance Coverage report',
    input.commitFence
  );
  await publishJson(
    input.workspaceRoot,
    paths.verificationReportPath,
    artifacts.verificationReport,
    'Verification report',
    input.commitFence
  );
  await saveLock(input.workspaceRoot, lock, input.commitFence);
  return artifacts;
}
