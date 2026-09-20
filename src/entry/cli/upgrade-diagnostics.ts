import type { UpgradeDiagnosticsView } from '../../application/upgrade-diagnostics.ts';
import { formatFields, formatList } from './format-utils.ts';

export function formatUpgradeDiagnostics(view: UpgradeDiagnosticsView): string {
  return [
    `Upgrade diagnostics ${view.phase}`,
    formatFields([
      `Block: ${view.blockId}`,
      `target: ${view.targetVersion}`,
      `status: ${view.status}`
    ]),
    formatFields([
      `Failed check: ${view.failedCheck}`,
      `code: ${view.errorCode}`
    ]),
    `Message: ${view.message}`,
    `Attribution: ${formatList([...view.attribution])}`
  ].join('\n');
}
