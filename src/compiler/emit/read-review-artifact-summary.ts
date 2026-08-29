import { readOptionalCiArtifactManifest } from '../../verification/ci-artifacts/runtime/authority.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import type { ReviewSummary } from '../../verification/review/contract/types.ts';

export function readReviewArtifactSummary(workspaceRoot: string): ReviewSummary['artifactSummary'] {
  const { ciArtifactsPath } = getWorkspacePaths(workspaceRoot);
  const manifest = readOptionalCiArtifactManifest(
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
