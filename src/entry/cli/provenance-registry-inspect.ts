import type {
  ProvenanceRegistryCountEntry,
  ProvenanceRegistryInspectView
} from '../../application/provenance-registry-inspect.ts';
import { formatFields, formatList } from './format-utils.ts';

function formatCountEntries(entries: readonly ProvenanceRegistryCountEntry[]): string {
  return formatList(entries.map((entry) => `${entry.id}=${entry.count}`));
}

export function formatProvenanceRegistry(view: ProvenanceRegistryInspectView): string {
  const lines = [
    formatFields([
      'Provenance registry',
      `artifacts=${view.artifactCount}`,
      `registry=${view.registryArtifactCount}`,
      `overrides=${view.overrideArtifactCount}`,
      `unverified=${view.unverifiedArtifactCount}`
    ]),
    `Origins: ${formatCountEntries(view.originTypeCounts)}`,
    `Registry sources: ${formatCountEntries(view.registrySourceCounts)}`,
    `Generated passes: ${formatList([...view.generatedPasses])}`
  ];
  for (const artifact of view.samples) {
    lines.push(
      formatFields([
        `Artifact ${artifact.path}`,
        `origin=${artifact.originType}:${artifact.originId}`,
        `registry=${artifact.registrySourceId ?? 'none'}`,
        `verifiedBy=${formatList([...artifact.verifiedBy])}`,
        `override=${artifact.overrideStatus}`
      ])
    );
  }
  return lines.join('\n');
}
