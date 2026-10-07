import path from 'node:path';

import {
  assertCanonicalVerificationArtifactSet,
  type CanonicalVerificationArtifactSet,
  type VerificationArtifactSet
} from '../../../../../assurance/verification/artifact/contract/artifact.ts';
import {
  snapshotVerificationPublicationArtifacts,
  type VerificationArtifactPublicationArtifacts
} from '../../../../../assurance/verification/artifact/publication.ts';
import { CI_ARTIFACT_FILES } from '../../../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { assertProductVerificationArtifactSubject } from '../../../../../assurance/verification/project/report.ts';
import type { LockFile } from '../../../../../compiler/contract.ts';
import { cloneAndDeepFreeze } from '../../../../../contracts/canonical.ts';
import { readOptionalRetainedJsonLeaf, retainOptionalDirectory } from '../../../../runtime-state/physical/runtime/retained-file-read.ts';
import { resolveWorkspaceArtifactPath } from "../../../../workspace-context.ts";

/**
 * Retained read owner for the complete canonical Verification artifact set.
 *
 * All four artifacts share `control/evidence`; retaining that parent once
 * removes redundant ancestor observations while every leaf read still
 * revalidates the retained directory identity. A completely absent set maps to
 * null. A partial or cross-artifact-inconsistent set is never equivalent to
 * absence and fails closed.
 */
function readOptionalVerificationArtifactValues(
  workspaceRoot: string,
  label: string
): VerificationArtifactSet | null {
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

  return candidate;
}

export function readOptionalCanonicalVerificationArtifactSet(
  workspaceRoot: string,
  label = 'Verification artifact set'
): CanonicalVerificationArtifactSet | null {
  const candidate = readOptionalVerificationArtifactValues(workspaceRoot, label);
  if (candidate === null) return null;
  assertCanonicalVerificationArtifactSet(candidate);
  return cloneAndDeepFreeze(candidate);
}

/** Share one canonical retained read and its existing Product Verification
 * subject check. Missing data stays missing; stale data is never refreshed here. */
export function readOptionalCurrentVerificationArtifactSet(
  workspaceRoot: string,
  lock: LockFile,
  label = 'Current Verification artifact set'
): CanonicalVerificationArtifactSet | null {
  const artifacts = readOptionalCanonicalVerificationArtifactSet(workspaceRoot, label);
  if (artifacts !== null) assertProductVerificationArtifactSubject(lock, artifacts);
  return artifacts;
}

/** Diagnostic consumers preserve the publication owner's actual lane profile;
 * a fast/partial result must not acquire an all-lane completion prerequisite. */
export function readOptionalCurrentVerificationPublication(
  workspaceRoot: string,
  lock: LockFile,
  label = 'Current Verification publication'
): VerificationArtifactPublicationArtifacts | null {
  const candidate = readOptionalVerificationArtifactValues(workspaceRoot, label);
  if (candidate === null) return null;
  const artifacts = snapshotVerificationPublicationArtifacts(candidate as VerificationArtifactPublicationArtifacts);
  assertProductVerificationArtifactSubject(lock, artifacts);
  return cloneAndDeepFreeze(artifacts);
}
