import {
  assertMatchingRuntimeCoverageEvidence,
  buildAcceptanceCoverageReport
} from '../../assurance/acceptance/build-coverage.ts';
import type { AcceptanceCoverageReport } from '../../assurance/acceptance/coverage.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from '../../assurance/verification/contract/types.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { loadManifestForResolvedBlock } from '../workspace/sources/load-manifest.ts';
import { readOptionalCanonicalVerificationArtifactSet } from './platform/artifact/runtime/authority.ts';

function resolveFastVerificationLane(
  workspaceRoot: string,
  runtime: RuntimeVerificationLaneReport,
  fast: FastVerificationLaneReport | undefined
): FastVerificationLaneReport {
  if (fast !== undefined) return fast;
  const artifacts = readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Acceptance Coverage Verification artifact set'
  );
  if (artifacts === null) {
    throw new Error(
      'Acceptance Coverage readback requires the canonical matching fast/runtime artifact set'
    );
  }
  assertMatchingRuntimeCoverageEvidence(runtime, artifacts.runtimeReport);
  return artifacts.verificationReport.fast;
}

/** Capture physical manifest/artifact inputs, then delegate proof-graph and
 * coverage truth to Assurance. */
export async function buildAcceptanceCoverage(
  workspaceRoot: string,
  lock: LockFile,
  runtime: RuntimeVerificationLaneReport,
  fast?: FastVerificationLaneReport
): Promise<AcceptanceCoverageReport> {
  const fastLane = resolveFastVerificationLane(workspaceRoot, runtime, fast);
  const manifests = await Promise.all(
    lock.resolvedBlocks.map(async block => ({
      blockId: block.id,
      manifest: (await loadManifestForResolvedBlock(workspaceRoot, block)).manifest
    }))
  );
  return buildAcceptanceCoverageReport({
    lock,
    runtime,
    fast: fastLane,
    manifests
  });
}
