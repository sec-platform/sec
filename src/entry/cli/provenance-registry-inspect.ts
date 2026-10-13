import type {
  ProvenanceRegistryInspectView
} from '../../application/provenance-registry-inspect.ts';
import { formatFields, formatList, formatSummaryEntries } from './format-utils.ts';

export function formatProvenanceRegistry(view: ProvenanceRegistryInspectView): string {
  const lines = [
    formatFields([
      'Provenance registry',
      `artifacts=${view.artifactCount}`,
      `registry=${view.registryArtifactCount}`,
      `overrides=${view.overrideArtifactCount}`,
      `unverified=${view.unverifiedArtifactCount}`
    ]),
    `Origins: ${formatSummaryEntries(view.originTypeCounts)}`,
    `Registry sources: ${formatSummaryEntries(view.registrySourceCounts)}`,
    `Generated passes: ${formatList(view.generatedPasses)}`
  ];
  for (const artifact of view.samples) {
    lines.push(
      formatFields([
        `Artifact ${artifact.path}`,
        `origin=${artifact.originType}:${artifact.originId}`,
        `registry=${artifact.registrySourceId ?? 'none'}`,
        `verifiedBy=${formatList(artifact.verifiedBy)}`,
        `override=${artifact.overrideStatus}`
      ])
    );
  }
  return lines.join('\n');
}
