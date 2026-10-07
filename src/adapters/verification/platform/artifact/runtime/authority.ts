import path from 'node:path';

import {
  assertVerificationArtifactSet,
  type CanonicalVerificationArtifactSet,
  type ValidatedVerificationArtifactSet,
  type VerificationArtifactSet
} from '../../../../../assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { cloneAndDeepFreeze } from '../../../../../contracts/canonical.ts';
import { readOptionalRetainedJsonLeaf, retainOptionalDirectory } from '../../../../runtime-state/physical/runtime/retained-file-read.ts';
import { resolveWorkspaceArtifactPath } from "../../../../workspace-context.ts";

/**
 * Retained read owner for one internally consistent Verification observation set.
 *
 * All four artifacts share `control/evidence`; retaining that parent once
 * removes redundant ancestor observations while every leaf read still
 * revalidates the retained directory identity. A completely absent set maps to
 * null. A partial or cross-artifact-inconsistent set is never equivalent to
 * absence and fails closed.
 */
export function readOptionalVerificationArtifactSet(
  workspaceRoot: string,
  label = 'Verification artifact set'
): ValidatedVerificationArtifactSet | null {
  const artifactPaths = [
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport),
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage)
  ] as const;
  const [verificationReportPath, runtimeReportPath, policyReportPath, acceptanceCoveragePath] = artifactPaths;
  const parentPath = path.dirname(verificationReportPath);
  if (artifactPaths.some((filePath) => path.dirname(filePath) !== parentPath)) {
    throw new Error(`${label} artifacts must share one canonical parent`);
  }

  const parent = retainOptionalDirectory(parentPath, `${label} parent`);
  if (parent === null) return null;

  const candidate: VerificationArtifactSet = {
    verificationReport: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(verificationReportPath),
      `${label} Verification report`
    ),
    runtimeReport: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(runtimeReportPath),
      `${label} Runtime report`
    ),
    policyReport: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(policyReportPath),
      `${label} Policy report`
    ),
    acceptanceCoverage: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(acceptanceCoveragePath),
      `${label} Acceptance Coverage report`
    )
  };

  const values = Object.values(candidate);
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error(`${label} is partially published`);
  }

  assertVerificationArtifactSet(candidate);
  return cloneAndDeepFreeze(candidate);
}

/** Completion consumers keep the all-lane requirement at their own boundary. */
export function readOptionalCanonicalVerificationArtifactSet(
  workspaceRoot: string,
  label = 'Verification artifact set'
): CanonicalVerificationArtifactSet | null {
  const artifacts = readOptionalVerificationArtifactSet(workspaceRoot, label);
  if (artifacts !== null && artifacts.verificationReport.summary.requestedLane !== 'all') {
    throw new Error('Pipeline completion Verification artifacts do not match the exact canonical schema');
  }
  return artifacts;
}
