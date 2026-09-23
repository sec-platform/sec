import { CI_ARTIFACT_FILES } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { ReviewSummary } from '../../../assurance/verification/review/contract/types.ts';
import { readOptionalCiArtifactManifest } from '../../verification/platform/ci-artifacts/runtime/authority.ts';
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
