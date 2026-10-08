import type { CiArtifactManifestInspectView } from '../../application/ci-artifact-manifest-inspect.ts';
import { formatFields, formatList, formatSummaryEntries } from './format-utils.ts';

export function formatCiArtifactManifest(view: CiArtifactManifestInspectView): string {
  return [
    `Artifact manifest ${view.artifactStatus}`,
    formatFields([
      `artifacts=${view.artifactCount}`,
      `missing=${view.missingCount}`,
      `upload groups=${view.uploadGroupCount}`
    ]),
    `Kinds: governance=${view.governanceCount}, test=${view.testCount}, contract=${view.contractCount}`,
    `Missing reasons: ${formatSummaryEntries(view.missingReasons)}`,
    `Upload groups: ${formatList(view.uploadGroups.map((group) => `${group.kind}=${group.count}`))}`
  ].join('\n');
}
