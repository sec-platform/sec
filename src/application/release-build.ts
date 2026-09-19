export interface ReleaseBuildCleanupFinding {
  readonly phase: string;
  readonly state: string;
  readonly path: string;
  readonly detail: string;
}

export interface ReleaseBuildReceipt {
  readonly publicationStatus: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly manifestDigest: string;
  readonly fileCount: number;
  readonly cleanupFindings: readonly ReleaseBuildCleanupFinding[];
}

export type ReleaseBuildOutcome =
  | Readonly<{
      readonly status: 'accepted';
      readonly receipt: ReleaseBuildReceipt;
    }>
  | Readonly<{
      readonly status: 'cleanup-unsettled';
      readonly receipt: ReleaseBuildReceipt;
    }>;

/**
 * Coordinate the release-build use case independently from process protocol
 * and concrete artifact providers. A readable publication whose cleanup did
 * not settle is not a successful use-case completion.
 */
export async function executeReleaseBuild(
  build: () => Promise<ReleaseBuildReceipt>
): Promise<ReleaseBuildOutcome> {
  if (typeof build !== 'function') {
    throw new TypeError('Release build operation must be callable');
  }
  const receipt = await build();
  return Object.freeze({
    status: receipt.cleanupFindings.length === 0 ? 'accepted' as const : 'cleanup-unsettled' as const,
    receipt
  });
}
