import path from 'node:path';

import { cloneAndDeepFreeze } from '../../../foundation/canonical.ts';
import { getWorkspacePaths } from '../../../workspace/paths.ts';
import {
  readOptionalRetainedJsonLeafV1,
  retainOptionalDirectoryV1
} from '../../../runtime-physical/index.ts';
import {
  assertCanonicalVerificationArtifactSet,
  type CanonicalVerificationArtifactSet,
  type VerificationArtifactSet
} from '../index.ts';

/**
 * Retained read owner for the complete canonical Verification artifact set.
 *
 * All four artifacts share `control/evidence`; retaining that parent once
 * removes redundant ancestor observations while every leaf read still
 * revalidates the retained directory identity. A completely absent set maps to
 * null. A partial or cross-artifact-inconsistent set is never equivalent to
 * absence and fails closed.
 */
export function readOptionalCanonicalVerificationArtifactSetV1(
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

  const parent = retainOptionalDirectoryV1(parentPath, `${label} parent`);
  if (parent === null) return null;

  const candidate: VerificationArtifactSet = {
    verificationReport: readOptionalRetainedJsonLeafV1<unknown>(
      parent,
      path.basename(paths.verificationReportPath),
      `${label} Verification report`
    ),
    runtimeReport: readOptionalRetainedJsonLeafV1<unknown>(
      parent,
      path.basename(paths.runtimeReportPath),
      `${label} Runtime report`
    ),
    policyReport: readOptionalRetainedJsonLeafV1<unknown>(
      parent,
      path.basename(paths.policyReportPath),
      `${label} Policy report`
    ),
    acceptanceCoverage: readOptionalRetainedJsonLeafV1<unknown>(
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
