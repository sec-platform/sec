import type { BlockUsageMapView } from '../../application/block-usage-map.ts';
import { formatList } from './format-utils.ts';

export function formatBlockUsageMap(view: BlockUsageMapView): string {
  return [
    `Block usage map ${view.blocks.length} blocks`,
    `Install order: ${formatList(view.blocks.map((block) => `${block.installOrder}:${block.id}`))}`
  ].join('\n');
}
