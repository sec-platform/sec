import type { CiArtifactManifest } from '../../shared/ci-artifact-types.ts';
import { readOptionalJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';

export async function readReviewArtifactSummary(workspaceRoot: string): Promise<ReviewSummary['artifactSummary']> {
  const { ciArtifactsPath } = getWorkspacePaths(workspaceRoot);
  const manifest = await readOptionalJson<CiArtifactManifest>(ciArtifactsPath);
  if (!manifest) {
    return undefined;
  }
  return {
    ...manifest.summary,
    ...(manifest.uploadGroups.length > 0 ? { uploadGroups: manifest.uploadGroups } : {}),
    ...(manifest.missing.length > 0 ? { missing: manifest.missing } : {})
  };
}
