import path from 'node:path';
import type { AcceptanceCoverageReport } from '../../assurance/acceptance/coverage.ts';
import { validateAcceptanceCoverageReport } from '../../verification/acceptance/runtime/coverage-authority.ts';
import { assertCanonicalVerificationArtifactSet, type VerificationArtifactSet } from '../../verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../../verification/contract/types.ts';
import { CodexDevelopmentSnapshotVerificationData, CodexDevelopmentVerificationDataEqual } from '../../verification/result/contract/result.ts';
import { formatJsonFile, publishExistingParentCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace/runtime/paths.ts';
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

// Ordering is a publication contract, not an alphabetical enumeration: the
// summary depends on the three reports, and graph lock is always the last write.
const VERIFICATION_PUBLICATION_ORDER = Object.freeze([
  Object.freeze({ key: 'runtimeReport', label: 'Verification Runtime report' }),
  Object.freeze({ key: 'policyReport', label: 'Verification Policy report' }),
  Object.freeze({ key: 'acceptanceCoverage', label: 'Verification Acceptance Coverage report' }),
  Object.freeze({ key: 'verificationReport', label: 'Verification report' })
] as const);

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
  const cwd = process.cwd();
  const { workspaceRoot: requestedRoot, artifacts: requestedArtifacts, lock: requestedLock, commitFence: providerFence } = input;
  const workspaceRoot = path.resolve(cwd, requestedRoot);
  if (providerFence !== undefined && typeof providerFence !== 'function') throw new TypeError('Verification publication fence must be callable');
  const commitFence = providerFence === undefined ? undefined : () => Reflect.apply(providerFence, input, []);
  const lock = structuredClone(requestedLock);
  const artifacts = snapshotPublicationArtifacts(requestedArtifacts);
  // Resolve every destination and encode every artifact before the first fence
  // or file effect. A later input mutation cannot split one set across roots,
  // replace its admission callback, or change a later serialization decision.
  const publications = VERIFICATION_PUBLICATION_ORDER.map(({ key, label }) => Object.freeze({
    workspaceRoot,
    targetPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES[key]),
    bytes: Buffer.from(formatJsonFile(artifacts[key]), 'utf8'),
    label,
    commitFence
  }));
  await commitFence?.();
  for (const publication of publications) await publishExistingParentCanonicalWorkspaceFile(publication);
  await saveLock(workspaceRoot, lock, commitFence);
  return artifacts;
}
