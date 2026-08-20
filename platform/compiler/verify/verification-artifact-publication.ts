import { validateAcceptanceCoverageReportV1 } from '../../shared/acceptance-coverage-authority.ts';
import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { formatJsonFile, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { saveLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { validatePolicyReportV1 } from '../../shared/policy-report-authority.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import {
  assertCanonicalVerificationArtifactSet,
  type VerificationArtifactSet
} from '../../shared/verification-artifact-contract.ts';
import {
  CodexDevelopmentSnapshotVerificationDataV1,
  CodexDevelopmentVerificationDataEqualV1
} from '../../shared/verification-result-contract.ts';
import type {
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../../shared/verification-types.ts';
import { publishCanonicalWorkspaceFileV1 } from '../../shared/workspace-file-publication.ts';

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
  const snapshot = CodexDevelopmentSnapshotVerificationDataV1(
    input,
    'Verification artifact publication input'
  ) as unknown as VerificationArtifactPublicationArtifacts;
  const policyReport = structuredClone(validatePolicyReportV1(snapshot.policyReport));
  const acceptanceCoverage = structuredClone(
    validateAcceptanceCoverageReportV1(snapshot.acceptanceCoverage)
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

  const fastPolicyReport = validatePolicyReportV1(snapshot.verificationReport.fast.policyReport);
  if (!CodexDevelopmentVerificationDataEqualV1(snapshot.verificationReport.runtime, snapshot.runtimeReport) ||
      !CodexDevelopmentVerificationDataEqualV1(fastPolicyReport, policyReport) ||
      !CodexDevelopmentVerificationDataEqualV1(snapshot.verificationReport.policy, {
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
  await publishCanonicalWorkspaceFileV1({
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
export async function publishVerificationArtifactSetV1(
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
