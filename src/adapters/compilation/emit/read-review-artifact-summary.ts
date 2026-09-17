import { CI_ARTIFACT_FILES } from '../../../verification/ci-artifacts/contract/manifest.ts';
import { readOptionalCiArtifactManifest } from '../../../verification/ci-artifacts/runtime/authority.ts';
import type { ReviewSummary } from '../../../verification/review/contract/types.ts';
import { resolveWorkspaceArtifactPath } from "../../workspace-context.ts";

export function readReviewArtifactSummary(workspaceRoot: string): ReviewSummary['artifactSummary'] {
  const manifest = readOptionalCiArtifactManifest(
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.artifactManifest),
    'Review CI artifact manifest'
  );
  if (!manifest) return undefined;
  return {
    ...manifest.summary,
    ...(manifest.uploadGroups.length > 0 ? { uploadGroups: manifest.uploadGroups } : {}),
    ...(manifest.missing.length > 0 ? { missing: manifest.missing } : {})
  };
}
