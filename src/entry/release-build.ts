import type {
  ReleaseBuildCleanupFinding,
  ReleaseBuildOutcome,
  ReleaseBuildReceipt
} from '../application/release-build.ts';

export interface ReleaseBuildProcessOperations {
  execute(): Promise<ReleaseBuildOutcome>;
}

function cleanupFindingLine(finding: ReleaseBuildCleanupFinding): string {
  return [
    'Release cleanup finding',
    `phase=${finding.phase}`,
    `state=${finding.state}`,
    `path=${finding.path}`,
    `detail=${finding.detail}`
  ].join(' ');
}

function cleanupFailure(receipt: ReleaseBuildReceipt): Error {
  return new Error([
    'Release artifact publication is readable but the build operation did not settle cleanup',
    `sourceCommit=${receipt.sourceCommit}`,
    `sourceTree=${receipt.sourceTree}`,
    `manifestDigest=${receipt.manifestDigest}`,
    `cleanupFindings=${receipt.cleanupFindings.length}`
  ].join(' '));
}

function acceptedLine(receipt: ReleaseBuildReceipt): string {
  return [
    'Release artifact accepted and cleanup settled',
    `publicationStatus=${receipt.publicationStatus}`,
    `sourceCommit=${receipt.sourceCommit}`,
    `sourceTree=${receipt.sourceTree}`,
    `manifestDigest=${receipt.manifestDigest}`,
    `fileCount=${receipt.fileCount}`
  ].join(' ');
}

/** Own the release-build process protocol; bootstrap injects the use case. */
export async function runReleaseBuildProcess(
  operations: ReleaseBuildProcessOperations
): Promise<void> {
  try {
    const outcome = await operations.execute();
    for (const finding of outcome.receipt.cleanupFindings) {
      console.error(cleanupFindingLine(finding));
    }
    if (outcome.status === 'cleanup-unsettled') {
      console.error('Release artifact build failed:', cleanupFailure(outcome.receipt));
      process.exitCode = 1;
      return;
    }
    console.log(acceptedLine(outcome.receipt));
  } catch (error) {
    console.error('Release artifact build failed:', error);
    process.exitCode = 1;
  }
}
