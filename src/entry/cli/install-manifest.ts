import type { InstallManifestView } from '../../application/install-manifest.ts';
import { formatList, formatSummaryEntries } from './format-utils.ts';

export function formatInstallManifest(view: InstallManifestView): string {
  return [
    `Install manifest ${view.stepCount} steps`,
    `Blocks: ${formatList([...view.blocks])}`,
    `Actions: ${formatSummaryEntries([...view.actions])}`,
    `Registry kinds: ${formatSummaryEntries([...view.registryKinds])}`,
    `Statuses: ${formatSummaryEntries([...view.statuses])}`
  ].join('\n');
}
