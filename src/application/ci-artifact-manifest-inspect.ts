import { compareCodeUnits } from '../contracts/canonical.ts';

export type CiArtifactManifestInspectionSource = Readonly<{
  summary: Readonly<{
    artifactStatus: string;
    artifactCount: number;
    missingCount: number;
    uploadGroupCount: number;
    governanceCount: number;
    testCount: number;
    contractCount: number;
    missingReasonCounts: Readonly<Record<string, number>>;
  }>;
  uploadGroups: readonly Readonly<{
    kind: string;
    count: number;
  }>[];
}>;

export type CiArtifactManifestInspectView = Readonly<{
  artifactStatus: string;
  artifactCount: number;
  missingCount: number;
  uploadGroupCount: number;
  governanceCount: number;
  testCount: number;
  contractCount: number;
  missingReasons: readonly Readonly<{ id: string; count: number }>[];
  uploadGroups: readonly Readonly<{ kind: string; count: number }>[];
}>;

function projectCountRecord(
  counts: Readonly<Record<string, number>>
): Array<Readonly<{ id: string; count: number }>> {
  return Object.entries(counts)
    .map(([id, count]) => {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError(`Invalid count for ${id}`);
      }
      return { id, count };
    })
    .filter((entry) => entry.count > 0)
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

export function projectCiArtifactManifest(
  manifest: CiArtifactManifestInspectionSource
): CiArtifactManifestInspectView {
  return {
    artifactStatus: manifest.summary.artifactStatus,
    artifactCount: manifest.summary.artifactCount,
    missingCount: manifest.summary.missingCount,
    uploadGroupCount: manifest.summary.uploadGroupCount,
    governanceCount: manifest.summary.governanceCount,
    testCount: manifest.summary.testCount,
    contractCount: manifest.summary.contractCount,
    missingReasons: projectCountRecord(manifest.summary.missingReasonCounts),
    uploadGroups: manifest.uploadGroups.map((group) => ({ kind: group.kind, count: group.count }))
  };
}
