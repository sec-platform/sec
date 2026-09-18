import { uniqueSorted } from '../contracts/canonical.ts';
import { buildCiArtifactUploadGroups, CI_ARTIFACT_MANIFEST_PATH, requireCanonicalCiArtifactPath } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactKind, CiArtifactManifest, CiArtifactUploadGroup } from '../assurance/verification/ci-artifacts/contract/types.ts';

type ArtifactPathUploadGroup = CiArtifactUploadGroup;

export type ArtifactPathKind = CiArtifactKind;

export type ArtifactUploadPathContract = {
  formatVersion: CiArtifactManifest['formatVersion'];
  root: CiArtifactManifest['root'];
  kind: ArtifactPathKind | 'all';
  artifactStatus: CiArtifactManifest['summary']['artifactStatus'];
  count: number;
  paths: string[];
  byKind: Partial<Record<ArtifactPathKind, number>>;
  uploadGroupCount: number;
  uploadGroups: ArtifactPathUploadGroup[];
  missingCount: number;
  missingReasonTypeCount: number;
  missingReasonCounts: CiArtifactManifest['summary']['missingReasonCounts'];
  missing: CiArtifactManifest['missing'];
};

function artifactUploadPathSummary(
  manifest: CiArtifactManifest,
  kind?: ArtifactPathKind
): {
  paths: string[];
  byKind: Partial<Record<ArtifactPathKind, number>>;
  uploadGroups: ArtifactPathUploadGroup[];
} {
  const contractPaths = new Set(
    manifest.summary.contractPaths.map((artifactPath) => requireCanonicalCiArtifactPath(artifactPath))
  );
  const artifacts = kind === 'contract'
    ? manifest.artifacts.filter((artifact) => contractPaths.has(requireCanonicalCiArtifactPath(artifact.path)))
    : kind
      ? manifest.artifacts.filter((artifact) => artifact.kind === kind)
      : manifest.artifacts;
  const includeManifest = kind === undefined || kind === 'governance';
  const entries = [
    ...(includeManifest
      ? [{ path: CI_ARTIFACT_MANIFEST_PATH, kind: 'governance' as const }]
      : []),
    ...artifacts.map((artifact) => ({
      path: requireCanonicalCiArtifactPath(artifact.path),
      kind: kind === 'contract' ? 'contract' as const : artifact.kind
    }))
  ];
  const kindByPath = new Map(entries.map((entry) => [entry.path, entry.kind]));
  const paths = uniqueSorted([...kindByPath.keys()]);
  const uploadEntries = paths.flatMap((path) => {
    const pathKind = kindByPath.get(path);
    return pathKind ? [{ path, kind: pathKind }] : [];
  });
  const byKind: Partial<Record<ArtifactPathKind, number>> = {};
  for (const entry of uploadEntries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  const uploadGroups = buildCiArtifactUploadGroups(uploadEntries);

  return { paths, byKind, uploadGroups };
}

export function buildArtifactUploadPathContract(
  manifest: CiArtifactManifest,
  kind?: ArtifactPathKind
): ArtifactUploadPathContract {
  const pathSummary = artifactUploadPathSummary(manifest, kind);
  return {
    formatVersion: manifest.formatVersion,
    root: manifest.root,
    kind: kind ?? 'all',
    artifactStatus: manifest.summary.artifactStatus,
    count: pathSummary.paths.length,
    paths: pathSummary.paths,
    byKind: pathSummary.byKind,
    uploadGroupCount: pathSummary.uploadGroups.length,
    uploadGroups: pathSummary.uploadGroups,
    missingCount: manifest.missing.length,
    missingReasonTypeCount: manifest.summary.missingReasonTypeCount,
    missingReasonCounts: { ...manifest.summary.missingReasonCounts },
    missing: manifest.missing.map((entry) => ({ ...entry }))
  };
}
