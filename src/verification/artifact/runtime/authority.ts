import path from 'node:path';

import { cloneAndDeepFreeze } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { getWorkspacePaths } from '../../../workspace/paths.ts';
import { readOptionalRetainedJsonLeaf, retainOptionalDirectory } from '../../../runtime-state/physical/runtime/retained-file-read.ts';
import {
  assertCanonicalVerificationArtifactSet,
  type CanonicalVerificationArtifactSet,
  type VerificationArtifactSet
} from '../contract/artifact.ts';

/**
 * Retained read owner for the complete canonical Verification artifact set.
 *
 * All four artifacts share `control/evidence`; retaining that parent once
 * removes redundant ancestor observations while every leaf read still
 * revalidates the retained directory identity. A completely absent set maps to
 * null. A partial or cross-artifact-inconsistent set is never equivalent to
 * absence and fails closed.
 */
export function readOptionalCanonicalVerificationArtifactSet(
  workspaceRoot: string,
  label = 'Verification artifact set'
): CanonicalVerificationArtifactSet | null {
  const paths = getWorkspacePaths(workspaceRoot);
  const artifactPaths = [
    paths.verificationReportPath,
    paths.runtimeReportPath,
    paths.policyReportPath,
    paths.acceptanceCoveragePath
  ] as const;
  const parentPath = path.dirname(paths.verificationReportPath);
  if (artifactPaths.some((filePath) => path.dirname(filePath) !== parentPath)) {
    throw new Error(`${label} artifacts must share one canonical parent`);
  }

  const parent = retainOptionalDirectory(parentPath, `${label} parent`);
  if (parent === null) return null;

  const candidate: VerificationArtifactSet = {
    verificationReport: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(paths.verificationReportPath),
      `${label} Verification report`
    ),
    runtimeReport: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(paths.runtimeReportPath),
      `${label} Runtime report`
    ),
    policyReport: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(paths.policyReportPath),
      `${label} Policy report`
    ),
    acceptanceCoverage: readOptionalRetainedJsonLeaf<unknown>(
      parent,
      path.basename(paths.acceptanceCoveragePath),
      `${label} Acceptance Coverage report`
    )
  };

  const values = Object.values(candidate);
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error(`${label} is partially published`);
  }

  assertCanonicalVerificationArtifactSet(candidate);
  return cloneAndDeepFreeze(candidate);
}
