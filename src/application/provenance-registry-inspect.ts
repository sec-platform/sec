import { uniqueSorted } from '../contracts/canonical.ts';
import { summarizeCounts } from '../contracts/collections.ts';

export type ProvenanceRegistryInspectArtifactSource = Readonly<{
  path: string;
  originType: string;
  originId: string;
  registrySourceId?: string;
  generatedByPass?: string;
  verifiedBy: readonly string[];
  overrideStatus: string;
}>;

export type ProvenanceRegistryInspectProjectionSource = Readonly<{
  artifacts: readonly ProvenanceRegistryInspectArtifactSource[];
}>;

export type ProvenanceRegistryCountEntry = Readonly<{
  id: string;
  count: number;
}>;

export type ProvenanceRegistrySample = Readonly<{
  path: string;
  originType: string;
  originId: string;
  registrySourceId?: string;
  verifiedBy: readonly string[];
  overrideStatus: string;
}>;

export type ProvenanceRegistryInspectView = Readonly<{
  artifactCount: number;
  registryArtifactCount: number;
  overrideArtifactCount: number;
  unverifiedArtifactCount: number;
  originTypeCounts: readonly ProvenanceRegistryCountEntry[];
  registrySourceCounts: readonly ProvenanceRegistryCountEntry[];
  generatedPasses: readonly string[];
  samples: readonly ProvenanceRegistrySample[];
}>;

function sampleArtifact(artifact: ProvenanceRegistryInspectArtifactSource): ProvenanceRegistrySample {
  return {
    path: artifact.path,
    originType: artifact.originType,
    originId: artifact.originId,
    ...(artifact.registrySourceId ? { registrySourceId: artifact.registrySourceId } : {}),
    verifiedBy: [...artifact.verifiedBy],
    overrideStatus: artifact.overrideStatus
  };
}

export function projectProvenanceRegistryInspect(
  source: ProvenanceRegistryInspectProjectionSource
): ProvenanceRegistryInspectView {
  const registryArtifacts = source.artifacts.filter((artifact) => artifact.registrySourceId);
  const generatedPasses = uniqueSorted(
    source.artifacts.flatMap((artifact) => artifact.generatedByPass ? [artifact.generatedByPass] : [])
  );
  const samples = [
    ...source.artifacts.filter((artifact) => artifact.originType === 'block').slice(0, 2),
    ...source.artifacts.filter((artifact) => artifact.originType === 'override').slice(0, 2),
    ...source.artifacts.filter((artifact) => artifact.originType === 'generated').slice(0, 2)
  ].slice(0, 5).map(sampleArtifact);

  return {
    artifactCount: source.artifacts.length,
    registryArtifactCount: registryArtifacts.length,
    overrideArtifactCount: source.artifacts.filter((artifact) => artifact.overrideStatus !== 'none').length,
    unverifiedArtifactCount: source.artifacts.filter((artifact) => artifact.verifiedBy.length === 0).length,
    originTypeCounts: summarizeCounts(source.artifacts.map((artifact) => artifact.originType)),
    registrySourceCounts: summarizeCounts(
      registryArtifacts.map((artifact) => artifact.registrySourceId ?? 'unknown')
    ),
    generatedPasses,
    samples
  };
}
