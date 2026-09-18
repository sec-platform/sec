import type { CiArtifactManifestInspectView } from '../../application/ci-artifact-manifest-inspect.ts';
import { formatFields, formatList } from './format-utils.ts';

function formatCounts(entries: readonly Readonly<{ id: string; count: number }>[]): string {
  return formatList(entries.map((entry) => `${entry.id}=${entry.count}`));
}

export function formatCiArtifactManifest(view: CiArtifactManifestInspectView): string {
  return [
    `Artifact manifest ${view.artifactStatus}`,
    formatFields([
      `artifacts=${view.artifactCount}`,
      `missing=${view.missingCount}`,
      `upload groups=${view.uploadGroupCount}`
    ]),
    `Kinds: governance=${view.governanceCount}, test=${view.testCount}, contract=${view.contractCount}`,
    `Missing reasons: ${formatCounts(view.missingReasons)}`,
    `Upload groups: ${formatList(view.uploadGroups.map((group) => `${group.kind}=${group.count}`))}`
  ].join('\n');
}
