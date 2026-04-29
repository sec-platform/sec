import { pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';
import type { CiArtifactManifest } from '../../shared/ci-artifact-types.ts';

export async function readReviewArtifactSummary(workspaceRoot: string): Promise<ReviewSummary['artifactSummary']> {
  const { ciArtifactsPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(ciArtifactsPath))) {
    return undefined;
  }
  const manifest = await readJson<CiArtifactManifest>(ciArtifactsPath);
  return {
    ...manifest.summary,
    ...(manifest.uploadGroups.length > 0 ? { uploadGroups: manifest.uploadGroups } : {}),
    ...(manifest.missing.length > 0 ? { missing: manifest.missing } : {})
  };
}
