import { readOptionalCiArtifactManifestV1 } from '../../shared/ci-artifact-authority.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';

export function readReviewArtifactSummary(workspaceRoot: string): ReviewSummary['artifactSummary'] {
  const { ciArtifactsPath } = getWorkspacePaths(workspaceRoot);
  const manifest = readOptionalCiArtifactManifestV1(
    ciArtifactsPath,
    'Review CI artifact manifest'
  );
  if (!manifest) return undefined;
  return {
    ...manifest.summary,
    ...(manifest.uploadGroups.length > 0 ? { uploadGroups: manifest.uploadGroups } : {}),
    ...(manifest.missing.length > 0 ? { missing: manifest.missing } : {})
  };
}
